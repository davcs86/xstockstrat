# Feature: enforce-config-key-wiring

**Development Branch**: `feature/enforce-config-key-wiring`
**Created**: 2026-10-23
**Last Updated**: 2026-11-01

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-10-23 | `idea` → `draft` | /sdd-story | Product spec generated; follow-up created by the operator when demoting 277-fix-ingest-seeded-config-keys |
| 2026-10-23 | `draft` → `spec-ready` | /sdd-review | Product spec approved (7 warnings) |
| 2026-10-23 | `spec-ready` → `design-approved` | /sdd-design | Design debated (2 rounds, full) and approved; recon.md + design.md written |
| 2026-10-23 | `design-approved` → `implementation-ready` | /sdd-spec | Implementation spec generated with 18 steps |
| 2026-11-01 | `implementation-ready` (unchanged) | /sdd-execute sequential (re-spec §5.3) | Steps 1,2,3,4,6,7,8,9,10,11,13,14,15,16,18 re-specced to the current tree (migration tip 034, int_positive forwarders, 277 owners → 278, Step 10 confirm-only) |
| 2026-11-01 | `implementation-ready` → `in-progress` | /sdd-execute sequential (sdd-batch-execute) | Up-front confirmation given by the operator; sequential step loop starts |
| 2026-11-01 | `in-progress` (unchanged) | /sdd-execute sequential | Steps 1+2 done as one red-green commit (operator Option A): seed-side parser, CLI skeleton, parser fixtures and tests |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Recon](recon.md) — grounded codebase dossier
- [Design](design.md) — approved design, rejected alternatives, open risks
- [Acceptance Scenarios](acceptance.feature) — Gherkin `@AC-*` scenarios (single source of acceptance truth, C-15)
- [Implementation Spec](implementation-spec.md) — 18 steps (Step 10 is an operator decision gate)
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

A deterministic check, wired into the execution/validation loop and CI, that proves every config key a feature seeds is read by code under the exact stored key (and every key code reads is seeded), so a config key can no longer ship as a silent no-op.

## Reviewers

_Snapshot finalized at /sdd-spec time (2026-10-23) from the distinct per-step reviewers — re-run /sdd-spec if the registry changes._

| Role | Review Focus |
|---|---|
| Platform Lead | Cross-service architecture; the check spans every service and the SDD skills |
| `xstockstrat-config` owner | Config key naming (`<service>.<category>.<key>`), environment/global-per-user scoping, WatchConfig stream stability |

## Next Action

`/sdd-review enforce-config-key-wiring impl-spec` — validate implementation spec, then `/sdd-execute enforce-config-key-wiring`
