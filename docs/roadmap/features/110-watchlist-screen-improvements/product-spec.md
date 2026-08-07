# Product Spec: watchlist-screen-improvements

**Created**: 2026-08-07

---

## Problem Statement

On the `/insights/watchlists` detail pane, per-symbol edit (strategy binding) and delete (remove
symbol) controls live in a chip-row list above the readiness table, duplicating the symbol/strategy
information already shown per-row in the readiness table below. Adding a new symbol is a two-step
flow (add unbound, then separately pick its strategy from the chip row). The watchlist's name can
only be set at creation — there is no way to rename an existing watchlist from the UI.

## User Story

As an insights user managing watchlists, I want to edit or remove a symbol directly from its
readiness row, choose the strategy at the moment I add a symbol, and rename an existing watchlist,
so that I can manage a watchlist's contents and identity from one place without duplicated controls
or an extra step.

## Functional Requirements

FR-1. The per-symbol chip-row list currently above the "Add symbols" input (`WatchlistDetail.tsx`
symbol-list block, with its Badge + remove-`X` + strategy `Select`) is removed. Its two actions —
remove symbol and re-bind strategy — are relocated onto each row of the readiness table
(`WatchlistReadiness.tsx`), for both bound (evaluated) and unbound ("not evaluated") rows.

FR-2. The readiness table row gains a remove-symbol control (equivalent to the current chip's `X`
button — same `useRemoveWatchlistSymbols` call) and a strategy-rebind `Select` (equivalent to the
current chip row's binding `Select` — same `setBinding` replace-full-bindings-set behavior, keeping
the FR-6/fails-080 no-partial-reset invariant from feature 097).

FR-3. The "Add symbols" input gains an inline strategy `Select` (reusing the same strategy-definition
list and `UNBOUND` sentinel pattern already used for re-binding). Symbols entered are added already
bound to the chosen strategy in a single `useAddWatchlistSymbols` call (the hook already accepts an
optional `bindings` array — no proto/BFF change needed). Leaving the selector on "Unbound" preserves
today's default (add unbound, bind later from the table row).

FR-4. The watchlist name in the detail-pane header becomes editable in place (e.g. click-to-edit or
a pencil-icon control next to the `<h2>`): committing a new non-empty, trimmed name calls
`useUpdateWatchlist` with the existing name/description/bindings otherwise unchanged, so a rename
never resets bindings (same full-replace pattern FR-2 relies on). Canceling or submitting an
unchanged/empty name is a no-op.

FR-5. The page-level "New watchlist name" create card (top of `/insights/watchlists`, used to create
a *new* watchlist) is unchanged — FR-4 only adds renaming for the currently *selected* watchlist in
the detail pane.

## Out of Scope

- Bulk symbol add/remove or bulk re-bind.
- Renaming from the master (list-of-watchlists) column — rename happens only in the detail pane
  header for the selected watchlist.
- Any change to `WatchlistService` proto, the BFF routers, or the two existing mutation hooks
  (`useAddWatchlistSymbols` already takes `bindings`; `useUpdateWatchlist` already takes
  `name`/`bindings`) — this is a UI-composition change only.
- Undo for a rename or a strategy rebind.

## Affected Services

- `xstockstrat-ui` — `/insights/watchlists` detail pane (`WatchlistDetail.tsx`,
  `WatchlistReadiness.tsx`); no BFF/proto touch.

## Consumer Surface(s)

- [x] **UI** — `xstockstrat-ui` segment: `/insights` (`/insights/watchlists` route) — relocates
  existing per-symbol edit/delete controls into the readiness table, adds an inline strategy
  selector to the add-symbol flow, and adds watchlist-name rename in the detail pane. Route is
  already registered in `PLATFORM_SUBNAV` (reachability already covered by feature 058/060's fix in
  `fails.md` 2026-07-01) — this feature only changes controls within the existing page.
- [ ] **Agent** — none.
- [ ] **None**.

## Proto Contract Changes

- [x] No proto changes required

## Config Key Changes

- [x] No new config keys

## Database Changes

- [x] No schema changes

## Feature Workflow Notes

Branch to create: `feature/watchlist-screen-improvements` (branch from `main-dev`)
Approval gates required (per docs/runbooks/feature-workflow.md):
- [x] 1 service owner approval (non-breaking, UI-only change)
- [ ] 2 service owners + platform lead (breaking proto change)
- [ ] DBA review + service owner (schema migration)

## Acceptance Criteria

1. The chip-row list above "Add symbols" no longer renders; each readiness-table row (bound and
   unbound) shows a remove-symbol control and a strategy-rebind `Select`, both wired to the same
   mutations the old chip row used.
2. The "Add symbols" input has an adjacent strategy `Select`; adding symbols with a strategy chosen
   creates them already bound (single call, visible immediately as an evaluated/bound row); leaving
   it on "Unbound" reproduces today's default behavior.
3. The detail-pane header's watchlist name can be edited in place and persists via
   `useUpdateWatchlist` without resetting existing bindings or the description.
4. Existing watchlist e2e coverage (add/remove symbol, re-bind, delete watchlist, readiness rollup)
   is updated to target the new row-level controls and continues to pass; a new case covers rename.

## Open Questions

- [ ] None — scope resolves cleanly against the existing hooks/components; no backend change needed.
