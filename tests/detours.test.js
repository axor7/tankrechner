import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nearestOnLine, sidePoints, pickDetours, hasSpur, overlap } from '../js/detours.js';

// Normale Strecke: gerade von West nach Ost bei 49° N (ca. 14,6 km)
const line = (lat, from, to, n = 41) => Array.from({ length: n }, (_, i) => [lat, from + ((to - from) * i) / (n - 1)]);
const main = { coords: line(49, 8.4, 8.6), distance: 14600, duration: 900 };
// Umweg: nördlich über 49,02 (ca. 2,2 km neben der Strecke)
const north = [[49, 8.4], ...line(49.02, 8.45, 8.55, 21), [49, 8.6]];

test('Abstand zur Linie und Testpunkte senkrecht zur Fahrtrichtung', () => {
  assert.ok(Math.abs(nearestOnLine([49.01, 8.5], main.coords).d - 1105) < 15);
  const pts = sidePoints(main.coords, 20, [1, 3]);
  assert.equal(pts.length, 4);
  for (const p of pts) {
    assert.ok(Math.abs(p.lng - 8.5) < 1e-6); // genau neben der Stelle
    assert.ok(Math.abs(nearestOnLine([p.lat, p.lng], main.coords).d - p.km * 1000) < 20);
  }
});

test('Vorschläge: nur Wege an der Sperrung vorbei, keine Stichfahrten, keine Doppelten', () => {
  const closure = { lat: 49, lng: 8.5 };
  const through = { coords: [...line(49, 8.4, 8.5, 11), [49.003, 8.5], ...line(49, 8.5, 8.6, 11)], distance: 15000, duration: 960 }; // fährt durch
  const good = { coords: north, distance: 17000, duration: 1080 };
  const same = { coords: north.map(([a, b]) => [a + 0.0001, b]), distance: 17100, duration: 1100 }; // gleiche Route
  // Stichfahrt: auf der Strecke bis 8.5, 1 km nach Norden und zurück
  const up = Array.from({ length: 6 }, (_, k) => [49 + k * 0.002, 8.5]);
  const spur = { coords: [...line(49, 8.4, 8.49, 10), ...up, ...up.slice(0, -1).reverse(), ...line(49, 8.51, 8.6, 10)], distance: 16700, duration: 1000, viaIdx: 15 };
  assert.ok(hasSpur(spur.coords, spur.viaIdx));
  const list = pickDetours(main, [through, same, spur, good], { closure });
  assert.equal(list.length, 1);
  assert.equal(Math.round(list[0].extraKm * 10) / 10, 2.4);
  assert.equal(list[0].extraMin, 3);
  assert.ok(list[0].lat > 49.015); // Wegpunkt liegt auf der Ausweichstraße
  assert.ok(overlap(good.coords, same.coords) > 0.85);
});

test('Ohne Sperrung zählen alle echten Alternativen', () => {
  const through = { coords: [...line(49, 8.4, 8.5, 11), [49.004, 8.5], ...line(49, 8.5, 8.6, 11)], distance: 15000, duration: 960 };
  assert.equal(pickDetours(main, [through, { coords: north, distance: 17000, duration: 1080 }]).length, 2);
});
