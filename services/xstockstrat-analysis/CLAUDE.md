# xstockstrat-analysis — CLAUDE.md

## Role

Python gRPC service for strategy backtesting, scoring, and report generation. Reads historical market data from xstockstrat-marketdata and computed indicators from xstockstrat-indicators. Optionally fetches newsletter signals from xstockstrat-ingest for signal-weighted strategies. Writes backtest results to xstockstrat-ledger.

Beyond the gRPC server, the service runs an **asyncio live evaluation loop** (`app/engine/live_loop.py`, feature 048) that continuously evaluates `live_enabled` strategies via the shared evaluator (`app/services/evaluator.py`) and emits alerts to xstockstrat-notify on entry/exit transitions — guaranteeing backtest/live parity. The loop never places orders.

### Fundamentals Signal Producer (feature 062)

A second asyncio background loop (`app/engine/fundsignal_loop.py`) runs a daily **fundamentals signal producer**. Each cycle it builds a deduplicated symbol universe, reads cached fundamentals **only** via marketdata `GetFundamentalsMulti` (never FMP directly — the single FMP chokepoint lives in marketdata, feature 059), scores each symbol (built-in deterministic default, or a 063 scoring formula when `analysis.fundsignal.scoring_formula_id` is set), maps the score to a `buy`/`sell`/`hold` direction by cross-sectional quantile, and emits an `ExternalSignal` per surviving symbol through ingest `IngestSignal`.

- **Cache-only FMP discipline**: the producer imports no FMP client; all fundamentals come through marketdata's 24h cache. Chunked fetches are bounded by `analysis.fundsignal.daily_call_budget`; when the budget is exhausted the run is marked `budget_deferred`, a notify warning is emitted, and remaining symbols resume on the next cycle.
- **Idempotency**: ingest's `IngestSignal` does **not** dedup, so analysis owns the guard in `analysis.fundsignal_emitted` (PK `(symbol, source, as_of_date)`). A same-day re-run emits nothing new and spends zero cache calls; `force=true` re-emits by clearing the day's rows first.
- **Run state**: `analysis.fundsignal_runs` tracks per-cycle status and budget accounting.
- **Source registration**: the producer idempotently registers its source via ingest `ManageSignalSource` as `source_type='derived'` (a generic bucket for internally-produced, non-extraction signals — added by ingest migration `006_signal_source_type_derived`), `extractor_module='app.extractors.noop'`. This call is admin-scoped; the background path injects the admin bit, the RPC path forwards the caller's scope.
- **Manual trigger**: the admin-scoped `RunFundamentalsScan` RPC invokes the same `run_once` code path (`force`, `dry_run`, explicit `symbols` override) so the scheduled loop and manual trigger never diverge.

New dependency edges: **analysis → ingest write** (`IngestSignal` / `ManageSignalSource`, gRPC not DB) and **analysis → portfolio read** (watchlist universe; requires `PORTFOLIO_ENDPOINT`). The loop reuses the existing asyncpg pool (no new pool — budget stays 2).

As of Phase 3, RunBacktest executes a real SMA crossover engine (no more synthetic stubs) that:

1. Fetches OHLCV bars via `MarketDataService.GetBars`
2. Computes fast/slow SMAs via `IndicatorsService.ComputeIndicator`
3. Optionally calls `IngestService.QuerySignals` for newsletter signal weighting
4. Simulates trades bar-by-bar and computes Sharpe, drawdown, win rate, profit factor

**Data-coverage awareness** (feature 053): when a symbol has too few bars, `RunBacktest` no longer
fabricates a flat-equity "success". It returns a structured result with
`status = BACKTEST_STATUS_INSUFFICIENT_DATA` and per-symbol `coverage_gaps` (symbol, bars_have,
bars_need, the range to backfill) so the caller can surface a gap message and trigger a backfill.
`GetBars` is queried with the canonical `"1d"` timeframe (+ `timeframe_enum`), fixing the prior
`"1Day"` vs `"1d"` mismatch that made backfilled bars invisible to backtests.

## Language

Python 3.12 (asyncio, grpc.aio)

## Docker Build Pattern

Python pattern — see `docs/patterns/docker-build.md` for single-stage `uv` builds, `--frozen --no-dev` flags, and proto namespace package setup.

## Ports

| Protocol | Port | Purpose |
|---|---|---|
| gRPC | `50056` | Internal service-to-service (protobuf) |

This service is **gRPC-only** (`app/main.py` runs a single `grpc.aio` server). The MCP agent
triggers backtests via the `RunBacktest` gRPC RPC. The former HTTP/Connect-RPC server on `8056`
(and its `/webhooks/run-backtest` handler) was removed.

## Dependencies

| Dependency | Type | Reason |
|---|---|---|
| xstockstrat-config | gRPC WatchConfig | Live config at startup |
| xstockstrat-marketdata | gRPC read | Historical OHLCV data for backtesting |
| xstockstrat-indicators | gRPC read | SMA/EMA/indicator computation |
| xstockstrat-ingest | gRPC read/write | QuerySignals for signal-weighted backtesting; `IngestSignal`/`ManageSignalSource` for the fundamentals signal producer (feature 062) |
| xstockstrat-portfolio | gRPC read | Watchlist universe for the fundamentals signal producer (feature 062) |
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

## Config Keys Consumed

Namespace: `analysis`

| Key | Type | Default | Description |
|---|---|---|---|
| `analysis.backtest.max_duration_seconds` | int | `300` | Max backtest run time |
| `analysis.backtest.default_commission_pct` | float | `0.001` | Assumed commission per trade |
| `analysis.backtest.default_slippage_pct` | float | `0.0005` | Assumed slippage |
| `analysis.scoring.sharpe_weight` | float | `0.4` | Weight of Sharpe in overall score |
| `analysis.scoring.drawdown_weight` | float | `0.3` | Weight of max drawdown |
| `analysis.scoring.win_rate_weight` | float | `0.3` | Weight of win rate |
| `analysis.signals.source_weights` | string (JSON) | `"{}"` | JSON object mapping source name to reliability weight in [0.0, 1.0]. Empty → all sources use 1.0 (neutral). Values outside [0.0, 1.0] are clamped at read time. |
| `analysis.engine.eval_interval_seconds` | int | `60` | Live evaluation polling cadence in seconds |
| `analysis.engine.max_strategies_per_cycle` | int | `50` | Max (strategy × symbol) pairs evaluated per cycle |
| `analysis.engine.alert_throttle_seconds` | int | `300` | Min seconds between alerts per (strategy, symbol) pair |
| `analysis.fundsignal.enabled` | bool | `false` | Master gate for the fundamentals signal producer loop (feature 062) |
| `analysis.fundsignal.run_interval_hours` | int | `24` | Hours between scheduled producer cycles |
| `analysis.fundsignal.universe_source` | string | `watchlists` | Symbol universe source: `watchlists` \| `explicit` \| `both` (watchlists union pends a global portfolio RPC; falls back to `explicit`) |
| `analysis.fundsignal.explicit_symbols` | string | `""` | Comma-separated symbols used when `universe_source` resolves to explicit |
| `analysis.fundsignal.max_symbols_per_run` | int | `200` | Cap on symbols scanned per cycle |
| `analysis.fundsignal.daily_call_budget` | int | `200` | Max cached `GetFundamentalsMulti` chunk calls per cycle; ≤ `marketdata.fmp.daily_request_cap` (250) |
| `analysis.fundsignal.source_slug` | string | `fundamentals` | Slug of the registered `derived` signal source the producer emits under |
| `analysis.fundsignal.scoring_formula_id` | string | `""` | Optional 063 scoring formula id; empty → built-in deterministic default score |
| `analysis.fundsignal.buy_quantile` | float | `0.80` | Cross-sectional score quantile ≥ → `buy` |
| `analysis.fundsignal.sell_quantile` | float | `0.20` | Cross-sectional score quantile ≤ → `sell` |
| `analysis.fundsignal.min_conviction_to_emit` | float | `0.0` | Drop symbols whose score is below this before emitting |
| `analysis.fundsignal.valid_days` | int | `90` | Emitted signal validity window (`valid_until` = run date + this) |

## Ledger Events Emitted

| Event Type | Trigger |
|---|---|
| `analysis.backtest.started` | Backtest begins |
| `analysis.backtest.completed` | Backtest done |
| `analysis.strategy.scored` | Strategy scored |
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

After any change to `pyproject.toml`, run `uv lock` and commit the updated `uv.lock`.

## Environment Variables

```text
GRPC_PORT=50056
CONFIG_ENDPOINT=xstockstrat-config:50060
MARKETDATA_ENDPOINT=xstockstrat-marketdata:50053
INDICATORS_ENDPOINT=xstockstrat-indicators:50054
INGEST_ENDPOINT=xstockstrat-ingest:50055
PORTFOLIO_ENDPOINT=xstockstrat-portfolio:50052   # feature 062 — fundamentals signal producer watchlist universe
LEDGER_ENDPOINT=xstockstrat-ledger:50057
NOTIFY_ENDPOINT=xstockstrat-notify:50059
DATABASE_URL=postgres://xstockstrat:${POSTGRES_PASSWORD}@timescaledb:5432/xstockstrat?sslmode=disable  # constructed by docker-compose from POSTGRES_PASSWORD in .env
APPLICATION_ENV=development         # development | production
TRADING_MODE=paper                     # paper | live
```
