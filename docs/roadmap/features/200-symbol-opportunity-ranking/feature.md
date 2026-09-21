# Feature: symbol-opportunity-ranking

**Development Branch**: `feature/symbol-opportunity-ranking`
**Created**: 2026-09-20
**Last Updated**: 2026-09-21

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-09-20 | `idea` → `draft` | /sdd-story | Product spec generated |
| 2026-09-20 | `draft` → `spec-ready` | /sdd-review | Product spec approved (1 advisory warning: 4-segment override key shape → design; 0 blockers). Merge-order row added: 200 depends on 199 |
| 2026-09-20 | `spec-ready` (unchanged) | /sdd-design | Recon + 3-round debate run (SOUND, no Floor breach); **paused by operator before approval** pending feature 199 landing. recon.md written; converged design + Open Threads in context.md; design.md NOT yet written |
| 2026-09-21 | `spec-ready` (unchanged) | sync | Re-grounded recon.md + context.md against what feature 199 BUILT (`code-completed`, PR #1157): composite_score is a queryable column (migration `024`, proto `= 21`); reserved `symbol_score = 22`, `OPPORTUNITY_SORT_SYMBOL_SCORE = 3`, migration `025`, `ANALYSIS-12`; Post-199-coupling + NULL-fold Open Threads resolved. No lifecycle flip — design resume (round 4) still pending |
| 2026-09-21 | `spec-ready` (unchanged) | /sdd-review | Re-review PASS WITH WARNINGS (0 blockers; overlap CLEAN). Fixed the stale 199 dependency label (implementation-ready → code-completed); config-key-shape / migration-pairing / Open-Questions warnings carried into the design round |
| 2026-09-21 | `spec-ready` → `design-approved` | /sdd-design | Design debated (round 4, full — resumed against the built 199 tree) and approved; recon.md + design.md written. Key decisions: geometric rank-decay fold (γ=0.5) over `composite × strategy_weight`; owner-scoped grade from drained bindings∪live (no extra query); shared compute/heal fold helper for determinism parity; unbounded scalar, opt-in sort, `ANALYSIS-12` guard |
| 2026-09-21 | `design-approved` (unchanged) | /sdd-design | Round 5 pressure test (hard cap). Adversary found the round-4 override-on-entity decision under-grounded (phantom migration; grade-fingerprint wipe; full-replace wipe; heal-parity gap; missing bounds/write-surface) — no Floor breach. **Operator override DEFERRED to a follow-up feature; v1 is grade-only** (override ≡ 1.0 no-op). design.md rewritten; FR-3 + config + affected-services descoped; `@AC-5` annotated `@deferred-followup` (C-15 append-only) |
| 2026-09-21 | `design-approved` (unchanged) | /sdd-design | Round 6 (operator-requested, past cap) — final grade-only pressure test, SOUND-WITH-RISKS, no Floor breach. Verified the mandated orderings + owned_ids complete-cover (grepped: no fourth attribution path) + `overall_score`∈[0,1] + heal-parity inputs. Addressed: **γ read-clamped to [0,0.99]** (an unbounded γ≥1 would invert @AC-3), corrected "unbounded"→"bounded (<2·max_composite)" framing + `ANALYSIS-12` doc-comment, clarified grade_lookup returns continuous `overall_score`, and fixed the stale override refs in recon.md (design.md authoritative) |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Acceptance Scenarios](acceptance.feature) — Gherkin `@AC-*` scenarios (single source of acceptance truth, C-15)
- [Recon Dossier](recon.md) — grounded codebase map, patterns to reuse, existing business rules (C-16)
- [Design](design.md) — debated + approved architecture, rejected alternatives, open risks, Constitution rules
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec symbol-opportunity-ranking`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

A single comparable **symbol-level** score that rolls up all of a symbol's opportunities into one
number (diminishing-returns sum of each opportunity's feature-199 `composite_score` weighted by its
strategy's derived grade × operator override), so a trader can rank *which symbol to trade* across the
whole queue — not just compare individual opportunities. **Layers on feature 199.**

## Reviewers

_(Auto-populated from docs/runbooks/reviewer-registry.md based on affected services and
change types. Override as needed for this feature. Snapshot finalized at /sdd-spec time —
re-run /sdd-spec if the registry changes.)_

| Role | Review Focus |
|---|---|
| `xstockstrat-analysis` (service owner) | Strategy scoring determinism, backtest reproducibility, no look-ahead bias |
| `xstockstrat-ui` (service owner) | Analytics display accuracy, server-authoritative ordering (no client re-sort) |
| `xstockstrat-agent` (service owner) | MCP tool contract stability (`list_opportunities` return shape / symbol-compare surface), docs parity |
| Proto Reviewer | Additive-only symbol_score surface, field-number uniqueness, `buf breaking` passes |
| DBA | (If persisted) `analysis` migration NNN numbering, up+down pair, column additivity |
| `xstockstrat-config` (service owner) | Config key naming (`analysis.scoring.*` / `analysis.opportunity.*`), env/global-per-user scoping |

## Next Action

`/sdd-spec symbol-opportunity-ranking` — generate the implementation spec from the approved design. Design is approved (`design.md`); reserved surfaces `symbol_score = 22`, `OPPORTUNITY_SORT_SYMBOL_SCORE = 3`, migration `025`, `ANALYSIS-12` + a `StrategyDefinition.rank_weight_override` field + strategies-table migration. Merge still sequences after feature 199 (`merge-order.md`).
