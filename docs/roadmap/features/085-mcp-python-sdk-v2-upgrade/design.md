# Design: mcp-python-sdk-v2-upgrade

**Created**: 2026-07-30
**Rounds**: 2 (full; termination: approved)
**Approved by**: user @ 2026-07-30
**Grounded in**: recon.md

---

## Chosen Approach

A single-PR, in-place, mechanical migration — no branching logic, no scratch-venv step at
implementation time (that investigation already happened live during this design phase and is
recorded in `recon.md`'s Risks 1–3, all marked RESOLVED with verified facts from the real installed
`mcp==2.0.0` package). Ordered so each edit's prerequisite lands first:

1. **Dependency bump.** `pyproject.toml:6` `mcp>=1.27.1,<2` → `mcp>=2.0.0,<3`; regenerate `uv.lock`
   in the real project. **Verified live during this design phase** (not deferred): copying the real
   `pyproject.toml`, bumping the constraint, and running `uv lock` resolved cleanly — "Resolved 61
   packages in 1.65s" — against the service's full pin set (`starlette>=0.37.0`,
   `uvicorn[standard]>=0.29.0`, grpcio/protobuf/otel packages, `pyproject.toml:6-16`). No resolver
   conflict.
2. **Import/type rename.** `from mcp.server import FastMCP` → `from mcp.server.mcpserver import
   MCPServer` at `app/main.py:23,69-70` and `app/tools.py:31,88` (`FastMCP` is confirmed **fully
   removed** — `ImportError` — no compatibility alias, verified live). `app/tools.py:32`'s `Context`
   import moves to `from mcp.server.mcpserver import Context` (verified importable, same
   `request_context` shape).
3. **Server construction fix (`recon.md` Risk 1, verified minimal diff).** In `build_http_app()`,
   call `server.streamable_http_app(streamable_http_path="/")` once (primes the SDK's internal
   session manager; the returned `Starlette` app is not otherwise used — the existing custom
   `handle_mcp` dispatch stays), then replace `StreamableHTTPSessionManager(app=server._mcp_server)`
   (`app/main.py:135`) with `server.session_manager` — the newly-public property, confirmed live to
   return the identical `StreamableHTTPSessionManager` instance with unchanged `handle_request()`/
   `run()` API. Everything else in `build_http_app()`/`handle_mcp()`/`lifespan()`
   (`app/main.py:137-227` — the `_authorized` gate, the `/sse`+`/messages` 404 branch, the route
   table) is **untouched**, per recon's "pattern to preserve, not replace" (`recon.md:36-39`).
4. **Stdio simplification.** Collapse `_run_stdio()` (`app/main.py:75-81`) to `await
   server.run_stdio_async()` — confirmed live to be internally byte-for-byte identical to today's
   manual `stdio_server()` + `.run(...)` triad, just SDK-owned. A strict simplification, not merely a
   fix.
5. **Field renames.** `app/main.py:123` `t.inputSchema` → `t.input_schema` read (the JSON response
   key itself, `"inputSchema"` in the dict literal, stays camelCase — it's this service's own
   `/api/tools` UI-facing contract, not an SDK wire format, and changing it would be an unrequested,
   out-of-scope client-visible change). `app/backtest_view.py:118` `.mimeType` → `.mime_type` read
   (the `:104` constructor call is unchanged — confirmed live that `TextResourceContents` accepts
   either `mimeType=` or `mime_type=` as a kwarg).
6. **Tests — rename plus the two round-2-adversary-adopted improvements.**
   `tests/test_tools.py:16-23`, `tests/test_config_tools.py:25-32,256,258`: rename
   `FastMCP("test-agent")` → `MCPServer("test-agent")`. **Adopted from round 2's objection** (the diff
   on these exact lines is already open for the rename, so the marginal cost of also switching is
   ~zero): replace `server._tool_manager._tools[name].fn` with the new public
   `server.get_tool(name).fn` (confirmed live to exist and return the same `Tool` object with `.fn`,
   `.context_kwarg`, `.parameters` intact) instead of reaching into the private `_tools` dict.
   `tests/test_backtest_view.py:194` `.mimeType` → `.mime_type`.
7. **New automated regression test — adopted from round 2's strongest objection.** The residual risk
   this migration cannot close by static inspection is whether `_claims_from_context`
   (`app/tools.py:44-59`) still receives real claims when driven by the **actual** Streamable HTTP
   transport (`server.session_manager.handle_request` → the real ASGI request → `ctx.request_context.
   request.scope`) rather than the hand-built `SimpleNamespace` fixture `tests/test_config_tools.py:
   35-39` uses today. Round 1's proposal closed this with a manual, uncommitted smoke test; the round-2
   adversary correctly flagged that as the same "demonstration accepted as evidence, never re-run"
   shape as two prior ledger entries (`fails.md` 2026-07-27, 2026-07-29). **Adopted fix:** add a
   committed `pytest` case (in `tests/test_tools_endpoint.py` or a new `tests/
   test_streamable_http_auth.py`) that drives `TestClient(build_http_app())` through a real POST to
   `/` with a mocked-valid `Authorization: Bearer` header (mocking `app.auth.validate_bearer_jwt`
   exactly as `tests/test_auth.py:17-29` already does) carrying a real MCP `initialize` +
   `tools/call(set_config)` JSON-RPC envelope, and asserts the resulting `client.set_config` call
   receives the caller's real `access_scope` — i.e., the actual transport path, not a fixture standing
   in for it. This is new test coverage of a gap that predates this migration (today's tests only unit-
   test the tool function with a hand-built `ctx`), closed as part of this migration since it's the one
   thing the rewrite could silently break. Exact envelope construction is left to `/sdd-spec`'s
   codebase-discovery pass (may reuse an SDK test client helper if one exists) rather than fixed here.
8. **Docs.** Update `docs/runbooks/mcp-tools.md` and `services/xstockstrat-agent/CLAUDE.md` for the
   `MCPServer` rename and SDK version. State explicitly (per root `CLAUDE.md`'s `strat-lab` plugin
   rule) that none of `run_backtest`/`manage_strategy`/`trigger_backfill`/`get_backfill_status`/
   `set_strategy_live`'s name/parameters/return shape changed, so `docs/patterns/strat-lab-plugin.md`
   needs no update — confirmed, not silently skipped.
9. **FR-6 (OAuth) / FR-4 (`httpx2`) — documented confirmations, no code diff.** Recon found zero
   repo-wide matches for any SDK client-side OAuth provider class (`RFC7523OAuthClientProvider`,
   `JWTParameters`, `OAuthClientProvider`, `scopes=`, `client_secret_post`) — this service's OAuth
   AS/RS facade is 100% hand-rolled and never imports from `mcp.server.auth`. The only
   `httpx.AsyncClient` call (`app/tools.py:832`) is app-level (fetching external signal-source URLs),
   not the SDK's internal client-side transport — this service is an MCP server only, never an MCP
   client. State both confirmations explicitly in the PR description / docs.
10. **Verification.** Full `pytest --cov=app --cov-fail-under=40` + `ruff check`/`ruff format --check`
    + `uv lock --check` green; manual smoke test of `MCP_TRANSPORT=stdio` and `MCP_TRANSPORT=http`
    locally in addition to the new automated test from step 7.

## Rejected Alternatives

- **Round 1's primary/fallback branching, gated behind an unexecuted "Step A: pip install in a
  scratch venv" investigation step** — rejected because it left the single highest-risk architectural
  decision (how the ASGI transport survives the rewrite) undecided at design time, and its own
  executability (network egress) was never confirmed; the round-1 adversary correctly called this a
  placeholder for a design rather than a design. Superseded by actually performing that investigation
  live in this design phase.
- **A separate scratch venv, isolated from the real project, as the dependency-resolution check** —
  rejected in favor of bumping the real `pyproject.toml` in a scratch **copy of the whole project**
  and running `uv lock` there, because an isolated `mcp`-only install cannot prove the full project's
  dependency graph resolves; the real-project copy can and did.
- **Manual, uncommitted smoke test as the sole closure of the `_claims_from_context` residual risk**
  (round 1's original proposal) — rejected because it produces no regression protection after the PR
  merges, the same "demonstration accepted as evidence, never re-run" shape flagged twice already in
  `fails.md` (2026-07-27, 2026-07-29). Replaced with a committed automated test driving the real
  transport.
- **Leaving `_tool_manager._tools[name]` private-dict reads unchanged in the two touched test files**
  (round 2's initial proposal, justified as "unrelated hygiene, not required by this migration") —
  reconsidered and adopted the swap to the new public `get_tool()` method, since the exact same lines
  are already being edited for the `FastMCP`→`MCPServer` rename, making the marginal cost of also
  removing a private-API dependency effectively zero.
- **Migrating `app/tools.py:832`'s `httpx.AsyncClient` call to `httpx2`** — rejected; recon confirms
  this call is app-level and independent of the SDK's own transport, which is the only thing v2's
  `httpx2` requirement actually applies to.
- **Renaming the `/api/tools` JSON response key `"inputSchema"` to `input_schema`** — rejected; that
  key is this service's own UI-facing contract (consumed by `xstockstrat-ui`'s `/accounts/mcp-tools`
  page), not an SDK wire format, and the reviewer-registry's "MCP tool contract stability" invariant
  forbids an unrequested client-visible change.

## Open Risks

- [ ] The exact runtime shape `ctx.request_context.request` takes when populated by the real
  Streamable HTTP transport (as opposed to the class-level `ServerRequestContext.request: RequestT |
  None` signature confirmed by static inspection) is closed by the new automated test in step 7 above
  — to be addressed at the implementation step that adds that test, not assumed resolved by this
  design.
- [ ] The exact JSON-RPC envelope construction for the new automated test (step 7) is left to
  `/sdd-spec`'s codebase-discovery pass — to be addressed when that step is planned, not fixed here.
- [ ] Whether `docs/patterns/strat-lab-plugin.md`'s exact current skill text needs any edit is
  expected to be a no-op (no tool contract changed) but must be positively diff-checked at
  implementation time (step 8), not assumed.

## Constitution Rules Touched

- `C-01` (zero-assumption / evidence-cited) — honored by: every claim in this design is either
  cited to `recon.md path:line` or to a live verification performed during this design phase and
  recorded in `recon.md`'s Risks 1–3 (real `mcp==2.0.0` package inspection; real-project `uv lock`
  resolution) — no branch of the design rests on an unconfirmed guess about v2's API shape.
- `C-08` (test-step pairing) — honored by: step 6 (test rename) and the new step 7 (automated
  transport-auth regression test) are paired with the code changes they verify; step 7 specifically
  closes a coverage gap the round-2 adversary identified rather than leaving it as a one-time manual
  check.
- `C-10` (integration completeness across shared surfaces) — honored by: step 8 explicitly checks the
  `strat-lab` plugin surface (a cross-repo shared contract per root `CLAUDE.md`) rather than assuming
  no tool-contract change means no doc surface to check.
- `P-03` (no silent deviation — escalate, never guess) — honored by: recon's `## Not found` items were
  not silently assumed; they were investigated live (a departure from a typical recon, made possible
  because this environment has PyPI egress) and the results fed back into `recon.md` as durable,
  cited evidence before the design proceeded.
- `F-04` (never invent a file path or symbol) — honored by: every symbol named in this design
  (`MCPServer`, `streamable_http_app`, `session_manager`, `run_stdio_async`, `get_tool`,
  `Tool.input_schema`, `TextResourceContents.mime_type`) was confirmed to exist by direct inspection
  of the real installed package, not inferred from the SDK's migration-guide prose alone.
- No Floor (`F-*`) breach was raised in either round of grilling.
