# MCP Tools Reference — xstockstrat-agent

Complete reference for the twenty-two tools exposed by `xstockstrat-agent` via the Model Context Protocol (MCP).
Connection setup → `services/xstockstrat-agent/claude_mcp_config.json`.

---

## Transport Modes

| Mode | When to use | Config |
|---|---|---|
| `stdio` | Claude Desktop (local) — process started directly by the client | `MCP_TRANSPORT=stdio` (default) |
| `http` | Remote access — Claude.ai, production deployments | `MCP_TRANSPORT=http`, `MCP_HTTP_PORT=9000` |

> **⚠ Operator action after the feature-079 deploy.** The legacy HTTP+SSE transport is **gone**. If a
> saved connector's URL ends in `/sse`, it now returns **404** — edit that connector's URL down to the
> bare `AGENT_PUBLIC_URL` (no path suffix). That is the whole fix: a one-line client change, with **no
> re-authorization needed**. Nothing in `docker-compose.yml` or `.do/app*.yaml` has to change for the
> agent to keep serving MCP — `MCP_TRANSPORT=sse` is still accepted as a deprecated alias that logs a
> warning and starts the same server, and `MCP_SSE_PORT` still works as a deprecated fallback for
> `MCP_HTTP_PORT`. The shipped specs were moved to the new names anyway.

**Endpoints.** nginx was removed by feature 045; in the DO App Platform the agent is served under
the `/agent` route prefix (`AGENT_PUBLIC_URL = ${APP_URL}/agent`, OQ-E), and locally it is exposed
directly on port 9000.

| Path (relative to `AGENT_PUBLIC_URL`) | Purpose |
|---|---|
| `/` (GET/POST) | **Streamable HTTP** MCP endpoint — the connector URL itself |
| `GET /sse`, `POST /messages` | **Removed** (feature 079) — return `404 text/plain` naming the replacement URL, *before* the auth gate, so a stale client gets an immediate answer instead of a pointless OAuth round-trip |
| `GET /.well-known/oauth-protected-resource` | RFC 9728 discovery |
| `GET /.well-known/oauth-authorization-server` | RFC 8414 discovery |
| `POST /oauth/register`, `GET /oauth/authorize`, `GET /oauth/callback`, `POST /oauth/token` | OAuth 2.1 endpoints |

**Direct (local):** `http://localhost:9000`

**Tool catalog (UI display).** `GET /api/tools` returns the same twenty-two tools' `name`,
`description`, and `inputSchema` as JSON — **unauthenticated**, since it only describes
capabilities (the same data documented below), never user data or credentials. It powers the
`xstockstrat-ui` `/accounts/mcp-tools` page (via the `/accounts/api/mcp-tools` BFF route) so users
can see what the agent can do without connecting a client first.

---

## Authentication

### stdio
No authentication required — the process is launched by the MCP client with the correct environment.

### Streamable HTTP — OAuth 2.1 (recommended, feature 049 Part B)
The **recommended** production method for Claude.ai. The agent is the OAuth 2.1 Resource Server +
Authorization-Server HTTP facade; `xstockstrat-identity` is the durable client/code store + token mint.
The end-to-end connect flow:

1. **Discovery** — the client `GET`s `/.well-known/oauth-protected-resource` (RFC 9728) and
   `/.well-known/oauth-authorization-server` (RFC 8414); an unauthenticated request to the **root**
   MCP endpoint returns `401` with
   `WWW-Authenticate: Bearer resource_metadata="…/.well-known/oauth-protected-resource"`, which
   triggers discovery. (`GET /sse` returns **404**, not 401 — it is a removed path, not an
   unauthenticated one, and it never reaches the auth gate.)
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
   presented as `Authorization: Bearer <jwt>` on the root MCP endpoint; the agent rejects tokens whose `aud` does
   not match.

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
      "extractor_tool": null,
      "active": true,
      "health": "SOURCE_HEALTH_STATUS_HEALTHY",
      "last_seen_at": "2026-08-02T12:00:00+00:00",
      "last_error": "",
      "signals_fed": 42
    }
  ]
}
```

Source-health fields (feature 083, surfaced by feature 087): `active` (bool), `health`
(`SourceHealthStatus` enum **name**), `last_seen_at` (RFC3339, or `null` for a source that has never
fed a signal), `last_error` (string), `signals_fed` (**int64 as a JSON number** in this projection —
unlike the int64-as-string contract of `run_backtest`/`get_backfill_status`).

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

> **Credentials (feature 093):** a source registered with credentials (`has_credentials=true`) currently **raises `RuntimeError`** — secure per-source credential resolution is not yet supported. The platform stores secrets as `is_secret` references that the config service redacts, so there is no safe way to resolve a password here (a plaintext config credential would violate config governance and be disclosed unredacted). Only `has_credentials=false` sources are extractable today; secure resolution is a tracked follow-up (AC-3).

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
| Source requires credentials (`has_credentials=true`) | `RuntimeError: secure per-source credential resolution is not supported yet …` (feature 093 — secure resolution is a deferred follow-up) |
| PDF is password-protected (an encrypted PDF on a `has_credentials=false` source) | `ValueError` from the PDF parser |

---

### `extract_website_content`

Fetches and returns raw text from a registered website source. The URL is read from the source's `config_json.url` — Claude never constructs URLs. **Call only when the source's `extractor_tool` is `"extract_website_content"`.**

> **Credentials (feature 093):** as with `extract_email_content`, a source with `has_credentials=true` **raises `RuntimeError`** — secure per-source credential resolution is a deferred follow-up (AC-3). Only `has_credentials=false` sources are extractable today.

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
| Source requires credentials (`has_credentials=true`) | `RuntimeError: secure per-source credential resolution is not supported yet …` (feature 093) |

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
| `conviction` | `float` | No | Signal confidence, `0.0`–`1.0`. Omit if unknown — ingest stores an absent (or `0.0`) value as unset (NULL) and reads it back as `0.0` meaning "unknown confidence" (invariant INGEST-4). **No source default is applied.** An out-of-range value (`< 0.0` or `> 1.0`) or NaN is rejected `INVALID_ARGUMENT` at the ingest boundary (not `INTERNAL`). |
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
| Unknown `source` slug | `invalid argument` (INVALID_ARGUMENT) from ingest |
| `valid_from` missing | `invalid argument` (INVALID_ARGUMENT) from ingest |
| `conviction` out of range (`< 0.0` or `> 1.0`) or NaN | `invalid argument` (INVALID_ARGUMENT) from ingest |
| Auto-alert emission fails | Warning logged; signal is already ingested — not rolled back |

---

### `emit_alert`

Emits an alert directly via `xstockstrat-notify`. Use for system-level alerts or notifications not tied to an ingested signal. Sends no security metadata (no shared secret, no admin `x-access-scope`): `EmitAlert` is an internal-service-caller RPC that is intentionally **not** role-gated (feature 092) — its trust boundary is the private network plus the agent's OAuth edge, and every caller (agent + internal service loops) is unauthenticated at the RPC layer. The alert's recipient is always derived from the OAuth-authenticated caller's own verified identity or an explicit system-wide broadcast (feature 111) — the caller can no longer address an alert to an arbitrary other user.

**Parameters**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `severity` | `string` | Yes | Alert severity: `"info"`, `"warning"`, `"error"`, `"critical"` (unknown values coerce to `"info"`) |
| `category` | `string` | Yes | Alert category, e.g. `"signal"`, `"system"` |
| `title` | `string` | Yes | Short alert title |
| `body` | `string` | Yes | Alert body text |
| `broadcast` | `bool` | Yes | `true` sends a system-wide broadcast (`target_user_id=""` on the wire, unchanged semantic); `false` addresses the alert to the OAuth-authenticated caller's own derived identity. No default — omitting it is a schema error. |
| `source_service` | `string` | No | Emitting service name (default `"xstockstrat-agent"`) |
| `context` | `object` | No | Structured JSON context stored + fanned out with the alert (feature 087) |
| `tags` | `string[]` | No | Tags for filtering/grouping (feature 087) |
| `correlation_id` | `string` | No | Id to correlate related alerts (feature 087) |

**Return**

```json
{ "alert_id": "3f9a1c2e-7b0d-4e5a-9c1f-2a6b8d0e4f11" }
```

Unknown `severity` strings are silently coerced to `"info"` (valid values: `info`, `warning`,
`error`, `critical`). `title` and `body` are required and non-blank — an empty or whitespace-only
title or body is rejected `INVALID_ARGUMENT` by notify before the alert is persisted or delivered.

**Errors**

| Condition | Error |
|---|---|
| Empty or whitespace-only `title` or `body` | `invalid argument` (INVALID_ARGUMENT) from notify |
| No verified OAuth claims on the request, when `broadcast=false` | `RuntimeError` — Streamable HTTP transport required |
| Notify service unreachable | `httpx` connection error propagated |

---

### `run_backtest`

Triggers a backtest via `xstockstrat-analysis`. `strategy_id` must be a **registered** strategy definition — the run executes that definition (the client sends `strategy_id_ref == strategy_id`) so it earns fingerprinted evidence toward the strategy's derived headline grade (feature 065). An unregistered id returns `NOT_FOUND`; the legacy ad-hoc SMA-crossover path is no longer reachable from the agent.

**Parameters**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `strategy_id` | `string` | Yes | Strategy identifier, e.g. `"sma_crossover"` |
| `symbols` | `string[]` | Yes | Ticker symbols to backtest, e.g. `["NVDA", "AAPL"]` |
| `initial_capital` | `float` | No | Starting capital in USD (default `100000.0`) |
| `start` | `string` | No | ISO date/datetime lower bound of the evaluation window (feature 071), e.g. `"2024-01-01"` or `"2024-01-01T00:00:00Z"` |
| `end` | `string` | No | ISO date/datetime upper bound of the evaluation window |

**The evaluation window (feature 071)**

Supply **both** `start` and `end` to get a reproducible run: the same strategy, symbols, and
window return the same numbers on any calendar day, so results are comparable across strategies
and across days. Omit them and the analysis service applies its rolling default — a window ending
"now", bounded by `analysis.backtest.max_range_days` — whose results drift as the calendar moves.
Either bound may be given alone; the other keeps its default.

`start`/`end` bound the **evaluation** window, not the fetch. Analysis reaches back *before*
`start` for as many bars as the strategy's indicators declare they need, so the whole requested
window is evaluated fully warm and no trade opens before `start`. Two consequences worth knowing:

- If stored history does not reach back far enough to warm the indicators, the run returns
  `BACKTEST_STATUS_INSUFFICIENT_DATA` with `coverage_gaps` covering the **pre-window** span —
  not the window you asked for. Fill it with `trigger_backfill`, then re-run.
- A strategy that references `VWAP` alongside a longer indicator will see its VWAP values shift
  versus an unwindowed run: VWAP is an expanding average anchored at the first fetched bar, so
  the prefix moves its anchor. Deterministic, but not equal to the rolling-default run.

Both bounds set with a span over `analysis.backtest.max_range_days` (default 730) is rejected with
`INVALID_ARGUMENT` rather than silently clamped. A `start` after `end` is rejected client-side.

**Scoring is technical-only (feature 097).** A strategy's backtest score comes from its technical
rules alone — `run_backtest` sends no signal parameters, and the analysis service no longer blends
newsletter `signal_sources`/`signal_weight` from `strategy_params` into a strategy's per-bar
conviction. Under Option 2 a signal is a **universe + independent queue ranking axis** (surfaced by
the Decide → Opportunities queue), never an input to a strategy's own score, so no signal is counted
twice. This does **not** touch `screen_symbols`' signal-blend params (below — the screener still
blends) or `manage_strategy`'s `signal_params` (the live-loop symbol universe).

**Return**

Two parts, as MCP **content blocks** (feature 072) — not a single JSON object:

1. A **text block** carrying a compact JSON summary. This is what the model reads.
2. When there is detail to attach, one **embedded `application/json` resource** carrying the
   **complete** `BacktestResult`, at
   `xstockstrat:///backtest/<backtest_id>/result.json`.

The summary:

```json
{
  "backtest_id": "bt-9f2c1a",
  "strategy_id": "sma_crossover",
  "status": "BACKTEST_STATUS_OK",
  "completed_at": "2026-07-27T14:03:11Z",
  "total_return": 0.152,
  "annualized_return": 0.221,
  "sharpe_ratio": 1.24,
  "max_drawdown": 0.081,
  "win_rate": 0.55,
  "total_trades": 42,
  "profit_factor": 1.8,
  "initial_capital": 100000.0,
  "coverage_gaps": [
    { "symbol": "AAPL", "timeframe": "TIMEFRAME_1DAY", "bars_have": "120", "bars_need": "504" }
  ],
  "diagnostics": [
    {
      "symbol": "AAPL",
      "no_trade_reason": "NO_TRADE_REASON_ENTRY_NEVER_TRUE",
      "bars_total": 504,
      "warmup_bars": 50
    }
  ],
  "attachments": [
    { "uri": "xstockstrat:///backtest/bt-9f2c1a/result.json", "mime_type": "application/json" }
  ]
}
```

Note `"bars_have": "120"` — 64-bit integers render as JSON **strings**, 32-bit ones as numbers
(`total_trades` above). Do not assume a numeric-looking field is a number.

**What stays inline vs. what moves.** The summary keeps everything needed to diagnose the common
failure — the headline metrics, any `coverage_gaps`, and per symbol its `no_trade_reason`,
`bars_total` and `warmup_bars` — so a 0-trade run is explainable **without opening the attachment**.
What moves to the attachment is the bulk: the full per-bar `diagnostics` (OHLCV, computed indicator
values, warm-up flag, per-bar decision) and the full `trades` list. The same int64-as-string rule
applies there, e.g. `volume`.

**No-attachment case.** A run with no diagnostics and no trades — typically
`BACKTEST_STATUS_INSUFFICIENT_DATA` — returns the summary block only, with `"attachments": []`. Its
`coverage_gaps` are inline, so the summary is the whole result. The rule is about content, not
status: any run with nothing to attach behaves this way.

**Degradation.** Whether an attachment is surfaced is client-dependent and outside this platform's
control, so the summary always stands on its own, and `attachments` names what exists (uri +
mime type) even if your client renders no download affordance. If attachment construction fails the
tool still **succeeds** — the backtest ran — and the summary gains an `attachments_error` string.

**Errors**

| Condition | Error |
|---|---|
| Unknown `strategy_id` | `strategy not found` (NOT_FOUND) from analysis |
| `start` after `end` | `ValueError` raised by the client before any RPC |
| Window span over `analysis.backtest.max_range_days` | `INVALID_ARGUMENT` from analysis |
| History too short to warm indicators before `start` | `BACKTEST_STATUS_INSUFFICIENT_DATA` result with `coverage_gaps` (not an RPC error) |
| Analysis service unreachable | `httpx` connection error propagated |

---

### `screen_symbols`

Scans an explicit universe of symbols via `xstockstrat-analysis` `ScreenSymbols` (feature 060) and returns ranked candidates. **Read-only** — sends no admin `x-access-scope` (and no other security metadata). Symbols are passed explicitly; there is no watchlist resolution in this tool.

**Parameters**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `symbols` | `string[]` | Yes | Explicit ticker list to screen, e.g. `["NVDA", "AAPL"]` |
| `criteria` | `object[]` | No | Criterion dicts; each key set: `ref_name`, `kind` (`"SCREEN_KIND_FUNDAMENTAL"` \| `"SCREEN_KIND_TECHNICAL_FORMULA"` \| `"SCREEN_KIND_TECHNICAL_INDICATOR"` \| `"SCREEN_KIND_SIGNAL"`), `metric_name`, `op` (e.g. `"COMPARATOR_GTE"`, `"COMPARATOR_BETWEEN"`), `threshold`, `threshold_high`, `weight`, `hard_filter`, and — for technical kinds — a `component` dict |
| `signal_sources` | `string[]` | No | Signal source names for the signal-blend kind |
| `signal_weight` | `float` | No | Share of score from signals (default `0.0`) |
| `technical_weight` | `float` | No | Share of score from technicals (default `1.0`) |
| `min_conviction` | `float` | No | **Honored as a hard floor** (feature 090): results whose relative-conviction `score` is below the entry threshold for this `min_conviction` (`max(0.5 + min_conviction·0.5, 0.55)`, the same transform a backtest applies) are dropped. `coverage_gaps` are unaffected. Default `0.0` (no floor). |
| `rank_limit` | `int` | No | Cap on returned results; `0` ⇒ analysis-side default (`analysis.screener.default_rank_limit`) |

`kind` and `op` accept either the enum name (string) or a numeric value. For technical kinds,
supply a `component` dict (same shape as a strategy component: `ref_name` / `kind`
(`"builtin"`|`"formula"`) / `indicator` / `formula_id` / `params`); the wrapper maps it via
`_build_component` and sends it, so `SCREEN_KIND_TECHNICAL_FORMULA` /
`SCREEN_KIND_TECHNICAL_INDICATOR` criteria are **scored** (feature 090). An unknown fundamental
`metric_name` — a typo of a closed field, or an open metric that no scanned symbol carries — is
**rejected with `INVALID_ARGUMENT`** rather than silently skipped (only enforceable when
fundamentals are available; a degraded scan still skips them).

**Return**

```json
{
  "results": [
    { "symbol": "NVDA", "score": 0.91, "criterion_scores": { "pe": 1.0 }, "passed": true, "status": "SCREEN_RESULT_STATUS_OK" }
  ],
  "coverage_gaps": [ { "symbol": "TSLA", "timeframe": "TIMEFRAME_1DAY", "bars_have": "5", "bars_need": "50" } ]
}
```

`status` is the `ScreenResultStatus` name (`SCREEN_RESULT_STATUS_OK` | `SCREEN_RESULT_STATUS_INSUFFICIENT_DATA`); `coverage_gaps` lists symbols lacking enough data to screen, each with its `timeframe` (enum name) and `bars_have`/`bars_need` (int64 as JSON **strings**, matching `run_backtest`). Gaps are computed **before** `rank_limit` truncation (feature 090), so an under-covered symbol ranked below the cut still appears.

**Errors**

| Condition | Error |
|---|---|
| Over-cap universe (> `analysis.screener.max_universe_size`) | Truncated analysis-side |
| Unknown fundamental `metric_name` (typo, or absent from every scanned symbol) when fundamentals are available | `INVALID_ARGUMENT` |
| Unknown component `kind` (not `builtin`/`formula`) | `ValueError` client-side, before the gRPC call |
| Analysis service unreachable | gRPC error propagated |

---

### `manage_strategy`

Registers, updates, deactivates, or **reactivates** a stored strategy definition in `xstockstrat-analysis`.
**Admin-scoped write** — forwards the **caller's real derived** `x-access-scope` (feature 092; was a
hardcoded admin scope); a non-admin is rejected `PERMISSION_DENIED` by the analysis `ManageStrategy`
gate.

> **Lifecycle is reversible (feature 089).** `deactivate` sets `active=false`; `reactivate` sets it
> back to `true` and **re-validates the stored definition** (so a reactivate can fail
> `INVALID_ARGUMENT` if a referenced formula went missing while the strategy was retired). `register`
> is strict — re-registering an existing `strategy_id` (active *or* deactivated) returns
> `ALREADY_EXISTS` and **drops** the submitted definition (it does not overwrite); use `update` to
> revise, or `reactivate` to bring one back.

> **`update` is a PARTIAL MERGE (feature 070).** Only the fields you actually pass are changed;
> everything else is preserved server-side. Tuning one parameter is therefore safe:
>
> ```python
> manage_strategy(operation="update", strategy_id="range_mr_v3", cooldown_days=45)
> ```
>
> leaves `components`, `entry_rule`, `exit_rule` and `display_name` untouched. **Before feature 070
> this wiped them**, because the tool defaulted the omitted fields to `""`/`[]` and sent them.
>
> Use [`get_strategy`](#get_strategy) to read the current definition first, and `clear_fields` to
> erase something deliberately — a field you simply don't pass is *preserved*, not cleared, so
> erasure has to be explicit.

**Parameters**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `operation` | `string` | Yes | `"register"`, `"update"`, `"deactivate"`, or `"reactivate"` |
| `strategy_id` | `string` | Yes | Lowercase/underscore identifier, e.g. `"sma_crossover"` |
| `display_name` | `string` | No | Human-readable name |
| `components` | `object[]` | No | `{ref_name, kind ("builtin"\|"formula"), indicator, formula_id, params}` |
| `entry_rule` | `string` | No | JSON-encoded condition tree |
| `exit_rule` | `string` | No | JSON-encoded condition tree |
| `signal_params` | `object` | No | Optional signal-weighting params |
| `cooldown_days` | `int` | No | Per-symbol re-entry cooldown in calendar days. Omit → platform default (31); `0` → no cooldown; negative rejected |
| `clear_fields` | `string[]` | No | Field names to **erase** on `update`, e.g. `["exit_rule"]`. The only way to blank a rule or revert `cooldown_days` to the platform default |

**Return**

```json
{ "strategyId": "sma_crossover", "displayName": "SMA Crossover", "active": true }
```

**Errors**

| Condition | Error |
|---|---|
| Invalid definition (unknown indicator, bad rule JSON, undefined ref_name) | `invalid argument` (INVALID_ARGUMENT) |
| Negative `cooldown_days` | `invalid argument` (INVALID_ARGUMENT) |
| `update` with no fields and no `clear_fields` | `ValueError` raised client-side, before any RPC |
| An `update` that would empty `components` or blank a rule without naming it for erasure | `invalid argument` (INVALID_ARGUMENT) — the server refuses; the message names `update_mask` as the escape hatch |
| `update`/`deactivate`/`reactivate` on unknown strategy | `strategy not found` (NOT_FOUND) |
| `register` on an existing strategy_id (active or deactivated) | `strategy already exists` (ALREADY_EXISTS) |

**Effect on the derived grade.** Changing a scoring-relevant field (`components`, rules,
`cooldown_days`, `signal_params`) changes the strategy's definition fingerprint, so its derived
grade is cleared until a fresh backtest supplies new evidence. A rename does **not** — the
fingerprint excludes `display_name`.

---

### `get_strategy`

Reads a stored strategy's full definition from `xstockstrat-analysis`. Read-only; not admin-scoped
(matching the `GetStrategy` RPC, which the non-admin strategy detail page also uses).

**Parameters**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `strategy_id` | `string` | Yes | The strategy identifier, e.g. `"range_mean_reversion_v3"` |

**Return**

Snake_case keys, matching `manage_strategy`'s input, so a fetch → edit → resend round-trip works
directly:

```json
{
  "strategy_id": "range_mean_reversion_v3",
  "display_name": "Range MR v3",
  "components": [
    {"ref_name": "z", "kind": "COMPONENT_KIND_CUSTOM_FORMULA", "formula_id": "f-abc", "params": {"period": 20.0}}
  ],
  "entry_rule": "{\"fn\": \"<\", \"lhs\": \"z\", \"rhs\": -1.0}",
  "exit_rule": "{\"fn\": \">\", \"lhs\": \"z\", \"rhs\": 1.0}",
  "active": true,
  "live_enabled": false
}
```

`cooldown_days` is omitted when unset (platform default applies) and present when explicitly set —
including an explicit `0`, which means "no cooldown".

**Errors**

| Condition | Error |
|---|---|
| Unknown strategy | `strategy not found` (NOT_FOUND) |

---

### `manage_formula`

Registers, updates, or deletes a custom formula definition in `xstockstrat-indicators`. The formula's `author`/ownership identity is always derived from the OAuth-authenticated caller's own verified claims (feature 111) — it can no longer be asserted as a parameter.

**Parameters**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `operation` | `string` | Yes | `"register"`, `"update"`, or `"delete"` |
| `name` | `string` | register | Formula name (on update, pass only to change it) |
| `description` | `string` | No | Formula description |
| `source` | `string` | register | Python formula source (on update, pass only to change it; cannot be blanked) |
| `is_public` | `bool` | No | Whether the formula is public (register default `false`) |
| `parameters` | `list` | No | Typed parameter definitions `{name, type, default, description, required, min, max}` |
| `outputs` | `list` | No | Declared secondary output series `{name, description}`; addressable in strategy rules as `<ref>.<name>`. The implicit `value` series is always present and must not be declared. |
| `warmup_period` | `int` | No | Bars of warm-up before the formula's outputs are valid |
| `formula_id` | `string` | update/delete | Formula identifier |

**Ownership is derived, not asserted (feature 111).** `author` (register) and the ownership identity checked on `update`/`delete` are both the OAuth-authenticated caller's own `user_id` from their verified claims — there is no `author`/`formula_author_user_id` parameter. A caller can no longer register a formula under someone else's identity (including the reserved `"system"` sentinel), or claim someone else's ownership to update/delete a formula; the indicators backend's own PERMISSION_DENIED check (stored `author` vs. `user_id` mismatch) now always compares against the real caller.

**Update is a partial merge (AIP-161).** Only the fields you pass are changed; omitted fields are
preserved. Pass `is_public=false` to unpublish; omit it to leave it unchanged. At least one field
must be supplied. `source` cannot be blanked. Use `get_formula`/`list_formulas` to read a formula
back before editing.

**Delete is a soft delete.** The formula is marked `deleted` (non-destructive), hidden from
`list_formulas`, and can no longer be updated, but strategies that already reference it keep
evaluating on its last-saved definition — and both their backtests (`run_backtest` →
`warnings`) and live status (`get_strategy` → `warnings`) flag the deletion to the user. You
cannot bind a **new** strategy to a deleted formula (`ManageStrategy` returns `INVALID_ARGUMENT`).

**Return**

```json
{ "formula_id": "f-abc123" }
```

register → `{"formula_id": …}`; update → the full stored formula in camelCase (incl. `deleted`);
delete → `{"success": true}`.

**Errors**

| Condition | Error |
|---|---|
| Caller's derived identity ≠ the formula's stored `author` (update/delete) | `permission denied` (PERMISSION_DENIED) |
| `update`/`delete` on unknown formula | `formula not found` (NOT_FOUND) |
| `update` with no fields supplied | `update requires at least one field to change` |
| `update` on a soft-deleted formula | `formula is deleted and cannot be updated` (FAILED_PRECONDITION) |
| No verified OAuth claims on the request | `RuntimeError` — Streamable HTTP transport required |

---

### `get_formula`

Fetches one custom formula's stored definition from `xstockstrat-indicators`.

**Parameters**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `formula_id` | `string` | Yes | Formula identifier |

**Return** — the formula in camelCase incl. `name`, `description`, `source`, `isPublic`,
`parameters`, `outputs`, `warmupPeriod`, and `deleted` (true when soft-deleted). Use for safe
read-modify-write: read, then `manage_formula(operation="update", …)` with only the changed fields.

---

### `list_formulas`

Lists custom formula definitions from `xstockstrat-indicators`. Soft-deleted formulas are excluded.

**Parameters**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `author_filter` | `string` | No | If non-empty, restrict to formulas authored by this user id |
| `include_public` | `bool` | No | Also include public formulas regardless of `author_filter` (default `true`) |

**Return** — `{"formulas": [<formula in camelCase>, …]}`.

---

### `manage_signal_source`

Registers, updates, reactivates, or deactivates a signal source in `xstockstrat-ingest`.
**Admin-scoped write** — forwards the **caller's real derived** `x-access-scope` (feature 092; was a
hardcoded admin scope); a non-admin is rejected `PERMISSION_DENIED` by the ingest `ManageSignalSource`
gate.

**Honest verbs (feature 088)** — register/update are no longer a blind full-replace upsert:

- **`register`** — strict create. An existing slug returns `ALREADY_EXISTS` (no silent overwrite).
- **`update`** — AIP-161 **partial merge**: pass only the fields you want to change; every omitted
  field is **preserved** (an omitted `credentials_ref` keeps the stored secret — it is no longer
  NULLed). An unknown slug returns `NOT_FOUND`. At least one field must be supplied. `active` and
  `slug` cannot be changed via `update`.
- **`reactivate`** — sets `active=true`; **decoupled** from update (update never touches `active`).
- **`deactivate`** — sets `active=false`.

**Parameters**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `operation` | `string` | Yes | `"register"`, `"update"`, `"reactivate"`, or `"deactivate"` |
| `slug` | `string` | Yes | Source slug |
| `display_name` | `string` | No | Human-readable name (on `update`, changed only if supplied) |
| `source_type` | `string` | No | Source type (on `update`, changed only if supplied) |
| `config_json` | `object` | No | Source configuration (on `update`, changed only if supplied) |
| `extractor_module` | `string` | No | Extractor module name (on `update`, changed only if supplied) |
| `credentials_ref` | `string` | No | Reference to stored credentials — forwarded, **never echoed**. On `update`, omit to preserve the stored ref; pass `""` to clear it |

**Return**

```json
{ "slug": "unusual_whales", "display_name": "Unusual Whales", "source_type": "newsletter", "active": true, "has_credentials": true }
```

**Errors**

| Condition | Error |
|---|---|
| `register` on an existing slug | `signal source already exists` (ALREADY_EXISTS) |
| `update`/`reactivate`/`deactivate` on unknown source | `signal source not found` (NOT_FOUND) |
| `update` masking `active`/`slug`, or update with no fields | `invalid argument` (INVALID_ARGUMENT) |
| `authenticated_website` / `mediated_authenticated_website` with no (merged) credential | `invalid argument` (INVALID_ARGUMENT) |
| `credentials_ref` exposure | **Never** — `credentials_ref` is intentionally omitted from the return and never exposed to Claude (FR-12) |

---

### `trigger_backfill`

Triggers a historical OHLCV backfill via `xstockstrat-ingest` `TriggerBackfill` (feature 066).
**Admin-scoped write** — forwards the **caller's real derived** `x-access-scope` (feature 092;
was a hardcoded admin scope). `TriggerBackfill` is now admin-gated server-side, so a non-admin
caller is rejected `PERMISSION_DENIED` ("admin scope required") rather than queuing a paid job.

**Parameters**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `symbols` | `string[]` | Yes | Explicit ticker list, e.g. `["AAPL", "MSFT"]`; max 50 per call |
| `timeframe` | `string` | No | `"1d"` default; accepts `15m`/`15Min`/`1h`/`1Hour`/`1d`/`1Day` (canonicalized) |
| `start` / `end` | `string` (ISO 8601) | No | Optional range bounds; one-sided allowed; both omitted = service default range |
| `overwrite` | `bool` | No | `false` default; `true` re-fetches bars that already exist |
| `fill_mode` | `string` | No | `"full"` \| `"gaps_only"`; omitted → server default FULL (`gaps_only` fetches only missing ranges) |

**Return**

```json
{ "job_id": "…", "status": "BACKFILL_STATUS_QUEUED" }
```

**Errors**

| Condition | Error |
|---|---|
| Empty/oversized `symbols`, bad `timeframe`/`fill_mode`, `start` after `end` | tool `ValueError` **before** any RPC |
| Bad symbols / provider failures | **No synchronous error** — ingest queues unconditionally; surfaces as a terminal `FAILED`/`PARTIAL` job via `get_backfill_status` |
| Ingest unreachable | gRPC error propagated |

---

### `get_backfill_status`

Checks one backfill job or lists recent jobs via ingest `GetBackfillStatus` / `ListBackfillJobs`.
**Read-only** — sends no admin scope (and no other security metadata).

**Parameters**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `job_id` | `string` | No | When set → single-job mode; empty → list mode |
| `status_filter` | `string` | No | List mode: `queued`/`running`/`completed`/`failed`/`partial`/`canceled`; omit or `unspecified` = all |
| `symbol` | `string` | No | List mode: optional ticker filter |
| `limit` | `int` | No | List mode page size; `0` ⇒ server default (100) |
| `page_token` | `string` | No | Pass the previous response's `next_page_token` to paginate |

**Return**

```json
{ "job": { "status": "…", "bars_processed": "…", "bars_total": "…", "chunks_completed": 0, "chunks_total": 0, "failed_symbols": [], "error": "" } }
```
or, in list mode:
```json
{ "jobs": [ … ], "next_page_token": "…" }
```

**Errors**

| Condition | Error |
|---|---|
| Unknown `job_id` | `backfill job not found` (NOT_FOUND) |
| Unknown `status_filter` | tool `ValueError` enumerating accepted values |

---

### `cancel_backfill`

Cancels a queued/running backfill job via ingest `CancelBackfill`. **Admin-scoped** (forwards
`x-access-scope`) — unlike `trigger_backfill`, this RPC is checked server-side (feature 087).

**Parameters**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `job_id` | `string` | Yes | The job to cancel |

**Return** — `{ "job": { … } }` (the updated `BackfillJob`, status `canceled`).

**Errors**: unknown `job_id` → `backfill job not found` (NOT_FOUND); already-terminal job → server error.

---

### `test_formula`

Dry-runs **inline** formula source in the indicators sandbox via `ExecuteFormula`, **registering
nothing** (feature 087). **Read-only** — no admin scope; the subprocess sandbox is the boundary.
Use before `manage_formula(operation="register", …)` to validate behavior.

**Parameters**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `source` | `string` | Yes | Python formula source (assign a `result` dict with a `value` key) |
| `input_data` | `object` | No | Passed to the formula as `data` (e.g. `{"close": [1,2,3]}`) |
| `input_params` | `object` | No | Parameter VALUES exposed as `params` |
| `parameters` | `list` | No | Typed parameter DEFINITIONS to validate `input_params` for this run |
| `timeout_ms` | `int` | No | `0` ⇒ configured sandbox timeout |

**Return** — the full sandbox result: `success`, `output` (the result dict; **non-finite values such
as `NaN`/`Infinity` are returned as `null`** so the projection never fails), `stdout`, `stderr`,
`error`, `exit_reason`, `parameter_errors`, `execution_ms` (int64 as a JSON string).

---

### `list_strategies`

Lists stored strategy definitions via analysis `ListStrategyDefinitions` (feature 087). **Read-only.**

**Parameters**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `include_inactive` | `bool` | No | Also include deactivated strategies (default `false`) |

**Return** — `{ "strategies": [ <definition>, … ] }`. Each definition is **snake_case**, matching
`get_strategy` (so a `list_strategies → get_strategy → manage_strategy` edit loop stays consistent).

---

### `get_config`

Read a namespace's current config values from `xstockstrat-config`. **Read-only.**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `namespace` | string | yes | `marketdata`, `analysis`, `trading`, `platform`, … |
| `environment` | string | no | `dev` or `production`. Omit to use the agent deployment's own `APPLICATION_ENV` |
| `trading_mode` | string | no | `paper`, `live` or `all`. Omit to use the agent's own `TRADING_MODE` |

Returns `{namespace, version, environment, trading_mode, values}`, each value being
`{value, value_type, is_secret}`.

**Any value flagged `is_secret` is returned as `"[redacted]"`.** Redaction keys on the flag, not on
the key name, so a flagged-but-unprefixed key is still redacted. Secret values are never returned by
this tool.

**Errors:** `NOT_FOUND` → "namespace not found".

---

### `list_config_keys`

List the config keys registered for a namespace, **metadata only — no values**. Read-only, so
nothing here can leak a secret.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `namespace` | string | yes | As above |
| `environment` | string | no | Defaults to the agent's `APPLICATION_ENV` |
| `trading_mode` | string | no | Defaults to the agent's `TRADING_MODE` |

Returns `{namespace, environment, trading_mode, keys[]}`; each key carries `key`, `description`,
`default_value`, `is_secret`, `consuming_service`.

Use it to discover what exists — and which keys are secret — before calling `set_config`.

---

### `set_config`

Write **one non-secret** config value. **Admin-scoped write. Streamable HTTP transport only.**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `namespace` | string | yes | e.g. `marketdata` |
| `key` | string | yes | e.g. `marketdata.fmp.enabled` |
| `value_type` | enum | yes | `string` \| `int` \| `float` \| `bool` |
| `value` | string | yes | Converted according to `value_type` |
| `author` | string | yes | Recorded in `config.config_audit` |
| `reason` | string | yes | Recorded alongside `author` |
| `environment` | string | no | Defaults to the agent's `APPLICATION_ENV` |
| `trading_mode` | string | no | Defaults to the agent's `TRADING_MODE` |
| `create_key` | bool | no | Default `false`. Set `true` **only** to deliberately register a brand-new key at this `(namespace, environment, trading_mode)` scope. Left false, a write to an unregistered scope is refused (see Errors) so a typo cannot mint an orphan key (feature 091). |

Returns `{version, updated_at}` — **never the value**.

**Authorization uses your real role, not a service-wide admin override.** `set_config` forwards the
calling user's derived `x-access-scope`, so `xstockstrat-config` rejects a non-admin caller with
`PERMISSION_DENIED` ("admin scope required"). Since feature 092 this is how **every** management
write tool works (it was `set_config`-only under feature 073); the hardcoded admin scope was removed
(invariant **AGENT-3/AGENT-4**).

**Secret keys cannot be written.** Rejected both by the `secret.` name prefix (checked before any
RPC — the only thing that can stop a *new* secret key being created) and by the `is_secret` flag
read from `ListKeys`. Credentials are delivered as `type: SECRET` environment variables. If the
flag lookup fails, the write is refused rather than allowed through.

**Transport.** Requires Streamable HTTP — since feature 079 the only remote transport the agent
serves. The tool still refuses when no verified caller claims are on the request; that check is now
defence in depth rather than the live transport guard.

**Key creation is gated (feature 091).** A write to a not-yet-registered key at the exact
`(namespace, environment, trading_mode)` scope is refused with `NOT_FOUND` unless you pass
`create_key=true`. This closes the old blind-upsert hole where a mistyped key silently created an
orphan row no service reads. `list_config_keys` first and copy the key verbatim; use `create_key`
only when you genuinely intend to register a new key. (The only key-creation paths are now migration
seeds and `set_config(create_key=true)` — config-ui can no longer typo-mint keys, so "new keys
require a PR" is enforced, not merely conventional.)

**Three behaviors worth knowing before you rely on a write:**

- `value_type` is honored only when **creating** a key. `SetConfig`'s `ON CONFLICT … DO UPDATE`
  does not update the type column, so for an existing key the stored type wins.
- Pass JSON-valued config as a `string` — that is byte-identical to what the server stores.
- **Key creation is audited** (feature 091): a `create_key=true` create writes a `config.config_audit`
  row (author + value, `old_value` NULL) via a dedicated `AFTER INSERT` trigger, alongside the
  existing `BEFORE UPDATE` audit. Rewriting a key to its existing value still writes no row (the
  update trigger fires only on a value change).

**Errors:** `PERMISSION_DENIED` → "admin scope required"; `INVALID_ARGUMENT` → missing author;
`NOT_FOUND` → "config key not registered" (pass `create_key=true` to create it).

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
                  author="<user_id>")
   → formula_id

2. manage_strategy(operation="register", strategy_id="rsi_sma_combo",
                  display_name="RSI + SMA",
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
