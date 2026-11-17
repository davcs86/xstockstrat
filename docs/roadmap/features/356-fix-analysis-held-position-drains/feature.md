# Feature: fix-analysis-held-position-drains

**Type**: bug
**Development Branch**: `feature/fix-analysis-held-position-drains`
**GitHub Issue**: none — Issues disabled; defect report `docs/reports/2026-11-17-analysis-held-position-drains-trust-page-token-defect.md`
**Severity**: SEV-3
**Created**: 2026-11-17
**Last Updated**: 2026-11-17

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-11-17 | `bug-reported` → `draft` | /sdd-triage | Product spec pre-populated from `docs/reports/2026-11-17-analysis-held-position-drains-trust-page-token-defect.md` |

---

## Artifacts

- [Product Spec](product-spec.md) — bug description and fix scope
- [Acceptance Scenarios](acceptance.feature) — regression scenario(s) (`@AC-*`, C-15)
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec fix-analysis-held-position-drains`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Harden the two analysis consumers that page portfolio `ListPositions` (`live_loop._drain_held`, `servicer._drain_held_symbols`): reject a repeated token, make a page-cap hit visible, and stop returning a partial or duplicated held set as success.

## Next Action

`/sdd-design fix-analysis-held-position-drains quick` — recommended design depth (quick) from triage; see context.md
