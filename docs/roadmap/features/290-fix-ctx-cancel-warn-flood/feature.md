# Feature: fix-ctx-cancel-warn-flood

**Type**: bug
**Development Branch**: `feature/fix-ctx-cancel-warn-flood`
**Defect report**: `docs/reports/2026-11-04-portfolio-marketdata-warn-flood-after-ctx-cancel-defect.md` (Issues disabled; no GitHub issue)
**Severity**: SEV-3
**Created**: 2026-11-04
**Last Updated**: 2026-11-04

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-11-04 | `bug-reported` -> `draft` | /sdd-triage | Product spec pre-populated from defect report |
| 2026-11-04 | `draft` → `design-approved` | /sdd-design | Design debated (2 rounds, full) and approved; recon.md + design.md written; marketdata variant: detach, post-departure bound + 1 writer (/sdd-review skipped on operator instruction) |

---

## Artifacts

- [Recon](recon.md) — grounded codebase dossier
- [Design](design.md) — debated, approved architecture
- [Product Spec](product-spec.md) — bug description and fix scope
- [Acceptance Scenarios](acceptance.feature) — regression scenario(s) (`@AC-*`, C-15)
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec fix-ctx-cancel-warn-flood`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

On a canceled context portfolio's `ConsumePositionSyncs` and marketdata's `GetBars` cache-insert path keep iterating and log one WARN per item (3.3k + 557 lines in 7 days).

## Next Action

`/sdd-spec fix-ctx-cancel-warn-flood` — generate implementation spec from the approved design
