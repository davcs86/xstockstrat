# Product Spec: fix-analysis-live-loop-budget-seed

**Type**: bug
**Defect report**: `docs/reports/2026-11-04-analysis-live-loop-chronic-budget-overflow-defect.md`
**Severity**: SEV-3
**Created**: 2026-11-04
**Revised**: 2026-11-05 (sdd-design: second key, bounds, two-PR split)

---

## Problem Statement

A platform operator tuning the analysis live-evaluation budget cannot discover or safely set the key
`analysis.engine.max_strategies_per_cycle`: the live loop reads it (`services/xstockstrat-analysis/app/engine/live_loop.py:359`,
`int_positive`, code default `50`) but it is not registered in any environment's config registry, so `list_config_keys`
omits it and a plain `SetConfig` is refused `NOT_FOUND` (feature 091 existence gate). The only way to change it is
`SetConfig create_key=true` — done on staging on 2026-11-04 (value `200`, **chosen by the assistant, not the operator**) —
which is invisible to migrations (`docs/patterns/config-governance.md:90`): production and any freshly migrated
environment keep running the unregistered default of 50, and the staging row has no description or default.

The sibling key `analysis.engine.eval_interval_seconds` (`live_loop.py:337`, `int_positive`, code default `60`) has the identical defect — unregistered, with a `read-unseeded` baseline entry at `scripts/config-wiring.json:78-83` — and is seeded by the same migration (operator-approved scope addition, 2026-11-05).

Separately, a fleet that stays above the budget logs the same overflow WARN on every ~68 s cycle for a steady-state
condition (~5.6k WARN lines in 7 days at budget 50: 670–696 live pairs vs 50), burying real warnings.

## Functional Requirements

- **FR-1:** One config-service migration registers `analysis.engine.max_strategies_per_cycle` (`value_type='int'`, `value_data='50'`, `default_value='50'`) and `analysis.engine.eval_interval_seconds`
  (`value_type='int'`, `value_data='60'`, `default_value='60'`), each with a non-empty description and `consuming_service='xstockstrat-analysis'`,
  for `staging` and `production` (global scope, `user_id` NULL), with `namespace='analysis'` and the full-dotted `key` (the `key` column must
  equal the string the reader looks up — migration 033's rationale). On production this is a no-behaviour-change (50 and 60 are what runs today).
  Descriptions state only the operator-visible effect (no bounds, cost figures or loop mechanism).
- **FR-2:** Applying the migration never changes the `value_data` (or `value_type`) of an existing row of either key — including the staging
  runtime-created budget value `200` — and backfills only that row's **blank** (NULL or empty) description / `default_value` / `consuming_service`,
  per column (an operator-written non-empty value is never overwritten). The migration is idempotent (applying it twice leaves exactly one row per
  environment per key).
- **FR-3:** `SetConfig` write-edge bounds in `SCALAR_BOUNDS_REGISTRY`: `analysis.engine.max_strategies_per_cycle` `[1, 1000]` (minimum 1 because a stored `0` or negative otherwise silently
  reads as `50` through `int_positive`; maximum 1000 is a typo guard matching `analysis.opportunity.max_universe_size` — pairs are evaluated serially
  (`live_loop.py:467-479`), so the budget bounds cycle duration, not concurrency; a lower maximum would forbid evaluating today's ~690 live pairs per
  cycle) and `analysis.engine.eval_interval_seconds` `[30, 600]` (minimum 30 because the loop does a full strategies SELECT, a signal drain and per-owner RPCs every iteration and 1 is
  the likeliest minutes-for-seconds typo; maximum 600 keeps interval + cycle duration inside the 1800 s window of the `xstk-analysis-no-scoring`
  heartbeat alert). Both are operator-approved at the design gate (2026-11-05). `SetConfig` without `create_key` succeeds for both keys once registered.
- **FR-4:** The `scripts/config-wiring.json` baseline entries for both keys (`read-unseeded`, owner feature 278: interval `:78-83`, budget `:84-89`)
  are removed in the same change (baseline entries may only shrink; a stale entry fails CI), and
  `node scripts/check-config-wiring.mjs --declared-migration <migration>` passes.
- **FR-5:** While the live fleet stays over budget, the overflow WARN is emitted once per **state change** — the state
  is the pair (over budget?, budget) — not on every cycle and **not on every drift of the pair count** (670–696 observed).
  Volume target: at most one overflow WARN per (over-budget episode, budget value, process lifetime) — pair-count drift
  adds none, a deploy restart adds one. The state is cleared when a cycle falls back under budget (the next overflow
  warns again) — **a cycle with zero live pairs counts as under budget and clears it** (the early returns before the
  overflow check, `live_loop.py:435-441`, must not leave a stale state) — and is held per live-loop instance. The per-cycle INFO summary
  `live_loop: evaluated N/M pairs …` — which carries the current pair count and cursor — is unchanged and the
  `_TRUNCATION_COUNTER` metric keeps incrementing every cycle.
- **FR-6 (rollback):** The down migration removes only **global** rows (`user_id IS NULL`) in `staging`/`production` that still hold the seeded value
  (budget `50`, interval `60`), so an operator-set value (e.g. staging `200`) and every per-user override — including one that happens to equal
  the seeded value — survive a rollback. It does not revert the metadata backfill on a surviving row. Accepted limitation: an operator-created
  global row that equals the seeded value is indistinguishable from the seeded row and is removed (harmless: it equals the code default).


## Reproduction Steps

1. `list_config_keys(namespace="analysis")` on any environment: neither `analysis.engine.max_strategies_per_cycle` nor `analysis.engine.eval_interval_seconds` is listed.
2. `SetConfig` without `create_key` is refused `NOT_FOUND` for either key.
3. With 670+ live pairs and budget 50, observe one overflow WARN per live-loop cycle.

## Root Cause Hypothesis

The key was introduced consumed-with-default (unseeded, the pattern feature 227 waived for tuning keys) but is
operationally necessary once the fleet outgrows 50. `SetConfig create_key=true` inserts only `namespace, key,
value_type, value_data, …` (`configServiceImpl.ts:633-646`), so the runtime row has NULL description/default/consumer;
a bare `ON CONFLICT DO NOTHING` seed would leave staging without them (hence FR-2's metadata backfill). The overflow
WARN is a steady-state condition logged at WARN per cycle; FR-5 fixes the volume, the level stays WARN on a state change.

## Affected Services

xstockstrat-analysis (live-loop WARN throttling; `CLAUDE.md` rows), xstockstrat-config (seed migration, `SCALAR_BOUNDS_REGISTRY` entries in
`src/grpc/configServiceImpl.ts` with their test, the `scripts/config-wiring.json` baseline, and the `scripts/migration-assertions/config-NNN.sql`
assertion).

## Consumer Surface(s)

- [x] `/config-ui` (generic config table) and the Agent MCP tools `list_config_keys` / `set_config`: pick up the new
  registry rows for both keys (description, default `50` / `60`, bounds, no `create_key` needed) with **no UI or agent code change** — verified: no
  hard-coded reference to either key in UI/agent paths. The overflow-WARN throttling is an internal log-volume change
  observable only in Loki/Grafana. No UI or agent implementation step is required (C-14).

## Fix Scope

- Proto: none.
- Database: **config-service migration** — up + down pair in `services/xstockstrat-config/migrations/`, up = **three statements**: (1) one `INSERT … ON CONFLICT
  (namespace, key, environment, COALESCE(user_id, '')) DO NOTHING` of four global rows (two keys × `staging`/`production`, `updated_by =
  'system:config-migration-NNN'`) — the only INSERT shape `scripts/check-config-wiring.mjs` `applyInsert` accepts (`DO UPDATE` makes `--declared-migration`
  exit 2); (2)–(3) one metadata-only `UPDATE` per key setting `description` / `default_value` / `consuming_service` to `COALESCE(NULLIF(col,''), <seed>)`
  guarded by `WHERE namespace='analysis' AND key=<k> AND user_id IS NULL AND environment IN ('staging','production') AND (NULLIF(description,'') IS NULL
  OR NULLIF(default_value,'') IS NULL OR NULLIF(consuming_service,'') IS NULL)`, never setting `value_data`, `value_type` or `updated_by`
  (precedent: feature 244 migration `032_analysis_zero_trap_descriptions.up.sql`). Down = one `DELETE` with explicit parentheses:
  `… AND user_id IS NULL AND ((key=<budget> AND value_data='50') OR (key=<interval> AND value_data='60'))`. Neither file contains `BEGIN`/`COMMIT`.
  The audit trigger logs only `IF OLD.value_data IS DISTINCT FROM NEW.value_data` (`017_config_secrets_and_scoping.up.sql:69`), so the metadata UPDATE
  writes no audit row but moves `updated_at` (`017:76`); the INSERT's AFTER INSERT trigger writes one audit row per new row
  (`changed_by` = the sentinel); the down's DELETE writes none. A real-Postgres assertion `scripts/migration-assertions/config-NNN.sql`
  (template `config-031.sql`, run by `scripts/migration-rerun.sh`) verifies AC-1/3/4/7/9/10/12.
  **NNN rule (soft ordering, operator decision 2026-11-05):** the spec-time number is `038` (above 291's `035` and 281's `037`); at merge NNN =
  max(`origin/main-dev` config migration)+1 **exactly — renumbering down as well as up**; whichever of 281/291/293 merges later renumbers (recorded as a
  Deviation Log entry; every embedded NNN is listed in `design.md`). golang-migrate skips a lower version that lands after a higher one on an
  already-migrated database, which is why the renumber must track `origin/main-dev`, not the spec-time number.
- Pre-apply operator check, both keys in both environments: the `key` column is the full-dotted string under `namespace='analysis'`, there is no
  namespace-stripped `engine.*` twin, `value_type = 'int'`, and per-user rows are listed; otherwise stop and repair by hand (the migration never
  changes `value_type`, and a non-int row silently reads as the code default through `get_int`).
- Config keys registered: `analysis.engine.max_strategies_per_cycle` (int, default 50, bounds `[1, 1000]`) and `analysis.engine.eval_interval_seconds` (int, default 60, bounds `[30, 600]`).
- Docs: "Seeded by migration NNN (feature 293); bounds `[…]`" note on the analysis `CLAUDE.md` Config Keys rows (`:528-529`); entry in the Per-Feature
  Registered Keys log in `docs/patterns/config-governance.md`; `merge-order.md` rows for 293↔281/291 are soft.
- Governance gates (root `CLAUDE.md` § Approval Flow): DB migration — config-service owner + DBA; new config keys — analysis owner + config team (both keys).
- Live-loop code: throttle the overflow WARN (FR-5) and change the one existing test that asserts a WARN on every
  over-budget cycle: `tests/test_live_loop.py:783-808` `test_rotation_logs_window_cursor_and_cycle_summary` runs two
  over-budget cycles and indexes `warns[1]` — under FR-5 the second cycle has the same state and no second WARN, so
  that assertion is an intended CHANGE (the window/cursor detail then lives on the first WARN of a state and on the
  per-cycle INFO). `:759-780` `test_truncation_warns_only_when_over_budget` asserts exactly one WARN in one over-budget
  cycle and stays valid (PRESERVE; optionally add a second-cycle assertion of no extra WARN).
- **Two PRs (operator decision 2026-11-05):** PR-1 = the live-loop overflow-WARN latch (analysis only, no migration dependency, ships independently);
  PR-2 = the config seed + bounds + baseline removal + assertion + docs (soft-ordered against 281/291).


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
- The verification route for AC-3/AC-4/AC-7/AC-9/AC-12 is settled in `design.md`: the real-Postgres harness `scripts/migration-rerun.sh` +
  `scripts/migration-assertions/config-NNN.sql` (template `config-031.sql`) — the earlier statement here that the config service has no
  real-Postgres harness was incorrect.
- `analysis.engine.alert_throttle_seconds` (same loop, same `read-unseeded` baseline entry at `scripts/config-wiring.json:72-77`, owner feature 278):
  a deliberate omission — the operator widened scope to `eval_interval_seconds` only; the baseline entry with its owner keeps tracking it.
