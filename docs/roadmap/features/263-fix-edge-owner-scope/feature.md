# Feature: fix-edge-owner-scope

**Type**: bug
**Development Branch**: `feature/fix-edge-owner-scope`
**GitHub Issue**: none (Issues disabled). Defect report: `docs/reports/2026-10-21-edge-owner-scope-defect.md`
**Severity**: SEV-2
**Created**: 2026-10-21
**Last Updated**: 2026-10-22

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-10-21 | `bug-reported` → `draft` | /sdd-triage | Product spec pre-populated from `docs/reports/2026-10-21-edge-owner-scope-defect.md` (debt-radar D-25, D-31) |
| 2026-10-22 | `draft` → `spec-ready` | /sdd-review | Product spec approved (8 warnings) |
| 2026-10-22 | `spec-ready` → `design-approved` | /sdd-design | Design debated (2 rounds, full) and approved; recon.md + design.md written |

---

## Reviewers

Snapshot from `docs/runbooks/reviewer-registry.md` at /sdd-triage time (2026-10-21). `/sdd-spec` overwrites it with per-step assignments.

| Reviewer | Focus | Steps |
|---|---|---|
| `xstockstrat-ui` owner | Connect-RPC call safety, trader BFF IDOR guards, no regression of position lineage / reconciliation status | TBD (/sdd-spec) |
| `xstockstrat-ledger` owner | Append-only invariant, event ordering; QueryEvents contract if an owner predicate is added backend-side | TBD (/sdd-spec) |
| `xstockstrat-agent` owner | MCP tool contract stability (`get_config` / `list_config_keys` parameters and return shape), `docs/runbooks/mcp-tools.md` parity | TBD (/sdd-spec) |
| `xstockstrat-config` owner | Global/per-user scoping on reads, WatchConfig stream stability for internal per-user subscribers | TBD (/sdd-spec) |
| Security | Auth scope: a caller reads only their own per-user data; admin override, if kept, is explicit | All steps |

---

## Artifacts

- [Product Spec](product-spec.md) — bug description and fix scope
- [Acceptance Scenarios](acceptance.feature) — regression scenario(s) (`@AC-*`, C-15)
- [Recon](recon.md) — grounded codebase dossier (Phase 0)
- [Design](design.md) — approved approach, rejected alternatives, open risks (Phase 1)
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec fix-edge-owner-scope`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

The trader BFF forwards any non-copilot (or empty) stream key to a ledger `QueryEvents` that has no owner filter,
and the agent's `get_config` / `list_config_keys` pass a caller-chosen `user_id` that config trusts over the
verified `x-user-id`; either lets a signed-in user read another user's data.

## Next Action

`/sdd-spec fix-edge-owner-scope` — generate implementation spec from the approved design
