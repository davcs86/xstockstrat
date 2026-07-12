# Context: cross-stock-score-derivation

**Feature**: `docs/roadmap/features/065-cross-stock-score-derivation/feature.md`
**Product Spec**: `docs/roadmap/features/065-cross-stock-score-derivation/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/065-cross-stock-score-derivation/implementation-spec.md`

---

## Session 2026-07-12 — sdd-story

- Created feature.md (status: draft), product-spec.md, context.md from user story.
- Origin: design discussion following PR #758 (feature 064 backtest run history). The user
  explicitly chose **statistical robustness** over single-run traceability for the headline
  grade ("the product is named after Cross Stock Strategies").
- Key design decisions carried from the discussion into the spec:
  - Unit of evidence is the **(symbol × window) cell**, not the run — runs are arbitrary
    user-shaped containers; cells make breadth measurable and kill overlapping-run
    double-counting.
  - Dedup rule: one cell per symbol, **most trading days wins** (tie → newest). Replays add
    no weight; short runs can't displace long ones.
  - Aggregation: trading-day evidence weights + **empirical-Bayes shrinkage toward 0.5**
    (`analysis.scoring.shrinkage_days`, default 250). Chosen over lower-confidence-bound
    variants (LCB breaks at n=1 cell) and over dispersion penalties (deferred, out of scope).
  - **Weight by evidence, never by outcome**: the user's original suggestion included yield
    as a weight; rejected as outcome-weighting = built-in upward bias. Yield-as-component is
    an open question instead.
  - `strategy_scores` is kept as a **materialized cache** of the derivation (recomputed at
    write time), preserving the write-through + hydrate-at-boot pattern (ledger insight
    2026-07-03, persist-strategy-scores) — read paths untouched.
  - Reset on `ManageStrategy UPDATE` via eligibility filter `completed_at >
    strategies.updated_at`.
  - `ScoreStrategy` repurposed as recompute-from-cells (currently vestigial — re-scores the
    in-memory latest backtest that RunBacktest already scored).
  - No cell backfill from pre-existing run-level aggregates (not per-symbol; would poison the
    evidence base).
- Ledger reads surfaced two relevant entries, both recorded in the spec:
  - insight 2026-07-03 (persist-strategy-scores): keep write-through+hydrate (FR-4).
  - fail 2026-07-01 / C-10(b) (056-open-positions-ui): two read paths surfacing one value —
    here the divergence between per-run score and derived grade is *intentional*; spec
    requires explicit labeling + test instead of parity (FR-8, Open Questions).

## Session 2026-07-12 (later) — open-questions expansion

- On user request, expanded the spec's Open Questions into OQ-1…OQ-6, each with candidate
  resolutions, pros/trade-offs, and a recommendation. Checkboxes remain open pending user
  confirmation (to be recorded here when given). Recommended resolutions:
  - OQ-1: keep `shrinkage_days=250` + floor 3 symbols/500 days; documented the closed-form
    calibration anchors (perfect-evidence A ⇔ W ≥ 1.5k symbol-days; B ⇔ W ≥ 0.43k).
  - OQ-2: keep the three-component blend; no return component (defer; opt-in
    `return_weight=0.0` key is the retrofit path if rankings mislead post-launch).
  - OQ-3: headline-score **registered definitions only**; ad-hoc strategy_ids keep run
    history + per-run scores but get no headline (also fixes the pre-existing
    strategy_scores pollution gap). If confirmed → FR-2a/FR-6 deltas noted in the spec.
  - OQ-4: in-request recompute only (RunBacktest / UPDATE / ScoreStrategy triggers); hydrate
    unchanged; documented staleness semantics — ScoreStrategy is the manual refresh after a
    scoring-config change.
  - OQ-5: close the C-10(b) trap with copy ("Strategy Grade" card vs "Run score" column) +
    a Playwright both-labels-render assertion.
  - OQ-6: accept correlated-symbol breadth inflation for v1 with a named revisit trigger;
    sector-capped weights (via feature-059 fundamentals sector data) is the designated
    follow-up if needed.

## Session 2026-07-12 (later) — OQ resolutions confirmed

- **User confirmed all six recommendations as-is** ("go with your recs"). All OQ checkboxes
  marked resolved in product-spec.md; the analyses are retained there as the decision record.
- OQ-3 FR deltas applied: FR-2a now scopes headline scoring to registered strategies only
  (ad-hoc ids record cells + history, no headline, no `strategy_scores` write); FR-6 returns
  NOT_FOUND for unregistered ids. Out of Scope updated accordingly (existing ad-hoc
  `strategy_scores` rows are not cleaned up here; OQ-2 decision noted).
- Next: `/sdd-review cross-stock-score-derivation product-spec`.

## Session 2026-07-12 — sdd-review product-spec

- Product spec approved. Status: draft → spec-ready.
- Warnings: none (criteria pass: PASS, 0 blockers, 0 warnings, 3 notes).
- Overlap findings: none (CLEAN — analysis migration 007 free; StrategyScore proto fields 5–7
  free, BacktestRunSummary 15+ free; new `analysis.scoring.*` keys unclaimed; no in-flight
  feature touches these tables/files).
- Notes carried forward for /sdd-spec:
  1. Resolve the "optional, decide at spec time" `BacktestRunSummary.range_start/range_end`
     proto addition (field numbers 15+ are free).
  2. Include Config-Keys-Consumed table registration in `services/xstockstrat-analysis/CLAUDE.md`
     for the three new `analysis.scoring.*` keys (routine per config governance).
  3. If seeding the config keys via a config-service seed migration (pattern of 058/059/062),
     the next free number in `services/xstockstrat-config/migrations/` is `009`.
  4. FR-9 UX cliff acknowledged by review as documented-behavior-not-gap: a legacy broad grade
     can drop sharply on first post-deploy recompute (cells-only evidence).
