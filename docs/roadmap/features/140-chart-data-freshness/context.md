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

## Session 2026-08-18 — sdd-design (2 rounds, quick→upgraded)

- Phase 0 Recon: wrote recon.md (services: marketdata, ui, analysis). Key reuse patterns: ChartPanel's
  generic poll effect, `InsertBars` upsert, `timeframe.Interval`, `fetchAndCacheBars`.
- OQ-1 resolved by the cross-service GetBars-timeframe audit: **no automated consumer reads stored
  `15m`** (all programmatic callers hardcode `1d`), so flipping the always-on ingester `15m→1d` stales
  no consumer. Safe.
- Phase 1 Grilling: 2 rounds. Round 1 corrected FR-3 (newest via a real MAX, not page-1-last), kept the
  time cooldown (rejected the value-guard that deadlocks on a paused ingester), moved FR-6 WARN to call
  sites (not the frozen evaluator), and tuned FR-2 to 4-day lookback / 5-min interval.
- **Round 2 surfaced the actual ROOT CAUSE (FR-7):** `QueryBars` returns the OLDEST page of an
  oversized implicit window (`ORDER BY time ASC` from `start`, `marketdata_repo.go:78,90`), so charts
  (and the screener) render months-old bars regardless of ingestion freshness. Verified in code + blast
  radius (UI charts + screener broken; live loop + backtest OK). User chose to **fold FR-7 in as the
  primary fix**. FR-3 simplified: with FR-7 returning the newest page, `bars[len-1]` is the true newest,
  so no `GetCoverage` call is needed.
- Constitution rules touched: F-01/F-06/F-07/C-05/C-08/C-10(b)/C-14/P-03/P-05. Floor breaches: none.
- Build order: FR-7 → FR-2 → FR-3 → FR-1 → FR-6. Status: draft → design-approved.

## Open Threads

- Config-store verification for FR-2 (`SELECT … LIKE 'marketdata.stream.bar_ingest%'` in dev + prod) — FR-2 step.
- Screener first-scan latency from FR-3 within the 120s deadline — FR-3 step.
- FR-3 intentionally dead for the live loop (explicit `end`) — document at FR-3 step.
- `_compute_opportunities` empty branch stays silent by design (flood avoidance) — FR-6 step.

## Session 2026-08-19 (status reconciliation)

- Feature was stalled at `code-completed` though its code is in production.
- Root cause: `ci-validate-feature-status.yml` only flips a feature to `launched` when a
  commit in the promotion delta matches the feature *slug* via `git log --grep`; this feature's
  merge commit message did not contain the slug, so the automation skipped it.
- Verified in production: main == main-dev @ 1d97c6c78caa532a24265dae2fa79c674b3b69dd. Merge reference: PR #981.
- Status updated: `code-completed` → `launched`; Launched date: 2026-08-19.
