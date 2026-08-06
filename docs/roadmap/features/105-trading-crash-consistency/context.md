# Context: trading-crash-consistency  (archived 2026-08-06)

**Feature**: ./feature.md
**Status**: demoted/canceled — archived by /sdd-archiver; verbose specs pruned (recoverable via git history).

## Archive Synthesis — 2026-08-06 — /sdd-archiver

**What**: A product-spec-only feature (never reached `/sdd-design`) proposing a CI crash-injection test suite across trading/portfolio/ledger, canceled one day after creation at a feasibility re-check before any design or implementation work began (context.md:16-28).
**Why (irrecoverable rationale)**: CI has zero ephemeral-Postgres/service-container infrastructure today, so this suite would have required building new CI infrastructure, not just new tests, to cover a risk (mid-automated-order crash) that isn't live yet — the platform has no automated order caller exercising most of the lifecycle this suite targeted (context.md:18-20, 24).
**Rejected alternatives**:
- Building the full crash-injection suite as scoped (place/replace/cancel/close/emergency-flatten) — lost because several of those lifecycle points have no real caller yet, making the investment premature relative to actual exposure (context.md:23-24).
- Treating this as equally urgent to human-placed-order crash risk — rejected: the human-placed-order surface is real (single `instance_count: 1` per service, no HA, so a redeploy can interrupt an in-flight request) but much narrower than the full automated lifecycle this suite was scoped for (context.md:21-23).
**Scars & gotchas**: none — canceled before any execute-phase session.
**Permanent deviations**: none — nothing shipped.
**Cross-feature signal**: - Crash-safety for today's actual risk surface (human-placed orders) is judged better served by keeping feature 101's rescoped idempotent-intent model correct than by a dedicated crash-injection CI suite (context.md:26-28). Feature 105 was a hard dependent of 101 and 103, both of which were also demoted (context.md:13-14, 25) — a cluster of three features died together on the same CI-infrastructure-readiness gap.
**Deferred follow-ons**: - Revisit a crash-consistency suite once there is more than one order-lifecycle caller to protect and CI gains ephemeral-Postgres/service-container support (context.md:24-28).
**Failure post-mortem**: - Root cause: the product spec (written from an external live-capital-safety risk review, feature.md:14) scoped crash-injection coverage for the full order/protection lifecycle without checking CI's actual infrastructure capability or whether automated callers existed for most of that lifecycle. Missed signal: the CI ephemeral-Postgres/service-container gap was already known from feature 103's context.md (context.md:18) at story-creation time — a feasibility check against that context before writing the product spec would have caught this same-day instead of after.
**Ledger entries written**: insights.md (0), fails.md (1) — see the 2026-08-06 entries.
**Runtime-invariant recommendations (→ /context-constitution)**: - none
**Pruned artifacts**: product-spec.md — last present at f871138.
