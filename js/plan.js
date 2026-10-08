// Fragen rund um den Plan, die mehrere Bildschirme stellen: Wann ist die nächste Fahrt? Wann werde ich abgeholt?
// Fällt ein Fahrer aus? Welche fahrfreien Zeiten kommen? Wie heißt der Rhythmus in Worten?
import { state, model, personById, todayIso } from './state.js';
import { addDays, resolveLegs, stopTimes, parseTime, weekdayIndex } from './calc.js';
import { planFor, planOn, absenceOn } from './model.js';
import { tripResult, dirsNow } from './derived.js';
import { fmtDate } from './ui.js';

const WD = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
const MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
const WD_LONG = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'];

export const REASONS = { vacation: 'Urlaub', sick: 'Krank', other: 'Abwesend' };
export const nameOf = (pid) => personById(pid)?.name || '?';
export const shortLabel = (label) => (label ? String(label).split(',')[0] : '');

/** „Freitag, 9. Oktober“ */
export function longDay(iso) {
  const [, m, d] = iso.split('-').map(Number);
  return `${WD_LONG[weekdayIndex(iso)]}, ${d}. ${MONTHS[m - 1]}`;
}

/** „Heute“, „Morgen“ oder „Freitag, 9. Oktober“ */
export function relDay(iso) {
  const t0 = todayIso();
  if (iso === t0) return 'Heute';
  if (iso === addDays(t0, 1)) return 'Morgen';
  return longDay(iso);
}

/** „12.–24.10.“ bzw. „09.10.“ */
export function span(from, until) {
  if (!until || until === from) return fmtDate(from);
  const [, m1, d1] = from.split('-').map(Number);
  const [, m2] = until.split('-').map(Number);
  return m1 === m2 ? `${d1}.–${fmtDate(until)}` : `${fmtDate(from)}–${fmtDate(until)}`;
}

export const weekdayShort = (iso) => WD[weekdayIndex(iso)];

/** Wochentage kurz: „Mo–Fr“, „Mo, Mi“ */
export function daysText(arr) {
  const idx = arr.map((v, i) => (v ? i : -1)).filter((i) => i >= 0);
  if (!idx.length) return 'keine Tage';
  const run = idx.every((v, k) => k === 0 || v === idx[k - 1] + 1);
  return run && idx.length > 2 ? `${WD[idx[0]]}–${WD[idx[idx.length - 1]]}` : idx.map((i) => WD[i]).join(', ');
}

/** Rhythmus in Worten: „Mo–Fr“, „Jede 2. Woche · Mo–Fr“, „Nach Absprache“, „hin Mo–Fr · zurück Mo–Mi“ */
export function rhythmText(p) {
  if (!p?.plan?.length) return 'Noch nicht festgelegt';
  const v = planFor(p, todayIso());
  if (v.mode === 'flex') return 'Nach Absprache';
  const a = daysText(v.hin);
  const b = daysText(v.rueck);
  const days = state.roundTrip === false || a === b ? a : `hin ${a} · zurück ${b}`;
  if (v.mode === 'weeks') return `${v.weeks?.length ? `${v.weeks.length} ausgewählte Wochen` : `Jede ${v.every || 2}. Woche`} · ${days}`;
  return days;
}

/** Kommende und laufende Abwesenheiten (sortiert). */
export function absencesOf(p, today = todayIso()) {
  return (p?.absences || []).filter((a) => !a.deleted && (a.until || a.from) >= today).sort((a, b) => a.from.localeCompare(b.from));
}

/** „Urlaub bis 06.11.“ / „Urlaub 02.–06.11.“ oder null */
export function absenceText(p, today = todayIso()) {
  const now = absenceOn(p, today);
  if (now) return `${REASONS[now.reason] || 'Abwesend'} bis ${fmtDate(now.until || now.from)}`;
  const next = absencesOf(p, today)[0];
  return next ? `${REASONS[next.reason] || 'Abwesend'} ${span(next.from, next.until)}` : null;
}

/** Nächste fahrfreie Zeiträume (Schulferien, Feiertage, eigene) ab heute. */
export function upcomingFree(limit = 5) {
  const t0 = todayIso();
  const hol = state.holidays || {};
  const out = [];
  if (hol.enabled) for (const p of hol.periods || []) if (p.end >= t0 && (!hol.from || p.end >= hol.from)) out.push({ ...p, kind: 'school' });
  if (hol.public?.enabled) for (const p of hol.public.periods || []) if (p.end >= t0 && (!hol.public.from || p.end >= hol.public.from)) out.push({ ...p, kind: 'public' });
  for (const p of state.offPeriods || []) if ((p.until || p.from) >= t0) out.push({ start: p.from, end: p.until || p.from, name: p.name, kind: 'custom', id: p.id });
  return out.sort((a, b) => a.start.localeCompare(b.start)).slice(0, limit);
}

/** Ist die heutige Fahrt schon vorbei? (eine Stunde nach der Rückfahrt, ohne Uhrzeit ab 18 Uhr) */
export function todayDone() {
  const now = new Date();
  const min = now.getHours() * 60 + now.getMinutes();
  const end = parseTime(state.times?.leave) ?? parseTime(state.times?.arrive);
  return min > (end != null ? end + 60 : 18 * 60);
}

/** Der nächste Tag mit einer Fahrt der Gruppe, ohne Fahrer, oder an dem ich laut Plan dabei wäre. */
export function nextRideDate(mine, horizon = 60) {
  const m = model();
  const t0 = todayIso();
  const p = personById(mine);
  for (let k = 0; k < horizon; k++) {
    const date = addDays(t0, k);
    if (k === 0 && todayDone()) continue;
    const info = m.dayInfo(date);
    if (info.off) continue;
    const dirs = dirsNow();
    const ride = dirs.some((dir) => info.riders[dir]?.length);
    const planned = p && !info.free && dirs.some((dir) => planOn(p, date)[dir][weekdayIndex(date)]);
    if (ride || planned) return date;
  }
  return null;
}

/** Stopps einer Fahrt mit Uhrzeiten: { trip, result, stops: [{ name, owners, via, time }] } oder null. */
export function timedStops(date, dir) {
  const r = tripResult(date, dir);
  if (!r) return null;
  const res = resolveLegs(r.trip, r.trip.snap, dir);
  const times = res.stops?.length ? stopTimes(res.legs, dir, state.times || {}) : null;
  return { trip: r.trip, result: r.result, stops: (res.stops || []).map((s, i) => ({ ...s, time: times ? times[i] : null })) };
}

/** Uhrzeit einer Person an diesem Tag (Abholung hin / Ankunft zu Hause zurück) oder null. */
export function personTime(ts, pid) {
  const s = ts?.stops?.find((x) => x.owners?.includes(pid));
  return s?.time ?? null;
}

/** Tage in den nächsten zwei Wochen ohne Fahrer, gruppiert nach normalem Fahrer: [{ regular, dates }] */
export function driverGaps(horizon = 14) {
  const m = model();
  const t0 = todayIso();
  const out = new Map();
  for (let k = 0; k < horizon; k++) {
    const date = addDays(t0, k);
    const info = m.dayInfo(date);
    if (info.off || !dirsNow().some((dir) => info.riders[dir]?.length && !info.driver[dir])) continue;
    if (!out.has(info.regular)) out.set(info.regular, []);
    out.get(info.regular).push(date);
  }
  return [...out.entries()].map(([regular, dates]) => ({ regular, dates }));
}

/** „Fr 09.10.“ bzw. „09.–13.10.“ */
export const datesText = (dates) => (dates.length === 1 ? `${weekdayShort(dates[0])} ${fmtDate(dates[0])}` : span(dates[0], dates[dates.length - 1]));
