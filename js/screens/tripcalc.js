// Fenster „Einzelfahrt“ (aus „Fahrten“): Was kostet eine Fahrt außer der Reihe – Ausflug, Ikea, Flughafen?
// Nur zum Ausrechnen – an der Abrechnung ändert sich nichts. Eingaben bleiben auf diesem Gerät.
import { state, update, personById, effectivePrice } from '../state.js';
import { FUELS, singleTripCost } from '../calc.js';
import { fetchRoute } from '../api.js';
import { me } from '../actions.js';
import { addressInput } from '../address.js';
import { h, icon, row, list, switchRow, field, stepper, btn, registerSheet, openSheet, sheet, shareText } from '../kit.js';
import { shortLabel } from '../plan.js';
import { fmtEuro, fmtKm, fmtL, fmtDuration, fmtPrice } from '../ui.js';

// extra: Nebenkosten einrechnen (null = wie in der Gruppe) · extraPerKm: eigener Wert in ct/km (null = Wert des Autos)
// recent: zuletzt ausgerechnete Ziele (zum schnellen Wiederholen)
const blank = () => ({ start: null, dest: null, stops: [], roundTrip: false, people: 1, consumption: null, price: null, extra: null, extraPerKm: null, edit: false, recent: [] });
const get = () => ({ ...blank(), ...(state.ui.single || {}) });
const set = (fn) => update((s) => { s.ui.single = { ...blank(), ...(s.ui.single || {}) }; fn(s.ui.single); });

const myAddress = () => {
  const p = personById(me()) || personById(state.defaultDriver);
  return p?.address?.lat != null ? p.address : null;
};
const startPoint = (sg) => (sg.start?.lat != null ? sg.start : myAddress());
const points = (sg) => [startPoint(sg), ...sg.stops.filter((x) => x?.lat != null), sg.dest].filter((x) => x?.lat != null);
const keyOf = (pts) => pts.map((p) => `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`).join(';');
const place = (a) => shortLabel(a?.label) || 'Ziel';

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
    // Ziel merken (höchstens 4, neuestes zuerst)
    set((s) => {
      const d = { label: sg.dest.label, lat: sg.dest.lat, lng: sg.dest.lng };
      s.recent = [d, ...(s.recent || []).filter((x) => keyOf([x]) !== keyOf([d]))].slice(0, 4);
    });
  } catch (e) {
    if (result?.key === key) result = { key, error: e.message };
    update(() => {});
  }
}

/** Fenster öffnen (Knopf oben auf „Fahrten“). */
export const openTripCalc = () => openSheet('calc');

/** Strecke als Linie: Von → Zwischenstopps → Nach, mit Tauschen. */
function routeInputs(sg) {
  const start = startPoint(sg);
  const point = (kind, input, extra) => h('div', { class: `tp-row ${kind}` }, h('span', { class: 'tp-dot' }), input, extra || null);
  const removeStop = (k) => h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Zwischenstopp entfernen', onclick: () => set((s) => { s.stops.splice(k, 1); }) }, icon('x', { size: 16 }));
  return h('div', { class: 'tp' },
    point('from', addressInput({ value: start, placeholder: 'Von', allowLocate: true, focusKey: 'calc-start', onSelect: (a) => a && set((s) => { s.start = a; }) })),
    ...sg.stops.map((stop, k) => point('via', addressInput({ value: stop, placeholder: `Zwischenstopp ${k + 1}`, near: start, focusKey: `calc-stop-${k}`, onSelect: (a) => a && set((s) => { s.stops[k] = a; }) }), removeStop(k))),
    point('to', addressInput({ value: sg.dest, placeholder: 'Wohin? z. B. Ikea Erfurt', near: start, focusKey: 'calc-dest', onSelect: (a) => a && set((s) => { s.dest = a; }) })),
    h('div', { class: 'tp-actions' },
      sg.stops.length < 3 ? h('button', { type: 'button', class: 'link-btn', onclick: () => set((s) => { s.stops.push(null); }) }, '+ Zwischenstopp') : h('span'),
      sg.dest ? h('button', { type: 'button', class: 'link-btn', onclick: () => set((s) => { const a = startPoint(s); s.start = s.dest; s.dest = a; s.stops.reverse(); }) }, icon('arrow-up-down', { size: 15 }), ' Tauschen') : null));
}

/** Zuletzt benutzte Ziele als Chips (nur solange noch kein Ziel gewählt ist). */
function recentChips(sg) {
  const from = startPoint(sg);
  const list2 = (sg.recent || []).filter((r) => r?.lat != null && !(from && keyOf([r]) === keyOf([from]))); // nicht dahin, wo man schon ist
  if (sg.dest || !list2.length) return null;
  return h('div', { class: 'chips' },
    h('span', { class: 'chips-label' }, 'Zuletzt'),
    ...list2.map((r) => h('button', { type: 'button', class: 'chip', onclick: () => set((s) => { s.dest = r; }) }, icon('map-pin', { size: 13 }), place(r))));
}

function resultCard(sg, r, start) {
  const fuel = FUELS[state.car.fuel]?.label || '';
  const via = sg.stops.filter((x) => x?.lat != null).length;
  const shareMsg = [
    `🚗 ${place(start)} → ${place(sg.dest)}${via ? ` (über ${via} Stopp${via > 1 ? 's' : ''})` : ''}${sg.roundTrip ? ' und zurück' : ''}`,
    `${fmtKm(r.km)} · ${fmtDuration(r.minutes * 60)} · ${fmtL(r.liters)} ${fuel}`,
    r.extra > 0 ? `Sprit ${fmtEuro(r.fuel)} + Nebenkosten ${fmtEuro(r.extra)} = *${fmtEuro(r.total)}*` : `Sprit: *${fmtEuro(r.total)}*`,
    r.people > 1 ? `Pro Person (${r.people}): *${fmtEuro(r.perPerson)}*` : null,
  ].filter(Boolean).join('\n');
  return h('div', { class: 'card trip-result' },
    h('div', { class: 'tr-route' }, h('span', {}, place(start)), icon(sg.roundTrip ? 'repeat' : 'arrow-right', { size: 15 }), h('span', {}, place(sg.dest))),
    h('div', { class: 'tr-total' }, fmtEuro(r.people > 1 ? r.perPerson : r.total)),
    h('div', { class: 'tr-sub' }, r.people > 1 ? `pro Person · ${fmtEuro(r.total)} für ${r.people} Personen` : sg.roundTrip ? 'hin und zurück' : 'einfache Fahrt'),
    h('div', { class: 'tr-facts' },
      h('span', {}, icon('route', { size: 14 }), fmtKm(r.km)),
      h('span', {}, icon('clock', { size: 14 }), fmtDuration(r.minutes * 60)),
      h('span', {}, icon('fuel', { size: 14 }), `${fmtL(r.liters)} ${fuel}`)),
    h('div', { class: 'tr-split' },
      h('div', {}, h('small', {}, 'Sprit'), h('strong', {}, fmtEuro(r.fuel))),
      h('div', {}, h('small', {}, 'Nebenkosten'), h('strong', {}, r.extra > 0 ? fmtEuro(r.extra) : '–')),
      h('div', {}, h('small', {}, 'Gesamt'), h('strong', {}, fmtEuro(r.total)))),
    btn('Teilen', { kind: 'tinted', full: true, ic: 'share', onClick: () => shareText({ title: 'Einzelfahrt', text: shareMsg }) }));
}

registerSheet('calc', () => {
  const sg = get();
  ensureRoute(sg);
  const start = startPoint(sg);
  const consumption = sg.consumption ?? (Number(state.car?.consumption) || 0);
  const price = sg.price ?? effectivePrice();
  const extraPerKm = sg.extraPerKm ?? (Number(state.car?.extraPerKm) || 0);
  const withExtra = extraPerKm > 0 && (sg.extra ?? state.split?.includeExtra !== false);
  const r = result && !result.loading && !result.error ? singleTripCost({
    km: result.distance / 1000, minutes: result.duration / 60, consumption, price,
    extraPerKm, includeExtra: withExtra, roundTrip: sg.roundTrip, people: sg.people,
  }) : null;
  const ct = String(extraPerKm).replace('.', ',');
  const num = (v, step, onChange) => h('input', { type: 'number', min: 0, step, inputmode: 'decimal', value: v, onchange: (e) => e.target.value !== '' && onChange(Number(e.target.value.replace(',', '.'))) });
  return sheet({
    title: 'Einzelfahrt',
    sub: 'Was kostet eine Fahrt außer der Reihe? Ändert nichts an der Abrechnung.',
    body: [
      routeInputs(sg),
      recentChips(sg),
      list(
        switchRow({ title: 'Hin und zurück', checked: sg.roundTrip, onChange: (v) => set((s) => { s.roundTrip = v; }) }),
        row({ title: 'Teilen durch', trail: stepper(sg.people, { min: 1, max: 9, onChange: (n) => set((s) => { s.people = n; }), format: (n) => `${n} ${n === 1 ? 'Person' : 'Personen'}` }) }),
        extraPerKm > 0 ? switchRow({ title: 'Nebenkosten einrechnen', sub: `Verschleiß wie Reifen und Wartung · ${ct} ct/km`, checked: withExtra, onChange: (v) => set((s) => { s.extra = v; }) }) : null,
        row({ title: 'Verbrauch & Preis', value: `${String(consumption).replace('.', ',')} l · ${fmtPrice(price)}${extraPerKm > 0 ? ` · ${ct} ct` : ''}`, chevron: false, cls: 'tr-edit-row',
          trail: icon(sg.edit ? 'chevron-down' : 'chevron-right', { size: 16 }), onClick: () => set((s) => { s.edit = !s.edit; }) }),
      ),
      sg.edit ? h('div', { class: 'stack' },
        h('div', { class: 'two' },
          field('Verbrauch (l/100 km)', num(consumption, 0.1, (v) => set((s) => { s.consumption = v; }))),
          field('Preis (€/l)', num(Math.round(price * 1000) / 1000, 0.001, (v) => set((s) => { s.price = v; })))),
        field('Nebenkosten (ct/km)', num(extraPerKm, 0.5, (v) => set((s) => { s.extraPerKm = v; if (v > 0 && s.extra == null) s.extra = true; })), 'Nur für diese Rechnung · 0 = keine Nebenkosten')) : null,
      !sg.dest ? null
        : !result || result.loading ? h('div', { class: 'card trip-result is-loading' }, h('div', { class: 'tr-sub' }, 'Route wird berechnet …'))
          : result.error ? h('div', { class: 'card trip-result is-error' }, h('div', { class: 'tr-sub' }, `Route nicht gefunden: ${result.error}`))
            : resultCard(sg, r, start),
      sg.dest ? btn('Neue Fahrt', { kind: 'plain', full: true, onClick: () => set((s) => { s.dest = null; s.stops = []; s.start = null; }) }) : null,
    ],
  });
});
