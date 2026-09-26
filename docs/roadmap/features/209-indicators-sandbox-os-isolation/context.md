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
- **Standalone**: no dependency on features 193/207/208. Feature 193's Out-of-Scope explicitly lists
  "full sandbox OS-isolation (C-3 / DT-1)" as a separate design ticket.
- Key design fork (product-spec § Open Questions): hardened `subprocess`+`setrlimit`+namespace/
  capability-drop in-image vs a jailer (nsjail / bubblewrap / gVisor). Deployment feasibility under DO
  App Platform / docker-compose (added capabilities, seccomp) must be confirmed with the platform lead.
- Created for pickup by another session per operator direction (Phase D security backlog).
