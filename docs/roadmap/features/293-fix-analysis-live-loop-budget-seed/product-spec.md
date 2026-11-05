# Product Spec: fix-analysis-live-loop-budget-seed

**Type**: bug
**Defect report**: `docs/reports/2026-11-04-analysis-live-loop-chronic-budget-overflow-defect.md`
**Severity**: SEV-3
**Created**: 2026-11-04
**Revised**: 2026-11-04 (product-spec review: FRs, migration strategy, consumer surface)

---

## Problem Statement

A platform operator tuning the analysis live-evaluation budget cannot discover or safely set the key
`analysis.engine.max_strategies_per_cycle`: the live loop reads it (`services/xstockstrat-analysis/app/engine/live_loop.py:359`,
`int_positive`, code default `50`) but it is not registered in any environment's config registry, so `list_config_keys`
omits it and a plain `SetConfig` is refused `NOT_FOUND` (feature 091 existence gate). The only way to change it is
`SetConfig create_key=true` — done on staging on 2026-11-04 (value `200`, **chosen by the assistant, not the operator**) —
which is invisible to migrations (`docs/patterns/config-governance.md:90`): production and any freshly migrated
environment keep running the unregistered default of 50, and the staging row has no description or default.

Separately, a fleet that stays above the budget logs the same overflow WARN on every ~68 s cycle for a steady-state
condition (~5.6k WARN lines in 7 days at budget 50: 670–696 live pairs vs 50), burying real warnings.

## Functional Requirements

- **FR-1:** A config-service migration registers `analysis.engine.max_strategies_per_cycle` as `value_type='int'`,
  `value_data='50'`, `default_value='50'`, a non-empty description and `consuming_service='xstockstrat-analysis'`, for
  `staging` and `production` (global scope, `user_id` NULL), with `namespace='analysis'` and the full-dotted `key` (the
  `key` column must equal the string the reader looks up — migration 033's rationale). On production this is a
  no-behaviour-change (50 is what runs today).
- **FR-2:** Applying the migration never changes the `value_data` (or `value_type`) of an existing row — including the
  staging runtime-created value `200` — and backfills only that row's **empty** description / `default_value` /
  `consuming_service` (an operator-written non-empty description is never overwritten). The migration is idempotent
  (applying it twice leaves exactly one row per environment).
- **FR-3:** `SetConfig` write-edge bounds for the key: minimum `1` (a stored `0` or negative otherwise silently reads
  as `50` through `int_positive`) and a **candidate maximum of `400`** (measured ≈ 0.12 s per pair on staging — 200 pairs
  took 23.6 s). Each cycle is awaited inline after `sleep(interval)` (`live_loop.py:336-345`; the `_lock.locked()` skip at
  `:339-341` is effectively dead code because nothing else takes the lock), so cycles never overlap and the effective
  period is `eval_interval_seconds` + cycle duration: ≈ 84 s at 200 pairs and ≈ 108 s at 400 (≈ 68 s observed at 50).
  The maximum is therefore a signal-freshness trade-off, not a fit-inside-the-interval limit. The maximum is an assistant-chosen candidate for `/sdd-design` to confirm or
  revise against indicators/marketdata capacity; whatever value is final gets an `@AC` (AC-6). `SetConfig` without `create_key` succeeds for the key once registered.
- **FR-4:** The `scripts/config-wiring.json` baseline entry for the key (`read-unseeded`, owner feature 278,
  `:84-89`) is removed in the same change (baseline entries may only shrink; a stale entry fails CI), and
  `node scripts/check-config-wiring.mjs --declared-migration <migration>` passes.
- **FR-5:** While the live fleet stays over budget, the overflow WARN is emitted once per **state change** — the state
  is the pair (over budget?, budget) — not on every cycle and **not on every drift of the pair count** (670–696 observed).
  Volume target: at most one overflow WARN per (over-budget episode, budget value, process lifetime) — pair-count drift
  adds none, a deploy restart adds one. The state is cleared when a cycle falls back under budget (the next overflow
  warns again) — **a cycle with zero live pairs counts as under budget and clears it** (the early returns before the
  overflow check, `live_loop.py:435-441`, must not leave a stale state) — and is held per live-loop instance. The per-cycle INFO summary
  `live_loop: evaluated N/M pairs …` — which carries the current pair count and cursor — is unchanged and the
  `_TRUNCATION_COUNTER` metric keeps incrementing every cycle.
- **FR-6 (rollback):** The down migration removes only **global** rows (`user_id IS NULL`) in `staging`/`production`
  whose `value_data` still equals the seeded `50`, so an operator-set value (e.g. staging `200`) and any per-user override
  survive a rollback. It does not revert the metadata backfill on a surviving row, and an operator-set `50` is also
  removed (harmless: `50` is the code default).

## Reproduction Steps

1. `list_config_keys(namespace="analysis")` on any environment: the key is absent.
2. `SetConfig` without `create_key` is refused `NOT_FOUND`.
3. With 670+ live pairs and budget 50, observe one overflow WARN per live-loop cycle.

## Root Cause Hypothesis

The key was introduced consumed-with-default (unseeded, the pattern feature 227 waived for tuning keys) but is
operationally necessary once the fleet outgrows 50. `SetConfig create_key=true` inserts only `namespace, key,
value_type, value_data, …` (`configServiceImpl.ts:633-646`), so the runtime row has NULL description/default/consumer;
a bare `ON CONFLICT DO NOTHING` seed would leave staging without them (hence FR-2's metadata backfill). The overflow
WARN is a steady-state condition logged at WARN per cycle; FR-5 fixes the volume, the level stays WARN on a state change.

## Affected Services

xstockstrat-analysis (live-loop WARN throttling; `CLAUDE.md` row), xstockstrat-config (seed migration and
`SCALAR_BOUNDS_REGISTRY` entry in `src/grpc/configServiceImpl.ts` with its test).

## Consumer Surface(s)

- [x] `/config-ui` (generic config table) and the Agent MCP tools `list_config_keys` / `set_config`: pick up the new
  registry row (description, default `50`, no `create_key` needed) with **no UI or agent code change** — verified: no
  hard-coded reference to the key in UI/agent paths. The overflow-WARN throttling is an internal log-volume change
  observable only in Loki/Grafana. No UI or agent implementation step is required (C-14).

## Fix Scope

- Proto: none.
- Database: **config-service migration** — up + down pair in `services/xstockstrat-config/migrations/`, **two statements** — (1) `INSERT … ON CONFLICT (namespace, key, environment, COALESCE(user_id, '')) DO NOTHING`
  (the only INSERT shape `scripts/check-config-wiring.mjs` `applyInsert` accepts; `DO UPDATE` makes
  `--declared-migration` exit 2 "shape not understood"), then (2) a metadata-only
  `UPDATE … SET description = COALESCE(NULLIF(description,''), '<d>'), default_value = COALESCE(NULLIF(default_value,''), '50'),
  consuming_service = COALESCE(NULLIF(consuming_service,''), 'xstockstrat-analysis') WHERE namespace='analysis' AND
  key='analysis.engine.max_strategies_per_cycle' AND user_id IS NULL AND environment IN ('staging','production')`
  (precedent: feature 244 migration `032_analysis_zero_trap_descriptions.up.sql`). Verified: the audit trigger logs only
  `IF OLD.value_data IS DISTINCT FROM NEW.value_data` (`017_config_secrets_and_scoping.up.sql:69`) and the migration
  does not call `pg_notify` (only `SetConfig` does), so a metadata-only update writes no audit row. **NNN is the next free number at `/sdd-spec` time,
  re-verified against `origin/main-dev` and open feature branches, and must be higher than every claimed number —
  `035` is held by feature 291 and `037` by feature 281's branch — so it is not hard-coded here.** golang-migrate skips
  a lower version that lands after a higher one on an already-migrated database, so `merge-order.md` records 293 after
  291 and 281.
- Staging row check before applying: the runtime-created row's stored `namespace` / `key` must equal the seed's
  (`analysis`, `analysis.engine.max_strategies_per_cycle`), otherwise the conflict target does not fire and a second row
  is created.
- Config key registered: `analysis.engine.max_strategies_per_cycle` (int, default 50), bounds per FR-3.
- Docs: "Seeded by migration NNN" note on the analysis `CLAUDE.md` Config Keys row (`:529`); entry in the Per-Feature
  Registered Keys log in `docs/patterns/config-governance.md`.
- Governance gates (root `CLAUDE.md` § Approval Flow): DB migration — config-service owner + DBA; new config key —
  analysis owner + config team.
- Live-loop code: throttle the overflow WARN (FR-5) and change the one existing test that asserts a WARN on every
  over-budget cycle: `tests/test_live_loop.py:783-808` `test_rotation_logs_window_cursor_and_cycle_summary` runs two
  over-budget cycles and indexes `warns[1]` — under FR-5 the second cycle has the same state and no second WARN, so
  that assertion is an intended CHANGE (the window/cursor detail then lives on the first WARN of a state and on the
  per-cycle INFO). `:759-780` `test_truncation_warns_only_when_over_budget` asserts exactly one WARN in one over-budget
  cycle and stays valid (PRESERVE; optionally add a second-cycle assertion of no extra WARN).
- The two parts (FR-1..4/6 seed + bounds; FR-5 throttle) may land as separate steps/PRs so one does not block the other.

## Acceptance Criteria

See `acceptance.feature` (Constitution **C-15**). PRESERVE (C-16): `docs/sdd/business-rules/platform.feature:496`
(`@AC-6 @FR-3 @feature-244`: a stored `0` for the key reads as `50`) — the reader's `int_positive` semantics and the code
default `50` are unchanged; with a `min 1` bound this stays a read-side guarantee for legacy stored zeros (`tests/test_config_zero_clamps.py:34` owns it; this feature does not duplicate it as a scenario). Plus: existing
tests pass (except the two intended assertion changes above); analysis and config smoke-tested on dev.

## Out of Scope

- Choosing a production budget value (operator decision); raising the staging value further. The staging `200` was
  set by the assistant — the operator should confirm or re-set it (a staging environment rebuilt from migrations returns
  to 50).
- Changing the code default `50`, the `int_positive` reader, or the rotation algorithm.
- Verifying indicators/marketdata capacity at larger batches (unverified; informs the FR-3 maximum only).
- Choosing the verification route for AC-3/AC-4/AC-7 (pre-existing state, double apply, per-user override with a down run): the config service has no real-Postgres harness (`node --test` static SQL-text tests such as `retiredPortfolioSnapshotInterval.test.ts`; `scripts/migration-rerun.sh` + `scripts/migration-assertions/*.sql` cover the up side only) — `/sdd-design` and `/sdd-spec` pick it explicitly.
