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
