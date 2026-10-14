# QNH Cockpit

Internal dashboard of QNH GmbH (owner: Christoph Umbricht) for all its apps. Talk to Christoph in **German** (Swiss usage, "ss" instead of "ß"); he is a pilot, not a programmer. UI text German; code, comments and commit messages English.

## How it works

- Vite + vanilla JS, static web app (no server of its own). `npm run dev` (port 5185), `npm run build`, `npm test`.
- Per app, the cockpit signs in to that app's **own Supabase project** with Christoph's normal app account (6-digit e-mail code, `shouldCreateUser: false`). Sessions are stored per app (`storageKey: qnh-cockpit-<app>`).
- All data comes from the app's **admin functions**, which check `is_admin()` in the database. The cockpit only knows public URLs and anon keys (`.env`, see `.env.example`). **Never add a service_role / secret key** — the cockpit runs in the browser.
- `?demo` in the URL shows invented sample data (`src/demo.js`) without signing in — use it for layout work and screenshots.

| File | Role |
|---|---|
| `src/apps.js` | list of apps, overview tiles per app (`stats` → keys of `admin_stats()`), tabs |
| `src/api.js` | Supabase clients per app, auth, admin calls |
| `src/main.js` | state, rendering (template strings, always `esc()` user data), events |
| `src/format.js` | pure helpers, unit-tested in `tests/` |

## Apps

- **Downwind** (`C:\Projects\downwind`): uses `admin_stats()`, `admin_feedback()`, `set_feedback_status()`, `admin_errors()`, table `beta_signups`, bucket `feedback` (signed URLs). Defined in Downwind's migration `20261107100000_admin_inbox.sql`. Verification tab: `verification_queue()`, `review_verification()`, bucket `verification-docs`, `clear_verification_doc()`, then the `push` function (same steps as the app's admin screen). Reports tab: Edge Function `moderate` (`op: list | act`, moderators only — table `moderators`). Trend tab ("Verlauf"): `admin_timeseries(p_days)` from Downwind's migration `20261122100000_admin_timeseries.sql` (daily counts, Swiss time); `src/charts.js` buckets ≤31 days daily, longer ranges by ISO week, and draws small multiples (one series each, colour `#1098AD`, validated for light and dark). If Downwind changes these, update the cockpit.
- **SecondSeat** (`C:\Projects\SecondSeat`): offline app without a server — shown as a note plus its roadmap. Add `store` in `src/apps.js` once it is in App Store Connect (planned bundle ID `ch.setqnh.secondseat`).
- New app with an account: give it the same admin functions (ideally via QNH Core, `C:\Users\cu89\Desktop\Christoph\Fliegen\Website Flying\QNH Core`), then add it to `src/apps.js` and `.env`.

## Store & Builds (tab per app with `store` in `src/apps.js`)

Edge Function `supabase/functions/store-status/` in QNH Core (admin JWT, `is_qnh_admin()`; read-only). App Store Connect API (ES256 JWT signed with WebCrypto in `status.ts`): versions, TestFlight builds + beta state, customer reviews, tester count; public rating via iTunes lookup; Codemagic `/builds`. Secrets `ASC_ISSUER_ID`, `ASC_KEY_ID`, `ASC_PRIVATE_KEY`, `CODEMAGIC_TOKEN` (all optional, entered by Christoph). Deno tests `status.test.ts`. Cockpit: `src/store/` (cached 10 min, todos for failed builds/rejections/new reviews). Setup: `docs/store-setup.md`. Later: downloads (sales reports), RevenueCat.

## Roadmap & Hangar (QNH Core)

Migration `20261014100000_roadmap_hangar.sql`: `roadmap_items` (scope qnh/downwind/secondseat, status idea/next/doing/done, due, source cockpit/claude; realtime) and `hangar_links` (quick links, seeded). Cockpit: `src/qnh/` – board per app (tab "Roadmap") and for all (`#roadmap`), due items on "Heute"; Hangar `#hangar`. File storage is Infomaniak kDrive (linked in the Hangar, no files in the cockpit).

**Roadmap sync with Claude sessions** – Christoph adds items in the cockpit; Claude keeps it up to date from conversations:
- At the start of a session in this repo run `npm.cmd run roadmap -- pull` and read `roadmap-local/ROADMAP.md` (local mirror, gitignored – the repo is public). Mention new items from Christoph.
- When a conversation decides something to do: `npm.cmd run roadmap -- add --scope downwind --status next --title "…" [--body "…"] [--due YYYY-MM-DD]`; when done: `npm.cmd run roadmap -- set <id> --status done`. Keep titles short and German; no secrets or personal data in items.
- If the session expired: Christoph runs `npm.cmd run roadmap -- login` (paste the link address from the e-mail, do not click it).

## Social calendar

`src/social/ui.js`: list/calendar toggle (localStorage `qnh-social-mode`), month grid in Swiss time; dragging a draft/approved post to another day keeps its time (approved posts: draft → approved again with the new time, as the guard trigger requires).

## Hosting (cockpit.setqnh.ch)

GitHub Pages via `.github/workflows/pages.yml` (test, `check:secrets`, build with repository *variables* `VITE_*`, deploy). `public/CNAME`. Hash routing, so no 404 fallback. Production builds get a strict CSP (`vite.config.js`). `robots.txt` disallows all. Without a session only "QNH Cockpit – intern" is shown (login gate: QNH Core if configured, else the first app). Guide: `docs/hosting.md`. Never add secrets: `npm run check:secrets` fails on service_role JWTs, `sb_secret_`, Meta tokens and private `.env` values.

## Social (QNH Core project)

Backend in `supabase/` of THIS repo (the folder `Website Flying\QNH Core` is a different thing: an app template). Supabase project "QNH Core" (`project_id = "qnh-core"`).
- `migrations/20261013100000_social.sql`: `qnh_admins` + `is_qnh_admin()`, `social_accounts` (no tokens; token in Vault under `token_name`), `social_posts` with guard trigger (inserts are drafts; only an admin update approves and needs `scheduled_at`; approved content frozen; server fields only via service_role), `social_claim()` / `social_token()` / `social_store_token()` (service_role only), public bucket `social-media` (admin write). Tests: `tests/db.test.mjs` (PGlite with auth/storage/vault stand-ins).
- `migrations/20261013100100_social_cron.sql`: pg_cron → `social-publish` (publish every 10 min, refresh-tokens weekly, cleanup daily) with Vault secrets `qnh_project_url`, `social_cron_secret`.
- `functions/social-publish/`: Instagram API with Instagram Login (`graph.instagram.com`, `GRAPH_VERSION` in `graph.ts`); logic in `publish.ts` (store + fetch injected), Deno tests `publish.test.ts` (`npm run test:functions`). Facebook prepared, off (`FACEBOOK_ENABLED`).
- Cockpit: `src/social/` (`validate.js` limits + Swiss time, `data.js`, `ui.js`, `package.js`, `demo.js`). Package format: `docs/social-paket.md`. Setup: `docs/social-setup.md`.
- Rules: nothing auto-approves; packages are always drafts; tokens only in Vault, entered by Christoph himself in the SQL editor; stage 2 (inbox, reply drafts) is an open item – no liking/following/commenting on other accounts.
