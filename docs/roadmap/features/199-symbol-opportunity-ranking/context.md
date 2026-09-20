# Context: symbol-opportunity-ranking

**Feature**: `docs/roadmap/features/199-symbol-opportunity-ranking/feature.md`
**Product Spec**: `docs/roadmap/features/199-symbol-opportunity-ranking/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/199-symbol-opportunity-ranking/implementation-spec.md`

---

## Session 2026-09-20 — sdd-story

- Created feature.md (status: draft), product-spec.md, acceptance.feature, context.md from user story.

### Why this feature exists (origin)

Split out of feature 198 (opportunity-composite-score). During 198's design the user confirmed their
real goal is **comparing which SYMBOL to trade**, with two concrete examples:
1. A symbol with 2 opportunities at 0.80 conviction + full readiness must rank ABOVE a symbol with 1
   opportunity at 1.00 conviction. → breadth/corroboration, NOT the current MAX-over-opportunities
   partition (`opportunities.py:35`) which ranks a symbol by its single best opportunity.
2. A symbol whose opportunity set includes `fundamental_macd_blend` must rank ABOVE a symbol with the
   same count but without it. → per-strategy weighting.

198 (per-opportunity composite) is necessary but NOT sufficient for symbol comparison, so 199 is the
symbol-level roll-up layer that consumes 198's `composite_score`.

### Decided design forks (operator answered before /sdd-story)

- **Vehicle**: new feature 199, layered on 198 (not expanding 198, not pivoting it).
- **Strategy weighting**: feature-065 derived grade (A–F → numeric) × operator per-strategy config
  override (default override 1.0).
- **Breadth aggregation**: diminishing-returns sum (2 moderate > 1 strong, with saturation so N weak
  do not run away). Exact saturating function is a design-phase decision (Open Question).

### Formula (shape)

`symbol_score = diminishing-returns-sum over the symbol's opportunities of (composite_score × strategy_weight)`,
`strategy_weight = grade_weight(feature-065 StrategyScore) × operator_override`.

### Ledger traps to carry (P-05)

- `fails.md:313`/`:418` — `symbol_score` is another ranking ordinal; must NEVER become a cardinal
  sizing/alert input. Extend feature-198's cardinal-guard invariant to `symbol_score`.
- Feature-190 MAX-partition sort (`opportunities.py:35`) is exactly what this replaces for symbol
  comparison; preserve the existing per-opportunity `conviction`/`expiry` sorts and the
  "client does not re-sort" guarantee (`@AC-15 @feature-190`) — a new default symbol ordering would be
  a CHANGE to `@AC-10 @feature-190` needing sign-off.
- `insights.md:543` (feature-097) — the opportunity path is lazy-materialize + valid_until +
  stale-while-revalidate + daily refresh; if `symbol_score` is persisted it rides that same path.

### Dependency / merge-order

Depends on **feature 198** (`Opportunity.composite_score` column + proto field). 198 is
`design-approved`, not merged. 199 must not merge before 198; both touch the analysis opportunity path
(soft rebase overlap with 198 and in-flight 187/193/188). Reserve migration NNN + proto field at
/sdd-spec against the merged tree.

### Consumer surfaces (C-14)

UI `/insights` (SymbolGroupCard orderable by symbol_score) + Agent (`list_opportunities` / symbol-compare projection).

## Session 2026-09-20 — sdd-review product-spec

- Product spec approved. Status: draft → spec-ready.
- Result: PASS WITH WARNINGS — 0 blockers.
- Warnings:
  1. Config key `analysis.scoring.strategy_weight_override.<strategy_id>` uses a non-standard 4-segment (dynamic-suffix) form — no 4-segment precedent in the analysis namespace (all ~40 keys are 3-segment). Already an Open Question; resolve at design (per-strategy dynamic keys vs one structured JSON value). (C-05)
  2. Migration up/down pairing (C-07) implied not restated in the conditional persisted branch — confirm at design if symbol_score is persisted.
- Overlap findings: no FAIL-class collision (199 has reserved no concrete field/migration/key yet). HARD merge-order dependency on 198 (consumes composite_score; buf breaking/golang-migrate can't see 198's uncommitted claims). Blocking row added to merge-order.md. Soft same-file rebase overlap on servicer.py _compute_opportunities, opportunities.py ORDER BY, insights/opportunities/page.tsx, agent list_opportunities — shared with 198/187/193/188.
- Verified against code: feature-065 _grade A-F at servicer.py:5174-5184 (strategy grade source real); current MAX-partition sort default at opportunities.py:35 (the behavior FR-2 replaces); composite_score does not yet exist in source (198 spec-only → merge-order dep confirmed).
- Fixed stale label: product-spec said 198 "design-approved" → now implementation-ready (both pre-merge).
