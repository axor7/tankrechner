// Einstiegspunkt: App-Gerüst (Navigation, Karte), Strecken-Ansicht und Routenberechnung.
import { state, update, subscribe, validStops, uid, currentLegs, replaceState, defaultState, returnStops, returnOrderIds, isCustomReturn, makeSnapshot, stopName } from './state.js';
import { searchPlaces, reverseGeocode, fetchRoute } from './api.js';
import { MapView } from './map.js';
import { FUELS, DIRECTIONS, hasOwners, plannedStops, routeKey } from './calc.js';
import { h, stat, chip, fmtKm, fmtDuration, debounce, toast } from './ui.js';
import { icon } from './icons.js';
import { priceCard, timeCard, costCard, stationSelected, startAutoRefresh } from './tab-fuel.js';
import { renderTripsTab } from './tab-trips.js';
import { renderBillTab, openBadgeCount } from './tab-bill.js';
import { renderHome } from './view-home.js';
import { renderSettings } from './view-settings.js';
import { loadExample } from './example.js';
import { setupVersion } from './version.js';
import { initAccount, inGroup, openAccount } from './account.js';
import { isActive } from './plan.js';

const VIEWS = [
  { id: 'home', label: 'Übersicht', icon: 'house', color: 'blue' },
  { id: 'trips', label: 'Fahrten', icon: 'calendar-days', color: 'green' },
  { id: 'bill', label: 'Abrechnung', icon: 'wallet', color: 'orange' },
  { id: 'route', label: 'Strecke', icon: 'route', color: 'indigo' },
  { id: 'settings', label: 'Einstellungen', icon: 'settings', color: 'gray' },
];

const $ = (sel) => document.querySelector(sel);
let map;

// ---------- Route berechnen ----------

let routeSeq = 0;
const recalcRoute = debounce(async () => {
  const stops = validStops();
  if (stops.length < 2) {
    update((s) => { s.route = null; s.returnRoute = null; s.alternatives = []; });
    return;
  }
  const seq = ++routeSeq;
  document.body.classList.add('loading-route');
  try {
    const routes = await fetchRoute(stops);
    const back = state.roundTrip && isCustomReturn() ? (await fetchRoute(returnStops()))[0] : null;
    if (seq !== routeSeq) return;
    update((s) => {
      s.route = routes[0];
      s.returnRoute = back;
      s.alternatives = routes.length > 1 ? routes : [];
      s.selectedAlt = 0;
      if (s.exampleFresh) {
        // Beispiel: Wochen mit den echten Kilometern der berechneten Route versehen
        for (const w of Object.values(s.weeks)) w.snap = { ...makeSnapshot(s), price: w.snap.price };
        delete s.exampleFresh;
      }
    });
    map.fit(stops, routes[0]);
  } catch (e) {
    if (seq === routeSeq) toast(`Route konnte nicht berechnet werden: ${e.message}`, 'error');
  } finally {
    if (seq === routeSeq) document.body.classList.remove('loading-route');
  }
}, 250);

let returnSeq = 0;
const recalcReturn = debounce(async () => {
  const seq = ++returnSeq;
  if (!state.roundTrip || !isCustomReturn() || validStops().length < 2) { update((s) => { s.returnRoute = null; }); return; }
  try {
    const [r] = await fetchRoute(returnStops());
    if (seq === returnSeq) update((s) => { s.returnRoute = r; });
  } catch (e) { toast(`Rückweg konnte nicht berechnet werden: ${e.message}`, 'error'); }
}, 250);

// ---------- Routen für einzelne Fahrten (ausgelassene Adressen) nachladen ----------

const routeInflight = new Set();
const routeFailed = new Set();

/** Alle Stoppfolgen, die in eingetragenen Fahrten vorkommen, aber noch keine echte Route haben. */
function missingRoutes(s) {
  const missing = new Map();
  for (const w of Object.values(s.weeks)) {
    if (!hasOwners(w.snap)) continue;
    for (const d of Object.values(w.days)) {
      for (const dir of DIRECTIONS) {
        if (!d[dir]) continue;
        const stops = plannedStops(d[dir], w.snap, dir);
        if (stops.length < 2) continue;
        const key = routeKey(stops);
        if (!w.snap.routes?.[key]) missing.set(key, { stops, snap: w.snap });
      }
    }
  }
  return missing;
}

function fillFromCache(s) {
  for (const [key, { snap }] of missingRoutes(s)) {
    if (s.routeCache[key]) { snap.routes ||= {}; snap.routes[key] = s.routeCache[key]; }
  }
}

const ensureRoutes = debounce(async () => {
  let missing = missingRoutes(state);
  if ([...missing.keys()].some((k) => state.routeCache?.[k])) {
    update((s) => { s.routeCache ||= {}; fillFromCache(s); });
    missing = missingRoutes(state);
  }
  for (const [key, { stops }] of missing) {
    if (routeInflight.has(key) || routeFailed.has(key)) continue;
    routeInflight.add(key);
    try {
      const [r] = await fetchRoute(stops);
      const legs = r.legs.map((l) => ({ km: Math.round(l.distance / 100) / 10, min: l.duration / 60 }));
      update((s) => { s.routeCache ||= {}; s.routeCache[key] = legs; fillFromCache(s); });
    } catch { routeFailed.add(key); } finally { routeInflight.delete(key); }
  }
}, 400);

function stopsChanged() {
  update(() => {});
  recalcRoute();
}

async function setStopFromMap(stopId, latlng) {
  update((s) => {
    const st = s.stops.find((x) => x.id === stopId);
    if (st) { st.lat = latlng.lat; st.lng = latlng.lng; st.label = 'Adresse wird gesucht …'; }
  });
  recalcRoute();
  const label = await reverseGeocode(latlng.lat, latlng.lng);
  update((s) => { const st = s.stops.find((x) => x.id === stopId); if (st) st.label = label; });
}

const mapHandlers = {
  onAddPoint(kind, latlng) {
    let id;
    update((s) => {
      if (kind === 'start') id = s.stops[0].id;
      else if (kind === 'end') id = s.stops[s.stops.length - 1].id;
      else {
        // Leeren Zwischenstopp wiederverwenden, sonst vor dem Ziel einfügen
        const empty = s.stops.slice(1, -1).find((x) => x.lat == null);
        if (empty) id = empty.id;
        else { id = uid(); s.stops.splice(s.stops.length - 1, 0, { id, label: '', lat: null, lng: null }); }
      }
    }, { render: false });
    setStopFromMap(id, latlng);
  },
  onStopMoved(id, latlng) { setStopFromMap(id, latlng); },
  onStopRemove(id) { removeStop(id); },
  onInsertVia(validIndex, latlng) {
    const id = uid();
    update((s) => {
      const target = validStops(s)[validIndex];
      const at = s.stops.findIndex((x) => x.id === target.id);
      s.stops.splice(at, 0, { id, label: '', lat: null, lng: null });
    }, { render: false });
    setStopFromMap(id, latlng);
  },
  onSelectAlternative(idx) {
    update((s) => { s.selectedAlt = idx; s.route = s.alternatives[idx]; });
  },
};

function removeStop(id) {
  update((s) => {
    if (s.stops.length > 2) s.stops = s.stops.filter((x) => x.id !== id);
    else { const st = s.stops.find((x) => x.id === id); Object.assign(st, { label: '', lat: null, lng: null }); }
  });
  recalcRoute();
}

// ---------- Strecken-Tab ----------

function stopRow(stop, i, n) {
  const kind = i === 0 ? 'start' : i === n - 1 ? 'end' : 'via';
  const letter = i === 0 ? 'A' : i === n - 1 ? 'B' : String(i);
  const placeholder = i === 0 ? 'Start, z. B. Zuhause' : i === n - 1 ? 'Ziel, z. B. Arbeit' : 'Zwischenstopp';
  const list = h('ul', { class: 'suggest', hidden: true });
  let ctrl;
  let results = [];
  let active = -1;

  const choose = (r) => {
    update((s) => { const st = s.stops.find((x) => x.id === stop.id); Object.assign(st, { label: r.label, lat: r.lat, lng: r.lng }); });
    recalcRoute();
  };

  const drawList = () => {
    list.replaceChildren(...results.map((r, k) => h('li', {
      class: k === active ? 'active' : '',
      onmousedown: (e) => { e.preventDefault(); choose(r); },
    }, r.label)));
    list.hidden = !results.length;
  };

  const search = debounce(async (q) => {
    if (q.trim().length < 3) { results = []; drawList(); return; }
    ctrl?.abort();
    ctrl = new AbortController();
    try {
      const near = validStops()[0];
      results = await searchPlaces(q, { near, signal: ctrl.signal });
      active = -1;
      drawList();
    } catch (e) { if (e.name !== 'AbortError') toast('Adresssuche nicht erreichbar', 'error'); }
  }, 300);

  const input = h('input', {
    type: 'text', value: stop.label, placeholder, autocomplete: 'off', 'aria-label': placeholder,
    oninput: (e) => {
      const v = e.target.value;
      update((s) => { const st = s.stops.find((x) => x.id === stop.id); st.label = v; }, { render: false });
      search(v);
    },
    onkeydown: (e) => {
      if (list.hidden) return;
      if (e.key === 'ArrowDown') { active = Math.min(results.length - 1, active + 1); drawList(); e.preventDefault(); }
      if (e.key === 'ArrowUp') { active = Math.max(0, active - 1); drawList(); e.preventDefault(); }
      if (e.key === 'Enter') { choose(results[Math.max(0, active)]); e.preventDefault(); }
      if (e.key === 'Escape') { results = []; drawList(); }
    },
    onblur: () => setTimeout(() => { list.hidden = true; }, 150),
  });

  const move = (dir) => {
    update((s) => {
      const j = i + dir;
      [s.stops[i], s.stops[j]] = [s.stops[j], s.stops[i]];
    });
    recalcRoute();
  };

  const geoBtn = i === 0 ? h('button', {
    class: 'icon-btn', title: 'Meinen Standort verwenden', type: 'button',
    onclick: () => {
      if (!navigator.geolocation) return toast('Standort nicht verfügbar', 'error');
      navigator.geolocation.getCurrentPosition(
        (p) => setStopFromMap(stop.id, { lat: p.coords.latitude, lng: p.coords.longitude }),
        () => toast('Standort konnte nicht ermittelt werden', 'error'),
      );
    },
  }, icon('locate-fixed', { size: 18 })) : null;

  const owners = stop.owners || [];
  const toggleOwner = (pid) => update((s) => {
    const st = s.stops.find((x) => x.id === stop.id);
    st.owners = (st.owners || []).includes(pid) ? st.owners.filter((x) => x !== pid) : [...(st.owners || []), pid];
  });
  const ownerCandidates = state.persons.filter((p) => isActive(p) || owners.includes(p.id));
  const ownerLine = state.persons.length > 1 ? h('div', { class: 'owner-line' },
    h('span', { class: 'owner-label', title: 'Wessen Adresse ist das? Diese Person steigt hier zu bzw. wird hier abgesetzt.' }, icon('user', { size: 15 })),
    ownerCandidates.map((p) => chip(p, { active: owners.includes(p.id), onClick: () => toggleOwner(p.id), title: `${p.name}: ${owners.includes(p.id) ? 'wohnt hier – antippen zum Entfernen' : 'hier zuordnen'}` })),
  ) : null;

  return h('div', { class: 'stop-block' }, h('div', { class: `stop-row ${stop.lat == null ? 'empty' : ''}` },
    h('span', { class: `pin-badge pin-${kind}` }, letter),
    h('div', { class: 'stop-input' }, input, list),
    geoBtn,
    h('button', { class: 'icon-btn', title: 'Nach oben', type: 'button', disabled: i === 0, onclick: () => move(-1) }, icon('arrow-up', { size: 18 })),
    h('button', { class: 'icon-btn', title: 'Nach unten', type: 'button', disabled: i === n - 1, onclick: () => move(1) }, icon('arrow-down', { size: 18 })),
    h('button', { class: 'icon-btn danger', title: 'Entfernen', type: 'button', onclick: () => removeStop(stop.id) }, icon('x', { size: 18 })),
  ), ownerLine);
}

function returnCard() {
  const valid = validStops();
  if (!state.roundTrip || valid.length < 3) return null;
  const n = valid.length;
  const order = returnOrderIds();
  const byId = new Map(valid.map((x, i) => [x.id, { stop: x, i }]));
  const move = (k, dir) => {
    update((s) => {
      const o = returnOrderIds(s);
      [o[k], o[k + dir]] = [o[k + dir], o[k]];
      s.returnOrder = o;
    });
    recalcReturn();
  };
  const back = state.returnRoute;
  const custom = isCustomReturn();
  return h('section', { class: 'card' },
    h('h2', {}, 'Rückfahrt'),
    h('p', { class: 'hint' }, 'In welcher Reihenfolge wird auf dem Rückweg abgesetzt? Das Ziel des Hinwegs bleibt der Startpunkt.'),
    h('ol', { class: 'return-order' }, order.map((id, k) => {
      const { stop, i } = byId.get(id);
      const kind = i === 0 ? 'start' : i === n - 1 ? 'end' : 'via';
      const letter = i === 0 ? 'A' : i === n - 1 ? 'B' : String(i);
      const who = (stop.owners || []).map((o) => state.persons.find((p) => p.id === o)?.name).filter(Boolean).join(', ');
      return h('li', {},
        h('span', { class: 'ret-num' }, `${k + 1}.`),
        h('span', { class: `pin-badge pin-${kind}` }, letter),
        h('span', { class: 'ret-name' }, stopName(stop, i, n), who ? h('small', { class: 'muted' }, ` · ${who}`) : null),
        h('button', { class: 'icon-btn', type: 'button', title: 'Früher anfahren', disabled: k <= 1, onclick: () => move(k, -1) }, icon('arrow-up', { size: 18 })),
        h('button', { class: 'icon-btn', type: 'button', title: 'Später anfahren', disabled: k === 0 || k === order.length - 1, onclick: () => move(k, 1) }, icon('arrow-down', { size: 18 })),
      );
    })),
    custom && back ? h('div', { class: 'muted small' }, `Rückweg: ${fmtKm(back.distance / 1000)} · ${fmtDuration(back.duration)} (auf der Karte orange gestrichelt)`) : null,
    custom ? h('button', { type: 'button', class: 'btn btn-small', onclick: () => { update((s) => { s.returnOrder = null; }); recalcReturn(); } }, icon('rotate-ccw', { size: 15 }), 'Wie Hinweg (umgekehrt)') : null,
  );
}

function routeView(el) {
  const n = state.stops.length;
  const legs = currentLegs();
  const stops = validStops();
  const route = state.route;

  el.append(
    h('section', { class: 'card' },
      h('h2', {}, 'Deine Strecke'),
      h('p', { class: 'hint' }, 'Start, Zwischenstopps und Ziel eingeben – oder direkt in die Karte tippen.'),
      h('div', { class: 'stops' }, state.stops.map((x, i) => stopRow(x, i, n))),
      h('div', { class: 'row gap wrap' },
        h('button', {
          class: 'btn btn-small', type: 'button',
          onclick: () => { update((s) => s.stops.splice(s.stops.length - 1, 0, { id: uid(), label: '', lat: null, lng: null })); },
        }, icon('plus', { size: 16 }), 'Zwischenstopp'),
        h('button', {
          class: 'btn btn-small', type: 'button', title: 'Start und Ziel tauschen', disabled: n < 2,
          onclick: () => { update((s) => s.stops.reverse()); recalcRoute(); },
        }, icon('arrow-up-down', { size: 16 }), 'Umdrehen'),
      ),
      h('label', { class: 'switch-row' },
        h('span', {}, 'Mit Rückfahrt'),
        h('input', { type: 'checkbox', class: 'switch', checked: state.roundTrip, onchange: (e) => { update((s) => { s.roundTrip = e.target.checked; }); recalcReturn(); } })),
      state.persons.length > 1 ? h('p', { class: 'hint small' }, 'Tippe unter einer Adresse auf die Personen, die dort wohnen bzw. zusteigen. Sie zahlen dann auf dem Hinweg erst ab ihrer Adresse und auf dem Rückweg nur bis dorthin. Wer an einem Tag nicht mitfährt, wird nicht angefahren.') : null,
    ),
  );

  if (route && legs.length) {
    const total = legs.reduce((a, l) => a + l.km, 0);
    el.append(h('section', { class: 'card' },
      h('div', { class: 'stats' },
        stat('Einfache Strecke', fmtKm(total)),
        stat('Fahrzeit', fmtDuration(route.duration)),
        state.roundTrip ? stat('Hin & zurück', fmtKm(total * 2)) : null,
      ),
      legs.length > 1 ? h('ol', { class: 'legs' }, legs.map((l, i) => h('li', {},
        h('span', {}, `${l.from} → ${l.to}`),
        h('span', { class: 'muted' }, `${fmtKm(l.km)} · ${fmtDuration(route.legs[i].duration)}`)))) : null,
      state.alternatives.length > 1 ? h('div', { class: 'alts' },
        h('h3', {}, 'Alternative Routen'),
        state.alternatives.map((a, i) => h('button', {
          type: 'button', class: `alt ${i === (state.selectedAlt || 0) ? 'selected' : ''}`,
          onclick: () => mapHandlers.onSelectAlternative(i),
        }, h('strong', {}, `Route ${i + 1}`), ` · ${fmtKm(a.distance / 1000)} · ${fmtDuration(a.duration)}`))) : null,
    ));
  } else if (stops.length < 2) {
    el.append(h('section', { class: 'card' },
      h('h2', {}, 'Ohne Karte'),
      h('label', { class: 'field' }, 'Einfache Strecke in km',
        h('input', {
          type: 'number', min: 0, step: 0.1, inputmode: 'decimal', value: state.manualKm ?? '',
          onchange: (e) => update((s) => { s.manualKm = e.target.value === '' ? null : Number(e.target.value); }),
        })),
    ));
  }

  const rc = returnCard();
  if (rc) el.append(rc);

  el.append(h('section', { class: 'card tips' },
    h('h2', {}, 'Tipps zur Karte'),
    h('ul', {},
      h('li', {}, h('strong', {}, 'In die Karte tippen'), ': Start, Zwischenstopp oder Ziel setzen'),
      h('li', {}, h('strong', {}, 'Marker ziehen'), ': Punkt verschieben'),
      h('li', {}, h('strong', {}, 'Auf die blaue Linie tippen'), ': Zwischenstopp einfügen und dorthin ziehen, wo die Route langgehen soll'),
      h('li', {}, h('strong', {}, 'Rechtsklick auf Marker'), ': Punkt entfernen'),
    ),
  ));
}

function renderRouteView(el) {
  const sub = state.ui.routeSub === 'fuel' ? 'fuel' : 'route';
  el.append(h('div', { class: 'segmented' },
    h('button', { type: 'button', class: sub === 'route' ? 'active' : '', onclick: () => update((s) => { s.ui.routeSub = 'route'; }) }, 'Route'),
    h('button', { type: 'button', class: sub === 'fuel' ? 'active' : '', onclick: () => update((s) => { s.ui.routeSub = 'fuel'; }) }, 'Spritpreis & Tankzeit'),
  ));
  if (sub === 'route') routeView(el);
  else el.append(...[priceCard(map), costCard(), timeCard()].filter(Boolean));
  if (!state.ui.showMap) {
    el.append(h('button', { type: 'button', class: 'btn', onclick: toggleMap }, icon('map', { size: 18 }), 'Karte einblenden'));
  }
}

// ---------- Karte ----------

let mapKeys = {};
function syncMap() {
  const stopsKey = JSON.stringify(state.stops.map((x) => [x.id, x.lat, x.lng, x.label]));
  if (stopsKey !== mapKeys.stops) { map.setStops(state.stops); mapKeys.stops = stopsKey; }
  const rKey = [state.route?.distance, state.route?.coords?.length, state.alternatives.length, state.selectedAlt, state.returnRoute?.distance, state.roundTrip].join('|');
  if (state.route?.distance !== mapKeys.routeDist) {
    // Neue Route (z. B. aus der Fahrgemeinschaft geladen) → Karte darauf ausrichten
    if (state.route && mapKeys.routeDist !== undefined) map.fit(state.stops, state.route);
    mapKeys.routeDist = state.route?.distance ?? null;
  }
  if (rKey !== mapKeys.route) {
    map.setRoute(state.route, state.alternatives, state.selectedAlt || 0, state.roundTrip && isCustomReturn() ? state.returnRoute : null);
    mapKeys.route = rKey;
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
  if (state.ui.showMap) setTimeout(() => map.fit(state.stops, state.route), 80);
}

// ---------- Navigation ----------

function go(view) {
  update((s) => { s.ui.tab = view; });
  window.scrollTo({ top: 0 });
  document.querySelector('.main').scrollTop = 0;
  map.invalidate();
}

function renderNav() {
  const cur = state.ui.tab;
  const badge = openBadgeCount();
  $('#nav-side').replaceChildren(...VIEWS.map((v) => h('button', {
    type: 'button', class: `nav-item ${v.id === cur ? 'active' : ''}`, 'aria-current': v.id === cur ? 'page' : null, onclick: () => go(v.id),
  }, h('span', { class: `sq sq-${v.color}` }, icon(v.icon, { size: 17 })), h('span', {}, v.label),
  v.id === 'bill' && badge ? h('span', { class: 'badge' }, String(badge)) : null)));
  $('#nav-tabs').replaceChildren(...VIEWS.map((v) => h('button', {
    type: 'button', class: `tab-item ${v.id === cur ? 'active' : ''}`, 'aria-current': v.id === cur ? 'page' : null, onclick: () => go(v.id),
  }, icon(v.icon, { size: 24 }), h('span', {}, v.label === 'Einstellungen' ? 'Mehr' : v.label),
  v.id === 'bill' && badge ? h('span', { class: 'badge' }, String(badge)) : null)));
  const mapBtn = $('#btn-map');
  mapBtn.replaceChildren(icon(state.ui.showMap ? 'panel-right-close' : 'map', { size: 19 }));
  mapBtn.classList.toggle('on', !!state.ui.showMap);
  mapBtn.title = state.ui.showMap ? 'Karte ausblenden' : 'Karte einblenden';
}

// ---------- Rendering ----------

// Neu zeichnen erst nach einem laufenden Klick: Ein Eingabefeld löst beim Verlassen "change" aus –
// würde die Ansicht sofort ersetzt, ginge der Klick auf den Button verloren.
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

const ctx = () => ({ map, go, toggleMap, recalcRoute, data: dataActions, openAccount });

function render() {
  if (!VIEWS.some((v) => v.id === state.ui.tab)) state.ui.tab = state.ui.tab === 'fuel' ? 'route' : 'home';
  const view = state.ui.tab;
  document.body.dataset.view = view;
  document.body.classList.toggle('map-on', !!state.ui.showMap);
  $('#view-title').textContent = VIEWS.find((v) => v.id === view).label;
  renderNav();

  const el = $('#view');
  const focusedId = document.activeElement?.dataset?.focusKey;
  el.replaceChildren();
  if (view === 'home') renderHome(el, ctx());
  if (view === 'trips') renderTripsTab(el, ctx());
  if (view === 'bill') renderBillTab(el, ctx());
  if (view === 'route') renderRouteView(el);
  if (view === 'settings') renderSettings(el, ctx());
  if (focusedId) el.querySelector(`[data-focus-key="${focusedId}"]`)?.focus();
  syncMap();
  ensureRoutes();
}

// ---------- Daten: Export / Import / Beispiel / Zurücksetzen ----------

const dataActions = {
  exportData() {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const a = h('a', { href: URL.createObjectURL(blob), download: `tankrechner-${new Date().toISOString().slice(0, 10)}.json` });
    a.click();
    URL.revokeObjectURL(a.href);
  },
  importData() { $('#file-import').click(); },
  example() {
    if (!confirm(inGroup() ? 'Beispieldaten laden? Das ersetzt die Daten der GANZEN Fahrgemeinschaft – für alle Mitglieder!' : 'Beispieldaten laden? Deine aktuellen Daten werden ersetzt (vorher ggf. exportieren).')) return;
    replaceState({ ...loadExample(), ui: { ...state.ui, tab: 'home' } });
    mapKeys = {};
    recalcRoute();
  },
  reset() {
    if (!confirm(inGroup() ? 'Wirklich alles löschen? Das löscht die Daten der GANZEN Fahrgemeinschaft – für alle Mitglieder!' : 'Wirklich alles löschen?')) return;
    replaceState({ ...defaultState(), ui: { ...state.ui, tab: 'home' } });
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
      requestRender();
      map.fit(state.stops, state.route);
      toast('Daten importiert', 'ok');
    } catch { toast('Datei konnte nicht gelesen werden', 'error'); }
    e.target.value = '';
  };
}

function init() {
  setupVersion(); // zuerst, damit die Version auch sichtbar ist, falls danach etwas schiefgeht
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
  map.fit(state.stops, state.route);
  if (!state.route && validStops().length >= 2) recalcRoute();
  startAutoRefresh();
  window.addEventListener('resize', () => map.invalidate());
  const onScroll = () => document.body.classList.toggle('scrolled', (document.querySelector('.main').scrollTop || window.scrollY) > 8);
  window.addEventListener('scroll', onScroll, { passive: true });
  document.querySelector('.main').addEventListener('scroll', onScroll, { passive: true });
}

init();
