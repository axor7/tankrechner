// Adressfeld mit Vorschlägen (Photon) – für Ziel, Startadresse und Abholadressen.
import { searchPlaces } from './api.js';
import { h, debounce, toast } from './ui.js';
import { icon } from './icons.js';

/**
 * value: aktuelle Adresse { label, lat, lng } oder null
 * onSelect(addr | null): gewählte Adresse
 */
// Gerade Getipptes je Feld (focusKey): überlebt, wenn die Ansicht währenddessen neu gezeichnet wird
const drafts = new Map();
const live = new Map(); // focusKey → Vorschläge im zuletzt gezeichneten Feld anzeigen

export function addressInput({ value, placeholder = 'Adresse suchen …', onSelect, near, allowLocate = false, focusKey }) {
  const list = h('ul', { class: 'suggest', hidden: true });
  let ctrl;
  const draft = focusKey ? drafts.get(focusKey) : null;
  let results = draft?.results || [];
  let active = -1;
  const remember = (text) => { if (focusKey) drafts.set(focusKey, { text, results }); };
  const show = () => { const fn = focusKey && live.get(focusKey); if (fn) fn(results); else draw(); };

  const choose = (r) => { list.hidden = true; input.value = r.label; if (focusKey) drafts.delete(focusKey); onSelect({ label: r.label, lat: r.lat, lng: r.lng }); };
  const draw = () => {
    list.replaceChildren(...results.map((r, k) => h('li', { class: k === active ? 'active' : '', onmousedown: (e) => { e.preventDefault(); choose(r); } }, r.label)));
    list.hidden = !results.length;
  };
  const search = debounce(async (q) => {
    if (q.trim().length < 3) { results = []; draw(); return; }
    ctrl?.abort();
    ctrl = new AbortController();
    try { results = await searchPlaces(q, { near, signal: ctrl.signal }); active = -1; remember(q); show(); } catch (e) { if (e.name !== 'AbortError') toast('Adresssuche nicht erreichbar', 'error'); }
  }, 300);

  const input = h('input', {
    type: 'text', value: draft ? draft.text : value?.label || '', placeholder, autocomplete: 'off', 'aria-label': placeholder, 'data-focus-key': focusKey,
    oninput: (e) => { remember(e.target.value); search(e.target.value); },
    onkeydown: (e) => {
      if (list.hidden) return;
      if (e.key === 'ArrowDown') { active = Math.min(results.length - 1, active + 1); draw(); e.preventDefault(); }
      if (e.key === 'ArrowUp') { active = Math.max(0, active - 1); draw(); e.preventDefault(); }
      if (e.key === 'Enter') { choose(results[Math.max(0, active)]); e.preventDefault(); }
      if (e.key === 'Escape') { results = []; draw(); }
    },
    onblur: () => setTimeout(() => {
      list.hidden = true;
      // wirklich verlassen (nicht nur neu gezeichnet)? Dann das Getippte vergessen
      if (focusKey && document.activeElement?.dataset?.focusKey !== focusKey) drafts.delete(focusKey);
    }, 150),
  });
  if (draft && results.length) queueMicrotask(draw); // Vorschläge wieder zeigen
  if (focusKey) live.set(focusKey, (r) => { results = r; active = -1; draw(); }); // dieses Feld ist jetzt das sichtbare

  const locate = allowLocate ? h('button', {
    type: 'button', class: 'icon-btn', title: 'Meinen Standort verwenden', 'aria-label': 'Meinen Standort verwenden',
    onclick: () => {
      if (!navigator.geolocation) return toast('Standort nicht verfügbar', 'error');
      navigator.geolocation.getCurrentPosition(async (p) => {
        const { reverseGeocode } = await import('./api.js');
        const label = await reverseGeocode(p.coords.latitude, p.coords.longitude);
        input.value = label;
        onSelect({ label, lat: p.coords.latitude, lng: p.coords.longitude });
      }, () => toast('Standort konnte nicht ermittelt werden', 'error'));
    },
  }, icon('locate-fixed', { size: 18 })) : null;

  return h('div', { class: 'addr' }, h('div', { class: 'stop-input' }, input, list), locate);
}
