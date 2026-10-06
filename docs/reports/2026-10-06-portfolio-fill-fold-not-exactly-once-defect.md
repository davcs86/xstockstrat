# Defect: Portfolio re-applies the full order.filled history on every restart, and serializes position writes only in-process

**Recorded**: 2026-10-06
**Severity**: SEV-2
**Impact type**: wrong-positions-displayed
**Environment**: production (main)
**Affected service(s)**: xstockstrat-portfolio
**Config-only fix possible**: no

## Observed

`consumeEventStream` starts every consumer at `lastSeq = 0`, and the stream cursor is never persisted. On
each process start (every deploy, crash or restart) `ConsumeOrderFills` therefore replays the **entire**
`order.filled` history. `processOrderFill` is an incremental fold (`newQty = existing.Qty + fill.Qty`,
`realized_accum = realized_accum + delta`) applied on top of the rows already persisted, so every replayed
fill is applied again:

- Broker-account positions get inflated quantity and cost basis until the next `account.positions.synced`
  snapshot overwrites them (`trading.position_sync.interval_ms`, default 5 min).
- `realized_accum` and `fees_accum` are never overwritten by sync, so they grow by the full historical
  realized P&L on every restart. That inflation is permanent.
- Accounts that never receive broker syncs never self-heal.

Separately, the lost-update fix in PR #1219 serializes the fill, sync and deregistration writers with an
in-process `positionsMu`, which is correct only while exactly one portfolio process runs. DigitalOcean
App Platform zero-downtime deploys briefly run the old and new instance together. During that window both
processes consume the stream: each applies new fills (double-apply), and the cross-process read-compute-write
lost update returns. `instance_count: 1` does not prevent that overlap.

## Expected

Fold consumption is exactly-once and safe under concurrent processes:

1. **Exactly-once.** Applied events are recorded atomically with the position write, either as a
   persisted per-consumer cursor or as an applied-event table with a unique `(consumer, event_id)`, in the
   same transaction. A replayed or concurrently delivered event is then a no-op, and the consumer resumes
   from its persisted cursor rather than from 0.
2. **Row-level serialization.** Each fill, sync and deregistration write runs in one transaction using
   `SELECT … FOR UPDATE` on the position row, plus a transaction-scoped advisory lock keyed on
   `(user_id, symbol, trading_mode, account_id)` to cover a row that does not exist yet. Advisory locks are
   PgBouncer transaction-mode safe. `positionsMu` can then be removed and `instance_count > 1` becomes safe.

## Reproduction

1. Hold a broker-account position with some realized P&L. Note `qty`, `cost_basis` and `realized_accum`
   for the row.
2. Restart `xstockstrat-portfolio`.
3. Before the next position sync, read the row again: `qty` and `cost_basis` include every historical fill
   a second time. After the sync, `qty` is corrected but `realized_accum` stays inflated.
4. For the overlap case, run two portfolio processes against the same DB and ledger and emit one
   `order.filled`. The position moves by twice the fill quantity.

## Evidence

`services/xstockstrat-portfolio/internal/service/portfolio_service.go:175`
> var lastSeq int64

`services/xstockstrat-portfolio/internal/service/portfolio_service.go:196-202`
> // lastSeq == 0 replays full history; lastSeq > 0 resumes from lastSeq+1.
> ...
> FromSequence: fromSeq,

`services/xstockstrat-portfolio/internal/repository/portfolio_repo.go:65`
> SET qty=$3, avg_entry_price=$4, cost_basis=$5, realized_accum=portfolio.positions.realized_accum + $8, fees_accum=portfolio.positions.fees_accum + $9, updated_at=NOW()

`services/xstockstrat-portfolio/internal/service/portfolio_service.go:52-54`
> // positionsMu serializes the ledger consumers' read-compute-write of portfolio.positions rows;
> ...
> positionsMu sync.Mutex

`.do/app.yaml:105`
> instance_count: 1

`services/xstockstrat-portfolio/docs/context-constitution-findings.md:24` already records the replay
question as **open** ("does a restart double-count fills, or is it always corrected by the broker snapshot?").
This report answers it: quantity is corrected only for synced accounts, and realized/fees accumulators
are never corrected.

## Root cause hypothesis

The consumers were built as an in-memory-cursor incremental fold with no idempotency key and no DB-level
concurrency control, relying on broker syncs to self-heal quantity. Nothing heals the accumulators, and
nothing coordinates across processes.

## Confidence

high
