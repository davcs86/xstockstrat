# Defect: portfolio internal position reads stop at the first 500 rows

**Recorded**: 2026-11-17
**Severity**: SEV-2
**Impact type**: silent-truncation
**Environment**: dev (main-dev) @ 4c87ea8
**Affected service(s)**: xstockstrat-portfolio
**Config-only fix possible**: no
**Source**: feature 353 (`fix-listpositions-nextpagetoken-skips`) design § Open Risks, follow-up (3)

## Observed

Four internal call sites in `PortfolioService` read a user's positions with one
`repo.ListPositions(..., 500, "", ...)` call and discard the returned `next_page_token` (`_`).
A user holding more than 500 positions in the scope of the call gets a result built from the first
500 rows only, returned as success:

- `GetPortfolio` — totals/positions for the mode or account;
- `GetPnL` — unrealized P&L across the mode;
- `broadcastSnapshot` — the snapshot pushed to subscribers;
- `checkRiskLimits` — drawdown and concentration denominators.

No log, metric or error marks the truncation.

## Expected

Each internal reader either consumes every page (following the feature-353 composite cursor until
it is empty) or fails visibly; a user with more than 500 positions gets totals, snapshots and risk
checks over all of them.

## Reproduction

1. With the dbtest harness (`internal/repository/dbtest_helpers_test.go`, `seedPosition`), seed 501
   positions for user U in one trading mode.
2. Call `GetPnL` (or `GetPortfolio`) for U in that mode.
3. Observe the result covers 500 positions; the 501st (last in `(symbol, trading_mode, account_id)`
   order) is absent from positions and totals.

## Evidence

`services/xstockstrat-portfolio/internal/service/portfolio_service.go:787` (`GetPortfolio`)
> positions, _, err := s.repo.ListPositions(ctx, userID, req.TradingMode, 500, "", req.GetAccountId(), "", portfoliov1.PositionSide_POSITION_SIDE_UNSPECIFIED)

`services/xstockstrat-portfolio/internal/service/portfolio_service.go:932` (`GetPnL`)
> positions, _, err := s.repo.ListPositions(ctx, userID, req.TradingMode, 500, "", "", "", portfoliov1.PositionSide_POSITION_SIDE_UNSPECIFIED)

`services/xstockstrat-portfolio/internal/service/portfolio_service.go:1214` (`broadcastSnapshot`)
> positions, _, err := s.repo.ListPositions(ctx, userID, mode, 500, "", "", "", portfoliov1.PositionSide_POSITION_SIDE_UNSPECIFIED)

`services/xstockstrat-portfolio/internal/service/portfolio_service.go:1283` (`checkRiskLimits`)
> positions, _, err := s.repo.ListPositions(ctx, userID, mode, 500, "", "", "", portfoliov1.PositionSide_POSITION_SIDE_UNSPECIFIED)

## Root cause hypothesis

The internal readers predate a working cursor (feature 353 made `next_page_token` correct) and
treated one 500-row page as "all positions". Fix shape (repo-level drain vs. per-site loop) is a
design decision; it must preserve the one-batched-enrichment-per-page rule (`@AC-1 @feature-178`).
Twin report (trading caller): `2026-11-17-trading-reconcile-reads-first-500-positions-defect.md`.

## Confidence

high
