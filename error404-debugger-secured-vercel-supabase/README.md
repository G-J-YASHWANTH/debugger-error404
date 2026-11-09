# ERROR 404 Debugger — Vercel + Supabase (secured build)

This ZIP is the single-site participant + organizer application. Deploy the contents of this ZIP from its root. It uses Vercel serverless functions in `api/` and Supabase from server-side code in `lib/`.

## What changed in this security update

- Organizer-only writes to `/api/control` and organizer roster additions through `/api/players` require the signed, HttpOnly organizer session.
- Participant registration issues a cryptographically random participant capability token. The browser stores it locally and must present it for later updates to that participant record.
- A participant token is stored only as a SHA-256 hash in Supabase. It is never returned by participant list APIs.
- Public `/api/players` reads return leaderboard-safe fields only. Organizer sessions receive the extra monitoring fields and anti-cheat warning log.
- Participant progress is validated and bounded; participant identity/name/type cannot be changed by later progress submissions, and progress counters cannot be reduced.
- Cross-origin browser POST requests are rejected.
- Organizer login uses constant-time password comparison and a best-effort per-instance failed-login throttle.
- API responses are marked `Cache-Control: no-store`.
- Supabase tables used by this ZIP have RLS enabled and direct `anon`/`authenticated` table grants revoked. The Vercel server uses the service-role key; it must remain server-side.

## 1. Supabase database migration

1. Open the existing Supabase project → SQL Editor → New query.
2. Open the `schema.sql` included in this ZIP and copy all of it.
3. Paste it into the SQL Editor and click Run.
4. This is an additive migration: it creates missing tables, adds `participant_token_hash` if missing, enables RLS, and restricts direct table access. It does not drop participant or activity rows.

The SQL expects these tables: `participants`, `activities`, and `game_control`.

### Existing participants

Rows created by the older unsecured version have no participant token hash. On their next lobby entry, the browser automatically creates a fresh participant ID and receives a new token. The old row is retained for historical leaderboard/reporting; it is not overwritten or deleted.

## 2. Vercel environment variables

Set these in Vercel → Project → Settings → Environment Variables:

- `SUPABASE_URL` — exact Project URL from Supabase.
- `SUPABASE_SERVICE_ROLE_KEY` — Supabase service-role secret key. Never expose it in browser code or commit it to GitHub.
- `ORGANIZER_PASSWORD` — a strong, unique organizer password.
- `SESSION_SECRET` — a long random secret used to sign the organizer session cookie.

Set them for Production (and Preview/Development only if you use those environments). Redeploy after changing variables.

## 3. Vercel build settings

For this ZIP, deploy from its root directory:

- Framework Preset: Other
- Root Directory: `.`
- Build Command: leave empty
- Output Directory: leave empty
- Install Command: `npm install` (or the Vercel default)

The root contains `index.html`, `api/`, `lib/`, and `vercel.json`.

## 4. Test after deployment

- Main app: `https://YOUR-DOMAIN.vercel.app/`
- Health: `https://YOUR-DOMAIN.vercel.app/api/health`
- Organizer: `https://YOUR-DOMAIN.vercel.app/#organizer`

Test in this order: organizer login → add a test participant → participant joins from a second browser/device → participant appears in organizer list → advance question → pause/resume → leaderboard → finish event.

## 5. Important notes about older Supabase functions/views

The older `events`, `competitors`, `team_members`, `public_questions`, and related `SECURITY DEFINER` functions shown in Supabase Security Advisor are not called by this ZIP. This ZIP uses `participants`, `activities`, and `game_control` through its Vercel API. Do not bulk-revoke or rewrite the older functions until you have confirmed no other deployed app or workflow still uses them.

Security Advisor may still report the old functions or view. Review those separately; this ZIP's migration intentionally does not modify or drop them.

## Included

- Participant interface and organizer dashboard in one site
- Python 3 challenges executed in the participant browser with Pyodide
- Supabase persistence through Vercel API routes
- Organizer password login with HttpOnly session cookie
- Shared game controls and polling for participant synchronization
- Participant activity logging and organizer CSV exports
- Public leaderboard-safe participant data
- Server-side participant capability tokens for progress updates
