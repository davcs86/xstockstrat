# Recon Dossier: indicators-sandbox-os-isolation (feature 209)

_Phase 0 grounded dossier. Every claim is `path:line`-cited from the current tree
(`feature/indicators-sandbox-os-isolation` off `main-dev` f219918). Anything not found is in
`## Not Found`. Written by /sdd-design Phase 0._

## Objective (from product-spec)

Close the blast radius of the escapable in-process formula sandbox (audit C-3/DT-1) with **OS-level
isolation**: no outbound network, no filesystem write beyond scratch, dropped capabilities, and hard
RLIMIT CPU/mem/wall-clock — while preserving formula evaluation semantics (FR-4). Only
`xstockstrat-indicators` changes. Consumer surface: none (internal hardening).

## Codebase Map

### Sandbox mechanism — `services/xstockstrat-indicators/app/services/sandbox.py`
- Entry point: `execute_formula(source, input_data, allowed_imports, timeout_ms=5000,
  memory_bytes=128*1024*1024, params=None) -> SandboxResult` — `sandbox.py:175-182`.
- Child launch (no shell): `subprocess.run([sys.executable, script_path], capture_output=True,
  text=True, timeout=timeout_ms/1000, env=_sandbox_env())` — `sandbox.py:204-210`.
- `_sandbox_env()` — `sandbox.py:43-55`: returns only `{"PYTHONPATH": ..., **_THREAD_LIMIT_ENV}`;
  strips every inherited secret (DATABASE_URL, JWT_SECRET, CONFIG_SECRETS_ENCRYPTION_KEY,
  BROKER_ACCOUNTS_ENCRYPTION_KEY). This is the shipped **C-4** minimal-env mitigation.
- Resource limit: **single** `resource.setrlimit(resource.RLIMIT_DATA, (memory_bytes, memory_bytes))`
  in the child wrapper — `sandbox.py:127-128`. Deliberately RLIMIT_DATA not RLIMIT_AS (docstring
  `sandbox.py:121-126`). **Missing: RLIMIT_AS, RLIMIT_CPU, RLIMIT_NPROC, RLIMIT_FSIZE, RLIMIT_NOFILE.**
- Child wrapper string `_SANDBOX_WRAPPER` — `sandbox.py:116-172`: `_safe_import` import allow-list
  (`sandbox.py:131-138`), restricted builtins from `_SAFE_BUILTINS` (`sandbox.py:58-99,145-156`),
  `exec(source, {'__builtins__': _restricted_builtins, 'data': data, 'params': params})`
  (`sandbox.py:165-166`). **Runtime-only guard — no AST/static analysis.**
- Result: JSON via a `"__OUTPUT__:" + json.dumps(...)` stdout line — `sandbox.py:171`, parsed by
  parent — `sandbox.py:217-222`. `SandboxResult` dataclass (`sandbox.py:102-111`) with
  `exit_reason ∈ success|timeout|memory_exceeded|runtime_error|import_blocked`. **No exception
  raised**; timeout caught as `subprocess.TimeoutExpired` — `sandbox.py:252-263`.
- Source written to `tempfile.NamedTemporaryFile(suffix=".py", delete=False)` then `os.unlink` in
  `finally` — `sandbox.py:189-200,264-268`.

### Caller
- `IndicatorsServicer.ExecuteFormula` (the ONLY sandbox RPC) — `app/handlers/servicer.py:113`.
- Off-loop, semaphore-bounded: `async with self._sandbox_sem: await asyncio.to_thread(
  sandbox.execute_formula, ...)` — `servicer.py:170-179`; semaphore init from config —
  `servicer.py:61`; `exit_reason → SANDBOX_EXIT_REASON_*` proto map — `servicer.py:181-187`.
- `app/services/indicators_engine.py` does **not** call the sandbox (vectorized built-ins only).

### Config — `app/config/watcher.py` (WatchConfig stream, namespace `indicators`)
- `indicators.sandbox.timeout_ms` (int, default 5000) — `watcher.py:128-130`.
- `indicators.sandbox.memory_bytes` (int, default 134217728) — `watcher.py:132-134`.
- `indicators.sandbox.allowed_imports` (str, default `"numpy,pandas,math,statistics"`, comma-split;
  empty `""` denies all via `get_str_present`/`HasField`) — `watcher.py:136-141,94-102`.
- `indicators.sandbox.max_concurrent` (int, default 4) — `watcher.py:143-144`.
- Watcher built in `app/main.py:45` (`ConfigWatcher(namespace="indicators")`).

### Runtime — `services/xstockstrat-indicators/Dockerfile`
- `FROM python:3.13-slim` (`:1`), deps via `uv sync --frozen --no-dev` (`:6`), `CMD python -m
  app.main` (`:20-21`). **No `USER` directive → container runs as root.** No apt installs, no
  seccomp/`security_opt`/`cap_drop`/privileged/read-only-fs.
- `.do/app.yaml` indicators block (`:147-173`): image/ports/env only — **no `security_context`,
  `cap_add`, seccomp, or privileged fields** (DO App Platform managed PaaS does not expose them).

### Tests — `services/xstockstrat-indicators/tests/`
- `test_sandbox.py`: deny/escape/timeout/memory (`TestSandboxExecution`, `TestSandboxEnvIsolation`,
  `TestSandboxNumericLibraries` incl. `test_memory_cap_still_enforced:144`, `TestSandboxParams`).
- `test_execute_formula_concurrency.py`: semaphore/off-loop. `test_config_watcher.py:45-73`: empty
  `allowed_imports` denies all.
- Command (service CLAUDE.md): `uv run pytest --cov=app --cov-fail-under=50`. **⚠ `sandbox.py` is in
  the `[tool.coverage.run] omit` list (`pyproject.toml:40-46`) — security-bearing code is EXCLUDED
  from the coverage number** (fails.md:133 trap).
- `requires-python = ">=3.12"`; deps: grpcio, numpy, pandas, asyncpg, otel. **No pyseccomp/seccomp/
  python-prctl/nsjail present.**

## Patterns to REUSE (anti-duplication core)
- **Keep the subprocess model + `_sandbox_env()`** — it already severs secret inheritance (C-4).
  209 hardens the same child, it does not replace the marshalling/`SandboxResult`/exit_reason contract.
- **`resource.setrlimit` in the child wrapper** — the existing RLIMIT_DATA call site
  (`sandbox.py:127-128`) is exactly where the added RLIMITs (AS/CPU/NPROC/FSIZE/NOFILE) go.
- **ConfigWatcher accessors** (`watcher.py`) — add new `indicators.sandbox.*` tunables via the same
  `get_int`/`get_str_present` pattern (F-07); NEW leaf names only (existing keys are trunk).
- **exit_reason enum + proto map** (`servicer.py:181-187`) — a new deny outcome
  (e.g. `network_blocked`/`syscall_blocked`) extends this map rather than a new error channel.
- **The child wrapper string** is the single injection point for a seccomp install (before `exec`).

## Existing Business Rules (C-16 read side — PRESERVE guards)
- **PRESERVE** `@AC-5` "concurrent formula executions no longer serialized"
  (`services/xstockstrat-indicators/acceptance/analysis-concurrency-offload.feature`, feature-176) —
  off-loop concurrency bounded by `indicators.sandbox.max_concurrent` AND deterministic termination
  at `indicators.sandbox.timeout_ms`; both must survive (FR-3/FR-4).
- **PRESERVE** `@AC-4` "empty allowed_imports denies all imports, not the permissive default"
  (`.../fix-python-config-zero-trap.feature`, feature-173) — the import allow-list still governs; a
  rewrite must not restore the permissive default or drop the empty-deny.
- **PRESERVE** `@AC-7` "authored fundamentals formula behaves identically as a strategy component"
  (`docs/sdd/business-rules/platform.feature`, feature-205) — the concrete cross-service FR-4 numeric
  parity pin. (No pure "formula X → value Y" scenario exists in the indicators suites themselves, so
  this cross-cutting one is load-bearing.)
- No CHANGE flagged — FR-4 pins parity, so a silent regression of any of the three is itself a C-16
  violation.

## Dependencies / Risks
- **R1 (FR-4 parity — highest).** numpy/pandas rely on `mmap`, `mprotect`, `madvise`, `futex`, `brk`
  syscalls. A seccomp **allowlist** would break them; only a **denylist** (block network + exec
  families, allow the rest) preserves parity. Every mechanism must be validated against the existing
  `test_sandbox.py` numeric tests + a frozen-value golden (insights.md:922).
- **R2 (DO runtime).** `unshare(CLONE_NEWNET/NEWNS)` and nsjail/bubblewrap need `CAP_SYS_ADMIN` /
  userns / privileged — **not granted on DO App Platform**. Unprivileged levers that DO permits:
  seccomp-BPF via `prctl(PR_SET_NO_NEW_PRIVS)` then `seccomp()` (no CAP_SYS_ADMIN needed),
  `setrlimit`, a non-root `USER`, `TMPDIR` scratch, `RLIMIT_FSIZE` for write-bounding.
- **R3 (execute-sandbox verification, fails.md:369).** The CI/execute sandbox may lack Docker and
  cannot exercise real seccomp/container hardening at unit time. The impl spec MUST carry offline/
  structural verification (assert the filter installs + a denied syscall raises in a child) plus the
  real container check deferred to CI/deploy.
- **R4 (new dep + image).** libseccomp binding (`pyseccomp`) needs `libseccomp2` (apt) in the
  Dockerfile + a `uv.lock` update; or a raw `ctypes`/`prctl` seccomp install with no new dep (more
  code, no apt). Trade-off for the debate.
- **R5 (coverage omit, fails.md:133).** `sandbox.py` is excluded from coverage — a security change
  landing there is invisible to the 50% gate. The design should remove the omit or add an explicit
  covered test module so the new isolation is actually measured.
- **R6 (FS-write).** No mount caps ⇒ read-only bind is out; `RLIMIT_FSIZE=0` (or small) + a tmpfs
  `TMPDIR` scratch is the unprivileged write-bound. Verify numpy/pandas need no on-disk writes for
  pure compute (they should not).
- **R7 (no SIGKILL fallback).** Timeout relies solely on `subprocess.run(timeout=)`; a hardened child
  that ignores SIGTERM could linger — add an explicit process-group SIGKILL on timeout (FR-3).

## Recommended Scope (for the debate)
In-container, unprivileged hardening of the existing subprocess child: (a) seccomp-BPF **denylist**
(network + exec syscall families) installed in the child before `exec`, via `no_new_privs`;
(b) expanded `setrlimit` set (AS, CPU, NPROC, FSIZE, NOFILE) alongside the existing RLIMIT_DATA;
(c) non-root `USER` in the Dockerfile; (d) explicit SIGKILL-on-timeout; (e) new `indicators.sandbox.*`
tunables (F-07) with NEW leaf names; (f) remove the coverage omit / add measured tests. The jailer
(nsjail/gVisor) path is retained as a Rejected Alternative pending an operator decision to leave DO
App Platform. **The isolation-mechanism choice is the operator gate carried into Phase 1.**

## Not Found
- No `SIGKILL`/`os.kill`/`proc.kill()` explicit-kill path (timeout = `subprocess.run(timeout=)` only).
- No `TestFormula`/`EvaluateFormula` RPC — only `ExecuteFormula`.
- No seccomp/namespace/cap-drop/`no_new_privs`/nsjail/firejail/bubblewrap anywhere in the service.
- No `USER` directive in the Dockerfile (runs as root).
- No pyseccomp/seccomp/python-prctl/nsjail in `pyproject.toml`.
- No AST/static-analysis guard in the child (runtime builtins/import filtering only).
