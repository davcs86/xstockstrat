# Feature: fix-config-watcher-client-id

**Type**: bug
**Development Branch**: `feature/fix-config-watcher-client-id`
**Defect Report**: `docs/reports/2026-09-04-comment-audit-triage.md` (item 4) — GitHub Issues disabled on this repo
**Severity**: SEV-3
**Created**: 2026-09-04
**Last Updated**: 2026-09-04

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-09-04 | `bug-reported` → `draft` | /sdd-triage | Product spec pre-populated from comment-audit report item 4 (re-confirms open question) |

---

## Artifacts

- [Product Spec](product-spec.md) — bug description and fix scope
- [Acceptance Scenarios](acceptance.feature) — regression scenario(s) (`@AC-*`, C-15)
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec fix-config-watcher-client-id`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

The analysis and ingest config watchers both build `WatchConfig` requests with
`client_id=f"indicators-{id(self)}"` — copied verbatim from the indicators watcher template. The
`analysis` and `ingest` subscribers therefore both identify to `xstockstrat-config` as `indicators-…`.
Fix depends on a maintainer decision: is `client_id` significant to the config service's subscriber
identification/dedup (in which case the collision is a real defect), or a harmless label to correct
to `analysis-` / `ingest-`?

## Next Action

`/sdd-design fix-config-watcher-client-id quick` — recommended design depth (quick); see context.md
