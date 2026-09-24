# Context: watchlist-readiness-list-ux  (archived 2026-09-16)

**Feature**: ./feature.md
**Status**: launched — archived by /sdd-archiver; verbose specs pruned (recoverable via git history).

## Archive Synthesis — 2026-09-16 — /sdd-archiver

**What**: Shipped a single additive, cache-first `AnalysisService.GetWatchlistReadiness` RPC that decorates a keyset-paginated page of a watchlist's bound `(symbol, strategy_id)` pairs; the UI renders binding rows immediately and self-heals `PENDING`/`UNKNOWN` verdicts by polling that same RPC (killing the old per-strategy `EvaluateReadiness` N+1 fan-out, not relocating it). The most consequential outcome exceeded the stated "presentation + read-shape only" scope: a deliberate, operator-approved behavior change to the *shared* `compute_readiness_row` path used by shipped features 177 and 180 (the `bar_epoch = -1` failure sentinel). Owner is always the `x-user-id` header; no portfolio→analysis edge was added.

**Why (irrecoverable rationale)**:
- The decoration was placed on analysis (not portfolio, not the BFF) because portfolio→analysis is the forbidden cycle and the BFF option merely relocates the N calls server-side.
- Freshness gating uses a per-symbol `GetDataCoverage` probe rather than the `valid_until` window alone, because `stale_after < 86400` only *caps* bar-staleness at one bar — a window-only check would ship a bar-stale `RESOLVED` with no self-heal path (a C-16 @AC-2 regression).
- Pending rows poll the *new* RPC, not the old `EvaluateReadiness` — the initial "poll the old endpoint" steering was overturned because it reintroduced the exact N+1 and double-computed each pair against the background kick.

**Rejected alternatives**:
- Client-supplied `(symbol, strategy_id)` pairs — IDOR: a client-supplied `strategy_id` could request readiness for a non-owned strategy and leak `SymbolReadiness.conditions` rule internals; closed structurally by keying on `watchlist_id`.
- BFF two-backend aggregation — cycle-free but a net-new aggregation pattern that relocates rather than eliminates the N calls.
- Offset pagination — drifts (skip/dup on concurrent rebind); replaced by a composite `(symbol, strategy_id)` keyset.
- R-E discriminator `computed_at` recency — misfires on the normal new-bar-at-close case, painting a healthy not-yet-recomputed row `UNKNOWN` for ≤5 min once/day.
- R-E discriminator `bar_epoch == 0` — misses benchmark-present strategies, whose failed primary fetch still writes `bar_epoch = benchmark_epoch > 0`.
- Blocking per-owner refresh lock — starves a second open page's cold pairs; replaced by a `(owner, strategy_id, symbol)` guard-set.
- Coarse whole-owner `_materialize_readiness_for_owner` on read — re-warms every watchlist for one page view (wasteful); this is *why* the shipped kick is scoped to the page's not-fresh pairs. That method still exists (the 180 daily loop), so a future agent could re-wire it onto the read path and re-introduce the waste this feature avoided.

**Scars & gotchas**:
- Post-rewrite CI regression on a *sibling's* e2e suite (not this feature's tests): changing the readiness source broke 5 existing tests in `e2e/insights/watchlists.spec.ts` that still asserted the old `EvaluateReadiness` fan-out. Root cause: the removed `useQueries` keyed on symbols, so a rebind refetched for free; the new single-key hook did not. Fix: add a bound-pair signature to the query key AND `enabled: pagePairs.length > 0`.
- The infinite-`PENDING` trap (R-E) is visible only by reasoning about cache-read-only + probe-gate + a benchmark-present strategy whose primary bars persistently fail: `GetDataCoverage` succeeds (`lbe>0`) but the swallowed fetch error upserts `bar_epoch = benchmark_epoch`, never reaching `lbe`, so `is_readiness_row_fresh` is False forever. Four adversary rounds to surface.
- A successful-EMPTY fetch must NOT get the `-1` sentinel — the probe window (10d) ⊂ fetch window (400d), so an empty fetch legitimately yields `lbe=0` → best-effort `RESOLVED`; only the *exception* path is data-unavailable.
- Codegen build fallback (D-2): `buf` absent → ran lint/breaking/generate in the `Dockerfile.codegen` container; the container's final TS→JS `tsc` failed (`gen/ts/node_modules` absent), completed on host via the pnpm `prepare` hook.

**Permanent deviations**:
- Product-spec scoped this "presentation + read-shape only," but shipped code CHANGED the shared `compute_readiness_row` to stamp `bar_epoch = -1` on a primary-bars-fetch exception → a benchmark-present primary-failure row that features 177/180 previously FAST-served as a degraded verdict now classifies non-fresh/`UNKNOWN`. A deliberate, more-correct behavior change to two shipped features, explicitly operator-approved as a C-11/P-03 scope override, landed with same-PR re-verification of 177 @AC-1/@AC-2. Once design.md is deleted this reads as unexplained scope creep unless captured here.
- Design wrote the enum shorthand `RESOLVED=1`; shipped `READINESS_STATE_RESOLVED=1` because `buf.yaml` STANDARD lint requires the enum-name prefix.

**Accepted safety/staleness tradeoffs**:
- Page-membership disagreement between client-side slicing and server-side keyset slicing is not required for correctness: each verdict is matched onto its binding row by the `(symbol, strategy_id)` cell key, so a rebind race can only leave a since-removed pair unmatched (→ stays `PENDING`/drops next poll), never land a wrong verdict on a row. A future agent changing pagination could silently break this.
- R-C accepted staleness: a rebind reflects on the readiness view only on its next poll, and a rebind on a non-visible page is invisible until paged to — accepted for the one-day-bar cadence.

**Cross-feature signal**: `compute_readiness_row` / `is_readiness_row_fresh` in `readiness.py` is a compute seam shared by features 177, 180, and 181 — a change there ripples to the interactive `EvaluateReadiness` handler and the materializer at once; the `-1` sentinel's blast radius (one writer, three readers via the `>=` predicate) had to be audited end-to-end. Reusing `_readiness_materializer_bars_sem` for on-read kicks (R-F) couples `analysis.readiness_materializer.max_concurrent_bars_fetches` to interactive watchlist-read kicks, chosen over the interactive `_bars_fetch_sem` to preserve feature-176's priority-inversion guard.

**Deferred follow-ons**: FR-6 (warm-FAST first render) is contingent on `analysis.readiness_materializer.enabled`, which ships OFF; this feature deliberately did not flip the default. Cold pages render `PENDING` and self-warm over one poll. Enabling the 180 materializer for a warm first render is the explicit forward pointer.

**Ledger entries written**: insights.md (3), fails.md (1) — see the 2026-09-16 entries.

**Runtime-invariant recommendations (→ /context-constitution)**: ANALYSIS-* — `readiness_cache.bar_epoch < 0` (specifically `-1`) is a data-unavailable sentinel ("primary bars fetch raised"), never a real epoch; the column is `BIGINT NOT NULL` with no non-negative constraint, so any consumer sorting/comparing `bar_epoch` must special-case negatives. ANALYSIS-* — `compute_readiness_row`/`is_readiness_row_fresh` is a compute seam shared by 177/180/181.

**Pruned artifacts**: product-spec.md, recon.md, design.md, implementation-spec.md — last present at a6029d9a.
