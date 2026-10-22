# Feature: fix-ingest-seeded-config-keys

**Type**: bug
**Development Branch**: `feature/fix-ingest-seeded-config-keys`
**GitHub Issue**: none (Issues disabled). Defect report: `docs/reports/2026-10-22-ingest-seeded-config-keys-never-read-defect.md`
**Severity**: SEV-3
**Created**: 2026-10-22
**Last Updated**: 2026-10-22

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-10-22 | `bug-reported` → `draft` | /sdd-triage | Product spec pre-populated from the defect report; Track C |

---

## Artifacts

- [Product Spec](product-spec.md) — bug description and fix scope
- [Acceptance Scenarios](acceptance.feature) — regression scenario(s) (`@AC-*`, C-15)
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec fix-ingest-seeded-config-keys`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

The five `ingest` config keys seeded by config migrations are stored without the `ingest.` prefix, but ingest reads them with it, so the reads miss the snapshot and operators cannot tune MCP polling or backfill chunking.

## Next Action

`/sdd-design fix-ingest-seeded-config-keys` — recommended design depth: full (two services, a config migration or key change, and a platform-wide sweep question); see context.md
