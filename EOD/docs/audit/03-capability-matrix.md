# Capability-to-implementation matrix

“WORKING” means the static code path is complete and has no obvious defect. It does not certify third-party production configuration. Where the final result depends on SAS, Resend/email-to-fax, R2, Graph, or live database state, the status is `UNVERIFIABLE` unless a code defect justifies `PARTIAL` or `BROKEN`.

## InstaWork support

| Capability | Implementing code (file:line) | Status | Evidence | Confidence |
|---|---|---|---|---|
| Declare whether InstaWork is on site today | `EOD/index.html:6038-6069` | WORKING | Exclusive checkbox state opens management or hides the photo section and participates in autosave/validation (`EOD/index.html:5996-6015`, `EOD/index.html:8843-8945`). | HIGH |
| Print an InstaWork sheet, blank or filled from roster | `EOD/index.html:6071-6096`, `EOD/index.html:6371-6469`; backend `eod-api/src/routes/eod-print-timesheet.js:90-175` | UNVERIFIABLE | UI builds blank/filled payload and backend generates PDF then queues email-to-fax; live fax resolution/delivery requires production fax and Resend evidence. A stale acknowledgement store can target the prior store (`EOD/index.html:6071-6082`, `EOD/index.html:6171-6180`). | HIGH |
| Capture or upload sign-out sheet photo | `EOD/index.html:3306-3340`, `EOD/index.html:6553-6675`, `EOD/index.html:7411-7549` | WORKING | File input and custom camera both write `photos.instawork`; duplicate guard and preview are wired. | HIGH |
| Crop / rotate / adjust before save | `EOD/index.html:7556-8669` | WORKING | InstaWork preview opens the shared editor; rotation, filter, polygon crop, annotation, and save write the edited image back (`EOD/index.html:7098-7166`, `EOD/index.html:8600-8658`). | HIGH |
| Confirm and save JPG into correct fiscal P#W# folder via API | `EOD/index.html:9596-9672`; `eod-api/src/instawork-router.js:65-129`; `eod-api/src/lib/instawork-delivery.js:207-303` | UNVERIFIABLE | Store/date day-confirm and JPEG payload are wired; backend derives fiscal folder and uses email→Graph→local fallbacks. Correct production folder placement requires observing flow-automation/Graph/local destination. | HIGH |
| Re-take after successful save | `EOD/index.html:9566-9594`, `EOD/index.html:9661-9692` | WORKING | Success state exposes Retake; it clears saved metadata and the photo then reopens capture. | HIGH |

## Kompass time sheets

| Capability | Implementing code (file:line) | Status | Evidence | Confidence |
|---|---|---|---|---|
| Print Kompass Daily Time Tracker to store fax | `EOD/index.html:6098-6125`, `EOD/index.html:6371-6469`; `eod-api/src/routes/eod-print-timesheet.js:90-175` | UNVERIFIABLE | Kompass selection reaches PDF fill/email-to-fax; delivery and fax mapping are external. The legacy route lacks day confirmation (`eod-api/src/routes/eod-print-timesheet.js:90-122`). | HIGH |
| Blank option or prefilled from shift members excluding InstaWork IDs | `EOD/index.html:6211-6351`, `EOD/index.html:6388-6449`; backend management `eod-api/src/lib/eod-timesheet-mgmt.js:139-180`, `eod-api/src/lib/eod-timesheet-mgmt.js:390-465` | PARTIAL | Both modes exist and exclusion is explicit, but client and backend classify independently from separately deployed CSV/template assets, so drift can produce different rosters (`eod-api/.cursor/skills/eod-timesheet-join-pin/SKILL.md:84-91`). | HIGH |

## Materials / Dump Bin

| Capability | Implementing code (file:line) | Status | Evidence | Confidence |
|---|---|---|---|---|
| Acknowledge materials read or open browser | `EOD/index.html:6127-6144` | WORKING | Checkbox “yes” opens the browser and state is included in form persistence. | HIGH |
| Browse period materials in app | `EOD/eod-materials-browser.js:122-210`; backend `eod-api/src/routes/weeks.js:14-55`, `eod-api/src/routes/dump-bin.js:134-150` | UNVERIFIABLE | Week/prefix/list UI is wired; live R2 bucket contents and permissions are external. | HIGH |
| View/download selected materials | `EOD/eod-materials-browser.js:63-96`, `EOD/eod-materials-browser.js:233-463`; backend `eod-api/src/routes/dump-bin.js:152-187` | UNVERIFIABLE | Signed URL and PDF page extraction/download paths are complete; live R2 signing and browser PDF runtime need execution. | MEDIUM |
| Share/email selected materials | `EOD/eod-materials-browser.js:683-775`; `eod-api/src/routes/eod-email-materials.js:54-154`; `eod-api/src/routes/secure-share.js:142-293` | UNVERIFIABLE | Email attachment/link and expiring email/SMS pack paths exist; Resend/Twilio/R2 delivery is external. | HIGH |
| Fax/print selected materials to store | `EOD/eod-materials-browser.js:498-587`; `eod-api/src/routes/dump-bin.js:230-355` | UNVERIFIABLE | Store validation, CC selection, cooldown, page payload, and backend fax queue are wired; fax receipt is external. | HIGH |

## Store and shift selection

| Capability | Implementing code (file:line) | Status | Evidence | Confidence |
|---|---|---|---|---|
| Pick store number and work date | `EOD/index.html:2450-2486`, `EOD/index.html:11179-11281` | WORKING | Inputs are required, persisted, and drive shift/day-confirm loading. | HIGH |
| Find SAS PROD shifts for exact store/date | `EOD/index.html:11179-11281`; `eod-api/src/shift-management.js:288-361` | UNVERIFIABLE | Backend SAS lookup and client exact-number filter are present; live SAS response/auth cannot be verified statically. | HIGH |
| Select correct shift when several exist | `EOD/index.html:11283-11326`, `EOD/index.html:11449-11514` | WORKING | Shift cards and dedicated Not-In picker retain visit IDs and selected state. | HIGH |
| Lead picker when multiple visit leads appear | `EOD/index.html:11981-12062` | WORKING | Unique leads populate a picker; selecting resolves and auto-fills lead info. | HIGH |
| Day-confirm gate; request override on mismatch | `EOD/index.html:4904-5170`; `eod-api/src/store-confirmation.js:250-425` | UNVERIFIABLE | Token verification, override creation, status polling, and middleware are wired; supervisor email/decision delivery and live schedule eligibility require runtime evidence. | HIGH |

## Profile

| Capability | Implementing code (file:line) | Status | Evidence | Confidence |
|---|---|---|---|---|
| Auto-fill lead name/email from SAS lead info | `EOD/index.html:12008-12082`; `eod-api/src/shift-management.js:364-396` | UNVERIFIABLE | Shift lead name reaches backend lookup and profile fields; live SAS lead directory quality is external. | HIGH |
| Manual override | `EOD/index.html:12064-12099` | WORKING | Auto-filled fields are locked and have explicit unlock/edit controls. | HIGH |
| Local device persistence | `EOD/index.html:5964-5987` | WORKING | `kompassProfile` is read at startup, updated on input, and preserved by normal post-send clear (`EOD/index.html:10027-10076`). | HIGH |

## Employee management

| Capability | Implementing code (file:line) | Status | Evidence | Confidence |
|---|---|---|---|---|
| View current shift members | `EOD/index.html:12101-12144`; `eod-api/src/shift-management.js:399-478` | UNVERIFIABLE | Selected visit loads and renders members; SAS roster response is external. | HIGH |
| Add team members from employee list | `EOD/index.html:12146-12243`; `eod-api/src/shift-management.js:618-708` | PARTIAL | Role-gated list/add is wired, but lead UI falsely displays a random pending-approval delay after backend has already added immediately (`EOD/index.html:12219-12233`). | HIGH |
| Request removal of members | `EOD/index.html:12246-12372`; `eod-api/src/shift-management.js:715-802` | UNVERIFIABLE | Request creation and 30-second polling are wired; supervisor decision email/processing and SAS removal require runtime evidence. | HIGH |
| Refresh roster; closed shifts viewable but edits locked | `EOD/index.html:10583-10591`, `EOD/index.html:12127-12315`, `EOD/index.html:12374-12384` | WORKING | Rendering disables add/remove on closed shifts while member refresh remains available. | HIGH |

## Photos

| Capability | Implementing code (file:line) | Status | Evidence | Confidence |
|---|---|---|---|---|
| Kompass cart before/after camera or upload | `EOD/index.html:3689-3735`, `EOD/index.html:6553-6675`, `EOD/index.html:7397-7549` | WORKING | Both inputs and camera write separate before/after arrays and render editable previews. | HIGH |
| Multi-capture signoff; landscape auto-portrait | `EOD/index.html:3743-3770`, `EOD/index.html:7402-7529`, `EOD/index.html:7062-7096` | WORKING | Camera stays open for multiple signoffs and calls portrait orientation before storing each capture. | HIGH |
| No Kompass Cart Present shortcut | `EOD/index.html:6495-6519` | WORKING | Checkbox clears/disables cart photo areas and is respected by validation (`EOD/index.html:8879-8892`). | HIGH |
| On-device crop, rotate, annotate | `EOD/index.html:7556-8669` | WORKING | Shared full-resolution editor is wired from local photo cards (`EOD/index.html:7098-7166`). | HIGH |
| Sync with SAS PROD: pull existing and push local | `EOD/index.html:12930-13300`; `eod-api/src/sas-bridge.js:424-496`, `eod-api/src/sas-bridge.js:680-738`, `eod-api/src/sas-bridge.js:1065-1120`, `eod-api/src/sas-bridge.js:1229-1254` | BROKEN | Pull/reconcile is wired, but push trusts a supplied `visitId`, skips store/date resolution when it is present, and the frontend reports “synced” on queue acceptance without polling the available job-status endpoint (`EOD/index.html:13265-13300`, `eod-api/src/sas-bridge.js:426-452`, `eod-api/src/sas-bridge.js:721-738`). | HIGH |
| Select PROD photos for EOD | `EOD/index.html:12614-12765`, `EOD/index.html:12930-13179` | WORKING | PROD cards include EOD selection state and imported data URLs feed email/PDF collection. | HIGH |
| Local storage panel and compress old photos | `EOD/index.html:6847-7060` | WORKING | Storage budgets, statistics, per-photo optimization, bulk optimization, and indicator are wired. | HIGH |
| Needs-review forces signoff verification | `EOD/index.html:7168-7175`, `EOD/index.html:8843-8945`, `EOD/index.html:12557-12605` | WORKING | Imported signoffs are marked needing review; validation blocks send until each is opened/cleared by editor/view path. | HIGH |

## Digital signoff sheet

| Capability | Implementing code (file:line) | Status | Evidence | Confidence |
|---|---|---|---|---|
| Load hosted weekly worksheet | `EOD/eod-digital-signoff.js:211-258`; `eod-api/src/routes/digital-signoffs.js:58-83` | UNVERIFIABLE | Store/date load and backend DB retrieval are wired; sheet ingestion/data availability requires runtime DB evidence. | HIGH |
| Mark Complete / Not In Store / Not In SI independently | `EOD/eod-digital-signoff.js:111-208`, `EOD/eod-digital-signoff.js:259-366`; `eod-api/src/lib/digital-signoffs.js:300-398` | WORKING | Multi-mark state, individual toggle-off, clear-all, and backend persistence are distinct. | HIGH |
| Not In marks update PROD comments and can open help desk | `EOD/eod-digital-signoff.js:304-349`, `EOD/index.html:11683-11975` | BROKEN | Side effects are invoked, but the module records `helpdeskSent=true` as soon as an asynchronous confirmation modal is opened, even if user stands down or send later fails (`EOD/eod-digital-signoff.js:316-328`, `EOD/index.html:11855-11913`). | HIGH |
| Refresh sheet; open printable PDF | `EOD/eod-digital-signoff.js:95-108`, `EOD/eod-digital-signoff.js:211-258` | PARTIAL | Refresh works; printable button is a stub that only displays a message and never opens `pdfR2Key`. | HIGH |

## Department PIC signatures

| Capability | Implementing code (file:line) | Status | Evidence | Confidence |
|---|---|---|---|---|
| Collect digital signatures by role | `EOD/eod-dept-signatures.js:84-184`, `EOD/eod-dept-signatures.js:455-569`; `eod-api/src/lib/dept-signatures.js:13-24`, `eod-api/src/lib/dept-signatures.js:169-267` | WORKING | Role definitions, status cards, canvas capture, backend artifact persistence, replacement, and clear are wired. | HIGH |
| Hand-device role→contact→signature wizard | `EOD/eod-dept-signatures.js:290-455` | WORKING | Three explicit steps validate role, name/email, and signature before submit. | HIGH |
| Remember contacts and auto-CC signers | `EOD/eod-dept-signatures.js:230-258`, `EOD/eod-dept-signatures.js:263-287`, `EOD/eod-dept-signatures.js:519-569` | BROKEN | Contacts populate the collection wizard, but recipient auto-CC mutates a stale copied `window.emailRecipients` array after hydration replaces the lexical array used by autosave/send (`EOD/index.html:5346`, `EOD/index.html:5791-5794`, `EOD/index.html:9270`, `EOD/index.html:10560-10565`). Unsigned remote handoff also uses `contacts.find((c) => false)` and passes `null` (`EOD/eod-dept-signatures.js:202-210`). | HIGH |
| Required roles driven by digital worksheet | `EOD/eod-digital-signoff.js:227-229`; `EOD/eod-dept-signatures.js:595-602` | WORKING | Sheet load forwards `requiredDeptRoles`; department module replaces required-role set and rerenders. | HIGH |

## EOD cover sheet fields

| Capability | Implementing code (file:line) | Status | Evidence | Confidence |
|---|---|---|---|---|
| Manager checked in/out with remembered suggestions | `EOD/index.html:2567-2605`, `EOD/index.html:5395-5551` | PARTIAL | Fields and shared suggestions work, but store-load race can replace the current store’s list with a prior response (`EOD/index.html:5395-5409`). | HIGH |
| All sets signed out in PROD / SI | `EOD/index.html:2623-2678`, `EOD/index.html:8782-8826` | WORKING | Exclusive tri-state checkbox values are collected and validated. | HIGH |
| Pick Not In Store / Not In SI resets or Other | `EOD/index.html:11550-11671`; `EOD/index.html:8782-8841` | WORKING | Per-shift reset options and free-text Other are independently maintained and formatted into report data. | HIGH |
| Selecting sets appends matching PROD comments | `EOD/index.html:11683-11766`, `EOD/index.html:11915-11975`; `eod-api/src/shift-management.js:530-615` | UNVERIFIABLE | Resolver and SAS mutation are wired; live category match and SAS update require runtime evidence. Backend lacks role/day binding. | HIGH |
| Free-form notes | `EOD/index.html:2751-2764`, `EOD/index.html:8782-8826` | WORKING | Notes persist, enter report payload, preview, PDF, and server email (`EOD/index.html:5670-5733`, `EOD/index.html:8981-9110`, `EOD/index.html:9697-9803`). | HIGH |

## Help desk

| Capability | Implementing code (file:line) | Status | Evidence | Confidence |
|---|---|---|---|---|
| Wizard for one or more KOMPASS issues | `EOD/eod-helpdesk-wizard.js:8-47`, `EOD/eod-helpdesk-wizard.js:311-487` | WORKING | Add/remove/select and review flow supports multiple issue records. | HIGH |
| Per-issue details, commodities, resolution, temp solution | `EOD/eod-helpdesk-wizard.js:104-230`, `EOD/eod-helpdesk-wizard.js:311-487` | WORKING | State and step validation cover each named field. | HIGH |
| Attach and annotate photos | `EOD/eod-helpdesk-wizard.js:49-52`, `EOD/eod-helpdesk-wizard.js:231-310` | WORKING | Per-issue image state and annotation canvas/export are wired. | MEDIUM |
| Email each issue separately with optional CC/team | `EOD/eod-helpdesk-wizard.js:535-629`; `eod-api/src/index.js:1355-1424` | PARTIAL | Individual requests and recipient options exist, but sequential partial failure causes already-sent issues to be duplicated on retry (`EOD/eod-helpdesk-wizard.js:557-629`). Final email delivery remains external. | HIGH |

## Signature and send

| Capability | Implementing code (file:line) | Status | Evidence | Confidence |
|---|---|---|---|---|
| Lead signature pad, draw or photo | `EOD/index.html:7197-7379` | WORKING | Full-screen draw, clear, load-photo, persist, and preview are wired. | HIGH |
| Preview EOD email | `EOD/index.html:8981-9399` | WORKING | Same collected payload is rendered into rich preview and confirmed before send. Server body is separately rendered (`eod-api/src/index.js:959-1022`). | HIGH |
| Send email with photos, cover fields, digital summary, dept signatures | `EOD/index.html:9127-9454`; `eod-api/src/index.js:1024-1195` | UNVERIFIABLE | Client builds PDF/signoff attachments and backend stores hosted artifacts then calls Resend; production delivery and link accessibility require runtime evidence. | HIGH |
| Manage recipients, saved Fred Meyer pool, optional team | `EOD/index.html:5346-5668`, `EOD/index.html:9167-9417` | BROKEN | Features are wired, but an out-of-order `loadStoreData` response can put a prior store’s email pool on the current form and lead to wrong-recipient send (`EOD/index.html:5395-5409`). | HIGH |
| Add coversheet to Kompass shift ISE after photos | `EOD/index.html:13303-13454`; `eod-api/src/sas-bridge.js:424-496`, `eod-api/src/sas-bridge.js:681-738` | BROKEN | Lead-gated UI renders PDF to JPEG, but backend trusts the supplied visit ID and the frontend reports success when the job is merely queued; it never polls `/sas-upload/:jobId` (`EOD/index.html:13310-13339`, `eod-api/src/sas-bridge.js:426-452`, `eod-api/src/sas-bridge.js:721-738`). | HIGH |
| Reset form | `EOD/index.html:10173-10293` | PARTIAL | UI/form/module state is cleared, but IndexedDB deletion is not awaited and may race/fail after success is shown (`EOD/index.html:10205-10217`). | HIGH |

## Platform / operations

| Capability | Implementing code (file:line) | Status | Evidence | Confidence |
|---|---|---|---|---|
| Auto-save drafts; photos/form/signature survive refresh/update | `EOD/index.html:5223-5343`, `EOD/index.html:5670-5993`, `EOD/index.html:7197-7379` | BROKEN | Form/signature/photo stores exist, but all photos share one unkeyed device record across store/day, and `autoSave` does not await photo persistence (`EOD/index.html:5263-5270`, `EOD/index.html:5736-5739`, `EOD/index.html:5753-5775`). Preservation can become cross-store contamination. | HIGH |
| Version update banner preserves phone-local work | `EOD/index.html:13517-13685` | PARTIAL | Update calls `autoSave` before cache-busting reload, but that function starts and does not await IndexedDB save (`EOD/index.html:5736-5739`, `EOD/index.html:13610-13621`). | HIGH |
| Refresh SAS / Rebotics auth | `EOD/index.html:12388-12499`; backend `eod-api/src/index.js:964-1007`, `eod-api/src/rebotics-bridge.js:527-569` | UNVERIFIABLE | UI cooldown and both calls are wired; external browser/session refresh success requires runtime evidence. | HIGH |
| Role-gated UI | `EOD/index.html:4447-4461`, `EOD/index.html:4874-4892` | PARTIAL | `data-requires-role` elements are hidden correctly, but several corresponding backend mutations lack role checks: SAS upload, timesheet edits/delivery, department signatures, and digital marks (`eod-api/src/sas-bridge.js:681-718`; `eod-api/src/routes/eod-timesheet-mgmt.js:79-305`; `eod-api/src/routes/dept-signatures.js:62-93`; `eod-api/src/routes/digital-signoffs.js:85-112`). | HIGH |
| Supervisor/admin test mode with demo clone | `EOD/index.html:4424-4892`; `eod-api/src/routes/digital-signoffs.js:115-143` | PARTIAL | Store-999 fixtures, recipient rewriting, and clone are wired; setup tolerates failed clone/employee fetch and can leave a partially initialized demo (`EOD/index.html:4541-4752`). | HIGH |

## Known extra capabilities

| Capability | Implementing code (file:line) | Status | Evidence | Confidence |
|---|---|---|---|---|
| Copy PIN / sign on tablet | `EOD/eod-timesheet-mgmt.js:398-467`; `eod-api/src/routes/eod-timesheet-mgmt.js:108-156` | WORKING | PIN regeneration/copy and worker tablet JWT launch are wired through day-confirmed endpoints. | HIGH |
| JOIN QR/PIN generation | `EOD/eod-timesheet-mgmt.js:505-545`; `eod-api/src/routes/eod-timesheet-mgmt.js:93-106`; `eod-api/src/lib/timesheet-join.js:73-100`; public flow `eod-api/src/routes/timesheet-join.js:46-204` | BROKEN | Token/PIN/JWT workflow exists, but expiry calculates candidate offsets and then always returns `workDate 12:00 UTC + 30h`, which does not equal documented next-day 06:00 Pacific; QR rendering also depends on external `api.qrserver.com` (`EOD/eod-timesheet-mgmt.js:540`). | HIGH |
| Guest handoff flow | `EOD/eod-guest-handoff.js:101-209`; `EOD/eod-dept-signatures.js:202-210`; `eod-api/src/routes/guest-handoff.js:16-65` | PARTIAL | Timesheet and already-signed department payloads can create opaque-token email/SMS sessions, but an unsigned department role cannot prefill its remembered contact because the lookup predicate is always false and the computed contact is ignored (`EOD/eod-dept-signatures.js:202-210`). Delivery remains runtime-unverifiable. | HIGH |
| SMS opt-in QR | `EOD/eod-sms-optin-qr.js:1-172`; asset `EOD/assets/tactag-sms-optin-qr.svg:1` | WORKING | Collapsible card, persisted state, image, phone, and opt-in link are self-contained and initialized. | HIGH |
| Supervisor decide flow | Request `EOD/index.html:12246-12372`; backend decision `eod-api/src/routes/decide.js:1-150`; design artifact `the-dump-bin/.cursor/artifacts/eod-supervisor-decide-flow.md:1-56` | UNVERIFIABLE | EOD requests and polls a decision; signed review/POST flow exists outside the EOD page. Email link delivery and live supervisor decision/SAS removal need runtime evidence. | HIGH |
