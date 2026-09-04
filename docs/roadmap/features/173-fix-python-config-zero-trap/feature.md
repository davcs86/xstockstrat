# Feature: fix-python-config-zero-trap

**Type**: bug
**Development Branch**: `feature/fix-python-config-zero-trap`
**Defect Report**: `docs/reports/2026-09-04-comment-audit-triage.md` (item 3) — GitHub Issues disabled on this repo
**Severity**: SEV-2
**Created**: 2026-09-04
**Last Updated**: 2026-09-04

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-09-04 | `bug-reported` → `draft` | /sdd-triage | Product spec pre-populated from comment-audit report item 3 (re-confirms CF-N10) |
| 2026-09-04 | `draft` → `spec-ready` | /sdd-review | Product spec approved (0 warnings); overlap CLEAN; blockers C-14/C-15 fixed |
| 2026-09-04 | `spec-ready` → `design-approved` | /sdd-design | Design debated (3 rounds, full) and approved; recon.md + design.md written; no Floor breach |
| 2026-09-04 | `design-approved` → `implementation-ready` | /sdd-spec | Implementation spec generated with 6 steps |
| 2026-09-04 | `implementation-ready` → `in-progress` | /sdd-execute | Sequential run started; Step 1 (ingest watcher `get_int_present`) done |

---

## Artifacts

- [Product Spec](product-spec.md) — bug description and fix scope
- [Acceptance Scenarios](acceptance.feature) — regression scenario(s) (`@AC-*`, C-15)
- [Recon Dossier](recon.md) — grounded codebase facts (Phase 0)
- [Design](design.md) — debated, approved architecture (3 rounds, full)
- [Implementation Spec](implementation-spec.md) — numbered steps with codebase evidence (6 steps)
- [Context Log](context.md) — session history, decisions, deviations

---

## Reviewers

| Step category | Service | Reviewers |
|---|---|---|
| service, test | `xstockstrat-ingest` | xstockstrat-ingest — signal normalization correctness, idempotent ingestion, newsletter source schema stability |
| service, test | `xstockstrat-indicators` | xstockstrat-indicators — formula sandboxing, numeric precision, timeout enforcement, no side-effects from formula execution |
| docs | — | none |

---

## Summary

The indicators and ingest config watchers use `v.int_val or default` / `v.float_val or default` /
`v.string_val or default`, so a legitimately-stored `0` / `0.0` / `""` silently reverts to the coded
default. `xstockstrat-analysis` already solved the numeric case with `get_int_present` /
`get_float_present` (`HasField`); indicators and ingest have **no** equivalent, so every 0-meaningful
numeric/string key there is trapped. The `ConfigValue` proto is a `oneof` that distinguishes 0 from
unset, so this is a consumer defect, not a contract limit.

## Next Action

`/sdd-review fix-python-config-zero-trap impl-spec` — validate the implementation spec, then `/sdd-execute fix-python-config-zero-trap`
