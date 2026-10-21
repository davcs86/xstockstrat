# Defect: Trading discards UpsertOrder and ReclaimOrphanIntent results, so order-state loss and intent reclaims go unlogged and unaudited

**Recorded**: 2026-10-21
**Severity**: SEV-2
**Impact type**: order-state-loss-unlogged
**Environment**: dev (main-dev) @ a053b0e
**Affected service(s)**: xstockstrat-trading
**Config-only fix possible**: no
**Source**: repo-surveyor debt-radar scan (`docs/repo-surveyor/debt-radar-findings.md` @ 4535695), findings D-04, D-62. Re-verified against main-dev @ a053b0e.

## Observed

### D-04 — `UpsertOrder` errors discarded on terminal/uncertain paths

Four writes of order state to `trading.orders` discard their error with `_ = s.repo.UpsertOrder(...)`:
the broker-call timeout path (uncertain outcome), the broker-reject path (`REJECTED`), the
`CancelOrder` final write, and the `ReplaceOrder` final write. When the DB write fails, nothing is
logged and the RPC proceeds as if the state was persisted. The in-memory order and the ledger event
say one thing, while `trading.orders` keeps the prior state. Reconciliation reads `trading.orders`, so
a lost timeout, reject, cancel or replace can cause false reconciliation mismatches and halts.

### D-62 — three discarded `ReclaimOrphanIntent` results on the reactive path

When `PlaceOrder`, `CancelOrder` or `ReplaceOrder` sees a stale PENDING intent for the caller's
`client_order_id`, it calls `_, _, _ = s.orderIntentRepo.ReclaimOrphanIntent(...)` and discards all
three results. A reclaim error is never logged, and a successful reclaim emits no
`order_intent.reclaimed_unknown` ledger event. The background sweeper path emits that event for the
same transition, so the audit trail depends on which path reclaimed the intent. The surveyor rated
this finding one tier lower on its own; it is grouped here because it is the same "trading discards
an order-state write result" theme in the same file.

## Expected

- D-04: every failed `UpsertOrder` on these paths is logged at error level with the order id, user and
  target status (and, where design decides, surfaced to the caller or retried), so state loss is
  visible.
- D-62: the reactive reclaim logs a failed reclaim and, on a successful reclaim, emits the same
  `order_intent.reclaimed_unknown` event the sweeper emits (with a trigger value naming the reactive
  path), so every reclaim is audited regardless of which path performed it.

## Reproduction

1. D-04: in a unit test, wire `TradingService` with a repo fake whose `UpsertOrder` returns an error
   and a broker fake whose `PlaceOrder` returns `context.DeadlineExceeded` (or a reject error). Call
   `PlaceOrder`. Observe: no error log, no metric, the RPC returns as if the state was written. Repeat
   for `CancelOrder` and `ReplaceOrder` with a failing `UpsertOrder`.
2. D-62: seed an intent row in PENDING with `UpdatedAt` older than the stale threshold. Call
   `PlaceOrder` with the same `client_order_id`. Observe: the RPC returns `FailedPrecondition` "still
   pending", the intent is reclaimed, and the ledger fake records no `order_intent.reclaimed_unknown`
   event. Run the sweeper over the same row instead: the event is emitted.

## Evidence

### D-04 — `UpsertOrder` errors discarded on terminal/uncertain paths

`services/xstockstrat-trading/internal/service/trading.go:688` (timeout / uncertain outcome)
> _ = s.repo.UpsertOrder(context.Background(), order)

`services/xstockstrat-trading/internal/service/trading.go:703` (broker reject → `REJECTED`)
> _ = s.repo.UpsertOrder(context.Background(), order)

`services/xstockstrat-trading/internal/service/trading.go:1367` (`CancelOrder` final write)
> _ = s.repo.UpsertOrder(ctx, order)

`services/xstockstrat-trading/internal/service/trading.go:1550` (`ReplaceOrder` final write)
> _ = s.repo.UpsertOrder(ctx, order)

Lines are unchanged from the scan.

### D-62 — three discarded `ReclaimOrphanIntent` results on the reactive path

`services/xstockstrat-trading/internal/service/trading.go:603` (`PlaceOrder`; also `:1301` `CancelOrder`, `:1498` `ReplaceOrder`)
> // Best-effort — the caller need not distinguish "not yet stale" from "just reclaimed".
> _, _, _ = s.orderIntentRepo.ReclaimOrphanIntent(ctx, intentID, existing.UpdatedAt.Add(staleThreshold(s.cfgW)))

`services/xstockstrat-trading/internal/service/order_intent.go:144-157` (sweeper path, for contrast)
> reclaimed, out, err := s.orderIntentRepo.ReclaimOrphanIntent(ctx, rec.IntentID, staleBefore)
> if err != nil { slog.Warn("order intent sweep: reclaim failed", ...) }
> s.emitLedgerEvent(ctx, "order_intent.reclaimed_unknown", ...

The surrounding intent-lookup `switch` (`classifyIntentLookup`) is copied four times
(`trading.go:586`, `:789`, `:1285`, `:1482`), so a fix lands in three or four places unless the switch is
extracted.

## Root cause hypothesis

Writes on error and terminal paths were treated as best-effort and the results discarded. The inline
"best-effort" comment at `:602` covers the caller's response, not the missing log and audit event. The
duplicated intent-lookup switch spread the discard to three sites.

## Confidence

high
