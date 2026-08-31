# Feature: agent-broker-account-tools

**Development Branch**: `feature/agent-broker-account-tools`
**Created**: 2026-08-27
**Last Updated**: 2026-08-27
**Committed to main**: 57e40a310ed09b205ce76ca440ee7a40a87fb7ec
**Launched date**: 2026-08-30
**Archived**: 2026-08-31

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-08-27 | `idea` → `draft` | /sdd-story | Product spec generated |
| 2026-08-27 | `draft` → `design-approved` | /sdd-design | Design debated (1 round, quick) and approved; recon.md + design.md written |
| 2026-08-27 | `design-approved` → `implementation-ready` | /sdd-spec | Implementation spec generated with 5 steps |
| 2026-08-27 | `implementation-ready` → `code-completed` | /sdd-execute | All 5 steps implemented + verified (316 pass, 77% cov); ledger tool-count sync deviation recorded |

| 2026-08-30 | `code-completed` → `launched` | CI workflow | Promoted via PR #1047; committed 57e40a310ed09b205ce76ca440ee7a40a87fb7ec |
| 2026-08-31 | archived | /sdd-archiver | Synthesis distilled to context.md + Ledger (2 insights, 2 fails); 8 scenarios promoted to services/xstockstrat-agent/acceptance/; product-spec.md, recon.md, design.md, implementation-spec.md pruned (recoverable from git) |
---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Acceptance Scenarios](acceptance.feature) — Gherkin `@AC-*` scenarios (single source of acceptance truth, C-15)
- [Recon Dossier](recon.md) — grounded codebase map (Phase 0)
- [Design](design.md) — debated + approved architecture (Phase 1)
- [Implementation Spec](implementation-spec.md)
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Expose broker-account management through the MCP agent: a `manage_account` write tool (register /
update-credentials / deregister a broker account) and a `list_accounts` read tool that returns the
caller's broker **and** offline accounts together — all ownership-gated on the caller's `x-user-id`,
with broker credentials passing through to the trading backend and never echoed back.

## Reviewers

_(Auto-populated from docs/runbooks/reviewer-registry.md based on affected services and
change types. Override as needed for this feature. Snapshot finalized at /sdd-spec time —
re-run /sdd-spec if the registry changes.)_

| Role | Review Focus |
|---|---|
| `xstockstrat-agent` owner | MCP tool contract stability (name, parameters, return shape) and `docs/runbooks/mcp-tools.md` parity; tool-count statements kept in sync across all inventory surfaces; ownership `x-user-id` forwarding; no secret/credential values in tool output |
| `xstockstrat-trading` owner | Broker API safety, ownership resolution on account RPCs, credential handling |

## Next Action

`/sdd-review agent-broker-account-tools impl-spec` — validate implementation spec, then `/sdd-execute agent-broker-account-tools`
