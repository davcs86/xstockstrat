# Design: live-strategy-opportunity-attribution

**Created**: 2026-08-13
**Rounds**: 4 (started `quick`, upgraded to full mid-debate at user direction; round 4 reopened at
user request after prior approval to force-resolve two deferred Open Risks; termination: approved)
**Approved by**: user @ 2026-08-14
**Grounded in**: recon.md

---

## Chosen Approach

**Repository/predicate.** New `StrategiesRepository.list_live_enabled()` (sibling of `list()`,
`app/repositories/strategies.py:147-161`), querying
`f"SELECT * FROM analysis.strategies WHERE {LIVE_ENABLED_PREDICATE_SQL}"` where
`LIVE_ENABLED_PREDICATE_SQL = "live_enabled = TRUE AND active = TRUE"` is a new module-level
constant in `strategies.py` (no leading underscore — it is designed for cross-module import, and a
private-looking name would misdirect a future reader). `live_loop.py:188-190`'s inline query becomes
a **one-line change**: import the same constant, interpolate it into the existing f-string.
`live_loop.py`'s constructor, wiring, and `self._db.fetch(...)` call-site shape are otherwise
completely untouched — this is deliberately *not* the shared-method refactor round 1 proposed and
was correctly rejected for (disproportionate blast radius on a tested, cooldown/transition-bearing
production loop for a one-line SQL predicate). The shared constant makes AC-5's "no drift" guarantee
**structural** (single source of truth for the `WHERE` clause) rather than test-asserted — a
re-declared-string parity test was considered and rejected: it would prove nothing about
`live_loop.py`'s actual query and degrade to "a comment reminding two files to stay in sync."

**Servicer changes**, inside `_compute_opportunities`
(`services/xstockstrat-analysis/app/handlers/servicer.py:2083-2242`), after the existing
`watchlist_by_symbol`/`signals_by_symbol`/`held_norm` indexes (`servicer.py:2102-2109`):

1. Call `list_live_enabled()`; build `live_by_symbol: dict[str, set[str]]` via
   `strategy_symbols(definition)` (imported from `live_loop.py:37-47` via a deferred/local import,
   mirroring the existing cross-module precedent for this exact helper at `servicer.py:1824`, which
   avoids a circular import — `live_loop.py` already imports `_row_to_strategy_definition` from
   `servicer.py` at module level). **Keys must be normalized**: `live_by_symbol.setdefault(
   _normalize_symbol(sym), set()).add(strat)` — mirroring `watchlist_by_symbol`'s construction
   *exactly*, including the `_normalize_symbol` call (`servicer.py:2542-2545`). `signal_params.symbols`
   has no write-time case/format validation (`evaluator.py`'s `_validate_definition` never touches
   it; `SetStrategyLive`'s precondition at `servicer.py:1838` only checks non-empty), so a live
   strategy configured with a lower/mixed-case symbol would otherwise silently fail to match
   `held_norm`/`signals_by_symbol`'s already-normalized keys — the feature would silently no-op for
   exactly those rows, invisible to the predicate-parity fix (which only guards the SQL predicate,
   not the key-space match).
2. Extend the `_candidate()` dict template (`servicer.py:2117-2127`) with a new field `"is_live": False`.
3. **Watchlist loop** (`servicer.py:2136-2140`): after tagging `"watchlist"`, additionally set
   `c["is_live"]=True` and call `_add_provenance(c, "live_strategy")` **if**
   `strat in live_by_symbol.get(sym, set())` — a per-strategy check, not a blanket per-symbol union
   (a blanket union would mis-tag a watchlist-bound strategy as "live" just because a *different*
   strategy on the same symbol happens to be live-enabled).
4. **Held loop** (`servicer.py:2144-2150`): `watch = watchlist_by_symbol.get(sym, set()); live =
   live_by_symbol.get(sym, set()); targets = list(watch | live) if (watch or live) else [""]`. For
   each `strat` in `targets`: unconditional `is_held=True`/`_add_provenance(c, "position")` (as
   today), **plus** `is_live=True`/`_add_provenance(c, "live_strategy")` **if** `strat in live`
   (per-strategy check).
5. **New bounded step**, inserted between the held loop and the signals-merge loop: iterate **only**
   `signals_by_symbol.keys() & live_by_symbol.keys()` (the intersection — never the full
   `live_by_symbol` key set). For each such `sym`, for each `strat in live_by_symbol[sym]`: call
   `_candidate(sym, strat)`, set `is_live=True`, add `"live_strategy"` provenance. This pre-seeds the
   row **before** the signals-merge loop (`servicer.py:2152-2168`) runs, so its existing
   `targets = [k for k in candidates if k[0] == sym]` lookup (`servicer.py:2155`) finds it instead of
   falling through to an unattributed `_candidate(sym, "")` row. **The intersection bound is load-
   bearing, not incidental**: `curated` candidates (below) are never subject to `max_universe_size`
   truncation — an unbounded iteration over the full `live_by_symbol` set would inject a fully-traced
   row (bars fetch + `evaluate_conditions_traced`) for every symbol any live strategy happens to
   cover, for every user, regardless of whether that user ever held, signaled, or watchlisted it.
6. **Curated predicate** (`servicer.py:2172-2177`):
   `curated = [c for c in candidates.values() if c["is_watchlist"] or c["is_held"] or c["is_live"]]`.
   For already-watchlist/held candidates this is a no-op (already `True`); it only changes outcomes
   for the signal-only case from step 5.

No other lines in `_compute_opportunities` change. Tracing (`servicer.py:2194-2212`) is unaffected —
it already keys off `c["strategy_id"]`/`c["is_held"]`, both correctly populated by the above; no new
trace mechanism is introduced (FR-2/FR-5's independent re-trace requirement).

**Consumer surface (C-14).** `xstockstrat-ui` `/insights` Opportunities page: no new page or
control. Previously-unattributed rows for held positions/active signals now surface a strategy's
readiness trace where a live strategy covers the symbol — an existing display path
(`Opportunity.strategy_id`/`passing_conditions`/`total_conditions`, `analysis.proto:447-459`) simply
populates more often.

## Rejected Alternatives

- **Refactoring `LiveEvaluationLoop.__init__`/`_run_cycle` to consume a shared repository method**
  (round 1) — rejected: not in product-spec's Affected Services, conflicts with its "purely read-side"
  framing, disproportionate blast radius (a tested, cooldown/transition-bearing production loop) for
  deduplicating a one-line SQL predicate.
- **Pure duplication of the `live_enabled=TRUE AND active=TRUE` predicate** (round 2's original text)
  — rejected: two independently-maintained SQL strings for the same predicate is exactly the drift
  risk AC-5 exists to close.
- **A behavioral parity test that runs `live_loop.py`'s real `_run_cycle()` against seeded fixtures
  and diffs against `list_live_enabled()`'s output** — considered as the "real tripwire" alternative
  to a shared constant; rejected as disproportionate (heavy mocking of marketdata/notify/evaluator)
  for a one-line predicate once the shared-constant option was available.
- **A test that re-declares the SQL string and asserts `list_live_enabled()` matches it** —
  rejected: proves nothing about `live_loop.py`'s actual query; a future edit to that inline query
  with no corresponding test update would go undetected.
- **A full shared `StrategiesRepository` method call from `live_loop.py`** (the DRY guard rail's own
  literal preference, recon.md:79-80) — neither this nor pure duplication was taken; the shared
  **constant** (not method) is the resolution that honors DRY's actual concern (single source of
  truth for the `WHERE` clause) without DRY's usual remedy (a shared call site), since
  `live_loop.py`'s `self._db.fetch(...)` call-site structure stays untouched.
- **Normalizing inside `strategy_symbols()` itself** (upstream, in `live_loop.py`) rather than at the
  `live_by_symbol` call site — would close the gap for every current/future caller, but touches a
  function the live loop's own bar-fetch path also depends on; same blast-radius reasoning that
  rejected the shared-method refactor applies, so normalization is applied at the call site instead.
- **Retiring the `by_symbol`-keyed test helper `_list_opps`** in favor of a `(symbol, strategy_id)`-
  keyed default — safer long-term, but causes churn to existing passing tests for a benefit only this
  and future multi-row-per-symbol features need; a new sibling helper (not a replacement) is the
  narrower fix.
- **Iterating the full `live_by_symbol` key set in the new step 5** (round 1's original,
  underspecified text) — rejected: bypasses `max_universe_size` truncation via the `curated` bucket,
  creating unbounded per-request compute cost (bars fetch + trace per symbol) for symbols the user
  never held, signaled, or watchlisted.

## Open Risks

- [ ] **Test-helper incompatibility, now precisely scoped**: the test suite's `_list_opps` helper
  (`test_analysis_servicer.py:3676-3680`) groups `resp.opportunities` by `symbol` alone
  (`{o.symbol: o for o in resp.opportunities}`) — incompatible with FR-4's requirement that distinct
  `(symbol, strategy_id)` pairs each produce their own row (e.g. a watchlist-bound strategy A and a
  live-only strategy B both covering the same symbol). New tests exercising this scenario must group
  by `(o.symbol, o.strategy_id)` or use a new sibling helper — to be resolved at `/sdd-spec` in the
  same step that adds the multi-strategy-per-symbol test. Co-locate this with the `_strat_row`
  `signal_params` extension noted above (round 4) — both are test-harness prerequisites for the same
  new test class of scenarios, not independent fixes.
- [ ] **Compute fan-out, not just membership growth**: `curated`'s bypass of `max_universe_size`
  previously bounded fan-out by a user's own watchlist size (small, user-controlled). Step 5 can now
  curate one row per live strategy covering a signaled symbol — platform-operator-controlled, not
  user-controlled or capped anywhere. Each curated row costs an independent `_fetch_bars_paged` call
  (`servicer.py:2188-2213`, per-row not per-symbol) in a single synchronous, compute-on-read RPC. This
  is an intended consequence of AC-4/FR-6 (not a regression), but is named here as a residual latency
  risk for `/sdd-spec` to weigh, not silently accepted.
- [x] **Insertion-order test fragility — RESOLVED (round 4), safe.** Read every assertion in
  `TestListOpportunitiesMaterialized` (`test_analysis_servicer.py:3683-3877`): all assert
  set/membership (`set(by_symbol) == {...}`), dict-key lookup (`by_symbol["SYM"]`), or `len(opps)` —
  none iterate `candidates`/`resp.opportunities` positionally except
  `test_ranked_by_conviction_and_signal_axis` (`:3790-3800`), whose order comes from an explicit
  downstream rank-sort in `_FakeOppRepo.read()` (`:3552`), mirroring the real `ORDER BY` in
  `app/repositories/opportunities.py:112` — fully decoupled from `_compute_opportunities`'s internal
  `candidates` dict build order (`servicer.py:2111-2177`). The watchlist → held → new step-5 →
  signals-merge reorder cannot regress this suite. **Caveat carried forward, not blocking**: none of
  the existing suite's `_strat_row` fixtures configure `signal_params.symbols`
  (`test_analysis_servicer.py:3608-3630` has no such field), so this reorder-safety finding is
  necessarily a no-op check against the *current* suite — the step-5 code path is genuinely exercised
  for the first time by the *new* tests this feature adds, which haven't been written yet. Also
  surfaced: `_strat_row` needs extending with a `signal_params` option (or a sibling helper) to write
  those new tests at all — a `/sdd-spec` step, tracked alongside the `_list_opps` item below (C-13:
  second consumer forces centralization, not ad hoc inline `StrategyDefinition(signal_params=...)`
  per test).
- [x] **C-12 fixture obligation — RESOLVED (round 4), no fixture change needed.** The real closing
  argument (corrected from round 4's first pass, which over-relied on a `provenance`-only grep): the
  UI *does* render the other three fields this feature newly populates —
  `services/xstockstrat-ui/src/app/insights/opportunities/page.tsx:333-341` renders
  `{passingConditions}/{totalConditions}`, `:354-356` renders `strategyId` — but an **existing** e2e
  assertion already exercises exactly this rendering path:
  `services/xstockstrat-ui/e2e/insights/opportunities.spec.ts:70-72` asserts `getByText('4/5')` and
  `getByText('strat-001')` against a fixture row with real (non-`0/0`) values
  (`e2e/fixtures/opportunities.ts:12-24`), explicitly commented "an attributed row carries REAL
  passing/total... not 0/0." Since the e2e mock is static and provenance-blind
  (`e2e/mock-backend.ts:547-550` serves `OPPORTUNITIES` filtered only by `min_conviction`, never
  routing through `_compute_opportunities`), a row's *origin* (watchlist vs. live-strategy) is
  invisible to the UI/test either way — the backend attribution change doesn't alter what the UI
  renders or how it's tested. No new fixture, no `INVENTORY.md` row.

## Constitution Rules Touched

- `C-01` (zero-assumption / evidence-cited) — honored: every claim across 3 rounds + 1 verification
  pass cites `recon.md`/real `path:line`; the symbol-normalization gap and the test-helper
  incompatibility were both caught by tracing actual code, not trusting the design's own prose.
- `C-08` (test-step pairing) — honored: the `_list_opps` helper incompatibility is resolved before
  `/sdd-spec`, not left for execute-time discovery to stumble into.
- `C-10(b)` (parity across duplicated surfaces) — honored: the `live_enabled=TRUE AND active=TRUE`
  predicate has exactly one textual source (`LIVE_ENABLED_PREDICATE_SQL`), imported by both
  `list_live_enabled()` and `live_loop.py` — structural parity, not a maintained-by-convention pair.
- `C-14` (name the consumer surface) — honored: `/insights` named explicitly; no new UI element
  required, an existing display path populates more often.
- `P-01`/`P-02` — honored: all rounds' proposer/adversary pairs mediated exclusively through
  synthesized state passed by this orchestrator.
- `P-03` (no silent deviation) — honored: every fork (repo-method-vs-raw-SQL, shared-method-vs-
  constant-vs-duplication, bounded-vs-unbounded step 5, normalization) was surfaced and explicitly
  decided, none defaulted silently.
- No `F-*` breach was flagged at any round.
