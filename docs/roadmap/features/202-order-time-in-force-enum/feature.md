# Feature: order-time-in-force-enum

**Development Branch**: `feature/order-time-in-force-enum`
**Created**: 2026-09-24
**Last Updated**: 2026-09-24
**Committed to main**: dd622bdc2e5b922df8dcabc6f7475b8b395a8ed3
**Launched date**: 2026-09-24
**Archived**: 2026-10-07

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-09-24 | `idea` → `draft` | /sdd-story | Product spec generated |
| 2026-09-24 | `draft` → `spec-ready` | /sdd-review | Product spec approved (5 warnings, no blockers) |
| 2026-09-24 | `spec-ready` → `design-approved` | /sdd-design | Design debated (6 rounds, full, SOUND) and approved; recon.md + design.md written |
| 2026-09-24 | `design-approved` → `implementation-ready` | /sdd-spec | Implementation spec generated (9 steps) |
| 2026-09-24 | `implementation-ready` → `in-progress` | /sdd-execute | Sequential execution started (Step 1 proto + Step 2 codegen) |
| 2026-09-24 | `in-progress` → `code-completed` | /sdd-execute | All 9 steps done; trading TIF tests 71.6% cov, 29/29 UI e2e green; C-16 scenarios promoted |

| 2026-09-24 | `code-completed` → `launched` | CI workflow | Promoted via PR #1169; committed dd622bdc2e5b922df8dcabc6f7475b8b395a8ed3 |
| 2026-10-07 | `launched` | /sdd-archiver | Archived: synthesis → context.md + Ledger insights(1)/fails(3); pruned 4 spec(s); acceptance scenarios promoted to per-service suites (C-16) |
---

## Artifacts

- Product Spec — pruned by /sdd-archiver; see [Context Log](context.md) Archive Synthesis
- [Acceptance Scenarios](acceptance.feature) — Gherkin `@AC-*` scenarios (single source of acceptance truth, C-15); promoted to services/xstockstrat-{trading,ui}/acceptance/order-time-in-force-enum.feature (promoted at launch) (C-16)
- Recon Dossier — pruned by /sdd-archiver; see [Context Log](context.md) Archive Synthesis
- Design — pruned by /sdd-archiver; see [Context Log](context.md) Archive Synthesis
- Implementation Spec — pruned by /sdd-archiver; see [Context Log](context.md) Archive Synthesis
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Promote the trading `Order.time_in_force` field from a free-form string to a first-class
`TimeInForce` proto enum with a zero-value sentinel, and enforce per-broker (Alpaca / IBKR)
validity at `PlaceOrder`/`ReplaceOrder` so an unsupported or malformed TIF is rejected with
`InvalidArgument` instead of being forwarded to a broker.

## Reviewers

_(Auto-populated from docs/runbooks/reviewer-registry.md based on affected services and
change types. Override as needed for this feature. Snapshot finalized at /sdd-spec time —
re-run /sdd-spec if the registry changes.)_

| Role | Review Focus |
|---|---|
| Proto Reviewer | Enum design, zero-value sentinel, breaking-vs-additive field strategy (field 12) |
| `xstockstrat-trading` owner | Order execution correctness, broker API safety, per-broker TIF mapping |
| `xstockstrat-ui` owner | Trader Place Order form correctness, Connect-JSON enum NAME-string encoding |

## Next Action

`/sdd-review order-time-in-force-enum impl-spec` — then `/sdd-execute order-time-in-force-enum`
