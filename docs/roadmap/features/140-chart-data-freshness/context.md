# Context: chart-data-freshness

**Feature**: `docs/roadmap/features/140-chart-data-freshness/feature.md`
**Product Spec**: `docs/roadmap/features/140-chart-data-freshness/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/140-chart-data-freshness/implementation-spec.md`

---

## Session 2026-08-18 — sdd-story

- Created feature.md (status: draft), product-spec.md, context.md from user story.
- Origin: user reported daily charts show months-old candles while the header "last price" is fresh,
  and asked whether OHLCV is "pulled every 24h." Investigation (two Explore traces) established the
  real cause is **three stacked gaps**, none of which is a 24h pull:
  1. UI daily view never auto-refreshes (`ChartPanel.tsx:22-26`; `positions/[symbol]/page.tsx:149-206`).
  2. Always-on ingester refreshes only `15m` bars (`marketdata_service.go:483-585`).
  3. `GetBars` live-fallback fires only on an empty DB (`marketdata_service.go:176-178`).
- User decision: run SDD flow (`/sdd-story` → `/sdd-design quick`) and **implement all three fixes**,
  with the explicit constraint: **1Day timeframe only — do not pull any other timeframe (no 15m/1h).**
- The 1d-only constraint forces OQ-1 (flip the single ingester timeframe `15m → 1d` vs. keep 15m +
  add 1d). Design Phase 0 recon must establish whether any live consumer depends on continuously
  refreshed `15m` bars before choosing; if one exists, gate with the user.

## Session 2026-08-18 — scope expansion (mid-design)

- User interrupted the design flow to ask why `xstockstrat-analysis` never logs missing bar data.
  An Explore trace established: log level is fine (`app/main.py:23` = INFO), but only the **backtest**
  path logs missing bars (`servicer.py:497`, `:792`, `:1026`). Every steady-state path swallows
  empty/insufficient bars **silently and by design**: live loop (`live_loop.py:439-441`), shared
  evaluator (`evaluator.py:136-137`, `:197-198`), `EvaluateReadiness` empty branch
  (`servicer.py:2114-2117`), screener (`screener.py:211-219`). Analysis never calls `GetDataCoverage`;
  gaps surface only as **RPC response fields** (coverage_gaps / INSUFFICIENT_DATA / no_trade_reason)
  the UI reads — never a runtime log line.
- User chose (AskUserQuestion) to **fold this into feature 140** as the observability half of the same
  trust problem. Added FR-6 (WARN logging on the silent branches, rate-safe), acceptance criterion 7,
  OQ-4 (log shape / rate-safety / log-only-vs-notify), and `xstockstrat-analysis` as a third affected
  service. Response-field behavior stays unchanged — FR-6 only adds log visibility.
- Design Phase 0 recon therefore now covers three services: marketdata, ui, analysis.
