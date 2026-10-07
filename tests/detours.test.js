import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nearestOnLine, usesClosure, divergence, newRoads, bearingAt, avoidFor, searchAlternatives } from '../js/detours.js';

// Normale Strecke: gerade von West nach Ost bei 49° N (ca. 14,6 km); gesperrt ist das Stück bei 8,5° O
const line = (lat, from, to, n = 41) => Array.from({ length: n }, (_, i) => [lat, from + ((to - from) * i) / (n - 1)]);
const baseCoords = line(49, 8.4, 8.6);
const closure = { coords: line(49, 8.495, 8.505, 6) };
const north = [[49, 8.4], ...line(49.02, 8.45, 8.55, 21), [49, 8.6]];   // Umfahrung nördlich (ca. 2,2 km daneben)
const south = [[49, 8.4], ...line(48.98, 8.45, 8.55, 21), [49, 8.6]];   // Umfahrung südlich – aber über Feldwege
const through = [...line(49, 8.4, 8.5, 21), [49.004, 8.52], ...line(49, 8.53, 8.6, 15)]; // fährt durch die Sperrung

test('Liegt eine Route auf der Sperrung? Abschnitt und angetippte Stelle', () => {
  assert.ok(usesClosure(baseCoords, closure));
  assert.ok(!usesClosure(north, closure));
  assert.ok(usesClosure(baseCoords, { lat: 49.0002, lng: 8.5 }));
  assert.ok(!usesClosure(north, { lat: 49.0002, lng: 8.5 }));
  assert.ok(Math.abs(nearestOnLine([49.01, 8.5], baseCoords).d - 1105) < 15);
});

test('Sperrfläche für Valhalla: nur das mittlere Stück; Stelle → exclude_locations', () => {
  const a = avoidFor(closure);
  assert.equal(a.polygons.length, 1);
  const ring = a.polygons[0];
  assert.deepEqual(ring[0], ring[ring.length - 1]); // geschlossen
  assert.ok(Math.min(...ring.map(([lng]) => lng)) > 8.496); // Enden ausgespart
  assert.deepEqual(avoidFor({ lat: 49, lng: 8.5 }), { locations: [{ lat: 49, lng: 8.5 }] });
  assert.deepEqual(avoidFor(null), {});
});

test('Fahrtrichtung, abweichendes Stück, neue Straßen', () => {
  assert.ok(Math.abs(bearingAt(baseCoords, 20) - 90) < 1); // nach Osten
  assert.ok(divergence(north, baseCoords).len > 6000);
  assert.ok(divergence(baseCoords, baseCoords).len === 0);
  assert.deepEqual(newRoads({ 'B 7': 9000, 'A 71': 3000, 'K 14': 500 }, { 'A 71': 40000 }), ['B 7']);
});

// Nachgebaute Routenplaner
const stops = [{ lat: 49, lng: 8.4 }, { lat: 49, lng: 8.6 }];
const osrm = async (pts) => {
  const via = pts.find((p) => p.via);
  if (via && via.lat > 49.01) return [{ coords: north, distance: 17000, duration: 1080, slow: 0, refs: { 'B 7': 12000 } }];
  if (via && via.lat < 48.99) return [{ coords: south, distance: 16000, duration: 3000, slow: 4000, refs: {} }];
  return [{ coords: baseCoords, distance: 14600, duration: 900, slow: 0, refs: { 'A 71': 14600 }, wpIdx: [0, 40] }];
};
const valhalla = async () => [
  { coords: through, distance: 14800, duration: 950, refs: {} },
  { coords: south, distance: 16000, duration: 1200, refs: { 'L 1': 12000 } },
  { coords: north, distance: 16900, duration: 1100, refs: { 'B 7': 12000, 'A 71': 2000 } },
];

test('Ausweichrouten: nur an der Sperrung vorbei, ohne Feldwege, mit den nachgerechneten Zahlen', async () => {
  const res = await searchAlternatives(stops, { dir: 'rueck', closure, fetchRoute: osrm, valhallaRoute: valhalla });
  assert.equal(res.base.usesClosure, true);
  assert.equal(res.list.length, 1);
  const [x] = res.list;
  assert.deepEqual(x.roads, ['B 7']);
  assert.equal(Math.round(x.extraKm * 10) / 10, 2.4); // Werte aus der Nachrechnung (OSRM), nicht aus Valhalla
  assert.equal(x.extraMin, 3);
  assert.ok(x.lat > 49.015 && Math.abs(x.bearing - 90) < 5); // Wegpunkt auf der Umfahrung, in Fahrtrichtung
});
