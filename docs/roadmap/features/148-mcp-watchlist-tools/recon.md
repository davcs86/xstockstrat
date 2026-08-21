# Recon: mcp-watchlist-tools

**Phase 0 dossier — grounded codebase facts. Written 2026-08-21.**

Affected service: **`xstockstrat-agent`** (the only service changed). `xstockstrat-portfolio` is a
read-only dependency (its RPCs are called, unchanged).

---

## Codebase Map

### Backend RPCs to wrap (all already exist — `xstockstrat-portfolio`, gRPC :50052)

`packages/proto/portfolio/v1/portfolio.proto` — `PortfolioService` (features 058/097/127):

| RPC | Request → Response | line |
|---|---|---|
| `ListWatchlists` | `ListWatchlistsRequest{page}` → `{watchlists[], page}` | proto:229–235 |
| `GetWatchlist` | `GetWatchlistRequest{watchlist_id}` → `{watchlist}` | proto:222–227 |
| `CreateWatchlist` | `CreateWatchlistRequest{name, description, symbols[], bindings[]}` → `{watchlist}` | proto:211–220 |
| `UpdateWatchlist` | `UpdateWatchlistRequest{watchlist_id, name, description, symbols[], bindings[]}` → `{watchlist}` | proto:238–248 |
| `DeleteWatchlist` | `DeleteWatchlistRequest{watchlist_id}` → `{}` | proto:250–253 |
| `AddWatchlistSymbols` | `AddWatchlistSymbolsRequest{watchlist_id, symbols[], bindings[]}` → `{watchlist}` | proto:255–263 |
| `RemoveWatchlistSymbols` | `RemoveWatchlistSymbolsRequest{watchlist_id, symbols[]}` → `{watchlist}` | proto:265–271 |

Messages: `Watchlist{watchlist_id, user_id, name, description, symbols[](deprecated), created_at,
updated_at, bindings[], system_managed}` (proto:193–207); `WatchlistBinding{symbol, strategy_id,
source}` (proto:184–190); `WatchlistEntrySource{UNSPECIFIED=0(→MANUAL), MANUAL=1, SIGNAL=2}`
(proto:177–181). **`user_id` is intentionally absent from every request body** — ownership is taken
from the propagated `x-user-id` header server-side (proto:209–210).

### Backend behavior grounded (the design-critical facts)

- **Ownership**: `PortfolioService.loadOwned` (`internal/service/portfolio_service.go:1240`) returns
  `NotFound` if the list doesn't exist, `PermissionDenied` if owned by another user; `requireUserID`
  (:1230) reads `middleware.FromContext(ctx).UserID` (the `x-user-id` header) and errors
  `InvalidArgument` if absent.
- **`UpdateWatchlist` is REPLACE-ALL, and it WIPES symbols when bindings are empty.**
  `UpdateWatchlist` (:1340) requires a non-empty `name` (`INVALID_ARGUMENT "name required"`, :1348),
  then `requestBindings(bindings, symbols)` (:1201 — bindings win over symbols; empty → empty set),
  then `watchlists.Update(...)`. `WatchlistRepo.Update`
  (`internal/repository/watchlist_repo.go:154`) unconditionally
  `DELETE FROM portfolio.watchlist_symbols WHERE watchlist_id=$1` (:170) then re-inserts the passed
  bindings (:173). **⇒ a name-only UpdateWatchlist with empty bindings deletes every symbol.** This
  is the F-12/RC-1 footgun, confirmed at the DB layer.
- **`DeleteWatchlist`** (:1367) refuses a `system_managed` list with `FAILED_PRECONDITION`
  ("cannot delete a system-managed watchlist", :1379).
- **`AddWatchlistSymbols`** (:1391) unions with existing (`ON CONFLICT DO NOTHING`, first-writer-wins
  on source), enforces `portfolio.watchlist.max_symbols_per_list` cap (INVALID_ARGUMENT). Unset
  binding `source` is stored as `0` and read back as MANUAL.
- Caps: `portfolio.watchlist.max_per_user` (50), `portfolio.watchlist.max_symbols_per_list` (500) —
  enforced server-side, surfaced as `INVALID_ARGUMENT`.

### Agent surface to extend (`xstockstrat-agent`, Python)

- **All 24 tools live in one file**: `app/tools.py`, nested `@server.tool()` fns inside
  `register_tools(server: MCPServer)`. gRPC bodies live in `app/client.py` as module-level `async def`s.
- **Portfolio already wired**: `PORTFOLIO_ENDPOINT` (`app/client.py:25`); existing wrappers
  `ensure_signal_watchlist` (:285), `add_watchlist_symbol` (:302) already import
  `gen.portfolio.v1 portfolio_pb2, portfolio_pb2_grpc` and forward `x-user-id`. **No new env var.**
- **Ownership-gated tool model to mirror**: `get_strategy` (tools.py:1054), `list_strategies`
  (:1040), `manage_strategy` (:568) — each derives `user_id = _caller_user_id(ctx, "<tool>")` and the
  client wrapper forwards `metadata=_metadata(("x-user-id", user_id))`. **NOT** admin-gated (no
  `_caller_access_scope`).
- **Pagination model**: `get_backfill_status` list mode (tools.py ~965, client.py ~1157) — tool
  params `limit: int = 0`, `page_token: str = ""`; client builds `common_pb2.PageRequest(page_size,
  page_token)`, returns `{..., "next_page_token": resp.page.next_page_token}`.
- **Error mapping**: every tool wraps `client.*` in `try/except grpc.aio.AioRpcError` and
  `raise RuntimeError(_grpc_error_message(e, not_found=...)) from e` (`_grpc_error_message` tools.py:178).
- **Response mapping**: `google.protobuf.json_format.MessageToDict(resp, preserving_proto_field_name=True)`
  for snake_case round-trip-friendly reads.

### Tests

- Harness (`tests/conftest.py`): `_make_server()`→`register_tools`; `_tool_fn(server, name)` pulls the
  raw fn; `_ctx(claims)` fake Context with `ADMIN`/`TRADER`/`VIEWER` claim dicts; autouse `set_env`
  patches endpoint env + `client.*_ENDPOINT`; `_setup_gen_path()` registers `packages/proto/gen/python`.
- Pattern: `patch.object(client, "<wrapper>", AsyncMock(...))`, `await _tool_fn(...)(ctx=_ctx(ADMIN),
  ...)`, assert on `m.call_args.kwargs`. Closest model: `tests/test_ingest_signal_watchlist.py`
  (patches the two portfolio wrappers) and `TestManageStrategyTool` in `tests/test_tools.py`.
- **`tests/test_tools_endpoint.py:17-48`** holds a HARD-CODED set of every tool name (counts to 24) —
  adding tools REQUIRES updating it. It also has a doc-parity test
  (`test_ingest_signal_watchlist.py::test_doc_parity_docstring_and_runbook`).
- Coverage gate: `pytest --cov=app --cov-fail-under=40`.

---

## Patterns to REUSE (anti-duplication core)

1. **Ownership-gated read/manage tool shape** — copy `get_strategy`/`manage_strategy` verbatim:
   `_caller_user_id(ctx, "<tool>")` → `client.<wrapper>(user_id=..., ...)` → `_metadata(("x-user-id",
   user_id))`. Do **not** invent new auth plumbing.
2. **`manage_<noun>` verb tool** — single tool + `operation` string, `op_map` dict→enum in the client,
   `ValueError` on unknown verb before any RPC (mirror `manage_strategy`/`manage_signal_source`).
3. **Pagination** — reuse `common_pb2.PageRequest`/`page.next_page_token` exactly as
   `get_backfill_status`.
4. **Ephemeral per-call channel + lazy `gen.*` import** (invariants AGENT-1/AGENT-2) — one
   `async with grpc.aio.insecure_channel(PORTFOLIO_ENDPOINT)` per wrapper.
5. **Existing portfolio wrappers** `ensure_signal_watchlist`/`add_watchlist_symbol` are the direct
   template for the new `client.py` wrappers (same import, same metadata).

## Existing Business Rules (C-16 — PRESERVE)

- **PRESERVE** ownership: watchlist ownership is header-derived server-side; no tool may pass a
  `user_id` argument into a request body (proto:209–210, service:1230/1240).
- **PRESERVE** system-managed delete protection (`FAILED_PRECONDITION`) and per-user / per-list caps.
- **PRESERVE** the `ingest_signal` `direction='watchlist'` side-effect path (SIGNAL-sourced add) —
  untouched by these new user-curation tools (which use MANUAL source).

## Relevant Ledger Entries

- **F-12 / RC-1** (`fails.md`): agent docstrings + `mcp-tools.md` + hand-written dict→proto builders
  drift from protos; the one non-drifting tool (`run_backtest`) is descriptor-parity-tested. ⇒ the
  new builders must map every field they use, and a guard test + doc-parity + all inventory-surface
  count updates are in scope.
- **agent tool-count sync** (`reviewer-registry.md:24`): tool-count kept in sync across every
  inventory surface — tools.py header docstring, service CLAUDE.md table, `mcp-tools.md` (×2),
  `test_tools_endpoint.py` name set.
- **watchlist F-04-adjacent** (`fails.md` 058/060): a new *UI page* was unreachable without nav
  registration — N/A here (no UI), noted only to confirm this feature adds **no** UI surface.

## Not found

- No existing watchlist MCP tool, `list_watchlists`/`get_watchlist`/`manage_watchlist` symbol in
  `app/tools.py` (grep: only the internal `ensure_signal_watchlist`/`add_watchlist_symbol` client
  helpers exist).
- No `source` argument on any existing agent tool — the MANUAL default is a new (small) decision.

## Recommended Scope

Four new tools in `app/tools.py` + four/five new wrappers in `app/client.py`, reusing
`PORTFOLIO_ENDPOINT`. No proto/config/DB/portfolio change. The one genuine design fork is the
`manage_watchlist update` contract (read-modify-write vs. metadata-only) — resolved in `design.md`.
