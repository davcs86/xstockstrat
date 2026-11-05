# Product Spec: fix-sandbox-memory-cap

**Type**: bug
**GitHub Issue**: none (Issues disabled) — defect report `docs/reports/2026-10-15-indicators-sandbox-memory-cap-not-enforced-defect.md`
**Severity**: SEV-2
**Created**: 2026-10-15

---

## Problem Statement

**Observed:** on staging (deployment `a5da677f`, image `4fa2998`), `test_formula` with a ≈ 400 MiB allocation returned
`SANDBOX_EXIT_REASON_SUCCESS`, while the indicators log showed `memory_bytes=134217728` (128 MiB headroom) in force. The same
formula ends in `memory_exceeded` on a native Linux kernel (local, CI).

**Expected:** on the deployed runtime, an allocation beyond the configured headroom fails closed with `memory_exceeded`
(`@AC-3 @feature-209`, 228 `@AC-2`).

**Affected:**
- the platform's availability: a single formula can exhaust the indicators container, taking down formula evaluation,
  scoring and signals for every user;
- formula authors, who lose the documented guarantee.

## Reproduction Steps

1. On staging, run `test_formula` with `a = np.zeros(1); a.resize(50_000_000, refcheck=False); a[:] = 1.0`.
2. It succeeds. Do not escalate the size on a shared environment.

## Root Cause Hypothesis

The DO App Platform runtime does not enforce `RLIMIT_DATA` on brk/mmap growth; for example, a userspace kernel such
as gVisor. This is **unconfirmed**: under investigation, see context.md.

Feature 209's rlimit/seccomp stack was never verified on the runtime image (ledger fails.md). The pre-228
absolute-cap behaviour on DO was never measured either.

## Affected Services

- xstockstrat-indicators

## Consumer Surface(s)

- [x] **Agent**: the `test_formula` / formula-execution tools. No shape change; `exit_reason` becomes
  `memory_exceeded` for over-headroom formulas on the deployed runtime, as already documented.
- [x] **UI**: `/insights` formula test runs. Same `exit_reason` behaviour; no copy change expected.
- [ ] **None**

## Fix Scope

- [ ] No proto changes anticipated
- [ ] No database migrations anticipated
- [ ] No config key changes anticipated

(Update after investigation; design decides.)

## Functional Requirements

- **FR-1**: on the deployed runtime, a formula whose memory use exceeds the configured headroom is terminated and
  reported as `memory_exceeded`, regardless of whether the kernel enforces `RLIMIT_DATA`.
- **FR-2**: the service detects at startup whether its memory-cap mechanism is effective on the current runtime, and
  makes a non-effective cap observable (logged loudly or failing closed; design decides).

## Acceptance Criteria

See `acceptance.feature` (C-15). In addition:
- existing sandbox tests pass;
- the post-deploy staging smoke (400 MiB → `memory_exceeded`) passes.

## Out of Scope

- Changing the headroom semantics or default (feature 228).
- Weakening any isolation guarantee (seccomp, UID drop, NPROC/FSIZE).
- Container-level memory limits in the DO app spec. A design alternative to weigh, not presumed.

## Open Questions / Owed Verification (O-3)

- [ ] Which runtime and kernel does DO App Platform run indicators on? Confirm from inside the container.
- [ ] Is production affected (same platform)? Verify after the fix.
