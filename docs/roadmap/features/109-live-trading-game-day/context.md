# Context: live-trading-game-day  (archived 2026-08-06)

**Feature**: ./feature.md
**Status**: demoted/canceled — archived by /sdd-archiver; verbose specs pruned (recoverable via git history).

## Archive Synthesis — 2026-08-06 — /sdd-archiver

**What**: Product spec called for quarterly-or-pre-expansion emergency-operations game days (halt → determine broker truth → cancel/flatten/protect → restore → timeline → verify resumption) exercised via the feature-103 broker-failure simulator. Never reached design phase — killed at the draft→demoted feasibility re-check the same day it was created (context.md Session 2026-08-04T01:00:00Z).
**Why (irrecoverable rationale)**: A recurring, scheduled ceremony implies an on-call rotation / multiple operators to run and rotate through it; this repo has exactly one human maintainer (verified via `git log` author list: one human + dependabot/CI bots, no `CODEOWNERS`) — a team-sized process doesn't fit a solo-maintained project (context.md:20-22).
**Rejected alternatives**: - Keep it as a scheduled SDD feature with its own number — lost because the "quarterly game day" framing presumes team staffing that doesn't exist; formalizing it as a feature would encode an unworkable operating model (context.md:20-24).
**Scars & gotchas**: none — feature never reached execute; killed at feasibility re-check before implementation-spec existed.
**Permanent deviations**: none — no design.md/implementation-spec.md were ever produced; nothing shipped to diverge from spec.
**Cross-feature signal**:
- Its fault-injection dependency, feature-103, was itself demoted (context.md:19), removing this feature's mechanism for exercising failure scenarios — a second, independent reason the game-day-as-scheduled-program shape no longer had a foundation.
- The salvageable core was redirected out of the SDD feature system entirely: written runbooks for the FR-1 failure scenarios, walked manually before any live-capital increase, to be added directly under `docs/runbooks/` once features 100/030 land — sized as a one-person checklist, not a scheduled program (context.md:23-26). A future agent should look for those runbooks in `docs/runbooks/` rather than expecting this feature number to resurface.
**Deferred follow-ons**: - Manual pre-flight checklist covering the FR-1 scenario list (unknown order outcome, unprotected position, broker outage, stale/corrupt data, duplicate order, DB/config/notify outage, compromised credentials, unexpected live strategy activation) — to be written directly into `docs/runbooks/` once features 100 (halt) and 030 (flatten/protect) exist, no feature number needed.
**Failure post-mortem**: - Root cause: the product spec was generated from an external risk-review checklist item without checking it against this project's actual staffing model (solo maintainer, no on-call rotation). Missed signal: the spec's own "Open Questions" flagged the feature-103 hard-dependency and runbook-location ambiguity but never questioned whether "quarterly game day" was operationally executable by one person — that check only happened one hour later, at explicit feasibility re-check, before any review/design cycle spent effort on it.
**Ledger entries written**: insights.md (1), fails.md (0) — see the 2026-08-06 entries.
**Runtime-invariant recommendations (→ /context-constitution)**: - none
**Pruned artifacts**: product-spec.md — last present at f871138.
