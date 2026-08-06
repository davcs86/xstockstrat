# Context: multi-broker-smart-routing  (archived 2026-08-05)

**Feature**: ./feature.md
**Status**: demoted/canceled — archived by /sdd-archiver; verbose specs pruned (recoverable via git history).

## Archive Synthesis — 2026-08-05 — /sdd-archiver

**What**: Idea to maintain simultaneous live IBKR + Alpaca connections, compare pre-trade price estimates per order, and route dynamically to the better quote, aggregating positions across both. Demoted at idea stage — never entered draft, no design/spec/code exists (feature.md:3-4, product-spec.md:4).
**Why (irrecoverable rationale)**: Rejected because the expected retail-scale benefit (product-spec.md:21: ~$1/trade price improvement, ~$200/year across 200 trades) is dwarfed by the engineering and operational cost of a dual-broker routing system — this cost/benefit comparison is the analyst's own reasoning, not derivable from any code.
**Rejected alternatives**:
- Full dynamic per-order price-comparison routing across both brokers — lost because it requires real-time quote infra on two live sockets simultaneously, doubling connection-failure/rate-limit/stale-quote surface area (product-spec.md:23-24).
- Treating IBKR's own SmartRouting as insufficient — rejected because IBKR SmartRouting already gives institutional-grade venue routing internally, so a second broker only adds a routing hop, not an improvement (product-spec.md:29-30).
- The quote-comparison premise itself was judged flawed independent of cost/benefit: Alpaca routes retail orders through market makers (payment-for-order-flow) rather than IBKR's direct market access, so the two brokers' pre-trade quotes are "not apples-to-apples" — the routing decision's declared "winner" quote may not actually translate into a better real fill (product-spec.md:32-33).
**Scars & gotchas**: none — feature never reached execute; context.md has only the single brainstorming session (context.md:8-12).
**Permanent deviations**: n/a — nothing shipped.
**Cross-feature signal**: none.
**Deferred follow-ons**: - Reconsider only if (a) position sizes reach institutional scale (10,000+ shares/order), or (b) a specific documented slippage problem on the current single-broker setup is identified that a second broker demonstrably fixes — and even then, prefer static order-type-level routing (e.g. all limit orders to IBKR, all market orders to Alpaca) over dynamic per-order comparison (product-spec.md:37-39).
**Failure post-mortem**: Not a failure — a pre-emptive cost/benefit rejection at idea stage. Root cause of the idea's non-viability: retail order sizes make per-trade price-improvement economically trivial, the routing premise itself compares two structurally incomparable execution models (PFOF vs. direct market access), and dual-broker live connections plus position aggregation across two ledgers with separate margin/stop-loss semantics are each individually complex (product-spec.md:20-33). No "missed signal" — the idea was screened out before any commitment.
**Ledger entries written**: insights.md (1), fails.md (0) — see the 2026-08-05 entries.
**Runtime-invariant recommendations (→ /context-constitution)**: - none
**Pruned artifacts**: product-spec.md — last present at f5abed5.
