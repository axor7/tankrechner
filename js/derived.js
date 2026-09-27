// Berechnete Werte für die Ansichten: Wochen, Kosten, offene Beträge, nächste Fahrten.
import { state, model, liveSnap, allRoutes, frozenWeeks, todayIso, personById } from './state.js';
import { deriveWeeks, effectivePayments, tripSnap } from './model.js';
import { calcTrip, aggregate, mondayOf, addDays, weekDates, isoWeek, DIRECTIONS } from './calc.js';
import { weeklyDebts, withPayments, openByPair, payKey } from './debts.js';
import { fmtDate } from './ui.js';

export const weekLabel = (monday) => `KW ${isoWeek(monday).week} (${fmtDate(monday)} – ${fmtDate(addDays(monday, 6))})`;
export const dirsNow = () => (state.roundTrip === false ? ['hin'] : DIRECTIONS);

/** Wochen im calc-Format (mit Fahrten und je eigener Strecke). */
export function weeks(fromMonday, toMonday, until) {
  return deriveWeeks(model(), fromMonday, toMonday, { frozen: frozenWeeks(), live: liveSnap(), routes: allRoutes(), until });
}

/** Erster Montag mit Daten. */
export function firstMonday() {
  const s = model().startDate();
  return s ? mondayOf(s) : mondayOf(todayIso());
}

/** Alle Fahrten eines Zeitraums als Einträge für calc.aggregate. */
export function entries(from, to) {
  const t0 = todayIso();
  const until = to < t0 ? to : t0; // Zukunft ist noch nicht fällig
  const out = [];
  const ws = weeks(mondayOf(from < firstMonday() ? firstMonday() : from), mondayOf(until), until);
  for (const w of Object.values(ws)) {
    for (const [date, d] of Object.entries(w.days)) {
      if (date < from || date > until) continue;
      for (const dir of dirsNow()) if (d[dir]) out.push({ trip: d[dir], snap: d[dir].snap, date, direction: dir });
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.direction.localeCompare(b.direction));
}

export const payments = () => effectivePayments(state.payments, state.profiles);

/** Alle Ausgleichszahlungen je Woche (bis heute), mit Bezahlt-Stand. */
export function debtItems() {
  const t0 = todayIso();
  const ws = weeks(firstMonday(), mondayOf(t0), t0);
  return withPayments(weeklyDebts(ws, state.split, state.roundTrip !== false, t0), payments());
}

export const openPairs = () => openByPair(debtItems());

/** Was ist für mich offen? { owe: [paar], get: [paar], oweTotal, getTotal } */
export function myBalance(me) {
  const pairs = openPairs();
  const owe = pairs.filter((p) => p.from === me);
  const get = pairs.filter((p) => p.to === me);
  return { owe, get, oweTotal: owe.reduce((a, p) => a + p.total, 0), getTotal: get.reduce((a, p) => a + p.total, 0) };
}

/** Kosten einer Fahrt (inkl. Anteil je Person). */
export function tripResult(date, dir) {
  const m = model();
  const t = m.trip(date, dir);
  if (!t) return null;
  const monday = mondayOf(date);
  const week = frozenWeeks()[monday] || liveSnap();
  const names = Object.fromEntries(m.persons.map((p) => [p.id, p.name]));
  t.snap = tripSnap(week, t, allRoutes(), names);
  return { trip: t, result: calcTrip(t, t.snap, state.split, dir) };
}

/** Meine Kosten in einer Woche: bisher (fällig) und geplant (Zukunft). */
export function myWeek(me, monday) {
  const t0 = todayIso();
  let done = 0;
  let planned = 0;
  let trips = 0;
  for (const date of weekDates(monday)) {
    for (const dir of dirsNow()) {
      const r = tripResult(date, dir);
      const share = r?.result.shares[me];
      if (!share) continue;
      trips++;
      if (date <= t0) done += share; else planned += share;
    }
  }
  return { done, planned, trips };
}

/** Nächste Tage (ab heute), an denen jemand fährt – zusammengefasst je Tag. me: nur Tage, an denen ich dabei bin. */
export function nextDays(me, limit = 5, horizon = 42) {
  const m = model();
  const out = [];
  const t0 = todayIso();
  for (let k = 0; k < horizon && out.length < limit; k++) {
    const date = addDays(t0, k);
    const info = m.dayInfo(date);
    const dirs = dirsNow().filter((dir) => info.driver[dir] && info.riders[dir].length && (!me || info.riders[dir].includes(me)));
    if (!dirs.length) continue;
    const people = [...new Set(dirs.flatMap((dir) => info.riders[dir]))];
    const driver = info.driver[dirs[0]];
    const share = me ? dirs.reduce((a, dir) => a + (tripResult(date, dir)?.result.shares[me] || 0), 0) : 0;
    out.push({ date, dirs, people, driver, share });
  }
  return out;
}

/** Was kostet mich eine Fahrt (Hin) typischerweise? Nächste Fahrt, sonst ganze Fahrt geteilt durch die üblichen Mitfahrer. */
export function perTrip(me) {
  const t0 = todayIso();
  for (let k = 0; k < 42; k++) {
    const date = addDays(t0, k);
    for (const dir of dirsNow()) {
      const r = tripResult(date, dir);
      if (r && (!me || r.result.shares[me])) return { mine: me ? r.result.shares[me] : null, total: r.result.total, date, dir };
    }
  }
  return null;
}

export { payKey, personById, aggregate };
