# Feature: fix-template-update-metadata

**Type**: bug
**Development Branch**: `feature/fix-template-update-metadata`
**GitHub Issue**: none (Issues disabled). Defect report: `docs/reports/2026-10-21-template-update-metadata-defect.md`
**Severity**: SEV-2
**Created**: 2026-10-21
**Last Updated**: 2026-10-22

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-10-21 | `bug-reported` → `draft` | /sdd-triage | Product spec pre-populated from `docs/reports/2026-10-21-template-update-metadata-defect.md` (debt-radar D-41) |
| 2026-10-21 | `draft` → `spec-ready` | /sdd-review | Product spec approved (4 warnings; overlap WARN: shared servicer.py with 244, 245) |
| 2026-10-22 | `spec-ready` → `design-approved` | /sdd-design | Design debated (2 rounds, full) and approved; recon.md + design.md written |

---

## Reviewers

Snapshot from `docs/runbooks/reviewer-registry.md` at /sdd-triage time (2026-10-21). `/sdd-spec` overwrites it with per-step assignments.

| Reviewer | Focus | Steps |
|---|---|---|
| `xstockstrat-indicators` owner | Formula sandboxing, numeric precision, no side-effects from formula execution | Formula-template repository + `ManageTemplate` (TBD /sdd-spec) |
| `xstockstrat-analysis` owner | Backtest reproducibility, strategy scoring determinism | Strategy-template repository + `ManageTemplate` (TBD /sdd-spec) |
| `xstockstrat-ingest` owner | Signal normalization correctness, idempotent ingestion, newsletter source schema stability | Source-template RETIRE/CREATE alignment (TBD /sdd-spec) |
| `xstockstrat-ui` owner | Config mutation safety, Connect-RPC call safety | Read-only evidence (`/config-ui/templates` already sends name/description); change only if design makes metadata immutable |

---

## Artifacts

- [Product Spec](product-spec.md) — bug description and fix scope
- [Acceptance Scenarios](acceptance.feature) — regression scenario(s) (`@AC-*`, C-15)
- [Recon](recon.md) — grounded codebase dossier (Phase 0)
- [Design](design.md) — debated, operator-approved approach (Phase 1)
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec fix-template-update-metadata`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

`ManageTemplate` UPDATE on formula (indicators) and strategy (analysis) templates bumps `version` but never
writes `name`/`description`, so an admin rename silently does nothing; ingest writes them. RETIRE and
empty-id CREATE semantics also differ across the three template repositories.

## Next Action

`/sdd-spec fix-template-update-metadata` — generate implementation spec from the approved design
