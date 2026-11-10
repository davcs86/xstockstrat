# Feature: fix-live-enrich-ttl-seed

**Type**: bug
**Development Branch**: `feature/fix-live-enrich-ttl-seed`
**GitHub Issue**: none (Issues disabled) — reports: docs/reports/2026-10-19-live-enrich-ttl-seed-below-poll-defect.md
**Severity**: SEV-3
**Created**: 2026-11-10
**Last Updated**: 2026-11-10

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-11-10 | `bug-reported` → `draft` | /sdd-triage | Product spec pre-populated from 1 defect report(s) (clustered triage); converted from Track B to Track C by operator decision |
| 2026-11-10 | `draft` → `spec-ready` | /sdd-review | Product spec approved (2 warnings) |

---

## Artifacts

- [Product Spec](product-spec.md) — bug description and fix scope
- [Acceptance Scenarios](acceptance.feature) — regression scenario(s) (`@AC-*`, C-15)
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec fix-live-enrich-ttl-seed`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Config migration 028 seeded the live-enrich memo TTL at `10`s, below the UI's 15s `ListOpportunities` poll, so the feature-177 memo never hits; the analysis code default is now `20`. The stored value must be corrected by a new config migration.

## Next Action

`/sdd-design fix-live-enrich-ttl-seed` — full design recommended (config migration; analysis + ui)
