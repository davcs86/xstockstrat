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
as gVisor. This is **unconfirmed**; the FR-2 probe's log line is how it gets answered (see Deferred Verification).

Feature 209's rlimit/seccomp stack was never verified on the runtime image (ledger fails.md). The pre-228
absolute-cap behaviour on DO was never measured either.

## Affected Services

- xstockstrat-indicators
- Deploy configuration only: `deploy/homelab/` (compose limit and render oracle).

## Consumer Surface(s)

- [x] **Agent**: the `test_formula` / formula-execution tools. No shape change; `exit_reason` becomes
  `memory_exceeded` for over-headroom formulas on the deployed runtime, as already documented.
- [x] **UI**: `/insights` formula test runs. Same `exit_reason` behaviour; no copy change expected.
- [ ] **None**

## Fix Scope

- [x] No proto changes anticipated
- [x] No database migrations anticipated
- [x] No config key changes (the probe, tick and handoff values are fixed jail constants, documented as such per
  209 `@AC-6`; thresholds derive from the existing `indicators.sandbox.memory_bytes`).

## Functional Requirements

- **FR-1**: the parent samples a formula's process group every 50 ms and terminates it when it exceeds the configured
  headroom above the child's pre-lockdown baseline, reporting `memory_exceeded`, whether or not the kernel enforces
  `RLIMIT_DATA`, on both DigitalOcean App Platform and a homelab (docker-compose) runtime. It kills on (R1) `VmData`
  growth or (R2) resident memory (`RssAnon + RssShmem`) beyond the headroom, so memory that evades `VmData` accounting
  (shared-anonymous maps, touch-then-`mprotect`) is also caught. A SIGKILLed child is `memory_exceeded` only when the
  watchdog killed it or the cgroup `oom_kill` count rose; otherwise it stays `runtime_error`, with the existing error
  text. Documented residuals: (a) an over-headroom burst that allocates and frees, or exits, within one 50 ms tick is
  not reported; (b) inflate-fork-deflate is bounded by about `NPROC × (base + 2H)`, parity with native per-process
  `RLIMIT_DATA`; (c) when the parent cannot observe the child (positive evidence only), the run is fail-open: one
  ERROR per process and the observable gauge at 0, and the formula still runs under `RLIMIT_DATA`, the timeout, the
  container limit and `oom_score_adj` 1000 (operator sign-off, `context.md`, 2026-11-09 round-4 gate); (d) fork-bomb
  runs may now end `memory_exceeded` (still a typed error).
- **FR-2**: at startup, in the parent process (never in a formula) and before the config wait, the service probes
  whether `RLIMIT_DATA` is kernel-enforced and whether the watchdog can observe a child on the current runtime, then
  keeps serving; it never fails closed. It logs one INFO `sandbox memory probe` line (uname fields, `/proc/version`,
  cgroup `memory.max`, inherited `RLIMIT_DATA` hard limit, handoff cap read-back, `VmData`/`RssAnon` deltas, the three
  enforcement-leg results, `enforced`, `observable`) and sets two label-free OTel gauges:
  `indicators.sandbox.memory_cap_enforced` (1 only when all three legs are refused) and
  `indicators.sandbox.memory_watchdog_observable` (1 only when the handoff is well-formed, the cap read-back matches and
  `VmData` moves; 0 means "R1 blind"). A non-enforcing runtime logs ERROR `sandbox memory cap not kernel-enforced`; an
  unobservable one logs ERROR `sandbox memory watchdog cannot observe child`; a probe that crashes, times out or
  returns garbage logs ERROR `sandbox memory probe failed` and sets both gauges to 0.
- **FR-3**: the homelab indicators container runs with `mem_limit` and `memswap_limit` of 2 GiB (parity with DO
  `basic-s`), asserted by the render oracle `deploy/homelab/render-assert.jq`. The DO app spec is unchanged
  (`basic-s`, 2 GB).

## Acceptance Criteria

See `acceptance.feature` (C-15). In addition:
- existing sandbox tests pass;
- the owned advisory post-deploy checklist in `design.md` § Open Risks is run and its results recorded in `context.md`
  (owner: operator; non-gating).

## Out of Scope

- Changing the headroom semantics or default (feature 228).
- Weakening any isolation guarantee (seccomp allowlist, UID drop, NPROC/FSIZE) or changing `RLIMIT_CPU`.
- Changing the DO app spec or instance size (`basic-s` already bounds the container at 2 GB).
- Fixing `memory_used_bytes` (always 0) or the stderr-substring classifier defect (separate reports).
- A sizing WARN for `max_concurrent × (baseline + memory_bytes + overshoot)`: cut at design; re-checking the formula
  documented in indicators `CLAUDE.md` when those live keys change is an owned follow-up.
- Enforcing the post-deploy checklist through `/promote` or `/sdd-execute`.

## Deferred Verification (O-3)

Owner: the operator, via the advisory checklist in `design.md` § Open Risks (non-gating; nothing enforces it).

- Which runtime and kernel does DO App Platform run indicators on? Answered by the FR-2 probe log line after the
  first staging deploy.
- Is production affected (same platform)? Answered by the same log line after promotion.
- The design depends on one answer: if DO reports `memory_watchdog_observable = 0`, FR-1 runs fail-open there and the
  2 GB container limit plus `oom_score_adj` is the only memory bound; the operator then reopens this as SEV-2.
