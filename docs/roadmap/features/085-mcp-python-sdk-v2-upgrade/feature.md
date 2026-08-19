# Feature: mcp-python-sdk-v2-upgrade

**Development Branch**: `claude/mcp-2-upgrade-e3v1uy` (harness-assigned; see context.md for the branch-handling deviation from the standard `feature/mcp-python-sdk-v2-upgrade` model)
**Created**: 2026-07-30
**Last Updated**: 2026-08-19
**Committed to main**: 1d97c6c78caa532a24265dae2fa79c674b3b69dd
**Launched date**: 2026-08-19

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-07-30 | `idea` → `draft` | /sdd-story | Product spec generated. User confirmed full v2.0.0 migration (not a protocol-date-only bump) after reviewing the SDK's migration guide summary. |
| 2026-07-30 | `draft` → `design-approved` | /sdd-design | Design debated (2 rounds, full) and approved; recon.md + design.md written. Recon included live verification against the real installed `mcp==2.0.0` package (not just migration-guide prose). |
| 2026-07-30 | `design-approved` → `implementation-ready` | /sdd-spec | Implementation spec generated with 5 steps. Fresh live re-verification against `mcp==2.0.0` during this session found and corrected two factual errors in `design.md` (`server.get_tool()` does not exist; `MCPServer.call_tool()`'s return shape changed to `CallToolResult`) and one previously-uncaught production risk (`Server.streamable_http_app()` auto-enables a localhost-only DNS-rebinding Host-header check that would 421 every real request unless `transport_security` is passed explicitly). |
| 2026-07-30 | `implementation-ready` → `code-completed` | /sdd-execute | All 5 steps implemented and verified (138 tests pass, 68% coverage, ruff clean, zero remaining `FastMCP` references outside the ledger). One additional stale reference found and fixed beyond the spec's own evidence (`tests/test_backtest_view.py:3`). Implemented directly on the harness-assigned branch `claude/mcp-2-upgrade-e3v1uy` rather than the standard `feature/<slug>` + per-step sub-branch model — see context.md and implementation-spec.md's Deviation Log. |

| 2026-08-19 | `code-completed` → `launched` | status reconciliation | Reconciled to launched: code in production (main==main-dev @ 1d97c6c7); CI status automation (ci-validate-feature-status.yml) missed the slug grep-match. PR #819. |
---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Recon](recon.md) — grounded codebase dossier, live-verified against the real `mcp==2.0.0` package
- [Design](design.md) — debated, approved architecture (2 rounds)
- [Implementation Spec](implementation-spec.md) — 5 steps, generated 2026-07-30
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

Open the integration PR from `claude/mcp-2-upgrade-e3v1uy` to `main-dev` (all 5 steps are committed and verified — see implementation-spec.md).
