# Product Spec: fix-offline-book-consistency

**Type**: bug
**GitHub Issue**: none. Defect report: `docs/reports/2026-10-21-offline-book-consistency-defect.md`
**Severity**: SEV-2
**Created**: 2026-10-21

---

## Problem Statement

Offline accounts (feature 240) have no broker poll to heal a missed write. Four best-effort paths therefore
turn transient failures, or bad input, into lasting wrong books.

- **D-47.** **Observed:** `portfolio_service.go:1117` consumes `account.positions.synced` with
  `ackAlways(s.processPositionSync)`. Write failures at `:1213-1231` are Warn-only, and the cursor advances.
  `:1129` does the same for `account.deregistered` (`DeleteOfflineRealized` Warn at `:1159-1161`). **Expected:**
  a failed write returns a retryable error, so the stream reconnects from the failed event. This is the fill
  consumer's `eventHandler` contract (`:171-200`). It is bounded, so a poison event parks rather than blocking
  the stream forever. The fill path has no such bound today, so design must add one.
- **D-48.** **Observed:** `offline_valuation.go:99-103` replaces a `GetOfflineStates` error with an empty map, so
  `TotalPnl` is unrealized-only and has no degraded marker. One bad `recent_fills` row
  (`portfolio_repo.go:521-523`) fails the batch for all of the user's offline accounts. **Expected:**
  `UNAVAILABLE`, or an explicit degraded valuation. Never a figure that looks complete.
- **D-49.** **Observed:** `trading.go:894` checks only `FilledQty < 0`, which NaN passes. `FilledAvgPrice` is never
  validated (`:924`). `deriveOfflineStatus` (`:863-871`) maps NaN/+Inf to `FILLED`. **Expected:** reject
  non-finite or negative `filled_qty`, and non-finite or negative `filled_avg_price` when filling, with
  `INVALID_ARGUMENT` before the load. Use one shared finite-value guard with `SnapshotOfflinePositions`
  (`:1156-1163`).
- **D-63.** **Observed:** `trading.go:951-954` logs a recompute/emit failure and returns success. **Expected:**
  retry the emit or return an error. Confirm is absolute, so a client re-confirm is safe.

## Reproduction Steps

1. D-49: `ConfirmOrder{filled_qty: NaN, filled_avg_price: 150}` on a 10-share offline order returns `FILLED`.
2. D-47: fail `UpsertOfflineRealized` once and deliver one offline sync. The event is acked and the realized row stays stale.
3. D-48: fail `GetOfflineStates` for an account with realized 500.00 and unrealized 100.00. `total_pnl` is 100.00 with no error.
4. D-63: fail the recompute after `UpsertOrder`. `ConfirmOrder` returns success and nothing is emitted.

## Root Cause Hypothesis

Feature 240 deliberately chose non-fatal handling: "a `GetOfflineStates` error is non-fatal (WARN, empty map)"
(`240-offline-account-full-pnl/context.md:399`). The offline sync consumer also stayed on `ackAlways` when
the fill path moved to a retrying handler. The finite-value guard covered `fees` only. Design must explicitly
supersede the 240 decision for D-48 and record that in this feature's context.md.

## Affected Services

- xstockstrat-portfolio (D-47, D-48)
- xstockstrat-trading (D-49, D-63)
- xstockstrat-ui (possibly: the Book page needs an error/degraded state for offline cards if D-48 changes the read contract)

## Fix Scope

- [x] No proto changes anticipated (D-48: prefer `UNAVAILABLE`. A wire-visible degraded marker would need a proto field, so design must decide and update this box)
- [x] No database migrations anticipated
- [ ] No config key changes anticipated (D-47's retry bound could become a config key. Design to decide whether it is a constant or a key)

(Update after investigation — remove or replace each item as needed)

## Acceptance Criteria

See `acceptance.feature` — the regression scenario(s) that must fail on the buggy behavior and pass
after the fix (Constitution **C-15**). Plus: existing tests pass; affected service(s) smoke-tested on
dev.

## Out of Scope

- Refactoring unrelated to the bug
- Performance improvements unrelated to the fix
- `ackAlways` on the broker-only `order.bracket_updated` / `account.balance.synced` consumers (`portfolio_service.go:1249`, `:1297`). A broker poll heals those.
- The first offline snapshot's `FOR UPDATE` locking and instance-count question (debt-radar NC-H, unconfirmed)
