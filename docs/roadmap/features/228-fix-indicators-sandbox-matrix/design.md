# Design: fix-indicators-sandbox-matrix

**Created**: 2026-10-15
**Rounds**: 1 (quick; termination: approved with fixes)
**Approved by**: user @ 2026-10-15 (default headroom: **128 MiB**)
**Grounded in**: recon.md (Measured facts, Codebase Map, Existing Business Rules)

---

## Chosen Approach

**`indicators.sandbox.memory_bytes` becomes formula headroom above the child's pre-lockdown data-segment baseline.**

The memory rlimit is enforced against the whole data segment, and about 75–88 MiB of that segment is the interpreter
plus numpy/pandas loaded before the cap is set. The import footprint varies by host, Python build and wheel, so
today's absolute cap leaves a formula a budget that depends on the host. The 800×800 case needs 42 MiB of headroom on
any host (recon.md, Measured facts). The new limit is the measured baseline plus a configured headroom, which makes
the budget the same on every host.

1. **Probe** in the wrapper template (`services/xstockstrat-indicators/app/services/sandbox.py`), placed
   **immediately before the `RLIMIT_DATA` setrlimit** (recon: rlimits at `:274-282`). By then the eager imports
   (`:215-226`), tempfile (`:257-258`), the UID drop (`:263-266`), NO_NEW_PRIVS (`:269`) and the pyseccomp import
   (`:271-272`) have already run, so fixed jail overhead is part of the baseline and does not count against the
   formula.
   - Read `VmData` from `/proc/self/status` using `with open(...)`. On Linux ≥ 4.7, `RLIMIT_DATA` is checked against
     `mm->data_vm`, and `VmData` reports exactly that counter.
   - The read runs before seccomp is loaded (`:286-292`), so the seccomp allowlist does not change.
   - There is no try/except. If the line is missing or unparseable, the child raises before `exec` (`:297`) and the
     formula never runs: fail-closed.
2. **Limit:** when `memory_bytes > 0`, set `_cap = min(_baseline + memory_bytes, 2**63 - 1)`, then
   `setrlimit(RLIMIT_DATA, (_cap, _cap))`. The clamp keeps a huge unclamped `memory_bytes_override`
   (`servicer.py:278`) from overflowing.
3. **Input parsing is charged to the formula.** Move `data = json.loads(...)` and `params = json.loads(...)` (today
   `:247,250`) to just after the rlimits and before `_flt.load()`. They are pure compute and `json` is already
   imported. Request payloads therefore count against the formula's headroom and cannot inflate the baseline,
   except for the small source-literal residual described under Open Risks.
4. **Classification.** Put both markers in one tuple constant: `"MemoryError"` and
   `"OpenBLAS error: Memory allocation still failed"`. Either one in stderr gives `memory_exceeded` (`:391-396`).
   The `import_blocked` check stays first. The OpenBLAS abort really is written to stderr: the CI failure shows it in
   `SandboxResult.stderr`.
5. **Default headroom: 128 MiB (unchanged number, new meaning).** It stays in `execute_formula`'s default
   (`sandbox.py:323`) and the watcher default (`app/config/watcher.py:137-138`). Neither literal changes. No new
   config key (`@AC-6 @feature-209`; feature 209 rejected new `sandbox.*` leaves).
6. **Config seeds: no migration.** The indicators seed rows are bare (`001_config_tables.up.sql:63`,
   `002_config_environment.up.sql:62` = production 64 MiB). The watcher reads the full-dotted
   `indicators.sandbox.memory_bytes`, and the 029 rename of bare keys did not cover indicators.
   - Per CONFIG-9 those rows are therefore inert, and staging confirms it: its `get_config('indicators')` returns
     bare `sandbox.*` keys only, with no full-dotted row.
   - The other indicators seeds are inert for the same reason. That is recorded as a finding, not fixed here.
   - Migrations 001/002 must **not** be edited (F-01).
7. **Docs** (Step "docs"):
   - INDICATORS-2 (`services/xstockstrat-indicators/docs/context-constitution.md:18`): limit = runtime-measured
     baseline + `memory_bytes` headroom. The baseline is neither a tunable nor a constant
     (`@AC-6 @feature-209`, clause 2). `allowed_imports` now costs container memory, not formula budget.
   - INDICATORS-1 "Why" (`:17`): the OpenBLAS abort also happens with pinned threads when the cap is too tight.
   - `sandbox.py`: module docstring at `:22` and the comment at `:274-276`.
   - Indicators `CLAUDE.md:101`: the key description.
   - UI `services/xstockstrat-ui/src/components/insights/formulaReference.ts:171`: "Hard cap" becomes headroom above
     the interpreter and library baseline (C-14 consumer surface).
   - `docs/runbooks/indicator-builder.md:221,247` and `docs/runbooks/config-rollout.md:157`: switch operator
     examples to the full-dotted key, and reword the `memory_bytes_override=32 MiB` "for testing" example.
   - Findings: the inert indicators seeds (CONFIG-9); the unclamped override (D-33); the drift in the feature-209
     `@AC-3` "address-space" wording, which is recorded only and not edited (C-16, never hand-authored).

### Tests (red before green)

- **T1 (structural).** Update `test_rlimits_derive_from_config_in_wrapper`
  (`tests/test_sandbox_isolation.py:259-283`, assertion at `:283`). Assert the `VmData` probe, the clamped `_cap`
  expression and `setrlimit(resource.RLIMIT_DATA, (_cap, _cap))`. Also assert this order:
  pyseccomp import < probe < `setrlimit(resource.RLIMIT_DATA` < `json.loads(` < `_flt.load()` < `exec(`.
  Red today.
- **T2 (`@AC-3`, host-independence).** Using `_run` with the default allow-set (numpy, pandas, math, statistics), set
  `memory_bytes=64 MiB` and allocate a 32 MiB `np.ones`. It must succeed.
  - Red on every host today: the baseline alone is ≥ 75 MiB, which is more than 64 MiB.
  - It proves the invariant "headroom is independent of the baseline". Host-independence follows from that
    invariant plus recon's coretype measurements.
- **T2b (`@AC-1`).** The 800×800 golden at `memory_bytes=64 MiB` succeeds with trace 641260.869 and
  rank 50: it needs 42 MiB, so ≥ 22 MiB of margin remains at half the default. Red today.
- **T3 (`@AC-2`, fail-closed).** `memory_bytes=16 MiB` with a 32 MiB allocation gives `memory_exceeded`. Green
  before and after; it is a preservation guard.
- **T4 (`@AC-4`, classification).** A fake Popen with `returncode=1` and stderr
  `"OpenBLAS error: Memory allocation still failed after 10 retries, giving up."` gives `memory_exceeded`. Red
  today (`runtime_error`). The existing `_FakeProc` (`:264-272`) sets returncode 0, so lift it into a parameterized
  helper.
- **T5 (`@AC-5`, probe).** Extract the probe snippet from the generated wrapper and run it standalone. It returns an
  int > 0. Then run the generated wrapper with the `VmData` probe forced to fail (e.g. a patched status path or a
  monkeypatched template). The result is not a success and `exit_reason` is `runtime_error`; the formula's
  side-effect marker never prints.
- **Unchanged and must stay green:**
  - the 800×800 golden (`:199-208`) at the default;
  - the 400 MiB memory bombs (`test_sandbox_isolation.py:157-169`, `test_sandbox.py:144-162`; 400 MiB is more than
    baseline + 128 ≈ 216 MiB);
  - the `@feature-173` empty allow-list test;
  - the seccomp, fork-bomb and secrets suites.
- **Dev smoke** (at the post-deploy proof, Constitution O-3, ledger `fails.md:2829`). Run two `test_formula` calls on
  dev:
  - a 400 MiB resize must give `memory_exceeded`, which proves the cap still applies on the DO runtime;
  - a 32 MiB allocation with `memory_bytes_override=64 MiB` must succeed.

### Acceptance

After the product-spec review (2026-10-15), `acceptance.feature` has @AC-1..5 with concrete values, mapped to
FR-1..3. The test mapping is: T2b → @AC-1, T3 → @AC-2, T2 → @AC-3, T4 → @AC-4, T5 → @AC-5.

## Rejected Alternatives

- **Raise the absolute cap only (e.g. 256 MiB).** The formula budget would stay `cap − baseline`, which varies by host
  and Python build (CI 3.12.3, prod 3.13), so the flake moves instead of going away.
- **Shrink the test matrix.** It hides the flake, and it loses the `mbind` coverage that only 800×800 reaches
  (209 context.md:11).
- **Pin `OPENBLAS_CORETYPE`.** Measurement refutes it: every core type and CPU affinity needs 116 MiB.
- **Use `RLIMIT_AS`.** It counts the virtual reservations numpy/pandas make at import, which rules it out
  (INDICATORS-2).
- **Per-child cgroup `memory.max`.** It needs a writable cgroup (CAP_SYS_ADMIN), which DO App Platform does not
  provide.
- **Hybrid `min(baseline + headroom, absolute ceiling)`.** It needs a new constant or key (YAGNI).
- **64 MiB headroom default.** It would keep the container envelope close to today's. The operator chose 128 MiB for
  more formula room.

## Open Risks

- **Container memory envelope.**
  - Worst case is about `max_concurrent(4) × (baseline ≈ 75–88 + 128)` ≈ 812–864 MiB, plus the parent process.
    Today it is about 512 MiB.
  - The basic-s RAM size is unconfirmed (`.do/app*.yaml`, no container limit set).
  - Operator-chosen `allowed_imports` grow the baseline for free.
  - Accepted by the operator (128 MiB choice). Mitigations: lower the live config value, or `max_concurrent`.
- **Production value unverified.** If an operator created a full-dotted `indicators.sandbox.memory_bytes` row, that
  value now means headroom, which is more permissive than before, so it is safe either way. Check at the dev and
  prod smoke.
- **Kernel semantics.** The design assumes `VmData` == `data_vm` enforcement (Linux ≥ 4.7, not a gVisor-like
  runtime). The dev smoke proves the cap still applies.
- **Probe failure is a service-wide outage.** Every formula would return `runtime_error`. That is accepted as
  fail-closed; T5 covers the parse.
- **Baseline padding through the request (Info).** The source literal and JSON literals are compiled before the
  probe. This is bounded by the 4 MiB gRPC receive limit.
- **`exit_reason` spoofing (Info).** A formula that can write to fd 2 can spoof `exit_reason`. It only affects its
  own result. The candidate rule is at `context-constitution.md:36`.

## Constitution Rules Touched

- **F-01:** no applied migration is edited, and no migration is added.
- **F-07:** no new magic numbers. The headroom stays config-driven. The only literal is the int64 clamp, a type
  bound.
- **F-08:** each step stages only its own files.
- **C-15:** `@FR` tags are added, and every Then clause has a test (T2b covers the headroom clause).
- **C-16:** see below; nothing is hand-authored in the durable suites.
- **C-14:** the UI text is updated in the same PR.
- **C-18:** minimal change, one marker tuple, a reused helper.
- **P-03:** the environment-state claims (inert seed) are verified on staging and flagged for production.
- **O-3:** dev smoke.

## Business Rules Touched (C-16)

- **PRESERVE** `@AC-3 @feature-209`: memory bombs still end in `memory_exceeded`, now at baseline + headroom. The
  "address-space" wording drift is recorded as a finding, not edited.
- **PRESERVE** `@AC-6 @feature-209`: the cap is still config-driven. The baseline term is documented as runtime-measured.
- **EXTEND** `@AC-4 @feature-209`: a host-independent 800×800 parity case is added (228 `@AC-1`).
- **PRESERVE** `@AC-1/@AC-2/@AC-5 @feature-209`: no change to seccomp, the env or NPROC.
- **PRESERVE** `@AC-4 @feature-173`: the empty allow-list still denies numpy (the import loop is untouched).
- **PRESERVE, weakened envelope** `@AC-5 @feature-176`: concurrency and timeouts are unchanged. The per-child memory
  ceiling rises (see Open Risks; accepted).
