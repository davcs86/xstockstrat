# Context: phase-2-data-layer  (archived 2026-08-05)

**Feature**: ./feature.md
**Status**: launched — archived by /sdd-archiver; verbose specs pruned (recoverable via git history).

## Archive Synthesis — 2026-08-05 — /sdd-archiver

**What**: Shipped as two coupled bug fixes — `xstockstrat-trading` now parses and propagates broker fill price (`FilledAvgPrice`) into `order.filled`/`order.partially_filled` ledger events, and `xstockstrat-portfolio`'s `GetPnL` now computes `realized_pnl` from a two-pass ledger query (completed fills, then orphaned partial fills) instead of always returning zero. Scope grew twice mid-flight from an initially narrow "just fix realized_pnl" story.
**Why (irrecoverable rationale)**: The portfolio-only fix was worthless without the trading fix — user traced the always-zero `fill_price` to both brokers silently discarding it (context.md 2026-05-20, "scope expansion" session). Two-pass design exists specifically so partially-filled-then-canceled orders aren't silently dropped from P&L — an explicit user requirement ("i don't want the partially filled orders... to disappear silently"), not derivable from the spec text alone.
**Rejected alternatives**:
- Single-pass / `order.filled`-only P&L — lost because it silently drops partial-fill-then-cancel scenarios (context.md 2026-05-20 "partially-filled-then-canceled" session).
- WebSocket streaming (`StreamBars`/`StreamQuotes`) fix — lost because grep across all consumers found zero callers; deferred, not needed (context.md 2026-05-20 "Scope revision").
**Scars & gotchas**:
- Pass-1-before-Pass-2 ordering (ignoring chronological `recorded_at`) is only correct because Alpaca hard-rejects simultaneous opposite-side positions and IBKR defaults to netting mode; IBKR Hedged mode (portfolio-margin, opt-in) would break it silently — noted as an accepted risk, not enforced in code (implementation-spec.md Step 4/5, context.md 2026-05-20).
- `orderFillPayload.Mode` Go field name is `Mode` not `TradingMode` (json tag `trading_mode`) — a naming trap caught only by manual line-cite verification during impl-spec review (context.md 2026-05-20 "fill.Mode verification").
- Two distinct ledger event types (`order.filled` once vs `order.partially_filled` cumulative) look interchangeable but aren't — a spec-level mistake (assumed multiple `order.filled` per order) was caught and corrected only via codebase discovery (context.md 2026-05-20).
- **Unverified live risk (was about to be lost with implementation-spec.md deletion)**: the IBKR `GetOrder` fix hard-codes the fill-price JSON field as `avgPrice` (implementation-spec.md:109; shipped as `ibkr.go:281`) based on inferred IBKR Web API semantics, never confirmed against a live/sandbox IBKR endpoint. The step's own note flagged this as unverified ("if integration tests reveal the actual field name differs (e.g., avgFillPrice), update the JSON tag"), but `ibkr_test.go:99` only asserts against a hand-rolled mock that encodes whatever field name the test itself chooses — it cannot catch a wrong field name. A JSON tag mismatch here would silently zero-value `AvgPrice`, reproducing the exact bug class this feature was built to fix, specifically for IBKR fills. Not documented in context.md; shipped code reads as settled, not flagged — a future agent should treat IBKR fill-price parsing as unverified until checked against a real IBKR response.
**Permanent deviations**: none — final shipped algorithm matches the last-revised design (two-pass, signed accumulator).
**Cross-feature signal**:
- SourceRegistry (marketdata) was implemented directly inside this feature's session, bypassing `/sdd-story`→`/sdd-design`→`/sdd-spec` entirely — an explicit, self-flagged process deviation (context.md 2026-05-20 "scope expansion — skipped SDD flow").
- Feature 012 (`wire-fe-auth`) touched the same services concurrently; `/sdd-review` flagged merge-order risk but no FAIL (context.md 2026-05-20 review session).
**Deferred follow-ons**:
- Trader chart panel (Phase 5C, never built) is the real consumer that would justify revisiting `StreamBars`/`StreamQuotes` polling-vs-WebSocket tradeoff (context.md 2026-05-20 "Origin of StreamBars/StreamQuotes clarified").
- IBKR `avgPrice` field name should be confirmed against a live/sandbox integration test (see scar above); current unit test cannot expose a wrong field name.
**Ledger entries written**: insights.md (1), fails.md (2) — see the 2026-08-05 entries.
**Runtime-invariant recommendations (→ /context-constitution)**: - none (all scars above are feature-specific fill-processing logic, not general platform cross-module contracts)
**Pruned artifacts**: product-spec.md, implementation-spec.md — last present at f5abed5.
