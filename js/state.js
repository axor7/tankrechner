// Zustand der App + Speicherung im Browser (localStorage).
import { mondayOf, toISODate, routeKey } from './calc.js';

const KEY = 'tankrechner:v1';

export const COLORS = ['#2563eb', '#db2777', '#16a34a', '#ea580c', '#7c3aed', '#0891b2', '#ca8a04', '#dc2626'];

export const uid = () => Math.random().toString(36).slice(2, 10);

export function defaultState() {
  const me = { id: uid(), name: 'Ich', color: COLORS[0] };
  return {
    version: 1,
    persons: [me],
    defaultDriver: me.id,
    stops: [
      { id: uid(), label: '', lat: null, lng: null },
      { id: uid(), label: '', lat: null, lng: null },
    ],
    roundTrip: true,
    manualKm: null,
    returnOrder: null, // Stopp-IDs für die Rückfahrt (null = umgekehrt wie Hinweg)
    route: null,
    returnRoute: null,
    routeCache: {}, // berechnete Routen je Stoppfolge (für ausgelassene Adressen)
    alternatives: [],
    car: { consumption: 6.5, fuel: 'e10', extraPerKm: 0 },
    price: { mode: 'cheapest', manual: 1.75, current: null, stationId: null, stationName: '', updatedAt: null },
    apiKey: '',
    stations: [],
    observations: [],
    split: { mode: 'segment', driverPays: true, includeExtra: true },
    weeks: {},
    payments: {}, // bezahlte Ausgleichszahlungen: { 'Woche|von|an': { amount, at } }
    ui: { tab: 'route', week: mondayOf(toISODate(new Date())), showWeekend: false, period: 'week', from: '', to: '' },
  };
}

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaultState();
    const s = JSON.parse(raw);
    const d = defaultState();
    return { ...d, ...s, car: { ...d.car, ...s.car }, price: { ...d.price, ...s.price }, split: { ...d.split, ...s.split }, ui: { ...d.ui, ...s.ui } };
  } catch {
    return defaultState();
  }
}

const listeners = new Set();
export let state = load();

export function save() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* Speicher voll o. ä. */ }
}

/** Daten, die in einer Fahrgemeinschaft geteilt werden (Rest bleibt pro Gerät: Ansicht, API-Key, Messwerte …). */
export const SHARED_KEYS = ['persons', 'defaultDriver', 'stops', 'roundTrip', 'manualKm', 'returnOrder', 'route', 'returnRoute',
  'routeCache', 'car', 'price', 'split', 'weeks', 'payments'];

export function sharedData(s = state) {
  const o = {};
  for (const k of SHARED_KEYS) if (s[k] !== undefined) o[k] = s[k];
  return o;
}

let changeHook = null;
/** Wird bei jeder Änderung mit der Änderungsfunktion aufgerufen (für die Synchronisation). */
export function onChange(fn) { changeHook = fn; }

/** Zustand ändern. render=false, wenn gerade getippt wird und nichts neu gezeichnet werden soll. */
export function update(fn, { render = true } = {}) {
  fn(state);
  save();
  changeHook?.(fn);
  if (render) listeners.forEach((l) => l(state));
}

export function replaceState(next) {
  const d = defaultState();
  state = { ...d, ...next, ui: { ...d.ui, ...(next.ui || {}) } };
  save();
  // Für die Synchronisation als Änderung der gemeinsamen Daten melden
  const shared = structuredClone(sharedData(state));
  changeHook?.((s) => { Object.assign(s, structuredClone(shared)); });
  listeners.forEach((l) => l(state));
}

/** Serverstand der gemeinsamen Daten übernehmen, danach offene eigene Änderungen erneut anwenden. */
export function applyRemote(data, replay = []) {
  const d = defaultState();
  const next = { ...state };
  for (const k of SHARED_KEYS) next[k] = data[k] !== undefined ? structuredClone(data[k]) : d[k];
  state = next;
  for (const fn of replay) {
    try { fn(state); } catch { /* Änderung passt nicht mehr zum neuen Stand – überspringen */ }
  }
  save();
  listeners.forEach((l) => l(state));
}

export function subscribe(fn) { listeners.add(fn); }

// ---------- Abgeleitete Werte ----------

export const validStops = (s = state) => s.stops.filter((x) => x.lat != null && x.lng != null);

export function effectivePrice(s = state) {
  if (s.price.mode !== 'manual' && s.price.current > 0) return s.price.current;
  return Number(s.price.manual) || 0;
}

export function stopName(stop, i, n) {
  if (stop.label) return stop.label.split(',')[0];
  return i === 0 ? 'Start' : i === n - 1 ? 'Ziel' : `Stopp ${i}`;
}

/** Teilstrecken der aktuellen Route (km). */
export function currentLegs(s = state) {
  const stops = validStops(s);
  if (s.route && s.route.legs.length === stops.length - 1) {
    return s.route.legs.map((l, i) => ({
      from: stopName(stops[i], i, stops.length),
      to: stopName(stops[i + 1], i + 1, stops.length),
      km: Math.round(l.distance / 100) / 10,
      min: l.duration / 60,
    }));
  }
  if (s.manualKm > 0) return [{ from: 'Start', to: 'Ziel', km: Number(s.manualKm) }];
  return [];
}

/** Reihenfolge der Stopps auf der Rückfahrt (IDs). Beginnt immer am Ziel des Hinwegs. */
export function returnOrderIds(s = state) {
  const ids = validStops(s).map((x) => x.id);
  const reversed = [...ids].reverse();
  const saved = (s.returnOrder || []).filter((id) => ids.includes(id));
  if (saved.length !== ids.length || saved[0] !== reversed[0]) return reversed;
  return saved;
}

export const isCustomReturn = (s = state) => returnOrderIds(s).join() !== validStops(s).map((x) => x.id).reverse().join();

export function returnStops(s = state) {
  const byId = new Map(validStops(s).map((x) => [x.id, x]));
  return returnOrderIds(s).map((id) => byId.get(id));
}

const kmLegs = (route) => route.legs.map((l) => ({ km: Math.round(l.distance / 100) / 10, min: l.duration / 60 }));

/** Momentaufnahme der Einstellungen – damit alte Wochen stabil abgerechnet bleiben. */
export function makeSnapshot(s = state) {
  const valid = validStops(s);
  const stops = valid.map((x, i) => ({ id: x.id, name: stopName(x, i, valid.length), lat: x.lat, lng: x.lng, owners: [...(x.owners || [])] }));
  const routes = {};
  if (stops.length >= 2 && s.route?.legs.length === stops.length - 1) routes[routeKey(stops)] = kmLegs(s.route);
  const back = returnStops(s);
  if (back.length >= 2 && s.returnRoute?.legs.length === back.length - 1) routes[routeKey(back)] = kmLegs(s.returnRoute);
  else if (!isCustomReturn(s) && routes[routeKey(stops)]) routes[routeKey(back)] = [...routes[routeKey(stops)]].reverse(); // wie bisher: Rückweg = Hinweg umgekehrt
  return {
    stops,
    returnOrder: returnOrderIds(s),
    routes,
    legs: currentLegs(s),
    consumption: Number(s.car.consumption) || 0,
    price: effectivePrice(s),
    extraPerKm: Number(s.car.extraPerKm) || 0,
    fuel: s.car.fuel,
    roundTrip: s.roundTrip,
    at: Date.now(),
  };
}

export function getWeek(monday, create = false) {
  if (!state.weeks[monday] && create) state.weeks[monday] = { snap: makeSnapshot(), days: {} };
  return state.weeks[monday];
}

export function personById(id) {
  return state.persons.find((p) => p.id === id);
}
