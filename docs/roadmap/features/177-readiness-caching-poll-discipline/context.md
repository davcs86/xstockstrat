# Context: readiness-caching-poll-discipline  (archived 2026-09-16)

**Feature**: ./feature.md
**Status**: launched — archived by /sdd-archiver; verbose specs pruned (recoverable via git history).

## Archive Synthesis — 2026-09-16 — /sdd-archiver

**What**: Shipped a durable readiness cache (migration `022_readiness_cache`) plus a dedicated empty-universe gate (`023_opportunity_compute_state`), a success-only live-enrichment memo, and a per-query client `staleTime` — cutting redundant recompute on the `/insights` decide surfaces without ever serving stale-as-fresh. Deliberately carved as the *cadence/how-often* half of a three-feature perf split (176 = concurrency mechanics, 177 = caching cadence, 178 = quote batching), specced against 176's post-restructure `EvaluateReadiness` because 176 merged mid-flight.

**Why (irrecoverable rationale)**: The whole cache-invalidation design turns on one non-obvious platform fact — a current-day 1d readiness bar mutates in place (same `time.seconds`, moving OHLC) until close. That single fact killed three tempting simplifications (wall-clock epoch, slow-path JSON reuse, a ≥86400 window) and forced `bar_epoch = max(evaluated, benchmark)` + a server-bounded `<86400` window. `stale_after_seconds` is a **seed-less** `SCALAR_BOUNDS_REGISTRY` entry (bound enforced at `SetConfig` without a config-service seed row); a discoverability seed migration was consciously deferred.

**Rejected alternatives**:
- In-process TTL readiness cache — lost to a user-locked durable-table choice for restart/scale safety (analysis is `instance_count:1` today). Feature 097 had rejected a durable readiness table; 177 reversed that for the same restart/scale argument.
- Wall-clock `bar_epoch` — masks an intraday-corrected/late same-day bar; replaced by observed `max(bar.time)`.
- `bar_epoch` anchored on the evaluated symbol only — a benchmark-gated strategy whose evaluated symbol is dormant but whose benchmark prints a new bar serves stale-as-fresh; fixed to `max(evaluated, benchmark)`.
- Slow-path `bar_epoch`-reuse micro-opt — the in-place-updating 1d bar would serve day-one all day; dropped.
- In-band conviction-0 sentinel row for empty-universe — filtered by the read conviction floor → re-kicks every poll, blocks empty→non-empty, trips the NOT-NULL multi-consumer trap; replaced by dedicated `opportunity_compute_state`.
- Reusing the 24h `valid_window_hours` for the empty TTL — up to 24h delay; replaced by a dedicated ~30s `empty_recompute_ttl_seconds` + self-heal kick.

**Scars & gotchas**:
- Empty-universe self-heal write-completeness: `_kick_opportunity_recompute` wrote only `opportunities`, never `opportunity_compute_state` — empty completion never refreshed `valid_until`, so the next poll re-materialized synchronously (FR-3 silently unmet). Fix: a shared `_replace_and_stamp_compute_state` wired at all three empty-yielding sites (cold `_materialize_opportunities`, `_kick._run`, daily `_opportunity_refresh_tick`).
- `_load_benchmark_bars_windowed` returns a `{source_symbol: [bars]}` dict, not a list — `bar_epoch` had to iterate `.values()`.
- FR-4 memo must be success-only (memoize only when `last_price` and `spark` are both non-None; `ttl==0` disables).
- `_definition_fingerprint` must be reused and fed the DB-row dict `row["definition_json"]`, never a request dict or a new hash.
- recon anchors drifted because sibling 176 merged mid-feature; re-anchored against the post-176 tree.
- Tooling fallbacks (CI-equivalent): proto codegen via Docker `Dockerfile.codegen`; e2e ran `CI=1 pnpm test:e2e` prod path (dev cold-compile blows the 10s warmup), `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` → sandbox Chromium.

**Permanent deviations**:
- `@AC-3` said 60s staleTime → shipped 30s (design-authoritative, matches the Opportunities pane); `acceptance.feature` reconciled 60→30 with a C-16 rationale.
- FR-5 response `computed_at` = min (oldest) per-symbol `computed_at` across served rows — a spec-time realization not pinned in design.md.
- FR-3 signed off as a C-16 **CHANGE** (not EXTEND): a currently-empty user's first opportunity is now delayed ≤ `empty_recompute_ttl_seconds` (~30s), bounded by the short TTL + self-heal kick. User sign-off recorded 2026-09-05.

**Cross-feature signal**: The durable-vs-in-process fork recurs in analysis and keeps resolving to durable once scale-safety is weighed (097 vs 177). The opportunity-materialization freshness contract lives only in `services/xstockstrat-analysis/CLAUDE.md`, never C-16-promoted — a latent gap for future work on this SWR machine.

**Deferred follow-ons**: Optional config-service seed migration for `analysis.readiness.stale_after_seconds` (config-ui discoverability of the bounded key).

**Ledger entries written**: insights.md (5), fails.md (4) — see the 2026-09-16 entries.

**Runtime-invariant recommendations (→ /context-constitution)**: ANALYSIS-* — a current-day 1d readiness/opportunity bar updates in place (identical `time.seconds`, moving OHLC) until session close; any cache keyed on `time.seconds` alone serves the first compute all day (drove the whole 177 epoch design). ANALYSIS-* — `_load_benchmark_bars_windowed` returns a dict, not a list. Doc-drift: the opportunity-materialization freshness/SWR contract is documented only in `services/xstockstrat-analysis/CLAUDE.md`, not C-16-promoted.

**Pruned artifacts**: product-spec.md, recon.md, design.md, implementation-spec.md — last present at a6029d9a.
