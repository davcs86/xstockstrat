# Feature: fix-marketdata-dead-symbol-ingest

**Type**: bug
**Development Branch**: `feature/fix-marketdata-dead-symbol-ingest`
**Defect report**: `docs/reports/2026-11-04-marketdata-bar-ingest-dead-symbols-refetched-defect.md` (Issues disabled; no GitHub issue)
**Severity**: SEV-3
**Created**: 2026-11-04
**Last Updated**: 2026-11-06

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-11-04 | `bug-reported` -> `draft` | /sdd-triage | Product spec pre-populated from defect report |
| 2026-11-04 | `draft` → `design-approved` | /sdd-design | Design debated (2 rounds, quick extended by operator) and approved; recon.md + design.md written; full back-off on both paths, key seeded via config migration (/sdd-review skipped on operator instruction) |
| 2026-11-04 | `design-approved` → `implementation-ready` | /sdd-spec | Implementation spec generated with 8 steps |
| 2026-11-05 | `implementation-ready` (re-spec) | /sdd-execute sequential (sdd-batch-execute) | §5.3 re-spec of Steps 1,2,3,5,7,8 to the current codebase: migration 035 → 042 (provisional, C-07 re-check at merge), registry/test anchors at `mark_close_max_age_hours`, ci.yml :306 → :301, config-governance entry above feature 281 |
| 2026-11-05 | `implementation-ready` → `in-progress` | /sdd-execute sequential (sdd-batch-execute) | Sequential execution started; operator gave the up-front plan confirmation (§5.4) |
| 2026-11-06 | `in-progress` (re-spec) | /sdd-execute sequential (sdd-batch-execute) | §5.3 re-spec of Steps 1,6 to the current codebase: Step 1 evidence notes 282's `039` now on its branch, 295 still at `037`, `042` stays provisional (C-07 re-check at merge); Step 6 anchors `resolvePositiveInt` :987, merge-order :96, 290 still pending, Verification `035` → `042` |
| 2026-11-06 | `in-progress` (step 2 done) | /sdd-execute sequential (sdd-batch-execute) | Step 2: `SCALAR_BOUNDS_REGISTRY` bounds `[0, 86400000]` for `marketdata.stream.bar_ingest_backoff_ms`; TDD red → green via Step 3's rows applied only in the working tree (Step 3 still pending) |
| 2026-11-06 | `in-progress` (step 3 done) | /sdd-execute sequential (sdd-batch-execute) | Step 3: `TIMEOUT_KEY_FORMS` rows for `marketdata.stream.bar_ingest_backoff_ms` (both forms, `[0, 86400000]`) and new `barIngestBackoffSeedMigration.test.ts` for the `042` seed shape; TDD red (pre-Step-1/2 tree: 5 fail) → green (279/279) |

---

## Artifacts

- [Recon](recon.md) — grounded codebase dossier
- [Design](design.md) — debated, approved architecture
- [Product Spec](product-spec.md) — bug description and fix scope
- [Acceptance Scenarios](acceptance.feature) — regression scenario(s) (`@AC-*`, C-15)
- [Implementation Spec](implementation-spec.md) — 8 numbered steps, evidence-cited
- [Context Log](context.md) — session history, decisions, deviations

---

## Reviewers

| Role | Focus |
|---|---|
| DBA | Migration NNN numbering (035), up+down pair, run-order compliance |
| xstockstrat-config owner | Config key naming (`<service>.<category>.<key>`), environment / global-per-user scoping, WatchConfig stream stability |
| xstockstrat-marketdata owner | OHLCV ingestion integrity, TimescaleDB hypertable partitioning, Alpaca feed idempotency |

---

## Summary

The always-on bar ingester re-requests the same ~6 symbols (AXIA, EVTV, LRHC, LXP, PSKY, RAMP) that never return bars, warning every 5-minute cycle (1,173 lines in 7 days).

## Next Action

`/sdd-review fix-marketdata-dead-symbol-ingest impl-spec` — validate implementation spec, then `/sdd-execute fix-marketdata-dead-symbol-ingest`
