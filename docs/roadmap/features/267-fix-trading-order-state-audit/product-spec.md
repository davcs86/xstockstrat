# Product Spec: fix-trading-order-state-audit

**Type**: bug
**GitHub Issue**: none. Defect report: `docs/reports/2026-10-21-trading-order-state-audit-defect.md`
**Severity**: SEV-2
**Created**: 2026-10-21

---

## Problem Statement

**Observed.**

- **D-04.** `services/xstockstrat-trading/internal/service/trading.go:688` (broker timeout, uncertain
  outcome), `:703` (broker reject), `:1367` (`CancelOrder` final write) and `:1550` (`ReplaceOrder`
  final write) call `_ = s.repo.UpsertOrder(...)`. A failed write is silent; `trading.orders` keeps the
  prior state while the in-memory order and ledger event move on. Reconciliation reads
  `trading.orders`, so the loss can produce false mismatches and halts.
- **D-62.** `trading.go:603` (`PlaceOrder`), `:1301` (`CancelOrder`) and `:1498` (`ReplaceOrder`) call
  `_, _, _ = s.orderIntentRepo.ReclaimOrphanIntent(...)` on a stale PENDING intent. A reclaim error is
  never logged and a successful reclaim emits no `order_intent.reclaimed_unknown` event, whereas the
  sweeper (`order_intent.go:144-157`) logs the error and emits the event.

**Expected.** Every failed `UpsertOrder` on these four paths is logged at error level with order id,
user and target status. A reactive reclaim logs a failure and, on success, emits
`order_intent.reclaimed_unknown` with a trigger value that names the reactive path, matching the sweeper.

## Reproduction Steps

1. D-04: `TradingService` with a repo fake whose `UpsertOrder` errors and a broker fake that returns
   `context.DeadlineExceeded` (or a reject). Call `PlaceOrder`; no error is logged. Repeat with
   `CancelOrder` / `ReplaceOrder`.
2. D-62: seed a PENDING intent older than the stale threshold; call `PlaceOrder` with its
   `client_order_id`. The intent is reclaimed but the ledger fake records no
   `order_intent.reclaimed_unknown`. The sweeper over the same row does emit it.

## Root Cause Hypothesis

Error and terminal-path writes were treated as best-effort and their results discarded. The intent-lookup
`switch` is copied four times (`trading.go:586`, `:789`, `:1285`, `:1482`), which spread the discarded
reclaim to three sites.

## Affected Services

- xstockstrat-trading (fix site)
- xstockstrat-ledger (receives a reused event type from a new emit site; no change expected)

## Fix Scope

- [x] No proto changes anticipated
- [x] No database migrations anticipated
- [x] No config key changes anticipated

(Update after investigation — remove or replace each item as needed)

Design forks: log-only versus surfacing the `UpsertOrder` failure to the caller (the broker side
effect has already happened on these paths); whether to extract the four-way intent-lookup switch in
the same change (DRY guard rail) or keep the fix to three call sites.

## Acceptance Criteria

See `acceptance.feature` — the regression scenario(s) that must fail on the buggy behavior and pass
after the fix (Constitution **C-15**). Plus: existing tests pass; affected service(s) smoke-tested on
dev.

## Out of Scope

- Refactoring unrelated to the bug
- Performance improvements unrelated to the fix
- `ConfirmOrder` offline recompute/emit failure (debt-radar D-63) and `CancelOrder` fail-open semantics (debt-radar NC-C)
