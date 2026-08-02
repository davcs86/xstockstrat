# Recon: mcp-python-sdk-v2-upgrade

**Created**: 2026-07-30
**From**: product-spec.md
**Affected services**: `xstockstrat-agent` (sole consumer of the `mcp` package in the monorepo)

---

## Objective

Migrate `xstockstrat-agent` from `mcp` v1.27.1 to v2.0.0 (a breaking rewrite: `FastMCP`→`MCPServer`,
stateless-only protocol, `httpx`→`httpx2` for SDK-internal transport, OAuth SEP changes, field-name
snake_case) while preserving all 17 tools' names/parameters/return shapes, the `/agent` ASGI mounting
behavior, and the hand-rolled OAuth 2.1 AS/RS facade's external behavior.

## Codebase Map

- **`xstockstrat-agent`** (Python 3.12, asyncio, grpc.aio, FastMCP)
  - Entry point: `services/xstockstrat-agent/app/main.py:69-72` (`create_server()`), CLI dispatch at
    module bottom (`python -m app.main`, per `Dockerfile:21` per feature-079 insights entry)
  - Tool registration: `services/xstockstrat-agent/app/tools.py:88` (`register_tools(server: FastMCP)`)
  - ASGI app assembly: `services/xstockstrat-agent/app/main.py:229-245` (`build_http_app()`)
  - OAuth facade: `services/xstockstrat-agent/app/oauth_server.py` (249 lines, fully hand-rolled),
    `app/oauth_metadata.py` (RFC 8414/9728 metadata), `app/auth.py` (bearer-JWT validation)
  - Last migration: N/A — this service owns no DB schema
  - Config-read pattern: one-shot `GetConfig` via `app/client.py`, namespace `agent`
    (`services/xstockstrat-agent/CLAUDE.md:112`)
  - Dependency manifest: `services/xstockstrat-agent/pyproject.toml:6` (`mcp>=1.27.1,<2`),
    `uv.lock:439-440` (`mcp` `1.27.1`)
  - Tests: `services/xstockstrat-agent/tests/` — `test_tools.py`, `test_config_tools.py`,
    `test_backtest_view.py`, `test_tools_endpoint.py` touch `mcp` surfaces directly or indirectly;
    `test_auth.py`, `test_client.py`, `test_oauth.py` do not import `mcp` at all

## Patterns to REUSE

- Existing custom ASGI dispatch (`handle_mcp`, `app/main.py:198-221`) and route table
  (`build_http_app()`, `app/main.py:229-245`) are the pattern to preserve, not replace — the
  migration's job is to keep this shape working under v2's new transport-construction API, not to
  redesign routing.
- The service's existing convention of reading all `MCP_*` values via plain `os.environ.get(...)`
  (`app/main.py:40,57-58`; `app/client.py:18`; `app/auth.py:19`; `app/oauth_server.py:32`) rather than
  any SDK-provided settings object is already the pattern v2 forces everyone into (v2 removes SDK-level
  `MCP_*`/`.env` reading) — **no change needed here**, confirmed by recon rather than assumed.
  Reuse this as-is.
  N.B. `MCP_AGENT_SECRET` (read identically in three files) is a pre-existing, feature-073-documented
  triple-purpose env var per `docs/context-constitution.md` — unrelated to this migration, do not
  touch.
- `set_config`'s existing `ctx: Context` parameter + `_claims_from_context(ctx)`
  (`app/tools.py:44-59,704-705`) is the **only** place in the codebase that already uses the
  context-injection pattern v2 requires for the other 16 tools *if they ever need it* — none of the
  other 16 need claims today (confirmed: no other tool reads `ctx`/claims), so this is a reuse-as-model
  reference, not a pattern to propagate to all 17.

## Dependencies

- Proto/RPC: none — no `.proto` changes
- Migration: none — this service owns no DB schema
- Config keys: none new
- Inter-service edges: unaffected (`grpc.aio` calls to ingest/notify/analysis/indicators/identity/config
  are untouched by this migration — they don't go through the `mcp` package)
- New env vars / ports: none — this is a dependency-version migration, not a feature adding new wiring

## Risks / Not-found

1. **RESOLVED (verified 2026-07-30 against the real installed `mcp==2.0.0` package in a scratch
   venv, `pip install mcp==2.0.0`, since PyPI egress is available from this environment).**
   `StreamableHTTPSessionManager(app=server._mcp_server)` at `app/main.py:135` reaches into a private
   SDK attribute. Verified facts from live inspection:
   - `from mcp.server import FastMCP` raises `ImportError` in v2.0.0 — confirmed, no compatibility
     alias. Must import `from mcp.server.mcpserver import MCPServer`.
   - `MCPServer.streamable_http_app(streamable_http_path="/", ...)` exists, is public, and returns a
     `Starlette` app with a single `Route(path="/")` when called with `streamable_http_path="/"` —
     verified by constructing a live `MCPServer`, calling it, and inspecting `app.routes`.
   - `MCPServer.session_manager` is a **public property** (docstring: "exposed to enable advanced use
     cases like mounting multiple MCPServer instances in a single FastAPI application" — literally this
     service's use case) that raises `RuntimeError` if accessed before `streamable_http_app()` has been
     called once, but afterward returns the exact same `StreamableHTTPSessionManager` instance
     (`isinstance` confirmed live) with an unchanged `handle_request(scope, receive, send)` / `run()`
     API.
   - **Verified minimal fix**: call `server.streamable_http_app(streamable_http_path="/")` once during
     `build_http_app()` (primes the internal session manager; the returned Starlette app itself is not
     otherwise needed since the existing custom `handle_mcp` dispatch is preserved), then replace
     `StreamableHTTPSessionManager(app=server._mcp_server)` with `server.session_manager`. Everything
     else in `build_http_app()`/`handle_mcp()`/`lifespan()` (`app/main.py:137-227`) is unchanged.
   - **Stdio is simpler than assumed**: `MCPServer.run_stdio_async()` exists and its source is
     byte-for-byte identical in structure to today's `_run_stdio()` body (`app/main.py:78-81}` — both
     do `async with stdio_server() as (read_stream, write_stream): await <lowlevel>.run(read_stream,
     write_stream, <lowlevel>.create_initialization_options())`, just using `self._lowlevel_server`
     internally instead of the app reaching in itself. `_run_stdio()` can be simplified to
     `await server.run_stdio_async()`, dropping the private-attribute reach entirely (a strict
     simplification, not just a fix).
2. **RESOLVED (same live verification).** `Tool` (the class stored in `ToolManager._tools`) still
   has `.fn`, `.context_kwarg`, and `.parameters` attributes in v2 — confirmed by registering a live
   tool and inspecting the returned `Tool` object's `dir()`. `ToolManager` also gained a new **public**
   `get_tool(name) -> Tool | None` method (confirmed via source read) that is a safer replacement for
   reaching into the `_tools` dict directly, though the private dict itself (`_tools: dict[str, Tool]`)
   is also confirmed to still exist unchanged. `tests/test_tools.py:23` and
   `tests/test_config_tools.py:32,256,258` need only the `FastMCP`→`MCPServer` construction-call rename;
   switching to `get_tool()` is a safe, verified-available improvement but not strictly required for
   the tests to keep passing.
3. **Confirmed field renames** (live verification): `Tool.inputSchema` does not exist in v2 — only
   `Tool.input_schema` (confirmed via `hasattr`). `app/main.py:123`'s `t.inputSchema` read must become
   `t.input_schema` (the JSON response key itself, `"inputSchema"` at `app/main.py:123`, can stay
   camelCase — that's this service's own `/api/tools` contract with the UI, not an SDK wire format).
   `TextResourceContents.mime_type` is the only attribute (`.mimeType` does not exist — confirmed via
   `hasattr`); the **constructor** still accepts either `mimeType=` or `mime_type=` as a kwarg (pydantic
   alias), so `app/backtest_view.py:104`'s construction call works unchanged, but
   `app/backtest_view.py:118`'s `.mimeType` **read** must become `.mime_type` (and
   `tests/test_backtest_view.py:194` likewise). `Context` is importable unchanged from
   `mcp.server.mcpserver` (`from mcp.server.mcpserver import Context`, replacing
   `from mcp.server.fastmcp import Context`), and its `request_context.request` shape
   (`ServerRequestContext.request: RequestT | None`) is structurally the same generic
   raw-transport-request slot `_claims_from_context` (`app/tools.py:44-59`) depends on — the exact
   runtime object attached for the Streamable HTTP transport should still be confirmed with a real
   request during implementation (this one detail was not independently re-verified beyond the class
   shape, since it requires driving a full request through the transport rather than static
   inspection).
4. **No SDK OAuth classes are used at all** (`RFC7523OAuthClientProvider`, `JWTParameters`,
   `OAuthClientProvider`, `scopes=`, `client_secret_post` — zero matches repo-wide). This substantially
   *reduces* product-spec FR-6's scope: the OAuth SEP changes in v2's changelog apply to the SDK's
   own client-side OAuth provider classes, which this service's hand-rolled AS/RS facade never
   instantiates. FR-6 is very likely a **no-op**, confirmed by this recon rather than the "must verify"
   framing the product spec used — carry this into the design as a scope reduction.
5. **`httpx` vs `httpx2`**: the only direct `httpx.AsyncClient` usage (`app/tools.py:832`, inside
   `_fetch_url()`) fetches external signal-source URLs — it is app-level, not SDK-internal transport.
   Since this service acts only as an MCP *server* (never as an MCP client calling another MCP server,
   and the OAuth facade does its own token minting via gRPC to identity, not via the SDK's client-side
   OAuth transport), there is no confirmed call site that *must* move to `httpx2`. This narrows
   product-spec FR-4 to "verify, don't blanket-migrate" — the existing `httpx.AsyncClient` call can most
   likely stay on plain `httpx` as an independent app dependency.
6. **Known trap (ledger, feature 079, 2026-07-29):** any verification gate for "old transport
   symbols are gone" must be gated on symbols that literally cease to exist (e.g. `from mcp.server
   import FastMCP` failing at import time) — not a grep for the word "FastMCP", since this feature's own
   docs/PR description will legitimately still say "migrated from FastMCP" in prose.
7. **CI already guards against silent drift**: `.github/workflows/ci.yml:361-363`'s comment
   explicitly anticipates this migration ("Prevents an unpinned transitive (e.g. mcp 2.0) from silently
   drifting into CI") and `uv sync --frozen` / `uv lock --check` mean CI will not pick up `mcp==2.0.0`
   until `pyproject.toml` + `uv.lock` are deliberately bumped — this is a safety net, not a blocker.

## Recommended Scope

Advisory step boundaries for `/sdd-spec` (not binding). Risks 1–3 are now resolved by live
verification against the real `mcp==2.0.0` package (done in this design phase, not deferred to
implementation), so the steps below are concrete rather than contingent branches:

1. Bump `pyproject.toml`'s `mcp` constraint to `>=2.0.0,<3` and regenerate `uv.lock` (`uv lock`) in
   the real project (not a scratch venv) — confirms the full dependency graph resolves, matching what
   CI's `uv sync --frozen` will do.
2. Rename `FastMCP`→`MCPServer` import/type-hints (`app/tools.py:31,88`, `app/main.py:23,69-70`);
   update `app/tools.py:32`'s `Context` import to `from mcp.server.mcpserver import Context`.
3. Fix `app/main.py`'s server construction per the verified minimal diff (Risk 1): call
   `server.streamable_http_app(streamable_http_path="/")` once in `build_http_app()`, then use
   `server.session_manager` in place of `StreamableHTTPSessionManager(app=server._mcp_server)`
   (`app/main.py:135`) — everything else in `build_http_app()`/`handle_mcp()`/`lifespan()`
   (`app/main.py:137-227`) is unchanged. Simplify `_run_stdio()` (`app/main.py:75-81`) to
   `await server.run_stdio_async()`.
4. Fix the confirmed snake_case field renames: `app/backtest_view.py:118` (`.mimeType`→`.mime_type`
   read; the `:104` constructor call can keep `mimeType=` or move to `mime_type=`, both work),
   `app/main.py:123` (`t.inputSchema`→`t.input_schema` read; the JSON response key name itself can
   stay `"inputSchema"` — that's this service's own UI-facing contract, not an SDK format).
5. Update `tests/test_tools.py:16-23` and `tests/test_config_tools.py:25-32,256,258`: rename
   `FastMCP("test-agent")`→`MCPServer("test-agent")`; the private `_tool_manager._tools[name].fn` /
   `.context_kwarg` / `.parameters["properties"]` reads are confirmed to still work unchanged (Risk 2),
   so no further test rewrite is strictly required — optionally switch to the new public
   `get_tool(name)` method as a durability improvement. Fix `tests/test_backtest_view.py:194`
   (`.mimeType`→`.mime_type`).
6. Confirm (not change) FR-6 (OAuth) and FR-4 (`httpx2`) are no-ops per Risks 4–5; document the
   confirmation rather than skip it silently.
7. Confirm whether the migration changes any of the four tools root `CLAUDE.md` names as requiring a
   same-PR `strat-lab` plugin skill update (`run_backtest`, `manage_strategy`,
   `trigger_backfill`/`get_backfill_status`, `set_strategy_live` — `docs/patterns/strat-lab-plugin.md`).
   Expected no-op since no tool name/parameter/return shape changes, but state that explicitly rather
   than leaving it unaddressed.
8. Update `docs/runbooks/mcp-tools.md` and `services/xstockstrat-agent/CLAUDE.md` for the new SDK
   version and any renamed symbols worth telling operators/contributors about.
9. Full test suite + `ruff` + `uv lock --check` green; manual smoke test of both transports locally
   (`MCP_TRANSPORT=stdio` and `MCP_TRANSPORT=http`), including one authenticated `set_config` call to
   confirm `_claims_from_context`'s `ctx.request_context.request.scope` path still delivers claims
   correctly under the real Streamable HTTP transport (the one item in Risk 3 not independently
   verified by static inspection).
