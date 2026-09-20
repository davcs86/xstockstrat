# Context: opportunity-composite-score

**Feature**: `docs/roadmap/features/198-opportunity-composite-score/feature.md`
**Product Spec**: `docs/roadmap/features/198-opportunity-composite-score/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/198-opportunity-composite-score/implementation-spec.md`

---

## Session 2026-09-20 — sdd-story

- Created feature.md (status: draft), product-spec.md, acceptance.feature, context.md from user story.

### Decided design contract (operator answered 7 design forks before /sdd-story)

1. **Consolidation axis**: across *evidence types* (per-opportunity fusion), NOT across strategies.
   One composite per `user × symbol_norm × strategy_id` row. A symbol-level roll-up is explicit
   out-of-scope / possible follow-up.
2. **Axis handling**: composite rank scalar, components stay separately queryable → FR-3 never-fold
   invariant (features 083/097) preserved; no invariant override needed.
3. **Aggregation**: breadth-aware empirical-Bayes shrinkage toward neutral 0.5 prior
   `(Σ wᵢ·sᵢ + k·0.5)/(Σ wᵢ + k)`. Reuses feature-065 precedent (scoring.md, ANALYSIS-2/3),
   generalizes feature-190 query-time blend.
4. **Compute/persistence**: on the existing opportunity-refresh write path (`_compute_opportunities`),
   persisted on `analysis.opportunities`. Aligns with feature-097 lazy-materialize + valid_until +
   stale-while-revalidate + daily refresh (insights.md:543).
5. **Directionality**: direction-scoped, disagreement discounts magnitude (not signed, not
   direction-agnostic).
6. **Representation**: 0–1 scalar (3-decimal) only; no A–F band; colored via existing scoreColor.
7. **Evidence set (v1)**: all four — readiness (`conviction`), `signal_axis`, fundamentals
   value+quality composite, technical signal. Absence → zero weight, never zero score.

### Ledger traps folded into product-spec Open Questions (P-05 read)

- **fails.md:313 (feature 023) — CENTRAL RISK**: `Opportunity.conviction` is a *deterministic
  ordinal, NOT a probability*; `ExternalSignal.conviction` is a real 0–1 confidence. Blending them in
  a shrinkage as if commensurable is the exact semantic mismatch 023 was caught making. Design must
  define an explicit normalization map per evidence sub-score; adversary round to attack this.
- **fails.md:418 / insights.md:671,686**: composite is ordinal ranking aid, not cardinal probability
  of profit / expected return. Consider stating this in the proto field comment.
- **insights.md:543 (feature 097)**: ride the existing lazy-materialize refresh path, not a new loop.
- **insights.md:973**: best-effort try/except persistence precedent (`hydrate_scores`).
- **insights.md:146**: config-key naming follows `analysis.scoring.shrinkage_days`.
- **insights.md:1135**: reuse existing normalization transforms (`scoring.buy_threshold`,
  `compute_signal_score`) for direction-scoping rather than a new one.
- **fails.md:561,611**: `ls services/xstockstrat-analysis/migrations/` and reserve next-free NNN at
  design time; do not guess the migration number.
- **fails.md:81 / fails.md:394**: proto→consumer coupling — new field is a `double` (no exhaustive-map
  TS break), but UI render + agent `list_opportunities` mapping + docs must ship in the same PR (C-14).

### Consumer surfaces (C-14)

UI `/insights` (opportunities queue) + `/trader` (per-symbol page) + Agent `list_opportunities`.

## Session 2026-09-20 — sdd-review product-spec

- Product spec approved. Status: draft → spec-ready. (Operator chose: review spec, then FULL design cycle — not quick.)
- Result: PASS WITH WARNINGS — 0 blockers, 3 advisory warnings.
- Warnings:
  1. Criterion 9 — 7 unchecked Open Questions, all design-routed (advisory, map to no C/P/F rule). Carried as the /sdd-design agenda; the ordinal-vs-probability normalization + the Σwᵢ=0 NULL-vs-0.5 boundary must be resolved before /sdd-spec.
  2. AC-6 was qualitative → strengthened with distinct per-evidence weights + concrete value 0.656 (proves readiness weight 2.0 is applied, not collapsed).
  3. NOTE (pre-existing, out of scope): duplicate NNN `065` in the registry (cross-stock-score-derivation vs second-market-data-vendor); our citation resolves unambiguously to the former.
- Overlap findings: no hard collisions. Additive `Opportunity` proto field → next free **21** (max is `data_unavailable=20`). New analysis migration → **024** (tip `023_opportunity_compute_state`). Five `analysis.scoring.composite_*` keys uncontested. Three SOFT same-file rebase risks to reconcile at /sdd-spec time by rebasing onto landed: 187 (`opportunities.py` read ORDER BY), 193 (`_compute_opportunities` body), 188 (`OpportunityRow` markup). Re-derive field/migration numbers from the merged tree at spec time.
- Verified against code: `conviction` ordinal-not-probability comment `analysis.proto:555-557`; empirical-Bayes precedent `scoring.md:27-30`; `signal_axis` col `migrations/011_opportunities.up.sql:16`; `get_float_present` `app/config/watcher.py:132`.

### Grounding (pre-story exploration, this session)

- Analysis scoring: `_score_from_metrics`/`_grade`/`_aggregate_cells` (feature 065 empirical-Bayes),
  `app/services/scoring.py` (`compute_signal_score`, `combine_score`, `buy_threshold`).
- Opportunities: `_compute_opportunities` (~servicer.py:3876), `_signal_decay` (~:4926),
  `signal_axis` = MAX over decayed source-weighted signals; blended rank in
  `app/repositories/opportunities.py:35-36`.
- Proto: `Opportunity` message at `packages/proto/analysis/v1/analysis.proto` (~L558).
- UI: `src/app/insights/opportunities/page.tsx` (`SymbolGroupCard`), `src/lib/scoreDisplay.ts`
  (`scoreColor`), `src/app/trader/positions/[symbol]/page.tsx`.
