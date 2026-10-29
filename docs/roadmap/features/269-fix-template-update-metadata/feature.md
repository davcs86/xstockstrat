# Feature: fix-template-update-metadata

**Type**: bug
**Development Branch**: `feature/fix-template-update-metadata`
**GitHub Issue**: none (Issues disabled). Defect report: `docs/reports/2026-10-21-template-update-metadata-defect.md`
**Severity**: SEV-2
**Created**: 2026-10-21
**Last Updated**: 2026-10-29

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-10-21 | `bug-reported` → `draft` | /sdd-triage | Product spec pre-populated from `docs/reports/2026-10-21-template-update-metadata-defect.md` (debt-radar D-41) |
| 2026-10-21 | `draft` → `spec-ready` | /sdd-review | Product spec approved (4 warnings; overlap WARN: shared servicer.py with 244, 245) |
| 2026-10-22 | `spec-ready` → `design-approved` | /sdd-design | Design debated (2 rounds, full) and approved; recon.md + design.md written |
| 2026-10-22 | `design-approved` → `implementation-ready` | /sdd-spec | Implementation spec generated with 9 steps |
| 2026-10-29 | `implementation-ready` (re-spec) | /sdd-execute | Steps 3, 4, 6, 7, 8 re-specced after the main-dev merge: line drift in analysis `servicer.py`/`conftest.py`/`ci.yml` and ingest test imports; Step 7 marked done (merge-order.md:91 row already present) |

---

## Reviewers

Snapshot from `docs/runbooks/reviewer-registry.md` at /sdd-spec time (2026-10-22), per-step assignments.

| Reviewer | Focus | Steps |
|---|---|---|
| `xstockstrat-indicators` owner | Formula sandboxing, numeric precision, no side-effects from formula execution | 1, 2 |
| `xstockstrat-analysis` owner | Backtest reproducibility, strategy scoring determinism, no look-ahead bias | 3, 4 |
| `xstockstrat-ingest` owner | Signal normalization correctness, idempotent ingestion, newsletter source schema stability | 5, 6 |
| none (docs) | — | 7, 8, 9 |

---

## Artifacts

- [Product Spec](product-spec.md) — bug description and fix scope
- [Acceptance Scenarios](acceptance.feature) — regression scenario(s) (`@AC-*`, C-15)
- [Recon](recon.md) — grounded codebase dossier (Phase 0)
- [Design](design.md) — debated, operator-approved approach (Phase 1)
- [Implementation Spec](implementation-spec.md) — 9 numbered steps (Phase 2)
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

`ManageTemplate` UPDATE on formula (indicators) and strategy (analysis) templates bumps `version` but never
writes `name`/`description`, so an admin rename silently does nothing; ingest writes them. RETIRE and
empty-id CREATE semantics also differ across the three template repositories.

## Next Action

`/sdd-review fix-template-update-metadata impl-spec` — validate implementation spec, then `/sdd-execute fix-template-update-metadata`
