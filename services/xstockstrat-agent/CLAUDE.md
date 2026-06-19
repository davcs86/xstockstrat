# xstockstrat-agent — CLAUDE.md

## Role

Python MCP (Model Context Protocol) server exposing AI-agent tools for signal ingestion,
alerting, backtesting, strategy/formula/source management, and live-strategy control
(`MCP_TRANSPORT=sse`, port 9000). It serves **two MCP transports** from a single root ASGI
dispatcher (`app/main.py` `handle_mcp`): the modern **Streamable HTTP** transport (MCP
2025-03-26) at the agent root `/` — which is what the **Claude.ai remote connector** speaks
against the connector URL (`AGENT_PUBLIC_URL`, `${APP_URL}/agent`, stripped to `/` by DO
ingress) — plus the **legacy HTTP+SSE** transport at `/sse` + `/messages` for Claude Desktop.
All outbound gRPC calls to platform services carry `x-mcp-secret` when `MCP_AGENT_SECRET` is
set; the management tools forward a hardcoded admin `x-access-scope` so the backends' role checks
pass.

## Language

Python 3.12 (asyncio, grpc.aio, FastMCP)

## MCP Tools

The agent registers ten tools (see `docs/runbooks/mcp-tools.md` for full parameter/return/error
reference):

| Tool | Purpose |
|---|---|
| `list_signal_sources` | List active signal sources (enriched with `extractor_tool`) |
| `extract_email_content` | Extract text from email attachments / gated URLs |
| `extract_website_content` | Fetch text from a registered website source |
| `ingest_signal` | Ingest a trading signal (auto-alerts above conviction threshold) |
| `emit_alert` | Emit an alert via xstockstrat-notify |
| `run_backtest` | Trigger a backtest via xstockstrat-analysis |
| `manage_strategy` | Register/update/deactivate stored strategies |
| `manage_formula` | Register/update/delete custom formulas |
| `manage_signal_source` | Register/update/deactivate signal sources |
| `set_strategy_live` | Enable/disable continuous live evaluation + alerting for a strategy (feature 048) |

### Management-tool authorization

The management tools (`manage_strategy`, `manage_formula`, `manage_signal_source`,
`set_strategy_live`) forward a hardcoded admin `x-access-scope` on their backend gRPC calls.
Internal services (e.g. `xstockstrat-analysis` `SetStrategyLive`) only perform a role check on the
propagated `x-access-scope`; `manage_formula` additionally relies on the indicators backend's
author-ownership check. The MCP endpoint itself is gated by OAuth 2.1 (see below).

### OAuth 2.1 edge auth (feature 049 Part B)

The agent is the OAuth 2.1 **Resource Server + Authorization-Server HTTP facade** for its MCP SSE
endpoint, and is **stateless**: all durable OAuth state (clients, auth codes, refresh tokens) lives
in `xstockstrat-identity` and is reached over gRPC (`app/client.py`). The only cross-request linkage
is the HMAC-signed `txn` blob carried in URLs (`app/oauth_server.py`, signed with `MCP_AGENT_SECRET`),
so there is **no in-memory store** and `instance_count > 1` is safe (FR-B13).

Routes (registered in `app/main.py` `build_sse_app`):

| Route | Purpose |
|---|---|
| `/.well-known/oauth-protected-resource` | RFC 9728 protected-resource metadata |
| `/.well-known/oauth-authorization-server` | RFC 8414 authorization-server metadata |
| `POST /oauth/register` | RFC 7591 Dynamic Client Registration (public client, https-only) |
| `GET /oauth/authorize` | PKCE/S256 + exact-redirect validation; delegates login to the UI |
| `GET /oauth/callback` | Derives user from the same-origin `access_token` cookie; mints the code |
| `POST /oauth/token` | `authorization_code` + `refresh_token` grants (tokens in JSON body only) |
| `/` (GET/POST) | **Streamable HTTP** MCP endpoint (Claude.ai remote connector) |
| `/sse` + `/messages` | Legacy HTTP+SSE MCP endpoint (Claude Desktop) |

Both MCP endpoints (root Streamable HTTP and `/sse`) require an **`aud`-bound JWT** (`aud` ==
`AGENT_PUBLIC_URL`); unauthenticated requests get `401` with a
`WWW-Authenticate: Bearer resource_metadata=…` discovery pointer. Note the **RFC 8414/9728 path
insertion** quirk: because `AGENT_PUBLIC_URL` has a path (`/agent`), spec-compliant clients fetch
the AS/PR metadata at `https://<host>/.well-known/oauth-authorization-server/agent`, which lands on
`xstockstrat-ui` (the `/` catch-all), so the UI also serves that canonical metadata (UI
`next.config.js` rewrites → `/api/oauth/*`). `AGENT_PUBLIC_URL` builds all absolute
discovery/endpoint URLs (in DO it is `${APP_URL}/agent`).

## Config Keys Consumed

Namespace: `agent` (resolved via one-shot `GetConfig` → `client.get_config_value("<bare-key>")`).

| Key | Type | Default | Description |
|---|---|---|---|
| `agent.oauth.registration_enabled` | bool | `true` | Allow RFC 7591 DCR at `/oauth/register` (disabled ⇒ 403) |
| `agent.oauth.allowed_redirect_uris` | string | `""` | Comma-separated exact redirect URIs; empty = require `https://` at registration only |

## Environment Variables

```text
MCP_TRANSPORT=sse
MCP_SSE_PORT=9000
MCP_AGENT_SECRET=<shared secret>
INGEST_ENDPOINT=xstockstrat-ingest:50055
NOTIFY_ENDPOINT=xstockstrat-notify:50059
ANALYSIS_ENDPOINT=xstockstrat-analysis:50056
INDICATORS_ENDPOINT=xstockstrat-indicators:50054
IDENTITY_ENDPOINT=xstockstrat-identity:50058
CONFIG_ENDPOINT=xstockstrat-config:50060
UI_BASE_URL=http://localhost:3000
AGENT_PUBLIC_URL=http://localhost:9000   # ${APP_URL}/agent in DO
```

## Running Tests

```bash
uv sync --extra dev
uv run pytest --cov=app --cov-fail-under=40
```
