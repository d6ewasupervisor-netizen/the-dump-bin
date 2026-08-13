# Cutover gate (do not skip)

Production Dump Bin EOD stays on last known good until **explicit** approval.

## Hard rules during rebuild

- Do **not** commit or push to `the-dump-bin` / live Pages for EOD mid-build.
- Do **not** replace `the-dump-bin/EOD/` until the user says to cut over.
- All work stays in `C:\Users\tgaut\eod-field-app` (this repo).
- Railway eod-api changes only if an API gap blocks pilot (prefer none for MVP).

## When cutover is approved (checklist)

1. Finish `PARITY.md` pilot on store 999 + one real store.
2. Confirm drafts/photos/day-confirm load in greenfield from a mid-week phone.
3. Confirm Send payload parity (preview vs live for one test store).
4. User explicitly says go (e.g. “cut over” / “PR into Dump Bin”).
5. One controlled PR: copy/replace into `the-dump-bin/EOD/`, bump production `eod-version.json` off `2.13.x`.
6. Deploy Pages; leave Railway alone unless required.
7. Keep pilot `3.0.0-pilot` history in this repo for rollback reference.

Until step 4 happens, this todo is **documented and gated** — not executed.
