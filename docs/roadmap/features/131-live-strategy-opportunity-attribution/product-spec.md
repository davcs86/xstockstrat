# Product Spec: live-strategy-opportunity-attribution

**Created**: 2026-08-13

---

## Problem Statement

The live evaluation loop (`app/engine/live_loop.py`) continuously evaluates every `live_enabled`
strategy against its own explicit symbol universe (`StrategyDefinition.signal_params.symbols`, via
the public `strategy_symbols()` helper, `live_loop.py:37-47` — **not** all symbols against all
strategies; a strategy with no configured symbols is skipped). The Opportunities queue
(`_compute_opportunities`, `servicer.py:2083`) attributes a held position or bare signal to a
strategy **only** via watchlist binding coincidence (`watchlist_by_symbol`, built solely from
`ListWatchlists`, `servicer.py:2103-2105`) — a symbol a live strategy is actively evaluating and
managing falls through to unattributed (`strategy_id=""`, no trace, `0/0`) unless that same symbol
also happens to be watchlist-bound to that same strategy. The live loop's actual coverage of a
symbol is never consulted.

## User Story

As a trader with live-enabled strategies, I want a held position or active signal that a live
strategy is already evaluating to show that strategy's readiness trace in the Opportunities queue,
instead of appearing unattributed just because I haven't also added it to a watchlist.

## Functional Requirements

FR-1. Build a `live_by_symbol: dict[str, set[strategy_id]]` index inside `_compute_opportunities`,
parallel in shape to the existing `watchlist_by_symbol` index (`servicer.py:2103-2105`): query
`live_enabled=TRUE AND active=TRUE` strategies (the same predicate `live_loop.py:189` uses —
`StrategiesRepository.list()` today only filters `active`, so add a repo method for this predicate
rather than filtering client-side) and, per row, call the already-exported `strategy_symbols(definition)`
helper (`live_loop.py:37`, public, no leading underscore — import it, do not duplicate its logic
per the DRY guard rail).
FR-2. Fold `live_by_symbol` into the existing attribution step (`servicer.py:2144-2168` —
candidate-building and `provenance` assembly) as an additional origin alongside watchlist bindings:
a held or signaled symbol covered by a live strategy gets that strategy attributed
(`_add_provenance(c, "live_strategy")`), then traced via the existing
`evaluator.evaluate_conditions_traced` call site (`servicer.py:2205-2209`) — the same
entry-rule-for-candidates / exit-rule-for-held distinction the watchlist path already applies (FR-8
of feature 097).
FR-3. When a symbol is covered by **both** a watchlist binding and a live strategy for the same
`(symbol, strategy_id)` pair, collapse into the existing single candidate (per feature 097's
dedup-by-`(symbol, strategy)` key) with both origins in `provenance` — never a duplicate row.
FR-4. When a symbol is covered by live strategies whose `strategy_id` differs from any existing
watchlist-bound candidate for that symbol, each distinct `(symbol, strategy_id)` pair becomes its
own candidate row (mirrors how multiple watchlist-bound strategies for one symbol already produce
multiple rows today, `servicer.py:2136-2140`).
FR-5. This re-traces readiness independently of the live loop's own in-memory transition state
(`_last_state`/`_last_entry_at` in `live_loop.py`) — it does **not** read the live loop's private
dicts. `main.py` never hands the servicer a reference to the `LiveEvaluationLoop` instance (unlike
`fundsignal_loop`, `main.py:149`), and reaching into another module's lock-guarded mutable state was
explicitly rejected as the weaker option (see design.md § Rejected Alternatives once written).
FR-6. `curated` classification (feature 097's FR-1: watchlist/held candidates rank above the
`max_universe_size` truncation cut, `servicer.py:2172-2177`) extends to a candidate whose only origin
is a live-strategy coverage match — it is not "speculative" just because it lacks a watchlist
binding, since a live strategy actively managing it is at least as curated a signal as a watchlist
entry.

## Out of Scope

- Reusing the live loop's own in-memory `in_position`/entry-time belief (FR-5 explicitly re-traces
  instead) — a future feature could revisit this tradeoff if re-tracing proves too expensive.
- Changing what the live loop itself evaluates or alerts on — this is purely an Opportunities-queue
  read-side attribution change.
- Attributing a position to the *specific* live strategy that historically opened it (would require
  `trading.Order.strategy_id`, which trading records at fill time, to propagate into
  `portfolio.Position` — `portfolio.proto:43-63` has no `strategy_id` field today). This feature
  attributes by *current* symbol-universe coverage, not order-history provenance.

## Affected Services

Exact service names from CLAUDE.md Service Registry:
- `xstockstrat-analysis` — `_compute_opportunities` attribution logic + new `StrategiesRepository`
  method for `live_enabled=TRUE AND active=TRUE` rows

## Consumer Surface(s)

- [x] **UI** — `xstockstrat-ui` `/insights` Opportunities page: no new page or control, but
  previously-unattributed rows for held positions / active signals now surface a strategy's
  readiness trace (passing/total, entry or exit rule) where a live strategy covers the symbol —
  an existing display path (`strategy_id`/`passing_conditions`/`total_conditions` fields already on
  `Opportunity`, `analysis.proto:447-459`) simply gets populated more often. No proto or UI
  component change required.
- [ ] **Agent** — no MCP tool surfaces opportunity attribution directly; none added.
- [ ] **None**

## Proto Contract Changes

- [x] No proto changes required — `Opportunity.strategy_id`/`passing_conditions`/`total_conditions`/
  `provenance` (`analysis.proto:447-459`) already carry everything this feature needs; `provenance`
  is `repeated string` (free-form), so `"live_strategy"` needs no new enum value or field.

## Config Key Changes

- `analysis.opportunity.max_live_strategies_per_symbol` — int, default `5`. Bounds how many
  live-enabled strategies can newly attribute to a single symbol via live-coverage (per-symbol fan-out
  cap, added at `/sdd-design` time — see design.md's compute-fan-out mitigation). Conservatively
  bounds worst-case added latency per symbol to `default` extra bar-fetch+trace calls in a single
  synchronous, compute-on-read RPC; realistic live-strategy-per-symbol overlap on this platform is
  expected far below this default. Does **not** replace or reuse `analysis.opportunity.max_universe_size`
  — that key still governs the unrelated curated/speculative split (FR-6 extends its OR-chain, doesn't
  touch its budget math).
- `analysis.opportunity.max_live_only_symbols_per_compute` — int, default `20`. Added at `/sdd-design`
  time (3-round follow-up debate, 2026-08-14 — see design.md's Chosen Approach step 6 and Open Risks).
  Bounds how many *distinct symbols*, covered only by an active-signal + live-strategy intersection
  (no watchlist binding, no held position), can get a new candidate row created per
  `_compute_opportunities` compute pass — a separate, orthogonal dimension from
  `max_live_strategies_per_symbol`'s per-symbol strategy count; the two compose multiplicatively
  (worst case `20 × 5 = 100` new rows from this step alone, both defaults). Does **not** replace or
  reuse `max_universe_size` or `max_live_strategies_per_symbol` — see AC-8.
- `analysis.opportunity.max_live_held_symbols_per_compute` — int, default `20`. Added at
  `/sdd-design` time (follow-up debate, 2026-08-14 — see design.md's Chosen Approach step 5 and
  Open Risks). Bounds how many *distinct held symbols* may receive a new live-only strategy
  attribution (beyond any watchlist binding) per compute pass — orthogonal to
  `max_live_strategies_per_symbol` (per-symbol strategy count) and
  `max_live_only_symbols_per_compute` (step 6's non-held distinct-symbol count); the three compose
  per AC-9's compound-worst-case note. Does **not** bound the number of held-position rows
  themselves (every held symbol still gets at least one row this pass, unconditionally) — only the
  live-strategy-attribution fan-out on top of that baseline — see AC-9.

## Database Changes

- [ ] No schema changes — reuses the existing `analysis.strategies` table via a new repository
  query, no new column or table.

## Feature Workflow Notes

Branch to create: `feature/live-strategy-opportunity-attribution` (branch from `main-dev`)
Approval gates required (per docs/runbooks/feature-workflow.md):
- [x] 1 service owner approval (non-breaking, single-service logic change)
- [ ] 2 service owners + platform lead (breaking proto change) — not applicable
- [ ] DBA review + service owner (schema migration) — not applicable

## Acceptance Criteria

1. A held position whose symbol is in a live-enabled strategy's `signal_params.symbols`, but is
   **not** watchlist-bound to that strategy, appears in `ListOpportunities` attributed to that
   strategy with a real exit-rule trace (`passing/total` reflects actual evaluated conditions, not
   `0/0`).
2. An active signal (no watchlist binding, no held position) on a symbol covered by a live strategy
   is attributed to that strategy with a real entry-rule trace: `passing_conditions`/
   `total_conditions` reflect actually-evaluated leaf conditions (not `0/0`), and `total_conditions`
   equals the strategy's entry-rule leaf count exactly — the same shape a watchlist-bound
   candidate's trace produces today.
3. A symbol covered by both a watchlist binding and a live strategy for the same `(symbol,
   strategy_id)` produces exactly one candidate row, with `provenance` containing both origins.
4. A live-strategy-only-attributed candidate is classified `curated` (ranked above the
   `max_universe_size` truncation cut), not `speculative` — **for every candidate that is created**.
   This does not conflict with AC-7 below: AC-7 bounds *how many* candidates get created per symbol
   via live-only coverage, not how a created candidate is classified.
5. Strategies that are `active=TRUE` but `live_enabled=FALSE` never attribute a candidate under this
   feature (the predicate matches `live_loop.py`'s own `live_enabled=TRUE AND active=TRUE` exactly —
   no drift between what the live loop evaluates and what the queue attributes).
6. A live-loop restart (which resets `live_loop`'s own in-memory `_last_state`) produces
   byte-identical `strategy_id`/`passing_conditions`/`total_conditions`/`provenance` values from
   `_compute_opportunities` for the same `(user, symbol)` opportunity, before and after the
   restart, given unchanged market data — confirms FR-5's independence from the live loop's
   private state.
7. **Per-symbol fan-out cap (added at `/sdd-design` time — compute-cost mitigation, not part of the
   original story).** When more than `analysis.opportunity.max_live_strategies_per_symbol`
   live-enabled strategies cover the same symbol, only the top-K (by a deterministic tiebreak — see
   design.md) get a **new** candidate row created for that symbol via live-only coverage (i.e., a
   symbol with no watchlist binding and no held position for the excess strategies); strategies
   beyond the cap get no row and no provenance for that symbol — a deliberate, documented trade-off,
   not a silent gap. This cap **never** affects an already-existing candidate (one created via a
   watchlist binding or a held position): such a candidate's `"live_strategy"` provenance tag and
   `is_live` classification are always correct regardless of how many other strategies cover the same
   symbol, since tagging an already-existing row costs no additional compute (see design.md's
   distinction between *tagging* reads, uncapped, and *candidate-creation* reads, capped).
8. **Distinct-symbol-count cap (added at `/sdd-design` time — 3-round follow-up debate,
   2026-08-14, closing the compute fan-out Open Risk's deferred dimension).** Step 6's iteration
   domain **excludes every held symbol** (`(signals_by_symbol.keys() & live_by_symbol.keys()) -
   held_norm` — a held symbol's live attribution is governed exclusively by AC-9, never this AC; see
   the "Held-symbol live-attribution fan-out" note in design.md's Open Risks for why a held symbol
   reaching step 6 would produce a wrongly entry-traced duplicate row). Among the remaining, non-held
   symbols, step 6 is additionally bounded by `analysis.opportunity.max_live_only_symbols_per_compute`.
   Eligibility is checked **per `(symbol, strategy)` pair, not per symbol**: a symbol only consumes a
   competitive-pool slot if it has at least one live-covered `strategy_id` (within AC-7's per-symbol
   cap) that is **not already** a candidate — i.e. a symbol with **no remaining new `(symbol,
   strategy)` pair to create never consumes a slot**, while a symbol that **already has some curated
   candidate** (e.g. watchlist-bound to a different `strategy_id`) but still has additional
   uncreated live-strategy pairs **remains eligible for exactly those remaining pairs**. Eligible
   symbols are ranked by descending max active-signal conviction (`sym` ascending as a deterministic
   tiebreak); only the top `max_live_only_symbols_per_compute` proceed to pair creation — symbols
   beyond the cut get no new row from this step (a candidate already created by another origin is
   unaffected — this cap governs only step 6's own creation, mirroring AC-7's origin-scoped bound).
   **No cross-pass hysteresis**: which symbols make the cut can change between consecutive daily
   refreshes (`analysis.opportunity.refresh_hour_utc`) or on-read staleness recomputes as signal
   conviction shifts — a previously-curated live-only row can vanish entirely from one compute to
   the next with no user-facing signal beyond its absence, a deliberate, documented trade-off
   (mirrors AC-7's precedent), not a silent gap. **This AC's own worst case**: up to
   `max_live_only_symbols_per_compute` symbols × up to `max_live_strategies_per_symbol` strategies
   each = up to **100** new candidate rows from step 6 alone (20 × 5, both defaults) — see the
   combined ceiling across all caps in AC-9's "Compound worst case" note; readers must not read "20"
   in isolation as *the* row-count ceiling.
9. **Held-symbol-count fan-out cap (added at `/sdd-design` time — follow-up debate, 2026-08-14,
   closing the compute fan-out Open Risk's remaining deferred dimension for held positions).** The
   held loop's per-symbol live-strategy attribution (the `live_new` delta beyond any watchlist
   binding) is additionally bounded by `analysis.opportunity.max_live_held_symbols_per_compute` —
   how many *distinct held symbols*, per compute pass, may receive a **new** live-only strategy
   attribution beyond their watchlist-bound strategies (if any). This does **not** bound the number
   of held-position rows themselves: **every** held symbol still gets at least one row this pass
   (via its watchlist binding, or an unattributed `(symbol, "")` row if none) — the raw
   distinct-held-symbol count (requiring a real broker fill to grow) remains deliberately
   unbounded, since it is baseline feature-097 behavior this feature does not change; this AC
   governs only the zero-marginal-cost live-strategy-attribution dimension on top of that baseline,
   mirroring AC-8's precedent for the signal-only case.

   **Eligibility**: a held symbol only consumes a budget slot if it has at least one live-covered
   strategy not already attributed via its watchlist binding — i.e.
   `_capped_live(sym, exclude=watchlist_by_symbol.get(sym, set()))` is non-empty (the same
   per-symbol cap-then-filter mechanism AC-7 already defines, evaluated against the candidates that
   exist when the held loop runs — the watchlist loop's rows only). A held symbol whose live
   coverage is entirely already watchlist-attributed consumes no slot.

   **Ranking (deterministic)**: eligible held symbols are ranked by descending summed
   `abs(Position.market_value)` across the symbol's positions (keyed by *normalized* symbol),
   symbol ascending as the tiebreak; only the top `max_live_held_symbols_per_compute` proceed to
   receive their `live_new` delta. Summing `abs(market_value)` across a symbol's positions can
   inflate apparent size for a long+short hedge pair on the same symbol — accepted as a documented
   trade-off, rare given this platform's single-trading-mode-per-deployment account model. A denied
   symbol still gets exactly its existing correct row(s): its watchlist-bound candidates (if any)
   remain correctly tagged `is_live` wherever `strat` is independently in the symbol's full,
   uncapped live set, and if it has no watchlist binding it gets a single unattributed
   `(symbol, "")` held row — never a duplicate or a mis-traced row.

   **Disjoint from AC-8's pool**: a held symbol is never a member of step 6's competitive pool (AC-8
   explicitly excludes `held_norm` from its domain), so AC-8's and this AC's row pools draw from
   disjoint symbol sets and can never double-count, double-budget, or produce two competing rows for
   the same symbol in the same pass.

   **No cross-pass hysteresis**: mirrors AC-8's precedent — which held symbols make the cut can
   change between consecutive computes as position market values move, with no carried state (same
   stateless DELETE+INSERT write model, same rationale as AC-8).

   **Compound worst case across all three caps** (the single shared source for both AC-8's and this
   AC's row-count math — do not restate elsewhere): the per-symbol strategy cap (AC-7,
   `max_live_strategies_per_symbol`, default 5) composes multiplicatively, not additively, with EACH
   of the two independent distinct-symbol caps — step 6 (AC-8, non-held symbols): up to
   `max_live_only_symbols_per_compute × max_live_strategies_per_symbol` = **up to 100** new rows (20
   × 5, both defaults); held loop (this AC, held symbols' live-only delta): up to
   `max_live_held_symbols_per_compute × max_live_strategies_per_symbol` = **up to 100** additional
   new rows (20 × 5, both defaults), on top of the always-present, uncapped baseline of one row per
   held symbol. These two pools are **disjoint** (a symbol is either in `held_norm` or eligible for
   AC-8, never both), so their worst cases **sum**: up to **200** newly-attributed rows across both
   capped dimensions in a single compute pass, plus the always-present baseline rows from watchlist
   bindings (uncapped, tagging-only — zero marginal compute) and held positions (row count uncapped,
   only live-attribution fan-out capped). None of `max_live_strategies_per_symbol`,
   `max_live_only_symbols_per_compute`, or `max_live_held_symbols_per_compute` should be read in
   isolation as a row-count ceiling — only their pairwise products, summed across the two disjoint
   pools, bound the compute cost this feature can add per pass.

## Open Questions

- [ ] **Known trap** (`fails.md` 2026-08-05, `023-position-sizing-engine`) — carry into
  `/sdd-design` as a guardrail check, not a decision to resolve: do not conflate
  `Opportunity.conviction` (a deterministic *ordinal* — "passing/total leaves... NOT a probability",
  per its own proto comment) with any cardinal quantity when extending its computation here; this
  feature only changes *which* candidates get traced, not the conviction formula itself, so no
  conflict is expected — the design pass must state that it re-confirmed this rather than skip the
  check.
- [ ] Whether a `live_enabled=TRUE AND active=TRUE` strategies query belongs as a new
  `StrategiesRepository` method (mirroring `list()`'s shape) or a raw query duplicating
  `live_loop.py:188-190`'s SQL — decide at `/sdd-design`; the DRY guard rail favors a single shared
  method both `live_loop.py` and `servicer.py` can call, but `live_loop.py`'s query is inline SQL on
  `self._db` (no repo), not currently routed through `StrategiesRepository` — reconciling that is an
  in-scope refactor question for design, not a blocker.
