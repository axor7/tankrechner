// Versionsanzeige: GitHub Pages liefert bei jeder Veröffentlichung einen neuen
// Last-Modified-Zeitstempel. Daran erkennen wir, welche Version geladen ist und
// ob inzwischen eine neuere online ist.
import { h } from './ui.js';

const pageUrl = () => location.href.split('#')[0];

/** Zeitpunkt der geladenen Version (null, wenn der Server keinen liefert). */
export function loadedVersion() {
  const d = new Date(document.lastModified);
  // Ohne Last-Modified-Header setzt der Browser "jetzt" ein – dann wissen wir es nicht.
  if (Number.isNaN(d.getTime()) || Math.abs(Date.now() - d.getTime()) < 3000) return null;
  return d;
}

export function formatVersion(d) {
  return d
    ? `Version vom ${d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })}, ${d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })} Uhr`
    : 'Version unbekannt';
}

async function onlineVersion() {
  const res = await fetch(pageUrl(), { method: 'HEAD', cache: 'no-store' });
  const lm = res.headers.get('last-modified');
  return lm ? new Date(lm) : null;
}

/** Alle Dateien der Seite frisch holen (am Browser-Cache vorbei) und neu laden. */
async function reloadFresh() {
  const same = performance.getEntriesByType('resource').map((e) => e.name).filter((u) => u.startsWith(location.origin));
  await Promise.allSettled([pageUrl(), ...same].map((u) => fetch(u, { cache: 'reload' })));
  location.reload();
}

function showUpdateBanner() {
  if (document.getElementById('update-banner')) return;
  document.body.append(h('div', { id: 'update-banner', role: 'status' },
    h('span', {}, '✨ Neue Version verfügbar'),
    h('button', { type: 'button', class: 'btn btn-small btn-primary', onclick: (e) => { e.target.disabled = true; e.target.textContent = 'Lädt …'; reloadFresh(); } }, 'Jetzt neu laden'),
    h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Später', onclick: (e) => e.target.closest('#update-banner').remove() }, '✕'),
  ));
}

let lastCheck = 0;
async function checkForUpdate() {
  const loaded = loadedVersion();
  if (!loaded || document.hidden || Date.now() - lastCheck < 60_000) return;
  lastCheck = Date.now();
  try {
    const online = await onlineVersion();
    if (online && online.getTime() - loaded.getTime() > 1000) showUpdateBanner();
  } catch { /* offline o. ä. – egal */ }
}

export function setupVersion() {
  const text = formatVersion(loadedVersion());
  for (const el of document.querySelectorAll('[data-version]')) el.textContent = text;
  setTimeout(checkForUpdate, 3000);
  // Beim Zurückkehren zur Seite/App erneut prüfen (z. B. Tablet-Startbildschirm)
  document.addEventListener('visibilitychange', checkForUpdate);
}
