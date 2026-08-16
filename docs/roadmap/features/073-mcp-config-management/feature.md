# Feature: mcp-config-management

**Committed to main**: 0eae638104744992c61c8a1ac4bd8cbaac10862b
**Launched date**: 2026-07-29
**Development Branch**: `feature/mcp-config-management`
**Created**: 2026-07-28
**Last Updated**: 2026-07-28
**Archived**: 2026-08-06

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-07-28 | `idea` → `draft` | /sdd-story | Product spec generated |
| 2026-07-29 | `draft` → `spec-ready` | /sdd-review | PASS WITH WARNINGS on the third pass. Passes 1-2 FAILED; their four blockers were resolved by features 074/075/076/077 plus two user decisions (set_config rejects is_secret keys; Streamable HTTP only). |
| 2026-07-29 | `spec-ready` → `design-approved` | /sdd-design | 1 round (quick). 14 adversary objections; the transport gate was redesigned after the adversary showed the obvious check accepts SSE on both transports. No Floor breach. |
| 2026-07-29 | `design-approved` → `code-completed` | /sdd-execute | Three tools + claims plumbing + scope port implemented; 124/124 agent tests pass, ruff clean, context-map OK. |
| 2026-08-06 | `launched` | /sdd-archiver | Archived: synthesis → context.md + Ledger insights(2)/fails(2); pruned 3 specs |

| 2026-07-29 | `code-completed` → `launched` | CI workflow | Promoted via PR #812; committed 0eae638104744992c61c8a1ac4bd8cbaac10862b |
---

## Artifacts

- Product Spec — pruned by /sdd-archiver 2026-08-06; see [Context Log](context.md) Archive Synthesis
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Add MCP tools to `xstockstrat-agent` that read and write `xstockstrat-config` values
(`get_config`, `list_config_keys`, `set_config`), so an operator can inspect and roll out config
changes — including flipping feature flags and setting `secret.*`-prefixed values — from an agent
session instead of a raw gRPC client against port 50060. `set_config` authorizes by the real
calling user's role rather than a hardcoded admin override. The `SetConfig` authorization check
this depends on **already exists** — shipped by feature 074 (`fix-config-write-authz`) — so this
feature consumes it rather than adding it (see product-spec FR-7).

## Reviewers

_(Auto-populated from docs/runbooks/reviewer-registry.md based on affected services and
change types. Override as needed for this feature. Snapshot finalized at /sdd-spec time —
re-run /sdd-spec if the registry changes.)_

| Role | Review Focus |
|---|---|
| `xstockstrat-agent` (service owner) | MCP tool contract stability (name, parameters, return shape) and `docs/runbooks/mcp-tools.md` parity; tool-count statements kept in sync across all inventory surfaces; no secret values in tool output or the unauthenticated `GET /api/tools` catalog |
| `xstockstrat-config` (service owner) | Config key naming, environment/trading_mode scoping, WatchConfig stream stability. The `SetConfig` authz check (074) and the `is_secret`/value round-trip fixes (075) already landed — this feature only consumes them |
| Security | **Required, not advisory.** No secrets in config service state, secret keys use `secret.*` prefix, JWT claims minimal, API key scoping correct. Two live questions for this reviewer: whether `set_config` may write a real plaintext secret (contradicts four documented invariants), and whether forwarding the real caller's role is implementable on the unauthenticated legacy SSE tool-call path without breaching FR-B13 |

## Next Action

Open the integration PR to `main-dev`. **Outstanding before `launched`:** a dev smoke test —
call `set_config` from a real agent session over Streamable HTTP as an admin (expect success) and
as a non-admin (expect `PERMISSION_DENIED`), and confirm `get_config` redacts a seeded
`is_secret` key.
