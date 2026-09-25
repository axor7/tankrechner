# ⛽ Tankrechner – Spritkosten fair teilen

Eine Website für Fahrgemeinschaften: Strecke mit Zwischenstopps planen, aktuelle Spritpreise an der Strecke holen, die beste Tankzeit sehen und die Kosten **fair** auf wechselnde Mitfahrer aufteilen.

## Funktionen

**1 · Strecke**
- Start, beliebig viele Zwischenstopps und Ziel mit Adresssuche (Autovervollständigung) oder per Klick in die Karte
- Marker ziehen, um Punkte zu verschieben; Klick auf die Route fügt einen Zwischenstopp ein (so lässt sich die Route „umbiegen“)
- Alternative Routen (bei Start → Ziel ohne Zwischenstopp) direkt auf der Karte auswählbar
- Rückfahrt über dieselbe Strecke, Kilometer und Fahrzeit je Teilstrecke
- Ohne Karte: Kilometer auch manuell eingebbar

**2 · Auto & Sprit**
- Verbrauch (l/100 km) und Kraftstoff (E10, E5, Diesel, LPG, CNG), optional Zusatzkosten pro km (Verschleiß o. Ä.)
- Live-Preise aller Tankstellen entlang der Route (Tankerkönig / Markttransparenzstelle), farbig auf der Karte
- Preisquelle wählbar: günstigste an der Strecke, bestimmte Tankstelle oder manuell
- **Beste Zeit zum Tanken**: typischer Tagesverlauf mit Empfehlung und Ersparnis pro Woche. Mit API-Key sammelt die Seite alle 15 Minuten eigene Messwerte deiner Tankstellen und kann daraus ein eigenes Profil zeigen.

**3 · Fahrten**
- Mitfahrer mit Farbe anlegen, Standard-Fahrer festlegen
- Wochenplan (KW-Navigation): pro Tag Hin- und Rückfahrt, Personen per Tipp an- und abwählen
- „Alle Mo–Fr eintragen“, „Wie Vorwoche“, Wochenende optional
- **Teilstrecken**: z. B. steigt jemand erst am Zwischenstopp zu oder fährt nur hin, aber nicht zurück
- Fahrer pro Fahrt wählbar (wenn ihr euch abwechselt)
- Jede Woche merkt sich Strecke, Verbrauch und Preis → alte Wochen bleiben stabil abgerechnet

**4 · Abrechnung**
- Zeitraum: Woche, Monat, alles oder frei wählbar
- Anteil pro Person, gefahrene km, wer wie viel getankt hat
- Ausgleich: wer wem wie viel überweist (möglichst wenige Überweisungen)
- Regeln: *nach Teilstrecken* (jede Teilstrecke wird nur unter den dort Mitfahrenden geteilt) oder *gleich pro Fahrt*; Fahrer zahlt mit oder nicht
- Als Text kopieren (z. B. für WhatsApp), teilen, drucken; Detailansicht jeder Fahrt

## So wird fair gerechnet

Jede Fahrt besteht aus Teilstrecken (Start → Stopp → … → Ziel). Die Kosten einer Teilstrecke
(`km × Verbrauch/100 × Preis`, plus optional Zusatzkosten) werden gleichmäßig auf alle verteilt, die auf dieser Teilstrecke im Auto sitzen.
Der Fahrer ist immer dabei. Wer die Fahrt fährt, hat den Sprit bezahlt – daraus ergibt sich, wer wem etwas schuldet.

Beispiel: Karlsruhe → Pforzheim (32 km) → Stuttgart (49 km). Ich und Anna ab Karlsruhe, Ben steigt in Pforzheim zu.
Die erste Teilstrecke teilen sich 2 Personen, die zweite 3 – Ben zahlt nur ab Pforzheim.

## Starten

Es ist eine reine statische Website (HTML/CSS/JavaScript, keine Installation, kein Server-Code).
Wegen der JavaScript-Module muss sie über einen Webserver geöffnet werden, nicht per Doppelklick:

```bash
npm start            # startet http://localhost:8080
# oder
python3 -m http.server 8080
```

Veröffentlichen z. B. über GitHub Pages: Repository → Settings → Pages → „Deploy from a branch“ → `main` / `root`.

### Live-Spritpreise

Für Live-Preise brauchst du einen kostenlosen API-Key von [Tankerkönig](https://onboarding.tankerkoenig.de/) und trägst ihn im Tab „Auto & Sprit“ ein.
Der Key wird nur in deinem Browser gespeichert. Ohne Key funktioniert alles mit einem manuell eingegebenen Preis.

## Daten & Datenschutz

Alle Daten (Personen, Fahrten, Einstellungen) liegen nur im `localStorage` deines Browsers.
Über das Menü ☰ kannst du sie als JSON exportieren/importieren, z. B. um sie auf ein anderes Gerät zu übertragen.
Externe Dienste: OpenStreetMap (Karte), OSRM (Routing), Photon (Adresssuche), Tankerkönig (Preise).

## Tests

```bash
npm test
```

Testet die Rechenlogik (Kosten, Teilstrecken-Aufteilung, Ausgleichszahlungen, Kalenderwochen, Tankzeiten).

## Aufbau

```
index.html          Seite
css/style.css       Gestaltung (hell/dunkel, Handy & Desktop)
js/app.js           Start, Tabs, Strecken-Tab, Karten-Anbindung
js/map.js           Leaflet-Karte (Marker, Route, Tankstellen)
js/api.js           Photon, OSRM, Tankerkönig
js/calc.js          Rechenlogik (ohne DOM, getestet)
js/fueltimes.js     Beste Tankzeit
js/state.js         Zustand & Speicherung
js/tab-*.js         Die Tabs „Auto & Sprit“, „Fahrten“, „Abrechnung“
js/example.js       Beispieldaten
tests/              Tests (node --test)
```
