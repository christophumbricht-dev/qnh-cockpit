# Instagram-Statistik

Das Cockpit holt **täglich um ca. 06:23** (Schweizer Zeit) die Zahlen aller verbundenen Instagram-Konten und speichert sie mit Datum – so entsteht ein Verlauf. Erfasst werden auch Beiträge, die nicht über das Cockpit gepostet wurden.

## Im Cockpit
**Social → Statistik**: pro Konto Follower (mit Veränderung), Reichweite, Views, Interaktionen, Link-Taps, Follower-Verlauf und alle Beiträge des Zeitraums. Spaltentitel antippen = danach sortieren (z. B. «Gespeichert»). Zeitraum 7 / 28 / 90 Tage. «Jetzt aktualisieren» holt die Zahlen sofort.

## Für Claude (Auswertung)
```
npm.cmd run social -- stats                         alle Konten, letzte 28 Tage, Tabelle
npm.cmd run social -- stats --app leesidelab --days 90
npm.cmd run social -- stats --json                  maschinenlesbar (für Auswertungen)
npm.cmd run social -- stats --refresh               vorher die heutigen Zahlen holen
```
JSON pro Konto: `followers`, `followers_change`, `totals` (reach, views, interactions, profile_links_taps), `follower_series` ([Tag, Follower]), `media` (pro Beitrag `metrics`: views, reach, likes, comments, saved, shares, total_interactions, follows, profile_visits; Reels zusätzlich `ig_reels_avg_watch_time` in ms; `via_cockpit`).

## Gut zu wissen
- Instagram liefert Zahlen mit **bis zu 48 h Verzögerung**; Beitragswerte sind Gesamtwerte seit Veröffentlichung (der tägliche Stand zeigt das Wachstum).
- **Ab 100 Followern** liefert Instagram mehr (u. a. Follower-Zu-/Abgänge, Zielgruppe). Darunter fehlen diese Werte einfach.
- Story-Zahlen gibt es nur, solange die Story online ist (24 h), und erst ab 5 Betrachtern.
- Instagram benennt Kennzahlen gelegentlich um. Nicht mehr verfügbare werden ausgelassen statt Fehler zu melden (`supabase/functions/social-publish/stats.ts`, Listen `MEDIA_METRICS` / `ACCOUNT_METRICS`).
- Voraussetzung: Berechtigung `instagram_business_manage_insights` im Token (docs/social-setup.md, Schritt 3) und Migration `20261019120000_social_stats.sql`.

## YouTube: Wiedergabezeit, Ø angesehen, Klickrate (YouTube Analytics)

Seit 24.10.2026 holt die Statistik pro YouTube-Kanal auch Zahlen aus der YouTube Analytics API: Wiedergabezeit (Stunden, letzte 28 Tage), Ø angesehen (Prozent eines Videos), Ø Sekunden pro Aufruf, neue Abonnenten, und wenn YouTube sie liefert, Impressionen und Klickrate der Vorschaubilder. Pro Video: Wiedergabe (Minuten), Ø angesehen, Klickrate seit dem Hochladen. YouTube Analytics hinkt etwa zwei Tage nach.

Dafür braucht es einmalig:
1. In Google Cloud (Projekt mit GOOGLE_CLIENT_ID) die «YouTube Analytics API» einschalten.
2. Im Cockpit pro YouTube-Kanal «YouTube verbinden» neu ausführen und alle Häkchen setzen (neue Berechtigung yt-analytics.readonly).

Fehlt eines davon, laufen die übrigen Zahlen weiter; der Lauf meldet dann einen Hinweis (`note`).

## Grafiken, Kosten pro Zuschauer, Ziel (seit 28.10.2026)

Pro Konto zeigt die Statistik drei Verläufe, je einen pro Diagramm, mit Wert beim Darüberfahren und «Als Tabelle»:
- Instagram: Follower, Aufrufe pro Tag, erreichte Konten pro Tag.
- YouTube: Abonnenten, Aufrufe pro Tag, Wiedergabezeit der letzten 28 Tage.

**Kosten und Nutzen:** Die laufenden Kosten aus Finanzen mit dem Bereich der App (zum Beispiel «leesidelab»), pro Monat, pro 1'000 Aufrufe und pro neuem Follower, auf 30 Tage gerechnet. Nur CHF wird eingerechnet, andere Währungen stehen daneben (keine Umrechnung). Gemeinsame QNH-Kosten zählen nicht mit.

**Ziel: Geld verdienen:** die offiziellen Schwellen, mit Prognose beim aktuellen Tempo (`src/social/growth.js`, Stand Oktober 2026).
- YouTube Etappe 1: 500 Abonnenten, 3 Uploads in 90 Tagen, dazu 3'000 Stunden lange Videos (12 Monate) oder 3 Mio. Shorts-Aufrufe (90 Tage).
- YouTube Werbeeinnahmen: 1'000 Abonnenten, dazu 4'000 Stunden oder 10 Mio. Shorts-Aufrufe. Für neue Bewerbungen ab 1.2.2027 sind es 8'000 Stunden.
- Instagram Geschenke: 500 Follower.

Die Stunden und Shorts-Aufrufe holt `stats.ts` täglich aus YouTube Analytics (`watch_minutes_long_365d`, `shorts_views_90d`, nach Inhaltsart getrennt).
