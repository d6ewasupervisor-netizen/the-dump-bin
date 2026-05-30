# Scenario 02 — Hub dashboard shell

## Goal

Verify hub.html loads and enforces required query params.

## Setup

Use Playwright MCP, mobile viewport.

## Steps

1. Open `${STRENGTH_HUB_BASE_URL}/hub.html` with no query string.
2. Confirm redirect or navigation back to the store picker (`index.html`).
3. Open `${STRENGTH_HUB_BASE_URL}/hub.html?store=615&visit=1` (visit id may be placeholder).
4. Without session JWT: expect sign-in redirect.
5. With session JWT (if `STRENGTH_SESSION_JWT` set): confirm hub shell loads (fixture grid or loading state, not a blank error page).

## Pass criteria

- Missing `store`/`visit` params do not leave user on a broken hub page
- Hub shell HTML/JS loads from GitHub Pages (no 404 on hub-presence.js, planogram.js)

## Limitations

- Full assign/start/done flows require a valid visit id and rank — out of scope unless JWT + visit env provided

## Output

Write `checklanes/tests/strength/results/02-hub-shell-report.json`.
