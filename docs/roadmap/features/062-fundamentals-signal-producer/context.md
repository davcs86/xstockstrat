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

## Session 2026-06-26 — sdd-review product-spec

- Product spec reviewed (spec-reviewer + feature-overlap subagents). Status: draft → spec-ready.
- Verdict: PASS / overlap WARN-class only (no hard FAIL-level collision today). No blockers. Claims
  verified: analysis has a reusable config-driven interval loop (`app/engine/live_loop.py`), uses asyncpg
  (`app/main.py`), migrations dir at 001–002; ingest exposes `IngestSignal`/`QuerySignals`/`ManageSignalSource`;
  `analysis.signals.source_weights` exists; `RunFundamentalsScan` is additive to analysis.proto; DB pool stays
  at 2; analysis→ingest write edge is via RPC (gRPC-only rule honored). Budget design (200 of 250) coherent.
- Spec fixes applied:
  1. Pinned the new migrations as `003_fundsignal_runs` / `004_fundsignal_emitted` with up+down pairs
     (next free after 001/002).
  2. Cosmetic: "analysis pgxpool" → "analysis's existing asyncpg pool" (analysis is Python, not Go).
- Cross-feature items to RE-CHECK at /sdd-review impl-spec (advisory, not blocking now):
  * analysis.proto: 060 (`ScreenSymbols`) and 062 (`RunFundamentalsScan`) both extend the same file —
    coordinate new message field numbers + append order at impl-spec.
  * config namespace: 063 MAY add `analysis.fundsignal.value_weight`/`quality_weight` into 062's namespace.
    No duplicate key exists today (062 declares neither). Becomes a FAIL only if 063 materializes them as
    config keys rather than formula params — coordinate at 063's impl-spec so only one feature owns them.
- merge-order.md already sequences 059 + 063 ahead of 062 (lines 38–39).
