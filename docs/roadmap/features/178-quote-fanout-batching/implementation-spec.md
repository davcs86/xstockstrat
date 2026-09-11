# Implementation Spec: quote-fanout-batching

**Status**: `pending`
**Created**: 2026-09-05
**Feature**: `docs/roadmap/features/178-quote-fanout-batching/feature.md`
**Total Steps**: 8
**Feature Branch**: `feature/quote-fanout-batching`

---

## Execution Summary

Additive-first, then consumer switch. Step 1 adds the `GetLatestQuotes` RPC + messages to
`marketdata.proto` (mirroring the `GetFundamentalsMulti` batch precedent); Step 2 regenerates stubs.
Steps 3–4 implement and test the marketdata batch service method (cache-first: batched
`DISTINCT ON` repo read + one `alpaca.GetLatestQuotesMulti` cold fetch under a set-keyed
`singleflight.Group`) — this is the only edge that must exist before portfolio can consume it. Steps
5–6 switch portfolio's four mark-to-market read sites to the single batch call and add the null-not-zero
parity tests. Steps 7–8 collapse the `ListWatchlists` 1+N `listBindings` loop into one `ANY`-array
query. The proto change is additive, so `buf breaking` passes and old clients are unaffected.

**Consumer surfaces (C-14):** product-spec marks this **internal/platform-only** — the UI `/trader`
and `/insights` reads and the agent `get_positions*` tools benefit transparently (faster reads,
**response shapes unchanged**), so no UI/agent step is required. This is a recorded decision, not an
omission.

**Feature-172 overlap:** feature 172 (`fix-portfolio-max-drawdown-unenforced`) has already landed on
the branch base — `checkRiskLimits` now carries 172's `evaluateDrawdowns`/`GetAccountDrawdowns`
drawdown block (`portfolio_service.go:767-772`) after the quote loop. Step 5 batches **only the quote
loop** (rebuilding `posValues`/`totalValue` for the concentration check) and keeps 172's drawdown
block **verbatim** — no same-function conflict remains because 172 is already present in the tree.

### Scenario Coverage (C-15)

| Scenario | Covered by |
|---|---|
| `@AC-1` (one batched quote call, no per-position call) | Step 6 |
| `@AC-2` (bindings in one ANY-array query) | Step 8 |
| `@AC-3` (concurrent cold requests → one Alpaca fetch) | Step 4 |
| `@AC-4` (missing quote → same missing/neutral outcome, no zero-fill) | Step 4 (marketdata partial-map) + Step 6 (portfolio skip parity) |

## Step Dependencies

- Step 2 (`proto-gen`) requires Step 1 (`proto`): stubs regenerate the edited `.proto`.
- Step 3 (marketdata service) requires Step 2: the Go handler/adapter reference the generated
  `GetLatestQuotesRequest`/`GetLatestQuotesResponse`/`MarketDataServiceServer.GetLatestQuotes`.
- Step 4 (`test`) covers Step 3 (`service`) — marketdata batch method (`@AC-3`, `@AC-4` md half).
- Step 5 (portfolio service) requires Step 2 (generated client method `GetLatestQuotes`) and is best
  landed after Step 3 so the RPC it calls exists end-to-end.
- Step 6 (`test`) covers Step 5 (`service`) — portfolio batch switch (`@AC-1`, `@AC-4`).
- Step 8 (`test`) covers Step 7 (`service`) — ANY-array binding read (`@AC-2`).
- Steps 7–8 are independent of Steps 3–6 (DB-only query rewrite) and may land in either order.

---

### Step 1 — proto: add additive `GetLatestQuotes` batch RPC

**Status**: `done`
**Service**: `packages/proto`
**Files**:
- `packages/proto/marketdata/v1/marketdata.proto` — modify

**Reviewers**: Proto Reviewer — field number uniqueness per message, no breaking change (`buf breaking`), enum/naming conventions, codegen freshness; `xstockstrat-marketdata` owner — OHLCV/quote contract shape

**Codebase Evidence**:
- Batch precedent to MIRROR: `rpc GetFundamentalsMulti(GetFundamentalsMultiRequest) returns (GetFundamentalsMultiResponse);` `marketdata.proto:44`; `message GetFundamentalsMultiRequest { repeated string symbols = 1; }` `:221-223`; `message GetFundamentalsMultiResponse { repeated Fundamentals fundamentals = 1; }` `:225-227`.
- Singular RPC being batched: `rpc GetLatestQuote(GetLatestQuoteRequest) returns (Quote);` `:23`; `message GetLatestQuoteRequest { string symbol = 1; }` `:113-115`.
- Response element type already exists — reuse it: `message Quote { string symbol = 1; google.protobuf.Timestamp time = 2; double ask_price = 3; int32 ask_size = 4; double bid_price = 5; int32 bid_size = 6; string source = 7; }` `:63-71`. `Quote` self-keys on `symbol` (field 1), so a partial `repeated Quote` directly encodes null-not-zero (an absent symbol is omitted, never zero-filled).

**TDD**: `N/A (proto)` — contract-only; behavior is proven by Steps 3–4.

**Covers**: —

**Instructions**:
1. In the `service MarketDataService` block, immediately after the `GetFundamentalsMulti` RPC line (`:44`), add:
   ```proto
   // Batched latest quotes — partial by design: a symbol with no quote is omitted from the
   // response (null-not-zero), never returned as a fabricated zero-price Quote.
   rpc GetLatestQuotes(GetLatestQuotesRequest) returns (GetLatestQuotesResponse);
   ```
2. Add the two request/response messages near the existing `GetFundamentalsMulti*` messages (`:221-227`), mirroring their shape (new field numbers start at 1):
   ```proto
   message GetLatestQuotesRequest {
     repeated string symbols = 1;
   }

   message GetLatestQuotesResponse {
     repeated Quote quotes = 1;
   }
   ```
3. Do **not** add a `map<string, Quote>` — `repeated Quote` self-keyed matches the batch precedent (design § Rejected Alternatives).

**Verification**:
```bash
cd packages/proto && buf lint && buf breaking --against ".git#branch=feature/quote-fanout-batching"
```
Both pass (adding an RPC + two messages is additive — `buf breaking` reports no breakage). Empty-diff regeneration is proven in Step 2.

---

### Step 2 — proto-gen: regenerate stubs

**Status**: `done`
**Service**: `packages/proto`
**Files**:
- `packages/proto/gen/go/**`, `packages/proto/gen/python/**`, `packages/proto/gen/ts/**` — modify (generated; never hand-edit)

**Reviewers**: Proto Reviewer — codegen freshness (inherited from Step 1); `xstockstrat-marketdata` owner

**Codebase Evidence**:
- Codegen entrypoint: `./scripts/buf-gen.sh` (root `CLAUDE.md` § Generating Proto Stubs — generates TS, Python, Go and compiles the TS package).
- CI enforcement: the `proto-freshness` job requires an empty `git diff packages/proto/gen/` after regeneration (root `CLAUDE.md` § Proto Contract Governance).

**TDD**: `N/A (proto-gen)`.

**Covers**: —

**Instructions**:
1. Run `./scripts/buf-gen.sh` from the repo root.
2. Stage the regenerated `packages/proto/gen/` output. Expect new Go symbols `GetLatestQuotesRequest`, `GetLatestQuotesResponse`, and `MarketDataServiceServer.GetLatestQuotes` / `MarketDataServiceClient.GetLatestQuotes` in `gen/go/marketdata/v1/`.

**Verification**:
```bash
./scripts/buf-gen.sh && git diff --exit-code packages/proto/gen/
```
Runs clean and leaves **no** diff after staging the regenerated output (matches CI `proto-freshness`).

---

### Step 3 — service: marketdata batch quote method + single-flight

**Status**: `done`
**Service**: `xstockstrat-marketdata`
**Files**:
- `services/xstockstrat-marketdata/internal/repository/marketdata_repo.go` — modify (new `GetLatestQuotesBatch`)
- `services/xstockstrat-marketdata/internal/service/marketdata_service.go` — modify (new `GetLatestQuotes` method + `singleflight.Group` field on `MarketDataService`)
- `services/xstockstrat-marketdata/internal/handler/marketdata_handler.go` — modify (Connect handler + gRPC adapter method)
- `services/xstockstrat-marketdata/go.mod` — modify (`golang.org/x/sync` indirect → direct via `go mod tidy`)

**Reviewers**: `xstockstrat-marketdata` owner — OHLCV/quote integrity, Alpaca feed idempotency, hypertable query shape

**Codebase Evidence**:
- Singular repo read (do **not** mirror — a `LIMIT 1` cannot generalize to N symbols): `GetLatestQuote` `marketdata_repo.go:278` — `SELECT time, symbol, ask_price, ask_size, bid_price, bid_size, source FROM marketdata.quotes WHERE symbol=$1 ORDER BY time DESC LIMIT 1`.
- Index the batched read rides (confirmed `EXPLAIN`-shaped): `CREATE INDEX IF NOT EXISTS idx_quotes_symbol_time ON marketdata.quotes (symbol, time DESC);` `migrations/001_marketdata_hypertables.up.sql:56` → `DISTINCT ON (symbol) ... ORDER BY symbol, time DESC` uses it (no new migration).
- Insert (cold-cache write): `InsertQuote` `marketdata_repo.go:262` — `INSERT ... ON CONFLICT (symbol, time) DO UPDATE ...`.
- Singular service cache-first fallback to mirror as batch: `GetLatestQuote` `marketdata_service.go:406-427` — `s.markWarm(symbol)`, `s.repo.GetLatestQuote`, on miss `s.registry.Get("")` then `src.GetLatestQuote`, then `s.repo.InsertQuote(ctx, live)`.
- Internal batch helper to wrap for cold set: `MultiSymbolSource.GetLatestQuotesMulti(ctx, symbols) (map[string]*Quote, error)` `internal/source/source.go:24-26`; the warm poller already type-asserts and uses it — `if ms, ok := src.(source.MultiSymbolSource); ok { ms.GetLatestQuotesMulti(ctx, symbols) }` `marketdata_service.go:517-518`.
- Handler + adapter precedent (batch): `func (h *MarketDataHandler) GetFundamentalsMulti(...)` `marketdata_handler.go:183` (validates `len(req.Msg.Symbols) == 0` → `CodeInvalidArgument`); gRPC adapter `func (a *grpcMarketDataAdapter) GetFundamentalsMulti(...)` `:318` (`a.h.X(ctx, connect.NewRequest(req))` → `resp.Msg`). Adapter struct `:209-212`; RPC registration is automatic via `marketdatav1.RegisterMarketDataServiceServer(grpcServer, hdl.GRPCHandler())` `cmd/server/main.go:152` (the generated interface gains `GetLatestQuotes`; the adapter must implement it or embedding `UnimplementedMarketDataServiceServer` returns `Unimplemented`).
- Service struct fields to add beside: `staleMu sync.Mutex` / `lastStaleCheck map[string]time.Time` `marketdata_service.go:49-50` (the existing interval limiter — the new `singleflight.Group` sits beside it, distinct code path, no shared lock → no deadlock).
- Dep present indirect: `golang.org/x/sync v0.20.0 // indirect` `go.mod:36` (importing `singleflight` promotes to direct via `go mod tidy`; no new download).

**TDD**: `red-green required`.

**Covers**: —

**Instructions**:
1. **Repo** — add `func (r *MarketDataRepo) GetLatestQuotesBatch(ctx context.Context, symbols []string) (map[string]*marketdatav1.Quote, error)` to `marketdata_repo.go`. Empty input → return an empty map with no query. Query:
   ```sql
   SELECT DISTINCT ON (symbol) time, symbol, ask_price, ask_size, bid_price, bid_size, source
   FROM marketdata.quotes
   WHERE symbol = ANY($1)
   ORDER BY symbol, time DESC
   ```
   Pass `symbols` as the `$1` `[]string` (pgx text array). Scan each row into a `*marketdatav1.Quote` exactly as `GetLatestQuote` does (`:296-304`) and key the result map by `symbol`. A symbol with no rows is simply **absent** from the map (null-not-zero) — never insert a zero `Quote`.
2. **Service struct** — add a `quoteSingleflight singleflight.Group` field to `MarketDataService` (`marketdata_service.go:30-66`), beside `staleMu`/`lastStaleCheck`. Import `golang.org/x/sync/singleflight`.
3. **Service method** — add `func (s *MarketDataService) GetLatestQuotes(ctx context.Context, symbols []string) ([]*marketdatav1.Quote, error)`, cache-first, mirroring the singular path's structure:
   a. For each requested symbol call `s.markWarm(symbol)` (same warm-tracking as the singular path `:408`).
   b. `warm, err := s.repo.GetLatestQuotesBatch(ctx, symbols)` — the cache hits.
   c. Compute `cold` = requested symbols **not** present in `warm`.
   d. If `cold` is non-empty: fetch it under single-flight keyed on the **sorted, joined cold set** (e.g. `strings.Join(sortedCold, ",")`), so concurrent batch calls with the same cold set trigger **one** upstream fetch and share the result (`@AC-3`):
      ```go
      key := strings.Join(sortedCold, ",")
      v, err, _ := s.quoteSingleflight.Do(key, func() (interface{}, error) {
          src, e := s.registry.Get("")
          if e != nil { return nil, e }
          ms, ok := src.(source.MultiSymbolSource)
          if !ok { return map[string]*marketdatav1.Quote{}, nil }
          return ms.GetLatestQuotesMulti(ctx, sortedCold)
      })
      ```
      On the fetched cold map, write each quote back with an **independent** `s.repo.InsertQuote(ctx, q)` (matching the singular path's per-quote cache write `:425` and the warm poller's per-quote insert `:519-522` — **not** one wrapping transaction), logging a warn on insert error without failing the call.
   e. Merge `warm` + cold into a single `[]*marketdatav1.Quote` (order not contractual; the client re-keys by `Quote.symbol`). A symbol absent from **both** is omitted — the null-not-zero guarantee.
   f. Record the **WAIVED** partial-upstream-failure divergence (design § Open Risks): a cold-batch transport error returns the error for the whole cold set; do not silently substitute per-symbol zero values. Keep the happy-path merge; do not add per-symbol retry.
4. **Handler** — add `func (h *MarketDataHandler) GetLatestQuotes(ctx, req *connect.Request[marketdatav1.GetLatestQuotesRequest]) (*connect.Response[marketdatav1.GetLatestQuotesResponse], error)` mirroring `GetFundamentalsMulti` (`:183`): reject empty `req.Msg.Symbols` with `connect.NewError(connect.CodeInvalidArgument, ...)`, call `h.svc.GetLatestQuotes`, wrap in `&marketdatav1.GetLatestQuotesResponse{Quotes: list}`; use `forwardConnectErr` for the error path (`:194`).
5. **gRPC adapter** — add `func (a *grpcMarketDataAdapter) GetLatestQuotes(ctx, req *marketdatav1.GetLatestQuotesRequest) (*marketdatav1.GetLatestQuotesResponse, error)` mirroring `:318` (`a.h.GetLatestQuotes(ctx, connect.NewRequest(req))` → `resp.Msg`, `toGRPCError` on error).
6. Run `go mod tidy` in the service dir to promote `golang.org/x/sync` to a direct dependency.

**Verification**:
```bash
cd services/xstockstrat-marketdata && GOWORK=off go build ./... && GOWORK=off golangci-lint run --modules-download-mode=mod
```
Compiles (the adapter now satisfies the regenerated `MarketDataServiceServer` interface) and lint passes. Behavioral proof is Step 4.

---

### Step 4 — test: marketdata batch method (single-flight + null-not-zero)

**Status**: `done`
**Service**: `xstockstrat-marketdata`
**Files**:
- `services/xstockstrat-marketdata/internal/service/marketdata_service_test.go` — modify (new tests + extend/author a `MultiSymbolSource` fake)

**Reviewers**: `xstockstrat-marketdata` owner — quote correctness, Alpaca idempotency

**Codebase Evidence**:
- Existing source-stub pattern to extend: `fakeBackfillSource` `marketdata_service_test.go:696-715` implements `source.DataSourceClient` (its `GetLatestQuote` returns `nil, nil` `:704`). It does **not** implement `MultiSymbolSource` — a new fake (or an added `GetLatestQuotesMulti` method) is required so `src.(source.MultiSymbolSource)` succeeds.
- Service construction in tests (direct struct literal with a `source.Registry`): `svc := &MarketDataService{registry: reg, ledger: &fakeLedger{}}` `:722-730`; `reg := source.NewRegistry(); reg.Register("alpaca", fake)`.
- Alpaca-layer multi fetch already tested (upstream contract): `TestGetLatestQuotesMulti_Success` `internal/alpaca/client_test.go:499` — the missing-symbol-absent semantics are proven there; this step proves the **service** layer's coalescing + merge.
- Coverage note: new logic lands in `internal/service` + `internal/handler` + `internal/repository`, all **excluded** from the Go coverage `-coverpkg` set (root `CLAUDE.md` test-step table excludes `service/`,`handler/`,`repository/`) — **no coverage threshold applies**; red-green behavioral tests are the gate.

**TDD**: `red-green required` — assert new behavior; fails against the pre-Step-3 tree (no `GetLatestQuotes` method exists).

**Covers**: `AC-3, AC-4`

**Instructions**:
1. Author a `fakeMultiSource` implementing `source.DataSourceClient` **and** `source.MultiSymbolSource`, whose `GetLatestQuotesMulti` (a) increments an atomic call counter and (b) returns a **partial** map (present for some requested symbols, absent for a designated `NOQUOTE`-style symbol). Register it in a `source.Registry`.
2. **`@AC-3` single-flight coalescing** — construct the service with a `fakeMultiSource` whose `GetLatestQuotesMulti` blocks briefly (channel/sleep) to force overlap, then fire ≥5 concurrent `svc.GetLatestQuotes(ctx, []string{"ZZZZ"})` goroutines for the same cold symbol; assert the upstream call counter == **1** and all 5 receive the same quote. (Because `s.repo` is a concrete `*MarketDataRepo` needing a DB, drive the cold path in this unit test with a service whose repo read yields no warm hit — construct so the batch treats every symbol as cold; do not spin up a DB. If the repo cannot be nil-driven without a panic, gate this assertion behind the seam the service exposes for the cold set and note the DB-backed warm read is covered by integration.)
3. **`@AC-4` null-not-zero partial map** — call `svc.GetLatestQuotes(ctx, []string{"AAPL","NOQUOTE"})` where the fake omits `NOQUOTE`; assert the returned slice contains `AAPL` and **does not** contain a `NOQUOTE` entry (absent, not a zero-price `Quote`).
4. **Handler validation** — assert the Connect handler rejects an empty `Symbols` slice with `CodeInvalidArgument` (mirror the `GetFundamentalsMulti` empty-input test if one exists; otherwise add it).

**Verification**:
```bash
cd services/xstockstrat-marketdata && GOWORK=off go test ./internal/... -race -count=1 -run 'GetLatestQuotes' && GOWORK=off golangci-lint run --modules-download-mode=mod
```
The `@AC-3` test shows exactly one upstream fetch under concurrency; the `@AC-4` test shows the absent symbol is omitted. New logic is in coverage-excluded packages — no threshold; behavioral pass is sufficient.

---

### Step 5 — service: switch portfolio's four read sites to the batch call

**Status**: `done`
**Service**: `xstockstrat-portfolio`
**Files**:
- `services/xstockstrat-portfolio/internal/service/portfolio_service.go` — modify (`enrichPositions`, `GetPnL`, `broadcastSnapshot`, `checkRiskLimits`)

**Reviewers**: `xstockstrat-portfolio` owner — P&L accuracy, position snapshot consistency, concurrent write safety

**Codebase Evidence**:
- Client already wired + header-propagating (no new outbound wiring): `marketdata marketdatav1.MarketDataServiceClient` field `portfolio_service.go:42`; dialed `mdConn, err := grpc.NewClient(cfg.MarketDataEndpoint, ..., grpc.WithChainUnaryInterceptor(middleware.UnaryClientInterceptor))` `:113`; constructed `marketdata: marketdatav1.NewMarketDataServiceClient(mdConn)` `:127`. `middleware.UnaryClientInterceptor` forwards `x-user-id`/`x-access-scope`/`x-trace-id`, so the new `GetLatestQuotes` call on the same client propagates headers with **no** new wiring (`docs/patterns/header-propagation.md` Go interceptor pattern; `internal/middleware/propagation.go`).
- Site 1 — `enrichPositions` `:324-341`: **skips broker-valued positions before fetching** (`if p.CurrentPrice > 0 { continue }` `:326`), then per-position `GetLatestQuote` `:329`, mid `price := (quote.AskPrice + quote.BidPrice) / 2` `:334`, `continue` on error `:331` / on `price <= 0` `:336`, else `enrichPosition(p, quote.AskPrice, quote.BidPrice)` `:339`. **Batch only the `CurrentPrice==0` subset** — a full-set batch would overwrite broker-authoritative mark-to-market (breaks `@AC-12/157` short MtM, `@AC-7` ListPositions↔ListPortfolios parity).
- Site 2 — `GetPnL` `:522-527`: unconditional loop, `price := (quote.AskPrice + quote.BidPrice) / 2` `:525`, `unrealized += (price - p.AvgEntryPrice) * p.Qty` — **full** symbol set.
- Site 3 — `broadcastSnapshot` `:692-698`: unconditional, `price := (quote.AskPrice + quote.BidPrice) / 2` `:695`, `equity += price * p.Qty` — **full** set.
- Site 4 — `checkRiskLimits` `:748-757`: unconditional, `price := (quote.AskPrice + quote.BidPrice) / 2` `:753`, rebuilds `posValues[p.Symbol] = price * p.Qty` + `totalValue` feeding the **concentration** check `:760-767`. Feature 172's drawdown block `GetAccountDrawdowns` + `evaluateDrawdowns` `:768-773` sits **after** the loop and is kept **verbatim**.
- The `(AskPrice + BidPrice) / 2` formula is **byte-identical** across all four sites (`:334`, `:525`, `:695`, `:753`) — preserve it exactly (C-10(b) parity; fails.md:38, PR#735).
- Missing-quote contract to preserve: absence of a symbol in the batch map → the same `continue`/skip the singular error path produced (`:331` err-continue, `:336` price≤0 continue) — never fabricate a price.

**TDD**: `red-green required`.

**Covers**: —

**Instructions**:
1. Add a small private helper `func (s *PortfolioService) latestQuotesFor(ctx context.Context, symbols []string) map[string]*marketdatav1.Quote` that calls `s.marketdata.GetLatestQuotes(ctx, &marketdatav1.GetLatestQuotesRequest{Symbols: symbols})` **once** and re-keys `resp.Quotes` by `q.Symbol` into a map. On RPC error, log a warn and return an **empty** map (so every symbol is then treated as "missing" — the same neutral outcome as N failing singular calls; assert this whole-call equivalence in Step 6). Do not zero-fill.
2. **`enrichPositions`** — before the loop, collect the symbols of **only** `CurrentPrice==0` positions (preserve the `:326` skip), call `latestQuotesFor` once, then loop: `quote, ok := quotes[p.Symbol]`; if `!ok` → `continue` (same as the old error skip); else apply the **unchanged** `price := (quote.AskPrice + quote.BidPrice) / 2`, `price <= 0` skip, and `enrichPosition(p, quote.AskPrice, quote.BidPrice)`.
3. **`GetPnL`** — collect all position symbols, one `latestQuotesFor`, then fold `unrealized` using the same map lookup + byte-identical mid formula; a missing symbol contributes nothing (matches the old `if err == nil` guard `:524`).
4. **`broadcastSnapshot`** — same collect-then-lookup pattern for `equity`.
5. **`checkRiskLimits`** — collect all position symbols, one `latestQuotesFor`, rebuild `posValues[p.Symbol] = price * p.Qty` and `totalValue` **identically** from the map (missing symbol → not added, as before). **Do not touch** the concentration check (`:760-767`) or 172's drawdown block (`:768-773`) — leave both verbatim.
6. Preserve the `(quote.AskPrice + quote.BidPrice) / 2` expression **character-for-character** at all four sites.

**Verification**:
```bash
cd services/xstockstrat-portfolio && GOWORK=off go build ./... && GOWORK=off golangci-lint run --modules-download-mode=mod
```
Compiles and lints. Behavioral parity is Step 6.

---

### Step 6 — test: portfolio batch parity + null-not-zero

**Status**: `done`
**Service**: `xstockstrat-portfolio`
**Files**:
- `services/xstockstrat-portfolio/internal/service/portfolio_service_test.go` — create (or add to an existing service test file), including a new in-package `MarketDataServiceClient` stub

**Reviewers**: `xstockstrat-portfolio` owner — P&L accuracy, snapshot consistency

**Codebase Evidence**:
- **No marketdata stub exists** — portfolio service tests construct the servicer as a struct literal (`portfolio_risk_test.go:126`, `watchlist_service_test.go:271` per recon) and none injects a `marketdatav1.MarketDataServiceClient`. A stub must be authored (design § Open Risks). It must implement the full generated `MarketDataServiceClient` interface (now including `GetLatestQuotes`); most methods can return `nil, nil` — only `GetLatestQuotes` (and, for the parity assertion, a counting `GetLatestQuote`) carry behavior.
- Site formula being asserted: `(quote.AskPrice + quote.BidPrice) / 2` at `portfolio_service.go:334/525/695/753`.
- Coverage note: new logic is in `internal/service` (coverage-excluded per the Go `-coverpkg` filter) — **no threshold**; red-green behavioral parity is the gate.

**TDD**: `red-green required` — the stub asserts a single `GetLatestQuotes` call; against the pre-Step-5 tree the code still calls per-position `GetLatestQuote`, so the count assertion fails.

**Covers**: `AC-1, AC-4`

**Instructions**:
1. Author a `stubMarketData` implementing `marketdatav1.MarketDataServiceClient` with two counters: `getLatestQuotesCalls` and `getLatestQuoteCalls`. `GetLatestQuotes` returns a caller-configured partial `[]*Quote` (omit a designated `NOQUOTE` symbol); `GetLatestQuote` increments its counter (should stay 0 after Step 5).
2. **`@AC-1` one batched call** — build a servicer with ~30 `CurrentPrice==0` positions, run the read path that calls `enrichPositions` (e.g. `ListPositions` or `enrichPositions` directly), assert `getLatestQuotesCalls == 1` and `getLatestQuoteCalls == 0`, and that each enriched position's price equals the value the serial mid-formula would produce for its stubbed quote.
3. **`@AC-4` missing-quote parity** — include a `NOQUOTE` position (`CurrentPrice==0`) the stub omits from the batch response; assert the position is left **unenriched** (its `CurrentPrice`/mark stays at the pre-enrich neutral value, no zero price or zero P&L written) — identical to the singular error-skip outcome.
4. **Cross-path formula parity (C-10(b))** — assert the mid `(Ask+Bid)/2` result is identical whether reached via the batch map or a reference serial computation, across the `enrichPositions` and `checkRiskLimits` sites (guards the PR#735 scar, fails.md:38).
5. **Whole-call error equivalence** — configure the stub's `GetLatestQuotes` to return an error; assert every position is treated as missing (skipped), matching N failing singular calls — no fabricated values.

**Verification**:
```bash
cd services/xstockstrat-portfolio && GOWORK=off go test ./internal/service/... -race -count=1 && GOWORK=off golangci-lint run --modules-download-mode=mod
```
All parity/null-not-zero assertions pass; `getLatestQuoteCalls == 0` proves the fan-out is gone. Coverage-excluded package — no threshold.

---

### Step 7 — service: collapse `ListWatchlists` bindings into one ANY-array query

**Status**: `done`
**Service**: `xstockstrat-portfolio`
**Files**:
- `services/xstockstrat-portfolio/internal/repository/watchlist_repo.go` — modify (`ListByUser` + new batched binding read; retire the per-watchlist `listBindings` loop call)

**Reviewers**: `xstockstrat-portfolio` owner — watchlist read correctness, per-symbol binding provenance

**Codebase Evidence**:
- The 1+N loop: `ListByUser` `watchlist_repo.go:104`; after loading the page (`pageSize+1` lookahead, `:113`), it calls `binds, err := r.listBindings(ctx, wl.WatchlistId)` **per watchlist** `:133`, sets `wl.Bindings = binds` `:137` and `wl.Symbols = bindingSymbols(binds)` `:138`, and only **then** truncates the lookahead row (`:142-145`).
- `listBindings` `:395-418`: `SELECT symbol, strategy_id, source FROM portfolio.watchlist_symbols WHERE watchlist_id = $1 ORDER BY symbol ASC`; scans `source int16` → `portfoliov1.WatchlistEntrySource(source)`, builds `*portfoliov1.WatchlistBinding{Symbol, StrategyId, Source}` `:411-415`. Preserve these exact field mappings.
- `ANY`-array precedent already in this file: `WHERE watchlist_id = $1 AND symbol = ANY($2)` `:328` (pgx array param shape).
- Scope guard: `ListByUser` is `x-user-id`-scoped and disjoint from `ListAllWatchlistSymbols` (the authz-gated cross-user union, `@AC-2/154`) — **do not touch** that path (design § Business Rules Touched).

**TDD**: `red-green required`.

**Covers**: —

**Instructions**:
1. In `ListByUser`, **truncate the lookahead first**: after loading `wls` (the `pageSize+1` rows) and computing `nextToken`, drop the extra row so `wls` holds only the returned page — then batch bindings over exactly that page's IDs (design: over only the paginated page's watchlist IDs, excluding the `+1` lookahead).
2. Add a private `func (r *WatchlistRepo) bindingsByWatchlist(ctx context.Context, watchlistIDs []string) (map[string][]*portfoliov1.WatchlistBinding, error)` running **one** query:
   ```sql
   SELECT watchlist_id, symbol, strategy_id, source
   FROM portfolio.watchlist_symbols
   WHERE watchlist_id = ANY($1)
   ORDER BY watchlist_id, symbol ASC
   ```
   Scan into a `map[watchlistID][]*WatchlistBinding`, reusing `listBindings`' exact per-row mapping (`source int16` → `WatchlistEntrySource`, `Symbol`/`StrategyId`/`Source`). Preserve per-watchlist `ORDER BY symbol` by ordering `watchlist_id, symbol`.
3. Replace the per-watchlist loop (`:132-139`) with: build the ID slice from the truncated `wls`, one `bindingsByWatchlist` call, then assign `wl.Bindings = m[wl.WatchlistId]` (nil-safe → empty slice) and `wl.Symbols = bindingSymbols(wl.Bindings)` (keep the existing `//nolint:staticcheck` deprecated-mirror comment `:138`).
4. Leave `listBindings` in place only if another caller uses it (grep first); if `ListByUser` was its sole caller, remove it to avoid an orphan (surgical — do not touch unrelated code).

**Verification**:
```bash
cd services/xstockstrat-portfolio && GOWORK=off go build ./... && GOWORK=off golangci-lint run --modules-download-mode=mod
grep -n "listBindings\|bindingsByWatchlist" services/xstockstrat-portfolio/internal/repository/watchlist_repo.go
```
Compiles; the per-watchlist `listBindings` call inside `ListByUser` is gone. Behavioral parity is Step 8.

---

### Step 8 — test: watchlist bindings single-query parity

**Status**: `done`
**Service**: `xstockstrat-portfolio`
**Files**:
- `services/xstockstrat-portfolio/internal/repository/watchlist_repo_test.go` — create (or add to an existing repository test file)

**Reviewers**: `xstockstrat-portfolio` owner — watchlist read correctness

**Codebase Evidence**:
- Field mapping under test: `WatchlistBinding{Symbol, StrategyId, Source}` from `listBindings` `watchlist_repo.go:411-415`; `Source` is `portfoliov1.WatchlistEntrySource(int16)`.
- Repo tests exist and exercise a DB seam: `internal/repository/portfolio_repo_test.go`, `offline_realized_test.go` — follow their harness (pgx pool / query-count instrumentation) for the query-count assertion.
- Coverage note: `internal/repository` is coverage-excluded (Go `-coverpkg` filter) — **no threshold**; the parity assertion is the gate.

**TDD**: `red-green required` — assert the binding read issues **one** query for a multi-watchlist page; against the pre-Step-7 tree it issues N.

**Covers**: `AC-2`

**Instructions**:
1. Following the existing repository test harness, seed a user with ≥2 watchlists whose `watchlist_symbols` rows carry distinct `symbol`/`strategy_id`/`source` per watchlist.
2. **`@AC-2` single query** — instrument or count binding-read queries (e.g. a query-counting pool wrapper, or assert one round-trip); call `ListByUser` and assert the bindings are read with **one** `ANY`-array query, not one per watchlist.
3. **Field parity** — assert each returned watchlist's `Bindings` (and the deprecated `Symbols` mirror) match the per-watchlist result field-for-field: `Symbol`, `StrategyId`, and `Source` are correctly grouped to the right `watchlist_id` and ordered by symbol (`@AC-1/2/167` preservation).
4. If the repo test harness is DB-backed and unavailable offline, note it and assert the grouping/mapping via a table-driven test over `bindingsByWatchlist`'s row-to-map logic instead; keep the query-count intent recorded.

**Verification**:
```bash
cd services/xstockstrat-portfolio && GOWORK=off go test ./internal/repository/... -race -count=1 && GOWORK=off golangci-lint run --modules-download-mode=mod
```
One binding query per `ListByUser` page; bindings match the per-watchlist result. Coverage-excluded package — no threshold.

---

## Deviation Log

### Steps 1–2 — proto codegen via Docker (CI-equivalent fallback)

**Disposition**: CI-equivalent fallback. `buf` is not on the host; ran `./scripts/localenv-setup.sh`
(builds the pinned `Dockerfile.codegen` and runs `buf lint` + `buf breaking --against main-dev` +
`buf generate` + grpcio-tools + the TS `tsc` compile inside the container — all green, exit 0). The
`git diff packages/proto/gen/` is limited to `marketdata/v1` (Go pb/grpc/connect, Python, TS + dist),
matching CI's `proto-freshness` stale-stub check; `buf lint`/`breaking` also re-run in CI's proto-lint
job. Step 1's `buf breaking` was run against `main-dev` (the container default) rather than the
feature branch named in the step — both prove additivity, and main-dev is the CI-relevant base.

### Steps 3–4 — golangci-lint version fallback + a no-DB seam + one added test file

**Disposition (lint):** the host's `golangci-lint` is **v2.5.0** (built with go1.25), which refuses a
go1.27 target (`config: the Go language version (go1.25) ... is lower than the targeted Go version
(1.27.0)`); the repo pins **v2.13.1**, which CI runs. Verified locally with `GOWORK=off go build
./...` + `go vet ./...` + `gofmt -l` (all clean) instead; the pinned linter runs in CI's `Go lint and
test` job. Applies to Steps 3, 5, 7 identically.

**Disposition (no-DB seam):** `MarketDataService.GetLatestQuotes` guards its two `s.repo` calls with
`if s.repo != nil` so the `@AC-3` single-flight coalescing + `@AC-4` null-not-zero merge are unit-
testable without a database (the spec anticipated this — "gate this assertion behind the seam the
service exposes for the cold set"). In production `s.repo` is always non-nil; the guard is a no-op
there. The DB-backed warm read (`GetLatestQuotesBatch`) is covered by CI/integration.

**Disposition (added file):** Step 4 instruction #4 (handler rejects empty `Symbols` with
`CodeInvalidArgument`) required a handler-package test, but no `internal/handler/*_test.go` existed.
Added `internal/handler/marketdata_handler_test.go` (one test, `svc` nil since the guard rejects
first) — one file beyond the step's declared `Files`, recorded here.

### Step 8 — mockable `db` field added to WatchlistRepo (offline @AC-2 via pgxmock)

**Disposition**: enabling change, precedented. The repo test harness is **pgxmock** (mock pool, works
offline), not a live DB — but `WatchlistRepo.pool` was a concrete `*pgxpool.Pool`, unmockable. Added a
`db queryRower` field (set to `pool` in `NewWatchlistRepo`) mirroring the identical pattern
`PortfolioRepo` already carries, and routed `bindingsByWatchlist` through it, so the `@AC-2`
single-ANY-array-query assertion runs offline via pgxmock (a real query-count test, not the spec's
table-driven fallback). One non-test-file change (`watchlist_repo.go`) beyond Step 8's declared
`Files` (test only) — recorded here. `ListByUser`'s main query and the retained single-getter
`listBindings` still use `r.pool` (untouched).
