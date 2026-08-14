# Context: strategy-symbol-denylist

**Feature**: `docs/roadmap/features/132-strategy-symbol-denylist/feature.md`
**Product Spec**: `docs/roadmap/features/132-strategy-symbol-denylist/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/132-strategy-symbol-denylist/implementation-spec.md`

---

## Session 2026-08-14T04:00:00Z — sdd-story

- Created feature.md (status: draft), product-spec.md, context.md from user story.
- **Origin**: raised mid-session while discussing 130/131/022 (signal source weights,
  live-strategy-opportunity-attribution, signal decay). User asked two things: (1) a conceptual
  question about how signal-conviction vs. readiness-conviction contradictions rank in the
  Opportunities queue (answered directly, no code change needed — the two axes are deliberately
  never blended per feature 097's Option 2; `conviction` stays purely rule-based/readiness-driven,
  `signal_axis` stays purely signal-driven, they only combine in the queue's *sort order*, never in
  the `action_tag`); (2) this feature — replace the opt-in `signal_params.symbols` allowlist with a
  deny list.
- Before storying, asked two clarifying questions via `AskUserQuestion` (per CLAUDE.md behavior #1 —
  a deny list implies an unstated "everything else" universe, and this directly collides with
  131-live-strategy-opportunity-attribution's design, which assumes the opt-in list):
  1. **Universe scope** — user chose "Union of Watchlists, Held positions and Active Signals" (not
     the broader marketdata-wide universe, not a new admin-curated list). This is elegant: it's
     exactly the same union `_compute_opportunities` already builds per-user
     (`watchlist_by_symbol`/`held_norm`/`signals_by_symbol`, `servicer.py:2102-2109`) — reuses an
     existing shape rather than inventing a second one.
  2. **131 interaction** — user chose "Amend 131's design before /sdd-spec" (not a competing
     feature that blocks/supersedes 131 as a separate artifact). 131 is `design-approved` but not
     yet implemented (still spec-ready in `merge-order.md`'s sequence, waiting on 130), so amending
     its design.md directly (rather than leaving it as dead weight) is the correct move — this will
     happen during `/sdd-design` for 132, not during this story pass.
- **Grounded FR-1's proto field** directly: `StrategyDefinition` (`analysis.proto:249-274`) next
  free field number is `12` (after `exit_cooldown_days = 11`); persists via `definition_json JSONB`
  (`migrations/001_strategies.up.sql:4`) — confirmed no migration needed, same as every other
  `StrategyDefinition` field.
- **Grounded FR-4's UI surfaces** directly (not assumed from the user's description): confirmed
  `/insights/market/[symbol]/page.tsx` (Symbol detail) and `/insights/strategies/[id]/edit/page.tsx`
  (Strategy edit) both exist on disk (`find` confirmed) — these are the two pages the user named.
- **Surfaced a critical, unresolved architecture question** in product-spec.md's Open Questions
  (not resolved in this story — deliberately deferred to `/sdd-design` Phase 0 Recon, per this
  session's own established pattern of not letting an SDD phase silently assume feasibility): FR-3's
  union requires aggregating watchlist + held positions **across all users**, but `live_loop.py`
  evaluates strategies platform-wide (no `user_id` on strategies — same fact
  `insights.md` 2026-08-13 already names), while `ListPositions`/`ListWatchlists`
  (`portfolio.proto:132-138,213-217`) are strictly single-user-scoped (by request field or
  `x-user-id` header respectively) — grep-confirmed no cross-user "list all" RPC exists on
  `portfolio.proto` today. Active signals (`QuerySignals`) are already platform-wide, so only the
  watchlist/held portions of the union are actually blocked on this gap. Three candidate resolutions
  named (new cross-user admin RPC; split live-loop's own alerting universe from Opportunities'
  read-side attribution universe; something else) — none chosen, this is explicitly `/sdd-design`'s
  job to resolve against real code, not this story's.
- Also surfaced (Open Questions): `analysis.engine.max_strategies_per_cycle`'s cap
  **truncates rather than round-robins** (`insights.md` 2026-08-13, `live_loop.py:102-110`) — if
  FR-3's union meaningfully grows average per-strategy symbol counts vs. today's small opt-in
  lists, some `(strategy, symbol)` pairs could permanently starve, not just occasionally miss a
  cycle; flagged as in-scope for `/sdd-design` to assess, not a separate follow-up.
- Ledger check (`fails.md`/`insights.md`): re-confirmed the `023-position-sizing-engine`
  ordinal/cardinal trap (`Opportunity.conviction`) applies to FR-5's skipped/muted row design — a
  skipped row's absent trace must not be represented as `conviction=0`, carried into Open Questions
  as an explicit guardrail for `/sdd-design`.
- Consumer surface (C-14): UI (`/insights` — Symbol page, Strategy edit page, Opportunities page) +
  Agent (`manage_strategy` MCP tool + `strat-lab` plugin skill, per root CLAUDE.md's same-PR rule
  for changes to that tool).
- Status: draft. Next: `/sdd-review strategy-symbol-denylist product-spec`.

## Session 2026-08-14T04:30:00Z — dependency created: 133-strategy-user-ownership

- User's resolution to this story's critical Open Question (cross-user aggregation for FR-3's
  universe): make strategies user-bound, closing the gap by construction. Storied as a new,
  separate feature — `133-strategy-user-ownership` — since it's a foundational, wide-blast-radius
  change (composite `(user_id, strategy_id)` uniqueness, full ownership gating including
  `RunBacktest`, touches every table/proto referencing a bare `strategy_id`) well beyond this
  feature's own scope.
- **133 is now a hard prerequisite for this feature's FR-3** (the union-universe mechanism needs a
  resolved owner to scope `ListPositions`/`ListWatchlists` against). FR-1/FR-2 (the
  `denied_symbols` proto field + `ManageStrategy` masking), FR-4 (UI edit surfaces), and FR-7 (agent
  tool) may not need to wait — `/sdd-design` for this feature should confirm exact sequencing once
  133 has its own design.
- **Field-number coordination**: this feature claims `StrategyDefinition` field `12`
  (`denied_symbols`); 133 claims field `13` (`user_id`). Whichever feature's `/sdd-spec` runs second
  must re-verify the number is still free against the other's actual landed state, not this
  session's snapshot.
- `merge-order.md` not yet updated — deferred until `/sdd-design` confirms the exact dependency
  shape between 132 and 133 (full block vs. partial-landing split).
