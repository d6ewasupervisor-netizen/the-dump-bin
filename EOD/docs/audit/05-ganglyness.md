# Ganglyness and production-risk ranking

Risk ordering emphasizes wrong-store/wrong-recipient delivery, privacy, irreversible SAS mutations, and loss/cross-contamination of field evidence.

## 1. Device-wide photo record survives store/day rollover

- **Location:** `EOD/index.html:5223-5270`, `EOD/index.html:5753-5775`, `EOD/index.html:5917-5952`
- **Problem:** tangled state / data cross-contamination. IndexedDB stores every photo type in one fixed `id: 'allPhotos'` record with no store or date. The daily reset deliberately clears store/date/shift but preserves photos, then reloads that same record.
- **Blast radius:** yesterday’s or another store’s cart/signoff/InstaWork photos can appear in a new EOD and be emailed or pushed to a selected SAS visit (`EOD/index.html:9855-9981`, `EOD/index.html:13161-13170`).
- **Effort:** M
- **Isolation:** Cross-region; storage schema, rehydration, reset, version migration, email assembly, and sync selection all depend on the current arrays.
- **Call-out:** **URGENT — wrong-store evidence and privacy risk.**

## 2. Per-store recipient/manager load has an out-of-order response race

- **Location:** `EOD/index.html:5389-5412`, `EOD/index.html:5647-5663`
- **Problem:** race condition. `currentLoadedStoreNumber` is assigned before awaiting; a slower request for store A may overwrite pools after a faster request for store B. There is no post-response check that the response still matches the visible store.
- **Blast radius:** stale Fred Meyer recipients can be selected and receive another store’s EOD; stale manager names can be recorded on the wrong cover sheet (`EOD/index.html:5415-5450`, `EOD/index.html:9167-9417`).
- **Effort:** S
- **Isolation:** Mostly isolated to store-data loading, but tests must cover recipient auto-save and store switching.
- **Call-out:** **URGENT — wrong-recipient send risk.**

## 3. Timesheet acknowledgement store can remain stale and bypass day confirmation

- **Location:** `EOD/index.html:6071-6082`, `EOD/index.html:6171-6180`, `EOD/index.html:6371-6451`; backend `eod-api/src/routes/eod-print-timesheet.js:90-122`
- **Problem:** drifted state / missing server gate. The acknowledgement field is only filled when blank, and print resolution prefers it over the main store. The legacy print endpoint requires auth but not `requireDayConfirm`.
- **Blast radius:** after changing the main store, a retained acknowledgement value can fax a filled timesheet to the previous store’s customer-service fax.
- **Effort:** S
- **Isolation:** Crosses acknowledgement UI and backend route authorization.
- **Call-out:** **URGENT — wrong-store fax risk.**

## 4. SAS mutations trust UI policy and caller-supplied IDs

- **Location:** UI gates at `EOD/index.html:3691-3741` and `EOD/index.html:3988-3989`; `/sas-upload` at `eod-api/src/sas-bridge.js:680-718`; job processing at `eod-api/src/sas-bridge.js:424-496`; legacy shift mutations at `eod-api/src/sas-bridge.js:954-1019`
- **Problem:** role-check/context inconsistency. `/sas-upload` has no route-specific role/day gate and skips store/date/lead resolution when `visitId` is supplied (`eod-api/src/sas-bridge.js:426-452`). Legacy `/sas-shift-remove` deletes a caller-supplied shift ID without a role/store check, and legacy add can fail open when direct-report lookups fail (`eod-api/src/sas-bridge.js:954-1019`).
- **Blast radius:** any allowed authenticated account can target arbitrary SAS visit photo slots or legacy assignments identifiable by ID, including recompleting a visit (`eod-api/src/sas-bridge.js:454-495`).
- **Effort:** M
- **Isolation:** Cross-region; requires shared authorization and exact visit/store/date policy plus inventory of legacy clients.
- **Call-out:** **URGENT — authorization bypass relative to stated UI policy.**

## 5. PROD category-comment mutation lacks role and day-confirm enforcement

- **Location:** UI flow `EOD/index.html:11738-11766`; backend `eod-api/src/shift-management.js:527-615`
- **Problem:** role-check inconsistency / missing context binding. The backend accepts any authenticated user and trusts path visit/reset IDs; it does not verify the requested store/date or require lead/supervisor/admin.
- **Blast radius:** an authenticated non-role account can append “Not In Store”/other supplied text to an arbitrary SAS category reset reachable by ID.
- **Effort:** M
- **Isolation:** Requires backend gate plus exact visit/store/date verification, so it touches route contract and caller payload.
- **Call-out:** **URGENT — SAS mutation is not bound to the confirmed store.**

## 6. Signoff-photo write is not role- or day-confirm-gated

- **Location:** UI gate `EOD/index.html:3741`; caller `EOD/index.html:12897-12919`; backend `eod-api/src/sas-bridge.js:1183-1226`
- **Problem:** role-check inconsistency. The POST trusts client-supplied visit/store/date and is protected only by global authentication (`eod-api/src/index.js:529-534`).
- **Blast radius:** any allowed authenticated user can store arbitrary image data under another visit ID; those images are later presented as server/PROD signoffs (`EOD/index.html:13129-13144`).
- **Effort:** S
- **Isolation:** Backend gate is isolated; store/visit consistency validation is cross-cutting.

## 7. Numeric signoff-photo image URLs are public without signed tokens

- **Location:** whitelist `eod-api/src/index.js:503-505`; byte-serving route `eod-api/src/sas-bridge.js:1256-1279`
- **Problem:** access-control inconsistency / predictable object reference. The global gate explicitly makes `/api/signoff-photos/:photoId/image` public, and the route authorizes only by numeric DB ID.
- **Blast radius:** anyone who guesses/enumerates IDs can retrieve employee/store signoff images.
- **Effort:** M
- **Isolation:** Requires changing URL issuance and all stored/returned image links; not safe as a one-line gate if public email consumers depend on it.
- **Call-out:** **URGENT — potential signoff-image disclosure.**

## 8. Digital signoff records `helpdeskSent=true` before the user decides

- **Location:** `EOD/eod-digital-signoff.js:304-349`; asynchronous prompt path `EOD/index.html:11855-11913`
- **Problem:** race / incorrect audit data. `handleNotInSideEffects()` opens a confirmation modal and returns; the digital module then sets `helpdeskSent = true` for every Not In Store mark, even when the user chooses “Stand down” or a later send fails.
- **Blast radius:** hosted worksheets falsely claim help-desk escalation occurred; downstream reconciliation may not detect missing tickets.
- **Effort:** M
- **Isolation:** Requires an explicit result contract between the monolith and module, then backend mark persistence.

## 9. Multi-issue help desk submission is non-transactional and retry-duplicates earlier emails

- **Location:** `EOD/eod-helpdesk-wizard.js:557-629`
- **Problem:** partial failure / duplicate send. Issues are emailed sequentially; if issue N fails, issues 1…N−1 are already sent, but form state is updated only after the whole loop. Retrying resends earlier issues.
- **Blast radius:** duplicate help-desk tickets and uncertain EOD cover-sheet state.
- **Effort:** M
- **Isolation:** Crosses frontend progress/idempotency and backend request identity.

## 10. Materials recipient fallback can select a substring-matched wrong store

- **Location:** `EOD/eod-materials-browser.js:589-654`; safe comparator in `EOD/index.html:11204-11220`
- **Problem:** drifted exact-store rule. When no selected shift is available, materials requests `/api/shifts?store=` and takes `visits[0]` without canonical whole-number filtering (`EOD/eod-materials-browser.js:613-628`).
- **Blast radius:** SAS substring results can supply another store’s shift members and email addresses to the materials-recipient picker.
- **Effort:** S
- **Isolation:** Isolated frontend fix using the existing exact-store normalizer, with regression tests for 28 vs 281/286.

## 11. EOD help desk trusts client-supplied reporter identity

- **Location:** caller `EOD/eod-helpdesk-wizard.js:559-603`; backend `eod-api/src/index.js:1355-1424`
- **Problem:** identity drift / recipient risk. Route has global auth but no day-confirm or role middleware and uses body `userEmail` to resolve supervisor, CC, and Reply-To instead of authoritative `req.user.email`.
- **Blast radius:** an authenticated user can route/escalate a report as another person or send replies to a supplied address.
- **Effort:** S
- **Isolation:** Backend identity binding is isolated; tests must confirm intended delegated-report behavior.

## 12. `/send-eod` uses client-supplied identity and arbitrary recipients

- **Location:** frontend payload/send `EOD/index.html:9167-9417`; backend `eod-api/src/index.js:1024-1065`, `eod-api/src/index.js:1114-1145`
- **Problem:** trust-boundary weakness. Day confirmation binds req.user/store/date, but the route uses body `userEmail` for Reply-To/audit and accepts arbitrary `recipients`.
- **Blast radius:** an authenticated confirmed user can spoof report identity/Reply-To and send hosted EOD links to arbitrary addresses.
- **Effort:** M
- **Isolation:** Recipient policy and identity binding affect legitimate store/PIC CC workflows.

## 13. Timesheet management mutations have no role middleware

- **Location:** `eod-api/src/routes/eod-timesheet-mgmt.js:79-305`; role resolver `eod-api/src/auth-middleware.js:176-183`
- **Problem:** role-check inconsistency. Day-confirm and auth are required, but lead/supervisor/admin is not; an allowed user with no role can edit punches, regenerate PINs, mint tablet sessions, fax/email, and force-submit.
- **Blast radius:** timesheet accuracy, employee signatures, and delivery.
- **Effort:** S
- **Isolation:** Backend gate is isolated if non-role operational users are not intended clients.

## 14. Department, digital-signoff, and Rebotics mutations have no role middleware

- **Location:** `eod-api/src/routes/dept-signatures.js:62-93`; `eod-api/src/routes/digital-signoffs.js:85-112`; `eod-api/src/rebotics-bridge.js:571-708`
- **Problem:** role-check inconsistency. Signature/signoff writes require auth/day-confirm but no role. Rebotics candidate and bulk-backlog routes require only auth and do not enforce the admin/district scope suggested by the hidden UI.
- **Blast radius:** any confirmed allowed user can replace/delete department signatures or alter worksheet marks; any authenticated user can enumerate candidate tasks for supplied stores and invoke destructive backlog transitions.
- **Effort:** M
- **Isolation:** Backend policy can be centralized, but intended signer roles and Rebotics district/admin rules must be confirmed.

## 15. Form auto-save launches unawaited whole-photo writes on every input/change

- **Location:** `EOD/index.html:5670-5745`, `EOD/index.html:5989-5993`
- **Problem:** write amplification / race exposure. Every input and change serializes the whole form and starts a full IndexedDB `allPhotos` write without debounce or awaiting completion.
- **Blast radius:** mobile performance, storage churn, and uncertain last-write ordering during rapid edits, update reload, or reset.
- **Effort:** M
- **Isolation:** Crosses all form controls and persistence guarantees.

## 16. Reset and post-send clear do not await IndexedDB deletion

- **Location:** `EOD/index.html:10026-10054`, `EOD/index.html:10196-10217`
- **Problem:** asynchronous clear race / silent failure. `PhotoDB.clearPhotos()` is fire-and-forget; UI reports a blank slate immediately and only logs failure.
- **Blast radius:** photos may reappear after refresh or race with another auto-save, contradicting destructive-reset confirmation.
- **Effort:** S
- **Isolation:** Reset flows can be fixed together; send-success UI must await/handle result.

## 17. JOIN tokens expire later than the documented policy

- **Location:** `eod-api/src/lib/timesheet-join.js:73-100`
- **Problem:** security-policy drift. The helper computes offset candidates but returns `simple` in both branches: work-date noon UTC plus 30 hours, not next-day 06:00 Pacific.
- **Blast radius:** public JOIN/PIN access remains valid hours beyond the documented worker window.
- **Effort:** S
- **Isolation:** Isolated expiry helper plus DST boundary tests.

## 18. Lexical-to-window bridges lose department CC and help-desk state

- **Location:** bridge `EOD/index.html:10554-10572`; hydration `EOD/index.html:5791-5794`; consumers `EOD/eod-dept-signatures.js:263-287`, `EOD/eod-helpdesk-wizard.js:613-634`
- **Problem:** tangled state / stale reference. `emailRecipients` and `helpdeskSubmittedReports` are copied onto `window`, unlike the accessor-bound set arrays. Later array replacement creates two owners.
- **Blast radius:** department signer emails can be omitted from EOD recipients, and successfully sent help-desk report objects can be absent from autosave/report state (`EOD/index.html:5691-5696`, `EOD/index.html:9270`).
- **Effort:** M
- **Isolation:** Cross-module contract fix; all read/write sites must move to accessors or shared mutation APIs.

## 19. SAS queue acceptance is reported as sync success and jobs can double-claim

- **Location:** frontend `EOD/index.html:13265-13300`, `EOD/index.html:13310-13339`; status endpoint `eod-api/src/sas-bridge.js:721-738`; worker claim `eod-api/src/sas-bridge.js:555-586`
- **Problem:** false success / queue race. The UI declares synchronization after enqueue and never polls job status. Workers select pending rows before marking them processing, without an atomic conditional claim.
- **Blast radius:** failed uploads are reported successful; concurrent replicas can upload/recomplete the same SAS job twice.
- **Effort:** M
- **Isolation:** Crosses frontend status, queue API, and worker claim transaction.

## 20. One 9,000-line scope shares mutable globals with separately loaded modules

- **Location:** inline script `EOD/index.html:4415-13686`; export bridge `EOD/index.html:10526-10572`; module consumers `EOD/eod-helpdesk-wizard.js:61-103`, `EOD/eod-digital-signoff.js:238-257`, `EOD/eod-dept-signatures.js:263-287`
- **Problem:** god-script / tangled state / implicit contracts. Modules read and mutate `window` arrays/functions whose ownership remains in the monolith.
- **Blast radius:** changes to set labels, recipients, photos, shifts, autosave, or modal behavior can break multiple nominally separate capabilities.
- **Effort:** L
- **Isolation:** Not safe in isolation; incremental boundaries need contract tests before moving state.

## Specific required call-outs

- **UI-only role gates:** SAS upload/coversheet (`EOD/index.html:3691-3741`, `EOD/index.html:3988-3989`; `eod-api/src/sas-bridge.js:680-718`), plus missing route roles on timesheet, digital-signoff, department-signature, and Rebotics bulk mutations (`eod-api/src/routes/eod-timesheet-mgmt.js:79-305`, `eod-api/src/routes/digital-signoffs.js:85-112`, `eod-api/src/routes/dept-signatures.js:62-93`, `eod-api/src/rebotics-bridge.js:632-708`).
- **Photo/draft loss or contamination:** unkeyed device-wide IndexedDB (`EOD/index.html:5223-5270`), daily reset preserving that record (`EOD/index.html:5753-5775`), unawaited writes/deletes (`EOD/index.html:5736-5739`, `EOD/index.html:10033-10034`), and non-persisted InstaWork save status (`EOD/index.html:5183-5191`, `EOD/index.html:9636-9672`).
- **Wrong email/fax target:** store-data response race (`EOD/index.html:5395-5409`), materials fallback selecting the first substring result (`EOD/eod-materials-browser.js:613-628`), and stale acknowledgement-store precedence with ungated legacy fax route (`EOD/index.html:6071-6082`, `EOD/index.html:6171-6180`, `eod-api/src/routes/eod-print-timesheet.js:90-122`).
- **Drifted duplicate business rules:** timesheet classification exists in frontend and backend (`EOD/index.html:6183-6351`; `eod-api/src/lib/eod-timesheet-mgmt.js:124-180`, `eod-api/src/lib/eod-timesheet-mgmt.js:390-465`); store normalization appears in frontend day-confirm, materials, timesheet print, and multiple backend libraries but is not applied by materials fallback (`EOD/index.html:4916-4921`, `EOD/eod-materials-browser.js:84-90`, `EOD/eod-materials-browser.js:613-628`, `EOD/index.html:6171-6180`, `eod-api/src/store-confirmation.js:95-119`); and the immediate-add backend conflicts with the frontend’s simulated pending approval (`EOD/index.html:12219-12233`, `eod-api/src/shift-management.js:629-708`).
