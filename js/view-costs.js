// Ansicht „Kosten“: einfach (offene Beträge, bezahlen) – auf Wunsch mit allen Details.
import { state, update, personById, todayIso, liveSnap } from './state.js';
import { aggregate, settle, addDays, isoWeek, mondayOf, toISODate, FUELS } from './calc.js';
import { isAdmin } from './account.js';
import { me, markPaid, adminSet } from './actions.js';
import { debtItems, entries, weekLabel, forecast } from './derived.js';
import { openByPair } from './debts.js';
import { paymentMessage, paypalLink, paypalUser } from './pay.js';
import { settingsUi } from './view-settings.js';
import { h, stat, fmtEuro, fmtKm, fmtL, fmtDate, fmtPrice, toast } from './ui.js';
import { icon } from './icons.js';

const nameOf = (id) => personById(id)?.name || 'Unbekannt';
const deselected = new Set();
const safe = (fn) => { try { fn(); } catch (e) { toast(e.message, 'error'); } };
const copy = async (text, msg) => { try { await navigator.clipboard.writeText(text); toast(msg, 'ok'); } catch { prompt('Kopieren:', text); } };

// ---------- Wie berechnet? (für eine Woche und eine Person) ----------

function weekBreakdown(pid, monday) {
  const list = entries(monday, addDays(monday, 6)).filter((e) => e.trip.legs.some((l) => l.includes(pid)) || e.trip.driver === pid);
  if (!list.length) return h('p', { class: 'hint small' }, 'Keine Fahrten.');
  const agg = aggregate(list, state.split);
  return h('div', { class: 'breakdown' },
    agg.trips.map((t) => h('div', { class: 'bd-row' },
      h('span', {}, `${fmtDate(t.date, { weekday: true })} ${t.direction === 'hin' ? 'Hin' : 'Zurück'}`),
      h('span', { class: 'muted' }, `${String(Math.round((t.result.kmPerPerson[pid] || 0) * 10) / 10).replace('.', ',')} km von ${String(Math.round(t.result.km * 10) / 10).replace('.', ',')} km`),
      h('strong', {}, fmtEuro(t.result.shares[pid] || 0)))),
    h('p', { class: 'hint small' }, `Gerechnet mit ${fmtPrice(list[0].snap.price)}/l und ${String(list[0].snap.consumption).replace('.', ',')} l/100 km. Jede Teilstrecke wird unter denen geteilt, die dort im Auto sitzen – du zahlst ab deiner Adresse.`),
  );
}

// ---------- Offene Beträge ----------

const openDetails = new Set(); // aufgeklappte „Wie berechnet?“

function debtCard(pair, mine) {
  const selected = pair.items.filter((d) => !deselected.has(d.key));
  const total = Math.round(selected.reduce((a, d) => a + d.open, 0) * 100) / 100;
  const to = personById(pair.to);
  const pp = paypalUser(to?.paypal);
  const iAmDebtor = pair.from === mine;
  const canMark = isAdmin() || pair.from === mine || pair.to === mine;
  const msgItems = selected.map((d) => ({ label: weekLabel(d.week), amount: d.open, details: d.paid > 0 ? `Rest, ${fmtEuro(d.paid)} schon bezahlt` : `${d.trips} Fahrten, ${fmtKm(d.km)}` }));
  return h('div', { class: `debt ${iAmDebtor || pair.to === mine ? 'mine' : ''}` },
    h('div', { class: 'debt-head' },
      h('span', { class: 'who', style: { color: personById(pair.from)?.color } }, iAmDebtor ? 'Du' : nameOf(pair.from)),
      h('span', { class: 'arrow muted' }, '→'),
      h('span', { class: 'who', style: { color: to?.color } }, pair.to === mine ? 'dich' : nameOf(pair.to)),
      h('strong', {}, fmtEuro(pair.total))),
    h('ul', { class: 'debt-weeks' }, pair.items.map((d) => h('li', {},
      h('label', {},
        pair.items.length > 1 ? h('input', { type: 'checkbox', checked: !deselected.has(d.key), onchange: (e) => { if (e.target.checked) deselected.delete(d.key); else deselected.add(d.key); update(() => {}); } }) : null,
        h('span', { class: 'w-label' }, weekLabel(d.week), h('small', {}, d.paid > 0 ? `${fmtEuro(d.paid)} schon bezahlt – Woche hat sich danach geändert` : `${d.trips} Fahrten · ${fmtKm(d.km)}`)),
        h('strong', {}, fmtEuro(d.open))),
      h('button', {
        type: 'button', class: 'link small', style: { padding: '0 .6rem .35rem' },
        onclick: () => { const k = `${d.key}`; openDetails.has(k) ? openDetails.delete(k) : openDetails.add(k); update(() => {}); },
      }, openDetails.has(d.key) ? 'Berechnung ausblenden' : 'Wie berechnet?'),
      openDetails.has(d.key) ? weekBreakdown(pair.from, d.week) : null,
    ))),
    h('div', { class: 'pay-actions' },
      iAmDebtor && pp ? h('a', { class: 'btn btn-small btn-pp', href: paypalLink(pp, total), target: '_blank', rel: 'noopener' }, icon('wallet', { size: 15 }), `${fmtEuro(total)} mit PayPal zahlen`) : null,
      iAmDebtor && !pp ? h('span', { class: 'muted small' }, `${to?.name} hat noch kein PayPal hinterlegt.`) : null,
      !iAmDebtor ? h('button', { type: 'button', class: 'btn btn-small', disabled: !selected.length, onclick: () => copy(paymentMessage({ fromName: nameOf(pair.from), toName: nameOf(pair.to), items: msgItems, paypal: pp }), 'Nachricht kopiert – jetzt z. B. in WhatsApp einfügen') }, icon('copy', { size: 15 }), 'Nachricht kopieren') : null,
      !iAmDebtor && pp ? h('button', { type: 'button', class: 'btn btn-small btn-pp', disabled: !selected.length, onclick: () => copy(paypalLink(pp, total), 'PayPal-Link kopiert') }, icon('link', { size: 15 }), 'PayPal-Link') : null,
      canMark ? h('button', {
        type: 'button', class: 'btn btn-small btn-paid', disabled: !selected.length,
        onclick: () => safe(() => { for (const d of pair.items) deselected.delete(d.key); markPaid(selected, true); toast(`${fmtEuro(total)} als bezahlt markiert`, 'ok'); }),
      }, icon('check', { size: 15 }), iAmDebtor ? 'Ich habe bezahlt' : 'Als bezahlt markieren') : null,
    ),
    pair.to === mine && !pp ? h('button', { type: 'button', class: 'link small', onclick: () => { settingsUi.focus = 'paypal'; update((s) => { s.ui.tab = 'settings'; }); } }, 'PayPal hinterlegen, damit man dir direkt zahlen kann') : null,
  );
}

function openCard(mine) {
  const items = debtItems();
  let pairs = openByPair(items);
  const admin = isAdmin();
  if (!admin) pairs = pairs.filter((p) => p.from === mine || p.to === mine);
  pairs.sort((a, b) => Number(b.from === mine || b.to === mine) - Number(a.from === mine || a.to === mine));
  const paid = items.filter((d) => d.open <= 0 && d.paid > 0 && (admin || d.from === mine || d.to === mine)).sort((a, b) => b.week.localeCompare(a.week));
  return h('section', { class: 'card' },
    h('h2', {}, admin ? 'Offene Beträge' : 'Deine offenen Beträge'),
    pairs.length ? pairs.map((p) => debtCard(p, mine)) : h('p', { class: 'callout good' }, 'Alles bezahlt – nichts offen.'),
    paid.length ? h('details', { class: 'more' },
      h('summary', {}, `Bereits bezahlt (${paid.length})`),
      h('ul', { class: 'paid-list' }, paid.map((d) => h('li', {},
        h('span', {}, `${d.from === mine ? 'Du' : nameOf(d.from)} → ${nameOf(d.to)} · ${weekLabel(d.week)}`),
        h('span', { class: 'muted' }, `${fmtEuro(d.paid)}${d.paidAt ? ` am ${new Date(d.paidAt).toLocaleDateString('de-DE')}` : ''}`),
        (admin || d.from === mine || d.to === mine) ? h('button', { type: 'button', class: 'link', onclick: () => safe(() => markPaid([d], false)) }, 'zurücknehmen') : null,
      ))),
    ) : null,
    h('p', { class: 'hint small' }, 'Geplante Fahrten werden erst ab dem Tag der Fahrt fällig.'),
  );
}

// ---------- Details (Einstellung „Detailliert“) ----------

function periodRange() {
  const ui = state.ui;
  if (ui.period === 'week' || !ui.period) return { from: ui.week, to: addDays(ui.week, 6), label: weekLabel(ui.week) };
  if (ui.period === 'month') {
    const [y, m] = ui.week.split('-').map(Number);
    return { from: `${y}-${String(m).padStart(2, '0')}-01`, to: toISODate(new Date(y, m, 0)), label: new Date(y, m - 1, 1).toLocaleDateString('de-DE', { month: 'long', year: 'numeric' }) };
  }
  return { from: '0000-01-01', to: '9999-12-31', label: 'Alle Fahrten' };
}

function periodCard(range) {
  const ui = state.ui;
  const step = ui.period === 'month' ? 'm' : ui.period === 'all' ? null : 'w';
  const nav = (dir) => update((s) => {
    if (step === 'w') s.ui.week = addDays(s.ui.week, dir * 7);
    else { const [y, m] = s.ui.week.split('-').map(Number); s.ui.week = mondayOf(toISODate(new Date(y, m - 1 + dir, 15))); }
  });
  return h('section', { class: 'card' },
    h('div', { class: 'segmented' }, [['week', 'Woche'], ['month', 'Monat'], ['all', 'Alles']].map(([p, l]) => h('button', {
      type: 'button', class: (ui.period || 'week') === p ? 'active' : '', onclick: () => update((s) => { s.ui.period = p; }),
    }, l))),
    h('div', { class: 'week-nav' },
      step ? h('button', { type: 'button', class: 'icon-btn big', 'aria-label': 'Zurück', onclick: () => nav(-1) }, icon('chevron-left', { size: 22 })) : null,
      h('div', { class: 'week-title' }, h('strong', {}, range.label)),
      step ? h('button', { type: 'button', class: 'icon-btn big', 'aria-label': 'Weiter', onclick: () => nav(1) }, icon('chevron-right', { size: 22 })) : null),
  );
}

const fmtDec = (v) => String(Math.round(v * 100) / 100).replace('.', ',');
function spread(values, fmt) {
  const u = [...new Set(values)].sort((a, b) => a - b);
  if (!u.length) return '–';
  return u.length === 1 ? fmt(u[0]) : `${fmt(u[0])} – ${fmt(u[u.length - 1])}`;
}

function valuesCard(list, agg) {
  const snaps = [...new Set(list.map((e) => e.snap))];
  const extraAll = agg.extraCost + agg.extraExcluded;
  const row = (label, value, note) => h('tr', {}, h('td', {}, label), h('td', {}, h('strong', {}, value), note ? h('div', { class: 'muted small' }, note) : null));
  return h('section', { class: 'card' },
    h('h2', {}, 'Alle Werte'),
    h('table', { class: 'table values' }, h('tbody', {},
      row('Kraftstoff', [...new Set(snaps.map((s) => FUELS[s.fuel]?.label || s.fuel))].join(', ')),
      row('Verbrauch', `${spread(snaps.map((s) => s.consumption), fmtDec)} l/100 km`),
      row('Spritpreis pro Liter', spread(snaps.map((s) => s.price), fmtPrice), agg.liters > 0 && new Set(snaps.map((s) => s.price)).size > 1 ? `ø ${fmtPrice(agg.fuelCost / agg.liters)}` : null),
      row('Nebenkosten pro km', snaps.some((s) => s.extraPerKm > 0) ? `${spread(snaps.map((s) => s.extraPerKm), fmtDec)} ct/km` : 'keine'),
      row('Gefahren', fmtKm(agg.km), `${agg.trips.length} Fahrten · ø ${fmtKm(agg.trips.length ? agg.km / agg.trips.length : 0)}`),
      row('Verbrauchte Liter', fmtL(agg.liters)),
      row('Spritkosten', fmtEuro(agg.fuelCost)),
      row('Nebenkosten', fmtEuro(extraAll), extraAll > 0 && state.split.includeExtra === false ? 'ausgeschaltet – nicht in der Abrechnung' : null),
      row('Kosten pro km', agg.km ? `${fmtDec((agg.total / agg.km) * 100)} ct` : '–'),
      h('tr', { class: 'total' }, h('td', {}, 'Abgerechnet'), h('td', {}, h('strong', {}, fmtEuro(agg.total)))),
    )),
  );
}

function detailsCard(agg) {
  const byDate = new Map();
  for (const t of agg.trips) { if (!byDate.has(t.date)) byDate.set(t.date, []); byDate.get(t.date).push(t); }
  return h('section', { class: 'card' },
    h('h2', {}, 'Einzelne Fahrten'),
    [...byDate.entries()].map(([date, trips]) => h('details', { class: 'day-detail' },
      h('summary', {}, h('span', {}, fmtDate(date, { weekday: true })), h('strong', {}, fmtEuro(trips.reduce((a, t) => a + t.result.total, 0)))),
      trips.map((t) => h('div', { class: 'trip-detail' },
        h('div', { class: 'row between' },
          h('strong', {}, t.direction === 'hin' ? 'Hinfahrt' : 'Rückfahrt'),
          h('span', { class: 'muted' }, `Fahrer: ${nameOf(t.trip.driver)} · ${fmtKm(t.result.km)} · ${fmtEuro(t.result.total)}`)),
        h('ul', { class: 'leg-list' }, t.result.legs.map((l) => h('li', {},
          h('span', {}, `${l.from} → ${l.to} `, h('small', { class: 'muted' }, `${t.result.estimated ? '≈ ' : ''}${fmtKm(l.km)}`)),
          h('span', { class: 'muted' }, `${fmtEuro(l.cost)} ÷ ${l.payers.length} = ${fmtEuro(l.per)} für ${l.payers.map(nameOf).join(', ')}`)))),
      )),
    )),
  );
}

function detailed(el) {
  const range = periodRange();
  const list = entries(range.from, range.to);
  el.append(periodCard(range));
  if (!list.length) { el.append(h('section', { class: 'card' }, h('p', { class: 'hint' }, 'In diesem Zeitraum gab es (bis heute) keine Fahrten.'))); return; }
  const agg = aggregate(list, state.split);
  const people = Object.entries(agg.persons).sort((a, b) => b[1].share - a[1].share);
  const max = Math.max(...people.map(([, x]) => x.share), 0.01);
  const transfers = settle(agg.persons);
  el.append(
    h('section', { class: 'card' }, h('div', { class: 'stats' },
      stat('Gesamt', fmtEuro(agg.total), agg.extraCost > 0 ? `Sprit ${fmtEuro(agg.fuelCost)} · Nebenkosten ${fmtEuro(agg.extraCost)}` : null),
      stat('Gefahren', fmtKm(agg.km), `${agg.trips.length} Fahrten`),
      stat('Verbraucht', fmtL(agg.liters)))),
    h('section', { class: 'card' },
      h('h2', {}, 'Anteile'),
      h('div', { class: 'share-bars' }, people.map(([id, x]) => h('div', { class: 'share-row', style: { '--pc': personById(id)?.color || '#999' } },
        h('div', { class: 'share-name' }, h('span', { class: 'dot' }), nameOf(id)),
        h('div', { class: 'share-bar' }, h('div', { class: 'share-fill', style: { width: `${(x.share / max) * 100}%` } })),
        h('div', { class: 'share-amount' }, fmtEuro(x.share)),
        h('div', { class: 'share-meta muted' }, `${x.trips} Fahrten · ${fmtKm(x.km)}${x.paid ? ` · hat ${fmtEuro(x.paid)} ausgelegt` : ''}`)))),
      transfers.length ? h('ul', { class: 'transfers' }, transfers.map((t) => h('li', {},
        h('span', { class: 'who', style: { color: personById(t.from)?.color } }, nameOf(t.from)), h('span', { class: 'arrow' }, '→'),
        h('span', { class: 'who', style: { color: personById(t.to)?.color } }, nameOf(t.to)), h('strong', {}, fmtEuro(t.amount))))) : null),
    valuesCard(list, agg),
    detailsCard(agg),
  );
}

// ---------- Prognose ----------

function forecastCard(mine) {
  const admin = isAdmin();
  const list = forecast(state.ui.forecastWeeks || 5);
  const snap = liveSnap();
  const kw = (m) => `KW ${isoWeek(m).week}`;
  const range = (m) => `${fmtDate(m)} – ${fmtDate(addDays(m, 6))}`;
  const thisWeek = mondayOf(todayIso());
  const label = (w) => (w.monday === thisWeek ? 'Diese Woche' : w.monday === addDays(thisWeek, 7) ? 'Nächste Woche' : kw(w.monday));
  const rows = list.map((w) => {
    const persons = Object.entries(w.persons).sort((a, b) => b[1].share - a[1].share);
    if (admin) {
      return h('div', { class: 'list-row fc-row' },
        h('div', { class: 'row between' },
          h('span', {}, h('strong', {}, label(w)), h('span', { class: 'muted small' }, ` · ${range(w.monday)}`)),
          h('strong', {}, w.trips ? `≈ ${fmtEuro(w.total)}` : '–')),
        w.trips ? h('div', { class: 'fc-people' }, persons.map(([pid, x]) => h('span', { class: 'fc-person', style: { '--pc': personById(pid)?.color || 'var(--gray)' } },
          h('span', { class: 'dot' }), `${nameOf(pid)} ${fmtEuro(x.share)}`, h('span', { class: 'muted' }, ` · ${x.trips}×`)))) : h('span', { class: 'muted small' }, 'Keine Fahrten geplant'));
    }
    const x = w.persons[mine];
    const d = w.drivers[mine];
    return h('div', { class: 'list-row fc-row' },
      h('div', { class: 'row between' },
        h('span', {}, h('strong', {}, label(w)), h('span', { class: 'muted small' }, ` · ${range(w.monday)}`)),
        h('strong', {}, x ? `≈ ${fmtEuro(x.share)}` : '–')),
      h('span', { class: 'muted small' }, [
        x ? `${x.trips} ${x.trips === 1 ? 'Fahrt' : 'Fahrten'}${x.done ? ` · davon ${fmtEuro(x.done)} schon gefahren` : ''}` : d ? '' : 'Du fährst nicht mit',
        d ? `${x ? ' · ' : ''}Du fährst ${d.trips}× – die anderen zahlen dir ≈ ${fmtEuro(d.income)}` : '',
      ].join('')));
  });
  const sum = admin ? list.reduce((a, w) => a + w.total, 0) : list.reduce((a, w) => a + (w.persons[mine]?.share || 0), 0);
  return h('section', { class: 'card' },
    h('div', { class: 'row between' }, h('h2', {}, 'Prognose'), h('span', { class: 'muted small' }, `${list.length} Wochen ${admin ? 'gesamt ' : ''}≈ ${fmtEuro(sum)}`)),
    h('p', { class: 'hint small' }, admin
      ? 'So teuer werden die kommenden Wochen, wenn alle wie eingeplant mitfahren (Regelplan + geänderte Tage). Pro Person nur, wer in der Woche wirklich mitfährt.'
      : 'So viel kosten dich die kommenden Wochen, wenn du wie eingeplant mitfährst.'),
    mine || admin ? h('div', { class: 'list' }, rows) : h('p', { class: 'hint' }, 'Wähle zuerst auf der Übersicht, wer du bist.'),
    h('div', { class: 'row between', style: { marginTop: '.5rem' } },
      h('span', { class: 'hint small', style: { margin: 0 } }, `Mit ${fmtPrice(snap.price)}/l und ${String(snap.consumption).replace('.', ',')} l/100 km – ändert sich der Spritpreis, ändert sich auch die Prognose.`),
      h('button', { type: 'button', class: 'btn btn-small', onclick: () => update((s) => { s.ui.forecastWeeks = (s.ui.forecastWeeks || 5) >= 9 ? 5 : 9; }) },
        (state.ui.forecastWeeks || 5) >= 9 ? 'Weniger' : 'Mehr Wochen')),
  );
}

// ---------- Aufteilungsregel (für die Einstellungen) ----------

export function rulesCard() {
  const segment = state.split.mode === 'segment';
  const set = (fn, text) => safe(() => adminSet(fn, text));
  return h('section', { class: 'card' },
    h('div', { class: 'segmented' },
      h('button', { type: 'button', class: segment ? 'active' : '', onclick: () => set((s) => { s.split.mode = 'segment'; }, 'Aufteilung: nach Teilstrecken') }, 'Nach Teilstrecken (fair)'),
      h('button', { type: 'button', class: !segment ? 'active' : '', onclick: () => set((s) => { s.split.mode = 'equal'; }, 'Aufteilung: gleich pro Fahrt') }, 'Gleich pro Fahrt')),
    h('p', { class: 'hint' }, segment
      ? 'Jede Teilstrecke wird unter denen geteilt, die dort im Auto sitzen: Wer später zusteigt oder früher aussteigt, zahlt weniger.'
      : 'Die Kosten einer Fahrt werden gleichmäßig auf alle verteilt, die dabei sind – egal ab wo.'),
    h('label', { class: 'switch-row' }, h('span', {}, 'Fahrer zahlt seinen Anteil mit'),
      h('input', { type: 'checkbox', class: 'switch', checked: state.split.driverPays, onchange: (e) => set((s) => { s.split.driverPays = e.target.checked; }, `Fahrer zahlt ${e.target.checked ? 'mit' : 'nicht mit'}`) })),
    h('label', { class: 'switch-row' }, h('span', {}, 'Nebenkosten (Verschleiß) abrechnen'),
      h('input', { type: 'checkbox', class: 'switch', checked: state.split.includeExtra !== false, onchange: (e) => set((s) => { s.split.includeExtra = e.target.checked; }, `Nebenkosten ${e.target.checked ? 'an' : 'aus'}`) })),
  );
}

export function renderCosts(el) {
  const mine = me();
  el.append(openCard(mine));
  el.append(forecastCard(mine));
  if (state.ui.detail === 'detailed') detailed(el);
  else el.append(h('button', { type: 'button', class: 'btn', style: { alignSelf: 'center' }, onclick: () => update((s) => { s.ui.detail = 'detailed'; }) }, icon('list-checks', { size: 17 }), 'Alle Details anzeigen'));
}
