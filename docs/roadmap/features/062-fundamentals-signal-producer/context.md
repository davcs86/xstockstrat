# Context: fundamentals-signal-producer

**Feature**: `docs/roadmap/features/062-fundamentals-signal-producer/feature.md`
**Product Spec**: `docs/roadmap/features/062-fundamentals-signal-producer/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/062-fundamentals-signal-producer/implementation-spec.md`

---

## Session 2026-06-26 — sdd-story

- Created feature.md (status: draft), product-spec.md, context.md. Feature 5 of 6.
- Idea origin: a "fundamentals signal" — derive a buy/sell/hold from a fundamental score and ingest it
  as an `ExternalSignal` from a `fundamentals` source, so it flows through backtest signal-weighting,
  the screener, alerting, and source-weighting with no new consumers. Complementary to the direct
  screener criteria (060), not a replacement.
- **FMP free-tier discipline is the backbone**: the producer NEVER calls FMP directly — all reads go
  through marketdata's cached `GetFundamentalsMulti`. On top it adds universe dedup, paced/resumable
  fetching, a soft budget reservation (200 of 250, leaving 50 for the interactive screener), and
  idempotent emit (UNIQUE symbol+source+as_of_date) so re-runs spend nothing.
- Forward-test property: even without historical fundamentals (deferred in 059), running the producer
  daily accumulates a clean point-in-time signal history going forward — no look-ahead.
