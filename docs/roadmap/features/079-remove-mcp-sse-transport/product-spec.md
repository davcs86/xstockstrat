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
`MCP_SSE_PORT`** — an env var read from a deployment file needs the fallback, because the code and
the YAML roll out at different moments.

The two internal factory names are also renamed — `build_sse_app` → `build_http_app`, `_run_sse` →
`_run_http` — but **without** aliases. They are private, in-repo symbols whose only callers are
`app/main.py:209,225`, `tests/test_oauth.py:17,19` and `tests/test_tools_endpoint.py:12,14`, all
updated in the same commit; a compatibility alias for a function with no out-of-repo consumer would
be dead code. (Everything in this paragraph names a transport that will no longer exist — leaving
them is the same "the name lies" defect the feature exists to remove.) `MCP_TRANSPORT=stdio` is
untouched.

FR-3. Feature 073's `set_config` transport guard becomes redundant at runtime but **is not deleted**
— it is defence in depth and its test documents the reasoning. Update its wording to say the SSE
transport was removed rather than that it is unsupported, everywhere that carries the rationale:
`app/tools.py:748` (the error string), `app/tools.py:47-51` (`_claims_from_context`'s docstring),
`app/tools.py:731` (the tool docstring), `app/scopes.py:17` (the `MCP_CLAIMS_SCOPE_KEY` comment),
`services/xstockstrat-agent/CLAUDE.md` § Management-tool authorization, and
`docs/runbooks/mcp-tools.md:683` (the `set_config` § Transport paragraph).

**Not AGENT-4** — `services/xstockstrat-agent/docs/context-constitution.md:18` is entirely about
outbound header forwarding and carries no transport claim, so it needs no edit here; an earlier
draft of this requirement named the wrong artifact.

`tests/test_config_tools.py:9,161` carry the same rationale in docstrings. Their **assertions and
test bodies do not change** — that is what AC-6 protects — but the docstrings are updated to say the
transport was removed. AC-6 means "the guard still holds and its tests still pass", not "this file
is byte-frozen".

FR-4. Update every surface that describes the SSE transport. **This list was produced by
`grep -rniE '\bSSE\b|/sse|/messages|build_sse_app|_run_sse|MCP_SSE_PORT|SseServerTransport'` over
the repo on 2026-07-29, not by recall** — an earlier draft asserted its own exhaustiveness and was
wrong. Execution must re-run that grep and reconcile against this list; **AC-5 is the operative
gate, not this enumeration.**

*Agent code (beyond the FR-1/FR-1a route removal):* `app/main.py:6,8` (module docstring),
`app/auth.py:2`, `app/oauth_metadata.py:20` ("the agent /sse endpoint").

*Agent tests:* `tests/test_oauth.py:3,4,45,50,56-58,73,78` (the two `/sse` boundary cases become
the FR-1a 404 cases), `tests/test_tools_endpoint.py:3,12,14,59`.

*Deployment:* `.do/app.yaml:275-278`, `.do/app.dev.yaml:275-278`, `docker-compose.yml:520-521` — the
`MCP_TRANSPORT` / port values per FR-2. (No `/sse` *comment* exists in any of them; the grep
confirms only the two env keys.)

*Docs:* root `CLAUDE.md:105` (Service Registry, "9000 (SSE)"); agent `CLAUDE.md:11,15,65,77,83,94,97`
and the env block `:118-119` — note `:83` ("registered in `app/main.py` `build_sse_app`") is made
stale by FR-2's own rename; `services/xstockstrat-agent/docs/context-constitution.md:4,16,30`;
`services/xstockstrat-agent/docs/context-constitution-findings.md:18`;
`docs/runbooks/mcp-tools.md:13,15,21-22,27,42,48,61` — `:48` claims an unauthenticated `GET /sse`
returns 401, which FR-1a changes to 404; `docs/launch-pdfs/product-features.md:177`;
`docs/patterns/header-propagation.md:13,21` ("the MCP agent SSE layer");
`scripts/setup-env.sh:199` ("SSE API-key auth is still active").

*Other services (comment-only, one phrase each):*
`services/xstockstrat-ingest/app/handlers/servicer.py:124` and
`services/xstockstrat-analysis/app/handlers/servicer.py:151` both say callers arrive "via its SSE
auth layer". These are prose-only edits with no behavior change, but they do widen § Affected
Services to three services and will re-run those services' CI.

*Deliberately NOT changed*, and why — so a later reader does not read the omission as a miss:
`CHANGELOG.md:337` (historical record); `docs/roadmap/phase5-deviations.md:38-45,106`,
`docs/roadmap/CLAUDE.md:8` and `services/xstockstrat-notify/CLAUDE.md:28` (a *different* SSE — the
trader alert stream to the browser, unrelated to MCP); `services/xstockstrat-agent/uv.lock`
(`sse-starlette` / `httpx-sse` are transitive dependencies of the `mcp` package itself and cannot be
dropped); `docs/roadmap/features/**` (historical SDD artifacts); `services/xstockstrat-ui/.next/**`
(build output).

Because this touches governed context files, the root `CLAUDE.md` teardown rule applies: run
`/context-scrubber scan` scoped to the changed docs before opening the PR.

FR-5. *(Discharged during spec review — see Open Questions. Retained for traceability; no execution
work remains.)* Confirm and record which MCP clients the platform actually uses.

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
- `xstockstrat-ingest`, `xstockstrat-analysis` — **comment-only**, one stale phrase each
  (`app/handlers/servicer.py:124` / `:151`, "via its SSE auth layer"). No behavior change; listed
  because their CI jobs will run.

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
9. `MCP_HTTP_PORT` is honored when set; with it unset and `MCP_SSE_PORT` set, the old var is still
   honored (the FR-2 port fallback). This is a separate assertion from AC-4's transport alias.
10. `build_http_app` and `_run_http` are the only names in the tree — no `build_sse_app` or
    `_run_sse` symbol or caller survives in `app/` or `tests/` (FR-2's no-alias rename).

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
