# Defect: ListWatchlists next_page_token skips the row at every page boundary

**Recorded**: 2026-11-16
**Severity**: SEV-2
**Impact type**: silent-data-loss-in-pagination
**Environment**: dev (main-dev) @ bd97b83
**Affected service(s)**: xstockstrat-portfolio (callers: xstockstrat-agent, xstockstrat-analysis)
**Config-only fix possible**: no
**Source**: found during `/sdd-design` for feature 351 (`ensure-signals-watchlist-on-read`), round 1; confirmed by the orchestrator and the design-adversary

## Observed
`WatchlistRepo.ListByUser` fetches `pageSize+1` rows, then returns `wls[pageSize].WatchlistId` — the id of the
look-ahead row — as `next_page_token`. The next page filters `watchlist_id > token`, so the look-ahead row
itself is never returned. For a user whose lists sort a < b < c, a call with `page_size = 1` returns `a`,
the follow-up call with the returned token returns `c`; `b` is silently lost. Every page boundary drops one
row. A single page that holds the whole result (the UI's 50 and the analysis drain's clamped 100) is
unaffected, so the loss shows only for callers that paginate with a small size or hold more lists than the
page size.

## Expected
`next_page_token` identifies the last row actually returned, so the next page resumes at the first
unreturned row and a full traversal yields every list exactly once.

## Reproduction
1. As user U, own three watchlists whose `watchlist_id` values sort a < b < c.
2. Call `ListWatchlists` with `page_size = 1` and an empty `page_token`; note the returned `next_page_token`.
3. Call `ListWatchlists` again with `page_size = 1` and that token.
4. Observe the traversal returns a, c — `b` never appears. (The agent `list_watchlists` tool with `limit = 1`
   behaves the same; its docstring promises "Pagination is stable across pages".)

## Evidence
`services/xstockstrat-portfolio/internal/repository/watchlist_repo.go:138`
> if len(wls) > pageSize {

`services/xstockstrat-portfolio/internal/repository/watchlist_repo.go:139`
> nextToken = wls[pageSize].WatchlistId

`services/xstockstrat-portfolio/internal/repository/watchlist_repo.go:114`
> WHERE user_id = $1 AND ($2 = '' OR watchlist_id > $2::uuid)

Affected paginating callers (page 50 / 100 clamps hide it for most owners; owners with more than the page
size lose rows): `services/xstockstrat-analysis/app/engine/live_loop.py` `_drain_watchlist` and
`services/xstockstrat-analysis/app/handlers/servicer.py` `_drain_watchlist_bindings` (symbol universe is
under-read), and `services/xstockstrat-agent/app/client.py` `list_watchlists`.

## Root cause hypothesis
The token is taken from the look-ahead row (`wls[pageSize]`) instead of the last returned row
(`wls[pageSize-1]`); the keyset filter is exclusive (`>`), so that row is skipped. Fix is one index in the
repository plus a real-backend test that follows the token across a full traversal (a fake that honors a
last-row token is not sufficient proof). Rollout is safe in a mixed fleet: an old token sent to a new server
skips one row once; a new token sent to an old server behaves correctly. Twin defect:
`2026-11-16-portfolio-listpositions-page-token-skips-boundary-row-defect.md`.

## Confidence
high
