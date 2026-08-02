# xstockstrat-agent — CLAUDE.md

<!-- context-forge:constitution-pointer:start -->
> **Constitution:** non-obvious local invariants (ephemeral per-call gRPC channels, lazy `gen.*` imports, caller-derived admin scope on management write tools, `MCP_AGENT_SECRET` triple-purpose, `aud`-bound JWT) live in [`docs/context-constitution.md`](docs/context-constitution.md); defects (`namespace="agent"` hardcode, `MCP_TRANSPORT` stdio default) in [`docs/context-constitution-findings.md`](docs/context-constitution-findings.md). Inherits the root [`PLAT-*` constitution](../../docs/context-constitution.md).
<!-- context-forge:constitution-pointer:end -->

## Role

Python MCP (Model Context Protocol) server exposing AI-agent tools for signal ingestion,
alerting, backtesting, strategy/formula/source management, and live-strategy control
(`MCP_TRANSPORT=http`, port 9000). It serves **one remote MCP transport** from a root ASGI
dispatcher (`app/main.py` `handle_mcp`): **Streamable HTTP** (MCP 2025-03-26) at the agent root
`/` — which is what the **Claude.ai remote connector** speaks against the connector URL
(`AGENT_PUBLIC_URL`, `${APP_URL}/agent`, stripped to `/` by DO ingress). The legacy HTTP+SSE
transport at `/sse` + `/messages` was **removed by feature 079**; those paths now return 404
naming the replacement URL. `MCP_TRANSPORT=sse` remains accepted as a deprecated alias for
`http` (it logs a warning and starts the same server), as does `MCP_SSE_PORT` for
`MCP_HTTP_PORT`. `MCP_TRANSPORT=stdio` is unaffected and stays for local use.
All outbound gRPC calls to platform services carry `x-mcp-secret` when `MCP_AGENT_SECRET` is
set; every management **write** tool forwards the **real caller's derived** `x-access-scope` so the
backends' role checks *verify* admin (feature 092 generalized this from the feature-073
`set_config`-only case; the old hardcoded admin scope was removed). See § Management-tool
authorization.

## Language

Python 3.12 (asyncio, grpc.aio, mcp SDK v2 MCPServer)

## MCP Tools

The agent registers twenty-two tools (see `docs/runbooks/mcp-tools.md` for full parameter/return/error
reference):

| Tool | Purpose |
|---|---|
| `list_signal_sources` | List active signal sources (enriched with `extractor_tool`) |
| `extract_email_content` | Extract text from email attachments / gated URLs |
| `extract_website_content` | Fetch text from a registered website source |
| `ingest_signal` | Ingest a trading signal (auto-alerts above conviction threshold) |
| `emit_alert` | Emit an alert via xstockstrat-notify |
| `run_backtest` | Trigger a backtest via xstockstrat-analysis (optional `start`/`end` evaluation window — feature 071); returns a compact summary block plus the full result as an attached `application/json` resource (feature 072) |
| `screen_symbols` | Scan a symbol universe via xstockstrat-analysis and return ranked candidates (read-only) |
| `manage_strategy` | Register/update/deactivate stored strategies (`update` is a **partial merge** — feature 070) |
| `get_strategy` | Read a stored strategy's full definition (read-only, feature 070) |
| `manage_formula` | Register/update/delete custom formulas |
| `get_formula` | Read one stored formula's full definition incl. `deleted` (read-only, feature 086) |
| `list_formulas` | List formula definitions, soft-deleted excluded (read-only, feature 086) |
| `manage_signal_source` | Register/update/reactivate/deactivate signal sources (honest verbs — feature 088) |
| `set_strategy_live` | Enable/disable continuous live evaluation + alerting for a strategy (feature 048) |
| `trigger_backfill` | Trigger an OHLCV history backfill via xstockstrat-ingest (admin-scoped write, feature 066) |
| `get_backfill_status` | Check one backfill job or list recent jobs (read-only, feature 066) |
| `cancel_backfill` | Cancel a queued/running backfill job (admin-scoped, feature 087) |
| `test_formula` | Dry-run inline formula source in the sandbox, registers nothing (read-only, feature 087) |
| `list_strategies` | List stored strategy definitions (read-only, feature 087) |
| `get_config` | Read a namespace's current config values, secret values redacted (read-only, feature 073) |
| `list_config_keys` | List a namespace's registered config keys, metadata only (read-only, feature 073) |
| `set_config` | Write one non-secret config value (admin-scoped write, feature 073); a write to an unregistered key scope is refused `NOT_FOUND` unless `create_key=true` (feature 091) |

### Management-tool authorization

The four management **write** tools that hit a backend admin gate — `manage_strategy`,
`manage_signal_source`, `set_strategy_live`, `trigger_backfill` — forward the **real calling
user's** derived `x-access-scope` on their backend gRPC calls (feature 092; `set_config` has done
this since feature 073). The scope is derived from the caller's identity roles by `app/scopes.py`
`roles_to_access_scope` (a port of the UI's `rolesToAccessScope`) via the shared
`app/tools.py` `_caller_access_scope(ctx, tool)` helper, so a **non-admin operator is rejected
`PERMISSION_DENIED`** by the backend gate (analysis `ManageStrategy`/`SetStrategyLive`, ingest
`ManageSignalSource`/`TriggerBackfill` — all check the ADMIN bit `0x04`) rather than silently
succeeding under a hardcoded admin override. The claims come from `app/main.py` `_authorized`, which
publishes them on the request's ASGI scope under `MCP_CLAIMS_SCOPE_KEY`; each tool reads them via its
injected `ctx: Context`. The old hardcoded `_admin_metadata()` (`x-access-scope=7`) tuple was
**removed** by feature 092.

**`manage_formula` is different** — it forwards **no** admin scope (plain `_metadata()`); the
indicators backend enforces an **author-ownership** check instead (admin is only an override there).
It is not a hardcoded-admin forwarder and was left unchanged by feature 092.

**`EmitAlert` (xstockstrat-notify) is intentionally ungated** (feature 092): it is an internal
service-caller RPC on the private gRPC network whose trust boundary is the network plus the agent's
OAuth edge — every caller (the agent, plus analysis/ingest/trading loops) is internal and sends no
admin scope, so a per-call role gate would break them all. Documented as an explicit contract, not an
oversight.

That plumbing is also why these tools refuse when no verified claims are present. Feature 079
**removed** the legacy SSE transport whose `POST /messages` returned before `_authorized` ran, so
every tool call now passes the gate and the check is **defence in depth** rather than the live
transport guard. It must keep its current shape: back when both transports existed, a check based
on the request object would *not* have told them apart — both handed a tool a Starlette `Request`
carrying an `Authorization` header, so only the absence of verified claims distinguished them.

`set_config` also refuses any `is_secret` key (checked by name prefix *and* by the flag from
`ListKeys`): credentials are delivered as `type: SECRET` environment variables, never as config
values.

**Key-creation gate (feature 091).** `set_config` forwards a `create_key` flag
(`SetConfigRequest.create_key`, default false). `xstockstrat-config` refuses a write to a
not-yet-registered `(namespace, key, environment, trading_mode)` scope with `NOT_FOUND` unless
`create_key=true`, so a mistyped key can no longer silently mint an orphan row. The refusal is
enforced **server-side** (the agent is a pure passthrough — no client-side existence check), and
key creation is audited. This is purely additive to the secret-refusal and real-scope-forwarding
behavior above.

### OAuth 2.1 edge auth (feature 049 Part B)

The agent is the OAuth 2.1 **Resource Server + Authorization-Server HTTP facade** for its MCP
endpoint, and is **stateless**: all durable OAuth state (clients, auth codes, refresh tokens) lives
in `xstockstrat-identity` and is reached over gRPC (`app/client.py`). The only cross-request linkage
is the HMAC-signed `txn` blob carried in URLs (`app/oauth_server.py`, signed with `MCP_AGENT_SECRET`),
so there is **no in-memory store** and `instance_count > 1` is safe (FR-B13).

Routes (registered in `app/main.py` `build_http_app`):

| Route | Purpose |
|---|---|
| `/.well-known/oauth-protected-resource` | RFC 9728 protected-resource metadata |
| `/.well-known/oauth-authorization-server` | RFC 8414 authorization-server metadata |
| `POST /oauth/register` | RFC 7591 Dynamic Client Registration (public client, https-only) |
| `GET /oauth/authorize` | PKCE/S256 + exact-redirect validation; delegates login to the UI |
| `GET /oauth/callback` | Derives user from the same-origin `access_token` cookie; mints the code |
| `POST /oauth/token` | `authorization_code` + `refresh_token` grants (tokens in JSON body only) |
| `/` (GET/POST) | **Streamable HTTP** MCP endpoint (Claude.ai remote connector) |
| `/sse` + `/messages` | **Removed** (feature 079) — return `404 text/plain` naming the replacement URL, *before* the auth gate |
| `GET /api/tools` | Tool catalog (name/description/inputSchema) — **unauthenticated**, capability metadata only; powers the `xstockstrat-ui` `/accounts/mcp-tools` page |

The MCP endpoint (root Streamable HTTP) requires an **`aud`-bound JWT** (`aud` ==
`AGENT_PUBLIC_URL`); unauthenticated requests get `401` with a
`WWW-Authenticate: Bearer resource_metadata=…` discovery pointer. Note the **RFC 8414/9728 path
insertion** quirk: because `AGENT_PUBLIC_URL` has a path (`/agent`), spec-compliant clients fetch
the AS/PR metadata at `https://<host>/.well-known/oauth-authorization-server/agent`, which lands on
`xstockstrat-ui` (the `/` catch-all), so the UI also serves that canonical metadata (UI
`next.config.js` rewrites → `/api/oauth/*`). `AGENT_PUBLIC_URL` builds all absolute
discovery/endpoint URLs (in DO it is `${APP_URL}/agent`).

## Config Keys Consumed

Namespace: `agent` (resolved via one-shot `GetConfig` → `client.get_config_value(key,
namespace="agent", environment=<resolved>, trading_mode=<resolved>)`). **Feature 093:** the read is
now **environment-scoped** (`namespace`/`environment` are required — the old signature hardcoded
`namespace="agent"` and sent no environment, so a production agent read the dev row) and projects the
**active oneof** stringified (a `float`/`bool` key like `signal.alert_threshold` used to read back as
`None`); a transport failure is surfaced, not swallowed to `None`.

| Key | Type | Default | Description |
|---|---|---|---|
| `agent.oauth.registration_enabled` | bool | `true` | Allow RFC 7591 DCR at `/oauth/register` (disabled ⇒ 403) |
| `agent.oauth.allowed_redirect_uris` | string | `""` | Comma-separated exact redirect URIs; empty = require `https://` at registration only |
| `agent.signal.alert_threshold` | float | `0.6` | Conviction threshold above which `ingest_signal` auto-emits an alert (feature 093 — was env-blind, so effectively always the default; now env-scoped, best-effort) |

## Environment Variables

```text
MCP_TRANSPORT=http   # `sse` still accepted as a deprecated alias
MCP_HTTP_PORT=9000   # `MCP_SSE_PORT` still accepted as a deprecated fallback
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

**CI (feature 065):** the agent suite now runs in CI — `python-lint` (ruff) and `python-test`
(`pytest --cov=app`, threshold **40**) matrix entries in `.github/workflows/ci.yml`, gated by a
`services/xstockstrat-agent/**` changes filter. It is no longer local-only.
