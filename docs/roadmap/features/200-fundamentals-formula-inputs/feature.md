# Feature: fundamentals-formula-inputs

**Development Branch**: `feature/fundamentals-formula-inputs`
**Created**: 2026-09-21
**Last Updated**: 2026-09-21

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-09-21 | `idea` → `draft` | /sdd-story | Product spec generated (initial scope: formula signal producer) |
| 2026-09-21 | `draft` → `draft` | /sdd-story | Rescoped after user correction: NOT a producer/loop — a fundamentals-fed custom formula usable as a strategy component; renamed from `formula-signal-producer` |
| 2026-09-21 | `draft` → `spec-ready` | /sdd-review | Product spec approved (2 advisory warnings: Open Questions deferred to design; GetIndicatorSeries added to FR-3 snapshot parity). Overlap clean. |
| 2026-09-21 | `spec-ready` → `design-approved` | /sdd-design | Design debated (2 rounds, full mode) and approved; `recon.md` + `design.md` written. Chosen: disjoint formula categories (indicator-only vs fundamentals-only), additive `FormulaDefinition.fundamental_inputs` = new `FundamentalMetric` enum, epoch-model PIT in backtest / `GetFundamentalsMulti` snapshot elsewhere, single reused `analysis.backtest.fundamentals.enabled` gate. No Constitution Floor breach; no C-16 sign-off (no rule CHANGED). |
| 2026-09-21 | `design-approved` → `design-approved` | /sdd-design | R3 (user-requested extra round). Adversary NEEDS-WORK → 4 MAJOR seam fixes: two-chokepoints/one-key gate (snapshot loader ≠ PIT loader), eval-time prefetch routing map + `_definition_wants_fundamentals_formula` predicate, scalar-broadcast keeping value-primary (`@AC-1` → `fscore.composite`), 0-warmup for bars-free formulas; +198 C-16 PRESERVE. User sign-off: **keep the closed enum** (declined the string reversal); `@AC-6` relocated to indicators `RegisterFormula`. Disjoint-kind untouched; still no Floor breach / no rule CHANGED. Design sharpened, gate not re-opened. |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Acceptance Scenarios](acceptance.feature) — Gherkin `@AC-*` scenarios (single source of acceptance truth, C-15)
- [Recon Dossier](recon.md) — grounded codebase map, patterns to reuse, existing business rules (C-16)
- [Design](design.md) — debated, user-approved architecture (disjoint categories); rejected alternatives; open risks; Constitution rules touched
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec fundamentals-formula-inputs`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Let a **custom formula used as a strategy component** (`COMPONENT_KIND_CUSTOM_FORMULA`) consume
**fundamentals as inputs** — the same input/output contract as the fundamentals *scoring formula*
(feature 063: fundamentals `input_data` → composite score `output`) — so a strategist can author one
fundamentals-scoring formula and use it directly in a strategy's entry/exit rules. The fundamentals
fed are **context-dependent**: point-in-time as-of each bar (feature 198's PIT store) in a backtest,
current snapshot in live/screener. No background loop or signal emission.

## Reviewers

_(Auto-populated from docs/runbooks/reviewer-registry.md based on affected services and
change types. Override as needed for this feature. Snapshot finalized at /sdd-spec time —
re-run /sdd-spec if the registry changes.)_

| Role | Review Focus |
|---|---|
| `xstockstrat-analysis` owner | Backtest reproducibility, strategy scoring determinism, **no look-ahead bias** (PIT-as-of-bar fundamentals feeding a formula component) |
| `xstockstrat-indicators` owner | `ExecuteFormula` input_data/output contract stability (consumed unchanged; confirm no new formula-declaration surface is needed) |
| `xstockstrat-ui` owner | ComponentEditor affordance for fundamentals-scoring formulas (if any) |
| `xstockstrat-agent` owner | `manage_strategy` formula-component contract (already supports formula components) |

## Next Action

`/sdd-spec fundamentals-formula-inputs` — turn the approved design into a numbered implementation spec
