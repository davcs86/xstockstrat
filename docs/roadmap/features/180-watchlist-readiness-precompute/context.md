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

## Session 2026-09-05 — sdd-design (Phase 1 grilling, Round 2 + approval)

- Round 2 proposer pivoted to **Option A** (materialize inside the live loop, reuse in-hand bars).
- Round 2 adversary (code-verified, re-grepped) returned **NEEDS WORK** and demolished Option A's
  premise: the live loop fetches each live strategy's *resolved universe* (`allowlist OR
  (watchlist ∪ held ∪ signals) − denied`, live_loop.py:103-105), NOT the watchlist-bound pair set →
  allowlist-override live strategies get 0% binding coverage; injecting readiness into the serial
  `_eval_pair` (live_loop.py:341-347) is an FR-4 alert-latency regression; 365→400 lookup unify and
  benchmark-loader divergence break byte-identity. Also: the bar_epoch-blind FAST gate + a long
  materialized valid_until would regress @AC-2.
- **Operator decisions at the gate:** (1) **Approve Option B** (dedicated materializer loop);
  (2) **@AC-2 fix = bar_epoch-aware FAST gate**, "well modularized, not spaghetti code".
- design.md written. Chosen approach:
  - Dedicated `run_readiness_materializer_forever` loop (DurableSchedule template servicer.py:3780),
    OWN semaphore `analysis.readiness_materializer.max_concurrent_bars_fetches` (fixes feature-176
    priority inversion), skip-fresh gate (fails.md:118), shared asyncpg pool (F-06).
  - **Modularization mandate:** one shared `ReadinessComputer` (extract SLOW body servicer.py:2786-2818,
    DRY, guarantees byte-identity), one pure `is_readiness_row_fresh(...)` freshness predicate
    (the @AC-2 bar_epoch logic in ONE unit-tested function, called by both lazy + materialized reads →
    single freshness semantic, no two-policy-per-table trap), loop = orchestration only,
    `readiness_valid_until` helper isolated.
  - Warm-set sourced with NO new cross-user RPC: enumerate live-strategy owners locally
    (analysis.strategies WHERE live_enabled) + reuse live loop's owner-scoped `_drain_watchlist`
    (live_loop.py:483) → owner-scoped by construction (kills fails.md:1153 IDOR surface).
  - No proto, no migration. Config: analysis.readiness_materializer.{enabled(false),
    valid_window_hours(24), max_concurrent_bars_fetches(2)}.
- Open risks carried (design.md): R1 rescope FR-1 to eventually-consistent (at /sdd-spec);
  R2 latest_bar_epoch lookup must be cheap+memoized (C-08); R3 shared FAST-gate change must keep
  177 @AC-1/@AC-2 green (RED tests first at execute); R4 merge order 176→177→180 (merge-order row
  added); R5 enforcing the live-only-binding invariant is a separate follow-up, not this feature.
- Status: spec-ready → design-approved. Next: /sdd-spec.

## Session 2026-09-05 — sdd-review product-spec (advisory re-review, post-design)

- Ran an ADVISORY product-spec re-review via spec-reviewer (not the full /sdd-review gate, which would
  have regressed status design-approved → spec-ready on PASS). Purpose: confirm the 3 prior warnings
  are cleared and catch residuals from the design-phase spec edits.
- Prior 3 warnings: ALL CLEARED (Open Questions resolved; no new portfolio RPC / no proto/DB gate;
  _READINESS_LOOKBACK_DAYS=400 nit fixed).
- Residual warnings found and FIXED this session:
  1. C-15 coverage — FR-6/FR-7 had no acceptance scenarios → added @AC-6 (non-live binding not
     materialized) and @AC-7 (new daily bar busts materialized row; intraday drift does not).
  2. @AC-4 cited the pre-decision key `analysis.opportunity.max_concurrent_bars_fetches` → repointed
     to the materializer's own `analysis.readiness_materializer.max_concurrent_bars_fetches` + asserts
     the semaphore is separate (feature-176 priority-inversion guard).
  3. FR-3 said "refresh cadence operator-tunable via config" but no cadence key ships → reworded:
     freshness = bar_epoch gate (authoritative) + valid_window_hours backstop; loop cadence is not a
     new config axis. FR-7 valid_until wording aligned to the valid_window_hours backstop framing.
- Result: PASS, no Floor breach, no residual warnings. Proceeding to /sdd-spec.

## Session 2026-09-05 — sdd-spec

- Generated implementation-spec.md with 7 steps (3 service + 3 paired test + 1 config).
  Status: design-approved → implementation-ready. Every `@AC-1..7` scenario is mapped to a covering
  step (see § Scenario Coverage). No proto, no DB migration, no config seed migration.
- Two design-underspecified points surfaced (not silently resolved — P-03), recorded as spec Open
  design points D-1..D-3 for /sdd-review impl-spec / operator sign-off:
  - **D-1 (design.md correction):** design.md § Warm-set sourcing says to reuse
    `live_loop._drain_watchlist` for `(strategy_id → symbols)` bindings, but that method
    (`live_loop.py:467-496`, esp. :490) **collapses every binding to its bare symbol and discards
    `strategy_id`** — the live loop applies each live strategy's `resolve_universe` to the whole
    watchlist symbol set. The materializer's target read-set is the overlay's actual `(symbol,
    strategy_id)` bindings (`WatchlistReadiness.tsx:183` `bound = bindings.filter(b => b.strategyId)`).
    Step 5 therefore adds a NEW binding-aware drain `_drain_watchlist_bindings`, not a reuse. To be
    recorded in the Deviation Log at execute.
  - **D-2 (cadence):** design says "no new config axis" but component #3 says "DurableSchedule interval
    mode" (which needs an interval value). Resolved in-spec to **wall-clock mode reusing the existing
    `analysis.opportunity.refresh_hour_utc`** (daily re-warm after close, aligns with FR-7, no new
    key). Flagged for review vs. adding a dedicated anchor key.
  - **D-3 (R2 cost):** the `bar_epoch`-aware FAST gate needs a cheap per-symbol `latest_bar_epoch`;
    grounded source is `MarketDataService.GetDataCoverage(...).latest` (`marketdata.proto:32,149-158`)
    — a `MAX(time)` metadata read, memoized per request/cycle and filled before the per-symbol loop
    (C-08). Replaces the 400-day pull, but is a per-symbol RPC on every overlay poll — flagged for
    review sign-off. Benchmark epochs make a stamped row `>= symbol_latest`, so the gate never falsely
    busts; the benchmark-newer-bar edge self-heals at the symbol's next daily bar (acceptable on 1d bars).
- Key codebase findings (grounded evidence):
  - EvaluateReadiness SLOW body to extract: `servicer.py:2786-2818`; FAST-gate inline predicate at
    `servicer.py:2780`; `asyncio.gather` at `:2821` (memo must precede it — C-08).
  - Loop template `run_opportunity_refresh_forever` at `servicer.py:3780`; own-semaphore precedent
    `servicer.py:395-403`; main.py `create_task` wiring at `main.py:175`.
  - `StrategiesRepository.list_live_enabled(user_id=None)` at `strategies.py:205` enumerates the
    live-strategy warm-set owners globally; `readiness_cache` repo `read_many`/`upsert_many` at
    `readiness_cache.py:25,44`.
  - Feature-177 @AC-2 test busts via expired `valid_until` (`test_readiness_cache.py:82-105`), not
    `bar_epoch`, so adding the `bar_epoch` conjunct keeps 177 green — but `_cache_svc` mocks only
    `GetBars`, so Step 4 must add a `GetDataCoverage` mock (R3).
- Reviewers snapshot finalized in feature.md: analysis service owner (all steps) + config service
  owner (Step 7). No DBA / Proto Reviewer (no migration, no proto). Merge-order row for 180 already
  present in merge-order.md (176 → 177 → 180).
