# Context: fundamentals-scoring-model

**Feature**: `docs/roadmap/features/063-fundamentals-scoring-model/feature.md`
**Product Spec**: `docs/roadmap/features/063-fundamentals-scoring-model/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/063-fundamentals-scoring-model/implementation-spec.md`

---

## Session 2026-06-26 — sdd-story

- Created feature.md (status: draft), product-spec.md, context.md. Feature 6 of 6.
- The model is delivered AS A FORMULA (reuse indicators sandbox; fundamentals passed in `input_data`,
  which is an arbitrary Struct — no sandbox change, no new injected variable). Weights/bands are typed
  formula params (Feature 052), so retuning needs no deploy.
- **OQ-063-a resolved by research** this session: default bands anchored on Benjamin Graham (value:
  P/E 10→35, P/B 1.0→5.0), ROE/Piotroski conventions (quality: ROE 5%→25%, D/E 0.3→2.0, EPS sign 1/0),
  and dividend-trap convention (triangular yield band peaking ~4%, zero at 0% and ≥10%). value/quality
  weights 0.5/0.5. beta + market_cap excluded from the composite (reserved for risk/size factors).
- Cross-sectional peer normalization deliberately kept OUT of the formula (lives in 062's
  orchestration) so the formula stays a pure per-symbol function.
