// Ansicht „Strecke“: Hin-/Rückfahrt, Sperrungen & Baustellen, Umleitungen; für Admins zusätzlich Ziel, Start und Reihenfolge.
import { state, update, model, personById, todayIso } from './state.js';
import { effectiveOrder, isActive } from './model.js';
import { isAdmin } from './account.js';
import { me, adminSet, setAddress, addDetour, endDetour, setDetourUntil, chooseDetour } from './actions.js';
import { SOURCE, KIND_LABEL, isClosure, statusText, timeStatus, fmtWhen } from './traffic.js';
import { priceCard, timeCard, costCard } from './tab-fuel.js';
import { addressInput } from './address.js';
import { h, fmtKm, fmtDuration, fmtDate, toast } from './ui.js';
import { icon } from './icons.js';

const safe = (fn) => { try { fn(); } catch (e) { toast(e.message, 'error'); } };
export const DIR_TEXT = { hin: 'Hinfahrt', rueck: 'Rückfahrt', both: 'Hin- und Rückfahrt' };

/** „Hauptstraße 5, 76316 Malsch“ → „Hauptstraße 5, Malsch“ */
export function shortPlace(label = '') {
  const parts = String(label).split(',').map((x) => x.trim()).filter(Boolean);
  if (parts.length < 2) return parts[0] || 'Umleitung';
  return `${parts[0]}, ${parts[parts.length - 1].replace(/^\d{4,5}\s*/, '')}`;
}

const dayNum = (iso) => { const [y, m, d] = iso.split('-').map(Number); return Date.UTC(y, m - 1, d) / 864e5; };
const daysBetween = (a, b) => Math.round(dayNum(b) - dayNum(a));

/** „gilt seit 05.10. bis 30.11. · noch 54 Tage“ */
export function detourText(d, today = todayIso()) {
  const until = d.until ? ` bis ${fmtDate(d.until)}${d.until.slice(0, 4) !== today.slice(0, 4) ? d.until.slice(0, 4) : ''}` : '';
  if (d.from && d.from > today) return `ab ${fmtDate(d.from)}${until}`;
  if (!d.until) return `gilt seit ${fmtDate(d.from || today)} · ohne Enddatum`;
  const left = daysBetween(today, d.until);
  return `gilt seit ${fmtDate(d.from || today)}${until} · ${left <= 0 ? 'nur noch heute' : `noch ${left + 1} Tage`}`;
}

const cleanTitle = (it) => it.title.replace(/^A\d+\s*\|\s*/, '').replace(/ - /g, ' – ');
const arrow = (s) => s.replace(/\s*->\s*/g, ' → ');
const clock = (ms) => new Date(ms).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
const incidentCls = (it) => (isClosure(it) ? 'closure' : it.kind === 'short' ? 'short' : 'works');
const INCIDENT_ICON = { closure: 'octagon-x', works: 'construction', short: 'traffic-cone' };

// ---------- Hin- / Rückfahrt ----------

function directionCard(c) {
  const dirs = state.roundTrip !== false ? ['hin', 'rueck'] : ['hin'];
  const cur = c.routeDir();
  const t = c.traffic();
  const rows = dirs.map((dir) => {
    const r = c.displayRoute(dir);
    const info = c.routeInfo(dir);
    const extra = r && info?.baseDistance ? (r.distance - info.baseDistance) / 1000 : 0;
    const items = t.ready ? t[dir] || [] : [];
    const closures = items.filter(isClosure).length;
    const works = items.filter((i) => i.kind === 'roadworks').length;
    const detour = info?.hasDetour;
    return h('button', {
      type: 'button', class: `list-row dir-row ${dir} ${dir === cur ? 'active' : ''}`, 'aria-pressed': String(dir === cur), onclick: () => c.setRouteDir(dir),
    },
    h('span', { class: 'dir-bar' }),
    h('span', { class: 'grow' },
      h('span', { class: 'title' }, DIR_TEXT[dir]),
      h('span', { class: 'sub' }, r ? `${fmtKm(r.distance / 1000)} · ${fmtDuration(r.duration)}` : 'wird berechnet …',
        detour ? h('span', { class: 'dir-extra' }, extra > 0.05 ? ` · mit Umleitung (+${fmtKm(extra)})` : ' · mit Umleitung') : null)),
    closures ? h('span', { class: 'pill pill-red', title: 'Sperrungen' }, icon('octagon-x', { size: 13 }), String(closures)) : null,
    works ? h('span', { class: 'pill pill-orange', title: 'Baustellen' }, icon('construction', { size: 13 }), String(works)) : null,
    dir === cur ? h('span', { class: 'dir-check' }, icon('check', { size: 18 })) : null);
  });
  return h('section', { class: 'card' },
    h('h2', {}, 'Strecke'),
    h('div', { class: 'list' }, rows),
    h('p', { class: 'hint small' },
      dirs.length > 1 ? 'Tippe auf eine Richtung, um sie auf der Karte zu sehen. ' : '',
      'Gezeigt wird die Fahrt, wenn alle dabei sind – wer an einem Tag nicht mitfährt, wird nicht angefahren.'));
}

// ---------- Sperrungen & Baustellen ----------

function trafficCard(c) {
  const dir = c.routeDir();
  const t = c.traffic();
  const name = DIR_TEXT[dir];
  const items = t[dir] || [];
  const roads = t.roadsBy?.[dir] || t.roads || [];
  const now = new Date();
  const row = (it) => {
    const cls = incidentCls(it);
    return h('button', { type: 'button', class: `list-row incident-row ${cls}`, onclick: () => c.focusIncident(it) },
      h('span', { class: `incident-sq ${cls}` }, icon(INCIDENT_ICON[cls], { size: 15 })),
      h('span', { class: 'grow' },
        h('span', { class: 'title' }, cleanTitle(it)),
        h('span', { class: 'sub' }, `${it.road}${it.subtitle ? ` · ${arrow(it.subtitle)}` : ''}`),
        h('span', { class: `incident-when ${timeStatus(it.times, now).state}` }, statusText(it, now))),
      h('span', { class: 'chev' }, icon('chevron-right', { size: 16 })));
  };
  const closures = items.filter(isClosure);
  const works = items.filter((i) => i.kind === 'roadworks');
  const short = items.filter((i) => i.kind === 'short');
  let body;
  if (t.error) body = h('p', { class: 'callout' }, `Verkehrsmeldungen gerade nicht erreichbar (${t.error}).`);
  else if (!t.ready) body = h('p', { class: 'hint' }, 'Verkehrsmeldungen werden geladen …');
  else if (!roads.length) {
    body = h('p', { class: 'hint' }, 'Auf eurer Strecke liegt keine Autobahn. Für Bundes- und Landstraßen gibt es keine offenen Daten zu Sperrungen – fahrt ihr wegen einer Sperrung einen Umweg, tragt ihn unten als Umleitung ein.');
  } else if (!items.length) body = h('p', { class: 'callout good' }, `Keine Sperrungen oder Baustellen auf der ${name} gemeldet.`);
  else {
    body = [
      closures.length ? [h('h3', { class: 'incident-h' }, 'Sperrungen'), h('div', { class: 'list' }, closures.map(row))]
        : h('p', { class: 'callout good' }, `Keine Sperrungen auf der ${name} gemeldet.`),
      works.length ? [h('h3', { class: 'incident-h' }, 'Baustellen'), h('div', { class: 'list' }, works.map(row))] : null,
      short.length ? h('details', { class: 'more' },
        h('summary', {}, `Kurzzeitbaustellen (${short.length}) – meist stundenweise oder nachts`),
        h('div', { class: 'list' }, short.map(row))) : null,
    ];
  }
  return h('section', { class: 'card' },
    h('div', { class: 'row between' },
      h('h2', {}, 'Sperrungen & Baustellen'),
      h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Aktualisieren', title: 'Aktualisieren', disabled: !!t.loading, onclick: () => c.loadTraffic(true) },
        icon('refresh-cw', { size: 18, cls: t.loading ? 'spin' : '' }))),
    h('p', { class: 'hint small', style: { marginTop: 0 } },
      `${name}${roads.length ? ` · ${roads.join(', ')}` : ''}${t.at && t.ready ? ` · Stand ${clock(t.at)} Uhr` : ''}`),
    body,
    h('p', { class: 'hint small' }, `Quelle: ${SOURCE} – nur Autobahnen. Antippen zeigt die Stelle auf der Karte und wie lange sie noch besteht.`));
}

/** Inhalt des Karten-Popups einer Sperrung/Baustelle. */
export function incidentPopup(it, { onDetour } = {}) {
  const now = new Date();
  const cls = incidentCls(it);
  const st = timeStatus(it.times, now);
  const overall = it.times.overallEnd && (!st.until || it.times.overallEnd - st.until > 864e5) ? it.times.overallEnd : null;
  return h('div', { class: 'incident-popup' },
    h('div', { class: `incident-kind ${cls}` }, icon(INCIDENT_ICON[cls], { size: 14 }), `${KIND_LABEL[it.kind]} · ${it.road}`),
    h('strong', {}, cleanTitle(it)),
    it.subtitle ? h('div', { class: 'muted small' }, it.subtitle.includes('->') ? `Richtung ${arrow(it.subtitle)}` : it.subtitle) : null,
    h('div', { class: `incident-status ${st.state}` }, statusText(it, now)),
    overall ? h('div', { class: 'small muted' }, `Gesamte Maßnahme bis ${fmtWhen(overall, now, { time: false })}`) : null,
    it.lines.length ? h('details', {}, h('summary', {}, 'Details'),
      h('ul', { class: 'incident-lines' }, it.lines.slice(0, 14).map((l) => h('li', {}, l.length > 220 ? `${l.slice(0, 220)} …` : l)))) : null,
    onDetour ? h('button', { type: 'button', class: 'btn btn-small', onclick: () => onDetour(it) }, icon('signpost', { size: 15 }), 'Umleitung eintragen') : null,
    h('div', { class: 'tiny muted' }, `Quelle: ${SOURCE}`));
}

/** Inhalt des Karten-Popups einer Umleitung. */
export function detourPopup(id) {
  const d = (state.detours || []).find((x) => x.id === id);
  if (!d) return h('div', {}, 'Umleitung');
  return h('div', { class: 'incident-popup' },
    h('div', { class: 'incident-kind detour' }, icon('signpost', { size: 14 }), `Umleitung · ${DIR_TEXT[d.dir]}`),
    h('strong', {}, d.place),
    d.note ? h('div', {}, d.note) : null,
    h('div', { class: 'incident-status active' }, detourText(d)),
    isAdmin() ? h('div', { class: 'hint small' }, 'Zum Verschieben den Punkt auf die richtige Straße ziehen.') : null);
}

// ---------- Umleitungen ----------

let draft = null; // { dir, lat, lng, place, label, note, from, until }

/** Formular „Umleitung eintragen“ öffnen (auch aus der Karte oder einer Sperrung heraus). */
export function openDetourForm(prefill = {}) {
  if (!isAdmin()) return;
  const dir = state.roundTrip !== false && state.ui.routeDir === 'rueck' ? 'rueck' : 'hin';
  draft = { dir, note: '', from: todayIso(), until: '', ...(draft || {}), ...prefill };
  update((s) => { s.ui.tab = 'route'; s.ui.routeSub = 'route'; });
  setTimeout(() => document.getElementById('detour-form')?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 80);
}

function detourForm(c) {
  const today = todayIso();
  const set = (patch) => { Object.assign(draft, patch); update(() => {}); };
  const dirs = [['hin', 'Hinfahrt'], ['rueck', 'Rückfahrt'], ['both', 'Beide']].filter(([d]) => d === 'hin' || state.roundTrip !== false);
  return h('div', { class: 'detour-form', id: 'detour-form' },
    h('h3', {}, 'Neue Umleitung'),
    h('div', { class: 'segmented' }, dirs.map(([d, l]) => h('button', { type: 'button', class: draft.dir === d ? 'active' : '', onclick: () => set({ dir: d }) }, l))),
    h('div', { class: 'field' }, 'Umleitung über',
      addressInput({
        value: draft.lat != null ? { label: draft.label || draft.place } : null, placeholder: 'Ort oder Straße der Umleitung', near: state.destination,
        onSelect: (a) => { if (a) set({ lat: a.lat, lng: a.lng, label: a.label, place: shortPlace(a.label) }); }, focusKey: 'detour-addr',
      }),
      h('span', { class: 'hint small' }, 'Oder auf der Karte auf die Straße tippen, über die ihr fahrt → „Umleitung über diesen Punkt“.')),
    h('label', { class: 'field' }, 'Grund (optional)',
      h('input', { type: 'text', value: draft.note || '', placeholder: 'z. B. Sperrung B3 bei Malsch', oninput: (e) => { draft.note = e.target.value; } })),
    h('div', { class: 'row gap detour-dates' },
      h('label', { class: 'field' }, 'Gilt ab', h('input', { type: 'date', value: draft.from, min: today, onchange: (e) => set({ from: e.target.value || today }) })),
      h('label', { class: 'field' }, 'Gilt bis (optional)', h('input', { type: 'date', value: draft.until || '', min: draft.from || today, onchange: (e) => set({ until: e.target.value }) }))),
    h('div', { class: 'row gap' },
      h('button', {
        type: 'button', class: 'btn btn-primary', disabled: draft.lat == null,
        onclick: () => safe(() => {
          addDetour({ ...draft, until: draft.until || null });
          draft = null;
          c.refreshRoute();
          toast('Umleitung gespeichert – die Strecke wird neu berechnet', 'ok');
        }),
      }, 'Speichern'),
      h('button', { type: 'button', class: 'btn', onclick: () => { draft = null; update(() => {}); } }, 'Abbrechen')));
}

let suggest = null; // { dir, loading, list, error }

const fmtMin = (m) => `${Math.round(m)} min`;
const fmtPlus = (v, fmt) => (Math.abs(v) < 0.05 ? '±0' : `${v > 0 ? '+' : '−'}${fmt(Math.abs(v))}`);

/** Eine Zeile: km, Fahrzeit und (bei Umleitungen) Mehr-km / Mehr-Minuten gegenüber der normalen Strecke. */
function variantLine(v, isBase) {
  if (!v) return h('span', { class: 'sub' }, 'wird berechnet …');
  return h('span', { class: 'variant-nums' },
    h('span', {}, `${fmtKm(v.km)} · ${fmtDuration(v.min * 60)}`),
    isBase ? null : h('span', { class: 'variant-extra' }, `${fmtPlus(v.extraKm, fmtKm)} · ${fmtPlus(v.extraMin, fmtMin)}`));
}

function detourActions(d, c, today) {
  return h('span', { class: 'detour-actions', onclick: (e) => e.stopPropagation() },
    h('label', { class: 'small muted' }, 'bis ',
      h('input', { type: 'date', value: d.until || '', min: d.from > today ? d.from : today, onchange: (e) => safe(() => { setDetourUntil(d.id, e.target.value || null); c.refreshRoute(); }) })),
    h('button', {
      type: 'button', class: 'link small',
      onclick: () => {
        const remove = d.from > today || d.use === false;
        if (confirm(remove ? `Umleitung über ${d.place} löschen?` : `Umleitung über ${d.place} beenden?\n\nAb heute wird wieder die normale Strecke gerechnet. Bisherige Fahrten bleiben, wie sie waren.`)) {
          safe(() => { endDetour(d.id); c.refreshRoute(); });
        }
      },
    }, d.from > today || d.use === false ? 'Löschen' : 'Beenden'));
}

/** Normale Strecke und alle Umleitungs-Varianten einer Richtung – eine davon wird gefahren. */
function variantList(dir, list, c, admin, today) {
  const chosen = list.find((d) => d.use !== false);
  const pick = (id) => safe(() => { chooseDetour(dir, id); c.refreshRoute(); toast(id ? 'Umleitung ausgewählt – gilt ab heute' : 'Ab heute wieder die normale Strecke', 'ok'); });
  const row = (d) => {
    const on = d ? d === chosen : !chosen;
    const v = c.variantInfo(dir, d);
    const choose = admin && !on ? () => pick(d ? d.id : null) : null;
    return h('div', {
      class: `list-row variant-row ${on ? 'on' : ''} ${choose ? 'pickable' : ''}`, role: admin ? 'button' : null, tabindex: choose ? '0' : null, 'aria-pressed': admin ? String(on) : null,
      onclick: choose, onkeydown: choose ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); choose(); } } : null,
    },
    h('span', { class: `variant-radio ${on ? 'on' : ''}` }, on ? icon('check', { size: 13 }) : null),
    h('span', { class: 'grow' },
      h('span', { class: 'title' }, d ? `über ${d.place}` : 'Normale Strecke', d?.dir === 'both' ? h('span', { class: 'muted small' }, ' · Hin & Rück') : null),
      d?.note ? h('span', { class: 'sub' }, d.note) : null,
      variantLine(v, !d),
      d ? h('span', { class: 'sub' }, d.use === false ? `Variante${d.until ? ` · bis ${fmtDate(d.until)}` : ''}` : detourText(d, today)) : null,
      d && admin ? detourActions(d, c, today) : null),
    on ? h('span', { class: 'variant-tag' }, 'wird gefahren') : null);
  };
  return h('div', { class: 'list' }, row(null), list.map(row));
}

function detoursCard(c) {
  const admin = isAdmin();
  const today = todayIso();
  const live = (state.detours || []).filter((d) => !d.until || d.until >= today).sort((a, b) => (a.from || '').localeCompare(b.from || ''));
  if (!admin && !live.length) return null;
  const dirs = state.roundTrip !== false ? ['hin', 'rueck'] : ['hin'];
  const sections = dirs.map((dir) => [dir, live.filter((d) => d.dir === dir || d.dir === 'both')]).filter(([dir, list]) => list.length || dir === c.routeDir());
  const sug = suggest && suggest.dir === c.routeDir() ? suggest : null;
  return h('section', { class: 'card', id: 'detours' },
    h('h2', {}, 'Umleitungen'),
    admin ? h('p', { class: 'hint small' }, 'Tragt mögliche Umwege ein oder lasst euch Ausweichrouten vorschlagen – je Variante seht ihr Kilometer und Fahrzeit. Antippen wählt aus, welche ihr fahrt; ab dann rechnet die App damit. Bisherige Fahrten bleiben, wie sie waren.') : null,
    sections.map(([dir, list]) => [
      h('h3', { class: 'incident-h' }, DIR_TEXT[dir]),
      list.length || admin ? variantList(dir, list, c, admin, today) : null,
    ]),
    admin && sug ? h('div', { class: 'suggest-box' },
      h('h3', { class: 'incident-h' }, `Vorschläge für die ${DIR_TEXT[sug.dir]}`),
      sug.loading ? h('p', { class: 'hint' }, 'Ausweichrouten werden gesucht …')
        : sug.error ? h('p', { class: 'callout' }, `Keine Vorschläge möglich (${sug.error}).`)
          : !sug.list.length ? h('p', { class: 'hint' }, 'Der Routenplaner kennt keine sinnvollen Ausweichrouten. Tippt die Umleitung selbst auf der Karte an.')
            : h('div', { class: 'list' }, sug.list.map((x) => h('div', { class: 'list-row variant-row' },
              h('span', { class: 'incident-sq detour' }, icon('signpost', { size: 15 })),
              h('span', { class: 'grow' },
                h('span', { class: 'title' }, `über ${x.place}`),
                h('span', { class: 'variant-extra' }, `${fmtPlus(x.extraKm, fmtKm)} · ${fmtPlus(x.extraMin, fmtMin)}`)),
              h('button', {
                type: 'button', class: 'btn btn-small',
                onclick: () => safe(() => {
                  addDetour({ dir: sug.dir, lat: x.lat, lng: x.lng, label: x.label, place: x.place, note: 'Vorschlag Routenplaner', use: false });
                  sug.list = sug.list.filter((y) => y !== x);
                  if (!sug.list.length) suggest = null; // alle übernommen
                  toast('Als Variante übernommen – antippen, um sie zu fahren', 'ok');
                }),
              }, 'Übernehmen')))),
      h('p', { class: 'hint small' }, 'Der Routenplaner kennt keine Sperrungen – prüft, ob der Vorschlag die gesperrte Stelle wirklich umfährt.')) : null,
    admin ? (draft ? detourForm(c) : h('div', { class: 'row gap wrap' },
      h('button', { type: 'button', class: 'btn btn-small', onclick: () => openDetourForm({}) }, icon('signpost', { size: 15 }), 'Umleitung eintragen'),
      h('button', {
        type: 'button', class: 'btn btn-small', disabled: !!sug?.loading,
        onclick: async () => {
          const dir = c.routeDir();
          suggest = { dir, loading: true, list: [] };
          update(() => {});
          try { suggest = { dir, loading: false, list: await c.suggestDetours(dir) }; } catch (e) { suggest = { dir, loading: false, list: [], error: e.message }; }
          update(() => {});
        },
      }, icon('sparkles', { size: 15 }), `Ausweichrouten vorschlagen (${DIR_TEXT[c.routeDir()]})`))) : null,
  );
}

// ---------- Admin: Ziel, Start, Reihenfolge ----------

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

function adminRouteView(el, c) {
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
    c.refreshRoute();
  };
  const back = state.returnOrder?.length ? [...state.returnOrder.filter((id) => pickups.includes(id)), ...[...pickups].reverse().filter((id) => !state.returnOrder.includes(id))] : [...pickups].reverse();
  const moveBack = (k, dir) => {
    const o = [...back];
    [o[k], o[k + dir]] = [o[k + dir], o[k]];
    safe(() => adminSet((s) => { s.returnOrder = o; }, `Rückfahrt-Reihenfolge: ${o.map((id) => personById(id)?.name).join(' → ')}`));
    c.refreshRoute();
  };
  const hasRoute = driver?.address?.lat && state.destination?.lat;

  if (hasRoute) el.append(...[directionCard(c), trafficCard(c), detoursCard(c)].filter(Boolean));
  el.append(
    h('section', { class: 'card' },
      h('h2', {}, 'Ziel'),
      addressInput({ value: state.destination, placeholder: 'Ziel, z. B. Firma', near: driver?.address, onSelect: c.setDestination, focusKey: 'dest' })),
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
          onclick: () => { safe(() => adminSet((s) => { s.order = null; }, manual ? 'Abholreihenfolge: wieder automatisch (beste Route)' : null)); c.refreshRoute(true); },
        }, icon('sparkles', { size: 15 }), manual ? 'Beste Reihenfolge wiederherstellen' : 'Neu berechnen')) : null,
      h('p', { class: 'hint small' }, 'Die App berechnet automatisch die kürzeste Route zum Einsammeln. Mit den Pfeilen kannst du sie von Hand ändern.'),
    ),
  );

  if (!hasRoute) {
    el.append(h('section', { class: 'card' },
      h('h2', {}, 'Ohne Karte'),
      h('p', { class: 'hint small' }, 'Solange Start oder Ziel fehlen, wird mit diesen Kilometern pro Fahrt gerechnet (alle zahlen die ganze Strecke).'),
      h('label', { class: 'field' }, 'Kilometer pro Fahrt',
        h('input', { type: 'number', min: 0, step: 0.1, inputmode: 'decimal', value: state.manualKm ?? '', onchange: (e) => safe(() => adminSet((s) => { s.manualKm = e.target.value === '' ? null : Number(e.target.value); }, `Kilometer pro Fahrt: ${e.target.value}`)) }))));
  }

  el.append(h('section', { class: 'card' },
    h('label', { class: 'switch-row' }, h('span', {}, h('strong', {}, 'Mit Rückfahrt')),
      h('input', { type: 'checkbox', class: 'switch', checked: state.roundTrip !== false, onchange: (e) => safe(() => { adminSet((s) => { s.roundTrip = e.target.checked; }, `Rückfahrt ${e.target.checked ? 'an' : 'aus'}`); c.refreshRoute(); }) })),
    state.roundTrip !== false && pickups.length > 1 ? [
      h('p', { class: 'hint small' }, 'Reihenfolge beim Absetzen auf dem Rückweg:'),
      orderList(back, moveBack),
      state.returnOrder?.length ? h('button', { type: 'button', class: 'btn btn-small', onclick: () => safe(() => { adminSet((s) => { s.returnOrder = null; }, 'Rückfahrt: wie Hinweg umgekehrt'); c.refreshRoute(); }) }, icon('rotate-ccw', { size: 15 }), 'Wie Hinweg umgekehrt') : null,
    ] : null,
  ));
}

// ---------- Mitfahrer: ansehen, eigene Abholadresse ändern ----------

function memberRouteView(el, c) {
  const persons = model().persons;
  const driver = personById(state.defaultDriver);
  const mine = me();
  const pickups = effectiveOrder(state, persons.filter(isActive));
  const my = personById(mine);
  const dir = c.routeDir();
  const destLabel = state.destination?.label?.split(',').slice(0, 2).join(',') || 'noch nicht festgelegt';
  const back = state.returnOrder?.length ? [...state.returnOrder.filter((id) => pickups.includes(id)), ...[...pickups].reverse().filter((id) => !state.returnOrder.includes(id))] : [...pickups].reverse();
  const seq = dir === 'rueck' ? back : pickups;
  const person = (pid, k) => {
    const p = personById(pid);
    return h('div', { class: 'list-row' }, h('span', { class: 'dot', style: { '--pc': p?.color } }),
      h('span', { class: 'grow' }, `${k + 1}. ${p?.name}`, pid === mine ? h('span', { class: 'muted' }, ' (du)') : null));
  };
  const driverRow = (label) => h('div', { class: 'list-row' }, h('span', { class: 'dot', style: { '--pc': driver?.color } }),
    h('span', { class: 'grow' }, h('strong', {}, label), h('small', { class: 'muted' }, ` · ${driver?.name || 'Fahrer'}`)));
  const destRow = (label) => h('div', { class: 'list-row' }, icon('map-pin', { size: 16 }),
    h('span', { class: 'grow' }, h('strong', {}, label), h('small', { class: 'muted' }, ` · ${destLabel}`)));

  if (driver?.address?.lat && state.destination?.lat) el.append(directionCard(c), trafficCard(c));
  const dc = detoursCard(c);
  if (dc) el.append(dc);
  el.append(
    h('section', { class: 'card' },
      h('h2', {}, dir === 'rueck' ? 'Reihenfolge Rückfahrt' : 'Reihenfolge Hinfahrt'),
      h('div', { class: 'list' },
        dir === 'rueck' ? destRow('Start') : driverRow('Start'),
        seq.map(person),
        dir === 'rueck' ? driverRow('Ende') : destRow('Ziel')),
      h('p', { class: 'hint small' }, 'Die Reihenfolge legt der Admin fest. Fährt jemand an einem Tag nicht mit, wird seine Adresse ausgelassen.')),
    my ? h('section', { class: 'card' },
      h('h2', {}, my.id === state.defaultDriver ? 'Deine Startadresse' : 'Deine Abholadresse'),
      addressInput({ value: my.address, placeholder: 'Adresse suchen', allowLocate: true, near: state.destination, onSelect: (a) => safe(() => setAddress(mine, a)), focusKey: 'my-addr' }),
      h('p', { class: 'hint small' }, 'Du kannst deine Adresse auch auf der Karte verschieben oder in die Karte tippen.')) : null,
  );
}

export function renderRouteView(el, c) {
  if (!isAdmin()) memberRouteView(el, c);
  else {
    const sub = state.ui.routeSub === 'fuel' ? 'fuel' : 'route';
    el.append(h('div', { class: 'segmented' },
      h('button', { type: 'button', class: sub === 'route' ? 'active' : '', onclick: () => update((s) => { s.ui.routeSub = 'route'; }) }, 'Route'),
      h('button', { type: 'button', class: sub === 'fuel' ? 'active' : '', onclick: () => update((s) => { s.ui.routeSub = 'fuel'; }) }, 'Spritpreis & Tankzeit')));
    if (sub === 'route') adminRouteView(el, c);
    else el.append(...[priceCard(c.map), costCard(), timeCard()].filter(Boolean));
  }
  if (!state.ui.showMap) el.append(h('button', { type: 'button', class: 'btn', onclick: c.toggleMap }, icon('map', { size: 18 }), 'Karte einblenden'));
}

