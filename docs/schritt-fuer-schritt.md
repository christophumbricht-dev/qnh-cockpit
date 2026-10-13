# QNH online bringen – Schritt für Schritt

Alles in der richtigen Reihenfolge: Domain → Website → Cockpit → Supabase «QNH Core» → Instagram → erster Testbeitrag → Profile.
Hake ab, was erledigt ist. Wo **«→ Claude»** steht, gibst du mir kurz Bescheid und ich mache den nächsten Teil.

**Regel für alle Schritte:** Passwörter, Tokens und Zufallswörter gibst du **nur selbst** ein (Infomaniak, GitHub, Supabase). Nie in einen Chat kopieren.

| Teil | Dauer | Kosten |
|---|---|---|
| A Domain und E-Mail | 15 Min. | ca. CHF 10–15 pro Jahr |
| B Website setqnh.ch | 25 Min. | gratis |
| C Cockpit online | 20 Min. | gratis |
| D Supabase «QNH Core» | 30 Min. | gratis |
| E Instagram und Meta | 35 Min. | gratis |
| F Verbinden | 25 Min. | gratis |
| G Erster Test | 10 Min. | gratis |
| H Profile LinkedIn/Instagram | 30 Min. | gratis |

Du musst nicht alles an einem Tag machen. Nach jedem Teil funktioniert das bisher Eingerichtete.

---

## A – Domain und E-Mail (Infomaniak)

- [ ] **A1 Domain kaufen**
  1. [manager.infomaniak.com](https://manager.infomaniak.com) öffnen und anmelden.
  2. Oben im Suchfeld «Domain» eingeben → **Domain registrieren**.
  3. `setqnh.ch` eingeben → **Suchen** → in den Warenkorb. Optional `setqnh.com` dazu.
  4. Inhaber: vorerst **du persönlich** → bezahlen.
  5. Rechnung als Beleg für die Vorgründungskosten ablegen.
  - ✅ Geklappt, wenn `setqnh.ch` im Manager unter **Domains** erscheint.

- [ ] **A2 Postfach hello@setqnh.ch**
  1. Im Manager → **Mail** (bzw. «Mail Service») → für `setqnh.ch` einrichten.
  2. Adresse **hello** anlegen – als eigenes Postfach oder als **Weiterleitung** auf deine bestehende Adresse.
  - ✅ Geklappt, wenn eine Testmail an hello@setqnh.ch bei dir ankommt.

---

## B – Website setqnh.ch

- [ ] **B1 Repository anlegen**
  1. [github.com/new](https://github.com/new) (angemeldet als **christophumbricht-dev**).
  2. Repository name: `setqnh-website` · **Public** · nichts ankreuzen → **Create repository**.
  3. **→ Claude:** «setqnh-website ist angelegt». Ich lade die Website hoch.

- [ ] **B2 GitHub Pages einschalten** (nachdem ich hochgeladen habe)
  1. Im Repository → **Settings** → links **Pages**.
  2. **Source:** «Deploy from a branch» · **Branch:** `main` · `/ (root)` → **Save**.
  3. **Custom domain:** `setqnh.ch` (steht meist schon drin) → **Save**.

- [ ] **B3 DNS bei Infomaniak**
  1. Manager → **Domains** → `setqnh.ch` → **DNS-Zone**.
  2. Bestehende A-/AAAA-Einträge für `setqnh.ch` und `www` löschen. **MX-Einträge (E-Mail) nicht anfassen.**
  3. Neu eintragen (**+ Eintrag hinzufügen**), Name jeweils leer bzw. `@`:

     | Typ | Name | Wert |
     |---|---|---|
     | A | @ | `185.199.108.153` |
     | A | @ | `185.199.109.153` |
     | A | @ | `185.199.110.153` |
     | A | @ | `185.199.111.153` |
     | AAAA | @ | `2606:50c0:8000::153` |
     | AAAA | @ | `2606:50c0:8001::153` |
     | AAAA | @ | `2606:50c0:8002::153` |
     | AAAA | @ | `2606:50c0:8003::153` |
     | CNAME | `www` | `christophumbricht-dev.github.io.` |
     | CNAME | `cockpit` | `christophumbricht-dev.github.io.` *(schon für Teil C)* |

  4. Speichern. Bis alles gilt, kann es ein paar Stunden dauern.

- [ ] **B4 HTTPS und Domain-Schutz**
  1. GitHub → Repository → Settings → Pages: Sobald «DNS check successful» steht → **Enforce HTTPS** ankreuzen.
  2. Domain bestätigen: GitHub → oben rechts dein Bild → **Settings** → links **Pages** → **Add a domain** → `setqnh.ch`.
  3. GitHub zeigt einen **TXT-Eintrag** (`_github-pages-challenge-…`). Bei Infomaniak in der DNS-Zone als **TXT** eintragen.
  4. Bei GitHub **Verify** klicken (evtl. nach ein paar Minuten nochmals).
  - ✅ Geklappt, wenn https://setqnh.ch die Website zeigt.

---

## C – Cockpit online (cockpit.setqnh.ch)

- [ ] **C1 Repository anlegen**
  1. [github.com/new](https://github.com/new) → Name `qnh-cockpit` · **Public** (gratis; es sind keine Daten und keine Schlüssel drin) · nichts ankreuzen → **Create repository**.
  2. **→ Claude:** «qnh-cockpit ist angelegt». Ich lade den Code hoch. Der erste Build wird rot – das ist normal, bis C2 und C3 erledigt sind.

- [ ] **C2 Öffentliche Downwind-Werte hinterlegen**
  1. Supabase → Projekt **Downwind** → **Project Settings** → **API**: «Project URL» und «anon public»-Key kopieren.
  2. GitHub → `qnh-cockpit` → **Settings** → **Secrets and variables** → **Actions** → Reiter **Variables** → **New repository variable**:

     | Name | Wert |
     |---|---|
     | `VITE_DOWNWIND_SUPABASE_URL` | Project URL von Downwind |
     | `VITE_DOWNWIND_SUPABASE_ANON_KEY` | anon-Key von Downwind |

  3. **Nie** den «service_role»- oder «secret»-Key eintragen.

- [ ] **C3 Pages einschalten**
  1. `qnh-cockpit` → **Settings** → **Pages** → **Source:** «**GitHub Actions**».
  2. **Custom domain:** `cockpit.setqnh.ch` → **Save**.
  3. Oben → **Actions** → letzter Lauf → **Re-run all jobs**. Nach 1–2 Min. grün.
  4. Wenn «DNS check successful»: **Enforce HTTPS** ankreuzen.

- [ ] **C4 Adresse in Downwind erlauben**
  1. Supabase → **Downwind** → **Authentication** → **URL Configuration** → **Redirect URLs** → **Add URL** → `https://cockpit.setqnh.ch` → **Save**. Die Site URL nicht ändern.
  - ✅ Geklappt, wenn https://cockpit.setqnh.ch «QNH Cockpit – intern» zeigt und du dich mit `DEINE-ADMIN-EMAIL` und dem Code anmelden kannst.
  - Auf dem iPhone: Safari → **Teilen** → **Zum Home-Bildschirm**.

- [ ] **C5 (nebenbei) Verlauf-Diagramme in Downwind freischalten**
  1. Supabase → **Downwind** → **SQL Editor** → **New query**.
  2. Ganzen Inhalt von `C:\Projects\downwind\supabase\apply-pending.sql` einfügen → **Run** → «Success».

---

## D – Supabase-Projekt «QNH Core»

- [ ] **D1 Projekt anlegen**
  1. [supabase.com/dashboard](https://supabase.com/dashboard) → **New project**.
  2. Name `qnh-core` · Region **Zurich** (sonst Frankfurt) · Plan **Free** · Datenbank-Passwort in den Passwortmanager.
  3. Nach dem Anlegen: **Project Settings → API** → «Project URL» und «anon public»-Key notieren. Die Projekt-ID ist der Teil `xxxx` in `https://xxxx.supabase.co`.

- [ ] **D2 Anmeldung einstellen**
  1. **Authentication → Sign In / Providers**: Email an lassen, **«Allow new users to sign up» ausschalten**.
  2. **Authentication → Emails → Templates → Magic Link**: Inhalt ersetzen durch:
     ```html
     <h2>QNH Cockpit</h2>
     <p>Dein Anmeldecode:</p>
     <p style="font-size:28px;letter-spacing:4px"><b>{{ .Token }}</b></p>
     <p>Wenn du dich nicht anmelden wolltest, ignoriere diese E-Mail.</p>
     ```
     → **Save**.
  3. **Authentication → URL Configuration → Redirect URLs** → `https://cockpit.setqnh.ch` hinzufügen.

- [ ] **D3 Dein Benutzer**
  1. **Authentication → Users → Add user → Create new user**: `DEINE-ADMIN-EMAIL`, ein langes beliebiges Passwort, **Auto Confirm User** an → **Create**.

- [ ] **D4 Datenbank einrichten**
  1. **SQL Editor → New query** → ganzen Inhalt von `C:\Projects\qnh-cockpit\supabase\migrations\20261013100000_social.sql` einfügen → **Run** → «Success».
  2. Neue Query:
     ```sql
     insert into public.qnh_admins (user_id)
     select id from auth.users where email = 'DEINE-ADMIN-EMAIL'
     on conflict do nothing;
     ```
     → **Run**.

- [ ] **D5 Cockpit mit QNH Core verbinden**
  1. GitHub → `qnh-cockpit` → Settings → Secrets and variables → Actions → **Variables** → zwei neue:

     | Name | Wert |
     |---|---|
     | `VITE_QNH_SUPABASE_URL` | Project URL von qnh-core |
     | `VITE_QNH_SUPABASE_ANON_KEY` | anon-Key von qnh-core |

  2. **Actions** → letzter Lauf → **Re-run all jobs**.
  3. **→ Claude:** «QNH Core ist angelegt» – ich trage die Werte auch in deine lokale `.env` ein, wenn du sie mir als *öffentliche* URL/anon-Key gibst (der anon-Key ist nicht geheim), oder du trägst sie selbst in `C:\Projects\qnh-cockpit\.env` ein.
  - ✅ Geklappt, wenn das Cockpit beim Anmelden jetzt einen Code von **QNH Core** schickt und danach der Reiter **Social** erscheint (noch ohne Konto).

---

## E – Instagram und Meta (pro App-Konto, zuerst @fly_downwind)

- [ ] **E1 Unternehmenskonto**
  1. Instagram-App → Profil → **☰** → **Einstellungen und Aktivität** → **Kontotyp und Tools** → **Zu professionellem Konto wechseln** → **Unternehmen** (Bezeichnungen im UI prüfen).

- [ ] **E2 Meta-App erstellen**
  1. [developers.facebook.com](https://developers.facebook.com) → **Get Started** (Meta verlangt meist ein Facebook-Konto zum Anmelden – privat genügt).
  2. **My Apps → Create App** → Name `QNH Cockpit` → Anwendungsfall **«Manage messaging & content on Instagram»** → Typ **Business** (falls gefragt).
  3. In der App → **Instagram → API setup with Instagram login**.

- [ ] **E3 Berechtigungen**
  Unter Instagram → API setup → **Permissions** (bzw. App Review → Permissions and Features) diese drei aktiv:
  `instagram_business_basic`, `instagram_business_content_publish`, `instagram_business_manage_comments`.
  Keine Meta-Prüfung nötig, solange nur deine eigenen Konten verbunden sind.

- [ ] **E4 Konto als Tester verbinden**
  1. Meta-App → **App Roles → Roles → Add People → Instagram Tester** → `fly_downwind`.
  2. Instagram-App → **Einstellungen** → **Website-Berechtigungen** / **Apps und Websites** → **Tester-Einladungen** → annehmen (Ort im UI prüfen).

- [ ] **E5 Token erzeugen**
  1. Meta-App → Instagram → API setup with Instagram login → **Generate access tokens** → **Add account** → mit @fly_downwind anmelden → bestätigen.
  2. **Instagram-Konto-ID** (Zahl) notieren.
  3. **Token** kopieren – **nirgends speichern**, gleich weiter mit F1.

---

## F – Verbinden

- [ ] **F1 Konto und Token eintragen** (Supabase **qnh-core** → **SQL Editor** → New query)
  Platzhalter direkt im SQL Editor ersetzen → **Run** → Query danach **ohne Speichern schliessen**:
  ```sql
  select vault.create_secret('HIER_DEN_TOKEN_EINFUEGEN', 'meta_token_downwind_instagram');

  insert into public.social_accounts (app_id, platform, remote_id, handle, token_name, token_expires_at)
  values ('downwind', 'instagram', 'HIER_DIE_INSTAGRAM_KONTO_ID', 'fly_downwind',
          'meta_token_downwind_instagram', now() + interval '60 days');
  ```
  - ✅ Im Cockpit unter Social erscheint «Downwind · Instagram @fly_downwind · Token gültig bis …».

- [ ] **F2 Server-Teil hochladen** (PowerShell)
  ```
  cd C:\Projects\qnh-cockpit
  npx supabase login
  npx supabase link --project-ref PROJEKT-ID
  npx supabase functions deploy social-publish --project-ref PROJEKT-ID
  ```

- [ ] **F3 Zufallswort für den Zeitplan**
  1. In PowerShell ein Zufallswort erzeugen und anzeigen:
     ```
     [guid]::NewGuid().ToString("N") + [guid]::NewGuid().ToString("N")
     ```
  2. Selbst als Secret setzen (Wort einsetzen):
     ```
     npx supabase secrets set SOCIAL_CRON_SECRET=DAS_ZUFALLSWORT --project-ref PROJEKT-ID
     ```
  3. Supabase → SQL Editor → neue Query (Werte einsetzen) → **Run** → ohne Speichern schliessen:
     ```sql
     select vault.create_secret('https://PROJEKT-ID.supabase.co', 'qnh_project_url');
     select vault.create_secret('DAS_ZUFALLSWORT', 'social_cron_secret');
     ```

- [ ] **F4 Zeitplan einschalten**
  1. SQL Editor → neue Query → ganzen Inhalt von `C:\Projects\qnh-cockpit\supabase\migrations\20261013100100_social_cron.sql` → **Run**.
  - Ab jetzt prüft Supabase alle 10 Minuten, ob ein freigegebener Beitrag fällig ist.

---

## G – Erster Test: eine Story

- [ ] **G1**
  1. Testbild im Hochformat (1080 × 1920) als **JPEG**, z. B. ein iPhone-Screenshot.
  2. Cockpit → **Social** → **Neuer Beitrag** → Konto @fly_downwind → Art **Story** → Bild hineinziehen.
  3. Zeit: in 15 Minuten → **Freigeben** → bestätigen.
  4. Warten (oder **Jetzt veröffentlichen**). Status wechselt zu «Veröffentlicht».
  5. Auf Instagram prüfen. Die Story verschwindet nach 24 Stunden von selbst.
  - ❌ Fehler? Den roten Text im Cockpit lesen und **→ Claude** zeigen.

- [ ] **G2** Danach ein normaler Beitrag (Bild 4:5) mit Text und erstem Kommentar – gleich wie oben, Art **Bild**.

---

## H – Profile (Texte zum Kopieren in `C:\Projects\setqnh-website\docs\social-profile.md`)

- [ ] **H1 LinkedIn-Unternehmensseite** «QNH GmbH», URL `linkedin.com/company/setqnh`, Logo und Titelbild aus `Website Flying\QNH Logo\social\`.
- [ ] **H2 Instagram @setqnh** reservieren (Profil sauber, Inhalte laufen über @fly_downwind).
- [ ] **H3** Erster LinkedIn-Beitrag «QNH ist gestartet», sobald Website und E-Mail laufen.

---

## Wenn etwas nicht klappt
- **Website/Cockpit zeigt nichts:** DNS braucht bis zu ein paar Stunden. GitHub → Settings → Pages zeigt den Stand.
- **Build rot (Actions):** auf den roten Schritt klicken, Text kopieren → Claude.
- **Kein Code per E-Mail (QNH Core):** Spam-Ordner prüfen; Template aus D2 gespeichert? Benutzer aus D3 angelegt?
- **«Dieses Konto ist kein Admin»:** D4 Schritt 2 mit der richtigen E-Mail ausführen.
- **«Token abgelaufen»:** E5 wiederholen, dann im SQL Editor (Platzhalter ersetzen):
  ```sql
  select vault.update_secret((select id from vault.secrets where name = 'meta_token_downwind_instagram'), 'NEUER_TOKEN');
  update public.social_accounts set token_expires_at = now() + interval '60 days' where token_name = 'meta_token_downwind_instagram';
  ```
