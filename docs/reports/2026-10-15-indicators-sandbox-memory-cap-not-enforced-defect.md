# Defect: The indicators sandbox memory cap is not enforced on the DigitalOcean runtime

**Recorded**: 2026-10-15
**Severity**: SEV-2
**Impact type**: isolation-guarantee-unenforced / availability
**Environment**: dev (staging app `xstockstrat-staging`, deployment `a5da677f`, image `4fa2998`)
**Affected service(s)**: xstockstrat-indicators
**Config-only fix possible**: no

## Observed

The post-deploy O-3 smoke for feature 228 ran on staging on 2026-10-15 at 15:45 UTC via the agent `test_formula` tool.
The formula was
`a = np.zeros(1); a.resize(50_000_000, refcheck=False); a[:] = 1.0` (≈ 400 MiB, written in full). It returned
`success: true`, `exit_reason: SANDBOX_EXIT_REASON_SUCCESS`, value `50000000.0`.

The indicators run log for the same calls shows the cap that was in force:
`app.handlers.servicer executing formula timeout_ms=20000 memory_bytes=134217728`. That is a 128 MiB headroom, so the
child's `RLIMIT_DATA` should have been the baseline (≈ 75–88 MiB) plus 128 MiB, ≈ 216 MiB.

The same formula ends in `memory_exceeded` locally (Linux 6.18, Python 3.12.3) and in CI. The regression tests
`test_memory_bomb_is_bounded_and_service_recovers` (`tests/test_sandbox_isolation.py`) and
`test_memory_cap_still_enforced` (`tests/test_sandbox.py`) cover this.

The other two smokes passed on staging: the 800×800 matmul golden (trace 641260.869, rank 50) and a 96 MiB
allocation.

## Expected

On the deployed runtime, a formula that allocates beyond `indicators.sandbox.memory_bytes` headroom must fail closed
with `exit_reason` `memory_exceeded`. This is the `@AC-3 @FR-3 @feature-209` guarantee
(`services/xstockstrat-indicators/acceptance/indicators-sandbox-os-isolation.feature`) and 228 `@AC-2`.

## Reproduction

1. On staging, call `test_formula` with the 400 MiB resize source above (timeout_ms 20000).
2. Observe `success: true` where `memory_exceeded` is expected.

Do **not** escalate the allocation size on a shared environment. Beyond the container's memory it would OOM the
indicators service.

## Evidence

- The cap is applied in the child as `resource.setrlimit(resource.RLIMIT_DATA, (_cap, _cap))`
  (`services/xstockstrat-indicators/app/services/sandbox.py`, the wrapper's rlimit block). Before feature 228 it was
  an absolute `RLIMIT_DATA = memory_bytes`. Pre-228 behaviour on DO was never measured, so it cannot be told apart
  from the post-228 behaviour.
- Feature 209's isolation stack (rlimits/seccomp) was never verified on the runtime image (ledger
  `docs/roadmap/ledger/fails.md` "runtime-image verification of the rlimit/seccomp stack never shipped"). The
  228 design flagged this risk explicitly: Open Risk "kernel semantics", with the O-3 dev smoke as the check.
- Indicators runs on DO App Platform `basic-s` (`.do/app.dev.yaml`, `.do/app.yaml`) with no container memory limit
  configured.

## Root cause hypothesis

The DO App Platform container runtime does not enforce `RLIMIT_DATA` the way a native Linux kernel does. For example,
a sandboxed userspace kernel (such as gVisor) that accepts `setrlimit(RLIMIT_DATA)` without enforcing it on
brk/mmap growth. This is unconfirmed: the runtime and its kernel are not observable from a formula (seccomp blocks
`openat`), and this session has no shell access to the running container.

If confirmed, the memory isolation guarantee has never held on DO, since feature 209, regardless of feature 228.

**Production exposure:** production runs the same image family on the same platform. It is probably affected but
unverified.

## Suggested next steps

1. Confirm the runtime from inside the container. Use a debug/console session on the indicators component, or a
   one-off startup log line that records `uname -a`, `/proc/version`, and whether a test `setrlimit(RLIMIT_DATA)`
   plus an over-limit `mmap` fails. Run this at service start in the parent, not in a formula.
2. Design a runtime-independent enforcement. Candidate: the **parent** polls the child's
   `/proc/<pid>/status` `VmRSS`/`VmData` and `killpg`s it over the headroom, reporting `memory_exceeded`. Keep
   `RLIMIT_DATA` as the native-kernel first line.
3. Add a startup self-test that fails loudly if the cap is not enforced. That makes it an observable deploy-time
   signal rather than a silent gap.
