# Agent log

## 2026-10-22 — Contacts only on the selected employee

The current roster list is name and last punch. Personal email, work email, and phone stay on the person after the name is clicked. Past employees still lists those contacts. `welcome-letter-board.js?v=2.23`.

## 2026-10-22 — Sent notice opens and downloads

A notice in Communication opens the stored letter. Download saves that message as an `.eml`. `welcome-letter-board.js?v=2.22`.

## 2026-10-22 — Past employees tab and roster colors

Current employees show personal email, work email, phone, and last punch. Yellow is a punch older than 14 days. Orange is an open initial or job-abandonment notice. Red is a final notice for someone still on the roster. Past employees is its own tab. `welcome-letter-board.js?v=2.21`.

## 2026-10-22 — Time logged range on the employee list

The list column is Last logged. A name opens the last 15 days. From and To apply a range back to January 1. `welcome-letter-board.js?v=2.20`.

## 2026-10-22 — Notice preview is the letter that sends

The subject line, the letter paragraphs, the signature, and an addendum line can be edited in the preview. Send is refused until that preview is current. `welcome-letter-board.js?v=2.19`.

## 2026-10-22 — Notice preview names the CC list

The notice preview status reads CC from the API (`cc`, then `bcc` if an older API is still up). `welcome-letter-board.js?v=2.18`.

## 2026-10-21 — Built and Ran on Time off

The PTO table has a Built column and a Ran column. `welcome-letter-board.js?v=2.17`.

## 2026-10-21 — Employee Board PTO steps

Build and run on Time off lists each step: the window, a slide when the start is taken, the visit and shift, the punch, the completion, and the total. The shift note from the API includes the hours. `welcome-letter-board.js?v=2.16`.

## 2026-10-20 — EOD board version and size

Each category on the summary board shows the planogram version and the size under the name (`VN18 · 4 doors`). `eod-board.css` and `eod-board.js` at `?v=7`.

## 2026-10-20 — Clock board: test link and far flag

The InstaWork clock board shows the sign-in method, **Far from store** when a link or code clock-in is more than a mile out, and **Send test link** for a supervisor on today's District 8 row. `instawork-clock.js?v=3`. The reference lists the dry run, the test send, the STOP line, and the first live pre-shift link as not yet verified.

## 2026-10-20 — Instawork reference: JOIN once, extension v2.11.1

`eod-field-app/instawork-signin-and-sms-reference.md`: step 0 says a pro who already joined from the phone on their Instawork account does not join again. The extension line is v2.11.1. Step 6 now describes the shipped pre-shift link (`cda462d`, migration 166). The project copy needs the same lines.

## 2026-10-20 — EOD board columns

Categories on the summary board split the width: name 30%, DBKey 10%, Status 14%, Exception 20%, PROD comment 16%, Edit 10%. Edit and Remove stack. `eod-board.css` and `eod-board.js` at `?v=6`.

## 2026-10-20 — Field app 3.4.74: EOD Board in More

More and the desktop side nav open the EOD summary board in a new tab. Past summaries and signoff boards stay on that page.

## 2026-10-20 — EOD summary board: category number, Status, Exception

`eod-board/` now matches eod-api's `src/public/eod-board/` (copied, identical). Categories show the category number in a box in the Category cell, then DBKey, Status (Complete green, Incomplete red), Exception, and PROD comment, the same columns as the shift-summary email. Cleared-exception rows show the same box by DBKey. `eod-board.css` and `eod-board.js` at `?v=4`. Needs eod-api `catId` on `/api/eod-board/detail`; without it the box is simply absent.

## 2026-10-19 — Field app 3.4.71: text-miss card

Pilot 3.4.71 ships `js/features/timesheet-mgmt.js` and the version files only. The time sheet shows a card for a clock text from a number not on today's list (last 4 digits, keyword, time) with **Assign to** and **Dismiss**, and the QR **Assign to** sends store and date. The Instawork reference gains two texting-rule lines and points at eod-api `7fad2ab`, migrations through 164, and field app 3.4.71. The project copy needs the same lines.

## 2026-10-19 — Instawork reference: sender identity and IN-only clock-in

`eod-field-app/instawork-signin-and-sms-reference.md` texting rules gain two lines: inbound texts carry the sender's identity and a pro's JOIN or START is logged without waking the agent; clock in is IN or CLOCK IN and START is never a clock keyword. The router line points at eod-api `165463b` and migration 163. Doc only, no field-app version bump. The Instawork project copy `claude/instawork-signin-and-sms-reference.md` still needs the same lines.

## 2026-10-19 — Employee Board PTO tab

v2.15 adds a PTO tab. It lists time-off requests and can approve, deny, or build and run the PROD shift. The employee log for that request sits under the row.

## 2026-10-19 — Employee Board false access card

`tyson.gauthier@retailodyssey.com` is admin and office. A fresh sign-in opens the Employee Board. A failed `/api/me` (dead session or the API restarting) used to show the supervisor card. v2.14 retries, sends a 401 to sign-in, and only shows that card when the account is actually outside office. Welcome Letter v2.6 does the same.

## 2026-10-16 — FM135 on the InstaWork id list

`EOD/Timesheets/instawork_ids.csv` includes FM135, FredMeyer135, with FM136–FM140.

## 2026-10-16 — Strip board opens the latest week

The store list no longer defaults to District 8 P08W2. With no `campaign` query it loads the newest week that has sets, District 8 first. P10W2 is District 8 stores 459 and 682, and a D6 chip for 351 and 657. P08W2 stays on the week list.

## 2026-10-15 — Portable vault card

Home card `portable-vault` links to `/portable-vault/`. The page is the one-time portable automator download and the remote setup steps. It stays hidden until `/api/me` includes that card.

## 2026-10-15 — Field app 3.4.56 door counts

Categories treats a `D###` planogram token as doors. Four milk doors stay four photos. The size line uses the sheet label (`4 doors`) when it already names the unit.

## 2026-10-15 — EOD Cover Sheet card removed

The Daily Tools card is gone from the hub home. `/EOD/` now opens EOD Field Pilot.

## 2026-10-14 — Meat pusher manual lead

Outreach store rows can assign a lead pulled elsewhere in the same district, or a name and email typed on the row.

## 2026-10-14 — InstaWork Clock-in overview

`/instawork-clock/` is a hub-session page (loads `/auth-gate.js`) for leads, supervisors, admins, and office. It lists each InstaWork roster store-day from `GET /api/instawork-clock/overview` on eod-api: name, phone, placeholder slot, verify time, punches, signed, confirmed by. Card `instawork-clock` on the home page. Workers themselves use `https://eod-api.the-dump-bin.com/share/clock/`, not this page.

## 2026-10-13 — InstaWork timesheet name and signature

Live EOD 2.17.8 blocks InstaWork download, print, email, and submit to office until the lead has entered each InstaWorker's name and that person has signed. Sign on tablet and the text/email link save the name first.

## 2026-10-09 — Meat pusher stacked photos

Filled sheet uses every checked store, one page each.

## 2026-10-09 — Meat pusher comments

The survey and review have a comment field. It prints on that store's sheet page.

## 2026-10-09 — Store 19 Heat & Serve

The review answer for that set is the Not in store line, without a second copy of the note.

## 2026-10-09 — Meat pusher one page per store

Print builds a sheet with one page per checked store, answers and photos together.

## 2026-10-09 — Meat pusher names

The survey and review pages no longer show who filed the store.

## 2026-10-09 — Meat pusher print

The review page prints the checked stores on one sheet.

## 2026-10-09 — Meat pusher duplicate sends

Choosing a different store clears the photo fields so the last store's pictures cannot be sent again.

## 2026-10-09 — Meat pusher store list

Store is a dropdown of the ten District 8 stores, lowest number first. Completed stores are gray. Opening one asks before the saved answers load.

## 2026-10-09 — Meat pusher review

Card `meat-pusher-review` opens `/meat-pusher-survey/review/`. The filled sheet downloads from eod-api.

## 2026-10-09

Meat Pusher Survey card opens `/meat-pusher-survey/`. The card stays hidden until the session includes that card id.

## 2026-10-08

The Welcome Letter Board card and page are named Employee Board. A name opens the last two weeks of PROD work on the page. `view in prod` sits beside the name.

## 2026-10-05

Published field-app 3.4.48. Signatures include Produce for a same-day cut-in and Home Manager for GM sets on planogram department 03. The first GitHub Pages deploy failed to attach its artifact, so this entry republishes that same app.
