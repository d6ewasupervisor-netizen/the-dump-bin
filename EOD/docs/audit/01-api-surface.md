# EOD frontend API surface

## Authentication baseline

The page’s `authFetch` waits for Dump Bin auth and delegates to `window.dumpBinAuthFetch`; module wrappers delegate to the same function (`EOD/index.html:4417-4491`, `EOD/eod-timesheet-mgmt.js:17-21`, `EOD/eod-materials-browser.js:22-26`). On the backend, all paths not explicitly public pass through global `requireAuth` (`eod-api/src/index.js:472-534`). Therefore “Auth” below means the global authenticated-user gate even where a route repeats `requireAuth`. “Day” means `requireDayConfirm`; roles are route-specific.

The shipped auth gate injects a Bearer session JWT (`eod-api/src/public/auth-gate.js:177-195`), while backend source defaults `AUTH_MODE` to `cf-access` (`eod-api/src/auth-middleware.js:31`). Production must override this to `session` for the checked-in client/server contract to work; runtime environment values were unavailable.

## Backend API calls from `EOD/index.html`

| Caller file:line | Method + path | Backend route file:line | Exists? | Auth/role required | Notes |
|---|---|---|---|---|---|
| `EOD/index.html:4559` | GET `/api/employees` | `eod-api/src/shift-management.js:618` | Yes | Auth + role lead/supervisor/admin/hr | Test fixture source. |
| `EOD/index.html:4681` | POST `/api/digital-signoffs/demo-clone` | `eod-api/src/routes/digital-signoffs.js:115` | Yes | Auth + role admin/supervisor | Clones source store 19 to test store 999. |
| `EOD/index.html:4777`, `EOD/index.html:5019` | POST `/api/verify-store` | Registered by `eod-api/src/store-confirmation.js:17`; handler `eod-api/src/store-confirmation.js:250-313` | Yes | Auth | Test setup and normal day-confirm use the same `{store,date}` shape. |
| `EOD/index.html:4874`, `EOD/index.html:10630` | GET `/api/me` | `eod-api/src/index.js:723` | Yes | Auth | Role/test eligibility and Rebotics-admin/store metadata. |
| `EOD/index.html:5074` | POST `/api/store-confirm-request` | Registered by `eod-api/src/store-confirmation.js:18`; handler `eod-api/src/store-confirmation.js:315-395` | Yes | Auth | Creates supervisor override request. |
| `EOD/index.html:5106` | GET `/api/store-confirm-request/:id/status` | Registered by `eod-api/src/store-confirmation.js:19`; handler `eod-api/src/store-confirmation.js:397-425` | Yes | Auth | Polls until approved/denied/expired. |
| `EOD/index.html:5399` | GET `/store-data/:storeNumber` | `eod-api/src/index.js:1487` | Yes | Auth | Per-store FM emails and manager names. |
| `EOD/index.html:5467` | DELETE `/store-data/:storeNumber/fredmeyer-email` | `eod-api/src/index.js:1524` | Yes | Auth; no role/day gate | Shared pool mutation. |
| `EOD/index.html:5485` | POST `/store-data/:storeNumber` | `eod-api/src/index.js:1497` | Yes | Auth; no role/day gate | Adds Fred Meyer email. |
| `EOD/index.html:5546` | DELETE `/store-data/:storeNumber/manager-name` | `eod-api/src/index.js:1512` | Yes | Auth; no role/day gate | Shared manager pool mutation. |
| `EOD/index.html:6260`, `EOD/index.html:11204` | GET `/api/shifts?store=&date=` | `eod-api/src/shift-management.js:288` | Yes | Auth | Both callers exact-filter the returned store client-side (`EOD/index.html:6266-6270`, `EOD/index.html:11217-11220`). |
| `EOD/index.html:6303`, `EOD/index.html:12107` | GET `/api/shifts/:visitId/members` | `eod-api/src/shift-management.js:399` | Yes | Auth | Used by legacy print roster and selected-shift management. |
| `EOD/index.html:6413` | GET `/api/eod/timesheet-mgmt?sheet=&store=&date=` | `eod-api/src/routes/eod-timesheet-mgmt.js:31` mounted at `eod-api/src/index.js:587` | Yes | Auth | Primary roster; falls back to frontend reconstruction on failure. |
| `EOD/index.html:6440` | POST `/api/eod/print-timesheet` | `eod-api/src/routes/eod-print-timesheet.js:90` mounted at `eod-api/src/index.js:586` | Yes | Auth only; no day/role | Legacy blank/filled fax path. |
| `EOD/index.html:9413` | POST `/send-eod` | `eod-api/src/index.js:1024` | Yes | Auth + Day | Sends hosted PDF/photo links via Resend. |
| `EOD/index.html:9488` | POST `/instawork/save-image` | `eod-api/src/instawork-router.js:65` mounted at `eod-api/src/index.js:637` | Yes | Auth + Day in production gates (`eod-api/src/instawork-router.js:19-26`) | Hosted JPG route required by mobile rule (`EOD/rules/instawork-mobile-eod-api.mdc:7-10`). |
| `EOD/index.html:10657`, `EOD/index.html:10971` | GET `/rebotics-auth-status` | `eod-api/src/rebotics-bridge.js:512` | Yes | Auth | Weekly panel and global connection poll. |
| `EOD/index.html:10715` | GET `/rebotics/tasks/candidates?store_ids=&date=` | `eod-api/src/rebotics-bridge.js:571` | Yes | Auth only; no role/district enforcement | Code exists, but its parent UI is hidden and `initWeeklyTasks()` has no caller (`EOD/index.html:3608-3613`, `EOD/index.html:10803-10933`). |
| `EOD/index.html:10733` | POST `/rebotics/tasks/bulk-backlog` | `eod-api/src/rebotics-bridge.js:632` | Yes | Auth only; no role/store-scope enforcement (`eod-api/src/rebotics-bridge.js:632-708`) | Unreachable from normal EOD UI because the initializer is never called, but directly callable by any authenticated API user (`EOD/index.html:10803-10933`). |
| `EOD/index.html:10962` | GET `/sas-auth-status` | `eod-api/src/sas-bridge.js:1347` | Yes | Auth through global gate | Connection poll. |
| `EOD/index.html:10994`, `EOD/index.html:11072`, `EOD/index.html:11104` | GET `/api/shifts?store=0&date=2000-01-01` | `eod-api/src/shift-management.js:288` | Yes | Auth | Legacy auth-health probe, not operational lookup. |
| `EOD/index.html:11052`, `EOD/index.html:12458` | POST `/api/trigger-auth` (second caller adds `?force=1`) | `eod-api/src/index.js:964` | Yes | Auth through global gate | Opens/refreshes SAS auth. |
| `EOD/index.html:11408`, `EOD/index.html:11535` | GET `/api/shifts/:visitId/sets` | `eod-api/src/shift-management.js:480` | Yes | Auth | Bulk all-shift map and selected-shift legacy set load. |
| `EOD/index.html:11754` | POST `/api/shifts/:visitId/sets/:resetId/append-comment` | `eod-api/src/shift-management.js:530` | Yes | Auth only; no role/day | Irreversible SAS category-comment mutation. |
| `EOD/index.html:11812` | POST `/send-eod-helpdesk-report` | `eod-api/src/index.js:1355` | Yes | Auth only | Specialized Not In Store payload. |
| `EOD/index.html:12010`, `EOD/index.html:12041` | GET `/api/lead-info?name=` | `eod-api/src/shift-management.js:364` | Yes | Auth | Duplicate call paths for selected lead and shift auto-population. |
| `EOD/index.html:12156` | GET `/api/employees` | `eod-api/src/shift-management.js:618` | Yes | Auth + role lead/supervisor/admin/hr | Add-member list. |
| `EOD/index.html:12208` | POST `/api/shifts/:visitId/add` | `eod-api/src/shift-management.js:630` | Yes | Auth + role lead/supervisor/admin | Immediate SAS add. |
| `EOD/index.html:12266` | POST `/api/shift-request` | `eod-api/src/shift-management.js:715` | Yes | Auth + role lead/supervisor/admin | Removal request/decision flow. |
| `EOD/index.html:12345` | GET `/api/shift-request/:requestId/status` | `eod-api/src/shift-management.js:764` | Yes | **Public** due broad `/api/shift-request/` whitelist (`eod-api/src/index.js:477-478`) | Frontend sends auth, but backend does not require it; status is addressable by request ID. |
| `EOD/index.html:12469` | POST `/rebotics-trigger-auth` | `eod-api/src/rebotics-bridge.js:527` | Yes | Auth | Forced Rebotics auth refresh. |
| `EOD/index.html:12907` | POST `/api/signoff-photos` | `eod-api/src/sas-bridge.js:1184` | Yes | Auth only; no role/day | Stores client-supplied visit/store/date image. |
| `EOD/index.html:12951` | GET `/api/visit-photos/:visitId/before-images` | `eod-api/src/sas-bridge.js:1094` | Yes | Auth | Pulls MAINTENANCE before-slot images. |
| `EOD/index.html:13007`, `EOD/index.html:13085` | GET `/api/visit-photos/:visitId/after-images` | `eod-api/src/sas-bridge.js:1065` | Yes | Auth | Called once for cart-after reconciliation and again for signoff-slot assignment. |
| `EOD/index.html:13131` | GET `/api/signoff-photos?visitId=` | `eod-api/src/sas-bridge.js:1229` | Yes | Auth | Pulls stored signoff photos. |
| `EOD/index.html:13265`, `EOD/index.html:13310` | POST `/sas-upload` | `eod-api/src/sas-bridge.js:681` | Yes | Auth only; no role/day | Local photo and coversheet upload use the same upload job contract. |

## Module-originated backend calls

| Caller file:line | Method + path | Backend route file:line | Exists? | Auth/role required | Notes |
|---|---|---|---|---|---|
| `EOD/eod-timesheet-mgmt.js:640` | GET `/api/eod/timesheet-mgmt?sheet=&store=&date=` | `eod-api/src/routes/eod-timesheet-mgmt.js:31` | Yes | Auth | Live roster/punch refresh. |
| `EOD/eod-timesheet-mgmt.js:362` | PATCH `/api/eod/timesheet-mgmt/row` | `eod-api/src/routes/eod-timesheet-mgmt.js:79` | Yes | Auth + Day; no role | Lead-side row/punch edit. |
| `EOD/eod-timesheet-mgmt.js:401` | POST `/api/eod/timesheet-mgmt/pins/regenerate` | `eod-api/src/routes/eod-timesheet-mgmt.js:108` | Yes | Auth + Day; no role | Regenerates one/all worker PINs. |
| `EOD/eod-timesheet-mgmt.js:443` | POST `/api/eod/timesheet-mgmt/tablet-session` | `eod-api/src/routes/eod-timesheet-mgmt.js:142` | Yes | Auth + Day; no role | Mints worker JWT for hand-device signing. |
| `EOD/eod-timesheet-mgmt.js:516` | POST `/api/eod/timesheet-mgmt/join-token` | `eod-api/src/routes/eod-timesheet-mgmt.js:93` | Yes | Auth + Day; no role | Creates/rotates JOIN token. |
| `EOD/eod-timesheet-mgmt.js:548` | POST `/api/eod/timesheet-mgmt/build-pdf` | `eod-api/src/routes/eod-timesheet-mgmt.js:158` | Yes | Auth + Day; no role | Dynamic `path` call from `downloadPdf`. |
| `EOD/eod-timesheet-mgmt.js:548` | POST `/api/eod/timesheet-mgmt/print-at-store` | `eod-api/src/routes/eod-timesheet-mgmt.js:183` | Yes | Auth + Day; no role | Managed filled fax path. |
| `EOD/eod-timesheet-mgmt.js:548` | POST `/api/eod/timesheet-mgmt/email` | `eod-api/src/routes/eod-timesheet-mgmt.js:207` | Yes | Auth + Day; no role | Arbitrary prompted email. |
| `EOD/eod-timesheet-mgmt.js:548` | POST `/api/eod/timesheet-mgmt/submit-office` | `eod-api/src/routes/eod-timesheet-mgmt.js:241` | Yes | Auth + Day; no role | InstaWork office filing. |
| `EOD/eod-timesheet-mgmt.js:548` | POST `/api/eod/timesheet-mgmt/submit-supervisor` | `eod-api/src/routes/eod-timesheet-mgmt.js:273` | Yes | Auth + Day; no role | Kompass supervisor delivery. |
| `EOD/eod-dept-signatures.js:230` | GET `/api/dept-signatures/roles` | `eod-api/src/routes/dept-signatures.js:21` | Yes | Auth | Role definitions. |
| `EOD/eod-dept-signatures.js:238` | GET `/api/dept-signatures/:store/contacts` | `eod-api/src/routes/dept-signatures.js:25` | Yes | Auth | Remembered PIC contacts. |
| `EOD/eod-dept-signatures.js:247` | GET `/api/dept-signatures/:store/signatures?date=` | `eod-api/src/routes/dept-signatures.js:48` | Yes | Auth | Collected role signatures. |
| `EOD/eod-dept-signatures.js:532` | POST `/api/dept-signatures/:store/signatures` | `eod-api/src/routes/dept-signatures.js:62` | Yes | Auth + Day; no role | Collects signature and upserts contact (`eod-api/src/lib/dept-signatures.js:169-267`). |
| `EOD/eod-dept-signatures.js:576` | DELETE `/api/dept-signatures/:store/signatures/:role?date=` | `eod-api/src/routes/dept-signatures.js:82` | Yes | Auth + Day; no role | Clears role signature. |
| `EOD/eod-digital-signoff.js:223` | GET `/api/digital-signoffs/sheet?store=&date=` | `eod-api/src/routes/digital-signoffs.js:58` | Yes | Auth | Loads worksheet and required roles. |
| `EOD/eod-digital-signoff.js:269` | DELETE `/api/digital-signoffs/rows/:rowId/mark` | `eod-api/src/routes/digital-signoffs.js:103` | Yes | Auth + Day; no role | Clears all marks for row; body omits `markType`. |
| `EOD/eod-digital-signoff.js:286` | DELETE `/api/digital-signoffs/rows/:rowId/mark?markType=` | `eod-api/src/routes/digital-signoffs.js:103` | Yes | Auth + Day; no role | Clears one mark; body also includes `markType`. |
| `EOD/eod-digital-signoff.js:336` | POST `/api/digital-signoffs/rows/:rowId/mark` | `eod-api/src/routes/digital-signoffs.js:85` | Yes | Auth + Day; no role | Saves mark plus side-effect metadata. |
| `EOD/eod-guest-handoff.js:144` | POST `/api/guest-handoff` | `eod-api/src/routes/guest-handoff.js:16` | Yes | Auth + Day | Creates/sends dept-signature or timesheet handoff. |
| `EOD/eod-materials-browser.js:125` | GET `/api/weeks` | `eod-api/src/routes/weeks.js:14` mounted at `eod-api/src/index.js:551` | Yes | Auth | Fiscal folder list. |
| `EOD/eod-materials-browser.js:197` | GET `/api/list?prefix=` | `eod-api/src/routes/dump-bin.js:134` | Yes | Auth | R2 object list. |
| `EOD/eod-materials-browser.js:77` | GET `/api/download-token?key=` | `eod-api/src/routes/dump-bin.js:152` | Yes | Auth | Returns signed/public download URL. |
| `EOD/eod-materials-browser.js:66-81`, shared viewer `eod-api/src/public/shared/pdf-viewer/materials-pdf-viewer.js:438-452` | GET `/api/download?key=&t=` | `eod-api/src/routes/dump-bin.js:164` | Yes | Public signed token or Auth | Raw viewer/download request after token minting. |
| `EOD/eod-materials-browser.js:561` | POST `/api/print-at-store` | `eod-api/src/routes/dump-bin.js:230` | Yes | Auth; no Day/role | Materials email-to-fax. |
| `EOD/eod-materials-browser.js:602`, `EOD/eod-materials-browser.js:608`, `EOD/eod-materials-browser.js:623` | GET `/api/shifts/:visitId/members` | `eod-api/src/shift-management.js:399` | Yes | Auth | Recipient/team resolution. |
| `EOD/eod-materials-browser.js:617` | GET `/api/shifts?store=&date=` | `eod-api/src/shift-management.js:288` | Yes | Auth | Fallback team resolution takes `visits[0]` without exact-store filtering (`EOD/eod-materials-browser.js:619-628`), unlike the main selector. |
| `EOD/eod-materials-browser.js:637` | GET `/api/employees` | `eod-api/src/shift-management.js:618` | Yes | Auth + role lead/supervisor/admin/hr | Fallback employee directory. |
| `EOD/eod-materials-browser.js:722` | POST `/api/eod/email-materials` | `eod-api/src/routes/eod-email-materials.js:54` | Yes | Auth | Sends R2 objects as attachments/links. |
| `EOD/eod-materials-browser.js:739` | POST `/api/secure-share` | `eod-api/src/routes/secure-share.js:142` | Yes | Auth | Creates seven-day email/SMS pack. |
| `EOD/eod-materials-browser.js:833` | GET `/api/print-at-store/cc-contacts?q=&limit=20` | `eod-api/src/routes/dump-bin.js:217` | Yes | Auth | Contact search. |
| `EOD/eod-helpdesk-wizard.js:578` | POST `/send-eod-helpdesk-report` | `eod-api/src/index.js:1355` | Yes | Auth only | Full multi-issue wizard payload with photo. |

The loaded authentication dependency also calls public `GET /api/verify-token?token=` to exchange a signed magic-link token for the session used by every EOD API request (`eod-api/src/public/auth-gate.js:142-160`; `eod-api/src/routes/verify-token.js:37-98`).

## Public worker/handoff requests indirectly launched from EOD

EOD creates links, but the receiving pages make these calls rather than the authenticated EOD page itself:

| Originating feature | Public API | Backend route | Auth |
|---|---|---|---|
| JOIN QR/PIN (`EOD/eod-timesheet-mgmt.js:516-540`) | GET `/api/timesheet-join/:token`, POST `/api/timesheet-join/login` | `eod-api/src/routes/timesheet-join.js:188`, `eod-api/src/routes/timesheet-join.js:46` | Public token/PIN; prefix whitelisted (`eod-api/src/index.js:503-528`). |
| Worker session page | GET `/api/timesheet-join/session/me`, POST `/session/punch`, POST `/session/submit` | `eod-api/src/routes/timesheet-join.js:62`, `eod-api/src/routes/timesheet-join.js:153`, `eod-api/src/routes/timesheet-join.js:96` | Worker Bearer JWT validated in route (`eod-api/src/routes/timesheet-join.js:21-43`). |
| Guest handoff link (`EOD/eod-guest-handoff.js:144-209`) | GET `/api/guest-handoff/:token`, POST `/:token/submit` | `eod-api/src/routes/guest-handoff.js:47`, `eod-api/src/routes/guest-handoff.js:57` | Public opaque token; prefix whitelisted (`eod-api/src/index.js:503-528`). |
| Materials secure share (`EOD/eod-materials-browser.js:738-763`) | GET `/api/secure-share/:token`, GET `/:token/file` | `eod-api/src/routes/secure-share.js:310`, `eod-api/src/routes/secure-share.js:353` | Public opaque token; route enforces expiry/manifest membership (`eod-api/src/routes/secure-share.js:310-396`). |

## Non-API network calls

| Caller file:line | Method/target | Backend | Exists? | Notes |
|---|---|---|---|---|
| `EOD/index.html:6223` | GET `Timesheets/instawork_ids.csv` | Static Dump Bin asset | Yes in repo (`EOD/Timesheets/instawork_ids.csv:1-77`) | Cache-busted CSV; legacy client classifier. |
| `EOD/index.html:9719` | GET one of three EOD PDF template names | Static Dump Bin asset | Unverifiable from text-only audit | Tries variants sequentially (`EOD/index.html:9707-9733`). |
| `EOD/index.html:9809`, `EOD/index.html:9881`, `EOD/index.html:9899`, `EOD/index.html:9930` | GET `data:` URLs via `fetch` | Browser-local URL scheme | Yes | Converts signature/photo data URLs into bytes; no server request. |
| `EOD/index.html:10414` | GET each template candidate | Static Dump Bin asset | Unverifiable | Dead `testSetup()` diagnostic (`EOD/index.html:10395-10446`). |
| `EOD/index.html:10431` | GET `rologo.png` | Static Dump Bin asset | Yes (`EOD/rologo.png`) | Only fetched by dead `testSetup()`; the normal preview uses the remote logo constant (`EOD/index.html:4438`, `EOD/index.html:10395-10446`). |
| `EOD/index.html:12552` | GET dynamic photo URL | EOD API/R2/public URL from API response | Runtime-dependent | Uses auth only when URL origin/path indicates EOD API (`EOD/index.html:12540-12555`). |
| `EOD/index.html:13618` | GET `eod-version.json?cb=` | Static Dump Bin asset | Yes (`EOD/eod-version.json:1-3`) | No-store hotfix check. |
| `EOD/eod-materials-browser.js:110` | GET cdnjs PDF.js script; worker set beside it (`EOD/eod-materials-browser.js:110-115`) | Third-party CDN | External | Dynamically injected runtime dependency. |
| `EOD/index.html:13482` | GET cdnjs PDF.js script; worker set beside it (`EOD/index.html:13482-13488`) | Third-party CDN | External | Used by coversheet PDF-to-JPEG. |
| `EOD/eod-timesheet-mgmt.js:540` | GET `api.qrserver.com/v1/create-qr-code` image | Third-party QR service | External | The JOIN URL is disclosed to the QR service as a query parameter. |

No `XMLHttpRequest`, `EventSource`, `sendBeacon`, or HTML form action targeting the API was found in scoped EOD HTML/JS. Dynamic `<img>` requests include the QR service above, static/download URLs returned by the materials API (`EOD/eod-materials-browser.js:77-92`), and photo URLs rendered by the PROD photo UI (`EOD/index.html:12540-12648`).

## Frontend calls to missing eod-api endpoints

No EOD frontend call aimed at `eod-api.the-dump-bin.com` was found without a corresponding route. All concrete local static targets—including `rologo.png`, the EOD PDF template, version JSON, timesheet PDFs, CSV, scripts, styles, and QR asset—exist in the scoped frontend tree (`EOD/index.html:21-31`, `EOD/index.html:9707-9733`, `EOD/index.html:10395-10446`, `EOD/index.html:13615-13621`).

## EOD-specific backend endpoints with no EOD frontend caller

- PATCH `/api/eod/timesheet-mgmt/pins` sets a chosen PIN (`eod-api/src/routes/eod-timesheet-mgmt.js:124-139`); EOD calls only `/pins/regenerate` (`EOD/eod-timesheet-mgmt.js:398-417`).
- GET `/api/secure-share/mine` lists the authenticated user’s packs (`eod-api/src/routes/secure-share.js:295-304`); EOD only creates a pack (`EOD/eod-materials-browser.js:738-763`).
- POST `/api/digital-signoffs/ingest` is for the external sheet builder/token (`eod-api/src/routes/digital-signoffs.js:28-56`), not EOD.
- POST `/send-helpdesk-ticket` is a legacy day-confirmed help-desk format with no current EOD caller (`eod-api/src/index.js:1198-1275`); current callers use `/send-eod-helpdesk-report` (`EOD/index.html:11812-11853`, `EOD/eod-helpdesk-wizard.js:557-603`).
- POST `/api/dept-signatures/:store/contacts` upserts a contact directly (`eod-api/src/routes/dept-signatures.js:35-46`); EOD contact persistence is coupled to signature POST (`EOD/eod-dept-signatures.js:519-555`).
- GET `/api/visit-photos?visitId=` is explicitly legacy (`eod-api/src/sas-bridge.js:1122-1181`); EOD uses slot-specific endpoints (`EOD/index.html:12951-13148`).
- GET `/sas-upload/:jobId` exposes job status (`eod-api/src/sas-bridge.js:721-738`); EOD reports but does not poll returned job IDs (`EOD/index.html:13280-13300`, `EOD/index.html:13325-13339`).
- GET `/api/eod-files/:id?t=` serves signed hosted EOD artifacts to email recipients rather than to the EOD page (`eod-api/src/routes/eod-files-public.js:14-61`; links are created at `eod-api/src/index.js:1092-1138`).
- GET `/instawork/health` reports delivery configuration and has no EOD caller (`eod-api/src/instawork-router.js:52-58`). Despite a nearby “open” comment, its mount follows the global auth gate, so it is authenticated in the current ordering (`eod-api/src/index.js:529-534`, `eod-api/src/index.js:746-756`).
- Legacy SAS bridge shift/member mutation surfaces `/sas-shifts`, `/sas-shift-employees`, `/sas-kompass-pool`, `/sas-employees`, `/sas-shift-add`, and `/sas-shift-remove` are not called by EOD (`eod-api/src/sas-bridge.js:740-1060`); EOD uses `shift-management.js` routes (`EOD/index.html:11204-12372`).
- POST `/api/eod/timesheet-mgmt/pins` and the public worker/JOIN routes are backend-supported operational surfaces, but only their generated links/tokens—not those calls—originate in the EOD management page (`eod-api/src/routes/eod-timesheet-mgmt.js:124-139`, `eod-api/src/routes/timesheet-join.js:46-204`).

## Same endpoints called with divergent payloads/contracts

1. **`POST /send-eod-helpdesk-report`: two materially different schemas.** The Not In Store shortcut sends category/reset metadata and generated narrative (`EOD/index.html:11806-11853`); the wizard sends issue taxonomy, commodity, resolution, temporary solution, optional image, and recipient choices (`EOD/eod-helpdesk-wizard.js:557-603`). One backend route branches over optional fields (`eod-api/src/index.js:1355-1424`). This is supported but drift-prone.
2. **`DELETE /api/digital-signoffs/rows/:rowId/mark`: clear-all vs clear-one.** One caller omits `markType`; another supplies it in both query and body (`EOD/eod-digital-signoff.js:269-293`). The backend intentionally accepts either `req.query.markType` or `req.body.markType` (`eod-api/src/routes/digital-signoffs.js:103-112`), creating two request shapes.
3. **Timesheet printing has two overlapping endpoint contracts.** Legacy `/api/eod/print-timesheet` accepts a client-built employee string list and has no day-confirm gate (`EOD/index.html:6413-6451`; `eod-api/src/routes/eod-print-timesheet.js:90-122`). Managed `/api/eod/timesheet-mgmt/print-at-store` accepts sheet/store/date/lead and builds from persisted rows under day confirmation (`EOD/eod-timesheet-mgmt.js:547-591`; `eod-api/src/routes/eod-timesheet-mgmt.js:183-205`). They are different paths but implement the same capability with divergent authorization and roster ownership.
4. **`GET /api/shifts` callers apply different store safety.** Main selection and legacy timesheet collection reject non-exact stores (`EOD/index.html:11204-11220`, `EOD/index.html:6254-6270`); materials fallback blindly selects `visits[0]` (`EOD/eod-materials-browser.js:617-628`). Because SAS list filtering is substring-based, the materials path can resolve another store’s shift.
