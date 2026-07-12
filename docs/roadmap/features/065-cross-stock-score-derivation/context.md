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
