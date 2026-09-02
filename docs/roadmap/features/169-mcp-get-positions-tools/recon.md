# Recon: mcp-get-positions-tools

**Created**: 2026-09-02
**From**: product-spec.md
**Affected services**: xstockstrat-agent, xstockstrat-portfolio

---

## Objective

Add two standalone MCP tools — `get_positions` (all positions for the calling user across all
accounts) and `get_positions_by_account_id` (positions for a single owned account) — to
`xstockstrat-agent`. Both are user-bound (forward `x-user-id` only, never admin scope), backed
by the existing `PortfolioService.ListPositions` RPC. No proto, config, or DB changes required.

## Codebase Map

### `xstockstrat-agent` (Python) — new tools + client wrapper + tests + doc updates

- Entry point: `app/main.py:69-70` — `MCPServer("xstockstrat-agent")` + `register_tools(server)`
- Tool registration: `app/tools.py` — 33 `@server.tool()` decorators; docstring at `tools.py:2` says "Thirty-three tools"
- User-bound helper: `app/tools.py:119-134` — `_caller_user_id(ctx, tool)` extracts from verified claims
- CallerPropagationMiddleware: `app/tools.py:154-184` — auto-binds `x-user-id`/`x-access-scope`/`x-trace-id` on every outbound gRPC
- gRPC error mapper: `app/tools.py:187-198` — `_grpc_error_message()` maps codes to caller-facing messages
- Existing position client: `app/client.py:1880-1892` — `list_account_positions(user_id, account_id)` calls `ListPositions` but **no pagination** (no `page` param, discards `resp.page`)
- Portfolio stub: `app/client.py:1884-1885` — ephemeral `grpc.aio.insecure_channel(PORTFOLIO_ENDPOINT)`
- PORTFOLIO_ENDPOINT: `app/client.py:25` — `os.environ.get("PORTFOLIO_ENDPOINT", "xstockstrat-portfolio:50052")`
- `_metadata()` helper: `app/client.py:59-87` — reads `_CALLER` contextvar, emits headers
- Watchlist pagination pattern (reference): `app/client.py:357-371` — uses `common_pb2.PageRequest(page_size=limit, page_token=page_token)`, returns `{"next_page_token": resp.page.next_page_token}`
- manage_offline_account list_positions sub-op: `app/tools.py:1600-1603` — calls `client.list_account_positions(user_id, account_id)`
- Test conftest: `tests/conftest.py:17-27` — `_ctx(claims)` fake MCP Context builder, presets: `ADMIN`, `TRADER`, `VIEWER`
- Parity test pattern: `tests/test_backtest_view.py:189-212` — `test_summary_key_set_covers_every_proto_field()` asserts `kept | _INTENTIONALLY_DROPPED == proto.DESCRIPTOR.fields_by_name`
- Name-set test: `tests/test_tools_endpoint.py:17-57` — asserts exact 33-name set
- No migrations (Python MCP server, no DB)
- Config keys consumed: `agent.oauth.registration_enabled`, `agent.oauth.allowed_redirect_uris`, `agent.signal.alert_threshold`
- Docker env: `docker-compose.yml:520-556` — `PORTFOLIO_ENDPOINT: xstockstrat-portfolio:50052` already present

### `xstockstrat-portfolio` (Go) — no code changes; existing RPC consumer only

- Entry point: `cmd/server/main.go:57` — `service.NewPortfolioService(cfg, cfgWatcher)`; gRPC port 50052
- `ListPositions` handler: `internal/handler/portfolio_handler.go:265-271` — gRPC adapter wraps connect handler
- Handler ownership gate: `portfolio_handler.go:82-84` — `callerUserID(ctx)` reads from middleware; rejects empty `user_id`
- Middleware extracts `x-user-id`: `internal/middleware/propagation.go:28-30`
- Service method: `internal/service/portfolio_service.go:530+` — reads `userID` from context, delegates to repo
- Repository: `internal/repository/portfolio_repo.go:139+` — `ListPositions`, always filters `WHERE user_id = $1` (`portfolio_repo.go:148`)
- **`account_id` is optional**: `portfolio_repo.go:157-158` — `if accountID != "" { add filter }`, omit → all user accounts
- Keyset pagination: `portfolio_repo.go:170` — cursor = symbol alphabetical, `portfolio_repo.go:207` `nextToken = positions[pageSize].Symbol`; default 100, max 500 (`portfolio_repo.go:140-141`)
- `enrichPositions`: `portfolio_service.go:358-376` — skips positions with `CurrentPrice > 0` (broker-valued); backfills unvalued from marketdata mid-quotes (`enrichPosition` at `portfolio_service.go:463-471`)
- `positionColumns`: `portfolio_repo.go:314` — includes `current_price`, `market_value`, `unrealized_pnl`
- **`total_count` never populated**: `PageResponse` only sets `NextPageToken` (`portfolio_service.go:550`)
- Last migration: `014_positions_fees_accum.up.sql`

### Proto contract (no changes)

- `ListPositionsRequest`: `packages/proto/portfolio/v1/portfolio.proto:166` — fields: `user_id=1` (deprecated), `page=2` (PageRequest), `trading_mode=3`, `account_id=4` (optional), `symbol=5`, `side=6`
- `ListPositionsResponse`: `portfolio.proto:176` — `positions=1` (repeated Position), `page=2` (PageResponse)
- `Position` message: `portfolio.proto:60-106` — 23 fields: symbol(1), qty(2), avg_entry_price(3), current_price(4), market_value(5), unrealized_pnl(6), unrealized_pnl_pct(7), cost_basis(8), opened_at(9), trading_mode(10), account_id(11), day_pnl(12), day_pnl_pct(13), stop_price(14), risk_at_stop(15), stop_distance_pct(16), factor(17), flag(18), exit_rule(19), stop_order_id(20), take_profit_order_id(21), as_of(22), source(23)
- `PageRequest`: `common/v1/common.proto:10-13` — `page_size=1`, `page_token=2`
- `PageResponse`: `common/v1/common.proto:15-18` — `next_page_token=1`, `total_count=2`

## Patterns to REUSE

- **User-bound tool pattern** → reuse `list_watchlists` at `app/tools.py:1381-1395` — calls `_caller_user_id(ctx, tool)`, delegates to client, returns dict
- **User-bound tool with no admin scope** → reuse `list_accounts` at `app/tools.py:1682-1694` — same `_caller_user_id` pattern, no `_access_scope` check
- **Client pagination pattern** → reuse `list_watchlists` client at `app/client.py:357-371` — `PageRequest(page_size=, page_token=)`, return `resp.page.next_page_token`
- **Existing `list_account_positions`** → adapt `app/client.py:1880-1892` — keep `MessageToDict(preserving_proto_field_name=True)` serialization, add `page` param + return `next_page_token`
- **Descriptor-parity test** → mirror `tests/test_backtest_view.py:189-212` — `test_summary_key_set_covers_every_proto_field()` pattern for Position fields
- **Name-set test** → extend `tests/test_tools_endpoint.py:17-57` — add 2 new tool names
- **CallerPropagationMiddleware** → already wired at `app/tools.py:217` — no per-tool plumbing needed (AGENT-4)
- **`_grpc_error_message`** → reuse `app/tools.py:187-198` for PERMISSION_DENIED from portfolio

## Existing Business Rules (preserve / extend)

- **PRESERVE** `@AC-6 @feature-164` "List all of the caller's accounts, broker and offline together" (`services/xstockstrat-agent/acceptance/agent-broker-account-tools.feature`) — position tools return data across the same broker+offline account set
- **PRESERVE** `@AC-7 @feature-164` "A caller cannot act on an account they do not own" (`agent-broker-account-tools.feature`) — `get_positions_by_account_id` relies on the same ownership enforcement via `x-user-id`
- **PRESERVE** `@AC-1 @feature-148` "list_watchlists returns only the caller's own lists, paginated" (`mcp-watchlist-tools.feature`) — same user-bound + pagination pattern reused; new tools must not alter existing watchlist behavior
- **PRESERVE** `@AC-11 @feature-163` "list_positions reports provenance so a baseline-seeded position is distinguishable" (`services/xstockstrat-portfolio/acceptance/snapshot-offline-positions.feature`) — the `source` field must survive serialization
- **PRESERVE** `@AC-12 @feature-163` "Provenance is consistent across every portfolio read path" (`snapshot-offline-positions.feature`) — new tools consume `ListPositions` which already satisfies this; they must not discard provenance
- No existing acceptance suite for `xstockstrat-agent` covers MCP position tools (new surface)

## Dependencies

- Proto/RPC: `PortfolioService.ListPositions` (existing, `portfolio.proto:13`) — no changes | `Position` message (23 fields, `portfolio.proto:60-106`) — no changes
- Migration: none
- Config keys: none new
- Inter-service edges: `xstockstrat-agent` → `xstockstrat-portfolio` (gRPC 50052) — already wired (`PORTFOLIO_ENDPOINT` in docker-compose)
- New env vars / ports: none

## Risks / Not-found

- **`total_count` never populated** — `ListPositionsResponse.page.total_count` is always 0 (portfolio never sets it). The new tools should NOT expose `total_count` to avoid confusing callers. Document this in design.
- **`MessageToDict` omits zero-value fields** — a position with `current_price=0.0` will lack `current_price`/`market_value`/`unrealized_pnl` keys in the dict. This matches existing `manage_offline_account list_positions` behavior (FR-5) but is a known edge case.
- **Ledger trap (056-open-positions-ui, C-10(b))** — `ListPositions` was historically inconsistent with `buildAccountPortfolio`. Confirmed RESOLVED: the post-056 fix ensures `enrichPositions` preserves broker values and only backfills unvalued positions. The new tools use `ListPositions` exclusively.
- **Ledger trap (mcp-tools-alignment-triage)** — hand-maintained tool docs drift silently. Mitigated by FR-7's descriptor-parity test and FR-6's explicit inventory-surface update requirement.
- **Existing `list_account_positions` lacks pagination** — must extend (or add a new wrapper) to support `page_size`/`page_token`. Design decision: extend in place vs. add a new method.

## Recommended Scope

1. **Client layer** — extend or add new client method(s) for `ListPositions` with pagination support (adapt `list_account_positions`, add `PageRequest`/`PageResponse` passthrough following `list_watchlists` client pattern)
2. **Tool registration** — add `get_positions` and `get_positions_by_account_id` tools in `app/tools.py` using `_caller_user_id` + `_grpc_error_message` pattern
3. **Tests** — unit tests for both tools (conftest `_ctx` builder), descriptor-parity test mirroring `test_backtest_view.py`, name-set test update
4. **Doc updates** — `tools.py` docstring (33→35), agent `CLAUDE.md` tool table, `docs/runbooks/mcp-tools.md` header + per-tool sections
