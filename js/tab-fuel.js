// Tab "Auto & Sprit": Verbrauch, Kraftstoff, Tankstellenpreise, beste Tankzeit.
import { state, update, validStops, effectivePrice, currentLegs, getWeek } from './state.js';
import { fetchStations, fetchPrices, samplePoints, distanceToRoute } from './api.js';
import { FUELS, legCost, calcTrip, DIRECTIONS } from './calc.js';
import { TYPICAL_CURVE, bestWindow, worstHour, profileFromObservations, blendProfile } from './fueltimes.js';
import { h, stat, fmtEuro, fmtL, fmtPrice, fmtKm, toast } from './ui.js';

const MAX_OBS = 5000;
const REFRESH_MS = 15 * 60 * 1000; // Tankerkönig: automatische Abfragen höchstens alle 5 Minuten
let loading = false;
let curveMode = 'typical';

const tkFuel = () => FUELS[state.car.fuel]?.tk || null;

function recordObservations(s, stations) {
  const now = Date.now();
  const last = new Map();
  for (const o of s.observations.slice(-500)) last.set(`${o.sid}|${o.fuel}`, o.t);
  for (const st of stations) {
    for (const fuel of ['e5', 'e10', 'diesel']) {
      if (!(st[fuel] > 0)) continue;
      const k = `${st.id}|${fuel}`;
      if (last.has(k) && now - last.get(k) < 10 * 60 * 1000) continue;
      s.observations.push({ t: now, sid: st.id, fuel, price: st[fuel] });
    }
  }
  if (s.observations.length > MAX_OBS) s.observations = s.observations.slice(-MAX_OBS);
}

function sortedStations(fuel) {
  return state.stations
    .filter((s) => s[fuel] > 0)
    .sort((a, b) => (b.isOpen - a.isOpen) || (a[fuel] - b[fuel]) || (a.detour - b.detour));
}

/** Günstigste (geöffnete) Tankstelle übernehmen bzw. Preis der gewählten aktualisieren. */
function applyPriceMode(s) {
  const fuel = FUELS[s.car.fuel]?.tk;
  if (!fuel || s.price.mode === 'manual') { s.price.current = null; return; }
  let st;
  if (s.price.mode === 'station') st = s.stations.find((x) => x.id === s.price.stationId);
  if (!st || s.price.mode === 'cheapest') st = sortedStations(fuel)[0];
  if (st && st[fuel] > 0) {
    s.price.current = st[fuel];
    s.price.stationId = st.id;
    s.price.stationName = `${st.brand || st.name}, ${st.address}`;
    s.price.updatedAt = Date.now();
  } else {
    s.price.current = null;
  }
}

export function stationSelected(id) {
  update((s) => { s.price.mode = 'station'; s.price.stationId = id; applyPriceMode(s); });
  toast('Tankstelle übernommen', 'ok');
}

export async function loadStations() {
  if (!state.apiKey) { toast('Bitte zuerst einen Tankerkönig-API-Key eintragen', 'error'); return; }
  const stops = validStops();
  if (!stops.length) { toast('Bitte zuerst eine Strecke eingeben', 'error'); return; }
  loading = true;
  update(() => {});
  try {
    const coords = state.route?.coords || stops.map((s) => [s.lat, s.lng]);
    const pts = samplePoints(coords, stops);
    const found = new Map();
    for (let i = 0; i < pts.length; i += 4) { // höchstens 4 Anfragen gleichzeitig
      const lists = await Promise.all(pts.slice(i, i + 4).map(([lat, lng]) => fetchStations(lat, lng, 4, state.apiKey)));
      for (const st of lists.flat()) found.set(st.id, st);
    }
    const stations = [...found.values()].map((st) => ({ ...st, detour: distanceToRoute(coords, [st.lat, st.lng]) }));
    update((s) => {
      s.stations = stations;
      recordObservations(s, stations);
      applyPriceMode(s);
    });
    toast(`${stations.length} Tankstellen an der Strecke gefunden`, 'ok');
  } catch (e) {
    toast(`Tankstellen konnten nicht geladen werden: ${e.message}`, 'error');
  } finally {
    loading = false;
    update(() => {});
  }
}

async function refreshPrices() {
  if (!state.apiKey || !state.stations.length || document.hidden) return;
  const fuel = tkFuel() || 'e10';
  const ids = [state.price.stationId, ...sortedStations(fuel).map((s) => s.id)].filter(Boolean);
  const unique = [...new Set(ids)].slice(0, 10);
  try {
    const prices = await fetchPrices(unique, state.apiKey);
    update((s) => {
      const changed = [];
      for (const st of s.stations) {
        const p = prices[st.id];
        if (!p) continue;
        st.isOpen = p.status === 'open';
        for (const f of ['e5', 'e10', 'diesel']) st[f] = typeof p[f] === 'number' ? p[f] : st[f];
        changed.push(st);
      }
      recordObservations(s, changed);
      applyPriceMode(s);
    });
  } catch { /* still */ }
}

export function startAutoRefresh() {
  setInterval(refreshPrices, REFRESH_MS);
}

// ---------- Darstellung ----------

function carCard() {
  return h('section', { class: 'card' },
    h('h2', {}, 'Dein Auto'),
    h('div', { class: 'grid2' },
      h('label', { class: 'field' }, 'Verbrauch (l/100 km)',
        h('input', {
          type: 'number', min: 0, step: 0.1, value: state.car.consumption,
          onchange: (e) => update((s) => { s.car.consumption = Number(e.target.value); }),
        })),
      h('label', { class: 'field' }, 'Kraftstoff',
        h('select', { onchange: (e) => update((s) => { s.car.fuel = e.target.value; applyPriceMode(s); }) },
          Object.entries(FUELS).map(([k, f]) => h('option', { value: k, selected: k === state.car.fuel }, f.label)))),
    ),
    h('details', { class: 'more' },
      h('summary', {}, 'Weitere Kosten pro km (optional)'),
      h('p', { class: 'hint' }, 'Wenn ihr Verschleiß, Reifen oder Maut mit einrechnen wollt, gib hier Cent pro km an (z. B. 5 ct/km). Wird genauso fair aufgeteilt wie der Sprit.'),
      h('label', { class: 'field' }, 'Zusatzkosten (ct/km)',
        h('input', {
          type: 'number', min: 0, step: 0.5, value: state.car.extraPerKm,
          onchange: (e) => update((s) => { s.car.extraPerKm = Number(e.target.value); }),
        })),
    ),
  );
}

function priceCard(map) {
  const fuel = tkFuel();
  const price = effectivePrice();
  const modes = [['cheapest', 'Günstigste an der Strecke'], ['station', 'Tankstelle wählen'], ['manual', 'Manuell']];
  const card = h('section', { class: 'card' }, h('h2', {}, 'Spritpreis'));

  card.append(h('div', { class: 'segmented', role: 'radiogroup' }, modes.map(([m, label]) => h('button', {
    type: 'button', class: state.price.mode === m ? 'active' : '', role: 'radio', 'aria-checked': String(state.price.mode === m),
    onclick: () => update((s) => { s.price.mode = m; applyPriceMode(s); }),
  }, label))));

  const usingLive = state.price.mode !== 'manual' && state.price.current > 0;
  card.append(h('div', { class: 'price-display' },
    h('div', { class: 'price-big' }, fmtPrice(price), h('small', {}, ' / Liter')),
    h('div', { class: 'muted' }, usingLive
      ? `${state.price.stationName} · Stand ${new Date(state.price.updatedAt).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}`
      : state.price.mode === 'manual' ? 'Manuell eingegeben' : 'Noch kein Live-Preis – es wird der manuelle Preis verwendet'),
  ));

  if (state.price.mode === 'manual' || !usingLive) {
    card.append(h('label', { class: 'field' }, state.price.mode === 'manual' ? 'Preis pro Liter (€)' : 'Ersatzpreis pro Liter (€)',
      h('input', {
        type: 'number', min: 0, step: 0.001, value: state.price.manual,
        onchange: (e) => update((s) => { s.price.manual = Number(e.target.value); }),
      })));
  }

  if (state.price.mode === 'manual') return card;

  if (!fuel) {
    card.append(h('p', { class: 'hint warn' }, `Für ${FUELS[state.car.fuel].label} gibt es keine Live-Preise – bitte manuell eintragen.`));
    return card;
  }

  card.append(h('details', { class: 'more', open: !state.apiKey },
    h('summary', {}, state.apiKey ? 'Tankerkönig-API-Key ✓' : 'Tankerkönig-API-Key eintragen'),
    h('p', { class: 'hint' }, 'Live-Preise kommen von der Markttransparenzstelle über ',
      h('a', { href: 'https://onboarding.tankerkoenig.de/', target: '_blank', rel: 'noopener' }, 'Tankerkönig'),
      '. Der Key ist kostenlos (E-Mail genügt) und bleibt nur in deinem Browser gespeichert.'),
    h('input', {
      type: 'text', value: state.apiKey, placeholder: 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx', spellcheck: false,
      onchange: (e) => update((s) => { s.apiKey = e.target.value.trim(); }),
    }),
  ));

  card.append(h('button', {
    type: 'button', class: 'btn btn-primary full', disabled: loading || !state.apiKey, onclick: loadStations,
  }, loading ? 'Lade Tankstellen …' : state.stations.length ? '↻ Preise an der Strecke neu laden' : 'Tankstellen an der Strecke laden'));

  const list = sortedStations(fuel);
  if (list.length) {
    const min = list[0][fuel];
    card.append(h('ul', { class: 'stations' }, list.slice(0, 15).map((st) => h('li', {
      class: `${st.id === state.price.stationId ? 'selected' : ''} ${st.isOpen ? '' : 'closed'}`,
    },
      h('button', { type: 'button', class: 'station-main', onclick: () => stationSelected(st.id), title: 'Diesen Preis verwenden' },
        h('span', { class: 'station-name' }, st.brand || st.name, st.isOpen ? null : h('span', { class: 'tag' }, 'zu')),
        h('span', { class: 'station-addr' }, `${st.address} · ${fmtKm(st.detour)} von der Route`)),
      h('span', { class: 'station-price' }, fmtPrice(st[fuel]),
        st[fuel] > min ? h('small', {}, `+${Math.round((st[fuel] - min) * 100)} ct`) : h('small', { class: 'ok' }, 'günstigste')),
      h('button', { type: 'button', class: 'icon-btn', title: 'Auf Karte zeigen', onclick: () => map.focusStation(st) }, '📍'),
    ))));
    card.append(h('p', { class: 'hint small' }, 'Preisdaten: Markttransparenzstelle für Kraftstoffe via tankerkoenig.de (CC BY 4.0). Preise werden alle 15 Minuten aktualisiert, solange die Seite offen ist.'));
  }
  return card;
}

function weeklyLiters() {
  const w = getWeek(state.ui.week);
  let liters = 0;
  if (w) {
    for (const day of Object.values(w.days)) {
      for (const d of DIRECTIONS) if (day[d]) liters += calcTrip(day[d], w.snap, state.split).liters;
    }
  }
  if (liters > 0) return { liters, source: 'laut Fahrtenplan dieser Woche' };
  const km = currentLegs().reduce((a, l) => a + l.km, 0);
  return { liters: (km * (state.roundTrip ? 2 : 1) * 5 * state.car.consumption) / 100, source: 'geschätzt für 5 Arbeitstage' };
}

function timeCard() {
  const fuel = tkFuel();
  const own = fuel ? profileFromObservations(state.observations, fuel) : { count: 0, hoursCovered: 0 };
  const hasOwn = own.count >= 12 && own.hoursCovered >= 6;
  const useOwn = hasOwn && curveMode === 'own';
  const curve = useOwn ? blendProfile(own.curve) : TYPICAL_CURVE;
  const best = bestWindow(curve, 2);
  const worst = worstHour(curve);
  const diff = (curve[worst] - best.avg) / 100;
  const { liters, source } = weeklyLiters();
  const nowH = new Date().getHours();

  const W = 480; const H = 150; const pad = 22; const bw = (W - pad) / 24;
  const max = Math.max(...curve, 1);
  const inBest = (hr) => (hr - best.start + 24) % 24 < 2;
  const bars = curve.map((v, hr) => {
    const bh = Math.max(2, (v / max) * (H - 40));
    const t = v / max;
    return `<rect x="${pad + hr * bw + 1}" y="${H - 20 - bh}" width="${bw - 2}" height="${bh}" rx="2" fill="${inBest(hr) ? 'var(--good)' : `hsl(${120 - 120 * t} 55% 55%)`}" opacity="${inBest(hr) ? 1 : 0.75}"><title>${hr}–${hr + 1} Uhr: ca. +${v.toFixed(1)} ct</title></rect>`;
  }).join('');
  const labels = [0, 3, 6, 9, 12, 15, 18, 21].map((hr) => `<text x="${pad + hr * bw + bw / 2}" y="${H - 5}" text-anchor="middle">${hr}</text>`).join('');
  const nowX = pad + nowH * bw + bw / 2;
  const svg = `<svg viewBox="0 0 ${W} ${H}" class="chart" role="img" aria-label="Typischer Preisverlauf über den Tag">
    <text x="${pad}" y="12" class="axis">ct/l über Tagestief</text>
    ${bars}${labels}
    <line x1="${nowX}" x2="${nowX}" y1="16" y2="${H - 20}" class="now"/><text x="${nowX}" y="14" text-anchor="middle" class="now-label">jetzt</text>
  </svg>`;

  const fmtH = (x) => `${String(x).padStart(2, '0')}:00`;
  return h('section', { class: 'card' },
    h('h2', {}, 'Beste Zeit zum Tanken'),
    hasOwn ? h('div', { class: 'segmented small' },
      h('button', { type: 'button', class: !useOwn ? 'active' : '', onclick: () => { curveMode = 'typical'; update(() => {}); } }, 'Typischer Verlauf'),
      h('button', { type: 'button', class: useOwn ? 'active' : '', onclick: () => { curveMode = 'own'; update(() => {}); } }, `Eigene Messungen (${own.count})`),
    ) : null,
    h('div', { class: 'chart-wrap', html: svg }),
    h('div', { class: 'callout good' },
      h('strong', {}, `Am günstigsten meist ${fmtH(best.start)}–${fmtH(best.end)} Uhr`),
      h('div', {}, `ca. ${Math.round(diff * 100)} ct/l günstiger als um ${worst} Uhr.`),
      liters > 0 ? h('div', {}, `Bei ${fmtL(liters)} pro Woche (${source}) spart ihr so etwa `, h('strong', {}, fmtEuro(liters * diff)), ' pro Woche.') : null,
    ),
    h('p', { class: 'hint small' }, useOwn
      ? 'Auf Basis der Preise, die diese Seite bei deinen Tankstellen gemessen hat (Lücken mit dem typischen Verlauf aufgefüllt).'
      : 'Richtwert nach dem typischen Tagesverlauf in Deutschland (u. a. ADAC-Auswertungen): morgens teuer, abends am günstigsten. Mit API-Key sammelt die Seite eigene Messwerte deiner Tankstellen – ab einigen Messungen über den Tag kannst du auf „Eigene Messungen“ umschalten.'),
  );
}

function costCard() {
  const legs = currentLegs();
  const km = legs.reduce((a, l) => a + l.km, 0);
  if (!km) return null;
  const snap = { consumption: state.car.consumption, price: effectivePrice(), extraPerKm: state.car.extraPerKm };
  const one = legCost(km, snap);
  const factor = state.roundTrip ? 2 : 1;
  return h('section', { class: 'card' },
    h('h2', {}, 'Kosten auf einen Blick'),
    h('div', { class: 'stats' },
      stat('Einfache Fahrt', fmtEuro(one.total), `${fmtKm(km)} · ${fmtL(one.liters)}`),
      state.roundTrip ? stat('Hin & zurück', fmtEuro(one.total * 2), fmtL(one.liters * 2)) : null,
      stat('Woche (5 Tage)', fmtEuro(one.total * factor * 5)),
    ),
    h('table', { class: 'table compact' },
      h('thead', {}, h('tr', {}, h('th', {}, 'Personen im Auto'), h('th', {}, 'pro Person & Fahrt'), h('th', {}, state.roundTrip ? 'pro Person & Tag' : ''))),
      h('tbody', {}, [1, 2, 3, 4, 5].map((n) => h('tr', {},
        h('td', {}, `${n}`), h('td', {}, fmtEuro(one.total / n)), h('td', {}, state.roundTrip ? fmtEuro((one.total * 2) / n) : ''))))),
    h('p', { class: 'hint small' }, 'Wer wann mitfährt und wie genau aufgeteilt wird, legst du im Tab „Fahrten“ fest.'),
  );
}

export function renderFuelTab(el, { map }) {
  el.append(...[carCard(), priceCard(map), costCard(), timeCard()].filter(Boolean));
}
