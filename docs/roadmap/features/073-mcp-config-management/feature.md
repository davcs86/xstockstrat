# Feature: mcp-config-management

**Lifecycle Status**: `draft`
**Development Branch**: `feature/mcp-config-management`
**Created**: 2026-07-28
**Last Updated**: 2026-07-28

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-07-28 | `idea` → `draft` | /sdd-story | Product spec generated |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec mcp-config-management`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Add MCP tools to `xstockstrat-agent` that read and write `xstockstrat-config` values
(`get_config`, `list_config_keys`, `set_config`), so an operator can inspect and roll out config
changes — including flipping feature flags and setting `secret.*`-prefixed values — from an agent
session instead of a raw gRPC client against port 50060.

## Reviewers

_(Auto-populated from docs/runbooks/reviewer-registry.md based on affected services and
change types. Override as needed for this feature. Snapshot finalized at /sdd-spec time —
re-run /sdd-spec if the registry changes.)_

| Role | Review Focus |
|---|---|
| `xstockstrat-agent` (service owner) | MCP tool contract stability (name, parameters, return shape) and `docs/runbooks/mcp-tools.md` parity; tool-count statements kept in sync across all inventory surfaces; no secret values in tool output or the unauthenticated `GET /api/tools` catalog |
| Security | No secrets in config service state, secret keys use `secret.*` prefix, API key scoping correct |

## Next Action

`/sdd-review mcp-config-management product-spec` — AI review of product spec before running /sdd-spec
