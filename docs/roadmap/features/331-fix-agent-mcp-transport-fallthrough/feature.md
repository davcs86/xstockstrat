# Feature: fix-agent-mcp-transport-fallthrough

**Type**: bug
**Development Branch**: `feature/fix-agent-mcp-transport-fallthrough`
**GitHub Issue**: none (Issues disabled) — reports: docs/reports/2026-10-19-agent-mcp-transport-stdio-fallthrough-defect.md
**Severity**: SEV-3
**Created**: 2026-11-10
**Last Updated**: 2026-11-20

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-11-10 | `bug-reported` → `draft` | /sdd-triage | Product spec pre-populated from 1 defect report(s) (clustered triage); converted from Track B to Track C by operator decision |
| 2026-11-10 | `draft` → `spec-ready` | /sdd-review | Product spec approved (2 warnings) |
| 2026-11-20 | `spec-ready` → `design-approved` | /sdd-design | Design debated (2 rounds, full) and approved; recon.md + debate.md + design.md written |
| 2026-11-20 | `design-approved` → `implementation-ready` | /sdd-spec | Implementation spec generated with 3 steps |

---

## Artifacts

- [Product Spec](product-spec.md) — bug description and fix scope
- [Acceptance Scenarios](acceptance.feature) — regression scenario(s) (`@AC-*`, C-15)
- [Recon](recon.md) — grounded codebase dossier
- [Debate Register](debate.md) — settled decisions, rejected alternatives, objections
- [Design](design.md) — approved approach, rejected alternatives, open risks
- [Implementation Spec](implementation-spec.md) — 3 steps (one atomic unit: Steps 1+2)
- [Context Log](context.md) — session history, decisions, deviations

---

## Reviewers

_Canonical snapshot from `/sdd-spec` (2026-11-20): the distinct `**Reviewers**` across all 3 steps of
implementation-spec.md, per docs/runbooks/reviewer-registry.md. Stable unless `/sdd-spec` re-runs._

| Role | Review Focus |
|---|---|
| `xstockstrat-agent` owner | MCP tool contract stability (name, parameters, return shape) and `docs/runbooks/mcp-tools.md` parity; OAuth 2.1 edge-auth correctness and statelessness (`instance_count > 1` stays safe) |

---

## Summary

With `MCP_TRANSPORT` unset or mistyped (e.g. `htp`), the agent silently starts the stdio transport — nothing listens on :9000 and no DO health check notices. The agent must fail closed in code instead of falling through to stdio.

## Next Action

`/sdd-review fix-agent-mcp-transport-fallthrough impl-spec` — validate implementation spec, then `/sdd-execute fix-agent-mcp-transport-fallthrough`
