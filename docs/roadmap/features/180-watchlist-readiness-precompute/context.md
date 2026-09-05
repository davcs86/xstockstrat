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

## Session 2026-09-05 — sdd-review product-spec

- Product spec approved. Status: draft → spec-ready.
- Verdict: PASS WITH WARNINGS (spec-reviewer). No blockers, no Floor breach.
- Warnings: (1) Open Questions has 6 unchecked items — deferred by design to /sdd-design, not a
  gate blocker; (2) if /sdd-design adds an additive portfolio binding-read RPC, flag its owner-level
  approval gate then; (3) fixed evidence-drift nit — `_READINESS_LOOKBACK` → `_READINESS_LOOKBACK_DAYS = 400`
  at servicer.py:249.
- Overlap findings: CLEAN — no duplicate config key, proto field, or migration NNN. BUT a hard
  build-order dependency exists: 180 reuses `analysis.readiness_cache` (migration 022, feature 177)
  and the restructured `EvaluateReadiness`/bars-fetch bound (feature 176). Both are code-completed,
  not launched. Recommended merge sequence: 176 → 177 → 180. No merge-order.md row for 180 yet —
  add one at design/spec time. Next free analysis migration NNN is 024 (022, 023 taken by 177).

## Session 2026-09-05 — sdd-design (Phase 1 grilling, Round 1 + operator reframe)

- Recon written; Round 1 proposer proposed **Option B** (dedicated `run_readiness_materializer_forever`
  loop mirroring `run_opportunity_refresh_forever`) + new gated `ListAllWatchlistBindings` portfolio
  RPC + shared-helper refactor of the SLOW `_readiness_for` body for byte-identity.
- Round 1 adversary verdict **NEEDS WORK** (no Floor breach, no C-16 regression as written): the
  30s `valid_until` window makes background *verdict* pre-warm unable to fix the cold large-watchlist
  first-load (can't refresh P pairs per rolling 30s under `_bars_fetch_sem`=2); reusing
  `_bars_fetch_sem` re-creates the feature-176 priority inversion; `interval 60 > stale_after 30` is
  self-contradictory; owner-scoping must hash the binding-owner's DB strategy row (fails.md:1153).
- **Operator injected two direction-changing requirements** (recorded as FR-6, FR-7):
  1. Watchlists bind **live strategies only** → warm-set = live-strategy universe the live loop
     already enumerates per owner ⇒ **Option A (inside live loop) regains viability**; the new
     cross-user RPC may be unnecessary. Non-live binding = bug, out of scope here.
  2. **1-day bars only; 30s poll is for stock-list freshness, not readiness** ⇒ readiness changes
     only at daily bar close / definition change ⇒ a materialized row can carry a **bar-close-aligned
     `valid_until`**, dissolving the "refresh every 30s" wall. Must reconcile with feature 177 `@AC-2`
     (intraday 1d-bar OHLC bust) — the key C-16 boundary for Round 2.
- Warm-set scope (live-loop enumeration vs new RPC) deferred to Round 2 by the operator.
