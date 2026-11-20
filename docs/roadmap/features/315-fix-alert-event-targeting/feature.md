# Feature: fix-alert-event-targeting

**Type**: bug
**Development Branch**: `feature/fix-alert-event-targeting`
**GitHub Issue**: none (Issues disabled) — reports: docs/reports/2026-10-21-trading-untargeted-per-account-alerts-defect.md, docs/reports/2026-10-19-portfolio-concentration-logged-as-drawdown-defect.md
**Severity**: SEV-2
**Created**: 2026-11-10
**Last Updated**: 2026-11-20

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-11-10 | `bug-reported` → `draft` | /sdd-triage | Product spec pre-populated from 2 defect report(s) (clustered triage) |
| 2026-11-10 | `draft` → `spec-ready` | /sdd-review | Product spec approved (4 warnings) |
| 2026-11-20 | `spec-ready` → `design-approved` | /sdd-design | Design debated (3 rounds, full) and approved; recon.md + debate.md + design.md written |

---

## Artifacts

- [Product Spec](product-spec.md) — bug description and fix scope
- [Acceptance Scenarios](acceptance.feature) — regression scenario(s) (`@AC-*`, C-15)
- [Recon](recon.md) — grounded codebase dossier
- [Debate Register](debate.md) — settled decisions, rejected alternatives, objections
- [Design](design.md) — approved approach, open risks, business rules touched
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec fix-alert-event-targeting`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Per-account risk signals lose their owner: trading's per-account halt and reconciliation CRITICAL alerts carry no
`TargetUserId` (owner gets no Web Push after feature 242), and portfolio records concentration breaches as
`portfolio.risk.drawdown_breach` ledger events with no user/account/symbol attribution.

## Next Action

`/sdd-spec fix-alert-event-targeting` — generate implementation spec from the approved design
