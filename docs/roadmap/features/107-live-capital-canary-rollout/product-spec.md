# Product Spec: live-capital-canary-rollout

**Created**: 2026-08-04

---

## Problem Statement

There is currently no staged path between paper trading and unrestricted live trading. Flipping a
strategy or the whole account straight from paper to full live exposure means every prior safety
control gets its first real-capital test simultaneously, with no bounded blast radius and no defined
rollback trigger.

## User Story

As a platform operator, I want staged live-capital limits — shadow, paper, single-symbol live,
single-strategy live, minimal notional, limited order count/window — each with explicit promotion and
rollback criteria, so live capital exposure only expands after the platform has demonstrated safety at
the smaller scale.

## Functional Requirements

FR-1. Define staged limits, in order: shadow decisions only (no orders placed); paper trading; live
trading restricted to one symbol; live trading restricted to one strategy; a minimal fixed notional
cap; a limited daily order count; a limited trading window (time-of-day); gradual expansion after a
clean observation period at each stage.

FR-2. Each stage has explicit, checkable promotion criteria and explicit, checkable rollback criteria
— not a subjective operator judgment call alone.

FR-3. Promotion evidence required before advancing a stage: zero unexplained reconciliation mismatches
(feature 102) over the observation period; zero duplicate intents (feature 101); protection established
within its SLO for every fill (feature 030); correct realized and unrealized P&L; no unresolved
critical alerts; a successful emergency-halt exercise (feature 100); a successful restart during an
open paper position (feature 105's crash-consistency proof, exercised live).

FR-4. The current stage and its limits are enforced inside `xstockstrat-trading` at the same
enforcement point as feature 100's halt gate (a canary-stage violation behaves like an exposure-
increasing-order rejection, not a UI-only guard).

FR-5. Rollback from any stage to the previous one (or to `HALTED` via feature 100) is a single explicit
operator action, auditable the same way a halt transition is (feature 100 FR-6).

## Out of Scope

- The individual safety controls whose clean operation is *evidence* for promotion (101, 102, 030,
  100, 105) — this feature only defines the staged limits and the promotion/rollback gate that
  consumes their signals.

## Affected Services

- `xstockstrat-trading` — stage state, enforcement of per-stage limits, rollback.
- `xstockstrat-config` — stage definitions and per-stage limit values as config, not hardcoded.
- `xstockstrat-ui` — canary-stage control panel and current-stage display.

## Consumer Surface(s)

_Constitution **C-14**._

- [x] **UI** — `xstockstrat-ui` segment `/trader` (or `/config-ui`, TBD at `/sdd-design`): a new canary
  rollout control panel showing current stage, promotion-criteria checklist status, and a
  promote/rollback action — a new page/section, registered in `PLATFORM_SUBNAV` per **C-10(a)**.
- [ ] **Agent**
- [ ] **None**

## Proto Contract Changes

- New `CanaryStage` enum with `_UNSPECIFIED = 0` sentinel, and RPC(s) to read current stage /
  promotion-criteria status and to promote/rollback (exact shape TBD at `/sdd-spec`).

## Config Key Changes

- Per-stage limits config-driven, e.g. `trading.canary.stage`, `trading.canary.max_daily_orders`,
  `trading.canary.max_notional_usd`, `trading.canary.allowed_symbols`,
  `trading.canary.trading_window_start`/`_end` — exact keys finalized at `/sdd-spec`.

## Database Changes

- New migration in `services/xstockstrat-trading/migrations/` for a canary-stage-history table
  (stage, entered-at, promoted-by, evidence snapshot).

## Feature Workflow Notes

Branch to create: `feature/live-capital-canary-rollout` (branch from `main-dev`)
Approval gates required (per docs/runbooks/feature-workflow.md):
- [x] 1 service owner approval (non-breaking proto or config change)
- [ ] 2 service owners + platform lead (breaking proto change)
- [x] DBA review + service owner (schema migration)

## Acceptance Criteria

1. Every stage in FR-1 is independently enforced (an attempt to exceed the current stage's limit is
   rejected inside `xstockstrat-trading`, not just hidden in the UI).
2. Promotion to the next stage is blocked unless every FR-3 evidence item is checked/verified.
3. Rollback is a single auditable operator action.
4. The platform never transitions directly from paper to unrestricted live — every intermediate stage
   is actually traversable and enforced.

## Open Questions

- [ ] This feature is explicitly last in the suggested P0 execution order ("All P0 controls") — confirm
  at `/sdd-design` time which of 100/101/102/030 have actually landed before scoping the first
  implementation slice, since promotion evidence (FR-3) depends on all of them existing.
- [ ] Canary UI home: `/trader` (operational) vs `/config-ui` (governance-style control)? Flag for
  `/sdd-design`.
