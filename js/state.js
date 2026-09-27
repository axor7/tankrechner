// Zustand der App + Speicherung im Browser (localStorage).
import { mondayOf, toISODate } from './calc.js';
import { buildModel, migrateV1, liveWeekSnap, isActive } from './model.js';

const KEY = 'tankrechner:v1';

export const COLORS = ['#007aff', '#ff2d55', '#34c759', '#ff9500', '#af52de', '#30b0c7', '#ffcc00', '#5856d6', '#a2845e', '#ff3b30'];

export const uid = () => Math.random().toString(36).slice(2, 10);
export const todayIso = () => toISODate(new Date());

export function defaultState() {
  const me = { id: uid(), name: 'Ich', color: COLORS[0], plan: [] };
  return {
    schema: 2,
    // ---- gemeinsam (in der Fahrgemeinschaft; ändern nur Admins) ----
    persons: [me],
    defaultDriver: me.id,          // wer fährt (Auto, Startadresse)
    drivers: [],                   // Fahrerwechsel [{ from, id, at }] – gelten ab ihrem Datum
    destination: null,             // Ziel { label, lat, lng }
    roundTrip: true,
    manualKm: null,                // Kilometer, falls ohne Karte
    order: null,                   // Abholreihenfolge von Hand (Personen-IDs), sonst berechnet
    optimizedOrder: null,          // beste Abholreihenfolge (berechnet)
    returnOrder: null,             // Absetz-Reihenfolge von Hand, sonst umgekehrt
    route: null,                   // ganze Route (für die Karte)
    routeCache: {},                // berechnete Teilstrecken je Stoppfolge
    car: { consumption: 6.5, fuel: 'e10', extraPerKm: 0 },
    price: { mode: 'cheapest', manual: 1.75, current: null, stationId: null, stationName: '', updatedAt: null },
    split: { mode: 'segment', driverPays: true, includeExtra: true },
    days: {},                      // Tages-Änderungen des Admins { datum: { off, driver: {hin, rueck}, people: { id: {hin, rueck, at} } } }
    weeks: {},                     // eingefrorene Werte abgeschlossener Wochen { montag: { snap } }
    payments: {},                  // bezahlt { 'Woche|von|an': { amount, at, by } | { revoked, at, by } }
    setupDone: false,
    // ---- nur auf diesem Gerät ----
    apiKey: '',
    stations: [],
    observations: [],
    localRoutes: {},
    profiles: [],                  // Profile der Mitfahrer (aus der Fahrgemeinschaft geladen)
    log: [],                       // Änderungsprotokoll ohne Fahrgemeinschaft
    ui: { tab: 'home', week: mondayOf(todayIso()), showWeekend: false, detail: 'simple', me: null, routeSub: 'route', welcomeDone: false },
  };
}

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaultState();
    let s = JSON.parse(raw);
    if (!(s.schema >= 2)) s = migrateV1(s, todayIso());
    const d = defaultState();
    return { ...d, ...s, car: { ...d.car, ...s.car }, price: { ...d.price, ...s.price }, split: { ...d.split, ...s.split }, ui: { ...d.ui, ...s.ui, welcomeDone: s.ui?.welcomeDone ?? true } };
  } catch {
    return defaultState();
  }
}

const listeners = new Set();
export let state = load();
let rev = 0; // Änderungszähler (für zwischengespeicherte Berechnungen)

export function save() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* Speicher voll o. ä. */ }
}

/** Daten, die in einer Fahrgemeinschaft geteilt werden (Rest bleibt pro Gerät). */
export const SHARED_KEYS = ['schema', 'persons', 'defaultDriver', 'drivers', 'destination', 'roundTrip', 'manualKm', 'order', 'optimizedOrder', 'returnOrder',
  'route', 'routeCache', 'car', 'price', 'split', 'days', 'weeks', 'payments', 'setupDone', 'setupCar', 'optimizedFor'];

export function sharedData(s = state) {
  const o = {};
  for (const k of SHARED_KEYS) if (s[k] !== undefined) o[k] = s[k];
  return o;
}

let changeHook = null;
/** Wird bei jeder Änderung mit der Änderungsfunktion aufgerufen (für die Synchronisation). */
export function onChange(fn) { changeHook = fn; }

const notify = () => { rev++; listeners.forEach((l) => l(state)); };

/** Zustand ändern. render=false, wenn gerade getippt wird und nichts neu gezeichnet werden soll. */
export function update(fn, { render = true } = {}) {
  fn(state);
  rev++;
  save();
  changeHook?.(fn);
  if (render) notify();
}

export function replaceState(next) {
  const d = defaultState();
  let n = next;
  if (!(n.schema >= 2)) n = migrateV1(n, todayIso());
  state = { ...d, ...n, ui: { ...d.ui, ...(n.ui || {}), welcomeDone: true } };
  save();
  const shared = structuredClone(sharedData(state));
  changeHook?.((s) => { Object.assign(s, structuredClone(shared)); });
  notify();
}

/** Serverstand der gemeinsamen Daten übernehmen, danach offene eigene Änderungen erneut anwenden. */
export function applyRemote(data, replay = []) {
  const d = defaultState();
  let src = data;
  if (src && Object.keys(src).length && !(src.schema >= 2)) src = migrateV1(src, todayIso());
  const next = { ...state };
  for (const k of SHARED_KEYS) next[k] = src[k] !== undefined ? structuredClone(src[k]) : d[k];
  state = next;
  for (const fn of replay) {
    try { fn(state); } catch { /* Änderung passt nicht mehr zum neuen Stand – überspringen */ }
  }
  save();
  notify();
}

/** Profile der Mitfahrer setzen (nur auf diesem Gerät). */
export function setProfiles(profiles) {
  state.profiles = profiles;
  save();
  notify();
}

export function subscribe(fn) { listeners.add(fn); }

// ---------- Abgeleitete Werte ----------

let cached = { rev: -1, model: null };
/** Das zusammengeführte Modell (Personen, wer fährt wann …). */
export function model() {
  if (cached.rev !== rev || cached.state !== state) cached = { rev, state, model: buildModel(state, state.profiles || []) };
  return cached.model;
}

export const persons = () => model().persons;
export const activePersons = () => model().persons.filter(isActive);
export const personById = (id) => model().byId.get(id);

export function effectivePrice(s = state) {
  if (s.price.mode !== 'manual' && s.price.current > 0) return s.price.current;
  return Number(s.price.manual) || 0;
}

/** Aktuelle Wochenwerte (für laufende und künftige Wochen). */
export const liveSnap = () => liveWeekSnap(state, model().persons, effectivePrice());

/** Alle berechneten Teilstrecken (gemeinsam + auf diesem Gerät). */
export const allRoutes = () => ({ ...(state.routeCache || {}), ...(state.localRoutes || {}) });

/** Eingefrorene Werte je Woche. */
export const frozenWeeks = () => Object.fromEntries(Object.entries(state.weeks || {}).filter(([, w]) => w?.snap?.v === 2).map(([m, w]) => [m, w.snap]));
