# Product Spec: remove-mcp-sse-transport

**Created**: 2026-07-29

---

## Problem Statement

`xstockstrat-agent` serves MCP over two remote transports: the modern **Streamable HTTP** transport
at `/`, and the legacy **HTTP+SSE** transport at `/sse` + `POST /messages`.

The legacy one has an authorization hole. In `services/xstockstrat-agent/app/main.py`, `handle_mcp`
returns for `path == "/messages"` **before** reaching the `_authorized(scope)` gate:

```python
if path == "/messages":
    await sse.handle_post_message(scope, receive, send)
    return                      # <- returns before the auth gate below
if not await _authorized(scope):
    await _send_unauthorized(scope, receive, send)
    return
```

The in-code comment explains the intent — "auth rides the established stream session" — but the
consequence is that **every tool call over SSE is unauthenticated at the transport layer**. The
bearer token is checked once when `/sse` opens the stream; individual `tools/call` messages are not.

This is not theoretical. Feature **073** (`mcp-config-management`) had to restrict its `set_config`
tool to Streamable HTTP solely because of it: there is no verified caller identity on an SSE tool
call, so a privileged, role-authorized write cannot be offered there. Any future tool needing the
caller's identity — rather than the agent's service-wide admin override — will hit the same wall.

Removing the transport is preferable to fixing it: SSE is deprecated in the MCP spec in favour of
Streamable HTTP, so hardening a channel that is on its way out spends effort twice.

## User Story

As the platform owner, I want the legacy SSE MCP transport removed, so that every remote tool call
is authenticated by the same gate and no tool has to carve out a transport-specific exception.

## Functional Requirements

FR-1. Remove the `/sse` and `POST /messages` routes and the `SseServerTransport` wiring from
`app/main.py`. Streamable HTTP (`/`) remains the only remote transport; `stdio` (`MCP_TRANSPORT=stdio`)
is unaffected and stays for local use.

FR-2. `MCP_TRANSPORT=sse`, if it is a supported value today, either maps to the Streamable HTTP
server or fails fast with a clear message — it must not silently start a server with no working
transport.

FR-3. Feature 073's `set_config` transport guard becomes redundant at runtime but **is not deleted**
— it is defence in depth and its test documents the reasoning. Update its error message and the
`AGENT-4` note to say SSE no longer exists rather than that it is unsupported.

FR-4. Update the discovery/documentation surfaces that describe two transports:
`services/xstockstrat-agent/CLAUDE.md` (§ Role, § OAuth), `docs/runbooks/mcp-tools.md`
(§ Transport Modes), and any `.do/app*.yaml` or `docker-compose.yml` comment naming `/sse`.

FR-5. Confirm and record which MCP clients the platform actually uses. The agent `CLAUDE.md` cites
the legacy transport as being "for Claude Desktop" — if any supported client still requires SSE,
that is a blocking finding for this feature, not a detail to discover during execution.

FR-6. **`services/xstockstrat-agent/claude_mcp_config.json` is the operator-facing client config and
is part of the change, not documentation.** Its two remote blocks both point at
`<AGENT_PUBLIC_URL>/sse` — the exact URL this feature deletes. Both must be replaced by a single
Streamable HTTP block whose `url` is the bare `<AGENT_PUBLIC_URL>`. See the FR-5 finding: this file
is the platform's only checked-in client configuration, so it *is* the client-compatibility surface.

## Out of Scope

- The `stdio` transport.
- Any change to the OAuth 2.1 flow itself (feature 049 Part B) beyond deleting the SSE routes.
- Re-authorizing per-message on SSE — that is the alternative this feature rejects.

## Affected Services

- `xstockstrat-agent` — `app/main.py`, `claude_mcp_config.json`, its tests, and the doc surfaces above.

## Proto Contract Changes

- [x] None.

## Config Key Changes

- [x] None. (`MCP_TRANSPORT` is an env var, not a config key.)

## Database Changes

- [x] None.

## Acceptance Criteria

1. `POST /messages` and `GET /sse` return 404; no `SseServerTransport` remains in the codebase.
2. A tool call over Streamable HTTP still works end to end, authenticated by `_authorized`.
3. There is no code path by which a `tools/call` reaches a tool without passing `_authorized`.
4. `MCP_TRANSPORT=sse` does not start a broken server (FR-2).
5. All transport-mode documentation describes exactly one remote transport.
6. Feature 073's `set_config` tests still pass unchanged, proving the guard is intact as defence in
   depth (FR-3).
7. `claude_mcp_config.json` contains no `/sse` URL, and its remote block's `url` is the bare
   `<AGENT_PUBLIC_URL>` — the same URL the Claude.ai remote connector already uses (FR-6).
8. No deployment spec (`.do/app.yaml`, `.do/app.dev.yaml`, `docker-compose.yml`) needs a value change
   for the agent to keep serving MCP — proving finding 2 of the FR-5 investigation.

## Open Questions

- [x] **Blocking (FR-5) — RESOLVED, cleared to proceed.** Investigated 2026-07-29. Findings:
  1. **No client is pinned to SSE by anything in this repo except one config file.** The platform's
     only checked-in client configuration is
     `services/xstockstrat-agent/claude_mcp_config.json`, which offers three blocks: `stdio`
     (unaffected — out of scope), `xstockstrat-sse-oauth` → `<AGENT_PUBLIC_URL>/sse`, and
     `xstockstrat-sse-apikey-deprecated` → `<AGENT_PUBLIC_URL>/sse?api_key=…`. The last is already
     marked DEPRECATED in-file, and its `?api_key=` query-string credential is forbidden by the
     OAuth 2.1 posture feature 049 Part B established. Both remote blocks are replaced by FR-6.
  2. **`MCP_TRANSPORT=sse` is a misnomer, and that de-risks the change substantially.**
     `.do/app.yaml:275`, `.do/app.dev.yaml:275` and `docker-compose.yml:520` all deploy
     `MCP_TRANSPORT=sse`, but `app/main.py:224` routes that value to `_run_sse()` → `build_sse_app()`,
     which serves **both** transports — `/sse` + `/messages` *and* the Streamable HTTP fall-through
     at `/` (`main.py:178`). The env value selects "run the HTTP server", not "SSE only". Removing
     the SSE routes therefore requires **no deployment-config change** in any environment; the same
     `MCP_TRANSPORT=sse` value keeps serving the surviving transport (FR-2 renames it for honesty,
     keeping the old value accepted).
  3. **The Claude.ai remote connector — the production client — already speaks Streamable HTTP**
     against the connector URL, which is `AGENT_PUBLIC_URL` itself, not `/sse`
     (`app/main.py:99-103`, agent `CLAUDE.md` § Role). It is unaffected.
  4. **Residual operator action, not a blocker.** If a connector was configured by pasting the
     `xstockstrat-sse-oauth` block, its saved URL ends in `/sse` and will 404 after deploy. The fix
     is to edit that connector's URL down to the bare `AGENT_PUBLIC_URL` — a one-line change in the
     client, with no re-authorization needed. This must be called out in the PR body and in
     `docs/runbooks/mcp-tools.md`, and is the reason FR-6 exists.
- [x] **Staging — RESOLVED: single change, no deprecation release.** A staged rollout buys warning
  time for clients the operator does not control. Here the client set is one operator's own
  connectors (finding 1), the surviving transport is *already being served* on the same port and
  process (finding 2), and the SSE path is the unauthenticated one — leaving it up for one more
  release keeps the hole open for exactly as long as the deprecation window. Ship it in one change
  and carry the client-side URL edit as a release note.

## Feature Workflow Notes

Branch to create: `feature/remove-mcp-sse-transport` (branch from `main-dev`).
Approval gates: service owner (`xstockstrat-agent`) + **Security** — this closes an unauthenticated
tool-call channel, so the Security review is required rather than advisory.
