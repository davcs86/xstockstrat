# Feature: fix-indicator-pane-warmup

**Type**: bug
**Development Branch**: `feature/fix-indicator-pane-warmup`
**GitHub Issue**: n/a (Issues disabled) — report `docs/reports/2026-11-15-indicator-panel-sma200-single-point-defect.md`
**Severity**: SEV-3
**Created**: 2026-11-15
**Last Updated**: 2026-11-15

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-11-15 | `bug-reported` → `draft` | /sdd-triage | Product spec pre-populated from the defect report |
| 2026-11-15 | `draft` → `spec-ready` | /sdd-review | Product spec approved (4 warnings) |
| 2026-11-15 | `spec-ready` (unchanged) | orchestrator | Product spec amended at the design gate under operator sanction: one config key + its seed migration now in scope; marketdata and config added to Affected Services |
| 2026-11-15 | `spec-ready` → `design-approved` | /sdd-design | Design debated (5 rounds, full) and approved; recon.md + debate.md + design.md written |

---

## Artifacts

- [Product Spec](product-spec.md) — bug description and fix scope
- [Acceptance Scenarios](acceptance.feature) — regression scenario(s) (`@AC-*`, C-15)
- [Recon](recon.md) — grounded codebase dossier
- [Debate Register](debate.md) — settled decisions, rejected alternatives, objections
- [Design](design.md) — approved approach, rejected alternatives, open risks
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec fix-indicator-pane-warmup`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

On the symbol page indicator chart, a 200-period average over a ~190-bar window renders one dot because the series is computed without a warm-up prefix.

## Next Action

`/sdd-spec fix-indicator-pane-warmup` — generate implementation spec from the approved design
