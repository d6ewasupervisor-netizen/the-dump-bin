# 09 — Owned set/visit snapshot + CSV contract

**Status:** design only — no migrations, routes, importer, or mode flag in this pass.  
**Prerequisite reading:** standing autonomy constraint in [`07-change-plan.md`](./07-change-plan.md).  
**Coupling context:** [`06-coupling.md`](./06-coupling.md).

## Why this exists

Write-through snapshots are cheap while SAS is live and **impossible to backfill** after the tap closes. Timesheets, PINs, signoffs, and photos already live in owned stores; without visit/set/member history they have nothing durable to attach to.

Autonomy is not a separate product path. **Our tables are the app’s set/visit source of truth.** SAS and CSV are importers into that schema. Autonomous mode is a source-selection flag once reads prefer latest snapshot rows.

Commercial note (scope, not a build batch): the same inversion — own IDs + CSV contract + optional provider adapters — is what makes this a field closeout product for operations that never had SAS. Contingency and sellability are nearly the same work **if** decided up front. This document decides the schema that way.

Batch 5 (photo sessions, FE 2.11.9) is **already shipped**. Snapshot write-through is the next **autonomy** discrete slice once owner prioritizes it — it has a deadline we do not control.

---

## Principles (non-negotiable)

1. **Own IDs.** Every snapshot entity has our stable primary key (`uuid` or `bigserial`). SAS/Rebotics IDs are optional `ext_*` references. Autonomous / CSV-created visits must not need a SAS visit id.
2. **Append-only.** Snapshot rows carry `observed_at` (timestamptz) and are **never updated in place**. “Current state” = latest row per natural entity key. History answers “what did this shift look like the day we worked it.”
3. **`source` + `source_ref` on every row.** `source ∈ {sas, csv, manual}`; `source_ref` is free text (SAS URL path + query hash, CSV filename + row number, lead email, etc.).
4. **Snapshot on read.** Write-through on every existing SAS read the app already performs. No scheduled sync job for this contract. (Existing `sas-sync.js` → `schedules`/`employees` remains eligibility cache; it is **not** a substitute for set/member/reset snapshots.)
5. **CSV is our contract.** SAS adapter maps into our tables; CSV importer maps into the same tables through the same validation. App reads latest owned rows in both modes.

**Write-failure rule:** snapshot insert failures **never** block the lead’s SAS (or CSV) read response. Log `[eod-snapshot] write_failed` and return the live payload as today. Silent failure is still better than failing the shift picker — but alertability is required so a broken writer does not go unnoticed for weeks.

---

## 1. Minimum table designs

Shared columns on every snapshot table:

| Column | Type | Notes |
|---|---|---|
| `id` | `BIGSERIAL` PK | Our row id (one observation) |
| `entity_id` | `UUID NOT NULL` | Stable identity across observations |
| `observed_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | Append-only clock |
| `source` | `TEXT NOT NULL` | `sas` \| `csv` \| `manual` |
| `source_ref` | `TEXT` | Provenance |
| `store_number` | `TEXT NOT NULL` | Canonical integer string (no leading zeros) |
| `work_date` | `DATE NOT NULL` | Operational day (day-confirm sense) |

Indexes (typical): `(store_number, work_date, observed_at DESC)`, `(entity_id, observed_at DESC)`, optional unique is **not** used for upsert — uniqueness is for current-view helpers only via `DISTINCT ON` / window functions.

### 1.1 `eod_snap_visits`

| Column | Type | Required | Ext ref |
|---|---|---|---|
| `entity_id` | UUID | yes | — |
| `ext_sas_visit_id` | TEXT | no | SAS `v.id` |
| `ext_sas_cycle_id` | TEXT | no | `cycle_id` |
| `ext_sas_project_id` | TEXT | no | `project.project_id` |
| `project_name` | TEXT | yes | |
| `program_name` | TEXT | no | |
| `kompass_type` | TEXT | no | derived label (ISE / Cut In / …) |
| `store_name` | TEXT | no | |
| `scheduled_date` | DATE | yes | usually = `work_date` |
| `shift_start_time` | TEXT | no | store-local display/raw |
| `shift_end_time` | TEXT | no | |
| `visit_lead_name` | TEXT | no | |
| `current_status` | TEXT | no | |
| `total_hours` | NUMERIC | no | |
| `emp_count` | INT | no | advisory |
| `label` | TEXT | no | human set/visit label for UI |

**If absent when SAS gone:** cannot list “today’s sets,” cannot bind day-confirm eligibility to owned calendar, cannot attach timesheet `visit_id` / digital marks / photos to a worked unit. **Essential.**

### 1.2 `eod_snap_shifts`

A shift is one person’s assignment on a visit (SAS `team-scheduling/shifts` row).

| Column | Type | Required | Ext ref |
|---|---|---|---|
| `entity_id` | UUID | yes | — |
| `visit_entity_id` | UUID | yes | FK logical → visit |
| `ext_sas_shift_id` | TEXT | no | `s.id` |
| `ext_sas_employee_id` | TEXT | no | |
| `ext_workday_id` | TEXT | no | |
| `person_name` | TEXT | yes | platform / roster name |
| `person_title` | TEXT | no | |
| `phone` | TEXT | no | |
| `email` | TEXT | no | |
| `is_lead` | BOOLEAN | yes default false | |
| `shift_start_time` | TEXT | no | |
| `shift_end_time` | TEXT | no | |
| `current_status` | TEXT | no | snapshot of `active`/etc. |
| `sheet_hint` | TEXT | no | `instawork` \| `kompass` \| null (classifier hint) |

**If absent:** JOIN PINs and timesheet rows lose who was on the set; PDF roster empty. **Essential.**

### 1.3 `eod_snap_shift_members` — *collapsed into shifts*

Do **not** create a separate members table for v1. SAS “member” ≡ active shift row. Keep one table (`eod_snap_shifts`) to avoid dual sources of truth. Name retained in the ask as “shift members”; schema = §1.2.

### 1.4 `eod_snap_set_items` (category resets / planogram sets)

| Column | Type | Required | Ext ref |
|---|---|---|---|
| `entity_id` | UUID | yes | — |
| `visit_entity_id` | UUID | yes | |
| `ext_sas_reset_id` | TEXT | no | category-reset `id` |
| `name` | TEXT | yes | set display name |
| `category_number` | INT | no | SAS `number` (not 5555 cart) |
| `planogram_id_raw` | TEXT | no | raw `planogram_id` |
| `dbkey` | TEXT | no | parsed; digital signoff row key |
| `version` | TEXT | no | |
| `footage` | TEXT | no | |
| `reset_type` | TEXT | no | |
| `is_photo_required` | BOOLEAN | no | |
| `exclude_reason` | TEXT | no | e.g. `cart_admin` if we ever snapshot 5555 for audit |

Cart/admin KOMPASS MAINTENANCE (cat 5555) is **not** a set for closeout integrity; optional to omit entirely from snapshots.

**If absent:** set integrity fails — no list of work units, no dbkey bridge to digital signoff rows, no SAS upload targeting later. **Essential.**

### 1.5 Set ↔ visit linkage

`visit_entity_id` on `eod_snap_set_items` **is** the linkage. No junction table in v1 (sets belong to exactly one visit observation lineage). If a future multi-visit “wave” appears, add `eod_snap_visit_set_links` then — not now.

### 1.6 `eod_snap_roster_people` (store roster / directory)

People who may appear on a store/date without requiring a live HR pull.

| Column | Type | Required | Ext ref |
|---|---|---|---|
| `entity_id` | UUID | yes | — |
| `ext_sas_employee_id` | TEXT | no | |
| `ext_workday_id` | TEXT | no | |
| `display_name` | TEXT | yes | |
| `legal_name` | TEXT | no | |
| `title` | TEXT | no | |
| `phone` | TEXT | no | |
| `email` | TEXT | no | |
| `is_instawork` | BOOLEAN | no | from classifier / CSV |
| `supervisor_ext_id` | TEXT | no | for add-member eligibility cache |

**If absent:** add-member directory and lead-info autofill degrade; **timesheet still works** if `eod_snap_shifts` for the day exists. **Important for ops UX; not required for “print yesterday’s sheet” if shifts were snapshotted.**

### 1.7 Punch observations (optional enricher — not time SoT)

| Column | Type | Required | Ext ref |
|---|---|---|---|
| `entity_id` | UUID | yes | same lineage as shift person-day |
| `shift_entity_id` | UUID | yes | |
| `ext_sas_shift_id` | TEXT | no | |
| `clock_in` / `lunch_out` / `lunch_in` / `clock_out` | TEXT | no | display times |
| `punch_status` | TEXT | no | |

**Authoritative punches for print/fax = our timesheet, not PROD.**  
`buildFilledTimesheet` → `rosterToFillEmployees` → `clockIn`/`lunch*`/`clockOut` from merged roster (`timesheet-delivery.js:62-90`, `eod-timesheet-mgmt.js:rosterToFillEmployees`). Merge prefers saved `eod_timesheet_rows` when `time_source` is `employee` or `lead`, and employee handoff/JOIN submits (`eod-timesheet-mgmt.js:379-409`). PIN/JOIN, real names, and the clock picker are a complete owned punch system. SAS `shift-complete` is a convenience prefill only. Snap punches here are advisory history of “what PROD showed when we looked.”

**If absent:** no loss of printed timesheet integrity.

### 1.8 Owned visit creation and roster management (required for continuity)

`eod-setlist` v1 already carries **`visit` + `person` + `set`** rows (§2) — not set lists alone. That covers importing a week’s work from a spreadsheet.

Continuing to operate after the tap closes also needs **in-app** creation with `source=manual`, same tables, same validation as CSV:

| Capability | Writes | Notes |
|---|---|---|
| Create visit | append `eod_snap_visits` | Mint `entity_id`; `client_visit_key` or generated key; no SAS id |
| Add / remove shift member | append `eod_snap_shifts` | Latest observation shows membership; “remove” = append row with `current_status='removed'` (or omit from current-state filter) |
| Edit set list | append `eod_snap_set_items` | Same pattern |
| Maintain directory | append `eod_snap_roster_people` | Feeds add-member picker / HR search in autonomy |

Without this slice, snapshots + CSV-only still leave a hole: the first Monday with no file and no UI to create a visit. **CSV import and manual create are the same door** (§ principle 5).

**Day-confirm in autonomy:** eligibility = an owned current-state visit exists for `(store_number, work_date)` (optionally lead listed on that visit), or elevated role — **not** a live SAS schedule check. No owned/CSV/manual visit ⇒ cannot confirm; that is correct fail-closed, not a missing provider.

### 1.9 Entity-id minting rules

| Create path | Rule |
|---|---|
| SAS visit first seen | Mint `entity_id`; store `ext_sas_visit_id` |
| Later SAS reads same `ext_sas_visit_id` | Reuse `entity_id`; **append** new row |
| CSV visit without SAS id | Mint `entity_id`; `ext_sas_visit_id` null; stable key via `(store_number, work_date, client_visit_key)` in CSV |
| Set item | Prefer match prior `entity_id` by `(visit_entity_id, dbkey)` else `(visit_entity_id, name, category_number)` else mint |
| Shift | Prefer `(visit_entity_id, ext_workday_id)` else `(visit_entity_id, ext_sas_employee_id)` else `(visit_entity_id, normalized name)` |

`client_visit_key` (CSV) is a lead- or importer-supplied stable string (e.g. `ise-a`, `cutin-1`) so re-imports append to the same visit lineage without SAS ids.

### 1.10 Current-state view (not a table)

```sql
-- Example pattern (not shipped this pass)
SELECT DISTINCT ON (entity_id) *
FROM eod_snap_visits
WHERE store_number = $1 AND work_date = $2
ORDER BY entity_id, observed_at DESC;
```

App/API in autonomous mode reads these views (or equivalent queries), never “the last SAS response.”

---

## 2. CSV contract — `eod-setlist` v1

**Format id:** `eod-setlist`  
**Version:** `1`  
**Encoding:** UTF-8 with BOM allowed; `\n` or `\r\n`; comma-separated; RFC 4180 quoting.  
**File types:** one logical import may be a **zip of three CSVs** or a **single CSV with `record_type`**. Prefer **single file with `record_type`** for v1 (simpler tablet/ops handoff).

### 2.1 Header row (required)

First line must include at least:

`format,format_version,record_type,...`

Importer rejects unknown `format` / unsupported `format_version`.

### 2.2 Record types

#### `meta` (optional, ≤1 logical row)

| Column | Type | Req | Notes |
|---|---|---|---|
| `format` | enum | yes | `eod-setlist` |
| `format_version` | int | yes | `1` |
| `record_type` | enum | yes | `meta` |
| `store_number` | text | yes | canonical |
| `work_date` | date | yes | `YYYY-MM-DD` |
| `exported_at` | iso timestamptz | no | |
| `source_note` | text | no | |

#### `visit`

| Column | Type | Req | Notes |
|---|---|---|---|
| `format` / `format_version` / `record_type` | | yes | `visit` |
| `store_number` | text | yes | |
| `work_date` | date | yes | |
| `client_visit_key` | text | yes | **Our** stable key — **no SAS id required** |
| `project_name` | text | yes | e.g. `Kompass ISE` |
| `program_name` | text | no | |
| `kompass_type` | text | no | |
| `label` | text | no | UI label |
| `visit_lead_name` | text | no | |
| `shift_start_time` | text | no | `HH:MM` or `h:mm AM/PM` |
| `shift_end_time` | text | no | |
| `ext_sas_visit_id` | text | no | only if known |
| `ext_sas_cycle_id` | text | no | |

#### `person` (shift member)

| Column | Type | Req | Notes |
|---|---|---|---|
| `record_type` | | yes | `person` |
| `store_number` / `work_date` | | yes | |
| `client_visit_key` | text | yes | links to visit |
| `client_person_key` | text | yes | stable within visit (e.g. workday id or `p1`) |
| `person_name` | text | yes | |
| `real_name` | text | no | InstaWork legal/badge (feeds timesheet real_name) |
| `workday_id` | text | no | |
| `title` | text | no | |
| `phone` / `email` | text | no | |
| `is_lead` | bool | no default false | `true`/`false`/`1`/`0` |
| `sheet_hint` | text | no | `instawork` \| `kompass` |
| `shift_start_time` / `shift_end_time` | text | no | |
| `ext_sas_shift_id` / `ext_sas_employee_id` | text | no | |

#### `set`

| Column | Type | Req | Notes |
|---|---|---|---|
| `record_type` | | yes | `set` |
| `store_number` / `work_date` | | yes | |
| `client_visit_key` | text | yes | |
| `client_set_key` | text | yes | stable within visit (prefer `dbkey` when known) |
| `name` | text | yes | |
| `category_number` | int | no | |
| `dbkey` | text | no | |
| `version` / `footage` | text | no | |
| `reset_type` | text | no | |
| `ext_sas_reset_id` | text | no | |

### 2.3 Arriving without any SAS identifier

**Confirmed:** v1 is a **visit + membership + set** contract, not “set lists only.”

Minimum viable import for a working shift:

1. One `visit` row with `client_visit_key`, `store_number`, `work_date`, `project_name`.
2. One or more `person` rows with `client_person_key` + `person_name` (who is working).
3. Zero or more `set` rows with `client_set_key` + `name` (zero sets allowed for time-only days; empty set list is intentional).

Importer mints UUIDs; appends `source=csv` rows; never requires `ext_sas_*`. Same shape as manual create (§1.8).

### 2.4 Versioning

- Bump `format_version` on breaking column renames/removals.
- Additive optional columns allowed in v1 without bump if ignored by older importers.
- Exporters always write `format_version` they speak.

---

## 3. Mapping tables

### 3.1 SAS → our columns

| SAS field | Our column | Essential / derivable / droppable in autonomy |
|---|---|---|
| `field-data[].id` | `ext_sas_visit_id` | **Droppable** as PK; keep as ext ref when present |
| `cycle_id` | `ext_sas_cycle_id` | Droppable for CSV closeout; needed only for live shift-add |
| `project.name` / `project_name` | `project_name` | **Essential** |
| `project.project_id` | `ext_sas_project_id` | Droppable |
| `program.name` | `program_name` | Derivable / optional |
| `store_name.name` | `store_name` | Optional |
| `scheduled_date` | `scheduled_date` / `work_date` | **Essential** |
| `shift_start_time` / `shift_end_time` | same | Useful; optional if punches owned |
| `visit_lead` | `visit_lead_name` | Useful for eligibility UX |
| `current_status` | `current_status` | Optional |
| `total_hours`, `emp_count`, `no_show_count`, `due_by` | advisory cols | Droppable |
| `team-scheduling/shifts[].id` | `ext_sas_shift_id` | Droppable as PK |
| `employee.id` | `ext_sas_employee_id` | Droppable as PK |
| `employee.workday_given_id` | `ext_workday_id` | **Essential when known** for Instawork classifier / PIN keying |
| `person.person_name` | `person_name` | **Essential** |
| `person_title`, phone, email | same | Useful |
| `is_lead` | `is_lead` | **Essential** |
| `shift-complete` actual_* / breaks | punch snap cols | Derivable from owned timesheet; live refresh **droppable** in autonomy |
| `category-resets[].id` | `ext_sas_reset_id` | Droppable as PK; **required for live SAS photo upload** |
| `name`, `number` | `name`, `category_number` | **Essential** (name) |
| `planogram_id` | raw + parsed `dbkey`/`version`/`footage` | **dbkey essential** for digital signoff bridge when using that sheet |
| `reset_type` | `reset_type` | Optional (do not filter sets on it — see `shift-management.js:499-503`) |
| `state.before/after.images` | **not in v1 setlist** | Media URLs — separate concern; autonomy keeps device/R2 photos |
| KOMPASS MAINTENANCE 5555 | omit | Droppable as set |

### 3.2 CSV → our columns

| CSV column | Our column |
|---|---|
| `client_visit_key` + store/date | mints/reuses `visit.entity_id` |
| `ext_sas_visit_id` | `ext_sas_visit_id` |
| `project_name`, `kompass_type`, times, lead | visit cols |
| `client_person_key` | mints/reuses `shift.entity_id` |
| `person_name`, `real_name`, `workday_id`, … | shift (+ timesheet real_name side-effect on import — implementation later) |
| `client_set_key` / `dbkey` | mints/reuses `set_item.entity_id` |
| `name`, `category_number`, … | set_item cols |
| (always) | `source='csv'`, `source_ref='file:…#row N'` |

### 3.3 SAS-only fields with no CSV equivalent

| Field | Verdict |
|---|---|
| Live image binary URLs on reset state | **Droppable** for setlist; photos owned on device / R2 |
| `cycle_id` for POST new shifts | **Essential only** for live SAS shift-add — autonomy uses manual/CSV person rows instead |
| Direct-report supervisor tree | **Droppable** if CSV/roster snap supplies people; else add-member UI disabled |
| Upload slot `is_photo_required` / counts | Useful; droppable for time/set integrity |
| Exact SAS `current_status` enums | Droppable |

---

## 4. Write-through points (existing SAS reads)

Each point: after successful map of SAS JSON → domain objects, **fire-and-forget** append snapshot rows (await in background or `setImmediate`/queue). On snapshot error: log, **still return** the mapped response to the client.

| # | Read path | File:line (approx) | Entities written |
|---|---|---|---|
| W1 | `GET /api/shifts` → store-numbers + field-data | `eod-api/src/shift-management.js:304-364` | visits |
| W2 | `GET /api/shifts/:visitId/members` → shifts + shift-complete | `eod-api/src/shift-management.js:411-470` | shifts, punch snaps |
| W3 | `GET /api/shifts/:visitId/sets` → category-resets | `eod-api/src/shift-management.js:496-528` | set_items |
| W4 | Timesheet `fetchVisitsForStoreDate` | `eod-api/src/lib/eod-timesheet-mgmt.js:226-261` | visits |
| W5 | Timesheet `fetchMembersForVisit` | `eod-api/src/lib/eod-timesheet-mgmt.js:264-286` | shifts |
| W6 | Timesheet `fetchPunchMapForVisit` | `eod-api/src/lib/eod-timesheet-mgmt.js:288-311` | punch snaps |
| W7 | `getCategoryResets` / visit photo before·after image lists | `eod-api/src/sas-bridge.js:332-344`, `1217-1272` | set_items (metadata); **not** image blobs in v1 |
| W8 | `fetchVisitDetail` (context validate / uploads) | `eod-api/src/sas-bridge.js:391-402` | visits (enrichment) |
| W9 | Day-confirm live field-data fallback | `eod-api/src/store-confirmation.js:252+` | visits (+ lead) |
| W10 | `GET /api/employees` / lead-info | `eod-api/src/shift-management.js:100-126`, `370-399` | roster_people |

**Frontend triggers (no direct DB writes from FE):** shift picker / materials / timesheet refresh / sets map in `EOD/index.html` (~11179–11783, ~6583), `EOD/eod-timesheet-mgmt.js` refresh, `EOD/eod-materials-browser.js` team load.

**Explicitly not a write-through substitute:** `sas-sync.js` schedules sync (`sas-sync.js:203-218`) — different grain, upsert-style today, no sets/members. Do not rely on it for set integrity.

**Confirm:** write failure never blocks read — hard requirement in implementation acceptance tests.

---

## 5. Round-trip validation plan

### 5.1 Automated test (can run in CI with fixtures)

**Name:** `autonomy-setlist-roundtrip`

1. Seed scratch schema (or transaction) with known snapshot rows for store `28`, date `D` (fixture JSON matching mapped `/api/shifts` + members + sets shapes).
2. **Export** → `eod-setlist` v1 CSV bytes via exporter (pure function).
3. **Import** CSV into empty scratch tables with `source=csv`.
4. **Diff current-state views** visit/person/set against source fixture on canonical fields: store, date, client keys / names, dbkeys, lead flags. Ignore `observed_at`, `id`, `source`, `ext_sas_*` unless present in CSV.
5. Fail on missing/extra set names, missing persons, visit count mismatch.

### 5.2 Live diff drill (while SAS is up — ground truth free)

1. Pick a real store/date with ISE traffic; load shifts/members/sets through the app (write-through on).
2. Export snapshot → CSV.
3. Import CSV into scratch (or store `999` scratch keys).
4. Diff export against **live** `/api/shifts`, `/members`, `/sets` responses for that store/date (exact store match).
5. Record known diffs (status fields, 5555 omission, punch timing skew).

### 5.3 Store 999 harness (no-SAS)

| Step | Expectation |
|---|---|
| `providerMode` autonomous **or** store 999 path | No `isSessionAlive` requirement for roster/sets |
| Import `eod-setlist` v1 for store `999` / today | Visits + persons + sets appear in current-state queries |
| Timesheet mgmt + JOIN PIN + punch + PDF | Works as today with fixture/CSV people (`eod-test-fixtures.js` pattern generalized) |
| Digital signoff rows | Optional: generate from `set` dbkeys or keep demo-clone — document which |
| Export again | Round-trip stable on client_* keys |

999 today: timesheet bypasses SAS (`eod-timesheet-mgmt.js:450-466`); sets via digital-signoff demo-clone (`shift-management.js:491-493`, FE clone). Harness goal: **CSV replaces clone** as the no-SAS set source.

---

## 6. Sizing estimate

Assumptions (from code comments + page sizes):

| Fact | Value | Source |
|---|---|---|
| Visits / store / day | ≤ ~5 typical; API `page_size: 20` | `shift-management.js:328` |
| Members / visit | ≤ ~15 typical; API `page_size: 50` | `shift-management.js:414` |
| Sets / ISE visit | ~45 peak | comment `shift-management.js:499-503` |
| Observations / entity / day | ~3–10 if lead refreshes often | write-through on each read |
| District stores (order of magnitude) | ~80–120 Fred Meyer D6–D8 class | ops knowledge — tune later |
| Period | 4 weeks | fiscal |

**Per store per day (peak ISE, 2 visits, 12 members, 45 sets, 5 observations each):**

- Visits: 2 × 5 = 10 rows  
- Shifts: 12 × 5 = 60  
- Sets: 45 × 5 = 225  
- Punches (optional): ~60  
- **≈ 350 rows/day/store busy**  
- Row width ~400–800 bytes → **~0.2–0.3 MB/store/day** busy; idle days << 50 KB

**Per store per period (28d, mix of light/heavy):** ~2–5 MB generous upper bound.

**Per district per year (~100 stores):** roughly **10–50 GB/year** append-only if never pruned and every refresh snapshots — likely **high**; still affordable on Postgres if indexed, but pruning policy recommended.

### Pruning policy (append-only preserved in spirit)

1. **Hot window:** retain all observations for **90 days**.
2. **Cold compact:** for rows older than 90 days, delete **only intermediate** observations. **Never remove the latest observation per `entity_id`** (global latest across all time for that entity). Also retain, when useful for history, the latest observation **per (`entity_id`, `work_date`)** for dates inside any retention archive window, plus any row referenced by timesheet/signoff foreign keys.
3. Compaction must fail closed: if a candidate delete would leave an `entity_id` with zero rows, skip that delete.
4. Compaction is a **batch job**, separate from write-through — does not violate “no sync job for capture.”

Append-only at raw refresh volume is affordable short-term (months); compaction keeps multi-year history sane. **Hard rule: prune never drops current state.**

---

## 7. Limits — reads vs writes

Distinguish **writes into a provider that no longer exists** from **gaps in our own operating model**.

### 7A. Capabilities that disappear with the provider (by definition)

These are outbound writes (or SI truth) to systems that are gone. They are **not** failures of autonomous mode. Closeout evidence lives in our tables / device / R2 / email instead.

| # | Capability | Today | When provider is gone |
|---|---|---|---|
| A1 | SAS photo / coversheet upload into category-reset slots | `sas-bridge.js` `sasPatch` | Nothing to upload to; keep session photos + EOD/R2/email delivery |
| A2 | Reset comment PATCH (Not In Store / Not In SI → PROD) | `shift-management.js:534+` | Nothing to comment on; keep `digital_signoff_marks` + helpdesk email |
| A3 | Rebotics / Store Intelligence backlog + SI photo truth | `rebotics-bridge`, kompass-netcap | Optional enhancement disappears; must never have blocked closeout |

### 7B. Genuine limitations / design resolutions

| # | Topic | Resolution |
|---|---|---|
| B1 | **Create a shift from nothing** (former “add/remove on PROD schedule” + “day-confirm with no visit”) | **One gap, two hats.** Not a SAS dependency — a continuity requirement on *us*. **`eod-setlist` v1 already includes `visit` + `person` (+ `set`) rows** (§2.3), so CSV can stand up a store/date. **Also required:** in-app owned visit creation and membership management (`source=manual`, §1.8) so Monday works without a spreadsheet. Day-confirm in autonomy uses owned current-state visits (or elevated roles), fail-closed if none exist. |
| B2 | **HR directory / add-member search** (former item 7) | **Covered by design, not a permanent limit.** `eod_snap_roster_people` (§1.6) + CSV `person` rows + manual roster appends (§1.8) *are* the directory. Autonomous add-member searches latest roster snapshots. If the picker is empty, the hole is “no roster data loaded,” not “needs Workday live.” Live Workday search remains a SAS-mode convenience only. |
| B3 | **Needs a SAS id never observed** (former item 8) | **Unavoidable for provider-shaped actions** that still assume an `ext_sas_*` (e.g. uploading to a PROD reset created after the last read). Irrelevant to owned closeout once 7A capabilities are treated as gone. Do not invent SAS ids. |

**Punch authority (former item 4) — removed from limitations.** Our timesheet is authoritative for what we print and fax (`buildFilledTimesheet` / `rosterToFillEmployees` / `eod_timesheet_rows` with employee|lead `time_source`). PROD punch pull is prefill only (§1.7).

Autonomy means **continue operating** time + set integrity on owned data (import **or** create), not **full PROD write parity**.

---

## Implementation sequencing (design intent only)

| Slice | What | Note |
|---|---|---|
| **S0** | This doc | Done |
| **S1** | Migrations + write-through W1–W6 (visits/shifts/sets/punches) fire-and-forget | Accrues history immediately; no mode flag yet |
| **S2** | Export `eod-setlist` v1 from current-state views | Enables live SAS diff drill |
| **S3** | Import CSV → append `source=csv`; store 999 harness | Prove round-trip (visit+person+set) |
| **S4** | Manual visit / member / set create (`source=manual`) + day-confirm from owned visits | Continuity without spreadsheet |
| **S5** | Read path prefers latest snapshots when `EOD_PROVIDER_MODE=autonomous` | Config flag, not rewrite |
| — | Batch 5 photo sessions | **Shipped (FE 2.11.9)** |

S1 is the piece whose value starts the day it turns on and not one day earlier.

---

## Acceptance checklist for a future build PR (not this pass)

- [ ] Own UUIDs; SAS ids nullable ext refs only  
- [ ] Append-only inserts; no `UPDATE` of snapshot bodies  
- [ ] `source` + `source_ref` populated  
- [ ] W1–W6 write-through; failure does not change HTTP success of SAS read  
- [ ] Round-trip test green on visit+person+set; 999 CSV harness documented  
- [ ] Manual visit/member create works without SAS ids  
- [ ] Compact prune never deletes latest row per `entity_id`  
- [ ] §7A capabilities disabled/stubbed with clear UI copy; not billed as autonomy bugs  
