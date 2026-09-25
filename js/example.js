// Beispieldaten zum Ausprobieren.
import { defaultState, uid, COLORS } from './state.js';
import { addDays, mondayOf, toISODate, weekDates } from './calc.js';

export function loadExample() {
  const s = defaultState();
  const [me, anna, ben, clara] = ['Ich', 'Anna', 'Ben', 'Clara'].map((name, i) => ({ id: uid(), name, color: COLORS[i] }));
  s.persons = [me, anna, ben, clara];
  s.defaultDriver = me.id;
  s.stops = [
    { id: uid(), label: 'Karlsruhe Hauptbahnhof, 76137 Karlsruhe', lat: 48.9936, lng: 8.4011 },
    { id: uid(), label: 'Pforzheim Hauptbahnhof, 75175 Pforzheim', lat: 48.8934, lng: 8.7026 },
    { id: uid(), label: 'Stuttgart Hauptbahnhof, 70173 Stuttgart', lat: 48.784, lng: 9.1817 },
  ];
  s.car = { consumption: 6.5, fuel: 'e10', extraPerKm: 0 };
  s.price = { ...s.price, mode: 'manual', manual: 1.749 };
  s.exampleFresh = true;

  const snap = {
    legs: [{ from: 'Karlsruhe Hauptbahnhof', to: 'Pforzheim Hauptbahnhof', km: 32 }, { from: 'Pforzheim Hauptbahnhof', to: 'Stuttgart Hauptbahnhof', km: 49 }],
    consumption: 6.5, price: 1.749, extraPerKm: 0, fuel: 'e10', roundTrip: true, at: Date.now(),
  };
  // Ich und Anna starten in Karlsruhe, Ben und Clara steigen in Pforzheim zu.
  const trip = (people, driver = me.id) => ({
    driver,
    legs: [people.filter((p) => p === me.id || p === anna.id), people],
  });
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
      [d[4]]: { hin: trip([me.id, anna.id]), rueck: trip([me.id, anna.id]) },
    },
  };
  return s;
}
