# Recon: watchlist-screen-improvements

**Created**: 2026-08-07
**From**: product-spec.md
**Affected services**: `xstockstrat-ui`

---

## Objective

Rework the `/insights/watchlists` detail pane (`WatchlistDetail.tsx` + `WatchlistReadiness.tsx`):
remove the chip-row list's remove/rebind controls and relocate them onto each readiness-table row
(bound and unbound), add an inline strategy `Select` to the add-symbols flow so a symbol can be
added already bound in one call, and make the detail-pane header's watchlist name editable in place.
Pure UI composition — every mutation hook the feature needs already exists.

## Codebase Map

- **`xstockstrat-ui`** (Next.js / TypeScript)
  - Page: `services/xstockstrat-ui/src/app/insights/watchlists/page.tsx:78-101` (create card, unchanged
    per FR-5), `:109-150` (master/detail grid; detail renders `<WatchlistDetail>` at `:143`)
  - Detail pane (primary edit target): `services/xstockstrat-ui/src/components/insights/WatchlistDetail.tsx`
    - Chip-row block to remove (FR-1): `:126-165` (`data-testid="symbol-list"`, per-row
      `data-testid="binding-${symbol}"`, `Badge` + remove `X` + strategy `Select`)
    - `setBinding` full-replace semantics (FR-2, reuse as-is): `:84-96`
    - `handleAddSymbol` (FR-3 target): `:72-82`; add-symbols input row: `:167-178`
    - Header `<h2>{watchlist.name}</h2>` (FR-4 target): `:102`
    - `UNBOUND` sentinel + `Select`/`SelectItem` pattern to reuse for the add-time picker: `:39`, `:147-162`
    - `WatchlistReadiness` invocation (`bindings`/`inQueue` prop flow): `:180`
  - Readiness table (second edit target): `services/xstockstrat-ui/src/components/insights/WatchlistReadiness.tsx`
    - Component signature: `:46-52`
    - Bound row (`data-testid="readiness-row-${symbol}"`): `:110-115` — new remove/rebind controls land here
    - Unbound row (`data-testid="readiness-row-${symbol}"`, `data-testid="unbound-${symbol}"`): `:153-158`, `:160`
  - Hooks (no change needed): `services/xstockstrat-ui/src/hooks/useWatchlists.ts`
    - `useAddWatchlistSymbols` already accepts optional `bindings`: `:73-83`
    - `useRemoveWatchlistSymbols`: `:85-91`
    - `useUpdateWatchlist` (name/description/bindings full-replace): `:46-64`
  - Nav registration (already present, no change): `PLATFORM_SUBNAV` — `src/components/shared/PlatformHeader.tsx:68`;
    `NAV_GROUPS` "Discover" group — `src/components/shared/navGroups.tsx:45`

## Patterns to REUSE

- Per-symbol strategy binding UI → reuse the existing `Select`/`SelectItem` + `UNBOUND` sentinel
  pattern at `WatchlistDetail.tsx:39,147-162` for both the relocated rebind control and the new
  add-time picker — same `strategies` list from `useStrategyDefinitions()` (`WatchlistDetail.tsx:58-59`).
- Full-bindings-replace on mutation → reuse `setBinding`'s pattern (`WatchlistDetail.tsx:86-96`,
  the FR-6/feature-097 invariant) for both the relocated rebind control and the rename control — a
  rename must call `useUpdateWatchlist` with the **current** `bindings` array unchanged, never a
  partial payload (same trap `setBinding` already guards against).
- Add-with-binding in one call → reuse `useAddWatchlistSymbols`'s existing `bindings?` parameter
  (`useWatchlists.ts:73-83`) — no hook change, just pass a `WatchlistBindingInput[]` built from the
  add-input's chosen strategy.
- Remove-symbol control → reuse `useRemoveWatchlistSymbols` exactly as called today at
  `WatchlistDetail.tsx:140-142` (same mutation, new call site inside the readiness row).
- Inline rename → **no existing click-to-edit/pencil-icon pattern exists anywhere in `xstockstrat-ui`**
  (confirmed via `grep -ri "Pencil|Edit2|Edit3|contentEditable"` — no matches under `src/`). The
  nearest precedents (`e2e/insights/strategy-authoring.spec.ts:349`, `e2e/config-ui/sources.spec.ts:196`)
  are full-page/form edits, not inline header editing — not reusable. FR-4 introduces the first
  instance of this small pattern locally inside `WatchlistDetail.tsx`'s header block (a local
  `useState` toggling the `<h2>` between text and an `Input` + commit/cancel, calling
  `useUpdateWatchlist` on commit) — kept local rather than extracted into a shared component since
  there is exactly one consumer today (no DRY violation at one call site).
- Test data → reuse the existing stateful mock as-is: `MockWatchlist`/`MockBinding`
  (`e2e/helpers/watchlistMock.ts:17-25`) already backs `UpdateWatchlist` (including `req.name`
  rename at `:77`), `AddWatchlistSymbols` (`:86-95`, dedupe-keep-first), and
  `RemoveWatchlistSymbols` (`:97-109`) — **no mock or fixture changes needed** (Constitution C-12);
  `INVENTORY.md:23` row already covers all four RPCs this feature touches.

## Dependencies

- Proto/RPC: none — `WatchlistService` (`CreateWatchlist`/`UpdateWatchlist`/`AddWatchlistSymbols`/
  `RemoveWatchlistSymbols`/`DeleteWatchlist`) is unchanged; only client-side composition of existing
  calls changes.
- Migration: none.
- Config keys: none.
- Inter-service edges: none new — browser → `insightsPortfolioClient` → `insightsBff` → gRPC
  `xstockstrat-portfolio` (unchanged call chain).
- New env vars / ports: none.

## Risks / Not-found

- **Not found**: an existing inline/click-to-edit rename UI pattern in `xstockstrat-ui` to reuse for
  FR-4 — confirmed absent by grep across `src/`. Design must specify the small net-new pattern
  explicitly (see Recommended Scope) rather than pointing at a nonexistent precedent.
- **Existing e2e breakage to fix, not a design risk**: `e2e/insights/watchlists.spec.ts`'s
  `bindStrategy` helper (`:24-29`) and two test cases (`:32-57` "create...remove...delete",
  `:108-132` "readiness rollup buckets") target `binding-${symbol}` / the chip row's Select and
  `Remove ${symbol}` button — these break the moment FR-1 removes the chip-row block and must be
  repointed at the relocated readiness-row controls in the same feature (already flagged as a step
  target, not a new risk).
- `fails.md` trap (feature 097, "fails-080" in-code label) — a partial-bindings write resets other
  symbols' `strategyId` to unbound. Both the relocated rebind control and the new rename control
  must send the **full** current `bindings` array, never just the changed field — already the
  pattern `setBinding` follows and the one the new rename handler must copy.
- No Floor (`F-*`) risk identified — no migration, no proto, no config, no cross-service call.

## Recommended Scope

1. **FR-2 + FR-1** (do together — relocating requires the new location to exist first): add
   remove-symbol + strategy-rebind controls to `WatchlistReadiness.tsx`'s bound and unbound rows
   (passing through `onRemove`/`onRebind` callbacks + the `strategies` list from `WatchlistDetail`),
   then delete the `WatchlistDetail.tsx:126-165` chip-row block. Update
   `e2e/insights/watchlists.spec.ts`'s `bindStrategy` helper and the two affected tests to target the
   readiness-row controls in the same step.
2. **FR-3**: add a strategy `Select` beside the add-symbols `Input` (`WatchlistDetail.tsx:167-178`),
   defaulting to `UNBOUND`; on add, build `bindings` from the chosen strategy for every symbol
   entered and pass to `useAddWatchlistSymbols`.
3. **FR-4**: local click-to-edit state on the `<h2>` (`WatchlistDetail.tsx:102`) — text mode /
   edit-mode `Input` + commit (Enter or blur, non-empty+trimmed+changed only) / cancel (Escape),
   calling `useUpdateWatchlist` with the current `description`/`bindings` unchanged. Add one new e2e
   case for rename.
4. No FR-5 step needed — the create card is explicitly unchanged.
