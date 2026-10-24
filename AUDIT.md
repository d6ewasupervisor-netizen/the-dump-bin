# Audit

The Pathways hub card is `data-card="pathways"` in the Office & Admin section of `index.html`. `cardsForUser` adds it when `pathwaysAllowed` matches `PATHWAYS_ALLOWED_EMAILS`.

`meat-pusher-survey/review/` is the supervisor review board. Card id `meat-pusher-review`. Management links are minted by the API and open on eod-api, not through the hub sign-in gate.

`meat-pusher-survey/` is the packaged-meat shelf report. Card id `meat-pusher-survey`. The page posts to eod-api `/api/meat-pusher-survey`.

`welcome-letter-board/` is the Employee Board. The card id stays `welcome-letter-board`. Version on the page is v2.22. A sent notice opens the stored letter, and Download saves the `.eml`. Current employees show personal email, work email, phone, and last punch. Yellow, orange, and red mark a stale punch, an open notice, and a final notice. Past employees is a separate tab. The PTO tab calls `/api/pto`. Built and Ran are separate columns. Build and run is hidden once the shift has been ran. The step list stays on the request. Access is `/api/me` `hasWelcomeLetterAccess` (office group). A 401 goes to sign-in. A failed check asks for a refresh. The supervisor card is only for a 200 that is not office. Work history is loaded from eod-api when a name is clicked. Welcome Letter is v2.6 with the same check.

Text files are LF. `.gitattributes` sets `* text=auto eol=lf`, and `.editorconfig` sets `end_of_line = lf`.

Pilot source in this repo is `eod-field-app/`. Signature scope is `eod-field-app/js/lib/signoff-department.js`. The hub home no longer shows the EOD Cover Sheet card. `/EOD/` redirects to `/eod-field-app/`. Live `/EOD/` Instawork filing (2.17.8) is behind that redirect.
