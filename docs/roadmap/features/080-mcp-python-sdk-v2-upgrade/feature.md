# Feature: mcp-python-sdk-v2-upgrade

**Lifecycle Status**: `draft`
**Development Branch**: `feature/mcp-python-sdk-v2-upgrade`
**Created**: 2026-07-30
**Last Updated**: 2026-07-30

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-07-30 | `idea` → `draft` | /sdd-story | Product spec generated. User confirmed full v2.0.0 migration (not a protocol-date-only bump) after reviewing the SDK's migration guide summary. |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec mcp-python-sdk-v2-upgrade`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Upgrade `xstockstrat-agent` from the Python `mcp` SDK v1.27.1 to v2.0.0 (released 2026-07-28),
a breaking rewrite: `FastMCP` → `MCPServer`, all 17 `@mcp.tool()` handlers gain an injected
`ctx: Context` parameter, ASGI transport/mounting setup moves off the constructor (`mount_path`
removed), `httpx`/`httpx-sse` are replaced by `httpx2`, the OAuth 2.1 edge-auth layer picks up
several SEP-numbered behavior changes, and the protocol itself becomes stateless with no
server-initiated back-channel (sampling/elicitation/roots deprecated).

## Reviewers

| Role | Review Focus |
|---|---|
| `xstockstrat-agent` service owner | MCP tool contract stability (name, parameters, return shape) and `docs/runbooks/mcp-tools.md` parity; tool-count statements kept in sync across all six inventory surfaces; OAuth 2.1 edge-auth correctness and statelessness (no in-memory store — `instance_count > 1` must stay safe); admin `x-access-scope` forwarded only by the management tools; no secret values in tool output or the unauthenticated `GET /api/tools` catalog |
| Security | No secrets in config service state, secret keys use `secret.*` prefix, JWT claims minimal, API key scoping correct (OAuth/JWT surface touched by this migration) |

## Next Action

`/sdd-review mcp-python-sdk-v2-upgrade product-spec` — AI review of product spec before running /sdd-spec
