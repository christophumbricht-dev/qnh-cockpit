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
