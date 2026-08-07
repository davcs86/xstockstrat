# Feature: fix-mcp-target-user-authz

**Type**: bug
**Lifecycle Status**: `launched`
**Committed to main**: 856ad5a3a2ebc431c108cc7f508deb26885545c6
**Launched date**: 2026-08-07
**Development Branch**: `feature/fix-mcp-target-user-authz` (implemented on harness-pinned `claude/remove-target-user-mcp-g4tfqm` — see context.md)
**Source Report**: docs/reports/2026-08-07-mcp-target-user-authz.md
**Severity**: SEV-2
**Created**: 2026-08-07
**Last Updated**: 2026-08-07

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-08-07 | `bug-reported` → `draft` | /sdd-triage | Product spec pre-populated from docs/reports/2026-08-07-mcp-target-user-authz.md |
| 2026-08-07 | `draft` → `design-approved` | /sdd-design | Design debated (2 rounds, quick) and approved; recon.md + design.md written. emit_alert's target_user_id becomes a required broadcast: bool (no default); manage_formula's author + formula_author_user_id both derived from OAuth claims via new shared _require_claims/_caller_user_id helpers. No client.py/proto changes. |
| 2026-08-07 | `design-approved` → `implementation-ready` | /sdd-spec | Implementation spec generated with 7 steps (shared claims primitive; emit_alert + manage_formula rewires, each paired with a test step; docs rewrite of both tools' mcp-tools.md sections). |
| 2026-08-07 | `implementation-ready` → `code-completed` | /sdd-execute | All 7 steps implemented directly on harness-pinned branch `claude/remove-target-user-mcp-g4tfqm` (red-before-green proven per step-pair); 208 tests passing, ruff clean. `docs/runbooks/mcp-tools.md` rewritten. PR #886. |

| 2026-08-07 | `code-completed` → `launched` | CI workflow | Promoted via PR #878; committed 856ad5a3a2ebc431c108cc7f508deb26885545c6 |
---

## Artifacts

- [Product Spec](product-spec.md) — bug description, fix scope, and Consumer Surface(s)
- [Recon](recon.md) — codebase map and target-parameter inventory
- [Design](design.md) — chosen approach, rejected alternatives, open risks
- [Implementation Spec](implementation-spec.md) — 7/7 steps done
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

`emit_alert` and `manage_formula` accept a caller-supplied user-identity parameter
(`target_user_id`, `formula_author_user_id`, and `author`) instead of deriving the caller's
identity from the verified OAuth claims. Remove all three parameters and tie the affected
calls/permission checks to the OAuth-authenticated caller.

## Reviewers

| Role | Focus |
|---|---|
| `xstockstrat-agent` (service owner) | MCP tool contract stability (name, parameters, return shape) and `docs/runbooks/mcp-tools.md` parity; OAuth 2.1 edge-auth correctness and statelessness |
| Security | Identity, API keys, secrets, auth scope — no secrets in config service state, secret keys use `secret.*` prefix, JWT claims minimal, API key scoping correct |

## Next Action

PR #886 open against `main-dev`. Awaiting CI + review; the `context-scrubber` skill was unavailable
this session (Step 7 Deviation Log) — run `/context-scrubber scan` against `docs/runbooks/mcp-tools.md`
once available, per root CLAUDE.md's Teardown rule.
