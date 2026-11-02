# Feature: enforce-config-key-wiring

**Development Branch**: `feature/enforce-config-key-wiring`
**Created**: 2026-10-23
**Last Updated**: 2026-11-02

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
| 2026-11-01 | `in-progress` (unchanged) | /sdd-execute sequential | Steps 3+4 done as one red-green commit (operator Option A): reader extraction (Python ast helper, Go/TS regex), forwarder and dynamic registry, reader fixtures and tests |
| 2026-11-01 | `in-progress` (unchanged) | /sdd-execute sequential | Steps 5+6 done as one red-green commit (operator Option A): join with per-environment collapse, four finding kinds, sorted `file:key:kind[:env]` output; join fixtures and tests |
| 2026-11-01 | `in-progress` (unchanged) | /sdd-execute sequential | Steps 7+8 done as one red-green commit (operator Option A): `config-wiring.json` schema and owner validation, `--final` ratchet with env-list shrink, step-time mode with PENDING/REPORTED, declared keys from spec, migration and `--keys`; ratchet fixtures and tests |
| 2026-11-01 | `in-progress` (unchanged) | /sdd-execute sequential | Step 9 done: first offline `--final` run recorded (150 findings: 9 form-mismatch, 31 seeded-unread, 64 read-unseeded, 46 dynamic-read, 0 unmodelled-rewrite); reconciled against the expected set, open-risk checks closed |
| 2026-11-01 | `in-progress` (unchanged) | /sdd-execute sequential | Step 10 done: environment-baseline gate confirmed reported-only (2026-10-23 operator ruling); 1 env-scoped finding reported, `policy.envReadUnseeded` = `reported`; no environment read |
| 2026-11-02 | `in-progress` (unchanged) | /sdd-execute sequential (re-spec) | Operator option C at the Step 11 blocker: new Step 11 (TS/Go `values[...]` assignment targets are writes, not reads) inserted before the baseline freeze; former Steps 11-18 renumbered 12-19; Total Steps 18 → 19 |
| 2026-11-02 | `in-progress` (unchanged) | /sdd-execute sequential (re-spec §5.3) | Merged origin/main-dev (ledger-guard clean); Steps 12, 13, 14 re-specced to the current tree. Step 12 classifies all 43 post-Step-11 dynamic sites (8 forwarders incl. `str_nonempty`/`float_positive`/`get_config_value`/`_agent_policy`, 28 getter bodies, 4 closed-set runtime keys, 4 non-config containers). Step 13 drops the nonexistent scan-roots export. Step 14 uses language-root filter globs that cover `cmd/` Go readers and now owns the scan-root test |
| 2026-11-02 | `in-progress` (unchanged) | /sdd-execute sequential | Step 11 done: TS/Go `values[...]` assignment targets (`=` and compound) are skipped by the regex extractor; test (l) + two write fixtures; real-tree `dynamic-read` 46 → 43 (the 7 `configServiceImpl.ts` write sites gone, no read lost) |
| 2026-11-02 | `in-progress` (unchanged) | /sdd-execute sequential | Step 12 done: `scripts/config-wiring.json` frozen. Registry has 8 forwarders, 36 `dynamic` entries (28 getter bodies, 4 non-config containers, 4 closed-set sites) and an empty `rewriteAllow`. Baseline has 124 `feature 278` entries (19 `form-mismatch`, 5 `seeded-unread`, 100 `read-unseeded`) and 0 `dynamic-read`. `--final` exits 0 with 1 `REPORTED:` line |
| 2026-11-02 | `in-progress` (unchanged) | /sdd-execute sequential | Step 13 done: `scripts/config-wiring.test.mjs` gains tests `baseline 1-4`. They check that real-tree `--final` exits 0, that every entry has an owner and a baseline kind with no `dynamic-read`, that the 277-sweep key set is present, and that there is no value text or secret-class key. Red against the Step 7 empty-shape baseline in a scratch root (3 of 4 fail); green 42/42 |
| 2026-11-02 | `in-progress` (unchanged) | /sdd-execute sequential | Step 14 done: `ci.yml` gains the `config-wiring` paths filter (language-root globs incl. `services/**/*.go`), the `config-wiring` job (checker tests + `--final`) and its `ci-gate` `needs`/echo entries; test `baseline 5` asserts the filter covers every extractor-read file (red: filter missing; green 43/43) |
| 2026-11-02 | `in-progress` (unchanged) | /sdd-execute sequential | Step 15 done: `/sdd-execute` SKILL.md Phase 3 gains the step-time config-key wiring gate (after Verification, before the `done` flip) and a `--final` run that blocks the `code-completed` flip and the ALL-DONE integration PR; `repo-conventions.md` config-key line points at the check. TDD: N/A (docs) |

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
