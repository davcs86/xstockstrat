# Product Spec: watchlist-single-strategy-update

**Created**: 2026-08-31

---

## Problem Statement

Each watchlist entry binds one symbol to one strategy (`WatchlistBinding.strategy_id`). Changing the
strategy for a single symbol today is disproportionately expensive: the UI's `setBinding` rebuilds the
**entire** binding array and sends it through the replace-all `UpdateWatchlist` RPC (server truncates
`watchlist_symbols` and re-inserts every row), then invalidates the whole `['watchlists']` query key,
forcing a full `listWatchlists` refetch. On a large watchlist this re-writes and re-fetches hundreds of
rows to change one, amplifies write-write race windows, and makes the UI flicker/reload. There is no
targeted single-symbol rebind path at any layer (proto, portfolio service, UI, or agent).

## User Story

As a trader managing a watchlist, I want to change the strategy assigned to one symbol without
re-sending or reloading the whole list, so that the change is fast, atomic to that row, and doesn't
disturb the rest of my watchlist.

## Functional Requirements

FR-1. `xstockstrat-portfolio` exposes a targeted `UpdateWatchlistBinding` RPC taking
`(watchlist_id, symbol, strategy_id)` and performing a single-row
`UPDATE portfolio.watchlist_symbols SET strategy_id = $3 WHERE watchlist_id = $1 AND symbol = $2`
— it does not touch any other row, and does not require the caller to send the full binding set or the
watchlist name/description.

FR-2. The rebind updates **only** the `strategy_id` column of that `watchlist_symbols` row. It must not
reset or clobber the entry's per-binding `source` (`WATCHLIST_ENTRY_SOURCE_MANUAL`/`_SIGNAL`,
feature 127) — the fails-080 reset trap. The list-level `system_managed` flag lives on
`portfolio.watchlists` (not on the binding row), so the single-row `UPDATE` on `watchlist_symbols`
cannot touch it and it is likewise unaffected.

FR-3. Rebinding a symbol not present in the watchlist returns `NOT_FOUND` (no implicit insert); the RPC
is authorized to the watchlist's owner (`x-user-id`), consistent with the other watchlist write RPCs.

FR-4. `strategy_id = ""` is a valid input meaning "unbind" (matches `WatchlistBinding.strategy_id`
`"" = unbound`); it clears the binding for that one row only.

FR-5. The `/insights/watchlists` UI rebinds one symbol via the new RPC and **patches just that entry in
the React-Query cache** (no full `['watchlists']` invalidation / `listWatchlists` refetch), while still
honoring the existing in-flight write guards (`WATCHLIST_WRITE_KEY` / `writeInFlight`) so a rebind can't
race a concurrent rename/remove.

## Out of Scope

- Changing the whole-list replace semantics of `UpdateWatchlist` (feature 058 FR-1) — it stays as the
  path for multi-field/multi-row edits; this feature only adds a targeted single-row alternative.
- Adding/removing symbols (that is `AddWatchlistSymbols`/`RemoveWatchlistSymbols`) or renaming a list.
- Batch multi-symbol rebind in one call (a single symbol is the unit here); a batch variant is a
  possible follow-up, not this feature.
- Changing the strategy *definition* itself (owned by `xstockstrat-analysis`, feature 070) — this only
  changes which existing `strategy_id` a watchlist row points at.

## Affected Services

Exact service names from CLAUDE.md Service Registry:
- `xstockstrat-portfolio` — Go; owns watchlists; adds the `UpdateWatchlistBinding` RPC, service method,
  handler adapter, and single-row repo update.
- `xstockstrat-ui` — Next.js `/insights` segment; `WatchlistDetail.setBinding` + `useWatchlists` hook
  switch to the targeted RPC + cache patch.

## Consumer Surface(s)

_Constitution **C-14**._

- [x] **UI** — `xstockstrat-ui` `/insights` `watchlists` page: the per-symbol strategy control
  (`WatchlistDetail` / `WatchlistReadiness` rows, `onRebindSymbol`) now performs a targeted rebind with
  no full-list reload. Already reachable via `PLATFORM_SUBNAV` (feature 058/045).
- [ ] **Agent** — **Not a deferred surface.** The MCP `manage_watchlist` merge path (feature 148)
  already provides agent-side single-symbol rebind (read-modify-write over replace-all), so there is
  no missing agent capability to defer — this feature is deliberately UI-only. No agent tool change.
- [ ] **None**

## Proto Contract Changes

- [ ] No proto changes required
- **Additive, non-breaking:** new `rpc UpdateWatchlistBinding(UpdateWatchlistBindingRequest) returns
  (UpdateWatchlistBindingResponse)` in `packages/proto/portfolio/v1/portfolio.proto`, plus the two new
  messages (`watchlist_id`, `symbol`, `strategy_id`; response returns the updated `WatchlistBinding` or
  the watchlist). New field numbers only — no removals/type changes; `buf breaking` against `main-dev`
  must pass.

## Config Key Changes

- [x] No new config keys

## Database Changes

- [x] No schema changes — `portfolio.watchlist_symbols` already has PK `(watchlist_id, symbol)`
  (`007_watchlists.up.sql`) and the `strategy_id` column (`008_watchlist_symbol_strategy.up.sql`), so a
  single-row `UPDATE ... WHERE` is directly addressable. No migration.

## Feature Workflow Notes

Branch to create: `feature/watchlist-single-strategy-update` (branch from `main-dev`)
Approval gates required (per docs/runbooks/feature-workflow.md):
- [x] 1 service owner approval (non-breaking proto change) — `xstockstrat-portfolio` owner (+ Proto Reviewer)
- [ ] 2 service owners + platform lead (breaking proto change) — N/A (additive)
- [ ] DBA review + service owner (schema migration) — N/A (no migration)

## Acceptance Criteria

See `acceptance.feature` (scenarios `@AC-*`) — the single source of acceptance truth (Constitution
**C-15**). Each `FR-N` above is covered by ≥1 tagged scenario there.

## Resolved Design Decisions

Product-level forks are decided below (no unresolved blocking questions remain — criterion 9).

- [x] **Response shape:** `UpdateWatchlistBindingResponse` returns **only the updated
  `WatchlistBinding`** (symbol, strategy_id, source, plus an `updated_at`), not the whole `Watchlist`.
  This is what lets the UI patch the single cached entry without a `listWatchlists` refetch (FR-5).
- [x] **Agent parity:** UI + portfolio only. The MCP `manage_watchlist` merge path (feature 148)
  already covers agent-side rebind, so no agent surface is deferred and there is no `mcp-tools.md`
  parity gap — no agent tool changes in this feature, so the MCP-surface-drift trap does not apply.
- [x] **Concurrency semantics:** the targeted `UPDATE` is last-writer-wins on that single row and
  composes safely with an in-flight replace-all `UpdateWatchlist`; the existing UI guard
  (`WATCHLIST_WRITE_KEY` / `writeInFlight`) serializes UI-side writes, so no optimistic-concurrency
  token is introduced. (Design confirms the guard already covers the rebind path.)
- [x] **Known trap (fails-080):** encoded in FR-2 — the rebind touches only `strategy_id`, preserving
  the per-binding `source`; the UI cache-patch likewise carries `source` through untouched (see
  Existing Business Rules the design must preserve). Verified against the repo method and the optimistic
  patch at design/spec time.
