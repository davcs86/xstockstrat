# Feature: fix-analysis-owner-scope

**Type**: bug
**Development Branch**: `feature/fix-analysis-owner-scope`
**GitHub Issue**: none (Issues disabled). Defect report: `docs/reports/2026-10-21-analysis-owner-scope-defect.md`
**Severity**: SEV-2
**Created**: 2026-10-21
**Last Updated**: 2026-10-21

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-10-21 | `bug-reported` → `draft` | /sdd-triage | Product spec pre-populated from `docs/reports/2026-10-21-analysis-owner-scope-defect.md` (debt-radar D-44, D-55, D-60) |
| 2026-10-21 | `draft` → `spec-ready` | /sdd-review | Product spec approved (5 warnings; 3 resolved in-spec: AC-3 ids, new AC-8, FR-1 per-pair isolation). Overlap WARN (file-level: 244, 259, 215/244/245) |

---

## Reviewers

Snapshot from `docs/runbooks/reviewer-registry.md` at /sdd-triage time (2026-10-21). `/sdd-spec` overwrites it with per-step assignments.

| Reviewer | Focus | Steps |
|---|---|---|
| `xstockstrat-analysis` owner | Backtest reproducibility, strategy scoring determinism, no look-ahead bias | TBD (/sdd-spec) — `entry_backfill.py` (D-44, D-55), `repositories/strategies.py` + tests (D-60) |
| `xstockstrat-trading` owner | Order execution correctness, fill detection | Read-only: `ListOrders` empty-`user_id` semantics (trading fix tracked by `2026-10-19-trading-listorders-body-user-id-filter-defect`) |
| Security | Auth scope | Tenant isolation: owner header + body `user_id` on the cross-service read (PLAT-11) |

---

## Artifacts

- [Product Spec](product-spec.md) — bug description and fix scope
- [Acceptance Scenarios](acceptance.feature) — regression scenario(s) (`@AC-*`, C-15)
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec fix-analysis-owner-scope`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

The analysis boot entry-backfill calls trading `ListOrders` with no owner, so one owner's live entry state can be
seeded from another owner's orders. The same pass dies on one empty or `system` owner despite its "never raises"
contract. The strategies repository keeps an owner-agnostic, caller-less `update`.

## Next Action

`/sdd-design fix-analysis-owner-scope` — recommended design depth: full (2 affected services, tenant isolation; trading is read-only — operator may downgrade to quick); open design items in context.md (sdd-review session)
