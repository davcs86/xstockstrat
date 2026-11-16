# Feature: alpaca-adaptive-rate-limit

**Development Branch**: `feature/alpaca-adaptive-rate-limit`
**Created**: 2026-11-16
**Last Updated**: 2026-11-16

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-11-16 | `idea` → `draft` | /sdd-story | Product spec generated |
| 2026-11-16 | `draft` → `spec-ready` | /sdd-review | Product spec approved (4 warnings) |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Acceptance Scenarios](acceptance.feature) — Gherkin `@AC-*` scenarios (single source of acceptance truth, C-15)
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec alpaca-adaptive-rate-limit`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Make outbound Alpaca REST calls adapt to the vendor's own rate-limit signals (`X-RateLimit-*` response
headers and HTTP 429) instead of relying only on a static requests-per-second guess. Applies to the Alpaca
clients in `xstockstrat-marketdata` and `xstockstrat-trading`; no other vendor is touched.

## Reviewers

_(Auto-populated from docs/runbooks/reviewer-registry.md based on affected services and
change types. Override as needed for this feature. Snapshot finalized at /sdd-spec time —
re-run /sdd-spec if the registry changes.)_

| Role | Review Focus |
|---|---|
| `xstockstrat-marketdata` owner | OHLCV ingestion integrity, TimescaleDB hypertable partitioning, Alpaca feed idempotency |
| `xstockstrat-trading` owner | Order execution correctness, broker API safety, fill detection, paper-only dev invariant, position limit enforcement |
| `xstockstrat-config` owner | Config key naming (`<service>.<category>.<key>`), environment / global-per-user scoping, WatchConfig stream stability |

## Next Action

`/sdd-design alpaca-adaptive-rate-limit` — full design recommended (two services plus a config migration, order-mutation path, file overlap with 322/323)
