// Offene Beträge: Ausgleichszahlungen je Woche und was davon schon bezahlt ist.
// Reine Funktionen ohne DOM – werden auch getestet.
import { aggregate, settle, DIRECTIONS } from './calc.js';

const cents = (v) => Math.round(v * 100);

/** Schlüssel einer Zahlung: Woche (Montag) + wer an wen. */
export const payKey = (week, from, to) => `${week}|${from}|${to}`;

/**
 * Ausgleichszahlungen pro Woche.
 * weeks: state.weeks, opts: Aufteilungsregeln, roundTrip: Rückfahrten mitzählen?, until: nur Fahrten bis zu diesem Tag
 * → [{ key, week, from, to, amount, trips, km }]
 */
export function weeklyDebts(weeks, opts = {}, roundTrip = true, until = '9999-12-31') {
  const dirs = roundTrip ? DIRECTIONS : ['hin'];
  const out = [];
  for (const [week, w] of Object.entries(weeks)) {
    const entries = [];
    for (const [date, d] of Object.entries(w.days)) {
      if (date > until) continue; // geplante Fahrten in der Zukunft sind noch nicht fällig
      for (const dir of dirs) if (d[dir]) entries.push({ trip: d[dir], snap: w.snap, date, direction: dir });
    }
    if (!entries.length) continue;
    const agg = aggregate(entries, opts);
    for (const t of settle(agg.persons)) {
      const x = agg.persons[t.from];
      out.push({ key: payKey(week, t.from, t.to), week, from: t.from, to: t.to, amount: t.amount, trips: x?.trips || 0, km: x?.km || 0 });
    }
  }
  return out.sort((a, b) => a.week.localeCompare(b.week));
}

/**
 * Verknüpft Schulden mit Zahlungen ({ [key]: { amount, at } }).
 * open = noch offener Rest (z. B. wenn sich die Woche nach dem Bezahlen geändert hat).
 */
export function withPayments(debts, payments = {}) {
  return debts.map((d) => {
    const paid = payments[d.key]?.amount || 0;
    const open = Math.max(0, cents(d.amount) - cents(paid)) / 100;
    return { ...d, paid, open, paidAt: payments[d.key]?.at || null };
  });
}

/** Nach Paaren (wer → an wen) gruppieren, nur mit offenen Beträgen. */
export function openByPair(items) {
  const pairs = new Map();
  for (const d of items) {
    if (d.open <= 0) continue;
    const k = `${d.from}|${d.to}`;
    if (!pairs.has(k)) pairs.set(k, { from: d.from, to: d.to, items: [], total: 0 });
    const p = pairs.get(k);
    p.items.push(d);
    p.total = (cents(p.total) + cents(d.open)) / 100;
  }
  return [...pairs.values()].sort((a, b) => b.total - a.total);
}

/** Als bezahlt markieren: Zahlungen-Objekt mit den vollen aktuellen Beträgen. */
export function markPaid(payments, items, at = Date.now()) {
  const next = { ...payments };
  for (const d of items) next[d.key] = { amount: d.amount, at };
  return next;
}
