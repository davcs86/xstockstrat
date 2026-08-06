# Context: broker-failure-simulator  (archived 2026-08-06)

**Feature**: ./feature.md
**Status**: demoted/canceled — archived by /sdd-archiver; verbose specs pruned (recoverable via git history).

## Archive Synthesis — 2026-08-06 — /sdd-archiver

**What**: A product spec was written (2026-08-04) for a scriptable broker-double to fault-inject Alpaca/IBKR failure modes for `xstockstrat-trading` integration tests, feeding features 104/105/109. It was demoted one hour later at feasibility re-check, before `/sdd-design` ever ran — no recon.md or design.md exist (feature.md:22, context.md:9-26).
**Why (irrecoverable rationale)**: Two grounded blockers killed it pre-design: (1) `.github/workflows/ci.yml` has no `services:`/DB container block, so Go/Python CI tests run against no real Postgres — building the simulator implies also standing up new CI infra (ephemeral PostgreSQL, a feature-105 requirement) rather than incremental test-writing (context.md:19-21); (2) there is no automated order-placement path in the platform today — every order is human-placed via the trader UI — so there's no automated execution path whose failure modes justify chaos-level fault injection (context.md:22-24).
**Rejected alternatives**: None recorded — the feature never reached the design-debate phase where alternatives get weighed.
**Scars & gotchas**: n/a — no execute session occurred; nothing was built.
**Permanent deviations**: none — nothing shipped.
**Cross-feature signal**: The demotion reused "the full method" from feature 102's feasibility re-check (context.md:19), establishing a repeatable pattern: story-generated features from external risk reviews get a fast feasibility gate — checking CI infra and prerequisite production behavior — immediately after `/sdd-story`, before investing in `/sdd-design`. This caught two related infra-test features (102, 103) at the same low cost point.
**Deferred follow-ons**:
- Revisit alongside 104 (trading-state-machine-invariants) and 105 (trading-crash-consistency) only if automated order execution is greenlit as its own feature — at that point the simulator becomes worth building (context.md:25-26).
- The open design question in product-spec.md:91-93 (simulator location: `services/xstockstrat-trading/internal/testutil/` vs. a separate test-support package) was never resolved and would need re-litigating if revived.
**Failure post-mortem**: Root cause: the story was generated straight from an external live-capital-safety risk review without first checking two prerequisite facts on the ground — CI has no DB service containers, and no automated order-placement path exists to protect. Missed signal: neither gap required design-phase discovery; both were visible from `.github/workflows/ci.yml` and the trading service's order-entry path at story time, i.e. checkable before committing to spec-ready.
**Ledger entries written**: insights.md (1), fails.md (1) — see the 2026-08-06 entries.
**Runtime-invariant recommendations (→ /context-constitution)**: - none
**Pruned artifacts**: product-spec.md — last present at f871138.
