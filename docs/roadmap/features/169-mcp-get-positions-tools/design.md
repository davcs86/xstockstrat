# Design: mcp-get-positions-tools

**Created**: 2026-09-02
**Rounds**: 2 (quick; termination: approved)
**Approved by**: user @ 2026-09-02
**Grounded in**: recon.md

---

## Chosen Approach

**Single consolidated client method + two user-bound MCP tool wrappers + frozen-set parity test.**

### Client layer — consolidate into one paginated method

Replace the existing unpaginated `list_account_positions` (`app/client.py:1880-1892`) with a single
`list_positions(user_id, account_id="", limit=0, page_token="")` that follows the `list_watchlists`
pagination pattern (`app/client.py:357-371`). When `account_id` is empty/omitted, the
`ListPositionsRequest` omits the field — returning all positions for the user across all accounts
(broker + offline), since `account_id` is optional in the proto (`portfolio.proto:171`,
`portfolio_repo.go:157-158`). When provided, it filters to that single account.

Pagination uses the nested `PageRequest` submessage (`common.proto:10-13`) with
`page_size=limit, page_token=page_token`, and returns `resp.page.next_page_token` from
`PageResponse` (`common.proto:15-18`). `limit=0` delegates to server default (100 rows,
max 500 per `portfolio_repo.go:140-141`). `total_count` is never populated
(`portfolio_service.go:550`) and is **not** exposed.

Serialization uses `MessageToDict(preserving_proto_field_name=True)` (`app/client.py:1891`),
consistent with existing behavior. Return shape: `{"positions": [...], "next_page_token": "..."}`.

The `manage_offline_account` call-site (`app/tools.py:1600-1603`) switches to the consolidated
method. To preserve backward compatibility and avoid exposing an unusable pagination token,
the sub-op strips `next_page_token` from the result before returning:
`result.pop("next_page_token", None)`.

### Tool layer — two `@server.tool()` registrations

Register two tools in `app/tools.py` after `list_accounts` (~line 1694), keeping the portfolio
tool group contiguous:

1. **`get_positions(ctx, limit=0, page_token="")`** — all positions across all accounts.
2. **`get_positions_by_account_id(ctx, account_id, limit=0, page_token="")`** — positions for one
   account. Validates `account_id` is non-empty before calling the client.

Both tools:
- Call `_caller_user_id(ctx, tool_name)` (`app/tools.py:119-134`) — user-bound, no admin scope.
- Delegate to `client.list_positions(user_id, ...)`.
- Wrap gRPC errors via `_grpc_error_message(e)` (`app/tools.py:187-198`).
- Return `{"positions": [...], "next_page_token": "..."}`.

Consumer surface (**C-14**): Agent — `xstockstrat-agent` MCP tools `get_positions` and
`get_positions_by_account_id`.

### Non-owned account behavior

The portfolio backend filters `WHERE user_id = $1` (`portfolio_repo.go:148`). When user A passes
user B's `account_id`, the query returns zero rows — an empty list, not `PERMISSION_DENIED`.
This is safe (no data leakage) and consistent with the backend's ownership model. The design
accepts this behavior. **AC-4** and **FR-3** in the product-spec must be amended to say
"returns an empty positions list" instead of "returns a PERMISSION_DENIED error."

### Tests

- **Frozen-set parity test** (`tests/test_position_parity.py`): define
  `_POSITION_FIELD_SET = frozenset({...})` with all 23 Position proto fields
  (`portfolio.proto:60-106`). Two assertions:
  (a) `_POSITION_FIELD_SET == set(Position.DESCRIPTOR.fields_by_name)` — catches proto drift.
  (b) Construct a Position with all fields set to non-default values, serialize via
  `MessageToDict(preserving_proto_field_name=True)`, assert key set == `_POSITION_FIELD_SET` —
  catches serialization surprises. Mirrors `test_backtest_view.py:189-212`.
- **Name-set test** (`tests/test_tools_endpoint.py:17-57`): add `get_positions` and
  `get_positions_by_account_id` to the 33-name set (→ 35).
- **Unit tests** for both tools using conftest `_ctx` builder (`tests/conftest.py:17-27`).
- **Update `tests/test_offline_client.py`**: two existing tests (`test_list_account_positions_forwards_user_id_via_header` at line 136 and `test_list_positions_provenance_passthrough` at line 281) reference the old `list_account_positions` method — rename call target to `list_positions` and update shape assertions to include `next_page_token`.

### Doc updates (FR-6)

- `app/tools.py` module docstring: 33 → 35 tools.
- `services/xstockstrat-agent/CLAUDE.md` tool table: add both tools.
- `docs/runbooks/mcp-tools.md`: header count + per-tool sections.
- Tool docstrings: include "Fields with zero/default values may be absent (proto3 serialization
  convention)."

### Zero-value field omission

`MessageToDict` omits fields at their proto3 default (0.0, "", etc.). A position with
`current_price=0.0` (unenriched) will lack `current_price`, `market_value`, `unrealized_pnl` keys.
This is consistent with existing `manage_offline_account list_positions` behavior (`app/client.py:1891`)
and is documented in tool docstrings. Test fixtures use non-zero financial values. Rejected
alternative: `including_default_value_fields=True` — would break FR-5 consistency.

## Rejected Alternatives

- **Single tool with optional `account_id`** — rejected because two tools are more discoverable for MCP agent consumers that read tool names to understand capabilities, and the product spec explicitly requires two separate tools.
- **Client-side ownership guard** (extra round-trip to `list_accounts` before querying positions) — rejected because it adds latency, creates a TOCTOU gap, and provides no security benefit since the backend's `WHERE user_id = $1` already prevents data leakage. Empty list for non-owned accounts is safe.
- **Keep `list_account_positions` as backward-compat wrapper** around `list_positions` — rejected because this is the exact 056 dual-path trap shape (two methods wrapping the same RPC). Clean consolidation eliminates the divergence risk permanently.
- **`including_default_value_fields=True`** in `MessageToDict` — rejected because it would change the output shape vs. the existing `manage_offline_account list_positions` sub-op, violating FR-5.

## Open Risks

- [ ] Consolidated method changes `manage_offline_account list_positions` return shape — mitigated by stripping `next_page_token` in the sub-op path. Verify no external consumer depends on the exact key set. To be addressed at implementation step (client consolidation).

## Constitution Rules Touched

- `C-08` — honored by: using existing `ListPositions` RPC and `Position` message with no proto changes.
- `C-10(b)` — honored by: consolidating `list_account_positions` into single `list_positions` method, eliminating the 056 dual-path trap.
- `C-14` — honored by: exposing tools on the Agent consumer surface (the product spec's declared surface).
- `C-15` — honored by: amending AC-4 and FR-3 to match actual backend behavior before implementation.
- `C-16` — honored by: preserving all 5 existing business-rule guarantees (see below).
- `F-04` — honored by: grounding all claims in recon.md `path:line` evidence; no invention.
- `P-03` — honored by: documenting zero-value field omission edge in design, tool docstrings, and test fixture constraints.

## Business Rules Touched (C-16)

- PRESERVE `@AC-6` "List all of the caller's accounts, broker and offline together" (`services/xstockstrat-agent/acceptance/agent-broker-account-tools.feature`) — not regressed by: new position tools return data across the same broker+offline account set via the same `ListPositions` RPC.
- PRESERVE `@AC-7` "A caller cannot act on an account they do not own" (`services/xstockstrat-agent/acceptance/agent-broker-account-tools.feature`) — not regressed by: backend enforces ownership via `WHERE user_id = $1`; non-owned accounts return empty list (safe).
- PRESERVE `@AC-1` "list_watchlists returns only the caller's own lists, paginated" (`services/xstockstrat-agent/acceptance/mcp-watchlist-tools.feature`) — not regressed by: new tools follow the same pattern but do not alter watchlist behavior.
- PRESERVE `@AC-11` "list_positions reports provenance so a baseline-seeded position is distinguishable" (`services/xstockstrat-portfolio/acceptance/snapshot-offline-positions.feature`) — not regressed by: `source` field (proto field 23) survives `MessageToDict` serialization.
- PRESERVE `@AC-12` "Provenance is consistent across every portfolio read path" (`services/xstockstrat-portfolio/acceptance/snapshot-offline-positions.feature`) — not regressed by: new tools consume `ListPositions` which already satisfies this; client consolidation ensures a single read path.
