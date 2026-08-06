# Context: trader-chart-panel  (archived 2026-08-05)

**Feature**: ./feature.md
**Status**: launched — archived by /sdd-archiver; verbose specs pruned (recoverable via git history).

## Archive Synthesis — 2026-08-05 — /sdd-archiver

**What**: A read-only OHLCV candlestick panel was added to `xstockstrat-trader` (pre-UI-consolidation service) using `lightweight-charts`, polling the already-live `GetBars`/`ListAssets` RPCs through a new `/api/chart` proxy route — no backend or proto work needed since Phase 5 had silently dropped this panel from roadmap §5C (context.md L14, session 2026-05-20 sdd-story).
**Why (irrecoverable rationale)**: Polling (not `StreamBars`) was deliberately chosen because the minimum timeframe is 5m, making streaming unnecessary overhead (context.md L13). `lightweight-charts` and "default symbol = first `ListAssets` result" were explicit user decisions, not derived from any spec document (context.md L15-16).
**Rejected alternatives**:
- `StreamBars`/`StreamQuotes` gRPC streaming — exists in the handler with zero callers; rejected because ≥5m timeframe doesn't need real-time push (context.md L13).
- lightweight-charts v5 API (`chart.addSeries(CandlestickSeries, …)`) — lost because the actually-installed version was v4.2.3, which only exports `addCandlestickSeries()`; v5's `CandlestickSeries` export doesn't exist there (implementation-spec.md L672, Deviation Log).
**Scars & gotchas**:
- Spec was written against a *newer* library API (v5) than what `pnpm install` actually resolved (v4.2.3) — the discrepancy was caught only during Step 4 execution, not at design/spec time (implementation-spec.md L462, L672).
- `playwright.config.ts`'s `webServer.env` needed `MARKETDATA_HTTP_ENDPOINT` added alongside `mock-backend.ts`, but the impl-spec review (Session sdd-review impl-spec, context.md L38-42) only caught the mock-backend gap — the config-file companion gap surfaced during Step 5 execution instead (context.md L95).
**Permanent deviations**:
- design said timeframes `1m/5m/15m/1h/1d` -> shipped `10Min/30Min/1Hour/1Day/1Week/1Month` -> because user requested Alpaca-native timeframe strings, verified against `integration-test.sh` (implementation-spec.md L672).
- design said uniform 30s poll for all intraday -> shipped per-timeframe intervals (10Min→120s, 30Min→300s, 1Hour→900s; daily+ no auto-poll) -> because a fixed 30s interval didn't match the wider timeframe set actually shipped (implementation-spec.md L672).
- design included a session toggle discussion -> shipped with it omitted entirely -> because `GetBarsRequest` proto has no `session`/`extended_hours` field; backlogged as feature `017-premarket-aftermarket-session-toggle` (context.md L99-104).
**Cross-feature signal**: - This feature targeted the standalone `xstockstrat-trader` service, predating the later UI-consolidation into `xstockstrat-ui` (`/trader` segment) — a naming/architecture shift not evident from this feature's own artifacts.
**Deferred follow-ons**:
- Feature idea `017-premarket-aftermarket-session-toggle` — blocked on adding a `session`/`extended_hours` field to `GetBarsRequest` proto (context.md L99-104).
- Poll interval hardcoding flagged as a candidate for a future config key (product-spec.md L45).
**Ledger entries written**: insights.md (1), fails.md (1) — see the 2026-08-05 entries.
**Runtime-invariant recommendations (→ /context-constitution)**: - none
**Pruned artifacts**: product-spec.md, implementation-spec.md — last present at 33ff5dc.
