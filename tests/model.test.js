import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildModel, planFor, withPlanVersion, mergePersons, deriveWeeks, liveWeekSnap, tripSnap, effectivePayments, effectiveOrder, migrateV1 } from '../js/model.js';
import { calcTrip, routeKey } from '../js/calc.js';
import { weeklyDebts } from '../js/debts.js';

const d = (...idx) => Array.from({ length: 7 }, (_, i) => idx.includes(i));
const MOFR = d(0, 1, 2, 3, 4);
// 28.09.2026 = Montag
const MO = '2026-09-28'; const DI = '2026-09-29'; const MI = '2026-09-30';

const shared = () => ({
  defaultDriver: 'max',
  roundTrip: true,
  persons: [
    { id: 'max', name: 'Max', plan: [{ from: '2026-09-01', hin: MOFR, rueck: MOFR, at: 1 }], address: { label: 'Start', lat: 49.0, lng: 8.4, at: 1 } },
    { id: 'anna', name: 'Anna', plan: [{ from: '2026-09-01', hin: d(0, 2), rueck: d(0), at: 1 }] },
    { id: 'ben', name: 'Ben', plan: [] }, // fährt nur ab und zu mit (keine festen Tage)
  ],
  days: {},
  car: { consumption: 10, extraPerKm: 0 },
  destination: { label: 'Arbeit', lat: 49.0, lng: 8.9 },
});

test('Regelplan: jüngste gültige Version zählt, Änderung gilt erst ab ihrem Datum', () => {
  const p = { plan: withPlanVersion([{ from: '2026-09-01', hin: MOFR, rueck: MOFR, at: 1 }], '2026-09-30', d(0), d(0), 5) };
  assert.equal(planFor(p, '2026-09-29').hin[1], true); // Di vor der Änderung
  assert.equal(planFor(p, '2026-10-06').hin[1], false); // Di danach
  assert.equal(planFor(p, '2026-08-01').hin[0], false); // vor dem ersten Plan
});

test('Wer fährt: Plan, ohne feste Tage, Tages-Änderung, freier Tag', () => {
  const s = shared();
  let m = buildModel(s);
  assert.deepEqual(m.dayInfo(MO).riders.hin, ['max', 'anna']);
  assert.deepEqual(m.dayInfo(MO).riders.rueck, ['max', 'anna']);
  assert.deepEqual(m.dayInfo(MI).riders.rueck, ['max']);
  assert.deepEqual(m.dayInfo(DI).riders.hin, ['max']); // Ben hat keine festen Tage
  s.days[DI] = { people: { anna: { hin: true, at: 2 } } };
  s.days[MO] = { off: true };
  m = buildModel(s);
  assert.deepEqual(m.dayInfo(DI).riders.hin, ['max', 'anna']);
  assert.equal(m.trip(MO, 'hin'), null);
});

test('Profil-Änderung gegen Admin-Änderung: die jüngere gewinnt', () => {
  const s = shared();
  s.days[MO] = { people: { anna: { hin: false, at: 10 } } };
  const profiles = [{ userId: 'u1', personId: 'anna', data: { days: { [MO]: { hin: true, at: 20 } } } }];
  assert.equal(buildModel(s, profiles).rides('anna', MO, 'hin'), true);
  profiles[0].data.days[MO].at = 5;
  assert.equal(buildModel(s, profiles).rides('anna', MO, 'hin'), false);
});

test('Ohne Fahrer keine Fahrt; anderer Fahrer pro Tag', () => {
  const s = shared();
  s.days[DI] = { people: { max: { hin: false, at: 1 }, anna: { hin: true, at: 1 } } };
  assert.equal(buildModel(s).trip(DI, 'hin'), null);
  s.days[DI].driver = { hin: 'anna' };
  assert.deepEqual(buildModel(s).trip(DI, 'hin'), { driver: 'anna', legs: [['anna']] });
});

test('Profile: Adresse, Regelplan, selbst angelegte Person', () => {
  const persons = mergePersons(shared().persons, [
    { userId: 'u1', personId: 'anna', data: { address: { label: 'Anna Str.', lat: 49, lng: 8.6, at: 3 } } },
    { userId: 'u2', personId: 'u:u2', data: { name: 'Clara', color: '#f00', plan: [{ from: '2026-09-20', hin: MOFR, rueck: MOFR, at: 3 }] } },
  ]);
  assert.equal(persons.find((p) => p.id === 'anna').address.label, 'Anna Str.');
  const clara = persons.find((p) => p.id === 'u:u2');
  assert.equal(clara.name, 'Clara');
  assert.equal(planFor(clara, MO).hin[0], true);
});

test('Strecke je Fahrt: Fahrer → Abholpunkte → Ziel; jeder zahlt ab seiner Adresse', () => {
  const s = shared();
  s.persons[1].address = { label: 'Anna', lat: 49.0, lng: 8.6 };
  s.persons.push({ id: 'cl', name: 'Clara', plan: [{ from: '2026-09-01', hin: MOFR, rueck: MOFR }], address: { label: 'Clara', lat: 49.0, lng: 8.7 } });
  s.order = ['cl', 'anna']; // von Hand: erst Clara, dann Anna
  const m = buildModel(s);
  const week = liveWeekSnap(s, m.persons, 1);
  assert.deepEqual(week.order, ['cl', 'anna']);
  const t = m.trip(MO, 'hin');
  const snap = tripSnap(week, t, {}, { max: 'Max', anna: 'Anna', cl: 'Clara' });
  assert.deepEqual(snap.stops.map((x) => x.id), ['p:max', 'p:cl', 'p:anna', 'dest']);
  // Strecken bekannt: Max→Clara 30 km, Clara→Anna 10 km, Anna→Arbeit 20 km (0,10 €/km)
  snap.routes[routeKey(snap.stops)] = [{ km: 30 }, { km: 10 }, { km: 20 }];
  const r = calcTrip(t, snap, {}, 'hin');
  assert.equal(Math.round(r.total * 100), 600);
  assert.equal(Math.round(r.shares.max * 100), 300 + 50 + 67); // 3 + 1/2 + 2/3
  assert.equal(Math.round(r.shares.anna * 100), 67);
  assert.equal(Math.round(r.shares.cl * 100), 50 + 67);
});

test('Rückweg: eigene Reihenfolge, sonst umgekehrt', () => {
  const s = shared();
  s.persons[1].address = { label: 'Anna', lat: 49.0, lng: 8.6 };
  s.persons.push({ id: 'cl', name: 'Clara', plan: [{ from: '2026-09-01', hin: MOFR, rueck: MOFR }], address: { label: 'Clara', lat: 49.0, lng: 8.7 } });
  const m = buildModel(s);
  const t = m.trip(MO, 'rueck');
  let snap = tripSnap(liveWeekSnap(s, m.persons, 1), t);
  assert.deepEqual(snap.returnOrder, ['dest', 'p:cl', 'p:anna', 'p:max']);
  s.returnOrder = ['anna', 'cl'];
  snap = tripSnap(liveWeekSnap(s, m.persons, 1), t);
  assert.deepEqual(snap.returnOrder, ['dest', 'p:anna', 'p:cl', 'p:max']);
});

test('Ohne Adressen: manuelle Kilometer, alle zahlen die ganze Strecke', () => {
  const s = shared();
  delete s.persons[0].address;
  s.manualKm = 50;
  const m = buildModel(s);
  const t = m.trip(MO, 'hin');
  const r = calcTrip(t, tripSnap(liveWeekSnap(s, m.persons, 2), t), {}, 'hin');
  assert.equal(r.total, 10); // 50 km × 0,1 l × 2 €
  assert.equal(r.shares.anna, 5);
});

test('Abrechnung über abgeleitete Wochen; eingefrorene Woche behält ihren Preis', () => {
  const s = shared();
  delete s.persons[0].address;
  s.manualKm = 50;
  const m = buildModel(s);
  const live = liveWeekSnap(s, m.persons, 2);
  const frozen = { '2026-09-21': { ...live, price: 1 } };
  const weeks = deriveWeeks(m, '2026-09-21', '2026-09-28', { frozen, live, until: MO });
  const debts = weeklyDebts(weeks, {}, true, MO);
  const byWeek = Object.fromEntries(debts.map((x) => [x.week, x.amount]));
  // KW 39 (21.–25.09., Preis 1 €): Anna Mo hin/zurück + Mi hin = 3 Fahrten × 2,50 €
  assert.equal(byWeek['2026-09-21'], 7.5);
  // KW 40 bis Montag (Preis 2 €): Mo hin + zurück = 2 × 5 €
  assert.equal(byWeek['2026-09-28'], 10);
});

test('Zahlungen: Profil-Meldung nur von Beteiligten, Admin kann zurücknehmen', () => {
  const k = '2026-09-21|anna|max';
  const profiles = [
    { personId: 'anna', data: { paid: { [k]: { amount: 7.5, at: 5 } } } },
    { personId: 'ben', data: { paid: { '2026-09-21|clara|max': { amount: 1, at: 5 } } } },
  ];
  let p = effectivePayments({}, profiles);
  assert.ok(p[k]);
  assert.equal(p['2026-09-21|clara|max'], undefined);
  p = effectivePayments({ [k]: { revoked: true, at: 9 } }, profiles);
  assert.equal(p[k], undefined);
});

test('Abholreihenfolge: von Hand > berechnet > Liste; Fahrer nie dabei', () => {
  const persons = [{ id: 'max', address: { lat: 1, lng: 1 } }, { id: 'a', address: { lat: 1, lng: 2 } }, { id: 'b', address: { lat: 1, lng: 3 } }, { id: 'c' }];
  assert.deepEqual(effectiveOrder({ defaultDriver: 'max' }, persons), ['a', 'b']);
  assert.deepEqual(effectiveOrder({ defaultDriver: 'max', optimizedOrder: ['b', 'a'] }, persons), ['b', 'a']);
  assert.deepEqual(effectiveOrder({ defaultDriver: 'max', optimizedOrder: ['b', 'a'], order: ['a'] }, persons), ['a', 'b']);
});

test('Umstieg von Version 1: Fahrten werden zu Tages-Einträgen', () => {
  const v1 = {
    defaultDriver: 'max',
    persons: [{ id: 'max', name: 'Max' }, { id: 'anna', name: 'Anna', pattern: { hin: MOFR, rueck: MOFR } }],
    stops: [
      { id: 's1', label: 'Start, Ort', lat: 49, lng: 8.4, owners: ['max'] },
      { id: 's2', label: 'Anna, Ort', lat: 49, lng: 8.6, owners: ['anna'] },
      { id: 's3', label: 'Arbeit, Ort', lat: 49, lng: 8.9, owners: [] },
    ],
    weeks: { '2026-09-21': { snap: { consumption: 6, price: 1.8, legs: [], stops: [] }, days: { '2026-09-21': { hin: { driver: 'max', legs: [['max', 'anna']] }, rueck: { driver: 'max', legs: [['max']] } } } } },
  };
  const v2 = migrateV1(v1, '2026-09-27');
  assert.equal(v2.schema, 2);
  assert.equal(v2.destination.label, 'Arbeit, Ort');
  assert.equal(v2.persons[1].address.label, 'Anna, Ort');
  assert.deepEqual(v2.order, ['anna']);
  const m = buildModel(v2);
  assert.deepEqual(m.dayInfo('2026-09-21').riders.hin, ['max', 'anna']);
  assert.deepEqual(m.dayInfo('2026-09-21').riders.rueck, ['max']);
  assert.equal(v2.weeks['2026-09-21'].snap.price, 1.8);
  // Regelplan gilt ab heute
  assert.equal(planFor(v2.persons[1], '2026-09-28').hin[0], true);
  assert.equal(planFor(v2.persons[1], '2026-09-22').hin[1], false);
});

// ---------- Vergangene Wochen dürfen sich nicht ändern ----------
import { driverAt } from '../js/model.js';

const pastCost = (s, until = '2026-09-25') => {
  const m = buildModel(s);
  const live = liveWeekSnap(s, m.persons, 2);
  const frozen = { '2026-09-21': liveWeekSnap(s, m.persons, 2) };
  return weeklyDebts(deriveWeeks(m, '2026-09-21', '2026-09-21', { frozen, live, until }), {}, true, until);
};

test('Regelplan-Änderung heute ändert vergangene Wochen nicht', () => {
  const s = shared();
  delete s.persons[0].address;
  s.manualKm = 50;
  const before = pastCost(s);
  // Anna fährt ab 28.09. gar nicht mehr
  s.persons[1].plan = withPlanVersion(s.persons[1].plan, '2026-09-28', Array(7).fill(false), Array(7).fill(false));
  assert.deepEqual(pastCost(s), before);
});

test('Fahrerwechsel gilt erst ab seinem Datum', () => {
  const s = shared();
  s.persons[1].plan = [{ from: '2026-09-01', hin: MOFR, rueck: MOFR }];
  s.drivers = [{ from: '2026-09-01', id: 'max' }, { from: '2026-09-28', id: 'anna', at: 2 }];
  s.defaultDriver = 'anna';
  assert.equal(driverAt(s, '2026-09-25'), 'max');
  assert.equal(driverAt(s, '2026-09-28'), 'anna');
  const m = buildModel(s);
  assert.equal(m.trip('2026-09-25', 'hin').driver, 'max');
  assert.equal(m.trip('2026-09-28', 'hin').driver, 'anna');
});

test('Aufteilungsregel wird mit der Woche eingefroren', () => {
  const s = shared();
  delete s.persons[0].address;
  s.manualKm = 50;
  s.split = { mode: 'segment', driverPays: true };
  const m = buildModel(s);
  const frozen = { '2026-09-21': liveWeekSnap(s, m.persons, 2) };
  s.split = { mode: 'segment', driverPays: false }; // später geändert
  const live = liveWeekSnap(s, m.persons, 2);
  const debts = weeklyDebts(deriveWeeks(m, '2026-09-21', '2026-09-28', { frozen, live, until: MO }), s.split, true, MO);
  const byWeek = Object.fromEntries(debts.map((x) => [x.week, x.amount]));
  assert.equal(byWeek['2026-09-21'], 15); // alte Regel: Fahrer zahlt mit → Anna die Hälfte von 3 × 10 €
  assert.equal(byWeek['2026-09-28'], 20); // neue Regel: Anna zahlt alles (2 × 10 €)
});

test('Früheres „inaktiv“ wird ignoriert (galt rückwirkend)', () => {
  const persons = mergePersons([{ id: 'x', active: false, plan: [{ from: '2026-09-01', hin: MOFR, rueck: MOFR }] }]);
  assert.equal(persons[0].active, undefined);
});

test('Entfernte Person: vorher mitgefahren zählt, ab dem Entfernen nie mehr – auch nicht über eigene Tage', () => {
  const s = shared();
  Object.assign(s.persons[1], { archived: true, archivedFrom: DI });
  const profiles = [{ user_id: 'u', person_id: 'anna', data: { days: { [MI]: { hin: true, at: 99 } } } }];
  const m = buildModel(s, profiles);
  assert.ok(m.rides('anna', MO, 'hin'));
  assert.ok(!m.rides('anna', MI, 'hin'));
  assert.ok(!m.dayInfo(MI).riders.hin.includes('anna'));
});
