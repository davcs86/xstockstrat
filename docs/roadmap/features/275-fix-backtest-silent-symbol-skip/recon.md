# Recon: fix-backtest-silent-symbol-skip

**Created**: 2026-10-22
**From**: product-spec.md
**Affected services**: xstockstrat-analysis (fix site); xstockstrat-indicators (read-only contract); xstockstrat-agent (docs only)

Line numbers were re-grepped on `origin/feature/fix-backtest-silent-symbol-skip` at `ed17c8c5`, which contains
`origin/main-dev` `c25efbdc`. Feature 272 has not landed: it is `implementation-ready` on main-dev, and so is 273.
Feature 215 is `in-progress`, but its `NO_TRADE_REASON_FUNDAMENTALS_UNAVAILABLE = 5` and `fundamentals_gap` are
already in the tree. After 272 lands, every analysis line number here needs re-anchoring.

---

## Objective

In the `RunBacktest` symbol loop, two branches catch every remaining error and skip the symbol silently: the
`grpc.RpcError` branch and the generic `Exception` branch. Neither adds a diagnostics row, a warning or a status-gate
counter. As a result, a run in which every symbol failed (staging: indicators `ExecuteFormula` PERMISSION_DENIED)
is reported as `BACKTEST_STATUS_OK` with zero trades, then scored, persisted and used to recompute the headline.
The fix gives each such failure a typed `SymbolDiagnostics` row and a warning that names the symbol and the gRPC
status. These failures then count toward the `INSUFFICIENT_DATA` gate, so an all-failed run is no longer OK. A
partial run stays OK. The trigger, formulas stored under a legacy username author, is out of scope
(`docs/reports/2026-10-22-indicators-legacy-username-formula-authors-defect.md`).

## Codebase Map

- **`xstockstrat-analysis`** (Python)
  - Handler: `AnalysisServicer.RunBacktest` — `services/xstockstrat-analysis/app/handlers/servicer.py:785`
  - Trace metadata for the whole run: `propagation_meta` is built from `context.invocation_metadata()` filtered to
    `x-user-id` / `x-access-scope` / `x-trace-id` at `servicer.py:806-810`. This is inside `RunBacktest`; recon
    digest 1 placed the `:806` hit in another method, which was wrong. The module constant is
    `_PROPAGATED_HEADERS` at `servicer.py:350`.
  - Gate counters: `coverage_gaps` `:901`, `formula_errors: int = 0` `:905`, `fund_refusals = 0` `:927`,
    `fund_unknown: list[str] = []` `:928`.
  - Symbol loop: `for symbol in symbols_to_run:` / `try:` at `:996-997`. The handlers, in order:
    - `except _InsufficientData` `:1065` (adds a `CoverageGap`)
    - `except _FundamentalsUnavailable` `:1086` (adds a `FUNDAMENTALS_UNAVAILABLE` row and increments `fund_refusals`, `:1094-1103`)
    - `except _FundamentalsUnknown` `:1104-1111` (appends to `fund_unknown`)
    - `except FormulaExecutionError` `:1112-1126` (adds a `FORMULA_ERROR` row and increments `formula_errors`)
    - **`except grpc.RpcError` `:1127-1129` and `except Exception` `:1130-1132`**: each logs a warning and continues. This is the defect.
  - Status gate: `:1235-1242`. The condition is `not all_trades and len(daily_equity) <= 1 and (coverage_gaps or formula_errors or fund_refusals or fund_unknown)`, which sets `INSUFFICIENT_DATA`; anything else is OK.
  - Diagnostics and warnings assembly: `result.diagnostics.extend` `:1251-1252`. Warnings come from the
    soft-deleted-formula list `:1255-1256`, the sector and seed warnings `:1257-1262`, and `fund_unknown`
    `:1263-1266` (`f"fundamentals fetch failed for {sym} — rerun"`).
  - Persistence and score:
    - Evidence cells are written only when the run is OK (`:1279-1288`).
    - `score = None` unless OK, then `_score_from_result` (`:1290-1299`; defined at `:6959`).
    - `_persist_backtest_run` is called unconditionally (`:1300`).
    - `_persist_backtest_detail` runs only when OK (`:1313-1314`).
    - The headline recompute runs when `status == OK or fund_refusals > 0` (`:1320`, which calls `_recompute_headline` defined at `:2811`).
  - `_BarFetchError` is defined at `:358` and raised at `:1445` (`_fetch_bars_paged`). It is **not** handled in
    `RunBacktest` today, so the bare `except Exception` at `:1130` swallows it. 272 adds
    `except _BarFetchError: raise`.
  - The per-symbol evaluator is built with `raise_unreadable=True` at `servicer.py:2035-2037`. On the backtest path,
    an `ExecuteFormula` NOT_FOUND therefore always becomes `FormulaExecutionError`.
  - A fundamentals `GetFormula` RpcError is caught inside the loader and recorded as `Availability.UNKNOWN`
    (`servicer.py:1846-1849`). It leaves through `_FundamentalsUnknown` (`:2063`), not the symbol-loop
    `except grpc.RpcError`, so the `@AC-8` path cannot be absorbed by the new handler.
  - `StrategyEvaluator._execute_formula` — `app/services/evaluator.py:254-266`:
    `if e.code() != grpc.StatusCode.NOT_FOUND: raise` (`:260-261`). NOT_FOUND becomes `FormulaExecutionError` only
    when `_raise_unreadable` is set (`:262-263`); otherwise the component is skipped (`:264-267`).
    PERMISSION_DENIED, UNAVAILABLE and similar codes propagate as `grpc.aio.AioRpcError` (a `grpc.RpcError`).
    The `FormulaExecutionError` docstring at `:105` says it exists "so the RunBacktest loop can stamp a distinct
    `NO_TRADE_REASON_FORMULA_ERROR`".
  - Last migration: `027_contract_owner_dimension.up.sql` (`services/xstockstrat-analysis/migrations/`). None is needed.
  - Config-read pattern, unchanged: `self._cfg.get_float(...)` / `get_int(...)` (`servicer.py:787-794`). No new key.
- **`xstockstrat-indicators`** (Python, read-only)
  - `ExecuteFormula` is `@owner_scoped`: `services/xstockstrat-indicators/app/handlers/servicer.py:233`.
  - Missing or pending formula: NOT_FOUND (`:238-242`). Admin caller who is not the author: PERMISSION_DENIED
    (`:243-250`, "admins cannot execute another user's formula"). Other non-author: NOT_FOUND (`:251-253`).
  - `_can_read_formula` allows the author or `SYSTEM_AUTHOR` only, with no admin bypass (`:141-148`). This is
    documented at `services/xstockstrat-indicators/CLAUDE.md:30-31`.
  - Last migration: `007_private_formulas_templates.up.sql`. None is needed.
- **`xstockstrat-agent`** (Python, docs only)
  - The tool is `run_backtest` (`services/xstockstrat-agent/app/tools.py:715`). Its docstring covers
    `INSUFFICIENT_DATA` only for coverage gaps (`:739-741`) and fundamentals refusals (`:768-778`). It says a run
    with no diagnostics and no trades has no attachment (`:749-750`).
  - A whole-RPC `AioRpcError` becomes `RuntimeError` (`tools.py:793-794`). The result is then passed through
    `backtest_view.summarize` (`:797`).
  - The client returns `MessageToDict(...)` (`services/xstockstrat-agent/app/client.py:561` onward). Enum names
    project automatically, so a new `NoTradeReason` value passes through with no code change.
  - `backtest_view.py`: `_SYMBOL_KEYS` at `:51` (it includes `no_trade_reason`), warnings copied at `:73-74`, and
    `_INTENTIONALLY_DROPPED` parity at `:30-32`. A new enum **value** needs no keep/drop decision; only a new
    **field** would.
- **`xstockstrat-ui`** (consumer surface only, not an affected service; checked here to close review warning 5 / C-14)
  - `services/xstockstrat-ui/src/components/insights/BacktestDiagnostics.tsx:41-52`:
    `const NO_TRADE_MESSAGE: Record<NoTradeReason, string>` is **exhaustive**. Adding a new `NoTradeReason` value
    breaks `tsc`/`pnpm build` until a key is added (ledger `fails.md:81-83`, feature 067).
  - `services/xstockstrat-ui/src/app/insights/strategies/[id]/page.tsx`:
    - Already renders `result.warnings` (`:509-516`, `data-testid="backtest-warnings"`).
    - Shows the coverage-gap banner only for `INSUFFICIENT_DATA` plus `coverageGaps[0]` (`:524-541`).
    - Renders `<BacktestDiagnostics>` for an `INSUFFICIENT_DATA` run when any `noTradeReason !== UNSPECIFIED`
      (`:569-574`).
    - So an all-failed `INSUFFICIENT_DATA` run already shows its warnings and diagnostics rows, provided the row
      carries a non-UNSPECIFIED reason.
  - The e2e mock and catalog reference no-trade reasons: `services/xstockstrat-ui/e2e/mock-backend.ts` and
    `services/xstockstrat-ui/e2e/fixtures/INVENTORY.md`, which is relevant to C-12/C-13 if a fixture is added.

## Patterns to REUSE

- The failed-symbol diagnostics row: reuse the `except FormulaExecutionError` template, which builds
  `analysis_pb2.SymbolDiagnostics(symbol=..., bars=[], no_trade_reason=..., bars_total=0, warmup_bars=0)`, appends
  it to `all_diagnostics` and increments a counter (`servicer.py:1112-1126`).
- The new gate term: add it next to the `formula_errors` / `fund_refusals` declarations (`:905`, `:927`) and to the
  `or`-chain at `:1238`.
- The per-symbol warning: reuse the `fund_unknown` list pattern, which collects symbols in the loop and extends
  `result.warnings` after the gate (`:928`, `:1263-1266`). Store `(symbol, e.code().name)` for RpcErrors.
- The trace id in the new log and warning path: reuse the run-scoped `propagation_meta` (`:806-810`). Read
  `x-trace-id` from it rather than minting a new context, as the operator's 2026-10-21 directive requires.
- The stub for indicators in tests: `AioRpcError(PERMISSION_DENIED)` on `ExecuteFormula`, following the existing
  NOT_FOUND tests in `services/xstockstrat-analysis/tests/test_unreadable_formula.py:220-221`.
- The `RunBacktest` test harness: `from tests.test_analysis_servicer import _owned_ctx, make_servicer`
  (`tests/test_analysis_servicer.py:36`, `:63`), as `tests/test_backtest_fundamentals_guard.py:23-25` does. That
  file also uses `_squeeze()` (`:91`), `_bars(symbol)`, `_diag(result, sym)` (`:320`), warning asserts (`:244`,
  `:285`, `:304`) and `logging`-based log checks.
- The closest sibling suite is `TestFormulaErrorSurfacing` (`tests/test_analysis_servicer.py:1614`).
- The `_BarFetchError` assertion style for AC-6: `pytest.raises(_BarFetchError, ...)` (`tests/test_warmup.py:260`).
- An agent pass-through test, if one is wanted: clone
  `test_insufficient_data_run_has_coverage_gaps_inline_and_no_attachment` (`services/xstockstrat-agent/tests/test_tools.py:838-851`).
- Consumer docs prose: mirror the feature-215 paragraph style in three places:
  - `plugins/strat-lab/skills/backtest/SKILL.md:164-173`
  - `plugins/strat-lab/skills/backtest/reference/output-handling.md:21-26` (the `no_trade_reason` list)
  - `tools.py:768-778` (docstring)
- Run commands:
  - `uv run pytest` in `services/xstockstrat-analysis`
  - `uv run pytest --cov=app --cov-fail-under=40` in `services/xstockstrat-agent`
  - `pnpm build` / vitest in `services/xstockstrat-ui` if the enum changes

## Existing Business Rules (preserve / extend)

**Feature 215 rules (`services/xstockstrat-analysis/acceptance/block-fundamentals-strategy-on-etf.feature`)**

- **PRESERVE** `@AC-2 @FR-2 @feature-215` "A fundamentals-gated backtest on an ETF returns an explicit reason, not a
  silent no-trade". `NO_TRADE_REASON_FUNDAMENTALS_UNAVAILABLE` (= 5) remains the ETF-refusal reason. The new reason
  must be a different value.
- **PRESERVE** `@AC-5 @FR-6 @feature-215` "The refusal is auditable". The enumerated reason appears on the returned
  result, not only in the logs, and the new rows follow the same rule.
- **PRESERVE** `@AC-8 @FR-8 @feature-215` "A fundamentals outage is not reported as absence". The
  `fundamentals fetch failed for <SYM> — rerun` warning keeps its wording and meaning. The new handler cannot
  absorb this path, because the loader converts the RpcError into UNKNOWN (`servicer.py:1846-1849`).
- **PRESERVE** `@AC-11 @FR-9 @feature-215` "The derived grade excludes refused symbols without deleting evidence".
  The recompute keeps keying on `status == OK or fund_refusals > 0` (`:1320`), and the new counter is **not**
  added there. Making the recompute depend on status alone would CHANGE this rule and needs sign-off. Not proposed.
- **PRESERVE** `@AC-13 @FR-3 @FR-8 @feature-215` "A bars outage on a fundamentals strategy stays a data-unavailable
  row and heals correctly". This is the opportunities path, and the per-symbol RpcError handling there stays as it is.

**Other analysis rules**

- **PRESERVE** `@AC-4 @FR-4 @feature-152` "Insufficient benchmark history names the benchmark in coverage_gaps"
  (`services/xstockstrat-analysis/acceptance/market-regime-benchmark-operand.feature`).
- **PRESERVE** `@AC-3 @regression @feature-149` "Per-symbol evidence cells and the derived grade are unchanged"
  (`services/xstockstrat-analysis/acceptance/fix-backtest-annualized-return.feature`).
- **PRESERVE** `@AC-5 @FR-4 @feature-150` "The derived grade is unchanged by portfolio mode"
  (`services/xstockstrat-analysis/acceptance/backtest-portfolio-sizing.feature`).
- **PRESERVE** `@AC-6 @FR-4 @feature-151` "Per-bar diagnostics stay aligned with the fill bar"
  (`services/xstockstrat-analysis/acceptance/backtest-next-bar-fill.feature`). The new rows use `bars=[]`, and
  evaluated symbols are unaffected.

**Feature 224 rules (`services/xstockstrat-analysis/acceptance/private-by-default-templates.feature`)**

- **PRESERVE** `@AC-5 @FR-3 @feature-224` "analysis cannot execute a formula its strategy owner does not own". The
  `ExecuteFormula` call keeps the owner's `x-user-id` and sends no `x-internal-caller`.
- **PRESERVE** `@AC-30 @FR-3 @feature-224` "Registering a strategy that references an unreadable formula warns at
  write time". The NOT_FOUND → `FormulaExecutionError` mapping and the `FORMULA_ERROR` branch are untouched, unless
  the design picks fork 2(a), which is an extension.
- **PRESERVE** `@AC-21 @FR-10 @feature-224` "Same strategy_id for two users does not share scores or backtests".

**Indicators rules (read-only for this feature)**

- **PRESERVE** `@AC-28 @FR-13 @feature-224` "Admins can read but not change another user's objects"
  (`services/xstockstrat-indicators/acceptance/private-by-default-templates.feature`).
- **PRESERVE** `@AC-1 @FR-1 @feature-224` "Another user's formulas are invisible even if formerly public" (same file).
- **PRESERVE** `@AC-2 @FR-2 @feature-225` "The analysis formula-read bypass is gone" and `@AC-10 @FR-1 @feature-225`
  "An identified non-owner keeps the non-owner result"
  (`services/xstockstrat-indicators/acceptance/private-by-default-enforce-contract.feature`).

**Agent and platform rules**

- **PRESERVE** `@AC-8 @FR-7 @feature-198` "Agent run_backtest accepts a fundamental operand"
  (`services/xstockstrat-agent/acceptance/historical-fundamentals-backtest.feature`). The descriptor-parity test
  must stay green.
- **PRESERVE** `@AC-32 @FR-12 @feature-224` "Agent docs and strat-lab skill stay in parity with the tool contract"
  (`docs/sdd/business-rules/platform.feature`). Edits to the skill and to `mcp-tools.md` must keep
  `list_templates` / `instantiate_template` listed and must not mention `is_public` / `include_public`.

**Extensions**

- **EXTEND** `@AC-4 @feature-152` and `@AC-11 @feature-215`. This feature adds evaluation failures (RPC or
  unexpected) as a new `INSUFFICIENT_DATA` gate term. The existing terms keep their behavior.

**Not read**

- `xstockstrat-ui` has an acceptance suite, `services/xstockstrat-ui/acceptance/backtest-next-bar-fill.feature`,
  which matched on "diagnostics". It has not been read. Re-check it if the design adds a UI step.

## Dependencies

- **Proto/RPC.** `NoTradeReason` is at `packages/proto/analysis/v1/analysis.proto:196-203`. Its last value is
  `NO_TRADE_REASON_FUNDAMENTALS_UNAVAILABLE = 5`, and `FORMULA_ERROR = 4` carries the comment "a custom-formula
  component failed to execute / returned an out-of-contract series". The design fork:
  - (a) Reuse 4. No proto change, but it is semantically wrong for a `GetBars`/`ComputeIndicator` failure or an
    unexpected exception.
  - (b) Add one value at **6 or higher**. This is additive and not breaking, and it brings in: `./scripts/buf-gen.sh`
    and committed stubs; `buf lint` / `buf breaking` / `proto-freshness`; review by the analysis proto owner; and a
    **same-PR UI edit** to the exhaustive `NO_TRADE_MESSAGE` map (fails.md:81-83).
  - No new message field is expected. A new field would need an agent `_INTENTIONALLY_DROPPED` keep/drop decision.
- **Migration:** none. The next free numbers would be analysis `028` and indicators `008`; neither is used.
- **Config keys:** none.
- **Inter-service edges:** no new ones. The existing edges are analysis → indicators (`ExecuteFormula`,
  `ComputeIndicator`) and analysis → marketdata (`GetBars`). The agent → analysis `RunBacktest` call is unchanged.
- **New env vars or ports:** none.

## Risks / Not-found

**Merge-order and contract risks**

- **Hard overlap with 272. It must land first.** On the current tree, `except Exception` at `:1130` swallows
  `_BarFetchError` and also catches 272's future timeout and cancellation surfaces. The new handling must sit after
  272's `except _BarFetchError: raise`.
  - `asyncio.CancelledError` is a `BaseException` and is not caught by `except Exception`. However,
    `TimeoutError` raised by `asyncio.timeout` **is** an `Exception` subclass. If 272's timeout is raised inside the
    loop, the generic branch would catch it. Re-check 272's landed shape and put an explicit re-raise ahead of the
    catch-all if needed (FR-7).
  - 272 also renames the body to `_run_backtest`, so every analysis line in this dossier needs re-anchoring.
- **Overlap with 215, which is in progress:** the same gate expression (`:1238`) and the same `analysis.proto`
  file. Whichever merges second regenerates the stubs and re-runs `buf breaking`. No `NoTradeReason` number above
  5 is claimed today.
- **Overlap with 273:** a docs-level rebase on the strat-lab skill and the agent `run_backtest` text.
- **Ledger traps that apply**
  - `fails.md:81-83` (067): appending an enum value without updating the exhaustive TS `Record` breaks the UI
    build. Fork (b) needs a UI step and a frontend build check.
  - `insights.md:165-175` (071): the reverse case. Check that existing reasons stay reachable and that the new
    one is actually reached, through a UI test or fixture.
  - `fails.md:307-309`: the docs for an agent tool must change in the same PR, and keep parity. This affects the
    docstring at `tools.py:739-778`, `docs/runbooks/mcp-tools.md:282-317` (insert next to `:308-310`), `SKILL.md`
    and `reference/output-handling.md`.
  - `fails.md:118-133`: a graceful skip must never be silent. This defect is exactly that pattern.

**Design forks still open (from context.md)**

- (1) Which reason channel to use: reuse 4, add 6, or a warning-only path. A warning-only path would fail FR-1/FR-2,
  which require a non-UNSPECIFIED reason.
- (2) Where to map a non-NOT_FOUND `ExecuteFormula` error: in `_execute_formula` (`evaluator.py:254`), or in the
  loop, which also covers `GetBars`/`ComputeIndicator`.
- (3) The warning text must carry `e.code().name` without leaking more foreign-formula detail than indicators
  returned. Prefer the code name over `e.details()`.

**Gaps and smaller risks**

- **Trace id in the log line.** The current log lines at `:1128` and `:1131` have no `x-trace-id`. No helper that
  puts the trace id into analysis log records was found by this grep: there are no `trace_id` hits in
  `servicer.py` log calls. Design decides whether the new warning path reads `x-trace-id` from `propagation_meta`.
  FR-7's test step must assert the metadata stays intact.
- **Review warning 6, unconfirmed.** A partial run whose single evaluated symbol has no trades and a flat curve
  would become `INSUFFICIENT_DATA` under the extended gate. This is consistent with FR-6, which requires trades or
  a usable curve, but design must confirm it.
- **Not found**
  - No existing test covers a non-NOT_FOUND RpcError or a generic exception in the `RunBacktest` symbol loop. Only
    `_BarFetchError` and `FORMULA_ERROR` were grepped by name.
  - `tests/test_backtest_runs_repo.py`, `tests/test_backtest_details_repo.py` and
    `tests/test_backtest_run_symbols_repo.py` were not read; they may be needed for AC-4 persistence asserts.
- **Doc drift to fix in the same PR.** `services/xstockstrat-analysis/CLAUDE.md:109` says "INSUFFICIENT runs record
  history with a 0 score / empty rating". The code stores `score = None` (`servicer.py:1290-1299`). Run the root
  Teardown audit.

## Recommended Scope

These are advisory step boundaries, input for the grilling and for `/sdd-spec`.

1. **(If fork 1b) Proto.** Add `NoTradeReason` value 6, for example `NO_TRADE_REASON_EVALUATION_FAILED`, with a
   comment. Run `./scripts/buf-gen.sh` and commit the stubs. In the **same step**, add the
   `BacktestDiagnostics.tsx` `NO_TRADE_MESSAGE` key so the UI build stays green.
2. **Analysis fix after 272 is re-anchored**
   - Add an `eval_failures` counter and failure list.
   - The `except grpc.RpcError` and `except Exception` branches each append a typed diagnostics row, record
     `(symbol, code name | "error")`, and increment the counter. Keep 272's `except _BarFetchError: raise`, and any
     timeout re-raise, ahead of them.
   - Add the counter to the `:1238` gate only, never to the `:1320` recompute condition.
   - Emit the warnings after the gate in the `fund_unknown` style.
3. **Analysis tests, RED before GREEN**
   - AC-1: PERMISSION_DENIED on `ExecuteFormula` makes the run `INSUFFICIENT_DATA`, with a row and a warning.
   - AC-2: a `GetBars` UNAVAILABLE failure.
   - Generic exception.
   - Partial run stays OK.
   - AC-4: no detail row, no evidence cell, null score, and no recompute unless `fund_refusals`.
   - AC-6: `_BarFetchError` still propagates.
   - FR-7: the trace-id metadata is kept.
   - Regression: the 215 `@AC-8` / `@AC-11` tests stay green.
4. **Consumer docs, in the same PR**
   - The strat-lab `SKILL.md` paragraph and the `reference/output-handling.md` reason list.
   - The agent `tools.py` docstring paragraph.
   - A `docs/runbooks/mcp-tools.md` bullet.
   - An optional agent pass-through test.
   - The `services/xstockstrat-analysis/CLAUDE.md` null-score drift fix, and a UI e2e fixture or `INVENTORY.md`
     entry if the reason is new.
5. **Merge-order rows at `/sdd-spec`** (operator confirms): 275 is blocked by 272, 273 and 215.
