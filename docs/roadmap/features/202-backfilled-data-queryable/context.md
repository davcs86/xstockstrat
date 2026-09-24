# Context: backfilled-data-queryable

**Feature**: `docs/roadmap/features/202-backfilled-data-queryable/feature.md`
**Product Spec**: `docs/roadmap/features/202-backfilled-data-queryable/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/202-backfilled-data-queryable/implementation-spec.md`

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
