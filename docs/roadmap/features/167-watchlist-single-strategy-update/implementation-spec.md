# Implementation Spec: watchlist-single-strategy-update

**Status**: `pending`
**Created**: 2026-08-31
**Feature**: `docs/roadmap/features/167-watchlist-single-strategy-update/feature.md`
**Total Steps**: 6
**Feature Branch**: `feature/watchlist-single-strategy-update`

---

## Execution Summary

The change is a thin additive vertical slice mirroring the existing watchlist-write shape end to end.
Order: (1) append the additive `UpdateWatchlistBinding` RPC + its two messages to the portfolio proto,
then (2) regenerate stubs; (3) implement the whole Go backend slice — the single-row `UPDATE ...
RETURNING` repo method + `ErrBindingNotFound` sentinel + `WatchlistStore` interface method + service
method (reusing `loadOwned` authz + `touchWatchlistTx` for the response `updated_at`) + both handler
adapters — paired with (4) the Go service test covering AC-1…AC-5 through the in-memory fake store;
then the UI consumer surface (C-14) — (5) the non-invalidating cache-patch `useUpdateWatchlistBinding`
hook + `setBinding` rewire + `writeInFlight` fix + one-line BFF `forward`, paired with (6) the
Playwright e2e covering AC-6 (single request, no `['watchlists']` refetch).

The Go backend is intentionally one `service` step (not a separate repo step): the `WatchlistStore`
interface, its **only** production implementer (`WatchlistRepo`), and the handler adapters are tightly
coupled, and the in-memory `fakeWatchlistStore` is the **only** unit-test seam (there is no DB-backed
repo test harness in this service — precedent: feature 154's `service/`-excluded-package note,
`internal/service/watchlist_service_test.go:20-21`). The real SQL is proven at integration/deploy, not
in the execute loop.

**No DB migration** — `portfolio.watchlist_symbols` already has PK `(watchlist_id, symbol)`
(`007_watchlists.up.sql:20`) and the `strategy_id` column (`008_watchlist_symbol_strategy.up.sql`), so
the single-row `UPDATE ... WHERE` is directly addressable (product-spec § Database Changes).

### Scenario Coverage (Constitution C-15)

| Scenario | Covered by |
|---|---|
| `@AC-1` rebind one symbol via targeted single-row RPC | Step 4 (test) |
| `@AC-2` rebind preserves per-binding `source` on a system-managed list | Step 4 (test) |
| `@AC-3` rebinding an absent symbol → `NOT_FOUND` | Step 4 (test) |
| `@AC-4` non-owner → `NOT_FOUND`/`PERMISSION_DENIED` | Step 4 (test) |
| `@AC-5` empty `strategy_id` unbinds only that row | Step 4 (test) |
| `@AC-6` UI patches only the changed row, no `listWatchlists` refetch | Step 6 (e2e) |

### Consumer Surface Coverage (Constitution C-14)

- **UI** `/insights` `watchlists` (per-symbol strategy control) → Steps 5 + 6. Already nav-reachable
  via `PLATFORM_SUBNAV` (feature 058/045); no new page/route, so no new C-10(a) nav registration.
- **Agent** — explicitly **not** a deferred surface (product-spec § Consumer Surface(s)): the MCP
  `manage_watchlist` merge path (feature 148) already provides agent-side single-symbol rebind, so
  there is no missing agent capability and no `mcp-tools.md` parity gap. No `xstockstrat-agent` step.

## Step Dependencies

- Step 2 (proto-gen) requires Step 1 (proto): stubs regenerate from the edited `.proto`.
- Step 3 (Go backend) requires Step 2: the service/handler reference the generated
  `UpdateWatchlistBindingRequest`/`Response` types and the browser client auto-exposes the RPC only
  after regeneration.
- Step 4 (Go test) covers Step 3 (`service`) — placed immediately after; the fake `UpdateBinding`
  models the repo's Postgres semantics that Step 3's real SQL implements.
- Step 5 (UI) requires Step 2 (regenerated TS stub carries `updateWatchlistBinding` on the client) and
  Step 3 (a live backend method for the BFF `forward` to reach at runtime; the e2e mocks it).
- Step 6 (UI e2e) covers Step 5.

---

### Step 1 — proto: additive `UpdateWatchlistBinding` RPC + request/response messages

**Status**: `done`
**Service**: `packages/proto`
**Files**:
- `packages/proto/portfolio/v1/portfolio.proto` — modify

**Reviewers**: Proto Reviewer — field number uniqueness per message, no breaking changes, `buf lint`/`buf breaking` pass; xstockstrat-portfolio owner — concurrent write safety; xstockstrat-ui owner — Connect-RPC call safety

**Codebase Evidence**:
- `service PortfolioService` block is `portfolio.proto:10-36`; the last watchlist RPC is
  `rpc ListAllWatchlistSymbols(ListAllWatchlistSymbolsRequest) returns (ListAllWatchlistSymbolsResponse);`
  at `:35` — the new RPC line appends immediately after it, inside the block.
- `WatchlistBinding { string symbol = 1; string strategy_id = 2; WatchlistEntrySource source = 3; }`
  at `portfolio.proto:211-217` — the response embeds this existing message unchanged.
- Existing request/response messages end at `ListAllWatchlistSymbolsResponse` (`:308-311`); the two new
  messages append after it. Field numbers are **per-message** and start at 1 — no collision with any
  other message.
- `import "google/protobuf/timestamp.proto";` already present (`:7`), so `google.protobuf.Timestamp` is
  in scope for the response `updated_at`.
- Sibling request messages omit `user_id` by design (ownership from `x-user-id` header) — see the
  block comment `portfolio.proto:236-237` and `EnsureSignalWatchlistRequest` (`:300-301`).

**TDD**: `N/A (proto)` — non-code-bearing schema change; behavior is verified by the Go/e2e test steps.

**Covers**: `—`

**Instructions**:
1. Inside the `PortfolioService` block, append after line 35 (after `ListAllWatchlistSymbols`), with a
   doc comment matching the block's style:
   ```proto
   // Targeted single-symbol rebind (feature 167): change one binding's strategy_id via a single-row
   // UPDATE — no replace-all. Ownership from the propagated x-user-id header (server-side), never
   // from the request body. NOT_FOUND if the symbol is not in the watchlist.
   rpc UpdateWatchlistBinding(UpdateWatchlistBindingRequest) returns (UpdateWatchlistBindingResponse);
   ```
2. After `ListAllWatchlistSymbolsResponse` (after `:311`), append the two new messages:
   ```proto
   // user_id intentionally absent — ownership from the x-user-id header (feature 167).
   message UpdateWatchlistBindingRequest {
     string watchlist_id = 1;
     string symbol = 2;
     string strategy_id = 3;  // "" = unbind this one row (matches WatchlistBinding.strategy_id)
   }
   message UpdateWatchlistBindingResponse {
     WatchlistBinding binding = 1;                 // the updated binding (symbol/strategy_id/source)
     google.protobuf.Timestamp updated_at = 2;     // list-level watchlists.updated_at, bumped in-tx
   }
   ```
3. `strategy_id` stays a `string` (open, runtime-registered strategy ids — not a closed proto enum),
   consistent with `WatchlistBinding.strategy_id` (C-04 honored: strategy ids are not a closed set).

**Verification**:
```bash
buf lint packages/proto/
cd packages/proto && buf breaking . --against "../../.git#branch=main-dev,subdir=packages/proto"
```
Both pass — the change is additive (new RPC + new messages only; no field removal, renumber, or
retype), so `buf breaking` reports no breaking changes (C-09).

---

### Step 2 — proto-gen: regenerate Go/Python/TS stubs

**Status**: `done`
**Service**: `packages/proto`
**Files**:
- `packages/proto/gen/go/portfolio/v1/**` — modify (generated; do not hand-edit)
- `packages/proto/gen/python/portfolio/v1/**` — modify (generated)
- `packages/proto/gen/ts/portfolio/v1/**` — modify (generated)

**Reviewers**: Proto Reviewer — field number uniqueness per message, no breaking changes, `buf lint`/`buf breaking` pass; xstockstrat-portfolio owner — concurrent write safety; xstockstrat-ui owner — Connect-RPC call safety
(Inherited from Step 1 — the immediately preceding `proto` step.)

**Codebase Evidence**:
- `scripts/buf-gen.sh` is the canonical codegen entrypoint (root CLAUDE.md § Generating Proto Stubs);
  CI's `proto-freshness` job runs `bash ./scripts/buf-gen.sh` then fails on a non-empty
  `git diff packages/proto/gen/` (`.github/workflows/ci.yml:178-183`).
- Generated portfolio stubs live under `packages/proto/gen/{go,python,ts}/portfolio/v1/` (root CLAUDE.md
  § Key File Paths Reference). The TS `PortfolioService` client method `updateWatchlistBinding` is
  auto-generated here and is what `insightsPortfolioClient` (Step 5) auto-exposes.

**TDD**: `N/A (proto-gen)` — generated output; correctness is the empty-diff check below.

**Covers**: `—`

**Instructions**:
1. From repo root, run `./scripts/buf-gen.sh` (generates TS, Python, Go stubs and compiles the TS
   package — root CLAUDE.md).
2. Stage the **generated** files together with the proto change (commit proto source + generated stubs
   in the same commit, per `docs/runbooks/proto-versioning.md`). Do not hand-edit anything under
   `gen/`.

**Verification**:
```bash
./scripts/buf-gen.sh
git diff --exit-code packages/proto/gen/
```
Re-running codegen leaves an empty `gen/` diff (the `proto-freshness` gate). Confirm the new symbols
exist: `grep -rn "UpdateWatchlistBinding" packages/proto/gen/go/portfolio/v1/ | head` returns matches.

---

### Step 3 — service: single-row rebind repo method, `ErrBindingNotFound`, `WatchlistStore` method, service method + handler adapters

**Status**: `pending`
**Service**: `xstockstrat-portfolio`
**Files**:
- `services/xstockstrat-portfolio/internal/repository/watchlist_repo.go` — modify (add `ErrBindingNotFound`, `UpdateBinding`; extend `touchWatchlistTx` to return the timestamp)
- `services/xstockstrat-portfolio/internal/service/portfolio_service.go` — modify (add `UpdateBinding` to `WatchlistStore` interface; add `UpdateWatchlistBinding` service method)
- `services/xstockstrat-portfolio/internal/handler/portfolio_handler.go` — modify (Connect handler + gRPC adapter)

**Reviewers**: xstockstrat-portfolio owner — concurrent write safety, position snapshot consistency

**Codebase Evidence**:
- `ErrWatchlistNotFound = errors.New("watchlist not found")` at `watchlist_repo.go:17` — the sibling
  sentinel `ErrBindingNotFound` is modeled on; recon confirmed **no** binding-level sentinel exists yet
  (`recon.md:160-162`, design F-04 names it a to-create symbol).
- `touchWatchlistTx(ctx, tx, watchlistID) error` at `watchlist_repo.go:305-315` uses `tx.Exec` +
  `RowsAffected()==0 → ErrWatchlistNotFound`; its two callers are `AddSymbols` (`:204`) and
  `RemoveSymbols` (`:224`), both `if err := touchWatchlistTx(...); err != nil`.
- `listBindings` (`watchlist_repo.go:268-291`) shows the exact column read shape:
  `SELECT symbol, strategy_id, source FROM portfolio.watchlist_symbols` and
  `Source: portfoliov1.WatchlistEntrySource(source)` scanning `source` as `int16`.
- `pgx` is imported (`watchlist_repo.go:9`) — `pgx.ErrNoRows` is available; `time` is imported (`:7`).
- `WatchlistStore` interface at `portfolio_service.go:1215-1228` (its methods: `Update`, `AddSymbols`,
  `RemoveSymbols`, …). `s.watchlists` is typed `WatchlistStore` (`portfolio_service.go:47`).
- `UpdateWatchlist` service method (`portfolio_service.go:1439-1463`) is the shape to mirror:
  `requireUserID` → `loadOwned(ctx, userID, watchlistID)` → repo call → `s.emitEvent(ctx,
  "portfolio.watchlist.updated", "watchlist:"+id, {...})` → return.
- `loadOwned` (`portfolio_service.go:1322-1337`) yields `CodeNotFound` (absent) / `CodePermissionDenied`
  (wrong owner) — reused unchanged for AC-3(watchlist-absent)/AC-4.
- `normalizeSymbols` (`portfolio_service.go:1238-1253`) uppercases+trims stored symbols; the request
  symbol must be normalized the same way before the `WHERE symbol = $2` match (design Open Risk 4).
- `portfolio_service.go` already imports `errors`, `strings`, `time`, `connect`, `timestamppb`,
  `middleware`, `repository` (`:6,:10,:12,:14,:23,:32,:33`) — no new imports for the service method.
- Handler pattern: Connect handler `PortfolioHandler.UpdateWatchlist` (`portfolio_handler.go:190-196`)
  and its gRPC adapter `grpcPortfolioAdapter.UpdateWatchlist` (`:343-349`), the latter wrapping errors
  with `toGRPCError` (`:344-348`). Both are appended-to; the adapter struct is `grpcPortfolioAdapter`
  (`:236-239`).

**TDD**: `red-green required` — paired with Step 4.

**Covers**: `—`

**Instructions**:
1. **`watchlist_repo.go`** — add the sentinel next to `ErrWatchlistNotFound` (`:17`):
   ```go
   // ErrBindingNotFound is returned when the (watchlist_id, symbol) row does not exist.
   var ErrBindingNotFound = errors.New("watchlist binding not found")
   ```
2. **`watchlist_repo.go`** — extend `touchWatchlistTx` to return the bumped timestamp (so `UpdateBinding`
   can source the response `updated_at` from `watchlists.updated_at`, reusing the one touch helper —
   design Chosen Approach + resolved decision in context.md 2026-08-31):
   ```go
   func touchWatchlistTx(ctx context.Context, tx pgx.Tx, watchlistID string) (time.Time, error) {
       var updatedAt time.Time
       err := tx.QueryRow(ctx,
           `UPDATE portfolio.watchlists SET updated_at = now() WHERE watchlist_id = $1 RETURNING updated_at`,
           watchlistID).Scan(&updatedAt)
       if errors.Is(err, pgx.ErrNoRows) {
           return time.Time{}, ErrWatchlistNotFound
       }
       if err != nil {
           return time.Time{}, fmt.Errorf("touch watchlist: %w", err)
       }
       return updatedAt, nil
   }
   ```
   Update the two existing callers to discard the timestamp: `AddSymbols` (`:204`) and `RemoveSymbols`
   (`:224`) become `if _, err := touchWatchlistTx(ctx, tx, watchlistID); err != nil {`.
   (Deviation option if preferred at execute time: leave `touchWatchlistTx` unchanged and inline the
   `RETURNING updated_at` bump inside `UpdateBinding` — record it in the Deviation Log. The reuse form
   above is the design's stated intent and keeps a single touch helper (DRY).)
3. **`watchlist_repo.go`** — add the single-row rebind in one tx:
   ```go
   // UpdateBinding rebinds one symbol's strategy_id in a single row (feature 167). It writes ONLY
   // strategy_id; RETURNING source reads the untouched provenance back (fails-080 reset trap is
   // structurally impossible here). Empty result (no such symbol) → ErrBindingNotFound. Then bumps the
   // parent watchlists.updated_at and returns that list-level timestamp for the response.
   func (r *WatchlistRepo) UpdateBinding(ctx context.Context, watchlistID, symbol, strategyID string) (*portfoliov1.WatchlistBinding, time.Time, error) {
       tx, err := r.pool.Begin(ctx)
       if err != nil {
           return nil, time.Time{}, fmt.Errorf("begin: %w", err)
       }
       defer func() { _ = tx.Rollback(ctx) }()

       var (
           sym, strat string
           source     int16
       )
       err = tx.QueryRow(ctx,
           `UPDATE portfolio.watchlist_symbols SET strategy_id = $3
            WHERE watchlist_id = $1 AND symbol = $2
            RETURNING symbol, strategy_id, source`,
           watchlistID, symbol, strategyID).Scan(&sym, &strat, &source)
       if errors.Is(err, pgx.ErrNoRows) {
           return nil, time.Time{}, ErrBindingNotFound
       }
       if err != nil {
           return nil, time.Time{}, fmt.Errorf("update binding: %w", err)
       }
       updatedAt, err := touchWatchlistTx(ctx, tx, watchlistID)
       if err != nil {
           return nil, time.Time{}, err
       }
       if err := tx.Commit(ctx); err != nil {
           return nil, time.Time{}, fmt.Errorf("commit: %w", err)
       }
       return &portfoliov1.WatchlistBinding{
           Symbol:     sym,
           StrategyId: strat,
           Source:     portfoliov1.WatchlistEntrySource(source),
       }, updatedAt, nil
   }
   ```
   Note: Postgres counts a row matched by the `WHERE` clause regardless of whether `strategy_id`'s value
   actually changes, so a no-op `""`-unbind of an already-unbound row still returns the row (AC-5), and
   an empty `RETURNING` reliably means "no such symbol" (AC-3) — not "unchanged value".
4. **`portfolio_service.go`** — add to the `WatchlistStore` interface (after `RemoveSymbols`, `:1222`):
   ```go
   UpdateBinding(ctx context.Context, watchlistID, symbol, strategyID string) (*portfoliov1.WatchlistBinding, time.Time, error)
   ```
5. **`portfolio_service.go`** — add the service method, mirroring `UpdateWatchlist` (`:1439-1463`):
   ```go
   // UpdateWatchlistBinding rebinds one symbol's strategy without a replace-all (feature 167, FR-1).
   func (s *PortfolioService) UpdateWatchlistBinding(ctx context.Context, req *portfoliov1.UpdateWatchlistBindingRequest) (*portfoliov1.UpdateWatchlistBindingResponse, error) {
       userID, err := requireUserID(ctx)
       if err != nil {
           return nil, err
       }
       // Ownership: loadOwned yields NotFound(absent list)/PermissionDenied(wrong owner) — AC-4.
       if _, err := s.loadOwned(ctx, userID, req.GetWatchlistId()); err != nil {
           return nil, err
       }
       // Normalize the request symbol to match stored (uppercased/trimmed) rows — design Open Risk 4.
       symbol := strings.ToUpper(strings.TrimSpace(req.GetSymbol()))
       if symbol == "" {
           return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("symbol required"))
       }
       // strategy_id == "" passes through as a valid unbind (FR-4/AC-5).
       binding, updatedAt, err := s.watchlists.UpdateBinding(ctx, req.GetWatchlistId(), symbol, strings.TrimSpace(req.GetStrategyId()))
       if err != nil {
           if errors.Is(err, repository.ErrBindingNotFound) {
               return nil, connect.NewError(connect.CodeNotFound, errors.New("symbol not in watchlist")) // AC-3
           }
           return nil, connect.NewError(connect.CodeInternal, err)
       }
       s.emitEvent(ctx, "portfolio.watchlist.updated", "watchlist:"+req.GetWatchlistId(), map[string]interface{}{
           "user_id": userID, "watchlist_id": req.GetWatchlistId(), "symbol": symbol,
       })
       return &portfoliov1.UpdateWatchlistBindingResponse{
           Binding:   binding,
           UpdatedAt: timestamppb.New(updatedAt),
       }, nil
   }
   ```
6. **`portfolio_handler.go`** — append the Connect handler after `RemoveWatchlistSymbols` (`:222-228`):
   ```go
   func (h *PortfolioHandler) UpdateWatchlistBinding(ctx context.Context, req *connect.Request[portfoliov1.UpdateWatchlistBindingRequest]) (*connect.Response[portfoliov1.UpdateWatchlistBindingResponse], error) {
       resp, err := h.svc.UpdateWatchlistBinding(ctx, req.Msg)
       if err != nil {
           return nil, err
       }
       return connect.NewResponse(resp), nil
   }
   ```
7. **`portfolio_handler.go`** — append the gRPC adapter after `RemoveWatchlistSymbols` (`:375-381`),
   using `toGRPCError` like its siblings:
   ```go
   func (a *grpcPortfolioAdapter) UpdateWatchlistBinding(ctx context.Context, req *portfoliov1.UpdateWatchlistBindingRequest) (*portfoliov1.UpdateWatchlistBindingResponse, error) {
       resp, err := a.h.UpdateWatchlistBinding(ctx, connect.NewRequest(req))
       if err != nil {
           return nil, toGRPCError(err)
       }
       return resp.Msg, nil
   }
   ```
8. **Header propagation (C-03):** this method makes **no new outbound per-request gRPC call** to another
   backend — it calls the repo (DB) and the existing `s.emitEvent` ledger path shared by every sibling
   watchlist RPC. No new propagating client/interceptor is introduced, so no header-propagation wiring
   is added.

**Verification** (paired with Step 4 — the lint/coverage command lives in Step 4):
```bash
cd services/xstockstrat-portfolio && GOWORK=off go build ./...
```
Compiles clean (the interface, its `WatchlistRepo` implementation, the fake in Step 4, the service
method, and both handler adapters are all in lockstep).

---

### Step 4 — test: Go service tests for `UpdateWatchlistBinding` (AC-1…AC-5)

**Status**: `pending`
**Service**: `xstockstrat-portfolio`
**Files**:
- `services/xstockstrat-portfolio/internal/service/watchlist_service_test.go` — modify (add `fakeWatchlistStore.UpdateBinding`; add test cases)

**Reviewers**: xstockstrat-portfolio owner — concurrent write safety, position snapshot consistency

**Codebase Evidence**:
- `fakeWatchlistStore` (`watchlist_service_test.go:26-33`) is the in-memory `WatchlistStore`; it must
  gain `UpdateBinding` to keep satisfying the interface after Step 3. Sibling fake methods: `Update`
  (`:93-101`), `AddSymbols` (`:111-129`) — they store into `wl.Bindings` and return `clone(wl)`.
- `newSvc(store, cfg, ledger)` builds `&PortfolioService{watchlists: store, wlCfg: cfg, ledger: ledger}`
  (`watchlist_service_test.go:204`); callers pass `newFakeStore()`, `wideCaps()`, `&fakeLedger{}`
  (`:315`, `:362`, `:370`).
- Existing authz/guard test precedents to mirror: `TestListAllWatchlistSymbols_FailClosed` (`:260`),
  `TestDeleteWatchlist_SystemManagedGuard` (`:584`), `TestEnsureSignalWatchlist_Idempotent` (`:545`).
- The service package is CI-**excluded** from coverage measurement (`service/` — see the package note
  `watchlist_service_test.go:20-21`); these unit tests plus the Step 6 e2e are the behavioral
  verification. `"time"` is **not** yet imported by this test file — add it for the fake's `time.Time`.
- How the fake must model Postgres `WHERE`-match semantics: a matched symbol returns the (possibly
  value-unchanged) row; an unmatched symbol returns `ErrBindingNotFound`; `source` is never rewritten.

**TDD**: `red-green required` — write the assertions first; they fail against the pre-Step-3 tree
(no `UpdateWatchlistBinding` method / no `UpdateBinding` on the interface), pass after.

**Covers**: `AC-1, AC-2, AC-3, AC-4, AC-5`

**Instructions**:
1. Add `"time"` to the import block. Add the fake method modeling the repo's semantics:
   ```go
   func (f *fakeWatchlistStore) UpdateBinding(_ context.Context, watchlistID, symbol, strategyID string) (*portfoliov1.WatchlistBinding, time.Time, error) {
       wl, ok := f.byID[watchlistID]
       if !ok {
           return nil, time.Time{}, repository.ErrWatchlistNotFound // defensive; loadOwned already guarded
       }
       for _, b := range wl.Bindings {
           if b.GetSymbol() == symbol { // WHERE-match: matched regardless of value change
               b.StrategyId = strategyID // single-column update; Source untouched (models RETURNING source)
               return &portfoliov1.WatchlistBinding{Symbol: b.GetSymbol(), StrategyId: strategyID, Source: b.GetSource()}, time.Now(), nil
           }
       }
       return nil, time.Time{}, repository.ErrBindingNotFound // AC-3
   }
   ```
2. Add test cases (use the existing `newSvc` + `ctxWithUser`/metadata helpers already used by the
   sibling tests; seed a list via the fake's `Create` or by populating `store.byID` with a
   `*portfoliov1.Watchlist` carrying bindings + `Source`):
   - **AC-1** `TestUpdateWatchlistBinding_RebindsOneSymbol`: seed `wl-1`(owner `u-1`) with AAPL→`sma_cross`,
     MSFT→`macd`, TSLA→`rsi`; call `UpdateWatchlistBinding{watchlist_id:"wl-1", symbol:"MSFT",
     strategy_id:"fundamentals_macd_blend"}` as `u-1`; assert resp `binding.StrategyId ==
     "fundamentals_macd_blend"` and `binding.Symbol == "MSFT"`, and that AAPL/TSLA bindings in the store
     are unchanged (their `strategy_id` intact — no full-list replace).
   - **AC-2** `TestUpdateWatchlistBinding_PreservesSourceOnSystemManaged`: seed a `SystemManaged:true`
     `wl-1` whose NVDA binding has `strategy_id:"macd"`, `Source: WATCHLIST_ENTRY_SOURCE_SIGNAL`; rebind
     NVDA→`sma_cross`; assert resp `binding.Source == WATCHLIST_ENTRY_SOURCE_SIGNAL` and the stored
     `wl.SystemManaged` is still `true`.
   - **AC-3** `TestUpdateWatchlistBinding_AbsentSymbolNotFound`: seed `wl-1` with no GOOG binding; rebind
     GOOG→`macd`; assert `connect.CodeOf(err) == connect.CodeNotFound` and no GOOG binding was created.
   - **AC-4** `TestUpdateWatchlistBinding_NonOwnerDenied`: seed `wl-1` owned by `u-1`; call as `u-2`
     (metadata `x-user-id: u-2`); assert `connect.CodeOf(err)` is `CodeNotFound` **or**
     `CodePermissionDenied` (loadOwned → `PermissionDenied` for a wrong owner) and AAPL binding unchanged.
   - **AC-5** `TestUpdateWatchlistBinding_EmptyStrategyUnbinds`: seed `wl-1` with AAPL→`sma_cross`,
     MSFT→`macd`; rebind AAPL→`""`; assert resp `binding.StrategyId == ""` (no error) and MSFT still
     `macd`.
3. Do not introduce a second inline copy of any watchlist domain literal — a single inline seed per test
   is C-13-compliant (one consumer; no canonical Go `internal/testdata/` home exists for this service and
   none should be created speculatively).

**Verification**:
```bash
cd services/xstockstrat-portfolio && GOWORK=off go test ./internal/service/... -run TestUpdateWatchlistBinding -race -count=1
cd services/xstockstrat-portfolio && GOWORK=off golangci-lint run --modules-download-mode=mod
```
All `TestUpdateWatchlistBinding_*` pass; lint clean. New logic is in the CI-excluded `service/`
package, so no coverage-threshold command applies (this test step plus the Step 6 e2e are the
behavioral verification — precedent `watchlist_service_test.go:20-21`).

---

### Step 5 — service: UI non-invalidating cache-patch hook, `setBinding` rewire, `writeInFlight` fix, BFF forward

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/hooks/useWatchlists.ts` — modify (add `useUpdateWatchlistBinding`)
- `services/xstockstrat-ui/src/components/insights/WatchlistDetail.tsx` — modify (use the hook in `setBinding`; add its `isPending` to `writeInFlight`)
- `services/xstockstrat-ui/src/lib/insightsBff.ts` — modify (one-line `forward`)
- `services/xstockstrat-ui/src/lib/browserClients/insightsPortfolioClient.ts` — **no edit** (auto-exposes the RPC after Step 2)

**Reviewers**: xstockstrat-ui owner — Connect-RPC call safety, config mutation safety, analytics display accuracy

**Codebase Evidence**:
- `useWatchlists.ts` currently imports only `useQuery` (`:1`); `WATCHLISTS_KEY = ['watchlists']` (`:7`),
  `WATCHLIST_WRITE_KEY = ['watchlist-write']` (`:13`), `WatchlistBindingInput` (`:20`). The
  invalidating hooks (`useUpdateWatchlist` `:59-78`, `useAddWatchlistSymbols` `:87-98`,
  `useRemoveWatchlistSymbols` `:100-107`) all pass `{ mutationKey: WATCHLIST_WRITE_KEY }`.
- `useInvalidatingMutation.ts:22-33` is the composition precedent (`useMutation` + `useQueryClient` +
  `onSuccess`); it **always** `invalidateQueries` (`:29-31`) — which AC-6 forbids, so the new hook is a
  plain `useMutation` that calls `queryClient.setQueryData` instead (design § Rejected Alternatives:
  "Reuse `useInvalidatingMutation` … rejected"). `setQueryData` is a standard TanStack Query call (no
  existing in-repo caller; `useMutation`/`useQueryClient` are widely used, e.g. `useFormulas.ts:1`).
- `WatchlistDetail.tsx`: `writeInFlight = addSymbols.isPending || removeSymbols.isPending ||
  updateWatchlist.isPending` (`:80-81`); `setBinding` (`:111-121`) currently rebuilds the FULL binding
  array and calls `updateWatchlist.mutate(...)`. `updateWatchlist` (`useUpdateWatchlist`) is still used
  by `commitRename` (`:125-136`), so it stays imported. `onRebindSymbol={setBinding}` wired at `:253`.
  The `Binding` type (`:35`) carries `source?: number`.
- `insightsBff.ts` `router.service(PortfolioService, {...})` block is `:87-98`; each watchlist RPC is a
  one-line `forward((req, opts) => portfolioClient.<rpc>(req, opts))` (`updateWatchlist` `:94`). The
  `forward` helper (`:20`) applies `backendHeaders` (propagates `x-user-id`/scope/trace) — so the
  UI→portfolio edge is already header-propagating (C-03); no per-call header code needed.
- Browser client `insightsPortfolioClient` is `createClient(PortfolioService, makeBrowserTransport(
  '/insights/api'))` (`insightsPortfolioClient.ts:8-9`) — auto-exposes `updateWatchlistBinding` once
  the TS stub regenerates (Step 2); no per-method edit (recon `:82-84`).
- The cache shape at `WATCHLISTS_KEY` is `ListWatchlistsResult = { watchlists: Watchlist[]; page }`
  (`useWatchlists.ts:5`); each `Watchlist` carries `bindings: WatchlistBinding[]` (proto `:230`).

**TDD**: `red-green required` — paired with the Step 6 e2e (the RED-able hook is the AC-6 request-count /
per-row assertions).

**Covers**: `—`

**Instructions**:
1. **`useWatchlists.ts`** — extend the import to `import { useQuery, useMutation, useQueryClient } from
   '@tanstack/react-query';` and add the hook:
   ```ts
   /**
    * feature 167 — targeted single-symbol rebind. A plain (non-invalidating) useMutation: on success it
    * PATCHES just the one binding in the cached ['watchlists'] list from the RPC's returned
    * WatchlistBinding (carrying source), with NO invalidateQueries → no listWatchlists refetch (AC-6).
    * Carries mutationKey WATCHLIST_WRITE_KEY so the Layer-2 useIsMutating guard still serializes it
    * against rename/remove.
    */
   export function useUpdateWatchlistBinding() {
     const queryClient = useQueryClient();
     return useMutation<
       Awaited<ReturnType<typeof insightsPortfolioClient.updateWatchlistBinding>>,
       Error,
       { watchlistId: string; symbol: string; strategyId: string }
     >({
       mutationKey: WATCHLIST_WRITE_KEY,
       mutationFn: (input) =>
         insightsPortfolioClient.updateWatchlistBinding({
           watchlistId: input.watchlistId,
           symbol: input.symbol,
           strategyId: input.strategyId,
         }),
       onSuccess: (result, input) => {
         const patched = result.binding;
         if (!patched) return;
         queryClient.setQueryData(WATCHLISTS_KEY, (old: ListWatchlistsResult | undefined) => {
           if (!old) return old;
           return {
             ...old,
             watchlists: old.watchlists.map((wl) =>
               wl.watchlistId === input.watchlistId
                 ? {
                     ...wl,
                     bindings: wl.bindings.map((b) =>
                       b.symbol === patched.symbol ? patched : b,
                     ),
                   }
                 : wl,
             ),
           };
         });
         // NO invalidateQueries(['watchlists']) — the whole point of AC-6.
       },
     });
   }
   ```
   (Adjust the `map` field access to the generated message shape — `watchlistId`/`bindings`/`symbol` are
   the Connect-JSON camelCase fields already used by `useWatchlists`/`WatchlistDetail`.)
2. **`WatchlistDetail.tsx`** — import and use the hook:
   - Add `useUpdateWatchlistBinding` to the `@/hooks/useWatchlists` import (`:22-29`).
   - Add `const updateBinding = useUpdateWatchlistBinding();` beside the other mutation hooks (`:63-65`).
   - Extend `writeInFlight` (`:80-81`) to include `|| updateBinding.isPending` (design Open Risk 2 /
     FR-5 — the Layer-1 guard must cover the rebind; keep `updateWatchlist.isPending` for the rename path).
   - Rewrite `setBinding` (`:111-121`) to the single-symbol call and update its comment:
     ```ts
     // Re-bind one symbol's strategy via the targeted single-row RPC (feature 167). Patches just this
     // entry in the ['watchlists'] cache — no replace-all, no full-list refetch. Other rows untouched.
     function setBinding(symbol: string, strategyId: string) {
       updateBinding.mutate({ watchlistId: watchlist.watchlistId, symbol, strategyId });
     }
     ```
   - Leave `WatchlistReadiness`'s `onRebindSymbol={setBinding}` wiring (`:253`) and the per-row `Select`
     unchanged — it re-evaluates readiness against the patched `strategy_id` (preserves `@AC-1`/`@AC-5`
     feature-155). No new token/primitive/hardcoded color (C-17 honored).
3. **`insightsBff.ts`** — append inside the `PortfolioService` block (after `removeWatchlistSymbols`
   `:97`):
   ```ts
   updateWatchlistBinding: forward((req, opts) => portfolioClient.updateWatchlistBinding(req, opts)),
   ```
4. **`insightsPortfolioClient.ts`** — confirm (no edit) the client auto-exposes `updateWatchlistBinding`
   after Step 2.

**Verification** (behavioral proof is the Step 6 e2e; this step's gate is compile + lint):
```bash
cd services/xstockstrat-ui && pnpm run lint
cd services/xstockstrat-ui && npx tsc --noEmit
```
Lint + typecheck clean (`tsc` proves the hook's generic and the `setQueryData` patch typecheck against
the regenerated `PortfolioService` client). No hardcoded color introduced (C-17).

---

### Step 6 — test: Playwright e2e — UI patches only the changed row, no `listWatchlists` refetch (AC-6)

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/e2e/helpers/watchlistMock.ts` — modify (add `UpdateWatchlistBinding` route)
- `services/xstockstrat-ui/e2e/insights/watchlists.spec.ts` — modify (add the AC-6 test)
- `services/xstockstrat-ui/e2e/fixtures/INVENTORY.md` — modify (note the new route on the Watchlists mock row)

**Reviewers**: xstockstrat-ui owner — Connect-RPC call safety, analytics display accuracy

**Codebase Evidence**:
- `watchlistMock.ts` is the shared **stateful** in-memory mock of the PortfolioService watchlist RPCs
  (`:1-121`); it registers `page.route('**/xstockstrat.portfolio.v1.PortfolioService/<Rpc>', …)` per RPC
  (e.g. `UpdateWatchlist` `:78-89`, `RemoveWatchlistSymbols` `:102-114`). Helpers: `find(id)` (`:54`),
  `normBindings` (`:36-45`), `json(route, body)` (`:55-56`). `MockBinding = { symbol; strategyId;
  source? }` (`:17`).
- `watchlists.spec.ts` imports `addAuthCookie` (`helpers/auth.ts`) and `mockWatchlists`
  (`helpers/watchlistMock.ts`) (`:1-3`); helper `bindStrategy(page, symbol, optionName='Live Test
  Strategy')` (`:26-31`) drives the per-row `Select` via `getByTestId('readiness-row-<SYM>')
  .getByLabel('Strategy for <SYM>')` then `getByRole('option', { name })`, and waits for the trigger to
  reflect the pick. `mockWatchlists(page, seed)` accepts a seed (`watchlistMock.ts:29`).
- Auth helpers: `addAuthCookie(page)` (`e2e/helpers/auth.ts:65-66`) — the canonical helper; specs never
  re-implement JWT signing.
- Strategy options come from the mock-backend `listStrategyDefinitions` fixture `STRATEGY_DEFINITIONS`
  (`e2e/fixtures/strategies.ts`): two live-enabled defs — `STRATEGY_DEF_LIVE` (`strat-live-001`, display
  "Live Test Strategy") and `STRATEGY_DEF_DENY` (`strat-001`, display "Deny List Strategy"). Both render
  in the per-row `Select` (`WatchlistReadiness.tsx:103-107,124-129`), so a rebind between them is a valid
  UI action.
- The per-row `Select` aria-label is `Strategy for ${symbol}` and the row testid is
  `readiness-row-${symbol}` (`WatchlistReadiness.tsx:115,234`); the trigger renders the chosen strategy's
  `displayName` (`:117-119`). `evaluateReadiness` is mocked by `mock-backend.ts` (`:686`) — a bound row is
  evaluated, so it stays visible after a rebind.
- INVENTORY row "Watchlists (stateful mock)" (`e2e/fixtures/INVENTORY.md:27`) catalogs
  `mockWatchlists`/`MockWatchlist`/`MockBinding` in `watchlistMock.ts` — update it when the mock changes
  (C-12).

**TDD**: `red-green required` — the AC-6 assertions (exactly one `UpdateWatchlistBinding` request; zero
new `ListWatchlists` after the rebind; the changed row shows the new strategy while a sampled other row
does not) fail against the pre-Step-5 tree (today `setBinding` sends `UpdateWatchlist` + invalidates,
triggering a `ListWatchlists` refetch), pass after.

**Covers**: `AC-6`

**Instructions**:
1. **`watchlistMock.ts`** — add the single-row patch route (models the server: patch only `strategy_id`,
   leave `source` untouched, return `{ binding, updated_at }`):
   ```ts
   await page.route(
     '**/xstockstrat.portfolio.v1.PortfolioService/UpdateWatchlistBinding',
     (route) => {
       const req = JSON.parse(route.request().postData() ?? '{}');
       const wl = find(req.watchlistId);
       const sym = (req.symbol ?? '').trim().toUpperCase();
       let binding: MockBinding | undefined;
       if (wl) {
         binding = wl.bindings.find((b) => b.symbol === sym);
         if (binding) {
           binding.strategyId = req.strategyId ?? ''; // single-column patch; source untouched
           sync(wl);
         }
       }
       // Happy-path e2e: the symbol exists. (A real server returns NOT_FOUND when absent.)
       return json(route, { binding, updatedAt: { seconds: '0', nanos: 0 } });
     },
   );
   ```
2. **`watchlists.spec.ts`** — add a test asserting the single-symbol patch with no full-list refetch:
   - `await addAuthCookie(page);`
   - Seed a multi-symbol list (faithful to the "200 symbols" scenario — build the array
     programmatically), with the two target symbols bound to `strat-live-001` so both render as
     evaluated rows, e.g.:
     ```ts
     const many = Array.from({ length: 198 }, (_, i) => ({ symbol: `SYM${i}`, strategyId: 'strat-live-001' }));
     await mockWatchlists(page, [{
       watchlistId: 'wl-1', userId: 'test-user-001', name: 'Big List', description: '',
       symbols: ['AAPL', 'MSFT', ...many.map((b) => b.symbol)],
       bindings: [
         { symbol: 'AAPL', strategyId: 'strat-live-001' },
         { symbol: 'MSFT', strategyId: 'strat-live-001' },
         ...many,
       ],
     }]);
     ```
     (This inline seed is a scenario one-off — C-12 exempt; the canonical mock helper is reused, not
     re-implemented.)
   - Install request counters before navigating:
     ```ts
     let listCalls = 0, bindCalls = 0;
     page.on('request', (r) => {
       if (r.url().includes('/PortfolioService/ListWatchlists')) listCalls += 1;
       if (r.url().includes('/PortfolioService/UpdateWatchlistBinding')) bindCalls += 1;
     });
     ```
   - `await page.goto('/insights/watchlists');` and wait for the MSFT row + record the post-load
     `listCalls` baseline (`const baseline = listCalls;` after the row is visible).
   - Rebind MSFT to the second live strategy via the existing pattern (reuse/inline `bindStrategy`):
     open `getByTestId('readiness-row-MSFT').getByLabel('Strategy for MSFT')`, click
     `getByRole('option', { name: 'Deny List Strategy' })`.
   - Assert:
     - `await expect(select).toContainText('Deny List Strategy')` — the MSFT row shows the new strategy.
     - `expect(bindCalls).toBe(1)` — a single `UpdateWatchlistBinding` request was sent.
     - `expect(listCalls).toBe(baseline)` — **no** `ListWatchlists` refetch after the rebind (the
       `['watchlists']` key was not invalidated).
     - A sampled other row is untouched: `getByTestId('readiness-row-AAPL').getByLabel('Strategy for
       AAPL')` still `toContainText('Live Test Strategy')`.
3. **`INVENTORY.md`** — extend the "Watchlists (stateful mock)" row (`:27`) to note the added
   `UpdateWatchlistBinding` single-row patch route (feature 167) and its consumer
   `e2e/insights/watchlists.spec.ts`.

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm test:e2e -- e2e/insights/watchlists.spec.ts
cd services/xstockstrat-ui && pnpm run lint
```
The new AC-6 test passes (single rebind request, no `ListWatchlists` refetch, one row patched, others
untouched); lint clean. Confirm mock/spec imports come from the canonical helpers:
`grep -n "from '../helpers/watchlistMock'\|helpers/auth" e2e/insights/watchlists.spec.ts` (C-12).

---

## Deviation Log

_Populated by /sdd-execute as implementation proceeds._
