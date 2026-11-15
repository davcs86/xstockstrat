# Feature: fix-fundamentals-roe-unit

**Type**: bug
**Development Branch**: `feature/fix-fundamentals-roe-unit`
**GitHub Issue**: n/a (Issues disabled) — report `docs/reports/2026-11-15-marketdata-roe-value-implausible-defect.md`
**Severity**: SEV-3
**Created**: 2026-11-15
**Last Updated**: 2026-11-15

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-11-15 | `bug-reported` → `draft` | /sdd-triage | Product spec pre-populated from the defect report |
| 2026-11-15 | `draft` → `spec-ready` | /sdd-review | Product spec approved (6 warnings) |
| 2026-11-15 | `spec-ready` → `design-approved` | /sdd-design | Design debated (6 rounds, full; rounds cap lifted by the operator) and approved; recon.md + debate.md + design.md written |

---

## Artifacts

- [Product Spec](product-spec.md) — bug description and fix scope
- [Acceptance Scenarios](acceptance.feature) — regression scenario(s) (`@AC-*`, C-15)
- [Recon](recon.md) — grounded codebase dossier and root-cause trace
- [Debate Register](debate.md) — settled decisions, locked rejected alternatives, objections
- [Design](design.md) — approved approach, rejected alternatives, open risks
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec fix-fundamentals-roe-unit`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Staging serves `roe ≈ 3.66` for LYFT (rendered `+366.34%`), inconsistent with its market cap, P/B and EPS; suspected percent-vs-fraction unit error on one fundamentals provider path.

## Next Action

`/sdd-spec fix-fundamentals-roe-unit` — generate implementation spec from the approved design
