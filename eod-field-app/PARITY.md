# Parity — field pilot 3.3 vs live EOD 2.17.7

**Parity** means the field app can close a real Kompass day on the same eod-api production backend, with the same phone storage keys, without replacing live `/EOD/` until cutover (`CUTOVER.md`).

| App | URL | Version |
|-----|-----|---------|
| Live (leave alone) | https://the-dump-bin.com/EOD/ | 2.17.7 |
| Pilot | https://the-dump-bin.com/eod-field-app/ | 3.3.x |

Same API: `https://eod-api.the-dump-bin.com`. Same keys: `kompassEOD`, `kompassProfile`, `kompassSignature`, `kompassDayConfirm`, IndexedDB `kompassEODPhotos`.

## What this build does (board answers)

Port / mix from the live walk — not a pixel clone:

- Storage telemetry headers + `navigator.storage.persist()` on boot
- Roles from `GET /api/me` (roster add/remove, force-live)
- Overlay alerts instead of chained native dialogs
- `#/photos` restored (Dump Bin keeps its own tab)
- Camera + torch for cart / paper / InstaWork / helpdesk; HEIC via heic2any
- Paper sign-off when no hosted sheet; hide paper when a sheet exists
- InstaWork Confirm & Save → `POST https://eod-api.the-dump-bin.com/instawork/save-image` (never localhost)
- Unsent-session banner + compress old photos
- PIC QR on Signatures; checkout auto-fill
- JOIN QR + SMS opt-in on Crew; hide Yes/No timesheet questions
- SAS roster add (immediate) and removal request (poll if pending)
- Send gates: check-in/out, cart before/after, digital marks (or Acknowledge remaining), IW photo if InstaWork opened
- EOD coversheet JPEG in the send package + MAINTENANCE afters on the main ISE visit (skip store 999)
- Post-send clear: ask / always / never (`eodPostSendClearPref`)
- Helpdesk Aiyana CC only on District 8 stores
- Feedback hub → `POST /api/app-feedback`
- Usage: `X-EOD-Version` 3.x attributes cover-path traffic to `eod-field-app`

Kept as-is: day-confirm front door, exact store match, digital marks as the heart, field-set capture, Dump Bin iframe, themes, timesheet overlays, dept PIC wizard, artifact part upload, sandbox clone-shift, visit reset popup.

Skipped: Cover page questions, PWA rename, Request Auth bar, materials overlay as primary, More drawer, tab memory, Weekly Rebotics UI, full cover-sync / Use-PROD photo board.

## How to run

```bat
cd C:\Users\tgaut\eod-field-app
npx --yes serve -l 5173
```

Hosted: https://the-dump-bin.com/eod-field-app/  
Localhost needs its own Dump Bin JWT (Pilot sign-in card).

## Smoke checklist

1. Confirm store + date (999 first, then a real store).
2. Find shifts — one visit auto-selects; two+ pick ISE and optionally Also this visit.
3. Cart before (camera or No Kompass Cart) → Categories marks → Signatures PIC QR → Crew JOIN/IW → Send.
4. Hosted sheet: marks or Acknowledge remaining gate Send. No sheet: paper photo path on Photos.
5. Send includes coversheet + signoff + cart photos; after send, choose Clear / Keep.
6. Dump Bin tab still embeds dump-bin; Photos is a separate route.
7. Helpdesk on a non-D8 store does not CC Aiyana.

When this holds on 999 and one real store, *consider* cutover (`CUTOVER.md`). Production stays on live until then.
