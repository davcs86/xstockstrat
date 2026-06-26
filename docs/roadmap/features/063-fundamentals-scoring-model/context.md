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

## Session 2026-06-26 — sdd-review product-spec

- Product spec reviewed (spec-reviewer + feature-overlap subagents). Status: draft → spec-ready.
- Verdict: PASS WITH WARNINGS / overlap CLEAN (no current duplicate key with 062). No blockers. Claims
  verified: `RegisterFormula`/`ExecuteFormula` RPCs + `FormulaParameter` exist (indicators.proto);
  `indicators.formulas` table with `is_public BOOLEAN` exists (migrations/001_formulas.up.sql); typed-params
  infra is real; `input_data` is a `google.protobuf.Struct` (fundamentals pass through with no sandbox change).
- 3 warnings fixed in product-spec:
  1. Config-key inconsistency: OQ-063-c resolves weights to formula `params`, but the Config section kept the
     config-key alternative open. Struck the two keys; Config Key Changes now states "None" — weights/bands
     are formula params. This definitively CLOSES the 062/063 `analysis.fundsignal.*` namespace risk (063 adds
     no keys; `scoring_formula_id` stays 062-owned).
  2/3. Wrong dependency feature number: typed formula-parameters infra is the launched `058-formula-parameters`
     feature, NOT 052 (`durable-observable-backfills`). Fixed FR-2, the Depends-on line, and OQ-063-c, using the
     slug `058-formula-parameters` to avoid the duplicate-058 number ambiguity.
- AC-5 ("match intuition on a small labeled sample") is qualitative — left as advisory (a concrete threshold can
  be set at /sdd-spec); not a gate blocker.
- Overlap findings: CLEAN. No proto/migration changes; formula lives in `indicators.formulas`. 063 consumes the
  composite in analysis but declares no analysis files/migrations.
