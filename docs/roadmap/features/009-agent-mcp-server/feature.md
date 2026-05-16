# Feature: agent-mcp-server

**Lifecycle Status**: `draft`
**Development Branch**: `feature/agent-mcp-server`
**Created**: 2026-05-16
**Last Updated**: 2026-05-16

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-05-16 | `idea` → `draft` | /sdd-story | Product spec generated |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec agent-mcp-server`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Phase 1 of the AI agent service: a new Python MCP server (`xstockstrat-agent`) that exposes platform capabilities as MCP tools, enabling an operator to manually trigger AI-assisted signal extraction workflows from Claude.ai with no scheduler or automation infrastructure. Prerequisite: signal-source-registry (008).

## Reviewers

_(Auto-populated from docs/runbooks/reviewer-registry.md based on affected services and
change types. Override as needed for this feature. Snapshot finalized at /sdd-spec time —
re-run /sdd-spec if the registry changes.)_

| Role | Review Focus |
|---|---|
| Platform Lead | New service addition, port assignment (9000), service registry consistency, inter-service dependency graph |
| `xstockstrat-ingest` owner | Signal normalization correctness, source slug validation, correct delegation to ListSignalSources |
| Security | No secrets in tool definitions, API key auth to downstream webhooks, MCP transport security |

## Next Action

`/sdd-review agent-mcp-server product-spec` — AI review of product spec before running /sdd-spec
