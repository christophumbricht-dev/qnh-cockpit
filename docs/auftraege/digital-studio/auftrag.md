# Auftrag: «Digital Studio», Abnahme mit Markern für alle Beiträge (Christoph, 28.10.2026)

**Ziel (Christoph):** Er schaut jeden Beitrag mit Bild oder Video höchstens zweimal an. Das gilt für alle Kanäle (Leeside Lab Instagram und YouTube, Downwind, Wolkenhof) und alle Formate (lange YouTube-Videos, Shorts, Instagram-Reels, Karussells, Bilder).

1. **Sichtung 1:** Christoph schaut im Cockpit den Beitrag mit allem Drum und Dran an und setzt Marker: Zeit oder Bild, Stelle im Bild, Text.
2. Der Chat, der den Beitrag gebaut hat, liest die Marker, setzt alle um und schreibt zu jedem Marker einen Satz, was er geändert hat.
3. **Sichtung 2:** Christoph prüft die Liste an der neuen Fassung und gibt frei. Diese Freigabe ist die normale Freigabe des Beitrags, kein zweiter Klick in der Freigabe-Runde.

Übliche Regeln: Commit nach jedem Punkt, kein Push, Migration nur schreiben, nichts deployen, keine Schlüssel im Repo (das Repo ist öffentlich). Videos und Studio-Pakete nie ins Git (wie `pakete/`). Am Ende eine kurze deutsche Zusammenfassung mit Testliste und Christophs To-do-Liste.

## D0: Zuerst klären, wo die langen Videos liegen (vor dem Bauen Christoph fragen)

Reels und Shorts sind klein und liegen nach dem Import schon im Speicher `social-media`. Das Studio spielt sie von dort, nur wenn Christoph auf Start drückt (wie die Handy-Vorschau heute).

Lange Videos passen nicht hinein: `social-media` nimmt höchstens 50 MB pro Datei, und der Gratis-Plan ist schon über dem Egress (Kulanz bis 25.11.2026, siehe Projektstand 25.10.). Ein 16-Minuten-Video in 1080p sprengt das. Optionen prüfen und Christoph in drei, vier Sätzen eine Empfehlung geben:

1. **Cloudflare R2** (Cloudflare-Konto ist vorhanden): kein Egress-Preis, grosse Dateien, läuft am PC und am iPhone. Zugriff nur mit signierter URL oder hinter Cloudflare Access, die Videos sind unveröffentlicht. Könnte später auch die Quelle für den YouTube-Upload der langen Dokus werden, die das gleiche 50-MB-Problem haben.
2. **Lokal am PC:** Video direkt aus `C:\QNH` im Browser öffnen (Dateiauswahl oder File System Access API). Keine Kosten, volle Qualität, aber nicht am iPhone.
3. **YouTube «nicht gelistet»** mit IFrame Player API: kein Speicherproblem, aber kein Schritt Bild für Bild und ein neuer Upload-Weg.

Vorschlag aus dem Leeside-Chat: 1, mit 2 als Rückfall. Christoph entscheidet.

## D1: Seite, Navigation und Wochenrunde

- Neue Seite «Digital Studio» (`#studio`, Code unter `src/studio/`). Desktop: eigener Eintrag in der Seitenleiste. Handy: über Social oder das Menü erreichbar, die untere Leiste nicht überfüllen.
- **Übersicht nach Woche und Kanal**, im Raster des Wochenplans (`WEEKPLAN` in `src/social/weekplan.js`): pro Beitrag Status «wartet auf Sichtung 1», «in Arbeit», «wartet auf Sichtung 2», «freigegeben» und die Zahl offener Marker. Filter nach Kanal.
- **Wochenrunde:** «Woche ansehen» spielt alle Beiträge der Woche nacheinander ab (Reels, Shorts, Karussells, dann lange Videos), damit Christoph eine ganze Woche in einer Sitzung sichtet.
- «Heute»: Eintrag «n Beiträge warten auf Sichtung» (Lane Heute).
- Freigabe-Runde: bei jedem Entwurf ein Knopf «Im Studio ansehen». Prüfen und Christoph vorschlagen, ob die Freigabe-Runde für Beiträge mit Medien ganz im Studio aufgehen soll, damit es nur einen Ort gibt.
- `?demo`: Beispiele für langes Video, Reel und Karussell mit Markern.

## D2: Abspielen und Steuern

- Player im Format des Beitrags: 16:9 für lange Videos, 9:16 für Reels und Shorts (am Desktop mit Platz für die Markerliste daneben, am Handy in voller Breite).
- **Leertaste:** Start und Pause.
- **Knöpfe unter dem Video:** zum Szenenanfang, 5 s zurück, Start/Pause, Stopp (Pause und zurück an den Anfang), 5 s vor, nächste Szene. Bei Reels ohne `scenes.json` springen die Szenenknöpfe zum Anfang und Ende.
- **Pfeil links/rechts:** 5 s zurück oder vor (bei Reels 1 s).
- **Komma/Punkt:** ein Bild zurück oder vor, nur in der Pause (Bildrate aus dem Paket, sonst 30 fps).
- **M:** Marker an der aktuellen Stelle. Das Video pausiert, das Textfeld bekommt den Fokus.
- Solange ein Textfeld den Fokus hat, steuern Tasten nichts (Leertaste schreibt ein Leerzeichen). Esc verlässt das Feld.
- Zeitleiste mit Szenengrenzen (Namen aus `scenes.json`) und Markern als Striche. Klick springt dorthin. Anzeige von Zeit (mm:ss.f) und Szene.
- **Karussells und Bilder:** Bildleiste mit allen Seiten. Pfeiltasten wechseln die Seite, M setzt einen Marker auf der aktuellen Seite.
- Am Handy dieselben Knöpfe und ein grosser Marker-Knopf.

## D3: Marker

- Ein Marker hat: Fassung, Zeit (Video) oder Seite (Karussell), Szene (`scene_id`) und Abstand zum Szenenanfang, optional eine Stelle im Bild (Klick ins pausierte Bild ergibt x/y in Prozent, als Kreis angezeigt), Kategorie (Bild, Ton, Text, Fakt, Sonstiges) und Text.
- Marker gibt es auch auf Texten: Caption, Titel, Beschreibung, erster Kommentar, Quiz-Antworten, Titelbild.
- Liste der Marker neben oder unter dem Beitrag, sortiert. Bearbeiten, löschen, Klick springt an die Stelle.
- Zusätzlich eine allgemeine Rückmeldung zum ganzen Beitrag.
- Knopf «Sichtung abschliessen» (pro Beitrag und für die ganze Wochenrunde): setzt auf «in Arbeit». Erst dann gelten die Marker für Claude.
- **Geltungsbereich:** Claude ordnet beim Erledigen jedem Marker zu, ob er nur diesen Beitrag betrifft, den ganzen Kanal oder alle Kanäle, und nennt die Regel, die daraus in `C:\QNH\03_Social\Abnahme-Regeln.md` geworden ist. Das Studio zeigt das als kleines Schild («Regel: alle Kanäle»). Christoph kann es ändern.

## D4: Das ganze Paket von Sichtung 1 an einem Ort

Neben dem Medium: Titel- und Thumbnail-Varianten (bei YouTube), Caption, Beschreibung mit Kapiteln, erster Kommentar, Shorts aus einem langen Video (kleine Player, ebenfalls markierbar), Termin und Kanal, und die Liste «Annahmen», in der Claude seine eigenen Kleinentscheide aufzählt. Christoph wählt dort Titel und Thumbnail aus.

## D5: Sichtung 2 und Freigabe

- Jede neue Fassung (neuer Import oder neues Studio-Paket) wird Fassung n+1 desselben Beitrags. Marker der alten Fassung werden über Szene und Abstand auf die neue Zeit umgerechnet (reine Funktion mit Unit-Tests; fehlt die Szene, deutlich «Szene entfernt»).
- Jeder Marker zeigt seinen Status («erledigt», «abgelehnt mit Grund», «offen») und Claudes Satz. Klick springt an die neue Stelle.
- Christoph setzt pro Marker «ok» oder «noch nicht».
- **«Freigeben»** im Studio ist die Freigabe des Social-Entwurfs, mit denselben Prüfungen wie in der Freigabe-Runde (Termin, Titel, erster Kommentar, KI-Info, Standort usw.). Gibt es noch keinen Entwurf (langes Video vor dem Import), merkt sich das Studio die Freigabe, und der Import übernimmt sie als Christophs Freigabe nur, wenn der Inhalt unverändert ist (gleicher Hash). Nichts gibt sich ohne Christophs Klick frei.
- Ist nach Sichtung 2 noch etwas «noch nicht», bekommt Christoph die nächste Fassung nur mit diesen Punkten zu sehen, nicht wieder alles.

## D6: Datenmodell (QNH Core, Migration nur schreiben)

- `studio_items`: ein Eintrag pro Beitrag in Abnahme. Kanal (z. B. `leesidelab/instagram`), Format (video_long, reel, short, carousel, image), Arbeitstitel, geplanter Tag, Status, aktuelle Fassung, optional `social_post_id`.
- `studio_versions`: Eintrag, Fassungsnummer, Medienquelle (Storage-Pfad, R2-Schlüssel oder lokal je nach D0), `scenes` (jsonb), fps, Dauer, `meta` (jsonb: Titel, Thumbnails, Caption, Beschreibung, Kapitel, Shorts, Annahmen), Inhalts-Hash, Zeitpunkt.
- `studio_markers`: Eintrag, Fassung, in der er gesetzt wurde, Zeit oder Seite, `scene_id`, Abstand, x, y, Ziel (medium, caption, title, …), Kategorie, Text, Status (offen, erledigt, abgelehnt, ok, noch nicht), Claudes Notiz, Geltungsbereich (post, channel, all) und Regeltext, Fassung der Erledigung, Zeitstempel.
- Nur Admins (`is_qnh_admin()`), wie Social. Tests mit PGlite wie `tests/db.test.mjs`.

## D7: Schnittstelle für die Chats (CLI wie `npm run social`)

`npm.cmd run studio -- …` (`scripts/studio.mjs`, Logik in `scripts/studio-lib.mjs`, Tests):

- `status [--kanal …]`: was auf Christoph wartet und was auf Claude.
- `markers <id oder paketordner> [--json]`: Marker der letzten abgeschlossenen Sichtung; schreibt sie zusätzlich als `review-v<n>.json` neben das Paket.
- `resolve <marker-id> "was geändert" [--regel all|channel|post "Regeltext"]` und `reject <marker-id> "warum"`.
- `upload <ordner>`: Studio-Paket für lange Videos (Format unten) als neue Fassung.
- Der bestehende Social-Import (`scripts/social-lib.mjs`) legt für jeden importierten oder ersetzten Entwurf mit Medien automatisch eine Studio-Fassung an. Die Video-Chats müssen dafür nichts Neues tun.

Neues Dokument `docs/studio-paket.md`. Für lange Videos ein Ordner `studio/<slug>/v<n>/` mit `video.mp4`, `scenes.json` (`[{ "id", "label", "start", "end" }]` in Sekunden, aus der Timeline des Renders), `meta.json` (`titles[]`, `thumbnails[]`, `description`, `chapters`, `shorts[]`, `assumptions[]`, `fps`) und den Bildern und Shorts daneben. Für Reels und Karussells reicht das normale Social-Paket; optional `scenes.json` und `assumptions` im Paket (in `docs/social-paket.md` ergänzen).

Nach dem Bau: Abschnitt «Digital Studio» in `CLAUDE.md` des Cockpits und die Zeile «Digital Studio» unter «Werkzeuge» in `C:\QNH\CLAUDE.md` nachführen.

## Test

- Demo mit langem Video, Reel und Karussell.
- Tasten: Leertaste im Textfeld pausiert nicht; M pausiert und öffnet das Feld; Karussell blättert mit den Pfeilen.
- Umrechnen der Marker von Fassung 1 auf 2 (Unit-Tests, auch «Szene entfernt»).
- Import legt Studio-Fassungen an; Freigabe im Studio setzt den Entwurf auf freigegeben mit denselben Prüfungen.
- CLI-Tests, `npm test` und Build grün.
- Nach Deploy durch Christoph: eine Wochenrunde am iPhone und am PC, je ein Reel und ein langes Video mit drei Markern, `markers` liest sie.
