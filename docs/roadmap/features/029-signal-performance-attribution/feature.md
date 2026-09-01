# Feature: signal-performance-attribution

**Development Branch**: `feature/signal-performance-attribution`
**Created**: 2026-05-26
**Last Updated**: 2026-09-01

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-05-26 | `idea` → `draft` | /sdd-story | Product spec generated |
| 2026-08-31 | `draft` (regenerated) | /sdd-story (overwrite) | product-spec.md regenerated to current template; acceptance.feature authored |
| 2026-08-31 | `draft` → `spec-ready` | /sdd-review | Product spec approved; all review blockers addressed |
| 2026-08-31 | `spec-ready` → `design-approved` | /sdd-design | Design debated (full) + reuse-042/fee-plumbing revision; approved; recon.md + design.md written |
| 2026-08-31 | `design-approved` → `implementation-ready` | /sdd-spec | Implementation spec generated (15 steps) |
| 2026-09-01 | `implementation-ready` → `in-progress` → `code-completed` | /sdd-execute | All 15 steps executed (7 commits); red-before-green on every code step; C-16 promotion deferred to /promote |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Acceptance Scenarios](acceptance.feature) — Gherkin `@AC-*` scenarios; single source of acceptance truth (C-15)
- [Implementation Spec](implementation-spec.md) — numbered steps with codebase evidence
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Joins ledger fill events to ingest signal records to produce per-source performance metrics (win rate, average return, total realized P&L) so that signal source weights can be tuned with real trading evidence rather than intuition.

## Reviewers

_(Auto-populated from docs/runbooks/reviewer-registry.md based on affected services and
change types. Override as needed for this feature. Snapshot finalized at /sdd-spec time —
re-run /sdd-spec if the registry changes.)_

| Role | Review Focus |
|---|---|
| `xstockstrat-analysis` owner | Backtest reproducibility, strategy scoring determinism, no look-ahead bias |
| `xstockstrat-ledger` owner | Append-only invariant (no deletes or updates), event ordering, hypertable partition safety |
| `xstockstrat-ingest` owner | Signal normalization correctness, idempotent ingestion, newsletter source schema stability |
| `xstockstrat-insights` owner | Analytics display accuracy, SSE polling resilience, read-only access pattern |

## Next Action

`/sdd-review signal-performance-attribution impl-spec` then `/sdd-execute signal-performance-attribution`
