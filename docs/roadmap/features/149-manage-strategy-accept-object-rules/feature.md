# Feature: manage-strategy-accept-object-rules

**Development Branch**: `feature/manage-strategy-accept-object-rules`
**Created**: 2026-08-22
**Last Updated**: 2026-08-22

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-08-22 | `idea` → `draft` | /sdd-story | Product spec generated |
| 2026-08-22 | `draft` → `design-approved` | /sdd-design | Design debated (3 rounds, quick-mode extended by operator) and approved; recon.md + design.md written. Product-spec review skipped per operator's quick-path direction (recorded in context.md). |
| 2026-08-22 | `design-approved` → `implementation-ready` | /sdd-spec | Implementation spec generated with 3 steps |
| 2026-08-22 | `implementation-ready` → `code-completed` | direct-impl | All 3 steps implemented on `claude/register-trading-strategies-uoqhuk`; 273 agent tests pass (78% cov), ruff clean, proto-parity guard green, red-before-green demonstrated. |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Acceptance Scenarios](acceptance.feature) — Gherkin `@AC-*` scenarios (single source of acceptance truth, C-15)
- [Recon Dossier](recon.md) — grounded codebase facts (Phase 0)
- [Design](design.md) — debated, approved architecture (Phase 1)
- [Implementation Spec](implementation-spec.md)
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Widen the `manage_strategy` MCP tool's `entry_rule`/`exit_rule` params to accept a JSON **object**
(dict) in addition to a JSON string, normalizing dicts to a JSON string in the agent wrapper, so any
MCP client can register a strategy regardless of whether its transport pre-parses JSON-object
arguments.

## Reviewers

_(Auto-populated from docs/runbooks/reviewer-registry.md based on affected services and
change types. Override as needed for this feature. Snapshot finalized at /sdd-spec time —
re-run /sdd-spec if the registry changes.)_

| Role | Review Focus |
|---|---|
| `xstockstrat-agent` service owner | MCP tool contract stability (name, parameters, return shape) and `docs/runbooks/mcp-tools.md` parity; tool-count/inventory surfaces kept in sync; no secret values in tool output |

## Next Action

Open PR into `main-dev` (code-completed). After merge + dev deploy, register the 4 strategies on staging via `manage_strategy`. Named follow-up: `/sdd-story manage-strategy-reject-set-and-clear` (deferred fail-loud guard).
