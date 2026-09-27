import { test } from 'node:test';
import assert from 'node:assert/strict';
import { paypalUser, paypalLink, waPhone, waLink, paymentMessage } from '../js/pay.js';

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

test('Handynummern für WhatsApp', () => {
  assert.equal(waPhone('0151 2345 6789'), '4915123456789');
  assert.equal(waPhone('+49 151 23456789'), '4915123456789');
  assert.equal(waPhone('0049 151-23456789'), '4915123456789');
  assert.equal(waPhone('+43 664 1234567'), '436641234567');
  assert.equal(waPhone('123'), '');
  assert.equal(waLink('', 'a b'), 'https://wa.me/?text=a%20b');
  assert.equal(waLink('0151 23456789', 'x'), 'https://wa.me/4915123456789?text=x');
});

test('Nachricht enthält Betrag, Link und Freunde & Familie', () => {
  const m = paymentMessage({ fromName: 'Anna', toName: 'Max', amount: 24.1, period: 'KW 39', details: '8 Fahrten', paypal: 'maxmuster' });
  assert.match(m, /Hi Anna/);
  assert.match(m, /24,10\s€/);
  assert.match(m, /Freunde & Familie/);
  assert.match(m, /https:\/\/paypal\.me\/maxmuster\/24\.10EUR/);
  const noPp = paymentMessage({ fromName: 'Anna', toName: 'Max', amount: 5, period: 'KW 39' });
  assert.doesNotMatch(noPp, /paypal/);
});
