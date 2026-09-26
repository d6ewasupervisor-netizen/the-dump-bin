---
name: eod-field-app-version-bump
description: >-
  Bump the eod-field-app pilot version across the lockstep files with
  scripts/bump-version.mjs. Use on every code change to eod-field-app or
  the-dump-bin/eod-field-app, before every robocopy/publish, when the user
  asks to ship or bump the field app, or when eod-version.json needs to
  increment. Never invent a version — always read eod-version.json first.
  Patch is two digits (00–99); .99 rolls the middle digit; x.9.99 rolls the major.
---

# eod-field-app version bump

## Read current version first

```powershell
cd C:\Users\tgaut\eod-field-app; Get-Content eod-version.json
```

Pilot is on `3.x`. The third component is always two digits (`00`–`99`).

Roll with `nextVersion` in `scripts/bump-version.mjs`. Do not add 1 by hand.

- `3.4.19` → `3.4.20`
- `3.4.99` → `3.5.00` (middle digit is `0`–`9`)
- `3.9.99` → `4.0.00`

A third component of `100` or higher (`3.4.101`) is a bad bump. Never write it.

## The lockstep files

All must change in the same commit:

| File | What changes |
|------|-------------|
| `eod-version.json` | `{ "version": "3.x.yy" }` |
| `js/api.js` | `APP_VERSION = '3.x.yy'` |
| `index.html` | every `?v=3.x.yy` query param and the version badge |
| `js/lib/eod-buffering.js` | GIF asset URL version suffix |
| `js/lib/barcode-scanner.js` | comment header version |
| `sw.js` | `CACHE` name (`eod-field-3.x.yy`) and all `?v=` precache entries |
| `js/boot.js` | `sw.js?v=3.x.yy` service worker register URL |

## Use bump-version.mjs (always)

Do not hand-increment in PowerShell or with `StrReplace`. From the field-app root:

```powershell
cd C:\Users\tgaut\eod-field-app; node scripts/bump-version.mjs
```

That reads `eod-version.json` and writes the next rolled version into every lockstep file. To set a specific version: `node scripts/bump-version.mjs 3.4.20`.

Run the same command in `the-dump-bin\eod-field-app` when that tree is the copy being published and you are not robocopying the whole app.

## Verify

```powershell
Get-Content C:\Users\tgaut\eod-field-app\eod-version.json
```

Badge text is `v` plus that version. No lockstep file may still contain the previous version.

## Bump happens before robocopy

Version bump → robocopy → commit both repos (eod-field-app local + dump-bin GitHub). See `eod-field-app-publish` for the full publish sequence.

## Never invent a version

The canonical version lives in `eod-version.json`. If you're unsure, read it. Do not guess. Hosted lag: GitHub raw is source of truth, not the-dump-bin.com/eod-field-app/eod-version.json (CDN may lag).
