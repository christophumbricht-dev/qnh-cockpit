# Digital Studio einrichten

Einmalig, von Christoph. Keine Schlüssel ins Repo oder in einen Chat schreiben.

## 1. Datenbank

Supabase → Projekt «QNH Core» → SQL Editor → Inhalt von `supabase/migrations/20261028100000_studio.sql` einfügen → Run. (Oder Claude bitten, sie mit deinem OK einzuspielen.)

## 2. Cloudflare R2 (lange Videos)

1. Cloudflare → R2 → «Create bucket», Name zum Beispiel `qnh-studio`, Standort Europa (EU-Jurisdiktion).
2. R2 → «Manage API tokens» → «Create API token»: Berechtigung «Object Read & Write», nur für diesen Bucket.
3. Notieren: Account ID, Access Key ID, Secret Access Key. Den Secret zeigt Cloudflare nur einmal.

## 3. Funktion und Secrets in Supabase

1. Supabase → Edge Functions → Secrets: `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` eintragen.
2. Funktion hochladen (Claude mit deinem OK oder selbst):

```bash
npx.cmd -y supabase@2.122.0 functions deploy studio-media
```

## Ohne R2

Das Studio läuft auch ohne R2: Reels und Karussells kommen aus dem Social-Speicher, lange Videos öffnest du mit «Video vom PC öffnen» (die Datei wird nicht hochgeladen).
