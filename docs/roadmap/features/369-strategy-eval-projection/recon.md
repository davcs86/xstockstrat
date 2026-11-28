# Recon: strategy-eval-projection

**Created**: 2026-11-28
**From**: product-spec.md
**Tree**: ccr-d10c1761-fxpr1d@cfa6a43f = origin/main-dev@bc497728 + docs-only commits
**Affected services**: xstockstrat-analysis, xstockstrat-config (xstockstrat-indicators and xstockstrat-marketdata are called through existing RPCs)

Paths are relative to `services/xstockstrat-analysis/` unless they start with `packages/`, `docs/`
or `services/`. Every `path:line` comes from a discovery digest on the tree above. Feature 368's
code does not exist yet; its approved design
(`docs/roadmap/features/368-symbol-data-stage/design.md`) is the contract this feature builds on.

---

## Objective

Run strategy evaluation as jobs on the analysis job graph, one per user, symbol and closed daily
bar, writing an isolated result row per active strategy and its position state into a durable
projection, and sending entry and exit transitions through an outbox whose dispatcher suppresses
delivery. Build a projection read path for opportunities and readiness behind a switch that stays
on legacy, and log a parity report against the live loop. Nothing user-visible changes.

## What feature 368 hands over (its design.md § 17)

- **Bar record** `analysis.symbol_bar(symbol, session_date)`: at most one row, inserted once with a
  `covered` coverage record after a post-close fetch. The trigger for evaluation. Its captured
  OHLCV columns are not a price source.
- **Snapshot** `analysis.data_stage_universe(session_date, user_id, symbol, held)` with system-scope
  symbols stored once under user `system`, and `analysis.data_stage_users` naming users not
  snapshotted. Immutable once complete. Users are strategy owners only.
- **Run row** `analysis.data_stage_runs(session_date, …, pass, done_at)`: "run done" is `done_at`,
  after which no coverage or bar record appears for the session. Up to 4 passes, at least 30
  minutes apart, so bar records for one session arrive over up to about two hours.
- **Must not assume**: that every snapshot symbol gets a record (`fetch_failed`, `no_vendor_data`,
  a dead job); that done implies a snapshot; that every session has a run or that every run
  reaches done; that stored OHLC never changes; that any job state is a barrier.
- **Warm set**: reading bars through `GetBars`, `BatchGetBars` or `BatchGetLatestPrice` marks the
  symbol warm in marketdata, after which its quote poller and bar ingester poll it.
- **Runtime hooks 368 adds**: the worker's `ensures` argument, `build_registry(settings, *,
  marketdata, portfolio, ingest)`, the shared job repository instance, `app/identity.py`
  system-read identity, `app/engine/universe_reads.py`.
- **Migration numbers**: 368 takes analysis `032` and config `062`; this feature follows with
  analysis `033` and config `063`.

## Codebase Map

- **`xstockstrat-analysis`** (Python)
  - Entry point and wiring: `app/main.py:169` (`StrategyEvaluator(servicer._indicators, ())`),
    `:243-259` (job graph worker).
  - Evaluator: `app/services/evaluator.py` — `StrategyEvaluator.__init__` `:240`, `for_owner` `:261`,
    `evaluate` `:292`, `evaluate_with_series` `:326`, `evaluate_conditions_traced` `:398`,
    `_compute_component` `:512`, `_assemble_component_series` `:720`, `BarDecision` `:222`,
    `FormulaExecutionError` `:107`, `_conviction_ordinal` `:1136`, `_readiness_from_evals` `:1159`.
  - Live loop: `app/engine/live_loop.py` — `resolve_universe` `:114`, `_apply_transition` `:209`,
    `_run_cycle` `:358`, `_eval_pair` `:723`, `_emit_alert` `:880`, `_emit_ledger` `:921`.
  - Strategy selection: `app/repositories/strategies.py:19` (`LIVE_ENABLED_PREDICATE_SQL`), `list`
    `:189`.
  - Cooldown state of the live loop: `app/repositories/strategy_cooldowns.py:27`, `:43`, `:59`;
    rules in `app/services/cooldown.py:42`, `:63`.
  - Fingerprint: `app/handlers/servicer.py` `_definition_fingerprint` `:7715`, `_formula_digest`
    `:7760`, `_evidence_fingerprint` `:7789`; digest collection `_formula_fundamentals` `:1955`.
  - Read paths: `app/handlers/servicer.py` `EvaluateReadiness` `:4103`, `GetWatchlistReadiness`
    `:4271`, `_kick_readiness_refresh` `:4411`, `ListOpportunities` `:4804`,
    `_read_opportunity_queue` `:4903`, `_enrich_opportunities_live` `:4996`,
    `_compute_opportunities` `:5602`, `_row_to_opportunity` `:7307`;
    `app/repositories/opportunities.py:238`; `app/services/readiness.py:16`, `:38`, `:110`.
  - Job graph: `app/engine/job_graph.py` (`Lane` `:56`, `job.db` `:304`, gate `:390`),
    `app/jobs/__init__.py:7`.
  - Last migration: `031_pipeline_job_graph.up.sql`.
  - Config-read pattern: `JobGraphSettings` `app/engine/job_graph.py:191`; string key with a closed
    set `app/engine/fundsignal_loop.py:389`; getters `app/config/watch_core.py:217`,
    `app/config/watcher.py:82`.
- **`xstockstrat-config`** (Node)
  - Latest migration: `migrations/061_analysis_pipeline_keys.up.sql`.

## Evaluation, live loop, state and effects (digest)

#### A. Evaluator (`app/services/evaluator.py`)
- Constructor: `__init__(self, indicators_stub, propagation_meta=(), component_sem=None, raise_unreadable=False)` — `:240`. Also sets `self.unreadable_formulas: set[str]` (per-instance state, `:259`).
- `for_owner(owner)` — `:261`. It returns a new evaluator with `owner_metadata(owner)` as meta and the same sem and flag. It raises `ValueError` for an empty or `system` owner (`app/identity.py:11`). The clone is cheap; one base instance can be shared across owners and strategies.
- `evaluate(definition, bars, signals_map=None, benchmark_bars=None, fundamentals=None, formula_fundamentals=None, formula_fundamentals_data=None, sector_by_bar=None) -> list[BarDecision]` — `:292`. It wraps `evaluate_with_series` (`:326`), which returns `(decisions, component_series)`.
- `BarDecision` (`:222`): `bar_index:int, entry:bool, exit:bool, conviction:float`. Conviction is 1.0 if entry, else 0.0 (`:392`).
- `evaluate_conditions_traced(definition, bars, symbol, signals_map=None, *, rule="entry"|"exit", benchmark_bars, fundamentals, formula_fundamentals, formula_fundamentals_data) -> dict` — `:398`. It traces the last bar only (`last = len(bars)-1`, `:488`). It returns a `SymbolReadiness`-shaped dict, or `{**_empty_readiness, "formula_unreadable": True}` (`:487`) when a referenced ref is unreadable. It takes no `sector_by_bar`.
- Caller preloads:
  - `bars`: marketdata `Bar` protos with `.close` and `.time`. `_bar_date` uses `.time` (`:37`).
  - `benchmark_bars`: `{source_symbol: [bars]}`. A missing key makes the component all-None (hold) (`:783-785`).
  - `fundamentals`: a PIT `list[FundamentalPeriod]` for the `FUNDAMENTAL` operand. The evaluator applies `filed_date < bar_date` (`_fundamental_as_of_series`, `:78`).
  - `formula_fundamentals`: the `{formula_id: [metric enum ints]}` routing map.
  - `formula_fundamentals_data`: a separate channel. The live loop passes a SNAPSHOT of the current `GetFundamentals` row with a sentinel `filed_date`, so a late run would see current, not as-of, values.
  - `sector_by_bar`: optional per-bar sector list, used only if `sector_params.has_overrides`.
  - `signals_map` is ignored by the entry-rule leaves; the live loop passes `None`.
- RPCs per evaluation:
  - `_compute_component` (`:512`) makes ONE `ComputeIndicator` per built-in component (`values=closes`, `params`), or ONE `ExecuteFormula` per custom component (`input_data={"close": closes}`, `input_params`).
  - `_fundamentals_formula_series` (`:576`) makes one `ExecuteFormula` per filing epoch.
  - With a `source_symbol`, the component is computed on the benchmark's closes, then date-joined (`_assemble_component_series`, `:720`).
  - There is no cache and no batching. Cost is N components times one RPC per strategy; shared components are recomputed per strategy.
  - `evaluate_with_series` loops components serially and never uses `component_sem`. Only `evaluate_conditions_traced` (`:442-478`) runs `asyncio.gather` under `component_sem` when it is set.
- Failure reporting:
  - `FormulaExecutionError(formula_id, error, code="", exit_reason=0)` — `:107`. It is raised on `not resp.success`, NaN/Inf, `len != n` or a missing `"value"` series (`:141-146`, `:563-571`).
  - `_execute_formula` (`:271`) handles `UNREADABLE_FORMULA_CODES = (NOT_FOUND, PERMISSION_DENIED)` (`:104`).
    - With `raise_unreadable=True` it raises `FormulaExecutionError(..., "not readable by owner", code)`.
    - With a sink, both codes are added to the sink.
    - With neither (the live loop), NOT_FOUND skips the component (all-None) and PERMISSION_DENIED re-raises, which isolates the pair.
  - Other `AioRpcError`s re-raise. `_is_transient_formula_error` (`:149`) is true for `grpc.RpcError` or a sandbox-TIMEOUT `FormulaExecutionError`.
  - `_validate_definition` raises `ValueError` (`:855`).
  - The feature-289 unreadable marker is the `formula_unreadable: True` key in the traced dict, a RESOLVED 0-of-0 verdict (`docs/ownership-and-templates.md:25-29`).
- Decision "as of D": `decisions[-1]` over bars truncated at D is the supported way.
  - `evaluator.py` has no `now()` and no quote read; it only imports `UTC`.
  - Built-in indicators are causal. A custom formula sees the whole `close` list, so it is causal only if the formula is.
  - The caller must truncate `benchmark_bars` and the PIT `fundamentals` itself. The evaluator date-joins benchmarks and applies the T+1 filter, but does not truncate.
  - Sector: the live loop uses `sector_params.fetch_current_sector` (`live_loop.py:784`), which is current, not PIT.
  - The backtest alone passes `sector_by_bar`.

#### B. Live loop (`app/engine/live_loop.py`)
- `_eval_pair(definition, symbol, throttle, deny_entry=False)` — `:723`. Steps:
  1. `GetBars(symbol, timeframe="1d", TIMEFRAME_1DAY, range=_recent_range())` (`:724-731`). The range is `[now-365d, now]` (`_LOOKBACK_DAYS=365`, `:67`, `:628`). Empty returns `_EVAL_NO_BARS`.
  2. `_load_benchmark_bars` (`:635`). This is the only place the warm-up prefix is used: `warmup.required_prefix_bars` + `prefix_calendar_days` (`app/services/warmup.py:152,209`), i.e. `ceil(bars/(252/365)) + 10` days. The window is widened because a benchmark gate would otherwise never warm. The primary bars get NO warm-up prefix; the 365-day window is the warm-up.
  3. `_load_fundamentals` (`:678`): PIT, via `_fetch_historical_fundamentals_paged`. It returns `None` unless the definition has a FUNDAMENTAL operand and `backtest.fundamentals.enabled` is true; a fetch failure gives `[]`.
  4. `declared_formula_fundamentals` (`evaluator.py:684`): one `GetFormula` per distinct formula id on EVERY pair.
  5. `_load_fundamentals_snapshot` (`:699`): `GetFundamentals`, wrapped as one `FundamentalPeriod`.
  6. `assess(...)` from `app/services/fundamentals_guard.py`. UNAVAILABLE forces `deny_entry=True` and sends a one-time alert (`_fund_unavailable`, `:767-780`).
  7. Sector overrides, then `evaluator.evaluate(definition, bars, None, benchmark_bars, fundamentals, formula_fund_map, fund_snap)` (`:786`). The evaluator comes from `for_owner(definition.user_id)` (`:747`).
  8. `latest = decisions[-1]`; `current_bar_dt = bars[-1].time` (`:792-796`).
  9. First visit of a key since restart: `_replay_state(bars[:-1], decisions[:-1], cooldown_days, exit_cooldown_days, initial_entry_time=_last_entry_at.get, initial_last_exit_at=_last_exit_at.get)` (`:809-821`). It folds `_apply_transition` from `in_position=False` and returns `(in_pos, entry_time, last_exit_at)`.
  10. `_apply_transition(in_position, entry_time, last_exit_at, decision, bar_dt, cooldown_days, exit_cooldown_days, deny_entry=False) -> (in_pos, entry_time, last_exit_at, trigger|None)` — `:209`:
      - Entry needs `not in_position and decision.entry`. It is blocked by `deny_entry` or `is_cooldown_active(last_exit_at, bar_dt, cooldown_days)`.
      - Exit needs `in_position and decision.exit`. It is blocked if `entry_time is None` or `is_cooldown_active(entry_time, bar_dt, exit_cooldown_days)`.
      - Cooldowns (`app/services/cooldown.py:42,63`): active iff `current_ts < anchor + timedelta(days=n)`. A `None` anchor is never gated and 0 days is never gated. Tz-aware is required.
      - `effective_cooldown_days(explicit_or_None, default)` resolves the days. The defaults are `analysis.strategy.default_cooldown_days` (31) and `default_exit_cooldown_days` (0).
  11. A trigger first writes `_write_cooldown` (exit, `upsert_exit`) or `_write_entry_cooldown` (entry, `upsert_entry`). Both are best-effort. Then the throttle check `now - _last_alert_ts[key] < throttle`. Then `_emit_alert`, then `_emit_ledger`, then `_last_alert_ts` and `_last_state`.
- `_emit_alert` (`:880`): `EmitAlertRequest(severity=ALERT_SEVERITY_WARNING, category="strategy", title=f"Strategy {id} {trigger} on {symbol}", body=..., source_service="xstockstrat-analysis", tags=[f"strategy_id:{id}"], context={strategy_id, symbol, trigger_type, conviction}, target_user_id=definition.user_id)`. It sets no `correlation_id` and has no bar date.
- `_emit_ledger` (`:921`): `AppendEventRequest(event_type="analysis.strategy.triggered", source_service="xstockstrat-analysis", stream_key=f"strategy:{strategy_id}", payload={strategy_id, symbol, trigger_type})`. There is no user_id, no `idempotency_key`, no bar date, and no metadata header.
- In-memory state (`:300-320`):
  - `_last_state[(user, strat, sym)] -> in_position`
  - `_last_alert_ts` (monotonic seconds, for the throttle)
  - `_last_exit_at` and `_last_entry_at` (cooldown anchors, hydrated from the DB at boot)
  - `_replayed` (keys whose replay has run)
  - `_fund_unavailable` (pairs denied entry for unavailable fundamentals)
  - `_logged_unresolved` (log-once set)
  - `_cursor_key` (rotation cursor `(created_at, strategy_id, symbol)`)
  - `_overflow_warned_budget`
- Cooldowns table: migration `009_strategy_cooldowns.up.sql` created `(strategy_id, symbol, last_exit_at NOT NULL)`. `012` added `last_entry_at TIMESTAMPTZ NULL` and made `last_exit_at` nullable. `014` added `user_id NOT NULL` with PK `(user_id, strategy_id, symbol)`.
  - Repository `app/repositories/strategy_cooldowns.py`: `upsert_exit` (`:27`), `upsert_entry` (`:43`), `list_all` (`:59`). The rows are written only on transitions.
- Strategy selection:
  - `LIVE_ENABLED_PREDICATE_SQL = "live_enabled = TRUE AND active = TRUE"` (`app/repositories/strategies.py:19`).
  - `analysis.strategies` (`001`, `002` adds `live_enabled`, `013` adds `user_id` with PK `(user_id, strategy_id)`) has `definition_json JSONB NOT NULL` and `active BOOLEAN DEFAULT TRUE`.
  - `deactivate` is a soft delete (`active=FALSE`, `:161`); `reactivate` is at `:174`.
  - `list(user_id, include_inactive=False)` (`:189`) gives a user's active strategies.
- Per-cycle behavior (`_run_cycle`, `:358`): it flattens `(created_at, strategy_id, symbol)` pairs and evaluates at most `engine.max_strategies_per_cycle` (default 50) per cycle by rotation. The interval is `engine.eval_interval_seconds` (60). The throttle is `engine.alert_throttle_seconds` (300).
- `resolve_universe(definition, watchlist, held, signals, *, blend_id="", fundamentals_universe=None)` — `:114`:
  - `union = allowlist(signal_params.symbols) or (watchlist | held | signals-if-signal_eligible)`.
  - `universe = (union - denied) | (held & denied)`.
  - `deny_entry = held & denied`.
  - The blend strategy uses the fundamentals universe instead.
  - Watchlist symbols come from bindings, skipping `delisted`. Held comes from `_drain_positions_paged`.

#### C. Observable live record
- Per transition only: ledger `analysis.strategy.triggered` and notify alerts. The ledger payload has no bar date, no user_id and no idempotency_key; the strategy id is in `stream_key`.
  - It is written only after a non-throttled alert succeeds. A throttled transition writes cooldown only, with telemetry `triggers{outcome=throttled}`.
  - A failed alert raises before the ledger write.
  - Notify rows are in the notify DB and not readable from analysis.
- `analysis.strategy_cooldowns`: written only on transitions (including throttled ones), before the throttle check, and only when a `cooldowns_repo` is wired. It holds `last_exit_at`/`last_entry_at` as the bar time of the latest transition, one row per `(user, strategy, symbol)`, overwritten each time. It is the only durable per-pair record. Nothing is written for no-transition pairs, and in-position state is never persisted.
- Telemetry (`app/telemetry.py:522-537`): `record_live_loop_pair(ok|no_bars|error)`, `record_live_loop_trigger(trigger, throttled|alerted|alert_failed)`. These are label-only counters with no pair identity. Logs are summarized per cycle.
- Bar semantics:
  - `_eval_pair` fetches `end=now` and does not filter to closed bars.
  - Marketdata's always-on bar ingester upserts "the forming daily bar" (`services/xstockstrat-marketdata/CLAUDE.md:52`). So at 11:00 NY `bars[-1]` is the forming daily bar, not a closed one.
  - The live loop can therefore transition intraday on a bar that later changes. Parity is meaningful only on the final EOD bar, and only via cooldown rows or ledger events after the close.

#### D. Fingerprint (`app/handlers/servicer.py`)
- `_definition_fingerprint(definition_json: dict) -> str` — `:7715`. It is a sha256 of the JSON with `display_name`, `active`, `live_enabled` and `origin` dropped. Hash only a DB-row `definition_json`. It is pure.
- `_formula_digest(formula) -> str` — `:7760`. It takes a `FormulaDefinition` proto from `GetFormula(GetFormulaRequest(formula_id))`, with the owner `x-user-id` as metadata, and hashes the behavioural fields. It is pure.
- `_evidence_fingerprint(definition_json: dict, digests: dict) -> str` — `:7789`.
  - With no digests it returns `def_hash`; otherwise `def_hash + "." + sha256("fid=digest;...")`.
  - It raises `ValueError("a refused or unknown formula digest cannot be stamped")` if any digest is not a str, i.e. `_UNREADABLE` (a bare `object()`, `:7779`) or `None` (outage).
- Digest collection: the servicer method `_formula_fundamentals(definition, propagation_meta, *, cache, failures, warmups, digests)` (`:1955`) does one `GetFormula` per formula id. It sets `digests[fid] = digest | _UNREADABLE | None`, where `_UNREADABLE` means NOT_FOUND/PERMISSION_DENIED and `None` means an outage.
  - The same loop is at `:2605-2625` (`_declared_formula_warmup`).
  - The derivation site (`:2965-3006`) raises `_FormulaVersionUnknown` on `None`; for `_UNREADABLE` it falls back to `latest_formula_fingerprint`, else returns None.
- The three fingerprint functions are module-level and importable. `_formula_fundamentals` is a servicer METHOD that needs a servicer instance. Importing from `app.handlers.servicer` is allowed: the contract test (`tests/test_job_handler_contract.py:48-111`) forbids only:
  - asyncpg imports;
  - `.acquire(`;
  - the names `db_pool`/`control_pool`;
  - `app.repositories.read_budget`;
  - `app.repositories.pipeline_jobs` except `prune_batch`;
  - catching `BaseException`/`CancelledError`/`AttemptStopped`, or a bare except;
  - `asyncio.shield`;
  - `timeout`/`wait_for` around `.db(`;
  - any await inside `job.db()` that is not on `conn` or does not pass `conn=`.
- `live_loop.py:41-52` already imports servicer module-level helpers (`_row_to_strategy_definition` `:7864`, `_normalize_symbol` `:6965`, `_snapshot_periods` `:7121`, `_drain_positions_paged` `:7061`).
- The live loop computes no fingerprint today.

#### E. Indicators client
- `ComputeIndicatorRequest{indicator=1, values=2 (repeated double), params=3 (map<string,double>), range=4, symbol=5, timeframe=6}` (`packages/proto/indicators/v1/indicators.proto:54`).
- `ExecuteFormulaRequest{formula_id=1, formula_source=2, input_data=3 (Struct), env=4, timeout_ms_override=5, memory_bytes_override=6, input_params=7 (Struct), parameters=8}` (`:75`). Response: `{success, output, error, exit_reason, execution_ms, ...}` (`:89`).
- Identity: `x-user-id` must be a real owner. `owner_metadata` raises on empty or `system`. Formulas are private to their author, so a foreign formula gives NOT_FOUND or PERMISSION_DENIED.
- The analysis client sets no explicit gRPC timeout (no `timeout=` in `evaluator.py`).
- Indicators side:
  - `sandbox.timeout_ms`: 5000, on top of `sandbox.startup_grace_ms` 5000.
  - `ExecuteFormula` clamps the effective timeout to the caller's remaining gRPC deadline minus 500 ms.
  - `sandbox.max_concurrent`: 4 subprocess spawns (the homelab value is 24).
  - `ComputeIndicator` has no cap documented in `xstockstrat-indicators/CLAUDE.md`.
- Analysis-side caps for other surfaces are `series.max_concurrent_components` (4) and `screener.max_concurrent_formula_evals` (4). The live loop has none: it is serial, with `StrategyEvaluator(servicer._indicators, ())` at `app/main.py:169`.
- Cost of one strategy evaluation (from the code, no documented figure): N components give N RPCs (built-in `ComputeIndicator` or custom `ExecuteFormula`) plus one `GetFormula` per distinct custom formula, plus benchmark components and fundamentals-epoch calls.

#### F. Idempotency and effect patterns
- Ledger: `AppendEventRequest.idempotency_key = 8` ("appends at most once for this key", `packages/proto/ledger/v1/ledger.proto:46-50`), `user_id = 9`, `correlation_id = 3`. It is backed by `ledger.idempotency_keys` (`ledgerServiceImpl.ts:67-72`, `:119`).
- Notify: `EmitAlertRequest` has `correlation_id = 9` (`notify.proto:82`) but NO dedupe. `persistAndBroadcast` does a plain `INSERT` with a new uuid (`notifyServiceImpl.ts:85-89`, `:102`). The external fanout has a 300 s content-hash dedupe (`fanout.dedup_window_seconds`), not an idempotent persist.
- Analysis usage:
  - The P&L consumer passes `idempotency_key=f"pnl_park:{seq}"` (`pnl_pattern_consumer.py:319`).
  - The live loop passes no key.
  - There is no `state='pending'` outbox table in analysis; the only `ON CONFLICT DO NOTHING` idempotent inserts are at `pipeline_jobs.py:107,122,280` and the repos listed in the grep.
  - The pipeline_jobs unique key is `(kind, subject, epoch)` (`migrations/031_pipeline_job_graph.up.sql:29`).
- PLAT-N1 (`docs/context-constitution.md:50`): emissions are best-effort, `try/except -> log.warn`, and never fail the RPC.
- Pattern reference: notify's `webhook_deliveries` (`INSERT ... ON CONFLICT (idempotency_key) DO NOTHING`, states pending/delivered/dead) is the only outbox-like table in the repo.

#### G. Job graph (367)
- Deferred text (`docs/roadmap/features/367-pipeline-job-graph/design.md`):
  - `:611-612`: "Hazards H1 and H2 (D-33) apply to any later in-transaction report. To be carried into program feature 3's design."
  - `:625-627`: "A handler that runs work in an executor thread frees its slot on cancellation while the thread keeps running. Not forbidden here, because evaluation handlers will need executors; to be designed in program feature 3."
  - H1 is the heartbeat blocking on the instance's own row lock; H2 is a false rejection plus a double count (`debate.md` D-33, row 61; O-23, row 142).
- Measurements for the shadow run (`design.md:601-606`):
  - attempts per second against the slope of `ready_depth`;
  - handler gate wait p95 (revisit above 1 s);
  - heartbeat duration p99 (above 1.5 s);
  - claim and report duration p99;
  - settle duration p95 (above 100 ms, or more than 10 000 waiting parents);
  - dead-tuple ratio on `pipeline_jobs` (above 0.2).
  - Also D-40 (`debate.md:68`) and the PgBouncer wait via `db.duration{phase=wait}` (`:591-592`).
- Constants (`app/engine/job_graph.py`):
  - `HANDLER_BLOCK_CAP_S = 30.0` (`:43`); `ATTEMPT_DEADLINE_S = 900.0` (`:32`); `STOP_GRACE_S = 10.0` (`:33`)
  - `MAX_CHILDREN_PER_PARK = 10_000` (`:23`); `MAX_PARK_ROUNDS = 8` (`:22`)
  - `HEARTBEAT_PERIOD_S = 7.5`; `SELF_FENCE_MARGIN_S = 3.0`
  - `Lane.WATCHLIST = 10`, `Lane.HELD = 20` (`:56`)
- Concurrency:
  - `worker_concurrency` is clamped to [1, 16] (`:211-213`), default 4. A `ResizableLimiter` gives the slots (`:389`).
  - The handler DB gate is one `asyncio.Lock` per instance (`:390`), so there is one service-pool connection at a time.
  - `job.db(budget)` (`:304`) requires `0 < budget <= 30` or raises `PermanentJobError`. It raises `AttemptStopped` if a stop is pending or the fence deadline has passed.
  - One block takes at most 2B (gate wait plus transaction).
- A handler is a coroutine on the event loop, spawned by `supervision.spawn` (`:554`).
  - Results held in memory across several `job.db` blocks are fine: the contract restricts only awaits inside a block.
  - Non-DB awaits (gRPC calls) are allowed outside blocks.
  - On a stop, `att.handler_task.cancel()` fires, or `txn.abort()` if inside a transaction (`:516-519`). After 10 s without ending, the handler is "abandoned" and keeps its slot.
- Executor primitive that exists: `app/services/compute_pool.py` with `run_bounded` (`app/config/live_limits.py:56`).
- Handler outcomes: `Succeeded`, `WaitOn(children)`, `Verdict(label)`, `PermanentJobError`, `Child(kind, subject, epoch, lane)` (`:74-100`).
- Registry: `build_registry(settings)` registers only `PRUNE_KIND` today (`app/jobs/__init__.py:7`).

#### H. Tests and CI
- Evaluator and live-loop tests: `tests/test_live_loop.py` (has `_bar_at` `:30`, `_make_loop` `:37`, `_decision` `:62`, `_live_row` `:647`), `test_live_loop_telemetry.py`, `test_evaluator_traced.py`, `test_strategy_evaluator.py`, `test_evidence_fingerprint.py`, `test_formula_digest_read.py`.
- Job-graph tests: `test_job_graph_{core,worker,worker_real_pg,settings}.py`, `test_job_handler_contract.py`.
- `tests/conftest.py` provides:
  - `real_live_loop(ingest, indicators, rows, *, config_watcher, marketdata_stub)` (`:96`)
  - `snapshot_watcher` (`:63`)
  - `fund_period` (`:53`)
  - `fundamentals_row` (`:58`)
  - `ctx_with` (`:138`)
  - `aio_rpc_error` (`:146`)
  - the `local_pg` fixture (`:439`) and `pipeline_pg` / `insert_pipeline_job` / `virtual_time`
  - There is NO shared bar builder. `_bar`/`_bars` helpers are duplicated across ~10 test files (e.g. `test_analysis_servicer.py:1498`, `test_fundamental_operand.py:30`, `test_source_symbol_parity.py:21`). That is a C-13 hazard for a second consumer.
  - `_simple_strategy_row` is in `test_readiness_opportunities_source_symbol.py:157`.
- CI coverage threshold: `coverage_threshold: 40`, `cov_source: app` for analysis (`.github/workflows/ci.yml:475-477`; local `uv run pytest --cov=app --cov-fail-under=40`).

## Opportunity and readiness read paths (digest)

#### A. Proto (`packages/proto/analysis/v1/analysis.proto`) and field sources
`Opportunity` (:603). Marked E = a per-bar evaluation row could supply it, X = needs another source.
- E `symbol`=1, `strategy_id`=7 (the row key).
- X `action`=2 (`OpportunityActionTag`: ENTER 1 / ADD 2 / REDUCE 3). Derived by `_resolve_action_tag` (servicer.py:7192) from held-state, signal direction and whether the exit rule fires. Only "exit rule fires" comes from evaluation.
- E `conviction`=3 is the readiness ordinal from `_conviction_ordinal` (evaluator.py:1136): 1.0 when passing==total, else ratio plus a nudge. It is zeroed (`zeroed`, :6234) for unavailable, fundamentals-skip, and unreadable/failed non-held rows.
- E `passing_conditions`=4, `total_conditions`=5, `conditions`=18 (`ConditionEval`) are read from `readiness_json`.
- X `thesis`=6 is the best signal's headline.
- X `source`=8 is `_primary_source(provenance)` (:7217).
- X `valid_until`=9 is `session_end + opportunity.valid_window_hours`, or `now + live_only_cycle_max_days` for live-only rows (:6293-6299).
- X `opportunity_key`=10 = `user|SYMBOL|strategy_id` (`_opportunity_key` :7161).
- X `provenance`=11 holds the origins: `watchlist`, `position`, `live_strategy`, signal source slugs, and the markers `denied`, `unavailable`, `fundamentals_unavailable`, `formula_unreadable`, `evaluation_failed`.
- X `muted`=12, `data_unavailable`=20, `fundamentals_unavailable`=23, `formula_unreadable`=25 are derived from provenance markers (`_row_to_opportunity` :7307). `muted` comes from the deny list. The others partly depend on the evaluation outcome.
- X `live_price`=13, `change_pct`=14, `sparkline`=17 are READ-TIME only. `sparkline` is never populated server-side.
- E `target_price`=15, `stop_price`=16 come from `StrategyDefinition.signal_params` and are persisted in `readiness_json`.
- X `signal_confidence`=19 is the raw max signal conviction, in `readiness_json`.
- X `composite_score`=21 is a column. It is a blend of the readiness conviction and a signal sub-score (`_composite_score` :7256).
- X `symbol_score`=22 is a column, a symbol-wide roll-up weighted by strategy grade (`_symbol_score_for_group` :7291).
- E/X `fundamentals_gap`=24 (`FundamentalsGap`) rides `readiness_json["fundamentals_gap"]`. It is set by `_label_fundamentals_skip_rows` (:2133, marketdata ETF lookup).
- All of 13-16, 19, 21 and 22 are `optional`. `Opportunity` fields 1-25 are all listed above.

`SymbolReadiness` (:677): `symbol`=1, `conviction`=2, `passing_conditions`=3, `total_conditions`=4, `conditions`=5, `formula_unreadable`=6. All are E (the trace dict from `_readiness_from_evals`, evaluator.py:1159, plus the `formula_unreadable` flag).

`ConditionEval` (:667): `ref_name`=1, `lhs_value`=2, `threshold`=3, `fn`=4, `state`=5 (`ConditionState` PASS=1 / SOFT=2 / FAIL=3), `distance_to_threshold`=6.

`ReadinessRule` (:729): UNSPECIFIED=0 (treated as ENTRY), ENTRY=1, EXIT=2.

`ListOpportunitiesRequest` (:704):
- `page`=1 (offset in `page_token`), `min_conviction`=2, `sources`=3
- `action_filter`=4, `sort`=5 (`OpportunitySort`: UNSPECIFIED 0 = blended / CONVICTION 1 / EXPIRY 2 / SYMBOL_SCORE 3), `symbol`=6

`ListOpportunitiesResponse` (:713): `opportunities`=1, `page`=2, `computing`=3, `compute_failed`=4, `available_sources`=5 (page 0 only).

`EvaluateReadinessRequest` (:735): `strategy_id`=1, `symbols`=2, `rule`=3.
`EvaluateReadinessResponse` (:744): `readiness`=1, `computed_at`=2 (the oldest served row).

`GetWatchlistReadinessRequest` (:773): `watchlist_id`=1, `page`=2.
`GetWatchlistReadinessResponse` (:777): `rows`=1, `page`=2.

`WatchlistReadinessRow` (:762): `symbol`=1, `strategy_id`=2, `state`=3, `readiness`=4 (set only when RESOLVED), `computed_at`=5.

`ReadinessState` (:752): UNSPECIFIED=0, RESOLVED=1, PENDING=2, UNKNOWN=3.

`SetOpportunityActionRequest` (:792): `opportunity_key`=1, `action`=2, `snooze_until`=3. Response is empty. `OpportunityAction` enum (:783): SNOOZE=1, DISMISS=2, TAKE=3. The action tag is a read-time filter only (DISMISS and active SNOOZE rows are dropped). It is not returned on `Opportunity`.

#### B. ListOpportunities and compute
- `ListOpportunities` (servicer.py:4804):
  - Offset pagination; default page size 50 (`_DEFAULT_OPP_PAGE_SIZE` :364). The window is sliced in Python from the full row list (:4889).
  - The DB phase runs under `budgeted_read` (budget key `opportunity.read_db_budget_ms`). A transient DB error aborts `UNAVAILABLE`.
  - Kicks fire in `finally` (:4867-4870).
  - The enrichment `_enrich_opportunities_live` (:4996) runs after the read. It makes one `BatchGetLatestPrice` and sets only `live_price` and `change_pct` (= (last − prev_close)/prev_close). It uses a per-symbol success-only memo (`opportunity.live_enrich_ttl_seconds`) and a deadline (`opportunity.live_enrich_timeout_ms`).
- `_read_opportunity_queue` (:4903):
  - One `opps.read(..., include_expired=True)` with filters and sort pushed into SQL (repositories/opportunities.py:238).
  - Min-conviction floor, exempt for the provenance markers `denied`, `unavailable`, `fundamentals_unavailable`, `formula_unreadable` and `evaluation_failed` (:298-301).
  - Source filter via the LATERAL primary source (:279-282), action filter `o.action = $8`, symbol filter `o.symbol = $9`, and the action-table join (:309-314).
  - Sort map `_SORT_ORDER_BY` (:46-64), with `opportunity_key ASC` as the tiebreak.
  - Branches:
    - (i)/(ii) any expired non-live-only row: serve as read and set `q.kick_full`.
    - (iii) all fresh: serve, then the 185 heal (:4944-4952, `q.retry_symbols`, 300 s `_OPPORTUNITY_UNAVAILABLE_RETRY_SECONDS`).
    - (iv) fresh rows plus expired live-only rows: re-read with `include_expired=False`, no kick, and `record_opportunity_read_reissue`.
    - (v) `elif not await opps.has_fresh(...)`: `count_for_user == 0` with no fresh empty-compute stamp sets `computing`, or `compute_failed` after `_OPPORTUNITY_COMPUTE_MAX_ATTEMPTS = 3`. An empty stamp serves empty with no flag. Non-zero count (all stale) re-reads with `include_expired=True` and sets `kick_full`.
    - Final `else`: `rows = []`, and 365 adds no kick.
  - `available_sources` (:4990) is page 0 only and scoped to the served freshness.
- `_compute_opportunities` (:5602) inputs:
  - Drains: active signals (`QuerySignals`), held positions (`ListPositions`, valued by `abs(market_value)` summed per symbol, :6776), watchlist bindings (`ListWatchlists`, delisted skipped), and source weights.
  - Strategies: `list_live_enabled(user_id)`. `_load_strategy_definition` (:6325) traces only a strategy that is `active AND live_enabled`; otherwise the row is 0/0.
  - Universe: `resolve_universe(...).union`, with deny-list `denied_covered` giving muted rows. The fundamentals blend strategy is restricted to its own universe.
  - Caps: `opportunity.max_universe_size` (100; curated rows are never cut, and the budget is `max_universe − curated − muted_only`), `opportunity.max_live_strategies_per_symbol` (5), `opportunity.max_live_held_symbols_per_compute` (20), `opportunity.max_live_only_symbols_per_compute` (20, rotation via `_rotation_chunk` :7174 and the persisted cursor).
  - There is no "entry fired on the last bar" gate. A watchlist, held or live row exists whatever its readiness. A speculative signal-only row with no actionable action is dropped (`_resolve_action_tag` returns None, :6199).
  - Rule: held means exit trace, otherwise entry trace (:6132). `exit_fires` = held and total>0 and passing==total → REDUCE (:6165).
  - `conviction` is the readiness ordinal, not "1.0 on entry". It is 1.0 only when all leaves pass.
  - Bars come from `BatchGetBars`, one 400-day window (`_READINESS_LOOKBACK_DAYS`), through the `_readiness_materializer_bars_sem` semaphore and the `_candidates_sem`.
  - Evaluator call: `evaluator.evaluate_conditions_traced(await self._sector_definition(...), bars, sym, rule=..., benchmark_bars=..., fundamentals=..., formula_fundamentals=..., formula_fundamentals_data=...)` (:6152).
  - `signal_axis` = max decayed signal conviction (`_signal_decay`).
  - Persisted via `replace_for_user` (delete then insert). Cursor and rows commit together via `_replace_and_stamp_compute_state` (:5113).
- Tables:
  - `analysis.opportunities` (migration 011): PK `(user_id, opportunity_key)`, columns `symbol`, `strategy_id`, `action`, `conviction`, `readiness_json`, `signal_axis`, `provenance`, `thesis`, `valid_until`, `computed_at`. Migrations 024 and 025 add `composite_score` and `symbol_score`.
  - `analysis.opportunity_actions` (010): PK `(user_id, opportunity_key)`, `action`, `snooze_until`, `created_at`.
  - `analysis.opportunity_compute_state` (023): PK `user_id`, `computed_at`, `valid_until`. Migration 030 adds `live_only_cursor`.

#### C. Readiness
- `EvaluateReadiness` (:4103):
  - Owner-scoped; `get_by_owner_and_id` miss → `PERMISSION_DENIED`.
  - `rule` EXIT → "exit", else "entry".
  - Per symbol: cache row from `readiness_cache_repo.read_many(user, strategy, rule, symbols)`. A hit that passes `is_readiness_row_fresh` (readiness.py:16) serves FAST.
  - Otherwise SLOW: `compute_readiness_row` (readiness.py:38) → `evaluate_conditions_traced`, then `upsert_many`.
  - `latest_bar_epoch` comes from a `GetDataCoverage` probe per symbol (10-day window; a miss reads 0).
  - Per-symbol failure returns an empty 0-of-0 `SymbolReadiness` and is not staged.
  - `computed_at` = oldest served row.
- `is_readiness_row_fresh`: `def_fingerprint == fingerprint and now < valid_until and bar_epoch >= latest_bar_epoch`.
- `GetWatchlistReadiness` (:4271):
  - Pairs come from portfolio `GetWatchlist` bindings with a non-empty `strategy_id`, sorted `(symbol, strategy_id)`, with a keyset base64 token (`_encode_pair_token` :6888). Default page size 25 (:360).
  - Reads cache rule "entry" only.
  - Classifier: `bar_epoch<0` → UNKNOWN (re-kick after `_READINESS_UNKNOWN_RETRY_SECONDS` = 300); fresh → RESOLVED; else PENDING. A missing strategy → UNKNOWN with no kick.
  - Not-fresh pairs call `_kick_readiness_refresh(...)` (:4395, defined :4411). It is deduped by the `_readiness_kicking` set and uses `_readiness_materializer_bars_sem`. It is a READ-TRIGGERED compute, so a projection read must not call it.
- `analysis.readiness_cache` (022): PK `(user_id, strategy_id, rule, symbol)`, `def_fingerprint`, `bar_epoch BIGINT`, `readiness_json`, `computed_at`, `valid_until`. `bar_epoch=-1` is the unavailable sentinel (`unavailable_readiness_row`, readiness.py:110, `readiness_json={}`).
- `readiness_json` shape (output of `_readiness_from_evals`): `{"symbol":"AAPL","conviction":0.5,"passing_conditions":1,"total_conditions":2,"conditions":[{"ref_name":"rsi","lhs_value":28.0,"threshold":30.0,"fn":"<","state":1,"distance_to_threshold":-0.0}], "formula_unreadable":true?}`. Opportunity rows add `target_price`, `stop_price`, `signal_confidence` and `fundamentals_gap` to it.
- Materializer: `run_readiness_materializer_forever` (:6627); the tick is `_readiness_materializer_tick` (:6585). It is gated by `readiness_materializer.enabled` (default false). It warms live-strategy bound pairs (rule "entry") for `list_live_enabled`.

#### D. What a "pure projection read" cannot get from a stored per-bar result
- Read-time: `live_price`, `change_pct` (from `BatchGetLatestPrice`), `available_sources`, `computing`, `compute_failed` (in-process `_opportunity_compute_failures`), the pagination token, and `valid_until > now()` and the expiry kicks.
- Read-time state: user actions (`opportunity_actions` DISMISS/SNOOZE filter), `min_conviction`, source/action/symbol filters and the sort. Sort 0 and 3 depend on `opportunity.signal_rank_weight` and the symbol roll-up.
- Held/watchlist/signal/live-coverage state at compute time: `action`, `provenance`, `thesis`, `signal_axis`, `composite_score`, `symbol_score`, `muted`.
- Anything built on `_drain_*` and the strategy owner (`strategy_weight`, `grade_lookup`).
- `EvaluateReadiness.computed_at` and the `readiness_cache` FAST/SLOW freshness (`stale_after_seconds`, `bar_epoch`). For a projection read the `PENDING` state needs a redefinition: no read kicks, so a missing row is probably UNKNOWN or PENDING with no refresh.
- Projection rows hold all active strategies (FR-2). Legacy opportunities hold only live_enabled strategies, so the opportunity set differs structurally.

#### E. Config keys read by these paths (namespace `analysis`; defaults per service `CLAUDE.md`)
- `opportunity.*`:
  - `signal_rank_weight` 0.3 (`get_float`, :4906)
  - `read_db_budget_ms` 20000 and `live_enrich_timeout_ms` 3000 (`int_positive`)
  - `live_enrich_ttl_seconds` 20 and `empty_recompute_ttl_seconds` 30 (`get_int_present`)
  - `valid_window_hours` 24, `max_universe_size` 100, `max_live_strategies_per_symbol` 5, `max_live_held_symbols_per_compute` 20, `max_live_only_symbols_per_compute` 20, `live_only_cycle_max_days` 3 (`int_positive`)
  - `refresh_hour_utc`, `startup_jitter_seconds`, `retry_seconds`, `snooze_default_hours`
  - `max_concurrent_bars_fetches` 2, `max_concurrent_candidates` 4
- `readiness.stale_after_seconds` 30 (`get_int_present`, :4151).
- `readiness_materializer.*`: `enabled` false (`get_bool`), `refresh_hour_utc` 0, `valid_window_hours` 24 (`get_int_present`, :4431), `max_concurrent_bars_fetches` 2.
- `scoring.*`: `signal_decay_half_life_hours`, `composite_shrinkage_k`, `composite_weight_readiness`, `composite_weight_signal`, `symbol_score_decay` (read-clamped [0, 0.99]), `strategy_weight_floor`.
- `backtest.fundamentals.enabled`.
- String-enum pattern for `projection.read_source`:
  - Accessors: `cfg.get_str(key, default)` (`app/config/watch_core.py:217`) and `str_nonempty(cfg, key, default)` (`app/config/watcher.py:82`).
  - Closed value set with fall-through: `fundsignal.universe_source` (`app/engine/fundsignal_loop.py:389`) is `self._cfg.get_str("fundsignal.universe_source", "watchlists")`. `"explicit"` and `"both"` are branched on; any other value falls to `watchlists`. There is no WARN, so a missing or unknown value silently reads the default.
  - Also `engine.fundamentals_blend_strategy_id` via `str_nonempty` (servicer.py:384).
  - A type mismatch warns once and returns the default (`_typed`, watch_core.py:205).

#### F. Consumers
- UI hooks (`services/xstockstrat-ui/src`):
  - `hooks/useOpportunities.ts:35` (`analysisClient.listOpportunities`, sends `minConviction`, `sources`, `actionFilter`, `sort`, `symbol`, `page{50,token}`; reads `computing`, `computeFailed`, `page.nextPageToken`).
  - `hooks/useOpportunities.ts:83` (`evaluateReadiness({strategyId, symbols, rule})`).
  - `hooks/useWatchlistReadiness.ts:38` (`getWatchlistReadiness({watchlistId, page{25,token}})`; polls on `state` PENDING or UNKNOWN every 30 s).
  - BFF forwards: `lib/insightsBff.ts:63`, `:68`, `:71`.
- UI `app/insights/opportunities/page.tsx` reads: `symbolScore`, `muted`, `formulaUnreadable`, `passingConditions`, `totalConditions`, `validUntil`, `availableSources`, `opportunityKey`, `dataUnavailable`, `fundamentalsUnavailable`, `fundamentalsGap`, `compositeScore`, `computing`, `computeFailed`, `livePrice`, `changePct`.
- UI `components/insights/SignalReadiness.tsx` reads `conditions`, `formulaUnreadable`, `conviction`, `passingConditions`, `totalConditions`.
- UI `components/insights/WatchlistReadiness.tsx` reads `rr.state`, `rr.readiness`, `symbol`, `strategyId`.
- Agent: `services/xstockstrat-agent/app/client.py:959` `list_opportunities` calls `ListOpportunities` (:977) with `min_conviction` and `page` only. It returns `computing`, `compute_failed`, `next_page_token` and `_opportunity_to_dict` (:892), which projects every `Opportunity` field. It does not read `available_sources`. The agent has no call to `EvaluateReadiness` or `GetWatchlistReadiness`.

#### G. Durable scenarios (`services/xstockstrat-analysis/acceptance/`)
- `opportunities-server-side-filters.feature` (190; 289 AC-17), 15 AC: AC-1..AC-13 and AC-17. Pins min_conviction floor, floor exemption for muted and unavailable rows, source/action filters, expiry/conviction sort and symbol grouping, `available_sources`, pagination, and the non-held unreadable row.
- `opportunity-compute-robustness.feature` (185, 289, 308), 22 AC: cold read non-blocking (AC-6), `compute_failed` (AC-7), 185 surgical heal (AC-8/9), data-unavailable sentinel round-trip (AC-1/2/5), semaphore isolation (AC-4), plus the 289 unreadable-formula set (AC-1, 4, 9, 10, 15, 16, 18, 21, 24, 25, 26).
- `readiness-caching-poll-discipline.feature` (177, 181, 289), 13 AC: 177 AC-1/2 (FAST path, bar bust), AC-4 (empty-universe no recompute), AC-5 (warm live enrichment), 181 AC-2 (UNKNOWN) and AC-3 (PENDING on bar bust), 289 AC-2/3/8/13/19/20 (degrade per symbol, cache-only unreadable, marker persistence).
- `watchlist-readiness-precompute.feature` (180), 6 AC: AC-2 to AC-6 (derived universe, stale row recompute, resource envelope, on-demand fallback, non-live strategy not materialized).
- `fix-a-filtered-listopportunities.feature` (365), 2 AC: AC-1 (a filtered read with no matches leaves a fresh queue untouched), AC-2 (a symbol-filtered read for an absent symbol does not recompute).
- `opportunity-live-only-rotation.feature` (366), 13 AC: AC-1 to AC-12, and AC-2a. The read-side behaviour pinned is the live-only expiry (AC-12) and the carried rows' survival (AC-3).
- `opportunities-pagination-drain.feature` (187): AC-1 (server default page size 50). Total count 2.
- `opportunities-latency-fix.feature` (191, 330), 7: AC-6, 7, 8, 9, plus 330 AC-2 (warm 15 s re-poll served from the live-enrich memo).
- `fix-opportunities-read-hangs.feature` (227), 4: AC-1 (stalled enrichment returns unenriched rows within the deadline), AC-4 (exhausted DB pool fails fast).
- `opportunity-composite-score.feature` (199): AC-1 through AC-7, AC-10, AC-11, AC-12. Pins the column semantics (NULL composite for unavailable and muted rows).
- `symbol-opportunity-ranking.feature` (200): AC-1, 2, 3, 4, 6, 7, 10. Pins `symbol_score`.
- `opportunity-live-market-enrichment.feature` (095): AC-14 (live quote not folded into ranking).
- 289 was never a separate file; its scenarios are in the three feature files above.

#### H. Tests
- ListOpportunities, EvaluateReadiness and GetWatchlistReadiness tests in `tests/test_analysis_servicer.py` (27 call sites), `test_watchlist_readiness.py` (12), `test_readiness.py` (5), `test_readiness_opportunities_source_symbol.py` (5), `test_readiness_cache.py` (4), `test_per_symbol_isolation.py` (4), `test_unreadable_formula.py` (7), `test_opportunity_compute_state.py` (3), `test_list_opportunities_deadlines.py` (2), `test_read_budget_real_pg.py` (2), plus `test_opportunity_rotation.py`, `test_opportunity_rotation_real_pg.py`, `test_opportunities_repo.py`, `test_opportunities_latency.py`, `test_readiness_materializer.py`.
- Fakes: `_FakeOppRepo` (`tests/test_analysis_servicer.py:4503`; in-memory `read` re-applies filter and rank), `_FakeReadinessCache` (:4672; `read_many` returns `{}`, `upsert_many` records), `_FakeComputeState` (`tests/test_opportunity_compute_state.py:28`).
- Descriptor-parity patterns:
  - Analysis: `TestOpportunityRowParity` (`tests/test_analysis_servicer.py:6412`) has `_MAPPED | _INTENTIONALLY_UNSET == set(analysis_pb2.Opportunity.DESCRIPTOR.fields_by_name)` (:6452). `_INTENTIONALLY_UNSET = {"live_price", "change_pct", "sparkline"}`. It also has `test_guard_has_teeth` and `test_mapper_populates_all_fields`.
  - Agent: `services/xstockstrat-agent/tests/test_opportunity_projection.py:55` (emitted keys == `Opportunity.DESCRIPTOR.fields_by_name`), `test_backtest_view.py:222`, `test_position_parity.py:45`.
  - Use `_row_to_opportunity` plus this test as the template for a projection parity test per RPC.

## Patterns to REUSE

- Scoring one strategy on one symbol → `StrategyEvaluator.for_owner(owner)` then `evaluate` /
  `evaluate_conditions_traced` (`app/services/evaluator.py:261`, `:292`, `:398`); never a second
  scoring path.
- Transition and cooldown rules → `_apply_transition` (`app/engine/live_loop.py:209`) and
  `app/services/cooldown.py:42`, `:63`.
- Definition fingerprint → `_definition_fingerprint`, `_formula_digest`, `_evidence_fingerprint`
  (`app/handlers/servicer.py:7715`, `:7760`, `:7789`), module-level and importable from a handler.
- Opportunity row mapping and its parity test → `_row_to_opportunity`
  (`app/handlers/servicer.py:7307`) and `TestOpportunityRowParity`
  (`tests/test_analysis_servicer.py:6412`).
- Readiness JSON shape → `_readiness_from_evals` (`app/services/evaluator.py:1159`),
  `unavailable_readiness_row` (`app/services/readiness.py:110`).
- Active strategies of a user → `StrategiesRepository.list(user_id)`
  (`app/repositories/strategies.py:189`).
- Job kinds, lanes, park, kill-switch accessor, ensure hook → feature 367 and feature 368's design
  (§§ 2, 5, 18).
- Outbox table shape → notify's webhook delivery queue (`INSERT … ON CONFLICT (idempotency_key) DO
  NOTHING`, states pending/delivered/dead); ledger idempotency → `AppendEventRequest.idempotency_key`
  (`packages/proto/ledger/v1/ledger.proto:46-50`).
- Bounded compute → `app/services/compute_pool.py`, `run_bounded` (`app/config/live_limits.py:56`).
- String config key with a closed set → `fundsignal.universe_source`
  (`app/engine/fundsignal_loop.py:389`).
- Telemetry → wrappers in `app/telemetry.py`; no user, symbol or strategy label; at most 8 loop
  names for analysis, 6 used today.
- Tests → `virtual_time`, `local_pg`, `pipeline_pg` (`tests/conftest.py:439`), the handler contract
  test, `real_live_loop` (`tests/conftest.py:96`).

## Existing Business Rules (preserve / extend)

- **PRESERVE** `@AC-1..@AC-18 @feature-367` all scenarios in `services/xstockstrat-analysis/acceptance/pipeline-job-graph.feature` — idempotent keys, fenced leases, retry, park/blocked verdict, held-before-watchlist, run grouping, prune, kill switch; evaluation jobs must live inside this contract.
- **EXTEND** `@FR-2 @regression @feature-367` "The three pipeline boot tasks start through the supervision helper" (same file), with `@AC-4 @FR-2 @regression @feature-259` (`.../fix-python-loop-supervision.feature`) — dispatcher and parity tasks use `spawn`.
- **EXTEND** `@FR-8 @regression @feature-367` "The pipeline instruments carry host.provider" and `@AC-2/@AC-3/@AC-18 @feature-337` (`docs/sdd/business-rules/platform.feature`) — every new instrument carries `host.provider`.
- **EXTEND** `@FR-9 @regression @feature-367` "The analysis pipeline keys are seeded in both environments…" (`services/xstockstrat-config/acceptance/pipeline-job-graph.feature`), `@AC-14 @FR-5 @regression @feature-295` (`.../fix-config-keys-drift.feature`) — seed `pipeline.evaluation_enabled` (bool true) and `projection.read_source` (string `legacy`) in both environments, relative.
- **PRESERVE** `@AC-1 @regression @feature-327`, `@AC-3`, `@AC-4`, `@AC-5` (`.../fix-analysis-evidence-dry.feature`) — the fingerprint covers definition plus formula content, and a formula edit changes it.
- **PRESERVE** `@AC-2 @regression @feature-327` "the boot entry-backfill selects strategies through LIVE_ENABLED_PREDICATE_SQL" — stays live-only; "all active" is a separate selection.
- **PRESERVE** `@AC-1 @FR-1 @regression @feature-262`, `@AC-2 @FR-2`, `@AC-3 @FR-3`, `@AC-8 @FR-3` (`.../fix-analysis-owner-scope.feature`) — owner-scoped state, no cross-owner seeding, per-owner failure isolation; the shadow path writes no live-loop state.
- **PRESERVE** `@AC-8 @FR-1 @feature-225`, `@AC-16 @FR-1`, `@AC-17 @FR-1` (`.../private-by-default-enforce-contract.feature`), `@AC-2 @FR-2 @regression @feature-313` (`.../fix-system-identity-paths.feature`), and indicators `@AC-1 @FR-1 @feature-225`, `@AC-2 @FR-2`, `@AC-10 @FR-1` — jobs use `owner_metadata`; `system` and ownerless units are skipped or degraded.
- **PRESERVE** indicators `@AC-2 @FR-2 @regression @feature-228`, `@AC-1 @FR-1 @regression @feature-300`, `@AC-1 @regression @feature-310`, `@AC-3 @regression @feature-310` — sandbox limits and typed failures; a refused or killed formula is one strategy's failure row.
- **PRESERVE** `@AC-1 @FR-1 @FR-2 @regression @feature-289`, `@AC-9 @FR-3`, `@AC-15 @FR-1 @FR-6`, `@AC-16 @FR-6`, `@AC-18 @FR-2 @FR-6`, `@AC-21 @FR-1 @FR-2` (`.../opportunity-compute-robustness.feature`) — unreadable is distinct from unavailable and survives storage.
- **EXTEND** `@AC-1 @regression @feature-308`, `@AC-3 @regression @feature-308` (`.../fix-analysis-per-symbol-isolation.feature`), `@AC-1 @FR-1 @regression @feature-245` (`.../fix-screener-symbol-isolation.feature`) — adds strategy-level isolation within a job (369 AC-5).
- **PRESERVE** `@AC-6 @FR-4 @feature-215`, `@AC-8 @FR-8`, `@AC-9 @FR-8`, `@AC-13 @FR-3 @FR-8` (`.../block-fundamentals-strategy-on-etf.feature`) — fundamentals guard (ETF denial, outage is not absence).
- **PRESERVE** `@AC-2 @FR-2 @feature-168` (`.../fundamentals-blend-universe.feature`), `@AC-1/@AC-2 @FR-1 @feature-186` (`.../fundamentals-blend-strategy-restrictions.feature`), `@AC-1 @regression @feature-193` — see Notes N1.
- **PRESERVE** `@AC-4 @FR-3 @regression @feature-242`, `@AC-7 @FR-3 @regression @feature-242` (`.../fix-push-untargeted-broadcast.feature`) — owner-targeted alerts; the new path sends none.
- **PRESERVE** `@AC-2 @FR-5 @regression @feature-293` (`.../fix-analysis-live-loop-budget-seed.feature`), `@AC-9 @FR-4 @regression @feature-244` (`.../fix-python-config-stored-zero.feature`), `@AC-15/@AC-16/@AC-51 @FR-5 @feature-294` (`.../signal-map-instrumentation.feature`) — live-loop budget, throttle and counters are unchanged by the shadow path.
- **EXTEND** `@AC-1..@AC-7 @feature-356` (`.../fix-analysis-held-position-drains.feature`) — the lane classification uses the same drain, and a failed drain is an error, never "not held".
- **PRESERVE** `@AC-4 @FR-3 @feature-185`, `@AC-6 @FR-6 @feature-176` (`.../opportunity-compute-robustness.feature`, `.../analysis-concurrency-offload.feature`), `@AC-23 @FR-7 @preserve @feature-295` — background evaluation must not starve interactive reads and must respect the compute-thread bound.
- **PRESERVE** `@AC-7 @FR-2 @feature-294`, `@AC-41 @FR-15 @feature-294`, `@AC-42 @FR-15 @feature-294` (`docs/sdd/business-rules/platform.feature`) — at most 8 loop names; no identifier labels; telemetry is a no-op when OTel is disabled.
- **PRESERVE** `@AC-1 @FR-1 @regression @feature-244`, `@AC-4 @FR-2`, `@AC-27 @FR-11 @regression @feature-295`, `@AC-4 @FR-3 @feature-279` — config getter and DB-routing rules.
- **PRESERVE** `@AC-1 @regression @feature-227`, `@AC-4 @regression @feature-227` (`.../fix-opportunities-read-hangs.feature`) — read deadline and pool-acquire timeout, for both sources.
- No acceptance suite for xstockstrat-marketdata is in scope; it is called through unchanged RPCs.

### Read-path scenarios that would change under `read_source=projection`

These are CHANGE rows for program feature 4 (`pipeline-cutover`), not for this feature. All are
untouched while the source is `legacy`.

These are CHANGE rows for program feature 4 `pipeline-cutover`, not for 369. All are untouched while the source is `legacy`.
- `@AC-6 @FR-4 @feature-185`, `@AC-7 @FR-4` — a "cold read is non-blocking and distinguishable from an empty universe" and "terminal error, not spinner". Under projection a user with no results gets an empty page (369 AC-17).
- `@AC-8 @FR-5 @feature-185`, `@AC-9 @FR-5`, `@AC-9 @FR-3 @feature-289` — read-time heal and recompute. A projection read computes nothing.
- `@AC-1`, `@AC-2`, `@AC-4`, `@AC-5 @FR-1/@FR-3/@FR-4/@FR-5 @feature-177` — readiness cache freshness, bar-bust, empty-universe suppression, warm enrichment skip. All are replaced by stored results.
- `@AC-3 @feature-181 @feature-180`, `@AC-2 @feature-181` — PENDING vs UNKNOWN decoration. Projection maps "no row" to PENDING (369 AC-25), so the UNKNOWN case needs a failure-row mapping.
- `@AC-2`..`@AC-6 @feature-180` — the materializer is retired, "uncovered pair computes on demand" becomes a pure read, and "non-live binding not materialized" changes because all active strategies are evaluated.
- `@AC-1`..`@AC-12 @feature-366` — live-only rotation, carry and cursor. The queue compute is retired and the projection covers every pair.
- `@AC-7`, `@AC-8`, `@AC-9 @feature-131` caps — per-symbol and held caps no longer apply to "all active" results.
- `@AC-1`..`@AC-12 @feature-199`, `@AC-1`..`@AC-10 @feature-200` — composite and symbol scores. The shadow path has no signals map, so the signal axis differs.
- `@AC-1`..`@AC-13 @feature-190`, `@AC-17 @FR-2 @feature-289` — filters, sort and `available_sources` need every legacy field in the projection (C-10(b)).
- `@AC-1 @regression @feature-365`, `@AC-2 @regression @feature-365` — "fresh queue" no longer exists, and the no-recompute guarantee holds trivially.
- `@AC-6/@AC-7/@AC-8 @feature-191`, `@AC-8/@AC-9 @feature-158` — drains, `BatchGetBars` and the daily refresh are retired.
- `@AC-1 @FR-1 @feature-187` (default page size 50) and `@AC-1 @feature-095` / `@AC-8 @feature-191` / `@AC-2 @feature-330` / `@AC-5 @feature-177` (live-quote enrichment, TTL memo) — PRESERVE under projection. The live quote is a read-time overlay, but 369 AC-16 says a read fetches no bars. Whether `BatchGetLatestPrice` enrichment survives is a design question.

### Notes

- **N1 (blend universe, EXTEND or CHANGE unclear, default PRESERVE).** 369 FR-2 evaluates every active strategy on every symbol in the user's universe. `analysis/fundamentals-blend-universe.feature` AC-2 and 186 AC-1/AC-2 restrict the blend strategy to the fundamentals universe and skip it when disabled. The design must decide whether the projection honours that restriction. If it does not, parity reports mismatches at cutover and a CHANGE needs sign-off.
- **N2 (watchlist and caps).** The live loop honours watchlist bindings and the 50-pair cap. 369 differs by design (shadow only). 369 AC-18 and AC-29 compare only the overlap, so this is not a 369 CHANGE.
- **N3 (no CHANGE in 369).** None of the 367 rules is altered. The two new keys are additive and the shadow path writes no live-loop state.
- **N4 (rule not written).** The live-loop cooldown and entry-exit semantics (069, 116) have no `@AC-*` in the analysis suites beyond 262 AC-2 and the backtest portfolio rule. No such guarantee is invented.

## Dependencies

- Proto/RPC: none changed. Consumed: indicators `ComputeIndicator`, `ExecuteFormula`, `GetFormula`
  (`packages/proto/indicators/v1/indicators.proto:54`, `:75`); marketdata bars and fundamentals
  reads; the three analysis read RPCs (`packages/proto/analysis/v1/analysis.proto:603-800`).
- Migration: analysis `033` (after 368's `032`); config `063` (after 368's `062`).
- Config keys: new `analysis` / `pipeline.evaluation_enabled`, `analysis` / `projection.read_source`.
- Inter-service edges: analysis → indicators, marketdata (existing). No new edge.
- New env vars / ports: none.

## Risks / Not-found

- **Parity target.** The live loop writes nothing per evaluated pair. Its only durable per-pair
  record is `analysis.strategy_cooldowns` (the bar time of the latest entry and exit, overwritten),
  and its ledger event has no symbol date, user id or idempotency key. It evaluates the forming
  daily bar every 60 s, at most 50 pairs a cycle, and only live-enabled strategies. So "the live
  loop decided X for bar D" is observable only for transitions, only after the close, and only
  through cooldown rows or ledger events.
- **Opportunities are not evaluation results.** The legacy opportunity set is universe membership
  (signals ∪ held ∪ watchlist bindings ∪ live coverage) for live-enabled strategies, with action,
  thesis, provenance, signal axis, composite score and symbol score derived from signals,
  positions, the deny list and strategy grades at compute time. A per-bar evaluation row supplies
  only the readiness trace, the conviction ordinal, target and stop prices, and whether the exit
  rule fires. A field-for-field projection read needs those other inputs stored too.
- **Readiness has two rules.** A held symbol is traced with the exit rule, others with the entry
  rule; `EvaluateReadiness` takes the rule as a request field.
- **Cost.** One RPC to indicators per component per strategy, serial, no cache, plus one
  `GetFormula` per distinct formula per pair; `sandbox.max_concurrent` is 4 on DigitalOcean. The
  program plan's "compute built-in indicators once per job" has no existing mechanism.
- **Bars read.** Evaluation needs about 365 to 400 days of daily bars per symbol. Every bars read
  RPC marks the symbol warm (368 design § 17).
- **Look-ahead.** The evaluator is causal over the bars it is given, but the live loop passes the
  current fundamentals snapshot and the current sector, not as-of values; benchmark bars and
  point-in-time fundamentals must be truncated by the caller.
- **Fundamentals guard and blend strategy.** An ETF is denied entry for a fundamentals strategy;
  the blend strategy is restricted to its own universe. "Every active strategy on every universe
  symbol" must decide whether these restrictions hold in the projection.
- **Identity.** A job has no inbound request; indicators accepts only a real owner, and formulas
  are private to their author.
- **Loop names.** Analysis may have at most 8; 6 are used. A dispatcher and a parity step as loops
  would use the last two.
- **Notify has no idempotent persist** (`EmitAlert` inserts a new row each call); ledger has one.
  Relevant to program feature 4, and to how the outbox key is shaped now.
- **Handler DB gate.** One handler DB block at a time per instance on the 2-connection service
  pool; about 10,000 evaluation jobs per session at the D-13 ceiling each need at least one block.
- **Deferred by 367 to this feature**: hazards H1 and H2 for an in-transaction report; handlers
  that run work in an executor thread; the shadow-run measurements
  (`docs/roadmap/features/367-pipeline-job-graph/design.md:601-627`).
- **Test data.** No shared bar builder exists; `_bar` helpers are duplicated across about ten test
  files (C-13 hazard for a new consumer).
- Ledger traps that apply: a hand-maintained projection must be pinned by an executable parity
  test (2026-08-01); every read path that exposes a value must agree (C-10(b)); the 368 debate's
  rule to re-read any guard under the lock in the writing transaction; plan review lenses up front.
- Not found (evaluation digest):
- Any cache of component series keyed by (indicator, params, bars) in the evaluator or live loop.
- Any per-pair, per-bar record of what the live loop decided (see C).
- Any `ensures` hook, 368 tables or bar record in code (design-only, as stated).
- A `state='pending'` outbox table or a dedupe key on live-loop alerts or ledger events.
- A documented RPC-count figure for one strategy evaluation.
- A rate limit or concurrency cap on `ComputeIndicator` (only the `ExecuteFormula` sandbox cap `sandbox.max_concurrent`).
- A `PLAT-N1` full-text read: only the head of the `docs/context-constitution.md:50` line was seen.
- Migrations after `031` in analysis: `031` is the latest, so `032` is free for 368 and `033` for 369, as the spec says.
- Deployment-file env-var audit (checklist item h): skipped, since the spec lists no new env vars.

- Not found (read-path digest):
- A "closed bar" or per-bar notion in the legacy read path. `session_end` is simply the newest bar seen in the compute, and `bar_epoch` is the readiness analogue.
- A single-row "ENTRY transition on last bar" gate. Opportunity eligibility is universe membership, not an entry decision.
- A `projection.read_source` key or accessor. Not present anywhere (grep for the name was not run, but nothing in the files read mentions it).
- An agent call to `EvaluateReadiness` or `GetWatchlistReadiness`.
- Existing per-RPC projection parity tests for `EvaluateReadiness` or `GetWatchlistReadiness`.
- The `acceptance.feature` for feature 369 was not read, so FR-to-AC mapping is not covered here.

## Recommended Scope

Advisory, for the debate and `/sdd-spec`:

1. Config `063`: the two keys.
2. Analysis migration `033`: result rows with position state, the outbox, whatever the parity step
   stores.
3. Evaluation job kind and its trigger from 368's bar records and snapshot.
4. The per-strategy evaluation with isolation, the fingerprint, state transitions and the outbox
   write in one transaction.
5. The dry-run dispatcher.
6. The projection read path for the three RPCs behind the switch, with a parity test per RPC.
7. The parity step and the shadow measurements.
8. Retention, telemetry, docs.
