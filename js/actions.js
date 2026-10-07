// Alle Änderungen an einer Stelle: prüft die Rechte, speichert im eigenen Profil (Mitfahrer)
// oder in den gemeinsamen Daten (Admin) und schreibt ins Änderungsprotokoll.
import { state, update, model, personById, todayIso, uid, COLORS } from './state.js';
import { inGroup, isAdmin, myPersonId, updateProfile, log } from './account.js';
import { withPlanVersion, isActive, planFor } from './model.js';
import { mondayOf, addDays, isoWeek } from './calc.js';
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
    p = { id: pid, name: m?.name || 'Neu', color: m?.color || COLORS[5], plan: [] };
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
  const entry = (d) => (paid ? { amount: d.amount, at, by: nameOf(mine), pid: mine } : { revoked: true, at, by: nameOf(mine), pid: mine });
  if (isAdmin()) {
    update((s) => { for (const d of items) s.payments[d.key] = entry(d); });
  } else if (items.every((d) => d.from === mine || d.to === mine)) {
    updateProfile((p) => { p.paid ||= {}; for (const d of items) p.paid[d.key] = entry(d); });
  } else deny();
  const sum = items.reduce((a, d) => a + d.amount, 0).toFixed(2).replace('.', ',');
  const who = [...new Set(items.map((d) => nameOf(d.from)))].join(', ');
  const reported = paid && items.every((d) => d.from === mine);
  log(paid ? `${who}: ${sum} € ${reported ? 'als bezahlt gemeldet' : 'als bezahlt markiert'} (${items.length} ${items.length === 1 ? 'Woche' : 'Wochen'})` : `${who}: „bezahlt“ zurückgenommen (${sum} €)`);
  return reported; // true: wartet noch auf Bestätigung
}

/** Empfänger (oder Admin für jemand ohne Konto): gemeldete Zahlung bestätigen oder ablehnen. */
export function confirmPayment(items, ok) {
  const at = Date.now();
  const mine = me();
  const entry = (d) => (ok ? { amount: d.amount, at, by: nameOf(mine), pid: mine } : { rejected: true, at, by: nameOf(mine), pid: mine });
  if (items.every((d) => d.to === mine) && !isAdmin()) {
    updateProfile((p) => { p.paid ||= {}; for (const d of items) p.paid[d.key] = entry(d); });
  } else if (isAdmin()) {
    update((s) => { for (const d of items) s.payments[d.key] = entry(d); });
  } else deny();
  const sum = items.reduce((a, d) => a + d.open, 0).toFixed(2).replace('.', ',');
  log(`${nameOf(items[0].from)} → ${nameOf(items[0].to)}: ${sum} € ${ok ? 'Zahlung bestätigt' : 'Zahlung nicht erhalten'}`);
}

// ---------- Admin: Mitfahrer & Einstellungen ----------

export function addPerson(name) {
  if (!isAdmin()) deny();
  update((s) => {
    const used = new Set(model().persons.map((p) => p.color));
    s.persons.push({ id: uid(), name, color: COLORS.find((c) => !used.has(c)) || COLORS[s.persons.length % COLORS.length], plan: [] });
  });
  log(`Mitfahrer „${name}“ angelegt`);
}

export function setPersonField(pid, field, value, text) {
  if (!isAdmin()) deny();
  update((s) => { sharedPerson(s, pid)[field] = value; });
  if (text) log(text);
}

/** Löschen: Wer schon mitgefahren ist, wird nur archiviert (ab heute keine Fahrten mehr), damit alte Wochen gleich bleiben. */
export function removePerson(pid) {
  if (!isAdmin()) deny();
  const name = nameOf(pid);
  const m = model();
  const start = m.startDate();
  const today = todayIso();
  let rodeBefore = false;
  if (start) for (let d = start; d < today && !rodeBefore; d = addDays(d, 1)) rodeBefore = m.dirs.some((dir) => m.rides(pid, d, dir));
  update((s) => {
    if (rodeBefore) {
      const p = sharedPerson(s, pid);
      p.archived = true;
      p.archivedFrom = today;
      p.plan = withPlanVersion(p.plan, today, Array(7).fill(false), Array(7).fill(false));
      // künftige Einzel-Anmeldungen entfernen
      for (const [date, day] of Object.entries(s.days)) if (date >= today && day.people) delete day.people[pid];
    } else {
      s.persons = s.persons.filter((x) => x.id !== pid);
      for (const day of Object.values(s.days)) {
        if (day.people) delete day.people[pid];
        for (const dir of ['hin', 'rueck']) if (day.driver?.[dir] === pid) delete day.driver[dir];
      }
    }
    // Wer schon mitgefahren ist, behält seinen Platz in der Reihenfolge: sonst änderte sich die Route der laufenden Woche rückwirkend
    if (!rodeBefore) {
      s.order = (s.order || []).filter((x) => x !== pid);
      s.optimizedOrder = (s.optimizedOrder || []).filter((x) => x !== pid);
    }
  });
  log(rodeBefore ? `Mitfahrer „${name}“ entfernt (vergangene Fahrten bleiben in der Abrechnung)` : `Mitfahrer „${name}“ gelöscht`);
}

/** Fahrer (Auto) wechseln – gilt ab heute, vergangene Fahrten behalten ihren Fahrer. */
export function setDefaultDriver(pid) {
  if (!isAdmin()) deny();
  const today = todayIso();
  update((s) => {
    s.drivers ||= [];
    if (!s.drivers.length && s.defaultDriver) s.drivers.push({ from: '0000-01-01', id: s.defaultDriver, at: 0 });
    s.drivers = [...s.drivers.filter((v) => v.from !== today), { from: today, id: pid, at: Date.now() }];
    s.defaultDriver = pid;
  });
  log(`Fahrer ist ab ${fmtDate(today)} ${nameOf(pid)}`);
}

/**
 * Ganze Woche auf einmal: mode = 'plan' (wie im Regelplan), 'all' (an allen Fahrtagen), 'none' (gar nicht).
 * Admin für alle, Mitfahrer nur für sich.
 */
/** Wer fährt in dieser Woche an welchem Tag – je nach Modus 'plan' | 'all' | 'none'. */
export function weekPattern(pid, monday, mode) {
  const m = model();
  const out = {};
  for (let k = 0; k < 7; k++) {
    const date = addDays(monday, k);
    const plan = planFor(personById(pid), date);
    const patch = {};
    for (const dir of m.dirs) {
      if (mode === 'none') patch[dir] = false;
      else if (mode === 'plan') patch[dir] = !!plan[dir][k];
      else if (pid === state.defaultDriver) patch[dir] = k < 5 || !!plan[dir][k];
      // „ganze Woche“: an allen Tagen, an denen gefahren wird (Mo–Fr bzw. wenn der Fahrer fährt)
      else patch[dir] = (k < 5 && !m.dayInfo(date).off) || !!m.dayInfo(date).driver[dir];
    }
    out[date] = patch;
  }
  return out;
}

/** Eine ganze Woche für eine Person festlegen (Schalter an der KW im Kalender). */
export function setWeek(pid, monday, mode) {
  const at = Date.now();
  const entries = {};
  for (const [date, patch] of Object.entries(weekPattern(pid, monday, mode))) entries[date] = { ...patch, at };
  if (isMe(pid)) {
    updateProfile((d) => { d.days ||= {}; for (const [date, e] of Object.entries(entries)) d.days[date] = e; });
  } else if (isAdmin()) {
    update((s) => { for (const [date, e] of Object.entries(entries)) { const day = (s.days[date] ||= {}); day.people ||= {}; day.people[pid] = e; } });
  } else deny();
  const text = { plan: 'nach Regelplan', all: 'fährt die ganze Woche mit', none: 'fährt diese Woche nicht mit' }[mode];
  log(`${nameOf(pid)} in KW ${isoWeek(monday).week}: ${text}`);
}

// ---------- Umleitungen (Admin) ----------

const DIR_TEXT = { hin: 'Hinfahrt', rueck: 'Rückfahrt', both: 'Hin- und Rückfahrt' };
const shortDate = (iso) => fmtDate(iso) + iso.slice(0, 4);

const hitsDir = (d, dir) => d.dir === dir || d.dir === 'both' || dir === 'both';
const usedNow = (d, today) => d.use !== false && (!d.until || d.until >= today);

/**
 * Umleitung eintragen: gilt ab `from` (frühestens heute) bis `until` (leer = bis sie beendet wird).
 * Wird in der Richtung schon eine Umleitung gefahren, kommt die neue als Variante dazu (use: false) – auswählen mit chooseDetour.
 */
export function addDetour({ dir = 'rueck', lat, lng, bearing = null, place, label, note = '', from, until = null, use }) {
  if (!isAdmin()) deny();
  if (lat == null || lng == null) throw new Error('Bitte wähle aus, über welchen Ort die Umleitung führt.');
  const today = todayIso();
  const start = from && from > today ? from : today; // nie rückwirkend
  if (until && until < start) throw new Error('„Gilt bis“ liegt vor „gilt ab“.');
  const taken = (state.detours || []).some((x) => hitsDir(x, dir) && usedNow(x, today));
  const d = {
    id: uid(), dir, lat, lng, bearing, place: place || 'Umleitung', label: label || place || '', note: note.trim(), from: start, until: until || null,
    use: use ?? !taken, at: Date.now(), by: nameOf(me()),
  };
  update((s) => { s.detours = [...(s.detours || []), d]; });
  log(`Umleitung ${DIR_TEXT[dir]} über ${d.place}${d.note ? ` (${d.note})` : ''}${d.use ? '' : ' als Variante'}: ab ${shortDate(start)}${until ? ` bis ${shortDate(until)}` : ''}`);
  return d;
}

/**
 * Welche Umleitung fahren wir in dieser Richtung? id = null: normale Strecke.
 * Gilt ab heute: bisher gefahrene Umleitungen enden gestern und bleiben ab heute als Variante erhalten.
 */
export function chooseDetour(dir, id) {
  if (!isAdmin()) deny();
  const today = todayIso();
  const pick = id ? (state.detours || []).find((x) => x.id === id) : null;
  update((s) => {
    const extra = [];
    for (const d of s.detours || []) {
      if (d.id === id || !hitsDir(d, pick?.dir || dir) || !usedNow(d, today)) continue;
      if ((d.from || today) < today) {
        extra.push({ ...d, id: uid(), from: today, use: false, at: Date.now() });
        d.until = addDays(today, -1);
      } else d.use = false;
    }
    if (id) {
      const x = s.detours.find((d) => d.id === id);
      if (x) { x.use = true; if ((x.from || today) < today) x.from = today; }
    }
    s.detours = [...s.detours, ...extra];
  });
  log(`${DIR_TEXT[pick?.dir || dir]}: ${pick ? `ab heute Umleitung über ${pick.place}` : 'ab heute wieder die normale Strecke'}`);
}

/** Umleitungspunkt verschieben (z. B. auf der Karte gezogen) – gilt ab heute. */
export function moveDetour(id, { lat, lng, place, label }) {
  if (!isAdmin()) deny();
  const today = todayIso();
  const old = (state.detours || []).find((x) => x.id === id);
  if (!old) return;
  if ((old.from || today) >= today) {
    update((s) => { Object.assign(s.detours.find((x) => x.id === id), { lat, lng, place, label, bearing: null, at: Date.now() }); });
  } else {
    // Bisherige Tage behalten den alten Punkt: alte Umleitung endet gestern, neue gilt ab heute
    update((s) => {
      s.detours.find((x) => x.id === id).until = addDays(today, -1);
      s.detours.push({ ...old, id: uid(), lat, lng, place, label, bearing: null, from: today, at: Date.now(), by: nameOf(me()) });
    });
  }
  log(`Umleitung verlegt: jetzt über ${place}`);
}

/** „Gilt bis“ ändern (frühestens heute). */
export function setDetourUntil(id, until) {
  if (!isAdmin()) deny();
  const today = todayIso();
  const d = (state.detours || []).find((x) => x.id === id);
  if (!d) return;
  const value = until ? (until < today ? today : until) : null;
  if (value && d.from && value < d.from) throw new Error('„Gilt bis“ liegt vor „gilt ab“.');
  update((s) => { s.detours.find((x) => x.id === id).until = value; });
  log(`Umleitung über ${d.place}: gilt ${value ? `bis ${shortDate(value)}` : 'ohne Enddatum'}`);
}

/** Umleitung beenden: ab heute wieder die normale Strecke. Bisherige Fahrten bleiben, wie sie waren. */
export function endDetour(id) {
  if (!isAdmin()) deny();
  const today = todayIso();
  const d = (state.detours || []).find((x) => x.id === id);
  if (!d || (d.until && d.until < today)) return; // schon vorbei
  update((s) => {
    if ((d.from || today) >= today || d.use === false) s.detours = s.detours.filter((x) => x.id !== id); // hat nie gegolten → löschen
    else s.detours.find((x) => x.id === id).until = addDays(today, -1);
  });
  log(d.use === false ? `Umleitungs-Variante über ${d.place} gelöscht` : `Umleitung über ${d.place} beendet – ab heute wieder die normale Strecke`);
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
