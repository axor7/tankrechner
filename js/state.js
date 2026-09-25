// Zustand der App + Speicherung im Browser (localStorage).
import { mondayOf, toISODate } from './calc.js';

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
    route: null,
    alternatives: [],
    car: { consumption: 6.5, fuel: 'e10', extraPerKm: 0 },
    price: { mode: 'cheapest', manual: 1.75, current: null, stationId: null, stationName: '', updatedAt: null },
    apiKey: '',
    stations: [],
    observations: [],
    split: { mode: 'segment', driverPays: true },
    weeks: {},
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

/** Zustand ändern. render=false, wenn gerade getippt wird und nichts neu gezeichnet werden soll. */
export function update(fn, { render = true } = {}) {
  fn(state);
  save();
  if (render) listeners.forEach((l) => l(state));
}

export function replaceState(next) {
  const d = defaultState();
  state = { ...d, ...next, ui: { ...d.ui, ...(next.ui || {}) } };
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
    }));
  }
  if (s.manualKm > 0) return [{ from: 'Start', to: 'Ziel', km: Number(s.manualKm) }];
  return [];
}

/** Momentaufnahme der Einstellungen – damit alte Wochen stabil abgerechnet bleiben. */
export function makeSnapshot(s = state) {
  return {
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
