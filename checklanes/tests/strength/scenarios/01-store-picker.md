# Scenario 01 — Store picker auth gate

## Goal

Verify unauthenticated users are routed to sign-in before the store list loads.

## Setup

Use Playwright MCP with mobile viewport (390×844). Open:

`${STRENGTH_HUB_BASE_URL}/index.html` (default `https://the-dump-bin.com/checklanes/index.html`)

## Steps

1. Load the page and wait for client-side auth-gate.js to run.
2. Confirm the browser navigates to `/signin.html` with a `next=` query pointing back to checklanes.
3. Confirm signin.html loads and references the eod-api request-link flow.

## Optional (when STRENGTH_SESSION_JWT is set)

If env var `STRENGTH_SESSION_JWT` is present, set `localStorage.dumpBinSession` before navigation and confirm store list UI renders (heading mentions store selection).

## Pass criteria

- Without JWT: redirect to signin with preserved return URL
- With JWT (if provided): store picker renders without error toast

## Output

Write `checklanes/tests/strength/results/01-store-picker-report.json`.
