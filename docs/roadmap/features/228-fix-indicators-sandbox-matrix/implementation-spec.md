# Implementation Spec: fix-indicators-sandbox-matrix

**Status**: `pending`
**Created**: 2026-10-15
**Feature**: `docs/roadmap/features/228-fix-indicators-sandbox-matrix/feature.md`
**Total Steps**: 4
**Feature Branch**: `feature/fix-indicators-sandbox-matrix`

---

## Execution Summary

The spec follows design.md § Chosen Approach. `indicators.sandbox.memory_bytes` becomes **headroom** above the
child's pre-lockdown `VmData` baseline. The baseline is probed fail-closed right before the `RLIMIT_DATA`
setrlimit, and the cap is `min(baseline + memory_bytes, 2**63 - 1)`. Input `json.loads` moves after the rlimits,
and the OpenBLAS allocation abort is classified as `memory_exceeded`. All runtime changes are in one file,
`services/xstockstrat-indicators/app/services/sandbox.py`, so the work is a single service/test pair (Steps 1–2),
followed by the UI copy change (Step 3, C-14) and docs plus teardown (Step 4).

**Red-before-green ordering (P-06).** `/sdd-execute` writes Step 2's tests first and leaves them unstaged. It
captures RED against the current `sandbox.py`, implements Step 1, commits only Step 1's **Files**, then commits
Step 2 once it is GREEN. Expected RED, measured in this session against the current tree (Python 3.12.3, numpy
2.4.3, pandas 3.0.1):
- T2: a 32 MiB `np.ones` at `memory_bytes=64 MiB` returns `memory_exceeded`.
- T2b: the 800×800 golden at 64 MiB fails.
- T1: the wrapper still holds the literal `RLIMIT_DATA, (67108864, 67108864)`, and `json.loads` comes before the
  rlimits.
- T4: the OpenBLAS stderr classifies as `runtime_error`.
- T5: `_VMDATA_PROBE` does not exist (`ImportError`/`AttributeError`).
- T3 (`@AC-2`) is a **preservation guard**: it is green before and after (measured: `memory_exceeded` today), and
  the RED capture records it as such rather than as a failure.

**Consumer surfaces (C-14).**
- **UI** `/insights`: Step 3 changes the Memory row note in `formulaReference.ts:171`.
- **Agent** `test_formula`: **no agent code step, by design.** The product spec states there is no request or
  response shape change. The agent forwards `exit_reason` verbatim:
  - `services/xstockstrat-agent/app/client.py:1023-1025` returns
    `MessageToDict(resp, preserving_proto_field_name=True, …)`;
  - `services/xstockstrat-agent/app/tools.py:1478` documents `exit_reason` as part of the returned result;
  - the tool exposes no memory parameter (`tools.py:1459-1465`) and `docs/runbooks/mcp-tools.md:941-962` makes no
    memory claim.

  The agent-visible effect (`memory_exceeded` for the OpenBLAS abort; a host-independent budget) is reached through
  the indicators change alone and is proven at the post-deploy dev smoke (see § Step Dependencies → Owed
  post-deploy verification).

**Business-rule promotion (C-16).** The `@AC-1..5` scenarios are promoted into
`services/xstockstrat-indicators/acceptance/` by the `/sdd-execute` integration PR, not by a step here. The durable
suite `indicators-sandbox-os-isolation.feature` is **not** hand-edited. Its `@AC-3` "address-space" wording drift
(`:29`) is recorded as a finding in Step 4 only.

### Scenario Coverage (Constitution C-15)

| Scenario | Covered by step(s) | Test |
|---|---|---|
| `@AC-1` 800×800 matmul fits within half the default headroom | Step 2 | T2b `TestNumericParityGolden::test_large_array_linalg_at_half_default_headroom` |
| `@AC-2` allocation beyond the headroom fails closed | Step 2 | T3 `TestMemoryHeadroom::test_allocation_beyond_headroom_is_memory_exceeded` |
| `@AC-3` budget independent of the import footprint | Step 2 | T2 `TestMemoryHeadroom::test_headroom_is_independent_of_import_baseline` |
| `@AC-4` OpenBLAS abort classified as out-of-memory | Step 2 | T4 `TestExitReasonClassification::test_openblas_allocation_abort_is_memory_exceeded` |
| `@AC-5` failed baseline probe never runs the formula | Step 2 | T5 `TestBaselineProbe::test_probe_reads_positive_vmdata` + `test_failed_probe_never_runs_formula` |

T1 (`TestLimitsConfigured::test_rlimits_derive_from_config_in_wrapper`, structural) guards the wrapper shape and
order behind FR-1 and FR-3. It is not a scenario test.

## Step Dependencies

- Step 1 [service] is covered by Step 2 [test]. Step 2's tests are authored first and run RED against the
  pre-Step-1 `sandbox.py` (P-06).
- Step 3 [service, UI copy] has no code dependency on Steps 1–2. It runs after them so the UI text describes
  shipped behaviour.
- Step 4 [docs] requires Steps 1–3. It documents the shipped semantics and new line anchors, and runs the
  context-forge teardown last.
- **Execution environment precondition (observed this session).**
  - When the tests run as **root**, the sandbox child drops to uid 65534 before `import pyseccomp`
    (`sandbox.py:263-272`). The interpreter's venv must therefore be traversable by `nobody`.
  - A worktree under a `0700` directory (here `/tmp/claude-0`, `drwx------ root`) fails **every** real-subprocess
    sandbox test with `ModuleNotFoundError: No module named 'pyseccomp'`, whatever the code.
  - Fix: run pytest from the worktree with a venv at a world-traversable path. For example,
    `/home/user/xstockstrat/services/xstockstrat-indicators/.venv/bin/python -m pytest …` gave **33 passed** on
    `tests/test_sandbox_isolation.py tests/test_sandbox.py` against the unmodified tree. Alternatively, run as
    non-root.
  - Capture this baseline before RED, so a RED caused by the environment is not mistaken for a behavioural one.
- **Owed post-deploy verification (O-3, product-spec § Open Questions).** These run after the dev deploy, outside
  `/sdd-execute`, recorded in context.md:
  1. A `test_formula` 400 MiB resize (`a = np.ones((1,)); a.resize((50_000_000,), refcheck=False)`) returns
     `exit_reason` `memory_exceeded`. This proves the cap still applies on the DO kernel.
  2. **Adapted from design.md (P-03, flagged for `/sdd-review impl-spec`).** design.md's second smoke was "a 32 MiB
     allocation with `memory_bytes_override=64 MiB` succeeds". That cannot run through the MCP: `test_formula`
     exposes no memory override (`tools.py:1459-1465`), and backends are gRPC-only.
     - Equivalent proof at the **default** 128 MiB headroom: a `test_formula` allocating
       `np.ones(12 * 1024 * 1024)` (96 MiB) must **succeed**.
     - It fails today (measured this session: `memory_exceeded` at the 128 MiB absolute cap, because baseline + 96
       > 128) and passes only under headroom semantics.
     - The operator confirms or replaces this substitution at review. Accepted by the orchestrator 2026-10-15
       (`test_formula` cannot set `memory_bytes_override`); operator confirmation surfaced in the session summary.
  3. Check the container envelope on `basic-s` (≈ 812–864 MiB worst case at `max_concurrent=4`).
  4. Check whether production has a live full-dotted `indicators.sandbox.memory_bytes` row.
- **Overlap note.** The product-spec review flagged that PR #1247 (227) also edits the root
  `docs/context-constitution-findings.md`. This spec records its findings in the **indicators** findings file
  (`services/xstockstrat-indicators/docs/context-constitution-findings.md`) and does not touch the root file, so
  that adjacent-row conflict no longer applies.

---

### Step 1 — service: indicators sandbox — `VmData` baseline + headroom cap, input parse after rlimits, OpenBLAS OOM marker

**Status**: `done`
**Service**: `xstockstrat-indicators`
**Files**:
- `services/xstockstrat-indicators/app/services/sandbox.py` — modify

**Reviewers**: xstockstrat-indicators owner — formula sandboxing, no side-effects from formula execution, numeric precision

**Codebase Evidence**:
- `sandbox.py:22-24` (module docstring): "Expanded rlimits: RLIMIT_DATA (memory), RLIMIT_CPU (CPU backstop), …
  RLIMIT_AS is deliberately NOT used".
- `sandbox.py:246-250`: `data = json.loads({input_json!r})` and `params = json.loads({params_json!r})`. They run
  **before** the lockdown today.
- `sandbox.py:271-272`: `import pyseccomp as _seccomp`, the last pre-rlimit action.
- `sandbox.py:274-278`: the comment "Expanded rlimits. RLIMIT_DATA (heap + anon mmap) not RLIMIT_AS …", then
  `if {memory_bytes} > 0:` / `    resource.setrlimit(resource.RLIMIT_DATA, ({memory_bytes}, {memory_bytes}))`.
- `sandbox.py:279-282`: the CPU/NPROC/FSIZE/NOFILE setrlimits. `:286-292` builds the seccomp filter and calls
  `_flt.load()`. `:296-297` builds `_formula_globals` and runs `exec({source!r}, _formula_globals)`.
- `sandbox.py:338-350`: `wrapped = _SANDBOX_WRAPPER.format(memory_bytes=..., safe_builtins=..., …, seccomp_allow=_SECCOMP_ALLOW)`,
  the single format call site.
- `sandbox.py:391-396`: `exit_reason = "runtime_error"`, then `if "is not allowed in sandbox" in stderr:` →
  `import_blocked`, then `elif "MemoryError" in stderr:` → `memory_exceeded`.
- `sandbox.py:323`: `memory_bytes: int = 128 * 1024 * 1024`. `app/config/watcher.py:137-138`:
  `get_int("indicators.sandbox.memory_bytes", default=128 * 1024 * 1024)`. **Both stay unchanged** (design §5).
- Defect report `docs/reports/2026-10-15-indicators-sandbox-blas-memory-flake-defect.md:21,23` quotes the CI stderr:
  `OpenBLAS error: Memory allocation still failed after 10 retries, giving up.`
- Existing pattern for a wrapper-interpolated module constant: `_SECCOMP_ALLOW` (`:64-115`) is passed through
  `.format(seccomp_allow=_SECCOMP_ALLOW)` (`:349`) into `{seccomp_allow!r}` (`:287`).
- Recon measurement: the post-import `VmData` is ≈ 75–88 MiB. With headroom semantics the budget is exact (64 MiB:
  a 62 MiB alloc succeeds, 66 MiB fails), and the 800×800 matmul needs 42 MiB of headroom (recon.md § Measured
  facts).

**TDD**: `red-green required` (paired with Step 2; T1, T2, T2b, T4 and T5 fail against the current file)

**Covers**: — (behaviour asserted by Step 2)

**Instructions**:
1. Author Step 2's tests first and leave them unstaged. Capture RED (see § Execution Summary for the expected
   failure per test, and § Step Dependencies for the venv precondition).
2. Add a module-level constant directly after `_SANDBOX_GID` (`:57`):
   ```python
   # Fail-closed: no parseable VmData line raises StopIteration/ValueError before the formula runs.
   _VMDATA_PROBE = (
       "with open('/proc/self/status') as _st:\n"
       "    _baseline = next(int(_l.split()[1]) * 1024 for _l in _st if _l.startswith('VmData:'))\n"
   )
   ```
   - `VmData` is in kB.
   - It is a constant, not inline template text. That lets Step 2 `exec` the identical probe standalone and inject
     a probe failure through `monkeypatch` (T5, @AC-5), following the `_SECCOMP_ALLOW` pattern (C-18: one seam,
     no new abstraction).
   - It contains no `{`/`}`, so it is safe to interpolate through `.format`.
   - **No try/except** (design §1).
3. In `_SANDBOX_WRAPPER`, **delete** the input-parse block at `:246-250` (the `# Load input data` comment, the
   `data = json.loads(...)` line, the `# Load validated parameter values …` comment and the `params = json.loads(...)`
   line).
4. Replace the rlimit comment and `RLIMIT_DATA` block at `:274-278` with the following. The comment stays at most 2
   lines (root CLAUDE.md How to Act #5).
   ```
   # RLIMIT_DATA (not RLIMIT_AS, INDICATORS-2) = pre-lockdown VmData baseline + memory_bytes headroom.
   # CPU/NPROC derive from config; FSIZE=0/NOFILE=64 are jail constants.
   {vmdata_probe}
   if {memory_bytes} > 0:
       _cap = min(_baseline + {memory_bytes}, 2**63 - 1)
       resource.setrlimit(resource.RLIMIT_DATA, (_cap, _cap))
   ```
   - The probe stays **after** `import pyseccomp` (`:272`) and **before** the seccomp `_flt.load()` (`:292`). The
     `openat` it needs is therefore allowed, and the seccomp allowlist is unchanged.
   - The clamp is a type bound for the unclamped `memory_bytes_override` (`servicer.py:278`, D-33), not a tunable
     (F-07).
5. Re-insert the input parse immediately after `resource.setrlimit(resource.RLIMIT_NOFILE, (64, 64))` (`:282`) and
   before the `# seccomp-BPF allowlist` comment (`:284`):
   ```
   # Parsed after the rlimits so payloads count against the formula headroom, not the baseline.
   data = json.loads({input_json!r})
   params = json.loads({params_json!r})
   ```
   `json` is already imported (`:198`) and `_formula_globals` (`:296`) still reads `data`/`params`, so nothing else
   changes.
6. In `execute_formula`'s `.format(...)` (`:338-350`), add `vmdata_probe=_VMDATA_PROBE,`.
7. Add a module-level constant directly after the `SandboxResult` dataclass (`:181-190`):
   ```python
   # stderr markers of a child allocation failure; OpenBLAS's abort carries no "MemoryError".
   _MEMORY_EXHAUSTED_MARKERS = ("MemoryError", "OpenBLAS error: Memory allocation still failed")
   ```
   In the classification (`:395`), replace `elif "MemoryError" in stderr:` with
   `elif any(m in stderr for m in _MEMORY_EXHAUSTED_MARKERS):`. The `import_blocked` check stays first (design §4).
8. Rewrap `:22-24` to ≤100 cols:
   ```
     - Expanded rlimits: RLIMIT_DATA (memory: measured pre-lockdown VmData baseline + memory_bytes
       headroom), RLIMIT_CPU (CPU backstop), RLIMIT_NPROC (fork-bomb), RLIMIT_FSIZE=0 (no file
       writes), RLIMIT_NOFILE. RLIMIT_AS is deliberately NOT used (it rejects numpy/pandas virtual
       reservations — INDICATORS-2).
   ```
9. Do **not** touch `servicer.py`, `watcher.py`, `_SECCOMP_ALLOW`, `_sandbox_env`, the NPROC/CPU/FSIZE/NOFILE
   values, or the eager-import loop (`:215-226`). This preserves `@AC-1/@AC-2/@AC-5 @feature-209` and
   `@AC-4 @feature-173`.

**Verification**:
```bash
cd services/xstockstrat-indicators
grep -n "_VMDATA_PROBE\|vmdata_probe\|_cap = min(_baseline\|RLIMIT_DATA, (_cap, _cap)\|_MEMORY_EXHAUSTED_MARKERS" app/services/sandbox.py
# expect: constant def + format kwarg + template placeholder; the clamp; the setrlimit; marker const + its use
! grep -q "RLIMIT_DATA, ({memory_bytes}, {memory_bytes})" app/services/sandbox.py   # expect absent
uv run --no-sync python - <<'EOF'
from app.services.sandbox import _SANDBOX_WRAPPER as w
order = ["import pyseccomp", "{vmdata_probe}", "setrlimit(resource.RLIMIT_DATA", "json.loads(", "_flt.load()", "exec("]
idx = [w.index(s) for s in order]
assert idx == sorted(idx), list(zip(order, idx))
print("wrapper order OK")
EOF
uv run --no-sync ruff check . && uv run --no-sync ruff format --check .
```

---

### Step 2 — test: indicators sandbox — @AC-1..5 headroom, fail-closed, classification and probe

**Status**: `done`
**Service**: `xstockstrat-indicators`
**Files**:
- `services/xstockstrat-indicators/tests/test_sandbox_isolation.py` — modify

**Reviewers**: xstockstrat-indicators owner — formula sandboxing, numeric precision, no side-effects from formula execution

**Codebase Evidence**:
- `tests/test_sandbox_isolation.py:42-43`: `_run(src, allowed=("numpy", "pandas", "math", "statistics"), data=None, **kw)`
  calls `execute_formula`. The default allow-set matches @AC-3's Given.
- `:22-39`: `_PRICES` is the existing in-file module-level literal used by more than one test. It is the precedent
  for in-file shared formula sources.
- `:199-208`: `test_large_array_linalg_hits_mbind` (800×800 `a @ a.T`, default memory, `timeout_ms=20000`) asserts
  `{"trace": 641260.869, "rank": 50}`.
- `:157-169`: `test_memory_bomb_is_bounded_and_service_recovers` (400 MiB resize, `memory_bytes=128 MiB`) asserts
  `memory_exceeded`. It is left unchanged and must stay green.
- `:259-283`: `test_rlimits_derive_from_config_in_wrapper`. Its inline `_FakeProc` (`:264-270`) hard-codes
  `returncode = 0` and `("__OUTPUT__:{}", "")`, and the `RLIMIT_DATA` literal assertion is at `:283`.
- `:322-329`: `TestSeccompImportOrder` uses the `_SANDBOX_WRAPPER.index(...) < …index(...)` ordering-assertion
  pattern.
- `app/services/sandbox.py:391-396` is the classification under test. `:338-350` is where `_VMDATA_PROBE`
  enters the wrapper (Step 1).
- `tests/test_sandbox.py:144-162` (`test_memory_cap_still_enforced`, 400 MiB at 128 MiB → `memory_exceeded`) is
  left unchanged and must stay green.
- Measured RED this session (current tree): a 32 MiB `np.ones` at `memory_bytes=64 MiB` gives `memory_exceeded`;
  the same at 16 MiB gives `memory_exceeded`.

**TDD**: `red-green required` (authored before Step 1; T1, T2, T2b, T4 and T5 RED; T3 green on both sides as a preservation guard)

**Covers**: `AC-1, AC-2, AC-3, AC-4, AC-5`

**Instructions**:
1. **Shared helpers (top of file, after `_run`).**
   - Add `_MIB = 1024 * 1024`.
   - Add `_LINALG_800_SRC`, the exact source string now inline at `:201-204`, and make
     `test_large_array_linalg_hits_mbind` use it.
   - Add `_ALLOC_32MIB_SRC = "import numpy as np\na = np.ones(4 * 1024 * 1024)\nresult = {'v': float(a.sum())}"`
     (4 Mi float64 = 32 MiB).
   - Add a fake-Popen factory lifted from `_FakeProc` (`:264-270`):
     `def _fake_popen(captured, returncode=0, stdout="__OUTPUT__:{}", stderr="")`. It returns a `lambda *a, **k:`
     that builds a proc object with `pid = 2**30`, whose `communicate(input=None, timeout=None)` stores
     `captured["wrapped"] = input`, sets `self.returncode = returncode` and returns `(stdout, stderr)`.
   - C-13 verdict: these are formula sources and a process double, not mocked domain objects. Each has its
     consumers in this one file, so the in-file module constants follow the `_PRICES` precedent. No `conftest.py`
     entry is required (no second file consumes them).
2. **T1 — rewrite `test_rlimits_derive_from_config_in_wrapper`** (`:259-283`).
   - Keep the call and the CPU/NPROC assertions (`:281-282`).
   - Switch the monkeypatch to `_fake_popen(captured)`.
   - Replace `:283` with:
     - `"VmData:" in wrapped`;
     - `"_cap = min(_baseline + 67108864, 2**63 - 1)" in wrapped`;
     - `"resource.setrlimit(resource.RLIMIT_DATA, (_cap, _cap))" in wrapped`;
     - `"RLIMIT_DATA, (67108864, 67108864)" not in wrapped`;
     - the order assertion: the indices of `"import pyseccomp"`, `"VmData:"`, `"setrlimit(resource.RLIMIT_DATA"`,
       `"json.loads("`, `"_flt.load()"` and `"exec("` in `wrapped` are strictly increasing.
   - Update the docstring to say that `RLIMIT_DATA` = probed baseline + config headroom.
3. **T2b — `@AC-1`.** In `TestNumericParityGolden` add `test_large_array_linalg_at_half_default_headroom`. It
   calls `_run(_LINALG_800_SRC, memory_bytes=64 * _MIB, timeout_ms=20000)` and asserts `res.success is True` and
   `res.output == {"trace": 641260.869, "rank": 50}`. Docstring: "@AC-1 (228): 800×800 needs ≈42 MiB of
   headroom; 64 MiB (half the default) leaves margin on every host."
4. **New class `TestMemoryHeadroom`** (after `TestDeterministicTermination`):
   - T2 `@AC-3` `test_headroom_is_independent_of_import_baseline`: `_run(_ALLOC_32MIB_SRC, memory_bytes=64 * _MIB, timeout_ms=15000)`
     uses the default allow-set (numpy, pandas, math, statistics). Assert `res.success is True, res.error`.
     Docstring: the import baseline alone is ≥ 75 MiB > 64 MiB, so this passes only if the cap is
     baseline + headroom.
   - T3 `@AC-2` `test_allocation_beyond_headroom_is_memory_exceeded`: `_run(_ALLOC_32MIB_SRC, memory_bytes=16 * _MIB, timeout_ms=15000)`.
     Assert `res.success is False` and `res.exit_reason == "memory_exceeded"`.
5. **New class `TestExitReasonClassification`** — T4 `@AC-4`
   `test_openblas_allocation_abort_is_memory_exceeded(self, monkeypatch)`:
   - monkeypatch `app.services.sandbox.subprocess.Popen` with
     `_fake_popen({}, returncode=1, stdout="", stderr="OpenBLAS error: Memory allocation still failed after 10 retries, giving up.\n")`;
   - call `_run("result = {}", allowed=())`;
   - assert `res.success is False` and `res.exit_reason == "memory_exceeded"`.
6. **New class `TestBaselineProbe`** — T5 `@AC-5`:
   - `test_probe_reads_positive_vmdata`: `ns = {}`, `exec(sandbox._VMDATA_PROBE, ns)`, then assert
     `isinstance(ns["_baseline"], int) and ns["_baseline"] > 0`. Import the constant via
     `from app.services import sandbox` inside the test, so the RED is a per-test `AttributeError`, not a
     collection error.
   - `test_failed_probe_never_runs_formula(self, monkeypatch)`:
     - set `app.services.sandbox._VMDATA_PROBE` to `sandbox._VMDATA_PROBE.replace("VmData:", "VmAbsent:")`;
     - call `_run("print('FORMULA_RAN')\nresult = {'v': 1}", allowed=(), memory_bytes=64 * _MIB, timeout_ms=8000)`;
     - assert `res.success is False`, `res.exit_reason == "runtime_error"`, `"FORMULA_RAN" not in res.stdout` and
       `"StopIteration" in res.stderr`.
7. Leave every other test unchanged. They must stay green:
   - the 400 MiB bombs (`:157-169`; `test_sandbox.py:144-162`), since 400 MiB > baseline + 128 ≈ 216 MiB;
   - the default-memory 800×800 golden;
   - the `@feature-173` empty allow-list tests;
   - the seccomp, fork-bomb, secrets and FS-read suites.

**Verification**:
```bash
cd services/xstockstrat-indicators
uv run --no-sync pytest tests/test_sandbox_isolation.py tests/test_sandbox.py -q
# repeated-run flake guard for the matrix that motivated the bug (product-spec Acceptance: "passes on repeated runs")
for i in 1 2 3 4 5; do uv run --no-sync pytest "tests/test_sandbox_isolation.py::TestNumericParityGolden" "tests/test_sandbox_isolation.py::TestMemoryHeadroom" -q -p no:cacheprovider || exit 1; done
uv run --no-sync pytest --cov=app --cov-fail-under=50
ruff check . && ruff format --check .
! grep -n "conftest" tests/test_sandbox_isolation.py   # C-13: expect none (single-file consumers, verdict recorded above)
```
(If the session runs as root under a `0700` path, invoke pytest with a world-traversable venv python, per
§ Step Dependencies.)

---

### Step 3 — service: xstockstrat-ui — `/insights` formula reference Memory row describes headroom

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/components/insights/formulaReference.ts` — modify

**Reviewers**: xstockstrat-ui owner — analytics display accuracy

**Codebase Evidence**:
- `formulaReference.ts:168-174`: `export const SANDBOX_LIMITS: SandboxLimit[] = [ … ]`, with `:171`
  `{ label: 'Memory', value: '128 MiB', note: 'Hard cap (indicators.sandbox.memory_bytes).' }`.
- The only consumer is `FormulaReferencePanel.tsx:14` (import) and `:118` (`SANDBOX_LIMITS.map(...)`).
  `grep -rn "Hard cap" src e2e` → only `:171`, so no test asserts the text.
- Product spec § Consumer Surface(s): the note becomes "Headroom above the interpreter/library baseline
  (indicators.sandbox.memory_bytes)". The value stays `128 MiB`.

**TDD**: `N/A (UI copy string only — no behaviour or logic; xstockstrat-ui is exempt from C-08 pairing and vitest coverage is scoped to src/lib/**)`. Existing `/insights` formula-editor E2E coverage still renders `SANDBOX_LIMITS` unchanged in shape; no Playwright change is required (copy-only, no test asserts the note).

**Covers**: —

**Instructions**:
1. At `formulaReference.ts:171` change only the `note` to
   `'Headroom above the interpreter/library baseline (indicators.sandbox.memory_bytes).'`. Keep `label: 'Memory'`
   and `value: '128 MiB'`. No color, component or state change, so C-17 is unaffected.

**Verification**:
```bash
cd services/xstockstrat-ui
grep -n "Headroom above the interpreter/library baseline (indicators.sandbox.memory_bytes)." src/components/insights/formulaReference.ts   # expect :171
! grep -rn "Hard cap" src   # expect nothing
[ -d node_modules ] || pnpm install --frozen-lockfile
pnpm run lint && pnpm exec tsc --noEmit && pnpm exec prettier --check src/components/insights/formulaReference.ts
```

---

### Step 4 — docs: headroom semantics in indicators docs and runbooks; findings; teardown

**Status**: `pending`
**Service**: `docs` (indicators service docs + runbooks)
**Files**:
- `services/xstockstrat-indicators/CLAUDE.md` — modify
- `services/xstockstrat-indicators/docs/context-constitution.md` — modify
- `services/xstockstrat-indicators/docs/context-constitution-findings.md` — modify
- `docs/runbooks/indicator-builder.md` — modify
- `docs/runbooks/config-rollout.md` — modify

**Reviewers**: none

**Codebase Evidence**:
- `services/xstockstrat-indicators/CLAUDE.md:101`:
  `| indicators.sandbox.memory_bytes | int | 134217728 | Max memory (128 MiB) per formula |`.
- `CLAUDE.md:129-131`: the lockdown-order sentence "… → `PR_SET_NO_NEW_PRIVS` → expanded rlimits → seccomp
  `.load()` → `exec(source)`".
- `CLAUDE.md:148-150`: "**Expanded rlimits**: `RLIMIT_DATA` (memory; `RLIMIT_AS` would reject …)".
- `docs/context-constitution.md:17`: the INDICATORS-1 "Why" names the OpenBLAS abort only for unpinned threads.
  `:18`: INDICATORS-2, "… keeping the budget enforceable", with evidence `app/services/sandbox.py:278` and
  `:274-276`.
- `docs/context-constitution.md:36`: the candidate-rule row on stderr substring classification
  (`sandbox.py:391-396`, markers `"is not allowed in sandbox"`/`"MemoryError"`).
- `docs/context-constitution-findings.md:21`: the open question on stderr classification, citing stale anchors
  `sandbox.py:214,231`.
- `docs/runbooks/indicator-builder.md`:
  - `:155` `| Memory cap | indicators.sandbox.memory_bytes | 128 MiB |`;
  - `:221` `memory_bytes_override=32 * 1024 * 1024,  # 32 MiB for testing`;
  - `:233` `| MEMORY_EXCEEDED | Exceeded memory_bytes | … |`;
  - `:246-247`, bare keys `"key": "sandbox.timeout_ms"` / `"key": "sandbox.memory_bytes"`.
- `docs/runbooks/config-rollout.md:156-158`: bare `"key": "sandbox.timeout_ms"`, `"sandbox.memory_bytes"` and
  `"sandbox.allowed_imports"` with `"namespace": "indicators"`.
- `services/xstockstrat-config/docs/context-constitution.md:26` (CONFIG-9): the snapshot is keyed by the raw `key`
  column, with no namespace auto-prefix. The indicators watcher reads full-dotted keys (`app/config/watcher.py:134,138,143`),
  so the bare-key examples above set rows the service never reads. Staging confirms this: `get_config('indicators')`
  returns bare `sandbox.*` only (recon.md § Measured facts).
- The seeds are `services/xstockstrat-config/migrations/001_config_tables.up.sql:63` and
  `002_config_environment.up.sql:62` (production 64 MiB), both bare and therefore inert. They are **not** edited
  (F-01).
- The debt finding `docs/repo-surveyor/debt-radar-findings.md:315` is D-33 (`memory_bytes_override` unclamped).
- `services/xstockstrat-indicators/acceptance/indicators-sandbox-os-isolation.feature:29` reads "address-space for
  the allocation", but the code uses `RLIMIT_DATA` (C-16: record, never hand-edit).
- Teardown: root `CLAUDE.md` § Teardown. `.agents/context-forge.json` `scrubberExtraTargets` is
  `["README.md", "docs/patterns/ui-ux-governance.md"]`, and neither has a sandbox or memory reference
  (`grep -n -i "sandbox\|memory"` returns only an unrelated README:62 "conversation memory").

**TDD**: `N/A (docs — non-code-bearing)`

**Covers**: —

**Instructions**:
1. `services/xstockstrat-indicators/CLAUDE.md`:
   - `:101`: change the description to "Formula memory **headroom** (128 MiB) above the child's runtime-measured
     pre-lockdown `VmData` baseline; `RLIMIT_DATA` = baseline + this value (feature 228)". Keep the default
     `134217728`.
   - `:129-131`: insert "→ `VmData` baseline probe" before "expanded rlimits", and "→ parse input `data`/`params`"
     between "expanded rlimits" and "seccomp `.load()`".
   - `:148`: change "`RLIMIT_DATA` (memory; …" to "`RLIMIT_DATA` = measured baseline + `memory_bytes` headroom
     (memory; …".
2. `services/xstockstrat-indicators/docs/context-constitution.md`:
   - INDICATORS-1 "Why" (`:17`): append "The same abort also occurs with pinned threads when the memory headroom is
     too tight; it is classified `memory_exceeded` (feature 228)."
   - INDICATORS-2 (`:18`): keep the rule. In "Why", add that the limit is the runtime-measured pre-lockdown
     `VmData` baseline plus `indicators.sandbox.memory_bytes` headroom. The baseline is neither a tunable nor a
     constant (`@AC-6 @feature-209`), and a larger `allowed_imports` costs container memory, not formula budget.
     Re-anchor Evidence/Example to the Step 1 lines of the `_VMDATA_PROBE` constant and the
     `setrlimit(resource.RLIMIT_DATA, (_cap, _cap))` line (re-grep after Step 1; never guess the numbers).
   - Candidate row (`:36`): add the `"OpenBLAS error: Memory allocation still failed"` marker
     (`_MEMORY_EXHAUSTED_MARKERS`) and re-anchor it to the post-Step-1 classification lines.
3. `services/xstockstrat-indicators/docs/context-constitution-findings.md`:
   - Re-anchor the `:21` open question to the post-Step-1 classification lines and name both memory markers.
   - Add three bullets under `## Open questions`:
     - **Inert indicators seeds.** Config migrations `001_config_tables.up.sql:63` and
       `002_config_environment.up.sql:62` seed bare `sandbox.*` keys. The watcher reads full-dotted
       `indicators.sandbox.*` (CONFIG-9), so they never apply; production's 64 MiB seed is inert. F-01 forbids
       editing them. A corrective full-dotted seed is a separate feature. Status: **open**.
     - **Unclamped override.** `memory_bytes_override` is unclamped (`servicer.py:278`; D-33 in
       `docs/repo-surveyor/debt-radar-findings.md:315`). Feature 228 only clamps the computed cap to int64. A
       negative override still skips the `RLIMIT_DATA` setrlimit. Status: **open**.
     - **Wording drift.** The durable suite `acceptance/indicators-sandbox-os-isolation.feature:29` says
       "address-space for the allocation", but the cap is `RLIMIT_DATA` (data segment). Record only; C-16 forbids
       hand-editing the durable suite. Status: **open**.
   - Re-anchor the `:10` resolved row to the post-Step-1 docstring and RLIMIT comment lines, and the `:20`/`:22`
     open-question anchors to their current code (re-grep; never guess).
4. `docs/runbooks/indicator-builder.md`:
   - `:155`: label "Memory headroom (above the interpreter/library baseline)".
   - `:221`: change to `memory_bytes_override=64 * 1024 * 1024,  # 64 MiB formula headroom (above the baseline) for testing`.
   - `:233`: Cause becomes "Exceeded the `memory_bytes` headroom (incl. an OpenBLAS allocation abort)".
   - `:246-247`: use the full-dotted keys `"indicators.sandbox.timeout_ms"` / `"indicators.sandbox.memory_bytes"`.
     The same example is wrong for both keys, and fixing both is C-10.
5. `docs/runbooks/config-rollout.md:156-158`: use the full-dotted keys `indicators.sandbox.timeout_ms`,
   `indicators.sandbox.memory_bytes` and `indicators.sandbox.allowed_imports`.
6. **Teardown** (root `CLAUDE.md` § Teardown): run `/context-forge:context-constitution refresh` scoped to the files
   above plus `app/services/sandbox.py`, and fix the grounded drift it reports. If the plugin is unavailable,
   re-read every touched context file against the post-Step-1 code by hand. Then record in the integration PR body
   both that the plugin was unavailable and the manual reconciliation performed (`fails.md:670`).
   Fix only drift inside this step's **Files**; drift in any other file is recorded in the Deviation Log and that
   file added to **Files** (with operator acknowledgement) before staging. The root
   `docs/context-constitution-findings.md` stays untouched.

**Verification**:
```bash
grep -n "headroom" services/xstockstrat-indicators/CLAUDE.md services/xstockstrat-indicators/docs/context-constitution.md docs/runbooks/indicator-builder.md
grep -n "VmData" services/xstockstrat-indicators/CLAUDE.md services/xstockstrat-indicators/docs/context-constitution.md
grep -n "OpenBLAS error: Memory allocation still failed" services/xstockstrat-indicators/docs/context-constitution.md services/xstockstrat-indicators/docs/context-constitution-findings.md
! grep -n "\"key\": \"sandbox\." docs/runbooks/indicator-builder.md docs/runbooks/config-rollout.md   # expect nothing
grep -n "Inert indicators seeds\|D-33\|address-space" services/xstockstrat-indicators/docs/context-constitution-findings.md
# every sandbox.py:<n> anchor in the touched docs must resolve to the cited code after Step 1:
grep -on "sandbox.py:[0-9-]*" services/xstockstrat-indicators/docs/context-constitution.md services/xstockstrat-indicators/docs/context-constitution-findings.md
git diff --stat origin/main-dev...HEAD -- services/xstockstrat-config/migrations   # expect empty (F-01)
```

---

## Deviation Log

_Populated by /sdd-execute as implementation proceeds._
