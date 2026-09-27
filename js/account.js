// Konto & Fahrgemeinschaft: Anmelden, Gruppe anlegen/beitreten, einladen, synchronisieren.
import { state, update, sharedData, applyRemote, onChange, uid, COLORS, defaultState } from './state.js';
import { icon } from './icons.js';
import * as cloud from './cloud.js';
import { createSync } from './sync.js';
import { h, toast } from './ui.js';

const META_KEY = 'tankrechner:cloud';
const BACKUP_KEY = 'tankrechner:local-backup';

const load = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
const store = (k, v) => { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); } catch { /* egal */ } };

let user = null;
let meta = load(META_KEY, {}); // { groupId, groupName, personId }
let syncStatus = 'synced';
let unwatch = null;
let groups = [];
let info = null; // { name, invite_code }
let memberList = [];
let authMode = 'login';
let error = '';
let busy = false;
let pendingJoin = null;
let live = false; // steht die Live-Verbindung?

const sync = createSync({
  backend: cloud.backend,
  getShared: () => sharedData(state),
  applyRemote,
  onStatus: (s) => { syncStatus = s; renderButton(false); },
});

// ---------- Für andere Module ----------

export const inGroup = () => !!(user && meta.groupId);
export const myPersonId = () => (inGroup() ? meta.personId || null : null);
export const myName = () => cloud.userName(user);
export const isLoggedIn = () => !!user;
export const groupName = () => (inGroup() ? meta.groupName : null);
export const syncState = () => syncStatus;

/** Wer hat welche Person beansprucht? Map personId → Anzeigename (nur in einer Fahrgemeinschaft). */
export function claims() {
  const m = new Map();
  if (inGroup()) for (const x of memberList) if (x.person_id) m.set(x.person_id, { name: x.display_name || 'Jemand', me: x.user_id === user?.id });
  return m;
}

/** Diese Person als „Das bin ich“ beanspruchen (null = Zuordnung lösen). */
export async function claimPerson(personId) {
  if (!inGroup()) { update((s) => { s.ui.me = personId; }); return; }
  const taken = claims().get(personId);
  if (personId && taken && !taken.me) throw new Error(`${taken.name} hat diese Person schon beansprucht.`);
  await cloud.setMyPerson(meta.groupId, personId);
  meta.personId = personId;
  store(META_KEY, meta);
  memberList = await cloud.members(meta.groupId);
  update(() => {});
}

// ---------- Gruppe aktivieren / verlassen ----------

async function activate(groupId, groupName, personId) {
  if (!meta.groupId && !load(BACKUP_KEY, null)) store(BACKUP_KEY, sharedData(state)); // eigene lokale Daten sichern
  unwatch?.();
  meta = { groupId, groupName, personId: personId ?? null };
  store(META_KEY, meta);
  await sync.start(groupId);
  unwatch = await cloud.watchGroup(groupId, (v) => sync.remoteChanged(v), (ok) => { live = ok; });
  refreshGroupDetails();
  renderButton();
}

function deactivate({ restore = true } = {}) {
  sync.stop();
  unwatch?.();
  unwatch = null;
  meta = {};
  store(META_KEY, null);
  info = null;
  memberList = [];
  const backup = load(BACKUP_KEY, null);
  if (restore) applyRemote(backup || sharedData(defaultState()), []);
  store(BACKUP_KEY, null);
  renderButton();
}

async function refreshGroupDetails() {
  if (!meta.groupId) return;
  try {
    [info, memberList, groups] = await Promise.all([cloud.groupInfo(meta.groupId), cloud.members(meta.groupId), cloud.myGroups()]);
    const mine = groups.find((g) => g.id === meta.groupId);
    if (mine) { meta.groupName = mine.name; meta.personId = mine.personId; store(META_KEY, meta); }
  } catch (e) {
    if (/0 rows|JSON object requested/i.test(e.message)) { toast('Du bist nicht mehr Mitglied dieser Fahrgemeinschaft', 'error'); deactivate(); }
  }
  renderButton();
  renderDialog();
}

// ---------- Kopfzeilen-Knopf ----------

function renderButton(notify = true) {
  const title = { synced: 'Gespeichert', saving: 'Wird gespeichert …', offline: 'Offline – wird später gespeichert' }[syncStatus];
  for (const btn of [document.getElementById('btn-account'), document.getElementById('btn-account-mobile')]) {
    if (!btn) continue;
    btn.replaceChildren(...(inGroup()
      ? [h('span', { class: `acc-status ${syncStatus}`, title }), h('span', { class: 'acc-label' }, meta.groupName || 'Fahrgemeinschaft')]
      : [icon(user ? 'circle-user' : 'user', { size: 18 }), h('span', { class: 'acc-label' }, user ? cloud.userName(user) : 'Anmelden')]));
    btn.classList.toggle('in-group', inGroup());
    btn.title = inGroup() ? `${meta.groupName} – ${title}` : 'Konto & Fahrgemeinschaft';
  }
  // Übrige Ansicht (z. B. Einstellungen, Übersicht) aktualisieren – nicht bei reinen Speicherstatus-Wechseln (sonst verliert man beim Tippen den Fokus)
  if (notify) document.dispatchEvent(new CustomEvent('account-changed'));
}

// ---------- Dialog ----------

const dialog = () => document.getElementById('account-dialog');

export function openAccount() {
  error = '';
  renderDialog();
  dialog().showModal();
  if (user) cloud.myGroups().then((g) => { groups = g; renderDialog(); }).catch(() => {});
  if (inGroup()) refreshGroupDetails();
}

async function act(fn) {
  busy = true;
  error = '';
  renderDialog();
  try { await fn(); } catch (e) { error = e.message; }
  busy = false;
  renderDialog();
}

function authView() {
  let name = '';
  let email = '';
  let password = '';
  const register = authMode === 'register';
  return h('form', {
    class: 'acc-form',
    onsubmit: (e) => {
      e.preventDefault();
      act(async () => {
        user = register ? await cloud.signUp(email.trim(), password, name.trim() || email.split('@')[0]) : await cloud.signIn(email.trim(), password);
        groups = await cloud.myGroups();
        renderButton();
        if (pendingJoin) await doJoin(pendingJoin);
      });
    },
  },
    h('div', { class: 'segmented' },
      h('button', { type: 'button', class: !register ? 'active' : '', onclick: () => { authMode = 'login'; error = ''; renderDialog(); } }, 'Anmelden'),
      h('button', { type: 'button', class: register ? 'active' : '', onclick: () => { authMode = 'register'; error = ''; renderDialog(); } }, 'Neu registrieren'),
    ),
    pendingJoin ? h('p', { class: 'callout good' }, 'Du wurdest in eine Fahrgemeinschaft eingeladen. Melde dich an oder registriere dich, um beizutreten.') : null,
    register ? h('label', { class: 'field' }, 'Dein Name', h('input', { type: 'text', required: true, autocomplete: 'name', oninput: (e) => { name = e.target.value; } })) : null,
    h('label', { class: 'field' }, 'E-Mail', h('input', { type: 'email', required: true, autocomplete: 'email', oninput: (e) => { email = e.target.value; } })),
    h('label', { class: 'field' }, 'Passwort', h('input', { type: 'password', required: true, minlength: 6, autocomplete: register ? 'new-password' : 'current-password', oninput: (e) => { password = e.target.value; } })),
    h('button', { type: 'submit', class: 'btn btn-primary full', disabled: busy }, busy ? 'Einen Moment …' : register ? 'Konto anlegen' : 'Anmelden'),
    h('p', { class: 'hint small' }, 'Mit Konto teilt ihr eine Fahrgemeinschaft: Alle sehen dieselben Fahrten und jeder kann abhaken, was er bezahlt hat. Ohne Anmeldung bleibt alles nur in diesem Browser.'),
  );
}

async function doJoin(code) {
  const g = await cloud.joinGroup(code, cloud.userName(user));
  pendingJoin = null;
  try { sessionStorage.removeItem('tankrechner:join'); } catch { /* egal */ }
  await activate(g.id, g.name, null);
  toast(`Willkommen in „${g.name}“!`, 'ok');
}

function inviteLink() {
  return info?.invite_code ? `${location.origin}${location.pathname}#join=${info.invite_code}` : '';
}

function groupView() {
  const link = inviteLink();
  const personOptions = [h('option', { value: '' }, '– bitte auswählen –'), ...state.persons.map((p) => h('option', { value: p.id, selected: p.id === meta.personId }, p.name)), h('option', { value: '__new' }, `Mich als neue Person anlegen („${cloud.userName(user)}“)`)];
  const nameOf = (pid) => state.persons.find((p) => p.id === pid)?.name;
  return h('section', { class: 'acc-group' },
    h('div', { class: 'row between' }, h('h3', {}, meta.groupName || 'Fahrgemeinschaft'), h('span', { class: 'muted small row gap', style: { gap: '.35rem' } }, h('span', { class: `acc-status ${syncStatus}` }), { synced: 'gespeichert', saving: 'speichert …', offline: 'offline' }[syncStatus])),
    h('label', { class: 'field' }, 'Wer bist du in dieser Fahrgemeinschaft?',
      h('select', {
        onchange: (e) => act(async () => {
          let pid = e.target.value;
          if (pid === '__new') {
            pid = uid();
            update((s) => { s.persons.push({ id: pid, name: cloud.userName(user), color: COLORS[s.persons.length % COLORS.length] }); });
          }
          await cloud.setMyPerson(meta.groupId, pid || null);
          meta.personId = pid || null;
          store(META_KEY, meta);
          memberList = await cloud.members(meta.groupId);
          update(() => {}); // Abrechnung mit „Du“ neu zeichnen
        }),
      }, personOptions)),
    !meta.personId ? h('p', { class: 'hint warn small' }, 'Wähle dich aus – dann siehst du in der Abrechnung sofort, was du noch zahlen musst.') : null,
    h('div', {},
      h('div', { class: 'muted small' }, 'Einladungslink – an die Kollegen schicken:'),
      h('div', { class: 'invite' },
        h('input', { type: 'text', readonly: true, value: link || 'wird geladen …', onfocus: (e) => e.target.select() }),
        h('button', {
          type: 'button', class: 'btn btn-small btn-primary', disabled: !link,
          onclick: async () => { try { await navigator.clipboard.writeText(link); toast('Einladungslink kopiert', 'ok'); } catch { prompt('Link kopieren:', link); } },
        }, icon('copy', { size: 15 }), 'Kopieren'),
      ),
    ),
    memberList.length ? h('div', {},
      h('div', { class: 'muted small' }, `Mitglieder (${memberList.length})`),
      h('ul', { class: 'members' }, memberList.map((m) => h('li', {}, m.display_name || 'Unbekannt', m.person_id ? h('span', { class: 'muted' }, ` = ${nameOf(m.person_id) || '?'}`) : h('span', { class: 'muted' }, ' (noch nicht zugeordnet)'), m.user_id === user.id ? h('strong', {}, ' · du') : null))),
    ) : null,
    h('div', { class: 'row gap wrap' },
      h('button', { type: 'button', class: 'btn btn-small btn-ghost', onclick: () => { deactivate(); renderDialog(); toast('Wieder lokal – deine eigenen Daten sind zurück'); } }, 'Nur lokal arbeiten'),
      h('button', {
        type: 'button', class: 'btn btn-small btn-ghost danger-text',
        onclick: () => {
          if (!confirm(`„${meta.groupName}“ wirklich verlassen? Du siehst die gemeinsamen Daten dann nicht mehr (die anderen schon).`)) return;
          act(async () => { await cloud.leaveGroup(meta.groupId); deactivate(); groups = await cloud.myGroups(); });
        },
      }, 'Fahrgemeinschaft verlassen'),
    ),
  );
}

function groupsView() {
  let newName = '';
  let takeData = true;
  let code = '';
  const others = groups.filter((g) => g.id !== meta.groupId);
  return h('div', { class: 'acc-groups' },
    others.length ? h('section', {},
      h('h3', {}, inGroup() ? 'Andere Fahrgemeinschaften' : 'Deine Fahrgemeinschaften'),
      h('ul', { class: 'group-list' }, others.map((g) => h('li', {},
        h('span', {}, g.name),
        h('button', { type: 'button', class: 'btn btn-small', disabled: busy, onclick: () => act(() => activate(g.id, g.name, g.personId)) }, 'Öffnen')))),
    ) : null,
    h('section', {},
      h('h3', {}, 'Neue Fahrgemeinschaft'),
      h('form', {
        class: 'acc-form',
        onsubmit: (e) => {
          e.preventDefault();
          act(async () => {
            const me = state.persons.find((p) => p.id === state.defaultDriver) || state.persons[0];
            const data = takeData ? sharedData(state) : sharedData(defaultState());
            const personId = takeData ? me?.id : data.persons[0]?.id;
            const g = await cloud.createGroup(newName.trim(), data, cloud.userName(user), personId);
            groups = await cloud.myGroups();
            await activate(g.id, g.name, personId);
            toast(`„${g.name}“ angelegt – jetzt Einladungslink kopieren und verschicken`, 'ok');
          });
        },
      },
        h('input', { type: 'text', required: true, maxlength: 80, placeholder: 'Name, z. B. Pendeln Stuttgart', oninput: (e) => { newName = e.target.value; } }),
        h('label', { class: 'check small' }, h('input', { type: 'checkbox', checked: true, onchange: (e) => { takeData = e.target.checked; } }), ' Meine bisherigen Daten (Strecke, Personen, Fahrten) mitnehmen'),
        h('button', { type: 'submit', class: 'btn btn-primary', disabled: busy }, icon('plus', { size: 16 }), 'Anlegen'),
      ),
    ),
    h('section', {},
      h('h3', {}, 'Beitreten'),
      h('form', {
        class: 'acc-form row gap',
        onsubmit: (e) => { e.preventDefault(); act(() => doJoin(parseJoin(code) || code.trim())); },
      },
        h('input', { type: 'text', required: true, placeholder: 'Einladungslink oder Code', oninput: (e) => { code = e.target.value; } }),
        h('button', { type: 'submit', class: 'btn', disabled: busy }, 'Beitreten'),
      ),
    ),
  );
}

function renderDialog() {
  const d = dialog();
  if (!d) return;
  d.replaceChildren(h('div', { class: 'acc' },
    h('div', { class: 'row between' },
      h('h2', {}, user ? 'Konto & Fahrgemeinschaft' : 'Anmelden'),
      h('button', { type: 'button', class: 'icon-btn tinted', 'aria-label': 'Schließen', onclick: () => d.close() }, icon('x', { size: 18 }))),
    error ? h('p', { class: 'acc-error' }, error) : null,
    user
      ? [
        h('div', { class: 'row between acc-user' },
          h('span', {}, `Angemeldet als `, h('strong', {}, cloud.userName(user)), h('span', { class: 'muted small' }, ` (${user.email})`)),
          h('button', {
            type: 'button', class: 'link',
            onclick: () => act(async () => { if (inGroup()) deactivate(); await cloud.signOut(); user = null; groups = []; renderButton(); }),
          }, 'Abmelden')),
        pendingJoin ? h('div', { class: 'callout good' }, 'Einladung erkannt.', h('button', { type: 'button', class: 'btn btn-small btn-primary', disabled: busy, onclick: () => act(() => doJoin(pendingJoin)) }, 'Jetzt beitreten')) : null,
        inGroup() ? groupView() : h('p', { class: 'hint' }, 'Du arbeitest gerade nur lokal auf diesem Gerät.'),
        groupsView(),
      ]
      : authView(),
  ));
}

// ---------- Einladungslink ----------

function parseJoin(text) {
  const m = String(text || '').match(/#join=([A-Za-z0-9]+)/) || String(text || '').match(/^\s*([a-f0-9]{12})\s*$/i);
  return m ? m[1] : null;
}

// ---------- Start ----------

export async function initAccount() {
  document.getElementById('btn-account').onclick = openAccount;
  const mobileBtn = document.getElementById('btn-account-mobile');
  if (mobileBtn) mobileBtn.onclick = openAccount;
  const code = parseJoin(location.hash);
  if (code) {
    pendingJoin = code;
    try { sessionStorage.setItem('tankrechner:join', code); } catch { /* egal */ }
    history.replaceState(null, '', location.pathname + location.search);
  } else {
    try { pendingJoin = sessionStorage.getItem('tankrechner:join'); } catch { /* egal */ }
  }

  onChange((fn) => sync.noteLocalChange(fn));
  renderButton();

  if (cloud.hasStoredSession() || pendingJoin || meta.groupId) {
    try {
      user = await cloud.getUser();
      cloud.onAuthChange((u) => { user = u; if (!u && inGroup()) deactivate(); renderButton(); });
      if (user && meta.groupId) await activate(meta.groupId, meta.groupName, meta.personId);
      else if (!user && meta.groupId) deactivate();
    } catch (e) {
      syncStatus = 'offline';
      toast(`Fahrgemeinschaft nicht erreichbar: ${e.message}`, 'error');
    }
    renderButton();
  }
  if (pendingJoin) openAccount();

  // Nachschauen, ob jemand anderes etwas geändert hat (falls Live-Updates nicht ankommen)
  let lastPoll = 0;
  const poll = (force) => {
    if (!inGroup() || document.hidden) return;
    // Ohne Live-Verbindung alle 15 s nachschauen, sonst nur jede Minute als Absicherung
    if (force !== true && Date.now() - lastPoll < (live ? 60_000 : 15_000)) return;
    lastPoll = Date.now();
    sync.remoteChanged(Infinity);
  };
  document.addEventListener('visibilitychange', () => poll(true));
  window.addEventListener('focus', () => poll(true));
  setInterval(poll, 5_000);
  window.addEventListener('pagehide', () => { if (inGroup()) sync.flush(); });
}
