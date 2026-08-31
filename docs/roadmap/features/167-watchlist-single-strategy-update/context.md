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

## Session 2026-08-31 — sdd-design

- Phase 0 Recon: refreshed/extended recon.md (services: xstockstrat-portfolio, xstockstrat-ui). All
  prior `path:line` citations re-verified against source. Key reuse patterns: `loadOwned`
  (`portfolio_service.go:1322-1337`, NotFound/PermissionDenied authz), `touchWatchlistTx`
  (`watchlist_repo.go:305-315`, parent `updated_at` bump), `WATCHLIST_WRITE_KEY` in-flight guard.
- **New grounded findings (extend prior recon):**
  - `portfolio.watchlist_symbols` has **no `updated_at` column** (only `added_at`/`strategy_id`/
    `source`, migrations 007/008/011). The product-spec's "response ... plus an `updated_at`" cannot be
    a per-binding column without a migration (forbidden). Resolution: source it from
    `watchlists.updated_at` bumped in-tx via `touchWatchlistTx` (a 1-row write on a *different* table —
    rewrites no `watchlist_symbols` row, AC-1/AC-2 hold), or omit it. → operator-confirmable fork.
  - No `ErrBindingNotFound` sentinel exists; AC-3 needs one. Mechanism: `UPDATE ... RETURNING symbol,
    strategy_id, source`; empty result → NOT_FOUND. Postgres counts WHERE-matched rows regardless of
    value change, so a no-op `""`-unbind (AC-5) still returns the row (no false NOT_FOUND).
  - UI Layer-1 guard regression risk: `writeInFlight` (`WatchlistDetail.tsx:80-81`) counts the rebind
    only via `updateWatchlist.isPending`; moving rebind to a new hook drops it from Layer 1 unless the
    new hook's `isPending` is added — mandatory per FR-5.
  - The new hook must NOT use `useInvalidatingMutation` (always invalidates → full refetch, forbidden
    by AC-6); use a plain `useMutation` + `queryClient.setQueryData` cache-patch + `WATCHLIST_WRITE_KEY`.
- Phase 1 Grilling: 2 rounds (full). Chosen approach: additive `UpdateWatchlistBinding` RPC + single-row
  `UPDATE ... RETURNING` (+ `ErrBindingNotFound`) + `loadOwned` authz reuse + `touchWatchlistTx` parent
  bump + `portfolio.watchlist.updated` emit; UI new non-invalidating cache-patch hook + `setBinding`
  rewire + `writeInFlight` fix + one-line BFF forward + mock/e2e. Rejected: replace-all + UI-only,
  FieldMask partial-merge, ownership-joined UPDATE (collapses NotFound/PermissionDenied), whole-Watchlist
  response, per-binding `updated_at` migration, `useInvalidatingMutation` reuse.
- Constitution rules touched: C-14, C-16, C-09, C-08/P-06, C-03, C-04, C-12, C-17, F-01, F-04, F-06,
  F-07, F-11. Floor breaches: none.
- **Process note (P-04):** this /sdd-design ran in an isolated subagent; the live human approval gate
  was not run here (nested-subagent `AskUserQuestion` unavailability — `fails.md` 2026-08-08/121-123).
  The two-round proposer/adversary debate and Floor check ran in full; the one genuine fork (response
  `updated_at` source) is surfaced in design.md Open Risks for operator ratification. status.md left
  unchanged (spec-ready) — the orchestrator flips it to design-approved after ratifying.
- Open threads (→ target step): `updated_at` source (Step 1 proto), `writeInFlight` wiring (Step 4 UI),
  `ErrBindingNotFound` vs no-op (Step 2 repo test), request-symbol normalization (Step 3 service).

## Session 2026-08-31 — design decision resolved (updated_at source)

- `portfolio.watchlist_symbols` has no `updated_at` column (only `added_at`). RESOLVED: the `UpdateWatchlistBindingResponse.updated_at` is sourced from `watchlists.updated_at`, bumped in the same tx via `touchWatchlistTx` (a 1-row write on the parent table). This keeps the response field meaningful and AC-1/AC-2 hold. `/sdd-spec` implements this option.
- Secondary wiring notes for `/sdd-spec`: the new UI hook's `isPending` must be folded into `writeInFlight` (else the Layer-1 in-flight guard regresses), and the request `symbol` must be normalized before the `WHERE symbol` match.

## Session 2026-08-31 — sdd-spec

- Generated implementation-spec.md with **6 steps**. Status → implementation-ready. All 6 `@AC-*` traced
  to a test step (AC-1..AC-5 → Step 4 Go service test; AC-6 → Step 6 Playwright e2e). Proto confirmed
  **additive** (new RPC + 2 messages, per-message field numbers from 1, `buf breaking` vs main-dev
  passes). No DB migration.
- Key codebase findings (all `path:line`-grounded, no invented refs):
  - Proto `PortfolioService` block ends at `portfolio.proto:35` (`ListAllWatchlistSymbols`); messages end
    at `:311` — new RPC + `UpdateWatchlistBindingRequest{watchlist_id=1,symbol=2,strategy_id=3}` /
    `UpdateWatchlistBindingResponse{binding=1,updated_at=2}` append there. `WatchlistBinding` `:211-217`,
    `timestamp.proto` already imported `:7`.
  - Handler has TWO adapters per RPC: Connect `PortfolioHandler.*` (`portfolio_handler.go:190-228`) **and**
    gRPC `grpcPortfolioAdapter.*` with `toGRPCError` (`:343-381`) — both need an `UpdateWatchlistBinding`.
  - `s.watchlists` is the `WatchlistStore` **interface** (`portfolio_service.go:1215-1228`); the new
    `UpdateBinding` method must be added to the interface, the real `WatchlistRepo`, AND the in-memory
    `fakeWatchlistStore` (`watchlist_service_test.go:26`). No DB-backed repo test harness — service-level
    fake is the only unit seam (feature-154 `service/`-excluded note, `watchlist_service_test.go:20-21`);
    fake models Postgres WHERE-match semantics for AC-3/AC-5.
  - `touchWatchlistTx` (`watchlist_repo.go:305-315`) currently returns only `error` — spec extends it to
    `(time.Time, error)` via `RETURNING updated_at` and updates its 2 callers (`:204`,`:224`) to `_, err`,
    so `UpdateBinding` can source the response `updated_at` (design's reuse intent; DRY over an inline
    duplicate). `ErrBindingNotFound` is the one net-new sentinel, modeled on `ErrWatchlistNotFound` `:17`.
  - UI: `useInvalidatingMutation` always invalidates (forbidden by AC-6) → new hook is a plain
    `useMutation` + `queryClient.setQueryData` cache-patch carrying `binding.source` through;
    `WATCHLIST_WRITE_KEY` (`useWatchlists.ts:13`) kept for the Layer-2 guard; `writeInFlight`
    (`WatchlistDetail.tsx:80-81`) gains `updateBinding.isPending`; `setBinding` (`:111-121`) rewired off
    replace-all `updateWatchlist` (still used by `commitRename`). BFF one-line `forward` in
    `insightsBff.ts:87-98`; browser client auto-exposes (no edit). E2e adds an `UpdateWatchlistBinding`
    route to the shared `watchlistMock.ts` + INVENTORY row note; two live-enabled strategy options
    (`strat-live-001`/`strat-001`) let the AC-6 test rebind between them.
- Deduped Reviewers: **Proto Reviewer**, **xstockstrat-portfolio owner**, **xstockstrat-ui owner**.
- No "Not found / create from scratch" steps — every symbol has an existing sibling pattern
  (`ErrBindingNotFound`←`ErrWatchlistNotFound`; `UpdateBinding`←`Update`/`AddSymbols`;
  `UpdateWatchlistBinding`←`UpdateWatchlist`; new hook←`useInvalidatingMutation` shape). Net-new
  primitives named with their nearest pattern: `ErrBindingNotFound` sentinel and the
  `setQueryData` non-invalidating cache-patch.
- Next: `/sdd-review watchlist-single-strategy-update impl-spec`.
