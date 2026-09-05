# Context: watchlist-readiness-precompute

**Feature**: `docs/roadmap/features/180-watchlist-readiness-precompute/feature.md`
**Product Spec**: `docs/roadmap/features/180-watchlist-readiness-precompute/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/180-watchlist-readiness-precompute/implementation-spec.md`

---

## Session 2026-09-05 — sdd-story

- Created feature.md (status: draft), product-spec.md, acceptance.feature, context.md from user story.
- Origin: a diagnostic session traced the "watchlist loads slowly every time" symptom to the
  `AnalysisService.EvaluateReadiness` fan-out (not the watchlist fetch). Full trace recorded in the
  product spec § Diagnosis with file:line evidence.
- Core design question deferred to `/sdd-design` (deep): materialize readiness in the **existing live
  evaluation loop** vs. a **new dedicated readiness-materializer loop**, sized on performance for
  large symbols × strategies.
- Adjacent prior art to reconcile: feature 177 (readiness caching / 30s window), feature 176
  (analysis concurrency offload / bars-fetch semaphore).
- Ledger traps surfaced into Open Questions: feature 118 polling/recheck design (fails.md:804-847),
  feature 131 owner-scoping/IDOR (fails.md:1153), C-08 within-iteration lazy cache (insights.md:220-230),
  readiness-scoped-by-upstream-choice (insights.md:525), marketdata lock/pool budget under batch load
  (`docs/runbooks/ohlcv-lock-budget-tuning.md`, insights.md:180).
- Consumer surface (C-14): UI `/insights` (`/insights/watchlists`) — no new UI code expected; the
  existing `EvaluateReadiness` read benefits from the pre-warmed cache.
