# QNH Cockpit – was es kann

Stand: 23. Oktober 2026 · Adresse: <https://cockpit.setqnh.ch> (am iPhone: Safari → Teilen → «Zum Home-Bildschirm») · Demo ohne Anmeldung: `?demo`

Das Cockpit ist die interne Schaltzentrale der QNH GmbH: Aufgaben, Apps, Social Media und Finanzen an einem Ort, am Laptop und am iPhone. Es ist eine reine Webseite (GitHub Pages); die Daten liegen in Supabase («QNH Core» und die Projekte der Apps). Nur Admin-Konten sehen etwas.

---

## 1. Heute
Die Startseite zeigt in drei Spuren, was ansteht:
- **Jetzt** – überfällig oder kaputt (z. B. Handgriffe nach einem veröffentlichten Beitrag, abgelaufene Tokens, fehlgeschlagene Builds)
- **Heute** – heute erledigen
- **Diese Woche** – kann warten

Dazu:
- **Kennzahlen-Kacheln** für Apps, Social, Kommentare und Finanzen.
- **«Als Nächstes»** mit dem wichtigsten Roadmap-Punkt (Erledigt / Morgen / Fokus-Runde).
- **«Diese Woche auf Sendung»** mit den geplanten Beiträgen.
- **Ausklappbare Checklisten:** Einträge mit Handgriffen («Nach dem Posten: …») öffnen sich per Klick. Abhaken geht direkt dort; sind alle Punkte erledigt, verschwindet der Eintrag.
- **Mini-iPhone:** Beim Aufklappen einer Social-Aufgabe zeigt ein kleines iPhone rechts daneben, um welchen Beitrag es geht (Bild bzw. Titelbild, Konto, Textanfang).

## 2. Aufgaben (Roadmap)
- **Board** pro Bereich (QNH, Downwind, SecondSeat …) mit den Spalten Ideen · Als Nächstes · In Arbeit · Erledigt. Karten lassen sich ziehen oder mit ‹ › verschieben.
- **Fälligkeiten und wiederkehrende Aufgaben** (z. B. vierteljährlich); «Morgen» verschiebt.
- **Fokus-Modus:** ein offener Task nach dem anderen (Erledigt ✓ · Ich fange an · Später).
- **Claude-Anbindung:** Claude trägt Entscheide aus den Chats ein und holt deine Einträge bei jeder Sitzung ab (`npm.cmd run roadmap -- pull|add|set`).

## 3. Apps
- **Downwind:** Übersicht mit Kennzahlen und Beta-Ziel (50 Piloten), Verlauf, Feedback, Fehler, Beta-Anmeldungen, Verifizierungen, Meldungen.
- **Store & Builds:** App-Store- und TestFlight-Status, Bewertungen, Tester, Codemagic-Builds. Eingebaut, aber noch nicht verbunden (Anleitung `docs/store-setup.md`).
- **SecondSeat:** Roadmap. Die App selbst ist offline und hat keinen Server.

## 4. Social Media
**Kanäle:** Instagram @fly_downwind, Instagram @leesidelab, YouTube Leeside Lab. Weitere Kanäle lassen sich hinzufügen, ebenso YouTube-Kanäle per Knopf.

**Beiträge**
- **Arten:** Bild, Karussell (2–10 Bilder/Videos), Reel, Story, YouTube Short (mit Titel und Beschreibung).
- **Zeitplan:** Beiträge gehen zur geplanten Zeit **automatisch** raus. Freigeben machst nur du. Nichts gibt sich selbst frei, und die Datenbank erzwingt das zusätzlich.
- **Editor:**
  - iPhone-Vorschau, durch Karussell-Bilder wischen, Videos mit Ton abspielen.
  - Erster Kommentar (z. B. Hashtags), Personen markieren (z. B. @exploring_the_skies), Standort aus der eigenen Ortsliste.
  - Prüfungen: Format, Textlänge, Hashtags, gleiche Bildgrösse im Karussell.
  - PNG-, WebP- und HEIC-Bilder werden beim Hochladen automatisch in JPEG umgewandelt (Instagram nimmt nur JPEG).
  - **KI-Info:** Schalter «mit KI erstellt» (z. B. KI-Stimme). Instagram zeigt dann «KI-Info» unter dem Namen; nach dem Veröffentlichen nicht mehr änderbar. Im Paket: `"ai": true`.
  - Wurde ein Beitrag inzwischen anderswo geändert (z. B. durch einen Paket-Import), speichert der Editor nicht darüber, sondern meldet es.
- **Freigabe-Runde:** alle Entwürfe der Reihe nach prüfen → «Freigeben» oder «Später freigeben».
- **Themen** (Seitenleiste unter «Alle Kanäle»): dieselben Beiträge, nach Thema gruppiert (z. B. «Föhn»: 3 Wetter-Reels, Unfall-Story, Technik-Reel, YouTube-Shorts), mit Übersicht «x von y freigegeben» und Freigabe-Runde pro Thema. Freigeben dort gilt überall – es ist derselbe Beitrag. Thema im Editor oder im Paket (`"topic"`); ohne Thema erkennt das Cockpit es aus «…, part 2/3».
- **Ansichten:** Liste (chronologisch) und Kalender (Beiträge per Ziehen verschieben).
- **Suchen und filtern:** Suchfeld (Text, Konto, Ort, #Hashtag, @markiert, Datum), Filter nach App (Logo-Chips), nach Plattform (Alle · Instagram · YouTube – gilt auch für die Freigabe-Runde) und nach Status (Zu prüfen, Entwürfe, Freigegeben, Veröffentlicht, Fehlgeschlagen, Offene Aufgaben, KI-Info).
- **Fehler:** verständliche Meldung mit Code; vor dem Senden wird geprüft, ob alle Dateien da sind. Knopf **«Erneut versuchen»** bei fehlgeschlagenen Beiträgen.
- **Doppelt-Schutz:** Ein Entwurf, der schon auf Instagram oder YouTube ist, wird rot markiert; vor dem Freigeben fragt das Cockpit nach.
- **«Selbst in Instagram erledigen»:** Handgriffe, die keine Schnittstelle kann (Sticker, Musik, Anpinnen, Story teilen). Das Cockpit zeigt sie als **Checkliste zum Abhaken**, mit «So geht's»-Anleitungen, Story-Bildern zum Herunterladen und «kopieren»-Knopf für Links.

**Beitragspakete (für Claude-Chats)**
- Ein Chat legt fertige Beiträge als Ordner ab (`post.json` + Bilder/Video).
- Der Import (`npm.cmd run social -- import`, zusätzlich **täglich 07:30** per Windows-Aufgabe) macht daraus Entwürfe.
- Geänderte Pakete aktualisieren unbearbeitete Entwürfe; deine Änderungen werden nie überschrieben.
- Format: `docs/social-paket.md`.

**Kommentare:** Kommentare unter deinen eigenen Instagram-Beiträgen und YouTube-Videos kommen alle 15 Minuten ins Cockpit. Dort kannst du antworten, ausblenden oder als erledigt ablegen. Gesendet wird nur per Klick.

**«Bei anderen»**
- Zweimal täglich schaut das Cockpit bei beobachteten Accounts und Hashtags vorbei, und Claude schlägt Kommentare vor – **in der Sprache des Beitrags**, freundlich, mit zwei Varianten.
- Claude lernt aus deinen zuletzt geposteten Kommentaren (inkl. deiner Änderungen).
- Knopf **«Kopieren & öffnen»** pro Variante (kopiert den Text und öffnet den Beitrag, am Handy in der Instagram-App), danach **«Gepostet ✓»**. «Auf Deutsch» übersetzt fremdsprachige Vorschläge.
- Du postest **selbst**. Das Cockpit liked, folgt und kommentiert nie.
- Kosten nach Verbrauch (Anthropic) mit Monatsbudget.

**Statistik**
- Täglich um ca. 06:23 werden die Zahlen geholt, getrennt pro Kanal (Instagram und YouTube je eine Karte), oder sofort mit «Jetzt aktualisieren».
- **Instagram:** Follower, Reichweite, Views, Interaktionen, Link-Taps, Follower-Verlauf; pro Beitrag Views, Reichweite, Likes, Kommentare, Speicherungen, Geteilt, neue Follower.
- **YouTube:** Abonnenten, Aufrufe gesamt, Videos; pro Short Aufrufe, Likes, Kommentare.
- Für Claude-Auswertungen: `npm.cmd run social -- stats [--json]`.

**Vertonung (ausserhalb des Cockpits)**
- Reels bekommen eine KI-Stimme (ElevenLabs): Werkzeug `tools/voice` im Leeside-Lab-Ordner (`npm.cmd run voice -- all <Ordner>`), Anleitung `docs/vertonung-anleitung.md` dort.
- Das Video wird so geschnitten, dass jede Szene so lange dauert, bis der Satz gesprochen ist; die Musik läuft gleichmässig leise darunter.
- Vertonte Reels kommen automatisch mit KI-Info ins Paket.

## 5. Finanzen
- **Fixkosten und Abos** mit Erneuerungs-Erinnerungen («Behalten» / rechtzeitig kündigen).
- **Rechnungen:**
  - QR-Rechnung aus PDF oder Foto lesen, Fälligkeiten, Beleg ablegen.
  - Bezahlt wird im E-Banking; das Cockpit speichert keine Kartendaten.
- **Vorgründung:** Privat bezahlte Belege zeigt das Cockpit unter **«Offen an Christoph»**; die GmbH zahlt sie nach der Gründung zurück. Import aus `C:\QNH\04_Finanzen\…\ausgaben.json`.
- **API-Verbrauch** (Anthropic) und CSV-Export.

## 6. Hangar
Schnellzugriff auf alle Werkzeuge: kDrive, Infomaniak, GitHub, Supabase, App Store Connect, Codemagic, Meta, Websites. Die Links lassen sich bearbeiten.

## 7. Allgemein
- **Suche** mit Ctrl+K: Seiten, Beiträge, Aufgaben, Links.
- Hell/Dunkel-Modus, Handy-Ansicht mit Leiste unten, App-Logos.
- **Sicherheit:**
  - Anmeldung per E-Mail, nur Admins.
  - Alle Schlüssel und Tokens liegen nur in Supabase (Vault/Secrets), nie im Code.
  - `npm run check:secrets` verhindert, dass Geheimes ins öffentliche Repository gelangt.

## 8. Was (noch) nicht automatisch geht
- **Instagram:** Sticker (Link, Umfrage, Quiz), Musik aus der Instagram-Bibliothek, Kommentar anpinnen, Story teilen, im Profil fixieren, Highlights. Dafür gibt es die Checklisten.
- **YouTube:** Kommentar anpinnen, Titelbild wählen.
- **Store & Builds:** wartet auf die Schlüssel (App Store Connect, Codemagic).
- **Geplant:**
  - TikTok für Leeside Lab
  - Reels direkt aus den Originalprojekten neu rendern (statt nur neu schneiden)
  - Cockpit als iPhone-App (nach der Gründung)
  - Eigener E-Mail-Versand über Infomaniak

---

**Anleitungen:** `social-setup.md` (Instagram/YouTube), `social-paket.md` (Pakete), `social-statistik.md`, `social-outreach.md` («Bei anderen»), `store-setup.md`, `finanzen.md`, `hosting.md`. Ordnerstruktur: `C:\QNH\LIESMICH.md`.
