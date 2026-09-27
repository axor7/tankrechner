// Einstiegspunkt: App-Gerüst (Navigation je Rolle, Karte), Strecke des Admins, Hintergrund-Berechnungen.
import { state, update, subscribe, replaceState, defaultState, model, personById, activePersons, allRoutes, liveSnap, todayIso, SHARED_KEYS } from './state.js';
import { reverseGeocode, fetchRoute, optimizeOrder } from './api.js';
import { MapView } from './map.js';
import { FUELS, plannedStops, routeKey, mondayOf, addDays, hasOwners } from './calc.js';
import { effectiveOrder, isActive } from './model.js';
import { h, stat, fmtKm, fmtDuration, debounce, toast } from './ui.js';
import { icon } from './icons.js';
import { priceCard, timeCard, costCard, stationSelected, startAutoRefresh } from './tab-fuel.js';
import { renderHome } from './view-home.js';
import { renderTrips, renderSheet } from './view-trips.js';
import { renderCosts } from './view-costs.js';
import { renderSettings } from './view-settings.js';
import { loadExample } from './example.js';
import { setupVersion } from './version.js';
import { initAccount, inGroup, isAdmin, openAccount } from './account.js';
import { me, adminSet, setAddress, freezePastWeeks } from './actions.js';
import { weeks as deriveRange, myBalance } from './derived.js';
import { addressInput } from './address.js';

const ALL_VIEWS = [
  { id: 'home', label: 'Übersicht', icon: 'house', color: 'blue' },
  { id: 'trips', label: 'Fahrten', icon: 'calendar-days', color: 'green' },
  { id: 'costs', label: 'Kosten', icon: 'wallet', color: 'orange' },
  { id: 'route', label: 'Strecke', icon: 'route', color: 'indigo', admin: true },
  { id: 'settings', label: 'Einstellungen', icon: 'settings', color: 'gray' },
];
const views = () => ALL_VIEWS.filter((v) => !v.admin || isAdmin());

const $ = (sel) => document.querySelector(sel);
let map;
const safe = async (fn) => { try { await fn(); } catch (e) { toast(e.message, 'error'); } };

// ---------- Ganze Route (alle Abholpunkte) & beste Reihenfolge ----------

/** Stopps der ganzen Route: Fahrer → Abholpunkte (Reihenfolge) → Ziel. */
function fullStops() {
  const persons = model().persons;
  const driver = personById(state.defaultDriver);
  if (!driver?.address?.lat || !state.destination?.lat) return [];
  const byId = new Map(persons.map((p) => [p.id, p]));
  const order = effectiveOrder(state, persons.filter(isActive));
  const stops = [{ id: `p:${driver.id}`, label: `${driver.name} (Start)`, lat: driver.address.lat, lng: driver.address.lng, color: driver.color, pids: [driver.id] }];
  for (const pid of order) {
    const p = byId.get(pid);
    const same = stops.find((s) => Math.abs(s.lat - p.address.lat) < 1e-5 && Math.abs(s.lng - p.address.lng) < 1e-5);
    if (same) { same.pids.push(pid); same.label += `, ${p.name}`; continue; }
    stops.push({ id: `p:${pid}`, label: p.name, lat: p.address.lat, lng: p.address.lng, color: p.color, pids: [pid] });
  }
  stops.push({ id: 'dest', label: state.destination.label?.split(',')[0] || 'Ziel', lat: state.destination.lat, lng: state.destination.lng });
  return stops;
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
    const optKey = [driver.address, ...pickups.map((p) => p.address), state.destination].map((a) => `${a.lat.toFixed(5)},${a.lng.toFixed(5)}`).join(';') + pickups.map((p) => p.id).join();
    if (!state.order?.length && pickups.length > 1 && (force || state.optimizedFor !== optKey)) {
      const idx = await optimizeOrder([driver.address, ...pickups.map((p) => p.address), state.destination]);
      const order = idx.map((i) => pickups[i].id);
      adminSet((s) => { s.optimizedOrder = order; s.optimizedFor = optKey; }, `Beste Abholreihenfolge berechnet: ${order.map((id) => personById(id)?.name).join(' → ')}`);
    }
    const stops = fullStops();
    const key = coordsKey(stops);
    if (force || state.route?.key !== key) {
      const [r] = await fetchRoute(stops);
      update((s) => {
        s.route = { key, distance: r.distance, duration: r.duration, coords: r.coords, legs: r.legs, wpIdx: r.wpIdx };
        s.routeCache = { ...(s.routeCache || {}), [routeKey(stops)]: r.legs.map((l) => ({ km: Math.round(l.distance / 100) / 10, min: l.duration / 60 })) };
      });
      map.fit(stops, state.route);
    }
  } catch (e) {
    toast(`Route konnte nicht berechnet werden: ${e.message}`, 'error');
  } finally {
    routeBusy = false;
    document.body.classList.remove('loading-route');
  }
}, 400);

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
  menuItems: [['start', 'Start (Fahrer)'], ['end', 'Ziel']],
  async onAddPoint(kind, latlng) {
    const label = await reverseGeocode(latlng.lat, latlng.lng);
    const addr = { label, lat: latlng.lat, lng: latlng.lng };
    if (kind === 'end') setDestination(addr);
    else safe(() => setAddress(state.defaultDriver, addr));
  },
  async onStopMoved(id, latlng) {
    const label = await reverseGeocode(latlng.lat, latlng.lng);
    const addr = { label, lat: latlng.lat, lng: latlng.lng };
    if (id === 'dest') setDestination(addr);
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
  if (!isAdmin()) return;
  const stops = fullStops();
  const sk = JSON.stringify(stops.map((s) => [s.id, s.lat, s.lng, s.label]));
  if (sk !== mapKeys.stops) { map.setStops(stops); mapKeys.stops = sk; }
  const rk = [state.route?.key, state.route?.distance].join('|');
  if (rk !== mapKeys.route) {
    if (state.route && mapKeys.route !== undefined) map.fit(stops, state.route);
    map.setRoute(state.route?.coords ? state.route : null, [], 0, null);
    mapKeys.route = rk;
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
  if (state.ui.showMap) setTimeout(() => map.fit(fullStops(), state.route), 80);
}

// ---------- Strecke (Admin) ----------

function orderList(ids, onMove, fixedFirst = 0) {
  return h('ol', { class: 'return-order' }, ids.map((pid, k) => {
    const p = personById(pid);
    return h('li', {},
      h('span', { class: 'ret-num' }, `${k + 1}.`),
      h('span', { class: 'dot', style: { '--pc': p?.color } }),
      h('span', { class: 'ret-name' }, p?.name, h('small', { class: 'muted' }, ` · ${p?.address?.label?.split(',').slice(0, 2).join(',') || ''}`)),
      h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Früher', disabled: k <= fixedFirst, onclick: () => onMove(k, -1) }, icon('arrow-up', { size: 18 })),
      h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Später', disabled: k === ids.length - 1, onclick: () => onMove(k, 1) }, icon('arrow-down', { size: 18 })));
  }));
}

function routeView(el) {
  const persons = model().persons;
  const driver = personById(state.defaultDriver);
  const active = persons.filter(isActive);
  const pickups = effectiveOrder(state, active);
  const noAddr = active.filter((p) => p.id !== state.defaultDriver && !p.address?.lat);
  const manual = !!state.order?.length;
  const move = (k, dir) => {
    const o = [...pickups];
    [o[k], o[k + dir]] = [o[k + dir], o[k]];
    safe(() => adminSet((s) => { s.order = o; }, `Abholreihenfolge von Hand: ${o.map((id) => personById(id)?.name).join(' → ')}`));
    refreshRoute();
  };
  const back = state.returnOrder?.length ? [...state.returnOrder.filter((id) => pickups.includes(id)), ...[...pickups].reverse().filter((id) => !state.returnOrder.includes(id))] : [...pickups].reverse();
  const moveBack = (k, dir) => {
    const o = [...back];
    [o[k], o[k + dir]] = [o[k + dir], o[k]];
    safe(() => adminSet((s) => { s.returnOrder = o; }, `Rückfahrt-Reihenfolge: ${o.map((id) => personById(id)?.name).join(' → ')}`));
  };

  el.append(
    h('section', { class: 'card' },
      h('h2', {}, 'Ziel'),
      addressInput({ value: state.destination, placeholder: 'Ziel, z. B. Firma', near: driver?.address, onSelect: setDestination, focusKey: 'dest' })),
    h('section', { class: 'card' },
      h('h2', {}, 'Start'),
      h('p', { class: 'hint small' }, `Adresse von ${driver?.name || 'dem Fahrer'} – hier beginnt die Fahrt.`),
      addressInput({ value: driver?.address, placeholder: 'Startadresse', allowLocate: true, onSelect: (a) => safe(() => setAddress(state.defaultDriver, a)), focusKey: 'start' })),
    h('section', { class: 'card' },
      h('div', { class: 'row between' }, h('h2', {}, 'Abholreihenfolge'), manual ? h('span', { class: 'claim-badge' }, 'von Hand') : pickups.length > 1 ? h('span', { class: 'claim-badge me' }, 'optimiert') : null),
      pickups.length ? orderList(pickups, move) : h('p', { class: 'hint' }, 'Noch keine Abholadressen. Mitfahrer tragen ihre Adresse selbst ein (oder du unter Einstellungen → Mitfahrer).'),
      noAddr.length ? h('p', { class: 'hint small' }, `Ohne Adresse (steigen beim Start zu): ${noAddr.map((p) => p.name).join(', ')}`) : null,
      pickups.length > 1 ? h('div', { class: 'row gap wrap' },
        h('button', {
          type: 'button', class: 'btn btn-small',
          onclick: () => { safe(() => adminSet((s) => { s.order = null; }, manual ? 'Abholreihenfolge: wieder automatisch (beste Route)' : null)); refreshRoute(true); },
        }, icon('sparkles', { size: 15 }), manual ? 'Beste Reihenfolge wiederherstellen' : 'Neu berechnen')) : null,
      h('p', { class: 'hint small' }, 'Die App berechnet automatisch die kürzeste Route zum Einsammeln. Mit den Pfeilen kannst du sie von Hand ändern.'),
    ),
  );

  if (state.route?.distance) {
    el.append(h('section', { class: 'card' },
      h('div', { class: 'stats' },
        stat('Strecke (alle abholen)', fmtKm(state.route.distance / 1000)),
        stat('Fahrzeit', fmtDuration(state.route.duration)),
        state.roundTrip ? stat('Hin & zurück', fmtKm((state.route.distance / 1000) * 2)) : null),
      h('p', { class: 'hint small' }, 'Fährt jemand an einem Tag nicht mit, wird seine Adresse ausgelassen und die Strecke für diesen Tag neu berechnet.')));
  } else if (!driver?.address?.lat || !state.destination?.lat) {
    el.append(h('section', { class: 'card' },
      h('h2', {}, 'Ohne Karte'),
      h('p', { class: 'hint small' }, 'Solange Start oder Ziel fehlen, wird mit diesen Kilometern pro Fahrt gerechnet (alle zahlen die ganze Strecke).'),
      h('label', { class: 'field' }, 'Kilometer pro Fahrt',
        h('input', { type: 'number', min: 0, step: 0.1, inputmode: 'decimal', value: state.manualKm ?? '', onchange: (e) => safe(() => adminSet((s) => { s.manualKm = e.target.value === '' ? null : Number(e.target.value); }, `Kilometer pro Fahrt: ${e.target.value}`)) }))));
  }

  el.append(h('section', { class: 'card' },
    h('label', { class: 'switch-row' }, h('span', {}, h('strong', {}, 'Mit Rückfahrt')),
      h('input', { type: 'checkbox', class: 'switch', checked: state.roundTrip !== false, onchange: (e) => safe(() => adminSet((s) => { s.roundTrip = e.target.checked; }, `Rückfahrt ${e.target.checked ? 'an' : 'aus'}`)) })),
    state.roundTrip !== false && pickups.length > 1 ? [
      h('p', { class: 'hint small' }, 'Reihenfolge beim Absetzen auf dem Rückweg:'),
      orderList(back, moveBack),
      state.returnOrder?.length ? h('button', { type: 'button', class: 'btn btn-small', onclick: () => safe(() => adminSet((s) => { s.returnOrder = null; }, 'Rückfahrt: wie Hinweg umgekehrt')) }, icon('rotate-ccw', { size: 15 }), 'Wie Hinweg umgekehrt') : null,
    ] : null,
  ));
}

function renderRouteView(el) {
  const sub = state.ui.routeSub === 'fuel' ? 'fuel' : 'route';
  el.append(h('div', { class: 'segmented' },
    h('button', { type: 'button', class: sub === 'route' ? 'active' : '', onclick: () => update((s) => { s.ui.routeSub = 'route'; }) }, 'Route'),
    h('button', { type: 'button', class: sub === 'fuel' ? 'active' : '', onclick: () => update((s) => { s.ui.routeSub = 'fuel'; }) }, 'Spritpreis & Tankzeit')));
  if (sub === 'route') routeView(el);
  else el.append(...[priceCard(map), costCard(), timeCard()].filter(Boolean));
  if (!state.ui.showMap) el.append(h('button', { type: 'button', class: 'btn', onclick: toggleMap }, icon('map', { size: 18 }), 'Karte einblenden'));
}

// ---------- Navigation ----------

function go(view) {
  update((s) => { s.ui.tab = view; });
  window.scrollTo({ top: 0 });
  map.invalidate();
}

function renderNav() {
  const cur = state.ui.tab;
  const mine = me();
  const badge = mine ? myBalance(mine).owe.length : 0;
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
  mapBtn.hidden = !isAdmin();
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

const ctx = () => ({ map, go, toggleMap, data: dataActions, openAccount, setDestination, adminSet: (fn, text) => safe(() => adminSet(fn, text)) });

function render() {
  const vs = views();
  if (!vs.some((v) => v.id === state.ui.tab)) state.ui.tab = 'home';
  const view = state.ui.tab;
  document.body.dataset.view = view;
  document.body.classList.toggle('map-on', !!state.ui.showMap && isAdmin());
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
  if (view === 'route') renderRouteView(el);
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
  if (state.ui.showMap === undefined) state.ui.showMap = window.innerWidth >= 1024;
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
  map.fit(fullStops(), state.route);
  startAutoRefresh();
  window.addEventListener('resize', () => map.invalidate());
  window.addEventListener('scroll', () => document.body.classList.toggle('scrolled', window.scrollY > 8), { passive: true });
}

init();

export { SHARED_KEYS, activePersons };
