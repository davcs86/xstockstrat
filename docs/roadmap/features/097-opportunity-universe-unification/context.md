# Context: opportunity-universe-unification

**Feature**: `docs/roadmap/features/097-opportunity-universe-unification/feature.md`
**Product Spec**: `docs/roadmap/features/097-opportunity-universe-unification/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/097-opportunity-universe-unification/implementation-spec.md`

---

## Session 2026-08-03 — sdd-story

- Created feature.md (status: draft), product-spec.md, context.md from the user story.
- **Origin:** a codebase walkthrough of signal/opportunity/watchlist/strategy/indicator/backtest/screener
  relationships surfaced that the Decide queue fragments three symbol-origins and that snooze/strategy
  binding are UI-only transient state.
- **User-committed design decisions (carry into /sdd-design):**
  1. **Option 2** — signals are a universe + independent ranking axis ONLY, never an input to a strategy's
     internal score. `signal_weight`/`signal_sources` retire from the strategy definition (deprecate, don't
     delete); signal↔technical ranking blend moves to the queue composition layer so a signal is counted
     exactly once.
  2. **Watchlists become `(symbol, strategy_id)` bindings** — a strategy per symbol; each binding is a
     ready-made Universe candidate. Delivered via a proto deprecation path, not a hard replace.
- **Confirmed code facts grounding the story:**
  - `evaluator.evaluate_conditions_traced` is already signal-free (`signals_map` param is `# reserved` —
    entry-rule leaves are component refs); readiness needs no signal input.
  - Current `ListOpportunities` (`servicer.py:2006`) hardcodes `strategy_id=""`, `passing/total=0/0`;
    universe = active signals only (`_drain_active_signals`); held only sets the action tag
    (`_drain_held_symbols`).
  - Snooze is `useState<Set<string>>` keyed on `` `${symbol}-${source}` `` (`opportunities/page.tsx:62,81`),
    disagreeing with the backend per-symbol dedup (`best[sig.symbol]`).
  - `GetStrategyAnalytics.queue_share` reserved `0.0`; watchlist proto has no strategy field; the
    watchlist↔strategy join is UI-only (`WatchlistReadiness.tsx` `useState('')`).
- **Governance flags raised in the spec:** breaking-class proto (deprecate-don't-delete for Watchlist +
  signal-blend fields); DBA migrations in portfolio + analysis; no new DB pool (F-06); C-10 shared-consumer
  parity across TS exhaustive enum maps + agent request builders + `strat-lab` skill.
- **Ledger traps noted (Open Questions):** fails.md 056/060 (shipped producer, forgot shared consumer),
  2026-07-21 C-10(a/d) (proto-enum → exhaustive-TS-`Record` coupling), 2026-08-02 MCP/strat-lab F-12
  (tool-doc/skill drift).
- **Open forks for design:** held-position strategy attribution; watchlist→strategy cardinality across
  multiple watchlists; exact queue ranking-axis composition; deprecation horizon.
