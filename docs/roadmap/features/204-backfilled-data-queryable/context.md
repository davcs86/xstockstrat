# Context: backfilled-data-queryable

**Feature**: `docs/roadmap/features/204-backfilled-data-queryable/feature.md`
**Product Spec**: `docs/roadmap/features/204-backfilled-data-queryable/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/204-backfilled-data-queryable/implementation-spec.md`

---

## Session 2026-09-24T00:00:00Z — sdd-story

- Created feature.md (status: draft), product-spec.md, acceptance.feature, context.md from user story.
- **Key recon finding**: The backend query surface is already complete — `GetBars`, `BatchGetBars`, `GetFundamentals`, `GetFundamentalsMulti`, `GetHistoricalFundamentals` RPCs exist on `xstockstrat-marketdata` (proto lines 20-62). No new proto RPCs or DB schema changes needed.
- **Consumer surface gap**: No UI page or MCP agent tool currently exposes direct data querying. The insights segment has backfill management, screener, and performance pages but no data explorer. The agent has 49 tools, none for querying bars or fundamentals directly.
- **Ledger traps noted**: (1) Agent tool count asserted in 5+ doc surfaces — all must be updated (insights.md screener-agent-tool + trigger-backfill-mcp-tool). (2) Timeframe enum handling has been a recurring bug source (fails.md 080-fix-backfill-timeframe-enum). (3) TanStack Query useQuery dep arrays must key on `dataUpdatedAt`/`errorUpdatedAt`, not `data`/`error` (fails.md feature 154 insights-subnav-enhancement).

## Session 2026-09-24T00:01:00Z — sdd-story (amendment)

- Added FR-7: last refresh timestamp display on both UI and agent surfaces.
- Data sources for the timestamp: OHLCV → most recent bar's `time` in the result set; fundamentals snapshot → `fetched_at` column (already exists on `marketdata.fundamentals`); historical fundamentals → most recent `filed_date`.
- Added @AC-11 through @AC-14 acceptance scenarios covering last refresh timestamp in UI and agent tool responses.

## Session 2026-09-24T00:02:00Z — sdd-story (user decisions)

- **Pagination defaults accepted**: 500 bars/page UI, 1000 max agent tool. Open question closed.
- **Chart library confirmed**: Reuse Recharts (already in insights segment). Open question closed.
- **Fundamentals charting moved in-scope**: FR-2 updated to include time-series chart for historical fundamentals metrics (P/E, EPS, market cap over fiscal periods). Removed from Out of Scope.
- **Added FR-8**: UI CSV export — "Download CSV" button exports the currently displayed OHLCV or fundamentals results.
- **Added FR-9**: MCP binary CSV responses — `query_bars` and `query_fundamentals` accept `format` param (`json` | `csv`); when `csv`, return base64-encoded `text/csv` content instead of JSON text.
- Added @AC-15 through @AC-19 acceptance scenarios for fundamentals charting, UI CSV export, and MCP binary CSV output.

## Session 2026-09-24T00:03:00Z — sdd-review product-spec

- Product spec approved. Status: draft → spec-ready.
- Warnings:
  - Open Questions: "Known trap (ledger)" item remains unchecked — it is an implementation-time housekeeping action (update agent tool count across 5+ doc surfaces), not an unresolved design question. Carried into design/spec.
  - Fundamentals pagination: `GetHistoricalFundamentalsRequest` proto has no `PageRequest` field, but FR-5 requires pagination on both surfaces. Historical fundamentals volume is inherently small (quarterly/annual per symbol), so client-side pagination suffices — design phase should confirm explicitly.
- Overlap findings: none (CLEAN). No merge-order entry needed.

## Session 2026-09-24T00:04:00Z — user decision (proto pagination)

- **User decision**: Add proto-level pagination to `GetHistoricalFundamentals` rather than relying on client-side pagination. Resolves the sdd-review fundamentals pagination warning.
- **Proto changes** (additive, non-breaking):
  - `GetHistoricalFundamentalsRequest`: add `common.v1.PageRequest page = 6` (next free field number after existing fields 1–5)
  - `GetHistoricalFundamentalsResponse`: add `common.v1.PageResponse pagination = 2` (next free field number after existing field 1)
- **Service impact**: `xstockstrat-marketdata` handler + repo must implement cursor-based pagination in `QueryHistoricalFundamentals` (currently returns all matching rows unbounded at `marketdata_repo.go:583`).
- Updated product spec: Proto Contract Changes, Affected Services, Out of Scope sections.
- Added @AC-20, @AC-21 acceptance scenarios for historical fundamentals pagination (UI and agent).

## Session 2026-09-24T00:05:00Z — sdd-design

- Phase 0 Recon: wrote recon.md (services: xstockstrat-marketdata, xstockstrat-ui, xstockstrat-agent; key reuse patterns: `GetBars` cursor pagination at `marketdata_repo.go:85-122`, `useInfiniteQuery` at `useOpportunities.ts:29-46`).
- Phase 1 Grilling: 3 rounds (quick mode + 2 user-requested extra rounds). Chosen approach: single `/insights/data-explorer` page with OHLCV/Fundamentals tabs, 2 agent tools, composite cursor pagination for `GetHistoricalFundamentals`. Rejected: `fetched_at` proto field (user chose `as_of`), base64 CSV (EmbeddedResource + TextResourceContents), `period_end`-only cursor (not unique), server-side CSV route.
- Key decisions: (1) `as_of` field 14 for last-refresh instead of new `fetched_at` (user decision). (2) Composite cursor `(period_end, fiscal_period)` for uniqueness. (3) `filterAsOf` pushed into SQL before LIMIT. (4) Client-side CSV via `toCsv()` + Blob. (5) `useInfiniteQuery` for Load More (not custom accumulator). (6) Explicit `missing_metrics` check (not JavaScript truthiness, MARKETDATA-11).
- Acceptance scenarios updated: @AC-8/@AC-9 (1Day timeframe), @AC-12/@AC-14 (`as_of`), @AC-18/@AC-19 (EmbeddedResource), @AC-22 added (missing_metrics). Product-spec FR-7/FR-9 wording updated.
- Constitution rules touched: C-10, C-14, C-15, C-16, C-17, C-18, P-03. Floor breaches: none.
- Status: spec-ready → design-approved.

## Session 2026-09-24T00:06:00Z — sdd-spec

- Generated `implementation-spec.md` with 14 steps across 4 execution layers: (1) proto + codegen (Steps 1–2), (2) marketdata service pagination (Steps 3–4), (3) agent wiring + tools + docs (Steps 5–9), (4) UI BFF + page + nav + E2E (Steps 10–14).
- All 22 `@AC-*` scenarios covered: AC-1 through AC-4/AC-8/AC-11/AC-12/AC-15 through AC-17/AC-20/AC-22 in Step 13 (E2E); AC-5 through AC-7/AC-9/AC-13/AC-14/AC-18/AC-19/AC-21 in Step 8 (agent tests); AC-10 in Step 14 (nav E2E).
- Constitution gates satisfied: C-08 (test-step pairing for all service steps), C-14 (both consumer surfaces — UI Step 11 and Agent Steps 6–7), C-15 (full scenario coverage table).
- Tool count 49 → 51 update across all 6 surfaces deferred to Step 9 (docs step).
- Composite cursor `(period_end, fiscal_period)` implementation specified in Step 3 with `filterAsOf` pushed into SQL.
- Status: design-approved → implementation-ready.

## Session 2026-09-24T00:07:00Z — sdd-review impl-spec (advisory)

- Result: 2 failures, 2 warnings (advisory — did not block).
- Unresolved items carried into execution:
  - Step 8: test verification missing `--cov=app --cov-fail-under=40` coverage threshold (C-08/P-06) — [x] addressed — added `--cov=app --cov-fail-under=40` to pytest verification command
  - Step 10: Instructions use wrong `forward()` calling convention — 3-arg `forward(client, Service, 'method')` vs actual 1-arg callback `forward((req, opts) => client.method(req, opts))` (C-01) — [x] addressed — replaced all forward() calls with correct 1-arg callback pattern; fixed Codebase Evidence to match
  - Step 9: modifies source files (tools.py, copilot.ts) without lint verification in own step (advisory WARN) — [x] addressed — added ruff + pnpm lint gates to Step 9 Verification
  - Step 11: verbose instructions — justified by page scope (advisory WARN, C-18) — [x] accepted — verbose instructions justified by multi-tab page scope; no change needed
- Overlap findings: WARN-level file path collisions with features 196 (marketdata.proto, marketdata_repo.go), 205 (insightsBff.ts, client.py, tools.py, CLAUDE.md, mcp-tools.md), 187 (client.py, tools.py, mcp-tools.md), 188 (mock-backend.ts), 203 (INVENTORY.md, mock-backend.ts). No FAIL-level overlaps. No merge-order entry needed.

## Session 2026-09-24 — sdd-execute (sequential)

Feature 3 of the 202→205 run. Branch `feature/backfilled-data-queryable` off post-202 `main-dev`
(202's PR #1170 merged mid-run; the local `main-dev` ref was fast-forwarded so buf breaking evaluates
only 204's additive marketdata changes). Toolchain: host-native buf (Docker Hub still 429s the codegen
image base — retried at operator request, still limited), go1.27, golangci-lint v2.13.1@go1.27, uv/ruff,
node/pnpm. Docker daemon up but codegen stays host-native.

### Step 1 — proto: pagination on GetHistoricalFundamentals [done]
- Additive: `GetHistoricalFundamentalsRequest.page=6` (PageRequest), `GetHistoricalFundamentalsResponse.pagination=2`
  (PageResponse). `buf lint` clean; `buf breaking` against main-dev exit 0 (non-breaking).
- Files: `packages/proto/marketdata/v1/marketdata.proto`
- Deviations: none.

### Step 2 — proto-gen: regenerate stubs [done]
- Host-native `buf-gen.sh`. marketdata Go/TS/Python stubs carry `GetHistoricalFundamentalsRequest.Page`
  (field 6) + `GetHistoricalFundamentalsResponse.Pagination` (field 2). Reverted the recurring
  analysis.pb.go gofmt whitespace drift; diff scoped to `marketdata/v1`.
- Files: `packages/proto/gen/{go,python,ts}/marketdata/v1/**`
- Deviations: analysis.pb.go drift revert (recurring).

### Step 3 — service: cursor pagination in GetHistoricalFundamentals [done]
- Repo `QueryHistoricalFundamentals` now takes `(pageSize int, pageToken string)` and returns
  `([]…, nextToken string, error)`. Composite keyset cursor on `(period_end, fiscal_period)` with a
  STRICT `>` row-value comparison; overfetch `LIMIT pageSize+1`, nextToken = last returned row
  `"<period_end RFC3339Nano>|<fiscal_period>"`, default pageSize 50. `parseHistCursor` is lenient
  (malformed/empty token → resume from first page, QueryBars parity). `filed_date < asOf` stays pushed
  into SQL before LIMIT so the service `filterAsOf` never truncates a full page.
- Cursor-uniqueness proof (why `(period_end, fiscal_period)` is safe despite PK being
  `(symbol, fiscal_period, period_type)`): `edgar_client.go:buildPeriod` derives `fiscal_period`
  deterministically from `(fp, fy)` — quarterly → `"Qn-YYYY"` (period_type `quarterly`), annual →
  `"FYYYYY"` (period_type `annual`). So per symbol `fiscal_period` uniquely determines `period_type`;
  the same `fiscal_period` string never co-occurs with two `period_type`s, making `(period_end,
  fiscal_period)` unique per symbol. A shared `period_end` (FY2019 & Q4-2019, both 2019-12-31) stays
  distinguished by `fiscal_period`. No skip/dup at page boundaries.
- Service handler extracts page from `req.Page` (default 50) and returns
  `Pagination: &commonv1.PageResponse{NextPageToken: nextToken}`. `filterAsOf` retained as
  defense-in-depth (design.md).
- Test (Step 3): `TestGetHistoricalFundamentals_PagePassThrough` — asserts page-arg extraction +
  defaulting and nextToken surfacing; `fakeHistRepo` stub widened to the new signature (captures page
  args, echoes a preset token). Verify: service+repository packages `go test -race` green;
  golangci-lint v2.13.1@go1.27 → 0 issues.
- Files: `internal/repository/marketdata_repo.go`, `internal/service/marketdata_service.go`,
  `internal/service/marketdata_service_test.go`.
- Deviations: none.

### Step 4 — test: QueryHistoricalFundamentals pagination [done]
- Added to `internal/repository/marketdata_repo_test.go` (pgxmock, package-excluded from coverage):
  - `TestQueryHistoricalFundamentals_Pagination` — pageSize+1 overfetch → trim to pageSize, nextToken
    = LAST RETURNED row; page-2 cursor bound before LIMIT, remainder ≤ pageSize → empty token; empty
    token = first page (AC-20/AC-21).
  - `TestQueryHistoricalFundamentals_AsOfPushedIntoSQL` — `filed_date < $2` present BEFORE `LIMIT $3`
    (regex + arg pin), so a short page is never a post-LIMIT-filter artifact (AC-20).
  - `TestQueryHistoricalFundamentals_CompositeCursorSamePeriodEnd` — FY2019 & Q4-2019 share
    period_end; page-1 ends at FY2019, page-2 cursor binds fiscal_period "FY2019" (`$3`) and returns
    Q4-2019 — a period_end-only cursor would skip it, so this is the AC-21 red-green boundary pin.
  - `TestParseHistCursor` — RFC3339Nano|fiscal_period round-trip, split-on-first-`|`, lenient reject
    of ""/"no-separator"/bad-date.
- Consistent with the file's stated pgxmock philosophy (SQL-text + arg + control-flow pin, not a
  live-Postgres proof — same as the `::jsonb` test): ORDER BY / asOf-exclusion asserted as the SQL the
  repo *builds*; overfetch→trim→nextToken and the composite boundary driven through returned rows.
- Helpers `histMockCols` (reuses the production `histFundamentalsColumns` const so a column change
  tracks) + `histMockRow`. Verify: `go test ./internal/repository/... -race` green; golangci-lint 0 issues.
- Deviations: none.

### Step 5 — service: MARKETDATA_ENDPOINT in agent deployment [done]
- `client.py`: `MARKETDATA_ENDPOINT = os.environ.get("MARKETDATA_ENDPOINT", "xstockstrat-marketdata:50053")`.
- `docker-compose.yml` agent block: literal `xstockstrat-marketdata:50053`.
- `.do/app.dev.yaml` + `.do/app.yaml` agent blocks: **deviation from spec literal** — used the files'
  own `${xstockstrat-marketdata.PRIVATE_DOMAIN}:50053` interpolation (matching every sibling endpoint
  in those specs), not the raw `xstockstrat-marketdata:50053` string the step text showed. The spec's
  value was a simplification; the DO convention is authoritative.
- Verify: grep confirms the var in the agent block of all four files; ruff clean.
- Files: `services/xstockstrat-agent/app/client.py`, `docker-compose.yml`, `.do/app.dev.yaml`, `.do/app.yaml`.

### Step 6 — service: marketdata client methods on the agent [done]
- Added three async methods to `client.py` (new "marketdata client (feature 204)" section):
  - `get_bars(symbol, timeframe="1Day", start, end, limit, page_token)` — ephemeral channel to
    MARKETDATA_ENDPOINT, `GetBars` with canonical `timeframe`+`timeframe_enum` (daily-only, feature
    143) and PageRequest; returns `{bars[], next_page_token, total_count}` (each bar via MessageToDict
    preserving snake_case field names).
  - `get_fundamentals(symbol)` — `GetFundamentals`; returns the Fundamentals message as a dict.
  - `get_historical_fundamentals(symbol, period_types, start, end, limit, page_token)` — sets
    `page` (PageRequest) and optional `range_start`/`range_end`; returns `{periods[], next_page_token}`
    from the new `pagination` (PageResponse) field.
- All three propagate the caller trio via `_metadata()` (no body user_id — header-identity convention).
- Refactor: hoisted the shared `_TF_ALIASES`/`_TF_TO_ENUM` (daily-only map) above the marketdata
  section so both `get_bars` (reader) and `trigger_backfill` (writer) reference one definition instead
  of a forward-reference; comment updated to name both consumers.
- Verify: `python -m py_compile` OK; ruff check + format clean.
- Files: `services/xstockstrat-agent/app/client.py`. Deviations: none (the _TF_* hoist is a DRY tidy).

### Step 7 — service: query_bars + query_fundamentals MCP tools [done]
- Added two `@server.tool()`s in `tools.py`:
  - `query_bars(symbol, timeframe="1Day", start_date, end_date, limit=500, page_token, format)` —
    caps limit at 1000, calls `client.get_bars`, wraps AioRpcError via `_grpc_error_message`. JSON →
    `{bars, next_page_token, last_refreshed}` (last_refreshed = newest bar `time`); CSV → one
    `EmbeddedResource(text/csv)` (time,open,high,low,close,volume).
  - `query_fundamentals(symbol, mode="snapshot"|"historical", period_types, range_start, range_end,
    limit=50, page_token, format)` — snapshot: `get_fundamentals`, last_refreshed=`as_of`; historical:
    `get_historical_fundamentals` (limit capped 50), last_refreshed=max `filed_date`, `next_page_token`.
    `missing_metrics` is passed through from the proto field (authoritative — MARKETDATA-11), never
    inferred from truthiness; CSV blanks exactly those cells (per-period in historical).
- Module helpers: `_max_key`, `_csv_resource` (percent-quotes the symbol into the
  `xstockstrat:///data-explorer/…` URI, mirroring backtest_view's traversal guard), `_bars_to_csv`,
  `_snapshot_to_csv`, `_historical_to_csv`; consts `_QUERY_BARS_MAX_LIMIT`,
  `_QUERY_FUNDAMENTALS_MAX_LIMIT`, `_FUNDAMENTALS_METRICS` (the 11 shared numeric metrics).
- Companion edit (necessary, like the Step 3 stub): `tests/test_tools_endpoint.py`'s exact 49-name
  registration set gained `query_bars`/`query_fundamentals` (now 51) so the registration assertion
  stays green before the Step 9 count bump. Behavior tests are Step 8.
- Verify: ruff check + format clean; `test_tools_endpoint.py` + `test_list_correlation_parity.py`
  14 passed.
- Files: `services/xstockstrat-agent/app/tools.py`, `services/xstockstrat-agent/tests/test_tools_endpoint.py`.
- Deviations: none (the registration-test update is a required companion to adding the tools).

### Step 8 — test: agent query tool tests [done]
- New `tests/test_query_tools.py` (10 tests) — patches `client.get_bars`/`get_fundamentals`/
  `get_historical_fundamentals` (AsyncMock) and drives each tool's raw `.fn` (no ctx):
  - query_bars: bar fields present (AC-5), limit capped 1000 via `await_args.args[4]` (AC-9),
    last_refreshed = max bar time (AC-13), empty → null last_refreshed, CSV → one text/csv
    EmbeddedResource with the header row + quoted URI (AC-18).
  - query_fundamentals: snapshot last_refreshed = as_of + missing_metrics passthrough (AC-6/AC-14),
    historical periods + next_page_token + max filed_date + missing_metrics union + limit capped 50
    (AC-7/AC-21), CSV blanks the missing-metric cell and keeps a supplied one (AC-19), unknown mode
    → ValueError.
- Pydantic read-back nuance: `TextResourceContents` is constructed with the `mimeType` alias but read
  as `.mime_type` (snake_case field name) — asserted accordingly.
- **Verification deviation:** the spec's Step-8 command runs only `tests/test_query_tools.py` under
  `--cov=app --cov-fail-under=40`, which cannot reach 40% from one file. Ran the CI-equivalent full
  suite instead: `uv run pytest --cov=app --cov-fail-under=40` → **456 passed, 78.09% coverage**;
  `test_query_tools.py` alone → 10 passed; ruff check + format clean.
- Files: `services/xstockstrat-agent/tests/test_query_tools.py`. Deviations: verification-command
  interpretation above (full-suite coverage is the real gate CI runs).

### Step 9 — docs: tool-count bump + reference sections [done]
- Bumped all 6 tool-count surfaces forty-nine → fifty-one (and copilot.ts 49 → 51):
  tools.py:4/58, CLAUDE.md:43/49, mcp-tools.md:3/10/45, copilot.ts COPILOT_MCP_TOOL_COUNT.
- Added `query_bars`/`query_fundamentals` to: the tools.py module docstring tool list, the agent
  CLAUDE.md tool table, and full `### query_bars` / `### query_fundamentals` reference sections in
  mcp-tools.md (params, json+csv return shapes, error cases) — mirroring the existing section format.
- Verify: agent ruff check + format clean; full agent suite 456 passed (no doc-parity break);
  UI `pnpm run lint` exit 0 (pre-existing hook warnings only); zero `forty-nine`/`= 49` remain.
- Files: `services/xstockstrat-agent/app/tools.py`, `services/xstockstrat-agent/CLAUDE.md`,
  `docs/runbooks/mcp-tools.md`, `services/xstockstrat-ui/src/lib/copilot.ts`.

### Step 10 — service: insights BFF marketdata reads [done]
- Added three `forward()` handlers to the `MarketDataService` block in `insightsBff.ts`:
  `getFundamentals`, `getHistoricalFundamentals`, `listAssets` — the Data Explorer's browser client
  (`insightsMarketDataClient`, baseUrl `/insights/api`) reaches marketdata through them. Session/
  header propagation is `bffShared.ts`'s `forward` (no custom call path); public read data (no gate).
- Verify: `pnpm run lint` exit 0; grep confirms all three in the block.
- Files: `services/xstockstrat-ui/src/lib/insightsBff.ts`. Deviations: none.

### Step 11 — service: Data Explorer page + hooks [done]
- `src/hooks/useDataExplorer.ts`: `useAssetSymbols` (listAssets), `useBars`/`useHistoricalFundamentals`
  (`useInfiniteQuery`, pageSize 500/50 — AC-8/AC-20), `useSnapshotFundamentals` (`useQuery`);
  `FUNDAMENTAL_METRICS` (the 11 metrics with camelCase `key` + snake_case `name` for the missing check
  + label); `metricValue` (returns null when `missingMetrics.includes(name)` — MARKETDATA-11, explicit
  membership not truthiness); `barsToCsv`/`snapshotToCsv`/`historicalToCsv` (blank cell per missing
  metric); `latestBarMillis`/`latestFiledMillis`; `downloadCsv` (Blob + `<a download>`).
- `src/app/insights/data-explorer/page.tsx`: symbol Combobox (listAssets) + date-range inputs; Tabs
  OHLCV / Fundamentals. OHLCV: close-over-time LineChart + paginated DataTable (time/O/H/L/C/volume),
  Load-more, last-refreshed (max bar time), CSV. Fundamentals: Snapshot sub-view (metric grid, `Stale`
  badge, as_of refreshed, CSV) and Historical sub-view (period-type + metric selectors, metric-over-
  periods LineChart with `connectNulls={false}` for gaps, wide DataTable, Load-more, filed_date
  refreshed, CSV). Missing metrics render `—` in cells and a gap in the chart. Timeframe hardcoded
  `1Day` (feature 143 — no selector). AppShell (insights) so the Step 12 nav entry appears.
- Test hooks for Step 13: `data-explorer-page`, `de-bars-{chart,table,loadmore,refreshed,csv}`,
  `de-fund-{snapshot,refreshed,stale,csv}`, `de-hist-{chart,table,loadmore,refreshed,csv}`;
  `dd[data-metric]` cells; symbol combobox `aria-label="Data Explorer symbol"`.
- Verify: `npx tsc --noEmit` clean for both new files (2 unrelated pre-existing errors in
  backfills.spec.ts/middleware.test.ts, transpile-only in CI); `pnpm run lint` exit 0.
- Files: `src/hooks/useDataExplorer.ts`, `src/app/insights/data-explorer/page.tsx`. Deviations: none.

### Step 12 — service: nav registration [done]
- Added `{ label: 'Data Explorer', href: '/insights/data-explorer' }` to `PLATFORM_SUBNAV.insights`
  (after Watchlists) in PlatformHeader.tsx and to the `NAV_GROUPS` Engine group (after Performance)
  in navGroups.tsx — the shell/mobile nav both read the latter. Satisfies C-10; extends @AC-5.
- Verify: grep confirms both; entries match the existing item shape (tsc/lint clean via the Step 13
  e2e + build gate).
- Files: `src/components/shared/PlatformHeader.tsx`, `src/components/shared/navGroups.tsx`.

### Steps 13 & 14 — test: Data Explorer e2e + nav e2e [done]
- `e2e/fixtures/historicalFundamentals.ts` (new): Connect-JSON **wire** fixtures (RFC3339 timestamps,
  string int64, camelCase) for `page.route` — `DE_ASSETS_WIRE`, `DE_BARS_AAPL_PAGE1/_PAGE2`,
  `DE_BARS_EMPTY`, `DE_SNAPSHOT_AAPL`, `DE_HIST_AAPL_PAGE1/_PAGE2` (Q1-2024 omits `pe_ratio` for
  AC-22). INVENTORY.md catalog row added (C-12).
- `e2e/mock-backend.ts`: added a baseline `getHistoricalFundamentals` handler on the 9091 MarketData
  service (message-object form) so non-intercepted navigation (the nav test) works; the insights BFF
  dials `:9091` for marketdata.
- `e2e/insights/data-explorer.spec.ts` (new, Steps 13+14): 5 tests via `page.route` stubs (JSON
  transport confirmed) — AC-1/8/11/16 (OHLCV table+chart, Load-More ≤500/page, last-refresh, CSV
  download filename+header), AC-2 (empty state), AC-3/12/17 (snapshot card, as_of refresh, CSV),
  AC-4/15/20/22 (historical table+chart, Load-More ≤50/page, `—` for the pe_ratio-missing period),
  AC-10 (nav from the insights Section nav → `/insights/data-explorer`). The `caps` closure asserts
  the per-page request size cap. **6 passed (incl. warmup) in the CI-mode host harness.**
- Page tweak (testability, folded here): `data-explorer/page.tsx` auto-selects the first listed asset
  once it loads (ChartPanel precedent) so the page opens on real data and the e2e needs no combobox
  interaction. Small UX refinement to the Step 11 page.
- Key gotcha honored: Connect's JSON codec renders `google.protobuf.Timestamp` as an RFC3339 string on
  the wire (backtest-coverage.spec.ts note) — the wire fixtures use strings, parsed back to
  {seconds,nanos} by the browser client.
- Verify: `CI=1 pnpm test:e2e --grep "Data Explorer"` → 6 passed; tsc clean for all new files; lint 0.
- Deviations: none beyond the auto-select tweak (noted).

### Feature completion — code-completed + C-16 promotion + acceptance-fidelity reconciliation
- **C-16 promotion** (via the scenario-promoter subagent, verbatim from acceptance.feature): 2 new
  per-feature suites, every scenario tagged `@feature-204`:
  - `services/xstockstrat-ui/acceptance/backfilled-data-queryable.feature` — 13 scenarios (AC-1,2,3,4,
    8,10,11,12,15,16,17,20,22 — the Data Explorer page guarantees).
  - `services/xstockstrat-agent/acceptance/backfilled-data-queryable.feature` — 9 scenarios (AC-5,6,7,
    9,13,14,18,19,21 — the query_bars/query_fundamentals tool guarantees).
  - No marketdata suite: every `@AC-*` `Then` asserts a UI- or agent-observable subject; the repo
    cursor guarantee is unit-tested (Step 4), not an `@AC-*`. No DUP/OVERLAP/CONFLICT with existing
    suites.
- **Acceptance-fidelity reconciliation** (drift the verbatim promotion surfaced — fixed the code, not
  the reviewed contract):
  - AC-16: OHLCV CSV filename was `{symbol}_1Day_bars.csv`; the acceptance mandates
    `{symbol}_{timeframe}_{start}_{end}.csv`. Fixed `page.tsx` to build the range segment from the
    selected dates (`csvRangeTag`), and the e2e now sets a date range and asserts
    `AAPL_1Day_2025-01-01_2025-01-31.csv`.
  - AC-17: the acceptance's fundamentals CSV is the **historical** export
    `{symbol}_fundamentals_{periodType}.csv` (already implemented correctly); the e2e was retargeted
    from the snapshot CSV to the historical CSV (select Quarterly → `AAPL_fundamentals_quarterly.csv`).
    The snapshot CSV button is retained as a convenience beyond AC-16/AC-17 (noted, not an AC).
  - AC-11/AC-12: the "Last refreshed" display showed date-only; widened `fmtRefreshed` to
    `YYYY-MM-DD HH:MM UTC` so the shown timestamp matches the acceptance's full-ISO expectation.
- Verify (final): UI Data Explorer e2e 6/6 green (CI-mode host harness) after all three reconciliations.
- Branch note: `feature/backfilled-data-queryable` is based on post-202 main-dev; 203 merged after the
  branch point, so the integration PR merges post-203 main-dev in and resolves the expected
  INVENTORY.md / mock-backend.ts overlaps (203 added an Alerts row + markAlertRead mock; 204 added a
  Data Explorer row + getHistoricalFundamentals) — keep both.
