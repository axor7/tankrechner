// Kleine Bausteine rund um Personen: Kreis mit Initialen, „ohne App“, Texte zu Rhythmus und Abwesenheit.
import { state, personById, todayIso } from './state.js';
import { planFor, absenceOn } from './model.js';
import { inGroup, claims } from './account.js';
import { h, fmtDate } from './ui.js';

const WD = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];

export const initials = (name) => (name || '?').trim().split(/\s+/).map((x) => x[0]).join('').slice(0, 2).toUpperCase();

/** Hat die Person die App (einen Platz übernommen)? Ohne Fahrgemeinschaft: alle außer mir sind „Platzhalter“. */
export const hasApp = (pid) => inGroup() && claims().has(pid);
/** Platzhalter: in der Fahrgemeinschaft, aber (noch) ohne App – der Fahrer trägt für sie ein. */
export const isPlaceholder = (pid) => inGroup() && !claims().has(pid);

/** Runder Kreis mit Initialen in der Farbe der Person. size: 'sm' | 'md' | 'lg' */
export function avatar(pid, { size = 'md', driver = false, title } = {}) {
  const p = personById(pid);
  return h('span', {
    class: `avatar av-${size}${isPlaceholder(pid) ? ' ph' : ''}${driver ? ' drv' : ''}`, style: { '--pc': p?.color || 'var(--gray)' },
    title: title || p?.name || '', 'aria-hidden': 'true',
  }, initials(p?.name));
}

/** „ohne App“-Kennzeichen (nur in einer Fahrgemeinschaft). */
export const appTag = (pid) => (isPlaceholder(pid) ? h('span', { class: 'tag-noapp' }, 'ohne App') : null);

/** Wochentage kurz: „Mo–Fr“, „Mo, Mi“ */
export function daysText(arr) {
  const idx = arr.map((v, i) => (v ? i : -1)).filter((i) => i >= 0);
  if (!idx.length) return 'keine Tage';
  const run = idx.every((v, k) => k === 0 || v === idx[k - 1] + 1);
  return run && idx.length > 2 ? `${WD[idx[0]]} bis ${WD[idx[idx.length - 1]]}` : idx.map((i) => WD[i]).join(', ');
}

/** Rhythmus einer Person in Worten: „Immer · Mo bis Fr“, „Jede 2. Woche · Mo, Mi“, „Nach Absprache“ */
export function rhythmText(p, date = todayIso()) {
  if (!p?.plan?.length) return 'Noch nicht festgelegt';
  const v = planFor(p, date);
  if (v.mode === 'flex') return 'Nach Absprache';
  const a = daysText(v.hin);
  const b = daysText(v.rueck);
  const days = state.roundTrip === false || a === b ? a : `hin ${a} · zurück ${b}`;
  if (v.mode === 'weeks') return `${v.weeks?.length ? `${v.weeks.length} ausgewählte Wochen` : `Jede ${v.every || 2}. Woche`} · ${days}`;
  return `Immer · ${days}`;
}

export const REASONS = { vacation: 'Urlaub', sick: 'Krank', other: 'Abwesend' };

/** „02.11. – 06.11.“ */
export const spanText = (from, until) => (until && until !== from ? `${fmtDate(from)} – ${fmtDate(until)}` : fmtDate(from));

/** Kommende und laufende Abwesenheiten einer Person (sortiert). */
export function absencesOf(p, today = todayIso()) {
  return (p?.absences || []).filter((a) => !a.deleted && (a.until || a.from) >= today).sort((a, b) => a.from.localeCompare(b.from));
}

/** „Urlaub bis 06.11.“ / „Urlaub ab 02.11.“ oder null */
export function absenceText(p, today = todayIso()) {
  const now = absenceOn(p, today);
  if (now) return `${REASONS[now.reason] || 'Abwesend'} bis ${fmtDate(now.until || now.from)}`;
  const next = absencesOf(p, today)[0];
  return next ? `${REASONS[next.reason] || 'Abwesend'} ${spanText(next.from, next.until)}` : null;
}
