# CAF app versioning

Current version: **1.1**

## Badge

Both `index.html` and `sign.html` show a green lit **`v1.1`** badge (top-right) via `caf-version.js`.

## Sources of truth (keep identical)

| Location | Field |
|----------|--------|
| `caf/caf-version.json` | `"version"` |
| `<meta name="caf-app-version">` in both HTML files | `content` |
| `eod-api/src/lib/caf-version.js` | `CAF_APP_VERSION` |

API: `GET /api/caf/version` returns the backend value; the badge prefers it when reachable.

## Bump policy (mandatory)

**Every change** that adds, removes, or alters a user-facing CAF feature or function requires a version bump (minor step: `1.1` → `1.2`).

Includes: dashboard UI, sign page, CAF API routes/libs, delivery/PDF/priors/fax behavior.

After every bump:

1. Update all three sources above to the same version.
2. **Commit and push** both `the-dump-bin` and `eod-api` in the same session.

Typo/comment-only edits do not require a bump.
