import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isActive, plannedPeople, plannedDriver, hasPattern } from '../js/plan.js';
import { weeklyDebts } from '../js/debts.js';

const mo = '2026-09-28'; const sa = '2026-10-03'; const mi = '2026-09-30';
const days = (...idx) => Array.from({ length: 7 }, (_, i) => idx.includes(i));

test('Ohne Regeltage: alle Aktiven Mo–Fr', () => {
  const persons = [{ id: 'a' }, { id: 'b', active: false }, { id: 'c', active: true }];
  assert.deepEqual(plannedPeople(persons, mo, 'hin'), ['a', 'c']);
  assert.deepEqual(plannedPeople(persons, sa, 'hin'), []);
  assert.equal(isActive(persons[1]), false);
});

test('Mit Regeltagen: nur wer an dem Tag fährt, Inaktive nie', () => {
  const persons = [
    { id: 'ich', pattern: { hin: days(0, 1, 2, 3, 4), rueck: days(0, 1, 2, 3, 4) } },
    { id: 'anna', pattern: { hin: days(0, 2), rueck: days(0) } },
    { id: 'ben' }, // ohne Regeltage: fährt nur, wenn eingetragen
    { id: 'clara', active: false, pattern: { hin: days(2), rueck: days(2) } },
  ];
  assert.ok(hasPattern(persons[0]));
  assert.deepEqual(plannedPeople(persons, mo, 'hin'), ['ich', 'anna']);
  assert.deepEqual(plannedPeople(persons, mi, 'hin'), ['ich', 'anna']);
  assert.deepEqual(plannedPeople(persons, mi, 'rueck'), ['ich']);
  assert.deepEqual(plannedPeople(persons, sa, 'hin'), []);
});

test('Fahrer der geplanten Fahrt', () => {
  assert.equal(plannedDriver(['a', 'b'], 'b'), 'b');
  assert.equal(plannedDriver(['a', 'b'], 'x'), 'a');
  assert.equal(plannedDriver([], 'x'), null);
});

test('Geplante Fahrten in der Zukunft sind noch nicht fällig', () => {
  const snap = { legs: [{ km: 100 }], consumption: 5, price: 2 };
  const trip = { driver: 'me', legs: [['me', 'anna']] };
  const weeks = { '2026-09-28': { snap, days: { '2026-09-28': { hin: trip }, '2026-10-01': { hin: trip } } } };
  assert.equal(weeklyDebts(weeks, {}, true, '2026-09-29')[0].amount, 5);
  assert.equal(weeklyDebts(weeks, {}, true)[0].amount, 10);
  assert.equal(weeklyDebts(weeks, {}, true, '2026-09-27').length, 0);
});
