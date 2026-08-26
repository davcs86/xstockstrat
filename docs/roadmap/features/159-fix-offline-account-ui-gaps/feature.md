# Feature: fix-offline-account-ui-gaps

**Type**: bug
**Development Branch**: `feature/fix-offline-account-ui-gaps`
**Defect Report**: `docs/reports/2026-08-26-offline-account-ui-gaps-defect.md` (GitHub Issues disabled — report is the source)
**Severity**: SEV-3
**Created**: 2026-08-26
**Last Updated**: 2026-08-26

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-08-26 | `bug-reported` → `draft` | /sdd-triage | Product spec pre-populated from defect report (offline-account UI gaps found on staging) |

---

## Artifacts

- [Product Spec](product-spec.md) — bug description and fix scope
- [Acceptance Scenarios](acceptance.feature) — regression scenario(s) (`@AC-*`, C-15)
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec fix-offline-account-ui-gaps`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Two UI-correctness gaps in the shipped-to-staging feature 157 (offline-account-portfolios): the
`/trader` broker order ticket accepts orders on an offline account (one landed CANCELED instead of a
recorded NEW offline order), and the portfolio surface shows broker-only equity/cash/buying-power/
day-P&L fields that don't apply to an offline account (misleading). A sibling gap ("Edit keys" on
offline accounts) was already fixed inline on the 157 branch (commit `dcd2fe5`).

## Next Action

`/sdd-design fix-offline-account-ui-gaps quick` — recommended design depth (quick); see context.md.
