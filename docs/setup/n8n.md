# n8n Cloud Account & Workflow Setup

This runbook walks through creating an n8n Cloud account, importing the pre-built xstockstrat workflows, configuring credentials, and connecting them to the deployed services. n8n is the automation layer that bridges external events (newsletters, RSS feeds, scheduled triggers) to the service webhook handlers.

---

## Overview

```
External Event (email, RSS, manual)
        │
        ▼
  n8n Cloud (trigger node)
        │
        ▼ HTTP POST + x-webhook-secret header
  Service /webhooks/n8n/<action>  (port 80XX)
        │
        ▼ internal gRPC call
  Service implementation
        │
        ├─► TimescaleDB
        ├─► xstockstrat-ledger (event write)
        └─► xstockstrat-notify (alert)
```

**Pre-built workflows** (in `packages/n8n/workflows/`):

| File | Trigger | Target Service | Purpose |
|---|---|---|---|
| `config-update.json` | Webhook POST | xstockstrat-config `:8060` | Update a config key/value |
| `place-order.json` | Webhook POST | xstockstrat-trading `:8051` | Place an order from external signal |
| `emit-alert.json` | Webhook POST | xstockstrat-notify `:8059` | Emit a risk or system alert |
| `ledger-query-events.json` | Manual | xstockstrat-ledger `:8057` | Query/replay ledger events for audit |
| `ingest-signal-email.json` | IMAP email poll | xstockstrat-ingest `:8055` | Parse newsletter emails → signals |
| `ingest-signal-rss.json` | RSS feed trigger | xstockstrat-ingest `:8055` | Parse RSS items → signals |
| `ingest-signal-csv.json` | Manual | xstockstrat-ingest `:8055` | Bulk-ingest signals from CSV |

**Auth:** All service webhook handlers check the `x-webhook-secret` HTTP header against `N8N_WEBHOOK_SECRET`. This must match the value set on the services.

---

## Step 1 — Create an n8n Cloud Account

1. Go to **n8n.io** and click **Get started for free**.
2. Sign up with email or GitHub.
3. Select the **Starter** plan (free tier) — it supports:
   - Up to 5 active workflows
   - 2,500 workflow executions per month
   - All node types including IMAP, RSS, and HTTP Request

> Upgrade to **Pro** if you add more newsletter sources (each source is a separate workflow) or need more executions per month.

---

## Step 2 — Create a New n8n Instance

1. After signup, n8n prompts you to create your first instance.
2. Choose a **region** close to your DigitalOcean deployment. If your DO app is in `nyc`, choose the US East region.
3. Your instance URL will be: `https://<your-org>.app.n8n.cloud`
4. Set an admin email and password.

---

## Step 3 — Import the Pre-Built Workflows

You will import all 7 workflow files from `packages/n8n/workflows/`.

### Option A: Import via UI (recommended for initial setup)

For each workflow file:

1. n8n → **Workflows** (left sidebar)
2. Click **+ Add workflow** → **Import from file**
3. Navigate to and select the `.json` file
4. Click **Save** (do NOT activate yet — credentials must be configured first)

Import order (recommended):

1. `config-update.json`
2. `place-order.json`
3. `emit-alert.json`
4. `ledger-query-events.json`
5. `ingest-signal-email.json`
6. `ingest-signal-rss.json`
7. `ingest-signal-csv.json`

### Option B: Import via CLI

If you have the n8n CLI installed (`npm install -g n8n`):

```bash
for f in packages/n8n/workflows/*.json; do
  n8n import:workflow --input="$f"
done
```

---

## Step 4 — Create Credentials

Credentials are shared across workflows. Create them once and assign them to each relevant workflow.

### 4a. Header Auth (webhook secret) — required by all webhook-triggered workflows

1. n8n → **Settings** (bottom-left gear icon) → **Credentials**
2. Click **+ Add credential**
3. Search for and select **Header Auth**
4. Configure:
   - **Name:** `xstockstrat-webhook-secret`
   - **Name** (header field): `x-webhook-secret`
   - **Value:** the value of `N8N_WEBHOOK_SECRET` from your `.env` file (e.g., `abc123...`)
5. Click **Save**

> Make sure `N8N_WEBHOOK_SECRET` in your `.env` (and in DO App Platform) matches this value exactly.

### 4b. IMAP Credential — required by `ingest-signal-email.json`

Create a dedicated email address for newsletter monitoring (e.g., `newsletters@yourdomain.com`) and configure IMAP:

1. n8n → **Settings → Credentials → + Add credential**
2. Search for and select **IMAP**
3. Configure:

   **Gmail:**
   - Host: `imap.gmail.com`
   - Port: `993`
   - SSL/TLS: enabled
   - User: `your-email@gmail.com`
   - Password: [Google App Password](https://myaccount.google.com/apppasswords) (not your regular password — 2FA must be enabled)

   **Other providers:**
   - Host: your provider's IMAP host
   - Port: `993` (TLS) or `143` (STARTTLS)
   - User: full email address
   - Password: email account password or app password

4. **Name:** `xstockstrat-newsletter-imap`
5. Click **Save**

> **Gmail users:** Regular password authentication is disabled for IMAP. You must use an [App Password](https://myaccount.google.com/apppasswords): Google Account → Security → 2-Step Verification → App passwords → create one for "Mail".

---

## Step 5 — Update Service URLs in Each Workflow

The imported workflows reference service hostnames from the Docker network (e.g., `http://xstockstrat-config:8060`). You must update these to match your actual deployment target.

### For local dev (port-forwarded from Docker Compose)

| Service | URL to use |
|---|---|
| xstockstrat-config | `http://localhost:8060` |
| xstockstrat-trading | `http://localhost:8051` |
| xstockstrat-portfolio | `http://localhost:8052` |
| xstockstrat-marketdata | `http://localhost:8053` |
| xstockstrat-indicators | `http://localhost:8054` |
| xstockstrat-ingest | `http://localhost:8055` |
| xstockstrat-analysis | `http://localhost:8056` |
| xstockstrat-ledger | `http://localhost:8057` |
| xstockstrat-identity | `http://localhost:8058` |
| xstockstrat-notify | `http://localhost:8059` |

> n8n Cloud cannot reach `localhost` directly. For local dev testing, you must use a tunnel tool (e.g., `ngrok http 8060`) or run n8n locally via Docker Compose.

### For DO App Platform (production / dev app)

Get each service's public URL from the DO console:

1. **DigitalOcean → Apps → xstockstrat-prod (or dev) → select service component → URL**
2. It looks like: `https://xstockstrat-config-<random>.ondigitalocean.app`

Update each workflow's **HTTP Request** node URL to the corresponding public URL.

**To update a workflow URL:**

1. Open the workflow
2. Click on the **HTTP Request** node
3. Update the **URL** field
4. Save the workflow

---

## Step 6 — Assign Credentials to Workflows

For each workflow, assign the appropriate credentials:

### Webhook-triggered workflows (config-update, place-order, emit-alert, ledger-query-events, ingest-signal-csv)

In each workflow:
1. Click the **HTTP Request** node (the node that calls the service)
2. Under **Authentication** → select **Header Auth**
3. Select the `xstockstrat-webhook-secret` credential created in Step 4a
4. Save

### Email signal workflow (ingest-signal-email)

1. Click the **Email Trigger (IMAP)** node
2. Select the `xstockstrat-newsletter-imap` credential from Step 4b
3. Also assign `xstockstrat-webhook-secret` to the **HTTP Request** node
4. Save

### RSS signal workflow (ingest-signal-rss)

1. Click the **RSS Feed Trigger** node — no credential needed (RSS is public)
2. Assign `xstockstrat-webhook-secret` to the **HTTP Request** node
3. Save

---

## Step 7 — Activate Workflows

Only activate a workflow after credentials and URLs are configured:

1. Open each workflow
2. Toggle the **Active** switch (top-right of the workflow editor) to **ON**
3. Confirm activation in the dialog

**Activation behavior:**

- **Webhook-triggered workflows** — n8n generates a public webhook URL (shown in the Webhook node). External systems POST to this URL to trigger the workflow.
- **IMAP workflow** — n8n polls the configured inbox on the specified interval (default: every 1 minute)
- **RSS workflow** — n8n polls the RSS feed URL on the configured interval (default: every 5 minutes)
- **Manual workflows** (`ledger-query-events`, `ingest-signal-csv`) — activated but only run on manual execution

---

## Step 8 — Test Each Workflow

### Test `config-update` workflow

1. Open the workflow in n8n
2. Click **Test workflow**
3. n8n will show you the test webhook URL
4. Run:
   ```bash
   curl -X POST <test-webhook-url> \
     -H "Content-Type: application/json" \
     -d '{
       "namespace": "platform",
       "key": "log_level",
       "value": "debug",
       "author": "n8n-test",
       "reason": "testing n8n setup",
       "environment": "dev",
       "trading_mode": "paper"
     }'
   ```
5. Verify: xstockstrat-config logs show the key was updated; xstockstrat-config-ui (`http://localhost:3002`) shows `platform.log_level = debug`

### Test `place-order` workflow

```bash
curl -X POST <test-webhook-url> \
  -H "Content-Type: application/json" \
  -d '{
    "symbol": "AAPL",
    "side": "buy",
    "qty": 1,
    "order_type": "market",
    "strategy_id": "n8n-test",
    "user_id": "test-user"
  }'
```

Verify: order appears in xstockstrat-trader UI and in the Alpaca paper trading dashboard.

### Test `emit-alert` workflow

```bash
curl -X POST <test-webhook-url> \
  -H "Content-Type: application/json" \
  -d '{
    "severity": "warning",
    "category": "system",
    "title": "n8n test alert",
    "body": "Testing n8n → notify integration",
    "source_service": "n8n",
    "target_user_id": "test-user",
    "tags": ["test"],
    "context": {}
  }'
```

Verify: alert appears in xstockstrat-trader UI alert panel.

### Test `ingest-signal-email` workflow

Send a test email to the configured IMAP account with a subject and body matching your newsletter format. Trigger manually in n8n or wait for the next poll interval. Verify xstockstrat-ingest logs show a signal ingested.

---

## Step 9 — Webhook Endpoint Reference

Full reference of all service webhook endpoints called by n8n workflows:

### xstockstrat-config (`:8060`)

| Endpoint | Method | Payload fields |
|---|---|---|
| `/webhooks/n8n/set-config` | POST | `namespace`, `key`, `value`, `author`, `reason`, `environment`, `trading_mode` |
| `/webhooks/n8n/rollout` | POST | `changes[]` (array of set-config payloads), `author`, `reason` |
| `/webhooks/n8n/list-keys` | POST | `namespace` |

### xstockstrat-trading (`:8051`)

| Endpoint | Method | Payload fields |
|---|---|---|
| `/webhooks/n8n/place-order` | POST | `symbol`, `side` (buy/sell), `qty`, `order_type` (market/limit), `limit_price`?, `strategy_id`, `user_id` |
| `/webhooks/n8n/cancel-order` | POST | `order_id`, `user_id` |

### xstockstrat-marketdata (`:8053`)

| Endpoint | Method | Payload fields |
|---|---|---|
| `/webhooks/n8n/backfill` | POST | `symbols[]`, `timeframe` (1Min/5Min/1Hour/1Day), `start` (ISO date), `end` (ISO date) |
| `/webhooks/n8n/subscribe` | POST | `symbols[]`, `timeframe` |

### xstockstrat-ingest (`:8055`)

| Endpoint | Method | Payload fields |
|---|---|---|
| `/webhooks/n8n/trigger-backfill` | POST | `symbols[]`, `timeframe`, `start`, `end`, `overwrite` (bool) |
| `/webhooks/n8n/backfill-status` | POST | `job_id` |
| `/webhooks/n8n/ingest-signal` | POST | `source`, `symbol`, `direction` (bullish/bearish/neutral), `conviction` (0.0–1.0), `valid_from`, `valid_until`, `headline`, `raw_url`?, `tags[]` |

### xstockstrat-notify (`:8059`)

| Endpoint | Method | Payload fields |
|---|---|---|
| `/webhooks/n8n/emit-alert` | POST | `severity` (info/warning/critical), `category`, `title`, `body`, `source_service`, `target_user_id`, `tags[]`, `context` (object) |
| `/webhooks/n8n/list-alerts` | POST | `user_id`, `categories[]`?, `limit`? |

### xstockstrat-ledger (`:8057`)

| Endpoint | Method | Payload fields |
|---|---|---|
| `/webhooks/n8n/query-events` | POST | `stream_key`, `event_type`?, `start`?, `end`? |
| `/webhooks/n8n/append-event` | POST | `event_type`, `source_service`, `stream_key`, `payload` (object) |

### xstockstrat-identity (`:8058`)

| Endpoint | Method | Payload fields |
|---|---|---|
| `/webhooks/n8n/validate-token` | POST | `token` |
| `/webhooks/n8n/create-apikey` | POST | `user_id`, `name`, `scopes[]` |

### xstockstrat-analysis (`:8056`)

| Endpoint | Method | Payload fields |
|---|---|---|
| `/webhooks/n8n/run-backtest` | POST | `strategy_id`, `symbols[]`, `start`, `end`, `initial_capital` |
| `/webhooks/n8n/score-strategy` | POST | `strategy_id`, `start`, `end` |

### xstockstrat-portfolio (`:8052`)

| Endpoint | Method | Payload fields |
|---|---|---|
| `/webhooks/n8n/portfolio-report` | POST | `user_id`, `range` (object with `start`, `end`) |

---

## Step 10 — Add Newsletter Signal Sources

Each newsletter source requires its own n8n workflow. The `ingest-signal-email.json` and `ingest-signal-rss.json` templates are the starting point.

### Adding a new email newsletter source

1. Open `ingest-signal-email.json` in n8n
2. Click the three-dot menu → **Duplicate**
3. In the duplicated workflow:
   - **IMAP Trigger node**: select the appropriate IMAP credential (or create a new one for a different inbox)
   - **Parse node**: update the `source` identifier (e.g., `motley-fool`, `seeking-alpha`)
   - **Filter node**: update subject/sender filters to match the newsletter
4. Register config keys via the Config UI (`http://localhost:3002`) or the `config-update` workflow:
   ```
   ingest.signals.<source>.enabled              = true        (bool)
   ingest.signals.<source>.default_window_days  = 5           (int)
   ingest.signals.<source>.default_conviction   = 0.5         (float)
   ```
   Set `environment=dev` and `trading_mode=paper` for dev, `trading_mode=live` for prod.
5. Activate the new workflow
6. Add an entry to the Signal Source Log in `packages/n8n/README.md`

### Adding a new RSS signal source

1. Duplicate `ingest-signal-rss.json`
2. Update the **RSS Feed Trigger** URL to the new feed's URL
3. Update the **Parse** node's `source` identifier
4. Register config keys (same as above)
5. Activate and log the source

See `docs/runbooks/add-data-source.md` Part 2, Step 6 for more detailed per-newsletter workflow guidance.

---

## Signal Source Log

Track active newsletter sources below after setup. Also update `packages/n8n/README.md`.

| Date Added | Source ID | Type | n8n Workflow | Owner |
|---|---|---|---|---|
| — | — | — | — | — |

---

## Troubleshooting

### Workflow execution fails with `401 Unauthorized` from service

The `x-webhook-secret` header value in n8n does not match `N8N_WEBHOOK_SECRET` on the service. Verify both sides have the identical value — no trailing spaces or newlines.

### n8n can't reach the service URL

- **Local dev:** n8n Cloud cannot reach `localhost`. Use [ngrok](https://ngrok.com) to expose a local port:
  ```bash
  ngrok http 8060
  # Use the generated https://xxx.ngrok.io URL in n8n
  ```
- **DO App Platform:** Confirm the service component is ACTIVE in the DO console and the URL resolves. Check for typos in the URL.

### IMAP workflow not picking up emails

1. Verify the IMAP credential works: n8n → Credentials → Test credential
2. Confirm the email account has IMAP enabled (Gmail: Settings → Forwarding and POP/IMAP → Enable IMAP)
3. Confirm you are using an App Password (not your regular password) for Gmail
4. Check the poll interval in the Email Trigger node — increase if emails are delayed

### Webhook test URL vs production URL

When you click **Test Workflow** in n8n, it generates a temporary test webhook URL. The **production webhook URL** is different — find it in the **Webhook** node when the workflow is activated. Always use the production URL for real integrations.

### Workflow activates but shows 0 executions

Webhook-triggered workflows only execute when the webhook URL is called. Manually POST to the webhook URL to confirm it is reachable and working. Check n8n → Executions to see past attempts and their error messages.

### `ingest-signal` rejected with validation error

The `direction` field must be exactly `bullish`, `bearish`, or `neutral`. The `conviction` field must be a float between `0.0` and `1.0`. The `valid_from` and `valid_until` fields must be ISO 8601 timestamps.
