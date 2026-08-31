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

FR-2. The rebind updates **only** `strategy_id` for that row. It must not reset or clobber the entry's
`source` (`MANUAL`/`SIGNAL`, feature 127) or `system_managed` flag (fails-080 reset trap): those
columns are preserved exactly.

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
- [ ] **Agent** — Not required for the core capability. The MCP `manage_watchlist` merge path
  (feature 148) already works around replace-all; adding a targeted agent tool is an **open question**,
  not in scope by default.
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

## Open Questions

- [ ] **Response shape:** should `UpdateWatchlistBindingResponse` return just the updated
  `WatchlistBinding`, or the full refreshed `Watchlist`? Returning only the binding is what enables the
  UI cache-patch (FR-5) without a refetch; returning the whole list defeats the purpose. Lean: return
  the single updated binding (+ maybe an `updated_at`).
- [ ] **Agent parity:** do we add a targeted `manage_watchlist_symbols` rebind verb (feature 148
  surface) in the same feature, or defer? Default: defer (UI + portfolio only) unless review wants the
  MCP surface kept in lockstep to avoid `mcp-tools.md` drift (F-12).
- [ ] **Concurrency semantics:** confirm the targeted UPDATE composes safely with an in-flight
  replace-all `UpdateWatchlist` (last-writer-wins on that row) and that the UI guard
  (`WATCHLIST_WRITE_KEY`) already serializes them adequately, or whether an optimistic-concurrency token
  is warranted.
- [ ] **Known trap (fails-080):** a bare write must never reset `strategy_id`/`source` to defaults —
  FR-2 encodes this; verify the new repo method and any UI optimistic patch don't reintroduce it.
