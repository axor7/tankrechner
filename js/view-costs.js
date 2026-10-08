// Ansicht „Geld“: Wer schuldet wem? Ein Betrag pro Person – bezahlen, bestätigen, abhaken, erinnern. Alle Zahlen auf Wunsch.
import { state, update, personById, todayIso, liveSnap } from './state.js';
import { aggregate, settle, addDays, isoWeek, mondayOf, toISODate, FUELS } from './calc.js';
import { isAdmin, claims, inGroup } from './account.js';
import { me, markPaid, confirmPayment, adminSet } from './actions.js';
import { debtItems, entries, weekLabel, forecast, toConfirm, myRejected, payStates } from './derived.js';
import { openByPair } from './debts.js';
import { paymentMessage, paypalLink, paypalUser } from './pay.js';
import { register, openSheet, closeSheet, sheetHead } from './sheets.js';
import { avatar, appTag, isPlaceholder } from './people.js';
import { h, stat, fmtEuro, fmtKm, fmtL, fmtDate, fmtPrice, toast } from './ui.js';
import { icon } from './icons.js';

const nameOf = (id) => personById(id)?.name || 'Unbekannt';
const safe = (fn) => { try { fn(); } catch (e) { toast(e.message, 'error'); } };
const copy = async (text, msg) => { try { await navigator.clipboard.writeText(text); toast(msg, 'ok'); } catch { prompt('Kopieren:', text); } };

// ---------- Wie berechnet? (für eine Woche und eine Person) ----------

function weekBreakdown(pid, monday) {
  const list = entries(monday, addDays(monday, 6)).filter((e) => e.trip.legs.some((l) => l.includes(pid)) || e.trip.driver === pid);
  if (!list.length) return h('p', { class: 'hint small' }, 'Keine Fahrten.');
  const agg = aggregate(list, state.split);
  return h('div', { class: 'breakdown' },
    agg.trips.map((t) => h('div', { class: 'bd-row' },
      h('span', {}, `${fmtDate(t.date, { weekday: true })} ${t.direction === 'hin' ? 'Hin' : 'Zurück'}`),
      h('span', { class: 'muted' }, `${String(Math.round((t.result.kmPerPerson[pid] || 0) * 10) / 10).replace('.', ',')} km von ${String(Math.round(t.result.km * 10) / 10).replace('.', ',')} km`),
      h('strong', {}, fmtEuro(t.result.shares[pid] || 0)))),
    h('p', { class: 'hint small' }, `Gerechnet mit ${fmtPrice(list[0].snap.price)}/l und ${String(list[0].snap.consumption).replace('.', ',')} l/100 km. Jede Teilstrecke wird unter denen geteilt, die dort im Auto sitzen – du zahlst ab deiner Adresse.`),
  );
}

// ---------- Zahlungen bestätigen (Kopf oben) ----------

const kwList = (items) => items.map((d) => `KW ${isoWeek(d.week).week}`).join(', ');
const dayOf = (at) => (at ? new Date(at).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' }) : '');

/** Gemeldete Zahlungen, die ich bestätigen soll + Hinweis, wenn meine Meldung abgelehnt wurde. */
export function confirmCard() {
  const mine = me();
  const admin = isAdmin();
  const accounts = claims();
  const list = toConfirm(mine, { admin, hasAccount: (pid) => !inGroup() || accounts.has(pid) });
  const rejected = mine ? myRejected(mine) : [];
  if (!list.length && !rejected.length) return null;
  return h('section', { class: 'confirm-card' },
    list.map((g) => h('div', { class: 'confirm-item' },
      h('span', { class: 'sq sq-green' }, icon('hand-coins', { size: 17 })),
      h('div', { class: 'grow' },
        h('div', { class: 'confirm-text' }, h('strong', {}, nameOf(g.from)), ` hat ${g.to === mine ? 'dir' : nameOf(g.to)} `, h('strong', {}, fmtEuro(g.total)), ' bezahlt'),
        h('div', { class: 'muted small' }, `für ${kwList(g.items)}${g.at ? ` · gemeldet am ${dayOf(g.at)}` : ''}`),
        h('div', { class: 'confirm-q' }, g.to === mine ? 'Ist das Geld bei dir angekommen?' : `Ist das Geld bei ${nameOf(g.to)} angekommen?`),
        h('div', { class: 'row gap' },
          h('button', { type: 'button', class: 'btn btn-small btn-paid', onclick: () => safe(() => { confirmPayment(g.items, true); toast('Zahlung bestätigt', 'ok'); }) }, icon('check', { size: 15 }), 'Ja, erhalten'),
          h('button', {
            type: 'button', class: 'btn btn-small btn-no',
            onclick: () => { if (confirm(`Zahlung von ${nameOf(g.from)} über ${fmtEuro(g.total)} nicht erhalten?\n\n${nameOf(g.from)} sieht dann, dass das Geld nicht angekommen ist, und der Betrag ist wieder offen.`)) safe(() => { confirmPayment(g.items, false); toast('Als „nicht erhalten“ markiert'); }); },
          }, icon('x', { size: 15 }), 'Nein')),
      ))),
    rejected.length ? h('div', { class: 'confirm-item warn' },
      h('span', { class: 'sq sq-orange' }, icon('circle-alert', { size: 17 })),
      h('div', { class: 'grow' },
        h('div', { class: 'confirm-text' }, h('strong', {}, [...new Set(rejected.map((d) => nameOf(d.to)))].join(', ')), ' hat deine Zahlung über ', h('strong', {}, fmtEuro(rejected.reduce((a, d) => a + d.open, 0))), ' nicht bestätigt'),
        h('div', { class: 'muted small' }, `${kwList(rejected)} – bitte prüfe, ob das Geld angekommen ist, und melde es dann erneut. Der Betrag ist wieder offen.`))) : null,
  );
}

// ---------- Offene Beträge: ein Betrag pro Person ----------

const openDetails = new Set(); // aufgeklappte „Wie berechnet?“
const VIA = { cash: 'bar', paypal: 'PayPal', bank: 'Überweisung' };
const share = async (text, title) => {
  if (navigator.share) { try { await navigator.share({ text, title }); return; } catch (e) { if (e?.name === 'AbortError') return; } }
  copy(text, 'Text kopiert – jetzt z. B. in WhatsApp einfügen');
};
const msgItems = (pair) => pair.items.map((d) => ({ label: weekLabel(d.week), amount: d.open, details: d.paid > 0 ? `Rest, ${fmtEuro(d.paid)} schon bezahlt` : `${d.trips} Fahrten, ${fmtKm(d.km)}` }));

function weeksList(pair, pid) {
  return h('ul', { class: 'debt-weeks' }, pair.items.map((d) => h('li', { class: d.pending ? 'is-pending' : '' },
    h('div', { class: 'row between w-line' },
      h('span', { class: 'w-label' }, weekLabel(d.week), h('small', {}, d.paid > 0 ? `${fmtEuro(d.paid)} schon bezahlt – Woche hat sich danach geändert` : `${d.trips} Fahrten · ${fmtKm(d.km)}`),
        d.pending ? h('span', { class: 'pay-badge pending' }, icon('clock', { size: 12 }), `Gemeldet am ${dayOf(d.pending.at)} – wartet auf Bestätigung`) : null,
        d.rejected ? h('span', { class: 'pay-badge rejected' }, icon('circle-alert', { size: 12 }), '„Nicht erhalten“ gemeldet') : null),
      h('strong', {}, fmtEuro(d.open))),
    h('button', { type: 'button', class: 'link small', onclick: () => { openDetails.has(d.key) ? openDetails.delete(d.key) : openDetails.add(d.key); update(() => {}); } },
      openDetails.has(d.key) ? 'Berechnung ausblenden' : 'Wie berechnet?'),
    openDetails.has(d.key) ? weekBreakdown(pid, d.week) : null)));
}

/** Ich schulde: bezahlen (PayPal) und melden. */
function oweRow(pair) {
  const to = personById(pair.to);
  const pp = paypalUser(to?.paypal);
  const due = pair.items.filter((d) => !d.pending);
  const dueTotal = Math.round(due.reduce((a, d) => a + d.open, 0) * 100) / 100;
  const open = openDetails.has(`pair:${pair.from}|${pair.to}`);
  return h('div', { class: 'money-row' },
    h('div', { class: 'money-head' },
      avatar(pair.to, { size: 'md' }),
      h('div', { class: 'grow' }, h('div', { class: 'title' }, 'An ', h('strong', {}, nameOf(pair.to))),
        h('div', { class: 'muted small' }, pair.pendingTotal > 0 ? `${fmtEuro(pair.pendingTotal)} gemeldet – wartet auf ${to?.name}` : `${pair.items.length} ${pair.items.length === 1 ? 'Woche' : 'Wochen'}`)),
      h('strong', { class: 'amount' }, fmtEuro(pair.total))),
    h('div', { class: 'pay-actions' },
      pp && dueTotal > 0 ? h('a', { class: 'btn btn-small btn-pp', href: paypalLink(pp, dueTotal), target: '_blank', rel: 'noopener' }, icon('wallet', { size: 15 }), `${fmtEuro(dueTotal)} mit PayPal`) : null,
      due.length ? h('button', { type: 'button', class: 'btn btn-small btn-paid', onclick: () => openSheet('pay', { from: pair.from, to: pair.to, role: 'payer' }) }, icon('check', { size: 15 }), 'Ich habe bezahlt') : null,
      pair.pendingTotal > 0 ? h('button', { type: 'button', class: 'btn btn-small', onclick: () => safe(() => { markPaid(pair.items.filter((d) => d.pending), false); toast('Meldung zurückgenommen'); }) }, icon('rotate-ccw', { size: 15 }), 'Zurücknehmen') : null,
      h('button', { type: 'button', class: 'link small', onclick: () => { open ? openDetails.delete(`pair:${pair.from}|${pair.to}`) : openDetails.add(`pair:${pair.from}|${pair.to}`); update(() => {}); } }, open ? 'Weniger' : 'Wochen')),
    !pp && dueTotal > 0 ? h('p', { class: 'hint small' }, `${to?.name} hat kein PayPal hinterlegt – bar oder per Überweisung zahlen und dann „Ich habe bezahlt“.`) : null,
    open ? weeksList(pair, pair.from) : null);
}

/** Jemand schuldet mir (oder – als Admin – jemand anderem): abhaken, erinnern. */
function getRow(pair, mine) {
  const toMe = pair.to === mine;
  const open = openDetails.has(`pair:${pair.from}|${pair.to}`);
  const due = pair.items.filter((d) => !d.pending);
  return h('div', { class: 'money-row' },
    h('div', { class: 'money-head' },
      avatar(pair.from, { size: 'md' }),
      h('div', { class: 'grow' },
        h('div', { class: 'title' }, h('strong', {}, nameOf(pair.from)), toMe ? '' : h('span', { class: 'muted' }, ` → ${nameOf(pair.to)}`), ' ', appTag(pair.from)),
        h('div', { class: 'muted small' }, pair.pendingTotal > 0 ? `${fmtEuro(pair.pendingTotal)} als bezahlt gemeldet` : `${pair.items.length} ${pair.items.length === 1 ? 'Woche' : 'Wochen'} offen`)),
      h('strong', { class: 'amount' }, fmtEuro(pair.total))),
    h('div', { class: 'pay-actions' },
      due.length ? h('button', { type: 'button', class: 'btn btn-small btn-paid', onclick: () => openSheet('pay', { from: pair.from, to: pair.to, role: 'receiver' }) }, icon('check', { size: 15 }), 'Abhaken') : null,
      due.length ? h('button', { type: 'button', class: 'btn btn-small', onclick: () => openSheet('remind', { from: pair.from, to: pair.to }) }, icon('message-circle', { size: 15 }), 'Erinnern') : null,
      h('button', { type: 'button', class: 'link small', onclick: () => { open ? openDetails.delete(`pair:${pair.from}|${pair.to}`) : openDetails.add(`pair:${pair.from}|${pair.to}`); update(() => {}); } }, open ? 'Weniger' : 'Wochen')),
    open ? weeksList(pair, pair.from) : null);
}

const pairOf = (from, to) => openByPair(debtItems()).find((p) => p.from === from && p.to === to);

// Abhaken bzw. „Ich habe bezahlt“: mit Zahlungsart
const payDraft = { via: 'cash' };
register('pay', ({ from, to, role }) => {
  const pair = pairOf(from, to);
  if (!pair) return null;
  const items = pair.items.filter((d) => !d.pending);
  const total = Math.round(items.reduce((a, d) => a + d.open, 0) * 100) / 100;
  const payer = role === 'payer';
  return [
    sheetHead(payer ? `${fmtEuro(total)} an ${nameOf(to)}` : `${fmtEuro(total)} von ${nameOf(from)}`, kwList(items)),
    h('div', { class: 'list' }, Object.entries(VIA).map(([k, label]) => h('button', {
      type: 'button', class: `list-row radio-row ${payDraft.via === k ? 'on' : ''}`, onclick: () => { payDraft.via = k; update(() => {}); },
    }, h('span', { class: 'radio' }), h('span', { class: 'grow' }, label)))),
    h('button', {
      type: 'button', class: 'btn btn-primary full',
      onclick: () => safe(() => {
        const waits = markPaid(items, true, payDraft.via);
        toast(waits ? `Gemeldet – ${nameOf(to)} bestätigt noch den Eingang` : `${fmtEuro(total)} abgehakt`, 'ok');
        closeSheet();
      }),
    }, icon('check', { size: 17 }), payer ? 'Ich habe bezahlt' : 'Als bezahlt abhaken'),
    h('p', { class: 'hint small' }, payer
      ? `${nameOf(to)} bekommt eine Nachfrage „Angekommen?“ und bestätigt mit einem Tipp.`
      : isPlaceholder(from) ? `${nameOf(from)} hat die App nicht – deshalb hakst du selbst ab.` : `Zum Beispiel, wenn ${nameOf(from)} bar bezahlt hat.`),
  ];
});

// Erinnern: fertiger Text mit Betrag und PayPal-Link zum Teilen (WhatsApp …)
register('remind', ({ from, to }) => {
  const pair = pairOf(from, to);
  if (!pair) return null;
  const items = pair.items.filter((d) => !d.pending);
  const pp = paypalUser(personById(to)?.paypal);
  const text = paymentMessage({ fromName: nameOf(from), toName: nameOf(to), items: msgItems({ ...pair, items }), paypal: pp });
  return [
    sheetHead(`${nameOf(from)} erinnern`, isPlaceholder(from) ? `${nameOf(from)} hat die App nicht – du schickst den Text selbst` : 'Fertiger Text mit Betrag und Link'),
    h('pre', { class: 'bubble' }, text),
    h('div', { class: 'row gap wrap' },
      h('a', { class: 'btn btn-primary', href: `https://wa.me/?text=${encodeURIComponent(text)}`, target: '_blank', rel: 'noopener' }, icon('message-circle', { size: 16 }), 'WhatsApp'),
      h('button', { type: 'button', class: 'btn', onclick: () => share(text, 'Tankkosten') }, icon('share', { size: 16 }), 'Teilen'),
      h('button', { type: 'button', class: 'btn', onclick: () => copy(text, 'Text kopiert') }, icon('copy', { size: 16 }), 'Kopieren')),
    !pp && to === me() ? h('button', { type: 'button', class: 'link small', onclick: () => { closeSheet(); update((s) => { s.ui.tab = 'settings'; }); } }, 'PayPal hinterlegen, damit der Text einen Bezahl-Link enthält') : null,
  ];
});

function balanceHead(mine) {
  const pairs = openByPair(debtItems());
  const owe = pairs.filter((p) => p.from === mine).reduce((a, p) => a + p.total, 0);
  const get = pairs.filter((p) => p.to === mine).reduce((a, p) => a + p.total, 0);
  if (owe < 0.005 && get < 0.005) return h('section', { class: 'card money-ok' }, h('span', { class: 'sq sq-green' }, icon('check', { size: 16 })), h('div', { class: 'grow' }, h('strong', {}, 'Alles bezahlt'), h('div', { class: 'muted small' }, 'Nichts offen.')));
  return h('div', { class: 'balance' },
    get > 0.004 ? h('div', { class: 'bal get' }, h('span', {}, 'Du bekommst'), h('strong', {}, fmtEuro(get))) : null,
    owe > 0.004 ? h('div', { class: 'bal owe' }, h('span', {}, 'Du zahlst'), h('strong', {}, fmtEuro(owe))) : null);
}

function openCard(mine) {
  const items = debtItems();
  const pairs = openByPair(items);
  const admin = isAdmin();
  const owe = pairs.filter((p) => p.from === mine);
  const get = pairs.filter((p) => p.to === mine);
  const others = admin ? pairs.filter((p) => p.from !== mine && p.to !== mine) : [];
  const paid = items.filter((d) => d.open <= 0 && d.paid > 0 && (admin || d.from === mine || d.to === mine)).sort((a, b) => b.week.localeCompare(a.week));
  const st = payStates();
  return [
    balanceHead(mine),
    owe.length ? h('div', { class: 'section' }, h('div', { class: 'section-title' }, 'Du zahlst'), h('div', { class: 'list money-list' }, owe.map(oweRow))) : null,
    get.length ? h('div', { class: 'section' }, h('div', { class: 'section-title' }, 'Du bekommst'), h('div', { class: 'list money-list' }, get.map((p) => getRow(p, mine)))) : null,
    others.length ? h('div', { class: 'section' }, h('div', { class: 'section-title' }, 'Zwischen den anderen'), h('div', { class: 'list money-list' }, others.map((p) => getRow(p, mine)))) : null,
    paid.length ? h('details', { class: 'more' },
      h('summary', {}, `Verlauf (${paid.length})`),
      h('ul', { class: 'paid-list' }, paid.slice(0, 40).map((d) => h('li', {},
        h('span', {}, `${d.from === mine ? 'Du' : nameOf(d.from)} → ${d.to === mine ? 'dich' : nameOf(d.to)} · ${weekLabel(d.week)}`),
        h('span', { class: 'muted' }, `${fmtEuro(d.paid)}${st[d.key]?.via ? ` · ${VIA[st[d.key].via] || st[d.key].via}` : ''}${d.paidAt ? ` · ${new Date(d.paidAt).toLocaleDateString('de-DE')}` : ''}`),
        (admin || d.to === mine) ? h('button', { type: 'button', class: 'link', onclick: () => safe(() => markPaid([d], false)) }, 'zurücknehmen') : null)))) : null,
    h('p', { class: 'hint small' }, 'Abgerechnet wird wochenweise. Geplante Fahrten werden erst ab dem Tag der Fahrt fällig.'),
  ];
}

// ---------- Details (Einstellung „Detailliert“) ----------

function periodRange() {
  const ui = state.ui;
  if (ui.period === 'week' || !ui.period) return { from: ui.week, to: addDays(ui.week, 6), label: weekLabel(ui.week) };
  if (ui.period === 'month') {
    const [y, m] = ui.week.split('-').map(Number);
    return { from: `${y}-${String(m).padStart(2, '0')}-01`, to: toISODate(new Date(y, m, 0)), label: new Date(y, m - 1, 1).toLocaleDateString('de-DE', { month: 'long', year: 'numeric' }) };
  }
  return { from: '0000-01-01', to: '9999-12-31', label: 'Alle Fahrten' };
}

function periodCard(range) {
  const ui = state.ui;
  const step = ui.period === 'month' ? 'm' : ui.period === 'all' ? null : 'w';
  const nav = (dir) => update((s) => {
    if (step === 'w') s.ui.week = addDays(s.ui.week, dir * 7);
    else { const [y, m] = s.ui.week.split('-').map(Number); s.ui.week = mondayOf(toISODate(new Date(y, m - 1 + dir, 15))); }
  });
  return h('section', { class: 'card' },
    h('div', { class: 'segmented' }, [['week', 'Woche'], ['month', 'Monat'], ['all', 'Alles']].map(([p, l]) => h('button', {
      type: 'button', class: (ui.period || 'week') === p ? 'active' : '', onclick: () => update((s) => { s.ui.period = p; }),
    }, l))),
    h('div', { class: 'week-nav' },
      step ? h('button', { type: 'button', class: 'icon-btn big', 'aria-label': 'Zurück', onclick: () => nav(-1) }, icon('chevron-left', { size: 22 })) : null,
      h('div', { class: 'week-title' }, h('strong', {}, range.label)),
      step ? h('button', { type: 'button', class: 'icon-btn big', 'aria-label': 'Weiter', onclick: () => nav(1) }, icon('chevron-right', { size: 22 })) : null),
  );
}

const fmtDec = (v) => String(Math.round(v * 100) / 100).replace('.', ',');
function spread(values, fmt) {
  const u = [...new Set(values)].sort((a, b) => a - b);
  if (!u.length) return '–';
  return u.length === 1 ? fmt(u[0]) : `${fmt(u[0])} – ${fmt(u[u.length - 1])}`;
}

function valuesCard(list, agg) {
  const snaps = [...new Set(list.map((e) => e.snap))];
  const extraAll = agg.extraCost + agg.extraExcluded;
  const row = (label, value, note) => h('tr', {}, h('td', {}, label), h('td', {}, h('strong', {}, value), note ? h('div', { class: 'muted small' }, note) : null));
  return h('section', { class: 'card' },
    h('h2', {}, 'Alle Werte'),
    h('table', { class: 'table values' }, h('tbody', {},
      row('Kraftstoff', [...new Set(snaps.map((s) => FUELS[s.fuel]?.label || s.fuel))].join(', ')),
      row('Verbrauch', `${spread(snaps.map((s) => s.consumption), fmtDec)} l/100 km`),
      row('Spritpreis pro Liter', spread(snaps.map((s) => s.price), fmtPrice), agg.liters > 0 && new Set(snaps.map((s) => s.price)).size > 1 ? `ø ${fmtPrice(agg.fuelCost / agg.liters)}` : null),
      row('Nebenkosten pro km', snaps.some((s) => s.extraPerKm > 0) ? `${spread(snaps.map((s) => s.extraPerKm), fmtDec)} ct/km` : 'keine'),
      row('Gefahren', fmtKm(agg.km), `${agg.trips.length} Fahrten · ø ${fmtKm(agg.trips.length ? agg.km / agg.trips.length : 0)}`),
      row('Verbrauchte Liter', fmtL(agg.liters)),
      row('Spritkosten', fmtEuro(agg.fuelCost)),
      row('Nebenkosten', fmtEuro(extraAll), extraAll > 0 && state.split.includeExtra === false ? 'ausgeschaltet – nicht in der Abrechnung' : null),
      row('Kosten pro km', agg.km ? `${fmtDec((agg.total / agg.km) * 100)} ct` : '–'),
      h('tr', { class: 'total' }, h('td', {}, 'Abgerechnet'), h('td', {}, h('strong', {}, fmtEuro(agg.total)))),
    )),
  );
}

function detailsCard(agg) {
  const byDate = new Map();
  for (const t of agg.trips) { if (!byDate.has(t.date)) byDate.set(t.date, []); byDate.get(t.date).push(t); }
  return h('section', { class: 'card' },
    h('h2', {}, 'Einzelne Fahrten'),
    [...byDate.entries()].map(([date, trips]) => h('details', { class: 'day-detail' },
      h('summary', {}, h('span', {}, fmtDate(date, { weekday: true })), h('strong', {}, fmtEuro(trips.reduce((a, t) => a + t.result.total, 0)))),
      trips.map((t) => h('div', { class: 'trip-detail' },
        h('div', { class: 'row between' },
          h('strong', {}, t.direction === 'hin' ? 'Hinfahrt' : 'Rückfahrt'),
          h('span', { class: 'muted' }, `Fahrer: ${nameOf(t.trip.driver)} · ${fmtKm(t.result.km)} · ${fmtEuro(t.result.total)}`)),
        h('ul', { class: 'leg-list' }, t.result.legs.map((l) => h('li', {},
          h('span', {}, `${l.from} → ${l.to} `, h('small', { class: 'muted' }, `${t.result.estimated ? '≈ ' : ''}${fmtKm(l.km)}`)),
          h('span', { class: 'muted' }, `${fmtEuro(l.cost)} ÷ ${l.payers.length} = ${fmtEuro(l.per)} für ${l.payers.map(nameOf).join(', ')}`)))),
      )),
    )),
  );
}

function detailed(el) {
  const range = periodRange();
  const list = entries(range.from, range.to);
  el.append(periodCard(range));
  if (!list.length) { el.append(h('section', { class: 'card' }, h('p', { class: 'hint' }, 'In diesem Zeitraum gab es (bis heute) keine Fahrten.'))); return; }
  const agg = aggregate(list, state.split);
  const people = Object.entries(agg.persons).sort((a, b) => b[1].share - a[1].share);
  const max = Math.max(...people.map(([, x]) => x.share), 0.01);
  const transfers = settle(agg.persons);
  el.append(
    h('section', { class: 'card' }, h('div', { class: 'stats' },
      stat('Gesamt', fmtEuro(agg.total), agg.extraCost > 0 ? `Sprit ${fmtEuro(agg.fuelCost)} · Nebenkosten ${fmtEuro(agg.extraCost)}` : null),
      stat('Gefahren', fmtKm(agg.km), `${agg.trips.length} Fahrten`),
      stat('Verbraucht', fmtL(agg.liters)))),
    h('section', { class: 'card' },
      h('h2', {}, 'Anteile'),
      h('div', { class: 'share-bars' }, people.map(([id, x]) => h('div', { class: 'share-row', style: { '--pc': personById(id)?.color || '#999' } },
        h('div', { class: 'share-name' }, h('span', { class: 'dot' }), nameOf(id)),
        h('div', { class: 'share-bar' }, h('div', { class: 'share-fill', style: { width: `${(x.share / max) * 100}%` } })),
        h('div', { class: 'share-amount' }, fmtEuro(x.share)),
        h('div', { class: 'share-meta muted' }, `${x.trips} Fahrten · ${fmtKm(x.km)}${x.paid ? ` · hat ${fmtEuro(x.paid)} ausgelegt` : ''}`)))),
      transfers.length ? h('ul', { class: 'transfers' }, transfers.map((t) => h('li', {},
        h('span', { class: 'who', style: { color: personById(t.from)?.color } }, nameOf(t.from)), h('span', { class: 'arrow' }, '→'),
        h('span', { class: 'who', style: { color: personById(t.to)?.color } }, nameOf(t.to)), h('strong', {}, fmtEuro(t.amount))))) : null),
    valuesCard(list, agg),
    detailsCard(agg),
  );
}

// ---------- Prognose ----------

function forecastCard(mine) {
  const admin = isAdmin();
  const list = forecast(state.ui.forecastWeeks || 5);
  const snap = liveSnap();
  const kw = (m) => `KW ${isoWeek(m).week}`;
  const range = (m) => `${fmtDate(m)} – ${fmtDate(addDays(m, 6))}`;
  const thisWeek = mondayOf(todayIso());
  const label = (w) => (w.monday === thisWeek ? 'Diese Woche' : w.monday === addDays(thisWeek, 7) ? 'Nächste Woche' : kw(w.monday));
  const rows = list.map((w) => {
    const persons = Object.entries(w.persons).sort((a, b) => b[1].share - a[1].share);
    if (admin) {
      return h('div', { class: 'list-row fc-row' },
        h('div', { class: 'row between' },
          h('span', {}, h('strong', {}, label(w)), h('span', { class: 'muted small' }, ` · ${range(w.monday)}`)),
          h('strong', {}, w.trips ? `≈ ${fmtEuro(w.total)}` : '–')),
        w.trips ? h('div', { class: 'fc-people' }, persons.map(([pid, x]) => h('span', { class: 'fc-person', style: { '--pc': personById(pid)?.color || 'var(--gray)' } },
          h('span', { class: 'dot' }), `${nameOf(pid)} ${fmtEuro(x.share)}`, h('span', { class: 'muted' }, ` · ${x.trips}×`)))) : h('span', { class: 'muted small' }, 'Keine Fahrten geplant'));
    }
    const x = w.persons[mine];
    const d = w.drivers[mine];
    return h('div', { class: 'list-row fc-row' },
      h('div', { class: 'row between' },
        h('span', {}, h('strong', {}, label(w)), h('span', { class: 'muted small' }, ` · ${range(w.monday)}`)),
        h('strong', {}, x ? `≈ ${fmtEuro(x.share)}` : '–')),
      h('span', { class: 'muted small' }, [
        x ? `${x.trips} ${x.trips === 1 ? 'Fahrt' : 'Fahrten'}${x.done ? ` · davon ${fmtEuro(x.done)} schon gefahren` : ''}` : d ? '' : 'Du fährst nicht mit',
        d ? `${x ? ' · ' : ''}Du fährst ${d.trips}× – die anderen zahlen dir ≈ ${fmtEuro(d.income)}` : '',
      ].join('')));
  });
  const sum = admin ? list.reduce((a, w) => a + w.total, 0) : list.reduce((a, w) => a + (w.persons[mine]?.share || 0), 0);
  return h('details', { class: 'card forecast', open: !!state.ui.fcOpen, ontoggle: (e) => { state.ui.fcOpen = e.target.open; } },
    h('summary', { class: 'row between' }, h('h2', {}, 'Prognose'), h('span', { class: 'muted small' }, `nächste ${list.length} Wochen ${admin ? 'gesamt ' : ''}≈ ${fmtEuro(sum)}`)),
    h('p', { class: 'hint small' }, admin
      ? 'So teuer werden die kommenden Wochen, wenn alle wie eingeplant mitfahren (Regelplan + geänderte Tage). Pro Person nur, wer in der Woche wirklich mitfährt.'
      : 'So viel kosten dich die kommenden Wochen, wenn du wie eingeplant mitfährst.'),
    mine || admin ? h('div', { class: 'list' }, rows) : h('p', { class: 'hint' }, 'Wähle zuerst auf der Übersicht, wer du bist.'),
    h('div', { class: 'row between', style: { marginTop: '.5rem' } },
      h('span', { class: 'hint small', style: { margin: 0 } }, `Mit ${fmtPrice(snap.price)}/l und ${String(snap.consumption).replace('.', ',')} l/100 km – ändert sich der Spritpreis, ändert sich auch die Prognose.`),
      h('button', { type: 'button', class: 'btn btn-small', onclick: () => update((s) => { s.ui.forecastWeeks = (s.ui.forecastWeeks || 5) >= 9 ? 5 : 9; }) },
        (state.ui.forecastWeeks || 5) >= 9 ? 'Weniger' : 'Mehr Wochen')),
  );
}

// ---------- Aufteilungsregel (für die Einstellungen) ----------

export function rulesCard() {
  const segment = state.split.mode === 'segment';
  const set = (fn, text) => safe(() => adminSet(fn, text));
  return h('section', { class: 'card' },
    h('div', { class: 'segmented' },
      h('button', { type: 'button', class: segment ? 'active' : '', onclick: () => set((s) => { s.split.mode = 'segment'; }, 'Aufteilung: nach Teilstrecken') }, 'Nach Teilstrecken (fair)'),
      h('button', { type: 'button', class: !segment ? 'active' : '', onclick: () => set((s) => { s.split.mode = 'equal'; }, 'Aufteilung: gleich pro Fahrt') }, 'Gleich pro Fahrt')),
    h('p', { class: 'hint' }, segment
      ? 'Jede Teilstrecke wird unter denen geteilt, die dort im Auto sitzen: Wer später zusteigt oder früher aussteigt, zahlt weniger.'
      : 'Die Kosten einer Fahrt werden gleichmäßig auf alle verteilt, die dabei sind – egal ab wo.'),
    h('label', { class: 'switch-row' }, h('span', {}, 'Fahrer zahlt seinen Anteil mit'),
      h('input', { type: 'checkbox', class: 'switch', checked: state.split.driverPays, onchange: (e) => set((s) => { s.split.driverPays = e.target.checked; }, `Fahrer zahlt ${e.target.checked ? 'mit' : 'nicht mit'}`) })),
    h('label', { class: 'switch-row' }, h('span', {}, 'Nebenkosten (Verschleiß) abrechnen'),
      h('input', { type: 'checkbox', class: 'switch', checked: state.split.includeExtra !== false, onchange: (e) => set((s) => { s.split.includeExtra = e.target.checked; }, `Nebenkosten ${e.target.checked ? 'an' : 'aus'}`) })),
  );
}

export function renderCosts(el) {
  const mine = me();
  const cc = confirmCard();
  if (cc) el.append(cc);
  el.append(...openCard(mine).filter(Boolean));
  el.append(forecastCard(mine));
  if (state.ui.detail === 'detailed') {
    el.append(h('button', { type: 'button', class: 'btn', style: { alignSelf: 'center' }, onclick: () => update((s) => { s.ui.detail = 'simple'; }) }, 'Alle Zahlen ausblenden'));
    detailed(el);
  } else el.append(h('button', { type: 'button', class: 'btn', style: { alignSelf: 'center' }, onclick: () => update((s) => { s.ui.detail = 'detailed'; }) }, icon('list-checks', { size: 17 }), 'Alle Zahlen anzeigen'));
}
