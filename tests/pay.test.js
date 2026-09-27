import { test } from 'node:test';
import assert from 'node:assert/strict';
import { paypalUser, paypalLink, paymentMessage } from '../js/pay.js';
import { weeklyDebts, withPayments, openByPair, markPaid, payKey } from '../js/debts.js';

test('PayPal-Namen aus verschiedenen Eingaben', () => {
  assert.equal(paypalUser('maxmuster'), 'maxmuster');
  assert.equal(paypalUser('paypal.me/maxmuster'), 'maxmuster');
  assert.equal(paypalUser('https://www.paypal.me/MaxMuster/10'), 'MaxMuster');
  assert.equal(paypalUser('https://www.paypal.com/paypalme/maxmuster'), 'maxmuster');
  assert.equal(paypalUser('@maxmuster'), 'maxmuster');
  assert.equal(paypalUser('max muster'), '');
  assert.equal(paypalUser(''), '');
});

test('PayPal-Link mit Betrag', () => {
  assert.equal(paypalLink('maxmuster', 12.345), 'https://paypal.me/maxmuster/12.35EUR');
  assert.equal(paypalLink('maxmuster', 8), 'https://paypal.me/maxmuster/8.00EUR');
  assert.equal(paypalLink('', 5), '');
});

test('Nachricht für eine Woche', () => {
  const m = paymentMessage({ fromName: 'Anna', toName: 'Max', items: [{ label: 'KW 39', amount: 24.1, details: '8 Fahrten' }], paypal: 'maxmuster' });
  assert.match(m, /Hi Anna/);
  assert.match(m, /KW 39: \*24,10\s€\* \(8 Fahrten\)/);
  assert.match(m, /Freunde & Familie/);
  assert.match(m, /https:\/\/paypal\.me\/maxmuster\/24\.10EUR/);
  const noPp = paymentMessage({ fromName: 'Anna', toName: 'Max', items: [{ label: 'KW 39', amount: 5 }] });
  assert.doesNotMatch(noPp, /paypal/);
});

test('Nachricht für mehrere Wochen: Liste, Summe, Link mit Summe', () => {
  const m = paymentMessage({ fromName: 'Ben', toName: 'Max', items: [{ label: 'KW 38', amount: 10.1 }, { label: 'KW 39', amount: 7.25 }], paypal: 'maxmuster' });
  assert.match(m, /• KW 38: 10,10\s€/);
  assert.match(m, /• KW 39: 7,25\s€/);
  assert.match(m, /Gesamt: 17,35\s€/);
  assert.match(m, /paypal\.me\/maxmuster\/17\.35EUR/);
});

// ---------- Offene Beträge ----------
const snap = { legs: [{ from: 'A', to: 'B', km: 100 }], consumption: 5, price: 2 }; // 10 € pro Fahrt
const trip = (people, driver = 'me') => ({ driver, legs: [people] });
const weeks = {
  '2026-09-14': { snap, days: { '2026-09-14': { hin: trip(['me', 'anna']), rueck: trip(['me', 'anna']) } } }, // Anna: 10 €
  '2026-09-21': { snap, days: { '2026-09-21': { hin: trip(['me', 'anna', 'ben', 'cl']) } } }, // je 2,50 €
};

test('Schulden je Woche', () => {
  const d = weeklyDebts(weeks);
  assert.deepEqual(d.map((x) => `${x.week} ${x.from}>${x.to} ${x.amount}`).sort(), [
    '2026-09-14 anna>me 10',
    '2026-09-21 anna>me 2.5',
    '2026-09-21 ben>me 2.5',
    '2026-09-21 cl>me 2.5',
  ]);
  assert.equal(d[0].trips, 2);
  // ohne Rückfahrten nur die Hinfahrt
  assert.equal(weeklyDebts(weeks, {}, false)[0].amount, 5);
});

test('Offen, bezahlt, geändert und nach Paaren gruppiert', () => {
  const debts = weeklyDebts(weeks);
  let open = openByPair(withPayments(debts, {}));
  const anna = open.find((p) => p.from === 'anna');
  assert.equal(anna.total, 12.5);
  assert.equal(anna.items.length, 2);

  // KW 38 von Anna bezahlt
  const payments = markPaid({}, [anna.items[0]], 1);
  open = openByPair(withPayments(debts, payments));
  assert.equal(open.find((p) => p.from === 'anna').total, 2.5);

  // Woche nachträglich geändert (höherer Betrag) → nur die Differenz bleibt offen
  const partly = { [payKey('2026-09-14', 'anna', 'me')]: { amount: 8, at: 1 } };
  const items = withPayments(debts, partly);
  assert.equal(items.find((x) => x.week === '2026-09-14').open, 2);

  // alles bezahlt
  const all = markPaid({}, debts);
  assert.equal(openByPair(withPayments(debts, all)).length, 0);
});
