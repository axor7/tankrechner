// Ansicht „Karte“: Hin-/Rückfahrt, Sperrungen & Baustellen, Umleitungen; für Admins zusätzlich Ziel, Start und Reihenfolge.
// Von hier aus: Einzelfahrt berechnen und (Admin) Spritpreis & Tankstellen.
import { state, update, model, personById, todayIso } from './state.js';
import { effectiveOrder, isActive } from './model.js';
import { isAdmin } from './account.js';
import { me, adminSet, setAddress, applyDetour, setDetourDates, deleteDetour, normalRouteFromToday } from './actions.js';
import { SOURCE, KIND_LABEL, isClosure, statusText, timeStatus, fmtWhen } from './traffic.js';
import { usesClosure } from './detours.js';
import { priceCard, timeCard, costCard } from './tab-fuel.js';
import { addressInput } from './address.js';
import { renderSingleTrip } from './view-single.js';
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

/** Lesbarer Titel: „A8 | Karlsruhe - Pforzheim“ → „Karlsruhe – Pforzheim“; Auffahrten aus dem Untertitel;
 *  interne Kennungen („EF_2026-036728_bFR_AS“) weg. */
function cleanTitle(it) {
  const ramp = it.kind === 'ramp' && (it.subtitle || '').match(/^(?:Von\s+)?(?:Auffahrt auf die A\d+:\s*)?AS\s+(.+?)\s*(?:\(aus Richtung\s+(.+?)\))?\s*nach\s+(A\s?\d+)/i);
  if (ramp) return `Auffahrt ${ramp[1]} auf die ${ramp[3].replace(/\s/, '')}${ramp[2] ? ` (aus Richtung ${ramp[2]})` : ''}`;
  const t = it.title.replace(/^A\d+\s*\|\s*/, '').replace(/^A\d+\s+/, '').replace(/\b[A-Z]{2}_\d{4}-\S+\s*/g, '').replace(/_/g, ' ').replace(/ - /g, ' – ').trim();
  return t || it.title;
}
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
export function incidentPopup(it) {
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
    h('div', { class: 'incident-status active' }, detourText(d)));
}

// ---------- Umleitungen ----------

const fmtMin = (m) => `${Math.round(m)} min`;
const fmtPlus = (v, fmt) => (Math.abs(v) < 0.05 ? '±0' : `${v > 0 ? '+' : '−'}${fmt(Math.abs(v))}`);
const SUGG_COLORS = ['#7c3aed', '#0891b2', '#db2777', '#65a30d', '#ca8a04'];
const isoDay = (d) => (d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` : null);
const fmtDay = (iso) => `${fmtDate(iso)}${iso.slice(0, 4)}`;

let pending = null; // angetippte Ausweichroute: { key, from, until }

/** Vorschlag fürs Enddatum: voraussichtliches Ende der Sperrung, sonst in 4 Wochen (nie in der Vergangenheit). */
function endSuggestion(from, expected) {
  const today = todayIso();
  const min = from > today ? from : today;
  if (expected && expected >= min) return expected;
  const d = new Date(`${min}T12:00:00`);
  d.setDate(d.getDate() + 28);
  return isoDay(d);
}

/** Zeitraum: gilt ab (auch rückwirkend) – gilt bis – ohne Enddatum. */
function dateRange(r, onChange, fallbackUntil) {
  const today = todayIso();
  return h('div', { class: 'date-range' },
    h('div', { class: 'row gap detour-dates' },
      h('label', { class: 'field' }, 'Gilt ab', h('input', { type: 'date', value: r.from, onchange: (e) => e.target.value && onChange({ ...r, from: e.target.value }) })),
      h('label', { class: 'field' }, 'Gilt bis', r.until
        ? h('input', { type: 'date', value: r.until, min: r.from, onchange: (e) => e.target.value && onChange({ ...r, until: e.target.value }) })
        : h('span', { class: 'date-open' }, 'ohne Enddatum'))),
    h('label', { class: 'switch-row date-switch' }, h('span', {}, 'Ohne Enddatum (bis ich sie beende)'),
      h('input', { type: 'checkbox', class: 'switch', checked: !r.until, onchange: (e) => onChange({ ...r, until: e.target.checked ? null : endSuggestion(r.from, fallbackUntil) }) })),
    r.from < today ? h('p', { class: 'hint small warn' }, `Gilt rückwirkend ab ${fmtDay(r.from)} – die Kosten dieser Fahrten werden neu berechnet (auch bei schon bezahlten Wochen).`) : null);
}

/** Welche Route fahrt ihr? Normale Strecke, eure Umleitung(en) und die gefundenen Ausweichrouten. */
function routeChoice(dir, c, admin) {
  const today = todayIso();
  const saved = (state.detours || []).filter((d) => (d.dir === dir || d.dir === 'both') && d.use !== false && (!d.until || d.until >= today))
    .sort((a, b) => (a.from || '').localeCompare(b.from || ''));
  const current = saved.find((d) => !d.from || d.from <= today);
  const sg = c.suggestions();
  const sug = sg && sg.dir === dir && !sg.loading ? sg : null;
  const fmtV = (v) => (v ? `${fmtKm(v.km)} · ${fmtDuration(v.min * 60)}` : null);
  const fmtX = (km, min) => `${fmtPlus(km, fmtKm)} · ${fmtPlus(min, fmtMin)}`;

  const row = ({ on, badge, title, sub, nums, extra, onPick, below }) => h('div', {
    class: `list-row variant-row ${on ? 'on' : ''} ${onPick ? 'pickable' : ''}`, role: onPick ? 'button' : null, tabindex: onPick ? '0' : null,
    onclick: onPick || null, onkeydown: onPick ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPick(); } } : null,
  },
  badge || h('span', { class: `variant-radio ${on ? 'on' : ''}` }, on ? icon('check', { size: 13 }) : null),
  h('span', { class: 'grow' },
    h('span', { class: 'title' }, title),
    sub ? h('span', { class: 'sub' }, sub) : null,
    h('span', { class: 'variant-nums' }, nums ? h('span', {}, nums) : h('span', { class: 'muted' }, 'wird berechnet …'), extra ? h('span', { class: 'variant-extra' }, extra) : null),
    below || null),
  on ? h('span', { class: 'variant-tag' }, 'wird gefahren') : null);

  const rows = [row({
    on: !current, title: 'Normale Strecke', nums: fmtV(c.variantInfo(dir, null)),
    onPick: admin && current ? () => { if (confirm('Ab heute wieder die normale Strecke fahren?\n\nBisherige Fahrten behalten ihre Umleitung.')) safe(() => { normalRouteFromToday(dir); c.refreshRoute(); }); } : null,
  })];

  for (const d of saved) {
    const v = c.variantInfo(dir, d);
    rows.push(row({
      on: d === current, title: `über ${d.place}`,
      sub: d.from > today ? `ab ${fmtDay(d.from)}${d.until ? ` bis ${fmtDay(d.until)}` : ''}` : `seit ${fmtDay(d.from)} · ${d.until ? `bis ${fmtDay(d.until)}` : 'ohne Enddatum'}`,
      nums: fmtV(v), extra: v ? fmtX(v.extraKm, v.extraMin) : null,
      below: admin ? h('div', { class: 'detour-edit', onclick: (e) => e.stopPropagation() },
        dateRange({ from: d.from, until: d.until }, (r) => safe(() => { setDetourDates(d.id, r); c.refreshRoute(); }), d.until || d.expectedUntil),
        h('button', {
          type: 'button', class: 'link small danger',
          onclick: () => { if (confirm(`Umleitung über ${d.place} löschen?\n\nSie gilt dann auch für die bisherigen Fahrten nicht mehr.`)) safe(() => { deleteDetour(d.id); c.refreshRoute(); }); },
        }, 'Umleitung löschen')) : null,
    }));
  }

  (sug?.list || []).forEach((x, k) => {
    const key = `${dir}:${k}`;
    const open = pending?.key === key;
    const def = { from: sug.closure?.from && sug.closure.from < today ? sug.closure.from : today, until: sug.closure?.until && sug.closure.until >= today ? sug.closure.until : null };
    rows.push(row({
      on: false, badge: h('span', { class: 'sugg-pin', style: { background: SUGG_COLORS[k % SUGG_COLORS.length] } }, String(k + 1)),
      title: `über ${x.place}`, nums: `${fmtKm(x.km)} · ${fmtDuration(x.min * 60)}`, extra: fmtX(x.extraKm, x.extraMin),
      onPick: admin && !open ? () => { pending = { key, ...def }; c.map.fitLines([x.coords]); update(() => {}); } : null,
      below: open ? h('div', { class: 'detour-edit', onclick: (e) => e.stopPropagation() },
        dateRange(pending, (r) => { pending = { ...pending, ...r }; update(() => {}); }, def.until),
        h('div', { class: 'row gap' },
          h('button', {
            type: 'button', class: 'btn btn-primary',
            onclick: () => safe(() => {
              applyDetour({ dir, lat: x.lat, lng: x.lng, bearing: x.bearing, label: x.label, place: x.place, note: sug.closure?.title ? 'Umfahrung der Sperrung' : '', from: pending.from, until: pending.until, expectedUntil: sug.closure?.until });
              pending = null;
              c.clearSuggestions();
              c.refreshRoute();
              toast(`Ihr fahrt über ${x.place}`, 'ok');
            }),
          }, 'Diese Route fahren'),
          h('button', { type: 'button', class: 'btn', onclick: () => { pending = null; update(() => {}); } }, 'Abbrechen'))) : null,
    }));
  });
  return h('div', { class: 'list' }, rows);
}

/** Gemeldete Sperrungen auf der gewählten Richtung (gilt jetzt oder in den nächsten 3 Tagen). */
function closuresOn(c, dir) {
  const t = c.traffic();
  const soon = Date.now() + 3 * 864e5;
  return (t[dir] || []).filter((it) => {
    if (!isClosure(it)) return false;
    const st = timeStatus(it.times);
    return st.state !== 'upcoming' || (st.from && st.from.getTime() < soon);
  });
}

/** Roter Hinweis oben: Sperrung auf eurer Strecke – führt die gefahrene Route hindurch? */
function closureBanner(c) {
  const dir = c.routeDir();
  const list = closuresOn(c, dir);
  if (!list.length) return null;
  const route = c.displayRoute(dir);
  const normal = c.displayRoute(dir, []);
  const chosen = (state.detours || []).find((d) => (d.dir === dir || d.dir === 'both') && d.use !== false && (!d.until || d.until >= todayIso()) && (!d.from || d.from <= todayIso()));
  const admin = isAdmin();
  const sg = c.suggestions();
  const searching = sg?.loading && sg.dir === dir;
  const rows = list.map((it) => {
    const zone = { coords: it.shown || it.coords, title: cleanTitle(it), from: isoDay(it.times.start), until: isoDay(it.times.end || it.times.overallEnd) };
    const passes = !!route?.coords && usesClosure(route.coords, zone);
    const normalPasses = !!normal?.coords && usesClosure(normal.coords, zone);
    return { it, zone, passes, avoided: !passes && normalPasses };
  }).filter((x) => x.passes || x.avoided); // nur Sperrungen, die uns wirklich betreffen
  if (!rows.length) return null;
  const bad = rows.some((x) => x.passes);
  return h('section', { class: `card closure-card ${bad ? '' : 'ok'}` }, rows.map(({ it, zone, passes }) => {
    return h('div', { class: 'closure-item' },
      h('div', { class: 'closure-head' }, icon(passes ? 'octagon-x' : 'check', { size: 20 }), h('strong', {}, passes ? `Sperrung auf eurer ${DIR_TEXT[dir]}` : `Sperrung umfahren · ${DIR_TEXT[dir]}`)),
      h('div', { class: 'closure-title' }, cleanTitle(it), h('span', { class: 'muted' }, ` · ${it.road}`)),
      it.subtitle && it.kind !== 'ramp' ? h('div', { class: 'muted small' }, it.subtitle.includes('->') ? `Richtung ${arrow(it.subtitle)}` : it.subtitle) : null,
      h('div', { class: 'closure-when' }, statusText(it)),
      passes
        ? [h('p', { class: 'closure-note' }, 'Eure Route führt durch diese Sperrung.'),
          admin ? h('button', { type: 'button', class: 'btn btn-primary', disabled: !!searching, onclick: () => c.findDetours(dir, zone) },
            icon('route', { size: 17 }), searching ? `Ausweichrouten werden berechnet … ${sg.total ? `${Math.round((sg.done / sg.total) * 100)} %` : ''}` : 'Ausweichrouten anzeigen')
            : h('p', { class: 'hint small' }, 'Der Admin kann eine Ausweichroute auswählen.')]
        : h('p', { class: 'closure-ok' }, icon('check', { size: 15 }), chosen ? `Ihr umfahrt die Sperrung über ${chosen.place}.` : 'Eure Route fährt an der Sperrung vorbei.'));
  }));
}

function detoursCard(c) {
  const admin = isAdmin();
  const today = todayIso();
  const dir = c.routeDir();
  const hasSaved = (state.detours || []).some((d) => (d.dir === dir || d.dir === 'both') && d.use !== false && (!d.until || d.until >= today));
  const sg = c.suggestions();
  const sug = sg && sg.dir === dir ? sg : null;
  if (!hasSaved && !sug) return null;
  return h('section', { class: 'card', id: 'detours' },
    h('h2', {}, `Route · ${DIR_TEXT[dir]}`),
    sug && !sug.loading && sug.list.length && admin ? h('p', { class: 'hint small', style: { marginTop: 0 } }, 'Alle Vorschläge fahren an der Sperrung vorbei. Tippe die Route an, die ihr fahrt, und wähle, ab wann und bis wann sie gilt.') : null,
    routeChoice(dir, c, admin),
    sug?.loading ? h('p', { class: 'hint' }, `Ausweichrouten werden berechnet … ${sug.total ? `${Math.round((sug.done / sug.total) * 100)} %` : ''}`) : null,
    sug && !sug.loading && sug.error ? h('p', { class: 'callout' }, `Keine Ausweichrouten gefunden: ${sug.error}.`) : null,
    sug && !sug.loading && !sug.error && !sug.list.length ? h('p', { class: 'callout' }, 'Keine Umfahrung gefunden.') : null,
    admin && sug && !sug.loading ? h('button', { type: 'button', class: 'btn btn-small', style: { marginTop: '.6rem' }, onclick: () => { pending = null; c.clearSuggestions(); } }, 'Vorschläge ausblenden') : null,
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

  if (hasRoute) el.append(...[closureBanner(c), directionCard(c), detoursCard(c), trafficCard(c)].filter(Boolean));
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
      pickups.length ? orderList(pickups, move) : h('p', { class: 'hint' }, 'Noch keine Abholadressen. Mitfahrer tragen ihre Adresse selbst ein (oder du unter Profil → Mitfahrer).'),
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

  if (driver?.address?.lat && state.destination?.lat) el.append(...[closureBanner(c), directionCard(c), detoursCard(c), trafficCard(c)].filter(Boolean));
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
  const admin = isAdmin();
  const sub = ['single', 'fuel'].includes(state.ui.routeSub) && (state.ui.routeSub !== 'fuel' || admin) ? state.ui.routeSub : 'route';
  const back = (label) => h('button', { type: 'button', class: 'back-link', onclick: () => update((s) => { s.ui.routeSub = 'route'; }) }, icon('chevron-left', { size: 18 }), label);
  if (sub === 'single') { el.append(back('Unsere Strecke')); renderSingleTrip(el, c); }
  else if (sub === 'fuel') { el.append(back('Unsere Strecke')); el.append(...[priceCard(c.map), costCard(), timeCard()].filter(Boolean)); }
  else if (!admin) memberRouteView(el, c);
  else adminRouteView(el, c);
  if (sub === 'route') {
    el.append(h('div', { class: 'list' },
      h('button', { type: 'button', class: 'list-row has-sq', onclick: () => update((s) => { s.ui.routeSub = 'single'; }) },
        h('span', { class: 'sq sq-indigo' }, icon('navigation', { size: 15 })),
        h('span', { class: 'grow' }, h('span', { class: 'title' }, 'Einzelfahrt berechnen'), h('span', { class: 'sub' }, 'Was kostet eine Fahrt, wie viel Sprit braucht sie?')),
        h('span', { class: 'chev' }, icon('chevron-right', { size: 18 }))),
      admin ? h('button', { type: 'button', class: 'list-row has-sq', onclick: () => update((s) => { s.ui.routeSub = 'fuel'; }) },
        h('span', { class: 'sq sq-orange' }, icon('fuel', { size: 15 })),
        h('span', { class: 'grow' }, h('span', { class: 'title' }, 'Spritpreis & Tankstellen'), h('span', { class: 'sub' }, 'Preise an der Strecke, beste Tankzeit')),
        h('span', { class: 'chev' }, icon('chevron-right', { size: 18 }))) : null));
  }
  if (!state.ui.showMap) el.append(h('button', { type: 'button', class: 'btn', onclick: c.toggleMap }, icon('map', { size: 18 }), 'Karte einblenden'));
}
