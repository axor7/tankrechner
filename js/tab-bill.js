// Tab "Abrechnung": fair aufteilen, wer schuldet wem wie viel.
import { state, update, personById } from './state.js';
import { aggregate, settle, addDays, isoWeek, mondayOf, toISODate, DIRECTIONS, FUELS } from './calc.js';
import { paymentMessage, paypalLink, paypalUser } from './pay.js';
import { weeklyDebts, withPayments, openByPair, markPaid, payKey } from './debts.js';
import { payUi } from './tab-trips.js';
import { h, stat, fmtEuro, fmtKm, fmtL, fmtDate, fmtPrice, fmtDuration, toast } from './ui.js';

function periodRange() {
  const ui = state.ui;
  if (ui.period === 'week') return { from: ui.week, to: addDays(ui.week, 6), label: `KW ${isoWeek(ui.week).week} (${fmtDate(ui.week)} – ${fmtDate(addDays(ui.week, 6))})` };
  if (ui.period === 'month') {
    const [y, m] = ui.week.split('-').map(Number);
    const from = `${y}-${String(m).padStart(2, '0')}-01`;
    const to = toISODate(new Date(y, m, 0));
    return { from, to, label: new Date(y, m - 1, 1).toLocaleDateString('de-DE', { month: 'long', year: 'numeric' }) };
  }
  if (ui.period === 'custom') return { from: ui.from || '0000-01-01', to: ui.to || '9999-12-31', label: `${ui.from ? fmtDate(ui.from) + ui.from.slice(0, 4) : 'Anfang'} – ${ui.to ? fmtDate(ui.to) + ui.to.slice(0, 4) : 'heute'}` };
  return { from: '0000-01-01', to: '9999-12-31', label: 'Alle Fahrten' };
}

export function collectEntries(from, to) {
  const out = [];
  const dirs = state.roundTrip ? DIRECTIONS : ['hin'];
  for (const week of Object.values(state.weeks)) {
    for (const [date, d] of Object.entries(week.days)) {
      if (date < from || date > to) continue;
      for (const dir of dirs) if (d[dir]) out.push({ trip: d[dir], snap: week.snap, date, direction: dir });
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.direction.localeCompare(b.direction));
}

const nameOf = (id) => personById(id)?.name || 'Unbekannt';

function periodCard(range) {
  const ui = state.ui;
  const periods = [['week', 'Woche'], ['month', 'Monat'], ['all', 'Alles'], ['custom', 'Zeitraum']];
  const step = ui.period === 'week' ? 7 : ui.period === 'month' ? 30 : 0;
  const nav = (dir) => update((s) => {
    if (s.ui.period === 'week') s.ui.week = addDays(s.ui.week, dir * 7);
    else {
      const [y, m] = s.ui.week.split('-').map(Number);
      s.ui.week = mondayOf(toISODate(new Date(y, m - 1 + dir, 15)));
    }
  });
  return h('section', { class: 'card' },
    h('div', { class: 'segmented' }, periods.map(([p, l]) => h('button', {
      type: 'button', class: ui.period === p ? 'active' : '', onclick: () => update((s) => { s.ui.period = p; }),
    }, l))),
    h('div', { class: 'week-nav' },
      step ? h('button', { type: 'button', class: 'icon-btn big', onclick: () => nav(-1) }, '‹') : null,
      h('div', { class: 'week-title' }, h('strong', {}, range.label)),
      step ? h('button', { type: 'button', class: 'icon-btn big', onclick: () => nav(1) }, '›') : null,
    ),
    ui.period === 'custom' ? h('div', { class: 'grid2' },
      h('label', { class: 'field' }, 'Von', h('input', { type: 'date', value: ui.from, onchange: (e) => update((s) => { s.ui.from = e.target.value; }) })),
      h('label', { class: 'field' }, 'Bis', h('input', { type: 'date', value: ui.to, onchange: (e) => update((s) => { s.ui.to = e.target.value; }) })),
    ) : null,
  );
}

function rulesCard() {
  const segment = state.split.mode === 'segment';
  return h('section', { class: 'card' },
    h('h2', {}, 'Aufteilungsregel'),
    h('div', { class: 'segmented' },
      h('button', { type: 'button', class: segment ? 'active' : '', onclick: () => update((s) => { s.split.mode = 'segment'; }) }, 'Nach Teilstrecken (fair)'),
      h('button', { type: 'button', class: !segment ? 'active' : '', onclick: () => update((s) => { s.split.mode = 'equal'; }) }, 'Gleich pro Fahrt'),
    ),
    h('p', { class: 'hint' }, segment
      ? 'Jede Teilstrecke wird nur unter denen aufgeteilt, die auf ihr im Auto sitzen. Wer nur hin- oder nur zurückfährt oder erst am Zwischenstopp zusteigt, zahlt nur seine Kilometer.'
      : 'Die Kosten einer Fahrt werden gleichmäßig auf alle verteilt, die bei dieser Fahrt irgendwo dabei sind – egal ab welchem Stopp.'),
    h('label', { class: 'check' },
      h('input', { type: 'checkbox', checked: state.split.driverPays, onchange: (e) => update((s) => { s.split.driverPays = e.target.checked; }) }),
      ' Fahrer zahlt seinen Anteil mit'),
    h('p', { class: 'hint small' }, state.split.driverPays
      ? 'Der Fahrer wird wie alle anderen mitgerechnet (üblich, wenn sich alle das Fahren teilen oder der Fahrer den Weg sowieso hätte).'
      : 'Die Mitfahrer übernehmen die kompletten Kosten, der Fahrer fährt „kostenlos“ (z. B. als Ausgleich für Fahrzeit und Verschleiß).'),
  );
}

/** Werte aus allen Wochen im Zeitraum: einzelner Wert oder Spanne "a – b". */
function spread(values, fmt) {
  const u = [...new Set(values)].sort((a, b) => a - b);
  if (!u.length) return '–';
  return u.length === 1 ? fmt(u[0]) : `${fmt(u[0])} – ${fmt(u[u.length - 1])}`;
}

const fmtDec = (v) => String(Math.round(v * 100) / 100).replace('.', ',');

function valuesCard(entries, agg) {
  const snaps = [...new Set(entries.map((e) => e.snap))];
  const extraOn = state.split.includeExtra !== false;
  const extraAll = agg.extraCost + agg.extraExcluded;
  const varies = ['consumption', 'price', 'extraPerKm'].some((k) => new Set(snaps.map((s) => s[k])).size > 1);
  const row = (label, value, note) => h('tr', {}, h('td', {}, label), h('td', {}, h('strong', {}, value), note ? h('div', { class: 'muted small' }, note) : null));

  return h('section', { class: 'card' },
    h('h2', {}, 'Alle Werte im Überblick'),
    h('table', { class: 'table values' }, h('tbody', {},
      row('Kraftstoff', [...new Set(snaps.map((s) => FUELS[s.fuel]?.label || s.fuel))].join(', ')),
      row('Verbrauch', `${spread(snaps.map((s) => s.consumption), fmtDec)} l/100 km`),
      row('Spritpreis pro Liter', spread(snaps.map((s) => s.price), fmtPrice),
        agg.liters > 0 && new Set(snaps.map((s) => s.price)).size > 1 ? `ø ${fmtPrice(agg.fuelCost / agg.liters)} (gewichtet nach Litern)` : null),
      row('Nebenkosten pro km', snaps.some((s) => s.extraPerKm > 0) ? `${spread(snaps.map((s) => s.extraPerKm), fmtDec)} ct/km` : 'keine'),
      row('Einfache Strecke', spread(snaps.map((s) => Math.round(s.legs.reduce((a, l) => a + l.km, 0) * 10) / 10), fmtKm)),
      row('Gefahren', fmtKm(agg.km), `${agg.trips.length} Fahrten`),
      row('Verbrauchte Liter', fmtL(agg.liters)),
      row('Spritkosten', fmtEuro(agg.fuelCost)),
      row('Nebenkosten', fmtEuro(extraAll), extraAll > 0 && !extraOn ? 'ausgeschaltet – nicht in der Abrechnung' : null),
      row('Kosten pro km', agg.km ? `${fmtDec((agg.total / agg.km) * 100)} ct` : '–'),
      row('ø pro Fahrt', agg.trips.length ? fmtEuro(agg.total / agg.trips.length) : '–'),
      h('tr', { class: 'total' }, h('td', {}, 'Abgerechnet'), h('td', {}, h('strong', {}, fmtEuro(agg.total)))),
    )),
    varies ? h('p', { class: 'hint small' }, 'Die Werte unterscheiden sich zwischen den Wochen im Zeitraum – jede Woche wird mit ihren eigenen Werten abgerechnet.') : null,
    h('label', { class: 'switch-row' },
      h('span', {},
        h('strong', {}, 'Nebenkosten abrechnen'),
        h('div', { class: 'muted small' }, extraAll > 0
          ? `Verschleiß & Co.: ${fmtEuro(extraAll)} in diesem Zeitraum`
          : 'Im Zeitraum sind keine Nebenkosten eingetragen (Tab „Auto & Sprit“ → „Weitere Kosten pro km“).')),
      h('input', {
        type: 'checkbox', class: 'switch', role: 'switch', checked: extraOn,
        onchange: (e) => update((s) => { s.split.includeExtra = e.target.checked; }),
      }),
    ),
  );
}

const copy = async (text, msg) => {
  try { await navigator.clipboard.writeText(text); toast(msg, 'ok'); } catch { prompt('Kopieren:', text); }
};

const weekLabel = (monday) => `KW ${isoWeek(monday).week} (${fmtDate(monday)} – ${fmtDate(addDays(monday, 6))})`;

function goToPaypalSettings() {
  payUi.open = true;
  update((s) => { s.ui.tab = 'trips'; });
  setTimeout(() => document.getElementById('pay-settings')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
}

/** Nachricht + PayPal-Link-Knöpfe für eine Zahlung (eine oder mehrere Wochen). */
function payButtons(fromId, toId, items) {
  const pp = paypalUser(personById(toId)?.paypal);
  const total = Math.round(items.reduce((a, x) => a + x.amount, 0) * 100) / 100;
  const message = paymentMessage({ fromName: nameOf(fromId), toName: nameOf(toId), items, paypal: pp });
  return [
    h('button', { type: 'button', class: 'btn btn-small btn-primary', disabled: !items.length, onclick: () => copy(message, 'Nachricht kopiert – jetzt z. B. in WhatsApp einfügen') }, '📋 Nachricht kopieren'),
    pp
      ? h('button', { type: 'button', class: 'btn btn-small btn-pp', disabled: !items.length, onclick: () => copy(paypalLink(pp, total), 'PayPal-Link kopiert') }, '🅿️ PayPal-Link kopieren')
      : h('button', { type: 'button', class: 'link', onclick: goToPaypalSettings }, `PayPal von ${nameOf(toId)} hinterlegen`),
  ];
}

/** Eine Ausgleichszahlung im gewählten Zeitraum. Bei Wochenansicht mit Abhaken. */
function transferRow(t, range, agg) {
  const from = personById(t.from);
  const to = personById(t.to);
  const x = agg.persons[t.from];
  const week = state.ui.period === 'week' ? state.ui.week : null;
  const key = week && payKey(week, t.from, t.to);
  const paid = key && state.payments[key];
  return h('li', { class: paid ? 'is-paid' : '' },
    h('span', { class: 'who', style: { color: from?.color } }, nameOf(t.from)),
    h('span', { class: 'arrow' }, '→'),
    h('span', { class: 'who', style: { color: to?.color } }, nameOf(t.to)),
    paid ? h('span', { class: 'badge-paid' }, '✓ bezahlt') : null,
    h('strong', {}, fmtEuro(t.amount)),
    h('div', { class: 'pay-actions' },
      paid ? null : payButtons(t.from, t.to, [{ label: range.label === 'Alle Fahrten' ? 'alle Fahrten' : range.label, amount: t.amount, details: x ? `${x.trips} Fahrten, ${fmtKm(x.km)}` : '' }]),
      key ? h('button', {
        type: 'button', class: `btn btn-small ${paid ? 'btn-ghost' : 'btn-paid'}`,
        onclick: () => update((s) => {
          if (paid) delete s.payments[key];
          else s.payments[key] = { amount: t.amount, at: Date.now() };
        }),
      }, paid ? '↺ Doch nicht bezahlt' : '✓ Bezahlt') : null,
    ),
  );
}

// ---------- Offene Beträge über alle Wochen ----------

const deselected = new Set(); // abgewählte Wochen (Standard: alle offenen ausgewählt)

function openCard() {
  const items = withPayments(weeklyDebts(state.weeks, state.split, state.roundTrip), state.payments);
  if (!items.length) return null;
  const pairs = openByPair(items);
  const paidItems = items.filter((d) => d.open <= 0).sort((a, b) => b.week.localeCompare(a.week));

  return h('section', { class: 'card' },
    h('h2', {}, '💰 Offene Beträge'),
    pairs.length
      ? h('p', { class: 'hint small' }, 'Alle Wochen, die noch nicht als bezahlt abgehakt sind. Wähle aus, welche Wochen in die Nachricht sollen – z. B. wenn jemand eine Woche vergessen hat.')
      : h('p', {}, 'Alles bezahlt 🎉'),
    pairs.map((pair) => {
      const selected = pair.items.filter((d) => !deselected.has(d.key));
      const selTotal = Math.round(selected.reduce((a, d) => a + d.open, 0) * 100) / 100;
      const msgItems = selected.map((d) => ({
        label: weekLabel(d.week),
        amount: d.open,
        details: d.paid > 0 ? `Rest, ${fmtEuro(d.paid)} schon bezahlt` : `${d.trips} Fahrten, ${fmtKm(d.km)}`,
      }));
      return h('div', { class: 'debt' },
        h('div', { class: 'debt-head' },
          h('span', { class: 'who', style: { color: personById(pair.from)?.color } }, nameOf(pair.from)),
          h('span', { class: 'arrow muted' }, '→'),
          h('span', { class: 'who', style: { color: personById(pair.to)?.color } }, nameOf(pair.to)),
          h('strong', {}, fmtEuro(pair.total))),
        h('ul', { class: 'debt-weeks' }, pair.items.map((d) => h('li', {}, h('label', {},
          h('input', {
            type: 'checkbox', checked: !deselected.has(d.key),
            onchange: (e) => { if (e.target.checked) deselected.delete(d.key); else deselected.add(d.key); update(() => {}); },
          }),
          h('span', { class: 'w-label' }, weekLabel(d.week),
            h('small', {}, d.paid > 0 ? `${fmtEuro(d.paid)} schon bezahlt – Woche hat sich danach geändert` : `${d.trips} Fahrten · ${fmtKm(d.km)}`)),
          h('strong', {}, fmtEuro(d.open)))))),
        h('div', { class: 'muted small' }, `Ausgewählt: ${selected.length} ${selected.length === 1 ? 'Woche' : 'Wochen'} · ${fmtEuro(selTotal)}`),
        h('div', { class: 'pay-actions' },
          payButtons(pair.from, pair.to, msgItems),
          h('button', {
            type: 'button', class: 'btn btn-small btn-paid', disabled: !selected.length,
            onclick: () => {
              for (const d of pair.items) deselected.delete(d.key); // übrige offene Wochen wieder auswählen
              update((s) => { s.payments = markPaid(s.payments, selected); });
              toast(`${nameOf(pair.from)}: ${fmtEuro(selTotal)} als bezahlt abgehakt`, 'ok');
            },
          }, '✓ Als bezahlt abhaken'),
        ),
      );
    }),
    paidItems.length ? h('details', { class: 'more' },
      h('summary', {}, `Bereits bezahlt (${paidItems.length})`),
      h('ul', { class: 'paid-list' }, paidItems.map((d) => h('li', {},
        h('span', {}, `${nameOf(d.from)} → ${nameOf(d.to)} · ${weekLabel(d.week)}`),
        h('span', { class: 'muted' }, `${fmtEuro(d.paid)}${d.paidAt ? ` am ${new Date(d.paidAt).toLocaleDateString('de-DE')}` : ''}`),
        h('button', { type: 'button', class: 'link', onclick: () => update((s) => { delete s.payments[d.key]; }) }, 'rückgängig'),
      ))),
    ) : null,
  );
}

function shareText(range, agg, transfers) {
  const lines = [`⛽ Tankkosten ${range.label}`, `Gesamt: ${fmtEuro(agg.total)} (${fmtKm(agg.km)}, ${agg.trips.length} Fahrten)`];
  if (agg.extraCost > 0) lines.push(`davon Sprit ${fmtEuro(agg.fuelCost)}, Nebenkosten ${fmtEuro(agg.extraCost)}`);
  else if (agg.extraExcluded > 0) lines.push('(ohne Nebenkosten)');
  lines.push('');
  for (const p of state.persons) {
    const x = agg.persons[p.id];
    if (x) lines.push(`${p.name}: ${fmtEuro(x.share)} (${fmtKm(x.km)})`);
  }
  if (transfers.length) {
    lines.push('', 'Ausgleich:');
    for (const t of transfers) {
      const link = paypalLink(personById(t.to)?.paypal, t.amount);
      lines.push(`${nameOf(t.from)} → ${nameOf(t.to)}: ${fmtEuro(t.amount)}${link ? `\n   PayPal (Freunde & Familie): ${link}` : ''}`);
    }
  }
  return lines.join('\n');
}

function detailsCard(agg) {
  const byDate = new Map();
  for (const t of agg.trips) {
    if (!byDate.has(t.date)) byDate.set(t.date, []);
    byDate.get(t.date).push(t);
  }
  return h('section', { class: 'card' },
    h('h2', {}, 'Einzelne Fahrten'),
    [...byDate.entries()].map(([date, trips]) => h('details', { class: 'day-detail' },
      h('summary', {}, h('span', {}, fmtDate(date, { weekday: true })), h('strong', {}, fmtEuro(trips.reduce((a, t) => a + t.result.total, 0)))),
      trips.map((t) => h('div', { class: 'trip-detail' },
        h('div', { class: 'row between' },
          h('strong', {}, t.direction === 'hin' ? '➜ Hinfahrt' : '⟲ Rückfahrt'),
          h('span', { class: 'muted' }, `🚗 ${nameOf(t.trip.driver)} · ${fmtKm(t.result.km)} · ${fmtEuro(t.result.total)}`)),
        h('ul', { class: 'leg-list' }, t.result.legs.map((l) => {
          return h('li', {},
            h('span', {}, `${l.from} → ${l.to} `, h('small', { class: 'muted' }, `${t.result.estimated ? '≈ ' : ''}${fmtKm(l.km)}`)),
            h('span', { class: 'muted' }, `${fmtEuro(l.cost)} ÷ ${l.payers.length} = ${fmtEuro(l.per)} für ${l.payers.map(nameOf).join(', ')}`));
        })),
      )),
    )),
  );
}

export function renderBillTab(el) {
  const range = periodRange();
  const entries = collectEntries(range.from, range.to);
  const open = openCard();
  if (open) el.append(open);
  el.append(periodCard(range));

  if (!entries.length) {
    el.append(h('section', { class: 'card empty-state' },
      h('div', { class: 'big-icon' }, '🧾'),
      h('p', {}, 'In diesem Zeitraum sind noch keine Fahrten eingetragen.'),
      h('button', { type: 'button', class: 'btn btn-primary', onclick: () => update((s) => { s.ui.tab = 'trips'; }) }, 'Fahrten eintragen'),
    ), rulesCard());
    return;
  }

  const agg = aggregate(entries, state.split);
  const transfers = settle(agg.persons);
  const people = Object.keys(agg.persons).map((id) => ({ id, p: personById(id) || { name: 'Unbekannt', color: '#999' }, x: agg.persons[id] }))
    .sort((a, b) => b.x.share - a.x.share);
  const maxShare = Math.max(...people.map((q) => q.x.share), 0.01);

  el.append(
    h('section', { class: 'card' },
      h('div', { class: 'stats' },
        stat('Gesamtkosten', fmtEuro(agg.total), agg.extraCost > 0 ? `Sprit ${fmtEuro(agg.fuelCost)} · Nebenkosten ${fmtEuro(agg.extraCost)}` : agg.extraExcluded > 0 ? 'ohne Nebenkosten' : null),
        stat('Gefahren', fmtKm(agg.km), `${agg.trips.length} Fahrten`),
        stat('Verbraucht', fmtL(agg.liters)),
      ),
    ),
    h('section', { class: 'card' },
      h('h2', {}, 'Wer zahlt wie viel?'),
      h('div', { class: 'share-bars' }, people.map(({ id, p, x }) => h('div', { class: 'share-row', style: { '--pc': p.color } },
        h('div', { class: 'share-name' }, h('span', { class: 'dot' }), p.name),
        h('div', { class: 'share-bar' }, h('div', { class: 'share-fill', style: { width: `${(x.share / maxShare) * 100}%` } })),
        h('div', { class: 'share-amount' }, fmtEuro(x.share)),
        h('div', { class: 'share-meta muted' }, `${x.trips} Fahrten · ${fmtKm(x.km)}${x.min ? ` · ${fmtDuration(x.min * 60)} im Auto` : ''}${x.paid ? ` · hat ${fmtEuro(x.paid)} ausgelegt (als Fahrer)` : ''}`),
      ))),
    ),
    h('section', { class: 'card' },
      h('h2', {}, 'Ausgleich'),
      transfers.length
        ? h('ul', { class: 'transfers' }, transfers.map((t) => transferRow(t, range, agg)))
        : h('p', {}, 'Alles ausgeglichen 🎉'),
      h('p', { class: 'hint small' }, state.ui.period === 'week'
        ? 'Annahme: Wer fährt, bezahlt auch den Sprit für diese Fahrt. Wechselt ihr euch ab, wird hier automatisch verrechnet.'
        : 'Annahme: Wer fährt, bezahlt auch den Sprit. Abhaken, was bezahlt ist, geht wochenweise – oben unter „Offene Beträge“ oder in der Wochenansicht.'),
      h('div', { class: 'row gap wrap' },
        h('button', {
          type: 'button', class: 'btn btn-primary',
          onclick: async () => {
            const text = shareText(range, agg, transfers);
            try { await navigator.clipboard.writeText(text); toast('Text kopiert – z. B. in WhatsApp einfügen', 'ok'); } catch { prompt('Text kopieren:', text); }
          },
        }, '📋 Als Text kopieren'),
        navigator.share ? h('button', { type: 'button', class: 'btn', onclick: () => navigator.share({ text: shareText(range, agg, transfers) }).catch(() => {}) }, '↗ Teilen') : null,
        h('button', { type: 'button', class: 'btn btn-ghost', onclick: () => window.print() }, '🖨 Drucken'),
      ),
    ),
    rulesCard(),
    detailsCard(agg),
    valuesCard(entries, agg),
  );
}
