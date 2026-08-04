# Feature: trading-state-machine-invariants

**Lifecycle Status**: `demoted/canceled`
**Development Branch**: `feature/trading-state-machine-invariants`
**Created**: 2026-08-04
**Last Updated**: 2026-08-04

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-08-04 | `idea` → `draft` | /sdd-story | Product spec generated from external live-capital-safety risk review |
| 2026-08-04 | `draft` → `demoted/canceled` | feasibility re-check | See context.md — needs a property-based testing library not used anywhere in the Go stack, to harden an autonomous order lifecycle that does not exist (all orders are human-placed) |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec trading-state-machine-invariants`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Adds model-based / property-based tests over the `xstockstrat-trading` order lifecycle that generate long randomized event sequences (duplicates, delays, crashes, reordering) against the feature-103 broker simulator and assert core safety invariants (filled quantity monotonic and bounded, terminal orders never revive, one fill → one ledger event, protective-order quantity never exceeds the position, OCA siblings never double-count exposure) hold under all of them.

## Reviewers

_(Auto-populated from docs/runbooks/reviewer-registry.md based on affected services and
change types. Override as needed for this feature. Snapshot finalized at /sdd-spec time —
re-run /sdd-spec if the registry changes.)_

| Role | Review Focus |
|---|---|
| `xstockstrat-trading` owner | Order execution correctness, fill detection, position limit enforcement |

## Next Action

`/sdd-review trading-state-machine-invariants product-spec` — AI review of product spec before running /sdd-spec
