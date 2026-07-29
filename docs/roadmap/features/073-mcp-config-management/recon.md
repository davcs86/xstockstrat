# Recon: mcp-config-management

**Created**: 2026-07-29
**From**: product-spec.md
**Affected services**: `xstockstrat-agent` (`xstockstrat-config` unchanged — see Dependencies)

---

## Objective

Add three MCP tools to `xstockstrat-agent` — `get_config`, `list_config_keys`, `set_config` — over
the existing `ConfigService` RPCs, so an operator can inspect config and flip non-secret keys from
an agent session. `set_config` must forward the **real caller's** role-derived `x-access-scope`
rather than the hardcoded admin tuple every other management tool uses (a narrow, tool-scoped
deviation from invariant **AGENT-4**), and must reject `is_secret` keys.

---

## ⚠ Premise correction — the transport decision was taken on a false premise

The user decided "Streamable HTTP only; deny on SSE" on the strength of a claim **I made and had
not verified**: that forwarding real roles on the legacy SSE path "would require an SSE-session →
claims map, i.e. the in-memory store FR-B13 forbids."

**That is false.** Verified in the installed SDK (`mcp==1.27.1`):

- `mcp/server/streamable_http.py:260-266,518` — `ServerMessageMetadata(request_context=request)`
- `mcp/server/sse.py:244` — **the same**: `ServerMessageMetadata(request_context=request)`
- `mcp/server/lowlevel/server.py:735-765` — that value becomes `RequestContext.request`
- `mcp/shared/context.py` — `RequestContext.request: RequestT | None`
- `mcp/server/fastmcp/server.py:1098-1130,1154` — a tool receives it by declaring a
  `ctx: Context` parameter; `ctx.request_context.request` is the Starlette `Request`

So the underlying HTTP request — headers included — is reachable from a tool body on **both**
transports. No session→claims map is needed for either. A tool could read
`Authorization: Bearer …` off `ctx.request_context.request.headers` and validate it itself,
per-request, with no shared state, honoring FR-B13 on both paths.

**The real difference is narrower and still meaningful:** on the SSE path the `/messages` POST is
never auth-*gated* (`app/main.py:144-146` returns before `_authorized` at `:148`), so any token on
it is **unvalidated** by the time the tool runs. On Streamable HTTP the same request has already
passed `_authorized`.

**Recommendation:** implement the decision as given (reject on SSE). It remains defensible on its
own terms — the SSE channel is unauthenticated at the transport layer, and refusing a privileged
write there is the conservative choice. But it should be re-affirmed knowing the actual constraint,
because "we cannot" was wrong and "we choose not to" is the truth. Recorded here rather than
silently implemented, and surfaced to the user.

---

## Codebase Map

- **`xstockstrat-agent`** (Python 3.12, MCP over SSE + Streamable HTTP, HTTP 9000)
  - Tool registration: all tools are **nested async functions inside**
    `register_tools(server: FastMCP)` — `app/tools.py:63`. Last tool is `get_strategy` at
    `:605-618`; new tools go after it, inside the same function.
  - Module docstring count block — `app/tools.py:1-19` ("Fourteen tools:" + one line per tool).
  - Read-only tool template — `get_backfill_status`, `app/tools.py:576-603`. Admin-write template —
    `trigger_backfill`, `:544-574`, whose docstring opens "(admin-scoped write)".
  - Docstring convention **is** the LLM-facing contract and the `/api/tools` `description`: one-line
    purpose (+ scope marker), then `param: description` lines, then `Returns …`.
  - Error mapping — `_grpc_error_message(exc, not_found=…)` at `app/tools.py:37-48`;
    **`PERMISSION_DENIED` is already mapped** (`:44-45`), so a denied `set_config` surfaces cleanly.
  - Return shape: plain `dict` (structured output on by default). Only `run_backtest` opts out
    (`@server.tool(structured_output=False)`, `:245`).
  - Client layer — `app/client.py`: `_metadata()` `:24-27` (x-mcp-secret only),
    `_admin_metadata()` `:30-32` (**adds the hardcoded `("x-access-scope", "7")`** — the exact
    deviation point). Per-call pattern: lazy `from gen.<svc>.v1 import …` → ephemeral
    `grpc.aio.insecure_channel(<SVC>_ENDPOINT)` → stub → `await stub.<Rpc>(req, metadata=…)` →
    hand-shaped dict (canonical example `set_strategy_live`, `:655-675`).
  - **A ConfigService client already exists**: `get_config_value(key) -> str | None`,
    `app/client.py:678-695` — but it hardcodes `namespace="agent"` (`:689`), passes **no metadata**,
    and **swallows every exception** (`:694-695`). Do not copy this shape.
  - ASGI layer — `app/main.py`: `_authorized(scope)` `:105-114` (extracts the bearer token at `:113`
    and **discards it**, returning only a bool); `handle_mcp` `:130`; path branch `:142`;
    **`/messages` short-circuit `:144-146` (before auth)**; auth gate `:148-150`; `/sse` `:152-157`;
    Streamable HTTP fall-through `:159`.
  - Auth — `app/auth.py:28-49` `validate_bearer_jwt(token) -> bool`. It fetches full `TokenClaims`
    from Identity and returns only `claims.aud == AGENT_PUBLIC_URL` (`:43`) — the roles are already
    on the wire and thrown away. Prior art for returning them instead:
    `client.validate_token(token) -> {"user_id","email","roles","aud"}`, `app/client.py:590-608`.
  - `TokenClaims` — `packages/proto/identity/v1/identity.proto:41-48`
    (`user_id`, `email`, `repeated string roles`, `issued_at`, `expires_at`, `aud`).
  - `GET /api/tools` catalog — `app/main.py:77-96`, route `:180`. Enumerates via
    `server.list_tools()`, so it picks new tools up **automatically**; unauthenticated by design.
  - Tests — `tests/`, pytest with `asyncio_mode="auto"`. Tool harness: `_make_server()` +
    `_tool_fn(server, name)` reaching into `server._tool_manager._tools[name].fn`
    (`tests/test_tools.py:16-23`), backend mocked at the **client-function** level
    (`patch.object(client, "…", AsyncMock(...))`, `:58`). Client harness mocks the stub and channel
    (`tests/test_client.py:39-65`). **Name-set assertion to extend: `tests/test_tools_endpoint.py:23-38`**
    (exact `names == {…}` equality — it will go red).

- **`xstockstrat-config`** — the server-side contract `set_config` must satisfy (no change needed):
  - Admin gate is the **first statement** of `setConfig` — `src/grpc/configServiceImpl.ts:267-274`
  - Author fallback `request.author || userIdFrom(metadata)`, else `INVALID_ARGUMENT` — `:283-287`
  - `getConfig`/`listKeys` ungated — `:241-258`, `:310+`
  - `authz.ts`: `ADMIN_SCOPE = 0x04` `:22`, `hasAdminAccessScope` `:38-42` (fail-closed)

## Patterns to REUSE

- **Tool shape** → copy `get_backfill_status` (`app/tools.py:576-603`) for the two read tools and
  `trigger_backfill` (`:544-574`) for `set_config`, including the "(admin-scoped write)" docstring
  marker.
- **Error surfacing** → `_grpc_error_message` (`app/tools.py:37-48`); it already maps
  `PERMISSION_DENIED`, which is what feature 074's gate returns.
- **Client call shape** → `set_strategy_live` (`app/client.py:655-675`), *not* the defective
  `get_config_value`.
- **Claims retrieval** → `client.validate_token` (`app/client.py:590-608`) already returns
  `roles`; `validate_bearer_jwt` can delegate to it rather than duplicating the Identity call.
- **Per-request context** → the MCP SDK's own `Context` parameter (`fastmcp/server.py:1098-1130`).
  **Do not invent a contextvar** — the SDK already carries the request.
- **Role→scope bitmap** → port `rolesToAccessScope` (`services/xstockstrat-ui/src/lib/auth.ts:65-76`:
  viewer→READ; trader→READ|WRITE|TRADING; admin→READ|WRITE|ADMIN|TRADING = 15). Canonical bit
  `ADMIN_SCOPE = 0x04`, mirrored at `services/xstockstrat-config/src/grpc/authz.ts:22`.
- **Consumer-side bitmask precedent (Python)** → `_has_admin_scope` in
  `services/xstockstrat-{ingest,indicators,analysis}/app/handlers/servicer.py` — all `& 0x04`.

## Dependencies

- Proto/RPC: **none changed.** `GetConfig` `:20`, `SetConfig` `:23`, `ListKeys` `:26` in
  `packages/proto/config/v1/config.proto`. `SetConfigRequest` fields 1-7; `ConfigKeyMeta` fields
  1-8; `ConfigValue` oneof + `is_secret=6`.
- Migration: none. Config keys: none new.
- **Env vars: none new.** `CONFIG_ENDPOINT` is already in the agent's blocks —
  `docker-compose.yml:516` (with `WAIT_FOR` at `:519`), and in both `.do/app*.yaml`.
- Inter-service edge: `xstockstrat-agent` → `xstockstrat-config` (gRPC 50060) — new, but the
  endpoint and the `ConfigServiceStub` import path already exist.
- Prerequisites, all merged or on this branch: **074** (the gate `set_config` must satisfy),
  **075** (`is_secret` on `GetConfig` — FR-1), **077** (`is_secret` on `ListKeys` — FR-3 prong (a)),
  **076** (why credentials are out of scope).

## Risks / Not-found

1. **No existing per-tool transport gating.** `tools.py` has no tool that inspects its transport and
   `handle_mcp` has no per-tool hook — AC-10's SSE rejection has **no precedent to copy**. It must
   be built from `ctx.request_context.request` (see the premise correction above).
2. **`validate_bearer_jwt` returns a bool.** FR-5 needs the roles. Changing its signature touches
   `_authorized` (`main.py:113`) and `tests/test_auth.py`; adding a parallel claims-returning
   function avoids that but risks two Identity round-trips per request. Design must pick.
3. **Two Identity round-trips.** If `set_config` validates the token itself *and* `_authorized`
   already did, the same JWT is validated twice per call. Acceptable (one extra gRPC hop on an
   operator-driven write) but should be a conscious choice, not an accident.
4. **`get_config_value` is a landmine.** The existing config client hardcodes `namespace="agent"`
   and swallows exceptions. A new reader must not extend it; and its defect is already logged in
   `services/xstockstrat-agent/docs/context-constitution-findings.md`.
5. **Prong (a) scope threading** (product-spec FR-3): `ListKeys` filters by
   `environment`/`trading_mode`, so the `is_secret` lookup must use the *same* scope as the pending
   write. Known Constraint 1's `trading_mode` collapse may prevent that threading through — confirm,
   don't assume.
6. **AGENT-4 must be amended, not just deviated from** —
   `services/xstockstrat-agent/docs/context-constitution.md:18` states the agent never forwards
   per-user identity. After this feature that is no longer universally true.
7. **`.venv` is not in the checkout by default.** This recon ran `uv sync --extra dev` to inspect
   the SDK. Anyone re-verifying the Context claims must do the same.
8. **Not found:** any contextvar/`Context`/`request_context` usage anywhere in the agent today
   (grep returns zero); any Python role→scope mapping; any `set_config`/`list_config_keys`/
   `get_config` tool or client wrapper; any agent migrations directory.

## Recommended Scope

1. **`service`** — `app/auth.py`: surface the caller's roles (extend or parallel
   `validate_bearer_jwt`), reusing `client.validate_token`.
2. **`service`** — `app/client.py`: `get_config`, `list_config_keys`, `set_config` wrappers.
   `set_config` takes an explicit scope/author rather than calling `_admin_metadata()`.
3. **`service`** — `app/tools.py`: three tools + the docstring count block; `set_config` declares a
   `ctx: Context` parameter, derives the caller's scope, enforces the transport rule and the
   two-pronged `is_secret` rejection.
4. **`test`** — `tests/test_client.py`, `tests/test_tools.py`, and the name-set in
   `tests/test_tools_endpoint.py:23-38`.
5. **`docs`** — the six surfaces of FR-6 plus `config-rollout.md`; amend **AGENT-4**.
