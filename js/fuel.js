// Spritpreis (nur Logik): Tankstellen an der Strecke (Tankerkönig), Preis übernehmen, regelmäßig aktualisieren,
// beste Tankzeit. Der API-Key bleibt auf dem Gerät.
import { state, update, personById } from './state.js';
import { FUELS } from './calc.js';
import { fetchStations, fetchPrices, samplePoints, distanceToRoute } from './api.js';
import { TYPICAL_CURVE, bestWindow, profileFromObservations, blendProfile } from './fueltimes.js';
import { toast } from './ui.js';

const MAX_OBS = 5000;
const REFRESH_MS = 15 * 60 * 1000;
let loading = false;
export const stationsLoading = () => loading;
export const liveFuel = () => FUELS[state.car.fuel]?.tk || null;

function recordObservations(s, stations) {
  const now = Date.now();
  const last = new Map();
  for (const o of s.observations.slice(-500)) last.set(`${o.sid}|${o.fuel}`, o.t);
  for (const st of stations) {
    for (const fuel of ['e5', 'e10', 'diesel']) {
      if (!(st[fuel] > 0)) continue;
      const k = `${st.id}|${fuel}`;
      if (last.has(k) && now - last.get(k) < 10 * 60 * 1000) continue;
      s.observations.push({ t: now, sid: st.id, fuel, price: st[fuel] });
    }
  }
  if (s.observations.length > MAX_OBS) s.observations = s.observations.slice(-MAX_OBS);
}

/** Tankstellen mit Preis für diesen Kraftstoff: geöffnete zuerst, dann günstigste. */
export function sortedStations(fuel) {
  return state.stations
    .filter((s) => s[fuel] > 0)
    .sort((a, b) => (b.isOpen - a.isOpen) || (a[fuel] - b[fuel]) || (a.detour - b.detour));
}

/** Günstigste (geöffnete) Tankstelle übernehmen bzw. Preis der gewählten aktualisieren; Preis je Kraftstoff merken. */
export function applyPriceMode(s) {
  const byFuel = {};
  for (const f of ['e5', 'e10', 'diesel']) { const st = sortedStations(f)[0]; if (st?.[f] > 0) byFuel[f] = st[f]; }
  if (Object.keys(byFuel).length) s.price.byFuel = byFuel;
  const fuel = FUELS[s.car.fuel]?.tk;
  if (!fuel || s.price.mode === 'manual') { s.price.current = null; return; }
  let st;
  if (s.price.mode === 'station') st = s.stations.find((x) => x.id === s.price.stationId);
  if (!st || s.price.mode === 'cheapest') st = sortedStations(fuel)[0];
  if (st && st[fuel] > 0) {
    s.price.current = st[fuel];
    s.price.stationId = st.id;
    s.price.stationName = `${st.brand || st.name}, ${st.address}`;
    s.price.updatedAt = Date.now();
  } else s.price.current = null;
}

export function stationSelected(id) {
  update((s) => { s.price.mode = 'station'; s.price.stationId = id; applyPriceMode(s); });
}

export async function loadStations() {
  if (!state.apiKey) { toast('Bitte zuerst den Tankerkönig-Schlüssel eintragen', 'error'); return; }
  const drv = personById(state.defaultDriver)?.address;
  const stops = [drv, state.destination].filter((x) => x?.lat != null);
  if (!stops.length) { toast('Bitte zuerst Start und Ziel festlegen', 'error'); return; }
  loading = true;
  update(() => {});
  try {
    const coords = state.route?.coords || stops.map((s) => [s.lat, s.lng]);
    const pts = samplePoints(coords, stops);
    const found = new Map();
    for (let i = 0; i < pts.length; i += 4) {
      const lists = await Promise.all(pts.slice(i, i + 4).map(([lat, lng]) => fetchStations(lat, lng, 4, state.apiKey)));
      for (const st of lists.flat()) found.set(st.id, st);
    }
    const stations = [...found.values()].map((st) => ({ ...st, detour: distanceToRoute(coords, [st.lat, st.lng]) }));
    update((s) => { s.stations = stations; recordObservations(s, stations); applyPriceMode(s); });
    toast(`${stations.length} Tankstellen an der Strecke`, 'ok');
  } catch (e) {
    toast(`Tankstellen nicht erreichbar: ${e.message}`, 'error');
  } finally {
    loading = false;
    update(() => {});
  }
}

async function refreshPrices() {
  if (!state.apiKey || !state.stations.length || document.hidden) return;
  const fuel = liveFuel() || 'e10';
  const ids = [...new Set([state.price.stationId, ...sortedStations(fuel).map((s) => s.id)].filter(Boolean))].slice(0, 10);
  try {
    const prices = await fetchPrices(ids, state.apiKey);
    update((s) => {
      const changed = [];
      for (const st of s.stations) {
        const p = prices[st.id];
        if (!p) continue;
        st.isOpen = p.status === 'open';
        for (const f of ['e5', 'e10', 'diesel']) st[f] = typeof p[f] === 'number' ? p[f] : st[f];
        changed.push(st);
      }
      recordObservations(s, changed);
      applyPriceMode(s);
    });
  } catch { /* still */ }
}

export function startAutoRefresh() { setInterval(refreshPrices, REFRESH_MS); }

/** Wann ist Tanken meist am günstigsten? → { start, end } (Stunden) – eigene Messungen, sonst typischer Verlauf. */
export function bestFuelTime() {
  const fuel = liveFuel();
  const own = fuel ? profileFromObservations(state.observations || [], fuel) : { count: 0, hoursCovered: 0 };
  const curve = own.count >= 12 && own.hoursCovered >= 6 ? blendProfile(own.curve) : TYPICAL_CURVE;
  return bestWindow(curve, 2);
}
