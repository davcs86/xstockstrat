# Product Spec: fix-screener-symbol-isolation

**Type**: bug
**GitHub Issue**: none. Defect report: `docs/reports/2026-10-19-analysis-screener-no-per-symbol-isolation-defect.md`
**Severity**: SEV-2
**Created**: 2026-10-20

---

## Problem Statement

**Observed.** `screen()` fans out `_eval_symbol` with `asyncio.gather` and no `return_exceptions`
(`services/xstockstrat-analysis/app/services/screener.py:115`). `_eval_symbol` catches only `grpc.RpcError`
at its RPC sites (`:229`), plus two TypeError/ValueError sites (`_extra_metric` `:312`, `_latest_value`
`:521`). Any other exception for one symbol, such as an arithmetic error or a failure in
`scoring.compute_signal_score` (`:256`), propagates out of `gather` and fails the whole `ScreenSymbols`
RPC, and every other symbol's result is lost. A per-symbol `ValueError` (e.g. `float(...)` at
`:404`/`:406`, or `_latest_value`'s list branch at `:517`) is mapped by the servicer to INVALID_ARGUMENT,
mislabelling a data fault as a bad request
(`services/xstockstrat-analysis/app/handlers/servicer.py:3797-3800`); any other exception surfaces as gRPC
UNKNOWN. Feature 160 fixed one trigger (`bar.time`) and added no isolation. Feature 176's concurrent fan-out
kept the serial loop's missing try/except.

**Who is hit.** A trader or analyst screening a universe on `/insights/screener` or the per-position
Screening section, and an AI agent calling `screen_symbols`: one bad symbol costs them every other row.

**Expected.** A failing symbol degrades only its own row, and the scan completes for every other symbol
(FR-1..FR-3).

## Reproduction Steps

1. In a test, set `signal_sources ["fundamentals"]` and `signal_weight 1` (without both, `_fetch_signals`
   returns `{}` and `:256` is never reached; `screener.py:316`), give every symbol at least one active
   `fundamentals` signal and at least one bar (`:253-255`), and make `scoring.compute_signal_score` raise
   `ZeroDivisionError` for one symbol.
2. Call `ScreenSymbols` over 50 symbols.
3. The RPC aborts with UNKNOWN, and no results are returned for the other 49.
4. With `ScreenerEngine._latest_indicator` (called at `:284`, defined at `:288`) raising `ValueError` for
   one symbol instead, the RPC aborts with INVALID_ARGUMENT.

## Root Cause Hypothesis

`_eval_symbol` has no outer guard, and `gather` without `return_exceptions` propagates the first raised
exception. That exception aborts the RPC.

Design forks:
- **Degraded-row shape.** Options are `score_unavailable` (proto field 14, feature 144) or dropping the
  row. `SCREEN_RESULT_STATUS_INSUFFICIENT_DATA` is excluded. A gap-less INSUFFICIENT_DATA row joins
  `pendingRows`, starts the `/insights/screener` auto-recheck poll
  (`services/xstockstrat-ui/src/app/insights/screener/page.tsx:120-129`) and renders the "Fundamentals
  pending" badge (`:241-254`). `SymbolScreening` renders it as "Not enough data to screen"
  (`SymbolScreening.tsx:236-248`). Both are wrong for a code fault, and feature 144 kept the status for
  transient causes only (`services/xstockstrat-analysis/docs/context-constitution.md:42`).
- **Isolation point.** Wrap per symbol (inside `_eval_symbol` or a wrapper), or use
  `return_exceptions=True`. Either way, `asyncio.CancelledError` from the scan deadline
  (`analysis.screener.max_duration_seconds`) must not be swallowed.
- **Partial raws.** Whether a degraded row keeps raws set before the raise (e.g. `sig` before `rsi`
  fails). `_normalize_universe` min-max normalises over every row carrying a raw
  (`screener.py:409-437`), so kept raws change the other 49 scores; design pins AC-1's score oracle.
  Design writes the pinned oracle back into AC-1 as wording only, keeping the AC IDs. Example: each of the
  other 49 rows equals the row the same request returns over the 49 symbols without BAD.

## Affected Services

- xstockstrat-analysis

## Consumer Surface(s)

Read-only behaviour change. These callers now get partial results instead of an UNKNOWN / INVALID_ARGUMENT
error:
- agent MCP `screen_symbols`;
- the `xstockstrat-ui` `/insights/screener` page (`services/xstockstrat-ui/src/app/insights/screener/page.tsx`;
  already renders `scoreUnavailable`, `:182-184`, `:256-258`);
- the `/trader/positions/[symbol]` single-symbol Screening section (`SymbolScreening`,
  `services/xstockstrat-ui/src/components/trader/SymbolScreening.tsx:41-68`, mounted at
  `services/xstockstrat-ui/src/app/trader/positions/[symbol]/page.tsx:566`). Today it shows the error text
  (`symbol-screen-error`, `:228-230`); after the fix it gets a degraded row.

No UI or agent code change is anticipated **only if** a kept degraded row carries `passed=false` and
`score_unavailable=true`, and never INSUFFICIENT_DATA (AC-1; see Degraded-row shape).
The agent client drops `score_unavailable` (`services/xstockstrat-agent/app/client.py:758-767`) and the
tool says "Filter candidates on `passed`" (`services/xstockstrat-agent/app/tools.py:846`).
`SymbolScreening` checks only INSUFFICIENT_DATA (`:64`) and never reads `scoreUnavailable`. `_build_result`
leaves `passed=True` for an all-soft row with no raws (`screener.py:457-475`). So a `score_unavailable`-only
row would reach these consumers as an OK, passing candidate: the `bef4258` scar
(`services/xstockstrat-analysis/docs/context-constitution.md:41`). `/sdd-design` confirms the claim against
the chosen shape. If the chosen shape needs agent or UI work, C-14 requires an implementation step or a
named follow-up feature.

## Functional Requirements

- **FR-1** — An exception (an `Exception` subclass, e.g. `ZeroDivisionError`, `ArithmeticError`,
  `ValueError`) raised while evaluating one symbol in the `screen()` fan-out (`screener.py:115`) degrades
  only that symbol's row. The RPC returns OK with a result row for every other symbol. The failing
  symbol does not rank above any other row. If its row is kept, it has `passed=false` and
  `score_unavailable=true`, so it sorts after every genuinely-scored row (`screener.py:152`) and never
  reads as a plain OK result. It is never SCREEN_RESULT_STATUS_INSUFFICIENT_DATA. One WARN log names
  the symbol. Keeping or dropping the row is a design fork; design pins it here.
- **FR-2** — The scan deadline (`analysis.screener.max_duration_seconds`, `servicer.py:3786-3795`)
  still cancels the whole scan. Per-symbol isolation does not absorb `asyncio.CancelledError`, and the
  RPC fails DEADLINE_EXCEEDED with no result rows.
- **FR-3** — Request-level validation before the fan-out (`_validate_fundamental_metrics`,
  `screener.py:376-393`) still rejects the whole request as INVALID_ARGUMENT (`servicer.py:3797-3801`).
  Isolation covers only per-symbol evaluation.

## Fix Scope

- [x] No proto changes anticipated: the existing `ScreenResultStatus` / `score_unavailable` cover a
  degraded row. Escalate to full design if a new enum value is chosen.
- [x] No database migrations anticipated
- [x] No config key changes anticipated

## Acceptance Criteria

See `acceptance.feature` (Constitution **C-15**): AC-1 → FR-1, AC-2 → FR-2, AC-3 → FR-3. Red-before-green
(**P-06**) applies to AC-1 only: it must fail on the buggy behavior and pass after the fix. AC-2 and AC-3
are preservation guards; they pass on the current code (`servicer.py:3791-3800`) and must keep passing,
so the `/sdd-spec` TDD gate demands no failing test for them. Also, existing tests pass and the affected
service is smoke-tested on dev.

## Out of Scope

- Refactoring unrelated to the bug
- Performance improvements unrelated to the fix
- Fixing the individual exception triggers; this feature adds isolation only
- Changing deadline or request-validation semantics (preserved by FR-2, FR-3)
- The sibling un-isolated fan-outs in `servicer.py`: EvaluateReadiness `asyncio.gather` (`:3983`) and the
  opportunities `_row_for` gather (`:5776`). They have the same defect class: a gather with no
  `return_exceptions`, and `_row_for` catches only `grpc.RpcError` (`:5693`). Neither is tracked yet;
  each needs its own defect report (`/sdd-qa defect`).
