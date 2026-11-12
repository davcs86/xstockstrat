# Feature: seed-curated-templates

**Development Branch**: `feature/seed-curated-templates`
**Created**: 2026-11-12
**Last Updated**: 2026-11-12

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-11-12 | `idea` → `draft` | /sdd-story | Product spec generated |
| 2026-11-12 | `draft` → `spec-ready` | /sdd-review | Product spec approved (1 warning) |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Acceptance Scenarios](acceptance.feature) — Gherkin `@AC-*` scenarios (single source of acceptance truth, C-15)
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec seed-curated-templates`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Seed the template catalog (feature 224) with 9 curated formulas, 14 non-junk strategies and 4 signal
sources taken from the operator's private staging instances, via one numbered seed migration per owning
service (indicators, analysis, ingest); also seed the system `fundamentals` source and verify
template-vs-staging parity afterwards.

## Reviewers

_(Auto-populated from docs/runbooks/reviewer-registry.md based on affected services and
change types. Override as needed for this feature. Snapshot finalized at /sdd-spec time —
re-run /sdd-spec if the registry changes.)_

| Role | Review Focus |
|---|---|
| DBA | Migration NNN numbering (no gaps, no conflicts), up+down pair present, run-order compliance with `scripts/db-migrate.sh` |
| `xstockstrat-indicators` owner | Formula sandboxing, numeric precision, no side-effects from formula execution |
| `xstockstrat-analysis` owner | Backtest reproducibility, strategy scoring determinism, no look-ahead bias |
| `xstockstrat-ingest` owner | Signal normalization correctness, idempotent ingestion, newsletter source schema stability |

## Next Action

`/sdd-design seed-curated-templates` — full design recommended (DB migrations in 3 services; reverses durable rule `@AC-15 @feature-224`)
