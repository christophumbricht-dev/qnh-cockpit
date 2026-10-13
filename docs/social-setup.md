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

## 4. Instagram-Konto mit der App verbinden und Token erzeugen (10 Min., pro App-Konto)
1. In der App → **App Roles** → **Roles** → **Add People** → **Instagram Tester** → Instagram-Benutzername (z. B. `flydownwind`).
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
values ('downwind', 'instagram', 'HIER_DIE_INSTAGRAM_KONTO_ID', 'flydownwind', 'meta_token_downwind_instagram', now() + interval '60 days');
```
Für SecondSeat später dasselbe mit `secondseat` und `meta_token_secondseat_instagram`.

Neuen Token eintragen (falls einer abläuft oder ungültig wird):
```sql
select vault.update_secret((select id from vault.secrets where name = 'meta_token_downwind_instagram'), 'HIER_DEN_NEUEN_TOKEN');
update public.social_accounts set token_expires_at = now() + interval '60 days' where token_name = 'meta_token_downwind_instagram';
```

## 9. Server-Teil hochladen (10 Min.)
In PowerShell im Ordner `C:\Projects\qnh-cockpit` (die Projekt-ID ist der Teil `xxxx` aus `https://xxxx.supabase.co`):
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
- **Lokal:** in `C:\Projects\qnh-cockpit\.env` ergänzen: `VITE_QNH_SUPABASE_URL=…` und `VITE_QNH_SUPABASE_ANON_KEY=…` (Werte aus Schritt 5.3).
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

## Was das System macht (und was nicht)
- Veröffentlicht **nur freigegebene** Beiträge, nie automatisch einen Entwurf. Die Datenbank erzwingt das zusätzlich.
- Höchstens **3 Versuche** pro Beitrag, mit verständlicher Fehlermeldung. Kein doppeltes Posten.
- Hält das Tageslimit von Instagram ein (100 Beiträge in 24 Stunden) und wartet sonst.
- Facebook-Seiten: im Code vorbereitet, **ausgeschaltet** (`FACEBOOK_ENABLED`).

## Offen – Stufe 2 (später, nicht jetzt)
- **Posteingang:** Kommentare auf eigene Beiträge und Direktnachrichten im Cockpit lesen, Antwortentwürfe vorbereiten – **senden tust du selbst** per Klick.
- Spam-Kommentare ausblenden, Willkommensnachricht für neue Follower.
- **Nicht** vorgesehen und gegen die Instagram-Regeln: automatisch liken, folgen oder bei fremden Konten kommentieren.
- Braucht zusätzlich die Berechtigungen `instagram_business_manage_comments` (schon oben) und `instagram_business_manage_messages`.
