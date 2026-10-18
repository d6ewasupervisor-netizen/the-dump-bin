# Instawork → EOD sign-in and text clock: system reference

Last updated 2026-10-18. One page covering how a booked Instawork pro or a crew member ends up on the EOD time sheet, and the texting rules on the shift line.

> **Two copies, kept identical:** `the-dump-bin/eod-field-app/instawork-signin-and-sms-reference.md` (repo; published on the-dump-bin.com) and the Instawork project doc `claude/instawork-signin-and-sms-reference.md`. Edit one, update the other in the same change. This copy is public, so no personal phone numbers, keys, or tokens go in it.

## Flow
1. **Book**: SAS Retail Automator → Instawork tab books Merchandiser shifts by lead or store (v2.9.0+). Skill: `sas-instawork-booking`.
2. **Roster**: the extension's *EOD clock roster sync* reads each scoped store's Instawork groups (`timesheet-v2/shift-group/{id}`) and pushes them to eod-api `POST /api/instawork-clock/roster-sync`. Scope is My districts (default 8), a Store list, or All, applied before the pull. The service-worker courier mirrors the Instawork session to eod-api, so the server also polls hourly at :07 and 35 minutes before each group. Status: Instawork tab status line, or `GET /api/instawork-clock/sync-status`.
3. **Sign in**: the lead shows **one Sign-in QR** per store-day (sheetKey `any`) → `/share/clock/?j=` → the worker types their own phone → text code → greeting → time page. The phone is matched in this order: Instawork roster row → Kompass member by PROD phone → a phone the lead entered on a sheet row → *Not on today's list* (the lead taps **Assign to** on the card at the top of the sheet and the worker's phone continues on its own). PIN is only a fallback link (`&pin=1`).
4. **Next time**: a remembered device shows **Yes, continue** with no code. A new code is required when the last one is over 30 days old, when the phone resolves to a different person, or when the device was used at several stores in the same hour. **Not me** revokes the device.
5. **No signal**: text **IN / LUNCH / BACK / OUT / STATUS** to (509) 572-9212. The text writes the same timesheet row as the time page. A row the lead already confirmed is never overwritten.
6. **Lead view**: a method badge on each row: code / device / pin / tablet / sms.

## Texting rules (Twilio 10DLC, Sole Proprietor campaign, unchanged)
- **JOIN** (also START, YES, UNSTOP) is the only way onto the subscription.
- Any non-opt-out inbound text opens a **24-hour conversational window**. Clock replies use it (`reply:true`) and never subscribe anyone.
- **No proactive texts** on this line to anyone who hasn't texted JOIN, and that includes "your shift is tomorrow." Crew who have joined are fine.
- The first successful punch reply each day to a number that hasn't joined adds one line: "Reply JOIN for shift announcements and other work texts." It never goes to a number that has joined or texted STOP.
- **STOP** clears both the subscription and the window. A punch from a STOP'd number is saved, and no reply is sent.
- Every body starts with `TACTAG:`. Replies are folded to GSM-7 (a blank time is `-`); a reply that still isn't GSM-7 drops the JOIN line so it stays one 160-character message.
- **Owner, lead, supervisor and admin numbers** (the owner number plus `phone_logins` / `employees` roles) are never handled by the clock router: their IN/OUT/LUNCH/BACK/STATUS goes to the D8 agent inbox as before. Everyone else not on today's list gets "This number isn't on today's list."
- Sole-prop limits: one number, roughly 1,000 segments a day. Move to a standard brand with a Low-Volume Mixed campaign before the district-wide text clock-in plus login codes get near that.

## Where things live
- Extension: `sas-retail-automator` / `sas-automator-portable` (v2.10.1). Modules `instawork-*.js`; the courier runs in the service worker.
- eod-api: roster sync, device sign-in, the clock keyword router (`cb2bc69` latest), migrations 157–160. Skills `eod-instawork-roster-sync`, `eod-timesheet-join-pin`, `eod-sms-clock-keywords`.
- sms-outbox: conversational consent plus `GET /consent/:phone`.
- Field app: `the-dump-bin/eod-field-app` (v3.4.68+). The QR image is drawn by eod-api.

## Open items (2026-10-18)
- Shipped: clock router owner/lead fall-through and GSM-7 replies (eod-api `cb2bc69`).
- Not yet verified live: the 5:25 AM sweep, a crew sign-in with a real PROD phone, the assign-phone card after a real miss, and an SMS IN/OUT with the JOIN line from a phone that hasn't joined.

## Monday checklist
1. Before 5:30 AM: Instawork tab status line shows `Server poll … ok`; if the session is stale, press **Push session**, then **Sync to EOD clock**.
2. Lead shows the one Sign-in QR. Watch for anyone who hits *Not on today's list* and use **Assign to**.
3. Second phone that never texted JOIN: add it on the Instawork tab test panel, text IN → one message ending with the JOIN line; text OUT → no JOIN line.
4. Text STATUS from the owner phone → reaches the agent, no clock reply.
