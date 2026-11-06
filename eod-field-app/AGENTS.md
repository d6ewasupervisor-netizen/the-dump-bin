# Agent rules (eod-field-app)

## Main is what the fleet runs (mandatory)

**Never push to `main` without an explicit go from Tyson in the current message.** Feature work goes on branches. Asking for a change is NOT permission to push `main`; a past go does not carry forward. `main` is the published field app; shipping is a separate, explicit step (see skill `eod-field-app-publish`).

## Two surfaces, one backend

"Field app" = the live pilot at `/eod-field-app/`. The fleet runs `/EOD/`. They share the eod-api backend, so a backend change reaches the fleet immediately. Do not cut `/EOD/` over to pilot code until `CUTOVER.md` conditions are met, and do not ship pilot work to `/EOD/`.

## Outbound mail and texts

No email, SMS, magic link, or invite goes to a real person unless Tyson asks for that send in the current turn.

## Stack

Node-free static JS: `js/features/`, `js/lib/`, `boot.js`. Publish with the `eod-field-app-publish` skill (pilot surface only unless told otherwise).
