# Alpaca Account & API Key Setup

This runbook walks through creating an Alpaca account, generating API keys, and wiring credentials into the xstockstrat platform. Alpaca is the sole broker and market data provider for all trading operations.

---

## Overview

Two xstockstrat services integrate directly with Alpaca:

| Service | Language | Alpaca APIs Used | Purpose |
|---|---|---|---|
| `xstockstrat-marketdata` | Go, port 50053/8053 | Data API — REST + WebSocket | Historical bars, real-time quotes, streaming |
| `xstockstrat-trading` | Go, port 50051/8051 | Broker API — REST | Order placement, account info |
| `xstockstrat-ingest` | Python, port 50055/8055 | Data API — REST (read) | Context lookups during backfill |

**Alpaca endpoints:**

| Mode | Broker / Order API | Data API |
|---|---|---|
| Paper (dev) | `https://paper-api.alpaca.markets` | `https://data.alpaca.markets` |
| Live (prod) | `https://api.alpaca.markets` | `https://data.alpaca.markets` |

The Data API URL is the **same for both paper and live** — only the broker URL changes.

---

## Step 1 — Create an Alpaca Account

1. Go to **alpaca.markets** and click **Get Started**.
2. Choose **Individual** account (or Business if applicable).
3. Complete email verification.
4. You will land on the **Paper Trading Dashboard** by default — this is safe to use immediately with no funding required.

> **US residency note:** Live trading requires US residency and identity verification. Paper trading is available to everyone worldwide.

---

## Step 2 — Generate Paper Trading API Keys

Paper trading credentials are used in the dev environment and local dev setup. They are completely separate from live trading and carry no financial risk.

1. In the Alpaca dashboard, ensure you are on the **Paper Trading** environment (toggle at the top-right of the dashboard, or navigate to `app.alpaca.markets/paper-trading`)
2. Click **API Keys** in the left sidebar (or **Your API Keys** widget on the dashboard)
3. Click **Regenerate** (or **Generate** if no key exists)
4. Copy both values immediately — the secret is shown **only once**:

```
ALPACA_API_KEY=<Key ID>        # example: PKABCD1234EFGH5678
ALPACA_API_SECRET=<Secret Key> # example: abcd1234efgh5678ijkl9012mnop3456qrst7890
```

5. Store in your local `.env` file and in your password manager.

> If you lose the secret, you must regenerate the key pair. Regenerating invalidates the previous pair.

---

## Step 3 — Generate Live Trading API Keys

Live trading requires a funded account and identity verification. Only configure these in the production environment.

1. Complete identity verification in the Alpaca dashboard (**Account → Identity Verification**)
2. Fund your account (**Account → Banking → Deposit**)
3. Wait for account approval (usually same day for US residents)
4. Switch to the **Live Trading** environment using the toggle in the top-right
5. Navigate to **API Keys → Generate New Key**
6. Copy both values:

```
ALPACA_API_KEY=<Live Key ID>
ALPACA_API_SECRET=<Live Secret Key>
```

> **Critical:** Live API keys have real money access. Store them in your password manager and treat them like banking credentials. Never commit them to git. Never log them. Set them only as encrypted environment variables in DO App Platform.

---

## Step 4 — Verify Your Data Subscription

The xstockstrat-marketdata service streams real-time data. The subscription tier determines data quality:

| Tier | Data Feed | Latency | Coverage | Requirement |
|---|---|---|---|---|
| **Free** | IEX | ~15 min delayed | Limited symbols | Default for new accounts |
| **Unlimited** | SIP | Real-time | All US exchanges | Subscription required |

- For **paper trading and backtesting**: Free (IEX) is sufficient
- For **live trading**: Upgrade to the **Unlimited** plan for real-time SIP data

Check and upgrade: Alpaca dashboard → **Account → Subscription Plan**

Config keys that govern streaming behavior (set via xstockstrat-config):

```
marketdata.alpaca.paper               = true|false
marketdata.stream.reconnect_delay_ms  = 2000
marketdata.stream.max_reconnects      = 10
marketdata.backfill.batch_size        = 1000
marketdata.backfill.rate_limit_rps    = 200
```

---

## Step 5 — Local Dev Configuration

Add credentials to your local `.env` file (copy from `.env.example` if not done):

```bash
# Paper trading (dev)
ALPACA_API_KEY=<your-paper-key-id>
ALPACA_API_SECRET=<your-paper-secret-key>
ALPACA_PAPER=true
ALPACA_BASE_URL=https://paper-api.alpaca.markets
ALPACA_DATA_URL=https://data.alpaca.markets

# Broker URL variants (used by xstockstrat-trading)
ALPACA_PAPER_URL=https://paper-api.alpaca.markets
ALPACA_LIVE_URL=https://api.alpaca.markets
```

Docker Compose automatically injects these into the three Alpaca-consuming services:
- `xstockstrat-marketdata`
- `xstockstrat-trading`
- `xstockstrat-ingest`

Verify injection:

```bash
docker compose exec xstockstrat-marketdata env | grep ALPACA
docker compose exec xstockstrat-trading env | grep ALPACA
```

---

## Step 6 — Production Configuration (DO App Platform)

Set the live credentials as encrypted environment variables on the three Alpaca-consuming services. **Never set these as plain-text environment variables.**

Via the DO console:
1. **Apps → xstockstrat-prod → xstockstrat-trading → Settings → Environment Variables**
2. Add encrypted variables:
   - `ALPACA_API_KEY` = `<live-key-id>` (encrypted)
   - `ALPACA_API_SECRET` = `<live-secret-key>` (encrypted)

Repeat for `xstockstrat-marketdata` and `xstockstrat-ingest`.

Non-secret values are already set in `.do/app.yaml`:

```yaml
- key: ALPACA_PAPER
  value: "false"
- key: ALPACA_BASE_URL
  value: https://api.alpaca.markets
```

For `xstockstrat-trading`, the broker URL selection is controlled by `ALPACA_PAPER`:
- `ALPACA_PAPER=true` → service uses `ALPACA_PAPER_URL`
- `ALPACA_PAPER=false` → service uses `ALPACA_LIVE_URL`

---

## Step 7 — Runtime Mode via Config Service

The config service (`xstockstrat-config`) governs Alpaca behavior at runtime without requiring restarts. Set these keys via the Config UI (`http://localhost:3002`) or via webhook caller:

| Config Key | Type | Default | Description |
|---|---|---|---|
| `marketdata.alpaca.paper` | bool | `true` | Mirror of `ALPACA_PAPER` env var; controls paper vs live mode |
| `marketdata.stream.reconnect_delay_ms` | int | `2000` | Milliseconds to wait before reconnecting a dropped WebSocket |
| `marketdata.stream.max_reconnects` | int | `10` | Max consecutive reconnect attempts before raising an alert |
| `marketdata.backfill.batch_size` | int | `1000` | Number of bars per Alpaca API request during historical backfill |
| `marketdata.backfill.rate_limit_rps` | int | `200` | Max Alpaca API requests per second during backfill (Alpaca limit: 200 rps) |

> These keys are scoped by `environment` and `trading_mode`. Set `trading_mode=paper` for dev keys and `trading_mode=live` for prod keys.

---

## Step 8 — Verify Alpaca Connectivity

### Check market data connectivity

Trigger a small historical backfill via the webhook:

```bash
curl -X POST http://localhost:8053/webhooks/backfill \
  -H "x-webhook-secret: $N8N_WEBHOOK_SECRET" \
  -H "Content-Type: application/json" \
  -d '{
    "symbols": ["AAPL"],
    "timeframe": "15Min",
    "start": "2024-01-02",
    "end": "2024-01-02"
  }'
```

Expected response: `{"job_id": "<uuid>", "status": "started"}`

Check logs:

```bash
docker compose logs -f xstockstrat-marketdata
```

Expected output: lines showing bars fetched from Alpaca and stored in TimescaleDB.

### Check broker (trading) connectivity

Place a paper order via the `TradingService/PlaceOrder` Connect-RPC endpoint:

```bash
curl -X POST http://localhost:8051/xstockstrat.trading.v1.TradingService/PlaceOrder \
  -H "Content-Type: application/json" \
  -d '{
    "symbol": "AAPL",
    "side": "BUY",
    "qty": 1,
    "order_type": "MARKET",
    "strategy_id": "test-strategy",
    "user_id": "test-user"
  }'
```

Expected response: `{"order_id": "<alpaca-order-id>", "status": "ACCEPTED"}`

This places a real paper order on Alpaca. Confirm in the Alpaca paper trading dashboard under **Orders**.

> Note: The `/webhooks/n8n/place-order` endpoint has been deleted as part of feature-011. Use the Connect-RPC endpoint shown above instead.

### Check real-time stream

Subscribe to a symbol stream:

```bash
curl -X POST http://localhost:8053/webhooks/subscribe \
  -H "x-webhook-secret: $N8N_WEBHOOK_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"symbols": ["AAPL", "TSLA"], "timeframe": "15Min"}'
```

Check xstockstrat-marketdata logs for `"alpaca stream connected"` and incoming bar events.

---

## Step 9 — Historical Backfill

To populate the TimescaleDB OHLCV hypertable with historical data for backtesting, use the backfill trigger. See `docs/runbooks/historical-backfill.md` for full guidance.

Quick start:

```bash
curl -X POST http://localhost:8053/webhooks/backfill \
  -H "x-webhook-secret: $N8N_WEBHOOK_SECRET" \
  -H "Content-Type: application/json" \
  -d '{
    "symbols": ["AAPL", "MSFT", "TSLA", "NVDA", "AMZN"],
    "timeframe": "15Min",
    "start": "2023-01-01",
    "end": "2024-01-01"
  }'
```

**Rate limits:** Alpaca's data API allows up to 200 requests per second. `marketdata.backfill.rate_limit_rps=200` is the configured cap. Backfilling 1 year of 1-minute bars for 5 symbols takes approximately 15–20 minutes.

---

## Step 10 — Paper vs Live Mode Switching

The system enforces paper/live separation at multiple levels:

| Level | Paper | Live |
|---|---|---|
| `ALPACA_PAPER` env var | `true` | `false` |
| `ALPACA_BASE_URL` | `https://paper-api.alpaca.markets` | `https://api.alpaca.markets` |
| `TRADING_MODE` env var | `paper` | `live` |
| Config key `marketdata.alpaca.paper` | `true` | `false` |
| DO app spec file | `.do/app.dev.yaml` | `.do/app.yaml` |
| Git branch | `main-dev` | `main` |

**Never mix paper and live credentials in the same deployment.** The dev app uses paper credentials; the prod app uses live credentials.

To switch a running local dev stack from paper to live (rare, for testing):

1. Update `.env`: set `ALPACA_PAPER=false`, `ALPACA_BASE_URL=https://api.alpaca.markets`, and set live API keys
2. Update config service: set `marketdata.alpaca.paper=false` for `trading_mode=live`
3. Restart affected services: `docker compose restart xstockstrat-marketdata xstockstrat-trading`

---

## Troubleshooting

### `403 Forbidden` from Alpaca

API key is invalid, expired, or does not have sufficient permissions. Regenerate keys in the Alpaca dashboard. Confirm you are using paper keys against `paper-api.alpaca.markets` and live keys against `api.alpaca.markets` — they are not interchangeable.

### `401 Unauthorized` from Alpaca

The `ALPACA_API_KEY` or `ALPACA_API_SECRET` value is incorrect or contains extra whitespace. Verify by logging the length of each value at service startup (do not log the values themselves).

### WebSocket stream disconnects repeatedly

Check `marketdata.stream.max_reconnects` in the config service. If the reconnect count exceeds this value, xstockstrat-marketdata raises an alert to xstockstrat-notify and stops reconnecting. Reset by:

1. Setting `marketdata.stream.max_reconnects` to a higher value temporarily via Config UI
2. Restarting the marketdata service: `docker compose restart xstockstrat-marketdata`

Also check Alpaca's status page: **status.alpaca.markets** for ongoing incidents.

### Backfill rate limit exceeded

Reduce `marketdata.backfill.rate_limit_rps` below 200 (e.g., to 100) in the config service. Alpaca returns `429 Too Many Requests` when the rate limit is exceeded; the backfill job will retry with exponential backoff.

### No bars in TimescaleDB after backfill

1. Confirm the backfill job completed: check xstockstrat-marketdata logs for `"backfill complete"` or query xstockstrat-ledger for a `backfill.complete` event
2. Confirm the date range falls within market hours (Alpaca does not return bars for weekends or holidays)
3. Confirm the symbol is valid: check Alpaca's asset list endpoint
4. With a free (IEX) subscription, some symbols may have incomplete data — upgrade to Unlimited for full coverage
