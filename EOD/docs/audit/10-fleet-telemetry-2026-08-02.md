# Fleet telemetry pull — 2026-08-02 (PT)

Pulled from production `client_versions` via `scripts/pull-client-versions-telemetry.js` (public DB URL).

**Pulled at:** `2026-08-03T00:52:31.889Z`

## Headlines

| Metric | Value |
|--------|--------|
| Distinct clients | 2 |
| Seen 24h / 7d | 2 / 2 |
| With quota + usage + display_mode | 2 / 2 / 2 |
| On **2.12.7+** | **1** (tyson) |
| Still on 2.12.5 | 1 (d6ewa.supervisor) |
| Display mode | both `browser` (0 standalone) |
| `navigator.storage.persisted` | both `false` |
| At/above soft 30% origin usage | 0 |
| At/above hard 50% origin usage | 0 |

## Storage (30d sample with quota)

| | p50 | p90 | min | max |
|--|-----|-----|-----|-----|
| Origin quota | ~43.8 GB | ~70.6 GB | ~10.2 GB | ~77.3 GB |
| Origin usage | ~2.9 MB | ~5.2 MB | — | — |
| Photo bytes (app-reported) | ~0 | ~0 | — | — |
| Usage / quota | ~0% | ~0.1% | — | — |

Quotas are huge relative to photo load today — **percent-of-quota caps (30%/50%) are not the binding constraint** on these two devices; ITP / tab eviction and `persisted=false` matter more than hard-cap pressure.

## Version distribution

| Version | Clients |
|---------|---------|
| 2.12.7 | 1 |
| 2.12.5 | 1 |

## Unblocks

- **Store-pool day-confirm require flip:** do **not** flip yet — only 50% of known fleet is on 2.12.7; wait until supervisor client updates (or ≥~n-1 on 2.11.5+ pool-mutation build, whichever matrix you use).
- **Real cap sizing:** current soft/hard % look safe vs observed usage; no emergency tighten. Prefer Home Screen / standalone adoption over shrinking % caps (both clients still `browser`, not persisted).

## Note

Sample size is two authenticated emails. Re-pull after Monday field use before treating this as fleet-wide.
