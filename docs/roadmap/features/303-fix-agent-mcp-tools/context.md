# Context Log: fix-agent-mcp-tools

Append-only. Each session appends a new ## Session entry. Never delete or edit prior entries.

---

## Session 2026-11-07 (/sdd-triage)

- Bug reported via defect report `docs/reports/2026-11-07-agent-mcp-tool-error-details-masked-defect.md` (GitHub Issues disabled; report on PR #1470)
- Severity: SEV-3 (operator UX, no data loss, blocks diagnosis)
- Routed to SDD path (Track C)
- Created: feature.md, product-spec.md, acceptance.feature (regression scenario), context.md
- Affected services (from report): xstockstrat-agent
- Root cause hypothesis: non-`ToolError` exceptions are masked by `mcp` 2.3.0 (`tools/base.py:211-213`); agent raises none of type `ToolError`
- Recommended design depth: skip → `/sdd-spec fix-agent-mcp-tools` (rationale: SEV-3, single service, no proto/migration/config, clear root cause). Open point for spec: whether ValueError/PermissionError refusals also become ToolError, and the secret-path review.
- Development branch: feature/fix-agent-mcp-tools
