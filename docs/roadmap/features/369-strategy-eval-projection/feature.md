# Feature: strategy-eval-projection

**Development Branch**: `feature/strategy-eval-projection`
**Created**: 2026-11-28
**Last Updated**: 2026-11-28

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-11-28 | `idea` → `draft` | /sdd-story | Product spec generated. Feature 3 of 9 in `docs/roadmap/program-job-graph-analysis-pipeline.md` |
| 2026-11-28 | `draft` → `spec-ready` | /sdd-review | Product spec approved (round 1 failed on criteria 6 and 8/9; round 2 passed with advisory warnings, fixed in the spec). Overlap clean |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Acceptance Scenarios](acceptance.feature) — Gherkin `@AC-*` scenarios (single source of acceptance truth, C-15)
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec strategy-eval-projection`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Evaluation jobs on the analysis job graph, one per user, symbol and closed daily bar, that write an
isolated result row per strategy and send state transitions through an outbox with a dry-run
dispatcher. A projection read path for opportunities and readiness is built behind a switch that
stays on legacy. The whole path runs in shadow beside the live loop and logs a parity report.

## Reviewers

_(Auto-populated from docs/runbooks/reviewer-registry.md based on affected services and
change types. Override as needed for this feature. Snapshot finalized at /sdd-spec time —
re-run /sdd-spec if the registry changes.)_

| Role | Review Focus |
|---|---|
| `xstockstrat-analysis` service owner | Backtest reproducibility, strategy scoring determinism, no look-ahead bias |
| `xstockstrat-config` service owner | Config key naming (`<service>.<category>.<key>`), environment (`production`/`staging`) / global-per-user scoping, secret encryption + redaction, WatchConfig stream stability |
| DBA | Migration NNN numbering (no gaps, no conflicts), up+down pair present, hypertable partitioning strategy, index correctness, run-order compliance with `scripts/db-migrate.sh` |

## Next Action

`/sdd-design strategy-eval-projection` — full design recommended (DB migration, new effect path and read path, depends on 368)
