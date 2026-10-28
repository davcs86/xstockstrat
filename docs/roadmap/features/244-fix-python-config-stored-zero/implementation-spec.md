# Implementation Spec: fix-python-config-stored-zero

**Status**: `pending`
**Created**: 2026-10-21
**Feature**: `docs/roadmap/features/244-fix-python-config-stored-zero/feature.md`
**Total Steps**: 18
**Feature Branch**: `feature/fix-python-config-stored-zero`

---

## Execution Summary

Per Python service, two red-green cycles run in order: (a) the getter switch (`HasField` body, `*_present` →
alias), proven by the @AC-1/@AC-4 getter rows and, in analysis, the FR-4 and zero-honour behaviours
(@AC-2/@AC-3/@AC-9/@AC-12); then (b) the FR-3 clamps (`int_positive`/`float_positive`/`str_nonempty`), proven by
@AC-5/@AC-6/@AC-7 and the AST guard. Cycle (b) is RED only against the tree left by cycle (a), which is why the getter step comes first.
Order is ingest (smallest) → indicators → analysis → config (comments, wire-zero and bounds tests, description
migration) → docs → rollout. No proto change, no new config key, no env var or port.

Pre-spec dry run (2026-10-21, scratch copy outside the repo, not committed): getters switched and the 48 FR-3
call sites wrapped in the module clamps. Results: ingest 328 passed; indicators 290 passed; analysis 1274 passed,
2 failed — exactly the two tests design §9 rewrites on purpose (`test_get_float_present_explicit_zero_is_not_trapped`
`tests/test_analysis_servicer.py:586-594`, `test_retention_clamped_to_at_least_one` `:2527-2541`). No bare-`MagicMock`
cfg double raised `TypeError` at `v > 0` (design Open Risk 7): the only double reaching a new clamp with an
unstubbed getter is `tests/test_live_loop.py:36-50` (`get_str` unstubbed → truthy `MagicMock`, which
`str_nonempty` returns unchanged, same as today). So no cfg double needs fixing beyond the two listed rewrites.
The AST scan in the same run found 0 unbindable calls, 0 keys with two defaults, and disjoint read/clamp key sets.

### Scenario Coverage (C-15)

| Scenario | Covered by |
|---|---|
| @AC-1 | Step 2 (ingest rows), Step 6 (indicators rows), Step 10 (analysis rows) |
| @AC-2 | Step 10 |
| @AC-3 | Step 10 |
| @AC-4 | Step 2, Step 6, Step 10 |
| @AC-5 | Step 4 |
| @AC-6 | Step 4 (ingest rows), Step 8 (indicators rows), Step 12 (analysis rows) |
| @AC-7 | Step 12 |
| @AC-8 | Step 14 |
| @AC-9 | Step 10 |
| @AC-10 | Step 14 |
| @AC-11 | Step 16 |
| @AC-12 | Step 10 |

This session appended to `acceptance.feature` (C-15 append-only, design §10): 20 @AC-6 rows (the 18 of design §10
plus `read_db_budget_ms` 20000 and `live_enrich_timeout_ms` 3000, `servicer.py:339-340`), and @AC-10, @AC-11,
@AC-12.

### Consumer surfaces (C-14)

All named surfaces are pass-through (product-spec § Consumer Surface(s); design §14): agent `run_backtest`,
`list_opportunities`, `set_config`; `/insights` backtest view; `/trader` AlertStream and
`/accounts/notifications`; `/config-ui` key descriptions. No consumer code changes. `/config-ui` is reached by the
Step 15 migration; every surface gets its verification in Step 18.

### Guard classification table (design §7, Open Risk 2)

Emitted for impl-spec review. Sets are exact: guard rule 2 fails on any key in the code but not in the set, and on
any key in the set but not in the code. Defaults are the AST-bound default each call site passes (dry-run scan).

**`FR3_KEYS`** (clamp call sites; stored `0`/`""` → default):

| Service | Key (full dotted) | Clamp | Default |
|---|---|---|---|
| ingest | `ingest.backfill.max_concurrent_jobs` | `int_positive` | `3` |
| ingest | `ingest.backfill.max_concurrent_chunks` | `int_positive` | `3` |
| ingest | `ingest.backfill.chunk_max_bars` | `int_positive` | `200000` |
| ingest | `ingest.backfill.chunk_window_days` | `int_positive` | `90` |
| ingest | `ingest.mcp_client.request_timeout_seconds` | `int_positive` | `_DEFAULT_REQUEST_TIMEOUT_SECONDS` (30) |
| ingest | `ingest.mcp_client.poll_interval_seconds` | `int_positive` | `_DEFAULT_POLL_INTERVAL_SECONDS` (300) |
| indicators | `indicators.sandbox.timeout_ms` | `int_positive` | `5000` |
| indicators | `indicators.sandbox.memory_bytes` | `int_positive` | `128 * 1024 * 1024` |
| indicators | `indicators.sandbox.max_concurrent` | `int_positive` | `4` |
| analysis | `analysis.engine.eval_interval_seconds` | `int_positive` | `60` |
| analysis | `analysis.engine.max_strategies_per_cycle` | `int_positive` | `50` |
| analysis | `analysis.engine.fundamentals_blend_strategy_id` | `str_nonempty` | `"fundamentals_macd_blend"` |
| analysis | `analysis.fundsignal.source_slug` | `str_nonempty` | `"fundamentals"` |
| analysis | `analysis.fundsignal.run_interval_hours` | `int_positive` | `24` |
| analysis | `analysis.fundsignal.max_symbols_per_run` | `int_positive` | `200` |
| analysis | `analysis.fundsignal.daily_call_budget` | `int_positive` | `200` |
| analysis | `analysis.fundsignal.valid_days` | `int_positive` | `90` |
| analysis | `analysis.strategy.max_concurrent_entry_backfill` | `int_positive` | `4` |
| analysis | `analysis.strategy.default_cooldown_days` | `int_positive` | `31` |
| analysis | `analysis.series.max_concurrent_components` | `int_positive` | `4` |
| analysis | `analysis.opportunity.max_concurrent_bars_fetches` | `int_positive` | `2` |
| analysis | `analysis.opportunity.max_concurrent_candidates` | `int_positive` | `4` |
| analysis | `analysis.compute.max_worker_threads` | `int_positive` | `4` |
| analysis | `analysis.readiness_materializer.max_concurrent_bars_fetches` | `int_positive` | `2` |
| analysis | `analysis.backtest.portfolio_max_concurrent` | `int_positive` | `9` |
| analysis | `analysis.backtest.portfolio_position_weight` | `float_positive` | `0.10` |
| analysis | `analysis.backtest.detail_retention_per_strategy` | `int_positive` | `20` |
| analysis | `analysis.backtest.max_range_days` | `int_positive` | `730` |
| analysis | `analysis.screener.max_concurrent_formula_evals` | `int_positive` | `4` |
| analysis | `analysis.screener.max_duration_seconds` | `int_positive` | `120` |
| analysis | `analysis.screener.max_universe_size` | `int_positive` | `100` |
| analysis | `analysis.scoring.shrinkage_days` | `int_positive` | `250` |
| analysis | `analysis.snapshot.indicator_timeout_ms` | `int_positive` | `500` |
| analysis | `analysis.snapshot.signal_timeout_ms` | `int_positive` | `500` |
| analysis | `analysis.patterns.indicator_bucket_count` | `int_positive` | `5` |
| analysis | `analysis.opportunity.max_universe_size` | `int_positive` | `100` |
| analysis | `analysis.opportunity.max_live_strategies_per_symbol` | `int_positive` | `5` |
| analysis | `analysis.opportunity.max_live_held_symbols_per_compute` | `int_positive` | `20` |
| analysis | `analysis.opportunity.max_live_only_symbols_per_compute` | `int_positive` | `20` |
| analysis | `analysis.opportunity.valid_window_hours` | `int_positive` | `24` |
| analysis | `analysis.opportunity.snooze_default_hours` | `int_positive` | `24` |
| analysis | `analysis.opportunity.read_db_budget_ms` | `int_positive` | `_DEFAULT_OPP_READ_DB_BUDGET_MS` (20000) |
| analysis | `analysis.opportunity.live_enrich_timeout_ms` | `int_positive` | `_DEFAULT_OPP_LIVE_ENRICH_TIMEOUT_MS` (3000) |

Counts: ingest 6, indicators 3, analysis 34.

**`HONOUR_KEYS`** (plain or alias reads; a stored `0`/`""` is the effective value):

- ingest (2): `ingest.backfill.max_retry_attempts`, `ingest.signals.dedup_window_hours`.
- indicators (1): `indicators.sandbox.allowed_imports`.
- analysis (36): `analysis.backtest.default_commission_pct`, `analysis.backtest.default_slippage_pct`,
  `analysis.backtest.default_fill_model`, `analysis.opportunity.signal_rank_weight`,
  `analysis.engine.alert_throttle_seconds`, `analysis.scoring.sharpe_weight`, `analysis.scoring.drawdown_weight`,
  `analysis.scoring.win_rate_weight`, `analysis.scoring.min_evidence_symbols`, `analysis.scoring.min_evidence_days`,
  `analysis.scoring.signal_decay_half_life_hours`, `analysis.scoring.composite_shrinkage_k`,
  `analysis.scoring.composite_weight_readiness`, `analysis.scoring.composite_weight_signal`,
  `analysis.scoring.symbol_score_decay`, `analysis.scoring.strategy_weight_floor`,
  `analysis.fundsignal.buy_quantile`, `analysis.fundsignal.sell_quantile`,
  `analysis.fundsignal.min_conviction_to_emit`, `analysis.fundsignal.universe_source`,
  `analysis.fundsignal.explicit_symbols`, `analysis.fundsignal.scoring_formula_id`,
  `analysis.fundsignal.retry_seconds`, `analysis.fundsignal.startup_jitter_seconds`,
  `marketdata.fundamentals.provider`, `analysis.screener.default_rank_limit`, `analysis.patterns.min_sample_count`,
  `analysis.strategy.default_exit_cooldown_days`, `analysis.readiness.stale_after_seconds`,
  `analysis.readiness_materializer.valid_window_hours`, `analysis.readiness_materializer.refresh_hour_utc`,
  `analysis.opportunity.live_enrich_ttl_seconds`, `analysis.opportunity.empty_recompute_ttl_seconds`,
  `analysis.opportunity.refresh_hour_utc`, `analysis.opportunity.retry_seconds`,
  `analysis.opportunity.startup_jitter_seconds`.

**`ZERO_IS_LEGIT`** (rule 5: every `HONOUR_KEYS` member whose name matches
`max_concurrent|timeout|interval|budget|max_universe|_per_cycle|_ms$|_seconds$`; entries must be ⊆ `HONOUR_KEYS`):

| Service | Key | Reason (value of the dict) |
|---|---|---|
| analysis | `analysis.engine.alert_throttle_seconds` | 0 = no throttle; `live_loop.py:815` `< 0` never suppresses (FR-4) |
| analysis | `analysis.readiness.stale_after_seconds` | 0 = always stale; bounds `[0,86399]` `configServiceImpl.ts:104` |
| analysis | `analysis.opportunity.live_enrich_ttl_seconds` | 0 disables the memo (`servicer.py:4698-4700`) |
| analysis | `analysis.opportunity.empty_recompute_ttl_seconds` | consumer floor `max(1, …)` `servicer.py:4787-4789` |
| analysis | `analysis.opportunity.retry_seconds` | `max(1, …)` floor kept, feature-158 @AC-9 (`servicer.py:5890,6066`) |
| analysis | `analysis.opportunity.startup_jitter_seconds` | 0 disables jitter (`servicer.py:5928`) |
| analysis | `analysis.fundsignal.retry_seconds` | `max(1, …)` floor kept, feature-156 @AC-4 (`fundsignal_loop.py:142-144,154`) |
| analysis | `analysis.fundsignal.startup_jitter_seconds` | 0 disables jitter (`fundsignal_loop.py:163`) |
| ingest | `ingest.backfill.max_retry_attempts` | 0 = no retries, feature-173 @AC-1 |
| ingest | `ingest.signals.dedup_window_hours` | 0 disables dedup, feature-173 @AC-2 |

Indicators: `ZERO_IS_LEGIT = {}` (its one honour key matches no pattern).

## Step Dependencies

- Step 2 [test] covers Step 1 [service]; Step 4 covers Step 3; Step 6 covers Step 5; Step 8 covers Step 7; Step 10
  covers Step 9; Step 12 covers Step 11; Step 14 covers Step 13; Step 16 [test] covers Step 15 [migration].
- Step 3 requires Step 1, Step 7 requires Step 5, Step 11 requires Step 9: the clamp tests (Steps 4, 8, 12) are RED
  only against a getter-switched tree. Against the original tree the trap already returns the default and they pass.
- Between a getter step and its clamp step a stored 0 reaches an unclamped site (`Semaphore(0)`, `sleep(0)`). This
  is safe only because the per-step PRs target `feature/fix-python-config-stored-zero` (F-03), which never deploys.
  The integration PR to `main-dev` opens only after Step 12.
- Step 16's test is authored before Step 15's files exist (RED: the glob finds no migration).
- Step 15 pins the pair to `032`: trunk tip is `030`, and 243 claims `031`
  (`origin/feature/fix-sandbox-seed-keys:…/243-fix-sandbox-seed-keys/implementation-spec.md:168-169`). It still
  requires the pre-merge re-list (design §12, Open Risk 6; fails.md:2910). Immediately before the integration PR
  merges, run `git ls-tree --name-only origin/main-dev services/xstockstrat-config/migrations/` and set the pair to
  `max+1`. That is `031` if 244 merges before 243 (no gap; 243 then renumbers), or higher if another sibling landed.
  Record any renumber in the Deviation Log (F-09). The AC-11 test globs by name suffix, so a renumber needs no test edit.
- Step 17 requires Steps 1-16 (docs describe the shipped state). Step 18 runs after the integration PR deploys to dev
  (smoke), then repeats the audit before the prod promotion.
- Overlaps (file-level rebase only, context.md 2026-10-20 sdd-review): 243 shares indicators `app/config/watcher.py`
  `:133-148` and `CLAUDE.md:100-103` (244 owns the read clamp for all three `indicators.sandbox.*` int keys, FR-6);
  242 shares `live_loop.py`; 245 shares `services/screener.py` and the `servicer.py:3786-3795` `wait_for` block
  (Step 11 wraps only the `:3786` read); 246 shares `fundsignal_loop.py` (disjoint lines); 240 and 241 share
  `configServiceImpl.ts`.
- **243 test-helper overlap** (`services/xstockstrat-indicators/tests/test_config_watcher.py`). 243 Step 3 generalizes
  `_str_watcher` into `_watcher(key, field, val)` and keeps it in that file. 244 Step 6 resolves this without a hard
  order (design rejected one): whichever helper is on the base at execute time keeps its name, signature and file,
  and only its body delegates to the conftest `snapshot_watcher`.
- **Branch hazard (design Open Risk 8; fails.md:2953): resolved 2026-10-21.** The slug `fix-python-config-zero-trap` collided with
  launched 173, so the orphan cleanup (`.github/workflows/ci-validate-feature-status.yml:160-167,181-183`) deleted
  the branch on every push to `main`. The feature is renamed to `fix-python-config-stored-zero` (branch `feature/fix-python-config-stored-zero`,
  step branches `feature-steps/fix-python-config-stored-zero-step-<N>`), which no other feature dir matches.

---

### Step 1 — service: ingest getters honour a stored zero (HasField)

**Status**: `done`
**Service**: `xstockstrat-ingest`
**Files**:
- `services/xstockstrat-ingest/app/config/watcher.py` — modify

**Reviewers**: `xstockstrat-ingest` owner — Signal normalization correctness, idempotent ingestion, newsletter source schema stability

**Codebase Evidence**:
- Trapped bodies: `watcher.py:110` (`return v.string_val or default`), `:118` (`return v.int_val or default`),
  `:144` (`return v.float_val or default`).
- Target body: `get_bool` `:136` (`return v.bool_val if v.HasField("bool_val") else default`) and `get_int_present`
  `:120-128` (recon.md:63-64, 161-167).
- FR-2 guards already precede each return: `if self._snapshot is None: return default` / `if v is None: return
  default` (`:105-109`, `:113-117`, `:139-143`).

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. `get_str` `:110` → `return v.string_val if v.HasField("string_val") else default`.
2. `get_int` `:118` → `return v.int_val if v.HasField("int_val") else default`.
3. `get_float` `:144` → `return v.float_val if v.HasField("float_val") else default`.
4. Delete the `get_int_present` method body `:120-128`. Add the class-level alias `get_int_present = get_int`
   directly after `get_int` (design §1). The `default` parameter of `get_int` keeps its signature default `0`. The
   two callers (`:195`, `:215`) pass `default=` by keyword, so they still bind.
5. Leave the properties at `:166-215` untouched (Step 3 owns them).

**Verification**:
```bash
cd services/xstockstrat-ingest && grep -n 'or default' app/config/watcher.py   # expect no output
grep -n 'get_int_present = get_int' app/config/watcher.py                        # expect 1 hit
```
Green run is Step 2's Verification.

---

### Step 2 — test: ingest getter rows for @AC-1 / @AC-4

**Status**: `done`
**Service**: `xstockstrat-ingest`
**Files**:
- `services/xstockstrat-ingest/tests/conftest.py` — modify
- `services/xstockstrat-ingest/tests/test_config_watcher.py` — modify

**Reviewers**: `xstockstrat-ingest` owner — Signal normalization correctness, idempotent ingestion, newsletter source schema stability

**Codebase Evidence**:
- Dial-free real watcher: `_int_watcher(**int_values)` `tests/test_config_watcher.py:50-56`
  (`ConfigWatcher.__new__`, `config_pb2.ConfigSnapshot()`, `snap.values[key].int_val = iv`).
- Second consumer arrives in Step 4 (`tests/test_ingest_servicer.py`, AC-5), so C-13 moves the helper to the
  canonical home `tests/conftest.py`, which exists.
- 173 tests that must keep passing: `test_get_int_present_honors_stored_zero` `test_config_watcher.py:59-68`
  (alias still resolves).

**TDD**: `red-green required`

**Covers**: `AC-1, AC-4` (ingest rows)

**Instructions**:
1. In `tests/conftest.py` add `snapshot_watcher(**values) -> ConfigWatcher`. It builds `ConfigWatcher.__new__`
   with a `config_pb2.ConfigSnapshot()`. Each value sets one oneof member by Python type: `bool` → `bool_val`, `int`
   → `int_val`, `float` → `float_val`, `str` → `string_val`. Check `bool` before `int`, because `bool` is a subclass
   of `int`. There is no `ConfigValue` pass-through arm here: every ingest row is a typed Python value (C-18).
2. Replace `_int_watcher`'s body in `test_config_watcher.py:50-56` with a call to `snapshot_watcher`, keeping the
   name so the 173 test is untouched.
3. Add `test_getters_honour_stored_zero`, parametrized over the three ingest @AC-1 rows:
   `ingest.test.zero_int` `0`/`get_int`/`7`, `ingest.test.zero_float` `0.0`/`get_float`/`0.5` and
   `ingest.test.zero_string` `""`/`get_str`/`"x"`. Assert `getattr(w, getter)(key, default) == stored`.
4. Add `test_getters_default_when_unset_or_mismatched`, parametrized over the three ingest @AC-4 rows:
   `ingest.test.unset_string` with the key absent, `ingest.test.mismatched_int` holding `float_val=2.5` and read via
   `get_int`, and `ingest.test.unset_float` with the key absent. Assert the default is returned.
5. RED before Step 1: the three @AC-1 rows return the default (`7`, `0.5`, `"x"`).

**Verification**:
```bash
cd services/xstockstrat-ingest && uv run pytest tests/test_config_watcher.py -q
uv run pytest --cov=app --cov-fail-under=40 && uv run ruff check . && uv run ruff format --check .
grep -n "snapshot_watcher" tests/conftest.py tests/test_config_watcher.py   # C-13: one definition, in conftest
```

---

### Step 3 — service: ingest FR-3 clamps, dead sandbox helpers removed

**Status**: `done`
**Service**: `xstockstrat-ingest`
**Files**:
- `services/xstockstrat-ingest/app/config/watcher.py` — modify
- `services/xstockstrat-ingest/app/engine/mcp_client_loop.py` — modify
- `services/xstockstrat-ingest/tests/test_ingest_servicer.py` — modify (delete the dead-helper tests only)

**Reviewers**: `xstockstrat-ingest` owner — Signal normalization correctness, idempotent ingestion, newsletter source schema stability

**Codebase Evidence**:
- Properties: `backfill_max_concurrent_jobs` `watcher.py:184-187` (trap comment `:185-186` cites stale
  `servicer.py:191`), `backfill_chunk_max_bars` `:199-200`, `backfill_chunk_window_days` `:203-204`,
  `backfill_max_concurrent_chunks` `:207-210` (trap comment `:208-209` cites stale `:519`).
- Real consumers: `servicer.py:323` (`asyncio.Semaphore(self._cfg.backfill_max_concurrent_jobs)`), `:749` (chunk
  semaphore), `:606-607` (planner inputs). Planner floors at `repositories/backfill_chunks.py:51-52` are a separate
  contract and stay (design §4).
- Loop reads: `mcp_client_loop.py:133-138` (`timeout = max(cfg_watcher.get_int("ingest.mcp_client.request_timeout_seconds", _DEFAULT_REQUEST_TIMEOUT_SECONDS), 1)`)
  and `:162-167` (poll interval, same shape). Named defaults are at `:30-31`. The docstring at `:157-159` says
  "clamped ≥ 1".
- Dead helpers: `watcher.py:166-180` (`sandbox_timeout_ms`, `sandbox_memory_bytes`, `sandbox_allowed_imports`), with
  no `app/` caller (recon.md:68,157). Their only tests are `tests/test_ingest_servicer.py:1125-1137`
  (`test_sandbox_timeout_default`, `test_sandbox_memory_default`, `test_sandbox_allowed_imports_default`).
- `make_servicer` sets the properties directly on a `MagicMock` (`tests/test_ingest_servicer.py:49-56`), so it
  bypasses the clamp. Dry run: ingest suite 328 passed with clamps applied.

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. In `watcher.py` add a module-level function after the class:
   `def int_positive(cfg, key, default): v = cfg.get_int(key, default); return v if v > 0 else default`. Add one
   constraint comment of 2 lines or fewer, saying `>0` because `Semaphore(-1)` and `sleep(-n)` also fail
   (design §2).
2. Properties `:187`, `:200`, `:204`, `:210` → `return int_positive(self, "<same key>", <same default>)`, keeping
   the existing literal default as the single argument (F-07, design §2).
3. Replace the trap comments `:185-186` and `:208-209` with a 1-line hazard comment naming the consumer symbol, not
   a line: `# >0: Semaphore(0) deadlocks IngestServicer._backfill_sem` and `… the per-job chunk semaphore in
   IngestServicer` (design §8).
4. `mcp_client_loop.py`: `from app.config.watcher import int_positive`. Replace `:133-138` with
   `timeout = int_positive(cfg_watcher, "ingest.mcp_client.request_timeout_seconds", _DEFAULT_REQUEST_TIMEOUT_SECONDS)`
   and `:162-167` with `interval = int_positive(cfg_watcher, "ingest.mcp_client.poll_interval_seconds", _DEFAULT_POLL_INTERVAL_SECONDS)`.
   The outer `max(…, 1)` is dropped as dead code (design §4). Update the `run_mcp_client_loop` docstring `:157-159`
   so it says a stored value ≤ 0 reads as the default.
5. Delete the dead helpers `watcher.py:166-180` and the three tests `tests/test_ingest_servicer.py:1125-1137`.
6. `max_retry_attempts` (`:195`), `dedup_window_hours` (`:215`) and `retry_on_failure` (`:191`) stay unclamped
   (feature-173 @AC-1/2/3).

**Verification**:
```bash
cd services/xstockstrat-ingest && grep -n "sandbox_" app/config/watcher.py   # expect no output
grep -n "int_positive" app/config/watcher.py app/engine/mcp_client_loop.py    # 1 def + 6 call sites
grep -n "max(" app/engine/mcp_client_loop.py                                  # no config-read wrapper left
```
Green run is Step 4's Verification.

---

### Step 4 — test: ingest @AC-5 / @AC-6 rows and the read-classification guard

**Status**: `done`
**Service**: `xstockstrat-ingest`
**Files**:
- `services/xstockstrat-ingest/tests/test_config_watcher.py` — modify
- `services/xstockstrat-ingest/tests/test_ingest_servicer.py` — modify
- `services/xstockstrat-ingest/tests/test_mcp_client_loop.py` — modify
- `services/xstockstrat-ingest/tests/test_config_read_classification.py` — create

**Reviewers**: `xstockstrat-ingest` owner — Signal normalization correctness, idempotent ingestion, newsletter source schema stability

**Codebase Evidence**:
- AC-5 construction: `IngestServicer.__init__(self, config_watcher, marketdata_channel, ledger_channel, db_pool=None, notify_channel=None)`
  `app/handlers/servicer.py:308-320`. `_backfill_sem` is built in `__init__` (`:323`), so the watcher must be passed
  to the constructor; assigning `svc._cfg` afterwards cannot observe it (design §9; recon.md:188-189).
- Loop double: `_FakeCfgWatcher(ints=…)` `tests/test_mcp_client_loop.py:56-67`, which returns a stored 0 as-is.
  Timeout-capture pattern: `test_cycle_reads_namespace_prefixed_request_timeout_key` `:111-126`
  (`mcp.calls[0]["timeout_seconds"]`).
- Poll loop: `run_mcp_client_loop` `mcp_client_loop.py:155-172` does `import asyncio` locally and calls
  `await asyncio.sleep(interval)`. Patch `asyncio.sleep` with `monkeypatch.setattr(asyncio, "sleep", fake)`, where
  the fake records its argument and raises to leave the `while True`.
- jscpd ignores `**/tests/**` (`.jscpd.json:27`), so the per-service guard copies trip no hook (design Rejected
  Alternatives).

**TDD**: `red-green required`

**Covers**: `AC-5, AC-6` (ingest rows)

**Instructions**:
1. **AC-5** in `test_ingest_servicer.py`: `w = snapshot_watcher(**{"ingest.backfill.max_concurrent_jobs": 0})`,
   `svc = IngestServicer(w, MagicMock(), MagicMock(), db_pool=None)`, assert `svc._backfill_sem._value == 3`.
2. **AC-6 watcher rows** in `test_config_watcher.py`, one parametrized test over a real `snapshot_watcher` at 0:
   - `backfill_max_concurrent_chunks` → 3
   - `backfill_chunk_max_bars` → 200000
   - `backfill_chunk_window_days` → 90

   Add a `-5` case for `backfill_max_concurrent_jobs` → 3 (the `>0` floor, design §2).
3. **AC-6 loop rows** in `test_mcp_client_loop.py`:
   - `request_timeout_seconds` 0: copy the `:111-126` test with `ints={"ingest.mcp_client.request_timeout_seconds": 0}`
     and assert `mcp.calls[0]["timeout_seconds"] == 30.0`. On the Step-1 tree it is 1.
   - `poll_interval_seconds` 0: drive `run_mcp_client_loop` with `_FakeCfgWatcher(ints={…: 0})` and the patched
     `asyncio.sleep`. Assert the first sleep argument is 300. On the Step-1 tree it is 1.
4. **Guard** `tests/test_config_read_classification.py` (design §7). It AST-scans `app/**/*.py`.
   - Read names: `get_int`, `get_float`, `get_str` and the `*_present` aliases, as attribute calls on any receiver.
   - Clamp names: `int_positive`, as a bare-name call. The bodies of functions named like a read or clamp are skipped.
   - Binding: a read binds `args[0]`/`args[1]` or `key=`/`default=`; a clamp binds `args[1]`/`args[2]` or the same
     keywords. A missing default resolves to the signature default (`get_int` → `0`, `get_float` → `0.0`,
     `get_str` → `""`).
   - Rules, each its own test function:
     1. The key is an `ast.Constant`; a non-constant or unbindable call fails, naming `path:line`.
     2. The read-key set equals `HONOUR_KEYS` and the clamp-key set equals `FR3_KEYS`, checked in both directions.
     3. The two sets are disjoint.
     4. Each key has exactly one distinct `ast.unparse(default)`.
     5. Every `HONOUR_KEYS` member matching the regex is in `ZERO_IS_LEGIT`, and `ZERO_IS_LEGIT` ⊆ `HONOUR_KEYS`.
     6. Every `FR3_KEYS` member appears as a `"<key>"` literal in some `tests/*.py` other than this file.
   - Constants: ingest values from the § Guard classification table. Expose `collect(app_dir)` at module level
     (Step 12 imports the analysis copy's).
5. RED on the Step-1 tree: AC-5 `_value == 0`; the watcher rows return 0; the loop rows return 1; guard rule 2 fails
   (the clamp set is empty and the reads include the FR-3 keys).
6. C-13: the snapshot values are scenario one-offs, written inline per test. The watcher builder is the conftest
   helper from Step 2.

**Verification**:
```bash
cd services/xstockstrat-ingest && uv run pytest tests/test_config_read_classification.py tests/test_config_watcher.py tests/test_mcp_client_loop.py tests/test_ingest_servicer.py -q
uv run pytest --cov=app --cov-fail-under=40 && uv run ruff check . && uv run ruff format --check .
grep -n "def snapshot_watcher\|from tests.conftest\|conftest" tests/*.py   # one definition site
```

---

### Step 5 — service: indicators getters honour a stored zero (HasField)

**Status**: `done`
**Service**: `xstockstrat-indicators`
**Files**:
- `services/xstockstrat-indicators/app/config/watcher.py` — modify

**Reviewers**: `xstockstrat-indicators` owner — Formula sandboxing, numeric precision, timeout enforcement (`indicators.sandbox.timeout_ms`), no side-effects from formula execution

**Codebase Evidence**:
- Trapped bodies: `watcher.py:96` (`get_str`), `:114` (`get_int`), `:130` (`get_float`).
- Target bodies: `get_str_present` `:98-106` and `get_bool` `:122` (recon.md:46-47).
- Indicators has no `get_int_present`/`get_float_present` (recon.md:31-33). None is added (design §1 aliases only the
  existing `*_present` methods; YAGNI).

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. `:96`, `:114` and `:130` take the `HasField("<member>")` body of `:106` / `:122`.
2. Delete the `get_str_present` body `:98-106` and add `get_str_present = get_str` after `get_str`. Its caller `:142-144`
   passes `default=` by keyword.
3. Leave the sandbox accessors `:132-148` untouched (Step 7).

**Verification**:
```bash
cd services/xstockstrat-indicators && grep -n 'or default' app/config/watcher.py   # expect no output
grep -n 'get_str_present = get_str' app/config/watcher.py
```
Green run is Step 6's Verification.

---

### Step 6 — test: indicators getter rows for @AC-1 / @AC-4

**Status**: `done`
**Service**: `xstockstrat-indicators`
**Files**:
- `services/xstockstrat-indicators/tests/conftest.py` — modify
- `services/xstockstrat-indicators/tests/test_config_watcher.py` — modify

**Reviewers**: `xstockstrat-indicators` owner — Formula sandboxing, numeric precision, timeout enforcement (`indicators.sandbox.timeout_ms`), no side-effects from formula execution

**Codebase Evidence**:
- `_str_watcher(key, val)` `tests/test_config_watcher.py:51-56` (`ConfigWatcher.__new__`, string arm only; design §9
  extends it with int/float arms).
- 243 rewrites the same helper: `origin/feature/fix-sandbox-seed-keys:docs/roadmap/features/243-fix-sandbox-seed-keys/implementation-spec.md:298-307`
  (generalize to `_watcher(key, field, val)`; callers `:60`, `:74`; "`_watcher` stays in this file"; `conftest` grep
  gate `:315`). 243 records this as soft ordering, where the second to land rebases (`:56-57`).
- 173 tests that must keep passing: `test_get_str_present_honors_empty` `:59-64` and
  `test_get_str_present_defaults_when_absent` `:66-69`.
- A second consumer arrives in Step 8 (`tests/test_execute_formula_concurrency.py`), so C-13 puts the builder in
  `tests/conftest.py`.

**TDD**: `red-green required`

**Covers**: `AC-1, AC-4` (indicators rows)

**Instructions**:
1. Add the same `snapshot_watcher(**values)` builder as Step 2 to `tests/conftest.py`. It is a per-service home;
   jscpd ignores tests. Then re-point the helper that is on the base (§ Step Dependencies, 243 test-helper overlap):
   - 243 not landed: `_str_watcher(key, val)` → `return snapshot_watcher(**{key: val})`.
   - 243 landed: `_watcher(key, field, val)` keeps its name, signature and file (243 Step 3 instruction 3). Its body
     builds a `config_pb2.ConfigValue()`, runs `setattr(cv, field, val)` and returns `snapshot_watcher(**{key: cv})`.
     Only in this case, add a `ConfigValue` arm to the indicators builder that `CopyFrom`s the value as-is.
     243's Step 3 `conftest` grep gate was a 243-time check, and it does not apply after 244.
2. Parametrized @AC-1 test over three rows: `indicators.test.zero_int` `0`/`get_int`/`7`,
   `indicators.test.zero_float` `0.0`/`get_float`/`0.5` and `indicators.test.zero_string` `""`/`get_str`/`"x"`.
3. Parametrized @AC-4 test over three rows:
   - `indicators.test.unset_int`: `_snapshot = None` → 7
   - `indicators.test.mismatched_float`: holds `string_val="5"`, read via `get_float` → 0.5
   - `indicators.test.unset_string`: key absent → `"x"`
4. RED before Step 5: the @AC-1 rows return the defaults.

**Verification**:
```bash
cd services/xstockstrat-indicators && uv run pytest tests/test_config_watcher.py -q
uv run pytest --cov=app --cov-fail-under=50 && uv run ruff check . && uv run ruff format --check .
```

---

### Step 7 — service: indicators sandbox accessors clamp a stored zero

**Status**: `done`
**Service**: `xstockstrat-indicators`
**Files**:
- `services/xstockstrat-indicators/app/config/watcher.py` — modify
- `services/xstockstrat-indicators/app/handlers/servicer.py` — modify

**Reviewers**: `xstockstrat-indicators` owner — Formula sandboxing, numeric precision, timeout enforcement (`indicators.sandbox.timeout_ms`), no side-effects from formula execution

**Codebase Evidence**:
- Accessors: `sandbox_timeout_ms` `watcher.py:132-134`, `sandbox_memory_bytes` `:136-138`,
  `sandbox_max_concurrent()` `:147-148`.
- Consumers:
  - `servicer.py:107` (`asyncio.Semaphore(max(1, config_watcher.sandbox_max_concurrent()))`)
  - `:282` (`timeout_ms = _clamp_override(request.timeout_ms_override, self._cfg.sandbox_timeout_ms)`) and `:283-285`
    (`_clamp_override(request.memory_bytes_override, self._cfg.sandbox_memory_bytes)`). `_clamp_override` `:66-68` is
    `min(override, configured) if override > 0 else configured`, so a stored-zero `configured` still reaches the
    sandbox (and pins any override to 0). It takes `configured` from the accessor, so the accessor clamp covers it.
  - `:310` (`max_concurrent=self._cfg.sandbox_max_concurrent()`, unclamped → `sandbox.py:346` `rlimit_nproc = max_concurrent * 16`)
  - `sandbox.py:282` (`if {memory_bytes} > 0:` skips `RLIMIT_DATA`)
- Clamp in the accessor so `:310` and `_clamp_override` are covered without a third copy of the defaults (`sandbox.py:332-335` already holds
  one; recon.md:180-181, 328-330; design §3).
- Every servicer test double sets these attributes directly (e.g. `tests/test_execute_formula_concurrency.py:31-37`,
  `tests/test_formulas.py:19-22`, `tests/test_execute_formula_override_clamp.py` `_cfg()` `:20-26`), so it bypasses the
  accessor and stays green. Dry run: 290 passed (before main-dev added the override-clamp test file).

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. Add the module-level `int_positive(cfg, key, default)` to `watcher.py` (same body as Step 3).
2. `:134`, `:138` and `:148` → `return int_positive(self, "<same key>", <same default>)`.
3. `servicer.py:107` → `asyncio.Semaphore(config_watcher.sandbox_max_concurrent())`. `_clamp_override` (`:66-68`) stays
   unchanged. The `max(1, …)` is subsumed
   (design §4).
4. `sandbox_allowed_imports` (`:140-145`) stays `get_str_present`, which honours `""` (feature-173 @AC-4).

**Verification**:
```bash
cd services/xstockstrat-indicators && grep -n "int_positive" app/config/watcher.py   # 1 def + 3 calls
grep -n "max(1" app/handlers/servicer.py                                             # expect no output
```
Green run is Step 8's Verification.

---

### Step 8 — test: indicators @AC-6 rows and the read-classification guard

**Status**: `done`
**Service**: `xstockstrat-indicators`
**Files**:
- `services/xstockstrat-indicators/tests/test_config_watcher.py` — modify
- `services/xstockstrat-indicators/tests/test_execute_formula_concurrency.py` — modify
- `services/xstockstrat-indicators/tests/test_config_read_classification.py` — create

**Reviewers**: `xstockstrat-indicators` owner — Formula sandboxing, numeric precision, timeout enforcement (`indicators.sandbox.timeout_ms`), no side-effects from formula execution

**Codebase Evidence**:
- `IndicatorsServicer.__init__(self, config_watcher, db_pool=None, ledger_channel=None)` `servicer.py:93`. The
  semaphore is built at `:107`.
- Capture double: `_blocking_execute_double` `tests/test_execute_formula_concurrency.py:40-63`. Semaphore-bound
  pattern: `test_semaphore_gates_at_configured_bound` `:93-106` (recon.md:190-191). It calls
  `monkeypatch.setattr(sandbox, "execute_formula", …)` and passes `_exec_req()` / `ctx_with(OWNER_HEADERS)`.

**TDD**: `red-green required`

**Covers**: `AC-6` (indicators rows)

**Instructions**:
1. Accessor rows in `test_config_watcher.py`, using a real `snapshot_watcher` at 0:
   - `sandbox_timeout_ms` → 5000
   - `sandbox_memory_bytes` → 134217728
   - `sandbox_max_concurrent()` → 4

   Add a `-1` case for `memory_bytes` → 134217728.
2. Servicer rows in `test_execute_formula_concurrency.py` with
   `w = snapshot_watcher(**{"indicators.sandbox.max_concurrent": 0, "indicators.sandbox.allowed_imports": ""})`:
   - `IndicatorsServicer(config_watcher=w)._sandbox_sem._value == 4`.
   - With `sandbox.execute_formula` monkeypatched to a recorder, one `ExecuteFormula` passes `max_concurrent == 4`,
     `timeout_ms == 5000` and `memory_bytes == 134217728`. This is the `:310` / `RLIMIT_NPROC` path, plus `:282-285`
     through `_clamp_override` with no override set.
3. Guard file: the same structure as Step 4, with `FR3_KEYS` = the three sandbox int keys,
   `HONOUR_KEYS = {"indicators.sandbox.allowed_imports"}` and `ZERO_IS_LEGIT = {}`. The dry-run scan found the
   keyword-default call at `watcher.py:142-144` bindable.
4. RED on the Step-5 tree: the accessors return 0; the servicer recorder sees `max_concurrent == 0`; guard rule 2
   fails.

**Verification**:
```bash
cd services/xstockstrat-indicators && uv run pytest tests/test_config_read_classification.py tests/test_config_watcher.py tests/test_execute_formula_concurrency.py -q
uv run pytest --cov=app --cov-fail-under=50 && uv run ruff check . && uv run ruff format --check .
```

---

### Step 9 — service: analysis getters honour a stored zero (HasField)

**Status**: `done`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/app/config/watcher.py` — modify

**Reviewers**: `xstockstrat-analysis` owner — Backtest reproducibility, strategy scoring determinism, no look-ahead bias

**Codebase Evidence**:
- Trapped bodies: `watcher.py:97` (`get_str`), `:105` (`get_int`), `:134` (`get_float`).
- Target bodies: `get_int_present` `:107-118`, `get_bool` `:126`, `get_float_present` `:136-147` (recon.md:28-35).
- The same class serves the `marketdata` namespace watcher (`app/main.py:48`). Its one read
  (`fundsignal_loop.py:97`, default `""`) is unaffected.
- FR-4 sites fixed by the getter alone, with no edit:
  - `servicer.py:787-788` (commission/slippage)
  - `:4615` and `:4859` (`signal_rank_weight`)
  - `live_loop.py:351` (`alert_throttle_seconds`)

  (design §3 "FR-4 reads need no edit").

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. `:97`, `:105` and `:134` take the `HasField` body.
2. Delete the `get_int_present` (`:107-118`) and `get_float_present` (`:136-147`) bodies and docstrings. Add
   `get_int_present = get_int` after `get_int` and `get_float_present = get_float` after `get_float`. Positional
   callers such as `servicer.py:1173` (`get_int_present("…", 0)`) still bind.
3. Leave the dead sandbox helpers `:149-162` for Step 11.

**Verification**:
```bash
cd services/xstockstrat-analysis && grep -n 'or default' app/config/watcher.py   # expect no output
grep -n '_present = get_' app/config/watcher.py                                  # 2 hits
```
Green run is Step 10's Verification.

---

### Step 10 — test: analysis getter rows, FR-4 behaviours and zero-honour sites (@AC-1, @AC-2, @AC-3, @AC-4, @AC-9, @AC-12)

**Status**: `done`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/tests/conftest.py` — modify
- `services/xstockstrat-analysis/tests/test_analysis_servicer.py` — modify
- `services/xstockstrat-analysis/tests/test_fill_model.py` — modify
- `services/xstockstrat-analysis/tests/test_opportunities_repo.py` — modify
- `services/xstockstrat-analysis/tests/test_live_loop.py` — modify
- `services/xstockstrat-analysis/tests/test_screener.py` — modify
- `services/xstockstrat-analysis/tests/test_query_pnl_patterns.py` — modify

**Reviewers**: `xstockstrat-analysis` owner — Backtest reproducibility, strategy scoring determinism, no look-ahead bias

**Codebase Evidence**:
- AC-12:
  - Screener: `make_cfg(**overrides)` `tests/test_screener.py:18-29`;
    `ScreenerEngine(marketdata, indicators, ingest, cfg, source_weights, compute_executor=None)`
    `services/screener.py:78-86`; rank cap `:177-181` (`if rank_limit > 0:`); rank-limit tests `:404-460`.
  - Patterns: `tests/test_query_pnl_patterns.py:80-100` (`servicer._cfg.get_int = lambda k, d: …`).
    `bucket_pnl_factors(samples, *, min_sample, bucket_count)` is at `servicer.py:366`; it drops buckets
    `< min_sample` (`:399`, `:415`); the read is at `:4265`.
- Real watcher stub: `_StubWatcher(ConfigWatcher)` `tests/test_analysis_servicer.py:483-488`. It sets `endpoint`,
  `namespace="analysis"`, `_snapshot` and `_snapshot_event`. It is already imported by a second file
  (`tests/test_read_budget_real_pg.py:18`).
- Trap-pinning assertion to rewrite: `test_get_float_present_explicit_zero_is_not_trapped` `:586-594`
  (`assert w.get_float("k", 24.0) == 24.0  # contrast: the old zero-trap`; recon.md:344-345; design §9).
- AC-2 harness:
  - `_bar(day, close, open_)` `tests/test_fill_model.py:39`
  - `TestRunBacktestFillModelRouting._svc_req` `:233-238` (`_wire_evaluated(make_servicer(), _series_bars(6, 12))`, `_windowed_req(_sma_def())`)
  - `svc.RunBacktest(req, context=_owned_ctx())` `:244`
  - `RunBacktest` reads commission/slippage at `servicer.py:787-788` and applies them at `:196-214` (`px * (1 + slippage)`,
    `cost = … * (1 + commission)`, `pnl = proceeds - …`).
- AC-3:
  - `_read_opportunity_queue(self, opps, state_repo, user_id, request, offset, q)` `servicer.py:4612` reads `w` at
    `:4615` and passes it to `opps.read(…, w, …)` at `:4619-4622`.
  - The sort-0 ORDER BY text `_SORT_ORDER_BY[0]` `app/repositories/opportunities.py:35-40` is the feature-200 symbol
    roll-up `MAX(((1 - $3) * o.conviction + $3 * o.signal_axis)) OVER (PARTITION BY o.symbol) DESC, o.symbol ASC, ...`.
    It references only `$3`; the window function is valid in ORDER BY over the VALUES subquery, and with distinct
    symbols the expected AAA/BBB orders hold. The repo clamps w to `[0,1]` at `:224`.
  - Real-SQL harness: the `local_pg` session fixture `tests/conftest.py:367-` (marker `real_pg`, `pyproject.toml:33`;
    CI installs PostgreSQL in the `install postgresql (analysis real_pg tests)` step, `.github/workflows/ci.yml:400-404`).
  - Existing SQL-text tests: `tests/test_opportunities_repo.py:149-164`.
- AC-9:
  - `_run_cycle` reads `throttle` at `live_loop.py:351` and passes it to `_eval_pair(definition, symbol, throttle, …)`
    (`:454`, def `:672`). The check is at `:815`.
  - Harnesses: `_make_loop` `tests/test_live_loop.py:36-58`; the fair-share `_run_cycle` fixtures `:690-` (`loop._db.fetch = AsyncMock(…)`);
    the `_last_alert_ts` pre-seed pattern `:204-205`.
- `make_servicer()` `tests/test_analysis_servicer.py:36-60` stubs every getter with `side_effect=default`. The aliases
  keep its `get_int_present`/`get_float_present` stubs meaningful (fails.md:1395).

**TDD**: `red-green required`

**Covers**: `AC-1, AC-2, AC-3, AC-4, AC-9, AC-12` (analysis rows)

**Instructions**:
1. `tests/conftest.py`: add `snapshot_watcher(**values)`. It has the same typed-arm rules as Step 2 and returns a
   `ConfigWatcher.__new__` instance carrying `_StubWatcher`'s attributes (`endpoint`, `namespace="analysis"`,
   `_snapshot_event=asyncio.Event()`). This file and Step 12's are the two consumers (C-13).
2. Rewrite `:586-594`: keep the `get_float_present` zero assertion. Replace the `:594` contrast with
   `assert w.get_float("k", 24.0) == 0.0` and update the `:587-588` comment so it states the HasField contract, not
   the trap.
3. **AC-1 / AC-4 analysis rows** (new tests in `test_analysis_servicer.py` `TestConfigWatcherGetters`).
   - @AC-1:
     - `analysis.opportunity.signal_rank_weight` `0.0` via `get_float` with default `0.3` → `0.0`
     - `analysis.engine.alert_throttle_seconds` `0` via `get_int` with default `300` → `0`
     - `analysis.test.zero_string` `""` via `get_str` with default `"x"` → `""`
   - @AC-4:
     - `default_commission_pct` absent → `0.001`
     - `alert_throttle_seconds` absent → `300`
     - `analysis.test.unset_string` with `_snapshot = None` → `"x"`
4. **AC-2** (`test_fill_model.py`), in two parts.
   - Seam:
     - Build the servicer with `self._svc_req()` (`:233-238`) and set
       `svc._cfg = snapshot_watcher(**{"analysis.backtest.default_commission_pct": 0.0, "analysis.backtest.default_slippage_pct": 0.0})`,
       with no `default_fill_model` key.
     - Wrap `svc._backtest_symbol_evaluated` (`servicer.py:1995`, called at `:1005-1012` with `commission=`/`slippage=`
       keywords) in a recorder that delegates to the original.
     - Run `RunBacktest` and assert the recorded `commission == 0.0` and `slippage == 0.0`. RED pre-Step-9:
       `0.001` / `0.0005`.
   - Effect: `_run_eval(bars, _decisions(4, entries=[1], exits=[2]), SAME)` (`:63-86`, which already passes
     commission and slippage `0.0`). Use bars `_bar(d, close=…, open_=…)` with `bars[1].close = 100.0` and
     `bars[2].close = 110.0`. Assert, on `TradeRecord` fields (`packages/proto/analysis/v1/analysis.proto:172-181`):
     - `trades[0].entry_price == pytest.approx(100.0)`
     - `exit_price == pytest.approx(110.0)`
     - `pnl == pytest.approx(trades[0].qty * 10.0)`
   - Together the two parts give the scenario: config 0 reaches the simulator, and the simulator applies no cost
     at 0 (`servicer.py:196-214`).
5. **AC-3** (`test_opportunities_repo.py`), in two parts.
   - Seam: `svc._cfg = snapshot_watcher(**{"analysis.opportunity.signal_rank_weight": 0.0})`. Call
     `_read_opportunity_queue` with an `AsyncMock` `opps` (`read` returns `[]`) and assert the weight argument of
     `opps.read` is `0.0`. RED: 0.3.
   - Order (marker `real_pg`, fixture `local_pg`): execute
     `SELECT symbol FROM (VALUES ('AAA',0.90::float8,0.00::float8,'k1'),('BBB',0.50::float8,1.00::float8,'k2')) AS o(symbol,conviction,signal_axis,opportunity_key) ORDER BY <order_by>`.
     Here `order_by = _SORT_ORDER_BY[0].replace("$3", "$1::float8")`, with one bound arg (the weight).
     - Why the rebind: the text references only `$3` (`opportunities.py:35-40`). Binding it as `$3` leaves `$1`/`$2`
       unreferenced, which raises `IndeterminateDatatypeError` (fails.md:190; `tests/test_opportunities_repo.py:149-164`).
     - Why the cast: a bare `1 - $n` infers `int4` and rejects `0.0`. Production anchors the type with
       `$3::double precision IS NOT NULL` (`opportunities.py:243-246`).
     - Weight `0.0` → assert `["AAA","BBB"]`. Weight `0.3` → assert `["BBB","AAA"]`, the feature-file comment's
       fail-on-bug contrast. This part needs no schema.
6. **AC-9** (`test_live_loop.py`), in two parts.
   - Seam: `loop = _make_loop()`; `loop._cfg = snapshot_watcher(**{"analysis.engine.alert_throttle_seconds": 0})`.
     Set `loop._eval_pair = AsyncMock()`, seed one live pair through the fair-share `_db.fetch` fixtures, then
     `await loop._run_cycle()`. Assert the `throttle` argument is `0`. RED: 300.
   - Effect: set `loop._last_alert_ts[("u1", "S1", "AAPL")] = time.monotonic() - 10`, then
     `await loop._eval_pair(defn, "AAPL", throttle=0)` with a decision that yields an ungated exit transition. Follow
     the `:204-205` pattern, with `defn` owned by `u1`, id `S1`. Assert `loop._notify.EmitAlert` is awaited.
7. **AC-12**: these honour sites are fixed by the getter alone, so they are RED before Step 9.
   - Screener (`test_screener.py`):
     - Setup: a `ScreenerEngine` (`services/screener.py:78`) whose cfg is a real `snapshot_watcher` with
       `analysis.screener.default_rank_limit` = 0. Give it a request of 51 passing symbols with `rank_limit` unset,
       built from the `:404-460` fakes.
     - Assert 51 results. RED: 50 (the cap at `:177-181`).
   - Patterns (`test_query_pnl_patterns.py`):
     - Setup: monkeypatch `app.handlers.servicer.bucket_pnl_factors` with a recorder and set
       `servicer._cfg = snapshot_watcher(**{"analysis.patterns.min_sample_count": 0})`.
     - Call `QueryPnLPatterns` (`:94-96` pattern) and assert the recorded `min_sample == 0`. RED: 5.
8. C-13: snapshot values are inline per-scenario one-offs; the builder lives in conftest.

**Verification**:
```bash
cd services/xstockstrat-analysis && uv run pytest tests/test_analysis_servicer.py tests/test_fill_model.py tests/test_opportunities_repo.py tests/test_live_loop.py tests/test_screener.py tests/test_query_pnl_patterns.py -q
uv run pytest --cov=app --cov-fail-under=40 && uv run ruff check . && uv run ruff format --check .
grep -n "def snapshot_watcher" tests/*.py   # exactly one hit, tests/conftest.py
```

---

### Step 11 — service: analysis FR-3 clamps, named readers, `max(1, …)` and inline-clamp conversion

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/app/config/watcher.py` — modify
- `services/xstockstrat-analysis/app/handlers/servicer.py` — modify
- `services/xstockstrat-analysis/app/engine/live_loop.py` — modify
- `services/xstockstrat-analysis/app/engine/fundsignal_loop.py` — modify
- `services/xstockstrat-analysis/app/engine/entry_backfill.py` — modify
- `services/xstockstrat-analysis/app/engine/pnl_pattern_consumer.py` — modify
- `services/xstockstrat-analysis/app/services/screener.py` — modify
- `services/xstockstrat-analysis/tests/test_analysis_servicer.py` — modify (delete the dead-helper tests only)

**Reviewers**: `xstockstrat-analysis` owner — Backtest reproducibility, strategy scoring determinism, no look-ahead bias

**Codebase Evidence** (each a `get_*` call re-grepped 2026-10-21; matches recon.md:94-134):
- `servicer.py` `__init__` semaphores and pool:
  - `:538` `max(1, …series.max_concurrent_components, 4)`
  - `:543` `opportunity.max_concurrent_bars_fetches, 2`
  - `:549` `opportunity.max_concurrent_candidates, 4`
  - `:556` `max_workers=max(1, …compute.max_worker_threads, 4)`
  - `:582-587` `readiness_materializer.max_concurrent_bars_fetches, 2`
  - stale comments `:536`, `:581` ("max(1, …) guards a negative")
- Named reader pattern: `blend_strategy_id(cfg)` `servicer.py:353-355` (sole reader). `live_loop.py:38-46` imports
  from `app.handlers.servicer`. `fundsignal_loop.py:30-31` imports only `durable_schedule`/`identity`, so
  `live_loop` → `fundsignal_loop` adds no cycle (design §6).
- RunBacktest:
  - `:787-790` reads plus the trap comment at `:789-790`
  - `:874` `max_range_days, 730`
  - `:1152-1159` (comment, `portfolio_position_weight` float `0.10`, `max(1, portfolio_max_concurrent, 9)`)
  - `:1167` and `:2130` `default_cooldown_days, 31`
  - `:2132-2133` exit-cooldown comment
  - `:2672` `shrinkage_days, 250`
  - `:2912-2914` (comment, `max(1, detail_retention_per_strategy, 20)`)
- Screener: `:3786` `max_duration_seconds, 120`.
- `:4265-4266` `min_sample_count` (honour), `indicator_bucket_count, 5`.
- Inline clamps: `:4545-4549` (`read_db_budget_ms` / `_DEFAULT_OPP_READ_DB_BUDGET_MS`) and `:4701-4705`
  (`live_enrich_timeout_ms` / `_DEFAULT_OPP_LIVE_ENRICH_TIMEOUT_MS`), constants at `:339-340` (design §5).
- Opportunity compute:
  - `:4873` and `:5510` `valid_window_hours, 24`
  - `:5294-5296` `max_live_strategies_per_symbol, 5`
  - `:5346-5348` `max_live_held_symbols_per_compute, 20`
  - `:5382-5384` `max_live_only_symbols_per_compute, 20`
  - `:5470` `opportunity.max_universe_size, 100`
  - `:6166` `snooze_default_hours, 24`
- `live_loop.py`:
  - `:162` `fundsignal.source_slug`
  - `:329` `eval_interval_seconds, default=60`
  - `:350` `max_strategies_per_cycle, default=50`
  - `:748` `default_cooldown_days`
  - `:750-751` exit-cooldown comment
- `fundsignal_loop.py`:
  - `:137-138` and `:148-151` `run_interval_hours, default=24` wrapped `max(1, …) * 3600`
  - `:171` `source_slug`
  - `:181` `max_symbols_per_run, default=200`
  - `:222` `daily_call_budget, default=200`
  - `:232` `valid_days, default=90`
  - The `retry_seconds` wrappers `:142-144` and `:154` stay (design §4).
- Other modules:
  - `entry_backfill.py:56-58` `max(1, …max_concurrent_entry_backfill, 4)`
  - `pnl_pattern_consumer.py:364-365` `snapshot.*_timeout_ms, 500`
  - `services/screener.py:84-86` `max(1, …max_concurrent_formula_evals, 4)` and `:92` `screener.max_universe_size, 100`
- Dead helpers `watcher.py:149-162`; their only tests are `tests/test_analysis_servicer.py:596-608`
  (`test_sandbox_timeout_default`, `test_sandbox_memory_default`, `test_sandbox_allowed_imports_default`).
- Kept unchanged:
  - the present-aware `retry_seconds` wrappers `servicer.py:5890,6066` and `fundsignal_loop.py:143,154`
  - `empty_recompute_ttl_seconds` `servicer.py:4787-4789`
  - the consumer floors `services/readiness.py:35`, `bucket_pnl_factors` `servicer.py:387`

  (design §4).
- Dry run of this wrapping: 1274 passed. The only failure is `test_retention_clamped_to_at_least_one`, which flips on
  purpose (Step 12).

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. **Helpers** (`watcher.py`, module level, after the class):
   - `int_positive(cfg, key, default)`: `v = cfg.get_int(key, default)`; return `v` if `v > 0` else `default`.
   - `float_positive(cfg, key, default)`: same shape with `get_float`.
   - `str_nonempty(cfg, key, default)`: `v = cfg.get_str(key, default)`; return `v` if `v` else `default`.

   Each calls `cfg.get_*`, so `MagicMock` `side_effect` overrides still reach the read (design §2; feature-186
   @AC-8 test `test_analysis_servicer.py:762-768`). Add one constraint comment of 2 lines or fewer, stating why the
   floor is `>0`.
2. **Named readers** (design §6):
   - `def default_cooldown_days(cfg) -> int: return int_positive(cfg, "analysis.strategy.default_cooldown_days", 31)`
     next to `blend_strategy_id` in `servicer.py`. Replace `:1167` and `:2130` with `default_cooldown_days(self._cfg)`.
     In `live_loop.py`, import it from `app.handlers.servicer` and replace `:748`.
   - `def fundsignal_source_slug(cfg) -> str: return str_nonempty(cfg, "analysis.fundsignal.source_slug", "fundamentals")`
     at module level in `fundsignal_loop.py`. Replace `:171` with it. In `live_loop.py`, import it from
     `app.engine.fundsignal_loop` and replace `:162`.
   - `blend_strategy_id` `:355` → `return str_nonempty(cfg, "analysis.engine.fundamentals_blend_strategy_id", "fundamentals_macd_blend")`.
3. **Clamp every other `FR3_KEYS` site** (§ Guard classification table). Each becomes
   `int_positive(<receiver>, "<key>", <same default>)`, or `float_positive` for `portfolio_position_weight`
   (`:1154-1156`). Each keeps its existing default literal or constant as the single argument (F-07).
4. **Remove the read-site `max(1, …)` wrappers** at the exhaustive list (design §4):
   - `servicer.py:538`, `:543`, `:549`, `:556`, `:582-587`, `:1157-1159`, `:2914`
   - `entry_backfill.py:56-58`
   - `services/screener.py:84-86`
   - `fundsignal_loop.py:137-138` and `:148-151`: drop `max(1, interval_hours)` and keep the `* 3600`

   `int_positive` is the whole argument at each site.
5. **Inline clamps** `:4545-4549` and `:4701-4705` → a single
   `budget_ms = int_positive(self._cfg, "analysis.opportunity.read_db_budget_ms", _DEFAULT_OPP_READ_DB_BUDGET_MS)`
   (and the same shape for `enrich_ms`). Delete the two `if … <= 0` blocks.
6. **Comments** (design §8; symbol-named, at most 2 lines, no line numbers):
   - Rewrite `:789-790`: `default_fill_model` 0 = legacy whether stored or absent (fails.md:1877).
   - Rewrite `:1152-1153`, `:2912-2913` and `:536`/`:581` so they state the `>0` clamp, not the trap.
   - Drop the "not get_int / must not be zero-trapped" mechanism clause from `:2132-2133` and `live_loop.py:750-751`,
     keeping the constraint that a configured 0 is legitimate.
7. Delete the dead helpers `watcher.py:149-162` and their tests `tests/test_analysis_servicer.py:596-608`.
8. Do **not** touch: the honour reads; the `retry_seconds` wrappers (`servicer.py:5890,6066`,
   `fundsignal_loop.py:142-144,154`); the `startup_jitter` `max(0, …)` floors; `servicer.py:4787-4789`; and the
   `bucket_pnl_factors` floor `:387`.

**Verification**:
```bash
cd services/xstockstrat-analysis && grep -rn "max(1, self._cfg.get_int\|max(1, cfg.get_int\|max(1, cfg_watcher.get_int\|max(1, interval_hours)" app   # expect no output
grep -rn "int_positive\|float_positive\|str_nonempty" app | wc -l
grep -n "sandbox_" app/config/watcher.py                                           # expect no output
grep -n "def default_cooldown_days\|def fundsignal_source_slug" app/handlers/servicer.py app/engine/fundsignal_loop.py
```
Green run is Step 12's Verification.

---

### Step 12 — test: analysis @AC-6 / @AC-7, the guard, and the retention flip

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/tests/test_config_read_classification.py` — create
- `services/xstockstrat-analysis/tests/test_config_zero_clamps.py` — create
- `services/xstockstrat-analysis/tests/test_analysis_servicer.py` — modify

**Reviewers**: `xstockstrat-analysis` owner — Backtest reproducibility, strategy scoring determinism, no look-ahead bias

**Codebase Evidence**:
- Retention test to flip: `test_retention_clamped_to_at_least_one` `tests/test_analysis_servicer.py:2527-2541`.
  It overrides `get_int` to return -5 and asserts
  `svc._backtest_details_repo.insert.await_args.kwargs["retention"] == 1` (design §4, C-18 deviation).
- `AnalysisServicer(cfg, marketdata_channel=, indicators_channel=, ingest_channel=, ledger_channel=)`
  `tests/test_analysis_servicer.py:54-60`. Its semaphores are attributes (`servicer.py:537-587`).
- Fundsignal: `FundamentalsSignalLoop._tick` `fundsignal_loop.py:128-156` returns the sleep seconds; when disabled it
  returns `interval_hours * 3600` (`:136-138`). Harness: `_make_loop` `tests/test_fundsignal_loop.py:45` and `_sched_loop` `:379`
  (a usage at `:393-402`).
- Screener: `ScreenerEngine(marketdata, indicators, ingest, cfg, source_weights, compute_executor=None)`
  `services/screener.py:78-86`; semaphore `self._sem` `:84-86`.
- AC-7 seams: `_opportunity_refresh_hour` `servicer.py:5869-5872` and `_readiness_materializer_hour` `:5934-5938`.
- Ledger: the guard is a tripwire; runtime rows are the proof (design §7; fails.md:2660).

**TDD**: `red-green required`

**Covers**: `AC-6` (analysis rows), `AC-7`

**Instructions**:
1. **Guard** `tests/test_config_read_classification.py`. It has the same structure and rules as Step 4, with:
   - clamp names `int_positive`, `float_positive`, `str_nonempty`
   - the 34 analysis `FR3_KEYS`, the 36 `HONOUR_KEYS` and the 8-entry `ZERO_IS_LEGIT` from the tables above
   - `collect(app_dir)` exposed. It returns, per key, the set of `(module_dotted_path, default_source)`.
2. **AC-6 table** `tests/test_config_zero_clamps.py`. Parametrize over the 34 FR-3 analysis @AC-6 rows as
   `(key, type, effective)`, copied from `acceptance.feature`. The `default_fill_model` honour row is a site seam
   in item 3, not part of this table.
   - Resolve the site's default through `collect()`. Rule 4 guarantees one default per key.
   - Evaluate it with `eval(default_source, vars(importlib.import_module(module)))`. That covers module constants and
     `128 * 1024 * 1024`.
   - Assert `<clamp>(snapshot_watcher(**{key: zero}), key, default) == effective`.
   - Add a `-5` case for one int key.
   - Its literals satisfy guard rule 6.
3. **AC-6 site seams** (runtime, real `snapshot_watcher` with every listed key stored at 0):
   - `AnalysisServicer(w, …)`:
     - `_component_series_sem._value == 4`
     - `_bars_fetch_sem._value == 2`
     - `_candidates_sem._value == 4`
     - `_compute_executor._max_workers == 4`
     - `_readiness_materializer_bars_sem._value == 2`
   - `blend_strategy_id(w) == "fundamentals_macd_blend"`, `default_cooldown_days(w) == 31`,
     `fundsignal_source_slug(w) == "fundamentals"`.
   - `ScreenerEngine(MagicMock(), MagicMock(), MagicMock(), w, {})._sem._value == 4`.
   - Fundsignal `_tick()`: with `enabled` unset (default False), `_next_sleep_seconds` patched to return 0 and
     `run_interval_hours` 0, it returns `86400`.
   - `default_fill_model` 0 → the RunBacktest result `fill_model == FILL_MODEL_SAME_BAR_CLOSE`. Use the
     `test_fill_model.py:251-259` pattern with `svc._cfg = w`.
   - Flip `:2527-2541`: rename it `test_retention_non_positive_reads_as_default` and parametrize `-5` and `0`. Both
     assert `retention == 20`.
4. **AC-7** (`test_config_zero_clamps.py`):
   - `svc._cfg = snapshot_watcher(**{"analysis.opportunity.refresh_hour_utc": 0, "analysis.readiness_materializer.refresh_hour_utc": 0})`:
     `_opportunity_refresh_hour() == 0` and `_readiness_materializer_hour() == 0`.
   - `min_conviction_to_emit` `0.0`, `scoring_formula_id` `""` and `explicit_symbols` `""` each read back as stored
     through a real watcher.
   - Assert all five keys are in the guard's `HONOUR_KEYS`, not in `FR3_KEYS`. This is the over-clamp tripwire,
     which fails if any of them is clamped.
   - AC-7 passes before and after (product-spec § Acceptance Criteria). It is a characterization row inside this
     red-green cycle.
5. RED on the Step-9 tree:
   - every AC-6 seam returns 0, `""` or 1
   - the table rows fail at `collect()`, because no clamp call exists for the key
   - the retention flip sees 1
   - guard rule 2 fails

**Verification**:
```bash
cd services/xstockstrat-analysis && uv run pytest tests/test_config_read_classification.py tests/test_config_zero_clamps.py tests/test_analysis_servicer.py tests/test_fill_model.py tests/test_fundsignal_loop.py -q
uv run pytest --cov=app --cov-fail-under=40 && uv run ruff check . && uv run ruff format --check .
grep -n "def snapshot_watcher\|from tests.conftest" tests/*.py   # one definition site (C-13)
```

---

### Step 13 — service: config bounds comments match the new getter semantics (FR-6)

**Status**: `pending`
**Service**: `xstockstrat-config`
**Files**:
- `services/xstockstrat-config/src/grpc/configServiceImpl.ts` — modify (comments only)

**Reviewers**: `xstockstrat-config` owner — Config key naming (`<service>.<category>.<key>`), environment (`production`/`staging`) / global-per-user scoping, secret encryption + redaction, WatchConfig stream stability

**Codebase Evidence**:
- `SCALAR_BOUNDS_REGISTRY` `configServiceImpl.ts:100-146` is write-only (`:96-99`).
- Stale comments:
  - `:109-111` ("min 1 — 0 is not 'unlimited' (the get_int reader would collapse it to 2)")
  - `:113-117` ("Lower 0 where the getter honors a legitimate 0 …; lower 1 on get_int zero-trap keys where 0 already
    collapses to the code default")
- No row changes (design §11): `minValue: 1` rows `:108`, `:112`, `:119`, `:121-127`; `minValue: 0` rows `:101`,
  `:104`, `:107`, `:118`, `:120`.

**TDD**: `red-green required` — red N/A: comment-only, no behaviour change. Step 14 adds characterization tests
(tdd-gate escape, stated in the PR body and `context.md`).

**Covers**: —

**Instructions**:
1. Rewrite `:109-111`'s last clause as: min 1 because a Python reader clamps ≤ 0 to the default, so 0 is never
   "unlimited".
2. Rewrite `:115-117`: lower 0 where 0 is a legitimate value (`refresh_hour_utc` = midnight, `signal_rank_weight`);
   lower 1 where the Python reader clamps ≤ 0 to the default. At most 2 lines each.
3. Change no registry entry.

**Verification**:
```bash
cd services/xstockstrat-config && grep -n "zero-trap\|would collapse" src/grpc/configServiceImpl.ts   # expect no output
git diff --stat -- src/grpc/configServiceImpl.ts   # comment lines only
```

---

### Step 14 — test: config bounds still reject 0 (@AC-8) and a zero survives the WatchConfig wire (@AC-10)

**Status**: `pending`
**Service**: `xstockstrat-config`
**Files**:
- `services/xstockstrat-config/src/__tests__/setConfigScalarBounds.test.ts` — modify
- `services/xstockstrat-config/src/__tests__/watchConfigWireZero.test.ts` — create

**Reviewers**: `xstockstrat-config` owner — Config key naming (`<service>.<category>.<key>`), environment (`production`/`staging`) / global-per-user scoping, secret encryption + redaction, WatchConfig stream stability

**Codebase Evidence**:
- AC-8 template: the `RM_CONC = 0` rejection block `setConfigScalarBounds.test.ts:173-195` (`setConfig({ intVal: 0 }, RM_CONC)`,
  `INVALID_ARGUMENT`, `/\[1, 5\]/`, `insertQuery() === undefined`). `OPP_CONC` (`:210`) is tested only at 10000
  (`:216`) and 5 (`:241`) (recon.md:199-202).
- Wire path:
  - `toProtoSnapPayload` `configServiceImpl.ts:32-64` uses `!== undefined` per oneof arm (`:49-52`), so it emits 0
    and `""`.
  - `buildConfigValue` `:574-588` (`parseInt`/`parseFloat`).
  - SNAPSHOT via `watchConfig(call)` `:280`; DELTA via the private `broadcastToSubscribers(namespace, env)` `:260-274`
    → `snapshotForSubscriber(sub, CONFIG_UPDATE_TYPE_DELTA)` `:245-258`.
- Serializer: `createConfigServiceDefinition()` returns `ConfigServiceService` (`src/grpc/serviceDefinition.ts:1-6`).
  Fake-call capture pattern: `secretsAndScope.test.ts:244-251` (`impl.watchConfig(fakeCall)`, `writes.push(p)`,
  `await new Promise(r => setTimeout(r, 20))`). Pool shape: `configValueRoundtrip.test.ts:51-54`
  (`query: async () => ({ rows })`). Snapshot loader: `reloadNamespace(ns, env)` (`configValueRoundtrip.test.ts:56`).
- Test runner: `"test": "tsc && node --test dist/__tests__/*.test.js"`, `"test:coverage"` with `--lines 40`,
  `"lint": "eslint src --ext .ts"` (`package.json:12-14`).

**TDD**: `red-green required` — red N/A: characterization. @AC-8 and @AC-10 hold before and after (no config code
change; Step 13 is comments). This is the tdd-gate escape, recorded in the PR body and `context.md` (product-spec
§ Acceptance Criteria).

**Covers**: `AC-8, AC-10`

**Instructions**:
1. **AC-8**: in the `:214-231` `it(...)` (or a new `it` beside it), add
   `r = await setConfig({ intVal: 0 }, OPP_CONC)`, asserting `INVALID_ARGUMENT`, `/\[1, 5\]/` and no INSERT. The
   setup is the ADMIN-scope metadata at `:74`.
2. **AC-10** `watchConfigWireZero.test.ts`.
   - Data: an inline pool whose `query` returns three `analysis` rows (`environment: 'production'`):
     - `analysis.test.zero_int`, `value_type: 'int'`, `value_data: '0'`
     - `analysis.test.zero_float`, `'float'`, `'0'`
     - `analysis.test.zero_string`, `'string'`, `''`
   - `const impl: any = new ConfigServiceImpl(pool)`. `reloadNamespace`, `snapshotForSubscriber` and
     `broadcastToSubscribers` are `private` (`configServiceImpl.ts:203,245,260`), and `test` runs `tsc` first, so call
     them through the `any` cast (`configValueRoundtrip.test.ts:56-57`).
   - SNAPSHOT: `await impl.reloadNamespace('analysis', 'production')`, then `impl.watchConfig(fakeCall)` with a fake
     call (`environment: 2`, no `userId`). Then `await new Promise((r) => setTimeout(r, 20))`: the SNAPSHOT write and
     `subscribers.set` happen in an async `.then` (`configServiceImpl.ts:305-309`; pattern `secretsAndScope.test.ts:250-251`).
     Assert `writes.length === 1` before the DELTA leg, because otherwise no subscriber is registered.
   - DELTA: `await impl.broadcastToSubscribers('analysis', 'production')`, then assert `writes.length === 2`.
   - For each captured payload:
     `const d = createConfigServiceDefinition().watchConfig.responseDeserialize(createConfigServiceDefinition().watchConfig.responseSerialize(p))`.
   - Assert, on both the SNAPSHOT payload and the DELTA payload:
     - `d.values['analysis.test.zero_int'].intVal === 0`, with `!== undefined`
     - `floatVal === 0`
     - `stringVal === ''`
   - Single-consumer inline rows (C-13).

Tooling (re-spec 2026-10-28): config `node_modules` is not installed in a fresh worktree, so run `pnpm install` first.
The root CLAUDE.md and CI pin Node 24; a host with only Node 22 can run the suite (no `engines` field forbids it),
but record the Node version used in `context.md`.

**Verification**:
```bash
cd services/xstockstrat-config && pnpm install && pnpm run test:coverage && pnpm run lint   # test:coverage enforces c8 --lines 40 (package.json:13)
grep -n "OPP_CONC" src/__tests__/setConfigScalarBounds.test.ts   # includes an intVal: 0 case
```

---

### Step 15 — migration: description-only correction of the 027/028 zero-trap descriptions

**Status**: `pending`
**Service**: `xstockstrat-config`
**Files**:
- `services/xstockstrat-config/migrations/032_analysis_zero_trap_descriptions.up.sql` — create
- `services/xstockstrat-config/migrations/032_analysis_zero_trap_descriptions.down.sql` — create
- `docs/roadmap/features/merge-order.md` — modify (one row)

**Reviewers**: DBA — Migration NNN numbering (no gaps, no conflicts), up+down pair present, hypertable partitioning strategy, index correctness, run-order compliance with `scripts/db-migrate.sh`; `xstockstrat-config` owner — Config key naming, WatchConfig stream stability

**Codebase Evidence**:
- Migrations tip on `origin/main-dev`: `030_marketdata_edgar_snapshot_keys.{up,down}.sql`
  (`git ls-tree origin/main-dev services/xstockstrat-config/migrations/`, 2026-10-21). `031` is claimed by 243
  (`origin/feature/fix-sandbox-seed-keys:docs/roadmap/features/243-fix-sandbox-seed-keys/implementation-spec.md:168-169`,
  `031_heal_indicators_sandbox_keys_full_dotted`). The pair is pinned to `032`, the next free number. The pre-merge
  re-list (§ Step Dependencies) sets it to `max(origin/main-dev)+1`, which is `031` if 244 merges first, so no gap
  is left. Any renumber goes in the Deviation Log (F-09).
- Rows, stored full-dotted:
  - `028_analysis_opportunity_keys.up.sql:45-50` (`analysis.opportunity.signal_rank_weight`, description `:46`/`:49`
    ending "0 is not honored - reads as the 0.3 default (get_float).")
  - `:87-92` (`analysis.opportunity.max_concurrent_bars_fetches`, "(get_int, max(1,...))" at `:88`/`:91`)
  - `:93-98` (`analysis.opportunity.max_concurrent_candidates`, `:94`/`:97`)
  - `027_analysis_readiness_materializer_keys.up.sql:49-54`
    (`analysis.readiness_materializer.max_concurrent_bars_fetches`, "Never set 0 (get_int zero-trap collapses it to
    the default 2)." at `:50`/`:53`; it contains the SQL-escaped `loop''s`)
- The staging and production rows carry identical text, so one `UPDATE` per key covers both environments.
- Pattern: the `UPDATE config.config_values SET … WHERE …` shape of `029_heal_config_keys_full_dotted.up.sql`
  (design §12). There is no explicit BEGIN/COMMIT (`029_heal_config_keys_full_dotted.up.sql:15`).
- Excluded: `028:100,103` (`sparkline_bars`), which has no analysis reader (recon.md:377). It is logged in Step 17.

**TDD**: N/A (migration)

**Covers**: —

**Instructions**:
1. `.up.sql`: four statements, each of the form
   `UPDATE config.config_values SET description = '<new>' WHERE namespace = 'analysis' AND key = '<full dotted key>' AND description = '<old>';`.
   `<old>` is copied verbatim from the cited line, keeping SQL quote escaping. `<new>` replaces only the
   mechanism clause:
   - `signal_rank_weight`: replace "0 is not honored - reads as the 0.3 default (get_float)." with
     "0 is honored - the default sort ranks by conviction alone."
   - `opportunity.max_concurrent_bars_fetches`: replace "(get_int, max(1,...))" with
     "(a stored 0 or negative reads as the default 2)".
   - `opportunity.max_concurrent_candidates`: replace "(get_int, max(1,...))" with
     "(a stored 0 or negative reads as the default 4)".
   - `readiness_materializer.max_concurrent_bars_fetches`: replace "Never set 0 (get_int zero-trap collapses it to
     the default 2)." with "A stored 0 or negative reads as the default 2 (read-side clamp)."
2. `.down.sql`: the four inverse `UPDATE`s, setting `<old>` where `description = '<new>'`.
3. The migration changes no `value_data`/`value_type`/`key`, does no INSERT/DELETE, writes no audit row and sends
   no `pg_notify`. It leaves 027/028 untouched (F-01; feature-184 @AC-2/@AC-3 hold).
4. `merge-order.md` row:
   `| \`fix-python-config-stored-zero\` | \`fix-sandbox-seed-keys\` | Soft: both add an xstockstrat-config migration (243 = 031, 244 = 032) and both edit indicators tests/test_config_watcher.py (244 Step 6 delegates whichever helper is on the base). Expected order 243 → 244, which is not a hard gate (design rejected one). If 244 merges first, it renumbers to 031 and 243 to 032, each by max(origin/main-dev)+1 immediately before merge (fails.md:2910) | No |`.
   The row is written at execute time, after operator
   confirmation (overlap recommendation; context.md Open Thread).

**Verification** (offline, no DB):
```bash
ls services/xstockstrat-config/migrations/*_analysis_zero_trap_descriptions.up.sql services/xstockstrat-config/migrations/*_analysis_zero_trap_descriptions.down.sql
git ls-tree --name-only origin/main-dev services/xstockstrat-config/migrations/ | tail -2   # 032 unless the re-list says max+1 differs (Deviation Log)
grep -c "^UPDATE config.config_values" services/xstockstrat-config/migrations/*_analysis_zero_trap_descriptions.up.sql   # 4
grep -niE "insert|delete|value_data|value_type" services/xstockstrat-config/migrations/*_analysis_zero_trap_descriptions.*.sql   # expect no output
```
Then read both files and confirm each `.down` statement inverts one `.up` statement.

---

### Step 16 — test: the description migration is description-only and reversible (@AC-11)

**Status**: `pending`
**Service**: `xstockstrat-config`
**Files**:
- `services/xstockstrat-config/src/__tests__/zeroTrapDescriptionMigration.test.ts` — create

**Reviewers**: `xstockstrat-config` owner — Config key naming (`<service>.<category>.<key>`), environment (`production`/`staging`) / global-per-user scoping, secret encryption + redaction, WatchConfig stream stability

**Codebase Evidence**:
- No existing config test reads a migration file (`grep -rln migrations src/__tests__` is empty, 2026-10-21). The
  compiled tests run from `dist/__tests__` (`package.json:12`), so the migrations dir is
  `path.resolve(__dirname, '../../migrations')`.
- Source texts: `027:50,53`; `028:46,49,88,91,94,97` (Step 15 evidence).

**TDD**: `red-green required` (RED: authored before Step 15; the glob finds no file)

**Covers**: `AC-11`

**Instructions**:
1. Glob `*_analysis_zero_trap_descriptions.up.sql` and `.down.sql` in the migrations dir and assert exactly one of
   each. Matching by suffix means a renumber needs no edit.
2. Parse each file into statements, split on `;` outside quotes. Assert:
   - every statement matches `^UPDATE config\.config_values SET description = '…' WHERE namespace = 'analysis' AND key = '…' AND description = '…'$`
   - no statement contains `INSERT`, `DELETE`, `value_data`, `value_type` or `SET key`
3. For every up statement, assert its WHERE `description` literal appears verbatim in `027_…up.sql` or
   `028_…up.sql`. This guards against a no-op UPDATE caused by text drift.
4. Assert the down statements are the exact inverse pairs: down `SET` = up `WHERE` text and down `WHERE` = up `SET`
   text, for the same key.
5. Single consumer; inline expectations (C-13).

**Verification**:
```bash
cd services/xstockstrat-config && pnpm run test:coverage && pnpm run lint   # test:coverage enforces c8 --lines 40 (package.json:13)
```

---

### Step 17 — docs: config-key rows, constitutions, findings, governance; context-forge teardown

**Status**: `pending`
**Service**: `docs/`, service `CLAUDE.md`s
**Files**:
- `services/xstockstrat-analysis/CLAUDE.md` — modify
- `services/xstockstrat-ingest/CLAUDE.md` — modify
- `services/xstockstrat-indicators/CLAUDE.md` — modify
- `docs/patterns/config-governance.md` — modify
- `docs/context-constitution.md` — modify
- `docs/context-constitution-findings.md` — modify
- `services/xstockstrat-analysis/docs/context-constitution.md` — modify
- `services/xstockstrat-analysis/docs/context-constitution-findings.md` — modify
- `services/xstockstrat-config/docs/context-constitution.md` — modify
- `services/xstockstrat-config/docs/context-constitution-findings.md` — modify
- `services/xstockstrat-ingest/docs/context-constitution.md` — modify
- `services/xstockstrat-ingest/docs/context-constitution-findings.md` — modify

**Reviewers**: none

**Codebase Evidence**:
- Analysis `CLAUDE.md` rows that name the trap, `max(1, …)` or `get_*_present`: `:472-474`, `:479`, `:482-489`,
  `:500`, `:513`, `:519-521`, `:525-531`, `:535-537` (grep of `zero-trap\|max(1, …)\|get_int_present\|get_float_present`,
  re-run 2026-10-28; `:521` `opportunity.retry_seconds` is new). `:494` (`fundamentals_blend_strategy_id`) no longer
  matches the grep but still mentions `get_str`; review it too.
- Ingest `CLAUDE.md:124,127,130-133` (`:127` and `:131` say "Read via `get_int_present` (never `get_int`)").
- Indicators `CLAUDE.md:100-103` (`:100` was rewritten on main-dev with the override-clamp text — keep it; `:102`
  "never `get_str`"; `:103` claims a `max(1, …)` clamp, which is now in the accessor). 243 rewrites the same rows;
  the second to land rebases.
- `docs/patterns/config-governance.md:251-258` (lower-bound rule at `:252` and the `signal_rank_weight zero-trap` note
  at `:257-258`, inside a table that runs to `:273`), plus product-spec Fix Scope `:458-461,705,713,721`. The same doc also has `:319` ("must not be
  swallowed by the `get_int` zero-trap") and `:688` (`refresh_hour_utc`: "never `get_int` … the zero-trap would
  swallow it"), grep 2026-10-21.
- Module findings preambles that point the zero-trap at the root: `services/xstockstrat-analysis/docs/context-constitution-findings.md:5`
  and `services/xstockstrat-ingest/docs/context-constitution-findings.md:5`.
- `docs/context-constitution.md:59` (PLAT gotcha); `docs/context-constitution-findings.md:32` (CF-N10 → resolved).
- `services/xstockstrat-analysis/docs/context-constitution.md:37`; `services/xstockstrat-config/docs/context-constitution.md:28`
  (CONFIG-11, "never give a key read through a Python `get_int` a lower bound of `0`") and `:32`.
- `services/xstockstrat-ingest/docs/context-constitution.md:28` (INGEST-9 getter list/line hints);
  `services/xstockstrat-ingest/docs/context-constitution-findings.md:27` (dead `sandbox_*` helpers → resolved).
- New findings row: `analysis.opportunity.sparkline_bars` has a bounds row (`configServiceImpl.ts:126`) and a
  `028:100,103` description claiming "get_int, max(1,...)" but no analysis reader (recon.md:377; design §12).

**TDD**: N/A (docs)

**Covers**: —

**Instructions**:
1. Each config-key row states the shipped behaviour. It drops "use `get_*_present`, never `get_*`" and
   "`get_int` zero-trap" mechanisms. FR-3 keys read "a stored ≤ 0 reads as the default". FR-4 and honour keys read
   "0 is honoured". `default_fill_model` keeps "0 = legacy, stored or absent" (fails.md:1877).
2. Ingest/indicators: the same for their rows. Indicators `:103`: the clamp now lives in `sandbox_max_concurrent()`.
3. `config-governance.md`: the bounds lower-edge rule now follows "legitimate 0 → lower 0; reader clamps ≤ 0 → lower
   1"; delete the `signal_rank_weight` zero-trap note. At `:319` and `:688`, drop the "never `get_int` / zero-trap
   would swallow it" mechanism and keep "0 is legitimate".
4. Root and service constitutions:
   - PLAT gotcha `:59` becomes "Python getters honour 0 via HasField; FR-3 sites clamp via `int_positive`…"
   - CF-N10 is marked resolved by 244.
   - CONFIG-11 is reworded to the clamp model.
   - INGEST-9 line hints are re-stamped.
5. Findings: ingest dead helpers → resolved; add the config `sparkline_bars` drift row. In the analysis and ingest
   findings preambles (`:5`), mark the zero-trap as resolved by 244 rather than open at the root.
6. Run `/context-forge:context-constitution refresh`, scoped to the files above, and fix the grounded drift. If the
   plugin is unavailable, do the manual re-read and record both facts in the PR body (root CLAUDE.md § Teardown).

**Verification**:
```bash
grep -rn "zero-trap" services/xstockstrat-analysis/CLAUDE.md services/xstockstrat-ingest/CLAUDE.md services/xstockstrat-indicators/CLAUDE.md docs/patterns/config-governance.md docs/context-constitution.md services/*/docs/context-constitution.md   # only historical/resolved mentions remain
grep -n "CF-N10" docs/context-constitution-findings.md
```

---

### Step 18 — docs: rollout audit and consumer-surface verification (C-14)

**Status**: `pending`
**Service**: rollout (dev, then prod) — results recorded in `docs/roadmap/features/244-fix-python-config-stored-zero/context.md`
**Files**:
- `docs/roadmap/features/244-fix-python-config-stored-zero/context.md` — modify (audit and smoke results)

**Reviewers**: none

**Codebase Evidence**:
- The bounds are write-only (`configServiceImpl.ts:99`), so a stored 0/`''` that the trap hid takes effect on deploy
  (product-spec Fix Scope; design §13).
- A malformed int becomes `parseInt` → `NaN` → a present member (`configServiceImpl.ts:582`).
- Unseeded FR-4 keys need `create_key=true` with the matching `value_type` (`configServiceImpl.ts:466-469`; agent
  `set_config` `services/xstockstrat-agent/app/tools.py:1642,1655-1662`).
- Surfaces:
  - agent `run_backtest` `tools.py:715`, `list_opportunities` `tools.py:1518`
  - `/insights` backtest view `services/xstockstrat-ui/src/app/insights/strategies/[id]/page.tsx`
  - `/trader` `src/components/trader/AlertStream.tsx`, `/accounts/notifications` `src/app/accounts/notifications/AlertInbox.tsx`
  - `/config-ui` `src/app/config-ui/[namespace]/NamespaceEditor.tsx:71-76`

**TDD**: N/A (rollout)

**Covers**: — (operational verification of AC-2/AC-3/AC-9/AC-11 on dev; behaviour coverage is Steps 10, 14, 16)

**Instructions**:
1. **Pre-deploy audit**: before dev, then again before the prod promotion. If DB access is unavailable, the operator
   runs it (P-03). Record the results in `context.md` under `## Session <YYYY-MM-DD> — rollout (dev)` (then
   `(prod)`), which is the header the Verification grep keys on.
   - `SELECT namespace,key,environment,user_id,value_type,value_data FROM config.config_values WHERE namespace IN ('analysis','indicators','ingest') AND ((value_type IN ('int','float') AND value_data ~ '^-?0+(\.0+)?$') OR (value_type='string' AND value_data=''));`
     Classify each row against the § Guard classification table (FR-3 → clamped, no change; honour → takes effect).
   - `… WHERE value_type='int' AND value_data !~ '^-?[0-9]+$'`: malformed ints.
   - `value_type` is `float` for `default_commission_pct` and `default_slippage_pct`, and `int` for
     `alert_throttle_seconds`.
   - Re-run the FR-5 seed audit after 243's heal lands.
2. **Dev smoke**, using the agent tools as a staging admin:
   - `set_config analysis.opportunity.signal_rank_weight = 0` (float). `list_opportunities` with no sort then
     returns conviction order.
   - `set_config analysis.backtest.default_commission_pct = 0` and `default_slippage_pct = 0` (float,
     `create_key=true`). Then `run_backtest` returns trades whose fill price equals the bar close and whose pnl
     carries no cost. Open the same run in the `/insights` backtest view.
   - `set_config analysis.engine.alert_throttle_seconds = 0` (int, `create_key=true`). A repeat live transition then
     reaches the `/trader` AlertStream and the `/accounts/notifications` inbox.
   - `/config-ui` → the analysis namespace shows the four corrected descriptions (Step 15).
3. Restore every smoke value afterwards and record before/after in `context.md`.

**Verification**: `context.md` holds a dated rollout entry with the audit row counts and classification, the four
smoke outcomes, and the restored values.
```bash
f=docs/roadmap/features/244-fix-python-config-stored-zero/context.md
grep -nE "^## Session [0-9]{4}-[0-9]{2}-[0-9]{2} .*rollout" "$f"                          # >=1 (dev), >=2 after prod audit
grep -niE "audit.*(rows?|count)" "$f" | grep -iE "FR-3|honour|malformed"                   # counts + classification
grep -niE "smoke" "$f" | grep -cE "signal_rank_weight|commission|alert_throttle|config-ui" # 4
grep -niE "restored" "$f"                                                                  # before/after values
```

---

## Deviation Log

_Populated by /sdd-execute as implementation proceeds._

- 2026-10-28 Step 1 (TDD evidence harness, no scope change): the step's paired test lands in Step 2, so the RED/GREEN
  run used an uncommitted scratch test (`tests/test_zz_step1_scratch.py`, deleted before commit) asserting the
  three @AC-1 ingest rows, the @AC-4 unset/mismatched rows and `get_int_present is get_int`. Only `watcher.py` was staged.
- 2026-10-28 Step 3 (TDD evidence harness, no scope change): the paired test lands in Step 4, so RED/GREEN used an
  uncommitted scratch test (`tests/test_zz_step3_scratch.py`, deleted before commit): the four FR-3 properties at 0
  (and `max_concurrent_jobs` at -5), the loop timeout/poll reads at 0, the sandbox helpers gone, and
  `max_retry_attempts`/`dedup_window_hours` still honouring 0. The docstring range cited as `:157-159` was actually
  `:156-158` (line drift only).
- 2026-10-28 Step 4 (TDD evidence method + line drift, no scope change): Step 3 had already landed, so RED ran the new
  tests against the Step-2 `app/config/watcher.py` and `app/engine/mcp_client_loop.py` (`git checkout 62972c4f --`,
  restored to HEAD before GREEN; never committed). `IngestServicer.__init__` spans `servicer.py:308-316` (class at
  `:307`), not `:308-320`; `_backfill_sem` is still at `:323`. Guard shape choices within the instructions:
  `FR3_KEYS`/`HONOUR_KEYS` are frozensets (rule 4 checks one default per key, it does not pin the table's values),
  `ZERO_IS_LEGIT` is a key→reason dict, and `collect(app_dir)` returns `(reads, clamps, errors)`.
- 2026-10-28 Step 5 (TDD evidence harness, no scope change): the paired test lands in Step 6, so RED/GREEN used an
  uncommitted scratch test (`tests/test_zz_step5_scratch.py`, deleted before commit) asserting the three @AC-1
  indicators rows, the @AC-4 unset/mismatched rows and `get_str_present is get_str`. Only `watcher.py` was staged.
- 2026-10-28 Step 6 (TDD evidence method + test shape, no scope change): Step 5 had already landed, so RED ran the new
  rows against the Step-4 `app/config/watcher.py` (`git checkout 52b55fee --`, restored to HEAD before GREEN; never
  committed). 243 has not landed, so `_str_watcher` keeps its name and delegates to `snapshot_watcher` (no
  `ConfigValue` arm). The @AC-4 rows are one parametrized test over watcher factories, because the `unset_int` row
  needs `_snapshot = None`, which `snapshot_watcher(**values)` cannot express.
- 2026-10-28 Step 7 (TDD evidence harness + path citation, no scope change): the paired test lands in Step 8, so
  RED/GREEN used an uncommitted scratch test (`tests/test_scratch_step7.py`, deleted before commit): `int_positive`
  exists, the three sandbox int accessors at 0 and -1 read 5000 / 134217728 / 4, a positive `max_concurrent` passes
  through, `sandbox_allowed_imports` at `""` stays `[]`, and `IndicatorsServicer._sandbox_sem._value == 4` at 0.
  The `int_positive` comment names the indicators hazards (Semaphore(-1), `memory_bytes=-1` skips `RLIMIT_DATA`)
  rather than Step 3's ingest `sleep(-n)` wording; the body is identical. The Codebase Evidence cites `sandbox.py`;
  the file is `app/services/sandbox.py` (not edited).
- 2026-10-28 Step 8 (TDD evidence method, no scope change): Step 7 had already landed, so RED ran the new tests against
  the Step-6 `app/config/watcher.py` and `app/handlers/servicer.py` (`git checkout e796238a --`, restored to HEAD
  before GREEN; never committed). Instruction 4's "Step-5 tree" has the same `app/` as the Step-6 tree (Step 6 is
  test-only). On that tree the semaphore row read `_value == 1` (the pre-Step-7 `max(1, …)`), not 0. The guard file
  is the Step-4 ingest guard with the indicators key sets swapped in (`ZERO_IS_LEGIT` an empty dict).
- 2026-10-28 Step 9 (TDD evidence harness, no scope change): the paired test lands in Step 10, so RED/GREEN used an
  uncommitted scratch test (`tests/test_zz_step9_scratch.py`, deleted before commit) asserting the three @AC-1
  analysis rows, the @AC-4 unset/mismatched rows, and `get_int_present is get_int` / `get_float_present is get_float`.
  Between Steps 9 and 10 the analysis suite has one expected failure,
  `test_get_float_present_explicit_zero_is_not_trapped` (`:594`). It asserts the old `get_float` zero-trap, and
  Step 10 rewrites it. The same `ConfigWatcher` class serves the `marketdata` namespace watcher (`main.py:48`).
  Its only read, `fundsignal_loop.py:97`, uses default `""`, so it behaves the same either way.
- 2026-10-28 Step 10 (TDD evidence method + test shape, no scope change): Step 9 had already landed, so RED ran the new
  tests against the Step-8 `app/config/watcher.py` (`git checkout e2b41e19 --`, restored to HEAD before GREEN; never
  committed). Shape choices within the instructions:
  - The AC-2 seam builds the servicer with the two lines of `_svc_req` (`_wire_evaluated(make_servicer(),
    _series_bars(6, 12))`, `_windowed_req(_sma_def())`) in a new class rather than calling the method on
    `TestRunBacktestFillModelRouting`. It records the `commission=`/`slippage=` keywords of every call.
  - The AC-9 rows use strategy id `s1` (lower case), matching the existing `_last_alert_ts` keys in
    `test_live_loop.py`; the instructions wrote `S1`. The AC-9 seam replaces `loop._cfg`, so `_run_cycle` reads every
    other key through the real getter (absent → default).
  - The @AC-4 `_snapshot = None` row is a separate test (`test_get_str_default_when_no_snapshot`), as in Step 6.
  - The AC-3 order rows run under `real_pg` via `local_pg` (the project's own throwaway-PostgreSQL harness named by the
    step); no service database or migration was started.
