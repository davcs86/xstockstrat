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
| **AGENT-1** | **Every backend RPC opens its own ephemeral `async with grpc.aio.insecure_channel(EP) as channel:` and discards it — no pooled/module-level channel or stub.** | Caching a persistent channel at import diverges from ~22 call sites and breaks the connect-per-call assumption the whole client layer follows. | `app/client.py:116,181,222,277,359,452,…` (N≈28) | `app/client.py:116` |
| **AGENT-2** | **Import `gen.*` stubs *inside* each function body (`# noqa: PLC0415`), never at module top.** | The whole `client.py` follows the lazy-import contract (also keeps import-time light); a top-level `from gen.foo.v1 import …` trips the linter and breaks the convention. | `app/client.py:54,86,123,…` (N≈21); the one top-level exception is `app/auth.py:13` (HTTP-transport path only) | `app/client.py:54` |
| **AGENT-3** | **Every management write tool forwards the *real caller's* derived `x-access-scope`** — computed from the caller's roles by `app/scopes.py` `roles_to_access_scope` — so the backend role check *verifies* admin rather than trusting an asserted constant. Read RPCs send `_metadata()` (no scope). *(Feature 092 removed the old hardcoded `("x-access-scope","7")` `_admin_metadata()` tuple; feature 073 had introduced caller-derived scope for `set_config` only, and it is now the platform-wide rule.)* `manage_formula` is the one management tool that sends **no** scope — it relies on the indicators backend's author-ownership check, not an admin bit. | Sending admin on a read path, or omitting the scope on a new write path, silently fails the backend role check. | `app/tools.py` `_caller_access_scope`; `app/client.py` (the four wrappers + `set_config` send `[*_metadata(), ("x-access-scope", str(access_scope))]`) | `app/tools.py:77` |
| **AGENT-4** | **The agent forwards `("x-access-scope", <caller's derived scope>)` on every management write tool's outbound gRPC — it does NOT forward `x-user-id`/`x-trace-id`, and (since feature 097) no shared-secret header either; `_metadata()` now unconditionally returns `[]`.** The scope is computed from the real caller's roles by `app/scopes.py` `roles_to_access_scope`, sourced from claims that `app/main.py` `_authorized` publishes on the request's ASGI scope; the shared helper is `app/tools.py` `_caller_access_scope`. No `x-user-id` (the server prefers `request.author`, which the write tools require) and no `x-trace-id`. *(Feature 092 generalized this from the feature-073 `set_config`-only case; the hardcoded-admin path is gone.)* The platform propagation rule (PLAT-4) does not apply here; the agent *originates* requests. | An agent copying a backend's propagation code would look for inbound headers that don't exist. Receivers never enforced the header, so its removal (feature 097) required no downstream change. | `app/client.py:28` (`_metadata`, now unconditionally `[]`); `app/tools.py:77` (`_caller_access_scope`) | `app/tools.py:77` |
| **AGENT-5** | **Tool-layer gRPC error mapping is applied via `_grpc_error_message` + `except AioRpcError → RuntimeError` — a new tool must add it explicitly** (the older tools don't have it; see findings). | Without the wrapper, raw `AioRpcError` leaks to the MCP client. | `_grpc_error_message` def `app/tools.py:96`, applied inside each tool's gRPC-calling body (≈15 sites — a new tool must add it explicitly; the line list is intentionally not enumerated, it drifts on every tool addition) | `app/tools.py:96` |
| **AGENT-6** | **`MCP_AGENT_SECRET` is single-purposed (since feature 097)**: the HMAC key signing the stateless OAuth `txn` blob. It is no longer sent as an outbound header (feature 097). Inbound MCP auth requires `claims.aud == AGENT_PUBLIC_URL`. | Rotating the secret affects OAuth transaction integrity; the `aud`/`resource`/`AGENT_PUBLIC_URL` triple must stay aligned. | `app/oauth_server.py:42,52` | `app/oauth_server.py:42` |

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
