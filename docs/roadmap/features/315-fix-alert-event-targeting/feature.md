# Feature: fix-alert-event-targeting

**Type**: bug
**Development Branch**: `feature/fix-alert-event-targeting`
**GitHub Issue**: none (Issues disabled) — reports: docs/reports/2026-10-21-trading-untargeted-per-account-alerts-defect.md, docs/reports/2026-10-19-portfolio-concentration-logged-as-drawdown-defect.md
**Severity**: SEV-2
**Created**: 2026-11-10
**Last Updated**: 2026-11-10

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-11-10 | `bug-reported` → `draft` | /sdd-triage | Product spec pre-populated from 2 defect report(s) (clustered triage) |

---

## Artifacts

- [Product Spec](product-spec.md) — bug description and fix scope
- [Acceptance Scenarios](acceptance.feature) — regression scenario(s) (`@AC-*`, C-15)
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec fix-alert-event-targeting`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Per-account risk signals lose their owner: trading's per-account halt and reconciliation CRITICAL alerts carry no
`TargetUserId` (owner gets no Web Push after feature 242), and portfolio records concentration breaches as
`portfolio.risk.drawdown_breach` ledger events with no user/account/symbol attribution.

## Next Action

`/sdd-design fix-alert-event-targeting` — recommended design depth (full) from triage; see context.md
