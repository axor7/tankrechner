// Bezahl-Links: PayPal.me (Betrag vorausgefüllt) und WhatsApp (Nachricht vorausgefüllt).
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

/** Handynummer für wa.me: nur Ziffern, internationales Format (0151… → 49151…). */
export function waPhone(input) {
  let d = String(input || '').replace(/[^\d+]/g, '');
  if (!d) return '';
  if (d.startsWith('+')) d = d.slice(1);
  else if (d.startsWith('00')) d = d.slice(2);
  else if (d.startsWith('0')) d = `49${d.slice(1)}`;
  d = d.replace(/\D/g, '');
  return d.length >= 8 ? d : '';
}

/** WhatsApp-Link: mit Nummer direkt an die Person, sonst Kontaktauswahl. */
export function waLink(phone, text) {
  const p = waPhone(phone);
  return `https://wa.me/${p}?text=${encodeURIComponent(text)}`;
}

const euro = (v) => new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(v);

/** Nachricht an eine Person, die Geld überweisen soll. */
export function paymentMessage({ fromName, toName, amount, period, details, paypal }) {
  const lines = [`Hi ${fromName} 👋`, `deine Tankkosten ${period}: *${euro(amount)}*${details ? ` (${details})` : ''}`];
  const link = paypalLink(paypal, amount);
  if (link) {
    lines.push('', `Bitte per PayPal an ${toName} – als *„Freunde & Familie“* senden:`, link);
  } else {
    lines.push('', `Bitte an ${toName} überweisen.`);
  }
  lines.push('', 'Danke! 🚗⛽');
  return lines.join('\n');
}
