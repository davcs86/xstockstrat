# Recon: fix-sandbox-result-contract

**Created**: 2026-11-11
**From**: product-spec.md
**Tree**: origin/main-dev@c4fd48b0 (detached; `feature/fix-sandbox-result-contract` not yet on origin). The four discovery digests were UNSTAMPED. Every `path:line` below was re-grepped at this tree.
**Affected services**: xstockstrat-indicators (fix site); xstockstrat-ui and xstockstrat-agent (consumer surfaces that read the `ExecuteFormula` result and pass it through)

---

## Objective

The indicators sandbox child wrapper reports its result to the parent through stdout and stderr text. This contract has three defects:

- Failure class is inferred from forgeable stderr substrings, so `import_blocked` and `memory_exceeded` can be mis-tagged.
- `memory_used_bytes` is hardcoded to `0` on every return path.
- A missing `result` is silently turned into `success=true, output={}`.

The fix makes the contract truthful. The failure class comes from a structural signal the formula cannot forge. Memory is a real per-run measurement, and the proto field stays. A formula that never assigns `result` fails with an error that names `result`, while an explicit `result = {}` still succeeds. Both of the last two behaviours are operator decisions from 2026-11-10.

## Codebase Map

- **`xstockstrat-indicators`** (Python)
  - Entry point: `services/xstockstrat-indicators/app/main.py`
  - Handler/servicer:
    - `ExecuteFormula` is at `app/handlers/servicer.py:244`.
    - `exit_reason_map` is at `:362`. The closed-set fallback is at `:379`, and `record_sandbox_execution(exit_reason, run_seconds)` is called at `:383`.
    - `memory_used_bytes=result.memory_used_bytes` is copied into the response at `:397` and `:413`.
  - Last migration: `007_private_formulas_templates.up.sql` (`services/xstockstrat-indicators/migrations/`). The next would be `008`, but this feature needs no migration.
  - Config-read pattern: `app/config/watcher.py:85-86` (`sandbox_timeout_ms` reads `int_positive(self, "sandbox.timeout_ms", 5000)`), consumed at `servicer.py:292`. No new key is needed.
  - Other key symbols, all in `app/services/sandbox.py`:
    - `SandboxResult` dataclass at `:531-540`. `memory_used_bytes: int` is at `:538`, and the `exit_reason` comment listing the closed set is at `:540`.
    - `_MEMORY_EXHAUSTED_MARKERS` at `:544` (`"MemoryError"`, `"OpenBLAS error: Memory allocation still failed"`).
    - The wrapper's `_safe_import` raises `ImportError(f"Import '{{name}}' is not allowed in sandbox")` at `:562`.
    - The eager-import loop swallows `except Exception: continue` at `:568-572`.
    - `_flt.load()` (seccomp lockdown) is just before `:645`.
    - `exec({source!r}, _formula_globals)` is at `:647`. Nothing wraps it: no try/except, no `sys.exit`, no excepthook.
    - **Missing-result site**: `:651` `_output = _formula_globals.get('result', {{}})`. Line `:652` then always prints `"\n__OUTPUT__:" + json.dumps(...)`. `_SANDBOX_WRAPPER` is a `.format()` template, so its braces are doubled.
    - `execute_formula` is at `:670`, `subprocess.Popen` at `:722`, and `proc.communicate(` at `:744` (the resumable sampling loop) and `:762` (reap after kill). `communicate()` is the only reaper.
    - **`memory_used_bytes=0` sites**: `:770` (watchdog memory kill), `:780` (timeout), `:794` (inside the `_fail` closure at `:787`) and `:834` (success).
    - **Stderr classification**: `:807-819`. `:809` matches `"is not allowed in sandbox" in stderr` and gives `import_blocked`. `:811` matches `any(m in stderr for m in _MEMORY_EXHAUSTED_MARKERS)` and gives `memory_exceeded`. `:813` checks `proc.returncode == -signal.SIGKILL and _oom_kill_rose(oom_before)` and gives `memory_exceeded`; this is counter evidence and already structural. The fallback error text is `f"formula exited with code {proc.returncode} before producing output"`.
    - **Feature-268 no-output checks**: `:821-822` returns `_fail("formula produced no output", "runtime_error")`, and `:823-826` handles an unparseable marker (`"formula output could not be parsed: …"`).
    - **Feature-300 watchdog state**: `_GroupState.peak_resident` at `:344`, updated at `:450` inside `_watch` (`:434`). The `finally` logs `peak_vmdata_growth` and `peak_resident` at `:838-853`. These fields are populated only when the watchdog armed (`memory_bytes > 0`).
    - **Child-to-parent trusted channel (feature 300)**: the `_HANDOFF` template at `:85-98` runs before seccomp loads. It reads `/proc/self/status` and `resource.getrlimit`, calls `os.write({fd}, 'H1 …')`, then `os.close({fd})`. The parser is `_HANDOFF_LINE` at `:100`, parsing happens at `:212`, the cap is `_HANDOFF_MAX` at `:245`, and the reader is `_HandoffReader` at `:271`, wired at `:699` and `:714`.
    - The wrapper already imports `resource` (`:553`). No `getrusage`/`ru_maxrss` use exists anywhere in `sandbox.py`.
  - Telemetry: `app/telemetry.py:392` `record_sandbox_execution(exit_reason, seconds)`. Its label set is closed: success, timeout, memory_exceeded, runtime_error, import_blocked, other.
  - Proto: `packages/proto/indicators/v1/indicators.proto:95` `int64 memory_used_bytes = 6;`. It stays unchanged.
- **`xstockstrat-ui`** (Next.js). Pass-through consumer only.
  - `src/components/insights/FormulaRunResult.tsx:64` `const exit = EXIT_REASON[result.exitReason] ?? EXIT_REASON[0];`. A failure whose error names `result` renders through the existing error and exit path.
  - The hook is `src/hooks/useFormulas.ts` (`useExecuteFormula`). The BFF forward is in `src/lib/insightsBff.ts`.
  - A grep for `memoryUsedBytes|memory_used_bytes` over `services/xstockstrat-ui/src` finds **no match**. The UI does not display the field today.
- **`xstockstrat-agent`** (Python). Pass-through consumer only.
  - `app/tools.py:1669` `async def test_formula(`. Its docstring (~`:1678`) already tells authors to "assign the result to a `result` dict". The returned-fields list (~`:1687-1689`) does not include `memory_used_bytes`.
  - The client call is in `app/client.py` (~`:1150`/`:1175`, digest-cited).
  - A grep over `services/xstockstrat-agent/app` finds no reader of `memory_used_bytes`.
  - `test_formula` is not one of the `strat-lab` plugin-coupled tools, so the plugin skill needs no update.

## Patterns to REUSE

- **Unforgeable child-to-parent report** (the structural exit-reason signal and the child-reported peak RSS): reuse the feature-300 inherited `pass_fds` pipe (`_HANDOFF` `:85-98`, `_HandoffReader` `:271`, `_HANDOFF_LINE` `:100`, `_HANDOFF_MAX` `:245`).
  - It is unforgeable because the fd is written and **closed before** the formula runs and before seccomp loads, so the formula cannot write to it.
  - Any post-`exec` report sent over a second pipe has to be written **after** the formula runs. That is a new trust problem: the formula could write to an fd it can see, so the fd must not be reachable. Design must settle this (see Risks).
  - Precedent ledger entry: insights 2026-11-09 fix-sandbox-memory-cap (design).
- **Missing-result failure** → reuse the `_fail(error, exit_reason)` closure (`sandbox.py:787`) and the feature-268 wording style (`:822`).
  - The error must contain `result` (AC-3).
  - Detect the missing result **in the wrapper** (for example `'result' not in _formula_globals`), not by `{}` equality in the parent, so that `result = {}` still succeeds (AC-4).
- **"Success needs a positive, parent-verified artifact; place the check after more specific classifications"** → ledger insights 2026-11-04 fix-indicators-formula-correctness (design).
  - The new missing-result check may only add a label. It must never relabel timeout, memory or blocked-import.
- **Per-run memory source**: candidates are an `os.wait4`-style per-child rusage, a child-reported `resource.getrusage(RUSAGE_SELF).ru_maxrss` (`resource` is already imported at `:553`), or the watchdog's `gstate.peak_resident` (only when armed).
  - The parent's `getrusage(RUSAGE_CHILDREN)` is **rejected by the evidence**. It is a process-wide high-water mark across every reaped child, and it races under `sandbox.max_concurrent` > 1. Note that the product spec cites it only as an "e.g.".
- **Tests**:
  - Real-subprocess tests call `execute_formula(source=..., input_data={}, allowed_imports=[...])` directly in `tests/test_sandbox.py`. Mirror `class TestSandboxNoOutputFails` (`:232`) and `test_ac3_formula_assigning_result_succeeds` (`:254`).
  - Servicer-level tests build `indicators_pb2.ExecuteFormulaRequest(formula_source=...)` (`tests/test_sandbox.py` ~`:323`).
  - Run with `cd services/xstockstrat-indicators && uv sync --extra dev && uv run --extra dev pytest` (or `.venv/bin/python -m pytest`).
- **Acceptance promotion style (C-16)**: `services/xstockstrat-indicators/acceptance/fix-sandbox-memory-cap.feature` and `fix-indicators-sandbox-matrix.feature`.

## Existing Business Rules (preserve / extend)

- **PRESERVE** `@AC-1` "A formula that exits before producing output is reported as a failure" (`services/xstockstrat-indicators/acceptance/fix-indicators-formula-correctness.feature`, @feature-268). Keep "produced no output". The new missing-`result` error is a separate case and must not change this text.
- **EXTEND** `@AC-1` "A formula that exits before producing output is reported as a failure" (same file). This feature adds a sibling case: a formula that "ran to completion without assigning `result`" gives `success=false` and an error that names `result`.
- **PRESERVE** `@AC-2` "A formula whose only output line does not parse is reported as a failure" (same file). The text "could not be parsed" stays.
- **PRESERVE** `@AC-3` "A formula that assigns result still succeeds" (same file). Success with output `{"x":1}`, which is consistent with this feature's AC-4 (`result = {}` succeeds).
- **PRESERVE** `@AC-4` "An OpenBLAS allocation abort is classified as out-of-memory" (`services/xstockstrat-indicators/acceptance/fix-indicators-sandbox-matrix.feature`, @feature-228).
  - The `memory_exceeded` outcome must hold.
  - The scenario's `Given` is "exits with code 1 and stderr contains the OpenBLAS message", which is the stderr mechanism that report 1 replaces. See Risks: dropping stderr detection for this case is a **CHANGE** and needs operator sign-off in `context.md`.
- **PRESERVE** `@AC-2` "An allocation beyond the headroom fails closed" and `@AC-5` "A failed baseline probe never runs the formula" (same file). The `memory_exceeded` and `runtime_error` classes must survive the classifier refactor.
- **PRESERVE** `@AC-1` "The 800x800 matmul fits within half the default headroom" and `@AC-3` "The formula budget does not depend on the interpreter's import footprint" (same file). Legitimate formulas must still succeed after memory measurement is added, with no new overhead and no limit change.
- **PRESERVE** the watchdog scenarios in `services/xstockstrat-indicators/acceptance/fix-sandbox-memory-cap.feature` (@feature-300). Measurement must not disturb watchdog sampling or classification:
  - `@AC-1` "An over-headroom formula is killed even when the kernel ignores RLIMIT_DATA"
  - `@AC-11` "Memory that evades VmData accounting is still killed"
  - `@AC-4` "Legitimate formulas are not killed while the watchdog is active"
  - `@AC-8` "A fork-bomb stays a typed error…"
- **PRESERVE** `@AC-5` "A SIGKILLed child is attributed by evidence" (same file). The oom_kill-delta attribution and the error text "formula exited with code -9 before producing output" stay unchanged.
- **PRESERVE** `@AC-12` "The arming handoff cannot be forged or inherited by a concurrent run" (same file). This is the precedent: any new structural signal must meet the same unforgeable and not-inherited standard.
- **PRESERVE** in `services/xstockstrat-indicators/acceptance/indicators-sandbox-os-isolation.feature` (@feature-209), which guarantees typed errors and identical legitimate results:
  - `@AC-3` "An infinite-loop / memory-bomb formula is terminated deterministically"
  - `@AC-5` "A fork-bomb formula cannot exhaust host process resources"
  - `@AC-4` "A legitimate formula evaluates to the identical result as before isolation"
- **PRESERVE** `@AC-37` "Every sandbox failure is counted although the RPC returns OK" (`services/xstockstrat-indicators/acceptance/signal-map-instrumentation.feature`, @feature-294). The new failure must be counted under a closed-set label (missing `result` maps to `runtime_error`), with RPC status OK and a WARN log.
- **PRESERVE** `@AC-38` "The sandbox timeout is clamped to the request's remaining deadline" and `@AC-18` "test_formula honours the configured sandbox timeout" (`services/xstockstrat-indicators/acceptance/fix-config-keys-drift.feature`, @feature-295).
- **PRESERVE** `@AC-5` "Test a fundamentals-scoring formula with supplied values" (`services/xstockstrat-agent/acceptance/formula-fundamental-inputs-authoring.feature`, @feature-205). Agent `test_formula` still returns the score.
- **PRESERVE** `@AC-7` "An authored fundamentals formula behaves identically as a strategy component" and `@AC-6` "The fundamentals loop still runs the system scoring formula" (`docs/sdd/business-rules/platform.feature`, @feature-205 / @feature-224).
  - The seeded system formula assigns `result` (`app/formulas/fundamentals_value_quality.py:186`), so it is safe.
- No existing acceptance suite for xstockstrat-ui covers formula-test rendering of `exit_reason` or `memory_used_bytes`. `services/xstockstrat-ui/acceptance/formula-fundamental-inputs-authoring.feature` covers picker and prefill only, so it is not impacted.
- Tag collision: this feature's `@AC-1..4` reuse numbers that promoted suites already use. Keep `@feature-310` on promotion.

## Dependencies

- Proto/RPC: none. `ExecuteFormulaResponse.memory_used_bytes` (`packages/proto/indicators/v1/indicators.proto:95`, field 6) stays and is now populated.
- Migration: none. The next free number would be `008` for `services/xstockstrat-indicators/migrations/`.
- Config keys: none. The existing `sandbox.timeout_ms`, `sandbox.memory_bytes`, `sandbox.allowed_imports`, `sandbox.max_concurrent` and `sandbox.startup_grace_ms` are unchanged.
- Inter-service edges: unchanged. xstockstrat-ui calls indicators `ExecuteFormula` over gRPC, and xstockstrat-agent calls indicators `ExecuteFormula` over gRPC.
- New env vars / ports: none.

## Risks / Not-found

1. **The structural signal must survive the formula.**
   - Today there is no exit code or sentinel; only stderr substrings and the cgroup counter exist.
   - Distinct exit codes collide with `SystemExit(n)` and `os._exit(n)` called by the formula, and with -9 (SIGKILL).
   - A formula can print anything to stdout and stderr, and it can catch `ImportError` and `MemoryError` itself.
   - After `_flt.load()`, only compute syscalls plus write and exit are allowed.
   - A post-`exec` pipe report is forgeable unless the fd is unreachable from formula code.
   - The design must pick a mechanism that meets `@AC-12` (feature 300) and must state what it **cannot** distinguish. For example, a formula that swallows its own blocked-import exception is out of scope.
2. **OpenBLAS abort (`fix-indicators-sandbox-matrix.feature` @AC-4, @feature-228).** This abort happens in C (exit 1 with a stderr message) and never raises a Python `MemoryError`, so a wrapper `except MemoryError` cannot see it. Either keep a stderr fallback for this one case, which means OQ3 is only partly closed, or change the promoted rule, which is a **C-16 CHANGE** and needs operator sign-off in `context.md`.
3. **OQ3 is still undecided.** `services/xstockstrat-indicators/docs/context-constitution.md:41` records "Sandbox failure classification by stderr substring-match is a fixed contract" pending "a maintainer ruling". Design must surface this ruling to the operator (CLAUDE.md "How to Act" 1, P-03). It must not assume it.
4. **Memory source.**
   - `getrusage(RUSAGE_CHILDREN)` in the parent is cumulative and process-wide, so it is wrong under `max_concurrent` > 1. This rejects the product spec's example source.
   - `gstate.peak_resident` exists only when armed.
   - A child-reported `ru_maxrss` must be written after `exec`, which runs into the trust issue in risk 1. A formula could inflate or zero it, but only on its own run.
   - Timeout, kill and no-output paths may have no child report at all. Design must state what each of the four return paths (`:770`, `:780`, `:794`, `:834`) reports, and whether `0` is still allowed on a path with no measurement.
   - Tests can assert only `> 0` (AC-2), because the measurement is not deterministic.
5. **Implicit-`{}` reliance (OQ1 recon obligation), partly answered.**
   - The only in-repo formula, `app/formulas/fundamentals_value_quality.py:186`, assigns `result`.
   - The test sources digest 3 inspected exit before the result line, so their outcome is unchanged: `tests/test_sandbox.py:237` `raise SystemExit(0)`, `:246`, `:274` `os._exit(0)` and `:283` `raise SystemExit(1)`.
   - Mocked-Popen stubs bypass the wrapper: `tests/test_sandbox_isolation.py:65` and `tests/test_sandbox_watchdog.py:539`.
   - **Not done**:
     - A full enumeration of the ~54 `source=`/`formula_source=` test sources (24 in `test_formulas.py`, 15 in `test_sandbox.py`, 4 in `test_private_formulas.py`, others).
     - A check of the `indicators.formula_templates` seed rows, the UI formula-workspace default source, and the e2e fixtures.
     - User-saved DB formulas (`indicators.formulas`) cannot be read from code. A dev/prod DB or operator check is required before this ships (product spec OQ1).
6. **Declared-output ordering.** A stored formula with declared outputs already fails `runtime_error` and names the missing series (service `CLAUDE.md`). The new missing-`result` check must not shadow or reorder that error, and no scenario pins it.
7. **Pinned tests.**
   - These assert today's labels and must keep passing:
     - `tests/test_sandbox.py:101` `test_blocked_import` (`import socket\nresult = 1` → `import_blocked`)
     - the `memory_exceeded` test at `tests/test_sandbox.py` ~`:205`
     - `tests/test_sandbox_isolation.py:225` `test_openblas_allocation_abort_is_memory_exceeded`, which monkeypatches the abort text
     - the watchdog tests in `tests/test_sandbox_watchdog.py` (~`:200`, `:245`, `:298-317`)
   - These test files construct `SandboxResult(... memory_used_bytes=0 ...)` fakes. They stay valid only if the dataclass signature is unchanged: `test_sandbox.py:317`, `test_sandbox_deadline.py:42`, `test_live_limits.py:63`, `test_execute_formula_concurrency.py:60,146,169`, `test_execute_formula_override_clamp.py:51` and `test_legacy_authors_read_path.py:72`.
8. **Ledger traps.**
   - fails 2026-09-28 indicators-sandbox-os-isolation: run subprocess tests through the service venv, never a global `uv` tool pytest.
   - fails 2026-11-09 / 2026-11-10 fix-sandbox-memory-cap: a control that depends on a runtime-only fact needs a stated owner. When a design claims a change "closes" a findings row, the adversary must trace the exact code path, and any snippet described in prose must be pasted verbatim into design.md.
   - fails 2026-10-07 indicators-sandbox-os-isolation: the real setuid, seccomp and rlimit stack has no runtime-image CI validation, so the mechanism must be verifiable by the existing real-subprocess tests.
9. **Docs to update in the same PR:**
   - `services/xstockstrat-indicators/docs/context-constitution.md:41` (the "fixed contract" row)
   - `services/xstockstrat-indicators/docs/context-constitution-findings.md:22-23` (open questions on stderr classification and `memory_used_bytes`) and the report link row ~`:63`
   - `services/xstockstrat-indicators/CLAUDE.md` § "Sandbox Security Model" (`:117`) and the "No-output failure (feature 268)" bullet (`:217`)
   - the report sidecars under `docs/reports/`
10. **Consumer surfaces (C-14).** Neither the UI nor the agent reads `memory_used_bytes` today. The design must decide whether `/insights` `FormulaRunResult.tsx` and the agent `test_formula` docstring should surface the field now that it is real, or explicitly record them as pass-through with no change. An unchanged surface has to be justified, not left implicit.
11. **Not verified.** The digests carried no checkout stamp. This recon re-grepped the cited lines at `origin/main-dev@c4fd48b0`. `app/client.py` line numbers and `useFormulas.ts`/`insightsBff.ts` internals are digest-cited and were not re-opened.

## Recommended Scope

This is advisory input to the debate and to `/sdd-spec`, not binding.

1. **Missing `result` (AC-3, AC-4).**
   - Change the wrapper so that a missing `result` emits a distinct signal and the parent turns it into `_fail("formula did not assign result", "runtime_error")`. An explicit `{}` still succeeds.
   - Add RED tests beside `TestSandboxNoOutputFails`.
   - Complete the implicit-`{}` enumeration first (risk 5).
2. **Structural exit-reason (AC-1).**
   - The design picks the mechanism and resolves OQ3 and the OpenBLAS CHANGE with the operator.
   - Replace `:809`/`:811` while keeping the `:813` counter branch and the closed telemetry label set.
   - Add a RED test for `raise ValueError("is not allowed in sandbox")`, which must give `runtime_error`.
3. **Measure `memory_used_bytes` (AC-2).**
   - Use a per-run source chosen in design and populate it on every return path that can measure. Keep the dataclass signature stable so the existing fakes still construct.
   - Add a RED test that `numpy.zeros(10_000_000)` gives `> 0`, plus one through the servicer response.
4. **Consumer surfaces and docs.** Settle the C-14 decision for `/insights` and agent `test_formula` (risk 10), update the per-module constitution, findings and service `CLAUDE.md` rows, and promote AC-1 to AC-4 with `@feature-310` into `services/xstockstrat-indicators/acceptance/` (C-16).
