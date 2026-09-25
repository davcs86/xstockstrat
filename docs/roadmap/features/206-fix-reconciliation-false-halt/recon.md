# Recon: fix-reconciliation-false-halt

Grounded codebase dossier (`/sdd-design` Phase 0, executed manually). All paths verified by Read/Grep
this session.

## Codebase map — the flow that produced the incident

1. **Fill detection** — `services/xstockstrat-trading/internal/service/trading.go:1628-1640`
   (`pollFills`). On broker status `filled`, emits `order.filled` with a complete payload
   (`order_id, symbol, qty, fill_price, user_id, trading_mode, account_id, fees`) and fires
   `emitFillAlert` (the INFO alert in the incident screenshot).
2. **Projection fold** — `services/xstockstrat-portfolio/internal/service/portfolio_service.go:221-307`
   (`processOrderFill`, via `ConsumeOrderFills` live stream). Upserts `portfolio.positions` keyed by
   `(user_id, symbol, trading_mode, account_id)`.
3. **Broker position sync** — `trading.go:2164-2224` (`syncAccountPositions`). Emits
   `account.positions.synced` from `broker.GetPositions()` **even when the positions slice is empty**
   (`:2198`). Interval `trading.position_sync.interval_ms` default 300000 ms.
4. **Sync consumer** — `portfolio_service.go:959-1010` (`processPositionSync`). Upserts present
   symbols, then `DeletePositionsNotInSync(accountID, userID, presentSymbols)` (`:999`) — an **empty**
   `presentSymbols` deletes every row for the account (same primitive the deregister purge uses at
   `:951`).
5. **Reconciliation** — `trading.go:1772-1946` (`reconcileTick`). Order side (`:1819-1886`) is
   DB-grounded via `reconcileOrderLookup.KnownBrokerOrderIDs`. Position side (`:1888-1930`) compares
   `broker.GetPositions()` against `portfolio.ListPositions` with **only** the grace-tick counter —
   **no `trading.orders` grounding**. On divergence past grace it calls `emitReconciliationFinding`
   with `bp.Symbol` as the identifier (`:1925`) → the incident's `quantity_discrepancy (AMAT)`.

## Patterns to REUSE

- **Order-side DB-grounding seam** — `brokerOrderIDLookup` interface (`trading.go:57-61`), service
  field `reconcileOrderLookup` (`:110-112`), wired `reconcileOrderLookup: repo` in `NewTradingService`
  (`:198`), implemented `TradingRepo.KnownBrokerOrderIDs` (`repository/trading_repo.go:117-143`), faked
  as `fakeBrokerOrderLookup` (`trading_reconciliation_test.go:195-219`). The position-side grounding
  should mirror this seam exactly (narrow interface + swappable field + repo impl + test fake).
- **Fail-safe-on-lookup-error** — order side skips the check for the tick on DB error, never a false
  halt (`trading.go:1864-1885`, test `TestReconcileTick_UnknownOrderLookupError_SkipsClassification`).
  The position-side grounding must adopt the same fail-safe.
- **Candidate grace/clear/dedup** — `recordReconciliationCandidate` / `clearReconciliationCandidate`
  (`trading.go:1719-1739`); `emitReconciliationFinding` no-ops once halted (`:1745`).
- **Repo query shape** — `KnownBrokerOrderIDs` (`trading_repo.go:117-143`): `account_id = $1 AND
  col = ANY($2)`, empty-input short-circuit, `dbQuerier` seam for pgxmock. A net-filled-qty query
  reuses this shape.
- **Signed side + filled qty** — `sideStr` (`trading_repo.go:371`); `filled_qty` column on
  `trading.orders`. Net = SUM(filled_qty signed by side).

## Existing Business Rules (must not regress)

- The position-side check EXISTS to catch a broker position the platform never placed (e.g. a
  dashboard order) — `trading/CLAUDE.md` § Broker State Reconciliation; test
  `TestReconcileTick_PositionQuantityDiscrepancy_CaughtViaPositionSide`
  (`trading_reconciliation_test.go:581-612`). Any suppression must preserve this.
- The order-side check was already hardened against this exact false-halt class ("an observed
  production false halt", DB-grounding) — the position side is the unhardened twin.
- `account.positions.*` reconciliation payloads must carry `user_id`/`account_id`
  (`fails.md:2056-2064`).
- Offline accounts: `processPositionSync` with `realized_pnl != nil` is an offline recompute; an empty
  positions list there is a legitimate full-close and must still purge
  (`portfolio_service.go:1003-1009` and its comment).
- P&L/realized_accum must not be recomputed in the sync path (feature-056 dual-source bug) — the guard
  must not touch that logic.

## Dependencies / seams

- `TradingRepo` (`repository/trading_repo.go`) — add one query method; already the `reconcileOrderLookup`.
- `NewTradingService` (`trading.go:~160-200`) — wire a second lookup field.
- `newTestReconciliationService[WithIntents]` (`trading_reconciliation_test.go:167-193`) — wire the
  new fake so existing position-side tests don't nil-deref.
- `portfolio_service.go processPositionSync` — one guarded branch; no repo/interface change.

## Risks

- **Float equality** — net-filled-qty (summed) vs broker qty (float): compare with a small epsilon,
  not `==`, to avoid summation drift (fractional shares).
- **Ghost positions** — guarding the empty-snapshot delete means a position closed **only** on the
  broker dashboard (no `order.filled`) lingers in the projection until a non-empty sync. Accepted
  tradeoff: a stale read (SEV-3) is strictly better than deleting a real position and false-halting
  (SEV-2). The position-side reconcile does not catch "platform has, broker doesn't" (it iterates
  broker positions only), so this does not itself create a new halt.
- **Short positions** — signed net handles shorts (SELL = negative); epsilon compare on signed values.

## Recommended scope

Two surgical changes, both mirroring existing hardened patterns; no proto, migration, or config
change. Trading: DB-ground the position-side check. Portfolio: guard the empty-snapshot delete.
