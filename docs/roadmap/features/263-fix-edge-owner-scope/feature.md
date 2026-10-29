# Feature: fix-edge-owner-scope

**Type**: bug
**Development Branch**: `feature/fix-edge-owner-scope`
**GitHub Issue**: none (Issues disabled). Defect report: `docs/reports/2026-10-21-edge-owner-scope-defect.md`
**Severity**: SEV-2
**Created**: 2026-10-21
**Last Updated**: 2026-10-29

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-10-21 | `bug-reported` → `draft` | /sdd-triage | Product spec pre-populated from `docs/reports/2026-10-21-edge-owner-scope-defect.md` (debt-radar D-25, D-31) |
| 2026-10-22 | `draft` → `spec-ready` | /sdd-review | Product spec approved (8 warnings) |
| 2026-10-22 | `spec-ready` → `design-approved` | /sdd-design | Design debated (2 rounds, full) and approved; recon.md + design.md written |
| 2026-10-22 | `design-approved` → `implementation-ready` | /sdd-spec | Implementation spec generated with 12 steps |
| 2026-10-28 | `implementation-ready` (unchanged) | /sdd-execute (re-spec) | Steps 2, 5, 6, 7, 8, 9, 10, 11 and 12 re-aligned with the codebase after the main-dev merge (line drift; Step 2 grpcio-tools setup; Step 12 item 6 is now verify-only because the 257-after-263 row already exists) |
| 2026-10-28 | `implementation-ready` → `in-progress` | /sdd-execute sequential (sdd-batch-execute) | Execution started; up-front plan confirmed by operator standing authorization (session_01NpS3HShZK6pSnogA7CFo2f) |
| 2026-10-29 | `in-progress` (unchanged) | /sdd-execute (re-spec) | Steps 7, 8, 10 and 12 re-aligned with the codebase after the main-dev merge (line drift only; Files unchanged) |
| 2026-10-29 | `in-progress` (unchanged) | /sdd-execute (re-spec) | Steps 9, 10, 11 and 12 re-aligned with the codebase after the second 2026-10-29 main-dev merge (line drift only; Files unchanged) |

---

## Reviewers

Snapshot from `docs/runbooks/reviewer-registry.md` at /sdd-spec time (2026-10-22), per-step assignments.

| Reviewer | Focus | Steps |
|---|---|---|
| Proto Reviewer | Field number uniqueness, no breaking change, `buf lint` / `buf breaking` pass, BSR readiness | 1, 2 |
| `xstockstrat-ledger` owner | Append-only invariant, event ordering; `QueryEvents.owner_only` contract | 1, 2, 3, 4 |
| `xstockstrat-ui` owner | Connect-RPC call safety, trader BFF IDOR guards, no regression of position lineage / reconciliation status | 1, 2, 5, 6, 7 |
| `xstockstrat-config` owner | Global/per-user scoping on reads, secret redaction, WatchConfig stream stability | 8, 9 |
| `xstockstrat-agent` owner | MCP tool contract stability (`get_config` / `list_config_keys` parameters and return shape), `docs/runbooks/mcp-tools.md` parity | 10, 11 |
| Security | Auth scope: a caller reads only their own data; admin override explicit | 3, 5, 8 |

---|---|---|
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
- [Implementation Spec](implementation-spec.md) — 12 numbered steps with codebase evidence
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

The trader BFF forwards any non-copilot (or empty) stream key to a ledger `QueryEvents` that has no owner filter,
and the agent's `get_config` / `list_config_keys` pass a caller-chosen `user_id` that config trusts over the
verified `x-user-id`; either lets a signed-in user read another user's data.

## Next Action

`/sdd-execute fix-edge-owner-scope sequential` — Steps 1–9 done; continue at Step 10 (agent echoes the effective `user_id`; docstrings state the bind)
