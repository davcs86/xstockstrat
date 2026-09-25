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
- `TradingRepo.NetFilledQtyBySymbol` — `SELECT symbol, SUM(CASE WHEN side='sell' THEN -filled_qty
  ELSE filled_qty END) FROM trading.orders WHERE account_id=$1 AND symbol=ANY($2) GROUP BY symbol`;
  empty-input short-circuit; `dbQuerier` seam.
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

1. **Ghost position** on a dashboard-only full close (no `order.filled`): projection lingers until a
   non-empty sync. Accepted (stale read ≪ false halt). Not a new halt source.
2. **Float epsilon** choice (`1e-6`): safe for share quantities incl. fractional; documented in code.
3. The two `broker.GetPositions()` calls (`syncPositions` vs `reconcileTick`) remain independent; the
   grounding makes reconcile robust to their disagreement rather than trying to serialize them.

## Adversarial round

See "Adversarial round — resolution" appended below.
