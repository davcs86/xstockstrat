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

## Session 2026-09-05 — sdd-design ROUND 2 (complete) + USER DECISION; round 3 pending

Status unchanged: **spec-ready** (user chose "Hold, run another round" → round 3). design.md NOT yet written.

- **Round-2 proposer:** durable table 022; readiness_cache PK (user_id, strategy_id, rule, symbol) + def_fingerprint + bar_epoch/valid_until freshness gate; epoch=max(bar.time) (session_end_seconds); separate opportunity_compute_state table for empty-universe gate as an ADDED pre-check inside `if not rows:`; in-process short-TTL memo for FR-4 (successful reads only); additive computed_at=2; per-query staleTime. Claimed EXTEND for both.
- **Round-2 adversary: NEEDS WORK, no Floor breach.** Fold into round 3:
  1. **Benchmark-bar staleness escapes the gate:** bar_epoch anchors on the EVALUATED symbol only; a benchmark(source_symbol)-gated strategy whose evaluated symbol is dormant but whose benchmark prints a new bar → stale verdict served fresh (@AC-1/2/155, @AC-11/095). FIX: `bar_epoch = max(evaluated newest, benchmark newest bar time)` — benchmark bars already in scope (_load_benchmark_bars_windowed).
  2. **stale_after_seconds needs a server bound < 86400** (1d bar interval; readiness is 1d-only). ≥86400 → new bar lands before expiry → stale served fresh across a bar boundary. FIX: enforce a bound like feature 161's SCALAR_BOUNDS_REGISTRY; document "window < bar cadence." (Config-leaf invalidation is a NON-issue: evaluate_conditions_traced is pure over definition_json+bars+benchmark_bars; no analysis.* config enters the trace — only the two bar epochs matter.)
  3. **MUST reuse the existing `_definition_fingerprint` helper (servicer.py:626/2013)**, never a new hash (a divergent hash → guaranteed miss/false hit, silently defeats the cache).
  4. **fails.md:757-769 (INSERT vs NOT NULL):** trace the literal upsert column set for BOTH tables; a fetch_ok-but-empty-bars symbol (servicer.py:2710) → is readiness_json '{}' or NULL? opportunity_compute_state write must supply computed_at AND valid_until.
  5. **FR-4 memo @AC-11:** reuse must be FAILURE-gated, not just TTL-gated — a symbol whose quote goes unavailable must drop its price within the TTL, never persist a memoized price as current. Bound TTL tightly.
  6. Prefer two separate migrations (022_readiness_cache + 023_opportunity_compute_state) for independent rollback; verify both down.sql DROPs.
  7. 176→177 hard sequencing (177 wraps functions 176 restructures) — spec 177 against 176's restructured signatures or gate behind 176's merge; merge-order.md.
  - SOUND: per-symbol PK (subset/superset reuse + mixed freshness), def_fingerprint retrievable in scope (no extra fetch), computed_at=2 additive, AC-12 parity proof.
- **VERDICT split (adversary + USER SIGN-OFF):** FR-1 readiness cache = **EXTEND** (with the two bar-epoch fixes). FR-3 empty-universe = **CHANGE** (delays a currently-empty user's first opportunity up to the cache window).
- **USER DECISION (locked, C-16 CHANGE signed off):** ACCEPT FR-3 with a **dedicated SHORT TTL** (~30s; its OWN new config key, e.g. `analysis.opportunity.empty_recompute_ttl_seconds`, NOT the 24h valid_window_hours) + a **background revalidate kick on the empty path** so the empty state self-heals → first-opportunity delay ≤ ~one poll cycle (≈ today). This is the signed-off CHANGE; round 3 must implement it this way and record the sign-off in design.md § Business Rules Touched (CHANGE @ this session).
- **NEXT (round 3):** re-propose with benchmark-max epoch, <86400 window bound, reuse _definition_fingerprint, literal INSERT column trace, failure-gated memo, two migrations, short-TTL+self-heal empty-universe, 176-first sequencing. Then re-adversary, then user gate.

## Session 2026-09-05 — sdd-design ROUND 3 (proposer + adversary complete); final gate pending

Status unchanged: **spec-ready**. design.md NOT yet written (awaiting the consolidated final gate across 176-179).

- **Round-3 proposer:** two migrations (022_readiness_cache + 023_opportunity_compute_state) with literal upsert column lists + NOT-NULL DDL; bar_epoch=max(eval last-bar, benchmark last-bar); reuse _definition_fingerprint (servicer.py:4299); valid_until=now()+stale_after_seconds (wall-clock SWR, <86400 via SCALAR_BOUNDS_REGISTRY); FR-3 short-TTL 30s (own key analysis.opportunity.empty_recompute_ttl_seconds) + self-heal kick; FR-4 failure-gated memo at GetLatestPrice seam; additive computed_at=2; per-query staleTime.
- **Round-3 adversary: NEEDS WORK, no Floor breach.** All round-2 objections RESOLVED; locked decisions correct. THREE fold-ins for design.md:
  1. **DROP the slow-path bar_epoch reuse** ("if stored fp==cur AND bar_epoch matches reuse persisted json"): an intraday-updating current-day 1d bar keeps the same time.seconds while OHLC moves → the first compute of the day would be served ALL DAY, never re-evaluated, defeating the <86400 window (stale ≠ "identical from cache", @AC-1/2/155). FIX (behavior #2 simplification): on ANY valid_until miss, always re-run evaluate_conditions_traced + upsert; the bars are already fetched on the slow path (the reuse saved only a pure-CPU trace). The FAST path (valid_until gate skipping fetch+evaluate) already delivers the caching win. [If ever kept, must first cite marketdata 1d "latest bar" immutable-at-close semantics and gate on a completed prior-session bar.]
  2. **Empty-universe self-heal write-completeness (fails.md:757-769):** _kick_opportunity_recompute (servicer.py:3090) writes only analysis.opportunities via replace_for_user — it NEVER writes opportunity_compute_state. So an empty completion doesn't refresh valid_until → next poll re-runs _materialize synchronously → FR-3 not met. FIX: EVERY compute completion yielding an empty universe — both _materialize_opportunities (cold) AND the _kick background task — must upsert opportunity_compute_state (computed_at=now, valid_until=now+empty_recompute_ttl_seconds); trace the literal INSERT.
  3. **FR-4 memo @AC-12 parity = spec-time VERIFY (not blocker):** grep suggests Signal-detail (insights/market/[symbol]/page.tsx) does NOT call GetLatestPrice directly (consistent with consuming Opportunity.live_price from the shared ListOpportunities response) → memo introduces no divergence. design.md must CITE the market page's price-source line as the parity proof (P-03), not leave it open.
  - Also: verify SCALAR_BOUNDS_REGISTRY <86400 is server-ENFORCED (feature 161), both .down.sql DROP their table, 176→177 signature coupling handled at /sdd-spec against 176's post-restructure signatures.
  - Question (c) bounded-staleness (fast path serves on valid_until, a new bar mid-window unseen until expiry) = the signed-off EXTEND contract, SOUND provided fix #1 lands. Question (d) fingerprint excludes name/active/live_enabled = non-issue (those never enter evaluate_conditions_traced).
- **NET:** design essentially final. Ready to write design.md with: FR-1 EXTEND (fast-path-only cache, no slow-path reuse; benchmark-max epoch; <86400 enforced), FR-3 CHANGE (signed off; short-TTL + self-heal writing opportunity_compute_state on empty), FR-4 failure-gated memo (+cite parity at spec). No new user fork.

## Session 2026-09-05 — design HELD at approval gate

- Round-3 debate complete and SOUND-with-doc-fold-ins (see the round-3 block above); design.md NOT written.
- At the consolidated approval gate the user approved 176 & 178 and HELD this feature for a further look. Status stays spec-ready.
- To resume: /sdd-design <slug> quick re-reads this context and can go straight to writing design.md + design-approved once the user confirms (all round-3 fold-ins + locked decisions are already recorded here — no further debate needed unless the user requests changes).

## Session 2026-09-05 — sdd-design COMPLETE (design-approved)

- Phase 1 Grilling: 4 rounds (quick, extended by user through rounds 2-4). Round-4 adversary SOUND, no Floor breach; all prior objections resolved. design.md written.
- Chosen approach: durable readiness cache (022_readiness_cache, two-path FAST/SLOW, NO slow-path reuse, bar_epoch=max(eval,benchmark), reuse _definition_fingerprint, stale_after_seconds<86400 server-bounded); empty-universe via 023_opportunity_compute_state stamped on ALL three empty-completion paths (_materialize cold, _kick._run, _opportunity_refresh_tick daily — via a shared _replace_and_stamp helper, settle at /sdd-spec); FR-4 success-only failure-gated memo; FR-2 per-query staleTime; additive computed_at=2.
- Business Rules: FR-1 EXTEND; FR-3 CHANGE (C-16) USER SIGNED OFF this session (short-TTL ~30s + self-heal). Constitution: C-07, C-09, C-05, C-16, P-03. Floor breaches: none.
- USER APPROVED design 2026-09-05. Status: spec-ready → design-approved.
- Open risks to /sdd-spec: daily-tick stamping (shared helper vs documented one-poll gap; don't perturb @AC-8/9/158); empty→non-empty within-one-TTL test; AC-12 parity cite SignalReadiness.tsx:31; 176-before-177 signatures.
- Next: /sdd-spec readiness-caching-poll-discipline.
