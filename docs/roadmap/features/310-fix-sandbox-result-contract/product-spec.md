# Product Spec: fix-sandbox-result-contract

**Type**: bug
**GitHub Issue**: none (Issues disabled) — reports: `docs/reports/2026-10-19-sandbox-exit-reason-stderr-substring-defect.md`, `docs/reports/2026-10-19-sandbox-memory-used-bytes-always-zero-defect.md`, `docs/reports/2026-10-22-indicators-missing-result-silent-success-defect.md`
**Severity**: SEV-2
**Created**: 2026-11-10

---

## Problem Statement

### Sandbox exit reason is classified by stderr substring match (SEV-3)

- **Observed**: a failed run is tagged `import_blocked` when stderr contains "is not allowed in sandbox" and
  `memory_exceeded` when it contains "MemoryError" or the OpenBLAS marker; a formula raising an exception
  with either string is mis-tagged (caller's own run only).
- **Expected**: the child wrapper reports the failure class structurally (distinct exit code or a sentinel
  the formula cannot forge).
- Report: [`docs/reports/2026-10-19-sandbox-exit-reason-stderr-substring-defect.md`](../../../reports/2026-10-19-sandbox-exit-reason-stderr-substring-defect.md)

### SandboxResult.memory_used_bytes is always zero (SEV-3)

- **Observed**: every sandbox return path hardcodes `memory_used_bytes=0`; the servicer copies it into the
  `ExecuteFormula` response, so UI and agent `test_formula` see a field that never carries a measurement.
- **Expected** (operator decision 2026-11-10): measure it — e.g. child `ru_maxrss` via
  `resource.getrusage(RUSAGE_CHILDREN)`; the proto field stays.
- Report: [`docs/reports/2026-10-19-sandbox-memory-used-bytes-always-zero-defect.md`](../../../reports/2026-10-19-sandbox-memory-used-bytes-always-zero-defect.md)

### A formula that never assigns `result` still returns success with empty output (SEV-2)

- **Observed**: the child wrapper defaults a missing `result` to `{}` and always prints a parseable
  `__OUTPUT__:` marker, so the parent reports `success=true, output={}`; feature 268's no-output checks
  never fire for this case.
- **Expected** (operator decision 2026-11-10): fail with an error naming `result` (like the 268 no-output
  cases); an explicit `result = {}` still succeeds.
- Report: [`docs/reports/2026-10-22-indicators-missing-result-silent-success-defect.md`](../../../reports/2026-10-22-indicators-missing-result-silent-success-defect.md)

## Reproduction Steps

1. `ExecuteFormula` with source `raise ValueError("is not allowed in sandbox")` → `exit_reason`
   `import_blocked` instead of `runtime_error`.
2. `ExecuteFormula` with a formula that allocates (e.g. `numpy.zeros(10_000_000)`) → `memory_used_bytes: 0`.
3. `ExecuteFormula` with inline `formula_source` `x = 1`, empty `input_data` → `success=true`,
   `output={}`, no error.

## Root Cause Hypothesis

String matching was the simplest failure discriminator; memory accounting was never implemented after the
proto field was added; the wrapper's `.get('result', {})` default makes "no result" indistinguishable from
a deliberate `{}`. Current sites (main-dev @ 0fecb24d, `services/xstockstrat-indicators/`):

- `app/services/sandbox.py:544` `_MEMORY_EXHAUSTED_MARKERS`; `:562` the import guard's message; `:809,811`
  the stderr substring checks.
- `app/services/sandbox.py:770,780,794,834` — `memory_used_bytes=0` on every return path;
  `app/handlers/servicer.py:397,413` copy it; `packages/proto/indicators/v1/indicators.proto:95`
  `int64 memory_used_bytes = 6`.
- `app/services/sandbox.py:651` — `_output = _formula_globals.get('result', {{}})`.

## Affected Services

- xstockstrat-indicators
- Consumer surfaces reading the `ExecuteFormula` result: xstockstrat-ui (formula test) and xstockstrat-agent (`test_formula`)

## Fix Scope

- Proto changes: **no** — operator chose to measure `memory_used_bytes` (2026-11-10), so the field stays as is.
- DB migrations: **no** — all three are in-process sandbox/servicer behaviour.
- Config key changes: **no** — no report names a threshold or toggle.

## Open Questions

1. ~~Report 3 contract~~ — **Decided 2026-11-10 (operator):** a formula that never assigns `result`
   fails (`success=false`, error naming `result`); an explicit `result = {}` still succeeds (AC-3/AC-4).
   Recon must list existing formulas that rely on the implicit `{}` before this ships.
2. ~~Report 2 measure vs deprecate~~ — **Decided 2026-11-10 (operator):** measure it (peak RSS of the
   sandboxed child, e.g. `ru_maxrss`); no proto change. The exact source is a /sdd-design detail.
3. Report 1 (deferred to /sdd-design): is the stderr-substring classification a fixed contract? No maintainer has ruled; confirm a structural signal (exit code vs unforgeable sentinel) may replace it.

## Acceptance Criteria

See `acceptance.feature` — the regression scenario(s) that must fail on the buggy behavior and pass
after the fix (Constitution **C-15**). Plus: existing tests pass; affected service(s) smoke-tested on
dev.

## Out of Scope

- The sandbox memory cap itself — feature 300 (launched).
- Feature 268's no-output / unparseable-output checks (already landed).
- Refactoring unrelated to the bug
- Performance improvements unrelated to the fix
