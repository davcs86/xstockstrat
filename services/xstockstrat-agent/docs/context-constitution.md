# xstockstrat-agent — Constitution

Derived by `/context-constitution` (context-forge) on 2026-07-24. Captures the **non-obvious** local
invariants of the MCP agent (MCPServer, Streamable HTTP :9000) — the only backend that speaks HTTP and
the only one that *calls* backends as a gRPC client. Does not restate documented/CI-enforced rules
(see `## Pointers`).

> Inherits all rules of the root constitution (`../../../docs/context-constitution.md`). This file lists only
> what is specific to **xstockstrat-agent**.

## Rules (`AGENT-*`) — binding, easy-to-miss conventions

| ID | Rule | Why | Evidence | Example (canonical `path:line`) |
|---|---|---|---|---|
| **AGENT-1** | **Every backend RPC opens its own ephemeral `async with grpc.aio.insecure_channel(EP) as channel:` and discards it — no pooled/module-level channel or stub.** | Caching a persistent channel at import diverges from ~22 call sites and breaks the connect-per-call assumption the whole client layer follows. | `app/client.py:56,105,127,151,219,299,…` (N≈22) | `app/client.py:56` |
| **AGENT-2** | **Import `gen.*` stubs *inside* each function body (`# noqa: PLC0415`), never at module top.** | The whole `client.py` follows the lazy-import contract (also keeps import-time light); a top-level `from gen.foo.v1 import …` trips the linter and breaks the convention. | `app/client.py:54,86,123,…` (N≈21); the one top-level exception is `app/auth.py:13` (HTTP-transport path only) | `app/client.py:54` |
| **AGENT-3** | **Admin scope is injected as a hardcoded metadata tuple `("x-access-scope","7")` via `_admin_metadata()` on write/management RPCs only; read RPCs send `_metadata()` (no admin).** ⚠ **One documented exception since feature 073:** `set_config` forwards the *real caller's* derived scope instead — see AGENT-4. | Sending admin on a read path, or omitting it on a new write path, silently fails the backend role check. (Trust-model flagged in root findings.) | `app/client.py:32,298,466,608,713` | `app/client.py:298` |
| **AGENT-4** | **The agent forwards ONLY `x-mcp-secret` (+ hardcoded admin scope) on outbound gRPC — it does NOT forward `x-user-id`/`x-trace-id`.** ⚠ **Amended by feature 073:** the `set_config` tool forwards `("x-access-scope", <caller's derived scope>)` — computed from the real caller's roles by `app/scopes.py` `roles_to_access_scope`, sourced from claims that `app/main.py` `_authorized` publishes on the request's ASGI scope. Still no `x-user-id` (the server prefers `request.author`, which the tool requires) and still no `x-trace-id`. The deviation is scoped to that one tool; every other management tool keeps `_admin_metadata()`. The platform propagation rule (PLAT-4) does not apply here; the agent *originates* requests. | An agent copying a backend's propagation code would look for inbound headers that don't exist. Receivers do not currently enforce `x-mcp-secret`. | `app/client.py:24-32` | `app/client.py:24-32` |
| **AGENT-5** | **Tool-layer gRPC error mapping is applied via `_grpc_error_message` + `except AioRpcError → RuntimeError` — a new tool must add it explicitly** (the older tools don't have it; see findings). | Without the wrapper, raw `AioRpcError` leaks to the MCP client. | `app/tools.py:346,405,436,452,484,513` | `app/tools.py:346` |
| **AGENT-6** | **`MCP_AGENT_SECRET` is triple-purposed**: the outbound `x-mcp-secret` header *and* the HMAC key signing the stateless OAuth `txn` blob. Inbound MCP auth requires `claims.aud == AGENT_PUBLIC_URL`. | Rotating or splitting the secret affects both inter-service identity and OAuth transaction integrity; the `aud`/`resource`/`AGENT_PUBLIC_URL` triple must stay aligned. | `app/oauth_server.py:41,51`; `app/auth.py:43` | `app/auth.py:43` |

## Gotchas & scars

- **The agent hand-maintains mirrors of ingest's and notify's enum maps** (`_TF_ALIASES`/`_TF_TO_ENUM`/`_FILL_MODE_MAP` mirror ingest; `_SEVERITY_MAP` mirrors notify's `AlertSeverity`). Adding a timeframe/fill-mode/severity upstream without extending these maps breaks the tool. Evidence: `app/client.py:44-49,649-651`.

## Pointers (already documented or CI-enforced — not restated here)

| What | Where |
|---|---|
| OAuth 2.1 routes, single-transport `handle_mcp` (SSE removed by feature 079), `/agent` path-insertion quirk | `CLAUDE.md` §OAuth |
| OTel instruments the gRPC *client* channel (not a server) | `app/telemetry.py:7-9,48` |
| `insecure_channel` for all backend calls (internal plaintext) | `app/client.py` (root PLAT-N3) |
| n8n/HTTP-webhook migration to gRPC left no residue | PR #441 |

---
_Forged by [context-forge](https://github.com/davcs86/agent-plugins). It captures the
non-obvious — nothing here is invented; re-run `/context-constitution` to refresh after the code changes._
