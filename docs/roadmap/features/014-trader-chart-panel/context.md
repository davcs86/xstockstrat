# Context: trader-chart-panel

**Feature**: `docs/roadmap/features/014-trader-chart-panel/feature.md`
**Product Spec**: `docs/roadmap/features/014-trader-chart-panel/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/014-trader-chart-panel/implementation-spec.md`

---

## Session 2026-05-20T00:00:00Z — sdd-story

- Created feature.md (status: draft), product-spec.md, context.md from user story.
- Backend data path confirmed fully implemented: `GetBars` RPC, `MarketDataHandler`, `MarketDataService`, Alpaca REST client, `marketdata.ohlcv` hypertable.
- `StreamBars`/`StreamQuotes` exist in handler but have zero callers — polling `GetBars` chosen deliberately; streaming not needed at ≥5m timeframe.
- Origin of the missing chart panel: roadmap §5C specified it; `phase5-deviations.md` silently dropped it. Documented in `013-phase-2-data-layer/context.md`.
- Charting library recommendation: `lightweight-charts` (TradingView, MIT) — noted as open question pending user decision.
