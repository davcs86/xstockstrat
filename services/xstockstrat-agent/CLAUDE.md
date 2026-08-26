# xstockstrat-agent — CLAUDE.md

<!-- context-forge:constitution-pointer:start -->
> **Constitution:** non-obvious local invariants (ephemeral per-call gRPC channels, lazy `gen.*` imports, caller-derived admin scope on management write tools, `JWT_SECRET` OAuth-txn-signing, `aud`-bound JWT) live in [`docs/context-constitution.md`](docs/context-constitution.md); defects (`namespace="agent"` hardcode, `MCP_TRANSPORT` stdio default) in [`docs/context-constitution-findings.md`](docs/context-constitution-findings.md). Inherits the root [`PLAT-*` constitution](../../docs/context-constitution.md).
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
The agent is a platform **edge** and forwards the full propagation trio — `x-user-id` +
`x-access-scope` + `x-trace-id` — on **every** outbound backend gRPC (PR #994), sourced from the
caller's verified OAuth claims with a fresh `x-trace-id` minted at the edge when absent. This is
wired by one `CallerPropagationMiddleware` (`app/tools.py`) that binds the identity onto `client`'s
per-request contextvar for each `tools/call`; there is **no per-tool plumbing** (see constitution
**AGENT-4**). Backend role checks *verify* admin from the forwarded `x-access-scope` (feature 092
generalized this from the feature-073 `set_config`-only case; the old hardcoded admin scope was
removed). The strategy tools (`manage_strategy`/`set_strategy_live`) are the exception since feature
133 — they are **ownership**-gated on the forwarded `x-user-id`, not admin-gated. See §
Management-tool authorization.

## Language

Python 3.12 (asyncio, grpc.aio, mcp SDK v2 MCPServer)

## MCP Tools

The agent registers thirty tools (see `docs/runbooks/mcp-tools.md` for full parameter/return/error
reference):

| Tool | Purpose |
|---|---|
| `list_signal_sources` | List active signal sources (enriched with `extractor_tool`) |
| `extract_email_content` | Extract text from email attachments / gated URLs |
| `extract_website_content` | Fetch text from a registered website source |
| `ingest_signal` | Ingest a trading signal (auto-alerts above conviction threshold) |
| `emit_alert` | Emit an alert via xstockstrat-notify |
| `run_backtest` | Trigger a backtest via xstockstrat-analysis (optional `start`/`end` evaluation window — feature 071; optional `sizing_mode="portfolio"` for a shared-capital portfolio model — feature 150; optional `fill_model="next_bar_open"` for bias-free next-bar-open fills — feature 151); returns a compact summary block (incl. `sizing_mode`, `fill_model`, + a `capital_skips` count) plus the full result as an attached `application/json` resource (feature 072) |
| `screen_symbols` | Scan a symbol universe via xstockstrat-analysis and return ranked candidates (read-only) |
| `manage_strategy` | Register/update/deactivate stored strategies (`update` is a **partial merge** — feature 070) |
| `get_strategy` | Read a stored strategy's full definition (read-only, feature 070) |
| `manage_formula` | Register/update/delete custom formulas |
| `get_formula` | Read one stored formula's full definition incl. `deleted` (read-only, feature 086) |
| `list_formulas` | List formula definitions, soft-deleted excluded (read-only, feature 086) |
| `manage_signal_source` | Register/update/reactivate/deactivate signal sources (honest verbs — feature 088) |
| `set_strategy_live` | Enable/disable continuous live evaluation + alerting for a strategy (feature 048) |
| `run_fundamentals_scan` | Manually trigger the fundamentals signal producer scan (admin-scoped write, feature 156); wraps the existing `RunFundamentalsScan` RPC — `force`/`dry_run`/`symbols` |
| `trigger_backfill` | Trigger an OHLCV history backfill via xstockstrat-ingest (admin-scoped write, feature 066) |
| `get_backfill_status` | Check one backfill job or list recent jobs (read-only, feature 066) |
| `cancel_backfill` | Cancel a queued/running backfill job (admin-scoped, feature 087) |
| `test_formula` | Dry-run inline formula source in the sandbox, registers nothing (read-only, feature 087) |
| `list_strategies` | List stored strategy definitions (read-only, feature 087) |
| `get_config` | Read a namespace's current config values, secret values redacted (read-only, feature 073); scoped by an optional per-user `user_id` — the **environment is always this agent deployment's own** (`APPLICATION_ENV`, no caller override, PR #994) |
| `list_config_keys` | List a namespace's registered config keys, metadata only (read-only, feature 073); environment is the agent's own deployment env (no caller override, PR #994) |
| `set_config` | Write one config value **including secrets** (admin-scoped write, feature 073; secret values are encrypted at rest by the config service, PR #994); takes an optional `user_id` (per-user override; secrets are global-only) — no `trading_mode`, and no caller-facing `environment` (always the deployment env, PR #994); a write to an unregistered `(namespace,key,environment,user_id)` scope is refused `NOT_FOUND` unless `create_key=true` (feature 091) |
| `get_user_metadata` | Fetch the calling user's own profile metadata (read-only, feature 130) |
| `set_user_metadata` | Partial-update the calling user's own profile metadata (feature 130) |
| `list_watchlists` | List the caller's own watchlists from portfolio, paginated (read-only, feature 148) |
| `get_watchlist` | Read one of the caller's watchlists incl. its stocks (read-only, feature 148) |
| `manage_watchlist` | Create/update/delete a caller-owned watchlist; `update` is a **read-modify-write merge** over the replace-only `UpdateWatchlist` RPC so a name-only edit never wipes the stocks (feature 148) |
| `manage_watchlist_symbols` | Add/remove stocks on a caller-owned watchlist; `add` records `MANUAL`-sourced entries (feature 148) |
| `manage_offline_account` | Create a caller-owned OFFLINE account, record its orders, confirm their fills (recomputes positions + realized P&L), and read its orders/positions — the manual-book reconciliation surface (feature 157) |

### Management-tool authorization

Two management **write** tools still hit a backend **admin** gate — `manage_signal_source` and
`trigger_backfill` — and forward the **real calling user's** derived `x-access-scope` on their
backend gRPC calls (feature 092; `set_config` has done this since feature 073). The scope is derived
from the caller's identity roles by `app/scopes.py` `roles_to_access_scope` (a port of the UI's
`rolesToAccessScope`) via the shared `app/tools.py` `_caller_access_scope(ctx, tool)` helper, so a
**non-admin operator is rejected `PERMISSION_DENIED`** by the backend gate (ingest
`ManageSignalSource`/`TriggerBackfill` — both check the ADMIN bit `0x04`) rather than silently
succeeding under a hardcoded admin override. The claims come from `app/main.py` `_authorized`, which
publishes them on the request's ASGI scope under `MCP_CLAIMS_SCOPE_KEY`; each tool reads them via its
injected `ctx: Context`. The old hardcoded `_admin_metadata()` (`x-access-scope=7`) tuple was
**removed** by feature 092.

**`manage_strategy` / `set_strategy_live` are now ownership-gated, not admin-gated (feature 133).**
The analysis `ManageStrategy`/`SetStrategyLive` admin gate was **removed**: strategies are per-user
(composite `(user_id, strategy_id)` PK), so **any authenticated caller acts on their OWN strategies**
and a non-owner is rejected `PERMISSION_DENIED`. Both tools (and the read tools `run_backtest`,
`get_strategy`, `list_strategies`) forward the caller's own **`x-user-id`** — resolved via
`_caller_user_id(ctx, tool)` — so analysis resolves ownership from the header (never the request
body). They still also forward `x-access-scope` for defence-in-depth, but it is no longer the gate.

**The watchlist tools are ownership-gated too (feature 148).** `list_watchlists`, `get_watchlist`,
`manage_watchlist`, and `manage_watchlist_symbols` forward **only** the caller's own `x-user-id` (via
`_caller_user_id` + `_metadata(("x-user-id", …))`) and never an admin `x-access-scope` —
`xstockstrat-portfolio` resolves ownership from the header (`loadOwned`) and returns
`PERMISSION_DENIED` for a non-owner. `manage_watchlist`'s `update` verb is a **read-modify-write
merge**: because the backend `UpdateWatchlist` is replace-all (its repo clears then re-inserts the
stock rows), the tool `GetWatchlist`s first and preserves every field the caller omitted, so a
name-only update cannot wipe the list's stocks. New entries the curation tools add are stamped
`WATCHLIST_ENTRY_SOURCE_MANUAL`, distinct from the `SIGNAL` entries the `ingest_signal`
`direction='watchlist'` path adds.

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

`set_config` **can write `is_secret` keys** (PR #994 lifted the earlier client-side refusal). The
value is encrypted at rest by `xstockstrat-config` (AES-256-GCM, `is_secret` **row-authoritative on
write**), so an admin may rotate a secret through the MCP just like any other key — the plaintext is
never echoed back or broadcast, `get_config` still redacts it, and only `xstockstrat-marketdata`-style
internal callers can decrypt it via the config service's `GetSecret` RPC. Secret writes are
**global-scope only** (a per-user secret write is rejected `INVALID_ARGUMENT` by the backend), and the
backend **admin gate** is what authorizes the write. The `secret.*` name prefix is retired — `is_secret`
is the sole signal.

**Key-creation gate (feature 091).** `set_config` forwards a `create_key` flag
(`SetConfigRequest.create_key`, default false). `xstockstrat-config` refuses a write to a
not-yet-registered `(namespace, key, environment, user_id)` scope with `NOT_FOUND` unless
`create_key=true`, so a mistyped key can no longer silently mint an orphan row. The refusal is
enforced **server-side** (the agent is a pure passthrough — no client-side existence check), and
key creation is audited. This is purely additive to the secret-refusal and real-scope-forwarding
behavior above.

### OAuth 2.1 edge auth (feature 049 Part B)

The agent is the OAuth 2.1 **Resource Server + Authorization-Server HTTP facade** for its MCP
endpoint, and is **stateless**: all durable OAuth state (clients, auth codes, refresh tokens) lives
in `xstockstrat-identity`, reached over gRPC, with the only cross-request linkage an HMAC-signed
`txn` blob carried in URLs (signed with `JWT_SECRET` since feature 147, which removed the dedicated
`MCP_AGENT_SECRET`) — so `instance_count > 1` is safe. The MCP endpoint requires an
**`aud`-bound JWT** (`aud` == `AGENT_PUBLIC_URL`). Full route table, the `aud`-binding contract, and
the RFC 8414/9728 discovery path-insertion quirk live on-demand in this service's `docs/` folder
(**`oauth.md`**).

## Config Keys Consumed

Namespace: `agent`, resolved via `client.get_config_value()` — env-scoped since feature 093; see
its docstring for the read signature and oneof-stringify behavior.

| Key | Type | Default | Description |
|---|---|---|---|
| `agent.oauth.registration_enabled` | bool | `true` | Allow RFC 7591 DCR at `/oauth/register` (disabled ⇒ 403) |
| `agent.oauth.allowed_redirect_uris` | string | `""` | Comma-separated exact redirect URIs; empty = require `https://` at registration only |
| `agent.signal.alert_threshold` | float | `0.6` | Conviction threshold above which `ingest_signal` auto-emits an alert (feature 093 — was env-blind, so effectively always the default; now env-scoped, best-effort) |

## Environment Variables

```text
MCP_TRANSPORT=http   # `sse` still accepted as a deprecated alias
MCP_HTTP_PORT=9000   # `MCP_SSE_PORT` still accepted as a deprecated fallback
JWT_SECRET=<shared secret>   # HMAC-signs the OAuth txn blob (feature 147, replacing the removed MCP_AGENT_SECRET) — not sent as an outbound header
INGEST_ENDPOINT=xstockstrat-ingest:50055
NOTIFY_ENDPOINT=xstockstrat-notify:50059
ANALYSIS_ENDPOINT=xstockstrat-analysis:50056
INDICATORS_ENDPOINT=xstockstrat-indicators:50054
IDENTITY_ENDPOINT=xstockstrat-identity:50058
CONFIG_ENDPOINT=xstockstrat-config:50060
PORTFOLIO_ENDPOINT=xstockstrat-portfolio:50052
TRADING_ENDPOINT=xstockstrat-trading:50051
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
