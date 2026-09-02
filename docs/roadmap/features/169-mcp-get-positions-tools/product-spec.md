# Product Spec: mcp-get-positions-tools

**Created**: 2026-09-02

---

## Problem Statement

Position data is currently accessible through the MCP only as a sub-operation of `manage_offline_account` (`list_positions`), which is scoped exclusively to offline accounts. There is no standalone tool for querying positions across all account types (broker + offline), and no tool for retrieving all positions for the calling user across all their accounts at once. This forces agent consumers to know which accounts are offline vs. broker just to read their own holdings.

## User Story

As an MCP agent user, I want to query my positions — all at once or filtered by account — so that I can see my holdings without knowing account internals.

## Functional Requirements

FR-1. A new `get_positions` tool returns all positions for the calling user across all their accounts (broker and offline), delegating to `PortfolioService.ListPositions` with only the caller's `x-user-id`.

FR-2. A new `get_positions_by_account_id` tool returns positions for a single account owned by the calling user, accepting an `account_id` parameter. Delegates to `PortfolioService.ListPositions` with the caller's `x-user-id` and the provided `account_id`.

FR-3. Both tools are **user-bound for everyone** — they forward only `x-user-id` (via `_caller_user_id`), never an admin `x-access-scope`. The portfolio backend enforces ownership on the propagated `x-user-id`, rejecting non-owners with `PERMISSION_DENIED`. Admins see only their own positions, identical to any other caller.

FR-4. Both tools support pagination via the existing `ListPositionsRequest.page_token` / `page_size` fields.

FR-5. Both tools return a response shape consistent with the existing `manage_offline_account list_positions` sub-operation: `{"positions": [...]}` with each position serialized via `MessageToDict(preserving_proto_field_name=True)`.

FR-6. All six MCP tool inventory surfaces are updated to reflect the new tool count: `app/tools.py` module docstring, `services/xstockstrat-agent/CLAUDE.md` tool table, `docs/runbooks/mcp-tools.md` header count + per-tool sections, and the auto-generated `GET /api/tools` catalog (no manual update needed for this last one).

FR-7. A descriptor-parity test (mirroring `test_backtest_view.py`'s pattern) is added for the new tools' response shapes to prevent silent drift from the proto (per ledger 2026-08-02 mcp-tools-alignment-triage).

## Out of Scope

- Modifying positions (create/update/delete) — these tools are read-only.
- Any new proto RPCs or message types — `GetPosition` and `ListPositions` already exist on `PortfolioService`.
- Cross-account aggregation (e.g., summing qty across accounts for the same symbol) — that is a UI/analysis concern, not a raw data tool.
- The `GetPosition` (single-position-by-ID) RPC — the user asked for `get_positions` (list) and `get_positions_by_account_id` (list filtered by account), both backed by `ListPositions`.

## Affected Services

Exact service names from CLAUDE.md Service Registry:
- `xstockstrat-agent` — new MCP tools registered in `app/tools.py`, client methods may need a new wrapper or reuse `list_account_positions`, doc updates
- `xstockstrat-portfolio` — no code changes; provides the existing `ListPositions` RPC that the agent already calls

## Consumer Surface(s)

_Constitution **C-14**._ The end-user-reachable surface(s) this capability is consumed through.

- [x] **Agent** — `xstockstrat-agent` MCP tool(s): `get_positions` (new tool), `get_positions_by_account_id` (new tool)
- [ ] **UI** — no UI changes
- [ ] **None**

## Proto Contract Changes

- [x] No proto changes required

`PortfolioService.ListPositions` and its request/response messages already exist. The agent will use the existing `ListPositionsRequest` fields (`user_id` deprecated in favor of `x-user-id` header, `account_id`, `page_token`, `page_size`, `side`).

## Config Key Changes

- [x] No new config keys

## Database Changes

- [x] No schema changes

## Feature Workflow Notes

Branch to create: `feature/mcp-get-positions-tools` (branch from `main-dev`)
Approval gates required (per docs/runbooks/feature-workflow.md):
- [x] 1 service owner approval (non-breaking proto or config change)
- [ ] 2 service owners + platform lead (breaking proto change)
- [ ] DBA review + service owner (schema migration)

## Acceptance Criteria

See `acceptance.feature` (scenarios `@AC-*`) — the single source of acceptance truth (Constitution
**C-15**). Each `FR-N` above is covered by ≥1 tagged scenario there.

## Open Questions

- [ ] **Known trap (ledger 2026-07-01, 056-open-positions-ui):** `ListPositions` and `buildAccountPortfolio` historically disagreed on mark-to-market enrichment. Confirm which path the new tools use and that the returned position data includes the broker-authoritative valuation fields (`market_value`, `unrealized_pnl`, `current_price`) from the post-056 fix — do not reintroduce the stale mid-quote computation path.
- [ ] **Pagination token format:** `ListPositionsRequest.page_token` is token-based (opaque numeric offset per the insights ledger). Confirm the agent tools pass through `page_token` / `page_size` and return `next_page_token` in the response so callers can paginate.
