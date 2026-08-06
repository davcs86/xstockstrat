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

## Session 2026-08-06T00:00:00Z — sdd-design (full mode, 5 rounds — hard cap)

- Phase 0 Recon: wrote `recon.md` (services: trading, notify, portfolio, ui, config). Found a hard
  sequencing blocker recon itself flagged: 023 (`ComputePositionSize`) is only `design-approved`, not
  implemented — 030's design must ground against 023's *planned* statement order, not real line
  numbers. Confirmed neither Alpaca nor IBKR clients support bracket/OCA orders today (greenfield),
  no cancel-and-replace state machine exists anywhere, and found a live migration-number race between
  023 and 030 (both want config migration `011`).
- Round 1: adversary found the proposed bracket-price gate (`order.StopPrice > 0`) collides with
  STOP/STOP_LIMIT entries' own real broker-trigger price — the exact "convenient-but-wrong field"
  trap just logged for 023 — and that the poller-based hook site can't access the in-process computed
  stop-price at all. Also found the proposed synchronous `SetPositionBracket` portfolio RPC was
  unnecessary (trading already has everything needed in its own state).
- **User directive**: address all 6 of the P0 safety review's recorded requirements (2026-08-04
  session, above) with concrete decisions in round 2, not deferrals.
- Round 2: resolved round 1's issues and all 6 P0 items via an explicit, persisted bracket state
  machine (`NONE→SUBMITTING→PENDING_VERIFY→ACTIVE→CANCELING→CANCELED/FAILED`), a bounded protection
  window with broker-readback verification, a flatten-then-halt fallback avoiding a circular
  dependency on feature 100 (100's own product-spec confirms `EMERGENCY_FLATTEN` depends on 030, not
  the reverse), and full lifecycle persistence via a new table + ledger events. Adversary found the
  proposed `SetConfig` halt-fallback would return `PERMISSION_DENIED` in exactly the unattended
  scenario it exists for (trading's background poller carries no propagated ADMIN scope), and that
  the IBKR resize-window protection gap was self-flagged but not actually fixed.
- **User directive**: "run round 3."
- Round 3: fixed the `SetConfig` authz gap by making the halt trading-local (never a config write)
  and re-arming the protection budget at every transition, not just the initial one. Adversary found
  the fix's OWN `submitOrder` extraction silently dropped the existing approval-required order path
  (a real regression), `ReplaceOrder` was left ungated by the new halt, and the shared-ticker watchdog
  could head-of-line-block every other account's protection check during exactly a broker-wide outage.
- Round 4: fixed all three — `submitOrder` now threads `requiresApproval` explicitly, preserving the
  approval branch verbatim; `ReplaceOrder` blocks outright when halted (no reduce-only precedent
  exists in this service); the watchdog scan is bounded to 2s and spawns per-account flatten
  goroutines instead of blocking the shared tick. Adopted a production-flag recommendation: seed
  `bracket_orders_enabled=false` in prod until feature 103 or a documented manual verification.
  Adversary found the halt state was still only in-memory — a routine redeploy (not a hypothetical
  multi-replica scenario) would silently un-halt an account whose failure condition might still be
  present.
- Round 5 (hard cap): persisted the halt flag on `broker_accounts` following the exact
  `credential_status` precedent (migration + boot hydration), and explicitly stated `CancelOrder` is
  never gated (the operator's sole de-risk tool while halted). Final adversary pass: **APPROVE WITH
  NOTED OPEN RISKS** (no Floor breach) — found the proposed dual-write mutex ordering was actually
  incorrect (would hold a lock across an unbounded DB round-trip) and supplied the correct fix
  (set-map-then-release-then-bounded-write, no rollback on DB failure); also flagged an unaddressed
  overlap with feature 100's own halt mechanism. Both folded directly into `design.md` at final
  write-up, plus an explicit coexistence note naming this as a forward dependency for feature 100's
  own `/sdd-design`.
- Chosen approach: persisted bracket state machine in `xstockstrat-trading`, dedicated
  `bracket_stop_price` field (never `StopPrice`), Alpaca-atomic/IBKR-follow-up broker split, re-armed
  protection-window watchdog with per-account goroutines, shared `submitOrder` helper for flatten,
  persisted per-account halt gate on `PlaceOrder`/`ReplaceOrder` (not `CancelOrder`), production flag
  seeded `false` pending feature 103. Rejected: config-write halt fallback, synchronous portfolio RPC,
  reduce-only `ReplaceOrder` carve-out, two separate protection-window keys.
- Constitution rules touched: C-01, C-05, C-07, C-08/P-06, C-10, C-11, C-14, P-01, P-02, P-03, P-04,
  F-06, F-11 (all honored — see design.md § Constitution Rules Touched). No Floor breach across any
  of the 5 rounds.
- Status: `spec-ready` → `design-approved`.
