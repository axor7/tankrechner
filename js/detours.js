// Ausweichrouten finden: Testpunkte neben der gesperrten Stelle, nur Routen behalten, die die Stelle wirklich umfahren.
// Reine Geometrie ohne DOM/Netz – wird getestet. Das Routing selbst macht app.js (OSRM).

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

/**
 * Testpunkte links und rechts der Route an Stelle `idx` (senkrecht zur Fahrtrichtung),
 * in den Abständen `km` – dort sollen Umwege entlangführen.
 */
export function sidePoints(line, idx, km = [0.8, 1.5, 2.5, 4, 6, 9]) {
  const a = line[Math.max(0, idx - 4)];
  const b = line[Math.min(line.length - 1, idx + 4)];
  const p = line[idx];
  const kx = mPerDegLng(p[0]);
  let ex = (b[1] - a[1]) * kx;
  let ey = (b[0] - a[0]) * M_PER_DEG_LAT;
  const len = Math.hypot(ex, ey) || 1;
  ex /= len;
  ey /= len;
  const out = [];
  for (const d of km) {
    for (const side of [1, -1]) {
      const nx = -ey * side * d * 1000; // senkrecht
      const ny = ex * side * d * 1000;
      out.push({ lat: p[0] + ny / M_PER_DEG_LAT, lng: p[1] + nx / kx, side, km: d });
    }
  }
  return out;
}

/** Punkt der Route, der am weitesten von der normalen Strecke entfernt ist (dort liegt der Umweg). */
export function farthestPoint(route, main) {
  let best = null;
  let bestD = -1;
  const step = Math.max(1, Math.floor(route.length / 150));
  for (let k = 0; k < route.length; k += step) {
    const { d } = nearestOnLine(route[k], main);
    if (d > bestD) { bestD = d; best = route[k]; }
  }
  return { point: best, dist: bestD };
}

/** Stichfahrt am Wegpunkt (hin und denselben Weg zurück, z. B. weil der Testpunkt neben einem Feldweg lag)? */
export function hasSpur(coords, vi, maxM = 150) {
  if (vi == null || vi <= 0 || vi >= coords.length - 1) return false;
  let len = 0;
  for (let k = 1; vi - k >= 0 && vi + k < coords.length; k++) {
    const a = coords[vi - k];
    const b = coords[vi + k];
    if (nearestOnLine(a, [b]).d > 30) break;
    len += nearestOnLine(coords[vi - k], [coords[vi - k + 1]]).d;
    if (len > maxM) return true;
  }
  return false;
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

/**
 * Aus berechneten Kandidaten die brauchbaren Ausweichrouten auswählen.
 * main: { coords, distance, duration } der normalen Strecke (dieses Teilstücks)
 * candidates: [{ coords, distance, duration }]
 * closure: { lat, lng } – gesperrte Stelle (optional): Vorschläge müssen mindestens `clearance` Meter daran vorbei
 * → [{ coords, lat, lng, extraKm, extraMin }] nach Mehr-Fahrzeit sortiert, ähnliche zusammengefasst
 */
export function pickDetours(main, candidates, { closure = null, clearance = 120, max = 5 } = {}) {
  const maxExtraKm = Math.max(15, (main.distance / 1000) * 0.6);
  const ok = [];
  for (const c of candidates) {
    if (!c?.coords?.length) continue;
    if (hasSpur(c.coords, c.viaIdx)) continue;
    const extraKm = (c.distance - main.distance) / 1000;
    const extraMin = (c.duration - main.duration) / 60;
    if (extraKm > maxExtraKm) continue;
    if (closure && nearestOnLine([closure.lat, closure.lng], c.coords).d < clearance) continue; // fährt durch die Sperrung
    if (overlap(c.coords, main.coords) > 0.97) continue; // praktisch die normale Strecke
    const far = farthestPoint(c.coords, main.coords);
    if (!far.point || far.dist < 150) continue;
    const via = c.via || far.point; // Wegpunkt auf der Ausweichstraße
    ok.push({ coords: c.coords, lat: via[0], lng: via[1], extraKm, extraMin });
  }
  ok.sort((x, y) => x.extraMin - y.extraMin || x.extraKm - y.extraKm);
  const out = [];
  for (const c of ok) {
    if (out.some((o) => overlap(c.coords, o.coords) > 0.85 && overlap(o.coords, c.coords) > 0.85)) continue; // gleiche Route
    out.push(c);
    if (out.length >= max) break;
  }
  return out;
}
