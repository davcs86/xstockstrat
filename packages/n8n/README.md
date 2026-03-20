# xstockstrat — n8n Workflow Definitions

This directory contains importable n8n Cloud workflow JSON files for the xstockstrat platform integration layer. Each workflow bridges an external event source to a service webhook handler.

---

## Workflows

| File | Trigger | Target Service | Purpose |
|---|---|---|---|
| `workflows/config-update.json` | n8n Webhook (POST) | xstockstrat-config `:8060` | Push a config key/value update |
| `workflows/place-order.json` | n8n Webhook (POST) | xstockstrat-trading `:8051` | Place an order from an external signal |
| `workflows/emit-alert.json` | n8n Webhook (POST) | xstockstrat-notify `:8059` | Emit a risk or system alert |
| `workflows/ledger-query-events.json` | Manual | xstockstrat-ledger `:8057` | Query/replay ledger events for audit |
| `workflows/ingest-signal-email.json` | IMAP Email (poll) | xstockstrat-ingest `:8055` | Parse newsletter emails → ingest signal |
| `workflows/ingest-signal-rss.json` | RSS Feed Trigger | xstockstrat-ingest `:8055` | Parse RSS feed items → ingest signal |
| `workflows/ingest-signal-csv.json` | Manual | xstockstrat-ingest `:8055` | Bulk-ingest signals from a CSV |

---

## Importing Workflows into n8n Cloud

1. Open your n8n Cloud instance
2. Go to **Workflows** in the left sidebar
3. Click **+ New** → **Import from File**
4. Select the desired `.json` file from this directory
5. Click **Save** and then **Activate**

Alternatively, use the n8n CLI:

```bash
# Import all workflows (requires n8n CLI installed)
for f in packages/n8n/workflows/*.json; do
  n8n import:workflow --input="$f"
done
```

---

## Required Credentials

### Webhook Authentication (all webhook-triggered workflows)

The xstockstrat services check `N8N_WEBHOOK_SECRET` for incoming webhook requests. In n8n:

1. Go to **Settings → Credentials → New Credential**
2. Choose **Header Auth**
3. Set:
   - **Name**: `x-webhook-secret` (or the header your services expect)
   - **Value**: the value of `N8N_WEBHOOK_SECRET` from your `.env`
4. Assign this credential to the **Webhook** trigger node in each workflow

### IMAP (email signal workflow)

1. Go to **Settings → Credentials → New Credential**
2. Choose **IMAP**
3. Fill in your newsletter email account credentials (host, port, user, password, TLS)
4. Assign to the **Email Trigger (IMAP)** node in `ingest-signal-email.json`

---

## Service Hostnames

Workflows reference service hostnames as they appear inside the Docker network:

| Variable | Docker Compose Hostname | Local Dev (port-forwarded) |
|---|---|---|
| config service | `http://xstockstrat-config:8060` | `http://localhost:8060` |
| trading service | `http://xstockstrat-trading:8051` | `http://localhost:8051` |
| notify service | `http://xstockstrat-notify:8059` | `http://localhost:8059` |
| ledger service | `http://xstockstrat-ledger:8057` | `http://localhost:8057` |
| ingest service | `http://xstockstrat-ingest:8055` | `http://localhost:8055` |
| identity service | `http://xstockstrat-identity:8058` | `http://localhost:8058` |

For n8n Cloud pointing at a production deployment, replace hostnames with the external URLs of your services on DO App Platform.

---

## Per-Newsletter Source Setup

Each newsletter source requires its own workflow instance (or a single workflow with source-detection logic). To add a new newsletter source:

1. Duplicate `ingest-signal-email.json` or `ingest-signal-rss.json`
2. Update the email/RSS credentials and source identifier in the **Parse** node
3. Register config keys in xstockstrat-config-ui (`http://localhost:3002`):
   - `ingest.signals.<source>.enabled` = `true`
   - `ingest.signals.<source>.default_window_days` = `5`
   - `ingest.signals.<source>.default_conviction` = `0.5`
4. Import the updated workflow into n8n and activate it
5. Add an entry to the Signal Source Log below

See `_tasks/x-add-data-source.md` Part 2, Step 6 for full per-newsletter workflow guidance.

---

## Signal Source Log

Track active newsletter sources here after setup.

| Date Added | Source ID | Type | n8n Workflow | Owner |
|---|---|---|---|---|
| — | — | — | — | — |

---

## Architecture Reference

```
External Event
  │
  ▼
n8n Cloud (this workflow)
  │
  ▼ HTTP POST
Service webhook handler (/webhooks/n8n/<action>)
  │
  ▼ internal gRPC call
Service implementation method
  │
  ├─► TimescaleDB
  ├─► xstockstrat-ledger (event write)
  └─► xstockstrat-notify (alert emission)
```

The full end-to-end integration test is at `scripts/integration-test.sh`.
