# Feature: mcp-list-correlation-prompts

**Development Branch**: `feature/mcp-list-correlation-prompts`
**Created**: 2026-09-19
**Last Updated**: 2026-09-19
**Committed to main**: dd622bdc2e5b922df8dcabc6f7475b8b395a8ed3
**Launched date**: 2026-09-24
**Archived**: 2026-10-07

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-09-19 | `idea` → `draft` | /sdd-story | Product spec generated |
| 2026-09-19 | `draft` → `design-approved` | /sdd-design | Design debated (2 rounds, quick) and approved; recon.md + design.md written. (Note: `/sdd-review product-spec` was not run — the Commandment's mandated minimum is story → design-quick.) |
| 2026-09-19 | `design-approved` → `implementation-ready` → `in-progress` → `code-completed` | /sdd-spec + implementation | implementation-spec.md written; all 7 steps landed (prompt body, register_prompts, server instructions, 5 docstrings, parity test, runbook/CLAUDE.md/module-header parity, Teardown). 441 agent tests pass, 79% cov. |

| 2026-09-24 | `code-completed` → `launched` | CI workflow | Promoted via PR #1169; committed dd622bdc2e5b922df8dcabc6f7475b8b395a8ed3 |
| 2026-10-07 | `launched` | /sdd-archiver | Archived: synthesis → context.md + Ledger insights(1)/fails(0); pruned 4 spec(s); acceptance scenarios promoted to per-service suites (C-16) |
---

## Artifacts

- Product Spec — pruned by /sdd-archiver; see [Context Log](context.md) Archive Synthesis
- [Acceptance Scenarios](acceptance.feature) — Gherkin `@AC-*` scenarios (single source of acceptance truth, C-15); promoted to services/xstockstrat-agent/acceptance/mcp-list-correlation-prompts.feature (C-16)
- Recon Dossier — pruned by /sdd-archiver; see [Context Log](context.md) Archive Synthesis
- Design — pruned by /sdd-archiver; see [Context Log](context.md) Archive Synthesis
- Implementation Spec — pruned by /sdd-archiver; see [Context Log](context.md) Archive Synthesis
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Teach an AI MCP client how to use and correlate data across `list_accounts`, `get_positions`,
`get_positions_by_account_id`, `list_opportunities`, and `list_strategies` — via enriched tool
docstrings **and** a new MCP `prompts/list` + `prompts/get` capability that serves a
correlation-guide prompt documenting the `account_id`, `strategy_id`, and `symbol` join keys and
the deliberate non-joins.

## Reviewers

_(Auto-populated from docs/runbooks/reviewer-registry.md based on affected services and
change types. Override as needed for this feature. Snapshot finalized at /sdd-spec time —
re-run /sdd-spec if the registry changes.)_

| Role | Review Focus |
|---|---|
| `xstockstrat-agent` service owner | MCP tool contract stability (name, parameters, return shape) and `docs/runbooks/mcp-tools.md` parity; tool-count statements kept in sync across all six inventory surfaces; new `prompts` capability introduces no user data or secret leakage and stays OAuth-gated |

## Next Action

`/sdd-spec mcp-list-correlation-prompts` — generate implementation spec from the approved design
