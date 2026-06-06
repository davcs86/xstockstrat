# MCP Tools Reference — xstockstrat-agent

Complete reference for the nine tools exposed by `xstockstrat-agent` via the Model Context Protocol (MCP).
Connection setup → `services/xstockstrat-agent/claude_mcp_config.json`.

---

## Transport Modes

| Mode | When to use | Config |
|---|---|---|
| `stdio` | Claude Desktop (local) — process started directly by the client | `MCP_TRANSPORT=stdio` (default) |
| `sse` | Remote access via HTTP — Claude.ai, production deployments | `MCP_TRANSPORT=sse`, `MCP_SSE_PORT=9000` |

**SSE endpoints.** nginx was removed by feature 045; in the DO App Platform the agent is served under
the `/agent` route prefix (`AGENT_PUBLIC_URL = ${APP_URL}/agent`, OQ-E), and locally it is exposed
directly on port 9000.

| Path (relative to `AGENT_PUBLIC_URL`) | Purpose |
|---|---|
| `GET /sse` | SSE connection entry point |
| `POST /messages` | MCP message channel |
| `GET /.well-known/oauth-protected-resource` | RFC 9728 discovery |
| `GET /.well-known/oauth-authorization-server` | RFC 8414 discovery |
| `POST /oauth/register`, `GET /oauth/authorize`, `GET /oauth/callback`, `POST /oauth/token` | OAuth 2.1 endpoints |

**Direct SSE (local):** `http://localhost:9000/sse`

---

## Authentication

### stdio
No authentication required — the process is launched by the MCP client with the correct environment.

### SSE — OAuth 2.1 (recommended, feature 049 Part B)
The **recommended** production method for Claude.ai. The agent is the OAuth 2.1 Resource Server +
Authorization-Server HTTP facade; `xstockstrat-identity` is the durable client/code store + token mint.
The end-to-end connect flow:

1. **Discovery** — the client `GET`s `/.well-known/oauth-protected-resource` (RFC 9728) and
   `/.well-known/oauth-authorization-server` (RFC 8414); an unauthenticated `GET /sse` returns
   `401` with `WWW-Authenticate: Bearer resource_metadata="…/.well-known/oauth-protected-resource"`,
   which triggers discovery.
2. **DCR** — `POST /oauth/register` (RFC 7591) registers a public client (https-only redirect URIs);
   returns a `client_id`, no secret.
3. **Authorize** — `GET /oauth/authorize` with `response_type=code`, `code_challenge_method=S256`
   (PKCE mandatory), `client_id`, an exact-matched `redirect_uri`, `state`, and `resource`. The agent
   delegates login to the unified UI (`/auth/oauth-login`) via an HMAC-signed stateless `txn` blob.
4. **UI login → callback** — after login the UI redirects to `/oauth/callback` with `txn`+`state`
   only; the agent derives `user_id` from the same-origin `access_token` session cookie
   (identity `ValidateToken`) and mints a single-use auth code.
5. **Token** — `POST /oauth/token` (`authorization_code` then `refresh_token`) returns an
   **audience-bound JWT** (`aud` = the agent resource URI) plus a rotating refresh token. The JWT is
   presented as `Authorization: Bearer <jwt>` on `/sse`; the agent rejects tokens whose `aud` does
   not match.

### SSE — API key (legacy)
A valid xstockstrat API key in either of:
- `Authorization: Bearer <api_key>` header
- `?api_key=<api_key>` query parameter — **DEPRECATED**: OAuth 2.1 forbids credentials in query
  strings. Kept only as a Desktop-only fallback for clients that cannot perform the OAuth flow.

The key is validated against `xstockstrat-identity` `ValidateApiKey` RPC. Invalid keys return `HTTP 401`.

### x-mcp-secret (downstream enforcement)
`MCP_AGENT_SECRET` is a shared secret the agent sends as `x-mcp-secret` on every outbound webhook call to `xstockstrat-ingest`, `xstockstrat-notify`, and `xstockstrat-analysis`. Those services reject requests without the correct header when the secret is configured.

| Env var | Services | Behavior when empty |
|---|---|---|
| `MCP_AGENT_SECRET` | agent, ingest, notify, analysis | Secret enforcement disabled — all webhook requests pass through |

Set `MCP_AGENT_SECRET` to the same value across all four services. Generate with `openssl rand -hex 32`.

---

## Tools

### `list_signal_sources`

Lists active signal sources registered in `xstockstrat-ingest`. Enriches each source with an `extractor_tool` field derived from the source type.

**Parameters**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `source_type` | `string[]` | No | Filter by source type(s). Omit to return all active sources. |

**Return**

```json
{
  "sources": [
    {
      "slug": "unusual_whales",
      "display_name": "Unusual Whales",
      "source_type": "mediated_simple_email",
      "config_json": {},
      "extractor_tool": null
    }
  ]
}
```

`extractor_tool` values:

| `source_type` | `extractor_tool` |
|---|---|
| `mediated_email_attachment` | `"extract_email_content"` |
| `mediated_linked_email` | `"extract_email_content"` |
| `mediated_simple_website` | `"extract_website_content"` |
| `mediated_authenticated_website` | `"extract_website_content"` |
| all other types | `null` |

`credentials_ref` is intentionally omitted from the response — credentials are never exposed to Claude.

**Errors**

| Condition | Error |
|---|---|
| Ingest service unreachable | `httpx` connection error propagated |

---

### `extract_email_content`

Extracts raw text from email attachments (PDF or plain text) or gated URLs for a registered source. **Call only when the source's `extractor_tool` is `"extract_email_content"`.**

**Parameters**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `source_slug` | `string` | Yes | Slug from `list_signal_sources` |
| `attachments_b64` | `string[]` | Conditional | Base64-encoded attachment bytes (PDF or UTF-8 text). At least one of `attachments_b64` or `urls` is required. |
| `urls` | `string[]` | Conditional | URLs to fetch (for `mediated_linked_email` sources). At least one of `attachments_b64` or `urls` is required. |

**Return**

```json
{ "raw_text": "Buy NVDA at market open..." }
```

All attachments and URLs are concatenated with double newlines.

**Errors**

| Condition | Error |
|---|---|
| Neither `attachments_b64` nor `urls` provided | `ValueError: At least one of attachments_b64 or urls must be provided` |
| `source_slug` not found or inactive | `ValueError: Unknown or inactive source slug: '<slug>'` |
| PDF is password-protected but no credentials configured | `ValueError: PDF is password-protected but no credentials_ref is configured` |

---

### `extract_website_content`

Fetches and returns raw text from a registered website source. The URL is read from the source's `config_json.url` — Claude never constructs URLs. **Call only when the source's `extractor_tool` is `"extract_website_content"`.**

**Parameters**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `source_slug` | `string` | Yes | Slug from `list_signal_sources` |

**Return**

```json
{ "raw_text": "NVDA: strong buy signal..." }
```

**Errors**

| Condition | Error |
|---|---|
| `source_slug` not found or inactive | `ValueError: Unknown or inactive source slug: '<slug>'` |
| Source has no `url` in `config_json` | `ValueError: Source '<slug>' has no url in config_json` |

---

### `ingest_signal`

Ingests a trading signal into `xstockstrat-ingest`. If `conviction` meets or exceeds `agent.signal.alert_threshold` (config key, default `0.6`), an alert is automatically emitted via `xstockstrat-notify`.

**Parameters**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `source` | `string` | Yes | Source slug from `list_signal_sources` (validated by ingest) |
| `symbol` | `string` | Yes | Ticker symbol, e.g. `"NVDA"` |
| `direction` | `string` | Yes | One of `"buy"`, `"sell"`, `"hold"`, `"watchlist"` |
| `valid_from` | `string` | Yes | ISO 8601 datetime, e.g. `"2026-05-01T00:00:00Z"` |
| `conviction` | `float` | No | Signal confidence, `0.0`–`1.0`. Ingest applies source default if absent. |
| `valid_until` | `string` | No | ISO 8601 datetime — signal expiry |
| `headline` | `string` | No | Short summary for display |
| `raw_url` | `string` | No | Source URL for attribution |
| `tags` | `string[]` | No | Free-form tags, e.g. `["unusual_options", "large_sweep"]` |

**Return**

```json
{ "signal_id": 42 }
```

**Errors**

| Condition | Error |
|---|---|
| Unknown `source` slug | `HTTP 400` from ingest (`INVALID_ARGUMENT`) |
| `valid_from` missing | `HTTP 400` from ingest |
| Auto-alert emission fails | Warning logged; signal is already ingested — not rolled back |

---

### `emit_alert`

Emits an alert directly via `xstockstrat-notify`. Use for system-level alerts or notifications not tied to an ingested signal.

**Parameters**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `severity` | `string` | Yes | Alert severity: `"info"`, `"warning"`, `"critical"` |
| `category` | `string` | Yes | Alert category, e.g. `"signal"`, `"system"` |
| `title` | `string` | Yes | Short alert title |
| `body` | `string` | Yes | Alert body text |
| `source_service` | `string` | No | Emitting service name (default `"xstockstrat-agent"`) |
| `target_user_id` | `string` | No | Target user ID (default `""` = broadcast) |

**Return**

```json
{ "success": true }
```

**Errors**

| Condition | Error |
|---|---|
| Notify service unreachable | `httpx` connection error propagated |

---

### `run_backtest`

Triggers a backtest via `xstockstrat-analysis`. The default strategy is SMA crossover (fast=20, slow=50).

**Parameters**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `strategy_id` | `string` | Yes | Strategy identifier, e.g. `"sma_crossover"` |
| `symbols` | `string[]` | Yes | Ticker symbols to backtest, e.g. `["NVDA", "AAPL"]` |
| `initial_capital` | `float` | No | Starting capital in USD (default `100000.0`) |

**Return**

```json
{ "backtest_id": "bt-abc123" }
```

**Errors**

| Condition | Error |
|---|---|
| Unknown `strategy_id` | `HTTP 400` from analysis |
| Analysis service unreachable | `httpx` connection error propagated |

---

### `manage_strategy`

Registers, updates, or deactivates a stored strategy definition in `xstockstrat-analysis` (admin-scoped).

**Parameters**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `operation` | `string` | Yes | `"register"`, `"update"`, or `"deactivate"` |
| `strategy_id` | `string` | Yes | Lowercase/underscore identifier, e.g. `"sma_crossover"` |
| `display_name` | `string` | No | Human-readable name |
| `components` | `object[]` | No | `{ref_name, kind ("builtin"\|"formula"), indicator, formula_id, params}` |
| `entry_rule` | `string` | No | JSON-encoded condition tree |
| `exit_rule` | `string` | No | JSON-encoded condition tree |
| `signal_params` | `object` | No | Optional signal-weighting params |
| `admin_api_key` | `string` | Yes | Admin API key; validated by the analysis backend |

**Return**

```json
{ "strategyId": "sma_crossover", "displayName": "SMA Crossover", "active": true }
```

**Errors**

| Condition | Error |
|---|---|
| Missing/invalid admin key | `admin API key required` (UNAUTHENTICATED) |
| Invalid definition (unknown indicator, bad rule JSON, undefined ref_name) | `invalid argument` (INVALID_ARGUMENT) |
| `update`/`deactivate` on unknown strategy | `strategy not found` (NOT_FOUND) |

---

### `manage_formula`

Registers, updates, or deletes a custom formula definition in `xstockstrat-indicators` (admin-scoped).

**Parameters**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `operation` | `string` | Yes | `"register"`, `"update"`, or `"delete"` |
| `name` | `string` | register/update | Formula name |
| `description` | `string` | No | Formula description |
| `source` | `string` | register/update | Python formula source |
| `is_public` | `bool` | No | Whether the formula is public (default `false`) |
| `formula_id` | `string` | update/delete | Formula identifier |
| `author` | `string` | register | Author, stored immutably on register |
| `formula_author_user_id` | `string` | update/delete | Must match the formula's original `author` (else PERMISSION_DENIED) |
| `admin_api_key` | `string` | Yes | Admin API key; validated by the indicators backend |

**Return**

```json
{ "formula_id": "f-abc123" }
```

**Errors**

| Condition | Error |
|---|---|
| Missing/invalid admin key | `admin API key required` (UNAUTHENTICATED) |
| `formula_author_user_id` ≠ author | `permission denied` (PERMISSION_DENIED) |
| `update`/`delete` on unknown formula | `formula not found` (NOT_FOUND) |

---

### `manage_signal_source`

Registers, updates, or deactivates a signal source in `xstockstrat-ingest` (admin-scoped).

**Parameters**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `operation` | `string` | Yes | `"register"`, `"update"`, or `"deactivate"` |
| `slug` | `string` | Yes | Source slug |
| `display_name` | `string` | No | Human-readable name |
| `source_type` | `string` | No | Source type (e.g. `"newsletter"`) |
| `config_json` | `object` | No | Source configuration |
| `extractor_module` | `string` | No | Extractor module name |
| `credentials_ref` | `string` | No | Reference to stored credentials — forwarded to the backend, **never echoed** |
| `admin_api_key` | `string` | Yes | Admin API key; validated by the ingest backend |

**Return**

```json
{ "slug": "unusual_whales", "display_name": "Unusual Whales", "source_type": "newsletter", "active": true, "has_credentials": true }
```

**Errors**

| Condition | Error |
|---|---|
| Missing/invalid admin key | `admin API key required` (UNAUTHENTICATED) |
| Invalid source fields | `invalid argument` (INVALID_ARGUMENT) |
| `deactivate` on unknown source | `signal source not found` (NOT_FOUND) |
| `credentials_ref` exposure | **Never** — `credentials_ref` is intentionally omitted from the return and never exposed to Claude (FR-12) |

---

## Usage Patterns

### Email newsletter ingestion

```
1. list_signal_sources(source_type=["mediated_email_attachment", "mediated_linked_email"])
   → confirm extractor_tool == "extract_email_content" for each source

2. extract_email_content(source_slug="<slug>", attachments_b64=["<base64-pdf>"])
   → raw_text: newsletter content

3. Parse raw_text to extract signal fields (symbol, direction, conviction, dates)

4. ingest_signal(source="<slug>", symbol="NVDA", direction="buy",
                 valid_from="2026-05-01T00:00:00Z", conviction=0.85)
   → signal_id
```

### Website signal ingestion

```
1. list_signal_sources(source_type=["mediated_simple_website", "mediated_authenticated_website"])
   → confirm extractor_tool == "extract_website_content" for each source

2. extract_website_content(source_slug="<slug>")
   → raw_text: page content from config_json.url

3. Parse raw_text to extract signal fields

4. ingest_signal(source="<slug>", symbol="AAPL", direction="buy",
                 valid_from="2026-05-01T00:00:00Z", conviction=0.7)
   → signal_id
```

### Alert-only notification (no signal)

```
emit_alert(severity="info", category="system",
           title="Backtest complete", body="sma_crossover on NVDA: Sharpe 1.4")
```

### Strategy management

```
1. manage_formula(operation="register", name="rsi_div", source="<python source>",
                  author="<user_id>", admin_api_key="<key>")
   → formula_id

2. manage_strategy(operation="register", strategy_id="rsi_sma_combo",
                  display_name="RSI + SMA", admin_api_key="<key>",
                  components=[
                    {"ref_name": "sma_fast", "kind": "builtin", "indicator": "SMA", "params": {"period": 20}},
                    {"ref_name": "rsi", "kind": "formula", "formula_id": "<formula_id>"}
                  ],
                  entry_rule='{"op":"AND","conditions":[{"lhs":"sma_fast","fn":"crosses_above","rhs":"rsi"}]}')
   → strategyId

3. run_backtest(strategy_id="rsi_sma_combo", symbols=["NVDA"])
   → backtest_id
```

---

## Config Keys

| Key | Default | Description |
|---|---|---|
| `agent.signal.alert_threshold` | `0.6` | Minimum `conviction` to trigger auto-alert on `ingest_signal` |
| `agent.oauth.client_id` | `xstockstrat-agent` | OAuth client ID (future: feature `agent-mcp-oauth`) |
| `agent.oauth.allowed_redirect_uris` | _(empty — any https:// URI)_ | OAuth redirect URI allowlist |
