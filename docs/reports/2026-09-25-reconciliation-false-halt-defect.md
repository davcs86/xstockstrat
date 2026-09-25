# Defect: Reconciliation false halt on legitimately filled order

**Recorded**: 2026-09-25
**Severity**: SEV-2
**Impact type**: spurious-account-halt
**Environment**: dev (main-dev) — reproduced on a staging paper account
**Affected service(s)**: xstockstrat-trading, xstockstrat-portfolio
**Config-only fix possible**: no

## Observed

A paper account placed and filled a platform order (`BUY 10 AMAT @ 427.9740`, `order.filled`
emitted, fill alert shown). Moments later the broker-state reconciliation poller raised a CRITICAL
`quantity_discrepancy (AMAT) — expected 0.0000, broker reported 10.0000` and auto-halted the
account (`HALT_SOURCE_RECONCILIATION`). The halt blocks `PlaceOrder`/`ReplaceOrder` and clears only
via a manual DB edit.

The finding's identifier is a **symbol** (`AMAT`), not an order UUID, which pins it to the
**position-side** comparison in `reconcileTick` (`orderID := bp.Symbol`), not the order-side path
(which passes an order UUID). So: broker holds AMAT=10 (from the platform's own fill), but
`xstockstrat-portfolio.ListPositions` returned 0 for that account/symbol, and the poller treated the
zero projection as authoritative evidence of a foreign broker position.

## Expected

A position that the platform's **own** filled orders fully account for must never trip a
reconciliation halt, even while the portfolio projection is briefly behind. The position-side check
should halt only on a broker quantity the platform's own orders cannot explain (e.g. an order placed
directly on the broker dashboard). The portfolio projection must also not be transiently zeroed by a
non-authoritative (empty) broker position snapshot.

## Reproduction

1. On a paper account, place and fill a platform market order (e.g. `BUY 10 AMAT`).
2. Cause the portfolio projection for that (account, symbol) to read 0 while the broker holds the
   position, via either mechanism:
   - (a) the fill→`order.filled`→portfolio `ConsumeOrderFills` fold lags past the reconcile grace
     window (`1 + trading.reconciliation.grace_ticks`, default 2 ticks × 60 s); or
   - (b) a successful-but-empty `account.positions.synced` from trading's `syncPositions` causes
     portfolio `processPositionSync` → `DeletePositionsNotInSync(account, user, [])` to delete the
     order-fill-derived row, leaving the projection at 0 for up to a full
     `trading.position_sync.interval_ms` (default 5 min).
3. On the next reconcile tick, `reconcileTick`'s own `GetPositions` returns AMAT=10 while
   `ListPositions` returns 0 → `quantity_discrepancy` past grace → account halted.

## Evidence

`services/xstockstrat-trading/internal/service/trading.go:1920`
> for _, bp := range brokerPositions {

`services/xstockstrat-trading/internal/service/trading.go:1925`
> s.emitReconciliationFinding(ctx, accountID, mismatchClassQuantityDiscrepancy, bp.Symbol, platformQty, bp.Quantity)

`services/xstockstrat-portfolio/internal/service/portfolio_service.go:999`
> if err := s.repo.DeletePositionsNotInSync(ctx, sync.AccountID, userID, presentSymbols); err != nil {

`services/xstockstrat-trading/internal/service/trading.go:2198`
> s.emitLedgerEvent(ctx, "account.positions.synced", ... "positions": posEntries)   // emitted even when posEntries is empty

## Root cause hypothesis

The position-side reconciliation check trusts `xstockstrat-portfolio.ListPositions` as authoritative
"what the platform placed", with no DB-grounding against `trading.orders` — unlike the order-side
check, which was already hardened against exactly this false-halt class via
`KnownBrokerOrderIDs`. Compounding it, `processPositionSync` deletes order-fill-derived position rows
on an empty/non-authoritative broker snapshot, which can drive the projection to 0 well past the
grace window.

## Confidence

high
