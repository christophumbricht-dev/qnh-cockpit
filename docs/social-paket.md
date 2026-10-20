# Beitragspaket – Format

Ein **Paket** ist ein Ordner oder eine `.zip`-Datei mit einer `post.json` und den Bildern bzw. Videos. Im Cockpit unter **Social → Paket importieren** auswählen (bei einem Ordner alle Dateien im Ordner markieren, oder die .zip).

Ein Paket wird **immer als Entwurf** angelegt. Freigeben bleibt dein eigener Klick im Cockpit.

Damit lassen sich Beiträge z. B. im Claude-Chat vorbereiten (Text, Hashtags, Bilder) und ohne Abtippen ins Cockpit übernehmen.

## Inhalt

```
mein-beitrag/
├── post.json
├── 1.jpg
└── 2.jpg
```

### post.json

```json
{
  "account": "downwind/instagram",
  "kind": "carousel",
  "caption": "Fünf Dinge, die dein Flugbuch für dich erledigt.\n\n1. Blockzeiten …",
  "first_comment": "#ppl #flugbuch #generalaviation",
  "alt": ["Startseite von Downwind", "Das Flugbuch mit 90-Tage-Anzeige"],
  "suggested_time": "2026-10-30T18:00",
  "media": ["1.jpg", "2.jpg"],
  "todo": "Am Vortag: Story mit Umfrage-Sticker
Nach dem Posten: @exploring_the_skies markieren"
}
```

| Feld | Pflicht | Bedeutung |
|---|---|---|
| `account` | ja | `app/plattform`, z. B. `downwind/instagram`, `secondseat/instagram`, `leesidelab/youtube`. Muss im Cockpit als Konto verbunden sein. |
| `title` | bei YouTube | Videotitel, höchstens 100 Zeichen. Bei YouTube ist `caption` die Beschreibung (höchstens 5000 Bytes; ab 15 Hashtags eine Warnung, bei mehr als 60 ignoriert YouTube alle). |
| `kind` | ja | `image` (ein Bild), `carousel` (2–10 Bilder/Videos), `reel` (ein Video), `story` (ein Bild oder Video) |
| `caption` | nein | Text, höchstens 2200 Zeichen, höchstens 30 Hashtags (ab 15 gibt es eine Warnung). Zeilenumbruch als `\n`. Bei Stories ignoriert. |
| `first_comment` | nein | Erster Kommentar nach dem Veröffentlichen (z. B. die Hashtags). Bei Stories ignoriert. |
| `alt` | nein | Alternativtext für Screenreader: ein Text für alle Bilder oder eine Liste in der Reihenfolge von `media`. Nur Bilder. |
| `suggested_time` | nein | Vorschlag für den Zeitpunkt. `2026-10-30T18:00` = **Schweizer Zeit**; mit Zeitzone (`2026-10-30T18:00:00+01:00`) wird diese genommen. Ohne Angabe: morgen 18:00. |
| `media` | ja | Dateinamen im Paket, in der gewünschten Reihenfolge. |
| `cover` | nein | Nur bei `reel`: Titelbild (JPEG) im Paket. |
| `todo` | nein | Was du selbst in der Instagram-App erledigen musst (Story mit Sticker, Personen markieren, Standort, Werbung …), Zeilen mit `
| `user_tags` | nein | Personen auf Bildern markieren: `[{ "media": 1, "username": "exploring_the_skies", "x": 0.5, "y": 0.9 }]`. `media` = Nummer der Datei in `media` (ab 1, Standard 1), `x`/`y` = Position 0–1 (Standard 0.5 / 0.9 = unten Mitte). Nur Bilder in `image`/`carousel`, höchstens 20 pro Bild. Im Editor beim Bild unter «Markieren» änderbar. |
| `location` | nein | Standort: Name eines Ortes aus der Ortsliste im Cockpit (`"Flugplatz Birrfeld"`) oder `{ "id": "<Facebook-Seiten-ID>", "name": "…" }`. Nur Bild, Karussell, Reel (nicht Story). Unbekannter Name → Import ohne Standort, mit Hinweis. |
`. Wird nicht veröffentlicht; im Cockpit als Kasten «Selbst in Instagram erledigen» gezeigt und dort änderbar – auch nach dem Freigeben/Veröffentlichen. Beiträge der nächsten 2 Tage erscheinen damit unter «Heute». «Nichts – fertig.» blendet den Kasten aus. Web-Adressen werden zu Links mit «kopieren» (für Link-Sticker); «Bild s1-beta» (Muster `Bild <buchstabe><ziffern>-<name>`) wird ein Link zum Story-Bild – der Import lädt `<name>.jpg` aus dem Paketordner oder aus `downwind/docs/instagram/out/jpg/` hoch. |

### Dateien

| Art | Format |
|---|---|
| Bild im Feed (`image`, `carousel`) | **JPEG**, höchstens 8 MB, Seitenverhältnis **4:5, 1:1 oder 1.91:1** (empfohlen 1080 × 1350) |
| Story-Bild | JPEG, **9:16** (1080 × 1920) |
| Reel | **MP4** (H.264, AAC), **9:16**, 3 Sekunden bis 15 Minuten |
| Story-Video | MP4, 9:16, 3–60 Sekunden |
| Video im Karussell | MP4, 3–60 Sekunden |
| alle | höchstens 50 MB pro Datei (Supabase-Gratisplan), Paket zusammen höchstens 200 MB |

Das Cockpit prüft alles beim Import und zeigt Fehler im Editor an. Ein Paket mit Fehlern wird trotzdem als Entwurf angelegt, damit du es dort korrigieren kannst – freigeben lässt es sich erst, wenn alles stimmt.

### YouTube (Short)

```json
{
  "account": "leesidelab/youtube",
  "kind": "reel",
  "title": "Föhn: why is it 23 °C in Altdorf while Ticino gets rain?",
  "caption": "Part 1 of 3 – how the Alps turn a rainy south wind into warm, dry gusts.\n\n#foehn #aviationweather #pilot",
  "first_comment": "Where have you felt Föhn? 👇",
  "suggested_time": "2026-10-23T18:00",
  "media": ["1.mp4"]
}
```
- Nur `kind: "reel"` (ein Video). Hochformat bis 3 Minuten wird ein **Short**.
- `cover` wird bei YouTube nicht verwendet (das Titelbild eines Shorts wählt man in der YouTube-App).
- Den ersten Kommentar schreibt das Cockpit nach dem Hochladen; **anpinnen** geht nur von Hand in YouTube.
- Für Instagram und YouTube je ein eigenes Paket (eigener Ordner), z. B. `…-nebel-1` und `…-nebel-1-yt`.

## Vorlage für den Claude-Chat

> Bereite einen Instagram-Beitrag für **Downwind** vor (Brand-Profil: `C:\Projects\downwind\docs\instagram\brand-profile.md`).
> Thema: … · Art: Karussell mit 3 Bildern · geplant für Donnerstag 18:00.
> Gib mir am Ende eine `post.json` im Format aus `C:\Projects\qnh-cockpit\docs\social-paket.md` und sag mir, welche Bilder ich als `1.jpg`, `2.jpg`, … in den Ordner legen soll.

## Automatisch importieren (Claude auf diesem PC)

Pakete im Ordner `pakete/` holt Claude selbst ins Cockpit – du musst nichts hochladen:

```
npm.cmd run social                 zeigt, was neu oder geändert ist (ändert nichts)
npm.cmd run social -- import       neue Pakete als Entwürfe anlegen, geänderte Entwürfe nachführen
npm.cmd run social -- import 2026-10-16-launch    nur dieses Paket (auch wenn der Zeitpunkt vorbei ist)
```

- Zeitpunkt = `suggested_time` aus dem Paket. Alles wird **Entwurf** – freigeben machst nur du (Social → **Freigabe-Runde**: ein Entwurf nach dem anderen prüfen, freigeben oder «Später freigeben»).
- Was schon importiert ist, merkt sich `pakete/.imported.json` (nur lokal). Eine `todo`-Notiz aus dem Paket kommt auch zu schon importierten (oder freigegebenen) Beiträgen, solange dort noch keine Notiz steht. Wird ein Paket später neu erstellt (z. B. besseres Bild), wird der Entwurf nachgeführt – aber **nicht**, wenn du ihn im Cockpit schon bearbeitet, freigegeben oder gelöscht hast.
- Pakete, die du früher von Hand importiert hast, werden am gleichen Text erkannt und nicht doppelt angelegt.
- Braucht die Anmeldung von `npm.cmd run roadmap -- login`.
- Zusätzlich läuft auf Christophs PC die Windows-Aufgabe **«QNH Social-Import»** (täglich 07:30 und beim Anmelden, `scripts/social-import-task.ps1`). Protokoll: `pakete/.import.log`. Abschalten: Windows-Taste → «Aufgabenplanung» → Aufgabe «QNH Social-Import» → Deaktivieren.
