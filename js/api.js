import { haversine } from './calc.js';
// Externe Dienste: Photon (Adresssuche), OSRM (Routing), Valhalla (Umleitungen um Sperrungen), Tankerkönig (Spritpreise).

const PHOTON = 'https://photon.komoot.io';
const OSRM = 'https://router.project-osrm.org';
const VALHALLA = 'https://valhalla1.openstreetmap.de'; // FOSSGIS – kann gesperrte Stellen meiden
const TK = 'https://creativecommons.tankerkoenig.de/json';

/** Fahrtrichtung an Wegpunkten (Umleitungen): sonst landet der Routenplaner evtl. auf der Gegenfahrbahn und muss wenden. */
function bearingsParam(stops) {
  if (!stops.some((s) => s.bearing != null)) return '';
  return `bearings=${stops.map((s) => (s.bearing != null ? `${Math.round(((s.bearing % 360) + 360) % 360)},60` : '')).join(';')}&`;
}

async function getJSON(url, signal) {
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function photonLabel(p) {
  const street = [p.street, p.housenumber].filter(Boolean).join(' ');
  const city = [p.postcode, p.city || p.town || p.village || p.county].filter(Boolean).join(' ');
  const name = p.name && p.name !== p.street ? p.name : '';
  return [name, street, city].filter(Boolean).join(', ') || p.name || 'Unbenannter Ort';
}

export async function searchPlaces(q, { near, signal } = {}) {
  const params = new URLSearchParams({ q, limit: '6', lang: 'de' });
  if (near) { params.set('lat', near.lat); params.set('lon', near.lng); }
  const data = await getJSON(`${PHOTON}/api/?${params}`, signal);
  return data.features.map((f) => ({
    label: photonLabel(f.properties),
    lat: f.geometry.coordinates[1],
    lng: f.geometry.coordinates[0],
  }));
}

export async function reverseGeocode(lat, lng) {
  try {
    const data = await getJSON(`${PHOTON}/reverse?lat=${lat}&lon=${lng}&lang=de`);
    const f = data.features[0];
    if (f) return photonLabel(f.properties);
  } catch { /* ignorieren */ }
  return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
}

/** Index des Geometriepunkts, der p am nächsten ist (ab start). */
function nearestIndex(coords, p, start = 0) {
  let best = start;
  let bestD = Infinity;
  for (let i = start; i < coords.length; i++) {
    const d = (coords[i][0] - p[0]) ** 2 + (coords[i][1] - p[1]) ** 2;
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}

/** Befahrene Straßen mit Metern: { 'A 71': 30500, 'Hersfelder Straße': 2200 } (Nummer und Name). */
function roadMeters(legs) {
  const out = {};
  for (const l of legs) {
    for (const st of l.steps || []) for (const k of new Set([st.ref, st.name].filter(Boolean))) out[k] = (out[k] || 0) + st.distance;
  }
  return out;
}

/** Meter auf Schleich-Abschnitten (Feld-/Waldwege u. ä., unter 20 km/h) – taugen nicht als Umleitung. */
function slowMeters(legs) {
  let m = 0;
  for (const l of legs) for (const st of l.steps || []) if (st.distance > 100 && st.duration > 0 && (st.distance / st.duration) * 3.6 < 20) m += st.distance;
  return m;
}

/**
 * Route über alle Stopps. Liefert bis zu 3 Alternativen (nur bei 2 Stopps).
 * Ergebnis: [{distance (m), duration (s), coords: [[lat,lng]], legs: [{distance, duration}], wpIdx: []}]
 */
export async function fetchRoute(stops, { alternatives = stops.length === 2, steps = false } = {}) {
  const coords = stops.map((s) => `${s.lng.toFixed(6)},${s.lat.toFixed(6)}`).join(';');
  const alt = alternatives && stops.length === 2 ? 'true' : 'false';
  const data = await getJSON(`${OSRM}/route/v1/driving/${coords}?${bearingsParam(stops)}overview=full&geometries=geojson&steps=${steps}&alternatives=${alt}`);
  if (data.code !== 'Ok') throw new Error(data.message || data.code);
  const snapped = data.waypoints.map((w) => [w.location[1], w.location[0]]);
  return data.routes.slice(0, 3).map((r) => {
    const line = r.geometry.coordinates.map(([lng, lat]) => [lat, lng]);
    const wpIdx = [];
    let from = 0;
    for (const p of snapped) { from = nearestIndex(line, p, from); wpIdx.push(from); }
    return {
      distance: r.distance,
      duration: r.duration,
      coords: line,
      legs: r.legs.map((l) => ({ distance: l.distance, duration: l.duration })),
      wpIdx,
      refs: steps ? roadMeters(r.legs) : undefined,
      slow: steps ? slowMeters(r.legs) : undefined,
    };
  });
}

/**
 * Länge, Fahrzeit und befahrene Straßen (z. B. „A 8“, „B 14“) einer Stoppfolge – ohne Geometrie, daher klein.
 * → { distance (m), duration (s), refs: [Straßennummern] }
 */
export async function fetchRouteInfo(stops) {
  const coords = stops.map((s) => `${s.lng.toFixed(6)},${s.lat.toFixed(6)}`).join(';');
  const data = await getJSON(`${OSRM}/route/v1/driving/${coords}?${bearingsParam(stops)}overview=false&steps=true&alternatives=false`);
  if (data.code !== 'Ok') throw new Error(data.message || data.code);
  const r = data.routes[0];
  const refs = new Set();
  for (const leg of r.legs) for (const st of leg.steps || []) if (st.ref) refs.add(st.ref);
  return { distance: r.distance, duration: r.duration, refs: [...refs] };
}

/** Polyline mit 6 Nachkommastellen (Valhalla) → [[lat, lng]] */
function decodePolyline6(str) {
  const out = [];
  let i = 0;
  let lat = 0;
  let lng = 0;
  while (i < str.length) {
    for (const k of [0, 1]) {
      let b;
      let shift = 0;
      let r = 0;
      do { b = str.charCodeAt(i++) - 63; r |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
      const v = r & 1 ? ~(r >> 1) : r >> 1;
      if (k === 0) lat += v; else lng += v;
    }
    out.push([lat / 1e6, lng / 1e6]);
  }
  return out;
}

/**
 * Route mit Valhalla – kann gesperrte Stellen meiden und Alternativen liefern (nur bei 2 Punkten).
 * avoid: { polygons: [[[lng, lat], …]], locations: [{ lat, lng }] }
 * → [{ coords, distance (m), duration (s), refs: { Straße: Meter } }] (erste = beste)
 */
export async function valhallaRoute(stops, { alternates = 0, avoid = {} } = {}) {
  const body = {
    locations: stops.map((s) => ({ lat: s.lat, lon: s.lng, ...(s.bearing != null ? { heading: Math.round(s.bearing), heading_tolerance: 60 } : {}) })),
    costing: 'auto', units: 'kilometers', language: 'de-DE', directions_type: 'maneuvers',
    ...(alternates && stops.length === 2 ? { alternates } : {}),
    ...(avoid.polygons?.length ? { exclude_polygons: avoid.polygons } : {}),
    ...(avoid.locations?.length ? { exclude_locations: avoid.locations.map((p) => ({ lat: p.lat, lon: p.lng })) } : {}),
  };
  const res = await fetch(`${VALHALLA}/route`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json();
  if (!data.trip) throw new Error(data.error || `Valhalla: HTTP ${res.status}`);
  return [data.trip, ...(data.alternates || []).map((a) => a.trip)].map((t) => {
    const refs = {};
    for (const l of t.legs) for (const m of l.maneuvers || []) for (const n of m.street_names || []) refs[n] = (refs[n] || 0) + m.length * 1000;
    return { coords: t.legs.flatMap((l) => decodePolyline6(l.shape)), distance: t.summary.length * 1000, duration: t.summary.time, refs };
  });
}

/**
 * Beste Reihenfolge der Abholpunkte (Routenplaner löst das „Einsammel-Problem“).
 * points: [start, ...abholpunkte, ziel] als { lat, lng } → Reihenfolge der Abholpunkte (Indizes 0..n-1)
 */
export async function optimizeOrder(points) {
  if (points.length <= 3) return points.slice(1, -1).map((_, i) => i);
  const coords = points.map((s) => `${s.lng.toFixed(6)},${s.lat.toFixed(6)}`).join(';');
  const data = await getJSON(`${OSRM}/trip/v1/driving/${coords}?source=first&destination=last&roundtrip=false&overview=false`);
  if (data.code !== 'Ok') throw new Error(data.message || data.code);
  // waypoint_index = Position des Punkts in der besten Reihenfolge
  const pos = data.waypoints.map((w, i) => ({ i, at: w.waypoint_index }));
  return pos.slice(1, -1).sort((a, b) => a.at - b.at).map((x) => x.i - 1);
}

/** Tankstellen im Umkreis (max. 25 km). */
export async function fetchStations(lat, lng, rad, apiKey) {
  const params = new URLSearchParams({ lat, lng, rad: Math.min(25, rad), sort: 'dist', type: 'all', apikey: apiKey });
  const data = await getJSON(`${TK}/list.php?${params}`);
  if (!data.ok) throw new Error(data.message || 'Tankerkönig-Fehler');
  return data.stations.map((s) => ({
    id: s.id,
    name: s.name,
    brand: s.brand,
    address: `${s.street || ''} ${s.houseNumber || ''}`.trim() + `, ${s.postCode || ''} ${s.place || ''}`.trim(),
    lat: s.lat,
    lng: s.lng,
    isOpen: s.isOpen,
    e5: typeof s.e5 === 'number' ? s.e5 : null,
    e10: typeof s.e10 === 'number' ? s.e10 : null,
    diesel: typeof s.diesel === 'number' ? s.diesel : null,
  }));
}

/** Aktuelle Preise für bis zu 10 Tankstellen-IDs. */
export async function fetchPrices(ids, apiKey) {
  const params = new URLSearchParams({ ids: ids.slice(0, 10).join(','), apikey: apiKey });
  const data = await getJSON(`${TK}/prices.php?${params}`);
  if (!data.ok) throw new Error(data.message || 'Tankerkönig-Fehler');
  return data.prices;
}

/** Punkte entlang der Route, an denen nach Tankstellen gesucht wird. */
export function samplePoints(coords, stops, everyKm = 12, max = 12) {
  const pts = stops.map((s) => [s.lat, s.lng]);
  let acc = 0;
  for (let i = 1; i < coords.length; i++) {
    acc += haversine(coords[i - 1], coords[i]);
    if (acc >= everyKm) { pts.push(coords[i]); acc = 0; }
  }
  if (pts.length <= max) return pts;
  const step = pts.length / max;
  return Array.from({ length: max }, (_, i) => pts[Math.floor(i * step)]);
}


/** Abstand eines Punkts zur Route in km (grob über Geometriepunkte). */
export function distanceToRoute(coords, p) {
  let best = Infinity;
  const step = Math.max(1, Math.floor(coords.length / 400));
  for (let i = 0; i < coords.length; i += step) best = Math.min(best, haversine(coords[i], p));
  return best;
}
