// Planung: aktive/inaktive Mitfahrer und Regeltage („fährt normalerweise mit“).
// Reine Funktionen ohne DOM – werden auch getestet.
import { weekdayIndex } from './calc.js';

export const isActive = (p) => p?.active !== false;

/** Regeltage einer Person: { hin: [Mo..So], rueck: [Mo..So] } */
export function patternOf(p) {
  const empty = () => Array(7).fill(false);
  return { hin: p?.pattern?.hin?.slice(0, 7) || empty(), rueck: p?.pattern?.rueck?.slice(0, 7) || empty() };
}

export const hasPattern = (p) => { const pt = patternOf(p); return pt.hin.some(Boolean) || pt.rueck.some(Boolean); };

/**
 * Wer fährt an diesem Tag voraussichtlich mit?
 * Hat niemand Regeltage eingestellt, gilt wie früher: alle Aktiven Mo–Fr.
 */
export function plannedPeople(persons, date, dir) {
  const wd = weekdayIndex(date);
  const active = persons.filter(isActive);
  if (!active.some(hasPattern)) return wd < 5 ? active.map((p) => p.id) : [];
  return active.filter((p) => patternOf(p)[dir][wd]).map((p) => p.id);
}

/** Fahrer für einen geplanten Tag: Standardfahrer, wenn er dabei ist, sonst der Erste. */
export function plannedDriver(people, defaultDriver) {
  return people.includes(defaultDriver) ? defaultDriver : people[0] || null;
}
