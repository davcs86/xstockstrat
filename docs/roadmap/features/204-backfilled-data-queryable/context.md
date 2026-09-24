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
