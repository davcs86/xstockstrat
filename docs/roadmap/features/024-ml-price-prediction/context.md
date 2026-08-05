# Context: ml-price-prediction  (archived 2026-08-05)

**Feature**: ./feature.md
**Status**: demoted/canceled — archived by /sdd-archiver; verbose specs pruned (recoverable via git history).

## Archive Synthesis — 2026-08-05 — /sdd-archiver

**What**: A proposal to train an LSTM/transformer/gradient-boosting model on OHLCV price+volume data and feed predictions into the analysis scoring engine as a synthetic signal source. Demoted at the idea stage, before draft/design/any code — no service was ever touched (product-spec.md:41-43).
**Why (irrecoverable rationale)**: Decisive reasoning, not derivable from any spec template: price-only ML backtest gains are a noise-overfitting artifact, not a tooling gap — "not a tooling problem that better hyperparameters can solve" (product-spec.md:21). The platform's existing signal pipeline already covers the text-intelligence dimension via Claude NLP on newsletters/emails, making a price model redundant and inferior on that axis (product-spec.md:23-24). Backtests would show false confidence because an LSTM implicitly learning average equity drift "looks good in backtests and fails in live trading when regime changes occur" (product-spec.md:26-27). Beyond the modeling objection, two further planks made the *operational* cost/benefit fail independently: (a) continuous retraining cadence, model versioning, inference latency budget, an OHLCV feature pipeline, GPU/CPU inference infra, and concept-drift monitoring would all become standing platform obligations "with no clear ROI" (product-spec.md:29-30); (b) a black-box model's outputs are opaque and undebuggable — it removes the ability to diagnose a bad trade, in contrast to the existing fully-auditable newsletter→extraction→source-weight→decay→score pipeline (product-spec.md:32-33).
**Rejected alternatives**: - Ship as an additive "AI-powered" enhancement to the formula engine — lost because apparent value (indicators service already sandboxed Python, so "plugging in a model appears additive") does not survive scrutiny of post-cost edge, operational burden, or auditability loss (product-spec.md:12-16, 20-33).
**Scars & gotchas**: none — feature never reached execute phase; only one brainstorming session (context.md:8-12).
**Permanent deviations**: n/a — nothing shipped.
**Cross-feature signal**: none recorded.
**Deferred follow-ons**: - Reconsider only if: genuine alternative data with ML-exploitable structure becomes available (order flow imbalance, satellite imagery, earnings-call sentiment at scale, limit order book depth); a dedicated research track validates a specific architecture via 6+ months live paper trading with walk-forward validation showing Sharpe > 1.0 net of costs; and even then, add as one weighted source in the source registry rather than replacing the existing scoring architecture (product-spec.md:37-39).
**Failure post-mortem**: - Root cause: idea rejected on structural grounds (no post-cost edge in price-only ML, plus unfunded ongoing operational cost and lost auditability) before any design or code investment — not an execution failure. Missed signal: none applicable; the demotion happened at the earliest possible point (idea stage), which is the desired outcome, not a missed one (feature.md:14, context.md:11-12).
**Ledger entries written**: insights.md (1), fails.md (0) — see the 2026-08-05 entries.
**Runtime-invariant recommendations (→ /context-constitution)**: - none
**Pruned artifacts**: product-spec.md — last present at f5abed5.
