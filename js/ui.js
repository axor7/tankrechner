// Kleine DOM- und Formatierungshelfer.

export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') {
      for (const [sk, sv] of Object.entries(v)) {
        if (sk.startsWith('--')) el.style.setProperty(sk, sv);
        else el.style[sk] = sv;
      }
    }
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'html') el.innerHTML = v;
    else if (k in el && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

const euro = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' });
const num1 = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 1, minimumFractionDigits: 1 });
const num2 = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 2, minimumFractionDigits: 2 });

export const fmtEuro = (v) => euro.format(v || 0);
export const fmtKm = (v) => `${num1.format(v || 0)} km`;
export const fmtL = (v) => `${num1.format(v || 0)} l`;
export const fmtNum2 = (v) => num2.format(v || 0);
export const fmtPrice = (v) => (v > 0 ? `${v.toFixed(3).replace('.', ',')} €` : '–');

export function fmtDuration(sec) {
  const m = Math.round(sec / 60);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min`;
}

const WD = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
const WD_LONG = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'];

export function fmtDate(iso, { weekday = false, long = false } = {}) {
  const [y, m, d] = iso.split('-').map(Number);
  const wd = (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
  const date = `${String(d).padStart(2, '0')}.${String(m).padStart(2, '0')}.`;
  if (!weekday) return date;
  return `${long ? WD_LONG[wd] : WD[wd]}, ${date}`;
}

export function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

let toastTimer;
export function toast(msg, kind = 'info') {
  let el = document.getElementById('toast');
  if (!el) { el = h('div', { id: 'toast' }); document.body.append(el); }
  el.textContent = msg;
  el.className = `show ${kind}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = ''; }, 3500);
}

/** Personen-Chip */
export function chip(person, { active = true, partial = false, driver = false, onClick, title } = {}) {
  return h('button', {
    type: 'button',
    class: `chip${active ? ' active' : ''}${partial ? ' partial' : ''}${driver ? ' driver' : ''}`,
    style: { '--pc': person.color },
    title: title || person.name,
    onclick: onClick,
  }, driver ? h('span', { class: 'chip-wheel', 'aria-label': 'Fahrer' }, '🚗') : null, person.name);
}

export function stat(label, value, sub) {
  return h('div', { class: 'stat' }, h('div', { class: 'stat-label' }, label), h('div', { class: 'stat-value' }, value), sub ? h('div', { class: 'stat-sub' }, sub) : null);
}
