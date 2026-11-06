# Implementation Spec: fix-config-keys-drift

**Status**: `in-progress`
**Created**: 2026-11-05
**Feature**: `docs/roadmap/features/295-fix-config-keys-drift/feature.md`
**Total Steps**: 39
**Feature Branch**: `feature/fix-config-keys-drift`

---

## Execution Summary

This spec follows `design.md` (approved, decision 25) step outline A0–A12 and its binding round-5
amendments (S-1, S-2, M-1..M-9). The order is: tooling that observes first (inventory tool, gate),
then the operator inventory (G1) and the scope freeze (A2). Server write tolerance (A3) and change-feed
liveness (A4) come next, then the per-language watcher cores (A5a/b/c), the live primitives (A6/A7),
the agent and the FR-12 deadline (A8), and the UI environment fix (A9). The heal migration is written
last (A10), because it is immutable once on `main-dev` (F-01): it is dry-run on scratch Postgres and
operator-signed (G2) before its allowlist is emitted. Docs, skills and the runbook (A11) and the
staging verification (A12) close the feature.

**Test-first numbering (P-06, `fails.md` 2026-11-04 enforce-config-key-wiring).** Every code-bearing
pair is numbered **test step N → service step N+1**. The test step authors the RED assertions against
the pre-implementation tree; the service step turns them green. A prose "the test runs first" note
is not used anywhere in this spec.

**Spec-time resolutions of design open points (recorded, not silent):**

1. **Migration NNN — RENUMBERED 035/036 → 040/041.** `design.md` §1 said "re-check at spec time".
   The re-check found three live reservations above `origin/main-dev`'s `034`:
   - `035_smoke_rpc_user_id` / `036_smoke_writes_enabled` on open PR #1359
     (`origin/claude/smoke-test-deployment-0f1z5j`; `gh api repos/davcs86/xstockstrat/pulls/1359` →
     `state: open`);
   - `037_portfolio_signal_prune_interval`, already committed on `origin/feature/signal-watchlist-expiry-pruning`
     (feature 281);
   - `038_marketdata_asset_refresh_interval` / `039_portfolio_servability_timeout` in feature 282's spec
     (`origin/feature/filter-otc-symbols` `implementation-spec.md:221,483`).

   The operator set this reservation chain on 2026-11-02 (281 `context.md` § "re-spec: seed migration
   035 → 037": "280 keeps 035/036 … 282's seeds become 038/039"). So 295 takes
   **`040_config_markers`** (A4) and **`041_heal_config_keys_to_reader_catalog`** (A10). The design's
   ordering (marker below heal) is unchanged. Every design reference maps like this:
   - `035` → `040`, `036` → `041`;
   - `force 35` → `force 40`, `force 34` → `force 39`;
   - `config_heal_report_036` → `config_heal_report_041`, `premigration_036` → `premigration_041`;
   - `catalog_036`/`allow_036` → `catalog_041`/`allow_041`;
   - `system:config-migration-036` → `system:config-migration-041`;
   - `heal/dryrun-fresh.tsv` stays as named.

   **Consequence:** golang-migrate has no out-of-order guard, so 295's integration PR merges only after
   035–039 are on `main-dev`, or after the operator renumbers that chain. Step 9 and Step 33 each
   re-run a collision check, and Step 38 rewrites the `merge-order.md` rows. Feature 296's
   `-- contract-of:` anchor becomes `040_config_markers`, which Step 38 records in the 296 merge-order
   row. **This renumbering needs explicit operator confirmation before Step 9 executes** (see
   `## Step Dependencies`).
2. **Location of heal artifacts.** `design.md` names `heal/catalog.tsv`, `heal/signoff.md`,
   `heal/inventory-staging.jsonl`, `heal/dryrun-{staging,fresh}.tsv` and `heal/reveal-request.json`
   without a root. They live in **`scripts/config-heal/`**, next to the gate that reads them in CI.
   Two other locations were rejected:
   - the feature directory, because `/sdd-archiver` prunes it and the `--final` membership check
     reads `dryrun-fresh.tsv` permanently;
   - `services/xstockstrat-config/migrations/`, because `render-migrations.sh` and golang-migrate
     read that directory.
3. **UI fix shape.** `forward()` (`bffShared.ts:61-74`) passes `req` to the caller's lambda, so the
   "explicit handler" from `design.md` §8 is the existing lambda spreading
   `environment: nativeConfigEnvironment()` into the request. No new handler body is written.
4. **AC-28 wording.** AC-28 says `migrate force 35`. Under resolution 1 it means `force 40`. Step 32
   asserts the renumbered command. The AC text reword is an Open Thread for the next
   `/sdd-review product-spec` (C-15: the ID is stable, the step names the mapping).

### Scenario Coverage (C-15)

| AC | Step(s) | AC | Step(s) |
|---|---|---|---|
| AC-1 | 7 | AC-20 | 37 |
| AC-2 | 10 | AC-21 | 10 |
| AC-3 | 32 | AC-22 | 1 |
| AC-4 | 32 | AC-23 | 18 |
| AC-5 | 32 | AC-24 | 32 |
| AC-6 | 18 | AC-25 | 7 |
| AC-7 | 20 | AC-26 | 10 |
| AC-8 | 28 | AC-27 | 12 (portfolio), 14 (analysis), 16 (notify) |
| AC-9 | 30 | AC-28 | 32 |
| AC-10 | 12 (trading), 14 (indicators), 16 (ledger), 28 (agent) | AC-29 | 32 |
| AC-11 | 12, 14, 16 | AC-30 | 1 |
| AC-12 | 12 | AC-31 | 7 (bound), 28 (deadline) |
| AC-13 | 37 | AC-32 | 20 (rows 1–2), 24 (row 3) |
| AC-14 | 32 | AC-33 | 1 (inventory), 32 (heal) |
| AC-15 | 16 (read-key/coverage), 32 (dead row kept) | AC-34 | 7 |
| AC-16 | 20 | AC-35 | 7 |
| AC-17 | 22 | AC-36 | 1 |
| AC-18 | 28 | AC-37 | 28 |
| AC-19 | 3 (fixture legs), 36 (`--final` end state) | AC-38 | 26 |

### Consumer surfaces (C-14)

- `/config-ui`: Step 8 (writes land on the read row; FAILED_PRECONDITION names both spellings) and
  Step 33/36 (seeded keys appear, twins disappear). Config-ui reads ListKeys; it needs no code change
  (`NamespaceEditor.tsx` renders `k.key` `:66`).
- `/trader` (positions halt banner) and `/insights` (performance dashboard): Step 31.
- Agent MCP tools (`test_formula`, `ingest_signal`, `list_opportunities`, `extract_*`, OAuth
  registration): Step 29.
- Operators (inventory tool, runbook): Steps 2, 38.

## Config Key Contract (FR-15)

New or changed keys in this feature. The full per-key contract for **every** read key is generated
by Step 6 into `scripts/config-heal/catalog.tsv`. Step 6 also appends it here, below this table,
because this section is not a step body (F-09).

| Namespace | Key | value_type | Code default | Reader (`path:symbol`) | Seed | Live mechanism | Write bounds |
|---|---|---|---|---|---|---|---|
| `indicators` | `indicators.sandbox.startup_grace_ms` | int | 5000 | `services/xstockstrat-indicators/app/config/watcher.py` `sandbox_startup_grace_ms` (new, Step 27; replaces `SANDBOX_STARTUP_GRACE_MS` `app/services/sandbox.py:205`) | `041` | read per `ExecuteFormula` call | [1000, 10000] |
| `indicators` | `indicators.sandbox.timeout_ms` (existing) | int | 5000 | `watcher.py:137` `sandbox_timeout_ms` | `031` (existing) | read per call (`servicer.py:282`) | [100, 33000] (new) |
| `analysis` | `analysis.compute.max_worker_threads` (existing) | int | 4 | `services/xstockstrat-analysis/app/handlers/servicer.py:571` → `ComputePool` limit (Step 19) | `041` | `ResizableLimiter` via `OnChange` | [1, 16] (new) |

### Generated per-key contract (Step 6, frozen 2026-11-06)

Rendered from `scripts/config-heal/catalog.tsv` (195 rows); each description lives only in the TSV.

| Namespace | Key | Match | value_type | Code default | Consuming service | Secret | Reader (`path:symbol`) |
|---|---|---|---|---|---|---|---|
| `agent` | `extract.connect_timeout_seconds` | exact | float | `10` | xstockstrat-agent | false | `services/xstockstrat-agent/app/tools.py:_fetch_url` |
| `agent` | `extract.max_bytes` | exact | int | `5000000` | xstockstrat-agent | false | `services/xstockstrat-agent/app/tools.py:_fetch_url` |
| `agent` | `extract.max_redirects` | exact | int | `5` | xstockstrat-agent | false | `services/xstockstrat-agent/app/tools.py:_fetch_url` |
| `agent` | `extract.read_timeout_seconds` | exact | float | `30` | xstockstrat-agent | false | `services/xstockstrat-agent/app/tools.py:_fetch_url` |
| `agent` | `oauth.allowed_redirect_uris` | exact | string | — | xstockstrat-agent | false | `services/xstockstrat-agent/app/oauth_server.py:register` |
| `agent` | `oauth.registration_enabled` | exact | bool | `true` | xstockstrat-agent | false | `services/xstockstrat-agent/app/oauth_server.py:register` |
| `agent` | `opportunities.read_timeout_seconds` | exact | float | `40` | xstockstrat-agent | false | `services/xstockstrat-agent/app/tools.py:list_opportunities` |
| `agent` | `signal.alert_threshold` | exact | float | `0.6` | xstockstrat-agent | false | `services/xstockstrat-agent/app/tools.py:ingest_signal` |
| `analysis` | `analysis.backtest.default_commission_pct` | exact | float | `0.001` | xstockstrat-analysis | false | `services/xstockstrat-analysis/app/handlers/servicer.py:_run_backtest` |
| `analysis` | `analysis.backtest.default_fill_model` | exact | int | `0` | xstockstrat-analysis | false | `services/xstockstrat-analysis/app/handlers/servicer.py:_run_backtest` |
| `analysis` | `analysis.backtest.default_slippage_pct` | exact | float | `0.0005` | xstockstrat-analysis | false | `services/xstockstrat-analysis/app/handlers/servicer.py:_run_backtest` |
| `analysis` | `analysis.backtest.detail_retention_per_strategy` | exact | int | `20` | xstockstrat-analysis | false | `services/xstockstrat-analysis/app/handlers/servicer.py:_persist_backtest_detail` |
| `analysis` | `analysis.backtest.fundamentals.enabled` | exact | bool | `false` | xstockstrat-analysis | false | `services/xstockstrat-analysis/app/engine/live_loop.py:_load_fundamentals`; `services/xstockstrat-analysis/app/engine/live_loop.py:_load_fundamentals_snapshot`; `services/xstockstrat-analysis/app/engine/live_loop.py:_eval_pair`; `services/xstockstrat-analysis/app/handlers/servicer.py:_load_fundamentals`; `services/xstockstrat-analysis/app/handlers/servicer.py:_load_fundamentals_snapshot`; `services/xstockstrat-analysis/app/handlers/servicer.py:_backtest_symbol_evaluated`; `services/xstockstrat-analysis/app/handlers/servicer.py:_exclude_refused_cells`; `services/xstockstrat-analysis/app/handlers/servicer.py:_fetch_and_aggregate`; `services/xstockstrat-analysis/app/handlers/servicer.py:_strategy_row`; `services/xstockstrat-analysis/app/handlers/servicer.py:_sel` |
| `analysis` | `analysis.backtest.max_duration_seconds` | exact | int | `300` | xstockstrat-analysis | false | `services/xstockstrat-analysis/app/handlers/servicer.py:RunBacktest` |
| `analysis` | `analysis.backtest.max_range_days` | exact | int | `730` | xstockstrat-analysis | false | `services/xstockstrat-analysis/app/handlers/servicer.py:_run_backtest` |
| `analysis` | `analysis.backtest.portfolio_max_concurrent` | exact | int | `9` | xstockstrat-analysis | false | `services/xstockstrat-analysis/app/handlers/servicer.py:_run_backtest` |
| `analysis` | `analysis.backtest.portfolio_position_weight` | exact | float | `0.1` | xstockstrat-analysis | false | `services/xstockstrat-analysis/app/handlers/servicer.py:_run_backtest` |
| `analysis` | `analysis.compute.max_worker_threads` | exact | int | `4` | xstockstrat-analysis | false | `services/xstockstrat-analysis/app/handlers/servicer.py:__init__` |
| `analysis` | `analysis.engine.alert_throttle_seconds` | exact | int | `300` | xstockstrat-analysis | false | `services/xstockstrat-analysis/app/engine/live_loop.py:_run_cycle` |
| `analysis` | `analysis.engine.eval_interval_seconds` | exact | int | `60` | xstockstrat-analysis | false | `services/xstockstrat-analysis/app/engine/live_loop.py:run_forever` |
| `analysis` | `analysis.engine.fundamentals_blend_enabled` | exact | bool | `true` | xstockstrat-analysis | false | `services/xstockstrat-analysis/app/engine/entry_backfill.py:_backfill_pair`; `services/xstockstrat-analysis/app/engine/live_loop.py:_run_cycle`; `services/xstockstrat-analysis/app/handlers/servicer.py:_compute_opportunities` |
| `analysis` | `analysis.engine.fundamentals_blend_strategy_id` | exact | string | `fundamentals_macd_blend` | xstockstrat-analysis | false | `services/xstockstrat-analysis/app/handlers/servicer.py:blend_strategy_id` |
| `analysis` | `analysis.engine.max_strategies_per_cycle` | exact | int | `50` | xstockstrat-analysis | false | `services/xstockstrat-analysis/app/engine/live_loop.py:_run_cycle` |
| `analysis` | `analysis.fundsignal.buy_quantile` | exact | float | `0.8` | xstockstrat-analysis | false | `services/xstockstrat-analysis/app/engine/fundsignal_loop.py:run_once` |
| `analysis` | `analysis.fundsignal.daily_call_budget` | exact | int | `200` | xstockstrat-analysis | false | `services/xstockstrat-analysis/app/engine/fundsignal_loop.py:run_once` |
| `analysis` | `analysis.fundsignal.enabled` | exact | bool | `false` | xstockstrat-analysis | false | `services/xstockstrat-analysis/app/engine/fundsignal_loop.py:_tick` |
| `analysis` | `analysis.fundsignal.explicit_symbols` | exact | string | — | xstockstrat-analysis | false | `services/xstockstrat-analysis/app/engine/fundsignal_loop.py:_resolve_universe` |
| `analysis` | `analysis.fundsignal.max_symbols_per_run` | exact | int | `200` | xstockstrat-analysis | false | `services/xstockstrat-analysis/app/engine/fundsignal_loop.py:run_once` |
| `analysis` | `analysis.fundsignal.min_conviction_to_emit` | exact | float | `0` | xstockstrat-analysis | false | `services/xstockstrat-analysis/app/engine/fundsignal_loop.py:run_once` |
| `analysis` | `analysis.fundsignal.retry_seconds` | exact | int | `300` | xstockstrat-analysis | false | `services/xstockstrat-analysis/app/engine/fundsignal_loop.py:_tick` |
| `analysis` | `analysis.fundsignal.run_interval_hours` | exact | int | `24` | xstockstrat-analysis | false | `services/xstockstrat-analysis/app/engine/fundsignal_loop.py:_tick` |
| `analysis` | `analysis.fundsignal.scoring_formula_id` | exact | string | — | xstockstrat-analysis | false | `services/xstockstrat-analysis/app/engine/fundsignal_loop.py:run_once`; `services/xstockstrat-analysis/app/engine/fundsignal_loop.py:_score` |
| `analysis` | `analysis.fundsignal.sell_quantile` | exact | float | `0.2` | xstockstrat-analysis | false | `services/xstockstrat-analysis/app/engine/fundsignal_loop.py:run_once` |
| `analysis` | `analysis.fundsignal.source_slug` | exact | string | `fundamentals` | xstockstrat-analysis | false | `services/xstockstrat-analysis/app/engine/fundsignal_loop.py:fundsignal_source_slug` |
| `analysis` | `analysis.fundsignal.startup_jitter_seconds` | exact | int | `30` | xstockstrat-analysis | false | `services/xstockstrat-analysis/app/engine/fundsignal_loop.py:run_forever` |
| `analysis` | `analysis.fundsignal.universe_source` | exact | string | `watchlists` | xstockstrat-analysis | false | `services/xstockstrat-analysis/app/engine/fundsignal_loop.py:_resolve_universe` |
| `analysis` | `analysis.fundsignal.valid_days` | exact | int | `90` | xstockstrat-analysis | false | `services/xstockstrat-analysis/app/engine/fundsignal_loop.py:run_once` |
| `analysis` | `analysis.opportunity.empty_recompute_ttl_seconds` | exact | int | `30` | xstockstrat-analysis | false | `services/xstockstrat-analysis/app/handlers/servicer.py:_replace_and_stamp_compute_state` |
| `analysis` | `analysis.opportunity.live_enrich_timeout_ms` | exact | int | `3000` | xstockstrat-analysis | false | `services/xstockstrat-analysis/app/handlers/servicer.py:_enrich_opportunities_live` |
| `analysis` | `analysis.opportunity.live_enrich_ttl_seconds` | exact | int | `20` | xstockstrat-analysis | false | `services/xstockstrat-analysis/app/handlers/servicer.py:_enrich_opportunities_live` |
| `analysis` | `analysis.opportunity.max_concurrent_bars_fetches` | exact | int | `2` | xstockstrat-analysis | false | `services/xstockstrat-analysis/app/handlers/servicer.py:__init__` |
| `analysis` | `analysis.opportunity.max_concurrent_candidates` | exact | int | `4` | xstockstrat-analysis | false | `services/xstockstrat-analysis/app/handlers/servicer.py:__init__` |
| `analysis` | `analysis.opportunity.max_live_held_symbols_per_compute` | exact | int | `20` | xstockstrat-analysis | false | `services/xstockstrat-analysis/app/handlers/servicer.py:_add_provenance` |
| `analysis` | `analysis.opportunity.max_live_only_symbols_per_compute` | exact | int | `20` | xstockstrat-analysis | false | `services/xstockstrat-analysis/app/handlers/servicer.py:_new_live_strats` |
| `analysis` | `analysis.opportunity.max_live_strategies_per_symbol` | exact | int | `5` | xstockstrat-analysis | false | `services/xstockstrat-analysis/app/handlers/servicer.py:_compute_opportunities` |
| `analysis` | `analysis.opportunity.max_universe_size` | exact | int | `100` | xstockstrat-analysis | false | `services/xstockstrat-analysis/app/handlers/servicer.py:_new_live_strats` |
| `analysis` | `analysis.opportunity.read_db_budget_ms` | exact | int | `20000` | xstockstrat-analysis | false | `services/xstockstrat-analysis/app/handlers/servicer.py:ListOpportunities` |
| `analysis` | `analysis.opportunity.refresh_hour_utc` | exact | int | `0` | xstockstrat-analysis | false | `services/xstockstrat-analysis/app/handlers/servicer.py:_opportunity_refresh_hour` |
| `analysis` | `analysis.opportunity.retry_seconds` | exact | int | `300` | xstockstrat-analysis | false | `services/xstockstrat-analysis/app/handlers/servicer.py:_opportunity_refresh_tick`; `services/xstockstrat-analysis/app/handlers/servicer.py:_readiness_materializer_tick` |
| `analysis` | `analysis.opportunity.signal_rank_weight` | exact | float | `0.3` | xstockstrat-analysis | false | `services/xstockstrat-analysis/app/handlers/servicer.py:_read_opportunity_queue`; `services/xstockstrat-analysis/app/handlers/servicer.py:_retry_unavailable_symbols` |
| `analysis` | `analysis.opportunity.snooze_default_hours` | exact | int | `24` | xstockstrat-analysis | false | `services/xstockstrat-analysis/app/handlers/servicer.py:SetOpportunityAction` |
| `analysis` | `analysis.opportunity.startup_jitter_seconds` | exact | int | `30` | xstockstrat-analysis | false | `services/xstockstrat-analysis/app/handlers/servicer.py:run_opportunity_refresh_forever`; `services/xstockstrat-analysis/app/handlers/servicer.py:run_readiness_materializer_forever` |
| `analysis` | `analysis.opportunity.valid_window_hours` | exact | int | `24` | xstockstrat-analysis | false | `services/xstockstrat-analysis/app/handlers/servicer.py:_retry_unavailable_symbols`; `services/xstockstrat-analysis/app/handlers/servicer.py:_sel` |
| `analysis` | `analysis.patterns.indicator_bucket_count` | exact | int | `5` | xstockstrat-analysis | false | `services/xstockstrat-analysis/app/handlers/servicer.py:QueryPnLPatterns` |
| `analysis` | `analysis.patterns.min_sample_count` | exact | int | `5` | xstockstrat-analysis | false | `services/xstockstrat-analysis/app/handlers/servicer.py:QueryPnLPatterns` |
| `analysis` | `analysis.readiness.stale_after_seconds` | exact | int | `30` | xstockstrat-analysis | false | `services/xstockstrat-analysis/app/handlers/servicer.py:EvaluateReadiness` |
| `analysis` | `analysis.readiness_materializer.enabled` | exact | bool | `false` | xstockstrat-analysis | false | `services/xstockstrat-analysis/app/handlers/servicer.py:_readiness_materializer_tick` |
| `analysis` | `analysis.readiness_materializer.max_concurrent_bars_fetches` | exact | int | `2` | xstockstrat-analysis | false | `services/xstockstrat-analysis/app/handlers/servicer.py:__init__` |
| `analysis` | `analysis.readiness_materializer.refresh_hour_utc` | exact | int | `0` | xstockstrat-analysis | false | `services/xstockstrat-analysis/app/handlers/servicer.py:_readiness_materializer_hour` |
| `analysis` | `analysis.readiness_materializer.valid_window_hours` | exact | int | `24` | xstockstrat-analysis | false | `services/xstockstrat-analysis/app/handlers/servicer.py:_run`; `services/xstockstrat-analysis/app/handlers/servicer.py:_materialize_readiness_for_owner` |
| `analysis` | `analysis.scoring.composite_shrinkage_k` | exact | float | `1` | xstockstrat-analysis | false | `services/xstockstrat-analysis/app/handlers/servicer.py:_retry_unavailable_symbols`; `services/xstockstrat-analysis/app/handlers/servicer.py:_compute_opportunities` |
| `analysis` | `analysis.scoring.composite_weight_readiness` | exact | float | `1` | xstockstrat-analysis | false | `services/xstockstrat-analysis/app/handlers/servicer.py:_retry_unavailable_symbols`; `services/xstockstrat-analysis/app/handlers/servicer.py:_compute_opportunities` |
| `analysis` | `analysis.scoring.composite_weight_signal` | exact | float | `1` | xstockstrat-analysis | false | `services/xstockstrat-analysis/app/handlers/servicer.py:_retry_unavailable_symbols`; `services/xstockstrat-analysis/app/handlers/servicer.py:_compute_opportunities` |
| `analysis` | `analysis.scoring.drawdown_weight` | exact | float | `0.3` | xstockstrat-analysis | false | `services/xstockstrat-analysis/app/handlers/servicer.py:_run_backtest`; `services/xstockstrat-analysis/app/handlers/servicer.py:_derive_score_from_cells` |
| `analysis` | `analysis.scoring.min_evidence_days` | exact | int | `500` | xstockstrat-analysis | false | `services/xstockstrat-analysis/app/handlers/servicer.py:_derive_score_from_cells` |
| `analysis` | `analysis.scoring.min_evidence_symbols` | exact | int | `3` | xstockstrat-analysis | false | `services/xstockstrat-analysis/app/handlers/servicer.py:_derive_score_from_cells` |
| `analysis` | `analysis.scoring.sharpe_weight` | exact | float | `0.4` | xstockstrat-analysis | false | `services/xstockstrat-analysis/app/handlers/servicer.py:_run_backtest`; `services/xstockstrat-analysis/app/handlers/servicer.py:_derive_score_from_cells` |
| `analysis` | `analysis.scoring.shrinkage_days` | exact | int | `250` | xstockstrat-analysis | false | `services/xstockstrat-analysis/app/handlers/servicer.py:_derive_score_from_cells` |
| `analysis` | `analysis.scoring.signal_decay_half_life_hours` | exact | float | `24` | xstockstrat-analysis | false | `services/xstockstrat-analysis/app/handlers/servicer.py:_retry_unavailable_symbols`; `services/xstockstrat-analysis/app/handlers/servicer.py:_compute_opportunities` |
| `analysis` | `analysis.scoring.strategy_weight_floor` | exact | float | `0.5` | xstockstrat-analysis | false | `services/xstockstrat-analysis/app/handlers/servicer.py:_strategy_row`; `services/xstockstrat-analysis/app/handlers/servicer.py:_compute_opportunities` |
| `analysis` | `analysis.scoring.symbol_score_decay` | exact | float | `0.5` | xstockstrat-analysis | false | `services/xstockstrat-analysis/app/handlers/servicer.py:_strategy_row`; `services/xstockstrat-analysis/app/handlers/servicer.py:_compute_opportunities` |
| `analysis` | `analysis.scoring.win_rate_weight` | exact | float | `0.3` | xstockstrat-analysis | false | `services/xstockstrat-analysis/app/handlers/servicer.py:_run_backtest`; `services/xstockstrat-analysis/app/handlers/servicer.py:_derive_score_from_cells` |
| `analysis` | `analysis.screener.default_rank_limit` | exact | int | `50` | xstockstrat-analysis | false | `services/xstockstrat-analysis/app/services/screener.py:_rank` |
| `analysis` | `analysis.screener.max_concurrent_formula_evals` | exact | int | `4` | xstockstrat-analysis | false | `services/xstockstrat-analysis/app/services/screener.py:__init__` |
| `analysis` | `analysis.screener.max_duration_seconds` | exact | int | `120` | xstockstrat-analysis | false | `services/xstockstrat-analysis/app/handlers/servicer.py:ScreenSymbols` |
| `analysis` | `analysis.screener.max_universe_size` | exact | int | `100` | xstockstrat-analysis | false | `services/xstockstrat-analysis/app/services/screener.py:screen` |
| `analysis` | `analysis.series.max_concurrent_components` | exact | int | `4` | xstockstrat-analysis | false | `services/xstockstrat-analysis/app/handlers/servicer.py:__init__` |
| `analysis` | `analysis.snapshot.indicator_timeout_ms` | exact | int | `500` | xstockstrat-analysis | false | `services/xstockstrat-analysis/app/engine/pnl_pattern_consumer.py:_compose` |
| `analysis` | `analysis.snapshot.signal_timeout_ms` | exact | int | `500` | xstockstrat-analysis | false | `services/xstockstrat-analysis/app/engine/pnl_pattern_consumer.py:_compose` |
| `analysis` | `analysis.strategy.default_cooldown_days` | exact | int | `31` | xstockstrat-analysis | false | `services/xstockstrat-analysis/app/handlers/servicer.py:default_cooldown_days` |
| `analysis` | `analysis.strategy.default_exit_cooldown_days` | exact | int | `0` | xstockstrat-analysis | false | `services/xstockstrat-analysis/app/engine/live_loop.py:_eval_pair`; `services/xstockstrat-analysis/app/handlers/servicer.py:_run_backtest`; `services/xstockstrat-analysis/app/handlers/servicer.py:_core` |
| `analysis` | `analysis.strategy.max_concurrent_entry_backfill` | exact | int | `4` | xstockstrat-analysis | false | `services/xstockstrat-analysis/app/engine/entry_backfill.py:run_once` |
| `identity` | `identity.jwt.access_ttl_seconds` | exact | int | `900` | xstockstrat-identity | false | `services/xstockstrat-identity/src/grpc/identityServiceImpl.ts:accessTtlSeconds` |
| `identity` | `identity.jwt.refresh_ttl_seconds` | exact | int | `2592000` | xstockstrat-identity | false | `services/xstockstrat-identity/src/grpc/identityServiceImpl.ts:refreshTtlSeconds` |
| `indicators` | `indicators.sandbox.allowed_imports` | exact | string | `numpy,pandas,math,statistics` | xstockstrat-indicators | false | `services/xstockstrat-indicators/app/config/watcher.py:sandbox_allowed_imports` |
| `indicators` | `indicators.sandbox.max_concurrent` | exact | int | `4` | xstockstrat-indicators | false | `services/xstockstrat-indicators/app/config/watcher.py:sandbox_max_concurrent` |
| `indicators` | `indicators.sandbox.memory_bytes` | exact | int | `134217728` | xstockstrat-indicators | false | `services/xstockstrat-indicators/app/config/watcher.py:sandbox_memory_bytes` |
| `indicators` | `indicators.sandbox.startup_grace_ms` | exact | int | `5000` | xstockstrat-indicators | false | `services/xstockstrat-indicators/app/config/watcher.py:sandbox_startup_grace_ms` |
| `indicators` | `indicators.sandbox.timeout_ms` | exact | int | `5000` | xstockstrat-indicators | false | `services/xstockstrat-indicators/app/config/watcher.py:sandbox_timeout_ms` |
| `ingest` | `ingest.backfill.chunk_max_bars` | exact | int | `200000` | xstockstrat-ingest | false | `services/xstockstrat-ingest/app/config/watcher.py:backfill_chunk_max_bars` |
| `ingest` | `ingest.backfill.chunk_window_days` | exact | int | `90` | xstockstrat-ingest | false | `services/xstockstrat-ingest/app/config/watcher.py:backfill_chunk_window_days` |
| `ingest` | `ingest.backfill.max_concurrent_chunks` | exact | int | `3` | xstockstrat-ingest | false | `services/xstockstrat-ingest/app/config/watcher.py:backfill_max_concurrent_chunks` |
| `ingest` | `ingest.backfill.max_concurrent_jobs` | exact | int | `3` | xstockstrat-ingest | false | `services/xstockstrat-ingest/app/config/watcher.py:backfill_max_concurrent_jobs` |
| `ingest` | `ingest.backfill.max_retry_attempts` | exact | int | `3` | xstockstrat-ingest | false | `services/xstockstrat-ingest/app/config/watcher.py:backfill_max_retry_attempts` |
| `ingest` | `ingest.backfill.retry_on_failure` | exact | bool | `true` | xstockstrat-ingest | false | `services/xstockstrat-ingest/app/config/watcher.py:backfill_retry_on_failure` |
| `ingest` | `ingest.mcp_client.poll_interval_seconds` | exact | int | `300` | xstockstrat-ingest | false | `services/xstockstrat-ingest/app/engine/mcp_client_loop.py:run_mcp_client_loop` |
| `ingest` | `ingest.mcp_client.request_timeout_seconds` | exact | int | `30` | xstockstrat-ingest | false | `services/xstockstrat-ingest/app/engine/mcp_client_loop.py:run_one_cycle` |
| `ingest` | `ingest.signals.dedup_window_hours` | exact | int | `24` | xstockstrat-ingest | false | `services/xstockstrat-ingest/app/config/watcher.py:dedup_window_hours` |
| `ingest` | `mcp_credential.` | prefix | string | — | xstockstrat-ingest | true | `services/xstockstrat-ingest/app/engine/mcp_client_loop.py:poll_one_source` |
| `ledger` | `ledger.export.enabled` | exact | bool | `true` | xstockstrat-ledger | false | `services/xstockstrat-ledger/src/grpc/ledgerServiceImpl.ts:exportEvents` |
| `ledger` | `ledger.export.max_window_days` | exact | int | `365` | xstockstrat-ledger | false | `services/xstockstrat-ledger/src/grpc/ledgerServiceImpl.ts:exportEvents` |
| `ledger` | `ledger.stream.resolve_timeout_ms` | exact | int | `2000` | xstockstrat-ledger | false | `services/xstockstrat-ledger/src/services/eventRowResolver.ts:streamResolveTimeoutMs` |
| `marketdata` | `alpaca.api_key` | exact | string | — | xstockstrat-marketdata | true | `services/xstockstrat-marketdata/cmd/server/main.go:main` |
| `marketdata` | `alpaca.api_secret` | exact | string | — | xstockstrat-marketdata | true | `services/xstockstrat-marketdata/cmd/server/main.go:main` |
| `marketdata` | `finnhub.api_key` | exact | string | — | xstockstrat-marketdata | true | `services/xstockstrat-marketdata/cmd/server/main.go:main` |
| `marketdata` | `fmp.api_key` | exact | string | — | xstockstrat-marketdata | true | `services/xstockstrat-marketdata/cmd/server/main.go:main` |
| `marketdata` | `marketdata.alpaca.adjustment` | exact | string | `all` | xstockstrat-marketdata | false | `services/xstockstrat-marketdata/cmd/server/main.go:main` |
| `marketdata` | `marketdata.alpaca.feed` | exact | string | `iex` | xstockstrat-marketdata | false | `services/xstockstrat-marketdata/cmd/server/main.go:main` |
| `marketdata` | `marketdata.assets.refresh_interval_hours` | exact | int | `6` | xstockstrat-marketdata | false | `services/xstockstrat-marketdata/internal/service/asset_servability.go:resolveAssetRefreshInterval` |
| `marketdata` | `marketdata.backfill.batch_size` | exact | int | `1000` | xstockstrat-marketdata | false | `services/xstockstrat-marketdata/cmd/server/main.go:main` |
| `marketdata` | `marketdata.backfill.max_delete_days` | exact | int | `0` | xstockstrat-marketdata | false | `services/xstockstrat-marketdata/internal/service/marketdata_service.go:DeleteBackfilledData` |
| `marketdata` | `marketdata.backfill.rate_limit_rps` | exact | int | `200` | xstockstrat-marketdata | false | `services/xstockstrat-marketdata/cmd/server/main.go:main` |
| `marketdata` | `marketdata.classification.enabled` | exact | bool | `false` | xstockstrat-marketdata | false | `services/xstockstrat-marketdata/internal/service/classification_service.go:StartClassificationRefreshPoller` |
| `marketdata` | `marketdata.classification.refresh_interval_hours` | exact | int | `24` | xstockstrat-marketdata | false | `services/xstockstrat-marketdata/internal/service/classification_service.go:StartClassificationRefreshPoller` |
| `marketdata` | `marketdata.dividends.backfill_lookback_years` | exact | int | `2` | xstockstrat-marketdata | false | `services/xstockstrat-marketdata/internal/service/marketdata_service.go:backfillOneSymbol` |
| `marketdata` | `marketdata.dividends.enabled` | exact | bool | `false` | xstockstrat-marketdata | false | `services/xstockstrat-marketdata/internal/service/marketdata_service.go:backfillOneSymbol` |
| `marketdata` | `marketdata.edgar.base_url` | exact | string | `https://data.sec.gov` | xstockstrat-marketdata | false | `services/xstockstrat-marketdata/cmd/server/main.go:main` |
| `marketdata` | `marketdata.edgar.cache_ttl_hours` | exact | int | `24` | xstockstrat-marketdata | false | `services/xstockstrat-marketdata/internal/service/marketdata_service.go:edgarResolve` |
| `marketdata` | `marketdata.edgar.enabled` | exact | bool | `true` | xstockstrat-marketdata | false | `services/xstockstrat-marketdata/internal/service/marketdata_service.go:edgarResolve` |
| `marketdata` | `marketdata.edgar.rate_limit_rps` | exact | int | `10` | xstockstrat-marketdata | false | `services/xstockstrat-marketdata/cmd/server/main.go:main` |
| `marketdata` | `marketdata.edgar.user_agent` | exact | string | `xstockstrat/1.0 (ops@xstockstrat.local)` | xstockstrat-marketdata | false | `services/xstockstrat-marketdata/cmd/server/main.go:main` |
| `marketdata` | `marketdata.finnhub.base_url` | exact | string | `https://api.finnhub.io/api/v1` | xstockstrat-marketdata | false | `services/xstockstrat-marketdata/cmd/server/main.go:newFundamentalsSource` |
| `marketdata` | `marketdata.finnhub.cache_ttl_hours` | exact | int | `24` | xstockstrat-marketdata | false | `services/xstockstrat-marketdata/internal/service/marketdata_service.go:GetFundamentalsMulti`; `services/xstockstrat-marketdata/internal/service/marketdata_service.go:resolveFundamentals` |
| `marketdata` | `marketdata.finnhub.enabled` | exact | bool | `false` | xstockstrat-marketdata | false | `services/xstockstrat-marketdata/internal/service/marketdata_service.go:fundamentalsEnabled` |
| `marketdata` | `marketdata.finnhub.rate_window_seconds` | exact | int | `60` | xstockstrat-marketdata | false | `services/xstockstrat-marketdata/internal/service/marketdata_service.go:fundamentalsQuota` |
| `marketdata` | `marketdata.finnhub.symbols_per_minute` | exact | int | `20` | xstockstrat-marketdata | false | `services/xstockstrat-marketdata/internal/service/marketdata_service.go:fundamentalsQuota` |
| `marketdata` | `marketdata.fmp.base_url` | exact | string | `https://financialmodelingprep.com` | xstockstrat-marketdata | false | `services/xstockstrat-marketdata/cmd/server/main.go:newFMPClient` |
| `marketdata` | `marketdata.fmp.cache_ttl_hours` | exact | int | `24` | xstockstrat-marketdata | false | `services/xstockstrat-marketdata/internal/service/marketdata_service.go:GetFundamentalsMulti`; `services/xstockstrat-marketdata/internal/service/marketdata_service.go:resolveFundamentals` |
| `marketdata` | `marketdata.fmp.daily_request_cap` | exact | int | `250` | xstockstrat-marketdata | false | `services/xstockstrat-marketdata/cmd/server/main.go:newFMPClient`; `services/xstockstrat-marketdata/internal/service/marketdata_service.go:fundamentalsQuota` |
| `marketdata` | `marketdata.fmp.enabled` | exact | bool | `false` | xstockstrat-marketdata | false | `services/xstockstrat-marketdata/internal/service/etf_flags.go:etfFillGate`; `services/xstockstrat-marketdata/internal/service/marketdata_service.go:fundamentalsEnabled` |
| `marketdata` | `marketdata.fmp.metrics` | exact | string | `core,extended` | xstockstrat-marketdata | false | `services/xstockstrat-marketdata/cmd/server/main.go:newFMPClient` |
| `marketdata` | `marketdata.fmp.rate_limit_rps` | exact | int | `5` | xstockstrat-marketdata | false | `services/xstockstrat-marketdata/cmd/server/main.go:newFMPClient` |
| `marketdata` | `marketdata.fundamentals.history.backfill.max_lookback_years` | exact | int | `10` | xstockstrat-marketdata | false | `services/xstockstrat-marketdata/internal/service/marketdata_service.go:BackfillFundamentals` |
| `marketdata` | `marketdata.fundamentals.history.backfill.period_types` | exact | string | `both` | xstockstrat-marketdata | false | `services/xstockstrat-marketdata/internal/service/marketdata_service.go:BackfillFundamentals` |
| `marketdata` | `marketdata.fundamentals.history.enabled` | exact | bool | `false` | xstockstrat-marketdata | false | `services/xstockstrat-marketdata/internal/service/marketdata_service.go:BackfillFundamentals` |
| `marketdata` | `marketdata.fundamentals.history.ratio_enrichment.enabled` | exact | bool | `false` | xstockstrat-marketdata | false | `services/xstockstrat-marketdata/internal/service/marketdata_service.go:BackfillFundamentals` |
| `marketdata` | `marketdata.fundamentals.provider` | exact | string | `finnhub` | xstockstrat-marketdata | false | `services/xstockstrat-analysis/app/engine/fundsignal_loop.py:__init__`; `services/xstockstrat-marketdata/cmd/server/main.go:main` |
| `marketdata` | `marketdata.fundamentals.snapshot_source` | exact | string | `vendor` | xstockstrat-marketdata | false | `services/xstockstrat-marketdata/internal/service/marketdata_service.go:snapshotSource` |
| `marketdata` | `marketdata.price.batch_timeout_ms` | exact | int | `2500` | xstockstrat-marketdata | false | `services/xstockstrat-marketdata/internal/service/marketdata_service.go:resolveBatchPriceBudget` |
| `marketdata` | `marketdata.quotes.batch_timeout_ms` | exact | int | `2500` | xstockstrat-marketdata | false | `services/xstockstrat-marketdata/internal/service/marketdata_service.go:resolveQuoteBatchBudget` |
| `marketdata` | `marketdata.quotes.latest_lookback_hours` | exact | int | `168` | xstockstrat-marketdata | false | `services/xstockstrat-marketdata/internal/service/marketdata_service.go:resolveQuoteLookback` |
| `marketdata` | `marketdata.quotes.mark_close_max_age_hours` | exact | int | `168` | xstockstrat-marketdata | false | `services/xstockstrat-marketdata/internal/service/marketdata_service.go:resolveMarkCloseMaxAge` |
| `marketdata` | `marketdata.quotes.mark_timeout_ms` | exact | int | `500` | xstockstrat-marketdata | false | `services/xstockstrat-marketdata/internal/service/marketdata_service.go:resolveQuoteMarkBudget` |
| `marketdata` | `marketdata.retention.quotes_days` | exact | int | `90` | xstockstrat-marketdata | false | `services/xstockstrat-marketdata/internal/service/marketdata_service.go:resolveQuoteRetentionDays` |
| `marketdata` | `marketdata.stream.bar_ingest_interval_ms` | exact | int | `300000` | xstockstrat-marketdata | false | `services/xstockstrat-marketdata/internal/service/marketdata_service.go:StartBarIngestPoller` |
| `marketdata` | `marketdata.stream.bar_ingest_lookback_ms` | exact | int | `900000` | xstockstrat-marketdata | false | `services/xstockstrat-marketdata/internal/service/marketdata_service.go:ingestRecentBars` |
| `marketdata` | `marketdata.stream.bar_ingest_timeframe` | exact | string | `1d` | xstockstrat-marketdata | false | `services/xstockstrat-marketdata/internal/service/marketdata_service.go:ingestRecentBars` |
| `marketdata` | `marketdata.stream.max_reconnects` | exact | int | `10` | xstockstrat-marketdata | false | `services/xstockstrat-marketdata/cmd/server/main.go:main` |
| `marketdata` | `marketdata.stream.reconnect_delay_ms` | exact | int | `2000` | xstockstrat-marketdata | false | `services/xstockstrat-marketdata/cmd/server/main.go:main` |
| `marketdata` | `marketdata.stream.warm_interval_ms` | exact | int | `30000` | xstockstrat-marketdata | false | `services/xstockstrat-marketdata/internal/service/marketdata_service.go:StartWarmQuotePoller` |
| `notify` | `notify.fanout.dedup_window_seconds` | exact | int | `300` | xstockstrat-notify | false | `services/xstockstrat-notify/src/fanout/fanout.ts:dispatch` |
| `notify` | `notify.fanout.min_confidence_threshold` | exact | float | `0.7` | xstockstrat-notify | false | `services/xstockstrat-notify/src/fanout/fanout.ts:dispatch` |
| `notify` | `notify.fanout.min_severity` | exact | int | `2` | xstockstrat-notify | false | `services/xstockstrat-notify/src/fanout/fanout.ts:dispatch` |
| `notify` | `notify.fanout.sendgrid_from_email` | exact | string | — | xstockstrat-notify | false | `services/xstockstrat-notify/src/fanout/fanout.ts:dispatch` |
| `notify` | `notify.fanout.sendgrid_to_email` | exact | string | — | xstockstrat-notify | false | `services/xstockstrat-notify/src/fanout/fanout.ts:dispatch` |
| `notify` | `notify.push.min_severity` | exact | int | `2` | xstockstrat-notify | false | `services/xstockstrat-notify/src/fanout/webPush.ts:dispatch` |
| `platform` | `platform.maintenance_mode` | exact | bool | `false` | all | false | `services/xstockstrat-trading/internal/service/trading.go:PlaceOrder` |
| `platform` | `platform.trading_state` | exact | string | `HALTED` | xstockstrat-trading | false | `services/xstockstrat-trading/internal/service/trading.go:currentTradingState`; `services/xstockstrat-ui/src/app/trader/positions/page.tsx:PositionsPage` |
| `portfolio` | `portfolio.exposure.factor_map` | exact | string | `{}` | xstockstrat-portfolio | false | `services/xstockstrat-portfolio/internal/config/config.go:FactorMap` |
| `portfolio` | `portfolio.marketdata.last_close_lookback_days` | exact | int | `21` | xstockstrat-portfolio | false | `services/xstockstrat-portfolio/internal/service/offline_valuation.go:lastCloseLookbackDays` |
| `portfolio` | `portfolio.marketdata.quote_timeout_ms` | exact | int | `4000` | xstockstrat-portfolio | false | `services/xstockstrat-portfolio/internal/service/portfolio_service.go:quoteTimeout` |
| `portfolio` | `portfolio.marketdata.servability_timeout_ms` | exact | int | `2000` | xstockstrat-portfolio | false | `services/xstockstrat-portfolio/internal/service/portfolio_service.go:servabilityTimeout` |
| `portfolio` | `portfolio.risk.concentration_limit_pct` | exact | float | `0.2` | xstockstrat-portfolio | false | `services/xstockstrat-portfolio/internal/service/portfolio_service.go:checkRiskLimits` |
| `portfolio` | `portfolio.risk.max_drawdown_pct` | exact | float | `0.1` | xstockstrat-portfolio | false | `services/xstockstrat-portfolio/internal/service/portfolio_service.go:checkRiskLimits` |
| `portfolio` | `portfolio.watchlist.max_per_user` | exact | int | `50` | xstockstrat-portfolio | false | `services/xstockstrat-portfolio/internal/service/portfolio_service.go:maxWatchlistsPerUser` |
| `portfolio` | `portfolio.watchlist.max_symbols_per_list` | exact | int | `500` | xstockstrat-portfolio | false | `services/xstockstrat-portfolio/internal/service/portfolio_service.go:maxSymbolsPerList` |
| `portfolio` | `portfolio.watchlist.signal_prune_interval_seconds` | exact | int | `300` | xstockstrat-portfolio | false | `services/xstockstrat-portfolio/internal/service/signal_prune.go:pruneInterval` |
| `trading` | `trading.approval.require_above_notional` | exact | float | `50000` | xstockstrat-trading | false | `services/xstockstrat-trading/internal/service/trading.go:PlaceOrder` |
| `trading` | `trading.approval.require_above_qty` | exact | float | `500` | xstockstrat-trading | false | `services/xstockstrat-trading/internal/service/trading.go:PlaceOrder` |
| `trading` | `trading.broker.paper` | exact | bool | — | xstockstrat-trading | false | `services/xstockstrat-trading/internal/service/trading.go:environmentIsPaper`; `services/xstockstrat-trading/internal/service/trading.go:resolveTradingMode` |
| `trading` | `trading.broker.timeout_ms` | exact | int | `5000` | xstockstrat-trading | false | `services/xstockstrat-trading/internal/service/order_intent.go:staleThreshold`; `services/xstockstrat-trading/internal/service/trading.go:brokerCallTimeout`; `services/xstockstrat-trading/internal/service/trading.go:instantiateBrokerLocked` |
| `trading` | `trading.credential_health.interval_ms` | exact | int | `300000` | xstockstrat-trading | false | `services/xstockstrat-trading/internal/service/trading.go:StartCredentialHealthPoller` |
| `trading` | `trading.fill_poller.interval_ms` | exact | float | `5000` | xstockstrat-trading | false | `services/xstockstrat-trading/internal/service/trading.go:StartFillPoller`; `services/xstockstrat-trading/internal/service/trading.go:StartBracketProtectionWatchdog` |
| `trading` | `trading.ibkr.handshake_timeout_ms` | exact | int | `10000` | xstockstrat-trading | false | `services/xstockstrat-trading/internal/service/trading.go:ibkrTiming` |
| `trading` | `trading.ibkr.lst_refresh_margin_ms` | exact | int | `60000` | xstockstrat-trading | false | `services/xstockstrat-trading/internal/service/trading.go:ibkrTiming` |
| `trading` | `trading.ibkr.reauth_min_interval_ms` | exact | int | `30000` | xstockstrat-trading | false | `services/xstockstrat-trading/internal/service/trading.go:ibkrTiming` |
| `trading` | `trading.order.max_retries` | exact | int | `3` | xstockstrat-trading | false | `services/xstockstrat-trading/internal/service/trading.go:flattenAndHalt` |
| `trading` | `trading.order.retry_delay_ms` | exact | int | `500` | xstockstrat-trading | false | `services/xstockstrat-trading/internal/service/trading.go:flattenAndHalt` |
| `trading` | `trading.order_intent.stale_multiplier` | exact | float | `3` | xstockstrat-trading | false | `services/xstockstrat-trading/internal/service/order_intent.go:staleThreshold` |
| `trading` | `trading.order_intent.sweep_interval_ms` | exact | int | `5000` | xstockstrat-trading | false | `services/xstockstrat-trading/internal/service/order_intent.go:StartOrderIntentSweeper` |
| `trading` | `trading.position_sync.interval_ms` | exact | float | `300000` | xstockstrat-trading | false | `services/xstockstrat-trading/internal/service/trading.go:StartPositionSyncPoller` |
| `trading` | `trading.reconciliation.grace_ticks` | exact | int | `1` | xstockstrat-trading | false | `services/xstockstrat-trading/internal/service/trading.go:StartReconciliationPoller` |
| `trading` | `trading.reconciliation.halted_poll_interval_ms` | exact | float | `300000` | xstockstrat-trading | false | `services/xstockstrat-trading/internal/service/trading.go:haltedPollInterval` |
| `trading` | `trading.reconciliation.interval_ms` | exact | float | `60000` | xstockstrat-trading | false | `services/xstockstrat-trading/internal/service/trading.go:StartReconciliationPoller` |
| `trading` | `trading.reconciliation.systemic_threshold_pct` | exact | float | `0.5` | xstockstrat-trading | false | `services/xstockstrat-trading/internal/service/trading.go:StartReconciliationPoller` |
| `trading` | `trading.risk.atr_multiplier` | exact | float | `1.5` | xstockstrat-trading | false | `services/xstockstrat-trading/internal/service/trading.go:ComputePositionSize` |
| `trading` | `trading.risk.bracket_orders_enabled` | exact | bool | `true` | xstockstrat-trading | false | `services/xstockstrat-trading/internal/service/trading.go:submitOrder`; `services/xstockstrat-trading/internal/service/trading.go:applyBrokerOrderStatus` |
| `trading` | `trading.risk.max_concentration_pct` | exact | float | `0.1` | xstockstrat-trading | false | `services/xstockstrat-trading/internal/service/trading.go:ComputePositionSize` |
| `trading` | `trading.risk.max_position_pct` | exact | float | `0.05` | xstockstrat-trading | false | `services/xstockstrat-trading/internal/service/trading.go:PlaceOrder`; `services/xstockstrat-trading/internal/service/trading.go:checkPortfolioRisk` |
| `trading` | `trading.risk.max_risk_per_trade_pct` | exact | float | `0.02` | xstockstrat-trading | false | `services/xstockstrat-trading/internal/service/trading.go:ComputePositionSize` |
| `trading` | `trading.risk.max_unprotected_seconds` | exact | int | `30` | xstockstrat-trading | false | `services/xstockstrat-trading/internal/service/trading.go:maybeSubmitBracket` |
| `trading` | `trading.risk.sizing_enabled` | exact | bool | `true` | xstockstrat-trading | false | `services/xstockstrat-trading/internal/service/trading.go:PlaceOrder` |
| `trading` | `trading.risk.take_profit_rr_multiple` | exact | float | `2` | xstockstrat-trading | false | `services/xstockstrat-trading/internal/service/trading.go:computeTakeProfitPrice` |
| `ui` | `performance.equity_curve_start_date` | exact | string | — | xstockstrat-ui | false | `services/xstockstrat-ui/src/lib/performanceMetrics.ts:readStartDateMs` |
| `ui` | `performance.risk_free_rate_annual` | exact | float | `0.045` | xstockstrat-ui | false | `services/xstockstrat-ui/src/lib/performanceMetrics.ts:readRiskFreeRate` |

## Step Dependencies

- **Operator confirmation gate (before Step 9):** the 040/041 renumbering (Execution Summary
  resolution 1), and the rule that 295 merges after 035–039. If the operator instead has 295 take
  035/036 and renumbers 280/281/282, every `040`/`041` in Steps 9, 32, 33, 34, 36 and 38 maps back
  per design, and Step 38's merge-order rows change accordingly. Record the ruling in `context.md`.
- Steps 1→2, 3→4, 7→8, 10→11, 12→13, 14→15, 16→17, 18→19, 20→21, 22→23, 24→25, 26→27, 28→29,
  30→31, 32→33, 37→38 are test→implementation pairs (P-06, C-08).
- Step 5 (G1) requires Step 2. The operator pastes the tool source via a quoted heredoc
  (`design.md` §2), so no staging deploy of the feature branch is needed. **Actor: operator**,
  staging indicators DO console.
- Step 6 (A2 freeze) requires Steps 4 and 5. It freezes the catalog and scope; any finding outside
  the closed taxonomy becomes a `docs/reports/` defect, not a new step (`design.md` § Step outline).
- Step 8 requires Step 6 (the FAILED_PRECONDITION key list comes from the frozen triage).
- Step 9 requires the operator confirmation gate. Step 11 requires Step 9 (the marker table is
  probed through `to_regclass`, so 11 is safe either way, but the AC-2 test of Step 10 creates the
  table in its fixture).
- Steps 13, 15 and 17 each add their copies to `scripts/check-watcher-copies.sh`, which Step 13
  creates. Step 19 adds `live_limits.py` and Step 29 adds the agent copy of `watch_core.py`.
- Steps 21, 23 and 25 require the `OnChange` hook from Steps 13/15.
- Step 27 (indicators grace key reader) lands before its seed (Step 33). Between them the gate
  reports `read-unseeded` for `indicators.sandbox.startup_grace_ms` as PENDING in step mode
  (`check-config-wiring.mjs:706`). `--final` is run only at Step 36.
- Step 29 requires Steps 15 (Python core) and 27 (grace key exists).
- Step 32 requires Step 6 (frozen catalog) and is RED until Step 33.
- Step 34 requires Step 33 (the dry-run executes the real 041).
- **Step 35 (G2) is the only veto** and requires Steps 2–34. **Actor: operator**, a machine with
  Docker plus the staging console. Step 36 requires Step 35's signed `signoff.md`.
- Step 37 requires Steps 4 and 36. Step 38 requires Step 37.
- Step 39 requires everything, plus the integration PR merged to `main-dev` (staging heals at the
  PRE_DEPLOY migrator). **Actors: operator** (staging read-back via the agent MCP) **and CI**.
- **Follow-up features named (C-14/C-18):** 296 `fix-config-keys-contract` (rename, CHECK, dead-row
  deletion, alias activation), plus the shared watcher library refactor (named follow-up in
  `design.md` § Rejected Alternatives). No consumer surface is deferred.

**Verification actors for DB-backed checks** (`fails.md` 2026-11-04 fix-config-stream-resilience):
- every `scripts/migration-assertions/*.sql` and `scripts/migration-rerun.sh` leg runs in the CI
  `migration-rerun` job on the feature's draft integration PR (actor: **CI**; the executor records
  the run URL in `context.md`);
- `scripts/config-wiring-stored.sh` and `scripts/config-heal-dryrun.sh --fresh` run in the CI
  `config-wiring-stored` job (actor: **CI**), and locally only where Docker is available;
- `scripts/config-heal-dryrun.sh --staging` is run by the **operator** at G2.

No `/sdd-execute` step brings up a database itself (`reference/spec-template.md` § Migration step
verification is offline).

---

### Step 1 — test: config inventory tool (redaction, hashes, reveal refusal)

**Status**: `done`
**Service**: `xstockstrat-indicators`
**Files**:
- `services/xstockstrat-indicators/tests/test_config_inventory.py` — create

**Reviewers**: xstockstrat-indicators owner — formula sandboxing, numeric precision, timeout enforcement, no side-effects; Security — secrets redacted at every read edge

**Codebase Evidence**:
- Precedent read-only tool and its test: `services/xstockstrat-indicators/app/maintenance/sandbox_keys_check.py` (feature 243; on the feature branch since the 2026-11-05 main-dev merge), whose `ROWS_SQL` (`:27`) substitutes `'[redacted]'` for secret rows (`:29`, `:36`) and never selects `value_encrypted`; test `services/xstockstrat-indicators/tests/test_sandbox_keys_check.py`.
- Shared connector: `app/maintenance/legacy_authors.py:47` `async def connect(env=os.environ, run_id: str = "-")`.
- Fixture home (C-13): `services/xstockstrat-indicators/tests/conftest.py` exists (`snapshot_watcher` `:163`).
- Target `tests/test_config_inventory.py` is absent (create).
- **Gate (context.md decision 27) — cleared (operator, 2026-11-06).** The 2026-11-06 re-spec closed
  items (a) coverage lines in test Steps 14/16/18/22/24/26, (b) Steps 15/17 brace shorthand,
  (c) Step 23 order-type/fill-state enumeration and (e) AC-28 `migrate force 40`; the operator chose
  to leave Steps 4/13/19/29/38 unsplit (item d, decision 30).

**TDD**: `red-green required`

**Covers**: `AC-22, AC-30, AC-33, AC-36`

**Instructions**:
1. Build the tests against a fake asyncpg-like connection: an object whose `fetch(sql, *args)`
   records the SQL text and returns canned rows. Patch `legacy_authors.connect` to return it. These
   row literals have one consumer, so they stay inline (C-13). State that verdict in a module
   docstring line.
2. Rows: secret `marketdata`/`alpaca.api_key`; secret `marketdata`/`fmp.api_key` plus its non-secret
   twin `marketdata`/`marketdata.fmp.api_key`; non-secret `analysis`/`analysis.opportunity.max_universe_size`
   = `100` (not on the sign-off list); non-secret global `analysis`/`fundsignal.enabled` = `true`
   (on the sign-off list); per-user `analysis`/`fundsignal.enabled` for `u-295`.
3. Assert:
   - (AC-22) every SQL string the tool issues lacks the token `value_encrypted`, and no output line
     contains a secret plaintext or ciphertext probe value;
   - (AC-22) the secret row's line carries namespace, key, environment, `value_type` and
     `is_secret`;
   - (AC-30) the `max_universe_size` line carries `value_sha256 = sha256("100")` and not `"100"`;
   - (AC-30) with `--reveal` naming the global `fundsignal.enabled`, the output carries plaintext
     `true`;
   - (AC-30) the output ends with an output digest line and a `tool_sha256` line equal to
     `sha256(open(config_inventory.__file__,'rb').read())`;
   - (AC-33) `marketdata.fmp.api_key` is classed secret-class (its partner `fmp.api_key` is secret):
     `value_sha256` null, and a `--reveal` naming it exits 2;
   - (AC-36) `--reveal` naming the per-user `u-295` row exits with status 2 and prints no value;
   - `user_id` appears only as `sha256(user_id)`.
4. Import `app.maintenance.config_inventory` at module top so the suite fails with
   `ModuleNotFoundError` on the pre-implementation tree (RED).

**Verification**:
```bash
cd services/xstockstrat-indicators && uv run pytest tests/test_config_inventory.py -q   # RED before Step 2
```
Coverage threshold (C-08): indicators `--cov-fail-under=50`, enforced once green at Step 2.

---

### Step 2 — service: `config_inventory.py` read-only DO-console tool

**Status**: `done`
**Service**: `xstockstrat-indicators`
**Files**:
- `services/xstockstrat-indicators/app/maintenance/config_inventory.py` — create

**Reviewers**: xstockstrat-indicators owner — no side-effects from execution; Security — never plaintext secrets

**Codebase Evidence**:
- `app/maintenance/legacy_authors.py:47` `connect`; `sandbox_keys_check.py` (main-dev) shows the
  `python -m app.maintenance.<tool>` invocation, the single READ ONLY transaction and argparse shape.
- Catalog spellings needed for secret-class detection: `services/xstockstrat-config/src/grpc/authz.ts:132-145` `SECRET_CALLER_ALLOWLIST` (relative secret keys, `mcp_credential.` prefix).

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. Usage: `python -m app.maintenance.config_inventory [--reveal <request.json>] [--report]`. Use one
   `READ ONLY` transaction with SELECTs only, stdlib plus asyncpg, connecting via
   `legacy_authors.connect`.
2. The SELECT list is explicit and never includes `value_encrypted`: `namespace, key, environment,
   user_id, value_type, is_secret, value_data, default_value, description, consuming_service,
   updated_at`.
3. Classify secret-class rows (`design.md` §1 step 2, S-1): `is_secret`, or a partner spelling
   (`k` ↔ `ns.k`) in the same `(ns, env, COALESCE(user_id,''))` that is secret, or a spelling in the
   module's static `SECRET_KEYS` set. Copy that set from `authz.ts:132-145` with a comment naming the
   source.
4. Emit one JSONL line per row with: ns, key, env, `user_sha256` (null for global), value_type,
   is_secret, secret_class, has_description, has_consuming_service, `value_sha256` (null for secret
   and secret-class), `default_sha256`, updated_at.
5. Trailer lines: `output_sha256=<sha256 of all prior lines>` and `tool_sha256=<sha256 of this file>`.
6. `--reveal`: the request lists `(ns, key, env)`. For each entry:
   - exit 2 with no value when the entry is per-user, secret or secret-class;
   - otherwise print the plaintext, plus `in_bounds` for the three bounded keys of `## Config Key
     Contract` and `equals_code_default` when the request supplies a default.
7. `--report`: SELECT `config.config_heal_report_041`, guarded by `to_regclass`. Hash `user_id` and
   print NULL values for per-user rows (M-7).

**Verification**:
```bash
cd services/xstockstrat-indicators && uv run pytest tests/test_config_inventory.py -q && uv run ruff check . && uv run ruff format --check . && uv run pytest --cov=app --cov-fail-under=50
grep -n "value_encrypted" app/maintenance/config_inventory.py   # expect no output
```

---

### Step 3 — test: config-wiring gate extensions (fixtures + 278 test rewrites)

**Status**: `done`
**Service**: repo tooling (`scripts/`)
**Files**:
- `scripts/config-wiring.test.mjs` — modify
- `scripts/config-wiring-fixtures/` — create new fixture trees (one dir per case)

**Reviewers**: xstockstrat-config owner — config key naming, scoping, WatchConfig stream stability

**Codebase Evidence**:
- Gate: `scripts/check-config-wiring.mjs` (755 lines). `BASELINE_KINDS` `:305`, `OWNER_RE` `:306`
  (`/^(feature )?(243|278)\b|^(defect|feature) .+/` already admits `feature 296` and `feature 295`),
  `policy.envReadUnseeded` `:316`, `buildStoredSet` `:352`, `join` `:607`, `findingLine` `:646`,
  `declaredFromMigration` `:664-673` (CLI option parsed `:720`, applied `:730`), `ratchet` `:683-708`.
- CI path filter already includes `scripts/config-wiring-fixtures/**` (`.github/workflows/ci.yml:133`).
  Existing fixture dirs: `scripts/config-wiring-fixtures/{join,ratchet,readers,seed}`.
- Existing 278 cases in `scripts/config-wiring.test.mjs` (591 lines) must be rewritten (`design.md` §3
  "Owned test rewrites"): `baseline 2` `:477`, `baseline 3` `:502`, `skill 3` `:577`.

**TDD**: `red-green required`

**Covers**: `AC-19` (fixture legs)

**Instructions**:
1. Add the cases below. Each runs the gate on a fixture root holding a minimal `services/` tree and
   a fixture `config-wiring-stored.json`:
   - (AC-19) a fixture stored-set row seeding `ledger`/`ledger.no.reader` with no reader → finding
     kind `seeded-unread`, exit 1;
   - (AC-19) a fixture Python reader `get_int("analysis.x.y", 1)` on an attributed `analysis`
     receiver, with the stored row `value_type: "string"` → `type-mismatch`, exit 1. A `get_float` of
     an `int` row produces **no** finding (int→float allowed);
   - (AC-19) a fixture getter on an unregistered receiver → `unattributed`, exit 1;
   - a `metadata-missing` case (empty `description`) and a `default-mismatch` case (literal default
     ≠ `default_value`) on catalog-read rows. The same mismatch on a readers-disagree key produces no
     finding, and `readers-disagree` is reported;
   - `--final` with a stale `inputs_sha256` → exit 1, message names the regeneration command;
   - `--emit-heal-data` on a catalog key with empty description → exit 2;
   - `--final` membership: a baseline `seeded-unread` entry owned by `feature 296` whose (ns, key) is
     absent from a fixture `dryrun-fresh.tsv` → exit 1.
2. Rewrite `baseline 2/3` and `skill 3` to the new model: stored set from JSON, kinds, owners.
   Preserve the `@feature-278 @AC-7` assertion that a PR seeding an unread key fails CI (M-1).
3. Each new case fails on today's gate (unknown kind / unknown flag) — RED.

**Verification**:
```bash
node --test scripts/config-wiring.test.mjs   # RED before Step 4
```
Coverage threshold (C-08): none. `scripts/` tooling has no CI coverage gate (`docs/patterns/ci-overview.md`).

---

### Step 4 — service: extend `check-config-wiring.mjs` (stored JSON, attribution, kinds, modes, CI job)

**Status**: `done`
**Service**: repo tooling (`scripts/`, `.github/workflows/ci.yml`)
**Files**:
- `scripts/check-config-wiring.mjs` — modify
- `scripts/config-wiring-py-reads.py` — modify
- `scripts/config-wiring.json` — modify
- `scripts/config-wiring-stored.sh` — create
- `scripts/config-wiring-stored.json` — create (generated)
- `.github/workflows/ci.yml` — modify

**Reviewers**: xstockstrat-config owner — config key naming and scoping; DBA — run-order compliance with `scripts/db-migrate.sh`

**Codebase Evidence**:
- Tokenizer stored-set model to retire: `buildStoredSet` `check-config-wiring.mjs:352-375`,
  `applyUpdate` `:203`, `applyDelete` `:250`, `rewriteAllow` registry `:16,355`, `unmodelled-rewrite`
  `:676,735`. `splitStatements` `:77` and `applyInsert` `:172` stay for `--declared-migration` (`:666-673`).
- The getter name is dropped today in the Python extractor `scripts/config-wiring-py-reads.py:81-93`
  and in `extractRegexReads` `check-config-wiring.mjs:538`.
- Migration CI shape: `migration-rerun` job `.github/workflows/ci.yml:678-714` (timescaledb
  `latest-pg16` service `:687`, `docker build -f scripts/Dockerfile.migrate -t xstockstrat-migrate-ci .`
  `:703`); existing `config-wiring` job `:1001-1019`; `ci-gate` `:1021`; `changes` filter
  `config-wiring` `:123-133`.
- The existing `config-wiring` job already runs `node scripts/check-config-wiring.mjs --final`
  (`ci.yml:1019`), which selects `ratchet` (`check-config-wiring.mjs:741`), not step mode. So every PR
  that touches the gate paths runs `--final` from this step on, and the step-mode PENDING path (`:706`)
  only applies to local runs.
- Baseline: 124 entries in `scripts/config-wiring.json`, `policy.envReadUnseeded: "reported"`.
- Generator targets `scripts/config-wiring-stored.sh` and `scripts/config-wiring-stored.json` are absent (create).

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. **Stored set.** Read `scripts/config-wiring-stored.json`, which has fields `inputs_sha256` and
   `rows[]` of `(namespace, key, environment, global, is_secret, value_type, description,
   consuming_service, default_value)`. Retire the tokenizer stored-set functions listed above.
2. **Generator.** `scripts/config-wiring-stored.sh` (bash 3.2, `#!/usr/bin/env bash`):
   1. create a throwaway DB on `$DATABASE_URL`;
   2. render and `migrate up` the config migrations only (reuse `scripts/render-migrations.sh`);
   3. dump the rows above;
   4. compute `inputs_sha256` over config `migrations/**` and the generator;
   5. drop the DB.

   Never print the URL, following the `migration-rerun.sh` "printed a URL" assertion precedent
   (`:243`).
3. **Attribution.** Add a receiver→namespace registry to `scripts/config-wiring.json`, per service
   file and receiver symbol, with **no default namespace**. An unregistered receiver yields
   `unattributed` (blocking). Join readers to rows by `(namespace, key)` in the exact current spelling.
4. **New kinds.** Add to `BASELINE_KINDS`: `unattributed`, `type-mismatch` (int→float allowed),
   `metadata-missing`, `default-mismatch` (literal defaults only, skipping readers-disagree keys) and
   `readers-disagree` (reported). Scope them to catalog-read rows. Exclude secret and prefix catalog
   entries from `read-unseeded` (M-3).
5. **Modes.** Add:
   - `--inventory <jsonl>` (repeatable): loads an inventory as an extra stored set for reporting;
   - `--emit-heal-data --inventory <staging> --inventory <fresh>`: prints the `catalog_041` and
     `allow_041` VALUES blocks. Exit 2 when a catalog key has an empty description. Descriptions
     come from `scripts/config-heal/catalog.tsv` (Step 6).
6. **`--final`.** Fails on a stale `inputs_sha256`. In step mode staleness is tolerated: missing-side
   findings stay PENDING (`:706`).
7. **Baseline.** Regenerate the baseline so that every finding of a new kind on today's tree is
   recorded with owner `feature 295`, to be drained at Step 36. The 124 existing entries keep their
   owners. Do not change `policy.envReadUnseeded` yet; Step 36 flips it. Because CI runs `--final`
   (`ci.yml:1019`), `--final` must exit 0 at the end of this step. Any later step that adds a finding
   before its fix lands (Step 27's `read-unseeded` for `indicators.sandbox.startup_grace_ms`, seeded
   by 041) adds a `feature 295` baseline entry in the same commit. Step 36 drains it.
8. **CI.** Add a job `config-wiring-stored` (copy the `migration-rerun` service/build shape) that:
   1. runs the generator;
   2. fails on any `git diff --exit-code scripts/config-wiring-stored.json`;
   3. uploads the regenerated JSON as an artifact.

   Add a `changes` filter covering config `services/xstockstrat-config/migrations/**`, the
   generator, `scripts/config-wiring-stored.json`, `scripts/render-migrations.sh`,
   `scripts/db-migrate.sh` and `scripts/Dockerfile.migrate`. Add the job to `ci-gate` `needs`.
   Extend the `config-wiring` filter with `scripts/config-heal/**`.
9. Generate the initial `config-wiring-stored.json` (CI job artifact or local Docker). Record which
   one in `context.md`.

**Verification**:
```bash
node --test scripts/config-wiring.test.mjs
node scripts/check-config-wiring.mjs          # step mode: exit 0 against the regenerated baseline
node scripts/check-config-wiring.mjs --final  # what the CI config-wiring job runs (ci.yml:1019): exit 0
shellcheck scripts/config-wiring-stored.sh
grep -n "config-wiring-stored" .github/workflows/ci.yml   # job, filter and ci-gate needs present
```

---

### Step 5 — docs: G1 — staging hash inventory (operator gate)

**Status**: `done`
**Service**: `scripts/config-heal/`
**Files**:
- `scripts/config-heal/inventory-staging.jsonl` — create (operator output)

**Reviewers**: none

**Codebase Evidence**:
- Tool: Step 2 `app/maintenance/config_inventory.py`. The staging DB is reachable from the indicators
  console via its `DATABASE_URL` (context.md decision 11, `.do/app.dev.yaml`).

**TDD**: `N/A (operator data capture)`

**Covers**: —

**Instructions**:
1. **Actor: operator.** On the staging indicators DO console, in `/app`, paste the Step 2 source via
   `cat > /tmp/config_inventory.py <<'PY' … PY` (quoted heredoc). Run it with
   `python -m app.maintenance.config_inventory` (or `python /tmp/config_inventory.py`) and paste the
   output back.
2. The executor commits the output verbatim and checks that the trailer's `tool_sha256` equals
   `shasum -a 256 services/xstockstrat-indicators/app/maintenance/config_inventory.py`. Record both
   digests in `context.md` (`G1 staging`).

**Verification**:
```bash
tail -2 scripts/config-heal/inventory-staging.jsonl
shasum -a 256 services/xstockstrat-indicators/app/maintenance/config_inventory.py   # equals tool_sha256
grep -c '"value_sha256"' scripts/config-heal/inventory-staging.jsonl
```

---

### Step 6 — config: A2 fixpoint triage and catalog freeze

**Status**: `done`
**Service**: repo tooling plus every namespace (`analysis`, `agent`, `identity`, `indicators`, `ingest`, `ledger`, `marketdata`, `notify`, `platform`, `portfolio`, `trading`, `ui`)
**Files**:
- `scripts/config-heal/catalog.tsv` — create
- `scripts/config-wiring.json` — modify (extractor registry fixes only)
- `scripts/check-config-wiring.mjs`, `scripts/config-wiring-py-reads.py`, `scripts/config-wiring.test.mjs` — modify (only for extractor fixes, each with a fixture case)
- `docs/roadmap/features/295-fix-config-keys-drift/implementation-spec.md` — modify (append the generated table under `## Config Key Contract` only)

**Reviewers**: xstockstrat-config owner — config key naming and scoping; the service owner of each namespace whose rows are classified

**Codebase Evidence**:
- Ledger rule: triage every finding as extractor gap vs real defect before freezing a baseline
  (`docs/roadmap/ledger/fails.md` 2026-11-04 enforce-config-key-wiring).
- The closed taxonomy is defined in `design.md` § Step outline, "A2's closed taxonomy".

**TDD**: `red-green required` for each extractor fix (fixture case first); `N/A` for catalog rows

**Covers**: —

**Instructions**:
1. Run `node scripts/check-config-wiring.mjs --json --inventory scripts/config-heal/inventory-staging.jsonl`
   and classify every finding into exactly one category:
   - twin;
   - seed;
   - retype;
   - signoff-type;
   - default-synced/mismatch;
   - out-of-bounds;
   - per-user-unread;
   - secret-class;
   - dead→296;
   - readers-disagree;
   - extractor fix;
   - code-default change.

   Anything else becomes a `docs/reports/` defect with a `.status` sidecar, not a step.
2. Author `catalog.tsv` with one row per read key: `namespace, key, match(exact|prefix), value_type,
   code_default, description, consuming_service, is_secret, reader(path:symbol)`. Write each
   description once. Include `indicators.sandbox.startup_grace_ms` and the three
   `## Config Key Contract` rows.
3. Prove the fresh residuals and record the proof in `context.md`:
   - zero `twin-kept-unsigned` and `twin-secret-class` on the fresh-migrations model;
   - every readers-disagree key seeded fresh (M-2).

   Any exception is baselined as `form-mismatch`, owner `feature 296`.
4. List the keys that will return FAILED_PRECONDITION after Step 8 (unsigned twins, Open Risk 5)
   in `context.md`, for the PR body.
5. Append the rendered per-key contract table under `## Config Key Contract` in this file.

**Verification**:
```bash
node --test scripts/config-wiring.test.mjs
awk -F'\t' 'NR>1 && $6==""' scripts/config-heal/catalog.tsv | wc -l   # expect 0 (no empty description)
node scripts/check-config-wiring.mjs   # step mode exit 0
```

---

### Step 7 — test: form-tolerant SetConfig, canonical grants/bounds, error mapping

**Status**: `done`
**Service**: `xstockstrat-config`
**Files**:
- `services/xstockstrat-config/src/__tests__/setConfigSpelling.test.ts` — create

**Reviewers**: xstockstrat-config owner — config key naming, environment / global-per-user scoping, secret encryption

**Codebase Evidence**:
- Existing patterns: `src/__tests__/internalCallerSetConfig.test.ts`, `setConfigScalarBounds.test.ts`,
  `tradingStateValidation.test.ts` (fake pool + metadata). The runner is `tsc && node --test
  dist/__tests__/*.test.js` (`package.json:12`). Target `setConfigSpelling.test.ts` is absent (create).
- Since the 2026-11-06 main-dev merge, `configServiceImpl.ts` is 760 lines (+7: feature 282 merged,
  `0ea9b5c5`, and added three `SCALAR_BOUNDS_REGISTRY` entries at `:151-157`). Every anchor after
  `:150` moved +7.

**TDD**: `red-green required`

**Covers**: `AC-1, AC-25, AC-31` (bound leg), `AC-34, AC-35`

**Instructions**:
1. Use a fake `pg` pool that holds rows in memory and evaluates the `key IN ($k, $alt)` probes.
2. Cases:
   - **(AC-1)** Stored `marketdata`/`marketdata.backfill.batch_size`=1000. An admin sets
     `backfill.batch_size`=500. The upsert targets key `marketdata.backfill.batch_size` and no
     `backfill.batch_size` row is inserted. User `u-1` then sets `backfill.batch_size`=700: one
     INSERT of a per-user `marketdata.backfill.batch_size` row, and the global row stays 500 (no
     UPDATE of `user_id IS NULL`).
   - **(AC-25)** Metadata `x-internal-caller: trading-reconciliation-poller`. SetConfig `platform` /
     `trading_state` = `REDUCE_ONLY` passes the grant, and the stored key is
     `platform.trading_state`.
   - **(AC-25)** An admin sets `analysis`/`opportunity.max_universe_size`=0 → code 3 with
     `[1, 1000]`.
   - **(AC-31 bound)** `indicators`/`indicators.sandbox.timeout_ms`=40000 → code 3 `[100, 33000]`.
     Also cover `startup_grace_ms` [1000, 10000] and `analysis.compute.max_worker_threads` [1, 16].
   - **(AC-34)** Both global spellings present, an admin writes → code 9 (FAILED_PRECONDITION), the
     message names both spellings, no write. Global `analysis.backtest.max_duration_seconds` plus a
     per-user `backtest.max_duration_seconds` for `u-1`, with `u-1` writing → code 9, no write.
   - **(AC-35)** The fake pool rejects the upsert with `{code:'23514'}` → code 3; `{code:'23505'}`
     → code 3; any other error stays 13.
3. These fail today: the exact-key probe at `configServiceImpl.ts:583-587` inserts a bare row, and
   the catch at `:661-663` maps everything to 13 (RED).

**Verification**:
```bash
cd services/xstockstrat-config && pnpm run test   # RED before Step 8
```

---

### Step 8 — service: form-tolerant SetConfig (FR-1)

**Status**: `done`
**Service**: `xstockstrat-config`
**Files**:
- `services/xstockstrat-config/src/grpc/authz.ts` — modify
- `services/xstockstrat-config/src/grpc/configServiceImpl.ts` — modify

**Reviewers**: xstockstrat-config owner — config key naming, scoping, secret encryption; Security — `is_secret` row-authoritative on write

**Codebase Evidence**:
- Grant match `authz.ts:112` (`grant.key === key`), grant literal `:84-94` (`key: 'platform.trading_state'`),
  `SECRET_CALLER_ALLOWLIST` `:132-145`.
- `configServiceImpl.ts` (re-verified after the 2026-11-06 main-dev merge, +7 lines from feature 282):
  - `platform.trading_state` check `:552` (its comment is `:550-551`);
  - `lookupScalarBounds` `:163-164` (two-probe), `SCALAR_BOUNDS_REGISTRY` `:103-158`. The registry's
    tail entry is now feature 282's `portfolio.watchlist.max_symbols_per_list` `:157`. 282's
    `marketdata.assets.refresh_interval_hours` `:153` and `portfolio.marketdata.servability_timeout_ms`
    `:154` are also on the base, after 281's `portfolio.watchlist.signal_prune_interval_seconds` `:150`;
  - exact-scope probe `:583-587`;
  - global fallback `:591-598`;
  - NOT_FOUND `:606-612` (`code: 5` `:609`);
  - row-authoritative `isSecret` `:617-623`;
  - upsert `:642-655`;
  - catch-all `code: 13` `:661-663`.
- Registry append anchor (`merge-order.md:102`): 282 appended first and has merged, so 295 appends
  after 282's tail entry `:157`.

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. Export `canonical(namespace, key)` from `authz.ts`: strip a leading `${namespace}.`, so the result
   is the relative key. Export `altSpelling(namespace, key)`: the other spelling. Use `canonical`
   on both sides of the grant comparison at `:112`.
2. Make the `platform.trading_state` check at `:552` compare `canonical(namespace, key) ===
   'trading_state'`.
3. Re-key `SCALAR_BOUNDS_REGISTRY` lookups through a single probe:
   `REGISTRY[`${ns}.${canonical(ns,key)}`]`. Keep the registry literals full-dotted, so there is one
   path and no third one. Every existing entry, including 281's
   `portfolio.watchlist.signal_prune_interval_seconds` `:150` and 282's three entries `:153`, `:154`,
   `:157`, must still resolve through the single probe. Append the three new bounds from
   `## Config Key Contract` at the tail, after `:157`.
4. Spelling resolution:
   - The exact-scope probe becomes `SELECT key, is_secret … WHERE namespace=$1 AND key IN ($2,$3)
     AND environment=$4 AND COALESCE(user_id,'')=COALESCE($5,'')`.
   - Only when it returns no rows, run the global probe with the same `IN`. Always run the global
     probe for a per-user request, to detect a spelling mismatch.
   - Two rows at one scope, or an exact-scope spelling different from the global row's spelling →
     `callback({code: 9, message: 'ambiguous config key spelling: <a> and <b> both … (feature 296)'})`.
   - The found row selects **only** the spelling written to the upsert. `env` and `userIdParam`
     always come from the request.
5. Map the error at `:661-663` to `code: 3` when `err.code` is `'23514'` or `'23505'`; everything
   else stays `13`.
6. **Output invariance.** Do not touch `getConfig`, `listKeys`, `watchConfig` or `getSecret` output.
   AC-2 is preserved.

**Verification**:
```bash
cd services/xstockstrat-config && pnpm run test && pnpm run lint && pnpm run test:coverage && pnpm exec c8 check-coverage --lines 40
```

---

### Step 9 — migration: `040_config_markers`

**Status**: `done`
**Service**: `xstockstrat-config`
**Files**:
- `services/xstockstrat-config/migrations/040_config_markers.up.sql` — create
- `services/xstockstrat-config/migrations/040_config_markers.down.sql` — create

**Reviewers**: DBA — migration NNN numbering, up+down pair present, run-order; xstockstrat-config owner — scoping

**Codebase Evidence**:
- Highest config migration on `origin/main-dev` (re-checked 2026-11-06, after merging `origin/main-dev`
  into the feature branch):
  `039_portfolio_servability_timeout.up.sql`. Feature 282 merged (`0ea9b5c5`) and brought
  `038_marketdata_asset_refresh_interval` and `039_portfolio_servability_timeout`. `035`/`036` exist
  only on open PR #1359 (`origin/claude/smoke-test-deployment-0f1z5j`), and `merge-order.md:100`
  records them as unusable. No origin ref holds a `040` or `041` config migration. `042` and `043`
  exist on other branches, as pinned (291, 293).
- Numbers are pinned by `context.md` decision 28 (operator, 2026-11-05) and `merge-order.md:100-103`:
  282 `038`/`039` → **295 `040`/`041`** → 291 `042` → 293 `043`. That decision answers the operator
  confirmation gate in `## Step Dependencies`.
- Superseded wording outside the step bodies (not edited by re-spec): the `## Step Dependencies`
  operator gate and Execution Summary resolution 1 still say "295 merges after 035–039". Decision 28
  governs: `035`/`036` are unusable, and the order is 282 `038`/`039` → 295 `040`/`041`. The same
  section's "`--final` is run only at Step 36" is also stale: the CI `config-wiring` job already runs
  `--final` (`config-wiring` job `ci.yml:1011-1029`, `--final` at `:1029`; the `values.final` →
  `ratchet` selection is `check-config-wiring.mjs:803-804`), as Steps 4 and 27 state. Step 4's older
  `ci.yml:1021` anchor is now the `config-wiring-stored` job at `:1033`, with `ci-gate` at `:1077`.
- Both Files targets (`040_config_markers.{up,down}.sql`) are absent (re-checked 2026-11-06): create.

**TDD**: `N/A (migration)`

**Covers**: —

**Instructions**:
1. The gate is answered (decision 28): keep `040`. The merge-order precondition is now met: 282's
   `038`/`039` are on `main-dev`, and `040` is max+1. Step 36 re-checks it before the integration PR.
   F-01: `040` becomes immutable once on `main-dev`, and it reaches `main-dev` only through that PR.
2. Up: `CREATE TABLE IF NOT EXISTS config.config_markers (name text PRIMARY KEY, set_at timestamptz
   NOT NULL DEFAULT now(), set_by text NOT NULL);`. The table starts empty. Header comment (≤2 lines):
   feature 296's rename writes `relative_keys_v1`, and nothing in 295 writes it.
3. Down: `DROP TABLE IF EXISTS config.config_markers;`.

**Verification**:
```bash
ls services/xstockstrat-config/migrations/040_*.up.sql services/xstockstrat-config/migrations/040_*.down.sql
git fetch -q origin '+refs/heads/*:refs/remotes/origin/*'; for r in $(git for-each-ref --format='%(refname)' refs/remotes/origin); do git ls-tree --name-only "$r" services/xstockstrat-config/migrations/ 2>/dev/null | grep -E '/04[01]_' | grep -v 'config_markers\|heal_config_keys' | sed "s|^|$r: |"; done   # expect no output
grep -n "INSERT" services/xstockstrat-config/migrations/040_config_markers.up.sql   # expect no output
```

---

### Step 10 — test: change-feed liveness, content version, dormant alias

**Status**: `done`
**Service**: `xstockstrat-config`
**Files**:
- `services/xstockstrat-config/src/__tests__/changeFeedLiveness.test.ts` — create
- `services/xstockstrat-config/src/__tests__/contentVersion.test.ts` — create
- `services/xstockstrat-config/src/__tests__/dormantAlias.test.ts` — create

**Reviewers**: xstockstrat-config owner — WatchConfig stream stability

**Codebase Evidence**:
- Listener lifecycle (re-verified after the 2026-11-06 main-dev merge, +7 lines): `connectListener`
  `configServiceImpl.ts:197-216` (`LISTEN config_changed` `:207`, `on('notification')` `:204`),
  `dropListener` `:219`, `scheduleReconnect` `:232`, `resyncAll` `:244`, `onNotification` `:255-271`,
  `serial` `:188-195`.
- Version today: `Date.now()` at `:290`, `:313`, `:659`.
- Broadcast `broadcastToSubscribers` `:357-373`.
- Existing feature-258 resilience tests are the harness precedent (`src/__tests__/configServiceImpl.test.ts`).
- The three targets are absent (create).

**TDD**: `red-green required`

**Covers**: `AC-2, AC-21, AC-26`

**Instructions**:
1. **(AC-21)** Fake pool and listener client with mocked timers.
   - The listener accepts `LISTEN` and acknowledges `SELECT pg_notify('config_heartbeat',$1)` but
     never emits `notification`.
   - Advance 30 s and more: `dropListener` → reconnect → `resyncAll` runs. A subscriber on
     `indicators` then receives a DELTA carrying `indicators.sandbox.timeout_ms`=15000, which the
     fake DB now holds.
   - Assert that no heartbeat query used `pool.query` (F-06: listener socket only).
2. **(AC-26)** A `ledger` subscriber counts distinct `version`s.
   - Trigger the 5-min backstop reload and the 10 s re-send with no row change → no new version.
   - Then change `ledger.export.max_window_days` to 180 → exactly one new version.
   - The version is 16 hex characters and stable across the two calls.
3. **(AC-2)** Without the marker (the `to_regclass` probe returns null, or the marker row is absent),
   the snapshot keys for `indicators` equal the stored keys exactly. With the marker row present,
   `withLegacyAliases` adds the alternate spelling. Both assertions run, so the inactive path is
   proven byte-identical. AC-2 is `@preserve`: it is green on today's code by design, and the
   with-marker leg is the RED half.
4. Grep-assert that no `services/xstockstrat-config/migrations/04*.up.sql` from 295 contains
   `INSERT INTO config.config_markers`.
5. A pool-options test asserts `query_timeout`=15000, `statement_timeout`=15000, `keepAlive`=true,
   `keepAliveInitialDelayMillis`=10000 and `max` default 2.

**Verification**:
```bash
cd services/xstockstrat-config && pnpm run test   # RED before Step 11 (AC-2 inactive leg green by design)
```
Coverage threshold (C-08): `c8 check-coverage --lines 40`, enforced once green at Step 11.

---

### Step 11 — service: LISTEN heartbeat, watchdog, content version, re-send, backstop, dormant alias

**Status**: `done`
**Service**: `xstockstrat-config`
**Files**:
- `services/xstockstrat-config/src/grpc/configServiceImpl.ts` — modify
- `services/xstockstrat-config/src/index.ts` — modify

**Reviewers**: xstockstrat-config owner — WatchConfig stream stability; DBA — connection budget (F-06)

**Codebase Evidence**:
- See Step 10. Pool: `src/index.ts:29-34`
  (`new Pool({connectionString, max: parseInt(process.env.DB_POOL_MAX ?? '2', 10), ssl})`).
- Overlay SELECTs (re-verified after the 2026-11-06 main-dev merge, +7 lines): `reloadAll` `:273`
  (FROM `:277`), `reloadNamespace` `:300` (FROM `:303`), `resolveOverlayValues` `:326-335` (FROM `:332`).
- `getConfig` `:440-459`; subscriber registration (`watchConfig`) `:397-437`.
- Code-constant convention: `LISTENER_BACKOFF_*` `:168-169`, with the comment "Code constants, not
  config keys: config cannot watch its own keys" `:167` (F-07 invariant).
- gRPC server construction `new grpc.Server()` `src/index.ts:41`; pool `max` `:32`.
- Keepalive spike database: `context.md` decision 29 (operator override, this spike only) allows a
  throwaway local `timescale/timescaledb:latest-pg16` container.
- `pg` dependency: `^8.11.5` (`services/xstockstrat-config/package.json:31`).
- **Ordering problem (unresolved operator question, `context.md`):** instruction 8 runs the Step 12/14/16
  client watcher cores, but those are built in Steps 13/15/17, after this step.

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. **Heartbeat.**
   - `connectListener` also runs `LISTEN config_heartbeat` and resets `lastBeatAt`.
   - An unref'd 10 s `setInterval` has its whole body in try/catch. When no beat is in flight it
     sends `listener.query("SELECT pg_notify('config_heartbeat',$1)",[token]).catch(warn)` on the
     **listener client**.
   - The `notification` handler routes by `msg.channel`. A matching token sets `lastBeatAt`.
   - When `now - lastBeatAt > 30000`, call `dropListener(c, new Error('change feed heartbeat
     missed'))`, which leads to `scheduleReconnect` and `resyncAll`.
2. **Watchdog.** `serial()` records `headStartedAt`. When the head is older than 30 s, log one ERROR
   `config serial chain stalled` and suspend re-sends until the chain drains.
3. **Content version.**
   - The three SELECTs add `updated_at`.
   - `contentVersion(values, secretUpdatedAts)` is the first 16 hex characters of sha256 over the
     sorted `(key, typed value, isSecret)` plus the secret rows' `updated_at`, which is hashed and
     never emitted.
   - It replaces `Date.now()` at `:290` and `:313`, and is computed in `snapshotForSubscriber` and
     `getConfig`.
   - Each subscriber keeps `lastVersion` and `lastPayload`. `broadcastToSubscribers` skips a
     subscriber whose version is unchanged.
4. **Re-send.** Every 10 s, re-write each non-pending subscriber's `lastPayload` as a DELTA with no
   DB access. Skip backpressured calls. Log at DEBUG.
5. **Backstop.** Every 5 min, run `reloadAll` on `serial()`. Re-broadcast an (ns, env) only when its
   global version changed or it has a per-user subscriber.
6. **Dormant alias.**
   - Each of the three SELECTs carries `CASE WHEN to_regclass('config.config_markers') IS NULL THEN
     false ELSE EXISTS(SELECT 1 FROM config.config_markers WHERE name='relative_keys_v1') END AS
     marker_active`.
   - `withLegacyAliases(values, ns)` runs after the overlay, only when `marker_active`.
   - A `{"marker":…}` NOTIFY payload enqueues `resyncAll` through `serial()`.
7. **Pool.** In `src/index.ts`, add `query_timeout: 15000, statement_timeout: 15000, keepAlive: true,
   keepAliveInitialDelayMillis: 10000`. `max` is unchanged (F-06).
8. **MOVED to Step 13, instruction 6** (operator ruling 2026-11-06, `context.md` decision 32). Not run
   in this step. The original text is kept for reference:
   **Keepalive spike** (Open Risk 4). **Gated on an operator ruling:** either (A) move this spike to the
   end of Step 13 (the first client core), or (B) run it here with a throwaway client. Do not pick one
   unilaterally. Steps 1–7 and 9 of this step, and its Verification, do not depend on the spike.
   Run the client watcher against this server
   locally. If `too_many_pings` appears, add `'grpc.keepalive_permit_without_calls': 1,
   'grpc.http2.min_ping_interval_without_data_ms': 20000` to `new grpc.Server(...)` (`index.ts:41`).
   Per decision 29 the executor may start `dockerd` and one disposable
   `timescale/timescaledb:latest-pg16` container for this spike only. It must `docker rm -f` the
   container afterwards and touch no shared or remote database. Record the outcome, the run and the
   teardown in `context.md` and the Deviation Log.
9. Verify the node-postgres Pool options against the installed `pg` version (Open Risk 12). Record
   the version in `context.md`.

**Verification**:
```bash
cd services/xstockstrat-config && pnpm run test && pnpm run lint && pnpm run test:coverage && pnpm exec c8 check-coverage --lines 40
grep -n "pool.query(.*config_heartbeat" services/xstockstrat-config/src/grpc/configServiceImpl.ts   # expect no output
```

---

### Step 12 — test: Go watcher core (trading, portfolio, marketdata)

**Status**: `done`
**Service**: `xstockstrat-trading`, `xstockstrat-portfolio`, `xstockstrat-marketdata`
**Files**:
- `services/xstockstrat-trading/internal/config/config_test.go` — modify
- `services/xstockstrat-portfolio/internal/config/config_test.go` — modify
- `services/xstockstrat-marketdata/internal/config/config_test.go` — modify

**Reviewers**: xstockstrat-trading owner — paper-only dev invariant; xstockstrat-portfolio owner — consistency; xstockstrat-marketdata owner — feed idempotency

**Codebase Evidence**:
- trading watcher `internal/config/config.go`:
  - `NewWatcher(endpoint, applicationEnv, tradingMode string, namespaces ...string)` `:80`;
  - `watchLoop` 2 s doubling, never reset `:126-138`;
  - `context.Background()` `:148`;
  - prefix-delete `strings.HasPrefix(k, prefix)` `:167`;
  - getters `:205-243`;
  - `NewSnapshotWatcher` `:249`.
- trading constructs it with `"trading", "platform"` (`cmd/server/main.go:70`).
- portfolio `config.go`: getters `:112-181`, `watchLoop` `:183`. marketdata `config.go`: getters
  `:142-195`, `watchLoop` `:197`, `ResolveSecret` `:113`.

**TDD**: `red-green required`

**Covers**: `AC-10` (trading), `AC-11, AC-12, AC-27` (portfolio)

**Instructions**:
1. Use a fake `configv1.ConfigServiceClient` plus a fake clock/sleeper injected through the new core's
   options.
2. **(AC-10 trading)** The stream delivers a SNAPSHOT, then blocks without closing. After the 30 s
   liveness deadline the watcher cancels the stream ctx and redials. Reads keep serving the last
   snapshot while redialling. A value delivered after the redial is applied.
3. **(AC-11)** The server ends every stream after the snapshot. Over 10 s of fake time there are ≤5
   stream opens, the delays are non-decreasing, and there is no reset (healthy < 15 s).
4. **(AC-12, trading)** `trading.broker.timeout_ms` stored as each row below, read with default 5000:

   | stored | getter | result | WARN |
   |---|---|---|---|
   | int 7000 | float | 7000.0 | no |
   | float 7000.5 | int | 5000 | yes |
   | string "7000" | int | 5000 | yes |
   | absent | int | 5000 | yes |

   Capture WARNs with a `slog` handler and assert they name the FQN.
5. **(AC-27 portfolio)** `portfolio.risk.max_drawdown_pct` stored as int 7, read with the float
   getter and default 1.5 → 7.0, no WARN.
6. A trading two-namespace test: a `platform` SNAPSHOT does not delete `trading` keys (per-namespace
   maps).
7. Read-key evidence: two reads of one key → one `config.read_key ns=… key=…` INFO before the
   coverage tick. At the tick, one `config.read_coverage` line and a re-emit.

**Verification**:
```bash
cd services/xstockstrat-trading && GOWORK=off go test ./internal/config/... -count=1   # RED before Step 13
```

---

### Step 13 — service: Go watcher core (byte-identical `watchcore.go` ×3) + copy guard

**Status**: `done`
**Service**: `xstockstrat-trading`, `xstockstrat-portfolio`, `xstockstrat-marketdata`
**Files**:
- `services/xstockstrat-trading/internal/config/watchcore.go` — create
- `services/xstockstrat-portfolio/internal/config/watchcore.go` — create (byte-identical)
- `services/xstockstrat-marketdata/internal/config/watchcore.go` — create (byte-identical)
- `services/xstockstrat-trading/internal/config/config.go` — modify
- `services/xstockstrat-portfolio/internal/config/config.go` — modify
- `services/xstockstrat-marketdata/internal/config/config.go` — modify
- `scripts/check-watcher-copies.sh` — create
- `.github/workflows/ci.yml` — modify (run the guard in the `config-wiring` job; extend its filter)
- `docs/patterns/dry-guard-rail.md` — modify (exemption entry)
- `.jscpd.json` — modify (ignore the copies)
- `packages/otel/produced-signals.tsv` — modify (two `loki-literal` rows)

**Reviewers**: xstockstrat-trading owner — order execution correctness, paper-only dev invariant; xstockstrat-portfolio owner; xstockstrat-marketdata owner

**Codebase Evidence**:
- Keepalive helper `clientKeepAlive` `services/xstockstrat-trading/internal/service/trading.go:195-200`
  (30 s / 10 s, PermitWithoutStream).
- Copy-exemption precedent `docs/patterns/dry-guard-rail.md:80-86` (feature 266 `dbTls.ts` +
  hash guard `services/xstockstrat-ui/src/lib/dbTlsPlatformGuard.test.ts`).
- `.jscpd.json` `ignore` array `:8`.
- `packages/otel/produced-signals.tsv` schema `kind identifier producer-path producer-literal`, with
  `loki-literal` rows (`:23`). Comma-list producer paths: rows `:2` and `:5`; rows `:3` and `:4` are
  single paths. Checker `scripts/check-otel-produced-signals.sh`.
- Trading prefix-delete block `internal/config/config.go:157-173`. `NewSnapshotWatcher` exists only in
  trading (`config.go:249`). Marketdata has none: its tests build `&config.Watcher{}`
  (`cmd/server/main_test.go:47`) or set the unexported `snapshot` field in-package
  (`internal/config/config_test.go:136`).
- Create targets `watchcore.go` (×3) and `scripts/check-watcher-copies.sh` are absent.

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. `watchcore.go` (package `config`) holds the shared behavior:
   - dial options `grpc.WithKeepaliveParams(keepalive.ClientParameters{Time: 30s, Timeout: 10s,
     PermitWithoutStream: true})`;
   - a per-stream `context.WithCancel`, cancelled by a 30 s liveness timer that each message resets;
   - backoff equal-jitter `[base/2, base]`, base doubling 1→30 s, reset only after ≥15 s healthy,
     and also applied after a clean EOF;
   - a map per namespace;
   - typed getters per FR-11, with int→float widening and a rate-limited WARN naming the FQN on any
     other mismatch or an absent key;
   - `OnChange(func(ns, version string))`;
   - the read-key set and coverage tick (`READ_COVERAGE_INTERVAL_S=21600`, re-emitting the
     cumulative set).

   Every constant carries a ≤2-line comment stating it is a fixed invariant (F-07: config cannot
   configure its own channel).
2. Each `config.go` keeps its service-specific API and delegates. The function signatures stay the
   same: `NewWatcher`, `WaitForSnapshot`, `Get*`, `ResolveSecret`, `FactorMap`, `NewSnapshotWatcher`,
   `SetConfig`.
   - trading drops the prefix-delete `:157-173`. A getter looks the key up in each namespace map in
     `NewWatcher` order.
   - trading's untyped getters `:205-243` follow FR-11.
   - marketdata gains `NewSnapshotWatcher(snapshot map[string]*configv1.ConfigValue) *Watcher`, with
     the signature and no-I/O semantics of trading's `config.go:249`. The core also exports
     `ApplyUpdate(ns string, upd *configv1.ConfigSnapshot)`, the same path the stream loop runs for
     each received message, so it fires `OnChange`. Step 20's out-of-package tests drive live
     changes through it.
3. `scripts/check-watcher-copies.sh` (bash 3.2) compares `shasum -a 256` within each declared group
   and exits 1 on drift. The group `go` holds the three `watchcore.go` files. Run it in the
   `config-wiring` CI job, and add the copy paths to that job's `changes` filter.
4. Add the exemption entry to `dry-guard-rail.md`, naming only these files. Add the three paths to
   `.jscpd.json` `ignore`.
5. Add the `loki-literal` rows `config.read_key` and `config.read_coverage` to `produced-signals.tsv`.
   Their producer-path is a comma list of the watcher core files; extend it in Steps 15, 17 and 29.
   Verify that the checker accepts multi-file producer paths (Open Risk 12). The existing `metric`
   rows at `:2` and `:5` already use comma lists; `:3` and `:4` are single paths.
6. **Keepalive spike** (Open Risk 4; moved here from Step 11 instruction 8 by the operator ruling of
   2026-11-06, `context.md` decision 32). Run this step's Go watcher core against the config server
   locally. If `too_many_pings` appears, add `'grpc.keepalive_permit_without_calls': 1,
   'grpc.http2.min_ping_interval_without_data_ms': 20000` to `new grpc.Server(...)`
   (`services/xstockstrat-config/src/index.ts:41`); that edit joins this step's **Files**. Per
   decision 29 the executor may start `dockerd` and one disposable
   `timescale/timescaledb:latest-pg16` container for this spike only. It must `docker rm -f` the
   container afterwards and touch no shared or remote database. Record the outcome, the run and the
   teardown in `context.md` and the Deviation Log.

**Verification**:
```bash
for s in trading portfolio marketdata; do (cd services/xstockstrat-$s && GOWORK=off golangci-lint run --modules-download-mode=mod && GOWORK=off COVERPKGS=$(go list ./... | grep -Ev '/(cmd|handler|repository|telemetry|service)(/|$)' | tr '\n' ',' | sed 's/,$//') && go test ./... -race -count=1 -coverprofile=coverage.out -covermode=atomic -coverpkg="${COVERPKGS}" && go tool cover -func=coverage.out | grep "^total:"); done   # each ≥ 40%
bash scripts/check-watcher-copies.sh && bash scripts/check-otel-produced-signals.sh
```

---

### Step 14 — test: Python watcher core (indicators, ingest, analysis)

**Status**: `done`
**Service**: `xstockstrat-indicators`, `xstockstrat-ingest`, `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-indicators/tests/test_config_watcher.py` — modify
- `services/xstockstrat-ingest/tests/test_config_watcher.py` — modify
- `services/xstockstrat-analysis/tests/test_config_watcher.py` — modify

**Reviewers**: xstockstrat-indicators owner — timeout enforcement; xstockstrat-ingest owner — idempotent ingestion; xstockstrat-analysis owner — determinism

**Codebase Evidence**:
- indicators `app/config/watcher.py`: `_watch` `:70-91` with fixed `await asyncio.sleep(2)` `:91`
  and no sleep on clean EOF; wholesale `self._snapshot = snapshot` `:82`; channel options only
  `mtls.target_override` `:52-54`.
- Fakes to reuse: `services/xstockstrat-ingest/tests/test_config_watcher.py:83-122` (`_Done` `:83`,
  `_FakeStub` `:87`, patched `asyncio.sleep`). Copy the pattern per service. Each file is its own
  consumer, so it stays inline (C-13).

**TDD**: `red-green required`

**Covers**: `AC-10` (indicators), `AC-11, AC-27` (analysis)

**Instructions**:
1. **(AC-10 indicators)** A stream yields a snapshot, then awaits forever. With patched time the
   watcher abandons it after 30 s and redials. `get_int` keeps returning the old value meanwhile, and
   a post-redial value is applied.
2. **(AC-11)** Each fake stream ends cleanly after the snapshot. Over 10 s there are ≤5 opens and the
   recorded sleeps are non-decreasing (today the clean-EOF path sleeps 0).
3. **(AC-27 analysis)** `analysis.opportunity.signal_rank_weight` stored as int 7 → `get_float(...,
   1.5)` = 7.0, no WARN (`caplog`).
4. Mismatch rows: float→`get_int` → default + WARN naming the FQN; absent key → default + WARN.
5. Read-key evidence and coverage-tick lines, as in Step 12 item 7.
6. Channel options include `grpc.keepalive_time_ms=30000`, `grpc.keepalive_timeout_ms=10000` and
   `grpc.keepalive_permit_without_calls=1`.

**Verification**:
```bash
for s in indicators ingest analysis; do (cd services/xstockstrat-$s && uv run pytest tests/test_config_watcher.py -q); done   # RED before Step 15
```
Coverage threshold (C-08): indicators `--cov-fail-under=50`, ingest and analysis `--cov-fail-under=40`,
enforced once green at Step 15.

---

### Step 15 — service: Python watcher core (byte-identical `watch_core.py` ×3)

**Status**: `done`
**Service**: `xstockstrat-indicators`, `xstockstrat-ingest`, `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-indicators/app/config/watch_core.py` — create (byte-identical)
- `services/xstockstrat-ingest/app/config/watch_core.py` — create (byte-identical)
- `services/xstockstrat-analysis/app/config/watch_core.py` — create (byte-identical)
- `services/xstockstrat-indicators/app/config/watcher.py` — modify
- `services/xstockstrat-ingest/app/config/watcher.py` — modify
- `services/xstockstrat-analysis/app/config/watcher.py` — modify
- `scripts/check-watcher-copies.sh` — modify (group `py`)
- `.jscpd.json` — modify
- `docs/patterns/dry-guard-rail.md` — modify
- `packages/otel/produced-signals.tsv` — modify

**Reviewers**: xstockstrat-indicators owner; xstockstrat-ingest owner; xstockstrat-analysis owner

**Codebase Evidence**:
- The three `watcher.py` differ today (md5 `51588393…`, `d015d65f…`, `612179ed…`; lengths 158 / 216 /
  154 lines). The service-specific parts stay in `watcher.py`: indicators `sandbox_*` properties
  `:137-153` and `int_positive` `:155`.
- `app/mtls.py` exists in each service (`channel_credentials`, `target_override` `:36-46` in indicators).

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. `watch_core.py` holds the behavior of Step 13 item 1 in asyncio form:
   - the liveness timeout is `asyncio.wait_for` around each `__anext__` (30 s);
   - backoff equal-jitter 1→30 s, reset after ≥15 s healthy, and applied after a clean EOF;
   - the snapshot is replaced only on receipt, and the last one keeps serving;
   - typed getters FR-11;
   - `on_change(callback)`, called with the version on a version change;
   - the read-key set and coverage tick.

   It imports only `grpc`, the stdlib, `app.mtls` and the generated config stubs, so the bytes are
   identical in every service.
2. `watcher.py` keeps `ConfigWatcher(endpoint, namespace)`, `wait_for_snapshot`, the `get_*`
   signatures and the service-specific helpers, and delegates to the core.
3. Add group `py` to the copy guard. Extend the `.jscpd.json` ignore list, the `dry-guard-rail.md`
   entry and the producer paths in `produced-signals.tsv`.

**Verification**:
```bash
(cd services/xstockstrat-indicators && uv run ruff check . && uv run ruff format --check . && uv run pytest --cov=app --cov-fail-under=50)
for s in ingest analysis; do (cd services/xstockstrat-$s && uv run ruff check . && uv run ruff format --check . && uv run pytest --cov=app --cov-fail-under=40); done
bash scripts/check-watcher-copies.sh && bash scripts/check-otel-produced-signals.sh
```

---

### Step 16 — test: Node watcher core (ledger, identity, notify)

**Status**: `done`
**Service**: `xstockstrat-ledger`, `xstockstrat-identity`, `xstockstrat-notify`
**Files**:
- `services/xstockstrat-ledger/src/__tests__/configWatcher.test.ts` — create
- `services/xstockstrat-identity/src/__tests__/configWatcher.test.ts` — create
- `services/xstockstrat-notify/src/__tests__/configWatcher.test.ts` — create

**Reviewers**: xstockstrat-ledger owner — append-only invariant; xstockstrat-identity owner — JWT expiry; xstockstrat-notify owner — stream delivery guarantees

**Codebase Evidence**:
- `src/services/configWatcher.ts` (ledger 130 lines; the three copies differ, md5 `cebd140b…`,
  `70bd474d…`, `8ebb18bf…`): `ConfigServiceClient` dial `:33`; `on('data')` `:55`; reconnect on
  `error`/`end` `:69-77`; jittered backoff 1→30 s reset on data `:80-93`; getters `:107-125`.
- No `configWatcher` test exists in the three leaf services today (`ls src/__tests__ | grep -i watcher`
  → none).
- Readers: ledger `ledger.export.enabled` `src/grpc/ledgerServiceImpl.ts:378`; notify
  `notify.fanout.min_confidence_threshold` `src/fanout/fanout.ts:64`.

**TDD**: `red-green required`

**Covers**: `AC-10` (ledger), `AC-11, AC-15` (ledger read-key/coverage), `AC-27` (notify)

**Instructions**:
1. Use a fake `ConfigServiceClient` (an EventEmitter stream) and `node:test` mock timers.
2. **(AC-10 ledger)** No message for 30 s → `stream.cancel()` and a redial. Reads keep the last
   snapshot. A post-redial value is applied.
3. **(AC-11)** The stream ends after the snapshot → ≤5 opens in 10 s, delays non-decreasing (today
   the backoff resets on data, so a snapshot-then-EOF server resets it).
4. **(AC-15)** `getBool('ledger.export.enabled', true)` twice → exactly one `config.read_key
   ns=ledger key=ledger.export.enabled` INFO. At the coverage tick, one `config.read_coverage ns=ledger`
   line plus the re-emitted read-key line.
5. **(AC-27 notify)** `notify.fanout.min_confidence_threshold` stored as int 7 → `getFloat(…, 1.5)` =
   7, no WARN.
6. Mismatch and absent → default plus a WARN naming the FQN.
7. Channel options include `grpc.keepalive_time_ms: 30000`, `grpc.keepalive_timeout_ms: 10000` and
   `grpc.keepalive_permit_without_calls: 1`.

**Verification**:
```bash
for s in ledger identity notify; do (cd services/xstockstrat-$s && pnpm run test); done   # RED before Step 17
```
Coverage threshold (C-08): `c8 check-coverage --lines 40` per leaf, enforced once green at Step 17 (CI
declares 40% but does not enforce it — `docs/patterns/ci-overview.md:23`).

---

### Step 17 — service: Node watcher core (byte-identical `configWatcher.ts` ×3)

**Status**: `done`
**Service**: `xstockstrat-ledger`, `xstockstrat-identity`, `xstockstrat-notify`
**Files**:
- `services/xstockstrat-ledger/src/services/configWatcher.ts` — modify (made byte-identical)
- `services/xstockstrat-identity/src/services/configWatcher.ts` — modify (made byte-identical)
- `services/xstockstrat-notify/src/services/configWatcher.ts` — modify (made byte-identical)
- `scripts/check-watcher-copies.sh` — modify (group `node`)
- `.jscpd.json` — modify
- `docs/patterns/dry-guard-rail.md` — modify
- `packages/otel/produced-signals.tsv` — modify

**Reviewers**: xstockstrat-ledger owner; xstockstrat-identity owner; xstockstrat-notify owner

**Codebase Evidence**:
- See Step 16. The constructor takes the client via `mtls.clientCredentials()` /
  `mtls.targetOverride('xstockstrat-config')` (`:33`). `src/mtls.ts` exists in each leaf
  (`dry-guard-rail.md:82`).

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. Rewrite each copy with the Step 13 item 1 behavior. Reset the backoff after ≥15 s healthy instead
   of on data. Keep the public API: `getString`, `getInt`, `getFloat`, `getBool`, `getSnapshot`, the
   events, and `waitForSnapshot` where present.
2. Fold any per-service difference among today's three copies into a constructor option, so the files
   are byte-identical. Record each difference in `context.md`.
3. Add group `node` to the guard. Update `.jscpd.json`, `dry-guard-rail.md` and the producer paths.

**Verification**:
```bash
for s in ledger identity notify; do (cd services/xstockstrat-$s && pnpm run lint && pnpm run test:coverage && pnpm exec c8 check-coverage --lines 40); done
bash scripts/check-watcher-copies.sh && bash scripts/check-otel-produced-signals.sh
```

---

### Step 18 — test: resizable limiters and ComputePool (indicators, ingest, analysis)

**Status**: `done`
**Service**: `xstockstrat-indicators`, `xstockstrat-ingest`, `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-{indicators,ingest,analysis}/tests/test_live_limits.py` — create
- `services/xstockstrat-analysis/tests/test_compute_pool.py` — create

**Reviewers**: xstockstrat-indicators owner — timeout enforcement; xstockstrat-ingest owner; xstockstrat-analysis owner — determinism

**Codebase Evidence**:
- indicators `asyncio.Semaphore(config_watcher.sandbox_max_concurrent())` `app/handlers/servicer.py:107`,
  used `:301`.
- ingest `asyncio.Semaphore(self._cfg.backfill_max_concurrent_jobs)` `servicer.py:323`.
- analysis:
  - semaphores `servicer.py:553`, `:558`, `:564`, `:598`;
  - `ThreadPoolExecutor(max_workers=int_positive(self._cfg, "analysis.compute.max_worker_threads", 4))`
    `:571-572`;
  - executor uses `run_in_executor(self._compute_executor, _core)` `:1798`, `:2310`, `:2481`;
  - screener `compute_executor=self._compute_executor` `:3876` → `app/services/screener.py:80,91,177-179`.
  - Re-verified 2026-11-06 after the second `origin/main-dev` merge (analysis lines moved about +1;
    indicators `:107/:301`, ingest `:323/:767` and screener anchors unchanged).

**TDD**: `red-green required`

**Covers**: `AC-6, AC-23`

**Instructions**:
1. **(AC-6, indicators)** With `indicators.sandbox.max_concurrent`=4, start 4 blocked executions,
   then flip the snapshot to 2 and fire `on_change`. All 4 complete, and afterwards at most 2 run
   concurrently (track a peak counter).
2. **(AC-23, analysis, `@preserve`)** Use `ComputePool(limit_fn=lambda: 4, threads=16)`. Occupy 4
   slots with thread functions that block on an Event. Cancel the awaiting coroutine of one
   (`asyncio.wait_for` timeout): a fifth task does not start until the Event releases that thread.
3. A grep test: no `run_in_executor(self._compute_executor` remains in `app/`.
4. Ingest: the backfill limit resizes on change.

**Verification**:
```bash
for s in indicators ingest analysis; do (cd services/xstockstrat-$s && uv run pytest tests/test_live_limits.py -q); done; (cd services/xstockstrat-analysis && uv run pytest tests/test_compute_pool.py -q)   # RED before Step 19
```
Coverage threshold (C-08): indicators `--cov-fail-under=50`, ingest and analysis `--cov-fail-under=40`,
enforced once green at Step 19.

---

### Step 19 — service: `ResizableLimiter`, `ComputePool`, RLIMIT_NPROC

**Status**: `done`
**Service**: `xstockstrat-indicators`, `xstockstrat-ingest`, `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-indicators/app/config/live_limits.py` — create
- `services/xstockstrat-ingest/app/config/live_limits.py` — create (byte-identical)
- `services/xstockstrat-analysis/app/config/live_limits.py` — create (byte-identical)
- `services/xstockstrat-analysis/app/services/compute_pool.py` — create
- `services/xstockstrat-indicators/app/handlers/servicer.py` — modify
- `services/xstockstrat-indicators/app/services/sandbox.py` — modify
- `services/xstockstrat-ingest/app/handlers/servicer.py` — modify
- `services/xstockstrat-analysis/app/handlers/servicer.py` — modify
- `services/xstockstrat-analysis/app/services/screener.py` — modify
- `services/xstockstrat-analysis/tests/test_config_zero_clamps.py` — modify (`_compute_executor` / semaphore `._value` asserts)
- `services/xstockstrat-analysis/tests/test_backtest_bounds.py` — modify (`run_in_executor(svc._compute_executor, …)` `:239`)
- `services/xstockstrat-analysis/tests/test_analysis_servicer.py` — modify (fake screener `compute_executor=` kwarg `:1185`)
- `services/xstockstrat-indicators/tests/test_execute_formula_concurrency.py` — modify (`_sandbox_sem._value` `:132`)
- `services/xstockstrat-ingest/tests/test_ingest_servicer.py` — modify (`_backfill_sem._value` `:97`, `.locked()` `:750`)
- `scripts/check-watcher-copies.sh` — modify
- `.jscpd.json` — modify
- `docs/patterns/dry-guard-rail.md` — modify

**Reviewers**: xstockstrat-indicators owner — formula sandboxing, timeout enforcement; xstockstrat-ingest owner; xstockstrat-analysis owner — backtest reproducibility

**Codebase Evidence**:
- See Step 18. `RLIMIT_NPROC` derives from `max_concurrent` (`sandbox.py:290`, docstring `:343`,
  `rlimit_nproc = max_concurrent * 16` `:352`).
- Existing tests that use the symbols this step replaces (re-verified 2026-11-05):
  - `tests/test_config_zero_clamps.py:121-127` asserts `svc._component_series_sem._value`,
    `_bars_fetch_sem._value`, `_candidates_sem._value`, `_compute_executor._max_workers == 4`,
    `_readiness_materializer_bars_sem._value`, and calls `_compute_executor.shutdown`;
  - `tests/test_backtest_bounds.py:239` calls `run_in_executor(svc._compute_executor, _blocking)`;
  - `tests/test_analysis_servicer.py:1185` defines a fake screener engine with `compute_executor=None`;
  - indicators `tests/test_execute_formula_concurrency.py:132` asserts `_sandbox_sem._value == 4`;
  - ingest `tests/test_ingest_servicer.py:97` asserts `_backfill_sem._value == 3`, and `:750` asserts
    `_backfill_sem.locked()`.
  Tests that only assign `asyncio.Semaphore` objects to these attributes (for example
  `tests/test_opportunities_latency.py:155-165`) keep working if call sites use only `async with`.
- `tests/test_config_zero_clamps.py:144` asserts `engine._sem._value == 4` on the screener's own
  formula semaphore (`screener.py:86`). That semaphore is not one of the four converted here, so the
  assert is expected to stay unchanged; confirm at execution and record any change in `context.md`.
- All anchors in this step re-verified 2026-11-06 after the second `origin/main-dev` merge.

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. **`ResizableLimiter(limit_fn)`.** `async acquire()` waits while `in_use >= limit_fn()`.
   `release()` and `wake()` notify a Condition. `run_bounded(lim, executor, fn)` releases from the
   future's done-callback: `loop.is_closed() or loop.call_soon_threadsafe(lim.release)`.
2. **indicators.** Replace `:107` and `:301` with the limiter. Release on thread completion. Pass
   `max(limit, in_use)` into the sandbox NPROC computation (`× 16`).
3. **ingest.** Replace `:323`. Leave the per-job chunk semaphore `:767` untouched: it is per-call,
   not startup-bound.
4. **analysis.**
   - Turn the four semaphores into limiters mutated in place. They are shared by reference with
     evaluator, readiness and screener.
   - `ComputePool(limit_fn, threads=16)` wraps a private `ThreadPoolExecutor(16)` and replaces
     `:571-574`.
   - `:1798`, `:2310` and `:2481` call `self._compute.run(_core)`.
   - The screener takes `compute_pool=` instead of `compute_executor=` (`screener.py:80`, `:177-179`).
5. Wire each limiter's `wake` to the watcher `on_change` (Step 15).
6. Add `live_limits.py` to the guard as group `py-limits`.
7. **Existing tests.** Move the tests listed in Codebase Evidence to the new surface without
   weakening what they assert:
   - `._value` / `._max_workers` checks become checks of the limiter's current limit;
   - `run_in_executor(svc._compute_executor, …)` becomes `svc._compute.run(…)`;
   - the fake screener takes `compute_pool=None`;
   - `.locked()` becomes "in use ≥ limit".

   In `test_config_zero_clamps.py`, also build the servicer from a `snapshot_watcher` that holds the
   seeded `analysis.compute.max_worker_threads` (default 4, and a second value such as 2). Assert that
   the real `ComputePool` limit follows it: once at construction, and again after the snapshot changes
   and `on_change` fires (B2 config-key wiring (b)).

**Verification**:
```bash
(cd services/xstockstrat-indicators && uv run ruff check . && uv run ruff format --check . && uv run pytest --cov=app --cov-fail-under=50)
for s in ingest analysis; do (cd services/xstockstrat-$s && uv run ruff check . && uv run ruff format --check . && uv run pytest --cov=app --cov-fail-under=40); done
grep -rn "run_in_executor(self._compute_executor" services/xstockstrat-analysis/app   # expect no output
bash scripts/check-watcher-copies.sh
```

---

### Step 20 — test: marketdata live vendor clients, provider switch, secret rotation

**Status**: `done`
**Service**: `xstockstrat-marketdata`
**Files**:
- `services/xstockstrat-marketdata/cmd/server/main_test.go` — modify (exists; live-config wiring)
- `services/xstockstrat-marketdata/internal/alpaca/client_test.go` — modify
- `services/xstockstrat-marketdata/internal/service/marketdata_service_test.go` — modify (provider per call)

**Reviewers**: xstockstrat-marketdata owner — OHLCV ingestion integrity, Alpaca feed idempotency

**Codebase Evidence**:
- Boot-frozen reads in `cmd/server/main.go`:
  - secrets `:74-90` (`resolveSecret` → `cfg.AlpacaAPIKey`/`AlpacaAPISecret`/`FMPAPIKey`/`FinnhubAPIKey`);
  - Alpaca `ClientConfig` `:93-109` (`RateLimitRPS` `:104`);
  - `fundProvider` `:133`, passed to `NewMarketDataService` `:151`;
  - EDGAR `:143-147`; Finnhub branch `:231-234` (in `newFundamentalsSource` `:229`); FMP client
    `newFMPClient` `:248-261` (`Limits func()` `:256`).
- The Alpaca limiter is built once `internal/alpaca/client.go:72`. FMP live precedent:
  `internal/fmp/fmp_client.go:41,156` (`Limits func()`, `limiter.SetLimit`).
- `s.fundProvider` is read at 11 sites in `internal/service/marketdata_service.go` (re-verified after
  the second 2026-11-06 main-dev merge): `:1740`, `:1783`, `:1809`, `:1826`, `:1840`, `:1854-1855`,
  `:2011`, `:2032`, `:2057`, `:2066`, `:2099`. These are the config keys `"marketdata."+s.fundProvider+…`
  plus the provider switch, the FMP-budget gate, and the quota-alert and source labels. The field is
  declared at `:79` and set once at `:231`.
- Test files present: `cmd/server/main_test.go` (calls `newFundamentalsSource(cfgWatcher, provider,
  newFMPClient(…), apiKey)` `:46-55`), `internal/alpaca/client_test.go`, `stream_test.go`,
  `internal/service/marketdata_service_test.go`.
- Harness: Step 13 added marketdata's `config.NewSnapshotWatcher`
  (`services/xstockstrat-marketdata/internal/config/config.go:131`, mirroring trading's
  `services/xstockstrat-trading/internal/config/config.go:117`) plus the core's `ApplyUpdate`.

**TDD**: `red-green required`

**Covers**: `AC-7, AC-16, AC-32` (rows 1–2)

**Instructions**:
1. **(AC-7)** Build the watcher with marketdata's `config.NewSnapshotWatcher` (added in Step 13) holding
   `marketdata.fundamentals.provider`=`finnhub`. Then switch it to `fmp` with
   `ApplyUpdate("marketdata", …)`, which fires `OnChange`. The next `GetFundamentals` goes through
   the FMP fake. Assert the single `*fmp.Client` is reused (same pointer) and its day budget is not
   reset. Also assert that the per-provider key reads at `:1740` / `:1809` / `:1854` and the
   FMP-budget gate at `:2032` follow the new provider.
2. **(AC-16)** A fake secret resolver returns `k1`, then `k2` after `OnChange`. The next FMP request
   carries `k2`. On resolver failure after 3 tries the old key is kept and a WARN is logged.
3. **(AC-32 row 1)** `marketdata.backfill.rate_limit_rps` 200 → 50: the Alpaca client's limiter
   `Limit()` equals 50 after the next request.
4. **(AC-32 row 2)** `marketdata.edgar.user_agent` `"a/1"` → `"b/2"`: an `httptest` server observes
   `User-Agent: b/2` on the next EDGAR request.

**Verification**:
```bash
cd services/xstockstrat-marketdata && GOWORK=off go test ./... -count=1   # RED before Step 21
```
Coverage threshold (C-08): Go `go-test` 40% over the non-excluded packages, enforced once green at Step 21.

---

### Step 21 — service: marketdata `func() Cfg` closures, live provider, re-resolved secrets

**Status**: `pending`
**Service**: `xstockstrat-marketdata`
**Files**:
- `services/xstockstrat-marketdata/cmd/server/main.go` — modify
- `services/xstockstrat-marketdata/internal/alpaca/client.go` — modify
- `services/xstockstrat-marketdata/internal/edgar/edgar_client.go` — modify
- `services/xstockstrat-marketdata/internal/finnhub/finnhub_client.go` — modify (`NewClient(cfg ClientConfig)` `:39`)
- `services/xstockstrat-marketdata/internal/fmp/fmp_client.go` — modify (base URL / metrics / key accessor)
- `services/xstockstrat-marketdata/internal/service/marketdata_service.go` — modify
- `services/xstockstrat-marketdata/internal/config/config.go` — modify (`ResolveSecret` also sends a fresh `x-trace-id`)
- `services/xstockstrat-marketdata/go.mod` — modify (`github.com/google/uuid` is `// indirect` at `:34` and becomes direct; `GOWORK=off go mod tidy`)

**Reviewers**: xstockstrat-marketdata owner — OHLCV ingestion integrity, Alpaca feed idempotency

**Codebase Evidence**:
- See Step 20. Closure pattern: `ibkrTiming()` `services/xstockstrat-trading/internal/service/trading.go:2502-2516`,
  passed as `Timing: s.ibkrTiming` `:3188`.
- `source.FundamentalsSource` is an interface (`internal/source/source.go:75`).
- All 11 `s.fundProvider` sites are listed in Step 20 (`marketdata_service.go:1740` … `:2099`; field `:79`,
  set `:231`).
- `ResolveSecret` `internal/config/config.go:114-127` replaces the outgoing metadata with only
  `x-internal-caller: marketdata` (`:115-117`). So a trace id on the caller's ctx is dropped today.
  Precedent for minting one: trading `SetConfig` sends `"x-trace-id", uuid.NewString()`
  (`services/xstockstrat-trading/internal/config/config.go:132`).
- Re-verified 2026-11-06 after the second `origin/main-dev` merge.

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. **Alpaca.** Replace `ClientConfig` value fields with `func() alpaca.Settings` (rate limit, feed,
   adjustment, base URLs, stream reconnect parameters). The client calls `limiter.SetLimit` /
   `SetBurst` when the value changes, following the FMP `:149-158` pattern.
2. **EDGAR and Finnhub.** Accessor closures for base URL, user agent and rps.
3. **FMP.** Base URL and metrics become closures. `Limits` is unchanged.
4. **Provider.**
   - `NewMarketDataService` takes `func() string` for the provider, which replaces the
     `fundProvider string` field (`:79`, `:231`).
   - All 11 sites (`:1740`, `:1783`, `:1809`, `:1826`, `:1840`, `:1854-1855`, `:2011`, `:2032`,
     `:2057`, `:2066`, `:2099`) call it per request. Each request or cycle reads it once into a local,
     so a mid-request flip cannot mix providers within one request.
   - `newFundamentalsSource` (`main.go:227-244`, func `:229`) and `newFMPClient` (`:248-261`) build
     both concrete sources once and select per call, keeping the single `*fmp.Client` budget owner.
5. **Secrets.** The four secrets live in mutex cells. On watcher `OnChange` (Step 13), re-resolve
   each with `ResolveSecret` `config.go:114`, retrying 3 times at 1/2/4 s. On failure, keep the old
   value and WARN without logging the value. Clients read the key via an accessor.
   Header propagation (C-03): the re-resolve is a background call with no inbound request. It sends
   `x-internal-caller: marketdata` (unchanged, `config.go:115-117`) plus a fresh `x-trace-id` per
   re-resolve cycle, added inside `ResolveSecret` on the trading `SetConfig` pattern. It sends no
   `x-user-id`.
6. Paper/live: the Alpaca `Paper` flag stays derived exactly as today (`main.go` `:93-109`). There is
   no change to environment → paper derivation.

**Verification**:
```bash
cd services/xstockstrat-marketdata && GOWORK=off golangci-lint run --modules-download-mode=mod && GOWORK=off COVERPKGS=$(go list ./... | grep -Ev '/(cmd|handler|repository|telemetry|service)(/|$)' | tr '\n' ',' | sed 's/,$//') && go test ./... -race -count=1 -coverprofile=coverage.out -covermode=atomic -coverpkg="${COVERPKGS}" && go tool cover -func=coverage.out | grep "^total:"   # ≥ 40%; main.go / service logic is in excluded packages — integration tests in Step 20 are the evidence
```

---

### Step 22 — test: trading broker HTTP timeout is live

**Status**: `pending`
**Service**: `xstockstrat-trading`
**Files**:
- `services/xstockstrat-trading/internal/broker/alpaca_test.go` — modify

**Reviewers**: xstockstrat-trading owner — broker API safety, paper-only dev invariant

**Codebase Evidence**:
- `internal/broker/alpaca.go:42-50` bakes `&http.Client{Timeout: time.Duration(timeoutMs) * time.Millisecond}`
  from `cfg.TimeoutMs` (`:21-27`, `defaultTimeoutMs = 5000`).
- Callers: `trading.go:2495` (`GetFloat`), `:3201` (`GetInt` in `instantiateBrokerLocked` `:3172`),
  `order_intent.go:100`.

**TDD**: `red-green required`

**Covers**: `AC-17`

**Instructions**:
1. Build an Alpaca broker client with a `func() time.Duration` returning 5000 ms, then switch it to
   8000 ms. An `httptest` server sleeping 6 s: the first request fails on its deadline, the second
   succeeds, with the same client instance.
2. Broker coverage: the IBKR path already reads live via `ibkrTiming` (`trading.go:3188`), so it is
   unaffected by this step. Order types, order status and fill handling are unaffected.

**Verification**:
```bash
cd services/xstockstrat-trading && GOWORK=off go test ./internal/broker/... -count=1   # RED before Step 23
```
Coverage threshold (C-08): Go `go-test` 40% over the non-excluded packages, enforced once green at Step 23.

---

### Step 23 — service: per-request broker timeout from one accessor

**Status**: `pending`
**Service**: `xstockstrat-trading`
**Files**:
- `services/xstockstrat-trading/internal/broker/alpaca.go` — modify
- `services/xstockstrat-trading/internal/service/trading.go` — modify
- `services/xstockstrat-trading/internal/service/order_intent.go` — modify

**Reviewers**: xstockstrat-trading owner — order execution correctness, broker API safety

**Codebase Evidence**:
- See Step 22.
- Trading-mode gate: paper/live is derived from environment (root `CLAUDE.md` § Config Governance).
  The broker `Paper` field is untouched by this step.

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. Replace `TimeoutMs int` with `Timeout func() time.Duration` in the Alpaca config. Each request
   wraps its ctx in `context.WithTimeout(ctx, c.cfg.Timeout())`, and `http.Client` has no `Timeout`.
2. Add `func (s *TradingService) brokerTimeout() time.Duration`: `GetInt("trading.broker.timeout_ms",
   5000)`, ≤0 → 5000. Use it at `trading.go:2495`, `:3201` (passed as the func, not a value) and
   `order_intent.go:100`.
3. Broker coverage:
   - ALPACA: handled in this step.
   - IBKR: unaffected, because `IBKRRequestTimeout` is already live via `ibkrTiming`.
   - OFFLINE: unaffected; it has no broker client (`common.proto:72-74`).
   - Order types (`trading.proto:82-89`): MARKET, LIMIT, STOP, STOP_LIMIT and TRAILING_STOP are all
     unaffected. Only the HTTP deadline of the request changes, not its body.
   - Fill states (`trading.proto:91-100`): NEW, PARTIALLY_FILLED, FILLED, CANCELED, EXPIRED, REJECTED
     and PENDING_APPROVAL are unaffected. A timed-out request takes the existing error path.
   - The trading-mode gate is unaffected by this step.

**Verification**:
```bash
cd services/xstockstrat-trading && GOWORK=off golangci-lint run --modules-download-mode=mod && GOWORK=off COVERPKGS=$(go list ./... | grep -Ev '/(cmd|handler|repository|telemetry|service)(/|$)' | tr '\n' ',' | sed 's/,$//') && go test ./... -race -count=1 -coverprofile=coverage.out -covermode=atomic -coverpkg="${COVERPKGS}" && go tool cover -func=coverage.out | grep "^total:"   # ≥ 40%
grep -n "Timeout:" services/xstockstrat-trading/internal/broker/alpaca.go   # expect no http.Client Timeout field
```

---

### Step 24 — test: analysis reads the fundamentals provider each cycle

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/tests/test_fundsignal_loop.py` — modify

**Reviewers**: xstockstrat-analysis owner — strategy scoring determinism

**Codebase Evidence**:
- `app/engine/fundsignal_loop.py:102-110` reads `md_config_watcher.get_str("marketdata.fundamentals.provider", "")`
  once in `__init__`, into `self._fmp_active` / `self._provider_known`.
- The second watcher `app/main.py:49-51` (ns `marketdata`).

**TDD**: `red-green required`

**Covers**: `AC-32` (row 3)

**Instructions**:
1. Build the loop with a snapshot watcher whose provider is `finnhub`, then flip it to `fmp`. The next
   cycle applies the FMP max-symbols cap. Assert via the cycle's symbol-count argument, using the
   existing fakes in this test file.

**Verification**:
```bash
cd services/xstockstrat-analysis && uv run pytest tests/test_fundsignal_loop.py -q   # RED before Step 25
```
Coverage threshold (C-08): analysis `--cov-fail-under=40`, enforced once green at Step 25.

---

### Step 25 — service: per-cycle provider read in `fundsignal_loop.py`

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/app/engine/fundsignal_loop.py` — modify
- `services/xstockstrat-analysis/app/main.py` — modify (comment only)

**Reviewers**: xstockstrat-analysis owner — determinism, no look-ahead bias

**Codebase Evidence**:
- See Step 24. Boot-frozen provider read in `fundsignal_loop.py:102-110`: the comment is at `:102-103`,
  and the `md_config_watcher.get_str("marketdata.fundamentals.provider", "")` read is at `:104-108`.
  It sets `_fmp_active` `:109` and `_provider_known` `:110`.
- `app/main.py:47-48` holds the "Boot-frozen watcher on the marketdata namespace" comment. The
  watcher itself is at `:49-50`. The watcher stays; only the comment changes.

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. Replace the `__init__` capture with a `_provider()` method read at the start of each cycle. Keep
   the `fmp_active` / `provider_known` semantics per cycle.
2. Replace the "boot-frozen" comments at `fundsignal_loop.py:103` and `main.py:47` with the live rule
   (≤2 lines each).

**Verification**:
```bash
cd services/xstockstrat-analysis && uv run ruff check . && uv run ruff format --check . && uv run pytest --cov=app --cov-fail-under=40
```

---

### Step 26 — test: indicators sandbox grace key and remaining-deadline clamp

**Status**: `pending`
**Service**: `xstockstrat-indicators`
**Files**:
- `services/xstockstrat-indicators/tests/test_sandbox_deadline.py` — create

**Reviewers**: xstockstrat-indicators owner — timeout enforcement (`indicators.sandbox.timeout_ms`)

**Codebase Evidence**:
- `SANDBOX_STARTUP_GRACE_MS = 5000` `app/services/sandbox.py:205`;
  `deadline_ms = timeout_ms + SANDBOX_STARTUP_GRACE_MS` `:350`; error text `:394`.
- `timeout_ms = _clamp_override(request.timeout_ms_override, self._cfg.sandbox_timeout_ms)`
  `app/handlers/servicer.py:282`.
- `snapshot_watcher` fixture `tests/conftest.py:163`.

**TDD**: `red-green required`

**Covers**: `AC-38`

**Instructions**:
1. **(AC-38)** Config: `timeout_ms`=15000, `startup_grace_ms`=5000. A fake gRPC context's
   `time_remaining()` returns 8.0. Assert the sandbox is invoked with an effective timeout ≤ 2500 ms
   (8000 − 5000 − 500) and a WARN is logged.
2. With `time_remaining()` = 5.55 (eff < 100): `success=false`, the error names the remaining time,
   and the sandbox spawn function is never called.
3. `time_remaining()` returning `None` (no deadline) → eff = `timeout_ms` (Open Risk 12).
4. A stored `startup_grace_ms` ≤ 0 → 5000 (`int_positive`).

**Verification**:
```bash
cd services/xstockstrat-indicators && uv run pytest tests/test_sandbox_deadline.py -q   # RED before Step 27
```
Coverage threshold (C-08): indicators `--cov-fail-under=50`, enforced once green at Step 27.

---

### Step 27 — service: grace becomes a config key; clamp to remaining deadline

**Status**: `pending`
**Service**: `xstockstrat-indicators`
**Files**:
- `services/xstockstrat-indicators/app/config/watcher.py` — modify (`sandbox_startup_grace_ms`)
- `services/xstockstrat-indicators/app/services/sandbox.py` — modify
- `services/xstockstrat-indicators/app/handlers/servicer.py` — modify
- `services/xstockstrat-indicators/tests/test_sandbox_isolation.py` — modify (imports `SANDBOX_STARTUP_GRACE_MS` `:23`, uses it `:368`)
- `services/xstockstrat-indicators/tests/test_sandbox.py` — modify (`sandbox.SANDBOX_STARTUP_GRACE_MS` `:36`)
- `scripts/config-wiring.json` — modify (one `feature 295` baseline entry until 041 seeds the key)

**Reviewers**: xstockstrat-indicators owner — formula sandboxing, timeout enforcement

**Codebase Evidence**:
- See Step 26. `sandbox_timeout_ms` property `watcher.py:137`; `int_positive` `:155`.
- `SANDBOX_STARTUP_GRACE_MS = 5000` `sandbox.py:205`, used in `deadline_ms = timeout_ms +
  SANDBOX_STARTUP_GRACE_MS` `:350`; timeout error text `:394`. `_clamp_override` call `servicer.py:282`.
- Existing tests that use the constant (re-verified 2026-11-05): `tests/test_sandbox_isolation.py:23`
  (import) and `:368` (`math.ceil((10000 + SANDBOX_STARTUP_GRACE_MS) / 1000) + 2`), and
  `tests/test_sandbox.py:36` (`(5000 + sandbox.SANDBOX_STARTUP_GRACE_MS) / 1000`).
- CI runs `check-config-wiring.mjs --final` (`ci.yml:1033`, `config-wiring` job `:1015-1033`; see Step 4).
  All anchors above re-verified 2026-11-06 after the second `origin/main-dev` merge. So a reader with no seed is a
  blocking `read-unseeded` there, not PENDING.

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. Add `sandbox_startup_grace_ms()` → `int_positive(self, "indicators.sandbox.startup_grace_ms", 5000)`.
2. Remove `SANDBOX_STARTUP_GRACE_MS`. The sandbox runner takes `grace_ms` as a parameter at `:350`.
3. In `ExecuteFormula`, after the limiter acquire (Step 19), compute
   `eff = min(timeout_ms, int(context.time_remaining()*1000) - grace - 500)` when `time_remaining()`
   is not None, else `timeout_ms`.
   - `eff < 100` → return `success=false` with `error="request deadline leaves <N>ms …"`, spawning
     nothing.
   - `eff < timeout_ms` → WARN.
4. The seed for the new key comes from `041` (Step 33). Until then the gate shows PENDING
   `read-unseeded` in step mode. For `--final` (CI), add a `read-unseeded` baseline entry for
   `indicators`/`indicators.sandbox.startup_grace_ms` with owner `feature 295` to
   `scripts/config-wiring.json`. Step 36 drains it.
5. **Existing tests.** Point `test_sandbox_isolation.py:23/:368` and `test_sandbox.py:36` at the
   `grace_ms` parameter, passing 5000 explicitly, so their arithmetic is unchanged.
6. **B2 config-key wiring (b).** Add a test that builds the real `ConfigWatcher` reader from a
   `snapshot_watcher` (`tests/conftest.py:163`) holding the seeded
   `indicators.sandbox.startup_grace_ms` = 5000, and a second value of 2000. Assert that
   `sandbox_startup_grace_ms` returns it and that `ExecuteFormula` passes it to the runner as
   `grace_ms`. It goes in `tests/test_sandbox.py`. Step 26's `tests/test_sandbox_deadline.py` stays
   as written.

**Verification**:
```bash
cd services/xstockstrat-indicators && uv run ruff check . && uv run ruff format --check . && uv run pytest --cov=app --cov-fail-under=50
grep -rn "SANDBOX_STARTUP_GRACE_MS" services/xstockstrat-indicators/app services/xstockstrat-indicators/tests   # expect no output
node scripts/check-config-wiring.mjs --final   # exit 0 with the feature-295 baseline entry
```

---

### Step 28 — test: agent watchers, snapshot policy reads, derived deadline, blocking boot

**Status**: `pending`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/tests/test_config_watcher.py` — create
- `services/xstockstrat-agent/tests/test_formula_deadline.py` — create
- `services/xstockstrat-agent/tests/test_startup_snapshot.py` — create

**Reviewers**: xstockstrat-agent owner — MCP tool contract stability, every stub call has a timeout

**Codebase Evidence**:
- Re-verified after the second 2026-11-06 main-dev merge.
- `get_config_value` `app/client.py:1871` (ephemeral GetConfig). Callers:
  - `app/tools.py:679` (alert threshold, in `ingest_signal` `:620`);
  - `_agent_policy` `:2632-2645` (used `:1729` in `list_opportunities`, and `:2659-2662`);
  - `app/oauth_server.py:84`, `:104`.
- `execute_formula` `client.py:1108`, `timeout=_RPC_TIMEOUT_S` `:1138`; `_RPC_TIMEOUT_S = 10.0`
  `:38`; `_LONG_RPC_TIMEOUT_S = 45.0` `:39`.
- `test_formula` (`tools.py:1640`) error path: `_grpc_error_message(e, deadline_s=client._RPC_TIMEOUT_S)`
  `tools.py:1670`.
- Lifespan `app/main.py:230-232`; stdio `_run_stdio` `:86-89`.
- No watcher today: `app/config/__init__.py` is empty (0 lines).
- The three test files are absent (create).

**TDD**: `red-green required`

**Covers**: `AC-8, AC-10` (agent), `AC-18, AC-31` (deadline leg), `AC-37`

**Instructions**:
1. **(AC-8)** The `agent` snapshot has `signal.alert_threshold` = 0.9. `ingest_signal` applies 0.9,
   and the patched `client.get_config_value` is **not** called.
2. **(AC-10 agent)** Same stall/redial assertion as Step 14, on the agent copy of the core.
3. **(AC-18)** `indicators` snapshot timeout 15000, grace 5000 → `execute_formula` passes
   `timeout=22.0` to the stub. A fake stub sleeping 12 s returns success.
4. **(AC-31 deadline)** timeout 33000, grace 10000 → `timeout=45.0`. A larger stored value is clamped
   to 45.0 with a WARN. Stored ≤ 0 → 5000 (`int_positive`). An override is used only when 0 < override
   < cfg.
5. A deadline error surfaces a message through `_grpc_error_message` with the derived `deadline_s`.
6. **(AC-37)** The `indicators` fake WatchConfig never answers. Lifespan startup raises after
   `wait_for_snapshot(90)` (patched clock), and the app never reports ready.

**Verification**:
```bash
cd services/xstockstrat-agent && uv run pytest tests/test_config_watcher.py tests/test_formula_deadline.py tests/test_startup_snapshot.py -q   # RED before Step 29
```
Coverage threshold (C-08): agent `--cov-fail-under=40`, enforced once green at Step 29.

---

### Step 29 — service: agent lifespan watchers, policy reads from snapshot, derived deadline

**Status**: `pending`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/app/config/watch_core.py` — create (byte-identical to Step 15)
- `services/xstockstrat-agent/app/config/watcher.py` — create
- `services/xstockstrat-agent/app/main.py` — modify
- `services/xstockstrat-agent/app/tools.py` — modify
- `services/xstockstrat-agent/app/oauth_server.py` — modify
- `services/xstockstrat-agent/app/client.py` — modify
- `services/xstockstrat-agent/docs/context-constitution.md` — modify (AGENT-1 scoped amendment)
- `scripts/check-watcher-copies.sh` — modify
- `packages/otel/produced-signals.tsv` — modify

**Reviewers**: xstockstrat-agent owner — MCP tool contract stability, `docs/runbooks/mcp-tools.md` parity, no secret values in tool output

**Codebase Evidence**:
- See Step 28 (line cites re-verified 2026-11-06 after the second main-dev merge: `tools.py:679`, `_agent_policy` `:2632-2645`,
  `test_formula` error path `:1670`). AGENT-1 `services/xstockstrat-agent/docs/context-constitution.md:17`
  (ephemeral per-call channels).

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. Copy `watch_core.py` byte-identically and add it to guard group `py`. `watcher.py` exposes a
   process-wide registry `get_watcher(ns)` for `agent` and `indicators`.
2. **Lifespan.** In HTTP mode, `lifespan` starts both watchers and awaits
   `wait_for_snapshot(90)` on each before `session_manager.run()`; a timeout raises. The stdio path
   (`_run_stdio`) does the same before `run_stdio_async`. Close the watchers on exit.
3. **Policy reads.** `tools.py:679`, `_agent_policy` `:2632-2645` and `oauth_server.py:84`, `:104`
   read from the `agent` watcher with the same keys, defaults and casts. The user-facing `get_config`
   tool keeps `client.get_config_value` (bounded GetConfig).
4. **Deadline.** `execute_formula` gets `deadline_s = min(_LONG_RPC_TIMEOUT_S, (t + g + 2000)/1000)`,
   where `t` and `g` come from the `indicators` watcher with `int_positive` semantics. Log a WARN on
   clamp. `tools.py:1670` (in `test_formula`) passes `deadline_s` to `_grpc_error_message`. No tool name, parameter or
   return shape changes, so `docs/runbooks/mcp-tools.md` needs no edit; confirm this in `context.md`.
5. **AGENT-1.** Add the scoped amendment (≤2 lines in the rule cell): the two lifespan `WatchConfig`
   channels are the only long-lived ones, and every unary RPC stays ephemeral.

**Verification**:
```bash
cd services/xstockstrat-agent && uv run ruff check . && uv run ruff format --check . && uv run pytest --cov=app --cov-fail-under=40
bash scripts/check-watcher-copies.sh && bash scripts/check-otel-produced-signals.sh
grep -n "get_config_value" services/xstockstrat-agent/app/tools.py services/xstockstrat-agent/app/oauth_server.py   # only the get_config tool remains
```

---

### Step 30 — test: UI GetConfig carries the native environment

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/lib/traderBff.test.ts` — create
- `services/xstockstrat-ui/src/lib/insightsBff.test.ts` — modify
- `services/xstockstrat-ui/e2e/mock-backend.ts` — modify (assert `environment` on `getConfig`)

**Reviewers**: xstockstrat-ui owner — environment (`production`/`staging`) scope correctness

**Codebase Evidence**:
- `src/lib/insightsBff.test.ts:1-40`: `vi.mock('@/lib/connectClients', …)`, `dispatchConnect` import,
  and a JWT cookie via `SignJWT`. This is the harness to reuse. Its `configClient` stub (`:17`) defines
  only `{ setConfig }` (the `vi.fn()` at `:6`, reset in `beforeEach` `:34-37`), with no `getConfig`.
- Pass-through today: `traderBff.ts:167`, `insightsBff.ts:171`.
- `nativeConfigEnvironment()` `src/lib/deploymentEnv.ts:13-15` reads `APPLICATION_ENV`.
- Mock `getConfig` `e2e/mock-backend.ts:1511-1536`. Playwright sets `APPLICATION_ENV: 'development'`
  (`playwright.config.ts:163`).

**TDD**: `red-green required`

**Covers**: `AC-9`

**Instructions**:
1. **(AC-9)** Extend the `insightsBff.test.ts` mock: add `const getConfig = vi.fn()` beside `setConfig`,
   put it in the `configClient` stub (`{ setConfig, getConfig }`), and reset it in `beforeEach`.
   `traderBff.test.ts` builds the same mock shape with `getConfig`.
   `process.env.APPLICATION_ENV='production'`. The stubbed `configClient.getConfig`
   returns `platform.trading_state`=`HALTED` only when called with `environment ===
   Environment.PRODUCTION`, else `ACTIVE`. Assert the trader BFF `getConfig` passes `PRODUCTION`.
   Add the same assertion for the insights BFF (namespace `ui`).
2. In `mock-backend.ts` `getConfig`, return a Connect `InvalidArgument` when `req.environment` is
   UNSPECIFIED, so the existing e2e suites (positions, performance) prove every UI GetConfig sets
   it.
3. C-12: the session cookie follows the existing in-file `SignJWT` pattern in `insightsBff.test.ts`
   (a scenario one-off). Config values are inline one-offs, and no new domain fixture is introduced.
   Record this verdict.

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm run test:unit   # RED before Step 31
```
Coverage threshold (C-08): `vitest.config.ts` 40% lines/functions/statements over `src/lib/**`, enforced
by `pnpm run test:coverage` once green at Step 31. `src/lib/*Bff.ts` is excluded from coverage, so
these tests add none.

---

### Step 31 — service: UI BFF getConfig sends `nativeConfigEnvironment()`

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/lib/traderBff.ts` — modify
- `services/xstockstrat-ui/src/lib/insightsBff.ts` — modify

**Reviewers**: xstockstrat-ui owner — environment scope correctness, Connect-RPC call safety

**Codebase Evidence**:
- See Step 30. `forward()` `src/lib/bffShared.ts:61-74` passes `req` to the lambda.
  `nativeConfigEnvironment` is already imported in `insightsBff.ts` (used `:187`).

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. `getConfig: forward((req, opts) => configClient.getConfig({ ...req, environment: nativeConfigEnvironment() }, opts))`
   at both sites. Import `nativeConfigEnvironment` from `@/lib/deploymentEnv` in `traderBff.ts`.
2. The browser callers (`PerformanceDashboard.tsx:75`, `trader/positions/page.tsx:126`) are
   unchanged: the BFF owns the scope.

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm run lint && pnpm run test:unit && pnpm test:e2e e2e/trader/positions-reconciliation.spec.ts e2e/insights/performance.spec.ts
```

---

### Step 32 — test: heal migration assertions and replay legs (041)

**Status**: `pending`
**Service**: `xstockstrat-config`
**Files**:
- `scripts/migration-assertions/config-041.sql` — create
- `scripts/migration-assertions/fixtures-pre-041.sql` — create
- `scripts/migration-rerun.sh` — modify

**Reviewers**: DBA — run-order compliance with `scripts/db-migrate.sh`; xstockstrat-config owner — scoping, secret redaction

**Codebase Evidence**:
- Harness: `scripts/migration-assertions/config-031.sql` (DO-block asserts, `BEGIN`, fixtures, `\ir`
  replay, `ROLLBACK`), picked up by the glob `scripts/migration-rerun.sh:183-190`. `fixtures-*` files
  are skipped by the glob `:186-187`.
- Pass 0 shape `:46-82` (`goto` per schema on a fresh DB); pass 3 dirty-guard `:111-140`.
- Dirty guard `scripts/migration-dirty-guard.sh:38-55` (prints `force $prev`, exit 3).
- Auto `force 0`: `scripts/db-migrate.sh:78-80`.

**TDD**: `red-green required` (RED/GREEN evidence = CI `migration-rerun` job on the draft integration PR; actor: CI)

**Covers**: `AC-3, AC-4, AC-5, AC-14, AC-15` (dead row kept), `AC-24, AC-28, AC-29, AC-33` (heal)

**Instructions**:
1. **Pass 0.** Add a config `goto 40`, then load `fixtures-pre-041.sql`. Fixture rows:
   - staging `analysis`/`fundsignal.enabled`=`true`, allowlisted;
   - staging `analysis`/`backtest.max_duration_seconds`=300 plus `analysis.backtest.max_duration_seconds`=60,
     with the unread row allowlisted;
   - per-user `analysis`/`fundsignal.enabled` for `u-295`, not allowlisted;
   - one unsigned twin;
   - secret `marketdata`/`fmp.api_key` plus non-secret `marketdata.fmp.api_key`;
   - production `platform.trading_state` row deleted;
   - `trading`/`trading.order.max_retries` stored as string `"7"`;
   - a mismatching `default_value`;
   - `ledger`/`stream.notify_enabled` (dead).

   The allowlist sha256 tuples for these fixture rows are part of the test fixture block that
   Step 36 merges into 041's `allow_041`. Mark them `-- fixture` so the dry-run excludes them.
2. **`config-041.sql`** asserts:
   - **(AC-3)** `analysis.fundsignal.enabled` exists at its code default `false`, `fundsignal.enabled`
     is gone, it is present in `config_values_premigration_041`, and the report has
     `stored true, effective false`;
   - **(AC-4)** exactly one row `analysis.backtest.max_duration_seconds`=60, plus a `config_audit` row
     for the deleted `backtest.max_duration_seconds`;
   - **(AC-5)** the `u-295` row is unchanged and reported, with `stored_value` and `effective_value`
     NULL;
   - **(AC-14)** `identity.jwt.access_ttl_seconds` in staging and production has value_type `int`,
     default `900`, a non-empty description, and consuming_service `xstockstrat-identity`;
   - **(AC-15)** `stream.notify_enabled` still exists, with an `unread-no-partner` report row;
   - **(AC-24)** `trading.order.max_retries` is unchanged and reported `signoff-type`;
   - **(AC-29)** no production `platform.trading_state` row, and the report has `readers disagree on
     default`;
   - **(AC-33)** the legacy row exists and is reported `twin-secret-class`, and its value appears in
     no report or snapshot value column;
   - `portfolio.snapshot.interval_minutes` is never seeded (`@feature-264 @AC-5`);
   - served values are unchanged by `default-synced`.
3. **Pass 2 (AC-28).** Insert `analysis`/`backtest.extra_knob`, then run three legs. Each asserts
   that `extra_knob` survives, scoped to the latest `run_at`:
   - (a) latch present: `migrate force 40` + `scripts/db-migrate.sh up` → no delete, no new report or
     audit row;
   - (b) latch row deleted: `force 40` + up → full re-run, `extra_knob` survives;
   - (c) `config_schema_migrations` dirty at 41: `scripts/db-migrate.sh up` fails at migration 001.
     Row counts and `pg_get_functiondef` of the audit functions are unchanged. Then probe
     `to_regclass('config.config_markers')` → `force 40` → up converges.
4. RED: 041 does not exist yet.

**Verification**:
```bash
shellcheck scripts/migration-rerun.sh
ls scripts/migration-assertions/config-041.sql scripts/migration-assertions/fixtures-pre-041.sql
# DB legs: CI `migration-rerun` job on the draft integration PR (RED now, GREEN after Step 33) — record run URL in context.md
```

---

### Step 33 — migration: `041_heal_config_keys_to_reader_catalog`

**Status**: `pending`
**Service**: `xstockstrat-config`
**Files**:
- `services/xstockstrat-config/migrations/041_heal_config_keys_to_reader_catalog.up.sql` — create
- `services/xstockstrat-config/migrations/041_heal_config_keys_to_reader_catalog.down.sql` — create

**Reviewers**: DBA — migration NNN numbering, up+down pair, run-order; xstockstrat-config owner — scoping, secret encryption + redaction

**Codebase Evidence**:
- Heal precedent `services/xstockstrat-config/migrations/031_heal_indicators_sandbox_keys_full_dotted.up.sql:6-72`:
  snapshot table `:6-11`, twin delete `:15-25`, `updated_by='system:config-migration-NNN'`.
- Audit triggers: BEFORE UPDATE audits only a `value_data` change (`017_config_secrets_and_scoping.up.sql:66-79`);
  AFTER INSERT audit `017:81-91`; unique index `config_values_scope_uniq` `017:101-102`.
- Seed row shape `033_ledger_stream_resolve_timeout.up.sql:8-17`.
- `ACTIVE` seed of `platform.trading_state` `011…up.sql:12-23` vs trading's code default `HALTED`
  (`trading.go:3589`, per design).
- `onNotification` payload `{namespace, environment}`: handler
  `services/xstockstrat-config/src/grpc/configServiceImpl.ts:382` (moved there by Step 11), which
  parses `namespace`/`environment` at `:400-403`.
- Highest config migration is `040_config_markers`; `041_*` is absent (create). Re-verified
  2026-11-06 after the second `origin/main-dev` merge.
- One implicit transaction per file (`scripts/db-migrate.sh:41`, no `x-multi-statement`).
- Number `041` is pinned by `context.md` decision 28 (see Step 9 evidence).

**TDD**: `N/A (migration; behavior proven by Step 32 in CI)`

**Covers**: —

**Instructions**:
1. Re-run the Step 9 collision check for `/041_`. **F-01:** 041 stays unmerged and unapplied to any
   shared database (staging, production, `main-dev`) until Step 36 has filled `allow_041` from the G2
   sign-off. The only places it runs before then are the CI `migration-rerun` and
   `config-wiring-stored` jobs and scratch Postgres dry-runs (Steps 32/34/35). The integration PR
   stays draft until Step 36.
2. **Outside the DO block,** only two statements:
   - `CREATE TABLE IF NOT EXISTS config.config_heal_report_041(run_at timestamptz, action text,
     namespace text, key text, environment text, user_id text, stored_value text, effective_value text,
     reason text)`;
   - `CREATE TABLE IF NOT EXISTS config.config_values_premigration_041`, in the 031 shape without
     `value_encrypted`.
3. **One `DO $$ … $$` block**, implementing `design.md` §1 steps 1–10 in order:
   1. Latch: `IF EXISTS (… action='latch') THEN RETURN;`.
   2. Temp tables `catalog_041` and `allow_041` (`ON COMMIT DROP`), filled from generated VALUES
      blocks. Emit the catalog with `node scripts/check-config-wiring.mjs --emit-heal-data …`. Leave
      `allow_041` **empty** until Step 36.
   3. Snapshot; secret-class twins get NULL `value_data` (S-2).
   4. Classify secret-class first (S-1). int∪float are normalised for disagreement.
   5. Seed agreeing, non-secret catalog keys × {staging, production}, global, `ON CONFLICT DO NOTHING`.
   6. Twin delete: predicate ∩ `allow_041`, with `COALESCE(cat_alt.is_secret,false)=false` (M-4) and
      a prefix match by `left(b.key,len)=c.key`. It is done as `WITH d AS (DELETE … RETURNING), a AS
      (INSERT INTO config.config_audit …)`, followed by `twin-deleted` report rows.
   7. Report rows `twin-kept-unsigned`, `per-user-unread`, `secret-unread`, and `unread-no-partner`
      for every dead row (M-8). Values are NULL for secret/secret-class/per-user rows (S-1, M-7).
   8. Retype only where the canonical text equals the code default, using the patterns in
      `design.md` §1 step 6, plus an explicit audit row. Everything else is reported `signoff-type`.
   9. Metadata fill where NULL or empty (`IS DISTINCT FROM`, skipping secrets). Sync `default_value`
      to the agreed code default, with an audit reason prefix `metadata:` (M-9) and a
      `default-synced` row. Readers-disagree keys keep their default.
   10. Out-of-bounds report (CASE-guarded numerics) for the three bounded keys.
   11. `pg_notify('config_changed', json_build_object('namespace',ns,'environment',env)::text)` once
       per touched (ns, env).
   12. Latch row.

   Use guarded casts everywhere, and never `RAISE EXCEPTION` for out-of-model rows. Set
   `updated_by='system:config-migration-041'`.
4. **Down:**
   - re-insert the latest run's `twin-deleted` rows from the snapshot, `ON CONFLICT DO NOTHING`;
   - delete the latch row;
   - keep both tables, the seeds and the retypes.

   Header comment (≤2 lines) states the constraint. There is no `-- contract-of`.
5. Grep guard: the file contains no `INSERT INTO config.config_markers`.

**Verification**:
```bash
ls services/xstockstrat-config/migrations/041_*.up.sql services/xstockstrat-config/migrations/041_*.down.sql
grep -c "DO \$\$" services/xstockstrat-config/migrations/041_heal_config_keys_to_reader_catalog.up.sql   # expect 1
grep -n "config_markers\|RAISE EXCEPTION\|value_encrypted" services/xstockstrat-config/migrations/041_heal_config_keys_to_reader_catalog.up.sql   # expect no INSERT into markers, no RAISE, no value_encrypted
# then read up + down: every twin-deleted row restored by the down; latch removed; tables kept
```

---

### Step 34 — service: `config-heal-dryrun.sh` (fresh + staging) and CI fresh dry-run

**Status**: `pending`
**Service**: repo tooling (`scripts/`, `.github/workflows/ci.yml`)
**Files**:
- `scripts/config-heal-dryrun.sh` — create
- `scripts/config-heal/dryrun-fresh.tsv` — create (generated)
- `.github/workflows/ci.yml` — modify (`config-wiring-stored` job runs `--fresh` and diffs)

**Reviewers**: DBA — run-order compliance; xstockstrat-config owner — secret redaction

**Codebase Evidence**:
- Job shape from Step 4 (`config-wiring-stored`). `migrate goto` usage `scripts/migration-rerun.sh:72-82`.
- Inventory format: Step 2.

**TDD**: `red-green required` (the CI job is the test: `--fresh` output diffed against the committed TSV)

**Covers**: —

**Instructions**:
1. **`--fresh`:**
   1. create a scratch DB;
   2. config `migrate goto 40` (rendered);
   3. write the inventory through the Step 2 SQL;
   4. apply the real 041;
   5. dump `config_heal_report_041` plus the touched rows to `scripts/config-heal/dryrun-fresh.tsv`;
   6. drop the DB.
2. **`--staging <inventory.jsonl> [--reveal <reveal.jsonl>]`:**
   1. scratch DB at 40, then delete all `config_values` rows;
   2. load each inventory row, with the value taken from the first that applies:
      - revealed plaintext;
      - the code default when the hash matches;
      - `__sha256:<h>`, or `__secret_class__` for null hashes;
      - for an unrevealed bounded key, a synthesized in-bounds value ≠ default;
   3. run the real 041 and dump `dryrun-staging.tsv`;
   4. **exit 1 if any `twin-deleted`, `retyped` or `default-synced` decision touched a sentinel or
      synthesized row.**
3. Exclude `-- fixture` allowlist tuples (Step 32). The output never contains secret values. The
   script is bash 3.2-safe and never prints the URL.
4. In CI: `config-wiring-stored` runs `--fresh` and fails on `git diff --exit-code
   scripts/config-heal/dryrun-fresh.tsv`.

**Verification**:
```bash
shellcheck scripts/config-heal-dryrun.sh
grep -n "config-heal-dryrun.sh --fresh" .github/workflows/ci.yml
# DB run: CI `config-wiring-stored` job (actor: CI) — record run URL in context.md
```

---

### Step 35 — docs: G2 — reveal, dry-runs, operator sign-off (the only veto)

**Status**: `pending`
**Service**: `scripts/config-heal/`
**Files**:
- `scripts/config-heal/reveal-request.json` — create
- `scripts/config-heal/dryrun-staging.tsv` — create
- `scripts/config-heal/signoff.md` — create

**Reviewers**: none (operator gate)

**Codebase Evidence**:
- `design.md` § Operator gates (G2) and §2 "Emit and sign".

**TDD**: `N/A (operator gate)`

**Covers**: —

**Instructions**:
1. Generate `reveal-request.json` from Step 6's triage. It lists only global, non-secret,
   non-secret-class rows whose decision depends on content (twin candidates, signoff-type).
2. **Actor: operator.** Run `config_inventory --reveal` on the staging console, commit the output,
   then run `scripts/config-heal-dryrun.sh --staging …` on a machine with Docker. Take the fresh
   dry-run from CI (Step 34).
3. The operator reviews `twin-deleted`, `retyped`, `default-synced`, `signoff-type` and
   `twin-secret-class` in both TSVs, plus the discarded staging intents listed in `context.md`
   (Evidence base).
4. `signoff.md` records per inventory: tool sha256, inventory digest, dry-run sha256, allowlist-block
   sha256, operator, date. Mirror it in `context.md`. A re-sign may only remove tuples.

**Verification**:
```bash
grep -c "operator:" scripts/config-heal/signoff.md   # ≥ 2 (staging, fresh)
shasum -a 256 scripts/config-heal/dryrun-staging.tsv scripts/config-heal/dryrun-fresh.tsv   # equal the signed digests
```

---

### Step 36 — config: emit the signed allowlist, regenerate stored JSON, drain the baseline

**Status**: `pending`
**Service**: `xstockstrat-config` + repo tooling
**Files**:
- `services/xstockstrat-config/migrations/041_heal_config_keys_to_reader_catalog.up.sql` — modify (unapplied, still on the feature branch; F-01 not yet engaged)
- `scripts/config-wiring-stored.json` — modify (regenerated)
- `scripts/config-wiring.json` — modify (baseline end state, `policy.envReadUnseeded: "blocking"`)
- `scripts/config-heal/dryrun-fresh.tsv` — modify (regenerated if the allowlist changed it)

**Reviewers**: xstockstrat-config owner — config key naming and scoping; DBA — migration content

**Codebase Evidence**:
- `policy.envReadUnseeded` default `'reported'` `scripts/check-config-wiring.mjs:179`; `isReported`
  helper `:686`; `export function ratchet` `:691-705`; `OWNER_RE` `:169` (re-checked 2026-11-06).
- The baseline currently has 130 entries: 124 owned by `feature 278` (`fails.md` 2026-11-04
  enforce-config-key-wiring) and 6 owned by `feature 295` (Steps 4 and 27). `policy.envReadUnseeded`
  is still `reported`. `041_heal_config_keys_to_reader_catalog.up.sql` does not exist yet; Step 33
  creates it before this step modifies it.
- Merge-order precondition (`context.md` decision 28, `merge-order.md:100-103`): pinned order 282
  (`038`/`039`) → 295 (`040`/`041`) → 291 (`042`) → 293 (`043`). `035`/`036` (open PR #1359) are
  unusable. Re-checked 2026-11-06: 282 merged (`0ea9b5c5`), so `038_marketdata_asset_refresh_interval`
  and `039_portfolio_servability_timeout` are on `origin/main-dev`, and `039` is the highest config
  migration there. No origin ref holds a `040` or `041` config migration. The precondition is already
  met; instruction 4 re-confirms it before the integration PR.
- Re-sign rule (`design.md` §2 "Emit and sign"): a re-sign may only remove tuples (monotone shrink).

**TDD**: `N/A (config data)`

**Covers**: `AC-19` (end state)

**Instructions**:
1. Replace `allow_041` with the block from `check-config-wiring.mjs --emit-heal-data --inventory
   scripts/config-heal/inventory-staging.jsonl --inventory <fresh>`. Its sha256 must equal
   `signoff.md`'s allowlist-block sha256. Keep the `-- fixture` tuples from Step 32 in a separate,
   marked VALUES block. Wrap the signed block in `-- allow_041:begin` / `-- allow_041:end` marker
   lines, so the re-sign check below can extract it.
2. Regenerate `config-wiring-stored.json` (CI artifact or local Docker).
3. Drain the baseline. It ends holding only `seeded-unread` entries owned by `feature 296`, each with
   (ns, key) present as `unread-no-partner` in `dryrun-fresh.tsv`. Every `feature 295` and 278-era
   entry is removed. Set `policy.envReadUnseeded: "blocking"`.
4. Re-confirm the merge-order precondition, met as of 2026-11-06: the highest config migration on
   `origin/main-dev` is still `039` (282's `038`/`039`). Re-run the `/040_` and `/041_` collision
   checks. If the base differs, take max+1 exactly (decision 28) and log it in the Deviation Log. A renumber also changes
   AC-28 and the recovery commands `force <marker>` / `force <marker−1>`.
5. **Re-sign is monotone (machine check).** When an earlier pushed commit already carries a non-empty
   `allow_041` block, the new block's tuple set must be a subset of it. The Verification command
   enforces this.

**Verification**:
```bash
node scripts/check-config-wiring.mjs --final   # exit 0; every baseline entry seeded-unread / feature 296
node -e "const j=require('./scripts/config-wiring.json');const bad=j.findings.filter(e=>e.kind!=='seeded-unread'||e.owner!=='feature 296');if(bad.length||j.policy.envReadUnseeded!=='blocking'){console.error(bad);process.exit(1)}"
node --test scripts/config-wiring.test.mjs
# re-sign may only remove tuples: new allow_041 block ⊆ the last pushed one (vacuous on first sign)
F=services/xstockstrat-config/migrations/041_heal_config_keys_to_reader_catalog.up.sql
blk() { sed -n '/-- allow_041:begin/,/-- allow_041:end/p' | grep -E '^[[:space:]]*\(' | sed -E 's/^[[:space:]]+//; s/[[:space:],;]+$//' | sort -u; }
P=$(mktemp); C=$(mktemp); git show "origin/feature/fix-config-keys-drift:$F" 2>/dev/null | blk > "$P"; blk < "$F" > "$C"
[ ! -s "$P" ] || [ -z "$(comm -13 "$P" "$C")" ] || { echo "re-sign added tuples:"; comm -13 "$P" "$C"; exit 1; }
```

---

### Step 37 — test: doc-convention check (AC-20) and SDD contract rule (AC-13)

**Status**: `pending`
**Service**: repo tooling (`scripts/`)
**Files**:
- `scripts/config-wiring.test.mjs` — modify

**Reviewers**: none (docs-gate test)

**Codebase Evidence**:
- 278's `skill 3` case already asserts skill text (`scripts/config-wiring.test.mjs`).
- Product-spec criterion 6 today: `.claude/skills/sdd-review/reference/product-spec-criteria.md:25`
  ("Any config key listed that does not follow `<service>.<category>.<key>` format").
- CONFIG-9 `services/xstockstrat-config/docs/context-constitution.md:26` (re-verified 2026-11-05) no
  longer says "NO fixed convention". It now says readers use "the FULL-DOTTED key for every non-secret
  key", and it does not contain the 295 rule sentences. Under `docs/sdd/`, `docs/patterns/`,
  `services/*/docs/` and `CLAUDE.md`, "NO fixed convention" appears nowhere. It survives only in
  `docs/reports/2026-11-04-config-key-drift-and-subscription-gaps-defect.md:87` and in this feature's
  own `implementation-spec.md`, which are point-in-time records and out of scope for the check.
- The unseeded-waiver phrase is present today (re-verified 2026-11-06; +18 from 282's registered-key
  log rows): `docs/patterns/config-governance.md:204`, `:215`, `:229` ("Seeding waiver (227 D2
  precedent)") and `:246` ("D2 seeding waiver").
- C-05 row: `docs/sdd/constitution.md:36` (C-05).

**TDD**: `red-green required`

**Covers**: `AC-13, AC-20`

**Instructions**:
1. **(AC-20)** `--doc-check` asserts that C-05 (`docs/sdd/constitution.md`), CONFIG-9 and
   `docs/patterns/config-governance.md` each contain the rule sentence "the stored key equals the
   reader's exact spelling" and "every read key is seeded". None may contain "NO fixed convention"
   or an unseeded-waiver phrase (`227`). The RED half comes from the positive-phrase assertions on
   all three docs and from the waiver phrase still present in `config-governance.md`. The "NO fixed
   convention" leg is already green and stays as a regression guard. The check reads only those three
   files, never `docs/reports/` or `docs/roadmap/features/`.
2. **(AC-13)** `product-spec-criteria.md` criterion 6 names the full contract (namespace, key,
   `value_type`, code default, reader `path:symbol`, seed migration, live mechanism) and states that
   a key listed without it fails. Assert the same contract phrase in `.claude/skills/sdd-story/SKILL.md`,
   `.claude/skills/sdd-spec/reference/spec-template.md`, `.claude/skills/sdd-review/reference/impl-spec-criteria.md`
   (B2), `.claude/skills/sdd-execute/reference/repo-conventions.md`,
   `.claude/agents/spec-reviewer.md` and `.claude/agents/codebase-discovery.md`.
3. Both fail on today's docs (RED).

**Verification**:
```bash
node --test scripts/config-wiring.test.mjs   # RED before Step 38
```
Coverage threshold (C-08): none. `scripts/` tooling has no CI coverage gate (`docs/patterns/ci-overview.md`).

---

### Step 38 — docs: FR-14 convention, FR-15 skills, runbook, merge order, teardown

**Status**: `pending`
**Service**: `docs/`, `.claude/`, service `CLAUDE.md`s
**Files**:
- `scripts/check-config-wiring.mjs` — modify (`--doc-check` mode; run in the `config-wiring` CI job)
- `.github/workflows/ci.yml` — modify (add `--doc-check`; filter covers the checked docs)
- `docs/sdd/constitution.md` — modify (C-05)
- `services/xstockstrat-config/docs/context-constitution.md` — modify (CONFIG-9)
- `docs/patterns/config-governance.md` — modify
- `docs/runbooks/config-rollout.md` — modify
- `CLAUDE.md` — modify (§ Config Governance Rules)
- `services/xstockstrat-*/CLAUDE.md` — modify (each config table)
- `.claude/skills/sdd-story/SKILL.md`, `.claude/skills/sdd-spec/reference/spec-template.md`, `.claude/skills/sdd-review/reference/product-spec-criteria.md`, `.claude/skills/sdd-review/reference/impl-spec-criteria.md`, `.claude/skills/sdd-execute/reference/repo-conventions.md`, `.claude/agents/spec-reviewer.md`, `.claude/agents/codebase-discovery.md` — modify

**Reviewers**: none (docs)

**Codebase Evidence**:
- See Step 37. Merge-order rows (re-verified 2026-11-05) `docs/roadmap/features/merge-order.md:25`
  (295 after 243; satisfied, 243 Step 5 closed by `3aedb964` #1446) and `:26`. Row `:26` already
  anchors 296's `-- contract-of:` on 295's `040_config_markers`.
- Pinned config-migration order (`context.md` decision 28): rows `:100-103` already record 282
  (`038`/`039`) → 295 (`040`/`041`) → 291 (`042`) → 293 (`043`), and that `035`/`036` (PR #1359) are
  unusable. 282 merged into `main-dev` (`0ea9b5c5`), so 295's wait on 282 is already satisfied and
  needs no new row.
- Root `CLAUDE.md` no longer has a § Teardown section: `main-dev` commit `6652cd44` (#1458) removed
  the context-forge teardown.
- "NO fixed convention" survives only in `docs/reports/2026-11-04-config-key-drift-and-subscription-gaps-defect.md:87`
  (a point-in-time defect record) and in this feature's `implementation-spec.md`. Neither is a
  convention doc.
- 12 service `CLAUDE.md` files (`ls services/*/CLAUDE.md | wc -l` → 12).

**TDD**: `red-green required` (for `--doc-check`); docs otherwise

**Covers**: —

**Instructions**:
1. Implement `--doc-check` per Step 37 and wire it into the `config-wiring` CI job.
2. **C-05, CONFIG-9, `config-governance.md`, root `CLAUDE.md` and each service `CLAUDE.md` config
   table** state one rule: the stored key equals the reader's exact spelling, and every read key is
   seeded. Declare namespace-relative as the target form, with the cutover in feature 296. Retire
   the feature-227 waiver text.
3. **`config-rollout.md`** adds:
   - the post-deploy per-key per-environment read-back;
   - the inventory procedure (Steps 2/5);
   - the dirty-041 recovery runbook. Its precondition is that 041 is config's highest up-file
     (`ls`). Probe `to_regclass('config.config_markers')` and the latch, then run `migrate … force 40`
     (or `force 39` when the marker table is absent), never `db-migrate.sh force`, then
     `scripts/db-migrate.sh up`.

   It also documents the restart→live platform guarantee.
4. **Skills and agents** require the full config-key contract (Step 37 phrase). The `/sdd-spec`
   template states that a config-key step pairs a seed migration.
5. **`merge-order.md`: no edit.** 282 has merged, so 295's wait on it is satisfied, and rows
   `:100-103` already pin the order. Do not add a 295 → 282 row, and do not reintroduce `035`–`037`
   as prerequisites. Row `:26` already anchors on `040_config_markers`; leave it unchanged.

**Verification**:
```bash
node --test scripts/config-wiring.test.mjs && node scripts/check-config-wiring.mjs --doc-check
grep -rn "NO fixed convention" docs/sdd/ docs/patterns/ docs/runbooks/ services/*/docs/ services/*/CLAUDE.md CLAUDE.md   # expect no output (docs/reports/ and docs/roadmap/features/ are historical records)
grep -n "040_config_markers" docs/roadmap/features/merge-order.md
```

---

### Step 39 — docs: A12 integration, staging verification, G3

**Status**: `pending`
**Service**: integration (all)
**Files**:
- `docs/roadmap/features/295-fix-config-keys-drift/context.md` — modify (evidence)

**Reviewers**: none

**Codebase Evidence**:
- PRE_DEPLOY db-migrator (`.do/app.yaml:668-671`, recon R1). Staging OTel on (`.do/app.dev.yaml:32-33`).
- Verify per key per environment by read-back, never by row count (`fails.md:2335`, 277 lesson).

**TDD**: `N/A (verification)`

**Covers**: —

**Instructions**:
1. **Actor: CI.** The full CI on the integration PR is green, including `migration-rerun`,
   `config-wiring`, `config-wiring-stored` and every service matrix.
2. **Actor: operator**, after the `main-dev` merge deploys staging:
   - read back every touched key per environment through the agent MCP (`list_config_keys` /
     `get_config`) against `dryrun-staging.tsv`;
   - run `config_inventory --report`;
   - repeat reproduction steps 1–4 of the product spec (fundsignal, trading_state banner in staging,
     the 15000 sandbox timeout via `test_formula`, a marketdata knob);
   - after one day, check the zero-hit `config.read_key` tripwire in staging Loki for every
     twin-deleted spelling (Open Risk 1).
3. **G3 (informational).** At production's first deploy, run `config_inventory --report`, diff it
   against `dryrun-fresh.tsv`, and read back via the agent MCP.
4. C-16 promotion of the scenarios into the service suites happens in the `/sdd-execute` integration
   PR.

**Verification**:
```bash
grep -n "staging read-back\|G3" docs/roadmap/features/295-fix-config-keys-drift/context.md
```

---

## Deviation Log

_Populated by /sdd-execute as implementation proceeds._

- **2026-11-06 — Step 2, scope expansion (operator Option A).** Step 1's
  `tests/test_config_inventory.py` failed `ruff check .` (I001) once the module existed:
  `import app.maintenance.config_inventory as ci` sat above `import pytest`. The operator approved
  `ruff check --fix` on it, a lint-only reorder with no assertion change, committed with Step 2.
- **2026-11-06 — Step 2, secret-row columns.** Instruction 2 lists `value_data` and `default_value`
  as bare columns, and instruction 4 lists `default_sha256` without a qualifier. The tool selects
  both as `CASE WHEN is_secret THEN NULL ELSE … END`, and it nulls `default_sha256` (like
  `value_sha256`) for secret and secret-class rows. This is the stricter reading of AC-22: a hash of
  secret material is never emitted, and a secret value never reaches Python.
- **2026-11-06 — Steps 3+4, unplanned fold (operator-approved, Round 1 Option B).**
  **Disposition**: folded Step 4 into Step 3. Trigger: Step 3's rewritten 278 cases and new gate
  cases cannot pass their own Verification until Step 4's gate exists. The two steps ran as one atomic
  unit with one red→green cycle and one commit, and both are marked done in that commit. The staged
  Files are the union of both steps plus every `scripts/config-wiring-fixtures/**` file.
- **2026-11-06 — Steps 3+4, 278 seed tests retired with the tokenizer stored-set model
  (operator-approved).** Seed tests 1 and 6 were recast onto `declaredFromMigration` and
  `splitStatements`, keeping fixtures `seed/bare-insert` and `seed/multi-row`. Seed tests 2, 3, 4, 5,
  7, 8 and 9 were deleted along with their fixtures (`heal-029`, `heal-031`, `key-neutral`,
  `literal-delete`, `rename-017`, `scope-and-secret`, `unmodelled`), because the UPDATE/DELETE modelling
  they tested no longer exists. Each join root and each ratchet tree gained a
  `scripts/config-wiring-stored.json`. Its rows were generated from the retired tokenizer's output
  before the tokenizer was removed, so every join and ratchet test keeps its expected lines. Join
  roots also gained a `scripts/config-wiring.json` that registers one receiver per reader. `stage()`
  merges the trees' rows, stamps them with `storedInputsSha256`, and registers the ratchet trees'
  receivers. The read-unseeded entries in `ratchet/stale-in-part` now carry `namespace: "ingest"`.
- **2026-11-06 — Step 4, receivers contract (operator-approved, Rounds 1–2).**
  `registry.receivers["<service file>:<receiver expr>"]` is either one namespace or a list of
  namespaces. For a list, the key's `<ns>.` prefix chooses the namespace, and there is no default.
  - The receiver is the object expression before `.getX(` (whitespace removed, leading `!` dropped),
    `<expr>.values` for an index or `values.get` read, and the callee name for a bare function or
    forwarder call.
  - `trading.go:s.cfgW` maps to `["trading","platform"]`. The other 45 receivers each map to one
    namespace. That is the key prefix the receiver reads, except for the agent receivers (`agent`) and
    `ui/src/lib/performanceMetrics.ts:values` (`ui`), whose keys are namespace-relative.
  - An attributed `read-unseeded` finding carries the reader's namespace. Its line format is
    unchanged (`file:key:kind`).
- **2026-11-06 — Step 4, stored JSON shape.** Each row carries the nine fields from instruction 1
  plus `file`, which is the migration that inserted the row. The generator tracks this by applying
  migrations one at a time (`migrate up 1`). It keeps the "names the seeding migration" line format
  of `seeded-unread` and `form-mismatch`. A row without `file` is reported against
  `scripts/config-wiring-stored.json`. Secret rows have `default_value` nulled, and `value_data` is
  never selected.
  - `inputs_sha256` is the sha256 of a manifest with one `<sha256>  <path>` line per input file
    (config `migrations/**` plus the generator), in `LC_ALL=C` path order. The bash and JS
    implementations agreed on the real tree.
- **2026-11-06 — Step 4, throwaway database (operator-approved, Round 2 on decision-29 terms).**
  `dockerd` was started, and one local `timescale/timescaledb:latest-pg16` container ran on
  `127.0.0.1:55432`. The generator ran 4 times against it, not once:
  1. the initial generation;
  2. a determinism re-run, which was byte-identical;
  3. a re-run after row `file` attribution changed from "last migration that changed the row" to
     "inserting migration", because 017's environment rewrite stamped most rows with `017`;
  4. a determinism re-run of that, which was byte-identical.

  Every run used a scratch database that the script dropped. The container was then removed with
  `docker rm -f`. No other database was touched.
  - Later, the generator's two-line header comment was edited (comment cap). That changed only
    `inputs_sha256`, which was recomputed with `storedInputsSha256`. The rows came from the fourth
    run.
- **2026-11-06 — Step 4, kind semantics (spec silent; interpretations).**
  - **Catalog-read rows:** rows read directly by an attributed reader, or the exact
    `scripts/config-heal/catalog.tsv` keys once that file exists.
  - **`metadata-missing`:** an empty `description` **or** an empty `consuming_service`.
  - **`type-mismatch`:** the getter arm comes from the getter or forwarder name (int, float, bool or
    str). A null `value_type` or an unknown arm is skipped.
  - **`default-mismatch`:** literal defaults only. Numbers are compared numerically and bools
    case-insensitively. A null stored `default_value` is skipped.
  - **`readers-disagree`:** at least two distinct literal defaults among the readers. It is reported
    only, never baselined, and it suppresses `default-mismatch`.
  - **Secret rows:** both spellings of a secret row are excluded from `read-unseeded`, as are catalog
    prefix and secret entries (M-3).
  - **`unattributed`:** unless baselined, it gates under `--final`, and at step time whenever any
    key is declared (the same rule as `dynamic-read`).
- **2026-11-06 — Step 4, modes (spec silent; operator-approved interpretations).**
  - `--inventory <jsonl>` joins each inventory as its own stored set. It prints
    `REPORTED: inventory <file>: …` lines, which never change the exit code.
  - `--emit-heal-data` reads `catalog.tsv` in Step 6's column order, with a header row. It exits 2 if
    the file is missing or any description is empty.
    - It prints `-- catalog_041:begin/end` and `-- allow_041:begin/end` blocks.
    - An allow tuple is an inventory row that is global, non-secret and hashed, whose `(ns, key)`
      matches no catalog entry, and whose other spelling is an exact catalog key.
    - An empty block is emitted as `SELECT NULL::text … WHERE false`.
  - `--final` adds two checks:
    - `STALE-STORED`, for an `inputs_sha256` mismatch. The message names
      `bash scripts/config-wiring-stored.sh`.
    - `NOT-IN-DRYRUN`, for a feature-296 `seeded-unread` entry. `dryrun-fresh.tsv` is read by its
      header columns `action`/`namespace`/`key`. The check is vacuous today.
  - The tokenizer stored set (`buildStoredSet`, `applyUpdate`, `applyDelete`, `rewriteAllow`,
    `unmodelled-rewrite`) is gone. `splitStatements`, `applyInsert` and `classify` remain for
    `--declared-migration`.
- **2026-11-06 — Step 4, baseline and CI.**
  - The baseline went from 124 to 130 entries:
    - 100 `read-unseeded` entries gained their reader namespace, and their owners are unchanged;
    - 6 new `default-mismatch` entries are owned by `feature 295`: `analysis.opportunity.live_enrich_ttl_seconds`,
      `platform.trading_state`, `trading.approval.require_above_notional`,
      `trading.approval.require_above_qty`, `trading.risk.bracket_orders_enabled` and
      `trading.risk.max_position_pct`. Their production and staging seed defaults differ, or differ
      from the code literal.
  - `marketdata.fundamentals.provider` is `readers-disagree`, which is reported only.
  - Beyond instruction 8, the `config-wiring` path filter also lists `scripts/config-wiring-stored.json`
    and `scripts/config-wiring-stored.sh`, because the gate reads the first and hashes the second.
- **2026-11-06 — Step 6, catalog scope (spec silent).**
  - `catalog.tsv` has 195 rows: the 189 extractor-attributed read keys, plus
    `indicators.sandbox.startup_grace_ms` (its reader lands at Step 27), the four marketdata
    `GetSecret` keys (`alpaca.api_key`, `alpaca.api_secret`, `fmp.api_key`, `finnhub.api_key`,
    `is_secret=true`), and the ingest per-user secret prefix `mcp_credential.` (`match=prefix`,
    `is_secret=true`). The extractor cannot see `GetSecret` reads, and without these rows 036
    cannot mark those spellings secret-class.
  - The rendered table under `## Config Key Contract` leaves out the description column. Each
    description lives only in the TSV.
  - Code defaults without a literal at the read site come from the named constant in the reader's
    file (for example `_BACKTEST_MAX_DURATION_DEFAULT_S = 300`). `trading.broker.paper` has no
    literal, so its `code_default` is empty (see the defect below).
- **2026-11-06 — Step 6, triage classification (spec silent).**
  - The staging-inventory `metadata-missing` rows are classified `default-synced/mismatch`, because
    036 step 7 fills the metadata.
  - `platform.trading_state` is classified `readers-disagree`, per `design.md` § 036 step 7, so it
    keeps `ACTIVE`. The gate reports it as `default-mismatch`, because the UI reader has no
    literal default.
  - `trading.broker.paper` is outside the closed taxonomy, because its default comes from the
    environment. It is recorded as
    `docs/reports/2026-11-06-trading-broker-paper-env-derived-default-unseedable-defect.md`
    (status `open`).
- **2026-11-06 — Step 6, fresh-residuals proof method.** No fresh-migrations inventory exists until
  Step 34's `config-heal-dryrun.sh --fresh`, and no database was started. The proof is therefore
  static. It runs `loadCatalog` and `emitHealData`'s allow-tuple rule over
  `config-wiring-stored.json`, which is generated from the fresh migrations. Step 34's real dry-run
  must confirm it.
- **2026-11-06 — Step 8, scope expansion (operator-approved, Option A).** The new exact-scope probe
  selects `key, is_secret` with `key IN ($2,$3) AND environment=$4 AND COALESCE(user_id,'')=COALESCE($5,'')`.
  Nine existing config-service test files broke. Their fake pools matched only the literal
  `SELECT is_secret FROM config.config_values`, and one asserted the pre-feature-189 denial. The
  operator folded test-only edits into Step 8 and kept the production code exactly as specced:
  - The fakes in `configServiceImpl`, `configValueRoundtrip`, `internalCallerSetConfig`,
    `scopeResolution`, `secretsAndScope`, `setConfigAuthz`, `setConfigScalarBounds` and
    `tradingStateValidation` now match `SELECT key, is_secret FROM config.config_values`. Their rows
    carry `key` (the request spelling, `params[1]`). In `configServiceImpl.test.ts`, the `GATE` regex
    and its gate row changed the same way.
  - `internalCallerAuthz.test.ts`: the bare `trading_state` grant case now expects `true`, per AC-25.
- **2026-11-06 — Step 8, details the spec leaves open.**
  - Neither probe uses `LIMIT 1`. Each returns every matching spelling, so two rows at one scope are
    detected.
  - The `pg_notify` payload carries the written spelling (`writeKey`), the same key as the upsert.
    The listener reads only `namespace` and `environment`, so this changes no behaviour.
  - A per-user request always issues the global probe. Before this step, it did so only when no
    per-user row existed.
- **2026-11-06 — Step 9, collision-check form.** The worktree sandbox refused the Verification's
  per-ref `ls-tree` loop. The same `/04[01]_` check ran as
  `log --remotes --name-only -- 'services/xstockstrat-config/migrations/04[01]_*'` after the full
  fetch. It covers every origin ref's history, not only the tips, and printed nothing.
- **2026-11-06 — Step 10, details the spec leaves open.**
  - The pool-options test (Instruction 5) lives in `changeFeedLiveness.test.ts`, since the spec names
    no file. `new Pool` is inline in `main()`, so the test runs `dist/index.js` in a child process
    with a `-r` preload that replaces `pg.Pool`, prints the constructor options and exits. Step 11
    needs no extracted helper.
  - The Instruction 4 grep-assert scans every `04*.up.sql`. It also asserts at least one exists
    (`040` is in the tree), so it cannot pass vacuously.
  - The fakes fix this contract for Step 11:
    - `Date` is mocked, so the heartbeat deadline must read `Date.now()`.
    - The heartbeat echo arrives as `{channel: 'config_heartbeat', payload: <the $1 token>}`.
    - `marker_active` is set on a row only when the SQL names `config_markers`.
    - The AC-2 active leg requires `to_regclass('config.config_markers')` in the reload SELECT.
- **2026-11-06 — Step 11, instruction 3 skip semantics (operator-approved deviation, Option B).**
  The unchanged-version skip in `broadcastToSubscribers` applies only to NOTIFY-driven and backstop
  broadcasts (`opts.skipUnchanged`). The reconnect `resyncAll`, the marker resync and direct
  `broadcastToSubscribers` calls always deliver. This keeps the feature-258 tests
  (`configServiceImpl.test.ts:284`, `:337`), `watchConfigWireZero.test.ts:64` and the promoted
  `@feature-258 @AC-1` rule untouched; none of them was edited.
- **2026-11-06 — Step 11, test added outside Files (operator-ordered).** One case in
  `src/__tests__/contentVersion.test.ts` ("a NOTIFY or backstop broadcast with an unchanged version is
  skipped; a reconnect resync is not"). It makes the call backpressured, so the 10 s re-send skips it
  and every later write is a broadcast. It was RED before the implementation (an unchanged NOTIFY
  wrote a second payload) and is GREEN after.
- **2026-11-06 — Step 11, instruction 8 moved (operator ruling, decision 32).** The keepalive spike
  is now Step 13 instruction 6, with the decision-29 allowance. No container or database was started
  in Step 11, and `new grpc.Server()` (`index.ts:41`) is unchanged.
- **2026-11-06 — Step 11, details the spec leaves open.**
  - One unref'd 10 s interval runs the heartbeat, the watchdog check and the re-send. A second
    unref'd 5-min interval runs the backstop. Both start in `initialize()` after the first
    `connectListener` succeeds, so a test that never calls `initialize()` has no timers.
  - Heartbeat tokens are `<instanceId>:<seq>`, with `instanceId` from `randomUUID()`. Only this
    instance's tokens reset `lastBeatAt`, because every config instance shares the channel.
  - A notification with no `channel` is treated as `config_changed`, which the feature-258 fakes need.
  - The `{"marker":…}` check runs on the `config_changed` payload, before the namespace check.
  - "Backpressured" means the last `call.write` returned `false`. The flag clears on the call's
    `drain` event. Broadcasts still write to a backpressured call; only the re-send skips it.
  - Watchdog: `serial()` counts queued work. The stall ERROR is logged once per stall, and re-sends
    resume when the queue drains to 0.
  - The version is computed over the emitted values, with aliases included when the marker is active.
    A per-user overlay hashes its own rows' secret `updated_at`. `setConfig`'s returned `version`
    (`Date.now()`) is unchanged, because instruction 3 names only the two reload sites.
  - Aliases are applied when values are emitted (`resolveOverlayValues`). The cached global
    `values` keep the stored spellings only, and a stored spelling always wins over an alias.
- **2026-11-06 — Step 12, the core's test-facing API (spec silent; Step 13 must match).**
  Instruction 1 leaves the option names open. The tests fix this contract, all in package `config`:
  - `type Clock interface { Now() time.Time; Sleep(d time.Duration); NewTimer(d time.Duration) Timer }`
    and `type Timer interface { C() <-chan time.Time; Stop() bool }`. The backoff waits with
    `Clock.Sleep`. The 30 s liveness deadline and the 6 h coverage tick use `Clock.NewTimer`.
  - `type Option func(...)`, with `WithClock(Clock) Option` and `WithLogger(*slog.Logger) Option`.
    Every core log line (WARNs, `config.read_key`, `config.read_coverage`) goes through that logger.
  - An unexported constructor that builds the watcher on a given client without dialling, then
    starts the loops. `NewWatcher` keeps its signature and delegates to it:
    - trading: `newWatcher(client configv1.ConfigServiceClient, env commonv1.Environment, namespaces []string, opts ...Option) *Watcher`
    - portfolio and marketdata: `newWatcher(client configv1.ConfigServiceClient, namespace string, env commonv1.Environment, opts ...Option) *Watcher`
  - `(*Watcher).ApplyUpdate(ns string, upd *configv1.ConfigSnapshot)` is promoted from the core. It
    closes readiness and emits the first-snapshot `config.read_coverage`.
  - Log records:
    - `config.read_key` carries attrs `ns` and `key`, the stored key;
    - `config.read_coverage` carries attrs `ns` and `keys`;
    - a FR-11 WARN names the FQN in its message or in an attr value.
- **2026-11-06 — Step 12, test placement and existing-test rewrites.**
  - The spec does not assign AC-11 or instruction 7 to a service. Both live in trading, with AC-10,
    AC-12 and instruction 6. The three cores are byte-identical, and Step 13's hash guard keeps them
    so.
  - Portfolio carries AC-27. Its `newTestWatcher` now goes through `newWatcher` on an idle client
    plus `ApplyUpdate`.
  - Marketdata's `newTestWatcher` now uses Step 13's `NewSnapshotWatcher`. `TestWatcher_GetFloat`
    gains an int-stored widening row (FR-11). The cancelled-ctx case uses a zero-value `&Watcher{}`.
  - In trading:
    - The `&Watcher{snapshot: …}` getter tests now use `NewSnapshotWatcher`.
    - Multi-namespace delivery and the readiness latch run on the new stall-client fake.
    - `TestWatcher_ScopedReplace_TradingReloadDoesNotWipePlatform` is replaced by instruction 6's
      `TestWatcher_PlatformSnapshotDoesNotDeleteTradingKeys`.
    - The now-unused `scriptedStream`, `streamingFake`, `newTestWatcher` and `reload` helpers are
      removed.
  - **Constraints the unchanged tests put on Step 13:**
    - trading `&Watcher{client: fake}` (SetConfig tests) still works;
    - marketdata `&Watcher{namespace, client, environment}` (ResolveSecret tests) still works;
    - a zero-value `Watcher` returns defaults and honours ctx in `WaitForSnapshot`, which
      `internal/service` and `cmd/server` tests already rely on.
- **2026-11-06 — Step 13: details the spec leaves open.**
  - **Shape.** `watchcore.go` defines an unexported `watchCore`, which each service's `Watcher`
    embeds by value. The getters, `WaitForSnapshot`, `ApplyUpdate` and `OnChange` are promoted
    from it.
    - Each `config.go` keeps its own fields: `client`, `environment` and `tradingMode`, plus
      `namespace` in portfolio and marketdata.
    - Each hands the core an open-stream closure, so the `ClientId` strings are unchanged.
    - A zero-value core serves code defaults and never becomes ready.
  - **Keepalive.** The dial option lives in the core as `watchKeepalive`. It uses the same values
    as `clientKeepAlive` (`internal/service/trading.go:195`): 30 s / 10 s, PermitWithoutStream.
    `internal/config` cannot import `internal/service`, so the values are restated, not reused.
  - **Healthy time** for the backoff reset runs from the stream open to its last received message.
    A stream that delivers a snapshot and then stalls or ends counts as about 0 s.
  - **FR-11 WARN.**
    - It is rate-limited to one per FQN and reason every 5 min (`warnInterval`).
    - An absent key WARNs only after a snapshot has arrived, so a zero-value watcher stays silent.
    - The FQN is the stored key when it already starts with `<ns>.`; otherwise it is `<ns>.<key>`.
  - **`config.read_key` for an absent key** is recorded under the first subscribed namespace.
  - **`NewSnapshotWatcher`** seeds the whole map under the service's own namespace (`trading` or
    `marketdata`). Getters search every namespace map, so trading's test maps, which mix
    `platform.*` and `trading.*` keys, still resolve.
- **2026-11-06 — Step 13, instruction 6: keepalive spike (decision 29 allowance).**
  - **Run.**
    - Started `dockerd` and one disposable `timescale/timescaledb:latest-pg16` container
      (`spike295-tsdb`, `127.0.0.1:55432`).
    - Applied config migrations `001`–`040` to it with golang-migrate.
    - Ran the worktree's built config server with dev mTLS certs from `scripts/gen-dev-certs.sh`,
      written to the session scratchpad.
    - A throwaway, unstaged test drove the real `NewWatcher` against it, using the trading leaf on
      `trading` + `platform`.
  - **Outcome: no `too_many_pings`.**
    - For 150 s both streams stayed up. 32 updates arrived, one every 10 s from the Step 11
      re-send. There was no reconnect WARN and no GOAWAY.
    - An idle connection with no stream stayed READY for 100 s and served a second call. With
      PermitWithoutStream, its client pings every 30 s.
    - The installed `@grpc/grpc-js` 1.14.5 `server.js` has no `too_many_pings` or
      ENHANCE_YOUR_CALM enforcement.
    - The server-option fallback was not needed, and `services/xstockstrat-config/src/index.ts`
      is unchanged.
  - **Teardown.** Killed the config server and ran `docker rm -f spike295-tsdb`. Stopped `dockerd`
    and deleted the spike test file. No shared or remote database was touched.
- **2026-11-06 — Step 14: the Python core test seam (contract for Step 15).** The spec leaves the
  Python seam open, so the tests fix it. Step 15 must implement it as written:
  - **Clock.** The core reads its clock from `self._clock` when present (class or instance
    attribute), else the real clock, and never assigns `_clock` itself. The clock has
    `monotonic()`, `async sleep(s)` and `async wait_for(aw, timeout)`. The liveness timeout is
    `clock.wait_for(<call>.__anext__(), 30)`, and every backoff and the coverage tick go through
    `clock.sleep`. The tests tell backoff sleeps from the 21600 s tick by their size (≤ 30 s).
  - **Stream.** The core iterates the `WatchConfig` call through `__aiter__`/`__anext__` and calls
    `call.cancel()` when it abandons a stalled stream. The received snapshot stays at `_snapshot`
    (the conftest `snapshot_watcher` helpers and the AC-5 test read it).
  - **Dial.** `ConfigWatcher(endpoint, namespace)` still dials through `grpc.aio.secure_channel`,
    `app.mtls.channel_credentials` and `config_pb2_grpc.ConfigServiceStub`, called as module
    attributes (the tests patch those modules, not names in `watcher.py`). The `options` list
    carries the three keepalive pairs plus `mtls.target_override("xstockstrat-config")`.
    Construction starts both the watch task and the coverage task.
  - **Log lines.** `config.read_key ns=<ns> key=<key>` and `config.read_coverage ns=<ns>`, each
    either the whole message or followed by a space. The tick logs one coverage line per namespace
    and re-emits every read key. A WARN for a mismatch or an absent key has the FQN in its message.
  - **Getters on a `__new__` watcher.** `snapshot_watcher` sets only `_snapshot` (plus `namespace`
    and `_snapshot_event` in analysis), so the getters must work with no other state.
- **2026-11-06 — Step 14: where each item lives, and the rewritten AC-5 test.**
  - Item 1 (AC-10) and item 5 are in indicators. Item 4 is in ingest. Items 2 (AC-11) and 3
    (AC-27) are in analysis. Item 6 is in all three, because each `watcher.py` builds its own
    channel.
  - The feature-259 `test_watch_reconnects_after_non_grpc_exception` in all three files asserted a
    fixed `asyncio.sleep(2)` and patched `asyncio.sleep` globally. It now asserts a reconnect after
    the first equal-jitter backoff (0.5–1.0 s) on the fake clock, which keeps the AC-5 intent. The
    `_Done`/`_FakeStub` fakes and the `AsyncMock` import it used were removed.
- **2026-11-06 — Step 15: the Python core's shape and the details the spec leaves open.**
  - **Shape.** `WatchCore` is a mixin base of `ConfigWatcher`. The subclass sets `namespace`,
    `endpoint`, `_stub`, `_snapshot`, `_snapshot_event` and keeps `_build_watch_request()` (the
    `client_id` prefix is per service), then calls `_start()`, which starts the retained watch and
    coverage tasks. `wait_for_snapshot` and the task done-callback moved into the core; the
    service-specific helpers and the `get_*_present` aliases stay in each `watcher.py`.
  - **Imports.** The core imports only the stdlib (`asyncio`, `logging`, `random`, `time`), which is
    narrower than the spec's allowance (`grpc`, `app.mtls`, stubs). `watcher.py` still dials, with
    `options=mtls.target_override("xstockstrat-config") + KEEPALIVE_OPTIONS`.
  - **Snapshot.** Each received `ConfigSnapshot` replaces `_snapshot` wholesale, as before; nothing
    else clears it, so the last one keeps serving through a stall, EOF or error.
  - **`on_change(callback)`** registers `callback(version)`. It runs after a received snapshot whose
    `version` differs from the last one seen, including the first. A raising hook is logged and
    never tears the stream down. No Step 14 test covers it; a throwaway, unstaged test confirmed
    `v1, v1, v2` fires `["v1", "v2"]` with a raising sibling hook.
  - **FR-11 WARN.** One per FQN and reason every 300 s, on the core's clock. An absent key WARNs
    only after a snapshot has arrived. The FQN rule matches Step 13.
  - **Evidence.** `config.read_coverage` is logged at the first snapshot and on each 21600 s tick;
    the tick re-emits every read key, as in Step 13.
  - **Out of Files: `scripts/config-wiring.json` `registry.dynamic`.** Moving the getters made the
    Python extractor report one `dynamic-read` per service at `watch_core.py:WatchCore._lookup`,
    and orphaned the 12 `watcher.py:ConfigWatcher.get_*` entries. The 12 entries were replaced by
    the 3 `_lookup` entries (empty key lists, like the ones they replace). `check-config-wiring.mjs
    --final` and `config-wiring.test.mjs` now print exactly what they print on the pre-step tree;
    their pre-existing failures (config `contentVersion` dynamic-read, STALE-STORED) are unchanged.
- **2026-11-06 — Step 16: the Node core test seam (contract for Step 17).** The spec leaves the
  Node seam open, so the tests fix it. Step 17 must implement it as written:
  - **Dial.** `ConfigWatcher(endpoint, namespace)` constructs `ConfigServiceClient` and calls
    `mtls.clientCredentials()` as properties of their modules at call time (the tests replace the
    exports on `@xstockstrat/proto/config/v1/config` and `../mtls`). The third constructor
    argument is one channel-options object carrying `grpc.keepalive_time_ms: 30000`,
    `grpc.keepalive_timeout_ms: 10000`, `grpc.keepalive_permit_without_calls: 1` and
    `mtls.targetOverride('xstockstrat-config')`.
  - **Stream.** The core opens the stream with `stub.watchConfig(req)` in the constructor and
    handles `data`, `end` and `error` events. It calls `call.cancel()` when it abandons a stalled
    stream. The last received snapshot keeps serving reads through a stall, EOF or redial.
  - **Time.** All timers are `setTimeout`/`setInterval` and the clock is `Date.now()`, because the
    tests drive `node:test` mock timers over exactly those APIs. The liveness deadline is 30 s from
    the last message; the first backoff after any failure is at most 1 s; the coverage tick runs
    every 21600 s.
  - **Logging.** The core takes its logger from `getLogger(...)` in `./logger`, called at module
    load (the tests replace `getLogger` before importing the watcher). Each log call passes the
    message string as its first argument. `config.read_key ns=<ns> key=<key>` and
    `config.read_coverage ns=<ns>` are INFO, each either the whole message or followed by a space.
    The tick logs one coverage line per namespace and re-emits every read key.
  - **FR-11.** A WARN for a mismatch or an absent key has the FQN in its message, at most once per
    FQN and reason every 5 min. An absent key WARNs only after a snapshot has arrived. The FQN rule
    matches Step 13 (a bare key becomes `<ns>.<key>`).
- **2026-11-06 — Step 16: where each item lives.** Items 2 (AC-10), 3 (AC-11) and 4 (AC-15) are in
  ledger. Items 5 (AC-27) and 6 for `getFloat` are in notify. Identity covers item 6 for `getInt`,
  `getBool` and `getString`, the bare-key FQN and the silent pre-snapshot read. Item 7 (keepalive)
  is in all three, because Step 17 must make each copy dial with it.
- **2026-11-06 — Step 17: the Node core's shape and what the spec leaves open.**
  - **No constructor option.** The three pre-step copies differed only in two comments (the file
    header and the comment above the environment lookup); code, imports and constants were the same.
    One header and the ledger wording of the environment comment were kept, so instruction 2's
    constructor option has nothing to fold. `context.md` records both differences.
  - **Kept.** `ConfigWatcher(endpoint, namespace)`, `waitForSnapshot`, the `update` event,
    `getSnapshot`, and wholesale replacement of the snapshot per message (unlike Go, the Node copies
    never merged deltas). There is no `OnChange`: the existing `update` event is the change hook.
  - **Backoff.** "Healthy" is open to last message, as in Go; the backoff resets only when that is
    at least 15 s. The 30 s liveness timer re-arms on each message.
  - **Evidence.** `config.read_coverage ns=<ns> keys=<n>` is logged at the first snapshot and on each
    21600 s `setInterval` tick (unref'd); the tick re-emits every read key, sorted.
  - **FR-11 WARN** text: `config value <reason>; using the code default fqn=<fqn>[ want=… stored=…]`.
  - **Out of Files: `scripts/config-wiring.json` `registry.dynamic`.** As in Step 15, the getters now
    read through `ConfigWatcher.lookup`, so the Node extractor reported one `dynamic-read` per leaf
    there. The 12 `configWatcher.ts:get*` entries for ledger, identity and notify were replaced by 3
    `configWatcher.ts:lookup` entries (empty key lists). `check-config-wiring.mjs --final` now prints
    what it printed before the step; its pre-existing failures (config `contentVersion`,
    STALE-STORED) are unchanged.
- **2026-11-06 — Step 18: the limiter and ComputePool test seam (contract for Step 19).** The spec
  names the symbols but not every detail, so the tests fix them. Step 19 must implement them as
  written:
  - **`app/config/live_limits.py`.** `ResizableLimiter(limit_fn)` has `async acquire()`, `release()`,
    `wake()` and a readable `in_use` count. A waiter blocked under a lower limit is admitted after a
    higher limit **and** `wake()`. `async run_bounded(lim, executor, fn)` returns `fn()`'s result;
    when its caller is cancelled (`asyncio.wait_for` timeout), the slot stays held until the thread
    finishes.
  - **`app/services/compute_pool.py`.** `ComputePool(limit_fn=…, threads=…)` has `async run(fn)`
    with the same release-on-thread-completion rule.
  - **Wiring.** Each servicer registers its limiters' `wake` with its own config watcher's
    `on_change` (Step 15's `WatchCore.on_change`), **in the servicer constructor**. The tests build
    the servicer around a dial-free watcher and fire `on_change` by passing a new-version snapshot
    to `watcher._apply`. Wiring done only in `main.py` fails them.
  - **Attribute names are kept.** The limiters stay at `_sandbox_sem` (indicators), `_backfill_sem`
    (ingest) and `_component_series_sem`, `_bars_fetch_sem`, `_candidates_sem`,
    `_readiness_materializer_bars_sem` (analysis), as Step 19 instruction 7 assumes.
- **2026-11-06 — Step 18: where each item lives, and two additive cases.**
  - Item 1 (AC-6, shrink 4 → 2 through `ExecuteFormula`) is in indicators. Item 2 (AC-23) and item 3
    (the grep, which also matches the split screener call) are in `test_compute_pool.py`. Item 4 is
    in ingest, as a grow (1 → 2) and a shrink (3 → 1) of `_backfill_sem`.
  - **Additive, beyond the four items:** indicators also has a grow case (1 → 3 admits the waiting
    calls on `on_change`), and analysis `test_live_limits.py` has the `ResizableLimiter` /
    `run_bounded` unit cases plus a grow case for each of the four servicer limiters. They pin
    Step 19 instructions 1, 4 and 5, which have no test of their own. `live_limits.py` is
    byte-identical, so its unit cases live only in analysis.
- **2026-11-06 — Step 19: how the limiter is built, and what the spec leaves open.**
  - **No `asyncio.Condition`.** Instruction 1 says `release()` and `wake()` notify a Condition, but a
    Condition can only be notified by a coroutine holding its lock, and `WatchCore.on_change` calls
    its hooks synchronously from `_apply`. The limiter keeps a deque of waiter futures instead;
    `wake()` resolves them all and each re-checks `in_use < limit_fn()`. The behaviour the Step 18
    tests pin (shrink keeps holders, grow admits only on `wake`) is unchanged.
  - **`run_bounded` shields the executor future.** The spec's done-callback form
    (`loop.is_closed() or loop.call_soon_threadsafe(lim.release)`) is kept, on the
    `run_in_executor` future wrapped in `asyncio.shield`, so a cancelled caller does not cancel the
    future and the slot frees only when the thread ends. `fn` runs in a copied context, which keeps
    the `asyncio.to_thread` context propagation indicators had.
  - **Readable surface.** `ResizableLimiter.limit` (current `limit_fn()`), `in_use`, `acquire`,
    `release`, `wake(*_)` and `async with`. `ComputePool` adds `limit`, `in_use`, `wake`, `run` and
    `shutdown`, and is held at `AnalysisServicer._compute`; `_compute_executor` is gone.
  - **Literal keys stay at each read site.** The four analysis limiters are built through
    `_live_limit(lambda: int_positive(self._cfg, "<key>", <default>))`, so the AST classification
    scan and `check-config-wiring.mjs` still see each key. Step-time mode prints nothing and exits 0;
    `--final` prints only its pre-existing failures.
  - **Thread ceiling.** `_COMPUTE_THREADS = 16` is a fixed invariant (F-07 comment). A configured
    `analysis.compute.max_worker_threads` above 16 runs at most 16 cores at once.
  - **Indicators NPROC.** `max(limit, in_use)` is evaluated on the sandbox thread just before the
    spawn, so it counts every child still holding a slot at that moment.
  - **Additive test.** `test_config_zero_clamps.py` gains
    `test_compute_pool_limit_follows_seeded_key_and_on_change` (instruction 7, B2 (b)): default 4
    and seeded 2, grown on `on_change` to 6 and 3, with a waiter admitted after the change.
- **2026-11-06 — Step 20: the API contract Step 21 must implement, and where each item lives.**
  - **Alpaca (`internal/alpaca/client_test.go`, AC-32 row 1).** `alpaca.Settings` carries the
    live fields under their `ClientConfig` names (`APIKey`, `APISecret`, `BaseURL`, `DataURL`, `Feed`,
    `Adjustment`, `BatchSize`, `RateLimitRPS`, `ReconnectDelayMs`, `MaxReconnects`).
    `alpaca.NewLiveClient(settings func() alpaca.Settings, paper bool) *Client` reads it on every
    request, and `(*Client).Limit() rate.Limit` exposes the limiter. `NewClient(ClientConfig)` stays,
    so the 22 existing `ClientConfig` call sites in `client_test.go` and 3 in `stream_test.go` are
    unchanged. This narrows instruction 1's "replace the value fields": the closure is the new
    constructor's input, and `ClientConfig` remains the static form.
  - **Main-package helpers (`cmd/server/main_test.go`):**
    - `fundamentalsProvider(*config.Watcher) func() string` reads
      `marketdata.fundamentals.provider` (default `finnhub`).
    - `newFundamentalsSource(w, provider func() string, fmpClient *fmp.Client, finnhubAPIKey func() string)`
      selects per call; `newFMPClient(w, apiKey func() string)`.
    - `newEDGARClient(*config.Watcher) *edgar.Client` reads `marketdata.edgar.user_agent` per request.
    - `type secretResolver func(ctx, key) (string, bool, error)` (the `ResolveSecret` shape);
      `newLiveSecrets(resolve, sleep func(time.Duration)) *liveSecrets` with `load(ctx)`,
      `accessor(key) func() string` and `bindRefresh(ctx, *config.Watcher)`. `bindRefresh` registers
      `OnChange`; the re-resolve runs off the hook goroutine (the test polls for it).
  - **Retry reading.** "Retrying 3 times at 1/2/4 s" (Step 21 instruction 5) is pinned as 1 attempt
    + 3 retries: sleeps exactly `[1s 2s 4s]` and 4 resolver calls, then the WARN names the key and no
    log line carries a key value. Step 20's "after 3 tries" is read as those 3 retries.
  - **AC-7, two halves.** The main-package test drives the source through the FMP and Finnhub
    `httptest` fakes: after the `ApplyUpdate` the boot `*fmp.Client` serves the request and its
    budget moves 5 → 6 (seeded, not reset). The service test (`marketdata_service_test.go`) uses a
    `NewSnapshotWatcher` as `fundCfg` and the provider closure. Under `finnhub` the `.enabled` gate is
    finnhub's. After the flip, `marketdata.fmp.cache_ttl_hours` serves a 1 h-old row, and a stale
    fetch is gated by the FMP budget (249/250 raises the quota WARNING; Finnhub's window count is
    never consulted). The `fundProvider` field becomes `func() string`. Five struct literals in this
    file use `staticProvider(…)`.
  - **EDGAR (AC-32 row 2).** The ticker→CIK map is fetched from the fixed, unexported
    `www.sec.gov` URL, so the test swaps `http.DefaultTransport` for one that redirects that host to
    the `httptest` server, and restores it in Cleanup. The companyfacts request goes to the
    configured `marketdata.edgar.base_url`. Every observed request must carry the current
    User-Agent. This assumes the EDGAR client keeps a nil `Transport` (the default).
  - **Not in Step 21's Files.** `internal/service/classification_service_test.go:161` builds
    `&MarketDataService{fundProvider: "fmp", …}`. Once the field is `func() string`, the `service`
    test package does not build until that literal is changed as well. It is a one-line change in
    the same package, and Step 21 must include it.
