# Scenario 04 — API load

## Goal

Run concurrent load against eod-api `/api/hub/stores` (401/403 expected; 5xx fails).

## Commands

From `checklanes/`:

```bash
npm run strength:load
```

## Pass criteria

- Exit 0, `"ok": true`
- Zero errors, p99 within threshold

## Output

Write `checklanes/tests/strength/results/04-api-load-report.json`.
