# Context: options-trading-support  (archived 2026-08-05)

**Feature**: ./feature.md
**Status**: demoted/canceled — archived by /sdd-archiver; verbose specs pruned (recoverable via git history).

## Archive Synthesis — 2026-08-05 — /sdd-archiver

**What**: Idea to extend the equity trading service to submit single-leg and multi-leg options orders (calls/puts/spreads) via IBKR and Alpaca, driven by the existing directional equity signal pipeline. Never entered `draft` — demoted same-day at the `idea` stage during a brainstorming session, before any design or spec work (feature.md:3-4, product-spec.md:4).
**Why (irrecoverable rationale)**: Five compounding reasons captured in product-spec.md:19-34: (1) no options chain/bid-ask/IV/Greeks data infrastructure exists anywhere in marketdata, proto, or indicators; (2) no pricing model (Black-Scholes/binomial) or volatility estimate capability exists to judge fair value; (3) directional equity signals ("buy AAPL") structurally lack the expiry/strike/strategy-type/premium-budget parameters options execution needs — this is an information gap, not just a data gap; (4) IBKR's options `Contract` object, combo/multi-leg order submission, margin, assignment and exercise handling are a fully parallel broker-integration surface, not an extension of the equity path; (5) layering leverage/theta/vega risk onto a not-yet-validated equity strategy was judged premature risk-stacking (product-spec.md:33-34).
**Rejected alternatives**: - Retrofitting the existing equity trading service/proto types for options — rejected outright; product-spec.md:41 explicitly calls for a *separate* `options-trading` service designed from scratch with options-native types if ever revisited, not a retrofit.
**Scars & gotchas**: - None — feature was demoted before any execute-phase or post-launch session; context.md contains only the single 2026-05-26 brainstorming entry (context.md:8-12).
**Permanent deviations**: none — nothing was ever built.
**Cross-feature signal**: none observed (no other feature/session references this idea).
**Deferred follow-ons**: - Reconsider only once all four conditions hold (product-spec.md:37-41): (a) equity strategy has 12+ months live track record with Sharpe > 1.0 net of costs; (b) signal sources produce options-specific parameters (expiry, strike, strategy type), not just direction; (c) a volatility-surface feed is integrated into marketdata; (d) build as a new from-scratch `options-trading` service, not a retrofit of the equity trading service.
**Failure post-mortem**: - Root cause: idea-stage scope was recognized as a different platform domain (options data model, pricing, broker semantics) rather than an additive feature on top of the equity stack — caught immediately at brainstorming, before any spec/design investment, so there was no late or missed signal; the demotion itself *was* the early-catch outcome.
**Ledger entries written**: insights.md (1), fails.md (0) — see the 2026-08-05 entries.
**Runtime-invariant recommendations (→ /context-constitution)**: - none
**Pruned artifacts**: product-spec.md — last present at f5abed5.
