// Ansicht „Übersicht“: geführter Einstieg, danach das Persönliche auf einen Blick.
import { state, update, model, personById, activePersons, effectivePrice } from './state.js';
import { mondayOf } from './calc.js';
import { hasPlan, isActive } from './model.js';
import { inGroup, isAdmin, claims, claimPerson, claimNew, myProfile, updateProfile, isLoggedIn, inviteLink, hasPendingJoin } from './account.js';
import { me, setAddress } from './actions.js';
import { myBalance, myWeek, nextDays, perTrip, openPairs, dirsNow } from './derived.js';
import { paypalLink, paypalUser } from './pay.js';
import { addressInput } from './address.js';
import { planEditor, openDay } from './view-trips.js';
import { FUELS } from './calc.js';
import { h, fmtEuro, fmtDate, toast } from './ui.js';
import { icon } from './icons.js';

const safe = async (fn) => { try { await fn(); } catch (e) { toast(e.message, 'error'); } };

// ---------- Willkommen ----------

function welcome(ctx) {
  let code = '';
  return h('div', { class: 'welcome' },
    h('div', { class: 'welcome-hero' },
      h('span', { class: 'app-icon big' }, '⛽'),
      h('h2', {}, 'Spritkosten fair teilen'),
      h('p', { class: 'hint' }, 'Der Fahrer legt das Ziel fest, jeder Mitfahrer trägt seine Adresse und Fahrtage ein – die App plant die Route und rechnet fair ab.')),
    h('div', { class: 'list' },
      h('button', { type: 'button', class: 'list-row has-sq', onclick: () => update((s) => { s.ui.welcomeDone = true; s.ui.tab = 'home'; }) },
        h('span', { class: 'sq sq-blue' }, icon('car', { size: 16 })),
        h('span', { class: 'grow' }, h('span', { class: 'title' }, 'Ich fahre'), h('span', { class: 'sub' }, 'Fahrgemeinschaft einrichten und Mitfahrer einladen')),
        h('span', { class: 'chev' }, icon('chevron-right', { size: 18 }))),
      h('div', { class: 'list-row has-sq' },
        h('span', { class: 'sq sq-green' }, icon('user-plus', { size: 16 })),
        h('form', {
          class: 'grow', onsubmit: (e) => {
            e.preventDefault();
            const m = code.match(/join=([A-Za-z0-9]+)/) || code.match(/([a-f0-9]{12})/i);
            if (!m) { toast('Das ist kein gültiger Einladungslink', 'error'); return; }
            location.hash = `join=${m[1]}`;
            location.reload();
          },
        },
          h('span', { class: 'title' }, 'Ich wurde eingeladen'),
          h('div', { class: 'row gap', style: { marginTop: '.35rem' } },
            h('input', { type: 'text', placeholder: 'Einladungslink einfügen', oninput: (e) => { code = e.target.value; } }),
            h('button', { type: 'submit', class: 'btn btn-small' }, 'Weiter')))),
      h('button', { type: 'button', class: 'list-row has-sq', onclick: ctx.data.example },
        h('span', { class: 'sq sq-yellow' }, icon('sparkles', { size: 16 })),
        h('span', { class: 'grow' }, h('span', { class: 'title' }, 'Beispiel ansehen'), h('span', { class: 'sub' }, 'Mit ausgedachten Daten ausprobieren')),
        h('span', { class: 'chev' }, icon('chevron-right', { size: 18 }))),
      h('button', { type: 'button', class: 'list-row has-sq', onclick: () => ctx.openAccount('login') },
        h('span', { class: 'sq sq-gray' }, icon('circle-user', { size: 16 })),
        h('span', { class: 'grow' }, h('span', { class: 'title' }, 'Ich habe schon ein Konto'), h('span', { class: 'sub' }, 'Anmelden')),
        h('span', { class: 'chev' }, icon('chevron-right', { size: 18 }))),
    ),
  );
}

// ---------- Schritt-für-Schritt ----------

function stepsCard(title, steps, onDone) {
  const current = steps.findIndex((s) => !s.done);
  return h('section', { class: 'card steps-card' },
    h('div', { class: 'row between' }, h('h2', {}, title), h('span', { class: 'muted small' }, `${Math.max(0, current === -1 ? steps.length : current)} von ${steps.length}`)),
    h('div', { class: 'progress' }, h('span', { style: { width: `${((current === -1 ? steps.length : current) / steps.length) * 100}%` } })),
    steps.map((s, i) => h('div', { class: `step ${s.done ? 'done' : ''} ${i === current ? 'current' : ''}` },
      h('div', { class: 'step-head' },
        h('span', { class: `step-num ${s.done ? 'done' : ''}` }, s.done ? icon('check', { size: 15 }) : String(i + 1)),
        h('span', { class: 'grow' }, h('span', { class: 'title' }, s.title), s.done && s.summary ? h('span', { class: 'sub' }, s.summary) : null)),
      i === current ? h('div', { class: 'step-body' }, s.hint ? h('p', { class: 'hint' }, s.hint) : null, s.body()) : null,
    )),
    current === -1 ? h('button', { type: 'button', class: 'btn btn-primary full', onclick: onDone }, icon('check', { size: 17 }), 'Fertig') : null,
  );
}

function adminSetup(ctx) {
  const driver = personById(state.defaultDriver);
  const others = activePersons().filter((p) => p.id !== state.defaultDriver);
  const steps = [
    {
      title: 'Wo startest du?', done: !!driver?.address?.lat, summary: driver?.address?.label,
      hint: 'Deine Adresse – hier beginnt die Fahrt. Die Mitfahrer werden auf dem Weg eingesammelt.',
      body: () => addressInput({ value: driver?.address, placeholder: 'Deine Startadresse', allowLocate: true, onSelect: (a) => safe(() => setAddress(state.defaultDriver, a)) }),
    },
    {
      title: 'Wohin geht es?', done: !!state.destination?.lat, summary: state.destination?.label,
      hint: 'Das Ziel, z. B. die Arbeit.',
      body: () => addressInput({ value: state.destination, placeholder: 'Ziel, z. B. Firma', near: driver?.address, onSelect: (a) => ctx.setDestination(a) }),
    },
    {
      title: 'Dein Auto', done: !!state.setupCar, summary: `${String(state.car.consumption).replace('.', ',')} l/100 km · ${FUELS[state.car.fuel]?.label}`,
      hint: 'Verbrauch und Kraftstoff. Den aktuellen Spritpreis holt die App später automatisch (oder du trägst ihn ein).',
      body: () => {
        let cons = state.car.consumption;
        let fuel = state.car.fuel;
        let price = state.price.manual;
        return h('div', { class: 'acc-form' },
          h('div', { class: 'grid2' },
            h('label', { class: 'field' }, 'Verbrauch (l/100 km)', h('input', { type: 'number', step: 0.1, min: 0, inputmode: 'decimal', value: cons, oninput: (e) => { cons = Number(e.target.value); } })),
            h('label', { class: 'field' }, 'Kraftstoff', h('select', { onchange: (e) => { fuel = e.target.value; } }, Object.entries(FUELS).map(([k, f]) => h('option', { value: k, selected: k === fuel }, f.label))))),
          h('label', { class: 'field' }, 'Spritpreis pro Liter (€, ungefähr)', h('input', { type: 'number', step: 0.001, min: 0, inputmode: 'decimal', value: price, oninput: (e) => { price = Number(e.target.value); } })),
          h('button', { type: 'button', class: 'btn btn-primary', onclick: () => ctx.adminSet((s) => { s.car.consumption = cons; s.car.fuel = fuel; s.price.manual = price; s.setupCar = true; }, `Auto: ${cons} l/100 km, ${FUELS[fuel]?.label}, ${price} €/l`) }, 'Weiter'));
      },
    },
    {
      title: 'Wann fährst du?', done: hasPlan(driver), summary: 'Regelplan gespeichert',
      hint: 'An welchen Tagen fährst du normalerweise? Mitfahrer können nur an diesen Tagen mitfahren (einzelne Tage änderst du später im Kalender).',
      body: () => planEditor({ pid: state.defaultDriver, compact: true, saveLabel: 'Weiter' }),
    },
    {
      title: 'Mitfahrer dazuholen', done: inGroup() || others.length > 0, summary: inGroup() ? 'Fahrgemeinschaft erstellt' : `${others.length} Mitfahrer angelegt`,
      hint: 'Am besten: Konto anlegen, Fahrgemeinschaft erstellen und den Einladungslink per WhatsApp schicken. Jeder trägt dann selbst Adresse und Tage ein.',
      body: () => h('div', { class: 'row gap wrap' },
        h('button', { type: 'button', class: 'btn btn-primary', onclick: () => ctx.openAccount(isLoggedIn() ? undefined : 'register') }, icon('users', { size: 16 }), isLoggedIn() ? 'Fahrgemeinschaft erstellen' : 'Konto anlegen & einladen'),
        h('button', { type: 'button', class: 'btn', onclick: () => ctx.go('settings') }, 'Mitfahrer ohne App anlegen')),
    },
  ];
  return stepsCard('Einrichten', steps, () => ctx.adminSet((s) => { s.setupDone = true; }, 'Einrichtung abgeschlossen'));
}

function memberSetup() {
  const mine = me();
  const person = personById(mine);
  const prof = myProfile();
  const taken = claims();
  let newName = '';
  const steps = [
    {
      title: 'Wer bist du?', done: !!person, summary: person?.name,
      hint: 'Such deinen Namen aus – oder trag dich neu ein.',
      body: () => h('div', {},
        h('div', { class: 'claim-grid' }, activePersons().filter((p) => !taken.has(p.id) && !p.self).map((p) => h('button', {
          type: 'button', class: 'claim-btn', onclick: () => safe(() => claimPerson(p.id)),
        }, h('span', { class: 'dot', style: { '--pc': p.color } }), p.name))),
        h('form', { class: 'row gap', style: { marginTop: '.6rem' }, onsubmit: (e) => { e.preventDefault(); if (newName.trim()) safe(() => claimNew(newName.trim())); } },
          h('input', { type: 'text', placeholder: 'Ich bin neu – mein Name', oninput: (e) => { newName = e.target.value; } }),
          h('button', { type: 'submit', class: 'btn btn-small' }, 'Eintragen'))),
    },
    {
      title: 'Wo sollen wir dich abholen?', done: !!(person?.address?.lat || prof.noAddress), summary: person?.address?.label || 'Steigt beim Fahrer zu',
      hint: 'Deine Abholadresse. Die App plant daraus die Route – du zahlst ab hier.',
      body: () => h('div', {},
        addressInput({ value: person?.address, placeholder: 'Deine Adresse', allowLocate: true, near: personById(state.defaultDriver)?.address, onSelect: (a) => safe(() => setAddress(mine, a)) }),
        h('button', { type: 'button', class: 'link', style: { marginTop: '.5rem' }, onclick: () => updateProfile((d) => { d.noAddress = true; }) }, 'Ich steige beim Fahrer zu')),
    },
    {
      title: 'Wann fährst du mit?', done: hasPlan(person), summary: 'Regelplan gespeichert',
      hint: 'An welchen Tagen fährst du normalerweise mit? Einzelne Tage kannst du später jederzeit im Kalender ändern.',
      body: () => planEditor({ pid: mine, compact: true, saveLabel: 'Weiter' }),
    },
  ];
  return stepsCard('Los geht’s', steps, () => updateProfile((d) => { d.onboarded = true; }));
}

// ---------- Persönliche Übersicht ----------

function costHero(ctx, mine) {
  const bal = myBalance(mine);
  const week = myWeek(mine, mondayOf(new Date().toISOString().slice(0, 10)));
  const weekLine = week.trips ? `Diese Woche: ${fmtEuro(week.done)} bisher${week.planned ? ` · ${fmtEuro(week.planned)} geplant` : ''}` : 'Diese Woche noch keine Fahrten';
  if (bal.oweTotal > 0.004) {
    const pair = bal.owe[0];
    const to = personById(pair.to);
    const single = bal.owe.length === 1;
    const link = single ? paypalLink(paypalUser(to?.paypal), bal.oweTotal) : '';
    return h('section', { class: 'hero owe' },
      h('div', { class: 'hero-label' }, 'Du musst noch zahlen'),
      h('div', { class: 'hero-amount' }, fmtEuro(bal.oweTotal)),
      h('div', { class: 'hero-sub' }, `an ${[...new Set(bal.owe.map((p) => personById(p.to)?.name))].join(', ')} · ${weekLine}`),
      h('div', { class: 'row gap wrap' },
        link ? h('a', { class: 'btn btn-white', href: link, target: '_blank', rel: 'noopener' }, icon('wallet', { size: 17 }), `${fmtEuro(bal.oweTotal)} mit PayPal zahlen`)
          : h('span', { class: 'hero-sub' }, single ? `${to?.name} hat noch kein PayPal hinterlegt.` : ''),
        h('button', { type: 'button', class: 'btn btn-glass', onclick: () => ctx.go('costs') }, single ? 'Ich habe bezahlt / Details' : 'Details')));
  }
  if (bal.getTotal > 0.004) {
    return h('section', { class: 'hero good' },
      h('div', { class: 'hero-label' }, 'Du bekommst noch'),
      h('div', { class: 'hero-amount' }, fmtEuro(bal.getTotal)),
      h('div', { class: 'hero-sub' }, `von ${bal.get.map((p) => personById(p.from)?.name).join(', ')}`),
      h('button', { type: 'button', class: 'btn btn-glass', style: { alignSelf: 'flex-start' }, onclick: () => ctx.go('costs') }, 'Offene Beträge', icon('chevron-right', { size: 15 })));
  }
  return h('section', { class: 'hero good' },
    h('div', { class: 'hero-label' }, `Hallo ${personById(mine)?.name || ''}`),
    h('div', { class: 'hero-amount' }, 'Alles bezahlt'),
    h('div', { class: 'hero-sub' }, weekLine));
}

function tiles(ctx, mine) {
  const pt = perTrip(mine);
  const tile = (ic, color, label, value, sub, onclick) => h('button', { type: 'button', class: 'tile', onclick },
    h('span', { class: 'tile-top' }, h('span', { class: `sq sq-${color} sq-sm` }, icon(ic, { size: 14 })), label),
    h('span', { class: 'tile-value' }, value), sub ? h('span', { class: 'tile-sub' }, sub) : null);
  const out = [
    tile('route', 'indigo', 'Pro Fahrt', pt?.mine ? `ca. ${fmtEuro(pt.mine)}` : pt ? fmtEuro(pt.total) : '–', pt?.mine ? `dein Anteil · Auto gesamt ${fmtEuro(pt.total)}` : pt ? 'Auto gesamt' : 'noch keine Fahrt geplant', () => ctx.go('costs')),
  ];
  if (isAdmin()) {
    const open = openPairs().reduce((a, p) => a + p.total, 0);
    out.push(tile('fuel', 'orange', FUELS[state.car.fuel]?.label || 'Sprit', `${effectivePrice().toFixed(3).replace('.', ',')} €`, state.price.mode !== 'manual' && state.price.current ? 'live' : 'eingetragen', () => ctx.go('route')));
    out.push(tile('hand-coins', 'green', 'Offen insgesamt', fmtEuro(open), 'bei allen Mitfahrern', () => ctx.go('costs')));
  }
  return h('div', { class: 'tiles' }, out);
}

function nextCard(ctx, mine) {
  const list = nextDays(mine, 5);
  const t0 = new Date().toISOString().slice(0, 10);
  const dirText = (dirs) => (dirs.length === 2 ? 'Hin & Zurück' : dirs[0] === 'hin' ? 'nur Hin' : 'nur Zurück');
  return h('div', { class: 'section' },
    h('div', { class: 'section-title' }, mine ? 'Deine nächsten Fahrten' : 'Nächste Fahrten'),
    list.length
      ? h('div', { class: 'list' }, list.map((x) => {
        const others = x.people.filter((id) => id !== mine && id !== x.driver).map((id) => personById(id)?.name).filter(Boolean);
        return h('button', { type: 'button', class: 'list-row', onclick: () => openDay(x.date) },
          h('span', { class: 'day-badge' }, h('small', {}, fmtDate(x.date, { weekday: true }).split(',')[0]), x.date.slice(8, 10)),
          h('span', { class: 'grow' },
            h('span', { class: 'title' }, x.date === t0 ? `Heute · ${dirText(x.dirs)}` : dirText(x.dirs)),
            h('span', { class: 'sub' }, [x.driver === mine ? 'Du fährst' : `Fahrer: ${personById(x.driver)?.name}`, others.length ? `mit ${others.join(', ')}` : null].filter(Boolean).join(' · '))),
          x.share ? h('span', { class: 'value' }, `ca. ${fmtEuro(x.share)}`) : null,
          h('span', { class: 'chev' }, icon('chevron-right', { size: 18 })));
      }))
      : h('div', { class: 'list' }, h('div', { class: 'list-row muted' }, 'Keine Fahrten geplant.')),
    h('button', { type: 'button', class: 'btn btn-small', style: { alignSelf: 'flex-start', marginLeft: '1rem' }, onclick: () => ctx.go('trips') }, icon('calendar-days', { size: 15 }), 'Tage planen'),
  );
}

export function renderHome(el, ctx) {
  // Neu hier: Willkommen
  if (!state.ui.welcomeDone && !inGroup() && !hasPendingJoin()) { el.append(welcome(ctx)); return; }

  const admin = isAdmin();
  if (admin && !state.setupDone) el.append(adminSetup(ctx));
  if (inGroup() && !admin) {
    const prof = myProfile();
    const person = personById(me());
    if (!prof.onboarded && !(person && (person.address?.lat || prof.noAddress) && hasPlan(person))) { el.append(memberSetup()); return; }
  }
  const mine = me();
  if (!mine) {
    el.append(h('section', { class: 'card' }, h('h2', {}, 'Wer bist du?'),
      h('div', { class: 'claim-grid' }, activePersons().map((p) => h('button', { type: 'button', class: 'claim-btn', onclick: () => safe(() => claimPerson(p.id)) }, h('span', { class: 'dot', style: { '--pc': p.color } }), p.name)))));
    return;
  }
  if (admin && !state.setupDone && !(state.destination && personById(state.defaultDriver)?.address)) return;
  el.append(costHero(ctx, mine), tiles(ctx, mine), nextCard(ctx, mine));
  if (admin && !inGroup()) {
    el.append(h('button', { type: 'button', class: 'list list-row has-sq', onclick: () => ctx.openAccount(isLoggedIn() ? undefined : 'register') },
      h('span', { class: 'sq sq-blue' }, icon('users', { size: 16 })),
      h('span', { class: 'grow' }, h('span', { class: 'title' }, 'Mitfahrer einladen'), h('span', { class: 'sub' }, 'Konto anlegen, Fahrgemeinschaft erstellen, Link verschicken')),
      h('span', { class: 'chev' }, icon('chevron-right', { size: 18 }))));
  } else if (admin && inviteLink()) {
    el.append(h('button', {
      type: 'button', class: 'list list-row has-sq',
      onclick: async () => { try { await navigator.clipboard.writeText(inviteLink()); toast('Einladungslink kopiert', 'ok'); } catch { prompt('Link kopieren:', inviteLink()); } },
    },
      h('span', { class: 'sq sq-green' }, icon('link', { size: 16 })),
      h('span', { class: 'grow' }, h('span', { class: 'title' }, 'Einladungslink kopieren'), h('span', { class: 'sub' }, 'An neue Mitfahrer schicken')),
      h('span', { class: 'chev' }, icon('copy', { size: 16 }))));
  }
}
