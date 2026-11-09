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
shared helper at the `_grpc_error_message` sites, and prefix the gRPC code name. Operator decisions
(2026-11-07): the `ValueError`/`PermissionError` validation refusals also become `ToolError`; no
separate review of secret-adjacent paths (`set_config` on `is_secret` keys, `manage_account`) is
required before forwarding details.

## Affected Services

xstockstrat-agent

## Fix Scope

- [x] No proto changes anticipated
- [x] No database migrations anticipated
- [x] No config key changes anticipated

(Feature 296 removes the ambiguous-twin trigger but not this defect.)

## Functional Requirements

FR-1. **Refusals are `ToolError`.** Every anticipated refusal an agent MCP tool raises in
`app/tools.py` — backend gRPC errors, input validation, the admin gate, missing caller claims — is
raised as `mcp.server.mcpserver.exceptions.ToolError`, so the MCP caller receives its text
(`Error executing tool <name>: <text>`, `isError=true`) instead of the SDK's masked
`Error executing tool <name>`. Exempt: exactly four internal control-flow raises that never leave
their function (`_extract_from_bytes` 2× `ValueError`, caught at its own `except`; `_fetch_url` 2×
`EgressBlocked`, caught and re-raised as a refusal). Enforced by an AST guard over `app/tools.py`
(FR-1 regression test).

FR-2. **gRPC code + safe message.** `_grpc_error_message` prefixes every result with the gRPC code
name (`CODE: body`). Details pass through for FAILED_PRECONDITION, PERMISSION_DENIED,
INVALID_ARGUMENT, ALREADY_EXISTS, OUT_OF_RANGE, UNAUTHENTICATED, RESOURCE_EXHAUSTED, ABORTED and
DEADLINE_EXCEEDED (server detail; the client sentinel keeps feature 273's wording). NOT_FOUND keeps
the site's literal and appends server details, deduplicated. UNAVAILABLE passes through only the two
exact backend strings a call site allow-lists ("fundamentals availability unknown — grade
unchanged", "positions not published; re-confirm to retry"); every other UNAVAILABLE/CANCELLED and
every other code collapses to a fixed hint ("upstream unavailable; retry shortly", "upstream error,
details withheld; report it", with "outcome unknown, verify before retrying" on writes), and the
withheld details are logged at WARNING on the agent.

FR-3. **Whole surface.** FR-1/FR-2 hold at the MCP dispatch boundary for every tool the server lists
(`list_tools()`), verified by one sweep whose probe set must equal the listed set (never a literal
count).

FR-4. **Client argument errors.** An argument refusal raised in `app/client.py` before any RPC is a
`ClientArgumentError(ToolError, ValueError)` and reaches the caller verbatim; a `set_config` value
that fails its int/float conversion — including the protobuf int64-overflow assignment — is refused
as "value is not a valid <type>" without echoing the value; `_iso_to_timestamp` refuses unparseable
input the same way. Declared out of scope (still masked crashes): implicit `float()`/`int()` casts of
caller input at `client.py:169`, `:171`, `:725`, `:734`, `:757`, `:1219`, `:2498-2499`, and `httpx`
errors from `_fetch_url`'s `raise_for_status()` (`tools.py:2703`).

## Acceptance Criteria

See `acceptance.feature` — the regression scenario(s) that must fail on the buggy behavior and pass
after the fix (Constitution **C-15**). Plus: existing tests pass; affected service(s) smoke-tested on
dev.

## Out of Scope

- Refactoring unrelated to the bug
- Performance improvements unrelated to the fix
