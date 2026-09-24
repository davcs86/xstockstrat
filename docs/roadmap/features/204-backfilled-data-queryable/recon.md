# Recon: backfilled-data-queryable

**Created**: 2026-09-24
**From**: product-spec.md
**Affected services**: xstockstrat-marketdata, xstockstrat-ui, xstockstrat-agent

---

## Objective

Expose existing backfilled OHLCV bars and fundamentals data through a dedicated UI data-explorer
page (`/insights/data-explorer`) and two new MCP agent tools (`query_bars`, `query_fundamentals`),
so users can query and analyze historical market data independently without running strategies or
backtests. Adds proto-level pagination to `GetHistoricalFundamentals`, CSV export on both surfaces,
and last-refresh timestamps.

## Codebase Map

### `xstockstrat-marketdata` (Go)

- Entry point: `cmd/server/main.go:33`
- gRPC registration: `cmd/server/main.go:162` → `marketdatav1.RegisterMarketDataServiceServer`
- Handler: `internal/handler/marketdata_handler.go:22` (`MarketDataHandler`)
- Service — `GetBars` (paginated): `internal/service/marketdata_service.go:160` — page extraction at `:179-186` (default `pageSize=500`)
- Service — `GetFundamentals`: `marketdata_service.go:1268` — single-symbol snapshot
- Service — `GetFundamentalsMulti`: `marketdata_service.go:1284` — multi-symbol snapshot
- Service — `GetHistoricalFundamentals`: `marketdata_service.go:1512-1539` — **NO pagination** — calls repo unbounded, post-filters with `filterAsOf` at `:1533`
- Repo — `QueryBars` (cursor pattern): `internal/repository/marketdata_repo.go:85-122` — `page_token` = `time.RFC3339Nano`, overfetch `LIMIT pageSize+1`, nextToken from last bar's `.Time`
- Repo — `QueryRecentBars`: `marketdata_repo.go:164` — newest page, no cursor
- Repo — `QueryHistoricalFundamentals`: `marketdata_repo.go:583` — `ORDER BY period_end`, **no LIMIT**
- Repo — `fundamentalsColumns` (fetched_at): `marketdata_repo.go:433`
- Repo — `histFundamentalsColumns` (filed_date): `marketdata_repo.go:549` — 20 columns
- Last migration: `migrations/005_fundamentals_history.up.sql` (next: `006`)
- Config-read: `cmd/server/main.go:54` — `config.NewWatcher(..., "marketdata", ...)`
- Timeframe resolution: `internal/timeframe/timeframe.go:64` — `Resolve(enum, legacyStr)`

### `xstockstrat-ui` (Next.js)

- PLATFORM_SUBNAV: `src/components/shared/PlatformHeader.tsx:69` — insights entries at `:75-82`
- NAV_GROUPS (primary nav): `src/components/shared/navGroups.tsx:36-96` — Engine group at `:57-66`
- Insights AppShell: `src/components/insights/AppShell.tsx:15-17` — conditionally appends admin-only items
- Insights BFF: `src/lib/insightsBff.ts` — `createBffRouter()`, `forward()` pattern at `:88`, dispatch at `:162`
- BFF route handler: `src/app/insights/api/[...connect]/route.ts`
- **`getBars` already wired**: `insightsBff.ts:88` — `getBars: forward(...)`
- **`getFundamentals` NOT on insights BFF** — only on trader BFF via `useFundamentals.ts`
- **`getHistoricalFundamentals` NOT wired** anywhere in UI
- Server-side gRPC clients: `src/lib/connectClients.ts` — `marketDataClient` exists
- Browser client (insights): `src/lib/browserClients/insightsMarketDataClient.ts`
- DataTable (with pagination): `src/components/ui/data-table.tsx:81` — `enablePagination` prop, client-side `@tanstack/react-table`
- Recharts: `src/components/insights/EquityCurveChart.tsx:3`, `FormulaRunResult.tsx`, `PerformanceDashboard.tsx` — uses `ChartContainer`/`ChartConfig` from `@/components/ui/chart`
- Symbol selector: `src/components/trader/ChartPanel.tsx:88-112` — `Combobox` + `listAssets()`
- Timeframe: `src/lib/chart.ts:9-17` — only `1Day` requestable (feature 143)
- CSV clipboard copy: `src/app/insights/attribution/page.tsx:32-37` — `toCsv()` + `navigator.clipboard`
- CSV streaming download: `src/app/trader/api/ledger/export/route.ts` — `NextResponse` + `Content-Disposition`
- Timestamp helpers: `src/lib/protoTime.ts` — `timestampToDate`, `fmtShortDate`
- Loading/empty/error: `EmptyState.tsx:7`, `QueryStateMessages.tsx:2`, `Skeleton.tsx`, `CardNotice.tsx`
- Existing test fixtures: `e2e/fixtures/fundamentals.ts` (`FUNDAMENTALS_AAPL`), bars inline in `e2e/mock-backend.ts`
- E2E pattern: `e2e/insights/backfills.spec.ts` — `page.route()` stubs + `fulfillJson()` + `addAuthCookie`

### `xstockstrat-agent` (Python)

- Entry point: `app/main.py:77-80` — `MCPServer("xstockstrat-agent")`; `register_tools(server)`
- Tool definitions: `app/tools.py:288` — `register_tools()`; decorator `@server.tool()`
- Tool count: **49** — asserted in 6 surfaces (see Dependencies)
- Client: `app/client.py` — ephemeral channel pattern at `:169`, `_metadata()` at `:56-84`, `MessageToDict` at `:632-636`
- **No `MARKETDATA_ENDPOINT`** — must be added
- **No `get_bars`/`get_fundamentals`/`get_historical_fundamentals` client methods** — must be created
- Pagination pattern: `client.py:351-363` — `PageRequest(page_size=limit, page_token=...)`
- Response format: most tools return `dict` (auto-serialized); `run_backtest` returns `list[TextContent | EmbeddedResource]`
- Binary content: `EmbeddedResource` + `TextResourceContents` (JSON-as-text) in `backtest_view.py:102-117`
- **`BlobResourceContents` explicitly rejected** (feature 072 context.md:14)
- Error handling: `_grpc_error_message` at `tools.py:224-236` → `raise RuntimeError(...)`
- Proto imports: `from gen.ingest.v1 import ingest_pb2, ingest_pb2_grpc` pattern (lazy, noqa)

### Proto contracts

- `GetHistoricalFundamentalsRequest`: `marketdata.proto:277-284` — fields 1-5, **field 6 free for PageRequest**
- `GetHistoricalFundamentalsResponse`: `marketdata.proto:286-288` — field 1, **field 2 free for PageResponse**
- `GetBarsRequest`: `marketdata.proto:117-124` — `PageRequest page = 4` (reference pattern)
- `GetBarsResponse`: `marketdata.proto:126-129` — `PageResponse page = 2`
- `Bar`: `marketdata.proto:65-79` — `symbol, time, open, high, low, close, volume, vwap, trade_count`
- `Fundamentals`: `marketdata.proto:208-229` — 18 fields incl. `as_of` (field 14), `stale` (field 17)
- `HistoricalFundamentalsPeriod`: `marketdata.proto:252-275` — 21 fields incl. `filed_date` (field 5)
- `common.v1.PageRequest`: `common.proto:10-13` — `page_size=1, page_token=2`
- `common.v1.PageResponse`: `common.proto:15-18` — `next_page_token=1, total_count=2`

## Patterns to REUSE

- **GetBars cursor pagination** → replicate for `GetHistoricalFundamentals`: `marketdata_repo.go:85-122` (token = `time.RFC3339Nano` of last item, overfetch `LIMIT pageSize+1`, encode nextToken from last row)
- **BFF `forward()` handler** → add `getFundamentals`, `getHistoricalFundamentals` to insights BFF: `insightsBff.ts:88`
- **`insightsMarketDataClient` browser client** → already exists, use for new queries: `browserClients/insightsMarketDataClient.ts`
- **`DataTable` with `enablePagination`** → for OHLCV bars table and fundamentals table: `data-table.tsx:81`
- **Recharts `ChartContainer`/`ChartConfig`** → for OHLCV price chart and fundamentals time-series: `components/ui/chart.tsx`, `EquityCurveChart.tsx`
- **`Combobox` symbol selector** → for data-explorer symbol input: `components/ui/combobox.tsx`, used in `ChartPanel.tsx:88-112`
- **`useQuery` hook pattern** → for data-explorer queries: `useBackfills.ts:22-27` (queryKey includes filter params)
- **`EmptyState` / `QueryStateMessages`** → for loading/empty/error states: `EmptyState.tsx:7`, `QueryStateMessages.tsx:2`
- **`protoTime` helpers** → for last-refresh timestamp display: `protoTime.ts` (`timestampToDate`, `fmtShortDate`)
- **Ledger export streaming CSV** → for UI CSV download: `trader/api/ledger/export/route.ts` (NextResponse + Content-Disposition)
- **`EmbeddedResource` + `TextResourceContents`** → for agent CSV binary output (encode CSV as text with MIME): `backtest_view.py:102-117`
- **Ephemeral gRPC channel pattern** → for new MARKETDATA_ENDPOINT calls in agent: `client.py:169`
- **`_grpc_error_message` error handler** → for new agent tools: `tools.py:224-236`
- **Agent `PageRequest` usage** → for historical fundamentals pagination in agent: `client.py:351-363`
- **Test fixtures** → `FUNDAMENTALS_AAPL` at `e2e/fixtures/fundamentals.ts`; extend for historical fundamentals; bars from `e2e/mock-backend.ts`

## Existing Business Rules (preserve / extend)

- **PRESERVE** `@AC-1 @regression @feature-153` "A 400-day bars query over the ohlcv hypertable locks few enough chunks to succeed" (`services/xstockstrat-marketdata/acceptance/fix-ohlcv-chunk-lock-oom.feature`) — feature 202 exposes GetBars via new surfaces; handler unchanged but wider use must not regress the lock budget
- **PRESERVE** `@AC-2 @FR-2 @feature-191` "BatchGetBars returns bars for multiple symbols in one call" (`services/xstockstrat-marketdata/acceptance/opportunities-latency-fix.feature`) — equivalence guarantee; feature 202 must not alter GetBars semantics
- **PRESERVE** `@AC-3 @FR-2 @feature-191` "BatchGetBars omits symbols with no stored bars" (`services/xstockstrat-marketdata/acceptance/opportunities-latency-fix.feature`) — omit-not-fabricate contract
- **EXTEND** `@AC-5 @FR-5 @feature-042` "The P&L Patterns view is reachable from the insights sub-nav" (`services/xstockstrat-ui/acceptance/order-snapshots-pnl-patterns.feature`) — feature 202 adds "Data Explorer" alongside existing PLATFORM_SUBNAV entries
- **CHANGE** `@AC-9 @FR-7 @feature-169` "All six tool-inventory surfaces are kept in sync" (`services/xstockstrat-agent/acceptance/agent-postgres-mcp.feature`) — feature 202 adds `query_bars` + `query_fundamentals`, changing count from 49 to 51; all six doc surfaces and `COPILOT_MCP_TOOL_COUNT` must update (**requires user sign-off in context.md**)

No existing scenarios assert on `GetFundamentals`, `GetFundamentalsMulti`, or `GetHistoricalFundamentals` behavior directly. The pagination addition is purely additive (new field numbers on existing messages).

## Dependencies

- **Proto/RPC**: additive fields on `GetHistoricalFundamentalsRequest` (field 6 = `PageRequest`) and `GetHistoricalFundamentalsResponse` (field 2 = `PageResponse`) — `marketdata.proto:277-288`. `common.v1` already imported at `marketdata.proto:8`.
- **Migration**: next = `006` for `services/xstockstrat-marketdata/migrations/` — **not needed** (no schema changes; pagination is query-level)
- **Config keys**: none new
- **Inter-service edges**: `xstockstrat-agent` → `xstockstrat-marketdata` (gRPC, new edge — `MARKETDATA_ENDPOINT` must be added)
- **New env vars**: `MARKETDATA_ENDPOINT=xstockstrat-marketdata:50053` — must be added to agent's `docker-compose.yml` block, `.do/app.dev.yaml`, `.do/app.yaml`
- **Agent tool count**: 49 → 51 — update across 6 surfaces:
  1. `services/xstockstrat-agent/app/tools.py:4` (docstring)
  2. `services/xstockstrat-agent/CLAUDE.md:43`
  3. `docs/runbooks/mcp-tools.md:3`
  4. `docs/runbooks/mcp-tools.md:10`
  5. `docs/runbooks/mcp-tools.md:45`
  6. `services/xstockstrat-ui/src/lib/copilot.ts:20` (`COPILOT_MCP_TOOL_COUNT`)

## Risks / Not-found

1. **No `MARKETDATA_ENDPOINT` in agent** — new inter-service edge; must add env var to agent container in docker-compose + DO app specs
2. **`BlobResourceContents` rejected** (feature 072) — agent CSV binary output must use `EmbeddedResource` + `TextResourceContents` with MIME `text/csv` and base64-encoded text body, or return CSV as plain `TextContent` with a MIME annotation
3. **No server-side cursor pagination UI component** — `DataTable` only does client-side pagination; for OHLCV bars (which use server-side cursor `GetBars` pagination), the page needs a custom "Load More" / cursor-forward pattern rather than `DataTable`'s built-in previous/next
4. **No "last refreshed" display** — must create (data available: bars → most recent `bar.time` in result set; fundamentals snapshot → `Fundamentals.as_of` field 14; historical → most recent `filed_date`)
5. **`GetHistoricalFundamentals` and `GetFundamentals` not wired in insights BFF** — need new BFF handlers + browser client hooks
6. **Timeframe limited to 1Day** for `GetBars` (feature 143) — the data-explorer must respect this constraint; timeframe selector should show only valid options
7. **Ledger trap — TanStack Query dep arrays** (fails.md 154): any `useEffect` keying on a `useQuery` result must use `dataUpdatedAt`/`errorUpdatedAt`, not `data`/`error`
8. **Ledger trap — pagination silent truncation** (fails.md 143): `GetBars` ascending cursor can drop bars at page boundary when new bars arrive; the data-explorer is read-only historical, so this is lower risk, but the chart should handle page-boundary seams
9. **Ledger trap — Recharts v3** (insights.md 123): `CartesianGrid` requires `xAxisId`/`yAxisId` props in Recharts v3
10. **Ledger trap — agent tool count sync** (fails.md/insights.md): 6 surfaces, not 5 — includes `COPILOT_MCP_TOOL_COUNT` numeric constant

## Recommended Scope

1. **Proto** — add `PageRequest page = 6` to `GetHistoricalFundamentalsRequest`, `PageResponse pagination = 2` to `GetHistoricalFundamentalsResponse`; run `buf-gen.sh`
2. **Marketdata service** — implement cursor pagination in `QueryHistoricalFundamentals` (repo) and `GetHistoricalFundamentals` (service), following the `QueryBars` pattern
3. **UI — BFF wiring** — add `getFundamentals`, `getHistoricalFundamentals` to `insightsBff.ts`
4. **UI — data-explorer page** — new page at `src/app/insights/data-explorer/page.tsx` with OHLCV tab (symbol selector, date range, table+chart, pagination) and Fundamentals tab (snapshot+historical, table+chart, pagination)
5. **UI — PLATFORM_SUBNAV** — register "Data Explorer" in `PlatformHeader.tsx`
6. **UI — CSV export** — "Download CSV" button using the ledger-export streaming pattern
7. **UI — last refresh timestamp** — inline display using `protoTime` helpers
8. **Agent — MARKETDATA_ENDPOINT wiring** — add env var, docker-compose, DO app specs
9. **Agent — client methods** — `get_bars`, `get_fundamentals`, `get_historical_fundamentals` in `client.py`
10. **Agent — tools** — `query_bars` and `query_fundamentals` in `tools.py` with `format` param (json/csv)
11. **Agent — tool count sync** — update all 6 surfaces from 49 to 51
12. **Tests** — E2E for data-explorer page; agent tool tests; extend fixtures
