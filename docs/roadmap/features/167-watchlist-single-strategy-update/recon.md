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
  - Proto `packages/proto/portfolio/v1/portfolio.proto`:
    - `service PortfolioService` block `:10-36`; existing watchlist RPCs `:20-35` (last is
      `ListAllWatchlistSymbols` `:35`) — the new `UpdateWatchlistBinding` RPC line appends here.
    - `WatchlistBinding { symbol=1; strategy_id=2 ("" = unbound); source=3 }` `:211-217`.
    - `WatchlistEntrySource` enum `:204-208` (`UNSPECIFIED=0`/`MANUAL=1`/`SIGNAL=2`).
    - `Watchlist.bindings = 8` `:230`; `Watchlist.system_managed = 9` `:233` (list-level flag).
    - `UpdateWatchlistRequest` (replace) `:265-272`; `AddWatchlistSymbolsRequest` `:282-287`;
      `RemoveWatchlistSymbolsRequest` `:292-295`. Last message block ends `:308`+ — the two new
      messages append after the existing message definitions (fresh, per-message field numbers).
  - DB migrations `services/xstockstrat-portfolio/migrations/`:
    - `007_watchlists.up.sql:16-21` — `watchlist_symbols` with **PK `(watchlist_id, symbol)`** `:20`
      and columns `symbol`, **`added_at`** (`:19`) — note **no `updated_at`**; `watchlists` has
      `updated_at` `:12`.
    - `008_watchlist_symbol_strategy.up.sql:7-8` — `strategy_id TEXT NOT NULL DEFAULT ''`.
    - `011_watchlist_system_managed_source.up.sql` — `system_managed` on `watchlists` `:15-16`;
      `source SMALLINT NOT NULL DEFAULT 0` on `watchlist_symbols` `:31-32`.
    - Last applied migration on trunk: `013_positions_provenance` (next free = `014`, **not needed** —
      no schema change).
  - Service `internal/service/portfolio_service.go`:
    - `loadOwned(ctx, userID, watchlistID)` `:1322-1337` — **the reusable authz helper**: returns
      `CodeNotFound` if the watchlist is absent (`:1328-1329`), `CodePermissionDenied` if owned by
      another user (`:1333-1334`); loads the full watchlist via `watchlists.GetByID`.
    - `requireUserID(ctx)` `:1312-1318` — resolves caller from `middleware.FromContext(ctx).UserID`.
    - `UpdateWatchlist` `:1439-1463` (replace; calls `loadOwned` then `watchlists.Update`; emits
      `portfolio.watchlist.updated` `:1459`). `AddWatchlistSymbols` `:1490-1514` and
      `RemoveWatchlistSymbols` `:1517-1533` follow the same `loadOwned` → repo → emit shape.
  - Repo `internal/repository/watchlist_repo.go`:
    - `Update` `:153-180` — `DELETE FROM watchlist_symbols` `:170` + `insertBindingsTx` (full replace).
    - `insertBindingsTx` `:320-330` — `INSERT ... ON CONFLICT (watchlist_id, symbol) DO NOTHING`
      (`:324`) — preserves an existing binding's `strategy_id`/`source` (the fails-080 guard); it
      **cannot rebind** an existing row.
    - `touchWatchlistTx` `:305-315` — bumps `watchlists.updated_at`, returns `ErrWatchlistNotFound`
      on 0 rows. Used by Add/RemoveSymbols. **Reusable** to bump the parent row + get a list-level
      `updated_at`.
    - `listBindings` `:268-291` — `SELECT symbol, strategy_id, source ... ORDER BY symbol`.
    - `ErrWatchlistNotFound` sentinel (used by `loadOwned`); **no binding-level not-found sentinel
      exists yet** — a new `ErrBindingNotFound` is needed for AC-3.
  - Handler adapter `internal/handler/portfolio_handler.go` — gRPC method adapters (one thin adapter
    per service method; a new `UpdateWatchlistBinding` adapter appends here).
  - Test pinning replace semantics: `internal/service/watchlist_service_test.go` (e.g.
    `TestBindings_UpdateReplaces` region).
- **`xstockstrat-ui`** (Next.js `/insights`)
  - `src/hooks/useWatchlists.ts`:
    - `WATCHLISTS_KEY = ['watchlists']` `:7`; `WATCHLIST_WRITE_KEY = ['watchlist-write']` `:13`
      (shared `mutationKey` for the Layer-2 `useIsMutating` cross-instance guard).
    - `useUpdateWatchlist` `:59-78` — built on `useInvalidatingMutation`, **invalidates
      `WATCHLISTS_KEY`** (`:75`) → full `listWatchlists` refetch. `useAddWatchlistSymbols` `:87-98`
      and `useRemoveWatchlistSymbols` `:100-107` likewise. `WatchlistBindingInput` `:20`;
      `UNBOUND`/`toApiStrategyId` `:23-26`.
  - `src/hooks/useInvalidatingMutation.ts` — canonical "call BFF RPC then invalidate keys" factory
    (always invalidates; has no patch mode).
  - `src/components/insights/WatchlistDetail.tsx`:
    - `setBinding(symbol, strategyId)` `:111-121` — rebuilds the **full** bindings array and calls
      `updateWatchlist.mutate(...)` (replace-all).
    - `writeInFlight` `:80-81` = `addSymbols.isPending || removeSymbols.isPending ||
      updateWatchlist.isPending` — the **Layer-1** guard; rebind currently counts via
      `updateWatchlist.isPending`.
    - `onRebindSymbol={setBinding}` wired into `WatchlistReadiness` `:253`.
  - `src/components/insights/WatchlistReadiness.tsx` — renders per-binding rows + the per-row strategy
    `Select` (`onRebindSymbol`).
  - BFF `src/lib/insightsBff.ts` — `router.service(PortfolioService, {...})` block `:87-97`; each
    watchlist RPC is a one-line `forward((req, opts) => portfolioClient.<rpc>(req, opts))`
    (`updateWatchlist` `:94`). A new `updateWatchlistBinding: forward(...)` appends here.
  - Browser client `src/lib/browserClients/insightsPortfolioClient.ts` — `createClient(PortfolioService,
    makeBrowserTransport('/insights/api'))`; **auto-exposes** the new RPC once the proto is regenerated
    (no per-method edit).
  - E2E `e2e/mock-backend.ts` — `listWatchlists()` default handler `:294-298` (empty; write specs
    override per-test via `watchlistMock.ts`, ref `:677`). A mock `updateWatchlistBinding` handler is
    needed for the AC-6 e2e. Fixtures: `e2e/fixtures/` has no `watchlists.ts` yet (C-12).

## Patterns to REUSE

- **Ownership/authz** → reuse `loadOwned` (`portfolio_service.go:1322-1337`) exactly as every other
  watchlist write RPC does — do **not** hand-roll a new owner check. It already yields
  `NotFound`(absent) / `PermissionDenied`(wrong owner) covering AC-3's watchlist-absent and AC-4.
- **Single-row addressing** → reuse the existing PK `(watchlist_id, symbol)`
  (`007_watchlists.up.sql:20`) — a directly addressable `UPDATE ... WHERE watchlist_id=$1 AND symbol=$2`.
  No schema change.
- **Parent-row touch + list-level `updated_at`** → reuse `touchWatchlistTx`
  (`watchlist_repo.go:305-315`), same as Add/RemoveSymbols, to bump `watchlists.updated_at` in the
  same tx and source the response timestamp (there is no per-binding `updated_at` column).
- **`source` preservation** → a single-column `UPDATE ... SET strategy_id` inherently leaves `source`
  untouched; `RETURNING symbol, strategy_id, source` reads the untouched `source` back — mirrors the
  intent of the `ON CONFLICT DO NOTHING` fails-080 guard (`watchlist_repo.go:320-330`) without needing it.
- **Ledger emit parity** → emit `portfolio.watchlist.updated` (`portfolio_service.go:1459`,`:1510`,`:1529`)
  from the new method too, matching Update/Add/Remove.
- **UI in-flight guard** → reuse `WATCHLIST_WRITE_KEY` `mutationKey` (`useWatchlists.ts:13`) for the
  Layer-2 `useIsMutating` guard, and **add the new mutation's `isPending` to `writeInFlight`**
  (`WatchlistDetail.tsx:80-81`) for Layer 1.
- **BFF/browser plumbing** → one-line `forward()` in `insightsBff.ts:87-97`; browser client
  auto-exposes (no edit) — the established watchlist-RPC wiring.
- **Frontend fixtures (C-12)** → `e2e/fixtures/` + `INVENTORY.md`; a `watchlists.ts` fixture is a
  second-consumer candidate once the AC-6 spec plus any existing watchlist override share a shape.

## Existing Business Rules (preserve / extend)

- **PRESERVE** `@AC-1 @feature-154` "Portfolio enumerates the distinct cross-user union of watchlist
  symbols" (`services/xstockstrat-portfolio/acceptance/fundsignal-watchlist-universe.feature`) — the
  single-row `UPDATE` touches one existing row and inserts/deletes nothing, so the distinct symbol set
  is unchanged.
- **PRESERVE** `@AC-1 @feature-127` "A watchlist-direction signal adds the symbol to the caller's
  system-managed watchlist" (`docs/sdd/business-rules/platform.feature`) — the rebind must not reset a
  `WATCHLIST_ENTRY_SOURCE_SIGNAL` entry's `source` (fails-080 reset trap); a single-column
  `strategy_id` update cannot.
- **EXTEND** `@AC-7 @feature-127` "A system-managed watchlist cannot be deleted via API or UI"
  (`docs/sdd/business-rules/platform.feature`) — the per-symbol rebind affordance is added alongside
  the already-enabled add/remove/rename affordances on system-managed lists; the delete-block
  (`DeleteWatchlist`'s `system_managed` check, `portfolio_service.go:1477-1479`) is untouched.
- **PRESERVE** `@AC-8 @feature-127` "Signal-sourced entries render a provenance badge, manual ones do
  not" (`services/xstockstrat-ui/acceptance/consolidate-watchlist-signal.feature`) — the cache-patch
  must carry the entry's `source` through so the SIGNAL/MANUAL badge does not disappear; using the
  RPC's `RETURNING source` value in the patch guarantees it.
- **PRESERVE** `@AC-1 @feature-155` "A firing readiness row shows the firing color and firing icon"
  (`services/xstockstrat-ui/acceptance/watchlist-opportunity-signal-cues.feature`) — after a
  cache-patched rebind, the readiness row must re-evaluate against the **new** `strategy_id`.
- **PRESERVE** `@AC-5 @feature-155` "A firing watchlist row offers a jump to the symbol's order
  detail" (same file) — the jump URL `?strategy=<id>` must reflect the rebound strategy after the patch.

## Dependencies

- Proto/RPC: **additive, non-breaking**. New `rpc UpdateWatchlistBinding(UpdateWatchlistBindingRequest)
  returns (UpdateWatchlistBindingResponse)` appended to the `PortfolioService` block (after `:35`);
  new `UpdateWatchlistBindingRequest { string watchlist_id = 1; string symbol = 2; string strategy_id
  = 3; }` and `UpdateWatchlistBindingResponse { WatchlistBinding binding = 1; google.protobuf.Timestamp
  updated_at = 2; }` appended after the existing messages. Field numbers are per-message and start at
  1 — no collision. `buf breaking` vs `main-dev` passes (additions only; no removal/renumber/retype).
  Run `./scripts/buf-gen.sh` (C-09).
- Migration: **none** (PK + `strategy_id` + `source` columns already exist).
- Config keys: none.
- Inter-service edges: UI `/insights` BFF → portfolio `UpdateWatchlistBinding` (gRPC 50052). No new
  backend→backend edge.
- New env vars / ports: none.

## Risks / Not-found

- **No per-binding `updated_at` column** (`007_watchlists.up.sql` — `watchlist_symbols` has `added_at`,
  not `updated_at`). The product spec's "response ... plus an `updated_at`" cannot be a per-row column
  without a migration, which the spec forbids. → **Design fork (resolved in design.md):** source the
  response `updated_at` from `watchlists.updated_at` bumped in the same tx (reuse `touchWatchlistTx`),
  or omit `updated_at`. Bumping the parent `watchlists` row is a 1-row write on a **different** table
  and rewrites **no** `watchlist_symbols` row, so AC-1/AC-2 still hold.
- **No `ErrBindingNotFound` sentinel** exists (`watchlist_repo.go` only has `ErrWatchlistNotFound`).
  AC-3 needs the repo to signal "symbol row absent" distinctly → new sentinel mapped to `CodeNotFound`.
  Mechanism: `UPDATE ... RETURNING symbol, strategy_id, source`; empty result set → `ErrBindingNotFound`.
  Postgres counts a row as matched by the `WHERE` clause regardless of whether `strategy_id`'s value
  actually changes, so an empty `RETURNING` reliably means "no such symbol", **not** "unchanged value"
  — no false NOT_FOUND on a no-op rebind (AC-5's `""`-unbind of an already-unbound row still returns
  the row).
- **UI Layer-1 guard regression (fails-080-adjacent trap):** `writeInFlight`
  (`WatchlistDetail.tsx:80-81`) counts the rebind only via `updateWatchlist.isPending` today. Moving
  the rebind to a new mutation hook **silently drops rebind from Layer 1** unless the new hook's
  `isPending` is added to `writeInFlight`. The product spec's FR-5 "still honoring the existing
  in-flight write guards" makes this mandatory, not optional.
- **Cache-patch vs canonical factory:** `useInvalidatingMutation` always invalidates (→ full refetch),
  which is exactly what FR-5/AC-6 forbid. The rebind needs a dedicated non-invalidating `useMutation`
  that (a) carries `mutationKey: WATCHLIST_WRITE_KEY` for the Layer-2 guard and (b) on success
  `queryClient.setQueryData(WATCHLISTS_KEY, …)` patches the one binding from the RPC's returned
  `WatchlistBinding` (carrying `source`). Not a change to the shared factory.
- **fails-080 (ledger):** a bare write must never reset `strategy_id`/`source`; encoded in FR-2 and
  structurally impossible here (single-column update + `RETURNING source`).
- **Not found:** no single-symbol/per-binding update RPC, repo helper, mock handler, or UI mutation —
  confirmed absent across proto, portfolio Go service, UI hooks/components, `insightsBff.ts`, and the
  agent tools. Every current rebind path is whole-list.

## Recommended Scope

Advisory step boundaries: (1) proto — append RPC + two messages, `./scripts/buf-gen.sh`, `buf
lint`/`buf breaking`; (2) repo — single-row `UPDATE ... RETURNING` + `ErrBindingNotFound` +
`touchWatchlistTx` parent-bump (+ paired repo/service test); (3) service method + handler adapter
(reuse `loadOwned`; map `ErrBindingNotFound`→NotFound; emit `portfolio.watchlist.updated`) + paired
test covering AC-1..AC-5; (4) UI — new `useUpdateWatchlistBinding` (non-invalidating, cache-patch,
`WATCHLIST_WRITE_KEY`) + rewire `setBinding` + add its `isPending` to `writeInFlight` + BFF one-line
`forward` + mock handler + e2e covering AC-6.
