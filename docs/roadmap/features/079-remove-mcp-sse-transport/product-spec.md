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

## Out of Scope

- The `stdio` transport.
- Any change to the OAuth 2.1 flow itself (feature 049 Part B) beyond deleting the SSE routes.
- Re-authorizing per-message on SSE — that is the alternative this feature rejects.

## Affected Services

- `xstockstrat-agent` — `app/main.py`, its tests, and the doc surfaces above.

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

## Open Questions

- [ ] **Blocking (FR-5):** does any MCP client in actual use still require the SSE transport? Claude
  Desktop supports Streamable HTTP in current versions, but this must be confirmed against the
  versions this platform's operators run before the routes are deleted.
- [ ] Should removal be staged — log a deprecation warning on `/sse` for one release, then delete —
  or is a single change acceptable given the agent's small, known client set?

## Feature Workflow Notes

Branch to create: `feature/remove-mcp-sse-transport` (branch from `main-dev`).
Approval gates: service owner (`xstockstrat-agent`) + **Security** — this closes an unauthenticated
tool-call channel, so the Security review is required rather than advisory.
