# Design: live-strategy-opportunity-attribution

**Created**: 2026-08-13
**Rounds**: 4 (started `quick`, upgraded to full mid-debate at user direction; round 4 reopened at
user request after prior approval to force-resolve two deferred Open Risks) + a post-approval
amendment (compute-fan-out fix, 2 verification passes — 2 rejected attempts before the adopted
mechanism, per Rejected Alternatives; user explicit sign-off on the resulting product-spec.md
changes); termination: approved
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
3. **Per-symbol fan-out cap — read `analysis.opportunity.max_live_strategies_per_symbol`
   (int, default `5`) once, alongside `max_universe_size` (`servicer.py:2172`). Define
   `_capped_live(sym, exclude=frozenset())` returning
   `sorted(live_by_symbol.get(sym, set()) - exclude, key=lambda strat: created_at_by_strategy[strat])[:cap]`
   — a helper local to `_compute_opportunities`, backed by a `strategy_id → created_at` map built
   alongside `live_by_symbol` in step 1 (from the same `list_live_enabled()` rows). **Tiebreak is
   `created_at` ascending (oldest-registered-first), not lexicographic `strategy_id`** — an
   alphabetically-sorted slug rewards whoever named a strategy earliest in the alphabet, with no
   relation to relevance or quality; `created_at` at least reflects an established track record, and
   mirrors `StrategiesRepository.list()`'s own `ORDER BY created_at` precedent (`strategies.py:155`,
   descending there; ascending here is a deliberate choice — the cap favors the strategies a user
   has lived with longest, not the newest). **This cap applies only at the two candidate-*creation*
   sites (steps 4's live-only delta and step 5) — never at a tagging-only read (step 3's watchlist
   loop, or step 4's `watch`-intersection branch).** Capping a tagging-only read would silently strip
   the `"live_strategy"` tag from an already-existing, already-curated candidate (a watchlist-bound
   or held strategy that also happens to be live) purely because other strategies "won" the cap slots
   for that symbol — a real AC-3 violation caught during design (see Rejected Alternatives): tagging
   an existing row costs no additional compute, so it must never be capped, only *creating* a new row
   costs compute and needs the bound.
4. **Watchlist loop** (`servicer.py:2136-2140`): after tagging `"watchlist"`, additionally set
   `c["is_live"]=True` and call `_add_provenance(c, "live_strategy")` **if**
   `strat in live_by_symbol.get(sym, set())` (the **full, uncapped** index — tagging-only, zero
   marginal cost) — a per-strategy check, not a blanket per-symbol union (a blanket union would
   mis-tag a watchlist-bound strategy as "live" just because a *different* strategy on the same
   symbol happens to be live-enabled).
5. **Held loop** (`servicer.py:2144-2150`): `watch = watchlist_by_symbol.get(sym, set()); live_all =
   live_by_symbol.get(sym, set()); live_new = _capped_live(sym, exclude=watch); targets =
   list(watch | set(live_new)) if (watch or live_new) else [""]`. For each `strat` in `targets`:
   unconditional `is_held=True`/`_add_provenance(c, "position")` (as today), **plus**
   `is_live=True`/`_add_provenance(c, "live_strategy")` **if** `strat in live_all` (the full,
   uncapped set — so a `strat ∈ watch` that's also genuinely live is always tagged correctly,
   regardless of the cap; only `live_new`, the capped live-only delta, is bounded).
6. **New bounded step**, inserted between the held loop and the signals-merge loop, bounded by TWO
   independent caps composed together (added across a 3-round follow-up debate, 2026-08-14 — see
   Open Risks and `context.md` for the full history; the mechanism below is the final, adversary-
   verified form, not the original single-cap version):

   ```python
   def _new_live_strats(sym):
       # per-(symbol, strategy) newness check — NOT a symbol-level "already curated" check.
       # A symbol that already has *some* candidate (e.g. watchlist-bound to strategy A) can
       # still have additional, distinct (symbol, strategy) pairs left to create (e.g. live
       # strategy B, not watchlist-bound) — FR-4 requires each such pair to become its own row.
       return [s for s in _capped_live(sym) if (sym, s) not in candidates]

   def _max_signal_conviction(sym):
       return max(sig.conviction for sig in signals_by_symbol[sym])

   live_signal_symbols = signals_by_symbol.keys() & live_by_symbol.keys()
   competitive_pool = [sym for sym in live_signal_symbols if _new_live_strats(sym)]

   max_live_only_symbols = self._cfg.get_int(
       "analysis.opportunity.max_live_only_symbols_per_compute", 20
   )
   ranked_symbols = sorted(
       competitive_pool,
       key=lambda sym: (-_max_signal_conviction(sym), sym),  # conviction desc, sym asc tiebreak
   )[:max_live_only_symbols]

   for sym in ranked_symbols:
       for strat in _new_live_strats(sym):
           c = _candidate(sym, strat)
           c["is_live"] = True
           _add_provenance(c, "live_strategy")
   ```

   **Cap 1 (pre-existing): `_capped_live(sym)`'s own `max_live_strategies_per_symbol` bound**
   (step 3) — how many strategies-per-symbol. **Cap 2 (this round): `max_live_only_symbols_per_compute`**
   (int, default `20`) — how many *distinct symbols* this step is allowed to process in one compute
   pass, applied to `signals_by_symbol.keys() & live_by_symbol.keys()` (the intersection — never the
   full `live_by_symbol` key set) **before** any candidate is created. The two caps compose
   multiplicatively, not additively: worst case is `20 × 5 = 100` new rows from this step alone
   (both defaults) — a future reader must not read "20" as a row-count ceiling.

   **Why per-`(symbol, strategy)` newness, not per-symbol "already curated"** (this is the load-
   bearing correctness property of the whole step, found via 3 rounds of adversarial iteration —
   see Rejected Alternatives): a symbol-level "has this symbol already got *a* candidate" check
   would silently exclude a symbol from the competitive pool even when it still has a genuinely new
   `(symbol, strategy)` pair to create — e.g. symbol X watchlisted to strategy A (candidate `(X,A)`
   already exists) but also covered by live strategy B, not watchlist-bound to X: a symbol-level
   check would drop X from the pool entirely, silently violating FR-4 (which requires `(X,B)` to
   become its own row). `_new_live_strats` correctly returns `[B]` for X (non-empty, since
   `(X,B) ∉ candidates`), so X still competes for a slot and, if selected, `(X,B)` gets created —
   `(X,A)` is untouched, already correct from the watchlist loop.

   **Why `_capped_live(sym)` with no `exclude` here (not `_capped_live(sym, exclude=already_here)`)
   — provable, not incidental**: let `T = _capped_live(sym)` (the fixed cap-sized window, oldest-
   `created_at`-first) and `W` = whatever the held loop already created for `sym` (its own
   `watch ∪ live_new` union, step 5). For any `W ⊆ S` (the full live set), `T \ W ⊆
   _capped_live(sym, exclude=W)` always holds — removing elements from the ranking pool before a
   top-`cap` slice can only keep or promote an element's rank, never demote it. So **every element
   of `T` already exists as a candidate by the time step 6 runs, whenever the held loop already
   processed that symbol** — `_new_live_strats(sym)` naturally returns `[]` for a fully-held symbol
   with no extra work needed, with no separate exclusion logic required. The tempting-looking
   alternative — `_capped_live(sym, exclude=existing_strats_for_sym)` computed *before* capping —
   is actually **wrong**: excluding first and capping second re-opens the ranking window into
   strategies beyond the original `cap`, and can push a symbol's total attributed-strategy count
   past `max_live_strategies_per_symbol` (e.g. 5 from the held loop + 3 more from this step = 8,
   violating AC-7's own per-symbol bound). **This ordering dependency is real but non-obvious and
   untested — `/sdd-spec` should add either a code comment on `_capped_live` stating the
   exclude-before-slice order is load-bearing for this cross-site composition, or a unit test with a
   symbol that is both held and signal-covered, with `watch` strategies scattered inside/outside the
   cap window, asserting the per-symbol total never exceeds the cap.**

   This pre-seeds the row **before** the signals-merge loop (`servicer.py:2152-2168`) runs, so its
   existing `targets = [k for k in candidates if k[0] == sym]` lookup (`servicer.py:2155`) finds it
   instead of falling through to an unattributed `_candidate(sym, "")` row. **All three bounds — the
   per-strategy cap, the per-compute-pass distinct-symbol cap, and the intersection restriction —
   are load-bearing, not incidental**: `curated` candidates (below) are never subject to
   `max_universe_size` truncation — an unbounded iteration over either dimension (strategies sharing
   a popular symbol, or distinct signal-covered symbols in one pass) would inject fully-traced rows
   (bars fetch + `evaluate_conditions_traced`) with no ceiling tied to `max_universe_size`.
7. **Curated predicate** (`servicer.py:2172-2177`):
   `curated = [c for c in candidates.values() if c["is_watchlist"] or c["is_held"] or c["is_live"]]`.
   For already-watchlist/held candidates this is a no-op (already `True`); it only changes outcomes
   for the signal-only case from step 6. **This predicate is unconditional for every candidate that
   exists** — the per-symbol cap (step 3) operates strictly upstream, at candidate-*creation* time;
   it never demotes an existing curated candidate to speculative (which would have re-created the
   AC-4 conflict found and rejected during design — see Rejected Alternatives).

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
- **Capping step 5's own promotion count against `max_universe_size`, sorted by `signal_axis`
  descending** (first fan-out-fix attempt) — rejected on adversarial re-verification: `signal_axis`
  is `0.0` for every step-5 candidate at the point step 5 runs (it's populated by the signals-merge
  loop, which runs *after* step 5 by design); the cap's own count didn't bound *total* curated size
  (could overshoot `max_universe_size` and zero out the unrelated speculative bucket); sorting over
  Python `set`s with tied `signal_axis` values is non-deterministic; and it left the held loop's
  identical fan-out vector completely unaddressed (an unverified "steps 3/4 are already bounded"
  absence claim — the exact `fails.md` 2026-07-30 trap).
- **Truncating the shared `live_by_symbol` index itself, uniformly, before any consumer reads it**
  (second fan-out-fix attempt) — rejected on adversarial re-verification: `live_by_symbol` has three
  consumers, only two of which cost compute (candidate *creation* — the held loop's live-only delta
  and step 6). The watchlist loop's read and the held loop's `watch`-intersection read are
  *tagging-only* — the candidate already exists unconditionally, so truncating the shared index there
  silently strips the `"live_strategy"` tag from an already-existing, already-curated candidate purely
  because other strategies "won" the cap slots for that symbol, at zero compute savings — a literal
  AC-3 violation. Fixed by capping only at the two creation sites (`_capped_live`), never the shared
  index used for tagging.
- **Lexicographic `strategy_id` as the per-symbol cap's tiebreak** — rejected in favor of `created_at`
  ascending: a user-supplied slug sorted alphabetically rewards whoever named a strategy earliest in
  the alphabet, with no relation to relevance, recency, or quality, and a newly-added better strategy
  targeting a popular symbol could never surface once that symbol is at cap.
- **A new, independently-tuned config key instead of deriving the cap from `max_universe_size`** —
  actually the chosen approach (`analysis.opportunity.max_live_strategies_per_symbol`, a new key): the
  alternative of reusing `max_universe_size` as a shared budget was rejected because it bounds a
  different dimension (total curated *rows*, an existing consumer) than this cap needs (live
  strategies *per symbol*, a new dimension) — conflating them caused the overshoot bug above.
- **Symbol-level "already curated" exclusion for the distinct-symbol cap** (round 2 of the follow-up
  debate closing the distinct-symbol-count Open Risk) — computing `already_curated_symbols = {k[0]
  for k in candidates}` and filtering the step-6 competitive pool against it looked correct (avoids
  wasting cap slots on symbols needing no protection) but operates at the wrong granularity: `FR-4`
  requires per-`(symbol, strategy)` distinctness, and a symbol can have *some* candidate (e.g.
  watchlist-bound to strategy A) while still having a genuinely new pair to create (live strategy B,
  not watchlist-bound) — the symbol-level check would silently drop that pair, a real regression
  against an already-approved FR. Rejected in favor of the per-`(symbol, strategy)` newness check
  (`_new_live_strats`, round 3, adopted) that only excludes a symbol once it has zero remaining new
  pairs, not merely because it already has one candidate.
- **`_capped_live(sym, exclude=already_here)` — excluding existing pairs before capping, instead of
  capping first then filtering for newness** (considered and rejected during round 3's verification,
  not a prior round's actual proposal) — proven wrong, not just less clean: excluding first re-opens
  the ranking window into strategies beyond the original `cap`, and can push a symbol's total
  attributed-strategy count past `max_live_strategies_per_symbol` (e.g. 5 from the held loop + 3 more
  from step 6 = 8) — a direct AC-7 violation. `_capped_live(sym)` with no `exclude`, then filtering
  the fixed-size result for newness, is the only order that provably composes correctly (see Chosen
  Approach step 6's proof).
- **Cross-pass hysteresis for the distinct-symbol cap** (to prevent a symbol's curated row from
  appearing/disappearing between consecutive daily refreshes as signal conviction shifts near the cap
  boundary) — rejected: `OpportunitiesRepository.replace_for_user` is a stateless DELETE+INSERT per
  user with no carried state across passes; persisting cap-decision state would be real new state
  grafted onto a stateless write model for a ~daily-cadence cosmetic risk, against this codebase's
  "write minimum" bias already applied to reject more-elaborate fixes above. Documented instead as
  AC-8's explicit trade-off (no cross-pass hysteresis, a previously-curated row can vanish silently).

## Open Risks

- [x] **Test-helper incompatibility — CLOSED, not required (explicit user decision, 2026-08-14).**
  The `_list_opps` helper's by-`symbol` grouping (`test_analysis_servicer.py:3676-3680`) is still
  factually incompatible with asserting FR-4's multi-strategy-per-symbol case in a new test — that
  finding stands, unchanged. What's closed is the *coverage decision*: the user explicitly chose not
  to require a dedicated multi-strategy-per-symbol test (or the `_list_opps`/`_strat_row` harness
  extensions that would enable one) as part of this feature. This is a scope waiver, not a technical
  resolution — FR-4's underlying *behavior* (distinct `(symbol, strategy_id)` pairs still produce
  distinct rows, via the existing `_candidate()` dict-key mechanism) is unaffected and still holds;
  only the dedicated *test* for that specific multi-strategy-same-symbol scenario is waived. If a
  regression in that exact behavior ever occurs, this suite gap is why it wouldn't be caught —
  recorded here so that's a known, chosen trade-off, not a silent gap discovered later.
- [x] **Compute fan-out — FULLY RESOLVED (post-approval amendment 2026-08-14, plus a 3-round
  follow-up debate the same day).** The **strategies-per-symbol** dimension (many live strategies
  sharing one popular symbol) is bounded by `analysis.opportunity.max_live_strategies_per_symbol`
  (default `5`), enforced at both candidate-creation sites via `_capped_live()` — see Chosen Approach
  step 3; AC-7. The **distinct-symbol-count** dimension (`signals_by_symbol.keys() &
  live_by_symbol.keys()`'s size, step 6's iteration domain) — previously left open — is now bounded
  by a second, orthogonal config key `analysis.opportunity.max_live_only_symbols_per_compute`
  (default `20`), ranking eligible symbols by max active-signal conviction descending; see Chosen
  Approach step 6; AC-8. **This second fix took 3 follow-up rounds to get right**: round 1's cap
  correctly avoided the two previously-rejected bugs (sorting on a not-yet-computed field, non-
  deterministic tiebreak) but round 2's naive fix for a newly-found starvation bug (a symbol-level
  "already curated" exclusion wasting cap slots on symbols needing no protection) introduced a
  *regression* against FR-4 — silently dropping legitimate `(symbol, strategy)` pairs for
  watchlist-bound symbols with cross-strategy live coverage. Round 3 corrected this to a
  per-`(symbol, strategy)` newness check (`_new_live_strats`), verified via a direct proof that it
  composes correctly with the pre-existing per-strategy cap with no double- or under-counting — see
  Chosen Approach step 6 for the full mechanism and proof, and `context.md` for the round-by-round
  history. Required product-spec.md changes, made with the user's explicit sign-off: the new config
  key (Config Key Changes section) and new **AC-8** documenting the per-pair eligibility rule, the
  ranking/tiebreak, and the compound (multiplicative, not additive) worst-case row count. **New,
  deliberately deferred residual gap, recorded rather than silently dropped**: the held-symbol-count
  dimension — see the new Open Risk line immediately below.
- [ ] **Held-symbol-count fan-out — OPEN, deliberately deferred (follow-up round, 2026-08-14).** A
  user holding an unusually large number of *distinct* symbols, each covered by at least one live
  strategy, still produces one curated row per `(symbol, strategy)` pair via the held loop with no
  cap on the number of *distinct held symbols* itself — only the per-symbol strategy count (AC-7) and
  the step-6 signal-only distinct-symbol count (AC-8) are now bounded; `held_norm`'s own size is not.
  Verified directly, not assumed: no service enforces a ceiling on distinct held-symbol count —
  `trading.risk.max_position_pct`/`max_concentration_pct` (`services/xstockstrat-trading/
  CLAUDE.md:66,70`) bound single-position *size* relative to equity, not symbol *count*, and
  `portfolio.risk.max_drawdown_pct` is explicitly unenforced (`services/xstockstrat-portfolio/
  CLAUDE.md:47`) — an earlier draft of this reasoning incorrectly assumed a risk cap covered this;
  corrected here. **Deferred, not fixed**, because growing this dimension requires N real
  `order.filled` events per symbol (`servicer.py:2384-2409`, `portfolio/CLAUDE.md:62`) — actual
  capital, an actual broker fill — a materially higher-friction, slower-growing vector than the two
  now-capped zero-marginal-cost vectors (strategies-per-symbol, distinct signal-only symbols), plus a
  loose structural ceiling already exists from `_MAX_DRAIN_PAGES=50 × _BAR_PAGE_SIZE=1000`
  (`servicer.py:94,107`, ~50,000 positions). Revisit if real-world held-symbol counts are ever
  observed approaching that ceiling.
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
- `C-05` (config key naming) — honored: `analysis.opportunity.max_live_strategies_per_symbol`
  follows `<service>.<category>.<key>`, sibling to the existing `analysis.opportunity.*` keys; must be
  added to `services/xstockstrat-analysis/CLAUDE.md`'s Config Keys Consumed table and
  `docs/patterns/config-governance.md`'s Per-Feature Registered Keys log at `/sdd-spec`/execute time
  (not now — the key doesn't exist in running code yet).
- `F-07` (never hardcode config values) — to be honored at implementation: the cap must be read via
  the existing `self._cfg.get_int(...)`/`ConfigWatcher` pattern this function already uses for
  `max_universe_size`, not hardcoded — flagged explicitly so `/sdd-spec` doesn't hardcode the default
  as a Python literal.
- `C-11`/`P-04` (Commandment override requires explicit user sign-off, recorded) — honored: AC-4's
  amendment (adding AC-7's cap) and the new config key both required and received explicit user
  sign-off (`AskUserQuestion`, "Full fix: cap both step 4 + 5, amend AC-4", 2026-08-14) before being
  written into product-spec.md — not silently narrowed.
- `P-01`/`P-02` — honored: all rounds' proposer/adversary pairs mediated exclusively through
  synthesized state passed by this orchestrator.
- `P-03` (no silent deviation) — honored: every fork (repo-method-vs-raw-SQL, shared-method-vs-
  constant-vs-duplication, bounded-vs-unbounded step 5, normalization) was surfaced and explicitly
  decided, none defaulted silently.
- No `F-*` breach was flagged at any round.
