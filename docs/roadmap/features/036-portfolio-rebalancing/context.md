# Context: portfolio-rebalancing  (archived 2026-08-05)

**Feature**: ./feature.md
**Status**: demoted/canceled — archived by /sdd-archiver; verbose specs pruned (recoverable via git history).

## Archive Synthesis — 2026-08-05 — /sdd-archiver

**What**: Idea was demoted at the idea stage, before any draft/design/spec work — feature.md:3-4, feature.md:14. No code, proto, or config was ever touched; the entire artifact is a demotion rationale rather than a build record.
**Why (irrecoverable rationale)**: The system has no static "target weight" for any stock — allocation is zero absent a signal and signal-confidence-sized when present, so there is no drift to correct, only signal conviction to follow (product-spec.md:21). Rebalancing back to a target would mechanically trim winners (positions that grew because a still-valid signal is working) and add to losers (positions with no supporting signal) — the inverse of what a signal-driven strategy should do (product-spec.md:23-24).
**Rejected alternatives**:
- Equal-weight rebalancing across N open positions — lost because the portfolio is almost never at "target N" (positions open/close on signal timing), so equal-weighting 1-2 open positions just reduces to "hold what you have," which position sizing already approximates (product-spec.md:27).
- Benchmark/sector-weight rebalancing (e.g. match S&P 500 sector weights) — lost because it imports irrelevant benchmark risk: being underweight a sector with no signals is correct, not a deviation to fix (product-spec.md:28).
**Scars & gotchas**: none — demoted pre-implementation, no build phase occurred (feature.md:4, context.md:11).
**Permanent deviations**: none — nothing shipped.
**Cross-feature signal**: Feature 023 (position-sizing-engine)'s `max_concentration_pct` cap was identified as the correct, signal-aware substitute for the concentration-control goal rebalancing was meant to serve — it caps outsized positions without forcing trades that contradict signal conviction (product-spec.md:30-31, context.md:12). Future ideas aimed at "controlling position concentration" should be checked against feature 023 before proposing a new mechanism.
**Deferred follow-ons**: Reconsider only if (a) the platform becomes a multi-strategy manager with per-strategy capital buckets where intra-bucket rebalancing is meaningful, or (b) a long-only "core holdings" layer separate from the signal-driven layer is added — and even then, implement as an explicitly separate "rebalancing mode" module, distinct from the signal-driven execution path (product-spec.md:35-37).
**Failure post-mortem**: Root cause was a category error caught before any spec/design work: rebalancing is a passive-allocation concept imported by analogy from robo-advisors/index funds (product-spec.md:14) without checking it against this system's actual allocation model (signal-conviction-sized, not target-weight-based). The missed signal was never actually missed — it was caught at brainstorming/idea stage, which is the intended cheap-rejection point.
**Ledger entries written**: insights.md (1), fails.md (0) — see the 2026-08-05 entries.
**Runtime-invariant recommendations (→ /context-constitution)**: - none
**Pruned artifacts**: product-spec.md — last present at f5abed5.
