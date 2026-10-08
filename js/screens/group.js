// Bildschirm „Gruppe“: du selbst, die Mitfahrer und alles, was man selten einstellt – als eine flache Liste.
// Jede Zeile öffnet genau ein Fenster; Mitfahrer ohne Admin-Rechte sehen die Werte nur.
import { state, update, model, personById, persons, todayIso, effectivePrice } from '../state.js';
import { FUELS } from '../calc.js';
import { isActive, driverPlanAt } from '../model.js';
import { paypalUser } from '../pay.js';
import { inGroup, isAdmin, isLoggedIn, groupName, claims, members, myUserId, myName, myEmail, myGroups, setRole, removeMember, loadLog, inviteLink, inviteCode, renewInvite, newClaims, ackClaim, openGroup, leaveGroup, workLocally, signOut, createGroup, joinWith } from '../account.js';
import { me, setAddress, setPaypal, setMyName, addPerson, removePerson, setPersonField, adminSet, setDriverInfo, setDriverPlan, addOffPeriod, removeOffPeriod, setFreeDays } from '../actions.js';
import { applyPriceMode, sortedStations, liveFuel, loadStations, stationsLoading, stationSelected, bestFuelTime } from '../fuel.js';
import { data } from '../engine.js';
import { addressInput } from '../address.js';
import { qrCode } from '../qr.js';
import { formatVersion, loadedVersion } from '../version.js';
import { h, icon, header, section, list, row, switchRow, seg, btn, note, banner, field, avatar, noApp, isPlaceholder, registerSheet, openSheet, closeSheet, sheet, attempt, toast, copyText, shareText } from '../kit.js';
import { rhythmEditor, absenceEditor } from './rides.js';
import { nameOf, shortLabel, rhythmText, absenceText, upcomingFree, span } from '../plan.js';
import { fmtPrice } from '../ui.js';

const rerender = () => update(() => {});
const carText = (c) => `${String(c.consumption).replace('.', ',')} l/100 km · ${FUELS[c.fuel]?.label || ''}`;

const STATES = [['DE-BW', 'Baden-Württemberg'], ['DE-BY', 'Bayern'], ['DE-BE', 'Berlin'], ['DE-BB', 'Brandenburg'], ['DE-HB', 'Bremen'], ['DE-HH', 'Hamburg'],
  ['DE-HE', 'Hessen'], ['DE-MV', 'Mecklenburg-Vorpommern'], ['DE-NI', 'Niedersachsen'], ['DE-NW', 'Nordrhein-Westfalen'], ['DE-RP', 'Rheinland-Pfalz'],
  ['DE-SL', 'Saarland'], ['DE-SN', 'Sachsen'], ['DE-ST', 'Sachsen-Anhalt'], ['DE-SH', 'Schleswig-Holstein'], ['DE-TH', 'Thüringen']];
const stateName = (c) => STATES.find(([k]) => k === c)?.[1] || c;

function driverText() {
  const v = driverPlanAt(state, todayIso());
  if (v?.mode === 'weekday') return 'je Wochentag';
  if (v?.mode === 'rotate') return `abwechselnd: ${v.ids.map(nameOf).join(', ')}`;
  return nameOf(v?.id || state.defaultDriver);
}

function freeText() {
  const hol = state.holidays || {};
  const parts = [hol.enabled ? 'Schulferien' : null, hol.public?.enabled ? 'Feiertage' : null, (state.offPeriods || []).length ? 'eigene' : null].filter(Boolean);
  return parts.length ? parts.join(', ') : 'keine';
}

// ---------- Bildschirm ----------

function claimNotices() {
  return newClaims().map((c) => banner({
    tone: 'good', ic: 'user-plus',
    title: c.self ? `${nameOf(c.personId)} ist neu dabei` : `${nameOf(c.personId)} ist jetzt mit der App dabei`,
    text: `Konto: ${c.name}`,
    buttons: [
      btn('Passt', { kind: 'primary', small: true, onClick: () => ackClaim(c.userId) }),
      btn('Rückgängig', { kind: 'plain', small: true, onClick: () => { if (confirm(`${c.name} aus der Gruppe entfernen? Der Platz „${nameOf(c.personId)}“ ist dann wieder frei.`)) attempt(async () => { await removeMember(c.userId); ackClaim(c.userId); }); } }),
    ],
  }));
}

export function renderGroup(el) {
  const admin = isAdmin();
  const mine = me();
  const myP = personById(mine);
  const others = persons().filter((p) => isActive(p) && p.id !== mine);
  const canInvite = admin && inGroup();
  el.append(
    header({ title: groupName() || 'Gruppe', sub: inGroup() ? `${others.length + 1} Personen` : 'Nur auf diesem Gerät',
      action: canInvite ? btn('Einladen', { kind: 'primary', small: true, ic: 'user-plus', onClick: () => openSheet('invite') }) : null }),
    ...claimNotices(),
    myP ? list(row({ lead: avatar(mine, 'l'), title: myP.name, sub: myP.address?.label ? shortLabel(myP.address.label) : 'Adresse fehlt', cls: 'me-row', onClick: () => openSheet('me') })) : h('span'),
    section('Mitfahrer', list(
      ...others.map((p) => row({
        lead: avatar(p.id, 'm'), title: h('span', {}, p.name, ' ', noApp(p.id)),
        sub: [p.id === state.defaultDriver ? 'Fahrer' : null, absenceText(p) || rhythmText(p)].filter(Boolean).join(' · '),
        onClick: admin ? () => openSheet('person', { pid: p.id }) : null,
      })),
      admin ? addPersonRow() : null,
      !others.length && !admin ? row({ title: 'Noch niemand' }) : null,
    ), { foot: !inGroup() && admin ? 'Mitfahrer ohne App: du trägst für sie ein und hakst Zahlungen ab. Zum Einladen unten ein Konto anlegen.' : null }),
    section('Fahrt', list(
      row({ title: 'Strecke', value: state.destination ? shortLabel(state.destination.label) : 'festlegen', onClick: () => update((s) => { s.ui.screen = 'route'; }) }),
      row({ title: 'Uhrzeiten', value: state.times?.arrive ? `an ${state.times.arrive}${state.roundTrip !== false && state.times.leave ? ` · zurück ${state.times.leave}` : ''}` : 'festlegen', onClick: admin ? () => openSheet('times') : null }),
      row({ title: 'Wer fährt', value: driverText(), onClick: () => openSheet('drivers') }),
      row({ title: 'Fahrfrei', value: freeText(), onClick: () => openSheet('free') }),
    )),
    section('Kosten', list(
      row({ title: 'Auto & Sprit', value: `${carText(state.car)} · ${fmtPrice(effectivePrice())}`, onClick: admin ? () => openSheet('car') : null }),
      row({ title: 'Aufteilung', value: state.split.mode === 'segment' ? 'nach Strecke' : 'gleich pro Fahrt', onClick: admin ? () => openSheet('split') : null }),
    )),
    section(null, list(
      row({ title: isLoggedIn() ? 'Konto' : 'Anmelden', value: isLoggedIn() ? myName() : 'gemeinsam nutzen', onClick: () => (isLoggedIn() ? openSheet('account') : update((s) => { s.ui.flow = 'login'; })) }),
      inGroup() && admin ? row({ title: 'Mitglieder & Rechte', onClick: () => openSheet('members') }) : null,
      admin ? row({ title: 'Verlauf', sub: 'Wer hat was geändert', onClick: () => openSheet('log') }) : null,
      row({ title: 'Daten & Infos', onClick: () => openSheet('about') }),
    )),
  );
}

function addPersonRow() {
  return row({ lead: h('span', { class: 'av av-m add' }, icon('plus', { size: 16 })), title: h('span', { class: 'link' }, 'Mitfahrer hinzufügen'), chevron: false, onClick: () => openSheet('add-person') });
}

const add = { name: '' };
registerSheet('add-person', () => {
  const save = () => {
    const name = add.name.trim();
    if (!name) return;
    attempt(() => { const pid = addPerson(name); add.name = ''; openSheet('person', { pid }); });
  };
  return sheet({
    title: 'Mitfahrer hinzufügen',
    body: [
      h('form', { onsubmit: (e) => { e.preventDefault(); save(); } },
        field('Name', h('input', { type: 'text', value: add.name, placeholder: 'z. B. Max', autocomplete: 'off', 'data-focus-key': 'add-name', 'data-autofocus': '', oninput: (e) => { add.name = e.target.value; } }))),
      note('Die Person braucht keine App. Du trägst für sie ein – und kannst sie später einladen, damit sie ihren Platz selbst übernimmt.'),
    ],
    foot: btn('Hinzufügen', { kind: 'primary', full: true, onClick: save }),
  });
});

// ---------- Ich ----------

registerSheet('me', () => {
  const mine = me();
  const p = personById(mine);
  if (!p) return null;
  const m = model();
  const main = mine === state.defaultDriver;
  const can = m.canDrive(p);
  return sheet({
    title: 'Ich',
    body: [
      field('Name', h('input', { type: 'text', value: p.name, disabled: !(p.self || isAdmin()), 'data-focus-key': 'my-name', onchange: (e) => attempt(() => setMyName(e.target.value.trim() || p.name)) })),
      field(main ? 'Startadresse' : 'Abholadresse', addressInput({ value: p.address, allowLocate: true, focusKey: 'my-addr', onSelect: (a) => attempt(() => setAddress(mine, a)) })),
      field('PayPal.me-Name', h('input', { type: 'text', value: p.paypal || '', placeholder: 'z. B. maxmuster', autocapitalize: 'off', spellcheck: false, 'data-focus-key': 'my-pp',
        onchange: (e) => attempt(() => setPaypal(mine, paypalUser(e.target.value) || e.target.value.trim())) }), 'Damit man dir mit einem Tipp bezahlen kann'),
      main ? null : list(switchRow({ title: 'Ich kann auch fahren', sub: 'Fällt der Fahrer aus, fragt dich die App', checked: can, onChange: (v) => attempt(() => setDriverInfo(mine, { drives: v })) })),
      can && !main ? carFields(mine) : null,
    ],
  });
});

/** Eigenes Auto einer Person (leer = Auto der Gruppe). */
function carFields(pid) {
  const p = personById(pid);
  const c = p?.car && Number(p.car.consumption) > 0 ? p.car : null;
  const local = { consumption: c?.consumption ?? '', fuel: c?.fuel || state.car.fuel };
  const save = () => attempt(() => setDriverInfo(pid, { car: Number(local.consumption) > 0 ? { consumption: Number(local.consumption), fuel: local.fuel } : null }));
  return h('div', { class: 'two' },
    field('Eigenes Auto: Verbrauch', h('input', { type: 'number', min: 0, step: 0.1, inputmode: 'decimal', placeholder: String(state.car.consumption).replace('.', ','), value: local.consumption, onchange: (e) => { local.consumption = e.target.value; save(); } }), 'l/100 km, leer = wie die Gruppe'),
    field('Kraftstoff', h('select', { onchange: (e) => { local.fuel = e.target.value; save(); } }, Object.entries(FUELS).map(([k, f]) => h('option', { value: k, selected: k === local.fuel }, f.label)))));
}

// ---------- Mitfahrer (Admin) ----------

const personUi = { pid: null, part: null };

registerSheet('person', ({ pid }) => {
  const p = personById(pid);
  if (!p) return null;
  if (personUi.pid !== pid) Object.assign(personUi, { pid, part: null });
  const claim = claims().get(pid);
  const m = model();
  const toggle = (part) => { personUi.part = personUi.part === part ? null : part; rerender(); };
  const part = personUi.part;
  return sheet({
    title: p.name, sub: claim ? `hat die App · ${claim.name}` : inGroup() ? 'ohne App – du trägst für diese Person ein' : null,
    body: [
      h('div', { class: 'name-color' },
        h('input', { type: 'color', value: p.color, 'aria-label': 'Farbe', onchange: (e) => attempt(() => setPersonField(pid, 'color', e.target.value)) }),
        h('input', { type: 'text', value: p.name, 'aria-label': 'Name', 'data-focus-key': `pn-${pid}`, onchange: (e) => attempt(() => setPersonField(pid, 'name', e.target.value.trim() || p.name, `Name: ${p.name} → ${e.target.value.trim()}`)) })),
      field(pid === state.defaultDriver ? 'Startadresse' : 'Abholadresse', addressInput({ value: p.address, focusKey: `pa-${pid}`, onSelect: (a) => attempt(() => setAddress(pid, a)) })),
      list(
        row({ title: 'Rhythmus', value: rhythmText(p), onClick: () => toggle('rhythm'), chevron: false, trail: icon(part === 'rhythm' ? 'chevron-down' : 'chevron-right', { size: 17 }) }),
        part === 'rhythm' ? h('div', { class: 'inset' }, rhythmEditor(pid, { onSaved: () => toggle('rhythm') })) : null,
        row({ title: 'Abwesend', value: absenceText(p) || 'eintragen', onClick: () => toggle('absence'), chevron: false, trail: icon(part === 'absence' ? 'chevron-down' : 'chevron-right', { size: 17 }) }),
        part === 'absence' ? h('div', { class: 'inset' }, absenceEditor(pid, { onSaved: () => toggle('absence') })) : null,
        pid === state.defaultDriver ? null : switchRow({ title: 'Kann auch fahren', checked: m.canDrive(p), onChange: (v) => attempt(() => setDriverInfo(pid, { drives: v })) }),
      ),
      m.canDrive(p) && pid !== state.defaultDriver ? carFields(pid) : null,
      inGroup() && !claim ? section('Einladen', invitePersonal(pid)) : null,
      pid !== state.defaultDriver ? btn('Entfernen', {
        kind: 'danger', full: true, ic: 'trash-2',
        onClick: () => { if (confirm(`${p.name} entfernen? Vergangene Fahrten bleiben in der Abrechnung, ab heute fährt ${p.name} nicht mehr mit.`)) attempt(() => { removePerson(pid); closeSheet(); }); },
      }) : null,
    ],
  });
});

function invitePersonal(pid) {
  const p = personById(pid);
  const link = inviteLink(pid);
  return h('div', { class: 'invite' },
    qrCode(link, { onReady: rerender }),
    note(`Dieser Link gehört nur zum Platz „${p.name}“ – wer ihn öffnet, bestätigt nur noch.`),
    h('div', { class: 'two' },
      btn('Link teilen', { kind: 'primary', full: true, ic: 'share', disabled: !link, onClick: () => shareText({ title: 'Tankrechner', text: `Hi ${p.name}, hier ist dein Platz in „${groupName()}“:`, url: link }) }),
      btn('Kopieren', { kind: 'tinted', full: true, ic: 'copy', disabled: !link, onClick: () => copyText(link, 'Link kopiert') })));
}

// ---------- Einladen ----------

registerSheet('invite', () => {
  const link = inviteLink();
  const code = inviteCode();
  const open = persons().filter((p) => isActive(p) && isPlaceholder(p.id));
  return sheet({
    title: 'Einladen', sub: 'Wer den Link öffnet, den QR-Code scannt oder den Code eingibt, sucht sich seinen Namen aus.',
    body: [
      h('div', { class: 'invite' },
        qrCode(link, { onReady: rerender }),
        h('div', { class: 'code' }, code || '…'),
        h('div', { class: 'two' },
          btn('Link teilen', { kind: 'primary', full: true, ic: 'share', disabled: !link, onClick: () => shareText({ title: 'Tankrechner', text: `Komm in unsere Fahrgemeinschaft „${groupName()}“ – Code ${code}`, url: link }) }),
          btn('Code kopieren', { kind: 'tinted', full: true, ic: 'copy', disabled: !code, onClick: () => copyText(code, 'Code kopiert') }))),
      open.length ? section('Persönlich einladen', list(...open.map((p) => row({ lead: avatar(p.id, 'm'), title: p.name, sub: 'ohne App', onClick: () => openSheet('person', { pid: p.id }) })))) : null,
      btn('Neuen Code erstellen', { kind: 'plain', full: true, onClick: () => { if (confirm('Neuen Link und Code erstellen? Die alten funktionieren dann nicht mehr.')) attempt(renewInvite); } }),
    ],
  });
});

// ---------- Uhrzeiten ----------

registerSheet('times', () => {
  const d = { arrive: state.times?.arrive || '', leave: state.times?.leave || '' };
  const save = () => attempt(() => adminSet((s) => { s.times = { arrive: d.arrive, leave: d.leave }; }, `Uhrzeiten: an ${d.arrive || '–'}, zurück ab ${d.leave || '–'}`)).then((ok) => ok && closeSheet());
  return sheet({
    title: 'Uhrzeiten', sub: 'Daraus rechnet die App für jeden die Abholzeit.',
    body: [
      h('div', { class: 'two' },
        field('Ankunft am Ziel', h('input', { type: 'time', value: d.arrive, onchange: (e) => { d.arrive = e.target.value; } })),
        state.roundTrip !== false ? field('Rückfahrt ab', h('input', { type: 'time', value: d.leave, onchange: (e) => { d.leave = e.target.value; } })) : h('span')),
      list(switchRow({ title: 'Mit Rückfahrt', checked: state.roundTrip !== false, onChange: (v) => attempt(() => adminSet((s) => { s.roundTrip = v; }, `Rückfahrt ${v ? 'an' : 'aus'}`)) })),
    ],
    foot: btn('Speichern', { kind: 'primary', full: true, onClick: save }),
  });
});

// ---------- Wer fährt ----------

const drv = { open: false };
registerSheet('drivers', () => {
  const admin = isAdmin();
  const m = model();
  const people = persons().filter(isActive);
  if (!drv.open) {
    const v = driverPlanAt(state, todayIso());
    const mode = v?.mode === 'weekday' ? 'weekday' : v?.mode === 'rotate' ? 'rotate' : 'fixed';
    Object.assign(drv, { open: true, mode, id: v?.id || state.defaultDriver, ids: mode === 'weekday' ? [...v.ids] : Array(7).fill(null).map((_, i) => (i < 5 ? state.defaultDriver : null)), rot: mode === 'rotate' ? [...v.ids] : [state.defaultDriver] });
  }
  const pick = (value, onChange, none) => h('select', { class: 'mini-select', disabled: !admin, onchange: (e) => { onChange(e.target.value || null); rerender(); } },
    none ? h('option', { value: '' }, '–') : null, people.map((p) => h('option', { value: p.id, selected: p.id === value }, p.name)));
  const WD = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag'];
  const save = () => {
    const plan = drv.mode === 'weekday' ? { mode: 'weekday', ids: drv.ids } : drv.mode === 'rotate' ? { mode: 'rotate', ids: drv.rot.filter(Boolean) } : { id: drv.id };
    if (plan.mode === 'rotate' && plan.ids.length < 2) { toast('Für „abwechselnd“ mindestens zwei Fahrer', 'error'); return; }
    attempt(() => setDriverPlan(plan)).then((ok) => { if (ok) { drv.open = false; toast('Gilt ab heute', 'ok'); closeSheet(); } });
  };
  const cur = driverPlanAt(state, todayIso());
  const fixed = (id) => id === state.defaultDriver || cur?.id === id || (cur?.ids || []).includes(id);
  return sheet({
    title: 'Wer fährt', sub: admin ? 'Gilt ab heute' : null,
    body: [
      seg([['fixed', 'Immer gleich'], ['weekday', 'Je Wochentag'], ['rotate', 'Abwechselnd']], drv.mode, (v) => { drv.mode = v; rerender(); }, { disabled: !admin }),
      drv.mode === 'fixed' ? list(row({ title: 'Fahrer', trail: pick(drv.id, (v) => { drv.id = v; }) }))
        : drv.mode === 'weekday' ? list(...WD.map((d, i) => row({ title: d, trail: pick(drv.ids[i], (v) => { drv.ids[i] = v; }, true) })))
          : list(...drv.rot.map((id, k) => row({ title: k === 0 ? 'Diese Woche' : k === 1 ? 'Nächste Woche' : `In ${k} Wochen`, trail: h('span', { class: 'row-inline' }, pick(id, (v) => { drv.rot[k] = v; }),
            drv.rot.length > 1 && admin ? h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Entfernen', onclick: () => { drv.rot.splice(k, 1); rerender(); } }, icon('x', { size: 15 })) : null) })),
          admin ? h('button', { type: 'button', class: 'row add-row', onclick: () => { drv.rot.push(people.find((p) => !drv.rot.includes(p.id))?.id || people[0].id); rerender(); } }, h('span', { class: 'row-main' }, h('span', { class: 'row-title link' }, '+ weiterer Fahrer'))) : null),
      admin ? btn('Speichern', { kind: 'primary', full: true, onClick: save }) : null,
      section('Kann einspringen', list(...people.map((p) => switchRow({
        title: p.name, sub: p.car && Number(p.car.consumption) > 0 ? `eigenes Auto · ${carText(p.car)}` : null,
        checked: m.canDrive(p), disabled: !(admin || p.id === me()) || fixed(p.id), onChange: (v) => attempt(() => setDriverInfo(p.id, { drives: v })),
      }))), { foot: 'Fällt der Fahrer aus, fragt die App diese Personen.' }),
    ],
  });
});

// ---------- Fahrfrei ----------

const off = { name: '', from: '', until: '' };
registerSheet('free', () => {
  const admin = isAdmin();
  const hol = state.holidays || {};
  const next = upcomingFree(6);
  return sheet({
    title: 'Fahrfrei', sub: 'An diesen Tagen fährt nach Plan niemand. Wer trotzdem fährt, trägt den Tag ein.',
    body: [
      list(
        switchRow({ title: 'Schulferien', sub: stateName(hol.region), checked: !!hol.enabled, disabled: !admin, onChange: (v) => attempt(() => setFreeDays('school', v)) }),
        switchRow({ title: 'Feiertage', sub: stateName(hol.region), checked: !!hol.public?.enabled, disabled: !admin, onChange: (v) => attempt(() => setFreeDays('public', v)) }),
        admin ? row({ title: 'Bundesland', trail: h('select', { class: 'mini-select', onchange: (e) => attempt(() => adminSet((s) => { s.holidays = { ...s.holidays, region: e.target.value, periods: [], fetchedAt: 0, public: { ...(s.holidays.public || {}), periods: [], fetchedAt: 0 } }; }, `Bundesland: ${stateName(e.target.value)}`)) },
          STATES.map(([c, n]) => h('option', { value: c, selected: c === hol.region }, n))) }) : null),
      section('Als Nächstes', next.length ? list(...next.map((p) => row({
        title: p.name, sub: span(p.start, p.end),
        trail: p.kind === 'custom' && admin ? h('button', { type: 'button', class: 'icon-btn danger', 'aria-label': 'Löschen', onclick: () => attempt(() => removeOffPeriod(p.id)) }, icon('trash-2', { size: 16 })) : null,
      }))) : note('Keine.')),
      admin ? section('Eigener Zeitraum', h('div', { class: 'stack' },
        h('input', { type: 'text', placeholder: 'z. B. Betriebsferien', value: off.name, 'data-focus-key': 'off-name', oninput: (e) => { off.name = e.target.value; } }),
        h('div', { class: 'two' },
          field('Von', h('input', { type: 'date', value: off.from, onchange: (e) => { off.from = e.target.value; rerender(); } })),
          field('Bis', h('input', { type: 'date', value: off.until, min: off.from, onchange: (e) => { off.until = e.target.value; } }))),
        btn('Hinzufügen', { kind: 'tinted', full: true, onClick: () => attempt(() => addOffPeriod({ ...off, until: off.until || off.from })).then((ok) => ok && Object.assign(off, { name: '', from: '', until: '' })) }))) : null,
    ],
  });
});

// ---------- Auto & Sprit ----------

registerSheet('car', () => {
  const fuel = liveFuel();
  const stations = fuel ? sortedStations(fuel).slice(0, 3) : [];
  const best = bestFuelTime();
  const set = (fn, text) => attempt(() => adminSet(fn, text));
  const auto = state.price.mode !== 'manual';
  return sheet({
    title: 'Auto & Sprit',
    body: [
      h('div', { class: 'two' },
        field('Verbrauch (l/100 km)', h('input', { type: 'number', min: 0, step: 0.1, inputmode: 'decimal', value: state.car.consumption, onchange: (e) => set((s) => { s.car.consumption = Number(e.target.value); }, `Verbrauch: ${e.target.value} l/100 km`) })),
        field('Kraftstoff', h('select', { onchange: (e) => set((s) => { s.car.fuel = e.target.value; applyPriceMode(s); }, `Kraftstoff: ${FUELS[e.target.value]?.label}`) },
          Object.entries(FUELS).map(([k, f]) => h('option', { value: k, selected: k === state.car.fuel }, f.label))))),
      field('Verschleiß (ct/km)', h('input', { type: 'number', min: 0, step: 0.5, inputmode: 'decimal', value: state.car.extraPerKm, onchange: (e) => set((s) => { s.car.extraPerKm = Number(e.target.value); }, `Verschleiß: ${e.target.value} ct/km`) }), 'Optional, z. B. 8 ct/km für Reifen und Wartung'),
      section('Spritpreis', h('div', { class: 'stack' },
        seg([['manual', 'Fester Preis'], ['cheapest', 'Automatisch']], auto ? 'cheapest' : 'manual', (v) => set((s) => { s.price.mode = v; applyPriceMode(s); }, v === 'manual' ? 'Spritpreis: fest' : 'Spritpreis: automatisch')),
        !auto || !(state.price.current > 0) ? field(auto ? 'Ersatzpreis (€/l)' : 'Preis (€/l)', h('input', { type: 'number', min: 0, step: 0.001, inputmode: 'decimal', value: state.price.manual, onchange: (e) => set((s) => { s.price.manual = Number(e.target.value); }, `Spritpreis: ${e.target.value} €/l`) })) : null,
        auto ? [
          !fuel ? note(`Für ${FUELS[state.car.fuel]?.label} gibt es keine Live-Preise.`) : null,
          fuel ? field('Tankerkönig-Schlüssel', h('input', { type: 'text', value: state.apiKey, placeholder: 'kostenlos bei tankerkoenig.de', spellcheck: false, autocapitalize: 'off', onchange: (e) => update((s) => { s.apiKey = e.target.value.trim(); }) }), 'Bleibt nur auf diesem Gerät') : null,
          fuel && state.apiKey ? btn(stationsLoading() ? 'Lädt …' : 'Preise an der Strecke laden', { kind: 'tinted', full: true, ic: 'refresh-cw', disabled: stationsLoading(), onClick: loadStations }) : null,
          stations.length ? list(...stations.map((st) => row({
            title: st.brand || st.name, sub: `${st.address}${st.isOpen ? '' : ' · geschlossen'}`, value: fmtPrice(st[fuel]),
            trail: st.id === state.price.stationId ? icon('check', { size: 16 }) : null, chevron: false, onClick: () => stationSelected(st.id),
          }))) : null,
          stations.length ? note(`Meist am günstigsten ${best.start}–${best.end} Uhr. Preise: tankerkoenig.de (CC BY 4.0)`) : null,
        ] : null)),
    ],
  });
});

registerSheet('split', () => {
  const set = (fn, text) => attempt(() => adminSet(fn, text));
  return sheet({
    title: 'Aufteilung',
    body: [
      seg([['segment', 'Nach Strecke'], ['equal', 'Gleich pro Fahrt']], state.split.mode, (v) => set((s) => { s.split.mode = v; }, `Aufteilung: ${v === 'segment' ? 'nach Strecke' : 'gleich'}`)),
      note(state.split.mode === 'segment' ? 'Jedes Stück wird unter denen geteilt, die dort im Auto sitzen – wer später einsteigt, zahlt weniger.' : 'Jede Fahrt wird gleichmäßig auf alle verteilt, die dabei sind.'),
      list(
        switchRow({ title: 'Fahrer zahlt seinen Anteil mit', checked: state.split.driverPays, onChange: (v) => set((s) => { s.split.driverPays = v; }, `Fahrer zahlt ${v ? 'mit' : 'nicht mit'}`) }),
        switchRow({ title: 'Verschleiß abrechnen', checked: state.split.includeExtra !== false, onChange: (v) => set((s) => { s.split.includeExtra = v; }, `Verschleiß ${v ? 'an' : 'aus'}`) })),
    ],
  });
});

// ---------- Konto ----------

const acc = { newName: '', code: '' };
registerSheet('account', () => {
  const others = myGroups().filter((g) => g.name !== groupName() || !inGroup());
  return sheet({
    title: 'Konto', sub: `${myName()} · ${myEmail()}`,
    body: [
      inGroup() ? section('Gruppe', list(row({ title: groupName(), value: isAdmin() ? 'Admin' : 'Mitfahrer' }))) : null,
      others.length ? section(inGroup() ? 'Wechseln zu' : 'Deine Gruppen', list(...others.map((g) => row({ title: g.name, onClick: () => attempt(async () => { await openGroup(g); closeSheet(); }) })))) : null,
      section('Neue Gruppe', h('form', { class: 'inline-form', onsubmit: (e) => { e.preventDefault(); if (acc.newName.trim()) attempt(async () => { await createGroup(acc.newName); acc.newName = ''; closeSheet(); }); } },
        h('input', { type: 'text', placeholder: 'Name, z. B. Berufsschule Erfurt', value: acc.newName, 'data-focus-key': 'acc-new', oninput: (e) => { acc.newName = e.target.value; } }),
        h('button', { type: 'submit', class: 'btn small primary' }, 'Erstellen')), { foot: inGroup() ? null : 'Nimmt die Daten von diesem Gerät mit.' }),
      section('Beitreten', h('form', { class: 'inline-form', onsubmit: (e) => { e.preventDefault(); attempt(async () => { await joinWith(acc.code); acc.code = ''; closeSheet(); }); } },
        h('input', { type: 'text', placeholder: 'Code oder Link', autocapitalize: 'characters', value: acc.code, 'data-focus-key': 'acc-code', oninput: (e) => { acc.code = e.target.value; } }),
        h('button', { type: 'submit', class: 'btn small tinted' }, 'Beitreten'))),
      list(
        row({ title: 'Passwort ändern', onClick: () => { closeSheet(); update((s) => { s.ui.flow = 'password'; }); } }),
        inGroup() ? row({ title: 'Nur auf diesem Gerät arbeiten', onClick: () => { workLocally(); closeSheet(); } }) : null,
        inGroup() ? row({ title: 'Gruppe verlassen', tone: 'bad', onClick: () => { if (confirm(`„${groupName()}“ wirklich verlassen?`)) attempt(async () => { await leaveGroup(); closeSheet(); }); } }) : null,
        row({ title: 'Abmelden', tone: 'bad', onClick: () => attempt(async () => { await signOut(); closeSheet(); }) })),
    ],
  });
});

registerSheet('members', () => sheet({
  title: 'Mitglieder & Rechte', sub: 'Admins (meist die Fahrer) ändern die Gruppe und die Fahrten aller.',
  body: list(...members().map((m) => row({
    lead: m.person_id && personById(m.person_id) ? avatar(m.person_id, 'm') : h('span', { class: 'av av-m' }, '?'),
    title: h('span', {}, m.display_name || 'Unbekannt', m.user_id === myUserId() ? ' (du)' : ''),
    sub: m.person_id ? `Platz: ${nameOf(m.person_id)}` : 'noch kein Platz',
    trail: h('span', { class: 'row-inline' },
      h('label', { class: 'mini-switch' }, 'Admin', h('input', { type: 'checkbox', class: 'switch', checked: m.role === 'admin', onchange: (e) => attempt(() => setRole(m.user_id, e.target.checked ? 'admin' : 'member')) })),
      m.user_id !== myUserId() ? h('button', { type: 'button', class: 'icon-btn danger', 'aria-label': 'Entfernen', onclick: () => { if (confirm(`${m.display_name} aus der Gruppe entfernen? Der Platz bleibt erhalten.`)) attempt(() => removeMember(m.user_id)); } }, icon('x', { size: 16 })) : null),
  }))),
}));

let logRows = null;
registerSheet('log', () => {
  if (!logRows) { logRows = []; loadLog().then((r) => { logRows = r; rerender(); }).catch((e) => toast(e.message, 'error')); }
  return sheet({
    title: 'Verlauf', sub: 'Wer hat was geändert',
    body: logRows.length ? list(...logRows.slice(0, 100).map((r) => row({ title: h('span', {}, h('strong', {}, r.actor || '?'), ' ', r.action), sub: new Date(r.at).toLocaleString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) })))
      : note('Lädt …'),
  });
});
document.addEventListener('sheet-closed', () => { logRows = null; drv.open = false; add.name = ''; });

registerSheet('about', () => sheet({
  title: 'Daten & Infos',
  body: [
    isAdmin() ? list(
      row({ title: 'Daten sichern', sub: 'Als Datei herunterladen', onClick: data.exportData }),
      row({ title: 'Daten laden', sub: 'Aus einer Datei', onClick: data.importData }),
      row({ title: 'Beispiel laden', onClick: data.example }),
      row({ title: 'Einrichtung erneut starten', onClick: () => { closeSheet(); adminSet((s) => { s.setupDone = false; s.ui.setupStep = 0; }); } }),
      row({ title: 'Alles löschen', tone: 'bad', onClick: data.reset })) : null,
    note(formatVersion(loadedVersion())),
    note('Ohne Konto bleiben alle Daten auf diesem Gerät. Karte © OpenStreetMap-Mitwirkende · Routen OSRM & Valhalla (FOSSGIS) · Adresssuche Photon · Spritpreise tankerkoenig.de (CC BY 4.0) · Verkehrsmeldungen Autobahn GmbH des Bundes · Ferien & Feiertage OpenHolidays · QR-Code qrcode-generator (MIT) · Symbole Lucide (ISC)'),
  ],
}));

