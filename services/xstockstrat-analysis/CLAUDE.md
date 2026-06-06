# xstockstrat-analysis — CLAUDE.md

## Role

Python gRPC service for strategy backtesting, scoring, and report generation. Reads historical market data from xstockstrat-marketdata and computed indicators from xstockstrat-indicators. Optionally fetches newsletter signals from xstockstrat-ingest for signal-weighted strategies. Writes backtest results to xstockstrat-ledger.

Beyond the gRPC server, the service runs an **asyncio live evaluation loop** (`app/engine/live_loop.py`, feature 048) that continuously evaluates `live_enabled` strategies via the shared evaluator (`app/services/evaluator.py`) and emits alerts to xstockstrat-notify on entry/exit transitions — guaranteeing backtest/live parity. The loop never places orders.

As of Phase 3, RunBacktest executes a real SMA crossover engine (no more synthetic stubs) that:

1. Fetches OHLCV bars via `MarketDataService.GetBars`
2. Computes fast/slow SMAs via `IndicatorsService.ComputeIndicator`
3. Optionally calls `IngestService.QuerySignals` for newsletter signal weighting
4. Simulates trades bar-by-bar and computes Sharpe, drawdown, win rate, profit factor

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
| xstockstrat-ingest | gRPC read | QuerySignals for signal-weighted backtesting |
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

## Ledger Events Emitted

| Event Type | Trigger |
|---|---|
| `analysis.backtest.started` | Backtest begins |
| `analysis.backtest.completed` | Backtest done |
| `analysis.strategy.scored` | Strategy scored |
| `analysis.strategy.triggered` | Live loop detected an entry or exit transition |
| `analysis.strategy.live_toggled` | `SetStrategyLive` enabled/disabled live evaluation |

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
LEDGER_ENDPOINT=xstockstrat-ledger:50057
NOTIFY_ENDPOINT=xstockstrat-notify:50059
DATABASE_URL=postgres://xstockstrat:${POSTGRES_PASSWORD}@timescaledb:5432/xstockstrat?sslmode=disable  # constructed by docker-compose from POSTGRES_PASSWORD in .env
APPLICATION_ENV=development         # development | production
TRADING_MODE=paper                     # paper | live
```
