# Product Spec: fix-portfolio-internal-position

**Type**: bug
**GitHub Issue**: none — defect report `docs/reports/2026-11-17-portfolio-internal-position-reads-truncate-at-500-defect.md`
**Severity**: SEV-2
**Created**: 2026-11-17

---

## Problem Statement

Observed: four internal readers in `services/xstockstrat-portfolio/internal/service/portfolio_service.go` call
`s.repo.ListPositions(..., 500, "", ...)` once and discard `next_page_token`: `GetPortfolio` (:787), `GetPnL`
(:932), `broadcastSnapshot` (:1214), `checkRiskLimits` (:1283). A user holding more than 500 positions in the
call's scope gets results built from the first 500 rows, with no log, metric or error. Affected actors: a
trader with more than 500 positions (wrong `/trader` portfolio totals, wrong P&L) and the operator relying on
risk alerts and snapshots (a concentration breach or equity figure computed over a partial set).

Expected: every internal reader covers all of the user's positions in scope (following the feature-353
composite cursor to the end) or fails visibly.

## Reproduction Steps

1. With the dbtest harness (`internal/repository/dbtest_helpers_test.go`, `seedPosition`), seed 501 positions
   for user U in one trading mode.
2. Call `GetPnL` (or `GetPortfolio`) for U in that mode.
3. The result covers 500 positions; the last row in `(symbol, trading_mode, account_id)` order is missing.

## Root Cause Hypothesis

The internal readers predate a working cursor (feature 353) and treated one 500-row page as all positions. Repo-level drain vs per-site loop is a design decision; enrichment must stay one batched call per RPC page (`@AC-1 @feature-178`).

## Functional Requirements

- **FR-1** — `GetPortfolio` aggregates every position the caller holds in the requested trading mode, past the
  first 500 rows; with `account_id` set it covers every position of that account (and only that account).
- **FR-2** — `GetPnL` computes over every position the caller holds in the requested trading mode, past the first
  500 rows.
- **FR-3** — `broadcastSnapshot` persists and broadcasts a snapshot whose equity covers every position of the
  user in that mode, past the first 500 rows.
- **FR-4** — `checkRiskLimits` evaluates the concentration limit over every position of the user in that mode,
  past the first 500 rows.
- **FR-5** — A failed read of any page is never treated as the complete set: `GetPortfolio` and `GetPnL` return
  an error; `broadcastSnapshot` persists/broadcasts no snapshot and `checkRiskLimits` raises no concentration
  alert from the partial set, and each logs the failure (no silent truncation).
- **FR-6** — Quote enrichment stays batched (`@AC-1 @feature-178`): no per-position `GetLatestQuote` call, and at
  most one `GetLatestQuotes` batch per page of up to 500 positions read.

## Affected Services

xstockstrat-portfolio

## Consumer Surface(s)

- [x] UI segment: `/trader` — `GetPortfolio` (via `usePortfolio` / `traderBff.getPortfolio`) backs the portfolio
  and positions pages; totals and position lists become complete for users with more than 500 positions. No UI
  code change.
- [ ] Agent tool: none — no agent tool changes.
- Background effects (no UI change): risk-limit alerts delivered through notify (`checkRiskLimits`) and
  `portfolio.snapshots` / `StreamPortfolioUpdates` (`broadcastSnapshot`) now reflect the full position set.

## Fix Scope

- [x] No proto changes anticipated
- [x] No database migrations anticipated
- [x] No config key changes anticipated

## Preserved Business Rules (C-16)

- `@AC-1 @feature-178` (`services/xstockstrat-portfolio/acceptance/quote-fanout-batching.feature`) — batched
  quote enrichment; guarded here by FR-6 / `@AC-4`.
- Feature 353 `@AC-1` — the `ListPositions` composite cursor this fix follows to the end; unchanged.
- `@AC-16 @feature-294` (analysis held-position drain failure metric) — not touched here; owned by peer
  feature 356.

## Acceptance Criteria

See `acceptance.feature` — the regression scenario(s) that must fail on the buggy behavior and pass
after the fix (Constitution **C-15**). Plus: existing tests pass; affected service(s) smoke-tested on
dev.

## Out of Scope

- The public `ListPositions` RPC and its cursor (feature 353); features 351, 353 and 354 are not touched
- Trading `reconcileTick` reads (feature 358) and analysis `_drain_held` (feature 356)
- Refactoring unrelated to the bug
- Performance improvements unrelated to the fix

## Open Questions

- Repo-level drain vs per-site page loop — deferred to `/sdd-design`.
