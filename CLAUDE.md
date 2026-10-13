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
- **SecondSeat** (`C:\Projects\SecondSeat`): offline app without a server — shown as a note only.
- New app with an account: give it the same admin functions (ideally via QNH Core, `C:\Users\cu89\Desktop\Christoph\Fliegen\Website Flying\QNH Core`), then add it to `src/apps.js` and `.env`.

## Planned (version 2+)

App Store Connect (TestFlight/Store status, ratings, downloads), Codemagic build status, RevenueCat revenue. These need secret API keys, so they need a small server part (e.g. a Supabase Edge Function in a QNH project) — never keys in the browser. Hosting of the cockpit (e.g. cockpit.setqnh.ch) is not decided yet; ask Christoph.
