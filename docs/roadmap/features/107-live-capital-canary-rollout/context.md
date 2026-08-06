# Context: live-capital-canary-rollout  (archived 2026-08-06)

**Feature**: ./feature.md
**Status**: demoted/canceled — archived by /sdd-archiver; verbose specs pruned (recoverable via git history).

## Archive Synthesis — 2026-08-06 — /sdd-archiver

**What**: A product spec (never designed or implemented — no recon.md/design.md/implementation-spec.md were ever produced) for staged live-capital rollout limits (shadow → paper → single-symbol → single-strategy → notional cap → order-count/window → gradual expansion), sourced wholesale from an external live-capital-safety risk review's P1 item 10 (context.md:9-16).
**Why (irrecoverable rationale)**: Demoted within the same day at feasibility re-check, before /sdd-design ran, because its entire premise assumes an automated strategy-to-order execution path that does not exist in this codebase (context.md:18-26).
**Rejected alternatives**:
none recorded — canceled before any design debate occurred.

**Scars & gotchas**: none — no execute-phase session ever ran.

**Permanent deviations**: none — nothing shipped.
**Scars & gotchas**: none
**Permanent deviations**: none
**Cross-feature signal**:
- Feature 048-live-strategy-alert-engine is confirmed alert-only ("a human still acts") and no code path calls PlaceOrder outside the human-driven trader UI (context.md:22-24) — durable fact for future proposals assuming automated execution exists.
- 107 was deliberately sequenced last among a batch of P0 items from the same external review (100, 101, 102, 030, 023) because its promotion evidence depends on those existing cleanly (product-spec.md:31-35, context.md:13-16) — worth a feasibility spot-check on that batch, though no evidence here says they share this flaw.
**Deferred follow-ons**: Revive "nearly as-specced" if/when an automated strategy-to-order execution feature is proposed and approved (context.md:27-30).
**Failure post-mortem**: Root cause: /sdd-story generated a full product spec directly from an external review's checklist item without verifying the target capability (automated order placement) existed or was roadmapped. Missed signal: the spec names hard-dependency features (100/101/102/030/023) but never checked whether the thing those controls would gate was present; caught only at a dedicated "feasibility re-check" one session after story creation (context.md:9-30).
**Ledger entries written**: insights.md (0), fails.md (1) — see the 2026-08-06 entries.
**Runtime-invariant recommendations (→ /context-constitution)**: - none
**Pruned artifacts**: product-spec.md — last present at f871138.
