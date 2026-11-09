# Feature: config-dead-rows-prune

**Development Branch**: `feature/config-dead-rows-prune`
**Created**: 2026-11-07
**Last Updated**: 2026-11-07

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-11-07 | `idea` → `draft` | /sdd-story | Product spec generated from feature 296's approved design (`296-fix-config-keys-contract/design.md` §1, §9; FR-9 and AC-7/13/14 moved here). Created at the operator's explicit direction as slice C of the 296 split; `Type: feature` (planned slice, not a triaged defect) |
| 2026-11-09 | `draft` → `spec-ready` | /sdd-review | Product spec approved (3 warnings). Revised first: open questions resolved, FR-6 (remove `config_allow296` tool) and FR-7 (stale refs) added at the operator's direction |
| 2026-11-09 | `spec-ready` → `design-approved` | /sdd-design | Design debated (4 rounds, full) and approved; recon.md + design.md written. Scope narrowed to 4 tuples / 2 keys (operator declined the 304 @AC-12 C-16 CHANGE); ledger baseline entry re-owned to feature 306 |
| 2026-11-09 | `design-approved` → `implementation-ready` | /sdd-spec | Implementation spec generated with 14 steps (2 operator-gated: P1 evidence/sign-off, P2 rehearsal; one atomic unit, Steps 4-6) |
| 2026-11-09 | `implementation-ready` → `in-progress` | /sdd-execute | Sequential run started; Steps 1+2 (evidence loader + verdict + tests) done |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Acceptance Scenarios](acceptance.feature) — Gherkin `@AC-*` scenarios (single source of acceptance truth, C-15)
- [Implementation Spec](implementation-spec.md) — 14 numbered steps with codebase evidence
- [Recon](recon.md) — grounded codebase dossier
- [Design](design.md) — debated, approved architecture
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Deletes the operator-signed dead config rows — `analysis/opportunity.sparkline_bars` and `marketdata/alpaca.paper`, each in staging and production (4 tuples, 2 keys) — only when a small pure evidence evaluator finds zero reads in either spelling over a full staging release and every subscriber logged read coverage, with snapshot, audit and a reversible down. Unmatched signed tuples are reported, never raised. `ledger/stream.notify_enabled` is kept (operator declined the C-16 CHANGE) and its baseline entry is re-owned to feature 306. Also removes the spent `config_allow296` tool (FR-6) and the stale references (FR-7).

## Reviewers

| Role | Steps |
|---|---|
| Service owner — `xstockstrat-config` | 1, 2, 4, 5, 6, 10, 11, 13, 14 |
| Service owner — `xstockstrat-indicators` | 7, 8 |
| DBA | 3, 4, 5, 13 |

## Next Action

`/sdd-review config-dead-rows-prune impl-spec` — validate the implementation spec, then `/sdd-execute config-dead-rows-prune` (pauses at the operator-gated Steps 3 and 13; the integration PR stays a draft until Step 14 passes)
