# Feature: phase-2-data-layer

**Lifecycle Status**: `spec-ready`
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

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec phase-2-data-layer`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

`GetPnL` in `xstockstrat-portfolio` always returns `realized_pnl = 0` because the service never queries the ledger for closed-position fills. This causes the insights dashboard and trader UI to silently report incorrect total P&L for any account with closed positions.

## Reviewers

_(Auto-populated from docs/runbooks/reviewer-registry.md based on affected services and
change types. Override as needed for this feature. Snapshot finalized at /sdd-spec time —
re-run /sdd-spec if the registry changes.)_

| Role | Review Focus |
|---|---|
| Service owner (`xstockstrat-portfolio`) | P&L calculation accuracy, position snapshot consistency, concurrent write safety |
| Service owner (`xstockstrat-ledger`) | Append-only invariant (no deletes or updates), event ordering, hypertable partition safety |

## Next Action

`/sdd-spec phase-2-data-layer` — generate implementation spec from the approved product spec
