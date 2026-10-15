# Defect: Indicators sandbox matrix test fails on some CI runners: the child runs at its 128 MiB memory cap

**Recorded**: 2026-10-15
**Severity**: SEV-3 (proposed)
**Impact type**: ci-red / formula-execution-reliability
**Environment**: CI (GitHub-hosted ubuntu-24.04); latent in every environment that uses the default sandbox cap
**Affected service(s)**: xstockstrat-indicators
**Config-only fix possible**: partially. `indicators.sandbox.memory_bytes` is a config key with a 128 MiB default
(`services/xstockstrat-config/migrations/001_config_tables.up.sql:63`), but the CI test uses the code default in
`execute_formula(memory_bytes=128 MiB)`, so changing config alone does not fix CI.

## Observed

`services/xstockstrat-indicators/tests/test_sandbox_isolation.py::TestNumericParityGolden::test_large_array_linalg_hits_mbind`
fails in the job "Python test and coverage (xstockstrat-indicators)" on identical source. 4 of the 6 jobs that
actually ran on 2026-10-15 failed:

| Job | Time (UTC) | Commit | Runner image | Result |
|---|---|---|---|---|
| 116263990902 | 05:28 | #1246 merge ref 179e625 (tree b5a7ca59) | 20261012.334.1 | PASS |
| 116268601467 | 05:46 | main-dev 3ea5b75b (tree b5a7ca59) | 20261004.327.1 | FAIL: `OpenBLAS error: Memory allocation still failed after 10 retries, giving up.` |
| 116270927740 | 05:53 | #1247 merge f440f6d | 20261004.327.1 | FAIL: `Unable to allocate 4.88 MiB for an array with shape (800, 800)` (`memory_exceeded`) |
| 116271174376 | 05:54 | #1247 merge b471aae | 20261004.327.1 | FAIL: OpenBLAS error |
| 116274099602 | 06:03 | main-dev 84bb6409 | 20261012.334.1 | PASS |
| 116297510270 | 07:15 | #1247 merge a405f4a | 20261012.334.1 | FAIL: `Unable to allocate 4.88 MiB` |

Notes:
- 3ea5b75b and the passing #1246 merge ref have the same parent and the same tree, so this is **not** a code
  regression from #1246. #1246 changed indicators only in telemetry, its lockfile and its tests, and its new
  telemetry tests run *after* `test_sandbox_isolation.py`.
- The #1246 "attempt 2 pass" (job 116268314341) is a copy of attempt 1 (same worker ID and artifact ID). It did
  not execute.
- The result does not track the runner image: one failure ran on the same 20261012 image as both passes. The
  logs print no CPU model.
- Everything else was identical across runs: `numpy==2.4.3` (bundled OpenBLAS), `pandas==3.0.1`,
  `pyseccomp==0.1.2`, libseccomp2 2.5.5, 284 items collected.

## Expected

A sandboxed formula that does a modest 800×800 matmul either succeeds on every host, or fails the same way on
every host. The sandbox memory cap must leave deterministic headroom for numpy and the BLAS working buffers.

## Reproduction

Re-run the indicators test job a few times on GitHub-hosted runners. It fails on some hosts and passes on
others, with identical code.

## Evidence

- `services/xstockstrat-indicators/app/services/sandbox.py`:
  - `:46-52` `_THREAD_LIMIT_ENV` pins BLAS/OMP to one thread;
  - `:274-278` `RLIMIT_DATA` (heap plus anonymous mmap) is set to `memory_bytes`;
  - `:323` the default is `memory_bytes: int = 128 * 1024 * 1024`.
- `services/xstockstrat-indicators/app/config/watcher.py:137-138` defaults production to the same 128 MiB.
- Failure modes: numpy's own allocation (`memory_exceeded`) and OpenBLAS's buffer allocation ("still failed
  after 10 retries"). Both mean the child hit `RLIMIT_DATA`.

## Root cause hypothesis

The child's steady state (Python, numpy and pandas imports, the seccomp/pyseccomp setup, two 4.88 MiB arrays,
and OpenBLAS's GEMM buffer) sits within a few MiB of the 128 MiB `RLIMIT_DATA` cap. The headroom varies by host,
most likely through OpenBLAS's runtime CPU-kernel selection, which sizes its working buffer by core type. The
test went in with feature 209 (00b15acf) and was already marginal; the CI host mix decides pass or fail.

**Production exposure (latent):** real user formulas run under the same 128 MiB default. A formula doing
similar linear algebra can fail nondeterministically depending on the indicators host's CPU.

## Secondary finding (separate, not part of this fix)

CI tests indicators (and probably every uv Python service) on the image's system **Python 3.12.3**
(`Using CPython 3.12.3 interpreter at: /usr/bin/python3.12`; coverage header `python 3.12.3-final-0`), not the
pinned 3.13. `setup-python` installs 3.13.16, but uv does not use it.

## Suggested next steps

1. Confirm by measuring the child's peak data segment for this snippet, and log the OpenBLAS core type
   (`numpy.show_runtime()`) on a passing and a failing host.
2. Fix options (design decides):
   - set an explicit `OPENBLAS_CORETYPE` / buffer size in `_sandbox_env` so memory is host-independent;
   - raise the default cap with measured headroom (code and config seed together);
   - make the test's matrix smaller or give it an explicit cap. This alone would hide the production exposure.
