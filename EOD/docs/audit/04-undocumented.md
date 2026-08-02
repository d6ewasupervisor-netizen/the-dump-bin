# Undocumented and scope-crept behavior

This file lists behavior present in code but absent from the intended-capabilities list. “Reachable” means there is a visible UI/event path in the current EOD page; it does not prove production dependencies are configured.

## Reachable features

1. **Hidden/dead Weekly Rebotics bulk-backlog console.** Code can discover candidate tasks, load multiple stores, paste task IDs, dry-run, and bulk-set tasks to “Backlog - Revisit Needed” (`EOD/index.html:10595-10933`). It is **not reachable**: the parent `#adminToolsLegacy` has a permanent `hidden` attribute and `initWeeklyTasks()` has no caller (`EOD/index.html:3608-3613`, `EOD/index.html:10803-10933`).

2. **Hidden Rebotics weekly-task auth/help panel.** The dead initializer would poll Rebotics auth, expose a help modal, and display aging/stale-token state (`EOD/index.html:10652-10678`, `EOD/index.html:10803-10933`). Its Weekly Tasks markup and companion modals are hidden (`EOD/index.html:3608-3669`, `EOD/index.html:4284-4309`). The separate header connection dot remains reachable through `pollConnections()` (`EOD/index.html:10957-10977`).

3. **Live SAS/Rebotics connection telemetry.** The header polls both systems every 30 seconds and mutates the SAS status bar (`EOD/index.html:10503-10508`, `EOD/index.html:10935-10978`). This is broader than the listed manual “refresh connections” capability.

4. **Legacy SAS-auth state machine.** A second sessionStorage-backed red/yellow/green state machine and polling loop remains alongside the newer connection poller (`EOD/index.html:10980-11119`). `checkAuthStatus()` is explicitly described as no longer called directly (`EOD/index.html:10984-10986`), while `setAuthStatus()` is still reached from the new poller (`EOD/index.html:10951-10954`).

5. **Current-status quick view (“Easter egg”).** `openQuickView()` builds a compact summary of store/date/lead, photo completion, managers, PROD/SI answers, and signature state (`EOD/index.html:10358-10392`). It is reachable by tapping the header (`EOD/index.html:3242`).

6. **In-browser self-test/setup diagnostics.** `testSetup()` checks libraries, template paths, localStorage, and saved-data parseability (`EOD/index.html:10394-10446`). This is separate from supervisor/admin test mode. Reachability is not proven from the function definition alone.

7. **Post-send retention preference.** After a successful EOD, the user can choose whether to clear work data now, always clear, or never ask; the preference is stored as `eodPostSendClearPref` (`EOD/index.html:10011-10024`, `EOD/index.html:10106-10170`). Reachable after `/send-eod` succeeds (`EOD/index.html:9432-9445`).

8. **Per-store manager suggestion pool.** Check-in/check-out names are loaded from backend store data, shown as chips/datalist suggestions, and removable (`EOD/index.html:5394-5413`, `EOD/index.html:5492-5551`). The intended list mentions remembered suggestions but not shared, server-side per-store mutation.

9. **Shared per-store Fred Meyer email directory maintenance.** The app can add/remove canonical `@stores.fredmeyer.com` addresses in backend store data and select all saved entries (`EOD/index.html:5415-5489`, `EOD/index.html:5597-5600`). The intended list mentions a saved pool, but not that every authenticated user can mutate the shared store pool through these controls.

10. **Materials page-level PDF extraction.** The materials viewer can extract selected pages into synthetic PDFs, add them to a global selection, download, email, text, or fax them (`EOD/eod-materials-browser.js:355-463`). This is finer-grained than selecting whole materials.

11. **Materials secure SMS sharing.** Selected documents can be packaged into a seven-day secure share and texted to opted-in phones (`EOD/eod-materials-browser.js:683-763`; `eod-api/src/routes/secure-share.js:138-221`). The intended materials capability says “share/email” but does not name expiring SMS document packs.

12. **Materials print CC directory search.** Before faxing, the user can search contacts or add an arbitrary valid email as an extra recipient (`EOD/eod-materials-browser.js:505-525`, `EOD/eod-materials-browser.js:823-868`). Backend search is called through `/api/print-at-store/cc-contacts` (`EOD/eod-materials-browser.js:833-845`).

13. **Timesheet live punch editing.** Leads can directly edit clock-in, lunch-out, lunch-in, and clock-out and persist the row as `timeSource: lead` (`EOD/eod-timesheet-mgmt.js:279-289`, `EOD/eod-timesheet-mgmt.js:339-396`). The known-extras list mentions PIN/tablet/JOIN, not direct punch correction.

14. **Worker self-punch portal.** Public worker JWT sessions can record individual clock/lunch/out punches without submitting the final signature (`eod-api/src/routes/timesheet-join.js:152-185`). It is reachable from the public `/share/time/` page mounted by the secure-share router (`eod-api/src/routes/secure-share.js:398-406`).

15. **Timesheet PDF download and arbitrary-email action.** Management can download the generated PDF locally and prompt for an arbitrary email destination (`EOD/eod-timesheet-mgmt.js:573-600`). The intended timesheet bullets cover store printing but not these management exports.

16. **InstaWork/Kompass office and supervisor submission workflows.** The management module blocks on unsigned workers unless force-confirmed, sends InstaWork PDFs to an office filing inbox, and sends Kompass PDFs to a resolved/manual supervisor (`EOD/eod-timesheet-mgmt.js:547-621`; `eod-api/src/routes/eod-timesheet-mgmt.js:241-305`). These go beyond printing blank/prefilled sheets.

17. **Department-signature remote handoff.** A lead can text/email a secure department-signature link instead of physically handing over the device (`EOD/eod-dept-signatures.js:187-214`; `EOD/eod-guest-handoff.js:173-184`). The intended list describes the hand-device wizard only.

18. **Timesheet remote handoff.** A lead can text/email a secure timesheet link with member-specific prefill (`EOD/eod-timesheet-mgmt.js:468-513`; `EOD/eod-guest-handoff.js:186-209`). This is an alternate path to JOIN QR/PIN.

19. **Department signature replacement and clearing.** Existing role signatures can be re-collected or deleted (`EOD/eod-dept-signatures.js:178-218`, `EOD/eod-dept-signatures.js:571-590`). The intended list only says collect.

20. **Photo conflict-resolution and slot assignment.** When local and PROD images coexist, users choose “Use PROD / Keep local / Keep both”; mixed SAS after-slot images are manually assigned to cart-after, signoff, or skip (`EOD/index.html:12767-12800`, `EOD/index.html:12802-12895`). The intended list says sync/select, not conflict and slot reconciliation.

21. **Photo de-duplication and migration.** Legacy localStorage photos are migrated to IndexedDB, and photos are de-duplicated by their first 1,000 characters (`EOD/index.html:5891-5952`). This is operational migration behavior, not a user capability.

22. **HEIC/HEIF best-effort conversion.** Camera/upload paths detect Apple formats, try `heic2any`, and then fall back to native decoding (`EOD/index.html:6571-6608`, `EOD/index.html:6677-6708`). This is undocumented compatibility scope.

23. **Camera torch control and 4K request.** The custom camera asks for 3840×2160, detects torch capability, and allows flash toggling (`EOD/index.html:7416-7472`). The intended list only requires camera/upload.

24. **Forced signoff image upscaling/sharpening.** Small signoff images can be enlarged to verification-grade target dimensions with contrast filtering (`EOD/index.html:6741-6753`, `EOD/index.html:6777-6813`). This is a quality policy with possible forensic implications, not stated intent.

25. **PDF.js runtime injection from CDN.** Materials viewing and coversheet conversion dynamically load PDF.js/worker code from cdnjs (`EOD/eod-materials-browser.js:105-119`; `EOD/index.html:13478-13490`). This creates an external runtime dependency not named in capabilities.

26. **EOD hosted-link retention model.** The backend stores the PDF and signoff photos and emails 30-day no-sign-in JWT links rather than attaching them (`eod-api/src/index.js:1067-1121`; `EOD/index.html:9441-9444`; TTL via `EOD_FILE_URL_TTL_DAYS`, default 30 — `eod-api/src/lib/eod-artifact-jwt.js:7-13`). Production sample (2026-08-01): delivered EOD with one sign-off sheet used two `/api/eod-files/:id?t=` links only — never `/api/signoff-photos/…`. Access control for these files **is** link possession; decide consciously whether 30 days is right for sheets that carry employee names and handwritten signatures. Corporate scanners (e.g. Fred Meyer / Proofpoint URL rewrite) will fetch links and appear in access logs as non-human hits — expect that, do not treat every GET as a human open. Binding is correct: handler requires `typ === eod_file` and `aid === :id` (`eod-api/src/lib/eod-artifact-jwt.js:37-48`, `eod-api/src/routes/eod-files-public.js:30-32`).

27. **Public hosted signoff-photo endpoint.** `/api/signoff-photos/:photoId/image` is globally whitelisted by path pattern and serves DB image bytes by numeric ID (`eod-api/src/index.js:503-505`; `eod-api/src/sas-bridge.js:1256-1279`). Reachable through URLs returned by signoff-photo APIs (`eod-api/src/sas-bridge.js:1211-1217`). **Not** used by outbound EOD email (see #26); in-app PROD sync thumbs only. Close in Batch 3 with signed query tokens (plan T0.6).

28. **Public secure-share history endpoints.** Authenticated creators can list their share packs, while token holders can fetch manifests/files (`eod-api/src/routes/secure-share.js:295-370`). EOD only calls pack creation; the history endpoint is not called by EOD frontend code (`EOD/eod-materials-browser.js:738-763`).

29. **Digital-signoff service ingest and demo cloning.** An external signoff builder can ingest sheets by token/admin session, and supervisors/admins can clone store 19 into store 999 (`eod-api/src/routes/digital-signoffs.js:16-56`, `eod-api/src/routes/digital-signoffs.js:114-143`). Clone is reachable only through EOD test mode (`EOD/index.html:4677-4711`); ingest has no EOD frontend caller.

30. **Digital-signoff mark provenance.** Marks store actor, visit/reset IDs, helpdesk status, and PROD-comment outcome (`eod-api/src/lib/digital-signoffs.js:7-35`, `eod-api/src/lib/digital-signoffs.js:300-357`). The intended capability only describes visible mark state.

31. **Version badge gesture controls.** A tap toggles test mode; a long press forces a cache-busting update (`EOD/index.html:4794-4842`). The intended list names test mode and update preservation but not hidden gesture semantics.

32. **Public shift-request status lookup.** EOD polls with authenticated `authFetch`, but the broad `/api/shift-request/` public-prefix exception bypasses backend authentication for the status route (`EOD/index.html:12345`; `eod-api/src/index.js:477-478`; `eod-api/src/shift-management.js:764-802`). Reachable to anyone with a request ID.

33. **Hosted EOD-artifact retention purge.** A server scheduler removes expired artifacts independently of the frontend (`eod-api/src/index.js:809-822`). This is reachable server-side only and is not in the intended operations list.

34. **JOIN expiry policy implementation.** Worker access expiry is intended as next-day 06:00 Pacific, but the helper computes multiple unused candidates and always returns a different noon-UTC-plus-30-hours value (`eod-api/src/lib/timesheet-join.js:73-100`). This is reachable through every JOIN token.

## Backend EOD-adjacent endpoints with no current EOD frontend caller

- `PATCH /api/eod/timesheet-mgmt/pins` sets an explicit PIN (`eod-api/src/routes/eod-timesheet-mgmt.js:124-139`); the lead module only calls `/pins/regenerate` (`EOD/eod-timesheet-mgmt.js:398-417`).
- `POST /send-helpdesk-ticket` is a legacy day-confirmed category-ticket format (`eod-api/src/index.js:1198-1275`); current EOD help-desk callers use `/send-eod-helpdesk-report` (`EOD/index.html:11812-11853`, `EOD/eod-helpdesk-wizard.js:557-603`).
- `GET /api/secure-share/mine` lists a user’s shares (`eod-api/src/routes/secure-share.js:295-304`); EOD only creates shares (`EOD/eod-materials-browser.js:738-763`).
- `GET /api/visit-photos?visitId=` is marked legacy/deprecated (`eod-api/src/sas-bridge.js:1122-1181`); EOD uses per-slot and signoff endpoints (`EOD/index.html:12947-13148`).
- `GET /sas-upload/:jobId` exposes upload job status (`eod-api/src/sas-bridge.js:721-738`); EOD displays the returned job ID but does not poll it (`EOD/index.html:13280-13300`, `EOD/index.html:13325-13339`).
- `GET /api/eod-files/:id?t=` is consumed from outbound email links, not by EOD itself (`eod-api/src/routes/eod-files-public.js:14-61`; URL generation at `eod-api/src/index.js:1092-1138`).
- `GET /instawork/health` exposes delivery configuration health to authenticated callers but has no EOD caller (`eod-api/src/instawork-router.js:52-58`, `eod-api/src/index.js:529-534`).
- `POST /sas-shift-add` and `POST /sas-shift-remove` are legacy direct mutation endpoints (`eod-api/src/sas-bridge.js:954-1060`); EOD uses `/api/shifts/:visitId/add` and `/api/shift-request` (`EOD/index.html:12208-12215`, `EOD/index.html:12266-12282`).
- `GET /sas-shifts`, `/sas-shift-employees`, `/sas-kompass-pool`, and `/sas-employees` are older SAS bridge surfaces (`eod-api/src/sas-bridge.js:740-951`); EOD uses `/api/shifts`, `/members`, and `/api/employees` (`EOD/index.html:11204-11220`, `EOD/index.html:12107-12163`).

## Static/support files covered

- `EOD/index.html` contains the UI, CSS, and primary application orchestration (`EOD/index.html:1-13690`).
- Seven loaded modules contain help desk, materials, timesheet, department-signature, digital-signoff, guest-handoff, and SMS QR behavior (`EOD/index.html:13687-13688`; module exports at `EOD/eod-helpdesk-wizard.js:672-712`, `EOD/eod-materials-browser.js:878-902`, `EOD/eod-timesheet-mgmt.js:670-700`, `EOD/eod-dept-signatures.js:604-619`, `EOD/eod-digital-signoff.js:379-393`, `EOD/eod-guest-handoff.js:211-216`, `EOD/eod-sms-optin-qr.js:169-172`).
- `EOD/eod-materials-browser.css` supplies only materials-browser presentation (`EOD/eod-materials-browser.css:1-305`).
- `EOD/eod-version.json` contains the live version value (`EOD/eod-version.json:1-3`).
- `EOD/Timesheets/instawork_ids.csv` is a Workday-ID/name classifier, not a generated timesheet (`EOD/Timesheets/instawork_ids.csv:1-77`).
- `EOD/assets/tactag-sms-optin-qr.svg` is a static QR asset (`EOD/assets/tactag-sms-optin-qr.svg:1`).
- `EOD/rologo.png` is the checked-in logo used by page markup and dead diagnostics (`EOD/index.html:3251`, `EOD/index.html:10431`).
- `EOD/rules/instawork-mobile-eod-api.mdc` records the hosted save contract (`EOD/rules/instawork-mobile-eod-api.mdc:7-10`); `EOD/rules/my-stores.mdc` records district store lists used as operational context, not runtime code (`EOD/rules/my-stores.mdc:6-14`).
- The PDF assets are runtime templates: the frontend attempts the EOD cover template by three filename variants (`EOD/index.html:9707-9733`), while backend timesheet delivery uses fixed InstaWork and Kompass template filenames (`eod-api/src/routes/eod-print-timesheet.js:11-20`, `eod-api/src/routes/eod-print-timesheet.js:130-136`).
