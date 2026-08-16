# Feature: account-trading-halt-and-kill-switch

**Committed to main**: 856ad5a3a2ebc431c108cc7f508deb26885545c6
**Launched date**: 2026-08-07
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
| 2026-08-06 | `design-approved` → `implementation-ready` | /sdd-spec | Implementation spec generated with 13 steps |
| 2026-08-07 | `implementation-ready` → `in-progress` | /sdd-execute (sequential) | Step 1 done — re-verified FR-1, retired the stale findings-doc row |
| 2026-08-07 | `in-progress` → `code-completed` | /sdd-execute (sequential) | All 13 steps done. Next: merge-order gate + integration PR to `main-dev` |

| 2026-08-07 | `code-completed` → `launched` | CI workflow | Promoted via PR #878; committed 856ad5a3a2ebc431c108cc7f508deb26885545c6 |
---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Recon](recon.md) — grounded codebase dossier
- [Design](design.md) — debated, approved architecture
- [Implementation Spec](implementation-spec.md) — 13 numbered steps, evidence-grounded
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Hardens the `platform.maintenance_mode` kill switch that already exists and is already enforced in `xstockstrat-trading` (`trading.go:244`) into an audited, richer state (`ACTIVE` / `REDUCE_ONLY` / `HALTED`) verified across every order-ingress handler, with transitions durably logged to the ledger — not a new state machine built from scratch.

## Reviewers

_(Auto-populated from docs/runbooks/reviewer-registry.md based on affected services and
change types. Override as needed for this feature. Snapshot finalized at /sdd-spec time —
re-run /sdd-spec if the registry changes.)_

Finalized against the 13 steps in `implementation-spec.md`. The Agent surface and Platform Lead
role from the earlier snapshot are dropped — this feature's chosen design (`design.md`) touches
neither `xstockstrat-agent` nor any new service/port.

| Role | Review Focus |
|---|---|
| `xstockstrat-trading` owner | Order execution correctness, broker API safety, fill detection, paper-only dev invariant, position limit enforcement |
| `xstockstrat-portfolio` owner | P&L calculation accuracy, position snapshot consistency, concurrent write safety |
| `xstockstrat-config` owner | Config key naming (`<service>.<category>.<key>`), environment/trading_mode scoping, WatchConfig stream stability |
| `xstockstrat-ui` owner | Trading UI correctness, analytics display accuracy, config mutation safety, Connect-RPC call safety, environment scope correctness, no secret values rendered in UI, no direct DB access (except audit log) |
| DBA | Migration NNN numbering (no gaps, no conflicts), up+down pair present, hypertable partitioning strategy, index correctness, run-order compliance with `scripts/db-migrate.sh` |

## Next Action

`/sdd-review account-trading-halt-and-kill-switch impl-spec` — validate implementation spec, then `/sdd-execute account-trading-halt-and-kill-switch`
