# Recon: fix-analysis-live-loop-budget-seed

**Created**: 2026-11-05
**From**: product-spec.md
**Tree**: ccr-e5badadb-vrersi@70e0d5ab ≡ origin/main-dev +22 unpushed-to-main-dev (spec commits on the PR branch; behind 0). Deviation from `tree-freshness.md`: HEAD is not on `main-dev` because the 289–293 spec artifacts exist only on this branch; it contains every `origin/main-dev` commit.
**Affected services**: xstockstrat-analysis, xstockstrat-config (consumer surface: none — `/config-ui` and the agent `set_config`/`list_config_keys` tools are generic)

---

## Objective

Make `analysis.engine.max_strategies_per_cycle` a registered, discoverable, bounded config key in every environment
(seed migration + `SetConfig` bounds + wiring-baseline removal) and stop the live loop from logging the same budget-overflow
WARN every ~68 s for a steady-state condition (once per state change instead).

## Codebase Map

- **`xstockstrat-analysis`** (Python) — `services/xstockstrat-analysis/app/engine/live_loop.py`
  - Single instance per process: `app/main.py:150`, spawned once `:168`; no other caller of `_run_cycle` (cycles never overlap).
  - `run_forever` `:334-347` — `sleep(interval)` `:338`, dead `_lock.locked()` skip `:339-341` (`_lock` referenced only `:315,339,342`), inline `await self._run_cycle()` `:344`, heartbeat `:345`, error log `:346-347`.
  - `_run_cycle` `:349-499` — budget read `:359` (`int_positive(self._cfg, "analysis.engine.max_strategies_per_cycle", 50)`, re-read **every cycle**); early return `:435-436` (`if not records: return`, before any state update); `n == 0` return `:440-441` (unreachable: `int_positive` ≥ 1); overflow WARN + `_TRUNCATION_COUNTER.add(len(pairs) - max_pairs)` share one `if len(pairs) > max_pairs:` `:445-462`; unconditional INFO `live_loop: evaluated %d/%d pairs …` `:481-489`; dataless WARN `:490-499`.
  - Per-instance state precedents (where an overflow latch would live): `__init__` `:274-315` — `_cursor_key :297`, `_fund_unavailable :304` ("in-memory, so a restart re-alerts at most once per still-unavailable pair"), `_logged_unresolved :314` (log-once-per-key).
  - `_TRUNCATION_COUNTER` `:77-81` (module-level, `analysis.live_loop.truncated_pairs`).
  - Config readers: `app/config/watcher.py:140-144` `int_positive` (`v if v > 0 else default`), `get_int :111-117` (absent / non-`int_val` → default); watcher is a live `WatchConfig` snapshot (`app/main.py:43`).
  - The default `50` is a literal at `live_loop.py:359`, the test tables (`tests/test_config_zero_clamps.py:34`, `tests/test_config_read_classification.py:28`) and the CLAUDE.md row — no named constant.
- **`xstockstrat-config`** (Node) — `services/xstockstrat-config/`
  - Last migration `034_retire_portfolio_snapshot_interval` (`migrations/`, 000–034 all paired). Claims above it: `035` = feature 291 (docs only, `291/implementation-spec.md:83-84`); `037_portfolio_signal_prune_interval` is **on** `origin/feature/signal-watchlist-expiry-pruning` (feature 281, verified by `git ls-tree`); `036`/`038` unclaimed.
  - Table `config.config_values` DDL `001_config_tables.up.sql:6-21` (+ `environment` 002, `user_id`/`value_encrypted` 017:24-28); conflict target `config_values_scope_uniq (namespace, key, environment, COALESCE(user_id,''))` `017:101-102`.
  - Audit triggers: BEFORE UPDATE audits only on `value_data` change (`017:66-79`, guard `:69`); AFTER INSERT audits every newly inserted row (`010_…:26-29`, fn `017:81-91`) — a fresh seed writes one audit row per new env, `ON CONFLICT DO NOTHING` that conflicts writes none.
  - `SCALAR_BOUNDS_REGISTRY` `src/grpc/configServiceImpl.ts:103-149`; `lookupScalarBounds :154-156` tries the bare key then `namespace.key`; enforcement `:555-567` (NaN / out-of-range → `INVALID_ARGUMENT` code 3, **before** the existence gate `:569-604`; non-integers like 1.5 are not rejected); `create_key` upsert `:633-646` inserts only `namespace,key,value_type,value_data,value_encrypted,is_secret,updated_by,update_reason,environment,user_id,caller_identity` and its `DO UPDATE` never touches `value_type/description/default_value/consuming_service` → a runtime-created row has **NULL** (not `''`) metadata.
  - Wiring check: `scripts/check-config-wiring.mjs` — `applyInsert :172-201` (only bare INSERT or `ON CONFLICT … DO NOTHING`; else `--declared-migration` exits 2), `applyUpdate :203-248` (SET columns outside `SCOPE_COLS :15` → modelled, returns at `:214`), `buildStoredSet :352-376` (reads only `*.up.sql`), `ratchet :683-697` (`--final`: a baseline entry no longer produced → `STALE:` hard failure). Baseline entry `scripts/config-wiring.json:84-89` (`read-unseeded`, owner feature 278). CI job `config-wiring` `.github/workflows/ci.yml:955-973` (`node --test scripts/config-wiring.test.mjs` runs `--final` on the real tree `:472-475`).

## Patterns to REUSE

- Seed rows → `028_analysis_opportunity_keys.up.sql:24-117` (columns `(namespace,key,value_type,value_data,description,default_value,consuming_service,environment,user_id)`, one row per `staging`/`production`, `user_id` NULL, full-dotted `key`, tail `ON CONFLICT (namespace, key, environment, COALESCE(user_id, '')) DO NOTHING`); smallest instance `033_ledger_stream_resolve_timeout.up.sql:8-17`; header rationale (key == exact reader string) `028:12-17`, `033:5-6`.
- Metadata-only UPDATE → `032_analysis_zero_trap_descriptions.up.sql:5-9` (idempotent via WHERE guard). Raw-SQL `updated_by` sentinel convention `system:config-migration-<NNN>` (`docs/patterns/config-governance.md:138`; 028/033 do not set it).
- Down migration scoped to global rows → `028_…down.sql:8-27` (`user_id IS NULL`, explicit key list); 293 narrows further with `value_data = '50'` (033's down has no env/user filter — do not copy it).
- Bounds → registry entries `configServiceImpl.ts:122` (`max_concurrent_bars_fetches` {1,5}), `:124`, `:125` ({1,50}), `:128` ({1,50}), `:129` ({1,500}); test table `setConfigScalarBounds.test.ts` `TIMEOUT_KEY_FORMS :266-289` (rows `{ns,key,field,min,max}`, generated accept-min/max + reject min-1/max+1, `:291-309`; each key listed stripped and full-dotted); hand-written precedents `:216-250`, `:252-262`.
- Migration behaviour verification → **real-Postgres harness exists**: `scripts/migration-rerun.sh` (assertion loop `:183-190`, CI job `ci.yml:683-719`, path filter includes `scripts/migration-assertions/**`) + template `scripts/migration-assertions/config-031.sql` (`BEGIN`, fixture rows incl. per-user, `CREATE TEMP TABLE` snapshot, `\ir` the up file, `DO $$ … RAISE EXCEPTION 'AC-N: …'`, no-collateral EXCEPT diff, `ROLLBACK`). Constraint: assertions run after the whole chain, so the fixture must DELETE/UPDATE the seeded rows before replaying the up file. **Correction to `product-spec.md` § Out of Scope**: it says the config service has no real-Postgres harness; it has one (up-side oriented, down files `\ir`-able from a hand-written assertion).
- Once-per-state log dedup → `_fund_unavailable` (`live_loop.py:304`) and `_logged_unresolved` (`:314`): in-memory per-instance sets, restart re-logs once.
- Live-loop tests → `tests/test_live_loop.py` `_make_loop :37-59`, `_live_row :647`, `TestLiveLoopFairShare._cfg_max :706-712` (rebinds the budget between cycles on the same loop), multi-cycle driver pattern `:714-731` (`loop._db.fetch = AsyncMock(...)`, `loop._eval_pair = fake_eval`, repeated `await loop._run_cycle()`), zero-pair cycle `:736`, `caplog` capture; counter assertions need an `InMemoryMetricReader` (`metric_reader` in `tests/test_telemetry.py`, `otel_reset` `tests/conftest.py:501`) — no test reads `_TRUNCATION_COUNTER` today.
- Docs → analysis `CLAUDE.md:529` row (sibling phrasing "Seeded by migration `028` (feature 184); bounds `[1,1000]`"); `docs/patterns/config-governance.md` Per-Feature Registered Keys log `:140` (newest first, feature 249 at `:144`, heading `### feature NNN — slug (xstockstrat-a / xstockstrat-b)`, seeded-key precedent feature 248 `:163`).

## Existing Business Rules (preserve / extend)

No CHANGE verdicts. No durable `@AC-*` guards live-loop rotation, truncation, cursor, the truncation counter or the overflow WARN, and the feature-091 existence gate has no durable `@AC-*` (documented only in `services/xstockstrat-config/CLAUDE.md`) — 293's own scenarios are the only guard for the "unchanged" halves.

- **PRESERVE** `@AC-6 @FR-3 @regression @feature-244` "A trap-dependent site keeps the coded default for a stored zero" (`docs/sdd/business-rules/platform.feature:480`, row `:496`) — a stored 0 still reads as 50; seed and `[1,N]` bound are write-side only and never rewrite an existing row (bounds are write-path only: `@AC-9 @FR-2 @feature-182`, `services/xstockstrat-config/acceptance/readiness-materializer-config-keys.feature:31`).
- **PRESERVE** `@AC-3 @FR-1 @feature-278` (`platform.feature:811`), `@AC-7 @FR-4 @feature-278` (`:840`), `@AC-8 @FR-4 @feature-278` (`:847`), `@AC-4/@AC-10 @FR-2 @feature-278` (`:818`, `:860`) — the seed resolves the `read-unseeded` finding; remove only this key's baseline entry, atomically with the seed; remaining entries keep owners.
- **PRESERVE** `@AC-11 @FR-6 @regression @feature-244` (`services/xstockstrat-config/acceptance/fix-python-config-stored-zero.feature:28`) — metadata-only UPDATE scoped to this one key, never touches `value_data/value_type` or 027/028 rows.
- **PRESERVE** `@AC-4 @FR-4`, `@AC-5 @FR-4 @regression @feature-243` (`…/fix-sandbox-seed-keys.feature:25`, `:34`) — a pre-existing row keeps its value; no `config_values_scope_uniq` violation.
- **EXTEND** `@AC-8 @FR-6 @regression @feature-244` (`…/fix-python-config-stored-zero.feature:8`) — new key's `[1,N]` bound rejects 0 as `max_concurrent_bars_fetches` `[1,5]` does; `@AC-1/@AC-2 @feature-182` (`…/readiness-materializer-config-keys.feature:38`, `:49`), `@AC-1/@AC-2/@AC-3 @feature-184` (`…/opportunity-config-operability.feature:14`, `:22`, `:30`), `@AC-1 @feature-243` (`…/fix-sandbox-seed-keys.feature:4`) — seed convention (global rows, both envs, full-dotted key, int `"50"` = code default, value_type matches getter); `@AC-4 @FR-3 @feature-182` (`:58`) — idempotent, reversible (293's down is narrower; 027's is untouched); `@AC-4/@AC-5/@AC-8 @feature-184` (`:37`, `:45`, `:52`), `@AC-5/@AC-7/@AC-8 @feature-182` (`:11`, `:18`, `:24`), `@AC-7/@AC-11/@AC-12 @feature-161` (`…/surface-signal-weight-decay-config.feature:8`, `:21`, `:28`) — registry entry, inclusive edges, `INVALID_ARGUMENT` with nothing written, in-bounds write succeeds without `create_key` once seeded.
- **PRESERVE** `@AC-4/@AC-11 @FR-3 @regression @feature-258` (`…/fix-config-stream-resilience.feature:31`, `:67`) — `SetConfig` error statuses unchanged.
- **PRESERVE** `@AC-6 @FR-4 @feature-215` (`services/xstockstrat-analysis/acceptance/block-fundamentals-strategy-on-etf.feature:48`) — the live loop's one existing once-per-state WARN + one WARNING alert; the overflow throttle is independent of it and must not suppress or merge it. `@AC-1/2/3 @FR-1 @feature-186` (`…/fundamentals-blend-strategy-restrictions.feature:8,17,25`) — pair selection and blend universe unchanged. `@AC-9 @FR-4 @regression @feature-244` (`…/fix-python-config-stored-zero.feature:39`) — the throttle must not reuse `analysis.engine.alert_throttle_seconds`. Overflow path must emit no alert (WARN log only; `fix-push-untargeted-broadcast.feature` tags unverified).
- Notes: the throttle's budget in the state key must be the **effective** value (post-`int_positive`), not the raw stored value; the baseline removal and the seed must land in one atomic step.

## Dependencies

- Proto/RPC: none.
- Migration: `services/xstockstrat-config/migrations/` — next free is `035` locally, but 035 is claimed by feature 291 and 037 by feature 281 (on its branch) → 293 takes a number above both (≥ `038`) at `/sdd-spec` time, re-verified against `origin/main-dev` and open branches (`merge-order.md:97`: 293 merges after 281 and 291; golang-migrate skips a lower version landing after a higher one on an already-migrated DB).
- Config keys: `analysis.engine.max_strategies_per_cycle` (existing, unregistered → seeded); bounds `{minValue: 1, maxValue: N}` (candidate N = 400).
- Inter-service edges: none new.
- New env vars / ports: none.
- Overlap — feature 294 (`implementation-spec.md` Step 13 `:540-593`, pending): edits `live_loop.py` per-pair handler `:471-479` (after the overflow block), drain failure sites, throttle site `:843-845`, a cycle-duration histogram "around the cycle", `exc_info=True` on the `run_forever` error log `:346-347`; leaves `_TRUNCATION_COUNTER` as-is and keeps the `live_loop: cycle complete` literal. It does not touch the budget read `:359`, the early returns `:435-441`, the overflow block `:445-462` or `__init__`. 293 should anchor by symbol (294 shifts line numbers); likely textual overlap only in `run_forever` and a possible cycle wrapper. Tests: 294 adds `tests/test_live_loop_telemetry.py` and does not modify `test_live_loop.py`. `merge-order.md` rows exist (293↔291, 293↔281; 294 soft rows).
- Overlap — feature 291 also inserts above feature 249 in `docs/patterns/config-governance.md` (`291/implementation-spec.md:376`): expect an append-order conflict on rebase.

## Risks / Not-found

- Operator-chosen values are assistant-chosen candidates: staging `200`, min `1`, max `400`, FR-5 state `(over-budget?, budget)`, FR-6 rollback rule — need operator sign-off.
- FR-5 volume claim depends on in-memory state: a restart re-warns once (accepted, matches `_fund_unavailable`).
- The only metric assertion path for AC-2's "counter +490 per cycle" is an `InMemoryMetricReader` fixture; no existing helper reads `analysis.live_loop.truncated_pairs`.
- Removing the dead `_lock` skip is **not** in scope (it would touch `TestLiveLoopHeartbeat` `:1647-1690`, incl. `test_skipped_cycle_logs_skipping_not_heartbeat :1686`); leave it.
- The assertion harness replays after the full chain: seeded rows already exist in CI's DB, so fixtures must delete them first; `config-031.sql:2` notes later migrations touching these rows must update that file.
- Static `node --test` migration tests (`retiredPortfolioSnapshotInterval.test.ts`, `zeroTrapDescriptionMigration.test.ts`) cannot collide with a new, differently-suffixed migration.
- `fails.md` traps applicable: key column must be the exact full-dotted reader string, verified by read-back not row count (2026-09-16 readiness-materializer-config-keys; insights `fundamentals-data-source`); seeded descriptions must describe the operator-visible effect, not the reader mechanism (2026-11-04 fix-python-config-stored-zero); a recurring "enumerate all sibling arms" lesson (2026-11-04 fix-backtest-silent-symbol-skip) applies to the two early returns before the overflow check.
- **Not found**: a named constant for the budget default; an existing "overflow warned" latch; any test reading `_TRUNCATION_COUNTER`; any analysis acceptance scenario for the budget key / truncation / "evaluated N/M"; contents of unpushed branches' migrations beyond what `git ls-tree` showed; `036`/`038` claims; the exact CLAUDE.md line of the "fair-share scheduler" sentence (`~:224`).

## Recommended Scope

1. Config: migration `NNN_analysis_live_loop_budget_seed.{up,down}.sql` (seed + metadata UPDATE; guarded down), `SCALAR_BOUNDS_REGISTRY` entry + `setConfigScalarBounds.test.ts` rows (+ explicit `-5` and `200` cases), `scripts/config-wiring.json:84-89` removal, `scripts/migration-assertions/config-NNN.sql` (AC-3/4/7/9), `config-governance.md` log entry.
2. Analysis: overflow-WARN latch in `LiveEvaluationLoop` (cleared on under-budget / zero-pair cycle), `test_live_loop.py:783-808` change + new AC-2 test with a metric reader, `CLAUDE.md:529` row.
3. The two parts may land as separate steps/PRs (product-spec Fix Scope).
