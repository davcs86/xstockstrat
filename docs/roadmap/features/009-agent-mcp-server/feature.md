# Feature: agent-mcp-server

**Lifecycle Status**: `implementation-ready`
**Development Branch**: `feature/agent-mcp-server`
**Created**: 2026-05-16
**Last Updated**: 2026-05-21 (regenerated)

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-05-16 | `idea` → `draft` | /sdd-story | Product spec generated |
| 2026-05-21 | `draft` → `implementation-ready` | /sdd-spec | Implementation spec generated with 7 steps |
| 2026-05-21 | `implementation-ready` → `spec-ready` | scope change | Nginx routing + DO app spec + identity auth added; impl-spec requires regeneration |
| 2026-05-21 | `spec-ready` → `implementation-ready` | /sdd-spec | Implementation spec regenerated with 11 steps (added nginx, DO spec, identity SSE auth) |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Implementation Spec](implementation-spec.md) — 11 steps
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Phase 1 of the AI agent service: a new Python MCP server (`xstockstrat-agent`) that exposes platform capabilities as MCP tools, enabling an operator to manually trigger AI-assisted signal extraction workflows from Claude.ai with no scheduler or automation infrastructure. Prerequisite: signal-source-registry (008).

## Reviewers

| Role | Review Focus |
|---|---|
| Platform Lead | Port uniqueness, service registry consistency, inter-service dependency graph correctness |
| `xstockstrat-ingest` owner | Signal normalization correctness, idempotent ingestion, newsletter source schema stability |
| `xstockstrat-identity` owner | JWT expiry and rotation, API key scoping, secret store integration (never plaintext secrets in config) |
| Security | No secrets in config service state, secret keys use `secret.*` prefix, JWT claims minimal, API key scoping correct |

## Next Action

`/sdd-review agent-mcp-server impl-spec` — validate implementation spec, then `/sdd-execute agent-mcp-server`
