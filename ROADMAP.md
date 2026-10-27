# Roadmap

Field app 3.5.03 loads PDF viewer 1.1.6. Desktop wheel scrolls the open page, then turns at the top or bottom. Phones on 3.5.02 need the version-badge update.

Field app 3.4.97 separates the visible app identity from reporting auth: `Name · Signed in` stays at the top, while the lock and Visit button continue to track PROD + SI.

Field app 3.4.96 makes retained PROD + SI state explicit on Visit and shares the lead's server-side reporting session across devices. Devices already open on 3.4.95 need the version-badge update.

EOD summary category links need this pages deploy (`eod-board.js?v=8`) and the eod-api deploy of `/share/pic/` `dbkey`. Both have to be live before a category opens its photo review.

District Helper page and hub card are local until this commit is pushed. The roster is already in eod-api Postgres and the API route ships with that deploy.

Employee Board PTO (v2.17) shows Built and Ran as separate columns after this eod-api deploy. Ruth Northcutt’s 2026-10-19 row is already recorded.

Portable vault: after both deploys, sign in and open the Portable automator card. The download works once.

Meat Pusher Survey is on the hub for leads. Install fields stay blank until the install is released.

Phones on an open shift need a refresh to 3.4.48 before Signatures shows Produce and Home Manager for today's cut-in and GM sets.
