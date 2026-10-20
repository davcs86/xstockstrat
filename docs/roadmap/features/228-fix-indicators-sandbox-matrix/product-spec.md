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

**Affected:**
- platform developers, whose unrelated PRs go red on the indicators CI job;
- formula authors in `/insights` and on the agent's `test_formula` tool, whose usable formula memory today depends
  on the host and the Python build.

## Reproduction Steps

1. Re-run the CI job "Python test and coverage (xstockstrat-indicators)" on identical code a few times.
2. Observe that it passes on some hosts and fails on others (job evidence table in the defect report).

## Root Cause Hypothesis

The child's steady-state data segment sits within a few MiB of the 128 MiB `RLIMIT_DATA` cap
(`app/services/sandbox.py:274-278`, default `:323`; production default `app/config/watcher.py:137-138`). That
footprint is Python plus the numpy/pandas imports, the seccomp setup, the arrays, and the OpenBLAS GEMM buffer.

**Confirmed by recon (2026-10-15):**
- `RLIMIT_DATA` covers the whole data segment. About 75–88 MiB of it is the interpreter plus numpy/pandas loaded
  before the cap is set, which leaves about 12 MiB for the 800×800 case at 128 MiB.
- The import footprint varies by host, Python build and wheel.
- The OpenBLAS core type does **not**: 116 MiB under every `OPENBLAS_CORETYPE` and affinity, so that hypothesis is
  refuted.
- Secondary cause: the OpenBLAS allocation abort carries no `MemoryError` text, so it is misclassified as
  `runtime_error` (`sandbox.py:391-396`).

It is **not** a regression from #1246: a passing run and a failing run used the same tree, b5a7ca59.

## Affected Services

- xstockstrat-indicators
- xstockstrat-ui: the `/insights` formula reference text. The memory row changes from "Hard cap" to headroom above
  the interpreter/library baseline (C-14).

## Consumer Surface(s)

- [x] **UI**: `/insights` formula editor reference (`services/xstockstrat-ui/src/components/insights/formulaReference.ts:171`).
  The Memory row note changes from "Hard cap (indicators.sandbox.memory_bytes)" to "Headroom above the
  interpreter/library baseline (indicators.sandbox.memory_bytes)". The value stays 128 MiB.
- [x] **Agent**: the `test_formula` MCP tool. No request or response shape change. `exit_reason` now reports
  `memory_exceeded` (was `runtime_error`) for OpenBLAS allocation aborts, and a formula's memory budget no longer
  depends on the host.
- [ ] **None**

## Fix Scope

- [x] No proto changes anticipated
- [x] No database migrations anticipated
- [x] No new config keys. One existing key changes meaning:
  - `indicators.sandbox.memory_bytes` now means formula headroom above the child's runtime-measured pre-lockdown
    `VmData` baseline (previously the total `RLIMIT_DATA`).
  - The default is unchanged at 128 MiB (operator decision 2026-10-15, context.md).
  - No seed or migration change: the seeds are inert per CONFIG-9, and F-01 forbids editing them.
  - Docs to update: the indicators CLAUDE.md key description, INDICATORS-1/-2, and the runbooks
    `indicator-builder.md` and `config-rollout.md`.

## Functional Requirements

- **FR-1**: `indicators.sandbox.memory_bytes` bounds the formula's own allocations (headroom above the child's
  pre-lockdown baseline), so a formula's budget is the same on every host.
- **FR-2**: an allocation beyond the headroom still fails closed with `exit_reason` `memory_exceeded`, including
  OpenBLAS's allocation abort.
- **FR-3**: if the child cannot measure its pre-lockdown baseline, the formula does not execute and the result has
  a non-success `exit_reason` (fail-closed). When `memory_bytes > 0`, the sandbox never runs a formula without a
  memory cap.

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
- Fixing the inert bare `sandbox.*` seed rows in `xstockstrat-config` migrations 001/002. They are recorded as a
  finding; F-01 forbids editing them.
- Range-validating `memory_bytes_override` beyond the int64 clamp (D-33).

## Open Questions / Owed Verification (O-3)

- [x] Default headroom: resolved as 128 MiB (operator, 2026-10-15).
- [ ] Is the container memory envelope safe on DO `basic-s` (worst case ≈ 812–864 MiB at `max_concurrent=4`)?
  Verify at the dev smoke (O-3).
- [ ] Does production have a live full-dotted `indicators.sandbox.memory_bytes` row? Verify at the prod smoke (O-3).
- [ ] Dev smoke: a 400 MiB resize gives `memory_exceeded`, and a 32 MiB alloc at a 64 MiB override succeeds.
  Verify post-deploy (O-3).
