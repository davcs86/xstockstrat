# Implementation Spec: fix-indicators-formula-correctness

**Status**: `pending`
**Created**: 2026-10-22
**Feature**: `docs/roadmap/features/268-fix-indicators-formula-correctness/feature.md`
**Total Steps**: 10
**Feature Branch**: `feature/fix-indicators-formula-correctness`

---

## Execution Summary

The steps follow design.md's build order: D-54, then D-10, then D-18 (engine, then UI), then docs.
Each code step is followed by its paired test step. All code changes are in `xstockstrat-indicators`,
plus two strings in `xstockstrat-ui`. There is no proto, migration, config or `xstockstrat-analysis`
change. D-18 is Option A, so `packages/proto` and `xstockstrat-analysis` are consumers whose code does
not change. No step adds an outbound gRPC call, so header and trace propagation (C-03) is untouched
(operator standing decision 2026-10-21).

**Scenario coverage (C-15):**

| Scenario | Covered by |
|---|---|
| `@AC-1` exits before output → failure | Step 4 |
| `@AC-2` unparseable output line → failure | Step 4 |
| `@AC-3` assigns result → success | Step 4 |
| `@AC-4` ATR described as close-to-close approximation | Step 6 (engine + servicer), Step 8 (UI catalog text) |
| `@AC-5` VWAP described as running mean | Step 6 (engine + servicer), Step 8 (UI catalog text) |
| `@AC-6` UpdateFormula refuses pending-hidden row | Step 2 |
| `@AC-7` DeleteFormula refuses pending-hidden row | Step 2 |

**Consumer surfaces (C-14):**

- `/insights` formula workspace run result. It needs no code change, because it already renders the
  failure: `FormulaRunResult.tsx:70-71` shows `Passed`/`Failed` from `result.success`. The new
  `success=false` from Step 3 is what reaches it.
- `/insights` strategy catalog. Steps 7 and 8 update it (`strategyCatalog.ts:99`, `:104`). This also
  satisfies C-10.
- Agent `test_formula`. It needs no code change. It returns the full sandbox result as-is
  (`services/xstockstrat-agent/app/tools.py:1488-1495`, `client.execute_formula(...)`; docstring
  `:1485-1487` lists success, error and exit_reason).
- Agent `manage_formula` update/delete. It needs no code change. Its gRPC error mapping already
  handles `NOT_FOUND` (`tools.py:232`), so Step 1's NOT_FOUND reaches it unchanged.
- Agent `run_backtest` / `screen_symbols`. Under Option A the numbers do not change, so there is
  nothing to land.

design.md approved these pass-throughs at the design gate (§ Consumer surfaces). They are a decision,
not an omission.

## Step Dependencies

- Step 2 [test] covers Step 1 [service].
- Step 4 [test] covers Step 3 [service].
- Step 6 [test] covers Step 5 [service].
- Step 8 [test] covers Step 7 [service].
- Step 7 must keep the exact strings from Step 5: the UI catalog mirrors the engine registry text.
- Step 9 requires Steps 1, 3 and 5, because it documents the behavior they ship.
- Step 10 is independent. It files the "never assigns `result`" gap, which is out of scope here.
- Steps 1–4 have no ordering constraint between them except the pairing. design.md fixes the order
  D-54 → D-10.
- **Rebase / merge order (Open Risk):**
  - 244-fix-python-config-stored-zero edits `sandbox.py` near `:282` and `:345-346`, and the
    `ExecuteFormula` config reads in `servicer.py`.
  - 269-fix-template-update-metadata edits template RPCs in `servicer.py`.
  - Both regions are disjoint from Steps 1 and 3. Whichever feature lands second rebases.
  - The `docs/roadmap/features/merge-order.md` entry is out of this spec session's write scope (the
    single-writer rule allows feature-dir files only). `/sdd-execute` adds it at integration-PR time if
    244 or 269 is still open.
- **Saga re-verification (Open Risk, closed here):** the saga's commit and abort never go through
  `UpdateFormula`/`DeleteFormula`.
  - They run through `FormulasRepository.resolve_intent`
    (`app/services/formulas_repository.py:137-150`), which is called only from `servicer.py:738`.
  - Copies are created by `create_pending_copies` (`:127-135`), which is called only from
    `servicer.py:711`.
  - So Step 1's guard cannot block saga resolution (`@AC-19@feature-224` is preserved).
- **Accepted debt (named follow-up, after launch):** the ATR/VWAP text is duplicated between
  `indicators_engine.py` and `strategyCatalog.ts`. The follow-up is to source the UI catalog from
  `ListIndicators` (`servicer.py:354-363`).

---

### Step 1 — service: D-54 — pending-hidden rows return NOT_FOUND on UpdateFormula/DeleteFormula

**Status**: `done`
**Service**: `xstockstrat-indicators`
**Files**:
- `services/xstockstrat-indicators/app/handlers/servicer.py` — modify

**Reviewers**: `xstockstrat-indicators` owner — formula sandboxing, numeric precision, timeout enforcement, no side-effects from formula execution

**Codebase Evidence**:
- `_load_formula` hides pending rows — `servicer.py:150-158`. The predicate at `:156` is
  `if row is not None and row.get("pending_intent_id") is None:`.
- `UpdateFormula`:
  - `@owner_scoped` at `:485`; `async def UpdateFormula` at `:486`;
  - raw `row = await self._repo.get_by_id(request.formula_id)` at `:490`;
  - `if row is None:` at `:491`, then `context.abort(grpc.StatusCode.NOT_FOUND, f"formula {request.formula_id} not found")` and `return` at `:492-495`;
  - `SYSTEM_AUTHOR` check at `:496`; author check at `:502`; `deleted_at` check at `:507-512`.
- `DeleteFormula`:
  - `async def DeleteFormula` at `:589`;
  - raw `get_by_id` at `:593`;
  - `if row is None:` at `:594`, then the NOT_FOUND abort at `:595-598`;
  - `SYSTEM_AUTHOR` check at `:599`; author check at `:605`; `self._repo.delete` at `:610`.
- The saga does not use these RPCs: `resolve_intent` is called only at `servicer.py:738`, and
  `create_pending_copies` only at `:711`.

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. In `UpdateFormula`, change `if row is None:` at `servicer.py:491` to
   `if row is None or row.get("pending_intent_id") is not None:`. This is the same predicate as
   `_load_formula` (`:156`), inverted. Leave the NOT_FOUND abort message and `return` (`:492-495`)
   exactly as they are, so a pending row cannot be told apart from a missing one.
2. In `DeleteFormula`, make the same change at `:594`, and leave `:595-598` unchanged.
3. The check order that results:
   - Update: missing or pending → `SYSTEM_AUTHOR` → owner → `deleted_at`.
   - Delete: missing or pending → `SYSTEM_AUTHOR` → owner.
4. Do not change the repository SQL (`formulas_repository.py`). Do not route these RPCs through
   `_load_formula`: it returns a converted formula and may serve from the cache (recon.md § Patterns to
   REUSE).
5. Add no new helper, comment or log line.

**Verification**:
```bash
grep -n 'if row is None or row.get("pending_intent_id") is not None:' services/xstockstrat-indicators/app/handlers/servicer.py
```
Expect exactly 2 hits, one in `UpdateFormula` and one in `DeleteFormula`. Lint is run in Step 2.

---

### Step 2 — test: D-54 guard-branch tests for UpdateFormula/DeleteFormula

**Status**: `done`
**Service**: `xstockstrat-indicators`
**Files**:
- `services/xstockstrat-indicators/tests/test_private_formulas.py` — modify

**Reviewers**: `xstockstrat-indicators` owner — formula sandboxing, numeric precision, timeout enforcement, no side-effects from formula execution

**Codebase Evidence**:
- The existing row builder is `def _row(formula_id, author, pending_intent_id=None, is_public=False)`
  at `tests/test_private_formulas.py:29-45`. It already carries `pending_intent_id` and `deleted_at`.
- The existing servicer factory is `def _servicer(rows=(), audit_error=None)` at `:48-60`, with
  `repo.update = AsyncMock(...)` at `:54` and `repo.delete = AsyncMock(return_value=True)` at `:55`.
- The admin context helper is `def _admin(peer_sans=())` at `:62-66`, and `ADMIN_SCOPE = "7"` is
  at `:16`.
- The pending-read precedent is `class TestPendingAndCache` at `:276`, with
  `test_pending_intent_row_is_not_found_and_never_cached` at `:278` using the pending id
  `"0e1c2d3f-0000-0000-0000-01"`.
- Request messages are real pb2 classes: `indicators_pb2.UpdateFormulaRequest(formula_id=..., name=...)`
  and `indicators_pb2.DeleteFormulaRequest(formula_id=...)` (precedent `tests/test_formulas.py:544`,
  `:575`).
- `ctx_with` is at `tests/conftest.py:21`. It makes `ctx.abort` an `AsyncMock` that raises
  `grpc.RpcError` (`:32`).
- `SYSTEM_AUTHOR` is imported at `test_private_formulas.py:10`
  (`from app.formulas import SYSTEM_AUTHOR`).
- Ledger traps:
  - `fails.md:75` (063): add a test per guard branch.
  - `fails.md:726-728`: use real pb2 messages, never MagicMock proto stand-ins.
  - `fails.md:2392-2400`: run sandbox and subprocess suites through the service venv.

**TDD**: `red-green required`

**Covers**: `AC-6, AC-7`

**Instructions**:
1. Add `class TestPendingHiddenMutation` after `TestPendingAndCache` in
   `tests/test_private_formulas.py`. Build every row with the existing `_row` builder and every
   servicer with `_servicer`.
2. **C-13 verdict.** This file is the only consumer of `_row`, so the rule's lazy materialization
   keeps it module-local. design.md's goal of "one builder, no inline dict copies" is met by reusing
   `_row`. Do not create a `conftest.py` builder. Write the deleted-row variant as the scenario
   one-off spread `{**_row("f-1", "u-1"), "deleted_at": <non-None>}`.
3. Write one test per guard branch, using real `indicators_pb2` requests and `ctx_with([("x-user-id", <caller>)])`
   (or `_admin()` for ADMIN). In each case, assert `ctx.abort.await_args.args[0]` is the expected
   status code.
   - **AC-6:** row `_row("f-1", "u-1", pending_intent_id="i-1")`. `"u-1"` calls `UpdateFormula`.
     Expect `NOT_FOUND`, `repo.update.assert_not_awaited()`, and the stored row dict unchanged
     (compare it with a `dict(...)` snapshot taken before the call).
   - **AC-7:** the same row. `"u-1"` calls `DeleteFormula`. Expect `NOT_FOUND`,
     `repo.delete.assert_not_awaited()`, and `row["deleted_at"] is None`.
   - A pending row authored by `SYSTEM_AUTHOR`, for both Update and Delete: expect `NOT_FOUND`. This
     proves the pending check runs before the system check. Assert `update`/`delete` was not awaited.
   - A pending foreign row (author `"alice"`) called by ADMIN through `_admin()`, for both Update and
     Delete: expect `NOT_FOUND`. Assert not awaited.
   - **Preserve the existing branches,** each as its own case, unless it is already covered in
     `tests/test_formulas.py` (`TestSystemFormulaReadOnly` `:737`, `TestFormulaAdminOverride` `:539`,
     `TestFormulaDeletedFlag` `:875`). If it is already covered there, cite it and do not duplicate it.
     - missing id → `NOT_FOUND`;
     - a non-pending system row → `PERMISSION_DENIED` (`@AC-23@feature-224`);
     - a non-pending foreign row by ADMIN → `PERMISSION_DENIED` (`@AC-28@feature-224`);
     - a non-pending deleted row → `FAILED_PRECONDITION` (Update only).
4. Name the scenario ID (`AC-6` / `AC-7`) in each covering test's docstring, for the RED-assertion
   trace.

**Verification**:
```bash
cd services/xstockstrat-indicators && uv sync --extra dev && .venv/bin/python -m pytest tests/test_private_formulas.py -k PendingHiddenMutation -v && .venv/bin/python -m pytest --cov=app --cov-fail-under=50 && ruff check . && ruff format --check .
grep -n "from tests.conftest import\|def _row" tests/test_private_formulas.py   # C-13: the single _row builder; no second inline row dict added
```
RED proof: before Step 1, the AC-6/AC-7 cases fail, because UpdateFormula proceeds to `repo.update` and
DeleteFormula soft-deletes.

---

### Step 3 — service: D-10 — a sandbox run with no parseable output line fails

**Status**: `done`
**Service**: `xstockstrat-indicators`
**Files**:
- `services/xstockstrat-indicators/app/services/sandbox.py` — modify

**Reviewers**: `xstockstrat-indicators` owner — formula sandboxing, numeric precision, timeout enforcement, no side-effects from formula execution

**Codebase Evidence**:
- `_SANDBOX_WRAPPER = textwrap.dedent("""` at `sandbox.py:206`.
  - It is a **non-raw** string filled by `.format(` (`:348`), so braces are doubled (`{{}}`) and any
    `\n` written in the source becomes a real newline in the child's code.
- The wrapper output block is at `:310-312` (`:310` is the comment `# Output must be assigned to result variable`; the code is on `:311-312`):
  `_output = _formula_globals.get('result', {{}})` then
  `print("__OUTPUT__:" + json.dumps(_output if isinstance(_output, dict) else {{"value": _output}}))`.
- The user `exec` is at `:307`.
- The parent parse:
  - `output = {}` at `:394`;
  - `for line in stdout.splitlines():` / `if line.startswith("__OUTPUT__:"):` at `:395-396`;
  - `output = json.loads(line[len("__OUTPUT__:") :])` at `:398`;
  - `except json.JSONDecodeError: pass` at `:399-400`.
- `if proc.returncode != 0:` at `:402`, followed by the stderr classification at `:403-407`
  (`"is not allowed in sandbox"` → `import_blocked`; `_MEMORY_EXHAUSTED_MARKERS` → `memory_exceeded`).
- The failure result `SandboxResult(success=False, output={}, stdout=stdout, stderr=stderr, execution_ms=elapsed_ms, memory_used_bytes=0, error=stderr.strip()[-500:], exit_reason=exit_reason)`
  is at `:408-417`.
- The success result (`exit_reason="success"`) is at `:419-428`.
- The timeout branch (`except subprocess.TimeoutExpired`, with its own `SandboxResult`) is at
  `:378-390`. It stays untouched.
- The `SandboxResult` fields are at `:190-197`. The `exit_reason` comment lists
  `"success"|"timeout"|"memory_exceeded"|"runtime_error"|"import_blocked"`.
- `servicer.py:313-319` maps `"runtime_error"` to `indicators_pb2.SANDBOX_EXIT_REASON_RUNTIME_ERROR`,
  so no enum value is added.
- The restricted builtins line `sandbox.py:252` stays unchanged. Stripping it was rejected in
  design.md.

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. **Marker framing.** At `:312`, make the wrapper print a leading newline before the marker. In the
   Python **source** of `sandbox.py`, write `print("\\n__OUTPUT__:" + json.dumps(...))`. The doubled
   backslash is required: the template is a non-raw triple-quoted string, so a single `\n` would put a
   literal newline inside the child's string literal and cause a `SyntaxError` in every formula. The
   child must receive `"\n__OUTPUT__:"`.
2. **Parse loop** (`:394-400`). Replace it with a loop that keeps the raw payload of the **last** line
   that `startswith("__OUTPUT__:")` (for example `marker = line[len("__OUTPUT__:"):]`, initialised to
   `None`). Remove the in-loop `json.loads` and the swallowed `JSONDecodeError`.
3. **Single failure constructor (C-18).** Inside `execute_formula`, define a local closure
   `_fail(error, exit_reason)`. It returns
   `SandboxResult(success=False, output={}, stdout=stdout, stderr=stderr, execution_ms=elapsed_ms, memory_used_bytes=0, error=error, exit_reason=exit_reason)`,
   which is the shape at `:408-417`. Define it after `elapsed_ms` is computed (`:392`). The timeout
   branch is not routed through it.
4. **rc≠0 branch** (`:402-417`). Keep the classification at `:403-407` exactly. Replace the inline
   `SandboxResult(...)` with
   `return _fail(stderr.strip()[-500:] or f"formula exited with code {proc.returncode} before producing output", exit_reason)`.
   The fallback is required, because product-spec FR-1 requires a non-empty `error` and
   `SystemExit(1)` leaves stderr empty.
5. **rc==0 only** (after the rc≠0 branch, before the success return):
   - if `marker is None`, return `_fail("formula produced no output", "runtime_error")`;
   - else `try: output = json.loads(marker)`, and on `except json.JSONDecodeError as e:` return
     `_fail(f"formula output could not be parsed: {e}", "runtime_error")`;
   - else fall through to the existing success return (`:419-428`) with `output`.
6. Do not touch `:252`, the timeout branch, the stderr markers, or `memory_used_bytes`. Those belong
   to separate open reports, out of scope.

**Verification**:
```bash
grep -n '__OUTPUT__' services/xstockstrat-indicators/app/services/sandbox.py   # wrapper print carries \\n; parse uses startswith
grep -n 'def _fail\|_fail(' services/xstockstrat-indicators/app/services/sandbox.py   # expect 4 lines: the def line also matches '_fail(', plus 3 call sites (rc!=0, no output, unparseable)
grep -n 'except json.JSONDecodeError:$' services/xstockstrat-indicators/app/services/sandbox.py   # expect no hit (the swallow is gone)
```
Lint and coverage are run in Step 4.

**Execute-time risk (impl-spec review 2026-10-22):** the `"\\n__OUTPUT__:"` escape in instruction 1 is
the highest-risk edit in this feature. A wrong escape breaks every formula with a `SyntaxError`. Step 4's
AC-3 and marker-framing guard catch it, so run Step 4's suite right after this edit, before moving on.

---

### Step 4 — test: D-10 sandbox failure semantics, success guard and preserved classifications

**Status**: `done`
**Service**: `xstockstrat-indicators`
**Files**:
- `services/xstockstrat-indicators/tests/test_sandbox.py` — modify
- `services/xstockstrat-indicators/tests/test_formulas.py` — modify

**Reviewers**: `xstockstrat-indicators` owner — formula sandboxing, numeric precision, timeout enforcement, no side-effects from formula execution

**Codebase Evidence**:
- `tests/test_sandbox.py` imports `from app.services.sandbox import _sandbox_env, execute_formula` (`:7`).
- `class TestSandboxExecution` is at `:10`. Its success asserts are at `:23`, `:46`, `:55`, `:119`,
  `:140`, `:174` and `:185`, and every one of those formulas assigns `result`.
- The `runtime_error` assert pattern is at `:35-36`.
- The run pattern is `execute_formula(source=..., input_data={}, allowed_imports=[...])` (`:18-22`).
- A traversal path to the real `os` already exists in `tests/test_sandbox_isolation.py:434`:
  `"import numpy\n_os = numpy.lib._datasource.os\n"`. Its helper is
  `_run(src, allowed=("numpy", "pandas", "math", "statistics"), ...)` at `:42-43`.
- `_fake_popen(captured, returncode=0, stdout="__OUTPUT__:{}", stderr="")` is at
  `test_sandbox_isolation.py:60`. Its default stdout still parses under per-line `startswith`. Its
  callers are at `:218` (rc=1, OpenBLAS) and `:353` (default).
- The servicer-level `ExecuteFormula` precedent:
  - `class TestExecuteFormulaInlineParameters` at `tests/test_formulas.py:473`;
  - `_cfg()` at `:478-484`;
  - `indicators_pb2.ExecuteFormulaRequest(formula_source=...)` at `:490-491`;
  - `IndicatorsServicer(config_watcher=self._cfg())` at `:489`.
- `ExecuteFormulaRequest.formula_source = 2` is at `packages/proto/indicators/v1/indicators.proto:77`.

**TDD**: `red-green required`

**Covers**: `AC-1, AC-2, AC-3`

**Instructions**:
1. In `tests/test_sandbox.py`, add `class TestSandboxNoOutputFails`. Give each test a docstring that
   names its scenario.
   - **AC-1:** `source="raise SystemExit(0)"`. Expect `success is False`, `"produced no output" in res.error`,
     `res.output == {}`, and `res.exit_reason == "runtime_error"`.
   - **AC-2:** `source='print("__OUTPUT__:{")\nraise SystemExit(0)'`. Expect `success is False`,
     `"could not be parsed" in res.error`, and `exit_reason == "runtime_error"`.
   - **AC-3:** `source="result = {'x': 1}"`. Expect `success is True`, `res.output == {"x": 1}`, and
     `res.error == ""`.
   - **Marker framing guard:** `source='result = {"x": 1}\nprint("x", end="")'`. Expect
     `success is True` and `output == {"x": 1}`.
   - **`os._exit` path:** `source="import numpy\nnumpy.lib._datasource.os._exit(0)"` with
     `allowed_imports=["numpy"]`. This mirrors the path at `test_sandbox_isolation.py:434`. Expect
     `success is False` and `"produced no output" in res.error`.
   - **Empty-stderr non-zero exit:** `source="raise SystemExit(1)"`. Expect `success is False`,
     `res.error != ""`, and `"exited with code 1" in res.error`.
2. In `tests/test_formulas.py`, add one servicer-level test using real `indicators_pb2` messages.
   Call `ExecuteFormula` with `formula_source="raise SystemExit(0)"` and the existing
   `TestExecuteFormulaInlineParameters`-style `_cfg()`. Reuse that class's `_cfg` by adding the test
   to that class, rather than adding a fourth copy of `_cfg`. Assert:
   - `resp.success is False`;
   - `resp.exit_reason == indicators_pb2.SANDBOX_EXIT_REASON_RUNTIME_ERROR`;
   - `"produced no output" in resp.error`.
3. Do not edit the `@feature-228` / `@feature-209` tests in `tests/test_sandbox_isolation.py`. The
   full suite run below re-runs them unchanged, which preserves `@AC-1..5@feature-228` and
   `@AC-3/@AC-4@feature-209`.
4. **C-13 verdict:** these are formula-source string one-offs, not domain fixtures, so inline is
   compliant. No conftest change.

**Verification**:
```bash
cd services/xstockstrat-indicators && uv sync --extra dev && .venv/bin/python -m pytest tests/test_sandbox.py tests/test_sandbox_isolation.py tests/test_formulas.py -v && .venv/bin/python -m pytest --cov=app --cov-fail-under=50 && ruff check . && ruff format --check .
```
RED proof: before Step 3, AC-1, AC-2, the `os._exit` case and the `SystemExit(1)` error-text case
fail. AC-3 and the framing guard pass both before and after; they are guards, not RED assertions.

---

### Step 5 — service: D-18 Option A — honest ATR/VWAP descriptions in the engine registry

**Status**: `done`
**Service**: `xstockstrat-indicators`
**Files**:
- `services/xstockstrat-indicators/app/services/indicators_engine.py` — modify

**Reviewers**: `xstockstrat-indicators` owner — formula sandboxing, numeric precision, timeout enforcement, no side-effects from formula execution

**Codebase Evidence**:
- `def _atr(arr: np.ndarray, params: dict)` is at `indicators_engine.py:103`. Its docstring at `:104`
  reads `"""ATR requires high, low, close. If only 1D array, approximates using range."""`, and the
  math at `:107` is `s.diff().abs().rolling(window=period).mean()`.
- `def _vwap(...)` is at `:111`. Its docstring at `:112` reads
  `"""VWAP approximation without volume data — returns cumulative average."""`, and it computes
  `np.cumsum(arr)` divided by `np.arange(1, len(arr) + 1)` (`:113-115`).
- `INDICATOR_REGISTRY = {` is at `:135`, with
  `"ATR": {"description": "Average True Range", "required": ["period"]}` at `:141` and
  `"VWAP": {"description": "Volume Weighted Average Price", "required": []}` at `:142`.
- The dispatch entries `"ATR": _atr` and `"VWAP": _vwap` are at `:30-31`. They are unchanged.
- `ListIndicators` builds `IndicatorMeta(description=info["description"])` from `INDICATOR_REGISTRY`
  (`app/handlers/servicer.py:355-363`).

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. Set `"description"` at `:141` to exactly
   `"ATR (close-to-close approximation): rolling mean of |close change| over period; not Wilder's true range"`.
2. Set `"description"` at `:142` to exactly
   `"VWAP (running mean approximation): cumulative mean of closes; no volume weighting"`.
3. Correct the docstrings at `:104` and `:112` to say what the code computes (the rolling mean of
   absolute close-to-close change; the cumulative mean of the inputs) and that it is not the
   true-range / volume-weighted indicator.
4. Leave the keys, `"required"`, the dispatch at `:30-31` and the math unchanged. Analysis consumers
   (`evaluator.py:141`, `:196-197`; `app/services/screener.py:319`, the `_latest_indicator("ATR", ...)`
   call, with its close-only comment starting at `:313`; `warmup.py:86`, `:108`;
   `app/engine/pnl_pattern_consumer.py:50`, `DEFAULT_INDICATORS = ("RSI", "ATR")`) keep resolving,
   with identical numbers.

**Verification**:
```bash
grep -n '"ATR": {"description"\|"VWAP": {"description"' services/xstockstrat-indicators/app/services/indicators_engine.py
grep -c "Average True Range\|Volume Weighted Average Price" services/xstockstrat-indicators/app/services/indicators_engine.py   # expect 0
```
Lint and coverage are run in Step 6.

---

### Step 6 — test: D-18 ATR/VWAP descriptions and unchanged values (engine + servicer)

**Status**: `done`
**Service**: `xstockstrat-indicators`
**Files**:
- `services/xstockstrat-indicators/tests/test_indicators_engine.py` — modify

**Reviewers**: `xstockstrat-indicators` owner — formula sandboxing, numeric precision, timeout enforcement, no side-effects from formula execution

**Codebase Evidence**:
- `tests/test_indicators_engine.py` imports `from app.services import indicators_engine` (`:11`) and
  `from app.services.indicators_engine import compute` (`:12`).
- Its classes are `TestSMA` `:26` … `TestIndicatorDefaultsPinning` `:158`. The `("ATR", "period", 14)`
  pin is at `:182`, and the VWAP finite-at-index-0 check is at `:199-204`.
- There is no existing `ListIndicators` or servicer `ComputeIndicator` test. The only mention is
  `test_owner_scoped_completeness.py:14` (`EXEMPT = {"ComputeIndicator", "ListIndicators", ...}`).
- Servicer `ComputeIndicator` is at `services/xstockstrat-indicators/app/handlers/servicer.py:204`. It
  drops points where `r.get("value") is None` (`:217`) and builds
  `indicators_pb2.IndicatorPoint(value=..., extra=...)` (`:221`).
- Servicer `ListIndicators` is at `:355-363`. Construction is `IndicatorsServicer(config_watcher=...)`,
  as in `tests/test_formulas.py:489`. `ComputeIndicator` and `ListIndicators` are owner-scope-exempt,
  so a bare `ctx_with([])` (`tests/conftest.py:21`) suffices.
- `ComputeIndicatorRequest` fields are `indicator`, `values` and `params` (`indicators.proto:54-61`).

**TDD**: `red-green required`

**Covers**: `AC-4, AC-5`

**Instructions**:
1. Add `class TestAtrVwapHonestDescriptions` to `tests/test_indicators_engine.py`.
2. **AC-4, engine level:**
   - `indicators_engine.INDICATOR_REGISTRY` still has the key `"ATR"`;
   - its description does not contain `"Average True Range"`;
   - it contains `"close-to-close approximation"`;
   - `[r["value"] for r in compute("ATR", [10, 12, 11, 13], {"period": 2})] == [None, None, 1.5, 1.5]`.
     The signature is `def compute(indicator: str, values: list[float], params: dict[str, float])`
     (`indicators_engine.py:16`).
3. **AC-5, engine level:**
   - the key `"VWAP"` is present;
   - the description does not contain `"Volume Weighted Average Price"`;
   - it contains `"running mean"`;
   - `compute("VWAP", [10, 20, 30], {})` values are `[10.0, 15.0, 20.0]`.
4. **Servicer level (AC-4/AC-5),** using real `indicators_pb2` messages:
   - `await IndicatorsServicer(config_watcher=<cfg MagicMock>).ListIndicators(indicators_pb2.ListIndicatorsRequest(), ctx_with([]))`.
     Assert that the `ATR` and `VWAP` `IndicatorMeta.description` values meet the same text
     conditions.
   - `ComputeIndicator(indicators_pb2.ComputeIndicatorRequest(indicator="ATR", values=[10, 12, 11, 13], params={"period": 2}), ctx)`.
     Assert `[p.value for p in resp.result] == [1.5, 1.5]`, which also shows the 2 warm-up
     positions are omitted.
   - `VWAP` with `values=[10, 20, 30]` gives `[10.0, 15.0, 20.0]`.
   - The response field is `repeated IndicatorPoint result = 1` (`indicators.proto:64`), and
     `params` is `map<string, double>` (`:57`).
5. **C-13 verdict:** the numeric inputs are single-consumer scenario literals, so inline is
   compliant.

**Verification**:
```bash
cd services/xstockstrat-indicators && uv sync --extra dev && .venv/bin/python -m pytest tests/test_indicators_engine.py -v && .venv/bin/python -m pytest --cov=app --cov-fail-under=50 && ruff check . && ruff format --check .
```
RED proof: before Step 5, the description asserts fail. The value asserts pass both before and after;
they guard that the numbers are unchanged.

---

### Step 7 — service: D-18 Option A — mirror the honest descriptions in the UI strategy catalog (C-10)

**Status**: `done`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/lib/strategyCatalog.ts` — modify

**Reviewers**: `xstockstrat-ui` owner — trading UI correctness, analytics display accuracy, Connect-RPC call safety

**Codebase Evidence**:
- `export const BUILTIN_INDICATORS: BuiltinIndicator[] = [` is at `strategyCatalog.ts:54`.
- The ATR entry is `name: 'ATR'` at `:98`, with `description: 'Average True Range'` at `:99`.
- The VWAP entry is `name: 'VWAP'` at `:103`, with `description: 'Volume Weighted Average Price'`
  at `:104`.
- The consumers are `SymbolScreening.tsx`, `ComponentEditor.tsx`, `StrategyWizard.tsx`,
  `RuleEditor.tsx`, `app/insights/screener/page.tsx`, `ruleSummary.ts`, `screenCriteria.ts` and
  `src/lib/screenPresets.test.ts`. They are found by `grep -rln strategyCatalog src`, and none of
  them needs a change: `screenPresets.test.ts` imports `BUILTIN_INDICATORS` but reads only `.name`
  (`:7`) and asserts no description string.
- A repo-wide grep finds no test or spec that asserts the old strings.

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. Replace `:99` with `description: "ATR (close-to-close approximation): rolling mean of |close change| over period; not Wilder's true range",`.
   It must be byte-identical to Step 5's string. Use double quotes, or escape the apostrophe, to
   follow the file's quote style under lint.
2. Replace `:104` with `description: 'VWAP (running mean approximation): cumulative mean of closes; no volume weighting',`.
3. Do not change `name`, `params`, `outputs` or any other entry. C-17 does not apply: this is a text
   change, with no new UI, color or component.

**Verification**:
```bash
grep -c "Average True Range\|Volume Weighted Average Price" services/xstockstrat-ui/src/lib/strategyCatalog.ts   # expect 0
cd services/xstockstrat-ui && pnpm run lint
```

---

### Step 8 — test: UI catalog carries no misleading ATR/VWAP names (vitest)

**Status**: `done`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/lib/strategyCatalog.test.ts` — create

**Reviewers**: `xstockstrat-ui` owner — trading UI correctness, analytics display accuracy, Connect-RPC call safety

**Codebase Evidence**:
- Vitest is configured with `include: ['src/**/*.test.ts']` (`services/xstockstrat-ui/vitest.config.ts:20`)
  and coverage `include: ['src/lib/**']` (`:25`).
- The scripts are `"test:unit": "vitest run"` and `"test:coverage": "vitest run --coverage"`
  (`package.json:17`, `:19`).
- The pattern precedent is `src/lib/fundamentalMetrics.test.ts:1-2`:
  `import { describe, it, expect } from 'vitest';` plus a relative import of the module under test.
- `strategyCatalog.test.ts` does not exist yet (`ls` confirmed). `BUILTIN_INDICATORS` is exported at
  `strategyCatalog.ts:54`.

**TDD**: `red-green required`

**Covers**: `AC-4, AC-5` (UI catalog surface of the same description rule)

**Instructions**:
1. Create `src/lib/strategyCatalog.test.ts`. It imports `BUILTIN_INDICATORS` from `./strategyCatalog`.
2. Its assertions are the ones design.md makes mandatory:
   - no entry's `description` contains `'Average True Range'` or `'Volume Weighted Average Price'`;
   - the entries named `'ATR'` and `'VWAP'` still exist, so key stability holds.
3. **C-12 verdict:** the test uses no mocked domain objects. It reads the real static catalog, so no
   `e2e/fixtures` import or `INVENTORY.md` row is needed.

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm exec vitest run src/lib/strategyCatalog.test.ts && pnpm run test:coverage && pnpm run lint
```
Coverage threshold: `pnpm run test:coverage` (`package.json:19`) enforces the 40% platform floor on
`src/lib/**` (lines, functions, statements) through `vitest.config.ts:29-33`, and fails below it.
RED proof: before Step 7, the misleading-name assertion fails.

**E2E (Playwright):** no Playwright step is added. Steps 7–8 change static catalog text only, with no new
route, component or interaction, and no `e2e/` spec references the old strings (grep of
`services/xstockstrat-ui/e2e`). This vitest covers the change; the existing E2E suite applies unchanged.

---

### Step 9 — docs: indicators sandbox failure rule, ATR/VWAP approximation note, Wilder-ATR divergence

**Status**: `done`
**Service**: `xstockstrat-indicators` (docs) + `docs/runbooks/`
**Files**:
- `services/xstockstrat-indicators/CLAUDE.md` — modify
- `docs/runbooks/indicator-builder.md` — modify
- `services/xstockstrat-indicators/docs/context-constitution-findings.md` — modify

**Reviewers**: none

**Codebase Evidence**:
- Indicators `CLAUDE.md`:
  - `## Role` is at `:7`, and item 1 lists `SMA, EMA, RSI, MACD, BB, ATR, VWAP, STOCH` (`:11`);
  - `## Sandbox Security Model` is at `:124-158`;
  - `## Declared Formula Outputs` is at `:181`. It is the `RUNTIME_ERROR` failure precedent.
- `docs/runbooks/indicator-builder.md`:
  - `## Built-in Indicators` is at `:9`, with the table rows `| \`ATR\` | \`period\` |` at `:20` and
    `| \`VWAP\` |` at `:21`;
  - `### Formula Interface Contract` is at `:72`, and `:81` reads "result: must be set before the
    formula ends";
  - `### Sandbox Constraints` is at `:148`.
- The findings doc's sections are `## Documentation that lies` (`:6`), `## Open questions` (`:18`),
  `## Documentation that lies — additions (2026-10-14)` (`:30`) and `## Filed as defect reports (2026-10-19)` (`:37`).
- Trading's true Wilder ATR is `func wilderATR(bars []*marketdatav1.Bar, period int)` at
  `services/xstockstrat-trading/internal/service/trading.go:3170-3198`, called as
  `wilderATR(recentBars, 14)` at `:3233`.

**TDD**: `N/A (docs)`

**Covers**: —

**Instructions**:
1. **Indicators `CLAUDE.md`.**
   - Under `## Sandbox Security Model` (or next to `## Declared Formula Outputs`), add the rule: a run
     that exits 0 with no `__OUTPUT__:` line, or whose last marker line does not parse, fails with
     `RUNTIME_ERROR` ("formula produced no output" / "formula output could not be parsed").
   - Add that a non-zero exit with empty stderr gets "formula exited with code N before producing
     output".
   - Add that the marker is printed on its own line, and that printing a valid marker and then
     calling `SystemExit(0)` is an accepted author-controlled forgery, not an isolation breach.
   - Under `## Role` item 1, note that `ATR` and `VWAP` are close-only approximations (the
     close-to-close mean, the running mean), not Wilder ATR or volume-weighted VWAP.
2. **`docs/runbooks/indicator-builder.md`.** Add the same approximation note to the `ATR`/`VWAP` rows
   (`:20-21`) or directly under the table. Under `### Sandbox Constraints` (`:148`), add the
   no-output failure rule.
3. **Findings doc.** Add a row recording that "ATR" means two numbers on the platform: the indicators
   built-in close-to-close approximation, and trading's Wilder ATR(14) (`trading.go:3170-3198`).
   Reference feature 268.
4. **Teardown (root `CLAUDE.md` § Teardown).** This step changes context files, so run
   `/context-forge:context-constitution refresh` scoped to `services/xstockstrat-indicators/`. If the
   plugin is unavailable, re-read each touched file against the code by hand and record both facts in
   the PR body.
5. **PR body notes (Open Risks).** List the D-10 visible behavior change (formulas that silently
   produced nothing now fail) and the one extra blank line before the marker in raw stdout.

**Verification**:
```bash
grep -n "produced no output\|could not be parsed" services/xstockstrat-indicators/CLAUDE.md docs/runbooks/indicator-builder.md
grep -n "close-to-close\|running mean" services/xstockstrat-indicators/CLAUDE.md docs/runbooks/indicator-builder.md
grep -n "wilderATR\|Wilder" services/xstockstrat-indicators/docs/context-constitution-findings.md
```

---

### Step 10 — docs: file the "never assigns result" silent-success defect report

**Status**: `pending`
**Service**: `docs/reports/`
**Files**:
- `docs/reports/2026-10-22-indicators-missing-result-silent-success-defect.md` — create
- `docs/reports/2026-10-22-indicators-missing-result-silent-success-defect.status` — create

**Reviewers**: none

**Codebase Evidence**:
- The wrapper defaults a missing `result` to `{}`: `_output = _formula_globals.get('result', {{}})`
  at `sandbox.py:311`. That run still prints a parseable marker, so it succeeds with `{}` even after
  Step 3.
- The report format precedent is `docs/reports/2026-10-21-indicators-formula-correctness-defect.md:1-9`
  (the `**Recorded**`, `**Severity**`, `**Impact type**`, `**Environment**`, `**Affected service(s)**`,
  `**Config-only fix possible**` and `**Source**` header).
- The sidecar precedent is `docs/reports/2026-10-21-analysis-zero-conviction-read-as-neutral-defect.status`,
  whose content is the single line `open`. The format is in
  `.claude/skills/sdd-qa/reference/defect-filing.md` (per `docs/CLAUDE.md` § reports).

**TDD**: `N/A (docs)`

**Covers**: —

**Instructions**:
1. Create the report, following the header shape of the 2026-10-21 precedent and `defect-filing.md`.
   - Observed: a formula that never assigns `result` returns `success=true, output={}` (`sandbox.py:311`).
   - Expected: undecided; triage decides.
   - Source: feature 268 design.md § Open Risks.
   - Severity: `SEV-2`, provisional. `/sdd-triage` confirms or re-rates it.
2. Create the `.status` sidecar with the single line `open`.
3. Do not triage it here. `/sdd-triage --from-report` routes it later.

**Verification**:
```bash
ls docs/reports/2026-10-22-indicators-missing-result-silent-success-defect.md docs/reports/2026-10-22-indicators-missing-result-silent-success-defect.status
cat docs/reports/2026-10-22-indicators-missing-result-silent-success-defect.status   # expect: open
```

---

## Deviation Log

_Populated by /sdd-execute as implementation proceeds._

### Step 4 — RED proof for the marker-framing guard (2026-10-29)
- **Spec said**: Step 4's RED proof calls AC-3 and the marker-framing guard "pass both before and after".
- **Actual**: only AC-3 passes before Step 3. The framing guard fails pre-Step-3 (`assert {} == {'x': 1}`),
  because the trailing `print("x", end="")` glued the marker mid-line. Step 3 had already landed, so RED was
  captured by temporarily checking out the pre-Step-3 `sandbox.py` (`85ef0ac8~1`) and restoring it before GREEN.
- **Disposition**: test unchanged. The guard is stronger than specced (it is also a RED assertion for the
  framing fix). No scope change.

### Step 5 — verification grep 1 matches the formatter's layout (2026-10-29)
- **Spec said**: `grep -n '"ATR": {"description"\|"VWAP": {"description"'` shows the two edited entries.
- **Actual**: both new descriptions exceed the 100-char `line-length`, so each entry is written as a
  multi-line dict with a parenthesized string (the `ruff format` layout, no `noqa`). That grep returns
  nothing. The equivalent check `grep -n '"ATR": {\|"VWAP": {'` hits `:144` and `:151`, and the runtime
  values equal the specced strings exactly (checked via `INDICATOR_REGISTRY[...]["description"]`). Grep 2
  returns `0` as specced.
- **Disposition**: verification command form only; strings, keys, `required`, dispatch and math as specced.
  Step 7 must match the runtime strings, not a one-line source form.

### Step 7 — catalog entries are prettier-wrapped (2026-10-29)
- **Spec said**: replace `:99` / `:104` with a one-line `description: ...,` each.
- **Actual**: both new strings exceed prettier's print width, so `prettier --write` puts each value on its own
  line after `description:` (`:99-100`, `:105-106`). The ATR value uses double quotes (apostrophe). Runtime values
  are byte-identical to the engine's `INDICATOR_REGISTRY` strings (asserted with `toBe` in a scratch vitest).
- **Disposition**: source layout only; strings, `name`, `params` and other entries as specced.

### Step 9 — `wilderATR` line drift; context-forge plugin unavailable (2026-10-29)
- **Spec said**: `wilderATR` at `trading.go:3170-3198`, called at `:3233`; teardown via `/context-forge:context-constitution refresh`.
- **Actual**: the definition is at `:3169-3198` and the call at `:3232` (one-line drift); the findings row cites the
  symbol anchor `trading.go#wilderATR` plus the current lines. The `context-constitution` skill is not available in
  this session, so the teardown was done by hand: each touched doc was re-read against `sandbox.py` (marker loop and
  `_fail` messages `:406-428`, wrapper print `:312`), `indicators_engine.py` (`INDICATOR_REGISTRY` ATR/VWAP `:144-156`)
  and `trading.go#wilderATR`; no other drift found in the touched sections.
- **Disposition**: anchors only; doc content as specced. The PR body must record both facts (plugin unavailable +
  manual reconciliation) and the Open Risks of Instruction 5.
