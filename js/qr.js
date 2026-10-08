// QR-Code für Einladungen (Bibliothek qrcode-generator, MIT – wird erst geladen, wenn ein Code gezeigt wird).
import { h } from './ui.js';

const LIB = 'https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/+esm';
let lib = null;
const cache = new Map();

/** QR-Code als SVG-Element; bis die Bibliothek geladen ist, ein Platzhalter, danach wird onReady() aufgerufen. */
export function qrCode(text, { onReady } = {}) {
  if (!text) return h('div', { class: 'qr qr-empty' });
  if (cache.has(text)) return h('div', { class: 'qr', html: cache.get(text), role: 'img', 'aria-label': 'QR-Code der Einladung' });
  lib ||= import(LIB).then((m) => m.default || m);
  lib.then((qrcode) => {
    const qr = qrcode(0, 'M');
    qr.addData(text);
    qr.make();
    cache.set(text, qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true }));
    onReady?.();
  }).catch(() => {});
  return h('div', { class: 'qr qr-empty' }, 'QR-Code wird erstellt …');
}
