# Design: mcp-watchlist-tools

**Phase 1 (quick, 1 round) — user-approved 2026-08-21.**

## Chosen Approach

Add **four MCP tools** to `xstockstrat-agent` (`app/tools.py`) plus their gRPC wrappers
(`app/client.py`), all thin ownership-gated wrappers over the existing `PortfolioService` watchlist
RPCs (recon.md § Codebase Map). Reuse `PORTFOLIO_ENDPOINT` — no new env var, proto, config, or DB.

### Tools

1. **`list_watchlists(ctx, limit=0, page_token="")`** — read-only → `ListWatchlists`. Wrapper builds
   `common_pb2.PageRequest(page_size=limit, page_token=page_token)`, forwards
   `_metadata(("x-user-id", user_id))`, returns `{"watchlists": [MessageToDict(w,
   preserving_proto_field_name=True) …], "next_page_token": resp.page.next_page_token}`. Mirrors
   `get_backfill_status` list mode. (AC-1)

2. **`get_watchlist(ctx, watchlist_id)`** — read-only → `GetWatchlist`. Returns
   `{"watchlist": MessageToDict(resp.watchlist, preserving_proto_field_name=True)}` including
   `bindings` (symbol/strategy_id/source) and the deprecated flat `symbols`. Non-owned →
   `_grpc_error_message(e, not_found="watchlist not found")` surfaces NOT_FOUND/PERMISSION_DENIED.
   (AC-2, AC-3)

3. **`manage_watchlist(ctx, operation, watchlist_id="", name=None, description=None, symbols=None,
   bindings=None)`** — write → `CreateWatchlist`/`UpdateWatchlist`/`DeleteWatchlist`.
   - `operation` ∈ {`create`, `update`, `delete`} — `ValueError` naming the verbs before any RPC.
   - **`create`**: `name` required; optional `description`, `symbols` (bare/unbound), `bindings`
     (`{symbol, strategy_id}`). (AC-4)
   - **`update` = READ-MODIFY-WRITE MERGE (user-approved).** Because `UpdateWatchlist` is replace-all
     and wipes symbols on an empty binding set (recon.md — repo `Update` DELETEs then re-inserts) and
     requires a non-empty name, the tool first calls `GetWatchlist(watchlist_id)`, then sends an
     `UpdateWatchlistRequest` where `name` = supplied ?? current, `description` = supplied ?? current,
     and `bindings` = supplied `symbols`/`bindings` (explicit full replace) **?? the current
     bindings** (preserve). ⇒ a name-only update keeps every stock. (AC-5)
   - **`delete`**: → `DeleteWatchlist`; the backend `FAILED_PRECONDITION` on the system-managed list
     is surfaced as a tool error. (AC-6)
   - Returns the created/updated `watchlist` dict; `delete` returns `{"deleted": true}`.

4. **`manage_watchlist_symbols(ctx, operation, watchlist_id, symbols=None, bindings=None)`** — write →
   `AddWatchlistSymbols`/`RemoveWatchlistSymbols`.
   - `operation` ∈ {`add`, `remove`} — `ValueError` before any RPC. (AC-9)
   - **`add`**: bare `symbols` and/or `{symbol, strategy_id}` `bindings`; the wrapper stamps each
     binding `source = WATCHLIST_ENTRY_SOURCE_MANUAL` (user-curated, distinct from the `ingest_signal`
     SIGNAL path). (AC-7)
   - **`remove`**: by `symbols[]` → `RemoveWatchlistSymbols`. (AC-8)
   - Both return the updated `watchlist` dict.

### Authorization (FR-5)

Every tool is **ownership-gated, not admin-gated**: `user_id = _caller_user_id(ctx, "<tool>")`, and
the client forwards `_metadata(("x-user-id", user_id))`. No `_caller_access_scope`, no `user_id`
request-body field. Portfolio enforces ownership from the header (`loadOwned`). Matches feature 133
(`get_strategy`/`manage_strategy`).

### Anti-drift (FR-6, closes F-12/RC-1)

- Each new dict→proto wrapper maps **every** proto field it uses; a `tests/` guard asserts the four
  new tool names are registered and that `test_tools_endpoint.py`'s name set matches the live
  registry (so a count/name drift fails CI).
- Docstrings document params/returns/errors and are mirrored in `docs/runbooks/mcp-tools.md` (the
  existing doc-parity test pattern).
- **Tool-count / inventory surfaces updated together (24 → 28):** `app/tools.py` header docstring,
  `services/xstockstrat-agent/CLAUDE.md` § MCP Tools table + count sentence, `docs/runbooks/mcp-tools.md`
  (count ×2 + four new `### tool` sections), `tests/test_tools_endpoint.py` name set.

## Rejected Alternatives

- **Metadata-only update** (no symbol replace on `update`): safe but drops the bulk symbol-set-replace
  capability; the user chose the more flexible read-modify-write merge.
- **Raw `UpdateWatchlist` passthrough**: reintroduces the F-12 symbol-wipe footgun — rejected.
- **One tool per RPC (7–8 tools)**: violates the established `manage_<noun>`-verb convention and
  bloats the tool surface; four tools map exactly to the user's four verbs.
- **Exposing `EnsureSignalWatchlist`**: out of scope — internal find-or-create for the signal path,
  not user curation.

## Open Risks (→ context.md Open Threads)

- `manage_watchlist update` read-modify-write is **not atomic** (GetWatchlist then UpdateWatchlist):
  a concurrent symbol add between the two calls could be lost by the resend. Acceptable for an
  agent-curation tool (single-user, low-concurrency); documented in the tool docstring. Target: note
  in impl step for `manage_watchlist`.
- `MessageToDict` int64/timestamp fields: watchlist has `created_at`/`updated_at` Timestamps →
  MessageToDict renders RFC3339 strings; no hand-projection needed (unlike int64 job ids). Verify in test.

## Constitution Rules Touched

- **C-14** (consumer surface): the Agent tools ARE the surface — satisfied by definition.
- **C-11 / P-04** (surface the fork, human gate): the update-contract fork was surfaced and approved.
- **F-12 / RC-1** (Floor-adjacent drift class): explicitly designed out via the guard test +
  doc-parity + all-surface count update. No Floor (`F-*`) breach.
- **AGENT-1/AGENT-2** (ephemeral channel, lazy `gen.*` import): honored by mirroring existing wrappers.
