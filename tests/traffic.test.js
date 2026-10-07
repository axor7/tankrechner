import { test } from 'node:test';
import assert from 'node:assert/strict';
import { autobahnRefs, parseTimes, timeStatus, isCurrent, statusText, fmtRemaining, normalize, alongRoute } from '../js/traffic.js';

const at = (y, m, d, hh = 0, mm = 0) => new Date(y, m - 1, d, hh, mm);

test('Autobahnen aus den Straßennummern des Routenplaners', () => {
  assert.deepEqual(autobahnRefs(['A 8', 'A 5;E 35', 'B 14', 'A 831', 'A 8', 'L 1014', '']), ['A8', 'A5', 'A831']);
});

test('Zeiten: Bauphase, Gesamtmaßnahme, Zeitfenster, wiederkehrend', () => {
  let t = parseTimes(['Zeitraum dieser Bauphase:', 'Beginn: 31.07.26 um 08:30 Uhr', 'Ende: 01.05.27 um 00:00 Uhr', '(Ende der Gesamtmaßnahme: 01.05.27)']);
  assert.deepEqual(t.start, at(2026, 7, 31, 8, 30));
  assert.deepEqual(t.end, at(2027, 5, 1));
  assert.deepEqual(t.overallEnd, at(2027, 5, 1, 23, 59));

  t = parseTimes(['07.10.26 22:00 bis zum 08.10.26 05:00 Uhr.', '08.10.26 22:00 bis zum 09.10.26 05:00 Uhr.']);
  assert.equal(t.windows.length, 2);
  assert.deepEqual(t.start, at(2026, 10, 7, 22));
  assert.deepEqual(t.end, at(2026, 10, 9, 5));

  t = parseTimes(['07.10.26 von 20:00 bis 05:00 Uhr']); // über Mitternacht
  assert.deepEqual(t.windows[0].end, at(2026, 10, 8, 5));

  t = parseTimes(['Jeden Tag zwischen dem 04.10.26 und dem 09.11.26 von 20:00 bis 00:00 Uhr.']);
  assert.equal(t.recurring, true);
  assert.deepEqual(t.start, at(2026, 10, 4, 20));
  assert.deepEqual(t.end, at(2026, 11, 10));

  t = parseTimes([], '2026-08-25T06:00:00+02:00');
  assert.equal(t.start.toISOString(), '2026-08-25T04:00:00.000Z');
});

test('Stand: läuft gerade, kommt noch, zeitweise, vorbei', () => {
  const nightly = parseTimes(['07.10.26 22:00 bis zum 08.10.26 05:00 Uhr.', '08.10.26 22:00 bis zum 09.10.26 05:00 Uhr.']);
  assert.equal(timeStatus(nightly, at(2026, 10, 7, 23)).state, 'active');
  assert.deepEqual(timeStatus(nightly, at(2026, 10, 7, 23)).until, at(2026, 10, 8, 5));
  const next = timeStatus(nightly, at(2026, 10, 8, 12));
  assert.equal(next.state, 'upcoming');
  assert.deepEqual(next.from, at(2026, 10, 8, 22));
  assert.equal(timeStatus(nightly, at(2026, 10, 9, 6)).state, 'ended');
  assert.equal(isCurrent(nightly, at(2026, 10, 9, 6)), false);

  const phase = parseTimes(['Beginn: 05.10.26 um 00:00 Uhr', 'Ende: 27.11.26 um 18:00 Uhr']);
  assert.equal(timeStatus(phase, at(2026, 10, 7, 9)).state, 'active');
  assert.equal(isCurrent(phase, at(2026, 9, 1)), false); // beginnt erst in über 14 Tagen
  assert.equal(isCurrent(phase, at(2026, 9, 25)), true);

  const rec = parseTimes(['Jeden Tag zwischen dem 04.10.26 und dem 09.11.26 von 20:00 bis 00:00 Uhr.']);
  assert.equal(timeStatus(rec, at(2026, 10, 7, 9)).state, 'sometimes');
});

test('Text: was gilt und wie lange noch', () => {
  const closure = { kind: 'closure', times: parseTimes(['07.10.26 22:00 bis zum 08.10.26 05:00 Uhr.']) };
  assert.equal(statusText(closure, at(2026, 10, 7, 23)), 'Gesperrt bis Do 08.10. 05:00 · noch 6 Std.');
  assert.equal(statusText(closure, at(2026, 10, 7, 9)), 'Gesperrt ab Mi 07.10. 22:00 bis Do 08.10. 05:00');
  const works = { kind: 'roadworks', times: parseTimes(['Beginn: 05.10.26 um 00:00 Uhr', 'Ende: 01.05.27 um 00:00 Uhr']) };
  assert.equal(statusText(works, at(2026, 10, 7, 9)), 'Baustelle bis Sa 01.05.2027 · noch 206 Tage');
  assert.equal(fmtRemaining(at(2026, 10, 7, 9, 30), at(2026, 10, 7, 9)), 'noch unter 1 Std.');
});

// Gerade Route von West nach Ost (ca. 7 km) bei 49° N
const route = Array.from({ length: 11 }, (_, i) => [49, 8.4 + i * 0.01]);
const item = (id, coords, extra = {}) => normalize({
  identifier: id, display_type: 'ROADWORKS', title: `A8 | ${id}`, subtitle: 'West -> Ost',
  description: ['Beginn: 05.10.26 um 00:00 Uhr', 'Ende: 27.11.26 um 18:00 Uhr'],
  geometry: { type: 'LineString', coordinates: coords.map(([lat, lng]) => [lng, lat]) }, ...extra,
}, 'A8');

test('Meldungen auf der Strecke: nur in Fahrtrichtung und wirklich auf der Route', () => {
  const same = item('gleich', [[49.0001, 8.43], [49.0001, 8.44], [49.0001, 8.45]]);           // ~11 m daneben, Fahrtrichtung
  const opposite = item('gegen', [[49.0002, 8.45], [49.0002, 8.44], [49.0002, 8.43]]);        // Gegenfahrbahn: läuft rückwärts
  const far = item('weit', [[49.01, 8.43], [49.01, 8.45]]);                                  // 1 km nördlich
  const crossing = item('kreuzt', [[48.99, 8.46], [49.0, 8.46], [49.01, 8.46]]);              // kreuzt nur
  const point = normalize({ identifier: 'punkt', display_type: 'CLOSURE_ENTRY_EXIT', title: 'A8 | Punkt', coordinate: { lat: '49.0001', long: '8.47' }, description: ['07.10.26 22:00 bis zum 08.10.26 05:00 Uhr.'] }, 'A8');
  const found = alongRoute([far, opposite, same, crossing, point], route);
  assert.deepEqual(found.map((i) => i.id), ['gleich', 'punkt']);
  assert.ok(found[0].pos > 2000 && found[0].pos < 2300);
  // Auf der Rückfahrt (umgekehrte Route) ist es genau andersherum
  const back = alongRoute([same, opposite], [...route].reverse());
  assert.deepEqual(back.map((i) => i.id), ['gegen']);
});

test('Gezeichnet wird nur der Teil, der auf der Strecke liegt', () => {
  const long = item('lang', [[49.0001, 8.47], [49.0001, 8.49], [49.0001, 8.5], [49.0001, 8.52], [49.0001, 8.55], [49.0001, 8.6]]); // Route endet bei 8.5
  const [found] = alongRoute([long], route);
  assert.deepEqual(found.shown.map(([, lng]) => lng), [8.47, 8.49, 8.5]);
  assert.equal(found.coords.length, 6);
});

test('Doppelte Meldungen (je Fahrstreifen) nur einmal', () => {
  const a = item('a1', [[49.0001, 8.43], [49.0001, 8.45]]);
  const b = { ...item('a2', [[49.0001, 8.43], [49.0001, 8.45]]), title: a.title };
  assert.equal(alongRoute([a, b], route).length, 1);
});
