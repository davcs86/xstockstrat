# Design: backfilled-data-queryable

**Created**: 2026-09-24
**Rounds**: 3 (full; termination: approved)
**Approved by**: user @ 2026-09-24
**Grounded in**: recon.md

---

## Chosen Approach

Single data-explorer page at `/insights/data-explorer` with two tabs (OHLCV / Fundamentals), two
new MCP agent tools (`query_bars`, `query_fundamentals`), and proto-level cursor pagination for
`GetHistoricalFundamentals`. Four execution layers in order: (1) proto + codegen, (2) marketdata
service pagination, (3) agent tools + wiring, (4) UI page + BFF wiring.

### Proto (additive)

Add `common.v1.PageRequest page = 6` to `GetHistoricalFundamentalsRequest` and
`common.v1.PageResponse pagination = 2` to `GetHistoricalFundamentalsResponse`
(`marketdata.proto:277-288`). `common.v1` already imported (`marketdata.proto:8`). Run
`buf-gen.sh`. No new RPCs, no migration.

### Marketdata service — cursor pagination for `GetHistoricalFundamentals`

Add cursor pagination to `QueryHistoricalFundamentals` (`marketdata_repo.go:583`) replicating
the `QueryBars` pattern (`marketdata_repo.go:85-122`):

- **Composite cursor** `(period_end, fiscal_period)` — `period_end` alone is not unique (annual FY
  and Q4 quarterly share the same date per `migrations/005_fundamentals_history.up.sql:28` PK).
  Token is pipe-delimited `"2025-06-30|Q2-2025"`. SQL: `ORDER BY period_end, fiscal_period`,
  row-value comparison `(period_end, fiscal_period) > ($1, $2)`, overfetch `LIMIT pageSize+1`,
  derive `nextToken` from the last row.
- **`filterAsOf` pushed into SQL** as `AND filed_date < $asOf` before LIMIT — prevents short pages
  from post-filter truncation. Service-layer `filterAsOf` (`marketdata_service.go:1533`) remains as
  defense-in-depth.
- Default page size: **50**. `PageResponse.total_count` left at wire-default 0, matching `GetBars`
  precedent — UI must not render "0 results total."

### Agent wiring

- Add `MARKETDATA_ENDPOINT=xstockstrat-marketdata:50053` to `docker-compose.yml`,
  `.do/app.yaml`, `.do/app.dev.yaml`, and agent `CLAUDE.md` env vars section.
- Three client methods in `client.py`: `get_bars`, `get_fundamentals`,
  `get_historical_fundamentals` — all using the ephemeral channel pattern (`client.py:169`).
- Two tools in `tools.py` via `@server.tool()`:
  - `query_bars(symbol, start, end, limit=500, page_token="", format="json")` — caps at 1000.
  - `query_fundamentals(symbol, mode="snapshot"|"historical", range_start, range_end, period_types,
    limit=50, page_token="", format="json")` — caps at 50.
  - Both accept `limit` + `page_token` following `client.py:349-363` pattern.
  - Both include `last_refreshed` field (bars: max `bar.time`; snapshot: `Fundamentals.as_of`
    field 14; historical: max `filed_date`) and `missing_metrics` list in response.
  - For `format="csv"`: return `[EmbeddedResource(resource=TextResourceContents(mimeType="text/csv",
    text=csv_string))]` following `backtest_view.py:102-117`. CSV emits empty cells for metrics in
    `missing_metrics`. Raw CSV text, not base64 (`BlobResourceContents` banned by feature 072).
- Tool count 49 → 51 across all 6 surfaces (`recon.md:122-128`). Full `### query_bars` and
  `### query_fundamentals` reference sections in `mcp-tools.md`.

### UI — data-explorer page

New page at `src/app/insights/data-explorer/page.tsx` with two tabs:

**OHLCV tab**: Symbol `Combobox` (reuse `ChartPanel.tsx:88-112` pattern fed by `listAssets`),
date-range pickers, timeframe hardcoded to `1Day` (feature 143). `useInfiniteQuery` keyed on
`[symbol, start, end]` calling `insightsMarketDataClient.getBars()` — `getNextPageParam` reads
`nextPageToken`, "Load More" button calls `fetchNextPage`, `pages.flatMap()` accumulates results
(reuse `useOpportunities.ts:29-46` pattern). `DataTable` with `enablePagination` for client-side
table paging of accumulated data. Recharts `ChartContainer` price chart (close prices) with
`xAxisId`/`yAxisId` on `CartesianGrid` (Recharts v3). Last-refresh from max `bar.time` via
`protoTime.ts` helpers.

**Fundamentals tab**: Snapshot sub-view calls `getFundamentals()`, renders key metrics in a card
with `as_of` last-refresh timestamp and `stale` badge when `Fundamentals.stale` is true (mirroring
trader `FundamentalsSection` pattern). Historical sub-view calls paginated
`getHistoricalFundamentals()` via `useInfiniteQuery` with "Load More", period-type filter,
metric-selector Recharts time-series line chart. **`missing_metrics` handling**: map any metric
named in `missing_metrics` to `null` before passing to Recharts (renders as gap); display `"—"` in
table cells (explicit check, not JavaScript truthiness); emit empty cells in CSV.

**CSV download**: Client-side from accumulated `useInfiniteQuery` pages using `toCsv()` helper +
`Blob` + download link (following `attribution/page.tsx:32-37`). No new BFF route needed.

### BFF wiring

Add `listAssets`, `getFundamentals`, `getHistoricalFundamentals` to the insights BFF
`MarketDataService` block at `insightsBff.ts:87-95` using the existing `forward()` pattern.
`insightsMarketDataClient` browser client already exists and is bound to `/insights/api`.

### Navigation

Add `{ label: 'Data Explorer', href: '/insights/data-explorer' }` to `PLATFORM_SUBNAV.insights`
(`PlatformHeader.tsx:75-82`) and `NAV_GROUPS` Engine group (`navGroups.tsx:57-65`). Satisfies C-10,
extends `@AC-5`.

### Consumer surfaces (C-14)

- **UI**: `/insights/data-explorer` page — OHLCV chart+table, fundamentals chart+table, CSV
  download, last-refresh timestamps, missing-metrics gaps, stale badge.
- **Agent**: `query_bars` and `query_fundamentals` tools — JSON + CSV output, pagination,
  last-refresh, missing_metrics list.

## Rejected Alternatives

- **Bare `TextContent` for agent CSV** — rejected because it carries no `mimeType` field; @AC-18/@AC-19 require a MIME-typed content item; `EmbeddedResource` + `TextResourceContents` follows the existing `backtest_view.py` pattern.
- **`period_end`-only cursor token** — rejected because `period_end` is not unique per symbol (annual FY + Q4 quarterly share dates); composite `(period_end, fiscal_period)` eliminates duplicate-row and infinite-loop bugs at page boundaries.
- **`fetched_at` proto field for last-refresh** — rejected (user decision); `as_of` already exists on the `Fundamentals` proto (field 14) and is more useful to the user ("data accurate as of").
- **Server-side BFF streaming CSV route** — rejected because the ledger export pattern wraps a streaming RPC, not paginated unary; client-side `toCsv()` + Blob is simpler and follows `attribution/page.tsx:32-37`.
- **Custom "Load More" accumulator** — rejected because `useInfiniteQuery` already implements the pattern (`useOpportunities.ts:29-46`) with proper `getNextPageParam` + `fetchNextPage`; a custom hook would duplicate TanStack Query's pagination state management and risk the dep-array trap (fails.md 154).
- **JavaScript truthiness for missing metrics** — rejected because it breaks for legitimately-zero metrics (`dividend_yield`) and is ineffective for chart data arrays where `0.0` is plottable; explicit `missing_metrics` check is the MARKETDATA-11 invariant-correct approach.
- **`filterAsOf` as post-filter only** — rejected because post-filtering after LIMIT produces short pages; pushing `AND filed_date < $asOf` into SQL before LIMIT ensures full-sized pages.

## Open Risks

- [ ] Composite cursor `(period_end, fiscal_period)` relies on `fiscal_period` sorting lexicographically (`FY*` vs `Q*`). If a future data source introduces non-sortable formats, pagination could skip/duplicate rows. Low probability given EDGAR-only source and PK constraint — to be addressed at implementation with a documented format assumption.
- [ ] Client-side CSV exports only the pages the user has loaded (not the full query range). For typical data-explorer usage this suffices, but a user expecting "export all" would need to "Load More" first — to be addressed at implementation with UX copy or a "Load All + Export" option.

## Constitution Rules Touched

- `C-10` — honored by: registering "Data Explorer" in `PLATFORM_SUBNAV.insights` and `NAV_GROUPS` Engine group.
- `C-14` — honored by: naming both consumer surfaces (UI `/insights/data-explorer` + Agent `query_bars`/`query_fundamentals`) in the product spec and designing both in this approach.
- `C-15` — honored by: updating @AC-8/@AC-9 (1Day timeframe), @AC-12/@AC-14 (as_of), @AC-18/@AC-19 (TextResourceContents), adding @AC-22 (missing_metrics).
- `C-16` — honored by: preserving existing `@AC-*` guarantees (see Business Rules below).
- `C-17` — honored by: mirroring `stale` badge from trader `FundamentalsSection`, using `EmptyState`/`QueryStateMessages` for loading/empty/error states.
- `C-18` — honored by: reusing 15 existing patterns (see recon.md § Patterns to REUSE); composite cursor fixes uniqueness bug; `filterAsOf` pushed to SQL; explicit `missing_metrics` handling per MARKETDATA-11.
- `P-03` — honored by: not silently swapping `fetched_at` for `as_of` (surfaced to user, decision recorded in context.md).

## Business Rules Touched (C-16)

- PRESERVE `@AC-1 @regression @feature-153` "A 400-day bars query over the ohlcv hypertable locks few enough chunks to succeed" (`services/xstockstrat-marketdata/acceptance/fix-ohlcv-chunk-lock-oom.feature`) — not regressed by: `GetBars` handler unchanged; data-explorer is a new caller of the same RPC, no wider lock scope.
- PRESERVE `@AC-2 @FR-2 @feature-191` "BatchGetBars returns bars for multiple symbols in one call" (`services/xstockstrat-marketdata/acceptance/opportunities-latency-fix.feature`) — not regressed by: `BatchGetBars` not modified; data-explorer uses single-symbol `GetBars`.
- PRESERVE `@AC-3 @FR-2 @feature-191` "BatchGetBars omits symbols with no stored bars" (`services/xstockstrat-marketdata/acceptance/opportunities-latency-fix.feature`) — not regressed by: omit-not-fabricate contract untouched.
- EXTEND `@AC-5 @FR-5 @feature-042` "The P&L Patterns view is reachable from the insights sub-nav" (`services/xstockstrat-ui/acceptance/order-snapshots-pnl-patterns.feature`) — new case added: "Data Explorer" registered alongside existing PLATFORM_SUBNAV entries.
- CHANGE `@AC-9 @FR-7 @feature-169` "All six tool-inventory surfaces are kept in sync" (`services/xstockstrat-agent/acceptance/agent-postgres-mcp.feature`) — altered guarantee: count changes from 49 to 51; signed off by user (context.md session 2026-09-24).
