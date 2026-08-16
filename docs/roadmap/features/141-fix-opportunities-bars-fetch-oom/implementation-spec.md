# Implementation Spec: fix-opportunities-bars-fetch-oom

**Status**: `complete`
**Created**: 2026-08-16
**Feature**: `docs/roadmap/features/141-fix-opportunities-bars-fetch-oom/feature.md`
**Total Steps**: 3
**Feature Branch**: `claude/commit-135-opportunities-strategies-0xjnxk` (harness-assigned; see
feature.md Status History boot correction — not `feature/fix-opportunities-bars-fetch-oom`)

---

## Execution Summary

Both pieces of design.md's Chosen Approach land in one `service` step because they touch the same
two locations (`AnalysisServicer.__init__` and `_compute_opportunities`'s single fetch call site)
and are tightly coupled — the semaphore only matters once the dedup dict exists to wrap. Step 1
adds a per-pass `bars_by_symbol` dedup dict (collapsing feature 131's live-strategy fan-out and the
uncapped watchlist-binding multiplier down to one bars-fetch per unique symbol per compute pass)
and a process-lifetime `self._bars_fetch_sem` (`asyncio.Semaphore`, new config key
`analysis.opportunity.max_concurrent_bars_fetches`, default `2`) bounding cross-request/cross-user
concurrent bars-fetch attempts against Postgres. Step 2 is the paired regression suite proving all
four properties design.md's Testing section requires: dedup at a documented worst-case scale, every
candidate resolves without an unhandled exception, the failed-fetch-caching trade-off is pinned,
and the concurrency bound is genuinely binding (a "teeth" assertion, not just an upper bound — see
`insights.md` 2026-07-27). Step 3 registers the new config key in
`services/xstockstrat-analysis/CLAUDE.md` and `docs/patterns/config-governance.md`'s Per-Feature
Registered Keys log, mirroring feature 125's Step 29 precedent for the sibling
`analysis.series.max_concurrent_components` key.

No proto, migration, or consumer-surface step is needed: no wire-format change (recon.md
Dependencies), no DB migration (the key is runtime-registered — `ConfigWatcher.get_int` falls back
to its code default when the key is absent from the snapshot, `app/config/watcher.py:95-101`), and
design.md marks Constitution **C-14** n/a — this is an internal resource-consumption fix; the
Opportunities queue's observable shape (`Opportunity` proto fields, ordering, action tags) is
unchanged.

## Step Dependencies

- Step 2 requires Step 1: all three new tests assert against post-fix behavior (distinct-symbol
  fetch count, single-attempt failed-fetch caching, a concurrency ceiling of 2) that does not exist
  before Step 1's dedup dict and semaphore are added — each test is itself the red-before-green
  proof for Step 1 (see Step 2 **TDD** note), so Step 1 is not "done" until Step 2's three tests
  have been observed red on the pre-fix tree and green on the post-fix tree.
- Step 3 has no code dependency on Steps 1/2 and could run first, but is sequenced last since it
  documents the key Step 1 introduces — matches the feature-125/Step-29 ordering precedent.
- Design.md's Open Risk 3 flags that the new config key needs sign-off from the service owner
  **and** the config team per root `CLAUDE.md` § Approval Flow ("New config key: owner + config
  team") before Step 3 merges — this is stricter than `docs/runbooks/config-rollout.md`'s own
  governance-summary table ("New non-breaking key → Service owner only"); Step 3's Reviewers line
  carries both per the stricter root-`CLAUDE.md` reading, so the gap isn't silently dropped.

---

### Step 1 — service: per-pass bars dedup + process-lifetime bars-fetch semaphore

**Status**: `done`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/app/handlers/servicer.py` — modify

**Reviewers**: Service Owner (`xstockstrat-analysis`) — Backtest reproducibility, strategy scoring
determinism, no look-ahead bias

**Codebase Evidence**:
- The bars-fetch call site with no dedup/concurrency limit today —
  `services/xstockstrat-analysis/app/handlers/servicer.py:2584-2591`:
  ```python
  if strat and not (c["muted"] and not c["is_held"]):
      definition = await self._load_strategy_definition(user_id, strat, strategy_defs)
      if definition is not None:
          try:
              bars = await self._fetch_bars_paged(sym, range_msg, propagation_meta)
          except Exception as e:  # bar fetch is best-effort per symbol
              log.warning("_compute_opportunities: bars fetch failed for %s: %s", sym, e)
              bars = []
          if bars:
  ```
  Confirmed via direct read that this is the **only** `_fetch_bars_paged` call site inside
  `_compute_opportunities` and that the surrounding `for c in selected:` loop (`:2575-2637`) is
  strictly sequential — no `asyncio.gather`/`Semaphore` anywhere in this function or
  `app/engine/live_loop.py` (recon.md, confirmed via grep), so a plain, unlocked `dict` local is
  safe for the dedup cache (no cross-coroutine mutation within one pass).
- Insertion point for the dedup dict — the existing per-pass cache it sits alongside,
  `servicer.py:2568-2572`:
  ```python
  evaluator = StrategyEvaluator(self._indicators, propagation_meta)
  range_msg = _recent_range(_READINESS_LOOKBACK_DAYS)
  strategy_defs: dict[str, object] = {}  # strategy_id → StrategyDefinition | None (cache)
  session_end_seconds = 0
  window_hours = self._cfg.get_int("analysis.opportunity.valid_window_hours", 24)
  ```
- The correct semaphore precedent to model, and the two incorrect ones design.md explicitly
  rejected — `servicer.py:151-157` (`self._component_series_sem`, **process-lifetime**, the only
  one of the three that is cross-request-scoped, per its own comment "so a routinely-visited
  Symbol page can't starve the live loop"):
  ```python
  self._component_series_sem = asyncio.Semaphore(
      max(1, self._cfg.get_int("analysis.series.max_concurrent_components", 4))
  )
  ```
  vs. the two **per-call-scoped** precedents that would bound nothing across users if copied
  verbatim (confirmed via grep, cited but not to be imitated):
  `services/xstockstrat-analysis/app/services/screener.py:84-86` and
  `services/xstockstrat-analysis/app/engine/entry_backfill.py:55-57`.
- Confirms "process-lifetime" is a real cross-user guarantee here (single process, single server):
  `services/xstockstrat-analysis/app/main.py:72` (`grpc_server = grpc.aio.server()` — one server
  object) and `.do/app.yaml:232` (`instance_count: 1` for the `xstockstrat-analysis` service block).
- Confirms the new key needs no DB seed/migration — `ConfigWatcher.get_int` falls back to the
  supplied default whenever the key is absent from the live snapshot:
  `services/xstockstrat-analysis/app/config/watcher.py:95-101`:
  ```python
  def get_int(self, key: str, default: int = 0) -> int:
      if self._snapshot is None:
          return default
      v = self._snapshot.values.get(key)
      if v is None:
          return default
      return v.int_val or default
  ```
- Per-user compute serialization is a **separate** lock that does not solve this bug — confirmed at
  `servicer.py:2248-2254` (`_opportunity_lock`): it serializes cold-read computes for the **same**
  `user_id` only; two different users' compute passes still run fully concurrently against
  Postgres, which is exactly the gap the new semaphore closes.

**TDD**: `red-green required` — this step's fix is proven red-before-green by Step 2's three tests
(see Step Dependencies). Do not mark Step 1 done until Step 2's tests exist and each has been
observed red on the pre-fix tree and green on the post-fix tree.

**Instructions**:
1. In `AnalysisServicer.__init__`, immediately after the existing `self._component_series_sem =
   asyncio.Semaphore(...)` block (`servicer.py:155-157`), insert:
   ```python
   # feature 141: process-lifetime singleton semaphore bounding cross-request concurrency of
   # _compute_opportunities' bars-fetch calls (SEV-2 fix — TimescaleDB "out of shared memory"
   # under multi-user load, docs/roadmap/features/141-fix-opportunities-bars-fetch-oom). Modeled
   # on self._component_series_sem above (the one existing precedent that is itself
   # process-lifetime + cross-request-scoped) — not the per-call semaphores in screener.py:84-86
   # or entry_backfill.py:55-57, which would bound nothing across different users' calls.
   # `max(1, …)` guards a negative config value from reaching asyncio.Semaphore.
   self._bars_fetch_sem = asyncio.Semaphore(
       max(1, self._cfg.get_int("analysis.opportunity.max_concurrent_bars_fetches", 2))
   )
   ```
2. In `_compute_opportunities`, immediately after the existing `strategy_defs: dict[str, object] =
   {}` line (`servicer.py:2570`), add the per-pass dedup cache:
   ```python
   bars_by_symbol: dict[str, list] = {}  # feature 141: per-pass symbol-keyed bars dedup — one
   # bars-fetch per unique symbol, not per (symbol, strategy) candidate. A failed fetch caches []
   # and is not retried by a later candidate sharing the symbol this pass (an explicit trade-off,
   # design.md § Chosen Approach) — every candidate still resolves to a real trace or the 0/0
   # empty-readiness fallback, never an unhandled exception.
   ```
3. Replace the existing fetch block at `servicer.py:2587-2591`:
   ```python
                   try:
                       bars = await self._fetch_bars_paged(sym, range_msg, propagation_meta)
                   except Exception as e:  # bar fetch is best-effort per symbol
                       log.warning("_compute_opportunities: bars fetch failed for %s: %s", sym, e)
                       bars = []
   ```
   with:
   ```python
                   if sym in bars_by_symbol:
                       bars = bars_by_symbol[sym]
                   else:
                       async with self._bars_fetch_sem:
                           try:
                               bars = await self._fetch_bars_paged(sym, range_msg, propagation_meta)
                           except Exception as e:  # bar fetch is best-effort per symbol
                               log.warning(
                                   "_compute_opportunities: bars fetch failed for %s: %s", sym, e
                               )
                               bars = []
                       bars_by_symbol[sym] = bars
   ```
   Leave the surrounding `strat`/`muted` gate (`:2584`), the `definition is not None` check
   (`:2586`), and everything from `if bars:` (`:2592`) onward untouched — this step only changes
   how `bars` is obtained, never what happens with it afterward.

**Verification**:
```bash
cd services/xstockstrat-analysis && ruff check app/handlers/servicer.py && ruff format --check app/handlers/servicer.py
cd services/xstockstrat-analysis && python -c "import ast; ast.parse(open('app/handlers/servicer.py').read())"
```
Confirms the file is syntactically valid and lint-clean before Step 2's tests are added. Full
behavioral proof (the dedup, the caching trade-off, and the concurrency bound) is Step 2's paired
test — this step's own change has no independently-observable behavior without it.

---

### Step 2 — test: bars-fetch dedup, failed-fetch caching, and cross-user concurrency bound

**Status**: `done`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/tests/test_analysis_servicer.py` — modify

**Reviewers**: Service Owner (`xstockstrat-analysis`) — Backtest reproducibility, strategy scoring
determinism, no look-ahead bias

**Codebase Evidence**:
- Insertion point — immediately after `TestListOpportunitiesMaterialized`'s last test method
  (`tests/test_analysis_servicer.py:4568-4576`, `test_muted_row_returned_despite_min_conviction_floor`)
  and before `class TestGetStrategyAnalytics:` (`:4579`).
- `_materialized_svc(...)` (`:4005-4076`) — the no-DB fixture builder that wires
  `svc._marketdata.GetBars = AsyncMock(side_effect=lambda req, metadata=None:
  _recent_bars_resp(bars.get(req.symbol, [])))` (`:4067-4069`), so `req.symbol` and call counts are
  directly inspectable via `svc._marketdata.GetBars.call_args_list` / `.call_count` — the exact
  mechanism the dedup assertion needs. `make_servicer()` (`:33-53`) backs its `cfg.get_int` with
  `side_effect=lambda key, default=0: default`, so a freshly-built servicer's
  `self._bars_fetch_sem` resolves to the code default of `2` unless a test overrides
  `svc._cfg.get_int` (precedent for a per-test override: `:4559-4563`).
- `_list_opps(svc, **kwargs)` (`:4079-4083`) returns `({symbol: Opportunity}, [Opportunity, ...])`
  — use the **list** form (not the dict, which silently collapses same-symbol rows) whenever a test
  needs to see multiple rows sharing one symbol (the failed-fetch test).
- `_wl(bindings=[(symbol, strategy_id), ...])` (`:3935-3941`), `_strat_row(strategy_id,
  entry=..., symbols=..., denied=..., created_at=...)` (`:3944-3998`), `_GT_100` / `_FIRING_BARS`
  module constants (`:4001-4002`), `_recent_bars_resp(closes)` (`:3914-3932`), `_ctx(headers)` /
  `_HEADERS` (`:3645-3653`) — all reused verbatim, no new fixture needed (C-13: this feature adds
  no new domain data shape, only new **compositions** of existing fixtures).
- The exact muted-only-row construction to reuse for the ≥1-muted-row requirement — proven pattern
  at `:4572` (`_strat_row("sx", entry=_GT_100, symbols=["XYZ"], denied=["XYZ"])`, combined with
  passing that row in both `strategies={...}` and `live_strategies=[...]`).
- `Opportunity` proto field names for assertions — `_row_to_opportunity`
  (`servicer.py:3027-3052`): flat fields `conviction`, `passing_conditions`, `total_conditions`,
  `muted` (no nested `readiness` sub-message).
- `ListOpportunities`'s cold-read path is **synchronous** per user (`servicer.py:2199-2204`,
  `:2220-2225`: "Cold (never materialized): compute synchronously... then read") and
  `_opportunity_lock` is created lazily **per `user_id`** (`:2248-2254`) — so `asyncio.gather` over
  several `ListOpportunities` calls carrying **different** `x-user-id` headers against **one shared
  `svc` instance** genuinely runs `_compute_opportunities` concurrently for each user, with no
  cross-user lock serializing them — the precondition the concurrency-bound test needs.

**TDD**: `red-green required`. All three tests are self-proving red-before-green against Step 1,
with no extra scaffolding needed:
- `test_bars_fetch_deduped_at_documented_worst_case_scale`: pre-Step-1, every one of the 240
  watchlist-origin candidates independently calls `_fetch_bars_paged`, so
  `svc._marketdata.GetBars.call_count == 30` is false (it would be 240) — red. Post-Step-1, exactly
  one call per distinct symbol — green.
- `test_failed_fetch_cached_once_and_every_sharing_candidate_resolves`: pre-Step-1, `"BAD"` is
  fetched once per candidate sharing it (2 candidates → 2 calls), so `len(bad_calls) == 1` is false
  — red. Post-Step-1 — green.
- `test_cross_user_concurrency_bounded_by_semaphore`: pre-Step-1 there is no `self._bars_fetch_sem`
  gating the call, so all 6 concurrent fetches overlap freely and `peak` reaches `6`, not `2` — red
  (also fails with `AttributeError: 'AnalysisServicer' object has no attribute '_bars_fetch_sem'`
  before the constructor change, whichever half of Step 1 lands first). Post-Step-1 — green.
Record all three runs' red/green output in `context.md` per **P-06**.

**Instructions**:
Add a new test class immediately after `TestListOpportunitiesMaterialized` (`:4577`, before
`:4579`):

```python
class TestOpportunityBarsFetchDedup:
    """feature 141 — per-pass bars dedup + cross-request semaphore fixing the "out of shared
    memory" (SQLSTATE 53200) bars-fetch failures caused by feature 131/132's widened candidate
    set (product-spec.md Root Cause Hypothesis)."""

    @pytest.mark.asyncio
    async def test_bars_fetch_deduped_at_documented_worst_case_scale(self):
        """Scale reasoning (design.md Open Risk 2): the real production candidate-set size that
        triggered the incident is unavailable, so this ~241-row / 30-symbol scenario is a
        REASONED SUBSTITUTE grounded in this service's own documented feature-131 worst-case
        ceiling (5 x (20+20) = 200, CLAUDE.md § Config Keys Consumed) — not a confirmed
        reproduction. It uses 8 watchlist strategies per symbol (recon: watchlist bindings are
        the UNCAPPED multiplier) to reach scale, rather than reproducing the live-strategy
        fan-out cap's exact mechanics — this test's job is the dedup invariant at scale, not a
        second proof of the already-shipped feature-131 cap. One muted-only row (feature 132) is
        included to prove muted placeholders never reach the bars-fetch gate at all."""
        symbols = [f"S{i:02d}" for i in range(30)]
        strat_ids = [f"wl{i}" for i in range(8)]
        strategies = {sid: _strat_row(sid, entry=_GT_100) for sid in strat_ids}
        strategies["muted0"] = _strat_row(
            "muted0", entry=_GT_100, symbols=["M00"], denied=["M00"]
        )
        bindings = [(sym, sid) for sym in symbols for sid in strat_ids]
        svc = _materialized_svc(
            watchlists=[_wl(bindings=bindings)],
            strategies=strategies,
            live_strategies=[strategies["muted0"]],
            bars={sym: _FIRING_BARS for sym in symbols},
        )

        by_symbol, opps = await _list_opps(svc)

        assert len(opps) >= 200  # design's documented worst-case scale (240 watchlist rows + 1 muted)
        assert svc._marketdata.GetBars.call_count == 30  # one fetch per DISTINCT traced symbol —
        # never per candidate row, and the muted-only symbol below is never fetched at all
        fetched = {c.args[0].symbol for c in svc._marketdata.GetBars.call_args_list}
        assert fetched == set(symbols)
        assert "M00" not in fetched
        assert by_symbol["M00"].muted is True
        assert by_symbol["M00"].total_conditions == 0  # never traced — placeholder, not a real 0/0 fetch

    @pytest.mark.asyncio
    async def test_failed_fetch_cached_once_and_every_sharing_candidate_resolves(self):
        """design.md § Chosen Approach: a fetch failure is cached as [] and NOT retried by a
        later candidate sharing the symbol this pass — an explicit, named trade-off. Also proves
        the companion "every candidate resolves" property: both candidates sharing the failing
        symbol still return a row (empty readiness), never an unhandled exception propagating out
        of ListOpportunities."""
        strategies = {
            "wl0": _strat_row("wl0", entry=_GT_100),
            "wl1": _strat_row("wl1", entry=_GT_100),
            "wl2": _strat_row("wl2", entry=_GT_100),
        }
        svc = _materialized_svc(
            watchlists=[_wl(bindings=[("BAD", "wl0"), ("BAD", "wl1"), ("OK", "wl2")])],
            strategies=strategies,
        )

        async def _flaky_get_bars(req, metadata=None):
            if req.symbol == "BAD":
                raise Exception("simulated shared-memory failure")
            return _recent_bars_resp(_FIRING_BARS)

        svc._marketdata.GetBars = AsyncMock(side_effect=_flaky_get_bars)

        by_symbol, opps = await _list_opps(svc)  # must not raise

        bad_calls = [c for c in svc._marketdata.GetBars.call_args_list if c.args[0].symbol == "BAD"]
        assert len(bad_calls) == 1  # attempted exactly once for BAD despite 2 candidates sharing it
        assert len(opps) == 3  # wl0/BAD, wl1/BAD, wl2/OK all resolved
        bad_rows = [o for o in opps if o.symbol == "BAD"]
        assert len(bad_rows) == 2
        assert all(o.total_conditions == 0 and o.conviction == 0.0 for o in bad_rows)  # cached [] fallback
        assert by_symbol["OK"].total_conditions == 1  # unaffected sibling symbol still traces normally

    @pytest.mark.asyncio
    async def test_cross_user_concurrency_bounded_by_semaphore(self):
        """design.md Testing — mechanical proof (not a real-Postgres load test): asyncio.gather
        over N=6 concurrent ListOpportunities calls for 6 different user_ids against ONE shared
        servicer instance (mirrors production: AnalysisServicer is constructed once,
        instance_count=1 per .do/app.yaml:232), with the bars-fetch mocked to block on a shared
        counter. Asserts peak in-flight fetches == the configured max_concurrent_bars_fetches (2,
        default) — proving BOTH that fetches genuinely overlap (a "teeth" assertion — insights.md
        2026-07-27: an upper bound alone can pass vacuously if nothing ever overlaps) AND that the
        semaphore caps them at exactly the configured bound, not some other number."""
        svc = _materialized_svc(
            watchlists=[_wl(bindings=[("SOLO", "wl0")])],
            strategies={"wl0": _strat_row("wl0", entry=_GT_100)},
        )
        in_flight = 0
        peak = 0
        state_lock = asyncio.Lock()

        async def _blocking_get_bars(req, metadata=None):
            nonlocal in_flight, peak
            async with state_lock:
                in_flight += 1
                peak = max(peak, in_flight)
            await asyncio.sleep(0.05)
            async with state_lock:
                in_flight -= 1
            return _recent_bars_resp(_FIRING_BARS)

        svc._marketdata.GetBars = AsyncMock(side_effect=_blocking_get_bars)

        await asyncio.gather(
            *[
                svc.ListOpportunities(
                    analysis_pb2.ListOpportunitiesRequest(),
                    _ctx({"x-user-id": f"u{i}", "x-access-scope": "7", "x-trace-id": "t1"}),
                )
                for i in range(6)
            ]
        )

        assert peak == 2  # exactly the configured max_concurrent_bars_fetches default
```

Per C-13: every fixture used above (`_wl`, `_strat_row`, `_materialized_svc`, `_list_opps`,
`_recent_bars_resp`, `_ctx`, `_GT_100`, `_FIRING_BARS`) is an existing, already-shared helper — no
new domain-data literal is introduced by this step, so no new fixture/home decision applies.

**Verification**:
```bash
cd services/xstockstrat-analysis && ruff check . && ruff format --check .
cd services/xstockstrat-analysis && pytest tests/test_analysis_servicer.py -k TestOpportunityBarsFetchDedup -v
cd services/xstockstrat-analysis && pytest --cov=app --cov-fail-under=40
```
All three new tests pass; capture the pre-Step-1 (red) and post-Step-1 (green) runs per the TDD
note above. Confirm the full existing suite (including `TestListOpportunitiesMaterialized`) still
passes unmodified — this fix's only observable behavior change (identical bars data across
candidates sharing a symbol within one pass) was assessed by design.md round 1 as consistent with
`_compute_opportunities`' existing same-pass-consistency comment at `servicer.py:2566-2567`.

---

### Step 3 — config: register `analysis.opportunity.max_concurrent_bars_fetches`

**Status**: `done`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/CLAUDE.md` — modify (§ Config Keys Consumed)
- `docs/patterns/config-governance.md` — modify (§ Per-Feature Registered Keys)

**Reviewers**: Service Owner (`xstockstrat-analysis`) + Config team — per
`docs/runbooks/reviewer-registry.md`'s governance matrix, `config` steps are reviewed by "Service
owner of the service adding/changing the config key"; root `CLAUDE.md` § Approval Flow separately
requires "owner + config team" for **any** new config key, which is stricter than
`docs/runbooks/config-rollout.md`'s own governance-summary table (service owner only) — both
sign-offs are required before this step merges, per design.md Open Risk 3.

**Codebase Evidence**:
- `services/xstockstrat-analysis/CLAUDE.md:208-215` (`## Config Keys Consumed`, `Namespace:
  analysis`) is the table the new row joins, grouped with the sibling
  `analysis.opportunity.max_live_*` keys (`:213-215`) it's most closely related to (all three bound
  `_compute_opportunities`' resource consumption).
- `docs/patterns/config-governance.md:76-90` (`## Per-Feature Registered Keys`, append-only, newest
  first) — the feature-125 entry (`:80-89`) is the exact format template this step reuses: a `###
  feature NNN — <slug> (<service>)` heading, a short prose paragraph, then a `| Key | Type |
  Default | Description |` table.
- design.md § Chosen Approach: default `2` (not the sibling semaphore precedents'
  `analysis.series.max_concurrent_components` default of `4`) — chosen to match
  `xstockstrat-marketdata`'s own `DB_POOL_MAX` default of `2` (root `CLAUDE.md` § Connection Pool
  Budget table) so analysis never lets more concurrent bars-fetch attempts through than marketdata
  can actually execute against its own pool.

**TDD**: `N/A (config docs)`

**Instructions**:
1. In `services/xstockstrat-analysis/CLAUDE.md`'s `## Config Keys Consumed` table, add a new row
   immediately after the `analysis.opportunity.max_live_held_symbols_per_compute` row (`:215`) and
   before the blockquote note (`:217`):
   ```
   | `analysis.opportunity.max_concurrent_bars_fetches` | int | `2` | Process-lifetime singleton semaphore bounding cross-request concurrency of `_compute_opportunities`' bars-fetch calls (feature 141, SEV-2 fix for TimescaleDB "out of shared memory" under multi-user load). Mirrors `analysis.series.max_concurrent_components`'s shape, but default `2` (not `4`) to match `xstockstrat-marketdata`'s own `DB_POOL_MAX` default so analysis never queues more concurrent bars-fetch attempts than marketdata can actually execute. Read once in `AnalysisServicer.__init__` via `get_int` with a `max(1, …)` clamp. |
   ```
2. In `docs/patterns/config-governance.md`'s `## Per-Feature Registered Keys` log, add a **new
   entry at the top** (newest first — above the existing `### feature 125 — unified-symbol-page`
   entry at `:80`), matching that entry's format:
   ```markdown
   ### feature 141 — fix-opportunities-bars-fetch-oom (`xstockstrat-analysis`)

   Adds one process-lifetime singleton semaphore key bounding cross-request concurrency of
   `_compute_opportunities`' bars-fetch calls — a SEV-2 fix for TimescaleDB "out of shared memory"
   (SQLSTATE 53200) failures under multi-user load. Paired with a per-pass, symbol-keyed bars dedup
   cache (no config key — a plain function-local dict) that collapses feature 131's live-strategy
   fan-out and the uncapped watchlist-binding multiplier down to one bars-fetch per unique symbol
   per compute pass. Read live via `self._cfg.get_int(...)` (F-07), no config-service seed
   migration — mirrors `analysis.series.max_concurrent_components`'s no-seed pattern.

   | Key | Type | Default | Description |
   |---|---|---|---|
   | `analysis.opportunity.max_concurrent_bars_fetches` | int | `2` | Bounds concurrent bars-fetch attempts across simultaneous `_compute_opportunities` passes (different users), so Postgres never sees more concurrent multi-chunk `GetBars` queries than this. `max(1, get_int(...))` clamp. Default `2` (not the sibling semaphore precedents' `4`) to match `xstockstrat-marketdata`'s own `DB_POOL_MAX` default. |
   ```

**Verification**:
```bash
grep -n "analysis.opportunity.max_concurrent_bars_fetches" services/xstockstrat-analysis/CLAUDE.md docs/patterns/config-governance.md
grep -n "feature 141 — fix-opportunities-bars-fetch-oom" docs/patterns/config-governance.md
```
Confirm the key appears in both files and the new log entry is above the feature-125 entry. This
step edits a service `CLAUDE.md`, which triggers the mandated Teardown scan (root `CLAUDE.md` §
Teardown: "If your session changed any context file (a `CLAUDE.md`...)"). `.agents/context-forge.json`
→ `scrubberExtraTargets` is confirmed (`cat .agents/context-forge.json`) to list only `README.md` —
`docs/patterns/config-governance.md` is not itself in that list, but since it's edited in this same
step, include it in the scan's scope too rather than scanning only the CLAUDE.md half of the diff.
Run `/context-scrubber scan`, scoped to both changed files, and fix any grounded findings before
marking done — or record the plugin's unavailability explicitly if it is not available in the
session.

---

## Deviation Log

### Deviation: Step 2 — read-side pagination truncated the scale-test assertion

**Spec said**: `assert len(opps) >= 200` against the plain `_list_opps(svc)` call (no explicit
`page_size`).
**Actual**: `ListOpportunities` paginates its read at `_DEFAULT_OPP_PAGE_SIZE = 50`
(`servicer.py:109,2245`) — a pre-existing, unrelated RPC behavior neither recon nor design.md
surfaced. The unmodified test failed with `50 >= 200` false, even though
`_compute_opportunities` had genuinely materialized 241 rows (confirmed via
`svc._opportunities_repo.rows` — the compute-side fix was correct; only the read-side assertion
was wrong). Fixed by requesting `page=common_pb2.PageRequest(page_size=300)` in the scale test
so the assertion reflects what was computed, not an artifact of unrelated read pagination.
**Reason**: A genuine gap in the original test-design reasoning (not caught by design.md's
grilling rounds, since neither round read `ListOpportunities`'s own pagination logic — only
`_compute_opportunities`). Caught by actually running red-before-green, not assumed. No change
to the fix itself (Step 1) was needed.

### Deviation: Step 3 — `/context-scrubber` unavailable

**Spec said**: run `/context-scrubber scan`, scoped to `services/xstockstrat-analysis/CLAUDE.md`
and `docs/patterns/config-governance.md`, and fix any grounded findings before marking done.
**Actual**: The `context-scrubber` skill/plugin is not available in this execute session (absent
from the session's skill list; no matching plugin installed under `.claude/`). Per root
`CLAUDE.md` § Teardown, its unavailability is recorded here and will be stated in the eventual PR
body rather than skipped silently.
**Reason**: Environment/session constraint, not a scope decision. The two edited files were
hand-reviewed for consistency with the rest of their own tables (matching the cited feature-125/
`analysis.series.max_concurrent_components` row format exactly) as a partial substitute.
