# Cockpit online stellen: cockpit.setqnh.ch

Das Cockpit ist eine reine Webseite ohne eigenen Server. GitHub baut sie bei jeder Änderung automatisch und stellt sie gratis online (GitHub Pages). Deine Daten schützt nicht die versteckte Adresse, sondern die Datenbank: Nur Admin-Konten bekommen etwas zu sehen.

**Voraussetzung:** Die Domain `setqnh.ch` ist bei Infomaniak gekauft (siehe Anleitung der Website `C:\Projects\setqnh-website\docs\hosting-anleitung.md`).

**Kosten:** keine, solange das Repository öffentlich ist (siehe Schritt 1).

---

## Schritt 1 – Öffentlich oder privat? (Entscheid)

GitHub Pages ist im Gratis-Plan **nur für öffentliche Repositories** verfügbar. Für ein privates Repository mit Pages braucht es **GitHub Pro (kostet, ca. 4 USD pro Monat)**.

| Variante | Kosten | Was jemand sieht |
|---|---|---|
| **A – öffentliches Repository** (Empfehlung) | gratis | den Programmcode des Cockpits, **keine Daten, keine Schlüssel**. `npm run check:secrets` prüft bei jedem Build, dass nichts Geheimes drin ist. |
| B – privates Repository + GitHub Pro | ca. 4 USD/Monat | nichts |
| C – privates Repository + Cloudflare Pages | gratis | nichts, aber ein zusätzliches Konto bei Cloudflare und eine andere Anleitung |

Die folgenden Schritte gelten für **A** (bei B identisch, nur «Private» wählen).

## Schritt 2 – Repository anlegen (ca. 3 Min.)
1. [github.com/new](https://github.com/new) öffnen (angemeldet als **christophumbricht-dev**).
2. **Repository name:** `qnh-cockpit`
3. **Public** wählen.
4. **Nichts** ankreuzen (kein README, kein .gitignore, keine Lizenz) → **Create repository**.
5. Claude Bescheid geben. Claude lädt den Code hoch (`git push`). Der erste automatische Build schlägt fehl, bis Schritt 3 und 4 erledigt sind – das ist normal.

## Schritt 3 – Öffentliche Supabase-Werte hinterlegen (ca. 5 Min.)
Diese Werte sind **nicht geheim** (sie stehen ohnehin in jeder App), deshalb als *Variables*, nicht als *Secrets*.

1. Im Repository → **Settings** → links **Secrets and variables** → **Actions** → Reiter **Variables** → **New repository variable**.
2. Diese vier Variablen anlegen (Name genau so, Wert aus Supabase → Projekt → **Project Settings** → **API**: «Project URL» bzw. «anon public» / «publishable» key):

| Name | Wert |
|---|---|
| `VITE_DOWNWIND_SUPABASE_URL` | Project URL von **Downwind** |
| `VITE_DOWNWIND_SUPABASE_ANON_KEY` | anon/publishable key von **Downwind** |
| `VITE_QNH_SUPABASE_URL` | Project URL von **QNH Core** (sobald es das Projekt gibt, siehe `docs/social-setup.md`) |
| `VITE_QNH_SUPABASE_ANON_KEY` | anon/publishable key von **QNH Core** |

Niemals den **service_role** / **secret** key eintragen.
Solange QNH Core noch nicht existiert, die beiden QNH-Variablen einfach weglassen: Dann meldet sich das Cockpit zuerst bei Downwind an.

## Schritt 4 – GitHub Pages einschalten (ca. 3 Min.)
1. Im Repository → **Settings** → links **Pages**.
2. **Build and deployment → Source:** «**GitHub Actions**» wählen.
3. **Custom domain:** `cockpit.setqnh.ch` eintragen → **Save**.
4. Oben → **Actions** → den letzten Lauf «Deploy cockpit to GitHub Pages» öffnen → **Re-run all jobs**. Nach 1–2 Minuten ist er grün.

## Schritt 5 – Adresse bei Infomaniak eintragen (ca. 5 Min.)
1. [manager.infomaniak.com](https://manager.infomaniak.com) → **Domains** → `setqnh.ch` → **DNS-Zone** (bzw. «DNS verwalten»).
2. **Eintrag hinzufügen:**

| Typ | Name / Quelle | Ziel / Wert |
|---|---|---|
| CNAME | `cockpit` | `christophumbricht-dev.github.io.` |

3. Speichern. Kann bis zu ein paar Stunden dauern.
4. Zurück bei GitHub → Settings → Pages: Sobald «DNS check successful» erscheint, **Enforce HTTPS** ankreuzen. (Wenn das Häkchen grau ist: später nochmals schauen, das Zertifikat braucht etwas Zeit.)

## Schritt 6 – Adresse bei Supabase erlauben (ca. 3 Min. pro Projekt)
Für **jedes** Projekt, bei dem sich das Cockpit anmeldet (Downwind, später QNH Core):
1. [supabase.com/dashboard](https://supabase.com/dashboard) → Projekt öffnen → links **Authentication** → **URL Configuration**.
2. Bei **Redirect URLs** → **Add URL** → `https://cockpit.setqnh.ch` → **Save**.
3. Die **Site URL** nicht ändern (sie gehört der App).

Das Cockpit meldet sich mit dem 6-stelligen Code an, nicht über den Link in der E-Mail. Der Eintrag sorgt nur dafür, dass auch ein Klick auf den Link nicht ins Leere führt.

## Fertig – so prüfst du es
1. <https://cockpit.setqnh.ch> öffnen → es erscheint nur «QNH Cockpit – intern».
2. Mit deiner Admin-E-Mail anmelden → Code aus der E-Mail eingeben.
3. Auf dem iPhone in Safari: **Teilen** → **Zum Home-Bildschirm**.
4. Demo ohne Anmeldung: <https://cockpit.setqnh.ch/?demo>

## Wie es danach weitergeht
Jede Änderung, die Claude auf `main` hochlädt, ist nach 1–2 Minuten online. Schlägt ein Build fehl (rot unter **Actions**), bleibt die alte Version online – Claude den roten Schritt zeigen.
