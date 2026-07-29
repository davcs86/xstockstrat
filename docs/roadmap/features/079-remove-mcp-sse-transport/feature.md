# Feature: remove-mcp-sse-transport

**Lifecycle Status**: `spec-ready`
**Development Branch**: `feature/remove-mcp-sse-transport`
**Created**: 2026-07-29
**Last Updated**: 2026-07-29

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-07-29 | `idea` → `draft` | /sdd-story | Backlogged while implementing feature 073, which had to work around the SSE transport's unauthenticated tool-call channel. |
| 2026-07-29 | `draft` → `spec-ready` | /sdd-review | Product spec approved on pass 3 (0 warnings outstanding; 4 advisory warnings closed in-place). Passes 1–2 failed on FR-2 ambiguity and an unverified exhaustiveness claim in FR-4. |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec remove-mcp-sse-transport`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Retire the legacy HTTP+SSE MCP transport (`/sse` + `POST /messages`) from `xstockstrat-agent`,
leaving Streamable HTTP as the only remote transport (plus `stdio` for local use).

The motivating defect: **the SSE tool-call channel is not authenticated.** `app/main.py` returns for
`path == "/messages"` *before* the `_authorized` gate, so every tool call arriving that way is
unauthenticated at the transport layer — auth is established once when the stream opens and never
re-checked per message. Feature 073 had to restrict `set_config` to Streamable HTTP for exactly this
reason, and any future tool that needs the caller's identity will hit the same wall.

## Reviewers

| Role | Review Focus |
|---|---|
| `xstockstrat-agent` (service owner) | Transport removal, MCP client compatibility, `MCP_TRANSPORT` handling |
| Security | Required — this closes an unauthenticated tool-call channel |

## Next Action

`/sdd-design remove-mcp-sse-transport quick`
