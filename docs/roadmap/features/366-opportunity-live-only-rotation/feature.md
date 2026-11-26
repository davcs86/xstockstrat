# Feature: opportunity-live-only-rotation

**Development Branch**: `feature/opportunity-live-only-rotation`
**Created**: 2026-11-26
**Last Updated**: 2026-11-26

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-11-26 | `idea` → `draft` | /sdd-story | Product spec generated |
| 2026-11-26 | `draft` → `spec-ready` | /sdd-review | Product spec approved (4 warnings), round 2 after round-1 FAIL |
| 2026-11-26 | `spec-ready` → `design-approved` | /sdd-design | Design debated (5 rounds, full) and approved; recon.md + debate.md + design.md written |
| 2026-11-26 | `design-approved` → `implementation-ready` | /sdd-spec | Implementation spec generated with 11 steps |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Acceptance Scenarios](acceptance.feature) — Gherkin `@AC-*` scenarios (single source of acceptance truth, C-15)
- [Recon](recon.md) — grounded codebase dossier (Phase 0)
- [Debate Register](debate.md) — settled decisions, locked rejected alternatives, objections
- [Design](design.md) — approved architecture, rejected alternatives, open risks
- [Implementation Spec](implementation-spec.md) — 11 numbered steps with per-step Reviewers
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Replace the opportunity compute's live-only truncation (only the top
`opportunity.max_live_only_symbols_per_compute` non-held signal symbols get live-strategy rows) with a
rotation across compute passes, so every live-covered signal symbol gets its strategy rows within a
bounded number of passes while per-compute cost stays capped.

## Reviewers

_(Auto-populated from docs/runbooks/reviewer-registry.md based on affected services and
change types. Override as needed for this feature. Snapshot finalized at /sdd-spec time —
re-run /sdd-spec if the registry changes.)_

| Role | Review Focus |
|---|---|
| xstockstrat-analysis owner | Backtest reproducibility, strategy scoring determinism, no look-ahead bias |
| DBA (analysis `030` cursor column; config `056` seed) | Migration NNN numbering (no gaps, no conflicts), up+down pair present, run-order compliance |
| xstockstrat-config owner (config `056` seed + SetConfig bounds) | Config key naming, environment / global-per-user scoping, WatchConfig stream stability |

## Next Action

`/sdd-review opportunity-live-only-rotation impl-spec` — validate implementation spec, then `/sdd-execute opportunity-live-only-rotation`
