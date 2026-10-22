# Feature: fix-trading-order-state-audit

**Type**: bug
**Development Branch**: `feature/fix-trading-order-state-audit`
**GitHub Issue**: none (Issues disabled). Defect report: `docs/reports/2026-10-21-trading-order-state-audit-defect.md`
**Severity**: SEV-2
**Created**: 2026-10-21
**Last Updated**: 2026-10-21

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-10-21 | `bug-reported` → `draft` | /sdd-triage | Product spec pre-populated from `docs/reports/2026-10-21-trading-order-state-audit-defect.md` (debt-radar D-04, D-62) |

---

## Reviewers

Snapshot from `docs/runbooks/reviewer-registry.md` at /sdd-triage time (2026-10-21). `/sdd-spec` overwrites it with per-step assignments.

| Reviewer | Focus | Steps |
|---|---|---|
| `xstockstrat-trading` owner | Order execution correctness, broker API safety, fill detection, paper-only dev invariant, position limit enforcement | TBD (/sdd-spec) |
| `xstockstrat-ledger` owner | Append-only invariant, event ordering | Read-only: a new `order_intent.reclaimed_unknown` emit site reuses an existing event type; no ledger change expected |

---

## Artifacts

- [Product Spec](product-spec.md) — bug description and fix scope
- [Acceptance Scenarios](acceptance.feature) — regression scenario(s) (`@AC-*`, C-15)
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec fix-trading-order-state-audit`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Trading discards the error from four `UpsertOrder` writes on timeout/reject/cancel/replace paths and all
results from three reactive `ReclaimOrphanIntent` calls, so order-state loss is never logged and
reactive intent reclaims leave no `order_intent.reclaimed_unknown` audit event.

## Next Action

`/sdd-design fix-trading-order-state-audit quick` — recommended design depth: quick (SEV-2, single service, no proto/migration/config); see context.md
