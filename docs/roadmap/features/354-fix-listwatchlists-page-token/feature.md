# Feature: fix-listwatchlists-page-token

**Type**: bug
**Development Branch**: `ccr-fix-listwatchlists-page-token` (harness `ccr-*` branch off `main-dev`, used in place of `feature/fix-listwatchlists-page-token`)
**GitHub Issue**: none (Issues disabled) — defect report `docs/reports/2026-11-16-portfolio-listwatchlists-page-token-skips-boundary-row-defect.md`
**Severity**: SEV-2
**Created**: 2026-11-16
**Last Updated**: 2026-11-16

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-11-16 | `bug-reported` → `draft` | /sdd-triage | Product spec pre-populated from defect report `docs/reports/2026-11-16-portfolio-listwatchlists-page-token-skips-boundary-row-defect.md` |

---

## Artifacts

- [Product Spec](product-spec.md) — bug description and fix scope
- [Acceptance Scenarios](acceptance.feature) — regression scenario(s) (`@AC-*`, C-15)
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec fix-listwatchlists-page-token`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

`ListWatchlists` returns the look-ahead row's id as `next_page_token`, and the exclusive keyset filter then skips that row, so every page boundary silently drops one watchlist.

## Next Action

`/sdd-design fix-listwatchlists-page-token quick` — recommended design depth (quick) from triage; see context.md
