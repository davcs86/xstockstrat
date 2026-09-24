# Feature: order-time-in-force-enum

**Development Branch**: `feature/order-time-in-force-enum`
**Created**: 2026-09-24
**Last Updated**: 2026-09-24

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-09-24 | `idea` → `draft` | /sdd-story | Product spec generated |
| 2026-09-24 | `draft` → `spec-ready` | /sdd-review | Product spec approved (5 warnings, no blockers) |
| 2026-09-24 | `spec-ready` → `design-approved` | /sdd-design | Design debated (5 rounds, full) and approved; recon.md + design.md written |
| 2026-09-24 | `design-approved` → `implementation-ready` | /sdd-spec | Implementation spec generated (9 steps) |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Acceptance Scenarios](acceptance.feature) — Gherkin `@AC-*` scenarios (single source of acceptance truth, C-15)
- [Recon Dossier](recon.md) — grounded codebase map
- [Design](design.md) — debated, user-approved architecture (5 rounds, full)
- [Implementation Spec](implementation-spec.md) — 9 steps (proto → codegen → migration → Go service + tests → UI + E2E → verification + CI workaround)
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
