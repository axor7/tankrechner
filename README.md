# ⛽ Tankrechner – Fahrgemeinschaft fair teilen

Eine Website für Fahrgemeinschaften: Strecke mit Zwischenstopps planen, aktuelle Spritpreise an der Strecke holen, die beste Tankzeit sehen und die Kosten **fair** auf wechselnde Mitfahrer aufteilen.

## Funktionen

Gestaltet nach Apples Human Interface Guidelines (Systemschrift, gruppierte Listen, Milchglas-Leisten, Hell/Dunkel).
Handy: Tab-Leiste unten · Tablet/Computer: Seitenleiste · Karte ein-/ausblendbar.

### Aufbau: vier Reiter, vier Fragen

| Reiter | Frage | Inhalt |
|---|---|---|
| **Heute** | Was passiert als Nächstes? | Nächste Fahrt mit **Abholzeit** (rückwärts von der Ankunftszeit gerechnet), **Ich fahre mit / Nicht dabei** mit einem Tipp, „Übernimmst du?“, höchstens zwei Hinweise (Umleitung, Ferien, eigene Abwesenheit), offener Betrag |
| **Plan** | Wer fährt wann? | Woche als Liste (Monat als Farbkalender), Tag antippen = ändern, ganze Woche auf einmal; **Rhythmus**, **Abwesend**, Plan der anderen; fahrfreie Zeiten und „Wer fährt?“ |
| **Geld** | Wer schuldet wem? | Ein Betrag pro Person: bezahlen (PayPal), „Ich habe bezahlt“ → Empfänger bestätigt; **Abhaken** mit Zahlungsart (bar, PayPal, Überweisung), **Erinnern** per WhatsApp mit fertigem Text; Verlauf, Prognose, alle Zahlen auf Wunsch |
| **Karte** | Wie fahren wir? | Hin-/Rückfahrt, Sperrungen & Umleitungen, Abholreihenfolge; von hier: **Einzelfahrt berechnen**, Spritpreis & Tankstellen |

**Profilbild oben rechts** (auf dem Computer unten in der Seitenleiste): eigene Adresse, PayPal, „Ich kann auch fahren“ mit eigenem Auto; die Gruppe (Leute einladen, Mitfahrer, Wer fährt?, Uhrzeiten, fahrfreie Zeiten, Auto & Spritpreis, Kostenregel, Mitglieder & Rechte, Verlauf), Konto und Daten.
**Plus-Knopf**: Einzelfahrt berechnen, Abwesend eintragen, einen Tag ändern, Leute einladen.

### Allein anfangen, später gemeinsam

- **Platzhalter:** Mitfahrer legt man nur mit Namen an (Rhythmus wie der Fahrer, änderbar). Wer die App nicht hat, für den trägt der Fahrer Fahrten ein und hakt Zahlungen ab – auch ganz ohne Konto, nur auf dem eigenen Gerät.
- **Einladen:** Gruppenlink, kurzer **Code** zum Abtippen (z. B. `K7M-4Q2`) und **QR-Code**. Wer so beitritt, wählt bei **„Wer bist du?“** seinen Platz aus. Auf Wunsch gibt es einen **persönlichen Link** für genau einen Platz – dann fragt die App nur noch „Bist du Max?“.
- **Übernehmen:** Mit „Ja, das bin ich“ gehört der Platz der Person; alles Bisherige (Fahrten, Abrechnung, abgehakte Zahlungen) bleibt. Der Fahrer sieht auf „Heute“ „Max ist jetzt mit der App dabei“ mit **Passt** oder **Rückgängig** (entfernt das Konto, der Platz ist wieder frei).
- Der Fahrer darf auch nach der Übernahme Fahrten für andere ändern; die Person sieht es.

### Wer fährt wann?

Drei Bausteine – gleich für Schüler, Azubis und Arbeitnehmer, für Mitfahrer und Fahrer:
- **Rhythmus:** *Immer* (feste Wochentage, hin/zurück), *Bestimmte Wochen* (jede 2. Woche, z. B. Wechselschicht – oder Wochen antippen, z. B. Blockunterricht), *Nach Absprache* (kein fester Plan, jede Fahrt einzeln).
- **Abwesend:** Urlaub, krank, Praktikum von–bis. Wer abwesend ist, zahlt nichts. Ist der Fahrer abwesend, fallen seine Fahrten aus – wer fahren kann, wird auf „Heute“ gefragt: **„Übernimmst du?“**. Mit eigenem Auto rechnet die App an diesen Tagen mit dessen Verbrauch und Kraftstoff.
- **Fahrfreie Zeiten der Gruppe:** Schulferien und gesetzliche Feiertage (Bundesland, OpenHolidays) als Schalter, dazu eigene Zeiträume (z. B. Betriebsferien). Startwerte je Gruppenart: Schule/Ausbildung = Ferien + Feiertage, Arbeit = nur Feiertage.

Reihenfolge (die jüngere Angabe gewinnt): einzeln eingetragener Tag · Abwesenheit · fahrfreie Zeit · Rhythmus. Trägt sich jemand in den Ferien für einen Tag ein, fährt er.

**Wer fährt?** Immer dieselbe Person, je Wochentag oder wochenweise abwechselnd (gilt ab heute). Fahrer (in der Regel Admins) ändern die Daten der Gruppe und die Fahrten aller; Mitfahrer ihre eigenen.

### Einrichten

Gründer: Wofür (Schule/Ausbildung, Arbeit, Sonstiges) und wohin, mit Ankunfts- und Rückfahrzeit · Name und Startadresse · Auto · Rhythmus · Mitfahrer (Namen). Mitfahrer: „Das bin ich“ · Abholadresse · Rhythmus (vorausgefüllt). Automatisch: Bundesland für Ferien/Feiertage, beste Abholreihenfolge, Abholzeiten, Rückfahrt umgekehrt.

### Unterwegs

- **Sperrungen umfahren:** Führt eure Route durch eine gemeldete Sperrung (Autobahn GmbH), zeigt die Karte oben einen roten Hinweis mit **„Ausweichrouten anzeigen“** (Valhalla meidet die Sperrung, jede Variante wird als komplette Fahrt nachgerechnet). Antippen, Zeitraum wählen → „Diese Route fahren“.
- **Einzelfahrt berechnen:** Ziel eingeben oder auf der Karte antippen, optional Zwischenstopps, hin und zurück, Kosten teilen durch n Personen → Strecke, Fahrzeit, Verbrauch, Sprit, Nebenkosten, Gesamt und pro Person. An der Abrechnung ändert sich nichts.

### Wie die App rechnet

- Route je Fahrt: Start des Fahrers → Abholadressen der Mitfahrer dieses Tages (in Abholreihenfolge) → Ziel; wer nicht mitfährt, wird nicht angefahren
- Jede Teilstrecke wird unter denen geteilt, die dort im Auto sitzen → man zahlt ab der eigenen Adresse
- Jede Woche wird nur unter denen aufgeteilt, die in dieser Woche wirklich mitgefahren sind
- Verbrauch und Kraftstoff: vom Auto des Fahrers dieser Fahrt (eigenes Auto, sonst das der Gruppe); Preis je Kraftstoff von den Tankstellen an der Strecke
- Umleitungen sind ein zusätzlicher Wegpunkt (mit Fahrtrichtung); den Umweg zahlen die, die auf diesem Stück im Auto sitzen – bewusst auch rückwirkend für den gewählten Zeitraum
- Nichts sonst wirkt rückwirkend: Rhythmus, Fahrer-Plan und Entfernen gelten ab heute; abgeschlossene Wochen werden mit ihren Werten eingefroren; geplante Fahrten werden erst ab dem Tag fällig

## Fahrgemeinschaft mit Login

Technik: [Supabase](https://supabase.com) (Anmeldung, Datenbank, Live-Updates). Die Rechte werden auf dem Server durchgesetzt:
gemeinsame Daten ändern nur Admins (in der Regel die Fahrer); Mitfahrer schreiben nur ihr eigenes Profil (Adresse, Rhythmus, Tage, Abwesenheiten, „ich fahre“ als Vertretung, eigenes Auto, „bezahlt“); den Verlauf lesen nur Admins.

Einrichtung einmalig: `supabase/setup.sql` im SQL Editor ausführen (bei Nachfrage „Run without RLS“ – das Skript schaltet RLS selbst ein)
und unter Authentication → Email „Confirm email“ ausschalten (der eingebaute Mailversand erreicht nur Mitglieder des Supabase-Teams).
Nach einem Update das Skript einfach erneut ausführen (es ist gefahrlos wiederholbar) – seit Etappe 1 nötig für die **kurzen Einladungscodes**
(6 Zeichen ohne Verwechsler); vorher funktionieren die alten, langen Codes weiter. Neue Codes gibt es danach über „Neuen Link und Code erstellen“.

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
Externe Dienste: OpenStreetMap (Karte), OSRM (Routing), Valhalla/FOSSGIS (Umleitungen um Sperrungen), Photon (Adresssuche), Tankerkönig (Preise), OpenHolidays (Schulferien, Feiertage), jsDelivr (QR-Code-Bibliothek), Autobahn GmbH des Bundes (Sperrungen & Baustellen, [verkehr.autobahn.de](https://verkehr.autobahn.de/o/autobahn/)).

Sperrungen auf Bundes-, Landes- und Kreisstraßen gibt es nicht als offene Echtzeitdaten. Der Routenplaner (OSRM) kennt nur Sperrungen, die in OpenStreetMap eingetragen sind (meist längere Baustellen) – für alles andere eine Umleitung eintragen.

## Tests

```bash
npm test
```

Testet die Rechenlogik (Kosten, Einzelfahrt, Teilstrecken-Aufteilung, Umleitungen, Rhythmus, Abwesenheit, fahrfreie Zeiten, Fahrer-Plan und Vertretung, Auto je Fahrer, Abholzeiten, Ausgleichszahlungen, Kalenderwochen, Tankzeiten) und das Auslesen/Zuordnen der Verkehrsmeldungen.

## Aufbau

```
index.html          Seite (Seitenleiste, Titelzeile, Ansicht, Karte, Tab-Leiste, Dialoge)
css/style.css       Gestaltung im Apple-Stil
js/app.js           Start, Navigation je Rolle, Karte (Hin/Rück), Routen, Verkehrsmeldungen laden, Hintergrund-Berechnungen
js/view-home.js     Heute: nächste Fahrt mit Abholzeiten, Absagen, Vertretung, Hinweise; Willkommen, Einrichtung, „Wer bist du?“
js/view-trips.js    Plan: Woche/Monat, Tag, ganze Woche, Rhythmus, Abwesenheit, fahrfreie Zeiten, Wer fährt?, Auto je Fahrer
js/view-costs.js    Geld: ein Betrag pro Person, bezahlen, bestätigen, abhaken, erinnern, Prognose, alle Zahlen
js/view-route.js    Karte: Hin-/Rückfahrt, Sperrungen & Baustellen, Umleitungen, Ziel/Start/Reihenfolge
js/view-single.js   Einzelfahrt berechnen (Verbrauch, Kosten, pro Person)
js/view-settings.js Profil & Gruppe: ich, Einladen (Link, Code, QR, persönlich), Mitfahrer, Mitglieder & Rechte, Verlauf, Konto
js/sheets.js        Fenster von unten (Tag, Rhythmus, Abwesenheit, Einladen …)
js/people.js        Personen-Kreise, „ohne App“, Texte zu Rhythmus und Abwesenheit
js/qr.js            QR-Code für Einladungen
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
