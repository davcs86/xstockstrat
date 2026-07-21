# Feature: backtest-results-visualization

**Lifecycle Status**: `design-approved`
**Development Branch**: `feature/backtest-results-visualization`
**Created**: 2026-07-21
**Last Updated**: 2026-07-21

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-07-21 | `idea` → `draft` | /sdd-story | Product spec generated |
| 2026-07-21 | `draft` → `spec-ready` | /sdd-review | Product spec approved (0 warnings) |
| 2026-07-21 | `spec-ready` → `design-approved` | /sdd-design | Design debated (1 round, quick) and approved; recon.md + design.md written |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Recon Dossier](recon.md) — grounded codebase facts (Phase 0)
- [Design](design.md) — debated, approved architecture (Phase 1)
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec backtest-results-visualization`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Make past backtest runs fully visualizable in the insights UI: persist each run's detailed
results so a strategy developer can open any row in Past Runs and see its equity curve,
summary metrics, trade markers, and per-bar diagnostics — today only the latest in-memory
run has that detail.

## Reviewers

_(Auto-populated from docs/runbooks/reviewer-registry.md based on affected services and
change types. Override as needed for this feature. Snapshot finalized at /sdd-spec time —
re-run /sdd-spec if the registry changes.)_

| Role | Review Focus |
|---|---|
| `xstockstrat-analysis` owner | Backtest reproducibility, strategy scoring determinism, no look-ahead bias |
| `xstockstrat-ui` owner | Trading UI correctness, analytics display accuracy, Connect-RPC call safety, no direct DB access |
| Proto Reviewer | Field number uniqueness, no breaking changes without deprecation, `buf lint`/`buf breaking` pass |
| DBA | Migration NNN numbering, up+down pair present, hypertable/partitioning strategy, index correctness |

## Next Action

`/sdd-spec backtest-results-visualization` — generate implementation spec from the approved design
