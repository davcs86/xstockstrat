# Recon: fix-sandbox-memory-cap

**Created**: 2026-11-09
**From**: product-spec.md
**Tree**: feature/fix-sandbox-memory-cap@be9686b ≡ origin/feature/fix-sandbox-memory-cap
**Affected services**: xstockstrat-indicators (consumer surfaces named, no change: xstockstrat-agent `test_formula`, xstockstrat-ui `/insights` formula test runs)

---

## Objective

The indicators formula sandbox caps a child's memory with `RLIMIT_DATA` (measured pre-lockdown `VmData` baseline + `indicators.sandbox.memory_bytes` headroom), but on DigitalOcean App Platform the kernel accepts and does not enforce it, so a 400 MiB formula returns `SUCCESS`. Add a runtime-independent kill path (FR-1, must work on DO and the homelab compose stack) reporting `memory_exceeded`, and a parent-side startup probe (FR-2) that logs an ERROR, sets an OTel gauge, and keeps serving.

## Codebase Map

- **`xstockstrat-indicators`** (Python 3.13)
  - Entry point: `services/xstockstrat-indicators/app/main.py` `serve()`: `init_telemetry()` `:43` → config snapshot `:47-48` → DB pool `:51-59` → `seed_default_formulas` `:62` (non-fatal pattern) → servicer `:64-71` → `grpc_server.start()` `:85`. Probe slot: after `:43`, before `:85`.
  - Handler/servicer: `app/handlers/servicer.py` `ExecuteFormula` `:243`; `_clamp_override` `:75-77`; `_run()` closure `:317-348` calls `sandbox.execute_formula` `:339-348` in a worker thread via `run_bounded` `:350`; exit_reason→proto map `:362-368`; `record_sandbox_execution` `:383`; WARN log `:384-389`.
  - Sandbox: `app/services/sandbox.py`
    - `execute_formula(...)` `:327-336`; derived limits `:347-349`; wrapper format `:351-364`.
    - Spawn `:369-377`: `Popen([sys.executable, "-"], stdin/stdout/stderr=PIPE, env=_sandbox_env(), start_new_session=True)`, no `preexec_fn`.
    - Wait `:380`: `proc.communicate(input=wrapped, timeout=deadline_ms/1000)`: buffered, no poll loop. Hook point is between `:369` and `:380`.
    - Timeout path `:381-393`: `_killpg(proc)`, reap, `SandboxResult(exit_reason="timeout")`. `_killpg` `:315-324` uses `os.getpgid(proc.pid)` and `finally: _killpg(proc)` `:443-445` (no-op after reap).
    - Classification `:414-424`: stderr substring only (`_MEMORY_EXHAUSTED_MARKERS` `:201`). A SIGKILLed child (`returncode == -9`, no marker) would fall to `runtime_error` / "formula produced no output" (`:426-427`).
    - `SandboxResult` `:188-197`; `memory_used_bytes=0` hardcoded at `:390,404,439`.
    - Child wrapper order (load-bearing) `:225-306`: eager imports → tempfile pre-cache `:261-262` → setuid 65534 `:267-270` → `NO_NEW_PRIVS` `:273` → `import pyseccomp` `:276` → baseline probe `_VMDATA_PROBE` `:61-64` (`:280`) → `RLIMIT_DATA` `:281-283` → CPU/NPROC/FSIZE/NOFILE `:284-287` → `json.loads` `:290-291` → seccomp `.load()` `:301` → `exec` `:306`.
    - Seccomp allowlist `_SECCOMP_ALLOW` `:71-122` has no `open`/`openat`, `ptrace` or `process_vm_*`: the child cannot read `/proc`; any monitor is parent-side.
  - Config-read pattern: `app/config/watcher.py:89-90` `sandbox_memory_bytes` → `int_positive(self, "indicators.sandbox.memory_bytes", 128 * 1024 * 1024)`; neighbours `:85-103`.
  - Telemetry: `app/telemetry.py` `_METER_NAME` `:214`; `Gauge` observable wrapper `:290`; the only gauge today is `indicators.config.snapshot_age` `:360-365`, registered by `register_snapshot_age` `:390-395` (called from `watcher.py:62`); sandbox instruments `:330-338`; `KEY_EXIT_REASON` `:326`; `record_sandbox_execution` `:368-372`.
  - Last migration: none (no DB change).

## Patterns to REUSE

- FR-2 gauge → reuse the module-level source var + `_observe_*` + `Gauge` + `register_*()` pattern of `indicators.config.snapshot_age` (`app/telemetry.py:360-365,390-395`); name it `indicators.sandbox.*` per `:330-338`.
- FR-2 non-fatal startup → reuse the `seed_default_formulas` non-fatal pattern (`app/main.py:62`, indicators `CLAUDE.md` § Seeded Formulas).
- FR-1 kill → reuse `start_new_session=True` + `os.killpg(SIGKILL)` teardown (`sandbox.py:369-377,315-324`; INDICATORS-9). Fix the `getpgid`-after-reap caveat by killing before reap with `os.killpg(proc.pid, ...)`.
- FR-1 reporting → reuse `SandboxResult.exit_reason="memory_exceeded"` (`sandbox.py:188-197`) so the servicer map (`servicer.py:362-368`), `record_sandbox_execution` and the WARN log need no change.
- Baseline semantics → reuse the measured-baseline-plus-headroom definition (INDICATORS-2; insights 2026-11-04 `fix-indicators-sandbox-matrix`): any watchdog threshold is growth above the same baseline, never absolute RSS.
- Threshold source → `watcher.sandbox_memory_bytes` through `int_positive` (`watcher.py:89-90`); no new config key.
- Parent-side `/proc/<pid>/status` read → stdlib only. psutil is absent (`pyproject.toml`, `uv.lock`); adding it forces `uv lock` in the same PR.
- Tests → reuse `_fake_popen` (`tests/test_sandbox_isolation.py:65-74`), `FakeProc` + `_killpg` monkeypatch (`tests/test_sandbox.py:22-32`), `otel_reset` (`tests/conftest.py:189-221`) and `metric_reader` (`tests/test_telemetry.py:133`). C-13: Python home is `tests/conftest.py`.

## Existing Business Rules (preserve / extend)

Folded from `scenario-recon` (11 suites read, `platform.feature` in full). **No CHANGE verdicts.**
- **PRESERVE** `@AC-2 @FR-2 @regression @feature-228` "An allocation beyond the headroom fails closed" (`services/xstockstrat-indicators/acceptance/fix-indicators-sandbox-matrix.feature`) — 32 MiB under 16 MiB headroom → `memory_exceeded` on an enforcing kernel; the new path gives the identical result.
- **PRESERVE** `@AC-1 @FR-1 @regression @feature-228` "The 800x800 matmul fits within half the default headroom" (same file) — legitimate BLAS workload (trace 641260.869, rank 50) must not be falsely killed: the main false-positive guard.
- **PRESERVE** `@AC-3 @FR-1 @regression @feature-228` "The formula budget does not depend on the interpreter's import footprint" (same file) — headroom is above the child's pre-lockdown baseline.
- **PRESERVE** `@AC-4 @FR-2 @regression @feature-228` (same file) — OpenBLAS exit-1 stderr still classifies `memory_exceeded`.
- **PRESERVE** `@AC-5 @FR-3 @regression @feature-228` (same file) — failed child baseline probe → formula never runs, `runtime_error`; distinct from the FR-2 parent probe, which fails open.
- **EXTEND** `@AC-3 @FR-3 @feature-209` "An infinite-loop / memory-bomb formula is terminated deterministically" (`services/xstockstrat-indicators/acceptance/indicators-sandbox-os-isolation.feature:29`) — adds a runtime-independent kill beside RLIMIT. Wording drift ("address-space", "terminated at its RLIMIT"); durable-suite text is not hand-edited (C-16).
- **PRESERVE** `@AC-5 @FR-3 @feature-209` (same file) — NPROC fork-bomb cap and responsiveness; a monitor must not consume NPROC slots or break `killpg` teardown.
- **PRESERVE** `@AC-1 @FR-1 @FR-2`, `@AC-2 @FR-2`, `@AC-4 @FR-4`, `@AC-6 @FR-5` `@feature-209` (same file) — no network, no secrets/file reads, identical RSI-14 result, limits from config. Seccomp allowlist and UID drop are not weakened; `/proc` inspection stays in the parent.
- **PRESERVE** `@AC-5 @FR-5 @feature-176` (`analysis-concurrency-offload.feature`) — up to `max_concurrent`=4 concurrent off-loop executions; a per-child monitor must not serialize them.
- **PRESERVE** `@AC-6 @FR-7`, `@AC-18 @FR-12`, `@AC-38 @FR-12` `@feature-295` (`fix-config-keys-drift.feature`) — live concurrency shrink; timeout + grace honoured; timeout clamped to remaining deadline (<100 ms → no spawn).
- **EXTEND** `@AC-37 @FR-12 @feature-294` (`signal-map-instrumentation.feature`) — a watchdog kill is counted as `memory_exceeded` through the same executions/duration instruments and WARN, RPC status OK; the new gauge is additive.
- **PRESERVE** `@AC-1 @FR-1`, `@AC-2 @FR-1` `@feature-268` (`fix-indicators-formula-correctness.feature`) — no/unparseable marker → non-SUCCESS; a SIGKILLed child must classify `memory_exceeded`, not "produced no output" (classifier ordering).
- **PRESERVE** `@AC-1 @FR-1`, `@AC-3 @FR-3` `@feature-243` (`services/xstockstrat-config/acceptance/fix-sandbox-seed-keys.feature`) and `@AC-6 @FR-3 @feature-244` (`docs/sdd/business-rules/platform.feature`) — `memory_bytes` seeded 134217728 (int), stored 0 → default; row description must not say "memory cap". Headroom semantics are out of scope.
- **PRESERVE** `@AC-41 @FR-15`, `@AC-42 @FR-15` `@feature-294`, `@AC-8`/`@AC-17 @FR-6 @feature-274` (`platform.feature`) — no identifier labels; telemetry no-op when disabled and never blocks startup; `scripts/check-otel-produced-signals.sh` stays green if an alert/dashboard queries the new gauge.
- **PRESERVE** `@AC-5 @FR-5 @feature-205` (`services/xstockstrat-agent/acceptance/formula-fundamental-inputs-authoring.feature`) — `test_formula` response shape unchanged.
- `xstockstrat-ui`: no existing acceptance rule touches formula test runs or the sandbox.
- If design relocates the OOM decision to something that cannot honour headroom-above-baseline (container limit, absolute RSS), `@AC-1`/`@AC-3 @feature-228` flip to **CHANGE** and need explicit sign-off in `context.md`.

## Dependencies

- Proto/RPC: none. `memory_used_bytes = 6` (`packages/proto/indicators/v1/indicators.proto:95`) already exists and is hardcoded 0.
- Migration: none.
- Config keys: existing `indicators.sandbox.memory_bytes` (seeds `services/xstockstrat-config/migrations/031_…:58,62,80`, `041_…:126`; reader `watcher.py:sandbox_memory_bytes`). None new; any new key needs the full C-05 contract.
- Inter-service edges: none new. `execute_formula` has one production caller, `servicer.py:339`; analysis and agent reach it over gRPC only.
- New env vars / ports: none.
- Runtime: `services/xstockstrat-indicators/Dockerfile` (`python:3.13-slim`, no `USER`, so root parent / uid 65534 child, no procps/psutil). Neither `docker-compose.yml:298-331`, `deploy/homelab/compose.yml:159-176`, nor `.do/app*.yaml:188-230` (`basic-s`) sets a memory limit, `runtime:`, `security_opt` or `hidepid`.
- Sibling feature: draft 304 respells the same `indicators.sandbox.*` reads in `watcher.py` / `sandbox.py` (soft overlap).

## Risks / Not-found

- **Not found:** any parent-side poll loop, `VmRSS`/`VmData` read of the child, or memory accounting; any RLIMIT-enforcement probe; any `uname`/`/proc/version` logging; any enforcement gauge; any test seam faking a runtime that ignores `RLIMIT_DATA` (WARN-2: impl-spec must define one — CI kernels enforce it); the DO and homelab kernel/runtime flavor; confirmation that a root parent can read the nobody child's `/proc/<pid>/status` on either runtime (unverifiable here).
- **Baseline is child-private:** it is measured in the child at `sandbox.py:280` and never exposed to the parent. A parent watchdog needs the baseline emitted to the parent or its own equivalent measurement (design decision).
- **`communicate()` is a blocking buffered call** (`:380`); a poller needs a thread or loop beside it, and `FakeProc`/`_fake_popen` fakes implement only `communicate`/`pid`/`returncode` (would need `poll`/`wait`). Break-radius: 12 test files construct `SandboxResult`; `tests/test_sandbox_isolation.py:353-384` asserts wrapper text and ordering, so editing the `RLIMIT_DATA` wrapper text breaks it.
- **Kill classification:** a parent kill leaves no stderr/marker; `memory_exceeded` must be set from the parent's own kill flag before the `:426-427` path.
- **`/proc` fidelity under a userspace kernel:** if DO is gVisor-like, `VmData`/`VmRSS` in `/proc/<pid>/status` may be coarse or absent; the FR-2 log line is how this gets answered (deferred O-3).
- **Wall budget:** `agent` `formula_deadline_s()` (timeout + grace + 2 s) and 295 `@AC-38` clamp need rechecking only if the kill path lengthens the wall time.
- **`fails.md` traps:** 2026-10-07 `indicators-sandbox-os-isolation` — security control only verifiable in the runtime image needs an owned follow-up (the same unverified-runtime gap that caused this bug); write the negative test as a real over-limit allocation, not a structural check. 2026-11-04 `fix-indicators-sandbox-matrix` — Track C template/C-14 drift (already handled). 2026-10-14 `proto-deprecated-field-removal-program` — after a design-gate steer, reconcile product-spec, acceptance and `feature.md` in the same session.
- **Adjacent open defects** (`services/xstockstrat-indicators/docs/context-constitution-findings.md:21,22,31`; reports `2026-10-19-sandbox-memory-used-bytes-always-zero-defect.md`, `2026-10-19-sandbox-exit-reason-stderr-substring-defect.md`): `memory_used_bytes` hardcoded 0, stderr-substring classifier, `RLIMIT_NPROC` recomputed per call. Out of scope unless design says otherwise.
- **Docs to update with the change:** indicators `CLAUDE.md` (§ Sandbox Security Model, § Observability) and `docs/context-constitution.md` INDICATORS-2/9 (anchors will drift).

## Recommended Scope

Advisory, three steps for `/sdd-spec`:
1. Startup probe (FR-2): parent-side RLIMIT-enforcement test + `uname`/`/proc/version` log + gauge + non-fatal wiring in `app/main.py`, with a test seam that fakes a non-enforcing runtime. Ships first so the next staging deploy answers O-3.
2. Parent-side watchdog (FR-1): baseline handoff, poller beside `communicate`, kill-before-reap, `memory_exceeded` from the kill flag, telemetry via existing instruments.
3. Docs and smoke: indicators `CLAUDE.md` / INDICATORS-* updates, soft merge-order row vs 304, post-deploy staging smoke (400 MiB → `memory_exceeded`, 800×800 matmul still passes).
