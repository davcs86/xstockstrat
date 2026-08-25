# Recon: fundsignal-watchlist-universe

**Phase 0 dossier** — grounded codebase facts for `/sdd-design` Phase 1 and `/sdd-spec`. Evidence is
`path:line` from `codebase-discovery`. Anything unfound is in **Risks / Not-found**, never guessed (F-04).

## Objective

Make the fundamentals signal producer's `analysis.fundsignal.universe_source=watchlists`/`both`
resolve the **real cross-user union of user watchlist symbols** via a new additive, privileged
portfolio enumeration RPC, replacing the deferred-at-launch silent fallback to
`analysis.fundsignal.explicit_symbols` (feature 062 FR-3). `explicit` stays CSV-only; the existing
dedup + cap + budget pipeline is preserved.

## Codebase Map

### xstockstrat-analysis (Python) — the consumer
- `_resolve_universe` — the watchlists/both fallback to replace — `app/engine/fundsignal_loop.py:203-218`
  (`if source == "explicit": return explicit` at :211-212; else logs "no global watchlist RPC — using
  explicit fallback" and `return explicit` at :213-218).
- `run_once` resolves then caps — `app/engine/fundsignal_loop.py:106-108`
  (`universe = override_symbols or await self._resolve_universe(metadata)`; `self._dedup(universe)[:max_symbols]`).
- `_parse_csv` (:220-222), `_dedup` (strip/upper/dedup/**sorted**) (:224-233).
- Config reads: `universe_source` + `explicit_symbols` both `get_str` — `:209-210`; watcher is
  `ConfigWatcher` (`app/config/watcher.py:87`, `app/main.py:19,42`).
- **Portfolio stub already held**: `self._portfolio` (`portfolio_stub` ctor param) —
  `fundsignal_loop.py:64,73`; wired from `servicer._portfolio` in `app/main.py:142-147`; stub built at
  `app/handlers/servicer.py:351-355` (`PortfolioServiceStub`, nil if unwired); `PORTFOLIO_ENDPOINT` at
  `main.py:34`, channel at `main.py:67`.
- Admin-scope injection **reuse candidate** — `fundsignal_loop.py:344-346`
  (`meta.append(("x-access-scope", "4"))  # admin bit for the background loop path`).
- Metadata threading: `run_once(metadata=())` (:100) → `_resolve_universe` (:107), `_paced_fetch`
  (:140, `GetFundamentalsMulti metadata=metadata` :257-260), `IngestSignal metadata=metadata` (:389).
- Graceful degradation: `run_forever` try/except per cycle — `fundsignal_loop.py:92-96`.
- `gen.portfolio.v1` import: **absent** from `fundsignal_loop.py`; present at `live_loop.py:32`
  (`portfolio_pb2`, `ListWatchlistsRequest` at :425) and `servicer.py:32`.
- Tests: `tests/test_fundsignal_loop.py:129-138` (`_resolve_universe(())`); `_make_cfg` MagicMock
  side_effect (:19-26); `_make_loop` all-`AsyncMock` stubs incl `portfolio_stub` (:43-56);
  conftest `tests/conftest.py`.

### xstockstrat-portfolio (Go) — the producer of the new RPC
- PortfolioService RPC block — `packages/proto/portfolio/v1/portfolio.proto:10-30` (last RPC
  `EnsureSignalWatchlist` at :29 — add the new RPC after it).
- `ListWatchlistsRequest` is **user-scoped, no `user_id` on the wire** — `portfolio.proto:229-231`
  (comment :209-210, :273: ownership from `x-user-id`). `Watchlist` highest field = 9 (:193-207),
  `WatchlistBinding` = 3 (:184-190), `ListWatchlistsResponse` = 2 (:232-235).
- Service: `ListWatchlists` (:1318-1337), `EnsureSignalWatchlist` (:1292-1302); caller-user helper
  `requireUserID(ctx)` reads `middleware.FromContext(ctx).UserID` (:1229-1236); `WatchlistStore`
  interface (add the cross-user method here) (:1134-1146).
- Repo: `WatchlistRepo` over shared `*pgxpool.Pool` (`internal/repository/watchlist_repo.go:26-33`);
  `listBindings` reads `SELECT symbol, strategy_id, source FROM portfolio.watchlist_symbols WHERE
  watchlist_id=$1` (:247-249). **Symbols are flat rows** in `portfolio.watchlist_symbols.symbol`
  (table keyed `(watchlist_id, symbol)`), user_id only on `portfolio.watchlists` — a cross-user
  `SELECT DISTINCT symbol FROM portfolio.watchlist_symbols` needs no user join and **no migration**.
- Handler: Connect method on `PortfolioHandler` (~:149) + matching `grpcPortfolioAdapter` method
  (~:294); `toGRPCError` already maps `PermissionDenied`/`InvalidArgument`/`NotFound` (:358-371).
- Header propagation: `UnaryServerInterceptor` extracts `x-user-id`/`x-access-scope`/`x-trace-id`
  (`internal/middleware/propagation.go:27-35`); `FromContext(ctx) PropagationData{UserID, AccessScope,
  TraceID}` (:13-23).
- Highest migration: `011_watchlist_system_managed_source` (feature 154 adds none).
- Tests: `internal/service/watchlist_service_test.go` — in-memory `fakeWatchlistStore` (:26-33),
  `ctxWithUser` injects `x-user-id` via the real interceptor (:198-202); repo tests
  `internal/repository/portfolio_repo_test.go`; **inline fixtures, no `internal/testdata/`**.

## Patterns to REUSE (anti-duplication core)

1. **The already-wired analysis→portfolio stub** — call the new RPC on `self._portfolio`; do **not**
   add a new channel/env var (`PORTFOLIO_ENDPOINT` already present, feature 062). Mirror the
   `portfolio_pb2.ListWatchlistsRequest` call shape at `live_loop.py:425`.
2. **The admin-scope injection** — reuse the exact `_ensure_source_registered` metadata build
   (`fundsignal_loop.py:344-346`) so the background loop presents the admin bit to the new RPC.
3. **The `WatchlistStore` interface + `fakeWatchlistStore`** — add the cross-user method to the
   interface and fake, matching `ListByUser`'s shape (service test at `watchlist_service_test.go`).
4. **`toGRPCError`'s existing `PermissionDenied` mapping** — the authz gate returns a Connect
   `CodePermissionDenied`; no new error plumbing.
5. **The producer's non-fatal `try/except → log.warning` idiom** (`_paced_fetch` :263-264,
   `_emit_signal` :392-394) for the enumeration-outage degradation (FR-6/AC-7).
6. **Python resolver tests** — extend `tests/test_fundsignal_loop.py` with the `_make_cfg`/`_make_loop`
   fakes already there (AC-3..AC-7).

## Dependencies

- **Proto**: 1 additive RPC on `xstockstrat.portfolio.v1.PortfolioService` + request/response messages
  (new field numbers from 1; existing messages untouched → `buf breaking` clean, C-09). Working name
  `ListAllWatchlistSymbols`; final name/shape is a Phase-1 decision.
- **Inter-service edge**: analysis→portfolio read — **already exists** (feature 062); no new edge, no
  cycle (portfolio dials only ledger/marketdata/notify — insights 2026-07-31/083; it does not call
  analysis).
- **Config**: none new (`analysis.fundsignal.universe_source`, `.explicit_symbols` exist).
- **DB**: none (cross-user `DISTINCT symbol` over existing `portfolio.watchlist_symbols`).
- **Env vars**: none new.

## Existing Business Rules (C-16)

- No existing acceptance suite for `xstockstrat-portfolio` yet (`services/xstockstrat-portfolio/acceptance/` absent).
- No existing acceptance suite for `xstockstrat-analysis` yet (`services/xstockstrat-analysis/acceptance/` absent).
- No cross-cutting `docs/sdd/business-rules/platform.feature` scenario touches this subject (its sole
  `@AC-8` guards the removed `MCP_AGENT_SECRET`).
- **Not a clean bill** (scenario-recon caveat): "no suite yet" ≠ "no rules". The per-user watchlist
  scoping constraint that the new **cross-user** RPC deliberately widens has **no promoted `@AC-*`**
  to weigh against — so the access-scope widening is a **first-class design decision** (see Risks),
  not a guarded regression. Any such invariant, if written, lives in `docs/context-constitution.md` /
  module docs, not a suite.

## Risks / Not-found

- **R1 — Portfolio has NO authz gate today (key fact).** `x-access-scope` is parsed
  (`propagation.go:31` → `PropagationData.AccessScope`) but **never read for authorization** on any
  RPC; no `x-internal-caller`, no allow-list, no admin check. This RPC introduces portfolio's first
  access gate — there is **no existing pattern to copy inside portfolio**. Ledger 2026-08-01 (EmitAlert
  authz): "when an ungated internal RPC is flagged for authz, first enumerate WHO calls it." Here the
  RPC is **new** and its only caller is the producer, so gating it cannot break an existing caller —
  the risk is choosing the mechanism (admin `x-access-scope` bit vs `x-internal-caller` allow-list).
- **R2 — Cross-user data exposure.** The RPC returns every user's watched symbols. FR-2 requires it be
  privileged. Design must pick and justify the gate, and confirm `AccessScope` carries a parseable
  admin bit (`0x04`; producer injects `"4"`).
- **R3 — Unbounded union / fairness.** Across all users the union may exceed `max_symbols_per_run`;
  today `_dedup` **sorts alphabetically** then truncates (`[:max_symbols]`), so a large union biases
  toward alphabetically-early tickers (insights 2026-08-02/097: unordered truncation is not
  round-robin). Design should note whether al:phabetical bias is acceptable for v1 or needs a fairer cut.
- **R4 — `(symbol, strategy)` bindings vs bare symbols.** Watchlists store `(watchlist_id, symbol,
  strategy_id, source)`; the producer scores per-symbol, so the RPC must return **distinct bare
  symbols** (collapsing bindings), not pairs.
- **R5 — Ledger 2026-07-30/082 (branch divergence).** This session is on harness branch
  `claude/fundamentals-signal-config-0jdfed`, not `feature/fundsignal-watchlist-universe`; reconcile
  before `/sdd-execute` writes code.
- **Not found**: no `internal/testdata/` in portfolio; no `gen.portfolio` import in `fundsignal_loop.py`
  (must be added); no existing cross-user/global watchlist RPC anywhere.

## Recommended Scope (advisory step boundaries)

1. **proto** — add `ListAllWatchlistSymbols` RPC + `ListAllWatchlistSymbolsRequest`(empty)/`Response`
   (`repeated string symbols`) to `portfolio.proto`; `./scripts/buf-gen.sh`; `buf lint`/`buf breaking`.
2. **service (portfolio)** — `WatchlistStore.ListAllSymbols(ctx)` repo method (`SELECT DISTINCT symbol …
   ORDER BY symbol`); service method with the **admin-scope gate** (first authz gate — `FromContext`
   AccessScope admin bit; `PermissionDenied` otherwise); Connect handler + grpc adapter. + paired test.
3. **service (analysis)** — rewrite `_resolve_universe`: `explicit` unchanged; `watchlists` = RPC union;
   `both` = RPC union ∪ explicit CSV; wrap the RPC in `try/except → log.warning` degrade-to-empty; add
   the `gen.portfolio` import; inject admin metadata. + paired test (AC-3..AC-7).
4. **docs** — analysis + portfolio `CLAUDE.md` deltas (new RPC; producer universe now real).
