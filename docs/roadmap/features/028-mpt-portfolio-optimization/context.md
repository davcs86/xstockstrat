# Context: mpt-portfolio-optimization

**Feature**: `docs/roadmap/features/028-mpt-portfolio-optimization/feature.md`
**Product Spec**: `docs/roadmap/features/028-mpt-portfolio-optimization/product-spec.md`

---

## Session 2026-05-26T00:00:00Z — brainstorming

- Idea surfaced during platform brainstorming session.
- Demoted at idea stage without entering draft. Rationale documented in product-spec.md.
- Key decisions:
  - Signal confidence scores (0–1 ordinal) are not expected returns — MPT inputs are undefined.
  - Covariance matrix is numerically unstable in small-sample equity regimes.
  - Feature 023 (position-sizing-engine) solves the practical allocation problem without the mathematical fragility.
  - Alternatives if more sophistication is needed: risk parity or equal-weight with concentration cap.
