# Feature: fix-marketdata-dead-symbol-ingest

**Type**: bug
**Development Branch**: `feature/fix-marketdata-dead-symbol-ingest`
**Defect report**: `docs/reports/2026-11-04-marketdata-bar-ingest-dead-symbols-refetched-defect.md` (Issues disabled; no GitHub issue)
**Severity**: SEV-3
**Created**: 2026-11-04
**Last Updated**: 2026-11-04

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-11-04 | `bug-reported` -> `draft` | /sdd-triage | Product spec pre-populated from defect report |
| 2026-11-04 | `draft` → `design-approved` | /sdd-design | Design debated (2 rounds, quick extended by operator) and approved; recon.md + design.md written; full back-off on both paths, key seeded via config migration (/sdd-review skipped on operator instruction) |

---

## Artifacts

- [Recon](recon.md) — grounded codebase dossier
- [Design](design.md) — debated, approved architecture
- [Product Spec](product-spec.md) — bug description and fix scope
- [Acceptance Scenarios](acceptance.feature) — regression scenario(s) (`@AC-*`, C-15)
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec fix-marketdata-dead-symbol-ingest`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

The always-on bar ingester re-requests the same ~6 symbols (AXIA, EVTV, LRHC, LXP, PSKY, RAMP) that never return bars, warning every 5-minute cycle (1,173 lines in 7 days).

## Next Action

`/sdd-spec fix-marketdata-dead-symbol-ingest` — generate implementation spec from the approved design
