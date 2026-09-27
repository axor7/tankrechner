// Reine Rechenlogik (ohne DOM) – wird auch von den Tests benutzt.

export const FUELS = {
  e10: { label: 'Super E10', tk: 'e10' },
  e5: { label: 'Super E5', tk: 'e5' },
  diesel: { label: 'Diesel', tk: 'diesel' },
  lpg: { label: 'Autogas (LPG)', tk: null },
  cng: { label: 'Erdgas (CNG, kg)', tk: null },
};

export const DIRECTIONS = ['hin', 'rueck'];

/** Kosten für eine Strecke in km mit den Einstellungen eines Snapshots. */
export function legCost(km, snap) {
  const liters = (km * (Number(snap.consumption) || 0)) / 100;
  const fuel = liters * (Number(snap.price) || 0);
  const extra = (km * (Number(snap.extraPerKm) || 0)) / 100; // extraPerKm in Cent
  return { liters, fuel, extra, total: fuel + extra };
}

/** Teilstrecken in Fahrtrichtung. legIndex bezieht sich immer auf die Hin-Reihenfolge. */
export function directedLegs(snapLegs, direction) {
  const legs = snapLegs.map((l, i) => ({ legIndex: i, from: l.from, to: l.to, km: l.km, min: l.min || 0 }));
  if (direction !== 'rueck') return legs;
  return legs.reverse().map((l) => ({ ...l, from: l.to, to: l.from }));
}

/** Alle Personen, die irgendwo auf der Fahrt mitfahren (inkl. Fahrer). */
export function tripPeople(trip) {
  const s = new Set();
  for (const leg of trip.legs || []) for (const p of leg || []) s.add(p);
  if (trip.driver) s.add(trip.driver);
  return s;
}

/** Wer sitzt auf Teilstrecke i im Auto? Fahrer ist immer dabei. */
export function ridersOnLeg(trip, i, legCount) {
  let list;
  const legs = trip.legs || [];
  if (legs.length === legCount) list = legs[i] || [];
  else {
    // Route hat sich geändert → auf "alle Mitfahrer auf allen Teilstrecken" zurückfallen
    list = [...tripPeople(trip)];
  }
  const s = new Set(list);
  if (trip.driver) s.add(trip.driver);
  return s;
}

// ---------- Adressen, die Personen gehören ("Auto-Modus") ----------

/** Sind im Snapshot Adressen Personen zugeordnet? Dann werden Teilstrecken automatisch berechnet. */
export const hasOwners = (snap) => !!snap?.stops?.some((s) => s.owners?.length);

export function haversine(a, b) {
  const R = 6371;
  const toRad = (x) => (x * Math.PI) / 180;
  const dLat = toRad(b[0] - a[0]);
  const dLng = toRad(b[1] - a[1]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a[0])) * Math.cos(toRad(b[0])) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Eindeutiger Schlüssel für eine Stoppfolge (zum Zwischenspeichern berechneter Routen). */
export const routeKey = (stops) => stops.map((s) => `${s.lat.toFixed(5)},${s.lng.toFixed(5)}`).join(';');

/** Reihenfolge aller Stopps für eine Richtung (Rückfahrt: eigene Reihenfolge, sonst umgekehrt). */
export function orderedStops(snap, direction) {
  if (direction !== 'rueck') return snap.stops;
  const byId = new Map(snap.stops.map((x) => [x.id, x]));
  const order = (snap.returnOrder || []).map((id) => byId.get(id)).filter(Boolean);
  return order.length === snap.stops.length ? order : [...snap.stops].reverse();
}

/** Stopps, die bei dieser Fahrt wirklich angefahren werden: Adressen ohne Zuordnung immer,
 *  zugeordnete nur, wenn mindestens eine ihrer Personen mitfährt. */
export function plannedStops(trip, snap, direction) {
  const people = tripPeople(trip);
  return orderedStops(snap, direction).filter((x) => !x.owners?.length || x.owners.some((o) => people.has(o)));
}

/** Grobe Schätzung (Luftlinie × 1,3), bis die echte Route berechnet ist. */
function estimateLegs(stops) {
  return stops.slice(1).map((x, i) => {
    const km = Math.round(haversine([stops[i].lat, stops[i].lng], [x.lat, x.lng]) * 13) / 10;
    return { km, min: (km / 70) * 60 };
  });
}

/**
 * Teilstrecken einer Fahrt in Fahrtrichtung, jeweils mit den Personen im Auto.
 * Auto-Modus: Wer einer Adresse zugeordnet ist, sitzt auf dem Hinweg ab seiner Adresse
 * im Auto und auf dem Rückweg bis zu seiner Adresse. Ohne Zuordnung: ganze Fahrt.
 * Sonst: manuell gepflegte Teilstrecken (trip.legs).
 */
export function resolveLegs(trip, snap, direction = 'hin') {
  if (!hasOwners(snap)) {
    const n = snap.legs.length;
    return {
      auto: false,
      legs: directedLegs(snap.legs, direction).map((l) => ({ ...l, min: snap.legs[l.legIndex].min || 0, riders: ridersOnLeg(trip, l.legIndex, n) })),
    };
  }
  const stops = plannedStops(trip, snap, direction);
  if (stops.length < 2) return { auto: true, legs: [], stops };
  const key = routeKey(stops);
  const known = snap.routes?.[key];
  const dist = known && known.length === stops.length - 1 ? known : estimateLegs(stops);
  const people = [...tripPeople(trip)];
  const owned = new Map(people.map((p) => [p, stops.flatMap((x, k) => (x.owners?.includes(p) ? [k] : []))]));
  const legs = dist.map((d, i) => {
    const riders = new Set(trip.driver ? [trip.driver] : []);
    for (const p of people) {
      const idx = owned.get(p);
      if (!idx.length) riders.add(p);
      else if (direction === 'rueck' ? i < Math.max(...idx) : i >= Math.min(...idx)) riders.add(p);
    }
    return { legIndex: i, from: stops[i].name, to: stops[i + 1].name, km: d.km, min: d.min || 0, riders };
  });
  return { auto: true, legs, stops, key, estimated: dist !== known };
}

/**
 * Berechnet eine einzelne Fahrt.
 * opts.mode: 'segment' (jede Teilstrecke wird unter den dort Mitfahrenden geteilt)
 *            'equal'   (Gesamtkosten gleich auf alle Mitfahrenden der Fahrt)
 * opts.driverPays: zahlt der Fahrer seinen Anteil selbst mit?
 * opts.includeExtra: Nebenkosten (ct/km) mit abrechnen? (Standard: ja)
 * direction: 'hin' | 'rueck' (wichtig, wenn Adressen Personen zugeordnet sind)
 */
export function calcTrip(trip, snap, opts = {}, direction = 'hin') {
  const mode = opts.mode || 'segment';
  const driverPays = opts.driverPays !== false;
  const withExtra = opts.includeExtra !== false;
  const resolved = resolveLegs(trip, snap, direction);
  const shares = {};
  const km = {};
  const minutes = {};
  let total = 0;
  let fuelCost = 0;
  let extraCost = 0;
  let extraExcluded = 0; // Nebenkosten, die ausgeschaltet sind (nur zur Anzeige)
  let liters = 0;
  let dist = 0;
  const legDetails = [];
  const add = (obj, k, v) => { obj[k] = (obj[k] || 0) + v; };

  for (const leg of resolved.legs) {
    const c = legCost(leg.km, snap);
    const cost = withExtra ? c.total : c.fuel;
    const { riders } = leg;
    total += cost;
    fuelCost += c.fuel;
    if (withExtra) extraCost += c.extra;
    else extraExcluded += c.extra;
    liters += c.liters;
    dist += leg.km;
    for (const p of riders) { add(km, p, leg.km); add(minutes, p, leg.min); }
    let payers = [...riders];
    if (!driverPays && trip.driver) {
      payers = payers.filter((p) => p !== trip.driver);
      if (!payers.length) payers = [trip.driver];
    }
    const per = payers.length ? cost / payers.length : 0;
    legDetails.push({ ...leg, cost, riders: [...riders], payers, per });
    if (mode === 'segment') for (const p of payers) add(shares, p, per);
  }

  if (mode === 'equal') {
    let payers = [...tripPeople(trip)];
    if (!driverPays && trip.driver) {
      payers = payers.filter((p) => p !== trip.driver);
      if (!payers.length) payers = [trip.driver];
    }
    for (const p of payers) add(shares, p, total / payers.length);
  }

  return {
    total, fuelCost, extraCost, extraExcluded, liters, km: dist, shares, kmPerPerson: km, minPerPerson: minutes,
    payer: trip.driver || null, legs: legDetails, auto: resolved.auto, estimated: !!resolved.estimated,
  };
}

/** Summiert beliebig viele Fahrten: [{trip, snap, date, direction}] */
export function aggregate(entries, opts = {}) {
  const persons = {};
  const get = (id) => (persons[id] ||= { share: 0, paid: 0, km: 0, min: 0, trips: 0 });
  let total = 0;
  let fuelCost = 0;
  let extraCost = 0;
  let extraExcluded = 0;
  let liters = 0;
  let km = 0;
  const trips = [];
  for (const e of entries) {
    const r = calcTrip(e.trip, e.snap, opts, e.direction);
    total += r.total;
    fuelCost += r.fuelCost;
    extraCost += r.extraCost;
    extraExcluded += r.extraExcluded;
    liters += r.liters;
    km += r.km;
    for (const [p, v] of Object.entries(r.shares)) get(p).share += v;
    for (const [p, v] of Object.entries(r.kmPerPerson)) { get(p).km += v; get(p).min += r.minPerPerson[p] || 0; get(p).trips += 1; }
    if (r.payer) get(r.payer).paid += r.total;
    trips.push({ ...e, result: r });
  }
  for (const p of Object.values(persons)) p.balance = p.paid - p.share;
  return { total, fuelCost, extraCost, extraExcluded, liters, km, persons, trips };
}

/** Wer zahlt wem wie viel? Minimiert grob die Anzahl Überweisungen. Beträge in Euro, auf Cent gerundet. */
export function settle(persons) {
  const cents = Object.entries(persons).map(([id, p]) => {
    const raw = (p.balance || 0) * 100;
    return { id, raw, c: Math.round(raw) };
  });
  // Rundungsdifferenz ausgleichen (bei den am stärksten gerundeten Werten), damit die Summe exakt 0 ist
  let diff = cents.reduce((s, x) => s + x.c, 0);
  const byError = [...cents].sort((a, b) => (diff > 0 ? (b.c - b.raw) - (a.c - a.raw) : (a.c - a.raw) - (b.c - b.raw)));
  for (let k = 0; diff !== 0 && byError.length; k = (k + 1) % byError.length) {
    const step = diff > 0 ? 1 : -1;
    byError[k].c -= step;
    diff -= step;
  }
  const debtors = cents.filter((x) => x.c < 0).map((x) => ({ ...x, c: -x.c })).sort((a, b) => b.c - a.c);
  const creditors = cents.filter((x) => x.c > 0).sort((a, b) => b.c - a.c);
  const transfers = [];
  let i = 0;
  let j = 0;
  while (i < debtors.length && j < creditors.length) {
    const amount = Math.min(debtors[i].c, creditors[j].c);
    if (amount > 0) transfers.push({ from: debtors[i].id, to: creditors[j].id, amount: amount / 100 });
    debtors[i].c -= amount;
    creditors[j].c -= amount;
    if (debtors[i].c === 0) i++;
    if (creditors[j].c === 0) j++;
  }
  return transfers;
}

// ---------- Datum / Kalenderwochen (alles als 'YYYY-MM-DD', UTC-basiert) ----------

export function toISODate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function parseISO(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function fmtUTC(d) {
  return d.toISOString().slice(0, 10);
}

export function addDays(iso, n) {
  const d = parseISO(iso);
  d.setUTCDate(d.getUTCDate() + n);
  return fmtUTC(d);
}

/** Montag der Woche, in der iso liegt */
export function mondayOf(iso) {
  const d = parseISO(iso);
  const wd = (d.getUTCDay() + 6) % 7; // Mo=0
  d.setUTCDate(d.getUTCDate() - wd);
  return fmtUTC(d);
}

export function isoWeek(iso) {
  const d = parseISO(iso);
  const wd = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - wd + 3); // Donnerstag der Woche
  const year = d.getUTCFullYear();
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const week = 1 + Math.round(((d - jan4) / 86400000 - 3 + ((jan4.getUTCDay() + 6) % 7)) / 7);
  return { year, week };
}

export function weekDates(mondayIso) {
  return Array.from({ length: 7 }, (_, i) => addDays(mondayIso, i));
}

export function weekdayIndex(iso) {
  return (parseISO(iso).getUTCDay() + 6) % 7;
}
