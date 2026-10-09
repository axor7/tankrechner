// Konto & Fahrgemeinschaft (nur Logik, keine Oberfläche): Anmelden, meine Angaben (gehen in jede Gruppe mit),
// Gruppen anlegen/beitreten/wechseln/verlassen/löschen, Rollen, eigenes Profil, Synchronisation, Einladungen,
// Plätze übernehmen, Verlauf.
// Jede Änderung meldet sich mit dem Ereignis „account-changed“ – die Oberfläche zeichnet dann neu.
// Beim Gruppenwechsel kommt zusätzlich „group-switched“ (offene Fenster schließen, Zwischenstände verwerfen).
//
// Daten auf dem Gerät: Der Arbeitsstand (state) gehört immer zur aktiven Gruppe. Die Gruppe „Auf diesem Gerät“
// (ohne Konto) wird beim Wechsel in eine Online-Gruppe unter BACKUP_KEY beiseitegelegt und beim Zurückwechseln
// wiederhergestellt. Daten einer Gruppe werden nie in eine andere kopiert.
import { state, update, sharedData, applyRemote, onChange, COLORS, defaultState, setProfiles, personById, newDataGen } from './state.js';
import * as cloud from './cloud.js';
import { createSync } from './sync.js';
import { toast, debounce } from './ui.js';

const META_KEY = 'tankrechner:cloud';
const BACKUP_KEY = 'tankrechner:local-backup';
const ACCOUNT_KEY = 'tankrechner:account'; // meine Angaben ohne Anmeldung
export const LOCAL = 'local'; // Kennung der Gruppe „Auf diesem Gerät“

const load = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
const store = (k, v) => { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); } catch { /* egal */ } };
const changed = () => document.dispatchEvent(new CustomEvent('account-changed'));

let user = null;
let meta = load(META_KEY, {}); // { groupId, groupName, personId, role, fresh } – fresh: gerade neu erstellt, Einrichtung läuft
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
let switching = null;     // Name der Gruppe, zu der gerade gewechselt wird
let prevRef = null;       // wohin nach Abbrechen/Verlassen zurück: Gruppen-ID oder LOCAL
let pendingAccount = {};  // meine Angaben, die noch nicht beim Server sind

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
export const switchingTo = () => switching;
/** Gerade neu erstellte Gruppe, deren Einrichtung noch läuft (Abbrechen löscht sie wieder). */
export const isFreshGroup = () => inGroup() && !!meta.fresh && meta.role === 'admin';
export const currentGroupRef = () => (inGroup() ? meta.groupId : LOCAL);

const hasData = (s) => !!s && (!!s.setupDone || (s.persons?.length || 0) > 1);
/** Gibt es eine Gruppe „Auf diesem Gerät“ (ohne Konto) mit Daten? */
export function localHasData() {
  return inGroup() ? hasData(load(BACKUP_KEY, null)) : hasData(state);
}
/** Alle meine Gruppen für die Auswahl: Online-Gruppen + ggf. „Auf diesem Gerät“. */
export function allGroups() {
  const list = user ? groups.map((g) => ({ ...g, current: inGroup() && g.id === meta.groupId })) : [];
  if (inGroup() && !list.some((g) => g.current)) list.unshift({ id: meta.groupId, name: meta.groupName, role: meta.role, personId: meta.personId, current: true });
  if (localHasData()) list.push({ id: LOCAL, name: 'Auf diesem Gerät', local: true, role: 'admin', current: !inGroup() });
  return list;
}
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

// ---------- Meine Angaben (gehen in jede Gruppe mit) ----------

const pickAddress = (a) => (a?.lat != null ? { label: a.label || '', lat: a.lat, lng: a.lng } : null);

/** Name, Adresse, PayPal und Auto aus dem Konto (ohne Anmeldung: auf diesem Gerät). */
export function accountData() {
  const base = user ? { ...(user.user_metadata?.tr || {}), name: cloud.userName(user) } : load(ACCOUNT_KEY, {});
  return { ...base, ...pendingAccount };
}

async function pushAccountNow() {
  const patch = { ...pendingAccount };
  if (!user || !Object.keys(patch).length) return;
  const { name, ...rest } = patch;
  try {
    user = await cloud.updateAccount(name || cloud.userName(user), { ...(user.user_metadata?.tr || {}), ...rest });
    for (const k of Object.keys(patch)) if (JSON.stringify(pendingAccount[k]) === JSON.stringify(patch[k])) delete pendingAccount[k];
  } catch { /* bleibt offen – nächster Versuch mit der nächsten Änderung */ }
}
const pushAccount = debounce(pushAccountNow, 800);

/** Meine Angaben ändern: { name?, address?, paypal?, car? } – gespeichert wird nur, was sich ändert. */
export function saveAccountData(patch) {
  const cur = accountData();
  const next = {};
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    const val = k === 'address' ? pickAddress(v) : v;
    if (JSON.stringify(cur[k] ?? null) !== JSON.stringify(val ?? null)) next[k] = val;
  }
  if (!Object.keys(next).length) return;
  if (user) {
    Object.assign(pendingAccount, next);
    pushAccount();
    if (next.name && inGroup()) cloud.setDisplayName(meta.groupId, next.name).then(reloadProfiles).catch(() => {});
  } else {
    store(ACCOUNT_KEY, { ...load(ACCOUNT_KEY, {}), ...next });
  }
}

/** Fehlen im Konto noch Angaben, die in der aktuellen Gruppe schon stehen? Dann übernehmen (einmalig). */
function seedAccount() {
  const pid = inGroup() ? meta.personId : (state.setupDone ? state.ui.me || state.defaultDriver : null);
  const p = pid ? personById(pid) : null;
  if (!p) return;
  const acc = accountData();
  const patch = {};
  if (!acc.address?.lat && p.address?.lat) patch.address = p.address;
  if (!acc.paypal && p.paypal) patch.paypal = p.paypal;
  if (!acc.car) {
    if (Number(p.car?.consumption) > 0) patch.car = { consumption: Number(p.car.consumption), fuel: p.car.fuel || state.car.fuel };
    else if (pid === state.defaultDriver && state.setupCar && Number(state.car?.consumption) > 0) {
      patch.car = { consumption: Number(state.car.consumption), fuel: state.car.fuel, extraPerKm: Number(state.car.extraPerKm) || 0, price: Number(state.price?.manual) || null };
    }
  }
  if (Object.keys(patch).length) saveAccountData(patch);
}

/** Frische Daten für eine neue Gruppe – nur mit meinen Angaben, nichts aus anderen Gruppen. */
function freshGroupData() {
  const d = defaultState();
  const acc = accountData();
  const me = d.persons[0];
  me.name = acc.name || cloud.userName(user);
  if (acc.address?.lat) me.address = { ...pickAddress(acc.address), at: Date.now() };
  if (acc.paypal) { me.paypal = acc.paypal; me.paypalAt = Date.now(); }
  if (Number(acc.car?.consumption) > 0) d.car = { ...d.car, consumption: Number(acc.car.consumption), fuel: acc.car.fuel || d.car.fuel, extraPerKm: Number(acc.car.extraPerKm) || 0 };
  if (Number(acc.car?.price) > 0) d.price = { ...d.price, manual: Number(acc.car.price) };
  return sharedData(d);
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

let profileDirty = false;
async function flushProfile() {
  if (!inGroup() || !profileDirty) return;
  profileDirty = false;
  try { await cloud.saveProfile(meta.groupId, myProfile()); } catch (e) { profileDirty = true; toast(`Konnte nicht gespeichert werden: ${e.message}`, 'error'); }
}
const saveMyProfile = debounce(flushProfile, 600);

/** Eigenes Profil ändern (Adresse, Rhythmus, Tage, Abwesenheiten, „bezahlt“ …). */
export function updateProfile(fn) {
  const list = (state.profiles || []).map((p) => ({ ...p }));
  let mine = list.find((p) => p.userId === user.id);
  if (!mine) { mine = { userId: user.id, personId: meta.personId, data: {} }; list.push(mine); }
  mine.data = structuredClone(mine.data || {});
  fn(mine.data);
  setProfiles(list);
  profileDirty = true;
  saveMyProfile();
}

async function reloadProfiles() {
  if (!inGroup()) return;
  const gid = meta.groupId;
  try {
    const [rows, mem] = await Promise.all([cloud.loadProfiles(gid), cloud.members(gid)]);
    if (meta.groupId !== gid) return; // inzwischen gewechselt
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

// ---------- Gruppe öffnen / wechseln / verlassen ----------

/** Aktive Gruppe trennen: keine Synchronisation, keine Live-Updates, Hintergrundarbeiten verfallen. */
function disconnect() {
  sync.stop();
  unwatch.forEach((u) => u());
  unwatch = [];
  info = null;
  memberList = [];
  newDataGen();
  if (state.profiles?.length) setProfiles([]);
  document.dispatchEvent(new CustomEvent('group-switched'));
}

/** Aktive Gruppe (meta) verbinden. resume: dieselbe Gruppe wie zuletzt – klappt nur das Laden nicht, bleibt sie offline aktiv. */
async function connect({ resume = false } = {}) {
  const gid = meta.groupId;
  try {
    if (await sync.start(gid, { resume }) === false) return false;
  } catch (e) {
    if (!resume) throw e;
  }
  if (meta.groupId !== gid) return false;
  await reloadProfiles();
  try {
    unwatch = [
      await cloud.watchGroup(gid, (v) => sync.remoteChanged(v), (ok) => { live = ok; }),
      await cloud.watchProfiles(gid, () => reloadProfiles()),
    ];
  } catch { /* ohne Live-Updates – es wird regelmäßig nachgeschaut */ }
  refreshGroupDetails();
  return true;
}

async function refreshGroupDetails() {
  const gid = meta.groupId;
  if (!gid) return;
  try {
    const [i, g] = await Promise.all([cloud.groupInfo(gid), cloud.myGroups()]);
    groups = g;
    if (meta.groupId !== gid) { changed(); return; } // inzwischen gewechselt
    info = i;
    const mine = groups.find((x) => x.id === gid);
    if (mine) { meta.groupName = mine.name; meta.personId = mine.personId; meta.role = mine.role; store(META_KEY, meta); }
  } catch (e) {
    if (meta.groupId === gid && /0 rows|JSON object requested/i.test(e.message)) {
      toast('Du bist nicht mehr Mitglied dieser Fahrgemeinschaft', 'error');
      await groupGone(gid);
    }
  }
  changed();
}

/** Offene Änderungen der aktiven Gruppe noch speichern (höchstens ein paar Sekunden warten). */
async function settleCurrent() {
  if (!inGroup()) return;
  const wait = (p) => Promise.race([p, new Promise((r) => setTimeout(r, 4000))]).catch(() => {});
  await Promise.all([isAdmin() ? wait(sync.flush()) : null, wait(flushProfile())]);
}

/** Zurück zur Gruppe „Auf diesem Gerät“ (ohne Speichern – z. B. abgemeldet oder Gruppe weg). */
function resetToLocal() {
  if (meta.groupId) prevRef = meta.groupId;
  disconnect();
  meta = {};
  store(META_KEY, null);
  applyRemote(load(BACKUP_KEY, null) || sharedData(defaultState()), []);
  store(BACKUP_KEY, null);
  changed();
}

/**
 * In eine Gruppe wechseln: { id, name, personId, role } oder { id: LOCAL }.
 * Vorher wird gespeichert, was noch offen ist. Klappt das Laden nicht, bleibt alles, wie es war.
 * keepLocal: „Auf diesem Gerät“ nicht beiseitelegen (wurde gerade hochgeladen) · discard: aktuelle Gruppe gibt es
 * nicht mehr (nichts speichern) · fresh: gerade neu erstellt (Einrichtung läuft).
 */
export async function switchGroup(target, { keepLocal = false, discard = false, fresh = false } = {}) {
  if (switching) return;
  if (target.id === LOCAL ? !inGroup() : inGroup() && target.id === meta.groupId) return;
  switching = target.id === LOCAL ? 'Auf diesem Gerät' : target.name || 'Gruppe';
  changed();
  const before = inGroup() ? { ...meta } : null;
  try {
    if (!discard) await settleCurrent();
    if (target.id === LOCAL) { resetToLocal(); return; }
    if (!before && !keepLocal) store(BACKUP_KEY, hasData(state) ? sharedData(state) : null); // eigene Daten beiseitelegen
    prevRef = before?.groupId || LOCAL;
    disconnect();
    meta = { groupId: target.id, groupName: target.name, personId: target.personId ?? null, role: target.role || 'member', ...(fresh ? { fresh: true } : {}) };
    store(META_KEY, meta);
    try {
      await connect();
    } catch (e) {
      // Laden hat nicht geklappt: zurück, wo wir waren – die Daten auf dem Bildschirm gehören noch dazu
      disconnect();
      if (before && !discard) {
        meta = before;
        store(META_KEY, meta);
        await connect({ resume: true });
      } else if (before) {
        meta = {};
        store(META_KEY, null);
        resetToLocal();
      } else {
        meta = {};
        store(META_KEY, null);
        store(BACKUP_KEY, null);
      }
      throw new Error(`„${target.name || 'Gruppe'}“ konnte nicht geöffnet werden: ${e.message}`);
    }
    seedAccount();
  } finally {
    switching = null;
    changed();
  }
}

export async function openGroup(g) { await switchGroup(g); }

/** Eine Gruppe ist weg (verlassen, gelöscht, entfernt worden): Liste neu laden und ggf. woandershin wechseln. */
async function groupGone(gid) {
  groups = await cloud.myGroups().catch(() => groups.filter((g) => g.id !== gid));
  if (meta.groupId !== gid) { changed(); return; }
  const backToLocal = prevRef === LOCAL && hasData(load(BACKUP_KEY, null));
  const next = groups.find((g) => g.id === prevRef) || (backToLocal ? null : groups[0]);
  if (next) await switchGroup(next, { discard: true }).catch((e) => { toast(e.message, 'error'); resetToLocal(); });
  else resetToLocal();
}

/** Was passiert beim Verlassen? → { alone, handOver } (handOver: Name dessen, der dann Admin wird). */
export async function leaveInfo(gid = meta.groupId) {
  const mem = gid === meta.groupId && memberList.length ? memberList : await cloud.members(gid);
  const others = mem.filter((m) => m.user_id !== user?.id);
  const mine = mem.find((m) => m.user_id === user?.id);
  const needAdmin = mine?.role === 'admin' && others.length && !others.some((m) => m.role === 'admin');
  return { alone: !others.length, handOver: needAdmin ? others[0].display_name || 'jemand' : null };
}

/** Gruppe verlassen – man bleibt angemeldet und landet in der vorigen (oder einer anderen) Gruppe. */
export async function leaveGroup(gid = meta.groupId) {
  if (!gid || gid === LOCAL) return;
  const mem = await cloud.members(gid);
  const others = mem.filter((m) => m.user_id !== user.id);
  const mine = mem.find((m) => m.user_id === user.id);
  // Es muss immer jemand Admin bleiben
  if (mine?.role === 'admin' && others.length && !others.some((m) => m.role === 'admin')) await cloud.setRole(gid, others[0].user_id, 'admin');
  if (gid === meta.groupId) await settleCurrent();
  await cloud.addLog(gid, myName(), 'hat die Fahrgemeinschaft verlassen');
  if (gid === meta.groupId) sync.stop();
  await cloud.leaveGroup(gid);
  await groupGone(gid);
}

/** Gruppe für alle löschen (Admins). */
export async function deleteGroup(gid = meta.groupId) {
  if (!gid || gid === LOCAL) return;
  if (!(await cloud.deleteGroup(gid))) throw new Error('Diese Gruppe kann nur löschen, wer sie erstellt hat. (Tipp für den Ersteller: supabase/setup.sql erneut ausführen, dann dürfen das alle Admins.)');
  await groupGone(gid);
}

/** Einrichtung einer gerade erstellten Gruppe abbrechen: Gruppe wieder löschen, zurück zur vorigen. */
export async function cancelNewGroup() {
  if (isFreshGroup()) await deleteGroup(meta.groupId);
}

/** Einrichtung fertig: die Gruppe ist nicht mehr „frisch“. */
export function groupSetupDone() {
  if (meta.fresh) { delete meta.fresh; store(META_KEY, meta); }
}

/**
 * Neue Fahrgemeinschaft. Normal: leer, nur mit meinen Angaben (Name, Adresse, Auto, PayPal) – danach läuft die
 * Einrichtung wie beim ersten Mal. fromLocal: die Daten „Auf diesem Gerät“ hochladen (nur von dort aus).
 */
export async function createGroup(name, { fromLocal = false } = {}) {
  if (!user) throw new Error('Bitte zuerst anmelden.');
  if (fromLocal && inGroup()) throw new Error('Hochladen geht nur von „Auf diesem Gerät“ aus.');
  const base = fromLocal ? structuredClone(sharedData(state)) : freshGroupData();
  const me = base.persons.find((p) => p.id === base.defaultDriver) || base.persons[0];
  if (me && (me.name === 'Ich' || !me.name)) me.name = accountData().name || cloud.userName(user);
  const g = await cloud.createGroup(name.trim(), base, cloud.userName(user), me?.id);
  groups = await cloud.myGroups().catch(() => [...groups, { id: g.id, name: g.name, personId: me?.id, role: 'admin' }]);
  if (fromLocal) store(BACKUP_KEY, null); // liegt jetzt online – nicht doppelt behalten
  await switchGroup({ id: g.id, name: g.name, personId: me?.id, role: 'admin' }, { keepLocal: fromLocal, fresh: !fromLocal });
  log(fromLocal ? `hat die Fahrgemeinschaft „${g.name}“ mit den Daten von diesem Gerät erstellt` : `hat die Fahrgemeinschaft „${g.name}“ erstellt`);
  return g;
}

/** Gruppe „Auf diesem Gerät“ löschen (nur angemeldet – sonst „Alles löschen“ unter Daten & Infos). */
export function discardLocal() {
  if (inGroup()) store(BACKUP_KEY, null);
  else applyRemote(sharedData(defaultState()), []);
  changed();
}

/** Liste meiner Gruppen neu holen. */
export async function refreshGroups() {
  if (!user) return;
  try { groups = await cloud.myGroups(); changed(); } catch { /* offline */ }
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
  if (inGroup() && meta.groupId === g.id) toast(`Du bist schon in „${g.name}“`);
  else await switchGroup({ id: g.id, name: g.name, personId: mine?.personId || null, role: mine?.role || 'member' });
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
  pendingAccount = {};
  // Angaben, die ohne Konto auf diesem Gerät standen, ins Konto übernehmen (was dort noch fehlt)
  const localAcc = load(ACCOUNT_KEY, {});
  const acc = accountData();
  const missing = Object.fromEntries(Object.entries(localAcc).filter(([k, v]) => k !== 'name' && v != null && acc[k] == null));
  if (Object.keys(missing).length) saveAccountData(missing);
  groups = await cloud.myGroups();
  if (pendingJoin) await doJoin(pendingJoin);
  else if (groups.length && !inGroup()) await switchGroup(groups.find((g) => g.id === meta.groupId) || groups[0]);
  else seedAccount();
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
  if (inGroup()) { await settleCurrent(); resetToLocal(); }
  await pushAccountNow();
  await cloud.signOut();
  user = null;
  groups = [];
  pendingAccount = {};
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
      cloud.onAuthChange((u) => { user = u; if (!u && meta.groupId) resetToLocal(); changed(); });
      if (user && meta.groupId) await connect({ resume: true });
      else if (!user && meta.groupId) resetToLocal();
      if (user && pendingJoin) await doJoin(pendingJoin).catch((e) => { pendingJoin = null; toast(e.message, 'error'); });
      if (user) cloud.myGroups().then((g) => { groups = g; seedAccount(); changed(); }).catch(() => {});
    } catch (e) {
      syncStatus = 'offline';
      toast(`Fahrgemeinschaft nicht erreichbar: ${e.message}`, 'error');
    }
  }
  if (!user) seedAccount();
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
