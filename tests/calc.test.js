import { test } from 'node:test';
import assert from 'node:assert/strict';
import { legCost, calcTrip, aggregate, settle, directedLegs, isoWeek, mondayOf, weekDates, addDays } from '../js/calc.js';
import { bestWindow, profileFromObservations, TYPICAL_CURVE } from '../js/fueltimes.js';

const snap = {
  legs: [{ from: 'A', to: 'S', km: 20 }, { from: 'S', to: 'B', km: 80 }],
  consumption: 5, price: 2, extraPerKm: 0,
};
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);

test('legCost: Liter und Euro', () => {
  const c = legCost(100, { consumption: 6, price: 1.8, extraPerKm: 5 });
  close(c.liters, 6);
  close(c.fuel, 10.8);
  close(c.extra, 5);
  close(c.total, 15.8);
});

test('Teilstrecken: Zusteiger zahlt nur ab Zwischenstopp', () => {
  // Strecke A→S kostet 2 €, S→B kostet 8 €
  const trip = { driver: 'me', legs: [['me'], ['me', 'ben']] };
  const r = calcTrip(trip, snap);
  close(r.total, 10);
  close(r.shares.me, 2 + 4);
  close(r.shares.ben, 4);
  close(r.kmPerPerson.ben, 80);
});

test('Fahrer ist immer dabei, auch wenn nicht eingetragen', () => {
  const r = calcTrip({ driver: 'me', legs: [['anna'], ['anna']] }, snap);
  close(r.shares.me, 5);
  close(r.shares.anna, 5);
});

test('Fahrer zahlt nicht mit', () => {
  const r = calcTrip({ driver: 'me', legs: [['me', 'a'], ['me', 'a', 'b']] }, snap, { driverPays: false });
  close(r.shares.a, 2 + 4);
  close(r.shares.b, 4);
  assert.equal(r.shares.me, undefined);
  // allein im Auto → Fahrer zahlt doch selbst
  const alone = calcTrip({ driver: 'me', legs: [['me'], ['me']] }, snap, { driverPays: false });
  close(alone.shares.me, 10);
});

test('Modus gleich pro Fahrt', () => {
  const r = calcTrip({ driver: 'me', legs: [['me'], ['me', 'ben']] }, snap, { mode: 'equal' });
  close(r.shares.me, 5);
  close(r.shares.ben, 5);
});

test('Route geändert: Fahrt mit falscher Leg-Anzahl nutzt alle Mitfahrer', () => {
  const r = calcTrip({ driver: 'me', legs: [['me', 'a', 'b']] }, snap);
  close(r.shares.a, 10 / 3);
});

test('Rückfahrt: Teilstrecken umgekehrt', () => {
  const legs = directedLegs(snap.legs, 'rueck');
  assert.deepEqual(legs.map((l) => `${l.from}-${l.to}-${l.legIndex}`), ['B-S-1', 'S-A-0']);
});

test('Woche: nur hin / nur zurück wird fair verrechnet und ausgeglichen', () => {
  const s1 = { legs: [{ from: 'A', to: 'B', km: 100 }], consumption: 5, price: 2 }; // 10 € pro Fahrt
  const entries = [
    { trip: { driver: 'me', legs: [['me', 'a', 'b', 'c']] }, snap: s1 }, // 2,50 € p. P.
    { trip: { driver: 'me', legs: [['me', 'a', 'b']] }, snap: s1 }, // c nicht mit zurück: 3,33 €
    { trip: { driver: 'a', legs: [['a', 'me']] }, snap: s1 }, // Anna fährt: 5 € p. P.
  ];
  const agg = aggregate(entries);
  close(agg.total, 30);
  close(agg.persons.c.share, 2.5);
  close(agg.persons.me.paid, 20);
  close(agg.persons.a.paid, 10);
  const sumBal = Object.values(agg.persons).reduce((s, p) => s + p.balance, 0);
  close(sumBal, 0);
  const t = settle(agg.persons);
  const total = (id, dir) => t.filter((x) => x[dir] === id).reduce((s, x) => s + x.amount, 0);
  // me: bezahlt 20, Anteil 2.5+3.333+5=10.833 → bekommt 9.17
  // 9,1667 € → 9,16 oder 9,17 (ein Cent Rundungsausgleich)
  assert.ok(Math.abs(Math.round(total('me', 'to') * 100) - 917) <= 1);
  assert.equal(Math.round(total('c', 'from') * 100), 250);
  const paidOut = t.reduce((s, x) => s + Math.round(x.amount * 100), 0);
  assert.equal(paidOut, Math.round(total('me', 'to') * 100) + Math.round(total('a', 'to') * 100));
  assert.ok(t.every((x) => x.amount > 0));
});

test('settle: Summe geht auf den Cent auf', () => {
  const persons = { a: { balance: 10 / 3 * 2 }, b: { balance: -10 / 3 }, c: { balance: -10 / 3 } };
  const t = settle(persons);
  const got = t.filter((x) => x.to === 'a').reduce((s, x) => s + x.amount, 0);
  assert.equal(Math.round(got * 100), Math.round(t.reduce((s, x) => s + x.amount, 0) * 100));
  assert.equal(t.length, 2);
});

test('Kalenderwochen', () => {
  assert.deepEqual(isoWeek('2026-09-25'), { year: 2026, week: 39 });
  assert.deepEqual(isoWeek('2027-01-01'), { year: 2026, week: 53 });
  assert.deepEqual(isoWeek('2025-12-29'), { year: 2026, week: 1 });
  assert.equal(mondayOf('2026-09-27'), '2026-09-21');
  assert.equal(weekDates('2026-09-21')[6], '2026-09-27');
  assert.equal(addDays('2026-10-31', 1), '2026-11-01');
});

test('Beste Tankzeit liegt am Abend', () => {
  const w = bestWindow(TYPICAL_CURVE, 2);
  assert.ok(w.start >= 18 && w.start <= 21, `start ${w.start}`);
});

test('Eigene Messungen → Stundenprofil', () => {
  const day = (h) => new Date(2026, 8, 20, h).getTime();
  const obs = [
    { t: day(7), sid: 'x', fuel: 'e10', price: 1.85 },
    { t: day(20), sid: 'x', fuel: 'e10', price: 1.75 },
    { t: day(7), sid: 'x', fuel: 'diesel', price: 1.7 },
  ];
  const p = profileFromObservations(obs, 'e10');
  close(p.curve[7], 10);
  close(p.curve[20], 0);
  assert.equal(p.curve[12], null);
});
