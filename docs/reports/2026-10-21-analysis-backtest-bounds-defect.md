# Defect: Analysis bar pagination silently returns a partial series on a re-served page, and the seeded backtest wall-clock limit is never enforced

**Recorded**: 2026-10-21
**Severity**: SEV-2
**Impact type**: silent-partial-backtest-data
**Environment**: dev (main-dev) @ a053b0e
**Affected service(s)**: xstockstrat-analysis, xstockstrat-config
**Config-only fix possible**: no
**Source**: repo-surveyor debt-radar scan (`docs/repo-surveyor/debt-radar-findings.md` @ 4535695), findings D-28, D-29. Grouped by service + theme (backtest input and runtime bounds in analysis). Config is listed because D-29's key is seeded by config migrations; retiring it would need a config migration, and wiring it needs only an analysis read.

## Observed

### D-28 — Bar pagination returns a partial series silently on a re-served page

`_fetch_bars_paged` documents "a partial series must never be returned silently". It says a re-served page (marketdata
falls back to `cursor = start` on an unparseable token and re-serves the identical page and token) turns into "a loud
failure". The code does the opposite. When a page after the first contributes no strictly-newer bar, it returns the
bars collected so far (`if not fresh: return bars`). With a stuck token, every caller (backtest, warm-up prefix,
screener and readiness paths) receives the first page only, with no error. The newest bars are lost, and the
backtest runs on a truncated window. The existing test `test_identical_page_with_identical_token_terminates` asserts
this partial result (`[1, 2]`) as correct, so CI locks the silent truncation in.

### D-29 — `analysis.backtest.max_duration_seconds` is seeded and documented but never read

Config migrations seed `analysis.backtest.max_duration_seconds` (300, and 120 for production), and analysis
`CLAUDE.md` documents it as "Max backtest run time". Nothing in `services/xstockstrat-analysis/app` reads it.
`RunBacktest` has no `asyncio.wait_for` or other deadline. The only `max_duration_seconds` read is the screener's own
key. An operator who lowers the key gets no effect, and a long backtest is bounded only by the caller's gRPC deadline.
The key is not listed in `docs/reports/2026-10-19-dead-config-keys-defect.md`.

## Expected

- D-28: on a page requested with a non-empty `page_token`, a response that adds no strictly-newer bar raises
  `_BarFetchError` ("refusing to return a truncated series"). A genuine EOF (an empty first page, or an empty
  `next_page_token`) still returns normally.
- D-29: either `RunBacktest` enforces `analysis.backtest.max_duration_seconds` (aborting with `DEADLINE_EXCEEDED` when
  exceeded), or the key is retired by a config migration and removed from the analysis `CLAUDE.md` key table. Design
  decides which.

## Reproduction

1. D-28: in `services/xstockstrat-analysis/tests/test_warmup.py`, run the existing
   `test_identical_page_with_identical_token_terminates` case: pages `[bar 1, bar 2]` with token `"stuck"`, repeated.
   `_fetch_bars_paged` returns `[1, 2]` after 2 calls, with no error.
2. D-29: `grep -rn "backtest.max_duration_seconds" services/xstockstrat-analysis/app` → no hits. Set the key to 1 and
   run a backtest whose evaluation takes more than 1 s; it completes normally.

## Evidence

### D-28

`services/xstockstrat-analysis/app/handlers/servicer.py:1394-1412` (docstring; scan cited `:1432-1435`)
> Safety properties (a partial series must never be returned silently):
> - **Strict cursor monotonicity.** ... re-serving the identical page with the identical token; this
>   turns that infinite loop into a loud failure.

`services/xstockstrat-analysis/app/handlers/servicer.py:1428-1435` (unchanged)
> fresh = [
>     b for b in page if last_seen is None or (b.time.seconds, b.time.nanos) > last_seen
> ]
> if not fresh:
>     # Either genuine EOF, or a server that re-served an already-consumed page.
>     # Both are terminal; neither should loop.
>     return bars

`services/xstockstrat-analysis/tests/test_warmup.py:236-243` (locks the partial result in)
> bars = await svc._fetch_bars_paged("AAPL", common_pb2.TimeRange(), [])
> assert [b.time.seconds for b in bars] == [1, 2]

Callers: `servicer.py:1464`, `:1472`, `:1924`, `:1926`, `:1955`, `:4961`, `:5570`.

### D-29

`services/xstockstrat-config/migrations/001_config_tables.up.sql:69`
> ('analysis',  'backtest.max_duration_seconds',  'int',    '300',   'Max backtest wall-clock time', ...

`services/xstockstrat-config/migrations/002_config_environment.up.sql:71`
> ('analysis',  'backtest.max_duration_seconds',  'int',    '120',   'Max backtest wall-clock time (prod)', ...

`services/xstockstrat-analysis/CLAUDE.md:468`
> | `analysis.backtest.max_duration_seconds` | int | `300` | Max backtest run time |

`services/xstockstrat-analysis/app/handlers/servicer.py:785` (`RunBacktest`, no deadline); the only reads of a
`max_duration_seconds` key are the screener's (`:3786`).

## Root cause hypothesis

D-28: the monotonicity guard was added to stop an infinite loop and chose "return what we have" for both EOF and a
re-served page. It does not tell them apart by whether a token was sent. D-29: the key was seeded in the first config
migration ahead of an implementation that never landed.

## Confidence

high
