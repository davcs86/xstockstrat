# Feature: phase-2-data-layer

**Lifecycle Status**: `implementation-ready`
**Development Branch**: `feature/phase-2-data-layer`
**Created**: 2026-05-19
**Last Updated**: 2026-05-20

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-05-19 | `idea` | backlog | Surfaced as sleeper risk — Phase 2 skipped while Phases 3–6 completed |
| 2026-05-20 | `idea` → `draft` | /sdd-story | Product spec generated; scope narrowed to realized_pnl fix only |
| 2026-05-20 | `draft` → `spec-ready` | /sdd-review | Product spec approved (2 warnings) |
| 2026-05-20 | `spec-ready` → `implementation-ready` | /sdd-spec | Implementation spec generated with 2 steps |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Implementation Spec](implementation-spec.md)
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

`GetPnL` in `xstockstrat-portfolio` always returns `realized_pnl = 0` because the service never queries the ledger for closed-position fills. This causes the insights dashboard and trader UI to silently report incorrect total P&L for any account with closed positions.

## Reviewers

_(Snapshot finalized by /sdd-spec 2026-05-20. Re-run /sdd-spec if the registry changes.)_

| Role | Review Focus |
|---|---|
| Service owner (`xstockstrat-portfolio`) | P&L calculation accuracy, position snapshot consistency, concurrent write safety |

## Next Action

`/sdd-review phase-2-data-layer impl-spec` — validate implementation spec, then `/sdd-execute phase-2-data-layer`
