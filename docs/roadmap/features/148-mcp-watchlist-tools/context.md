# Context: mcp-watchlist-tools

**Feature**: `docs/roadmap/features/148-mcp-watchlist-tools/feature.md`
**Product Spec**: `docs/roadmap/features/148-mcp-watchlist-tools/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/148-mcp-watchlist-tools/implementation-spec.md`

---

## Session 2026-08-21 — sdd-story

- Created feature.md (status: draft), product-spec.md, acceptance.feature, context.md from user story.
- Story: expose MCP agent tools to manage watchlists (get lists, manage list, get list stocks,
  manage list stocks).
- Recon (pre-story exploration): the backend is **fully in place** — all eight watchlist RPCs exist
  on `PortfolioService` (`packages/proto/portfolio/v1/portfolio.proto` lines 20–29, features
  058/097/127). The agent already reaches portfolio (`PORTFOLIO_ENDPOINT`, `client.py:285/302`
  `ensure_signal_watchlist`/`add_watchlist_symbol` used by `ingest_signal`). So the feature is a
  pure agent-tool-surface addition: **no proto / config / DB / portfolio change**.
- Scope decided as four tools mapping to the user's four verbs: `list_watchlists`, `get_watchlist`,
  `manage_watchlist` (create/update/delete), `manage_watchlist_symbols` (add/remove).
- Authorization: ownership-gated on the caller's `x-user-id` (like `get_strategy`/`manage_strategy`
  feature 133), NOT admin-gated. Portfolio takes ownership from the header; `user_id` never from wire.
- Ledger traps surfaced into the spec's Open Questions:
  - **F-12 / RC-1** — agent docstrings + `mcp-tools.md` + dict→proto builders drift from protos; must
    add a parity guard and update all tool-count / inventory surfaces (tools.py header docstring,
    service CLAUDE.md table, mcp-tools.md x2, `test_tools_endpoint.py` name set).
  - **`UpdateWatchlist` replace-semantics footgun** — design must ground the portfolio handler's
    behavior when symbols/bindings are omitted, to avoid a name-only update wiping the symbol set.

## Session 2026-08-21 — sdd-design

- Phase 0 Recon: wrote recon.md (service: xstockstrat-agent; portfolio dep unchanged). Key reuse
  patterns: get_strategy/manage_strategy ownership-gated shape; get_backfill_status pagination;
  existing ensure_signal_watchlist/add_watchlist_symbol client wrappers.
- Grounded the design-critical fact: `WatchlistRepo.Update` (watchlist_repo.go:170-173) DELETEs all
  symbol rows then re-inserts the request's bindings, and `UpdateWatchlist` requires a non-empty name
  — so a name-only update WIPES the stocks (the F-12 footgun, confirmed at the DB layer).
- Phase 1 Grilling: 1 round (quick). Surfaced the update-contract fork to the user (AskUserQuestion).
  **User approved: read-modify-write merge** — `manage_watchlist update` fetches the current list and
  preserves name/description/bindings, overwriting only supplied fields; symbol changes go through
  `manage_watchlist_symbols`. Rejected: metadata-only update; raw passthrough (footgun); one-tool-per-RPC.
- Decisions: 4 tools (list_watchlists, get_watchlist, manage_watchlist [create/update/delete],
  manage_watchlist_symbols [add/remove]); ownership-gated (x-user-id), never admin; add stamps
  source=MANUAL; no proto/config/DB/portfolio change.
- Constitution rules touched: C-14, C-11/P-04, F-12/RC-1 (designed out). Floor breaches: none.
- Status: draft → design-approved.

### Open Threads
- `manage_watchlist update` read-modify-write is non-atomic (Get then Update) — acceptable for
  single-user agent curation; document in the tool docstring. (target: manage_watchlist impl step)

## Session 2026-08-21 — implementation (direct, on harness branch)

Implemented on the harness-assigned branch `claude/mcp-watchlist-tools-0dz096` (single branch + one
PR to main-dev per the harness flow), consolidating the /sdd-spec + /sdd-execute steps into a direct
implementation of the approved design. No proto/config/DB/portfolio change.

Files changed:
- `services/xstockstrat-agent/app/client.py` — added watchlist gRPC wrappers: `_watchlist_to_dict`,
  `_watchlist_bindings_pb`, `list_watchlists`, `get_watchlist`, `create_watchlist`,
  `update_watchlist` (read-modify-write merge), `delete_watchlist`, `add_watchlist_symbols`,
  `remove_watchlist_symbols`. Reuse `PORTFOLIO_ENDPOINT`; ephemeral channel + lazy gen import.
- `services/xstockstrat-agent/app/tools.py` — added 4 `@server.tool()` tools (`list_watchlists`,
  `get_watchlist`, `manage_watchlist`, `manage_watchlist_symbols`), ownership-gated via
  `_caller_user_id`; updated the module header docstring (24→28).
- `services/xstockstrat-agent/tests/test_watchlist_client.py` (new) — 8 client-layer tests incl. the
  name-only-update-preserves-bindings guard and MANUAL-source stamping.
- `services/xstockstrat-agent/tests/test_watchlist_tools.py` (new) — 15 tool-layer tests: verb
  dispatch, ownership forwarding, error mapping, registration/catalog, doc-parity.
- `services/xstockstrat-agent/tests/test_tools_endpoint.py` — added 4 names to the hard-coded set (28).
- `docs/runbooks/mcp-tools.md` — 4 new `### tool` sections + count 24→28 (×2).
- `services/xstockstrat-agent/CLAUDE.md` — 4 table rows, count 24→28, ownership-gating note.

Verification (pass condition = green + lint + doc-parity, all inventory surfaces synced to 28):
- `uv run pytest --cov=app --cov-fail-under=40` → 266 passed, 78% coverage.
- `uv run ruff check app/ tests/` → All checks passed; `ruff format --check` → clean.
- Registered tool count asserted == 28 across tools.py docstring, CLAUDE.md, mcp-tools.md (×2), and
  the endpoint name-set test.

Note: the context-forge `/context-scrubber` plugin is not available in this session, so the teardown
scan was done manually (tool-count consistency + no stale "twenty-four"); flagged in the PR body.

Status: design-approved → code-completed.
