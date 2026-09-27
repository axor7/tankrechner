// Adressfeld mit Vorschlägen (Photon) – für Ziel, Startadresse und Abholadressen.
import { searchPlaces } from './api.js';
import { h, debounce, toast } from './ui.js';
import { icon } from './icons.js';

/**
 * value: aktuelle Adresse { label, lat, lng } oder null
 * onSelect(addr | null): gewählte Adresse
 */
export function addressInput({ value, placeholder = 'Adresse suchen …', onSelect, near, allowLocate = false, focusKey }) {
  const list = h('ul', { class: 'suggest', hidden: true });
  let ctrl;
  let results = [];
  let active = -1;

  const choose = (r) => { list.hidden = true; input.value = r.label; onSelect({ label: r.label, lat: r.lat, lng: r.lng }); };
  const draw = () => {
    list.replaceChildren(...results.map((r, k) => h('li', { class: k === active ? 'active' : '', onmousedown: (e) => { e.preventDefault(); choose(r); } }, r.label)));
    list.hidden = !results.length;
  };
  const search = debounce(async (q) => {
    if (q.trim().length < 3) { results = []; draw(); return; }
    ctrl?.abort();
    ctrl = new AbortController();
    try { results = await searchPlaces(q, { near, signal: ctrl.signal }); active = -1; draw(); } catch (e) { if (e.name !== 'AbortError') toast('Adresssuche nicht erreichbar', 'error'); }
  }, 300);

  const input = h('input', {
    type: 'text', value: value?.label || '', placeholder, autocomplete: 'off', 'aria-label': placeholder, 'data-focus-key': focusKey,
    oninput: (e) => search(e.target.value),
    onkeydown: (e) => {
      if (list.hidden) return;
      if (e.key === 'ArrowDown') { active = Math.min(results.length - 1, active + 1); draw(); e.preventDefault(); }
      if (e.key === 'ArrowUp') { active = Math.max(0, active - 1); draw(); e.preventDefault(); }
      if (e.key === 'Enter') { choose(results[Math.max(0, active)]); e.preventDefault(); }
      if (e.key === 'Escape') { results = []; draw(); }
    },
    onblur: () => setTimeout(() => { list.hidden = true; }, 150),
  });

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
