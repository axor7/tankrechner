// Alle Änderungen an einer Stelle: prüft die Rechte, speichert im eigenen Profil (Mitfahrer)
// oder in den gemeinsamen Daten (Admin) und schreibt ins Änderungsprotokoll.
import { state, update, model, personById, todayIso, uid, COLORS } from './state.js';
import { inGroup, isAdmin, myPersonId, updateProfile, log } from './account.js';
import { withPlanVersion, isActive } from './model.js';
import { mondayOf, addDays } from './calc.js';
import { fmtDate } from './ui.js';

const WD = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
const nameOf = (pid) => personById(pid)?.name || '?';
const dayText = (date) => fmtDate(date, { weekday: true }) + date.slice(0, 4);

/** Wer bin ich? In der Fahrgemeinschaft die beanspruchte Person, sonst die auf diesem Gerät gewählte. */
export function me() {
  const id = inGroup() ? myPersonId() : state.ui.me || state.defaultDriver;
  return id && personById(id) ? id : null;
}

const isMe = (pid) => inGroup() && pid === myPersonId();
const deny = () => { throw new Error('Das darf nur ein Admin ändern.'); };

/** Selbst angelegte Person eines Mitfahrers in die gemeinsamen Daten übernehmen (damit der Admin sie bearbeiten kann). */
function sharedPerson(s, pid) {
  let p = s.persons.find((x) => x.id === pid);
  if (!p) {
    const m = personById(pid);
    p = { id: pid, name: m?.name || 'Neu', color: m?.color || COLORS[5], active: true, plan: [] };
    s.persons.push(p);
  }
  return p;
}

// ---------- Tage ----------

/** An einem Tag an-/abmelden: patch = { hin?: bool, rueck?: bool } */
export function setDay(pid, date, patch) {
  const at = Date.now();
  const what = Object.entries(patch).map(([dir, v]) => `${dir === 'hin' ? 'Hin' : 'Zurück'}: ${v ? 'ja' : 'nein'}`).join(', ');
  if (isMe(pid)) {
    updateProfile((d) => { d.days ||= {}; d.days[date] = { ...(d.days[date] || {}), ...patch, at }; });
  } else if (isAdmin()) {
    update((s) => { const day = (s.days[date] ||= {}); day.people ||= {}; day.people[pid] = { ...(day.people[pid] || {}), ...patch, at }; });
  } else deny();
  log(`${nameOf(pid)} am ${dayText(date)}: ${what}`);
}

/** Admin: Tag frei (z. B. Feiertag) */
export function setDayOff(date, off) {
  if (!isAdmin()) deny();
  update((s) => { const day = (s.days[date] ||= {}); if (off) day.off = true; else delete day.off; });
  log(`${dayText(date)} ${off ? 'als freier Tag markiert (keine Fahrt)' : 'wieder als Fahrtag'}`);
}

/** Admin: anderer Fahrer an einem Tag */
export function setDriver(date, dir, pid) {
  if (!isAdmin()) deny();
  update((s) => {
    const day = (s.days[date] ||= {});
    day.driver ||= {};
    if (pid && pid !== s.defaultDriver) day.driver[dir] = pid; else delete day.driver[dir];
  });
  log(`Fahrer am ${dayText(date)} (${dir === 'hin' ? 'Hin' : 'Zurück'}): ${nameOf(pid)}`);
}

// ---------- Regelplan ----------

const planText = (hin, rueck) => {
  const f = (a) => a.map((v, i) => (v ? WD[i] : null)).filter(Boolean).join(', ') || '–';
  return f(hin) === f(rueck) ? f(hin) : `hin ${f(hin)} · zurück ${f(rueck)}`;
};

/** Regelplan ändern – gilt ab heute, frühere Tage bleiben unverändert. */
export function setPlan(pid, hin, rueck) {
  const from = todayIso();
  if (isMe(pid)) {
    updateProfile((d) => { d.plan = withPlanVersion(d.plan, from, hin, rueck); });
  } else if (isAdmin()) {
    update((s) => { const p = sharedPerson(s, pid); p.plan = withPlanVersion(p.plan, from, hin, rueck); });
  } else deny();
  log(`Regelplan von ${nameOf(pid)} ab ${fmtDate(from)}: ${planText(hin, rueck)}`);
}

// ---------- Profil-Angaben ----------

export function setAddress(pid, addr) {
  const value = addr ? { label: addr.label, lat: addr.lat, lng: addr.lng, at: Date.now() } : { label: '', lat: null, lng: null, at: Date.now() };
  if (isMe(pid)) updateProfile((d) => { d.address = value; });
  else if (isAdmin()) update((s) => { sharedPerson(s, pid).address = value; });
  else deny();
  log(`Adresse von ${nameOf(pid)}: ${addr?.label || 'entfernt'}`);
}

export function setPaypal(pid, name) {
  const at = Date.now();
  if (isMe(pid)) updateProfile((d) => { d.paypal = { name, at }; });
  else if (isAdmin()) update((s) => { const p = sharedPerson(s, pid); p.paypal = name; p.paypalAt = at; });
  else deny();
  log(`PayPal von ${nameOf(pid)} ${name ? 'hinterlegt' : 'entfernt'}`);
}

export function setMyName(name) {
  const pid = me();
  if (isMe(pid) && pid.startsWith('u:')) updateProfile((d) => { d.name = name; });
  else if (isAdmin()) update(() => { const p = state.persons.find((x) => x.id === pid); if (p) p.name = name; });
}

// ---------- Zahlungen ----------

/** Als bezahlt melden bzw. zurücknehmen. items: [{ key, amount, from, to, week }] */
export function markPaid(items, paid = true) {
  const at = Date.now();
  const mine = me();
  if (isAdmin()) {
    update((s) => { for (const d of items) s.payments[d.key] = paid ? { amount: d.amount, at, by: nameOf(mine) } : { revoked: true, at, by: nameOf(mine) }; });
  } else if (items.every((d) => d.from === mine || d.to === mine)) {
    updateProfile((p) => { p.paid ||= {}; for (const d of items) p.paid[d.key] = paid ? { amount: d.amount, at, by: nameOf(mine) } : { revoked: true, at, by: nameOf(mine) }; });
  } else deny();
  const sum = items.reduce((a, d) => a + d.amount, 0).toFixed(2).replace('.', ',');
  const who = [...new Set(items.map((d) => nameOf(d.from)))].join(', ');
  log(paid ? `${who}: ${sum} € als bezahlt markiert (${items.length} ${items.length === 1 ? 'Woche' : 'Wochen'})` : `${who}: „bezahlt“ zurückgenommen (${sum} €)`);
}

// ---------- Admin: Mitfahrer & Einstellungen ----------

export function addPerson(name) {
  if (!isAdmin()) deny();
  update((s) => {
    const used = new Set(model().persons.map((p) => p.color));
    s.persons.push({ id: uid(), name, color: COLORS.find((c) => !used.has(c)) || COLORS[s.persons.length % COLORS.length], active: true, plan: [] });
  });
  log(`Mitfahrer „${name}“ angelegt`);
}

export function setPersonField(pid, field, value, text) {
  if (!isAdmin()) deny();
  update((s) => { sharedPerson(s, pid)[field] = value; });
  if (text) log(text);
}

export function removePerson(pid) {
  if (!isAdmin()) deny();
  const name = nameOf(pid);
  update((s) => {
    s.persons = s.persons.filter((x) => x.id !== pid);
    for (const day of Object.values(s.days)) {
      if (day.people) delete day.people[pid];
      for (const dir of ['hin', 'rueck']) if (day.driver?.[dir] === pid) delete day.driver[dir];
    }
    s.order = (s.order || []).filter((x) => x !== pid);
    if (s.defaultDriver === pid) s.defaultDriver = s.persons.find(isActive)?.id || s.persons[0]?.id;
  });
  log(`Mitfahrer „${name}“ gelöscht`);
}

/** Admin-Einstellung ändern und protokollieren. */
export function adminSet(fn, text) {
  if (!isAdmin()) deny();
  update(fn);
  if (text) log(text);
}

// ---------- Wochen einfrieren ----------

/** Abgeschlossene Wochen mit den aktuellen Werten festhalten (nur Admin). */
export function freezePastWeeks(liveSnap) {
  if (!isAdmin()) return;
  const start = model().startDate();
  if (!start) return;
  const current = mondayOf(todayIso());
  const missing = [];
  for (let m = mondayOf(start); m < current; m = addDays(m, 7)) if (state.weeks[m]?.snap?.v !== 2) missing.push(m);
  if (!missing.length) return;
  const snap = liveSnap();
  update((s) => { for (const m of missing) s.weeks[m] = { snap: { ...snap } }; }, { render: false });
}
