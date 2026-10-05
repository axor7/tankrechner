// Supabase: Anmeldung, Fahrgemeinschaften, Speichern und Live-Updates.
// Die Bibliothek wird erst geladen, wenn sie gebraucht wird – ohne Anmeldung bleibt alles lokal.

// Öffentliche Projektdaten (der "publishable" Key ist dafür gedacht, im Browser zu stehen;
// geschützt wird über die Zugriffsregeln in supabase/setup.sql).
export const SUPABASE_URL = 'https://xuiexfvmirbnvfffbunn.supabase.co';
export const SUPABASE_KEY = 'sb_publishable_8U2Y7mJwip7oaoqfniU2GA_lOUmP98-';
const LIB = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.2/+esm';

let clientPromise;
export function client() {
  clientPromise ||= import(LIB).then(({ createClient }) => createClient(SUPABASE_URL, SUPABASE_KEY, {
    // implicit: der Link aus der „Passwort vergessen“-Mail funktioniert so auch auf einem anderen Gerät
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, flowType: 'implicit', storageKey: 'tankrechner-auth' },
  }));
  return clientPromise;
}

/** Hat dieses Gerät schon einmal eine Anmeldung gespeichert? (ohne die Bibliothek zu laden) */
export function hasStoredSession() {
  try { return !!localStorage.getItem('tankrechner-auth'); } catch { return false; }
}

// Fehlermeldungen von Supabase verständlich machen
function explain(error) {
  const m = error?.message || String(error);
  if (/Invalid login credentials/i.test(m)) return 'E-Mail oder Passwort falsch.';
  if (/User already registered/i.test(m)) return 'Für diese E-Mail gibt es schon ein Konto – bitte anmelden.';
  if (/Password should be at least/i.test(m)) return 'Das Passwort muss mindestens 6 Zeichen haben.';
  if (/Email not confirmed/i.test(m)) return 'E-Mail noch nicht bestätigt. (Tipp für den Admin: in Supabase „Confirm email“ ausschalten.)';
  if (/email rate limit/i.test(m)) return 'Gerade wurden zu viele E-Mails verschickt – bitte später noch einmal versuchen.';
  if (/rate limit|only request this after/i.test(m)) return 'Zu viele Versuche – bitte kurz warten.';
  if (/should be different from the old/i.test(m)) return 'Das neue Passwort muss sich vom alten unterscheiden.';
  if (/Error sending recovery email|sending .*email/i.test(m)) return 'Die E-Mail konnte nicht verschickt werden. (Admin: in Supabase einen eigenen E-Mail-Versand (SMTP) einrichten.)';
  if (/Auth session missing/i.test(m)) return 'Der Link ist abgelaufen – bitte „Passwort vergessen“ noch einmal anfordern.';
  if (/relation .* does not exist|Could not find the (table|function)/i.test(m)) return 'Die Datenbank ist noch nicht eingerichtet (supabase/setup.sql ausführen).';
  if (/Failed to fetch|NetworkError|Load failed/i.test(m)) return 'Keine Verbindung zum Server.';
  return m;
}

async function run(promise) {
  const { data, error } = await promise;
  if (error) throw new Error(explain(error));
  return data;
}

// ---------- Anmeldung ----------

export async function getUser() {
  const sb = await client();
  const { data } = await sb.auth.getSession();
  return data.session?.user || null;
}

export const userName = (user) => user?.user_metadata?.name || user?.email?.split('@')[0] || 'Ich';

export async function onAuthChange(fn) {
  const sb = await client();
  sb.auth.onAuthStateChange((_event, session) => fn(session?.user || null));
}

export async function signUp(email, password, name) {
  const sb = await client();
  const data = await run(sb.auth.signUp({ email, password, options: { data: { name } } }));
  if (!data.session) throw new Error('Konto angelegt, aber die E-Mail muss erst bestätigt werden. (Admin: in Supabase „Confirm email“ ausschalten, dann klappt die Anmeldung sofort.)');
  return data.user;
}

export async function signIn(email, password) {
  const sb = await client();
  return (await run(sb.auth.signInWithPassword({ email, password }))).user;
}

/** Mail mit Link zum Zurücksetzen schicken. Der Link führt zurück auf diese Seite. */
export async function requestPasswordReset(email) {
  const sb = await client();
  await run(sb.auth.resetPasswordForEmail(email, { redirectTo: `${location.origin}${location.pathname}` }));
}

/**
 * Kommt man über den Link aus der Mail? Dann steht die Anmeldung im #-Teil der Adresse.
 * → 'recovery' (angemeldet, neues Passwort festlegen), { error } (Link ungültig/abgelaufen) oder null
 */
export async function handleAuthRedirect(hash) {
  const q = new URLSearchParams(String(hash || '').replace(/^#/, ''));
  if (q.get('error_description') || q.get('error_code')) {
    const expired = /expired|invalid/i.test(`${q.get('error_code')} ${q.get('error_description')}`);
    return { error: expired ? 'Der Link ist abgelaufen oder wurde schon benutzt – bitte „Passwort vergessen“ noch einmal anfordern.' : q.get('error_description') };
  }
  if (q.get('type') !== 'recovery' || !q.get('access_token') || !q.get('refresh_token')) return null;
  const sb = await client();
  await run(sb.auth.setSession({ access_token: q.get('access_token'), refresh_token: q.get('refresh_token') }));
  return 'recovery';
}

export async function updatePassword(password) {
  const sb = await client();
  await run(sb.auth.updateUser({ password }));
}

export async function signOut() {
  const sb = await client();
  await sb.auth.signOut();
}

// ---------- Fahrgemeinschaften ----------

export async function myGroups() {
  const sb = await client();
  const user = await getUser();
  if (!user) return [];
  const rows = await run(sb.from('group_members').select('group_id, person_id, role, groups(id, name, updated_at)').eq('user_id', user.id));
  return rows.filter((r) => r.groups).map((r) => ({ id: r.groups.id, name: r.groups.name, updatedAt: r.groups.updated_at, personId: r.person_id, role: r.role }))
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

export async function members(groupId) {
  const sb = await client();
  return run(sb.from('group_members').select('user_id, display_name, person_id, role, joined_at').eq('group_id', groupId).order('joined_at'));
}

export async function groupInfo(groupId) {
  const sb = await client();
  return run(sb.from('groups').select('id, name, invite_code, created_by').eq('id', groupId).single());
}

export async function createGroup(name, data, displayName, personId) {
  const sb = await client();
  return run(sb.rpc('create_group', { p_name: name, p_data: data, p_display_name: displayName, p_person_id: personId || null }));
}

export async function joinGroup(code, displayName) {
  const sb = await client();
  return run(sb.rpc('join_group', { p_code: code, p_display_name: displayName }));
}

export async function setMyPerson(groupId, personId) {
  const sb = await client();
  const user = await getUser();
  await run(sb.from('group_members').update({ person_id: personId }).eq('group_id', groupId).eq('user_id', user.id));
}

export async function leaveGroup(groupId) {
  const sb = await client();
  const user = await getUser();
  await run(sb.from('group_members').delete().eq('group_id', groupId).eq('user_id', user.id));
}

/** Backend für sync.js */
export const backend = {
  async load(groupId) {
    const sb = await client();
    const row = await run(sb.from('groups').select('data, version').eq('id', groupId).single());
    return { data: row.data || {}, version: row.version };
  },
  async save(groupId, data, version) {
    const sb = await client();
    return run(sb.rpc('save_group', { p_id: groupId, p_data: data, p_version: version }));
  },
};

/** Live-Updates: ruft fn(neueVersion) auf, wenn jemand anderes speichert; onLive(true/false) meldet, ob die Verbindung steht. Gibt eine Abmelde-Funktion zurück. */
export async function watchGroup(groupId, fn, onLive = () => {}) {
  const sb = await client();
  const channel = sb.channel(`group-${groupId}`)
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'groups', filter: `id=eq.${groupId}` }, (p) => fn(p.new?.version ?? Infinity))
    .subscribe((status) => onLive(status === 'SUBSCRIBED'));
  return () => sb.removeChannel(channel);
}

// ---------- Rollen, Profile, Protokoll ----------

export async function setRole(groupId, userId, role) {
  const sb = await client();
  await run(sb.rpc('set_member_role', { p_group: groupId, p_user: userId, p_role: role }));
}

export async function removeMember(groupId, userId) {
  const sb = await client();
  await run(sb.from('group_members').delete().eq('group_id', groupId).eq('user_id', userId));
}

export async function renewInvite(groupId) {
  const sb = await client();
  return run(sb.rpc('renew_invite', { p_group: groupId }));
}

/** Alle Profile der Fahrgemeinschaft: [{ userId, data, updatedAt }] */
export async function loadProfiles(groupId) {
  const sb = await client();
  const rows = await run(sb.from('member_profiles').select('user_id, data, updated_at').eq('group_id', groupId));
  return rows.map((r) => ({ userId: r.user_id, data: r.data || {}, updatedAt: r.updated_at }));
}

/** Eigenes Profil speichern. */
export async function saveProfile(groupId, data) {
  const sb = await client();
  const user = await getUser();
  await run(sb.from('member_profiles').upsert({ group_id: groupId, user_id: user.id, data, updated_at: new Date().toISOString() }));
}

export async function addLog(groupId, actor, action) {
  const sb = await client();
  const { error } = await sb.from('group_log').insert({ group_id: groupId, actor, action });
  if (error) console.warn('Protokoll:', error.message);
}

export async function loadLog(groupId, limit = 150) {
  const sb = await client();
  return run(sb.from('group_log').select('actor, action, at').eq('group_id', groupId).order('at', { ascending: false }).limit(limit));
}

/** Live-Updates der Profile. */
export async function watchProfiles(groupId, fn) {
  const sb = await client();
  const channel = sb.channel(`profiles-${groupId}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'member_profiles', filter: `group_id=eq.${groupId}` }, () => fn())
    .subscribe();
  return () => sb.removeChannel(channel);
}
