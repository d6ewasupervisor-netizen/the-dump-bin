# EOD feature freeze (Batch 1)

**Status:** Active as of 2026-08-02 (UTC) / 2026-08-01 (PT)

Until Tiers 0 and 1 of `07-change-plan.md` are complete (or the period checkpoint forces a reassessment), do **not** add EOD product features. Allowed work only:

- Production-safety fixes listed in the change plan
- Tests, observability, and audit-doc corrections
- Version file bumps tied to those safety ships

## Baseline (Batch 1)

| Item | Value |
|------|--------|
| EOD frontend (`EOD/eod-version.json`) | `2.11.1` |
| eod-api `package.json` version | `1.0.0` |
| Railway project | EOD (`5bc0629e-2ebb-49f2-9e13-8b878a16bf93`) |
| Railway service | `eod-api` |
| Railway environment | `production` |
| `AUTH_MODE` (verified 2026-08-01 and again Batch 1) | `session` |
| Batch 1 deploy | Railway `b28c3faf-ff07-4b94-963c-1b0b06f8b4cf` (SUCCESS; boot log `Auth mode: session`) |
| Batch 2a deploy | Railway `7b9610f8-6412-4559-aec8-ef01a2f0cbf4` (atomic claim + identity bind + shift-status auth; role gates held) |
| Batch 3 deploy | Railway `23902bb7-6acf-425c-9cbf-84d1355874b6` (T0.5 shadow + T0.6 signed images enforce; `EOD_CONTEXT_VALIDATE_MODE=shadow`) |
| EOD frontend | `2.11.2` (removal poll swallows 401 / noBounceOn401) |
| Field guidance | `08-field-guidance.md` (preview check only) |

## Batch 1 observability shipped

- Rate limit on `GET /api/signoff-photos/:photoId/image`
- Structured `[eod-audit]` logs: `legacy_no_day_confirm`, `sas_job_transition`, `signoff_image_access`, `role_denial`, `orphan_endpoint_caller`

Say **y** in chat when ready to review telemetry and start Batch 2.
