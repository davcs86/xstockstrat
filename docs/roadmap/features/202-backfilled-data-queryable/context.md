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
