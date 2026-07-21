# Recon: fix-custom-formula-allnone

**Created**: 2026-07-21
**From**: product-spec.md
**Affected services**: xstockstrat-analysis (primary), xstockstrat-indicators (secondary — read-only reference)

---

## Objective

Custom-formula strategy components resolve to an all-`None` per-bar series during backtests, so per-bar
diagnostics carry an empty `indicators: {}`, the entry condition is never true, and the strategy yields
0 trades (`NO_TRADE_REASON_ENTRY_NEVER_TRUE`). Builtin-indicator components are unaffected. The fix
must make a list-valued `ExecuteFormula` output decode to a real numeric series in the evaluator, and
surface a genuine formula-execution failure instead of silently degrading to all-`None`.

## Root Cause (confirmed end-to-end by recon)

1. **Producer (indicators):** `ExecuteFormula` builds its response `output` as a `google.protobuf.Struct`
   via `output_struct.update(result.output)` where `result.output` is a **native** json-decoded dict
   (`services/xstockstrat-indicators/app/handlers/servicer.py:171-176`; source
   `app/services/sandbox.py:222` `json.loads(...)`). `Struct.update()` marshals a native Python list
   into a protobuf **`ListValue`**, not a native `list`.
2. **Consumer (analysis):** `_compute_component` does `output = dict(resp.output)` then keeps a value
   only `if isinstance(raw, (list, tuple))` (`services/xstockstrat-analysis/app/services/evaluator.py:185-191`).
   A `ListValue` fails that check ⇒ every series output is skipped ⇒ `series.setdefault("value", [None] * n)`
   ⇒ **all-`None` series**.
3. **Diagnostics:** the evaluated backtest path's present-only comprehension drops all-`None` series from
   the map (`services/xstockstrat-analysis/app/handlers/servicer.py:785-789`) ⇒ `indicators: {}`;
   `_classify_no_trade_reason` then returns `NO_TRADE_REASON_ENTRY_NEVER_TRUE` (`servicer.py:1477-1484`).

> **Product-spec line numbers were stale.** Authoritative lines (this recon): evaluator custom-formula
> branch `:164`, `ExecuteFormula` call `:172`, `if not resp.success` swallow `:180-182`, decode/isinstance
> swallow `:185-191`; servicer present-only comprehension `:785-789` (spec said "690").

## Codebase Map

- **`xstockstrat-analysis`** (Python) — fix site
  - Evaluator: `app/services/evaluator.py`
    - `_compute_component` — `evaluator.py:143`
    - Custom-formula branch — `evaluator.py:164`
    - `ExecuteFormula(...)` outbound call (with `metadata=self._meta`) — `evaluator.py:172` (`:178` metadata)
    - **Swallow 1** `if not resp.success: … return {"value": [None] * n}` — `evaluator.py:180-182`
    - **Swallow 2** `output = dict(resp.output)` → `isinstance(raw, (list, tuple))` → `setdefault("value", [None]*n)` — `evaluator.py:185-191`
    - Builtin branch (contrast — works, uses `align_indicator_points`) — `evaluator.py:154-163`
    - `evaluate_with_series()` builds `component_series` — `evaluator.py:90`, `:120-126`; `evaluate()` wrapper — `evaluator.py:74`
    - Constructor stub injection — `evaluator.py:65` `__init__(self, indicators_stub, propagation_meta=())`; stores `self._indicators`, `self._meta` (`:71`)
  - Servicer/handler: `app/handlers/servicer.py`
    - `_backtest_symbol_evaluated` (evaluated path) — `servicer.py:741`; builds `StrategyEvaluator` `:771`; `evaluate_with_series` `:773`
    - **Present-only diagnostics comprehension** — `servicer.py:785-789`
    - `_backtest_symbol` (builtin path, explicit map) — `servicer.py:484`, map at `:588-594`
    - `_build_bar_diagnostic` — `servicer.py:1442` (copies into `diag.indicators` `:1463-1464`); `_finalize_symbol_diagnostics` — `servicer.py:1487`; `_classify_no_trade_reason` — `servicer.py:1477` (`ENTRY_NEVER_TRUE` `:1484`)
    - Indicators stub built — `servicer.py:83` (channel param `:74`)
  - Last migration: `007_backtest_run_symbols.up.sql` (`services/xstockstrat-analysis/migrations/`) — fix needs none
  - Config-read pattern: `ConfigWatcher` injected `servicer.py:72`; typed reads `self._cfg.get_float/get_int(...)` (e.g. `servicer.py:172-173`); subscription in `app/config/watcher.py`
  - Header propagation: allowed-key filter `servicer.py:159-163`/`:192-195`; forwarded on `ExecuteFormula` via `metadata=self._meta` (`evaluator.py:178`)
  - Tests: `tests/test_strategy_evaluator.py` (pytest + `AsyncMock`); custom-formula test `:354`, mock builds `Struct(); output.update({"value": closes})` `:360-362` — **but only asserts request params (`:384-386`), never that the decoded series is non-None**. `tests/conftest.py` fixtures; servicer tests `tests/test_analysis_servicer.py`. Coverage floor: Python ≥40% (`services/xstockstrat-analysis/CLAUDE.md:253`).

- **`xstockstrat-indicators`** (Python) — read-only reference (no change expected)
  - `ExecuteFormula` response build (Struct) — `app/handlers/servicer.py:171-176`; also `success=False` when a declared output series is missing — `:156-166`
  - Sandbox native json output — `app/services/sandbox.py:167-168`, `:222`; `SandboxResult.output: dict` `:94-96`
  - Proto: `packages/proto/indicators/v1/indicators.proto:77-87` — `ExecuteFormulaResponse { bool success = 1; google.protobuf.Struct output = 2; string error = 7; … }`
  - Conversion helpers in use: only stdlib `MessageToDict`/`ParseDict`/`Struct` (`servicer.py:9-10`); `MessageToDict` is applied to inbound `input_data` (`:126`) but **not** to outbound `output`
  - Test fixtures return only **scalar** outputs (`tests/test_formulas.py:357,383,414,431`), so the `ListValue` list-output behavior is currently untested on both sides

## Patterns to REUSE

- **Struct→native decode** → reuse stdlib `google.protobuf.json_format.MessageToDict` (already imported and used for inbound `input_data` at `xstockstrat-indicators/app/handlers/servicer.py:126`) — recursive, turns `ListValue`→native `list`. The analysis-side decode should use the same recursive conversion rather than `dict(resp.output)` + `isinstance` gate. No new helper/type needed.
- **Additive/minimal change to a shared engine** → insights 2026-07-08/09 (feature 064): the evaluator/servicer diagnostics path was deliberately built with a frozen hot-method contract and a shared `_build_bar_diagnostic` builder. The fix stays inside `_compute_component`'s decode step — it does not widen `evaluate_with_series`'s return contract or touch the builtin path.
- **Regression test harness** → reuse the existing `Struct`-mock pattern at `tests/test_strategy_evaluator.py:360-362`; add the missing non-`None` series assertion (the red test) rather than a new test scaffold.

## Dependencies

- Proto/RPC: none changed. `ExecuteFormulaResponse.output` is `google.protobuf.Struct` (field 2), `indicators.proto:77-87` — consumed as-is; the fix is decode-side only.
- Migration: none (last is `007`).
- Config keys: none new. (Open question for the debate: should the "surface a real failure" behavior be gated by a config flag, or unconditional? See Risks.)
- Inter-service edges: `xstockstrat-analysis → xstockstrat-indicators` `ExecuteFormula` (gRPC 50054) — unchanged.
- New env vars / ports: none.

## Risks / Not-found

- **Failure-surfacing semantics (AC-3) — design decision needed.** `evaluator.py:180-182` currently swallows `resp.success == false` into an all-`None` series. Options: (a) raise/propagate so the backtest reports a distinct error `no_trade_reason`/status; (b) log louder but keep degrading. The `no_trade_reason` enum set and whether a distinct "formula failed" reason value exists must be checked at spec time (`_classify_no_trade_reason` `servicer.py:1477-1484`) — **Not found:** an existing `NO_TRADE_REASON_*` value dedicated to formula-execution failure was not confirmed in recon.
- **`ListValue` element types.** A `ListValue` yields `Value` items; recursive `MessageToDict` produces native floats but may render nulls/NaN specially. The decode must preserve `None` gaps (warm-up) as `None`, matching the builtin `align_indicator_points` series shape (`evaluator.py:154-163`).
- **Scalar vs list outputs.** Some formula outputs are scalars (`{"value": 1}` → native number), others are per-bar lists (→ `ListValue`). The fix must handle both (scalar broadcast vs series) without regressing the scalar path that the existing test at `:360-362` exercises.
- **`## Not found` (indicators recon):** no custom list↔Struct marshaller beyond stdlib; no test fixture returns a list-valued output series on either service — so both the fix and its regression test are net-new coverage.
- **Ledger traps:** `fails.md` C-10 duplication/parity entries — low applicability (single decode path, no UI/RPC parity surface); noted, not blocking.

## Recommended Scope

Advisory, single-service, likely two steps (input to grilling / `/sdd-spec`):

1. **`service` step (xstockstrat-analysis):** in `_compute_component` (`evaluator.py:185-191`), replace `dict(resp.output)` + `isinstance(raw, (list, tuple))` with a recursive `MessageToDict`-based decode that unwraps `ListValue`→native list (and preserves scalar outputs). Decide + implement AC-3 failure-surfacing for `resp.success == false` (`:180-182`).
2. **`test` step (paired, C-08/P-06):** red-before-green regression in `tests/test_strategy_evaluator.py` asserting a list-valued `ExecuteFormula` output decodes to a non-`None` numeric series (extend the `:354` test), plus a case for `resp.success == false` surfacing per the AC-3 decision. Keep coverage ≥40%.

No proto, migration, config-key, or env-var changes anticipated.
