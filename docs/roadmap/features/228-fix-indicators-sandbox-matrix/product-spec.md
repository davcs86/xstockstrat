# Product Spec: fix-indicators-sandbox-matrix

**Type**: bug
**GitHub Issue**: none (Issues disabled) — defect report `docs/reports/2026-10-15-indicators-sandbox-blas-memory-flake-defect.md`
**Severity**: SEV-3
**Created**: 2026-10-15

---

## Problem Statement

**Observed:**
- `tests/test_sandbox_isolation.py::TestNumericParityGolden::test_large_array_linalg_hits_mbind` fails on some
  GitHub-hosted runners and passes on others, with byte-identical source.
- 4 of 6 executed runs on 2026-10-15 failed. The failure is either `Unable to allocate 4.88 MiB for an array with
  shape (800, 800)` (`memory_exceeded`) or `OpenBLAS error: Memory allocation still failed after 10 retries`.

**Expected:** a sandboxed formula doing a modest 800×800 matmul behaves the same on every host. The sandbox memory
cap must leave deterministic headroom for numpy and the BLAS working buffers.

## Reproduction Steps

1. Re-run the CI job "Python test and coverage (xstockstrat-indicators)" on identical code a few times.
2. Observe that it passes on some hosts and fails on others (job evidence table in the defect report).

## Root Cause Hypothesis

The child's steady-state data segment sits within a few MiB of the 128 MiB `RLIMIT_DATA` cap
(`app/services/sandbox.py:274-278`, default `:323`; production default `app/config/watcher.py:137-138`). That
footprint is Python plus the numpy/pandas imports, the seccomp setup, the arrays, and the OpenBLAS GEMM buffer.

Headroom varies by host, most likely because OpenBLAS picks a CPU kernel at runtime and that choice sizes its
buffer. This is not yet confirmed: the CI logs print no CPU model.

It is **not** a regression from #1246: a passing run and a failing run used the same tree, b5a7ca59.

## Affected Services

- xstockstrat-indicators

## Fix Scope

- [x] No proto changes anticipated
- [x] No database migrations anticipated
- [ ] No config key changes anticipated. Possible: raising the `indicators.sandbox.memory_bytes` default would
  also change its config seed. Design decides.

(Update after investigation — remove or replace each item as needed)

## Functional Requirements

- **FR-1**: `indicators.sandbox.memory_bytes` bounds the formula's own allocations (headroom above the child's
  pre-lockdown baseline), so a formula's budget is the same on every host.
- **FR-2**: an allocation beyond the headroom still fails closed with `exit_reason` `memory_exceeded`, including
  OpenBLAS's allocation abort.

## Acceptance Criteria

See `acceptance.feature`: the regression scenario(s) must fail on the buggy behavior and pass after the fix
(Constitution **C-15**). In addition:
- existing tests pass;
- the indicators CI job passes on repeated runs;
- the affected service is smoke-tested on dev.

## Out of Scope

- The secondary finding that CI runs uv on the system Python 3.12.3 instead of the pinned 3.13 (recorded in the
  defect report; separate fix).
- Weakening any sandbox isolation guarantee (seccomp allowlist, NPROC/FSIZE caps, UID drop).
- Refactoring unrelated to the bug.
