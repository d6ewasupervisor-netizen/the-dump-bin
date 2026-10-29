# Agent rules (the-dump-bin)

## Main is the published site (mandatory)

**Never push to `main` without an explicit go from Tyson in the current message.** Feature work goes on branches. Asking for a change is NOT permission to push `main`; a past go does not carry forward. `main` publishes to the-dump-bin.com (GitHub Pages), including the admin pages that supervisors use.

## Outbound mail and texts

No email, SMS, magic link, or invite goes to a real person unless Tyson asks for that send in the current turn.

## Repo shape

Static hosting: `index.html`, per-app folders (`eod-field-app/`, `EOD/`, `eod-board/`), `admin/` pages, and `weekly-briefing/`. Pages that call eod-api live here; the API itself is `C:/Users/tgaut/eod-api`. `admin/field-alert-acks.html` renders `GET /api/field-alerts/report`.
