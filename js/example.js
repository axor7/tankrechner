// Beispieldaten zum Ausprobieren.
import { defaultState, uid, COLORS, makeSnapshot } from './state.js';
import { addDays, mondayOf, toISODate, weekDates } from './calc.js';

export function loadExample() {
  const s = defaultState();
  const [me, anna, ben, clara] = ['Ich', 'Anna', 'Ben', 'Clara'].map((name, i) => ({ id: uid(), name, color: COLORS[i] }));
  s.persons = [me, anna, ben, clara];
  s.defaultDriver = me.id;
  s.stops = [
    { id: uid(), label: 'Karlsruhe Hauptbahnhof, 76137 Karlsruhe', lat: 48.9936, lng: 8.4011, owners: [me.id] },
    { id: uid(), label: 'Ettlingen Stadtbahnhof, 76275 Ettlingen', lat: 48.9406, lng: 8.4075, owners: [anna.id] },
    { id: uid(), label: 'Pforzheim Hauptbahnhof, 75175 Pforzheim', lat: 48.8934, lng: 8.7026, owners: [ben.id, clara.id] },
    { id: uid(), label: 'Stuttgart Hauptbahnhof, 70173 Stuttgart', lat: 48.784, lng: 9.1817, owners: [] },
  ];
  s.car = { consumption: 6.5, fuel: 'e10', extraPerKm: 0 };
  s.price = { ...s.price, mode: 'manual', manual: 1.749 };
  s.exampleFresh = true; // echte Kilometer kommen, sobald die Route berechnet ist

  // Jeder steigt an seiner eigenen Adresse zu – die Teilstrecken ergeben sich automatisch.
  const snap = makeSnapshot(s);
  const trip = (people, driver = me.id) => ({ driver, legs: [[...people]] });
  const all = [me.id, anna.id, ben.id, clara.id];

  const thisWeek = mondayOf(toISODate(new Date()));
  const lastWeek = addDays(thisWeek, -7);
  const d = weekDates(thisWeek);
  const p = weekDates(lastWeek);

  s.weeks[lastWeek] = {
    snap: { ...snap, price: 1.789 },
    days: Object.fromEntries(p.slice(0, 5).map((date, i) => [date, { hin: trip(all, i === 4 ? anna.id : me.id), rueck: trip(all, i === 4 ? anna.id : me.id) }])),
  };
  s.weeks[thisWeek] = {
    snap,
    days: {
      [d[0]]: { hin: trip(all), rueck: trip(all) },
      [d[1]]: { hin: trip(all), rueck: trip([me.id, anna.id, clara.id]) }, // Ben fährt nicht mit zurück
      [d[2]]: { hin: trip([me.id, anna.id, ben.id]), rueck: trip(all) }, // Clara kommt nur zurück mit
      [d[3]]: { hin: trip([me.id, anna.id, ben.id]), rueck: trip([me.id, anna.id, ben.id]) },
      [d[4]]: { hin: trip([me.id, ben.id]), rueck: trip([me.id, ben.id]) }, // Anna fehlt → Ettlingen wird ausgelassen
    },
  };
  return s;
}
