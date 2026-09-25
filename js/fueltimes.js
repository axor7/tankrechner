// Beste Tankzeiten: typischer Tagesverlauf + eigene Messungen.

/**
 * Typischer Preisaufschlag je Stunde (Cent/Liter über dem Tagestief).
 * Näherung an den in Deutschland seit Jahren beobachteten Tagesverlauf
 * (u. a. Auswertungen von ADAC und Markttransparenzstelle): Spitze am frühen
 * Morgen, mehrere Preissprünge über den Tag, Tief am Abend (ca. 19–22 Uhr).
 * Keine Messwerte, sondern ein Richtwert!
 */
export const TYPICAL_CURVE = [
  9, 10, 10, 11, 11, 12, 13, 14, // 0–7 Uhr
  12, 10, 8, 9, 10, 8, 7, 7, // 8–15 Uhr
  6, 6, 4, 1, 0, 1, 6, 8, // 16–23 Uhr
];

/** Günstigstes zusammenhängendes Zeitfenster der Länge len (Stunden). */
export function bestWindow(curve, len = 2) {
  let best = { start: 0, avg: Infinity };
  for (let s = 0; s < 24; s++) {
    let sum = 0;
    for (let k = 0; k < len; k++) sum += curve[(s + k) % 24];
    const avg = sum / len;
    if (avg < best.avg) best = { start: s, avg };
  }
  return { start: best.start, end: (best.start + len) % 24, avg: best.avg };
}

export function worstHour(curve) {
  let w = 0;
  for (let h = 1; h < 24; h++) if (curve[h] > curve[w]) w = h;
  return w;
}

/**
 * Eigene Messungen → Stundenprofil.
 * obs: [{t: ms, sid, fuel, price}] – Abweichung zum Tagestief der jeweiligen Tankstelle.
 * Gibt {curve, count, hoursCovered} zurück; curve[h] = null wenn keine Daten.
 */
export function profileFromObservations(obs, fuel) {
  const byDay = new Map();
  for (const o of obs) {
    if (o.fuel !== fuel || !(o.price > 0)) continue;
    const d = new Date(o.t);
    const key = `${o.sid}|${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    if (!byDay.has(key)) byDay.set(key, []);
    byDay.get(key).push({ h: d.getHours(), p: o.price });
  }
  const sums = new Array(24).fill(0);
  const counts = new Array(24).fill(0);
  let count = 0;
  for (const list of byDay.values()) {
    if (list.length < 2) continue; // ohne Vergleich am selben Tag nicht aussagekräftig
    const min = Math.min(...list.map((x) => x.p));
    for (const x of list) {
      sums[x.h] += (x.p - min) * 100;
      counts[x.h] += 1;
      count++;
    }
  }
  const curve = sums.map((s, h) => (counts[h] ? s / counts[h] : null));
  return { curve, count, hoursCovered: counts.filter(Boolean).length };
}

/** Füllt Lücken im Profil mit der typischen Kurve (verschoben aufs gleiche Niveau). */
export function blendProfile(own, typical = TYPICAL_CURVE) {
  return typical.map((t, h) => (own[h] == null ? t : own[h]));
}
