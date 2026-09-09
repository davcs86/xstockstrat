# Context: opportunities-latency-fix

**Feature**: `docs/roadmap/features/183-opportunities-latency-fix/feature.md`
**Product Spec**: `docs/roadmap/features/183-opportunities-latency-fix/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/183-opportunities-latency-fix/implementation-spec.md`

---

## Session 2026-09-08 — sdd-story

- Created feature.md (status: draft), product-spec.md, acceptance.feature, context.md from user story.
- Root cause analysis performed via DigitalOcean runtime logs: identified 6 bottlenecks (P0–P5) in the ListOpportunities call chain.
- Ledger scan: feature 141 (semaphore sizing to downstream capacity) directly relevant — batch RPCs eliminate the per-symbol fan-out entirely, and the Go batch handler must use `WHERE symbol = ANY($1)` single-query pattern (not per-symbol goroutine fan-out) to respect the pool budget.

## Session 2026-09-09 — sdd-design

- Phase 0 Recon: wrote recon.md (services: packages/proto, xstockstrat-marketdata, xstockstrat-analysis, xstockstrat-ui; key reuse patterns: GetLatestQuotesBatch single-query template, MultiSymbolSource.GetBarsMulti interface).
- Phase 1 Grilling: 4 rounds (full). Chosen approach: 8-step additive batch RPCs (LATERAL JOIN BatchGetBars, ROW_NUMBER BatchGetLatestPrice) + Phase 0 asyncio.gather + TTL 10→20 + BFF per-call timeoutMs. Rejected: streaming BatchGetBars (unnecessary complexity), flat ANY without per-symbol LIMIT (unbounded rows), raise sem 2→5 (insufficient).
- Constitution rules touched: C-04, C-08, C-11, C-14, C-16, F-01, F-04, F-11, P-03, P-05. Floor breaches: none.
- Status: draft → design-approved.

## Decisions

- **LATERAL JOIN over ROW_NUMBER for BatchGetBars** — LATERAL pushes per-symbol LIMIT into the index scan, avoids materializing all rows; ROW_NUMBER reserved for BatchGetLatestPrice (prev close) where only 1 row/symbol is needed.
- **`timeframe = "1d"` enforcement** — BatchGetBars rejects non-daily timeframes to avoid combinatorial lock-budget risk; only consumer (analysis Phase 1) uses daily bars exclusively.
- **TTL 20s (not 15s)** — React Query v5 counts refetchInterval from completion, not start; 20s provides margin over 15s poll + ~5s response time.
- **Type-assert fallback for GetLatestTradesMulti** — Alpaca source may not implement the multi-trade interface; runtime type-assert with per-symbol fallback preserves non-Alpaca compatibility.
- **8 MB gRPC receive limit** — worst case 100 symbols × 400 bars × ~80 bytes ≈ 3.2 MB; 8 MB provides 2.5× headroom over default 4 MB.
- **`now_utc` captured AFTER `asyncio.gather`** — prevents timestamp staleness equal to the duration of the slowest drain.
- **Enrichment batch try/except with per-symbol fallback** — preserves @AC-11 (omit-not-fabricate) when batch transport fails.
- **C-16 CHANGE sign-off**: `@AC-5 @FR-4 @feature-177` TTL default raised 10→20s; guarantee shape preserved, only threshold changes.

## Open Threads

- [ ] EXPLAIN ANALYZE the LATERAL JOIN on staging with ~100 symbols, 400-day range — target: /sdd-spec Step 2.
- [ ] Verify Alpaca multi-symbol trades endpoint exists and its rate limits — target: /sdd-spec Step 3.
- [ ] Verify Connect-es `CallOptions.timeoutMs` emits `DeadlineExceeded` status code — target: /sdd-spec Step 8.
