# EOD feature freeze (Batch 1) — LIFTED

**Status:** Lifted 2026-08-02 (PT) after Tier 0 closed (Batch 7 / FE 2.12.7).

The freeze did its job: safety ships landed without product-scope creep. Holding it further only forces work to route around the rule. Batches 8–12 remain valuable cleanup; they are no longer gated by a freeze.

**Next priority (not freeze-gated):** snapshot write-through (S1 in `09-autonomy-schema.md`) before Batches 8–12 — history is not backfillable.

## Baseline (Batch 1 archive)

| Item | Value |
|------|--------|
| EOD frontend at freeze open | `2.11.1` → closed Tier 0 at `2.12.7` |
| eod-api `package.json` version | `1.0.0` |
| Railway project | EOD (`5bc0629e-2ebb-49f2-9e13-8b878a16bf93`) |
| Railway service | `eod-api` |
| Railway environment | `production` |
| `AUTH_MODE` | `session` |
| Batch 1 deploy | Railway `b28c3faf-ff07-4b94-963c-1b0b06f8b4cf` |
| Batch 2a deploy | Railway `7b9610f8-6412-4559-aec8-ef01a2f0cbf4` |
| Batch 3 deploy | Railway `23902bb7-6acf-425c-9cbf-84d1355874b6` |
| Field guidance | `08-field-guidance.md` (preview check only) |

## What the freeze covered

- Rate limit on `GET /api/signoff-photos/:photoId/image`
- Structured `[eod-audit]` logs
- Tier 0 batches through Batch 7 (truthful SAS completion + `sentAt`)
