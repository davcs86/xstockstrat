# Defect: trading reconcile reads only the first 500 platform positions per account

**Recorded**: 2026-11-17
**Severity**: SEV-2
**Impact type**: false-reconciliation-finding
**Environment**: dev (main-dev) @ 4c87ea8
**Affected service(s)**: xstockstrat-trading (upstream: xstockstrat-portfolio ListPositions)
**Config-only fix possible**: no
**Source**: feature 353 (`fix-listpositions-nextpagetoken-skips`) design § Open Risks, follow-up (3)

## Observed

`reconcileTick` fetches the platform's positions for each broker account with one
`ListPositions` call (`page_size 500`) and ignores `next_page_token`. For an account holding more
than 500 positions, every symbol past the first page is missing from `platformBySymbol`, so its
platform qty reads as 0 and it diverges from the broker. If the platform's own net fills do not
explain the broker qty (`NetFilledQtyBySymbol`), the symbol becomes a reconciliation candidate and,
after the grace ticks, `emitReconciliationFinding` halts the account
(`HALT_SOURCE_RECONCILIATION`) on a position the platform actually holds.

## Expected

Reconcile compares the broker against the account's full platform position set (every page), or
fails visibly for the tick (as the existing `ppErr` path does) — never against a truncated set.

## Reproduction

1. In a `reconcileTick` unit test, give the fake portfolio client an account with 501 positions
   where the 501st symbol's qty matches the broker, and a fake `NetFilledQtyBySymbol` that does not
   explain it (e.g. a broker-synced position).
2. Have the fake honor `page_size` 500 and return a non-empty `next_page_token`.
3. Run `reconcileTick` for `graceTicks + 1` ticks.
4. Observe a quantity-discrepancy finding (and halt) for the 501st symbol.

## Evidence

`services/xstockstrat-trading/internal/service/trading.go:2235-2238` (`reconcileTick`)
> platformPositions, ppErr := s.portfolio.ListPositions(listPosCtx, &portfoliov1.ListPositionsRequest{
> AccountId: &accountID, TradingMode: tradingMode,
> Page: &commonv1.PageRequest{PageSize: 500},
> })

`services/xstockstrat-trading/internal/service/trading.go:2244-2245`
> platformBySymbol := make(map[string]float64, len(platformPositions.Positions))
> for _, p := range platformPositions.Positions {

## Root cause hypothesis

Reconcile was written when `next_page_token` was unreliable (fixed by feature 353) and assumed
one page per account. Fix is to drain the cursor (fail closed per `docs/roadmap/ledger/fails.md:3311`
— a page error skips the account for the tick like `ppErr`), tested against a fake that ignores the
token. Twin report (portfolio internal callers):
`2026-11-17-portfolio-internal-position-reads-truncate-at-500-defect.md`.

## Confidence

high
