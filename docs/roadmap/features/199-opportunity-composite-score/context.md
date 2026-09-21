# Context: opportunity-composite-score

**Feature**: `docs/roadmap/features/199-opportunity-composite-score/feature.md`
**Product Spec**: `docs/roadmap/features/199-opportunity-composite-score/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/199-opportunity-composite-score/implementation-spec.md`

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

## Session 2026-09-20 — sdd-design

- Phase 0 Recon: wrote recon.md (services: analysis, ui, agent; scenario-recon C-16 digest). Key reuse: feature-065 EB shrinkage shape (_aggregate_cells:5187), get_float_present, scoreColor, replace_for_user/replace_symbols, agent _opportunity_to_dict + descriptor-parity test.
- Phase 1 Grilling: 4 rounds (full). Verdict SOUND/APPROVABLE, no Floor breach.
- **Chosen approach**: 2-axis per-opportunity composite = (Σwᵢ·sᵢ + 0.5·k)/(Σwᵢ+k), Σw≤0→NULL, inlined EB (not refactoring _aggregate_cells / ANALYSIS-2). s_readiness = conviction (IDENTITY map, declared ordinal ranking device). s_signal = clamp(max_agree,0,1)·(1−clamp(max_conflict,0,1)) over decayed effective_conviction, direction vs best_direction (raw). k=1.0, weights 1.0/1.0 → band [0.167,0.833]. Computed in _row_for before axis-zeroing; heal path recomputes via same fn. Proto field 21; migration 024; agent projection; UI /insights+/trader+mobile, em-dash on NULL.
- **Rejected**: all four axes (fundamentals double-counts via signal_axis, technical out-of-path servicer.py:667); one-sided readiness transform 0.5+0.5·conv (inflates weak setups, compresses range); k=4.0 (dimensionally wrong for unit weights, caps at 0.667); linear-cancellation direction discount (parity cliff); ratio a/(a+c) (scale-free); (net+1)/2 fold (incommensurable 0.5-neutral); extract _eb_shrink (touches ANALYSIS-2 binding path).

### C-16 / C-15 SIGN-OFF (recorded per C-16, C-11)

- **FR-5 CHANGED** from "Evidence set (v1) = all four types" to "the two axes present at the opportunity write path (readiness + directional signal)". **Explicit user sign-off given 2026-09-20** (this session). Rationale: /sdd-design Phase 0 recon proved fundamentals is not a distinct axis (re-enters via signal_axis → double-count) and technical is screener/backtest-only behind servicer.py:667. `@AC-4`/`@AC-6` amended to the two-axis reality; `@AC-2/3/5` recomputed under the identity map + k=1.0; new `@AC-11` (data-unavailable→NULL) + `@AC-12` (muted 0/0→NULL) added. No other opportunity `@AC-*` guarantee changed (all PRESERVE/EXTEND).

### MUST-FIX promoted (round 4): forward-looking cardinal guard

- `composite_score` is ranking-only, NEVER a cardinal sizing/alert/risk input (the fails.md:313 next-occurrence guard). Materialized as: (a) proto field-21 doc-comment mirroring conviction's "NOT a probability" (analysis.proto:555-557); (b) a new ANALYSIS-N invariant in services/xstockstrat-analysis/docs/context-constitution.md naming ExternalSignal.conviction (ingest.proto:110) as the correct confidence-to-size producer. Not an @AC (no consumer to assert against yet). These are blocking /sdd-spec steps.

## Open Threads (carry into /sdd-spec)

- [ ] Heal-path direction parity: derive best_direction from RAW conviction in the heal recompute; heal-parity test must cover a MIXED-direction (buy+sell) symbol. → analysis service+test steps.
- [ ] Anchor/measure split (raw best_direction vs decayed agree/conflict magnitudes): intended, document in the test step so it isn't "fixed" as a bug.
- [ ] @AC-14 (feature-095) determinism: carry an EXECUTABLE assertion, not prose (holds by construction — composite computed before read-time live enrichment).
- [ ] Signal presence predicate: key on signal-evidence existence (sig_contribs non-empty), NEVER s_signal>0 — a present-but-zero (full-conflict) signal is an active pull-down (@AC-4), not a dropped term.
- [ ] Rebase re-derivation: re-confirm proto field 21 + migration 024 against the merged tree (soft overlap with features 187/193/188).

## Session 2026-09-20 — sdd-spec

- Generated implementation-spec.md with 11 steps. Status → implementation-ready.
- Key codebase findings (re-derived against the current tree, per the design Open Risk):
  - Proto: `Opportunity` max field is `data_unavailable = 20` (`analysis.proto:592`) → **field 21** confirmed free; optional-double presence convention matches `signal_confidence = 19`.
  - Migration: disk tip is `023_opportunity_compute_state` → **024** confirmed next-free (root CLAUDE.md's 026/027/028 is drift). Table `analysis.opportunities` from `011_opportunities.up.sql`; nullable column, no DEFAULT (NULL = not-yet-computed, @AC-10/11/12).
  - Analysis wiring anchors: `_candidate` init `servicer.py:3966-3980`; decay fold `sig_contribs.append` `:4088` + `signal_axis` max `:4094` + raw-conviction `best_direction` `:4095-4097`; `_row_for` `:4253`; `sym_unavailable` axis-zeroing `:4326-4336`; `_retry_unavailable_symbols` heal `:3671`; `_row_to_opportunity` optional-map pattern `:5045-5047`; EB shape to reuse-by-shape (not extract — ANALYSIS-2) `_aggregate_cells:5187-5226`; `get_float_present` `watcher.py:132`.
  - Persistence: `replace_for_user` INSERT `opportunities.py:81-97`, `replace_symbols` UPDATE `:120-145`, `read()` SELECT cols `:180-183` — all three need `composite_score`.
  - Config keys cut to **three** (`composite_shrinkage_k`, `composite_weight_readiness`, `composite_weight_signal`) — the product-spec's `_fundamentals`/`_technical` weight keys are dropped with the 2-axis FR-5 change.
  - Agent: `_opportunity_to_dict` HasField-gated optionals `client.py:770-798`; descriptor-parity test `test_opportunity_projection.py:18-52` (regen at Step 2 turns it RED until Step 8 projects field 21 — the built-in red-before-green gate); `mcp-tools.md:865-920` return-shape doc.
  - UI: no 3-decimal formatter in `scoreDisplay.ts` (add `formatComposite`); render sites `OpportunityRow` `page.tsx:483-522`, mobile `SignalRow` map `:170-182`, trader `OpportunitySection` `positions/[symbol]/page.tsx:934-995`; vitest home `src/lib/scoreDisplay.test.ts`; fixtures `e2e/fixtures/opportunities.ts` + `INVENTORY.md:28`.
- Cardinal guard materialized as Step 1 (proto field-21 doc-comment) + Step 7 (`ANALYSIS-10` invariant in analysis context-constitution.md).
- All 12 scenarios (@AC-1..12) mapped to steps; C-14 surfaces (UI + agent) each have implementation steps.

### Grounding (pre-story exploration, this session)

- Analysis scoring: `_score_from_metrics`/`_grade`/`_aggregate_cells` (feature 065 empirical-Bayes),
  `app/services/scoring.py` (`compute_signal_score`, `combine_score`, `buy_threshold`).
- Opportunities: `_compute_opportunities` (~servicer.py:3876), `_signal_decay` (~:4926),
  `signal_axis` = MAX over decayed source-weighted signals; blended rank in
  `app/repositories/opportunities.py:35-36`.
- Proto: `Opportunity` message at `packages/proto/analysis/v1/analysis.proto` (~L558).
- UI: `src/app/insights/opportunities/page.tsx` (`SymbolGroupCard`), `src/lib/scoreDisplay.ts`
  (`scoreColor`), `src/app/trader/positions/[symbol]/page.tsx`.

## Session 2026-09-21 — sdd-review impl-spec (advisory) + warnings addressed

- Result: PASS WITH WARNINGS — 0 failures/blockers, 4 advisory warnings. Overlap scan CLEAN
  (field 21 / migration 024 / 3 config keys uncontested; 187/193/188 stay soft rebase).
- All 4 requested confirmations passed: field 21 + migration 024 next-free; paired red-green per
  non-frontend service step (5↔6, 8↔9); cardinal guard in both loci (Step 1 proto comment +
  Step 7 ANALYSIS-10); agent descriptor-parity is the intended RED gate, not a defect.
- Warnings — all ADDRESSED (operator: "address the warnings"):
  - [x] **W1 Step 2 `packages/proto/gen/` is a directory** (criteria false-positive for proto-gen)
    → clarified in Step 2 that the directory entry is intentional (buf regenerates the whole tree;
    correctness gated by the empty-diff freshness re-run, not file enumeration).
  - [x] **W2 line anchors drift 1–3 lines (Steps 3/5/8/9)** → strengthened the rebase-re-derivation
    note to explicitly mandate per-step re-anchoring of ALL cited line numbers at /sdd-execute
    (mandatory codebase-discovery re-anchors before writing; symbols verified real; numbers are hints).
    Not hand-corrected because discovery + the pending 187/193/188 rebases re-derive them anyway.
  - [x] **W3 Step 11 no `--cov-fail-under`** → resolved as exempt: xstockstrat-ui has no whole-suite
    coverage gate (B3 exempts frontend service steps; Playwright present). No edit needed.
  - [x] **W4 analysis CLAUDE.md "references migrations 026/027/028 that don't exist"** → FALSE POSITIVE.
    Verified 026_analysis_engine_blend_keys / 027_analysis_readiness_materializer_keys /
    028_analysis_opportunity_keys all EXIST in services/xstockstrat-config/migrations/ (config-service
    SEED migrations for analysis.* config keys — a different dir from analysis-service schema
    migrations, tip 023). analysis CLAUDE.md is correct. Corrected the inaccurate "drift" note in
    Step 3 evidence (traced to recon.md:71) to state this precisely; 024 is the correct next-free
    analysis-service schema migration.
- Overlap findings: none (CLEAN). Merge-order: 200→199 dependency already recorded; 199 needs no row.
