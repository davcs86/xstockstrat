# Feature: trading-crash-consistency

**Development Branch**: `feature/trading-crash-consistency`
**Created**: 2026-08-04
**Last Updated**: 2026-08-04
**Archived**: 2026-08-06

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-08-04 | `idea` → `draft` | /sdd-story | Product spec generated from external live-capital-safety risk review |
| 2026-08-04 | `draft` → `demoted/canceled` | feasibility re-check | See context.md — CI has no ephemeral-Postgres/service-container setup today; this is new CI infrastructure, not just new tests, for a risk (crash mid-automated-order) that isn't live yet |
| 2026-08-06 | `demoted/canceled` | /sdd-archiver | Archived: synthesis → context.md + Ledger insights(0)/fails(1); pruned 1 specs |

---

## Artifacts

- Product Spec — pruned by /sdd-archiver 2026-08-06; see [Context Log](context.md) Archive Synthesis
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Adds a CI-run crash-consistency test suite that injects a service restart at every externally-consequential step of the order and protection lifecycle (before/after intent persistence, broker submission, fill reception, ledger append, portfolio update, stop submission, cancel-and-replace, emergency flatten) and verifies `xstockstrat-trading`/`xstockstrat-portfolio`/`xstockstrat-ledger` converge to a correct state with no duplicate orders and no missing accounting events, run against an ephemeral PostgreSQL and the feature-103 broker simulator.

## Reviewers

_(Auto-populated from docs/runbooks/reviewer-registry.md based on affected services and
change types. Override as needed for this feature. Snapshot finalized at /sdd-spec time —
re-run /sdd-spec if the registry changes.)_

| Role | Review Focus |
|---|---|
| `xstockstrat-trading` owner | Order execution correctness, fill detection |
| `xstockstrat-portfolio` owner | Position snapshot consistency, concurrent write safety |
| `xstockstrat-ledger` owner | Append-only invariant, event ordering |
| DBA | Ephemeral test-database provisioning, migration replay correctness in CI |

## Next Action

`/sdd-review trading-crash-consistency product-spec` — AI review of product spec before running /sdd-spec
