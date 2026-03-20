# xstockstrat-analysis — CLAUDE.md

## Role
Python gRPC service for strategy backtesting, scoring, and report generation. Reads historical market data from xstockstrat-marketdata and computed indicators from xstockstrat-indicators. Optionally fetches newsletter signals from xstockstrat-ingest for signal-weighted strategies. Writes backtest results to xstockstrat-ledger.

As of Phase 3, RunBacktest executes a real SMA crossover engine (no more synthetic stubs) that:
1. Fetches OHLCV bars via `MarketDataService.GetBars`
2. Computes fast/slow SMAs via `IndicatorsService.ComputeIndicator`
3. Optionally calls `IngestService.QuerySignals` for newsletter signal weighting
4. Simulates trades bar-by-bar and computes Sharpe, drawdown, win rate, profit factor

## Language
Python 3.12 (asyncio, grpc.aio)

## Ports

| Protocol | Port | Purpose |
|---|---|---|
| gRPC | `50056` | Internal service-to-service (protobuf) |
| HTTP (Connect-RPC) | `8056` | Connect-RPC + n8n webhooks |

## Connect-RPC

Connect-RPC HTTP server runs alongside gRPC on `HTTP_PORT=8056` via `asyncio.gather`.

- Handler: `app/main.py` — `start_connect_server(servicer)` runs uvicorn with `ConnectHandler` ASGI wrapper
- `asyncio.gather(grpc_server.wait_for_termination(), start_connect_server(servicer))` starts both concurrently
- Callers (n8n, frontends) use HTTP `8056`; internal services use gRPC `50056`

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

## n8n Webhooks

| Endpoint | Method | Payload | Action |
|---|---|---|---|
| `/webhooks/n8n/run-backtest` | POST | `{strategy_id, symbols, start, end, initial_capital}` | Runs backtest |
| `/webhooks/n8n/score-strategy` | POST | `{strategy_id, start, end}` | Scores strategy |

## Ledger Events Emitted

| Event Type | Trigger |
|---|---|
| `analysis.backtest.started` | Backtest begins |
| `analysis.backtest.completed` | Backtest done |
| `analysis.strategy.scored` | Strategy scored |

## Environment Variables

```
GRPC_PORT=50056
HTTP_PORT=8056
CONFIG_ENDPOINT=xstockstrat-config:50060
MARKETDATA_ENDPOINT=xstockstrat-marketdata:50053
INDICATORS_ENDPOINT=xstockstrat-indicators:50054
INGEST_ENDPOINT=xstockstrat-ingest:50055
LEDGER_ENDPOINT=xstockstrat-ledger:50057
NOTIFY_ENDPOINT=xstockstrat-notify:50059
DATABASE_URL=postgres://user:pass@timescaledb:5432/xstockstrat?sslmode=disable
APP_ENV=dev                            # dev | production
TRADING_MODE=paper                     # paper | live
```
