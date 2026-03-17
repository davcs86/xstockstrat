# xstockstrat-analysis — CLAUDE.md

## Role
Python gRPC service for strategy backtesting, scoring, and report generation. Reads historical market data from xstockstrat-marketdata and computed indicators from xstockstrat-indicators. Writes backtest results to xstockstrat-ledger.

## Language
Python 3.12 (asyncio, grpc.aio)

## gRPC Port
`50056`

## Dependencies

| Dependency | Type | Reason |
|---|---|---|
| xstockstrat-config | gRPC WatchConfig | Live config at startup |
| xstockstrat-marketdata | gRPC read | Historical OHLCV data |
| xstockstrat-indicators | gRPC read | Indicator signals for strategy |
| xstockstrat-ledger | gRPC write | Store backtest results |
| xstockstrat-notify | gRPC write | Alert on completed backtests |

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
CONFIG_ENDPOINT=xstockstrat-config:50060
MARKETDATA_ENDPOINT=xstockstrat-marketdata:50053
INDICATORS_ENDPOINT=xstockstrat-indicators:50054
LEDGER_ENDPOINT=xstockstrat-ledger:50057
NOTIFY_ENDPOINT=xstockstrat-notify:50059
DATABASE_URL=postgres://user:pass@timescaledb:5432/xstockstrat?sslmode=disable
```
