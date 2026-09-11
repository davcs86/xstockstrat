# Feature: wire-signal-confidence-to-position-sizing

**Development Branch**: `feature/wire-signal-confidence-to-position-sizing`
**Created**: 2026-08-05
**Last Updated**: 2026-09-01
**Committed to main**: c086afc839f905c4f72b24d75e824e22d61af0b2
**Launched date**: 2026-09-01
**Archived**: 2026-09-02

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-08-05 | `idea` → `draft` | /sdd-story | Product spec generated — named follow-up from 023-position-sizing-engine's design round 5 (C-14 deferral) |
| 2026-08-31 | `draft` (regenerated) | /sdd-story (overwrite) | product-spec.md regenerated to current template; acceptance.feature authored |
| 2026-08-31 | `draft` → `spec-ready` | /sdd-review | Product spec approved; all review blockers addressed |
| 2026-08-31 | `spec-ready` → `design-approved` | /sdd-design | Design debated (full) + retarget/delete-orphan revision; approved; recon.md + design.md written |
| 2026-08-31 | `design-approved` → `implementation-ready` | /sdd-spec | Implementation spec generated (8 steps) |
| 2026-09-01 | `implementation-ready` → `in-progress` → `code-completed` | /sdd-execute | All 8 steps executed; red-before-green; field 19 stacked on 095's 13-18; orphan deleted; impl-review grep-narrowing fix honored |

| 2026-09-01 | `code-completed` → `launched` | CI workflow | Promoted via PR #1065; committed c086afc839f905c4f72b24d75e824e22d61af0b2 |
| 2026-09-02 | `launched` | /sdd-archiver | Archived: synthesis → context.md + Ledger insights(2)/fails(3); pruned 4 specs |
---

## Artifacts

- Specs (product-spec, recon, design, implementation-spec) — pruned by /sdd-archiver 2026-09-02; see [Context Log](context.md) Archive Synthesis
- [Acceptance Scenarios](acceptance.feature) — Gherkin `@AC-*` scenarios (single source of acceptance truth, C-15)
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
