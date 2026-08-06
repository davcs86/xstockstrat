# Feature: fix-mcp-extract-credentials

**Type**: bug
**Lifecycle Status**: `launched`
**Committed to main**: a76237080a282abac145b7f88a6044869132ba5f
**Launched date**: 2026-08-02
**Development Branch**: `feature/fix-mcp-extract-credentials`
**Source Report**: docs/reports/2026-08-01-mcp-tools-alignment-triage.md (F-1)
**Severity**: SEV-2
**Created**: 2026-08-02
**Last Updated**: 2026-08-02
**Archived**: 2026-08-06

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-08-02 | `bug-reported` → `draft` | /sdd-triage | Product spec pre-populated from the MCP-alignment triage report (F-1) |
| 2026-08-02 | `draft` → `design-approved` | /sdd-design | Design debated (2 rounds, full). Chosen: option (c) — env-scope + typed-projection fix for the legitimate reads (alert_threshold, OAuth); extract-tool credentials made loudly unsupported (raise) rather than a plaintext-config antipattern. AC-3 (radical resolver) deferred; AC-4 reinterpreted. |
| 2026-08-02 | `implementation-ready` → `code-completed` | /sdd-execute | All 3 steps: get_config_value env+typed-projection+non-swallow (O1 RED demonstrated); extract tools raise RuntimeError when credentials required; alert/OAuth env-scoped best-effort; docs. Agent 146 tests, coverage 71%. One PR into main-dev. |
| 2026-08-02 | `design-approved` → `implementation-ready` | /sdd-spec | Implementation spec generated with 3 steps (atomic agent-only service step + paired RED-first test step + same-PR docs). No proto/migration/new config key. |
| 2026-08-06 | `launched` | /sdd-archiver | Archived: synthesis → context.md + Ledger insights(1)/fails(0); pruned 4 specs |

| 2026-08-02 | `code-completed` → `launched` | CI workflow | Promoted via PR #844; committed a76237080a282abac145b7f88a6044869132ba5f |
---

## Artifacts

- Product Spec — pruned by /sdd-archiver 2026-08-06; see [Context Log](context.md) Archive Synthesis
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Give extract-tool credentials one owner: interim env/namespace-scoped, non-swallowing config read; radical — ingest resolves its own credentials_ref via a ResolveSourceCredential RPC (or server-side extraction), deleting the agent's dev-scoped plaintext-key path.

## Reviewers

Canonical snapshot from `docs/runbooks/reviewer-registry.md` (stable unless `/sdd-spec` re-runs).

| Reviewer | Focus |
|---|---|
| xstockstrat-agent (service owner) | MCP tool contract stability (name, parameters, return shape) and `docs/runbooks/mcp-tools.md` parity; no secret values in tool output or the unauthenticated `GET /api/tools` catalog |
| Security | No secrets resolved from non-`secret.*` config; secret keys use the `secret.*` prefix; auth-scope correctness (this fix removes a plaintext-config credential read and env-scopes the OAuth DCR reads) |

## Next Action

`/sdd-review fix-mcp-extract-credentials impl-spec` — validate implementation spec, then `/sdd-execute fix-mcp-extract-credentials`
