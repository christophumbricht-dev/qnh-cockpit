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
  "media": ["1.jpg", "2.jpg"]
}
```

| Feld | Pflicht | Bedeutung |
|---|---|---|
| `account` | ja | `app/plattform`, z. B. `downwind/instagram`, `secondseat/instagram`. Muss im Cockpit als Konto verbunden sein. |
| `kind` | ja | `image` (ein Bild), `carousel` (2–10 Bilder/Videos), `reel` (ein Video), `story` (ein Bild oder Video) |
| `caption` | nein | Text, höchstens 2200 Zeichen, höchstens 30 Hashtags (ab 15 gibt es eine Warnung). Zeilenumbruch als `\n`. Bei Stories ignoriert. |
| `first_comment` | nein | Erster Kommentar nach dem Veröffentlichen (z. B. die Hashtags). Bei Stories ignoriert. |
| `alt` | nein | Alternativtext für Screenreader: ein Text für alle Bilder oder eine Liste in der Reihenfolge von `media`. Nur Bilder. |
| `suggested_time` | nein | Vorschlag für den Zeitpunkt. `2026-10-30T18:00` = **Schweizer Zeit**; mit Zeitzone (`2026-10-30T18:00:00+01:00`) wird diese genommen. Ohne Angabe: morgen 18:00. |
| `media` | ja | Dateinamen im Paket, in der gewünschten Reihenfolge. |
| `cover` | nein | Nur bei `reel`: Titelbild (JPEG) im Paket. |

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

## Vorlage für den Claude-Chat

> Bereite einen Instagram-Beitrag für **Downwind** vor (Brand-Profil: `C:\Projects\downwind\docs\instagram\brand-profile.md`).
> Thema: … · Art: Karussell mit 3 Bildern · geplant für Donnerstag 18:00.
> Gib mir am Ende eine `post.json` im Format aus `C:\Projects\qnh-cockpit\docs\social-paket.md` und sag mir, welche Bilder ich als `1.jpg`, `2.jpg`, … in den Ordner legen soll.
