# Feature: account-trading-halt-and-kill-switch

**Lifecycle Status**: `design-approved`
**Priority**: `P0` — blocking live-capital expansion; rescoped 2026-08-04 to hardening the
`platform.maintenance_mode` key that already exists, not a green-field build (see context.md)
**Development Branch**: `feature/account-trading-halt-and-kill-switch`
**Created**: 2026-08-04
**Last Updated**: 2026-08-06

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-08-04 | `idea` → `draft` | /sdd-story | Product spec generated from external live-capital-safety risk review |
| 2026-08-04 | `draft` (rescoped) | feasibility re-check | Scope cut from a new state machine/proto/DB to hardening the existing enforced kill switch; see context.md |
| 2026-08-05 | `draft` → `spec-ready` | /sdd-review | Product spec approved (3 warnings) |
| 2026-08-06 | `spec-ready` → `design-approved` | /sdd-design | Design debated (5 rounds, full — hard cap) and approved with noted open risks; recon.md + design.md written |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Recon](recon.md) — grounded codebase dossier
- [Design](design.md) — debated, approved architecture
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec account-trading-halt-and-kill-switch`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Hardens the `platform.maintenance_mode` kill switch that already exists and is already enforced in `xstockstrat-trading` (`trading.go:244`) into an audited, richer state (`ACTIVE` / `REDUCE_ONLY` / `HALTED`) verified across every order-ingress handler, with transitions durably logged to the ledger — not a new state machine built from scratch.

## Reviewers

_(Auto-populated from docs/runbooks/reviewer-registry.md based on affected services and
change types. Override as needed for this feature. Snapshot finalized at /sdd-spec time —
re-run /sdd-spec if the registry changes.)_

| Role | Review Focus |
|---|---|
| `xstockstrat-trading` owner | Order execution correctness, broker API safety, fill detection, paper-only dev invariant, position limit enforcement |
| `xstockstrat-portfolio` owner | P&L calculation accuracy, position snapshot consistency, concurrent write safety |
| `xstockstrat-config` owner | Config key naming (`<service>.<category>.<key>`), environment/trading_mode scoping, WatchConfig stream stability |
| `xstockstrat-ui` owner | Trading UI correctness, config mutation safety, no direct DB access |
| `xstockstrat-agent` owner | MCP tool contract stability, admin `x-access-scope` forwarded only by management tools |
| Platform Lead | Cross-service architecture, new service additions, port assignments |

## Next Action

`/sdd-spec account-trading-halt-and-kill-switch` — design approved; generate implementation spec
