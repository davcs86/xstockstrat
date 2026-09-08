# Implementation Spec: fundamentals-blend-strategy-restrictions

**Status**: `pending`
**Created**: 2026-09-08
**Feature**: `docs/roadmap/features/186-fundamentals-blend-strategy-restrictions/feature.md`
**Total Steps**: 6
**Feature Branch**: `feature/fundamentals-blend-strategy-restrictions`

---

## Execution Summary

This feature adds three guards — one execution-restriction in the live loop and two lifecycle
guards in the servicer — all keyed on the runtime config value of
`analysis.engine.fundamentals_blend_strategy_id`. Steps are ordered: (1) execution-restriction
code, (2) its tests, (3) lifecycle-guard code, (4) its tests, (5–6) documentation co-changes.
All changes touch `xstockstrat-analysis` (Python) plus two documentation surfaces mandated by
`design.md` § Documentation co-changes.

Consumer Surface (C-14): the product spec marks UI as "None" and Agent as "error-path only" —
no new tool parameters or response mappings are needed; the existing error propagation handles
the new `FAILED_PRECONDITION` rejections. C-10(c) UI waiver signed off in `context.md`.

## Scenario Coverage

| Scenario | Covered by |
|---|---|
| @AC-1 (skip when disabled) | Step 2 |
| @AC-2 (skip when universe empty) | Step 2 |
| @AC-3 (evaluate only against fundamentals universe) | Step 2 |
| @AC-4 (DEACTIVATE rejected for blend strategy) | Step 4 |
| @AC-5 (DEACTIVATE succeeds for non-blend) | Step 4 |
| @AC-6 (SetStrategyLive live_enabled=false rejected) | Step 4 |
| @AC-7 (SetStrategyLive succeeds for non-blend) | Step 4 |
| @AC-8 (protection tracks runtime config, not hardcoded ID) | Step 4 |

## Step Dependencies

- Step 2 requires Step 1: tests assert behavior introduced by Step 1.
- Step 4 requires Step 3: tests assert behavior introduced by Step 3.
- Steps 5 and 6 are independent of each other and of Steps 1–4 (docs-only).

---

### Step 1 — service: Execution restriction in _run_cycle

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/app/engine/live_loop.py` — modify

**Reviewers**: Service owner (`xstockstrat-analysis`) — Backtest reproducibility, strategy scoring determinism, no look-ahead bias

**Codebase Evidence**:
- Current two-way branch at `app/engine/live_loop.py:296-308`: `if blend_active and definition.strategy_id == blend_id` enters the fundamentals path; `else` falls through to `resolve_universe`. When `blend_active=False`, the blend strategy enters the `else` branch — this is the FR-1 gap.
- `blend_id` computed at `live_loop.py:262-264`: `self._cfg.get_str("analysis.engine.fundamentals_blend_strategy_id", "fundamentals_macd_blend")`
- `blend_active` computed at `live_loop.py:271-273`: `blend_enabled and any(dict(row).get("strategy_id") == blend_id for row in rows)`
- `fundamentals_universe` resolved at `live_loop.py:278-279`: conditional on `blend_active`
- Deny-list logic in blend path at `live_loop.py:299-301`: computes `denied`, `deny_entry`, `universe`
- `_eval_pair` consumes `deny_entry` at `live_loop.py:316`

**TDD**: red-green required

**Covers**: —

**Instructions**:

Replace the two-way branch at `app/engine/live_loop.py:296-308` with a strategy-identity-first branch per `design.md` § Chosen Approach:

```python
if definition.strategy_id == blend_id:
    # Blend strategy — fundamentals-only execution (FR-1, FR-4)
    if not blend_active or not fundamentals_universe:
        continue  # skip entirely — never resolve_universe
    denied = {_normalize_symbol(s) for s in definition.denied_symbols}
    deny_entry = held_cache[owner] & denied
    universe = (fundamentals_universe - denied) | deny_entry
else:
    # Every other strategy uses ordinary owner-scoped resolution.
    resolved = resolve_universe(
        definition, watch_cache[owner], held_cache[owner], signal_symbols
    )
    universe = resolved.universe
    deny_entry = resolved.deny_entry
```

Key changes from the current code:
1. The outer predicate is `strategy_id == blend_id` (identity), not `blend_active and strategy_id == blend_id` (state+identity). The blend strategy **never** enters the `else` branch regardless of config state.
2. When `not blend_active or not fundamentals_universe`, the strategy is `continue`d — skipped entirely, never falling through to `resolve_universe`.
3. The deny-list block (`denied`, `deny_entry`, universe subtraction + held-denied reinsertion) is preserved in the blend happy path so `deny_entry` remains defined for the downstream `_eval_pair` call at `live_loop.py:316` and the symbol check at `live_loop.py:309`.

**Verification**:
```bash
cd services/xstockstrat-analysis && ruff check app/engine/live_loop.py && ruff format --check app/engine/live_loop.py
```
Confirm: the `else` branch that calls `resolve_universe` is now unreachable for `strategy_id == blend_id`, regardless of `blend_active` state.

---

### Step 2 — test: Execution restriction tests

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/tests/test_live_loop.py` — modify

**Reviewers**: Service owner (`xstockstrat-analysis`) — Backtest reproducibility, strategy scoring determinism, no look-ahead bias

**Codebase Evidence**:
- Existing `TestLiveLoopBlendUniverse` class at `tests/test_live_loop.py:909`
- `_cfg()` helper at `:920-932` — stubs `get_str` and `get_bool` for blend config reads
- `_wire()` helper at `:934-986` — wires portfolio held/watch, ingest QuerySignals, and marketdata GetFundamentalsMulti
- `_seen_capture()` at `:989-996` — captures `(strategy_id, symbol)` pairs from `_eval_pair`
- `_live_row()` at `:629-648` — builds a live `analysis.strategies` row
- `_make_loop()` at `:36-56` — creates a `LiveEvaluationLoop` with mocked dependencies
- C-13 check: `_live_row`, `_make_loop`, `_cfg`, `_wire`, `_seen_capture` are all existing single-home helpers in this file. The new tests reuse them — no second-consumer duplication introduced.

**TDD**: red-green required

**Covers**: AC-1, AC-2, AC-3

**Instructions**:

Add the following tests to the `TestLiveLoopBlendUniverse` class in `tests/test_live_loop.py`:

1. **`test_blend_skipped_when_disabled`** (AC-1): Set `blend_enabled=False` via `_cfg(loop, enabled=False)`. Wire a single blend-strategy row via `_live_row(self.BLEND_ID, "u-1")`. Assert `_seen_capture` returns an empty set (the blend strategy was not evaluated at all). Also assert `loop._ingest.QuerySignals` was **not** called with `source == self.SLUG` (no fundamentals universe resolution attempted — no wasted calls).

2. **`test_blend_skipped_when_universe_empty`** (AC-2): Set `blend_enabled=True`. Wire `fundamentals_signals=()` and `fundamentals_rows=()` so the fundamentals universe resolves to an empty set. Assert `_seen_capture` returns an empty set.

3. **`test_blend_evaluates_only_fundamentals_universe`** (AC-3): Set `blend_enabled=True`. Wire `fundamentals_signals=("AAPL", "MSFT", "GOOG")` and `fundamentals_rows=("AAPL", "MSFT", "GOOG")`. Also add a second non-blend strategy for the same owner with `watch_by_owner={"u-1": ["TSLA"]}`. Assert the blend strategy's seen set is exactly `{(BLEND_ID, "AAPL"), (BLEND_ID, "MSFT"), (BLEND_ID, "GOOG")}` — no `TSLA`. Assert the non-blend strategy's seen set includes `TSLA` (it went through `resolve_universe`).

4. **`test_blend_does_not_fallthrough_to_resolve_universe`** (AC-1/AC-2 reinforcement): Set `blend_enabled=False`. Wire a blend-strategy row AND a non-blend strategy row. Capture the `resolve_universe` call count (mock it on the module). Assert `resolve_universe` was called exactly once — for the non-blend strategy. The blend strategy must not have triggered a `resolve_universe` call.

All tests use the existing `_cfg()`, `_wire()`, `_seen_capture()`, `_live_row()`, and `_make_loop()` helpers.

**Verification**:
```bash
cd services/xstockstrat-analysis && uv run pytest tests/test_live_loop.py -k "TestLiveLoopBlendUniverse" -v --tb=short && uv run pytest --cov=app --cov-fail-under=40 && ruff check . && ruff format --check .
```

---

### Step 3 — service: Lifecycle guards in ManageStrategy and SetStrategyLive

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/app/handlers/servicer.py` — modify

**Reviewers**: Service owner (`xstockstrat-analysis`) — Backtest reproducibility, strategy scoring determinism, no look-ahead bias

**Codebase Evidence**:
- `ManageStrategy` at `servicer.py:2370`; DEACTIVATE branch at `:2524-2531`. The ownership check is at `:2525` (`deactivate(caller_user_id, ...)`). The guard must go **before** the ownership call (anti-IDOR, per `design.md` § Chosen Approach and `recon.md` § Risks).
- `SetStrategyLive` at `servicer.py:2604`; disable path (no guard) at `:2641-2642` — falls straight to `set_live_enabled`. The enable path has a precondition check at `:2624-2638`.
- Existing `FAILED_PRECONDITION` pattern at `servicer.py:2636`: `await context.abort(grpc.StatusCode.FAILED_PRECONDITION, "cannot enable live evaluation on an inactive strategy; reactivate it first")`
- ConfigWatcher available on the servicer as `self._cfg` — confirmed at `servicer.py:391` (`self._cfg = config_watcher`)
- `self._cfg.get_str` at `app/config/watcher.py:87` — the same call used in `live_loop.py:262-264`
- Stale comment at `servicer.py:2622-2623`: "disabling is ALWAYS allowed" — must be updated to reflect the blend-strategy exception.
- No new outbound gRPC call introduced — no header propagation concern.

**TDD**: red-green required

**Covers**: —

**Instructions**:

1. **ManageStrategy DEACTIVATE guard** — insert immediately before the DEACTIVATE ownership check at `servicer.py:2524`. When `op == STRATEGY_OPERATION_DEACTIVATE`, before calling `self._strategies_repo.deactivate(...)`:

   ```python
   if op == analysis_pb2.STRATEGY_OPERATION_DEACTIVATE:
       blend_strategy_id = self._cfg.get_str(
           "analysis.engine.fundamentals_blend_strategy_id",
           "fundamentals_macd_blend",
       )
       if request.definition.strategy_id == blend_strategy_id:
           await context.abort(
               grpc.StatusCode.FAILED_PRECONDITION,
               "the fundamentals blend strategy cannot be deactivated; "
               "it is a protected platform resource",
           )
           return
       row = await self._strategies_repo.deactivate(caller_user_id, definition.strategy_id)
       ...
   ```

2. **SetStrategyLive disable guard** — insert at the top of the `SetStrategyLive` method, after the `propagation_meta` lines and before the existing `if request.live_enabled:` block at `servicer.py:2624`. When `not request.live_enabled`:

   ```python
   if not request.live_enabled:
       blend_strategy_id = self._cfg.get_str(
           "analysis.engine.fundamentals_blend_strategy_id",
           "fundamentals_macd_blend",
       )
       if request.strategy_id == blend_strategy_id:
           await context.abort(
               grpc.StatusCode.FAILED_PRECONDITION,
               "the fundamentals blend strategy cannot be set non-live; "
               "it is a protected platform resource",
           )
           return
   ```

3. **Update stale comment** at `servicer.py:2622-2623` — change "disabling is ALWAYS allowed" to "disabling is allowed for all strategies except the fundamentals blend strategy (feature 186)".

Error messages contain the exact substrings asserted in `acceptance.feature` AC-4 (`"fundamentals blend strategy cannot be deactivated"`) and AC-6 (`"fundamentals blend strategy cannot be set non-live"`).

**Verification**:
```bash
cd services/xstockstrat-analysis && ruff check app/handlers/servicer.py && ruff format --check app/handlers/servicer.py
```
Confirm: the DEACTIVATE guard is placed **before** the ownership `deactivate()` call; the disable guard is placed **before** the `set_live_enabled()` call.

---

### Step 4 — test: Lifecycle guard tests

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/tests/test_analysis_servicer.py` — modify

**Reviewers**: Service owner (`xstockstrat-analysis`) — Backtest reproducibility, strategy scoring determinism, no look-ahead bias

**Codebase Evidence**:
- `TestManageStrategy` class at `tests/test_analysis_servicer.py:655`
- `TestSetStrategyLive` class at `:873`
- `make_servicer()` at `:35-55` — returns an `AnalysisServicer` with mocked deps; `cfg.get_str` returns the default argument (`:40`)
- `_owned_ctx()` at `:58-65` — a gRPC context with `x-user-id=u1`
- `_valid_definition()` at `:621-635` — builds a valid `StrategyDefinition`
- `_row_for()` at `:638-644` — builds a DB row from a definition
- C-13 check: all helpers above are single-home fixtures in `test_analysis_servicer.py`. The new tests will reuse them; only `make_servicer` needs a config-stub override for `get_str` to return a custom blend ID when needed — this is the standard pattern (the existing `make_servicer` stubs `get_str` to return the default arg, so for the blend-ID test we override `cfg.get_str` with a side_effect that returns the custom ID for the blend key). One consumer — no centralization needed.

**TDD**: red-green required

**Covers**: AC-4, AC-5, AC-6, AC-7, AC-8

**Instructions**:

Add the following tests:

**In `TestManageStrategy`:**

1. **`test_deactivate_rejected_for_blend_strategy`** (AC-4): Create a servicer. Override `svc._cfg.get_str` to return `"fundamentals_macd_blend"` for `"analysis.engine.fundamentals_blend_strategy_id"`. Build a `ManageStrategyRequest` with `operation=DEACTIVATE` and `definition.strategy_id="fundamentals_macd_blend"`. Call with `_owned_ctx()`. Assert `context.abort` was called with `grpc.StatusCode.FAILED_PRECONDITION`. Assert the error message contains `"fundamentals blend strategy cannot be deactivated"`. Assert `svc._strategies_repo.deactivate` was **not** called (the guard fires before the ownership check).

2. **`test_deactivate_succeeds_for_non_blend_strategy`** (AC-5): Same setup, but `definition.strategy_id="my_custom_strategy"`. Wire `svc._strategies_repo.deactivate` to return a row. Assert the RPC succeeds (no abort). Assert `deactivate` was called.

3. **`test_deactivate_guard_uses_runtime_config`** (AC-8): Override `svc._cfg.get_str` to return `"custom_blend_v2"` for the blend key. Attempt DEACTIVATE with `strategy_id="custom_blend_v2"`. Assert `FAILED_PRECONDITION`. Attempt DEACTIVATE with `strategy_id="fundamentals_macd_blend"` (the old default). Assert it is **not** rejected (proceeds to ownership check).

**In `TestSetStrategyLive`:**

4. **`test_disable_rejected_for_blend_strategy`** (AC-6): Create a servicer. Override `svc._cfg.get_str` to return `"fundamentals_macd_blend"` for the blend key. Build a request with `strategy_id="fundamentals_macd_blend"` and `live_enabled=False`. Call with `_owned_ctx()`. Assert `context.abort` was called with `grpc.StatusCode.FAILED_PRECONDITION`. Assert the error message contains `"fundamentals blend strategy cannot be set non-live"`. Assert `svc._strategies_repo.set_live_enabled` was **not** called.

5. **`test_disable_succeeds_for_non_blend_strategy`** (AC-7): Same setup, but `strategy_id="my_custom_strategy"` and `live_enabled=False`. Wire `svc._strategies_repo.set_live_enabled` to return a row. Wire `svc._strategies_repo.get_by_owner_and_id` to return a row (for the ownership check path). Assert the RPC succeeds.

6. **`test_enable_not_blocked_for_blend_strategy`** (negative: enable is allowed): Ensure `live_enabled=True` for the blend strategy is **not** rejected by the new guard (only `live_enabled=False` is guarded). Wire the existing active-check precondition to succeed. Assert the RPC succeeds.

**Verification**:
```bash
cd services/xstockstrat-analysis && uv run pytest tests/test_analysis_servicer.py -k "TestManageStrategy or TestSetStrategyLive" -v --tb=short && uv run pytest --cov=app --cov-fail-under=40 && ruff check . && ruff format --check .
```

---

### Step 5 — docs: Update strat-lab plugin documentation

**Status**: `pending`
**Service**: `plugins/strat-lab`
**Files**:
- `plugins/strat-lab/skills/backtest/SKILL.md` — modify

**Reviewers**: none

**Codebase Evidence**:
- Root `CLAUDE.md` mandates strat-lab co-change when `manage_strategy` or `set_strategy_live` change (see `docs/patterns/strat-lab-plugin.md` reference in the Context Guide).
- `plugins/strat-lab/skills/backtest/SKILL.md:53-63` — the "Mutation guard" section describes `manage_strategy` lifecycle operations.
- `plugins/strat-lab/skills/backtest/SKILL.md:20` — mentions `manage_strategy` and `set_strategy_live` ownership.

**TDD**: N/A (docs-only step)

**Covers**: —

**Instructions**:

1. In `SKILL.md`, after the "Mutation guard" paragraph (around line 63), add a new paragraph:

   > **Protected strategy (feature 186).** The strategy identified by the
   > `analysis.engine.fundamentals_blend_strategy_id` config key (default
   > `"fundamentals_macd_blend"`) is a protected platform resource. `manage_strategy` with
   > `operation="deactivate"` for this strategy is rejected `FAILED_PRECONDITION`; `set_strategy_live`
   > with `live_enabled=false` for this strategy is also rejected `FAILED_PRECONDITION`. Updates
   > (`operation="update"`) and reactivation remain allowed. The protected ID is config-driven — it
   > tracks whatever value the operator sets, not a hardcoded string.

**Verification**:
```bash
grep -n "Protected strategy" plugins/strat-lab/skills/backtest/SKILL.md
```
Confirm the paragraph is present and references feature 186.

---

### Step 6 — docs: Update mcp-tools.md manage_strategy error table

**Status**: `pending`
**Service**: `docs/runbooks`
**Files**:
- `docs/runbooks/mcp-tools.md` — modify

**Reviewers**: none

**Codebase Evidence**:
- `manage_strategy` errors table at `docs/runbooks/mcp-tools.md:490-501` — lists conditions and errors for the `manage_strategy` tool.
- `design.md` § Documentation co-changes: "add one row to `manage_strategy`'s error table for the DEACTIVATE rejection".
- `set_strategy_live` has no section in `mcp-tools.md` (pre-existing gap, outside this feature's scope per `design.md`).

**TDD**: N/A (docs-only step)

**Covers**: —

**Instructions**:

Add one row to the `manage_strategy` **Errors** table at `docs/runbooks/mcp-tools.md:490-501`:

| Condition | Error |
|---|---|
| `deactivate` on the fundamentals blend strategy (feature 186) | `the fundamentals blend strategy cannot be deactivated; it is a protected platform resource` (FAILED_PRECONDITION) |

Insert after the existing "`update`/`deactivate`/`reactivate` on unknown strategy" row (line 500).

**Verification**:
```bash
grep -n "fundamentals blend strategy" docs/runbooks/mcp-tools.md
```
Confirm the new error row is present.

---

## Deviation Log

_Populated by /sdd-execute as implementation proceeds._
