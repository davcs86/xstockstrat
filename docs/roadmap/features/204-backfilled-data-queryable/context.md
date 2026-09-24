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
