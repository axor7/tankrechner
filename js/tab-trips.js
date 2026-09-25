// Tab "Fahrten": Mitfahrer verwalten und Wochenplan (wer fährt wann welche Teilstrecke mit).
import { state, update, getWeek, makeSnapshot, uid, COLORS, personById } from './state.js';
import { calcTrip, aggregate, directedLegs, weekDates, addDays, isoWeek, mondayOf, toISODate, DIRECTIONS, ridersOnLeg, weekdayIndex } from './calc.js';
import { h, chip, fmtEuro, fmtKm, fmtDate, fmtPrice, toast } from './ui.js';

const openLegs = new Set(); // aufgeklappte Teilstrecken-Editoren
const DIR_LABEL = { hin: 'Hinfahrt', rueck: 'Rückfahrt' };

// ---------- Personen ----------

function personsCard() {
  let newName = '';
  const add = () => {
    const name = newName.trim();
    if (!name) return;
    update((s) => {
      const used = new Set(s.persons.map((p) => p.color));
      const color = COLORS.find((c) => !used.has(c)) || COLORS[s.persons.length % COLORS.length];
      s.persons.push({ id: uid(), name, color });
    });
  };
  const remove = (p) => {
    const used = Object.values(state.weeks).some((w) => Object.values(w.days).some((d) => DIRECTIONS.some((dir) => d[dir] && (d[dir].driver === p.id || d[dir].legs.some((l) => l.includes(p.id))))));
    if (used && !confirm(`${p.name} kommt in gespeicherten Fahrten vor. Trotzdem löschen? Die Fahrten werden dann ohne ${p.name} neu berechnet.`)) return;
    update((s) => {
      s.persons = s.persons.filter((x) => x.id !== p.id);
      if (s.defaultDriver === p.id) s.defaultDriver = s.persons[0]?.id;
      for (const w of Object.values(s.weeks)) {
        for (const d of Object.values(w.days)) {
          for (const dir of DIRECTIONS) {
            const t = d[dir];
            if (!t) continue;
            t.legs = t.legs.map((l) => l.filter((id) => id !== p.id));
            if (t.driver === p.id) t.driver = s.defaultDriver;
          }
        }
      }
    });
  };

  return h('section', { class: 'card' },
    h('h2', {}, 'Mitfahrer'),
    h('div', { class: 'persons' }, state.persons.map((p) => h('div', { class: 'person', style: { '--pc': p.color } },
      h('input', { type: 'color', value: p.color, title: 'Farbe', onchange: (e) => update((s) => { personById(p.id).color = e.target.value; }) }),
      h('input', {
        type: 'text', value: p.name, 'aria-label': 'Name',
        onchange: (e) => update((s) => { personById(p.id).name = e.target.value.trim() || p.name; }),
      }),
      h('button', { type: 'button', class: 'icon-btn danger', title: 'Entfernen', disabled: state.persons.length < 2, onclick: () => remove(p) }, '✕'),
    ))),
    h('form', { class: 'row gap', onsubmit: (e) => { e.preventDefault(); add(); } },
      h('input', { type: 'text', placeholder: 'Name hinzufügen', oninput: (e) => { newName = e.target.value; }, 'data-focus-key': 'new-person' }),
      h('button', { type: 'submit', class: 'btn' }, '＋ Hinzufügen'),
    ),
    h('label', { class: 'field inline' }, '🚗 Wer fährt normalerweise (und bezahlt den Sprit)?',
      h('select', { onchange: (e) => update((s) => { s.defaultDriver = e.target.value; }) },
        state.persons.map((p) => h('option', { value: p.id, selected: p.id === state.defaultDriver }, p.name)))),
  );
}

// ---------- Hilfen für Fahrten ----------

function newTrip(legCount, people = state.persons.map((p) => p.id)) {
  const driver = state.persons.some((p) => p.id === state.defaultDriver) ? state.defaultDriver : state.persons[0]?.id;
  return { driver, legs: Array.from({ length: legCount }, () => [...people]) };
}

/** Fahrt an neue Anzahl Teilstrecken anpassen. */
function normalizeTrip(trip, legCount) {
  if (trip.legs.length === legCount) return trip;
  return { ...trip, legs: Array.from({ length: legCount }, (_, i) => [...ridersOnLeg(trip, i, legCount)]) };
}

function snapDiffers(a, b) {
  return a.price !== b.price || a.consumption !== b.consumption || a.extraPerKm !== b.extraPerKm
    || a.roundTrip !== b.roundTrip || JSON.stringify(a.legs) !== JSON.stringify(b.legs);
}

// ---------- Wochen-Navigation & Aktionen ----------

function weekHeader(monday, week) {
  const { week: kw } = isoWeek(monday);
  const go = (d) => update((s) => { s.ui.week = addDays(s.ui.week, d); });
  const cur = makeSnapshot();
  const snap = week?.snap;

  return h('section', { class: 'card sticky-week' },
    h('div', { class: 'week-nav' },
      h('button', { type: 'button', class: 'icon-btn big', title: 'Vorige Woche', onclick: () => go(-7) }, '‹'),
      h('div', { class: 'week-title' }, h('strong', {}, `KW ${kw}`), h('span', { class: 'muted' }, `${fmtDate(monday)} – ${fmtDate(addDays(monday, 6))}${monday.slice(0, 4)}`)),
      h('button', { type: 'button', class: 'icon-btn big', title: 'Nächste Woche', onclick: () => go(7) }, '›'),
      h('button', { type: 'button', class: 'btn btn-small btn-ghost', onclick: () => update((s) => { s.ui.week = mondayOf(toISODate(new Date())); }) }, 'Heute'),
    ),
    snap ? h('div', { class: `snapline ${snapDiffers(snap, cur) ? 'stale' : ''}` },
      h('span', {}, `Diese Woche: ${fmtKm(snap.legs.reduce((a, l) => a + l.km, 0))} · ${String(snap.consumption).replace('.', ',')} l/100 km · ${fmtPrice(snap.price)}/l`),
      snapDiffers(snap, cur) ? h('button', {
        type: 'button', class: 'btn btn-small', title: 'Aktuelle Strecke, aktuellen Verbrauch und Preis für diese Woche übernehmen',
        onclick: () => update((s) => {
          const w = s.weeks[monday];
          w.snap = makeSnapshot(s);
          for (const d of Object.values(w.days)) for (const dir of DIRECTIONS) if (d[dir]) d[dir] = normalizeTrip(d[dir], w.snap.legs.length);
        }),
      }, '↻ Aktuelle Werte übernehmen') : null,
    ) : null,
    h('div', { class: 'row gap wrap' },
      h('button', { type: 'button', class: 'btn btn-small', onclick: () => fillWeek(monday) }, '👥 Alle Mo–Fr eintragen'),
      h('button', { type: 'button', class: 'btn btn-small', onclick: () => copyPrevWeek(monday) }, '⧉ Wie Vorwoche'),
      h('button', {
        type: 'button', class: 'btn btn-small btn-ghost', disabled: !week || !Object.keys(week.days).length,
        onclick: () => { if (confirm('Alle Fahrten dieser Woche löschen?')) update((s) => { delete s.weeks[monday]; }); },
      }, 'Woche leeren'),
      h('label', { class: 'check small' }, h('input', { type: 'checkbox', checked: state.ui.showWeekend, onchange: (e) => update((s) => { s.ui.showWeekend = e.target.checked; }) }), ' Wochenende'),
    ),
  );
}

function fillWeek(monday) {
  update((s) => {
    const w = getWeek(monday, true);
    for (const date of weekDates(monday).slice(0, 5)) {
      w.days[date] = { hin: newTrip(w.snap.legs.length), rueck: s.roundTrip ? newTrip(w.snap.legs.length) : null };
    }
  });
}

function copyPrevWeek(monday) {
  const prev = state.weeks[addDays(monday, -7)];
  if (!prev || !Object.keys(prev.days).length) { toast('In der Vorwoche sind keine Fahrten eingetragen', 'error'); return; }
  update((s) => {
    const w = getWeek(monday, true);
    w.days = {};
    for (const [date, d] of Object.entries(prev.days)) {
      const copy = {};
      for (const dir of DIRECTIONS) copy[dir] = d[dir] ? normalizeTrip(structuredClone(d[dir]), w.snap.legs.length) : null;
      w.days[addDays(date, 7)] = copy;
    }
  });
  toast('Fahrten aus der Vorwoche übernommen', 'ok');
}

// ---------- Einzelne Fahrt ----------

function tripCell(monday, date, dir, trip, snap) {
  const key = `${date}|${dir}`;
  if (!trip) {
    return h('button', {
      type: 'button', class: 'trip empty',
      onclick: () => update((s) => {
        const w = getWeek(monday, true);
        w.days[date] ||= {};
        w.days[date][dir] = newTrip(w.snap.legs.length);
      }),
    }, `＋ ${DIR_LABEL[dir]}`);
  }

  const n = snap.legs.length;
  const res = calcTrip(trip, snap, state.split);
  const mutate = (fn) => update((s) => fn(s.weeks[monday].days[date][dir]));

  const toggle = (pid) => {
    if (pid === trip.driver) { toast('Der Fahrer ist immer dabei – ändere den Fahrer über die Auswahl darunter.'); return; }
    mutate((t) => {
      const onAll = t.legs.every((l) => l.includes(pid));
      t.legs = t.legs.map((l) => (onAll ? l.filter((x) => x !== pid) : l.includes(pid) ? l : [...l, pid]));
    });
  };

  const chips = state.persons.map((p) => {
    const count = Array.from({ length: n }, (_, i) => ridersOnLeg(trip, i, n).has(p.id)).filter(Boolean).length;
    const share = res.shares[p.id];
    return chip(p, {
      active: count > 0,
      partial: count > 0 && count < n,
      driver: p.id === trip.driver,
      title: `${p.name}${count > 0 && count < n ? ` (fährt ${count} von ${n} Teilstrecken)` : ''}${share ? ` – ${fmtEuro(share)}` : ''}`,
      onClick: () => toggle(p.id),
    });
  });

  const legsOpen = openLegs.has(key);
  const legEditor = n > 1 && legsOpen ? h('table', { class: 'leg-matrix' },
    h('thead', {}, h('tr', {}, h('th', {}, 'Teilstrecke'), state.persons.map((p) => h('th', { style: { color: p.color }, title: p.name }, p.name.slice(0, 3))))),
    h('tbody', {}, directedLegs(snap.legs, dir).map((leg) => h('tr', {},
      h('td', {}, h('div', {}, `${leg.from} → ${leg.to}`), h('small', { class: 'muted' }, `${fmtKm(leg.km)} · ${fmtEuro(res.legs[leg.legIndex].cost)}`)),
      state.persons.map((p) => {
        const isDriver = p.id === trip.driver;
        return h('td', {}, h('input', {
          type: 'checkbox', checked: isDriver || trip.legs[leg.legIndex]?.includes(p.id), disabled: isDriver,
          'aria-label': `${p.name} auf ${leg.from} → ${leg.to}`,
          onchange: (e) => mutate((t) => {
            const l = t.legs[leg.legIndex];
            t.legs[leg.legIndex] = e.target.checked ? [...new Set([...l, p.id])] : l.filter((x) => x !== p.id);
          }),
        }));
      }),
    ))),
  ) : null;

  return h('div', { class: `trip ${legEditor ? 'expanded' : ''}` },
    h('div', { class: 'trip-head' },
      h('span', { class: 'trip-dir' }, dir === 'hin' ? '➜ Hin' : '⟲ Zurück'),
      h('span', { class: 'trip-cost' }, fmtEuro(res.total)),
      h('button', { type: 'button', class: 'icon-btn danger small', title: 'Fahrt entfernen', onclick: () => update((s) => { s.weeks[monday].days[date][dir] = null; }) }, '✕'),
    ),
    h('div', { class: 'chips' }, chips),
    h('div', { class: 'trip-foot' },
      h('label', {}, '🚗 ', h('select', {
        'aria-label': 'Fahrer', onchange: (e) => mutate((t) => {
          t.driver = e.target.value;
          t.legs = t.legs.map((l) => (l.includes(t.driver) ? l : [...l, t.driver]));
        }),
      }, state.persons.map((p) => h('option', { value: p.id, selected: p.id === trip.driver }, p.name)))),
      n > 1 ? h('button', {
        type: 'button', class: `link ${legsOpen ? 'open' : ''}`,
        onclick: () => { legsOpen ? openLegs.delete(key) : openLegs.add(key); update(() => {}); },
      }, legsOpen ? 'Teilstrecken ▴' : 'Teilstrecken ▾') : null,
    ),
    legEditor,
  );
}

// ---------- Wochenübersicht ----------

function weekSummary(week) {
  if (!week) return null;
  const entries = [];
  for (const [date, d] of Object.entries(week.days)) for (const dir of DIRECTIONS) if (d[dir]) entries.push({ trip: d[dir], snap: week.snap, date, direction: dir });
  if (!entries.length) return null;
  const agg = aggregate(entries, state.split);
  return h('section', { class: 'card' },
    h('div', { class: 'row between' }, h('h3', {}, 'Diese Woche'), h('strong', {}, fmtEuro(agg.total))),
    h('div', { class: 'mini-shares' }, state.persons.filter((p) => agg.persons[p.id]).map((p) => h('div', { class: 'mini-share', style: { '--pc': p.color } },
      h('span', {}, p.name), h('strong', {}, fmtEuro(agg.persons[p.id].share))))),
    h('button', { type: 'button', class: 'link', onclick: () => update((s) => { s.ui.tab = 'bill'; s.ui.period = 'week'; }) }, 'Zur Abrechnung →'),
  );
}

export function renderTripsTab(el) {
  const monday = state.ui.week;
  const week = getWeek(monday);
  const snap = week?.snap || makeSnapshot();
  el.append(personsCard(), weekHeader(monday, week));

  if (!snap.legs.length) {
    el.append(h('section', { class: 'card' }, h('p', { class: 'hint warn' }, 'Lege zuerst im Tab „Strecke“ eine Route fest (oder gib die Kilometer ein).')));
    return;
  }

  el.append(h('p', { class: 'hint' }, 'Tippe auf Namen, um sie für eine Fahrt an- oder abzuwählen. Wer nur einen Teil der Strecke mitfährt (z. B. erst am Zwischenstopp zusteigt), stellst du über „Teilstrecken“ ein – schraffierte Namen fahren nur teilweise mit.'));

  const dates = weekDates(monday).filter((d) => state.ui.showWeekend || weekdayIndex(d) < 5 || week?.days[d]);
  const today = toISODate(new Date());
  const dirs = state.roundTrip ? DIRECTIONS : ['hin'];
  el.append(h('div', { class: 'days' }, dates.map((date) => {
    const d = week?.days[date] || {};
    const dayTotal = dirs.reduce((a, dir) => a + (d[dir] ? calcTrip(d[dir], snap, state.split).total : 0), 0);
    return h('section', { class: `day ${date === today ? 'today' : ''}` },
      h('div', { class: 'day-head' }, h('strong', {}, fmtDate(date, { weekday: true, long: true })), dayTotal ? h('span', { class: 'muted' }, fmtEuro(dayTotal)) : null),
      h('div', { class: `day-trips cols-${dirs.length}` }, dirs.map((dir) => tripCell(monday, date, dir, d[dir], snap))),
    );
  })));
  const sum = weekSummary(week);
  if (sum) el.append(sum);
}
