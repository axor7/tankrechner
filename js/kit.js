// Bausteine der Oberfläche: Bildschirm, Abschnitt, Liste, Zeile, Schalter, Knöpfe, Personen-Kreis, Fenster.
// Alles, was angezeigt wird, entsteht aus diesen wenigen Teilen – damit überall dieselbe Ordnung gilt.
import { personById } from './state.js';
import { inGroup, claims } from './account.js';
import { h, toast } from './ui.js';
import { icon } from './icons.js';

export { h, icon, toast };

/** Fehler als Hinweis zeigen statt still zu scheitern. Gibt true zurück, wenn es geklappt hat. */
export async function attempt(fn) {
  try { await fn(); return true; } catch (e) { toast(e.message, 'error'); return false; }
}

// ---------- Bildschirm & Abschnitte ----------

/** Kopf eines Bildschirms: großer Titel, optional Zurück und eine Aktion rechts. */
export function header({ title, sub, back, action }) {
  return h('header', { class: 'scr-head' },
    back ? h('button', { type: 'button', class: 'back', onclick: back.onClick }, icon('chevron-left', { size: 22 }), back.label) : null,
    h('div', { class: 'scr-head-row' },
      h('div', { class: 'scr-titles' }, sub ? h('div', { class: 'scr-sub' }, sub) : null, h('h1', { class: String(title).length > 16 ? 'long' : null }, title)),
      action || null));
}

/** Abschnitt mit Überschrift (optional mit kleiner Aktion rechts). */
export function section(title, content, { action, foot } = {}) {
  return h('section', { class: 'sec' },
    title ? h('div', { class: 'sec-head' }, h('h2', {}, title), action || null) : null,
    content,
    foot ? h('p', { class: 'sec-foot' }, foot) : null);
}

/** Gruppierte Liste (Zeilen untereinander in einer Karte). */
export const list = (...rows) => h('div', { class: 'list' }, ...rows);

/** Karte für freie Inhalte. */
export const card = (...children) => h('div', { class: 'card' }, ...children);

/**
 * Eine Zeile: vorne Kreis/Symbol, Titel + Untertitel, hinten Wert oder Bedienelement.
 * onClick macht die ganze Zeile antippbar (mit Pfeil, außer chevron: false).
 */
export function row({ lead, title, sub, value, trail, onClick, chevron = true, tone, cls = '' }) {
  const tag = onClick ? 'button' : 'div';
  return h(tag, { type: onClick ? 'button' : null, class: `row ${tone ? `tone-${tone}` : ''} ${cls}`, onclick: onClick },
    lead || null,
    h('span', { class: 'row-main' }, h('span', { class: 'row-title' }, title), sub ? h('span', { class: 'row-sub' }, sub) : null),
    value != null ? h('span', { class: 'row-value' }, value) : null,
    trail || null,
    onClick && chevron ? h('span', { class: 'row-chev' }, icon('chevron-right', { size: 17 })) : null);
}

/** Zeile mit Schalter. */
export function switchRow({ title, sub, checked, onChange, disabled = false }) {
  return h('label', { class: `row switch-row ${disabled ? 'is-disabled' : ''}` },
    h('span', { class: 'row-main' }, h('span', { class: 'row-title' }, title), sub ? h('span', { class: 'row-sub' }, sub) : null),
    h('input', { type: 'checkbox', class: 'switch', checked: !!checked, disabled, onchange: (e) => onChange(e.target.checked) }));
}

/** Auswahl aus 2–4 Möglichkeiten nebeneinander. */
export function seg(options, value, onChange, { disabled = false } = {}) {
  return h('div', { class: 'seg', role: 'radiogroup' }, options.map(([v, label]) => h('button', {
    type: 'button', role: 'radio', 'aria-checked': String(v === value), class: v === value ? 'on' : '', disabled,
    onclick: () => v !== value && onChange(v),
  }, label)));
}

/** Knopf. kind: 'primary' | 'tinted' | 'plain' | 'danger' */
export function btn(label, { kind = 'tinted', ic, onClick, href, small = false, full = false, disabled = false, cls = '' } = {}) {
  const props = { class: `btn ${kind} ${small ? 'small' : ''} ${full ? 'full' : ''} ${cls}`, disabled };
  const kids = [ic ? icon(ic, { size: small ? 15 : 17 }) : null, label];
  return href ? h('a', { ...props, href, target: '_blank', rel: 'noopener' }, ...kids) : h('button', { ...props, type: 'button', onclick: onClick }, ...kids);
}

/** Knöpfe nebeneinander. */
export const actions = (...btns) => h('div', { class: 'actions' }, ...btns.filter(Boolean));

/** Kleiner, grauer Text. */
export const note = (text) => h('p', { class: 'note' }, text);

/** Hinweis-Karte: tone 'warn' | 'info' | 'good' | 'bad'. */
export function banner({ tone = 'info', ic, title, text, onClick, buttons }) {
  const tag = onClick ? 'button' : 'div';
  return h(tag, { type: onClick ? 'button' : null, class: `banner ${tone}`, onclick: onClick },
    ic ? h('span', { class: 'banner-ic' }, icon(ic, { size: 18 })) : null,
    h('span', { class: 'banner-main' }, h('strong', {}, title), text ? h('span', {}, text) : null,
      buttons ? h('span', { class: 'actions' }, ...buttons.filter(Boolean)) : null),
    onClick ? h('span', { class: 'row-chev' }, icon('chevron-right', { size: 17 })) : null);
}

/** Beschriftetes Eingabefeld. */
export const field = (label, control, hint) => h('label', { class: 'field' }, h('span', { class: 'field-label' }, label), control, hint ? h('span', { class: 'field-hint' }, hint) : null);

/** Plus/Minus-Zähler. */
export function stepper(value, { min = 1, max = 9, onChange, format = String }) {
  return h('div', { class: 'stepper' },
    h('button', { type: 'button', 'aria-label': 'Weniger', disabled: value <= min, onclick: () => onChange(value - 1) }, '−'),
    h('span', {}, format(value)),
    h('button', { type: 'button', 'aria-label': 'Mehr', disabled: value >= max, onclick: () => onChange(value + 1) }, '+'));
}

// ---------- Personen ----------

export const initials = (name) => (name || '?').trim().split(/\s+/).map((x) => x[0]).join('').slice(0, 2).toUpperCase();
/** Platzhalter: in der Fahrgemeinschaft, aber (noch) ohne App. */
export const isPlaceholder = (pid) => inGroup() && !claims().has(pid);

/** Kreis mit Initialen in der Farbe der Person. size: 's' | 'm' | 'l'. Platzhalter: gestrichelt. */
export function avatar(pid, size = 'm', { ring = false } = {}) {
  const p = personById(pid);
  return h('span', { class: `av av-${size} ${isPlaceholder(pid) ? 'ph' : ''} ${ring ? 'ring' : ''}`, style: { '--pc': p?.color || '#8e8e93' }, title: p?.name || '', 'aria-hidden': 'true' }, initials(p?.name));
}

/** Mehrere Kreise in einer Reihe. */
export const faces = (pids, { driver } = {}) => h('span', { class: 'faces' }, pids.map((id) => avatar(id, 's', { ring: id === driver })));

/** „ohne App“ (nur in einer Fahrgemeinschaft). */
export const noApp = (pid) => (isPlaceholder(pid) ? h('span', { class: 'tag' }, 'ohne App') : null);

// ---------- Fenster (eines zur Zeit, nie verschachtelt) ----------

const renderers = new Map();
let current = null; // { kind, args }
const dialog = () => document.getElementById('sheet');

export function registerSheet(kind, fn) { renderers.set(kind, fn); }

/** Fenster öffnen (ersetzt ein offenes Fenster). */
export function openSheet(kind, args = {}) {
  current = { kind, args };
  renderSheet();
  const d = dialog();
  if (d && !d.open) d.showModal();
  d?.querySelector('[data-autofocus]')?.focus();
}

export function closeSheet() {
  current = null;
  const d = dialog();
  if (d?.open) d.close();
}

export const sheetIsOpen = () => !!current && !!dialog()?.open;

/** Inhalt eines Fensters: Titel (+ Untertitel), Inhalt, unten optional ein Hauptknopf. */
export function sheet({ title, sub, body, foot }) {
  return [
    h('div', { class: 'sh-head' },
      h('div', { class: 'sh-titles' }, h('h2', {}, title), sub ? h('div', { class: 'sh-sub' }, sub) : null),
      h('button', { type: 'button', class: 'sh-close', 'aria-label': 'Schließen', onclick: closeSheet }, icon('x', { size: 18 }))),
    h('div', { class: 'sh-body' }, ...[body].flat().filter(Boolean)),
    foot ? h('div', { class: 'sh-foot' }, ...[foot].flat().filter(Boolean)) : null,
  ];
}

export function renderSheet() {
  const d = dialog();
  if (!d || !current) return;
  const fn = renderers.get(current.kind);
  const content = fn ? fn(current.args) : null;
  if (!content) { closeSheet(); return; }
  const body = d.querySelector('.sh-body');
  const top = body?.scrollTop || 0;
  const focusKey = document.activeElement?.dataset?.focusKey;
  d.replaceChildren(...[content].flat().filter(Boolean));
  const next = d.querySelector('.sh-body');
  if (next) next.scrollTop = top;
  if (focusKey) {
    const f = d.querySelector(`[data-focus-key="${focusKey}"]`);
    f?.focus();
    try { if (f?.type === 'text') f.setSelectionRange(f.value.length, f.value.length); } catch { /* egal */ }
  }
}

export function initSheets() {
  const d = dialog();
  d.addEventListener('close', () => { current = null; document.dispatchEvent(new CustomEvent('sheet-closed')); });
  d.addEventListener('click', (e) => { if (e.target === d) closeSheet(); });
}

// ---------- Teilen & Kopieren ----------

export async function copyText(text, msg = 'Kopiert') {
  try { await navigator.clipboard.writeText(text); toast(msg, 'ok'); } catch { prompt('Kopieren:', text); }
}

export async function shareText({ title, text, url }) {
  if (navigator.share) { try { await navigator.share({ title, text, url }); return; } catch (e) { if (e?.name === 'AbortError') return; } }
  copyText([text, url].filter(Boolean).join('\n'), 'Kopiert – jetzt z. B. in WhatsApp einfügen');
}
