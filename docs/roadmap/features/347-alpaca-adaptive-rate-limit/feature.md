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
| 2026-11-16 | `spec-ready` → `design-approved` | /sdd-design | Design debated (5 rounds, full; round cap waived by the operator) and approved; recon.md + debate.md + design.md written; product spec and scenarios amended (FR-11, AC-23..AC-37) |
| 2026-11-16 | `design-approved` → `implementation-ready` | /sdd-spec | Implementation spec generated with 12 steps |
| 2026-11-16 | `implementation-ready` (unchanged) | /sdd-execute | Re-spec before execution: Steps 5, 6, 11 anchors aligned with `main-dev@b34dc48` (line numbers and one count; no instruction changed) |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Acceptance Scenarios](acceptance.feature) — Gherkin `@AC-*` scenarios (single source of acceptance truth, C-15)
- [Recon](recon.md) — grounded codebase dossier
- [Debate Register](debate.md) — settled decisions, rejected alternatives, objections
- [Design](design.md) — approved architecture
- [Implementation Spec](implementation-spec.md) — 12 numbered steps in six atomic units
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Make outbound Alpaca REST calls adapt to the vendor's own rate-limit signals (`X-RateLimit-*` response
headers and HTTP 429) instead of relying only on a static requests-per-second guess. Applies to the Alpaca
clients in `xstockstrat-marketdata` and `xstockstrat-trading`; no other vendor is touched.

## Reviewers

_(Snapshot finalized by /sdd-spec on 2026-11-16 from docs/runbooks/reviewer-registry.md and the
per-step `**Reviewers**` lines. Re-run /sdd-spec if the registry changes.)_

| Role | Review Focus | Steps |
|---|---|---|
| `xstockstrat-marketdata` owner | OHLCV ingestion integrity, TimescaleDB hypertable partitioning, Alpaca feed idempotency | 1-6 |
| `xstockstrat-trading` owner | Order execution correctness, broker API safety, fill detection, paper-only dev invariant, position limit enforcement | 1, 2, 7-10 |
| `xstockstrat-config` owner | Config key naming (`<service>.<category>.<key>`), environment (`production`/`staging`) / global-per-user scoping, secret encryption + redaction, WatchConfig stream stability | 11, 12 |
| DBA | Migration NNN numbering (no gaps, no conflicts), up+down pair present, run-order compliance with `scripts/db-migrate.sh` | 11 |

## Next Action

`/sdd-review alpaca-adaptive-rate-limit impl-spec` — validate implementation spec, then `/sdd-execute alpaca-adaptive-rate-limit`
