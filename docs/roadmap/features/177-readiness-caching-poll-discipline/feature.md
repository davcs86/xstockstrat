# Feature: readiness-caching-poll-discipline

**Development Branch**: `feature/readiness-caching-poll-discipline`
**Created**: 2026-09-04
**Last Updated**: 2026-09-04

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-09-04 | `idea` → `draft` | /sdd-story | Product spec generated from performance audit Track B |
| 2026-09-04 | `draft` → `spec-ready` | /sdd-review | Product spec approved (advisory warnings + DB up/down note addressed); overlap CLEAN |
| 2026-09-05 | `spec-ready` → `design-approved` | /sdd-design | Design debated (4 rounds, extended); round-4 adversary SOUND; recon.md + design.md written |
| 2026-09-05 | `design-approved` → `implementation-ready` | /sdd-spec | Implementation spec generated with 13 steps |

| 2026-09-05 | `implementation-ready` → `in-progress` | /sdd-execute | Sequential run started; Steps 1–2 (proto computed_at + codegen) landed |
| 2026-09-05 | `in-progress` → `code-completed` | /sdd-execute | All 13 steps done (FR-1 readiness FAST/SLOW cache, FR-3 empty-universe compute-state, FR-4 live-enrich memo, FR-2 UI staleTime + e2e); analysis suite 680 green + UI e2e 420 green |
---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Acceptance Scenarios](acceptance.feature) — Gherkin `@AC-*` scenarios (single source of acceptance truth, C-15)
- [Recon Dossier](recon.md) — grounded codebase map, Patterns to REUSE, Existing Business Rules
- [Design](design.md) — chosen approach, rejected alternatives, open risks, Constitution rules
- [Implementation Spec](implementation-spec.md) — 13 numbered steps with codebase evidence
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Eliminate redundant recompute on the decide-surface read paths: cache/materialize Watchlist
readiness the way Opportunities already is, stop the every-15s recompute for empty-universe users,
make warm-poll live enrichment conditional, and give the readiness client a `staleTime` so switching
panes doesn't re-trigger a full fan-out.

## Reviewers

_(Auto-populated from docs/runbooks/reviewer-registry.md based on affected services and
change types. Override as needed for this feature. Snapshot finalized at /sdd-spec time —
re-run /sdd-spec if the registry changes.)_

| Role | Review Focus |
|---|---|
| `xstockstrat-analysis` owner | Backtest reproducibility, strategy scoring determinism, no look-ahead bias, no stale data shown as fresh |
| `xstockstrat-ui` owner | Analytics display accuracy, Connect-RPC call safety, no stale data shown as fresh, no whole-list refetch |
| `xstockstrat-config` owner | Config key naming (`<service>.<category>.<key>`), scoping, `SCALAR_BOUNDS_REGISTRY` correctness |
| Proto Reviewer | Field number uniqueness, `buf lint`/`buf breaking` pass, no breaking change without deprecation |
| DBA | Migration NNN numbering (no gap/conflict), up+down pair present, index correctness |

## Next Action

`/sdd-review readiness-caching-poll-discipline impl-spec` — validate the implementation spec, then `/sdd-execute readiness-caching-poll-discipline`
