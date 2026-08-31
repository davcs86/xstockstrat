# Context: watchlist-single-strategy-update

**Feature**: `docs/roadmap/features/167-watchlist-single-strategy-update/feature.md`
**Product Spec**: `docs/roadmap/features/167-watchlist-single-strategy-update/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/167-watchlist-single-strategy-update/implementation-spec.md`

---

## Session 2026-08-31 — sdd-story

- Created feature.md (status: draft), product-spec.md, acceptance.feature, context.md from user story.
- **Grounding (codebase-discovery digest):**
  - Watchlists owned by `xstockstrat-portfolio` (Go, gRPC 50052). Per-symbol strategy lives on the
    entry: `WatchlistBinding.strategy_id` (`packages/proto/portfolio/v1/portfolio.proto:211-217`), DB
    col `portfolio.watchlist_symbols.strategy_id` (`migrations/008_watchlist_symbol_strategy.up.sql`),
    PK `(watchlist_id, symbol)` (`007_watchlists.up.sql`).
  - **No targeted single-symbol update RPC exists.** Changing one symbol's strategy today goes through
    replace-all `UpdateWatchlist` (`portfolio.proto:264-272`; repo truncate+reinsert
    `internal/repository/watchlist_repo.go:170`). `AddWatchlistSymbols` is `ON CONFLICT DO NOTHING`
    (`watchlist_repo.go:317`) so it cannot rebind. UI `WatchlistDetail.setBinding`
    (`services/xstockstrat-ui/src/components/insights/WatchlistDetail.tsx:109-121`) resends the FULL
    bindings array and `useUpdateWatchlist` invalidates `WATCHLISTS_KEY`
    (`src/hooks/useWatchlists.ts:59-78`) → full `listWatchlists` refetch. That whole-list write+refetch
    is the cost this feature removes.
  - Precedent: **feature 070** added `FieldMask` AIP-161 partial update to the *analysis*
    `ManageStrategyRequest` with a server-side erasure guard — the pattern to mirror here (targeted RPC
    on portfolio instead of replace-all).
- **Prior features to respect:** 058 (replace semantics of `UpdateWatchlist`; caps
  `portfolio.watchlist.max_*`), 097 (strategy on the entry; the fails-080 "bare `symbols` write must
  never reset `strategyId` to ''" trap, enforced by `ON CONFLICT DO NOTHING`), 127 (`source`
  MANUAL/SIGNAL + `system_managed`, first-writer-wins — a rebind must not clobber `source`), 148
  (`manage_watchlist` is a read-modify-write merge over replace-all — no partial path at the tool layer
  either), 155 (`WatchlistReadiness` renders per-binding rows, wires `onRebindSymbol=setBinding`).
- **Ledger trap folded in:** fails-080 reset trap → FR-2 (rebind touches only `strategy_id`, preserves
  `source`/`system_managed`); MCP tool-surface drift (F-12) → agent-parity Open Question.
- **Decisions:** no DB migration (existing PK addressable); additive non-breaking proto RPC; UI cache
  patch instead of invalidation. Response-shape (binding vs whole watchlist) left as an Open Question —
  returning only the binding is what enables the no-refetch UI patch.
- **Consumer surface (C-14):** UI `/insights` watchlists (per-symbol strategy control). Agent parity
  deferred (Open Question).

## Session 2026-08-31 — sdd-review product-spec

- Ran /sdd-review (not skipped). spec-reviewer + feature-overlap.
- Initial verdict: FAIL (criterion 9 — four unchecked Open Questions) + warnings (C-14 agent surface deferred
  via Open Question not a named follow-up; phantom `F-12` Floor citation; FR-2/AC-2 conflated list-level
  `system_managed` with a per-binding field). Overlap: CLEAN (additive UpdateWatchlistBinding RPC; no
  migration/config-key collision; next-free portfolio migration 014 if ever needed).
- Fixes: Open Questions → "Resolved Design Decisions" (response=single WatchlistBinding+updated_at; UI-only,
  agent already covered by feature-148 merge path; concurrency last-writer-wins + existing WATCHLIST_WRITE_KEY guard;
  fails-080 encoded in FR-2). FR-2/AC-2 reworded (system_managed = watchlist-level flag; source = per-binding, preserved).
  Removed phantom F-12 reference.
- Re-review verdict: PASS (residual F-12 wording warning also cleared).
- Status: draft → spec-ready. Next: /sdd-design watchlist-single-strategy-update quick.
