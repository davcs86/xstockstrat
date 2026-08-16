# Design: fix-opportunities-bars-fetch-oom

**Created**: 2026-08-16
**Rounds**: 2 (full; termination: approved)
**Approved by**: user @ 2026-08-16
**Grounded in**: recon.md

---

## Chosen Approach

Two additive pieces, both scoped inside `_compute_opportunities`
(`services/xstockstrat-analysis/app/handlers/servicer.py:2284-2637`), no proto/migration/config-key
approval beyond one new runtime-registered config key:

**1. Per-pass, symbol-keyed bars dedup.** A `bars_by_symbol: dict[str, list] = {}` local, declared
alongside the existing `strategy_defs` per-pass cache (`:2570`), checked/populated at the existing
fetch site (`:2584-2591`) instead of fetching unconditionally per `(symbol, strategy)` candidate.
Kept as a plain dict with no lock — verified safe because the `for c in selected:` loop is strictly
sequential (no `gather`/`Semaphore` inside one pass) and `bars_by_symbol` is function-local, never
shared across calls. This alone collapses the up-to-5× live-strategy fan-out (feature 131) and the
uncapped watchlist-binding multiplier (feature 131/132) down to exactly one bars-fetch per unique
symbol per compute pass.

A failed fetch is cached as `[]` (not retried by later candidates sharing the symbol) — an
explicit, named trade-off: today each candidate independently retries and could self-heal from a
transient blip; after this fix, the first failure "poisons" the rest of that symbol's candidates
for the pass. Accepted as harmless because downstream code treats "never fetched," "fetched empty,"
and "fetch failed" identically (`bars` falsy → empty readiness, same as today).

**2. A process-lifetime, cross-request `asyncio.Semaphore`.** Dedup alone does not bound *peak
concurrent* Postgres lock pressure across **different users'** simultaneously-executing compute
passes — confirmed via `_opportunity_lock` (`:2248-2254`) serializing only per-user, and
`xstockstrat-analysis` running as a single process/single `grpc.aio.server()`
(`app/main.py:72`, `instance_count: 1` in `.do/app.yaml`). Add a semaphore constructed once in
`AnalysisServicer.__init__`, modeled explicitly on `self._component_series_sem`
(`servicer.py:151-157` — the one existing precedent that is itself process-lifetime and
cross-request-scoped, documented as bounding "cross-request concurrency... so a routinely-visited
page can't starve the live loop") — **not** the other two semaphore precedents (`screener.py:84-86`,
`entry_backfill.py:55-57`), which are per-call-scoped and would bound nothing across users if copied
naively.

```python
# AnalysisServicer.__init__, alongside self._component_series_sem
self._bars_fetch_sem = asyncio.Semaphore(
    max(1, self._cfg.get_int("analysis.opportunity.max_concurrent_bars_fetches", 2))
)
```

Wrapped around the same fetch call site:
```python
if sym in bars_by_symbol:
    bars = bars_by_symbol[sym]
else:
    async with self._bars_fetch_sem:
        try:
            bars = await self._fetch_bars_paged(sym, range_msg, propagation_meta)
        except Exception as e:
            log.warning("_compute_opportunities: bars fetch failed for %s: %s", sym, e)
            bars = []
    bars_by_symbol[sym] = bars
```

New config key: `analysis.opportunity.max_concurrent_bars_fetches`, **default 2** (user-chosen —
matches `xstockstrat-marketdata`'s own `DB_POOL_MAX` default of 2, per root CLAUDE.md's Connection
Pool Budget table, so analysis never lets more concurrent attempts through than marketdata can
actually execute; the other 3 precedents' default of 4 was considered and rejected for this
purpose). Runtime-registered (no seed migration needed), matching this service's existing
`analysis.opportunity.*`/`analysis.series.*` config-key precedent.

No consumer-surface change (C-14 n/a) — internal resource-consumption fix; the Opportunities queue's
observable content/shape is unchanged, only its bars-fetch volume and concurrency.

### Rejected restructure

A "pre-compute distinct symbols in a separate pass before the trace loop" alternative was
considered and rejected: the fetch is gated by a three-part condition evaluated *inside* the loop
(`strat` truthy, not-muted-unless-held, **and** a successfully-loaded strategy `definition` via
`_load_strategy_definition` — itself an async lookup per `strategy_id`, `:2585-2586`). Pre-fetching
before the loop would either duplicate that entire gate just to know which symbols need bars (real
added complexity, no behavior change), or naively fetch for every distinct symbol regardless of
gating — which would be a behavior change: newly fetching bars for muted-non-held placeholders and
unattributed candidates that today never reach `_fetch_bars_paged` at all. Rejected as scope creep
beyond "touch only what the task requires."

### Testing

- **Dedup regression at documented worst-case scale**: a scenario with ~30 distinct symbols, each
  attributed via multiple watchlist strategies **and** the live-fan-out cap (5) **and** ≥1
  `muted_only` row (feature 132), producing ≥200 total candidate rows — grounded in this service's
  own documented feature-131 worst-case ceiling (`5 × (20 + 20) = 200`,
  `services/xstockstrat-analysis/CLAUDE.md` § Config Keys Consumed), since the actual production
  candidate-set size that triggered the original incident isn't available in recon/product-spec.
  Assert `_fetch_bars_paged`'s mock call count equals the number of **distinct symbols** that pass
  the fetch gate, not `== 1` and not the candidate-row count.
- **Every candidate resolves**: no candidate is silently dropped — each ends with a real trace or
  the empty-readiness fallback, never an unhandled exception.
- **Failed-fetch caching is pinned**: mock one symbol's fetch to raise; assert it's attempted
  exactly once for that symbol in the pass, and every candidate sharing it gets the same cached `[]`.
- **Concurrency bound (mechanical proof, not a real-Postgres load test)**: `asyncio.gather` over N
  (e.g. 6, above the default of 2) concurrent `_compute_opportunities` calls for *different*
  `user_id`s, with `_fetch_bars_paged` mocked to block on a shared counter/event until released;
  assert observed peak concurrent in-flight fetches never exceeds the configured
  `max_concurrent_bars_fetches`.
- User-approved: unit-level proof (the four assertions above) is sufficient to close this SEV-2 —
  a real staging load test with concurrent multi-user cold reads against live Postgres is explicit
  optional follow-up, not a merge gate, given the mechanism is sound by inspection and SEV-2 (not
  SEV-1) doesn't warrant the added delay.
- Existing `xstockstrat-analysis` tests continue passing unmodified (this fix's behavior change —
  identical bars data across candidates sharing a symbol within one pass — was assessed by round 1
  as consistent with, not contradicting, this function's existing same-pass-consistency comment at
  `servicer.py:2566-2567`).
- `/sdd-spec` must ground the exact test file/fixture/mocking convention (e.g. `_materialized_svc`/
  `_list_opps` helpers referenced in round-1 evidence) against the live `tests/test_analysis_servicer.py`
  before writing steps — not assumed here.

## Rejected Alternatives

- **Shrink the 400-day (`_READINESS_LOOKBACK_DAYS`) lookback window** — rejected: exists specifically
  to warm up long indicators (~200 periods); shrinking risks readiness-accuracy regressions for those
  strategies, and product-spec explicitly excludes general bars-query performance work beyond
  clearing the resource exhaustion.
- **Cap watchlist-bound candidates per symbol** (mirroring the existing live-strategy cap) — rejected:
  once bars-fetch cost is O(unique symbols) instead of O(candidates), watchlist candidate *count* no
  longer drives marketdata query volume; capping it would only change attribution semantics, which
  product-spec puts explicitly out of scope (features 131/132's product behavior is not this bug's
  concern).
- **Tune Postgres (`shared_buffers`/`max_locks_per_transaction`) or widen the hypertable's chunk
  interval** — deferred: likely outside code-level control on the managed DO cluster (tuning), and a
  chunk-interval change is a schema-level migration against an already-populated production
  hypertable, unneeded once the query-count multiplier (dedup) and peak-concurrency (semaphore) are
  both addressed. Revisit only if a future load characterization shows these two are insufficient.
- **Pre-compute-separate-pass restructure** — rejected (see Testing section above): would either
  duplicate the fetch-gating condition or change candidate-fetch behavior for muted/unattributed
  rows.
- **Naive per-call semaphore** (copying `screener.py`/`entry_backfill.py`'s idiom verbatim) —
  rejected: those are per-call-scoped and would be re-instantiated on every `_compute_opportunities`
  invocation, bounding nothing across different users' concurrent calls. The process-lifetime
  `_component_series_sem` shape was required instead.
- **Semaphore default of 4** (matching the other 3 precedents for consistency) — rejected by user
  in favor of 2 (matching marketdata's own DB pool cap) to avoid queuing pressure on the analysis
  side that wouldn't change real concurrent DB execution.
- **Mandatory real staging load test before closing** — rejected by user; unit-level proof accepted
  as sufficient given SEV-2 severity and a by-inspection-sound mechanism.

## Open Risks

- [ ] Root cause confidence remains low — never confirmed against a real Postgres memory/lock
      profile (recon.md). The dedup + semaphore fix addresses the mechanism recon identified as most
      plausible, but if a real staging incident recurs after this ships, escalate to the deferred
      Postgres-tuning/chunk-interval alternatives above rather than re-guessing. To be monitored,
      not a merge blocker (per user decision).
- [ ] The ≥200-row test scale is a reasoned substitute for the real production incident's candidate
      count (unavailable in recon/product-spec), not a confirmed match — to be named explicitly in
      the test's docstring/comment so a future reader doesn't mistake it for a verified reproduction.
- [ ] New config key `analysis.opportunity.max_concurrent_bars_fetches` requires config-governance
      sign-off per root CLAUDE.md § Approval Flow ("New config key: owner + config team") — to be
      completed at execute time, not assumed here.

## Constitution Rules Touched

- `C-01` (evidence-cited claims) — honored: every claim cites real `path:line` from recon.md and the
  two design-proposer rounds' direct reads.
- `C-08` (test-step pairing) — honored: each service step pairs with an immediately-following test
  step; the concurrency-bound test specifically proves the semaphore mechanism, not just its
  presence.
- `C-14` (consumer-surface reachability) — n/a: internal resource-consumption fix, no new UI/Agent
  surface; the Opportunities queue's existing shape is unchanged.
- `P-03` (no silent deviation) — honored: the low-confidence root cause and the ≥200-row test-scale
  substitution are both named explicitly as open risks rather than silently presented as confirmed.
- `F-04` (never invent) — honored: recon confirmed via grep that no dedup/semaphore mechanism exists
  today, and the correct vs. incorrect semaphore precedents were distinguished by reading their
  actual scoping, not assumed.
- No Floor (`F-*`) breach identified at any round.
