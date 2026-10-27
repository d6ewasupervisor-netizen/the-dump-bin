# Audit

Pilot `#eodSignedIn` is the shift lead's name. It adds `· Signed in` only when that lead's PROD/SAS session is connected and Okta has not ended. The lock icon and Visit control remain the PROD + SI indicators.

Pilot reporting readiness is `reportingReady` in `eod-field-app/js/lib/sas-user-login-logic.js`: shared actor, or retained PROD plus SI. A Dump Bin identity or `uploadReady` fallback is not presented as a completed reporting login. Visit opens the central PROD + SI sheet while either retained side is missing; the account itself stays encrypted on eod-api under the lead email and is reused across their devices.

The Pathways hub card is `data-card="pathways"` in the Office & Admin section of `index.html`. It links to `/pathways/`. `https://eod-api.the-dump-bin.com/pathways` redirects there. `cardsForUser` adds the card when `pathwaysAllowed` matches `PATHWAYS_ALLOWED_EMAILS`. Compliance (`pathways.js?v=6`) is one closed row per person, with a checkbox and Select all above the list. A name is red when any course is overdue. Pull now sends `user_ids` only when the checkboxes are a subset of the roster. Owed is a course that is not completed and is overdue or required. Completions are completed courses. The CSV download still lists every course.

`meat-pusher-survey/review/` is the supervisor review board. Card id `meat-pusher-review`. Management links are minted by the API and open on eod-api, not through the hub sign-in gate.

`meat-pusher-survey/` is the packaged-meat shelf report. Card id `meat-pusher-survey`. The page posts to eod-api `/api/meat-pusher-survey`.

`welcome-letter-board/` is the Employee Board. The card id stays `welcome-letter-board`. Version on the page is v2.22. A sent notice opens the stored letter, and Download saves the `.eml`. Current employees show personal email, work email, phone, and last punch. Yellow, orange, and red mark a stale punch, an open notice, and a final notice. Past employees is a separate tab. The PTO tab calls `/api/pto`. Built and Ran are separate columns. Build and run is hidden once the shift has been ran. The step list stays on the request. Access is `/api/me` `hasWelcomeLetterAccess` (office group). A 401 goes to sign-in. A failed check asks for a refresh. The supervisor card is only for a 200 that is not office. Work history is loaded from eod-api when a name is clicked. Welcome Letter is v2.6 with the same check.

The Dump Bin PDF viewer is `shared/pdf-viewer/materials-pdf-viewer.js` (1.1.5), opened from `dump-bin/` and `/pdf/`. Desktop wheel up/down turns pages. Touch swipe left/right still turns pages. Ctrl+wheel zooms. A zoomed page scrolls until its top or bottom edge, then the next wheel turns the page. The field app (3.5.02) requests `materials-pdf-viewer.js?v=1.1.5`.

Text files are LF. `.gitattributes` sets `* text=auto eol=lf`, and `.editorconfig` sets `end_of_line = lf`.

Pilot source in this repo is `eod-field-app/`. Signature scope is `eod-field-app/js/lib/signoff-department.js`. The hub home no longer shows the EOD Cover Sheet card. `/EOD/` redirects to `/eod-field-app/`. Live `/EOD/` Instawork filing (2.17.8) is behind that redirect.
