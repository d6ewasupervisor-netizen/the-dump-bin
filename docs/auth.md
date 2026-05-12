# Auth — How sign-in works on the-dump-bin.com

Replaces the old Cloudflare Access cookie. Every page under
`the-dump-bin.com` is gated by `/auth-gate.js`; users sign in once at
`/signin.html` and stay signed in for 45 days on that device, across
every tool on the site (EOD, claims, suncare, shirt order, etc.).

The eod-api Railway service (`eod-api.the-dump-bin.com`) is the auth
server — it issues magic links, verifies tokens, manages the allowlist,
and gates its own routes with the same JWT.

## Pieces

| Piece | Lives at | Job |
| ----- | -------- | --- |
| `/auth-gate.js` | this repo, hub root | Loaded by every gated page. Reads `localStorage.dumpBinSession`. If missing, redirects to `/signin.html`. If a magic-link `?token=` is present, swaps it for a session JWT via `GET /api/verify-token`. Exposes `window.dumpBinAuthFetch()` for sub-apps. |
| `/signin.html`  | this repo, hub root | Public. User enters email → `POST /api/request-link`. If the email isn't on the allowlist, an overlay collects the access request and `POST`s to `/api/access-request`. |
| `/admin.html`   | this repo, hub root | Public-ish (its own password gate). First-time setup uses `ADMIN_SETUP_TOKEN`; afterwards admin email + password. Provides CRUD over the `allowed_emails` table. |
| eod-api `/api/request-link` | Railway | Issues a one-shot `typ:'link'` JWT, stores its `jti` in `link_requests`, and emails the link via Resend (`From: The Dump Bin <noreply@retail-odyssey.com>`). |
| eod-api `/api/verify-token` | Railway | Exchanges the link JWT for a long-lived `typ:'session'` JWT (45 days). Marks the `link_requests` row used so it can't be replayed. |
| eod-api `/api/me` | Railway | Returns identity + roles for the bearer of a session JWT. Called on every page load that needs role-based UI (currently just EOD). |
| eod-api `/api/admin/session/*` | Railway | Admin password setup, login, forgot-password, reset, me. Issues `typ:'admin'` JWTs. |
| eod-api `/api/admin/allowed-emails` | Railway | CRUD on the allowlist. Admin JWT required. |
| eod-api `/api/access-request` + `/:id/(approve|deny)` | Railway | Self-serve access requests. Approval emails go to `ACCESS_REQUEST_APPROVERS` (defaults to Tyson). The approve/deny click in the email is HMAC-signed and atomic. |

## What's stored where

| Key | Where | Purpose |
| --- | ----- | ------- |
| `localStorage.dumpBinSession` | browser, `the-dump-bin.com` origin | 45-day user session JWT. Shared across every app on the site. Migrated from the older `eodSession` key on first read. |
| `localStorage.dumpBinAdminSession` | browser | Separate token for `/admin.html`. Signing out of admin does not log the user out of the rest of the site. Migrated from `eodAdminSession`. |
| `sessionStorage.dumpBinSignInError` | browser | One-shot error stash so `/signin.html` can surface "this link was already used" after auth-gate rejects a `?token=`. |
| `link_requests` | Postgres (eod-api DB) | Tracks single-use magic-link JTIs. |
| `allowed_emails` | Postgres | Per-email allowlist. Corporate domains (`@retailodyssey.com`, `@sasretailservices.com`, `@youradv.com`, `@advantagesolutions.net`) are implicitly allowed by `lib/allowed-emails.js` and don't need rows. |
| `site_admins` | Postgres | Admin accounts with bcrypt password hashes. Seeded with `tyson.gauthier@retailodyssey.com` (NULL hash = "setup pending"). |
| `admin_password_resets` | Postgres | Reset tokens (opaque, SHA-256 hashed at rest). |
| `access_requests` | Postgres | Self-serve access requests + their approve/deny audit trail. |

## Adding a new gated page

1. Add the page under `the-dump-bin/` (or in an existing sub-app folder).
2. Put this in `<head>` BEFORE any other `<script>`:
   ```html
   <script src="/auth-gate.js"></script>
   ```
3. Done. The gate will redirect to `/signin.html` if there's no session,
   swap any `?token=` it sees for a session JWT, and otherwise let the
   page render.
4. If your page calls eod-api, use `window.dumpBinAuthFetch('/api/your-route')`.
   It auto-attaches the bearer token and resolves the API base for you.
   Pass `{ noBounceOn401: true }` if your page wants to handle 401s itself
   instead of bouncing to sign-in.

## Excluding a page from the gate

Either name it `/signin.html` or `/admin.html` (they're hard-coded as
public in `auth-gate.js`), or don't include the gate `<script>` tag.

## Service workers

`/suncare/sw.js` caches its own HTML cache-first. After any change that
affects `suncare/index.html`, bump `CACHE_NAME` in `sw.js` so installed
PWAs don't serve the stale (un-gated) HTML.

## The EOD app source

The deployed EOD app lives at `the-dump-bin/EOD/index.html` in **this**
repo. The older `EOD/EOD/index.html` in the `eod-api` workspace
(`d6ewasupervisor-netizen/EOD` on GitHub) is frozen — see
`EOD/EOD/DEPRECATED.md` over there.

## Rollback

If something breaks during cutover:

1. **Frontend rollback (instant):** revert this repo to the commit before
   the auth changes. Push. Pages rebuilds. Users go back to whatever
   CF Access state the API expects.
2. **API rollback:** set `AUTH_MODE=cf-access` on the Railway service.
   The new session JWT routes still exist but the global gate goes back
   to verifying the CF Access JWT cookie. Re-enable the CF Access app(s)
   in Zero Trust if you disabled them.

## Cutover checklist

1. Set `JWT_SECRET`, `ADMIN_SETUP_TOKEN`, `ACCESS_REQUEST_SECRET`, and
   `FRONTEND_BASE_URL=https://the-dump-bin.com` on Railway.
2. Deploy eod-api. Confirm `/api/admin/session/status` reports
   `needsPasswordSetup: true, setupTokenConfigured: true`.
3. Visit `https://the-dump-bin.com/admin.html` and complete admin setup
   for `tyson.gauthier@retailodyssey.com`. Confirm the allowlist loads.
4. Push this repo. Wait for GitHub Pages to rebuild (~1 min).
5. From an incognito window, hit `https://the-dump-bin.com/` → should
   redirect to `/signin.html`. Sign in with an allowlisted email. Confirm
   the magic-link email arrives, click it, land back on the hub.
6. Verify EOD, claims, suncare, shirt-order all work from the hub.
7. **Now** flip `AUTH_MODE=session` on Railway and disable the CF Access
   app in Zero Trust.
