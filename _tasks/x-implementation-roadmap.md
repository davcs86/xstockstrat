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
   - Verify all 6 schemas created: `trading`, `portfolio`, `marketdata`, `ledger`, `config`, `ingest`

3. **Run all database migrations**
   - `./scripts/db-migrate.sh`
   - Verify hypertables created: `ohlcv`, `quotes`, `orders`, `snapshots`, `events`, `newsletter_signals`

4. **Validate Docker Compose**
   - `docker compose config` — check all services and deps are valid
   - `docker compose up timescaledb` — verify DB starts and is reachable

### Verification Checkpoint 0

```bash
# Proto stubs exist
ls packages/proto/gen/go packages/proto/gen/python packages/proto/gen/ts

# TimescaleDB schemas
psql $DATABASE_URL -c "\dn"
# Expected: trading, portfolio, marketdata, ledger, config, ingest

# Hypertables created
psql $DATABASE_URL -c "SELECT hypertable_name FROM timescaledb_information.hypertables;"
# Expected: ohlcv, quotes, orders, snapshots, events, newsletter_signals
```

---

## Phase 1 — Core Infrastructure Services ✅ DONE

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
- `BackfillBars(BackfillBarsRequest) → BackfillBarsResponse` — trigger async historical pull; routes through source registry by `req.Source`
- `ListAssets(ListAssetsRequest) → ListAssetsResponse` — query Alpaca assets list
- Startup: `WatchConfig` for `marketdata.*` keys (Alpaca credentials via `secret.alpaca_api_key`)
- `EmitAlert` to notify on feed disconnect/reconnect events

**Source registry pattern** (required — not single Alpaca client):
- Implement a `SourceRegistry` in `internal/service/` that holds named `SourceClient` implementations
- Register Alpaca at startup as `sourceRegistry.Register("alpaca", alpacaClient)`; additional providers added alongside it
- All `BackfillBars` and `Stream*` calls dispatch via `sourceRegistry.Get(req.Source)` (defaults to `"alpaca"`)
- `source` value propagated from client through DB insert (`source TEXT NOT NULL DEFAULT 'alpaca'`) and proto response
- See `_tasks/x-add-data-source.md` Part 1 for the full multi-source client interface

**Config Keys**: `marketdata.alpaca_base_url`, `marketdata.feed` (iex/sip), `marketdata.backfill_batch_size`, `marketdata.<source>.enabled` per additional provider

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

## Phase 3 — Processing Layer ✅ DONE

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

**Signal-aware formulas** (new dependency on xstockstrat-ingest):
- Callers (analysis or external) fetch active signals via `ingest.QuerySignals` before calling `ExecuteFormula`
- Newsletter signals are passed in `input_data` struct alongside OHLCV bars
- The sandbox receives `data["newsletter_signals"]` as a list and can weight them in composite scoring
- See `_tasks/x-add-data-source.md` Part 3 for formula pattern and example composite formula

### 3B. xstockstrat-ingest (Port 50055 / 8055)

**File**: `services/xstockstrat-ingest/`
**Proto**: `packages/proto/ingest/v1/ingest.proto`

**⚠️ Architecture note**: ingest now owns a database schema. It is no longer a stateless coordinator — it persists newsletter/signal data in its own TimescaleDB hypertable.

**DB migration** (run before implementing RPCs):
- `services/xstockstrat-ingest/migrations/002_newsletter_signals.sql`
- Creates `ingest.newsletter_signals` hypertable (7-day chunks by `ingested_at`)
- See `_tasks/x-add-data-source.md` Part 2, Step 1 for the full DDL

**Implement**:
- `TriggerBackfill(TriggerBackfillRequest) → TriggerBackfillResponse` — create `BackfillJob`, call `BackfillBars` on marketdata
- `GetBackfillStatus(GetBackfillStatusRequest) → BackfillJob` — query job state (QUEUED → RUNNING → COMPLETED/FAILED)
- `ListBackfillJobs` / `NormalizeRawData`
- `IngestSignal(IngestSignalRequest) → IngestSignalResponse` — persist `ExternalSignal` to `ingest.newsletter_signals`; emit `ingest.signal.ingested` ledger event
- `QuerySignals(QuerySignalsRequest) → QuerySignalsResponse` — query signals by source/symbol/direction/active window; consumed by indicators + analysis
- n8n webhook: `POST /webhooks/n8n/ingest-signal` — receives parsed newsletter payloads from n8n workflows
- Ingest is the coordinator for historical data loading; marketdata is the executor

**Proto changes required** (non-breaking — new RPCs + messages, 1 service owner approval):
- Add `IngestSignal`, `QuerySignals` RPCs to `IngestService`
- Add `ExternalSignal`, `IngestSignalRequest/Response`, `QuerySignalsRequest/Response` messages
- Run `buf lint && buf breaking --against '.git#branch=main'` then `buf generate`
- See `_tasks/x-add-data-source.md` Part 2, Step 2 for the full proto diff

### 3C. xstockstrat-analysis (Port 50056 / 8056)

**File**: `services/xstockstrat-analysis/`
**Proto**: `packages/proto/analysis/v1/analysis.proto`

**Implement**:
- `RunBacktest(RunBacktestRequest) → BacktestResult` — call `GetBars` (marketdata), `QuerySignals` (ingest), compute via `ComputeIndicator`/`ExecuteFormula` (indicators), read trade history from ledger
- `ScoreStrategy(ScoreStrategyRequest) → StrategyScore` — Sharpe ratio, max drawdown, win rate, profit factor → grade A–F
- `ListStrategies` / `GetStrategyReport`
- Runs as a batch computation; results cached to DB

**Signal-weighted backtesting** (new dependency on xstockstrat-ingest):
- `RunBacktestRequest.strategy_params` (Struct) accepts `signal_sources`, `signal_weight`, `technical_weight`, `min_conviction`
- At each backtest timestep, analysis calls `QuerySignals` for active signals and passes them into `ExecuteFormula`
- See `_tasks/x-add-data-source.md` Part 3 for the full `RunBacktest` call pattern

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

# Ingest: IngestSignal (newsletter signal smoke test)
grpcurl -d '{
  "signal": {
    "source": "unusual_whales",
    "symbol": "AAPL",
    "direction": "buy",
    "conviction": 0.8,
    "valid_from": "2024-01-01T00:00:00Z",
    "headline": "Large call sweep detected"
  }
}' localhost:50055 xstockstrat.ingest.v1.IngestService/IngestSignal
# Expected: IngestSignalResponse with signal_id set

# Ingest: QuerySignals
grpcurl -d '{"symbol":"AAPL","active_window":{"start":"2024-01-01T00:00:00Z","end":"2024-01-15T00:00:00Z"}}' \
  localhost:50055 xstockstrat.ingest.v1.IngestService/QuerySignals
# Expected: QuerySignalsResponse with the signal inserted above

# DB: Verify newsletter_signals hypertable
psql $DATABASE_URL -c "SELECT source, symbol, direction, conviction FROM ingest.newsletter_signals LIMIT 5;"

# Analysis: RunBacktest (plain)
grpcurl -d '{"strategy_id":"sma_crossover","symbol":"AAPL","start":"2024-01-01T00:00:00Z","end":"2024-12-31T00:00:00Z","trading_mode":"PAPER"}' \
  localhost:50056 xstockstrat.analysis.v1.AnalysisService/RunBacktest
# Expected: BacktestResult with sharpe_ratio, max_drawdown, win_rate

# Analysis: RunBacktest with signal weighting
grpcurl -d '{
  "strategy_id":"composite_newsletter_strategy",
  "symbol":"AAPL",
  "start":"2024-01-01T00:00:00Z",
  "end":"2024-12-31T00:00:00Z",
  "trading_mode":"PAPER",
  "strategy_params": {
    "signal_sources": ["unusual_whales"],
    "signal_weight": 0.4,
    "technical_weight": 0.6,
    "min_conviction": 0.6
  }
}' localhost:50056 xstockstrat.analysis.v1.AnalysisService/RunBacktest
# Expected: BacktestResult with signal-influenced scoring

# Sandbox timeout enforcement
grpcurl -d '{"formula":"import time; time.sleep(999)","inputs":{}}' \
  localhost:50054 xstockstrat.indicators.v1.IndicatorsService/ExecuteFormula
# Expected: SandboxExitReason = TIMEOUT
```

> Implementation notes: see `_tasks/x-phase3-deviations.md`

---

## Phase 4 — Trading Core ✅ DONE

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

## Phase 5 — UI Layer ✅ DONE

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

## Phase 6 — Integration & n8n ✅ DONE

> End-to-end wiring of all n8n workflows and cross-service integration tests.
>
> Implementation notes: see `_tasks/x-phase6-deviations.md`

### Tasks

1. **n8n workflow setup**
   - Configure n8n to call `POST http://config:8060/webhooks/n8n/config-update` on config change
   - Configure n8n to call `POST http://trading:8051/webhooks/n8n/place-order` on external signal
   - Configure n8n to call `POST http://notify:8059/webhooks/n8n/emit-alert` on risk event
   - Configure n8n to call `POST http://ledger:8057/webhooks/n8n/replay-events` for audit
   - Configure per-newsletter n8n workflows → `POST http://ingest:8055/webhooks/n8n/ingest-signal` (email/RSS/CSV paths — see `_tasks/x-add-data-source.md` Part 2, Step 6)

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

## Phase 7 — Observability

> Can be applied incrementally alongside any phase. Recommended to wire Phase 7A–7B during
> Phase 0, and instrument each service as it is built in Phases 1–5.

### Decision Record

#### Current State

| Concern | State at project start |
|---|---|
| Log destination | stdout only (container logs) |
| Log format | JSON (prod) / colorized (dev) — already structured |
| Metrics | None |
| Tracing | None |
| Error tracking | None |
| Health checks | None exposed |
| Instrumentation | No OTel SDK in any service |

All services emit **structured JSON logs** to stdout — the correct foundation. The gap is
collection, aggregation, and querying.

#### Architecture Constraint: DO App Platform = Push Model

DO App Platform does not expose the underlying host. A Prometheus pull scraper cannot reach
`/metrics` endpoints on App Platform services. All observability data must be **pushed** from
the application to an external backend. This rules out a plain self-hosted Prometheus pull
setup without a push gateway.

#### Options Evaluated

| Option | Cost | Verdict |
|---|---|---|
| **Grafana Cloud** (Loki + Mimir + Tempo, OTLP push) | $0 free tier (50 GB logs, 10k series, 50 GB traces/mo, 14-day retention); ~$10–30/mo paid | **Chosen** |
| **Self-Hosted PLG on DO Droplet** ($24/mo, 4 GB RAM) | ~$24/mo flat, no per-GB fees, full data sovereignty | Escape hatch for production |
| **Managed OpenSearch** | $48–96+/mo, JVM-heavy, logs-only without extra stack | Rejected — overkill, 10–50x Loki cost |
| **Better Stack / Logtail** | Free 1 GB/mo; $25/mo for 5 GB/day | Rejected — logs-only, no metrics/traces |
| **DO Native Monitoring** | Free | Rejected — infra Droplet metrics only, unavailable on App Platform |

#### Decision

**Grafana Cloud free tier + OpenTelemetry.** OTel is the CNCF-standard vendor-neutral
instrumentation layer for Go, Python, and Node.js. Grafana Cloud free tier covers the full
dev/paper-trading phase at $0. When volume grows, choose between staying on Grafana Cloud
(pay-as-you-go) or migrating the backend to a self-hosted PLG Droplet (~$24/mo flat).

| Phase | Setup | Monthly Cost |
|---|---|---|
| Dev / paper trading | Grafana Cloud free tier | **$0** |
| Early production | Grafana Cloud paid | ~$10–30 |
| Scale / data sovereignty | Self-hosted PLG on DO Droplet | ~$24 flat |

---

### Architecture

```
Services (Go / Python / Node.js / Next.js)
  └── OTel SDK (per-language, configured via env vars)
        └── OTLP push (gRPC :4317 or HTTP :4318)
              └── OTel Collector  ← central gateway (local dev only)
                    ├── Loki exporter  → Grafana Cloud (logs)
                    ├── Mimir exporter → Grafana Cloud (metrics)
                    └── Tempo exporter → Grafana Cloud (traces)
                          └── Grafana UI → dashboards, alerts, SLOs
```

**Local dev:** OTel Collector runs as a Docker Compose service (`packages/otel/`). Services
push OTLP to `otel-collector:4317`.

**Production (DO App Platform):** Services push OTLP **directly** to the Grafana Cloud OTLP
gateway. No collector deployment needed — simplifies the DO App Platform surface.

---

### Phase 7A — Grafana Cloud Setup (manual, one-time)

> Performed by: platform lead

1. Create a Grafana Cloud account at `https://grafana.com/auth/sign-up/create-user`
2. Create a **stack** (e.g. `xstockstrat`). Note your stack slug and region
   (e.g. `prod-us-central-0`)
3. Under **Home → Connections → Add new connection → OpenTelemetry**, copy:
   - `GRAFANA_OTLP_ENDPOINT` — e.g. `https://otlp-gateway-prod-us-central-0.grafana.net/otlp`
   - `GRAFANA_OTLP_TOKEN` — base64-encoded `<instanceId>:<apiKey>` (pre-encoded by Grafana)
4. Store both in your secret store. Set as env vars on all services and on the OTel Collector
   container in prod.
5. For local dev, add to `.env` (never commit `.env`).

> The Grafana Cloud OTLP gateway accepts logs, metrics, and traces on a single endpoint.

---

### Phase 7B — OTel Collector (Local Dev)

**Config file:** `packages/otel/otel-collector-config.yaml`
**Docker Compose service:** `otel-collector` (added to `docker-compose.yml`)

The collector is an infrastructure dependency in `docker-compose.yml`. All services send
OTLP to `otel-collector:4317` locally; the collector forwards to Grafana Cloud using
`GRAFANA_OTLP_ENDPOINT` and `GRAFANA_OTLP_TOKEN` from `.env`.

```bash
# Verify collector is running
docker compose up -d otel-collector
docker compose logs otel-collector --tail=20
# Expect: "Everything is ready. Begin running and processing data."

# Smoke test with telemetrygen
docker run --rm --network xstockstrat \
  ghcr.io/open-telemetry/opentelemetry-collector-contrib/telemetrygen:latest \
  traces --otlp-endpoint otel-collector:4317 --otlp-insecure --duration 5s
# Then verify traces appear in Grafana Cloud → Explore → Tempo
```

---

### Phase 7C — Go Service Instrumentation

Applies to: `xstockstrat-trading`, `xstockstrat-portfolio`, `xstockstrat-marketdata`

#### Add dependencies to each `go.mod`

```bash
cd services/xstockstrat-trading   # repeat for portfolio, marketdata
go get go.opentelemetry.io/otel@v1.28.0
go get go.opentelemetry.io/otel/sdk@v1.28.0
go get go.opentelemetry.io/otel/sdk/metric@v1.28.0
go get go.opentelemetry.io/otel/sdk/log@v0.6.0
go get go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracehttp@v0.50.0
go get go.opentelemetry.io/otel/exporters/otlp/otlpmetric/otlpmetrichttp@v0.50.0
go get go.opentelemetry.io/otel/exporters/otlp/otlplog/otlploghttp@v0.6.0
go get go.opentelemetry.io/contrib/bridges/otelslog@v0.4.0
go get go.opentelemetry.io/contrib/instrumentation/google.golang.org/grpc/otelgrpc@v0.53.0
```

#### Create `internal/telemetry/otel.go` in each service

```go
package telemetry

import (
    "context"
    "os"

    "go.opentelemetry.io/otel"
    "go.opentelemetry.io/otel/exporters/otlp/otlplog/otlploghttp"
    "go.opentelemetry.io/otel/exporters/otlp/otlpmetric/otlpmetrichttp"
    "go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracehttp"
    "go.opentelemetry.io/otel/propagation"
    sdklog "go.opentelemetry.io/otel/sdk/log"
    sdkmetric "go.opentelemetry.io/otel/sdk/metric"
    sdktrace "go.opentelemetry.io/otel/sdk/trace"
    semconv "go.opentelemetry.io/otel/semconv/v1.26.0"
    "go.opentelemetry.io/otel/sdk/resource"
)

// Init configures the global OTEL tracer, meter, and log providers.
// OTEL_EXPORTER_OTLP_ENDPOINT and OTEL_SERVICE_NAME must be set in env.
// Returns a shutdown function — call it on process exit.
func Init(ctx context.Context, serviceName string) (shutdown func(context.Context) error, err error) {
    if os.Getenv("OTEL_ENABLED") != "true" {
        return func(context.Context) error { return nil }, nil
    }

    res, err := resource.New(ctx,
        resource.WithAttributes(semconv.ServiceName(serviceName)),
        resource.WithFromEnv(),
    )
    if err != nil {
        return nil, err
    }

    traceExp, err := otlptracehttp.New(ctx)
    if err != nil {
        return nil, err
    }
    tp := sdktrace.NewTracerProvider(
        sdktrace.WithBatcher(traceExp),
        sdktrace.WithResource(res),
    )
    otel.SetTracerProvider(tp)
    otel.SetTextMapPropagator(propagation.NewCompositeTextMapPropagator(
        propagation.TraceContext{}, propagation.Baggage{},
    ))

    metricExp, err := otlpmetrichttp.New(ctx)
    if err != nil {
        return nil, err
    }
    mp := sdkmetric.NewMeterProvider(
        sdkmetric.WithReader(sdkmetric.NewPeriodicReader(metricExp)),
        sdkmetric.WithResource(res),
    )
    otel.SetMeterProvider(mp)

    logExp, err := otlploghttp.New(ctx)
    if err != nil {
        return nil, err
    }
    lp := sdklog.NewLoggerProvider(
        sdklog.WithProcessor(sdklog.NewBatchProcessor(logExp)),
        sdklog.WithResource(res),
    )

    shutdown = func(ctx context.Context) error {
        _ = tp.Shutdown(ctx)
        _ = mp.Shutdown(ctx)
        _ = lp.Shutdown(ctx)
        return nil
    }
    return shutdown, nil
}
```

#### Wire into `cmd/server/main.go`

```go
// After slog.SetDefault(logger), before cfgWatcher.WaitForSnapshot:
otelShutdown, err := telemetry.Init(ctx, "xstockstrat-trading")
if err != nil {
    slog.Error("otel init failed", "error", err)
    // Non-fatal: observability is best-effort
}
defer func() {
    shutCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
    defer cancel()
    _ = otelShutdown(shutCtx)
}()
```

#### Add gRPC interceptors for trace propagation

```go
// grpc.NewServer:
grpc.NewServer(grpc.StatsHandler(otelgrpc.NewServerHandler()))
// outbound grpc.Dial:
grpc.WithStatsHandler(otelgrpc.NewClientHandler())
```

---

### Phase 7D — Python Service Instrumentation

Applies to: `xstockstrat-indicators`, `xstockstrat-ingest`, `xstockstrat-analysis`

#### Add to `pyproject.toml` dependencies

```toml
"opentelemetry-sdk>=1.26.0",
"opentelemetry-exporter-otlp-proto-http>=1.26.0",
"opentelemetry-instrumentation-grpc>=0.47b0",
"opentelemetry-instrumentation-logging>=0.47b0",
```

#### Create `app/telemetry.py` in each service

```python
import os
import logging

from opentelemetry import trace, metrics
from opentelemetry.sdk.resources import Resource, SERVICE_NAME
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor
from opentelemetry.sdk.metrics import MeterProvider
from opentelemetry.sdk.metrics.export import PeriodicExportingMetricReader
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
from opentelemetry.exporter.otlp.proto.http.metric_exporter import OTLPMetricExporter
from opentelemetry.instrumentation.logging import LoggingInstrumentor

log = logging.getLogger(__name__)


def init(service_name: str) -> None:
    """Configure global OTEL providers. No-op when OTEL_ENABLED != 'true'."""
    if os.environ.get("OTEL_ENABLED") != "true":
        return

    resource = Resource(attributes={SERVICE_NAME: service_name})

    provider = TracerProvider(resource=resource)
    provider.add_span_processor(BatchSpanProcessor(OTLPSpanExporter()))
    trace.set_tracer_provider(provider)

    reader = PeriodicExportingMetricReader(OTLPMetricExporter(), export_interval_millis=10_000)
    meter_provider = MeterProvider(resource=resource, metric_readers=[reader])
    metrics.set_meter_provider(meter_provider)

    # Injects trace_id / span_id into stdlib log records
    LoggingInstrumentor().instrument(set_logging_format=True)

    log.info("opentelemetry initialized", extra={"service": service_name})
```

#### Wire into `app/main.py`

```python
# Before config watcher, after basicConfig:
from app.telemetry import init as init_otel
init_otel("xstockstrat-indicators")  # use the service name
```

---

### Phase 7E — Node.js Service Instrumentation

Applies to: `xstockstrat-config`, `xstockstrat-ledger`, `xstockstrat-identity`, `xstockstrat-notify`

#### Add dependencies

```bash
pnpm add \
  @opentelemetry/sdk-node \
  @opentelemetry/auto-instrumentations-node \
  @opentelemetry/exporter-trace-otlp-http \
  @opentelemetry/exporter-metrics-otlp-http \
  @opentelemetry/exporter-logs-otlp-http \
  @opentelemetry/sdk-logs \
  @opentelemetry/winston-transport
```

#### Create `src/telemetry.ts` in each service

```typescript
import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-http';
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { BatchLogRecordProcessor } from '@opentelemetry/sdk-logs';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';

let sdk: NodeSDK | undefined;

export function initTelemetry(serviceName: string): void {
  if (process.env.OTEL_ENABLED !== 'true') return;

  sdk = new NodeSDK({
    serviceName,
    traceExporter: new OTLPTraceExporter(),
    metricReader: new PeriodicExportingMetricReader({
      exporter: new OTLPMetricExporter(),
      exportIntervalMillis: 10_000,
    }),
    logRecordProcessors: [new BatchLogRecordProcessor(new OTLPLogExporter())],
    instrumentations: [
      getNodeAutoInstrumentations({
        '@opentelemetry/instrumentation-fs': { enabled: false }, // noisy
      }),
    ],
  });

  sdk.start();
}

export async function shutdownTelemetry(): Promise<void> {
  await sdk?.shutdown();
}
```

#### Add Winston → OTLP bridge in `src/services/logger.ts`

```typescript
import { OpenTelemetryTransportV3 } from '@opentelemetry/winston-transport';

// In getLogger(), add to transports when OTEL is enabled:
const otelEnabled = process.env.OTEL_ENABLED === 'true';

return createLogger({
  // ...existing config...
  transports: [
    new transports.Console(),
    ...(otelEnabled ? [new OpenTelemetryTransportV3()] : []),
  ],
});
```

#### Wire into service entry point (`src/index.ts`)

```typescript
// Before anything else:
import { initTelemetry, shutdownTelemetry } from './telemetry';
initTelemetry('xstockstrat-config'); // use the service name

process.on('SIGTERM', async () => {
  await shutdownTelemetry();
  process.exit(0);
});
```

---

### Phase 7F — DO App Platform Env Vars

> Performed by: platform lead via `doctl` or the DO console.

Add to **every service block** in `.do/app.yaml` (prod) and `.do/app.dev.yaml` (dev):

```yaml
- key: OTEL_ENABLED
  value: "true"
- key: OTEL_SERVICE_NAME
  value: "xstockstrat-<service-name>"        # e.g. xstockstrat-trading
- key: OTEL_EXPORTER_OTLP_ENDPOINT
  type: SECRET
  value: "<GRAFANA_OTLP_ENDPOINT>"
- key: OTEL_EXPORTER_OTLP_HEADERS
  type: SECRET
  value: "Authorization=Basic <GRAFANA_OTLP_TOKEN>"
- key: OTEL_RESOURCE_ATTRIBUTES
  value: "environment=production,trading_mode=paper"
```

```bash
# Apply spec update
doctl apps update $APP_ID --spec .do/app.yaml
```

---

### Phase 7G — Dashboards & Alerting

#### Recommended starter dashboards

| Dashboard | Source |
|---|---|
| Go service metrics (goroutines, GC, HTTP) | Grafana Dashboard ID `10826` |
| gRPC server metrics | Build from `rpc.server.*` OTel semantic conventions |
| Request rate / error rate / latency | Build from `http.server.request.duration` histogram |
| Log volume by service + level | Loki: `sum by (service_name, level) (rate({job="xstockstrat"}[5m]))` |
| Distributed trace explorer | Grafana Tempo — use TraceQL |

#### Key Loki queries

```logql
{service_name="xstockstrat-trading"} | json | level="error"
{service_name=~"xstockstrat-.*"}     | json | line_format "{{.message}}"
```

#### Key Tempo TraceQL queries

```traceql
{ span.service.name = "xstockstrat-trading" && status = error }
{ span.rpc.system = "grpc" && duration > 500ms }
{ span.service.name = "xstockstrat-ledger" && span.rpc.method = "AppendEvent" }
```

#### Initial alert rules

| Alert | Query | Threshold |
|---|---|---|
| High error rate | `sum(rate(http_server_request_duration_seconds_count{http_response_status_code=~"5.."}[5m])) by (service_name)` | > 5 req/s |
| Service log errors | `sum(rate({service_name=~"xstockstrat-.*"} \| json \| level="error" [5m]))` | > 10/min |
| p99 latency spike | `histogram_quantile(0.99, rate(http_server_request_duration_seconds_bucket[5m]))` | > 2s |
| Platform maintenance mode | Loki alert on `maintenance_mode=true` config event | Any |

Route alerts via Grafana's notification policies to Slack/email/PagerDuty, or wire through
`xstockstrat-notify` via a Grafana webhook.

---

### Verification Checkpoint 7

```bash
# OTel Collector running
docker compose up -d otel-collector
docker compose logs otel-collector --tail=20
# Expect: "Everything is ready. Begin running and processing data."

# Smoke test pipeline
docker run --rm --network xstockstrat \
  ghcr.io/open-telemetry/opentelemetry-collector-contrib/telemetrygen:latest \
  traces --otlp-endpoint otel-collector:4317 --otlp-insecure --duration 5s
# Verify traces appear in Grafana Cloud → Explore → Tempo

# Per-service: start any instrumented service and verify OTLP data flows
docker compose up xstockstrat-config
# Make a GetConfig call, then check Grafana Cloud Loki and Tempo
# for service_name="xstockstrat-config"
```

---

### Environment Variable Reference

All OTel env vars follow the OpenTelemetry specification and are read automatically by each
SDK — no custom parsing required in service code.

| Variable | Example Value | Set In |
|---|---|---|
| `OTEL_ENABLED` | `true` | `.env`, docker-compose, DO app spec |
| `OTEL_SERVICE_NAME` | `xstockstrat-trading` | `.env`, docker-compose, DO app spec |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | `http://otel-collector:4317` (local) / Grafana Cloud URL (prod) | `.env`, DO secret |
| `OTEL_EXPORTER_OTLP_HEADERS` | `Authorization=Basic <token>` | `.env`, DO secret |
| `OTEL_RESOURCE_ATTRIBUTES` | `environment=dev,trading_mode=paper` | `.env`, docker-compose |

#### Config service keys to register

| Key | Type | Default | Description |
|---|---|---|---|
| `platform.otel.enabled` | bool | false | Master switch for OTEL export |
| `platform.otel.endpoint` | string | — | OTLP endpoint (set via secret) |
| `platform.otel.sample_rate` | float | 1.0 | Trace sample rate (0.0–1.0) |

---

### Rollback

OTel instrumentation is designed to be non-fatal:
- **Go**: `otelShutdown` returns an error but `main()` continues
- **Python**: `init()` catches exceptions and logs them; server still starts
- **Node.js**: `sdk.start()` errors are caught; app still starts

To disable without redeploying: set `OTEL_ENABLED=false` (or remove the var).
Config key `platform.otel.enabled=false` can be pushed via `xstockstrat-config`
for a live switch without a restart.

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
| **Observability** | All services | Structured JSON logs to stdout; OTel SDK + Grafana Cloud — see Phase 7 |

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
                    └─► Phase 7 (observability — apply incrementally per service as built)
```

**Critical path (serial)**: `config → ledger → marketdata → trading → trader UI`

**Parallelizable**:
- Phase 1B/1C/1D among themselves
- Phase 2A and 2B
- Phase 3A/3B/3C — but note: 3B (ingest) must reach `IngestSignal`/`QuerySignals` before 3A (indicators) and 3C (analysis) can implement signal-weighted formulas
- Phase 5A/5B/5C
- UI development (Phase 5) can begin alongside Phase 4
- Phase 7 instrumentation can be applied to each service as it reaches Verification Checkpoint

**Ingest dependency note**: ingest now has upstream DB requirements (its own `ingest` schema + `newsletter_signals` hypertable). Ensure `db-migrate.sh` runs the ingest migration (`002_newsletter_signals.sql`) before Phase 3B implementation begins. indicators and analysis gain a new upstream dependency on ingest for signal-aware execution.

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
| OTel Collector config | `packages/otel/otel-collector-config.yaml` |
| DO prod app spec | `.do/app.yaml` |
| DO dev app spec | `.do/app.dev.yaml` |
| Bootstrap script | `scripts/bootstrap.sh` |
| DB migration script | `scripts/db-migrate.sh` |
| Proto gen script | `scripts/buf-gen.sh` |
| Config rollout runbook | `_tasks/x-config-rollout.md` |
| Approval flow | `_tasks/x-approval-flow.md` |
