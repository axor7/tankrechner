// Fenster „Fahrt ausrechnen“: Was kostet eine einzelne Fahrt, wie viel Sprit braucht sie?
// Nur zum Ausrechnen – an der Abrechnung ändert sich nichts. Eingaben bleiben auf diesem Gerät.
import { state, update, personById, effectivePrice } from '../state.js';
import { FUELS, singleTripCost } from '../calc.js';
import { fetchRoute } from '../api.js';
import { me } from '../actions.js';
import { addressInput } from '../address.js';
import { h, row, list, switchRow, field, stepper, btn, note, registerSheet, openSheet, sheet } from '../kit.js';
import { fmtEuro, fmtKm, fmtL, fmtDuration, fmtPrice } from '../ui.js';

const blank = () => ({ start: null, dest: null, stops: [], roundTrip: false, people: 1, consumption: null, price: null, edit: false });
const get = () => ({ ...blank(), ...(state.ui.single || {}) });
const set = (fn) => update((s) => { s.ui.single = { ...blank(), ...(s.ui.single || {}) }; fn(s.ui.single); });

function startPoint(sg) {
  if (sg.start?.lat != null) return sg.start;
  const p = personById(me()) || personById(state.defaultDriver);
  return p?.address?.lat != null ? p.address : null;
}
const points = (sg) => [startPoint(sg), ...sg.stops.filter((x) => x?.lat != null), sg.dest].filter((x) => x?.lat != null);
const keyOf = (pts) => pts.map((p) => `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`).join(';');

let result = null; // { key, loading, error, distance, duration }
async function ensureRoute(sg) {
  const pts = points(sg);
  if (!sg.dest?.lat || pts.length < 2) { result = null; return; }
  const key = keyOf(pts);
  if (result?.key === key) return;
  result = { key, loading: true };
  try {
    const [r] = await fetchRoute(pts, { alternatives: false });
    if (result?.key === key) result = { key, ...r };
  } catch (e) {
    if (result?.key === key) result = { key, error: e.message };
  }
  update(() => {});
}

/** Zeile, die das Fenster öffnet. */
export const calcSheetRow = () => row({ title: 'Fahrt ausrechnen', sub: 'Was kostet eine einzelne Fahrt?', onClick: () => openSheet('calc') });

registerSheet('calc', () => {
  const sg = get();
  ensureRoute(sg);
  const start = startPoint(sg);
  const consumption = sg.consumption ?? (Number(state.car?.consumption) || 0);
  const price = sg.price ?? effectivePrice();
  const r = result && !result.loading && !result.error ? singleTripCost({
    km: result.distance / 1000, minutes: result.duration / 60, consumption, price,
    extraPerKm: Number(state.car?.extraPerKm) || 0, includeExtra: state.split?.includeExtra !== false, roundTrip: sg.roundTrip, people: sg.people,
  }) : null;
  const num = (v, step, onChange) => h('input', { type: 'number', min: 0, step, inputmode: 'decimal', value: v, onchange: (e) => e.target.value !== '' && onChange(Number(e.target.value.replace(',', '.'))) });
  return sheet({
    title: 'Fahrt ausrechnen',
    body: [
      field('Von', addressInput({ value: start, placeholder: 'Start', allowLocate: true, focusKey: 'calc-start', onSelect: (a) => a && set((s) => { s.start = a; }) })),
      sg.stops.map((stop, k) => field(h('span', { class: 'row-inline' }, `Zwischenstopp ${k + 1}`, h('button', { type: 'button', class: 'link-btn', onclick: () => set((s) => { s.stops.splice(k, 1); }) }, 'entfernen')),
        addressInput({ value: stop, placeholder: 'Zwischenstopp', near: start, focusKey: `calc-stop-${k}`, onSelect: (a) => a && set((s) => { s.stops[k] = a; }) }))),
      field('Nach', addressInput({ value: sg.dest, placeholder: 'Ziel, z. B. Ikea Erfurt', near: start, focusKey: 'calc-dest', onSelect: (a) => a && set((s) => { s.dest = a; }) })),
      sg.stops.length < 3 ? h('button', { type: 'button', class: 'link-btn', onclick: () => set((s) => { s.stops.push(null); }) }, '+ Zwischenstopp') : null,
      list(
        switchRow({ title: 'Hin und zurück', checked: sg.roundTrip, onChange: (v) => set((s) => { s.roundTrip = v; }) }),
        row({ title: 'Kosten teilen durch', trail: stepper(sg.people, { min: 1, max: 9, onChange: (n) => set((s) => { s.people = n; }), format: (n) => `${n} ${n === 1 ? 'Person' : 'Personen'}` }) }),
      ),
      !sg.dest ? null
        : !result || result.loading ? note('Route wird berechnet …')
          : result.error ? note(`Route nicht gefunden: ${result.error}`)
            : h('div', { class: 'card result' },
              h('div', { class: 'hero-label' }, sg.roundTrip ? 'Hin und zurück' : 'Einfache Fahrt'),
              h('div', { class: 'hero-big' }, fmtEuro(r.total)),
              r.people > 1 ? h('div', { class: 'hero-sub' }, `${fmtEuro(r.perPerson)} pro Person`) : null,
              h('div', { class: 'facts' },
                h('span', {}, fmtKm(r.km)), h('span', {}, fmtDuration(r.minutes * 60)), h('span', {}, `${fmtL(r.liters)} ${FUELS[state.car.fuel]?.label || ''}`))),
      r ? h('button', { type: 'button', class: 'link-btn', onclick: () => set((s) => { s.edit = !s.edit; }) }, `${String(consumption).replace('.', ',')} l/100 km · ${fmtPrice(price)}/l – ${sg.edit ? 'fertig' : 'ändern'}`) : null,
      r && sg.edit ? h('div', { class: 'two' },
        field('Verbrauch (l/100 km)', num(consumption, 0.1, (v) => set((s) => { s.consumption = v; }))),
        field('Preis (€/l)', num(Math.round(price * 1000) / 1000, 0.001, (v) => set((s) => { s.price = v; })))) : null,
      sg.dest ? btn('Neue Fahrt', { kind: 'plain', full: true, onClick: () => set((s) => { s.dest = null; s.stops = []; s.start = null; }) }) : null,
    ],
  });
});
