# Implementation Spec: fix-reconciliation-false-halt

Consumes `design.md` (design-approved) + `recon.md`. Steps are surgical; no proto, migration, or
config change. Executed on `claude/flow-investigation-4blorq` (harness-pinned; SDD `/sdd-execute`
per-step branches not used — see context.md).

Conventions: `GOWORK=off` for per-service Go commands. Red-before-green for the regression tests
(`P-06`).

---

## Step 1 — trading repo: `NetFilledQtyBySymbol` (grounding query)

**File**: `services/xstockstrat-trading/internal/repository/trading_repo.go`
Add a method on `*TradingRepo` (place next to `KnownBrokerOrderIDs`, the sibling grounding query):

```go
// NetFilledQtyBySymbol returns the platform's own net filled quantity per symbol for an account,
// summed from trading.orders (BUY +filled_qty, SELL -filled_qty). Deduped to the latest row per
// order_id (the hypertable PK is (order_id, created_at) and an order may have >1 row) so a single
// order is never double-counted. Empty input returns empty, no query.
func (r *TradingRepo) NetFilledQtyBySymbol(ctx context.Context, accountID string, symbols []string) (map[string]float64, error)
```

Query (mirrors `GetOrder`'s latest-row semantics):
```sql
SELECT symbol, SUM(CASE WHEN side='sell' THEN -filled_qty ELSE filled_qty END)
FROM (
  SELECT DISTINCT ON (order_id) order_id, symbol, side, filled_qty
  FROM trading.orders
  WHERE account_id=$1 AND symbol = ANY($2)
  ORDER BY order_id, created_at DESC
) latest
GROUP BY symbol
```
Use `r.db.Query` (the `dbQuerier` seam). `side` values are `sideStr` output (`'buy'`/`'sell'`,
`trading_repo.go:371`).

**Traces**: @AC-1, @AC-2.

## Step 2 — trading service: `positionQtyLookup` seam + wiring

**File**: `services/xstockstrat-trading/internal/service/trading.go`
1. Add interface next to `brokerOrderIDLookup` (`:57-61`):
   ```go
   // positionQtyLookup is the seam reconcileTick uses to DB-ground its position-side quantity check
   // against trading.orders. *repository.TradingRepo satisfies it; tests inject a fake.
   type positionQtyLookup interface {
       NetFilledQtyBySymbol(ctx context.Context, accountID string, symbols []string) (map[string]float64, error)
   }
   ```
2. Add field to `TradingService` next to `reconcileOrderLookup` (`:110-112`):
   `reconcilePositionLookup positionQtyLookup`.
3. Wire in `NewTradingService` (`:198`): `reconcilePositionLookup: repo,`.

**Traces**: @AC-1, @AC-2, @AC-3.

## Step 3 — trading service: DB-ground the position-side comparison

**File**: `services/xstockstrat-trading/internal/service/trading.go`, `reconcileTick` position block
(`:1916-1930`). Replace the bare `platformQty != bp.Quantity` halt decision with:

- Collect diverging symbols (`platformBySymbol[bp.Symbol] != bp.Quantity`).
- If any, one call `s.reconcilePositionLookup.NetFilledQtyBySymbol(ctx, accountID, divergingSymbols)`.
  - On error: `slog.Warn` and **skip the position-side halt decisions this tick** (candidates
    untouched) — fall through to `resolveUnknownIntents` (do **not** `continue` past it). Fail-safe,
    mirrors the order-side error path (`:1864-1885`).
- For each broker position:
  - `platformQty == bp.Quantity` → `clearReconciliationCandidate`, continue (unchanged).
  - else if `qtyApproxEqual(platformNet[bp.Symbol], bp.Quantity)` (abs diff < `1e-6`) →
    `clearReconciliationCandidate`, continue (**the fix**: platform's own fills explain the broker qty).
  - else → existing `recordReconciliationCandidate` → `emitReconciliationFinding(..., bp.Symbol,
    platformQty, bp.Quantity)` (unchanged).
- Add small helper `qtyApproxEqual(a, b float64) bool { return math.Abs(a-b) < 1e-6 }` (`math` is
  already imported, `:10`).

**Traces**: @AC-1, @AC-2, @AC-3.

## Step 4 — portfolio: guard the empty-snapshot delete

**File**: `services/xstockstrat-portfolio/internal/service/portfolio_service.go`, `processPositionSync`
(`:999`). Guard `DeletePositionsNotInSync` so a **broker** sync (`sync.RealizedPnl == nil`) with an
**empty** positions list never purges (a non-authoritative empty broker read must not wipe
order-fill-derived rows). An offline recompute (`RealizedPnl != nil`) with empty positions still
purges (legitimate full-close):

```go
if len(sync.Positions) == 0 && sync.RealizedPnl == nil {
    // Non-authoritative empty broker snapshot: do NOT purge — an order-fill-derived position must
    // not be wiped by a transient/empty broker read (feature 206 false-halt root cause 2b).
} else if err := s.repo.DeletePositionsNotInSync(ctx, sync.AccountID, userID, presentSymbols); err != nil {
    slog.Warn("delete positions not in sync failed", "account_id", sync.AccountID, "error", err)
}
```

**Traces**: @AC-4, @AC-5.

## Step 5 — tests (red-before-green)

**trading** — `internal/service/trading_reconciliation_test.go`:
- Add `fakePositionQtyLookup{ net map[string]float64; err error }` implementing `positionQtyLookup`;
  wire it into `newTestReconciliationServiceWithIntents` (default empty → net 0 → existing
  `TestReconcileTick_PositionQuantityDiscrepancy_CaughtViaPositionSide` still halts, @AC-2).
- `TestReconcileTick_PositionQuantityDiscrepancy_ExplainedByPlatformOrders_NoHalt` — broker AMAT=10,
  portfolio 0, fake net AMAT=10 → no finding, not halted (@AC-1).
- `TestReconcileTick_PositionNetLookupError_SkipsHalt` — broker AMAT=10, portfolio 0, fake err →
  no finding, not halted (@AC-3).
**trading** — `internal/repository/trading_repo_test.go` (pgxmock, mirrors
`TestKnownBrokerOrderIDs_*`): `NetFilledQtyBySymbol` sums signed & dedups; empty input short-circuits.

**portfolio** — `internal/service/` sync test:
- empty broker snapshot (`RealizedPnl==nil`, positions `[]`) → `DeletePositionsNotInSync` **not**
  called / no row deleted (@AC-4).
- offline empty (`RealizedPnl!=nil`, positions `[]`) → delete still called (@AC-5).
- non-empty broker snapshot → delete still called (no regression).

## Step 6 — validate + teardown

- `cd services/xstockstrat-trading && GOWORK=off go build ./... && GOWORK=off go test ./...`
- `cd services/xstockstrat-portfolio && GOWORK=off go build ./... && GOWORK=off go test ./...`
- Update `services/xstockstrat-trading/CLAUDE.md` § Broker State Reconciliation (position side now
  DB-grounded) and `services/xstockstrat-portfolio/CLAUDE.md` (empty-snapshot delete guard).
- Context-forge teardown (`/context-forge:context-constitution refresh` scoped to touched context
  files) or the manual equivalent recorded in the PR (CLAUDE.md Teardown rule).
- Commit + push; open PR to `main-dev`.

## Status

- [x] Step 1 · [x] Step 2 · [x] Step 3 · [x] Step 4 · [x] Step 5 · [x] Step 6

All steps complete. Both services: `GOWORK=off go build/vet/test ./...` green. Context reconciled
(PORTFOLIO-10 updated; both service CLAUDE.md updated). See context.md execute session.
