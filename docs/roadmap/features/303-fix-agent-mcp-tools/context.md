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

## Session 2026-11-07 (operator decisions on open points)

- OQ1 resolved: **yes** — the `ValueError` and `PermissionError` validation refusals in `app/tools.py` also become `ToolError`, alongside the gRPC-mapped `RuntimeError` sites. Scope is therefore every tool-level anticipated refusal, not only backend gRPC errors.
- OQ2 resolved: **no review** of secret-adjacent paths (`set_config` on `is_secret` keys, `manage_account` credentials) before backend error details are forwarded. Operator decision; the spec adds no such step.
- Next: `/sdd-spec fix-agent-mcp-tools` (design depth stays skip).
