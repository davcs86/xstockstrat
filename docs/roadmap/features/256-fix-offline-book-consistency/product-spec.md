# Product Spec: fix-offline-book-consistency

**Type**: bug
**GitHub Issue**: none. Defect report: `docs/reports/2026-10-21-offline-book-consistency-defect.md`
**Severity**: SEV-2
**Created**: 2026-10-21

---

## Problem Statement

**Persona:** a trader who keeps a manually-tracked offline account (`BROKER_TYPE_OFFLINE`, feature 240) and
reads its realized and unrealized P&L on the Book page or through the agent.

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

## Functional Requirements

- **FR-1 (D-47).** When portfolio fails to persist an offline `account.positions.synced` event
  (`UpsertOfflineRealized` or the position writes at `portfolio_service.go:1213-1231`), it does not advance the
  event cursor past that event. The event is redelivered and applied once the write succeeds.
- **FR-2 (D-47).** When `DeleteOfflineRealized` fails while portfolio consumes `account.deregistered`, the event
  is redelivered until the delete succeeds. The deregistered account's realized row never survives the event.
- **FR-3 (D-47).** The redelivery in FR-1 and FR-2 is bounded. An event that keeps failing past the bound is
  parked (logged at error level with its event id) and the cursor advances, so later events on the stream are
  still consumed.
- **FR-4 (D-48).** When offline state cannot be read, every portfolio read that runs the shared `valueRead` step
  (`GetPortfolio`, `GetPosition`, `ListPositions`, `ListPortfolios`) returns `UNAVAILABLE` or marks the affected
  offline valuation as degraded. None of them returns an offline `total_pnl` or position P&L that omits realized
  P&L while looking complete. All four reads behave the same way.
- **FR-5 (D-49).** `ConfirmOrder` rejects a non-finite or negative `filled_qty`, and a non-finite or negative
  `filled_avg_price` on a fill, with `INVALID_ARGUMENT` before it loads or changes the order. The check uses one
  finite-value guard shared with `SnapshotOfflinePositions`.
- **FR-6 (D-63).** `ConfirmOrder` does not report success unless `account.positions.synced` is published for the
  order's account. If the recompute or emit fails, it either retries until the event is published or returns an
  error. A repeat `ConfirmOrder` with the same values then succeeds and publishes the event.
- **FR-7 (non-regression).** Valid fills keep today's status derivation in `deriveOfflineStatus`
  (`trading.go:863-871`): a partial fill stays `PARTIALLY_FILLED` and a full fill becomes `FILLED`.

## Trading-Domain Scope

- Only `BROKER_TYPE_OFFLINE` accounts are in scope. `ALPACA` and `IBKR` accounts are unaffected: their
  `ConfirmOrder` path, sync consumers and valuation are unchanged.
- Behavior is the same in paper (staging) and live (production). No change depends on the environment.
- No order type changes and no new env vars.

## Affected Services

- xstockstrat-portfolio (D-47, D-48)
- xstockstrat-trading (D-49, D-63)
- xstockstrat-ui (D-48 read contract on the trader Book page, D-49/D-63 confirm errors in the fill dialog)

## Consumer Surface(s)

_Constitution **C-14**._

- [x] **UI**: `xstockstrat-ui` segment `/trader`.
  - Book → Portfolio page (`/trader/portfolio`, `usePortfolios` / `usePositions` in `hooks/usePortfolio.ts`), plus
    the positions pages (`/trader/positions`, `/trader/positions/[symbol]`) and the dashboard `PortfolioPanel.tsx`:
    an offline account shows an error or degraded state when portfolio returns `UNAVAILABLE` or a degraded
    valuation (FR-4). It never shows unrealized-only P&L as the account total.
  - Confirm-fill dialog (`ConfirmFillDialog.tsx` via `useConfirmOrder`): shows the `INVALID_ARGUMENT` rejection
    (FR-5) and the confirm failure (FR-6) as an error the trader can retry, not as a success.
- [x] **Agent**: `xstockstrat-agent` tools `get_positions` / `get_positions_by_account_id` (`ListPositions`)
  surface `UNAVAILABLE` or the degraded marker (FR-4). `manage_offline_account` (confirm operation,
  `ConfirmOrder`) surfaces the FR-5 and FR-6 errors. Design confirms whether the agent's existing error mapping
  already covers these, so that no agent code change is needed.
- [ ] **None**

## Fix Scope

- [x] No database migrations anticipated
- [x] No config key changes. Decision (2026-10-21): the FR-3 retry bound and the FR-6 emit retry are code
  constants, not config keys.
- [x] Proto changes: additive degraded markers `Portfolio.offline_state_unavailable = 17` and
  `Position.offline_state_unavailable = 26` (design, operator gate r3); they go through the proto approval gate.

## Open Questions

- [x] **OQ-1 (FR-4). Resolved at /sdd-design (operator gate r3, 2026-10-22): wire-visible degraded markers, not
  `UNAVAILABLE`; reads stay successful.** Original question: Return `UNAVAILABLE`, or add a wire-visible
  degraded marker? `UNAVAILABLE` needs no proto change and is preferred. A degraded marker would be an
  additive field in `packages/proto/portfolio/v1/portfolio.proto` and must go through the proto approval gate
  (`docs/runbooks/proto-versioning.md`). Design records the decision and updates the Fix Scope box.
- [x] **OQ-2 (FR-3). Resolved at /sdd-design (operator gate r3, 2026-10-22): SQLSTATE-classified park rule
  (22/23 park after 5 attempts; transient never parks; unclassified keeps a bounded fallback).** Original question: The bound value and the park mechanism (for
  example, skip after N attempts with an error log). The bound is a constant either way.

## Acceptance Criteria

See `acceptance.feature`: the regression scenarios, tagged `@FR-n`, must fail on the buggy behavior and pass
after the fix (Constitution **C-15**). In addition, existing tests pass and the affected services are smoke-tested
on dev.

## Out of Scope

- Refactoring unrelated to the bug
- Performance improvements unrelated to the fix
- `ackAlways` on the broker-only `order.bracket_updated` / `account.balance.synced` consumers (`portfolio_service.go:1249`, `:1297`). A broker poll heals those.
- The first offline snapshot's `FOR UPDATE` locking and instance-count question (debt-radar NC-H, unconfirmed)
