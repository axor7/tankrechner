// Einstiegspunkt: App-Gerüst (Navigation je Rolle, Karte), Strecke des Admins, Hintergrund-Berechnungen.
import { state, update, subscribe, replaceState, defaultState, model, personById, activePersons, allRoutes, liveSnap, todayIso, SHARED_KEYS } from './state.js';
import { reverseGeocode, fetchRoute, fetchRouteInfo, optimizeOrder } from './api.js';
import { MapView } from './map.js';
import { FUELS, plannedStops, routeKey, mondayOf, addDays, hasOwners, insertDetours } from './calc.js';
import { nearestOnLine, sidePoints, pickAlternatives } from './detours.js';
import { effectiveOrder, isActive, activeDetours } from './model.js';
import { h, debounce, toast } from './ui.js';
import { icon } from './icons.js';
import { stationSelected, startAutoRefresh } from './tab-fuel.js';
import { autobahnRefs, roadEvents, alongRoute, isCurrent } from './traffic.js';
import { renderHome } from './view-home.js';
import { renderTrips, renderSheet } from './view-trips.js';
import { renderCosts } from './view-costs.js';
import { renderSettings } from './view-settings.js';
import { loadExample } from './example.js';
import { setupVersion } from './version.js';
import { initAccount, inGroup, isAdmin, openAccount, claims } from './account.js';
import { me, adminSet, setAddress, freezePastWeeks, moveDetour } from './actions.js';
import { weeks as deriveRange, myBalance, toConfirm } from './derived.js';
import { renderRouteView, openDetourForm, incidentPopup, detourPopup, shortPlace } from './view-route.js';

const ALL_VIEWS = [
  { id: 'home', label: 'Übersicht', icon: 'house', color: 'blue' },
  { id: 'trips', label: 'Fahrten', icon: 'calendar-days', color: 'green' },
  { id: 'costs', label: 'Kosten', icon: 'wallet', color: 'orange' },
  { id: 'route', label: 'Strecke', icon: 'route', color: 'indigo' },
  { id: 'settings', label: 'Einstellungen', icon: 'settings', color: 'gray' },
];
const views = () => ALL_VIEWS.filter((v) => !v.admin || isAdmin());

const $ = (sel) => document.querySelector(sel);
let map;
const safe = async (fn) => { try { await fn(); } catch (e) { toast(e.message, 'error'); } };

// ---------- Ganze Route (alle Abholpunkte) & beste Reihenfolge ----------

const ROUTE_COLORS = { hin: '#2563eb', rueck: '#ea580c' };

/** Welche Richtung zeigt die Karte? */
const routeDir = () => (state.roundTrip !== false && state.ui.routeDir === 'rueck' ? 'rueck' : 'hin');

function setRouteDir(dir) {
  update((s) => { s.ui.routeDir = dir; });
  setTimeout(() => map.fit(fullStops(dir), displayRoute(dir)), 60);
}

/**
 * Stopps der ganzen Route (alle fahren mit) in Fahrtrichtung, mit den heute gefahrenen Umleitungen
 * (oder den übergebenen – z. B. [] für die normale Strecke).
 * Hin: Fahrer → Abholpunkte → Ziel · Zurück: Ziel → Absetz-Reihenfolge → Fahrer
 */
function fullStops(dir = 'hin', detours = activeDetours(state.detours, todayIso())) {
  const persons = model().persons;
  const driver = personById(state.defaultDriver);
  if (!driver?.address?.lat || !state.destination?.lat) return [];
  const byId = new Map(persons.map((p) => [p.id, p]));
  const order = effectiveOrder(state, persons.filter(isActive));
  const admin = isAdmin();
  const mine = me();
  const stops = [{ id: `p:${driver.id}`, label: `${driver.name} (Start)`, lat: driver.address.lat, lng: driver.address.lng, color: driver.color, pids: [driver.id], draggable: admin || driver.id === mine }];
  for (const pid of order) {
    const p = byId.get(pid);
    const same = stops.find((s) => Math.abs(s.lat - p.address.lat) < 1e-5 && Math.abs(s.lng - p.address.lng) < 1e-5);
    if (same) { same.pids.push(pid); same.label += `, ${p.name}`; same.draggable = admin; continue; }
    stops.push({ id: `p:${pid}`, label: p.name, lat: p.address.lat, lng: p.address.lng, color: p.color, pids: [pid], draggable: admin || pid === mine });
  }
  stops.push({ id: 'dest', label: state.destination.label?.split(',')[0] || 'Ziel', lat: state.destination.lat, lng: state.destination.lng, draggable: admin });
  let seq = stops;
  if (dir === 'rueck') {
    // wie in der Abrechnung (model.tripSnap): erst die Absetz-Reihenfolge von Hand, dann der Rest rückwärts
    const pick = stops.slice(1, -1);
    const byPid = new Map(pick.flatMap((st) => st.pids.map((pid) => [pid, st])));
    const mid = [];
    for (const pid of state.returnOrder || []) { const st = byPid.get(pid); if (st && !mid.includes(st)) mid.push(st); }
    seq = [stops[stops.length - 1], ...mid, ...pick.filter((st) => !mid.includes(st)).reverse(), { ...stops[0], label: `${driver.name} (Ende)` }];
  }
  return insertDetours(seq, detours, dir).map((st) => (st.via
    ? { ...st, label: st.name, draggable: admin, popup: () => detourPopup(st.detour) }
    : st));
}

const coordsKey = (stops) => stops.map((s) => `${s.lat.toFixed(5)},${s.lng.toFixed(5)}`).join(';');

let routeBusy = false;
/** Beste Abholreihenfolge berechnen (wenn keine von Hand festgelegt ist) und die ganze Route holen. Nur Admin. */
const refreshRoute = debounce(async (force = false) => {
  if (!isAdmin() || routeBusy) return;
  const persons = model().persons.filter(isActive);
  const driver = personById(state.defaultDriver);
  if (!driver?.address?.lat || !state.destination?.lat) return;
  routeBusy = true;
  document.body.classList.add('loading-route');
  try {
    const pickups = persons.filter((p) => p.id !== driver.id && p.address?.lat != null);
    const pos = (a) => `${a.lat.toFixed(5)},${a.lng.toFixed(5)}`;
    const tokens = [`start@${pos(driver.address)}`, `ziel@${pos(state.destination)}`, ...pickups.map((p) => `${p.id}@${pos(p.address)}`)];
    const optKey = tokens.join(';');
    // Nur jemand entfernt? Dann bleibt die bisherige Reihenfolge (sonst änderte sich die laufende Woche rückwirkend).
    const onlyRemoved = state.optimizedFor && tokens.every((t) => state.optimizedFor.split(';').includes(t));
    if (!state.order?.length && pickups.length > 1 && (force || (state.optimizedFor !== optKey && !onlyRemoved))) {
      const idx = await optimizeOrder([driver.address, ...pickups.map((p) => p.address), state.destination]);
      const order = idx.map((i) => pickups[i].id);
      // Entfernte behalten ihren alten Platz (für bereits gefahrene Tage dieser Woche)
      const old = state.optimizedOrder || [];
      for (const [k, id] of old.entries()) if (personById(id)?.archived && !order.includes(id)) order.splice(Math.min(k, order.length), 0, id);
      adminSet((s) => { s.optimizedOrder = order; s.optimizedFor = optKey; }, `Beste Abholreihenfolge berechnet: ${order.filter((id) => !personById(id)?.archived).map((id) => personById(id)?.name).join(' → ')}`);
    } else if (onlyRemoved && state.optimizedFor !== optKey) update((s) => { s.optimizedFor = optKey; });
    const dirs = state.roundTrip !== false ? ['hin', 'rueck'] : ['hin'];
    for (const dir of dirs) {
      const stops = fullStops(dir);
      if (stops.length < 2) continue;
      const key = coordsKey(stops);
      const field = dir === 'rueck' ? 'returnRoute' : 'route';
      if (!force && state[field]?.key === key) continue;
      const [r] = await fetchRoute(stops);
      update((s) => {
        s[field] = { key, distance: r.distance, duration: r.duration, coords: r.coords, legs: r.legs, wpIdx: r.wpIdx };
        s.routeCache = { ...(s.routeCache || {}), [routeKey(stops)]: r.legs.map((l) => ({ km: Math.round(l.distance / 100) / 10, min: l.duration / 60 })) };
      });
      if (dir === routeDir()) map.fit(stops, state[field]);
    }
    if (state.roundTrip === false && state.returnRoute) update((s) => { s.returnRoute = null; });
  } catch (e) {
    toast(`Route konnte nicht berechnet werden: ${e.message}`, 'error');
  } finally {
    routeBusy = false;
    document.body.classList.remove('loading-route');
  }
}, 400);

// ---------- Route für die Anzeige (auch für Mitfahrer), befahrene Straßen, Verkehrsmeldungen ----------

const localRoutes = new Map(); // Schlüssel → Route, die dieses Gerät selbst berechnet hat (z. B. Mitfahrer)
const loadingRoutes = new Set();

/** Route einer Richtung für die Karte: die gemeinsame des Admins, sonst selbst berechnet. */
function displayRoute(dir) {
  const stops = fullStops(dir);
  if (stops.length < 2) return null;
  const key = coordsKey(stops);
  const shared = dir === 'rueck' ? state.returnRoute : state.route;
  if (shared?.key === key) return shared;
  if (localRoutes.has(key)) return localRoutes.get(key);
  if (!isAdmin() && !loadingRoutes.has(key)) {
    loadingRoutes.add(key);
    fetchRoute(stops)
      .then(([r]) => { localRoutes.set(key, { key, ...r }); requestRender(); })
      .catch(() => {})
      .finally(() => setTimeout(() => loadingRoutes.delete(key), 30_000));
  }
  return dir === 'rueck' && state.roundTrip === false ? null : shared || null;
}

const infos = new Map(); // Schlüssel → { distance, duration, refs, loading, error }

/** Länge, Fahrzeit und befahrene Straßen einer Stoppfolge (zwischengespeichert). */
function infoFor(stops) {
  const key = coordsKey(stops);
  let e = infos.get(key);
  if (!e) {
    e = { loading: true };
    infos.set(key, e);
    fetchRouteInfo(stops)
      .then((r) => Object.assign(e, r))
      .catch(() => { e.error = true; setTimeout(() => infos.delete(key), 60_000); }) // später noch einmal versuchen
      .finally(() => { e.loading = false; requestRender(); loadTraffic(); });
  }
  return e;
}

/** Befahrene Straßen (für die Autobahn-Meldungen) und Länge ohne Umleitung. */
function routeInfo(dir) {
  const stops = fullStops(dir);
  if (stops.length < 2) return null;
  const e = infoFor(stops);
  const hasDetour = stops.some((st) => st.via);
  const base = hasDetour ? infoFor(fullStops(dir, [])) : null;
  return { ...e, hasDetour, baseDistance: base?.distance, loading: e.loading || !!base?.loading, error: e.error || base?.error };
}

/** Normale Strecke einer Richtung und jede Umleitungs-Variante: Länge, Fahrzeit, Mehr-km und Mehr-Minuten. */
function variantInfo(dir, detour = null) {
  const baseStops = fullStops(dir, []);
  if (baseStops.length < 2) return null;
  const base = infoFor(baseStops);
  if (!detour) return base.loading || base.error ? null : { km: base.distance / 1000, min: base.duration / 60 };
  const w = infoFor(fullStops(dir, [{ ...detour, dir, use: true }]));
  if (base.loading || w.loading || base.error || w.error) return null;
  return { km: w.distance / 1000, min: w.duration / 60, extraKm: (w.distance - base.distance) / 1000, extraMin: (w.duration - base.duration) / 60 };
}

// Andere Routen (Admin): wie bei Google/Apple Karten – Ergebnis in der Strecken-Ansicht und auf der Karte
let suggestions = null; // { dir, closure, loading, done, total, list, base, error }

/** Aufgaben mit höchstens n gleichzeitigen Anfragen ausführen (fehlgeschlagene → null). */
async function pool(tasks, n, onDone) {
  const out = [];
  let next = 0;
  await Promise.all(Array.from({ length: n }, async () => {
    while (next < tasks.length) {
      const k = next++;
      try { out[k] = await tasks[k](); } catch { out[k] = null; }
      onDone?.();
    }
  }));
  return out;
}

const cityOf = (label = '') => (String(label).split(',').map((x) => x.trim()).filter(Boolean).pop() || '').replace(/^\d{4,5}\s*/, '');

/**
 * Andere Routen suchen: je Teilstück die Alternativen des Routenplaners plus Testpunkte links und rechts entlang der Strecke;
 * übrig bleiben die schnellsten, die auf mehreren Kilometern einen anderen Weg nehmen.
 * closure (optional): markierte Sperrung – dann nur Routen, die daran vorbeiführen.
 */
async function findDetours(dir, closure = null) {
  if (!isAdmin()) return;
  suggestions = { dir, closure, loading: true, done: 0, total: 0, list: [] };
  update((s) => { s.ui.tab = 'route'; s.ui.routeSub = 'route'; s.ui.routeDir = dir; });
  try {
    const stops = fullStops(dir, []);
    if (stops.length < 2) throw new Error('Start und Ziel fehlen');
    const legs = stops.slice(1).map((b, i) => ({ a: stops[i], b }));
    const mains = await Promise.all(legs.map((l) => fetchRoute([l.a, l.b], { alternatives: true, steps: true })));
    let closureLeg = -1;
    if (closure) {
      let best = Infinity;
      mains.forEach(([m], i) => { const d = nearestOnLine([closure.lat, closure.lng], m.coords).d; if (d < best) { best = d; closureLeg = i; } });
      if (best > 500) throw new Error('die markierte Stelle liegt nicht auf eurer Strecke');
    }
    const tasks = legs.map((l, i) => {
      const main = mains[i][0];
      if (main.distance < 1000 || (closure && i !== closureLeg)) return [];
      const spots = closure
        ? [{ idx: nearestOnLine([closure.lat, closure.lng], main.coords).i, km: [0.8, 1.5, 2.5, 4, 6, 9] }]
        : [0.15, 0.3, 0.45, 0.6, 0.75, 0.9].map((f) => ({ idx: Math.floor(main.coords.length * f), km: main.distance > 15000 ? [2, 5, 9] : [1.5, 3] }));
      return spots.flatMap((sp) => sidePoints(main.coords, sp.idx, sp.km)).map((p) => async () => {
        const [r] = await fetchRoute([l.a, p, l.b], { alternatives: false, steps: true });
        return { ...r, viaIdx: r.wpIdx[1], via: r.coords[r.wpIdx[1]] };
      });
    });
    suggestions.total = tasks.flat().length;
    const results = [];
    for (const t of tasks) results.push((await pool(t, 6, () => { suggestions.done++; requestRender(); })).filter(Boolean));
    const groups = mains.map(([main, ...alts], i) => ({ main, cands: [...alts, ...results[i]] }));
    const list = pickAlternatives(groups, { closure });
    const base = { km: mains.reduce((n, [m]) => n + m.distance, 0) / 1000, min: mains.reduce((n, [m]) => n + m.duration, 0) / 60 };
    await Promise.all(list.map(async (x) => {
      x.label = await reverseGeocode(x.lat, x.lng);
      x.city = cityOf(x.label);
      x.place = x.roads.length ? `${x.roads.join(', ')}${x.city ? ` (${x.city})` : ''}` : x.city || shortPlace(x.label);
    }));
    suggestions = { ...suggestions, loading: false, list, base };
  } catch (e) {
    suggestions = { ...suggestions, loading: false, list: [], error: e.message };
  }
  requestRender();
}

function clearSuggestions() { suggestions = null; requestRender(); }

// Sperrungen & Baustellen auf der Strecke (je Richtung)
let traffic = { hin: [], rueck: [], roads: [], at: 0, key: '', loading: false, ready: false, error: '' };

async function loadTrafficNow(force = false) {
  const dirs = state.roundTrip !== false ? ['hin', 'rueck'] : ['hin'];
  const info = dirs.map((d) => routeInfo(d));
  const routes = Object.fromEntries(dirs.map((d) => [d, displayRoute(d)]));
  if (info.some((i) => !i || i.loading) || dirs.some((d) => !routes[d]?.coords) || traffic.loading) return; // kommt wieder, sobald alles da ist
  const roads = autobahnRefs(info.flatMap((i) => i.refs || []));
  const key = `${dirs.map((d) => routes[d].key).join('|')}|${roads.join()}`;
  if (!force && traffic.key === key && Date.now() - traffic.at < 15 * 60e3) return;
  traffic = { ...traffic, loading: true };
  requestRender();
  try {
    if (info.some((i) => i.error)) throw new Error('Straßen der Route nicht ermittelt');
    const now = new Date();
    const items = (await Promise.all(roads.map((r) => roadEvents(r, { force })))).flat().filter((i) => isCurrent(i.times, now));
    const roadsBy = Object.fromEntries(dirs.map((d, k) => [d, autobahnRefs(info[k].refs || [])]));
    traffic = { hin: alongRoute(items, routes.hin.coords), rueck: routes.rueck ? alongRoute(items, routes.rueck.coords) : [], roads, roadsBy, at: Date.now(), key, loading: false, ready: true, error: '' };
  } catch (e) {
    traffic = { ...traffic, roads, at: Date.now(), key, loading: false, ready: true, error: e.message || 'Fehler' };
  }
  requestRender();
}
const loadTraffic = debounce(loadTrafficNow, 300);

function focusIncident(it) {
  if (!state.ui.showMap) update((s) => { s.ui.showMap = true; });
  if (window.innerWidth < 900) window.scrollTo({ top: 0, behavior: 'smooth' });
  map.invalidate();
  setTimeout(() => map.focusIncident(it), 120);
}

/** Ausweichrouten um eine gemeldete Sperrung suchen (Mitte des Abschnitts auf unserer Route). */
function searchAroundIncident(it) {
  map.closePopup();
  const pts = it.shown || it.coords;
  const [lat, lng] = pts[Math.floor(pts.length / 2)];
  findDetours(routeDir(), { lat, lng });
}

/** Aus einer Sperrung heraus: Umleitung mit Grund und Enddatum vorbelegen. */
function detourFromIncident(it) {
  map.closePopup();
  const st = it.times.end || it.times.overallEnd;
  const until = st ? `${st.getFullYear()}-${String(st.getMonth() + 1).padStart(2, '0')}-${String(st.getDate()).padStart(2, '0')}` : '';
  openDetourForm({ dir: routeDir(), note: `${it.road} ${it.title.replace(/^A\d+\s*\|\s*/, '')}`.trim(), until: until >= todayIso() ? until : '' });
  toast('Tippe jetzt auf der Karte auf die Straße, über die ihr fahrt – oder such den Ort im Formular.');
}

// ---------- Teilstrecken für einzelne Fahrten nachladen ----------

const inflight = new Set();
const failed = new Set();
const ensureRoutes = debounce(async () => {
  const t0 = todayIso();
  const ws = deriveRange(addDays(mondayOf(t0), -14), addDays(mondayOf(t0), 35));
  const missing = new Map();
  const known = allRoutes();
  for (const w of Object.values(ws)) {
    for (const [date, d] of Object.entries(w.days)) {
      for (const dir of ['hin', 'rueck']) {
        const t = d[dir];
        if (!t || !hasOwners(t.snap)) continue;
        const stops = plannedStops(t, t.snap, dir);
        if (stops.length < 2) continue;
        const k = routeKey(stops);
        if (!known[k] && !(t.snap.routes || {})[k] && !inflight.has(k) && !failed.has(k)) missing.set(k, stops);
      }
    }
  }
  for (const [k, stops] of missing) {
    inflight.add(k);
    try {
      const [r] = await fetchRoute(stops);
      const legs = r.legs.map((l) => ({ km: Math.round(l.distance / 100) / 10, min: l.duration / 60 }));
      update((s) => {
        s.localRoutes = { ...(s.localRoutes || {}), [k]: legs };
        if (isAdmin()) s.routeCache = { ...(s.routeCache || {}), [k]: legs };
      });
    } catch { failed.add(k); } finally { inflight.delete(k); }
  }
}, 600);

// ---------- Karte ----------

const mapHandlers = {
  menuItems: () => (isAdmin()
    ? [['closure', 'Hier ist gesperrt – Routen drumherum'], ['detour', 'Umleitung über diesen Punkt'], ['start', 'Start (Fahrer)'], ['end', 'Ziel']]
    : me() ? [['me', 'Meine Abholadresse']] : []),
  async onAddPoint(kind, latlng) {
    if (kind === 'closure') { findDetours(routeDir(), { lat: latlng.lat, lng: latlng.lng }); return; }
    const label = await reverseGeocode(latlng.lat, latlng.lng);
    const addr = { label, lat: latlng.lat, lng: latlng.lng };
    if (kind === 'detour') openDetourForm({ lat: addr.lat, lng: addr.lng, label, place: shortPlace(label) });
    else if (kind === 'me') safe(() => setAddress(me(), addr));
    else if (kind === 'end') setDestination(addr);
    else safe(() => setAddress(state.defaultDriver, addr));
  },
  async onStopMoved(id, latlng) {
    const label = await reverseGeocode(latlng.lat, latlng.lng);
    const addr = { label, lat: latlng.lat, lng: latlng.lng };
    if (id === 'dest') setDestination(addr);
    else if (id.startsWith('via:')) safe(() => { moveDetour(id.slice(4), { ...addr, place: shortPlace(label) }); refreshRoute(); });
    else safe(() => setAddress(id.slice(2), addr));
  },
  onStopRemove() {},
  onSelectAlternative() {},
};

function setDestination(addr) {
  safe(() => adminSet((s) => { s.destination = addr; }, `Ziel: ${addr.label}`));
}

let mapKeys = {};
function syncMap() {
  const dir = routeDir();
  const stops = fullStops(dir);
  const route = displayRoute(dir);
  const sk = JSON.stringify([dir, stops.map((s) => [s.id, s.lat, s.lng, s.label, s.draggable])]);
  if (sk !== mapKeys.stops) {
    map.setStops(stops);
    if (!mapKeys.fitted && stops.length) { setTimeout(() => map.fit(stops, route), 80); mapKeys.fitted = true; } // erstes Mal: auf die Strecke zoomen
    mapKeys.stops = sk;
  }
  const rk = [dir, route?.key, route?.distance].join('|');
  if (rk !== mapKeys.route) {
    if (route && mapKeys.route !== undefined) map.fit(stops, route);
    map.setRoute(route?.coords ? route : null, { color: ROUTE_COLORS[dir] });
    mapKeys.route = rk;
  }
  const ik = [dir, traffic.key, traffic.at, isAdmin()].join('|');
  if (ik !== mapKeys.traffic) {
    map.setIncidents(traffic[dir] || [], { popup: (it) => incidentPopup(it, { onDetour: isAdmin() ? detourFromIncident : null, onSearch: isAdmin() ? searchAroundIncident : null }) });
    mapKeys.traffic = ik;
  }
  const sg = suggestions && suggestions.dir === dir ? suggestions : null;
  const gk = sg ? [dir, sg.loading, sg.list.length, sg.closure?.lat].join('|') : '';
  if (gk !== mapKeys.sugg) {
    map.setSuggestions(sg?.loading ? [] : sg?.list || [], sg?.closure || null);
    if (sg && !sg.loading && sg.list.length) { map.invalidate(); setTimeout(() => map.fitLines(sg.list.map((x) => x.coords)), 80); }
    mapKeys.sugg = gk;
  }
  const back = state.roundTrip !== false && stops.length >= 2;
  const dk = `${back}|${dir}`;
  if (dk !== mapKeys.dir) {
    map.setDirControl({ show: back, dir, onChange: setRouteDir });
    mapKeys.dir = dk;
  }
  const tk = FUELS[state.car.fuel]?.tk;
  const stKey = [state.stations.length, state.stations[0]?.id, state.price.stationId, tk, state.price.updatedAt].join('|');
  if (stKey !== mapKeys.stations) {
    map.setStations(tk ? state.stations : [], tk, state.price.stationId, (id) => stationSelected(id));
    mapKeys.stations = stKey;
  }
}

function toggleMap() {
  update((s) => { s.ui.showMap = !s.ui.showMap; });
  map.invalidate();
  if (state.ui.showMap) setTimeout(() => map.fit(fullStops(routeDir()), displayRoute(routeDir())), 80);
}

// ---------- Navigation ----------

function go(view) {
  update((s) => { s.ui.tab = view; });
  window.scrollTo({ top: 0 });
  map.invalidate();
  if (view === 'route') setTimeout(() => map.fit(fullStops(routeDir()), displayRoute(routeDir())), 120); // Karte wird auf dem Handy erst hier sichtbar
}

function renderNav() {
  const cur = state.ui.tab;
  const mine = me();
  const accounts = claims();
  const badge = (mine ? myBalance(mine).owe.length : 0)
    + toConfirm(mine, { admin: isAdmin(), hasAccount: (pid) => !inGroup() || accounts.has(pid) }).length; // offen + zu bestätigen
  const vs = views();
  $('#nav-side').replaceChildren(...vs.map((v) => h('button', {
    type: 'button', class: `nav-item ${v.id === cur ? 'active' : ''}`, 'aria-current': v.id === cur ? 'page' : null, onclick: () => go(v.id),
  }, h('span', { class: `sq sq-${v.color}` }, icon(v.icon, { size: 17 })), h('span', {}, v.label),
  v.id === 'costs' && badge ? h('span', { class: 'badge' }, String(badge)) : null)));
  const tabs = $('#nav-tabs');
  tabs.style.gridTemplateColumns = `repeat(${vs.length}, 1fr)`;
  tabs.replaceChildren(...vs.map((v) => h('button', {
    type: 'button', class: `tab-item ${v.id === cur ? 'active' : ''}`, 'aria-current': v.id === cur ? 'page' : null, onclick: () => go(v.id),
  }, icon(v.icon, { size: 24 }), h('span', {}, v.label === 'Einstellungen' ? 'Mehr' : v.label),
  v.id === 'costs' && badge ? h('span', { class: 'badge' }, String(badge)) : null)));
  const mapBtn = $('#btn-map');
  mapBtn.replaceChildren(icon(state.ui.showMap ? 'panel-right-close' : 'map', { size: 19 }));
  mapBtn.classList.toggle('on', !!state.ui.showMap);
  mapBtn.title = state.ui.showMap ? 'Karte ausblenden' : 'Karte einblenden';
}

// ---------- Rendering ----------

// Neu zeichnen erst nach einem laufenden Klick (sonst gehen Klicks nach einem „change“ verloren).
let pointerDown = false;
let pending = false;
let rendering = false;

function requestRender() {
  if (pointerDown || rendering) { pending = true; return; }
  pending = false;
  rendering = true;
  try { render(); } finally { rendering = false; }
  if (pending) queueMicrotask(requestRender);
}

function releasePointer() {
  pointerDown = false;
  if (pending) setTimeout(requestRender, 0);
}

const ctx = () => ({
  map, go, toggleMap, data: dataActions, openAccount, setDestination, adminSet: (fn, text) => safe(() => adminSet(fn, text)),
  refreshRoute, routeDir, setRouteDir, displayRoute, routeInfo, variantInfo, findDetours, clearSuggestions, suggestions: () => suggestions, traffic: () => traffic, loadTraffic, focusIncident,
});

function render() {
  const vs = views();
  if (!vs.some((v) => v.id === state.ui.tab)) state.ui.tab = 'home';
  const view = state.ui.tab;
  document.body.dataset.view = view;
  document.body.classList.toggle('map-on', !!state.ui.showMap);
  document.body.classList.toggle('is-admin', isAdmin());
  $('#view-title').textContent = vs.find((v) => v.id === view).label;
  renderNav();

  const el = $('#view');
  const focusedId = document.activeElement?.dataset?.focusKey;
  el.replaceChildren();
  const c = ctx();
  if (view === 'home') renderHome(el, c);
  if (view === 'trips') renderTrips(el, c);
  if (view === 'costs') renderCosts(el, c);
  if (view === 'route') { renderRouteView(el, c); loadTraffic(); }
  if (view === 'settings') renderSettings(el, c);
  if (focusedId) el.querySelector(`[data-focus-key="${focusedId}"]`)?.focus();
  if ($('#day-dialog')?.open) renderSheet();
  syncMap();
  ensureRoutes();
  if (isAdmin()) { refreshRoute(); freezeLater(); }
}

const freezeLater = debounce(() => freezePastWeeks(liveSnap), 1500);

// ---------- Daten ----------

const dataActions = {
  exportData() {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const a = h('a', { href: URL.createObjectURL(blob), download: `tankrechner-${todayIso()}.json` });
    a.click();
    URL.revokeObjectURL(a.href);
  },
  importData() { if (!isAdmin()) return; $('#file-import').click(); },
  example() {
    if (inGroup() && !isAdmin()) return;
    if (!confirm(inGroup() ? 'Beispieldaten laden? Das ersetzt die Daten der GANZEN Fahrgemeinschaft – für alle Mitglieder!' : 'Beispieldaten laden? Deine aktuellen Daten werden ersetzt.')) return;
    replaceState({ ...loadExample(), ui: { ...state.ui, tab: 'home', welcomeDone: true } });
    mapKeys = {};
  },
  reset() {
    if (!confirm(inGroup() ? 'Wirklich alles löschen? Das löscht die Daten der GANZEN Fahrgemeinschaft – für alle Mitglieder!' : 'Wirklich alles löschen?')) return;
    replaceState({ ...defaultState(), ui: { ...defaultState().ui, welcomeDone: inGroup() } });
    mapKeys = {};
  },
};

function setupImport() {
  $('#file-import').onchange = async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    try {
      replaceState(JSON.parse(await f.text()));
      mapKeys = {};
      toast('Daten importiert', 'ok');
    } catch { toast('Datei konnte nicht gelesen werden', 'error'); }
    e.target.value = '';
  };
}

function init() {
  setupVersion();
  if (state.ui.showMap === undefined) state.ui.showMap = true;
  map = new MapView($('#map'), mapHandlers);
  subscribe(requestRender);
  document.addEventListener('pointerdown', () => { pointerDown = true; }, true);
  document.addEventListener('pointerup', releasePointer, true);
  document.addEventListener('pointercancel', releasePointer, true);
  $('#btn-map').onclick = toggleMap;
  document.addEventListener('account-changed', requestRender);
  setupImport();
  initAccount();
  requestRender();
  // Karte erst vermessen, wenn die Seite steht (startet die App direkt mit sichtbarer Karte)
  map.invalidate();
  setTimeout(() => map.fit(fullStops(routeDir()), displayRoute(routeDir())), 120);
  startAutoRefresh();
  window.addEventListener('resize', () => map.invalidate());
  window.addEventListener('scroll', () => document.body.classList.toggle('scrolled', window.scrollY > 8), { passive: true });
}

init();

export { SHARED_KEYS, activePersons };
