# Defect: Portfolio fill and broker-sync consumers race on the same position row (lost update)

**Recorded**: 2026-10-03
**Severity**: SEV-2
**Impact type**: wrong-positions-displayed
**Environment**: production (main)
**Affected service(s)**: xstockstrat-portfolio
**Config-only fix possible**: no

## Observed

`ConsumeOrderFills` and `ConsumePositionSyncs` run as separate goroutines. `processOrderFill` does
read, then compute, then write, as separate statements with no transaction and no row lock:
`GetPosition`, then `GetRealizedAccum`, then an absolute `UpsertPosition`. `processPositionSync` runs
its own absolute `UpsertPositionFromSync`. Both upserts overwrite `qty`, `avg_entry_price` and
`cost_basis` outright, so whichever write lands last wins.

When a fill and a broker sync for the same `(user, symbol, mode, account)` interleave:

- **Sync lands between the fill's read and its write:** the fill overwrites the broker-synced
  quantity with a value computed from the stale read.
- **Fill computes a realized delta from a cost basis that sync has already replaced:** the error
  accumulates into `realized_accum` (`realized_accum + $8`), and sync never corrects it.

Positions self-heal on the next sync, but realized P&L does not. `s.mu` guards only the subscriber
map, not positions.

## Expected

The fill and sync writers for one position row are serialized, for example with
`SELECT … FOR UPDATE` inside a transaction around read, compute and write. Alternatively, sync is
applied as a compare-and-set against the version the fill read.

## Reproduction

1. Hold a position in symbol X on an Alpaca account.
2. Deliver an `order.filled` partial sell for X and a position-sync event for X at nearly the same
   time. A deterministic interleave is possible in a test with a pgxmock barrier between
   `GetPosition` and `UpsertPosition`.
3. The final `qty` reflects the stale read, and `realized_accum` includes a delta computed against the
   pre-sync cost basis.

## Evidence

`services/xstockstrat-portfolio/cmd/server/main.go:64-65`
> go svc.ConsumeOrderFills(ctx)
> go svc.ConsumePositionSyncs(ctx)

`services/xstockstrat-portfolio/internal/service/portfolio_service.go:274`
> existing, err := s.repo.GetPosition(...)

`services/xstockstrat-portfolio/internal/service/portfolio_service.go:337`
> s.repo.UpsertPosition(...)

`services/xstockstrat-portfolio/internal/repository/portfolio_repo.go:64-65`
> ON CONFLICT ... DO UPDATE SET qty=$3, avg_entry_price=$4, cost_basis=$5, realized_accum=portfolio.positions.realized_accum + $8

## Root cause hypothesis

Read-modify-write on a row shared by two independent consumers, with absolute (not delta) updates and
no concurrency control. The 2026-10-02 fill-path fix (commit `cc3a20c`) made DB errors visible but
did not change concurrency.

## Confidence

high
