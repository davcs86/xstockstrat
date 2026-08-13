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

- [ ] No new config keys — reuses `analysis.opportunity.max_universe_size` (FR-6 extends its
  existing curated/speculative split, doesn't add a new knob).

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
   `max_universe_size` truncation cut), not `speculative`.
5. Strategies that are `active=TRUE` but `live_enabled=FALSE` never attribute a candidate under this
   feature (the predicate matches `live_loop.py`'s own `live_enabled=TRUE AND active=TRUE` exactly —
   no drift between what the live loop evaluates and what the queue attributes).
6. A live-loop restart (which resets `live_loop`'s own in-memory `_last_state`) produces
   byte-identical `strategy_id`/`passing_conditions`/`total_conditions`/`provenance` values from
   `_compute_opportunities` for the same `(user, symbol)` opportunity, before and after the
   restart, given unchanged market data — confirms FR-5's independence from the live loop's
   private state.

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
