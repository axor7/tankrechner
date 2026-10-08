// Bildschirm „Strecke“ (aus „Gruppe“): Karte mit Hin- oder Rückfahrt, Sperrungen und Umleitung, die Halte in Reihenfolge.
// Admins legen hier Ziel, Start und Reihenfolge fest und wählen bei einer Sperrung die Ausweichroute.
import { state, update, model, personById, todayIso } from '../state.js';
import { effectiveOrder, isActive } from '../model.js';
import { isAdmin } from '../account.js';
import { adminSet, setAddress, applyDetour, setDetourDates, deleteDetour, normalRouteFromToday } from '../actions.js';
import { isClosure, statusText, cleanTitle } from '../traffic.js';
import { routeDir, displayRoute, routeInfo, variantInfo, findDetours, clearSuggestions, getSuggestions, getTraffic, loadTraffic, refreshRoute, relevantClosures } from '../engine.js';
import { addressInput } from '../address.js';
import { h, icon, header, section, list, card, row, switchRow, seg, btn, note, field, avatar, attempt, toast } from '../kit.js';
import { nameOf, shortLabel } from '../plan.js';
import { fmtKm, fmtDuration, fmtDate } from '../ui.js';

const DIR = { hin: 'Hinfahrt', rueck: 'Rückfahrt' };
const ui = { edit: false, pending: null, showAll: false };
let hooks = { focusIncident: () => {}, fitLines: () => {}, fitRoute: () => {} };
export function setRouteHooks(h2) { hooks = { ...hooks, ...h2 }; }

const plus = (v, unit) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(unit === 'km' ? 1 : 0).replace('.', ',')} ${unit}`;

/** Aktive (oder kommende) Umleitungen dieser Richtung, sortiert. */
const savedDetours = (dir) => (state.detours || []).filter((d) => (d.dir === dir || d.dir === 'both') && d.use !== false && (!d.until || d.until >= todayIso()))
  .sort((a, b) => (a.from || '').localeCompare(b.from || ''));

// ---------- Zeitraum einer Umleitung ----------

function dateRange(r, onChange) {
  return h('div', { class: 'stack' },
    h('div', { class: 'two' },
      field('Gilt ab', h('input', { type: 'date', value: r.from, onchange: (e) => e.target.value && onChange({ ...r, from: e.target.value }) })),
      r.until ? field('Gilt bis', h('input', { type: 'date', value: r.until, min: r.from, onchange: (e) => e.target.value && onChange({ ...r, until: e.target.value }) })) : field('Gilt bis', h('span', { class: 'fake-input' }, 'offen'))),
    list(switchRow({ title: 'Ohne Enddatum', checked: !r.until, onChange: (v) => onChange({ ...r, until: v ? null : (r.fallback && r.fallback >= r.from ? r.fallback : r.from) }) })),
    r.from < todayIso() ? note(`Gilt rückwirkend ab ${fmtDate(r.from)} – diese Fahrten werden neu berechnet.`) : null);
}

// ---------- Sperrung & Umleitung ----------

function closureCard(dir, x, admin) {
  const sg = getSuggestions();
  const mineSg = sg && sg.dir === dir ? sg : null;
  const saved = savedDetours(dir);
  const today = todayIso();
  const current = saved.find((d) => !d.from || d.from <= today);
  const v = current ? variantInfo(dir, current) : null;
  const body = [];
  if (current) {
    body.push(row({ lead: h('span', { class: 'dot-ic good' }, icon('check', { size: 14 })), title: `Ihr fahrt über ${current.place}`,
      sub: [v ? `${plus(v.extraKm, 'km')} · ${plus(v.extraMin, 'min')}` : null, current.until ? `bis ${fmtDate(current.until)}` : 'ohne Enddatum'].filter(Boolean).join(' · ') }));
    if (admin) {
      body.push(ui.pending?.edit === current.id
        ? h('div', { class: 'inset' }, dateRange(ui.pending, (r) => { ui.pending = { ...ui.pending, ...r }; update(() => {}); }),
          h('div', { class: 'two' },
            btn('Speichern', { kind: 'primary', full: true, onClick: () => attempt(() => { setDetourDates(current.id, ui.pending); ui.pending = null; refreshRoute(); }) }),
            btn('Abbrechen', { kind: 'plain', full: true, onClick: () => { ui.pending = null; update(() => {}); } })))
        : h('div', { class: 'two' },
          btn('Zeitraum', { kind: 'tinted', full: true, onClick: () => { ui.pending = { edit: current.id, from: current.from, until: current.until, fallback: current.expectedUntil || x.zone.until }; update(() => {}); } }),
          btn('Wieder normal', { kind: 'plain', full: true, onClick: () => { if (confirm('Ab heute wieder die normale Strecke fahren? Bisherige Fahrten behalten die Umleitung.')) attempt(() => { normalRouteFromToday(dir); refreshRoute(); }); } })));
      body.push(h('button', { type: 'button', class: 'link-btn danger', onclick: () => { if (confirm(`Umleitung über ${current.place} löschen? Sie gilt dann auch rückwirkend nicht mehr.`)) attempt(() => { deleteDetour(current.id); refreshRoute(); }); } }, 'Umleitung ganz löschen'));
    }
  } else if (x.passes) {
    body.push(note('Eure Route führt durch die Sperrung.'));
    if (admin) {
      if (mineSg?.loading) body.push(note(`Ausweichrouten werden gesucht … ${mineSg.total ? `${Math.round((mineSg.done / mineSg.total) * 100)} %` : ''}`));
      else if (!mineSg) body.push(btn('Ausweichroute wählen', { kind: 'primary', full: true, ic: 'route', onClick: () => findDetours(dir, x.zone) }));
    }
  }
  // Gefundene Ausweichrouten
  if (admin && mineSg && !mineSg.loading) {
    if (mineSg.error || !mineSg.list.length) body.push(note(mineSg.error ? `Keine Ausweichroute gefunden: ${mineSg.error}` : 'Keine Ausweichroute gefunden.'));
    const COLORS = ['#7c3aed', '#0891b2', '#db2777', '#65a30d', '#ca8a04'];
    body.push(list(...mineSg.list.map((s, k) => {
      const key = `${dir}:${k}`;
      const open = ui.pending?.key === key;
      return h('div', {},
        row({
          lead: h('span', { class: 'num-dot', style: { background: COLORS[k % COLORS.length] } }, String(k + 1)),
          title: `über ${s.place}`, sub: `${plus(s.extraKm, 'km')} · ${plus(s.extraMin, 'min')} (${fmtKm(s.km)} · ${fmtDuration(s.min * 60)})`, chevron: false,
          onClick: () => { ui.pending = { key, from: x.zone.from && x.zone.from < todayIso() ? x.zone.from : todayIso(), until: x.zone.until && x.zone.until >= todayIso() ? x.zone.until : null, fallback: x.zone.until }; hooks.fitLines([s.coords]); update(() => {}); },
        }),
        open ? h('div', { class: 'inset' }, dateRange(ui.pending, (r) => { ui.pending = { ...ui.pending, ...r }; update(() => {}); }),
          btn('Diese Route fahren', {
            kind: 'primary', full: true,
            onClick: () => attempt(() => {
              applyDetour({ dir, lat: s.lat, lng: s.lng, bearing: s.bearing, label: s.label, place: s.place, note: 'Umfahrung der Sperrung', from: ui.pending.from, until: ui.pending.until, expectedUntil: x.zone.until });
              ui.pending = null; clearSuggestions(); refreshRoute(); toast(`Ihr fahrt über ${s.place}`, 'ok');
            }),
          })) : null);
    })));
    body.push(h('button', { type: 'button', class: 'link-btn', onclick: () => { ui.pending = null; clearSuggestions(); } }, 'Vorschläge schließen'));
  }
  return h('div', { class: `card closure ${x.passes ? 'bad' : 'ok'}` },
    h('div', { class: 'closure-head', role: 'button', onclick: () => hooks.focusIncident(x.it) },
      icon(x.passes ? 'octagon-x' : 'check', { size: 20 }),
      h('div', {}, h('strong', {}, `Gesperrt: ${cleanTitle(x.it)}`), h('span', {}, `${x.it.road} · ${statusText(x.it)}`))),
    ...body);
}

// ---------- Halte ----------

function stopsSection(dir, admin) {
  const persons = model().persons.filter(isActive);
  const driver = personById(state.defaultDriver);
  const pickups = effectiveOrder(state, persons);
  const back = state.returnOrder?.length ? [...state.returnOrder.filter((id) => pickups.includes(id)), ...[...pickups].reverse().filter((id) => !state.returnOrder.includes(id))] : [...pickups].reverse();
  const seq = dir === 'rueck' ? back : pickups;
  const noAddr = persons.filter((p) => p.id !== state.defaultDriver && !p.address?.lat);
  const move = (k, d) => {
    const o = [...seq];
    [o[k], o[k + d]] = [o[k + d], o[k]];
    attempt(() => adminSet((s) => { if (dir === 'rueck') s.returnOrder = o; else s.order = o; }, `${DIR[dir]}: ${o.map(nameOf).join(' → ')}`));
    refreshRoute();
  };
  const destRow = row({ lead: h('span', { class: 'dot-ic' }, icon('flag', { size: 14 })), title: shortLabel(state.destination?.label) || 'Ziel', sub: dir === 'rueck' ? 'Start' : 'Ziel' });
  const startRow = row({ lead: avatar(driver?.id, 'm'), title: driver?.name || 'Fahrer', sub: dir === 'rueck' ? 'Ende' : 'Start' });
  const rows = seq.map((pid, k) => row({
    lead: avatar(pid, 'm'), title: nameOf(pid), sub: shortLabel(personById(pid)?.address?.label),
    trail: admin && ui.edit ? h('span', { class: 'row-inline' },
      h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Früher', disabled: k === 0, onclick: () => move(k, -1) }, icon('arrow-up', { size: 17 })),
      h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Später', disabled: k === seq.length - 1, onclick: () => move(k, 1) }, icon('arrow-down', { size: 17 }))) : null,
  }));
  return section('Halte', h('div', { class: 'stack' },
    list(dir === 'rueck' ? destRow : startRow, ...rows, dir === 'rueck' ? startRow : destRow),
    noAddr.length ? note(`Ohne Adresse (steigen beim Fahrer zu): ${noAddr.map((p) => p.name).join(', ')}`) : null,
    admin && ui.edit ? h('div', { class: 'stack' },
      field('Ziel', addressInput({ value: state.destination, near: driver?.address, focusKey: 'route-dest', onSelect: (a) => a && attempt(() => adminSet((s) => { s.destination = a; }, `Ziel: ${a.label}`)) })),
      field(`Start (${driver?.name || 'Fahrer'})`, addressInput({ value: driver?.address, allowLocate: true, focusKey: 'route-start', onSelect: (a) => a && attempt(() => setAddress(state.defaultDriver, a)) })),
      (dir === 'hin' ? state.order?.length : state.returnOrder?.length)
        ? btn(dir === 'hin' ? 'Beste Reihenfolge berechnen' : 'Wie Hinfahrt, umgekehrt', { kind: 'tinted', full: true, ic: 'sparkles',
          onClick: () => { attempt(() => adminSet((s) => { if (dir === 'hin') s.order = null; else s.returnOrder = null; }, `${DIR[dir]}: Reihenfolge automatisch`)); refreshRoute(true); } }) : null) : null),
  { action: admin ? h('button', { type: 'button', class: 'link-btn', onclick: () => { ui.edit = !ui.edit; update(() => {}); } }, ui.edit ? 'Fertig' : 'Ändern') : null });
}

// ---------- Meldungen (Baustellen) ----------

function incidents(dir) {
  const t = getTraffic();
  if (!t.ready) return null;
  const items = (t[dir] || []).filter((it) => !isClosure(it));
  if (!items.length) return null;
  const show = ui.showAll ? items : items.slice(0, 3);
  return section('Baustellen', h('div', { class: 'stack' },
    list(...show.map((it) => row({
      lead: h('span', { class: `dot-ic ${it.kind === 'short' ? 'warn' : 'works'}` }, icon(it.kind === 'short' ? 'traffic-cone' : 'construction', { size: 14 })),
      title: cleanTitle(it), sub: `${it.road} · ${statusText(it)}`, onClick: () => hooks.focusIncident(it), chevron: false,
    }))),
    items.length > 3 ? h('button', { type: 'button', class: 'link-btn', onclick: () => { ui.showAll = !ui.showAll; update(() => {}); } }, ui.showAll ? 'Weniger' : `Alle ${items.length} zeigen`) : null),
  { foot: 'Nur Autobahnen (Autobahn GmbH des Bundes).' });
}

// ---------- Bildschirm ----------

export function renderRoute(el) {
  const admin = isAdmin();
  const dir = routeDir();
  const back = { label: 'Gruppe', onClick: () => update((s) => { s.ui.screen = 'group'; }) };
  const driver = personById(state.defaultDriver);
  el.append(header({ title: 'Strecke', back }));
  if (!driver?.address?.lat || !state.destination?.lat) {
    el.append(card(
      h('strong', {}, 'Noch keine Route'),
      note(`Es fehlt ${!state.destination?.lat ? 'das Ziel' : `die Startadresse von ${driver?.name || 'dem Fahrer'}`}.`),
      admin ? field('Ziel', addressInput({ value: state.destination, focusKey: 'route-dest', onSelect: (a) => a && attempt(() => adminSet((s) => { s.destination = a; }, `Ziel: ${a.label}`)) })) : null,
      admin ? field('Start', addressInput({ value: driver?.address, allowLocate: true, focusKey: 'route-start', onSelect: (a) => a && attempt(() => setAddress(state.defaultDriver, a)) })) : null,
      admin ? field('Bis dahin: km pro Fahrt', h('input', { type: 'number', min: 0, step: 0.1, inputmode: 'decimal', value: state.manualKm ?? '', onchange: (e) => attempt(() => adminSet((s) => { s.manualKm = e.target.value === '' ? null : Number(e.target.value); }, `km pro Fahrt: ${e.target.value}`)) })) : null));
    return;
  }
  const r = displayRoute(dir);
  const info = routeInfo(dir);
  loadTraffic();
  const det = savedDetours(dir).find((d) => !d.from || d.from <= todayIso());
  el.append(
    state.roundTrip !== false ? seg([['hin', 'Hinfahrt'], ['rueck', 'Rückfahrt']], dir, (v) => { update((s) => { s.ui.routeDir = v; }); setTimeout(() => hooks.fitRoute(), 60); }) : null,
    h('div', { class: 'route-sum' },
      h('strong', {}, r ? `${fmtKm(r.distance / 1000)} · ${fmtDuration(r.duration)}` : 'wird berechnet …'),
      det ? h('span', {}, `mit Umleitung über ${det.place}${info?.baseDistance && r ? ` (${plus((r.distance - info.baseDistance) / 1000, 'km')})` : ''}`) : h('span', {}, 'wenn alle mitfahren')),
    ...relevantClosures(dir).map((x) => closureCard(dir, x, admin)),
    stopsSection(dir, admin),
    incidents(dir) || h('span'),
  );
}

