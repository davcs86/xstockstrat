# _tasks/x-add-data-source.md
# xstockstrat — Adding Data Sources & Signal Feeds

## Overview

This runbook covers two classes of data sources that can be added to the platform:

| Source class | What it provides | Primary service | Storage |
|---|---|---|---|
| **Market data source** | OHLCV bars, quotes (e.g. Polygon, Tiingo, Yahoo Finance) | `xstockstrat-marketdata` | `marketdata.ohlcv`, `marketdata.quotes` |
| **Newsletter / signal source** | Directional signals with time windows (e.g. Unusual Whales, MarketWatch, Dividendology, Pure Power Picks, Simply Wall St.) | `xstockstrat-ingest` | `ingest.newsletter_signals` (new table) |

Both source types ultimately strengthen the indicator and analysis pipeline. The `source` column already exists in the OHLCV/quotes tables and `source` fields exist in all relevant proto messages — the schema is source-aware from day one.

---

## Architecture

```
Newsletter / Signal feeds                 Market data feeds (REST/stream)
(Unusual Whales, MarketWatch, etc.)       (Polygon, Tiingo, Yahoo Finance, etc.)
        │                                          │
        ▼                                          ▼
  n8n Cloud / manual upload              xstockstrat-marketdata
  POST /webhooks/n8n/ingest-signal       (new source client, mirrors alpaca/)
        │                                          │
        ▼                                          ▼
  xstockstrat-ingest                     TimescaleDB: marketdata.ohlcv
  IngestSignal RPC → normalize                     │
        │                                          │
        ▼                                          ▼
  TimescaleDB: ingest.newsletter_signals  ←─── source column = "polygon" etc.
        │
        ▼
  xstockstrat-indicators  (ExecuteFormula: receives newsletter_signals in input_data)
        │
        ▼
  xstockstrat-analysis  (ScoreStrategy / RunBacktest: weights signals alongside OHLCV)
        │
        ▼
  xstockstrat-trading  (order execution with signal-informed decisions)
```

---

---

# Part 1 — Adding a Market Data Source (OHLCV)

Use this path for providers that deliver OHLCV bars and/or quotes via REST API or WebSocket stream (e.g. Polygon.io, Tiingo, Yahoo Finance, Interactive Brokers, Quandl).

## Step 1 — Register Config Keys

All source credentials and tuning parameters must live in `xstockstrat-config`, never hardcoded. Register the following keys via the Config UI at `http://localhost:3002`:

| Key | Type | Example | Scope |
|---|---|---|---|
| `marketdata.<source>.enabled` | bool | `true` | all |
| `marketdata.<source>.base_url` | string | `https://api.polygon.io` | all |
| `marketdata.<source>.rate_limit_rps` | int | `100` | all |
| `marketdata.<source>.backfill.batch_size` | int | `500` | all |
| `secret.marketdata.<source>.api_key` | string | _(resolved from secret store)_ | all |

Replace `<source>` with the lowercase provider identifier, e.g. `polygon`, `tiingo`, `yahoo`.

> **Naming rule**: `<service-short-name>.<source>.<key>` — consistent with the global config key convention.

## Step 2 — Implement the Source Client (Go)

Create a new package mirroring `internal/alpaca/`:

```
services/xstockstrat-marketdata/internal/<source>/
    client.go       ← HTTP client + API credentials
    models.go       ← provider-specific response structs
    client_test.go  ← unit tests with mocked HTTP
```

**`client.go` must implement this interface** (match the pattern in `internal/alpaca/client.go`):

```go
type Client interface {
    GetBars(ctx context.Context, symbol, timeframe string, start, end time.Time) ([]Bar, error)
    GetLatestQuote(ctx context.Context, symbol string) (*Quote, error)
    ListAssets(ctx context.Context, assetClass string) ([]Asset, error)
    StreamBars(ctx context.Context, symbols []string, timeframe string) (<-chan Bar, error)
    StreamQuotes(ctx context.Context, symbols []string) (<-chan Quote, error)
}
```

Set `source` to the provider identifier on every `Bar` and `Quote` you construct:

```go
bars = append(bars, Bar{
    Symbol:    symbol,
    Time:      parsedTime,
    Open:      row.Open,
    // ...
    Source:    "polygon",   // ← always set this
})
```

## Step 3 — Register the Client at Startup

In `cmd/server/main.go`, after config is loaded, initialize and register the new client alongside the existing Alpaca client:

```go
// After config watcher resolves
if cfg.PolygonEnabled {
    polygonClient := polygon.NewClient(polygon.ClientConfig{
        APIKey:  cfg.PolygonAPIKey,   // from secret store via config watcher
        BaseURL: cfg.PolygonBaseURL,
        RPS:     cfg.PolygonRateLimitRPS,
    })
    sourceRegistry.Register("polygon", polygonClient)
}
```

## Step 4 — Route by Source in the Service Layer

In `internal/service/marketdata_service.go`, use the source registry to dispatch backfill and streaming calls:

```go
func (s *MarketDataService) BackfillBars(ctx context.Context, req *BackfillBarsRequest) (*BackfillBarsResponse, error) {
    client := s.sources.Get(req.Source) // defaults to "alpaca" if empty
    bars, err := client.GetBars(ctx, req.Symbol, req.Timeframe, req.Start, req.End)
    // ... store to DB with source value preserved
}
```

> **No DB migration needed** — `marketdata.ohlcv` and `marketdata.quotes` already have a `source TEXT NOT NULL DEFAULT 'alpaca'` column. Simply write the correct value.

## Step 5 — No Proto Changes Needed

`Bar.source` (field 11) and `Quote.source` (field 7) already exist in `packages/proto/marketdata/v1/marketdata.proto`. No proto PR required.

## Step 6 — Emit Ledger Events

Mirror the existing Alpaca event names with the new source identifier:

| Event type | When |
|---|---|
| `marketdata.feed.connected` | Stream connected, payload: `{"source": "polygon"}` |
| `marketdata.feed.disconnected` | Stream dropped |
| `marketdata.backfill.started` | Backfill begins, payload: `{"source": "polygon", "symbols": [...]}` |
| `marketdata.backfill.completed` | Backfill done |
| `marketdata.backfill.failed` | Backfill error |

## Step 7 — n8n Webhook (optional)

If you want n8n to trigger backfills for the new source, add the `source` field to the existing webhook handler at `POST /webhooks/n8n/backfill`:

```json
POST http://xstockstrat-marketdata:8053/webhooks/n8n/backfill
{
  "symbols": ["AAPL", "MSFT"],
  "timeframe": "1d",
  "start": "2024-01-01T00:00:00Z",
  "end": "2024-12-31T00:00:00Z",
  "source": "polygon"
}
```

## Step 8 — Verify

```sql
-- Confirm bars landed with the correct source value
SELECT source, COUNT(*), MIN(time), MAX(time)
FROM marketdata.ohlcv
WHERE symbol = 'AAPL' AND timeframe = '1d'
GROUP BY source
ORDER BY source;
```

```bash
# grpcurl: get bars from a specific source (filter in application layer for now)
grpcurl -plaintext -d '{
  "symbol": "AAPL",
  "timeframe": "1d",
  "range": {"start": "...", "end": "..."}
}' xstockstrat-marketdata:50053 xstockstrat.marketdata.v1.MarketDataService/GetBars
```

---

---

# Part 2 — Adding a Newsletter / Signal Source

Use this path for curated signal feeds that publish **directional recommendations with a time window**: Unusual Whales, MarketWatch, Dividendology, Pure Power Picks, Simply Wall St., and similar services.

These are not OHLCV feeds. They produce structured signals such as:

> _"Unusual Whales: BUY $NVDA — large call sweep detected, valid 2–10 trading days"_
> _"Dividendology: WATCHLIST $VZ — upcoming ex-dividend date, yield >6%, valid through 2024-11-15"_
> _"Pure Power Picks: SELL $TSLA — momentum reversal signal, 5-day window"_

## Signal Data Model

Each ingested signal is stored in a new `ingest.newsletter_signals` hypertable with this schema:

| Column | Type | Description |
|---|---|---|
| `id` | BIGSERIAL | Surrogate key |
| `ingested_at` | TIMESTAMPTZ | When the platform received the signal |
| `source` | TEXT | Provider identifier: `unusual_whales`, `marketwatch`, `dividendology`, `pure_power_picks`, `simply_wall_st` |
| `symbol` | TEXT | Ticker (e.g. `AAPL`, `NVDA`) |
| `direction` | TEXT | `buy` / `sell` / `hold` / `watchlist` |
| `conviction` | NUMERIC(4,3) | 0.000–1.000 confidence score (if extractable from the source; otherwise `NULL`) |
| `valid_from` | TIMESTAMPTZ | Start of the actionable window |
| `valid_until` | TIMESTAMPTZ | End of the actionable window (`NULL` = open-ended) |
| `headline` | TEXT | Human-readable signal description |
| `raw_url` | TEXT | Link to the original newsletter item |
| `tags` | TEXT[] | Optional labels: `earnings`, `unusual_options`, `dividend`, `momentum`, `reversal`, etc. |

## Step 1 — Add the `newsletter_signals` Migration

Create the migration file in the **ingest service** (Python, db-migrate):

```sql
-- services/xstockstrat-ingest/migrations/002_newsletter_signals.sql

CREATE SCHEMA IF NOT EXISTS ingest;

CREATE TABLE ingest.newsletter_signals (
    id              BIGSERIAL,
    ingested_at     TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    source          TEXT            NOT NULL,
    symbol          TEXT            NOT NULL,
    direction       TEXT            NOT NULL CHECK (direction IN ('buy','sell','hold','watchlist')),
    conviction      NUMERIC(4,3)    CHECK (conviction BETWEEN 0 AND 1),
    valid_from      TIMESTAMPTZ     NOT NULL,
    valid_until     TIMESTAMPTZ,
    headline        TEXT,
    raw_url         TEXT,
    tags            TEXT[]          NOT NULL DEFAULT '{}',
    PRIMARY KEY (id, ingested_at)
);

SELECT create_hypertable('ingest.newsletter_signals', 'ingested_at', chunk_time_interval => INTERVAL '7 days');

CREATE INDEX ON ingest.newsletter_signals (symbol, ingested_at DESC);
CREATE INDEX ON ingest.newsletter_signals (source, ingested_at DESC);
CREATE INDEX ON ingest.newsletter_signals (valid_from, valid_until);
```

Run via:
```bash
./scripts/db-migrate.sh xstockstrat-ingest
```

## Step 2 — Add the Proto Contract

Add a new `IngestSignal` RPC and `ExternalSignal` message to `packages/proto/ingest/v1/ingest.proto`:

> **Proto governance**: This is a new, non-breaking addition (new RPC + new messages). Requires 1 service owner approval before merging. Run `buf lint` and `buf breaking --against '.git#branch=main'` in CI.

```protobuf
// In packages/proto/ingest/v1/ingest.proto — add to IngestService:
service IngestService {
  // ... existing RPCs ...
  rpc IngestSignal(IngestSignalRequest) returns (IngestSignalResponse);
  rpc QuerySignals(QuerySignalsRequest) returns (QuerySignalsResponse);
}

message ExternalSignal {
  string source     = 1;   // "unusual_whales" | "marketwatch" | "dividendology" | "pure_power_picks" | "simply_wall_st"
  string symbol     = 2;   // ticker
  string direction  = 3;   // "buy" | "sell" | "hold" | "watchlist"
  double conviction = 4;   // 0.0 – 1.0 (0.0 if not provided by source)
  google.protobuf.Timestamp valid_from  = 5;
  google.protobuf.Timestamp valid_until = 6;  // omit for open-ended
  string headline   = 7;
  string raw_url    = 8;
  repeated string tags = 9;
}

message IngestSignalRequest {
  ExternalSignal signal = 1;
}

message IngestSignalResponse {
  int64 signal_id = 1;
}

message QuerySignalsRequest {
  string source   = 1;  // optional filter
  string symbol   = 2;  // optional filter
  string direction = 3; // optional filter
  xstockstrat.common.v1.TimeRange active_window = 4; // signals valid within this range
  xstockstrat.common.v1.PageRequest page = 5;
}

message QuerySignalsResponse {
  repeated ExternalSignal signals = 1;
  xstockstrat.common.v1.PageResponse page = 2;
}
```

After the proto PR is merged, regenerate stubs:
```bash
cd packages/proto && buf generate
```

## Step 3 — Implement the `IngestSignal` RPC (Python)

Add to `services/xstockstrat-ingest/app/handlers/servicer.py`:

```python
async def IngestSignal(self, request, context):
    signal = request.signal
    signal_id = await self.signals_repo.insert(
        source=signal.source,
        symbol=signal.symbol.upper(),
        direction=signal.direction,
        conviction=signal.conviction or None,
        valid_from=signal.valid_from.ToDatetime(tzinfo=timezone.utc),
        valid_until=signal.valid_until.ToDatetime(tzinfo=timezone.utc) if signal.HasField("valid_until") else None,
        headline=signal.headline,
        raw_url=signal.raw_url,
        tags=list(signal.tags),
    )
    await self.ledger.emit("ingest.signal.ingested", {
        "signal_id": signal_id,
        "source": signal.source,
        "symbol": signal.symbol,
        "direction": signal.direction,
    })
    return IngestSignalResponse(signal_id=signal_id)
```

## Step 4 — Register Config Keys for Each Newsletter Source

In `xstockstrat-config` (via Config UI at `http://localhost:3002`):

| Key | Type | Default | Description |
|---|---|---|---|
| `ingest.signals.<source>.enabled` | bool | `false` | Toggle ingestion for this source |
| `ingest.signals.<source>.default_window_days` | int | `5` | Default `valid_until` if source doesn't provide one |
| `ingest.signals.<source>.default_conviction` | float | `0.5` | Default conviction score if not provided |
| `ingest.signals.dedup_window_hours` | int | `24` | Skip re-ingesting the same symbol+source+direction within this window |

Replace `<source>` with: `unusual_whales`, `marketwatch`, `dividendology`, `pure_power_picks`, `simply_wall_st`.

## Step 5 — Add the n8n Webhook Endpoint

Add to `services/xstockstrat-ingest/app/http_server.py`:

```python
@router.post("/webhooks/n8n/ingest-signal")
async def ingest_signal_webhook(body: dict):
    """
    n8n calls this endpoint after parsing a newsletter signal.
    Expected payload:
    {
      "source": "unusual_whales",
      "symbol": "NVDA",
      "direction": "buy",
      "conviction": 0.8,           // optional
      "valid_from": "2024-11-01T00:00:00Z",
      "valid_until": "2024-11-10T00:00:00Z",  // optional
      "headline": "Large call sweep detected on NVDA",
      "raw_url": "https://unusualwhales.com/...",
      "tags": ["unusual_options", "large_sweep"]
    }
    """
    # validate and call IngestSignal gRPC
    ...
```

## Step 6 — Wire n8n to Each Newsletter Source

Each newsletter source requires its own n8n workflow. The ingestion pattern depends on how you receive the newsletter:

### Option A — Email parsing (most common)
```
n8n: Email trigger (IMAP / Gmail)
  → Extract body text
  → HTTP Request: POST https://your-llm-api/parse-signal
      body: { "text": "{{email body}}", "source": "unusual_whales" }
  → HTTP Request: POST http://xstockstrat-ingest:8055/webhooks/n8n/ingest-signal
      body: { "source": "unusual_whales", "symbol": "{{parsed_symbol}}", ... }
```

### Option B — RSS / Atom feed monitoring
```
n8n: RSS Feed trigger (poll every 15 minutes)
  → Filter: new items only
  → Code node: extract symbol, direction, tags from title/description
  → HTTP Request: POST http://xstockstrat-ingest:8055/webhooks/n8n/ingest-signal
```

### Option C — Manual CSV upload
```python
# Use NormalizeRawData RPC with a custom CSV format
# CSV columns: source,symbol,direction,conviction,valid_from,valid_until,headline,raw_url,tags
import grpc
from gen.ingest.v1 import ingest_pb2, ingest_pb2_grpc

channel = grpc.insecure_channel('xstockstrat-ingest:50055')
stub = ingest_pb2_grpc.IngestServiceStub(channel)

with open('signals.csv', 'rb') as f:
    resp = stub.NormalizeRawData(ingest_pb2.NormalizeRawDataRequest(
        source="marketwatch",
        raw_data=f.read(),
        format="newsletter_signals_csv",  # new format enum value
    ))
print(f"Rows normalized: {resp.rows_normalized}, errors: {resp.errors}")
```

> To support `newsletter_signals_csv`, add this format value to the `format` field enum/documentation in the proto and implement the corresponding normalizer in `servicer.py`.

### Provider-Specific Parsing Notes

| Source | Signal style | Key fields to extract | Suggested tags |
|---|---|---|---|
| **Unusual Whales** | Options flow sweeps, dark pool prints | symbol, sweep direction (call/put → buy/sell), expiry | `unusual_options`, `dark_pool`, `call_sweep`, `put_sweep` |
| **MarketWatch** | Analyst upgrades/downgrades, news-driven | symbol, rating change (upgrade/downgrade → buy/sell), analyst firm | `analyst`, `upgrade`, `downgrade`, `news` |
| **Dividendology** | Dividend opportunity alerts | symbol, direction usually `watchlist` or `buy`, ex-dividend date as `valid_until` | `dividend`, `income`, `yield` |
| **Pure Power Picks** | Momentum/swing trade picks | symbol, direction, specific entry window | `momentum`, `swing`, `power_pick` |
| **Simply Wall St.** | Fundamental scoring / fair value signals | symbol, over/undervalued → `buy`/`sell`, target price window | `fundamental`, `fair_value`, `valuation` |

---

---

# Part 3 — Using Signal Sources in Indicators & Analysis

Once signals are in `ingest.newsletter_signals`, downstream services consume them to produce stronger composite signals.

## Querying Active Signals in a Custom Indicator Formula

The `xstockstrat-indicators` service runs sandboxed Python formulas via `ExecuteFormula`. Pass newsletter signals into the formula via the `input_data` struct:

```python
# Caller code (e.g. from xstockstrat-analysis or a strategy)
import grpc
from gen.ingest.v1 import ingest_pb2, ingest_pb2_grpc
from gen.indicators.v1 import indicators_pb2, indicators_pb2_grpc
from google.protobuf import struct_pb2
from datetime import datetime, timezone, timedelta

ingest_channel = grpc.insecure_channel('xstockstrat-ingest:50055')
ingest_stub = ingest_pb2_grpc.IngestServiceStub(ingest_channel)

# 1. Fetch active signals for the symbol
signals_resp = ingest_stub.QuerySignals(ingest_pb2.QuerySignalsRequest(
    symbol="NVDA",
    active_window=common_pb2.TimeRange(
        start=ts(datetime.now(timezone.utc) - timedelta(days=1)),
        end=ts(datetime.now(timezone.utc) + timedelta(days=10)),
    ),
))

# 2. Build input_data for the formula
signal_list = [
    {
        "source": s.source,
        "direction": s.direction,
        "conviction": s.conviction,
        "tags": list(s.tags),
    }
    for s in signals_resp.signals
]
input_data = struct_pb2.Struct()
input_data.update({
    "ohlcv": [...],           # fetched from marketdata service
    "newsletter_signals": signal_list,
    "symbol": "NVDA",
})

# 3. Execute the composite formula
indicators_channel = grpc.insecure_channel('xstockstrat-indicators:50054')
ind_stub = indicators_pb2_grpc.IndicatorsServiceStub(indicators_channel)

result = ind_stub.ExecuteFormula(indicators_pb2.ExecuteFormulaRequest(
    formula_id="composite_signal_v1",  # registered formula
    input_data=input_data,
))
```

## Example Composite Formula (Python, sandboxed)

Register this as a formula via `RegisterFormula` RPC, then reference by `formula_id`:

```python
# formula source — executes inside indicators sandbox
import json

ohlcv = data["ohlcv"]           # list of {time, open, high, low, close, volume}
signals = data.get("newsletter_signals", [])

# --- Technical component ---
closes = [bar["close"] for bar in ohlcv]
sma_20 = sum(closes[-20:]) / 20 if len(closes) >= 20 else closes[-1]
technical_score = 1.0 if closes[-1] > sma_20 else -1.0

# --- Newsletter signal component ---
signal_score = 0.0
for sig in signals:
    weight = sig.get("conviction", 0.5)
    if sig["direction"] == "buy":
        signal_score += weight
    elif sig["direction"] == "sell":
        signal_score -= weight
    # "watchlist" / "hold" contribute 0

signal_score = max(-1.0, min(1.0, signal_score))

# --- Composite: 60% technical, 40% newsletter signals ---
composite = (0.6 * technical_score) + (0.4 * signal_score)

output = {
    "composite_score": composite,
    "technical_score": technical_score,
    "signal_score": signal_score,
    "active_signal_count": len(signals),
    "recommendation": "buy" if composite > 0.3 else "sell" if composite < -0.3 else "hold",
}
```

## Backtesting with Newsletter Signals

`xstockstrat-analysis` `RunBacktest` accepts `strategy_params` as a `google.protobuf.Struct`. Pass signal source configuration there:

```python
from gen.analysis.v1 import analysis_pb2, analysis_pb2_grpc

analysis_channel = grpc.insecure_channel('xstockstrat-analysis:50056')
stub = analysis_pb2_grpc.AnalysisServiceStub(analysis_channel)

result = stub.RunBacktest(analysis_pb2.RunBacktestRequest(
    strategy_id="composite_newsletter_strategy",
    symbols=["NVDA", "AAPL", "MSFT"],
    initial_capital=100000.0,
    range=common_pb2.TimeRange(start=ts(...), end=ts(...)),
    strategy_params=struct_pb2.Struct(fields={
        "signal_sources": struct_pb2.Value(list_value=struct_pb2.ListValue(values=[
            struct_pb2.Value(string_value="unusual_whales"),
            struct_pb2.Value(string_value="pure_power_picks"),
        ])),
        "signal_weight": struct_pb2.Value(number_value=0.4),
        "technical_weight": struct_pb2.Value(number_value=0.6),
        "min_conviction": struct_pb2.Value(number_value=0.6),
    }),
))
print(f"Total return: {result.total_return:.2%}")
print(f"Sharpe ratio: {result.sharpe_ratio:.2f}")
print(f"Win rate: {result.win_rate:.2%}")
```

---

---

# Verification Checklist

## Market data source (OHLCV)
- [ ] Config keys registered in `xstockstrat-config` for new source
- [ ] Source client returns bars with correct `source` value set
- [ ] `marketdata.ohlcv` rows show new source: `SELECT DISTINCT source FROM marketdata.ohlcv;`
- [ ] Ledger events emitted with new source identifier
- [ ] `GetBars` RPC returns bars for new source
- [ ] Continuous aggregate `ohlcv_1h` refreshed if backfilling historical data

## Newsletter / signal source
- [ ] Migration `002_newsletter_signals.sql` applied: `SELECT COUNT(*) FROM ingest.newsletter_signals;`
- [ ] Proto stubs regenerated: `cd packages/proto && buf generate`
- [ ] `IngestSignal` RPC accepts and stores a test signal:
  ```python
  # Quick smoke test
  stub.IngestSignal(IngestSignalRequest(signal=ExternalSignal(
      source="unusual_whales", symbol="NVDA", direction="buy",
      conviction=0.8, valid_from=now, headline="Test signal",
  )))
  ```
- [ ] `QuerySignals` returns the stored signal filtered by symbol and active window
- [ ] Ledger event `ingest.signal.ingested` appears in ledger stream
- [ ] n8n workflow can POST to `/webhooks/n8n/ingest-signal` and receive 200
- [ ] Composite formula `ExecuteFormula` returns `active_signal_count > 0` for a symbol with active signals

## Signal weighting in analysis
- [ ] `RunBacktest` with `signal_sources` param runs without error
- [ ] `strategy_params.signal_weight` is respected in formula output
- [ ] Signals with `conviction < min_conviction` are excluded from scoring

---

# Related Runbooks

| Runbook | When to use |
|---|---|
| [`x-historical-backfill.md`](x-historical-backfill.md) | Backfill OHLCV bars from Alpaca (or new source after client is wired) |
| [`x-approval-flow.md`](x-approval-flow.md) | Proto change approval process for new `IngestSignal` RPC |
| [`x-config-rollout.md`](x-config-rollout.md) | Registering new config keys via xstockstrat-config |
| [`x-indicator-builder.md`](x-indicator-builder.md) | Building and registering composite indicator formulas |

---

## Signal Source Log

Track registered sources here after setup is complete.

| Date added | Source | Type | n8n workflow | Owner |
|---|---|---|---|---|
| — | — | — | — | — |
