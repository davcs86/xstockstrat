# Defect: Offline-account books drift or report wrong P&L when sync, state reads or confirm validation fail

**Recorded**: 2026-10-21
**Severity**: SEV-2
**Impact type**: wrong-pnl-reported
**Environment**: dev (main-dev) @ a053b0e
**Affected service(s)**: xstockstrat-portfolio, xstockstrat-trading
**Config-only fix possible**: no
**Source**: repo-surveyor debt-radar scan (`docs/repo-surveyor/debt-radar-findings.md` @ 4535695), findings D-47, D-48, D-49, D-63. All four were re-verified against main-dev @ a053b0e. Every site was introduced or extended by feature 240 (`offline-account-full-pnl`, launched).

## Observed

### D-47 — Portfolio `processPositionSync` is `ackAlways`, so offline sync write failures advance the cursor

The `account.positions.synced` consumer is wrapped in `ackAlways`. If `UpsertPositionFromSync`,
`DeletePositionsNotInSync` or `UpsertOfflineRealized` fails, the failure is only `slog.Warn`ed and the stream
cursor still advances. A broker account heals on its next poll. An offline account is re-emitted only on the
next `ConfirmOrder` or snapshot, so one DB blip leaves its positions, realized P&L and `recent_fills` stale
with no end date. `processAccountDeregistered` is also `ackAlways`: a failed `DeleteOfflineRealized` keeps a
deregistered offline account listed.

### D-48 — Offline valuation swallows a failed `GetOfflineStates` and reports unrealized-only P&L as complete

When `GetOfflineStates` fails, `valueOffline` logs "offline state unavailable" and continues with an empty map.
Realized P&L, fees and Day P&L then drop out silently, and `TotalPnl` becomes unrealized-only with no degraded
marker. A single undecodable `recent_fills` JSONB row fails the whole batch, so every offline account of that
user reports the wrong total. This conflicts with the service's own rule never to fabricate a figure.

### D-49 — `ConfirmOrder` accepts NaN/Inf `filled_qty` and any `filled_avg_price`

`ConfirmOrder` guards `filled_qty` only with `< 0`, and NaN compares false. It does not check `filled_avg_price`
at all. `fees` is checked for NaN/Inf next to it. `deriveOfflineStatus(NaN, qty)` falls through to `FILLED`,
and so does `+Inf`. A negative or NaN price is also accepted. The poisoned fill is persisted, folded into the
offline net positions and realized P&L, and emitted to portfolio. Only a direct DB edit can repair it. The
sibling `SnapshotOfflinePositions` rejects non-finite values.

### D-63 — Trading `ConfirmOrder` returns success when the offline recompute/emit fails

After the fill is persisted, a failed `recomputeAndEmitOfflinePositions` is only logged, and the confirmed
order is returned as success. Portfolio never receives `account.positions.synced` for that confirm, and nothing
heals the gap until the next confirm or snapshot. This compounds D-47.

## Expected

- **D-47:** A failed offline sync write is retried before the cursor advances. The fill consumer already uses a
  retryable-handler contract: return an error and the stream reconnects from the failed event
  (`portfolio_service.go:171-200`). The upserts are absolute, so a retry is idempotent. A poison event must not
  block the stream forever, so the retry is bounded and then parked. The same applies to a failed deregistration
  delete.
- **D-48:** When offline state cannot be read, the read returns `UNAVAILABLE` or a marked-degraded valuation. It never
  returns an unrealized-only `TotalPnl` presented as complete.
- **D-49:** `ConfirmOrder` rejects a non-finite or negative `filled_qty`, and a non-finite or negative
  `filled_avg_price` when `filled_qty > 0`, with `INVALID_ARGUMENT` before the order is loaded. Nothing is written.
- **D-63:** When the recompute/emit fails, `ConfirmOrder` either retries the emit or returns an error so the client
  re-confirms. Confirm is absolute, so a re-confirm is safe. It never reports a success that portfolio will not see.

## Reproduction

1. **D-49:** Create an offline order for 10 AAPL, then call `ConfirmOrder{order_id, filled_qty: NaN, filled_avg_price: 150}`.
   The call returns the order with status `FILLED`. Repeat with `filled_qty: 10, filled_avg_price: -5`. That is accepted too.
2. **D-47:** In a portfolio service test, make `UpsertOfflineRealized` return an error and deliver one offline
   `account.positions.synced` event. The handler acks, the cursor advances, and `offline_account_realized` keeps the old value.
3. **D-48:** In a portfolio service test, make `GetOfflineStates` return an error for a user with an offline account
   with realized P&L 500.00 and unrealized 100.00. `ListPortfolios` returns `total_pnl` 100.00 with no error and no degraded flag.
4. **D-63:** In a trading service test, make the recompute query fail after `UpsertOrder` succeeds. `ConfirmOrder`
   returns the order with no error, and no `account.positions.synced` is emitted.

## Evidence

### D-47

`services/xstockstrat-portfolio/internal/service/portfolio_service.go:1117`
> s.consumeEventStream(ctx, "position sync", "account.positions.synced", ackAlways(s.processPositionSync))

`services/xstockstrat-portfolio/internal/service/portfolio_service.go:1213-1231` (Warn-only at `:1214`, `:1220`, `:1230`)
> slog.Warn("upsert offline realized failed", "account_id", sync.AccountID, "error", err)

`services/xstockstrat-portfolio/internal/service/portfolio_service.go:1129`, `:1159-1161`
> slog.Warn("deregister: delete offline realized failed", "account_id", payload.AccountID, "error", err)

### D-48

`services/xstockstrat-portfolio/internal/service/offline_valuation.go:99-103`
> states, err := s.repo.GetOfflineStates(ctx, middleware.FromContext(ctx).UserID, ids)
> if err != nil {
> slog.Warn("offline state unavailable", "accounts", len(ids), "error", err)
> states = map[string]repository.OfflineState{}

`services/xstockstrat-portfolio/internal/repository/portfolio_repo.go:521-523`
> return nil, fmt.Errorf("decode recent fills for %s: %w", id, err)

### D-49

`services/xstockstrat-trading/internal/service/trading.go:894-899`
> if req.FilledQty < 0 {
> ...
> if req.Fees != nil && (*req.Fees < 0 || math.IsNaN(*req.Fees) || math.IsInf(*req.Fees, 0)) {

`services/xstockstrat-trading/internal/service/trading.go:922-924`, `:863-871` (`deriveOfflineStatus`: `default: FILLED`)
> order.FilledAvgPrice = req.FilledAvgPrice

`services/xstockstrat-trading/internal/service/trading.go:1156-1163` (sibling validation in `SnapshotOfflinePositions`)
> case math.IsInf(pos.Qty, 0) || math.IsNaN(pos.Qty):

### D-63

`services/xstockstrat-trading/internal/service/trading.go:951-954`
> if err := s.recomputeAndEmitOfflinePositions(ctx, order.AccountId, order.UserId); err != nil {
> slog.Warn("ConfirmOrder: recompute failed; positions.synced not emitted",

## Root cause hypothesis

Feature 240 chose best-effort, non-fatal handling on these paths. Its context log records
"a `GetOfflineStates` error is non-fatal (WARN, empty map)" (`240-offline-account-full-pnl/context.md:399`), and the
offline sync consumer kept `ackAlways` when the fill consumer moved to a retrying handler. Offline accounts have no
broker poll to heal a missed write, so best-effort here means permanent drift. The `ConfirmOrder` finite-value
guard was written for `fees` only.

## Confidence

high
