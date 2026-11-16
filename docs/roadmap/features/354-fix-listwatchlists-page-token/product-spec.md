# Product Spec: fix-listwatchlists-page-token

**Type**: bug
**GitHub Issue**: none — defect report `docs/reports/2026-11-16-portfolio-listwatchlists-page-token-skips-boundary-row-defect.md`
**Severity**: SEV-2
**Created**: 2026-11-16

---

## Problem Statement

**Observed:** `WatchlistRepo.ListByUser` fetches `pageSize+1` rows, then returns `wls[pageSize].WatchlistId` — the id of the look-ahead row — as `next_page_token`. The next page filters `watchlist_id > token`, so the look-ahead row itself is never returned. For a user whose lists sort a < b < c, `page_size = 1` returns `a`, the follow-up call returns `c`; `b` is silently lost. Every page boundary drops one row. A single page holding the whole result (UI's 50, analysis drain's clamped 100) is unaffected.

**Expected:** `next_page_token` identifies the last row actually returned, so the next page resumes at the first unreturned row and a full traversal yields every list exactly once. Response shape and token format (a `watchlist_id` UUID string) are unchanged.

## Reproduction Steps

1. As user U, own three watchlists whose `watchlist_id` values sort a < b < c.
2. Call `ListWatchlists` with `page_size = 1` and an empty `page_token`; note `next_page_token`.
3. Call `ListWatchlists` again with `page_size = 1` and that token.
4. Observe the traversal returns a, c — `b` never appears. (Agent `list_watchlists` with `limit = 1` behaves the same; its docstring promises "Pagination is stable across pages".)

## Root Cause Hypothesis

Token taken from the look-ahead row (`wls[pageSize]`) instead of the last returned row (`wls[pageSize-1]`); keyset filter is exclusive (`>`), so that row is skipped. Evidence: `services/xstockstrat-portfolio/internal/repository/watchlist_repo.go` (`ListByUser`, lines ~114 and ~138-141 at report time). Mixed-fleet rollout: an old token sent to a new server skips one row once; a new token sent to an old server behaves correctly (to be verified in recon).

## Affected Services

- xstockstrat-portfolio (fix site)
- Callers, read-only check for behavior change: xstockstrat-analysis (`live_loop.py` `_drain_watchlist`, `servicer.py` `_drain_watchlist_bindings`), xstockstrat-agent (`list_watchlists` tool / client)

## Fix Scope

- [x] No proto changes anticipated
- [x] No database migrations anticipated
- [x] No config key changes anticipated

## Acceptance Criteria

See `acceptance.feature` — the regression scenario(s) that must fail on the buggy behavior and pass after the fix (Constitution **C-15**). Required proof: a real-backend (`dbtest`-tag) repository test traversing a user's lists with `page_size = 1` across a full traversal, yielding every list exactly once (via a named-seed variant of the `seedWatchlist` helper, leaving its signature unchanged), plus a unit-level test. Plus: existing tests pass; affected service smoke-tested on dev.

## Out of Scope

- The twin `ListPositions` defect (`2026-11-16-portfolio-listpositions-page-token-skips-boundary-row-defect.md`) — owned by another session
- Feature 351 (`ensure-signals-watchlist-on-read`)
- Refactoring unrelated to the bug; performance improvements unrelated to the fix
