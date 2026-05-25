# MCP Tools Reference — xstockstrat-agent

Complete reference for the six tools exposed by `xstockstrat-agent` via the Model Context Protocol (MCP).
Connection setup → `services/xstockstrat-agent/claude_mcp_config.json`.

---

## Transport Modes

| Mode | When to use | Config |
|---|---|---|
| `stdio` | Claude Desktop (local) — process started directly by the client | `MCP_TRANSPORT=stdio` (default) |
| `sse` | Remote access via HTTP — Claude.ai, production deployments | `MCP_TRANSPORT=sse`, `MCP_SSE_PORT=9000` |

**SSE endpoints (via nginx on port 80):**

| Path | Purpose |
|---|---|
| `GET /agent/sse` | SSE connection entry point |
| `POST /agent/messages` | MCP message channel |

**Direct SSE (bypasses nginx):** `http://localhost:9000/sse`

---

## Authentication

### stdio
No authentication required — the process is launched by the MCP client with the correct environment.

### SSE — API key
Provide a valid xstockstrat API key in either of:
- `Authorization: Bearer <api_key>` header
- `?api_key=<api_key>` query parameter (for clients that cannot set custom headers)

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

---

## Config Keys

| Key | Default | Description |
|---|---|---|
| `agent.signal.alert_threshold` | `0.6` | Minimum `conviction` to trigger auto-alert on `ingest_signal` |
| `agent.oauth.client_id` | `xstockstrat-agent` | OAuth client ID (future: feature `agent-mcp-oauth`) |
| `agent.oauth.allowed_redirect_uris` | _(empty — any https:// URI)_ | OAuth redirect URI allowlist |
