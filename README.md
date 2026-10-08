# ⛽ Tankrechner – Fahrgemeinschaft fair teilen

Eine Website für Fahrgemeinschaften: Strecke mit Zwischenstopps planen, aktuelle Spritpreise an der Strecke holen, die beste Tankzeit sehen und die Kosten **fair** auf wechselnde Mitfahrer aufteilen.

## Funktionen

Ruhiges Design: Karten auf grauem Grund, große Titel, eine Akzentfarbe, Personen in ihren Farben, Hell/Dunkel.
Handy: drei Reiter unten · Tablet/Computer: Seitenleiste links. Alles Weitere öffnet sich als Fenster von unten (auf dem Computer mittig) – immer nur eines, nie verschachtelt.

### Aufbau: drei Bereiche

| Bereich | Frage | Inhalt |
|---|---|---|
| **Fahrten** | Was steht an? | Hinweise nur, wenn man etwas tun kann („Daniel fällt aus · Übernimmst du?“, Sperrung auf eurer Strecke, Umleitung); **nächste Fahrt** (Fahrer: Abfahrt und Abholzeiten, Mitfahrer: eigene Abholzeit mit **Dabei / Nicht dabei**); **nächste Tage** als Liste (Ferien als eine Zeile, Status mit einem Tipp umschalten, Tag antippen = Details); **Mein Plan** (Rhythmus, Abwesend) |
| **Geld** | Wer schuldet wem? | Ein Betrag oben, darunter ein Eintrag pro Person → Fenster mit **bezahlen** (PayPal), „Ich habe bezahlt“ bzw. **Abhaken** mit Zahlungsart, **Erinnern** per WhatsApp, Wochen und Fahrten; Bestätigen mit Ja/Nein; **Deine Kosten** diese/nächste Woche, **Fahrt ausrechnen**, Verlauf |
| **Gruppe** | Wer und wie? | Ich (Adresse, PayPal, „Ich kann auch fahren“), **Mitfahrer** (hinzufügen, Rhythmus, Abwesenheit, persönlich einladen), **Einladen**; **Fahrt**: Strecke, Uhrzeiten, Wer fährt, Fahrfrei; **Kosten**: Auto & Sprit, Aufteilung; Konto, Mitglieder & Rechte, Verlauf, Daten & Infos |

**Strecke** (aus „Gruppe“) ist die einzige Seite mit Karte: Hin-/Rückfahrt, Halte in Reihenfolge (Admins: „Ändern“ für Ziel, Start und Reihenfolge), Sperrungen mit Ausweichrouten, Baustellen.

### Allein anfangen, später gemeinsam

- **Platzhalter:** Mitfahrer legt man nur mit Namen an (Rhythmus wie der Fahrer, änderbar). Wer die App nicht hat, für den trägt der Fahrer Fahrten ein und hakt Zahlungen ab – auch ganz ohne Konto, nur auf dem eigenen Gerät.
- **Einladen:** Gruppenlink, kurzer **Code** zum Abtippen (z. B. `K7M-4Q2`) und **QR-Code**. Wer so beitritt, wählt bei **„Wer bist du?“** seinen Platz aus. Auf Wunsch gibt es einen **persönlichen Link** für genau einen Platz – dann fragt die App nur noch „Bist du Max?“.
- **Übernehmen:** Mit „Ja, das bin ich“ gehört der Platz der Person; alles Bisherige (Fahrten, Abrechnung, abgehakte Zahlungen) bleibt. Der Fahrer sieht unter „Gruppe“ „Max ist jetzt mit der App dabei“ mit **Passt** oder **Rückgängig** (entfernt das Konto, der Platz ist wieder frei).
- Der Fahrer darf auch nach der Übernahme Fahrten für andere ändern; die Person sieht es.

### Wer fährt wann?

Drei Bausteine – gleich für Schüler, Azubis und Arbeitnehmer, für Mitfahrer und Fahrer:
- **Rhythmus:** *Immer* (feste Wochentage, hin/zurück), *Bestimmte Wochen* (jede 2. Woche, z. B. Wechselschicht – oder Wochen antippen, z. B. Blockunterricht), *Nach Absprache* (kein fester Plan, jede Fahrt einzeln).
- **Abwesend:** Urlaub, krank, Praktikum von–bis. Wer abwesend ist, zahlt nichts. Ist der Fahrer abwesend, fallen seine Fahrten aus – wer fahren kann, wird unter „Fahrten“ gefragt: **„Übernimmst du?“**. Mit eigenem Auto rechnet die App an diesen Tagen mit dessen Verbrauch und Kraftstoff.
- **Fahrfreie Zeiten der Gruppe:** Schulferien und gesetzliche Feiertage (Bundesland, OpenHolidays) als Schalter, dazu eigene Zeiträume (z. B. Betriebsferien). Startwerte je Gruppenart: Schule/Ausbildung = Ferien + Feiertage, Arbeit = nur Feiertage.

Reihenfolge (die jüngere Angabe gewinnt): einzeln eingetragener Tag · Abwesenheit · fahrfreie Zeit · Rhythmus. Trägt sich jemand in den Ferien für einen Tag ein, fährt er.

**Wer fährt?** Immer dieselbe Person, je Wochentag oder wochenweise abwechselnd (gilt ab heute). Fahrer (in der Regel Admins) ändern die Daten der Gruppe und die Fahrten aller; Mitfahrer ihre eigenen.

### Einrichten

Eine Frage pro Bildschirm. Fahrer: Wohin fahrt ihr (Schule/Ausbildung, Arbeit, etwas anderes) · Ziel mit Ankunfts- und Rückfahrzeit · Name und Startadresse · Auto · Rhythmus · Mitfahrer (Namen). Mitfahrer: „Bist du Max?“ bzw. „Wer bist du?“ · Abholadresse · Rhythmus (vorausgefüllt) – fehlt nichts, geht es direkt los. Automatisch: Bundesland für Ferien/Feiertage, beste Abholreihenfolge, Abholzeiten, Rückfahrt umgekehrt.

### Unterwegs

- **Sperrungen umfahren:** Führt eure Route durch eine gemeldete Sperrung (Autobahn GmbH), steht oben unter „Fahrten“ ein roter Hinweis (nur für Admins und nur, wenn eure Route wirklich hindurchführt – geprüft wird Strecke und Fahrtrichtung). Auf „Strecke“: **„Ausweichroute wählen“** (Valhalla meidet die Sperrung, jede Variante wird als komplette Fahrt nachgerechnet) → Vorschlag antippen, Zeitraum prüfen → „Diese Route fahren“. Später: Zeitraum ändern, „Wieder normal“ oder ganz löschen. Mitfahrer sehen nur „Rückfahrt mit Umleitung über …“.
- **Fahrt ausrechnen** (unter „Geld“): Von, Nach, optional Zwischenstopps, hin und zurück, Kosten teilen durch n Personen → Strecke, Fahrzeit, Verbrauch, Sprit, Nebenkosten, Gesamt und pro Person. An der Abrechnung ändert sich nichts.

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
(6 Zeichen ohne Verwechsler); vorher funktionieren die alten, langen Codes weiter. Neue Codes gibt es danach über Gruppe → Einladen → „Neuen Code erstellen“.

**Passwort vergessen** (optional, braucht E-Mail-Versand):
1. Authentication → URL Configuration: „Site URL“ auf die Adresse der Seite setzen (z. B. `https://axor7.github.io/tankrechner/`) und dieselbe Adresse unter „Redirect URLs“ eintragen.
2. Authentication → Emails → SMTP Settings: einen eigenen Mailversand eintragen (z. B. kostenlos über Brevo oder Resend). Ohne eigenen Versand kommen die Mails nur bei Mitgliedern des Supabase-Teams an, höchstens ein paar pro Stunde.

Angemeldet kann man das Passwort jederzeit unter Gruppe → Konto → „Passwort ändern“ neu setzen.

## Starten

Es ist eine reine statische Website (HTML/CSS/JavaScript, keine Installation, kein Server-Code).
Wegen der JavaScript-Module muss sie über einen Webserver geöffnet werden, nicht per Doppelklick:

```bash
npm start            # startet http://localhost:8080
# oder
python3 -m http.server 8080
```

Veröffentlichen z. B. über GitHub Pages: Repository → Settings → Pages → „Deploy from a branch“ → `main` / `root`.

Welche Version geladen ist, steht unter Gruppe → Daten & Infos („Version vom …“ = Zeitpunkt der Veröffentlichung).
Ist inzwischen eine neuere Version online, erscheint oben „Neue Version verfügbar“ mit einem Knopf zum Neuladen.

### Live-Spritpreise

Für Live-Preise brauchst du einen kostenlosen API-Key von [Tankerkönig](https://onboarding.tankerkoenig.de/) und trägst ihn unter Gruppe → Auto & Sprit → „Automatisch“ ein.
Der Key wird nur in deinem Browser gespeichert. Ohne Key funktioniert alles mit einem manuell eingegebenen Preis.

## Daten & Datenschutz

Ohne Anmeldung liegen alle Daten (Personen, Fahrten, Einstellungen) nur im `localStorage` deines Browsers. In einer Fahrgemeinschaft liegen die gemeinsamen Daten in der Supabase-Datenbank; lesen und ändern können sie nur deren Mitglieder. Tankerkönig-Key und Messwerte bleiben immer auf dem Gerät.
Unter Gruppe → Daten & Infos kannst du sie als Datei sichern und wieder laden, z. B. um sie auf ein anderes Gerät zu übertragen.
Externe Dienste: OpenStreetMap (Karte), OSRM (Routing), Valhalla/FOSSGIS (Umleitungen um Sperrungen), Photon (Adresssuche), Tankerkönig (Preise), OpenHolidays (Schulferien, Feiertage), jsDelivr (QR-Code-Bibliothek), Autobahn GmbH des Bundes (Sperrungen & Baustellen, [verkehr.autobahn.de](https://verkehr.autobahn.de/o/autobahn/)).

Sperrungen auf Bundes-, Landes- und Kreisstraßen gibt es nicht als offene Echtzeitdaten. Der Routenplaner (OSRM) kennt nur Sperrungen, die in OpenStreetMap eingetragen sind (meist längere Baustellen) – für alles andere eine Umleitung eintragen.

## Tests

```bash
npm test
```

Testet die Rechenlogik (Kosten, Einzelfahrt, Teilstrecken-Aufteilung, Umleitungen, Rhythmus, Abwesenheit, fahrfreie Zeiten, Fahrer-Plan und Vertretung, Auto je Fahrer, Abholzeiten, Ausgleichszahlungen, Kalenderwochen, Tankzeiten) und das Auslesen/Zuordnen der Verkehrsmeldungen.

## Aufbau

Oberfläche und Logik sind getrennt: Die Bildschirme zeichnen nur und rufen Aktionen auf; gerechnet und gespeichert wird in den Logik-Modulen (diese sind getestet und unverändert datenkompatibel).

```
index.html            Gerüst: Seitenleiste, Bildschirm, Karte (nur „Strecke“), Reiter, ein Fenster
css/app.css           Gestaltung (Farben hell/dunkel, Bausteine, Fenster, Abläufe)
js/main.js            Start, Navigation, Zeichnen, Karte auf „Strecke“
js/kit.js             Bausteine: Kopf, Abschnitt, Liste, Zeile, Schalter, Segmente, Knöpfe, Hinweise, Personen-Kreise, Fenster
js/plan.js            Texte zu Tagen, Rhythmus, Abwesenheit, Abholzeiten, fehlende Fahrer
js/engine.js          Routen, Ausweichrouten, Sperrungen & Baustellen (inkl. „betrifft uns wirklich?“), Ferien laden, Daten sichern/laden
js/fuel.js            Spritpreis: Tankstellen an der Strecke, automatisch aktualisieren, beste Tankzeit
js/screens/rides.js   Fahrten: Hinweise, nächste Fahrt, nächste Tage; Fenster Tag, Rhythmus, Abwesend
js/screens/money.js   Geld: Betrag, pro Person (bezahlen, abhaken, erinnern), bestätigen, Kosten, Verlauf
js/screens/tripcalc.js Fahrt ausrechnen
js/screens/group.js   Gruppe: ich, Mitfahrer, Einladen, Fahrt, Kosten, Konto, Mitglieder, Verlauf, Daten & Infos
js/screens/route.js   Strecke: Hin/Rück, Sperrung & Umleitung, Halte und Reihenfolge, Baustellen
js/screens/start.js   Abläufe im Vollbild: Willkommen, Anmelden, Einrichten, „Bist du Max?“ / „Wer bist du?“, erste Angaben
js/actions.js         Alle Änderungen: Rechte, Speicherort (Profil/gemeinsam), Protokoll
js/model.js           Datenmodell: Rhythmus, Tage, Abwesenheit, fahrfreie Zeiten, Fahrer-Plan, Strecke je Fahrt (getestet)
js/derived.js         Berechnete Werte (Wochen, Beträge, Bestätigungen)
js/calc.js            Kosten & Aufteilung, Abholzeiten (getestet)
js/debts.js           Offene Beträge je Woche (getestet)
js/sync.js            Synchronisation mit Konfliktbehandlung (getestet)
js/account.js         Konto, Fahrgemeinschaft, Rollen, Einladungen, Platz übernehmen
js/cloud.js           Supabase-Anbindung
js/pay.js             PayPal.me-Links und Nachrichten (getestet)
js/detours.js         Ausweichrouten: Sperrung meiden (Valhalla), nachrechnen (OSRM), aussortieren (getestet)
js/traffic.js         Sperrungen & Baustellen (Autobahn GmbH): Zeiten, Strecke und Fahrtrichtung zuordnen (getestet)
js/qr.js, address.js, map.js, api.js, state.js, icons.js, ui.js, version.js, example.js, fueltimes.js
supabase/setup.sql    Datenbank: Tabellen, Rollen, Zugriffsregeln, Funktionen
tests/                Tests (node --test)
```
