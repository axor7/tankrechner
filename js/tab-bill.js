// Tab "Abrechnung": fair aufteilen, wer schuldet wem wie viel.
import { state, update, personById } from './state.js';
import { aggregate, settle, addDays, isoWeek, mondayOf, toISODate, DIRECTIONS, directedLegs } from './calc.js';
import { h, stat, fmtEuro, fmtKm, fmtL, fmtDate, toast } from './ui.js';

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

function shareText(range, agg, transfers) {
  const lines = [`⛽ Tankkosten ${range.label}`, `Gesamt: ${fmtEuro(agg.total)} (${fmtKm(agg.km)}, ${agg.trips.length} Fahrten)`, ''];
  for (const p of state.persons) {
    const x = agg.persons[p.id];
    if (x) lines.push(`${p.name}: ${fmtEuro(x.share)} (${fmtKm(x.km)})`);
  }
  if (transfers.length) {
    lines.push('', 'Ausgleich:');
    for (const t of transfers) lines.push(`${nameOf(t.from)} → ${nameOf(t.to)}: ${fmtEuro(t.amount)}`);
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
        h('ul', { class: 'leg-list' }, directedLegs(t.snap.legs, t.direction).map((leg) => {
          const l = t.result.legs[leg.legIndex];
          return h('li', {},
            h('span', {}, `${leg.from} → ${leg.to}`),
            h('span', { class: 'muted' }, `${fmtEuro(l.cost)} ÷ ${l.payers.length} = ${fmtEuro(l.per)} für ${l.payers.map(nameOf).join(', ')}`));
        })),
      )),
    )),
  );
}

export function renderBillTab(el) {
  const range = periodRange();
  const entries = collectEntries(range.from, range.to);
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
        stat('Gesamtkosten', fmtEuro(agg.total)),
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
        h('div', { class: 'share-meta muted' }, `${x.trips} Fahrten · ${fmtKm(x.km)}${x.paid ? ` · hat ${fmtEuro(x.paid)} getankt` : ''}`),
      ))),
    ),
    h('section', { class: 'card' },
      h('h2', {}, 'Ausgleich'),
      transfers.length
        ? h('ul', { class: 'transfers' }, transfers.map((t) => h('li', {},
          h('span', { class: 'who', style: { color: personById(t.from)?.color } }, nameOf(t.from)),
          h('span', { class: 'arrow' }, '→'),
          h('span', { class: 'who', style: { color: personById(t.to)?.color } }, nameOf(t.to)),
          h('strong', {}, fmtEuro(t.amount)))))
        : h('p', {}, 'Alles ausgeglichen 🎉'),
      h('p', { class: 'hint small' }, 'Annahme: Wer fährt, bezahlt auch den Sprit für diese Fahrt. Wechselt ihr euch ab, wird hier automatisch verrechnet.'),
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
  );
}
