# Recon: watchlist-single-strategy-update

**Created**: 2026-08-31
**From**: product-spec.md
**Affected services**: xstockstrat-portfolio, xstockstrat-ui

---

## Objective

Add a targeted `UpdateWatchlistBinding(watchlist_id, symbol, strategy_id)` RPC to `xstockstrat-portfolio`
(a single-row `UPDATE`) and a UI mutation that patches just that entry in the React-Query cache, so a
trader can rebind one symbol's strategy without the replace-all `UpdateWatchlist` truncate+reinsert and
the full `listWatchlists` refetch.

## Codebase Map

- **`xstockstrat-portfolio`** (Go, gRPC 50052)
  - Proto: `packages/proto/portfolio/v1/portfolio.proto` — RPCs `:20-35`; `WatchlistBinding{symbol=1,
    strategy_id=2 ("" = unbound), source=3}` `:211-217`; `Watchlist.bindings=8` `:229-233`;
    `UpdateWatchlistRequest` (replace) `:264-272`; `AddWatchlistSymbols`/`RemoveWatchlistSymbols` `:282-298`.
    New `UpdateWatchlistBinding` RPC + request/response messages go here (fresh field numbers).
  - DB: `services/xstockstrat-portfolio/migrations/007_watchlists.up.sql` (PK `(watchlist_id, symbol)` `:20`);
    `008_watchlist_symbol_strategy.up.sql:7-8` (`strategy_id TEXT NOT NULL DEFAULT ''`);
    `011_watchlist_system_managed_source.up.sql` (`system_managed` on `watchlists` `:11-12`; `source` on
    `watchlist_symbols` `:31-32`). Trunk tip `013_positions_provenance` → no migration needed (next-free 014).
  - Service: `internal/service/portfolio_service.go:1438` (`UpdateWatchlist` replace).
  - Repo: `internal/repository/watchlist_repo.go:153` (Update replaces full set); `:170` (DELETE+reinsert);
    `:317-325` (`AddWatchlistSymbols` `ON CONFLICT DO NOTHING` — cannot rebind). New single-row `UPDATE ...
    WHERE watchlist_id=$1 AND symbol=$2` goes here.
  - Handler: `internal/handler/portfolio_handler.go` (~:190-370) — gRPC adapters.
  - Test pinning replace: `internal/service/watchlist_service_test.go:517` (`TestBindings_UpdateReplaces`).
- **`xstockstrat-ui`** (Next.js `/insights`)
  - `src/app/insights/watchlists/page.tsx`; `src/components/insights/WatchlistDetail.tsx:109-121`
    (`setBinding` resends FULL bindings); `src/hooks/useWatchlists.ts:59-78` (`useUpdateWatchlist`
    invalidates `WATCHLISTS_KEY` → full refetch `:35-38`); guards `WATCHLIST_WRITE_KEY`/`writeInFlight`
    `:8-13`, `WatchlistDetail.tsx:80-81`; browser client `src/lib/browserClients/insightsPortfolioClient.ts`;
    BFF `src/lib/insightsBff.ts`; per-row render `src/components/insights/WatchlistReadiness.tsx`
    (`onRebindSymbol=setBinding`, `WatchlistDetail.tsx:253`).

## Patterns to REUSE

- Targeted partial-update RPC → mirror **feature 070**'s AIP-161 partial-merge precedent on the analysis
  `ManageStrategyRequest` (FieldMask + erasure guard) — same shape, applied to portfolio as a dedicated
  single-row RPC (`docs/roadmap/features/070-strategy-partial-update/context.md`).
- Single-row addressing → reuse the existing PK `(watchlist_id, symbol)` (`007_watchlists.up.sql:20`) — no
  schema change.
- Concurrency → reuse the existing UI write guard `WATCHLIST_WRITE_KEY`/`writeInFlight`
  (`useWatchlists.ts:8-13`), not a new mechanism.
- Provenance preservation → the `ON CONFLICT DO NOTHING` server rule (`watchlist_repo.go:317`) already
  encodes "don't reset `strategy_id`/`source`"; the new single-column `UPDATE` inherently preserves `source`.

## Existing Business Rules (preserve / extend)

- **PRESERVE** `@AC-1 @feature-154` "Portfolio enumerates the distinct cross-user union of watchlist symbols" (`services/xstockstrat-portfolio/acceptance/fundsignal-watchlist-universe.feature`) — the single-row `UPDATE` must UPDATE one row only, never truncate/re-insert, so the distinct symbol set is unaffected.
- **PRESERVE** `@AC-1 @feature-127` "A watchlist-direction signal adds the symbol to the caller's system-managed watchlist" (`docs/sdd/business-rules/platform.feature`) — the rebind must not reset a `WATCHLIST_ENTRY_SOURCE_SIGNAL` entry's `source` (fails-080 reset trap).
- **EXTEND** `@AC-7 @feature-127` "A system-managed watchlist cannot be deleted via API or UI" (`docs/sdd/business-rules/platform.feature`) — a per-symbol strategy-rebind affordance is added alongside the existing enabled add/remove/rename affordances on system-managed lists; the delete-block stays intact.
- **PRESERVE** `@AC-8 @feature-127` "Signal-sourced entries render a provenance badge, manual ones do not" (`services/xstockstrat-ui/acceptance/consolidate-watchlist-signal.feature`) — the cache-patch must preserve the cached entry's `source` so the SIGNAL/MANUAL badge does not disappear.
- **PRESERVE** `@AC-1 @feature-155` "A firing readiness row shows the firing color and firing icon" (`services/xstockstrat-ui/acceptance/watchlist-opportunity-signal-cues.feature`) — after a cache-patched rebind the readiness row must re-evaluate against the new `strategy_id`.
- **PRESERVE** `@AC-5 @feature-155` "A firing watchlist row offers a jump to the symbol's order detail" (`services/xstockstrat-ui/acceptance/watchlist-opportunity-signal-cues.feature`) — the jump URL `?strategy=<id>` must reflect the rebound strategy.

## Dependencies

- Proto/RPC: **additive, non-breaking** — new `UpdateWatchlistBinding` RPC + `UpdateWatchlistBindingRequest`
  (`watchlist_id`, `symbol`, `strategy_id`) + `UpdateWatchlistBindingResponse` (single updated
  `WatchlistBinding` + `updated_at`). New field numbers only; `buf breaking` vs main-dev must pass.
- Migration: **none** (PK + `strategy_id` column already exist).
- Config keys: none.
- Inter-service edges: UI (`/insights` BFF) → portfolio `UpdateWatchlistBinding` (gRPC).
- New env vars / ports: none.

## Risks / Not-found

- **Not found:** any single-symbol/per-binding update RPC, repo helper, or UI mutation — confirmed absent
  across proto, portfolio Go service, UI hooks, and agent tools. Every current rebind path is whole-list.
- **Ledger fail (fails-080):** a bare write must never reset `strategy_id`/`source`; encoded in FR-2. The
  optimistic UI patch must carry `source` through.
- **Ownership authz:** the RPC must resolve the watchlist owner from `x-user-id` and return `NOT_FOUND`/
  `PERMISSION_DENIED` for a non-owner (AC-3/AC-4).
- **Concurrency:** last-writer-wins on the row; verify the existing UI guard already serializes rebind vs
  rename/remove (no new token planned).

## Recommended Scope

Advisory step boundaries: (1) proto `UpdateWatchlistBinding` + buf-gen; (2) repo single-row `UPDATE` +
`NOT_FOUND` + owner authz; (3) service method + handler adapter; (4) UI hook `useUpdateWatchlistBinding`
+ cache-patch (no invalidation) + `setBinding` rewire, preserving `source` and re-evaluating readiness cue.
