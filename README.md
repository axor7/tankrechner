# ⛽ Tankrechner – Spritkosten fair teilen

Eine Website für Fahrgemeinschaften: Strecke mit Zwischenstopps planen, aktuelle Spritpreise an der Strecke holen, die beste Tankzeit sehen und die Kosten **fair** auf wechselnde Mitfahrer aufteilen.

## Funktionen

Gestaltet nach Apples Human Interface Guidelines (Systemschrift, gruppierte Listen, Milchglas-Leisten, Hell/Dunkel).
Handy: Tab-Leiste unten · Tablet/Computer: Seitenleiste · Karte ein-/ausblendbar.

### Zwei Rollen

**Admin** (wer die Fahrgemeinschaft erstellt; Admin-Rechte lassen sich teilen) – volle Kontrolle:
- Ziel und Startadresse, **automatisch beste Abholreihenfolge** (Routenplaner), von Hand änderbar; Rückfahrt-Reihenfolge
- Auto, Spritpreis (live an der Strecke), Aufteilungsregel, Mitfahrer (auch ohne App), pausieren statt löschen
- Jeden Tag bearbeiten: wer fährt, anderer Fahrer, freier Tag
- Alle offenen Beträge, als bezahlt markieren, Nachricht/PayPal-Link kopieren
- **Mitglieder & Rechte** (Admin geben/nehmen, entfernen, neuer Einladungslink) und **Änderungsprotokoll** (wer hat was wann geändert)

**Mitfahrer** – einfach und geführt:
- Einstieg Schritt für Schritt: Wer bist du? → Abholadresse → Regelplan
- **Übersicht:** eigene Kosten, direkter **PayPal-Knopf** mit dem offenen Betrag, Preis pro Fahrt, nächste Fahrten (Hin & Zurück zu einem Tag zusammengefasst)
- **Fahrten:** eigener Regelplan; Farbkalender (jede Person eine Farbe, oben Hin / unten Zurück); Tag antippen → einzeln an-/absagen
- **Kosten:** offene Wochen, „Ich habe bezahlt“, „Wie berechnet?“ nur auf Wunsch
- Einstellung **Einfach / Detailliert** (Standard: einfach)

### Wie die App rechnet

- Wer an einem Tag fährt = **Regelplan** (gilt ab dem Tag der Änderung) + **einzelne Tagesänderungen** (die jüngere Änderung gewinnt)
- Route je Fahrt: Start des Fahrers → Abholadressen der Mitfahrer dieses Tages (in Abholreihenfolge) → Ziel; wer nicht mitfährt, wird nicht angefahren
- Jede Teilstrecke wird unter denen geteilt, die dort im Auto sitzen → man zahlt ab der eigenen Adresse
- Abgeschlossene Wochen werden mit ihren Werten (Preis, Verbrauch, Adressen) eingefroren; geplante Fahrten werden erst ab dem Tag fällig

## Fahrgemeinschaft mit Login

Technik: [Supabase](https://supabase.com) (Anmeldung, Datenbank, Live-Updates). Die Rechte werden auf dem Server durchgesetzt:
gemeinsame Daten ändern nur Admins; Mitfahrer schreiben nur ihr eigenes Profil (Adresse, Regelplan, Tage, „bezahlt“); das Protokoll lesen nur Admins.

Einrichtung einmalig: `supabase/setup.sql` im SQL Editor ausführen (bei Nachfrage „Run without RLS“ – das Skript schaltet RLS selbst ein)
und unter Authentication → Email „Confirm email“ ausschalten (der eingebaute Mailversand erreicht nur Mitglieder des Supabase-Teams).

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
index.html          Seite (Seitenleiste, Titelzeile, Ansicht, Karte, Tab-Leiste, Dialoge)
css/style.css       Gestaltung im Apple-Stil
js/app.js           Start, Navigation je Rolle, Karte, Strecke (Admin), Hintergrund-Berechnungen
js/view-home.js     Übersicht, Willkommen, geführte Einrichtung
js/view-trips.js    Regelplan, Farbkalender, Tag bearbeiten
js/view-costs.js    Kosten (einfach/detailliert), bezahlen
js/view-settings.js Profil, Ansicht, Mitfahrer, Mitglieder & Rechte, Protokoll
js/actions.js       Alle Änderungen: Rechte, Speicherort (Profil/gemeinsam), Protokoll
js/model.js         Datenmodell: Regelplan, Tage, Profile zusammenführen, Strecke je Fahrt (getestet)
js/derived.js       Berechnete Werte für die Ansichten
js/calc.js          Kosten & Aufteilung (getestet)
js/debts.js         Offene Beträge je Woche (getestet)
js/sync.js          Synchronisation mit Konfliktbehandlung (getestet)
js/account.js       Konto, Fahrgemeinschaft, Rollen, Profile
js/cloud.js         Supabase-Anbindung
js/pay.js           PayPal.me-Links und Nachrichten (getestet)
js/tab-fuel.js      Auto, Spritpreis, Tankstellen, beste Tankzeit
js/address.js       Adresssuche
js/map.js, api.js, state.js, icons.js, ui.js, version.js, example.js, fueltimes.js
supabase/setup.sql  Datenbank: Tabellen, Rollen, Zugriffsregeln, Funktionen
tests/              Tests (node --test)
```
