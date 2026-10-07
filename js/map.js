// Kartenansicht (Leaflet + OpenStreetMap).
/* global L */
import { icon } from './icons.js';

const ROUTE_COLOR = '#2563eb';

function stopIcon(i, n, color) {
  const kind = i === 0 ? 'start' : i === n - 1 ? 'end' : 'via';
  const text = i === 0 ? 'A' : i === n - 1 ? 'B' : String(i);
  const style = color ? ` style="background:${color}"` : '';
  return L.divIcon({ className: '', html: `<div class="pin pin-${kind}"${style}><span>${text}</span></div>`, iconSize: [30, 38], iconAnchor: [15, 36] });
}

/** Runder Marker mit Symbol (Umleitung, Sperrung, Baustelle). */
function badgeIcon(name, cls, size = 30) {
  return L.divIcon({ className: '', html: `<div class="map-badge ${cls}">${icon(name, { size: Math.round(size * 0.55) }).outerHTML}</div>`, iconSize: [size, size], iconAnchor: [size / 2, size / 2] });
}

const INCIDENT = {
  closure: { color: '#ff3b30', icon: 'octagon-x', size: 30, z: 950 },
  works: { color: '#ff9500', icon: 'construction', size: 28, z: 850 },
  short: { color: '#d4a106', icon: 'traffic-cone', size: 24, z: 800 },
};
// Popups nicht unter die Bedienelemente oben (Zoom, Hin/Rück) schieben
const POPUP = { maxWidth: 300, autoPanPaddingTopLeft: [12, 64], autoPanPaddingBottomRight: [12, 12] };
const incidentClass = (it) => (it.kind === 'closure' || it.kind === 'ramp' ? 'closure' : it.kind === 'short' ? 'short' : 'works');

function priceColor(t) {
  // t: 0 = günstigste, 1 = teuerste
  const hue = 130 - 130 * t;
  return `hsl(${hue} 70% 38%)`;
}

export class MapView {
  constructor(el, handlers) {
    this.h = handlers;
    this.map = L.map(el, { zoomControl: true }).setView([51.1, 10.4], 6);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> · Routing: OSRM · Preise: Tankerkönig (CC BY 4.0)',
    }).addTo(this.map);
    this.stopLayer = L.layerGroup().addTo(this.map);
    this.routeLayer = L.layerGroup().addTo(this.map);
    this.stationLayer = L.layerGroup().addTo(this.map);
    this.incidentLayer = L.layerGroup().addTo(this.map);
    this.incidentMarkers = new Map();
    this.map.on('click', (e) => this.showAddMenu(e.latlng));
    this.fitted = false;
  }

  invalidate() { setTimeout(() => this.map.invalidateSize(), 50); }

  closePopup() { this.map.closePopup(); }

  showAddMenu(latlng) {
    const box = document.createElement('div');
    box.className = 'map-menu';
    const title = document.createElement('div');
    title.className = 'map-menu-title';
    title.textContent = 'Punkt setzen als …';
    box.append(title);
    const items = typeof this.h.menuItems === 'function' ? this.h.menuItems() : this.h.menuItems || [['start', 'Start'], ['via', 'Zwischenstopp'], ['end', 'Ziel']];
    if (!items.length) return;
    for (const [kind, label] of items) {
      const b = document.createElement('button');
      b.className = `btn btn-small btn-${kind}`;
      b.textContent = label;
      b.onclick = () => { this.map.closePopup(); this.h.onAddPoint(kind, latlng); };
      box.append(b);
    }
    L.popup({ closeButton: false }).setLatLng(latlng).setContent(box).openOn(this.map);
  }

  /** Stopps in Fahrtrichtung (A = Start, Zahlen = Abholpunkte, B = Ende); Umleitungen (via) als eigene Marker. */
  setStops(stops) {
    this.stopLayer.clearLayers();
    const valid = stops.filter((s) => s.lat != null);
    const count = valid.filter((s) => !s.via).length;
    let k = 0;
    for (const s of valid) {
      const ic = s.via ? badgeIcon('signpost', 'detour') : stopIcon(k++, count, s.color);
      const m = L.marker([s.lat, s.lng], { icon: ic, draggable: s.draggable !== false, autoPan: true, zIndexOffset: s.via ? 900 : 1000 });
      m.bindTooltip(s.label || 'Punkt', { direction: 'top', offset: s.via ? [0, -16] : [0, -34] });
      if (s.popup) m.bindPopup(() => s.popup(), POPUP);
      m.on('dragend', () => this.h.onStopMoved(s.id, m.getLatLng()));
      m.on('contextmenu', () => this.h.onStopRemove(s.id));
      m.addTo(this.stopLayer);
    }
  }

  setRoute(route, { color = ROUTE_COLOR } = {}) {
    this.routeLayer.clearLayers();
    this.route = route;
    if (!route?.coords) return;
    L.polyline(route.coords, { color: '#fff', weight: 9, opacity: 0.9, interactive: false }).addTo(this.routeLayer);
    L.polyline(route.coords, { color, weight: 6, opacity: 0.95, interactive: false }).addTo(this.routeLayer);
  }

  /** Sperrungen & Baustellen: Abschnitt als Linie + Marker; Klick zeigt popup(item). */
  setIncidents(items, { popup } = {}) {
    this.incidentLayer.clearLayers();
    this.incidentMarkers = new Map();
    for (const it of items) {
      const c = INCIDENT[incidentClass(it)];
      const pts = it.shown || it.coords; // nur der Teil auf unserer Strecke
      if (pts.length > 1) {
        const line = L.polyline(pts, { color: c.color, weight: 7, opacity: 0.9, lineCap: 'butt' });
        if (popup) line.bindPopup(() => popup(it), POPUP);
        line.addTo(this.incidentLayer);
      }
      const mid = pts[Math.floor(pts.length / 2)];
      const m = L.marker(mid, { icon: badgeIcon(c.icon, `incident ${incidentClass(it)}`, c.size), zIndexOffset: c.z, title: it.title });
      if (popup) m.bindPopup(() => popup(it), POPUP);
      m.addTo(this.incidentLayer);
      this.incidentMarkers.set(it.id, m);
    }
  }

  focusIncident(it) {
    this.map.fitBounds(L.latLngBounds(it.shown || it.coords).pad(0.6), { maxZoom: 14 });
    const m = this.incidentMarkers.get(it.id);
    if (m) setTimeout(() => m.openPopup(), 350);
  }

  /** Umschalter Hinfahrt / Rückfahrt oben rechts auf der Karte. */
  setDirControl({ show, dir, onChange }) {
    if (!this.dirEl) {
      const Ctl = L.Control.extend({
        onAdd() {
          const el = L.DomUtil.create('div', 'map-dir');
          L.DomEvent.disableClickPropagation(el);
          L.DomEvent.disableScrollPropagation(el);
          return el;
        },
      });
      this.dirCtl = new Ctl({ position: 'topright' });
      this.dirCtl.addTo(this.map);
      this.dirEl = this.dirCtl.getContainer();
    }
    this.dirEl.hidden = !show;
    this.dirEl.replaceChildren(...[['hin', 'Hinfahrt'], ['rueck', 'Rückfahrt']].map(([d, label]) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = d === dir ? `active ${d}` : d;
      b.textContent = label;
      b.setAttribute('aria-pressed', String(d === dir));
      b.onclick = () => onChange(d);
      return b;
    }));
  }

  setStations(stations, fuel, selectedId, onSelect) {
    this.stationLayer.clearLayers();
    const priced = stations.filter((s) => s[fuel] > 0);
    if (!priced.length) return;
    const prices = priced.map((s) => s[fuel]);
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    for (const s of priced) {
      const t = max > min ? (s[fuel] - min) / (max - min) : 0;
      const sel = s.id === selectedId;
      const html = `<div class="station-pin${sel ? ' selected' : ''}${s.isOpen ? '' : ' closed'}" style="--c:${priceColor(t)}">${s[fuel].toFixed(3).replace('.', ',')}</div>`;
      const m = L.marker([s.lat, s.lng], { icon: L.divIcon({ className: '', html, iconSize: [58, 24], iconAnchor: [29, 12] }), zIndexOffset: sel ? 900 : 0 });
      const box = document.createElement('div');
      box.className = 'station-popup';
      const fmt = (v) => (v > 0 ? `${v.toFixed(3).replace('.', ',')} €` : '–');
      box.innerHTML = `<strong>${escapeHtml(s.brand || s.name)}</strong><div class="muted">${escapeHtml(s.address)}</div>
        <table><tr><td>E10</td><td>${fmt(s.e10)}</td></tr><tr><td>E5</td><td>${fmt(s.e5)}</td></tr><tr><td>Diesel</td><td>${fmt(s.diesel)}</td></tr></table>
        <div class="${s.isOpen ? 'ok' : 'warn'}">${s.isOpen ? 'Geöffnet' : 'Geschlossen'}</div>`;
      const b = document.createElement('button');
      b.className = 'btn btn-small btn-primary';
      b.textContent = sel ? 'Ausgewählt ✓' : 'Diese Tankstelle nutzen';
      b.onclick = () => { this.map.closePopup(); onSelect(s.id); };
      box.append(b);
      m.bindPopup(box);
      m.addTo(this.stationLayer);
    }
  }

  focusStation(s) {
    this.map.setView([s.lat, s.lng], Math.max(this.map.getZoom(), 14));
  }

  fit(stops, route) {
    const pts = route ? route.coords : stops.filter((s) => s.lat != null).map((s) => [s.lat, s.lng]);
    if (!pts.length) return;
    if (pts.length === 1) this.map.setView(pts[0], 13);
    else this.map.fitBounds(L.latLngBounds(pts), { padding: [40, 40] });
  }
}

export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
