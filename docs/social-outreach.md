# «Bei anderen» einrichten – Kommentar-Vorschläge für fremde Posts

Das Cockpit schaut zweimal täglich bei Accounts und Hashtags vorbei, die du beobachtest, und lässt Claude pro neuem Post einen Kommentar vorschlagen. Du findest die Vorschläge unter **Social → «Bei anderen»**, passt sie an und tippst **«Kopieren & öffnen»**: Der Text ist in der Zwischenablage, Instagram öffnet den Post, du fügst ein und postest **selbst**. Danach **«Erledigt ✓»**.

**Was das Cockpit nie tut:** kommentieren, liken oder folgen. Meta erlaubt Kommentare unter fremden Posts über die Schnittstelle gar nicht, und ein Bot würde gegen die Instagram-Regeln verstossen.

**Ein/Aus:** Schalter oben in «Bei anderen». Ausgeschaltet macht der Server-Teil gar nichts: keine Abfragen bei Meta, keine Kosten bei Anthropic.

**Kosten:** Meta und Supabase gratis. Anthropic nach Verbrauch, mit Claude Sonnet 5.5 rund 3–4 USD im Monat bei 10 Vorschlägen pro Tag (Haiku 5.5: unter 20 Cent). Du legst im Cockpit ein **Monatsbudget** fest (Standard 10 USD); ist es erreicht, gibt es bis zum Monatsende keine neuen Vorschläge. Der Verbrauch steht unter **Finanzen → «API-Verbrauch»**.

**Wichtig:** Tokens und Schlüssel gibst du **nur selbst** in Supabase ein – nie in einen Chat, nie in eine Datei im Projekt.

Zeitbedarf gesamt: etwa 1,5–2 Stunden. Bezeichnungen bei Meta und Anthropic ändern sich manchmal – im UI prüfen.

---

## 1. Migration ausführen (5 Min.)
1. Am Laptop `supabase/migrations/20261021140000_social_outreach.sql` öffnen, alles kopieren.
2. Supabase → Projekt **QNH Core** → **SQL Editor** → einfügen → **Run**. Zweimal ausführen schadet nicht.
3. Danach zeigt Social → «Bei anderen» den Schalter (noch auf **Aus**).

## 2. Facebook-Seite für Leeside Lab (10 Min.)
Fremde Accounts und Hashtags lesen geht bei Meta nur über den **Facebook-Login**, und der braucht eine Facebook-Seite, die mit @leesidelab verknüpft ist. Die Seite kann leer und anonym bleiben (kein Name von dir).
1. Facebook → **Seiten** → **Neue Seite erstellen**, Name «Leeside Lab», Kategorie z. B. «Bildungswebsite». Nichts posten nötig.
2. Instagram verknüpfen: in der Seite **Einstellungen** → **Verknüpfte Konten** → **Instagram** → mit @leesidelab anmelden. (Alternativ in der Instagram-App: Profil bearbeiten → **Seite** → verbinden.)
3. Das Veröffentlichen aus dem Cockpit läuft unverändert weiter über den Instagram-Login.

## 3. Meta-App erweitern (10 Min.)
1. [developers.facebook.com](https://developers.facebook.com) → **My Apps** → **QNH Cockpit**.
2. Links **Use cases** → bei «Manage messaging & content on Instagram» → **Customize** → **API setup with Facebook login** öffnen (zusätzlich zum bestehenden «with Instagram login»).
3. Die App bleibt im Entwicklungsmodus – für deine eigene Seite braucht es keine Meta-Prüfung.

## 4. Berechtigungen (5 Min.)
Unter **API setup with Facebook login → Permissions** (oder **App Review → Permissions and Features**) auf «Standard Access» hinzufügen:

| Berechtigung | Wofür |
|---|---|
| `instagram_basic` | Business Discovery (Posts anderer Business-/Creator-Konten lesen), Hashtag-Suche |
| `instagram_manage_insights` | verlangt Meta für Business Discovery |
| `pages_show_list` | deine Seite und das verknüpfte Instagram-Konto finden |
| `pages_read_engagement` | verlangt Meta für Business Discovery |
| `business_management` | nur falls die Seite in einem Business-Portfolio liegt |

**Hashtags** brauchen zusätzlich das Feature **«Instagram Public Content Access»** (App Review → Permissions and Features). Gibt Meta das im Entwicklungsmodus nicht frei, zeigt das Cockpit beim Hashtag einen Fehler – Accounts funktionieren trotzdem.

## 5. Facebook-Token erzeugen und in Vault speichern (10 Min.)
1. [Graph API Explorer](https://developers.facebook.com/tools/explorer/) öffnen → oben rechts App **QNH Cockpit** wählen → **User or Page: User Token**.
2. Unter **Permissions** die fünf Berechtigungen aus Schritt 4 hinzufügen → **Generate Access Token** → mit deinem Facebook-Konto bestätigen, dabei die Seite **Leeside Lab** und das Instagram-Konto **@leesidelab** auswählen.
3. Den Token in den [Access Token Debugger](https://developers.facebook.com/tools/debug/accesstoken/) einfügen → **Debug** → unten **Extend Access Token** → den neuen, langen Token kopieren (gilt etwa 60 Tage).
4. Supabase → **SQL Editor**:
   ```sql
   select vault.create_secret('HIER_DEN_TOKEN_EINFUEGEN', 'meta_token_outreach');
   ```
   Später einen neuen Token eintragen:
   ```sql
   select vault.update_secret((select id from vault.secrets where name = 'meta_token_outreach'), 'HIER_DEN_NEUEN_TOKEN');
   ```
5. **Optional – automatisch verlängern:** Mit App-ID und App-Geheimcode (Meta-App → **App settings → Basic**) verlängert das Cockpit den Token selbst, wenn er in weniger als 14 Tagen abläuft:
   ```
   npx.cmd supabase secrets set META_APP_ID=DIE_APP_ID META_APP_SECRET=DER_GEHEIMCODE --project-ref PROJEKT-ID
   ```
   Ohne das zeigt «Bei anderen» 14 Tage vorher einen Hinweis, und du machst Schritt 5 einfach nochmals.

## 6. Anthropic-Schlüssel (10 Min.)
1. [console.anthropic.com](https://console.anthropic.com) → Konto anlegen (als QNH GmbH).
2. **Billing** → Guthaben aufladen, z. B. 10 USD. Die Quittung legst du in Finanzen als Beleg ab.
3. **Limits** → ein monatliches Ausgabenlimit setzen (z. B. 15 USD) – doppelte Sicherung zum Budget im Cockpit.
4. **API Keys** → **Create Key**, Name `qnh-cockpit-bei-anderen` → kopieren (beginnt mit `sk-ant-`).
5. Am Laptop:
   ```
   npx.cmd supabase secrets set ANTHROPIC_API_KEY=DER_SCHLUESSEL --project-ref PROJEKT-ID
   ```

## 7. Server-Teil neu hochladen (2 Min.)
```
npx.cmd supabase functions deploy social-publish --project-ref PROJEKT-ID
```

## 8. Im Cockpit einschalten (5 Min.)
1. Social → **«Bei anderen»** → unter «Beobachtet» Accounts (`@meteosuisse`) und Hashtags (`#lenticularclouds`) hinzufügen. Accounts müssen Business- oder Creator-Konten sein (fast alle Creator sind das).
2. **Einstellungen**: Vorschläge pro Tag (Standard 10), Budget pro Monat, Modell (Sonnet 5.5 empfohlen), eigene Zusatzregeln.
3. Schalter auf **Ein** → **«Jetzt suchen»**. Danach läuft es von selbst, morgens und nachmittags.
4. Offene Vorschläge stehen auch auf **«Heute»**.

---

## Regeln für die Vorschläge (fest eingebaut)
- Englisch, 1–2 Sätze, höchstens 220 Zeichen, ein konkreter Gedanke zu Wetter oder Physik.
- Erklären statt bewerten: **kein Go/No-Go**, keine Urteile über Flüge oder Piloten.
- Keine Links, keine Hashtags, keine Eigenwerbung, nichts über dich (Leeside Lab bleibt anonym).
- Passt ein Post nicht (kein Wetter-, Flug- oder Bergbezug), lässt Claude ihn aus – das kostet nur die Abfrage.
- Captions schreiben Fremde: Claude behandelt sie als Daten, nie als Anweisung.
- Pro Lauf höchstens ein Vorschlag pro Account, nur Posts der letzten 3 Tage.

## Wenn etwas nicht geht
| Meldung | Lösung |
|---|---|
| «Kein Facebook-Token in Vault» | Schritt 5 |
| «Facebook-Token abgelaufen» | Schritt 5 nochmals (oder Schritt 5.5 einrichten) |
| «Keine Facebook-Seite mit verknüpftem Instagram-Konto» | Schritt 2; beim Token die Seite auswählen |
| «Meta verweigert den Zugriff» | Berechtigungen aus Schritt 4, dann neuer Token |
| «ANTHROPIC_API_KEY fehlt» / «lehnt den Schlüssel ab» | Schritt 6 |
| «Guthaben aufgebraucht» | bei Anthropic aufladen oder Limit erhöhen |
| «Monatsbudget erreicht» | Einstellungen → Budget erhöhen, oder bis zum 1. warten |
| Hashtag zeigt einen Fehler | Feature «Instagram Public Content Access» (Schritt 4) – sonst nur Accounts beobachten |
