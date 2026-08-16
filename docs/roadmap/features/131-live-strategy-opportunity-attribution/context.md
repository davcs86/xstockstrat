# Context: live-strategy-opportunity-attribution

**Feature**: `docs/roadmap/features/131-live-strategy-opportunity-attribution/feature.md`
**Product Spec**: `docs/roadmap/features/131-live-strategy-opportunity-attribution/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/131-live-strategy-opportunity-attribution/implementation-spec.md`

---

## Session 2026-08-13T00:00:00Z — sdd-story

- Created feature.md (status: draft), product-spec.md, context.md from user story.
- Feature number assigned: 131 (created immediately after 134-signal-source-reliability-weight in
  the same session — recomputed `max(NNN)+1` fresh before this directory, not reused from a stale
  count).
- Story originated from conversational design-scouting. The user's initial framing — "all symbols
  are evaluated against all live strategies in the live loop" — was corrected during scouting:
  `strategy_symbols()` (`live_loop.py:37-47`) shows each live-enabled strategy evaluates only its
  own explicit `signal_params.symbols` list; strategies with no symbols are skipped entirely. The
  product spec is written against the corrected mechanism, not the original framing.
- Confirmed by direct code read (not docs): `main.py` constructs `live_loop` and never hands the
  servicer a reference to it (`servicer._live_loop` does not exist, unlike
  `servicer._fundsignal_loop = fundsignal_loop` at `main.py:149`) — so reaching into the live loop's
  private in-memory state was ruled out as the FR-5 direction before design even started; an
  independent re-trace (mirroring the existing watchlist-attribution pattern) was chosen as the
  scoped approach instead. This is recorded as a design constraint in the spec (FR-5), not left for
  `/sdd-design` to rediscover.
- Confirmed no proto change is needed: `Opportunity.provenance` (`analysis.proto:458`) is already
  `repeated string`, so a new `"live_strategy"` origin tag needs no proto edit.
- Ledger checked (fails.md/insights.md): flagged the 023-position-sizing-engine
  ordinal-vs-cardinal `Opportunity.conviction` trap in Open Questions as a guardrail, though this
  feature does not touch the conviction formula itself.

## Session 2026-08-13T00:10:00Z — sdd-review product-spec

- Product spec approved. Status: draft → spec-ready.
- Criteria verdict: PASS WITH WARNINGS. Warnings: (1) both Open Questions remain unchecked —
  reviewer judged both legitimately deferred to `/sdd-design` rather than spec gaps, but recommends
  making OQ1's deferral as explicit as OQ2's phrasing already is; (2) FR-2's citation
  (`servicer.py:2144-2168`, labeled "attribution/trace step") covers only the attribution/provenance
  code — the actual `evaluate_conditions_traced` call is at `servicer.py:2205-2209`; tighten this
  citation at `/sdd-spec` time (C-01); (3) AC-2/AC-6 are qualitative rather than quantitative —
  acceptable per the criteria's WARN allowance, but design/spec phase should pin down exact test
  assertions.
- Overlap findings: none. Confirmed CLEAN against all 9 other active-status features scanned;
  `125-unified-symbol-page` shares `xstockstrat-analysis` and even reads `ListOpportunities`, but
  only as a read-only consumer — it never touches `_compute_opportunities` or `StrategiesRepository`.

## Session 2026-08-13T00:30:00Z — fix review warnings

- Fixed all three advisory warnings from the sdd-review pass:
  - FR-2's citation split into the correct two ranges: `servicer.py:2144-2168` now labeled
    specifically as the attribution/provenance-building step, with the actual
    `evaluator.evaluate_conditions_traced` call site cited separately at `servicer.py:2205-2209`.
  - AC-2 and AC-6 rewritten to be quantitative: AC-2 now states `passing_conditions`/
    `total_conditions` must reflect real evaluated leaves (not `0/0`) and `total_conditions` must
    equal the strategy's entry-rule leaf count exactly; AC-6 now states byte-identical
    `strategy_id`/`passing_conditions`/`total_conditions`/`provenance` before/after a live-loop
    restart, given unchanged market data.
  - OQ1 (the `023-position-sizing-engine` guardrail) reworded to explicitly say it's a guardrail
    check to carry into `/sdd-design` and re-confirm, not a decision to resolve now — mirrors OQ2's
    already-explicit "decide at `/sdd-design`" phrasing per the reviewer's suggestion.

## Session 2026-08-14T00:00:00Z — sdd-design

- Phase 0 Recon: wrote recon.md (services: xstockstrat-analysis only; key reuse patterns:
  `watchlist_by_symbol`'s index shape, `strategy_symbols()`, `_add_provenance`/`_candidate`).
  Surfaced a nuance not in the product spec: `curated` classification is keyed on
  `is_watchlist`/`is_held`, not attribution — a held position with live-strategy coverage is
  *already* curated today, it just isn't traced. FR-6's real scope is narrower than its text implies
  (only changes outcomes for signal-only candidates).
- Phase 1 Grilling: started `quick` mode (1 mandated round); the mandated round found a real
  unbounded-cost bug (an under-bounded "step 1b" would inject fully-traced candidate rows for every
  symbol any live strategy watches, bypassing `max_universe_size` since `curated` rows are never
  truncated) plus scope creep (refactoring `live_loop.py`'s constructor/wiring for a one-line SQL
  predicate, outside the spec's stated blast radius). **User explicitly upgraded to full mode**
  ("run it in deep mode") rather than accept these as documented risks. Round 2 fixed both: bounded
  the new step to `signals_by_symbol.keys() & live_by_symbol.keys()` only, added per-strategy
  provenance checks (not blanket unions) to the watchlist/held loops, and adopted the safer fallback
  (servicer-only `list_live_enabled()`, `live_loop.py` left untouched). Round 3 closed a remaining
  ambiguity (predicate-parity mechanism — resolved as a shared constant, not a test, since a
  re-declared-string test would prove nothing about `live_loop.py`'s real query) plus two
  documentation-only items. A final verification pass (still round 3) caught two more real gaps by
  re-tracing the combined design against actual code rather than trusting the accumulated prose: a
  missing `_normalize_symbol()` call on `live_by_symbol`'s keys (would silently no-op for
  mixed-case-configured live strategies) and a test-helper (`_list_opps`) incompatible with FR-4's
  multi-strategy-per-symbol requirement. Both folded directly into `design.md` (adversary judged them
  mechanical, not architectural — no round 4 needed).
- Chosen approach: `StrategiesRepository.list_live_enabled()` (servicer-only), a shared
  `LIVE_ENABLED_PREDICATE_SQL` constant imported by both the new repo method and `live_loop.py`'s
  existing inline query (one-line touch, no constructor/wiring change), a new `live_by_symbol` index
  folded into the existing held/watchlist/signals loops via per-strategy provenance checks, bounded
  strictly to `signals_by_symbol.keys() & live_by_symbol.keys()` for the signal-only case. Rejected:
  the full shared-method refactor, pure duplication, a behavioral parity test, an unbounded step.
- Constitution rules touched: C-01, C-08, C-10(b), C-14, P-01, P-02, P-03 — all honored, no Floor
  breach at any round.
- Status: spec-ready → design-approved.
- **Process note**: this debate is a second consecutive case (after 134, same session) where a
  design that read as complete and responsive to the prior round's objection had a real, code-
  verifiable gap only a fresh re-trace against actual source caught — reinforces the
  `insights.md` 2026-08-13 entry rather than needing a new one.

## Session 2026-08-14T00:10:00Z — sdd-design round 4 (reopened by user)

- User asked to "run round 4" ambiguously right after 131's approval; clarified via
  `AskUserQuestion` — user meant reopening 131's already-approved debate for another round, not
  starting 022's design phase.
- Round 4 targeted the two Open Risks design.md had explicitly deferred to `/sdd-spec` rather than
  resolving ("check... not assumed safe" / "confirm at `/sdd-spec`"): insertion-order test fragility
  and the C-12 fixture obligation.
- Proposer resolved both by reading the actual test/UI code rather than reasoning abstractly: (1)
  every existing `TestListOpportunitiesMaterialized` assertion is set/membership/dict-key-based
  except one, whose order comes from an explicit downstream rank-sort decoupled from `candidates`
  dict build order — reorder is safe against the current suite. (2) initially closed C-12 via a
  `provenance`-grep (zero UI consumers) — adversary correctly pushed back that this didn't answer
  whether the UI reads the *other* three newly-populated fields (`strategy_id`/`passing_conditions`/
  `total_conditions`); re-verified and found the real answer: it does render them, but an *existing*
  e2e test (`opportunities.spec.ts:70-72`) already exercises that exact path with non-`0/0` fixture
  values, and the mock is provenance-blind either way — no new fixture needed.
- Adversary verdict: SOUND, with one correction (cite the existing e2e test, not just the grep) and
  one new spec-time note (the `_strat_row` test helper has no `signal_params` support — needed to
  write the new tests this feature requires at all; co-located with the existing `_list_opps`
  test-helper Open Risk as a shared prerequisite, not two independent fixes).
- `design.md` updated in place: two Open Risks marked resolved with full citation trails, `Rounds`
  updated to 4, the two genuinely-still-open risks (test-helper incompatibility, compute fan-out)
  left as-is — confirmed untouched by this round, not implicitly closed by proximity.
- Status: design-approved (unchanged) — round 4 didn't flip lifecycle, it strengthened the existing
  approval's evidence trail.

## Session 2026-08-14T00:20:00Z — post-approval amendment: compute fan-out fix + test-helper closure

- User: "close the e2e test as not required. Required compute fan-out, try to fix it" — mapped
  (correctly, per the parallel structure of my own prior status summary listing exactly these two
  remaining Open Risks) to: close "test-helper incompatibility" as an explicit scope waiver, and
  actually design/verify a fix for "compute fan-out" rather than leave it as a documented trade-off.
- **Test-helper incompatibility**: closed as an explicit user-directed scope waiver, not a technical
  resolution — recorded precisely as such (the `_list_opps` incompatibility finding still stands;
  what's waived is requiring a dedicated test for the multi-strategy-per-symbol scenario).
- **Compute fan-out**: two proposed fixes were adversarially verified and both had real bugs, caught
  before either was written into design.md:
  1. First attempt (cap step 5's own count against `max_universe_size`, sorted by `signal_axis`) —
     4 bugs: `signal_axis` read before it's computed (step 5 runs before the loop that sets it),
     budget-overshoot into the unrelated speculative bucket, non-deterministic set-order sorting, and
     — the load-bearing one — left the held loop's *identical* fan-out vector completely unaddressed,
     an unverified "steps 3/4 are already bounded" absence claim (the exact `fails.md` 2026-07-30
     trap this repo's own ledger tracks).
  2. Asked the user to choose scope given the held-loop gap: full fix (cap both, amend AC-4) / step-5
     only / revert to documented trade-off. **User chose the full fix.**
  3. Second attempt (truncate the shared `live_by_symbol` index itself, uniformly) — 1 more real bug:
     the index has three consumers, only two of which cost compute (candidate creation); truncating it
     for the *tagging-only* reads (watchlist loop, held loop's watchlist-intersection branch) would
     silently strip the `"live_strategy"` tag from an already-existing, zero-marginal-cost candidate —
     a literal AC-3 violation.
  4. Adopted mechanism (verified sound): a new config key
     `analysis.opportunity.max_live_strategies_per_symbol` (default 5), a `_capped_live()` helper
     applied **only** at the two candidate-creation sites (held loop's live-only delta, the new
     signal-only step), tiebroken by `created_at` ascending (not lexicographic `strategy_id`, which
     would reward alphabetically-early user-chosen slugs with no relation to relevance). The shared
     `live_by_symbol` index stays uncapped for tagging-only reads.
- Required product-spec.md changes, made with the user's explicit sign-off already given via the
  scope-choice question above: Config Key Changes section now lists the new key; AC-4 clarified
  ("for every candidate that is created") to no longer read as unconditional; new AC-7 documents the
  cap's behavior (excess strategies get no row at all for the signal-only case — never a demotion of
  an already-existing row).
- design.md updated: Chosen Approach steps renumbered/rewritten (new step 3 = the cap helper, steps
  4-7 = watchlist/held/signal-only/curated, each now precise about capped-vs-uncapped reads);
  Rejected Alternatives gained 4 new entries (both failed fix attempts, the tiebreak choice, and the
  config-key-vs-reusing-max_universe_size choice); Constitution Rules Touched gained C-05/F-07 (new
  config key obligations, deferred to `/sdd-spec` since the key doesn't exist in code yet) and
  C-11/P-04 (the Commandment-override sign-off itself). The Open Risk item is marked resolved for the
  strategies-per-symbol dimension, explicitly still open for the separate distinct-symbol-count
  dimension (not silently folded into "resolved").
- Status: design-approved (unchanged) — this was a post-approval amendment with explicit user
  sign-off (C-11/P-04), not a lifecycle transition.

## Session 2026-08-14T02:30:00Z — /sdd-design follow-up: close distinct-symbol-count Open Risk

- User asked to "run a round to clear warnings" across 131 and 022; for 131 this targeted the last
  unclosed Open Risk from the prior post-approval amendment: step 6's
  `signals_by_symbol.keys() & live_by_symbol.keys()` intersection was unbounded, bypassing
  `max_universe_size` via `curated`.
- **Round 1**: new config key `analysis.opportunity.max_live_only_symbols_per_compute` (default
  20), ranking eligible symbols by max active-signal conviction descending (`sym` ascending
  tiebreak), grounded correctly (sort key available before step 6 runs, unlike the earlier
  `signal_axis`-forward-reference bug). Adversary found a starvation bug: the competitive pool
  included symbols already curated for free via watchlist/held, wasting scarce slots that
  genuinely-uncovered signal-only symbols needed.
- **Round 2**: fixed via a symbol-level `already_curated_symbols` exclusion — but this introduced a
  real regression against the already-approved FR-4: a symbol with SOME existing candidate (e.g.
  watchlist-bound to strategy A) but a genuinely new `(symbol, strategy B)` pair to create would be
  silently dropped from the pool entirely, violating FR-4's "each distinct pair becomes its own
  row." Adversary caught this and proposed the fix adopted in round 3.
- **Round 3**: corrected to a per-`(symbol, strategy)` newness check (`_new_live_strats`), with a
  formal proof that `_capped_live(sym)` called with no `exclude` (not `exclude=existing`) is the
  only order that composes correctly with the held loop's own capping — excluding first and capping
  second would silently blow a symbol's total attributed-strategy count past
  `max_live_strategies_per_symbol`. Verified directly against the real code
  (`services/xstockstrat-analysis/app/handlers/servicer.py`) before accepting.
- New **AC-8** in product-spec.md documents the per-pair eligibility rule, the ranking/tiebreak, the
  no-cross-pass-hysteresis trade-off (mirrors AC-7's precedent — `OpportunitiesRepository`'s
  delete+reinsert write model has no carried state), and the compound (multiplicative) worst-case
  row count.
- Gated via `AskUserQuestion` before finalizing (per C-11/P-04, mirroring the first fan-out fix's
  process) — user selected "Also fix held-symbol-count now" instead of approving as-is, reopening
  the deliberately-deferred held-symbol-count dimension too (see next entry).

## Session 2026-08-14T03:00:00Z — /sdd-design follow-up: close held-symbol-count Open Risk

- User explicitly chose to also close the held-symbol-count dimension (previously recorded as a
  deliberately deferred, not-fixed Open Risk) rather than accept it deferred.
- Clarified scope during round 1: held-symbol tracing itself (every held position gets ≥1 row) is
  baseline feature-097 behavior, unchanged and out of scope. What 131 actually adds per held symbol
  is a live-attribution multiplier (`live_new`, up to `max_live_strategies_per_symbol` extra rows) —
  the real unbounded dimension is how many DISTINCT held symbols get this multiplier applied per
  compute pass, not whether a symbol gets traced at all.
- **Round 1**: new config key `analysis.opportunity.max_live_held_symbols_per_compute` (default
  20), ranking eligible held symbols by summed `abs(Position.market_value)` descending (position
  size is the only cleanly-aggregable, economically-meaningful field on the object `ListPositions`
  actually returns — `opened_at` doesn't aggregate cleanly across multi-account holdings of the same
  symbol). Required widening `_drain_held_symbols`'s return type from `set[str]` to `dict[str,
  float]`. Correctly chose a separate config key rather than sharing AC-8's budget — held-symbol
  growth is capital/fill-gated while AC-8's dimension is zero-marginal-cost; sharing would let a
  large real portfolio silently starve the zero-cost dimension AC-8 protects (the same
  cross-dimension-conflation trap this feature's design already rejected once for
  `max_universe_size`). Also corrected a false assumption from my own round-1 prompt: "held
  positions are capital/risk-bounded elsewhere" does NOT hold — verified directly, no service
  enforces a distinct-symbol-count ceiling (`trading.risk.max_position_pct`/`max_concentration_pct`
  bound position *size*, not symbol *count*; `portfolio.risk.max_drawdown_pct` is unenforced). The
  real, sound reasoning is execution-friction (real `order.filled` events, not a config-side cap).
- Adversary found TWO real bugs in round 1: (a) a held symbol denied a budget slot could still be
  independently re-discovered by step 6 (AC-8's mechanism, which has no concept of held status) if
  it also had an active signal — producing a wrongly entry-traced duplicate row for an
  already-held position (step 6 never sets `is_held=True`, so `rule = "exit" if c["is_held"] else
  "entry"` picks the wrong rule, and `_resolve_action_tag` could emit a misleading ENTER tag); (b)
  the same raw-vs-normalized symbol-key mismatch bug this feature already found and fixed once for
  `live_by_symbol` at step 1 recurred a second time for the new `held_value_by_symbol` index.
- **Round 2**: fixed both. (a) `held_norm` is now excluded from step 6's domain entirely
  (`live_signal_symbols = (signals_by_symbol.keys() & live_by_symbol.keys()) - held_norm`) — the
  adversary's own recommended, lower-surface-area fix (vs. threading `is_held` correctly through a
  row created outside the held loop). (b) `_drain_held_symbols` now normalizes at construction
  (`_normalize_symbol(p.symbol)` as the dict key), matching how `held_norm`/`watchlist_by_symbol`/
  `live_by_symbol` are all normalized.
- New **AC-9** documents the eligibility rule, ranking, the accepted long+short hedge-pair
  measurement caveat, explicit disjointness from AC-8's pool (a symbol is never in both — proven by
  construction), no-cross-pass-hysteresis (mirrors AC-8), and a shared "Compound worst case across
  all three caps" note (replacing AC-8's now-incomplete standalone note) — combined ceiling of up to
  200 newly-attributed rows across the two disjoint capped pools, plus uncapped baseline rows from
  watchlist bindings (tagging-only, zero marginal cost) and held positions (row count itself
  uncapped, only the live-attribution fan-out is capped).
- Verified several of round 2's grounding claims directly (not just trusted the subagent's prose):
  `_drain_held_symbols`'s current shape (`servicer.py:2384-2410`, returns bare `set`, two call sites
  at `:1924,2099`, un-normalized `p.symbol` accumulation) and `Position.market_value`'s existence
  (`packages/proto/portfolio/v1/portfolio.proto:48`) — both confirmed exactly as claimed.
- Result: `design.md` Open Risks section now shows the "Held-symbol live-attribution fan-out" item
  RESOLVED (was the last remaining `[ ]` open item); Chosen Approach steps 5/6 updated with the
  final mechanism; two new Rejected Alternatives entries recorded (the `is_held`-blind step-6
  mistake, the raw-key `held_value_by_symbol` mistake). `product-spec.md` gets AC-9 and an amended
  AC-8 (compound-worst-case sentence now points to the shared note; explicit `held_norm` exclusion
  noted). All Open Risks for this feature are now either resolved or explicitly, deliberately
  out-of-scope (raw held-position-row count — correctly never capped, that's feature 097's domain).
  Test-helper incompatibility remains the one item explicitly waived by prior user decision (not a
  defect, a scope waiver).
- Status: design-approved (unchanged) — both rounds this session were post-approval amendments with
  explicit user direction, not lifecycle transitions.

## Session 2026-08-14 — sdd-spec

- Generated implementation-spec.md with 5 steps. Status design-approved → implementation-ready.
- Steps: (1) service repo `list_live_enabled()` + `LIVE_ENABLED_PREDICATE_SQL` constant + one-line
  `live_loop.py:188-190` re-point; (2) test repo/parity; (3) service `_compute_opportunities` live
  attribution (design steps 1-7) + `_drain_held_symbols` widening; (4) test servicer + mandatory
  harness extensions; (5) config register 3 keys + attribution prose.
- Key codebase findings (grounded, verified this session):
  - `list_live_enabled`/`LIVE_ENABLED_PREDICATE_SQL` confirmed ABSENT (`grep` no hits) — created in
    Step 1. `list()` sibling at `strategies.py:147-161`; `_to_dict` returns `dict(row)` incl.
    `created_at`/`active`/`live_enabled` (so the `_capped_live` created_at tiebreak has its source).
  - `_row_to_strategy_definition` is module-level in `servicer.py:2990` (call directly, same module);
    `strategy_symbols` deferred-imported from `live_loop.py:37-47` mirroring the existing precedent at
    `servicer.py:1824`. `live_loop.py:29` already module-imports from servicer → the reverse constant
    import (live_loop ← strategies) adds no new cycle.
  - **Harness break (mandatory Step 4 fix):** `_materialized_svc` (`tests:3637-3673`) stubs
    `_strategies_repo` as a bare `AsyncMock` with only `get_by_id`; once Step 3 calls
    `list_live_enabled()` a bare AsyncMock returns a non-iterable MagicMock → `TypeError` breaks ALL 12
    existing `TestListOpportunitiesMaterialized` tests. Harness must default `list_live_enabled → []`.
    `_strat_row` (`:3608-3630`) also lacks `signal_params.symbols` and `created_at` — both needed for a
    live-covered row; extend it (or a sibling) for the new tests. `make_servicer`'s `get_int` returns
    the passed default, so the three new caps read 5/20/20 with no extra wiring.
  - **Design-prose deviation surfaced (P-03):** design.md says widening `_drain_held_symbols` to a
    normalized-keyed `dict[str,float]` leaves "both call sites dict-compatible with zero other changes."
    Discovery shows the screener call site's membership test (`servicer.py:1926` `if r.symbol in held:`)
    must become `if _normalize_symbol(r.symbol) in held:` to stay correct against the now-normalized keys.
    Spec'd as a required 1-line adjustment in Step 3, flagged for the reviewer. `Position.market_value`
    = double field 5 (confirmed) → summed `abs()` is the held-value rank source.
  - No proto/migration/DB-schema changes. Consumer surface `/insights` needs no UI code change (existing
    display path + provenance-blind e2e mock — C-12 obligation already resolved in design).
- Merge order recorded in spec (`133 → 134 → 131 → 132`; 131 after 134, before 132).

## Session 2026-08-15 — sdd-execute (sequential, stacked on 134)

### Step 1 — service: list_live_enabled + shared predicate [done]
- `strategies.py`: added module-level `LIVE_ENABLED_PREDICATE_SQL = "live_enabled = TRUE AND active = TRUE"`
  and `list_live_enabled(user_id=None)` (sibling of `list()`). **Deviation D-1**: added the optional
  `user_id` owner-scope param (post-133 IDOR guard — see Deviation Log). Return annotation quoted
  (`-> "list[dict]"`) because the class's own `list()` method shadows the builtin `list` in class
  scope, so an unquoted `list[dict]` annotation evaluated `<method>[dict]` → TypeError.
- `live_loop.py`: imported `LIVE_ENABLED_PREDICATE_SQL`; re-pointed the inline query at the f-string
  constant (the literal now appears exactly once in `app/`). Loop constructor/control-flow untouched.
- Files modified: `app/repositories/strategies.py`, `app/engine/live_loop.py`
- Verify: ruff clean; predicate literal `app/` count = 1; full suite 469 passed, 82.36%.

### Step 2 — test: list_live_enabled predicate + owner-scope [done]
- `TestListLiveEnabled`: asserts the query contains the shared predicate + `_to_dict` decodes
  definition_json (global, no user filter); plus a D-1 test that `list_live_enabled("u1")` adds
  `user_id = $1` bound to `"u1"`. C-13: strategy-row literals single-consumer → inline compliant.
- Files modified: `tests/test_analysis_servicer.py`
- TDD: red (AttributeError — method/constant absent) → green (2 pass; full suite 469, 82.36%).

### Interlude — 134 (PR #953) CI drive-to-green [done]
- Mid-execute, PR #953 (feature 134, this stack's base) went red on Frontend E2E shard 1: a REAL 134
  regression, not the known signal-detail flake. `e2e/config-ui/value-persists-after-save.spec.ts:83`
  asserted the Sources weight column reflects a saved `analysis.signals.source_weights` **config-key**
  edit — the exact `useSignalSources` config-blob parse 134's FR-4 removed. Deleted that obsolete case
  (Sources weight column is covered by `sources.spec.ts`), pruned its unused page constants, fixed the
  module docstring. Committed on the 134 branch (`fe33fd9`), merged into this stack. **PR #953 merged.**
- Ledger: `fails.md` already carries the general "new proto field breaks agent parity test" line; this
  one is a different class — a UI behavior removal (FR-4 genuine replace) leaving a stale e2e that
  asserts the removed behavior. Recorded below.

### Step 3 — service: fold live_by_symbol into _compute_opportunities; widen _drain_held_symbols [done]
- `servicer.py`: widened `_drain_held_symbols` → `dict[str, float]` keyed by normalized symbol, summed
  `abs(market_value)` (normalize at construction — design step 1). Screener call-site membership test
  normalized (**D-3**). In `_compute_opportunities`: renamed local `held`→`held_value_by_symbol`;
  built owner-scoped `live_by_symbol` + `created_at_by_strategy` from `list_live_enabled(user_id)`
  (**D-1**); `_candidate` gains `is_live`; `_capped_live(sym, exclude)` (exclude-before-slice, cap read
  once — **D-4** placement); watchlist loop tags live; held loop bounded by `max_live_held`; new
  live-only step (design step 6) bounded by `max_live_only`, `− held_norm` domain guard; curated
  predicate extended with `is_live`. Did **not** touch `_resolve_action_tag`/`signal_axis` (instr. 11).
- Files modified: `app/handlers/servicer.py`
- Verify: ruff clean; structural grep confirms all 3 caps read via `get_int` (F-07), drain returns dict.

### Step 4 — test: live-strategy attribution + harness extensions [done]
- `_materialized_svc`: added `live_strategies` param (→ `list_live_enabled` default `[]` — the
  mandatory harness fix; a bare AsyncMock breaks all 12 existing tests), and `held` now accepts a
  `(symbol, market_value)` tuple (**D-2**, held-mock `market_value`). `_strat_row` gained
  `symbols`/`created_at` (a live-universe row via `signal_params.symbols` + the `_capped_live`
  tiebreak), defaulted off so existing callers are unchanged.
- 5 new AC tests (AC-1 held exit trace, AC-2 live-only entry trace + curated, AC-3 watchlist∩live
  collapse, AC-5 non-live never attributes, AC-4 curated survives tiny universe). Multi-strategy-
  per-symbol test **waived** (design Open Risk, explicit user decision) — recorded inline.
- Files modified: `tests/test_analysis_servicer.py`
- TDD: red (4/5 fail without Step 3; AC-5 is a negative-guard, green both trees) → green (474 pass,
  82.59%; all 12 pre-existing Materialized tests still green — harness fix verified).

### Step 5 — config: register 3 keys + attribution prose [done]
- `analysis/CLAUDE.md` § Config Keys Consumed: 3 `analysis.opportunity.max_live_*` rows + compound
  worst-case note (5 × (20+20) = 200, disjoint pools). `config-governance.md` Per-Feature Registered
  Keys: prepended a newest-first feature-131 entry (no seed migration — live `get_int`, mirrors the
  existing `analysis.opportunity.*` no-seed pattern).
- Files modified: `services/xstockstrat-analysis/CLAUDE.md`, `docs/patterns/config-governance.md`
- Teardown: `/context-scrubber` plugin not installed in this session — touched context docs reviewed
  by hand against the code (noted in the integration PR body).

## Session 2026-08-16 (CI: feature status automation)

- Promotion PR #963 merged to main
- Feature promoted and committed: 94e4e24fa6ac41eb20bd16e1e9af15c8388e885a
- Status updated: `code-completed` → `launched`
- Launched date: 2026-08-16
