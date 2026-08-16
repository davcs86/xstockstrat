# Feature: broker-state-reconciliation

**Committed to main**: 856ad5a3a2ebc431c108cc7f508deb26885545c6
**Launched date**: 2026-08-07
**Priority**: `P1` — revived 2026-08-04 after user pushback on the demotion; rescoped to a lightweight
periodic ticker inside `xstockstrat-trading` reusing its existing broker client, not a new engine or
dashboard (see context.md)
**Development Branch**: `feature/broker-state-reconciliation`
**Created**: 2026-08-04
**Last Updated**: 2026-08-07
**Archived**: 2026-08-16

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-08-04 | `idea` → `draft` | /sdd-story | Product spec generated from external live-capital-safety risk review |
| 2026-08-04 | `draft` → `demoted/canceled` | feasibility re-check | See context.md — depends on 101 and on an automated execution path that does not exist; a human reviewing every order via the trader UI is today's de facto reconciliation |
| 2026-08-04 | `demoted/canceled` → `draft` | user review | Revived, rescoped down to a lightweight periodic check — cheap enough for a solo maintainer even without automated execution; see context.md |
| 2026-08-05 | `draft` → `spec-ready` | /sdd-review | Product spec approved after 2 review rounds (4 warnings) |
| 2026-08-06 | `spec-ready` → `design-approved` | /sdd-design | Design debated (3 rounds, full) and approved with noted open risks; recon.md + design.md written; FR-4/AC-3/AC-5 amended (user-approved) |
| 2026-08-06 | `design-approved` → `implementation-ready` | /sdd-spec | Implementation spec generated with 25 steps; discovered and surfaced two new risks beyond design.md (IBKR never sends a client-order tag on SubmitOrder — FR-6's broker-side scan fallback is Alpaca-only; QueryEvents.event_type is exact-match only, not a prefix filter) |
| 2026-08-07 | `implementation-ready` → `code-completed` | /sdd-execute | All 25 steps executed as the final feature in the stacked 100→101→023→030→102 chain; PR opened targeting `feature/stop-loss-bracket-orders` (030's branch). Full deviation detail in implementation-spec.md's Deviation Log |
| 2026-08-07 | `code-completed` (PR #883 merged) | /sdd-execute | PR #883 squash-merged into `main-dev`, the last of the 100→101→023→030→102 chain to land (#879→#880→#881→#882→#883, each retargeted to `main-dev` and reconciled after the prior squash-merge) |

| 2026-08-07 | `code-completed` → `launched` | CI workflow | Promoted via PR #878; committed 856ad5a3a2ebc431c108cc7f508deb26885545c6 |
| 2026-08-16 | launched (unchanged) | /sdd-archiver | Archived: synthesis written to context.md + Ledger, specs pruned. |
---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Recon](recon.md) — grounded codebase dossier
- [Design](design.md) — debated, approved architecture
- [Implementation Spec](implementation-spec.md) — 25 steps
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Adds a lightweight periodic ticker inside `xstockstrat-trading` (reusing its existing broker client — `alpaca.go`/`ibkr.go`) that compares open orders/positions against broker truth, self-heals benign drift, and halts exposure-increasing trading (via rescoped feature 100) on an unsafe mismatch — never silently overwriting platform state without a ledger record of the correction. Not a new service, engine, or dashboard.

## Reviewers

_(Auto-populated from docs/runbooks/reviewer-registry.md based on affected services and
change types. Override as needed for this feature. Snapshot finalized at /sdd-spec time —
re-run /sdd-spec if the registry changes.)_

| Role | Review Focus |
|---|---|
| `xstockstrat-trading` owner | Order execution correctness, broker API safety, fill detection, paper-only dev invariant, position limit enforcement |
| `xstockstrat-portfolio` owner | P&L calculation accuracy, position snapshot consistency, concurrent write safety |
| `xstockstrat-config` owner | Config key naming, environment/trading_mode scoping, WatchConfig stream stability — new internal-caller authz surface (`x-internal-caller`), `SetConfig` write-path/audit-trail changes |
| `xstockstrat-ui` owner | Trading UI correctness, analytics display accuracy, config mutation safety, Connect-RPC call safety, environment scope correctness, no secret values rendered in UI, no direct DB access |
| Platform Lead | Cross-service architecture, new service additions, port assignments — new `trading → config` outbound edge, inter-service dependency graph correctness |
| DBA | Migration NNN numbering (no gaps, no conflicts), up+down pair present, hypertable partitioning strategy, index correctness, run-order compliance |
| Proto Reviewer | Field number uniqueness per message, no breaking changes without deprecation comment, `buf lint`/`buf breaking` passes |
| Security | No secrets in config service state, secret keys use `secret.*` prefix, JWT claims minimal, API key scoping correct — internal-caller authz direction-restriction |

## Next Action

Merged. PR #883 squash-merged into `main-dev` (2026-08-07), the last of the stacked
100→101→023→030→102 chain (#879/#880/#881/#882 merged first, in order). Awaiting promotion to
`main` via `/promote`.
