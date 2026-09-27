# ⛽ Tankrechner – Spritkosten fair teilen

Eine Website für Fahrgemeinschaften: Strecke mit Zwischenstopps planen, aktuelle Spritpreise an der Strecke holen, die beste Tankzeit sehen und die Kosten **fair** auf wechselnde Mitfahrer aufteilen.

## Funktionen

Gestaltet nach Apples Human Interface Guidelines: Systemschrift, gruppierte Listen, Milchglas-Leisten, Hell/Dunkel automatisch.
Auf dem Handy Tab-Leiste unten, auf Tablet/Computer Seitenleiste; die Karte lässt sich ein- und ausblenden.

**Übersicht** – was du noch zahlen musst bzw. bekommst, diese Woche, Kosten pro Fahrt, Spritpreis, beste Tankzeit, deine nächsten Fahrten; beim Einstieg eine Schritt-für-Schritt-Liste.

**Fahrten**
- **Meine Tage**: für die nächsten 4 Wochen vorausschauend antippen, an welchen Tagen man mitfährt
- Wochenplan mit Hin-/Rückfahrt, Personen per Tipp an- und abwählen, Fahrer pro Fahrt
- **Aus Regelplan füllen** (feste Tage je Person), „Wie Vorwoche“; Tage in der Zukunft sind „geplant“ und werden erst ab dem Tag abgerechnet
- Teilstrecken: automatisch aus den Adressen oder von Hand

**Abrechnung**
- Offene Beträge über mehrere Wochen, bezahlt abhaken, Nachricht + PayPal-Link kopieren
- Zeitraum Woche/Monat/alles/frei, Anteil pro Person, Ausgleich, alle Werte im Überblick, Nebenkosten an/aus

**Strecke**
- Start, Zwischenstopps, Ziel mit Adresssuche oder per Tipp in die Karte; Marker ziehen, auf die Route tippen für Zwischenstopps
- Adressen Personen zuordnen (zahlen hin ab / zurück bis zu ihrer Adresse), eigene Reihenfolge für die Rückfahrt
- Spritpreis & Tankzeit: Live-Preise an der Strecke (Tankerkönig), beste Tankzeit

**Einstellungen**
- Fahrgemeinschaft & Konto, **„Das bin ich“**
- **Mitfahrer**: aktiv/inaktiv (statt löschen), feste Tage (Regelplan), PayPal, Farbe
- Auto (Verbrauch, Kraftstoff, Nebenkosten pro km), Aufteilungsregel, Daten (Beispiel, Export/Import, Zurücksetzen)

## Fahrgemeinschaft mit Login (optional)

Über den Knopf **👤 Anmelden** oben rechts:

- Konto mit E-Mail und Passwort anlegen
- **Fahrgemeinschaft anlegen** (die bisherigen eigenen Daten können mitgenommen werden) und den **Einladungslink** an die Kollegen schicken
- Jeder **beansprucht seinen Namen** („Wer bist du?“ auf der Übersicht bzw. „Das bin ich“) – ein Name kann nur einem Konto gehören. Dann zeigt die Übersicht „Du musst noch … zahlen“ und jeder kann selbst abhaken, was er bezahlt hat (mit „abgehakt von …“) und seine Tage planen
- Änderungen werden sofort gespeichert und bei allen live aktualisiert (ohne Live-Verbindung spätestens nach ~15 s); ändern zwei gleichzeitig, gehen beide Änderungen nicht verloren
- „Nur lokal arbeiten“ schaltet zurück auf die eigenen Daten dieses Geräts

Technik: [Supabase](https://supabase.com) (Anmeldung + Datenbank). Einrichtung einmalig: `supabase/setup.sql` im SQL Editor ausführen und unter Authentication → Email „Confirm email“ ausschalten
(der eingebaute Mailversand von Supabase erreicht nur Mitglieder des Supabase-Teams). Ohne Anmeldung bleibt alles wie bisher nur im Browser.

## So wird fair gerechnet

Jede Fahrt besteht aus Teilstrecken (Start → Stopp → … → Ziel). Die Kosten einer Teilstrecke
(`km × Verbrauch/100 × Preis`, plus optional Zusatzkosten) werden gleichmäßig auf alle verteilt, die auf dieser Teilstrecke im Auto sitzen.
Der Fahrer ist immer dabei. Wer die Fahrt fährt, hat den Sprit bezahlt – daraus ergibt sich, wer wem etwas schuldet.

Beispiel: Karlsruhe → Pforzheim (32 km) → Stuttgart (49 km). Ich und Anna ab Karlsruhe, Ben steigt in Pforzheim zu.
Die erste Teilstrecke teilen sich 2 Personen, die zweite 3 – Ben zahlt nur ab Pforzheim.

Sind Adressen Personen zugeordnet, ergeben sich die Teilstrecken automatisch aus den Adressen der Mitfahrenden des Tages
(Hinweg: ab der eigenen Adresse, Rückweg: bis zur eigenen Adresse). Ohne Zuordnung werden die Teilstrecken im Wochenplan von Hand gepflegt.

## Starten

Es ist eine reine statische Website (HTML/CSS/JavaScript, keine Installation, kein Server-Code).
Wegen der JavaScript-Module muss sie über einen Webserver geöffnet werden, nicht per Doppelklick:

```bash
npm start            # startet http://localhost:8080
# oder
python3 -m http.server 8080
```

Veröffentlichen z. B. über GitHub Pages: Repository → Settings → Pages → „Deploy from a branch“ → `main` / `root`.

Welche Version geladen ist, steht unten auf der Seite und im Menü ☰ („Version vom …“ = Zeitpunkt der Veröffentlichung).
Ist inzwischen eine neuere Version online, erscheint oben „Neue Version verfügbar“ mit einem Knopf zum Neuladen.

### Live-Spritpreise

Für Live-Preise brauchst du einen kostenlosen API-Key von [Tankerkönig](https://onboarding.tankerkoenig.de/) und trägst ihn im Tab „Auto & Sprit“ ein.
Der Key wird nur in deinem Browser gespeichert. Ohne Key funktioniert alles mit einem manuell eingegebenen Preis.

## Daten & Datenschutz

Ohne Anmeldung liegen alle Daten (Personen, Fahrten, Einstellungen) nur im `localStorage` deines Browsers. In einer Fahrgemeinschaft liegen die gemeinsamen Daten in der Supabase-Datenbank; lesen und ändern können sie nur deren Mitglieder. Tankerkönig-Key und Messwerte bleiben immer auf dem Gerät.
Über das Menü ☰ kannst du sie als JSON exportieren/importieren, z. B. um sie auf ein anderes Gerät zu übertragen.
Externe Dienste: OpenStreetMap (Karte), OSRM (Routing), Photon (Adresssuche), Tankerkönig (Preise).

## Tests

```bash
npm test
```

Testet die Rechenlogik (Kosten, Teilstrecken-Aufteilung, Ausgleichszahlungen, Kalenderwochen, Tankzeiten).

## Aufbau

```
index.html          Seite (Seitenleiste, Titelzeile, Ansicht, Karte, Tab-Leiste)
css/style.css       Gestaltung im Apple-Stil (hell/dunkel, Handy/Tablet/Computer)
js/app.js           Start, Navigation, Karte, Strecken-Ansicht, Routenberechnung
js/view-home.js     Übersicht
js/tab-trips.js     Fahrten: Wochenplan, Regelplan, Meine Tage
js/tab-bill.js      Abrechnung, offene Beträge
js/tab-fuel.js      Auto, Spritpreis, Tankstellen, beste Tankzeit
js/view-settings.js Einstellungen, Mitfahrer
js/account.js       Konto & Fahrgemeinschaft (Oberfläche)
js/cloud.js         Supabase: Anmeldung, Gruppen, Speichern, Live-Updates
js/sync.js          Synchronisation mit Konfliktbehandlung (getestet)
js/calc.js          Rechenlogik (ohne DOM, getestet)
js/plan.js          Aktiv/inaktiv, Regelplan (getestet)
js/debts.js         Offene Beträge je Woche (getestet)
js/pay.js           PayPal.me-Links und Nachrichten (getestet)
js/fueltimes.js     Beste Tankzeit
js/map.js           Leaflet-Karte
js/api.js           Photon, OSRM, Tankerkönig
js/state.js         Zustand & Speicherung
js/icons.js         Symbole (Lucide, ISC-Lizenz)
js/ui.js, version.js, example.js
supabase/setup.sql  Datenbank-Einrichtung
tests/              Tests (node --test)
```
