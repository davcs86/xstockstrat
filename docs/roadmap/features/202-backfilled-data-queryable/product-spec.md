# Product Spec: backfilled-data-queryable

**Created**: 2026-09-24

---

## Problem Statement

Users who have backfilled historical OHLCV bars and fundamentals data into the platform cannot query or browse that data directly. The only way to consume it is indirectly through strategies, backtests, or screeners. This forces users to create throwaway strategies just to view their own data, adding friction to independent analysis workflows.

## User Story

As a trader/analyst, I want to query and view my backfilled OHLCV and fundamentals data directly through the UI and MCP agent, so that I can perform independent analysis without having to set up strategies or run backtests.

## Functional Requirements

FR-1. Users can query OHLCV bars by symbol, timeframe, and date range through a UI page in the insights segment, with results displayed in both tabular and chart form.

FR-2. Users can query fundamentals data (current snapshot and historical point-in-time) by symbol through the same UI page, with results displayed in both tabular and chart form (time-series chart for historical metrics such as P/E ratio, EPS, market cap over fiscal periods).

FR-3. The MCP agent exposes a `query_bars` tool that returns OHLCV data for a given symbol, timeframe, and date range.

FR-4. The MCP agent exposes a `query_fundamentals` tool that returns fundamentals data (snapshot and/or historical) for a given symbol, with optional date-range and period-type filters.

FR-5. Both UI and agent surfaces enforce pagination to prevent unbounded result sets on large date ranges.

FR-6. The UI data explorer page is registered in `PLATFORM_SUBNAV` and accessible from the insights segment navigation (C-10).

FR-7. Both UI and agent surfaces display a "last refresh" timestamp indicating when the queried data was last updated — for OHLCV, the most recent bar's `time` in the result set; for fundamentals snapshot, the `fetched_at` column; for historical fundamentals, the most recent `filed_date` in the result set.

FR-8. The UI provides a "Download CSV" action that exports the currently displayed query results (OHLCV bars or fundamentals) as a CSV file.

FR-9. The MCP `query_bars` and `query_fundamentals` tools accept a `format` parameter (`json` | `csv`). When `csv`, the tool returns the result as base64-encoded CSV binary content (MIME type `text/csv`) suitable for the client to save as a file, instead of the default JSON text response.

## Out of Scope

- Writing or modifying OHLCV/fundamentals data (backfill triggering already exists via feature 066/backfill-management-ui)
- Adding new data sources or providers
- Real-time streaming of bars/quotes (live feed already served by `StreamBars`/`StreamQuotes`)
- Cross-symbol comparison views or correlation analysis
- New proto RPCs — the existing RPCs provide the required query capabilities; only additive field additions to existing messages

## Affected Services

Exact service names from CLAUDE.md Service Registry:
- `xstockstrat-ui` — new data-explorer page under `/insights/data-explorer`, BFF routes to proxy `GetBars` and `GetHistoricalFundamentals` RPCs
- `xstockstrat-agent` — two new MCP tools: `query_bars`, `query_fundamentals`
- `xstockstrat-marketdata` — add pagination support to `GetHistoricalFundamentals` handler (proto field addition + repo query cursor); existing `GetBars`/`GetFundamentals` RPCs need no changes

## Consumer Surface(s)

_Constitution **C-14**._ The end-user-reachable surface(s) this capability is consumed through.

- [x] **UI** — `xstockstrat-ui` segment(s): `/insights` — new `/insights/data-explorer` page with OHLCV chart+table, fundamentals chart+table views, and CSV export; registered in `PLATFORM_SUBNAV`
- [x] **Agent** — `xstockstrat-agent` MCP tool(s): `query_bars` (new tool, JSON + CSV binary output), `query_fundamentals` (new tool, JSON + CSV binary output)
- [ ] **None** — internal/platform-only, no end-user surface.

## Proto Contract Changes

- [ ] No proto changes required
- [x] Additive field additions to existing messages (non-breaking):
  - `GetHistoricalFundamentalsRequest`: add `common.v1.PageRequest page = 6` — enables cursor-based pagination for historical fundamentals queries (currently unbounded)
  - `GetHistoricalFundamentalsResponse`: add `common.v1.PageResponse pagination = 2` — returns `next_page_token` and `total_count`

These are additive (new field numbers on existing messages), so `buf breaking` passes. The existing RPCs need no signature changes:
- `GetBars` / `BatchGetBars` — already have `PageRequest` pagination
- `GetFundamentals` / `GetFundamentalsMulti` — snapshot lookups, no pagination needed

## Config Key Changes

- [ ] No new config keys

## Database Changes

- [ ] No schema changes

## Feature Workflow Notes

Branch to create: `feature/backfilled-data-queryable` (branch from `main-dev`)
Approval gates required (per docs/runbooks/feature-workflow.md):
- [x] 1 service owner approval (non-breaking proto or config change)
- [ ] 2 service owners + platform lead (breaking proto change)
- [ ] DBA review + service owner (schema migration)

## Acceptance Criteria

See `acceptance.feature` (scenarios `@AC-*`) — the single source of acceptance truth (Constitution
**C-15**). Each `FR-N` above is covered by ≥1 tagged scenario there.

## Open Questions

- [ ] **Known trap (ledger):** Agent tool count is asserted in 5+ separate doc surfaces (agent `CLAUDE.md`, `docs/runbooks/mcp-tools.md`, `docs/runbooks/CLAUDE.md` index, `tools.py` docstring, operational runbook `historical-backfill.md`). Adding `query_bars` and `query_fundamentals` must update all of them — see insights.md 2026-08-06 screener-agent-tool and trigger-backfill-mcp-tool entries.
- [x] **Pagination limits:** ~~Resolved~~ — 500 bars/page in UI, 1000 max in agent tool. Accepted by user.
- [x] **Chart library:** ~~Resolved~~ — Reuse Recharts (already in insights segment). Confirmed by user.
- [x] **Fundamentals charting:** ~~Resolved~~ — Moved in-scope. Historical fundamentals get time-series chart (FR-2 updated). Confirmed by user.
