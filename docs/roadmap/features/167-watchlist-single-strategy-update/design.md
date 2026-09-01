# Design: watchlist-single-strategy-update

**Created**: 2026-08-31
**Rounds**: 2 (full; termination: approved, one operator-confirmable decision surfaced)
**Approved by**: design generated in an isolated sdd-design subagent — the live P-04 human gate was
not run here (nested-subagent `AskUserQuestion` unavailability, per `fails.md` 2026-08-08/121-123);
the two-round proposer/adversary debate and Floor check were run in full and are recorded below. The
single genuine fork (response `updated_at` source) is carried into Open Risks for operator ratification.
**Grounded in**: recon.md

---

## Chosen Approach

A dedicated additive single-row rebind RPC, mirroring the existing watchlist-write shape end to end.

**Proto (`packages/proto/portfolio/v1/portfolio.proto`).** Append one RPC to the `PortfolioService`
block after `ListAllWatchlistSymbols` (recon `:35`):
`rpc UpdateWatchlistBinding(UpdateWatchlistBindingRequest) returns (UpdateWatchlistBindingResponse)`.
Append two new messages after the existing message definitions:
- `UpdateWatchlistBindingRequest { string watchlist_id = 1; string symbol = 2; string strategy_id = 3; }`
  (`user_id` intentionally absent — ownership from the `x-user-id` header, matching every other
  watchlist request, proto `:236-237`).
- `UpdateWatchlistBindingResponse { WatchlistBinding binding = 1; google.protobuf.Timestamp updated_at = 2; }`
  — returns **only** the updated binding (symbol/strategy_id/source, recon `:211-217`) plus a
  list-level timestamp, which is what lets the UI patch a single cache entry (FR-5). Additive only;
  `buf breaking` vs `main-dev` passes; regenerate with `./scripts/buf-gen.sh` (C-09).

**Repo (`internal/repository/watchlist_repo.go`).** New `UpdateBinding(ctx, watchlistID, symbol,
strategyID)` in one tx:
1. `UPDATE portfolio.watchlist_symbols SET strategy_id = $3 WHERE watchlist_id = $1 AND symbol = $2
   RETURNING symbol, strategy_id, source` — single-column write; `RETURNING source` reads the
   untouched provenance back (FR-2). Empty result set → new `ErrBindingNotFound` sentinel (AC-3).
2. `touchWatchlistTx(ctx, tx, watchlistID)` (recon `:305-315`, reused) bumps `watchlists.updated_at`
   and returns the new timestamp for the response. This is a 1-row write on the **`watchlists`** table
   — it rewrites **no** `watchlist_symbols` row, so AC-1 ("no full-list replace") and AC-2 hold.
Ownership is **not** re-checked in the repo (the service's `loadOwned` already did it, and re-joining
ownership into the `UPDATE` would collapse the NotFound/PermissionDenied distinction AC-3/AC-4 need).

**Service (`internal/service/portfolio_service.go`).** New `UpdateWatchlistBinding` method following
the Update/Add/Remove shape exactly: `requireUserID` → `loadOwned(ctx, userID, watchlistID)` (recon
`:1322-1337` — yields `NotFound` for an absent list, `PermissionDenied` for a non-owner: AC-4) →
`normalizeSymbols`-style uppercase/trim of the request symbol so it matches stored rows → repo
`UpdateBinding`, mapping `ErrBindingNotFound` → `connect.CodeNotFound` (AC-3) → emit
`portfolio.watchlist.updated` (parity with recon `:1459`/`:1510`/`:1529`) → return the binding +
timestamp. `strategy_id == ""` is passed through as a valid unbind (FR-4/AC-5).

**Handler (`internal/handler/portfolio_handler.go`).** One thin gRPC adapter appended, matching the
sibling watchlist adapters.

**UI consumer surface (C-14 — `xstockstrat-ui` `/insights/watchlists`).** New hook
`useUpdateWatchlistBinding` in `src/hooks/useWatchlists.ts`, built on a plain `useMutation` (**not**
`useInvalidatingMutation`, which always invalidates → full refetch):
- `mutationFn` → `insightsPortfolioClient.updateWatchlistBinding({ watchlistId, symbol, strategyId })`
  (browser client auto-exposes the RPC; add a one-line `forward()` to `insightsBff.ts:87-97`).
- `mutationKey: WATCHLIST_WRITE_KEY` (recon `:13`) so the Layer-2 `useIsMutating` cross-instance guard
  still serializes it against rename/remove (FR-5).
- `onSuccess` → `queryClient.setQueryData(WATCHLISTS_KEY, …)` patches **only** the one binding in the
  cached list from the RPC's returned `WatchlistBinding` (carrying `source`), with **no**
  `invalidateQueries` (AC-6: no `['watchlists']` invalidation, no `listWatchlists` refetch).
`WatchlistDetail.setBinding` (recon `:111-121`) is rewired to call this hook instead of
`updateWatchlist`, and **its `isPending` is added to `writeInFlight`** (recon `:80-81`) so the Layer-1
in-pane control disable still covers the rebind (FR-5 "honoring the existing in-flight write guards").
`WatchlistReadiness`'s per-row `Select` (`onRebindSymbol`) is unchanged — it re-evaluates readiness
against the patched `strategy_id` (preserves `@AC-1`/`@AC-5 feature-155`).

## Rejected Alternatives

- **Keep replace-all `UpdateWatchlist` and only optimize the UI** — rejected: the server still
  truncates+reinserts every `watchlist_symbols` row (`watchlist_repo.go:170`), so the write-write race
  window and O(n) write cost the spec targets remain; no server-side fix.
- **Add a `FieldMask`/partial-merge to `UpdateWatchlistRequest`** (feature 070 AIP-161 style) — rejected:
  heavier contract, still routes through the replace-all repo path, and a mask over a `repeated bindings`
  field does not naturally express "one symbol"; a dedicated single-symbol RPC is simpler and matches
  the PK-addressable unit (recon `:20`).
- **Join ownership into the `UPDATE`** (`UPDATE … FROM watchlists WHERE user_id = $u …`) to skip the
  `loadOwned` read — rejected: a joined update returning 0 rows cannot distinguish absent-watchlist vs
  wrong-owner vs absent-symbol, collapsing AC-3's `NOT_FOUND` and AC-4's `PERMISSION_DENIED`; reusing
  `loadOwned` keeps the exact error semantics every sibling RPC already has (and the O(n) part it
  removes was the whole-list *write*+*refetch*, not one indexed ownership read).
- **Return the whole `Watchlist` in the response** — rejected: it re-hydrates all bindings over the
  wire and invites the UI to replace the whole cache entry, defeating FR-5's single-entry patch.
- **Add a per-binding `updated_at` column via a new migration** — rejected: the spec's Database section
  commits to **no migration**; the list-level `watchlists.updated_at` (already bumped by every sibling
  write) is a sufficient response timestamp.
- **Reuse `useInvalidatingMutation` for the new hook** — rejected: it unconditionally invalidates
  `WATCHLISTS_KEY`, the exact full-refetch AC-6 forbids; a plain cache-patching `useMutation` is required.

## Open Risks

- [ ] **Operator-confirmable — response `updated_at` source.** `watchlist_symbols` has no
  `updated_at`; the design sources it from `watchlists.updated_at` (bumped via `touchWatchlistTx`).
  Alternative is to drop `updated_at` from `UpdateWatchlistBindingResponse` entirely. Bumping the
  parent row means a concurrent `ListWatchlists` ordered by `updated_at` would reorder the list on a
  rebind (cosmetic). Confirm "bump-and-return list-level `updated_at`" vs "omit" — to be settled at
  the proto step (Step 1).
- [ ] **Layer-1 guard wiring.** `writeInFlight` must gain the new hook's `isPending`; if missed, in-pane
  controls stay enabled during a rebind. Address at the UI step (Step 4); cover with the AC-6 e2e
  asserting controls disable while the rebind is pending.
- [ ] **`ErrBindingNotFound` vs no-op update.** Relies on Postgres counting `WHERE`-matched rows
  regardless of value change; verify with a paired repo test that an already-`""` unbind (AC-5) still
  returns the row (not NOT_FOUND) and an absent symbol (AC-3) returns empty. Address at Step 2.
- [ ] **Symbol normalization.** Stored symbols are upper/trimmed (`normalizeSymbols`,
  `portfolio_service.go:1238-1253`); the request symbol must be normalized the same way before the
  `WHERE symbol = $2` match or a lowercase request would spuriously NOT_FOUND. Address at Step 3.

## Constitution Rules Touched

- `C-14` — honored by: the UI `/insights/watchlists` surface gets its own step (hook + `setBinding`
  rewire + BFF + mock + e2e); agent is explicitly out (feature 148 `manage_watchlist` merge already
  covers agent rebind — no deferred surface, no `mcp-tools.md` gap).
- `C-16` — honored by: PRESERVE/EXTEND classification below; no existing `@AC-*` guarantee is broken
  or changed.
- `C-09` — honored by: the proto step runs `buf lint` + `buf breaking` and `./scripts/buf-gen.sh`;
  change is additive.
- `C-08` / `P-06` — honored by: each service/repo step is paired with a red-before-green test meeting
  the portfolio Go threshold; the UI step pairs the AC-6 Playwright e2e.
- `C-03` — honored by: reuse of the header-propagation path (`x-user-id` from `backendHeaders` via the
  BFF `forward`); ownership resolved server-side, never from the request body.
- `C-04` — honored by: `strategy_id` stays a `string` (open/runtime-registered value set — strategy
  ids are not a closed proto enum), consistent with `WatchlistBinding.strategy_id`.
- `C-12` — honored by: any new watchlist e2e domain data enters `e2e/fixtures/` (+ `INVENTORY.md`) on
  the second consumer, not inline.
- `C-17` — honored by: no new UI primitive/token — the change reuses `WatchlistReadiness`'s existing
  per-row `Select` and the existing tokens; no hardcoded color.
- `F-01` — honored by: **no migration** (existing PK + columns), so no applied `.up.sql` is edited.
- `F-04` — honored by: every `path:line` above is from recon discovery; the one gap
  (`ErrBindingNotFound` does not exist yet) is named as a to-create sentinel, not invented as present.
- `F-06` — honored by: no new DB pool or connection; reuses portfolio's existing pooled route.
- `F-07` — honored by: no config values in source; no new config key.
- `F-11` — no Floor breach flagged in either round; approval is not blocked.

## Business Rules Touched (C-16)

- PRESERVE `@AC-1 feature-154` "distinct cross-user union of watchlist symbols"
  (`services/xstockstrat-portfolio/acceptance/fundsignal-watchlist-universe.feature`) — not regressed:
  the single-row `UPDATE` inserts/deletes no rows, so the distinct symbol set is unchanged.
- PRESERVE `@AC-1 feature-127` "signal adds symbol to system-managed watchlist"
  (`docs/sdd/business-rules/platform.feature`) — not regressed: single-column `strategy_id` update +
  `RETURNING source` cannot reset a `SIGNAL` entry's `source` (fails-080).
- EXTEND `@AC-7 feature-127` "system-managed watchlist cannot be deleted"
  (`docs/sdd/business-rules/platform.feature`) — new case added: per-symbol rebind is allowed on a
  system-managed list (alongside add/remove/rename); the delete-block
  (`portfolio_service.go:1477-1479`) is untouched, and the single-row update never touches the
  list-level `system_managed` flag (AC-2).
- PRESERVE `@AC-8 feature-127` "signal-sourced entries render a provenance badge"
  (`services/xstockstrat-ui/acceptance/consolidate-watchlist-signal.feature`) — not regressed: the
  cache-patch carries the RPC's returned `source` through, so the MANUAL/SIGNAL badge survives.
- PRESERVE `@AC-1 feature-155` "firing readiness row shows firing color/icon" and
  `@AC-5 feature-155` "firing row offers jump to order detail"
  (`services/xstockstrat-ui/acceptance/watchlist-opportunity-signal-cues.feature`) — not regressed:
  the patched `strategy_id` re-drives readiness re-evaluation and the `?strategy=<id>` jump URL.

No `CHANGE` to any existing rule → no C-16 user sign-off required.
