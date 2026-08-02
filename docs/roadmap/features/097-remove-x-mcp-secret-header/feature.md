# Feature: remove-x-mcp-secret-header

**Lifecycle Status**: `spec-ready`
**Development Branch**: `claude/remove-x-mcp-secret-header-icog9j` (harness-assigned; see context.md deviation note — this session runs the full SDD pipeline and lands the single integration PR from this branch instead of a separate `feature/remove-x-mcp-secret-header` branch)
**Created**: 2026-08-02
**Last Updated**: 2026-08-02

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-08-02 | `idea` → `draft` | /sdd-story | Product spec generated |
| 2026-08-02 | `draft` → `spec-ready` | /sdd-review | Product spec approved (PASS WITH WARNINGS; 1 warning fixed pre-approval; overlap scan WARN-only, no blockers) |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec <slug>`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Remove the unenforced `x-mcp-secret` gRPC metadata header that `xstockstrat-agent` currently
attaches to every outbound call, and reconcile every doc/CLAUDE.md that describes it — while
preserving `MCP_AGENT_SECRET`'s separate, load-bearing role as the HMAC signing key for the
agent's stateless OAuth `txn` blob (invariant `AGENT-6`).

## Reviewers

| Role | Review Focus |
|---|---|
| `xstockstrat-agent` service owner | MCP tool contract stability and `docs/runbooks/mcp-tools.md` parity; OAuth 2.1 edge-auth correctness and statelessness (no in-memory store — `instance_count > 1` must stay safe); no secret values in tool output |
| Security | No secrets in config service state, secret keys use `secret.*` prefix, JWT claims minimal, API key scoping correct |
| Platform Lead | Cross-service architecture, inter-service dependency graph correctness, env var propagation across `docker-compose.yml` / `.do/app*.yaml` |

## Next Action

`/sdd-design remove-x-mcp-secret-header quick` — grounded design debate before /sdd-spec
