# Feature: symbol-data-stage

**Development Branch**: `feature/symbol-data-stage`
**Created**: 2026-11-28
**Last Updated**: 2026-11-28

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-11-28 | `idea` → `draft` | /sdd-story | Product spec generated. Feature 2 of 9 in `docs/roadmap/program-job-graph-analysis-pipeline.md` |
| 2026-11-28 | `draft` → `spec-ready` | /sdd-review | Product spec approved (round 1 failed on criteria 6 and 8/9; round 2 passed with advisory warnings, fixed in the spec). Overlap clean |
| 2026-11-28 | `spec-ready` → `design-approved` | /sdd-design | Design debated (5 rounds, full; round cap lifted by the operator) and approved; recon.md + debate.md + design.md written. Product spec and scenarios amended during the debate with operator sign-off (FR-13, FR-14 and `@AC-24` to `@AC-66` added) |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Acceptance Scenarios](acceptance.feature) — Gherkin `@AC-*` scenarios (single source of acceptance truth, C-15)
- [Recon](recon.md) — grounded codebase dossier
- [Debate Register](debate.md) — 67 decisions, 28 rejected alternatives, 42 objections
- [Design](design.md) — approved architecture
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec symbol-data-stage`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

A daily stage on the analysis job graph that snapshots the symbol universe after the close and
runs one data job per symbol: a post-close fetch of the session's daily bar and of unconfirmed
history from marketdata, filings refreshed on a schedule, retry passes after an outage, an
automated vendor-finality check, and a durable coverage verdict and bar record per symbol that
program feature 3 evaluates from. EDGAR becomes the default fundamentals source.

## Reviewers

_(Auto-populated from docs/runbooks/reviewer-registry.md based on affected services and
change types. Override as needed for this feature. Snapshot finalized at /sdd-spec time —
re-run /sdd-spec if the registry changes.)_

| Role | Review Focus |
|---|---|
| `xstockstrat-analysis` service owner | Backtest reproducibility, strategy scoring determinism, no look-ahead bias |
| `xstockstrat-marketdata` service owner | OHLCV ingestion integrity, TimescaleDB hypertable partitioning, Alpaca feed idempotency |
| `xstockstrat-config` service owner | Config key naming (`<service>.<category>.<key>`), environment (`production`/`staging`) / global-per-user scoping, secret encryption + redaction, WatchConfig stream stability |
| DBA | Migration NNN numbering (no gaps, no conflicts), up+down pair present, hypertable partitioning strategy, index correctness, run-order compliance with `scripts/db-migrate.sh` |
| Proto Reviewer | Field number uniqueness per message, no breaking changes without deprecation comment, `buf lint` passes, `buf breaking` passes against dev trunk |

## Next Action

`/sdd-spec symbol-data-stage` — generate implementation spec from the approved design