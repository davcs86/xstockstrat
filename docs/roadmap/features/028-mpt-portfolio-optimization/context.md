# Context: mpt-portfolio-optimization  (archived 2026-08-05)

**Feature**: ./feature.md
**Status**: demoted/canceled — archived by /sdd-archiver; verbose specs pruned (recoverable via git history).

## Archive Synthesis — 2026-08-05 — /sdd-archiver

**What**: Proposed replacing/supplementing the position sizing engine with Markowitz mean-variance (MPT) optimization over open/candidate positions. Demoted at idea stage, 2026-05-26, before any design or code — a pure pre-emptive rejection (feature.md:3-4, 14).
**Why (irrecoverable rationale)**: MPT's dominant failure mode is the expected-return input, not the optimizer math — small errors in unknowable forward-return estimates produce wildly different "optimal" weights (Michaud 1989 cited as the "optimization error maximizer" critique, product-spec.md:22). Covariance estimation needs ~N²/2 observations per N assets (50 assets ≈ 1,250 daily obs ≈ 5 years, and the regime shifts underneath that window), so the inverse covariance matrix becomes ill-conditioned in practice (product-spec.md:24-25). MPT also structurally fails exactly when needed most: it concentrates in low-variance assets, and equity correlations converge toward 1.0 in crashes (Mar 2020, 2022 rate shock cited, product-spec.md:27-28).
**Rejected alternatives**:
- MPT itself was the rejected alternative to feature 023 (position-sizing-engine), which already solves the practical allocation need — risk-per-trade cap, concentration limit, ATR stop — without false precision (product-spec.md:33-34, 38).

**Scars & gotchas**: none — feature never reached design/execute; no code touched.
**Permanent deviations**: none — nothing shipped.
**Cross-feature signal**: - The analysis-service signal confidence score (0.0–1.0 ordinal conviction) was explicitly flagged as NOT an expected-return estimate and structurally unfit as an optimizer input (product-spec.md:16, 30-31) — a distinction any future feature proposing to reuse that score as a return/magnitude proxy must respect.
**Deferred follow-ons**:
- Reconsider only if: a validated forward-return data source appears (3+ yrs demonstrated accuracy); the portfolio grows to 30+ simultaneous positions where correlation management becomes material; or a dedicated quant researcher validates a shrinkage estimator (Ledoit-Wolf) / Black-Litterman extension as a research project, not a platform feature (product-spec.md:44-46).
- If more sophistication than feature 023 is ever wanted, named fallbacks are risk parity (equal risk contribution, no return estimates needed) or equal-weight-with-concentration-cap (product-spec.md:39-40, context.md:16).
**Failure post-mortem**: - Root cause: recognized an academically appealing but empirically fragile technique before investing design/build effort. This was an analytical rejection (Michaud critique + small-sample covariance math), not a post-hoc incident, so no "missed signal" applies.
**Ledger entries written**: insights.md (1), fails.md (1) — see the 2026-08-05 entries.
**Runtime-invariant recommendations (→ /context-constitution)**: - none
**Pruned artifacts**: product-spec.md — last present at f5abed5.
