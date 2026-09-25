// Kartenansicht (Leaflet + OpenStreetMap).
/* global L */
import { legIndexAt } from './api.js';

const ROUTE_COLOR = '#2563eb';

function stopIcon(i, n) {
  const kind = i === 0 ? 'start' : i === n - 1 ? 'end' : 'via';
  const text = i === 0 ? 'A' : i === n - 1 ? 'B' : String(i);
  return L.divIcon({ className: '', html: `<div class="pin pin-${kind}"><span>${text}</span></div>`, iconSize: [30, 38], iconAnchor: [15, 36] });
}

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
    this.map.on('click', (e) => this.showAddMenu(e.latlng));
    this.fitted = false;
  }

  invalidate() { setTimeout(() => this.map.invalidateSize(), 50); }

  showAddMenu(latlng) {
    const box = document.createElement('div');
    box.className = 'map-menu';
    const title = document.createElement('div');
    title.className = 'map-menu-title';
    title.textContent = 'Punkt setzen als …';
    box.append(title);
    for (const [kind, label] of [['start', 'Start'], ['via', 'Zwischenstopp'], ['end', 'Ziel']]) {
      const b = document.createElement('button');
      b.className = `btn btn-small btn-${kind}`;
      b.textContent = label;
      b.onclick = () => { this.map.closePopup(); this.h.onAddPoint(kind, latlng); };
      box.append(b);
    }
    L.popup({ closeButton: false }).setLatLng(latlng).setContent(box).openOn(this.map);
  }

  setStops(stops) {
    this.stopLayer.clearLayers();
    const valid = stops.filter((s) => s.lat != null);
    valid.forEach((s, i) => {
      const m = L.marker([s.lat, s.lng], { icon: stopIcon(i, valid.length), draggable: true, autoPan: true, zIndexOffset: 1000 });
      m.bindTooltip(s.label || 'Punkt', { direction: 'top', offset: [0, -34] });
      m.on('dragend', () => this.h.onStopMoved(s.id, m.getLatLng()));
      m.on('contextmenu', () => this.h.onStopRemove(s.id));
      m.addTo(this.stopLayer);
    });
  }

  setRoute(route, alternatives = [], selected = 0) {
    this.routeLayer.clearLayers();
    this.route = route;
    if (!route) return;
    alternatives.forEach((alt, idx) => {
      if (idx === selected) return;
      const line = L.polyline(alt.coords, { color: '#64748b', weight: 6, opacity: 0.55, dashArray: '8 8' });
      line.bindTooltip(`Alternative: ${(alt.distance / 1000).toFixed(1)} km · ${Math.round(alt.duration / 60)} min – klicken zum Auswählen`, { sticky: true });
      line.on('click', (e) => { L.DomEvent.stopPropagation(e); this.h.onSelectAlternative(idx); });
      line.addTo(this.routeLayer);
    });
    L.polyline(route.coords, { color: '#fff', weight: 9, opacity: 0.9, interactive: false }).addTo(this.routeLayer);
    const main = L.polyline(route.coords, { color: ROUTE_COLOR, weight: 6, opacity: 0.95 });
    main.bindTooltip('Klicken, um hier einen Zwischenstopp einzufügen', { sticky: true });
    main.on('click', (e) => {
      L.DomEvent.stopPropagation(e);
      this.h.onInsertVia(legIndexAt(route, e.latlng) + 1, e.latlng);
    });
    main.addTo(this.routeLayer);
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
