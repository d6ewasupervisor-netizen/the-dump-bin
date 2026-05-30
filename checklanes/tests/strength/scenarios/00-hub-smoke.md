# Scenario 00 — Hub smoke

## Goal

Confirm the assignment hub stack is reachable: GitHub Pages frontend, Railway eod-api, and POG static host.

## Commands to run first

From `checklanes/`:

```bash
npm run strength:smoke
```

## Pass criteria

- Script exits 0 with `"ok": true`
- auth-gate.js references eod-api
- `/checklanes/index.html` and `hub.html` return 200
- eod-api `/api/hub/stores` returns 401/403 without auth (proves Railway backend is up)
- `/api/hub/stores` without Bearer returns 401 or 403 (not 5xx)
- CORS allows `https://the-dump-bin.com`
- POG host `/health`, `/products.json`, and `/scan_index/615.json` succeed

## Output

Write `checklanes/tests/strength/results/00-hub-smoke-report.json`.
