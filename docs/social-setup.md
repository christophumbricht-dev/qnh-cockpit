# Social einrichten – Instagram-Beiträge aus dem Cockpit

So kommen Beiträge aus dem Cockpit auf Instagram: Du bereitest sie vor (oder importierst ein Paket), **gibst jeden selbst frei**, und ein kleiner Server-Teil in Supabase veröffentlicht sie zur geplanten Zeit.

**Kosten:** keine erwartet (Supabase-Gratisplan, Meta Graph API ist gratis).
**Meta-Prüfung (App Review):** für **deine eigenen** Konten **nicht nötig** – die Meta-App bleibt im Entwicklungsmodus, und deine Instagram-Konten bekommen eine Rolle in der App. Eine Prüfung (und eine Unternehmens-Verifizierung) bräuchte es erst, wenn fremde Konten das Cockpit nutzen sollen.

**Wichtig:** Tokens und Schlüssel gibst du **nur selbst** in Supabase ein – nie in einen Chat, nie in eine Datei im Projekt.

Zeitbedarf gesamt: etwa 1–1,5 Stunden.

---

## 1. Instagram-Konto auf «professionell» stellen (5 Min., pro App-Konto)
1. Instagram-App → Profil → oben rechts **☰** → **Einstellungen und Aktivität** → **Kontotyp und Tools** → **Zu professionellem Konto wechseln** (Bezeichnungen können leicht abweichen – im UI prüfen).
2. **Unternehmen** wählen (Stories über die API sind laut Meta für Unternehmenskonten dokumentiert), Kategorie z. B. «App-Seite» oder «Software».
3. Eine Facebook-Seite ist **nicht** nötig.

## 2. Meta-Entwicklerkonto und App (15 Min.)
1. [developers.facebook.com](https://developers.facebook.com) → **Get Started** / **Los geht's**. Meta verlangt zum Anmelden in der Regel ein Facebook-Konto (privat genügt) – im UI prüfen.
2. **My Apps** → **Create App**.
   - App-Name: `QNH Cockpit`
   - Anwendungsfall: **«Manage messaging & content on Instagram»** (Instagram API)
   - App-Typ, falls gefragt: **Business**
3. In der App → links **Instagram** → **API setup with Instagram login** (Einrichtung mit Instagram-Login). Das ist der Weg **ohne Facebook-Seite** (Entscheid: «Instagram API with Instagram Login», Host `graph.instagram.com`).

## 3. Berechtigungen (5 Min.)
In der App unter **Instagram → API setup with Instagram login → Permissions** bzw. **App Review → Permissions and Features** diese auf «Standard Access» lassen/hinzufügen:

| Berechtigung | Wofür |
|---|---|
| `instagram_business_basic` | Konto-ID, Benutzername |
| `instagram_business_content_publish` | Beiträge, Karussells, Reels, Stories veröffentlichen |
| `instagram_business_manage_comments` | den **ersten Kommentar** schreiben (ohne diese Berechtigung klappt alles andere, nur der Kommentar nicht) |
| `instagram_business_manage_insights` | **Statistik** (Reichweite, Views, Speicherungen …, docs/social-statistik.md). Nach dem Hinzufügen pro Konto einen **neuen Token** erzeugen und mit `vault.update_secret` eintragen (Schritt 8). |

## 4. Instagram-Konto mit der App verbinden und Token erzeugen (10 Min., pro App-Konto)
1. In der App → **App Roles** → **Roles** → **Add People** → **Instagram Tester** → Instagram-Benutzername (z. B. `fly_downwind`).
2. In der Instagram-App die Einladung annehmen: **Einstellungen** → **Website-Berechtigungen** / **Apps und Websites** → **Tester-Einladungen** (Ort im UI prüfen).
3. Zurück in der Meta-App → **Instagram → API setup with Instagram login** → **Generate access tokens** → **Add account** → mit dem Instagram-Konto anmelden → Berechtigungen bestätigen.
4. Du siehst jetzt:
   - die **Instagram-Konto-ID** (Zahl) → notieren
   - einen **Token** (beginnt meist mit `IGAA…`, gültig **60 Tage**) → **kopieren, nicht speichern, nicht weitergeben**. Er kommt in Schritt 8 direkt in Supabase.

## 5. Supabase-Projekt «QNH Core» anlegen (10 Min.)
> Hinweis zum Namen: Der Ordner `Website Flying\QNH Core` ist etwas anderes – eine **Vorlage** für Apps. Das hier ist das Supabase-Projekt der **Firma** (Cockpit-Login, Social).

1. [supabase.com/dashboard](https://supabase.com/dashboard) → **New project**.
2. Name: `qnh-core` · Region: **Zurich** (falls angeboten, sonst **Frankfurt**) · Plan: **Free** · Datenbank-Passwort im Passwortmanager speichern.
3. **Project Settings → API**: «Project URL» und den «anon / publishable key» notieren (öffentlich, für das Cockpit). Den **service_role / secret key nie** irgendwo eintragen.
4. Gratis-Projekte pausiert Supabase nach rund 7 Tagen ohne Aktivität. Wenn das passiert: im Dashboard **Restore** klicken.

## 6. Anmeldung für das Cockpit (10 Min.)
1. **Authentication → Sign In / Providers** (bzw. «Providers» → Email): E-Mail aktiviert lassen, **«Allow new users to sign up» ausschalten** (niemand soll sich selbst registrieren können).
2. **Authentication → Emails → Templates → Magic Link**: Der 6-stellige Code muss in der E-Mail stehen. Den Text ersetzen durch:
   ```html
   <h2>QNH Cockpit</h2>
   <p>Dein Anmeldecode:</p>
   <p style="font-size:28px;letter-spacing:4px"><b>{{ .Token }}</b></p>
   <p>Der Code gilt eine Stunde. Wenn du dich nicht anmelden wolltest, ignoriere diese E-Mail.</p>
   ```
3. **Authentication → Users → Add user → Create new user**: deine E-Mail, **Auto Confirm User** an, ein beliebiges langes Passwort (wird nicht gebraucht).
4. **Authentication → URL Configuration → Redirect URLs**: `https://cockpit.setqnh.ch` hinzufügen.

## 7. Datenbank einrichten (5 Min.)
1. **SQL Editor → New query** → den ganzen Inhalt von `supabase/migrations/20261013100000_social.sql` einfügen → **Run**.
2. Neue Query – dich als Admin eintragen (E-Mail anpassen):
   ```sql
   insert into public.qnh_admins (user_id)
   select id from auth.users where email = 'DEINE-EMAIL@BEISPIEL.CH'
   on conflict do nothing;
   ```

## 8. Konto und Token eintragen (5 Min., pro App-Konto) – nur du, nur im SQL Editor
Neue Query, die Platzhalter **direkt im SQL Editor** ersetzen, **Run**, danach die Query **ohne Speichern schliessen** (bzw. aus «Recent» löschen), damit der Token nicht im Verlauf bleibt:

```sql
select vault.create_secret('HIER_DEN_TOKEN_EINFUEGEN', 'meta_token_downwind_instagram');

insert into public.social_accounts (app_id, platform, remote_id, handle, token_name, token_expires_at)
values ('downwind', 'instagram', 'HIER_DIE_INSTAGRAM_KONTO_ID', 'fly_downwind', 'meta_token_downwind_instagram', now() + interval '60 days');
```
Für SecondSeat später dasselbe mit `secondseat` und `meta_token_secondseat_instagram`.

Neuen Token eintragen (falls einer abläuft oder ungültig wird):
```sql
select vault.update_secret((select id from vault.secrets where name = 'meta_token_downwind_instagram'), 'HIER_DEN_NEUEN_TOKEN');
update public.social_accounts set token_expires_at = now() + interval '60 days' where token_name = 'meta_token_downwind_instagram';
```

## 9. Server-Teil hochladen (10 Min.)
In PowerShell im Ordner `C:\QNH\01_Firma\cockpit` (die Projekt-ID ist der Teil `xxxx` aus `https://xxxx.supabase.co`):
```
npx supabase login
npx supabase link --project-ref PROJEKT-ID
npx supabase functions deploy social-publish --project-ref PROJEKT-ID
```
Dann ein langes Zufallswort für den Zeitplan erzeugen und **selbst** als Secret setzen (nicht in einen Chat kopieren):
```
$s = [guid]::NewGuid().ToString("N") + [guid]::NewGuid().ToString("N"); $s
npx supabase secrets set SOCIAL_CRON_SECRET=DAS_ZUFALLSWORT --project-ref PROJEKT-ID
```

## 10. Zeitplan einschalten (5 Min.)
1. SQL Editor → neue Query (Werte ersetzen, danach ohne Speichern schliessen):
   ```sql
   select vault.create_secret('https://PROJEKT-ID.supabase.co', 'qnh_project_url');
   select vault.create_secret('DAS_ZUFALLSWORT', 'social_cron_secret');
   ```
2. Neue Query → Inhalt von `supabase/migrations/20261013100100_social_cron.sql` → **Run**.
   Ab jetzt prüft Supabase **alle 10 Minuten**, ob ein freigegebener Beitrag fällig ist, erneuert montags die Tokens (wenn sie in weniger als 20 Tagen ablaufen) und löscht täglich die Dateien von Beiträgen, die vor mehr als 14 Tagen veröffentlicht wurden.

## 11. Cockpit verbinden (5 Min.)
- **Lokal:** in `C:\QNH\01_Firma\cockpit\.env` ergänzen: `VITE_QNH_SUPABASE_URL=…` und `VITE_QNH_SUPABASE_ANON_KEY=…` (Werte aus Schritt 5.3).
- **Online:** dieselben zwei Werte als GitHub-*Variables* (siehe `docs/hosting.md`, Schritt 3).
- Cockpit neu laden → «QNH Cockpit – intern» → mit deiner E-Mail und dem Code anmelden → Reiter **Social**.

## 12. Erster Test: eine Story mit Testbild (10 Min.)
1. Testbild im Hochformat 1080 × 1920 als JPEG (z. B. ein Screenshot vom iPhone, als JPEG exportiert).
2. **Social → Neuer Beitrag** → Konto wählen → Art **Story** → Bild hineinziehen → Zeit «in 15 Minuten» → **Freigeben**.
3. Spätestens nach 10 Minuten nach der Zeit steht der Beitrag auf «Veröffentlicht», oder du klickst **Jetzt veröffentlichen**.
4. Auf Instagram prüfen. Eine Story verschwindet nach 24 Stunden von selbst.
5. Wenn ein Fehler erscheint: Text im Cockpit lesen (z. B. Token, Berechtigung, Format) – und Claude zeigen.

> Meta dokumentiert Stories über die API klar für den Weg mit Facebook-Seite; für den Instagram-Login ist es beschrieben, aber nicht ausdrücklich bestätigt. Darum ist der erste Test eine Story. Falls genau Stories nicht gehen, funktionieren Bilder, Karussells und Reels trotzdem.

---

## Standort (optional, pro Beitrag)
Instagram verlangt als Standort die **ID einer Facebook-Seite eines echten Ortes** (z. B. die Seite des Flugplatzes). Gilt für Bild, Karussell und Reel – **nicht für Stories**. Suchen kann das Cockpit nicht (das erlaubt Instagram mit unserer Anbindung nicht), darum gibt es eine Ortsliste:
1. Im Browser auf **facebook.com** den Ort suchen (z. B. «Flugplatz Birrfeld») und seine Seite öffnen.
2. Auf der Seite **Info** (bzw. «Über») → **Seitentransparenz** → dort steht die **Seiten-ID** (nur Ziffern). Steht in der Adresszeile `…profile.php?id=123…`, ist das die ID.
3. Im Cockpit im Beitrag → **Standort** → **+ Neuen Ort hinzufügen …** → Name und ID eingeben. Ab dann ist der Ort in der Liste.
Nimmt Instagram einen Ort nicht an, wird der Beitrag trotzdem veröffentlicht – ohne Standort, mit Hinweis im Cockpit.

## Kommentare beantworten (Social → «Kommentare»)
Das Cockpit holt alle 15 Minuten die Kommentare unter deinen eigenen Instagram-Beiträgen und YouTube-Videos. Du liest sie dort, antwortest mit **«Auf Instagram antworten»** bzw. **«Auf YouTube antworten»**, legst sie mit **«Erledigt»** ab oder blendest Spam mit **«Ausblenden»** aus (rückgängig mit «Einblenden»). Deine eigenen Antworten kannst du löschen. Gesendet wird **nur per Klick** – nie automatisch. Neue Kommentare stehen auch unter «Heute».

Einrichten (einmal, ca. 10 Min.):
1. **SQL Editor → New query** → Inhalt von `supabase/migrations/20261020100000_social_comments.sql` → **Run**.
2. Server-Teil neu hochladen (PowerShell im Ordner `C:\QNH\01_Firma\cockpit`):
   ```
   npx supabase functions deploy social-publish --project-ref PROJEKT-ID
   ```
3. Instagram braucht keine neue Berechtigung: `instagram_business_manage_comments` ist schon da (Schritt 3, erster Kommentar).
4. Cockpit → Social → **Kommentare** → **Jetzt abholen**.

Antwortvorschläge: Claude kann am PC mit `npm.cmd run social -- comments` die offenen Kommentare lesen und mit `npm.cmd run social -- comments draft <id> "…"` einen Vorschlag hinterlegen. Er steht dann im Antwortfeld – du liest, änderst und sendest selbst.

## YouTube-Kanal verbinden (Kommentare und Videos veröffentlichen)
Einmalig ca. 20 Minuten. Bezeichnungen in der Google Cloud Console ändern sich manchmal – im UI prüfen.

**Voraussetzung:** Der YouTube-Kanal (z. B. Leeside Lab) existiert schon. Ist er ein Brand-Konto, wählst du ihn beim Anmelden aus.

1. [console.cloud.google.com](https://console.cloud.google.com) → oben **Projekt auswählen → Neues Projekt** → Name `QNH Cockpit` → **Erstellen**.
2. **APIs & Dienste → Bibliothek** → «YouTube Data API v3» suchen → **Aktivieren**.
3. **Google Auth Platform** (bzw. «OAuth-Zustimmungsbildschirm») → **Jetzt starten**:
   - App-Name `QNH Cockpit`, Support-E-Mail: deine
   - Zielgruppe: **Extern**
   - Kontaktdaten: deine E-Mail → Richtlinie akzeptieren → **Erstellen**
4. **Zielgruppe** (Audience) → Veröffentlichungsstatus → **App veröffentlichen** («In Produktion»). **Wichtig:** Im Status «Test» läuft der Zugang nach 7 Tagen ab und das Cockpit verliert YouTube. Eine Google-Prüfung braucht es für deine eigenen Kanäle nicht – beim Verbinden zeigt Google einmal «Google hat diese App nicht überprüft»: **Erweitert → Weiter zu QNH Cockpit**.
5. **Clients → Client erstellen** → Anwendungstyp **Webanwendung**, Name `Cockpit` → **Autorisierte Weiterleitungs-URIs** – genau diese:
   ```
   https://cockpit.setqnh.ch/youtube-callback.html
   ```
   (Nur wenn Claude lokal am Cockpit entwickelt: zusätzlich `http://localhost:5185/youtube-callback.html` eintragen **und** das Secret `GOOGLE_REDIRECT_URIS=https://cockpit.setqnh.ch/youtube-callback.html,http://localhost:5185/youtube-callback.html` setzen.)
   → **Erstellen**. Google zeigt **Client-ID** und **Clientschlüssel** (beginnt mit `GOCSPX-`).
6. Beides **selbst** als Supabase-Secrets setzen (PowerShell, nicht in einen Chat kopieren):
   ```
   npx supabase secrets set GOOGLE_CLIENT_ID=DIE_CLIENT_ID GOOGLE_CLIENT_SECRET=DER_CLIENTSCHLUESSEL --project-ref PROJEKT-ID
   ```
7. Cockpit → **Social** → Ansicht **Beiträge** → in der Karte **«Kanal hinzufügen»** die App/Marke wählen (z. B. «Leeside Lab») → **YouTube-Kanal verbinden** → mit dem Google-Konto anmelden → den **Kanal** wählen → **beide Häkchen** setzen (Videos hochladen, Kommentare verwalten) → zurück im Cockpit steht «YouTube-Kanal … verbunden».

Was dabei passiert: Der dauerhafte Zugang von Google landet direkt in Supabase Vault (`google_token_<app>_youtube`) – niemand sieht ihn, auch du nicht. Zurückziehen: [myaccount.google.com/permissions](https://myaccount.google.com/permissions) → QNH Cockpit → Zugriff entfernen. Danach im Cockpit neu verbinden.

**Videos veröffentlichen:** Zusätzlich die Migration `supabase/migrations/20261020110000_social_youtube.sql` im SQL-Editor ausführen und `social-publish` neu hochladen. Danach ist der YouTube-Kanal im Editor als Konto wählbar (Art «Video (Short)», Feld «Titel», Text = Beschreibung). Freigeben wie bei Instagram; zur geplanten Zeit lädt das Cockpit das Video hoch (in Stücken – ein langes Video läuft über zwei, drei Durchgänge), setzt es öffentlich und schreibt den ersten Kommentar. Anpinnen und Titelbild gehen nur in der YouTube-App.

**Kosten/Kontingent:** gratis. YouTube gibt jedem Projekt ein Tageskontingent; Kommentare abholen kostet wenige Einheiten pro Durchgang, eine Antwort 50 Einheiten.

## Was das System macht (und was nicht)
- Veröffentlicht **nur freigegebene** Beiträge, nie automatisch einen Entwurf. Die Datenbank erzwingt das zusätzlich.
- Höchstens **3 Versuche** pro Beitrag, mit verständlicher Fehlermeldung. Kein doppeltes Posten.
- Hält das Tageslimit von Instagram ein (100 Beiträge in 24 Stunden) und wartet sonst.
- Facebook-Seiten: im Code vorbereitet, **ausgeschaltet** (`FACEBOOK_ENABLED`).

## Offen – später
- **Direktnachrichten** im Cockpit (Kommentare sind erledigt, siehe oben). Braucht `instagram_business_manage_messages`.
- Willkommensnachricht für neue Follower.
- **Nicht** vorgesehen und gegen die Instagram-Regeln: automatisch liken, folgen oder bei fremden Konten kommentieren.
