# Feature: broker-state-reconciliation

**Lifecycle Status**: `spec-ready`
**Priority**: `P1` — revived 2026-08-04 after user pushback on the demotion; rescoped to a lightweight
periodic ticker inside `xstockstrat-trading` reusing its existing broker client, not a new engine or
dashboard (see context.md)
**Development Branch**: `feature/broker-state-reconciliation`
**Created**: 2026-08-04
**Last Updated**: 2026-08-04

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-08-04 | `idea` → `draft` | /sdd-story | Product spec generated from external live-capital-safety risk review |
| 2026-08-04 | `draft` → `demoted/canceled` | feasibility re-check | See context.md — depends on 101 and on an automated execution path that does not exist; a human reviewing every order via the trader UI is today's de facto reconciliation |
| 2026-08-04 | `demoted/canceled` → `draft` | user review | Revived, rescoped down to a lightweight periodic check — cheap enough for a solo maintainer even without automated execution; see context.md |
| 2026-08-05 | `draft` → `spec-ready` | /sdd-review | Product spec approved after 2 review rounds (4 warnings) |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec broker-state-reconciliation`_
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
| `xstockstrat-trading` owner | Order execution correctness, broker API safety, fill detection, position limit enforcement |
| `xstockstrat-portfolio` owner | P&L calculation accuracy, position snapshot consistency, concurrent write safety |
| `xstockstrat-ui` owner | Trading UI correctness, no direct DB access |
| Platform Lead | Cross-service architecture, inter-service dependency graph correctness |

## Next Action

`/sdd-design broker-state-reconciliation` — product spec approved; run recon + design debate
