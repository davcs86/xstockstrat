# xstockstrat-agent — CLAUDE.md

<!-- context-forge:constitution-pointer:start -->
> **Constitution:** non-obvious local invariants (ephemeral per-call gRPC channels, lazy `gen.*` imports, caller-derived admin scope on management write tools, `JWT_SECRET` OAuth-txn-signing, `aud`-bound JWT) live in [`docs/context-constitution.md`](docs/context-constitution.md); defects (`MCP_TRANSPORT` stdio default) in [`docs/context-constitution-findings.md`](docs/context-constitution-findings.md). Inherits the root [`PLAT-*` constitution](../../docs/context-constitution.md).
<!-- context-forge:constitution-pointer:end -->

## Role

Python MCP (Model Context Protocol) server exposing AI-agent tools for signal ingestion,
alerting, backtesting, strategy/formula/source management, and live-strategy control
(`MCP_TRANSPORT=http`, port 9000). It serves **one remote MCP transport** from a root ASGI
dispatcher (`app/main.py` `handle_mcp`): **Streamable HTTP** (MCP 2025-03-26) at the agent root
`/` — which is what the **Claude.ai remote connector** speaks against the connector URL
(`AGENT_PUBLIC_URL`, `${APP_URL}/agent`, stripped to `/` by DO ingress). The legacy HTTP+SSE
transport at `/sse` + `/messages` was **removed by feature 079**; those paths now return 404
naming the replacement URL.
The agent is a platform edge: `CallerPropagationMiddleware` forwards the `x-user-id` /
`x-access-scope` / `x-trace-id` trio on every backend gRPC from verified claims (constitution
**AGENT-4**). Identity travels only in `x-user-id`; set a body `user_id` only when it is a target/scope
selector (e.g. `ListOrders` filter, config per-user scope, `emit_alert` target, `IssueAuthCode`
subject), never to name the caller. Backend role checks *verify* admin from the forwarded
`x-access-scope`. The strategy tools (`manage_strategy`/`set_strategy_live`) are the exception since feature
133 — they are **ownership**-gated on the forwarded `x-user-id`, not admin-gated. See §
Management-tool authorization.

## MCP Tools

The agent registers forty-five tools plus one MCP prompt (`list_correlation_guide`, feature 197) and a
server `instructions` string (`create_server`, `app/main.py`); the full per-tool parameter/return/error
reference is `docs/runbooks/mcp-tools.md`.

### Management-tool authorization

Tool refusals are raised as `ToolError` with a `CODE: body` message so the MCP caller sees why a call was refused (constitution **AGENT-5**).

The management tools that hit a backend **admin** gate — `trigger_backfill`, `cancel_backfill`,
`run_fundamentals_scan`, and a **global** (`user_id` omitted) `set_config` write — forward the **real
calling user's** derived `x-access-scope` on their backend gRPC calls (feature 092;
`set_config` has done this since feature 073). The scope is derived from the caller's identity roles
by `app/scopes.py` `roles_to_access_scope` (a port of the UI's `rolesToAccessScope`) via the shared
`app/tools.py` `_caller_access_scope(ctx, tool)` helper, so a **non-admin operator is rejected
`PERMISSION_DENIED`** by the backend gate (ingest `TriggerBackfill` checks the ADMIN bit `0x04`)
rather than silently succeeding under a hardcoded admin override. `manage_signal_source` is
**owner-gated** since feature 224: any caller manages their own sources (ingest resolves the owner
from `x-user-id`), and platform `system` sources are read-only to everyone. The claims come from `app/main.py` `_authorized`, which
publishes them on the request's ASGI scope under `MCP_CLAIMS_SCOPE_KEY`; each tool reads them via its
injected `ctx: Context`.

**User-admin tools** (`manage_user`, `list_users`, `get_user`, `admin_*_user_metadata`, feature 183)
call `_require_admin` before any backend call; the target user is the body `user_id`, never
`x-user-id`; passwords are never echoed or logged.

**`manage_strategy` / `set_strategy_live` are now ownership-gated, not admin-gated (feature 133).**
The analysis `ManageStrategy`/`SetStrategyLive` admin gate was **removed**: strategies are per-user
(composite `(user_id, strategy_id)` PK), so **any authenticated caller acts on their OWN strategies**
and a non-owner is rejected `PERMISSION_DENIED`. Both tools (and the read tools `run_backtest`,
`get_strategy`, `list_strategies`) forward the caller's own **`x-user-id`** — resolved via
`_caller_user_id(ctx, tool)` — so analysis resolves ownership from the header (never the request
body).

**`manage_strategy operation='score'` depends on a gRPC trailer contract (feature 283).** It reads
trailer `x-score-excluded-symbols` (a compact JSON array of strings) from analysis's `ScoreStrategy`
via the call-object form (`call = stub.ScoreStrategy(...)`, then `await call.trailing_metadata()`);
a missing or unparseable trailer yields `excluded_symbols: null` plus a WARN. Both services' suites
assert the key literal (`tests/test_score_trailer_loopback.py`).

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
A symbol the platform cannot serve (OTC, or not an active tradable US equity) is **refused, not
added** (feature 282): `create`, the read-modify-write `update` and `add` always return a `refused`
list of `{symbol, reason}` (`reason` = `UNSERVABLE_REASON_OTC` | `UNSERVABLE_REASON_NOT_TRADABLE`),
and a name-only `update` drops and reports a stored symbol that is now unservable; the
`default_strategy_id` field-mask update never classifies. `ingest_signal`'s watchlist auto-add
reports a refusal as `watchlist_refused` (present only when non-empty) and still succeeds. A mistyped
or newly listed ticker is refused until the next asset-set refresh (default 6h, max 24h).

**`manage_formula` is different** — it forwards **no** admin scope (plain `_metadata()`); the
indicators backend enforces an **author-ownership** check instead (no admin override since feature 224;
`system`-authored formulas are immutable to every caller).
It is not a hardcoded-admin forwarder and was left unchanged by feature 092.

`manage_signal_source`/`instantiate_template` write a source bearer as the caller's own per-user secret
under an opaque `ingest.mcp_credential.<uuid>` key.

### OAuth 2.1 edge auth (feature 049 Part B)

Stateless OAuth 2.1 RS + AS facade (state lives in identity; the `txn` blob is HMAC-signed with
`JWT_SECRET`); MCP requires an `aud`-bound JWT (`aud` == `AGENT_PUBLIC_URL`). Routes, the `aud`-binding
contract and the discovery path-insertion quirk → `oauth.md` in this service's `docs/` folder.

## Config Keys Consumed

Namespace: `agent` (plus `indicators` for the formula deadline). Keys are listed and read as namespace-relative
(`signal.alert_threshold`); logs and tool text may print the FQN `agent.<key>`. Reads are lifespan `WatchConfig`
snapshot lookups (constitution **AGENT-9**); an absent key falls back to the caller's default. The `ExecuteFormula`
deadline is derived per call by `client.formula_deadline_s()`: `sandbox.timeout_ms` plus `sandbox.startup_grace_ms`
(both namespace `indicators`) plus a fixed margin, capped at `_LONG_RPC_TIMEOUT_S` with a WARN.

| Key | Type | Default | Description |
|---|---|---|---|
| `oauth.registration_enabled` | bool | `true` | Allow RFC 7591 DCR at `/oauth/register` (disabled ⇒ 403) |
| `oauth.allowed_redirect_uris` | string | `""` | Comma-separated exact redirect URIs; empty = require `https://` at registration only |
| `signal.alert_threshold` | float | `0.6` | Conviction threshold above which `ingest_signal` auto-emits an alert (feature 093 — was env-blind, so effectively always the default; now env-scoped, best-effort) |
| `extract.max_redirects` | int | `5` | Max redirect hops the `extract_*` fetch path follows; each hop's scheme + resolved address is re-validated (SSRF hardening, feature 207) |
| `extract.max_bytes` | int | `5000000` | Max response body bytes read before the `extract_*` fetch aborts (feature 207) |
| `extract.connect_timeout_seconds` | float | `10.0` | Connect timeout for the `extract_*` fetch (feature 207) |
| `extract.read_timeout_seconds` | float | `30.0` | Read timeout for the `extract_*` fetch (feature 207) |
| `opportunities.read_timeout_seconds` | float (int accepted) | `40` | gRPC deadline (s) on analysis `ListOpportunities` (feature 227); invalid/≤0 → `40`; bounded `[30,55]`; seeded by config migration `041` |

## Observability (feature 294-signal-map-instrumentation)

- No `loop tick ok`: the agent has no tick loops.
- Instruments are declared in `app/telemetry.py`; their label values are closed sets.
- Load-bearing logs: INFO `first successful tool call` once per user per process; ERROR `Unexpected error validating JWT claims: <ExceptionClass>: ...` names the exception class and never the token; the OAuth grant-failure WARN carries the gRPC code name.

## Environment Variables

> mTLS: `MTLS_CERT`/`MTLS_KEY`/`MTLS_CA_CERT` required — fail-closed client dials via `app/mtls.py` `secure_channel` (root CLAUDE.md § Environment Variable Naming Convention).

```text
MCP_TRANSPORT=http   # `sse` still accepted as a deprecated alias
MCP_HTTP_PORT=9000   # `MCP_SSE_PORT` still accepted as a deprecated fallback
JWT_SECRET=<shared secret>   # HMAC-signs the OAuth txn blob (feature 147, replacing the removed MCP_AGENT_SECRET) — not sent as an outbound header
<SERVICE>_ENDPOINT=…   # one per backend (ingest … marketdata), values in docker-compose.yml
UI_BASE_URL=http://localhost:3000
AGENT_PUBLIC_URL=http://localhost:9000   # ${APP_URL}/agent in DO
```

## Running Tests

```bash
uv sync --extra dev
uv run pytest --cov=app --cov-fail-under=40
```
