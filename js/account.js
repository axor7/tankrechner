// Konto & Fahrgemeinschaft (nur Logik, keine Oberfläche): Anmelden, Gruppe anlegen/beitreten/wechseln,
// Rollen, eigenes Profil, Synchronisation, Einladungen, Plätze übernehmen, Verlauf.
// Jede Änderung meldet sich mit dem Ereignis „account-changed“ – die Oberfläche zeichnet dann neu.
import { state, update, sharedData, applyRemote, onChange, COLORS, defaultState, setProfiles, personById } from './state.js';
import * as cloud from './cloud.js';
import { createSync } from './sync.js';
import { toast, debounce } from './ui.js';

const META_KEY = 'tankrechner:cloud';
const BACKUP_KEY = 'tankrechner:local-backup';

const load = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
const store = (k, v) => { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); } catch { /* egal */ } };
const changed = () => document.dispatchEvent(new CustomEvent('account-changed'));

let user = null;
let meta = load(META_KEY, {}); // { groupId, groupName, personId, role }
let syncStatus = 'synced';
let unwatch = [];
let groups = [];
let info = null; // { name, invite_code, created_by }
let memberList = [];
let pendingJoin = null;   // { code, pid } – Einladung (pid: persönlicher Link für einen Platz)
let claimOffer = null;    // Platz aus dem persönlichen Link, nach dem Beitreten zu bestätigen
let recovering = false;   // über den Link aus der „Passwort vergessen“-Mail gekommen
let ready = false;        // Anmeldung beim Start geprüft
let live = false;

const sync = createSync({
  backend: cloud.backend,
  getShared: () => sharedData(state),
  applyRemote,
  onStatus: (s) => { syncStatus = s; document.dispatchEvent(new CustomEvent('sync-status')); },
});

// ---------- Abfragen ----------

export const inGroup = () => !!(user && meta.groupId);
export const syncState = () => syncStatus;
export const isAdmin = () => !inGroup() || meta.role === 'admin';
export const myPersonId = () => (inGroup() ? meta.personId || null : null);
export const myName = () => cloud.userName(user);
export const myEmail = () => user?.email || '';
export const isLoggedIn = () => !!user;
export const accountReady = () => ready;
export const groupName = () => (inGroup() ? meta.groupName : null);
export const groupId = () => (inGroup() ? meta.groupId : null);
export const myGroups = () => groups;
export const members = () => memberList;
export const myUserId = () => user?.id || null;
export const hasPendingJoin = () => !!pendingJoin;
export const isRecovering = () => recovering;
export const pendingClaim = () => claimOffer;
export const clearClaimOffer = () => { claimOffer = null; try { sessionStorage.removeItem('tankrechner:claim'); } catch { /* egal */ } changed(); };

/** Einladungslink für die Gruppe – mit pid ein persönlicher Link für genau diesen Platz. */
export const inviteLink = (pid) => (info?.invite_code ? `${location.origin}${location.pathname}#join=${info.invite_code}${pid ? `&p=${encodeURIComponent(pid)}` : ''}` : '');
/** Code zum Abtippen: „K7M-4Q2“ (alte, lange Codes in Vierergruppen). */
export function inviteCode() {
  const c = String(info?.invite_code || '').toUpperCase();
  if (!c) return '';
  return c.length <= 6 ? `${c.slice(0, 3)}-${c.slice(3)}` : c.match(/.{1,4}/g).join('-');
}

/** Wer hat welchen Platz übernommen? Map personId → { name, me, role, userId } */
export function claims() {
  const m = new Map();
  if (inGroup()) for (const x of memberList) if (x.person_id) m.set(x.person_id, { name: x.display_name || 'Jemand', me: x.user_id === user?.id, role: x.role, userId: x.user_id });
  return m;
}

// ---------- Neue Übernahmen (für Admins) ----------

const seenKey = () => `tankrechner:seen-claims:${meta.groupId}`;

/** Wer hat seit dem letzten Mal einen Platz übernommen oder ist neu dazugekommen? → [{ userId, personId, name, self }] */
export function newClaims() {
  if (!inGroup() || !isAdmin() || !memberList.length) return [];
  const seen = load(seenKey(), null);
  const list = memberList.filter((m) => m.person_id && m.user_id !== user?.id);
  if (!seen) { store(seenKey(), list.map((m) => `${m.user_id}:${m.person_id}`)); return []; } // erstes Mal: nichts melden
  return list.filter((m) => !seen.includes(`${m.user_id}:${m.person_id}`))
    .map((m) => ({ userId: m.user_id, personId: m.person_id, name: m.display_name || 'Jemand', self: String(m.person_id).startsWith('u:') }));
}

export function ackClaim(userId) {
  const seen = load(seenKey(), []);
  const m = memberList.find((x) => x.user_id === userId);
  if (m) store(seenKey(), [...seen, `${m.user_id}:${m.person_id}`]);
  changed();
}

// ---------- Eigenes Profil ----------

export function myProfile() {
  return state.profiles?.find((p) => p.userId === user?.id)?.data || {};
}

const saveMyProfile = debounce(async () => {
  if (!inGroup()) return;
  try { await cloud.saveProfile(meta.groupId, myProfile()); } catch (e) { toast(`Konnte nicht gespeichert werden: ${e.message}`, 'error'); }
}, 600);

/** Eigenes Profil ändern (Adresse, Rhythmus, Tage, Abwesenheiten, „bezahlt“ …). */
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
    for (const m of mem) if (m.person_id && !list.some((p) => p.userId === m.user_id)) list.push({ userId: m.user_id, personId: m.person_id, data: {} });
    const me = mem.find((m) => m.user_id === user.id);
    if (me) { meta.personId = me.person_id; meta.role = me.role; store(META_KEY, meta); }
    setProfiles(list);
  } catch { /* offline */ }
}

// ---------- Verlauf ----------

/** Änderung in den Verlauf schreiben (Fahrgemeinschaft: Server, sonst auf dem Gerät). */
export function log(action) {
  if (inGroup()) cloud.addLog(meta.groupId, myName(), action);
  else update((s) => { s.log = [{ at: new Date().toISOString(), actor: 'Du', action }, ...(s.log || [])].slice(0, 300); }, { render: false });
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
  changed();
}

export async function removeMember(userId) {
  const m = memberList.find((x) => x.user_id === userId);
  await cloud.removeMember(meta.groupId, userId);
  log(`${m?.display_name || 'Mitglied'} aus der Fahrgemeinschaft entfernt`);
  await reloadProfiles();
  changed();
}

export async function renewInvite() {
  const code = await cloud.renewInvite(meta.groupId);
  info = { ...info, invite_code: code };
  log('Neuen Einladungslink erstellt (alter Link ungültig)');
  changed();
}

// ---------- Platz übernehmen ----------

/** „Das bin ich“: bestehenden Platz übernehmen. Ohne Fahrgemeinschaft: nur auf diesem Gerät merken. */
export async function claimPerson(personId) {
  if (!inGroup()) { update((s) => { s.ui.me = personId; }); return; }
  const taken = claims().get(personId);
  if (personId && taken && !taken.me) throw new Error(`${taken.name} hat diesen Platz schon.`);
  await cloud.setMyPerson(meta.groupId, personId);
  meta.personId = personId;
  store(META_KEY, meta);
  claimOffer = null;
  try { sessionStorage.removeItem('tankrechner:claim'); } catch { /* egal */ }
  log(`hat den Platz „${personById(personId)?.name || '?'}“ übernommen`);
  await reloadProfiles();
  changed();
}

/** „Ich bin neu“: eigenen Platz anlegen (im eigenen Profil). */
export async function claimNew(name) {
  const pid = `u:${user.id}`;
  const used = new Set(state.persons.map((p) => p.color));
  updateProfile((d) => { d.name = name; d.color = COLORS.find((c) => !used.has(c)) || COLORS[5]; });
  await cloud.saveProfile(meta.groupId, myProfile());
  await cloud.setMyPerson(meta.groupId, pid);
  meta.personId = pid;
  store(META_KEY, meta);
  log(`ist als „${name}“ neu dabei`);
  await reloadProfiles();
  changed();
}

// ---------- Gruppe öffnen / verlassen ----------

async function activate(gid, gname, personId, role) {
  if (!meta.groupId && !load(BACKUP_KEY, null)) store(BACKUP_KEY, sharedData(state)); // eigene lokale Daten sichern
  unwatch.forEach((u) => u());
  meta = { groupId: gid, groupName: gname, personId: personId ?? null, role: role || 'member' };
  store(META_KEY, meta);
  await sync.start(gid);
  await reloadProfiles();
  unwatch = [
    await cloud.watchGroup(gid, (v) => sync.remoteChanged(v), (ok) => { live = ok; }),
    await cloud.watchProfiles(gid, () => reloadProfiles()),
  ];
  refreshGroupDetails();
  changed();
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
  changed();
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
  changed();
}

export async function openGroup(g) { await activate(g.id, g.name, g.personId, g.role); }

/** Wieder nur auf diesem Gerät arbeiten (die Gruppe bleibt bestehen). */
export function workLocally() { deactivate(); }

export async function leaveGroup() {
  log('hat die Fahrgemeinschaft verlassen');
  await cloud.leaveGroup(meta.groupId);
  deactivate();
  groups = await cloud.myGroups();
  changed();
}

/** Neue Fahrgemeinschaft – mit den Daten von diesem Gerät (der Fahrer bin ich). */
export async function createGroup(name, { takeData = true } = {}) {
  const base = takeData ? structuredClone(sharedData(state)) : sharedData(defaultState());
  const me = base.persons.find((p) => p.id === base.defaultDriver) || base.persons[0];
  if (me && (me.name === 'Ich' || !me.name)) me.name = cloud.userName(user);
  const g = await cloud.createGroup(name.trim(), base, cloud.userName(user), me?.id);
  groups = await cloud.myGroups();
  await activate(g.id, g.name, me?.id, 'admin');
  log(`hat die Fahrgemeinschaft „${g.name}“ erstellt`);
  return g;
}

// ---------- Einladung ----------

/** Einladung aus Link oder Code lesen → { code, pid } oder null. Codes: 6 Zeichen (neu) oder 12 (alt), Bindestriche/Leerzeichen egal. */
export function parseJoin(text) {
  const t = String(text || '');
  const link = t.match(/#join=([A-Za-z0-9-]+)(?:&p=([^&\s]+))?/);
  if (link) return { code: link[1].replace(/-/g, ''), pid: link[2] ? decodeURIComponent(link[2]) : null };
  const raw = t.replace(/[\s-]/g, '');
  return /^[A-Za-z0-9]{6,12}$/.test(raw) ? { code: raw, pid: null } : null;
}

/** Einladung merken (z. B. Code von Hand eingegeben, noch nicht angemeldet). */
export function setPendingJoin(join) {
  pendingJoin = join;
  try { sessionStorage.setItem('tankrechner:join', JSON.stringify(join)); } catch { /* egal */ }
  changed();
}

async function doJoin(join) {
  const { code: raw, pid } = join;
  // Alte Codes (12 Zeichen, hexadezimal) sind kleingeschrieben gespeichert, neue (6 Zeichen) groß
  const code = /^[0-9a-f]{12}$/i.test(raw) ? raw.toLowerCase() : raw.toUpperCase();
  const g = await cloud.joinGroup(code, cloud.userName(user));
  pendingJoin = null;
  try { sessionStorage.removeItem('tankrechner:join'); } catch { /* egal */ }
  groups = await cloud.myGroups();
  const mine = groups.find((x) => x.id === g.id);
  await activate(g.id, g.name, mine?.personId || null, mine?.role || 'member');
  if (pid && !meta.personId && !claims().has(pid)) {
    claimOffer = pid;
    try { sessionStorage.setItem('tankrechner:claim', pid); } catch { /* egal */ }
  }
  if (!mine?.personId) log('ist der Fahrgemeinschaft beigetreten');
  update((s) => { s.ui.welcomeDone = true; s.ui.screen = 'rides'; });
  toast(`Willkommen in „${g.name}“!`, 'ok');
  changed();
}

/** Mit Code oder Link beitreten (angemeldet). */
export async function joinWith(text) {
  const j = typeof text === 'string' ? parseJoin(text) : text;
  if (!j) throw new Error('Das ist kein gültiger Code oder Link.');
  await doJoin(j);
}

// ---------- Anmelden ----------

async function afterLogin() {
  groups = await cloud.myGroups();
  if (pendingJoin) await doJoin(pendingJoin);
  else if (groups.length && !inGroup()) {
    const pick = groups.find((g) => g.id === meta.groupId) || groups[0];
    await activate(pick.id, pick.name, pick.personId, pick.role);
  }
  changed();
}

export async function signIn(email, password) {
  user = await cloud.signIn(email.trim(), password);
  await afterLogin();
}

export async function signUp(name, email, password) {
  user = await cloud.signUp(email.trim(), password, name.trim() || email.split('@')[0]);
  await afterLogin();
}

export async function signOut() {
  if (inGroup()) deactivate();
  await cloud.signOut();
  user = null;
  groups = [];
  changed();
}

export const requestPasswordReset = (email) => cloud.requestPasswordReset(email.trim());

export async function setNewPassword(password) {
  await cloud.updatePassword(password);
  if (recovering) { recovering = false; await afterLogin(); }
  changed();
}

export function cancelRecovery() { recovering = false; changed(); }

// ---------- Start ----------

export async function initAccount() {
  // Link aus der „Passwort vergessen“-Mail?
  let recovery = null;
  if (/access_token=|error_description=|error_code=/.test(location.hash)) {
    try { recovery = await cloud.handleAuthRedirect(location.hash); } catch (e) { recovery = { error: e.message }; }
    history.replaceState(null, '', location.pathname + location.search);
  }
  const join = /#join=/.test(location.hash) ? parseJoin(location.hash) : null;
  if (join) {
    pendingJoin = join;
    try { sessionStorage.setItem('tankrechner:join', JSON.stringify(join)); } catch { /* egal */ }
    history.replaceState(null, '', location.pathname + location.search);
  } else {
    try {
      const raw = sessionStorage.getItem('tankrechner:join');
      pendingJoin = raw ? (raw.startsWith('{') ? JSON.parse(raw) : { code: raw, pid: null }) : null;
      claimOffer = sessionStorage.getItem('tankrechner:claim');
    } catch { /* egal */ }
  }

  // Gemeinsame Daten ändern (und speichern) nur Admins
  onChange((fn) => { if (isAdmin()) sync.noteLocalChange(fn); });

  if (cloud.hasStoredSession() || pendingJoin || meta.groupId || recovery === 'recovery') {
    try {
      user = await cloud.getUser();
      cloud.onAuthChange((u) => { user = u; if (!u && inGroup()) deactivate(); changed(); });
      if (user && meta.groupId) await activate(meta.groupId, meta.groupName, meta.personId, meta.role);
      else if (!user && meta.groupId) deactivate();
      if (user && pendingJoin) await doJoin(pendingJoin).catch((e) => { pendingJoin = null; toast(e.message, 'error'); });
      if (user) cloud.myGroups().then((g) => { groups = g; changed(); }).catch(() => {});
    } catch (e) {
      syncStatus = 'offline';
      toast(`Fahrgemeinschaft nicht erreichbar: ${e.message}`, 'error');
    }
  }
  if (recovery === 'recovery') recovering = true;
  else if (recovery?.error) toast(recovery.error, 'error');
  ready = true;
  changed();

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
