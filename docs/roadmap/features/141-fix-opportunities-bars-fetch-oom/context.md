# Context Log: fix-opportunities-bars-fetch-oom  (archived 2026-08-26)

**Feature**: ./feature.md
**Status**: launched — archived by /sdd-archiver; verbose specs pruned (recoverable via git history).

## Archive Synthesis — 2026-08-26 — /sdd-archiver

**What**: A SEV-2 OOM/lock-exhaustion defect in `_compute_opportunities`: bars were fetched once per `(symbol, strategy)` candidate against a 400-day, 1-day-chunk hypertable, so features 131 (live fan-out ≤5/symbol) and 132 (budget-exempt `muted_only` bucket) had silently turned bars-fetch cost into O(candidates). Fixed with a per-pass symbol-keyed dedup cache **plus** a process-lifetime `asyncio.Semaphore` (`analysis.opportunity.max_concurrent_bars_fetches`, default 2). The root cause was never confirmed against a real Postgres memory/lock profile — the fix targets the most-plausible mechanism recon identified, accepted by the user as monitor-not-block.

**Why (irrecoverable rationale)**: Dedup alone bounds redundant queries within one user's pass but not *peak concurrent* Postgres pressure across different users, because `_opportunity_lock` serializes only per-`user_id` and the service is single-process (`instance_count: 1`, one `grpc.aio.server()`) — hence a semaphore was needed *on top of* dedup, not instead of it.

**Rejected alternatives**:
- Shrink the 400-day `_READINESS_LOOKBACK_DAYS` — lost: it warms ~200-period indicators; shrinking risks readiness-accuracy regressions.
- Cap watchlist candidates per symbol — lost: once cost is O(unique symbols), candidate count no longer drives query volume.
- Postgres tuning / widen hypertable chunk interval — deferred: likely uncontrollable on the managed DO cluster + a migration against a populated prod hypertable; revisit only if load characterization shows dedup+semaphore insufficient.
- Pre-compute-distinct-symbols restructure — lost: the fetch gate is a 3-part condition (incl. async `_load_strategy_definition`) evaluated inside the loop; pre-fetching would duplicate the gate or newly fetch bars for muted/unattributed rows (a behavior change).
- Naive per-call semaphore (copying `screener.py`/`entry_backfill.py`) — lost: per-call-scoped, re-instantiated each RPC, bounds nothing across users.
- Semaphore default 4 (sibling precedents) — lost to the user's pick of 2, matching marketdata's `DB_POOL_MAX=2` so analysis never admits more concurrent attempts than marketdata can execute.
- Mandatory staging load test — lost: the user accepted unit-level mechanical proof for a SEV-2.

**Scars & gotchas**:
- The scale test asserted `len(opps) >= 200` but got 50: `ListOpportunities` paginates its **read** at `_DEFAULT_OPP_PAGE_SIZE=50`, independent of the 241 rows the compute side genuinely materialized. Neither recon nor either grilling round surfaced it — both scoped strictly to `_compute_opportunities` and never inspected the RPC's read/return path. The fix was test-only (`page=PageRequest(page_size=300)`); the Step-1 fix was correct.
- Choosing a semaphore precedent is a scope decision, not an idiom-copy: the repo has three `asyncio.Semaphore(cfg.get_int(...))` precedents but two are per-call and only `_component_series_sem` is `__init__`-constructed / cross-request — the trap is that copying a per-call one compiles, reads correct, and bounds nothing.

**Permanent deviations**: None vs design (shipped matched design). Deliberate change vs **prior behavior**: a failed bars-fetch is now cached as `[]`, so the first failure "poisons" all remaining candidates sharing that symbol for the pass — previously each candidate independently retried and could self-heal from a transient blip. Accepted because downstream treats never-fetched / empty / failed identically.

**Cross-feature signal**: This OOM was a latent cost created by features 131 + 132: their per-symbol fan-out and budget-exempt bucket widened the candidate set with no corresponding change to the per-candidate bars-fetch — a fan-out feature that multiplies a downstream I/O call should carry that call's dedup/limit with it. No prior ledger entry existed for TimescaleDB chunk-lock exhaustion.

**Deferred follow-ons**: If a staging incident recurs after this ships, escalate to the deferred Postgres-tuning / chunk-interval-widening alternatives rather than re-guessing. A real staging load test with concurrent multi-user cold reads vs. live Postgres remains an explicit optional follow-up, never run. `/context-scrubber` was unavailable this session; the CLAUDE.md + config-governance.md edits were only hand-reviewed — a scrubber pass on those edits is owed.

**Ledger entries written**: insights.md (3), fails.md (2) — see the 2026-08-26 entries.
**Runtime-invariant recommendations (→ /context-constitution)**: (1) ANALYSIS-* — `xstockstrat-analysis` runs single-process (`instance_count: 1`, one `grpc.aio.server()`), so a process-lifetime `asyncio.Semaphore` constructed in `AnalysisServicer.__init__` is a genuine cross-user concurrency guarantee; `_opportunity_lock` serializes only per-`user_id`. (2) ANALYSIS-* — a failed bars-fetch in `_compute_opportunities` is cached as `[]` per symbol per pass, so one transient marketdata blip suppresses bars for every candidate sharing that symbol within the pass (no per-candidate retry).
**Scenario promotion (C-16)**: none — this bug fix has no `acceptance.feature` file.
**Pruned artifacts**: product-spec.md, recon.md, design.md, implementation-spec.md — last present at 996210e4. (Defect report retained at `docs/reports/2026-08-16-analysis-opportunities-bars-fetch-shared-memory-defect.md`.)
