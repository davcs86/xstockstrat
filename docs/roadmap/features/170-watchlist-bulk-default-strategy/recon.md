# Recon: watchlist-bulk-default-strategy

**Created**: 2026-09-03
**From**: product-spec.md
**Affected services**: xstockstrat-portfolio, packages/proto, xstockstrat-ui, xstockstrat-agent

---

## Objective

Extend the Insights watchlist experience with multi-select **bulk operations** (bulk-remove symbols;
bulk-assign one strategy across the selection via a new atomic RPC) and a watchlist-level **default
strategy** that binds newly-added, otherwise-unbound symbols **at add time only** (no retroactive
rebind, no read-time fallback). Backed by an additive `xstockstrat-portfolio` proto/DB change and
surfaced in both the Insights UI and the agent MCP tools.

## Codebase Map

- **`xstockstrat-portfolio`** (Go) — owns watchlists (feature 058)
  - Servicer `UpdateWatchlistBinding` (single-row rebind, mirror target): `internal/service/portfolio_service.go:1496`
  - Ownership gate `loadOwned(ctx, userID, watchlistId)` (service-layer, NOT SQL): `internal/service/portfolio_service.go:1352-1366`
  - `requireUserID(ctx)` → `middleware.FromContext(ctx).UserID`: `internal/service/portfolio_service.go:1342`; header extracted by unary interceptor `internal/middleware/propagation.go:27-34`
  - Bare-symbol→binding mapping `requestBindings` (`internal/service/portfolio_service.go:1313`) → `normalizeBindings` (`:1288`, uppercases/trims/dedupes, sets `StrategyId`) — **the single service-layer chokepoint where the add-time default fallback belongs**
  - `CreateWatchlist` servicer `:1370` (builds `requestBindings` `:1378`); `AddWatchlistSymbols` servicer `:1552` (`requestBindings` `:1561`)
  - Repo single insert chokepoint `insertBindingsTx` `internal/repository/watchlist_repo.go:368` (`INSERT ... (watchlist_id,symbol,strategy_id,source) ... ON CONFLICT (watchlist_id,symbol) DO NOTHING`); callers `Create` `:54`, `Update` `:176`, `AddSymbols` `:210`
  - Repo `UpdateBinding` `:247` (`UPDATE ... SET strategy_id=$3 WHERE watchlist_id=$1 AND symbol=$2 RETURNING ...`; `pgx.ErrNoRows`→`ErrBindingNotFound`); `updated_at` bump `touchWatchlistTx` `:351`
  - Watchlist row read/write: `Create` INSERT `:47-50` (`user_id,name,description`), `Update` SET `:164-166` (`name,description,updated_at`), SELECT+`scanWatchlist` `:92`/`:115`/`:380` (`watchlist_id,user_id,name,description,created_at,updated_at,system_managed`) — all get the new `default_strategy_id` column
  - Tx pattern: inline `pool.Begin`/`defer Rollback`/`Commit` per method (no shared `withTx`); canonical `Create` `:40-59`
  - Handler two-layer pattern: `PortfolioHandler.UpdateWatchlistBinding` `internal/handler/portfolio_handler.go:230` + `grpcPortfolioAdapter.UpdateWatchlistBinding` `:391` (both needed for a new RPC)
  - `WatchlistStore` interface: `internal/service/portfolio_service.go:1241-1258` (add bulk method + `fakeWatchlistStore`)
  - Last migration: **`014_positions_fees_accum`** (`services/xstockstrat-portfolio/migrations/`) → next is **`015`**
  - ADD COLUMN precedent: `migrations/008_watchlist_symbol_strategy.up.sql:7-8` (`ADD COLUMN IF NOT EXISTS strategy_id TEXT NOT NULL DEFAULT ''`); base table DDL `migrations/007_watchlists.up.sql:6-14`
- **`packages/proto`**
  - `Watchlist` message `portfolio/v1/portfolio.proto:224-238` (fields 1-9; next free **10**); `WatchlistBinding{symbol=1,strategy_id=2,source=3}` `:215-221`
  - `CreateWatchlistRequest` `:242-248` (1-4; next free **5**); `UpdateWatchlistRequest` `:269-276` (1-5; next free **6**)
  - Single-row `UpdateWatchlistBinding` RPC `:39` + req/resp `:318-326` (mirror for plural)
- **`xstockstrat-ui`** (Next.js) — `/insights` segment
  - Detail `src/components/insights/WatchlistDetail.tsx`: strategy options `useStrategyDefinitions()` → `allStrategies`/`liveStrategies` `:67-72`; add-form already applies one strategy across the whole add batch (`addStrategyId` default `UNBOUND`, `bindings: symbols.map(s=>({symbol,strategyId}))`) `:74-75,96-111,224-239`; in-pane concurrency guard `writeInFlight` `:81-85`
  - Readiness rows `src/components/insights/WatchlistReadiness.tsx`: stateless rows `:88-102`; per-row `Select`→`onRebind(symbol, toApiStrategyId(v))` `:108-114`; symbol cell `:236`/`:290`
  - Hooks `src/hooks/useWatchlists.ts`: `UNBOUND`/`toApiStrategyId` `:23-26`; `WATCHLIST_WRITE_KEY` `:13`; `useWatchlists` exposes `isFetching` `:29-39`; `useUpdateWatchlistBinding` (single-row cache-patch, no invalidate) `:116-150`; `useCreateWatchlist`/`useUpdateWatchlist` inputs `:41-78`
  - BFF `src/lib/insightsBff.ts:99-110` (`forward()` proxy, one line per RPC); browser client `src/lib/browserClients/insightsPortfolioClient.ts:8-9` (typed off proto — no change needed)
  - Page `src/app/insights/watchlists/page.tsx`: detail **remounted per watchlist via `key={selected.watchlistId}`** `:198-202` (selection state auto-resets on switch); page-level guard `anyWatchlistWriteInFlight` `:29-30`
  - e2e: stateful mock `e2e/helpers/watchlistMock.ts` (`MockWatchlist`/`MockBinding` `:17-27`, per-RPC handlers `:58-144`); spec `e2e/insights/watchlists.spec.ts`; readiness fixtures `READY1/WATCH1/QUIET1/NODATA1` `e2e/fixtures/INVENTORY.md:30,55`
- **`xstockstrat-agent`** (Python) — MCP tools
  - `app/tools.py:1415-1482` `manage_watchlist` (`operation create|update|delete`, `bindings:[{symbol,strategy_id}]`); `:1484-1522` `manage_watchlist_symbols` (`operation add|remove`, dispatch `:1512-1520`)
  - `app/client.py` wrappers: `create_watchlist:387`, `update_watchlist` (RMW GetWatchlist→UpdateWatchlist) `:410-451`, `add_watchlist_symbols:470`, `remove_watchlist_symbols:491`; requests via `_watchlist_bindings_pb(...)`
  - Doc parity: `docs/runbooks/mcp-tools.md:1065-1099` (`manage_watchlist`), `:1103-1125` (`manage_watchlist_symbols`) — asserted by tests
  - Tests: `tests/test_watchlist_tools.py` (registration/catalog/doc parity), `tests/test_watchlist_client.py` (dict→proto builders, RMW merge), `tests/conftest.py` (`TRADER`, `_ctx`)

## Patterns to REUSE

- Bulk-rebind RPC → mirror single-row `UpdateWatchlistBinding` servicer+repo (`portfolio_service.go:1496`, `watchlist_repo.go:247`); loop the selection inside **one** inline pgx tx, bump `updated_at` once via `touchWatchlistTx` `:351`.
- Ownership scoping → reuse `loadOwned` `portfolio_service.go:1352` (service-layer, repo stays ownership-agnostic by design — `watchlist_repo.go:26-28`). Directly satisfies fails.md:1147.
- Add-time default → apply at the **single** `normalizeBindings` chokepoint `portfolio_service.go:1288` so Create + Add share one code path (neutralizes fails.md:37/056 dual-path divergence). Effective default = create-request value (Create) or persisted `default_strategy_id` from the `loadOwned`-loaded row (Add).
- New watchlist column → mirror migration `008` ADD COLUMN `TEXT NOT NULL DEFAULT ''`.
- UI bulk hook → build on `useInvalidatingMutation` (`WATCHLIST_WRITE_KEY`) or the cache-patch style of `useUpdateWatchlistBinding` (`useWatchlists.ts:116-150`) to preserve the "no full-list invalidate" guarantee (@AC-6 feature-167).
- UI default-strategy control → reuse the existing `addStrategyId` Select pattern (`WatchlistDetail.tsx:224-239`) + `useStrategyDefinitions`.
- UI selection reset → **free**: the `key={watchlistId}` remount (`page.tsx:198`) resets any in-detail selection state (closes fails.md:1372).
- Agent default-strategy → thread through `manage_watchlist` create/update + the `update_watchlist` RMW merge set (`client.py:410`); agent bulk-assign → new `operation` verb on `manage_watchlist_symbols` dispatch (`tools.py:1512`).
- e2e → extend `watchlistMock.ts` handlers + `MockWatchlist` type; reuse readiness fixtures; agent tool tests assert doc parity (`mcp-tools.md`).
- Fixtures: portfolio has **no** `internal/testdata/` — watchlist test data is inline in `watchlist_service_test.go` (C-13 "lazy" — stay inline unless a 2nd consumer appears). UI reuses `e2e/fixtures` (C-12). Agent reuses `tests/conftest.py`.

## Existing Business Rules (preserve / extend)

- **EXTEND** `@AC-1 @feature-167` "Rebind one symbol via targeted single-row RPC" (`services/xstockstrat-portfolio/acceptance/watchlist-single-strategy-update.feature`) — new plural `UpdateWatchlistBindings` added alongside; single-row RPC unaltered; bulk mirrors its "no full-list replace" atomicity.
- **PRESERVE** `@AC-2 @feature-167` "Rebind preserves per-binding source on a system-managed list" (same suite) — bulk assign AND add-time default binding must preserve each entry's `source` and list `system_managed`.
- **PRESERVE** `@AC-3 @feature-167` "Rebinding an absent symbol is rejected, not inserted" (same suite) — bulk assign to an absent symbol → `NOT_FOUND`, no insert.
- **PRESERVE** `@AC-4 @feature-167` "A non-owner cannot rebind another user's watchlist" (same suite) — bulk RPC + default binding stay `x-user-id`-owner-gated.
- **PRESERVE** `@AC-5 @feature-167` "Empty strategy_id unbinds only that row" (same suite) — bulk empty `strategy_id` = per-row unbind, others untouched.
- **PRESERVE** `@AC-6 @feature-127` "EnsureSignalWatchlist idempotent, one system-managed list/user" (`services/xstockstrat-portfolio/acceptance/consolidate-watchlist-signal.feature`) — adding `default_strategy_id` must not break single-system-managed idempotency.
- **PRESERVE** `@AC-1/@AC-2 @feature-154` "Distinct cross-user union / enumeration authz" (`services/xstockstrat-portfolio/acceptance/fundsignal-watchlist-universe.feature`) — new column + bulk writes must not break `ListAllWatchlistSymbols` `SELECT DISTINCT symbol`, nor weaken the internal-caller gate.
- **EXTEND** `@AC-6 @feature-167` (UI) "UI patches only the changed row, no whole-list invalidation" (`services/xstockstrat-ui/acceptance/watchlist-single-strategy-update.feature`) — bulk remove/assign patches multiple rows but must still avoid invalidating `['watchlists']`.
- **PRESERVE** `@AC-8 @feature-127` (UI) "SIGNAL entries render a provenance badge, MANUAL none" (`services/xstockstrat-ui/acceptance/consolidate-watchlist-signal.feature`) — multi-select row rework must not regress badges.
- **PRESERVE** `@AC-1..6,@AC-13 @feature-155` (UI) "Readiness firing/watching cues + jump-to-detail" (`services/xstockstrat-ui/acceptance/watchlist-opportunity-signal-cues.feature`) — checkbox column mounts on these rows; must not regress cues/jump.
- **PRESERVE** `@AC-7 @feature-127` (platform) "System-managed list: delete refused; add/remove-symbol stay enabled" (`docs/sdd/business-rules/platform.feature`) — UI bulk-remove must stay available on system-managed lists and add no delete affordance.
- **PRESERVE** `@AC-2 @feature-148` (agent) "get_watchlist returns bindings incl. strategy_id" (`services/xstockstrat-agent/acceptance/mcp-watchlist-tools.feature`) — new watchlist-level `default_strategy_id` is additive; with "no read-time fallback" it must NOT synthesize per-symbol bindings in `get_watchlist`.
- **EXTEND** `@AC-4/@AC-5 @feature-148` (agent) "manage_watchlist create / RMW-merge update never wipes symbols" (same suite) — `default_strategy_id` must join the create inputs AND the RMW-preserved field set, or a name-only edit silently drops it.
- **PRESERVE** `@AC-7 @feature-148` (agent) "manage_watchlist_symbols add stamps MANUAL source" (same suite) — bare adds keep `MANUAL`; default only fills `strategy_id`, never changes source.
- **EXTEND** `@AC-9 @feature-148` (agent) "unknown verb rejected before any RPC" (same suite) — a new bulk-assign verb grows the allowed set; `"replace"`/unknown verbs must still reject.
- **CHANGE**: none intended. Any pivot to retroactive rebind or read-time fallback would flip a PRESERVE row to CHANGE and require sign-off.

## Dependencies

- Proto/RPC: additive `Watchlist.default_strategy_id=10`, `CreateWatchlistRequest.default_strategy_id=5`, `UpdateWatchlistRequest.default_strategy_id=6`; new RPC `UpdateWatchlistBindings` + `UpdateWatchlistBindingsRequest{watchlist_id, repeated string symbols, string strategy_id}` / `UpdateWatchlistBindingsResponse{repeated WatchlistBinding bindings, google.protobuf.Timestamp updated_at}`. All additive → `buf breaking` stays green.
- Migration: next number **`015`** for `services/xstockstrat-portfolio/migrations/` (ADD COLUMN `default_strategy_id TEXT NOT NULL DEFAULT ''`, paired down drops it).
- Config keys: none (default strategy is per-watchlist data, not a config key).
- Inter-service edges: unchanged (UI/agent → portfolio gRPC). Strategy remains a bare string — no cross-service FK/validation to analysis.
- New env vars / ports: none.

## Risks / Not-found

- **DESIGN FORK (C-16, from scenario-recon):** the system-managed signals watchlist auto-adds bare symbols with `source=SIGNAL` (`platform.feature @AC-1 @feature-127`). If a user sets `default_strategy_id` on that list, a signal-added bare symbol would inherit the default at the shared `normalizeBindings` chokepoint (source preserved). This is EXTEND (source stays SIGNAL, only `strategy_id` filled) vs CHANGE — **must be decided at the grilling gate** and recorded. Options: (A) default applies to all bare adds regardless of source; (B) default applies to MANUAL adds only (source-aware chokepoint).
- **OPEN FORK (from product-spec):** agent bulk-assign surface = new `operation` verb on `manage_watchlist_symbols` vs a dedicated tool. Leaning: new verb (avoids MCP tool-count churn across the six inventory surfaces; @AC-9 EXTEND).
- Portfolio has **no** `watchlist_repo_test.go` and **no** `internal/testdata/` — repo SQL is exercised via service-layer `fakeWatchlistStore`; bulk-op tests mirror `watchlist_service_test.go` cases (`_AbsentSymbolNotFound` :713, `_NonOwnerDenied` :732, `_EmptyStrategyUnbinds` :751).
- Agent has **no** single-row `update_watchlist_binding` client wrapper today — the bulk path needs a new `_pb` request builder in `client.py`.
- fails.md traps already **structurally closed** by existing code: selection reset (`key` remount, page.tsx:198), `isFetching` exposure (useWatchlists.ts:29). Bulk UI must still honor both concurrency guards (`writeInFlight` + `anyWatchlistWriteInFlight`).

## Recommended Scope

Advisory step boundaries (input to grilling / `/sdd-spec`):
1. **proto** — additive fields + `UpdateWatchlistBindings` RPC/messages; `buf gen` + `buf breaking`.
2. **migration 015** — `portfolio.watchlists.default_strategy_id` (up+down).
3. **portfolio service+repo** — `default_strategy_id` read/write on watchlist row; add-time default in `normalizeBindings`; bulk `UpdateWatchlistBindings` servicer+repo+handler+`WatchlistStore` iface; + paired Go tests (mirror `watchlist_service_test.go`).
4. **UI** — multi-select checkbox column + bulk action bar (remove, assign) on WatchlistDetail/WatchlistReadiness; default-strategy Select; `useUpdateWatchlistBindings` hook + `default_strategy_id` on create/update; BFF proxy; + Playwright specs & `watchlistMock` extension.
5. **agent** — `default_strategy_id` on `manage_watchlist` create/update + RMW merge; bulk-assign verb on `manage_watchlist_symbols`; `client.py` builders; `mcp-tools.md` parity; + agent tests.
