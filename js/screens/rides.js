// Bildschirm „Fahrten“: Wann fahre ich, wer holt mich ab, bin ich dabei?
// Oben die nächste Fahrt, darunter die nächsten Tage – jeder Tag mit einem Tipp an- oder abzusagen.
import { state, update, model, personById, activePersons, todayIso } from '../state.js';
import { addDays, mondayOf, weekDates, isoWeek, fmtTime, weekdayIndex } from '../calc.js';
import { planOn, absenceOn, activeDetours, isActive } from '../model.js';
import { isAdmin, inGroup } from '../account.js';
import { me, setDay, setDriver, setDayOff, volunteerDrive, setPlan, addAbsence, removeAbsence } from '../actions.js';
import { dirsNow, tripResult } from '../derived.js';
import { relevantClosures } from '../engine.js';
import { cleanTitle } from '../traffic.js';
import { planFor } from '../model.js';
import { h, icon, header, section, list, card, row, switchRow, seg, btn, note, banner, field, avatar, noApp, registerSheet, openSheet, closeSheet, sheet, attempt, toast } from '../kit.js';
import { relDay, longDay, span, weekdayShort, nameOf, shortLabel, rhythmText, absenceText, absencesOf, REASONS, nextRideDate, timedStops, personTime, driverGaps, datesText } from '../plan.js';
import { fmtDate, fmtEuro } from '../ui.js';

const DIR = { hin: 'Hinfahrt', rueck: 'Rückfahrt' };

// ---------- Nächste Fahrt ----------

function nextRide(mine) {
  const date = nextRideDate(mine);
  if (!date) {
    return card(h('div', { class: 'hero-label' }, 'Nächste Fahrt'), h('div', { class: 'hero-big' }, 'Keine geplant'));
  }
  const m = model();
  const info = m.dayInfo(date);
  const dirs = dirsNow();
  const hin = dirs.includes('hin') ? timedStops(date, 'hin') : null;
  const back = dirs.includes('rueck') ? timedStops(date, 'rueck') : null;
  const driver = info.driver.hin || info.driver.rueck || null;
  const iDrive = dirs.some((dir) => info.driver[dir] === mine);
  const myDirs = dirs.filter((dir) => info.riders[dir]?.includes(mine));
  const noDriver = dirs.every((dir) => !info.riders[dir]?.length || !info.driver[dir]);
  const backTime = back?.stops?.[0]?.time;
  const open = () => openSheet('day', { date });

  if (iDrive) {
    const stops = hin?.stops || [];
    const wd = weekdayIndex(date);
    // Mitfahrer ohne Adresse haben keinen eigenen Halt – sie steigen beim Fahrer zu
    const atMine = (info.riders.hin || []).filter((pid) => pid !== mine && !personById(pid)?.address?.lat);
    const missing = activePersons().filter((p) => p.id !== mine && !info.free && dirs.some((dir) => planOn(p, date)[dir][wd]) && !dirs.some((dir) => info.riders[dir]?.includes(p.id)));
    return h('div', { class: 'card hero' },
      h('div', { class: 'hero-label' }, relDay(date)),
      h('div', { class: 'hero-big' }, stops[0]?.time != null ? `Abfahrt ${fmtTime(stops[0].time)}` : 'Du fährst'),
      stops.length > 1 ? h('ol', { class: 'stops' }, stops.slice(1).map((s) => h('li', {},
        h('span', { class: 'stop-time' }, s.time != null ? fmtTime(s.time) : ''),
        h('span', { class: `stop-dot ${s.via ? 'via' : ''}` }),
        h('span', {}, s.via ? 'Umleitung' : s.owners?.length ? s.owners.map(nameOf).join(', ') : shortLabel(s.name))))) : null,
      atMine.length ? h('div', { class: 'hero-note' }, `${atMine.map(nameOf).join(', ')} ${atMine.length > 1 ? 'steigen' : 'steigt'} bei dir zu`) : null,
      missing.length ? h('div', { class: 'hero-note' }, `${missing.map((p) => p.name).join(', ')} ${missing.length > 1 ? 'fahren' : 'fährt'} nicht mit`) : null,
      backTime != null ? h('div', { class: 'hero-sub' }, `Zurück ab ${fmtTime(backTime)}`) : null,
      btn('Tag ansehen', { kind: 'plain', small: true, onClick: open }));
  }

  const inNow = myDirs.length > 0;
  const pick = personTime(hin, mine);
  const home = personTime(back, mine);
  const abs = absenceOn(personById(mine), date);
  let big; let sub;
  if (!inNow) {
    big = 'Nicht dabei';
    sub = abs ? `${REASONS[abs.reason] || 'Abwesend'} bis ${fmtDate(abs.until || abs.from)}` : m.ridesWhy(mine, date, dirs[0]).why === 'day' ? 'Du hast abgesagt.' : 'Laut Plan nicht dabei.';
  } else if (noDriver) {
    big = 'Kein Fahrer';
    sub = `${nameOf(info.regular)} fährt an dem Tag nicht.`;
  } else {
    big = pick != null && myDirs.includes('hin') ? `Abholung ${fmtTime(pick)}` : `${nameOf(driver)} fährt`;
    sub = [
      `${driver === info.regular ? '' : 'Vertretung: '}${nameOf(driver)}`,
      myDirs.includes('rueck') && backTime != null ? `zurück ab ${fmtTime(backTime)}${home != null ? `, zu Hause ca. ${fmtTime(home)}` : ''}` : null,
      !myDirs.includes('rueck') && dirs.includes('rueck') ? 'nur hin' : !myDirs.includes('hin') ? 'nur zurück' : null,
    ].filter(Boolean).join(' · ');
  }
  const set = (v) => attempt(() => setDay(mine, date, Object.fromEntries(dirs.map((dir) => [dir, v]))));
  return h('div', { class: `card hero ${!inNow ? 'is-out' : noDriver ? 'is-warn' : ''}` },
    h('div', { class: 'hero-label' }, relDay(date)),
    h('div', { class: 'hero-big' }, big),
    h('div', { class: 'hero-sub' }, sub),
    mine ? seg([['in', 'Dabei'], ['out', 'Nicht dabei']], inNow ? 'in' : 'out', (v) => set(v === 'in')) : null,
    btn('Tag ansehen', { kind: 'plain', small: true, onClick: open }));
}

// ---------- Hinweise (nur wenn man etwas tun kann oder es die nächsten Fahrten betrifft) ----------

function alerts(mine) {
  const out = [];
  const m = model();
  const p = personById(mine);
  // Fahrer fällt aus → wer fahren kann, wird gefragt
  if (p && m.canDrive(p)) {
    const dismissed = new Set(state.ui.dismissedGaps || []);
    for (const g of driverGaps()) {
      const key = `${g.regular}|${g.dates.join()}`;
      if (g.regular === mine || dismissed.has(key) || g.dates.some((d) => absenceOn(p, d))) continue;
      const abs = absenceOn(personById(g.regular), g.dates[0]);
      out.push(banner({
        tone: 'warn', ic: 'car', title: `${nameOf(g.regular)} fällt aus · ${datesText(g.dates)}`,
        text: abs ? `${REASONS[abs.reason] || 'Abwesend'}. Übernimmst du?` : 'Übernimmst du?',
        buttons: [
          btn('Ich fahre', { kind: 'primary', small: true, onClick: () => attempt(() => { volunteerDrive(mine, g.dates, true); toast('Danke! Du fährst an diesen Tagen.', 'ok'); }) }),
          btn('Nein', { kind: 'plain', small: true, onClick: () => update((s) => { s.ui.dismissedGaps = [...(s.ui.dismissedGaps || []), key]; }) }),
        ],
      }));
    }
  }
  // Umleitung (gilt gerade) – oder für Admins: Sperrung ohne Umleitung
  const det = activeDetours(state.detours, todayIso())[0];
  const go = () => update((s) => { s.ui.screen = 'route'; s.ui.routeDir = det?.dir === 'hin' ? 'hin' : 'rueck'; });
  if (det) {
    out.push(banner({ tone: 'info', ic: 'construction', title: `${DIR[det.dir] || 'Strecke'} mit Umleitung`, text: `über ${det.place}${det.until ? ` · bis ${fmtDate(det.until)}` : ''}`, onClick: go }));
  } else if (isAdmin()) {
    // Nur Sperrungen, durch die eure Route wirklich führt (gleiche Prüfung wie auf „Strecke“)
    for (const dir of dirsNow()) {
      const c = relevantClosures(dir).find((x) => x.passes);
      if (!c) continue;
      const when = c.upcoming && c.it.times.start ? `ab ${fmtDate(c.zone.from, { weekday: true })}` : 'jetzt';
      out.push(banner({ tone: 'bad', ic: 'octagon-x', title: `${DIR[dir]}: Sperrung ${when}`, text: `${cleanTitle(c.it)} · Umleitung wählen`, onClick: () => update((s) => { s.ui.screen = 'route'; s.ui.routeDir = dir; }) }));
      break;
    }
  }
  return out;
}

// ---------- Die nächsten Tage ----------

/** Mein Status an einem Tag als runder Knopf: dabei / nicht dabei / abwesend / Fahrer. */
function myStatus(date, info, mine) {
  const dirs = dirsNow();
  const p = personById(mine);
  if (!p) return null;
  if (dirs.some((dir) => info.driver[dir] === mine)) return h('span', { class: 'status drive', title: 'Du fährst' }, icon('car', { size: 16 }));
  const abs = absenceOn(p, date);
  const n = dirs.filter((dir) => info.riders[dir]?.includes(mine)).length;
  if (abs && !n) return h('span', { class: 'status away', title: REASONS[abs.reason] }, icon('palm-tree', { size: 16 }));
  const on = n > 0;
  return h('button', {
    type: 'button', class: `status ${on ? 'on' : 'off'} ${on && n < dirs.length ? 'half' : ''}`, 'aria-pressed': String(on),
    'aria-label': on ? 'Dabei – antippen zum Absagen' : 'Nicht dabei – antippen zum Mitfahren',
    onclick: (e) => { e.stopPropagation(); attempt(() => setDay(mine, date, Object.fromEntries(dirs.map((dir) => [dir, !on])))); },
  }, on ? icon('check', { size: 16 }) : null);
}

function dayItems(from, count) {
  const m = model();
  const out = [];
  for (let k = 0; k < count; k++) {
    const date = addDays(from, k);
    const info = m.dayInfo(date);
    const any = dirsNow().some((dir) => info.riders[dir]?.length);
    const wd = weekdayIndex(date);
    if (!any && wd >= 5) continue;
    if (!any && (info.free || info.off)) {
      const name = info.off ? 'Freier Tag' : info.free.name;
      const last = out[out.length - 1]; // Wochenenden ohne Fahrt fehlen ohnehin – so werden ganze Ferien eine Zeile
      if (last?.type === 'free' && last.name === name) { last.end = date; continue; }
      out.push({ type: 'free', name, start: date, end: date });
      continue;
    }
    out.push({ type: 'day', date, info, any });
  }
  return out;
}

function dayRow(item, mine) {
  const t0 = todayIso();
  if (item.type === 'free') {
    return row({
      lead: h('span', { class: 'date-box free' }, icon('sun', { size: 16 })),
      title: item.name, sub: span(item.start, item.end),
      cls: 'day-row is-free', onClick: () => openSheet('day', { date: item.start }), chevron: false,
    });
  }
  const { date, info } = item;
  const dirs = dirsNow();
  const riders = [...new Set(dirs.flatMap((dir) => info.riders[dir] || []))];
  const driver = info.driver.hin || info.driver.rueck || null;
  const noDriver = item.any && dirs.some((dir) => info.riders[dir]?.length && !info.driver[dir]);
  const others = riders.filter((id) => id !== driver && id !== mine);
  const title = !item.any ? 'Keine Fahrt' : noDriver ? 'Kein Fahrer' : driver === mine ? 'Du fährst' : `${nameOf(driver)} fährt`;
  const sub = !item.any ? null : others.length ? `mit ${others.map(nameOf).join(', ')}` : riders.includes(mine) || driver === mine ? 'nur ihr' : 'ohne dich';
  return row({
    lead: h('span', { class: `date-box ${date === t0 ? 'today' : ''}` }, h('small', {}, weekdayShort(date)), date.slice(8, 10)),
    title, sub, tone: noDriver ? 'warn' : null, cls: `day-row ${date < t0 ? 'past' : ''}`,
    trail: myStatus(date, info, mine), chevron: false,
    onClick: () => openSheet('day', { date }),
  });
}

function upcoming(mine) {
  const t0 = todayIso();
  const count = state.ui.ridesDays || 21;
  const past = state.ui.ridesPast;
  const items = dayItems(past ? addDays(t0, -14) : t0, (past ? 14 : 0) + count);
  return section(past ? 'Letzte & nächste Tage' : 'Nächste Tage', h('div', {},
    list(...items.map((it) => dayRow(it, mine))),
    h('button', { type: 'button', class: 'link-btn', onclick: () => update((s) => { s.ui.ridesDays = count + 21; }) }, 'Weitere Tage')),
  { action: h('button', { type: 'button', class: 'link-btn', onclick: () => update((s) => { s.ui.ridesPast = !past; }) }, past ? 'Ab heute' : 'Frühere') });
}

function myPlan(mine) {
  const p = personById(mine);
  if (!p) return null;
  return section('Mein Plan', list(
    row({ title: 'Rhythmus', value: rhythmText(p), onClick: () => openSheet('rhythm', { pid: mine }) }),
    row({ title: 'Abwesend', value: absenceText(p) || 'eintragen', onClick: () => openSheet('absence', { pid: mine }) }),
  ));
}

export function renderRides(el) {
  const mine = me();
  el.append(
    header({ title: 'Fahrten', sub: longDay(todayIso()) }),
    ...alerts(mine),
    nextRide(mine),
    upcoming(mine),
    myPlan(mine) || h('span'),
  );
}

// ---------- Fenster: ein Tag ----------

registerSheet('day', ({ date }) => {
  const m = model();
  const info = m.dayInfo(date);
  const mine = me();
  const admin = isAdmin();
  const dirs = dirsNow();
  const t0 = todayIso();
  const people = m.persons.filter((p) => isActive(p) || dirs.some((dir) => info.riders[dir]?.includes(p.id)));
  const myP = personById(mine);
  const canEdit = (pid) => admin || pid === mine;
  const sub = info.off ? 'Freier Tag – niemand fährt' : info.free ? `${info.free.name} – nach Plan fährt niemand` : date < t0 ? 'Vergangen – Änderungen ändern die Abrechnung' : null;

  const block = (dir) => {
    const ts = timedStops(date, dir);
    const drv = info.driver[dir];
    const riders = info.riders[dir] || [];
    const times = ts?.stops?.length ? `${ts.stops[0].time != null ? fmtTime(ts.stops[0].time) : ''}${ts.stops.at(-1).time != null ? `–${fmtTime(ts.stops.at(-1).time)}` : ''}` : '';
    const iCan = myP && m.canDrive(myP) && !absenceOn(myP, date) && info.regular !== mine;
    const driverLine = drv
      ? row({ lead: avatar(drv, 'm', { ring: true }), title: drv === mine ? 'Du fährst' : `${nameOf(drv)} fährt`, sub: info.substitute[dir] ? 'springt ein' : null,
        trail: admin && riders.length > 1 ? h('select', { class: 'mini-select', 'aria-label': 'Fahrer', onchange: (e) => attempt(() => setDriver(date, dir, e.target.value)) },
          riders.map((pid) => h('option', { value: pid, selected: pid === drv }, nameOf(pid)))) : null })
      : riders.length ? row({ lead: h('span', { class: 'av av-m ph' }, '?'), title: 'Kein Fahrer', sub: `${nameOf(info.regular)} fährt nicht`, tone: 'warn',
        trail: iCan && date >= t0 ? btn('Ich fahre', { kind: 'primary', small: true, onClick: () => attempt(() => volunteerDrive(mine, [date], true)) }) : null }) : null;
    return section(`${DIR[dir]}${times ? ` · ${times}` : ''}`, list(
      driverLine,
      ...people.filter((p) => p.id !== drv).map((p) => {
        const on = riders.includes(p.id);
        const t = on ? personTime(ts, p.id) : null;
        const why = m.ridesWhy(p.id, date, dir).why;
        return h('label', { class: `row switch-row ${canEdit(p.id) && !info.off ? '' : 'is-disabled'}` },
          avatar(p.id, 's'),
          h('span', { class: 'row-main' }, h('span', { class: 'row-title' }, p.id === mine ? 'Du' : p.name, ' ', noApp(p.id)),
            h('span', { class: 'row-sub' }, on ? (t != null ? `${dir === 'hin' ? 'Abholung' : 'zu Hause'} ${fmtTime(t)}` : 'dabei') : why === 'absent' ? 'abwesend' : 'nicht dabei')),
          h('input', { type: 'checkbox', class: 'switch', checked: on, disabled: !canEdit(p.id) || info.off, onchange: (e) => attempt(() => setDay(p.id, date, { [dir]: e.target.checked })) }));
      }),
    ));
  };

  const costs = dirs.map((dir) => tripResult(date, dir)).filter(Boolean);
  const total = costs.reduce((a, r) => a + r.result.total, 0);
  const myShare = costs.reduce((a, r) => a + (r.result.shares[mine] || 0), 0);
  return sheet({
    title: longDay(date), sub,
    body: [
      info.off ? null : dirs.map(block),
      costs.length ? note(`Kosten an diesem Tag ${fmtEuro(total)}${myShare ? ` · dein Anteil ${fmtEuro(myShare)}` : ''}`) : null,
      admin ? list(switchRow({ title: 'Freier Tag', sub: 'Niemand fährt, es fallen keine Kosten an', checked: info.off, onChange: (v) => attempt(() => setDayOff(date, v)) })) : null,
    ],
  });
});

// ---------- Rhythmus ----------

const WD = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
const draft = { pid: null };

function loadDraft(pid) {
  if (draft.pid === pid) return draft;
  const p = personById(pid);
  const v = planFor(p, todayIso());
  const has = v.hin.some(Boolean) || v.rueck.some(Boolean);
  const mofr = [true, true, true, true, true, false, false];
  Object.assign(draft, {
    pid, mode: p?.plan?.length ? v.mode : 'always',
    hin: has ? [...v.hin] : [...mofr], rueck: has ? [...v.rueck] : [...mofr],
    wopt: v.weeks?.length ? 'pick' : 'every', startNext: false, weeks: new Set(v.weeks || []),
    weekend: (v.hin[5] || v.hin[6] || v.rueck[5] || v.rueck[6]) || false,
  });
  return draft;
}

/** Rhythmus bearbeiten (für Fenster und eingebettet). onSaved nach dem Speichern. */
export function rhythmEditor(pid, { onSaved, saveLabel = 'Speichern' } = {}) {
  const d = loadDraft(pid);
  const redraw = () => update(() => {});
  const dirs = dirsNow();
  const n = d.weekend ? 7 : 5;
  const m = model();
  const thisWeek = mondayOf(todayIso());
  const save = () => {
    const rhythm = d.mode === 'weeks'
      ? (d.wopt === 'pick' ? { mode: 'weeks', weeks: [...d.weeks].filter((w) => w >= thisWeek) } : { mode: 'weeks', every: 2, anchor: d.startNext ? addDays(thisWeek, 7) : thisWeek })
      : { mode: d.mode };
    if (rhythm.weeks && !rhythm.weeks.length) { toast('Bitte mindestens eine Woche antippen', 'error'); return; }
    const hin = d.weekend ? d.hin : [...d.hin.slice(0, 5), false, false];
    const rueck = d.weekend ? d.rueck : [...d.rueck.slice(0, 5), false, false];
    attempt(() => setPlan(pid, hin, rueck, rhythm)).then((ok) => { if (ok) { draft.pid = null; toast('Gespeichert – gilt ab heute', 'ok'); onSaved?.(); } });
  };
  const grid = h('div', { class: `days days-${n}` },
    h('span', {}), WD.slice(0, n).map((x) => h('span', { class: 'days-head' }, x)),
    dirs.map((dir) => [
      h('span', { class: 'days-label' }, dir === 'hin' ? 'Hin' : 'Zurück'),
      WD.slice(0, n).map((x, i) => h('button', {
        type: 'button', class: `day-btn ${d[dir][i] ? 'on' : ''}`, 'aria-pressed': String(d[dir][i]), 'aria-label': `${x} ${dir === 'hin' ? 'hin' : 'zurück'}`,
        onclick: () => { d[dir][i] = !d[dir][i]; redraw(); },
      }, d[dir][i] ? icon('check', { size: 15 }) : '')),
    ]));
  const weekPicker = () => h('div', { class: 'week-chips' }, Array.from({ length: 20 }, (_, k) => addDays(thisWeek, k * 7)).map((mon) => {
    const free = weekDates(mon).slice(0, 5).every((date) => m.holiday(date));
    const on = d.weeks.has(mon);
    return h('button', { type: 'button', class: `week-chip ${on ? 'on' : ''} ${free ? 'free' : ''}`, onclick: () => { on ? d.weeks.delete(mon) : d.weeks.add(mon); redraw(); } },
      h('strong', {}, `KW ${isoWeek(mon).week}`), h('small', {}, free ? 'frei' : fmtDate(mon)));
  }));
  return h('div', { class: 'stack' },
    seg([['always', 'Jede Woche'], ['weeks', 'Bestimmte Wochen'], ['flex', 'Nach Absprache']], d.mode, (v) => { d.mode = v; redraw(); }),
    d.mode === 'flex' ? note('Kein fester Plan – jede Fahrt wird einzeln eingetragen.') : [
      d.mode === 'weeks' ? [
        seg([['every', 'Jede 2. Woche'], ['pick', 'Wochen wählen']], d.wopt, (v) => { d.wopt = v; redraw(); }),
        d.wopt === 'every'
          ? seg([['this', `ab dieser Woche`], ['next', 'ab nächster']], d.startNext ? 'next' : 'this', (v) => { d.startNext = v === 'next'; redraw(); })
          : weekPicker(),
      ] : null,
      grid,
      list(switchRow({ title: 'Auch am Wochenende', checked: d.weekend, onChange: (v) => { d.weekend = v; redraw(); } })),
    ],
    btn(saveLabel, { kind: 'primary', full: true, onClick: save }));
}

registerSheet('rhythm', ({ pid }) => {
  const p = personById(pid);
  if (!p) return null;
  return sheet({ title: pid === me() ? 'Mein Rhythmus' : `Rhythmus von ${p.name}`, sub: 'Gilt ab heute. In Ferien und an Feiertagen fährt nach Plan niemand.', body: rhythmEditor(pid, { onSaved: closeSheet }) });
});

// ---------- Abwesend ----------

const abs = { pid: null, reason: 'vacation', from: '', until: '' };

/** Abwesenheiten ansehen und eintragen (für Fenster und eingebettet). */
export function absenceEditor(pid, { onSaved } = {}) {
  if (abs.pid !== pid) Object.assign(abs, { pid, reason: 'vacation', from: todayIso(), until: '' });
  const p = personById(pid);
  const mine = pid === me();
  const redraw = () => update(() => {});
  const existing = absencesOf(p);
  const isDriver = model().dayInfo(abs.from || todayIso()).regular === pid;
  return h('div', { class: 'stack' },
    existing.length ? list(...existing.map((a) => row({
      title: REASONS[a.reason] || 'Abwesend', sub: span(a.from, a.until),
      trail: (a.src === 'profile' && mine && inGroup()) || (a.src !== 'profile' && isAdmin())
        ? h('button', { type: 'button', class: 'icon-btn danger', 'aria-label': 'Löschen', onclick: () => attempt(() => removeAbsence(pid, a.id)) }, icon('trash-2', { size: 16 })) : null,
    }))) : null,
    seg(Object.entries(REASONS), abs.reason, (v) => { abs.reason = v; redraw(); }),
    h('div', { class: 'two' },
      field('Von', h('input', { type: 'date', value: abs.from, onchange: (e) => { abs.from = e.target.value; if (abs.until && abs.until < abs.from) abs.until = abs.from; redraw(); } })),
      field('Bis', h('input', { type: 'date', value: abs.until, min: abs.from, onchange: (e) => { abs.until = e.target.value; redraw(); } }))),
    note(isDriver ? 'Als Fahrer: An diesen Tagen fallen die Fahrten aus – wer fahren kann, wird gefragt.' : `An diesen Tagen ${mine ? 'wirst du' : `wird ${p?.name}`} nicht abgeholt und ${mine ? 'zahlst' : 'zahlt'} nichts.`),
    btn('Eintragen', { kind: 'primary', full: true, onClick: () => attempt(() => addAbsence(pid, { from: abs.from, until: abs.until || abs.from, reason: abs.reason })).then((ok) => { if (ok) { abs.pid = null; toast('Eingetragen', 'ok'); onSaved?.(); } }) }));
}

registerSheet('absence', ({ pid }) => {
  const p = personById(pid);
  if (!p) return null;
  return sheet({ title: pid === me() ? 'Abwesend' : `${p.name} abwesend`, sub: 'Urlaub, krank, Praktikum', body: absenceEditor(pid, { onSaved: closeSheet }) });
});

