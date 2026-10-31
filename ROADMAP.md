# Roadmap

- Set Photo Capture auth (eod-api `fix/set-photos-dhe-auth`, deploy with the next batch): `/sheet` + `/upload` need a session (lead+/office) or a signed per-sheet token; the hub mints the tokenised link on card click. The field app's local mirror needs the session Bearer — `fix/set-photos-mirror-auth` — and that needs a **field-app publish** so phones stop 401ing on mirror uploads.
- Hidden-cards fix: published 2026-10-30. Any new hub card must either carry a `data-card` (access policy) or gate itself like the Notice Console card.


- Hidden-cards fix (branch `fix/hub-hidden-cards`): `.card[hidden] { display: none; }` so the 23 gated cards stop rendering for everyone; four-role gate matrix (rep / lead / supervisor D6 / admin, 360+390) green and screenshots in `docs/notice-console/phase-hidden-cards/`. **Not published — waiting on Tyson's look.** The audit table is in `AUDIT.md`; the weaker-than-the-card APIs it found (`/api/set-photos/*` unauthenticated, `/api/dhe/send` sign-in only) are open.

- Notice Console hub card (branch `feat/notice-console-card`): card + badge in Office & Admin, gated on eod-api `GET /api/field-alerts/console/me`, badge from `GET /api/field-alerts/console/summary`. Gate green at 360/390. Publish when Tyson says go, with (or after) the eod-api deploy that carries `/console/summary` — before that the card renders without a count.

- Notice console (branches `feat/notice-console-see` → `feat/notice-console-act`): `admin/field-alert-acks.html` is now the console — scoped notice list with status + counts, per-recipient detail unconfirmed-first, failures grouped by cause with fix hints, PDF per view, and the act sheet (remind / confirm for them / fix text / correct with diff / extend-expire / cancel). Phase C (send) is next; nothing is deployed and `main` is unchanged.
- Ack report (branch `fix/ack-report-channel`): the page shows the ack channel next to Understood. Merge + publish when Tyson says go; eod-api already serves `ack_channel`.
- AGENTS.md / .clinerules (same branch) carry the "never push `main` without an explicit go" guardrail.

Field app 3.5.06 and Dump Bin CSS 1.1.3 ship together. A phone already open on 3.5.05 needs the version-badge update before the overlay shows. The file-name layout needs this pages deploy.

Weekly briefing decks for P10W2 and P10W3 are on eod-api. This repo no longer publishes `weekly-briefing/source/*/deck.pdf`.

Field app 3.5.03 loads PDF viewer 1.1.6. Desktop wheel scrolls the open page, then turns at the top or bottom. Phones on 3.5.02 need the version-badge update.

Field app 3.4.97 separates the visible app identity from reporting auth: `Name · Signed in` stays at the top, while the lock and Visit button continue to track PROD + SI.

Field app 3.4.96 makes retained PROD + SI state explicit on Visit and shares the lead's server-side reporting session across devices. Devices already open on 3.4.95 need the version-badge update.

EOD summary category links need this pages deploy (`eod-board.js?v=8`) and the eod-api deploy of `/share/pic/` `dbkey`. Both have to be live before a category opens its photo review.

District Helper page and hub card are local until this commit is pushed. The roster is already in eod-api Postgres and the API route ships with that deploy.

Employee Board PTO (v2.17) shows Built and Ran as separate columns after this eod-api deploy. Ruth Northcutt’s 2026-10-19 row is already recorded.

Portable vault: after both deploys, sign in and open the Portable automator card. The download works once.

Meat Pusher Survey is on the hub for leads. Install fields stay blank until the install is released.

Phones on an open shift need a refresh to 3.4.48 before Signatures shows Produce and Home Manager for today's cut-in and GM sets.
