# Context: broker-failure-simulator

**Feature**: `docs/roadmap/features/103-broker-failure-simulator/feature.md`
**Product Spec**: `docs/roadmap/features/103-broker-failure-simulator/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/103-broker-failure-simulator/implementation-spec.md`

---

## Session 2026-08-04T00:00:00Z — sdd-story

- Created feature.md (status: draft), product-spec.md, context.md from an external live-capital
  safety risk review. P1 item 6 ("deterministic broker simulator and fault-injection harness").
- No upstream dependency (needed for credible verification of everything else). Feeds 104
  (trading-state-machine-invariants), 105 (trading-crash-consistency), and 109 (live-trading-game-day)
  as their fault-injection source.

## Session 2026-08-04T01:00:00Z — feasibility re-check (demoted)

- Feasibility re-check (see 102's context.md for the full method) found: CI (`.github/workflows/ci.yml`)
  has no `services:`/database container block at all — Go/Python tests run with no real Postgres, so
  a "run these tests against ephemeral PostgreSQL... in CI" harness (feature 105's requirement) is new
  CI infrastructure, not incremental test-writing. And there is no automated order-placement path today
  (see 102's note) whose failure modes need chaos-level fault injection to prove safe — every order is
  human-placed via the trader UI.
- Demoted to `demoted/canceled`. Revisit alongside 104/105 only if automated execution is greenlit as
  its own feature; at that point this simulator becomes worth its cost.
