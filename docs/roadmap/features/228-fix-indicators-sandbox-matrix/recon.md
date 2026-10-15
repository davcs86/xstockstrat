# Recon: fix-indicators-sandbox-matrix

**Created**: 2026-10-15
**From**: product-spec.md, defect report `docs/reports/2026-10-15-indicators-sandbox-blas-memory-flake-defect.md`
**Affected services**: xstockstrat-indicators (plus xstockstrat-config if a default or seed changes)

---

## Objective

The indicators formula sandbox caps memory with `RLIMIT_DATA = memory_bytes`. An 800×800 numpy matmul succeeds or
fails depending on the host (4 of 6 CI runs failed on identical code). The fix must make the cap's meaning
host-independent, keep over-cap formulas failing closed with `memory_exceeded`, and leave isolation intact.

## Measured facts (orchestrator, local; numpy 2.4.3 and pandas 3.0.1 from uv.lock, Python 3.12.3, 4-vCPU Xeon)

Each figure below is measured from a probe that loads numpy and pandas **before** calling `setrlimit` (the
sandbox's own order) and then bisects the cap:

| Probe | Minimum `RLIMIT_DATA` that passes |
|---|---|
| tiny Series(4) plus `rolling(2)` | **17 MiB** (served from already-mapped arenas) |
| 800×800 `a @ a.T`, `OPENBLAS_NUM_THREADS=1` | **116 MiB**, for every `OPENBLAS_CORETYPE` tried (auto, Haswell, SkylakeX, Zen, Cooperlake, SapphireRapids, Prescott) and every CPU affinity (1, 2 or 4 CPUs) |
| same matmul, threads **not** pinned | **237 MiB** |
| `MALLOC_ARENA_MAX=1` | no change (116 MiB) |

- **Import footprint:** `VmData` right after `import numpy, pandas` is **≈ 75–88 MiB**, depending on the process.
- **What the cap actually limits:** `RLIMIT_DATA` covers the **whole** private data segment, so the formula's real
  budget is `memory_bytes − import footprint`. At 128 MiB that leaves ≈ 12 MiB of headroom for the 800×800 case.
  The import footprint differs between hosts, Python builds and wheels, which explains the flake. The core type
  does **not** (the hypothesis in the defect report is refuted).
- **At 64 MiB:**

  | Series length | Result |
  |---|---|
  | 1 000 | ok |
  | 20 000 (0.16 MB) | `MemoryError` |
  | 100 000 | `MemoryError` |
  | 1 000 000 | `MemoryError` |

  At 128 MiB all four succeed.
- **Staging (live, via MCP):**
  - `get_config('indicators')` returns **bare** keys `sandbox.memory_bytes = 134217728` (128 MiB), `sandbox.timeout_ms`
    and `sandbox.allowed_imports`. No full-dotted row exists, so per CONFIG-9 the watcher's full-dotted read falls
    back to its code default;
  - `test_formula` of the 800×800 matmul succeeds there (trace 641260.869, 1.6 s);
  - a trivial numpy mean succeeds.

## Codebase Map

- **`xstockstrat-indicators`** (Python)
  - **Sandbox:** `app/services/sandbox.py`
    - `_THREAD_LIMIT_ENV` at `:46-52` sets OPENBLAS/OMP/MKL/NUMEXPR/VECLIB threads to 1.
    - `_sandbox_env()` at `:118-134` builds the minimal env.
    - `_SECCOMP_ALLOW` at `:64-115` includes mmap/munmap/mremap/mprotect/madvise/brk/mbind.
    - **Wrapper preamble order:**
      1. `:215-226` eager-imports every allowed module, before the rlimits;
      2. `:263-266` drops UID/GID (when root);
      3. `:269` sets `NO_NEW_PRIVS`;
      4. `:271-272` imports pyseccomp;
      5. `:274-282` sets the rlimits: `RLIMIT_DATA` only when `memory_bytes > 0`, CPU = `ceil(timeout)+2`,
         NPROC = `max_concurrent*16`, FSIZE = 0, NOFILE = 64;
      6. `:286-292` loads seccomp;
      7. `:297` runs `exec`.
    - **`execute_formula` defaults** (`:318-326`): `timeout_ms=5000`, `memory_bytes=128 MiB`, `max_concurrent=4`.
      Popen with `start_new_session` at `:355-363`.
    - **`exit_reason` classification** (`:391-396`): default `runtime_error`; `"is not allowed in sandbox"` →
      `import_blocked`; `"MemoryError"` → `memory_exceeded`. `memory_used_bytes` is always 0. The OpenBLAS
      "Memory allocation still failed" abort has no "MemoryError" text, so it is misclassified as
      `runtime_error`.
  - **Config read:** `app/config/watcher.py:137-138`, `get_int("indicators.sandbox.memory_bytes", default=128 MiB)`.
  - **Servicer:** `app/handlers/servicer.py:278`,
    `memory_bytes = request.memory_bytes_override or self._cfg.sandbox_memory_bytes` (the override is not
    clamped, D-33); passed on at `:301`; exit-reason map at `:306-309`.
  - **Proto:** `packages/proto/indicators/v1/indicators.proto:81`, `int64 memory_bytes_override = 6;` (0 = config).
  - **Image:** `Dockerfile:1` is `python:3.13-slim`; numpy comes in via `uv sync --frozen`; no OPENBLAS env.
    `.do/app*.yaml` use `instance_size_slug: basic-s`; no container memory limit is set anywhere.
- **`xstockstrat-config`** (Node)
  - Seeds:
    - `migrations/001_config_tables.up.sql:63` seeds `sandbox.memory_bytes = 134217728`.
    - `migrations/002_config_environment.up.sql:62` seeds **production = `67108864` (64 MiB)** ("same sandbox
      limits everywhere", which is not true: staging reads 128 MiB).
  - Last migration: `030_marketdata_edgar_snapshot_keys`, so the next is **031**.
  - `SCALAR_BOUNDS_REGISTRY` (`src/grpc/configServiceImpl.ts:100-128`) has **no** entry for this key.

## Patterns to REUSE

- **Cap value plumbing:** `memory_bytes` flows config → servicer → `execute_formula` → the wrapper template
  `{memory_bytes}`. Reuse it unchanged; do **not** add a new config key (feature 209 context.md:10, YAGNI).
- **Wrapper-literal test:** `test_rlimits_derive_from_config_in_wrapper` (`tests/test_sandbox_isolation.py:259-283`)
  asserts the literal `setrlimit` line. A semantics change must update this assertion deliberately.
- **Memory-bomb tests:** `test_memory_bomb_is_bounded_and_service_recovers` (`:157-169`) and
  `tests/test_sandbox.py:144-162` (≈400 MiB resize, asserts `memory_exceeded`) are the fail-closed regression
  guard. Reuse them.
- **Numeric golden tests:** `TestNumericParityGolden` (`:178-237`) is the parity guard.
- **Env-key assertions:** `test_sandbox_env_strips_secrets` (`:75-97`) checks keys individually, so a new
  non-secret env key does not break it.

## Existing Business Rules (preserve / extend)

- **PRESERVE** `@AC-3 @FR-3 @feature-209` "An infinite-loop / memory-bomb formula is terminated deterministically"
  (`services/xstockstrat-indicators/acceptance/indicators-sandbox-os-isolation.feature:25`). An over-cap
  allocation still ends in a typed `memory_exceeded`. Note the wording drift: line 29 says "address-space", but
  the code uses `RLIMIT_DATA`.
- **EXTEND** `@AC-4 @FR-4 @feature-209` "A legitimate formula evaluates to the identical result as before
  isolation" (`:32`). Adds the host-independent 800×800 case. Existing results must not move.
- **PRESERVE** `@AC-6 @FR-5 @feature-209` "Isolation limits are configured, not hardcoded" (`:46`).
  `indicators.sandbox.memory_bytes` stays the live tunable. Any jail constant must be documented as one.
- **PRESERVE** `@AC-5 @FR-3 @feature-209` fork bomb / `RLIMIT_NPROC` (`:39`). NPROC is not raised.
- **PRESERVE** `@AC-2 @FR-2 @feature-209` minimal child env, no secrets (`:18`). New env vars must be non-secret.
- **PRESERVE** `@AC-1 @FR-1 @FR-2 @feature-209` no network (`:11`). No seccomp widening.
- **PRESERVE** `@AC-5 @FR-5 @feature-176` concurrent executions and timeouts
  (`analysis-concurrency-offload.feature:9`). The per-child cap times `max_concurrent` must fit the container.
- **PRESERVE** `@AC-4 @feature-173` an empty `allowed_imports` denies numpy (`fix-python-config-zero-trap.feature:12`).
  The bootstrap/import order must not let numpy past an empty allow-list.

## Dependencies

- **Proto/RPC:** none. `memory_bytes_override = 6` is unchanged.
- **Migration:** possibly config **031**, only if the production 64 MiB seed is corrected (design decision).
- **Config keys:** existing `indicators.sandbox.memory_bytes`. Its semantics may change (total segment →
  formula headroom); its default and seed may change.
- **Inter-service edges:** none new. analysis and ingest carry unused copies of the accessor (watcher
  `:154-155` / `:172-173`, test-only).
- **New env vars / ports:** none expected.

## Risks / Not-found

- **Production value unknown.** The seed is 64 MiB; it may have been overridden via SetConfig, and this session
  cannot read production config. If it is still 64 MiB, any production formula with arrays ≥ ~160 KB raises
  `MemoryError` today (measured). An operator check is needed.
- **CI runs system Python 3.12.3, not 3.13.** That is a separate finding (out of scope), but it means CI's import
  footprint differs from production's `python:3.13-slim`. That is one more reason a total-segment cap is
  host-dependent.
- **No measured peak memory exists in the repo.** `memory_used_bytes` is always 0.
- **The OpenBLAS allocation abort is misclassified** as `runtime_error`, not `memory_exceeded` (`:391-396`).
- **The `memory_bytes_override` RPC field is unclamped** (debt D-33). Out of scope unless the design touches it.
- **Container memory:** basic-s instance with `max_concurrent` × cap concurrent children. A larger effective cap
  raises the worst case. No container limit is set.
- **Ledger:** no indicators-sandbox-specific fails or insights apply. Feature 209's context records why
  `RLIMIT_AS` was rejected (INDICATORS-2) and that the 800×800 size exists to exercise `mbind`.

## Recommended Scope

1. Change cap semantics or default in `sandbox.py` (plus the watcher default), with tests: the host-independent
   800×800 case, the memory bomb still `memory_exceeded`, the wrapper-literal update.
2. Classify the OpenBLAS allocation abort as `memory_exceeded`.
3. Production seed correction, config migration 031 (design decision), plus docs (indicators CLAUDE.md:101,
   `formulaReference.ts:171` UI text, `indicator-builder.md`, INDICATORS-2 constitution wording, the 209 `@AC-3`
   wording drift).
