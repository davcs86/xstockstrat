# Context: screener-engine

**Feature**: `docs/roadmap/features/060-screener-engine/feature.md`
**Product Spec**: `docs/roadmap/features/060-screener-engine/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/060-screener-engine/implementation-spec.md`

---

## Session 2026-06-26 — sdd-story

- Created feature.md (status: draft), product-spec.md, context.md. Feature 3 of 6.
- Core constraint (platform lead): the screener must NOT interfere with existing formulas or backtest.
  Honored by computing signal/fundamental contributions in analysis (never injected into the sandbox),
  reusing `evaluator.py`'s `ExecuteFormula` invocation verbatim, and extracting the shared scoring math
  into a pure module pinned by a golden regression test against current backtest output.
- Fundamentals used two ways per scan: filter gates (include/exclude) + universe-normalized ranking
  contributors, blended by weight with technical-formula and source-weighted-signal scores.
- Depends on 058 (universe via UI) + 059 (fundamental criteria via cached GetFundamentals).
