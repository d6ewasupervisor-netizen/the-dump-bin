# EOD change plan

## The three things that matter most

1. **Make store/date context impossible to lose.** Photos, recipients, fax destinations, SAS uploads, and category comments must all be tied to the same confirmed store/date before they leave the phone. Today photos are device-wide, recipient loads can arrive out of order, and several backend mutations trust caller-supplied IDs (`EOD/index.html:5223-5270`, `EOD/index.html:5395-5409`, `EOD/index.html:6071-6082`, `eod-api/src/sas-bridge.js:424-496`, `eod-api/src/shift-management.js:530-615`).
2. **Make “sent” and “synced” mean completed, not queued or assumed.** SAS upload acceptance is presented as success without polling, help-desk marks claim an email was sent before the user decides, and draft/reset operations report completion without awaiting IndexedDB (`EOD/index.html:13265-13300`, `EOD/eod-digital-signoff.js:304-349`, `EOD/index.html:5736-5739`, `EOD/index.html:10026-10054`).
3. **Enforce operational authority on the server.** Cached UI hiding is not security. SAS uploads/comments, timesheet mutations, department signatures, digital marks, Rebotics backlog, shared store data, and public image/status routes need backend policy that does not depend on the currently loaded frontend (`eod-api/src/sas-bridge.js:680-718`, `eod-api/src/routes/eod-timesheet-mgmt.js:79-305`, `eod-api/src/routes/dept-signatures.js:62-93`, `eod-api/src/routes/digital-signoffs.js:85-112`, `eod-api/src/rebotics-bridge.js:571-708`, `eod-api/src/index.js:477-505`).

## Standing constraint — Autonomous / provider-optional mode (owner-gated)

**Intent:** If SAS/PROD and/or Store Intelligence / Rebotics are ever unsupported, withdrawn, or **gated off on Tyson’s say-so**, EOD must still run at **100% for timekeeping and set integrity**: load sets from CSV (or equivalent owned import), collect punches/signatures, and output timesheets — without live SAS or Rebotics.

**Schema + CSV contract (design):** [`09-autonomy-schema.md`](./09-autonomy-schema.md) — own IDs, append-only `observed_at` snapshots, `source`/`source_ref`, write-through on existing SAS reads, CSV as *our* format with SAS as one importer. Round-trip + store 999 harness specified there. **Section 7 of that doc lists what still requires a live provider** (do not hand-wave PROD parity).

**Urgency split:** “Every batch should make the switch cheaper” is necessary but passive. **Write-through snapshots are a discrete slice whose value accrues only after they turn on** — history is not backfillable. Prefer shipping snapshot write-through (S1 in 09) soon after Batch 5, while SAS ground truth still exists to diff. Full autonomous flag / CSV UI can follow; empty snapshot tables cannot be reconstructed later.

This remains a **design constraint on every future change**. Do not key new features on SAS visit/reset IDs as primary keys.

### Already owned (keep and deepen — do not treat as disposable cache)

| Domain | Where today | Autonomous role |
|---|---|---|
| Timesheet rows, PINs, JOIN, real names, signatures | `eod_timesheet_*`, guest handoff, fill/PDF delivery | **Source of truth for time** once entered or imported |
| Day-confirm / store-date authority | `store-confirmation`, day-confirm token | Remains; eligibility must not *require* live SAS forever |
| Store pools / shared store_data | `store_data` | Owned contact/routing data |
| Digital signoff + dept signatures | `digital_signoff_*`, `store_dept_signatures` | Owned closeout marks (SAS comment side-effects optional) |
| Device photos by session | IndexedDB session keys (Batch 5) | Local evidence survives provider loss |
| InstaWork classifier CSV | `instawork_ids.csv` + assets | Pattern for **CSV-first** roster/set load |
| Store 999 / test fixtures | `eod-test-fixtures`, no-SAS roster path | Prototype of “run without live SAS” |

### Still provider-dependent (must become adapters + local mirrors)

| Domain | Today | Target for quick autonomous flip |
|---|---|---|
| Sets / visits / category resets | Live SAS shift + category APIs | **Canonical `eod_sets` (or equiv.)** snapshot on every successful load; CSV import to create/replace day’s sets |
| Live punch pull from PROD | SAS employee actuals | Optional enricher; **our `eod_timesheet_rows` win** when present |
| SAS photo/coversheet upload | `sas-bridge` queue | No-op or local/R2 archive adapter when gated off |
| Rebotics / SI backlog & photo sync | `rebotics-bridge`, kompass-netcap | Fully optional; never block time/set closeout |
| Day-confirm eligibility from SAS schedule | store-confirmation SAS fallback | Fall back to **imported/owned set calendar** + lead day-confirm |

### Rules for upcoming batches (so the flip stays “quick and easy”)

1. **Persist essential details in our DB whenever we touch them.** When a set/roster/punch/reset is fetched from SAS, write a durable snapshot (store, work date, set/visit id, labels, members, category list, source=`sas|csv|manual`). Do not rely on re-fetching SAS to reprint yesterday’s sheet.
2. **Provider behind a gate.** Prefer `EOD_PROVIDER_MODE=sas|autonomous` (name TBD) owner-flippable; autonomous skips SAS/Rebotics session requirements for roster/set/time paths (extend the store-999 pattern, do not special-case only 999 forever).
3. **CSV is a first-class ingest**, not a demo hack: same schema as the snapshot tables; import replaces or merges the day’s sets for a store/date.
4. **Timesheet output must not call SAS.** Fill PDF / office / supervisor send already mostly owned — keep it that way; never reintroduce a hard SAS dependency on submit.
5. **Rebotics/SI is enhancement-only.** Backlog and SI photo sync must degrade to “unavailable” without blocking EOD, JOIN, punches, or timesheet PDF.
6. **Do not delete owned history** when providers come back — reconcile, don’t wipe.

### Minimal future slice (when prioritized — one revertable batch)

Not scheduled ahead of Tier 0/1 bleeding work unless owner pulls it forward:

1. Snapshot tables + write-through on SAS set/member load.
2. CSV import → same tables.
3. `providerMode=autonomous` reads only owned tables + CSV; timesheet mgmt/JOIN/PDF unchanged.
4. Drill: gate SAS off, import CSV, complete punches, emit InstaWork/Kompass sheets.

## Change freeze and release rules

**Freeze lifted 2026-08-02 (PT)** after Tier 0 closed (Batch 7 / FE 2.12.7). See `09-feature-freeze.md`. Batches 8–12 remain on the board without a freeze gate.

**Next discrete slice (before Batches 8–12):** snapshot write-through S1 (`09-autonomy-schema.md`) — history is not backfillable. Field guidance (`08-field-guidance.md`) is preview hygiene only — photo isolation must not depend on lead habits.

Release hygiene still applies: every numbered item below is one independently revertable change. Do not combine storage migration, authorization, UI behavior, and dead-code removal in one release. Backend response fields may be added but not removed or renamed while cached phones remain. A backend route that does not currently receive `X-Day-Confirm` must first gain server-side role/context validation and legacy-request telemetry; requiring the new header is a later release after the updated frontend is established (`EOD/index.html:6440-6451`, `EOD/index.html:11754-11760`, `EOD/index.html:12907-12918`, `EOD/index.html:13265-13323`).

### Telemetry is a safety net, not a gate

`[eod-audit]` stays on forever for regression catch. **Do not** hold T0.5 enforce, Batch 2b, or frontend safety ships waiting for log accumulation. Prepare workstreams in parallel; **ship sequentially** as separate deploys:

| Order | Ship | Surface | Revert |
|---|---|---|---|
| **A** | **T0.9** awaited IndexedDB on update / reset / post-send clear | Frontend only (`eod-version` bump) | Redeploy prior `eod-version.json` + HTML |
| **B** | **Batch 4 + T0.1a** | Frontend only (second release; **must** land on T0.9 update path) | Same |
| **C** | **T0.5 class fixes → enforce** | Backend; `EOD_CONTEXT_VALIDATE_MODE` (`shadow`\|`enforce`, **default enforce**) | Set mode=`shadow` |
| **D** | **Batch 2b** role gates (UI-matched only) | Backend; **per route-family** mode flag | Flip one family to `shadow` |

Risky enforcements follow the `EOD_CONTEXT_VALIDATE_MODE` pattern: `shadow` (log only) \| `enforce` (reject), defaulting to **enforce**.

# TIER 0 — STOP THE BLEEDING

## T0.1a — Stamp photos at capture (Batch 4 interim; no schema migration)

- **What breaks / trigger:** until full session keying ships, device-wide `allPhotos` can still mix stores/dates; waiting for Batch 5 leaves a dangerous window (`EOD/index.html:5223-5270`, `EOD/index.html:9127-9310`, `EOD/index.html:12930-13300`).
- **Minimal fix:** additive only — on every local capture/import, stamp canonical `storeNumber` and `workDate` from the active day-confirm token (fallback: current confirmed form values). No new IndexedDB object store, no key rewrite, no deletes. After day-confirm (and whenever assembling outbound work), exclude any photo whose stamp does not exact-match the active confirmed store/date from UI selection defaults, EOD assembly, SAS upload, and email. Treat **unstamped** legacy photos as non-matching (hidden from outbound; still on device). Do not prompt the lead to reset or clear.
- **Phone/store verification:** capture under store 28/date A, confirm day for 281/date B — 28 photos must not appear in preview/send/SAS. Capture new photos under B; they send. Reload an old unstamped draft and confirm those photos are excluded from outbound until a later Batch 5 recovery path exists.
- **Regression catch:** unit/fixture tests for stamped match, stamp mismatch, missing stamp, and PROD-imported photos that receive a stamp at import time.

## T0.1 — Automatic photo sessions keyed by day-confirm (Batch 5)

- **What breaks / trigger:** `PhotoDB` writes every photo type to `id: allPhotos`; the daily rollover at `EOD/index.html:5753-5775` clears store/date/shift but **deliberately preserves photos**, so old evidence attaches to the next EOD (`EOD/index.html:5223-5270`, `EOD/index.html:9127-9310`, `EOD/index.html:12930-13300`). Training leads to Reset is not an acceptable fix.
- **Design (fully automatic — no user reset, no prompt, no reliance on lead behavior):**
  1. **Session key from day-confirm, not wall clock.** Active photo session key is `session:<normalizedStore>:<workDate>` derived from the day-confirm token’s canonical store and work date. A shift that crosses midnight keeps one session until the lead confirms a new day; midnight alone must not split or wipe work.
  2. **Rollover switches sessions; it never deletes photos.** When the active day-confirm (or confirmed store/date) changes, load/switch to that session’s record. Prior session records remain on device. Re-verify that `loadSaved`’s photo-preservation branch (`EOD/index.html:5753-5775`) no longer bypasses session keying — form rollover may still clear sticky store/date fields, but photos must come only from the active session key, never from a shared preserved bucket.
  3. **Unsent work surfaces, not vanishes.** If any prior session has photos and is not yet **session-complete** (definition below), show a non-blocking “Unsent work from store X, M/D” indicator with a one-tap path to re-open that session (restore day-confirm / form to that store/date and load its photos). Silent abandonment is a failure mode.
  4. **Retention / “successful send” (explicit — must not undo T0.7):**
     - A session is **session-complete** only when: (a) the EOD email API has returned success for that store/date, **and** (b) every SAS upload/coversheet job that originated from that session has reached terminal status `completed`.
     - A session with any originating job in `pending`, `processing`, or `failed` is **not** cleared, regardless of email outcome. Retryable local photos must survive until their job is terminal `completed` (failed jobs stay until the lead retries to completion or explicitly discards).
     - Auto-clear of session photos runs only on session-complete, via the awaited clear path (T0.9). Optionally prune emptied session-complete records after 7 days.
     - **Order with T0.7:** T0.7 (Batch 7) ships first for truthful job polling. Batch 5 (this item) ships session keying, rollover-as-switch, and the unsent indicator, but **must not** auto-clear photos on email success alone. Wire session-complete auto-clear into Batch 7 alongside T0.7 polling (or leave clear disabled until then). Do **not** swap Batch 5 ahead of Batch 7’s completion semantics.
     - Leave the legacy `allPhotos` record untouched on first upgrade; migrate into a recoverable prior-session **without** auto-attaching to the newly confirmed day — surface via unsent-work if it has photos. Reset clears only the **active** session’s photos, not other sessions.
- **Minimal fix:** keep the existing object store; add session-keyed records with `schemaVersion`, store, date, photo arrays, `emailSucceededAt`, and per-session job id/status map (null/empty until known). New saves target only the active session. No mandatory user confirmation dialog to continue working.
- **Phone/store verification:** capture all four types for store 28/date A; confirm a new day B without Reset — A’s photos must not appear in B’s preview/send/SAS, and A must show as unsent work with a path back. Cross midnight without changing day-confirm — same session retained. Email success with a still-pending SAS job — photos remain. All jobs `completed` after email — then clear. Seed legacy `allPhotos` — not auto-attached to B; recoverable via unsent/legacy indicator.
- **Regression catch:** IndexedDB cases for legacy quarantine, same-session midnight, new-store, new-date, unsent indicator, email-ok/job-pending (no clear), email-ok/job-failed (no clear), session-complete clear of one session only, reset-active-only, quota failure, rollback to prior frontend. Manual EOD preview must show only active-session images.

## T0.2 — Reject stale per-store recipient and manager responses

- **What breaks / trigger:** quickly changing stores allows a slower first request to overwrite the second store’s email/manager pools, creating a wrong-recipient send (`EOD/index.html:5395-5409`, `EOD/index.html:5416-5450`, `EOD/index.html:9167-9417`).
- **Minimal fix:** give each `loadStoreData` call a request sequence or `AbortController`; after `await`, compare the requested canonical store, current input value, and latest sequence before applying data. Do not change storage or API shape.
- **Phone/store verification:** throttle the network, enter 28 then 281, and verify only 281’s pool renders; reverse the order. Preview an EOD and inspect every recipient before cancelling.
- **Regression catch:** deterministic delayed-response test; watch `/store-data` failures and wrong-store support reports after deploy.

## T0.3 — Bind legacy timesheet fax to the current confirmed store

- **What breaks / trigger:** acknowledgement fields retain an earlier store, take precedence over the main form, and call an auth-only fax route (`EOD/index.html:6071-6082`, `EOD/index.html:6171-6180`, `eod-api/src/routes/eod-print-timesheet.js:90-122`).
- **Minimal fix:** frontend always derives print store from the canonical main store and displays that immutable value in the acknowledgement. Backend immediately adds role plus server-side store/date eligibility validation using the existing payload, preserving the response contract for cached clients. A later frontend sends `X-Day-Confirm`; only after legacy-call telemetry reaches zero should the route require it.
- **Phone/store verification:** acknowledge store 28, switch to 281, print in test routing, and confirm subject/fax lookup says 281. Try an ineligible store/date and confirm no fax queues.
- **Regression catch:** test blank and filled InstaWork/Kompass sheets, lead/supervisor/admin flows, and old payloads without the new header. Monitor fax subjects and route denials.

## T0.4 — Exact-filter materials recipient fallback

- **What breaks / trigger:** without a selected shift, materials takes `visits[0]` from SAS’s substring-filtered list; store 28 can receive store 281/286 team members (`EOD/eod-materials-browser.js:613-628`, `EOD/index.html:11204-11220`).
- **Minimal fix:** use the existing canonical whole-number comparison before selecting a visit. If zero or multiple exact visits remain, require explicit shift selection; never use the first substring result.
- **Phone/store verification:** test store 28 with mocked 28/281/286 responses and verify only 28 members appear; test multiple exact visits and verify the picker blocks implicit selection.
- **Regression catch:** unit fixture for leading zeros and 28/128/281/286/428; manually email a test material and inspect recipients.

## T0.5 — Authorize and context-bind SAS mutations while preserving cached clients

- **What breaks / trigger:** `/sas-upload`, category-comment append, signoff-photo write, and legacy shift add/remove accept authenticated caller-supplied IDs without the UI’s role/day/store guarantees (`eod-api/src/sas-bridge.js:424-496`, `eod-api/src/sas-bridge.js:680-718`, `eod-api/src/sas-bridge.js:954-1019`, `eod-api/src/sas-bridge.js:1183-1226`, `eod-api/src/shift-management.js:527-615`).
- **Minimal fix:** separate commits per route family: (a) role policy only where shipped UI already gates (Batch 2b); (b) resolve visit/reset/shift server-side and exact-compare its store/date to the **request payload** (job stamp), with the known-class corrections below; (c) reject mismatches before queue/database/SAS writes when `EOD_CONTEXT_VALIDATE_MODE=enforce`. Accept current request bodies unchanged. Day-token **require** stays Batch 8.
- **Known classes corrected in the canonical matcher before enforce (unit fixture each):**
  1. **Store 999 / `test-*` visit fixtures** — supervisor/admin test-mode must not 409.
  2. **Leading zeros + 28 / 128 / 281 / 286 / 428** — whole-number exact match only (`lib/sas-store-match.js`).
  3. **Supervisor / admin** — validate against **allowed** context (visit ↔ payload store/date; role may operate any store). Do **not** require visit store/date to equal the single day-confirm store/date.
  4. **Guest-handoff / tablet** — requests with no day-confirm are not rejected for missing day-confirm; visit↔payload still applies when both present.
  5. **Late jobs on a multi-store day** — validate job/body store+date vs visit, not vs the phone’s *current* day-confirm (earlier session stamps remain valid).
- **Phone/store verification:** lead normal sync/comment/signoff; replay wrong visit/store → 409 before mutation; supervisor cross-store + 999 test-mode succeed; guest/tablet paths without day-confirm do not 409 for absence.
- **Regression catch:** unit fixtures for the five classes; monitor 409 `context_validate` by route; revert with `EOD_CONTEXT_VALIDATE_MODE=shadow`.

## T0.6 — Close enumerable signoff-image URLs in one sitting (issuance + enforcement)

- **What breaks / trigger:** numeric photo IDs are public and enumerable (`eod-api/src/index.js:503-505`, `eod-api/src/sas-bridge.js:524-538`, `eod-api/src/sas-bridge.js:1256-1279`).
- **Consumer check (2026-08-01):** no email body, hosted artifact, PDF, or other repo consumes `/api/signoff-photos/:photoId/image`. **Production sample confirmed:** a real delivered EOD with a sign-off sheet shipped two JWT `/api/eod-files/:id?t=` links (30-day) and zero `/api/signoff-photos/…` URLs. Code path: `storeEodPackage` → `publicArtifactUrl` → `buildEodEmailHtml` (`eod-api/src/lib/eod-artifacts.js:43-117`, `eod-api/src/lib/eod-artifact-jwt.js:51-54`, `eod-api/src/lib/eod-email-html.js:235-243`, `eod-api/src/index.js:1067-1121`). Pre-Jul emails used CID attachments. Dept-signature hosted URLs use the same `publicArtifactUrl` helper (`eod-api/src/lib/dept-signatures.js:137-163`). The only runtime consumers of the public numeric route are EOD frontends that put API-returned relative `url`s in `<img src>` / lightbox without Bearer (`EOD/index.html:12616-12644`). Deprecated `GET /api/visit-photos` also emits these URLs (`eod-api/src/sas-bridge.js:1168-1174`) but has no callers. **Batch 8 compatibility fear for T0.6 does not apply — enforcement stays in Batch 3.**
- **Minimal fix:** in the same backend deploy, (1) return short-lived signed **query** tokens on every new `url` from list/store (and any still-live visit-photos) responses — same pattern as eod-files, so `<img>` works without Bearer, (2) require that token on the image route and remove the public whitelist regex — do **not** enforce Bearer-only, (3) keep numeric IDs and response field names so phones that re-sync get working thumbs. Accept brief broken thumbs for bare URLs already held in memory/draft until re-sync; do not stage a multi-week unsigned window. Rate-limit the image route earlier (Batch 1) so enumeration is expensive even before the close.
- **Phone/store verification:** sync signoffs, confirm thumbnails and EOD preview still load via signed URLs; request adjacent IDs without token → 401/403; confirm an already-sent EOD email still opens PDF/signoff photos via `/api/eod-files/…?t=`.
- **Regression catch:** monitor image 401/403 and in-app signoff thumbnails after deploy. Hosted email links are out of scope for this route.

## T0.7 — Make SAS queue claiming atomic and UI success truthful

- **What breaks / trigger:** concurrent workers can select the same pending job, and the UI says “synced” immediately after enqueue even when processing later fails (`eod-api/src/sas-bridge.js:555-586`, `eod-api/src/sas-bridge.js:721-738`, `EOD/index.html:13265-13300`, `EOD/index.html:13310-13339`).
- **Minimal fix:** backend first atomically claims jobs with a transaction/conditional status update; no API contract change. Frontend then polls the existing job endpoint to terminal `completed/failed`, displays “Queued” until completion, and retains retryable local photos on failure.
- **Phone/store verification:** queue two jobs, force one worker failure, and verify one says failed and photos remain. Run two workers against one job and verify one claim/upload. Repeat for coversheet.
- **Regression catch:** queue metrics for duplicate processing, stale `processing`, and failed jobs; phone test on background/foreground transitions and weak connectivity.

## T0.8 — Fix stale module bridges before trusting recipient/report state

- **What breaks / trigger:** hydration replaces lexical arrays after copies were exported to `window`; department signer CCs and help-desk report objects can disappear from the payload/draft (`EOD/index.html:5346`, `EOD/index.html:5791-5794`, `EOD/index.html:10554-10572`, `EOD/eod-dept-signatures.js:263-287`, `EOD/eod-helpdesk-wizard.js:613-634`).
- **Minimal fix:** use the same getter/setter pattern already used for Not In arrays for `emailRecipients` and `helpdeskSubmittedReports`; module writes must mutate through those accessors. Do not rename storage keys or payload fields.
- **Phone/store verification:** load a saved draft, collect a department signature, and confirm its email appears in preview. Send a test help-desk issue, reload, and confirm report state/form summary persists.
- **Regression catch:** tests for fresh page and hydrated draft; compare recipient/report arrays before preview, after module action, and after reload.

## T0.9 — Await draft saves and clears before reload/success

- **What breaks / trigger:** IndexedDB writes/deletes return asynchronously, but update, reset, and post-send flows continue and report success; quota/private-mode failures are only logged (`EOD/index.html:5256-5337`, `EOD/index.html:5670-5739`, `EOD/index.html:10026-10054`, `EOD/index.html:10196-10217`, `EOD/index.html:13610-13621`).
- **Minimal fix:** make explicit save/clear operations return checked promises. Await them before forced update, reset completion, and post-send clear. On failure, leave memory/UI intact and show “work not cleared/saved”; do not reload. Debouncing routine autosave is a separate Tier 2 change.
- **Phone/store verification:** simulate IndexedDB quota/open failure and confirm update/reset is blocked with recoverable work visible. Verify normal save, reload, reset, and post-send clear.
- **Regression catch:** injected IndexedDB failures and slow transactions; monitor client error telemetry if available.

## T0.10 — Correct backend identity and role boundaries

- **What breaks / trigger:** EOD/help-desk trust body `userEmail`; timesheet, department, digital-signoff, Rebotics, and shared store-data mutations are less restricted than their UI (`eod-api/src/index.js:1024-1065`, `eod-api/src/index.js:1355-1424`, `eod-api/src/routes/eod-timesheet-mgmt.js:79-305`, `eod-api/src/routes/dept-signatures.js:62-93`, `eod-api/src/routes/digital-signoffs.js:85-112`, `eod-api/src/rebotics-bridge.js:571-708`, `eod-api/src/index.js:1487-1533`).
- **Minimal fix (split):** **Batch 2a** — bind actor/Reply-To/supervisor lookup to `req.user.email`; ignore body identity fields (do not reject). **Batch 2b** — add route roles matching **shipped UI exactly, never stricter** (matrix below); each gated family has its own `EOD_ROLE_GATE_*_MODE` (`shadow`\|`enforce`, default enforce). Routes with no reachable UI → Tier 2 deprecation candidates, not new gates.
- **Phone/store verification:** 2a — Reply-To is signed-in user even with modified body. 2b — only UI-gated families 403 no-role users; ungated UI routes still work for authenticated no-role users.
- **Regression catch:** role-matrix integration tests and 403 monitoring by endpoint/app version after 2b. Production `AUTH_MODE=session` verified; keep watching.

### Batch 2b — Role matrix (from shipped UI; gate only where UI already gates)

UI mechanism: `data-requires-role` + `applyUserRoles` (`EOD/index.html` ~4457–4460). Roles from `/api/me`: `admin` \| `supervisor` \| `lead` only.

| Route | Method | UI caller (file:line) | UI role condition | Backend policy | Mode flag |
|---|---|---|---|---|---|
| `/sas-upload` | POST | `index.html` sync/coversheet → `syncToSAS` (~13370) / coversheet (~13415); controls `#syncBefore/#syncAfter/#syncSignoff` (~3691/3716/3741), `.coversheet-action-wrap` (~3988) | `data-requires-role="lead supervisor admin"` | `lead, supervisor, admin` | `EOD_ROLE_GATE_SAS_UPLOAD_MODE` |
| `/api/signoff-photos` | POST | `pushSignoffPhotos` (~13012) ← only `syncPhotos('signoff')` ← `#syncSignoff` (~3741) | same | `lead, supervisor, admin` | `EOD_ROLE_GATE_SIGNOFF_PHOTOS_MODE` |
| `/api/shifts/:visitId/sets/:resetId/append-comment` | POST | Not-In pickers (~11641/11655) + digital sheet side effect | **None** (ungated) | **No new role gate** (match UI) | — |
| `/api/eod/timesheet-mgmt/*` mutations | PATCH/POST | `eod-timesheet-mgmt.js` overlay (Save/JOIN/PIN/tablet/PDF/email/submit) | **None** | **No new role gate** | — |
| `/api/dept-signatures/…` POST/DELETE | POST/DELETE | `eod-dept-signatures.js` wizard | **None** | **No new role gate** | — |
| `/api/digital-signoffs/rows/:rowId/mark` | POST/DELETE | `eod-digital-signoff.js` mark buttons | **None** | **No new role gate** | — |
| `/store-data/:storeNumber` (+ email/manager DELETE) | POST/DELETE | Fred Meyer pool UI (~5485/5467/5546) | **None** | **No new role gate** | — |
| `/api/guest-handoff` | POST | timesheet Send link + dept handoff | **None** | **No new role gate** | — |

### Context binding on role-ungated routes (separate axis from 2b)

Role “never stricter than UI” does **not** mean accept any store/visit. Checked 2026-08-02:

| Family | Role gate | Context bind before | Gap | Fix |
|---|---|---|---|---|
| timesheet-mgmt mutations | none (matches UI) | `requireDayConfirm` on body store/date (`eod-timesheet-mgmt.js:79+`) | none for store/date; no visit ID | keep |
| dept-signatures mutations | none | day-confirm on **body** store; write uses **path** store | path≠body horizontal write | path/claim bind under `EOD_CONTEXT_VALIDATE_MODE` |
| digital-signoffs mark | none | day-confirm on body store; mutate by **rowId** | row’s sheet store unbound | row→sheet store bind under same flag |
| store-pool POST/DELETE | none | auth only (`index.js` → `store-data-pool.js`) | any store; no actor audit | **Step 1 (FE 2.11.5):** send `X-Day-Confirm` (BE ignores require). **Step 2:** flip `requireDayConfirm` when `client_versions` shows fleet on 2.11.5+ (threshold; not pool-mutation ratio). Persisted `changed_by`/`changed_at` on `store_data`. |
| Fleet version (FE 2.11.6) | n/a | `X-EOD-Version` on `authFetch` → `client_versions` upsert | measure running-tab version for store-pool step 2 + Batch 8 | shipped independently of Batch 5 |

**Tier 2 deprecation candidates (no reachable UI — do not gate as the fix):**

| Route | Why unreachable |
|---|---|
| `/rebotics/tasks/bulk-backlog` POST | `#adminToolsLegacy[hidden]`; `initWeeklyTasks` never called |
| `/rebotics/tasks/candidates` GET | same |
| `/api/eod/timesheet-mgmt/pins` PATCH | UI only calls `pins/regenerate` |
| `/api/dept-signatures/:storeNumber/contacts` POST | UI upserts via signature POST only |

## T0.11 — Close unintended public status access

- **What breaks / trigger:** the broad `/api/shift-request/` exception makes status public despite the frontend using authenticated polling (`eod-api/src/index.js:477-478`, `eod-api/src/shift-management.js:764-802`, `EOD/index.html:12334-12372`).
- **Minimal fix:** remove the broad prefix exception and make the status route require the requester, supervisor/admin, or a dedicated signed decision token. Keep the JSON response unchanged.
- **Phone/store verification:** submit removal and poll successfully as requester; verify another user and unauthenticated request cannot read it; verify supervisor decision link still works through `/api/decide`.
- **Regression catch:** removal-request end-to-end test and status-route 401/403 monitoring.

## T0.12 — Stop recording help-desk success before it occurs

- **What breaks / trigger:** digital Not In Store records `helpdeskSent=true` immediately after opening an asynchronous confirmation; stand-down and failed sends become false audit history (`EOD/eod-digital-signoff.js:304-349`, `EOD/index.html:11855-11913`).
- **Minimal fix:** make the side-effect function resolve a result object only after user choice and send outcome; persist `helpdeskSent` from that result. Keep the mark even when help desk is declined, with accurate `false/null` provenance.
- **Phone/store verification:** test Send, Stand down, and forced send failure; inspect refreshed digital sheet provenance for each.
- **Regression catch:** three branch tests plus production monitoring for helpdesk metadata without a corresponding send response.

# TIER 1 — LOCK IN WHAT EXISTS

Tier 0 items are referenced rather than duplicated. “Done” is the field-observable outcome.

| Capability / current status | Done means | Effort | Dependencies | Recommendation |
|---|---|---:|---|---|
| Kompass/InstaWork blank vs prefilled roster — **PARTIAL** because frontend and backend classify separately (`EOD/index.html:6211-6351`, `eod-api/src/lib/eod-timesheet-mgmt.js:139-180`, `eod-api/src/lib/eod-timesheet-mgmt.js:390-465`) | One backend roster is used by print and management, with identical InstaWork exclusion and no silent client reconstruction. | M | T0.3; retain old endpoint for cached clients | **FINISH.** Backend is already the better authority; remove the frontend fallback only after error telemetry proves it is unnecessary. |
| Employee add — **PARTIAL** because UI simulates approval after an immediate SAS add (`EOD/index.html:12208-12233`, `eod-api/src/shift-management.js:629-708`) | The lead sees “Added” only when SAS confirms the immediate add; no invented pending state. | S | T0.5 role/context policy | **FINISH** by deleting the fake delay, not by building an approval system. |
| Digital Not In side effects — **BROKEN** false help-desk provenance (`EOD/eod-digital-signoff.js:304-349`) | Sheet mark, PROD comment, and optional help-desk outcome are separately accurate after refresh. | M | T0.12, T0.5 | **FINISH.** This is core signoff audit history. |
| Digital printable PDF — **STUBBED/PARTIAL** (`EOD/eod-digital-signoff.js:95-108`) | “Open printable PDF” actually opens the sheet’s signed/download-token URL, or the button is absent when unavailable. | S | Existing materials download contract (`EOD/eod-materials-browser.js:63-96`) | **FINISH.** The backend already supplies the key; a dead-end button damages trust. |
| Remembered department contacts and signer CC — **BROKEN** (`EOD/eod-dept-signatures.js:202-210`, `EOD/index.html:10560-10565`) | Unsigned handoff prefills the remembered contact and every collected signer appears in EOD preview recipients. | S | T0.8 | **FINISH.** Do not cut a feature that prevents manual retyping and missed CCs. |
| Manager suggestions — **PARTIAL** due stale store response (`EOD/index.html:5395-5409`) | Suggestions always belong to the visible canonical store. | S | T0.2 | **FINISH** in Tier 0. |
| Multi-issue help-desk email — **PARTIAL** because retry can duplicate prior successful issues (`EOD/eod-helpdesk-wizard.js:557-629`) | Each issue has a client-generated idempotency key and retry sends only failed/unsent issues. | M | Backend accepts additive request ID | **FINISH.** Duplicate tickets create operational noise; keep per-issue sends. |
| Recipient management — **BROKEN** by stale store load and stale bridge (`EOD/index.html:5395-5409`, `EOD/index.html:10560-10565`) | Preview and backend receive exactly the visible store pool, manual recipients, team choice, and collected signer emails. | M | T0.2, T0.8, T0.10 | **FINISH** in Tier 0; do not reduce legitimate PIC CC capability. |
| SAS photo sync / coversheet upload — **BROKEN** by trusted IDs and queue-only success (`EOD/index.html:13265-13339`, `eod-api/src/sas-bridge.js:426-452`, `eod-api/src/sas-bridge.js:721-738`) | Correct visit is server-verified and UI reaches completed/failed terminal state before claiming success. | M | T0.5, T0.7 | **FINISH** in Tier 0. |
| Reset form — **PARTIAL** because delete is not awaited (`EOD/index.html:10173-10217`) | Reset reports success only after the **active** session is cleared; other sessions and unsent work remain recoverable. | S | T0.1, T0.9 | **FINISH.** |
| Autosave/update preservation — **BROKEN/PARTIAL** (`EOD/index.html:5223-5270`, `EOD/index.html:5736-5739`, `EOD/index.html:13610-13621`) | Day-confirm-scoped photo sessions survive update/midnight; reload never starts before durable save confirmation; unsent prior sessions remain visible. | M | T0.1a, T0.1, T0.9 | **FINISH** before another feature release. |
| Role-gated operations — **PARTIAL** because backend policy is uneven (`eod-api/src/sas-bridge.js:681-718`, `eod-api/src/routes/eod-timesheet-mgmt.js:79-305`, `eod-api/src/routes/dept-signatures.js:62-93`, `eod-api/src/routes/digital-signoffs.js:85-112`) | Direct API calls enforce the same or stricter role/context policy as visible controls. | M | T0.5, T0.10 | **FINISH** in Tier 0. |
| Test mode — **PARTIAL** because failed setup calls can leave half-initialized store 999 state (`EOD/index.html:4541-4752`) | Test setup either completes all fixtures and shows ready, or rolls back and shows failed; no outbound production recipient remains. | S | T0 stability complete | **DEFER** until Tier 0 ships, then **FINISH**; it is valuable for regression testing. |
| JOIN QR/PIN — **BROKEN** expiry calculation (`eod-api/src/lib/timesheet-join.js:73-100`) | Tokens expire at the documented next-day 06:00 America/Los_Angeles across PST/PDT boundaries. | S | None | **FINISH** immediately after Tier 0 auth changes; add DST tests. |
| Guest handoff — **PARTIAL** for unsigned remembered contacts (`EOD/eod-dept-signatures.js:202-210`, `EOD/eod-guest-handoff.js:173-209`) | Department and timesheet handoffs prefill the intended recipient and submit through the existing token flow. | S | T0.8 | **FINISH.** |
| Runtime-dependent intended delivery — **UNVERIFIABLE** for fax, Resend, R2, Graph, SAS, override, and supervisor decisions (`EOD/docs/audit/03-capability-matrix.md:9-139`) | A supervisor-owned smoke checklist records one successful test-mode/controlled delivery for every external path after each relevant change. | M | Tiers 0–1 changes | **FINISH verification; do not rewrite.** Code inspection cannot promote these to WORKING. |

# TIER 2 — CONTAIN THE MESS

## 1. Use one exact-store rule everywhere

- **What/where:** expose one frontend canonical comparison from `index.html` and call it from materials/timesheet paths; use `lib/sas-store-match.js` for every backend SAS visit mutation/lookup (`EOD/index.html:4916-4921`, `EOD/index.html:6254-6270`, `EOD/index.html:11204-11220`, `EOD/eod-materials-browser.js:613-628`).
- **Why:** eliminates the proven 28/281 class of drift.
- **Effort:** M.
- **Does not fix:** stale async store responses, authorization, or wrong user-entered store.

## 2. Make backend timesheet roster canonical

- **What/where:** keep `/api/eod/timesheet-mgmt` and bundled CSV as authority; after telemetry, remove the frontend CSV/member reconstruction fallback and its duplicate classifier (`EOD/index.html:6183-6351`, `eod-api/src/lib/eod-timesheet-mgmt.js:124-180`, `eod-api/src/lib/eod-timesheet-mgmt.js:390-465`).
- **Why:** one roster determines print, JOIN, and management.
- **Effort:** M.
- **Does not fix:** bad SAS roster data, stale CSV content, or PDF delivery.

## 3. Make client persistence failures visible and bounded

- **What/where:** after T0.9, debounce routine autosave and coalesce whole-photo writes; roll back optimistic store-pool mutations when API persistence fails (`EOD/index.html:5670-5745`, `EOD/index.html:5989-5993`, `EOD/index.html:5458-5489`, `EOD/index.html:5540-5550`).
- **Why:** reduces mobile storage churn and stops local UI from claiming shared data changed when the API failed.
- **Effort:** M.
- **Does not fix:** session keying (T0.1) or concurrent backend store-data lost updates.

## 4. Make shared store-data updates atomic

- **What/where:** replace read-merge-write updates with transactional/atomic SQL updates and retain current response shapes (`eod-api/src/index.js:197-228`, `eod-api/src/index.js:1487-1533`).
- **Why:** prevents concurrent users from losing email/manager updates.
- **Effort:** M.
- **Does not fix:** wrong-store frontend loading or recipient policy.

## 5. Centralize recipient configuration, not email rendering

- **What/where:** serve District 8/team/Aiyana policy from backend config or `/api/me`; frontend keeps a checked-in fallback for cached/offline compatibility, logs version drift, then removes the fallback in a later release (`EOD/index.html:5350-5388`, `EOD/eod-helpdesk-wizard.js:535-549`, `eod-api/src/index.js:1024-1065`).
- **Why:** prevents district recipient lists drifting.
- **Effort:** M.
- **Does not fix:** the store-data race, arbitrary legitimate PIC CCs, or client/server email HTML duplication. Do not unify preview and server rendering in this plan.

## 6. Standardize module auth failure behavior

- **What/where:** module wrappers must wait for `window.authFetch` and surface one session-expired error instead of falling back to raw unauthenticated `fetch` (`EOD/index.html:4463-4491`, `EOD/eod-timesheet-mgmt.js:17-21`, `EOD/eod-guest-handoff.js:7-11`).
- **Why:** removes silent differences during partial auth initialization.
- **Effort:** S.
- **Does not fix:** backend authorization.

## 7. Remove dead frontend code only after behavior tests exist

- **What/where:** independently delete hidden Weekly Tasks markup/init, dead acknowledgement openers, unused crop helpers/global, `testSetup`, and unreachable `checkAuthStatus`; retain live header connection polling (`EOD/index.html:3608-3669`, `EOD/index.html:6085-6120`, `EOD/index.html:7598-7601`, `EOD/index.html:7946-7960`, `EOD/index.html:10395-10446`, `EOD/index.html:10803-11006`).
- **Why:** removes misleading operational surfaces and reduces accidental resurrection.
- **Effort:** S.
- **Does not fix:** the monolith, live global bridges, or Rebotics backend exposure.

## 8. Retire orphan backend routes by evidence, not assumption

- **What/where:** log callers for legacy `/send-helpdesk-ticket`, aggregate `/api/visit-photos`, manual PIN patch, and legacy SAS bridge endpoints; deprecate, then remove one route per release only after a full operating cycle with zero callers (`eod-api/src/index.js:1198-1275`, `eod-api/src/sas-bridge.js:740-1181`, `eod-api/src/routes/eod-timesheet-mgmt.js:124-139`).
- **Why:** reduces active attack/maintenance surface without breaking unknown tools.
- **Effort:** M.
- **Does not fix:** current EOD routes or cross-app SAS consumers.

## 9. Do not split `index.html`

The specific structural defect is shared mutable state, not file length by itself (`EOD/index.html:4415-13686`, `EOD/index.html:10526-10572`). Fix accessors, context guards, and error contracts in place. Extraction is not required for any Tier 0 or Tier 1 item and would multiply release risk while the trained workflow is new.

# TIER 3 — SCOPE FENCE

## Capabilities that are done and closed

No new options should be added to these after their listed safety dependency:

- **Capture/editor:** camera/upload, HEIC fallback, orientation, crop, rotate, adjustment, annotation, torch, and signoff review are complete; only correctness/accessibility fixes remain (`EOD/index.html:6529-7194`, `EOD/index.html:7381-8669`).
- **Core form:** store/date selection UI, profile manual override/local persistence, manager fields, PROD/SI questions, Not In pickers, notes, lead signature, preview, and reset UX are closed after T0 storage/context fixes (`EOD/index.html:5964-5987`, `EOD/index.html:8782-9399`, `EOD/index.html:10011-10293`, `EOD/index.html:11179-12099`).
- **Department collection:** role wizard, hand-device signing, replacement/clear, required-role feed, and remembered contacts are closed after T0.8/Tier 1 contact repair (`EOD/eod-dept-signatures.js:84-218`, `EOD/eod-dept-signatures.js:230-590`).
- **Materials core:** browse, select pages/files, view, download, email/SMS share, and store print are closed after exact-store and role/error fixes (`EOD/eod-materials-browser.js:122-210`, `EOD/eod-materials-browser.js:233-775`).
- **Timesheet core:** roster, punch/sign, PIN/JOIN/tablet, PDF, print, office, and supervisor submission are closed after roster/expiry/auth fixes (`EOD/eod-timesheet-mgmt.js:339-656`, `eod-api/src/routes/eod-timesheet-mgmt.js:31-305`).
- **Digital signoff:** load, three independent marks, refresh, printable PDF, required roles, and explicit PROD/help-desk side effects are the full scope (`EOD/eod-digital-signoff.js:95-366`).

## Keep and document

- Keep Quick View, test mode, hotfix polling, connection indicators, post-send retention preference, photo conflict assignment, page-level PDF extraction, secure-share SMS, worker self-punch, timesheet office/supervisor submission, hosted EOD links, department/timesheet handoff, and SMS opt-in QR. They support the current field workflow or safe operations and should be named in user/admin documentation (`EOD/index.html:10358-10392`, `EOD/index.html:4424-4892`, `EOD/index.html:13517-13685`, `EOD/eod-materials-browser.js:355-463`, `EOD/eod-materials-browser.js:683-763`, `eod-api/src/routes/timesheet-join.js:96-185`, `EOD/eod-sms-optin-qr.js:1-172`).
- Keep arbitrary timesheet email/download for now, but require lead/supervisor/admin and audit the recipient; it is useful recovery tooling and already day-confirmed (`EOD/eod-timesheet-mgmt.js:573-600`, `eod-api/src/routes/eod-timesheet-mgmt.js:158-239`).
- Treat HEIC conversion, torch, compression, sharpening, dedupe, and retention purge as implementation behavior—not separate product features (`EOD/index.html:6571-7060`, `eod-api/src/index.js:809-822`).

## After Tier 0 (product / autonomy)

The coupling report (`06-coupling.md`) already flags portable pieces — photo capture/editor, department signature wizard, JOIN/PIN worker sessions, guest handoff, secure share — that are not Fred Meyer–specific. Snapshot write-through (S1) is the next autonomy slice; broader product extraction waits until owned set/visit history is accruing.

## Delete or retire

- Delete hidden Weekly Tasks/Rebotics UI and dead diagnostics/helpers after Tier 2 tests; EOD is not a Rebotics backlog console (`EOD/index.html:3608-3669`, `EOD/index.html:10395-10446`, `EOD/index.html:10803-10933`).
- Secure Rebotics APIs immediately, then move their ownership out of EOD documentation; retire them if access logs show no other caller (`eod-api/src/rebotics-bridge.js:571-708`).
- Retire legacy help-desk, aggregate photo, direct SAS shift, and manual-PIN endpoints only through the logged deprecation sequence in Tier 2 (`eod-api/src/index.js:1198-1275`, `eod-api/src/sas-bridge.js:740-1181`, `eod-api/src/routes/eod-timesheet-mgmt.js:124-139`).

## Product boundary

EOD is the authenticated field closeout for one confirmed store/date: select the SAS visit and team, document work and exceptions, collect required signatures/timesheets/photos, send the EOD record, and deliver the small set of materials/help-desk artifacts needed to finish that shift (`EOD/index.html:4904-5170`, `EOD/index.html:8782-9454`, `EOD/index.html:11179-13454`). It is not a general Rebotics administration console, a district tracker, a generic document portal, or a place to add unrelated weekly operations. A future request belongs here only if it is required to prepare, verify, deliver, or recover that store/date closeout.

## Long-term ownership markers — no extraction in this plan

| Mostly/Fully generic capability | Long-term marker | Evidence |
|---|---|---|
| Authentication/session gate | Shared platform service; already conceptually cross-app. Keep EOD role/day policy local. | `EOD/index.html:4417-4491`, `eod-api/src/auth-middleware.js:1-24` |
| Profile persistence | Keep in EOD; it is tiny device-local state, not a service. | `EOD/index.html:5964-5987` |
| Photo capture/editor | Candidate shared vanilla-JS asset for other field tools; keep embedded until EOD safety work is stable. | `EOD/index.html:6529-6877`, `EOD/index.html:7381-8669` |
| Draft/photo persistence | Keep EOD-owned; storage schema is part of EOD recovery semantics. Reuse patterns, not the database. | `EOD/index.html:5223-5343`, `EOD/index.html:5669-5745` |
| Materials viewer/share/email transport | Candidate shared document service; EOD retains fiscal/store adapters. | `EOD/eod-materials-browser.js:233-775`, `eod-api/src/routes/secure-share.js:142-396` |
| Department signature mechanics | Candidate shared signature/contact service; EOD retains retail roles and recipient side effects. | `EOD/eod-dept-signatures.js:290-569`, `eod-api/src/lib/dept-signatures.js:13-24` |
| JOIN/PIN worker infrastructure | Strong candidate shared worker-session service after expiry/auth fixes; EOD retains roster/sheet definitions. | `eod-api/src/lib/timesheet-join.js:12-40`, `eod-api/src/lib/timesheet-join.js:179-424` |
| Guest handoff | Candidate shared expiring-session transport with registered payload handlers. | `EOD/eod-guest-handoff.js:101-209`, `eod-api/src/routes/guest-handoff.js:16-65` |
| SMS opt-in QR | Shared configured component/static asset; no reason to grow its EOD-specific behavior. | `EOD/eod-sms-optin-qr.js:1-172` |

# Ordered execution list

Each batch is one sitting and one deployable/revertable unit. Within a batch, keep separate commits for the numbered items.

## Batch 1 — Freeze, baseline, and observability

- **Ships:** `09-feature-freeze.md` + `09-baseline.json`; `AUTH_MODE=session` re-verified on Railway production; rate-limit `GET /api/signoff-photos/:photoId/image` (120/min/IP); `[eod-audit]` logs for `legacy_no_day_confirm`, `sas_job_transition`, `signoff_image_access`, `role_denial`, `orphan_endpoint_caller` (`eod-api/src/lib/eod-audit-telemetry.js`). Short `08-field-guidance.md` (preview check only).
- **Test:** `node --test test/eod-audit-telemetry.test.js`; production smoke; normal signoff thumbnails under the new rate limits.
- **Watch:** auth failures, active orphan-route callers, queue failure/duplication baseline, image-route 429s, `AUTH_MODE` remaining `session`.
- **Done when:** freeze docs published, telemetry deployed to Railway, and chat reply is **y** for Batch 2 kickoff.

## Batch 2a — Telemetry-independent backend correctness (shipped)

- **Shipped:** T0.7 atomic queue claim; T0.10 identity binding; T0.11 shift-status privacy.
- Telemetry remains on as a safety net; it is **not** a precondition for 2b or T0.5 enforce.

## Batch 2b — Role middleware (UI-matched; ship after matrix above)

- **Ships (deploy D):** `requireRoleMode` on **only** the UI-gated families in the matrix (`/sas-upload`, `/api/signoff-photos`). Per-family env: `EOD_ROLE_GATE_SAS_UPLOAD_MODE`, `EOD_ROLE_GATE_SIGNOFF_PHOTOS_MODE` (`shadow`\|`enforce`, default **enforce**). Do **not** add stricter gates on ungated UI routes. Flag dead Rebotics/orphan routes for Tier 2 deprecation instead of gating.
- **Test:** lead/supervisor/admin succeed; authenticated no-role → 403 on gated families only (enforce); shadow mode logs denial but allows; timesheet/dept/digital still work for no-role.
- **Watch:** 403 spikes by endpoint and app version; revert one family via its mode flag without reverting the batch.

## Batch 3 — Backend store/visit validation (shadow) + signed-image close (shipped)

- **Shipped:** T0.5 shadow + T0.6 signed images + T0.3 fax day-confirm shadow; EOD **2.11.2** poll/`noBounceOn401` + signoff URL refresh.
- **Next (deploy C, after class fixtures):** correct the five known classes in `visit-context-validate.js`, unit fixtures, then flip `EOD_CONTEXT_VALIDATE_MODE=enforce` (default enforce in code). Revert: `shadow`.

## Frontend release A — T0.9 alone (deploy A; ship first)

- **Ships:** T0.9 awaited IndexedDB save/clear before Update navigation, reset completion, and post-send clear; on failure leave memory/UI intact and block reload/success messaging. Bump `eod-version` (e.g. 2.11.3).
- **Hard rule for every later FE deploy:** the Update path must await durable photo save before `location.replace` / reload.
- **Test:** simulated IndexedDB failure blocks Update/reset/clear; normal path succeeds.
- **Watch:** “work not saved/cleared” banners; update loops.

## Batch 4 — Wrong-recipient/wrong-store frontend hotfix + photo stamp guard (deploy B; after A)

- **Depends on:** Frontend release A (T0.9) already on phones so this bump’s Update path awaits IndexedDB.
- **Ships:** T0.2 stale-response rejection, T0.3 immutable fax store, T0.4 exact materials fallback, T0.8 state accessors, **and T0.1a capture-time store/date stamps with outbound exclusion of mismatches/unstamped**; bump EOD version (`EOD/index.html:5395-5409`, `EOD/index.html:6071-6180`, `EOD/eod-materials-browser.js:613-628`, `EOD/index.html:10554-10572`, `EOD/index.html:5223-5270`, `EOD/eod-version.json:1-3`).
- **Test:** throttled rapid store switches, 28/281 materials fixtures, fax test route, hydrated-draft signer CC/help-desk persistence; capture under A then day-confirm B and confirm A photos excluded from preview/send/SAS; unstamped legacy excluded from outbound without deletion.
- **Watch:** wrong-recipient reports, store-data cancellations, preview recipient anomalies, reports of “missing” photos that are actually excluded mismatches (should be rare if stamp matches confirm).

## Batch 5 — Automatic photo-session keying (no email-based auto-clear yet)

- **Ships (FE 2.11.9):** T0.1 via `EOD/eod-photo-sessions.js` — records `session:<store>:<YYYY-MM-DD>` keyed from day-confirm; `sentAt` always null until Batch 7; form rollover clears store/date/day-confirm but **never** reloads shared `allPhotos` into the new day; migration assigns T0.1a-stamped photos to sessions and parks unstamped in `quarantine:legacy` without deleting `allPhotos`; unsent-work banner (non-blocking) with Open session → day-confirm; reset/clear = active session only.
- **Storage caps:** Batch 5 initially used fixed soft **40 MB** / hard **90 MB**. FE **2.12.2** switches to **30% / 50% of `navigator.storage.estimate().quota`** (fallback 40/90 MB if estimate missing); fleet telemetry via `X-EOD-Storage-*` + `X-EOD-Display-Mode` → `client_versions` (eod-api migration 068). Until Batch 7 sets `sentAt`, hard drop never fires — compress + warn only. Safari tab ITP (~7 day unused eviction) is a separate risk; Home Screen / standalone is preferable.
- **Sent prune:** 7 days after `sentAt` (no-op until Batch 7 writes `sentAt`).
- **Rollback:** ≤2.11.8 only reads `allPhotos` by id and ignores `session:*` keys. Batch 5 never deletes `allPhotos` and dual-writes the active session into it on every save, so rolling back keeps active work visible; prior sessions remain on device as `session:*` until upgraded again.
- **Test:** migration matrix on iPhone/Android — stamped-only / unstamped-only / mixed / empty; store+date switch; midnight-crossing same day-confirm; refresh mid-capture; forced update; quota pressure; rollback to 2.11.8; all four photo types; EOD preview = active session only.
- **Watch:** missing/unexpected photos; unsent sessions that never surface; any code path still reading a global preserved photo bucket after rollover.
- **Checkpoint:** end of Batches 1–5 is the period freeze gate. If this batch is not landed by end of period, reassess rather than extending the freeze automatically (T0.1a in Batch 4 is the interim safety net).

## Batch 6 — (absorbed) Durable save/reset/update

- **Superseded by Frontend release A:** T0.9 ships alone before Batch 4. Session-aware reset refinements (active-session-only) remain with Batch 5 (T0.1). Post-send auto-clear still deferred to Batch 7 session-complete.

## Batch 7 — Truthful outbound completion + session-complete clear

- **Shipped (FE 2.12.7):** T0.7 polls `GET /sas-upload/:jobId` to terminal `completed`/`failed` before UI “Synced”; coversheet same. Session records track `sasJobs` + `emailOk`/`emailOkAt`; `sentAt` + awaited clear on session-complete. Failed-after-email: dismiss from unsent banner, or auto-eligible after 14 days (`FAILED_AFTER_EMAIL_ELIGIBLE_MS`). Startup reconciliation re-queries non-terminal jobs so mid-poll closes still settle. Hard-cap drop of sent sessions now has victims. T0.12: `handleNotInSideEffects` awaits Send/Stand-down/send outcome; digital sheet persists `helpdeskSent` only when send succeeds.
- **Test:** successful, failed, timeout, backgrounded, and retried photo/coversheet jobs; email-ok + job-pending (no clear); all jobs completed (clear); Send/Stand-down/failure digital marks.
- **Watch:** queue timeouts, failed-job retry rates, premature photo clears, mismatch between help-desk metadata and sends.

## Batch 8 — Enforce day-confirm headers (images already closed in Batch 3)

- **Ships:** cached-compatible frontend `X-Day-Confirm` (or equivalent) for fax/upload/comment/signoff; after telemetry shows updated clients, **require** the header on those mutation routes. Signed-image enforcement is **not** here — it ships in Batch 3 (`EOD/index.html:6440-6451`, `EOD/index.html:11754-11760`, `EOD/index.html:12907-12918`, `EOD/index.html:13265-13323`).
- **Test:** cached old client still works before header requirement; current client after requirement; confirm hosted email `/api/eod-files` links untouched.
- **Watch:** legacy-request count must be zero before requiring day-confirm; then 401/412 rates on those mutations only.

## Batch 9 — Finish intended broken/stubbed capabilities

- **Ships:** truthful employee-add UI, printable digital PDF, remembered-contact handoff, JOIN expiry/DST fix, help-desk idempotency, fail-closed test setup (`EOD/index.html:12208-12233`, `EOD/eod-digital-signoff.js:95-108`, `EOD/eod-dept-signatures.js:202-210`, `eod-api/src/lib/timesheet-join.js:73-100`, `EOD/eod-helpdesk-wizard.js:557-629`, `EOD/index.html:4541-4752`).
- **Test:** one focused manual/automated test per capability plus the full supervisor test-mode smoke run.
- **Watch:** duplicate help-desk IDs, JOIN expiry failures near DST, test-mode leakage.

## Batch 10 — Canonical roster and operational verification

- **Ships:** backend roster authority in current frontend; keep old API/assets for cached clients. Execute and record controlled SAS, Resend, R2, Graph, fax, override, supervisor, guest-handoff, and hosted-link smoke tests (`EOD/index.html:6183-6351`, `eod-api/src/lib/eod-timesheet-mgmt.js:390-465`, `EOD/docs/audit/03-capability-matrix.md:9-139`).
- **Test:** blank/prefilled InstaWork and Kompass, exclusion list, JOIN, office/supervisor send, materials/EOD/help-desk delivery.
- **Watch:** roster differences and external delivery failures.

## Batch 11 — Containment cleanup

- **Ships:** Tier 2 items one at a time: autosave coalescing, atomic store data, config endpoint/fallback, module auth consistency, proven-dead frontend removal, logged orphan-route deprecation (`EOD/index.html:5670-5745`, `eod-api/src/index.js:197-228`, `EOD/index.html:3608-3669`, `eod-api/src/index.js:1198-1275`).
- **Test:** full EOD smoke after each deletion; compare network/payload snapshots before and after no-behavior-change items.
- **Watch:** unexpected legacy callers and any increase in auth/storage errors.

## Batch 12 — Close the scope

- **Ships:** user/admin documentation for kept extras, capability status updates from runtime evidence, and the product boundary above. No new feature code (`EOD/docs/audit/03-capability-matrix.md:1-139`, `EOD/docs/audit/04-undocumented.md:1-97`).
- **Test:** supervisor reviews the documented workflow against the trained process.
- **Watch:** new requests are accepted only when they directly support one confirmed store/date closeout.
