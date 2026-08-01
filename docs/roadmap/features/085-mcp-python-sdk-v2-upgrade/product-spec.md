# Product Spec: mcp-python-sdk-v2-upgrade

**Created**: 2026-07-30

---

## Problem Statement

`xstockstrat-agent` pins the Python `mcp` SDK at `mcp>=1.27.1,<2` (`pyproject.toml:6`,
`uv.lock:439-441`). `mcp` v2.0.0 shipped 2026-07-28 as a from-scratch rewrite of the SDK (v1.x is
now maintenance-only — security fixes only, per the package's PyPI page). Staying on v1.x
indefinitely means the agent's MCP server, its 17 tools, and its OAuth 2.1 edge-auth layer
(feature 049) fall further behind the SDK the platform depends on for its Claude.ai remote
connector. This feature migrates the agent to v2.0.0.

## User Story

As the xstockstrat platform team, I want `xstockstrat-agent` running on `mcp` v2.0.0, so that the
MCP server, its tools, and its OAuth layer keep working against the current SDK and protocol
instead of drifting onto an SDK branch that only receives security patches.

## Functional Requirements

FR-1. `app/main.py` `create_server()` and all call sites import `MCPServer` from
`mcp.server.mcpserver` instead of `FastMCP` from `mcp.server` — grep confirms both `app/main.py:23`
and `app/tools.py:31` import `FastMCP` today.

FR-2. Every `@mcp.tool()` handler in `app/tools.py::register_tools` that currently calls
`mcp.get_context()` (v1 pattern) is converted to accept an injected `ctx: Context` parameter
instead — `MCPServer.get_context()` is removed in v2. Note `run_backtest` (`app/tools.py:705`)
already takes `ctx: Context` as a parameter; recon must confirm which of the other 16 tools still
use the old `get_context()` call form (`_claims_from_context`, `app/tools.py:44`, is the likely
other call site) and convert them consistently.

FR-3. The custom ASGI mounting in `app/main.py` (`create_server()`, the root dispatcher `handle_mcp`,
and the direct `StreamableHTTPSessionManager` usage at `app/main.py:92`) is reworked to the v2
transport API, where transport/mount parameters move from the `MCPServer` constructor to
`run()` / `streamable_http_app()`, and `mount_path` is removed in favor of ASGI `root_path`. The
`/agent` route-prefix behavior (DO ingress, `AGENT_PUBLIC_URL`) must be preserved exactly —
this is the surface feature 079's SSE removal and feature 049's OAuth discovery-path-insertion
quirk both depend on.

FR-4. `app/tools.py:832`'s `httpx.AsyncClient` call (in `extract_website_content` per the tool
name proximity) is migrated to `httpx2`, the SDK's new hard dependency replacing `httpx`/`httpx-sse`.
Recon must confirm whether this call site needs to move to `httpx2` directly, or whether it can
keep using plain `httpx` as an app-level dependency independent of the SDK's own transport usage —
the SDK's internal transport (`streamable_http_client`, OAuth token exchange) is what strictly
requires `httpx2`.

FR-5. `app/main.py`'s existing custom env var parsing (`_transport()`, `_http_port()` — already
hand-rolled reads of `os.environ.get("MCP_TRANSPORT"/"MCP_HTTP_PORT"/"MCP_SSE_PORT")`, not SDK-provided
config) continues to work unchanged: v2 removing the SDK's own `MCP_*`/`.env`
(`pydantic-settings`) support does not affect this file, since it never used that mechanism.
Confirm via recon that no other file in the agent relies on SDK-level env var injection.

FR-6. The OAuth 2.1 Resource Server + Authorization-Server facade (`app/oauth_server.py`,
feature 049 Part B) is audited against the v2 OAuth changes: `RFC7523OAuthClientProvider` /
`JWTParameters` removal, `scopes=`→`scope=` rename, issuer-mismatch rejection (SEP-2352 / RFC 9207),
DCR `application_type` (SEP-837), and `client_secret_post` now including `client_id`. Recon must
confirm which of these classes/params the agent's OAuth code actually uses (it currently mints its
own tokens via `xstockstrat-identity` rather than using the SDK's client-side OAuth provider
classes, so several of these may be no-ops — this needs verification, not assumption).

FR-7. `app/backtest_view.py`'s use of `mcp.types` (`Annotations`, `EmbeddedResource`,
`TextResourceContents`) is checked against the v2 field-name change (camelCase → snake_case
attributes, wire format unchanged) and the `mcp.types` vs. new standalone `mcp_types` package
split; `mcp.types` remains a compatibility alias per the migration guide, but the field-name
change (e.g. any `.mimeType`-style attribute access) must be located and updated.

FR-8. `pyproject.toml`'s `mcp>=1.27.1,<2` ceiling is raised to allow `2.0.0`, and `uv.lock` is
regenerated (`uv lock`) with the new dependency graph (added: `httpx2`, `opentelemetry-api>=1.28.0`,
`mcp-types`; removed: `httpx-sse` if separately pinned, `pydantic-settings` if present). The
`python-lint` CI job's `uv lock --check` gate must pass.

FR-9. Given the protocol is now stateless (no server-initiated back-channel — sampling,
elicitation, and roots are deprecated/removed, `NoBackChannelError` at v2's 2026-07-28 era), confirm
none of the 17 tools rely on server-to-client calls (`ctx.session.*`, `Context.elicit()`,
sampling). Recon must positively confirm this rather than assume it — the tools reference table
in `services/xstockstrat-agent/CLAUDE.md` describes only client→server tool calls, but that must be
checked against the actual `app/tools.py` bodies.

FR-10. `docs/runbooks/mcp-tools.md` and `services/xstockstrat-agent/CLAUDE.md` are updated to
reflect the new SDK version, the `MCPServer` rename, and any behavior visible to MCP clients
(should be none, if the migration correctly preserves the wire-visible tool contracts — this is the
"tool-count statements kept in sync across all six inventory surfaces" invariant from the reviewer
registry).

## Out of Scope

- Adopting new v2 features not required for parity (Resolver dependency injection, OpenTelemetry
  extension APIs beyond the new mandatory dependency, MCP Apps, `InputRequiredResult`-based
  multi-round tool flows). This feature is a like-for-like migration, not a v2-features feature.
- Changing any tool's name, parameters, or return shape as observed by an MCP client — the
  reviewer-registry invariant ("MCP tool contract stability") is a hard constraint, not a stretch
  goal.
- Migrating `stdio` transport behavior beyond what's needed for the SDK bump (local dev flow via
  `MCP_TRANSPORT=stdio` must keep working).

## Affected Services

- `xstockstrat-agent` — the only service in the repo depending on the `mcp` package (confirmed:
  no `@modelcontextprotocol/sdk` or other MCP SDK usage exists elsewhere in the monorepo).

## Proto Contract Changes

- [x] No proto changes required

## Config Key Changes

- [x] No new config keys

## Database Changes

- [x] No schema changes

## Feature Workflow Notes

Branch to create: `feature/mcp-python-sdk-v2-upgrade` (branch from `main-dev`)
Approval gates required (per docs/runbooks/feature-workflow.md):
- [x] 1 service owner approval (non-breaking proto or config change) — no proto/config/DB change,
  but flagged for Security review given the OAuth surface touched (FR-6).

## Acceptance Criteria

1. `services/xstockstrat-agent/pyproject.toml` pins `mcp` to `2.0.0` (or a compatible `>=2.0.0,<3`
   range); `uv.lock` is regenerated and `uv lock --check` passes in CI.
2. The agent starts successfully in both `MCP_TRANSPORT=stdio` and `MCP_TRANSPORT=http` modes
   locally (`docker compose up xstockstrat-agent` or equivalent), preserving the `/agent`
   route-prefix behavior in the DO app spec's mental model (verified locally; DO ingress itself is
   out of scope for local verification).
3. All 17 tools remain callable with unchanged names, parameters, and return shapes — verified by
   the existing test suite plus a manual smoke call per tool category (read tool, write/management
   tool, `run_backtest`'s two-content-block return, `set_config`'s real-scope forwarding).
4. `GET /api/tools` still serves the unauthenticated tool catalog with the same 17 entries.
5. The OAuth 2.1 flow (discovery → DCR → authorize → callback → token) still works end-to-end
   against `xstockstrat-identity`, and the `aud`-bound JWT check on the root MCP endpoint still
   rejects mismatched audiences.
6. `docs/runbooks/mcp-tools.md` and `services/xstockstrat-agent/CLAUDE.md` reflect the new SDK
   version and any renamed symbols relevant to operators/contributors.
7. `pytest --cov=app --cov-fail-under=40` passes in CI (`python-test` job).

## Open Questions

- [ ] **Known trap (ledger 2026-07-29, feature 079):** if this migration removes or renames any
  transport path, do not gate verification on substring greps for old vocabulary — prose describing
  the migration (this feature's own docs, changelogs) will legitimately still mention `FastMCP`,
  `get_context`, etc. Gate on the actual removed symbols compiling/importing cleanly, not on grep
  absence of old names in running code.
- [ ] Exact scope of FR-6 (OAuth code changes) is unconfirmed until recon reads
  `app/oauth_server.py` line-by-line against the v2 OAuth changelog — the agent may not use the
  SDK's client-side OAuth provider classes at all (it implements its own AS/RS facade), in which
  case FR-6 could be a no-op confirmed by recon rather than an actual code change.
- [ ] Whether `httpx2` needs to become a direct app-level dependency (FR-4) or stays purely an
  SDK-internal transitive dependency depends on whether `app/tools.py:832`'s `httpx.AsyncClient`
  call is reachable from any v2-mandated code path — recon to confirm.
- [ ] Confirm whether the currently-shipped OAuth SEP behaviors (offline_access/prompt=consent,
  credential-to-AS binding, DCR application_type) require any config/behavior change on the
  `xstockstrat-identity` side (the durable OAuth store) or are entirely client-side/agent-side.
