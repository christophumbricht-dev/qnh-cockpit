# QNH Cockpit

Internes Dashboard der QNH GmbH: Übersicht, Verlauf, Feedback, Fehler, Beta, Verifizierung, Meldungen und **Social** (Instagram-Beiträge mit Freigabe).

- **Starten:** `npm run dev` → <http://localhost:5185> (Demo ohne Anmeldung: <http://localhost:5185/?demo>)
- **Online:** <https://cockpit.setqnh.ch> – Einrichtung: [docs/hosting.md](docs/hosting.md)
- **Social einrichten:** [docs/social-setup.md](docs/social-setup.md) · Paketformat: [docs/social-paket.md](docs/social-paket.md)

## Tests

| Befehl | Was |
|---|---|
| `npm test` | Prüfungen (Format, Länge, Hashtags, Schweizer Zeit), Paket-Import, Diagramme, Schlüssel-Check, Datenbankregeln (PGlite) |
| `npm run test:functions` | Edge Function `social-publish` mit nachgebauter Instagram-API (Deno) |
| `npm run check:secrets` | Keine geheimen Schlüssel in `src/`, `public/`, `dist/`, `supabase/` |
| `npm run test:all` | alles zusammen |
