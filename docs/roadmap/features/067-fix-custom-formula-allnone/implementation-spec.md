# Implementation Spec: fix-custom-formula-allnone

**Status**: `complete`
**Created**: 2026-07-21
**Feature**: `docs/roadmap/features/067-fix-custom-formula-allnone/feature.md`
**Total Steps**: 9
**Feature Branch**: `feature/fix-custom-formula-allnone`

---

## Execution Summary

Implements the approved **Option A** design (design.md): a custom-formula component's list output
currently decodes to an all-`None` series because `_compute_component` gates `Struct` values on
`isinstance(raw, (list, tuple))`, which a protobuf `ListValue` fails. The fix (1) appends a distinct
`NO_TRADE_REASON_FORMULA_ERROR` enum value, regenerates stubs, (2) replaces the evaluator decode with a
recursive `MessageToDict` unwrap that raises a new `FormulaExecutionError` on failure/shape-mismatch,
(3) catches that in the RunBacktest per-symbol loop to stamp a visible `FORMULA_ERROR` diagnostic and
guard the all-failed-run status against a spurious persisted score, and (4) updates the **shared** UI
`NO_TRADE_MESSAGE` exhaustive record (else `pnpm build` breaks) with an e2e banner-render proof. Order
is proto → proto-gen → evaluator+test → servicer+test → UI+e2e → live-loop regression test: each layer
depends on the enum/symbols the prior layer introduced.

## Step Dependencies

- Step 2 (proto-gen) requires Step 1 (proto): stubs regenerate from the edited `.proto`.
- Step 3 (evaluator) requires Step 2: raises/uses no new stub, but the servicer branch (Step 5) that
  consumes it references the regenerated `NO_TRADE_REASON_FORMULA_ERROR`.
- **C-10 build coupling (fails.md 2026-07-21):** Step 2 regenerates the TS `NoTradeReason` enum with the
  new value, which makes the exhaustive `Record<NoTradeReason, string>` in `BacktestDiagnostics.tsx`
  non-exhaustive → `tsc`/`pnpm build` **fails until Step 7** adds the map key. Steps 2 and 7 must land in
  the same feature branch; the UI build check is Step 7/8's verification, not Step 2's.
- Step 5 (servicer) requires Step 3 (evaluator): imports `FormulaExecutionError` from
  `app.services.evaluator` and catches it in the RunBacktest loop.
- Step 4 [test] covers Step 3 [service]; Step 6 [test] covers Step 5 [service]; Step 8 [test] covers
  Step 7 [service]; Step 9 [test] covers the live-loop no-change path (confirm-only).

**Trading-domain constraints (`reference/step-constraints.md` §A):** not triggered — no step touches
order placement, `BrokerType`, `TRADING_MODE`, `OrderType`, or `OrderStatus`/fill handling. This is a
backtest-diagnostics decode fix.

**Header propagation (§B):** no step adds a **new** outbound gRPC call. The `ExecuteFormula` call already
exists at `evaluator.py:172` and already forwards `metadata=self._meta` (`evaluator.py:178`); the fix
only changes how its response is decoded. C-03 unaffected.

---

### Step 1 — proto: append `NO_TRADE_REASON_FORMULA_ERROR` to the `NoTradeReason` enum

**Status**: `done`
**Service**: `packages/proto`
**Files**:
- `packages/proto/analysis/v1/analysis.proto` — modify

**Reviewers**: Proto Reviewer — field/value number uniqueness, `buf lint`/`buf breaking` pass, no breaking change; xstockstrat-analysis owner — backtest reason semantics; xstockstrat-ui owner — enum consumed by the shared diagnostics renderer.

**Codebase Evidence**:
- Confirmed via Read `packages/proto/analysis/v1/analysis.proto:97-102` — the `NoTradeReason` enum:
  `NO_TRADE_REASON_UNSPECIFIED = 0`, `..._ENTIRE_RANGE_WARMUP = 1`, `..._ENTRY_NEVER_TRUE = 2`,
  `..._INSUFFICIENT_CAPITAL = 3`. Highest existing number is `3`; next free is `4`. Zero-value sentinel
  already present (C-04 satisfied).
- `SymbolDiagnostics.no_trade_reason` is field 3 (`analysis.proto:123-129`) — consumes this enum.

**TDD**: `N/A (proto)` — verification is `buf lint` + `buf breaking`; behavioral proof lands in the paired service/UI test steps.

**Instructions**:
1. In the `NoTradeReason` enum (`analysis.proto:97-102`), append after
   `NO_TRADE_REASON_INSUFFICIENT_CAPITAL = 3;` a new line:
   `NO_TRADE_REASON_FORMULA_ERROR = 4;      // a custom-formula component failed to execute / returned an out-of-contract series`
2. Do not renumber or reorder existing values (append-only keeps `buf breaking` clean).

**Verification**:
```bash
cd packages/proto && buf lint && buf breaking --against ".git#branch=feature/fix-custom-formula-allnone"
```
Both pass (appending an enum value is non-breaking).

---

### Step 2 — proto-gen: regenerate stubs for the new enum value

**Status**: `done`
**Service**: `packages/proto`
**Files**:
- `packages/proto/gen/go/analysis/v1/` — modify (regenerated)
- `packages/proto/gen/python/analysis/v1/` — modify (regenerated)
- `packages/proto/gen/ts/analysis/v1/` — modify (regenerated)
- `packages/proto/gen/ts/dist/` — modify (compiled TS output)

**Reviewers**: Inherited from Step 1 — Proto Reviewer + xstockstrat-analysis owner + xstockstrat-ui owner.

**Codebase Evidence**:
- Confirmed via `ls scripts/buf-gen.sh` — the codegen entrypoint exists (root CLAUDE.md § Generating Proto Stubs).
- Ledger insight (2026-07-09, backtest-debug-info — ordering): verify the codegen toolchain reproduces
  committed stubs byte-for-byte (empty `git diff packages/proto/gen/`) **before** editing any `.proto`.

**TDD**: `N/A (proto-gen)` — mechanical regeneration; behavior proven downstream.

**Instructions**:
1. (Pre-edit, if not already done for Step 1) verify a clean regen reproduces committed stubs:
   `git stash` the proto edit, run `./scripts/buf-gen.sh`, confirm `git diff packages/proto/gen/` is
   empty, then restore the edit.
2. Run `./scripts/buf-gen.sh` to regenerate all TS/Python/Go stubs and recompile the TS package.
3. Stage the regenerated `packages/proto/gen/{go,python,ts}/analysis/v1/` files and `gen/ts/dist/`.
   The TS enum now exposes `NoTradeReason.FORMULA_ERROR = 4` (generated names strip the
   `NO_TRADE_REASON_` prefix — cf. existing `NoTradeReason.ENTRY_NEVER_TRUE` used at
   `services/xstockstrat-ui/src/components/insights/BacktestDiagnostics.tsx:22`).

**Verification**:
```bash
./scripts/buf-gen.sh && git diff --stat packages/proto/gen/ | grep analysis/v1
```
Diff is limited to `analysis/v1` paths (+ `gen/ts/dist/`); no unrelated stub churn.
NOTE: `cd services/xstockstrat-ui && pnpm build` will **fail** at this point (missing `FORMULA_ERROR`
key in the exhaustive `NO_TRADE_MESSAGE` record) — this is expected and resolved by Step 7; do not treat
it as a regression here.

---

### Step 3 — service: decode `ExecuteFormula` output via `MessageToDict` and raise `FormulaExecutionError`

**Status**: `done`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/app/services/evaluator.py` — modify

**Reviewers**: xstockstrat-analysis owner — backtest reproducibility, strategy scoring determinism, no look-ahead bias.

**Codebase Evidence**:
- Confirmed via Read `evaluator.py:180-192` — the two buggy spots:
  - `evaluator.py:180-182` — `if not resp.success: log.warning(...); return {"value": [None] * n}` (swallow 1).
  - `evaluator.py:185-191` — `output = dict(resp.output)`; loop keeps a value only
    `if isinstance(raw, (list, tuple))`; `series.setdefault("value", [None] * n)` (swallow 2 — a
    `ListValue` fails the isinstance gate → all-`None`).
- Canonical in-service decode to reuse — Read `screener.py:259-261`:
  `# MessageToDict recursively converts the Struct (incl. ListValue) to native python — dict(Struct) leaves a list output as a ListValue.` `return _latest_value(MessageToDict(resp.output).get("value"))`
- Imports — confirmed `evaluator.py:13-20` imports `json`, `logging`, `Struct` but **NOT**
  `MessageToDict`; `screener.py:24` uses `from google.protobuf.json_format import MessageToDict`.
- `align_indicator_points` (`evaluator.py:195-217`) serves the **builtin** path only (tail-aligns /
  truncates on `len>n`) — leave untouched per design (formulas require `len==n` and raise).
- No existing `FormulaExecutionError` (grep `app/ tests/` → none) — net-new class.
- Existing failure-carrying exception pattern to mirror: `_InsufficientData` (`servicer.py:55-66`,
  `__init__(self, symbol, bars_have, bars_need)` storing attributes).

**TDD**: `red-green required` (paired with Step 4).

**Instructions**:
1. Add `from google.protobuf.json_format import MessageToDict` to the imports (`evaluator.py:13-20`).
2. Define a module-level `FormulaExecutionError(Exception)` (near the top of `evaluator.py`, mirroring
   `_InsufficientData`'s shape) carrying `formula_id: str` and `error: str`, e.g.
   `def __init__(self, formula_id, error): super().__init__(f"formula {formula_id} failed: {error}"); self.formula_id = formula_id; self.error = error`.
   It is caught by the servicer (Step 5), which already imports from `app.services.evaluator`
   (`servicer.py:39-43`).
3. In `_compute_component`'s `COMPONENT_KIND_CUSTOM_FORMULA` branch:
   - Replace the `if not resp.success:` swallow (`evaluator.py:180-182`) with
     `raise FormulaExecutionError(comp.formula_id, resp.error)`.
   - Replace `output = dict(resp.output)` + the `isinstance(raw, (list, tuple))` gate
     (`evaluator.py:185-191`) with `output = MessageToDict(resp.output)` (recursive `ListValue`→native
     `list`). For each decoded key whose value is a `list`: normalize `NaN`/`Inf`→`None` and keep;
     apply the **custom-formula length policy** below. Non-list (scalar) values stay dropped (unchanged;
     scalar-broadcast is deferred per design § Rejected).
   - Custom-formula length policy (design.md § Custom-formula length policy) — for the decoded `value`
     series (and any list output):
     - `len == n`: normalize `NaN`/`Inf`→`None`, keep (an all-`None`/all-`NaN` `len==n` series passes
       through as a legitimate warm-up range).
     - `0 < len < n`, `len > n`, or empty list: **raise** `FormulaExecutionError(comp.formula_id, resp.error)`
       (do NOT tail-align — arbitrary user formulas don't guarantee the builtin contiguous-warm-up-head
       invariant).
   - Keep the existing "at least a `value` series" contract: if the decoded output has no `value` list
     after decode, raise (an empty/absent value is the AC-3 failure, not a silent `[None]*n`).
4. Do not touch the `COMPONENT_KIND_BUILTIN_INDICATOR` branch (`evaluator.py:154-163`) or
   `align_indicator_points`.

**Verification**: covered by Step 4's test + coverage/lint run. Behaviorally: a list-valued
`ExecuteFormula` output now yields a numeric series equal to the input (no longer all-`None`); a
`success==false` or length-mismatch response raises `FormulaExecutionError`.

---

### Step 4 — test: evaluator decode + raise regression (red-before-green)

**Status**: `done`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/tests/test_strategy_evaluator.py` — modify

**Reviewers**: xstockstrat-analysis owner — backtest reproducibility, strategy scoring determinism.

**Codebase Evidence**:
- Confirmed via Read `tests/test_strategy_evaluator.py:354-386` — existing custom-formula test
  `test_formula_component_forwards_input_params` builds `output = Struct(); output.update({"value": closes})`,
  `resp = SimpleNamespace(success=True, output=output, error="")`, `stub.ExecuteFormula = AsyncMock(...)`.
  It asserts **only** request params (`:384-386`) — never that the decoded series is non-`None`. This is
  the RED anchor (recon.md § Patterns to REUSE).
- Uses `AsyncMock`, `SimpleNamespace`, `json` already imported in the test module.

**TDD**: `red-green required`. The added assertions must FAIL against the pre-Step-3 tree (the
`isinstance` gate drops the `ListValue`, producing all-`None`) and PASS after Step 3.

**Instructions**: Add tests exercising `StrategyEvaluator._compute_component` via the existing
`Struct().update({"value": [...]})` mock pattern:
1. **List output decodes to a non-`None` series** (RED today): a `Struct` with
   `{"value": closes}` and `success=True` → the component's `value` series equals `closes` (all
   non-`None`), asserting `evaluate_with_series` (or `_compute_component`) output, not just request params.
2. **`NaN` head normalizes to leading `None`s**: a value list with `float('nan')` at the head → those
   positions decode to `None`, the rest numeric, `len == n`.
3. **`success == False` raises** `FormulaExecutionError`.
4. **Length mismatch raises**: `len < n`, `len > n`, and empty-list cases each raise
   `FormulaExecutionError`.
5. **Scalar `{"value": 1}` is dropped** (documents the deferred scalar-broadcast; does not raise on the
   value-present path only if a list `value` is absent → adjust per the Step-3 contract: a bare scalar
   with no list `value` raises, matching AC-3). Encode the case to match the exact Step-3 policy.

**Verification**:
```bash
cd services/xstockstrat-analysis && ruff check . && ruff format --check . && pytest --cov=app --cov-fail-under=40
```
All tests pass; coverage ≥ 40%.

---

### Step 5 — service: surface `FORMULA_ERROR` per-symbol + guard the all-failed-run status

**Status**: `done`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/app/handlers/servicer.py` — modify

**Reviewers**: xstockstrat-analysis owner — backtest reproducibility, strategy scoring determinism, no look-ahead bias.

**Codebase Evidence**:
- Confirmed via Read `servicer.py:39-43` — servicer already imports from `app.services.evaluator`
  (`StrategyEvaluator`, `_validate_definition`, `align_indicator_points`, `referenced_refs`); add
  `FormulaExecutionError` to this block.
- RunBacktest per-symbol loop — `servicer.py:302-376`: `try:` at 303 calls
  `_backtest_symbol_evaluated` (305) / `_backtest_symbol` (316); handlers `except _InsufficientData`
  (352-370), `except grpc.RpcError` (371-373), `except Exception` (374-376).
- `_backtest_symbol_evaluated` (`servicer.py:741-773`) calls `evaluator.evaluate_with_series(...)` at
  `:773` with **no local try** — a `FormulaExecutionError` propagates to the loop's `try` at 303.
- Accumulators initialized `servicer.py:291-300` (`all_trades`, `daily_equity`, `coverage_gaps`,
  `all_diagnostics`, `symbol_cells`) — add a `formula_errors: int = 0` here.
- Sibling evidence-cell buffering `servicer.py:336-348` (feature 065) — must be preserved for
  successful siblings.
- Status gate `servicer.py:400-403`:
  `if coverage_gaps and not all_trades and len(daily_equity) <= 1: result.status = ...INSUFFICIENT_DATA else: ...OK`.
- Spurious-score hazard: `_persist_symbol_cells` (`:422-430`) and per-run `_persist_backtest_run`
  score (`:435-443`) run on `BACKTEST_STATUS_OK` — feature 053 explicitly removed fabricated
  flat-equity "success" (analysis CLAUDE.md § Data-coverage awareness).
- `_classify_no_trade_reason` (`servicer.py:1477-1484`) only sees trades/warmup/n → would misclassify a
  failed symbol as `ENTRY_NEVER_TRUE`; `_finalize_symbol_diagnostics` (`:1487-1501`) is the only other
  `SymbolDiagnostics` constructor. The raising symbol never reaches `_finalize_symbol_diagnostics`, so
  the new branch is the single site stamping `FORMULA_ERROR`.

**TDD**: `red-green required` (paired with Step 6).

**Instructions**:
1. Add `FormulaExecutionError` to the `from app.services.evaluator import (...)` block (`servicer.py:39-43`).
2. Initialize `formula_errors: int = 0` alongside the accumulators at `servicer.py:291-300`.
3. Add an `except FormulaExecutionError as fe:` branch in the RunBacktest loop, placed **before** the
   broad `except Exception` (`servicer.py:374`) — e.g. immediately after the `except _InsufficientData`
   block (after `:370`):
   - `log.warning("backtest symbol %s formula error: %s — skipping", symbol, fe.error)` (surfaces the
     indicators `resp.error` via log only; F-04 — no invented proto error field).
   - Append a directly-stamped diagnostic (bypass `_classify_no_trade_reason`):
     `all_diagnostics.append(analysis_pb2.SymbolDiagnostics(symbol=symbol, bars=[], no_trade_reason=analysis_pb2.NO_TRADE_REASON_FORMULA_ERROR, bars_total=0, warmup_bars=0))`.
   - `formula_errors += 1`
   - `continue`
4. Extend the status gate (`servicer.py:400`) so an all-failed / single-symbol-failed run does not
   masquerade as OK+scored:
   `if not all_trades and len(daily_equity) <= 1 and (coverage_gaps or formula_errors): result.status = ...INSUFFICIENT_DATA`.
   A **partial** multi-symbol run where a sibling traded (`all_trades` non-empty or
   `len(daily_equity) > 1`) stays `OK` and keeps persisting cells/score.
5. Add a code comment asserting the single-site invariant (only this branch sets `FORMULA_ERROR`;
   `_classify_no_trade_reason` never returns it).

**Verification**: covered by Step 6. Behaviorally: a symbol whose formula fails appears in
`result.diagnostics` with `no_trade_reason == NO_TRADE_REASON_FORMULA_ERROR`; an all-failed run reports
`BACKTEST_STATUS_INSUFFICIENT_DATA` and persists no per-run score.

---

### Step 6 — test: servicer `FORMULA_ERROR` surfacing + all-failed status + classify invariant

**Status**: `done`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/tests/test_analysis_servicer.py` — modify

**Reviewers**: xstockstrat-analysis owner — backtest reproducibility, strategy scoring determinism.

**Codebase Evidence**:
- Confirmed via `ls tests/test_analysis_servicer.py` (exists; 97 `def test` occurrences) — the servicer
  test module hosting RunBacktest tests.
- Status/score persistence hazard grounded at `servicer.py:400-403,422,436` (see Step 5 evidence).

**TDD**: `red-green required`. Assertions must FAIL pre-Step-5 (a failing formula currently degrades to
all-`None` → the run reports OK with `ENTRY_NEVER_TRUE`, not `FORMULA_ERROR`).

**Instructions**: Add RunBacktest tests (drive a strategy whose evaluated path raises
`FormulaExecutionError`, e.g. by mocking the indicators stub `ExecuteFormula` to return
`success=False` or a length-mismatched list):
1. **Multi-symbol partial**: symbol A's formula fails, symbol B succeeds → A's `SymbolDiagnostics.no_trade_reason == NO_TRADE_REASON_FORMULA_ERROR`, B keeps its feature-065 evidence cell, and
   `result.status == BACKTEST_STATUS_OK`.
2. **All-failed run**: every symbol's formula fails → `result.status == BACKTEST_STATUS_INSUFFICIENT_DATA`
   and no per-run score is persisted (assert `_persist_backtest_run` receives `score=None` / the OK-only
   cell+score persistence is skipped).
3. **Classify invariant**: assert `_classify_no_trade_reason(...)` never returns
   `NO_TRADE_REASON_FORMULA_ERROR` for any (trades, warmup, n) input (the reason is stamped only by the
   loop branch).

**Verification**:
```bash
cd services/xstockstrat-analysis && ruff check . && ruff format --check . && pytest --cov=app --cov-fail-under=40
```
All tests pass; coverage ≥ 40%.

---

### Step 7 — service: add the `FORMULA_ERROR` key to the shared UI `NO_TRADE_MESSAGE` record

**Status**: `done`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/components/insights/BacktestDiagnostics.tsx` — modify
- `services/xstockstrat-ui/e2e/mock-backend.ts` — modify

**Reviewers**: xstockstrat-ui owner — analytics display accuracy, Connect-RPC call safety, no secret values rendered in UI.

**Codebase Evidence**:
- Confirmed via Read `BacktestDiagnostics.tsx:18-25` — `const NO_TRADE_MESSAGE: Record<NoTradeReason, string>`
  is **exhaustive** over the enum (keys `UNSPECIFIED`, `ENTIRE_RANGE_WARMUP`, `ENTRY_NEVER_TRUE`,
  `INSUFFICIENT_CAPITAL`). Adding `NoTradeReason.FORMULA_ERROR = 4` (Step 2) makes it non-exhaustive → build fails (fails.md 2026-07-21).
- Banner render — `BacktestDiagnostics.tsx:86` `const noTradeMsg = NO_TRADE_MESSAGE[sd.noTradeReason] ?? '';`
  and `:96-103` render it in `<p data-testid="no-trade-reason">`. It is **bars-independent**, so a
  `bars: []`/`barsTotal: 0` diagnostic renders the reason without synthesized bars.
- Enum import — `BacktestDiagnostics.tsx:7` `import { BarAction, NoTradeReason } from '@xstockstrat/proto/analysis/v1/analysis_pb';`.
- Mock backend `runBacktest` handler — Read `e2e/mock-backend.ts:442-489`: a strategy-id branch
  (`strat-diag-001`) returns an OK result with `diagnostics: [{ symbol, barsTotal, warmupBars, noTradeReason, bars: [...] }]`.

**TDD**: `red-green required` (paired with Step 8; the UI e2e is this frontend step's coverage proof).

**Instructions**:
1. In `NO_TRADE_MESSAGE` (`BacktestDiagnostics.tsx:18-25`) add
   `[NoTradeReason.FORMULA_ERROR]: 'No trades — a custom-formula component failed to execute over this range. Check the formula definition and its inputs.'`
   (final copy at the reviewer's discretion; must be a distinct, operator-actionable message — Open Risk
   "Final UI copy").
2. In `e2e/mock-backend.ts` `runBacktest`, add a new strategy-id branch (e.g. `strat-formula-error-001`)
   returning `status: 1` (OK) with a single formula-error diagnostic:
   `diagnostics: [{ symbol: req.symbols[0] ?? 'AAPL', barsTotal: 0, warmupBars: 0, noTradeReason: 4 /* NO_TRADE_REASON_FORMULA_ERROR */, bars: [] }]`, `totalTrades: 0`, `trades: []`, `coverageGaps: []`.

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm lint && pnpm build
```
`pnpm build` now succeeds (the previously non-exhaustive record is complete) — this closes the Step 2
build-coupling note.

---

### Step 8 — test: UI e2e banner render for a `FORMULA_ERROR` symbol

**Status**: `done`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/e2e/insights/backtest-coverage.spec.ts` — modify

**Reviewers**: xstockstrat-ui owner — analytics display accuracy.

**Codebase Evidence**:
- Confirmed via Read `e2e/insights/backtest-coverage.spec.ts:32-43` — existing feature-064 test
  navigates `/insights/strategies/strat-diag-001`, clicks `Run Backtest`, and asserts
  `page.getByTestId('no-trade-reason')` copy. This is the exact pattern to mirror for the new
  `FORMULA_ERROR` strategy id.
- Strategy detail page renders `<BacktestDiagnostics>` — Read grep hit `src/app/insights/strategies/[id]/page.tsx`.
- `addAuthCookie` helper imported from `../helpers/auth`.

**TDD**: `red-green required`. The test must FAIL before Step 7 (no map key → `pnpm build` fails / banner
copy absent) and PASS after.

**Instructions**: Add a Playwright test in `backtest-coverage.spec.ts` (C-10 reachability/parity proof,
closing the 056/060 "forgot the shared consumer" fails): navigate to
`/insights/strategies/strat-formula-error-001` (the Step-7 mock branch), click `Run Backtest`, and
assert `page.getByTestId('no-trade-reason')` is visible and contains the formula-error copy (e.g.
`'formula component failed'`) — proving the `bars: []` diagnostic still renders the reason.

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm test:e2e -- backtest-coverage
```
The new test passes (existing insights e2e coverage; no numeric coverage threshold for the frontend per `reference/spec-template.md`).

---

### Step 9 — test: confirm the live loop contains a `FormulaExecutionError` (no code change)

**Status**: `done`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/tests/test_live_loop.py` — modify

**Reviewers**: xstockstrat-analysis owner — backtest/live parity, no look-ahead bias.

**Codebase Evidence**:
- Confirmed via Read `app/engine/live_loop.py:85-93` — the per-`(strategy, symbol)` eval is wrapped in
  `try: await self._eval_pair(...) except Exception as e: log.warning("live_loop: (%s,%s) error: %s — continuing", ...)`.
  `FormulaExecutionError` is a plain `Exception` subclass (Step 3), so the loop already catches it and
  continues — **no live-loop code change** (design § 5).
- Test module `tests/test_live_loop.py` exists (`ls tests/ | grep live`).

**TDD**: `red-green required` — the assertion (a failing formula does not propagate out of `run_once`
and leaves `_last_state` untouched) proves the containment; it is meaningful because Step 3 introduces
the raise the loop must absorb.

**Instructions**: Add a test driving the live loop with a strategy whose evaluated formula raises
`FormulaExecutionError` (mock the indicators stub / evaluator to raise): assert the loop logs-and-continues
(does not raise out of the cycle) and that other strategies/symbols still process. Confirm no new
safety code was needed (documents the design § 5 "confirm-only" claim).

**Verification**:
```bash
cd services/xstockstrat-analysis && ruff check . && ruff format --check . && pytest --cov=app --cov-fail-under=40
```
Test passes; coverage ≥ 40%.

---

## Deviation Log

### D-1 (Step 3) — `MessageToDict` refuses NaN/Inf; warm-up is `null`, not `NaN`

- **What the spec/design said**: normalize `NaN`/`Inf`→`None` and pass an all-`None`/all-`NaN`
  `len==n` series through as a legitimate warm-up range (design.md § Custom-formula length policy).
- **What was found**: `google.protobuf.json_format.MessageToDict` (protobuf 6.33.x, the canonical
  decode used by both `screener.py:261` and this fix) **raises `ValueError`** on a `NaN`/`Inf`
  number_value ("Fail to serialize NaN for Value.number_value") — so a `NaN` in the response `Struct`
  can never round-trip through the decode both consumers use; normalization can't run after it. The
  realistic, JSON-serializable warm-up representation is a `null` (Python `None`) element, which
  `MessageToDict` decodes cleanly to `None`.
- **Resolution (P-03 — surface, don't silently degrade)**: wrapped the `MessageToDict` call in
  `try/except ValueError → raise FormulaExecutionError`, so a genuinely `NaN`/`Inf`-laden
  (out-of-contract) output surfaces as a visible `FORMULA_ERROR` instead of a `ValueError` swallowed by
  the servicer's broad `except`. `_finite_or_none` retains the `NaN`/`Inf`→`None` guard defensively.
  Warm-up passthrough is proven with `null`-valued series (`test_null_warmup_head_passes_through_as_none`,
  `test_all_null_len_n_passes_through_as_warmup`); the `NaN` case now asserts a raise
  (`test_nan_output_raises`). No user decision needed — a factual correction with one correct resolution.
- **Disposition**: in-scope (the fix changes formula-decode semantics); a clear factual correction.

### D-2 (Step 4) — existing feature-064 test encoded the bug (`success=False` → all-`None`)

- `tests/test_analysis_servicer.py::test_formula_warmup_uses_declared_not_observed` produced its
  "all-`None` primary series" by mocking `ExecuteFormula` with `success=False`. That is exactly the
  masquerade this feature removes: `success=False` now raises `FormulaExecutionError` (→ `FORMULA_ERROR`),
  a distinct outcome. The test's true intent — declared warm-up (not observed) drives classification for
  a legitimately all-warm-up series → `ENTRY_NEVER_TRUE` — was preserved by switching the mock to a
  legitimate all-warm-up response (`success=True` with a length-`n` `null` `value`). Assertions unchanged.
- **Disposition**: in-scope test correction (the step changes formula-failure semantics; a test
  asserting the old semantics had to be updated). Recorded, not a spec-body edit (F-09).

### D-3 (Step 8) — UI e2e run via CI-equivalent fallback

- **Sanctioned tool**: `pnpm test:e2e -- backtest-coverage` (Playwright). In this environment the
  Playwright `webServer` (production `next build && next start`) exceeds the available wall-clock and the
  webServer process is torn down mid-run (`[WebServer] ⨯ [Error: aborted]`), failing all six
  backtest-coverage specs — a harness/resource limitation, not a defect in the new test.
- **CI-equivalent fallback applied** (sequential-mode verification fallback + spec's documented e2e
  fallback): `pnpm exec tsc --noEmit` + `pnpm lint` + `pnpm build`. Red→green proof captured at the
  type-exhaustiveness layer: **RED** — removing the `[NoTradeReason.FORMULA_ERROR]` map key fails `tsc`
  (`TS2741: Property '[NoTradeReason.FORMULA_ERROR]' is missing … required in type
  'Record<NoTradeReason, string>'`); **GREEN** — with the key, `tsc --noEmit` exit 0, `pnpm lint` clean,
  `pnpm build` succeeds. The added Playwright test mirrors the adjacent, established `strat-diag-001`
  banner test verbatim (same page, same `data-testid="no-trade-reason"` assertion).
- **Disposition**: `**Disposition**: CI-equivalent fallback` — logged per sequential-mode rules.
