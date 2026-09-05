# Context: readiness-caching-poll-discipline

**Feature**: `docs/roadmap/features/177-readiness-caching-poll-discipline/feature.md`
**Product Spec**: `docs/roadmap/features/177-readiness-caching-poll-discipline/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/177-readiness-caching-poll-discipline/implementation-spec.md`

---

## Session 2026-09-04 — sdd-story

- Created from performance-audit Track B (`docs/reports/2026-09-04-performance-bottlenecks-audit.md`,
  findings 2.4, 1.2, 1.3, 1.7).
- Reduces how *often* the analysis fan-out runs; composes with feature 176, which makes each run
  faster. Kept separate to keep diffs surgical (behavior #3) — 176 is service-concurrency mechanics,
  177 is caching/cadence policy.
- Known traps folded into Open Questions: feature 110 (verify remount cost vs. actual `staleTime`
  before per-symptom fixes; the outer cache key is the systemic fix) and feature 118
  (screener-data-readiness-polling — align with the existing readiness-poll pattern).

## Session 2026-09-04 — sdd-review product-spec

- Product spec approved. Status: draft → spec-ready. Verdict PASS WITH WARNINGS (no blockers).
- Verified: _enrich_opportunities_live (servicer.py:3006, 2-RPC-per-symbol), migration 011 exists, WatchlistReadiness.tsx:193 useQueries.
- Addressed: DB section now names the up.sql+down.sql pairing; next free migration NNN = 022 (dir tops at 021_pnl_positions_fees_total).
- Warnings (advisory, to close in /sdd-design): four Open Questions — remount-cost trap (fails.md:751-754, feature 110), poll-cadence alignment (feature 118), readiness cache "bar epoch" invalidation key, empty-universe cache placement.
- Overlap: CLEAN. Same 176↔177 analysis compute-path coordination noted; config namespace analysis.readiness.* confirmed absent on trunk.

## Session 2026-09-05 — sdd-design quick, ROUND 1 (PAUSED, not approved)

Status unchanged: **spec-ready** (user chose "Hold, run another round"). recon.md written + committed. design.md NOT yet written.

**USER DECISION (locked):** readiness cache home = **Durable table (migration 022)**, mirroring the Opportunities stack. (In-process TTL was the adversary's minimum-that-solves alternative; user chose durable for restart/scale safety.)

- **Proposer (r1):** table analysis.readiness_cache (022), composite key (user_id, strategy_id, symbols_hash, bar_epoch=wall-clock UTC session date); sentinel row for empty-universe; in-process TTL memo for FR-4 enrichment; additive computed_at=2 on EvaluateReadinessResponse; per-query staleTime:30_000. SWR verdict EXTEND.
- **Adversary (r1): NEEDS WORK, no Floor breach.** Correctness objections that MUST be folded into round 2 (the table decision is settled, these are not):
  1. **bar_epoch WRONG as wall-clock (breaks @AC-11/095 never-stale-as-fresh):** the Opportunities template anchors on `session_end_seconds = max(bars[-1].time)` observed during compute (servicer.py:3411-3471), NOT wall-clock. Wall-clock masks an intraday-corrected same-day bar AND reads epoch=D from 00:00 UTC before the real D bar lands. FIX: epoch = max(bar.time) observed (reuse session_end_seconds), bound same-timestamp corrections with stale_after_seconds SWR.
  2. **Key omits `rule` (EvaluateReadinessRequest field 3) → cross-verdict collision (@AC-1/@AC-2/155):** entry vs exit tree differ (servicer.py:2694). ALSO omits strategy-definition version — a ManageStrategy edit leaves the key unchanged → stale verdict. FIX: add `rule` + a definition fingerprint (definition_json)/strategies.updated_at to the key.
  3. **Sentinel-row hack rejected (fails.md:757-769 class):** conviction-0 sentinel is filtered by read() floor (opportunities.py:107) → read() still returns [] → else/stale branch STILL fires _kick_opportunity_recompute every poll (FR-3 not met); re-ordering the cold/stale state machine changes behavior for ALL users and blocks empty→non-empty transition (new opportunity silently fails to surface). Also feature 097 already REJECTED a separate readiness_cache table (migration 011:6 note). FIX: use a dedicated per-user compute-state row (user_id, computed_at, valid_until) that the freshness check reads — keep `opportunities` rows "real rows only". (Note: this interacts with the durable-table decision — the empty-universe marker is a compute-state row, NOT an in-band opportunity sentinel.)
  4. **FR-4 TTL memo (@AC-12/095 cross-surface parity):** memo only wraps the Decide path; prove Signal-detail derives live_price from the SAME memo entry, else the memo INTRODUCES the divergence AC-12 forbids. Memoize only successful reads (a memoized miss suppresses a recovered price).
  5. **SWR verdict is CHANGE not EXTEND (sign-off):** re-ordering ListOpportunities cold-vs-stale state machine changes existing opportunity-materialization refresh behavior → needs user sign-off in context.md (recon.md:53). Round 2 must classify precisely and get sign-off if it re-orders.
  6. **176↔177 sequencing:** both edit EvaluateReadiness + _enrich_opportunities_live; design 177's wrap against 176's POST-parallelization shape, register in merge-order.md (176 first).
- **NEXT (round 2):** re-propose with durable table (locked) BUT epoch=max(bar.time), key incl. rule+definition-fingerprint, compute-state row for empty-universe (not in-band sentinel), AC-12 parity proof for the memo, precise EXTEND/CHANGE classification (+ sign-off if CHANGE). Then re-adversary, then user gate.
