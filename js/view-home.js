// Ansicht „Heute“: Was passiert als Nächstes? Nächste Fahrt mit Abholzeit, Absagen mit einem Tipp,
// höchstens zwei Hinweise und der offene Betrag. Dazu Einstieg, Einrichtung und „Wer bist du?“.
import { state, update, model, personById, activePersons, todayIso, allRoutes } from './state.js';
import { mondayOf, addDays, resolveLegs, stopTimes, fmtTime, parseTime, FUELS, weekDates } from './calc.js';
import { hasPlan, isActive, planOn, absenceOn, activeDetours } from './model.js';
import { inGroup, isAdmin, claims, claimPerson, claimNew, myProfile, updateProfile, isLoggedIn, hasPendingJoin, pendingClaim, clearClaimOffer, newClaims, ackClaim, removeMember, parseJoin } from './account.js';
import { me, setAddress, setDay, volunteerDrive, addPerson, adminSet, setMyName } from './actions.js';
import { myBalance, myWeek, tripResult, dirsNow, debtItems } from './derived.js';
import { paypalLink, paypalUser } from './pay.js';
import { addressInput } from './address.js';
import { rhythmEditor, upcomingFree } from './view-trips.js';
import { confirmCard } from './view-costs.js';
import { register, openSheet, closeSheet, sheetHead } from './sheets.js';
import { avatar, appTag, rhythmText, REASONS, spanText, isPlaceholder } from './people.js';
import { h, fmtEuro, fmtDate, toast } from './ui.js';
import { icon } from './icons.js';

const safe = async (fn) => { try { await fn(); return true; } catch (e) { toast(e.message, 'error'); return false; } };
const nameOf = (pid) => personById(pid)?.name || '?';
const short = (label) => (label ? String(label).split(',')[0] : '');
const KINDS = [['school', 'Schule / Ausbildung'], ['work', 'Arbeit'], ['other', 'Sonstiges']];

// ---------- Willkommen ----------

function welcome(ctx) {
  let code = '';
  const join = (e) => {
    e.preventDefault();
    const j = parseJoin(code);
    if (!j) { toast('Das ist kein gültiger Code oder Link', 'error'); return; }
    location.hash = `join=${j.code}${j.pid ? `&p=${encodeURIComponent(j.pid)}` : ''}`;
    location.reload();
  };
  return h('div', { class: 'welcome' },
    h('div', { class: 'welcome-hero' },
      h('span', { class: 'app-icon big' }, '⛽'),
      h('h2', {}, 'Fahrgemeinschaft, fair geteilt'),
      h('p', { class: 'hint' }, 'Wer fährt wann, wer zahlt wie viel – die App plant und rechnet. Auch allein: Mitfahrer einfach mit Namen anlegen und abhaken.')),
    h('div', { class: 'list' },
      h('button', { type: 'button', class: 'list-row has-sq', onclick: () => update((s) => { s.ui.welcomeDone = true; s.ui.tab = 'home'; }) },
        h('span', { class: 'sq sq-blue' }, icon('car', { size: 16 })),
        h('span', { class: 'grow' }, h('span', { class: 'title' }, 'Ich fahre'), h('span', { class: 'sub' }, 'Einrichten in einer Minute – auch ganz ohne Konto')),
        h('span', { class: 'chev' }, icon('chevron-right', { size: 18 }))),
      h('div', { class: 'list-row has-sq' },
        h('span', { class: 'sq sq-green' }, icon('user-plus', { size: 16 })),
        h('form', { class: 'grow', onsubmit: join },
          h('span', { class: 'title' }, 'Ich wurde eingeladen'),
          h('div', { class: 'row gap', style: { marginTop: '.35rem' } },
            h('input', { type: 'text', placeholder: 'Code, z. B. K7M-4Q2, oder Link', autocapitalize: 'characters', oninput: (e) => { code = e.target.value; } }),
            h('button', { type: 'submit', class: 'btn btn-small' }, 'Weiter')))),
      h('button', { type: 'button', class: 'list-row has-sq', onclick: ctx.data.example },
        h('span', { class: 'sq sq-yellow' }, icon('sparkles', { size: 16 })),
        h('span', { class: 'grow' }, h('span', { class: 'title' }, 'Beispiel ansehen'), h('span', { class: 'sub' }, 'Mit ausgedachten Daten ausprobieren')),
        h('span', { class: 'chev' }, icon('chevron-right', { size: 18 }))),
      h('button', { type: 'button', class: 'list-row has-sq', onclick: () => ctx.openAccount('login') },
        h('span', { class: 'sq sq-gray' }, icon('circle-user', { size: 16 })),
        h('span', { class: 'grow' }, h('span', { class: 'title' }, 'Ich habe schon ein Konto'), h('span', { class: 'sub' }, 'Anmelden')),
        h('span', { class: 'chev' }, icon('chevron-right', { size: 18 })))));
}

// ---------- Schritt für Schritt ----------

function stepsCard(title, steps, onDone) {
  const current = steps.findIndex((s) => !s.done);
  const n = current === -1 ? steps.length : current;
  return h('section', { class: 'card steps-card' },
    h('div', { class: 'row between' }, h('h2', {}, title), h('span', { class: 'muted small' }, `${n} von ${steps.length}`)),
    h('div', { class: 'progress' }, h('span', { style: { width: `${(n / steps.length) * 100}%` } })),
    steps.map((s, i) => h('div', { class: `step ${s.done ? 'done' : ''} ${i === current ? 'current' : ''}` },
      h('div', { class: 'step-head' },
        h('span', { class: `step-num ${s.done ? 'done' : ''}` }, s.done ? icon('check', { size: 15 }) : String(i + 1)),
        h('span', { class: 'grow' }, h('span', { class: 'title' }, s.title), s.done && s.summary ? h('span', { class: 'sub' }, s.summary) : null)),
      i === current ? h('div', { class: 'step-body' }, s.hint ? h('p', { class: 'hint' }, s.hint) : null, s.body()) : null)),
    current === -1 ? h('button', { type: 'button', class: 'btn btn-primary full', onclick: onDone }, icon('check', { size: 17 }), 'Fertig') : null);
}

const setupDraft = { kind: null, arrive: null, leave: null, names: '' };

function timesFields(d, onInput) {
  return h('div', { class: 'grid2' },
    h('label', { class: 'field' }, 'Ankunft am Ziel', h('input', { type: 'time', value: d.arrive ?? '', onchange: (e) => { d.arrive = e.target.value; onInput?.(); } })),
    h('label', { class: 'field' }, state.roundTrip === false ? 'Rückfahrt (optional)' : 'Rückfahrt ab', h('input', { type: 'time', value: d.leave ?? '', onchange: (e) => { d.leave = e.target.value; onInput?.(); } })));
}

function adminSetup(ctx) {
  const driver = personById(state.defaultDriver);
  const others = activePersons().filter((p) => p.id !== state.defaultDriver);
  const sd = setupDraft;
  sd.kind ??= state.kind || 'school';
  sd.arrive ??= state.times?.arrive || '';
  sd.leave ??= state.times?.leave || '';
  const steps = [
    {
      title: 'Wofür und wohin?', done: !!state.destination?.lat, summary: [KINDS.find(([k]) => k === state.kind)?.[1], short(state.destination?.label), state.times?.arrive ? `an ${state.times.arrive}` : null].filter(Boolean).join(' · '),
      hint: 'Das Ziel, an dem ihr ankommt – z. B. Schule oder Arbeit. Mit Uhrzeit rechnet die App für jeden die Abholzeit aus.',
      body: () => h('div', { class: 'acc-form' },
        h('div', { class: 'segmented' }, KINDS.map(([k, label]) => h('button', { type: 'button', class: sd.kind === k ? 'active' : '', onclick: () => { sd.kind = k; update(() => {}); } }, label))),
        h('p', { class: 'hint small' }, sd.kind === 'school' ? 'Schulferien und Feiertage sind automatisch fahrfrei.' : sd.kind === 'work' ? 'Feiertage sind automatisch fahrfrei, Schulferien nicht.' : 'Keine automatischen fahrfreien Tage.'),
        addressInput({ value: state.destination, placeholder: sd.kind === 'work' ? 'Arbeit, z. B. Firma' : 'Ziel, z. B. Schule', near: driver?.address, focusKey: 'setup-dest', onSelect: (a) => {
          if (!a) return;
          safe(() => adminSet((s) => {
            s.destination = a;
            s.kind = sd.kind;
            s.times = { arrive: sd.arrive || '', leave: sd.leave || '' };
            const today = todayIso();
            s.holidays = { ...s.holidays, enabled: sd.kind === 'school', from: today, fetchedAt: 0, public: { ...(s.holidays?.public || {}), enabled: sd.kind !== 'other', from: today, fetchedAt: 0 } };
          }, `Ziel: ${a.label}`));
        } }),
        timesFields(sd, () => { if (state.destination) safe(() => adminSet((s) => { s.times = { arrive: sd.arrive || '', leave: sd.leave || '' }; })); })),
    },
    {
      title: 'Wer bist du, wo startest du?', done: !!driver?.address?.lat, summary: [driver?.name !== 'Ich' ? driver?.name : null, driver?.address?.label].filter(Boolean).join(' · '),
      hint: 'Dein Name und deine Adresse – hier beginnt die Fahrt. Die Mitfahrer werden auf dem Weg eingesammelt.',
      body: () => h('div', { class: 'acc-form' },
        h('input', { type: 'text', placeholder: 'Dein Name', value: driver?.name && driver.name !== 'Ich' ? driver.name : '', 'data-focus-key': 'setup-name', autocomplete: 'given-name', onchange: (e) => e.target.value.trim() && safe(() => setMyName(e.target.value.trim())) }),
        addressInput({ value: driver?.address, placeholder: 'Deine Startadresse', allowLocate: true, focusKey: 'setup-start', onSelect: (a) => safe(() => setAddress(state.defaultDriver, a)) })),
    },
    {
      title: 'Dein Auto', done: !!state.setupCar, summary: `${String(state.car.consumption).replace('.', ',')} l/100 km · ${FUELS[state.car.fuel]?.label}`,
      hint: 'Verbrauch und Kraftstoff. Den aktuellen Spritpreis holt die App später an eurer Strecke (oder du trägst ihn ein).',
      body: () => {
        let cons = state.car.consumption;
        let fuel = state.car.fuel;
        let price = state.price.manual;
        return h('div', { class: 'acc-form' },
          h('div', { class: 'grid2' },
            h('label', { class: 'field' }, 'Verbrauch (l/100 km)', h('input', { type: 'number', step: 0.1, min: 0, inputmode: 'decimal', value: cons, oninput: (e) => { cons = Number(e.target.value); } })),
            h('label', { class: 'field' }, 'Kraftstoff', h('select', { onchange: (e) => { fuel = e.target.value; } }, Object.entries(FUELS).map(([k, f]) => h('option', { value: k, selected: k === fuel }, f.label))))),
          h('label', { class: 'field' }, 'Spritpreis pro Liter (€, ungefähr)', h('input', { type: 'number', step: 0.001, min: 0, inputmode: 'decimal', value: price, oninput: (e) => { price = Number(e.target.value); } })),
          h('button', { type: 'button', class: 'btn btn-primary', onclick: () => ctx.adminSet((s) => { s.car.consumption = cons; s.car.fuel = fuel; s.price.manual = price; s.setupCar = true; }, `Auto: ${cons} l/100 km, ${FUELS[fuel]?.label}, ${price} €/l`) }, 'Weiter'));
      },
    },
    {
      title: 'Wann fährst du?', done: hasPlan(driver), summary: rhythmText(driver),
      hint: 'Dein Rhythmus. In Ferien und an Feiertagen fährt nach Plan niemand – einzelne Tage änderst du später im Plan.',
      body: () => rhythmEditor({ pid: state.defaultDriver, saveLabel: 'Weiter' }),
    },
    {
      title: 'Wer fährt mit?', done: inGroup() || others.length > 0 || !!state.ui.setupSkipPeople, summary: others.length ? others.map((p) => p.name).join(', ') : 'später',
      hint: 'Einfach die Namen eintippen. Wer die App (noch) nicht hat, für den trägst du ein und hakst ab. Einladen geht jederzeit – dann übernimmt jede Person ihren Platz selbst.',
      body: () => h('div', { class: 'acc-form' },
        h('form', { class: 'row gap', onsubmit: (e) => { e.preventDefault(); const names = sd.names.split(',').map((x) => x.trim()).filter(Boolean); for (const n of names) safe(() => addPerson(n)); sd.names = ''; } },
          h('input', { type: 'text', placeholder: 'Name, z. B. Anna (mehrere mit Komma)', 'data-focus-key': 'setup-names', value: sd.names, oninput: (e) => { sd.names = e.target.value; } }),
          h('button', { type: 'submit', class: 'btn' }, 'Hinzufügen')),
        h('button', { type: 'button', class: 'link', style: { alignSelf: 'flex-start' }, onclick: () => update((s) => { s.ui.setupSkipPeople = true; }) }, 'Später')),
    },
  ];
  return stepsCard('Einrichten', steps, () => ctx.adminSet((s) => { s.setupDone = true; }, 'Einrichtung abgeschlossen'));
}

// ---------- Platz übernehmen („Wer bist du?“ / „Bist du Max?“) ----------

const claimUi = { pick: null, newName: '' };

/** „Bist du Max?“ – zeigt, was der Fahrer eingetragen hat, und übernimmt den Platz. */
function confirmClaim(pid, { personal = false } = {}) {
  const p = personById(pid);
  if (!p) return null;
  const owe = debtItems().filter((d) => d.from === pid && d.open > 0).reduce((a, d) => a + d.open, 0);
  const driver = personById(state.defaultDriver);
  return h('section', { class: 'card claim-confirm' },
    h('div', { class: 'row gap' }, avatar(state.defaultDriver, { size: 'md' }),
      h('div', { class: 'grow' }, h('strong', {}, `${driver?.name || 'Der Fahrer'} hat dich eingetragen`), h('div', { class: 'muted small' }, personal ? 'Persönliche Einladung' : 'Über den Gruppenlink'))),
    h('h2', {}, `Bist du ${p.name}?`),
    h('div', { class: 'list' },
      h('div', { class: 'list-row' }, h('span', { class: 'grow' }, 'Abholung'), h('span', { class: 'value' }, short(p.address?.label) || 'noch offen')),
      h('div', { class: 'list-row' }, h('span', { class: 'grow' }, 'Rhythmus'), h('span', { class: 'value' }, rhythmText(p))),
      h('div', { class: 'list-row' }, h('span', { class: 'grow' }, 'Offen'), h('span', { class: 'value' }, owe > 0.004 ? `${fmtEuro(owe)} an ${driver?.name}` : 'nichts'))),
    h('button', { type: 'button', class: 'btn btn-primary full', onclick: () => safe(async () => { await claimPerson(pid); claimUi.pick = null; toast(`Willkommen, ${p.name}!`, 'ok'); }) }, icon('check', { size: 17 }), 'Ja, das bin ich'),
    h('button', { type: 'button', class: 'btn full', onclick: () => { claimUi.pick = null; clearClaimOffer(); update(() => {}); } }, 'Ich bin jemand anderes'),
    h('p', { class: 'hint small' }, 'Danach pflegst du Adresse und Rhythmus selbst, zahlst direkt in der App und bekommst Bescheid, wenn sich etwas ändert.'));
}

function whoAreYou() {
  const taken = claims();
  const free = activePersons().filter((p) => !taken.has(p.id) && !p.self);
  const withApp = activePersons().filter((p) => taken.has(p.id));
  return h('section', { class: 'card' },
    h('h2', {}, 'Wer bist du?'),
    h('p', { class: 'hint' }, 'Such deinen Namen aus – den Platz hat der Fahrer schon für dich angelegt.'),
    free.length ? h('div', { class: 'list' }, free.map((p) => h('button', { type: 'button', class: 'list-row', onclick: () => { claimUi.pick = p.id; update(() => {}); } },
      avatar(p.id, { size: 'sm' }),
      h('span', { class: 'grow' }, h('span', { class: 'title' }, p.name), h('span', { class: 'sub' }, [short(p.address?.label), rhythmText(p)].filter(Boolean).join(' · '))),
      h('span', { class: 'chev' }, icon('chevron-right', { size: 18 }))))) : null,
    withApp.length ? h('div', { class: 'list muted-list' }, withApp.map((p) => h('div', { class: 'list-row' }, avatar(p.id, { size: 'sm' }), h('span', { class: 'grow' }, p.name), h('span', { class: 'value' }, 'hat die App')))) : null,
    h('form', { class: 'row gap', onsubmit: (e) => { e.preventDefault(); if (claimUi.newName.trim()) safe(() => claimNew(claimUi.newName.trim())); } },
      h('input', { type: 'text', placeholder: 'Ich bin neu – mein Name', 'data-focus-key': 'claim-new', value: claimUi.newName, oninput: (e) => { claimUi.newName = e.target.value; } }),
      h('button', { type: 'submit', class: 'btn btn-small' }, 'Eintragen')));
}

function memberSetup() {
  const mine = me();
  const person = personById(mine);
  const prof = myProfile();
  const steps = [
    {
      title: 'Abholadresse', done: !!(person?.address?.lat || prof.noAddress), summary: person?.address?.label || 'Steigt beim Fahrer zu',
      hint: 'Hier wirst du abgeholt – du zahlst ab hier.',
      body: () => h('div', {},
        addressInput({ value: person?.address, placeholder: 'Deine Adresse', allowLocate: true, near: personById(state.defaultDriver)?.address, focusKey: 'm-addr', onSelect: (a) => safe(() => setAddress(mine, a)) }),
        h('button', { type: 'button', class: 'link', style: { marginTop: '.5rem' }, onclick: () => updateProfile((d) => { d.noAddress = true; }) }, 'Ich steige beim Fahrer zu')),
    },
    {
      title: 'Rhythmus', done: hasPlan(person) && !!prof.planChecked, summary: rhythmText(person),
      hint: 'Wann fährst du normalerweise mit? Einzelne Tage änderst du jederzeit im Plan.',
      body: () => rhythmEditor({ pid: mine, saveLabel: 'Weiter', onSaved: () => updateProfile((d) => { d.planChecked = true; }) }),
    },
  ];
  return stepsCard(`Hallo ${person?.name || ''}`, steps, () => updateProfile((d) => { d.onboarded = true; }));
}

// ---------- Neue Übernahmen (Admin) ----------

function claimNotices() {
  const list = newClaims();
  if (!list.length) return null;
  return h('section', { class: 'notice-card' }, list.map((c) => h('div', { class: 'notice-item' },
    personById(c.personId) ? avatar(c.personId, { size: 'md' }) : h('span', { class: 'sq sq-green' }, icon('user-plus', { size: 16 })),
    h('div', { class: 'grow' },
      h('div', {}, h('strong', {}, c.self ? `${nameOf(c.personId)} ist neu dabei` : `${nameOf(c.personId)} ist jetzt mit der App dabei`)),
      h('div', { class: 'muted small' }, c.self ? `Neu über den Gruppenlink · Konto: ${c.name}` : `Hat den Platz „${nameOf(c.personId)}“ übernommen · Konto: ${c.name}`),
      h('div', { class: 'row gap', style: { marginTop: '.4rem' } },
        h('button', { type: 'button', class: 'btn btn-small btn-paid', onclick: () => ackClaim(c.userId) }, icon('check', { size: 15 }), 'Passt'),
        h('button', {
          type: 'button', class: 'btn btn-small btn-no',
          onclick: () => { if (confirm(`${c.name} aus der Fahrgemeinschaft entfernen? Der Platz „${nameOf(c.personId)}“ ist dann wieder frei.`)) safe(async () => { await removeMember(c.userId); ackClaim(c.userId); toast('Rückgängig gemacht – der Platz ist wieder frei'); }); },
        }, icon('undo-2', { size: 15 }), 'Rückgängig'))))));
}

// ---------- Nächste Fahrt ----------

const dayLabel = (date) => {
  const t0 = todayIso();
  const base = fmtDate(date, { weekday: true });
  return date === t0 ? `Heute · ${base}` : date === addDays(t0, 1) ? `Morgen · ${base}` : base;
};

/** Ist die heutige Fahrt schon vorbei? (nach der Rückfahrt, ohne Uhrzeit ab 18 Uhr) */
function todayDone() {
  const now = new Date();
  const min = now.getHours() * 60 + now.getMinutes();
  const end = parseTime(state.times?.leave) ?? parseTime(state.times?.arrive);
  return min > (end != null ? end + 60 : 18 * 60);
}

/** Der nächste Tag mit einer Fahrt der Gruppe oder an dem ich laut Plan dabei wäre. */
function nextDate(mine, horizon = 60) {
  const m = model();
  const t0 = todayIso();
  const p = personById(mine);
  for (let k = 0; k < horizon; k++) {
    const date = addDays(t0, k);
    if (k === 0 && todayDone()) continue;
    const info = m.dayInfo(date);
    if (info.off) continue;
    const trip = dirsNow().some((dir) => info.riders[dir]?.length && info.driver[dir]);
    const planned = p && !info.free && dirsNow().some((dir) => planOn(p, date)[dir][(new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7]);
    const noDriver = dirsNow().some((dir) => info.riders[dir]?.length && !info.driver[dir]);
    if (trip || planned || noDriver) return date;
  }
  return null;
}

/** Stopps einer Fahrt mit Uhrzeiten: [{ name, owners, time }] */
function timedStops(date, dir) {
  const r = tripResult(date, dir);
  if (!r) return null;
  const res = resolveLegs(r.trip, r.trip.snap, dir);
  if (!res.stops?.length) return { stops: [], trip: r.trip, result: r.result };
  const times = stopTimes(res.legs, dir, state.times || {});
  return { trip: r.trip, result: r.result, stops: res.stops.map((s, i) => ({ ...s, time: times ? times[i] : null })) };
}

function nextTripCard(ctx, mine) {
  const date = nextDate(mine);
  const m = model();
  if (!date) {
    const free = upcomingFree(1)[0];
    return h('section', { class: 'card trip-card' },
      h('span', { class: 'plabel' }, 'Nächste Fahrt'),
      h('div', { class: 'big' }, 'Keine Fahrten geplant'),
      h('p', { class: 'hint' }, free && free.start <= addDays(todayIso(), 14) ? `${free.name} bis ${fmtDate(free.end)}.` : 'Im Plan festlegen, wer wann fährt.'),
      h('button', { type: 'button', class: 'btn btn-small', style: { alignSelf: 'flex-start' }, onclick: () => ctx.go('trips') }, icon('calendar-days', { size: 15 }), 'Zum Plan'));
  }
  const info = m.dayInfo(date);
  const dirs = dirsNow();
  const iDrive = dirs.some((dir) => info.driver[dir] === mine);
  const myDirs = dirs.filter((dir) => info.riders[dir]?.includes(mine));
  const hin = dirs.includes('hin') ? timedStops(date, 'hin') : null;
  const back = dirs.includes('rueck') ? timedStops(date, 'rueck') : null;
  const driver = info.driver.hin || info.driver.rueck || null;
  const noDriver = dirs.filter((dir) => info.riders[dir]?.length && !info.driver[dir]);
  const timesMissing = !state.times?.arrive;
  const timesLink = timesMissing && isAdmin() ? h('button', { type: 'button', class: 'link small', style: { alignSelf: 'flex-start' }, onclick: () => openSheet('times') }, 'Uhrzeiten festlegen – dann siehst du die Abholzeiten') : null;
  // Wer fährt normalerweise mit, aber diesmal nicht?
  const wd = (new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7;
  const missing = activePersons().filter((p) => p.id !== mine && !info.free && dirs.some((dir) => planOn(p, date)[dir][wd]) && !dirs.some((dir) => info.riders[dir]?.includes(p.id)));

  if (iDrive) {
    const stops = hin?.stops || [];
    const start = stops[0]?.time;
    return h('section', { class: 'card trip-card' },
      h('span', { class: 'plabel' }, dayLabel(date)),
      h('div', { class: 'big' }, start != null ? `Du fährst · los um ${fmtTime(start)}` : 'Du fährst'),
      stops.length ? h('ol', { class: 'timeline' }, stops.map((s, i) => h('li', { class: i === 0 ? 'me' : '' },
        h('span', { class: 'tl-time' }, s.time != null ? fmtTime(s.time) : ''),
        h('span', { class: `tl-dot ${s.via ? 'via' : ''}` }),
        h('span', { class: 'tl-name' }, i === 0 ? 'Start' : s.via ? s.name : s.owners?.length ? s.owners.map(nameOf).join(', ') : s.name)))) : null,
      missing.length ? h('span', { class: 'pill-note' }, `${missing.map((p) => p.name).join(', ')} ${missing.length > 1 ? 'fahren' : 'fährt'} nicht mit`) : null,
      back?.stops?.length ? h('span', { class: 'muted small' }, `Zurück ab ${back.stops[0].time != null ? fmtTime(back.stops[0].time) : '–'}${back.stops.at(-1).time != null ? ` · zu Hause ca. ${fmtTime(back.stops.at(-1).time)}` : ''}`) : null,
      timesLink,
      h('button', { type: 'button', class: 'btn btn-small', style: { alignSelf: 'flex-start' }, onclick: () => openSheet('day', { date }) }, 'Tag ändern'));
  }

  const inNow = myDirs.length > 0;
  const myStopHin = hin?.stops?.find((s) => s.owners?.includes(mine));
  const myStopBack = back?.stops?.find((s) => s.owners?.includes(mine));
  const why = mine ? m.ridesWhy(mine, date, dirs[0]).why : null;
  const abs = absenceOn(personById(mine), date);
  const outText = abs ? `${REASONS[abs.reason] || 'Abwesend'} bis ${fmtDate(abs.until || abs.from)}` : why === 'day' ? 'Du hast abgesagt.' : 'Laut Plan nicht dabei.';
  const big = !inNow ? 'Du bist nicht dabei'
    : noDriver.length === dirs.length ? 'Noch kein Fahrer'
      : myStopHin?.time != null ? `Abholung ${fmtTime(myStopHin.time)}` : `${nameOf(driver)} fährt`;
  const sub = !inNow ? outText
    : [
      driver ? `${driver === info.regular ? '' : 'Vertretung: '}${nameOf(driver)} holt dich ab${myStopHin && personById(mine)?.address?.label ? ` (${short(personById(mine).address.label)})` : ''}` : `${nameOf(info.regular)} fährt an dem Tag nicht`,
      back?.stops?.length && myDirs.includes('rueck') ? `zurück ab ${back.stops[0].time != null ? fmtTime(back.stops[0].time) : '–'}${myStopBack?.time != null ? `, zu Hause ca. ${fmtTime(myStopBack.time)}` : ''}` : null,
    ].filter(Boolean).join(' · ');
  const set = (v) => safe(() => setDay(mine, date, Object.fromEntries(dirs.map((dir) => [dir, v]))));
  return h('section', { class: 'card trip-card' },
    h('span', { class: 'plabel' }, dayLabel(date)),
    h('div', { class: 'big' }, big),
    h('span', { class: 'muted' }, sub),
    mine ? h('div', { class: 'segmented' },
      h('button', { type: 'button', class: inNow ? 'active' : '', onclick: () => !inNow && set(true) }, 'Ich fahre mit'),
      h('button', { type: 'button', class: !inNow ? 'active' : '', onclick: () => inNow && set(false) }, 'Nicht dabei')) : null,
    timesLink,
    h('button', { type: 'button', class: 'link small', style: { alignSelf: 'flex-start' }, onclick: () => openSheet('day', { date }) }, 'Nur hin oder nur zurück?'));
}

// ---------- Vertretung: „Übernimmst du?“ ----------

/** Tage in den nächsten zwei Wochen ohne Fahrer, gruppiert nach normalem Fahrer: [{ regular, dates }] */
function driverGaps(horizon = 14) {
  const m = model();
  const t0 = todayIso();
  const out = new Map();
  for (let k = 0; k < horizon; k++) {
    const date = addDays(t0, k);
    const info = m.dayInfo(date);
    if (info.off || !dirsNow().some((dir) => info.riders[dir]?.length && !info.driver[dir])) continue;
    if (!out.has(info.regular)) out.set(info.regular, []);
    out.get(info.regular).push(date);
  }
  return [...out.entries()].map(([regular, dates]) => ({ regular, dates }));
}

const datesText = (dates) => (dates.length === 1 ? fmtDate(dates[0], { weekday: true }) : `${fmtDate(dates[0])} – ${fmtDate(dates.at(-1))}`);

function substituteCard(mine) {
  const gaps = driverGaps();
  if (!gaps.length) return null;
  const m = model();
  const p = personById(mine);
  const iCan = p && m.canDrive(p);
  const dismissed = new Set(state.ui.dismissedGaps || []);
  const items = gaps.filter((g) => !dismissed.has(`${g.regular}|${g.dates.join()}`));
  if (!items.length) return null;
  return h('section', { class: 'notice-card warn' }, items.map((g) => {
    const abs = absenceOn(personById(g.regular), g.dates[0]);
    const reason = abs ? `ist ${abs.reason === 'sick' ? 'krank' : abs.reason === 'vacation' ? 'im Urlaub' : 'abwesend'}` : 'fährt nicht';
    const key = `${g.regular}|${g.dates.join()}`;
    const myAbsent = g.dates.some((d) => absenceOn(p, d));
    return h('div', { class: 'notice-item' },
      avatar(g.regular, { size: 'md' }),
      h('div', { class: 'grow' },
        h('div', {}, h('strong', {}, g.regular === mine ? `Du ${abs ? (abs.reason === 'sick' ? 'bist krank' : abs.reason === 'vacation' ? 'bist im Urlaub' : 'bist abwesend') : 'fährst laut Plan nicht'}` : `${nameOf(g.regular)} ${reason}`), ` – ${datesText(g.dates)} kein Fahrer.`),
        iCan && !myAbsent && g.regular !== mine
          ? [h('div', { class: 'muted small' }, 'Übernimmst du die Fahrten? Gerechnet wird dann mit deinem Auto.'),
            h('div', { class: 'row gap', style: { marginTop: '.4rem' } },
              h('button', { type: 'button', class: 'btn btn-small btn-primary', onclick: () => safe(() => { volunteerDrive(mine, g.dates, true); toast('Danke! Du fährst an diesen Tagen.', 'ok'); }) }, icon('car', { size: 15 }), 'Ich fahre'),
              h('button', { type: 'button', class: 'btn btn-small', onclick: () => update((s) => { s.ui.dismissedGaps = [...(s.ui.dismissedGaps || []), key]; }) }, 'Nein'))]
          : h('div', { class: 'muted small' }, 'Übernimmt niemand, fallen die Fahrten aus – dann zahlt auch niemand.')));
  }));
}

// ---------- Hinweise (höchstens zwei) ----------

function hints(mine) {
  const out = [];
  const t0 = todayIso();
  const date = nextDate(mine) || t0;
  // Umleitung an der nächsten Fahrt
  for (const d of activeDetours(state.detours, date)) {
    const dir = d.dir === 'rueck' ? 'Rückfahrt' : d.dir === 'hin' ? 'Hinfahrt' : 'Hin- und Rückfahrt';
    out.push({ kind: 'detour', icon: 'construction', color: 'orange', title: `${dir} mit Umleitung${d.until ? ` bis ${fmtDate(d.until)}` : ''}`, text: `über ${d.place}`, go: 'route' });
    break;
  }
  // Fahrfreie Zeit: läuft gerade oder beginnt in den nächsten 7 Tagen
  const free = upcomingFree(2).find((f) => f.start <= addDays(t0, 7));
  if (free) {
    const running = free.start <= t0;
    out.push({ kind: 'free', icon: free.kind === 'public' ? 'flag' : 'sun', color: 'yellow',
      title: running ? `${free.name} bis ${fmtDate(free.end)}` : `${free.start === addDays(t0, 1) ? 'Morgen' : `Ab ${fmtDate(free.start, { weekday: true, long: true }).split(',')[0]}`}: ${free.name}`,
      text: `${free.start === free.end || running ? 'Keine Fahrten' : `Keine Fahrten bis ${fmtDate(free.end)}`} – fährt jemand trotzdem, Tag im Plan antippen.`, go: 'trips' });
  }
  // Eigene Abwesenheit
  const p = personById(mine);
  const abs = p && (absenceOn(p, t0) || (p.absences || []).filter((a) => !a.deleted && a.from > t0 && a.from <= addDays(t0, 7)).sort((a, b) => a.from.localeCompare(b.from))[0]);
  if (abs) out.push({ kind: 'abs', icon: 'palm-tree', color: 'teal', title: `${REASONS[abs.reason] || 'Abwesend'} ${spanText(abs.from, abs.until)}`, text: 'An diesen Tagen fährst du nicht mit.', sheet: ['absence', { pid: mine }] });
  return out.slice(0, 2);
}

function hintList(ctx, mine) {
  const list = hints(mine);
  if (!list.length) return null;
  return h('div', { class: 'list' }, list.map((x) => h('button', {
    type: 'button', class: 'list-row has-sq hint-row', onclick: () => (x.sheet ? openSheet(...x.sheet) : ctx.go(x.go)),
  }, h('span', { class: `sq sq-${x.color}` }, icon(x.icon, { size: 15 })),
  h('span', { class: 'grow' }, h('span', { class: 'title' }, x.title), h('span', { class: 'sub' }, x.text)),
  h('span', { class: 'chev' }, icon('chevron-right', { size: 18 })))));
}

// ---------- Geld ----------

function moneyCard(ctx, mine) {
  const bal = myBalance(mine);
  const week = myWeek(mine, mondayOf(todayIso()));
  const weekLine = week.trips ? `Diese Woche: ${fmtEuro(week.done)} bisher${week.planned ? ` · ${fmtEuro(week.planned)} geplant` : ''}` : null;
  if (bal.oweTotal > 0.004) {
    const tos = [...new Set(bal.owe.map((p) => p.to))];
    const to = personById(tos[0]);
    const link = tos.length === 1 ? paypalLink(paypalUser(to?.paypal), bal.oweTotal) : '';
    return h('section', { class: 'hero owe' },
      h('div', { class: 'hero-label' }, 'Du zahlst'),
      h('div', { class: 'hero-amount' }, fmtEuro(bal.oweTotal)),
      h('div', { class: 'hero-sub' }, `an ${tos.map(nameOf).join(', ')}${weekLine ? ` · ${weekLine}` : ''}`),
      h('div', { class: 'row gap wrap' },
        link ? h('a', { class: 'btn btn-white', href: link, target: '_blank', rel: 'noopener' }, icon('wallet', { size: 17 }), 'Mit PayPal bezahlen') : null,
        h('button', { type: 'button', class: 'btn btn-glass', onclick: () => ctx.go('costs') }, link ? 'Ich habe bezahlt' : 'Bezahlen')));
  }
  if (bal.pendingOut > 0.004) {
    return h('section', { class: 'hero good' },
      h('div', { class: 'hero-label' }, 'Bezahlt gemeldet'),
      h('div', { class: 'hero-amount' }, fmtEuro(bal.pendingOut)),
      h('div', { class: 'hero-sub' }, `Wartet auf Bestätigung${weekLine ? ` · ${weekLine}` : ''}`));
  }
  if (bal.getTotal > 0.004) {
    return h('button', { type: 'button', class: 'hero good hero-btn', onclick: () => ctx.go('costs') },
      h('div', { class: 'hero-label' }, 'Du bekommst'),
      h('div', { class: 'hero-amount' }, fmtEuro(bal.getTotal)),
      h('div', { class: 'hero-sub' }, `von ${bal.get.map((p) => nameOf(p.from)).join(', ')}`));
  }
  return h('section', { class: 'card money-ok' },
    h('span', { class: 'sq sq-green' }, icon('check', { size: 16 })),
    h('div', { class: 'grow' }, h('strong', {}, 'Alles bezahlt'), weekLine ? h('div', { class: 'muted small' }, weekLine) : null));
}

// ---------- Uhrzeiten (Fenster) ----------

register('times', () => {
  const d = { arrive: state.times?.arrive || '', leave: state.times?.leave || '' };
  return [
    sheetHead('Uhrzeiten', 'Daraus rechnet die App die Abholzeiten'),
    h('div', { class: 'card' },
      timesFields(d),
      h('button', { type: 'button', class: 'btn btn-primary full', onclick: () => { if (safe(() => adminSet((s) => { s.times = { arrive: d.arrive, leave: d.leave }; }, `Uhrzeiten: an ${d.arrive || '–'}, zurück ab ${d.leave || '–'}`))) closeSheet(); } }, icon('check', { size: 17 }), 'Speichern')),
    h('p', { class: 'hint small' }, 'Die Abholzeiten werden rückwärts von der Ankunft gerechnet – mit der Fahrzeit des Routenplaners und einer Minute je Halt.'),
  ];
});

// ---------- Ansicht ----------

export function renderHome(el, ctx) {
  if (!state.ui.welcomeDone && !inGroup() && !hasPendingJoin()) { el.append(welcome(ctx)); return; }

  const admin = isAdmin();
  let mine = me();
  // Platz übernehmen: persönlicher Link → „Bist du Max?“, sonst „Wer bist du?“
  if (inGroup() && !admin && !mine) {
    const offer = pendingClaim();
    const pick = claimUi.pick || (offer && !claims().has(offer) ? offer : null);
    el.append(pick ? confirmClaim(pick, { personal: !!offer && pick === offer }) : whoAreYou());
    return;
  }
  if (inGroup() && admin && !mine) { el.append(whoAreYou()); return; }
  if (admin && !state.setupDone) el.append(adminSetup(ctx));
  if (inGroup() && !admin) {
    const prof = myProfile();
    const person = personById(mine);
    if (!prof.onboarded && !(person && (person.address?.lat || prof.noAddress) && hasPlan(person))) { el.append(memberSetup()); return; }
  }
  if (!mine) {
    el.append(h('section', { class: 'card' }, h('h2', {}, 'Wer bist du?'),
      h('div', { class: 'claim-grid' }, activePersons().map((p) => h('button', { type: 'button', class: 'claim-btn', onclick: () => safe(() => claimPerson(p.id)) }, h('span', { class: 'dot', style: { '--pc': p.color } }), p.name)))));
    return;
  }
  if (admin && !state.setupDone && !(state.destination && personById(state.defaultDriver)?.address)) return;
  mine = me();
  el.append(...[
    claimNotices(),
    confirmCard(),
    nextTripCard(ctx, mine),
    substituteCard(mine),
    hintList(ctx, mine),
    moneyCard(ctx, mine),
    soloInvite(ctx),
  ].filter(Boolean));
}

/** Allein unterwegs oder Plätze ohne App: Hinweis zum Einladen (dezent, ganz unten). */
function soloInvite(ctx) {
  if (!isAdmin()) return null;
  const others = activePersons().filter((p) => p.id !== me());
  const open = inGroup() ? others.filter((p) => isPlaceholder(p.id)) : others;
  if (inGroup() && !open.length) return null;
  return h('button', { type: 'button', class: 'list list-row has-sq', onclick: () => (inGroup() ? openSheet('invite') : ctx.openAccount(isLoggedIn() ? undefined : 'register')) },
    h('span', { class: 'sq sq-blue' }, icon('user-plus', { size: 16 })),
    h('span', { class: 'grow' },
      h('span', { class: 'title' }, inGroup() ? `${open.length} ${open.length === 1 ? 'Platz' : 'Plätze'} ohne App` : 'Mitfahrer einladen'),
      h('span', { class: 'sub' }, inGroup() ? `${open.map((p) => p.name).join(', ')} – mit Link oder QR-Code einladen` : 'Konto anlegen – dann zahlt jeder selbst in der App und bekommt Bescheid')),
    h('span', { class: 'chev' }, icon('chevron-right', { size: 18 })));
}

export { isActive, weekDates };
