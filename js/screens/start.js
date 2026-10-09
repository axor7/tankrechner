// Abläufe im Vollbild (ohne Reiter): Willkommen, Anmelden/Registrieren, Passwort, Einrichten in Schritten,
// „Wer bist du?“ / „Bist du Max?“ und die ersten Angaben eines neuen Mitfahrers. Eine Frage pro Bildschirm.
import { state, update, personById, activePersons, todayIso } from '../state.js';
import { FUELS } from '../calc.js';
import { hasPlan } from '../model.js';
import { inGroup, isAdmin, isLoggedIn, claims, claimPerson, claimNew, myProfile, updateProfile, hasPendingJoin, pendingClaim, clearClaimOffer, parseJoin, setPendingJoin, joinWith, signIn, signUp, signOut, requestPasswordReset, setNewPassword, isRecovering, cancelRecovery, accountReady,
  switchingTo, localHasData, allGroups, switchGroup, createGroup, isFreshGroup, cancelNewGroup, groupSetupDone, leaveGroup, groupName, myName, accountData } from '../account.js';
import { me, setAddress, setMyName, addPerson, adminSet, setGroupCar, applyAccountDefaults } from '../actions.js';
import { debtItems } from '../derived.js';
import { data } from '../engine.js';
import { addressInput } from '../address.js';
import { h, icon, list, row, btn, field, avatar, attempt, toast } from '../kit.js';
import { rhythmEditor } from './rides.js';
import { nameOf, shortLabel, rhythmText } from '../plan.js';
import { fmtEuro } from '../ui.js';

const rerender = () => update(() => {});

/** Vollbild-Seite eines Ablaufs: oben Zurück und Fortschritt, Titel, Inhalt, unten der Hauptknopf. */
function page({ step, steps, back, title, text, body, foot }) {
  return h('div', { class: 'flow' },
    h('div', { class: 'flow-top' },
      back ? h('button', { type: 'button', class: 'back', onclick: back }, icon('chevron-left', { size: 22 }), 'Zurück') : h('span'),
      steps ? h('div', { class: 'dots' }, Array.from({ length: steps }, (_, i) => h('span', { class: i <= step ? 'on' : '' }))) : null),
    h('div', { class: 'flow-body' },
      h('h1', {}, title),
      text ? h('p', { class: 'flow-text' }, text) : null,
      ...[body].flat().filter(Boolean)),
    foot ? h('div', { class: 'flow-foot' }, ...[foot].flat().filter(Boolean)) : null);
}

// ---------- Welcher Ablauf ist dran? ----------

/** Liefert den Ablauf, der gerade gezeigt werden muss – oder null für die normale App. */
export function currentFlow() {
  if (!accountReady()) return 'loading';
  if (switchingTo()) return 'switching';
  if (isRecovering()) return 'newpass';
  const f = state.ui.flow;
  if (['login', 'register', 'forgot', 'password'].includes(f)) return f;
  if (f === 'newgroup' && isLoggedIn()) return f;
  if (hasPendingJoin() && !isLoggedIn()) return 'register';
  // Angemeldet, aber gerade in keiner Gruppe (und nichts auf dem Gerät): Übersicht statt leerer Einrichtung
  if (isLoggedIn() && !inGroup() && !localHasData()) return 'hub';
  if (!state.ui.welcomeDone && !inGroup() && !hasPendingJoin()) return 'welcome';
  if (inGroup() && !me()) return 'claim';
  if (isAdmin() && !state.setupDone) return 'setup';
  if (inGroup() && !isAdmin()) {
    const prof = myProfile();
    const p = personById(me());
    if (!prof.onboarded && !(p && (p.address?.lat || prof.noAddress) && hasPlan(p))) return 'member';
  }
  return null;
}

export function renderFlow(el, flow) {
  const fn = { loading, switching: loading, welcome, hub, newgroup: newGroup, login: auth, register: auth, forgot, password: newPassword, newpass: newPassword, setup, claim, member }[flow];
  el.append(fn(flow));
}

const loading = (flow) => h('div', { class: 'flow center' },
  h('span', { class: 'app-mark' }, '⛽'),
  flow === 'switching' ? h('p', { class: 'flow-text' }, `Öffne „${switchingTo()}“ …`) : null);

// ---------- Angemeldet, aber in keiner Gruppe ----------

const hubUi = { code: '' };
function hub() {
  const list = allGroups();
  return page({
    title: `Hallo ${myName()}!`,
    text: list.length ? 'Wähle eine Fahrgemeinschaft – oder starte eine neue.' : 'Du bist gerade in keiner Fahrgemeinschaft. Starte eine neue oder tritt mit einem Code bei.',
    body: [
      list.length ? groupList(list) : null,
      btn('Neue Gruppe erstellen', { kind: 'primary', full: true, ic: 'plus', onClick: () => update((s) => { s.ui.flow = 'newgroup'; }) }),
      joinForm(hubUi),
    ],
    foot: h('button', { type: 'button', class: 'link-btn', onclick: () => attempt(signOut) }, 'Abmelden'),
  });
}

/** Liste von Gruppen zum Wechseln (auch im Fenster „Deine Gruppen“). */
export function groupList(items, { onPicked } = {}) {
  return list(...items.map((g) => row({
    lead: h('span', { class: `av av-m grp ${g.local ? 'local' : ''}` }, icon(g.local ? 'smartphone' : 'users', { size: 17 })),
    title: g.name, sub: g.local ? 'ohne Konto, nur hier' : g.role === 'admin' ? 'Admin' : 'Mitfahrer',
    trail: g.current ? icon('check', { size: 18 }) : null, chevron: !g.current,
    onClick: g.current ? null : () => { onPicked?.(); attempt(() => switchGroup(g)); },
  })));
}

/** Mit Code oder Link beitreten. */
export function joinForm(ui) {
  return h('form', { class: 'inline-form', onsubmit: (e) => {
    e.preventDefault();
    const j = parseJoin(ui.code);
    if (!j) { toast('Das ist kein gültiger Code', 'error'); return; }
    attempt(async () => { await joinWith(j); ui.code = ''; });
  } },
  h('input', { type: 'text', placeholder: 'Einladungscode', autocapitalize: 'characters', value: ui.code, 'data-focus-key': 'join-code', oninput: (e) => { ui.code = e.target.value; } }),
  h('button', { type: 'submit', class: 'btn tinted' }, 'Beitreten'));
}

// ---------- Neue Gruppe ----------

const ng = { name: '', busy: false };
function newGroup() {
  const acc = accountData();
  const known = [acc.address?.label ? 'Adresse' : null, acc.car?.consumption ? 'Auto' : null, acc.paypal ? 'PayPal' : null].filter(Boolean);
  const submit = (e) => {
    e?.preventDefault();
    if (!ng.name.trim() || ng.busy) return;
    ng.busy = true; rerender();
    attempt(async () => {
      Object.assign(sd, { names: '', arrive: null, leave: null, car: null });
      await createGroup(ng.name);
      ng.name = '';
      update((s) => { s.ui.flow = null; s.ui.setupStep = 0; s.ui.screen = 'rides'; s.ui.welcomeDone = true; });
    }).finally(() => { ng.busy = false; rerender(); });
  };
  return page({
    back: closeFlow, title: 'Neue Gruppe',
    text: `Wie soll eure Fahrgemeinschaft heißen? Danach geht es wie beim ersten Mal weiter${known.length ? ` – ${known.join(', ')} und Name setzt die App aus deinem Konto ein` : ''}.`,
    body: h('form', { class: 'stack', onsubmit: submit },
      field('Name der Gruppe', h('input', { type: 'text', value: ng.name, placeholder: 'z. B. Arbeit Erfurt', maxlength: 80, 'data-focus-key': 'ng-name', 'data-autofocus': '', oninput: (e) => { ng.name = e.target.value; rerender(); } }))),
    foot: btn(ng.busy ? 'Wird erstellt …' : 'Weiter', { kind: 'primary', full: true, disabled: !ng.name.trim() || ng.busy, onClick: submit }),
  });
}

// ---------- Willkommen ----------

let joinCode = '';
function welcome() {
  return h('div', { class: 'flow welcome' },
    h('div', { class: 'welcome-top' },
      h('span', { class: 'app-mark big' }, '⛽'),
      h('h1', {}, 'Tankrechner'),
      h('p', { class: 'flow-text' }, 'Fahrgemeinschaft planen und Spritkosten fair teilen.')),
    h('div', { class: 'welcome-actions' },
      btn('Ich fahre', { kind: 'primary', full: true, ic: 'car', onClick: () => update((s) => { s.ui.welcomeDone = true; s.ui.setupStep = 0; }) }),
      h('form', { class: 'join-box', onsubmit: (e) => {
        e.preventDefault();
        const j = parseJoin(joinCode);
        if (!j) { toast('Das ist kein gültiger Code', 'error'); return; }
        setPendingJoin(j);
        if (isLoggedIn()) attempt(() => joinWith(j));
      } },
      h('input', { type: 'text', placeholder: 'Einladungscode', autocapitalize: 'characters', value: joinCode, 'data-focus-key': 'w-code', oninput: (e) => { joinCode = e.target.value; } }),
      h('button', { type: 'submit', class: 'btn tinted' }, 'Beitreten')),
      h('div', { class: 'welcome-links' },
        h('button', { type: 'button', class: 'link-btn', onclick: () => update((s) => { s.ui.flow = 'login'; }) }, 'Anmelden'),
        h('button', { type: 'button', class: 'link-btn', onclick: data.example }, 'Beispiel ansehen'))));
}

// ---------- Anmelden / Registrieren ----------

const form = { name: '', email: '', password: '', password2: '', busy: false, sent: '' };
const closeFlow = () => update((s) => { s.ui.flow = null; });

function auth(flow) {
  const register = flow === 'register';
  const submit = (e) => {
    e.preventDefault();
    form.busy = true; rerender();
    attempt(async () => {
      if (register) await signUp(form.name, form.email, form.password);
      else await signIn(form.email, form.password);
      form.password = '';
      update((s) => { s.ui.flow = null; s.ui.welcomeDone = true; });
    }).finally(() => { form.busy = false; rerender(); });
  };
  return page({
    back: closeFlow,
    title: register ? 'Konto anlegen' : 'Anmelden',
    text: hasPendingJoin() ? 'Du wurdest eingeladen. Mit einem Konto bist du gleich dabei.' : register ? 'Damit ihr die Fahrgemeinschaft gemeinsam nutzt.' : null,
    body: h('form', { class: 'stack', id: 'auth-form', onsubmit: submit },
      register ? field('Dein Name', h('input', { type: 'text', required: true, autocomplete: 'name', value: form.name, oninput: (e) => { form.name = e.target.value; } })) : null,
      field('E-Mail', h('input', { type: 'email', required: true, autocomplete: 'email', value: form.email, oninput: (e) => { form.email = e.target.value; } })),
      field('Passwort', h('input', { type: 'password', required: true, minlength: 6, autocomplete: register ? 'new-password' : 'current-password', value: form.password, oninput: (e) => { form.password = e.target.value; } }), register ? 'Mindestens 6 Zeichen' : null),
      h('button', { type: 'submit', class: 'btn primary full', disabled: form.busy }, form.busy ? 'Einen Moment …' : register ? 'Konto anlegen' : 'Anmelden')),
    foot: [
      h('button', { type: 'button', class: 'link-btn', onclick: () => update((s) => { s.ui.flow = register ? 'login' : 'register'; }) }, register ? 'Ich habe schon ein Konto' : 'Neues Konto anlegen'),
      register ? null : h('button', { type: 'button', class: 'link-btn', onclick: () => update((s) => { s.ui.flow = 'forgot'; }) }, 'Passwort vergessen?'),
    ],
  });
}

function forgot() {
  if (form.sent) {
    return page({ back: () => { form.sent = ''; update((s) => { s.ui.flow = 'login'; }); }, title: 'E-Mail ist unterwegs',
      text: `Falls es ein Konto für ${form.sent} gibt, kommt gleich ein Link. Damit legst du ein neues Passwort fest. Der Link gilt eine Stunde.` });
  }
  return page({
    back: () => update((s) => { s.ui.flow = 'login'; }), title: 'Passwort vergessen', text: 'Du bekommst einen Link, mit dem du ein neues Passwort festlegst.',
    body: h('form', { class: 'stack', onsubmit: (e) => { e.preventDefault(); attempt(async () => { await requestPasswordReset(form.email); form.sent = form.email; rerender(); }); } },
      field('E-Mail', h('input', { type: 'email', required: true, autocomplete: 'email', value: form.email, oninput: (e) => { form.email = e.target.value; } })),
      h('button', { type: 'submit', class: 'btn primary full' }, 'Link schicken')),
  });
}

function newPassword(flow) {
  return page({
    back: flow === 'newpass' ? cancelRecovery : closeFlow, title: 'Neues Passwort',
    body: h('form', { class: 'stack', onsubmit: (e) => {
      e.preventDefault();
      if (form.password !== form.password2) { toast('Die Passwörter stimmen nicht überein', 'error'); return; }
      attempt(async () => { await setNewPassword(form.password); form.password = ''; form.password2 = ''; toast('Gespeichert', 'ok'); closeFlow(); });
    } },
    field('Neues Passwort', h('input', { type: 'password', required: true, minlength: 6, autocomplete: 'new-password', oninput: (e) => { form.password = e.target.value; } })),
    field('Noch einmal', h('input', { type: 'password', required: true, minlength: 6, autocomplete: 'new-password', oninput: (e) => { form.password2 = e.target.value; } })),
    h('button', { type: 'submit', class: 'btn primary full' }, 'Speichern')),
  });
}

// ---------- Einrichten (Fahrer) ----------

const KINDS = [['school', 'Schule / Ausbildung', 'Schulferien und Feiertage sind fahrfrei'], ['work', 'Arbeit', 'Feiertage sind fahrfrei'], ['other', 'Etwas anderes', 'Keine automatischen fahrfreien Tage']];
const sd = { names: '', arrive: null, leave: null, car: null };

function setup() {
  const steps = 6;
  const step = Math.min(state.ui.setupStep || 0, steps - 1);
  const go = (k) => update((s) => { s.ui.setupStep = k; });
  const next = () => go(step + 1);
  const back = step > 0 ? () => go(step - 1)
    : isFreshGroup() ? () => { if (confirm(`Einrichtung abbrechen? Die Gruppe „${groupName()}“ wird wieder gelöscht.`)) attempt(cancelNewGroup); }
      : !inGroup() ? () => update((s) => { s.ui.welcomeDone = false; }) : null;
  const driver = personById(state.defaultDriver);
  const others = activePersons().filter((p) => p.id !== state.defaultDriver);
  const common = { step, steps, back };
  if (step === 0) {
    return page({ ...common, title: 'Wohin fahrt ihr?',
      body: h('div', { class: 'choices' }, KINDS.map(([k, label, sub]) => h('button', {
        type: 'button', class: `choice ${state.kind === k ? 'on' : ''}`,
        onclick: () => {
          const today = todayIso();
          attempt(() => adminSet((s) => { s.kind = k; s.holidays = { ...s.holidays, enabled: k === 'school', from: today, fetchedAt: 0, public: { ...(s.holidays?.public || {}), enabled: k !== 'other', from: today, fetchedAt: 0 } }; }, `Gruppenart: ${label}`));
          next();
        },
      }, h('strong', {}, label), h('span', {}, sub)))) });
  }
  if (step === 1) {
    sd.arrive ??= state.times?.arrive || '';
    sd.leave ??= state.times?.leave || '';
    return page({ ...common, title: state.kind === 'work' ? 'Wo arbeitet ihr?' : 'Wo ist das Ziel?', text: 'Mit der Uhrzeit rechnet die App für jeden die Abholzeit.',
      body: [
        field('Ziel', addressInput({ value: state.destination, placeholder: 'Adresse oder Name suchen', focusKey: 'su-dest', onSelect: (a) => a && attempt(() => adminSet((s) => { s.destination = a; }, `Ziel: ${a.label}`)) })),
        h('div', { class: 'two' },
          field('Ankunft', h('input', { type: 'time', value: sd.arrive, onchange: (e) => { sd.arrive = e.target.value; } })),
          field('Rückfahrt ab', h('input', { type: 'time', value: sd.leave, onchange: (e) => { sd.leave = e.target.value; } }))),
      ],
      foot: btn('Weiter', { kind: 'primary', full: true, disabled: !state.destination?.lat, onClick: () => { attempt(() => adminSet((s) => { s.times = { arrive: sd.arrive || '', leave: sd.leave || '' }; })); next(); } }) });
  }
  if (step === 2) {
    return page({ ...common, title: 'Wer bist du?', text: 'Dein Name und wo die Fahrt beginnt.',
      body: [
        field('Name', h('input', { type: 'text', autocomplete: 'given-name', value: driver?.name && driver.name !== 'Ich' ? driver.name : '', 'data-focus-key': 'su-name', onchange: (e) => e.target.value.trim() && attempt(() => setMyName(e.target.value.trim())) })),
        field('Startadresse', addressInput({ value: driver?.address, allowLocate: true, focusKey: 'su-start', onSelect: (a) => a && attempt(() => setAddress(state.defaultDriver, a)) })),
      ],
      foot: btn('Weiter', { kind: 'primary', full: true, disabled: !driver?.address?.lat, onClick: next }) });
  }
  if (step === 3) {
    const local = (sd.car ??= { consumption: state.car.consumption, fuel: state.car.fuel, price: state.price.manual });
    return page({ ...common, title: 'Dein Auto', text: 'Den Spritpreis kann die App später auch automatisch holen.',
      body: [
        h('div', { class: 'two' },
          field('Verbrauch (l/100 km)', h('input', { type: 'number', step: 0.1, min: 0, inputmode: 'decimal', value: local.consumption, oninput: (e) => { local.consumption = Number(e.target.value); } })),
          field('Kraftstoff', h('select', { onchange: (e) => { local.fuel = e.target.value; } }, Object.entries(FUELS).map(([k, f]) => h('option', { value: k, selected: k === local.fuel }, f.label))))),
        field('Preis pro Liter (€)', h('input', { type: 'number', step: 0.001, min: 0, inputmode: 'decimal', value: local.price, oninput: (e) => { local.price = Number(e.target.value); } })),
      ],
      foot: btn('Weiter', { kind: 'primary', full: true, onClick: () => { attempt(() => setGroupCar({ consumption: Number(local.consumption) || state.car.consumption, fuel: local.fuel, price: Number(local.price) || state.price.manual })); next(); } }) });
  }
  if (step === 4) {
    return page({ ...common, title: 'Wann fährst du?', text: 'In Ferien und an Feiertagen fährt nach Plan niemand.', body: rhythmEditor(state.defaultDriver, { saveLabel: 'Weiter', onSaved: next }) });
  }
  return page({ ...common, title: 'Wer fährt mit?', text: 'Erst einmal nur die Namen. Wer die App nicht hat, für den trägst du ein – einladen kannst du jederzeit.',
    body: [
      others.length ? list(...others.map((p) => row({ lead: avatar(p.id, 'm'), title: p.name, sub: rhythmText(p) }))) : null,
      h('form', { class: 'inline-form', onsubmit: (e) => { e.preventDefault(); for (const n of sd.names.split(',').map((x) => x.trim()).filter(Boolean)) attempt(() => addPerson(n)); sd.names = ''; rerender(); } },
        h('input', { type: 'text', placeholder: 'Name', value: sd.names, 'data-focus-key': 'su-names', oninput: (e) => { sd.names = e.target.value; } }),
        h('button', { type: 'submit', class: 'btn tinted' }, 'Hinzufügen')),
    ],
    foot: btn(others.length ? 'Fertig' : 'Später', { kind: 'primary', full: true, onClick: () => attempt(() => { adminSet((s) => { s.setupDone = true; s.ui.screen = 'rides'; }, 'Einrichtung abgeschlossen'); groupSetupDone(); }) }) });
}

// ---------- Platz übernehmen ----------

const claimUi = { pick: null, newName: '' };

function claim() {
  const offer = pendingClaim();
  const taken = claims();
  const pick = claimUi.pick || (offer && !taken.has(offer) ? offer : null);
  if (pick && personById(pick)) {
    const p = personById(pick);
    const owe = debtItems().filter((d) => d.from === pick && d.open > 0).reduce((a, d) => a + d.open, 0);
    return page({
      back: () => { claimUi.pick = null; clearClaimOffer(); },
      title: `Bist du ${p.name}?`, text: `${nameOf(state.defaultDriver)} hat diesen Platz für dich angelegt.`,
      body: list(
        row({ title: 'Abholung', value: shortLabel(p.address?.label) || 'noch offen' }),
        row({ title: 'Rhythmus', value: rhythmText(p) }),
        row({ title: 'Offen', value: owe > 0.004 ? fmtEuro(owe) : 'nichts' })),
      foot: [
        btn('Ja, das bin ich', { kind: 'primary', full: true, onClick: () => attempt(async () => { await claimPerson(pick); claimUi.pick = null; applyAccountDefaults(); toast(`Willkommen, ${p.name}!`, 'ok'); }) }),
        btn('Nein', { kind: 'plain', full: true, onClick: () => { claimUi.pick = null; clearClaimOffer(); } }),
      ],
    });
  }
  const free = activePersons().filter((p) => !taken.has(p.id) && !p.self);
  claimUi.newName ||= free.length ? '' : accountData().name || '';
  return page({
    back: () => { if (confirm(`„${groupName()}“ wieder verlassen?`)) attempt(() => leaveGroup()); },
    title: 'Wer bist du?', text: free.length ? `In „${groupName()}“ – such deinen Namen aus.` : `In „${groupName()}“ – trag deinen Namen ein.`,
    body: [
      free.length ? list(...free.map((p) => row({ lead: avatar(p.id, 'm'), title: p.name, sub: shortLabel(p.address?.label) || rhythmText(p), onClick: () => { claimUi.pick = p.id; rerender(); } }))) : null,
      h('form', { class: 'inline-form', onsubmit: (e) => { e.preventDefault(); if (claimUi.newName.trim()) attempt(async () => { await claimNew(claimUi.newName.trim()); claimUi.newName = ''; applyAccountDefaults(); }); } },
        h('input', { type: 'text', placeholder: free.length ? 'Ich bin neu – Name' : 'Dein Name', value: claimUi.newName, 'data-focus-key': 'cl-new', oninput: (e) => { claimUi.newName = e.target.value; } }),
        h('button', { type: 'submit', class: 'btn tinted' }, 'Weiter')),
    ],
  });
}

// ---------- Neuer Mitfahrer: Adresse, Rhythmus ----------

function member() {
  const mine = me();
  const p = personById(mine);
  const prof = myProfile();
  const needsAddr = !(p?.address?.lat || prof.noAddress) || state.ui.memberStep === 0;
  if (needsAddr && state.ui.memberStep !== 1) {
    return page({ step: 0, steps: 2, title: 'Wo wirst du abgeholt?', text: 'Du zahlst ab hier.',
      body: [
        addressInput({ value: p?.address, placeholder: 'Deine Adresse', allowLocate: true, near: personById(state.defaultDriver)?.address, focusKey: 'm-addr', onSelect: (a) => a && attempt(() => setAddress(mine, a)) }),
        h('button', { type: 'button', class: 'link-btn', onclick: () => { updateProfile((d) => { d.noAddress = true; }); update((s) => { s.ui.memberStep = 1; }); } }, 'Ich steige beim Fahrer zu'),
      ],
      foot: btn('Weiter', { kind: 'primary', full: true, disabled: !p?.address?.lat, onClick: () => update((s) => { s.ui.memberStep = 1; }) }) });
  }
  return page({ step: 1, steps: 2, back: () => update((s) => { s.ui.memberStep = 0; }), title: 'Wann fährst du mit?', text: 'Einzelne Tage änderst du später mit einem Tipp.',
    body: rhythmEditor(mine, { saveLabel: 'Fertig', onSaved: () => { updateProfile((d) => { d.planChecked = true; d.onboarded = true; }); update((s) => { s.ui.memberStep = null; s.ui.screen = 'rides'; }); } }) });
}

