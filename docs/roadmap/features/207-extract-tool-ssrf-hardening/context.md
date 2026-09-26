# Context: extract-tool-ssrf-hardening

**Feature**: `docs/roadmap/features/207-extract-tool-ssrf-hardening/feature.md`
**Product Spec**: `docs/roadmap/features/207-extract-tool-ssrf-hardening/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/207-extract-tool-ssrf-hardening/implementation-spec.md`

---

## Session 2026-09-25 — sdd-story

- Created feature.md (status: draft), product-spec.md, acceptance.feature, context.md from user story.
- **Provenance**: backlog security follow-on from the 2026-09-16 trading-system security audit
  (`docs/reports/2026-09-16-trading-system-security-audit.md`). The agent SSRF is the "M-list"
  backlog item and is explicitly called out in the DT-2 remediation (§150): "fix the agent SSRF —
  `extract_*` follow redirects to caller-supplied URLs with no allowlist, reaching [internal]." It is
  the prompt-injection **ingress** left out of scope by the agent DB-tooling remediation. That
  remediation is now feature 211 (`remove-agent-postgres-mcp`), which removes the `db_*` SQL egress;
  this feature closes the fetch ingress. The two are independent — no ordering dependency. (Historical:
  the DB remediation was originally feature 193, `sysadmin-db-write-role`, demoted 2026-09-26 in favor
  of removal.)
- **Not a dup of `093-fix-mcp-extract-credentials`**: 093 (launched) concerned credentials handling
  on the extract path; this feature concerns SSRF egress validation of the fetch target. Distinct
  scope — confirmed before allocating the number.
- Created for pickup by another session per operator direction (Phase D security backlog).
- Open forks recorded in product-spec.md § Open Questions (config surface + whether a domain
  allowlist ships in v1 + the email-tool remote-fetch path). Resolve in `/sdd-design`.
