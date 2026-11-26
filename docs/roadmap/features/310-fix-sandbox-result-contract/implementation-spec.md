# Implementation Spec: fix-sandbox-result-contract

**Status**: `pending`
**Created**: 2026-11-20
**Feature**: `docs/roadmap/features/310-fix-sandbox-result-contract/feature.md`
**Total Steps**: 8
**Feature Branch**: `feature/fix-sandbox-result-contract`

**Tree**: `origin/feature/fix-sandbox-result-contract@8d01d15a`. Every `path:line` below was read at
`@90a2fd0e`; `90a2fd0e..8d01d15a` changes only this feature directory (`git diff --stat` outside it
is empty, re-checked by `/sdd-review impl-spec` 2026-11-20), so the anchors hold at `@8d01d15a`.
The `sandbox.py` lines match recon.md (`origin/main-dev@c4fd48b0`). design.md's
"(debate.md)" citations were re-grepped here (F-04): `sandbox_probe.py:309-320`,
`sandbox.py:670-679`, `FormulaRunResult.tsx:92-98` all hold.

---

## Execution Summary

The fix follows design.md § Chosen Approach (D-1..D-14) and the operator decisions O-1, O-3, O-4.
Steps 1-2 land the whole result contract in `app/services/sandbox.py` as one service step (the
wrapper's `{nonce}` template field and the parent's `.format(nonce=…)` cannot be committed apart)
with its RED tests. Steps 3-4 add the boot self-test that owns the runtime fact. Steps 5-6 carry
the agent `test_formula` surface, Step 7 pins the `/insights` surface, and Step 8 updates the docs.
There is no proto step (D-8, R-8), no migration and no config key (F-01, F-07).

### Scenario Coverage (C-15)

| Scenario | Covered by |
|---|---|
| `@AC-1` guard-message exception is a runtime error | Step 2 |
| `@AC-2` memory is a real per-run peak (two-run form) | Step 2 (sandbox level and servicer level) |
| `@AC-3` missing `result` fails naming `result` | Step 2 (sandbox and servicer), Step 7 (`/insights` rendering) |
| `@AC-4` explicit `result = {}` succeeds | Step 2 |

### Consumer Surfaces (C-14)

- **Agent `test_formula`**: Steps 5-6 (docstring gains `memory_used_bytes`; the field is already
  returned).
- **UI `/insights`**: no component change (design.md § 5). Step 7 is a test-only step that pins the
  missing-`result` failure reaching the user. **Operator sign-off O-5 is still not recorded** — see
  Step Dependencies.

### Discovery results this spec relies on

- **Break radius, measured not inferred.** The full Step 1 + Step 3 change was applied to the
  working tree temporarily and the unchanged suite was run through the service venv: `571 passed`
  before the change, `571 passed` with it (then reverted; nothing committed). So no existing indicators test
  relies on the implicit `{}`, on the deleted stderr substring branch (`sandbox.py:809`; no test
  contains "is not allowed in sandbox"), or on `memory_used_bytes == 0`, and
  neither service step needs a `**Lands with**` unit.
- **Implicit-`{}` enumeration (design build step 1).** In-repo: no test source relies on it (above);
  the 9 template seed rows assign `result` (design.md Open Risks); the seeded system formula assigns
  it (`app/formulas/fundamentals_value_quality.py:186`); the five UI starter templates assign it
  (`services/xstockstrat-ui/src/components/insights/formulaReference.ts:209,227,256,276,309`); the
  UI e2e suite never runs a sandbox (`ExecuteFormula` is stubbed with `page.route`,
  `e2e/insights/formulas.spec.ts:231`). **Not found in code**: user-saved rows in dev/prod
  `indicators.formulas` — see Step Dependencies.
- **Prototype measurements on this kernel** (advisory; CI is the owner): run A `result = {}` with
  `allowed_imports=["numpy"]` reported 50,663,424 bytes; run B (the @AC-2 source) exceeded it by
  80,027,648 bytes (threshold 41,943,040). With `allowed_imports=[]`, `result = {}` reported about
  15.7 MB and took about 50 ms.

## Step Dependencies

- Step 2 [test] covers Step 1 [service]. Step 4 [test] covers Step 3 [service]. Step 6 [test] covers
  Step 5 [service].
- Step 3 requires Step 1: the boot self-test reads `memory_used_bytes`, which is 0 on every path
  until Step 1.
- Step 8 requires Steps 1, 3 and 5: it documents their behaviour and log lines.
- No atomic unit is declared: each step passes its own `**Verification**` on a tree holding only the
  steps before it (§C; measured, see Execution Summary). Steps 1 and 3 were verified against the
  unchanged suite; Steps 2, 4 and 6 only add tests for symbols that already exist by then.
- **Operator gate O-5 (C-14, open).** design.md § 5 plans `/insights` unchanged and context.md
  records no operator decision. `/sdd-execute` must obtain and record one of: "surface unchanged,
  justified" or a named follow-up feature for a memory display, **before Step 7 runs**. Step 7 does
  not presume the answer: it adds no memory display and tests only the failure rendering.
- **Operator gate OQ1 (product spec).** Before the integration PR, the operator checks dev and prod
  `indicators.formulas` for saved formulas that never assign `result`; these will start failing with
  "formula did not assign result". The result is recorded in context.md. This is not an executable
  step (the rows cannot be read from code).
- **Promotion (design build step 7).** No spec step: `/sdd-execute` promotes `@AC-1..4` into
  `services/xstockstrat-indicators/acceptance/` with the `@feature-310` tag at integration
  (`.claude/skills/sdd-execute/SKILL.md`; recon.md "Tag collision").
- **DO runtime confirmation (D-14).** The integration PR author records the first post-deploy
  `sandbox memory self-test` log line (or the ERROR) in context.md.
- **Report sidecars are not edited.** design.md § 7 says the sidecars are "updated", but the sidecar
  contract (`.claude/skills/sdd-qa/reference/defect-filing.md:26-48`) allows only a status token and
  a `ref:` line, and says a `triaged` report whose feature launches "counts as resolved — nothing
  re-stamps it". All three sidecars already read `triaged` / `ref: feature:310-fix-sandbox-result-contract`.
  The D-14 conditional wording therefore lives in the findings row (Step 8). `/sdd-review impl-spec`
  (2026-11-20) found the reading reasonable; it narrows design.md § 7 and is logged in the Deviation
  Log below. Operator confirmation is still open (context.md Open Threads).
- **Known pre-existing flake, not this feature's.** On this kernel
  `tests/test_sandbox_watchdog.py::test_ac8_fork_bomb_is_not_a_success_the_service_recovers_and_nothing_is_unobservable`
  (`:432`) fails about 1 run in 4 when run **alone on the unmodified tree** (7 of 25), on the
  `CANNOT_OBSERVE_MSG` assertion. Full-suite runs passed 4 of 4. An executor that sees it must not
  attribute it to a step here. The full-suite `**Verification**` of Steps 1, 2 and 3 can therefore
  go red on this test alone; the executor records any such run in context.md (P-03) and does not
  hide it. No defect report is filed yet (context.md Open Threads).
- **Step 1 review load.** Step 1 edits one file but carries the wrapper template, the parent parser,
  the classifier, the nonce and the memory read. It is not split because `{nonce}` and
  `.format(nonce=…)` cannot be committed apart. The `571 passed` prototype figure is advisory and was
  not re-run by `/sdd-review impl-spec`; Step 1's own `**Verification**` is the owner.
- **Rebase-only file overlaps** (`/sdd-review impl-spec` overlap scan, 2026-11-20; no migration,
  proto-field or config-key collision). `services/xstockstrat-agent/app/tools.py` and
  `docs/runbooks/mcp-tools.md` (Step 5) are also edited by `345-authelia-sso`
  (`implementation-ready` on `origin/main-dev`; its spec `:985`, `:2319`), and `mcp-tools.md` by
  `360-fix-mcp-tools-page` (`code-completed` on `origin/main-dev`; its spec `:958`). Step 5's
  executor re-greps the `tools.py:1687-1689` and `mcp-tools.md:1060-1062` anchors after any rebase.
  `300-fix-sandbox-memory-cap` (shares `sandbox.py`, `tests/test_sandbox.py`,
  `tests/test_sandbox_isolation.py`) is `launched`, so it is already in this tree. The batch peer
  features' file lists were not verifiable in the scan.
- Run every indicators test command through the service venv (ledger fails 2026-09-28), as written
  in each `**Verification**`.

---

### Step 1 — service: nonce status line, classifier, missing-result failure and measured memory in the sandbox

**Status**: `done`
**Service**: `xstockstrat-indicators`
**Files**:
- `services/xstockstrat-indicators/app/services/sandbox.py` — modify

**Reviewers**: `xstockstrat-indicators` owner — formula sandboxing, no side-effects from formula execution, timeout enforcement

**Codebase Evidence**:
- Imports: `sandbox.py:33-44` (`json`, `logging`, `math`, `os`, `re`, `signal`, …). `secrets` is
  **not** imported (`grep -n "^import secrets" app/services/sandbox.py` → no match).
- `_SECCOMP_ALLOW` (`:107`) already allows `read`, `lseek` and `write`; no allowlist change is
  needed for the `_ms` read.
- `SandboxResult` dataclass `:531-540`; `memory_used_bytes: int` at `:538`. Unchanged.
- `_MEMORY_EXHAUSTED_MARKERS` `:544`.
- `_SANDBOX_WRAPPER = textwrap.dedent("""` `:548`, a `.format()` template (braces doubled, `"\\n"`
  written with two backslashes). `_real_import = __import__` `:557`; `_safe_import` `:559-563` with
  `raise ImportError(f"Import '{{name}}' is not allowed in sandbox")` at `:562`.
- `{drop_uid}` `:610`; `{vmdata_probe}` `:620`; `if {memory_bytes} > 0:` `:621`; `_flt.load()`
  `:642`; `# ── lockdown complete` `:643`.
- `exec({source!r}, _formula_globals)` `:647`; `_output = _formula_globals.get('result', {{}})`
  `:651`; the marker `print("\\n__OUTPUT__:" + json.dumps(…))` `:652`.
- `_killpg` `:656`; `execute_formula` `:670`, defaults at `:671-679`; `_SANDBOX_WRAPPER.format(`
  `:701-715`; `oom_before = _oom_kill_count()` `:719`.
- Return paths: watchdog kill `:764-773` (`stdout=out or ""` `:767`, `memory_used_bytes=0` `:770`);
  timeout `:774-783` (`:780`); `elapsed_ms` `:785`; `_fail` closure `:787-797` (`:794`);
  `if killed_for_memory: return _fail(_MEMORY_ERROR, …)` `:799-800`; marker scan `:802-805`;
  classification `:807-819` (`:809` guard-message test, `:811` markers, `:813` counter evidence);
  feature-268 checks `:821-826`; success return `:828-837` (`:834`).
- Existing callers of `execute_formula`: only `app/handlers/servicer.py:339`, by keyword. The
  signature does not change, so no caller edit is needed.

**TDD**: `red-green required`

**Covers**: —

**Instructions**:

All edits are in `app/services/sandbox.py`. Do not change `SandboxResult`, `_SECCOMP_ALLOW`,
`_MEMORY_EXHAUSTED_MARKERS`, the servicer, telemetry or the proto.

1. Add `import secrets` to the import block (alphabetical, between `import re` and `import signal`).

2. **Wrapper — guard exception.** After `_real_import = __import__` (`:557`) add:

   ```python
   class _ImportBlocked(ImportError):
       pass
   ```

   and change `:562` to raise it, message unchanged:
   `raise _ImportBlocked(f"Import '{{name}}' is not allowed in sandbox")`.

3. **Wrapper — status descriptor.** Directly after the `{vmdata_probe}` line (`:620`), before
   `if {memory_bytes} > 0:`, add:

   ```python
   _ms = os.open('/proc/self/status', os.O_RDONLY)
   ```

   It is opened after the UID drop and the VmData probe and before `_flt.load()`. It is **not**
   added to `pass_fds`.

4. **Wrapper — `_status`.** Directly after the `# ── lockdown complete` line (`:643`) add, as
   template text (so `"\\n"` and `{nonce}` appear exactly like this in the source file):

   ```python
   def _status(_kind):
       try:
           _hwm = 0
           try:
               os.lseek(_ms, 0, os.SEEK_SET)
               for _l in os.read(_ms, 8192).decode().splitlines():
                   if _l.startswith('VmHWM:'):
                       _hwm = int(_l.split()[1]) * 1024
                       break
           except BaseException:
               _hwm = 0
           print("\\n__STATUS__:{nonce}:" + _kind + ":" + str(_hwm), flush=True)
       except BaseException:
           pass
   ```

   It is total (D-6): it never raises and never replaces an in-flight exception. It uses `print`,
   not `os.write` (`tests/test_sandbox_watchdog.py:179` asserts `"os.write(" not in` the rendered
   wrapper when no memory limit is set). There is no VmRSS fallback (R-7) and no `getrusage` (R-1).

5. **Wrapper — exec and output.** Replace `:647-652` (the `exec` line, the two banner comments
   around it may stay, the `# Output must be assigned…` comment, `_output = …get('result', {{}})`
   and the marker `print`) with, as template text:

   ```python
   try:
       exec({source!r}, _formula_globals)
       if 'result' in _formula_globals:
           _output = _formula_globals['result']
           print("\\n__OUTPUT__:" + json.dumps(_output if isinstance(_output, dict) else {{"value": _output}}))
           _status('ok')
       else:
           _status('no_result')
   except _ImportBlocked:
       _status('import_blocked')
       raise
   except MemoryError:
       _status('memory_exceeded')
       raise
   except BaseException:
       _status('raised')
       raise
   ```

   Every handler re-raises with a bare `raise`, so exit codes, tracebacks on stderr and
   `SystemExit` behaviour are unchanged. Exactly one status line is emitted per run that reaches
   this block.

6. **Parent — parser.** Before `def _killpg` (`:656`) add:

   ```python
   _STATUS_LINE = re.compile(r"__STATUS__:([0-9a-f]{32}):([a-z_]+):([0-9]+)")


   def _split_status(stdout: str, nonce: str) -> tuple[str, str | None, int]:
       lines = stdout.splitlines(keepends=True)
       for i in range(len(lines) - 1, -1, -1):
           m = _STATUS_LINE.fullmatch(lines[i].rstrip("\n"))
           if m is None or m.group(1) != nonce:
               continue
           del lines[i]
           if i > 0 and lines[i - 1].endswith("\n"):
               lines[i - 1] = lines[i - 1][:-1]
           return "".join(lines), m.group(2), int(m.group(3))
       return stdout, None, 0
   ```

   It returns `(stdout without the status line and without the one newline the wrapper injected
   before it, kind or None, memory bytes)` (D-5, D-11). A line carrying any other nonce is left in
   stdout and ignored. Add a comment of at most two lines only if it states the constraint that the
   nonce must never reach `SandboxResult.stdout`.

7. **Parent — nonce.** In `execute_formula`, immediately before the `try:` that holds
   `wrapped = _SANDBOX_WRAPPER.format(` (`:700-701`), add `nonce = secrets.token_hex(16)` and pass
   `nonce=nonce` as a `.format` keyword.

8. **Parent — watchdog-kill return** (`:764-773`): change `stdout=out or ""` to
   `stdout=_split_status(out or "", nonce)[0]`. `memory_used_bytes=0` stays (O-1: 0 on a watchdog
   kill). The timeout return (`:774-783`) is untouched (`stdout=""`, `memory_used_bytes=0`).

9. **Parent — after `communicate`.** Directly after `elapsed_ms = …` (`:785`), before `def _fail`,
   add:

   ```python
   stdout, status, memory_used = _split_status(stdout, nonce)
   ```

   In `_fail` (`:794`) and in the success return (`:834`) change `memory_used_bytes=0` to
   `memory_used_bytes=memory_used`. The marker scan (`:802-805`) now runs on the stripped `stdout`
   and is otherwise unchanged.

10. **Parent — classifier.** Replace `:808-814` (from `exit_reason = "runtime_error"` through the
    `-signal.SIGKILL` branch) with, verbatim (D-7):

    ```python
    if status in ("import_blocked", "memory_exceeded"):
        exit_reason = status
    elif proc.returncode == -signal.SIGKILL and _oom_kill_rose(oom_before):
        exit_reason = "memory_exceeded"
    elif status is not None:
        exit_reason = "runtime_error"
    elif any(m in stderr for m in _MEMORY_EXHAUSTED_MARKERS):
        exit_reason = "memory_exceeded"
    else:
        exit_reason = "runtime_error"
    ```

    The `"is not allowed in sandbox" in stderr` test is deleted (O-3). The `return _fail(…)` that
    follows (`:815-819`), including the `formula exited with code … before producing output`
    fallback text, is unchanged.

11. **Parent — missing result.** Directly before `if marker is None:` (`:821`) add:

    ```python
    if status == "no_result":
        return _fail("formula did not assign result", "runtime_error")
    ```

    The two feature-268 checks (`:821-826`) are unchanged and still own "formula produced no output"
    and "formula output could not be parsed".

**Verification**:

```bash
cd services/xstockstrat-indicators && uv sync --frozen --extra dev \
  && uv run --no-sync pytest --cov=app --cov-fail-under=50 \
  && ruff check . && ruff format --check .
grep -c "memory_used_bytes=0" app/services/sandbox.py          # expect 2 (watchdog kill, timeout)
grep -n '"is not allowed in sandbox" in stderr' app/services/sandbox.py   # expect no match
grep -n "pass_fds=(w,) if w >= 0 else ()" app/services/sandbox.py         # expect 1 match (unchanged)
```

The existing suite stays green (measured: 571 passed with this change). The new behaviour is proven
by Step 2.

---

### Step 2 — test: sandbox result-contract regression tests (@AC-1..4)

**Status**: `done`
**Service**: `xstockstrat-indicators`
**Files**:
- `services/xstockstrat-indicators/tests/test_sandbox.py` — modify
- `services/xstockstrat-indicators/tests/test_sandbox_isolation.py` — modify
- `services/xstockstrat-indicators/tests/test_sandbox_watchdog.py` — modify
- `services/xstockstrat-indicators/tests/test_formulas.py` — modify

**Reviewers**: `xstockstrat-indicators` owner — formula sandboxing, no side-effects from formula execution

**Codebase Evidence**:
- Real-subprocess harness: `tests/test_sandbox.py:12` imports `execute_formula`; pattern
  `execute_formula(source=…, input_data={}, allowed_imports=[…])` in
  `class TestSandboxNoOutputFails` (`:232-287`); `test_blocked_import` at `:101`.
- Fake child: `_fake_popen(captured, returncode=0, stdout="__OUTPUT__:{}", stderr="")` at
  `tests/test_sandbox_isolation.py:65-80`; `class TestExitReasonClassification` at `:224` with the
  feature-228 OpenBLAS fake (`:225-239`), which emits no status line; `_run` helper there.
- SIGKILL fake: `_killed_proc(events_file, bump)` at `tests/test_sandbox_watchdog.py:281-294`
  returns `("", "")` with `returncode = -9`; its consumer `test_ac5_…` at `:297-318` sets
  `sandbox._OOM_EVENTS_PATH` to a temp file.
- Servicer harness: `class TestExecuteFormulaInlineParameters` (`tests/test_formulas.py:477`) with
  `self._cfg()` and `test_no_output_run_returns_runtime_error` (`:543-554`), which builds
  `indicators_pb2.ExecuteFormulaRequest(formula_source=…)` and awaits
  `servicer.ExecuteFormula(req, _ctx([("x-user-id", "user-1")]))`.
- Verified on the prototype: a `dict` subclass whose `items()` raises `MemoryError` makes
  `json.dumps` raise inside the wrapper's `try` and yields `memory_exceeded`.

**TDD**: `red-green required`

**Covers**: `AC-1, AC-2, AC-3, AC-4`

**Instructions**:

Write these tests so each fails on the pre-Step-1 tree for a behavioural reason (wrong
`exit_reason`, `memory_used_bytes == 0`, `success is True`, or a status line in stdout). The fake
tests reach `sandbox.secrets`, which exists only after Step 1; that is why this step follows Step 1.

**C-13 verdict**: every formula source and the pinned nonce below has exactly one consumer, so they
stay inline. No `SandboxResult(...)` literal is added. `_killed_proc` gains a parameter instead of a
second fake.

1. `tests/test_sandbox.py` — add `class TestSandboxResultContract` after
   `TestSandboxNoOutputFails` (before `class TestStartupGraceConfigWiring`, `:289`). All tests call
   `execute_formula` for real:
   - `test_ac1_guard_message_in_a_formula_exception_is_runtime_error` (@AC-1): source
     `raise ValueError("is not allowed in sandbox")`, `allowed_imports=[]` → `success is False`,
     `exit_reason == "runtime_error"`.
   - `test_memory_marker_text_in_a_formula_exception_is_runtime_error`: source
     `raise ValueError("MemoryError")` → `exit_reason == "runtime_error"` (O-3: the markers are only
     the no-status fallback).
   - `test_blocked_import_reports_a_measured_figure`: source `import socket\nresult = 1` →
     `exit_reason == "import_blocked"` and `memory_used_bytes > 0`.
   - `test_memory_error_while_serialising_the_output_is_memory_exceeded`: source
     `class D(dict):\n    def items(self):\n        raise MemoryError()\nresult = D(a=1)\n` →
     `exit_reason == "memory_exceeded"`.
   - `test_ac2_memory_is_a_real_per_run_peak` (@AC-2): skip with `pytest.skip` only when the test
     process's own `/proc/self/status` has no `VmHWM:` line (the scenario's `Given`). Run A:
     `result = {}`. Run B:
     `import numpy\na = numpy.ones(10_000_000)\nresult = {"s": float(a[0])}`. Both with
     `allowed_imports=["numpy"]`, so the import baseline is common to both runs. Assert both
     succeed, `a.memory_used_bytes > 0` and
     `b.memory_used_bytes - a.memory_used_bytes >= 41943040` (R-5, R-9).
   - `test_ac3_missing_result_fails_naming_result` (@AC-3): source `x = 1`, `input_data={}` →
     `success is False`, `error == "formula did not assign result"`,
     `exit_reason == "runtime_error"`, `output == {}`.
   - `test_ac4_explicit_empty_result_succeeds` (@AC-4): source `result = {}` → `success is True`,
     `output == {}`, `error == ""`.
   - `test_the_status_line_never_reaches_stdout`, parametrized over
     (`print('abc', end='')\nraise RuntimeError('x')`, `'abc'`),
     (`print('abc')\nresult = {'a': 1}`, `'abc\n\n__OUTPUT__:{"a": 1}\n'`) and (`x = 1`, `''`):
     assert `res.stdout` equals the expected string exactly and `"__STATUS__" not in res.stdout`
     (D-5, D-11).
   - `test_a_status_line_with_another_nonce_is_ignored`: source
     `print('__STATUS__:' + '0' * 32 + ':import_blocked:5')\nraise ValueError('x')` →
     `exit_reason == "runtime_error"` and the forged line is still present in `res.stdout`.

2. `tests/test_sandbox_isolation.py` — in `TestExitReasonClassification` (`:224`) add
   `test_without_a_status_line_a_stderr_memory_marker_is_memory_exceeded`: monkeypatch
   `app.services.sandbox.subprocess.Popen` with
   `_fake_popen({}, returncode=1, stdout="", stderr="MemoryError\n")` → `success is False`,
   `exit_reason == "memory_exceeded"`, `memory_used_bytes == 0`. This is the design's "`_status`
   failed to print under memory pressure" case (classifier step 4).

3. `tests/test_sandbox_watchdog.py` — give `_killed_proc` (`:281`) a third parameter `stdout=""`
   and return `(stdout, "")`. After `test_ac5_…` (`:318`) add
   `test_oom_counter_evidence_outranks_a_non_specific_status`: pin the nonce with
   `monkeypatch.setattr(sandbox.secrets, "token_hex", lambda _n: "ab" * 16)`, point
   `sandbox._OOM_EVENTS_PATH` at a temp `memory.events` holding `oom 0\noom_kill 1\n`, and use
   `_killed_proc(events, 1, stdout="\n__STATUS__:" + "ab" * 16 + ":raised:1048576\n")`. Assert
   `exit_reason == "memory_exceeded"` (R-6, 300@AC-5), `memory_used_bytes == 1048576` and
   `stdout == ""`.

4. `tests/test_formulas.py` — in `TestExecuteFormulaInlineParameters`, after
   `test_no_output_run_returns_runtime_error` (`:554`), add two tests in the same shape:
   - `test_missing_result_returns_runtime_error_naming_result` (@AC-3): `formula_source="x = 1"` →
     `resp.success is False`, `resp.exit_reason == indicators_pb2.SANDBOX_EXIT_REASON_RUNTIME_ERROR`,
     `"result" in resp.error`.
   - `test_memory_used_bytes_is_populated` (@AC-2): `formula_source="result = {}"` →
     `resp.success is True` and `resp.memory_used_bytes > 0`.

**Verification**:

```bash
cd services/xstockstrat-indicators && uv sync --frozen --extra dev \
  && uv run --no-sync pytest --cov=app --cov-fail-under=50 \
  && ruff check . && ruff format --check .
uv run --no-sync pytest -q tests/test_sandbox.py -k "TestSandboxResultContract"   # all pass
grep -n "SandboxResult(" tests/test_sandbox.py tests/test_sandbox_isolation.py tests/test_sandbox_watchdog.py tests/test_formulas.py
# expect only the pre-existing tests/test_sandbox.py:311 fake — no new inline SandboxResult literal (C-13)
```

RED evidence on the pre-Step-1 tree: `test_ac1_…` reports `import_blocked`, `test_ac2_…` and
`test_memory_used_bytes_is_populated` report 0, `test_ac3_…` reports `success is True`.

---

### Step 3 — service: boot self-test for `memory_used_bytes` in the startup probe

**Status**: `done`
**Service**: `xstockstrat-indicators`
**Files**:
- `services/xstockstrat-indicators/app/services/sandbox_probe.py` — modify

**Reviewers**: `xstockstrat-indicators` owner — formula sandboxing, no side-effects from formula execution, timeout enforcement

**Codebase Evidence**:
- `sandbox_probe.py:22-32`: `from app import telemetry` and
  `from app.services.sandbox import (_DROP_UID, _HANDOFF, _VMDATA_PROBE, _child_headroom,
  _parse_handoff, _parse_status, _sandbox_env, _warn_unobservable_once)`. The `sandbox` module
  itself is not imported there.
- `run_startup_probe` at `:309-321`: one outer `try`, an inner `try: result = _probe()`, and the
  failure branch ending in `return` at `:318`, which would skip anything appended after
  `_report(result)`.
- Called once at boot: `app/main.py:46` `await asyncio.to_thread(run_startup_probe)`, right after
  `init_telemetry()` and before the config watcher is created (`:48-50`).
- `execute_formula` (`sandbox.py:670-679`) takes only arguments and has defaults for everything
  after `allowed_imports`; it reads no config.
- Design Open Risk "boot self-test side effects", resolved by reading the code: `execute_formula`
  records no per-run telemetry (`record_sandbox_execution` is called by the servicer,
  `app/handlers/servicer.py:383`). The only shared state a run can touch is the once-latched
  `_warn_unobservable_once` (`sandbox.py:237-240`, reached from `:315` and `:445`) and the
  once-latched `oom_score_adj` warning (`:484`); both are truthful runtime facts that the first user
  run would latch anyway. Measured latency for this call on the prototype: about 50 ms.
- Startup-latency trade-off (accepted): the self-test adds one real sandbox subprocess run to every
  boot, after `init_telemetry()` (`app/main.py:46`). Its failures are caught and logged, never fatal.
- Existing tests monkeypatch `sandbox_probe._PROBE_SCRIPT`, `_PROBE_TIMEOUT_S`, `_child_headroom`
  and `_sample` (`tests/test_sandbox_probe.py:83,113,115,139`) and count `"sandbox memory probe "`
  INFO records (`:58`); the new message must not contain that substring.

**TDD**: `red-green required`

**Covers**: —

**Instructions**:

1. Add `from app.services import sandbox` above the existing `from app.services.sandbox import (`
   block. The self-test must call `sandbox.execute_formula` through the module attribute so a test
   can replace it.

2. Rename the existing `run_startup_probe` body into a private function, unchanged:

   ```python
   def _run_memory_probe() -> None:
       try:
           try:
               result = _probe()
           except Exception as exc:  # noqa: BLE001 - the probe must never stop startup
               log.error("sandbox memory probe failed: %s", exc)
               telemetry.set_sandbox_memory_cap_enforced(0)
               telemetry.set_sandbox_memory_watchdog_observable(0)
               return
           _report(result)
       except Exception:  # noqa: BLE001
           log.exception("sandbox memory probe reporting failed")
   ```

3. Add the self-test and the new entry point (D-12):

   ```python
   _UNMEASURABLE_MSG = "sandbox memory_used_bytes unmeasurable on this runtime"


   def _self_test() -> None:
       res = sandbox.execute_formula("result = {}", {}, [])
       log.info(
           "sandbox memory self-test exit_reason=%s memory_measured=%d",
           res.exit_reason,
           res.memory_used_bytes,
       )
       if res.exit_reason != "success" or res.memory_used_bytes <= 0:
           log.error(_UNMEASURABLE_MSG)


   def run_startup_probe() -> None:
       """Probe the runtime once; any failure is logged and both gauges read 0. Never raises."""
       _run_memory_probe()
       try:
           _self_test()
       except Exception:  # noqa: BLE001 - the self-test must never stop startup
           log.exception(_UNMEASURABLE_MSG)
   ```

   The self-test runs whether or not `_probe()` succeeded. It passes no keyword arguments (the
   function's own defaults; F-07: no new literal, no config key). It sets no gauge (R-12) and adds
   no per-run log (R-11). `app/main.py` is not edited.

**Verification**:

```bash
cd services/xstockstrat-indicators && uv sync --frozen --extra dev \
  && uv run --no-sync pytest --cov=app --cov-fail-under=50 \
  && ruff check . && ruff format --check .
grep -n "run_startup_probe" app/main.py     # expect the unchanged :25 import and :46 call
```

The existing probe tests stay green (measured on the prototype). The new behaviour is proven by
Step 4.

---

### Step 4 — test: boot self-test logs a measured figure and reports an unmeasurable runtime

**Status**: `done`
**Service**: `xstockstrat-indicators`
**Files**:
- `services/xstockstrat-indicators/tests/test_sandbox_probe.py` — modify

**Reviewers**: `xstockstrat-indicators` owner — formula sandboxing, no side-effects from formula execution

**Codebase Evidence**:
- `tests/test_sandbox_probe.py:14-17` imports `telemetry`, `sandbox`, `sandbox_probe`; message
  constants at `:22-26` (`PROBE_FAILED_MSG = "sandbox memory probe failed"`); the
  `_messages(caplog, needle)` helper at `:46-47`; the `caplog.at_level(logging.INFO)` +
  `sandbox_probe.run_startup_probe()` pattern at `:50-52`; the failing-probe stub
  `monkeypatch.setattr(sandbox_probe, "_PROBE_SCRIPT", "raise SystemExit(3)\n")` at `:102-113`.
- `SandboxResult` is a dataclass (`sandbox.py:531`), so `dataclasses.replace` builds a variant
  without a new literal.

**TDD**: `red-green required`

**Covers**: —

**Instructions**:

Add, after the existing tests, using the file's `_messages` helper and `caplog` pattern. Define one
module constant `UNMEASURABLE_MSG = "sandbox memory_used_bytes unmeasurable on this runtime"` beside
the other message constants (`:22-26`) and `SELF_TEST_MSG = "sandbox memory self-test "`.

**C-13 verdict**: no new `SandboxResult(...)` literal. The zero-memory variant is
`dataclasses.replace(real, memory_used_bytes=0)` where `real` is a genuine
`sandbox.execute_formula("result = {}", {}, [])` result captured before the monkeypatch.

- `test_boot_self_test_logs_a_measured_figure`: run `run_startup_probe()`; exactly one INFO record
  contains `SELF_TEST_MSG`; its message contains `exit_reason=success`; the integer after
  `memory_measured=` is greater than 0; no record contains `UNMEASURABLE_MSG`.
- `test_boot_self_test_reports_an_unmeasurable_runtime_once`: monkeypatch
  `sandbox.execute_formula` to return the zero-memory variant; exactly one record contains
  `UNMEASURABLE_MSG` and its level is `logging.ERROR`.
- `test_boot_self_test_reports_a_non_success_run`: monkeypatch `sandbox.execute_formula` to return
  `dataclasses.replace(real, success=False, exit_reason="runtime_error")`; exactly one ERROR record
  contains `UNMEASURABLE_MSG`.
- `test_boot_self_test_that_raises_is_logged_and_never_propagates`: monkeypatch
  `sandbox.execute_formula` to raise `RuntimeError("boom")`; `run_startup_probe()` returns
  normally; exactly one ERROR record contains `UNMEASURABLE_MSG` and has `exc_info`.
- `test_boot_self_test_runs_when_the_memory_probe_fails`: monkeypatch
  `sandbox_probe._PROBE_SCRIPT` to `"raise SystemExit(3)\n"`; one record contains
  `PROBE_FAILED_MSG` **and** one INFO record contains `SELF_TEST_MSG`.

**Verification**:

```bash
cd services/xstockstrat-indicators && uv sync --frozen --extra dev \
  && uv run --no-sync pytest --cov=app --cov-fail-under=50 \
  && ruff check . && ruff format --check .
uv run --no-sync pytest -q tests/test_sandbox_probe.py -k "boot_self_test"   # 5 passed
grep -n "SandboxResult(" tests/test_sandbox_probe.py                         # expect no match (C-13)
```

RED evidence on the pre-Step-3 tree: no record contains `SELF_TEST_MSG`.

---

### Step 5 — service: agent `test_formula` documents `memory_used_bytes`

**Status**: `pending`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/app/tools.py` — modify
- `docs/runbooks/mcp-tools.md` — modify

**Reviewers**: `xstockstrat-agent` owner — MCP tool contract stability (name, parameters, return shape) and `docs/runbooks/mcp-tools.md` parity

**Codebase Evidence**:
- `services/xstockstrat-agent/app/tools.py:1817` `async def test_formula(`; the docstring's return
  list at `:1835-1837`: "Returns the full sandbox result: success, output (…), stdout, stderr,
  error, exit_reason, parameter_errors, execution_ms (int64 as a JSON string)." It does not name
  `memory_used_bytes`.
- The field is already returned: `app/client.py:1199-1201` returns
  `MessageToDict(resp, preserving_proto_field_name=True, always_print_fields_with_no_presence=True)`,
  so `memory_used_bytes` is always present and, being `int64`
  (`packages/proto/indicators/v1/indicators.proto:95`), is rendered as a JSON string.
- Parity mirror: `docs/runbooks/mcp-tools.md:1172-1174` repeats the same return list.
- No new outbound call: the tool body (`:1838-1849`) is unchanged, so header propagation is
  unaffected.
- `test_formula` is not one of the `strat-lab`-coupled tools (root `CLAUDE.md` § Context Guide);
  the tool name, parameters, return shape and tool count do not change.

**TDD**: `red-green required`

**Covers**: —

**Instructions**:

1. In the `test_formula` docstring, extend the return sentence (`:1835-1837`) so it ends:

   ```text
   parameter_errors, execution_ms and memory_used_bytes (int64 as JSON strings).
   memory_used_bytes: peak resident memory of the sandbox process in bytes, INCLUDING the
       interpreter and the imported modules, so it is not usage of the memory cap. "0" means
       not measured (timeout, kill, abort or os._exit; most memory_exceeded runs report "0").
   ```

   Change nothing else in the docstring or the function.

2. In `docs/runbooks/mcp-tools.md:1172-1174`, make the **Return** paragraph list
   `memory_used_bytes` after `execution_ms` with the same definition in one sentence.

**Verification**:

```bash
cd services/xstockstrat-agent && uv sync --frozen --extra dev \
  && uv run --no-sync pytest --cov=app --cov-fail-under=40 \
  && ruff check . && ruff format --check .
grep -n "memory_used_bytes" app/tools.py ../../docs/runbooks/mcp-tools.md   # expect both files
```

---

### Step 6 — test: `test_formula` description names `memory_used_bytes` and its zero meaning

**Status**: `pending`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/tests/test_tools.py` — modify

**Reviewers**: `xstockstrat-agent` owner — MCP tool contract stability and `docs/runbooks/mcp-tools.md` parity

**Codebase Evidence**:
- `tests/test_tools.py:33` `_make_server()`; `:39` `_tool_fn`.
- Description-assertion pattern: `:1094-1095`
  `description = server._tool_manager.get_tool("manage_strategy").description or ""` then
  `normalized = " ".join(description.split())`.
- `class TestAdditiveTools` holds `test_test_formula_dispatches_inline_source` at `:1946-1955` (class at `:1944`).

**TDD**: `red-green required`

**Covers**: —

**Instructions**:

In `TestAdditiveTools`, after `test_test_formula_dispatches_inline_source`, add
`test_test_formula_description_defines_memory_used_bytes`: read
`_make_server()._tool_manager.get_tool("test_formula").description`, normalize whitespace as at
`:1095`, and assert it contains `memory_used_bytes`, `not measured` and `not usage of the memory cap`.

**C-13 verdict**: no domain data is used.

**Verification**:

```bash
cd services/xstockstrat-agent && uv sync --frozen --extra dev \
  && uv run --no-sync pytest --cov=app --cov-fail-under=40 \
  && ruff check . && ruff format --check .
uv run --no-sync pytest -q tests/test_tools.py -k "description_defines_memory_used_bytes"   # 1 passed
```

RED evidence on the pre-Step-5 tree: the description does not contain `memory_used_bytes`.

---

### Step 7 — test: `/insights` formula run shows the missing-result failure

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/e2e/insights/formulas.spec.ts` — modify

**Reviewers**: `xstockstrat-ui` owner — analytics display accuracy, Connect-RPC call safety

**Codebase Evidence**:
- `src/components/insights/FormulaRunResult.tsx:64` maps `result.exitReason` through
  `EXIT_REASON`; `:70-72` renders `Passed` / `Failed`; `:73` the exit label; `:77` renders
  `result.error`; `:92-98` renders `result.stdout`. Rendered from
  `src/components/insights/FormulaWorkspace.tsx:564`.
- `src/components/insights/formulaReference.ts:193`:
  `[SandboxExitReason.RUNTIME_ERROR]: { label: 'Runtime error', tone: 'destructive' }`.
- Proto JSON name of the enum value: `SANDBOX_EXIT_REASON_RUNTIME_ERROR = 4`
  (`packages/proto/indicators/v1/indicators.proto:101-108`).
- Existing run test to mirror: `e2e/insights/formulas.spec.ts:223-246` ("AC-5: running a
  fundamentals formula…") uses `addAuthCookie`, `stubCatalog` (`:152`),
  `stubGetFundamentalsFormula` (`:165`), a `page.route` on
  `**/xstockstrat.indicators.v1.IndicatorsService/ExecuteFormula` (`:231`), navigates to
  `/insights/formulas/${FORMULA_FUNDAMENTALS.formulaId}` and clicks the `Run` button.
- Imports already present at `:1-3`: `addAuthCookie` from `../helpers/auth`; `FORMULAS`,
  `FORMULA_FUNDAMENTALS`, `FUNDAMENTALS_AAPL` from `../fixtures`.
- `grep -rn "memoryUsedBytes\|memory_used_bytes" services/xstockstrat-ui/src services/xstockstrat-ui/e2e`
  → no match: the UI does not display the field, and this step does not add a display.

**TDD**: `N/A (characterisation of an unchanged surface: design.md § 5 changes no UI code, so there
is no implementation step for this test to go red against)`

**Covers**: `AC-3`

**Instructions**:

**Blocked until operator gate O-5 is recorded** (see Step Dependencies).

In the same `test.describe` as the AC-5 run test, add
`test('310 AC-3: a run that never assigns result shows the failure and its error', …)`. Reuse the
AC-5 setup (`addAuthCookie`, `stubCatalog`, `stubGetFundamentalsFormula`, the same page). Fulfil the
`ExecuteFormula` route with:

```json
{
  "success": false,
  "error": "formula did not assign result",
  "exitReason": "SANDBOX_EXIT_REASON_RUNTIME_ERROR",
  "parameterErrors": []
}
```

Click `Run`, then assert the page shows the text `Failed`, the text `Runtime error` and the text
`formula did not assign result`.

**C-12 verdict**: the formula and auth come from the inventory (`FORMULA_FUNDAMENTALS`,
`addAuthCookie`). The response body is an error payload, a scenario one-off that C-12 exempts; no
fixture or `INVENTORY.md` row is added.

**Verification**:

```bash
cd services/xstockstrat-ui && pnpm exec playwright test e2e/insights/formulas.spec.ts \
  && pnpm run lint
grep -n "from '../fixtures'\|helpers/auth" e2e/insights/formulas.spec.ts   # expect the :2-3 imports
```

No coverage threshold applies to `xstockstrat-ui` e2e.

---

### Step 8 — docs: result contract, memory definition and resolved findings rows

**Status**: `pending`
**Service**: `services/xstockstrat-indicators/` docs
**Files**:
- `services/xstockstrat-indicators/CLAUDE.md` — modify
- `services/xstockstrat-indicators/docs/context-constitution.md` — modify
- `services/xstockstrat-indicators/docs/context-constitution-findings.md` — modify

**Reviewers**: none

**Codebase Evidence**:
- `services/xstockstrat-indicators/CLAUDE.md:104` `## Sandbox Security Model`; `:159-162` the
  "Execution enforcement" bullet; `:163-168` the "No-output failure (feature 268)" bullet;
  `:174-181` the "Memory watchdog and startup probe (feature 300)" observability bullet (under
  `## Observability (feature 294-signal-map-instrumentation)`) listing the boot INFO line and the ERRORs.
- `services/xstockstrat-indicators/docs/context-constitution.md:37`: the row "Sandbox failure
  classification by stderr substring-match is a fixed contract | … | a maintainer ruling …".
- `services/xstockstrat-indicators/docs/context-constitution-findings.md:22` (stderr
  classification, "status: **open**"), `:23` (`memory_used_bytes` hardcoded to 0, "status:
  **open**"), `:62-63` the two report link rows; `:3` the refresh-history header line.
- **Not found**: a findings row or link row for
  `docs/reports/2026-10-22-indicators-missing-result-silent-success-defect.md`
  (`grep -n "2026-10-22-indicators" docs/context-constitution-findings.md` → no match). Nothing to
  update for it there.
- Report sidecars: unchanged by contract (see Step Dependencies).

**TDD**: `N/A (docs)`

**Covers**: —

**Instructions**:

1. `CLAUDE.md` § Sandbox Security Model — add one bullet after the "No-output failure (feature
   268)" bullet (`:168`), with this text (it is the O-10 definition, written out here because the
   register did not persist it):

   ```markdown
   - **Result contract (feature 310)**: the child reports its outcome on one status line on stdout,
     tagged with a per-run nonce (`secrets.token_hex(16)`) that the parent generates; the parent
     strips the line, so the nonce never reaches `stdout`. The failure class comes from that line
     (`import_blocked`, `memory_exceeded`, otherwise `runtime_error`), then from the cgroup
     `oom_kill` counter for a SIGKILL; the stderr markers (`MemoryError`, the OpenBLAS abort text)
     classify **only** a run that produced no status line. A formula that never assigns `result`
     fails `SANDBOX_EXIT_REASON_RUNTIME_ERROR` with "formula did not assign result"; `result = {}`
     succeeds. A formula can still mis-tag its **own** run (frame traversal to the nonce or the
     guard exception, `raise MemoryError()`, writing `MemoryError` to stderr then `os._exit(1)`);
     that is an accepted author-controlled forgery, not an isolation breach.
   - **`memory_used_bytes` (feature 310)**: the sandbox child's **total peak resident set size**,
     the leader's `VmHWM` from `/proc/self/status`, read through a descriptor opened before the
     seccomp load. It **includes the interpreter and the eagerly imported modules** (tens of MB for
     a trivial formula), so it is **not** usage of `sandbox.memory_bytes`, which is headroom above
     the measured baseline. **`0` means "not measured"**: the figure travels on the status line, so
     a timeout, a watchdog kill, a signal death, a C-level abort and `os._exit` report 0, and most
     `memory_exceeded` outcomes therefore report 0. Processes the formula forks are not counted. A
     formula that closes the descriptor zeroes its own figure only.
   ```

2. `CLAUDE.md` "Execution enforcement" bullet (`:159-162`): add one sentence — a stored formula
   that declares outputs and never assigns `result` now fails earlier with "formula did not assign
   result" (still `SANDBOX_EXIT_REASON_RUNTIME_ERROR`).

3. `CLAUDE.md` observability bullet (`:174-181`): add the boot self-test — one INFO
   `sandbox memory self-test exit_reason=… memory_measured=…` line at boot, and ERROR
   `sandbox memory_used_bytes unmeasurable on this runtime` when that run is not a success, measures
   0 or raises.

4. `docs/context-constitution.md:37`: replace the row. The stderr substring match is no longer a
   fixed contract (operator ruling O-3, 2026-11-20, quoted in this feature's context.md). State the
   new invariant: failure class is carried by the per-run nonce status line; the
   `_MEMORY_EXHAUSTED_MARKERS` stderr check survives only as the no-status fallback, which keeps
   `fix-indicators-sandbox-matrix.feature` @AC-4 (feature 228). Re-anchor the symbol hints to
   `#_split_status` and `#_MEMORY_EXHAUSTED_MARKERS`.

5. `docs/context-constitution-findings.md`:
   - `:22` — status **resolved** (feature 310): classification is structural; the residual
     self-forgery is accepted (O-4).
   - `:23` — status: **resolved where the boot self-test logs memory_measured>0; DO confirmation
     pending the first post-deploy boot log** (D-14, verbatim condition).
   - `:62-63` — mark both report rows as fixed by feature 310, keeping the links.
   - `:3` — append a "refreshed 2026-11-20 (feature 310 …)" clause in the existing style.

**Verification**:

```bash
grep -n "feature 310" services/xstockstrat-indicators/CLAUDE.md                       # expect ≥ 2 bullets
grep -n "fixed contract" services/xstockstrat-indicators/docs/context-constitution.md  # expect no match
grep -n "DO confirmation pending the first post-deploy boot log" \
  services/xstockstrat-indicators/docs/context-constitution-findings.md                # expect 1 match
grep -n "status: \*\*open\*\*" services/xstockstrat-indicators/docs/context-constitution-findings.md | grep -n "memory_used_bytes\|is not allowed in sandbox"   # expect no match
```

---

## Deviation Log

_Populated by /sdd-execute as implementation proceeds._

- **2026-11-20 (spec-time, `/sdd-review impl-spec`)** — design.md § 7 says the report sidecars are
  "updated" and that the report-2 sidecar carries the D-14 conditional wording. This spec leaves all
  three sidecars untouched and puts the wording in the findings row (Step 8), because the sidecar
  contract (`.claude/skills/sdd-qa/reference/defect-filing.md:26-48`) allows only a status token and
  a `ref:` line. design.md is not amended. Operator confirmation pending (context.md Open Threads).
- **2026-11-21 (Step 1)** — Instruction 5's verbatim `__OUTPUT__` print line is 108 characters
  and fails the step's own `ruff check .` (E501, limit 100; the line is template text inside
  `_SANDBOX_WRAPPER`, so `# noqa` cannot apply). It is split into
  `_output = _output if isinstance(_output, dict) else {{"value": _output}}` followed by
  `print("\\n__OUTPUT__:" + json.dumps(_output))`. The child's behaviour and output are unchanged.
  **Disposition**: in-scope lint fix on the step's own line (HARD CONSTRAINTS exception).
- **2026-11-21 (Step 1)** — TDD red evidence. The step's `**Verification**` exits 0 on the
  pre-change tree, because its trailing greps print expectations and do not fail. RED is therefore
  cited from those greps, `4` against an expected 2 and a match at `:809` against an expected none.
  A scratch behaviour probe outside the repo adds behaviour evidence: it failed before the change
  (missing `result` succeeded, memory 0, the guard-message ValueError was classed `import_blocked`)
  and passed after it. The probe was not committed. Step 2 owns the regression tests.
  **Disposition**: evidence recorded in context.md; no spec text changed.
- **2026-11-21 (Step 1)** — The suite count is `610 passed`, not the spec's measured `571`. Tests
  were added on the base after the spec was measured, and the run is green with the change. The
  service venv reports Python 3.12.3, while root CLAUDE.md pins 3.13. **Disposition**:
  informational only; no action.
- **2026-11-21 (Step 2)** — RED ran against the pre-Step-1 `sandbox.py`, restored temporarily
  from `4f57ba17~1` and put back before GREEN (Step 1 had already landed). The pre-existing
  `SandboxResult(` fake is now at `tests/test_sandbox.py:399`, not `:311`, because the new class
  sits above it. It is still the only match. The serialising-MemoryError source is split over two
  string literals to pass E501. The isolation no-status marker test also passes on the pre-Step-1
  tree, because the marker branch existed then; it is a characterization guard.
  **Disposition**: in-scope; no spec text changed.
- **2026-11-21 (Step 3)** — TDD red evidence. The step's `**Verification**` has no behaviour
  assertion (Step 4 owns the tests), and it exits 0 on the pre-change tree. RED therefore comes from
  a scratch behaviour probe outside the repo, which was not committed. Before the change it found no
  self-test line and no unmeasurable ERROR. After the change it passed. In the run script the
  Verification's closing `)` is on its own line, because the block's trailing `# expect …` comment
  would otherwise swallow it. **Disposition**: evidence recorded in context.md; no spec text changed.
- **2026-11-26 (Step 4, operator-approved fold, decision A of 2026-11-21)** — Step 4's tests showed
  that the boot self-test could change the watchdog-observability outcome. A blind watchdog tick in
  the self-test's sandbox run calls `_warn_unobservable_once()`. That logs `sandbox memory watchdog
  cannot observe child`, latches the `unobservable` once-flag and sets
  `indicators.sandbox.memory_watchdog_observable` to 0, overriding what the probe found. The fold
  widens Step 4's scope to `services/xstockstrat-indicators/app/services/sandbox_probe.py`. A new
  `_self_test_isolated()` pre-marks the `unobservable` once-flag for the duration of `_self_test()`,
  so nothing is logged. Afterwards it re-arms the flag (unless the probe had already latched it) and
  restores the gauge value. `run_startup_probe` now calls it in place of `_self_test()`. A sixth
  test, `test_boot_self_test_blind_sample_leaves_the_probe_outcome_unchanged`, asserts no
  `CANNOT_OBSERVE_MSG`, a gauge of 1, and a once-flag that is still armed. It simulates the blind
  tick by calling `sandbox._warn_unobservable_once()` inside a wrapped `execute_formula`, because a
  real tick needs the `result = {}` run to outlive one 50 ms `_TICK_S`. As a result the
  Verification's `-k "boot_self_test"` line reports `6 passed`, not the commented `5 passed`. RED
  for the five spec tests ran against the pre-Step-3 `sandbox_probe.py`, restored temporarily from
  `5755e29d~1` and put back before GREEN. The Verification's trailing C-13 grep finds no match, so
  it sets `exit=1`, which is the expected "no match". **Disposition**: fold approved by the
  operator; in scope.
