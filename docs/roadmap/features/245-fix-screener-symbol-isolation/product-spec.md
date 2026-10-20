# Product Spec: fix-screener-symbol-isolation

**Type**: bug
**GitHub Issue**: none. Defect report: `docs/reports/2026-10-19-analysis-screener-no-per-symbol-isolation-defect.md`
**Severity**: SEV-2
**Created**: 2026-10-20

---

## Problem Statement

**Observed.** `screen()` fans out `_eval_symbol` with `asyncio.gather` and no `return_exceptions`
(`services/xstockstrat-analysis/app/services/screener.py:115`). `_eval_symbol` catches only `grpc.RpcError`
at its RPC sites (`:229`, plus one TypeError/ValueError site). Any other exception for one symbol, such as an
arithmetic error or a failure in `scoring.compute_signal_score` (`:256`), propagates out of `gather` and
fails the whole `ScreenSymbols` RPC, and every other symbol's result is lost. A per-symbol `ValueError`
(e.g. `float(...)` at `:404`/`:406`, or `_latest_value`'s list branch at `:517`) is mapped by the servicer
to INVALID_ARGUMENT, mislabelling a data fault as a bad request
(`services/xstockstrat-analysis/app/handlers/servicer.py:3797-3800`); any other exception surfaces as gRPC
UNKNOWN. Feature 160 fixed one trigger (`bar.time`) and added no isolation. Feature 176's concurrent fan-out
kept the serial loop's missing try/except.

**Expected.** A failing symbol degrades only its own row, and the scan completes for every other symbol.

## Reproduction Steps

1. In a test, set `signal_sources ["fundamentals"]` and `signal_weight 1` (without both, `_fetch_signals`
   returns `{}` and `:256` is never reached; `screener.py:316`), and make `scoring.compute_signal_score`
   raise `ZeroDivisionError` for one symbol.
2. Call `ScreenSymbols` over 50 symbols.
3. The RPC aborts with UNKNOWN, and no results are returned for the other 49.
4. With `ScreenerEngine._latest_indicator` (`:284`) raising `ValueError` for one symbol instead, the RPC
   aborts with INVALID_ARGUMENT.

## Root Cause Hypothesis

`_eval_symbol` has no outer guard, and `gather` without `return_exceptions` propagates the first raised
exception. That exception aborts the RPC.

Design forks:
- **Degraded-row shape.** Options are `SCREEN_RESULT_STATUS_INSUFFICIENT_DATA`, `score_unavailable`
  (proto field 14, feature 144), or dropping the row. Feature 144 notes that INSUFFICIENT_DATA drives the
  UI re-check polling loop, which is correct only for transient causes.
- **Isolation point.** Wrap per symbol (inside `_eval_symbol` or a wrapper), or use
  `return_exceptions=True`. Either way, `asyncio.CancelledError` from the scan deadline
  (`analysis.screener.max_duration_seconds`) must not be swallowed.

## Affected Services

- xstockstrat-analysis

## Consumer Surface(s)

Read-only behaviour change. These callers now get partial results instead of an UNKNOWN / INVALID_ARGUMENT
error:
- agent MCP `screen_symbols`;
- the `xstockstrat-ui` screener page (`ScreenSymbols`);
- the `/trader/positions/[symbol]` single-symbol Screening section (`SymbolScreening`,
  `services/xstockstrat-ui/src/components/trader/SymbolScreening.tsx:41-68`, mounted at
  `services/xstockstrat-ui/src/app/trader/positions/[symbol]/page.tsx:566`). Today it shows the error text
  (`symbol-screen-error`, `:228-230`); after the fix it gets a degraded row.

No UI or agent code change is anticipated **only if** the degraded row carries `passed=false` (AC-1).
The agent client drops `score_unavailable` (`services/xstockstrat-agent/app/client.py:758-767`) and the
tool says "Filter candidates on `passed`" (`services/xstockstrat-agent/app/tools.py:846`).
`SymbolScreening` checks only INSUFFICIENT_DATA (`:64`) and never reads `scoreUnavailable`. `_build_result`
leaves `passed=True` for an all-soft row with no raws (`screener.py:457-475`). So a `score_unavailable`-only
row would reach these consumers as an OK, passing candidate: the `bef4258` scar
(`services/xstockstrat-analysis/docs/context-constitution.md:41`). `/sdd-design` confirms the claim against
the chosen shape.

## Fix Scope

- [x] No proto changes anticipated: the existing `ScreenResultStatus` / `score_unavailable` cover a
  degraded row. Escalate to full design if a new enum value is chosen.
- [x] No database migrations anticipated
- [x] No config key changes anticipated

## Acceptance Criteria

See `acceptance.feature` (Constitution **C-15**). Red-before-green (**P-06**) applies to AC-1 only: it must
fail on the buggy behavior and pass after the fix. AC-2 and AC-3 are preservation guards; they pass on the
current code (`servicer.py:3791-3800`) and must keep passing, so the `/sdd-spec` TDD gate demands no
failing test for them. Also, existing tests pass and the affected service is smoke-tested on dev.

## Out of Scope

- Refactoring unrelated to the bug
- Performance improvements unrelated to the fix
- Fixing the individual exception triggers; this feature adds isolation only
