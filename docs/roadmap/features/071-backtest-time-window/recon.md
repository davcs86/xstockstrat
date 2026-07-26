# Recon: backtest-time-window

**Created**: 2026-07-26
**From**: product-spec.md
**Affected services**: xstockstrat-analysis, xstockstrat-agent, xstockstrat-ui

---

## Objective

Let the `run_backtest` MCP tool pass an explicit `start`/`end` window, and make the backtest engine
seed indicators from **pre-window** history so they are already warm at `start` (no trade before
`start`, no data after `end` informing any in-window bar). The window itself already exists
end-to-end at the RPC layer — this feature fills the agent surface and adds the warm-up prefix.

## Codebase Map

- **`xstockstrat-analysis`** (Python 3.12)
  - Handler/servicer: `services/xstockstrat-analysis/app/handlers/servicer.py`
  - `RunBacktest` entry: `servicer.py:178`
  - Range cap + in-place defaulting: `servicer.py:273-297` (mutates `request.range.start/end`, so
    every downstream consumer sees a fully-set range)
  - Per-symbol dispatch to the two engine paths: `servicer.py:313-341`
  - GetBars (legacy/SMA path): `servicer.py:551-559` — `timeframe="1d"` + `timeframe_enum`
  - GetBars (evaluator path): `servicer.py:802-810` — same shape. **Neither sets `page`.**
  - Legacy warm-up computation: `servicer.py:628-629` (observed — first bar where both SMAs resolve)
  - Evaluator warm-up computation: `_compute_evaluated_warmup`, `servicer.py:949-984`
    (built-in → observed `_first_resolved_index`; custom formula → **declared** `warmup_period` via
    `GetFormula`, cached per `formula_id`)
  - `_first_resolved_index`: `servicer.py:1582-1588`
  - No-trade classifier: `_classify_no_trade_reason`, `servicer.py:1591-1598`
  - Diagnostics warm-up overlay: `_finalize_symbol_diagnostics`, `servicer.py:1601-1624`
  - Insufficient-data carrier: `_InsufficientData`, `servicer.py:59-70`; legacy `bars_need =
    slow_period + 2` (`:561-565`); evaluator `bars_need = 2` (`:812-814`)
  - `CoverageGap` population: `servicer.py:371-380`; run-level status gate: `servicer.py:439-442`
  - Feature-065 evidence cells: buffered `servicer.py:347-359`, range stamped `servicer.py:451-469`,
    persisted `servicer.py:1240-1272`
  - Evaluator: `app/services/evaluator.py` — `evaluate` `:102-116`, `evaluate_with_series` `:118-169`,
    `align_indicator_points` `:251-266`, formula `len == n` contract `:234-238`
  - Live loop: `app/engine/live_loop.py` — `_LOOKBACK_DAYS = 365` `:34`, `_recent_range` `:116-121`,
    GetBars `:124-127`, `evaluator.evaluate` `:133` (uses only `decisions[-1]`, `:137`)
  - Last migration: `009_strategy_cooldowns` → next free **`010`** (none needed)
  - Config-read pattern: `app/config/watcher.py` — `get_int` `:68`, `get_float` `:84`
  - Tests: `tests/test_analysis_servicer.py` — `TestBacktestRangeCap` `:1311`,
    `TestBacktestDiagnostics` `:1003`, `test_no_look_ahead_warmup_and_series` `:1086`,
    `test_formula_warmup_uses_declared_not_observed` `:1158`,
    `test_backtest_reproducible_across_runs` `:2274`, `TestRunBacktestCells` `:1494`

- **`xstockstrat-agent`** (Python 3.12)
  - Client: `app/client.py` — `run_backtest` `:143-165` (**never sets `range`**)
  - Tools: `app/tools.py` — `run_backtest` tool `:239-260`; module docstring inventory `:1-18`
  - Tests: `tests/test_tools.py` stub-capture `:530-561`; `tests/test_client.py` one-sided range
    assertions `:367-392`, `_iso_to_timestamp` tests `:21-30`

- **`xstockstrat-ui`** (Next.js)
  - Backtest form: `src/app/insights/strategies/[id]/page.tsx` — defaults `:57-62`, local
    `isoToTimestamp` closure `:79-82`, `range:` construction `:91`, client-side `MAX_RANGE_DAYS = 730`
    cap `:21-27` + date-input `min`/`max` `:230-250`
  - BFF: `src/lib/insightsBff.ts:36` — `runBacktest: forward(...)`, pure pass-through
  - Diagnostics: `src/components/insights/BacktestDiagnostics.tsx` — warm-up rendering `:137`, `:153`,
    per-symbol `barsTotal`/`warmupBars` `:95`
  - Mock backend: `e2e/mock-backend.ts:457-531` (`runBacktest` — **currently ignores `req.range`**)
  - Existing spec to extend: `e2e/insights/backtest-coverage.spec.ts:11-58`

- **`xstockstrat-marketdata`** (Go) — not an "affected service", but binding on this design
  - `GetBars` default page: `internal/service/marketdata_service.go:124` — `pageSize := 500`
  - Query: `internal/repository/marketdata_repo.go:88-90` — `ORDER BY time ASC LIMIT $5`

## Patterns to REUSE

- **ISO → `Timestamp` conversion (agent)** → reuse `_iso_to_timestamp`,
  `services/xstockstrat-agent/app/client.py:35-41`. Already handles `Z` suffix and naive→UTC. Do not
  write a second parser.
- **Building a one-sided `common_pb2.TimeRange` on a request** → reuse the `trigger_backfill`
  template verbatim, `services/xstockstrat-agent/app/client.py:705-712` (+ the `start > end` guard at
  `:686-693`). It already documents that an unset bound (`seconds == 0`) is treated as open.
- **Optional-ISO-param tool docstring wording** → reuse the `trigger_backfill` phrasing,
  `services/xstockstrat-agent/app/tools.py:474-475`.
- **Asserting the built request in a tool test** → reuse the stub-capture pattern,
  `services/xstockstrat-agent/tests/test_tools.py:530-561` (the sibling test at `:260-276` mocks the
  client wholesale and cannot see a `range`).
- **One-sided range assertions** → reuse `services/xstockstrat-agent/tests/test_client.py:367-392`
  (`HasField("range") is False` / `start.seconds > 0` / `end.seconds == 0`).
- **Additive sibling over widening a shared contract** → ledger insight 2026-07-08
  (`evaluate_with_series` added beside `evaluate`, `evaluator.py:102-116`). If the evaluator needs a
  trade-start offset, prefer a new optional parameter or sibling over changing `evaluate`'s contract,
  which `live_loop.py:133` depends on.
- **Shared pure gate module for backtest/live parity** → ledger insight 069
  (`app/services/cooldown.py`): a rule used by both paths lives in one pure module that enforces its
  own input invariant, rather than a convention repeated per call site.
- **Declared-over-observed warm-up for custom formulas** → existing precedent
  `_compute_evaluated_warmup`, `servicer.py:970-981` (uses `FormulaOutput.warmup_period` via
  `GetFormula`, cached). This is the "already-declared warm-up" the product spec's OQ-2 refers to.
- **Frontend test data (C-12)** → `e2e/fixtures/strategies.ts` (`STRATEGY_DEF_*`) and
  `e2e/helpers/auth.ts`. Backtest results are listed as **not yet centralized**
  (`e2e/fixtures/INVENTORY.md:47`) with a migrate-opportunistically policy (`:35-37`) — a feature
  touching backtest range triggers that obligation.

## Dependencies

- **Proto/RPC**: **no change.** `RunBacktestRequest.range` already exists
  (`packages/proto/analysis/v1/analysis.proto:34`, `common.v1.TimeRange`, field 2). Highest used
  field in that message is `7`; next free would be `8` if one were ever needed.
  `BacktestResult`/`BarDiagnostic` wire bytes are **persisted verbatim** (`analysis.proto:60-63`) —
  additive-only.
- **Migration**: none. (Next free number would be `010`.)
- **Config keys**: none new *unless* the design chooses an explicit warm-up lookback key under
  `analysis.backtest.*` (product-spec OQ-2). Existing relevant key:
  `analysis.backtest.max_range_days` (default `730`, read at `servicer.py:276`).
- **Inter-service edges**: analysis → marketdata `GetBars` (existing); analysis → indicators
  `GetFormula` for declared warm-up (existing, `servicer.py:970-981`); agent → analysis `RunBacktest`
  (existing).
- **New env vars**: none.

## Risks / Not-found

1. **[HIGH — design-determining] The 500-bar `GetBars` page cap.** Analysis calls `GetBars` with no
   `page` (`servicer.py:551-559`, `:802-810`) and never reads `next_page_token`. Marketdata defaults
   to `pageSize := 500` (`marketdata_service.go:124`) with `ORDER BY time ASC LIMIT $5`
   (`marketdata_repo.go:88-90`). A 730-day window is already ≈504 trading days — **at the ceiling**.
   Prepending warm-up history makes the fetch exceed 500 and silently truncates the **newest** bars
   (ASC + LIMIT drops the tail), i.e. the end of the very window the user asked for. Any design that
   simply widens the fetch range is wrong without pagination or an explicit page size.
2. **[HIGH] `warmup_bars` is an index into the returned bar list, not a count of pre-window bars.**
   `_finalize_symbol_diagnostics` does `if i < warmup_bars` (`servicer.py:1601-1624`) and
   `_classify_no_trade_reason` compares `warmup_bars >= n` (`servicer.py:1591-1598`). A pre-window
   prefix needs a distinct **trading-start offset** concept; reusing `warmup_bars` for it would
   corrupt both diagnostics and the no-trade classification.
3. **[HIGH] The evaluator cannot distinguish pre-window bars.** `evaluate_with_series`
   (`evaluator.py:118-169`) computes series over **all supplied bars** and returns **one decision per
   supplied bar**; it exposes no warm-up or trade-start parameter. A prefix arrives indistinguishable
   from in-window bars, and the evaluator trading loop (`servicer.py:864-916`) trades on every
   `i >= 1` — so without an offset, **trades would open before `start`** (violates FR-3).
4. **[MEDIUM] Feature-065 evidence-cell drift.** `trading_days = len(daily_eq) - 1`
   (`servicer.py:357`), and warm-up bars currently **count toward it** (legacy appends equity for
   skipped bars `:669`, `:678`; evaluator appends unconditionally `:918`). Changing what is simulated
   shifts `trading_days` and per-symbol metrics, which are the weights in the derived headline grade.
   Product-spec OQ-3.
5. **[MEDIUM] Evaluator-path `bars_need = 2`** (`servicer.py:812-814`) ignores indicator warm-up
   entirely, so the coverage-gap check under-reports for evaluator strategies today. FR-3 makes this
   visible; deciding whether to fix it is in scope for OQ-1.
6. **[MEDIUM — C-10 trap, matches ledger fail 2026-07-21/067]
   `BacktestDiagnostics.tsx:18-27` holds an exhaustive `Record<NoTradeReason, string>`** (and
   `Record<BarAction, string>` at `:9-16`). Adding a **new** `NoTradeReason` value to report warm-up
   shortfall is a **TypeScript compile error** until the map gains the key — it hard-couples the proto
   change to a UI edit in the same PR. Strong argument for reusing the existing
   `CoverageGap`/`INSUFFICIENT_DATA` mechanism instead of a new enum value.
7. **[LOW] Live-loop timeframe spelling divergence.** `live_loop.py:124-127` uses `timeframe="1Day"`
   with no `timeframe_enum`, vs the backtest path's canonical `"1d"` + enum (`servicer.py:554-555`).
   Marketdata normalizes both (`marketdata_service.go:112-122`), so this is latent, not broken.
   **Out of scope** — flagged for separate triage, do not fix here.
8. **[LOW] `get_int` zero-trap.** `watcher.py:68-74` returns `v.int_val or default`, so a configured
   `0` reads back as the default. Relevant if OQ-2 adds a warm-up config key where `0` would be a
   meaningful "no extra warm-up" choice.

**Not found** (never assumed):
- No "pre-window", "lookback", `warmup_days`, or history-prefix concept anywhere in the analysis
  backtest path. The only lookback constant is `live_loop._LOOKBACK_DAYS = 365`.
- No config key matching `analysis.backtest.*warmup*` / `*lookback*`.
- No proto field on `RunBacktestRequest`, `SymbolDiagnostics`, or `BarDiagnostic` distinguishing
  pre-window bars from in-window bars (no `trading_start_index` equivalent).
- No shared/exported `isoToTimestamp` in `xstockstrat-ui` `src/lib/**` — the one at `page.tsx:79` is a
  local closure.
- No centralized backtest-result fixture module in `e2e/fixtures/`.
- No e2e test asserts the `range` the UI sends (`mock-backend.ts` `runBacktest` never reads
  `req.range`).

## Recommended Scope

Advisory step boundaries for the grilling phase and `/sdd-spec`:

1. **Warm-up prefix in the analysis engine** — compute the required pre-window bar count, fetch
   `start − warmup … end`, and carry an explicit **trading-start offset** through both engine paths so
   no trade opens before `start`. Must resolve Risk 1 (pagination) and Risk 2/3 (offset vs
   `warmup_bars`).
2. **Coverage/shortfall reporting** — decide via the existing `CoverageGap`/`INSUFFICIENT_DATA` path
   (preferred, avoids Risk 6) how an unsatisfiable warm-up prefix is surfaced.
3. **Agent surface** — `start`/`end` on `client.run_backtest` + the `run_backtest` tool, reusing
   `_iso_to_timestamp` and the `trigger_backfill` TimeRange template.
4. **Parity + determinism tests** — agent↔UI parity (FR-6), backtest/live decision (FR-7),
   cross-day determinism (FR-4), extending `test_no_look_ahead_warmup_and_series` (`:1086`) and
   `test_backtest_reproducible_across_runs` (`:2274`).
5. **Docs** — `run_backtest` docstring + `docs/runbooks/mcp-tools.md:241-257` parameter table. Tool
   **count** is unchanged (no new tool), so the five-surface inventory rule does not apply here.
6. **Frontend test data (C-12)** — centralize backtest-result fixtures per
   `e2e/fixtures/INVENTORY.md:35-37,47` if the UI parity test touches them.
