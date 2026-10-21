# Feature: fix-edgar-companyfacts-decode

**Type**: bug
**Development Branch**: `feature/fix-edgar-companyfacts-decode`
**GitHub Issue**: none (Issues disabled) — defect report `docs/reports/2026-10-21-edgar-companyfacts-string-cik-defect.md`
**Severity**: SEV-3
**Created**: 2026-10-21
**Last Updated**: 2026-10-21

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-10-21 | `bug-reported` → `draft` | /sdd-triage | Product spec pre-populated from defect report `docs/reports/2026-10-21-edgar-companyfacts-string-cik-defect.md` |

---

## Artifacts

- [Product Spec](product-spec.md) — bug description and fix scope
- [Acceptance Scenarios](acceptance.feature) — regression scenario(s) (`@AC-*`, C-15)
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec fix-edgar-companyfacts-decode`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

The EDGAR companyfacts decode fails for filers whose `cik` SEC serves as a zero-padded string (CRCL, ELWT, PSKY,
RDDT), so their fundamentals history is never stored and every snapshot read falls back to the vendor.

## Next Action

`/sdd-spec fix-edgar-companyfacts-decode` — recommended design depth: skip (see context.md)
