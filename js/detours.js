// Ausweichrouten wie bei Google/Apple Karten: Valhalla rechnet Routen, die die Sperrung meiden,
// der Abrechnungs-Routenplaner (OSRM) rechnet sie nach. Geometrie ohne DOM – wird getestet;
// die Routenplaner bekommt searchAlternatives übergeben.
import { insertDetours } from './calc.js';

const M_PER_DEG_LAT = 110540;
const mPerDegLng = (lat) => 111320 * Math.cos((lat * Math.PI) / 180);

/** Abstand (m) eines Punkts zu einer Linie [[lat, lng]] und der Index des nächsten Teilstücks. */
export function nearestOnLine(p, line) {
  const kx = mPerDegLng(p[0]);
  const x = p[1] * kx;
  const y = p[0] * M_PER_DEG_LAT;
  let best = { d: Infinity, i: 0 };
  for (let i = 0; i < line.length; i++) {
    const ax = line[i][1] * kx;
    const ay = line[i][0] * M_PER_DEG_LAT;
    if (i === line.length - 1) {
      const d = Math.hypot(x - ax, y - ay);
      if (d < best.d) best = { d, i };
      break;
    }
    const bx = line[i + 1][1] * kx;
    const by = line[i + 1][0] * M_PER_DEG_LAT;
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / len2)) : 0;
    const d = Math.hypot(x - (ax + t * dx), y - (ay + t * dy));
    if (d < best.d) best = { d, i };
  }
  return best;
}

/** Wie viel (0–1) von Route a liegt auf Route b? */
export function overlap(a, b, tol = 60) {
  const step = Math.max(1, Math.floor(a.length / 80));
  let n = 0;
  let hit = 0;
  for (let k = 0; k < a.length; k += step) {
    n++;
    if (nearestOnLine(a[k], b).d <= tol) hit++;
  }
  return n ? hit / n : 0;
}

/** Fahrtrichtung (Grad, 0 = Nord) einer Route an Punkt k. */
export function bearingAt(coords, k) {
  const a = coords[Math.max(0, k - 2)];
  const b = coords[Math.min(coords.length - 1, k + 2)];
  const toRad = (x) => (x * Math.PI) / 180;
  const y = Math.sin(toRad(b[1] - a[1])) * Math.cos(toRad(b[0]));
  const x = Math.cos(toRad(a[0])) * Math.sin(toRad(b[0])) - Math.sin(toRad(a[0])) * Math.cos(toRad(b[0])) * Math.cos(toRad(b[1] - a[1]));
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

/**
 * Fährt die Route durch die Sperrung? closure: { coords: [[lat, lng]] } (gesperrter Abschnitt) oder { lat, lng } (Stelle).
 * Abschnitt: mindestens die Hälfte seiner Punkte liegt direkt (≤ 30 m) auf der Route. Stelle: näher als 60 m.
 */
export function usesClosure(route, closure) {
  if (!closure) return false;
  const pts = closure.coords?.length ? closure.coords : [[closure.lat, closure.lng]];
  if (pts.length === 1) return nearestOnLine(pts[0], route).d < 60;
  const sample = pts.length <= 20 ? pts : Array.from({ length: 20 }, (_, k) => pts[Math.round((k * (pts.length - 1)) / 19)]);
  return sample.filter((p) => nearestOnLine(p, route).d <= 30).length >= sample.length / 2;
}

/** Mitte einer Sperrung (für die Testpunkte). */
export const closureCenter = (closure) => {
  const pts = closure.coords?.length ? closure.coords : [[closure.lat, closure.lng]];
  return pts[Math.floor(pts.length / 2)];
};

/** Teil einer Route, der nicht auf der anderen liegt: Länge (m) und Punkte. */
export function divergence(route, other, tol = 100) {
  let len = 0;
  const pts = [];
  const step = Math.max(1, Math.floor(route.length / 200));
  for (let k = step; k < route.length; k += step) {
    if (nearestOnLine(route[k], other).d > tol) {
      len += nearestOnLine(route[k], [route[k - step]]).d;
      pts.push(route[k]);
    }
  }
  return { len, pts };
}

/** Straßen, die die Alternative fährt, die normale Strecke aber (kaum): { name: Meter } → ['B 7', 'L 1044'] */
export function newRoads(refs = {}, mainRefs = {}) {
  return Object.entries(refs)
    .filter(([k, m]) => m > 800 && (mainRefs[k] || 0) < m * 0.3)
    .sort((a, b) => b[1] - a[1])
    .map(([k]) => k);
}

/** Sperrfläche für den Routenplaner: schmaler Streifen um das mittlere Stück des gesperrten Abschnitts
 *  (nicht die Enden – die liegen oft schon auf der Hauptfahrbahn, die nicht gesperrt ist). */
export function closurePolygon(coords, m = 8) {
  const n = coords.length;
  const mid = n > 4 ? coords.slice(Math.floor(n * 0.3), Math.ceil(n * 0.7)) : coords;
  const pts = mid.length > 1 ? mid : [mid[0], [mid[0][0] + 1e-5, mid[0][1] + 1e-5]];
  const dLat = m / M_PER_DEG_LAT;
  const dLng = m / mPerDegLng(pts[0][0]);
  const left = pts.map(([lat, lng]) => [lng - dLng, lat + dLat]);
  const right = pts.map(([lat, lng]) => [lng + dLng, lat - dLat]).reverse();
  return [...left, ...right, left[0]];
}

/** Sperrung als „meiden“-Angabe für Valhalla: Abschnitt → Fläche, Stelle → nächste Straße dort. */
export const avoidFor = (closure) => (!closure ? {} : closure.coords?.length > 1
  ? { polygons: [closurePolygon(closure.coords)] }
  : { locations: [closure.coords?.length ? { lat: closure.coords[0][0], lng: closure.coords[0][1] } : closure] });

/** Mögliche Wegpunkte entlang des abweichenden Stücks (Mitte zuerst). */
function viaCandidates(route, base) {
  const d = divergence(route, base);
  if (d.pts.length < 2) return [];
  return [0.5, 0.3, 0.7].map((f) => {
    const p = d.pts[Math.floor((d.pts.length - 1) * f)];
    let k = 0;
    let best = Infinity;
    route.forEach((q, j) => { const dd = Math.abs(q[0] - p[0]) + Math.abs(q[1] - p[1]); if (dd < best) { best = dd; k = j; } });
    return { lat: route[k][0], lng: route[k][1], bearing: bearingAt(route, k) };
  });
}

/**
 * Ausweichrouten für eine Fahrt (stops in Fahrtrichtung), wie bei Google/Apple Karten.
 * 1. Valhalla rechnet die beste Route ohne die Sperrung und je Teilstück bis zu 3 Alternativen.
 * 2. Jede wird als Umleitungs-Wegpunkt (mit Fahrtrichtung) mit dem Abrechnungs-Routenplaner (OSRM) als komplette Fahrt
 *    nachgerechnet: sie muss an der Sperrung vorbeiführen, ohne Feldwege – angezeigt werden genau diese km und Minuten.
 * closure: { coords } gesperrter Abschnitt (Autobahn-Meldung) oder { lat, lng } (auf der Karte angetippt), optional.
 * → { base: { km, min, usesClosure }, list: [{ lat, lng, bearing, coords, km, min, extraKm, extraMin, roads }] }
 */
export async function searchAlternatives(stops, { dir = 'hin', closure = null, fetchRoute, valhallaRoute, onProgress, max = 5 } = {}) {
  let done = 0;
  const tick = (total) => onProgress?.(++done, total);
  const [base] = await fetchRoute(stops, { alternatives: false, steps: true });
  const avoid = avoidFor(closure);
  const blocked = (coords) => (closure ? usesClosure(coords, closure) : false);
  // Kandidaten von Valhalla: ganze Fahrt ohne Sperrung + Alternativen je Teilstück (bei Sperrung nur das betroffene)
  const legs = stops.slice(1).map((b, i) => ({ a: stops[i], b, i }));
  let legList = legs;
  if (closure) {
    const c = closureCenter(closure);
    const near = legs.map((l) => nearestOnLine(c, base.coords.slice(base.wpIdx[l.i], base.wpIdx[l.i + 1] + 1)).d);
    legList = [legs[near.indexOf(Math.min(...near))]];
  }
  const total = 1 + legList.length + 12;
  const cands = [];
  try { cands.push(...(await valhallaRoute(stops, { avoid })).slice(0, 1)); } catch { /* weiter mit den Teilstücken */ }
  tick(total);
  for (const l of legList) {
    try { cands.push(...await valhallaRoute([l.a, l.b], { alternates: 3, avoid })); } catch { /* nichts */ }
    tick(total);
  }
  // Nachrechnen mit OSRM (Abrechnung)
  const out = [];
  for (const c of cands) {
    if (out.length >= max + 2) break;
    if (blocked(c.coords)) continue;
    if (!closure && divergence(c.coords, base.coords).len < 1500) continue; // kein echter anderer Weg
    for (const v of viaCandidates(c.coords, base.coords)) {
      const full = insertDetours(stops, [{ id: 'test', dir, ...v }], dir);
      let r;
      try { [r] = await fetchRoute(full, { alternatives: false, steps: true }); } catch { continue; } finally { tick(total); }
      if (blocked(r.coords) || (r.slow || 0) - (base.slow || 0) > 150) continue;
      if (divergence(r.coords, base.coords).len < 500) continue; // landet doch auf der normalen Strecke
      if (out.some((o) => overlap(r.coords, o.coords) > 0.9 && overlap(o.coords, r.coords) > 0.9)) break; // schon dabei
      out.push({ ...v, coords: r.coords, km: r.distance / 1000, min: r.duration / 60, extraKm: (r.distance - base.distance) / 1000, extraMin: (r.duration - base.duration) / 60, roads: newRoads(c.refs, base.refs).slice(0, 2) });
      break;
    }
  }
  out.sort((a, b) => a.extraMin - b.extraMin || a.extraKm - b.extraKm);
  return { base: { km: base.distance / 1000, min: base.duration / 60, usesClosure: blocked(base.coords) }, list: out.slice(0, max) };
}
