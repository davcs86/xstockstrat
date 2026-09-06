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
| 2026-09-04 | `draft` → `spec-ready` | /sdd-review | Product spec approved (PASS WITH WARNINGS); overlap CLEAN (soft-rebase w/173); FRs + Consumer Surface added |
| 2026-09-04 | `spec-ready` → `design-approved` | /sdd-design | 2 rounds (quick); cosmetic client_id relabel via _build_watch_request() seam approved; recon.md + design.md written; no Floor breach |
| 2026-09-04 | `design-approved` → `implementation-ready` | /sdd-spec | Implementation spec generated with 5 steps |
| 2026-09-04 | `implementation-ready` → `in-progress` | /sdd-execute | Sequential run (stacked PR #2 on 173); Steps 1-2 (analysis `_build_watch_request`) done |
| 2026-09-04 | `in-progress` → `code-completed` | /sdd-execute | All 5 steps done (analysis + ingest client_id identity fix, wire-object tests, findings teardown) |

---

## Artifacts

- [Product Spec](product-spec.md) — bug description and fix scope
- [Acceptance Scenarios](acceptance.feature) — regression scenario(s) (`@AC-*`, C-15)
- [Recon Dossier](recon.md) — grounded codebase facts (client_id significance resolved: cosmetic)
- [Design](design.md) — debated, approved architecture (2 rounds; wire-object test seam)
- [Implementation Spec](implementation-spec.md) — 5 numbered steps with codebase evidence
- [Context Log](context.md) — session history, decisions, deviations

---

## Reviewers

Canonical snapshot from `docs/runbooks/reviewer-registry.md` (deduped across all steps). Stable
unless `/sdd-spec` re-runs.

| Step category | Reviewer | Focus |
|---|---|---|
| `service` / `test` (analysis) | xstockstrat-analysis service owner | Backtest reproducibility, strategy scoring determinism, no look-ahead bias |
| `service` / `test` (ingest) | xstockstrat-ingest service owner | Signal normalization correctness, idempotent ingestion, newsletter source schema stability |
| `docs` | none | — |

## Summary

The analysis and ingest config watchers both build `WatchConfig` requests with
`client_id=f"indicators-{id(self)}"` — copied verbatim from the indicators watcher template. The
`analysis` and `ingest` subscribers therefore both identify to `xstockstrat-config` as `indicators-…`.
Fix depends on a maintainer decision: is `client_id` significant to the config service's subscriber
identification/dedup (in which case the collision is a real defect), or a harmless label to correct
to `analysis-` / `ingest-`?

## Next Action

`/sdd-review fix-config-watcher-client-id impl-spec` — validate the implementation spec, then `/sdd-execute fix-config-watcher-client-id`
