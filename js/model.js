// Datenmodell v2 (reine Logik, ohne DOM – wird getestet).
//
// Wer fährt wann? = Regelplan der Person (gilt ab einem Datum) + einzelne Tagesänderungen.
// Daten kommen aus zwei Quellen:
//   • gemeinsame Daten (nur Admins ändern): Personen, Ziel, Auto, Tage (Admin-Änderungen), Zahlungen …
//   • Mitglieder-Profile (jeder nur sein eigenes): Adresse, Regelplan, eigene Tage, „bezahlt“-Meldungen
// Bei Widersprüchen gewinnt die jüngere Änderung (Zeitstempel `at`).
import { weekdayIndex, mondayOf, addDays, weekDates, DIRECTIONS, tripPeople } from './calc.js';

/** Archivierte Personen (gelöscht, aber mit vergangenen Fahrten) werden in Listen ausgeblendet. */
export const isActive = (p) => !p?.archived;
const newer = (a, b) => ((b?.at || 0) > (a?.at || 0) ? b : a);
const EMPTY_WEEK = () => Array(7).fill(false);

// ---------- Personen ----------

/**
 * Personen aus gemeinsamen Daten + Profilen zusammenführen.
 * profiles: [{ userId, personId, data }]
 */
export function mergePersons(persons = [], profiles = []) {
  // Früheres „inaktiv“ gibt es nicht mehr (galt rückwirkend) – wer nicht mitfährt, hat keine Tage im Regelplan
  const out = persons.map(({ active, ...p }) => ({ ...p, plan: [...(p.plan || [])] }));
  const byId = new Map(out.map((p) => [p.id, p]));
  for (const pr of profiles) {
    if (!pr.personId) continue;
    const d = pr.data || {};
    let p = byId.get(pr.personId);
    if (!p) {
      // Selbst angelegte Person (Mitfahrer ohne Eintrag des Admins)
      if (!pr.personId.startsWith('u:')) continue;
      p = { id: pr.personId, name: d.name || 'Neu', color: d.color || '#8e8e93', active: true, plan: [], self: true };
      out.push(p);
      byId.set(p.id, p);
    }
    p.userId = pr.userId;
    if (d.address) p.address = newer(p.address, d.address);
    if (d.plan?.length) p.plan = [...p.plan, ...d.plan];
    if (d.paypal) p.paypal = (d.paypal.at || 0) >= (p.paypalAt || 0) ? d.paypal.name : p.paypal;
    if (d.name && p.self) p.name = d.name;
    if (d.color && p.self) p.color = d.color;
  }
  return out;
}

/** Regelplan einer Person an einem Tag: die jüngste Version, die schon gilt. */
export function planFor(p, date) {
  let best = null;
  for (const v of p?.plan || []) {
    if (v.from > date) continue;
    if (!best || v.from > best.from || (v.from === best.from && (v.at || 0) >= (best.at || 0))) best = v;
  }
  return best ? { hin: best.hin || EMPTY_WEEK(), rueck: best.rueck || EMPTY_WEEK() } : { hin: EMPTY_WEEK(), rueck: EMPTY_WEEK() };
}

export const hasPlan = (p) => (p?.plan || []).length > 0;

/** Neue Regelplan-Version ab `from` (ersetzt eine Version mit demselben Startdatum). */
export function withPlanVersion(plan = [], from, hin, rueck, at = Date.now()) {
  return [...plan.filter((v) => v.from !== from), { from, hin: [...hin], rueck: [...rueck], at }];
}

// ---------- Tage ----------

/** Wer war an diesem Tag der (normale) Fahrer? Fahrerwechsel gelten erst ab ihrem Datum. */
export function driverAt(shared, date) {
  let best = null;
  for (const v of shared.drivers || []) if (v.from <= date && (!best || v.from > best.from || (v.from === best.from && (v.at || 0) >= (best.at || 0)))) best = v;
  return best ? best.id : shared.defaultDriver;
}


/**
 * Modell für eine Fahrgemeinschaft bauen.
 * shared: gemeinsame Daten, profiles: Mitglieder-Profile
 */
export function buildModel(shared, profiles = []) {
  const persons = mergePersons(shared.persons, profiles);
  const byId = new Map(persons.map((p) => [p.id, p]));
  const days = shared.days || {};
  const profileDays = new Map(); // personId → { date → {hin, rueck, at} }
  for (const pr of profiles) if (pr.personId && pr.data?.days) profileDays.set(pr.personId, pr.data.days);
  const dirsAll = shared.roundTrip === false ? ['hin'] : DIRECTIONS;

  /** Fährt Person pid an diesem Tag in diese Richtung mit? */
  function rides(pid, date, dir) {
    const day = days[date];
    if (day?.off) return false;
    const p = byId.get(pid);
    if (p?.archived && p.archivedFrom && date >= p.archivedFrom) return false; // entfernt: ab dann nie mehr dabei
    let value = !!(p && planFor(p, date)[dir][weekdayIndex(date)]);
    let at = -1;
    for (const e of [day?.people?.[pid], profileDays.get(pid)?.[date]]) {
      if (e && e[dir] !== undefined && (e.at || 0) >= at) { value = !!e[dir]; at = e.at || 0; }
    }
    return value;
  }

  /** Alles zu einem Tag: frei?, wer fährt hin/zurück, wer ist Fahrer. */
  function dayInfo(date) {
    const day = days[date] || {};
    const info = { date, off: !!day.off, riders: {}, driver: {} };
    for (const dir of dirsAll) {
      const riders = persons.filter((p) => rides(p.id, date, dir)).map((p) => p.id);
      let driver = day.driver?.[dir];
      if (driver && !riders.includes(driver)) driver = null;
      const regular = driverAt(shared, date);
      if (!driver && riders.includes(regular)) driver = regular;
      info.riders[dir] = riders;
      info.driver[dir] = riders.length ? driver || null : null;
    }
    return info;
  }

  /** Fahrt (im Format von calc.js) oder null, wenn niemand fährt bzw. kein Fahrer da ist. */
  function trip(date, dir) {
    const info = dayInfo(date);
    const riders = info.riders[dir];
    const driver = info.driver[dir];
    if (!riders?.length || !driver) return null;
    return { driver, legs: [[...riders]] };
  }

  /** Frühester Tag mit Daten (für die Abrechnung). */
  function startDate() {
    const dates = [];
    for (const p of persons) for (const v of p.plan || []) dates.push(v.from);
    dates.push(...Object.keys(days));
    for (const d of profileDays.values()) dates.push(...Object.keys(d));
    return dates.length ? dates.sort()[0] : null;
  }

  return { persons, byId, rides, dayInfo, trip, startDate, dirs: dirsAll, shared };
}

// ---------- Woche: Werte & virtuelle Strecke ----------

/** Aktuelle Werte als Wochen-Momentaufnahme (Preis, Verbrauch, Ziel, Adressen, Reihenfolge). */
export function liveWeekSnap(shared, persons, price) {
  const addresses = {};
  for (const p of persons) if (p.address?.lat != null) addresses[p.id] = { label: p.address.label, lat: p.address.lat, lng: p.address.lng };
  return {
    v: 2,
    consumption: Number(shared.car?.consumption) || 0,
    price: Number(price) || 0,
    extraPerKm: Number(shared.car?.extraPerKm) || 0,
    fuel: shared.car?.fuel,
    roundTrip: shared.roundTrip !== false,
    destination: shared.destination ? { label: shared.destination.label, lat: shared.destination.lat, lng: shared.destination.lng } : null,
    addresses,
    order: effectiveOrder(shared, persons),
    returnOrder: shared.returnOrder || null,
    manualKm: Number(shared.manualKm) || 0,
    split: { ...(shared.split || {}) },                 // Aufteilungsregel gilt pro Woche
    // Umleitungen (gelten je Datum von–bis; eingefrorene Wochen behalten ihre)
    detours: (shared.detours || []).filter((d) => d?.lat != null).map(({ id, dir, lat, lng, bearing, place, from, until, use }) => ({ id, dir, lat, lng, bearing, place, from, until, use })),
    at: Date.now(),
  };
}

/** Abholreihenfolge: von Hand festgelegt, sonst die berechnete beste, sonst in Listenreihenfolge. */
export function effectiveOrder(shared, persons) {
  const withAddr = persons.filter((p) => p.address?.lat != null && p.id !== shared.defaultDriver).map((p) => p.id);
  const base = shared.order?.length ? shared.order : shared.optimizedOrder?.length ? shared.optimizedOrder : [];
  return [...base.filter((id) => withAddr.includes(id)), ...withAddr.filter((id) => !base.includes(id))];
}

const short = (label, fallback) => (label ? label.split(',')[0] : fallback);

/**
 * Strecke einer Fahrt als calc.js-Snapshot: Fahrer-Adresse → Abholpunkte (in Reihenfolge) → Ziel.
 * Mitfahrer ohne Adresse steigen beim Fahrer zu. Ohne Fahrer-Adresse oder Ziel: manuelle Kilometer.
 */
/** Umleitungen, die an diesem Tag gefahren werden (von–bis, beide Tage eingeschlossen; Varianten mit use: false nicht). */
export const activeDetours = (detours, date) => (detours || []).filter((d) => d?.lat != null && d.use !== false && (!d.from || d.from <= date) && (!d.until || date <= d.until));

export function tripSnap(week, trip, routes = {}, names = {}, date = null) {
  const base = { consumption: week.consumption, price: week.price, extraPerKm: week.extraPerKm, fuel: week.fuel, split: week.split };
  const a = week.addresses || {};
  const start = a[trip.driver];
  const dest = week.destination;
  if (!start || !dest) {
    return { ...base, legs: week.manualKm > 0 ? [{ from: 'Start', to: 'Ziel', km: week.manualKm }] : [] };
  }
  const riders = [...tripPeople(trip)];
  const stopOf = new Map(); // Koordinaten → Stopp (mehrere Personen an einer Adresse)
  const stops = [];
  const add = (pid, addr, name) => {
    const k = `${addr.lat.toFixed(5)},${addr.lng.toFixed(5)}`;
    if (stopOf.has(k)) { if (pid) stopOf.get(k).owners.push(pid); return; }
    const st = { id: pid ? `p:${pid}` : 'dest', name, lat: addr.lat, lng: addr.lng, owners: pid ? [pid] : [] };
    stopOf.set(k, st);
    stops.push(st);
  };
  add(trip.driver, start, short(start.label, names[trip.driver] || 'Start'));
  const order = [...(week.order || []), ...riders.filter((id) => !(week.order || []).includes(id))];
  for (const pid of order) if (pid !== trip.driver && riders.includes(pid) && a[pid]) add(pid, a[pid], names[pid] || short(a[pid].label, 'Stopp'));
  // Ziel immer als eigener, letzter Stopp
  stops.push({ id: 'dest', name: short(dest.label, 'Ziel'), lat: dest.lat, lng: dest.lng, owners: [] });
  // Mitfahrer ohne Adresse: steigen beim Fahrer zu
  for (const pid of riders) if (!a[pid] && pid !== trip.driver) stops[0].owners.push(pid);

  const ids = stops.map((s) => s.id);
  let returnOrder = [...ids].reverse();
  if (week.returnOrder?.length) {
    const mid = week.returnOrder.map((pid) => `p:${pid}`).filter((id) => ids.includes(id) && id !== ids[0]);
    const rest = ids.slice(1, -1).filter((id) => !mid.includes(id)).reverse();
    returnOrder = ['dest', ...mid, ...rest, ids[0]];
  }
  const detours = date ? activeDetours(week.detours, date) : [];
  return { ...base, legs: [], stops, returnOrder, detours, routes: { ...routes, ...(week.routes || {}) } };
}

/**
 * Wochen im calc/debts-Format erzeugen: { montag: { snap, days: { datum: { hin: fahrt, rueck: fahrt } } } }
 * Jede Fahrt trägt ihren eigenen Snapshot (`trip.snap`), weil Fahrer und Mitfahrer die Strecke bestimmen.
 * frozen: eingefrorene Wochenwerte { montag: snap }, live: aktuelle Werte für alle anderen Wochen.
 */
export function deriveWeeks(model, fromMonday, toMonday, { frozen = {}, live, routes = {}, until = '9999-12-31' } = {}) {
  const out = {};
  const names = Object.fromEntries(model.persons.map((p) => [p.id, p.name]));
  for (let m = fromMonday; m <= toMonday; m = addDays(m, 7)) {
    const week = frozen[m] || live;
    const days = {};
    for (const date of weekDates(m)) {
      if (date > until) continue;
      for (const dir of model.dirs) {
        const t = model.trip(date, dir);
        if (!t) continue;
        t.snap = tripSnap(week, t, routes, names, date);
        (days[date] ||= {})[dir] = t;
      }
    }
    out[m] = { snap: week, days };
  }
  return out;
}

// ---------- Zahlungen ----------

/**
 * Stand jeder Zahlung (Schlüssel „Woche|von|an“).
 * - Der Zahler meldet „bezahlt“ → pending: der Empfänger muss es bestätigen
 * - Der Empfänger (oder ein Admin für jemand anderen) bestätigt oder trägt selbst ein → paid
 * - Der Empfänger sagt „nicht erhalten“ → rejected: wieder offen, der Zahler sieht einen Hinweis
 * Jeweils die jüngste Meldung zählt; eine bestätigte Zahlung kann der Zahler nicht mehr zurücknehmen.
 * → { [key]: { state, amount, at, by } }
 */
export function paymentStates(adminPayments = {}, profiles = []) {
  const payer = {};
  const receiver = {};
  const put = (map, key, e) => { map[key] = newer(map[key], e); };
  for (const [key, e] of Object.entries(adminPayments)) {
    const [, from] = key.split('|');
    put(e?.pid && e.pid === from ? payer : receiver, key, e); // Admin meldet seine eigene Zahlung → braucht auch Bestätigung
  }
  for (const pr of profiles) {
    for (const [key, e] of Object.entries(pr.data?.paid || {})) {
      const [, from, to] = key.split('|');
      const x = { ...e, by: e.by || 'Mitfahrer' };
      if (pr.personId === from) put(payer, key, x);
      else if (pr.personId === to) put(receiver, key, x);
    }
  }
  const out = {};
  for (const key of new Set([...Object.keys(payer), ...Object.keys(receiver)])) {
    const p = payer[key];
    const r = receiver[key];
    const confirmed = r && !r.revoked && !r.rejected ? { ...r, state: 'paid' } : null;
    if (r && (!p || (r.at || 0) >= (p.at || 0))) {
      if (r.rejected) out[key] = { ...r, state: 'rejected', reported: p && !p.revoked ? p : null };
      else if (confirmed) out[key] = confirmed;
    } else if (p && !p.revoked) out[key] = { ...p, state: 'pending' };
    else if (confirmed) out[key] = confirmed;
  }
  return out;
}

/** Nur die bestätigten Zahlungen (für die offenen Beträge). */
export function effectivePayments(adminPayments = {}, profiles = []) {
  const out = {};
  for (const [key, e] of Object.entries(paymentStates(adminPayments, profiles))) if (e.state === 'paid') out[key] = e;
  return out;
}

// ---------- Umstieg von Version 1 ----------

/** Alte Daten (einzeln gepflegte Fahrten, Stopps mit Personen) in Version 2 umwandeln. */
export function migrateV1(s, today) {
  if (s.schema >= 2) return s;
  const out = { ...s, schema: 2 };
  const valid = (s.stops || []).filter((x) => x.lat != null);
  // Adressen aus zugeordneten Stopps, Ziel = letzter Stopp
  const persons = (s.persons || []).map((p) => ({ ...p }));
  const byId = new Map(persons.map((p) => [p.id, p]));
  valid.forEach((st, i) => {
    if (i === valid.length - 1) return;
    for (const pid of st.owners || []) {
      const p = byId.get(pid);
      if (p && !p.address) p.address = { label: st.label, lat: st.lat, lng: st.lng, at: 0 };
    }
  });
  if (valid.length >= 2) {
    const d = valid[valid.length - 1];
    out.destination = { label: d.label, lat: d.lat, lng: d.lng };
    const first = valid[0];
    const drv = byId.get(s.defaultDriver);
    if (drv && !drv.address) drv.address = { label: first.label, lat: first.lat, lng: first.lng, at: 0 };
  }
  out.order = valid.slice(1, -1).flatMap((st) => st.owners || []);
  // Feste Tage → Regelplan ab heute (Vergangenheit steckt in den Tages-Einträgen)
  for (const p of persons) {
    if (p.pattern) { p.plan = [{ from: today, hin: p.pattern.hin, rueck: p.pattern.rueck, at: 0 }]; delete p.pattern; }
    p.plan ||= [];
  }
  out.persons = persons;
  // Einzeln gepflegte Fahrten → Tages-Einträge
  const days = {};
  const weeks = {};
  for (const [monday, w] of Object.entries(s.weeks || {})) {
    for (const [date, d] of Object.entries(w.days || {})) {
      const day = { people: {} };
      for (const p of persons) day.people[p.id] = { at: 0 };
      for (const dir of DIRECTIONS) {
        const t = d?.[dir];
        const riders = t ? tripPeople(t) : new Set();
        for (const p of persons) day.people[p.id][dir] = riders.has(p.id);
        if (t && t.driver && t.driver !== s.defaultDriver) (day.driver ||= {})[dir] = t.driver;
      }
      days[date] = day;
    }
    // Wochenwerte übernehmen
    const snap = w.snap || {};
    const addresses = {};
    const sv = (snap.stops || []);
    sv.forEach((st, i) => { if (i < sv.length - 1) for (const pid of st.owners || []) addresses[pid] ||= { label: st.name, lat: st.lat, lng: st.lng }; });
    if (sv.length && s.defaultDriver && !addresses[s.defaultDriver]) addresses[s.defaultDriver] = { label: sv[0].name, lat: sv[0].lat, lng: sv[0].lng };
    const last = sv[sv.length - 1];
    weeks[monday] = {
      snap: {
        v: 2, consumption: snap.consumption, price: snap.price, extraPerKm: snap.extraPerKm || 0, fuel: snap.fuel, roundTrip: snap.roundTrip !== false,
        destination: last ? { label: last.name, lat: last.lat, lng: last.lng } : null,
        addresses, order: sv.slice(1, -1).flatMap((st) => st.owners || []), returnOrder: null,
        manualKm: (snap.legs || []).reduce((a, l) => a + (l.km || 0), 0), routes: snap.routes || {}, at: snap.at || 0,
      },
    };
  }
  out.days = days;
  out.weeks = weeks;
  delete out.stops;
  delete out.returnOrder;
  return out;
}
