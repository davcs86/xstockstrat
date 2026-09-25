# Design: fix-reconciliation-false-halt

`/sdd-design quick` (one adversarial round), executed manually. Depth rationale in context.md.

## Chosen approach — defense-in-depth across two services

### Change 1 — trading: DB-ground the position-side reconcile against `trading.orders`

Mirror the order-side `KnownBrokerOrderIDs` grounding on the position side. When
`broker.GetPositions()` disagrees with `portfolio.ListPositions` for a symbol, consult the platform's
**own** net filled quantity for that `(account_id, symbol)` from `trading.orders` before halting:

- Net = `SUM(filled_qty signed by side)` over the account's orders for the symbol (BUY `+`, SELL `−`).
- If `|platformNetQty − brokerQty| < ε` → the broker position is **entirely explained by the
  platform's own fills**; the portfolio projection is merely lagging (fill→ledger→portfolio) or was
  transiently zeroed. Clear the candidate, **no halt**.
- Else → a broker quantity the platform's orders cannot account for (genuine foreign position, e.g. a
  dashboard order) → existing grace + `emitReconciliationFinding` + halt path, unchanged.
- **Fail-safe**: a lookup error skips the position-side halt decision for that tick (candidates
  untouched), never a false halt — identical to the order-side error path. Intent resolution still runs.

New seam (mirrors `brokerOrderIDLookup`):
- `positionQtyLookup` interface `{ NetFilledQtyBySymbol(ctx, accountID, symbols) (map[string]float64, error) }`.
- `TradingService.reconcilePositionLookup positionQtyLookup`, wired `= repo` in `NewTradingService`.
- `TradingRepo.NetFilledQtyBySymbol` — **deduped to the latest row per `order_id` before summing**
  (the PK is `(order_id, created_at)` and `UpsertOrder` mints a fresh `created_at` when `o.CreatedAt`
  is nil, so a logical order can have >1 hypertable row — a naive `SUM` double-counts; adversary HIGH):
  ```sql
  SELECT symbol, SUM(CASE WHEN side='sell' THEN -filled_qty ELSE filled_qty END)
  FROM (
    SELECT DISTINCT ON (order_id) order_id, symbol, side, filled_qty
    FROM trading.orders
    WHERE account_id=$1 AND symbol=ANY($2)
    ORDER BY order_id, created_at DESC
  ) latest
  GROUP BY symbol
  ```
  This mirrors `GetOrder`'s own latest-row-per-order semantics (`ORDER BY created_at DESC LIMIT 1`).
  Empty-input short-circuit; `dbQuerier` seam (pgxmock-testable).
- Only diverging symbols are looked up (one grouped round-trip per tick, scoped to the disagreements).

### Change 2 — portfolio: guard `processPositionSync` empty-snapshot delete

An empty broker snapshot is **not authoritative** — treat it as "no new information", never a purge:

```
if len(sync.Positions) == 0 && sync.RealizedPnl == nil {
    // broker snapshot empty & this is a broker sync (not an offline recompute):
    // do NOT delete — an order-fill-derived position must not be wiped by a transient empty read.
} else {
    DeletePositionsNotInSync(...)  // unchanged
}
```

- Broker syncs are `realized_pnl == nil`; offline recomputes set it non-nil, so an offline full-close
  (empty positions + realized_pnl) still purges — preserved.
- A non-empty broker snapshot still reconciles removals normally (a symbol the broker dropped is
  deleted).

## Rejected alternatives

- **trading-only (DB-ground) or portfolio-only (delete guard)** — each leaves the other mechanism
  live; user chose defense-in-depth. Recorded in the AskUserQuestion decision (context.md).
- **Config-only mitigation (raise `grace_ticks`)** — a band-aid: does not close the 5-min
  empty-snapshot window and weakens genuine foreign-position detection. Rejected as the fix (may still
  be offered as an immediate stopgap).
- **Suppress the position-side check entirely / delete it** — removes a real safety control (foreign
  dashboard positions). Rejected.
- **Compare against `ListPositions` only, with a longer grace** — still trusts a derived projection as
  ground truth; the whole defect is that the projection is not authoritative. Rejected.

## Constitution rules touched

- **PLAT-N1** (best-effort/verify): fail-safe on lookup error, verified by test.
- **C-13** (test-data inventory), **C-15/C-16** (acceptance scenarios → regression tests).
- No F-*/proto/migration/config gate triggered.

## Open risks

1. **Ghost position** on a dashboard-only full close (no `order.filled`): with Change 2 the projection
   is not purged by the empty broker snapshot, so a phantom row persists **until the next non-empty
   sync — indefinitely for an account that stays permanently flat** (adversary LOW). It pollutes
   `ListPortfolios` equity and the `portfolio.risk.*` concentration/drawdown alerts. Accepted: a stale
   read (SEV-3) is strictly better than deleting a real position and false-halting (SEV-2), and the
   platform opens positions via `PlaceOrder`, so dashboard-only closes are the rare case. Not a new
   halt source (the position-side reconcile iterates broker positions only).
2. **Stalled `pollFills` residual** (adversary MEDIUM): the grounding reads `trading.orders.filled_qty`,
   itself a broker projection written by `pollFills`. If `pollFills` stalls for an order (its `GetOrder`
   erroring) while `GetPositions` succeeds, the DB net stays stale and the position-side check can still
   diverge → halt. Normally `pollFills` (5 s) far outpaces reconcile+grace (60 s × 2); documented as a
   residual, not closed (memory-first grounding does not help the primary case — a fully-FILLED order is
   evicted from `s.orders`).
3. **Corporate actions** (splits / stock dividends) change broker qty with no order (adversary MEDIUM):
   `net-signed-filled ≠ brokerQty` → still false-halts. Pre-existing (the old check false-halts too);
   the grounding does not claim to close this. Listed as a known residual; no code change for this SEV-2.
4. **Net-zero foreign masking** (adversary LOW): exact-match clearing means a foreign dashboard buy N +
   sell N (net 0) is not halted. Acceptable — net foreign exposure is zero; the "still halts on
   genuinely foreign positions" guarantee is scoped to **net-nonzero** foreign activity.
5. **Float epsilon** `1e-6` (adversary LOW): share quantities (whole and typical fractional) are exact
   in float64; summation drift is ~1e-9; Alpaca's minimum fractional increment ≫ 1e-6. Absolute epsilon
   is safe at realistic magnitudes; documented in code.

## Adversarial round — resolution

One round via `design-buddy:adversary` against the real code. Verdict: **NEEDS WORK** (no Floor
breach). Resolutions:

- **HIGH — naive `SUM` double-counts multiple rows per `order_id`** → **fixed in design**: the query
  now `DISTINCT ON (order_id) … ORDER BY order_id, created_at DESC` before summing (see Change 1 SQL).
  Confirmed reachable: PK `(order_id, created_at)` + `UpsertOrder` `time.Now()` fallback
  (`trading_repo.go:47-50`).
- **MEDIUM — stalled-poller residual** → **documented** (Open Risk 2); memory-first rejected (evicted
  FILLED orders are the primary case). No code change (minimal-change default).
- **MEDIUM — corporate actions** → **documented** (Open Risk 3), pre-existing, out of scope for SEV-2.
- **LOW-MEDIUM — Change 2 right-sizing / ghost regression** → **waived at gate**: two-change scope was
  user-chosen (defense-in-depth) and the defect's *Expected* explicitly requires the projection not be
  transiently zeroed. Ghost duration corrected in Open Risk 1.
- **LOW — net-zero foreign masking** → **documented** (Open Risk 4), accepted.
- **LOW — epsilon justification** → **documented** (Open Risk 5), justification added.
- **Ledger checks**: no `account.positions.*` payload change (Change 1 reads `trading.orders` directly,
  Change 2 only guards a delete) → `fails.md:2056-2064` not re-triggered; feature-056 dual-source P&L
  path untouched (Change 2 leaves the `realized_pnl` upsert intact). Confirmed by adversary.

Interface choice (separate `positionQtyLookup`, not widening `brokerOrderIDLookup`) upheld by the
adversary (ISP). Status advanced to `design-approved`.
