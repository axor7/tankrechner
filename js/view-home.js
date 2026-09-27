// Ansicht „Übersicht“: das Wichtigste auf einen Blick.
import { state, update, currentLegs, effectivePrice, personById } from './state.js';
import { aggregate, legCost, calcTrip, mondayOf, toISODate, weekDates, DIRECTIONS, FUELS, tripPeople } from './calc.js';
import { weeklyDebts, withPayments, openByPair } from './debts.js';
import { TYPICAL_CURVE, bestWindow } from './fueltimes.js';
import { isActive } from './plan.js';
import { currentMe, upcomingTrips } from './tab-trips.js';
import { inGroup, myPersonId, claims, claimPerson, isLoggedIn } from './account.js';
import { h, fmtEuro, fmtKm, fmtPrice, fmtDate, toast } from './ui.js';
import { icon } from './icons.js';

const today = () => toISODate(new Date());

function claimCard() {
  const taken = claims();
  const free = state.persons.filter((p) => isActive(p) && !taken.has(p.id));
  return h('section', { class: 'card' },
    h('h2', {}, 'Wer bist du?'),
    h('p', { class: 'hint' }, 'Wähle deinen Namen aus der Fahrgemeinschaft. Dann siehst du hier, was du zahlen musst, und kannst deine Tage planen.'),
    h('div', { class: 'claim-grid' },
      free.map((p) => h('button', {
        type: 'button', class: 'claim-btn',
        onclick: async () => { try { await claimPerson(p.id); toast(`Hallo ${p.name}!`, 'ok'); } catch (e) { toast(e.message, 'error'); } },
      }, h('span', { class: 'dot', style: { '--pc': p.color } }), p.name)),
    ),
    !free.length ? h('p', { class: 'hint small' }, 'Alle Namen sind schon vergeben – lege dich unter Einstellungen → Mitfahrer neu an.') : null,
  );
}

function setupCard(ctx) {
  const steps = [
    { done: currentLegs().length > 0, label: 'Strecke festlegen', sub: 'Start, Zwischenstopps, Ziel', go: 'route' },
    { done: state.persons.filter(isActive).length > 1, label: 'Mitfahrer anlegen', sub: 'Namen, feste Tage, PayPal', go: 'settings' },
    { done: Object.values(state.weeks).some((w) => Object.values(w.days).some((d) => d.hin || d.rueck)), label: 'Fahrten eintragen', sub: 'Wer fährt wann mit?', go: 'trips' },
    { done: inGroup(), label: 'Gemeinsam nutzen (optional)', sub: 'Anmelden und Kollegen einladen', action: ctx.openAccount },
  ];
  if (steps.slice(0, 3).every((x) => x.done)) return null;
  return h('div', { class: 'section' },
    h('div', { class: 'section-title' }, 'Los geht’s'),
    h('div', { class: 'list' }, steps.map((x, i) => h('button', {
      type: 'button', class: 'list-row', onclick: () => (x.action ? x.action() : ctx.go(x.go)),
    },
      h('span', { class: `step-num ${x.done ? 'done' : ''}` }, x.done ? icon('check', { size: 15 }) : String(i + 1)),
      h('span', { class: 'grow' }, h('span', { class: 'title' }, x.label), h('span', { class: 'sub' }, x.sub)),
      h('span', { class: 'chev' }, icon('chevron-right', { size: 18 }))))),
    h('button', { type: 'button', class: 'btn btn-small', style: { alignSelf: 'flex-start', marginLeft: '1rem' }, onclick: ctx.data.example }, icon('sparkles', { size: 15 }), 'Mit Beispieldaten ausprobieren'),
  );
}

function heroCard(ctx, me) {
  const pairs = openByPair(withPayments(weeklyDebts(state.weeks, state.split, state.roundTrip, today()), state.payments));
  if (me) {
    const owe = pairs.filter((p) => p.from === me).reduce((a, p) => a + p.total, 0);
    const get = pairs.filter((p) => p.to === me).reduce((a, p) => a + p.total, 0);
    if (owe > 0.004) {
      const to = [...new Set(pairs.filter((p) => p.from === me).map((p) => personById(p.to)?.name))].join(', ');
      return h('section', { class: 'hero owe' },
        h('div', { class: 'hero-label' }, 'Du musst noch zahlen'),
        h('div', { class: 'hero-amount' }, fmtEuro(owe)),
        h('div', { class: 'hero-sub' }, `an ${to}`),
        h('button', { type: 'button', class: 'btn btn-small', style: { alignSelf: 'flex-start' }, onclick: () => ctx.go('bill') }, 'Details & PayPal-Link', icon('chevron-right', { size: 15 })));
    }
    if (get > 0.004) {
      return h('section', { class: 'hero good' },
        h('div', { class: 'hero-label' }, 'Du bekommst noch'),
        h('div', { class: 'hero-amount' }, fmtEuro(get)),
        h('div', { class: 'hero-sub' }, `von ${pairs.filter((p) => p.to === me).length} ${pairs.filter((p) => p.to === me).length === 1 ? 'Person' : 'Personen'}`),
        h('button', { type: 'button', class: 'btn btn-small', style: { alignSelf: 'flex-start' }, onclick: () => ctx.go('bill') }, 'Offene Beträge', icon('chevron-right', { size: 15 })));
    }
    return h('section', { class: 'hero good' },
      h('div', { class: 'hero-label' }, `Hallo ${personById(me)?.name}`),
      h('div', { class: 'hero-amount' }, 'Alles bezahlt'),
      h('div', { class: 'hero-sub' }, 'Keine offenen Beträge.'));
  }
  const open = pairs.reduce((a, p) => a + p.total, 0);
  return h('section', { class: 'hero' },
    h('div', { class: 'hero-label' }, 'Offene Beträge insgesamt'),
    h('div', { class: 'hero-amount' }, fmtEuro(open)),
    h('div', { class: 'hero-sub' }, pairs.length ? `${pairs.length} ${pairs.length === 1 ? 'Zahlung' : 'Zahlungen'} offen` : 'Alles ausgeglichen'),
    h('button', { type: 'button', class: 'btn btn-small', style: { alignSelf: 'flex-start' }, onclick: () => ctx.go('settings') }, 'Wer bist du? Auswählen', icon('chevron-right', { size: 15 })));
}

function tiles(ctx) {
  const monday = mondayOf(today());
  const w = state.weeks[monday];
  const dirs = state.roundTrip ? DIRECTIONS : ['hin'];
  const entries = [];
  let planned = 0;
  if (w) {
    for (const date of weekDates(monday)) {
      for (const dir of dirs) {
        const t = w.days[date]?.[dir];
        if (!t) continue;
        if (date > today()) planned += calcTrip(t, w.snap, state.split, dir).total;
        else entries.push({ trip: t, snap: w.snap, date, direction: dir });
      }
    }
  }
  const agg = aggregate(entries, state.split);
  const km = currentLegs().reduce((a, l) => a + l.km, 0);
  const price = effectivePrice();
  const c = legCost(km, { consumption: state.car.consumption, price, extraPerKm: state.car.extraPerKm });
  const perTrip = state.split.includeExtra === false ? c.fuel : c.total;
  const best = bestWindow(TYPICAL_CURVE, 2);
  const tile = (ic, color, label, value, sub, go) => h('button', { type: 'button', class: 'tile', onclick: () => ctx.go(go) },
    h('span', { class: 'tile-top' }, h('span', { class: `sq sq-${color}`, style: { width: '1.5rem', height: '1.5rem', borderRadius: '6px' } }, icon(ic, { size: 14 })), label),
    h('span', { class: 'tile-value' }, value), sub ? h('span', { class: 'tile-sub' }, sub) : null);
  return h('div', { class: 'tiles' },
    tile('calendar-days', 'green', 'Diese Woche', fmtEuro(agg.total), planned > 0 ? `+ ${fmtEuro(planned)} geplant` : `${agg.trips.length} Fahrten`, 'trips'),
    tile('route', 'indigo', 'Pro Fahrt', km ? fmtEuro(perTrip) : '–', km ? fmtKm(km) : 'Strecke fehlt', 'route'),
    tile('fuel', 'orange', FUELS[state.car.fuel]?.label || 'Sprit', fmtPrice(price), state.price.mode !== 'manual' && state.price.current ? 'live' : 'manuell', 'route'),
    tile('clock', 'teal', 'Beste Tankzeit', `${String(best.start).padStart(2, '0')}–${String(best.end).padStart(2, '0')} Uhr`, 'meist am günstigsten', 'route'),
  );
}

function nextTrips(ctx, me) {
  let list = upcomingTrips(20);
  if (me) list = list.filter((x) => tripPeople(x.trip).has(me));
  list = list.slice(0, 5);
  const t0 = today();
  return h('div', { class: 'section' },
    h('div', { class: 'section-title' }, me ? 'Deine nächsten Fahrten' : 'Nächste Fahrten'),
    list.length
      ? h('div', { class: 'list' }, list.map(({ date, dir, trip }) => {
        const others = [...tripPeople(trip)].filter((id) => id !== me && id !== trip.driver).map((id) => personById(id)?.name).filter(Boolean);
        const drv = trip.driver === me ? 'Du fährst' : `mit ${personById(trip.driver)?.name || '?'}`;
        return h('button', { type: 'button', class: 'list-row', onclick: () => { update((s) => { s.ui.week = mondayOf(date); }); ctx.go('trips'); } },
          h('span', { class: 'grow' },
            h('span', { class: 'title' }, `${date === t0 ? 'Heute' : fmtDate(date, { weekday: true, long: true })} · ${dir === 'hin' ? 'Hin' : 'Zurück'}`),
            h('span', { class: 'sub' }, [drv, others.length ? `+ ${others.join(', ')}` : null].filter(Boolean).join(' '))),
          h('span', { class: 'chev' }, icon('chevron-right', { size: 18 })));
      }))
      : h('div', { class: 'list' }, h('div', { class: 'list-row muted' }, 'Keine geplanten Fahrten.')),
    h('button', { type: 'button', class: 'btn btn-small', style: { alignSelf: 'flex-start', marginLeft: '1rem' }, onclick: () => ctx.go('trips') }, icon('calendar-check', { size: 15 }), me ? 'Meine Tage planen' : 'Fahrten planen'),
  );
}

export function renderHome(el, ctx) {
  const me = currentMe();
  if (inGroup() && !myPersonId()) el.append(claimCard());
  const setup = setupCard(ctx);
  if (setup) el.append(setup);
  el.append(heroCard(ctx, me), tiles(ctx), nextTrips(ctx, me));
  if (!isLoggedIn()) {
    el.append(h('button', { type: 'button', class: 'list list-row has-sq', onclick: ctx.openAccount },
      h('span', { class: 'sq sq-blue' }, icon('users', { size: 16 })),
      h('span', { class: 'grow' }, h('span', { class: 'title' }, 'Fahrgemeinschaft gemeinsam nutzen'), h('span', { class: 'sub' }, 'Anmelden, Kollegen einladen, jeder hakt selbst ab')),
      h('span', { class: 'chev' }, icon('chevron-right', { size: 18 }))));
  }
}
