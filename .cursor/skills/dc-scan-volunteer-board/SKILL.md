---
name: dc-scan-volunteer-board-ui
description: >-
  Operate and troubleshoot the DC Scan volunteer board UI on the-dump-bin
  (dc-scan/index.html): auth-gate boot, black-screen failures, access-request
  banner, Resync SAS PROD, and GitHub Pages deploy. Use when DC Scan UI is blank,
  not loading, or needs front-end changes; pairs with eod-api dc-scan-volunteer-board skill.
---

# DC Scan board UI (the-dump-bin)

Canonical dashboard: `https://the-dump-bin.com/dc-scan/`  
File: `dc-scan/index.html`  
API: `https://eod-api.the-dump-bin.com/api/dc-scan/` (via `dumpBinAuthFetch`)

Backend skill: `eod-api/.cursor/skills/dc-scan-volunteer-board/`  
UI troubleshooting: [ui-troubleshooting.md](ui-troubleshooting.md)

## Deploy

UI changes require **push the-dump-bin to GitHub main** (GitHub Pages).  
API changes require **push eod-api** (Railway). Both repos for full features.

After deploy: hard-refresh on mobile (close tab or pull-to-refresh).

## Page structure

| Element | Purpose |
|---------|---------|
| `#boot-status` | Visible loading/error before `#app` un-hides |
| `#app` | Main board (`hidden` until `/api/me` succeeds) |
| `#access-gate` | Request-access banner when `canParticipate` is false |
| `#participant-panels` | Claim + My selections (read-only when no access) |
| `auth-gate.js` | **Must load in `<head>`** before body paint |

## Boot sequence

1. `await dumpBinAuthReady` — magic-link exchange or session check.
2. `GET /api/me` — show signed-in email; unhide `#app`.
3. `GET /api/dc-scan/approved-users` — show/hide access gate.
4. `GET /api/dc-scan/` — snapshot; optional cached `dc_scan_snapshot` in localStorage.
5. SSE `/api/dc-scan/events?access_token=…` — live updates.

## Access gate (signed in but not volunteer)

When `approved-users` returns `canParticipate: false`:

- Show `#access-gate` with request form or pending message.
- Add `read-only-actions` on claim panels (view board, cannot claim).
- Submit → `POST /api/dc-scan/access-request` with `{ name, reason }`.

Claim errors containing `allowlist` should point user to the access form above.

## UI conventions

- **Resync SAS PROD** → `POST /api/dc-scan/resync`; apply returned `snapshot` in place (no full reload).
- Release/swap → `decide.html?type=dcscan&id=…&token=…`
- Sign out → clear `dumpBinSession` / `eodSession` → `/signin.html?next=/dc-scan/`

## Validate JS before push

```powershell
node -e "const fs=require('fs'); const h=fs.readFileSync('dc-scan/index.html','utf8'); const m=h.match(/<script>\s*\(function \(\) \{([\s\S]*)\}\)\(\);/); if(!m) throw new Error('no script'); new Function(m[1]); console.log('syntax ok')"
```

Run from the-dump-bin repo root.

## Related

- Rule: `.cursor/rules/dc-scan-volunteer-board.mdc`
- API allowlist workflow: `eod-api/.cursor/skills/dc-scan-volunteer-board/access-and-allowlist.md`
