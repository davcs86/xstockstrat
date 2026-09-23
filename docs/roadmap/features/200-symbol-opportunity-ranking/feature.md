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
| 2026-09-21 | `design-approved` → `implementation-ready` | /sdd-spec | Implementation spec generated with 11 steps. Every step evidence-cited against the merged 199 tree (re-anchored drifted lines: `_compute_opportunities` 3989, composite reads 4016, `rows` 4515, `_retry_unavailable_symbols` 3744/heal apply 3982, `_row_to_opportunity` 5301, repo `_SORT_ORDER_BY`/read/replace paths, proto sort enum 546 / `composite_score = 21`, `ANALYSIS-11` at context-constitution:27). All 10 v1 `@AC-*` covered (`@AC-5` deferred to the named follow-up). Config collapsed to two `analysis.scoring.*` keys; migration `025` |
| 2026-09-23 | `implementation-ready` → `in-progress` | /sdd-execute | Sequential execution on a fresh `feature/symbol-opportunity-ranking` off current `main-dev` (201 merged). Pre-execute reconciliation: feature 201 (fundamentals-formula-inputs) took `ANALYSIS-12`, so this feature's `symbol_score` guard moved to `ANALYSIS-13`; reserved surfaces (proto `symbol_score = 22` / sort `3` / migration `025` / both config keys) re-verified free; spec symbols validated present post-201. **Step 1 done** — proto additive `OPPORTUNITY_SORT_SYMBOL_SCORE = 3` + `Opportunity.symbol_score = 22` (buf lint + breaking pass) |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Acceptance Scenarios](acceptance.feature) — Gherkin `@AC-*` scenarios (single source of acceptance truth, C-15)
- [Recon Dossier](recon.md) — grounded codebase map, patterns to reuse, existing business rules (C-16)
- [Design](design.md) — debated + approved architecture, rejected alternatives, open risks, Constitution rules
- [Implementation Spec](implementation-spec.md) — 11 numbered steps, evidence-cited
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

A single comparable **symbol-level** score that rolls up all of a symbol's opportunities into one
number (geometric rank-decay sum of each opportunity's feature-199 `composite_score` weighted by its
strategy's derived grade), so a trader can rank *which symbol to trade* across the whole queue — not
just compare individual opportunities. **Layers on feature 199.** (v1 is grade-only; the per-strategy
operator override is deferred to a follow-up — see `design.md` § Deferred.)

## Reviewers

_(Snapshot finalized at /sdd-spec time from docs/runbooks/reviewer-registry.md — the distinct
`**Reviewers**` values across all 11 steps, deduplicated. Stable unless /sdd-spec re-runs.)_

| Role | Review Focus | Steps |
|---|---|---|
| `xstockstrat-analysis` (service owner) | Strategy scoring determinism, backtest/roll-up reproducibility, no look-ahead bias | 3, 4, 5, 6 |
| `xstockstrat-ui` (service owner) | Analytics display accuracy, Connect-RPC call safety, server-authoritative ordering (no client re-sort) | 1, 10, 11 |
| `xstockstrat-agent` (service owner) | MCP tool contract stability (`list_opportunities` return shape), `mcp-tools.md` parity, omit-not-fabricate projection | 1, 7, 8 |
| Proto Reviewer | Additive-only `symbol_score = 22` + `OPPORTUNITY_SORT_SYMBOL_SCORE = 3`, field-number uniqueness, `buf breaking` passes | 1, 2 |
| DBA | `analysis` migration `025` NNN numbering (no gaps), up+down pair present, column additivity | 3 |
| `xstockstrat-config` (service owner) | Config key naming (`analysis.scoring.*` 3-segment), WatchConfig stream stability | 6 |

## Next Action

`/sdd-review symbol-opportunity-ranking impl-spec` — validate the implementation spec (advisory quality check + overlap scan), then `/sdd-execute symbol-opportunity-ranking`. Merge still sequences after feature 199 (`merge-order.md`).
