# Feature: fix-vendor-key-in-url

**Type**: bug
**Development Branch**: `feature/fix-vendor-key-in-url`
**GitHub Issue**: none (Issues disabled) — reports: docs/reports/2026-10-29-marketdata-vendor-key-url-residuals-defect.md
**Severity**: SEV-2
**Created**: 2026-11-10
**Last Updated**: 2026-11-13

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-11-10 | `bug-reported` → `draft` | /sdd-triage | Product spec pre-populated from 1 defect report(s) (clustered triage) |
| 2026-11-10 | `draft` → `spec-ready` | /sdd-review | Product spec approved (2 warnings) |
| 2026-11-13 | `spec-ready` → `design-approved` | /sdd-design | Design debated (3 rounds, full) and approved; recon.md + debate.md + design.md written |

---

## Artifacts

- [Product Spec](product-spec.md) — bug description and fix scope
- [Acceptance Scenarios](acceptance.feature) — regression scenario(s) (`@AC-*`, C-15)
- [Recon](recon.md) — grounded codebase dossier (Phase 0)
- [Debate Register](debate.md) — settled decisions, rejected alternatives, objections
- [Design](design.md) — approved approach, rejected alternatives, open risks
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec fix-vendor-key-in-url`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

The FMP (`apikey=`) and Finnhub (`token=`) API keys still travel in the request query string, so they can
leak through a redirect `Location`-parse error and are recorded in any URL-logging access log on the path.

## Next Action

`/sdd-spec fix-vendor-key-in-url` — generate implementation spec from the approved design
