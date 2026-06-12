---
name: eod-prod-photo-sync
description: Maintains the EOD app PROD photo sync flow for Kompass cart before/after photos and sign-off sheets. Use when editing EOD/index.html syncPhotos, PROD photo assignment, Use/Skip buttons, signoff photo sync, Kompass cart photos, or SAS/PROD photo import behavior.
---

# EOD PROD Photo Sync

## Scope

This skill applies to `EOD/index.html` in `the-dump-bin`. The EOD app pulls existing SAS PROD maintenance photos from `eod-api.the-dump-bin.com`, lets the lead assign each pulled image, and then imports selected images into the visible EOD photo sections.

## Required behavior

- Keep `before`, `after`, and `signoff` PROD imports consistent: pull images, assign them, render assigned previews, then let `Use` append the image to the matching section.
- `Use` must fetch/convert the remote image to a local data URL, run the normal storage compression helper, append it to `photos[type]`, call `renderPhotos(type)`, rebuild EOD selections, and `autoSave()`.
- `Skip` must remove only the imported copy for that PROD image. It must not remove unrelated local captures.
- Imported PROD copies should appear in the PDF as source `prod`, but should not be pushed back to SAS PROD or the signoff backend as new local captures.
- Dedicated sign-off photos from `/api/signoff-photos` still merge into `prodPhotos.signoff`; maintenance after-slot images can be assigned to `after` or `signoff`.
- Before-slot images from `/before-images` should use the same assignment/import pattern as after-slot images, with choices `Cart Before` and `Skip`.

## Implementation Notes

- Use `authFetch()` for hosted EOD API URLs and keep `SM_API_BASE` / `EOD_API_BASE` as the source of truth.
- Normalize relative image URLs with `resolveProdPhotoUrl()` before displaying, previewing, or importing them.
- Track assignment state separately by slot, for example `prodBeforeAssignments` and `prodAfterAssignments`.
- Track imported local copies in `prodPhotoLocalCopies` so duplicate appends are avoided and `getLocallyCapturedPhotos(type)` can exclude imported PROD images from upload pushes.
- Sign-off local review flags only apply to locally captured sign-off photos. Imported PROD sign-off copies can be marked reviewed when appended.

## Verification

Run an inline script syntax check for `EOD/index.html`, `git diff --check -- EOD/index.html`, and lints for the edited file before committing.
