// Arbeit im Hintergrund (ohne Oberfläche): Route und beste Abholreihenfolge, Teilstrecken für die Abrechnung,
// Sperrungen & Baustellen, Ausweichrouten, Schulferien/Feiertage, Wochen einfrieren, Daten sichern.
import { state, update, model, personById, allRoutes, liveSnap, todayIso, replaceState, defaultState } from './state.js';
import { reverseGeocode, fetchRoute, fetchRouteInfo, valhallaRoute, optimizeOrder, fetchSchoolHolidays, fetchPublicHolidays } from './api.js';
import { plannedStops, routeKey, mondayOf, addDays, hasOwners, insertDetours } from './calc.js';
import { searchAlternatives, usesClosure } from './detours.js';
import { effectiveOrder, isActive, activeDetours } from './model.js';
import { debounce, toast } from './ui.js';
import { autobahnRefs, roadEvents, alongRoute, isCurrent, isClosure, timeStatus, cleanTitle } from './traffic.js';
import { isAdmin, inGroup } from './account.js';
import { me, adminSet, freezePastWeeks } from './actions.js';
import { weeks as deriveRange } from './derived.js';
import { loadExample } from './example.js';

let hooks = { render: () => {}, routeReady: () => {} };
export function setHooks(h) { hooks = { ...hooks, ...h }; }
const rerender = () => hooks.render();

// ---------- Ganze Route (alle Abholpunkte) ----------

/** Welche Richtung zeigt die Karte? */
export const routeDir = () => (state.roundTrip !== false && state.ui.routeDir === 'rueck' ? 'rueck' : 'hin');

/**
 * Stopps der ganzen Route (alle fahren mit) in Fahrtrichtung, mit den heute gefahrenen Umleitungen
 * (oder den übergebenen – z. B. [] für die normale Strecke).
 * Hin: Fahrer → Abholpunkte → Ziel · Zurück: Ziel → Absetz-Reihenfolge → Fahrer
 */
export function fullStops(dir = 'hin', detours = activeDetours(state.detours, todayIso())) {
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
    const pick = stops.slice(1, -1);
    const byPid = new Map(pick.flatMap((st) => st.pids.map((pid) => [pid, st])));
    const mid = [];
    for (const pid of state.returnOrder || []) { const st = byPid.get(pid); if (st && !mid.includes(st)) mid.push(st); }
    seq = [stops[stops.length - 1], ...mid, ...pick.filter((st) => !mid.includes(st)).reverse(), { ...stops[0], label: `${driver.name} (Ende)` }];
  }
  return insertDetours(seq, detours, dir).map((st) => (st.via ? { ...st, label: st.name, draggable: false } : st));
}

const coordsKey = (stops) => stops.map((s) => `${s.lat.toFixed(5)},${s.lng.toFixed(5)}`).join(';');

let routeBusy = false;
/** Beste Abholreihenfolge berechnen (wenn keine von Hand festgelegt ist) und die ganze Route holen. Nur Admin. */
export const refreshRoute = debounce(async (force = false) => {
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
      const old = state.optimizedOrder || [];
      for (const [k, id] of old.entries()) if (personById(id)?.archived && !order.includes(id)) order.splice(Math.min(k, order.length), 0, id);
      adminSet((s) => { s.optimizedOrder = order; s.optimizedFor = optKey; }, `Beste Abholreihenfolge: ${order.filter((id) => !personById(id)?.archived).map((id) => personById(id)?.name).join(' → ')}`);
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
      hooks.routeReady(dir);
    }
    if (state.roundTrip === false && state.returnRoute) update((s) => { s.returnRoute = null; });
  } catch (e) {
    toast(`Route konnte nicht berechnet werden: ${e.message}`, 'error');
  } finally {
    routeBusy = false;
    document.body.classList.remove('loading-route');
  }
}, 400);

// ---------- Route für die Anzeige (auch für Mitfahrer) ----------

const localRoutes = new Map();
const loadingRoutes = new Set();

/** Route einer Richtung für die Karte: die gemeinsame des Admins, sonst selbst berechnet. detours: [] = normale Strecke. */
export function displayRoute(dir, detours) {
  const stops = detours ? fullStops(dir, detours) : fullStops(dir);
  if (stops.length < 2) return null;
  const key = coordsKey(stops);
  const shared = dir === 'rueck' ? state.returnRoute : state.route;
  if (shared?.key === key) return shared;
  if (localRoutes.has(key)) return localRoutes.get(key);
  if ((!isAdmin() || detours) && !loadingRoutes.has(key)) {
    loadingRoutes.add(key);
    fetchRoute(stops)
      .then(([r]) => { localRoutes.set(key, { key, ...r }); rerender(); })
      .catch(() => {})
      .finally(() => setTimeout(() => loadingRoutes.delete(key), 30_000));
  }
  return dir === 'rueck' && state.roundTrip === false ? null : shared || null;
}

const infos = new Map();
/** Länge, Fahrzeit und befahrene Straßen einer Stoppfolge (zwischengespeichert). */
function infoFor(stops) {
  const key = coordsKey(stops);
  let e = infos.get(key);
  if (!e) {
    e = { loading: true };
    infos.set(key, e);
    fetchRouteInfo(stops)
      .then((r) => Object.assign(e, r))
      .catch(() => { e.error = true; setTimeout(() => infos.delete(key), 60_000); })
      .finally(() => { e.loading = false; rerender(); loadTraffic(); });
  }
  return e;
}

/** Befahrene Straßen und Länge (mit Umleitung). */
export function routeInfo(dir) {
  const stops = fullStops(dir);
  if (stops.length < 2) return null;
  const e = infoFor(stops);
  const hasDetour = stops.some((st) => st.via);
  const base = hasDetour ? infoFor(fullStops(dir, [])) : null;
  return { ...e, hasDetour, baseDistance: base?.distance, baseDuration: base?.duration, loading: e.loading || !!base?.loading, error: e.error || base?.error };
}

/** Normale Strecke einer Richtung oder eine Umleitungs-Variante: km, Minuten, Mehr-km und Mehr-Minuten (oder null, solange gerechnet wird). */
export function variantInfo(dir, detour = null) {
  const baseStops = fullStops(dir, []);
  if (baseStops.length < 2) return null;
  const base = infoFor(baseStops);
  if (!detour) return base.loading || base.error ? null : { km: base.distance / 1000, min: base.duration / 60 };
  const w = infoFor(fullStops(dir, [{ ...detour, dir, use: true }]));
  if (base.loading || w.loading || base.error || w.error) return null;
  return { km: w.distance / 1000, min: w.duration / 60, extraKm: (w.distance - base.distance) / 1000, extraMin: (w.duration - base.duration) / 60 };
}

// ---------- Ausweichrouten ----------

let suggestions = null; // { dir, closure, loading, done, total, list, base, error }
export const getSuggestions = () => suggestions;
const cityOf = (label = '') => (String(label).split(',').map((x) => x.trim()).filter(Boolean).pop() || '').replace(/^\d{4,5}\s*/, '');
export const shortPlace = (label = '') => {
  const parts = String(label).split(',').map((x) => x.trim()).filter(Boolean);
  if (parts.length < 2) return parts[0] || 'Umleitung';
  return `${parts[0]}, ${parts[parts.length - 1].replace(/^\d{4,5}\s*/, '')}`;
};

/** Ausweichrouten um eine Sperrung suchen (wie bei Google/Apple Karten). closure: { coords, title, from, until } */
export async function findDetours(dir, closure = null) {
  if (!isAdmin()) return;
  suggestions = { dir, closure, loading: true, done: 0, total: 0, list: [] };
  update((s) => { s.ui.routeDir = dir; });
  try {
    const stops = fullStops(dir, []);
    if (stops.length < 2) throw new Error('Start und Ziel fehlen');
    const res = await searchAlternatives(stops, {
      dir, closure, fetchRoute, valhallaRoute,
      onProgress: (done, total) => { suggestions.done = done; suggestions.total = total; rerender(); },
    });
    await Promise.all(res.list.map(async (x) => {
      x.label = await reverseGeocode(x.lat, x.lng);
      x.city = cityOf(x.label);
      x.place = x.roads.length ? x.roads.join(', ') : x.city || shortPlace(x.label);
    }));
    suggestions = { ...suggestions, loading: false, list: res.list, base: res.base };
  } catch (e) {
    suggestions = { ...suggestions, loading: false, list: [], error: e.message };
  }
  rerender();
}

export function clearSuggestions() { suggestions = null; rerender(); }

// ---------- Sperrungen & Baustellen ----------

let traffic = { hin: [], rueck: [], roads: [], at: 0, key: '', loading: false, ready: false, error: '' };
export const getTraffic = () => traffic;

async function loadTrafficNow(force = false) {
  const dirs = state.roundTrip !== false ? ['hin', 'rueck'] : ['hin'];
  const info = dirs.map((d) => routeInfo(d));
  const routes = Object.fromEntries(dirs.map((d) => [d, displayRoute(d)]));
  const normals = Object.fromEntries(dirs.map((d) => [d, displayRoute(d, [])]));
  if (info.some((i) => !i || i.loading) || dirs.some((d) => !routes[d]?.coords || !normals[d]?.coords) || traffic.loading) return;
  const roads = autobahnRefs(info.flatMap((i) => i.refs || []));
  const key = `${dirs.map((d) => `${routes[d].key}/${normals[d].key}`).join('|')}|${roads.join()}`;
  if (!force && traffic.key === key && Date.now() - traffic.at < 15 * 60e3) return;
  traffic = { ...traffic, loading: true };
  try {
    if (info.some((i) => i.error)) throw new Error('Straßen der Route nicht ermittelt');
    const now = new Date();
    const items = (await Promise.all(roads.map((r) => roadEvents(r, { force })))).flat().filter((i) => isCurrent(i.times, now));
    const along = (d) => {
      const list = alongRoute(items, routes[d].coords);
      for (const it of alongRoute(items, normals[d].coords)) if (isClosure(it) && !list.some((x) => x.id === it.id)) list.push(it);
      return list;
    };
    traffic = { hin: along('hin'), rueck: routes.rueck ? along('rueck') : [], roads, at: Date.now(), key, loading: false, ready: true, error: '' };
  } catch (e) {
    traffic = { ...traffic, roads, at: Date.now(), key, loading: false, ready: true, error: e.message || 'Fehler' };
  }
  rerender();
}
export const loadTraffic = debounce(loadTrafficNow, 300);

const isoDay = (d) => (d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` : null);

/** Sperrungen, die unsere Strecke wirklich betreffen (jetzt oder in den nächsten 3 Tagen).
 *  passes: die aktuelle Route (ggf. mit Umleitung) führt hindurch. */
export function relevantClosures(dir) {
  const soon = Date.now() + 3 * 864e5;
  const route = displayRoute(dir);
  const normal = displayRoute(dir, []);
  return (traffic[dir] || []).filter((it) => {
    if (!isClosure(it)) return false;
    const st = timeStatus(it.times);
    return st.state !== 'ended' && (st.state !== 'upcoming' || (st.from && st.from.getTime() < soon));
  }).map((it) => {
    const zone = { coords: it.shown || it.coords, title: cleanTitle(it), from: isoDay(it.times.start), until: isoDay(it.times.end || it.times.overallEnd) };
    const passes = !!route?.coords && usesClosure(route.coords, zone);
    const normalPasses = !!normal?.coords && usesClosure(normal.coords, zone);
    return { it, zone, passes, relevant: passes || normalPasses, upcoming: timeStatus(it.times).state === 'upcoming' };
  }).filter((x) => x.relevant);
}

/** Was auf der Karte erscheint: Baustellen plus nur die Sperrungen, die uns betreffen. */
export const mapIncidents = (dir) => [...(traffic[dir] || []).filter((it) => !isClosure(it)), ...relevantClosures(dir).map((x) => x.it)];

// ---------- Teilstrecken für einzelne Fahrten nachladen ----------

const inflight = new Set();
const failed = new Set();
export const ensureRoutes = debounce(async () => {
  const t0 = todayIso();
  const ws = deriveRange(addDays(mondayOf(t0), -14), addDays(mondayOf(t0), 35));
  const missing = new Map();
  const known = allRoutes();
  for (const w of Object.values(ws)) {
    for (const d of Object.values(w.days)) {
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

// ---------- Schulferien und Feiertage ----------

let holidaysLoading = false;
export async function ensureHolidays() {
  const hol = state.holidays;
  if (!isAdmin() || !hol || holidaysLoading) return;
  const t0 = todayIso();
  if (!hol.public) { update((s) => { s.holidays = { ...s.holidays, public: { enabled: s.kind !== 'other', from: t0, periods: [], fetchedAt: 0 } }; }); return; }
  const stale = (x) => x.fetchedFor !== hol.region || Date.now() - (x.fetchedAt || 0) > 14 * 864e5;
  const school = hol.enabled && stale(hol);
  const pub = hol.public.enabled && stale(hol.public);
  if (!school && !pub) return;
  holidaysLoading = true;
  try {
    const from = addDays(hol.from && hol.from < t0 ? hol.from : t0, -60);
    const [periods, publicDays] = await Promise.all([
      school ? fetchSchoolHolidays(hol.region, from, addDays(t0, 540)) : null,
      pub ? fetchPublicHolidays(hol.region, addDays(t0, -30), addDays(t0, 540)) : null,
    ]);
    update((s) => {
      const next = { ...s.holidays };
      if (periods) Object.assign(next, { periods, fetchedAt: Date.now(), fetchedFor: hol.region });
      if (publicDays) next.public = { ...next.public, periods: publicDays, fetchedAt: Date.now(), fetchedFor: hol.region };
      s.holidays = next;
    });
  } catch { /* später noch einmal */ } finally { holidaysLoading = false; }
}

export const freezeLater = debounce(() => freezePastWeeks(liveSnap), 1500);

/** Nach jeder Änderung: was im Hintergrund nachzuholen ist. */
export function background() {
  ensureRoutes();
  if (isAdmin()) { refreshRoute(); freezeLater(); ensureHolidays(); }
}

// ---------- Daten ----------

export const data = {
  exportData() {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `tankrechner-${todayIso()}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  },
  importData() {
    if (!isAdmin()) return;
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';
    input.onchange = async () => {
      const f = input.files[0];
      if (!f) return;
      try { replaceState(JSON.parse(await f.text())); toast('Daten importiert', 'ok'); } catch { toast('Datei konnte nicht gelesen werden', 'error'); }
    };
    input.click();
  },
  example() {
    if (inGroup() && !isAdmin()) return;
    // Nur nachfragen, wenn es etwas zu ersetzen gibt (beim allerersten Start nicht)
    const hasData = inGroup() || state.setupDone || state.persons.length > 1 || state.persons.some((p) => p.address?.lat);
    if (hasData && !confirm(inGroup() ? 'Beispieldaten laden? Das ersetzt die Daten der GANZEN Fahrgemeinschaft – für alle!' : 'Beispieldaten laden? Deine Daten auf diesem Gerät werden ersetzt.')) return;
    replaceState({ ...loadExample(), ui: { ...state.ui, screen: 'rides', welcomeDone: true } });
  },
  reset() {
    if (!confirm(inGroup() ? 'Wirklich alles löschen? Das löscht die Daten der GANZEN Fahrgemeinschaft – für alle!' : 'Wirklich alles löschen?')) return;
    replaceState({ ...defaultState(), ui: { ...defaultState().ui, welcomeDone: inGroup() } });
  },
};
