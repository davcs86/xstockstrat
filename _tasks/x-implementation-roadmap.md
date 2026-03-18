# xstockstrat Platform — Implementation Roadmap

## Context

This roadmap drives implementation of full functionality across the 13-service xstockstrat platform. All services are scaffolded with entry points, proto contracts, and migrations present — but business logic handlers are skeletal. Proto stubs (`packages/proto/gen/`) have not been generated yet.

The implementation follows the **dependency graph** strictly: services that others depend on are implemented first, enabling incremental end-to-end verification at each phase boundary.

**Critical path**: `config → ledger + identity + notify → marketdata + portfolio → ingest + indicators + analysis → trading → UIs`

---

## Phase 0 — Foundation Setup

> Pre-requisite for all other phases. No service code, only tooling and infrastructure.

### Tasks

1. **Generate proto stubs**
   - `cd packages/proto && buf lint && buf generate`
   - Output: `packages/proto/gen/go/`, `gen/python/`, `gen/ts/`
   - Commit generated stubs to version control

2. **Bootstrap environment**
   - `./scripts/bootstrap.sh` — installs buf, sets up TimescaleDB, creates schemas, seeds config
   - Verify all 5 schemas created: `trading`, `portfolio`, `marketdata`, `ledger`, `config`

3. **Run all database migrations**
   - `./scripts/db-migrate.sh`
   - Verify hypertables created: `ohlcv`, `quotes`, `orders`, `snapshots`, `events`

4. **Validate Docker Compose**
   - `docker compose config` — check all services and deps are valid
   - `docker compose up timescaledb` — verify DB starts and is reachable

### Verification Checkpoint 0

```bash
# Proto stubs exist
ls packages/proto/gen/go packages/proto/gen/python packages/proto/gen/ts

# TimescaleDB schemas
psql $DATABASE_URL -c "\dn"
# Expected: trading, portfolio, marketdata, ledger, config

# Hypertables created
psql $DATABASE_URL -c "SELECT hypertable_name FROM timescaledb_information.hypertables;"
# Expected: ohlcv, quotes, orders, snapshots, events
```

---

## Phase 1 — Core Infrastructure Services

> These 4 Node.js services have no upstream service dependencies. All other services depend on them.

### 1A. xstockstrat-config (Port 50060 / 8060)

**File**: `services/xstockstrat-config/`
**Proto**: `packages/proto/config/v1/config.proto`

**Implement**:
- `WatchConfig(WatchConfigRequest) → stream ConfigSnapshot` — streaming config delivery scoped by `environment` + `trading_mode`
- `GetConfig(GetConfigRequest) → ConfigSnapshot` — one-shot fetch
- `SetConfig(SetConfigRequest) → SetConfigResponse` — admin config update
- `ListKeys(ListKeysRequest) → ListKeysResponse` — enumerate keys with metadata
- Config rows stored in `config` schema; audit log on every `SetConfig`
- n8n webhook handler: `POST /webhooks/n8n/config-update` → internal `SetConfig` gRPC

**Seed Data**: Insert global config keys from CLAUDE.md into DB:
- `platform.maintenance_mode` = false
- `platform.log_level` = info
- `platform.ledger_endpoint` = ledger:50057
- `platform.config_endpoint` = config:50060

### 1B. xstockstrat-ledger (Port 50057 / 8057)

**File**: `services/xstockstrat-ledger/`
**Proto**: `packages/proto/ledger/v1/ledger.proto`

**Implement**:
- `AppendEvent(AppendEventRequest) → AppendEventResponse` — immutable write, auto-increment `sequence` per `stream_key`
- `QueryEvents(QueryEventsRequest) → QueryEventsResponse` — filter by stream_key, event_type, time range, pagination
- `StreamEvents(StreamEventsRequest) → stream LedgerEvent` — replay from sequence or live tail via PostgreSQL LISTEN/NOTIFY
- `GetEvent(GetEventRequest) → LedgerEvent` — fetch single event by ID
- n8n webhook handler: `POST /webhooks/n8n/replay-events` → triggers StreamEvents replay

### 1C. xstockstrat-identity (Port 50058 / 8058)

**File**: `services/xstockstrat-identity/`
**Proto**: `packages/proto/identity/v1/identity.proto`

**Implement**:
- `AuthenticateUser` → JWT (access + refresh tokens)
- `ValidateToken` / `RefreshToken` / `RevokeToken`
- `CreateApiKey` / `ValidateApiKey` / `ListApiKeys` / `RevokeApiKey`
- JWT secret consumed from `identity.jwt_secret` config key (via WatchConfig)
- Token revocation list in `identity` schema

### 1D. xstockstrat-notify (Port 50059 / 8059)

**File**: `services/xstockstrat-notify/`
**Proto**: `packages/proto/notify/v1/notify.proto`

**Implement**:
- `EmitAlert(EmitAlertRequest) → EmitAlertResponse` — ingest alert, persist, fan-out to active streams
- `StreamAlerts(StreamAlertsRequest) → stream Alert` — long-lived server-streaming subscription with category/severity filters
- `AcknowledgeAlert` / `ListAlerts`
- Alert categories: `trade`, `risk`, `system`, `indicator`
- n8n webhook handler: `POST /webhooks/n8n/emit-alert`

### Verification Checkpoint 1

```bash
# Start Phase 1 services
docker compose up xstockstrat-config xstockstrat-ledger xstockstrat-identity xstockstrat-notify

# Config: GetConfig via Connect-RPC HTTP
curl -X POST http://localhost:8060/xstockstrat.config.v1.ConfigService/GetConfig \
  -H "Content-Type: application/json" \
  -d '{"environment":"DEV","trading_mode":"ALL"}'
# Expected: ConfigSnapshot with global keys

# Config: WatchConfig stream (5-second timeout)
grpcurl -d '{"environment":"DEV","trading_mode":"ALL"}' \
  localhost:50060 xstockstrat.config.v1.ConfigService/WatchConfig

# Ledger: AppendEvent
grpcurl -d '{"stream_key":"test","event_type":"test.created","payload":"{\"x\":1}"}' \
  localhost:50057 xstockstrat.ledger.v1.LedgerService/AppendEvent
# Expected: AppendEventResponse with sequence=1

# Identity: AuthenticateUser
curl -X POST http://localhost:8058/xstockstrat.identity.v1.IdentityService/AuthenticateUser \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin"}'
# Expected: AuthTokenResponse with access_token + refresh_token

# Notify: EmitAlert + StreamAlerts
grpcurl -d '{"alert":{"category":"system","severity":"INFO","message":"Phase 1 check"}}' \
  localhost:50059 xstockstrat.notify.v1.NotifyService/EmitAlert
```

---

## Phase 2 — Data Layer

> Services that store and serve market data and portfolio state.

### 2A. xstockstrat-marketdata (Port 50053 / 8053)

**File**: `services/xstockstrat-marketdata/`
**Proto**: `packages/proto/marketdata/v1/marketdata.proto`

**Implement**:
- `StreamBars(StreamBarsRequest) → stream Bar` — real-time OHLCV from Alpaca WebSocket feed
- `StreamQuotes(StreamQuotesRequest) → stream Quote` — real-time NBBO quotes from Alpaca
- `GetBars(GetBarsRequest) → GetBarsResponse` — query `ohlcv` hypertable with timeframe/symbol/time range filters
- `GetLatestQuote(GetLatestQuoteRequest) → Quote` — last row from `quotes` hypertable
- `BackfillBars(BackfillBarsRequest) → BackfillBarsResponse` — trigger async historical pull from Alpaca data API
- `ListAssets(ListAssetsRequest) → ListAssetsResponse` — query Alpaca assets list
- Startup: `WatchConfig` for `marketdata.*` keys (Alpaca credentials via `secret.alpaca_api_key`)
- `EmitAlert` to notify on feed disconnect/reconnect events

**Config Keys**: `marketdata.alpaca_base_url`, `marketdata.feed` (iex/sip), `marketdata.backfill_batch_size`

### 2B. xstockstrat-portfolio (Port 50052 / 8052)

**File**: `services/xstockstrat-portfolio/`
**Proto**: `packages/proto/portfolio/v1/portfolio.proto`

**Implement**:
- `GetPortfolio(GetPortfolioRequest) → Portfolio` — aggregate positions from `portfolio` schema + reconstruct from ledger if needed
- `GetPosition(GetPositionRequest) → Position` — single symbol position with unrealized P&L
- `ListPositions(ListPositionsRequest) → ListPositionsResponse` — paginated positions list with `trading_mode` filter
- `GetPnL(GetPnLRequest) → PnLResponse` — compute realized/unrealized P&L over `TimeRange`
- `GetSnapshot(GetSnapshotRequest) → PortfolioSnapshot` — historical state from `snapshots` hypertable
- `StreamPortfolioUpdates(StreamPortfolioUpdatesRequest) → stream PortfolioSnapshot` — real-time updates when orders fill
- Startup: `WatchConfig`, subscribe to `StreamEvents` on ledger for `order.filled` events to update positions
- Persist snapshots to `portfolio.snapshots` hypertable on each update

### Verification Checkpoint 2

```bash
# Start Phase 2 services
docker compose up xstockstrat-marketdata xstockstrat-portfolio

# MarketData: GetBars (historical — requires Alpaca credentials)
grpcurl -d '{"symbol":"AAPL","timeframe":"1Day","start":"2024-01-01T00:00:00Z","end":"2024-01-31T00:00:00Z"}' \
  localhost:50053 xstockstrat.marketdata.v1.MarketDataService/GetBars
# Expected: GetBarsResponse with bars array

# MarketData: ListAssets
grpcurl localhost:50053 xstockstrat.marketdata.v1.MarketDataService/ListAssets

# Portfolio: GetPortfolio (empty initially)
grpcurl -d '{"trading_mode":"PAPER"}' \
  localhost:50052 xstockstrat.portfolio.v1.PortfolioService/GetPortfolio
# Expected: Portfolio with empty positions

# DB: Verify ohlcv data written after BackfillBars
psql $DATABASE_URL -c "SELECT COUNT(*) FROM marketdata.ohlcv WHERE symbol='AAPL';"
```

---

## Phase 3 — Processing Layer

> Services that compute on data. Can be developed in parallel after Phase 2.

### 3A. xstockstrat-indicators (Port 50054 / 8054)

**File**: `services/xstockstrat-indicators/`
**Proto**: `packages/proto/indicators/v1/indicators.proto`

**Implement**:
- `ComputeIndicator(ComputeIndicatorRequest) → ComputeIndicatorResponse` — built-in indicators: SMA, EMA, RSI, MACD, BB, ATR, VWAP
- `ExecuteFormula(ExecuteFormulaRequest) → ExecuteFormulaResponse` — sandboxed Python execution with timeout + memory limits
- `ListIndicators` / `RegisterFormula` / `GetFormula`
- Sandbox: `restrictedpython` or `subprocess` isolation; block dangerous imports
- Config keys: `indicators.sandbox.timeout_ms`, `indicators.sandbox.memory_bytes`

### 3B. xstockstrat-ingest (Port 50055 / 8055)

**File**: `services/xstockstrat-ingest/`
**Proto**: `packages/proto/ingest/v1/ingest.proto`

**Implement**:
- `TriggerBackfill(TriggerBackfillRequest) → TriggerBackfillResponse` — create `BackfillJob`, call `BackfillBars` on marketdata
- `GetBackfillStatus(GetBackfillStatusRequest) → BackfillJob` — query job state (QUEUED → RUNNING → COMPLETED/FAILED)
- `ListBackfillJobs` / `NormalizeRawData`
- Ingest is the coordinator for historical data loading; marketdata is the executor

### 3C. xstockstrat-analysis (Port 50056 / 8056)

**File**: `services/xstockstrat-analysis/`
**Proto**: `packages/proto/analysis/v1/analysis.proto`

**Implement**:
- `RunBacktest(RunBacktestRequest) → BacktestResult` — call `GetBars` (marketdata), compute via `ComputeIndicator`/`ExecuteFormula` (indicators), read trade history from ledger
- `ScoreStrategy(ScoreStrategyRequest) → StrategyScore` — Sharpe ratio, max drawdown, win rate, profit factor → grade A–F
- `ListStrategies` / `GetStrategyReport`
- Runs as a batch computation; results cached to DB

### Verification Checkpoint 3

```bash
# Indicators: ComputeIndicator (SMA 20 on AAPL)
grpcurl -d '{"symbol":"AAPL","indicator":"SMA","period":20,"timeframe":"1Day"}' \
  localhost:50054 xstockstrat.indicators.v1.IndicatorsService/ComputeIndicator
# Expected: ComputeIndicatorResponse with points array

# Indicators: ExecuteFormula (sandbox test)
grpcurl -d '{"formula":"result = sum(prices[-5:]) / 5","inputs":{"prices":[100,101,102,103,104]}}' \
  localhost:50054 xstockstrat.indicators.v1.IndicatorsService/ExecuteFormula
# Expected: ExecuteFormulaResponse with result=102.0

# Ingest: TriggerBackfill
grpcurl -d '{"symbol":"AAPL","start":"2024-01-01T00:00:00Z","end":"2024-12-31T00:00:00Z","timeframe":"1Day"}' \
  localhost:50055 xstockstrat.ingest.v1.IngestService/TriggerBackfill
# Expected: TriggerBackfillResponse with job_id; poll GetBackfillStatus until COMPLETED

# Analysis: RunBacktest
grpcurl -d '{"strategy_id":"sma_crossover","symbol":"AAPL","start":"2024-01-01T00:00:00Z","end":"2024-12-31T00:00:00Z","trading_mode":"PAPER"}' \
  localhost:50056 xstockstrat.analysis.v1.AnalysisService/RunBacktest
# Expected: BacktestResult with sharpe_ratio, max_drawdown, win_rate

# Sandbox timeout enforcement
grpcurl -d '{"formula":"import time; time.sleep(999)","inputs":{}}' \
  localhost:50054 xstockstrat.indicators.v1.IndicatorsService/ExecuteFormula
# Expected: SandboxExitReason = TIMEOUT
```

---

## Phase 4 — Trading Core

> The highest-dependency service. Requires all Phase 1–3 services operational.

### xstockstrat-trading (Port 50051 / 8051)

**File**: `services/xstockstrat-trading/`
**Proto**: `packages/proto/trading/v1/trading.proto`

**Implement**:
- `PlaceOrder(PlaceOrderRequest) → Order` — validate via `GetPosition` (portfolio) + optional `ComputeIndicator` (indicators) → submit to Alpaca broker API → `AppendEvent` to ledger → `EmitAlert` to notify
- `CancelOrder(CancelOrderRequest) → CancelOrderResponse` — cancel on Alpaca → update local state → ledger event
- `GetOrder(GetOrderRequest) → Order` — fetch from `trading.orders` table
- `ListOrders(ListOrdersRequest) → ListOrdersResponse` — paginated, filterable by status/side/symbol/trading_mode
- `StreamOrderUpdates(StreamOrderUpdatesRequest) → stream Order` — relay Alpaca order status stream
- Startup: `WatchConfig`, connect to Alpaca Broker API (paper vs live endpoint by `trading_mode`)
- Order lifecycle events written to ledger: `order.created`, `order.submitted`, `order.filled`, `order.cancelled`
- n8n webhook: `POST /webhooks/n8n/place-order`

**Config Keys**: `trading.alpaca_broker_url`, `trading.max_order_size`, `trading.risk_check_enabled`

### Verification Checkpoint 4

```bash
# Start trading service
docker compose up xstockstrat-trading

# Health check
curl http://localhost:8051/health

# PlaceOrder (paper mode)
grpcurl -d '{"symbol":"AAPL","side":"BUY","type":"MARKET","qty":1,"trading_mode":"PAPER"}' \
  localhost:50051 xstockstrat.trading.v1.TradingService/PlaceOrder
# Expected: Order with status=PENDING, order_id set

# Verify ledger event written
grpcurl -d '{"stream_key":"order.<order_id>","limit":10}' \
  localhost:50057 xstockstrat.ledger.v1.LedgerService/QueryEvents
# Expected: events with types order.created, order.submitted

# Verify portfolio updated (after fill)
grpcurl -d '{"trading_mode":"PAPER"}' \
  localhost:50052 xstockstrat.portfolio.v1.PortfolioService/GetPortfolio
# Expected: AAPL position with qty=1

# Verify notify alert emitted
grpcurl -d '{"categories":["trade"],"limit":5}' \
  localhost:50059 xstockstrat.notify.v1.NotifyService/ListAlerts
# Expected: trade alert for AAPL order

# StreamOrderUpdates (5-second subscription)
grpcurl -d '{"trading_mode":"PAPER"}' \
  localhost:50051 xstockstrat.trading.v1.TradingService/StreamOrderUpdates

# Maintenance mode (config propagation test)
grpcurl -d '{"key":"platform.maintenance_mode","value":{"bool_val":true},"environment":"DEV","trading_mode":"ALL"}' \
  localhost:50060 xstockstrat.config.v1.ConfigService/SetConfig
# Then attempt PlaceOrder — should be rejected within 2s of config propagation
```

---

## Phase 5 — UI Layer

> Can be developed in parallel with Phase 4. All UIs consume services via Connect-RPC HTTP (port 80XX).

### 5A. xstockstrat-config-ui (Port 3002) — Start here (simplest)

**File**: `services/xstockstrat-config-ui/`

**Implement**:
- Config browser: `ListKeys` → tabular display grouped by service prefix
- Inline edit: form → `SetConfig` with environment + trading_mode selectors
- Real-time updates: `WatchConfig` stream displayed as change log

### 5B. xstockstrat-insights (Port 3001)

**File**: `services/xstockstrat-insights/`

**Implement**:
- Strategy list: `ListStrategies` → clickable list
- Backtest runner: form → `RunBacktest` → display `BacktestResult` (Sharpe, drawdown, win rate, P&L chart)
- Strategy scorecard: `ScoreStrategy` → grade badge (A–F)
- Strategy report: `GetStrategyReport` → full markdown/chart view

### 5C. xstockstrat-trader (Port 3000)

**File**: `services/xstockstrat-trader/`

**Implement**:
- Order entry form → `PlaceOrder` → confirmation modal
- Order book table: `ListOrders` + `StreamOrderUpdates` real-time updates
- Portfolio panel: `GetPortfolio` + `StreamPortfolioUpdates` P&L display
- Chart panel: `StreamBars` / `GetBars` OHLCV candlestick chart
- Alert banner: `StreamAlerts` server-sent-events feed
- Paper/Live mode toggle (all requests tagged with `trading_mode`)

### Verification Checkpoint 5

```bash
# Start all UIs
docker compose up xstockstrat-trader xstockstrat-insights xstockstrat-config-ui

# Config UI
curl http://localhost:3002/health

# Insights
curl http://localhost:3001/health

# Trader
curl http://localhost:3000/health

# Manual: Open http://localhost:3002 → verify all platform.* keys visible
# Manual: Open http://localhost:3001 → run backtest on sma_crossover/AAPL
# Manual: Open http://localhost:3000 → place paper order for AAPL, verify portfolio updates
```

---

## Phase 6 — Integration & n8n

> End-to-end wiring of all n8n workflows and cross-service integration tests.

### Tasks

1. **n8n workflow setup**
   - Configure n8n to call `POST http://config:8060/webhooks/n8n/config-update` on config change
   - Configure n8n to call `POST http://trading:8051/webhooks/n8n/place-order` on external signal
   - Configure n8n to call `POST http://notify:8059/webhooks/n8n/emit-alert` on risk event
   - Configure n8n to call `POST http://ledger:8057/webhooks/n8n/replay-events` for audit

2. **Cross-service integration tests**
   - Full paper trade lifecycle: signal → order → fill → portfolio update → ledger event → notify alert
   - Config propagation: `SetConfig` → all `WatchConfig` subscribers receive delta within 2s
   - Backfill pipeline: `TriggerBackfill` (ingest) → `BackfillBars` (marketdata) → ohlcv rows → `RunBacktest` (analysis) → `BacktestResult`
   - Auth integration: JWT from identity → validated by all services on each RPC call

3. **Maintenance mode test**
   - Set `platform.maintenance_mode=true` → all `PlaceOrder` calls rejected within 2s of propagation

### Verification Checkpoint 6 — End-to-End Trading Flow

```bash
# Step 1: Authenticate
TOKEN=$(curl -s -X POST http://localhost:8058/xstockstrat.identity.v1.IdentityService/AuthenticateUser \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin"}' | jq -r .access_token)

# Step 2: Backfill 6 months of AAPL data
JOB_ID=$(grpcurl -H "Authorization: Bearer $TOKEN" \
  -d '{"symbol":"AAPL","start":"2024-07-01T00:00:00Z","end":"2024-12-31T00:00:00Z","timeframe":"1Day"}' \
  localhost:50055 xstockstrat.ingest.v1.IngestService/TriggerBackfill | jq -r .job_id)
# Poll until COMPLETED:
# grpcurl -d "{\"job_id\":\"$JOB_ID\"}" localhost:50055 xstockstrat.ingest.v1.IngestService/GetBackfillStatus

# Step 3: Run backtest on AAPL 6-month period
grpcurl -H "Authorization: Bearer $TOKEN" \
  -d '{"strategy_id":"sma_crossover","symbol":"AAPL","start":"2024-07-01T00:00:00Z","end":"2024-12-31T00:00:00Z","trading_mode":"PAPER"}' \
  localhost:50056 xstockstrat.analysis.v1.AnalysisService/RunBacktest
# Expected: BacktestResult with sharpe_ratio > 0

# Step 4: Place paper order
ORDER_ID=$(grpcurl -H "Authorization: Bearer $TOKEN" \
  -d '{"symbol":"AAPL","side":"BUY","type":"MARKET","qty":10,"trading_mode":"PAPER"}' \
  localhost:50051 xstockstrat.trading.v1.TradingService/PlaceOrder | jq -r .order_id)

# Step 5: Verify full event chain (within 5s of fill)
grpcurl -d "{\"stream_key\":\"order.$ORDER_ID\"}" \
  localhost:50057 xstockstrat.ledger.v1.LedgerService/QueryEvents
# Expected sequence: order.created → order.submitted → order.filled

# Step 6: Portfolio reflects position
grpcurl -d '{"trading_mode":"PAPER"}' \
  localhost:50052 xstockstrat.portfolio.v1.PortfolioService/GetPortfolio
# Expected: AAPL position qty=10

# Step 7: Notify alert was emitted
grpcurl -d '{"categories":["trade"],"limit":1}' \
  localhost:50059 xstockstrat.notify.v1.NotifyService/ListAlerts
# Expected: AAPL BUY order.filled alert

# Step 8: n8n webhook triggers config change
curl -X POST http://localhost:8060/webhooks/n8n/config-update \
  -H "Content-Type: application/json" \
  -d '{"key":"platform.log_level","value":"debug","environment":"DEV","trading_mode":"ALL"}'
# Verify all services log at debug level within 2s via WatchConfig stream
```

---

## Cross-Cutting Concerns

Apply across all phases — implement progressively as each service is built:

| Concern | Owner | Implementation |
|---|---|---|
| **Auth enforcement** | All services | Validate JWT from identity on each gRPC call; extract `trading_mode` from claims |
| **Config at startup** | All services | `WatchConfig` must succeed before accepting traffic; fail-fast on config error |
| **Ledger event writes** | All services | Append lifecycle events on every state change |
| **paper/live isolation** | trading, portfolio, analysis | All operations tagged with `TradingMode`; namespaces are isolated |
| **Error envelope** | All services | Use `common.v1.Error` for structured error responses |
| **Pagination** | All list RPCs | Use `common.v1.PageRequest/PageResponse` consistently |
| **Health endpoints** | All services | `GET /health` on HTTP port returns `{"status":"ok","service":"..."}` |
| **Observability** | All services | Structured JSON logs; OpenTelemetry traces on all gRPC calls |

---

## Implementation Order Summary

```
Phase 0  (foundation)
  └─► Phase 1A (config) — root dependency, implement first
        └─► Phase 1B/1C/1D (ledger, identity, notify) — parallel
              ├─► Phase 2A/2B (marketdata, portfolio) — parallel
              │     └─► Phase 3A/3B/3C (indicators, ingest, analysis) — parallel
              │           └─► Phase 4 (trading)
              │                 └─► Phase 5A/5B/5C (config-ui, insights, trader) — parallel
              └─► Phase 6 (integration + n8n, after all services pass their checkpoints)
```

**Critical path (serial)**: `config → ledger → marketdata → trading → trader UI`

**Parallelizable**:
- Phase 1B/1C/1D among themselves
- Phase 2A and 2B
- Phase 3A/3B/3C
- Phase 5A/5B/5C
- UI development (Phase 5) can begin alongside Phase 4

---

## Key Files Reference

| Area | Path |
|---|---|
| Proto contracts | `packages/proto/<service>/v1/<service>.proto` |
| Common types | `packages/proto/common/v1/common.proto` |
| Generated Go stubs | `packages/proto/gen/go/` |
| Generated Python stubs | `packages/proto/gen/python/` |
| Generated TS stubs | `packages/proto/gen/ts/` |
| Go services | `services/xstockstrat-{trading,portfolio,marketdata}/` |
| Python services | `services/xstockstrat-{indicators,ingest,analysis}/` |
| Node.js services | `services/xstockstrat-{ledger,identity,notify,config}/` |
| Next.js UIs | `services/xstockstrat-{trader,insights,config-ui}/` |
| Docker Compose | `docker-compose.yml` |
| Bootstrap script | `scripts/bootstrap.sh` |
| DB migration script | `scripts/db-migrate.sh` |
| Proto gen script | `scripts/buf-gen.sh` |
| Config rollout runbook | `_tasks/x-config-rollout.md` |
| Approval flow | `_tasks/x-approval-flow.md` |
