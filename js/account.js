// Konto & Fahrgemeinschaft: Anmelden, Gruppe anlegen/beitreten, Rollen, eigenes Profil, Synchronisation, Protokoll.
import { state, update, sharedData, applyRemote, onChange, uid, COLORS, defaultState, setProfiles, personById } from './state.js';
import * as cloud from './cloud.js';
import { createSync } from './sync.js';
import { h, toast, debounce } from './ui.js';
import { icon } from './icons.js';

const META_KEY = 'tankrechner:cloud';
const BACKUP_KEY = 'tankrechner:local-backup';

const load = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
const store = (k, v) => { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); } catch { /* egal */ } };

let user = null;
let meta = load(META_KEY, {}); // { groupId, groupName, personId, role }
let syncStatus = 'synced';
let unwatch = [];
let groups = [];
let info = null; // { name, invite_code }
let memberList = [];
let authMode = 'login';
let error = '';
let busy = false;
let pendingJoin = null;
let live = false;

const sync = createSync({
  backend: cloud.backend,
  getShared: () => sharedData(state),
  applyRemote,
  onStatus: (s) => { syncStatus = s; renderButton(false); },
});

// ---------- Für andere Module ----------

export const inGroup = () => !!(user && meta.groupId);
export const isAdmin = () => !inGroup() || meta.role === 'admin';
export const myPersonId = () => (inGroup() ? meta.personId || null : null);
export const myName = () => cloud.userName(user);
export const isLoggedIn = () => !!user;
export const groupName = () => (inGroup() ? meta.groupName : null);
export const members = () => memberList;
export const myUserId = () => user?.id || null;
export const inviteLink = () => (info?.invite_code ? `${location.origin}${location.pathname}#join=${info.invite_code}` : '');

/** Wer hat welche Person beansprucht? Map personId → { name, me, role, userId } */
export function claims() {
  const m = new Map();
  if (inGroup()) for (const x of memberList) if (x.person_id) m.set(x.person_id, { name: x.display_name || 'Jemand', me: x.user_id === user?.id, role: x.role, userId: x.user_id });
  return m;
}

// ---------- Eigenes Profil (Mitfahrer) ----------

export function myProfile() {
  return state.profiles?.find((p) => p.userId === user?.id)?.data || {};
}

const saveMyProfile = debounce(async () => {
  if (!inGroup()) return;
  try { await cloud.saveProfile(meta.groupId, myProfile()); } catch (e) { toast(`Profil konnte nicht gespeichert werden: ${e.message}`, 'error'); }
}, 600);

/** Eigenes Profil ändern (Adresse, Regelplan, Tage, „bezahlt“). */
export function updateProfile(fn) {
  const list = (state.profiles || []).map((p) => ({ ...p }));
  let mine = list.find((p) => p.userId === user.id);
  if (!mine) { mine = { userId: user.id, personId: meta.personId, data: {} }; list.push(mine); }
  mine.data = structuredClone(mine.data || {});
  fn(mine.data);
  setProfiles(list);
  saveMyProfile();
}

async function reloadProfiles() {
  if (!inGroup()) return;
  try {
    const [rows, mem] = await Promise.all([cloud.loadProfiles(meta.groupId), cloud.members(meta.groupId)]);
    memberList = mem;
    const personOf = new Map(mem.map((m) => [m.user_id, m.person_id]));
    const mine = myProfile();
    const list = rows.map((r) => ({ userId: r.userId, personId: personOf.get(r.userId) || null, data: r.data }));
    // Eigene, noch nicht gespeicherte Änderungen behalten
    const own = list.find((p) => p.userId === user.id);
    if (own && JSON.stringify(own.data) !== JSON.stringify(mine) && Object.keys(mine).length) own.data = mine;
    // Beanspruchte Personen ohne Profil trotzdem verknüpfen
    for (const m of mem) if (m.person_id && !list.some((p) => p.userId === m.user_id)) list.push({ userId: m.user_id, personId: m.person_id, data: {} });
    const me = mem.find((m) => m.user_id === user.id);
    if (me) { meta.personId = me.person_id; meta.role = me.role; store(META_KEY, meta); }
    setProfiles(list);
  } catch { /* offline */ }
}

// ---------- Protokoll ----------

/** Änderung ins Protokoll schreiben (Fahrgemeinschaft: Server, sonst auf dem Gerät). */
export function log(action) {
  if (inGroup()) {
    cloud.addLog(meta.groupId, myName(), action);
  } else {
    update((s) => { s.log = [{ at: new Date().toISOString(), actor: 'Du', action }, ...(s.log || [])].slice(0, 300); }, { render: false });
  }
}

export async function loadLog() {
  if (inGroup()) return cloud.loadLog(meta.groupId);
  return state.log || [];
}

// ---------- Rollen & Mitglieder (Admin) ----------

export async function setRole(userId, role) {
  await cloud.setRole(meta.groupId, userId, role);
  const m = memberList.find((x) => x.user_id === userId);
  log(`${m?.display_name || 'Mitglied'} ist jetzt ${role === 'admin' ? 'Admin' : 'Mitfahrer'}`);
  await reloadProfiles();
}

export async function removeMember(userId) {
  const m = memberList.find((x) => x.user_id === userId);
  await cloud.removeMember(meta.groupId, userId);
  log(`${m?.display_name || 'Mitglied'} aus der Fahrgemeinschaft entfernt`);
  await reloadProfiles();
}

export async function renewInvite() {
  const code = await cloud.renewInvite(meta.groupId);
  info = { ...info, invite_code: code };
  log('Neuen Einladungslink erstellt (alter Link ungültig)');
  document.dispatchEvent(new CustomEvent('account-changed'));
}

// ---------- Namen beanspruchen ----------

/** „Das bin ich“: bestehende Person beanspruchen. */
export async function claimPerson(personId) {
  if (!inGroup()) { update((s) => { s.ui.me = personId; }); return; }
  const taken = claims().get(personId);
  if (personId && taken && !taken.me) throw new Error(`${taken.name} hat diesen Namen schon.`);
  await cloud.setMyPerson(meta.groupId, personId);
  meta.personId = personId;
  store(META_KEY, meta);
  log(`hat sich als „${personById(personId)?.name || '?'}“ eingetragen`);
  await reloadProfiles();
}

/** „Ich bin neu“: eigene Person anlegen (im eigenen Profil). */
export async function claimNew(name) {
  const pid = `u:${user.id}`;
  const used = new Set(state.persons.map((p) => p.color));
  updateProfile((d) => { d.name = name; d.color = COLORS.find((c) => !used.has(c)) || COLORS[5]; });
  await cloud.saveProfile(meta.groupId, myProfile());
  await cloud.setMyPerson(meta.groupId, pid);
  meta.personId = pid;
  store(META_KEY, meta);
  log(`hat sich als neuer Mitfahrer „${name}“ eingetragen`);
  await reloadProfiles();
}

// ---------- Gruppe aktivieren / verlassen ----------

async function activate(groupId, groupName, personId, role) {
  if (!meta.groupId && !load(BACKUP_KEY, null)) store(BACKUP_KEY, sharedData(state)); // eigene lokale Daten sichern
  unwatch.forEach((u) => u());
  meta = { groupId, groupName, personId: personId ?? null, role: role || 'member' };
  store(META_KEY, meta);
  await sync.start(groupId);
  await reloadProfiles();
  unwatch = [
    await cloud.watchGroup(groupId, (v) => sync.remoteChanged(v), (ok) => { live = ok; }),
    await cloud.watchProfiles(groupId, () => reloadProfiles()),
  ];
  refreshGroupDetails();
  renderButton();
}

function deactivate({ restore = true } = {}) {
  sync.stop();
  unwatch.forEach((u) => u());
  unwatch = [];
  meta = {};
  store(META_KEY, null);
  info = null;
  memberList = [];
  state.profiles = [];
  const backup = load(BACKUP_KEY, null);
  if (restore) applyRemote(backup || sharedData(defaultState()), []);
  store(BACKUP_KEY, null);
  renderButton();
}

async function refreshGroupDetails() {
  if (!meta.groupId) return;
  try {
    [info, groups] = await Promise.all([cloud.groupInfo(meta.groupId), cloud.myGroups()]);
    const mine = groups.find((g) => g.id === meta.groupId);
    if (mine) { meta.groupName = mine.name; meta.personId = mine.personId; meta.role = mine.role; store(META_KEY, meta); }
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
  // Übrige Ansicht aktualisieren – nicht bei reinen Speicherstatus-Wechseln (sonst verliert man beim Tippen den Fokus)
  if (notify) document.dispatchEvent(new CustomEvent('account-changed'));
}

// ---------- Dialog ----------

const dialog = () => document.getElementById('account-dialog');

export function openAccount(mode) {
  error = '';
  if (mode === 'register' || mode === 'login') authMode = mode;
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
        else if (groups.length === 1 && !inGroup()) await activate(groups[0].id, groups[0].name, groups[0].personId, groups[0].role);
        if (inGroup()) dialog().close();
      });
    },
  },
    h('div', { class: 'segmented' },
      h('button', { type: 'button', class: !register ? 'active' : '', onclick: () => { authMode = 'login'; error = ''; renderDialog(); } }, 'Anmelden'),
      h('button', { type: 'button', class: register ? 'active' : '', onclick: () => { authMode = 'register'; error = ''; renderDialog(); } }, 'Neu registrieren'),
    ),
    pendingJoin ? h('p', { class: 'callout good' }, 'Du wurdest in eine Fahrgemeinschaft eingeladen. Leg kurz ein Konto an (oder melde dich an) – dann bist du dabei.') : null,
    register ? h('label', { class: 'field' }, 'Dein Name', h('input', { type: 'text', required: true, autocomplete: 'name', oninput: (e) => { name = e.target.value; } })) : null,
    h('label', { class: 'field' }, 'E-Mail', h('input', { type: 'email', required: true, autocomplete: 'email', oninput: (e) => { email = e.target.value; } })),
    h('label', { class: 'field' }, 'Passwort', h('input', { type: 'password', required: true, minlength: 6, autocomplete: register ? 'new-password' : 'current-password', oninput: (e) => { password = e.target.value; } })),
    h('button', { type: 'submit', class: 'btn btn-primary full', disabled: busy }, busy ? 'Einen Moment …' : register ? 'Konto anlegen' : 'Anmelden'),
    h('p', { class: 'hint small' }, 'Mit Konto teilt ihr eine Fahrgemeinschaft. Ohne Anmeldung bleibt alles nur in diesem Browser.'),
  );
}

async function doJoin(code) {
  const g = await cloud.joinGroup(code, cloud.userName(user));
  pendingJoin = null;
  try { sessionStorage.removeItem('tankrechner:join'); } catch { /* egal */ }
  await activate(g.id, g.name, null, 'member');
  log('ist der Fahrgemeinschaft beigetreten');
  update((s) => { s.ui.tab = 'home'; s.ui.welcomeDone = true; });
  toast(`Willkommen in „${g.name}“!`, 'ok');
}

function groupView() {
  const link = inviteLink();
  return h('section', { class: 'acc-group' },
    h('div', { class: 'row between' },
      h('h3', {}, meta.groupName || 'Fahrgemeinschaft'),
      h('span', { class: 'muted small row gap', style: { gap: '.35rem' } }, h('span', { class: `acc-status ${syncStatus}` }), isAdmin() ? 'Admin' : 'Mitfahrer')),
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
    h('div', { class: 'row gap wrap' },
      h('button', { type: 'button', class: 'btn btn-small', onclick: () => { deactivate(); renderDialog(); toast('Wieder lokal – deine eigenen Daten sind zurück'); } }, 'Nur lokal arbeiten'),
      h('button', {
        type: 'button', class: 'btn btn-small btn-danger',
        onclick: () => {
          if (!confirm(`„${meta.groupName}“ wirklich verlassen? Du siehst die gemeinsamen Daten dann nicht mehr (die anderen schon).`)) return;
          act(async () => { log('hat die Fahrgemeinschaft verlassen'); await cloud.leaveGroup(meta.groupId); deactivate(); groups = await cloud.myGroups(); });
        },
      }, 'Verlassen'),
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
        h('span', {}, g.name, h('small', { class: 'muted' }, g.role === 'admin' ? ' · Admin' : '')),
        h('button', { type: 'button', class: 'btn btn-small', disabled: busy, onclick: () => act(async () => { await activate(g.id, g.name, g.personId, g.role); dialog().close(); }) }, 'Öffnen')))),
    ) : null,
    h('section', {},
      h('h3', {}, 'Neue Fahrgemeinschaft (du wirst Admin)'),
      h('form', {
        class: 'acc-form',
        onsubmit: (e) => {
          e.preventDefault();
          act(async () => {
            const base = takeData ? structuredClone(sharedData(state)) : sharedData(defaultState());
            // Ich bin der Fahrer: meine Person bekommt meinen Namen
            const me = base.persons.find((p) => p.id === base.defaultDriver) || base.persons[0];
            if (me && (me.name === 'Ich' || !me.name)) me.name = cloud.userName(user);
            const g = await cloud.createGroup(newName.trim(), base, cloud.userName(user), me?.id);
            groups = await cloud.myGroups();
            await activate(g.id, g.name, me?.id, 'admin');
            log(`hat die Fahrgemeinschaft „${g.name}“ erstellt`);
            toast(`„${g.name}“ angelegt – jetzt den Einladungslink verschicken`, 'ok');
          });
        },
      },
        h('input', { type: 'text', required: true, maxlength: 80, placeholder: 'Name, z. B. Pendeln Stuttgart', oninput: (e) => { newName = e.target.value; } }),
        h('label', { class: 'check small' }, h('input', { type: 'checkbox', checked: true, onchange: (e) => { takeData = e.target.checked; } }), ' Meine bisherigen Einstellungen mitnehmen'),
        h('button', { type: 'submit', class: 'btn btn-primary', disabled: busy }, icon('plus', { size: 16 }), 'Erstellen'),
      ),
    ),
    h('section', {},
      h('h3', {}, 'Mit Einladung beitreten'),
      h('form', {
        class: 'acc-form row gap',
        onsubmit: (e) => { e.preventDefault(); act(async () => { await doJoin(parseJoin(code) || code.trim()); dialog().close(); }); },
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
      h('h2', {}, user ? 'Konto & Fahrgemeinschaft' : authMode === 'register' ? 'Konto anlegen' : 'Anmelden'),
      h('button', { type: 'button', class: 'icon-btn tinted', 'aria-label': 'Schließen', onclick: () => d.close() }, icon('x', { size: 18 }))),
    error ? h('p', { class: 'acc-error' }, error) : null,
    user
      ? [
        h('div', { class: 'row between acc-user' },
          h('span', {}, 'Angemeldet als ', h('strong', {}, cloud.userName(user)), h('span', { class: 'muted small' }, ` (${user.email})`)),
          h('button', {
            type: 'button', class: 'link',
            onclick: () => act(async () => { if (inGroup()) deactivate(); await cloud.signOut(); user = null; groups = []; renderButton(); }),
          }, 'Abmelden')),
        pendingJoin ? h('div', { class: 'callout good' }, 'Einladung erkannt.', h('button', { type: 'button', class: 'btn btn-small btn-primary', disabled: busy, onclick: () => act(async () => { await doJoin(pendingJoin); d.close(); }) }, 'Jetzt beitreten')) : null,
        inGroup() ? groupView() : h('p', { class: 'hint' }, 'Du arbeitest gerade nur auf diesem Gerät.'),
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

export const hasPendingJoin = () => !!pendingJoin;

// ---------- Start ----------

export async function initAccount() {
  document.getElementById('btn-account').onclick = () => openAccount();
  const mobileBtn = document.getElementById('btn-account-mobile');
  if (mobileBtn) mobileBtn.onclick = () => openAccount();
  const code = parseJoin(location.hash);
  if (code) {
    pendingJoin = code;
    try { sessionStorage.setItem('tankrechner:join', code); } catch { /* egal */ }
    history.replaceState(null, '', location.pathname + location.search);
  } else {
    try { pendingJoin = sessionStorage.getItem('tankrechner:join'); } catch { /* egal */ }
  }

  // Gemeinsame Daten ändern (und speichern) nur Admins
  onChange((fn) => { if (isAdmin()) sync.noteLocalChange(fn); });
  renderButton();

  if (cloud.hasStoredSession() || pendingJoin || meta.groupId) {
    try {
      user = await cloud.getUser();
      cloud.onAuthChange((u) => { user = u; if (!u && inGroup()) deactivate(); renderButton(); });
      if (user && meta.groupId) await activate(meta.groupId, meta.groupName, meta.personId, meta.role);
      else if (!user && meta.groupId) deactivate();
    } catch (e) {
      syncStatus = 'offline';
      toast(`Fahrgemeinschaft nicht erreichbar: ${e.message}`, 'error');
    }
    renderButton();
  }
  if (pendingJoin) openAccount(user ? undefined : 'register');

  // Nachschauen, ob jemand anderes etwas geändert hat (falls Live-Updates nicht ankommen)
  let lastPoll = 0;
  const poll = (force) => {
    if (!inGroup() || document.hidden) return;
    if (force !== true && Date.now() - lastPoll < (live ? 60_000 : 15_000)) return;
    lastPoll = Date.now();
    sync.remoteChanged(Infinity);
    reloadProfiles();
  };
  document.addEventListener('visibilitychange', () => poll(true));
  window.addEventListener('focus', () => poll(true));
  setInterval(poll, 5_000);
  window.addEventListener('pagehide', () => { if (inGroup() && isAdmin()) sync.flush(); });
}
