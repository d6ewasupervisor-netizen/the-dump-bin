# Audit

`meat-pusher-survey/review/` is the supervisor review board. Card id `meat-pusher-review`. Management links are minted by the API and open on eod-api, not through the hub sign-in gate.

`meat-pusher-survey/` is the packaged-meat shelf report. Card id `meat-pusher-survey`. The page posts to eod-api `/api/meat-pusher-survey`.

`welcome-letter-board/` is the Employee Board. The card id stays `welcome-letter-board`. Version on the page is v2.12. Work history is loaded from eod-api when a name is clicked.

Pilot source in this repo is `eod-field-app/`. Signature scope is `eod-field-app/js/lib/signoff-department.js`. Live `/EOD/` is a separate app and was not changed.
