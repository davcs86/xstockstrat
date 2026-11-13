# xstockstrat-analysis — CLAUDE.md

<!-- context-forge:constitution-pointer:start -->
> **Constitution:** non-obvious local invariants (tail-align indicator results, empirical-Bayes evidence-weighted scoring, definition-json fingerprint eligibility, custom-formula `len==n` requirement) live in this service's `docs/` folder (**`context-constitution.md`**); defects (gross-vs-net P&L basis) in this service's `docs/` folder (**`context-constitution-findings.md`**). Inherits the root [`PLAT-*` constitution](../../docs/context-constitution.md).
<!-- context-forge:constitution-pointer:end -->

## Role

Python gRPC service for strategy backtesting, scoring, and report generation. Reads historical market data from xstockstrat-marketdata and computed indicators from xstockstrat-indicators. Optionally fetches newsletter signals from xstockstrat-ingest for signal-weighted strategies. Writes backtest results to xstockstrat-ledger.

Beyond the gRPC server, the service runs an **asyncio live evaluation loop** (`app/engine/live_loop.py`, feature 048) that continuously evaluates `live_enabled` strategies via the shared evaluator (`app/services/evaluator.py`) and emits alerts to xstockstrat-notify on entry/exit transitions — guaranteeing backtest/live parity. The loop never places orders.

### Strategy Ownership (feature 133)

Strategies are **per-user**: `analysis.strategies` (and `analysis.strategy_cooldowns`) carry a
`user_id` and a **composite `(user_id, strategy_id)` primary key**, so two users may register the same
`strategy_id` without collision. Ownership is resolved from the inbound **`x-user-id` header, never
the request body** (`servicer._caller_user_id`); every owner-scoped RPC — `GetStrategy`,
`RunBacktest` (registered `strategy_id_ref`), `ScoreStrategy`, `EvaluateReadiness`, `ManageStrategy`,
`SetStrategyLive`, `GetStrategyReport`/`ListBacktests`/`GetStrategyAnalytics` — resolves the row via
`get_by_owner_and_id` and returns a **uniform `PERMISSION_DENIED`** for any ownership miss (no
NOT_FOUND vs PERMISSION_DENIED distinction — anti-IDOR). `ManageStrategy`/`SetStrategyLive` are
**ownership-gated, not admin-gated** — the former server-side admin gate was removed; any
authenticated caller acts on their **own** strategies. `ListStrategies`/`ListStrategyDefinitions`
filter to the caller's own rows. Since feature 224 the derived-score cache is owner-keyed too:
`analysis.strategy_scores_v2` (`PRIMARY KEY (user_id, strategy_id)`, migration `026`), as are the
in-memory `_strategies`/recompute-lock maps; the old bare-id `strategy_scores` table was dropped by
migration `027` (feature 225). The live loop keys its
per-`(user_id, strategy_id, symbol)` state on the owner; the owner-scoped firing **universe** union is
deferred to feature 132's `resolve_universe` (this feature is identity-only).

### Owner-keyed evidence, identity threading & templates (feature 224)

Evidence and run history are owner-scoped (cross-owner `GetBacktest` → `PERMISSION_DENIED`, admins included).
Identity threading, unreadable-formula verdicts (`formula_unreadable`), the blend-id guard, the seeded
templates / seeded blend and the template saga → this service's `docs/` folder (**`ownership-and-templates.md`**).
System templates are read-only (root PLAT-19).

### Fail-closed identity & contract (feature 225)

- **Inbound gate.** 22 RPCs carry `owner_scoped`: a headerless call → `UNAUTHENTICATED` and an
  inbound `x-user-id: system` → `PERMISSION_DENIED`, before the body runs. `RunFundamentalsScan` is
  exempt because it is admin-gated.
- **Outbound owner metadata** is built only by `app/identity.owner_metadata`, which raises
  `ValueError` for an empty or `system` owner; that unit (tick user, sweep intent, drain row,
  snapshot's indicators/signals reads) is skipped, never sent headerless.
- **`QueryPnLPatterns` returns only the caller's samples** (semijoin on `pnl_positions.user_id`);
  legacy samples with a NULL `position_id` match no caller.
- **`backtest_runs.user_id` is NOT NULL** (migration `027`, `-- contract-of` `026`; its down raises).

### Strategy Score Persistence (feature 064)

`ScoreStrategy` write-through to `analysis.strategy_scores_v2` (best-effort) and boot-time `hydrate_scores()`
→ this service's `docs/` folder (**`scoring.md`**) § Strategy Score Persistence.

### Backtest Auto-Scoring & Run History

Each OK `RunBacktest` computes a **per-run** `StrategyScore` (via the shared `_score_from_metrics` /
`_grade` helpers that `_score_from_result` delegates to) and stores it only on the run-history row
(`backtest_runs.overall_score`/`rating`). **As of feature 065 the run's own aggregate is no longer the
headline grade** — the per-strategy headline is *derived* from the strategy's whole evidence base (see
**Cross-Stock Score Derivation** below), so a throwaway single-symbol run can never overwrite a
well-evidenced grade. The prior per-run headline upsert was removed.

Every completed run (OK **and** INSUFFICIENT_DATA) is also appended to `analysis.backtest_runs`
(migration `006`, `BacktestRunsRepository`) — a lightweight, durable **run history** of summary metrics
plus the score the run earned (INSUFFICIENT runs record history with a null score / empty rating). An
all-failed run (every symbol `EVALUATION_FAILED` or `FORMULA_ERROR`) is INSUFFICIENT_DATA, and its
per-symbol rows are in-memory only (on `latest_backtest`, not in history). The
`ListBacktests(strategy_id, limit)` RPC reads the latest rows back (newest first; `limit` 0 → server
default of 20) as typed `BacktestRunSummary`s, so past run results survive a restart and are visible in
the UI's "Past Runs" table. Full trades/diagnostics are **not** copied into history — those remain on the
in-memory `latest_backtest`; the history table stays a compact summary. All persistence is best-effort
(`try/except → log.warning`) so a DB failure never fails a run. Reuses the existing asyncpg pool
(no new pool — budget stays 2).

### Fundamentals Signal Producer (feature 062)

A daily asyncio loop (`app/engine/fundsignal_loop.py`) scores cached fundamentals (marketdata
`GetFundamentalsMulti` only, never FMP directly) and emits `ExternalSignal`s through ingest as the SAN-bound
`system` identity; `RunFundamentalsScan` runs the same `run_once`. Universe, idempotency, budget and
fail-closed scoring → this service's `docs/` folder (**`fundsignal.md`**).

### Shared durable scheduler (feature 158)

The durable, crash-safe schedule (seed-at-boot, compute-sleep-until-due, advance-**after**-completion,
bounded one-shot startup jitter, retry cadence) that feature 156 introduced inline now lives in the
shared **`app/engine/durable_schedule.py`** (`DurableSchedule`, **interval** + **wall-clock** modes;
plus the relocated `seconds_until_hour_utc`) backed by the `(job_name, user_id)`-keyed
`analysis.job_schedule` table (migration `020`, renamed from feature 156's `fundsignal_schedule`).
It is consumed by `fundsignal_loop` (interval) and `run_opportunity_refresh_forever` (wall-clock,
anchored to `analysis.opportunity.refresh_hour_utc`). Each loop keeps its own `_tick`/`run_forever`
(disabled gate, overlap lock, config reads); the helper owns only the timing/persistence seams.
**`live_loop` is NOT migrated** (feature 158 Out of Scope — a ~60s loop gains almost nothing from a
durable per-cycle row). No lease/CAS fencing is added (`instance_count:1` trap, ledger 2026-08-25).

**Supervision (feature 259).** The four `*_forever` loops (`fundsignal_loop.run_forever`,
`run_opportunity_refresh_forever`, `run_readiness_materializer_forever`,
`run_template_intent_sweep_forever`) seed via `app/supervision.py#retry_until_ok` and tick under
`run_supervised`: a failed seed, tick or schedule seam logs ERROR and sleeps
`_LOOP_ERROR_BACKOFF_SECONDS`, and the backoff never
advances the schedule. Every boot task in `app/main.py` is started with `supervision.spawn` (retained
in `_BACKGROUND_TASKS`; an exception exit logs ERROR naming the task). Peers adding a boot task reuse
`spawn` — never a bare `create_task`.

### P&L pattern consumer (feature 042)

`PnLPatternConsumer` (`app/engine/pnl_pattern_consumer.py`) reads one broad global-order `StreamEvents`: events in
order; short-circuit `sequence <= cursor`; snapshot before the txn; cursor advance atomic with the writes; audit
emits after commit. Retry in place, park only `_is_poison` allow-listed errors (never `is_transient_db_error`);
park order is log → idempotent emit → advance. Detail → this service's `docs/` folder (**`pnl-consumer.md`**).

### Decide-surface RPCs (feature 083, materialized by feature 097)

`ListOpportunities` (pure read of the materialized `analysis.opportunities` queue; the read DB phase runs
sequentially on one budgeted connection, ANALYSIS-14), `SetOpportunityAction`, `EvaluateReadiness`,
`GetStrategyAnalytics` and `GetWatchlistReadiness` → this service's `docs/` folder (**`opportunities.md`**).

### Cross-Stock Score Derivation (feature 065) & Pre-Window Warm-Up Prefix (feature 071)

Design-level detail — fingerprint eligibility, empirical-Bayes aggregation with worked calibration anchors, recompute triggers, warm-up prefix sizing, and the FR/OQ caveats — lives on-demand in this service's `docs/` folder (**`scoring.md`**, **`warmup.md`**). The **binding** invariants are **ANALYSIS-2** (evidence-weighted EB grade) and **ANALYSIS-3** (definition-fingerprint eligibility) in `docs/context-constitution.md`.

## Docker Build Pattern

Python pattern — see `docs/patterns/docker-build.md` for single-stage `uv` builds, `--frozen --no-dev` flags, and proto namespace package setup.

## Dependencies

| Dependency | Type | Reason |
|---|---|---|
| xstockstrat-config | gRPC WatchConfig | Live config at startup |
| xstockstrat-marketdata | gRPC read | Historical OHLCV data for backtesting |
| xstockstrat-indicators | gRPC read/write | SMA/EMA/indicator computation; formula reads as the strategy owner; strategy-template saga copies (`InstantiateTemplate`/`ResolveTemplateIntent`, feature 224) |
| xstockstrat-ingest | gRPC read/write | QuerySignals for signal-weighted backtesting; `IngestSignal`/`ManageSignalSource` for the fundamentals signal producer |
| xstockstrat-portfolio | gRPC read | Watchlist universe for the fundamentals signal producer; held positions for the `ListOpportunities` queue + `ScreenResult.held` cross-ref |
| xstockstrat-trading | gRPC read | `ListOrders(strategy_id)` for the `GetStrategyAnalytics` "taken" count (non-cyclic analysis→trading edge); `ListOrders(user_id, strategy_id, symbol)` + owner `x-user-id` (and a per-pass `x-trace-id`) boot-time-only for the exit-cooldown entry-time backfill (`app/engine/entry_backfill.py`) — same stub |
| xstockstrat-ledger | gRPC write | Store backtest lifecycle events |
| xstockstrat-notify | gRPC write | Alert on completed backtests |

## Backtesting Strategy

Default: **SMA crossover** (fast=20, slow=50)

- Buy when fast SMA crosses above slow SMA (golden cross) and combined conviction >= threshold
- Sell when fast SMA crosses below slow SMA (death cross)
- Position sizing: 95% of current equity per symbol

Signal-weighted mode (set via `strategy_params`):

- `signal_sources`: list of ingest source names (e.g. `["unusual_whales"]`)
- `signal_weight`: 0.0–1.0 (share of score from newsletter signals; rest from technicals)
- `technical_weight`: 0.0–1.0 (complement of signal_weight)
- `min_conviction`: 0.0–1.0 (minimum combined score to enter a position)

### Backtest Fill Model (feature 151)

`RunBacktestRequest.fill_model` (else `analysis.backtest.default_fill_model`, else legacy `SAME_BAR_CLOSE`);
`NEXT_BAR_OPEN` is the bias-free opt-in. Mechanics → this service's `docs/` folder (**`backtest-fill-model.md`**).

## Composable Strategy Rules — Operands & Output Series

`StrategyDefinition.entry_rule` / `exit_rule` are JSON condition trees evaluated by
`app/services/evaluator.py`:

```json
{ "op": "AND", "conditions": [ { "fn": "crosses_below", "lhs": "close_bb", "rhs": "bb.lower" } ] }
```

A leaf `lhs` is always a component reference; `rhs` is either a reference (string) or a
numeric threshold (JSON number). A reference resolves to one of a component's **output
series**:

- A **bare `ref_name`** resolves to the component's primary `value` series (back-compat).
- The **dotted form `<ref_name>.<series>`** selects a specific output series of a
  multi-output component — e.g. `bb.upper` / `bb.lower` (Bollinger Bands),
  `macd.signal` / `macd.histogram`, `stoch.d`.

Built-in indicator series are catalogued in `_INDICATOR_SERIES` (evaluator.py) and validated
at write time (an unknown series is rejected). Custom-formula series are validated against the
formula's **declared outputs** (`FormulaOutput`, owned by xstockstrat-indicators): at strategy
write time the servicer calls `GetFormula` for each formula component and passes the allowed
series (`{"value"}` ∪ declared output names) into `_validate_definition`. A formula that declares
no outputs exposes only the implicit `value` series — any other `<ref_name>.<series>` is rejected.
The runtime evaluate path skips this re-fetch (already validated at write time). The UI exposes
both indicator and declared-formula series as dropdown operands via
`services/xstockstrat-ui/src/lib/strategyCatalog.ts` (`operandRefs`).

### Benchmark / reference-symbol operand (`source_symbol`, feature 152)

`StrategyComponent.source_symbol` computes a component on another symbol's bars, date-joined onto the evaluated
symbol's timeline with no forward-fill → this service's `docs/` folder (**`warmup.md`**) § Benchmark / reference-symbol operand.

### Fundamentals-input formula operand (`fundamental_inputs`, feature 200)

A custom formula declaring `fundamental_inputs` is fed only those metrics and returns a scalar broadcast
(ANALYSIS-12). Routing, the two data channels, the shared gate and the write-time XOR →
this service's `docs/` folder (**`fundamentals-guard.md`**).

### Fundamentals availability guard (feature 215)

`app/services/fundamentals_guard.py#assess` judges strategies that require fundamentals: UNAVAILABLE refuses /
denies entry; UNKNOWN never refuses; DISABLED / NOT_ASSESSED change nothing. Per-surface behaviour →
this service's `docs/` folder (**`fundamentals-guard.md`**).

### Per-sector component-param overrides (`sector_param_overrides`, feature 217)

`StrategyDefinition.sector_param_overrides` overrides component params by the evaluated symbol's sector
(PIT on backtest, current sector live; fail-safe to `default_value`) →
this service's `docs/` folder (**`sector-overrides.md`**).

## Config Keys Consumed

Namespace: `analysis`. Keys are listed and read as namespace-relative (`backtest.max_duration_seconds`); logs and
errors may print the FQN `analysis.<key>`. The `marketdata` namespace's `fundamentals.provider` is read through a
second watcher.

| Key | Type | Default | Description |
|---|---|---|---|
| `backtest.max_duration_seconds` | int | `300` | Wall-clock bound on backtest evaluation up to result assembly; persistence and grade recompute are not bounded (total RPC time can exceed it). `0` = no limit, negative = 300 (WARN). Exceeded → `DEADLINE_EXCEEDED` `backtest exceeded Ns deadline`; executor threads are not interrupted — do not retry immediately. Read presence-aware at call time (per-user overrides apply). |
| `backtest.default_commission_pct` | float | `0.001` | Assumed commission per trade |
| `backtest.default_slippage_pct` | float | `0.0005` | Assumed slippage |
| `backtest.max_range_days` | int | `730` | Max backtest range span in days (≈2 years, feature 064); a request whose `range` exceeds it is rejected with `INVALID_ARGUMENT`, an unset bound is defaulted to the last `max_range_days`. Applies to all `RunBacktest` callers. |
| `backtest.portfolio_position_weight` | float | `0.10` | Fraction of **initial** capital committed per concurrent position in portfolio sizing mode (feature 150). Read via `float_positive`: a stored ≤ 0 reads as the default `0.10`. A fixed fraction of *initial* capital (not live equity) keeps aggregate metrics order-independent. |
| `backtest.portfolio_max_concurrent` | int | `9` | Max concurrently-held positions in portfolio sizing mode (feature 150). Read via `int_positive`: a stored ≤ 0 reads as the default `9`. At the `0.10` weight this leaves a ≥10% cash buffer. |
| `backtest.default_fill_model` | int | `0` | Default fill model when a `RunBacktest` request leaves `fill_model` unset (feature 151). `0` = `FILL_MODEL_UNSPECIFIED` → legacy `SAME_BAR_CLOSE`; `2` = `FILL_MODEL_NEXT_BAR_OPEN`. Read via `get_int`, unclamped: `0` = legacy, stored or absent (both resolve to `SAME_BAR_CLOSE`). A request-supplied `fill_model` always overrides this. |
| `backtest.fundamentals.enabled` | bool | `false` | Master kill-switch for the historical-fundamentals strategy operand (`COMPONENT_KIND_FUNDAMENTAL`, feature 198) **and** the fundamentals-input formula operand (`fundamental_inputs`, feature 200). Read via `get_bool` (HasField — an explicit operator value is honored) at **two** enforcement sites for one key: the per-symbol PIT-preload chokepoint (`_load_fundamentals`, feature 198) and the snapshot loader (`_load_fundamentals_snapshot`, feature 200) — both shared by the servicer + the live loop, so it gates **every** consumer uniformly: backtest, live loop, `EvaluateReadiness`, the readiness materializer, `ListOpportunities`, and `GetIndicatorSeries`. Default **OFF** ⇒ a fundamental operand (either kind) resolves to all-`None` (the leaf holds) on every surface. Turning it off is a true platform-wide disable — in-flight strategies with a fundamental operand immediately read hold. |
| `scoring.sharpe_weight` | float | `0.4` | Weight of Sharpe in overall score |
| `scoring.drawdown_weight` | float | `0.3` | Weight of max drawdown |
| `scoring.win_rate_weight` | float | `0.3` | Weight of win rate |
| `scoring.shrinkage_days` | int | `250` | Empirical-Bayes shrinkage pseudo-count `k` (in trading days) for the derived headline grade (feature 065); larger `k` → stronger pull toward the neutral 0.5 prior, so a strong grade needs more evidence. Formula is ANALYSIS-2 in `docs/context-constitution.md`. Read via `int_positive`: a stored ≤ 0 reads as the default 250. |
| `scoring.min_evidence_symbols` | int | `3` | Below this many distinct evidence symbols the derived grade is flagged `provisional`. |
| `scoring.min_evidence_days` | int | `500` | Below this many total evidence trading-days the derived grade is flagged `provisional`. |
| `scoring.signal_decay_half_life_hours` | float | `24.0` | Exponential half-life (hours) for age decay of a signal's contribution to the Opportunities queue's `signal_axis` (feature 022); `effective = conviction × source_weight × exp(−ln2/half_life × age_hours)`, age from `ExternalSignal.ingested_at`. **Registered as a config key with server-enforced bounds `[0, 8760]` (feature 161, migration 019 + config-service `SCALAR_BOUNDS_REGISTRY`)** — appears in config-ui with a bounds hint and is settable via `set_config`. Set to `0` to disable decay (min inclusive); the config service rejects a value outside `[0, 8760]` at `SetConfig` (negative values are no longer settable via `SetConfig`, though the reader still tolerates them defensively). |
| `scoring.composite_shrinkage_k` | float | `1.0` | Empirical-Bayes pseudo-count `k` for the per-opportunity `composite_score` fusion `(Σwᵢ·sᵢ + 0.5·k)/(Σwᵢ + k)` (feature 199). Deliberately **distinct** from `shrinkage_days` (feature-065 grade, `k` in trading-days): here `k` is dimensionless and equals one axis-weight, so a single maxed axis lands at `0.750` and a corroborated pair at `0.833` (usable `[0.167, 0.833]` band). A configured `0` is honoured (it disables shrinkage). Not seeded by a config-ui migration (code-default only, like the sibling `analysis.scoring.*` keys). |
| `scoring.composite_weight_readiness` | float | `1.0` | Fusion weight `wᵢ` for the readiness sub-score (identity map of `conviction`) in the `composite_score` blend (feature 199). A configured `0` is honoured: it disables the readiness axis (its weight is omitted, never a zero score). Code-default only (not config-ui-seeded). |
| `scoring.composite_weight_signal` | float | `1.0` | Fusion weight `wᵢ` for the directional-signal sub-score (`clamp(max_agree)·(1−clamp(max_conflict))`) in the `composite_score` blend (feature 199). A configured `0` is honoured: it disables the signal axis. Code-default only (not config-ui-seeded). |
| `scoring.symbol_score_decay` | float | `0.5` | Geometric rank-decay γ for the feature-200 symbol_score fold `Σ γ^i·(composite_score × strategy_weight)` (terms sorted DESC). **Read-clamped to `[0, 0.99]`** in `_compute_opportunities` and the heal re-fold — a configured γ≥1 stops the decay / inverts the `@AC-3` saturation ordering. A configured `0` is honoured (it collapses the fold to the top term). Code-default only (not config-ui-seeded), like the sibling `analysis.scoring.*` keys. |
| `scoring.strategy_weight_floor` | float | `0.5` | Affine grade-weight floor for `strategy_weight = floor + (1−floor)·clamp01(overall_score)` (feature 200); also the neutral weight for a provisional / absent / unattributed grade — never `0`, so an unproven strategy's opportunity still contributes a term (FR-4/`@AC-7`). A configured `0` is honoured. Code-default only (not config-ui-seeded). |
| `strategy.default_cooldown_days` | int | `31` | Per-strategy default re-entry cooldown in calendar days when `StrategyDefinition.cooldown_days` is unset (feature 069); `31` sits outside the IRS 30-day-each-side wash-sale window. Read via `int_positive`: a platform-wide stored ≤ 0 reads as the default `31` — a per-strategy explicit-`0` (no cooldown) is unaffected because it travels via proto explicit presence, not this config read. |
| `strategy.default_exit_cooldown_days` | int | `0` | Per-strategy default minimum holding period (calendar days) before `exit_rule` may fire a sell, when `StrategyDefinition.exit_cooldown_days` is unset (feature 116); mirrors `default_cooldown_days` but gates the exit transition. Default `0` (no minimum hold — no wash-sale-style rationale exists for a non-zero default here, unlike the 31-day re-entry default). |
| `strategy.max_concurrent_entry_backfill` | int | `4` | Semaphore bound on concurrent `ListOrders` calls during the boot-time entry-time backfill pass (feature 116, `app/engine/entry_backfill.py`) — mirrors `analysis.screener.max_concurrent_formula_evals`'s shape. |
| `engine.eval_interval_seconds` | int | `60` | Live evaluation polling cadence in seconds. Seeded by migration 041 (feature 295); 043 (feature 293) guards and backfills metadata; bounds [30,600]. |
| `engine.max_strategies_per_cycle` | int | `50` | Max (strategy × symbol) pairs evaluated per cycle. Seeded by migration 041 (feature 295); 043 (feature 293) guards and backfills metadata; bounds [1,1000]. |
| `engine.alert_throttle_seconds` | int | `300` | Min seconds between alerts per (strategy, symbol) pair |
| `engine.fundamentals_blend_strategy_id` | string | `fundamentals_macd_blend` | Strategy id the fundamentals-universe force-run rule governs (feature 168). When that strategy is live, it is evaluated/attributed over the fundamentals universe (signals from the `analysis.fundsignal.source_slug` source ∩ symbols with fundamentals data) minus its deny list, instead of its ordinary owner-scoped universe. **Feature 193 hoisted this restriction into the shared `resolve_universe` (`blend_id`/`fundamentals_universe` kwargs) so all three callers honor it uniformly — the live loop, the opportunity queue (`_compute_opportunities`), and the boot entry-backfill; `signal_eligible` is inert for the blend on every caller.** Read via `str_nonempty`: a stored empty string reads as the default. Seed migration `026_analysis_engine_blend_keys`. |
| `engine.fundamentals_blend_enabled` | bool | `true` | Kill-switch for the fundamentals-universe force-run (feature 168). Read via `get_bool` (HasField-based — an explicit operator `false` is honored), which disables the override entirely (the governed strategy then resolves its own universe like any other), independent of whether that strategy is live. Seed migration `026_analysis_engine_blend_keys`. |
| `screener.max_universe_size` | int | `100` | Max symbols a single `ScreenSymbols` scan may cover (feature 060); over-cap requests are truncated |
| `screener.max_duration_seconds` | int | `120` | Overall deadline for one screener scan |
| `screener.default_rank_limit` | int | `50` | Default number of ranked results returned when the request omits `rank_limit` |
| `screener.max_concurrent_formula_evals` | int | `4` | Max concurrent `ExecuteFormula` evaluations during a scan (semaphore-bounded so a scan can't starve the live loop) |
| `series.max_concurrent_components` | int | `4` | Process-lifetime singleton semaphore bounding cross-request concurrency of per-component `ComputeIndicator`/`ExecuteFormula` execution driven by `GetIndicatorSeries` (feature 125, FR-6), so a routinely-visited Symbol page can't starve the analysis live loop — mirrors `analysis.screener.max_concurrent_formula_evals`. Read once in `AnalysisServicer.__init__` via `int_positive`: a stored ≤ 0 reads as the default 4, so a non-positive value never reaches `asyncio.Semaphore`. |
| `fundsignal.enabled` | bool | `false` | Master gate for the fundamentals signal producer loop (feature 062) |
| `fundsignal.run_interval_hours` | int | `24` | Hours between scheduled producer cycles |
| `fundsignal.universe_source` | string | `watchlists` | Symbol universe source: `watchlists` \| `explicit` \| `both` (feature 154): `watchlists` = the real cross-user union of every user's watchlist symbols via portfolio `ListAllWatchlistSymbols`; `both` = that union ∪ `explicit_symbols`; `explicit` = the CSV only. A portfolio-enumeration outage degrades to empty (`watchlists`) / the CSV (`both`) without crashing the cycle. |
| `fundsignal.explicit_symbols` | string | `""` | Comma-separated symbols used when `universe_source` is `explicit`, or unioned in for `both` |
| `fundsignal.max_symbols_per_run` | int | `200` | Cap on symbols scanned per cycle — **applied only when FMP is the active fundamentals provider** (feature 154; the cap is purely an FMP daily-budget guard). Under FMP it uses a stateless rotating offset so no user's late-alphabet tickers are permanently starved; under a non-FMP provider the whole union is scored (full coverage across cycles via the existing deferred-resume). |
| `fundsignal.daily_call_budget` | int | `200` | Max cached `GetFundamentalsMulti` chunk calls per cycle; ≤ `marketdata.fmp.daily_request_cap` (250) |
| `fundsignal.source_slug` | string | `fundamentals` | Slug of the registered `derived` signal source the producer emits under |
| `fundsignal.scoring_formula_id` | string | `""` | Optional 063 scoring formula id; empty → built-in deterministic default score |
| `fundsignal.buy_quantile` | float | `0.80` | Cross-sectional score quantile ≥ → `buy` |
| `fundsignal.sell_quantile` | float | `0.20` | Cross-sectional score quantile ≤ → `sell` |
| `fundsignal.min_conviction_to_emit` | float | `0.0` | Drop symbols whose score is below this before emitting |
| `fundsignal.valid_days` | int | `90` | Emitted signal validity window (`valid_until` = run date + this) |
| `fundsignal.startup_jitter_seconds` | int | `30` | One-shot random delay [0, N] seconds applied once at producer loop entry to stagger concurrent redeploys (feature 156); a configured `0` is honoured (disables jitter). |
| `fundsignal.retry_seconds` | int | `300` | On a caught cycle error, `blocked_until_ms` advances by this many seconds (not a full `run_interval_hours`), so a transient failure retries in minutes (feature 156); read presence-aware. |
| `opportunity.max_universe_size` | int | `100` | Max candidates traced per opportunity compute (feature 097); watchlist/held rank **above the cut** so a curated symbol is never truncated — only the speculative signal tail is dropped (FR-1). Seeded by migration `028` (feature 184); bounds `[1,1000]`. |
| `opportunity.valid_window_hours` | int | `24` | `valid_until` = the compute's session date + this window (feature 097). Seeded by migration `028` (feature 184); bounds `[1,168]`. |
| `opportunity.snooze_default_hours` | int | `24` | Default bounded "snooze until" when a SNOOZE carries no explicit timestamp (feature 097). Seeded by migration `028` (feature 184); unbounded. |
| `opportunity.signal_rank_weight` | float | `0.3` | Weight `w ∈ [0,1]` of the independent signal axis in the queue ORDER BY (feature 097, OR-G); `rank = (1−w)·conviction + w·signal_axis`. This is a distinct scalar from the removed `analysis.signals.source_weights` key (superseded by feature 134, deleted by feature 161) — not a re-purpose. Seeded by migration `028` (feature 184); bounds `[0,1]`. |
| `opportunity.refresh_hour_utc` | int | `0` | Hour (UTC) of the **configured daily refresh** pass (feature 097) — a wall-clock refresh, **not** market close (holiday/DST/early-close drift is expected; a calendar-aligned refresh is a future feature). `0` = midnight is legitimate and is honoured. Also the wall-clock anchor for the DurableSchedule-backed opportunity refresh (feature 158). Seeded by migration `028` (feature 184); bounds `[0,23]`. |
| `opportunity.startup_jitter_seconds` | int | `30` | One-shot random delay `[0, N]` seconds applied once at the opportunity refresh loop entry to stagger concurrent redeploys (feature 158); a configured `0` is honoured (disables jitter). Mirrors `analysis.fundsignal.startup_jitter_seconds`. Seeded by migration `028` (feature 184); unbounded. |
| `opportunity.retry_seconds` | int | `300` | On a caught enumeration error the wall-clock `blocked_until_ms` advances by this many seconds (retry soon), not to the next wall-clock hour (feature 158); the getter honours a stored `0`, then `max(1, …)` at the read site floors it to 1 s. Mirrors `analysis.fundsignal.retry_seconds`. Seeded by migration `028` (feature 184); unbounded. |
| `opportunity.max_live_strategies_per_symbol` | int | `5` | Per-symbol cap (feature 131): how many live-enabled strategies may **newly** attribute to one symbol via live-coverage. Enforced only at the two candidate-**creation** sites (`_capped_live`); tagging an already-existing curated row (a watchlist-bound or held strategy that is also live) is uncapped. Tiebreak is `created_at` ascending. AC-7. Seeded by migration `028` (feature 184); bounds `[1,50]`. |
| `opportunity.max_live_only_symbols_per_compute` | int | `20` | Cap (feature 131) on distinct **non-held** signal+live-covered symbols that get a new candidate row per compute pass (design step 6). Ranked by max active-signal conviction descending. Composes **multiplicatively** with the per-symbol cap. AC-8. Seeded by migration `028` (feature 184); bounds `[1,500]`. |
| `opportunity.max_live_held_symbols_per_compute` | int | `20` | Cap (feature 131) on distinct **held** symbols that may receive a new live-only strategy attribution per compute pass (ranked by held market value descending); does **not** bound the held-row count itself — every held symbol still yields ≥1 row. AC-9. Seeded by migration `028` (feature 184); bounds `[1,500]`. |
| `opportunity.max_concurrent_bars_fetches` | int | `2` | Process-lifetime singleton semaphore (`_bars_fetch_sem`) bounding cross-request concurrency of the **interactive** read-path bars-fetch calls — the `EvaluateReadiness` SLOW path (`_enrich_opportunities_live` is one `BatchGetLatestPrice` under `asyncio.wait_for`, no sem) (feature 141, SEV-2 fix for TimescaleDB "out of shared memory" under multi-user load). **Feature 185 (FR-3):** the `_compute_opportunities` bars-fetch fan-out was moved OFF this sem onto the background `_readiness_materializer_bars_sem` so a heavy cold/daily recompute can no longer starve an interactive read; this key now governs only the interactive paths. Mirrors `analysis.series.max_concurrent_components`'s shape, but default `2` (not `4`) to match `xstockstrat-marketdata`'s own `DB_POOL_MAX` default so analysis never queues more concurrent bars-fetch attempts than marketdata can actually execute. Read once in `AnalysisServicer.__init__` via `int_positive` (a stored ≤ 0 reads as the default). Seeded by migration `028` (feature 184); bounds `[1,5]`. |
| `opportunity.max_concurrent_candidates` | int | `4` | Bounds the per-candidate `evaluate_conditions_traced` fan-out in `_compute_opportunities` Phase 2 (feature 176) — **separate** from `analysis.opportunity.max_concurrent_bars_fetches` so a large opportunity compute cannot starve interactive readiness (priority-inversion guard). Read once in `AnalysisServicer.__init__` via `int_positive` (a stored ≤ 0 reads as the default). Seeded by migration `028` (feature 184); bounds `[1,50]`. |
| `compute.max_worker_threads` | int | `4` | Size of the dedicated `ThreadPoolExecutor` that runs the pure-CPU backtest simulator cores + the screener sync tail off the event loop (feature 176, FR-4). Executor threads open **no** DB connection (F-06: the asyncpg pool stays 2). Read once in `AnalysisServicer.__init__` via `int_positive` (a stored ≤ 0 reads as the default). No seed migration. |
| `readiness.stale_after_seconds` | int | `30` | FR-1 readiness cache staleness window (feature 177). A configured `0` is honoured (`0` = always stale). Server-bounded `[0, 86399]` via config-service `SCALAR_BOUNDS_REGISTRY` — `< 86400` so a served-stale verdict never crosses a daily-bar boundary. |
| `opportunity.empty_recompute_ttl_seconds` | int | `30` | FR-3 empty-universe recompute suppression window (feature 177). The getter honours a stored `0`; the consumer floors it to 1 s with `max(1, …)`. Seeded by migration `028` (feature 184); unbounded. |
| `opportunity.live_enrich_ttl_seconds` | int | `20` | FR-4 short TTL for the success-only per-symbol live-quote memo (feature 177). A configured `0` is honoured (memo disabled → always fetch). Code default `20`; seeded `10` by migration `028` (feature 184); unbounded. |
| `opportunity.read_db_budget_ms` | int | `20000` | Feature 227 — request-scoped budget (ms) for the whole `ListOpportunities` read DB phase (pool acquire timeout + per-statement `SET LOCAL statement_timeout`). `value_type` must be `int` (a float reads as the default); `≤ 0` → default. Seeded by a config migration; SetConfig-bounded `[1000,20000]`. |
| `opportunity.live_enrich_timeout_ms` | int | `3000` | Feature 227 — deadline (ms) on the read-time `BatchGetLatestPrice` enrichment; on expiry the rows are served unenriched. `value_type` must be `int` (a float reads as the default); `≤ 0` → default. Seeded by a config migration; SetConfig-bounded `[500,4000]`. |
| `readiness_materializer.enabled` | bool | `false` | Master kill-switch for the readiness materializer background loop (feature 180). Read via `get_bool` (HasField — an explicit operator value is honored). Default OFF. Seeded at the code default (`false`) by migration `027_analysis_readiness_materializer_keys` (feature 182) so config-ui shows it and an admin can toggle it. |
| `readiness_materializer.refresh_hour_utc` | int | `0` | Wall-clock UTC hour for the daily readiness re-warm (feature 180). **Dedicated** anchor, decoupled from `analysis.opportunity.refresh_hour_utc` so the two daily loops tune independently (D-2). `0` = midnight is legitimate and is honoured. Seeded (`0`) by migration `027` (feature 182); SetConfig-bounded `[0,23]` via `configServiceImpl.ts` `SCALAR_BOUNDS_REGISTRY`. |
| `readiness_materializer.valid_window_hours` | int | `24` | Backstop TTL (hours) for a materialized row's `valid_until` (feature 180); the **authoritative** freshness bust is the `bar_epoch`-aware FAST gate (`is_readiness_row_fresh`), so this is only a floor. The getter honours a stored `0`; `readiness_valid_until` clamps to a 1h minimum. Seeded (`24`) by migration `027` (feature 182); SetConfig-bounded `[1,168]`. |
| `readiness_materializer.max_concurrent_bars_fetches` | int | `2` | The materializer loop's **own** bars-fetch semaphore (feature 180), **separate** from `analysis.opportunity.max_concurrent_bars_fetches` so a background pre-warm never starves interactive readiness (feature-176 priority-inversion guard). Read once in `__init__` via `int_positive` (a stored ≤ 0 reads as the default). Seeded (`2`) by migration `027` (feature 182); SetConfig-bounded `[1,5]` (ceiling = marketdata PgBouncer pool size, feature-141 SEV-2 guard) — `SetConfig` rejects `0`, and a stored ≤ 0 already in the table reads as the default `2`. **feature 181:** this sem **also** throttles the `GetWatchlistReadiness` on-read background refresh kick (R-F coupling) — the on-read kick deliberately shares it rather than the interactive `_bars_fetch_sem`. **feature 185 (FR-3):** the `_compute_opportunities` bars-fetch fan-out (primary + benchmark + the `_row_for` benchmark loader) *also* runs on this background sem, so a heavy cold/daily opportunity recompute cannot starve an interactive read; it reuses this key rather than minting a third `[1,5]` bars-fetch sem (3×`[1,5]`=15 would re-open the feature-141 SEV-2). |
| `snapshot.indicator_timeout_ms` | int | `500` | Feature 042 — max ms the P&L-pattern consumer waits for indicator values when composing an order snapshot; on timeout it stores a **partial** snapshot with an empty indicators map (FR-6), never aborting order-event capture. |
| `snapshot.signal_timeout_ms` | int | `500` | Feature 042 — max ms the consumer waits for active signals when composing a snapshot; on timeout the snapshot carries an empty signals list (FR-6). |
| `patterns.min_sample_count` | int | `5` | Feature 042 — minimum samples in a bucket before a factor appears in `QueryPnLPatterns` results (query-time drop). |
| `patterns.indicator_bucket_count` | int | `5` | Feature 042 — number of quantile buckets used to group indicator-value factors at `QueryPnLPatterns` time (data-dependent boundaries). |

> **Feature-131 fan-out worst case:** the two caps govern disjoint pools (live-only non-held symbols
> and live-attributed held symbols), so the compound ceiling on **newly-attributed** live rows is
> `max_live_strategies_per_symbol × (max_live_only_symbols_per_compute + max_live_held_symbols_per_compute)`
> = 200 at the defaults — no single key is *the* row ceiling.

## Ledger Events Emitted

| Event Type | Trigger |
|---|---|
| `analysis.backtest.started` | Backtest begins |
| `analysis.backtest.completed` | Backtest done |
| `analysis.strategy.scored` | `ScoreStrategy` RPC only (feature 065 — the RunBacktest/UPDATE recompute paths do **not** emit it) |
| `analysis.strategy.triggered` | Live loop detected an entry or exit transition |
| `analysis.strategy.live_toggled` | `SetStrategyLive` enabled/disabled live evaluation |
| `analysis.fundsignal.run_started` | Fundamentals signal producer cycle started |
| `analysis.fundsignal.run_completed` | Fundamentals signal producer cycle finished |
| `analysis.pnl.event_parked` | P&L-pattern consumer parked a ledger event (poison, or persistent non-poison with the DB probe up); ownerless, idempotent per sequence (`pnl_park:<seq>`) |

## Running Tests

```bash
uv run pytest --cov=app --cov-fail-under=40  # with coverage
uv run pytest -m real_pg   # only the real-PostgreSQL tests
```

`real_pg`-marked tests run against a throwaway PostgreSQL that the session-scoped `local_pg` fixture
(`tests/conftest.py`) starts and removes. Binaries are found via `XSTOCKSTRAT_PG_BIN` (test-only: the
PostgreSQL `bin` dir — not an inter-service connection var), else `pg_ctl` on `PATH`, else the newest
`/usr/lib/postgresql/*/bin` or Homebrew install (`brew install postgresql@16`). Without binaries they
skip locally and fail under `CI=true`.

## Observability (feature 294-signal-map-instrumentation)

- INFO `loop tick ok` carries `loop`, `duration_ms` and optional `state` (no `state` = work was done); a tick writes no record when every item that reached its fallible call failed. Written by `fundsignal` (24 h), `opportunity_refresh` (24 h), `readiness_materializer` (24 h), `template_intent_sweep` (300 s) and `pnl_consumer` (event-driven, throttled to one per 60 s); states `idle`, `disabled`. A not-due or lock-held tick writes nothing. `live_loop` keeps `live_loop: cycle complete` and writes no `loop tick ok`.
- Instruments: `analysis.live_loop.pairs{outcome ok|no_bars|error}`, `analysis.live_loop.drain_failures{source signals|held|watchlist}`, `analysis.live_loop.triggers{trigger entry|exit, outcome throttled|alerted|alert_failed}`, `analysis.live_loop.cycle.duration`, `analysis.fundsignal.signals{outcome emitted|failed}`, `analysis.opportunity.recompute{kind full|retry, outcome ok|failed}`, `template.instantiate{service, outcome}`.
- Load-bearing log: INFO `fundsignal run summary`.
- Tracing: `init_telemetry` installs `GrpcAioInstrumentorServer` (extracts inbound W3C `traceparent`) and `GrpcAioInstrumentorClient` (injects it on outbound calls), so UI → analysis → marketdata/indicators/… is one trace; the client patch covers only `grpc.aio` channels created after `init_telemetry()` runs.

## Environment Variables

> mTLS: requires `MTLS_CERT`/`MTLS_KEY`/`MTLS_CA_CERT` (fail-closed) — see root `CLAUDE.md` § Environment Variable Naming Convention.

```text
# GRPC_PORT and the plain *_ENDPOINT values (config, marketdata, indicators, ingest, ledger, notify): docker-compose.yml
PORTFOLIO_ENDPOINT=xstockstrat-portfolio:50052   # feature 062 — fundamentals signal producer watchlist universe; feature 083 — ListOpportunities held positions
TRADING_ENDPOINT=xstockstrat-trading:50051       # feature 083 — GetStrategyAnalytics ListOrders "taken" count
APPLICATION_ENV=development         # development | production
TRADING_MODE=paper                     # paper | live
```
