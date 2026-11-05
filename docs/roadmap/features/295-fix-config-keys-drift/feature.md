# Feature: fix-config-keys-drift

**Type**: bug
**Development Branch**: `feature/fix-config-keys-drift`
**GitHub Issue**: n/a — Issues disabled; defect report `docs/reports/2026-11-04-config-key-drift-and-subscription-gaps-defect.md`
**Severity**: SEV-2
**Created**: 2026-11-04
**Last Updated**: 2026-11-04

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-11-04 | `bug-reported` → `draft` | /sdd-triage | Product spec pre-populated from defect report 2026-11-04-config-key-drift-and-subscription-gaps |
| 2026-11-04 | `draft` → `spec-ready` | /sdd-review | Product spec approved on second pass (FR-1..15, AC-1..21; 5 advisory warnings) |
| 2026-11-04 | `spec-ready` (unchanged) | /sdd-review | Re-scoped to Release A (operator decision 13; Release B → feature 296); re-reviewed FAIL (FR-10 wording) → fixed → PASS WITH WARNINGS (FR-1..15, AC-1..27) |
| 2026-11-05 | `spec-ready` → `design-approved` | /sdd-design | Design debated (5 rounds, full; operator decisions 1–25) and approved; recon.md + design.md written; Release B split to 296 |

---

## Artifacts

- [Product Spec](product-spec.md) — bug description and fix scope
- [Acceptance Scenarios](acceptance.feature) — regression scenario(s) (`@AC-*`, C-15)
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec fix-config-keys-drift`_
- [Recon](recon.md) — Phase 0 dossier
- [Design](design.md) — approved architecture, rejected alternatives, open risks
- [Context Log](context.md) — session history, decisions, deviations
- Companion: feature 296 `fix-config-keys-contract` (Release B, branch `feature/fix-config-keys-contract`)

---

## Summary

Config keys drift from their readers, about 60 read keys have no DB seed row, and several values do
not update until restart (the agent has no watcher, readers cache values at startup, and a watcher
can stall silently). This feature fixes all three: it makes stored keys namespace-relative, seeds
every key the code reads, makes every key live, and adds a CI gate plus SDD skill changes so the
drift cannot come back.

## Next Action

`/sdd-spec fix-config-keys-drift` — generate implementation spec from the approved design (after the product-spec re-review of the round-5 wording edits passes)
