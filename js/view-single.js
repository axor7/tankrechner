// Einzelfahrt: schnell ausrechnen, was eine Fahrt kostet und wie viel Sprit sie braucht.
// Die Eingaben bleiben nur auf diesem Gerät (state.ui.single) – an der Abrechnung ändert sich nichts.
import { state, update, personById, effectivePrice } from './state.js';
import { FUELS, singleTripCost } from './calc.js';
import { fetchRoute } from './api.js';
import { me } from './actions.js';
import { addressInput } from './address.js';
import { h, stat, fmtKm, fmtL, fmtEuro, fmtPrice, fmtDuration } from './ui.js';
import { icon } from './icons.js';

const MAX_STOPS = 3;
const blank = () => ({ start: null, dest: null, stops: [], roundTrip: false, people: 1, consumption: null, price: null, extra: null, includeExtra: null });
const single = () => ({ ...blank(), ...(state.ui.single || {}) });
const set = (fn) => update((s) => { s.ui.single = { ...blank(), ...(s.ui.single || {}) }; fn(s.ui.single); });

/** Start: selbst gewählt, sonst die eigene Adresse, sonst die des Fahrers. */
function startPoint(sg) {
  if (sg.start?.lat != null) return sg.start;
  const p = personById(me()) || personById(state.defaultDriver);
  return p?.address?.lat != null ? p.address : null;
}

const points = (sg) => [startPoint(sg), ...sg.stops.filter((x) => x?.lat != null), sg.dest].filter((x) => x?.lat != null);
const pointsKey = (pts) => pts.map((p) => `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`).join(';');

let result = null; // { key, loading, error, distance, duration, coords, refs }

async function ensureRoute(sg) {
  const pts = points(sg);
  if (!sg.dest?.lat || pts.length < 2) { result = null; return; }
  const key = pointsKey(pts);
  if (result?.key === key) return;
  result = { key, loading: true };
  try {
    const [r] = await fetchRoute(pts, { alternatives: false, steps: true });
    if (result?.key === key) result = { key, ...r };
  } catch (e) {
    if (result?.key === key) result = { key, error: e.message };
  }
  update(() => {});
}

/** Für die Karte: Stopps und Route der Einzelfahrt. */
export function singleMapData() {
  const sg = single();
  const pts = points(sg);
  const n = pts.length;
  const stops = pts.map((p, k) => ({
    id: `single:${k}`, lat: p.lat, lng: p.lng, draggable: false,
    label: k === 0 ? `Start: ${short(p.label)}` : k === n - 1 && sg.dest ? `Ziel: ${short(p.label)}` : `Zwischenstopp: ${short(p.label)}`,
  }));
  const route = result && !result.loading && !result.error && result.key === pointsKey(pts) ? result : null;
  return { stops: sg.dest ? stops : stops.slice(0, 1), route };
}

/** Punkt aus der Karte übernehmen (Kartenmenü in der Einzelfahrt). */
export function setSinglePoint(kind, addr) {
  set((sg) => { if (kind === 'start') sg.start = addr; else sg.dest = addr; });
}

const short = (label = '') => String(label).split(',')[0];

/** Die meistgefahrenen Straßen („über A 71, B 88“). */
function mainRoads(refs = {}) {
  return Object.entries(refs).filter(([k]) => /^[ABLKS]\s?\d/.test(k)).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k]) => k);
}

function stepper(value, onChange) {
  return h('div', { class: 'stepper' },
    h('button', { type: 'button', class: 'icon-btn tinted', 'aria-label': 'Weniger', disabled: value <= 1, onclick: () => onChange(value - 1) }, '−'),
    h('span', { class: 'stepper-value' }, `${value} ${value === 1 ? 'Person' : 'Personen'}`),
    h('button', { type: 'button', class: 'icon-btn tinted', 'aria-label': 'Mehr', disabled: value >= 9, onclick: () => onChange(value + 1) }, '+'));
}

function inputCard(sg) {
  const start = startPoint(sg);
  return h('section', { class: 'card' },
    h('h2', {}, 'Einzelfahrt berechnen'),
    h('p', { class: 'hint small', style: { marginTop: 0 } }, 'Was kostet eine Fahrt – und wie viel Sprit braucht ihr bis dahin? Ziel eingeben oder auf der Karte antippen.'),
    h('div', { class: 'field' }, 'Start',
      addressInput({ value: start, placeholder: 'Start', allowLocate: true, onSelect: (a) => a && set((s) => { s.start = a; }), focusKey: 'single-start' })),
    sg.stops.map((stop, k) => h('div', { class: 'field' },
      h('span', { class: 'row between' }, `Zwischenstopp ${k + 1}`,
        h('button', { type: 'button', class: 'link small', onclick: () => set((s) => { s.stops.splice(k, 1); }) }, 'Entfernen')),
      addressInput({ value: stop, placeholder: 'Zwischenstopp', near: start, onSelect: (a) => a && set((s) => { s.stops[k] = a; }), focusKey: `single-stop-${k}` }))),
    sg.stops.length < MAX_STOPS ? h('button', { type: 'button', class: 'link small', style: { alignSelf: 'flex-start' }, onclick: () => set((s) => { s.stops.push(null); }) }, '+ Zwischenstopp') : null,
    h('div', { class: 'field' }, 'Ziel',
      addressInput({ value: sg.dest, placeholder: 'Wohin? z. B. Ikea Erfurt', near: start, onSelect: (a) => a && set((s) => { s.dest = a; }), focusKey: 'single-dest' })),
    h('label', { class: 'switch-row' }, h('span', {}, 'Hin und zurück'),
      h('input', { type: 'checkbox', class: 'switch', checked: !!sg.roundTrip, onchange: (e) => set((s) => { s.roundTrip = e.target.checked; }) })),
    h('div', { class: 'row between single-people' }, h('span', {}, 'Kosten teilen durch'), stepper(sg.people || 1, (n) => set((s) => { s.people = n; }))),
  );
}

function resultCard(sg) {
  if (!sg.dest?.lat) return null;
  if (!result || result.loading) return h('section', { class: 'card' }, h('p', { class: 'hint' }, 'Route wird berechnet …'));
  if (result.error) return h('section', { class: 'card' }, h('p', { class: 'callout' }, `Route konnte nicht berechnet werden: ${result.error}`));
  const fuelKey = state.car?.fuel;
  const consumption = sg.consumption ?? (Number(state.car?.consumption) || 0);
  const price = sg.price ?? effectivePrice();
  const extraPerKm = sg.extra ?? (Number(state.car?.extraPerKm) || 0);
  const includeExtra = sg.includeExtra ?? state.split?.includeExtra !== false;
  const r = singleTripCost({ km: result.distance / 1000, minutes: result.duration / 60, consumption, price, extraPerKm, includeExtra, roundTrip: sg.roundTrip, people: sg.people });
  const roads = mainRoads(result.refs);
  const custom = sg.consumption != null || sg.price != null || sg.extra != null;
  const num = (v, step, onChange) => h('input', { type: 'number', min: 0, step, inputmode: 'decimal', value: v, onchange: (e) => e.target.value !== '' && onChange(Number(e.target.value.replace(',', '.'))) });
  return h('section', { class: 'card single-result' },
    h('div', { class: 'single-total' },
      h('span', { class: 'single-label' }, sg.roundTrip ? 'Kosten hin und zurück' : 'Kosten bis zum Ziel'),
      h('span', { class: 'single-amount' }, fmtEuro(r.total)),
      r.people > 1 ? h('span', { class: 'single-per' }, `${fmtEuro(r.perPerson)} pro Person (${r.people} Personen)`) : null),
    h('div', { class: 'stats' },
      stat('Strecke', fmtKm(r.km), roads.length ? `über ${roads.join(', ')}` : null),
      stat('Fahrzeit', fmtDuration(r.minutes * 60)),
      stat('Verbrauch', fmtL(r.liters), `${String(consumption).replace('.', ',')} l/100 km`),
      stat('Sprit', fmtEuro(r.fuel), `${fmtPrice(price)}/l`),
      includeExtra && extraPerKm ? stat('Nebenkosten', fmtEuro(r.extra), `${String(extraPerKm).replace('.', ',')} ct/km`) : null),
    h('p', { class: 'hint small' },
      `Gerechnet mit ${FUELS[fuelKey]?.label || 'Sprit'} zu ${fmtPrice(price)}/l${sg.price == null ? (state.price?.mode !== 'manual' && state.price?.current ? ' (aktueller Preis)' : ' (eingetragener Preis)') : ' (angepasst)'}`,
      ` · ${fmtEuro(r.perKm)} pro km`,
      sg.roundTrip ? ' · Rückweg wie Hinweg' : ''),
    h('details', { class: 'more' },
      h('summary', {}, custom ? 'Werte angepasst' : 'Werte anpassen'),
      h('div', { class: 'single-values' },
        h('label', { class: 'field' }, 'Verbrauch (l/100 km)', num(consumption, 0.1, (v) => set((s) => { s.consumption = v; }))),
        h('label', { class: 'field' }, 'Spritpreis (€/l)', num(Math.round(price * 1000) / 1000, 0.001, (v) => set((s) => { s.price = v; }))),
        h('label', { class: 'field' }, 'Nebenkosten (ct/km)', num(extraPerKm, 0.5, (v) => set((s) => { s.extra = v; })))),
      h('label', { class: 'switch-row' }, h('span', {}, 'Nebenkosten mitrechnen'),
        h('input', { type: 'checkbox', class: 'switch', checked: includeExtra, onchange: (e) => set((s) => { s.includeExtra = e.target.checked; }) })),
      custom ? h('button', { type: 'button', class: 'link small', onclick: () => set((s) => { s.consumption = null; s.price = null; s.extra = null; }) }, 'Auf die Werte des Autos zurücksetzen') : null),
    h('div', { class: 'row gap wrap', style: { marginTop: '.6rem' } },
      h('button', { type: 'button', class: 'btn btn-small', onclick: () => set((s) => { s.dest = null; s.stops = []; }) }, icon('rotate-ccw', { size: 15 }), 'Neue Einzelfahrt')),
  );
}

export function renderSingleTrip(el) {
  const sg = single();
  ensureRoute(sg);
  el.append(...[inputCard(sg), resultCard(sg)].filter(Boolean));
}
