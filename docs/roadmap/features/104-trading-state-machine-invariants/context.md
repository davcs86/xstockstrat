# Context: trading-state-machine-invariants  (archived 2026-08-06)

**Feature**: ./feature.md
**Status**: demoted/canceled — archived by /sdd-archiver; verbose specs pruned (recoverable via git history).

## Archive Synthesis — 2026-08-06 — /sdd-archiver

**What**: A product spec (from an external live-capital-safety risk review, P1 item 7) proposed property-based/model-based tests over the trading order lifecycle, but the feature never reached `/sdd-design` — it was demoted at the feasibility re-check that follows `/sdd-story` (context.md Session 2026-08-04T01:00:00Z).
**Why (irrecoverable rationale)**: Two blockers found only by checking the actual codebase state, not visible from the spec: (1) no property-based/model-based testing library is used anywhere in the Go services — adopting one would be new tooling, not just new tests; (2) the order lifecycle it would harden is entirely human-initiated today — feature 102's context.md found the only `PlaceOrder` caller is the trader UI, so there's no autonomous scheduler/agent driving order flow whose invariants warrant this depth of proof yet (context.md:19-24).
**Rejected alternatives**: none recorded — demoted before design debate produced alternatives.
**Scars & gotchas**: none — feature never entered execute.
**Permanent deviations**: none — nothing shipped.
**Cross-feature signal**: - Depends on feature 103 (broker-failure-simulator), which was also demoted (context.md:25) — both stemmed from the same external risk-review batch and both hit the "infra proposed ahead of the capability that would need it" pattern: hardening tests/simulators for an autonomous order-execution path that doesn't exist yet.
**Deferred follow-ons**: - Revisit if/when automated (unattended, multi-caller) order execution exists and the lifecycle is complex enough to warrant property-based coverage over hand-written cases (context.md:26-27).
**Failure post-mortem**: - Root cause: spec-writing (from an external review list) preceded a feasibility/codebase check. Missed signal: the "Open Questions" in product-spec.md already flagged the testing-library gap as something to survey at `/sdd-design` time (product-spec.md:86-88) — the feasibility re-check caught it one step earlier, before design, saving a wasted design debate.
**Ledger entries written**: insights.md (1), fails.md (1) — see the 2026-08-06 entries.
**Runtime-invariant recommendations (→ /context-constitution)**: - none
**Pruned artifacts**: product-spec.md — last present at f871138.
