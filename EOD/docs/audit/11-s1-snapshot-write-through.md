# S1 — Owned snapshot write-through (capture only)

Shipped with eod-api migration `069_eod_snapshots.sql` + FE **2.12.8** (`persist()` + web app manifest).

## Non-negotiables (implemented)

1. Fire-and-forget via `setImmediate` — snapshot errors log `[eod-snapshot] write_failed` and never change HTTP success.
2. Append-only rows with `observed_at`, `source`, `source_ref`, own `entity_id` UUID.
3. Content-hash dedupe per entity; identical payload → no append.
4. SAS ids are `ext_*` only.
5. Partial payloads cannot become latest over a complete prior (`payload_complete`).

## Wire map

| # | Path | Entity | Completeness |
|---|---|---|---|
| W1 | `GET /api/shifts` | visits | complete |
| W2 | `GET /api/shifts/:id/members` | shifts (+ punches) | complete |
| W3 | `GET /api/shifts/:id/sets` | set_items | complete |
| W4 | `fetchVisitsForStoreDate` | visits | **partial** (program/times; may lack lead/hours) |
| W5 | `fetchMembersForVisit` | shifts | complete |
| W6 | `fetchPunchMapForVisit` | — | covered when W2 merges punches; no stub people |
| W7 | `getCategoryResets` | set_items | **partial** (counts/photo-required) |
| W8 | `fetchVisitDetail` | visits | **partial** raw enrichment |
| W9 | day-confirm field-data | visits | complete |
| W10 | employees + lead-info | roster_people | complete |
| 999 | `buildTimesheetRoster` fixture | visit+shifts+demo sets | complete (`source=manual`) |

## Scripts

```bat
npm run snapshot:coverage -- --districts=6,8
npm run snapshot:seed -- --districts=8 --date=YYYY-MM-DD --delay-ms=1500
```

Coverage answer: `storesWithNoSnapshots` / `autonomyReadyPct` — “if SAS ended today, which stores could I still run?”

## Verification

```bat
set DATABASE_URL=%DATABASE_PUBLIC_URL%
set PGSSL=no-verify
node --test test/eod-snapshot-roundtrip.test.js
```

Asserts: dedupe, partial-after-complete skip, fire-and-forget failure isolation, 999 → CSV → reimport round-trip.

## Out of scope (still)

Read-path switching, CSV import UI, §1.8 manual create, mode flag, prune job.
