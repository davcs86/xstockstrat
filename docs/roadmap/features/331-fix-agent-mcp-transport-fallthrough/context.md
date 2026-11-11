# Context Log: fix-agent-mcp-transport-fallthrough

Append-only. Each session appends a new ## Session entry. Never delete or edit prior entries.

---

## Session 2026-11-10 (/sdd-triage)

- Bug reported via defect report (Issues disabled; clustered triage):
  - docs/reports/2026-10-19-agent-mcp-transport-stdio-fallthrough-defect.md — Agent silently starts stdio transport when MCP_TRANSPORT is unset or mistyped (SEV-3)
- Cluster rationale: single-report feature — one transport-selection function.
- Severity: SEV-3
- Routing: report says "Config-only fix possible: yes" (Track B), **converted to Track C by operator decision 2026-11-10** — an unset or mistyped `MCP_TRANSPORT` must fail closed in code rather than only relying on the deploy-spec env var.
- Created: status.md, feature.md, product-spec.md, acceptance.feature (AC-1..AC-3), context.md; stamped the report sidecar `triaged`
- Affected services (from report): xstockstrat-agent
- Root cause hypothesis: `resolve_transport()` defaults to and falls through to stdio; no DO `health_check` for the agent
- Open questions: unset → fail vs default http (reverses feature 079 AC-4, needs operator sign-off); DO `health_check` in/out of scope (product-spec § Open Questions)
- Recommended design depth: quick → `/sdd-design fix-agent-mcp-transport-fallthrough quick` (rationale: SEV-3, single service, no proto/migration/config, clear root cause — but it reverses a deliberate accepted AC (079 AC-4) and carries an open posture choice, so not skip)
- Development branch: feature/fix-agent-mcp-transport-fallthrough

## Session 2026-11-10 (/sdd-review product-spec — operator decisions)

- First review FAILed criteria 8/9 (AC-2 undefined pending OQ1).
- Operator decided: unset MCP_TRANSPORT → Streamable HTTP :9000; explicit `stdio` → stdio; any other value → exit non-zero. Reverses feature 079 AC-4 (C-16 supersede at design). DO health_check out of scope. AC-2 rewritten to a single observable outcome.

## Session 2026-11-10 — sdd-review product-spec

- Product spec approved. Status: draft → spec-ready.
- Warnings: bug-template conventions (no FR-N/@FR tags); AC-1 error should name both the value and MCP_TRANSPORT; C-16: /sdd-design must mark feature 079 AC-4 superseded; first review FAILed crit 8+9 (fixed after operator decision)
- Overlap findings: WARN: agent shared with 314/319/322/328
- Recommended design depth: quick (single service, no proto/migration; operator decisions recorded)
- Tree: ccr-500a9eb9-nvk45x (origin/main-dev 0fecb24d + triage/docs commits; no feature branch yet)
