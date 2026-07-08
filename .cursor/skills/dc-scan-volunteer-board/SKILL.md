---
name: dc-scan-volunteer-board
description: >-
  Operate the DC Scan volunteer dashboard on the-dump-bin.com: auth-gate sign-in,
  two-panel claim UI, PROD banner, Resync SAS PROD button, decide.html release/swap.
  Use when editing dc-scan/index.html or DC Scan UI on the dump bin.
---

# DC Scan dashboard (the-dump-bin)

API and SAS logic live in **eod-api** — see `eod-api/.cursor/skills/dc-scan-volunteer-board/SKILL.md`.

## Canonical files

| File | Role |
|------|------|
| `dc-scan/index.html` | **Production UI** (GitHub Pages) |
| `dc-scan.html` | Redirect to `/dc-scan/` |
| `signin.html` | Magic-link sign-in; support `?next=/dc-scan/` |
| `decide.html` | `type=dcscan` approve/deny release and swap |
| `auth-gate.js` | JWT session; `dumpBinAuthFetch` → eod-api |

Do **not** point the UI at `localhost` or eod-api static paths for production.

## API wiring

```js
window.dumpBinAuthFetch('/api/dc-scan' + path, opts)
// SSE: API_BASE + '/api/dc-scan/events?access_token=' + token
```

## UI behaviors to preserve

1. **Two sections:** this week (urgent) + going forward.
2. **Status badges:** Open, Claimed, Finalized, In PROD, Completed — from `snapshot` only (no page reload for resync).
3. **Resync SAS PROD** → `POST /api/dc-scan/resync` → `applySnapshot(data.snapshot)`.
4. **Finalize** disabled when all user pledges are `finalized` (not when `buildStatus === 'built'`).
5. **My list** shows `confirmed in PROD` vs `finalized, awaiting PROD`.
6. PROD banner: connected + visit count when `prod.ok`; warn when not.

## Deploy

Push `main` on **the-dump-bin** → GitHub Pages (workflow `.github/workflows/deploy-pages.yml`).
Hard-refresh after deploy. API changes require separate **eod-api** Railway deploy.

## Gotchas

- Claimed on the board ≠ In PROD — card stays **Claimed** until API snapshot shows PROD confirmation.
- After eod-api deploy, click **Resync SAS PROD** if banner stuck on pending.
- See eod-api skill `gotchas.md` for Railway/Windows and store-matching issues.
