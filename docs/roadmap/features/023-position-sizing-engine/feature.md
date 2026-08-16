# Feature: position-sizing-engine

**Committed to main**: 856ad5a3a2ebc431c108cc7f508deb26885545c6
**Launched date**: 2026-08-07
**Priority**: `P0` — blocking live-capital expansion (Live-Capital Safety program, see context.md 2026-08-04)
**Development Branch**: `feature/position-sizing-engine`
**Created**: 2026-05-26
**Last Updated**: 2026-08-07
**Archived**: 2026-08-16

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-05-26 | `idea` → `draft` | /sdd-story | Product spec generated |
| 2026-08-05 | `draft` → `spec-ready` | /sdd-review | Product spec approved after 3 review rounds (3 warnings) |
| 2026-08-05 | `spec-ready` → `design-approved` | /sdd-design | Design debated (5 rounds, full) and approved; recon.md + design.md written; UI confidence-wiring split into named follow-up 110 |
| 2026-08-06 | `design-approved` → `implementation-ready` | /sdd-spec | Implementation spec generated with 12 steps |
| 2026-08-07 | `implementation-ready` → `code-completed` | /sdd-execute (sequential) | All 12 steps done. Stacked-branch build (per user directive) on top of `feature/exactly-once-order-intent` (feature 101, itself stacked on feature 100) — integration PR #881 targets that branch, not `main-dev` |

| 2026-08-07 | `code-completed` → `launched` | CI workflow | Promoted via PR #878; committed 856ad5a3a2ebc431c108cc7f508deb26885545c6 |
| 2026-08-16 | launched (unchanged) | /sdd-archiver | Archived: synthesis written to context.md + Ledger, specs pruned. |
---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Recon](recon.md) — grounded codebase dossier
- [Design](design.md) — debated, approved architecture
- [Implementation Spec](implementation-spec.md) — 12 steps
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Adds a risk-adjusted position sizing rules engine to the trading service that computes order quantity from account equity, ATR-based stop distance, signal confidence, and portfolio concentration limits — replacing externally-specified quantities and making real-capital trading safe.

## Reviewers

_(Auto-populated from docs/runbooks/reviewer-registry.md based on affected services and
change types. Override as needed for this feature. Snapshot finalized at /sdd-spec time —
re-run /sdd-spec if the registry changes.)_

| Role | Review Focus |
|---|---|
| `xstockstrat-trading` owner | Order execution correctness, broker API safety, fill detection, paper-only dev invariant, position limit enforcement, new outbound dependency correctness, order sizing correctness and fail-closed behavior |
| `xstockstrat-portfolio` owner | P&L calculation accuracy, position snapshot consistency, concurrent write safety, equity source semantics |
| `xstockstrat-config` owner | Config key naming (`<service>.<category>.<key>`), environment/trading_mode scoping, WatchConfig stream stability |
| `xstockstrat-ui` owner | Trading UI correctness, analytics display accuracy, config mutation safety, Connect-RPC call safety, environment scope correctness |
| Proto Reviewer | Field number uniqueness per message, no breaking changes without deprecation comment, `buf lint`/`buf breaking` pass |
| DBA | Migration NNN numbering (no gaps, no conflicts), up+down pair present, run-order compliance |
| Platform Lead | Cross-service architecture, new service additions, port assignments, new inter-service edge (trading → marketdata) |

## Next Action

[PR #881](https://github.com/davcs86/xstockstrat/pull/881) is open against
`feature/exactly-once-order-intent` (stacked-branch strategy) — drive to green.
Then proceed to feature 030 (stop-loss-bracket-orders).
