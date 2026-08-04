# Product Spec: live-trading-game-day

**Created**: 2026-08-04

---

## Problem Statement

Even with every P0/P1 safety control built and unit/integration tested, nobody has verified an operator
can actually execute the recovery process under pressure — halt trading, determine broker truth,
cancel/flatten/protect, restore state, and safely resume. Without a rehearsed runbook and a scheduled
exercise, the first real incident is also the first drill.

## User Story

As a platform operator, I want written, rehearsed emergency-operations runbooks exercised on a
schedule using the fault-injection harness, so that the operator response to a live-capital incident is
tested before it is needed for real.

## Functional Requirements

FR-1. Create runbooks for: unknown order submission outcome; unprotected position; broker outage;
stale or corrupt market data; incorrect position quantity; duplicate order; database unavailable;
config stream unavailable; notification outage; compromised API credentials; unexpected live strategy
activation.

FR-2. Run a game day quarterly, or before any material live-capital expansion (e.g. a feature-107
canary-stage promotion), using the feature-103 broker-failure simulator to inject the scenario.

FR-3. Each exercise requires the operator to: halt trading (feature 100); determine broker truth
(feature 102); cancel working orders; flatten or protect positions (feature 030/100); restore platform
state; produce an incident timeline; verify safe resumption.

FR-4. Record each game day's outcome (what worked, what didn't, runbook corrections) — this is
operational/process documentation, not application code.

## Out of Scope

- Building any new application capability — this feature's deliverable is the runbook documents plus
  the exercised process; any code gap discovered during a game day (e.g. a missing halt-reason surface)
  is filed as its own bug/feature, not folded into this one.

## Affected Services

- None directly — this is a documentation/process feature exercising existing services (`xstockstrat-
  trading`, `xstockstrat-portfolio`, `xstockstrat-config`, `xstockstrat-notify`) and the feature-103
  simulator. If the design phase determines dedicated harness tooling is needed beyond 103, that is
  scoped as an explicit addition at `/sdd-design`, not assumed here.

## Consumer Surface(s)

_Constitution **C-14**._

- [ ] **UI**
- [ ] **Agent**
- [x] **None** — operational runbooks and a scheduled exercise process; no new end-user-reachable
  capability. (This is the legitimate "None" case per C-14: the capability is a documented human
  process, not a system surface.)

## Proto Contract Changes

- [x] No proto changes required.

## Config Key Changes

- [x] No new config keys.

## Database Changes

- [x] No schema changes.

## Feature Workflow Notes

Branch to create: `feature/live-trading-game-day` (branch from `main-dev`)
Approval gates required (per docs/runbooks/feature-workflow.md):
- [x] 1 service owner approval (non-breaking proto or config change)
- [ ] 2 service owners + platform lead (breaking proto change)
- [ ] DBA review + service owner (schema migration)

## Acceptance Criteria

1. A runbook exists for every scenario in FR-1.
2. At least one full game day has been run using the feature-103 simulator, producing an incident
   timeline and a list of runbook corrections.
3. The operator demonstrably completes the FR-3 sequence (halt → determine truth → cancel/flatten/
   protect → restore → timeline → verify resumption) during the exercise.

## Open Questions

- [ ] Hard-depends on feature 103 (simulator) for fault injection, and benefits from 100/102/030
  existing first (nothing to halt/reconcile/protect otherwise) — correctly last in the P0/P1 suggested
  order ("Complete operational workflow").
- [ ] Where do game-day runbooks live — `docs/runbooks/` (alongside `bug-triage.md`) or a dedicated
  `docs/runbooks/game-day/` subdirectory? Flag for `/sdd-design`.
