---
name: kompass-signoff-manifest-names-and-errors
description: >-
  Overlays weekly Kroger Strip Manifest Pog Text (specific set names) onto Kompass
  paper, PDF, and digital signoff sheets instead of generic tracker category names,
  and surfaces VIRTUAL POG / Error Message in red on the set row plus the line
  below it. Use when building or changing signoffs, On Manifest pages, digital
  signoff cards, CatName vs Pog Text, Strip Manifest matching, red error rows, or
  when a set looks like 404-CAKES instead of HP 72IN SOAP / Chuckanut.
---

# Kompass Signoff — Manifest Set Names and Errors

Authoritative process for **what name prints on a signoff set** and **how Strip
Manifest errors (VIRTUAL POG) appear**. Read this before changing CatName, On
Manifest pages, digital cards, or signoff PDF row styling.

The weekly **Kroger Strip Manifest** is the set-name source of truth. The SUPER
Tracker generic category (`404-CAKES`, `171-ORAL HYGIENE PRODUCTS`) is **fallback
only**.

Build/email orchestration still lives in `kompass-full-scope-signoff-build` and
`kompass-one-off-signoff-email`. Routing/eligibility still live in
`flow-automation/.cursor/rules/signoff-rule-bible.mdc` (bible wins on conflict).

## When to use

- User says generic tracker names are on the sheet and they want **set names** /
  **Pog Text**.
- VIRTUAL POG, Error Message, red font on the set row, red line under the set,
  red digital cards.
- Matching a tracker/signoff row to a Strip Manifest row.
- One-off or custom builder that calls `build_signoff_workbook` **without** the
  CLI overlay (easy to skip — see Mandatory overlay).

## Hard rules

1. **Prefer Pog Text.** Match `(store, planogram_id)` on the weekly manifest.
   Overlay `cat_name` with Pog Text when it is non-empty.
2. **Fall back to tracker CatName** when the manifest file is missing, the week
   file does not match, the row is not on the manifest, or Pog Text is empty.
3. **Never invent names.** Do not guess set names from POG ID tokens.
4. **Error Message rides with the set.** If the manifest has an Error Message
   (VIRTUAL POG, processing failure), attach it as `manifest_error` /
   `errorMessage`. Show it **and** paint the set row red.
5. **Overlay after append.** Run `append_manifest_only_*` first (On Manifest
   vendor/virtual rows), then `apply_manifest_cat_names` so tracker **and**
   surfaced rows get names/errors. Overlay is idempotent.
6. **Rebuild to see it.** Existing xlsx/PDF/ingested digital sheets do not pick
   this up until a new build + digital ingest.

## Match key

`(normalized store, planogram_id)` — same key as PROD/SI completion.

- Store: `normalize_store` (strip leading zeros; `00019` → `19`). Whole-number
  only. `28` must not match `281`.
- Planogram id: numeric DBKEY via `extract_planogram_numeric_id`
  (`prod_completion.py`). Example POG ID
  `D701_L00000_D10_C404_V590_I025_MX_9098961` → `9098961`.
- Duplicate manifest keys: first non-empty Pog Text / POG ID string / error
  message wins.

## Manifest file

Config: `signoff_builder/signoff-builder/config.yaml` → `paths.manifest_dir`

Live (read-only Auston):

`C:/Users/tgaut/OneDrive - Advantage Solutions/Auston Nix's files - POGS/2026 Strip Manifests`

Dump Bin copy (same files, also read):

`…/A Useful Folder/POG/2026 Strip Manifests`

- Filename: `Kroger Manifest - Event Date MM-DD-YYYY - Fred_Meyer_701.xls` (BIFF8).
- Pick with `find_manifest_for_week`: **filename event date must equal that
  fiscal week's Sunday start** (`week_start_date`). No “newest mtime” fallback
  for the wrong date. If several files match the same Sunday, newest mtime wins.
- Sheet: `DivisionReport`. Skip `Store/Office == Office`. Keep store-floor rows
  even when Errors = Yes.
- Columns: `Pog Text`; `Error Message` (or `ErrorMessage`); `Errors` /
  `cHasErrors` (Yes/true) to decide whether the message is live.

Log line to expect: `Manifest loaded: …` then
`Manifest overlay: cat_name=N error_message=M (of R rows)`.

## Mandatory overlay (every entry point)

CLI, HTTP server, and `audit_regen` already do this. **Any new path that builds
rows must too** — `build_signoff_workbook` does **not** overlay by itself.

```python
from signoff_builder import manifest as manifest_mod

mset, mdata, mpath = manifest_mod.resolve_manifest(cfg, period, week)
manifest_mod.append_manifest_only_rows_single_store(
    store=store, rows=rows, manifest_set=mset, manifest_row_data=mdata,
    logger_=log, kompass=kompass, tracker_keys=tracker_keys,
    period=period, week=week,
)
manifest_mod.apply_manifest_cat_names(rows, mdata, logger_=log)
```

One-off / custom scripts that only call `builder.build_signoff_workbook` will
print tracker generics and hide VIRTUAL POG until this runs.

## How it must look

### Paper / xlsx (On Manifest and any sheet the row lands on)

- **Set detail row:** red font (`FF0000`) on every cell. Keep yellow priority
  fill if the row is a priority set. Applied **after** template row styles so
  black template font does not win.
- **Next row:** red error message, merged A:J, wrap, height 28.
- Pagination: an error set occupies **2 slots** (`row_slot_count`). Do not pack
  by raw row count or the error line will collide with the next set.
- Paper CatName is truncated at 44 chars (`_display_cat_name`). Digital uses the
  full Pog Text.

### Digital (field app + dump-bin EOD)

- Package fields: `errorMessage`, `hasError` (`digital_export._row_to_digital`).
- eod-api column: `digital_signoff_rows.error_message` (migration `086`).
- Field app: card class `manifest-error` (red background) + `.manifest-error-msg`.
- Dump-bin live Cover Sheet: `ds-row-manifest-error` on `EOD/eod-digital-signoff.js`.

### Printable digital PDF (eod-api pdfkit)

- Data-row text `#dc2626` when `errorMessage` is set (`dataRowFillColor`).
- Error line under the set stays red (`drawErrorRow`).

## Code map

| Area | Path |
|------|------|
| Overlay + parse | `flow-automation/signoff_builder/signoff-builder/signoff_builder/manifest.py` |
| Red set row + error line | `…/signoff_builder/builder.py` (`_paint_row_font_red`, `_write_manifest_error_row`) |
| Slot count | `…/signoff_builder/pagination.py` |
| Digital JSON | `…/signoff_builder/digital_export.py` |
| CLI / server / regen | `cli.py`, `server.py`, `audit_regen.py` — overlay **after** append |
| Ingest + API | `eod-api/src/lib/digital-signoffs.js` |
| Migration | `eod-api/src/migrations/086_digital_signoff_row_error_message.sql` |
| Contract | `eod-api/docs/digital-signoff-contract.json` |
| PDF print | `eod-api/src/lib/signoff-pdf-render.js`, `signoff-pdf-layout.js` |
| Field-app cards | `eod-field-app/js/features/signoff-home.js`, `css/app.css` (hosted via dump-bin) |
| Dump-bin EOD table | `the-dump-bin/EOD/eod-digital-signoff.js` |
| Tests | `signoff-builder/tests/test_manifest.py` (`test_fill_data_band_paints_error_set_row_red`) |

## Checks

After a build:

1. Log shows the week’s `Kroger Manifest - Event Date …Fred_Meyer_701.xls`, not
   “not configured”.
2. Spot a known virtual (e.g. store 19 / 28, dbkey `9098961`): CatName starts
   with Pog Text (`3 SHELF FROZEN DOOR RACK - CHUCKANUT…`), **not** `404-CAKES`.
3. That detail row is red font; the row under it is the Error Message in red.
4. Digital ingest: `GET /api/digital-signoffs/sheet?store=19&week=P##W#` has
   `errorMessage` / `hasError` on that row. Hosted field app card is fully red.

If names are still generic: overlay was skipped, wrong week file (event date ≠
Sunday start), or you are looking at a sheet from before the rebuild.

## Do not

- Do not write into Auston’s `…/POGS/2026 Strip Manifests` (read only).
- Do not treat footage (`F032`) as bay/photo count (unrelated; see pog-bay rule).
- Do not use SAS `store_number=` substring filters to resolve the store for a
  manifest match.

## Related skills

- `kompass-full-scope-signoff-build` — weekly / district build + ingest.
- `kompass-one-off-signoff-email` — single-store; **must still overlay**.
- `district-tracker-prod-si-reconcile` — tracker Complete; does not set CatName.
