# Feature: stop-loss-bracket-orders

**Lifecycle Status**: `launched`
**Committed to main**: 856ad5a3a2ebc431c108cc7f508deb26885545c6
**Launched date**: 2026-08-07
**Priority**: `P0` — blocking live-capital expansion (Live-Capital Safety program, see context.md 2026-08-04)
**Development Branch**: `feature/stop-loss-bracket-orders`
**Created**: 2026-05-26
**Last Updated**: 2026-08-07

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-05-26 | `idea` → `draft` | /sdd-story | Product spec generated |
| 2026-08-05 | `draft` → `spec-ready` | /sdd-review | Product spec approved after 2 review rounds (3 warnings) |
| 2026-08-06 | `spec-ready` → `design-approved` | /sdd-design | Design debated (5 rounds, full — hard cap) and approved with noted open risks; recon.md + design.md written |
| 2026-08-06 | `design-approved` → `implementation-ready` | /sdd-spec | Implementation spec generated with 23 steps |
| 2026-08-07 | `implementation-ready` → `code-completed` | /sdd-execute (sequential) | All 23 steps done. Stacked-branch build (per user directive) on top of `feature/position-sizing-engine` (feature 023, itself stacked on 101 on 100) — integration PR targets that branch, not `main-dev` |

| 2026-08-07 | `code-completed` → `launched` | CI workflow | Promoted via PR #878; committed 856ad5a3a2ebc431c108cc7f508deb26885545c6 |
---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Recon](recon.md) — grounded codebase dossier
- [Design](design.md) — debated, approved architecture
- [Implementation Spec](implementation-spec.md) — 23 numbered steps
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Automatically submits stop-loss and optional take-profit bracket orders at the broker (IBKR/Alpaca) when a position is opened, using the stop price computed by the position sizing engine, so that open positions are protected without requiring platform uptime or human intervention.

## Reviewers

_(Auto-populated from docs/runbooks/reviewer-registry.md based on affected services and
change types. Override as needed for this feature. Snapshot finalized at /sdd-spec time —
re-run /sdd-spec if the registry changes.)_

| Role | Review Focus |
|---|---|
| `xstockstrat-trading` owner | Order execution correctness, broker API safety, fill detection, paper-only dev invariant, position limit enforcement |
| `xstockstrat-portfolio` owner | P&L calculation accuracy, position snapshot consistency, concurrent write safety |
| `xstockstrat-config` owner | Config key naming (`<service>.<category>.<key>`), environment/trading_mode scoping, WatchConfig stream stability |
| `xstockstrat-ui` owner | Trading UI correctness, analytics display accuracy, config mutation safety, Connect-RPC call safety, environment scope correctness, no secret values rendered in UI, no direct DB access (except audit log) |
| DBA | Migration NNN numbering (no gaps, no conflicts), up+down pair present, hypertable partitioning strategy, index correctness, run-order compliance |
| Proto Reviewer | Field number uniqueness per message, no breaking changes without deprecation comment, `buf lint`/`buf breaking` pass |
| Platform Lead | Cross-service architecture, new service additions, port assignments |

## Next Action

[PR #882](https://github.com/davcs86/xstockstrat/pull/882) is open against
`feature/position-sizing-engine` (stacked-branch strategy) — drive to green.
