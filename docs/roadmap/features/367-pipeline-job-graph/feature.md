# Feature: pipeline-job-graph

**Development Branch**: `feature/pipeline-job-graph`
**Created**: 2026-11-27
**Last Updated**: 2026-11-28

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-11-27 | `idea` → `draft` | /sdd-story | Product spec generated. Feature 1 of 9 in `docs/roadmap/program-job-graph-analysis-pipeline.md` |
| 2026-11-27 | `draft` → `spec-ready` | /sdd-review | Product spec approved (2 warnings, both fixed in the spec). Round 1 failed on criteria 6 and 9; round 2 passed. Overlap clean |
| 2026-11-27 | `spec-ready` → `design-approved` | /sdd-design | Design debated (12 rounds, full; round cap lifted by the operator) and approved; recon.md + debate.md + design.md written. Product spec and scenarios amended during the debate with operator sign-off (`@AC-17`, `@AC-18` added) |
| 2026-11-27 | `design-approved` → `implementation-ready` | /sdd-spec | Implementation spec generated with 19 steps |
| 2026-11-27 | `implementation-ready` → `in-progress` | /sdd-execute | Sequential mode; Steps 1+2+3 (config unit) committed |
| 2026-11-28 | `in-progress` → `code-completed` | /sdd-execute | All 19 steps committed on `feature/pipeline-job-graph` (15 step commits) |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Acceptance Scenarios](acceptance.feature) — Gherkin `@AC-*` scenarios (single source of acceptance truth, C-15)
- [Recon](recon.md) — grounded codebase dossier
- [Debate Register](debate.md) — 60 decisions, 18 rejected alternatives, 85 objections
- [Design](design.md) — approved architecture
- [Implementation Spec](implementation-spec.md) — 19 numbered steps
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

A durable Postgres-backed job graph and worker runtime inside `xstockstrat-analysis`: idempotent
keyed jobs, fenced leases, classified retries, park-and-wake dependencies and a dead-letter state.
It migrates no pipeline; later program features move the analysis loops onto it.

## Reviewers

_(Snapshot of docs/runbooks/reviewer-registry.md, finalized by /sdd-spec on 2026-11-27 from the
`**Reviewers**` lines of all 19 steps. Re-run /sdd-spec if the registry changes.)_

| Role | Review Focus |
|---|---|
| `xstockstrat-analysis` service owner | Backtest reproducibility, strategy scoring determinism, no look-ahead bias |
| DBA | Migration NNN numbering (no gaps, no conflicts), up+down pair present, hypertable partitioning strategy, index correctness, run-order compliance with `scripts/db-migrate.sh` |
| `xstockstrat-config` service owner | Config key naming (`<service>.<category>.<key>`), environment (`production`/`staging`) / global-per-user scoping, secret encryption + redaction, WatchConfig stream stability |

## Next Action

`/sdd-review pipeline-job-graph impl-spec` — validate implementation spec, then `/sdd-execute pipeline-job-graph`
