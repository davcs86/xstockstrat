# Feature: fix-agent-client-deadlines

**Type**: bug
**Development Branch**: `feature/fix-agent-client-deadlines`
**GitHub Issue**: none (Issues disabled). Defect report: `docs/reports/2026-10-21-agent-client-deadlines-defect.md`
**Severity**: SEV-2
**Created**: 2026-10-21
**Last Updated**: 2026-10-21

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-10-21 | `bug-reported` → `draft` | /sdd-triage | Product spec pre-populated from `docs/reports/2026-10-21-agent-client-deadlines-defect.md` (debt-radar D-16, minus the `get_config_value` call covered by feature 247) |
| 2026-10-21 | `draft` → `spec-ready` | /sdd-review | Product spec approved (7 warnings; overlap WARN: same-file with 247, 215, 241, 249) |

---

## Reviewers

Snapshot from `docs/runbooks/reviewer-registry.md` at /sdd-triage time (2026-10-21). `/sdd-spec` overwrites it with per-step assignments.

| Reviewer | Focus | Steps |
|---|---|---|
| `xstockstrat-agent` owner | MCP tool contract stability (no change to tool names, parameters or return shape), error surfacing for `DEADLINE_EXCEEDED`, statelessness if channels become cached (`instance_count > 1` must stay safe) | TBD (/sdd-spec) |

---

## Artifacts

- [Product Spec](product-spec.md) — bug description and fix scope
- [Acceptance Scenarios](acceptance.feature) — regression scenario(s) (`@AC-*`, C-15)
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec fix-agent-client-deadlines`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Of the agent's 71 unary backend RPCs in `client.py`, only `ListOpportunities` has a deadline (and `get_config_value`
is being fixed by feature 247); every other call hangs an MCP tool indefinitely when a backend stalls.

## Next Action

`/sdd-design fix-agent-client-deadlines` — recommended depth: quick (SEV-2, single service, no proto/migration); see context.md
