# Defect: agent MCP tools hide every backend gRPC error message (first seen on set_config FAILED_PRECONDITION)

**Recorded**: 2026-11-07
**Severity**: SEV-3
**Impact type**: operator-diagnosis-blocked
**Environment**: staging (observed); reproducible at unit level on main-dev `79435f9`
**Affected service(s)**: xstockstrat-agent
**Config-only fix possible**: no

## Observed

While verifying feature 295 (`fix-config-keys-drift`) on staging, an operator called `set_config` on
a key whose bare-spelling twin survived migration `041_heal_config_keys_to_reader_catalog`.
`xstockstrat-config` `SetConfig` correctly refused the write with gRPC `FAILED_PRECONDITION` and the
message `ambiguous config key spelling: <a> and <b> both exist in namespace <ns> ...; the duplicate
must be healed first (feature 296)`. The MCP caller got only:

```
Error executing tool set_config
```

with `isError=true`. Neither the status code nor the server's message reached the caller, so they
could not tell the write was refused on purpose, or that the fix is to heal the duplicate.

**This is not specific to `set_config`.** Every agent tool that turns a backend gRPC error into an
exception loses the message the same way. The agent's own mapping is correct. The text is dropped one
layer up, in the MCP SDK's tool dispatch.

## Expected

The tool result should be `isError=true` and carry the server's message, ideally with the gRPC code
name, e.g. `FAILED_PRECONDITION: ambiguous config key spelling: ...`. The same applies to the
`NOT_FOUND` ("config key not registered ... pass create_key=true"), `PERMISSION_DENIED`
("admin scope required") and `INVALID_ARGUMENT` refusals, which the `set_config` docstring tells the
caller to expect and act on.

## Reproduction

Unit level, with a stubbed `SetConfig` and no network. Do **not** write to staging config.

1. `cd services/xstockstrat-agent && uv sync --extra dev`
2. Run this script with `uv run python <script>`:

   ```python
   import asyncio, grpc
   from unittest.mock import AsyncMock, patch
   from grpc.aio import AioRpcError, Metadata
   from mcp.server.mcpserver import MCPServer
   import app.tools as tools
   from app import client

   MSG = ("ambiguous config key spelling: opportunities.read_timeout_seconds and "
          "agent.opportunities.read_timeout_seconds both exist in namespace agent "
          "(env=staging, user=global); the duplicate must be healed first (feature 296)")
   err = AioRpcError(grpc.StatusCode.FAILED_PRECONDITION, Metadata(), Metadata(), details=MSG)
   ARGS = {"namespace": "agent", "key": "opportunities.read_timeout_seconds",
           "value_type": "int", "value": "40", "reason": "r"}

   async def main():
       s = MCPServer("t"); tools.register_tools(s)
       with patch.object(client, "set_config", AsyncMock(side_effect=err)), \
            patch.object(tools, "_caller_access_scope", lambda c, t: 7), \
            patch.object(tools, "_caller_user_id", lambda c, t: "u1"):
           try:   # (a) the raw tool function: the agent's own mapping
               await s._tool_manager.get_tool("set_config").fn(ctx=None, **ARGS)
           except Exception as e:
               print("RAW:", type(e).__name__, "|", e)
           try:   # (b) the SDK dispatch path, which is what an MCP client sees
               await s.call_tool("set_config", ARGS)
           except Exception as e:
               print("CALL_TOOL:", type(e).__name__, "|", e)

   asyncio.run(main())
   ```

3. Output on main-dev `79435f9` with `mcp==2.3.0`, the version in `uv.lock`:

   ```
   RAW: RuntimeError | ambiguous config key spelling: opportunities.read_timeout_seconds and ... (feature 296)
   CALL_TOOL: UnexpectedToolError | Error executing tool set_config
   ```

   Over the wire, `_handle_call_tool` turns (b) into `CallToolResult(is_error=True,
   content=[TextContent("Error executing tool set_config")])`.

4. Same result for other tools. With the same harness, `get_backfill_status` (stub raising
   `NOT_FOUND`) returns `Error executing tool get_backfill_status`, and `list_config_keys` (stub
   raising `INVALID_ARGUMENT "bad namespace"`) returns `Error executing tool list_config_keys`. In
   both cases the agent's mapped message (`backfill job not found`, `bad namespace`) is only in
   `__cause__`.

## Evidence

Config side. The refusal is correct and its message says what to do:

`services/xstockstrat-config/src/grpc/configServiceImpl.ts:810-815`
> `code: 9, // FAILED_PRECONDITION`
> ``message: `ambiguous config key spelling: ${ambiguous[0]} and ${ambiguous[1]} both exist in namespace ${namespace} ...; the duplicate must be healed first (feature 296)` ``

Agent side. The mapping keeps the details but raises a plain `RuntimeError`:

`services/xstockstrat-agent/app/tools.py:1892-1900` (`set_config`)
> `except grpc.aio.AioRpcError as e:`
> `raise RuntimeError(_grpc_error_message(e, not_found="config key not found", ...)) from e`

`services/xstockstrat-agent/app/tools.py:254` (`_grpc_error_message`, catch-all branch, which `FAILED_PRECONDITION` reaches)
> `return exc.details() or str(code)`

So the agent maps correctly. Two problems remain: (1) the code name is dropped whenever details are
present, and (2) the exception type is `RuntimeError`.

SDK side. Only `ToolError` text reaches the caller (`mcp` 2.3.0, pinned `mcp>=2.3.0,<3` in
`services/xstockstrat-agent/pyproject.toml`):

`.venv/.../mcp/server/mcpserver/tools/base.py:211-213`
> `except Exception as exc:`
> `# A crash: the exception's own text stays on the server.`
> `raise UnexpectedToolError(f"Error executing tool {self.name}") from exc`

`.venv/.../mcp/server/mcpserver/exceptions.py:44-52` (`ToolError` docstring)
> "Any other exception bar `MCPError` (a protocol error) is treated as a crash: the model sees only
> `Error executing tool <name>`"

Why it is generic. In `app/tools.py` there are 55 `raise RuntimeError(` sites, most of them gRPC
mappings through `_grpc_error_message`, plus 44 `raise ValueError(` input-validation refusals and 2
`raise PermissionError(` sites (the `_require_admin` early gate). `grep -rn ToolError app/` returns
nothing, so **no tool** raises an exception type whose text the SDK forwards. No sibling tool passes
the status through at the MCP boundary today. They all behave like `set_config`.

Why CI is green. The tool tests call the raw function (`_tool_fn(server, name)` →
`server._tool_manager.get_tool(name).fn`, `services/xstockstrat-agent/tests/test_tools.py:32-33`)
and assert `pytest.raises(RuntimeError, match=...)`, e.g. `tests/test_tools.py:1664-1670`. That
skips the SDK wrapper where the text is dropped. Only `tests/test_tools.py:807` and
`tests/test_tool_metrics.py:82,185` go through `server.call_tool`, and none of them check error text.

Dependency history. `mcp` went from 2.0.0 → 2.2.0 (`6fce7fe`, 2026-10-19) → 2.3.0 (`9864ac4`,
2026-10-20), both Dependabot bumps. Masking is confirmed in 2.3.0. This report does not establish
which 2.x release introduced it.

## Root cause hypothesis

The agent signals expected backend refusals with built-in exceptions (`RuntimeError`, `ValueError`,
`PermissionError`). The MCP SDK treats those as crashes and replaces their text with a generic one, so
every mapped gRPC message is logged on the server and never reaches the caller.

Suggested fix direction (not implemented here):

- Raise `mcp.server.mcpserver.exceptions.ToolError` instead of `RuntimeError` at the
  `_grpc_error_message` call sites. Better: centralise this in one helper or decorator so the 55
  sites don't drift.
- Prefix the gRPC code name (e.g. `FAILED_PRECONDITION: <details>`) so callers can branch on it.
- Decide separately whether the `ValueError`/`PermissionError` validation refusals should also become
  `ToolError`. They are anticipated, caller-correctable failures too.
- Add at least one regression test per error class that goes through `server.call_tool` and asserts
  the result text, so a future SDK change can't silently mask messages again.
- Check that nothing sensitive reaches the caller once messages are forwarded. Server details are
  already written for operators, but secret-adjacent paths (`set_config` on `is_secret` keys,
  `manage_account` credentials) need a review before they go unmasked.

Relation to feature 296 (`fix-config-keys-contract`). 296 renames the prefixed keys to
namespace-relative spellings, which removes the ambiguous-twin case that triggered this observation.
The error-masking defect does not depend on it: after 296 lands, `set_config`'s `NOT_FOUND` /
`PERMISSION_DENIED` / `INVALID_ARGUMENT` refusals, and every other tool's backend errors, will still
reach the caller as `Error executing tool <name>`.

## Confidence

high
