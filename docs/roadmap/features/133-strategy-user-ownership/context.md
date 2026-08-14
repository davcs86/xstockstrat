# Context: strategy-user-ownership

**Feature**: `docs/roadmap/features/133-strategy-user-ownership/feature.md`
**Product Spec**: `docs/roadmap/features/133-strategy-user-ownership/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/133-strategy-user-ownership/implementation-spec.md`

---

## Session 2026-08-14T04:30:00Z — sdd-story

- Created feature.md (status: draft), product-spec.md, context.md from user story.
- **Origin**: raised as a direct follow-up to `132-strategy-symbol-denylist`'s product-spec — its
  Open Questions flagged a critical, unresolved gap (FR-3's `union(watchlist, held, active-signal)`
  requires aggregating across users, but `live_loop.py` evaluates strategies platform-wide with no
  per-user identity, and `ListPositions`/`ListWatchlists` have no cross-user "list all" variant).
  User's proposed resolution: make strategies user-bound, closing the gap by construction (each
  strategy's owner IS the user whose watchlist/held/signals it should evaluate) instead of building
  a new cross-user aggregation RPC.
- Before storying, asked three clarifying questions via `AskUserQuestion` (this is a foundational,
  wide-blast-radius change — CLAUDE.md behavior #1 requires surfacing the fork rather than guessing):
  1. **`strategy_id` scope** — user chose composite `(user_id, strategy_id)` uniqueness (not a bare
     owner-tag column on an otherwise-global PK). This is the more invasive option: every table/proto
     referencing a bare `strategy_id` today needs a `user_id` companion to stay unambiguous.
  2. **Backtest access** — user chose full ownership gating, including `RunBacktest` (not just live
     eval/alerts/UI visibility). A stricter model than typical "read-shared, write-owned."
  3. **Migration owner** — user chose "assign all existing strategies to one specific seed/admin
     user" (not nullable/broadcast-preserving). The concrete `user_id` value was NOT supplied in this
     session — per Constitution F-04 ("never invent a symbol/value"), product-spec.md's FR-5 records
     this as a required operator-supplied input, not a placeholder value, deferred to
     `/sdd-spec`/`/sdd-execute` time.
- **Grounded the background-loop identity gap** (FR-4's critical Open Question) with a concrete,
  already-existing precedent rather than treating it as speculative: `services/xstockstrat-analysis/
  CLAUDE.md`'s own Config Keys table already states, for `analysis.fundsignal.universe_source`,
  "watchlists union pends a global portfolio RPC; falls back to explicit" — i.e. this exact class of
  gap (a background loop needing user-scoped portfolio data with no inbound request to propagate
  `x-user-id` from) already exists in production code today and was explicitly punted, not newly
  discovered. Cited `docs/patterns/header-propagation.md` directly to confirm `x-user-id` propagation
  assumes an inbound request source.
- **Grounded FR-2's blast-radius claims** directly via grep, not assumed: `portfolio.WatchlistBinding.
  strategy_id` (`portfolio.proto:176`), `trading.proto` has 3 `strategy_id` field occurrences (exact
  messages not yet identified — flagged as an Open Question for `/sdd-design` to resolve by reading
  each message, not by field-count alone), `analysis.strategy_cooldowns`'s PK
  (`migrations/009_strategy_cooldowns.up.sql`, currently `(strategy_id, symbol)`), and
  `live_loop.py:134`'s in-memory `_last_state` dict key shape (currently `tuple[str, str]`).
- **Field-number coordination with 132** — 132 claims `StrategyDefinition` field `12`
  (`denied_symbols`, already recorded in its own product-spec); this feature claims field `13`
  (`user_id`). Recorded as an explicit Open Question (both specs cross-reference this) since whichever
  feature's `/sdd-spec` runs second must re-verify the number is still free.
- **Sequencing question deliberately left open, not decided here**: whether 132 can partially land
  before 133 (deny-list mechanics without the cross-user-aggregation piece) or must wait fully —
  flagged for `/sdd-design` to resolve, not guessed at story time. `merge-order.md` is NOT yet
  updated — that happens once the actual dependency shape between 132 and 133 is confirmed by design.
- Consumer surface (C-14): UI (`/insights` strategy pages — a scoping behavior change, not a new
  page) + Agent (5 MCP tools: `manage_strategy`, `run_backtest`, `set_strategy_live`, `get_strategy`,
  `list_strategies`, per root CLAUDE.md's same-PR `strat-lab` skill rule).
- Status: draft. Next: `/sdd-review strategy-user-ownership product-spec`.
