# Context: indicators-sandbox-os-isolation

**Feature**: `docs/roadmap/features/209-indicators-sandbox-os-isolation/feature.md`
**Product Spec**: `docs/roadmap/features/209-indicators-sandbox-os-isolation/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/209-indicators-sandbox-os-isolation/implementation-spec.md`

---

## Session 2026-09-25 — sdd-story

- Created feature.md (status: draft), product-spec.md, acceptance.feature, context.md from user story.
- **Provenance**: the Critical finding **C-3** from the 2026-09-16 security audit
  (`docs/reports/2026-09-16-trading-system-security-audit.md`, status "Deferred (design)"), with
  **DT-1** as its design ticket: "OS-level isolation for the indicators formula sandbox." The escape
  vector is the standard `().__class__.__base__.__subclasses__()` reflection chain against a
  builtins/import blocklist with no AST allowlist (`app/services/sandbox.py`).
- **Builds on shipped C-4**: `_sandbox_env()` already runs the formula child with a minimal env
  (PYTHONPATH + BLAS/OMP pins only), severing `DATABASE_URL`/master-key inheritance
  (`tests/test_sandbox.py::TestSandboxEnvIsolation`). C-3/DT-1 extends containment to the network and
  filesystem dimensions and adds resource caps — the escape itself was left outstanding by C-4.
- **Standalone**: no dependency on features 207/208/214. The agent DB-tooling remediation (feature 214
  `remove-agent-postgres-mcp`, which superseded demoted feature 212 `sysadmin-db-write-role`, formerly
  193) explicitly scoped "full sandbox OS-isolation (C-3 / DT-1)" out as a separate design ticket.
- Key design fork (product-spec § Open Questions): hardened `subprocess`+`setrlimit`+namespace/
  capability-drop in-image vs a jailer (nsjail / bubblewrap / gVisor). Deployment feasibility under DO
  App Platform / docker-compose (added capabilities, seccomp) must be confirmed with the platform lead.
- Created for pickup by another session per operator direction (Phase D security backlog).

## Session 2026-09-28 — sdd-review product-spec

- Product spec approved. Status: draft → spec-ready. Verdict: PASS WITH WARNINGS (no blockers).
- Warnings (advisory):
  - AC-6 phrasing NOTE — `Then` named "inline literals in sandbox.py" (implementation-ward). FIXED before
    advancing: rephrased to an observable Then (operator-tunable limits read from config/env at startup;
    changing a config value changes the enforced limit next evaluation).
  - Open Questions ×4 unchecked (isolation mechanism FR-1; DO App Platform / docker-compose runtime
    compatibility; tunable-vs-fixed config split FR-5; per-evaluation latency budget). Correctly-deferred
    /sdd-design inputs, NOT product-spec defects — carried into design as the debate agenda.
- Overlap findings: CLEAN (no config-key/proto/migration/file collision). Watch at impl-spec:
  (1) pin NEW `indicators.sandbox.*` leaf names — `timeout_ms`/`max_concurrent`/`allowed_imports` are trunk
  reality from launched features (003/058/173/176/205), must not be redefined;
  (2) potential indicators-Dockerfile co-edit with 210 (mTLS cert wiring) — re-check Mode B once both pin
  their Dockerfile/base-image mechanism.
- Pre-grounded (this session, for the design fork): `.do/app.yaml` indicators block has NO privileged/
  cap_add/security_context/seccomp fields → DO App Platform managed runtime does not grant elevated
  container privileges; current sandbox.py already = subprocess + resource.setrlimit(RLIMIT_DATA) +
  SIGKILL timeout + minimal _sandbox_env(). Feeds the isolation-mechanism fork put to the operator.

## Session 2026-09-28 — sdd-design

- Phase 0 Recon: wrote recon.md (service: xstockstrat-indicators; key reuse: subprocess child +
  _sandbox_env + RLIMIT_DATA site + ConfigWatcher accessors + exit_reason map). Grounded the DO App
  Platform unprivileged-only runtime constraint + current sandbox mechanism.
- Phase 1 Grilling: 4 rounds (full). Chosen approach: unprivileged in-container OS isolation —
  distinct-UID (nobody 65534) child + in-wrapper POST-import seccomp allowlist (defaction=ERRNO(EPERM),
  native arch only) + expanded rlimits (keep RLIMIT_DATA, no RLIMIT_AS; add CPU, NPROC=max_concurrent×16,
  FSIZE=0, NOFILE=64) + _sandbox_env write-elimination (PYTHONDONTWRITEBYTECODE=1, HOME/TMPDIR=nonexistent)
  + start_new_session/killpg (load-bearing) + stdin source delivery. Denial→existing runtime_error (no
  proto). Stays on DO App Platform. Rejected: jailer/off-App-Platform, same-UID seccomp, denylist,
  preexec_fn, per-slot UIDs, KILL-default, flag-filtered openat, new config leaves.
- **Empirical validation**: ran `strace -f` on the real indicators venv (numpy 2.4.3/pandas 3.0.1). The
  post-import compute allow-set was FINALIZED from ground truth — caught `mbind` (NUMA) on 800×800 arrays
  that a 200×200 trace missed (→ golden must use large arrays, Open Risk O-1), and confirmed
  PYTHONDONTWRITEBYTECODE + HOME/TMPDIR=nonexistent eliminate ALL compute-time writes (zero
  mkdir/rename/openat-O_WRONLY). Added statx/getdents64 defensively for the runtime python:3.13-slim glibc.
- Constitution rules touched: C-16 (@AC-4/5/7 PRESERVE), F-07/C-05 (rlimits derive from WatchConfig
  tunables; no new leaf), C-08/P-06 (RED-demonstrating deny-test + coverage-omit removal), C-18, C-14.
  Floor breaches: none across 4 rounds.
- Status: spec-ready → design-approved.

### Open Threads (carry to /sdd-spec)
- O-1: allowlist FR-4 fragility → the frozen golden must be operation-level AND large-array (numpy
  linalg/fft, pandas groupby/rolling, RNG) to catch syscalls like mbind; a numpy bump adding a compute
  syscall on an unexercised path → prod EPERM→runtime_error. Target: the test step.
- O-2: single-UID cross-child NPROC starvation (shared uid-65534 ceiling) → @AC-5 test asserts a
  fork-bomb child doesn't permanently break later executions (killpg reclaim); per-slot-UID is the
  on-file escape hatch.
- O-3: verification env ≠ runtime image → statx/getdents64 added defensively; the real setuid+seccomp
  syscall validation MUST run inside the runtime container in CI/deploy (fails.md:369); the deny-test
  must demonstrate RED and never silent-skip (fails.md:133); remove sandbox.py from coverage omit and
  re-check the 50% gate.
- Impl-spec watch (from overlap scan): pin NEW indicators.sandbox.* names IF any are added (design
  adds NONE — all rlimits derived); potential indicators-Dockerfile co-edit with 210 (mTLS cert wiring).

## Session 2026-09-28 — sdd-spec

- Generated implementation-spec.md with 4 steps. Status → implementation-ready.
- Step map: (1) `service` — add `pyseccomp` dep + `uv lock` + Dockerfile `libseccomp2`/build-deps, no
  `USER` (child setuid needs root parent); (2) `service` — rewrite `sandbox.py` (distinct-UID 65534
  child + stdin `Popen(start_new_session=True)` + post-import seccomp allowlist ERRNO(EPERM) +
  expanded rlimits [keep RLIMIT_DATA, no RLIMIT_AS; add CPU/NPROC=max_concurrent×16/FSIZE=0/NOFILE=64]
  + HOME/TMPDIR=nonexistent/PYTHONDONTWRITEBYTECODE + killpg-on-timeout/exit) + `servicer.py` passes
  `max_concurrent=self._cfg.sandbox_max_concurrent()`; (3) `test` — new `test_sandbox_isolation.py`
  covering AC-1..AC-6 + remove `sandbox.py` from coverage `omit` (R5) + keep pre-existing suite green;
  (4) `docs` — reconcile service CLAUDE.md / context-constitution / indicator-builder + teardown.
- Key codebase findings (all line numbers verified on `feature/indicators-sandbox-os-isolation`):
  - `execute_formula` `sandbox.py:175-182`; child launch `:198-210`; `_SANDBOX_WRAPPER` `:116-172`;
    the single `RLIMIT_DATA` site `:127-128`; parent classification `:224-263`. No new exit_reason —
    seccomp/setuid/rlimit denial → existing default `runtime_error` (design §6).
  - `_sandbox_env()` `:43-55` gets the write-elimination env additions; servicer sandbox call
    `servicer.py:170-179`, `sandbox_max_concurrent()` already read at `:61`, exit_reason map `:181-187`.
  - Coverage `omit` (incl. `app/services/sandbox.py`) `pyproject.toml:39-46` — removed in Step 3.
  - No new env var / port / config leaf → docker-compose + `.do/app*.yaml` untouched; Dockerfile
    referenced by path (root CLAUDE.md § Dockerfile Update Workflow). No proto/migration.
  - CI: `python-lint` `uv lock --check` (ci.yml:323); `python-test` `pytest --cov=app
    --cov-fail-under=50` (ci.yml:373-378) runs on the host runner (non-root) → setuid path is
    `skipif(geteuid()!=0)`-recorded (never silent, fails.md:133); full setuid+seccomp+rlimit stack
    validation deferred to CI/deploy inside the runtime image (O-3/fails.md:369).
- P-03 surfaced (not papered): AC-2 "reads outside scratch denied" is realized by the approved design
  as secret-exfiltration containment (env-strip + distinct-UID /proc/environ EACCES + no secrets on
  disk + write-elimination), NOT a blanket read jail (flag-filtered openat was Rejected #7). Recorded
  in the spec's Scenario Coverage note so impl-spec review sees the interpretation.

## Session 2026-09-28 — sdd-review impl-spec (advisory)

- Result: 0 failures, 3 warnings (advisory — did not block). Criteria PASS WITH WARNINGS; every cited
  symbol/path/line verified against the branch; plan matches design.md; C-08/P-06/C-15/C-16/F-07 all
  satisfied; no Floor risk. Overlap scan CLEAN (no config/proto/migration/file collision; 201/205 are
  the only other servicer.py touchers and both are launched/trunk).
- Warnings carried into execution:
  - Step 1/4: Dockerfile adds libseccomp packages but no step updated the service CLAUDE.md § Docker
    Build Pattern (root Dockerfile Update Workflow) — [x] resolved: folded into Step 4 (new instruction
    4a + Files entry) pre-execution.
  - Step 3: 9-instruction step is dense but complete — [x] acknowledged, no action (each instruction
    discrete/traceable; no split required).
  - Minor line-ref drift (test_sandbox.py TestSandboxExecution :9 vs :10; omit block :39-46 vs :40-46)
    — [x] immaterial, both resolve to the same construct; execute-time discovery re-verifies live lines.
- Overlap findings: none. Heads-up (not a blocker): if 210 (mTLS) later specs edits to the indicators
  Dockerfile, whichever of 209/210 merges second is a soft rebase — re-run the Mode B scan then.
- @AC-2 interpretation (from /sdd-spec, P-03): realized as secret-exfil containment (env-strip +
  distinct-UID /proc/environ EACCES + no on-disk secrets + write-elimination), NOT a blanket file-read
  jail (flag-filtered openat was Rejected #7). World-readable non-secret files stay readable by design.
  Carried into execution as the accepted AC-2 semantics.
