# Context: stop-loss-bracket-orders

**Feature**: `docs/roadmap/features/030-stop-loss-bracket-orders/feature.md`
**Product Spec**: `docs/roadmap/features/030-stop-loss-bracket-orders/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/030-stop-loss-bracket-orders/implementation-spec.md`

---

## Session 2026-05-26T00:00:00Z — sdd-story

- Created feature.md (status: draft), product-spec.md, context.md from brainstorming session.
- Feature number assigned: 030.
- Hard dependency on feature 023 (position-sizing-engine) — must be launched first.
- Proto changes: additive fields only on Position message (stop_order_id, take_profit_order_id). Non-breaking.
- DB migration: two nullable columns on portfolio positions table.
- Key safety requirement: bracket submission failure must emit CRITICAL alert — not silently logged.
- Two open questions for impl-spec: IBKR OCA library support, and blocking vs. best-effort cancellation on signal-driven close.

## Session 2026-08-04T00:00:00Z — sdd-story (priority amendment)

- An external live-capital safety risk review recommended this feature be promoted to `P0` and
  implemented immediately after — or together with — position sizing (feature 023). Priority
  annotation added to `feature.md`; no lifecycle status change (still `draft`, pending `/sdd-review`).
- The review's key invariant: **no open live position may remain unprotected beyond a tightly bounded
  protection window** (example given: 5 seconds after fill confirmation). Recorded here as
  **additional requirements to fold in at the next `/sdd-design`/`/sdd-spec` pass** — several are
  genuine design forks, not silently added to the Functional Requirements above:
  - Define the maximum unprotected interval explicitly (config-driven, not hardcoded).
  - If protection cannot be established within that window, immediately attempt to flatten the
    position; if flattening also fails, transition the account to `HALTED` (new **feature 100**) and
    page the operator — the current spec's FR-6 ("emit CRITICAL alert") does not flatten or halt.
  - Verify the protective order by **reading it back from the broker** — submission acknowledgment
    alone (current FR-3/FR-4 semantics) is not sufficient.
  - Reconcile stop quantity after partial fills (current spec assumes a single fill event).
  - Replace protection safely when an entry order fills incrementally.
  - Prevent a close order and a stop order from both selling the same position (a race the current
    OQ-2 "blocking vs. best-effort cancellation" question touches but does not fully resolve).
  - Treat cancel-and-replace as an explicit **state machine**, not two independent API calls (current
    spec has no cancel-and-replace state machine at all).
  - Persist broker order relationships and every lifecycle transition (current spec only persists the
    two order IDs — FR-5 — not a transition history).
  - New test requirements: entry-fill-then-crash-before-stop-submission; broker-accepted-but-client-
    timeout; partial fills; duplicate fill events; stale cancellation responses; OCA races. These
    depend on the new **feature 103 (broker-failure-simulator)** to test deterministically.
- This feature's dependency on 023 is unchanged (still hard: consumes `ComputePositionSize` output).
  It is now also a direct input to **feature 100**'s "unprotected live position" automatic halt
  trigger.
- New backlog features created from the same review: 100–109 (see
  `docs/roadmap/features/100-account-trading-halt-and-kill-switch/` through
  `109-live-trading-game-day/`).

## Session 2026-08-05T00:00:00Z — sdd-review product-spec (2 rounds)

- Round 1 FAIL: missing `## Consumer Surface(s)` section (C-14) — the sole blocker. Fixed: added the
  section (CRITICAL alert via the existing `AlertStream.tsx`; bracket order IDs on the position detail
  view), plus addressed several advisory warnings in the same pass — flagged the missing
  `trading.proto` OCA/bracket fields, the `Position.stop_price` reconciliation need, the partial-fill
  gap, and OrderType scope, all as named `/sdd-design` questions rather than silently resolved.
- Round 2: **PASS WITH WARNINGS** (3 advisory warnings: FR-1's unbounded "immediately" vs. the P0
  safety review's max-unprotected-interval requirement, no AC for the IBKR-paper bracket path, no AC
  for partial-fill reconciliation). Status: `draft` → `spec-ready`.
- Warnings carried forward for `/sdd-design`: bound FR-1's protection window explicitly
  (config-driven); confirm IBKR paper-mode OCA support; add partial-fill reconciliation as a named
  design decision, not just a deferred Open Question.
