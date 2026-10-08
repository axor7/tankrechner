# ⛽ Tankrechner – Spritkosten fair teilen

Eine Website für Fahrgemeinschaften: Strecke mit Zwischenstopps planen, aktuelle Spritpreise an der Strecke holen, die beste Tankzeit sehen und die Kosten **fair** auf wechselnde Mitfahrer aufteilen.

## Funktionen

Gestaltet nach Apples Human Interface Guidelines (Systemschrift, gruppierte Listen, Milchglas-Leisten, Hell/Dunkel).
Handy: Tab-Leiste unten · Tablet/Computer: Seitenleiste · Karte ein-/ausblendbar.

### Zwei Rollen

**Admin** (wer die Fahrgemeinschaft erstellt; Admin-Rechte lassen sich teilen) – volle Kontrolle:
- Ziel und Startadresse, **automatisch beste Abholreihenfolge** (Routenplaner), von Hand änderbar; Rückfahrt-Reihenfolge
- **Sperrungen umfahren:** Führt eure Route durch eine gemeldete Sperrung, zeigt die Strecken-Ansicht oben einen roten Hinweis mit **„Ausweichrouten anzeigen“**. Die Umfahrungen rechnet Valhalla (FOSSGIS) mit der Sperrung als verbotener Stelle, jede wird als komplette Fahrt nachgerechnet (genau diese km und Minuten zählen für die Kosten). Antippen, Zeitraum wählen (**gilt ab** – auch rückwirkend – und **gilt bis**, vorbelegt mit dem Zeitraum der Meldung, oder **ohne Enddatum**) → „Diese Route fahren“. Zeitraum später änderbar, Umleitung löschbar, „Normale Strecke“ = ab heute wieder normal.
- Auto, Spritpreis (live an der Strecke), Aufteilungsregel, Mitfahrer (auch ohne App); Entfernen wirkt erst ab heute, vergangene Fahrten bleiben in der Abrechnung
- Jeden Tag bearbeiten: wer fährt, anderer Fahrer, freier Tag
- **Schulferien** (Einstellungen, Standard: Thüringen): in den Ferien fährt nach Regelplan niemand; wer trotzdem fährt, trägt den Tag (oder die KW) selbst ein. Termine von der OpenHolidays API, gilt ab dem Einschalten
- **Ganze Woche auf einmal:** im Kalender auf die KW tippen → je Person „Regelplan / Ganze Woche / Gar nicht“
- **Prognose** für die kommenden Wochen: Gesamtkosten und Anteil jeder Person, die in der Woche mitfährt
- Alle offenen Beträge, als bezahlt markieren, Nachricht/PayPal-Link kopieren
- **Mitglieder & Rechte** (Admin geben/nehmen, entfernen, neuer Einladungslink) und **Änderungsprotokoll** (wer hat was wann geändert)

**Mitfahrer** – einfach und geführt:
- Einstieg Schritt für Schritt: Wer bist du? → Abholadresse → Regelplan
- **Übersicht:** eigene Kosten, direkter **PayPal-Knopf** mit dem offenen Betrag, Preis pro Fahrt, nächste Fahrten (Hin & Zurück zu einem Tag zusammengefasst)
- **Fahrten:** eigener Regelplan; Farbkalender (jede Person eine Farbe, oben Hin / unten Zurück); Tag antippen → einzeln an-/absagen; KW antippen → ganze Woche
- **Strecke:** Karte mit **Hin- und Rückfahrt** (umschaltbar), Abholreihenfolge, eigene Abholadresse ändern (auch auf der Karte)
- **Sperrungen & Baustellen** auf der Strecke (Autobahnen, Daten der Autobahn GmbH): antippen zeigt, was gilt und wie lange noch; die gewählte Umleitung sieht jeder
- **Einzelfahrt berechnen** (Strecke → Einzelfahrt, auch von der Übersicht): Ziel eingeben oder auf der Karte antippen, optional Zwischenstopps, hin und zurück, Kosten teilen durch n Personen → Strecke, Fahrzeit, Verbrauch in Litern, Sprit, Nebenkosten, Gesamt und pro Person. Verbrauch/Preis lassen sich dafür anpassen; an der Abrechnung ändert sich nichts
- **Kosten:** offene Wochen, „Ich habe bezahlt“, „Wie berechnet?“ nur auf Wunsch, Prognose der eigenen Kosten für die kommenden Wochen
- **Zahlung bestätigen:** Wer „Ich habe bezahlt“ meldet, wartet auf den Empfänger. Der sieht oben „Anna hat dir 24,32 € bezahlt – angekommen? Ja / Nein“. Erst nach „Ja“ gilt die Woche als bezahlt, bei „Nein“ ist sie wieder offen und der Zahler bekommt einen Hinweis. (Hat der Empfänger kein Konto, bestätigt ein Admin.)
- Einstellung **Einfach / Detailliert** (Standard: einfach)

### Wie die App rechnet

- Wer an einem Tag fährt = **Regelplan** (gilt ab dem Tag der Änderung) + **einzelne Tagesänderungen** (die jüngere Änderung gewinnt)
- Route je Fahrt: Start des Fahrers → Abholadressen der Mitfahrer dieses Tages (in Abholreihenfolge) → Ziel; wer nicht mitfährt, wird nicht angefahren
- Jede Teilstrecke wird unter denen geteilt, die dort im Auto sitzen → man zahlt ab der eigenen Adresse
- Jede Woche wird nur unter denen aufgeteilt, die in dieser Woche wirklich mitgefahren sind
- Umleitungen sind ein zusätzlicher Wegpunkt (mit Fahrtrichtung); den Umweg zahlen die, die auf diesem Stück im Auto sitzen. Sie gelten nur im gewählten Zeitraum und in ihrer Richtung – bewusst auch rückwirkend, dann werden die Fahrten dieser Tage neu berechnet
- Nichts wirkt rückwirkend: Regelplan, Fahrerwechsel und Entfernen gelten ab heute; abgeschlossene Wochen werden mit ihren Werten (Preis, Verbrauch, Adressen, Aufteilungsregel) eingefroren; geplante Fahrten werden erst ab dem Tag fällig

## Fahrgemeinschaft mit Login

Technik: [Supabase](https://supabase.com) (Anmeldung, Datenbank, Live-Updates). Die Rechte werden auf dem Server durchgesetzt:
gemeinsame Daten ändern nur Admins; Mitfahrer schreiben nur ihr eigenes Profil (Adresse, Regelplan, Tage, „bezahlt“); das Protokoll lesen nur Admins.

Einrichtung einmalig: `supabase/setup.sql` im SQL Editor ausführen (bei Nachfrage „Run without RLS“ – das Skript schaltet RLS selbst ein)
und unter Authentication → Email „Confirm email“ ausschalten (der eingebaute Mailversand erreicht nur Mitglieder des Supabase-Teams).

**Passwort vergessen** (optional, braucht E-Mail-Versand):
1. Authentication → URL Configuration: „Site URL“ auf die Adresse der Seite setzen (z. B. `https://axor7.github.io/tankrechner/`) und dieselbe Adresse unter „Redirect URLs“ eintragen.
2. Authentication → Emails → SMTP Settings: einen eigenen Mailversand eintragen (z. B. kostenlos über Brevo oder Resend). Ohne eigenen Versand kommen die Mails nur bei Mitgliedern des Supabase-Teams an, höchstens ein paar pro Stunde.

Angemeldet kann man das Passwort jederzeit im Konto-Dialog unter „Passwort ändern“ neu setzen.

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
Externe Dienste: OpenStreetMap (Karte), OSRM (Routing), Valhalla/FOSSGIS (Umleitungen um Sperrungen), Photon (Adresssuche), Tankerkönig (Preise), OpenHolidays (Schulferien), Autobahn GmbH des Bundes (Sperrungen & Baustellen, [verkehr.autobahn.de](https://verkehr.autobahn.de/o/autobahn/)).

Sperrungen auf Bundes-, Landes- und Kreisstraßen gibt es nicht als offene Echtzeitdaten. Der Routenplaner (OSRM) kennt nur Sperrungen, die in OpenStreetMap eingetragen sind (meist längere Baustellen) – für alles andere eine Umleitung eintragen.

## Tests

```bash
npm test
```

Testet die Rechenlogik (Kosten, Einzelfahrt, Teilstrecken-Aufteilung, Umleitungen, Ausgleichszahlungen, Kalenderwochen, Tankzeiten) und das Auslesen/Zuordnen der Verkehrsmeldungen.

## Aufbau

```
index.html          Seite (Seitenleiste, Titelzeile, Ansicht, Karte, Tab-Leiste, Dialoge)
css/style.css       Gestaltung im Apple-Stil
js/app.js           Start, Navigation je Rolle, Karte (Hin/Rück), Routen, Verkehrsmeldungen laden, Hintergrund-Berechnungen
js/view-home.js     Übersicht, Willkommen, geführte Einrichtung
js/view-trips.js    Regelplan, Farbkalender, Tag / ganze Woche bearbeiten
js/view-route.js    Strecke: Hin-/Rückfahrt, Sperrungen & Baustellen, Umleitungen, Ziel/Start/Reihenfolge
js/view-single.js   Einzelfahrt berechnen (Verbrauch, Kosten, pro Person)
js/view-costs.js    Kosten (einfach/detailliert), bezahlen, Prognose
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
js/detours.js       Ausweichrouten: Sperrung meiden (Valhalla), nachrechnen (OSRM), Feldwege/Wenden aussortieren (getestet)
js/traffic.js       Sperrungen & Baustellen (Autobahn GmbH): Zeiten auslesen, der Strecke und Fahrtrichtung zuordnen (getestet)
js/tab-fuel.js      Auto, Spritpreis, Tankstellen, beste Tankzeit
js/address.js       Adresssuche
js/map.js, api.js, state.js, icons.js, ui.js, version.js, example.js, fueltimes.js
supabase/setup.sql  Datenbank: Tabellen, Rollen, Zugriffsregeln, Funktionen
tests/              Tests (node --test)
```
