// Einstiegspunkt: Layout, Tabs, Strecken-Tab und Karten-Anbindung.
import { state, update, subscribe, validStops, uid, effectivePrice, currentLegs, replaceState, defaultState, returnStops, returnOrderIds, isCustomReturn, makeSnapshot, stopName } from './state.js';
import { searchPlaces, reverseGeocode, fetchRoute } from './api.js';
import { MapView } from './map.js';
import { legCost, FUELS, DIRECTIONS, hasOwners, plannedStops, routeKey } from './calc.js';
import { h, stat, chip, fmtEuro, fmtKm, fmtDuration, fmtPrice, debounce, toast } from './ui.js';
import { renderFuelTab, stationSelected, startAutoRefresh } from './tab-fuel.js';
import { renderTripsTab } from './tab-trips.js';
import { renderBillTab } from './tab-bill.js';
import { loadExample } from './example.js';
import { setupVersion } from './version.js';

const TABS = [
  { id: 'route', icon: '🗺️', label: 'Strecke' },
  { id: 'fuel', icon: '⛽', label: 'Auto & Sprit' },
  { id: 'trips', icon: '👥', label: 'Fahrten' },
  { id: 'bill', icon: '🧾', label: 'Abrechnung' },
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
  }, '📍') : null;

  const owners = stop.owners || [];
  const toggleOwner = (pid) => update((s) => {
    const st = s.stops.find((x) => x.id === stop.id);
    st.owners = (st.owners || []).includes(pid) ? st.owners.filter((x) => x !== pid) : [...(st.owners || []), pid];
  });
  const ownerLine = state.persons.length > 1 ? h('div', { class: 'owner-line' },
    h('span', { class: 'owner-label', title: 'Wessen Adresse ist das? Diese Person steigt hier zu bzw. wird hier abgesetzt.' }, '👤'),
    state.persons.map((p) => chip(p, { active: owners.includes(p.id), onClick: () => toggleOwner(p.id), title: `${p.name}: ${owners.includes(p.id) ? 'wohnt hier – antippen zum Entfernen' : 'hier zuordnen'}` })),
  ) : null;

  return h('div', { class: 'stop-block' }, h('div', { class: `stop-row ${stop.lat == null ? 'empty' : ''}` },
    h('span', { class: `pin-badge pin-${kind}` }, letter),
    h('div', { class: 'stop-input' }, input, list),
    geoBtn,
    h('button', { class: 'icon-btn', title: 'Nach oben', type: 'button', disabled: i === 0, onclick: () => move(-1) }, '↑'),
    h('button', { class: 'icon-btn', title: 'Nach unten', type: 'button', disabled: i === n - 1, onclick: () => move(1) }, '↓'),
    h('button', { class: 'icon-btn danger', title: 'Entfernen', type: 'button', onclick: () => removeStop(stop.id) }, '✕'),
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
    h('h2', {}, 'Rückfahrt – Reihenfolge'),
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
        h('button', { class: 'icon-btn', type: 'button', title: 'Früher anfahren', disabled: k <= 1, onclick: () => move(k, -1) }, '↑'),
        h('button', { class: 'icon-btn', type: 'button', title: 'Später anfahren', disabled: k === 0 || k === order.length - 1, onclick: () => move(k, 1) }, '↓'),
      );
    })),
    custom && back ? h('div', { class: 'muted small' }, `Rückweg: ${fmtKm(back.distance / 1000)} · ${fmtDuration(back.duration)} (auf der Karte orange gestrichelt)`) : null,
    custom ? h('button', { type: 'button', class: 'btn btn-small btn-ghost', onclick: () => { update((s) => { s.returnOrder = null; }); recalcReturn(); } }, '↺ Wie Hinweg (umgekehrt)') : null,
  );
}

function renderRouteTab(el) {
  const n = state.stops.length;
  const legs = currentLegs();
  const stops = validStops();
  const route = state.route;

  el.append(
    h('section', { class: 'card' },
      h('h2', {}, 'Deine Strecke'),
      h('p', { class: 'hint' }, 'Gib Start, Zwischenstopps (z. B. wo jemand zusteigt) und Ziel ein – oder klicke direkt in die Karte.'),
      h('div', { class: 'stops' }, state.stops.map((s, i) => stopRow(s, i, n))),
      h('div', { class: 'row gap' },
        h('button', {
          class: 'btn', type: 'button',
          onclick: () => { update((s) => s.stops.splice(s.stops.length - 1, 0, { id: uid(), label: '', lat: null, lng: null })); },
        }, '＋ Zwischenstopp'),
        h('button', {
          class: 'btn btn-ghost', type: 'button', title: 'Start und Ziel tauschen',
          disabled: n < 2,
          onclick: () => { update((s) => s.stops.reverse()); recalcRoute(); },
        }, '⇅ Umdrehen'),
      ),
      h('label', { class: 'check' },
        h('input', { type: 'checkbox', checked: state.roundTrip, onchange: (e) => { update((s) => { s.roundTrip = e.target.checked; }); recalcReturn(); } }),
        ' Mit Rückfahrt'),
      state.persons.length > 1 ? h('p', { class: 'hint small' }, '👤 Tippe unter einer Adresse auf die Personen, die dort wohnen bzw. zusteigen. Sie zahlen dann auf dem Hinweg erst ab ihrer Adresse und auf dem Rückweg nur bis dorthin. Fährt jemand an einem Tag nicht mit, wird seine Adresse ausgelassen und die Strecke für diese Fahrt neu berechnet.') : null,
    ),
  );
  const rc = returnCard();
  if (rc) el.append(rc);

  if (route && legs.length) {
    const total = legs.reduce((a, l) => a + l.km, 0);
    el.append(h('section', { class: 'card' },
      h('div', { class: 'stats' },
        stat('Einfache Strecke', fmtKm(total)),
        stat('Fahrzeit', fmtDuration(route.duration)),
        stat(state.roundTrip ? 'Hin & zurück' : 'Teilstrecken', state.roundTrip ? fmtKm(total * 2) : String(legs.length)),
      ),
      legs.length > 1 ? h('ol', { class: 'legs' }, legs.map((l, i) => h('li', {},
        h('span', {}, `${l.from} → ${l.to}`),
        h('span', { class: 'muted' }, `${fmtKm(l.km)} · ${fmtDuration(route.legs[i].duration)}`)))) : null,
      state.alternatives.length > 1 ? h('div', { class: 'alts' },
        h('h3', {}, 'Alternative Routen'),
        state.alternatives.map((a, i) => h('button', {
          type: 'button',
          class: `alt ${i === (state.selectedAlt || 0) ? 'selected' : ''}`,
          onclick: () => mapHandlers.onSelectAlternative(i),
        }, h('strong', {}, `Route ${i + 1}`), ` ${fmtKm(a.distance / 1000)} · ${fmtDuration(a.duration)}`))) : null,
    ));
  } else if (stops.length < 2) {
    el.append(h('section', { class: 'card' },
      h('h3', {}, 'Ohne Karte?'),
      h('p', { class: 'hint' }, 'Du kannst die einfache Strecke auch direkt in Kilometern angeben.'),
      h('label', { class: 'field' }, 'Einfache Strecke (km)',
        h('input', {
          type: 'number', min: 0, step: 0.1, value: state.manualKm ?? '',
          onchange: (e) => update((s) => { s.manualKm = e.target.value === '' ? null : Number(e.target.value); }),
        })),
    ));
  }

  el.append(h('section', { class: 'card tips' },
    h('h3', {}, 'So bearbeitest du die Route'),
    h('ul', {},
      h('li', {}, h('strong', {}, 'Klick in die Karte'), ': Start, Zwischenstopp oder Ziel setzen'),
      h('li', {}, h('strong', {}, 'Marker ziehen'), ': Punkt verschieben'),
      h('li', {}, h('strong', {}, 'Klick auf die blaue Linie'), ': Zwischenstopp einfügen und dann dorthin ziehen, wo die Route langgehen soll'),
      h('li', {}, h('strong', {}, 'Rechtsklick auf Marker'), ': Punkt entfernen'),
      h('li', {}, h('strong', {}, 'Graue Linie'), ': alternative Route auswählen'),
    ),
  ));
}

// ---------- Kopfzeile ----------

function renderSummary() {
  const legs = currentLegs();
  const km = legs.reduce((a, l) => a + l.km, 0);
  const price = effectivePrice();
  const c = legCost(km, { consumption: state.car.consumption, price, extraPerKm: state.car.extraPerKm });
  $('#summary').replaceChildren(
    h('div', { class: 'pill' }, '🛣️ ', km ? fmtKm(km) : 'keine Strecke'),
    h('div', { class: 'pill' }, '⛽ ', `${FUELS[state.car.fuel]?.label || ''} ${fmtPrice(price)}`),
    h('div', { class: 'pill strong' }, '💶 ', km ? `${fmtEuro(state.split.includeExtra === false ? c.fuel : c.total)} pro Fahrt` : '–'),
  );
}

// ---------- Rendering ----------

let mapKeys = {};
function syncMap() {
  const stopsKey = JSON.stringify(state.stops.map((s) => [s.id, s.lat, s.lng, s.label]));
  if (stopsKey !== mapKeys.stops) { map.setStops(state.stops); mapKeys.stops = stopsKey; }
  const rKey = [state.route?.distance, state.route?.coords?.length, state.alternatives.length, state.selectedAlt, state.returnRoute?.distance, state.roundTrip].join('|');
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

// Neu zeichnen erst nach einem laufenden Klick: Ein Eingabefeld löst beim Verlassen "change" aus –
// würde das Panel sofort ersetzt, ginge der Klick auf den Button verloren.
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
  const tab = state.ui.tab;
  document.body.dataset.tab = tab;
  $('#tabs').replaceChildren(...TABS.map((t, i) => h('button', {
    type: 'button', class: `tab ${t.id === tab ? 'active' : ''}`, role: 'tab', 'aria-selected': String(t.id === tab),
    onclick: () => { update((s) => { s.ui.tab = t.id; }); $('#panel').scrollTop = 0; map.invalidate(); },
  }, h('span', { class: 'tab-num' }, String(i + 1)), h('span', { class: 'tab-icon' }, t.icon), h('span', { class: 'tab-label' }, t.label))));

  const panel = $('#panel-content');
  const scroll = $('#panel').scrollTop;
  const focusedId = document.activeElement?.dataset?.focusKey;
  panel.replaceChildren();
  if (tab === 'route') renderRouteTab(panel);
  if (tab === 'fuel') renderFuelTab(panel, { map });
  if (tab === 'trips') renderTripsTab(panel);
  if (tab === 'bill') renderBillTab(panel);
  $('#panel').scrollTop = scroll;
  if (focusedId) panel.querySelector(`[data-focus-key="${focusedId}"]`)?.focus();
  renderSummary();
  syncMap();
  ensureRoutes();
}

// ---------- Menü: Export / Import / Beispiel ----------

function setupMenu() {
  const menu = $('.menu');
  menu.querySelectorAll('.menu-list button').forEach((b) => b.addEventListener('click', () => { menu.open = false; }));
  document.addEventListener('click', (e) => { if (!menu.contains(e.target)) menu.open = false; });
  $('#btn-export').onclick = () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const a = h('a', { href: URL.createObjectURL(blob), download: `tankrechner-${new Date().toISOString().slice(0, 10)}.json` });
    a.click();
    URL.revokeObjectURL(a.href);
  };
  $('#btn-import').onclick = () => $('#file-import').click();
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
  $('#btn-example').onclick = async () => {
    if (!confirm('Beispieldaten laden? Deine aktuellen Daten werden ersetzt (vorher ggf. exportieren).')) return;
    replaceState(loadExample());
    mapKeys = {};
    recalcRoute();
  };
  $('#btn-reset').onclick = () => {
    if (!confirm('Wirklich alles löschen?')) return;
    replaceState(defaultState());
    mapKeys = {};
  };
}

function init() {
  setupVersion(); // zuerst, damit die Version auch sichtbar ist, falls danach etwas schiefgeht
  map = new MapView($('#map'), mapHandlers);
  subscribe(requestRender);
  document.addEventListener('pointerdown', () => { pointerDown = true; }, true);
  document.addEventListener('pointerup', releasePointer, true);
  document.addEventListener('pointercancel', releasePointer, true);
  setupMenu();
  requestRender();
  map.fit(state.stops, state.route);
  if (!state.route && validStops().length >= 2) recalcRoute();
  startAutoRefresh();
  window.addEventListener('resize', () => map.invalidate());
}

init();
