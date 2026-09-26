# Feature: fix-copilotrail-duplicate-rpc

**Type**: bug
**Development Branch**: `feature/fix-copilotrail-duplicate-rpc`
**Defect Report**: `docs/reports/2026-09-26-copilotrail-duplicate-listopportunities-rpc-defect.md` (GitHub Issues disabled on this repo)
**Severity**: SEV-3
**Created**: 2026-09-26
**Last Updated**: 2026-09-26

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-09-26 | `bug-reported` → `draft` | /sdd-triage | Product spec pre-populated from defect report (found during feature 187 QA back-fill). SEV-3, single service, clear root cause → design depth `skip`. |

---

## Artifacts

- [Product Spec](product-spec.md) — bug description and fix scope
- [Acceptance Scenarios](acceptance.feature) — regression scenario (`@AC-*`, C-15)
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec fix-copilotrail-duplicate-rpc`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

On `/insights/opportunities` two `ListOpportunities` RPCs fire because `CopilotRail`'s
`useOpportunities(0)` defaults `sort=UNSPECIFIED` while the page uses `sort=CONVICTION`, so their
React-Query keys differ and the intended page-1 cache share never happens. This violates feature
187's @AC-7 and doubles the read fan-out to `xstockstrat-analysis`.

## Next Action

`/sdd-spec fix-copilotrail-duplicate-rpc` — design depth `skip` (SEV-3, single service, no
proto/migration/config, clear one-line root cause); see context.md.
