# Context: realtime-tick-streaming  (archived 2026-08-05)

**Feature**: ./feature.md
**Status**: demoted/canceled — archived by /sdd-archiver; verbose specs pruned (recoverable via git history).

## Archive Synthesis — 2026-08-05 — /sdd-archiver

**What**: An idea to replace the trader UI's `GetBars` polling (feature 014) with a WebSocket/SSE tick stream, demoted at the idea stage before any draft, design, or code (feature.md:3-14). No design.md/recon.md/implementation-spec.md were ever produced — this feature never left brainstorming.
**Why (irrecoverable rationale)**: The decisive framing was that xstockstrat is a strategy-driven system where the analysis/indicators services make trading decisions from aggregated signals, not a human watching candles — so no UI action changes between a 30s poll and a 200ms push (product-spec.md:20-21, feature.md:31).
**Rejected alternatives**:
- Building custom `StreamBars`/`StreamTicks` proto RPCs + WebSocket infra in xstockstrat-ui — rejected as a "full multi-week feature for a visual improvement with zero decision value" once backpressure, reconnect/gap-detection, and per-tab memory pressure were weighed (product-spec.md:23-33).
- Multiplexing the Alpaca paper-trading feed inside xstockstrat-marketdata to serve multiple tabs/users — rejected specifically because that feed has rate limits and connection constraints that make multi-consumer fan-out operationally costly for no trading benefit; this vendor-specific limit (not just the generic reconnect/backpressure concerns) is the underlying reason the reconsideration note prefers offloading to a dedicated streaming service or a third-party charting library with built-in Alpaca WebSocket support over building custom fan-out logic in-house (product-spec.md:38-39, 45).
**Scars & gotchas**: - none — feature never reached execute; no build-time evidence exists.
**Permanent deviations**: - none — nothing shipped.
**Cross-feature signal**: - The stated re-entry condition is itself the reusable signal: only reconsider tick streaming if the platform pivots to active manual day-trading or multi-trader live position monitoring, and even then prefer a dedicated streaming service or third-party charting lib over custom infra — because the constrained, rate-limited Alpaca feed makes in-house multi-consumer streaming a bad fit regardless of UI need (product-spec.md:38-39, 41-45, context.md:12).
**Deferred follow-ons**: - none stated beyond the reconsideration conditions above.
**Failure post-mortem**: - Not a build failure — a pre-build value/cost triage caught disproportionate engineering cost (new streaming protos, cross-language stub propagation, backpressure/reconnect logic, plus Alpaca feed rate/connection limits that complicate multi-tab fan-out) against a UI-only latency improvement with no decision-making benefit, before any spec-ready gate was crossed (product-spec.md:18-39).
**Ledger entries written**: insights.md (1), fails.md (0) — see the 2026-08-05 entries.
**Runtime-invariant recommendations (→ /context-constitution)**: - none
**Pruned artifacts**: product-spec.md — last present at f5abed5.
