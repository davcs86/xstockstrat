# Product Spec: fix-replace-tif-before-intent

**Type**: bug
**GitHub Issue**: none (Issues disabled) — report: `docs/reports/2026-11-16-replace-order-tif-validation-after-intent-claim-defect.md`
**Severity**: SEV-3
**Created**: 2026-11-16

---

## Problem Statement

**Observed.** `ReplaceOrder` (`services/xstockstrat-trading/internal/service/trading.go`) inserts its
dedup intent (`InsertIntent`) and marks the order's `IntentState` PENDING, and only then calls
`validateTIF`. When the requested time-in-force is not allowed for the order's broker (OPG or CLS on
IBKR), the handler returns `InvalidArgument` and leaves the intent PENDING. No broker call was made, but:

- the intent row and the order's in-memory `IntentState` stay PENDING;
- an identical replace is refused with `FailedPrecondition` "replace on order … is still pending";
- after the staleness threshold the row is reclaimed to UNKNOWN and `order_intent.reclaimed_unknown`
  is emitted for a request that never reached the broker;
- from then on the identical replace is refused permanently with "outcome is unknown; verify with the
  broker before retrying" (the UNKNOWN resolver matches by a derived client order id, which a replace
  never carries).

**Expected.** A time-in-force the broker does not allow is rejected before any intent is claimed, as
`PlaceOrder` does. The rejected request leaves no intent row, no PENDING mark on the order and no
reclaim event, and the caller can correct the request and retry.

## Functional Requirements

- **FR-1** — `ReplaceOrder` with a time-in-force the order's broker does not allow returns
  `InvalidArgument` and has no side effect: no intent row, the order's intent state unchanged, no
  broker call, no reclaim event.
- **FR-2** — A `ReplaceOrder` whose time-in-force is allowed (or absent) behaves as before: it claims
  exactly one intent, reaches the broker, and a content-identical retry collapses onto that intent
  (TRADING-6). The rate-limited replace path of feature 347 is unchanged (TRADING-8).

## Reproduction Steps

1. Have a NEW order on an IBKR account (IBKR allows neither OPG nor CLS).
2. Call `ReplaceOrder` for it with `time_in_force` OPG.
3. Observe `InvalidArgument`, and that the order now shows intent state PENDING.
4. Send the identical `ReplaceOrder` again: `FailedPrecondition` "still pending".
5. Wait past the staleness threshold (30 s at defaults) and send it again: the intent is reclaimed to
   UNKNOWN, `order_intent.reclaimed_unknown` is emitted, and every later identical request is refused
   with "outcome is unknown".

## Root Cause Hypothesis

Confirmed by reading `ReplaceOrder` on `main-dev@f61f76c`: `InsertIntent` and the PENDING mark precede
`validateTIF`, and the `validateTIF` error path returns without finalizing the intent. The TIF check
was added (feature 202) after the dedup claim instead of before it. The broker type that `validateTIF`
needs comes from `resolveAccount`, which already runs before the intent insert.

## Affected Services

- xstockstrat-trading (only). Consumer surface (C-14): internal — no UI, agent, proto or config surface changes.

## Fix Scope

- [x] No proto changes
- [x] No database migrations
- [x] No config key changes
- [x] No env var changes

## Acceptance Criteria

See `acceptance.feature` — the regression scenario(s) that must fail on the buggy behavior and pass
after the fix (Constitution **C-15**). Plus: the whole `xstockstrat-trading` test suite and lint pass.

## Out of Scope

- `CancelOrder` (carries no time-in-force).
- Repairing intent rows already stranded PENDING/UNKNOWN by this defect in a deployed database.
- Any change to intent-id derivation (TRADING-6), intent-table semantics, or `ReleasePendingIntent` (TRADING-8).
- Refactoring unrelated to the bug.
