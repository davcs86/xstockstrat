# Feature: screener-agent-tool

**Lifecycle Status**: `draft`
**Development Branch**: `feature/screener-agent-tool`
**Created**: 2026-06-26
**Last Updated**: 2026-06-26

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-06-26 | `idea` → `draft` | /sdd-story | Product spec generated (feature 4 of 6 — optional thin follow-up) |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec screener-agent-tool`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Expose `ScreenSymbols` (Feature 060) as an MCP tool in `xstockstrat-agent`, mirroring the existing
`run_backtest` tool (FastMCP `@server.tool()` → `app/client.py` fresh `grpc.aio` channel to
`xstockstrat-analysis`). Thin, read-only wrapper, no new infra. Optional follow-up.

## Reviewers

_(Auto-populated from docs/runbooks/reviewer-registry.md based on affected services and
change types. Override as needed for this feature. Snapshot finalized at /sdd-spec time —
re-run /sdd-spec if the registry changes.)_

| Role | Review Focus |
|---|---|
| `xstockstrat-agent` (service owner) | FastMCP tool declaration, `x-mcp-secret` metadata, read-only (non-admin) scope, response shaping |
| `xstockstrat-analysis` (service owner) | `ScreenSymbols` contract consumed correctly |

## Next Action

`/sdd-review screener-agent-tool product-spec` — AI review of product spec before running /sdd-spec
