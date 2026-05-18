# n8n — No Longer in Use

n8n was the originally planned automation layer for the xstockstrat platform. It has been superseded by the AI agent architecture.

## Replacement

External signal ingestion, alert emission, and backtest triggering are now handled by the agent MCP server. See:

- `docs/roadmap/features/009-agent-mcp-server/product-spec.md` — the agent MCP server that replaces n8n

## Surviving Webhook Endpoints

All service webhook endpoints continue to work; the `/n8n/` path segment has been removed. The surviving paths are:

| Service | Endpoint | New path |
|---|---|---|
| xstockstrat-notify | emit-alert | `POST /webhooks/emit-alert` |
| xstockstrat-notify | list-alerts | `POST /webhooks/list-alerts` |
| xstockstrat-analysis | run-backtest | `POST /webhooks/run-backtest` |
| xstockstrat-ingest | trigger-backfill | `POST /webhooks/trigger-backfill` |
| xstockstrat-ingest | backfill-status | `POST /webhooks/backfill-status` |
| xstockstrat-ingest | ingest-signal | `POST /webhooks/ingest-signal` |

All other webhook endpoints (config `set-config`/`rollout`/`list-keys`, ledger `append-event`/`query-events`, identity `validate-token`/`create-apikey`, trading `place-order`/`cancel-order`, indicators `compute-indicator`/`execute-formula`, analysis `score-strategy`) have been removed. Use Connect-RPC directly on the service's HTTP port (80XX).
