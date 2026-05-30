# Scenario 03 — POG static dependency

## Goal

Confirm the hub's planogram static host serves assets the dashboard fetches.

## Commands

```bash
npm run strength:smoke
```

Focus on POG checks in the JSON output: `/health`, `/products.json`, `/pog_previews.json`, `/scan_index/615.json`.

## Additional manual fetch

`GET ${STRENGTH_POG_BASE_URL}/pog_layouts/8920140.json` should return valid JSON with a `bays` array.

## Pass criteria

- All POG endpoints in smoke output pass
- Sample layout JSON parses

## Output

Write `checklanes/tests/strength/results/03-pog-static-report.json`.
