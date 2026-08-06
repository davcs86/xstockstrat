# Context: market-data-freshness-and-quality-gate  (archived 2026-08-06)

**Feature**: ./feature.md
**Status**: demoted/canceled — archived by /sdd-archiver; verbose specs pruned (recoverable via git history).

## Archive Synthesis — 2026-08-06 — /sdd-archiver

**What**: A product spec proposed a standalone market-data quality gate (new proto rejection-reason enum, new config namespace, new DB snapshot table) to block exposure-increasing orders on stale/missing/implausible quotes. It never reached design or implementation — canceled the session after story creation, before `/sdd-design` ran (context.md:9-32; no recon.md/design.md/implementation-spec.md were ever produced).
**Why (irrecoverable rationale)**: A feasibility re-check found `xstockstrat-trading`'s existing `checkPortfolioRisk` (`services/xstockstrat-trading/internal/service/trading.go:1288`) already reads a live quote/equity value at order time and is the natural place for a cheap price-sanity guard, once feature 023's real sizing engine replaces today's advisory-only check — making a full standalone service-level gate disproportionate to the actual near-term need (context.md:20-26).
**Rejected alternatives**: - Standalone service-level gate with its own proto surface, config namespace, and DB snapshot table — lost because it was disproportionate: the cheap, high-value subset (reject on missing/stale/zero/negative/NaN price) fits inside an already-existing order-time check rather than requiring new infrastructure (context.md:20-26).
**Scars & gotchas**: none — feature never entered execute phase.
**Permanent deviations**: n/a — nothing shipped under this feature.
**Cross-feature signal**: - The cheap subset was explicitly folded into `023-position-sizing-engine`'s scope via a recommendation recorded in that feature's own context.md (context.md:26-29) — demonstrates the pattern of demoting a standalone feature by redirecting its minimal viable value into an existing in-flight feature's context.md, rather than deleting the need outright.
**Deferred follow-ons**: - Spread limits, corporate-action detection, independent-reference price divergence, and persisted per-decision market-data snapshots remain legitimate future work, deferred as premature until 023 (position-sizing engine) and 030 land first (context.md:29-32).
**Failure post-mortem**: - Root cause: the product spec was generated directly from an external live-capital-safety risk review (P1 item 9) without first checking whether an existing enforcement point (`checkPortfolioRisk`) already covered the cheap, high-value part of the ask — scoping a full new service surface before verifying that. Missed signal: no recon (`/sdd-design` Phase 0) had run yet when the standalone scope was drafted; the feasibility re-check that caught this happened only one hour later, before further investment (context.md:9-26).
**Ledger entries written**: insights.md (1), fails.md (1) — see the 2026-08-06 entries.
**Runtime-invariant recommendations (→ /context-constitution)**: - none
**Pruned artifacts**: product-spec.md — last present at f871138.
