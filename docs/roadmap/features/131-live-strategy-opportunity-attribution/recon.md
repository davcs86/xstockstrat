# Recon: live-strategy-opportunity-attribution

**Created**: 2026-08-13
**From**: product-spec.md
**Affected services**: xstockstrat-analysis

---

## Objective

Attribute a held position or active signal in the Opportunities queue to a live-enabled strategy
that already covers its symbol via `signal_params.symbols`, instead of falling through to
unattributed (`strategy_id=""`, no trace, `0/0`) unless the symbol is also watchlist-bound to that
strategy.

## Codebase Map

- **`xstockstrat-analysis`** (Python)
  - `_compute_opportunities`: `services/xstockstrat-analysis/app/handlers/servicer.py:2083-2242`
  - Attribution rule (current, docstring): `servicer.py:2090-2091` — "a watchlist binding → its
    strategy_id (traced); everything else is unattributed... held positions carry no portfolio
    strategy, so none is fabricated (P-03)"
  - `watchlist_by_symbol` index: `servicer.py:2102-2109`
  - Held-symbols loop: `servicer.py:2142-2150` (`targets = list(strats) if strats else [""]`)
  - Signals-merge loop: `servicer.py:2152-2168`
  - `evaluate_conditions_traced` call site: `servicer.py:2207-2209`, gated by `if strat:` at
    `servicer.py:2194` and `_load_strategy_definition` at `:2195` (itself already filters
    `active AND live_enabled`)
  - `curated`/`speculative` split + universe cap: `servicer.py:2170-2177`
  - `_add_provenance`/`_candidate` helpers: `servicer.py:2113-2133`
  - `StrategiesRepository.list()`: `app/repositories/strategies.py:147-161` — filters `active`
    only, no `live_enabled` predicate
  - `strategy_symbols(definition)`: `app/engine/live_loop.py:37-47` — public helper, already
    imported cross-module
  - `_run_cycle`'s live-enabled query: `live_loop.py:188-190`
    (`SELECT * FROM analysis.strategies WHERE live_enabled = TRUE AND active = TRUE`)
  - `main.py` loop wiring: `main.py:85-149` — `live_loop` constructed, never assigned onto
    `servicer` (contrast `servicer._fundsignal_loop = fundsignal_loop`, `main.py:149`)
  - Last migration: `012_strategy_cooldowns_last_entry_at` — none needed for this feature

## Patterns to REUSE

- **Attribution index shape** → `watchlist_by_symbol` (`servicer.py:2102-2109`) is the exact shape
  to mirror for a new `live_by_symbol: dict[str, set[strategy_id]]` index — same
  `setdefault(...).add(strat)` construction, built from a different source (live-enabled strategies'
  `signal_params.symbols` instead of `ListWatchlists` bindings).
- **`strategy_symbols()` helper** → `live_loop.py:37-47`, already public and importable — reuse
  verbatim, do not duplicate its `signal_params.symbols` extraction logic (DRY guard rail).
- **Held-symbols attribution pattern** → `servicer.py:2142-2150`'s `targets = list(strats) if
  strats else [""]` shape is the template for folding `live_by_symbol` in as an additional
  attribution source alongside `watchlist_by_symbol`.
- **`_add_provenance`** (`servicer.py:2113-2133`) — reuse verbatim for tagging `"live_strategy"` as
  a new origin string; `Opportunity.provenance` is already `repeated string` (`analysis.proto:458`),
  no proto change needed.
- **Test suite home** → `class TestListOpportunitiesMaterialized` in
  `services/xstockstrat-analysis/tests/test_analysis_servicer.py:3683` — new tests are siblings of
  `test_watchlist_and_held_add_rows_with_real_readiness` (`:3685`) and
  `test_watchlist_binding_to_disabled_strategy_traces_to_zero` (`:3705`), same naming convention
  (`test_<condition>_<expected_behavior>`).

## Dependencies

- Proto/RPC: none — `Opportunity.provenance` (field 11, `repeated string`) already supports a new
  free-form origin tag.
- Migration: none.
- Config keys: none new — reuses `analysis.opportunity.max_universe_size` (`servicer.py:2172`).
- Inter-service edges: none new — this is a pure `xstockstrat-analysis`-internal read (queries its
  own `analysis.strategies` table via the existing DB pool, same as `StrategiesRepository`/`live_loop`
  already do).
- New env vars / ports: none.

## Risks / Not-found

- **Not found**: any existing code path in `_compute_opportunities` that checks a candidate's symbol
  against a live-enabled strategy's `signal_params.symbols` universe — confirms the product spec's
  premise exactly.
- **Not found**: a `StrategiesRepository` method filtering `live_enabled` — only `live_loop.py`'s
  inline SQL (`self._db.fetch(...)`, not routed through the repository) does this today. The product
  spec's own Open Questions already flag this as an `/sdd-design` decision: a new repo method
  (mirroring `list()`'s shape) vs. reusing `live_loop.py`'s raw-SQL pattern.
- **Not found**: `servicer._live_loop` wiring — confirmed absent (main.py:85-149), which is exactly
  why FR-5 (independent re-trace, not reaching into the live loop's private state) was chosen over
  reusing the loop's own `in_position` belief.
- **Nuance not previously surfaced in the product spec**: `curated` (`servicer.py:2173`) is defined
  purely by `is_watchlist`/`is_held` flags, **not** by strategy attribution. A held position with a
  live-strategy-symbol match but no watchlist binding is **already** `curated` today (via `is_held`)
  — it just never gets *traced* (`strat=""` fails the `if strat:` gate at `:2194`). FR-6's "curated
  classification extends to live-strategy-only" requirement is therefore narrower in practice than
  its text implies: it only changes outcomes for **signal-only** candidates (no watchlist binding, no
  held position) whose sole origin would be live-strategy coverage — those currently land in
  `speculative` and are subject to the universe-cap truncation. The design must state this precisely
  so `/sdd-spec` doesn't over-scope FR-6's implementation.
- **fails.md 2026-08-05 (`023-position-sizing-engine`)**: `Opportunity.conviction` (ordinal) vs.
  `ExternalSignal.conviction` (cardinal) conflation trap — this feature touches neither value's
  formula, only *which* candidates get traced; re-confirm explicitly per the ledger's own rule.
- **insights.md 2026-08-13 (`130-signal-source-reliability-weight`)**: this session's own fresh
  lesson — verify any proposed fix against real code/DB semantics, not just that it reads as
  responsive to a named objection. Directly applicable here given the `live_enabled` query
  placement decision (new repo method vs. raw SQL) touches the same `analysis.strategies` table
  `live_loop.py` already queries.

## Recommended Scope

1. Add a `StrategiesRepository` method (or reuse `live_loop.py`'s query shape) for
   `live_enabled=TRUE AND active=TRUE` strategies — the Open Question `/sdd-design` must resolve.
2. Build `live_by_symbol: dict[str, set[strategy_id]]` via `strategy_symbols(definition)`
   (imported, not duplicated) per selected strategy row.
3. Fold `live_by_symbol` into the existing held/signals attribution loops
   (`servicer.py:2142-2168`) as an additional origin, tagged `"live_strategy"` via `_add_provenance`.
4. Trace via the existing `evaluator.evaluate_conditions_traced` call (`servicer.py:2207-2209`) —
   no new trace mechanism.
5. Confirm the `curated`/`speculative` nuance above — FR-6 only needs to change classification for
   the signal-only case, not held positions (already curated).
6. New tests as siblings inside `TestListOpportunitiesMaterialized`
   (`test_analysis_servicer.py:3683`).
