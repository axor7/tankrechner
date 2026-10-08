// Fenster von unten (auf dem Computer mittig): ein Dialog für alles – Tag, Rhythmus, Abwesenheit, Einladen …
// Jede Ansicht meldet ihre Fenster mit register(art, zeichnen) an; app.js zeichnet das offene Fenster bei jeder Änderung neu.
import { h } from './ui.js';
import { icon } from './icons.js';

const renderers = new Map();
let current = null; // { kind, args }

const dialog = () => document.getElementById('day-dialog');

export function register(kind, fn) { renderers.set(kind, fn); }

export function openSheet(kind, args = {}) {
  current = { kind, args };
  renderSheet();
  const d = dialog();
  if (d && !d.open) d.showModal();
}

export function closeSheet() {
  current = null;
  const d = dialog();
  if (d?.open) d.close();
}

export const sheetOpen = (kind) => !!current && (!kind || current.kind === kind) && !!dialog()?.open;

/** Kopf eines Fensters: Titel, optional Untertitel, Schließen. */
export function sheetHead(title, sub) {
  return h('div', { class: 'sheet-head' },
    h('div', { class: 'grow' }, h('h2', {}, title), sub ? h('div', { class: 'muted small' }, sub) : null),
    h('button', { type: 'button', class: 'icon-btn tinted', 'aria-label': 'Schließen', onclick: closeSheet }, icon('x', { size: 18 })));
}

export function renderSheet() {
  const d = dialog();
  if (!d || !current) return;
  const fn = renderers.get(current.kind);
  if (!fn) return;
  const scroller = d.querySelector('.sheet');
  const top = scroller?.scrollTop || 0;
  const focusKey = document.activeElement?.dataset?.focusKey;
  const content = fn(current.args);
  if (!content) { closeSheet(); return; }
  d.replaceChildren(h('div', { class: 'sheet' }, content));
  const next = d.querySelector('.sheet');
  if (next) next.scrollTop = top;
  if (focusKey) d.querySelector(`[data-focus-key="${focusKey}"]`)?.focus();
}

export function initSheets() {
  const d = dialog();
  if (!d) return;
  d.addEventListener('close', () => { current = null; });
  // Tippen neben das Fenster schließt es
  d.addEventListener('click', (e) => { if (e.target === d) closeSheet(); });
}
