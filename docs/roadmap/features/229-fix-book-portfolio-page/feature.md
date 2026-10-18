# Feature: fix-book-portfolio-page

**Type**: bug
**Development Branch**: `ccr-9f55a8ac-dtw4iv` (harness-assigned; see context.md)
**GitHub Issue**: none (Issues disabled) — defect report `docs/reports/2026-10-16-portfolio-page-stuck-loading-defect.md`
**Severity**: SEV-2
**Created**: 2026-10-16
**Last Updated**: 2026-10-16

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-10-16 | `bug-reported` → `draft` | /sdd-triage | Product spec pre-populated from `docs/reports/2026-10-16-portfolio-page-stuck-loading-defect.md` |
| 2026-10-16 | `draft` → `spec-ready` | /sdd-review | Product spec approved on round 2 (7 warnings carried to design) |
| 2026-10-18 | `spec-ready` → `design-approved` | /sdd-design | Design debated (4 rounds, quick extended by operator) and approved; recon.md + design.md written |

---

## Artifacts

- [Product Spec](product-spec.md) — bug description and fix scope
- [Acceptance Scenarios](acceptance.feature) — regression scenario(s) (`@AC-*`, C-15)
- [Recon](recon.md) — codebase dossier, existing business rules (C-16)
- [Design](design.md) — approved design (4 rounds), rejected alternatives, open risks, staging gates G1–G4
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec fix-book-portfolio-page`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Book → Portfolio stays on "Loading portfolio…" forever. Portfolio's quote enrichment waits with no deadline on marketdata
`GetLatestQuotes`, whose batch query scans every hourly chunk of the never-pruned `marketdata.quotes` hypertable and starves
marketdata's 2-connection pool.

## Next Action

`/sdd-spec fix-book-portfolio-page` — generate implementation spec from the approved design