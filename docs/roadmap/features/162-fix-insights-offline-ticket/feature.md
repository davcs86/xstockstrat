# Feature: fix-insights-offline-ticket

**Type**: bug
**Development Branch**: `feature/fix-insights-offline-ticket`
**Defect Report**: `docs/reports/2026-08-27-insights-signal-ticket-offline-account-flake-defect.md`
**Severity**: SEV-3
**Created**: 2026-08-27
**Last Updated**: 2026-08-27

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-08-27 | `bug-reported` → `draft` | /sdd-triage | Product spec pre-populated from defect report (Issues disabled; --from-report path) |

---

## Artifacts

- [Product Spec](product-spec.md) — bug description and fix scope
- [Acceptance Scenarios](acceptance.feature) — regression scenario(s) (`@AC-*`, C-15)
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec fix-insights-offline-ticket`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

The insights Signal-detail order ticket (`/insights/market/[symbol]`) flakily renders the offline
"Record Offline Order" control instead of the broker "Place Order" ticket for an offline account,
despite `SignalOrderTicket` passing `allowOfflineRecord={false}` — surfacing as an intermittent
failure of `e2e/trader/offline-accounts.spec.ts:257 @AC-1`.

## Next Action

`/sdd-design fix-insights-offline-ticket quick` — recommended design depth (quick) from triage; see context.md
