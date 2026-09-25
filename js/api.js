// Externe Dienste: Photon (Adresssuche), OSRM (Routing), Tankerkönig (Spritpreise).

const PHOTON = 'https://photon.komoot.io';
const OSRM = 'https://router.project-osrm.org';
const TK = 'https://creativecommons.tankerkoenig.de/json';

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

/**
 * Route über alle Stopps. Liefert bis zu 3 Alternativen (nur bei 2 Stopps).
 * Ergebnis: [{distance (m), duration (s), coords: [[lat,lng]], legs: [{distance, duration}], wpIdx: []}]
 */
export async function fetchRoute(stops) {
  const coords = stops.map((s) => `${s.lng.toFixed(6)},${s.lat.toFixed(6)}`).join(';');
  const alt = stops.length === 2 ? 'true' : 'false';
  const data = await getJSON(`${OSRM}/route/v1/driving/${coords}?overview=full&geometries=geojson&steps=false&alternatives=${alt}`);
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
    };
  });
}

export function legIndexAt(route, latlng) {
  const i = nearestIndex(route.coords, [latlng.lat, latlng.lng]);
  for (let k = 0; k < route.wpIdx.length - 1; k++) if (i <= route.wpIdx[k + 1]) return k;
  return route.wpIdx.length - 2;
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

export function haversine(a, b) {
  const R = 6371;
  const toRad = (x) => (x * Math.PI) / 180;
  const dLat = toRad(b[0] - a[0]);
  const dLng = toRad(b[1] - a[1]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a[0])) * Math.cos(toRad(b[0])) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Abstand eines Punkts zur Route in km (grob über Geometriepunkte). */
export function distanceToRoute(coords, p) {
  let best = Infinity;
  const step = Math.max(1, Math.floor(coords.length / 400));
  for (let i = 0; i < coords.length; i += step) best = Math.min(best, haversine(coords[i], p));
  return best;
}
