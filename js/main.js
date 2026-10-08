// Start der App: drei Bereiche (Fahrten, Geld, Gruppe) + Strecke als Unterseite, Abläufe im Vollbild,
// Karte nur auf der Strecke. Bei jeder Änderung wird der sichtbare Bildschirm neu gezeichnet.
import { state, update, subscribe, personById } from './state.js';
import { reverseGeocode } from './api.js';
import { MapView } from './map.js';
import { initAccount, inGroup, isAdmin, claims, newClaims, groupName, syncState } from './account.js';
import { me, adminSet, setAddress } from './actions.js';
import { myBalance, toConfirm } from './derived.js';
import { setupVersion } from './version.js';
import { startAutoRefresh } from './fuel.js';
import { setHooks, background, fullStops, displayRoute, routeDir, routeInfo, getTraffic, getSuggestions, loadTraffic, mapIncidents } from './engine.js';
import { statusText, cleanTitle } from './traffic.js';
import { h, icon, toast, initSheets, renderSheet, sheetIsOpen } from './kit.js';
import { renderRides } from './screens/rides.js';
import { renderMoney } from './screens/money.js';
import { renderGroup } from './screens/group.js';
import { renderRoute, setRouteHooks } from './screens/route.js';
import { currentFlow, renderFlow } from './screens/start.js';

const $ = (id) => document.getElementById(id);
const TABS = [
  { id: 'rides', label: 'Fahrten', icon: 'calendar-days' },
  { id: 'money', label: 'Geld', icon: 'wallet' },
  { id: 'group', label: 'Gruppe', icon: 'users' },
];

// ---------- Karte (nur auf „Strecke“) ----------

let map = null;
let mapKeys = {};
const ROUTE_COLORS = { hin: '#0a7cff', rueck: '#f06a00' };

function ensureMap() {
  if (map || !window.L) return map;
  map = new MapView($('map'), {
    menuItems: () => [],
    onAddPoint() {},
    onStopRemove() {},
    async onStopMoved(id, latlng) {
      const addr = { label: await reverseGeocode(latlng.lat, latlng.lng), lat: latlng.lat, lng: latlng.lng };
      try {
        if (id === 'dest') adminSet((s) => { s.destination = addr; }, `Ziel: ${addr.label}`);
        else if (id.startsWith('p:')) setAddress(id.slice(2), addr);
      } catch (e) { toast(e.message, 'error'); }
    },
  });
  mapKeys = {};
  return map;
}

function incidentPopup(it) {
  return h('div', { class: 'map-pop' }, h('strong', {}, cleanTitle(it)), h('div', {}, `${it.road} · ${statusText(it)}`));
}

function syncMap() {
  if (!ensureMap()) return;
  const dir = routeDir();
  const stops = fullStops(dir);
  const route = displayRoute(dir);
  const sk = JSON.stringify([dir, stops.map((s) => [s.id, s.lat, s.lng, s.label])]);
  if (sk !== mapKeys.stops) { map.setStops(stops); mapKeys.stops = sk; }
  const rk = [dir, route?.key, route?.distance].join('|');
  if (rk !== mapKeys.route) {
    map.setRoute(route?.coords ? route : null, { color: ROUTE_COLORS[dir] });
    if (route || stops.length) setTimeout(() => map.fit(stops, route), 60);
    mapKeys.route = rk;
  }
  const t = getTraffic();
  const inc = mapIncidents(dir);
  const ik = [dir, t.key, t.at, inc.map((it) => it.id).join()].join('|');
  if (ik !== mapKeys.traffic) { map.setIncidents(inc, { popup: incidentPopup }); mapKeys.traffic = ik; }
  const sg = getSuggestions();
  const s = sg && sg.dir === dir ? sg : null;
  const gk = s ? [dir, s.loading, s.list.length].join('|') : '';
  if (gk !== mapKeys.sugg) {
    map.setSuggestions(s?.loading ? [] : s?.list || [], s?.closure || null);
    if (s && !s.loading && s.list.length) setTimeout(() => map.fitLines(s.list.map((x) => x.coords)), 80);
    mapKeys.sugg = gk;
  }
  map.setDirControl({ show: false, dir, onChange: () => {} });
}

setRouteHooks({
  focusIncident: (it) => { if (map) { window.scrollTo({ top: 0, behavior: 'smooth' }); map.focusIncident(it); } },
  fitLines: (lines) => map?.fitLines(lines),
  fitRoute: () => { if (map) { const dir = routeDir(); map.fit(fullStops(dir), displayRoute(dir)); } },
});

// ---------- Navigation ----------

function go(screen) {
  update((s) => { s.ui.screen = screen; });
  window.scrollTo({ top: 0 });
}

function badges() {
  const mine = me();
  const accounts = claims();
  const money = (mine ? myBalance(mine).owe.length : 0) + toConfirm(mine, { admin: isAdmin(), hasAccount: (pid) => !inGroup() || accounts.has(pid) }).length;
  return { money, group: newClaims().length };
}

function renderNav(screen) {
  const active = screen === 'route' ? 'group' : screen;
  const b = badges();
  const item = (t, cls) => h('button', {
    type: 'button', class: `${cls} ${t.id === active ? 'on' : ''}`, 'aria-current': t.id === active ? 'page' : null, onclick: () => go(t.id),
  }, icon(t.icon, { size: cls === 'tab' ? 24 : 20 }), h('span', {}, t.label), b[t.id] ? h('span', { class: 'badge' }, String(b[t.id])) : null);
  $('tabs').replaceChildren(...TABS.map((t) => item(t, 'tab')));
  const mine = personById(me());
  $('rail').replaceChildren(
    h('div', { class: 'rail-brand' }, h('span', { class: 'app-mark' }, '⛽'), h('strong', {}, 'Tankrechner')),
    ...TABS.map((t) => item(t, 'rail-item')),
    h('div', { class: 'rail-foot' },
      inGroup() ? h('span', { class: `sync ${syncState()}`, title: { synced: 'Gespeichert', saving: 'Wird gespeichert …', offline: 'Offline' }[syncState()] }) : null,
      h('span', {}, mine?.name || '', h('small', {}, groupName() || 'Nur auf diesem Gerät'))));
}

// ---------- Zeichnen ----------

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

function render() {
  const flow = currentFlow();
  const screen = ['rides', 'money', 'group', 'route'].includes(state.ui.screen) ? state.ui.screen : 'rides';
  document.body.dataset.mode = flow ? 'flow' : 'app';
  document.body.dataset.screen = flow ? 'flow' : screen;
  const el = $('screen');
  const focusKey = document.activeElement?.dataset?.focusKey;
  el.replaceChildren();
  const out = { append: (...xs) => el.append(...xs.flat(Infinity).filter(Boolean)) };
  if (flow) renderFlow(out, flow);
  else {
    renderNav(screen);
    ({ rides: renderRides, money: renderMoney, group: renderGroup, route: renderRoute })[screen](out);
  }
  if (focusKey) {
    const f = el.querySelector(`[data-focus-key="${focusKey}"]`);
    f?.focus();
    try { if (f?.type === 'text') f.setSelectionRange(f.value.length, f.value.length); } catch { /* egal */ }
  }
  if (sheetIsOpen()) renderSheet();
  if (!flow && screen === 'route') { syncMap(); map?.invalidate(); }
  if (!flow) {
    background();
    // Admins: Sperrungen im Blick behalten (für den Hinweis auf „Fahrten“)
    if (isAdmin() && state.destination?.lat) { routeInfo('hin'); if (state.roundTrip !== false) routeInfo('rueck'); loadTraffic(); }
  }
}

function init() {
  setupVersion();
  setHooks({
    render: requestRender,
    routeReady: () => { if (state.ui.screen === 'route' && map) { const dir = routeDir(); map.fit(fullStops(dir), displayRoute(dir)); } },
  });
  initSheets();
  subscribe(requestRender);
  document.addEventListener('account-changed', requestRender);
  document.addEventListener('sync-status', () => {
    const dot = document.querySelector('#rail .sync');
    if (dot) dot.className = `sync ${syncState()}`;
  });
  document.addEventListener('pointerdown', () => { pointerDown = true; }, true);
  document.addEventListener('pointerup', releasePointer, true);
  document.addEventListener('pointercancel', releasePointer, true);
  window.addEventListener('resize', () => map?.invalidate());
  initAccount();
  requestRender();
  startAutoRefresh();
}

init();

