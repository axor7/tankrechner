// Bezahl-Links (PayPal.me mit vorausgefülltem Betrag) und Nachrichtentexte.
// Reine Funktionen ohne DOM – werden auch getestet.

/** PayPal.me-Namen aus Eingabe holen: "name", "paypal.me/name", "https://www.paypal.com/paypalme/name/5" … */
export function paypalUser(input) {
  let s = String(input || '').trim();
  if (!s) return '';
  const m = s.match(/paypal(?:\.me|\.com\/paypalme)\/+([^/?#\s]+)/i);
  if (m) s = m[1];
  s = s.replace(/^@/, '');
  return /^[A-Za-z0-9._-]{1,40}$/.test(s) ? s : '';
}

/** PayPal.me-Link mit Betrag in Euro (Punkt als Dezimaltrennzeichen, wie PayPal es erwartet). */
export function paypalLink(user, amount) {
  const u = paypalUser(user);
  if (!u) return '';
  return amount > 0 ? `https://paypal.me/${u}/${amount.toFixed(2)}EUR` : `https://paypal.me/${u}`;
}

const euro = (v) => new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(v);

/**
 * Nachricht an eine Person, die Geld überweisen soll.
 * items: [{ label, amount, details }] – eine oder mehrere Wochen.
 */
export function paymentMessage({ fromName, toName, items, paypal }) {
  const total = Math.round(items.reduce((a, x) => a + x.amount, 0) * 100) / 100;
  const lines = [`Hi ${fromName} 👋`];
  if (items.length === 1) {
    const [x] = items;
    lines.push(`deine Tankkosten für ${x.label}: *${euro(x.amount)}*${x.details ? ` (${x.details})` : ''}`);
  } else {
    lines.push('deine offenen Tankkosten:');
    for (const x of items) lines.push(`• ${x.label}: ${euro(x.amount)}${x.details ? ` (${x.details})` : ''}`);
    lines.push(`*Gesamt: ${euro(total)}*`);
  }
  const link = paypalLink(paypal, total);
  if (link) lines.push('', `Bitte per PayPal an ${toName} – als *„Freunde & Familie“* senden:`, link);
  else lines.push('', `Bitte an ${toName} überweisen.`);
  lines.push('', 'Danke! 🚗⛽');
  return lines.join('\n');
}
