// Bildschirm „Geld“: Wie viel ist offen, und an wen? Ein Betrag pro Person – alles Weitere im Fenster der Person.
import { state, update, personById, todayIso } from '../state.js';
import { aggregate, addDays, mondayOf, isoWeek } from '../calc.js';
import { isAdmin, inGroup, claims } from '../account.js';
import { me, markPaid, confirmPayment } from '../actions.js';
import { debtItems, entries, toConfirm, myRejected, myWeek, forecast, payStates } from '../derived.js';
import { openByPair } from '../debts.js';
import { paymentMessage, paypalLink, paypalUser } from '../pay.js';
import { h, icon, header, section, list, row, seg, btn, note, banner, avatar, noApp, isPlaceholder, registerSheet, openSheet, closeSheet, sheet, attempt, toast, copyText } from '../kit.js';
import { nameOf, span } from '../plan.js';
import { fmtEuro, fmtKm, fmtDate } from '../ui.js';
import { calcSheetRow } from './tripcalc.js';

const VIA = { cash: 'Bar', paypal: 'PayPal', bank: 'Überweisung' };
const kw = (monday) => `KW ${isoWeek(monday).week}`;
const pairs = () => openByPair(debtItems());
const pairOf = (from, to) => pairs().find((p) => p.from === from && p.to === to);

// ---------- Oben: der eine Betrag ----------

function balance(mine) {
  const all = pairs();
  const owe = all.filter((p) => p.from === mine).reduce((a, p) => a + p.total, 0);
  const get = all.filter((p) => p.to === mine).reduce((a, p) => a + p.total, 0);
  if (owe < 0.005 && get < 0.005) {
    return h('div', { class: 'card balance zero' }, h('div', { class: 'hero-label' }, 'Offen'), h('div', { class: 'hero-big' }, 'Alles bezahlt'));
  }
  const main = get >= owe ? { label: 'Du bekommst', v: get, cls: 'get' } : { label: 'Du zahlst', v: owe, cls: 'owe' };
  const other = get >= owe ? (owe > 0.004 ? `Du zahlst selbst ${fmtEuro(owe)}` : null) : (get > 0.004 ? `Du bekommst ${fmtEuro(get)}` : null);
  return h('div', { class: `card balance ${main.cls}` },
    h('div', { class: 'hero-label' }, main.label),
    h('div', { class: 'hero-big' }, fmtEuro(main.v)),
    other ? h('div', { class: 'hero-sub' }, other) : null);
}

// ---------- Zu bestätigen ----------

function confirmations(mine) {
  const accounts = claims();
  const list = toConfirm(mine, { admin: isAdmin(), hasAccount: (pid) => !inGroup() || accounts.has(pid) });
  const out = list.map((g) => {
    const via = g.items[0]?.pending?.via;
    return banner({
      tone: 'good', ic: 'hand-coins',
      title: `${nameOf(g.from)} hat ${g.to === mine ? 'dir' : nameOf(g.to)} ${fmtEuro(g.total)} bezahlt`,
      text: `${via ? `${VIA[via] || via} · ` : ''}${g.items.map((d) => kw(d.week)).join(', ')} · Angekommen?`,
      buttons: [
        btn('Ja', { kind: 'primary', small: true, onClick: () => attempt(() => { confirmPayment(g.items, true); toast('Bestätigt', 'ok'); }) }),
        btn('Nein', { kind: 'plain', small: true, onClick: () => { if (confirm(`Zahlung von ${nameOf(g.from)} nicht erhalten? Der Betrag ist dann wieder offen.`)) attempt(() => confirmPayment(g.items, false)); } }),
      ],
    });
  });
  const rejected = mine ? myRejected(mine) : [];
  if (rejected.length) {
    out.push(banner({ tone: 'bad', ic: 'circle-alert', title: `${[...new Set(rejected.map((d) => nameOf(d.to)))].join(', ')} hat deine Zahlung nicht erhalten`, text: `${fmtEuro(rejected.reduce((a, d) => a + d.open, 0))} sind wieder offen.` }));
  }
  return out;
}

// ---------- Eine Zeile pro Person ----------

function pairRow(p, mine) {
  const iPay = p.from === mine;
  const other = iPay ? p.to : p.from;
  const status = p.pendingTotal > 0 ? (iPay ? 'gemeldet – wartet auf Bestätigung' : 'als bezahlt gemeldet') : `${p.items.length} ${p.items.length === 1 ? 'Woche' : 'Wochen'}`;
  return row({
    lead: avatar(other, 'm'),
    title: h('span', {}, p.from !== mine && p.to !== mine ? `${nameOf(p.from)} → ${nameOf(p.to)}` : nameOf(other), ' ', noApp(other)),
    sub: status, value: h('strong', { class: iPay ? 'neg' : 'pos' }, fmtEuro(p.total)),
    onClick: () => openSheet('pair', { from: p.from, to: p.to }),
  });
}

function openLists(mine) {
  const all = pairs();
  const mineList = all.filter((p) => p.from === mine || p.to === mine);
  const others = isAdmin() ? all.filter((p) => p.from !== mine && p.to !== mine) : [];
  return [
    mineList.length ? section('Offen', list(...mineList.map((p) => pairRow(p, mine)))) : null,
    others.length ? section('Zwischen den anderen', list(...others.map((p) => pairRow(p, mine)))) : null,
  ];
}

// ---------- Ausblick ----------

function outlook(mine) {
  const week = myWeek(mine, mondayOf(todayIso()));
  const next = forecast(2)[1];
  const nextMine = next?.persons[mine]?.share || 0;
  const nextGet = next?.drivers[mine]?.income || 0;
  const cells = [
    ['Diese Woche', week.trips ? fmtEuro(week.done + week.planned) : '–', week.planned && week.done ? `${fmtEuro(week.done)} schon gefahren` : null],
    nextGet > 0.004 ? ['Nächste Woche bekommst du', `ca. ${fmtEuro(nextGet)}`, null] : ['Nächste Woche', nextMine ? `ca. ${fmtEuro(nextMine)}` : '–', null],
  ];
  return section('Deine Kosten', h('div', { class: 'card tiles' }, cells.map(([l, v, s]) => h('div', { class: 'tile' }, h('span', {}, l), h('strong', {}, v), s ? h('small', {}, s) : null))));
}

export function renderMoney(el) {
  const mine = me();
  el.append(
    header({ title: 'Geld' }),
    balance(mine),
    ...confirmations(mine),
    ...openLists(mine).filter(Boolean),
    outlook(mine),
    list(
      calcSheetRow(),
      row({ title: 'Verlauf', sub: 'Bezahlte Wochen', onClick: () => openSheet('history') }),
    ),
  );
}

// ---------- Fenster: offene Wochen zwischen zwei Personen ----------

const pairUi = { key: '', via: 'cash', open: new Set() };

function weekTrips(pid, monday) {
  const list = entries(monday, addDays(monday, 6)).filter((e) => e.trip.legs.some((l) => l.includes(pid)) || e.trip.driver === pid);
  if (!list.length) return null;
  const agg = aggregate(list, state.split);
  return h('ul', { class: 'trips' }, agg.trips.map((t) => h('li', {},
    h('span', {}, `${fmtDate(t.date, { weekday: true })} ${t.direction === 'hin' ? 'hin' : 'zurück'}`),
    h('span', { class: 'muted' }, fmtKm(t.result.kmPerPerson[pid] || 0)),
    h('strong', {}, fmtEuro(t.result.shares[pid] || 0)))));
}

registerSheet('pair', ({ from, to }) => {
  const p = pairOf(from, to);
  if (!p) return null;
  const mine = me();
  if (pairUi.key !== `${from}|${to}`) Object.assign(pairUi, { key: `${from}|${to}`, via: 'cash', open: new Set() });
  const iPay = from === mine;
  const iGet = to === mine;
  const due = p.items.filter((d) => !d.pending);
  const dueTotal = Math.round(due.reduce((a, d) => a + d.open, 0) * 100) / 100;
  const pp = paypalUser(personById(to)?.paypal);
  const canMark = isAdmin() || iPay || iGet;
  const redraw = () => update(() => {});
  const text = paymentMessage({
    fromName: nameOf(from), toName: nameOf(to), paypal: pp,
    items: due.map((d) => ({ label: `${kw(d.week)} (${span(d.week, addDays(d.week, 6))})`, amount: d.open, details: `${d.trips} Fahrten` })),
  });
  const title = iPay ? `An ${nameOf(to)}` : iGet ? `Von ${nameOf(from)}` : `${nameOf(from)} → ${nameOf(to)}`;
  return sheet({
    title, sub: p.pendingTotal > 0 ? `${fmtEuro(p.pendingTotal)} gemeldet – wartet auf ${nameOf(to)}` : null,
    body: [
      h('div', { class: 'big-amount' }, fmtEuro(p.total)),
      dueTotal > 0 && canMark ? h('div', { class: 'stack' },
        iPay && pp ? btn(`${fmtEuro(dueTotal)} mit PayPal senden`, { kind: 'primary', full: true, ic: 'wallet', href: paypalLink(pp, dueTotal) }) : null,
        seg(Object.entries(VIA), pairUi.via, (v) => { pairUi.via = v; redraw(); }),
        btn(iPay ? 'Ich habe bezahlt' : 'Als bezahlt abhaken', {
          kind: iPay && pp ? 'tinted' : 'primary', full: true, ic: 'check',
          onClick: () => attempt(() => {
            const waits = markPaid(due, true, pairUi.via);
            toast(waits ? `Gemeldet – ${nameOf(to)} bestätigt noch` : 'Abgehakt', 'ok');
            closeSheet();
          }),
        }),
        iPay && !pp ? note(`${nameOf(to)} hat kein PayPal hinterlegt – bar oder per Überweisung zahlen.`) : null,
        !iPay ? note(isPlaceholder(from) ? `${nameOf(from)} hat die App nicht – du hakst selbst ab.` : `${nameOf(from)} meldet die Zahlung normalerweise selbst. Abhaken z. B. bei Barzahlung.`) : null) : null,
      iPay && p.pendingTotal > 0 ? btn('Meldung zurücknehmen', { kind: 'plain', full: true, onClick: () => attempt(() => markPaid(p.items.filter((d) => d.pending), false)) }) : null,
      !iPay && dueTotal > 0 ? h('div', { class: 'stack' },
        btn('Per WhatsApp erinnern', { kind: 'tinted', full: true, ic: 'message-circle', href: `https://wa.me/?text=${encodeURIComponent(text)}` }),
        btn('Text kopieren', { kind: 'plain', full: true, ic: 'copy', onClick: () => copyText(text, 'Text kopiert') })) : null,
      section('Wochen', list(...p.items.map((d) => {
        const open = pairUi.open.has(d.key);
        return h('div', {},
          row({
            title: `${kw(d.week)} · ${span(d.week, addDays(d.week, 6))}`, sub: d.pending ? 'gemeldet' : `${d.trips} Fahrten · ${fmtKm(d.km)}${d.paid > 0 ? ` · ${fmtEuro(d.paid)} schon bezahlt` : ''}`,
            value: fmtEuro(d.open), chevron: false,
            onClick: () => { open ? pairUi.open.delete(d.key) : pairUi.open.add(d.key); redraw(); },
          }),
          open ? weekTrips(from, d.week) : null);
      })), { foot: 'Antippen zeigt die Fahrten. Jede Strecke wird unter denen geteilt, die dort im Auto sitzen.' }),
    ],
  });
});

// ---------- Fenster: Verlauf ----------

registerSheet('history', () => {
  const mine = me();
  const admin = isAdmin();
  const st = payStates();
  const paid = debtItems().filter((d) => d.open <= 0 && d.paid > 0 && (admin || d.from === mine || d.to === mine)).sort((a, b) => b.week.localeCompare(a.week));
  return sheet({
    title: 'Verlauf', sub: 'Bezahlte Wochen',
    body: paid.length ? list(...paid.slice(0, 60).map((d) => row({
      title: `${d.from === mine ? 'Du' : nameOf(d.from)} → ${d.to === mine ? 'dich' : nameOf(d.to)}`,
      sub: `${kw(d.week)}${st[d.key]?.via ? ` · ${VIA[st[d.key].via] || st[d.key].via}` : ''}${d.paidAt ? ` · ${new Date(d.paidAt).toLocaleDateString('de-DE')}` : ''}`,
      value: fmtEuro(d.paid),
      trail: admin || d.to === mine ? h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Zurücknehmen', title: 'Zurücknehmen', onclick: () => { if (confirm('Diese Zahlung zurücknehmen? Der Betrag ist dann wieder offen.')) attempt(() => markPaid([d], false)); } }, icon('undo-2', { size: 16 })) : null,
    }))) : note('Noch nichts bezahlt.'),
  });
});

