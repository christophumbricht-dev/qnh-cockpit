# Task: Social module + hosting on cockpit.setqnh.ch (Christoph, 13 Oct 2026)

Goal: the cockpit runs online at **https://cockpit.setqnh.ch** and gets a **Social** tab: post queue per app
(Downwind, SecondSeat, later more), Christoph approves every post, a small server part publishes it to Instagram
(Facebook prepared) at the planned time. Everything free (GitHub Pages, Supabase free plan, Meta Graph API).

Rules (as always): talk German to Christoph, code/commits English. Commit after each point on `main`
(repo has no commits yet: first commit = current state, check `.env` is ignored). **No push, no repo creation,
no deploys, no Supabase project creation, migrations written but not applied, no secrets anywhere in the repo or chat.**
Do not touch `C:\QNH\02_Apps\Downwind\app`. German summary + test list at the end.

## H – Hosting on cockpit.setqnh.ch (static, GitHub Pages)
- **H1 First commit + safety.** Rename branch to `main`. `.gitignore` covers `.env`, `dist`, `node_modules`.
  Add `npm run check:secrets`: fails if `src/`, `dist/` or `supabase/` contain a service_role/secret key
  (`service_role`, `sb_secret_`, JWTs with role service_role), a Meta token (`EAA…`, `IGAA…`) or `.env` values other
  than `VITE_*_URL` / `VITE_*_ANON_KEY`. Run it in the build workflow.
- **H2 Not public-facing.** `<meta name="robots" content="noindex,nofollow">`, `public/robots.txt` (Disallow: /),
  strict CSP meta tag (self + the Supabase project URLs + graph.facebook.com not needed in the browser), no analytics.
  Login screen says only "QNH Cockpit – intern". Data stays protected by the admin functions (is_admin / qnh_admins),
  not by hiding the URL.
- **H3 GitHub Pages workflow.** `.github/workflows/pages.yml`: on push to `main` → `npm ci`, `npm test`,
  `npm run check:secrets`, `npm run build` with the `VITE_*` values from **repository variables** (public values,
  not secrets), deploy with `actions/deploy-pages`. `public/CNAME` = `cockpit.setqnh.ch`. SPA fallback (`404.html`
  copy of index) if routing needs it. `?demo` keeps working online.
- **H4 Guide.** `docs/hosting.md` (German, for Christoph): create GitHub repo `qnh-cockpit` (private is fine; Pages
  on a private repo needs GitHub Pro – if he has the free plan, explain the choice: public repo is OK because no
  secrets are in it, or Cloudflare Pages free as alternative), set repository variables, enable Pages (source:
  GitHub Actions), DNS at the registrar: `CNAME cockpit → christophumbricht-dev.github.io`, enforce HTTPS,
  Supabase → Authentication → URL configuration: add `https://cockpit.setqnh.ch` (for every app project the cockpit
  signs in to). Exact click paths, no guessing – where unsure, say "check in the UI".

## S – Social module, stage 1 (publish with approval)
Backend lives in a separate free Supabase project **"QNH Core"** (Christoph creates it; region Zurich if offered).
First check `C:\QNH\02_Apps\_Vorlage-QNH-Core` – if there is already a QNH Core
setup, build on it and tell Christoph; otherwise put the backend in `qnh-cockpit/supabase/` (migrations + functions).
The cockpit signs in to QNH Core like to the apps (same 6-digit code flow, `shouldCreateUser: false`; Christoph
creates his user once in the Supabase dashboard – describe it).

- **S1 Data model (migration, not applied).**
  - `qnh_admins(user_id)` + `is_qnh_admin()`; RLS on everything: only admins read/write.
  - `social_accounts`: id, app_id (`downwind`, `secondseat`, …), platform (`instagram` | `facebook`), remote ids
    (ig user id / page id), handle, active. **No tokens in tables readable by clients.**
  - Tokens: in **Supabase Vault** (one secret per account, name e.g. `meta_token_downwind_instagram`), read only by
    the Edge Function via a `security definer` function not exposed to `anon`/`authenticated`. Weekly cron refreshes
    long-lived tokens and writes them back to Vault; cockpit shows only "Token gültig bis …".
  - `social_posts`: id, account_id, kind (`image` | `carousel` | `reel` | `story`), caption, first_comment,
    media jsonb `[{path, type, alt}]`, cover_path, status (`draft` | `approved` | `publishing` | `published` |
    `failed` | `cancelled`), scheduled_at (timestamptz, UI in Europe/Zurich), approved_at, approved_by,
    published_at, remote_media_id, permalink, attempts, last_error, created_by, created_at, updated_at.
    Only an admin action sets `approved`; nothing auto-approves.
  - Storage bucket `social-media`: public read (Meta must fetch the files by URL), write admins only; files of
    published posts are deleted after 14 days (cron), the post keeps the permalink.
- **S2 Edge Function `social-publish`.** Called by pg_cron every 10 min (shared secret header) and by the cockpit
  button "Jetzt veröffentlichen" (admin JWT). Atomically picks approved posts with `scheduled_at <= now()`
  (status → `publishing`). Instagram Content Publishing flow: container(s) → for videos poll `status_code` until
  `FINISHED` → `media_publish` → optional first comment → store id + permalink. Carousels (2–10), Reels, Stories.
  Errors → `failed` with readable German `last_error`, max 3 attempts, no double posting (idempotent: check
  `remote_media_id` before publishing again). Respect the daily publishing limit (query `content_publishing_limit`).
  Graph API version as one constant. Choose and document the login type (Instagram API with Instagram Login vs.
  Facebook Login) – prefer the one that needs no Facebook Page if it supports everything above; list the needed
  permissions. Facebook Page posting: prepared in code, off by default.
- **S3 Cockpit tab "Social".** Per app: lists Entwürfe / Geplant / Veröffentlicht / Fehler. Editor: upload images or
  video (drag & drop), checks before saving (JPEG for images; aspect 4:5, 1:1 or 1.91:1 for feed, 9:16 for
  story/reel; video MP4/H.264, length limits per kind), caption with counter (2200), hashtag count (warn > 15,
  block > 30), first comment, alt text, phone-frame preview, date/time picker (Europe/Zurich). Buttons: Speichern
  (Entwurf), **Freigeben** (needs a time; confirmation shows account, time and first lines), Zurückziehen,
  Duplizieren (e.g. same post for another app account), Jetzt veröffentlichen (confirmation). Status updates live.
  Overview tile "Social: n geplant, n Fehler". Works in `?demo` with sample posts.
- **S4 Post packages (bridge to Claude chat).** "Paket importieren": a folder or zip with `post.json`
  (`{account: "downwind/instagram", kind, caption, first_comment, alt, suggested_time, media: ["1.jpg", …]}`) +
  media files → creates a **draft** (never approved). Document the format in `docs/social-paket.md` with an example,
  so posts prepared in the Claude chat can be dropped in.
- **S5 Tests.** Unit tests for validation (aspect ratios, caption/hashtag limits, time zone) and the package import;
  Deno tests for the Edge Function with a mocked Graph API (happy path, video polling, failure + retry, no double
  post, limit reached).
- **S6 Guide.** `docs/social-setup.md` (German, for Christoph), in order: Instagram account → Business/Creator;
  Meta developer account + app; permissions; generate the long-lived token and paste it **himself** into Vault
  (SQL snippet with placeholder, run in the Supabase SQL editor – never in chat); create QNH Core project; apply
  migration; deploy function; set cron secret; first test post as Story with a test image. Mark every step that
  costs money (none expected) or needs Meta review (if any – say so plainly).

## Stage 2 (later, NOT now) – note only
Inbox: comments on own posts and DMs (reply drafts, Christoph sends), hide spam, welcome message. No liking/following/
commenting on other accounts – against Instagram rules. Write it as an open item in `docs/social-setup.md`.

## At the end
German summary, test list (demo mode, package import, publish with mocked API), and Christoph's to-do list for
going live (GitHub repo, DNS, Supabase QNH Core, Meta app, token).
