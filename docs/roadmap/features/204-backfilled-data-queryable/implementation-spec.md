# Implementation Spec: backfilled-data-queryable

**Status**: `pending`
**Created**: 2026-09-24
**Feature**: `docs/roadmap/features/204-backfilled-data-queryable/feature.md`
**Total Steps**: 14
**Feature Branch**: `feature/backfilled-data-queryable`

---

## Execution Summary

Four execution layers in dependency order: (1) proto + codegen adds pagination fields to
`GetHistoricalFundamentals` messages, (2) marketdata service implements the composite cursor
pagination in repo and service, (3) agent wiring adds the `MARKETDATA_ENDPOINT` env var, client
methods, and two new MCP tools with JSON/CSV output, (4) UI wiring adds BFF handlers, the
data-explorer page with OHLCV/Fundamentals tabs, nav registration, and E2E tests. Each backend
service step is paired with its test step (C-08). Both consumer surfaces — UI and Agent — have
dedicated implementation steps (C-14).

## Scenario Coverage

| AC | Step(s) |
|---|---|
| AC-1 | 13 |
| AC-2 | 13 |
| AC-3 | 13 |
| AC-4 | 13 |
| AC-5 | 8 |
| AC-6 | 8 |
| AC-7 | 8 |
| AC-8 | 13 |
| AC-9 | 8 |
| AC-10 | 14 |
| AC-11 | 13 |
| AC-12 | 13 |
| AC-13 | 8 |
| AC-14 | 8 |
| AC-15 | 13 |
| AC-16 | 13 |
| AC-17 | 13 |
| AC-18 | 8 |
| AC-19 | 8 |
| AC-20 | 13 |
| AC-21 | 8 |
| AC-22 | 13 |

## Step Dependencies

- Step 2 requires Step 1: codegen consumes the proto changes
- Step 3 requires Step 2: service code references generated Go stubs
- Step 4 requires Step 3: tests exercise the new pagination logic
- Step 5 requires Step 2: agent client references generated Python stubs
- Step 6 requires Step 5: client methods use the new MARKETDATA_ENDPOINT
- Step 7 requires Step 6: tools call client methods
- Step 8 requires Step 7: tests exercise the new tools
- Step 9 requires Step 7: docs describe the tools added in Step 7
- Step 10 requires Step 2: BFF handlers reference generated TS stubs
- Step 11 requires Step 10: page calls BFF-proxied RPCs
- Step 12 requires Step 11: nav links to the page created in Step 11
- Step 13 requires Steps 11, 12: E2E tests exercise the page and its nav
- Step 14 requires Step 12: E2E tests verify nav registration
- Steps 3–4 and Steps 5–9 are independent of each other (can run in parallel)
- Steps 10–14 depend on Step 2 only (independent of Steps 3–9)

---

### Step 1 — proto: Add pagination fields to GetHistoricalFundamentals messages

**Status**: `done`
**Service**: `packages/proto`
**Files**:
- `packages/proto/marketdata/v1/marketdata.proto` — modify

**Reviewers**: Proto Reviewer — field number uniqueness, backward compatibility; Service owner (`xstockstrat-marketdata`) — OHLCV ingestion integrity

**Codebase Evidence**:
- Confirmed via: `grep -n "GetHistoricalFundamentalsRequest" packages/proto/marketdata/v1/marketdata.proto` → line 277
- Confirmed via: `grep -n "GetHistoricalFundamentalsResponse" packages/proto/marketdata/v1/marketdata.proto` → line 286
- Existing pattern: `GetBarsRequest` at line 117 has `common.v1.PageRequest page = 4`; `GetBarsResponse` at line 126 has `common.v1.PageResponse page = 2`
- Confirmed: `common.v1` already imported at `marketdata.proto:8`
- Confirmed: field 6 is free on `GetHistoricalFundamentalsRequest` (fields 1–5 in use); field 2 is free on `GetHistoricalFundamentalsResponse` (field 1 in use)

**TDD**: `N/A (proto — non-code-bearing)`

**Covers**: —

**Instructions**:
1. In `packages/proto/marketdata/v1/marketdata.proto`, add `common.v1.PageRequest page = 6;` to `GetHistoricalFundamentalsRequest` (after the existing field 5).
2. In the same file, add `common.v1.PageResponse pagination = 2;` to `GetHistoricalFundamentalsResponse` (after the existing field 1).
3. Run `buf lint` to confirm the additions pass linting.

**Verification**:
```bash
cd packages/proto && buf lint
buf breaking --against '.git#branch=main-dev'
```
Both must pass (additive fields are non-breaking).

---

### Step 2 — proto-gen: Regenerate stubs

**Status**: `done`
**Service**: `packages/proto`
**Files**:
- `packages/proto/gen/go/` — regenerated
- `packages/proto/gen/python/` — regenerated
- `packages/proto/gen/ts/` — regenerated

**Reviewers**: Proto Reviewer — field number uniqueness, backward compatibility; Service owner (`xstockstrat-marketdata`) — OHLCV ingestion integrity

**Codebase Evidence**:
- Confirmed via: `./scripts/buf-gen.sh` exists at repo root (codegen script)

**TDD**: `N/A (proto-gen — non-code-bearing)`

**Covers**: —

**Instructions**:
1. Run `./scripts/buf-gen.sh` from repo root.
2. Commit all regenerated files under `packages/proto/gen/`.

**Verification**:
```bash
./scripts/buf-gen.sh
git diff --stat packages/proto/gen/
```
The diff should show changes in Go, Python, and TS stubs for the marketdata package only. An empty diff after re-running confirms freshness.

---

### Step 3 — service: Implement cursor pagination in GetHistoricalFundamentals

**Status**: `done`
**Service**: `xstockstrat-marketdata`
**Files**:
- `services/xstockstrat-marketdata/internal/repository/marketdata_repo.go` — modify
- `services/xstockstrat-marketdata/internal/service/marketdata_service.go` — modify

**Reviewers**: Service owner (`xstockstrat-marketdata`) — OHLCV ingestion integrity, TimescaleDB hypertable partitioning

**Codebase Evidence**:
- Confirmed via: `QueryBars` cursor pattern at `marketdata_repo.go:85-122` — overfetch `LIMIT pageSize+1`, token = `time.RFC3339Nano` of last bar, next token from last row
- Confirmed via: `QueryHistoricalFundamentals` at `marketdata_repo.go:583` — `ORDER BY period_end`, no LIMIT, no pagination
- Confirmed via: `GetHistoricalFundamentals` service handler at `marketdata_service.go:1512-1539` — calls repo unbounded, post-filters `filterAsOf` at `:1533`
- Existing pattern: `GetBars` page extraction at `marketdata_service.go:179-186` — default `pageSize=500`

**TDD**: `red-green required`

**Covers**: —

**Instructions**:

**Repository layer** (`marketdata_repo.go`):
1. Modify `QueryHistoricalFundamentals` to accept `pageSize int` and `pageToken string` parameters.
2. Implement composite cursor `(period_end, fiscal_period)` — parse the pipe-delimited token `"2025-06-30|Q2-2025"` into two values.
3. Add `AND filed_date < $asOf` to the SQL WHERE clause (push `filterAsOf` into SQL before LIMIT to prevent short pages from post-filter truncation — design.md decision).
4. Add row-value comparison `WHERE (period_end, fiscal_period) > ($cursor_period_end, $cursor_fiscal_period)` when page_token is non-empty.
5. Add `ORDER BY period_end, fiscal_period` and `LIMIT pageSize+1` (overfetch pattern from `QueryBars`).
6. If `len(rows) > pageSize`, derive `nextToken` from the last returned row as `fmt.Sprintf("%s|%s", lastRow.PeriodEnd.Format(time.RFC3339Nano), lastRow.FiscalPeriod)`, trim the slice to `pageSize`.
7. Return `(rows, nextToken, error)`.

**Service layer** (`marketdata_service.go`):
1. In `GetHistoricalFundamentals`, extract page size and page token from `req.Page` (default page size 50, matching design.md).
2. Pass `pageSize`, `pageToken`, and `asOf` to the modified `QueryHistoricalFundamentals`.
3. Build `PageResponse` with `NextPageToken` from the repo return. Leave `TotalCount` at wire-default 0 (matching `GetBars` precedent).
4. Keep the existing service-layer `filterAsOf` post-filter as defense-in-depth (design.md: "remains as defense-in-depth").

**Header propagation**: not applicable — no new outbound gRPC calls added; this modifies an existing handler's own DB query.

**Verification**:
```bash
cd services/xstockstrat-marketdata && GOWORK=off golangci-lint run --modules-download-mode=mod
```

---

### Step 4 — test: Test marketdata GetHistoricalFundamentals pagination

**Status**: `done`
**Service**: `xstockstrat-marketdata`
**Files**:
- `services/xstockstrat-marketdata/internal/repository/marketdata_repo_test.go` — modify (or create if not present)

**Reviewers**: Service owner (`xstockstrat-marketdata`) — OHLCV ingestion integrity

**Codebase Evidence**:
- Confirmed via: `QueryBars` test pattern — tests exercise overfetch and token round-trip

**TDD**: `red-green required`

**Covers**: `AC-20, AC-21`

**Instructions**:
1. Add test cases for `QueryHistoricalFundamentals` pagination:
   - First page returns `pageSize` rows and a non-empty `nextToken` when total rows exceed page size.
   - Second page (using `nextToken` from first call) returns the remaining rows and an empty `nextToken`.
   - Empty page token returns the first page.
   - Composite cursor round-trip: token encodes `(period_end, fiscal_period)` and decoding reconstructs the correct cursor position.
   - `asOf` filter is applied in SQL: rows with `filed_date >= asOf` are excluded even within the LIMIT window.
   - Rows with the same `period_end` but different `fiscal_period` (annual FY vs Q4) are not skipped or duplicated at page boundaries.
2. New logic is in an excluded package (`repository/`) — no coverage threshold applies; integration test verification is sufficient. Single-consumer test data — inline literals are compliant (C-13).

**Verification**:
```bash
cd services/xstockstrat-marketdata && GOWORK=off go test ./internal/repository/... -race -count=1 -run TestQueryHistoricalFundamentals
cd services/xstockstrat-marketdata && GOWORK=off golangci-lint run --modules-download-mode=mod
```

---

### Step 5 — service: Add MARKETDATA_ENDPOINT to agent deployment files

**Status**: `done`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/app/client.py` — modify
- `docker-compose.yml` — modify
- `.do/app.dev.yaml` — modify
- `.do/app.yaml` — modify

**Reviewers**: Service owner (`xstockstrat-agent`) — MCP tool contract stability

**Codebase Evidence**:
- Confirmed via: `client.py:19-26` — endpoint declarations pattern: `INGEST_ENDPOINT = os.environ.get("INGEST_ENDPOINT", "xstockstrat-ingest:50055")`
- Confirmed absent: `grep -n "MARKETDATA_ENDPOINT" services/xstockstrat-agent/app/client.py` → no matches
- Confirmed absent: `grep -n "MARKETDATA_ENDPOINT" docker-compose.yml` in agent block (lines 522-559) → no matches
- Confirmed absent: `grep -n "MARKETDATA_ENDPOINT" .do/app.dev.yaml` in agent block (lines 256-300) → no matches
- Confirmed absent: `grep -n "MARKETDATA_ENDPOINT" .do/app.yaml` in agent block (lines 254+) → no matches

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. In `services/xstockstrat-agent/app/client.py`, add after the existing endpoint declarations (line ~26):
   `MARKETDATA_ENDPOINT = os.environ.get("MARKETDATA_ENDPOINT", "xstockstrat-marketdata:50053")`
2. In `docker-compose.yml`, add `MARKETDATA_ENDPOINT=xstockstrat-marketdata:50053` to the agent service's environment block.
3. In `.do/app.dev.yaml`, add `MARKETDATA_ENDPOINT=xstockstrat-marketdata:50053` to the agent component's envs list.
4. In `.do/app.yaml`, add `MARKETDATA_ENDPOINT=xstockstrat-marketdata:50053` to the agent component's envs list.

**Verification**:
```bash
grep -n "MARKETDATA_ENDPOINT" services/xstockstrat-agent/app/client.py docker-compose.yml .do/app.dev.yaml .do/app.yaml
```
Confirm the env var appears in all four files with value `xstockstrat-marketdata:50053`.

---

### Step 6 — service: Add marketdata client methods to agent

**Status**: `done`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/app/client.py` — modify

**Reviewers**: Service owner (`xstockstrat-agent`) — MCP tool contract stability

**Codebase Evidence**:
- Existing pattern: ephemeral channel at `client.py:169` — `async with grpc.aio.insecure_channel(INGEST_ENDPOINT) as channel:`
- Existing pattern: `_metadata()` propagation at `client.py:56-84`
- Existing pattern: `PageRequest` usage at `client.py:351-363` — `common_pb2.PageRequest(page_size=limit, page_token=page_token)`
- Existing pattern: `MessageToDict` conversion at `client.py:632-636`

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. Add three async functions to `client.py`:

   **`get_bars(symbol, timeframe, start, end, limit, page_token)`** — uses `MARKETDATA_ENDPOINT`, creates ephemeral channel, calls `MarketDataServiceStub.GetBars` with `GetBarsRequest` (symbol, timeframe enum via `Resolve`, start/end as Timestamps, PageRequest), returns dict with `bars` list (MessageToDict each bar), `next_page_token`, and `total_count` from `PageResponse`.

   **`get_fundamentals(symbol)`** — uses `MARKETDATA_ENDPOINT`, calls `GetFundamentals` with `GetFundamentalsRequest(symbol=symbol)`, returns MessageToDict of the `Fundamentals` message.

   **`get_historical_fundamentals(symbol, period_types, start, end, limit, page_token)`** — uses `MARKETDATA_ENDPOINT`, calls `GetHistoricalFundamentals` with `GetHistoricalFundamentalsRequest` including the new `PageRequest page` field (limit, page_token), returns dict with `periods` list (MessageToDict each period), `next_page_token` from the new `PageResponse pagination` field.

2. All three methods use `_metadata()` for header propagation (the caller context set by `CallerPropagationMiddleware` already populates the trio).
3. Use lazy imports for generated stubs: `from gen.marketdata.v1 import marketdata_pb2, marketdata_pb2_grpc` and `from gen.common.v1 import common_pb2` (noqa: PLC0415).

**Header propagation**: All three methods pass `metadata=_metadata()` to their gRPC calls, which propagates `x-user-id`, `x-access-scope`, `x-trace-id` from the per-request caller context. This reuses the existing `_metadata()` mechanism at `client.py:56-84`.

**Verification**:
```bash
cd services/xstockstrat-agent && ruff check . && ruff format --check .
```

---

### Step 7 — service: Add query_bars and query_fundamentals MCP tools

**Status**: `done`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/app/tools.py` — modify

**Reviewers**: Service owner (`xstockstrat-agent`) — MCP tool contract stability, tool-count sync

**Codebase Evidence**:
- Existing pattern: `@server.tool()` decorator at `tools.py:292`
- Existing pattern: `_grpc_error_message` at `tools.py:224-236`
- Existing pattern: `EmbeddedResource` + `TextResourceContents` at `backtest_view.py:102-117` (for binary/MIME content)
- Confirmed: `BlobResourceContents` explicitly rejected (feature 072 context.md)

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. Add two tools inside `register_tools()`:

   **`query_bars(symbol, timeframe="1Day", start_date, end_date, limit=500, page_token="", format="json")`**:
   - Cap `limit` at 1000 (design.md: agent max).
   - Call `client.get_bars(symbol, timeframe, start_date, end_date, limit, page_token)`.
   - Compute `last_refreshed` from the max `bar.time` in the result set.
   - If `format == "csv"`: build CSV string (columns: time, open, high, low, close, volume), return `[EmbeddedResource(type="resource", resource=TextResourceContents(uri="xstockstrat:///data-explorer/bars/<symbol>", mimeType="text/csv", text=csv_string))]`.
   - If `format == "json"` (default): return dict with `bars`, `next_page_token`, `last_refreshed`.
   - Wrap gRPC errors with `_grpc_error_message`.

   **`query_fundamentals(symbol, mode="snapshot", period_types=None, range_start=None, range_end=None, limit=50, page_token="", format="json")`**:
   - When `mode == "snapshot"`: call `client.get_fundamentals(symbol)`, compute `last_refreshed` from `as_of` (field 14), include `missing_metrics` list (explicit check, not truthiness — MARKETDATA-11).
   - When `mode == "historical"`: call `client.get_historical_fundamentals(symbol, period_types, range_start, range_end, limit, page_token)`, compute `last_refreshed` from max `filed_date`, include `missing_metrics`.
   - Cap `limit` at 50 (design.md).
   - CSV output: return `[EmbeddedResource(type="resource", resource=TextResourceContents(uri="xstockstrat:///data-explorer/fundamentals/<symbol>", mimeType="text/csv", text=csv_string))]`. Emit empty cells for metrics in `missing_metrics`.
   - JSON output: return dict with snapshot or historical data, `next_page_token` (historical only), `last_refreshed`, `missing_metrics`.
   - Wrap gRPC errors with `_grpc_error_message`.

2. Use `import csv; import io` for CSV generation (StringIO writer).

**Verification**:
```bash
cd services/xstockstrat-agent && ruff check . && ruff format --check .
```

---

### Step 8 — test: Test agent query_bars and query_fundamentals tools

**Status**: `pending`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/tests/test_query_tools.py` — create

**Reviewers**: Service owner (`xstockstrat-agent`) — MCP tool contract stability

**Codebase Evidence**:
- Existing pattern: agent tests mock gRPC stubs and call tool functions directly
- Confirmed: `test_tools_endpoint.py` exists for tool registration assertions

**TDD**: `red-green required`

**Covers**: `AC-5, AC-6, AC-7, AC-9, AC-13, AC-14, AC-18, AC-19, AC-21`

**Instructions**:
1. Create `tests/test_query_tools.py` with tests covering:
   - `query_bars` returns OHLCV bar objects with expected fields (AC-5).
   - `query_bars` respects max 1000 limit (AC-9).
   - `query_bars` includes `last_refreshed` from max bar time (AC-13).
   - `query_bars` with `format="csv"` returns `EmbeddedResource` with `mimeType="text/csv"` (AC-18).
   - `query_fundamentals` snapshot mode returns fundamentals with `last_refreshed` from `as_of` (AC-6, AC-14).
   - `query_fundamentals` historical mode returns periods list with pagination (AC-7, AC-21).
   - `query_fundamentals` with `format="csv"` returns `EmbeddedResource` with `mimeType="text/csv"` (AC-19).
   - `query_fundamentals` includes `missing_metrics` in response.
2. Mock `client.get_bars`, `client.get_fundamentals`, `client.get_historical_fundamentals` via `unittest.mock.patch`.
3. Single-consumer test data — inline literals are compliant (C-13).

**Verification**:
```bash
cd services/xstockstrat-agent && pytest tests/test_query_tools.py -v --cov=app --cov-fail-under=40
cd services/xstockstrat-agent && ruff check . && ruff format --check .
```

---

### Step 9 — docs: Update tool count and add tool reference sections

**Status**: `pending`
**Service**: `docs/runbooks/`
**Files**:
- `services/xstockstrat-agent/app/tools.py` — modify (docstring line 4)
- `services/xstockstrat-agent/CLAUDE.md` — modify (lines 43, 49)
- `docs/runbooks/mcp-tools.md` — modify (lines 3, 10, 45)
- `services/xstockstrat-ui/src/lib/copilot.ts` — modify (line 20)

**Reviewers**: none

**Codebase Evidence**:
- Confirmed via: `tools.py:4` — `"Forty-nine tools:"`
- Confirmed via: `tools.py:58` — `"the tool count stays forty-nine"`
- Confirmed via: `CLAUDE.md:43` — `"The agent registers forty-nine tools"`
- Confirmed via: `CLAUDE.md:49` — `"the tool count stays forty-nine"`
- Confirmed via: `mcp-tools.md:3` — `"forty-nine"` reference
- Confirmed via: `mcp-tools.md:10` — `"forty-nine"` reference
- Confirmed via: `mcp-tools.md:45` — `"forty-nine"` reference
- Confirmed via: `copilot.ts:20` — `export const COPILOT_MCP_TOOL_COUNT = 49;`

**TDD**: `N/A (docs — non-code-bearing)`

**Covers**: —

**Instructions**:
1. Update all 6 tool-count surfaces from "forty-nine" / 49 to "fifty-one" / 51:
   - `tools.py:4` — change `"Forty-nine tools:"` to `"Fifty-one tools:"`
   - `tools.py:58` — change `"the tool count stays forty-nine"` to `"the tool count stays fifty-one"`
   - `services/xstockstrat-agent/CLAUDE.md:43` — change `"forty-nine"` to `"fifty-one"`
   - `services/xstockstrat-agent/CLAUDE.md:49` — change `"forty-nine"` to `"fifty-one"`
   - `docs/runbooks/mcp-tools.md:3` — change `"forty-nine"` to `"fifty-one"`
   - `docs/runbooks/mcp-tools.md:10` — change `"forty-nine"` to `"fifty-one"`
   - `docs/runbooks/mcp-tools.md:45` — change `"forty-nine"` to `"fifty-one"`
   - `copilot.ts:20` — change `49` to `51`
2. Add `query_bars` and `query_fundamentals` entries to the tool table in `CLAUDE.md` (after the existing tool table).
3. Add full `### query_bars` and `### query_fundamentals` reference sections to `docs/runbooks/mcp-tools.md` following the existing section format (parameters, return shape, error cases).
4. Add `query_bars` and `query_fundamentals` to the `tools.py` module docstring tool list.

**Verification**:
```bash
cd services/xstockstrat-agent && ruff check . && ruff format --check .
cd services/xstockstrat-ui && pnpm run lint
grep -n "forty-nine\|forty-one\|COPILOT_MCP_TOOL_COUNT.*49" \
  services/xstockstrat-agent/app/tools.py \
  services/xstockstrat-agent/CLAUDE.md \
  docs/runbooks/mcp-tools.md \
  services/xstockstrat-ui/src/lib/copilot.ts
```
Must return zero matches (all instances updated). Lint gates added because this step modifies
source files (`tools.py`, `copilot.ts`).

---

### Step 10 — service: Wire getFundamentals, getHistoricalFundamentals, and listAssets in insights BFF

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/lib/insightsBff.ts` — modify

**Reviewers**: Service owner (`xstockstrat-ui`) — Connect-RPC call safety, analytics display accuracy

**Codebase Evidence**:
- Confirmed via: `insightsBff.ts:87-95` — MarketDataService block with `getBars: forward(...)` at line 88; `getFundamentals`, `getHistoricalFundamentals`, `listAssets` are NOT wired
- Existing pattern: `forward()` handler at `insightsBff.ts:88` — `getBars: forward((req, opts) => marketDataClient.getBars(req, opts))`
- Confirmed via: `traderBff.ts:74` — `listAssets` wired in trader BFF (reference pattern)
- Confirmed via: `traderBff.ts:76` — `getFundamentals` wired in trader BFF (reference pattern)
- Confirmed via: `src/lib/browserClients/insightsMarketDataClient.ts` — browser client exists, bound to `/insights/api`

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. In `insightsBff.ts`, inside the `MarketDataService` block (after the existing `getBars: forward(...)` at line ~88), add:
   - `getFundamentals: forward((req, opts) => marketDataClient.getFundamentals(req, opts)),`
   - `getHistoricalFundamentals: forward((req, opts) => marketDataClient.getHistoricalFundamentals(req, opts)),`
   - `listAssets: forward((req, opts) => marketDataClient.listAssets(req, opts)),`
2. These use the existing `forward()` pattern from `bffShared.ts` (1-arg callback signature per `bffShared.ts:60`) — session validation, header propagation, and dispatch are handled by the shared plumbing (no new outbound gRPC calls from custom code).

**Header propagation**: uses existing `forward()` from `bffShared.ts`, which already propagates `x-user-id`, `x-access-scope`, `x-trace-id` via `backendHeaders()`. No custom call path.

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm run lint
grep -n "getFundamentals\|getHistoricalFundamentals\|listAssets" src/lib/insightsBff.ts
```
Confirm all three handlers appear in the MarketDataService block.

---

### Step 11 — service: Create data-explorer page with OHLCV and Fundamentals tabs

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/app/insights/data-explorer/page.tsx` — create
- `services/xstockstrat-ui/src/hooks/useDataExplorer.ts` — create

**Reviewers**: Service owner (`xstockstrat-ui`) — analytics display accuracy, Connect-RPC call safety

**Codebase Evidence**:
- Existing pattern: `useInfiniteQuery` at `useOpportunities.ts:29-46` — `getNextPageParam` reads `nextPageToken`, `fetchNextPage`, `pages.flatMap()`
- Existing pattern: `Combobox` symbol selector at `ChartPanel.tsx:88-112` fed by `listAssets()`
- Existing pattern: `DataTable` with `enablePagination` at `data-table.tsx:81`
- Existing pattern: Recharts `ChartContainer`/`ChartConfig` at `EquityCurveChart.tsx:3`, `FormulaRunResult.tsx`
- Existing pattern: `EmptyState` at `EmptyState.tsx:7`, `QueryStateMessages` at `QueryStateMessages.tsx:2`
- Existing pattern: `protoTime` helpers at `protoTime.ts` — `timestampToDate`, `fmtShortDate`
- Existing pattern: CSV clipboard/download at `attribution/page.tsx:32-37` — `toCsv()` + `navigator.clipboard`
- Confirmed: Recharts v3 requires `xAxisId`/`yAxisId` on `CartesianGrid` (ledger insights.md 123)
- Confirmed: `missing_metrics` must use explicit check, not JavaScript truthiness (MARKETDATA-11)
- Confirmed: timeframe hardcoded to `1Day` (feature 143 constraint)
- Confirmed: `insightsMarketDataClient` browser client exists at `browserClients/insightsMarketDataClient.ts`

**TDD**: `red-green required`

**Covers**: —

**Instructions**:

Create `src/app/insights/data-explorer/page.tsx`:

1. **OHLCV tab**:
   - Symbol `Combobox` (reuse pattern from `ChartPanel.tsx:88-112`, fed by `listAssets()` via `insightsMarketDataClient`).
   - Date-range pickers (start/end date inputs).
   - Timeframe hardcoded to `1Day` (feature 143 — do not add a timeframe selector).
   - `useInfiniteQuery` keyed on `["data-explorer-bars", symbol, start, end]` calling `insightsMarketDataClient.getBars()`. `getNextPageParam` reads `page.nextPageToken`. "Load More" button calls `fetchNextPage`. `pages.flatMap(p => p.bars)` accumulates results.
   - `DataTable` with `enablePagination` for client-side table paging of accumulated data. Columns: time, open, high, low, close, volume.
   - Recharts `ChartContainer` price chart (close prices over time). Use `xAxisId`/`yAxisId` on `CartesianGrid` (Recharts v3).
   - Last-refresh: compute from max `bar.time` in accumulated pages, display via `protoTime.ts` helpers.
   - Empty state: `EmptyState` with message "No OHLCV data found for the selected criteria".
   - Loading/error: `QueryStateMessages` pattern.

2. **Fundamentals tab** (two sub-views):
   - **Snapshot sub-view**: call `insightsMarketDataClient.getFundamentals({symbol})`, render key metrics in a card. Display `as_of` as last-refresh timestamp. Show `stale` badge when `Fundamentals.stale` is true (mirror trader `FundamentalsSection` pattern, C-17).
   - **Historical sub-view**: period-type filter (quarterly/annual). `useInfiniteQuery` keyed on `["data-explorer-hist-fundamentals", symbol, periodTypes, start, end]` calling `insightsMarketDataClient.getHistoricalFundamentals()`. "Load More" button. `DataTable` for tabular view.
   - **`missing_metrics` handling**: map any metric named in `missing_metrics` to `null` before passing to Recharts (renders as gap); display `"—"` in table cells. Use explicit `missing_metrics.includes(metricName)` check (not JavaScript truthiness — MARKETDATA-11).
   - Recharts time-series line chart: metric-selector dropdown, x-axis = fiscal periods, y-axis = selected metric value. `CartesianGrid` with `xAxisId`/`yAxisId`.
   - Last-refresh: compute from max `filed_date` in accumulated pages.

3. **CSV download** (both tabs):
   - Client-side from accumulated `useInfiniteQuery` pages.
   - Build CSV string, create `Blob`, trigger download via `<a download>` link.
   - OHLCV filename: `{symbol}_{timeframe}_{start}_{end}.csv`.
   - Fundamentals filename: `{symbol}_fundamentals_{periodType}.csv`.
   - Emit empty cells for metrics in `missing_metrics` in CSV.

Create `src/hooks/useDataExplorer.ts` for shared query hooks if needed to keep the page file manageable.

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm run lint
```

---

### Step 12 — service: Register Data Explorer in PLATFORM_SUBNAV and NAV_GROUPS

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/components/shared/PlatformHeader.tsx` — modify
- `services/xstockstrat-ui/src/components/shared/navGroups.tsx` — modify

**Reviewers**: Service owner (`xstockstrat-ui`) — analytics display accuracy

**Codebase Evidence**:
- Confirmed via: `PlatformHeader.tsx:69-89` — `PLATFORM_SUBNAV` with insights entries at `:75-82` (Opportunities, Strategies, Formulas, P&L Patterns, Screener, Watchlists — no Data Explorer)
- Confirmed via: `navGroups.tsx:54-66` — `NAV_GROUPS` Engine group entries (no Data Explorer)

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. In `PlatformHeader.tsx`, add `{ label: 'Data Explorer', href: '/insights/data-explorer' }` to the `PLATFORM_SUBNAV.insights` array (after Watchlists or in a logical position among the insights entries).
2. In `navGroups.tsx`, add a `{ label: 'Data Explorer', href: '/insights/data-explorer' }` entry to the Engine group (the group containing the other insights analytical pages).
3. This satisfies C-10 (nav registration) and extends the existing `@AC-5` guarantee.

**Verification**:
```bash
grep -n "Data Explorer" \
  services/xstockstrat-ui/src/components/shared/PlatformHeader.tsx \
  services/xstockstrat-ui/src/components/shared/navGroups.tsx
```
Confirm "Data Explorer" appears in both files.

---

### Step 13 — test: E2E tests for data-explorer page

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/e2e/insights/data-explorer.spec.ts` — create
- `services/xstockstrat-ui/e2e/fixtures/historicalFundamentals.ts` — create
- `services/xstockstrat-ui/e2e/fixtures/INVENTORY.md` — modify
- `services/xstockstrat-ui/e2e/mock-backend.ts` — modify

**Reviewers**: Service owner (`xstockstrat-ui`) — analytics display accuracy

**Codebase Evidence**:
- Existing pattern: E2E at `e2e/insights/backfills.spec.ts` — `page.route()` stubs + `fulfillJson()` + `addAuthCookie`
- Existing fixture: `FUNDAMENTALS_AAPL` at `e2e/fixtures/fundamentals.ts`
- Existing bars fixture: inline in `e2e/mock-backend.ts`

**TDD**: `red-green required`

**Covers**: `AC-1, AC-2, AC-3, AC-4, AC-8, AC-11, AC-12, AC-15, AC-16, AC-17, AC-20, AC-22`

**Instructions**:
1. Create `e2e/fixtures/historicalFundamentals.ts` with test data for historical fundamentals periods (quarterly, including one period with `missing_metrics` containing `"pe_ratio"` for AC-22). Add catalog entry to `e2e/fixtures/INVENTORY.md` (C-12).
2. Add mock handlers to `e2e/mock-backend.ts` for `GetHistoricalFundamentals` (returning paginated fixture data) and ensure `GetBars` handler returns fixture data for the data-explorer symbol/range.
3. Create `e2e/insights/data-explorer.spec.ts` with test cases:
   - **AC-1**: Query OHLCV bars — verify table with columns time/open/high/low/close/volume and chart rendered.
   - **AC-2**: Empty OHLCV result — verify empty-state message.
   - **AC-3**: Fundamentals snapshot — verify snapshot card with pe_ratio, market_cap.
   - **AC-4**: Historical fundamentals — verify table rows for multiple periods.
   - **AC-8**: OHLCV pagination — verify "Load More" control, at most 500 bars per page.
   - **AC-11**: Last refresh OHLCV — verify "Last refreshed" timestamp displayed.
   - **AC-12**: Last refresh fundamentals — verify "Last refreshed" from as_of.
   - **AC-15**: Historical fundamentals chart — verify time-series line chart rendered with data points.
   - **AC-16**: CSV OHLCV export — verify download triggered with correct filename and CSV content.
   - **AC-17**: CSV fundamentals export — verify download triggered.
   - **AC-20**: Historical fundamentals pagination — verify "Load More", at most 50 periods per page.
   - **AC-22**: Missing metrics — verify `"—"` in table cell, gap in chart for the period with `pe_ratio` in `missing_metrics`.
4. Use `page.route()` stubs following the `backfills.spec.ts` pattern. Use `addAuthCookie` from `e2e/helpers/`.
5. Import fixtures from `e2e/fixtures/` (C-12 — no inline literals for domain data).

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm test:e2e -- --grep "data-explorer"
cd services/xstockstrat-ui && pnpm run lint
```

---

### Step 14 — test: E2E test for Data Explorer nav registration

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/e2e/insights/data-explorer.spec.ts` — modify (add nav test to existing spec)

**Reviewers**: Service owner (`xstockstrat-ui`) — analytics display accuracy

**Codebase Evidence**:
- Existing pattern: nav reachability assertions in other e2e specs

**TDD**: `red-green required`

**Covers**: `AC-10`

**Instructions**:
1. Add a test case to `e2e/insights/data-explorer.spec.ts` that:
   - Navigates to the insights segment.
   - Verifies a "Data Explorer" link is visible in the navigation sidebar.
   - Clicks the link and verifies the URL is `/insights/data-explorer`.
2. This covers AC-10 and extends the @AC-5 guarantee (existing nav entries remain reachable).

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm test:e2e -- --grep "Data Explorer.*nav"
```

---

## Deviation Log

_Populated by /sdd-execute as implementation proceeds._
