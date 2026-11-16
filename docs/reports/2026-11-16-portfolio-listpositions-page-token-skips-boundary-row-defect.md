# Defect: ListPositions next_page_token skips the boundary row and keysets on symbol alone

**Recorded**: 2026-11-16
**Severity**: SEV-2
**Impact type**: silent-data-loss-in-pagination
**Environment**: dev (main-dev) @ bd97b83
**Affected service(s)**: xstockstrat-portfolio (callers: xstockstrat-analysis, xstockstrat-agent)
**Config-only fix possible**: no
**Source**: found during `/sdd-design` for feature 351 (`ensure-signals-watchlist-on-read`), round 1 (design-adversary objection O-3); the token line confirmed by the orchestrator

## Observed
Two compounding faults in `PortfolioRepo.ListPositions` pagination:
1. **Look-ahead token.** It fetches `pageSize+1` rows and returns `positions[pageSize].Symbol` — the look-ahead
   row — as `next_page_token`; the next page filters `symbol > token`, so that row is never returned. Every
   page boundary drops one position.
2. **Non-unique keyset.** Pages are ordered and filtered on `symbol` alone, but the table is unique on
   `(user_id, symbol, trading_mode, account_id)`. The same symbol held in two accounts (or both trading
   modes) can straddle a page boundary, and the exclusive `symbol > token` filter then drops the remaining
   rows for that symbol even after fault 1 is fixed.
A traversal that fits in one page is unaffected, so the loss appears only for callers that paginate or hold
more positions than the page size.

## Expected
A full traversal of `ListPositions` yields every position exactly once, regardless of page size, including
a symbol held in several accounts or trading modes.

## Reproduction
1. As user U, hold positions in symbols A, B, C (one account, one trading mode).
2. Call `ListPositions` with `page_size = 1` and an empty token; note `next_page_token`.
3. Call it again with that token. Observe A then C — `B` is skipped.
4. Hold symbol A in two accounts and repeat with `page_size = 1`: the second `A` row is dropped as well.

## Evidence
`services/xstockstrat-portfolio/internal/repository/portfolio_repo.go:162`
> conds = append(conds, fmt.Sprintf("($%d = '' OR symbol > $%d)", len(args), len(args)))

`services/xstockstrat-portfolio/internal/repository/portfolio_repo.go:193-194`
> if len(positions) > pageSize {
> 	nextToken = positions[pageSize].Symbol

`services/xstockstrat-portfolio/migrations/003_positions_account_id.up.sql:10`
> UNIQUE (user_id, symbol, trading_mode, account_id);

Paginating callers: `services/xstockstrat-analysis/app/engine/live_loop.py` `_drain_held` and
`services/xstockstrat-analysis/app/handlers/servicer.py` ListPositions drains (held-symbol sets are
under-read), and the agent `get_positions` tool.

## Root cause hypothesis
Same look-ahead off-by-one as the sibling `ListByUser` defect, plus a keyset that is not unique for this
table. The fix needs a token that encodes the full ordering key (a composite `symbol` + account +
trading-mode cursor, opaque to clients) and `ORDER BY` matching it, with a real-backend test that traverses
a multi-account symbol across page boundaries. Sibling defect:
`2026-11-16-portfolio-listwatchlists-page-token-skips-boundary-row-defect.md`.

## Confidence
high
