# Implementation Spec: fix-backtest-silent-symbol-skip

**Status**: `pending`
**Created**: 2026-10-22
**Feature**: `docs/roadmap/features/275-fix-backtest-silent-symbol-skip/feature.md`
**Total Steps**: 11
**Feature Branch**: `feature/fix-backtest-silent-symbol-skip`
**Severity**: SEV-2

---

## Execution Summary

This spec follows `design.md` § Chosen Approach (operator option (a), round-3 gate, 2026-10-22). The order is:

1. Re-anchor every cited line on the merged 272/273/215 tree and re-run the exception inventory (Step 1).
2. Land the additive proto value and the exhaustive UI map key in **one commit** (Steps 2–3).
3. Map the backtest-path `ExecuteFormula` PERMISSION_DENIED to `FormulaExecutionError` in the evaluator, with tests (Steps 4–5).
4. Replace the silent loop catch-alls, gate the status and add the warnings, with tests (Steps 6–7).
5. Add the UI reachability spec (Step 8).
6. Update every consumer doc surface in the same PR (Steps 9–11).

**Anchors.** Every `servicer.py` line below was grepped on `origin/feature/fix-backtest-silent-symbol-skip` at
`42abc6d5`. That commit contains `origin/main-dev` `c25efbdc`, on which 272 and 273 are still `implementation-ready`
and 215 is `in-progress`. These lines are therefore **pre-272**. Step 1 is a hard gate that re-anchors them before
any code step runs.

**Consumer surfaces (C-14).** Three surfaces are named, and each gets its own step:

- Agent `run_backtest`: docstring and `mcp-tools.md` (Step 9). There is no tool code change, because enum names
  project automatically.
- strat-lab `backtest` skill (Step 10).
- `/insights` backtest view: the `NO_TRADE_MESSAGE` key (Step 3) and a Playwright reachability spec (Step 8).

### Scenario Coverage (C-15)

| Scenario | Covered by |
|---|---|
| `@AC-1` admin PERMISSION_DENIED → FORMULA_ERROR, `PERMISSION_DENIED` warning, no detail leak, INSUFFICIENT_DATA | Step 5 (evaluator mapping), Step 7 (run level) |
| `@AC-2` GetBars UNAVAILABLE → typed row + `UNAVAILABLE` warning, INSUFFICIENT_DATA | Step 7 |
| `@AC-3` unexpected ValueError → typed row + warning, INSUFFICIENT_DATA | Step 7 |
| `@AC-4` all-failed run: null score, no detail, no evidence cell, no recompute | Step 7 |
| `@AC-5` partial run stays OK and reports the failed symbol | Step 7 |
| `@AC-6` `_BarFetchError` still → FAILED_PRECONDITION, no row | Step 7 (needs 272 landed, gated by Step 1) |
| `@AC-7` owner NOT_FOUND → FORMULA_ERROR + `NOT_FOUND` warning, INSUFFICIENT_DATA | Step 5, Step 7 |
| FR-7 trace-id clause (no Gherkin scenario, by design) | Step 7 test (c) |

## Step Dependencies

- **Step 1 is a hard gate** for Steps 2–11. Features 272 (`fix-analysis-backtest-bounds`) and 273
  (`fix-agent-client-deadlines`) must be merged to `main-dev`, and `feature/fix-backtest-silent-symbol-skip` rebased
  onto it. Feature 215 must have landed its gate and proto changes. If any of them has not landed, Step 1 stops
  `/sdd-execute`.
- **Merge order.** 275 is blocked by 272 (same `RunBacktest` lines; keep 272's `except _BarFetchError: raise`), by
  273 (same strat-lab and agent docs) and by 215 (same status gate and `analysis.proto`). The
  `docs/roadmap/features/merge-order.md` rows are router-owned and need operator confirmation. This spec run is
  restricted to the feature directory, so the rows are **not** written here; they are listed in context.md as an open
  thread.
- Step 3 requires Step 2: the stubs must contain value 6. Steps 2 and 3 land in **one commit**, because the
  exhaustive `Record<NoTradeReason, string>` breaks `tsc` without the new key (fails.md:81-83).
- Step 5 [test] covers Step 4 [service]. Step 7 [test] covers Step 6 [service].
- Step 6 requires Step 4: the loop's FORMULA_ERROR arm reads the new `FormulaExecutionError.code`.
- Step 6 requires Step 3: `analysis_pb2.NO_TRADE_REASON_EVALUATION_FAILED` must exist in the regenerated stubs.
- Step 8 requires Step 3. Steps 9–10 require Step 6, because they document its warning text.
- Step 11 is last. It carries the root Teardown audit over every context file touched.

---

### Step 1 — docs: re-anchor gate and exception inventory on the merged 272/273/215 tree

**Status**: `pending`
**Service**: `xstockstrat-analysis` (read-only check; the only write is to this feature's `context.md`)
**Files**:
- `docs/roadmap/features/275-fix-backtest-silent-symbol-skip/context.md` — modify (append the re-anchor table)

**Reviewers**: none

**Codebase Evidence**:
- 272 plans the shapes this step re-checks (`docs/roadmap/features/272-fix-analysis-backtest-bounds/implementation-spec.md`):
  - Step 3 (:251, :267): rename the body to `async def _run_backtest`, and insert `except _BarFetchError: raise`
    immediately before `except grpc.RpcError as e:`.
  - Step 5 (:402-412): `async with asyncio.timeout(limit or None) as cm:` wraps `_run_backtest` in the
    `RunBacktest` wrapper, **not** inside the loop. An inner `TimeoutError` while `cm` has not expired is re-raised
    (:419).
  - Step 6 T-inner-timeout (:513-519): patches `_load_benchmark_bars`, which is awaited before the symbol loop, so it
    is outside the new arm.
- Pre-272 anchors on this branch (`grep -n` on `services/xstockstrat-analysis/app/handlers/servicer.py`):
  `_PROPAGATED_HEADERS` :350; `class _BarFetchError` :358; `async def RunBacktest` :785; `propagation_meta` :806-810;
  `formula_errors: int = 0` :905; `symbol_intents` :910; `fund_refusals = 0` :927; `fund_unknown` :928;
  `for symbol in symbols_to_run:` :996; `symbol_intents[symbol] = sym_intent` :1046; `_compute_metrics` :1050;
  `except _InsufficientData` :1065; `except _FundamentalsUnavailable` :1086; `except _FundamentalsUnknown` :1104;
  `except FormulaExecutionError as fe` :1112-1126; `except grpc.RpcError as e` :1127-1129;
  `except Exception as e` :1130-1132; gate :1235-1242; `fund_unknown` warnings :1263-1266;
  `self._backtests[backtest_id] = result` :1267; `_persist_backtest_detail` :1313-1314; recompute condition :1320;
  `analysis.backtest.completed` `AppendEvent` :1344-1352; `raise_unreadable=True` :2036.
- `services/xstockstrat-analysis/app/services/evaluator.py`: `class FormulaExecutionError` :102-110 (`__init__(self,
  formula_id, error)` :107); `_execute_formula` :254-266 (`if e.code() != grpc.StatusCode.NOT_FOUND: raise` :260-261).
  `raise_unreadable=True` is set **only** at `servicer.py:2036`. The other `StrategyEvaluator(` sites are :3874,
  :4175, :4416, :4869, :5485 and :5964, plus `app/main.py:156`, and all use the default `False`.
- `packages/proto/analysis/v1/analysis.proto:196-203`: the last `NoTradeReason` value is
  `NO_TRADE_REASON_FUNDAMENTALS_UNAVAILABLE = 5`.

**TDD**: N/A (verification/checklist step; no code)

**Covers**: —

**Instructions**:
1. Confirm the prerequisites are merged to `origin/main-dev` and rebase the feature branch onto it:
   - 272 and 273 are merged, so their `status.md` is past `implementation-ready`.
   - 215 has its `NO_TRADE_REASON_FUNDAMENTALS_UNAVAILABLE`, `fund_refusals` and `fund_unknown` in the tree.
   - If any prerequisite is missing, **stop** and report it to the operator. Do not proceed to Step 2.
2. Re-grep every anchor listed under Codebase Evidence on the rebased tree. Append a table to `context.md` in the
   form `symbol | pre-272 line | merged line`. Steps 2–11 use the merged lines.
3. Answer the three re-anchor questions from design.md § Open Risks, and record each answer in `context.md`:
   - (a) Is 272's deadline an `asyncio.timeout` around `_run_backtest`, as planned, rather than an in-loop
     `wait_for`? If it is in-loop, **stop**: the decision not to re-raise `TimeoutError` must be revisited with the
     operator (design Open Risk 2).
   - (b) Does a `GetBars` RPC error still reach the loop as a raw `grpc.RpcError`, not wrapped in `_BarFetchError`?
     Check `_fetch_bars_paged`, near :1394 pre-272. If it is wrapped, AC-2 and AC-5 need re-design, so **stop**.
   - (c) Is `NoTradeReason` value 6 still free? If it is taken, use the next free value and record it. Steps 2, 3
     and 8 then use that number.
4. **Exception inventory (design §8).** Re-grep every `raise` and every custom exception class reachable from the
   symbol-loop `try:` body:
   - `_backtest_symbol_evaluated` and its callees (`_resolve_prefixed_bars`, `_fetch_bars_paged`,
     `_load_fundamentals`, `StrategyEvaluator.evaluate*`)
   - `_backtest_symbol`
   - `_compute_metrics`

   List each exception that must keep propagating. Today these are `_BarFetchError` and `CancelledError`, which is a
   `BaseException`. Any new sentinel from 272, 273 or 215 must sit above the broad arm in Step 6. Record the list in
   `context.md`.
5. Re-check the indicators contract the Step 4 mapping relies on:
   `services/xstockstrat-indicators/app/handlers/servicer.py:243-253` returns PERMISSION_DENIED to an admin caller
   and NOT_FOUND to anyone else for an unreadable formula (design Open Risk 6).

**Verification**:
```bash
git fetch origin && git merge-base --is-ancestor origin/main-dev HEAD && echo REBASED
cd services/xstockstrat-analysis \
  && grep -n "async def _run_backtest\|except _BarFetchError\|asyncio.timeout(limit or None)\|for symbol in symbols_to_run\|except grpc.RpcError as e\|except Exception as e\|formula_errors: int = 0\|fund_unknown: list\|or fund_refusals > 0\|raise_unreadable=True" app/handlers/servicer.py \
  && grep -n "class FormulaExecutionError\|StatusCode.NOT_FOUND" app/services/evaluator.py
grep -n "NO_TRADE_REASON_.* = [0-9]*;" packages/proto/analysis/v1/analysis.proto
```
`context.md` holds the re-anchor table, answers (a)–(c) and the exception inventory.

---

### Step 2 — proto: add `NO_TRADE_REASON_EVALUATION_FAILED = 6` and draw the 6-vs-4 boundary

**Status**: `pending`
**Service**: `packages/proto`
**Files**:
- `packages/proto/analysis/v1/analysis.proto` — modify

**Reviewers**: Proto Reviewer — field number uniqueness, backward compatibility, `buf lint`/`buf breaking`; `xstockstrat-analysis` owner — backtest reproducibility, strategy scoring determinism, no look-ahead bias; `xstockstrat-ui` owner — analytics display accuracy (exhaustive `NO_TRADE_MESSAGE` consumer)

**Codebase Evidence**:
- `packages/proto/analysis/v1/analysis.proto:196-203`: `enum NoTradeReason` ends at
  `NO_TRADE_REASON_FUNDAMENTALS_UNAVAILABLE = 5; // … (feature 215)`. `NO_TRADE_REASON_FORMULA_ERROR = 4;` has the
  trailing comment `// a custom-formula component failed to execute / returned an out-of-contract series`.
- Adding an enum value is additive and non-breaking ("Adding a new enum value", `docs/runbooks/proto-versioning.md`;
  product-spec § Fix Scope). It stays on `analysis/v1`, with no v2 and no breaking-change approval.

**TDD**: N/A (proto)

**Covers**: —

**Instructions**:
1. Append, after the value-5 line, using the number confirmed in Step 1(c):
   `NO_TRADE_REASON_EVALUATION_FAILED = 6; // not evaluated: an upstream RPC error or an unexpected exception during evaluation (e.g. a GetBars/ComputeIndicator status, or an ExecuteFormula status other than NOT_FOUND/PERMISSION_DENIED) — see the run warnings (feature 275)`
2. Widen the value-4 trailing comment to name the operator option (a) case:
   `// a custom-formula component failed to execute / returned an out-of-contract series, or the strategy owner cannot run the formula (indicators NOT_FOUND to the owner, PERMISSION_DENIED to an admin caller)`
3. Do not touch any other enum or message.

**Verification**:
```bash
cd packages/proto && buf lint && buf breaking --against '/home/user/xstockstrat/.git#branch=feature/fix-backtest-silent-symbol-skip,subdir=packages/proto'
```
Use the `subdir=` form exactly (PLAT-10). Replace the repo-root path with the executing worktree's own `.git` root
if it differs.

---

### Step 3 — proto-gen: regenerate stubs and add the exhaustive UI `NO_TRADE_MESSAGE` key (same commit)

**Status**: `pending`
**Service**: `packages/proto`, `xstockstrat-ui`
**Files**:
- `packages/proto/gen/**` — modify (generated by `./scripts/buf-gen.sh`; never hand-edited)
- `services/xstockstrat-ui/src/components/insights/BacktestDiagnostics.tsx` — modify

**Reviewers**: Proto Reviewer — field number uniqueness, backward compatibility, `buf lint`/`buf breaking`; `xstockstrat-analysis` owner — backtest reproducibility, strategy scoring determinism, no look-ahead bias; `xstockstrat-ui` owner — analytics display accuracy (inherited from Step 2)

**Codebase Evidence**:
- `services/xstockstrat-ui/src/components/insights/BacktestDiagnostics.tsx:41-52`:
  `const NO_TRADE_MESSAGE: Record<NoTradeReason, string> = { … [NoTradeReason.FUNDAMENTALS_UNAVAILABLE]: 'No trades — this strategy requires fundamentals …' }`.
  The map is exhaustive (fails.md:81-83, feature 067).
- `services/xstockstrat-ui/package.json:8`: `"build": "next build"`.

**TDD**: N/A (proto-gen; the frontend build is the compile check)

**Covers**: —

**Instructions**:
1. Run `./scripts/buf-gen.sh` from the repo root. Commit the regenerated `packages/proto/gen/` stubs.
2. In `NO_TRADE_MESSAGE`, after the `FUNDAMENTALS_UNAVAILABLE` entry, add:
   `[NoTradeReason.EVALUATION_FAILED]: 'Not evaluated — an upstream service error or an unexpected error stopped this symbol from being evaluated. See the run warnings for the symbol and the error code.',`
   - The copy must **not** start with "No trades —" (design §1).
   - Step 8 asserts the substring `stopped this symbol from being evaluated`.
3. Make Steps 2 and 3 **one commit**. `proto-freshness` CI must be green.

**Verification**:
```bash
./scripts/buf-gen.sh && git status --porcelain packages/proto/gen/ | head
grep -rn "EVALUATION_FAILED" packages/proto/analysis/v1/analysis.proto services/xstockstrat-ui/src/components/insights/BacktestDiagnostics.tsx
cd services/xstockstrat-ui && pnpm run lint && pnpm build
```
`pnpm build` must succeed, because `tsc` proves the map is exhaustive. A second `./scripts/buf-gen.sh` must leave an
empty `git diff packages/proto/gen/`.

---

### Step 4 — service: map backtest-path `ExecuteFormula` PERMISSION_DENIED to `FormulaExecutionError` with a status code

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/app/services/evaluator.py` — modify

**Reviewers**: `xstockstrat-analysis` owner — backtest reproducibility, strategy scoring determinism, no look-ahead bias

**Codebase Evidence**:
- `evaluator.py:102-110`: `class FormulaExecutionError(Exception)` with
  `def __init__(self, formula_id: str, error: str)`, which sets `self.formula_id` and `self.error`.
- `evaluator.py:254-266`, `_execute_formula`:
  ```python
  except grpc.aio.AioRpcError as e:
      if e.code() != grpc.StatusCode.NOT_FOUND:
          raise
      if self._raise_unreadable:
          raise FormulaExecutionError(comp.formula_id, "not readable by owner") from e
      if comp.formula_id not in self.unreadable_formulas: … return None
  ```
- Other raise sites keep the 2-arg form: `evaluator.py:134` and `:138` (contract errors, `resp.error`), and
  `:531`/`:538`.
- `raise_unreadable` is propagated by `for_owner` (`evaluator.py:247-252`) and set `True` only on the backtest path
  (`servicer.py:2036`, re-anchored in Step 1).
- Indicators `servicer.py:243-253`: an admin non-author gets PERMISSION_DENIED
  `"admins cannot execute another user's formula"`, and every other non-author gets NOT_FOUND.

**TDD**: red-green required

**Covers**: —

**Instructions**:
1. Give `FormulaExecutionError.__init__` an optional third parameter, `code: str = ""`, and store `self.code = code`.
   - It carries the gRPC status **name** only.
   - Update the class docstring in one line: `code` is set only for an owner-unreadable refusal.
   - Leave every existing 2-arg call site unchanged, so contract errors keep `code == ""`.
2. In `_execute_formula`:
   - If `self._raise_unreadable` and `e.code()` is in `(grpc.StatusCode.NOT_FOUND, grpc.StatusCode.PERMISSION_DENIED)`:
     `raise FormulaExecutionError(comp.formula_id, "not readable by owner", e.code().name) from e`.
   - Otherwise keep today's behavior exactly:
     - a non-NOT_FOUND code re-raises
     - NOT_FOUND on the live path skips the component with the one-time `"formula %s not readable by owner"` warning
       and `return None`
   - The live path (`_raise_unreadable` False) must still re-raise PERMISSION_DENIED (@AC-5 @feature-224 PRESERVE).
3. Never put `e.details()` into the exception message or `code`. The PERMISSION_DENIED detail names the foreign
   author.
4. No new outbound call, so header propagation is unchanged: the call keeps `metadata=self._meta`.

**Verification**:
```bash
cd services/xstockstrat-analysis \
  && grep -n "code: str = \"\"\|PERMISSION_DENIED\|e.code().name" app/services/evaluator.py \
  && ruff check . && ruff format --check .
```
Behavior is verified in Step 5.

---

### Step 5 — test: evaluator refusal mapping (design test (f), unit level)

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/tests/conftest.py` — modify (add the shared `aio_rpc_error` builder)
- `services/xstockstrat-analysis/tests/test_unreadable_formula.py` — modify

**Reviewers**: `xstockstrat-analysis` owner — backtest reproducibility, strategy scoring determinism, no look-ahead bias

**Codebase Evidence**:
- `tests/test_unreadable_formula.py:33-36`: `_not_found()` builds
  `grpc.aio.AioRpcError(grpc.StatusCode.NOT_FOUND, grpc.aio.Metadata(), grpc.aio.Metadata(), "formula not found")`.
- It imports `StrategyEvaluator` (:17) and `RecordingStub, ctx_with` from `tests.conftest` (:18).
- `test_ac5_live_loop_skips_unreadable_component_as_owner` (:90) is the live-path pin.
- `tests/conftest.py:71`: `def ctx_with(headers)`. Line :79: `OWNER_HEADERS` (scope `"1"`, trace `"t-1"`).

**TDD**: red-green required

**Covers**: `AC-1, AC-7` (the evaluator half: one refusal, one outcome, across caller scopes)

**Instructions**:
1. **C-13.** An `AioRpcError` builder gains a second consumer in this step and Step 7. Add
   `def aio_rpc_error(code, details=""):` to `tests/conftest.py`, returning
   `grpc.aio.AioRpcError(code, grpc.aio.Metadata(), grpc.aio.Metadata(), details)`. Make `_not_found()` in
   `test_unreadable_formula.py` return `aio_rpc_error(grpc.StatusCode.NOT_FOUND, "formula not found")`. Do not leave
   a second inline builder.
2. Add the unit tests. Each builds `StrategyEvaluator(indicators, (("x-user-id", "bob"),), raise_unreadable=...)`
   with `indicators.ExecuteFormula = AsyncMock(side_effect=...)`, and calls
   `await ev._execute_formula(SimpleNamespace(formula_id="f-zscore"), MagicMock())`.
   - `test_backtest_permission_denied_maps_to_formula_error_with_code` (AC-1):
     - Input: `raise_unreadable=True` and
       `aio_rpc_error(PERMISSION_DENIED, "admins cannot execute another user's formula")`.
     - Assert it raises `FormulaExecutionError` with `.code == "PERMISSION_DENIED"`.
     - Assert `"admins cannot" not in str(exc)` and `"admins cannot" not in exc.error`.
     - **RED** before Step 4: today the `AioRpcError` propagates.
   - `test_backtest_not_found_maps_to_formula_error_with_code` (AC-7):
     - Input: `raise_unreadable=True` and NOT_FOUND.
     - Assert `.code == "NOT_FOUND"`. **RED**: `code` does not exist yet.
   - `test_contract_error_formula_error_has_no_code`:
     - Construct `FormulaExecutionError("f-1", "boom")` directly.
     - Assert `.code == ""`.
   - `test_live_path_permission_denied_still_reraises` (@AC-5 @feature-224 PRESERVE):
     - Input: `raise_unreadable=False` and PERMISSION_DENIED.
     - Assert `pytest.raises(grpc.aio.AioRpcError)`.
     - This is a green pin.
   - `test_live_path_not_found_still_skips`:
     - Input: `raise_unreadable=False` and NOT_FOUND.
     - Assert it returns `None`, and that `ev.unreadable_formulas == {"f-zscore"}`.
     - This is a green pin.
   - `test_backtest_unavailable_still_reraises` (the 6-vs-4 boundary at unit level):
     - Input: `raise_unreadable=True` and UNAVAILABLE.
     - Assert `pytest.raises(grpc.aio.AioRpcError)`.
3. Keep the existing `test_ac5_*` and `test_ac30_*` tests unchanged and green.

**Verification**:
```bash
cd services/xstockstrat-analysis \
  && uv run pytest tests/test_unreadable_formula.py -q \
  && uv run pytest --cov=app --cov-fail-under=40 \
  && ruff check . && ruff format --check . \
  && grep -n "def aio_rpc_error\|from tests.conftest import" tests/conftest.py tests/test_unreadable_formula.py
```
The C-13 check: `grep -rn "grpc.aio.AioRpcError(" tests/test_unreadable_formula.py` returns no hit, because the
builder lives only in `conftest.py`.

---

### Step 6 — service: one inline `except Exception` arm, the `eval_failures` gate term and per-symbol warnings

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/app/handlers/servicer.py` — modify

**Reviewers**: `xstockstrat-analysis` owner — backtest reproducibility, strategy scoring determinism, no look-ahead bias

**Codebase Evidence** (pre-272 lines; use the Step 1 table):
- `servicer.py:350`: `_PROPAGATED_HEADERS = ("x-user-id", "x-access-scope", "x-trace-id")`.
- `:806-810`: `propagation_meta = [(k, v) for k, v in context.invocation_metadata() if k in (…)]`. This is the
  run-scoped trace source; mint no new context (operator 2026-10-21, C-03).
- `:905`: `formula_errors: int = 0`. `:910`: `symbol_intents: dict[str, list[BarIntent]] = {}`.
  `:928`: `fund_unknown: list[str] = []`.
- `:1046`: `symbol_intents[symbol] = sym_intent` is buffered **before** `_compute_metrics` at `:1050` (the design §3
  pop target). `_simulate_portfolio(symbol_intents, …)` is called at `:1182-1183`.
- `:1112-1126`: the `except FormulaExecutionError as fe:` row template
  (`SymbolDiagnostics(symbol=…, bars=[], no_trade_reason=…, bars_total=0, warmup_bars=0)`, then
  `formula_errors += 1`, then `continue`).
- `:1127-1132`: the defect. `except grpc.RpcError as e: log.warning(...); continue` and
  `except Exception as e: log.warning(...); continue`.
- `:1235-1241`: the gate `if (not all_trades and len(daily_equity) <= 1 and (coverage_gaps or formula_errors or
  fund_refusals or fund_unknown)):` sets `INSUFFICIENT_DATA`.
- `:1263-1266`: `if fund_unknown: result.warnings.extend(f"fundamentals fetch failed for {sym} — rerun" for sym in
  fund_unknown)`.
- `:1290-1299`: `score = None` unless OK. `:1313-1314`: detail only when OK. `:1320`: recompute when
  `status == OK or fund_refusals > 0`. This **stays unchanged** (@AC-11 @feature-215).
- `:1344-1352`: `analysis.backtest.completed` `AppendEvent(…, metadata=propagation_meta)`. Unchanged.

**TDD**: red-green required

**Covers**: —

**Instructions**:
1. Add a module constant beside `_PROPAGATED_HEADERS`:
   `EVAL_FAILED_WARNING = "backtest symbol {symbol} not evaluated: {code}"`. It is public because Step 7 imports
   it (design §4).
2. Beside `formula_errors: int = 0`, declare `eval_failures: list[tuple[str, str]] = []`.
3. In the `except FormulaExecutionError as fe:` arm, keep the row and `formula_errors += 1`. Before `continue`, add
   `if fe.code: eval_failures.append((symbol, fe.code))`. This gives the FR-3/FR-8 warning to the mapped refusals
   only. Contract errors keep their no-warning behavior (design Open Risk 5, confirmed at `/sdd-review impl-spec`).
4. Replace the two catch-alls (`:1127-1132` pre-272; post-272 they sit after 272's `except _BarFetchError: raise`,
   which **stays first**) with any new sentinel re-raises from the Step 1 inventory, then exactly **one** arm:
   ```python
   except Exception as e:
       code = e.code().name if isinstance(e, grpc.RpcError) and callable(getattr(e, "code", None)) else type(e).__name__
       symbol_intents.pop(symbol, None)
       log.warning(
           "backtest symbol=%s strategy=%s not evaluated: %s (%s) trace_id=%s",
           symbol, request.strategy_id, code, e,
           dict(propagation_meta).get("x-trace-id", ""),
           exc_info=not isinstance(e, grpc.RpcError),
       )
       all_diagnostics.append(
           analysis_pb2.SymbolDiagnostics(
               symbol=symbol, bars=[],
               no_trade_reason=analysis_pb2.NO_TRADE_REASON_EVALUATION_FAILED,
               bars_total=0, warmup_bars=0,
           )
       )
       eval_failures.append((symbol, code))
       continue
   ```
   - Read the trace id with `.get(…, "")`, never a subscript (design §3).
   - Do not add `except TimeoutError` (Rejected Alternatives). 272's deadline arrives as `CancelledError`, which is a
     `BaseException` and passes through.
   - There is one arm and no helper (C-18).
5. Gate: add `or eval_failures` to the or-chain at `:1238` **only**. Do not touch `:1320`.
6. Warnings: immediately after the `fund_unknown` block (`:1263-1266`), add:
   `if eval_failures: result.warnings.extend(EVAL_FAILED_WARNING.format(symbol=s, code=c) for s, c in eval_failures)`
   - The server log carries the full error. The client warning carries the code name only, never `e.details()`.
7. Update the gate comment above `:1235` in one line, so it names evaluation failures as a gate term.

**Verification**:
```bash
cd services/xstockstrat-analysis \
  && grep -n "EVAL_FAILED_WARNING\|eval_failures\|NO_TRADE_REASON_EVALUATION_FAILED\|except _BarFetchError\|symbol_intents.pop" app/handlers/servicer.py \
  && ruff check . && ruff format --check .
```
Inspect the loop by hand: no `except grpc.RpcError` arm and no second `except Exception` remain in the `RunBacktest`
symbol loop, and `except _BarFetchError: raise` precedes the single arm. The `:1320` condition is still
`status == OK or fund_refusals > 0`. Behavior is verified in Step 7.

---

### Step 7 — test: RunBacktest evaluation-failure surfacing (AC-1 … AC-7, design tests (a)–(g))

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/tests/test_analysis_servicer.py` — modify (new class
  `TestEvaluationFailureSurfacing` directly after `TestFormulaErrorSurfacing`)

**Reviewers**: `xstockstrat-analysis` owner — backtest reproducibility, strategy scoring determinism, no look-ahead bias

**Codebase Evidence**:
- `tests/test_analysis_servicer.py:1614`: `class TestFormulaErrorSurfacing`, with helpers `_req(definition, symbols)`,
  `_formula_def()` (custom-formula component `f-1`, entry `ff > 0`) and `_wire(svc, bars, execute_side_effect)`
  (ledger, marketdata `GetBars`, indicators `ExecuteFormula`/`GetFormula`).
  - Its tests `test_partial_run_stamps_formula_error_and_keeps_sibling` and `test_all_failed_run_is_insufficient_and_unscored`
    are the exact shape to mirror.
- `make_servicer` :36; `_owned_ctx` :63 (scope `"7"`, admin bit set, trace `"t1"`); `_EOF_PAGE` :136; `_bar` :1396.
- `tests/conftest.py`: `ctx_with` :71, `OWNER_HEADERS` :79 (scope `"1"`), and Step 5's `aio_rpc_error`.
- `tests/test_warmup.py:260`: `pytest.raises(_BarFetchError, match=...)` style.
- `tests/test_backtest_fundamentals_guard.py:192-207`: the `caplog.at_level(logging.WARNING)` record-scan style.

**TDD**: red-green required

**Covers**: `AC-1, AC-2, AC-3, AC-4, AC-5, AC-6, AC-7`

**Instructions**:
1. **C-13.** Reuse rather than copy. Build requests and wiring through `h = TestFormulaErrorSurfacing()`
   (`h._req`, `h._formula_def`, `h._wire`). Do not subclass it, because that would re-collect its tests. Use
   `aio_rpc_error` from `tests.conftest`. Import `EVAL_FAILED_WARNING` and `_BarFetchError` from
   `app.handlers.servicer`. Assert warnings via `EVAL_FAILED_WARNING.format(...)`, never a literal.
2. Tests. Use the default six-bar series `[_bar(7200 + i, c) …]` unless a test says otherwise. Every test except (a')
   and (e) asserts the returned `result`.
   - **AC-1** `test_ac1_admin_permission_denied_is_formula_error_and_insufficient`:
     - Input: `ExecuteFormula` side effect
       `aio_rpc_error(PERMISSION_DENIED, "admins cannot execute another user's formula")`; ctx `_owned_ctx()`.
     - Assert the AAPL row is `NO_TRADE_REASON_FORMULA_ERROR`.
     - Assert `EVAL_FAILED_WARNING.format(symbol="AAPL", code="PERMISSION_DENIED") in result.warnings`.
     - Assert no warning contains `"admins cannot"`.
     - Assert `result.status == BACKTEST_STATUS_INSUFFICIENT_DATA`.
     - **RED**: today there is no row and the status is OK.
   - **AC-7** `test_ac7_owner_not_found_is_formula_error_with_not_found_warning`:
     - Input: NOT_FOUND; ctx `ctx_with(OWNER_HEADERS)`.
     - Assert the FORMULA_ERROR row, the `code="NOT_FOUND"` warning and INSUFFICIENT_DATA.
     - **RED** on the warning.
   - **AC-2** `test_ac2_getbars_unavailable_is_evaluation_failed`:
     - Input: `svc._marketdata.GetBars = AsyncMock(side_effect=aio_rpc_error(UNAVAILABLE))`, symbol `SCHD`.
     - Assert the `SCHD` row is `NO_TRADE_REASON_EVALUATION_FAILED`, the `code="UNAVAILABLE"` warning is present, and
       the status is INSUFFICIENT_DATA.
   - **AC-3** `test_ac3_unexpected_exception_is_evaluation_failed`:
     - Input: `svc._backtest_symbol_evaluated = AsyncMock(side_effect=ValueError("boom"))`.
     - Assert the EVALUATION_FAILED row for AAPL, the `code="ValueError"` warning and INSUFFICIENT_DATA.
   - **AC-4** `test_ac4_all_failed_run_is_unscored_and_not_persisted_as_ok`:
     - Input: PERMISSION_DENIED for both `["AAPL", "SCHD"]`.
     - Patch these as `AsyncMock()`: `svc._persist_backtest_run`, `svc._persist_backtest_detail`,
       `svc._persist_symbol_cells` and `svc._recompute_headline`.
     - Assert the status is INSUFFICIENT_DATA.
     - Assert `_persist_backtest_run` was awaited with `score` (its 3rd positional arg) `is None`.
     - Assert `_persist_backtest_detail`, `_persist_symbol_cells` and `_recompute_headline` were not awaited.
     - **RED**: today the status is OK, so the detail and the recompute run.
   - **AC-5** `test_ac5_partial_run_stays_ok_and_reports_failed_symbol`:
     - Input: `GetBars` side effect function. AAPL returns
       `SimpleNamespace(page=_EOF_PAGE, bars=bars)` with an `ExecuteFormula` success output `{"value": [1.0]*len(bars)}`
       that fires `ff > 0`, as in `test_partial_run_stamps_formula_error_and_keeps_sibling`. MSFT raises
       `aio_rpc_error(UNAVAILABLE)`.
     - Assert the status is OK and `result.total_trades >= 1`.
     - Assert the MSFT row is EVALUATION_FAILED and the `code="UNAVAILABLE"` warning names MSFT.
   - **(a)** `test_per_symbol_timeout_is_evaluation_failed_row`:
     - Input: `_backtest_symbol_evaluated` raises `TimeoutError()`.
     - Assert the EVALUATION_FAILED row and the `code="TimeoutError"` warning.
   - **(a')** `test_cancelled_error_propagates`:
     - Input: `_backtest_symbol_evaluated` raises `asyncio.CancelledError()`.
     - Assert `pytest.raises(asyncio.CancelledError)`.
     - Green pin: `CancelledError` is a `BaseException`.
   - **(b)** `test_fund_refused_plus_eval_failed_still_recomputes` (@AC-11 @feature-215 PRESERVE):
     - Input: AAPL raises `_FundamentalsUnavailable` and MSFT raises `ValueError`, both via a side-effect function on
       `_backtest_symbol_evaluated`.
     - Assert `_recompute_headline` was awaited once.
   - **(c)** `test_eval_failure_log_carries_trace_id`:
     - Input: run AC-3 under `caplog.at_level(logging.WARNING)` with `_owned_ctx()`.
     - Assert a record whose message contains `"AAPL"`, `"ValueError"` and `"t1"`.
     - Assert `svc._ledger.AppendEvent` was awaited with `event_type == "analysis.backtest.completed"` and
       `metadata` containing `("x-trace-id", "t1")`.
     - Variant `test_eval_failure_without_trace_id_still_records_row`: ctx
       `ctx_with([("x-user-id", "u1"), ("x-access-scope", "1")])`. Assert the row and the warning exist and nothing
       raises.
   - **(d)** `test_portfolio_mode_excludes_symbol_whose_metrics_raise` (@AC-5 @feature-150 CHANGE, signed off
     2026-10-22):
     - Input: `sizing_mode=SIZING_MODE_PORTFOLIO`, symbols `["AAPL", "MSFT"]`, both evaluating normally.
     - Patch `app.handlers.servicer._compute_metrics` so that the first call (the AAPL cell) raises `ValueError` and
       every later call delegates to the real function.
     - Spy `svc._simulate_portfolio`.
     - Assert AAPL is **not** a key of the `symbol_intents` argument and MSFT is.
     - Assert the AAPL row is EVALUATION_FAILED.
   - **(e)** `test_bar_fetch_error_still_propagates_past_broad_arm` (AC-6; needs 272, gated by Step 1):
     - Input: `_backtest_symbol_evaluated` raises `_BarFetchError("…")`.
     - Assert the call fails, either as `pytest.raises(Exception, match="aborted")` with `ctx.abort` awaited with
       `grpc.StatusCode.FAILED_PRECONDITION`, or by matching 272's landed wrapper shape (re-anchored in Step 1).
     - Assert no EVALUATION_FAILED row was produced, i.e. `_persist_backtest_run` was not awaited with one.
   - **(f) run level**: covered by AC-1 and AC-7 above. Also add
     `test_formula_contract_error_adds_no_eval_warning`: `ExecuteFormula` returns
     `SimpleNamespace(success=False, output=Struct(), error="boom")`. Assert the FORMULA_ERROR row, and that no
     warning starts with `"backtest symbol AAPL not evaluated"`.
   - **(g)** `test_execute_formula_unavailable_is_evaluation_failed`:
     - Input: `ExecuteFormula` raises `aio_rpc_error(UNAVAILABLE)` with `_owned_ctx()`.
     - Assert the EVALUATION_FAILED row (not FORMULA_ERROR) and the `code="UNAVAILABLE"` warning.
3. Leave the existing `TestFormulaErrorSurfacing`, `tests/test_unreadable_formula.py`,
   `tests/test_backtest_fundamentals_guard.py` (@AC-8/@AC-11 @feature-215) and 272's `test_warmup.py` tests unchanged
   and green.

**Verification**:
```bash
cd services/xstockstrat-analysis \
  && uv run pytest tests/test_analysis_servicer.py -q -k "EvaluationFailureSurfacing or FormulaErrorSurfacing" \
  && uv run pytest --cov=app --cov-fail-under=40 \
  && ruff check . && ruff format --check . \
  && grep -n "from tests.conftest import\|EVAL_FAILED_WARNING" tests/test_analysis_servicer.py
```
- Run the new tests against the post-Step-4, pre-Step-6 tree first, and capture the RED run (AC-1/2/3/4/7 and (g)
  fail).
- Pins (a'), (b) and (c)'s `AppendEvent` assertion pass before Step 6 by design; record that in the TDD log.
- C-13: `grep -rn "grpc.aio.AioRpcError(" tests/test_analysis_servicer.py` shows no new inline builder.

---

### Step 8 — test: `/insights` reachability of the new reason and warning (C-10, C-12, C-14)

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/e2e/fixtures/backtests.ts` — modify
- `services/xstockstrat-ui/e2e/fixtures/INVENTORY.md` — modify
- `services/xstockstrat-ui/e2e/mock-backend.ts` — modify
- `services/xstockstrat-ui/e2e/insights/backtest-coverage.spec.ts` — modify

**Reviewers**: `xstockstrat-ui` owner — analytics display accuracy, Connect-RPC call safety

**Codebase Evidence**:
- `e2e/mock-backend.ts:1050-1069`: the `strat-fundamentals-etf-001` sentinel branch returns `status: 2`,
  `coverageGaps: []` and one diagnostic `noTradeReason: 5`. Lines :1071-1090 hold the `strat-formula-error-001`
  branch.
- `e2e/insights/backtest-coverage.spec.ts:97-108` (FORMULA_ERROR banner) and :110-127 (refused-only
  INSUFFICIENT_DATA run, `getByTestId('no-trade-reason')`, `getByTestId('insufficient-data')` count 0).
- The view renders warnings in `src/app/insights/strategies/[id]/page.tsx:509-516` (`data-testid="backtest-warnings"`)
  and `<BacktestDiagnostics>` for INSUFFICIENT_DATA at :569-574.
- `e2e/fixtures/backtests.ts:91-94`: the `BACKTEST_SEED_SPAN_WARNING` / `BACKTEST_SEED_SPAN_RESULT` warning-fixture
  pattern. `INVENTORY.md:32` holds its catalog row, and :60-62 hold the sentinel rows.

**TDD**: red-green required (the spec fails until the mock branch and fixture exist)

**Covers**: — (consumer-surface reachability for C-10/C-14; no `@AC-*` scenario is UI-only)

**Instructions**:
1. **C-12.** The warning string is used by both the mock and the spec, so centralize it. In `e2e/fixtures/backtests.ts`,
   add `export const BACKTEST_EVAL_FAILED_WARNING = 'backtest symbol AAPL not evaluated: UNAVAILABLE';`.
   - It mirrors analysis `EVAL_FAILED_WARNING`, filled with symbol `AAPL` and code `UNAVAILABLE`.
   - Add an `INVENTORY.md` table row beside :32: `Evaluation-failed warning (275) | BACKTEST_EVAL_FAILED_WARNING | e2e/fixtures/backtests.ts | BacktestResult (warnings) | e2e/mock-backend.ts, e2e/insights/backtest-coverage.spec.ts`.
2. In `mock-backend.ts`, before the `strat-formula-error-001` branch, add a `strat-eval-failed-001` sentinel branch
   modeled on :1050-1069:
   - `status: 2` (INSUFFICIENT_DATA), `totalTrades: 0`, `trades: []`, `coverageGaps: []`
   - `warnings: [BACKTEST_EVAL_FAILED_WARNING]`
   - one diagnostic `{ symbol: 'AAPL', barsTotal: 0, warmupBars: 0, noTradeReason: 6, bars: [] }`, using the Step 1
     number
   - a trailing `// NO_TRADE_REASON_EVALUATION_FAILED` comment

   Add the sentinel row beside `INVENTORY.md:62`.
3. In `backtest-coverage.spec.ts`, add `test('evaluation-failed backtest renders the not-evaluated reason and the
   warning', …)`, cloned from :110-127:
   - `goto('/insights/strategies/strat-eval-failed-001')`, then click Run Backtest.
   - `getByTestId('no-trade-reason')` contains `stopped this symbol from being evaluated`.
   - `getByTestId('backtest-warnings')` contains `BACKTEST_EVAL_FAILED_WARNING`, imported from `../fixtures`.
   - `getByTestId('insufficient-data')` has count 0, because there is no coverage gap.
   - A passing `tsc` is not enough (design §6). This spec is the reachability proof.

**Verification**:
```bash
cd services/xstockstrat-ui \
  && pnpm run lint \
  && grep -n "from '../fixtures'\|BACKTEST_EVAL_FAILED_WARNING" e2e/insights/backtest-coverage.spec.ts e2e/mock-backend.ts \
  && grep -n "BACKTEST_EVAL_FAILED_WARNING\|strat-eval-failed-001" e2e/fixtures/INVENTORY.md \
  && pnpm test:e2e e2e/insights/backtest-coverage.spec.ts
```
Use `../../scripts/run-e2e.sh` if local Chromium is unavailable.

---

### Step 9 — docs: agent `run_backtest` docstring and `docs/runbooks/mcp-tools.md` (C-14, fails.md:307-309)

**Status**: `pending`
**Service**: `xstockstrat-agent` (docstring only), `docs/runbooks/`
**Files**:
- `services/xstockstrat-agent/app/tools.py` — modify (the `run_backtest` docstring only)
- `docs/runbooks/mcp-tools.md` — modify

**Reviewers**: none (docs). The `xstockstrat-agent` owner's MCP-contract-parity focus applies at PR review.

**Codebase Evidence**:
- `services/xstockstrat-agent/app/tools.py:749-750`: "A run with no diagnostics and no trades (e.g.
  BACKTEST_STATUS_INSUFFICIENT_DATA) has NO attachment — the summary with `coverage_gaps` is the whole result."
- The feature-215 paragraph at :768-778 is the style to mirror.
- `docs/runbooks/mcp-tools.md:308-310`: the INSUFFICIENT_DATA `coverage_gaps` → `trigger_backfill` bullet.
- `backtest_view.py` passes warnings (:73-74) and per-symbol `no_trade_reason` (`_SYMBOL_KEYS` :51) through. A new
  enum **value** needs no `_INTENTIONALLY_DROPPED` decision (recon.md).

**TDD**: N/A (docs)

**Covers**: —

**Instructions**:
1. Replace `tools.py:749-750` with the design §7 text: "An INSUFFICIENT_DATA run has NO attachment; its
   coverage_gaps, warnings and per-symbol diagnostics are inline. An all-failed run has coverage_gaps: [] but
   non-empty diagnostics with NO_TRADE_REASON_EVALUATION_FAILED or NO_TRADE_REASON_FORMULA_ERROR."
2. After the :768-778 paragraph, add one paragraph covering three points:
   - A symbol that could not be evaluated gets `NO_TRADE_REASON_EVALUATION_FAILED` and a
     `backtest symbol <SYM> not evaluated: <CODE>` warning.
   - An owner-unreadable formula is `NO_TRADE_REASON_FORMULA_ERROR` with a `PERMISSION_DENIED` (admin caller) or
     `NOT_FOUND` (owner) code.
   - The discriminator:
     - Never backfill an INSUFFICIENT_DATA run with empty `coverage_gaps`.
     - On UNAVAILABLE, DEADLINE_EXCEEDED or RESOURCE_EXHAUSTED, rerun later.
     - On PERMISSION_DENIED, NOT_FOUND or a Python exception name, report it.
3. Add the same contract as a bullet next to `mcp-tools.md:308-310`. Also note that INSUFFICIENT_DATA runs persist no
   detail, so these rows are lost on restart or a Past-Runs reload (design Open Risk 8).
4. Keep `list_templates` / `instantiate_template` mentions intact and never mention `is_public` / `include_public`
   (@AC-32 @feature-224 PRESERVE).

**Verification**:
```bash
grep -n "EVALUATION_FAILED\|not evaluated" services/xstockstrat-agent/app/tools.py docs/runbooks/mcp-tools.md
grep -n "is_public\|include_public" docs/runbooks/mcp-tools.md || true
cd services/xstockstrat-agent && uv run pytest --cov=app --cov-fail-under=40 && ruff check . && ruff format --check .
```
The agent suite, including the descriptor-parity `tests/test_backtest_view.py` and `tests/test_tools_endpoint.py`,
stays green.

---

### Step 10 — docs: strat-lab `backtest` skill (same-PR rule, `docs/patterns/strat-lab-plugin.md`)

**Status**: `pending`
**Service**: `plugins/strat-lab/`
**Files**:
- `plugins/strat-lab/skills/backtest/SKILL.md` — modify
- `plugins/strat-lab/skills/backtest/reference/output-handling.md` — modify
- `plugins/strat-lab/skills/backtest/reference/self-grill.md` — modify
- `plugins/strat-lab/skills/backtest/reference/verification.md` — modify
- `plugins/strat-lab/skills/backtest/reference/backfill.md` — modify

**Reviewers**: none (docs)

**Codebase Evidence**:
- `SKILL.md:99-100` teaches "`BACKTEST_STATUS_INSUFFICIENT_DATA` … `trigger_backfill` … and re-run".
  `SKILL.md:164-173` holds the feature-215 "refuse un-evaluable symbols" paragraph.
- `reference/output-handling.md:21-28` holds the `no_trade_reason` list (`ENTRY_NEVER_TRUE`, `FUNDAMENTALS_UNAVAILABLE`).
- `reference/self-grill.md:33-39` (§6, "Did you hide a bad status?").
- `reference/verification.md:26-33` ("… may be the same silent non-evaluation, not a real no-signal").
- `reference/backfill.md` has the headings `## Steps` (:8) and `## When to skip` (:26), and no failure discriminator.

**TDD**: N/A (docs)

**Covers**: —

**Instructions**:
1. `SKILL.md`: after :164-173, add a paragraph on the new reason, the warning format and option (a): FORMULA_ERROR now
   also covers an owner-unreadable formula for both admin and owner callers. At :99-100, add the discriminator: an
   INSUFFICIENT_DATA run with empty `coverage_gaps` and EVALUATION_FAILED or FORMULA_ERROR rows is never a backfill
   case.
2. `output-handling.md`: add a `NO_TRADE_REASON_EVALUATION_FAILED` bullet beside the :23-28 bullets, covering:
   - "not evaluated; read the `backtest symbol <SYM> not evaluated: <CODE>` warning"
   - it is never a no-signal result
   - extend the FORMULA_ERROR description with the owner-unreadable case
3. `self-grill.md` §6: add two sub-bullets with the option (a) wording:
   - EVALUATION_FAILED means the symbol was not evaluated, so it must never be averaged in as 0
   - a `… not evaluated: <CODE>` warning must be reported with its code class
4. `verification.md:26-33`: correct the "silent non-evaluation" line. Non-evaluation is no longer silent; it shows as
   an EVALUATION_FAILED or FORMULA_ERROR row plus a warning.
5. `backfill.md` `## When to skip`: add the three-way discriminator (backfill never / rerun later / report).
6. Keep @AC-32 @feature-224 parity: no `is_public` / `include_public`, and the template tools stay listed.

**Verification**:
```bash
grep -n "EVALUATION_FAILED\|not evaluated" plugins/strat-lab/skills/backtest/SKILL.md plugins/strat-lab/skills/backtest/reference/*.md
grep -rn "is_public\|include_public" plugins/strat-lab/skills/backtest/ || true
```
Every one of the five files has at least one hit. There are no `is_public` hits.

---

### Step 11 — docs: analysis `CLAUDE.md` null-score drift and root Teardown audit

**Status**: `pending`
**Service**: `xstockstrat-analysis` (docs)
**Files**:
- `services/xstockstrat-analysis/CLAUDE.md` — modify

**Reviewers**: none (docs)

**Codebase Evidence**:
- `services/xstockstrat-analysis/CLAUDE.md:109`: "(INSUFFICIENT runs record history with a 0 score / empty rating)".
- The code stores `score = None` unless OK (`servicer.py:1290-1299`, product-spec FR-5).

**TDD**: N/A (docs)

**Covers**: —

**Instructions**:
1. Change "a 0 score / empty rating" to "a null score / empty rating". In the same section, add one sentence: an
   all-failed run (every symbol EVALUATION_FAILED or FORMULA_ERROR) is INSUFFICIENT_DATA, and its per-symbol rows are
   in-memory only.
2. **Root Teardown.** This PR changes context files (`CLAUDE.md`, `mcp-tools.md`, the skill) and the behavior they
   describe. Run `/context-forge:context-constitution refresh`, scoped to `services/xstockstrat-analysis`,
   `services/xstockstrat-agent` and `plugins/strat-lab`, and fix the grounded drift it reports. If the plugin is
   unavailable, re-read each touched context file against the code and record in the PR body **both** that the plugin
   was unavailable **and** what manual reconciliation was done (fails.md:670).
3. At integration, `/sdd-execute` promotes this feature's `acceptance.feature` into
   `services/xstockstrat-analysis/acceptance/` (C-16). It records the signed-off @AC-5 @feature-150 CHANGE and the
   @AC-30 @feature-224 EXTEND (design § Business Rules Touched).

**Verification**:
```bash
grep -n "null score" services/xstockstrat-analysis/CLAUDE.md && ! grep -n "0 score" services/xstockstrat-analysis/CLAUDE.md
```
The PR body carries the Teardown record.

---

## Deviation Log

_Populated by /sdd-execute as implementation proceeds._
