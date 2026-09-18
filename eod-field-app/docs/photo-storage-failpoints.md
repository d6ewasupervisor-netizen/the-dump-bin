# On-device photo storage — failpoint matrix

Rule that governs all of this: **a captured photo's local bytes (`dataUrl`/`blob`/`file`/`bitmap`/`canvas`/PhotoDB blob) are only ever dropped by `isFullyConfirmed(job)` in `js/lib/photo-pipeline-logic.js`.** No other code path is allowed to null them out. That function requires PROD confirmed AND (SI confirmed, unless slot is `before` or the side was explicitly skipped) for `kind:'set'` jobs, or `status==='done'` for cart/before/after jobs which upload synchronously and throw on any failure.

| Failpoint | Behavior | Status |
|---|---|---|
| App crash / tab kill mid-capture | Job sits in IndexedDB (`eodFieldPhotoOutbox`) at whatever status it reached; bytes untouched. Resumes on next load via `photo-pipeline.js` init. | Safe (pre-existing) |
| Airplane mode / offline during upload | Upload throws, job → `failed` with bytes intact; `shouldRetry` picks it back up when a network event fires. | Safe (pre-existing) |
| 401 / session expired mid-upload | Same as above — throws, fails with bytes retained, retried after re-auth. | Safe (pre-existing) |
| 5xx from PROD or SI | Same — failed with bytes retained. Independent PROD/SI status means one side succeeding doesn't fool the other into "confirmed". | Safe (pre-existing) |
| PROD ok, SI fails (or vice versa) | `isFullyConfirmed` requires both (where applicable) — bytes are kept until the failing side also confirms. | Safe (fixed this pass — previously `offloadBufferedBay` wiped bytes on the DB buffer ack alone, before PROD/SI had the photo at all) |
| DB buffer ack received, before PROD/SI confirm | Job status → `accepted`, bytes retained. Deletion still gated on `isFullyConfirmed`. | **Fixed this pass** |
| 36h idle purge / `purgeSettledJobs()` | Both now re-check `isFullyConfirmed` before calling `idbDelete`/`removeJob`, not just terminal status. | **Fixed this pass** |
| Service worker update / reload during compression | Job resumes from `queued`/`compressing`; original `file`/`bitmap`/`canvas` still attached since nothing is nulled until compress actually succeeds. | Safe (fixed this pass, see below) |
| Storage quota exceeded | `idbPut`/`persist` failures are caught (best-effort) elsewhere in the file; a failed persist leaves the job in memory for the session, not silently dropped. Not hardened further this pass — flagging as a gap (see below). | Gap — noted, not addressed |
| **Bitmap-only capture, compress worker unavailable/fails, and canvas fallback also produces nothing** | Previously: `inputToBlob()` didn't handle `job.bitmap` at all → compress silently produced no blob/dataUrl → code unconditionally closed the bitmap and nulled `file`/`bitmap`/`canvas` anyway. **Total, unrecoverable photo loss**, no retry possible. | **Fixed this pass** — `inputToBlob` now draws bitmap-only input into a canvas; `runCompress` now throws (job → `failed`, bytes preserved) instead of nulling source fields when no output was produced. `photo-compress.js`'s own fallback path had the identical bug (called `blobToDataUrl` on a non-Blob bitmap after already closing it) — fixed the same way. |
| PhotoDB blob store auto-purge (purgeSubmitted / pruneSent / enforceHardCap) | Previously deleted sessions on emailOk/sentAt age alone, wiping PhotoDB blobs without consulting isFullyConfirmed. Now skips any session while EodPhotoPipeline.sessionHasProtectedJobs(store, date) is true (unconfirmed or still holding bytes); if pipeline is unloaded, refuses auto-delete while photos remain. Explicit user Discard-all still uses purgeUnsentLeftovers({ force: true }). | **Fixed this pass (B)** |
| PhotoDB blob store corruption/eviction | Not audited this pass. | Gap — noted, not addressed |

## What changed this pass
- `js/lib/photo-pipeline-logic.js` / `js/lib/photo-pipeline.js`: single `isFullyConfirmed()` gate (PROD+SI dual confirm) is now the only path that can drop local bytes; `offloadBufferedBay` no longer wipes on DB-ack alone; 36h purge and `purgeSettledJobs()` re-check confirmation; `protectedOnDevice` count added.
- `js/lib/photo-pipeline.js` `inputToBlob`/`runCompress`: bitmap-only captures now convert correctly instead of being silently destroyed; a failed compression now fails the job (bytes kept) instead of nulling source fields unconditionally.
- `js/lib/photo-compress.js`: the no-worker fallback compressor had the same class of bug (assumed input was always a string or Blob when building its own last-resort fallback) — now handles bitmap/canvas input by drawing to a plain canvas at native size before ever closing the bitmap.

## Known gaps (not addressed this pass)
- IndexedDB quota-exceeded handling is best-effort/silent in a few spots — worth an explicit user-facing warning if writes start failing.
- PhotoDB auto-purge now consults pipeline confirmation (B). Corruption/eviction of the blob store itself still not audited.
- No UI badge yet for `protectedOnDevice` (data field only) — would let a lead see at a glance "N photos still only on this device."
