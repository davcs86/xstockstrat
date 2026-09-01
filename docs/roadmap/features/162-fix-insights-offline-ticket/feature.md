# Feature: fix-insights-offline-ticket

**Type**: bug
**Development Branch**: `feature/fix-insights-offline-ticket`
**Defect Report**: `docs/reports/2026-08-27-insights-signal-ticket-offline-account-flake-defect.md`
**Severity**: SEV-3
**Created**: 2026-08-27
**Last Updated**: 2026-08-27
**Archived**: 2026-09-01
**Committed to main**: 57e40a310ed09b205ce76ca440ee7a40a87fb7ec
**Launched date**: 2026-08-30

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-08-27 | `bug-reported` → `draft` | /sdd-triage | Product spec pre-populated from defect report (Issues disabled; --from-report path) |
| 2026-08-27 | `draft` → `code-completed` | claude | Root cause pinned + one-line fix implemented (`allowOfflineRecord={false}` on the unified position/Signal-detail order ticket); implementation-spec written; regression @AC-1 verified |

| 2026-08-30 | `code-completed` → `launched` | CI workflow | Promoted via PR #1047; committed 57e40a310ed09b205ce76ca440ee7a40a87fb7ec |
| 2026-09-01 | `launched` (unchanged) | /sdd-archiver | Archived — synthesis to context.md + 1 insight + 1 fail to Ledger; product-spec.md, implementation-spec.md pruned; @AC-1 promoted to per-service acceptance suite. |
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

Fix implemented on branch `claude/fix-162-gp2epi` (PR into `main-dev`). After merge and promotion,
flip to `launched`; the `@AC-1` regression scenario in `acceptance.feature` guards against recurrence.
