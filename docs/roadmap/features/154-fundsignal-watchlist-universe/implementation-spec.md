# Implementation Spec: fundsignal-watchlist-universe

**Status**: `pending`
**Created**: 2026-08-24
**Feature**: `docs/roadmap/features/154-fundsignal-watchlist-universe/feature.md`
**Total Steps**: 7
**Feature Branch**: `feature/fundsignal-watchlist-universe`

---

## Execution Summary

The feature is a two-service coordinated change on the existing analysis→portfolio read edge
(design.md § Chosen Approach). Order: (1) the additive portfolio proto RPC, (2) codegen, (3) the
portfolio producer of the RPC (repo `DISTINCT` query + portfolio's first authz gate + service/handler
wiring), (4) its Go test, (5) the analysis consumer (`_resolve_universe` rewrite + FMP-gated
truncation + a second boot-frozen `marketdata`-namespace `ConfigWatcher`), (6) its Python test, and
(7) docs. Steps 1→2→3 are a hard chain (the service can't compile against a stub that doesn't exist);
step 5 depends on step 2's regenerated Python stub only for the new request/response classes.

**Consumer surface (C-14):** the product spec marks this **None — internal/platform-only** (the
producer is a background loop; its emitted signals already reach users through feature-062's
ingest → Opportunities/alert surfaces). No UI or Agent step is required — this is a recorded decision,
not an omission. The operator-visible effect (`universe_source=watchlists` now yields signals) is
observed through those already-shipped surfaces.

### Scenario Coverage (C-15)

| Scenario | Covered by step |
|---|---|
| AC-1 (distinct cross-user union) | Step 4 (repo `DISTINCT` + authorized enumeration) |
| AC-2 (non-privileged → PERMISSION_DENIED) | Step 4 (authz fail-closed cases) |
| AC-3 (watchlists → enumerated union) | Step 6 |
| AC-4 (both → union ∪ explicit CSV) | Step 6 |
| AC-5 (explicit ignores enumeration) | Step 6 |
| AC-6 (FMP-active → cap applies, drop logged) | Step 6 |
| AC-7 (portfolio outage → empty, cycle survives) | Step 6 |
| AC-8 (both + outage → explicit CSV) | Step 6 |
| AC-9 (non-FMP → whole union, no truncation) | Step 6 |

## Step Dependencies

- Step 2 (proto-gen) requires Step 1 (proto): codegen runs against the new `.proto`.
- Step 3 (portfolio service) requires Step 2: the Go service/handler compile against the generated
  `portfoliov1.ListAllWatchlistSymbolsRequest/Response` stubs.
- Step 4 (portfolio test) covers Step 3 (`service` pairing, C-08). Runs immediately after Step 3.
- Step 5 (analysis service) requires Step 2: `_resolve_universe` builds `portfolio_pb2.ListAllWatchlistSymbolsRequest`.
- Step 6 (analysis test) covers Step 5 (`service` pairing, C-08). Runs immediately after Step 5.
- Step 7 (docs) requires Steps 1/3/5 landed (documents the shipped RPC, authz gate, and cross-namespace read).

---

### Step 1 — proto: add `ListAllWatchlistSymbols` RPC to PortfolioService

**Status**: `pending`
**Service**: `packages/proto`
**Files**:
- `packages/proto/portfolio/v1/portfolio.proto` — modify

**Reviewers**: Proto Reviewer — field number uniqueness, no breaking change without deprecation, `buf lint`/`buf breaking` pass; `xstockstrat-portfolio` owner — correctness of the new cross-user enumeration read; `xstockstrat-analysis` owner — consumer of the new RPC

**Codebase Evidence**:
- Service RPC block ends at `EnsureSignalWatchlist` — `packages/proto/portfolio/v1/portfolio.proto:29` (`rpc EnsureSignalWatchlist(...)` is the last RPC before the closing `}` at :30). Add the new RPC after :29.
- Existing empty-body request precedent: `EnsureSignalWatchlistRequest` (feature 127) — the request "has no body (FR-2)" comment at `portfolio.proto:27-28`; ownership taken from the header, so an empty request message is the established shape here.
- `WatchlistBinding.symbol` is field 1 — `portfolio.proto:185`; the DISTINCT collapses `(symbol, strategy_id)` bindings (design R2 resolution).

**TDD**: `N/A (proto)`

**Covers**: —

**Instructions**:
1. In the `service PortfolioService { … }` block, immediately after the `EnsureSignalWatchlist` RPC (`portfolio.proto:29`), add:
   ```proto
     // Cross-user enumeration (feature 154): the distinct union of watchlist symbols across
     // ALL users' watchlists — NOT scoped to the caller's x-user-id. Privileged: gated by the
     // x-internal-caller allow-list (grant `analysis-fundsignal`), not the admin x-access-scope
     // bit (PR #994) — a non-allow-listed caller gets PERMISSION_DENIED. Read-only; intended for
     // the fundamentals-signal producer's universe resolution.
     rpc ListAllWatchlistSymbols(ListAllWatchlistSymbolsRequest) returns (ListAllWatchlistSymbolsResponse);
   ```
2. Add the two new messages near the other watchlist messages (after `EnsureSignalWatchlistResponse`; place is cosmetic). New field numbers start at 1 — no existing message is touched:
   ```proto
   // Empty — the enumeration spans all users; ownership/scoping does not apply (feature 154).
   message ListAllWatchlistSymbolsRequest {}
   message ListAllWatchlistSymbolsResponse {
     // Distinct, sorted bare symbols across all users' watchlists (bindings collapsed).
     repeated string symbols = 1;
   }
   ```
3. Do **not** add or renumber any field on an existing message (additive-only → `buf breaking` clean, C-09).

**Verification**:
```bash
cd packages/proto && buf lint && buf breaking --against "../../.git#branch=main-dev,subdir=packages/proto"
```
Both pass (additive RPC + new messages introduce no breaking change).

---

### Step 2 — proto-gen: regenerate stubs

**Status**: `pending`
**Service**: `packages/proto`
**Files**:
- `packages/proto/gen/**` — modify (generated Go/TS/Python stubs — do not hand-edit)

**Reviewers**: Proto Reviewer — inherited from Step 1

**Codebase Evidence**:
- Codegen entrypoint — `scripts/buf-gen.sh` (root `CLAUDE.md` § Generating Proto Stubs: "generates TypeScript, Python, and Go stubs and compiles the TS package").
- Freshness is CI-enforced (`proto-freshness` job) — the committed `gen/` must match a fresh run.

**TDD**: `N/A (proto-gen)`

**Covers**: —

**Instructions**:
1. Run `./scripts/buf-gen.sh` from the repo root (or the host-toolchain path in `docs/runbooks/codegen-toolchain-host-setup.md` if Docker/egress is unavailable).
2. Stage the regenerated stubs. The new symbols appear as `portfoliov1.ListAllWatchlistSymbolsRequest/Response` (Go), `portfolio_pb2.ListAllWatchlistSymbolsRequest/Response` (Python), and the TS equivalents; `PortfolioServiceStub` gains `ListAllWatchlistSymbols`.

**Verification**:
```bash
./scripts/buf-gen.sh
git status --porcelain packages/proto/gen/   # only additive stub changes for the new RPC/messages
```
The diff contains only the new RPC/message additions; re-running produces no further diff (idempotent codegen).

---

### Step 3 — service (portfolio): repo `DISTINCT` query + first authz gate + RPC wiring

**Status**: `pending`
**Service**: `xstockstrat-portfolio`
**Files**:
- `services/xstockstrat-portfolio/internal/repository/watchlist_repo.go` — modify (add `ListAllSymbols`)
- `services/xstockstrat-portfolio/internal/service/authz.go` — create (portfolio's first authz gate)
- `services/xstockstrat-portfolio/internal/service/portfolio_service.go` — modify (add `ListAllSymbols` to the `WatchlistStore` interface + the `ListAllWatchlistSymbols` service method)
- `services/xstockstrat-portfolio/internal/handler/portfolio_handler.go` — modify (Connect method + grpc adapter method)

**Reviewers**: `xstockstrat-portfolio` owner — position snapshot consistency, concurrent write safety, correctness of the new cross-user enumeration read; Security — cross-user data exposure: the global enumeration RPC must be internal-scoped, not open like the other reads

**Codebase Evidence**:
- `WatchlistStore` interface — `portfolio_service.go:1136-1146` (the persistence surface the watchlist RPCs depend on; the concrete impl is `*repository.WatchlistRepo`, tests inject a stub). Add `ListAllSymbols(ctx context.Context) ([]string, error)` here.
- `WatchlistRepo` over a shared `*pgxpool.Pool` — `watchlist_repo.go:26-33` (reuses the existing pool — no new pool, F-06); the `portfolio.watchlist_symbols` table and `symbol` column are read flat by `listBindings` at `watchlist_repo.go:247-249` (`SELECT symbol, strategy_id, source FROM portfolio.watchlist_symbols WHERE watchlist_id = $1 ORDER BY symbol ASC`). A cross-user `SELECT DISTINCT symbol` needs **no user join and no migration** (recon: `user_id` lives on `portfolio.watchlists`, symbols are flat rows keyed `(watchlist_id, symbol)`).
- Service method precedent (empty-body, header-derived) — `EnsureSignalWatchlist` at `portfolio_service.go:1292-1302` (`func (s *PortfolioService) EnsureSignalWatchlist(ctx, _ *…Request) (*…Response, error)`; calls `s.watchlists.…`; wraps repo error as `connect.NewError(connect.CodeInternal, err)`).
- **Authz mechanism** — portfolio has **no existing authz gate** (recon R1). The header is read directly from incoming metadata: `middleware.UnaryServerInterceptor` already uses `metadata.FromIncomingContext(ctx)` at `internal/middleware/propagation.go:28`. The design mandates reading via `metadata.FromIncomingContext(ctx)` **NOT** `connect.Request.Header()` — the grpc adapter's `connect.NewRequest(req)` fabricates empty headers (design R2; e.g. `portfolio_handler.go:295` `a.h.ListWatchlists(ctx, connect.NewRequest(req))` — the real inbound metadata rides `ctx`, not the fabricated request).
- **Grant shape** — mirror config's least-privilege `{callerID, …}` allow-list at `services/xstockstrat-config/src/grpc/authz.ts:95-132` (`InternalCallerGrant`, `hasInternalCallerAuthority`, `HEADER_INTERNAL_CALLER = 'x-internal-caller'`, fails closed on absent/unlisted). Design keeps `{callerID, rpc}` (not bare callerID — R3).
- **Return code** — the service returns a `*connect.Error`; the grpc adapter maps it via `toGRPCError`, which maps `connect.CodePermissionDenied → status.Error(codes.PermissionDenied, …)` at `portfolio_handler.go:366-367`. So a `connect.NewError(connect.CodePermissionDenied, …)` at the service layer surfaces as gRPC `PERMISSION_DENIED` (resolves design Open Risk #1).
- Connect handler + grpc adapter pattern — `ListWatchlists` handler at `portfolio_handler.go:149-155` and its adapter at `:294-300` (adapter calls `toGRPCError` on error).

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. **Repo** (`watchlist_repo.go`): add
   ```go
   // ListAllSymbols returns the distinct union of watchlist symbols across ALL users
   // (feature 154). No user filter, no join — user_id lives on portfolio.watchlists, but
   // symbols are flat rows on portfolio.watchlist_symbols. Reuses the shared pool (F-06).
   func (r *WatchlistRepo) ListAllSymbols(ctx context.Context) ([]string, error) {
       rows, err := r.pool.Query(ctx,
           `SELECT DISTINCT symbol FROM portfolio.watchlist_symbols ORDER BY symbol`)
       // scan each row into a []string; return rows.Err()
   }
   ```
   Model the scan/`defer rows.Close()`/`rows.Err()` loop on `listBindings` (`watchlist_repo.go:247-269`).
2. **Authz gate** (`internal/service/authz.go`, new file, `package service`):
   ```go
   const HeaderInternalCaller = "x-internal-caller"

   type internalCallerGrant struct{ callerID, rpc string }

   // internalCallerAllowlist — least-privilege {callerID, rpc} grants (mirrors config's
   // authz.ts). Feature 154: the fundamentals producer may enumerate the cross-user union.
   var internalCallerAllowlist = []internalCallerGrant{
       {callerID: "analysis-fundsignal", rpc: "ListAllWatchlistSymbols"},
   }

   // hasInternalCallerAuthority is portfolio's FIRST authz gate. Reads x-internal-caller from
   // INCOMING metadata (never connect.Request.Header() — the grpc adapter fabricates empty
   // headers). Fails closed: absent md / absent header / >1 value with none matching / unlisted
   // callerID / wrong rpc → false. Ignores the admin x-access-scope bit (AC-2).
   func hasInternalCallerAuthority(ctx context.Context, rpc string) bool { … }
   ```
   Use `metadata.FromIncomingContext(ctx)` and `md.Get(HeaderInternalCaller)`; require an exact `{callerID, rpc}` match against a grant. Any absent/mismatch returns false.
3. **Service** (`portfolio_service.go`): add `ListAllSymbols(ctx context.Context) ([]string, error)` to the `WatchlistStore` interface (`:1136-1146`), and the method:
   ```go
   func (s *PortfolioService) ListAllWatchlistSymbols(ctx context.Context, _ *portfoliov1.ListAllWatchlistSymbolsRequest) (*portfoliov1.ListAllWatchlistSymbolsResponse, error) {
       if !hasInternalCallerAuthority(ctx, "ListAllWatchlistSymbols") {
           return nil, connect.NewError(connect.CodePermissionDenied, errors.New("cross-user watchlist enumeration is internal-caller-gated"))
       }
       syms, err := s.watchlists.ListAllSymbols(ctx)
       if err != nil {
           return nil, connect.NewError(connect.CodeInternal, err)
       }
       return &portfoliov1.ListAllWatchlistSymbolsResponse{Symbols: syms}, nil
   }
   ```
4. **Handler** (`portfolio_handler.go`): add the Connect method (model `ListWatchlists` at `:149-155`, pass the service error straight through) and the grpc adapter method (model the adapter at `:294-300`, wrapping the error in `toGRPCError`).

**Verification**: covered by Step 4's paired test run (build + `go test` + lint). Additionally confirm the gate reads incoming metadata, not the fabricated request:
```bash
cd services/xstockstrat-portfolio && grep -n "FromIncomingContext" internal/service/authz.go   # present
grep -n "connect.Request" internal/service/authz.go   # ABSENT — the gate must not read the fabricated header
```

---

### Step 4 — test (portfolio): authz fail-closed + DISTINCT enumeration

**Status**: `pending`
**Service**: `xstockstrat-portfolio`
**Files**:
- `services/xstockstrat-portfolio/internal/service/watchlist_service_test.go` — modify (extend `fakeWatchlistStore`; add `ListAllWatchlistSymbols` service + authz tests)

**Reviewers**: `xstockstrat-portfolio` owner — correctness of the new cross-user enumeration read and its authz gate

**Codebase Evidence**:
- In-memory `fakeWatchlistStore` + `ctxWithUser` helper — `internal/service/watchlist_service_test.go:26-33` and `:198-202` (recon: `ctxWithUser` injects `x-user-id` via the real interceptor). A **new** ctx builder is needed to inject `x-internal-caller` into **incoming** metadata (the existing helper only sets `x-user-id`) — build it with `metadata.NewIncomingContext(ctx, metadata.Pairs("x-internal-caller", "analysis-fundsignal"))`.
- Coverage exclusion: the Go coverage command excludes the `service`, `repository`, and `handler` packages (`reference/spec-template.md` § Coverage thresholds). All new logic lands in those excluded packages, so **no coverage-threshold delta applies** — but a test step is still required (C-08) and the cases run under `go test`.
- C-13 test data: fixtures are inline symbol slices (`[]string{"AAPL","MSFT","NVDA"}`); no `internal/testdata/` exists (recon: "inline fixtures, no `internal/testdata/`"). These are single-consumer scenario literals → inline is compliant (C-13); do not create a fixture home speculatively.

**TDD**: `red-green required`

**Covers**: `AC-1, AC-2`

**Instructions**:
1. Extend `fakeWatchlistStore` with a `ListAllSymbols(ctx) ([]string, error)` returning a configurable slice (and an injectable error).
2. **AC-1** — with `x-internal-caller: analysis-fundsignal` in incoming metadata and the fake returning the union of two users' lists (e.g. alice `AAPL,MSFT` + bob `MSFT,NVDA`), assert the response `Symbols` is exactly the distinct set `{AAPL, MSFT, NVDA}` with `MSFT` appearing once. (The `DISTINCT`/dedup itself is proven at the SQL layer; here assert the service passes the store's distinct result through unchanged.)
3. **AC-2** — table of fail-closed cases, each asserting `connect.CodeOf(err) == connect.CodePermissionDenied` and a nil/empty result: (a) no incoming metadata; (b) metadata present but no `x-internal-caller`; (c) an unlisted callerID (e.g. `"someone-else"`); (d) **admin-bit-only** — `x-access-scope: 4` present but no `x-internal-caller` (proves the gate ignores the admin bit).
4. Author the tests to **fail against the pre-Step-3 tree** (the method/gate don't exist yet) — red-before-green (P-06).

**Verification**:
```bash
cd services/xstockstrat-portfolio && GOWORK=off go test ./internal/service/... ./internal/repository/... -race -count=1
cd services/xstockstrat-portfolio && GOWORK=off golangci-lint run --modules-download-mode=mod
```
All new cases pass; lint clean. (New logic is in CI-coverage-excluded packages — `service`/`repository`/`handler` — so no coverage-threshold assertion applies; the test cases themselves are the required verification, C-08.)

---

### Step 5 — service (analysis): `_resolve_universe` rewrite + FMP-gated truncation + marketdata config watcher

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/app/main.py` — modify (second boot-frozen `ConfigWatcher(namespace="marketdata")`; pass into `FundamentalsSignalLoop`)
- `services/xstockstrat-analysis/app/engine/fundsignal_loop.py` — modify (new ctor param; `_resolve_universe` rewrite; FMP-gated cap in `run_once`; `gen.portfolio` import)

**Reviewers**: `xstockstrat-analysis` owner — producer universe resolution preserves dedup+cap+budget; backtest/producer determinism

**Codebase Evidence**:
- `_resolve_universe` current fallback — `fundsignal_loop.py:203-218` (`explicit` returns at :211-212; `watchlists`/`both` both log "no global watchlist RPC" and `return explicit` at :213-218). **Sole caller** confirmed: only `run_once` at `fundsignal_loop.py:107` calls it (grep for `_resolve_universe` returns only `:107`, the def at `:203`, and the test at `test_fundsignal_loop.py:137` — resolves the fails-080 absence-claim).
- `run_once` cap site — `fundsignal_loop.py:106-108`: `max_symbols = self._cfg.get_int("analysis.fundsignal.max_symbols_per_run", default=200)`; `universe = override_symbols or await self._resolve_universe(metadata)`; `universe = self._dedup(universe)[:max_symbols]`. This `[:max_symbols]` cut is the branch point for FR-7.
- `_dedup` (strip/upper/dedup/**sorted**) — `fundsignal_loop.py:224-233`; `_parse_csv` — `:220-222`.
- Portfolio stub already held & wired — `self._portfolio` (ctor param `portfolio_stub`) at `fundsignal_loop.py:64,73`, wired from `servicer._portfolio` at `main.py:147`; the stub is built at `app/handlers/servicer.py:351-355` (nil when `PORTFOLIO_ENDPOINT` unwired). **No new channel/env var** — `PORTFOLIO_ENDPOINT` exists (`main.py:34`), F-06.
- RPC call shape to mirror — `live_loop.py:424-431` (`await self._portfolio.ListWatchlists(portfolio_pb2.ListWatchlistsRequest(...), metadata=[...])`); the new call is `self._portfolio.ListAllWatchlistSymbols(portfolio_pb2.ListAllWatchlistSymbolsRequest(), metadata=meta)`.
- Metadata-append precedent — `_ensure_source_registered` at `fundsignal_loop.py:344-346` (`meta = list(metadata) if metadata else []; … meta.append((...))`). Design mandates **append, don't replace**: `meta = list(metadata) + [("x-internal-caller", "analysis-fundsignal")]` — the loop path (`metadata=()`) presents internal-caller only; the manual `RunFundamentalsScan` path preserves the caller's propagated `x-trace-id`/`x-user-id` (C-03).
- Non-fatal degradation idiom — `_paced_fetch` `try/except → log.warning` at `fundsignal_loop.py:263-264`, `_emit_signal` at `:392-394`; per-cycle `run_forever` try/except at `:92-96`. Use the same idiom for the enumeration outage (FR-6/AC-7/AC-8).
- `ConfigWatcher` — `app/config/watcher.py:35-52` (ctor takes `endpoint`, `namespace`; opens a per-namespace `WatchConfig` stream); `get_str(key, default)` returns `v.string_val or default` (`:87-93`). Analysis constructs its own watcher at `main.py:42-43` (`ConfigWatcher(endpoint=CONFIG_ENDPOINT, namespace="analysis")`; `await cfg_watcher.wait_for_snapshot(timeout_seconds=90)`). `FundamentalsSignalLoop` is constructed at `main.py:142-151`.
- Provider key confirmed to exist — `marketdata.fundamentals.provider` (string, default `finnhub`), seeded by `services/xstockstrat-config/migrations/015_marketdata_finnhub.up.sql:60`; marketdata reads it **boot-frozen** (marketdata `CLAUDE.md`: "Read **once at boot**"). Values: `finnhub` | `fmp`.
- Design-phase ledger insight (this feature) — `docs/roadmap/ledger/insights.md:2087` records the boot-frozen cross-namespace `ConfigWatcher` as the sanctioned pattern.
- **Header propagation (constraint §B):** this step adds a new outbound gRPC call on `self._portfolio`. Python services propagate via **per-method `metadata`** (`docs/patterns/header-propagation.md`); the `meta = list(metadata) + [(...)]` build forwards the inbound `x-user-id`/`x-access-scope`/`x-trace-id` (present on the manual path) and adds `x-internal-caller`. Matches the existing `_ensure_source_registered` per-method metadata pattern.

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. **`main.py`**: after the existing analysis watcher (`:42-43`), construct and await a second watcher:
   ```python
   md_cfg_watcher = ConfigWatcher(endpoint=CONFIG_ENDPOINT, namespace="marketdata")
   await md_cfg_watcher.wait_for_snapshot(timeout_seconds=90)
   ```
   Pass it into `FundamentalsSignalLoop(...)` (`:142-151`) as a new keyword arg `md_config_watcher=md_cfg_watcher`.
2. **`fundsignal_loop.py` ctor**: add a `md_config_watcher` param; read the provider **once, boot-frozen**, into `self._fmp_active`:
   ```python
   provider = md_config_watcher.get_str("marketdata.fundamentals.provider", "") if md_config_watcher else ""
   # Conservative: unknown/absent provider selects the capped path without baking in a literal.
   self._fmp_active = (provider == "fmp")
   self._provider_known = (provider != "")
   ```
   Keep the loop constructible with `md_config_watcher=None` for existing tests (default None → capped path, matching the unknown-provider conservative direction).
3. **`gen.portfolio` import**: add `from gen.portfolio.v1 import portfolio_pb2` at the top of `fundsignal_loop.py` (recon: import is absent here, present in `live_loop.py:32`/`servicer.py:32` — the generated stub exists after Step 2).
4. **`_resolve_universe` rewrite** (replace `:203-218`):
   - `explicit` → return the parsed explicit CSV **byte-for-byte unchanged** (`:211-212` behavior preserved; the enumeration RPC is **not** called — AC-5).
   - `watchlists` → `enumerated = await self._enumerate_watchlist_union(metadata)`; return it.
   - `both` → return `enumerated ∪ explicit` (concatenate, let `run_once`'s `_dedup` collapse; or dedup here — either satisfies AC-4's de-duplicated union).
   - Add a helper `_enumerate_watchlist_union(metadata)`:
     ```python
     if self._portfolio is None:
         return []
     meta = list(metadata) + [("x-internal-caller", "analysis-fundsignal")]
     try:
         resp = await self._portfolio.ListAllWatchlistSymbols(
             portfolio_pb2.ListAllWatchlistSymbolsRequest(), metadata=meta)
         return list(resp.symbols)
     except Exception as e:  # noqa: BLE001 — never crash the cycle (FR-6)
         log.warning("fundsignal: ListAllWatchlistSymbols failed: %s", e)
         return []   # watchlists → empty; both → callers still add explicit CSV
     ```
     For `both`, ensure the explicit CSV is still returned even when the enumeration raises (AC-8) — i.e. compute `explicit` first and union whatever the enumeration returned (empty on failure).
5. **FMP-gated truncation in `run_once`** (`:106-108`): branch the cap:
   ```python
   deduped = self._dedup(universe)
   apply_cap = self._fmp_active or not self._provider_known  # unknown → conservative capped path
   if apply_cap and len(deduped) > max_symbols:
       offset = datetime.now(UTC).toordinal() % len(deduped)   # stateless rotating offset (R3)
       rotated = deduped[offset:] + deduped[:offset]
       kept = rotated[:max_symbols]
       dropped = [s for s in deduped if s not in set(kept)]
       log.warning("fundsignal: max_symbols cap dropped %d of %d symbols (FMP budget): %s",
                   len(dropped), len(deduped), ",".join(dropped))
       universe = kept
   else:
       universe = deduped   # non-FMP: whole union, no max_symbols truncation (FR-7/AC-9)
   ```
   **Override-path semantics (explicit — do not guess, P-03):** `deduped` is derived from `universe = override_symbols or await self._resolve_universe(metadata)`, so this single `apply_cap` branch governs **both** the resolver-derived union and a manual `RunFundamentalsScan` `override_symbols` list. This is intended: the `max_symbols` cap is purely an **FMP-budget guard**, not a universe-source policy — so under FMP-active an explicit override is capped (rotating, with the WARN), and under non-FMP the whole override list is scored. This is a deliberate change from today's unconditional `[:max_symbols]` cut on the override path (previously always capped); it is correct because the only reason to cap is FMP's daily budget, which does not exist for a non-FMP provider. Do **not** touch the `daily_call_budget`/`_paced_fetch` deferral — the non-FMP full universe (resolver or override) still rides the existing paced budget + deferred-resume (design: NOT `budget=len`).

**Verification**: covered by Step 6's paired test run (pytest coverage + ruff). Additionally:
```bash
cd services/xstockstrat-analysis && grep -n "from gen.portfolio.v1 import portfolio_pb2" app/engine/fundsignal_loop.py   # import added
grep -n 'x-internal-caller' app/engine/fundsignal_loop.py   # metadata carries the internal-caller grant
grep -n 'list(metadata) + \[' app/engine/fundsignal_loop.py   # append-don't-replace preserves x-trace-id (C-03)
```

---

### Step 6 — test (analysis): universe resolution across all sources + provider gating + outage

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/tests/test_fundsignal_loop.py` — modify (extend `_make_loop`/`_make_cfg`; add resolution + gating + outage tests)

**Reviewers**: `xstockstrat-analysis` owner — producer universe resolution preserves dedup+cap+budget; determinism

**Codebase Evidence**:
- Existing fakes — `_make_cfg` (MagicMock `get_str`/`get_int`/… side_effect from an overrides dict) at `test_fundsignal_loop.py:19-26`; `_make_loop` (all-`AsyncMock` stubs incl `portfolio_stub`) at `:43-66`; the existing `_resolve_universe(())` explicit test at `:129-138`.
- The `portfolio_stub` in `_make_loop` is already an `AsyncMock` (`:49`) — set `.ListAllWatchlistSymbols` return/side_effect per case.
- C-13: `_make_cfg`/`_make_loop` are the Python fixture home (`tests/conftest.py` is the canonical home, but these module-local factories already exist and are the established pattern in this file) — extend them, keep inline scenario literals (single-consumer) inline.

**TDD**: `red-green required`

**Covers**: `AC-3, AC-4, AC-5, AC-6, AC-7, AC-8, AC-9`

**Instructions**:
Extend `_make_loop`/`_make_cfg` to (a) accept a `provider` override so `md_config_watcher` freezes `fmp_active`, and (b) let each test set `loop._portfolio.ListAllWatchlistSymbols`'s return (a `SimpleNamespace(symbols=[...])`) or `side_effect` (an exception). Then:
- **AC-3** — `universe_source="watchlists"`, `explicit_symbols=""`, enumeration returns `{AAPL,MSFT,NVDA}` → `await loop._resolve_universe(())` (after dedup) is `["AAPL","MSFT","NVDA"]`, non-empty (no explicit fallback).
- **AC-4** — `universe_source="both"`, `explicit_symbols="TSLA, AAPL"`, enumeration `{AAPL,MSFT}` → resolved deduped union `["AAPL","MSFT","TSLA"]`.
- **AC-5** — `universe_source="explicit"`, `explicit_symbols="IBM"`, enumeration (if called) `{AAPL,MSFT}` → resolved `["IBM"]` **and** assert `loop._portfolio.ListAllWatchlistSymbols.assert_not_awaited()` (enumeration not consulted).
- **AC-6** — `universe_source="watchlists"`, `provider="fmp"`, `max_symbols_per_run=2`, enumeration `{AAA,BBB,CCC}` → run the cap path (via `run_once` or a focused cap helper): exactly 2 symbols survive, drawn from `{AAA,BBB,CCC}`, and a WARN naming the 1 dropped symbol is logged (assert with `caplog`).
- **AC-7** — `universe_source="watchlists"`, enumeration raises `grpc.aio.AioRpcError`/`UNAVAILABLE` → `_resolve_universe` returns `[]`, no raise, a WARN naming the failure (caplog).
- **AC-8** — `universe_source="both"`, `explicit_symbols="TSLA, AAPL"`, enumeration raises → resolved `["AAPL","TSLA"]` (the explicit CSV survives), no raise, WARN logged.
- **AC-9** — `universe_source="watchlists"`, `provider="finnhub"`, `max_symbols_per_run=2`, enumeration `{AAA,BBB,CCC}` → all 3 survive (no `max_symbols` truncation); assert no symbol is permanently dropped.
Author each to fail against the pre-Step-5 tree (P-06) — e.g. AC-3 currently returns the empty explicit fallback.

**Verification**:
```bash
cd services/xstockstrat-analysis && pytest --cov=app --cov-fail-under=40
cd services/xstockstrat-analysis && ruff check . && ruff format --check .
```
All new cases pass; coverage ≥ 40%; lint + format clean.

---

### Step 7 — docs: service CLAUDE.md deltas + governance records

**Status**: `pending`
**Service**: `docs/` + service docs
**Files**:
- `services/xstockstrat-analysis/CLAUDE.md` — modify (`universe_source` now resolves the real cross-user union; new boot-frozen `marketdata`-namespace `ConfigWatcher`; FMP-gated `max_symbols`)
- `services/xstockstrat-portfolio/CLAUDE.md` — modify (new `ListAllWatchlistSymbols` RPC; portfolio's first authz gate)
- `services/xstockstrat-portfolio/docs/context-constitution.md` — modify (new `PORTFOLIO-*` invariant: first cross-user enumeration, `x-internal-caller`-gated, not the admin bit)
- `docs/patterns/config-governance.md` — modify (record the analysis→marketdata cross-namespace `WatchConfig` subscription — the first cross-namespace stream subscription; PLAT-4/P-01 novel coupling)

**Reviewers**: none

**Codebase Evidence**:
- Analysis `CLAUDE.md` § Fundamentals Signal Producer describes the `universe_source` fallback and its config table row (`analysis.fundsignal.universe_source` "watchlists union pends a global portfolio RPC; falls back to `explicit`") — both must be corrected to reflect the shipped behavior.
- Portfolio `CLAUDE.md` § Role/Dependencies lists the watchlist RPCs; the new RPC + first authz gate belong there.
- `docs/patterns/config-governance.md` already documents the `x-internal-caller` mechanism (:70-74, :99) and is where the cross-namespace subscription note belongs.
- Teardown rule (root `CLAUDE.md` § Teardown): run `/context-scrubber scan` scoped to touched context files before pushing.

**TDD**: `N/A (docs)`

**Covers**: —

**Instructions**:
1. Analysis `CLAUDE.md`: update the § Fundamentals Signal Producer prose and the `analysis.fundsignal.universe_source` / `max_symbols_per_run` config-table rows — `watchlists`/`both` now resolve the real cross-user union via portfolio `ListAllWatchlistSymbols`; the `max_symbols` cap now applies **only when FMP is the active provider** (`marketdata.fundamentals.provider`, read boot-frozen via a second `ConfigWatcher(namespace="marketdata")`), non-FMP takes the whole union. Note the new analysis→marketdata cross-namespace config read.
2. Portfolio `CLAUDE.md`: document `ListAllWatchlistSymbols` (cross-user distinct-symbol enumeration; `x-internal-caller` allow-list, grant `analysis-fundsignal`; **not** the admin `x-access-scope` bit) as portfolio's first authz gate.
3. Portfolio `docs/context-constitution.md`: add a `PORTFOLIO-*` invariant — `ListAllWatchlistSymbols` is the platform's first cross-user enumeration of per-user watchlist data, gated by the `x-internal-caller` allow-list, not the admin bit (PR #994).
4. `docs/patterns/config-governance.md`: record that `xstockstrat-analysis` now holds a **second, boot-frozen** `WatchConfig` subscription to the `marketdata` namespace (the first cross-namespace stream subscription on the platform) to mirror marketdata's frozen provider selection without duplicating provider state into the analysis namespace.
5. Run `/context-scrubber scan` scoped to the touched context files and fix grounded findings (Teardown). If the context-forge plugin is unavailable, say so in the PR body.

**Verification**:
```bash
grep -n "ListAllWatchlistSymbols" services/xstockstrat-portfolio/CLAUDE.md services/xstockstrat-portfolio/docs/context-constitution.md
grep -n "marketdata.fundamentals.provider\|cross-user" services/xstockstrat-analysis/CLAUDE.md
```
Each touched doc names the shipped behavior; no stale "falls back to `explicit`"/"pends a global portfolio RPC" claim remains for the `watchlists`/`both` sources.

---

## Deviation Log

_Populated by /sdd-execute as implementation proceeds._
