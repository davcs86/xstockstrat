# Feature: wire-signal-confidence-to-position-sizing

**Development Branch**: `feature/wire-signal-confidence-to-position-sizing`
**Created**: 2026-08-05
**Last Updated**: 2026-08-31

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-08-05 | `idea` → `draft` | /sdd-story | Product spec generated — named follow-up from 023-position-sizing-engine's design round 5 (C-14 deferral) |
| 2026-08-31 | `draft` (regenerated) | /sdd-story (overwrite) | product-spec.md regenerated to current template; acceptance.feature authored |
| 2026-08-31 | `draft` → `spec-ready` | /sdd-review | Product spec approved; all review blockers addressed |
| 2026-08-31 | `spec-ready` → `design-approved` | /sdd-design | Design debated (full) + retarget/delete-orphan revision; approved; recon.md + design.md written |
| 2026-08-31 | `design-approved` → `implementation-ready` | /sdd-spec | Implementation spec generated (8 steps) |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Acceptance Scenarios](acceptance.feature) — Gherkin `@AC-*` scenarios (single source of acceptance truth, C-15)
- [Implementation Spec](implementation-spec.md) — numbered steps with codebase evidence
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Wires a real, per-order confidence value — sourced from `ExternalSignal.conviction`, not the
semantically-mismatched `Opportunity.conviction` — into the `PlaceOrderRequest.confidence` field
that 023 (position-sizing-engine) adds, via a scoped blank-qty affordance on the signal-order-ticket
UI, so FR-2's confidence-scaling formula is actually exercised instead of shipping permanently inert.

## Reviewers

_(Auto-populated from docs/runbooks/reviewer-registry.md based on affected services and
change types. Override as needed for this feature. Snapshot finalized at /sdd-spec time —
re-run /sdd-spec if the registry changes.)_

| Role | Review Focus |
|---|---|
| `xstockstrat-analysis` owner | Backtest reproducibility, strategy scoring determinism, no look-ahead bias — relevant to threading `ExternalSignal.conviction` through the opportunity pipeline without corrupting the existing ordinal `Opportunity.conviction` |
| `xstockstrat-ui` owner | Trading UI correctness, Connect-RPC call safety, no direct DB access |
| `xstockstrat-trading` owner | Order execution correctness (consumer of the `confidence` field 023 adds — no logic change expected here, verify at design time) |
| Proto Reviewer | Field number uniqueness, backward compatibility |
| Platform Lead | Cross-service architecture, inter-service dependency graph correctness |

## Next Action

`/sdd-review wire-signal-confidence-to-position-sizing impl-spec` then `/sdd-execute wire-signal-confidence-to-position-sizing`
