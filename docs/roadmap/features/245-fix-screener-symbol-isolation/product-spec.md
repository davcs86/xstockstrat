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
arithmetic error or a failure in `scoring.compute_signal_score` (`:256`), propagates. It fails the whole
`ScreenSymbols` RPC as gRPC UNKNOWN, and every other symbol's result is lost. Feature 160 fixed one trigger
(`bar.time`) and added no isolation. Feature 176's concurrent fan-out kept the serial loop's missing
try/except.

**Expected.** A failing symbol degrades only its own row, and the scan completes for every other symbol.

## Reproduction Steps

1. In a test, make `scoring.compute_signal_score` raise `ZeroDivisionError` for one symbol.
2. Call `ScreenSymbols` over 50 symbols.
3. The RPC aborts with UNKNOWN, and no results are returned for the other 49.

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

Read-only behaviour change; no UI or agent code change. These callers now get partial results instead of an
UNKNOWN error:
- agent MCP `screen_symbols`;
- the `xstockstrat-ui` screener page (`ScreenSymbols`).

## Fix Scope

- [x] No proto changes anticipated: the existing `ScreenResultStatus` / `score_unavailable` cover a
  degraded row. Escalate to full design if a new enum value is chosen.
- [x] No database migrations anticipated
- [x] No config key changes anticipated

## Acceptance Criteria

See `acceptance.feature`: the regression scenario(s) must fail on the buggy behavior and pass after the
fix (Constitution **C-15**). Also, existing tests pass and the affected service is smoke-tested on dev.

## Out of Scope

- Refactoring unrelated to the bug
- Performance improvements unrelated to the fix
- Fixing the individual exception triggers; this feature adds isolation only
