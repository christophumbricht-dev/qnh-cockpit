# Store & Builds einrichten (App Store Connect + Codemagic)

Der Reiter **Store & Builds** bei jeder App zeigt dir TestFlight-Builds, den Status der App-Store-Version, Bewertungen, die Zahl der TestFlight-Tester und die letzten Codemagic-Builds. Fehlgeschlagene Builds und neue Bewertungen erscheinen ausserdem unter «Heute».

Dafür braucht es zwei geheime Schlüssel. Sie kommen **nur** als «Secrets» in die Supabase-Funktion `store-status` (Projekt QNH Core) – nie ins Cockpit, nie in GitHub, nie in den Chat.

Dauer: etwa 20 Minuten. Du kannst auch nur einen Teil machen: Was fehlt, zeigt das Cockpit als «noch nicht verbunden».

---

## Teil 1 – Funktion installieren (einmalig)

1. Windows-Taste → **PowerShell** öffnen.
2. Eintippen und Enter:
   ```
   cd C:\Projects\qnh-cockpit
   ```
3. Dann (falls du seit dem Social-Setup abgemeldet bist, zuerst `npx.cmd supabase login`):
   ```
   npx.cmd supabase functions deploy store-status --project-ref ermlfcvlaxaruhxczfek
   ```
4. Am Schluss steht «Deployed Functions … store-status». Fertig.

Ab jetzt zeigt das Cockpit im Reiter **Downwind → Store & Builds** schon die öffentliche App-Store-Bewertung (sobald die App im Store ist) und den Hinweis, was noch nicht verbunden ist.

---

## Teil 2 – App Store Connect API-Schlüssel

1. **appstoreconnect.apple.com** öffnen und anmelden.
2. Oben **Benutzer und Zugriff** anklicken.
3. Oben den Reiter **Integrationen** wählen, links **App Store Connect API**.
4. Beim ersten Mal steht dort «Zugriff anfordern» – anklicken und bestätigen (geht nur als Account Holder, also du).
5. Reiter **Team-Schlüssel** → blaues **+** (oder «API-Schlüssel generieren»).
   - Name: `QNH Cockpit`
   - Zugriff: **App-Manager** (braucht es, damit auch Bewertungen lesbar sind. Das Cockpit liest nur, es ändert nichts.)
   - **Generieren**.
6. Jetzt siehst du drei Dinge – alle drei brauchst du gleich:
   - **Issuer-ID** (oben über der Tabelle, lange Zeichenkette mit Bindestrichen) → «Kopieren».
   - **Schlüssel-ID** (in der Zeile von «QNH Cockpit», 10 Zeichen).
   - **API-Schlüssel herunterladen** (in derselben Zeile). ⚠️ Das geht **nur ein einziges Mal**. Die Datei heisst `AuthKey_XXXXXXXXXX.p8` und landet in «Downloads».
7. Die `.p8`-Datei gut aufbewahren (z. B. in kDrive im Ordner «Schlüssel», nicht in einem Projektordner).

## Teil 3 – Codemagic-Token

1. **codemagic.io** öffnen und anmelden.
2. Links unten auf dein Profil / **Teams** → **Personal Account** (bzw. das Team, in dem Downwind liegt).
3. **Integrations** → bei **Codemagic API** auf **Show** klicken.
4. Den angezeigten Token **kopieren**.

## Teil 4 – Secrets in Supabase eintragen

1. **supabase.com/dashboard** → Projekt **QNH Core** öffnen.
2. Links **Edge Functions** → oben **Secrets** (bzw. «Manage secrets»).
3. Vier Einträge hinzufügen (Name genau so, gross geschrieben):

   | Name | Wert |
   |---|---|
   | `ASC_ISSUER_ID` | die Issuer-ID aus Teil 2 |
   | `ASC_KEY_ID` | die Schlüssel-ID aus Teil 2 |
   | `ASC_PRIVATE_KEY` | Inhalt der `.p8`-Datei: Rechtsklick auf die Datei → **Öffnen mit → Editor**, dann **Ctrl+A**, **Ctrl+C** und ins Feld einfügen (inklusive der Zeilen `-----BEGIN PRIVATE KEY-----` und `-----END PRIVATE KEY-----`) |
   | `CODEMAGIC_TOKEN` | der Token aus Teil 3 |

4. **Save** / **Bulk save**.

## Teil 5 – Prüfen

1. **cockpit.setqnh.ch** → **Downwind** → Reiter **Store & Builds** → **Aktualisieren**.
2. Erwartet: links «App Store» mit Version und Tester-Zahl, in der Mitte die TestFlight-Builds, rechts die Codemagic-Builds.
3. Rote Box mit Text? Häufige Gründe:
   - «Schlüssel ungültig (401)» → Issuer-ID oder Schlüssel-ID vertauscht, oder bei `ASC_PRIVATE_KEY` fehlt ein Teil.
   - «keine Berechtigung (403)» bei Bewertungen → Schlüssel hat nicht die Rolle App-Manager. Builds werden trotzdem angezeigt.
   - «keine App mit ch.umbricht.downwind» → Bundle-ID hat sich geändert (z. B. nach der Umstellung auf `ch.setqnh.downwind`). Dann mir Bescheid geben, ich passe `src/apps.js` an.
   - «Funktion noch nicht installiert» → Teil 1 nochmals.

## Gut zu wissen

- Das Cockpit fragt Apple höchstens alle 10 Minuten automatisch (oder wenn du «Aktualisieren» klickst).
- Wenn die App auf das QNH-GmbH-Konto umzieht (Januar 2027), braucht es einen **neuen** API-Schlüssel aus dem neuen Konto: Teil 2 und Teil 4 wiederholen, den alten Schlüssel in App Store Connect widerrufen.
- Download-Zahlen (Verkaufsberichte) kommen in einer späteren Version.
