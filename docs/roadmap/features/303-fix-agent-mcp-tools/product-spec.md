# Product Spec: fix-agent-mcp-tools

**Type**: bug
**Defect Report**: `docs/reports/2026-11-07-agent-mcp-tool-error-details-masked-defect.md`
**Severity**: SEV-3
**Created**: 2026-11-07

---

## Problem Statement

Observed: when a backend refuses a tool call (e.g. `xstockstrat-config` `SetConfig` →
`FAILED_PRECONDITION` "ambiguous config key spelling …"), the MCP caller gets only
`Error executing tool set_config` (`isError=true`). Neither the gRPC code nor the server message
reaches the caller. Not specific to `set_config`: `app/tools.py` has no `ToolError` and 55
`RuntimeError` / 44 `ValueError` / 2 `PermissionError` raise sites, and `mcp` 2.3.0 masks the text
of every non-`ToolError` exception.

Expected: `isError=true` carrying the server message, with the gRPC code name (e.g.
`FAILED_PRECONDITION: ambiguous config key spelling: …`), for `NOT_FOUND`, `PERMISSION_DENIED`,
`INVALID_ARGUMENT` and `FAILED_PRECONDITION` refusals alike.

## Reproduction Steps

Unit level, stubbed `SetConfig` (no staging write): patch `client.set_config` to raise an
`AioRpcError(FAILED_PRECONDITION, details="ambiguous config key spelling: …")`; the raw tool fn raises
`RuntimeError` with the full text, but `server.call_tool("set_config", …)` raises
`UnexpectedToolError("Error executing tool set_config")`. Full script in the defect report.

## Root Cause Hypothesis

Agent signals expected refusals with built-in exceptions; the SDK's `tools/base.py` treats them as
crashes and drops the text. Fix direction: raise `mcp.server.mcpserver.exceptions.ToolError` from one
shared helper at the `_grpc_error_message` sites, prefix the gRPC code name, decide separately on the
`ValueError`/`PermissionError` validation refusals, and review secret-adjacent paths
(`set_config` on `is_secret` keys, `manage_account`) before forwarding details.

## Affected Services

xstockstrat-agent

## Fix Scope

- [x] No proto changes anticipated
- [x] No database migrations anticipated
- [x] No config key changes anticipated

(Feature 296 removes the ambiguous-twin trigger but not this defect.)

## Acceptance Criteria

See `acceptance.feature` — the regression scenario(s) that must fail on the buggy behavior and pass
after the fix (Constitution **C-15**). Plus: existing tests pass; affected service(s) smoke-tested on
dev.

## Out of Scope

- Refactoring unrelated to the bug
- Performance improvements unrelated to the fix
