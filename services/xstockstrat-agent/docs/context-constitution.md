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
| **AGENT-1** | **Every backend RPC opens its own ephemeral `async with grpc.aio.insecure_channel(EP) as channel:` and discards it — no pooled/module-level channel or stub.** | Caching a persistent channel at import diverges from 28 call sites and breaks the connect-per-call assumption the whole client layer follows. | `app/client.py:115,180,221,276,358,452,…` (N=28) | `app/client.py:115` |
| **AGENT-2** | **Import `gen.*` stubs *inside* each function body (`# noqa: PLC0415`), never at module top.** | The whole `client.py` follows the lazy-import contract (also keeps import-time light); a top-level `from gen.foo.v1 import …` trips the linter and breaks the convention. | `app/client.py:72,…` (N≈29); the one top-level exception is `app/auth.py:13` (HTTP-transport path only) | `app/client.py:72` |
| **AGENT-3** | **Every management write tool forwards the *real caller's* derived `x-access-scope`** — computed from the caller's roles by `app/scopes.py` `roles_to_access_scope` — so the backend role check *verifies* admin rather than trusting an asserted constant. Read RPCs send `_metadata()` (no scope). *(Feature 092 removed the old hardcoded `("x-access-scope","7")` `_admin_metadata()` tuple; feature 073 had introduced caller-derived scope for `set_config` only, and it is now the platform-wide rule.)* `manage_formula` is the one management tool that sends **no** `x-access-scope` — it relies on the indicators backend's author-ownership check, not an admin bit (see AGENT-3b below for how that author identity is now derived). | Sending admin on a read path, or omitting the scope on a new write path, silently fails the backend role check. | `app/tools.py` `_caller_access_scope`; `app/client.py` (the four wrappers + `set_config` send `[*_metadata(), ("x-access-scope", str(access_scope))]`) | `app/tools.py:95` |
| **AGENT-3b** | **A sibling choke point, `_caller_user_id`, sits alongside `_caller_access_scope` — both route through the shared `_require_claims`** — and it must be used (never a plain claims dict-get) anywhere a tool needs the caller's *own* identity rather than their role. It raises rather than falling back to `""` on a missing `user_id`. | Notify's `EmitAlertRequest.target_user_id == ""` is the BROADCAST sentinel (`packages/proto/notify/v1/notify.proto:34`) — a silent empty-string fallback on identity lookup would silently broadcast an alert a caller meant to keep private. Introduced by feature 111 to close a real caller-identity-spoofing gap (see Gotchas & scars). | `app/tools.py:77` (`_require_claims`), `:107-122` (`_caller_user_id`) | `app/tools.py:107-122` |
| **AGENT-4** | **The agent forwards `("x-access-scope", <caller's derived scope>)` on every management write tool's outbound gRPC — it does NOT forward `x-user-id`/`x-trace-id`, and (since feature 097) no shared-secret header either; `_metadata()` now unconditionally returns `[]`.** The scope is computed from the real caller's roles by `app/scopes.py` `roles_to_access_scope`, sourced from claims that `app/main.py` `_authorized` publishes on the request's ASGI scope; the shared helper is `app/tools.py` `_caller_access_scope`. No `x-user-id` (the server prefers `request.author`, which the write tools require) and no `x-trace-id`. *(Feature 092 generalized this from the feature-073 `set_config`-only case; the hardcoded-admin path is gone.)* The platform propagation rule (PLAT-4) does not apply here; the agent *originates* requests. | An agent copying a backend's propagation code would look for inbound headers that don't exist. Receivers never enforced the header, so its removal (feature 097) required no downstream change. | `app/client.py:28` (`_metadata`, now unconditionally `[]`); `app/tools.py:95` (`_caller_access_scope`) | `app/tools.py:95` |
| **AGENT-5** | **Tool-layer gRPC error mapping is applied via `_grpc_error_message` + `except AioRpcError → RuntimeError` — a new tool must add it explicitly** (the older tools don't have it; see findings). | Without the wrapper, raw `AioRpcError` leaks to the MCP client. | `_grpc_error_message` def `app/tools.py:96`, applied inside each tool's gRPC-calling body (≈15 sites — a new tool must add it explicitly; the line list is intentionally not enumerated, it drifts on every tool addition) | `app/tools.py:96` |
| **AGENT-6** | **`JWT_SECRET` is the HMAC key signing the stateless OAuth `txn` blob (since feature 147, which removed the dedicated `MCP_AGENT_SECRET`)**. It is not sent as an outbound header. Inbound MCP auth requires `claims.aud == AGENT_PUBLIC_URL`. | Rotating the secret affects OAuth transaction integrity; the `aud`/`resource`/`AGENT_PUBLIC_URL` triple must stay aligned. `JWT_SECRET` is now shared between JWT verification and `txn` signing — rotate with that dual role in mind. | `app/oauth_server.py:42,52` | `app/oauth_server.py:42` |

## Gotchas & scars

- **The agent hand-maintains mirrors of ingest's and notify's enum maps** (`_TF_ALIASES`/`_TF_TO_ENUM`/`_FILL_MODE_MAP` mirror ingest; `_SEVERITY_MAP` mirrors notify's `AlertSeverity`). Adding a timeframe/fill-mode/severity upstream without extending these maps breaks the tool. Evidence: `app/client.py:103-108` (`_SEVERITY_MAP`), `:918-922` (`_TF_ALIASES`/`_TF_TO_ENUM`/`_FILL_MODE_MAP`).
- **`647988f` (feature 111) — caller-identity spoofing, a second dimension of the AGENT-3/4 risk.** `emit_alert` let any caller address an alert at an arbitrary `target_user_id`, and `manage_formula` let a caller assert an arbitrary `author`/`formula_author_user_id` param — including the literal `"system"`, impersonating indicators' protected `SYSTEM_AUTHOR` sentinel. Fix: both identities are now derived exclusively from verified OAuth claims (`_caller_user_id`, AGENT-3b) — `manage_formula` no longer accepts any caller-supplied author param at all (ownership is unconditionally `_caller_user_id`, `app/tools.py:677`), and `emit_alert`'s `target_user_id: str = ""` param was replaced with a required `broadcast: bool` (`app/tools.py:361`) — `broadcast=False` always resolves to the authenticated caller's own id, never an arbitrary target. The lesson: trusting a caller-supplied *identity* parameter is the same class of bug as trusting a caller-supplied *scope* parameter (AGENT-3/4) — it recurred in a second, non-scope dimension and could again in a future tool.

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
