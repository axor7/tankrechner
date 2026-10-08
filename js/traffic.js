// Sperrungen & Baustellen auf Autobahnen – offene Daten der Autobahn GmbH des Bundes (verkehr.autobahn.de, ohne Schlüssel).
// Für Bundes-, Landes- und Kreisstraßen gibt es keine offenen Echtzeitdaten; dafür trägt man eine Umleitung ein.
// Die Rechenfunktionen hier sind ohne DOM und werden getestet.

const API = 'https://verkehr.autobahn.de/o/autobahn';
export const SOURCE = 'Autobahn GmbH des Bundes';

const KINDS = { CLOSURE: 'closure', CLOSURE_ENTRY_EXIT: 'ramp', ROADWORKS: 'roadworks', SHORT_TERM_ROADWORKS: 'short' };
export const KIND_LABEL = { closure: 'Sperrung', ramp: 'Auf-/Abfahrt gesperrt', roadworks: 'Baustelle', short: 'Kurzzeitbaustelle' };
export const isClosure = (item) => item.kind === 'closure' || item.kind === 'ramp';

/** Lesbarer Titel: „A8 | Karlsruhe - Pforzheim“ → „Karlsruhe – Pforzheim“, Auffahrten aus dem Untertitel, interne Kennungen weg. */
export function cleanTitle(it) {
  const ramp = it.kind === 'ramp' && (it.subtitle || '').match(/^(?:Von\s+)?(?:Auffahrt auf die A\d+:\s*)?AS\s+(.+?)\s*(?:\(aus Richtung\s+(.+?)\))?\s*nach\s+(A\s?\d+)/i);
  if (ramp) return `Auffahrt ${ramp[1]} auf die ${ramp[3].replace(/\s/, '')}`;
  const t = it.title.replace(/^A\d+\s*\|\s*/, '').replace(/^A\d+\s+/, '').replace(/\b[A-Z]{2}_\d{4}-\S+\s*/g, '').replace(/_/g, ' ').replace(/ - /g, ' – ').trim();
  return t || it.title;
}

/** Straßennummern aus dem Routenplaner ("A 8;E 52", "B 10") → Autobahnen der API ("A8"). */
export function autobahnRefs(refs) {
  const out = new Set();
  for (const r of refs || []) {
    for (const part of String(r).split(/[;,/]/)) {
      const m = part.trim().match(/^A\s*(\d{1,3})$/i);
      if (m) out.add(`A${Number(m[1])}`);
    }
  }
  return [...out];
}

// ---------- Zeiten aus den Beschreibungstexten ----------

const D = String.raw`(\d{1,2})\.(\d{1,2})\.(\d{2,4})`;
const T = String.raw`(\d{1,2}):(\d{2})`;
const RX = {
  begin: new RegExp(String.raw`^Beginn:\s*${D}(?:\s*um)?(?:\s*${T})?`),
  end: new RegExp(String.raw`^Ende:\s*${D}(?:\s*um)?(?:\s*${T})?`),
  overall: new RegExp(String.raw`Ende der Gesamtmaßnahme:\s*${D}`),
  range: new RegExp(String.raw`^${D}\s+${T}\s+bis zum\s+${D}\s+${T}`),
  day: new RegExp(String.raw`^${D}\s+von\s+${T}\s+bis\s+${T}`),
  recurring: new RegExp(String.raw`zwischen dem\s+${D}\s+und dem\s+${D}\s+von\s+${T}\s+bis\s+${T}`),
};

function at(d, m, y, hh = 0, mm = 0) {
  let year = Number(y);
  if (year < 100) year += 2000;
  return new Date(year, Number(m) - 1, Number(d), Number(hh) || 0, Number(mm) || 0);
}
const nextDayIfBefore = (start, end) => (end <= start ? new Date(end.getTime() + 864e5) : end);

/**
 * Zeitangaben einer Meldung auslesen.
 * → { start, end, overallEnd, windows: [{ start, end }], recurring }
 *   recurring: Zeitraum mit wiederkehrenden Zeitfenstern (z. B. jede Nacht) – genaue Uhrzeiten stehen im Text.
 */
export function parseTimes(lines = [], startTimestamp = null) {
  const out = { start: null, end: null, overallEnd: null, windows: [], recurring: false };
  for (const raw of lines) {
    const l = String(raw).trim();
    let m;
    if ((m = l.match(RX.begin))) out.start = at(m[1], m[2], m[3], m[4], m[5]);
    else if ((m = l.match(RX.end))) out.end = at(m[1], m[2], m[3], m[4], m[5]);
    else if ((m = l.match(RX.overall))) out.overallEnd = at(m[1], m[2], m[3], 23, 59);
    else if ((m = l.match(RX.range))) out.windows.push({ start: at(m[1], m[2], m[3], m[4], m[5]), end: at(m[6], m[7], m[8], m[9], m[10]) });
    else if ((m = l.match(RX.day))) {
      const start = at(m[1], m[2], m[3], m[4], m[5]);
      out.windows.push({ start, end: nextDayIfBefore(start, at(m[1], m[2], m[3], m[6], m[7])) });
    } else if ((m = l.match(RX.recurring))) {
      const start = at(m[1], m[2], m[3], m[7], m[8]);
      const lastStart = at(m[4], m[5], m[6], m[7], m[8]);
      out.windows.push({ start, end: nextDayIfBefore(lastStart, at(m[4], m[5], m[6], m[9], m[10])), recurring: true });
      out.recurring = true;
    }
  }
  if (!out.start && startTimestamp) {
    const s = new Date(startTimestamp);
    if (!Number.isNaN(s.getTime())) out.start = s;
  }
  if (out.windows.length) {
    out.start ||= new Date(Math.min(...out.windows.map((w) => w.start.getTime())));
    out.end ||= new Date(Math.max(...out.windows.map((w) => w.end.getTime())));
  }
  return out;
}

/**
 * Stand einer Meldung zu einem Zeitpunkt.
 * → { state: 'active' | 'upcoming' | 'sometimes' | 'ended' | 'unknown', from, until }
 *   sometimes: innerhalb eines Zeitraums mit wiederkehrenden Zeitfenstern
 */
export function timeStatus(times, now = new Date()) {
  const t = now.getTime();
  const once = times.windows.filter((w) => !w.recurring);
  if (times.recurring) {
    const from = times.start;
    const until = times.end;
    if (until && until.getTime() <= t) return { state: 'ended', from, until };
    if (from && from.getTime() > t) return { state: 'upcoming', from, until };
    return { state: 'sometimes', from, until };
  }
  if (once.length) {
    const cur = once.find((w) => w.start.getTime() <= t && t < w.end.getTime());
    if (cur) return { state: 'active', from: cur.start, until: cur.end };
    const next = once.filter((w) => w.start.getTime() > t).sort((a, b) => a.start - b.start)[0];
    if (next) return { state: 'upcoming', from: next.start, until: next.end };
    return { state: 'ended', from: times.start, until: times.end };
  }
  if (times.end && times.end.getTime() <= t) return { state: 'ended', from: times.start, until: times.end };
  if (times.start && times.start.getTime() > t) return { state: 'upcoming', from: times.start, until: times.end };
  if (times.start || times.end) return { state: 'active', from: times.start, until: times.end };
  return { state: 'unknown', from: null, until: times.overallEnd };
}

/** Noch relevant? Nicht vorbei und spätestens in `days` Tagen. */
export function isCurrent(times, now = new Date(), days = 14) {
  const st = timeStatus(times, now);
  if (st.state === 'ended') return false;
  if (st.state === 'upcoming' && st.from && st.from.getTime() - now.getTime() > days * 864e5) return false;
  return true;
}

// ---------- Texte ----------

const WD = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
const pad = (n) => String(n).padStart(2, '0');

/** „Do 08.10. 05:00“ – Jahr nur, wenn es nicht das aktuelle ist; Uhrzeit nur, wenn nicht Mitternacht. */
export function fmtWhen(d, now = new Date(), { time: withTime = true } = {}) {
  if (!d) return '';
  const year = d.getFullYear() !== now.getFullYear() ? String(d.getFullYear()) : '';
  const time = withTime && (d.getHours() || d.getMinutes()) ? ` ${pad(d.getHours())}:${pad(d.getMinutes())}` : '';
  return `${WD[d.getDay()]} ${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${year}${time}`;
}

/** „noch 18 Std.“ / „noch 52 Tage“ */
export function fmtRemaining(until, now = new Date()) {
  if (!until) return '';
  const hours = (until.getTime() - now.getTime()) / 36e5;
  if (hours <= 0) return '';
  if (hours < 1) return 'noch unter 1 Std.';
  if (hours < 48) return `noch ${Math.round(hours)} Std.`;
  return `noch ${Math.ceil(hours / 24)} Tage`;
}

/** Eine Zeile: was gilt gerade und bis wann? */
export function statusText(item, now = new Date()) {
  const st = timeStatus(item.times, now);
  const closed = isClosure(item);
  const what = closed ? 'Gesperrt' : 'Baustelle';
  const until = st.until ? ` bis ${fmtWhen(st.until, now)}` : '';
  const rest = fmtRemaining(st.until, now);
  if (st.state === 'upcoming') return `${what} ab ${fmtWhen(st.from, now)}${until}`;
  if (st.state === 'sometimes') return `${closed ? 'Zeitweise gesperrt' : 'Zeitweise Baustelle'}${until}${rest ? ` · ${rest}` : ''}`;
  if (st.state === 'active') return `${what}${until}${rest ? ` · ${rest}` : ''}`;
  return item.times.overallEnd ? `${what} · Maßnahme bis ${fmtWhen(item.times.overallEnd, now, { time: false })}` : what;
}

// ---------- Laden ----------

/** Eine Meldung der API in ein einfaches Format bringen. */
export function normalize(x, road) {
  const kind = KINDS[x?.display_type];
  if (!kind) return null;
  let coords = [];
  if (x.geometry?.type === 'LineString') coords = x.geometry.coordinates.map(([lng, lat]) => [Number(lat), Number(lng)]);
  else if (x.coordinate) coords = [[Number(x.coordinate.lat), Number(x.coordinate.long)]];
  coords = coords.filter(([lat, lng]) => Number.isFinite(lat) && Number.isFinite(lng));
  if (!coords.length) return null;
  const lines = (x.description || []).map((l) => String(l).trim()).filter(Boolean);
  return {
    id: String(x.identifier || `${road}:${coords[0].join(',')}`),
    road,
    kind,
    title: String(x.title || '').replace(/\s+/g, ' ').trim(),
    subtitle: String(x.subtitle || '').replace(/\s+/g, ' ').trim(),
    lines,
    coords,
    times: parseTimes(lines, x.startTimestamp),
  };
}

const cache = new Map(); // Autobahn → { at, items }

/** Sperrungen und Baustellen einer Autobahn (15 Minuten zwischengespeichert). */
export async function roadEvents(road, { maxAge = 15 * 60e3, force = false } = {}) {
  const c = cache.get(road);
  if (!force && c && Date.now() - c.at < maxAge) return c.items;
  const get = async (svc) => {
    const res = await fetch(`${API}/${encodeURIComponent(road)}/services/${svc}`);
    if (!res.ok) throw new Error(`Autobahn-Daten: HTTP ${res.status}`);
    return res.json();
  };
  const [closures, works] = await Promise.all([get('closure'), get('roadworks')]);
  const items = [...(closures.closure || []), ...(works.roadworks || [])].map((x) => normalize(x, road)).filter(Boolean);
  cache.set(road, { at: Date.now(), items });
  return items;
}

// ---------- Liegt eine Meldung auf unserer Strecke (und in unserer Fahrtrichtung)? ----------

/**
 * Meldungen entlang einer Route (coords: [[lat, lng]]).
 * Eine Meldung zählt, wenn ein großer Teil ihres Abschnitts direkt auf der Route liegt (≤ maxDist Meter)
 * und sie in Fahrtrichtung verläuft – die Gegenfahrbahn liegt zwar nah, verläuft aber rückwärts.
 * → Meldungen mit `pos` (Meter ab Start der Route) und `shown` (nur der Teil auf der Route, zum Zeichnen),
 *   sortiert in Fahrtrichtung.
 */
export function alongRoute(items, coords, { maxDist = 35 } = {}) {
  if (!coords?.length || coords.length < 2 || !items?.length) return [];
  const lat0 = coords[Math.floor(coords.length / 2)][0];
  const kx = 111320 * Math.cos((lat0 * Math.PI) / 180);
  const ky = 110540;
  const P = coords.map(([lat, lng]) => [lng * kx, lat * ky]);
  const cum = [0];
  for (let i = 1; i < P.length; i++) cum.push(cum[i - 1] + Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]));

  // Raster (1 km) mit den Teilstücken der Route – damit nicht jeder Punkt gegen alle Teilstücke geprüft wird
  const CELL = 1000;
  const grid = new Map();
  const cellKey = (cx, cy) => `${cx},${cy}`;
  for (let i = 0; i < P.length - 1; i++) {
    const [ax, ay] = P[i];
    const [bx, by] = P[i + 1];
    const x0 = Math.floor((Math.min(ax, bx) - maxDist) / CELL);
    const x1 = Math.floor((Math.max(ax, bx) + maxDist) / CELL);
    const y0 = Math.floor((Math.min(ay, by) - maxDist) / CELL);
    const y1 = Math.floor((Math.max(ay, by) + maxDist) / CELL);
    for (let cx = x0; cx <= x1; cx++) {
      for (let cy = y0; cy <= y1; cy++) {
        const k = cellKey(cx, cy);
        if (!grid.has(k)) grid.set(k, []);
        grid.get(k).push(i);
      }
    }
  }
  const nearest = (x, y) => {
    const segs = grid.get(cellKey(Math.floor(x / CELL), Math.floor(y / CELL)));
    if (!segs) return null;
    let best = null;
    for (const i of segs) {
      const [ax, ay] = P[i];
      const [bx, by] = P[i + 1];
      const dx = bx - ax;
      const dy = by - ay;
      const len2 = dx * dx + dy * dy;
      const t = len2 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / len2)) : 0;
      const d = Math.hypot(x - (ax + t * dx), y - (ay + t * dy));
      if (!best || d < best.d) best = { d, pos: cum[i] + t * Math.sqrt(len2) };
    }
    return best && best.d <= maxDist ? best : null;
  };

  const out = [];
  const seen = new Set();
  for (const item of items) {
    if (seen.has(item.id)) continue;
    // Punkte des Abschnitts (höchstens 40, gleichmäßig verteilt)
    const pts = item.coords.length <= 40 ? item.coords : Array.from({ length: 40 }, (_, k) => item.coords[Math.round((k * (item.coords.length - 1)) / 39)]);
    const xy = pts.map(([lat, lng]) => [lng * kx, lat * ky]);
    const hits = xy.map(([x, y]) => nearest(x, y));
    const near = hits.filter(Boolean);
    if (!near.length) continue;
    let total = 0;
    let overlap = 0;
    for (let k = 1; k < xy.length; k++) {
      const len = Math.hypot(xy[k][0] - xy[k - 1][0], xy[k][1] - xy[k - 1][1]);
      total += len;
      if (hits[k] && hits[k - 1]) overlap += len;
    }
    if (total > 50 && overlap < Math.min(200, total * 0.5)) continue; // nur gestreift (z. B. eine Auffahrt, die wir nicht nehmen)
    if (item.kind === 'ramp' && total > 50 && overlap < total * 0.6) continue; // Auf-/Abfahrt: nur, wenn wir sie wirklich fahren
    if (total <= 50 && near.length < Math.ceil(hits.length / 2)) continue;
    const first = near[0].pos;
    const last = near[near.length - 1].pos;
    if (near.length > 1 && last - first < -20) continue; // läuft rückwärts → Gegenrichtung
    seen.add(item.id);
    // Nur den Teil zeigen, der auf unserer Route liegt (längstes zusammenhängendes Stück)
    let shown = [];
    let run = [];
    for (const [lat, lng] of item.coords) {
      if (nearest(lng * kx, lat * ky)) run.push([lat, lng]);
      else { if (run.length > shown.length) shown = run; run = []; }
    }
    if (run.length > shown.length) shown = run;
    out.push({ ...item, pos: Math.min(first, last), shown: shown.length ? shown : item.coords });
  }
  return dedupe(out).sort((a, b) => a.pos - b.pos);
}

/** Gleiche Meldung mehrfach (z. B. je gesperrtem Fahrstreifen) → nur einmal. */
export function dedupe(items) {
  const seen = new Set();
  return items.filter((i) => {
    const k = [i.kind, i.title, i.subtitle, i.times.start?.getTime(), i.times.end?.getTime()].join('|');
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
