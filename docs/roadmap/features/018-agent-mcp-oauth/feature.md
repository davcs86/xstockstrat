# Feature: agent-mcp-oauth

**Lifecycle Status**: `demoted/canceled`
**Development Branch**: `feature/agent-mcp-oauth`
**Created**: 2026-05-25
**Last Updated**: 2026-06-06

> **Superseded by `049-unify-admin-auth-gates` (Part B), 2026-06-06.** This feature's OAuth 2.0 design is
> folded into 049 and re-specced as **full MCP OAuth 2.1** (RFC 8414/9728 metadata, RFC 7591 DCR,
> mandatory PKCE/S256, exact redirect match, UI-delegated login over gRPC). The 7-step implementation
> spec here is **retired as stale** — it predates feature 045 and assumes nginx + HTTP/Connect-RPC
> `80xx` ports + `IDENTITY_HTTP_ENDPOINT`, all of which were removed. Do not execute it. See
> `docs/roadmap/features/049-unify-admin-auth-gates/product-spec.md` (Part B).

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-05-25 | `idea` → `draft` | /sdd-story | Product spec generated |
| 2026-05-25 | `draft` → `spec-ready` | /sdd-review | Product spec approved (1 warning) |
| 2026-05-25 | `spec-ready` → `implementation-ready` | /sdd-spec | Implementation spec generated with 7 steps |
| 2026-06-06 | `implementation-ready` → `demoted/canceled` | re-spec (user) | Superseded — folded into `049-unify-admin-auth-gates` Part B as full MCP OAuth 2.1. Impl spec retired as stale (assumed nginx + HTTP `80xx` ports removed by 045). Never executed. |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Implementation Spec](implementation-spec.md)
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Adds OAuth 2.0 Authorization Code flow endpoints to `xstockstrat-agent` so that Claude.ai's remote MCP "Connect apps" integration can authenticate without sharing raw API keys in URLs. Delegates identity verification to `xstockstrat-identity`.

## Reviewers

| Role | Review Focus |
|---|---|
| `xstockstrat-agent` owner | Auth flow correctness, backward compatibility with query-param and Bearer header auth |
| Security | No secrets in config service state, JWT claims minimal, API key scoping correct, OAuth redirect URI validation |
| `xstockstrat-config` owner | Config key naming (`<service>.<category>.<key>`), environment/trading_mode scoping, WatchConfig stream stability |
| Platform Lead | Port uniqueness, service registry consistency, inter-service dependency graph correctness |

## Next Action

`/sdd-review agent-mcp-oauth impl-spec` — validate implementation spec, then `/sdd-execute agent-mcp-oauth`
