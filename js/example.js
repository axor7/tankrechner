// Beispieldaten zum Ausprobieren (Datenmodell v2).
import { defaultState, uid, COLORS, todayIso } from './state.js';
import { addDays, mondayOf } from './calc.js';

export function loadExample() {
  const s = defaultState();
  const since = addDays(mondayOf(todayIso()), -14); // Regelplan gilt seit zwei Wochen
  const MOFR = [true, true, true, true, true, false, false];
  const days = (...i) => Array.from({ length: 7 }, (_, k) => i.includes(k));
  const plan = (hin, rueck = hin) => [{ from: since, hin, rueck, at: 1 }];
  const me = { id: uid(), name: 'Max', color: COLORS[0], plan: plan(MOFR), paypal: 'maxmuster',
    address: { label: 'Karlsruhe Hauptbahnhof, 76137 Karlsruhe', lat: 48.9936, lng: 8.4011, at: 1 } };
  const anna = { id: uid(), name: 'Anna', color: COLORS[1], plan: plan(days(0, 1, 2, 3), days(0, 1, 2)),
    address: { label: 'Ettlingen Stadtbahnhof, 76275 Ettlingen', lat: 48.9406, lng: 8.4075, at: 1 } };
  const ben = { id: uid(), name: 'Ben', color: COLORS[2], plan: plan(MOFR),
    address: { label: 'Pforzheim Hauptbahnhof, 75175 Pforzheim', lat: 48.8934, lng: 8.7026, at: 1 } };
  const clara = { id: uid(), name: 'Clara', color: COLORS[3], plan: plan(days(1, 3)),
    address: { label: 'Leonberg Bahnhof, 71229 Leonberg', lat: 48.8003, lng: 9.0048, at: 1 } };
  const tom = { id: uid(), name: 'Tom', color: COLORS[4], plan: [] }; // fährt nur ab und zu mit (einzelne Tage)
  s.persons = [me, anna, ben, clara, tom];
  s.defaultDriver = me.id;
  s.destination = { label: 'Stuttgart Hauptbahnhof, 70173 Stuttgart', lat: 48.784, lng: 9.1817 };
  s.car = { consumption: 6.5, fuel: 'e10', extraPerKm: 0 };
  s.price = { ...s.price, mode: 'manual', manual: 1.749 };
  s.setupDone = true;
  s.kind = 'work';
  s.times = { arrive: '07:45', leave: '16:30' };
  s.setupCar = true;
  // Ein paar Ausnahmen: Ben letzte Woche am Mittwoch nicht dabei, Tom kommt nächste Woche Freitag mit
  const last = addDays(mondayOf(todayIso()), -7);
  const next = addDays(mondayOf(todayIso()), 7);
  s.days[addDays(last, 2)] = { people: { [ben.id]: { hin: false, rueck: false, at: 1 } } };
  s.days[addDays(next, 4)] = { people: { [tom.id]: { hin: true, rueck: true, at: 1 } } };
  s.ui.me = me.id;
  return s;
}
