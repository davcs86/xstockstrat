# xstockstrat-analysis — CLAUDE.md

<!-- context-forge:constitution-pointer:start -->
> **Constitution:** non-obvious local invariants (tail-align indicator results, empirical-Bayes evidence-weighted scoring, definition-json fingerprint eligibility, custom-formula `len==n` requirement) live in [`docs/context-constitution.md`](docs/context-constitution.md); defects (`client_id="indicators-"` copy-paste, ⚠ self-granted admin scope) in [`docs/context-constitution-findings.md`](docs/context-constitution-findings.md). Inherits the root [`PLAT-*` constitution](../../docs/context-constitution.md).
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
filter to the caller's own rows. (The `strategy_scores` cache stays keyed by bare `strategy_id` — a
derived cache cross-checked for ownership at the RPC layer, feature 133 D-2.) The live loop keys its
per-`(user_id, strategy_id, symbol)` state on the owner; the owner-scoped firing **universe** union is
deferred to feature 132's `resolve_universe` (this feature is identity-only).

### Strategy Score Persistence (feature 064)

> **Feature 065 update**: the headline `StrategyScore` is now **derived** from per-symbol evidence
> cells rather than the latest run (see **Cross-Stock Score Derivation** below). The write-through +
> hydrate-at-boot mechanics described here are unchanged; `strategy_scores` stays a materialized cache
> (now with `n_symbols`/`total_trading_days`/`provisional` provenance columns and a `delete` for
> clearing a stale grade). `ScoreStrategy` is repurposed as the manual recompute-from-cells refresh.

`ScoreStrategy` persists the latest `StrategyScore` per strategy to the `analysis.strategy_scores`
table (migration `005`, upsert on the `strategy_id` primary key) in addition to the in-memory
`self._strategies` dict. The write is **best-effort** (FR-7): it mirrors the ledger-emit `try/except →
log.warning`, so a DB failure never fails scoring. Reads stay in-memory — `ListStrategies` /
`GetStrategyReport` still serve `self._strategies`; at boot `main.py` calls `servicer.hydrate_scores()`
(best-effort) to load persisted rows back into memory, so scores **survive a service restart**. Reuses
the existing asyncpg pool — no new pool (budget stays 2).

A `math.isfinite` guard drops non-finite component values before the JSONB write. The `strategy_scores`
table has no retention or pagination yet (deactivated and ad-hoc-`strategy_id` scores persist and hydrate).

### Backtest Auto-Scoring & Run History

Each OK `RunBacktest` computes a **per-run** `StrategyScore` (via the shared `_score_from_metrics` /
`_grade` helpers that `_score_from_result` delegates to) and stores it only on the run-history row
(`backtest_runs.overall_score`/`rating`). **As of feature 065 the run's own aggregate is no longer the
headline grade** — the per-strategy headline is *derived* from the strategy's whole evidence base (see
**Cross-Stock Score Derivation** below), so a throwaway single-symbol run can never overwrite a
well-evidenced grade. The prior per-run headline upsert was removed.

Every completed run (OK **and** INSUFFICIENT_DATA) is also appended to `analysis.backtest_runs`
(migration `006`, `BacktestRunsRepository`) — a lightweight, durable **run history** of summary metrics
plus the score the run earned (INSUFFICIENT runs record history with a 0 score / empty rating). The
`ListBacktests(strategy_id, limit)` RPC reads the latest rows back (newest first; `limit` 0 → server
default of 20) as typed `BacktestRunSummary`s, so past run results survive a restart and are visible in
the UI's "Past Runs" table. Full trades/diagnostics are **not** copied into history — those remain on the
in-memory `latest_backtest`; the history table stays a compact summary. All persistence is best-effort
(`try/except → log.warning`) so a DB failure never fails a run. Reuses the existing asyncpg pool
(no new pool — budget stays 2).

### Fundamentals Signal Producer (feature 062)

A second asyncio background loop (`app/engine/fundsignal_loop.py`) runs a daily **fundamentals signal producer**. Each cycle it builds a deduplicated symbol universe, reads cached fundamentals **only** via marketdata `GetFundamentalsMulti` (never FMP directly — the single FMP chokepoint lives in marketdata, feature 059), scores each symbol (built-in deterministic default, or a 063 scoring formula when `analysis.fundsignal.scoring_formula_id` is set), maps the score to a `buy`/`sell`/`hold` direction by cross-sectional quantile, and emits an `ExternalSignal` per surviving symbol through ingest `IngestSignal`.

- **Universe (feature 154)**: `_resolve_universe` resolves `analysis.fundsignal.universe_source` — `watchlists` = the cross-user union of user watchlist symbols via portfolio `ListAllWatchlistSymbols` (gated by the `x-internal-caller` allow-list, grant `analysis-fundsignal`), `both` = that union ∪ the `explicit_symbols` CSV, `explicit` = the CSV only. The feature-062 "falls back to explicit" behavior is gone. The `max_symbols_per_run` truncation is **FMP-gated**: it applies only when `marketdata.fundamentals.provider == "fmp"` (an FMP-budget guard), read **boot-frozen** via a **second `ConfigWatcher(namespace="marketdata")`** the loop is constructed with (`main.py` `md_config_watcher`) — WatchConfig is per-namespace, so a cross-namespace read needs its own subscription (mirrors marketdata's own boot-freeze; see `docs/patterns/config-governance.md`). Under FMP the cut uses a stateless rotating offset (no permanent per-user starvation); a non-FMP or unknown provider takes the whole union (unknown → conservative capped path). New dependency: **analysis → portfolio read** (`ListAllWatchlistSymbols`, reuses the existing `PORTFOLIO_ENDPOINT` stub — no new channel/env var).
- **Cache-only FMP discipline**: the producer imports no FMP client; all fundamentals come through marketdata's 24h cache. Chunked fetches are bounded by `analysis.fundsignal.daily_call_budget`; when the budget is exhausted the run is marked `budget_deferred`, a notify warning is emitted, and remaining symbols resume on the next cycle.
- **Idempotency**: ingest's `IngestSignal` does **not** dedup, so analysis owns the guard in `analysis.fundsignal_emitted` (PK `(symbol, source, as_of_date)`). A same-day re-run emits nothing new and spends zero cache calls; `force=true` re-emits by clearing the day's rows first.
- **Run state**: `analysis.fundsignal_runs` tracks per-cycle status and budget accounting.
- **Source registration**: the producer idempotently registers its source via ingest `ManageSignalSource` as `source_type='derived'` (a generic bucket for internally-produced, non-extraction signals — added by ingest migration `006_signal_source_type_derived`), `extractor_module='app.extractors.noop'`. This call is admin-scoped; the background path injects the admin bit, the RPC path forwards the caller's scope.
- **Manual trigger**: the admin-scoped `RunFundamentalsScan` RPC invokes the same `run_once` code path (`force`, `dry_run`, explicit `symbols` override) so the scheduled loop and manual trigger never diverge.

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

### P&L pattern consumer (feature 042)

A third background task (`app/engine/pnl_pattern_consumer.py`, `PnLPatternConsumer.run_forever`,
registered in `app/main.py`) drives order-snapshot capture and realized-P&L attribution off the
ledger. It opens **one broad** `StreamEvents(from_sequence=cursor)` with **both filters null** so the
ledger's **global** sequence order is preserved across stream keys (matching the fixed
`LedgerEvent.sequence` contract). Per event, strictly in order: (1) short-circuit any
`sequence <= cursor` before any mutation (kills replay phantom-opens); (2) never self-consume
`analysis.*` emissions; (3) on `order.*` events (`order.created`/`filled`/`partially_filled`/
`canceled` — note trading's American one-`l` `order.canceled`) compose the snapshot **before** the DB
txn — best-effort gRPC reads to marketdata/indicators/ingest bounded by
`analysis.snapshot.indicator_timeout_ms` / `signal_timeout_ms`; a timeout degrades to a **partial**
snapshot (empty map/list), never an abort (FR-6); (4) in ONE txn, insert the snapshot, open/seal the
`pnl_positions` window, and advance `ledger_stream_cursor` (atomic — a crash never advances past
unwritten data); on `portfolio.position.closed`, seal the matching open window from the enriched
payload's `realized_pnl` and write one `pnl_pattern_samples` row per factor; (5) after commit, emit
best-effort `analysis.snapshot.captured` / `.degraded` / `analysis.pattern.sealed` audit events.
`QueryPnLPatterns` reads `pnl_pattern_samples` and buckets **at query time** (indicator quantile
buckets + signal-by-presence, `min_sample_count` drop, ranked positive/negative). Reuses the shared
pool + existing gRPC stubs (**no new pool, no new edge, no new env var** — F-06).

- **Migration-016 tables**: `order_snapshots` (Timescale hypertable on `event_ts`, dedup on
  `(event_id, event_ts)`), `pnl_positions` (synthesized open→close window, one open per identity key),
  `pnl_pattern_samples` (raw factor store — **no factor UNIQUE**, buckets computed at query time),
  `ledger_stream_cursor` (per-consumer committed global sequence).
- **Snapshot retention is v1-absent and MUST be position-lifecycle-keyed** when added — drop snapshots
  only **after** their position seals, never a time-based Timescale retention policy (a time policy
  would evict an entry snapshot before its position closes and silently corrupt attribution).
- **Named v1 limitations**: the snapshot indicator set is the default `RSI`/`ATR` (strategy-component
  resolution is the v2 refinement); `position_id` is synthesized from the identity key (`Order` has no
  `position_id`), so multiple open→close cycles for one identity share a `position_id` — the v2
  reconciliation (rebuild an incomplete window from the ledger via `QueryEvents`) is the tracked
  follow-up in the feature's `context.md`.

New dependency edges: **analysis → ingest write** (`IngestSignal` / `ManageSignalSource`, gRPC not DB) and **analysis → portfolio read** (watchlist universe; requires `PORTFOLIO_ENDPOINT`). The loop reuses the existing asyncpg pool (no new pool — budget stays 2).

### Decide-surface RPCs (feature 083, materialized by feature 097)

Three read RPCs back the opportunities-first UI, all over the existing evaluator (`app/services/evaluator.py`) — no new pool:

- **`ListOpportunities`** — a **pure read** of the materialized per-user queue (`analysis.opportunities`, migration `011`) LEFT JOIN the persisted dispositions (`analysis.opportunity_actions`, migration `010`). The Universe = `active signals (QuerySignals) ∪ held positions (ListPositions) ∪ watchlist (symbol, strategy) bindings (ListWatchlists)` — held positions and watchlisted symbols now **add rows**, not merely flip a signal row's action. Each row carries **real `passing/total`** wherever a strategy is attributed: entry-rule trace for entry candidates, **exit-rule trace** (`evaluate_conditions_traced(..., rule="exit")`) for held+attributed candidates → a held position whose `exit_rule` fires is a `REDUCE` row **with no sell signal** (FR-8). Attribution is **watchlist-binding-first, else unattributed** (`strategy_id=""`, no trace, `0/0`) — held positions carry no portfolio strategy, so none is fabricated (P-03). `conviction` is the deterministic readiness ordinal; a signal is a **separate ranking axis** (`signal_axis`), counted exactly once and never folded into readiness (Option 2 / FR-3). The key `user|symbol_norm|strategy_id` (action is a stored annotation, not in the key) is server-authoritative; the client echoes it to `SetOpportunityAction`. Freshness is **lazy compute-on-read + stale-while-revalidate + a configured daily refresh** (`run_opportunity_refresh_forever`, `analysis.opportunity.refresh_hour_utc`): a cold (never-materialized) read computes synchronously under a per-user lock; a stale read serves the old rows and kicks a background recompute (surface `computed_at` as "as of"). The known-user set the daily pass iterates is `opportunities ∪ opportunity_actions` (analysis can't enumerate all users — strategies are global). `max_universe_size` bounds the traced set with watchlist/held ranked **above the cut** (FR-1). **Feature 132 (deny list + owner universe):** a live strategy's coverage is now `resolve_universe(definition, watchlist, held, signals).union` — a non-empty `signal_params.symbols` allowlist is an explicit **override**, else `watchlist ∪ held ∪ (signals iff signal_eligible)`, all **minus** the strategy's `denied_symbols` (entry-only: a held-denied position keeps its exit trace). A denied `(symbol, strategy)` pair within that coverage surfaces as an explicit **muted** row — `Opportunity.muted`, carried by the `"denied"` provenance marker (no `muted` column; survives the DB round-trip) — held-denied flags its existing exit row, non-held-denied is a `0/0` `UNSPECIFIED` placeholder, **never `conviction=0` as a classifier**. The cut is three disjoint buckets (`curated`/`muted_only`/`speculative`) so a muted row is never truncated for a higher-conviction signal, and the read query exempts muted rows from the conviction floor (`OR provenance ? 'denied'`). The three new proto fields (`denied_symbols`, `signal_eligible`, `Opportunity.muted`) all ride existing JSONB/rows — **no migration**. `signal_eligible` defaults **false**; setting it true alongside a non-empty allowlist is rejected `INVALID_ARGUMENT` at write time. The live loop (`live_loop.py`) evaluates the same `resolve_universe` universe under a **fair-share rotating scheduler** (all `(strategy, symbol)` pairs globally ordered by `created_at`, ≤ `max_strategies_per_cycle` per cycle) and fetches each owner's watchlist/held from portfolio (read-only) memoized per cycle.
- **`SetOpportunityAction`** — persist a per-user disposition (SNOOZE/DISMISS/TAKE) against the server-issued `opportunity_key`. SNOOZE without an explicit `snooze_until` defaults to `now + analysis.opportunity.snooze_default_hours`. User-visible write → a DB failure surfaces as `UNAVAILABLE` (not swallowed).
- **`EvaluateReadiness`** — per-symbol traced condition leaves (`ConditionState` PASS/SOFT/FAIL) + a deterministic conviction ordinal (passing/total leaves, never a probability) for an explicit `strategy_id` — the Signal-detail readiness panel.
- **`GetStrategyAnalytics`** — per-strategy expectancy / hit-rate / max-DD / signals / taken. The "taken" count uses `ListOrders(strategy_id)` over the non-cyclic **analysis → trading read** edge (`TRADING_ENDPOINT`), **reconciled** against queue-derived TAKE dispositions so both read consistently (FR-7). `queue_share` is now **real** (feature 097): the strategy's share of the user's valid materialized queue (attributed rows for this strategy / all attributed rows, zero-guarded; unattributed rows excluded from the denominator).

### Cross-Stock Score Derivation (feature 065) & Pre-Window Warm-Up Prefix (feature 071)

Design-level detail — fingerprint eligibility, empirical-Bayes aggregation with worked calibration anchors, recompute triggers, warm-up prefix sizing, and the FR/OQ caveats — lives on-demand in this service's `docs/` folder (**`scoring.md`**, **`warmup.md`**). The **binding** invariants are **ANALYSIS-2** (evidence-weighted EB grade) and **ANALYSIS-3** (definition-fingerprint eligibility) in `docs/context-constitution.md`.

## Docker Build Pattern

Python pattern — see `docs/patterns/docker-build.md` for single-stage `uv` builds, `--frozen --no-dev` flags, and proto namespace package setup.

## Ports

| Protocol | Port | Purpose |
|---|---|---|
| gRPC | `50056` | Internal service-to-service (protobuf) |

This service is **gRPC-only** (`app/main.py` runs a single `grpc.aio` server). The MCP agent
triggers backtests via the `RunBacktest` gRPC RPC.

## Dependencies

| Dependency | Type | Reason |
|---|---|---|
| xstockstrat-config | gRPC WatchConfig | Live config at startup |
| xstockstrat-marketdata | gRPC read | Historical OHLCV data for backtesting |
| xstockstrat-indicators | gRPC read | SMA/EMA/indicator computation |
| xstockstrat-ingest | gRPC read/write | QuerySignals for signal-weighted backtesting; `IngestSignal`/`ManageSignalSource` for the fundamentals signal producer (feature 062) |
| xstockstrat-portfolio | gRPC read | Watchlist universe for the fundamentals signal producer (feature 062); held positions for the `ListOpportunities` queue + `ScreenResult.held` cross-ref (feature 083) |
| xstockstrat-trading | gRPC read | `ListOrders(strategy_id)` for the `GetStrategyAnalytics` "taken" count (feature 083 — new non-cyclic analysis→trading edge; `TRADING_ENDPOINT`); `ListOrders(strategy_id, symbol)` boot-time-only for the exit-cooldown entry-time backfill (feature 116, `app/engine/entry_backfill.py`) — reuses the same edge/stub, no new channel |
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

`RunBacktest` supports two fill models, selected by `RunBacktestRequest.fill_model` (else the
`analysis.backtest.default_fill_model` config key, else legacy):

- **`FILL_MODEL_SAME_BAR_CLOSE`** (legacy default) — a signal on bar `i` fills at bar `i`'s own
  close ± slippage. Optimistically biased (a mild look-ahead: the close that produced the signal is
  also the fill price).
- **`FILL_MODEL_NEXT_BAR_OPEN`** (opt-in, bias-free) — a signal on bar `i` fills at bar `(i+1)`'s
  open ± slippage. The standard bias-free convention.

Mechanics (both simulators share one deferred-execution state machine, `_apply_fill` over a
`SimState`; the loop stays the sole writer of `diags[...].action` and the sole appender to
`daily_equity`, so the feature-071 `daily_equity[j]↔diags[j]` 1:1 invariant is preserved):

- **Last-bar rule (no look-ahead):** a signal on the absolute last bar `n-1` schedules a fill for
  bar `n`, which never runs — so it opens no position and references no bar outside the window. A
  signal on `n-2` fills at `bars[n-1].open` then is force-closed at `bars[n-1].close` (one round
  trip), so trade counts stay symmetric across modes.
- **Cooldown is fill-to-fill:** the re-entry (feature 069) and exit/min-hold (feature 116) cooldowns
  are keyed on the **fill-bar** time. Byte-identical to legacy in same-bar mode (`signal == fill`).
- **Action/conviction decouple (display-only):** in next-bar mode a diagnostics row can show
  ENTER/EXIT on bar `i+1` while that row's `conviction` is bar `i+1`'s own value (the action reflects
  bar `i`'s signal). This is display-only — the derived grade math reads only
  sharpe/drawdown/win-rate, never conviction, so the grade is unaffected.

The effective model is recorded on `BacktestResult.fill_model`, `BacktestRunSummary.fill_model`, and
the `analysis.backtest_runs.fill_model` column (enum name), so a run is reproducible despite config
drift.

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

A `StrategyComponent` carries an optional **`source_symbol`** (`analysis.proto` field 6). When
non-empty, the component's indicator/formula is computed on **that** symbol's bars (e.g. `VOO`) and
its output series is **left-joined onto the evaluated symbol's trading-day (date) timeline**; empty =
computed on the evaluated symbol (byte-identical to pre-152, and — being a plain proto3 string — an
unset value is omitted from `definition_json` so the definition fingerprint is unchanged). This
enables cross-symbol "market-regime" gates (buy dips on any symbol only when `VOO`'s 200-day is
rising) that per-symbol operands cannot express.

- **One computation unit.** `StrategyEvaluator._assemble_component_series(comp, closes, eval_dates,
  benchmark_bars)` is the single seam behind every StrategyComponent consumer — backtest
  (`evaluate_with_series`), live (`evaluate`), readiness/opportunities (`evaluate_conditions_traced`),
  and `GetIndicatorSeries`. A `source_symbol` component with no benchmark bars supplied → all-`None`
  (safe hold), **never** computed on the evaluated closes.
- **Compute-then-align, no look-ahead.** The indicator/formula runs on the benchmark's own contiguous
  closes first, *then* the output is date-joined (`bar.time.ToDatetime(UTC).date()`); a date the
  benchmark lacks → `None` (leaf reads hold/false) — no forward-fill, the evaluated symbol is never
  reindexed, and a benchmark value at bar *t* uses only benchmark data ≤ *t*.
- **Warmup / coverage.** Benchmark bars are loaded window+warmup like the evaluated symbol
  (`_load_benchmark_bars`, deduped once per backtest run); a benchmark warmup shortfall raises
  `_InsufficientData(source_symbol)` → a `CoverageGap` naming the **benchmark**, and the run reports
  `BACKTEST_STATUS_INSUFFICIENT_DATA`. The **live loop** wires this too
  (`live_loop._load_benchmark_bars`, builtin lookback + declared formula `warmup_period` via
  `StrategyEvaluator.declared_formula_warmups`); the opportunities pass dedups each benchmark to one
  fetch under `_bars_fetch_sem`.
- **Write path.** `ManageStrategy` normalizes `source_symbol` server-side (uppercase/trim, empty →
  unset) on both REGISTER and UPDATE (`_normalize_source_symbols`); it enters the fingerprint via
  `definition_json`, so changing a benchmark clears the derived grade.
- **Deferred:** `screen_symbols` `source_symbol` and a UI strategy-builder editor for it are follow-ons
  (agent-authored strategies are fully functional now via `manage_strategy`).

## Config Keys Consumed

Namespace: `analysis`

| Key | Type | Default | Description |
|---|---|---|---|
| `analysis.backtest.max_duration_seconds` | int | `300` | Max backtest run time |
| `analysis.backtest.default_commission_pct` | float | `0.001` | Assumed commission per trade |
| `analysis.backtest.default_slippage_pct` | float | `0.0005` | Assumed slippage |
| `analysis.backtest.max_range_days` | int | `730` | Max backtest range span in days (≈2 years, feature 064); a request whose `range` exceeds it is rejected with `INVALID_ARGUMENT`, an unset bound is defaulted to the last `max_range_days`. Applies to all `RunBacktest` callers. |
| `analysis.backtest.portfolio_position_weight` | float | `0.10` | Fraction of **initial** capital committed per concurrent position in portfolio sizing mode (feature 150). Read via `get_float` (zero-trap intended: a configured `0` disables the portfolio → falls back to `0.10`). A fixed fraction of *initial* capital (not live equity) keeps aggregate metrics order-independent. |
| `analysis.backtest.portfolio_max_concurrent` | int | `9` | Max concurrently-held positions in portfolio sizing mode (feature 150). Read via `get_int` with a `max(1, …)` clamp (zero-trap intended: a configured `0` reads back as the default `9`; the clamp guards a negative). At the `0.10` weight this leaves a ≥10% cash buffer. |
| `analysis.backtest.default_fill_model` | int | `0` | Default fill model when a `RunBacktest` request leaves `fill_model` unset (feature 151). `0` = `FILL_MODEL_UNSPECIFIED` → legacy `SAME_BAR_CLOSE`; `2` = `FILL_MODEL_NEXT_BAR_OPEN`. Read via `get_int` — the zero-trap is **intentional** here: both an absent key and a configured `0` mean legacy, so a future reader must NOT "fix" it to `get_int_present`. A request-supplied `fill_model` always overrides this. |
| `analysis.scoring.sharpe_weight` | float | `0.4` | Weight of Sharpe in overall score |
| `analysis.scoring.drawdown_weight` | float | `0.3` | Weight of max drawdown |
| `analysis.scoring.win_rate_weight` | float | `0.3` | Weight of win rate |
| `analysis.scoring.shrinkage_days` | int | `250` | Empirical-Bayes shrinkage pseudo-count `k` (in trading days) for the derived headline grade (feature 065); larger `k` → stronger pull toward the neutral 0.5 prior, so a strong grade needs more evidence. Formula is ANALYSIS-2 in `docs/context-constitution.md`. `get_int` zero-trap: a config value of `0` reads as the default 250. |
| `analysis.scoring.min_evidence_symbols` | int | `3` | Below this many distinct evidence symbols the derived grade is flagged `provisional`. |
| `analysis.scoring.min_evidence_days` | int | `500` | Below this many total evidence trading-days the derived grade is flagged `provisional`. |
| `analysis.scoring.signal_decay_half_life_hours` | float | `24.0` | Exponential half-life (hours) for age decay of a signal's contribution to the Opportunities queue's `signal_axis` (feature 022); `effective = conviction × source_weight × exp(−ln2/half_life × age_hours)`, age from `ExternalSignal.ingested_at`. **Registered as a config key with server-enforced bounds `[0, 8760]` (feature 161, migration 019 + config-service `SCALAR_BOUNDS_REGISTRY`)** — appears in config-ui with a bounds hint and is settable via `set_config`. Set to `0` to disable decay (min inclusive); the config service rejects a value outside `[0, 8760]` at `SetConfig` (negative values are no longer settable via `SetConfig`, though the reader still tolerates them defensively). Read via `get_float_present` (never `get_float` — a configured `0` is legitimate and the `get_float` zero-trap would swallow it). |
| `analysis.strategy.default_cooldown_days` | int | `31` | Per-strategy default re-entry cooldown in calendar days when `StrategyDefinition.cooldown_days` is unset (feature 069); `31` sits outside the IRS 30-day-each-side wash-sale window. `get_int` zero-trap: a platform-wide value of `0` reads back as the default `31` — a per-strategy explicit-`0` (no cooldown) is unaffected because it travels via proto explicit presence, not this config read. |
| `analysis.strategy.default_exit_cooldown_days` | int | `0` | Per-strategy default minimum holding period (calendar days) before `exit_rule` may fire a sell, when `StrategyDefinition.exit_cooldown_days` is unset (feature 116); mirrors `default_cooldown_days` but gates the exit transition. Default `0` (no minimum hold — no wash-sale-style rationale exists for a non-zero default here, unlike the 31-day re-entry default). Read via `get_int_present` (**not** `get_int`) — a configured `0` is a legitimate value and `get_int`'s zero-trap would silently collapse it. |
| `analysis.strategy.max_concurrent_entry_backfill` | int | `4` | Semaphore bound on concurrent `ListOrders` calls during the boot-time entry-time backfill pass (feature 116, `app/engine/entry_backfill.py`) — mirrors `analysis.screener.max_concurrent_formula_evals`'s shape. |
| `analysis.engine.eval_interval_seconds` | int | `60` | Live evaluation polling cadence in seconds |
| `analysis.engine.max_strategies_per_cycle` | int | `50` | Max (strategy × symbol) pairs evaluated per cycle |
| `analysis.engine.alert_throttle_seconds` | int | `300` | Min seconds between alerts per (strategy, symbol) pair |
| `analysis.engine.fundamentals_blend_strategy_id` | string | `fundamentals_macd_blend` | Strategy id the fundamentals-universe force-run rule governs (feature 168). When that strategy is live, the live loop evaluates it over the fundamentals universe (signals from the `analysis.fundsignal.source_slug` source ∩ symbols with fundamentals data) minus its deny list, instead of its ordinary owner-scoped universe. Read via `get_str` (empty ⇒ code default). Seed migration `024_analysis_engine_blend_keys`. |
| `analysis.engine.fundamentals_blend_enabled` | bool | `true` | Kill-switch for the fundamentals-universe force-run (feature 168). Read via `get_bool` (HasField-based — an explicit operator `false` is honored), which disables the override entirely (the governed strategy then resolves its own universe like any other), independent of whether that strategy is live. Seed migration `024_analysis_engine_blend_keys`. |
| `analysis.screener.max_universe_size` | int | `100` | Max symbols a single `ScreenSymbols` scan may cover (feature 060); over-cap requests are truncated |
| `analysis.screener.max_duration_seconds` | int | `120` | Overall deadline for one screener scan |
| `analysis.screener.default_rank_limit` | int | `50` | Default number of ranked results returned when the request omits `rank_limit` |
| `analysis.screener.max_concurrent_formula_evals` | int | `4` | Max concurrent `ExecuteFormula` evaluations during a scan (semaphore-bounded so a scan can't starve the live loop) |
| `analysis.series.max_concurrent_components` | int | `4` | Process-lifetime singleton semaphore bounding cross-request concurrency of per-component `ComputeIndicator`/`ExecuteFormula` execution driven by `GetIndicatorSeries` (feature 125, FR-6), so a routinely-visited Symbol page can't starve the analysis live loop — mirrors `analysis.screener.max_concurrent_formula_evals`. Read once in `AnalysisServicer.__init__` via `get_int` with a `max(1, …)` clamp (a `0` reads as the default 4 via `get_int`'s zero-trap; the clamp guards a negative value from reaching `asyncio.Semaphore`). |
| `analysis.fundsignal.enabled` | bool | `false` | Master gate for the fundamentals signal producer loop (feature 062) |
| `analysis.fundsignal.run_interval_hours` | int | `24` | Hours between scheduled producer cycles |
| `analysis.fundsignal.universe_source` | string | `watchlists` | Symbol universe source: `watchlists` \| `explicit` \| `both` (feature 154): `watchlists` = the real cross-user union of every user's watchlist symbols via portfolio `ListAllWatchlistSymbols`; `both` = that union ∪ `explicit_symbols`; `explicit` = the CSV only. A portfolio-enumeration outage degrades to empty (`watchlists`) / the CSV (`both`) without crashing the cycle. |
| `analysis.fundsignal.explicit_symbols` | string | `""` | Comma-separated symbols used when `universe_source` is `explicit`, or unioned in for `both` |
| `analysis.fundsignal.max_symbols_per_run` | int | `200` | Cap on symbols scanned per cycle — **applied only when FMP is the active fundamentals provider** (feature 154; the cap is purely an FMP daily-budget guard). Under FMP it uses a stateless rotating offset so no user's late-alphabet tickers are permanently starved; under a non-FMP provider the whole union is scored (full coverage across cycles via the existing deferred-resume). |
| `analysis.fundsignal.daily_call_budget` | int | `200` | Max cached `GetFundamentalsMulti` chunk calls per cycle; ≤ `marketdata.fmp.daily_request_cap` (250) |
| `analysis.fundsignal.source_slug` | string | `fundamentals` | Slug of the registered `derived` signal source the producer emits under |
| `analysis.fundsignal.scoring_formula_id` | string | `""` | Optional 063 scoring formula id; empty → built-in deterministic default score |
| `analysis.fundsignal.buy_quantile` | float | `0.80` | Cross-sectional score quantile ≥ → `buy` |
| `analysis.fundsignal.sell_quantile` | float | `0.20` | Cross-sectional score quantile ≤ → `sell` |
| `analysis.fundsignal.min_conviction_to_emit` | float | `0.0` | Drop symbols whose score is below this before emitting |
| `analysis.fundsignal.valid_days` | int | `90` | Emitted signal validity window (`valid_until` = run date + this) |
| `analysis.fundsignal.startup_jitter_seconds` | int | `30` | One-shot random delay [0, N] seconds applied once at producer loop entry to stagger concurrent redeploys (feature 156); read presence-aware (`get_int_present`) — `0` disables jitter. |
| `analysis.fundsignal.retry_seconds` | int | `300` | On a caught cycle error, `blocked_until_ms` advances by this many seconds (not a full `run_interval_hours`), so a transient failure retries in minutes (feature 156); read presence-aware. |
| `analysis.opportunity.max_universe_size` | int | `100` | Max candidates traced per opportunity compute (feature 097); watchlist/held rank **above the cut** so a curated symbol is never truncated — only the speculative signal tail is dropped (FR-1). |
| `analysis.opportunity.valid_window_hours` | int | `24` | `valid_until` = the compute's session date + this window (feature 097). |
| `analysis.opportunity.snooze_default_hours` | int | `24` | Default bounded "snooze until" when a SNOOZE carries no explicit timestamp (feature 097). |
| `analysis.opportunity.signal_rank_weight` | float | `0.3` | Weight `w ∈ [0,1]` of the independent signal axis in the queue ORDER BY (feature 097, OR-G); `rank = (1−w)·conviction + w·signal_axis`. This is a distinct scalar from the removed `analysis.signals.source_weights` key (superseded by feature 134, deleted by feature 161) — not a re-purpose. |
| `analysis.opportunity.refresh_hour_utc` | int | `0` | Hour (UTC) of the **configured daily refresh** pass (feature 097) — a wall-clock refresh, **not** market close (holiday/DST/early-close drift is expected; a calendar-aligned refresh is a future feature). Read **presence-aware** (mirror `get_bool`'s `HasField`), never `get_int` — `0` = midnight is legitimate and the `get_int` zero-trap would swallow it. Also the wall-clock anchor for the DurableSchedule-backed opportunity refresh (feature 158). |
| `analysis.opportunity.startup_jitter_seconds` | int | `30` | One-shot random delay `[0, N]` seconds applied once at the opportunity refresh loop entry to stagger concurrent redeploys (feature 158); read presence-aware (`get_int_present`) — `0` disables jitter. Mirrors `analysis.fundsignal.startup_jitter_seconds`. |
| `analysis.opportunity.retry_seconds` | int | `300` | On a caught enumeration error the wall-clock `blocked_until_ms` advances by this many seconds (retry soon), not to the next wall-clock hour (feature 158); read presence-aware, clamped `max(1, …)` at the read site. Mirrors `analysis.fundsignal.retry_seconds`. |
| `analysis.opportunity.max_live_strategies_per_symbol` | int | `5` | Per-symbol cap (feature 131): how many live-enabled strategies may **newly** attribute to one symbol via live-coverage. Enforced only at the two candidate-**creation** sites (`_capped_live`); tagging an already-existing curated row (a watchlist-bound or held strategy that is also live) is uncapped. Tiebreak is `created_at` ascending. AC-7. |
| `analysis.opportunity.max_live_only_symbols_per_compute` | int | `20` | Cap (feature 131) on distinct **non-held** signal+live-covered symbols that get a new candidate row per compute pass (design step 6). Ranked by max active-signal conviction descending. Composes **multiplicatively** with the per-symbol cap. AC-8. |
| `analysis.opportunity.max_live_held_symbols_per_compute` | int | `20` | Cap (feature 131) on distinct **held** symbols that may receive a new live-only strategy attribution per compute pass (ranked by held market value descending); does **not** bound the held-row count itself — every held symbol still yields ≥1 row. AC-9. |
| `analysis.opportunity.max_concurrent_bars_fetches` | int | `2` | Process-lifetime singleton semaphore bounding cross-request concurrency of `_compute_opportunities`' bars-fetch calls (feature 141, SEV-2 fix for TimescaleDB "out of shared memory" under multi-user load). Mirrors `analysis.series.max_concurrent_components`'s shape, but default `2` (not `4`) to match `xstockstrat-marketdata`'s own `DB_POOL_MAX` default so analysis never queues more concurrent bars-fetch attempts than marketdata can actually execute. Read once in `AnalysisServicer.__init__` via `get_int` with a `max(1, …)` clamp. |
| `analysis.opportunity.sparkline_bars` | int | `20` | Number of most-recent daily bar closes fetched per opportunity for the Decide-surface sparkline (feature 095, AC-3). Read live per read-time enrichment via `get_int` with a `max(1, …)` clamp; no config-service seed migration (the `analysis.opportunity.*` no-seed pattern — resolves to the code default until an operator `SetConfig`s it). |
| `analysis.snapshot.indicator_timeout_ms` | int | `500` | Feature 042 — max ms the P&L-pattern consumer waits for indicator values when composing an order snapshot; on timeout it stores a **partial** snapshot with an empty indicators map (FR-6), never aborting order-event capture. |
| `analysis.snapshot.signal_timeout_ms` | int | `500` | Feature 042 — max ms the consumer waits for active signals when composing a snapshot; on timeout the snapshot carries an empty signals list (FR-6). |
| `analysis.patterns.min_sample_count` | int | `5` | Feature 042 — minimum samples in a bucket before a factor appears in `QueryPnLPatterns` results (query-time drop). |
| `analysis.patterns.indicator_bucket_count` | int | `5` | Feature 042 — number of quantile buckets used to group indicator-value factors at `QueryPnLPatterns` time (data-dependent boundaries). |

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

## Running Tests

```bash
uv sync --extra dev   # install deps (including dev) from uv.lock
uv run pytest         # run all tests
uv run pytest --cov=app --cov-fail-under=40  # with coverage
```

## Environment Variables

```text
GRPC_PORT=50056
CONFIG_ENDPOINT=xstockstrat-config:50060
MARKETDATA_ENDPOINT=xstockstrat-marketdata:50053
INDICATORS_ENDPOINT=xstockstrat-indicators:50054
INGEST_ENDPOINT=xstockstrat-ingest:50055
PORTFOLIO_ENDPOINT=xstockstrat-portfolio:50052   # feature 062 — fundamentals signal producer watchlist universe; feature 083 — ListOpportunities held positions
TRADING_ENDPOINT=xstockstrat-trading:50051       # feature 083 — GetStrategyAnalytics ListOrders "taken" count
LEDGER_ENDPOINT=xstockstrat-ledger:50057
NOTIFY_ENDPOINT=xstockstrat-notify:50059
DATABASE_URL=postgres://xstockstrat:${POSTGRES_PASSWORD}@timescaledb:5432/xstockstrat?sslmode=disable  # constructed by docker-compose from POSTGRES_PASSWORD in .env
APPLICATION_ENV=development         # development | production
TRADING_MODE=paper                     # paper | live
```
