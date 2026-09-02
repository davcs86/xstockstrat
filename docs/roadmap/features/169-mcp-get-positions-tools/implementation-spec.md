# Implementation Spec: mcp-get-positions-tools

**Status**: `pending`
**Created**: 2026-09-02
**Feature**: `docs/roadmap/features/169-mcp-get-positions-tools/feature.md`
**Total Steps**: 8
**Feature Branch**: `feature/mcp-get-positions-tools`

---

## Execution Summary

The implementation consolidates the existing unpaginated `list_account_positions` client method into
a single paginated `list_positions` method, wires two new user-bound MCP tools (`get_positions` and
`get_positions_by_account_id`) that delegate to it, updates the `manage_offline_account` call-site
to use the consolidated method, then adds tests (unit + parity + name-set) and doc updates. The
order is: client layer first (Steps 1-2), then tool registration (Steps 3-4), then the existing
call-site update (Steps 5-6), then parity + doc (Steps 7-8).

## Scenario Coverage

- AC-1 → Step 4 (get_positions returns all positions for the calling user)
- AC-2 → Step 4 (get_positions_by_account_id returns positions for one account)
- AC-3 → Step 4 (admin caller sees only their own positions)
- AC-4 → Step 4 (non-owned account returns empty list — amended by design.md)
- AC-5 → Step 4 (pagination works across both tools)
- AC-6 → Step 4 (response shape matches existing manage_offline_account list_positions)
- AC-7 → Step 8 (tool count inventory surfaces are consistent)
- AC-8 → Step 7 (descriptor-parity test prevents silent proto drift)
- AC-9 → Step 4 (get_positions_by_account_id requires account_id parameter)
- AC-10 → Step 4 (get_positions returns empty list when user has no positions)

## Step Dependencies

- Step 2 requires Step 1: tests exercise the new `list_positions` client method
- Step 4 requires Step 3: tool tests exercise the new tool registrations which call the client
- Step 6 requires Step 5: tests verify the updated `manage_offline_account` call-site
- Step 7 depends on Steps 1 and 3: parity test validates Position field coverage used by the client/tools
- Step 8 depends on Step 3: doc updates reflect the new tool registrations

---

### Step 1 — service: Consolidate `list_account_positions` into paginated `list_positions` client method

**Status**: `pending`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/app/client.py` — modify

**Reviewers**: Service owner: `xstockstrat-agent` — MCP tool contract stability; tool-count statements kept in sync

**Codebase Evidence**:
- Existing method: `app/client.py:1880-1892` — `list_account_positions(user_id, account_id)` constructs `ListPositionsRequest(account_id=account_id)` with `_metadata(("x-user-id", user_id))`, uses `MessageToDict(p, preserving_proto_field_name=True)`, returns `{"positions": [...]}` with no pagination
- Pagination pattern to reuse: `app/client.py:357-371` — `list_watchlists(user_id, limit=0, page_token="")` uses `common_pb2.PageRequest(page_size=limit, page_token=page_token)` and returns `resp.page.next_page_token`
- Proto: `ListPositionsRequest` at `packages/proto/portfolio/v1/portfolio.proto:166` — fields: `user_id=1` (deprecated), `page=2` (PageRequest), `trading_mode=3`, `account_id=4`, `symbol=5`, `side=6`
- `PageRequest` at `packages/proto/common/v1/common.proto:10-13` — `page_size=1`, `page_token=2`
- PORTFOLIO_ENDPOINT: `app/client.py:25`

**TDD**: red-green required

**Covers**: —

**Instructions**:
1. Rename `list_account_positions` to `list_positions` and change its signature to `list_positions(user_id: str, account_id: str = "", limit: int = 0, page_token: str = "")`.
2. Add `from gen.common.v1 import common_pb2` as a lazy import (matching the `list_watchlists` pattern at `client.py:359`).
3. Construct `ListPositionsRequest` with `account_id=account_id` (empty string omits the field, returning all user accounts per `portfolio_repo.go:157-158`) and `page=common_pb2.PageRequest(page_size=limit, page_token=page_token)`.
4. Return `{"positions": [MessageToDict(p, preserving_proto_field_name=True) for p in resp.positions], "next_page_token": resp.page.next_page_token}`.
5. Keep the existing `_metadata(("x-user-id", user_id))` forwarding unchanged.

**Verification**:
```bash
cd services/xstockstrat-agent && ruff check app/client.py && ruff format --check app/client.py
```

---

### Step 2 — test: Unit tests for consolidated `list_positions` client method + update existing tests

**Status**: `pending`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/tests/test_offline_client.py` — modify

**Reviewers**: Service owner: `xstockstrat-agent` — MCP tool contract stability

**Codebase Evidence**:
- `test_list_account_positions_forwards_user_id_via_header` at `tests/test_offline_client.py:136` — calls `client.list_account_positions("user-42", "off-1")`, asserts `sent.user_id == ""`, `sent.account_id == "off-1"`, metadata contains `("x-user-id", "user-42")`, output is `{"positions": []}`
- `test_list_positions_provenance_passthrough` at `tests/test_offline_client.py:281` — calls `client.list_account_positions("user-42", "off-1")`, asserts provenance fields survive serialization
- `_patch_portfolio_stub` helper at `tests/test_offline_client.py:127-132` — patches `grpc.aio` and `PortfolioServiceStub`
- Conftest builder: `tests/conftest.py:17-27` — `_ctx(claims)` builder

**TDD**: red-green required

**Covers**: AC-5

**Instructions**:
1. In `test_list_account_positions_forwards_user_id_via_header` (line 136): rename the call target from `client.list_account_positions` to `client.list_positions`. Update the assertion to also check that `"next_page_token"` is present in the output (value `""` for an empty response).
2. In `test_list_positions_provenance_passthrough` (line 281): rename the call target from `client.list_account_positions` to `client.list_positions`. Add an assertion that `out["next_page_token"]` exists.
3. Add a new test `test_list_positions_pagination_passthrough`: construct a `ListPositionsResponse` with `page=common_pb2.PageResponse(next_page_token="tok-2")` and a single Position. Call `client.list_positions("user-42", account_id="off-1", limit=10, page_token="tok-1")`. Assert: (a) the sent request's `page.page_size == 10` and `page.page_token == "tok-1"`; (b) the returned dict has `"next_page_token": "tok-2"`.
4. Add a new test `test_list_positions_all_accounts`: call `client.list_positions("user-42")` (no `account_id`). Assert: (a) `sent.account_id == ""`; (b) response is well-formed.
5. C-13 check: the `_patch_portfolio_stub` helper is the only test-infra function for this domain in this file and is already shared — no second consumer of an inline literal is introduced.

**Verification**:
```bash
cd services/xstockstrat-agent && uv run pytest tests/test_offline_client.py -v --tb=short && ruff check tests/test_offline_client.py && ruff format --check tests/test_offline_client.py
```

---

### Step 3 — service: Register `get_positions` and `get_positions_by_account_id` MCP tools

**Status**: `pending`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/app/tools.py` — modify

**Reviewers**: Service owner: `xstockstrat-agent` — MCP tool contract stability (name, parameters, return shape); no secret values in tool output

**Codebase Evidence**:
- Insertion point: after `list_accounts` at `app/tools.py:1682-1694` — the last tool in the portfolio/account group, followed by `_get_source` private helper at line 1697
- User-bound pattern to reuse: `list_watchlists` at `app/tools.py:1381-1395` — `_caller_user_id(ctx, tool_name)`, delegates to `client.*`, wraps in `try/except grpc.aio.AioRpcError`
- `_caller_user_id`: `app/tools.py:119-134`
- `_grpc_error_message`: `app/tools.py:187-198`
- CallerPropagationMiddleware: `app/tools.py:154-184` — auto-binds headers on every outbound gRPC (AGENT-4), no per-tool plumbing needed
- Header propagation: headers are forwarded via `CallerPropagationMiddleware` and `client._metadata()` — the new tools reuse the existing propagation mechanism

**TDD**: red-green required

**Covers**: —

**Instructions**:
1. After `list_accounts` (line 1694), before the `_get_source` private helper (line 1697), add two new `@server.tool()` registrations:

   **`get_positions`**:
   ```python
   @server.tool()
   async def get_positions(ctx: Context, limit: int = 0, page_token: str = "") -> dict:
   ```
   Docstring: document that it returns all positions for the calling user across all accounts (broker + offline), user-bound. Include "Fields with zero/default values may be absent (proto3 serialization convention)." Parameters: `limit` (0 = server default), `page_token` (opaque). Returns `{"positions": [...], "next_page_token": "..."}`. Call `_caller_user_id(ctx, "get_positions")`, then `await client.list_positions(user_id, limit=limit, page_token=page_token)`. Wrap in `try/except grpc.aio.AioRpcError` using `_grpc_error_message(e)`.

   **`get_positions_by_account_id`**:
   ```python
   @server.tool()
   async def get_positions_by_account_id(ctx: Context, account_id: str, limit: int = 0, page_token: str = "") -> dict:
   ```
   Docstring: document that it returns positions for a single account owned by the calling user, user-bound. Include the zero-value caveat. Validate `account_id` is non-empty before calling the client (`raise ValueError("account_id is required")`). Call `_caller_user_id(ctx, "get_positions_by_account_id")`, then `await client.list_positions(user_id, account_id=account_id, limit=limit, page_token=page_token)`. Same error wrapping.

2. Do **not** update the module docstring tool count or tool list yet — that is Step 8 (docs).

**Verification**:
```bash
cd services/xstockstrat-agent && ruff check app/tools.py && ruff format --check app/tools.py
```

---

### Step 4 — test: Unit tests for `get_positions` and `get_positions_by_account_id` tools

**Status**: `pending`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/tests/test_tools.py` — modify

**Reviewers**: Service owner: `xstockstrat-agent` — MCP tool contract stability

**Codebase Evidence**:
- Conftest builder: `tests/conftest.py:17-27` — `_ctx(claims)`, presets: `ADMIN`, `TRADER`, `VIEWER`
- Existing tool-test pattern: `tests/test_tools.py` — imports `_ctx`, `TRADER`, `ADMIN` from conftest, patches `client.*` with `AsyncMock`, calls tool functions directly, asserts return shape and error cases
- `_grpc_error_message` maps `PERMISSION_DENIED` to `"permission denied"` at `app/tools.py:194-195`

**TDD**: red-green required

**Covers**: AC-1, AC-2, AC-3, AC-4, AC-5, AC-6, AC-9, AC-10

**Instructions**:
Add tests to `tests/test_tools.py` (or create `tests/test_position_tools.py` if `test_tools.py` is crowded — C-13 says one consumer inline is fine):

1. **`test_get_positions_returns_all_positions`** (AC-1, AC-10): patch `client.list_positions` to return `{"positions": [{"symbol": "AAPL", "qty": 100, "account_id": "acct-1"}], "next_page_token": ""}`. Call `get_positions(_ctx(TRADER))`. Assert result matches.
2. **`test_get_positions_empty`** (AC-10): patch `client.list_positions` to return `{"positions": [], "next_page_token": ""}`. Call `get_positions(_ctx(TRADER))`. Assert `{"positions": [], "next_page_token": ""}`.
3. **`test_get_positions_by_account_id_returns_filtered`** (AC-2): patch `client.list_positions` to return one AAPL position. Call `get_positions_by_account_id(_ctx(TRADER), account_id="acct-1")`. Assert result.
4. **`test_get_positions_by_account_id_requires_account_id`** (AC-9): call `get_positions_by_account_id(_ctx(TRADER), account_id="")`. Assert `ValueError("account_id is required")`.
5. **`test_get_positions_admin_sees_only_own`** (AC-3): patch `client.list_positions` to return admin's positions only (mock returns whatever the backend returns for that `x-user-id`). Call `get_positions(_ctx(ADMIN))`. Assert `_caller_user_id` extracted the admin's own `user_id` — verify via the patched call's `user_id` arg.
6. **`test_get_positions_by_account_non_owned_returns_empty`** (AC-4): patch `client.list_positions` to return `{"positions": [], "next_page_token": ""}` (backend returns empty for non-owned). Call and assert empty positions.
7. **`test_get_positions_pagination`** (AC-5): patch `client.list_positions` to return `{"positions": [...], "next_page_token": "tok-2"}`. Call `get_positions(_ctx(TRADER), limit=10)`. Assert `next_page_token` is `"tok-2"`.
8. **`test_get_positions_response_shape_matches_manage_offline`** (AC-6): verify both tools return `{"positions": [...], "next_page_token": ...}` with snake_case proto field names by checking keys of a mocked position dict.
9. **`test_get_positions_no_claims_raises`**: call `get_positions(_ctx(None))`. Assert `RuntimeError`.

**Verification**:
```bash
cd services/xstockstrat-agent && uv run pytest tests/test_tools.py -v -k "position" --tb=short && ruff check tests/test_tools.py && ruff format --check tests/test_tools.py
```
If tests are in `test_position_tools.py`:
```bash
cd services/xstockstrat-agent && uv run pytest tests/test_position_tools.py -v --tb=short && ruff check tests/test_position_tools.py && ruff format --check tests/test_position_tools.py
```

---

### Step 5 — service: Update `manage_offline_account` call-site to use consolidated `list_positions`

**Status**: `pending`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/app/tools.py` — modify

**Reviewers**: Service owner: `xstockstrat-agent` — MCP tool contract stability

**Codebase Evidence**:
- `manage_offline_account` `list_positions` sub-op: `app/tools.py:1600-1603` — calls `client.list_account_positions(user_id, account_id)` (the old method name)
- Design decision: the sub-op must strip `next_page_token` from the result to preserve backward compatibility (design.md § Chosen Approach)
- Open Risk from design.md: "Consolidated method changes `manage_offline_account list_positions` return shape — mitigated by stripping `next_page_token` in the sub-op path"

**TDD**: red-green required

**Covers**: —

**Instructions**:
1. At `app/tools.py:1600-1603`, change:
   ```python
   if operation == "list_positions":
       if not account_id:
           raise ValueError("list_positions requires an account_id")
       return await client.list_account_positions(user_id, account_id)
   ```
   to:
   ```python
   if operation == "list_positions":
       if not account_id:
           raise ValueError("list_positions requires an account_id")
       result = await client.list_positions(user_id, account_id=account_id)
       result.pop("next_page_token", None)
       return result
   ```
2. This preserves backward compatibility: the existing sub-op never exposed pagination and callers do not expect `next_page_token`.

**Verification**:
```bash
cd services/xstockstrat-agent && ruff check app/tools.py && ruff format --check app/tools.py
```

---

### Step 6 — test: Verify `manage_offline_account list_positions` backward compatibility

**Status**: `pending`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/tests/test_tools.py` — modify (or `tests/test_position_tools.py`)

**Reviewers**: Service owner: `xstockstrat-agent` — MCP tool contract stability

**Codebase Evidence**:
- Existing `manage_offline_account` test pattern: `tests/test_tools.py` — patches `client.*` methods
- The sub-op at `app/tools.py:1600-1603` is covered by the existing offline-account tests but may not assert the absence of `next_page_token`

**TDD**: red-green required

**Covers**: AC-6

**Instructions**:
1. Add a test `test_manage_offline_account_list_positions_strips_pagination`: patch `client.list_positions` to return `{"positions": [...], "next_page_token": "tok-1"}`. Call `manage_offline_account(_ctx(TRADER), operation="list_positions", account_id="off-1")`. Assert the returned dict has `"positions"` but **does not** have `"next_page_token"`.
2. C-13 check: single consumer of this test fixture shape — inline is compliant.

**Verification**:
```bash
cd services/xstockstrat-agent && uv run pytest tests/test_tools.py -v -k "manage_offline_account_list_positions" --tb=short && ruff check tests/ && ruff format --check tests/
```

---

### Step 7 — test: Descriptor-parity test for Position proto fields

**Status**: `pending`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/tests/test_position_parity.py` — create

**Reviewers**: Service owner: `xstockstrat-agent` — MCP tool contract stability

**Codebase Evidence**:
- Parity test pattern to mirror: `tests/test_backtest_view.py:189-212` — `test_summary_key_set_covers_every_proto_field()` defines a frozen set, asserts `kept | _INTENTIONALLY_DROPPED == set(DESCRIPTOR.fields_by_name)`
- Position message: `packages/proto/portfolio/v1/portfolio.proto:60-106` — 23 fields: `symbol(1), qty(2), avg_entry_price(3), current_price(4), market_value(5), unrealized_pnl(6), unrealized_pnl_pct(7), cost_basis(8), opened_at(9), trading_mode(10), account_id(11), day_pnl(12), day_pnl_pct(13), stop_price(14), risk_at_stop(15), stop_distance_pct(16), factor(17), flag(18), exit_rule(19), stop_order_id(20), take_profit_order_id(21), as_of(22), source(23)`
- `MessageToDict(preserving_proto_field_name=True)` omits zero-value fields; a fully-populated Position should produce all 23 keys

**TDD**: red-green required

**Covers**: AC-8

**Instructions**:
1. Create `tests/test_position_parity.py`.
2. Define `_POSITION_FIELD_SET = frozenset({...})` listing all 23 Position field names from `portfolio.proto:60-106`.
3. **Test A** — `test_position_field_set_matches_proto_descriptor`: import `portfolio_pb2`, assert `_POSITION_FIELD_SET == set(portfolio_pb2.Position.DESCRIPTOR.fields_by_name)`. This catches proto additions/removals.
4. **Test B** — `test_position_messagetodict_produces_all_fields`: construct a `portfolio_pb2.Position` with **all** 23 fields set to non-default values (non-zero numeric, non-empty string, non-zero enum, a valid Timestamp for `opened_at`/`as_of`). Serialize via `MessageToDict(preserving_proto_field_name=True)`. Assert `set(result.keys()) == _POSITION_FIELD_SET`. This catches `MessageToDict` serialization surprises.
5. C-13 check: no second consumer of the position fixture — inline is compliant for this single-use test.

**Verification**:
```bash
cd services/xstockstrat-agent && uv run pytest tests/test_position_parity.py -v --tb=short && ruff check tests/test_position_parity.py && ruff format --check tests/test_position_parity.py
```

---

### Step 8 — docs: Update all tool inventory surfaces (FR-6) and name-set test

**Status**: `pending`
**Service**: `xstockstrat-agent`, `docs/runbooks/`
**Files**:
- `services/xstockstrat-agent/app/tools.py` — modify (module docstring only)
- `services/xstockstrat-agent/CLAUDE.md` — modify
- `docs/runbooks/mcp-tools.md` — modify
- `services/xstockstrat-agent/tests/test_tools_endpoint.py` — modify

**Reviewers**: none (docs category, except the test file which is service owner: `xstockstrat-agent`)

**Codebase Evidence**:
- `app/tools.py:1-38` — module docstring says "Thirty-three tools:" followed by a 33-item enumeration
- `services/xstockstrat-agent/CLAUDE.md` — "The agent registers thirty-three tools" + tool table with 33 rows
- `docs/runbooks/mcp-tools.md:3` — "Complete reference for the thirty-three tools" + `:37` "same thirty-three tools"
- `tests/test_tools_endpoint.py:17-57` — `test_list_tools_returns_all_registered_tools()` asserts exact 33-name set
- `list_accounts` per-tool section in mcp-tools.md at line 1210-1221 — the last tool before "Usage Patterns" (insertion point for new sections)
- Insight (screener-agent-tool): tool count is asserted in 4+ separate docs; all must be grepped when adding a tool

**TDD**: red-green required (for the name-set test update)

**Covers**: AC-7

**Instructions**:
1. **`app/tools.py` docstring** (lines 1-38): change "Thirty-three tools:" to "Thirty-five tools:" and add two entries:
   ```
     get_positions        — lists the caller's positions across all accounts (read-only)
     get_positions_by_account_id — lists the caller's positions for one account (read-only)
   ```
   Insert after `list_accounts` (line 37) to keep the portfolio group contiguous.

2. **`services/xstockstrat-agent/CLAUDE.md`**: change "thirty-three tools" to "thirty-five tools" in the prose. Add two rows to the tool table:
   ```
   | `get_positions` | List the caller's positions across all accounts, broker + offline (read-only, feature 169) |
   | `get_positions_by_account_id` | List the caller's positions for one account (read-only, feature 169) |
   ```

3. **`docs/runbooks/mcp-tools.md`**: change "thirty-three" to "thirty-five" in lines 3 and 37. Before the `## Usage Patterns` section (after `list_accounts` at line 1222), add two per-tool sections following the existing pattern (see `list_accounts` section at lines 1210-1221):

   ```markdown
   ### `get_positions`

   List **all positions** for the calling user across all accounts — broker and offline (read-only,
   feature 169). User-bound: forwards only the caller's `x-user-id`; admins see only their own
   positions.

   | Parameter | Type | Default | Description |
   |---|---|---|---|
   | `limit` | int | `0` | Max positions per page; 0 = server default (100, max 500) |
   | `page_token` | string | `""` | Opaque token from a prior call's `next_page_token` |

   Returns `{"positions": [...], "next_page_token": "<str>"}` — each position uses snake_case proto
   field names. Fields with zero/default values may be absent (proto3 serialization convention). An
   empty `next_page_token` means no more pages.

   **Errors:** `RuntimeError` → no verified caller claims.

   ---

   ### `get_positions_by_account_id`

   List positions for a **single account** owned by the calling user (read-only, feature 169).
   User-bound: forwards only the caller's `x-user-id`. If the caller does not own the account,
   the backend returns an empty list (no data leakage).

   | Parameter | Type | Default | Description |
   |---|---|---|---|
   | `account_id` | string | _(required)_ | The account to query |
   | `limit` | int | `0` | Max positions per page; 0 = server default (100, max 500) |
   | `page_token` | string | `""` | Opaque token from a prior call's `next_page_token` |

   Returns `{"positions": [...], "next_page_token": "<str>"}` — same shape as `get_positions`.

   **Errors:** `ValueError` → `account_id` is empty; `RuntimeError` → no verified caller claims.

   ---
   ```

4. **`tests/test_tools_endpoint.py`** (lines 17-57): add `"get_positions"` and `"get_positions_by_account_id"` to the name set (total becomes 35).

**Verification**:
```bash
cd services/xstockstrat-agent && uv run pytest tests/test_tools_endpoint.py -v --tb=short
# Verify counts are consistent:
grep -c "thirty-five" app/tools.py  # should be 1
grep -c "thirty-five" CLAUDE.md     # should be >= 1
grep -c "thirty-five" ../../docs/runbooks/mcp-tools.md  # should be >= 1
# Lint:
ruff check app/tools.py tests/test_tools_endpoint.py && ruff format --check app/tools.py tests/test_tools_endpoint.py
```

---

## Deviation Log

_Populated by /sdd-execute as implementation proceeds._
