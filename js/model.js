// Datenmodell v2 (reine Logik, ohne DOM – wird getestet).
//
// Wer fährt wann? Von oben nach unten, die jüngere Angabe gewinnt:
//   einzelner Tag (selbst oder vom Fahrer eingetragen) · Abwesenheit (Urlaub, krank …) ·
//   fahrfreie Zeit (Schulferien, Feiertage, eigene Zeiträume) · Rhythmus (immer / bestimmte Wochen / nach Absprache).
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
  const out = persons.map(({ active, ...p }) => ({ ...p, plan: [...(p.plan || [])], absences: (p.absences || []).map((a) => ({ ...a, src: 'shared' })) }));
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
    if (d.absences?.length) p.absences = [...(p.absences || []), ...d.absences.map((a) => ({ ...a, src: 'profile' }))];
    if (d.drives) p.drives = newer(p.drives, d.drives);
    if (d.car) p.car = newer(p.car, d.car);
    if (d.plan?.length) p.plan = [...p.plan, ...d.plan];
    if (d.paypal) p.paypal = (d.paypal.at || 0) >= (p.paypalAt || 0) ? d.paypal.name : p.paypal;
    if (d.name && p.self) p.name = d.name;
    if (d.color && p.self) p.color = d.color;
  }
  return out;
}

/** Gültige Regelplan-Version an einem Tag (die jüngste, die schon gilt) oder null. */
export function planVersion(p, date) {
  let best = null;
  for (const v of p?.plan || []) {
    if (v.from > date) continue;
    if (!best || v.from > best.from || (v.from === best.from && (v.at || 0) >= (best.at || 0))) best = v;
  }
  return best;
}

/** Wochentage des Regelplans (ohne Rücksicht auf den Rhythmus): { hin: [7], rueck: [7], mode, … } */
export function planFor(p, date) {
  const best = planVersion(p, date);
  return best ? { ...best, hin: best.hin || EMPTY_WEEK(), rueck: best.rueck || EMPTY_WEEK(), mode: best.mode || 'always' } : { hin: EMPTY_WEEK(), rueck: EMPTY_WEEK(), mode: 'always' };
}

/** Wochen zwischen zwei Montagen (kann negativ sein). */
const weeksBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / (7 * 864e5));

/**
 * Fällt diese Woche in den Rhythmus? always: jede Woche · weeks: jede n-te Woche ab anchor oder nur die gewählten Wochen ·
 * flex (nach Absprache): nie – jede Fahrt wird einzeln eingetragen.
 */
export function weekInRhythm(v, monday) {
  const mode = v?.mode || 'always';
  if (mode === 'flex') return false;
  if (mode !== 'weeks') return true;
  if (v.weeks?.length) return v.weeks.includes(monday);
  const every = Math.max(1, Number(v.every) || 2);
  const k = weeksBetween(v.anchor || mondayOf(v.from), monday);
  return ((k % every) + every) % every === 0;
}

/** Regelplan an genau diesem Tag (mit Rhythmus): { hin: [7], rueck: [7] } – leer, wenn die Woche nicht dran ist. */
export function planOn(p, date) {
  const v = planFor(p, date);
  return weekInRhythm(v, mondayOf(date)) ? { hin: v.hin, rueck: v.rueck } : { hin: EMPTY_WEEK(), rueck: EMPTY_WEEK() };
}

/** Abwesenheit an diesem Tag (die jüngste, falls mehrere) oder null. */
export function absenceOn(p, date) {
  let best = null;
  for (const a of p?.absences || []) if (!a.deleted && a.from <= date && date <= (a.until || a.from) && (!best || (a.at || 0) > (best.at || 0))) best = a;
  return best;
}

export const hasPlan = (p) => (p?.plan || []).length > 0;

/**
 * Neue Regelplan-Version ab `from` (ersetzt eine Version mit demselben Startdatum).
 * rhythm: { mode: 'always' | 'weeks' | 'flex', every, anchor, weeks }
 */
export function withPlanVersion(plan = [], from, hin, rueck, at = Date.now(), rhythm = {}) {
  const v = { from, hin: [...hin], rueck: [...rueck], at };
  if (rhythm.mode && rhythm.mode !== 'always') {
    v.mode = rhythm.mode;
    if (rhythm.mode === 'weeks') {
      if (rhythm.weeks?.length) v.weeks = [...rhythm.weeks].sort();
      else { v.every = Math.max(2, Number(rhythm.every) || 2); v.anchor = rhythm.anchor || mondayOf(from); }
    }
  }
  return [...plan.filter((x) => x.from !== from), v];
}

// ---------- Tage ----------

/** Gültige Version des Fahrer-Plans an einem Tag (oder null). */
export function driverPlanAt(shared, date) {
  let best = null;
  for (const v of shared.drivers || []) if (v.from <= date && (!best || v.from > best.from || (v.from === best.from && (v.at || 0) >= (best.at || 0)))) best = v;
  return best;
}

/**
 * Wer ist an diesem Tag der normale Fahrer? Fahrer-Plan (gilt ab seinem Datum):
 *   { id } immer dieselbe Person · { mode: 'weekday', ids: [7] } je Wochentag · { mode: 'rotate', ids: [...], anchor } wochenweise abwechselnd
 */
export function driverAt(shared, date) {
  const v = driverPlanAt(shared, date);
  if (!v) return shared.defaultDriver;
  if (v.mode === 'weekday') return v.ids?.[weekdayIndex(date)] || v.id || shared.defaultDriver;
  if (v.mode === 'rotate' && v.ids?.length) {
    const k = weeksBetween(v.anchor || mondayOf(v.from), mondayOf(date));
    return v.ids[((k % v.ids.length) + v.ids.length) % v.ids.length];
  }
  return v.id || shared.defaultDriver;
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
  const profileDrive = new Map(); // personId → { date → {hin, rueck, at} } – „ich fahre“ (Vertretung)
  for (const pr of profiles) {
    if (!pr.personId) continue;
    if (pr.data?.days) profileDays.set(pr.personId, pr.data.days);
    if (pr.data?.drive) profileDrive.set(pr.personId, pr.data.drive);
  }
  const dirsAll = shared.roundTrip === false ? ['hin'] : DIRECTIONS;

  /** Fahrfreie Zeit an diesem Tag (Schulferien, Feiertag, eigener Zeitraum) → { name, kind } oder null. */
  const holiday = (date) => freeOn(shared, date);

  /**
   * Fährt Person pid an diesem Tag in diese Richtung mit? → { value, why }
   * why: 'day' (einzeln eingetragen), 'drive' (fährt als Vertretung), 'absent', 'free', 'plan', 'removed', 'off'
   */
  function ridesWhy(pid, date, dir) {
    const day = days[date];
    if (day?.off) return { value: false, why: 'off' };
    const p = byId.get(pid);
    if (p?.archived && p.archivedFrom && date >= p.archivedFrom) return { value: false, why: 'removed' }; // entfernt: ab dann nie mehr dabei
    // Rhythmus – in fahrfreien Zeiten fährt danach niemand
    const free = holiday(date);
    let value = !!(p && planOn(p, date)[dir][weekdayIndex(date)]) && !free;
    let why = free && p && planOn(p, date)[dir][weekdayIndex(date)] ? 'free' : 'plan';
    let at = -1;
    // Abwesenheit, einzelne Tage, Vertretung: die jüngste Angabe gewinnt
    const abs = absenceOn(p, date);
    if (abs) { value = false; why = 'absent'; at = abs.at || 0; }
    for (const e of [day?.people?.[pid], profileDays.get(pid)?.[date]]) {
      if (e && e[dir] !== undefined && (e.at || 0) >= at) { value = !!e[dir]; why = 'day'; at = e.at || 0; }
    }
    const dr = profileDrive.get(pid)?.[date];
    if (dr?.[dir] && (dr.at || 0) >= at) { value = true; why = 'drive'; }
    return { value, why };
  }
  const rides = (pid, date, dir) => ridesWhy(pid, date, dir).value;

  /** Wer kann fahren? (Hauptfahrer, als Fahrer markierte Personen, Fahrer im Fahrer-Plan) */
  const canDrive = (p) => isActive(p) && (p.id === shared.defaultDriver || p.drives?.value === true || p.drives === true
    || (shared.drivers || []).some((v) => v.id === p.id || v.ids?.includes(p.id)));

  /** Alles zu einem Tag: frei?, wer fährt hin/zurück, wer ist Fahrer, wer wäre normal Fahrer. */
  function dayInfo(date) {
    const day = days[date] || {};
    const info = { date, off: !!day.off, riders: {}, driver: {}, regular: driverAt(shared, date), free: holiday(date), substitute: {} };
    for (const dir of dirsAll) {
      const riders = persons.filter((p) => rides(p.id, date, dir)).map((p) => p.id);
      let driver = day.driver?.[dir];
      if (driver && !riders.includes(driver)) driver = null;
      if (!driver && riders.includes(info.regular)) driver = info.regular;
      if (!driver) {
        // Vertretung: wer sich als Fahrer eingetragen hat (der zuerst gemeldete)
        const vol = persons.map((p) => ({ id: p.id, e: profileDrive.get(p.id)?.[date] }))
          .filter((x) => x.e?.[dir] && riders.includes(x.id)).sort((a, b) => (a.e.at || 0) - (b.e.at || 0))[0];
        if (vol) { driver = vol.id; info.substitute[dir] = true; }
      }
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
    for (const d of profileDrive.values()) dates.push(...Object.keys(d));
    return dates.length ? dates.sort()[0] : null;
  }

  return { persons, byId, rides, ridesWhy, dayInfo, trip, startDate, holiday, canDrive, dirs: dirsAll, shared };
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
    cars: carsOf(persons),                              // eigenes Auto je Fahrer (sonst das der Gruppe)
    prices: { ...(shared.price?.byFuel || {}) },        // Preis je Kraftstoff (für Fahrer mit anderem Sprit)
    // Umleitungen (gelten je Datum von–bis; eingefrorene Wochen behalten ihre)
    detours: (shared.detours || []).filter((d) => d?.lat != null).map(({ id, dir, lat, lng, bearing, place, from, until, use }) => ({ id, dir, lat, lng, bearing, place, from, until, use })),
    at: Date.now(),
  };
}

/** Eigene Autos der Fahrer: { pid: { consumption, fuel, extraPerKm } } (nur vollständige Angaben). */
export function carsOf(persons) {
  const out = {};
  for (const p of persons) {
    const c = p.car;
    if (c && Number(c.consumption) > 0) out[p.id] = { consumption: Number(c.consumption), fuel: c.fuel || null, extraPerKm: c.extraPerKm != null && c.extraPerKm !== '' ? Number(c.extraPerKm) : null };
  }
  return out;
}

/** Werte des Autos, mit dem diese Fahrt gefahren wird (eigenes Auto des Fahrers, sonst das der Gruppe). */
export function carFor(week, driver) {
  const base = { consumption: week.consumption, price: week.price, extraPerKm: week.extraPerKm, fuel: week.fuel };
  const c = week.cars?.[driver];
  if (!c) return base;
  const fuel = c.fuel || base.fuel;
  const price = fuel === base.fuel ? base.price : Number(week.prices?.[fuel]) || base.price;
  return { consumption: c.consumption, price, extraPerKm: c.extraPerKm ?? base.extraPerKm, fuel };
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
/**
 * Schulferien an diesem Tag? → { start, end, name } oder null.
 * Nur wenn eingeschaltet und erst ab dem Tag, an dem es eingeschaltet wurde (nicht rückwirkend).
 */
export function holidayOn(hol, date) {
  if (!hol?.enabled || (hol.from && date < hol.from)) return null;
  return (hol.periods || []).find((p) => p.start <= date && date <= p.end) || null;
}

/** Gesetzlicher Feiertag (wenn eingeschaltet, ab dem Einschalten) → { start, end, name } oder null. */
export function publicHolidayOn(hol, date) {
  const pub = hol?.public;
  if (!pub?.enabled || (pub.from && date < pub.from)) return null;
  return (pub.periods || []).find((p) => p.start <= date && date <= p.end) || null;
}

/**
 * Fahrfreie Zeit an diesem Tag: Schulferien, gesetzlicher Feiertag oder eigener Zeitraum der Gruppe
 * (z. B. Betriebsferien) → { name, kind: 'school' | 'public' | 'custom', start, end } oder null.
 */
export function freeOn(shared, date) {
  const custom = (shared.offPeriods || []).find((p) => !p.deleted && p.from <= date && date <= (p.until || p.from));
  if (custom) return { name: custom.name || 'Fahrfrei', kind: 'custom', start: custom.from, end: custom.until || custom.from, id: custom.id };
  const pub = publicHolidayOn(shared.holidays, date);
  if (pub) return { ...pub, kind: 'public' };
  const school = holidayOn(shared.holidays, date);
  return school ? { ...school, kind: 'school' } : null;
}

/** Umleitungen, die an diesem Tag gefahren werden (von–bis, beide Tage eingeschlossen; Varianten mit use: false nicht). */
export const activeDetours = (detours, date) => (detours || []).filter((d) => d?.lat != null && d.use !== false && (!d.from || d.from <= date) && (!d.until || date <= d.until));

export function tripSnap(week, trip, routes = {}, names = {}, date = null) {
  const base = { ...carFor(week, trip.driver), split: week.split };
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
