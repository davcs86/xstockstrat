# Implementation Spec: mcp-python-sdk-v2-upgrade

**Status**: `code-completed`
**Created**: 2026-07-30
**Feature**: `docs/roadmap/features/080-mcp-python-sdk-v2-upgrade/feature.md`
**Total Steps**: 5
**Feature Branch**: `feature/mcp-python-sdk-v2-upgrade`

---

## Execution Summary

A single-PR, in-place mechanical migration, following `design.md`'s Chosen Approach and grounded
by fresh live verification against the real installed `mcp==2.0.0` package performed during this
`/sdd-spec` session (a scratch venv, `pip install mcp==2.0.0`; deleted after use — same method
`recon.md`/`design.md` used, applied here to close the two gaps they left open). **Step 1** bumps
the dependency alone, which is what makes the entire existing suite fail at collection
(`ImportError: cannot import name 'FastMCP' from 'mcp.server'`) — that failure is this migration's
red. **Step 2** lands every production-code edit across `app/main.py`, `app/tools.py`, and
`app/backtest_view.py` together, because they are import-coupled (`app.main` imports
`app.tools`, both import from `mcp.server`) and cannot be verified independently — splitting them
would leave an uncommittable intermediate state, the same reasoning feature 079's Deviation D-1
recorded. **Step 3** rewrites the three existing test files the rename touches, which is the green
for Steps 1–2. **Step 4** adds new, previously-absent coverage of the real Streamable HTTP
transport driving real caller claims into `set_config` (design.md step 7 — this closes the one
residual risk design.md left open, "Open Risks" item 1). **Step 5** sweeps the two doc surfaces
that actually say "FastMCP" and confirms, in the PR body, four things that need no code change:
FR-6 (OAuth), FR-4 (`httpx2`), `docs/runbooks/mcp-tools.md` (never named FastMCP or an SDK version
to begin with), and `docs/patterns/strat-lab-plugin.md` (no tool contract changed).

**Two corrections to `design.md`, found during this session's live re-verification (not
assumptions — see each step's Codebase Evidence for the exact commands run):**

1. **Design.md's `server.get_tool(name)` does not exist.** Live inspection of the installed
   `mcp==2.0.0` package shows `get_tool` is a method of `MCPServer._tool_manager` (the
   `ToolManager` instance), not of `MCPServer` itself — `AttributeError: 'MCPServer' object has no
   attribute 'get_tool'`. The correct call, which recon.md's underlying claim ("`ToolManager` also
   gained a new public `get_tool(name)` method") actually supports, is
   `server._tool_manager.get_tool(name)`. Step 3 uses the corrected form.
2. **`server.call_tool()`'s return shape changed and neither `recon.md` nor `design.md` covered
   it.** In `mcp==1.27.1`, `FastMCP.call_tool()` returns a plain `tuple[list[ContentBlock], dict]`
   (verified live: `([TextContent(...)], {'result': 5})`), which is why
   `tests/test_tools.py:442-444` indexes the return value directly as `content[0]`/`content[1]`.
   In `mcp==2.0.0`, `MCPServer.call_tool()` returns a `CallToolResult` object (verified live:
   `<class 'mcp_types._types.CallToolResult'>` with a `.content` list attribute) — the old
   subscript access would raise `TypeError: 'CallToolResult' object is not subscriptable`. Step 3
   fixes this.

**One production risk found and closed during this session, absent from `design.md`'s "verified
minimal diff":** `Server.streamable_http_app()` (which `MCPServer.streamable_http_app()` delegates
to) auto-enables DNS-rebinding-protection Host/Origin header checks, restricted to
`127.0.0.1`/`localhost`/`::1`, whenever its `host` parameter is left at its default
(`"127.0.0.1"`) — which is exactly how `design.md`'s fix calls it (no `host=` override). Verified
live: an in-process request through a `TestClient` (`Host: testserver`) got `421 Invalid Host
Header` until `transport_security=TransportSecuritySettings(enable_dns_rebinding_protection=False)`
was passed explicitly. Today's `v1` code never goes through this path at all — it constructs
`StreamableHTTPSessionManager(app=server._mcp_server)` directly, bypassing
`Server.streamable_http_app()`'s auto-security wrapper entirely — so in production, where the real
`Host` header is the DO app's public domain (never `127.0.0.1`), this migration's own "verified
minimal fix" would have silently broken every real Streamable HTTP request behind a `421`, the
opposite of "no behavior change" (same shape as the ledger's 2026-07-26 071 entry). Step 2 carries
the one-parameter fix.

## Step Dependencies

- **Step 2 requires Step 1**: `MCPServer`/`mcp.server.mcpserver` do not exist until the `mcp`
  dependency is at `2.0.0`; editing the source first would leave every import unresolvable against
  the still-pinned `1.27.1`.
- **Step 3 [test] covers Steps 1–2 [service]** (C-08). Per `tdd-gate.md`, the red is captured by
  running the existing suite (no new test authored — the existing files already assert the
  behavior) against the tree with Step 1 applied but before Step 2/3 land: it fails at collection
  with `ImportError: cannot import name 'FastMCP' from 'mcp.server'`, hit by `app/main.py:23`,
  `app/tools.py:31`, `tests/test_tools.py:10`, `tests/test_config_tools.py:18` — a genuine
  incompatibility with the new SDK, not a typo. Steps 2 and 3 together are what turns it green,
  captured by Step 3's Verification command.
- **Step 2 and Step 3 cannot be split further and verified independently**: `app/main.py` imports
  `app/tools.py` (`app/main.py:27`), and both import from `mcp.server`, so an intermediate state
  with only one of the three production files fixed still fails collection for the whole suite. All
  three production-file edits land in Step 2; all three touched test files land in Step 3. This
  mirrors feature 079's Deviation D-1 (two renames combined because splitting left an unreviewable,
  unverifiable intermediate state).
- **Step 4 requires Step 2**: the new test drives the real `build_http_app()`/`session_manager`
  construction Step 2 introduces; it cannot be authored against the pre-migration transport
  construction.
- **Step 4 does not require Step 3**: it exercises a different code path (the real ASGI transport)
  than the three existing test files (which call tool functions directly or construct a hand-built
  `ctx`), so it has no import/fixture dependency on Step 3's edits. Sequenced after Step 3 anyway,
  so the full suite stays green end-to-end at every commit.
- **Step 5 requires Steps 1–4**: the doc sweep and the FR-6/FR-4/strat-lab-plugin no-op
  confirmations are only accurate once the migration and its new test have actually landed.

---

### Step 1 — service: bump the `mcp` dependency to `>=2.0.0,<3` and regenerate `uv.lock`

**Status**: `done`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/pyproject.toml` — modify
- `services/xstockstrat-agent/uv.lock` — modify (regenerated, not hand-edited)

**Reviewers**: `xstockstrat-agent` (service owner) — dependency-graph correctness, `uv lock --check`
CI gate

**Codebase Evidence**:
- `services/xstockstrat-agent/pyproject.toml:6` → `"mcp>=1.27.1,<2",` — confirmed via `Read`
- `services/xstockstrat-agent/uv.lock:459-461` → `name = "mcp"` / `version = "1.27.1"` /
  `sdist = { url = ".../mcp-1.27.1.tar.gz", ... }`; `uv.lock:1318` →
  `{ name = "mcp", specifier = ">=1.27.1,<2" }`
- **Verified live during this `/sdd-spec` session** (not assumed — `recon.md`/`design.md` already
  ran this once; re-run here to confirm it still holds): copied the real
  `services/xstockstrat-agent/` tree to a scratch directory, changed `pyproject.toml:6` to
  `"mcp>=2.0.0,<3",`, and ran `uv lock`. Output: `Resolved 61 packages in 2.14s`, with these deltas
  reported by `uv`:
  ```
  Added httpcore2 v2.9.1
  Removed httpx-sse v0.4.3
  Added httpx2 v2.9.1
  Updated idna v3.16 -> v3.18
  Updated mcp v1.27.1 -> v2.0.0
  Added mcp-types v2.0.0
  Removed pydantic-settings v2.14.1
  Added truststore v0.10.4
  ```
  No resolver conflict against the service's full pin set (`starlette>=0.37.0`,
  `uvicorn[standard]>=0.29.0`, `grpcio`/`protobuf`/`opentelemetry-*`, `pyproject.toml:6-16`).
  `httpx>=0.27.0` (the app's own direct dependency, `pyproject.toml:7`) is **untouched** — `httpx2`
  arrives as a new *transitive* dependency of `mcp` itself, confirming FR-4's "verify, don't
  blanket-migrate" framing (Step 5 documents this confirmation).
- `.github/workflows/ci.yml:317` → `run: uv lock --check` (the `python-lint` job's gate this step
  must keep passing); `.github/workflows/ci.yml:361-365` → the `uv sync --frozen --extra dev`
  comment "Prevents an unpinned transitive (e.g. mcp 2.0) from silently drifting into CI" —
  this step is the deliberate, reviewed version of exactly that drift.

**TDD**: `N/A (dependency manifest only, no executable logic in this step)`. This step's bump is
what makes the existing suite fail at collection — that failure is the red for the Step 1–2/Step 3
cycle (see `## Step Dependencies`), not a new test of its own.

**Instructions**:

1. In `services/xstockstrat-agent/pyproject.toml:6`, change `"mcp>=1.27.1,<2",` to
   `"mcp>=2.0.0,<3",`. Change nothing else in the file.
2. Run `cd services/xstockstrat-agent && uv lock` to regenerate `uv.lock` against the real project
   (not a scratch copy) — this is the actual lock file that ships, so it must be the one CI's
   `uv lock --check` validates.
3. Do not hand-edit `uv.lock` — it is fully regenerated output.

**Verification**:

```bash
cd services/xstockstrat-agent \
  && uv lock --check \
  && grep -n '"mcp>=2.0.0,<3"' pyproject.toml \
  && grep -n 'name = "mcp"' -A2 uv.lock
```

Expect: `uv lock --check` exits 0 (lock file matches the manifest), the bumped constraint is
present, and `uv.lock`'s `mcp` entry shows `version = "2.0.0"`.

---

### Step 2 — service: migrate `app/main.py`, `app/tools.py`, and `app/backtest_view.py` to the v2 API surface

**Status**: `done`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/app/main.py` — modify
- `services/xstockstrat-agent/app/tools.py` — modify
- `services/xstockstrat-agent/app/backtest_view.py` — modify

**Reviewers**: `xstockstrat-agent` (service owner) — MCP tool contract stability, transport
construction correctness; Security — the `transport_security` change below is a security-relevant
decision on the HTTP transport's edge (OAuth 2.1 edge-auth correctness / statelessness per the
reviewer registry's `xstockstrat-agent` row)

**Codebase Evidence**:

*Live verification performed during this session* (scratch venv, `pip install mcp==2.0.0`;
deleted after use):

- `from mcp.server import FastMCP` → `ImportError: cannot import name 'FastMCP' from 'mcp.server'`
  — confirmed, no compatibility alias.
- `from mcp.server.fastmcp import Context` → `ModuleNotFoundError: No module named
  'mcp.server.fastmcp'`. `from mcp.server.mcpserver import Context` succeeds; `type(Context)` is
  `mcp.server.mcpserver.context.Context`.
- `MCPServer.streamable_http_app(self, *, streamable_http_path="/mcp", ..., transport_security=None,
  host="127.0.0.1") -> Starlette` — confirmed via `inspect.signature`.
- `MCPServer.session_manager` is a public `@property` (confirmed via `inspect.getsource`):
  returns `self._lowlevel_server.session_manager`, raises `RuntimeError("Session manager can only
  be accessed after calling streamable_http_app()...")` if accessed first, and returns an instance
  of `mcp.server.streamable_http_manager.StreamableHTTPSessionManager` (confirmed via
  `type(sm).__module__` — **the module path `test_oauth.py:117` already patches is unchanged**, so
  that test needs no edit).
- `MCPServer` has **no** `._mcp_server` attribute (`hasattr(s, "_mcp_server")` → `False`); it has
  `._lowlevel_server` instead (`hasattr(s, "_lowlevel_server")` → `True`). This confirms
  `app/main.py:135`'s `StreamableHTTPSessionManager(app=server._mcp_server)` cannot be patched
  in place — it must be replaced with `server.session_manager` (which never touches
  `_lowlevel_server` from this file at all).
- **Critical, previously unverified finding**: `Server.streamable_http_app()`
  (`mcp.server.lowlevel.server.Server`, which `MCPServer.streamable_http_app()` delegates to,
  confirmed via `inspect.getsource`) contains:
  ```python
  # Auto-enable DNS rebinding protection for localhost (IPv4 and IPv6)
  if transport_security is None and host in ("127.0.0.1", "localhost", "::1"):
      transport_security = TransportSecuritySettings(
          enable_dns_rebinding_protection=True,
          allowed_hosts=["127.0.0.1:*", "localhost:*", "[::1]:*"],
          allowed_origins=["http://127.0.0.1:*", "http://localhost:*", "http://[::1]:*"],
      )
  ```
  Reproduced live: calling `server.streamable_http_app(streamable_http_path="/")` (no `host=`
  override, so it defaults to `"127.0.0.1"`) and then driving a request through
  `session_manager.handle_request` with `Host: testserver` (a `starlette.testclient.TestClient`
  default) returned `421 Invalid Host Header`. Passing
  `transport_security=TransportSecuritySettings(enable_dns_rebinding_protection=False)` explicitly
  made the identical request succeed (`200 OK`). Confirmed `mcp.server.transport_security.
  TransportSecuritySettings` is importable and accepts `enable_dns_rebinding_protection: bool`.
  Today's `v1` code (`app/main.py:135`, `StreamableHTTPSessionManager(app=server._mcp_server)`)
  never calls `Server.streamable_http_app()` at all, so this auto-security wrapper never runs today
  — in production the real `Host` header is the DO app's public domain, never `127.0.0.1`, so this
  fix must land in the same edit as the construction change or the migration would 421 every real
  request.
- `MCPServer.run_stdio_async(self) -> None` (confirmed via `inspect.getsource`):
  ```python
  async def run_stdio_async(self) -> None:
      """Run the server using stdio transport."""
      async with stdio_server() as (read_stream, write_stream):
          await self._lowlevel_server.run(
              read_stream, write_stream, self._lowlevel_server.create_initialization_options()
          )
  ```
  Structurally identical to today's `_run_stdio()` body (`app/main.py:78-81`), just internally
  using `self._lowlevel_server` — confirms `_run_stdio()` can call this directly instead of
  reaching into a private attribute itself.
- `Tool` objects returned by `await server.list_tools()` have `.input_schema` (`hasattr` → `True`)
  and **not** `.inputSchema` (`hasattr` → `False`) — confirms `app/main.py:123`'s
  `t.inputSchema` read must become `t.input_schema`.
- `TextResourceContents` (confirmed live): constructing with `mimeType="application/json"` works
  (pydantic alias accepted), and the resulting object's `.mime_type` reads `"application/json"`
  while `hasattr(obj, "mimeType")` is `False` — confirms `app/backtest_view.py:104`'s **constructor**
  call needs no change, but `:118`'s **read** does.

*Static evidence (this repo)*:

- `app/main.py:23` → `from mcp.server import FastMCP`
- `app/main.py:24` → `from mcp.server.stdio import stdio_server` (becomes dead code once
  `run_stdio_async()` is used — `MCPServer.run_stdio_async` imports `stdio_server` itself
  internally, confirmed above)
- `app/main.py:69-70` → `def create_server() -> FastMCP:` / `server = FastMCP("xstockstrat-agent")`
- `app/main.py:75-81` → `_run_stdio()`'s current body (`server._mcp_server.run(...)`)
- `app/main.py:92` → `from mcp.server.streamable_http_manager import StreamableHTTPSessionManager`
  (the import to remove — it is no longer constructed directly)
- `app/main.py:109-128` → `list_tools_metadata`; `:123` → `"inputSchema": t.inputSchema,`
- `app/main.py:130-135` → the Streamable HTTP transport comment block and
  `session_manager = StreamableHTTPSessionManager(app=server._mcp_server)`
- `app/main.py:137-227` — `_authorized`, `_send_unauthorized`, `_send_transport_removed`,
  `handle_mcp`, `lifespan`, the `routes` list — **all untouched**, per `recon.md`'s "pattern to
  preserve, not replace" (`recon.md:36-39`)
- `app/tools.py:31` → `from mcp.server import FastMCP`
- `app/tools.py:32` → `from mcp.server.fastmcp import Context`
- `app/tools.py:44` → `def _claims_from_context(ctx: Context) -> dict | None:` — **unchanged**, only
  the import moves
- `app/tools.py:88` → `def register_tools(server: FastMCP) -> None:`
- `app/tools.py:267-269` → the comment `# structured_output=False is forward-protection, not
  load-bearing today: for a bare -> list\n  # FastMCP builds no output schema either way...` — names
  the removed class in prose, must be reworded (not left stale, and not a code-behavior change:
  `@server.tool(structured_output=False)` at `:270` is unaffected — confirmed live that
  `MCPServer.tool()`'s signature still accepts `structured_output: bool | None = None`)
- `app/tools.py:705` → `ctx: Context,` in `set_config`'s signature — **unchanged**
- `app/backtest_view.py:23` → `from mcp.types import Annotations, EmbeddedResource,
  TextResourceContents` — **unchanged**, `mcp.types` remains a valid compatibility import
  (confirmed live: `from mcp.types import EmbeddedResource, TextContent` succeeds against
  `mcp==2.0.0`)
- `app/backtest_view.py:104` → `mimeType=_ATTACHMENT_MIME,` inside the `TextResourceContents(...)`
  constructor call — **unchanged**
- `app/backtest_view.py:118` → `return [{"uri": str(b.resource.uri), "mime_type": b.resource.mimeType}
  for b in blocks]` — the read that must change

**TDD**: `red-green required` — paired with Step 3. The red is captured by running the existing
suite against the tree with Step 1 already applied but before this step's edits:
`ImportError: cannot import name 'FastMCP' from 'mcp.server'` at collection. Step 3's full-suite run
is the green.

**Instructions**:

**`app/main.py`:**

1. Line 23: `from mcp.server import FastMCP` → `from mcp.server.mcpserver import MCPServer`.
2. Delete line 24 (`from mcp.server.stdio import stdio_server`) — dead once instruction 5 lands.
3. Lines 69-70:
   ```python
   def create_server() -> MCPServer:
       server = MCPServer("xstockstrat-agent")
       register_tools(server)
       return server
   ```
4. Add a new import inside `build_http_app()`'s local-import block, replacing line 92's
   `from mcp.server.streamable_http_manager import StreamableHTTPSessionManager` with:
   ```python
   from mcp.server.transport_security import TransportSecuritySettings
   ```
5. Replace `_run_stdio()` (lines 75-81) with:
   ```python
   async def _run_stdio() -> None:
       server = create_server()
       log.info("xstockstrat-agent starting (transport=stdio)")
       await server.run_stdio_async()
   ```
6. Line 123: `"inputSchema": t.inputSchema,` → `"inputSchema": t.input_schema,` (the JSON response
   key name itself stays `"inputSchema"` — this is the service's own `/api/tools` UI-facing
   contract, not an SDK wire format, and `tests/test_tools_endpoint.py:51-55` already assert on
   that literal key unchanged).
7. Replace lines 130-135 (the session-manager construction) with:
   ```python
   # Prime the SDK's internal session manager once. The returned Starlette app itself is
   # discarded -- the existing custom `handle_mcp` dispatch below is preserved unchanged.
   # transport_security is explicitly disabled here: Server.streamable_http_app() auto-enables
   # DNS-rebinding Host/Origin checks restricted to 127.0.0.1/localhost/::1 whenever `host` is
   # left at its default, which would reject every real (non-localhost) production request with
   # 421. Today's code never went through this path, so this restores that "no host
   # restriction" behavior -- the actual access control is _authorized's aud-bound JWT check
   # below, which already runs before this session manager ever sees the request.
   server.streamable_http_app(
       streamable_http_path="/",
       transport_security=TransportSecuritySettings(enable_dns_rebinding_protection=False),
   )
   session_manager = server.session_manager
   ```
   Keep the surrounding comment block (the "Streamable HTTP transport (MCP 2025-03-26)..."
   paragraph) — it still accurately describes why the transport lives at the agent root.
8. Change nothing else in `build_http_app()`, `handle_mcp()`, or `lifespan()` — `_authorized`,
   `_send_unauthorized`, `_send_transport_removed`, and the `routes` list are all untouched.

**`app/tools.py`:**

1. Line 31: `from mcp.server import FastMCP` → `from mcp.server.mcpserver import MCPServer`.
2. Line 32: `from mcp.server.fastmcp import Context` → `from mcp.server.mcpserver import Context`.
3. Line 88: `def register_tools(server: FastMCP) -> None:` → `def register_tools(server: MCPServer)
   -> None:`.
4. Lines 267-269: reword the comment to drop the removed class name while keeping its meaning,
   e.g. `# structured_output=False is forward-protection, not load-bearing today: for a bare ->
   list\n    # the SDK builds no output schema either way. It becomes load-bearing only if the
   annotation is\n    # ever parameterized (list[ContentBlock]), which would build one by
   default.` Change no other word.
5. Change nothing else — `_claims_from_context`'s signature (`:44`), `set_config`'s `ctx: Context`
   parameter (`:705`), and every tool body are unaffected by the import move.

**`app/backtest_view.py`:**

1. Line 118: `"mime_type": b.resource.mimeType` → `"mime_type": b.resource.mime_type`.
2. Line 104's `mimeType=_ATTACHMENT_MIME` constructor kwarg: **no change** — confirmed live that
   `TextResourceContents` still accepts `mimeType=` as a constructor kwarg (pydantic alias). State
   this explicitly in the PR description rather than leaving it unaddressed.

**Verification**:

```bash
cd services/xstockstrat-agent \
  && ruff check app/main.py app/tools.py app/backtest_view.py \
  && ruff format --check app/main.py app/tools.py app/backtest_view.py \
  && grep -n "from mcp.server.mcpserver import MCPServer" app/main.py app/tools.py \
  && ! grep -rn "from mcp.server import FastMCP\|server\._mcp_server\|StreamableHTTPSessionManager(app=" app/main.py app/tools.py \
  && grep -n "TransportSecuritySettings(enable_dns_rebinding_protection=False)" app/main.py \
  && grep -n "t.input_schema" app/main.py \
  && grep -n "b.resource.mime_type" app/backtest_view.py
```

Expect: ruff clean on all three files, the new import present, no remaining `FastMCP`/
`_mcp_server`/direct-construction hits in these two files, the `transport_security` fix present,
and both field-rename reads present. This step alone will **not** make `pytest` collect
successfully — `tests/test_tools.py` and `tests/test_config_tools.py` still import `FastMCP` until
Step 3 lands (see `## Step Dependencies`); do not attempt a full-suite run here.

---

### Step 3 — test: rewrite the three existing test files against the v2 API

**Status**: `done`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/tests/test_tools.py` — modify
- `services/xstockstrat-agent/tests/test_config_tools.py` — modify
- `services/xstockstrat-agent/tests/test_backtest_view.py` — modify

**Reviewers**: `xstockstrat-agent` (service owner) — MCP tool contract stability; Security —
`test_config_tools.py`'s `TestSdkWiring` class is the assertion that `ctx` injection and the
`set_config` real-scope forwarding still wire correctly

**Codebase Evidence**:
- `tests/test_tools.py:10` → `from mcp.server import FastMCP`
- `tests/test_tools.py:16-17` → `def _make_server() -> FastMCP:` / `server = FastMCP("test-agent")`
- `tests/test_tools.py:22-23` → `def _tool_fn(server: FastMCP, name: str):` /
  `return server._tool_manager._tools[name].fn`
- `tests/test_tools.py:321` → `schema = next(t for t in tools if t.name == "run_backtest").inputSchema`
- `tests/test_tools.py:437-444` → `test_the_published_tool_returns_two_content_blocks`:
  ```python
  from mcp.types import EmbeddedResource, TextContent
  with patch.object(client, "run_backtest", AsyncMock(return_value=self._result())):
      server = _make_server()
      args = {"strategy_id": "sma", "symbols": ["A"]}
      content = await server.call_tool("run_backtest", args)
  assert isinstance(content[0], TextContent)
  assert isinstance(content[1], EmbeddedResource)
  ```
  **Live-verified during this session** (see Step 2's Codebase Evidence and this spec's Execution
  Summary correction 2): in `mcp==1.27.1`, `FastMCP.call_tool()` returns
  `tuple[list[ContentBlock], dict]` — direct-subscriptable, which is why `content[0]`/`content[1]`
  works today. In `mcp==2.0.0`, `MCPServer.call_tool()` returns a `CallToolResult` object whose
  content lives at `.content` (confirmed live: `res.content[0]` is a `TextContent`, `res.content[1]`
  is an `EmbeddedResource`, matching this test's expectations once accessed through `.content`).
- `tests/test_config_tools.py:18` → `from mcp.server import FastMCP`
- `tests/test_config_tools.py:25-26` → `def _make_server() -> FastMCP:` /
  `server = FastMCP("test-agent")`
- `tests/test_config_tools.py:31-32` → `def _tool_fn(server: FastMCP, name: str):` /
  `return server._tool_manager._tools[name].fn`
- `tests/test_config_tools.py:256` →
  `assert server._tool_manager._tools["set_config"].context_kwarg == "ctx"`
- `tests/test_config_tools.py:258` →
  `props = server._tool_manager._tools["set_config"].parameters["properties"]`
- **Correction to `design.md`** (see Execution Summary correction 1): `design.md` step 6 says to
  replace these `._tools[name]` reads with `server.get_tool(name)`. Live verification during this
  session shows `MCPServer` has no `get_tool` attribute at all
  (`AttributeError: 'MCPServer' object has no attribute 'get_tool'. Did you mean: 'add_tool'?`).
  The method recon.md's underlying claim refers to lives on the tool manager:
  `server._tool_manager.get_tool(name)` (confirmed live to return the same `Tool` object with
  `.fn`, `.context_kwarg`, `.parameters` intact — `fn=<function dummy at ...> ... context_kwarg=None
  ... parameters={...}`). Use `server._tool_manager.get_tool(name)`, not `server.get_tool(name)`.
- `tests/test_backtest_view.py:194` → `assert block.resource.mimeType == "application/json"`
- **Confirmed unchanged, no edit needed**: `tests/test_oauth.py:117` patches
  `"mcp.server.streamable_http_manager.StreamableHTTPSessionManager.handle_request"` — Step 2's
  Codebase Evidence confirms this exact module path is unchanged in `mcp==2.0.0`
  (`type(session_manager).__module__ == "mcp.server.streamable_http_manager"`), so this patch
  target still resolves and this test needs no change. `tests/test_tools_endpoint.py` asserts on
  the `/api/tools` JSON body's `"inputSchema"` **key** (`:51,55`), which Step 2 deliberately keeps
  camelCase — no change needed there either.

**TDD**: `red-green required` — this is the green half of Step 2's cycle. The red (existing suite
failing at collection once Step 1 lands, before this step) was captured before Step 2's
implementation, per `tdd-gate.md`.

**Instructions**:

**`tests/test_tools.py`:**

1. Line 10: `from mcp.server import FastMCP` → `from mcp.server.mcpserver import MCPServer`.
2. Lines 16-17: `def _make_server() -> MCPServer:` / `server = MCPServer("test-agent")`.
3. Lines 22-23: `def _tool_fn(server: MCPServer, name: str):` /
   `return server._tool_manager.get_tool(name).fn`.
4. Line 321: `.inputSchema` → `.input_schema`.
5. Lines 437-444: change
   ```python
   content = await server.call_tool("run_backtest", args)
   ```
   to
   ```python
   result = await server.call_tool("run_backtest", args)
   content = result.content
   ```
   Leave the two `assert isinstance(content[0], ...)` / `assert isinstance(content[1], ...)` lines
   and the `from mcp.types import EmbeddedResource, TextContent` import unchanged — both classes
   remain importable from `mcp.types` unchanged.

**`tests/test_config_tools.py`:**

1. Line 18: `from mcp.server import FastMCP` → `from mcp.server.mcpserver import MCPServer`.
2. Lines 25-26: `def _make_server() -> MCPServer:` / `server = MCPServer("test-agent")`.
3. Lines 31-32: `def _tool_fn(server: MCPServer, name: str):` /
   `return server._tool_manager.get_tool(name).fn`.
4. Line 256: `assert server._tool_manager.get_tool("set_config").context_kwarg == "ctx"`.
5. Line 258: `props = server._tool_manager.get_tool("set_config").parameters["properties"]`.
6. Change nothing else — `_ctx()` (`:35-39`), the `ADMIN`/`TRADER` fixtures (`:42-43`), and every
   test body are unaffected.

**`tests/test_backtest_view.py`:**

1. Line 194: `assert block.resource.mimeType == "application/json"` →
   `assert block.resource.mime_type == "application/json"`.

**Verification**:

```bash
cd services/xstockstrat-agent \
  && uv sync --frozen --extra dev \
  && uv run pytest --cov=app --cov-report=term-missing --cov-fail-under=40 \
  && ruff check . && ruff format --check .
```

Expect: full suite green at ≥40% coverage (the CI threshold, `.github/workflows/ci.yml`
`python-test` matrix entry for `xstockstrat-agent`), ruff clean. This is the first point in the
migration where the full suite can run at all — capture this run's output as the green half of the
Step 2/3 TDD cycle in the PR body and `context.md`, per `tdd-gate.md`.

---

### Step 4 — test: new regression coverage for real claims flowing through the real Streamable HTTP transport

**Status**: `done`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/tests/test_streamable_http_auth.py` — create

**Reviewers**: `xstockstrat-agent` (service owner) — this is the proof that `set_config`'s
real-caller-scope forwarding (feature 073 FR-5) still works end-to-end; Security — this is new,
previously-absent coverage of the OAuth-gated transport boundary

**Codebase Evidence**:
- **Not found** — no existing test drives a real JSON-RPC session through
  `build_http_app()`'s `session_manager.handle_request`; every existing test either calls a tool
  function directly (`test_tools.py`, `test_config_tools.py` via `_tool_fn`) or hand-builds a `ctx`
  fixture (`test_config_tools.py:35-39`'s `_ctx()`, a `SimpleNamespace`). This file is created from
  scratch, closing `design.md`'s Open Risk 1 and step 7.
- `app/tools.py:44-59` → `_claims_from_context`, reading
  `ctx.request_context.request.scope["state"][MCP_CLAIMS_SCOPE_KEY]`
- `app/main.py:137-166` → `_authorized`, which sets
  `scope.setdefault("state", {})[MCP_CLAIMS_SCOPE_KEY] = claims` on the real ASGI `scope` before
  handing off to `session_manager.handle_request`
- `app/scopes.py:18` → `MCP_CLAIMS_SCOPE_KEY = "mcp_claims"`
- `app/scopes.py:26-41` → `roles_to_access_scope`: `roles=["admin"]` → `15`
  (`READ|WRITE|ADMIN|TRADING` = `0x01|0x02|0x04|0x08`)
- `app/tools.py:773-785` → `set_config`'s tail: `access_scope = roles_to_access_scope(
  claims.get("roles"))` then `client.set_config(..., access_scope=access_scope)`
- `app/client.py:916-925` → `set_config(namespace, key, value_type, value, environment,
  trading_mode, author, reason, access_scope) -> dict`
- `app/client.py:888` → `list_config_keys(namespace, environment, trading_mode) -> dict` — returns
  `{"keys": [...]}`; `set_config` (`app/tools.py:758-771`) calls this first to check `is_secret`
- `tests/test_oauth.py:111-115` → the existing mock pattern this new test reuses:
  `patch("app.auth.validate_bearer_claims", AsyncMock(return_value={...}))`
- **Live-verified during this session** (scratch reproduction of `build_http_app()`'s exact
  construction pattern from Step 2, driven through `starlette.testclient.TestClient`): a genuine
  3-message JSON-RPC handshake (`initialize` → `notifications/initialized` → `tools/call`) against
  the real `session_manager.handle_request` succeeds end-to-end once `Accept: application/json,
  text/event-stream` is sent and the `mcp-session-id` response header from `initialize` is echoed
  back on the following two requests. Responses are SSE-framed
  (`event: message\ndata: {...}\n\n`, `content-type: text/event-stream`) — not plain JSON — so the
  test must parse the `data:` line. Reproduced output for a `tools/call` against a claims-echoing
  tool: `{"jsonrpc":"2.0","id":2,"result":{"content":[{"text":"msg=hi claims={'user_id': 'u-1',
  'roles': ['admin']}", ...}], "isError": false, ...}}` — the claims genuinely round-tripped
  through the real ASGI scope, into `ctx.request_context.request.scope`, confirming the mechanism
  `_claims_from_context` depends on works under the real transport (`design.md`'s Open Risk 1,
  now closed).

**TDD**: `red-green required` — this is genuinely new coverage of an existing, currently-untested
code path (not new behavior). Per `tdd-gate.md`'s allowed escape for this shape: author the test
first, then **prove it has teeth** (ledger `insights.md` 2026-07-27, "the frozen clock test has
teeth") by temporarily breaking the mechanism it guards — comment out
`scope.setdefault("state", {})[MCP_CLAIMS_SCOPE_KEY] = claims` in `app/main.py`'s `_authorized`
(`:165`) — and confirm the new test fails (claims come back `None`, `set_config` raises the
"requires the Streamable HTTP transport" `RuntimeError` instead of succeeding, surfaced as the
JSON-RPC response's `isError: true`). Restore the line and confirm the test passes. Record both
captures per `tdd-gate.md`; do not skip the teeth-proof.

**Instructions**:

1. Create `tests/test_streamable_http_auth.py`:

   ```python
   """Regression test: real caller claims flowing through the real Streamable HTTP transport
   (feature 080, closing design.md's Open Risk 1).

   Every existing test either calls a tool function directly or hand-builds a `ctx` fixture
   (test_config_tools.py's `_ctx()`). This drives an actual JSON-RPC session through
   build_http_app()'s real session_manager.handle_request, proving _claims_from_context receives
   genuine claims when populated by the real transport, not a stand-in fixture.
   """

   import json
   from unittest.mock import AsyncMock, patch

   from starlette.testclient import TestClient

   from app import client

   _HEADERS = {
       "Accept": "application/json, text/event-stream",
       "Content-Type": "application/json",
   }


   def _app():
       from app.main import build_http_app  # noqa: PLC0415

       return build_http_app()


   def _sse_json(body: str) -> dict:
       """Streamable HTTP responses are SSE-framed: `event: message\\ndata: {...}\\n\\n`."""
       for line in body.splitlines():
           if line.startswith("data: "):
               return json.loads(line[len("data: ") :])
       raise AssertionError(f"no SSE data line found in: {body!r}")


   def test_set_config_receives_the_real_callers_scope_over_the_real_transport():
       admin_claims = {"user_id": "u-1", "email": "a@b.c", "roles": ["admin"], "aud": "x"}
       with (
           patch("app.auth.validate_bearer_claims", AsyncMock(return_value=admin_claims)),
           patch.object(client, "list_config_keys", AsyncMock(return_value={"keys": []})),
           patch.object(
               client, "set_config", AsyncMock(return_value={"version": 3, "updated_at": "now"})
           ) as mock_set,
           TestClient(_app()) as tc,
       ):
           headers = dict(_HEADERS, Authorization="Bearer good.jwt")

           init = tc.post(
               "/",
               json={
                   "jsonrpc": "2.0",
                   "id": 1,
                   "method": "initialize",
                   "params": {
                       "protocolVersion": "2025-06-18",
                       "capabilities": {},
                       "clientInfo": {"name": "test", "version": "0"},
                   },
               },
               headers=headers,
           )
           assert init.status_code == 200
           headers["mcp-session-id"] = init.headers["mcp-session-id"]

           notif = tc.post(
               "/",
               json={"jsonrpc": "2.0", "method": "notifications/initialized"},
               headers=headers,
           )
           assert notif.status_code == 202

           call = tc.post(
               "/",
               json={
                   "jsonrpc": "2.0",
                   "id": 2,
                   "method": "tools/call",
                   "params": {
                       "name": "set_config",
                       "arguments": {
                           "namespace": "marketdata",
                           "key": "marketdata.fmp.enabled",
                           "value_type": "bool",
                           "value": "true",
                           "author": "a@b.c",
                           "reason": "test",
                       },
                   },
               },
               headers=headers,
           )
           assert call.status_code == 200
           body = _sse_json(call.text)
           assert body["result"]["isError"] is False

       # The proof: set_config called client.set_config with the ADMIN scope derived from the
       # REAL bearer token's claims (roles=["admin"] -> 15), not the hardcoded tuple every other
       # management tool forwards (client._admin_metadata()[-1] == ("x-access-scope", "7")).
       assert mock_set.await_args.kwargs["access_scope"] == 15
   ```

2. Follow the TDD gate's teeth-proof (above) before marking this step done.
3. Do not add a live-socket smoke test — `TestClient` already exercises the real ASGI
   `session_manager.handle_request` path in-process; a bound port adds nothing (same rejection
   reasoning as feature 079's design.md § Rejected Alternatives).

**Verification**:

```bash
cd services/xstockstrat-agent \
  && uv run pytest tests/test_streamable_http_auth.py -v \
  && uv run pytest --cov=app --cov-report=term-missing --cov-fail-under=40 \
  && ruff check . && ruff format --check .
```

Expect: the new test passes, full suite still green at ≥40%, ruff clean.

---

### Step 5 — docs: update the two stale FastMCP references and record the four no-op confirmations

**Status**: `done`
**Service**: `docs/`, `services/xstockstrat-agent/`
**Files**:
- `services/xstockstrat-agent/CLAUDE.md` — modify
- `services/xstockstrat-agent/docs/context-constitution.md` — modify

**Reviewers**: none (per the `docs` row of the reviewer-registry governance matrix)

**Codebase Evidence** — repo-wide grep confirming these are the only two doc surfaces naming
`FastMCP`, run during this session:
```
git ls-files | grep -vE '^(packages/proto/gen/|docs/roadmap/features/)' | xargs grep -niE 'FastMCP|mcp\.server\.fastmcp|mcp>=1\.27'
```
- `services/xstockstrat-agent/CLAUDE.md:26` → `Python 3.12 (asyncio, grpc.aio, FastMCP)`
- `services/xstockstrat-agent/docs/context-constitution.md:4` → `invariants of the MCP agent
  (FastMCP server, Streamable HTTP :9000) — the only backend that speaks HTTP and`
- **Confirmed legitimate survivor, no edit** — `docs/roadmap/ledger/insights.md:104`: "automatic
  (FastMCP registration)..." — the ledger is append-only by convention
  (`docs/roadmap/ledger/CLAUDE.md`), a historical entry from feature 066, out of scope.
- **Confirmed no changes needed** (checked via grep, no hits):
  - `docs/runbooks/mcp-tools.md` — never named `FastMCP`, `mcp.server`, or an SDK version anywhere
    in the file; it documents tool contracts and transport modes, none of which this migration
    changes.
  - Root `CLAUDE.md` — the Service Registry's `xstockstrat-agent` row says only "Python | MCP
    server — AI agent tools...", no `FastMCP` mention.
  - `services/xstockstrat-agent/docs/context-constitution-findings.md` — no `FastMCP`/`mcp.server`
    hits.
  - `docs/patterns/strat-lab-plugin.md` — names `run_backtest`, `manage_strategy`,
    `trigger_backfill`, `get_backfill_status`, `set_strategy_live` by name/behavior; none of their
    names, parameters, or return shapes changed by this migration (Steps 1–4 touch only SDK
    plumbing, never a tool's public contract) — confirmed, no update required.

**TDD**: `N/A (docs — no executable logic)`

**Instructions**:

1. `services/xstockstrat-agent/CLAUDE.md:26` — change `Python 3.12 (asyncio, grpc.aio, FastMCP)` to
   `Python 3.12 (asyncio, grpc.aio, mcp SDK v2 MCPServer)`.
2. `services/xstockstrat-agent/docs/context-constitution.md:4` — change `(FastMCP server,
   Streamable HTTP :9000)` to `(MCPServer, Streamable HTTP :9000)`. Change no other word on the
   line.
3. In the PR body, state explicitly (do not skip silently, per P-03):
   - **FR-6 (OAuth) is a no-op.** Recon found zero repo-wide matches for any SDK client-side OAuth
     provider class (`RFC7523OAuthClientProvider`, `JWTParameters`, `OAuthClientProvider`,
     `scopes=`, `client_secret_post`); confirmed again in this session — `app/oauth_server.py` and
     `app/oauth_metadata.py` import only `os` (no `mcp` import at all). The agent's OAuth 2.1 AS/RS
     facade is 100% hand-rolled and untouched by this migration.
   - **FR-4 (`httpx2`) is a no-op.** The only direct `httpx.AsyncClient` call
     (`app/tools.py:832`, inside `_fetch_url`) is app-level (fetching external signal-source URLs),
     independent of the SDK's own transport. Step 1's live `uv lock` run confirms `httpx>=0.27.0`
     (the app's direct dependency) is untouched; `httpx2` arrives only as `mcp`'s own new
     transitive dependency.
   - **`docs/patterns/strat-lab-plugin.md` needs no update.** No tool's name, parameters, or return
     shape changed.
   - **`docs/runbooks/mcp-tools.md` needs no update.** It never named `FastMCP`, `mcp.server`, or an
     SDK version.
4. Per the root `CLAUDE.md` Teardown rule: this step changes `services/xstockstrat-agent/CLAUDE.md`
   and a `context-constitution.md` file, so run `/context-scrubber scan` scoped to these two files
   before pushing, and fix any grounded findings it reports. If the context-forge plugin is not
   available in the session, say so in the PR body rather than skipping silently.

**Verification**:

```bash
grep -n "MCPServer" services/xstockstrat-agent/CLAUDE.md services/xstockstrat-agent/docs/context-constitution.md
git ls-files | grep -vE '^(packages/proto/gen/|docs/roadmap/features/|docs/roadmap/ledger/)' \
  | xargs grep -niE 'FastMCP|mcp\.server\.fastmcp'
```

Expect: both files now say `MCPServer`; the second command returns **no rows** (the tier-1 hard
zero — every non-ledger, non-SDD-artifact `FastMCP` reference is gone).

---

## Deviation Log

### Step 5 — third stale `FastMCP` reference found, not in the spec's Codebase Evidence

Step 5's Codebase Evidence grep (`git ls-files | grep -vE '^(packages/proto/gen/|docs/roadmap/features/)' | xargs grep -niE 'FastMCP|mcp\.server\.fastmcp|mcp>=1\.27'`) found only two doc surfaces (`services/xstockstrat-agent/CLAUDE.md:26`, `services/xstockstrat-agent/docs/context-constitution.md:4`). Re-running the identical command during execution (after Steps 1-4 landed) surfaced a third: `tests/test_backtest_view.py:3`'s module docstring ("Pure projection tests: no gRPC, no FastMCP server."), predating this migration. Fixed in the same commit as Step 5's two spec'd edits, since it is the same class of stale-vocabulary cleanup the step already covers, not a new decision requiring its own step. No Constitution rule violated; recorded per **P-03** (no silent deviation).

### Branch handling — session-level override of the standard SDD branch model

This session's harness assignment fixed the working branch to `claude/mcp-2-upgrade-e3v1uy` (branched from and PR'd into `main-dev`), overriding the default `/sdd-execute` model of `feature/mcp-python-sdk-v2-upgrade` + per-step `feature-steps/*` sub-branches with individual step PRs. All 5 steps were implemented as separate commits directly on the harness branch instead, each independently verified per its own Verification block before committing (**F-05** honored — no commit before a step's verification passed). One integration PR opens from this branch to `main-dev` covering all 5 steps, rather than 5 step PRs into a feature-integration branch. Recorded here since it departs from `docs/runbooks/feature-workflow.md`'s documented per-step PR workflow, per explicit session-level branch instructions that took precedence.
