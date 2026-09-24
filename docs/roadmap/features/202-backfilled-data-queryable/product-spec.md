# Product Spec: backfilled-data-queryable

**Created**: 2026-09-24

---

## Problem Statement

Users who have backfilled historical OHLCV bars and fundamentals data into the platform cannot query or browse that data directly. The only way to consume it is indirectly through strategies, backtests, or screeners. This forces users to create throwaway strategies just to view their own data, adding friction to independent analysis workflows.

## User Story

As a trader/analyst, I want to query and view my backfilled OHLCV and fundamentals data directly through the UI and MCP agent, so that I can perform independent analysis without having to set up strategies or run backtests.

## Functional Requirements

FR-1. Users can query OHLCV bars by symbol, timeframe, and date range through a UI page in the insights segment, with results displayed in both tabular and chart form.

FR-2. Users can query fundamentals data (current snapshot and historical point-in-time) by symbol through the same UI page, with results displayed in tabular form.

FR-3. The MCP agent exposes a `query_bars` tool that returns OHLCV data for a given symbol, timeframe, and date range.

FR-4. The MCP agent exposes a `query_fundamentals` tool that returns fundamentals data (snapshot and/or historical) for a given symbol, with optional date-range and period-type filters.

FR-5. Both UI and agent surfaces enforce pagination to prevent unbounded result sets on large date ranges.

FR-6. The UI data explorer page is registered in `PLATFORM_SUBNAV` and accessible from the insights segment navigation (C-10).

## Out of Scope

- Writing or modifying OHLCV/fundamentals data (backfill triggering already exists via feature 066/backfill-management-ui)
- Adding new data sources or providers
- Real-time streaming of bars/quotes (live feed already served by `StreamBars`/`StreamQuotes`)
- Charting fundamentals history over time (tabular display only for fundamentals; chart for OHLCV)
- Cross-symbol comparison views or correlation analysis
- New proto RPCs — the existing `GetBars`, `BatchGetBars`, `GetFundamentals`, `GetFundamentalsMulti`, `GetHistoricalFundamentals` RPCs provide the required query capabilities

## Affected Services

Exact service names from CLAUDE.md Service Registry:
- `xstockstrat-ui` — new data-explorer page under `/insights/data-explorer`, BFF routes to proxy `GetBars` and `GetHistoricalFundamentals` RPCs
- `xstockstrat-agent` — two new MCP tools: `query_bars`, `query_fundamentals`
- `xstockstrat-marketdata` — no code changes expected; existing RPCs (`GetBars`, `GetFundamentals`, `GetHistoricalFundamentals`) already provide the backend query surface

## Consumer Surface(s)

_Constitution **C-14**._ The end-user-reachable surface(s) this capability is consumed through.

- [x] **UI** — `xstockstrat-ui` segment(s): `/insights` — new `/insights/data-explorer` page with OHLCV chart+table and fundamentals table views, registered in `PLATFORM_SUBNAV`
- [x] **Agent** — `xstockstrat-agent` MCP tool(s): `query_bars` (new tool), `query_fundamentals` (new tool)
- [ ] **None** — internal/platform-only, no end-user surface.

## Proto Contract Changes

- [x] No proto changes required

The existing RPCs are sufficient:
- `GetBars` / `BatchGetBars` — OHLCV query with symbol, timeframe, start/end, pagination
- `GetFundamentals` / `GetFundamentalsMulti` — current fundamentals snapshot
- `GetHistoricalFundamentals` — PIT historical fundamentals with date range and period-type filter

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
- [ ] **Pagination limits:** What default page size for OHLCV bars in the UI? Candidates: 500 bars (enough for ~2 years of daily data), or configurable via query param. The agent tool should cap at a reasonable limit (e.g. 1000 rows) to keep MCP responses within token budgets.
- [ ] **Chart library:** The insights segment already uses Recharts (via backtest diagnostics, screener). Confirm the data explorer should reuse the same library for OHLCV candlestick/line charts.
