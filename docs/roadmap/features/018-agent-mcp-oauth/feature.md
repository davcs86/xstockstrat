# Feature: agent-mcp-oauth

**Lifecycle Status**: `draft`
**Development Branch**: `feature/agent-mcp-oauth`
**Created**: 2026-05-25
**Last Updated**: 2026-05-25

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-05-25 | `idea` → `draft` | /sdd-story | Product spec generated |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec agent-mcp-oauth`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Adds OAuth 2.0 Authorization Code flow endpoints to `xstockstrat-agent` so that Claude.ai's remote MCP "Connect apps" integration can authenticate without sharing raw API keys in URLs. Delegates identity verification to `xstockstrat-identity`.

## Reviewers

_(Auto-populated from docs/runbooks/reviewer-registry.md based on affected services and
change types. Override as needed for this feature. Snapshot finalized at /sdd-spec time —
re-run /sdd-spec if the registry changes.)_

| Role | Review Focus |
|---|---|
| Platform Lead | Port uniqueness, service registry consistency, inter-service dependency graph correctness |
| Security | No secrets in config service state, JWT claims minimal, API key scoping correct, OAuth redirect URI validation |
| `xstockstrat-identity` owner | JWT expiry and rotation, API key scoping, secret store integration |
| `xstockstrat-agent` owner | Auth flow correctness, backward compatibility with query-param and Bearer header auth |

## Next Action

`/sdd-review agent-mcp-oauth product-spec` — AI review of product spec before running /sdd-spec
