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

FR-1a. `GET /sse` and `POST /messages` must return **404 with an explanatory body**, from an
explicit branch in `handle_mcp` placed *before* the `_authorized` gate. Deleting the two branches is
not sufficient on its own: `Mount("/", app=handle_mcp)` (`app/main.py:201`) is a root catch-all, so a
stale client would instead fall through to `session_manager.handle_request` and get an opaque
Streamable-HTTP protocol error (400/406) — or, unauthenticated, a `401` that starts a pointless
OAuth flow. The 404 sits before the auth gate deliberately: a client with a saved `/sse` URL gets an
immediate, unambiguous answer naming the URL to switch to, and the removal is public information
that leaks nothing. AC-3 is unaffected — a 404 never reaches a tool.

FR-2. **`MCP_TRANSPORT` gains the canonical value `http`; `sse` keeps working as a deprecated alias
that logs a warning and starts the same server.** This is the single decided behavior — the
"fail fast" alternative is explicitly rejected, because all three deployment targets ship
`MCP_TRANSPORT=sse` today (`.do/app.yaml:275-276`, `.do/app.dev.yaml:275-276`,
`docker-compose.yml:520`) and failing on it would break local, DO dev and DO prod at once. The three
deployment files are updated to `http` in this same change for honesty, but the alias means a
half-deployed or un-updated environment keeps serving MCP — which is what AC-8 asserts.

The same rename-with-fallback applies to the port var: **`MCP_HTTP_PORT`, falling back to
`MCP_SSE_PORT`**, and to the two internal factory names `build_sse_app` → `build_http_app` and
`_run_sse` → `_run_http`. All of these name a transport that will no longer exist; leaving them is
the "the name lies" defect this feature exists to remove, and each carries a compatibility fallback
so nothing breaks mid-deploy. `MCP_TRANSPORT=stdio` is untouched.

FR-3. Feature 073's `set_config` transport guard becomes redundant at runtime but **is not deleted**
— it is defence in depth and its test documents the reasoning. Update its wording to say the SSE
transport was removed rather than that it is unsupported, at all four places that carry the
rationale:
`app/tools.py:747-748` (the error string), `app/tools.py:44-51` (`_claims_from_context`'s docstring)
and `:731` (the tool docstring); `services/xstockstrat-agent/CLAUDE.md` § Management-tool
authorization; `docs/runbooks/mcp-tools.md:657,682-683` (the `set_config` § Transport paragraph).
**Not AGENT-4** — `services/xstockstrat-agent/docs/context-constitution.md:18` is entirely about
outbound header forwarding and carries no transport claim, so it needs no edit here; the earlier
draft of this requirement named the wrong artifact.

FR-4. Update every surface that describes two transports. The list is exhaustive as written:
- `services/xstockstrat-agent/CLAUDE.md` — § Role (`:11-15`), § OAuth route table (`:93-97`).
- `docs/runbooks/mcp-tools.md` — § Transport Modes (`:8-27`), including the operator release note
  from FR-5 finding 4.
- `services/xstockstrat-agent/docs/context-constitution.md` — header `:4` ("HTTP :9000 SSE"),
  AGENT-2's evidence `:16` ("(SSE path only)"), Pointers `:30` ("dual-transport `handle_mcp`").
- `services/xstockstrat-agent/docs/context-constitution-findings.md:18` — the `MCP_TRANSPORT`
  default finding, which FR-2 makes stale.
- `docs/launch-pdfs/product-features.md:177` — "port 9000, SSE transport".
- `app/main.py:4-11` — the module docstring, which documents `sse` as the remote transport.
- `.do/app.yaml`, `.do/app.dev.yaml`, `docker-compose.yml` — the `MCP_TRANSPORT` / port values per
  FR-2. (No `/sse` *comment* exists in any of them; a grep confirms only the two env keys.)

Because this touches governed context files, the root `CLAUDE.md` teardown rule applies: run
`/context-scrubber scan` scoped to the changed docs before opening the PR.

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

1. `POST /messages` and `GET /sse` return **404**, with or without an `Authorization` header, and the
   body names the replacement URL. No `SseServerTransport` import or `sse.py` reference remains in
   the codebase. (Achieved by FR-1a's explicit pre-auth branch — deletion alone yields 401/400
   instead, which is why FR-1a exists.)
2. A tool call over Streamable HTTP still works end to end, authenticated by `_authorized`.
3. There is no code path by which a `tools/call` reaches a tool without passing `_authorized`.
4. `MCP_TRANSPORT=sse` still starts a working server (serving Streamable HTTP only) and logs a
   deprecation warning; `MCP_TRANSPORT=http` starts the same server without the warning; an
   unrecognized value falls through to `stdio` exactly as it does today (FR-2).
5. All transport-mode documentation describes exactly one remote transport.
6. Feature 073's `set_config` tests still pass unchanged, proving the guard is intact as defence in
   depth (FR-3).
7. `claude_mcp_config.json` contains no `/sse` URL, and its remote block's `url` is the bare
   `<AGENT_PUBLIC_URL>` — the same URL the Claude.ai remote connector already uses (FR-6).
8. No deployment spec (`.do/app.yaml`, `.do/app.dev.yaml`, `docker-compose.yml`) *needs* a value
   change for the agent to keep serving MCP — proving finding 2 of the FR-5 investigation. They are
   updated to `MCP_TRANSPORT=http` / `MCP_HTTP_PORT` anyway for honesty, and the FR-2 aliases are
   what make the un-updated case still work. Test by asserting the alias path, not by reading YAML.

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
