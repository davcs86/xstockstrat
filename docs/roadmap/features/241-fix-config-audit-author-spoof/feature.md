# Feature: fix-config-audit-author-spoof

**Type**: bug
**Development Branch**: `feature/fix-config-audit-author-spoof`
**GitHub Issue**: none (Issues disabled). Defect report: `docs/reports/2026-10-19-config-audit-author-caller-spoofable-defect.md`
**Severity**: SEV-2
**Created**: 2026-10-20
**Last Updated**: 2026-10-20

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-10-20 | `bug-reported` → `draft` | /sdd-triage | Product spec pre-populated from `docs/reports/2026-10-19-config-audit-author-caller-spoofable-defect.md` |
| 2026-10-20 | `draft` → `spec-ready` | /sdd-review | Product spec approved (9 warnings) |

---

## Reviewers

Provisional snapshot from `docs/runbooks/reviewer-registry.md` at /sdd-triage time (2026-10-20). `/sdd-spec` overwrites it with per-step assignments.

| Reviewer | Focus |
|---|---|
| `xstockstrat-config` owner | Config key naming (`<service>.<category>.<key>`), environment (`production`/`staging`) / global-per-user scoping, secret encryption + redaction, WatchConfig stream stability |
| `xstockstrat-agent` owner | MCP tool contract stability (name, parameters, return shape) and `docs/runbooks/mcp-tools.md` parity; admin `x-access-scope` forwarded only by the management tools; no secret values in tool output |
| Security | Auth scope and audit attribution: attribution must derive from verified headers (`x-user-id` / `x-internal-caller`), never request-body free text |
| Proto Reviewer + `packages/proto` owner | Only if design deprecates or repurposes `SetConfigRequest.author` (field 4): deprecation comment, no removal, `buf breaking` passes |

---

## Artifacts

- [Product Spec](product-spec.md) — bug description and fix scope
- [Acceptance Scenarios](acceptance.feature) — regression scenario(s) (`@AC-*`, C-15)
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec fix-config-audit-author-spoof`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

`SetConfig` authorizes on the verified `x-user-id` / `x-access-scope` but records the caller-supplied free-text
`author` as `updated_by` / `config_audit.changed_by`, so any admin (or a user on their own per-user row) can
attribute a write to someone else. The MCP `set_config` tool passes `author` straight through.

## Next Action

`/sdd-design fix-config-audit-author-spoof` (full — operator: no quick designs)
