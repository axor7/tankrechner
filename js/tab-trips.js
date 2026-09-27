// Ansicht „Fahrten“: Wochenplan, Regelplan und „Meine Tage“ zum vorausschauenden Eintragen.
import { state, update, getWeek, makeSnapshot, personById } from './state.js';
import { calcTrip, aggregate, directedLegs, weekDates, addDays, isoWeek, mondayOf, toISODate, DIRECTIONS, ridersOnLeg, weekdayIndex, hasOwners, tripPeople } from './calc.js';
import { isActive, plannedPeople, plannedDriver, hasPattern } from './plan.js';
import { myPersonId } from './account.js';
import { h, chip, fmtEuro, fmtKm, fmtDate, fmtPrice, fmtDuration, toast } from './ui.js';
import { icon } from './icons.js';

const openLegs = new Set(); // aufgeklappte Teilstrecken
const DIR_LABEL = { hin: 'Hinfahrt', rueck: 'Rückfahrt' };
const WD = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
const today = () => toISODate(new Date());
const dirsNow = () => (state.roundTrip ? DIRECTIONS : ['hin']);

/** Wer bin ich? In einer Fahrgemeinschaft die beanspruchte Person, sonst die auf diesem Gerät gewählte. */
export function currentMe() {
  const id = myPersonId() || state.ui.me;
  return state.persons.some((p) => p.id === id) ? id : null;
}

// ---------- Fahrten anlegen ----------

/** Neue Fahrt nach Regelplan; extra = Personen, die auf jeden Fall dabei sein sollen. */
function newTrip(legCount, date, dir, extra = []) {
  let people = plannedPeople(state.persons, date, dir);
  for (const p of extra) if (!people.includes(p)) people.push(p);
  const fallback = state.persons.find((p) => p.id === state.defaultDriver && isActive(p))?.id || state.persons.find(isActive)?.id;
  const driver = plannedDriver(people, state.defaultDriver) || fallback;
  if (driver && !people.includes(driver)) people = [driver, ...people];
  return { driver, legs: Array.from({ length: Math.max(1, legCount) }, () => [...people]) };
}

/** Fahrt an neue Anzahl Teilstrecken anpassen. */
function normalizeTrip(trip, legCount) {
  if (trip.legs.length === legCount) return trip;
  return { ...trip, legs: Array.from({ length: legCount }, (_, i) => [...ridersOnLeg(trip, i, legCount)]) };
}

function snapDiffers(a, b) {
  return a.price !== b.price || a.consumption !== b.consumption || a.extraPerKm !== b.extraPerKm
    || a.roundTrip !== b.roundTrip || JSON.stringify(a.legs) !== JSON.stringify(b.legs)
    || JSON.stringify(a.stops || []) !== JSON.stringify(b.stops || []) || JSON.stringify(a.returnOrder || []) !== JSON.stringify(b.returnOrder || []);
}

/** Leere Tage einer Woche nach Regelplan füllen (bestehende Fahrten bleiben). Gibt die Anzahl neuer Fahrten zurück. */
function fillFromPlan(s, monday) {
  const w = getWeek(monday, true);
  let added = 0;
  for (const date of weekDates(monday)) {
    for (const dir of dirsNow()) {
      if (w.days[date]?.[dir]) continue;
      const people = plannedPeople(s.persons, date, dir);
      if (!people.length) continue;
      w.days[date] ||= {};
      w.days[date][dir] = newTrip(w.snap.legs.length, date, dir);
      added++;
    }
  }
  return added;
}

/** Woche anlegen (und beim ersten Mal nach Regelplan füllen). */
function ensureWeek(s, monday) {
  if (!s.weeks[monday]) fillFromPlan(s, monday);
  return getWeek(monday, true);
}

/** Bin ich an diesem Tag dabei? → 'on' | 'half' | 'off' */
export function myDayState(me, date) {
  const w = state.weeks[mondayOf(date)];
  const d = w?.days[date];
  const dirs = dirsNow();
  if (!d) {
    if (w) return 'off';
    // Woche noch nicht angelegt: Regelplan zeigen
    const n = dirs.filter((dir) => plannedPeople(state.persons, date, dir).includes(me)).length;
    return n === dirs.length ? 'on' : n ? 'half' : 'off';
  }
  const n = dirs.filter((dir) => d[dir] && tripPeople(d[dir]).has(me)).length;
  return n === dirs.length ? 'on' : n ? 'half' : 'off';
}

/** Mich an einem Tag an- oder abmelden (Hin und Rück). */
export function toggleMyDay(me, date) {
  const riding = myDayState(me, date) !== 'off';
  update((s) => {
    const w = ensureWeek(s, mondayOf(date));
    const d = (w.days[date] ||= {});
    for (const dir of dirsNow()) {
      const t = d[dir];
      if (riding) {
        if (!t || !tripPeople(t).has(me)) continue;
        t.legs = t.legs.map((l) => l.filter((x) => x !== me));
        if (t.driver === me) {
          const others = [...tripPeople({ ...t, driver: null })];
          if (!others.length) { d[dir] = null; continue; }
          t.driver = others.includes(s.defaultDriver) ? s.defaultDriver : others[0];
        }
      } else if (t) {
        t.legs = t.legs.map((l) => (l.includes(me) ? l : [...l, me]));
      } else {
        d[dir] = newTrip(w.snap.legs.length, date, dir, [me]);
      }
    }
  });
}

/** Die nächsten Fahrten ab heute (für die Übersicht). */
export function upcomingTrips(limit = 6) {
  const out = [];
  const t0 = today();
  for (const [, w] of Object.entries(state.weeks).sort(([a], [b]) => a.localeCompare(b))) {
    for (const date of Object.keys(w.days).sort()) {
      if (date < t0) continue;
      for (const dir of dirsNow()) {
        const trip = w.days[date][dir];
        if (trip) out.push({ date, dir, trip, snap: w.snap });
      }
    }
  }
  return out.slice(0, limit);
}

// ---------- Meine Tage ----------

function myDaysCard() {
  const me = currentMe();
  const active = state.persons.filter(isActive);
  const monday = mondayOf(today());
  if (!me) {
    return h('section', { class: 'card' },
      h('h2', {}, 'Meine Tage'),
      h('p', { class: 'hint' }, 'Trag vorausschauend ein, an welchen Tagen du mitfährst. Wer bist du?'),
      h('div', { class: 'claim-grid' }, active.map((p) => h('button', {
        type: 'button', class: 'claim-btn', onclick: () => update((s) => { s.ui.me = p.id; }),
      }, h('span', { class: 'dot', style: { '--pc': p.color } }), p.name))),
    );
  }
  const person = personById(me);
  const days = state.ui.showWeekend ? 7 : 5;
  return h('section', { class: 'card', style: { '--pc': person.color } },
    h('div', { class: 'row between' },
      h('h2', {}, 'Meine Tage'),
      !myPersonId() ? h('button', { type: 'button', class: 'link', onclick: () => update((s) => { s.ui.me = null; }) }, `${person.name} · ändern`) : h('span', { class: 'muted small' }, person.name)),
    h('p', { class: 'hint' }, 'Tippe die Tage an, an denen du voraussichtlich mitfährst – für die nächsten Wochen. Gestreift = nur Hin oder nur Rück.'),
    h('div', { class: 'my-days' }, [0, 1, 2, 3].map((k) => {
      const mon = addDays(monday, k * 7);
      return h('div', { class: `my-week ${days === 7 ? 'with-weekend' : ''}` },
        h('span', { class: 'kw' }, `KW ${isoWeek(mon).week}`),
        weekDates(mon).slice(0, days).map((date) => {
          const st = myDayState(me, date);
          const past = date < today();
          return h('button', {
            type: 'button', class: `my-day ${st} ${past ? 'past' : ''} ${date === today() ? 'today' : ''}`, disabled: past,
            'aria-pressed': String(st !== 'off'), title: `${fmtDate(date, { weekday: true, long: true })}: ${st === 'off' ? 'fährt nicht mit' : 'fährt mit'}`,
            onclick: () => toggleMyDay(me, date),
          }, WD[weekdayIndex(date)], h('strong', {}, date.slice(8, 10)));
        }));
    })),
    !hasPattern(person) ? h('p', { class: 'hint small' }, 'Tipp: Unter Einstellungen → Mitfahrer kannst du deine festen Tage als Regelplan hinterlegen.') : null,
  );
}

// ---------- Wochen-Navigation & Aktionen ----------

function weekHeader(monday, week) {
  const { week: kw } = isoWeek(monday);
  const go = (d) => update((s) => { s.ui.week = addDays(s.ui.week, d); });
  const cur = makeSnapshot();
  const snap = week?.snap;
  const isCurrent = monday === mondayOf(today());

  return h('section', { class: 'card' },
    h('div', { class: 'week-nav' },
      h('button', { type: 'button', class: 'icon-btn big', title: 'Vorige Woche', 'aria-label': 'Vorige Woche', onclick: () => go(-7) }, icon('chevron-left', { size: 22 })),
      h('div', { class: 'week-title' }, h('strong', {}, `KW ${kw}`), h('span', { class: 'muted' }, `${fmtDate(monday)} – ${fmtDate(addDays(monday, 6))}${monday.slice(0, 4)}`)),
      h('button', { type: 'button', class: 'icon-btn big', title: 'Nächste Woche', 'aria-label': 'Nächste Woche', onclick: () => go(7) }, icon('chevron-right', { size: 22 })),
      h('button', { type: 'button', class: 'btn btn-small', disabled: isCurrent, onclick: () => update((s) => { s.ui.week = mondayOf(today()); }) }, 'Heute'),
    ),
    snap ? h('div', { class: `snapline ${snapDiffers(snap, cur) ? 'stale' : ''}` },
      h('span', {}, `${fmtKm(snap.legs.reduce((a, l) => a + l.km, 0))} · ${String(snap.consumption).replace('.', ',')} l/100 km · ${fmtPrice(snap.price)}/l${snap.extraPerKm > 0 ? ` · + ${String(snap.extraPerKm).replace('.', ',')} ct/km` : ''}`),
      snapDiffers(snap, cur) ? h('button', {
        type: 'button', class: 'btn btn-small', title: 'Aktuelle Strecke, Verbrauch und Preis für diese Woche übernehmen',
        onclick: () => update((s) => {
          const w = s.weeks[monday];
          w.snap = makeSnapshot(s);
          for (const d of Object.values(w.days)) for (const dir of DIRECTIONS) if (d[dir]) d[dir] = normalizeTrip(d[dir], w.snap.legs.length);
        }),
      }, icon('refresh-cw', { size: 14 }), 'Aktuelle Werte übernehmen') : null,
    ) : null,
    h('div', { class: 'row gap wrap' },
      h('button', {
        type: 'button', class: 'btn btn-small',
        onclick: () => { let n = 0; update((s) => { n = fillFromPlan(s, monday); }); toast(n ? `${n} Fahrten nach Regelplan eingetragen` : 'Nichts zu ergänzen – alle geplanten Fahrten sind schon da'); },
      }, icon('calendar-check', { size: 15 }), 'Aus Regelplan füllen'),
      h('button', { type: 'button', class: 'btn btn-small', onclick: () => copyPrevWeek(monday) }, icon('copy', { size: 15 }), 'Wie Vorwoche'),
      h('button', {
        type: 'button', class: 'btn btn-small btn-danger', disabled: !week || !Object.keys(week.days).length,
        onclick: () => { if (confirm('Alle Fahrten dieser Woche löschen?')) update((s) => { delete s.weeks[monday]; }); },
      }, icon('trash-2', { size: 15 }), 'Leeren'),
    ),
    h('label', { class: 'switch-row' }, h('span', { class: 'small' }, 'Wochenende anzeigen'),
      h('input', { type: 'checkbox', class: 'switch', checked: state.ui.showWeekend, onchange: (e) => update((s) => { s.ui.showWeekend = e.target.checked; }) })),
  );
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

function emptyWeekCard(monday) {
  const lines = weekDates(monday).map((date) => {
    const names = [...new Set(dirsNow().flatMap((dir) => plannedPeople(state.persons, date, dir)))].map((id) => personById(id)?.name);
    return names.length ? h('li', {}, h('strong', {}, `${fmtDate(date, { weekday: true })} `), h('span', { class: 'muted' }, names.join(', '))) : null;
  }).filter(Boolean);
  return h('section', { class: 'card empty-state' },
    icon('calendar-days', { size: 40, cls: 'big-icon' }),
    h('h2', {}, 'Diese Woche ist noch leer'),
    lines.length
      ? [h('p', { class: 'hint' }, 'Nach Regelplan fahren voraussichtlich:'), h('ul', { class: 'legs', style: { width: '100%', maxWidth: '360px', textAlign: 'left' } }, lines),
        h('button', { type: 'button', class: 'btn btn-primary', onclick: () => update((s) => { fillFromPlan(s, monday); }) }, icon('calendar-check', { size: 17 }), 'Woche aus Regelplan füllen')]
      : h('p', { class: 'hint' }, 'Tippe unten bei einem Tag auf „Hinfahrt“ oder hinterlege unter Einstellungen → Mitfahrer feste Tage.'),
  );
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
        w.days[date][dir] = newTrip(w.snap.legs.length, date, dir);
      }),
    }, icon('plus', { size: 16 }), ` ${DIR_LABEL[dir]}`);
  }

  const auto = hasOwners(snap);
  const n = snap.legs.length;
  const res = calcTrip(trip, snap, state.split, dir);
  const people = tripPeople(trip);
  const mutate = (fn) => update((s) => fn(s.weeks[monday].days[date][dir]));
  const shown = state.persons.filter((p) => isActive(p) || people.has(p.id));

  const toggle = (pid) => {
    if (pid === trip.driver) { toast('Der Fahrer ist immer dabei – ändere den Fahrer über die Auswahl darunter.'); return; }
    mutate((t) => {
      const onAll = t.legs.every((l) => l.includes(pid));
      t.legs = t.legs.map((l) => (onAll ? l.filter((x) => x !== pid) : l.includes(pid) ? l : [...l, pid]));
    });
  };

  const chips = shown.map((p) => {
    const total = res.legs.length;
    const count = res.legs.filter((l) => l.riders.includes(p.id)).length;
    const active = auto ? people.has(p.id) : count > 0;
    const share = res.shares[p.id];
    return chip(p, {
      active,
      partial: !auto && active && count < total, // bei zugeordneten Adressen ist „teilweise“ normal – nicht extra markieren
      driver: p.id === trip.driver,
      title: `${p.name}${active && count < total ? ` (fährt ${count} von ${total} Teilstrecken)` : ''}${share ? ` – ${fmtEuro(share)}` : ''}`,
      onClick: () => toggle(p.id),
    });
  });

  const legsOpen = openLegs.has(key);
  const personOf = (id) => personById(id);
  // Adressen zugeordnet: Teilstrecken ergeben sich automatisch – nur anzeigen
  const autoView = auto && legsOpen ? h('table', { class: 'trip-legs' }, h('tbody', {}, res.legs.map((l) => h('tr', {},
    h('td', {},
      h('div', {}, `${l.from} → ${l.to}`),
      h('span', { class: 'dots' }, l.riders.map((id) => h('span', { class: 'dot', style: { '--pc': personOf(id)?.color || '#999' }, title: personOf(id)?.name }))),
      h('small', { class: 'muted' }, ` ${l.riders.map((id) => personOf(id)?.name).filter(Boolean).join(', ')}`)),
    h('td', {}, h('div', {}, fmtEuro(l.cost)), h('small', { class: 'muted' }, `${res.estimated ? '≈ ' : ''}${fmtKm(l.km)}${l.min ? ` · ${fmtDuration(l.min * 60)}` : ''}`)),
  )))) : null;
  const legEditor = auto ? autoView : n > 1 && legsOpen ? h('table', { class: 'leg-matrix' },
    h('thead', {}, h('tr', {}, h('th', {}, 'Teilstrecke'), shown.map((p) => h('th', { style: { color: p.color }, title: p.name }, p.name.slice(0, 3))))),
    h('tbody', {}, directedLegs(snap.legs, dir).map((leg) => h('tr', {},
      h('td', {}, h('div', {}, `${leg.from} → ${leg.to}`), h('small', { class: 'muted' }, `${fmtKm(leg.km)} · ${fmtEuro(res.legs.find((l) => l.legIndex === leg.legIndex)?.cost)}`)),
      shown.map((p) => {
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
      h('span', { class: 'trip-dir' }, dir === 'hin' ? 'Hin' : 'Zurück'),
      h('span', { class: 'trip-cost', title: res.estimated ? 'Strecke wird noch berechnet – vorläufig geschätzt' : '' }, `${res.estimated ? '≈ ' : ''}${fmtEuro(res.total)}`),
      h('button', { type: 'button', class: 'icon-btn danger small', title: 'Fahrt entfernen', 'aria-label': 'Fahrt entfernen', onclick: () => update((s) => { s.weeks[monday].days[date][dir] = null; }) }, icon('x', { size: 15 })),
    ),
    h('div', { class: 'chips' }, chips),
    h('div', { class: 'trip-foot' },
      h('label', { class: 'row gap', style: { gap: '.3rem' } }, icon('car', { size: 16 }), h('select', {
        'aria-label': 'Fahrer', onchange: (e) => mutate((t) => {
          t.driver = e.target.value;
          t.legs = t.legs.map((l) => (l.includes(t.driver) ? l : [...l, t.driver]));
        }),
      }, shown.map((p) => h('option', { value: p.id, selected: p.id === trip.driver }, p.name)))),
      auto || n > 1 ? h('button', {
        type: 'button', class: 'link',
        onclick: () => { legsOpen ? openLegs.delete(key) : openLegs.add(key); update(() => {}); },
      }, `${auto ? 'Strecke' : 'Teilstrecken'} ${legsOpen ? '▴' : '▾'}`) : null,
    ),
    legEditor,
  );
}

// ---------- Wochenübersicht ----------

function weekSummary(week, ctx) {
  if (!week) return null;
  const entries = [];
  for (const [date, d] of Object.entries(week.days)) for (const dir of dirsNow()) if (d[dir]) entries.push({ trip: d[dir], snap: week.snap, date, direction: dir });
  if (!entries.length) return null;
  const agg = aggregate(entries, state.split);
  return h('section', { class: 'card' },
    h('div', { class: 'row between' }, h('h2', {}, 'Diese Woche'), h('strong', {}, fmtEuro(agg.total))),
    h('div', { class: 'mini-shares' }, state.persons.filter((p) => agg.persons[p.id]).map((p) => h('div', { class: 'mini-share', style: { '--pc': p.color } },
      h('span', {}, p.name), h('strong', {}, fmtEuro(agg.persons[p.id].share))))),
    h('button', { type: 'button', class: 'link', onclick: () => { update((s) => { s.ui.period = 'week'; }); ctx.go('bill'); } }, 'Zur Abrechnung ›'),
  );
}

export function renderTripsTab(el, ctx) {
  const monday = state.ui.week;
  const week = getWeek(monday);
  const snap = week?.snap || makeSnapshot();
  el.append(myDaysCard(), weekHeader(monday, week));

  if (!snap.legs.length) {
    el.append(h('section', { class: 'card' },
      h('p', { class: 'hint warn' }, 'Lege zuerst eine Strecke fest (oder gib die Kilometer ein).'),
      h('button', { type: 'button', class: 'btn', onclick: () => ctx.go('route') }, icon('route', { size: 17 }), 'Zur Strecke')));
    return;
  }

  const hasTrips = week && Object.values(week.days).some((d) => d.hin || d.rueck);
  if (!hasTrips) el.append(emptyWeekCard(monday));

  const dates = weekDates(monday).filter((d) => state.ui.showWeekend || weekdayIndex(d) < 5 || week?.days[d]?.hin || week?.days[d]?.rueck);
  const t0 = today();
  const dirs = dirsNow();
  el.append(h('div', { class: 'days' }, dates.map((date) => {
    const d = week?.days[date] || {};
    const dayTotal = dirs.reduce((a, dir) => a + (d[dir] ? calcTrip(d[dir], snap, state.split, dir).total : 0), 0);
    return h('section', { class: `day ${date === t0 ? 'today' : ''} ${date > t0 && (d.hin || d.rueck) ? 'future' : ''}` },
      h('div', { class: 'day-head' }, h('strong', {}, fmtDate(date, { weekday: true, long: true })), dayTotal ? h('span', { class: 'muted' }, fmtEuro(dayTotal)) : null),
      h('div', { class: `day-trips cols-${dirs.length}` }, dirs.map((dir) => tripCell(monday, date, dir, d[dir], snap))),
    );
  })));
  el.append(h('p', { class: 'hint small' }, hasOwners(snap)
    ? 'Namen antippen = für diese Fahrt an-/abwählen. Die Teilstrecken ergeben sich aus den Adressen: Jeder zahlt hin ab seiner Adresse und zurück bis dorthin. Tage in der Zukunft sind „geplant“ und werden erst ab dem Tag abgerechnet.'
    : 'Namen antippen = für diese Fahrt an-/abwählen. Wer nur einen Teil mitfährt, stellst du über „Teilstrecken“ ein (gestreift = teilweise). Tage in der Zukunft sind „geplant“ und werden erst ab dem Tag abgerechnet.'));
  const sum = weekSummary(week, ctx);
  if (sum) el.append(sum);
}
