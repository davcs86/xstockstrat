# Product Spec: fix-analysis-held-position-drains

**Type**: bug
**GitHub Issue**: none — defect report `docs/reports/2026-11-17-analysis-held-position-drains-trust-page-token-defect.md`
**Severity**: SEV-3
**Created**: 2026-11-17

---

## Problem Statement

**Who is affected.** A trader reading the Opportunities queue (`/insights/opportunities`, or the agent
`list_opportunities` tool) or the screener's "held" marks (`/insights/screener`, agent `screen_symbols`),
and a trader whose live strategies the analysis live loop evaluates. When the portfolio `ListPositions`
paging misbehaves (a repeated token, an error on a later page, more than 50 pages), the trader sees a
held-value ranking inflated by duplicated pages, or one built from only some of their positions. Either
result looks normal: nothing tells them or an operator that the held set is wrong.

**Observed, per site:**

- `live_loop._drain_held` (`services/xstockstrat-analysis/app/engine/live_loop.py:563-590`) loops on
  `next_page_token` with no check for a token equal to the one just sent. When it reaches the 50-page cap
  (`_DRAIN_PAGES`, `live_loop.py:66`) with a token still pending, it returns with no log and no metric. On a
  page error it already logs a warning and records `analysis.live_loop.drain_failures{source=held}`
  (`live_loop.py:583-584`). It then returns the partial set as a successful result (`live_loop.py:585`).
  The caller uses that partial set as the owner's complete held set for the cycle (`live_loop.py:402`).
- `servicer._drain_held_symbols` (`services/xstockstrat-analysis/app/handlers/servicer.py:6404-6437`) has
  the same missing check for a repeated token. It also has a silent 50-page cap (`_MAX_DRAIN_PAGES`,
  `servicer.py:347`). It catches only `grpc.RpcError` and logs it, records no metric, and returns the
  partial map as success (`servicer.py:6428-6430`). It sums `abs(market_value)` per page, so a repeated
  page multiplies a symbol's held value. That map feeds the held-value ranking in `_compute_opportunities`
  (`servicer.py:5367`) and the `held` marks in `ScreenSymbols` (`servicer.py:3935`).

**Expected** (`docs/roadmap/ledger/fails.md:3311`): a page error or a deadline is an error, never
end-of-data. A token equal to the one just sent is rejected. Reaching the cap with a token still pending is
logged and counted. Each drain is tested against a fake that ignores the token.

## Functional Requirements

- **FR-1 (repeated token).** Both held drains reject a `next_page_token` equal to the `page_token` they just
  sent. They make no further call and treat the drain as failed (FR-4).
- **FR-2 (page cap).** Both drains keep a 50-page cap. When page 50 still returns a non-empty
  `next_page_token`, the drain is failed (FR-4), not complete. The drain logs a WARNING that names the
  owner/user and the cap.
- **FR-3 (page error).** Any exception on any page is a drain failure (FR-4) in both drains. That includes
  a gRPC error, a deadline, or a non-gRPC exception. Rows collected from earlier pages are never returned
  as a result.
- **FR-4 (fail closed, observable per caller).** A failed held drain raises to its caller and returns no
  value. Each caller handles it as follows:
  - Live loop cycle (`live_loop.py:402`): it logs a WARNING and skips the strategies of that owner for this
    cycle. It still evaluates the other owners. A failed owner is drained at most once per cycle: its
    remaining strategies are skipped without another `ListPositions` drain. It records
    `analysis.live_loop.drain_failures{source=held}` once per failed owner per cycle, which preserves
    `@AC-16 @feature-294`. No metric attribute carries the owner id.
  - Entry backfill (`entry_backfill.py:148`): no change. Its existing `except Exception` already skips the
    owner.
  - `_compute_opportunities` (`servicer.py:5367`), on-demand (kick-path) recompute: the recompute fails
    through its existing path (`servicer.py:4948-4957`). The user's previous queue is not replaced, and
    the failure is counted by `analysis.opportunity.recompute{outcome=failed}`. On a cold read (no stored
    queue), repeated failures surface `compute_failed` (feature 185, `servicer.py:4784-4795`); a user with
    a stored queue is served the stale rows. The fix adds no new metric instrument.
  - Daily refresh (`_opportunity_refresh_tick`, `servicer.py:6056-6069`): a per-user failure logs a
    WARNING with traceback and records `analysis.opportunity.recompute{kind=full,outcome=failed}` once per
    failed user, with no user attribute. That user's previous queue is kept, and the schedule still
    advances. No `ok` is recorded on this path. The loop tick is unchanged: an ordinary tick on partial
    failure, and none when every user fails.
  - `ScreenSymbols` (`servicer.py:3935`): it still returns the screen results, but marks no row `held`. It
    logs a WARNING instead of marking from a partial set.
- **FR-5 (unchanged success path).** When `ListPositions` honors `page_token` and ends with an empty
  `next_page_token`, both drains return every held position exactly once. That holds for one page and for
  many pages. `_drain_held_symbols` values each symbol by its own summed `abs(market_value)`. Results stay
  owner-scoped, which preserves `@AC-8 @feature-262`.
- **FR-6 (test contract).** Each drain has a test that runs against a `ListPositions` fake that ignores
  `page_token`. Each `@regression` scenario's test fails on the current code before the fix lands (red
  before green). `@AC-4` is a guard, not a regression: the current code already propagates a non-gRPC
  exception.

## Consumer Surface(s)

- UI `/insights/opportunities` (`xstockstrat-ui`, via `useOpportunities`): held-value ranking. No UI code
  change. When the drain fails, the page shows the previous queue or the existing `compute_failed` state
  instead of a skewed ranking.
- UI `/insights/screener` (`useScreenSymbols`): the `held` badge. No UI code change. When the drain fails,
  no row is badged.
- Agent tools `list_opportunities` and `screen_symbols` (`xstockstrat-agent`): passthrough. No code change.
- Internal: the analysis live loop and the entry backfill held sets.

## Reproduction Steps

1. Fake portfolio stub whose `ListPositions` ignores `page_token` and always returns one position with
   `next_page_token = "t"`.
2. `await loop._drain_held("o-1")` / `await svc._drain_held_symbols("u-1", meta)`.
3. 50 calls are made. `_drain_held_symbols` returns `abs(market_value) * 50`. Nothing logs or counts it.
4. With a stub that raises on page 2, both return page 1's rows as a completed drain.

## Root Cause Hypothesis

Both loops predate the token-looping consumer rule (feature 257) and copy the best-effort pattern: the
loop exit trusts the server's token, and the error path returns accumulated state. Design decides whether
the two drains share one helper or are each hardened in place (operator decision 2026-11-17). FR-1 to FR-6
bind either way.

## Affected Services

xstockstrat-analysis only. Upstream and unchanged: xstockstrat-portfolio `ListPositions`, whose own
pagination fix is feature 353. There are no broker, order or fill changes, and `BrokerType` handling is
unaffected (C-1 to C-5 not triggered).

## Fix Scope

- No proto changes.
- No database migrations.
- No config key changes: the 50-page cap stays a module constant.
- No new metric instrument. The fix reuses `analysis.live_loop.drain_failures{source=held}` and
  `analysis.opportunity.recompute{outcome=failed}`. The daily refresh reuses the existing
  `recompute{kind=full,outcome=failed}` label set (no new label value).

## Acceptance Criteria

See `acceptance.feature`. Its regression scenarios must fail on the buggy behavior and pass after the fix
(Constitution **C-15**); they are `@AC-1`, `@AC-2`, `@AC-3`, `@AC-5`, `@AC-6`, `@AC-7` and `@AC-10` (the
daily-refresh failed user). Every scenario is tagged with the FR it covers. The existing analysis tests must
also pass, and the affected service must be smoke-tested on dev.

## Out of Scope

- The sibling drain loops that share the cap pattern: `live_loop.py:178` (fundamentals universe), `:535`
  (owner signals), `:601` (watchlist), and `servicer.py:6006`, `:6369` (`_drain_active_signals`). Each
  needs its own defect report if it should be hardened.
- The server-side behavior of portfolio `ListPositions` (feature 353).
- Entry-backfill code: its existing handler already covers FR-4.
- Features 351, 353 and 354.
