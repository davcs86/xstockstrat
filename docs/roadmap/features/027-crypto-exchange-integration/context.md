# Context: crypto-exchange-integration  (archived 2026-08-05)

**Feature**: ./feature.md
**Status**: demoted/canceled — archived by /sdd-archiver; verbose specs pruned (recoverable via git history).

## Archive Synthesis — 2026-08-05 — /sdd-archiver

**What**: An idea to add Coinbase/Binance broker adapters alongside IBKR/Alpaca was demoted at the `idea` stage on 2026-05-26, before any draft, design, or code — the fastest possible SDD exit (feature.md:3-14).
**Why (irrecoverable rationale)**: The decisive framing was "this is a fork of the platform, not an extension" (feature.md:31) — every service touching session logic (marketdata, trading, chart panel, pre/post-market toggle feature 017) hard-assumes the equity trading-hours model, and retrofitting 24/7 crypto microstructure onto that would corrupt those assumptions rather than extend them (product-spec.md:20-31).
**Rejected alternatives**:
- Extend the existing equity platform with a new `BrokerType` enum value and crypto-specific adapter code — lost because the enum's apparent extensibility was cosmetic; the real blocker is session/liquidity/volume-integrity model mismatch, not a missing enum case (product-spec.md:15,20-31).
- Reuse the equity signal source registry (feature 008 newsletters/scrapers) for crypto — lost because crypto needs entirely different extraction targets (on-chain metrics, social sentiment, whale tracking, funding rates) that don't exist in the agent/ingest pipeline at all (product-spec.md:33-34).
**Scars & gotchas**: none — feature never reached execute; context.md has a single brainstorming-session entry only (context.md:8-12).
**Permanent deviations**: none — nothing was shipped.
**Cross-feature signal**: - Establishes a reusable demotion pattern for asset-class expansion ideas: check microstructure compatibility (trading hours/session model, liquidity concentration, volume-signal integrity, settlement, regulatory regime) against the existing equity-centric assumptions *before* drafting a spec — this is the first feature demoted purely on a domain-fork argument, at idea stage, without a product-spec review cycle.
**Deferred follow-ons**: Reconsider only if all of: (1) equity strategy profitable live for 6+ months, (2) crypto-native signal sources (on-chain/social) validated as agent-extractable, (3) built as a separate `xstockstrat-crypto` platform rather than retrofit, (4) regulatory counsel confirms compliance for the intended business model (product-spec.md:45-50).
**Failure post-mortem**: n/a — not a failure, a pre-build rejection; root "cause" was proactive scope discipline (product-spec.md:42-43: "dilutes focus before the equity strategy is validated"), not a missed signal.
**Ledger entries written**: insights.md (1), fails.md (0) — see the 2026-08-05 entries.
**Runtime-invariant recommendations (→ /context-constitution)**: - none
**Pruned artifacts**: product-spec.md — last present at f5abed5.
