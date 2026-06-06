# xstockstrat-agent — CLAUDE.md

## Role

Python MCP (Model Context Protocol) server exposing AI-agent tools for signal ingestion,
alerting, backtesting, strategy/formula/source management, and live-strategy control. Runs
over SSE (`MCP_TRANSPORT=sse`, port 9000). All outbound gRPC calls to platform services carry
`x-mcp-secret` when `MCP_AGENT_SECRET` is set; admin-scoped tools additionally forward an
`authorization: Bearer <admin_api_key>` validated at the entry point.

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
| `manage_strategy` | Register/update/deactivate stored strategies (admin-scoped) |
| `manage_formula` | Register/update/delete custom formulas (admin-scoped) |
| `manage_signal_source` | Register/update/deactivate signal sources (admin-scoped) |
| `set_strategy_live` | Enable/disable continuous live evaluation + alerting for a strategy (admin-scoped, feature 048) |

### Admin authorization (entry-point pattern)

The SSE auth layer (`app/auth.py`) validates that an API key is **valid**; it does not check the
admin role. Admin-scoped tools therefore authorize at the agent entry point: `set_strategy_live`
calls `client.validate_admin(admin_api_key)` (identity `ValidateApiKey` → `"admin" in roles`) before
forwarding the call with the admin access scope. Internal services (e.g. `xstockstrat-analysis`
`SetStrategyLive`) only perform a role check on the propagated `x-access-scope`.

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

The `/sse` endpoint accepts an **`aud`-bound JWT** (`aud` == `AGENT_PUBLIC_URL`, validated first) and
falls back to the legacy `Authorization: Bearer <api_key>` and the **deprecated** `?api_key=` query
fallback; unauthenticated requests get `401` with a `WWW-Authenticate: Bearer resource_metadata=…`
discovery pointer. `AGENT_PUBLIC_URL` builds all absolute discovery/endpoint URLs (in DO it is
`${APP_URL}/agent`).

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
