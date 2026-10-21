# Recon: fix-python-config-stored-zero

**Created**: 2026-10-20
**From**: product-spec.md
**Affected services**: xstockstrat-analysis, xstockstrat-indicators, xstockstrat-ingest, xstockstrat-config

---

## Objective

In all three Python `ConfigWatcher`s, `get_int`, `get_float` and `get_str` return `v.<x>_val or default`, so a
stored `0`, `0.0` or `""` collapses to the coded default. The fix switches them to `HasField` (operator decision,
2026-10-20), which makes the report's keys honour 0 (backtest commission and slippage, `signal_rank_weight`,
`alert_throttle_seconds`). Every call site that today depends on the trap keeps its current result through an
explicit clamp at the read. The seeded `0`/`''` rows and the `SCALAR_BOUNDS_REGISTRY` lower bounds are re-checked
in this feature.

## Codebase Map

- **`xstockstrat-analysis`** (Python)
  - Entry point: `services/xstockstrat-analysis/app/main.py:42` (`ConfigWatcher(... namespace="analysis")`).
    `:48` builds a second watcher for the `marketdata` namespace from the same class.
  - Handler/servicer: `services/xstockstrat-analysis/app/handlers/servicer.py`. Loops are in
    `app/engine/live_loop.py`, `app/engine/fundsignal_loop.py`, `app/engine/entry_backfill.py` and
    `app/engine/pnl_pattern_consumer.py`. The screener is `app/services/screener.py`.
  - Last migration: `027_contract_owner_dimension.up.sql` (`services/xstockstrat-analysis/migrations/`). This
    feature does not touch it. Config seeds for `analysis.*` live in the config series.
  - Config-read pattern, trapped: `app/config/watcher.py:97` (`get_str`), `:105` (`get_int`) and `:134`
    (`get_float`), each `return v.<x>_val or default`.
  - Other key symbols:
    - `get_int_present` — `watcher.py:118`
    - `get_bool` — `:126`
    - `get_float_present` — `:147`
    - dead sandbox helpers — `:150-162`, whose only references are tests at
      `tests/test_analysis_servicer.py:598-606`
- **`xstockstrat-indicators`** (Python)
  - Entry point: `services/xstockstrat-indicators/app/main.py:47` (`ConfigWatcher(... namespace="indicators")`).
  - Handler/servicer: `app/handlers/servicer.py`.
    - `:102` — `asyncio.Semaphore(max(1, config_watcher.sandbox_max_concurrent()))`
    - `:277-278` — request-override `or` fallbacks, out of scope
    - `:303` — `max_concurrent=self._cfg.sandbox_max_concurrent()`, with no clamp
    - Sandbox consumers in `app/services/sandbox.py`: `:282` (`if {memory_bytes} > 0:` guard on `RLIMIT_DATA`),
      `:345-346` (`rlimit_cpu`, `rlimit_nproc = max_concurrent * 16`) and `:377` (communicate timeout)
  - Last migration: `007_private_formulas_templates.up.sql` (`services/xstockstrat-indicators/migrations/`), not
    touched.
  - Config-read pattern, trapped: `app/config/watcher.py:96` (`get_str`), `:114` (`get_int`) and `:130`
    (`get_float`). The target pattern already exists at `:106` (`get_str_present`) and `:122` (`get_bool`).
  - Other key symbols: sandbox properties at `watcher.py:133-148` (`sandbox_timeout_ms`, `sandbox_memory_bytes`,
    `sandbox_allowed_imports`, `sandbox_max_concurrent()`).
- **`xstockstrat-ingest`** (Python)
  - Entry point: `services/xstockstrat-ingest/app/main.py:46` (`ConfigWatcher(... namespace="ingest")`).
  - Handler/servicer: `app/handlers/servicer.py`.
    - `:323` — job semaphore
    - `:606-607` — chunk planner inputs
    - `:741` — retry attempts
    - `:749` — chunk semaphore
    - `:1065` — dedup window
    - Planner floors are at `app/repositories/backfill_chunks.py:51-52` (`max(1, window_days)` /
      `max(1, max_bars)`).
    - The poll loop is `app/engine/mcp_client_loop.py:133-138,162-167` (`max(get_int(...), 1)`), with defaults
      at `:30-31`.
  - Last migration: `014_contract_signal_ownership.up.sql` (schema only, not touched).
  - Config-read pattern, trapped: `app/config/watcher.py:110` (`get_str`), `:118` (`get_int`) and `:144`
    (`get_float`). The target pattern is at `:128` (`get_int_present`) and `:136` (`get_bool`).
  - Other key symbols:
    - Backfill and dedup properties at `watcher.py:183-215`. The trap-retention comments at `:185-186` and
      `:208-209` cite stale lines `servicer.py:191`/`:519`; the real sites are `:323`/`:749`.
    - Dead sandbox helpers at `:166-180`; the only references are `tests/test_ingest_servicer.py:1125-1137`.
- **`xstockstrat-config`** (Node.js)
  - Entry point: `services/xstockstrat-config/src/index.ts`.
  - Handler: `src/grpc/configServiceImpl.ts`.
    - `toProtoSnapPayload` is at `:32-64`. It uses `!== undefined` per oneof arm (`:49-52`), so a 0 or `""` value
      is emitted as an explicit member.
    - `buildConfigValue` is at `:574`.
    - The existence gate is at `:466-469`.
  - Last migration: `030_marketdata_edgar_snapshot_keys.up.sql` (`services/xstockstrat-config/migrations/`). The
    next free number is 031, which 243 has already claimed.
  - Config-read model: the Node getter `src/services/configWatcher.ts:113-121` (`v?.intVal ?? def`). This is the
    semantics FR-1 ports to Python.
  - Other key symbols:
    - `SCALAR_BOUNDS_REGISTRY` — `configServiceImpl.ts:100-146`, write-only per `:99`
    - `lookupScalarBounds` — `:151-153`
    - Proto oneof — `packages/proto/config/v1/config.proto:60-67`

### Call-site classification (every `get_int`/`get_float`/`get_str` read; re-grepped 2026-10-20)

Legend:
- **FR-3** — a stored 0/`""` is unsafe; an explicit clamp restores the coded default.
- **FR-4** — the report's keys; honour 0.
- **honour** — 0/`""` is legitimate, or equal in effect to the default.
- **present** — already `HasField`; unchanged.
- **design** — still to classify; recon recommends a value.

**xstockstrat-analysis** (all paths under `services/xstockstrat-analysis/app/`)

| Key | Read site | Class | Note |
|---|---|---|---|
| `backtest.default_commission_pct`, `default_slippage_pct` | `handlers/servicer.py:787-788` | FR-4 | applied at `servicer.py:196,198,212-214` |
| `opportunity.signal_rank_weight` | `servicer.py:4615`, `:4859` | FR-4 | sort-0 blend at `repositories/opportunities.py:37-38` |
| `engine.alert_throttle_seconds` | `engine/live_loop.py:351` | FR-4 | check at `live_loop.py:815`; 0 means no throttle |
| `engine.eval_interval_seconds` | `live_loop.py:329-330` | FR-3 | 0 makes `asyncio.sleep(0)` busy-loop; no bounds row |
| `engine.max_strategies_per_cycle` | `live_loop.py:350` | FR-3 | `:431-432` returns on `n == 0`, so 0 evaluates nothing |
| `strategy.max_concurrent_entry_backfill` | `engine/entry_backfill.py:57` | FR-3 | already `max(1, …)`; that floor gives 1, not 4 |
| `fundsignal.run_interval_hours` | `engine/fundsignal_loop.py:137-138,148-151` | FR-3 | `max(1, …)*3600` gives 1 h, not 24 h |
| `engine.fundamentals_blend_strategy_id` (str) | `servicer.py:355` (`blend_strategy_id`, sole reader) | FR-3 | `""` clamps to `fundamentals_macd_blend` |
| `fundsignal.source_slug` (str) | `live_loop.py:162`; `fundsignal_loop.py:171` | FR-3 | `""` clamps to `fundamentals` |
| `backtest.portfolio_position_weight` | `servicer.py:1154-1156` | FR-3 | 0 gives zero-size positions |
| `series.max_concurrent_components`, `opportunity.max_concurrent_bars_fetches`, `opportunity.max_concurrent_candidates`, `compute.max_worker_threads`, `readiness_materializer.max_concurrent_bars_fetches`, `backtest.portfolio_max_concurrent`, `screener.max_concurrent_formula_evals` | `servicer.py:538,543,549,556,585,1157-1159`; `services/screener.py:85` | FR-3 | each already `max(1, …)`; clamp must give the default, not 1 |
| `backtest.detail_retention_per_strategy` | `servicer.py:2914` | FR-3 | `max(1, …)` gives 1, not 20 |
| `screener.max_duration_seconds` | `servicer.py:3786` | FR-3 | `wait_for(timeout=0)` at `:3789` |
| `backtest.max_range_days` | `servicer.py:874-875` | FR-3 | 0-day cap; rejected at `:880` |
| `strategy.default_cooldown_days` | `servicer.py:1167,2130`; `live_loop.py:748` | FR-3 | 0 gives no cooldown, not 31 |
| `scoring.shrinkage_days` | `servicer.py:2672` | FR-3 | passed to `_aggregate_cells` (`servicer.py:6917`) |
| `snapshot.indicator_timeout_ms`, `signal_timeout_ms` | `engine/pnl_pattern_consumer.py:364-365` | FR-3 | 0 times out immediately |
| `screener.max_universe_size` | `services/screener.py:92-93` | FR-3 | `[:0]` gives an empty universe |
| `opportunity.max_universe_size` | `servicer.py:5470` | FR-3 | budget computed at `:5479` |
| `fundsignal.max_symbols_per_run`, `daily_call_budget` | `fundsignal_loop.py:181,222` | FR-3 | 0 means the producer emits nothing |
| `backtest.default_fill_model` | `servicer.py:794` | honour | default is 0; only the comment at `:789-790` changes (fails.md:1877) |
| `opportunity.read_db_budget_ms`, `live_enrich_timeout_ms` | `servicer.py:4545-4549`, `:4701-4705` | honour | already clamped locally by `<= 0` → `_DEFAULT_*` |
| `scoring.sharpe_weight`, `drawdown_weight`, `win_rate_weight` | `servicer.py:1294-1296`, `:2658-2660` | honour | linear sum at `servicer.py:6892-6896` (no division); 0 drops a component; unseeded. Not in any digest; found by recon re-grep |
| `scoring.min_evidence_symbols`, `min_evidence_days` | `servicer.py:2677-2678` | honour | 0 means never provisional |
| `fundsignal.buy_quantile`, `sell_quantile` | `fundsignal_loop.py:227-228` | honour | 0.0 is a valid quantile (`_map_directions` `:470-482`) |
| `fundsignal.min_conviction_to_emit` | `fundsignal_loop.py:229` | honour | default 0.0; seeded 0.0 (`008_…:43-44`); no change |
| `fundsignal.universe_source` (str) | `fundsignal_loop.py:307` | honour | a `""` value falls through to the `watchlists` branch (`:309-314`), the same as the default |
| `fundsignal.explicit_symbols`, `scoring_formula_id` (str) | `fundsignal_loop.py:308`, `:201`, `:411` | honour | default `""` |
| `marketdata.fundamentals.provider` (str, md watcher) | `fundsignal_loop.py:97` | honour | default `""` |
| `screener.default_rank_limit` | `services/screener.py:177-181` | honour (recommend) | `if rank_limit > 0:` means 0 is uncapped |
| `patterns.min_sample_count` | `servicer.py:4265` | honour (recommend) | 0 keeps all buckets |
| `patterns.indicator_bucket_count` | `servicer.py:4266` | design | `bucket_pnl_factors` floors it with `max(1, …)` (`servicer.py:387`), so 0 gives 1 bucket, not 5 (degenerate). Recommend FR-3 |
| `fundsignal.valid_days` | `fundsignal_loop.py:232` | design | `valid_until = now + timedelta(days=0)` (`:525`) emits already-expired signals. Recommend FR-3 |
| `opportunity.max_live_strategies_per_symbol`, `max_live_held_symbols_per_compute`, `max_live_only_symbols_per_compute` | `servicer.py:5294,5346,5382` | design | `[:0]` keeps none. Bounds `[1,50]`/`[1,500]` (`configServiceImpl.ts:122-124`) reject 0 at SetConfig; only a direct DB row reaches it. Recommend FR-3 |
| `opportunity.valid_window_hours` | `servicer.py:4873,5510` | design | 0 expires immediately. Bound `[1,168]` (`configServiceImpl.ts:127`). Recommend FR-3 |
| `opportunity.snooze_default_hours` | `servicer.py:6166` | design | 0 gives `snooze_until = now` (a no-op snooze); unbounded. Recommend FR-3 |
| about 29 `*_present(` reads (e.g. `servicer.py:3890,5872,5890,5927,5954`, `live_loop.py:754`, `fundsignal_loop.py:143,154,162`, `servicer.py:4161`) | — | present | unchanged; stay unclamped (C-16, see below) |

**xstockstrat-indicators** (`services/xstockstrat-indicators/app/`)

| Key | Read site | Class | Note |
|---|---|---|---|
| `indicators.sandbox.timeout_ms` | `config/watcher.py:134` → `handlers/servicer.py:277` → `services/sandbox.py:345,377` | FR-3 | 0 times out immediately |
| `indicators.sandbox.memory_bytes` | `watcher.py:138` → `servicer.py:278` → `sandbox.py:282` | FR-3 | 0 skips `RLIMIT_DATA` (the guardrail is dropped) |
| `indicators.sandbox.max_concurrent` | `watcher.py:148` → `servicer.py:102` (clamped), `:303` (unclamped) → `sandbox.py:346` | FR-3 | 0 gives `RLIMIT_NPROC` 0. The clamp must cover `:303`, so place it in the accessor |
| `indicators.sandbox.allowed_imports` (str) | `watcher.py:142-144` (`get_str_present`) | present | `""` denies all imports (feature-173 suite) |

No other `get_*` caller exists in indicators `app/`.

**xstockstrat-ingest** (`services/xstockstrat-ingest/app/`)

| Key | Read site | Class | Note |
|---|---|---|---|
| `ingest.backfill.max_concurrent_jobs` | `config/watcher.py:187` → `handlers/servicer.py:323` | FR-3 | `Semaphore(0)` deadlocks |
| `ingest.backfill.max_concurrent_chunks` | `watcher.py:210` → `servicer.py:749` | FR-3 | `Semaphore(0)` deadlocks |
| `ingest.backfill.chunk_max_bars`, `chunk_window_days` | `watcher.py:200,204` → `servicer.py:606-607` → `repositories/backfill_chunks.py:51-52` | FR-3 | the planner floor gives 1 bar/day, not 200000/90 |
| `ingest.mcp_client.request_timeout_seconds`, `poll_interval_seconds` | `engine/mcp_client_loop.py:133-138,162-167` | FR-3 | `max(0,1)` gives 1 s, not 30/300 |
| `ingest.backfill.max_retry_attempts`, `ingest.signals.dedup_window_hours` | `watcher.py:195,215` (`get_int_present`) | present | 0 is honoured (feature-173 suite) |
| `ingest.backfill.retry_on_failure` | `watcher.py:191` (`get_bool`) | present | — |
| dead `sandbox_timeout_ms`, `sandbox_memory_bytes`, `sandbox_allowed_imports` | `watcher.py:169,173,177` | design | no `app/` caller; clamp or remove |

## Patterns to REUSE

- **HasField getter body (FR-1)**. Reuse the existing in-file accessors:
  - `get_bool` — analysis `watcher.py:126`, indicators `:122`, ingest `:136`
  - `get_int_present` — analysis `:118`, ingest `:128`
  - `get_float_present` — analysis `:147`
  - `get_str_present` — indicators `:106`

  Each is `return v.<x>_val if v.HasField("<x>_val") else default`. The None-snapshot and missing-key guards
  that precede it already satisfy FR-2. Do not write a new helper: once the plain getters carry this body, the
  `*_present` variants are behavioural duplicates (C-18 DRY). Design decides whether to keep them as aliases or
  remove them (see Risks).
- **Semantic model**: the Node getter `services/xstockstrat-config/src/services/configWatcher.ts:113-121`
  (`?? def`).
- **"Stored 0 → coded default" clamp (FR-3)**:
  - Reuse the local guard at `servicer.py:4545-4549`: `if budget_ms <= 0: budget_ms = _DEFAULT_OPP_READ_DB_BUDGET_MS`.
    It keeps the default in one module constant, so the literal does not appear twice (DRY guard rail,
    `docs/patterns/dry-guard-rail.md`).
  - Ingest already has named defaults at `mcp_client_loop.py:30-31`.
  - The existing `max(1, …)` wrappers (`servicer.py:538,543,549,556,2914`; `entry_backfill.py:57`;
    `screener.py:85`) guard negatives only. FR-3 keeps them (`<= 0` subsumes them).
- **Indicators default duplication**: the sandbox defaults appear in `watcher.py:134,138,148` and again in
  `sandbox.py:332-335` (`timeout_ms: int = 5000`, …). A clamp must not add a third copy.
- **Real-snapshot watcher fixtures (AC-1/AC-4/AC-6)**:
  - analysis `_StubWatcher(ConfigWatcher)` at `tests/test_analysis_servicer.py:483-490`, plus
    `TestConfigWatcherGetters` at `:491`
  - ingest `_int_watcher(**int_values)` at `tests/test_config_watcher.py:50`
  - indicators `_str_watcher` at `tests/test_config_watcher.py:51-56`, which uses `ConfigWatcher.__new__` and
    `config_pb2.ConfigSnapshot()`. Extend it with `int_val`/`float_val` arms.
- **Real watcher inside a servicer (AC-5)**: ingest `test_effective_max_attempts_honors_stored_zero`
  (`tests/test_ingest_servicer.py:73`, `svc._cfg = w`). Assert on `svc._backfill_sem`.
- **Semaphore-capacity assertion (AC-6 `max_concurrent`)**: indicators `test_semaphore_gates_at_configured_bound`
  (`tests/test_execute_formula_concurrency.py:93`), with `_blocking_execute_double` at `:40-63`.
- **Loop-level cfg doubles**:
  - ingest `_FakeCfgWatcher(ints=…)` — `tests/test_mcp_client_loop.py:56-63`
  - analysis `_make_cfg(overrides)` — `tests/test_fundsignal_loop.py:20-28`
  - analysis `_cfg_max` — `tests/test_live_loop.py:691-700`
  - analysis throttle-0 override — `tests/test_live_loop.py:271-275`, the AC-9 base
  - analysis `make_servicer()` `side_effect` — `tests/test_analysis_servicer.py:36-60`
- **AC-3 ordering**: extend `tests/test_opportunities_repo.py:152` (`$3` sort semantics).
- **AC-8 bounds**:
  - The `node:test` loopback harness `services/xstockstrat-config/src/__tests__/setConfigScalarBounds.test.ts`
    (`setConfig` helper `:72`; the `RM_CONC` = 0 rejection block `:173-195` is the template).
  - Add the `OPP_CONC` = 0 case, which today is tested only at 10000 (`:216`) and 5 (`:241`).
- **Description-only corrective migration (if design chooses one)**:
  - Use the `UPDATE`-style pattern of `029_heal_config_keys_full_dotted.up.sql` and
    `016_deprecate_analysis_signal_source_weights_desc.up.sql`. Recon did not open 016.
  - Never edit 027/028 (F-01).
- **Ledger patterns carried forward**:
  - insights.md:2903-2919 (173 design). This was a targeted per-key switch with a ≤2-line "zero-trap
    intentional" comment. The operator decision supersedes the per-key part. Its retention-comment rule becomes
    a ≤2-line "clamp: 0 → default, cites consumer" comment. Its named-seam rule (make an inline consumer
    expression RED-provable) applies to FR-3 clamps.
  - fails.md:1877 (151): `default_fill_model` keeps `0 ≡ absent ≡ legacy`. Rewrite the comment rather than
    deleting it.
  - insights.md:3105-3122 (184): a bound's lower edge follows getter semantics. Case (2) ("a `get_int` trap
    makes `minValue 1` correct") loses its premise. `minValue 1` stays correct because the reads now clamp.
  - insights.md:3087-3103 (182): bounds are write-path only. A stored row that predates its bounds row is not
    re-validated.
  - fails.md:1395-1397: a cfg-mock factory must stub every accessor variant. This applies if accessors are
    removed or renamed.
  - insights.md:1060-1062: `MagicMock` makes `HasField` truthy. Use real `config_pb2` messages in new tests.
  - insights.md:3152-3154: `get_bool` + `HasField` honours explicit `false` end-to-end, which is indirect
    evidence that a zero-valued oneof member survives the wire.

## Existing Business Rules (preserve / extend)

No existing rule pins the trap, so this feature needs **no CHANGE**. The FR-4 behaviour changes break no
scenario.

- **PRESERVE** `@AC-1 @FR-2 @regression @feature-173` "A stored max_retry_attempts of 0 makes zero retry attempts, not the default 3" (`services/xstockstrat-ingest/acceptance/fix-python-config-zero-trap.feature`) — the honour-zero path must stay unclamped
- **PRESERVE** `@AC-2 @FR-2 @regression @feature-173` "A stored dedup_window_hours of 0 disables the dedup window, not the default 24" (`services/xstockstrat-ingest/acceptance/fix-python-config-zero-trap.feature`) — must stay unclamped
- **PRESERVE** `@AC-3 @FR-1 @FR-3 @regression @feature-173` "The present-aware accessor honors a present zero and still defaults when unset" (`services/xstockstrat-ingest/acceptance/fix-python-config-zero-trap.feature`) — names `get_int_present`; reword (never delete or renumber) if design removes the `*_present` accessors
- **PRESERVE** `@AC-4 @FR-2 @FR-3 @regression @feature-173` "An empty allowed_imports denies all sandbox imports instead of reverting to the permissive default" (`services/xstockstrat-indicators/acceptance/fix-python-config-zero-trap.feature`) — `allowed_imports` is not FR-3 and stays unclamped; names `get_str_present`
- **PRESERVE** `@AC-8 @FR-2 @feature-184` "A bounded key whose lower edge is a legitimate value accepts that value" (`services/xstockstrat-config/acceptance/opportunity-config-operability.feature`) — `signal_rank_weight` 0 and `refresh_hour_utc` 0 stay settable; FR-6 neither lowers nor raises a bound
- **PRESERVE** `@AC-4 @FR-2 @feature-184` "An out-of-bounds tuning write is rejected at the write edge" (`services/xstockstrat-config/acceptance/opportunity-config-operability.feature`) — FR-6 must not lower any `minValue`
- **PRESERVE** `@AC-2 @FR-1 @feature-184` "Keys are seeded at their current code defaults with getter-matching value_type" (`services/xstockstrat-config/acceptance/opportunity-config-operability.feature`) — FR-5; a description-fixing migration must change no value
- **PRESERVE** `@AC-3 @FR-1 @feature-184` "Applying the migration changes no runtime behavior on its own" (`services/xstockstrat-config/acceptance/opportunity-config-operability.feature`) — FR-5: seeded value equals the default
- **PRESERVE** `@AC-1 @FR-1 @FR-3 @feature-184` "The seed migration registers the opportunity keys per environment" (`services/xstockstrat-config/acceptance/opportunity-config-operability.feature`) — a new migration must not disturb the 028 rows
- **PRESERVE** `@AC-5 @FR-2 @feature-184` "An in-bounds tuning write is accepted without create_key" (`services/xstockstrat-config/acceptance/opportunity-config-operability.feature`) — existence-gate behaviour unchanged
- **PRESERVE** `@AC-8 @FR-6 @feature-182` "An out-of-bounds tuning write is rejected at the write edge" (`services/xstockstrat-config/acceptance/readiness-materializer-config-keys.feature`) — `minValue:1` rows still reject 0
- **PRESERVE** `@AC-2 @FR-1 @FR-2 @feature-182` "Keys are seeded at their current code defaults with getter-matching value_type" (`services/xstockstrat-config/acceptance/readiness-materializer-config-keys.feature`) — 027 seeds; the applied 027 is never edited
- **PRESERVE** `@AC-4 @FR-3 @feature-182` "The migration is idempotent and reversible" (`services/xstockstrat-config/acceptance/readiness-materializer-config-keys.feature`) — a new migration must not alter 027's contract
- **PRESERVE** `@AC-9 @FR-2 @feature-182` "The bounds are write-path only and change no read path" (`services/xstockstrat-config/acceptance/readiness-materializer-config-keys.feature`) — FR-6 adds no bounds; clamps stay at the read
- **PRESERVE** `@AC-7 @FR-5 @feature-161` "the decay half-life is settable at the boundary without create_key" (`services/xstockstrat-config/acceptance/surface-signal-weight-decay-config.feature`) — 0 is a real value; the reader already uses `get_float_present` (`servicer.py:4879,5213`)
- **PRESERVE** `@AC-11 @FR-8 @feature-161`, `@AC-12 @FR-8 @feature-161` "out-of-range / negative decay half-life write rejected" (`services/xstockstrat-config/acceptance/surface-signal-weight-decay-config.feature`) — bounds [0,8760] unchanged
- **PRESERVE** `@AC-4 @FR-3 @feature-151`, `@AC-10 @FR-3 @feature-151` "Legacy same-bar-close fill remains the default" / "An unspecified request with no config override is byte-for-byte legacy" (`services/xstockstrat-analysis/acceptance/backtest-next-bar-fill.feature`) — `default_fill_model` default is 0; no clamp, comment-only change
- **PRESERVE** `@AC-9 @FR-3 @feature-151` "The effective fill model is resolved once and round-trips" (`services/xstockstrat-analysis/acceptance/backtest-next-bar-fill.feature`) — config-default path unchanged
- **EXTEND** `@AC-1 @FR-1 @feature-151`, `@AC-2 @FR-1 @feature-151` "An entry signal fills at the next bar's open" / "An exit (including the vts stop) fills at the next bar's open" (`services/xstockstrat-analysis/acceptance/backtest-next-bar-fill.feature`) — FR-4 adds a stored-slippage-0 case (price equals the bare open) alongside the nonzero "adjusted for slippage" rule
- **PRESERVE** `@AC-3 @FR-3 @feature-150` "Legacy mode remains the default and is unchanged" (`services/xstockstrat-analysis/acceptance/backtest-portfolio-sizing.feature`) — byte-for-byte legacy
- **PRESERVE** `@AC-6 @FR-5 @feature-150` "Insufficient capital skips an entry and is recorded as a capital skip" (`services/xstockstrat-analysis/acceptance/backtest-portfolio-sizing.feature`) — `portfolio_position_weight` 0 clamps to 0.10, so no zero-size fills
- **PRESERVE** `@AC-7 @FR-6 @feature-150` "Portfolio mode honors the strategy's own cooldown windows" (`services/xstockstrat-analysis/acceptance/backtest-portfolio-sizing.feature`) — `default_cooldown_days` 0 clamps to 31
- **PRESERVE** `@AC-1 @feature-156`, `@AC-2 @feature-156` "The producer runs its first cycle promptly…" / "A redeploy within the interval does not reset the schedule" (`services/xstockstrat-analysis/acceptance/fix-fundamentals-signal-producer.feature`) — `run_interval_hours` 0 clamps to 24
- **PRESERVE** `@AC-4 @feature-156`, `@AC-7 @feature-156` "A caught cycle error retries after retry_seconds" / "Startup jitter is bounded" (`services/xstockstrat-analysis/acceptance/fix-fundamentals-signal-producer.feature`) — `get_int_present` reads; do not clamp
- **PRESERVE** `@AC-7 @FR-5 @feature-158`, `@AC-8 @FR-6 @feature-158`, `@AC-9 @FR-6 @feature-158` "A migrated loop's jitter and retry cadence are configuration-driven" / "The daily opportunity refresh re-anchors to its wall-clock hour…" / "…retries soon after a user-enumeration failure…" (`services/xstockstrat-analysis/acceptance/durable-loop-scheduler.feature`) — FR-5/@AC-7: `refresh_hour_utc` 0 and the presence-aware reads are untouched
- **PRESERVE** `@AC-4 @FR-5 @feature-168`, `@AC-5 @FR-5 @feature-168` "Rule is a no-op when the configured blend strategy is not live" / "Config can retarget the rule to a different strategy id" (`services/xstockstrat-analysis/acceptance/fundamentals-blend-universe.feature`) — `fundamentals_blend_strategy_id` `""` clamps to `fundamentals_macd_blend`
- **PRESERVE** `@AC-4 @FR-2 @feature-186`, `@AC-6 @FR-3 @feature-186`, `@AC-8 @FR-4 @feature-186` "ManageStrategy DEACTIVATE is rejected for the blend strategy" / "SetStrategyLive rejects live_enabled=false for the blend strategy" / "Protection tracks runtime config value, not a hardcoded ID" (`services/xstockstrat-analysis/acceptance/fundamentals-blend-strategy-restrictions.feature`) — `blend_strategy_id` is the sole reader and keys on `""`
- **PRESERVE** `@AC-3 @FR-3 @feature-154` "Producer scores the enumerated union when universe_source is watchlists" (`services/xstockstrat-analysis/acceptance/fundsignal-watchlist-universe.feature`) — `explicit_symbols` `""` honoured (zero-default, no clamp)
- **PRESERVE** `@AC-6 @FR-5 @FR-7 @feature-154`, `@AC-9 @FR-7 @feature-154` "The enumerated universe is capped only when FMP is the active provider" / "A non-FMP active provider scores the whole union…" (`services/xstockstrat-analysis/acceptance/fundsignal-watchlist-universe.feature`) — `max_symbols_per_run` 0 clamps to 200
- **PRESERVE** `@AC-10 @FR-4 @feature-190` "Conviction sort is the default ordering" (`services/xstockstrat-analysis/acceptance/opportunities-server-side-filters.feature`) — the default sort is where `signal_rank_weight` acts; a stored 0 still equals the CONVICTION order
- **PRESERVE** `@AC-1 @FR-1 @feature-176`, `@AC-2 @FR-2 @feature-176` "Opportunity compute fans out concurrently but yields the identical set" / "EvaluateReadiness parallelizes per-symbol work under the shared bound" (`services/xstockstrat-analysis/acceptance/analysis-concurrency-offload.feature`) — concurrency keys at 0 clamp to their defaults, not `Semaphore(0)`
- **PRESERVE** `@AC-4 @FR-4 @feature-180` "A large materialization cycle stays within the resource envelope" (`services/xstockstrat-analysis/acceptance/watchlist-readiness-precompute.feature`) — separate semaphore; bound honoured
- **PRESERVE** `@AC-3 @FR-4 @feature-042 @feature-225`, `@AC-6 @FR-6 @FR-7 @feature-042` "QueryPnLPatterns returns the caller's ranked positive and negative factors" / "A snapshot-capture timeout never blocks order execution" (`services/xstockstrat-analysis/acceptance/order-snapshots-pnl-patterns.feature`) — `snapshot.*_timeout_ms` 0 clamps to 500; the `min_sample_count`/`indicator_bucket_count` classification is still open
- **PRESERVE** `@AC-14 @FR-7 @feature-225` "QueryPnLPatterns returns only the caller's own pattern samples" (`services/xstockstrat-analysis/acceptance/private-by-default-enforce-contract.feature`) — relevant only if `min_sample_count` handling changes
- **PRESERVE** `@AC-5 @FR-5 @feature-176` "Concurrent formula executions are no longer serialized to one at a time" (`services/xstockstrat-indicators/acceptance/analysis-concurrency-offload.feature`) — `max_concurrent` 0 clamps to 4, `timeout_ms` 0 to 5000
- **PRESERVE** `@AC-3 @FR-3 @feature-209`, `@AC-5 @FR-3 @feature-209`, `@AC-6 @FR-5 @feature-209` "An infinite-loop / memory-bomb formula is terminated deterministically" / "A fork-bomb formula cannot exhaust host process resources" / "Isolation limits are configured, not hardcoded magic numbers" (`services/xstockstrat-indicators/acceptance/indicators-sandbox-os-isolation.feature`) — sandbox limits must not collapse at a stored 0, including `RLIMIT_NPROC` via `servicer.py:303`
- **PRESERVE** `@AC-2 @FR-2 @regression @feature-228`, `@AC-3 @FR-1 @regression @feature-228`, `@AC-5 @FR-3 @regression @feature-228` "An allocation beyond the headroom fails closed" / "The formula budget does not depend on the interpreter's import footprint" / "A failed baseline probe never runs the formula" (`services/xstockstrat-indicators/acceptance/fix-indicators-sandbox-matrix.feature`) — these pass `memory_bytes` to the sandbox directly; only the watcher 0 → 128 MiB clamp is new. Re-verify `tests/test_sandbox_isolation.py::test_rlimits_derive_from_config_in_wrapper`
- **PRESERVE** `@AC-3 @FR-2 @FR-3 @feature-166`, `@AC-5 @FR-5 @feature-166` "Ingest resolves the bearer token via GetSecret…" / "Unreachable endpoint records health without crashing the service" (`services/xstockstrat-ingest/acceptance/mcp-client-signal-source.feature`) — `mcp_client.request_timeout_seconds`/`poll_interval_seconds` 0 clamp to 30/300
- **PRESERVE** `@AC-6 @FR-3 @FR-1 @feature-224` "The fundamentals loop still runs the system scoring formula" (`docs/sdd/business-rules/platform.feature`) — `scoring_formula_id` `""` honoured (built-in scorer)
- **PRESERVE** `@AC-36 @FR-4 @feature-224` "System slugs are reserved in both directions" (`docs/sdd/business-rules/platform.feature`) — `source_slug` `""` clamps to `fundamentals`
- **PRESERVE** `@AC-35 @FR-14 @feature-224 @feature-225` "Two users with the same mcp_client slug use their own credentials" (`docs/sdd/business-rules/platform.feature`) — poll-loop interval clamp only
- **Same files, different subject (do not regress)**: `xstockstrat-analysis/acceptance/fix-config-watcher-client-id.feature` @AC-1 and `xstockstrat-ingest/acceptance/fix-config-watcher-client-id.feature` @AC-2 (`client_id` prefix) live in the watcher files this feature edits.
- **Coverage**: scenario-recon read `platform.feature` plus all suites of the four affected services: 5 config, 8 indicators, 7 ingest and 32 analysis. About 300 scenarios were scanned and 59 tag lines are relevant. The consumer-surface suites for `xstockstrat-ui` and `xstockstrat-agent` were not read (see Risks).

## Dependencies

- Proto/RPC: none. The `ConfigValue` oneof (`packages/proto/config/v1/config.proto:60-67`) already distinguishes
  zero from unset; no field or RPC changes.
- Migration:
  - No migration is needed unless design corrects the stale seeded descriptions:
    - `028_analysis_opportunity_keys.up.sql:46,49` ("0 is not honored - reads as the 0.3 default (get_float)")
      becomes false.
    - `027_analysis_readiness_materializer_keys.up.sql:50,53` and the 028 `max_concurrent_*`/`max_universe_size`
      descriptions stay behaviourally true but name the wrong mechanism.
  - If design adds one, it is a new pair in `services/xstockstrat-config/migrations/`. The trunk tip is 030, and
    243 claims 031 (`243-fix-sandbox-seed-keys/product-spec.md:44`), so 244 takes 032 or coordinates. Pre-assign
    it via a `merge-order.md` row (C-07; insights.md:900; fails.md:2910). The row does not exist yet.
- Config keys:
  - No new keys.
  - The FR-4 keys `analysis.backtest.default_commission_pct`, `default_slippage_pct` and
    `analysis.engine.alert_throttle_seconds` are unseeded. A first write needs `create_key=true`
    (`configServiceImpl.ts:466-469`).
  - Bounds re-check (FR-6): keep every `minValue: 1` row at `configServiceImpl.ts:108,112,119,121-127`. Keep the
    `minValue: 0` rows at `:101,104,107,118,120`. Correct the comments at `:109-111` and `:113-117`.
  - FR-3 keys with no bounds row, so SetConfig accepts 0 for them: `eval_interval_seconds`,
    `max_strategies_per_cycle`, `alert_throttle_seconds`, `default_cooldown_days`, `shrinkage_days`,
    `max_duration_seconds`, `max_range_days`, `detail_retention_per_strategy`, `snapshot.*`, `fundsignal.*`,
    `indicators.sandbox.*`, `ingest.backfill.*` and `ingest.mcp_client.*`.
- Inter-service edges: existing only. config `WatchConfig` → the three Python watchers (gRPC 50060). No new edge.
- New env vars / ports: none.

## Risks / Not-found

- **Wire-level zero is unverified by test.**
  - `toProtoSnapPayload` emits 0 and `""` as explicit oneof members (`configServiceImpl.ts:49-52`).
  - Recon did not read the generated ts-proto encoder (codegen output; root CLAUDE.md rule).
  - No config test pins `int_val: 0`/`float_val: 0` through the encode.
  - The only indirect evidence is `get_bool` honouring an explicit `false` end-to-end (insights.md:3152).
  - FR-1 depends on this. `/sdd-spec` should add a round-trip assertion, or name the dev smoke as the proof.
- **Blanket switch vs 173's rationale.**
  - 173 rejected the blanket swap (insights.md:2903-2919; `173-fix-python-config-zero-trap/context.md:10`).
  - The operator decision of 2026-10-20 directs it. Design must record the trade-off (C-18).
  - The blast radius is every row in the classification table. A missed FR-3 site becomes a hang (`Semaphore(0)`),
    a busy loop (`sleep(0)`) or a dropped guardrail (`RLIMIT_DATA`/`RLIMIT_NPROC`).
- **`*_present` accessor fate.** After FR-1 they duplicate the plain getters.
  - Removal means repointing about 29 analysis reads.
  - It also means updating the mocks in `make_servicer` (`tests/test_analysis_servicer.py:49,53`) and
    `_make_cfg` (`tests/test_fundsignal_loop.py:24`), per fails.md:1395.
  - It also means rewording, never renumbering, the two 173 suites.
  - Keeping them leaves dead-weight duplicates (C-18 DRY). This is a design fork.
- **Clamp location vs testability.**
  - The servicer and loop tests mock the getters (`MagicMock`/fakes, e.g. `make_servicer`,
    `tests/test_pnl_pattern_consumer.py:147-152` `FakeCfg` with only `get_int`).
  - A clamp in a watcher property is provable only through a real-snapshot watcher.
  - A clamp at the call site is provable through the existing mocks via `side_effect`.
  - Indicators config doubles set `cfg.sandbox_timeout_ms` directly (`tests/test_formulas.py:398-401`, …),
    bypassing the property.
  - Design picks a location per site and, where an inline expression must become RED-provable, a named seam
    (insights.md:2918).
- **Indicators `servicer.py:303` is unclamped today.** After the switch, a stored `max_concurrent` 0 gives
  `RLIMIT_NPROC` 0 (`sandbox.py:346`) even though the semaphore at `:102` is clamped. The clamp must sit in
  `sandbox_max_concurrent()` or be repeated at `:303`.
- **Rollout: a stored 0/`''` takes effect on deploy.** Bounds are write-only (`configServiceImpl.ts:99`), so a row
  written while the trap hid it, or a direct DB row, takes effect on deploy. Recon has no DB access. The
  pre-deploy audit (Fix Scope) is the only check.
- **Seeded-row audit (FR-5), re-run 2026-10-20: holds.** Every seeded `0`/`''` row in the
  analysis/indicators/ingest namespaces equals its call-site default:
  - `008_analysis_fundsignal_keys.up.sql:22-23,34-35,43-44`: `explicit_symbols` `''`, `scoring_formula_id` `''`
    and `min_conviction_to_emit` `0.0`. All are zero-default reads, and the rows are namespace-relative (bare
    `fundsignal.*`).
  - `027_…:37,40` and `028_…:51,54`: `refresh_hour_utc` `0`, read via `get_int_present`.
  - Ingest seeds only `025_ingest_mcp_client_keys.up.sql:28-37` (300/30, equal to the defaults).
  - Indicators has no 0/`''` seed and no `indicators.sandbox.max_concurrent` row.
- **Stale in-source citations.** Ingest `watcher.py:185-186,208-209` cite `servicer.py:191`/`:519`; the real
  sites are `:323`/`:749`. They are rewritten in this feature.
- **Trap-pinning test.** `tests/test_analysis_servicer.py:594` (`assert w.get_float("k", 24.0) == 24.0  # contrast:
  the old zero-trap`), and its comment at `:587-588`, must be updated to the new semantics.
- **Unconfirmed interaction.** `block-fundamentals-strategy-on-etf` @AC-6 @FR-4 @feature-215 ("exactly one WARNING
  alert while SCHD stays unavailable"). Recon could not confirm whether that state-entry alert passes the
  `alert_throttle_seconds` check (`live_loop.py:815`). Design must confirm that throttle 0 keeps the
  once-per-state-entry guarantee.
- **C-16 blind spot.** The `xstockstrat-ui` and `xstockstrat-agent` suites (e.g.
  `xstockstrat-ui/acceptance/strategy-performance-dashboard.feature`) were not read. The pass-through consumer
  surfaces (`run_backtest`, `list_opportunities`, the alert stream) are unverified against them.
- **Overlaps (file-level; from context.md).**
  - 243 shares indicators `watcher.py:133-148`, `CLAUDE.md:100-103`, possibly `sandbox.py:282,345-346`, and
    migration 031.
  - 242 shares `live_loop.py` (same alert path as `:815`).
  - 245 shares `screener.py`.
  - 241 shares `configServiceImpl.ts`.
  - The slug collides with launched 173; one branch deletion has already happened (context.md, sdd-review
    product-spec session).
- **Doc and comment sites to update.**
  - analysis `servicer.py:789-790,1152-1153,2132-2133,2912-2913`, `live_loop.py:750-751`
  - `services/xstockstrat-analysis/docs/context-constitution.md:37`
  - `services/xstockstrat-config/docs/context-constitution.md:28` (CONFIG-11) and `:32`
  - ingest `CLAUDE.md:124,127,130-133`
  - `services/xstockstrat-ingest/docs/context-constitution.md:28` (INGEST-9, whose line cites will shift)
  - indicators `CLAUDE.md:100-103` (`:103` claims the accessor clamps, which is false for the `:303` consumer)
  - the analysis `CLAUDE.md` config rows and the docs listed in product-spec Fix Scope
  - the context-forge teardown applies
- **Not found**
  - A real-snapshot test of any analysis, indicators or ingest clamp site (semaphore, deadline, interval,
    timeout). All existing site tests mock the getters.
  - Any runtime caller of the analysis or ingest sandbox helpers. Only tests reference them.
  - Rows for 243 or 244 in `docs/roadmap/features/merge-order.md`, and no pre-assigned 031/032.
  - A `fix-python-config-zero-trap.feature` suite for analysis. Only ingest and indicators carry the 173 suites.
  - Any `real_pg` or integration test exercising the zero-trap.
  - An analysis reader for `analysis.opportunity.sparkline_bars`. It has a bounds row at
    `configServiceImpl.ts:126`, but a grep of `services/xstockstrat-analysis/app` finds no reader.
  - `SCALAR_BOUNDS_REGISTRY` rows for any `indicators.*` or `ingest.*` key.
  - A reading of `016_deprecate_analysis_signal_source_weights_desc.up.sql` or `005_ingest_backfill_chunking`
    (cited, not opened).
  - Any config-service code that treats `0`/`""` as unset.

## Recommended Scope

Advisory; the debate and `/sdd-spec` set the binding boundaries.

1. **Getters (FR-1/FR-2).** Apply the `HasField` body to `get_int`/`get_float`/`get_str` in the three watchers.
   Decide the fate of the `*_present` accessors. Add the AC-1/AC-4 real-snapshot getter tests and update the
   trap-pinning assertion at `test_analysis_servicer.py:594`.
2. **Ingest clamps (FR-3).**
   - Clamp in the watcher properties `:187,200,204,210` and in `mcp_client_loop.py:133-138,162-167`.
   - Rewrite the stale comments.
   - Tests: AC-5 (`svc._backfill_sem` with a real watcher at 0) and the AC-6 ingest rows.
3. **Indicators clamps (FR-3).** Clamp in the `sandbox_*` accessors so `servicer.py:303` is covered, without a
   third copy of the defaults. Tests: AC-6 (timeout, memory, max_concurrent and NPROC). Coordinate with 243.
4. **Analysis clamps (FR-3) + FR-4.**
   - Clamp per site with the `<= 0 → _DEFAULT_*` shape (`servicer.py:4545-4549`).
   - Resolve the "design" rows: `valid_days`, `indicator_bucket_count`, `max_live_*`, `valid_window_hours` and
     `snooze_default_hours`.
   - Tests: AC-2 (zero-cost backtest), AC-3 (conviction-only order, `test_opportunities_repo.py:152`), AC-9
     (throttle 0, `test_live_loop.py:271-275`), AC-6 analysis rows and AC-7 (`refresh_hour_utc` untouched).
   - Decide the dead sandbox helpers (analysis/ingest).
5. **Config (FR-6).**
   - Correct the comments at `configServiceImpl.ts:109-111,113-117`.
   - Add the `OPP_CONC` = 0 rejection case (AC-8) in `setConfigScalarBounds.test.ts`.
   - Optionally add a description-only corrective migration (032 or coordinated), with a `merge-order.md` row.
6. **Docs + teardown.** Cover the CLAUDE.md rows, context-constitution entries and config-governance lines from
   Fix Scope, then run the context-forge refresh.
7. **Consumer verification + rollout.**
   - Agent `run_backtest`/`list_opportunities`/`set_config` (`create_key=true`).
   - `/insights` backtest view and `/trader` alert stream checks.
   - Pre-deploy stored-0 audit on dev, then prod, with the result recorded in `context.md`.
