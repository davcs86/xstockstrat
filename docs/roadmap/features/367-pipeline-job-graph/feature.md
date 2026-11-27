# Feature: pipeline-job-graph

**Development Branch**: `feature/pipeline-job-graph`
**Created**: 2026-11-27
**Last Updated**: 2026-11-27

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-11-27 | `idea` → `draft` | /sdd-story | Product spec generated. Feature 1 of 9 in `docs/roadmap/program-job-graph-analysis-pipeline.md` |
| 2026-11-27 | `draft` → `spec-ready` | /sdd-review | Product spec approved (2 warnings, both fixed in the spec). Round 1 failed on criteria 6 and 9; round 2 passed. Overlap clean |
| 2026-11-27 | `spec-ready` → `design-approved` | /sdd-design | Design debated (12 rounds, full; round cap lifted by the operator) and approved; recon.md + debate.md + design.md written. Product spec and scenarios amended during the debate with operator sign-off (`@AC-17`, `@AC-18` added) |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Acceptance Scenarios](acceptance.feature) — Gherkin `@AC-*` scenarios (single source of acceptance truth, C-15)
- [Recon](recon.md) — grounded codebase dossier
- [Debate Register](debate.md) — 60 decisions, 18 rejected alternatives, 85 objections
- [Design](design.md) — approved architecture
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec pipeline-job-graph`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

A durable Postgres-backed job graph and worker runtime inside `xstockstrat-analysis`: idempotent
keyed jobs, fenced leases, classified retries, park-and-wake dependencies and a dead-letter state.
It migrates no pipeline; later program features move the analysis loops onto it.

## Reviewers

_(Auto-populated from docs/runbooks/reviewer-registry.md based on affected services and
change types. Override as needed for this feature. Snapshot finalized at /sdd-spec time —
re-run /sdd-spec if the registry changes.)_

| Role | Review Focus |
|---|---|
| `xstockstrat-analysis` service owner | Backtest reproducibility, strategy scoring determinism, no look-ahead bias |
| DBA | Migration NNN numbering (no gaps, no conflicts), up+down pair present, hypertable partitioning strategy, index correctness, run-order compliance with `scripts/db-migrate.sh` |
| `xstockstrat-config` service owner | Config key naming (`<service>.<category>.<key>`), environment / global-per-user scoping, WatchConfig stream stability |

## Next Action

`/sdd-spec pipeline-job-graph` — generate implementation spec from the approved design
