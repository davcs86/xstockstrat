# Design: fix-sandbox-result-contract

**Created**: 2026-11-20
**Rounds**: 3 (full; termination: approved)
**Approved by**: user @ 2026-11-20 (operator approval at the design gate; operator decisions O-1, O-3, O-4 recorded in context.md, Session 2026-11-20)
**Grounded in**: recon.md
**Debate register**: debate.md (D-1..D-14 settled, R-1..R-12 locked, no reopen petitions)

---

## Chosen Approach

Line citations are the `path:line` values recorded in recon.md § Codebase Map at
`origin/main-dev@c4fd48b0`, unless marked "(debate.md)". A "(debate.md)" citation is register
evidence that recon.md did not capture; `/sdd-spec` must re-grep it before planning against it (F-04).

All service code changes are in `services/xstockstrat-indicators/app/services/sandbox.py` and
`app/services/sandbox_probe.py`. The servicer, telemetry label set, proto and the `SandboxResult`
dataclass signature (`sandbox.py:531-540`) do not change.

### 1. Failure class — per-run nonce status line (D-1, D-2, D-4, D-5, D-6, D-7, D-11)

- **Channel.** The parent generates `nonce = secrets.token_hex(16)` per run in `execute_formula`
  (`sandbox.py:670`) and passes it into the `_SANDBOX_WRAPPER` `.format()` template. The child
  reports its outcome as one nonce-tagged status line on stdout. There is no second `pass_fds` pipe
  (R-3) and no exit-code scheme (R-4).
- **Wrapper (child).**
  - `class _ImportBlocked(ImportError)`; `_safe_import` (`sandbox.py:562`) raises it.
  - `exec({source!r}, _formula_globals)` (`sandbox.py:647`) and the `json.dumps` of the output
    (`sandbox.py:651-652`) run inside one `try`. Each handler calls `_status(kind)` and then does a
    bare `raise`: `except _ImportBlocked` → `import_blocked`; `except MemoryError` →
    `memory_exceeded`; `except BaseException` → `raised`.
  - `_status(kind)` is defined after `_flt.load()` (just before `sandbox.py:645`). It is total: its
    body is wrapped in `try/except BaseException: pass`, so it never raises and never replaces the
    in-flight exception (D-6). It prints the status line with `print(..., flush=True)`, not
    `os.write`, with a leading `"\n"`.
  - A status line is not required for success. The parsed `__OUTPUT__` marker stays the positive
    artifact (D-4), which keeps the mocked-Popen fakes valid.
- **Parent.**
  - `_split_status` removes the matched status line and the one injected newline before it, so
    `SandboxResult.stdout` is byte-identical to the formula's own output and the nonce never reaches
    it (D-5, D-11; the UI renders stdout at `FormulaRunResult.tsx:92-98` (debate.md)). It is applied
    at the watchdog-kill return (`sandbox.py:770` path), right after `communicate` before the first
    `_fail` (`sandbox.py:787`), and at the success return (`sandbox.py:834`). The timeout path
    (`sandbox.py:780`) keeps `stdout=""`.
  - For `returncode != 0`, the stderr classification at `sandbox.py:807-819` is replaced with this
    classifier, verbatim (D-7):

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

  - The `"is not allowed in sandbox" in stderr` test (`sandbox.py:809`) is deleted. The
    `_MEMORY_EXHAUSTED_MARKERS` check (`sandbox.py:544`, `:811`) survives only as step 4, the
    no-status fallback, after the `-SIGKILL` + `_oom_kill_rose` counter step (`sandbox.py:813`).
    The fallback error text (`formula exited with code … before producing output`) is unchanged.
- **OQ3 ruling (operator decision O-3, 2026-11-20).** "Stderr-substring failure classification is
  NOT a fixed contract. It is replaced by the per-run nonce status line (D-1). The
  `_MEMORY_EXHAUSTED_MARKERS` stderr check survives only as the no-status fallback (D-2/D-7 step 4),
  which keeps 228@AC-4." This ruling unblocks the edit to
  `services/xstockstrat-indicators/docs/context-constitution.md:41`.
- **Accepted residuals (operator decision O-4, 2026-11-20).** A formula can still mis-tag its own
  run, and only its own run, by: frame traversal to the nonce or to `_ImportBlocked`;
  `raise MemoryError()`; writing `MemoryError` to stderr then `os._exit(1)`; printing an obtained
  nonce then `os._exit`; closing `_ms`, which reports 0. These are accepted.

### 2. Missing `result` (D-3)

- The wrapper tests key presence at the current `.get('result', {})` site (`sandbox.py:651`).
  `'result' in _formula_globals` → print the `__OUTPUT__` marker, then `_status('ok')`. Otherwise →
  `_status('no_result')` and no marker.
- The parent returns `_fail("formula did not assign result", "runtime_error")` when
  `status == "no_result"`, placed before the feature-268 no-output checks (`sandbox.py:821-826`),
  which are unchanged. `result = {}` still succeeds.
- The declared-output wording change to "formula did not assign result" is deliberate. It stays
  `runtime_error`, and no promoted scenario pins the old text (O-7).

### 3. `memory_used_bytes` (operator decision O-1, 2026-11-20; D-8, D-10, D-12)

- **Definition (O-1).** `memory_used_bytes` is the **total leader VmHWM**: the peak RSS of the
  sandboxed child over its whole life, including the interpreter and the pre-imported modules.
  **0 means "not measured"**. The HWM-delta runner-up was not chosen.
- **Source.** The wrapper opens `_ms = os.open('/proc/self/status', os.O_RDONLY)` after the UID drop
  and the VmData probe and before `_flt.load()`; the fd is not in `pass_fds`. `_status` does
  `lseek(0)` + `read(8192)` on it, parses `VmHWM:` × 1024, and reports 0 on any failure. The figure
  travels on the status line.
- **Per return path** (the four `memory_used_bytes=0` sites, `sandbox.py:770`, `:780`, `:794`,
  `:834`): the measured value wherever a status line reached the parent; 0 on timeout, watchdog
  kill, signal, C-level abort and `os._exit`. So most `memory_exceeded` outcomes report 0.
- One quantity on every path: no VmRSS fallback (R-7), no watchdog `peak_resident`
  (`sandbox.py:344`, `:450`) mixed in (R-2), no `getrusage` (R-1).
- **Caveat that the docs must carry.** `sandbox.memory_bytes` is headroom above the measured
  baseline, so the total is not "how much of the cap is used".
- **Proto.** `packages/proto/indicators/v1/indicators.proto:95` is not edited (D-8).

### 4. Runtime-fact owner — boot self-test (D-12, realising D-10)

- Add `_self_test()` in `app/services/sandbox_probe.py`. It calls
  `sandbox.execute_formula("result = {}", {}, [])` with the function's own defaults
  (`sandbox.py:670-679` (debate.md)), so it needs no config key and no new literal.
- `run_startup_probe` (`sandbox_probe.py:309-320` (debate.md)) calls it in its own
  `try/except Exception`, independent of `_probe()`. The early `return` at `:315-317` (debate.md)
  must not skip it. The never-raise contract holds.
- It logs one INFO line, `sandbox memory self-test exit_reason=%s memory_measured=%d`. It logs ERROR
  `sandbox memory_used_bytes unmeasurable on this runtime` when `exit_reason != "success"`, when
  `memory_used_bytes <= 0`, or (with the exception) when `_self_test` raises.
- This runs setuid, seccomp, the `_ms` read, the status parse and the classifier on the actual
  runtime kernel before any user code. No per-run ERROR, no presence-only leg, no new gauge
  (R-10, R-11, R-12). The dev two-run smoke stays advisory.

### 5. Consumer surfaces (C-14)

- **xstockstrat-agent `test_formula`.** The docstring (`app/tools.py` ~`:1687-1689`) gains
  `memory_used_bytes` with a condensed definition. The field is already returned.
- **xstockstrat-ui `/insights`.** No code change. The new failure classes and the missing-`result`
  error render through the existing exit and error path (`FormulaRunResult.tsx:64`); the UI never
  displayed memory. **There is no operator decision on O-5**; the "surface unchanged, justified"
  framing is a recommendation only and is carried as an Open Risk below.

### 6. Acceptance and tests (D-9, D-13)

- `acceptance.feature:14-18` (@AC-2) is replaced verbatim with:

  ```gherkin
    @AC-2 @regression
    Scenario: memory_used_bytes is a real per-run peak, not a fabricated or inherited figure
      Given the runtime renders a VmHWM line in /proc/self/status
      And run A is an ExecuteFormula request with formula_source "result = {}"
      And run B is an ExecuteFormula request with formula_source:
        """
        import numpy
        a = numpy.ones(10_000_000)
        result = {"s": float(a[0])}
        """
      When the sandbox runs A and then B
      Then A's memory_used_bytes is greater than 0
      And B's memory_used_bytes exceeds A's by at least 41943040
  ```

- RED tests, real subprocess through the service venv (recon.md Risks 8):
  - the two-run AC-2 comparison;
  - AC-1 `raise ValueError("is not allowed in sandbox")` → `runtime_error`;
  - AC-3 and AC-4;
  - `test_blocked_import` still → `import_blocked`;
  - a `MemoryError` inside `json.dumps` → `memory_exceeded`;
  - the nonce is never in `res.stdout`, and stdout is byte-identical to the formula's prints;
  - a fake with a status line plus `-SIGKILL` plus oom-rose → `memory_exceeded`;
  - a servicer-level `memory_used_bytes > 0`;
  - in `tests/test_sandbox_probe.py`: the self-test INFO line has `memory_measured>0` on the CI
    kernel, and a monkeypatched `execute_formula` returning `memory_used_bytes=0` gives exactly one
    ERROR.

### 7. Docs (D-8, D-14)

- Service `CLAUDE.md` § Sandbox Security Model and the agent docstring state: baseline included;
  0 = not measured on timeout / watchdog kill / signal / abort / `os._exit`, so most
  `memory_exceeded` report 0; grandchildren not counted; total is not cap usage.
- `services/xstockstrat-indicators/docs/context-constitution-findings.md:23` and the report-2
  sidecar are marked "resolved where the boot self-test logs memory_measured>0; DO confirmation
  pending the first post-deploy boot log". The `/sdd-execute` integration PR author records that
  boot log line (or the ERROR) in `context.md` at promotion.
- `context-constitution.md:41`, findings `:22` and the report link row ~`:63`, the service
  `CLAUDE.md` "No-output failure (feature 268)" bullet, and the report sidecars are updated in the
  same PR (recon.md Risks 9).

### 8. Build order

1. Implicit-`{}` enumeration, plus the operator check of dev/prod `indicators.formulas`.
2. RED tests.
3. Wrapper changes.
4. Parent changes.
5. Boot self-test.
6. Docs.
7. Promote the scenarios with `@feature-310`.

## Rejected Alternatives

- `R-1` Child-side `getrusage(RUSAGE_SELF)` `ru_maxrss` as the memory source — rejected because rusage survives `execve` and folds the spawner's high-water mark into the value.
- `R-2` Reporting `max(child RSS figure, watchdog peak_resident)` — rejected because one field would mean different things on different paths.
- `R-3` Second `pass_fds` pipe as the status channel — rejected because it breaks the feature-300 descriptor-scope tests and is no harder to forge post-exec.
- `R-4` Distinct exit codes per failure class — rejected because they collide with `SystemExit(n)` / `os._exit(n)` / C-level abort exit 1 and cannot carry the memory figure.
- `R-5` Absolute-threshold-only memory RED test — rejected because it cannot tell a correct measurement from an inherited or baseline figure.
- `R-6` Classifier with "any status → runtime_error" ahead of the `-SIGKILL` + oom-rise step — rejected because it demotes kernel OOM counter evidence and regresses 300@AC-5.
- `R-7` VmRSS fallback when VmHWM is absent — rejected because the field would mean peak on one path and current on another.
- `R-8` Field comment on `indicators.proto:95` — rejected because it triggers stub regeneration and proto governance for documentation carried elsewhere.
- `R-9` AC-2 two-run threshold of 70 MiB — rejected because about 6 MiB of margin against import transients makes it flaky; 40 MiB still discriminates.
- `R-10` Startup VmHWM-presence leg reading the probe child's `/proc` status — rejected because the probe child loads no seccomp and never does the `_ms` read, so it checks only that the field exists; it also duplicates the `_try_sample` read.
- `R-11` Per-run once-per-process ERROR when a status-bearing run measures 0 — rejected because it is user-triggerable and latched, fires only after the first user run, and cannot separate a runtime defect from user action.
- `R-12` Per-run label-free `memory_measured` gauge — rejected because any formula drives it to 0 on its own run, and it adds a per-run telemetry write for a one-time runtime fact.

## Open Risks

- [ ] `acceptance.feature` @AC-2 still holds the old `numpy.zeros > 0` text; the §6 replacement is not yet applied — to be addressed before `/sdd-spec` traces scenarios (first `/sdd-spec` action).
- [ ] C-14 sign-off (O-5) is not recorded. The UI is planned unchanged, but the operator has not confirmed "surface unchanged, justified" or named a follow-up feature — to be addressed by an operator answer before the `/sdd-spec` consumer-surface step.
- [ ] The verbatim wrapper block (proposal r2) and the verbatim round-3 definition text were not persisted in the register; this design records their binding properties only — `/sdd-spec` writes the exact text against D-1/D-3/D-6/D-11 and the O-10 closure (ledger fails 2026-11-09/10).
- [ ] On DO App Platform the child's `_ms` read under seccomp may fail or render no VmHWM, so every run would report 0. The boot self-test makes this loud at startup but does not prevent it; CI proves the mechanism only on the CI kernel — to be addressed at the integration PR (record the first post-deploy boot log line in context.md).
- [ ] The boot self-test adds one sandbox child at startup with the watchdog armed at the 128 MiB default. Confirm `execute_formula` needs no config snapshot at probe time, emits no per-run telemetry a boot run would pollute, and keeps boot latency acceptable — to be addressed at `/sdd-spec` (boot self-test step).
- [ ] Total VmHWM includes the interpreter and eager-import baseline, so small formulas report tens of MB (operator chose the total in O-1) — mitigated by the docs step.
- [ ] VmHWM covers the leader only; grandchildren forked under RLIMIT_NPROC are under-measured — documented at the docs step.
- [ ] Under memory pressure `_status` may fail to print; classification then falls to the stderr-marker fallback and AC-3 wording to the generic "produced no output" — to be covered by a test at the parent-changes step.
- [ ] Implicit-`{}` reliance (recon.md Risks 5): the 9 template seed rows each assign `result` (adversary-verified), but saved user rows in dev/prod `indicators.formulas` need the operator DB check (OQ1), and tests, the UI default source and e2e fixtures need enumeration — to be addressed at build step 1.
- [ ] Mocked-Popen fakes (`tests/test_sandbox_isolation.py:65`, `:225-239`) emit no status line and pass only through D-4 and the no-status fallback — to be kept green at the parent-changes step.

## Constitution Rules Touched

- `P-02` — honored by: proposer and adversary exchanged only orchestrator-synthesized state across the 3 rounds.
- `P-03` — honored by: O-1, O-3 and O-4 were surfaced to the operator and decided on 2026-11-20, not assumed; O-5 and the missing verbatim texts are listed as open, not guessed.
- `P-06` — honored by: RED tests (§6) precede the wrapper and parent changes in the build order.
- `C-09` — honored by: no `.proto` edit (D-8), so no `buf` or stub regeneration step.
- `C-11` — honored by: full-mode design debate with recon before any code.
- `C-13` — honored by: new tests reuse the service's existing `execute_formula` real-subprocess harness and fixture home; `/sdd-spec` names the home per test step.
- `C-14` — partially honored: the agent `test_formula` docstring is in scope; the `/insights` no-change decision awaits operator sign-off (Open Risks).
- `C-15` — honored by: every `@AC-1..4` scenario maps to a RED test in §6; @AC-2 is rewritten to match its test.
- `C-16` — honored by: no promoted guarantee is changed (see below).
- `C-18` — honored by: one status channel, one memory quantity, no second `/proc` read path in the probe, no new gauge.
- `F-01` — honored: no migration.
- `F-04` — honored: citations come from recon.md or the register; "(debate.md)" lines are flagged for re-grep.
- `F-06` — honored: no pool change.
- `F-07` — honored: no new config value or literal; the self-test uses `execute_formula`'s defaults and the nonce comes from `secrets`.

No Floor breach (F-11 clear).

## Business Rules Touched (C-16)

No CHANGE line: no existing guarantee is altered, so no CHANGE sign-off is required. The one
candidate CHANGE (recon.md Risks 2, dropping stderr detection for the OpenBLAS abort) is avoided by
D-2/D-7 step 4 and confirmed by operator decision O-3 (context.md, Session 2026-11-20).

- PRESERVE `@AC-4` "An OpenBLAS allocation abort is classified as out-of-memory" (`services/xstockstrat-indicators/acceptance/fix-indicators-sandbox-matrix.feature`, @feature-228) — not regressed by: the no-status `_MEMORY_EXHAUSTED_MARKERS` fallback (classifier step 4); operator decision O-3.
- PRESERVE `@AC-5` "A SIGKILLed child is attributed by evidence" (`services/xstockstrat-indicators/acceptance/fix-sandbox-memory-cap.feature`, @feature-300) — not regressed by: the `-SIGKILL` + `_oom_kill_rose` step ranking above any non-specific status (D-7, R-6); error text unchanged.
- PRESERVE `@AC-12` "The arming handoff cannot be forged or inherited by a concurrent run" (same file, @feature-300) — not regressed by: the handoff pipe is untouched; the status line uses a per-run nonce and no new descriptor.
- PRESERVE `@AC-1` "A formula that exits before producing output is reported as a failure" (`services/xstockstrat-indicators/acceptance/fix-indicators-formula-correctness.feature`, @feature-268) — not regressed by: the "produced no output" check and text are unchanged; `no_result` is handled before it as a separate case.
- PRESERVE `@AC-2` "A formula whose only output line does not parse is reported as a failure" (same file, @feature-268) — not regressed by: the unparseable-marker check is unchanged.
- PRESERVE `@AC-3` "A formula that assigns result still succeeds" (same file, @feature-268) — not regressed by: key-presence detection; a status line is not required for success (D-4).
- PRESERVE `@AC-37` "Every sandbox failure is counted although the RPC returns OK" (`services/xstockstrat-indicators/acceptance/signal-map-instrumentation.feature`, @feature-294) — not regressed by: missing `result` maps to the closed-set `runtime_error` label.
- EXTEND `@AC-1` (feature 310) "A formula exception carrying a guard message is classified as a runtime error" — new case added: guard-message text in a formula exception no longer yields `import_blocked`.
- EXTEND `@AC-2` (feature 310) "memory_used_bytes is a real per-run peak, not a fabricated or inherited figure" — new case added: two-run discriminating memory measurement, conditional on the runtime rendering VmHWM (operator decision O-1).
- EXTEND `@AC-3` (feature 310) "A formula that never assigns result fails with an explicit error" — new case added: sibling of 268@AC-1 for a run that completes without assigning `result`.
- EXTEND `@AC-4` (feature 310) "A formula that explicitly assigns an empty result still succeeds" — new case added: explicit `result = {}` succeeds.
