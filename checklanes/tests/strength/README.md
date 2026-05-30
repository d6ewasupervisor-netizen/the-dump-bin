# Checklanes assignment hub — strength tests

Production stack under test:

- **Hub UI:** https://the-dump-bin.com/checklanes/ (GitHub Pages)
- **API:** https://eod-api.the-dump-bin.com (Railway)
- **POG static:** https://checklanes.the-dump-bin.com

## Run locally

From `checklanes/`:

```bash
npm run strength:smoke    # hub + API + POG smoke
npm run strength:load       # eod-api load test
npm run strength            # full suite (+ Cursor agents when CURSOR_API_KEY set)
```

Build agent harness after editing TypeScript:

```bash
cd tests/strength/agent && npm install && npm run build
```

## CI

`.github/workflows/strength-tests.yml` runs on PRs that touch `checklanes/` or `auth-gate.js`.

Optional secrets:

- `CURSOR_API_KEY` — agent scenarios
- `STRENGTH_SESSION_JWT` — authenticated store picker / hub shell walks

## Agent limitations

Without `STRENGTH_SESSION_JWT`, Playwright scenarios only verify the sign-in gate and hub shell redirects — not full assign/start/done flows.
