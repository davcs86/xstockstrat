# Defect: analysis held-position drains trust next_page_token and return partial results as success

**Recorded**: 2026-11-17
**Severity**: SEV-3
**Impact type**: silent-partial-read
**Environment**: dev (main-dev) @ 4c87ea8
**Affected service(s)**: xstockstrat-analysis (upstream: xstockstrat-portfolio ListPositions)
**Config-only fix possible**: no
**Source**: feature 353 (`fix-listpositions-nextpagetoken-skips`) design § Open Risks, follow-up (1)

## Observed

Two analysis consumers page `PortfolioService.ListPositions` by looping on `next_page_token`, and
neither follows the ledger rule for token-looping consumers (`docs/roadmap/ledger/fails.md:3311`):

1. **No repeated-token guard.** A server that returns the same `next_page_token` it was sent (or a
   token that ignores the cursor) makes both loops re-read the same page until the page cap; held
   symbols are re-added and, in `_drain_held_symbols`, `abs(market_value)` is summed once per repeat.
2. **Silent page cap.** Both loops stop after 50 pages (`_DRAIN_PAGES` / `_MAX_DRAIN_PAGES`) with a
   token still pending and return what they have — no log, no metric, no error.
3. **Partial result returned as success.** A page error mid-drain returns the rows collected so far.
   `live_loop._drain_held` counts it (`record_live_loop_drain_failure("held")`) but still hands the
   partial set to the caller; `servicer._drain_held_symbols` logs a WARN and returns the partial dict,
   and catches only `grpc.RpcError` (any other exception — e.g. a deadline surfaced as
   `asyncio.TimeoutError`, or an attribute error on a malformed response — propagates out of
   `ListOpportunities`).

The held-value dict feeds the opportunity ranking (`held_value_by_symbol`), so a duplicated or
truncated read skews it with no signal to the operator.

## Expected

Per fails.md:3311: a page error or deadline is an error, never end-of-data; a token equal to the
one just sent is rejected; reaching the page cap with a token still pending is logged and counted
rather than silent; and each drain is tested against a fake that ignores the token. The existing
rules stay: a failed held drain is still counted (`@AC-16 @feature-294`,
`services/xstockstrat-analysis/acceptance/signal-map-instrumentation.feature`) and the drain stays
owner-scoped (`@AC-8 @feature-262`, `fix-analysis-owner-scope.feature`).

## Reproduction

1. In a unit test, give `LiveLoop` (or `AnalysisServicer`) a fake portfolio stub whose
   `ListPositions` ignores `page_token` and always returns the same position with
   `next_page_token = "t"`.
2. Call `await loop._drain_held("o-1")` / `await svc._drain_held_symbols("u-1", meta)`.
3. Observe: 50 calls are made; `_drain_held_symbols` returns `abs(market_value) * 50` for the
   symbol; neither logs nor counts the cap hit.
4. Make the stub raise on page 2: both return page 1's rows as if the drain completed.

## Evidence

`services/xstockstrat-analysis/app/engine/live_loop.py:571`
> for _ in range(_DRAIN_PAGES):

`services/xstockstrat-analysis/app/engine/live_loop.py:582-585`
> except Exception as e:
> log.warning("live_loop: ListPositions(%s) failed: %s", owner, e)
> telemetry.record_live_loop_drain_failure("held")
> return out

`services/xstockstrat-analysis/app/engine/live_loop.py:587-588`
> page_token = resp.page.next_page_token
> if not page_token:

`services/xstockstrat-analysis/app/engine/live_loop.py:66`
> _DRAIN_PAGES = 50

`services/xstockstrat-analysis/app/handlers/servicer.py:6417`
> for _ in range(_MAX_DRAIN_PAGES):

`services/xstockstrat-analysis/app/handlers/servicer.py:6428-6430`
> except grpc.RpcError as e:
> log.warning("ListOpportunities: ListPositions failed: %s", e)
> return held

`services/xstockstrat-analysis/app/handlers/servicer.py:6433`
> held[norm] = held.get(norm, 0.0) + abs(p.market_value)

Callers: `servicer.py:3935`, `servicer.py:5367` (`_drain_held_symbols`); `live_loop.py:402`
(`_drain_held`). Sibling loops with the same shape (`live_loop.py:535` watchlists, `:601` signals,
`:178` fundamentals universe) are noted, not in scope of this report.

## Root cause hypothesis

Both loops were written before the token-looping consumer rule (feature 257) and copy the
pre-existing best-effort pattern: the loop exit trusts the server's token and the error path
returns accumulated state. Whether the fix shares one helper or hardens each site in place is a
design decision.

## Confidence

high
