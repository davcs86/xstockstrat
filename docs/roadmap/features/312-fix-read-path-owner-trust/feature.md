# Feature: fix-read-path-owner-trust

**Type**: bug
**Development Branch**: `feature/fix-read-path-owner-trust`
**GitHub Issue**: none (Issues disabled) — reports: `docs/reports/2026-10-19-trading-listorders-body-user-id-filter-defect.md`, `docs/reports/2026-10-19-portfolio-default-identity-fallback-defect.md`, `docs/reports/2026-10-19-notify-listalerts-owner-fallback-unscoped-defect.md`
**Severity**: SEV-3
**Created**: 2026-11-10
**Last Updated**: 2026-11-10

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-11-10 | `bug-reported` → `draft` | /sdd-triage | Product spec pre-populated from 3 defect report(s) (clustered triage) |
| 2026-11-10 | `draft` → `spec-ready` | /sdd-review | Product spec approved (4 warnings) |

---

## Artifacts

- [Product Spec](product-spec.md) — bug description and fix scope
- [Acceptance Scenarios](acceptance.feature) — regression scenario(s) (`@AC-*`, C-15)
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec fix-read-path-owner-trust`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Read and consume paths take ownership from somewhere other than the trusted `x-user-id` header (PLAT-11):
trading `ListOrders`/`StreamOrderUpdates` and notify `ListAlerts` trust a body user id (empty = all users),
and portfolio files identity-less events under placeholder owners that trading's `RegisterBrokerAccount`
can produce.

## Next Action

`/sdd-design fix-read-path-owner-trust` — full design recommended (proto (additive); 5 services)
