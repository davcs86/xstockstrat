# Implementation Spec: fix-grpc-status-mapping

**Status**: `pending`
**Created**: 2026-11-13
**Feature**: `docs/roadmap/features/326-fix-grpc-status-mapping/feature.md`
**Total Steps**: 8
**Feature Branch**: `feature/fix-grpc-status-mapping`

---

## Execution Summary

This spec follows the design.md build order. The marketdata translator and its tests come first,
then the portfolio translator, then the duplicate-name classifier with its test seams, then the agent
test, and the record edits last.

There is no proto, migration, config key, env var or port change (recon.md § Dependencies). There is
no shared Go package (D-4): each service keeps its own `toGRPCError`.

**Grounding.** All Go `path:line` cites were re-read on `origin/feature/fix-grpc-status-mapping` @
`17abb21d` (merge-base `c4fd48b0a` with `origin/main-dev` @ `52f6d5a6`). `git diff --stat
c4fd48b0a origin/main-dev` shows no change to any marketdata or portfolio handler, service,
repository or test file this spec touches, so the Go line numbers hold on `main-dev`.

`services/xstockstrat-agent/app/tools.py` did change on `main-dev` (+27 lines). Agent cites below use
**`origin/main-dev`** line numbers, because `/sdd-execute` merges `origin/main-dev` into the branch
before it starts (`docs/sdd/tree-freshness.md`). `tests/test_watchlist_tools.py` is unchanged on
`main-dev`.

**Scenario coverage (C-15).**

| Scenario | Covered by |
|---|---|
| `@AC-1` | Step 2: connect-code cast table, including the six example rows |
| `@AC-2` | Step 2: handler chain test through the real Internal wrap at `classification_service.go:171` |
| `@AC-3` | Step 4 (gRPC translator `AlreadyExists` row), Step 6 (service tests at all three name-write sites, plus the wire test) and Step 7 (agent surface) |
| `@AC-4` | Step 6: 08006 and plain-error service rows, plus the 08006 wire row |

**Consumer surfaces (C-14).** The product spec has no `## Consumer Surface(s)` section; that
bug-template convention was accepted at context.md:24. design.md §6 settles the two surfaces:

- **Agent `manage_watchlist`.** Step 7 adds a test-only step. `ALREADY_EXISTS` is already in
  `_PASS_THROUGH_CODES`, so the step needs no code change.
- **UI `/insights/watchlists` and `/insights/screener`.** No step. This is a decision, not an
  omission. The BFF forwards the downstream error body unchanged (`insightsBff.ts:136`,
  `bffShared.ts:199-209`), and the page renders `.message` (`watchlists/page.tsx:119-120`). Step 8
  records this disposition and the user-visible message change in context.md.

**Coverage threshold (C-08).** All new Go logic lands in `internal/handler/` and `internal/service/`.
The CI coverage command excludes both packages (`grep -Ev '/(cmd|handler|repository|telemetry|service)'`),
so no threshold applies to this logic. The targeted `go test -run` commands are the behavioral
verification, and the CI coverage command still runs so the service total does not regress.

**Not edited here.** The findings rows that describe these defects are left for the next
`/context-constitution` refresh, which owns those logs:

- `services/xstockstrat-marketdata/docs/context-constitution-findings.md:23`
- `services/xstockstrat-portfolio/docs/context-constitution-findings.md:25`

## Step Dependencies

- **Steps 1 and 2 land together** (§C: Step 1 changes `toGRPCError`'s signature in a package that
  compiles `_test.go`, and Step 2's table test calls the new `toGRPCError(ctx, err)`; otherwise the
  RED would be a compile failure). Surface: backend (marketdata).
- **Steps 5 and 6 land together** (§C: Step 6 adds tests that reference the unexported
  `watchlistNameUniqueIdx` through the `export_test.go` alias, and Step 5 creates that symbol).
  Surface: backend (portfolio).
- Step 4 [test] covers Step 3 [service]. This is the default pairing: Step 3 passes its own
  Verification on its own, because the existing `TestToGRPCError` rows are preserved by the cast.
- **Step 6 requires Step 3.** `TestWire_CreateWatchlistDuplicateName_AC3` asserts `codes.AlreadyExists`
  through portfolio's `toGRPCError`, which maps `CodeAlreadyExists` only after Step 3 (recon.md
  Risks, `portfolio_handler.go:443-464`).
- **Step 7 (agent surface)** has no backend dependency. It is a characterization test of existing
  pass-through behavior, so its red is N/A by the tdd-gate's stated escape (see Step 7).
- **Step 8 runs after Steps 2, 6 and 7.** The rewording of AC-2 matches the server-side assertion in
  Step 2, and Step 8 records results from the earlier steps.
- **No UI step (C-14 decision, design.md §6).** The disposition is recorded in Step 8.
- **Named follow-ups (deferred, not in scope).** Step 8 records both; file them through
  `scripts/sdd-allocate-feature-number.py`:
  - `fix-trading-grpc-status-mapping`: the identical collapse at
    `services/xstockstrat-trading/internal/handler/trading.go:223-237`.
  - `fix-portfolio-grpc-ctx-mapping`: ctx-aware symmetry for portfolio's translator (D-6).
- **Promotion at the integration PR (C-16).** Promote 326 `@AC-1`/`@AC-2` into
  `services/xstockstrat-marketdata/acceptance/` and `@AC-3`/`@AC-4` into
  `services/xstockstrat-portfolio/acceptance/`. Extend the durable `@AC-4 @feature-148`
  "manage_watchlist create makes a new list owned by the caller"
  (`services/xstockstrat-agent/acceptance/mcp-watchlist-tools.feature:33-34`) with the duplicate-name
  case. That tag number was captured at this spec, which closes the design Open Risk.
- **Peer-merge overlap (design Open Risk).**
  - `marketdata_handler.go` is shared with fix-marketdata-miss-path-noise, fix-vendor-key-in-url and
    fix-mcp-deadline-budget.
  - `portfolio_service.go` is shared with 311, 312, 315 and 317.
  - After each peer merge, at the final integration PR, re-run:
    - `@AC-5`/`@AC-7` f254 (`services/xstockstrat-marketdata/acceptance/fix-marketdata-secret-exposure.feature`);
    - Step 2's tests;
    - `TestWire_CreateWatchlistDuplicateName_AC3`.

---

### Step 1 — service: marketdata `toGRPCError(ctx, err)` with cast, inbound-ctx and Internal branches

**Status**: `pending`
**Service**: `xstockstrat-marketdata`
**Files**:
- `services/xstockstrat-marketdata/internal/handler/marketdata_handler.go` — modify

**Reviewers**: `xstockstrat-marketdata` owner — OHLCV ingestion integrity, TimescaleDB hypertable partitioning, Alpaca feed idempotency

**Codebase Evidence**:
- `grep -n "toGRPCError" services/xstockstrat-marketdata -r`:
  - the definition is at `internal/handler/marketdata_handler.go:513`;
  - the 19 adapter call sites are at `:316, :324, :332, :340, :348, :356, :364, :372, :380, :388,
    :396, :404, :412, :420, :468, :476, :484, :492, :500`, each of the form
    `return nil, toGRPCError(err)` inside a `func (a *grpcMarketDataAdapter) X(ctx context.Context, req …)`;
  - no `_test.go` calls it (the only test hit is a comment at
    `internal/service/marketdata_service_test.go:4281`).
- The current body (`:513-532`) is
  `var connectErr *connect.Error; if errors.As(err, &connectErr) { switch connectErr.Code() { … six cases … } }; return status.Error(codes.Internal, err.Error())`.
- The imports `context`, `errors`, `connect`, `codes` and `status` are already present (`:3-15`).
- Internal wraps that branch (b) covers with no per-site edits:
  - the handler wraps `:90, :102, :114, :126, :202, :228`;
  - the `forwardConnectErr` fallthrough at `:299`;
  - the `classification_service.go` wraps `:120, :140, :171` (`return nil, connect.NewError(connect.CodeInternal, err)`);
  - the raw-return handlers, for example `GetSectorHistory` at `:187-193`, which returns `err` unwrapped.
- Detached budgets that must stay `INTERNAL` (R-2): `context.WithoutCancel` at
  `internal/service/marketdata_service.go:672, :915, :946`.
- **R-6 bounded grep (result for Step 8):**
  - `grep -rn 'connect.CodeUnauthenticated\|CodeUnimplemented\|CodeAborted\|CodeAlreadyExists\|CodeDeadlineExceeded\|CodeCanceled\|CodeOutOfRange\|CodeDataLoss' services/xstockstrat-marketdata --include=*.go | grep -v _test`
    returns no hits, so no marketdata site emits a newly passed-through code. In particular, the UI
    `Unauthenticated` refresh/redirect risk named in recon.md cannot fire.
  - A non-test grep for `StatusCode.INTERNAL|codes.Internal|Code.Internal` across `services/`
    found no caller that branches on `INTERNAL` from a marketdata RPC. The hits are:
    - telemetry label sets (`indicators/app/telemetry.py:343-350`, `analysis/app/telemetry.py:383-391`);
    - the UI stream retry set `src/lib/streamBackoff.ts:13-22`, which already lists `Internal`,
      `DeadlineExceeded` and `Canceled` alike, and serves streams, which `toGRPCError` does not handle;
    - `context.abort` producers.

**Lands with**: `Step 2`

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. Change the signature to `func toGRPCError(ctx context.Context, err error) error` and implement
   three branches in this order (design.md §1, D-1/D-2/D-8/D-11):
   - **(a)** `var connectErr *connect.Error`. If `errors.As(err, &connectErr)` and
     `connectErr.Code()` is neither `connect.CodeInternal` nor `connect.CodeUnknown`, return
     `status.Error(codes.Code(connectErr.Code()), connectErr.Message())`. This is the generic numeric
     cast, which replaces the six-case switch: connect-go codes 1-16 equal grpc-go's numerically, and
     Step 2 pins that.
   - **(b)** Otherwise, `switch ctx.Err()`:
     - `context.DeadlineExceeded` returns `status.Error(codes.DeadlineExceeded, "deadline exceeded")`;
     - `context.Canceled` returns `status.Error(codes.Canceled, "request canceled")`.

     These are fixed strings. Do **not** use `err.Error()`, `status.FromContextError` (R-4) or
     `errors.Is(err, context.*)` (R-1/R-2). Add no log line and no span attribute carrying error text
     (O-9/D-8): the wrapped chain can hold a vendor URL with `apikey=`.
   - **(c)** Otherwise, `return status.Error(codes.Internal, err.Error())`, unchanged from today
     (`:531`). This preserves `@AC-53` strict.
2. Change all 19 adapter call sites listed in the evidence from `toGRPCError(err)` to
   `toGRPCError(ctx, err)`. Each enclosing method already has the inbound `ctx` parameter, and the
   compiler enforces that no site is missed.
3. Keep a doc comment of at most 2 lines on `toGRPCError` that states two constraints: the caller
   must pass the **inbound** ctx, and a genuine Internal failure that coincides with an expired
   caller ctx deliberately reports the fixed context text (the design Open Risk "Masked
   diagnostics"). Do not narrate the history.
4. **Out of scope (D-12, state it in the PR body, not as a code comment).** This fix does not change
   any of the following, and they must not be read as fixed:
   - on a live ctx, branch (c) and the blanket-Internal handler wraps (`:90/:102/:114/:126/:202/:228`)
     still carry `err.Error()` text;
   - the streaming handlers' raw `grpcStream.Context().Err()` returns (`:440`, `:460`);
   - the body of `forwardConnectErr` (`:294-300`).
5. Within the Steps 1+2 unit, capture RED in this order:
   1. Apply the mechanical signature change and the 19 call-site edits, with branch (a) still the
      old six-case switch and the ctx unused.
   2. Write Step 2's tests and run them. RED is behavioral: the AC-1 rows return `Internal`, and the
      AC-2 chain test returns `Internal`.
   3. Implement branches (a)-(c), then capture GREEN.

**Verification**:
```bash
cd services/xstockstrat-marketdata && GOWORK=off go build ./... && GOWORK=off go vet ./internal/handler/ \
  && test "$(grep -c 'toGRPCError(ctx, err)' internal/handler/marketdata_handler.go)" -eq 19 \
  && ! grep -n 'toGRPCError(err)' internal/handler/marketdata_handler.go \
  && ! grep -n 'FromContextError' internal/handler/marketdata_handler.go
```
(The full green run is Step 2's Verification, which runs together with this step's.)

---

### Step 2 — test: marketdata translator table (AC-1, R-2, @AC-53, f254) and the AC-2 handler chain test

**Status**: `pending`
**Service**: `xstockstrat-marketdata`
**Files**:
- `services/xstockstrat-marketdata/internal/handler/marketdata_handler_test.go` — modify

**Reviewers**: `xstockstrat-marketdata` owner — OHLCV ingestion integrity, TimescaleDB hypertable partitioning, Alpaca feed idempotency

**Codebase Evidence**:
- `marketdata_handler_test.go` is `package handler`. Its imports are `context`, `testing`, `connect`
  and `marketdatav1`, and it has one test, `TestGetLatestQuotes_EmptySymbolsRejected` (`:15`).
- Handler construction: `NewMarketDataHandler(svc *service.MarketDataService)` (`marketdata_handler.go:27`)
  and `func (h *MarketDataHandler) GRPCHandler() *grpcMarketDataAdapter` (`:303`).
- The adapter's `GetSectorHistory` passes through `toGRPCError`. The handler's `GetSectorHistory`
  (`:187-193`) returns the service error raw.
- The classification seam is in `internal/service/classification_service.go`:
  - `func (s *MarketDataService) SetClassification(store classificationStore, src sectorSource, budget fmpBudget)` (`:52`).
  - `classificationStore` has 5 methods (`:22-28`): `CurrentSectors`, `SectorAsOf`, `SectorHistory`
    returning `([]repository.ClassificationRow, error)`, `SeedEpoch`, and `ApplyObservation`
    returning `(classification.Action, error)`.
  - `markClassDemand` initializes its map lazily (`:67-72`), so a zero-value `&service.MarketDataService{}`
    is safe. `class classificationState` is a value field (`marketdata_service.go:100`).
  - `GetSectorHistory` returns early on an empty symbol set (`:151-154`), calls
    `s.class.store.SectorHistory(ctx, …)`, and wraps the error at `:171` with
    `connect.NewError(connect.CodeInternal, err)`.
- Import reachability (this closes the design's "uncompiled assumption"):
  - `type ClassificationRow struct` is at `internal/repository/classification_repo.go:21`, and
    `type Action int` is at `internal/classification/sector.go:68`.
  - Both are `internal/` packages of the same module. Neither imports `internal/handler`
    (`grep -rln internal/handler internal/repository internal/classification` returns no hits), so
    there is no import cycle.
- `fakeClassStore` (`internal/service/classification_service_test.go:18`) is in package `service`
  and cannot be reached from `handler`, so a local stub is used (D-13; moving it was rejected as R-8).

**Lands with**: `Step 1`

**TDD**: `red-green required`

**Covers**: `AC-1, AC-2`

**Instructions**:
1. Add a minimal local stub to `marketdata_handler_test.go`: `type sectorHistoryStub struct{}` with
   all 5 `classificationStore` methods.
   - `SectorHistory(ctx, …)` returns `nil, ctx.Err()`.
   - The other four return zero values. They are never reached.

   Import `internal/repository` and `internal/classification` only for those signatures. The stub is
   a test double, not domain data (C-13 N/A), and it has a single consumer.
2. `TestToGRPCError_ConnectCodeCast` (AC-1, D-1). Use a live `context.Background()`.
   - **AC-1 example rows:** `connect.NewError(connect.Code<X>, errors.New("x"))`, where `<X>` is each
     of `DeadlineExceeded`, `Canceled`, `AlreadyExists`, `Unimplemented`, `Unauthenticated` and
     `Aborted`. Assert `status.Code(...)` equals the **named** gRPC constant (`codes.DeadlineExceeded`,
     `codes.Canceled`, `codes.AlreadyExists`, `codes.Unimplemented`, `codes.Unauthenticated`,
     `codes.Aborted`). These rows pin the numbering, so a renumbering fails here (design Open Risk
     "Code numbering").
   - **Loop:** `for c := connect.CodeCanceled; c <= connect.CodeUnauthenticated; c++`. Each code other
     than Internal and Unknown yields `codes.Code(c)` with the message preserved. `CodeInternal` and
     `CodeUnknown` yield `codes.Internal`.
3. `TestToGRPCError_InboundCtx`. Build an expired ctx with
   `context.WithDeadline(context.Background(), time.Now().Add(-time.Second))` and a canceled ctx with
   `WithCancel` followed by `cancel()`. The table rows are:

   | Row | Context | Error | Expected status |
   |---|---|---|---|
   | (i) | expired | `connect.NewError(connect.CodeInternal, context.DeadlineExceeded)` | `codes.DeadlineExceeded`, message exactly `"deadline exceeded"` |
   | (ii) | canceled | `connect.NewError(connect.CodeInternal, errors.New("x"))` | `codes.Canceled`, message exactly `"request canceled"` |
   | (iii) | expired | raw unwrapped `context.DeadlineExceeded` (the raw-return RPC case) | `codes.DeadlineExceeded` |
   | (iv) | expired | `connect.NewError(connect.CodeUnavailable, context.DeadlineExceeded)` | `codes.Unavailable` (`@AC-5`/`@AC-7` f254 preserved) |
   | (v) R-2 pin (D-11) | **live** | `connect.NewError(connect.CodeInternal, context.DeadlineExceeded)` | `codes.Internal` |
   | (vi) `@AC-53` | **live** | `errors.New("live fetch failed")` | `codes.Internal`, `status.Convert(err).Message()` contains `"live fetch failed"` |
   | (vii) D-8 | expired | `connect.NewError(connect.CodeInternal, &url.Error{Op: "Get", URL: "https://vendor.example/v1?apikey=x&token=y", Err: context.DeadlineExceeded})` | the message contains neither `apikey=` nor `token=` |

   The guarantee in row (vii) is scoped to branch (b) only (D-12).
4. `TestGetSectorHistory_AC2_ExpiredCtxDeadlineExceeded` (AC-2, D-5/D-13). Run these steps:
   1. `svc := &service.MarketDataService{}`.
   2. `svc.SetClassification(sectorHistoryStub{}, nil, nil)`.
   3. Call `NewMarketDataHandler(svc).GRPCHandler().GetSectorHistory(expiredCtx, &marketdatav1.GetSectorHistoryRequest{Symbols: []string{"AAPL"}})`.
      `Symbols` must be non-empty to get past `:151-154`.
   4. Assert `status.Code(err) == codes.DeadlineExceeded`. Name the scenario in the failure message:
      "AC-2: handler must return DEADLINE_EXCEEDED, not INTERNAL".

   Do not substitute a socket-level e2e (R-5).
5. New imports: `errors`, `net/url`, `time`, `google.golang.org/grpc/codes`,
   `google.golang.org/grpc/status`, `github.com/xstockstrat/marketdata/internal/service`,
   `…/internal/repository` and `…/internal/classification`. Use the module path as it appears in
   `marketdata_handler.go:12-14` (`github.com/xstockstrat/marketdata/...`).

**Verification**:
```bash
cd services/xstockstrat-marketdata \
  && GOWORK=off go test ./internal/handler/ -race -count=1 -v -run 'TestToGRPCError_ConnectCodeCast|TestToGRPCError_InboundCtx|TestGetSectorHistory_AC2_ExpiredCtxDeadlineExceeded|TestGetLatestQuotes_EmptySymbolsRejected' \
  && GOWORK=off go test ./internal/service/ -race -count=1 -run 'TestBatchGetBars_AC53_|TestBatchGetBars_AC54_|feature254' \
  && GOWORK=off COVERPKGS=$(go list ./... | grep -Ev '/(cmd|handler|repository|telemetry|service)(/|$)' | tr '\n' ',' | sed 's/,$//') \
  && go test ./... -race -count=1 -coverprofile=coverage.out -covermode=atomic -coverpkg="${COVERPKGS}" \
  && go tool cover -func=coverage.out | grep "^total:" \
  && GOWORK=off golangci-lint run --modules-download-mode=mod
```
Confirm the total is at or above 40%. The new logic is in an excluded package (`handler/`), so no
coverage threshold applies to it, and the named tests are the behavioral verification. C-13: the
stub and the URL literal each have one consumer, so they stay inline.
`grep -rn "sectorHistoryStub" --include="*_test.go" services/xstockstrat-marketdata` must show one
declaration site.

---

### Step 3 — service: portfolio `toGRPCError` numeric cast

**Status**: `pending`
**Service**: `xstockstrat-portfolio`
**Files**:
- `services/xstockstrat-portfolio/internal/handler/portfolio_handler.go` — modify

**Reviewers**: `xstockstrat-portfolio` owner — P&L calculation accuracy, position snapshot consistency, concurrent write safety

**Codebase Evidence**:
- `grep -n "func toGRPCError" services/xstockstrat-portfolio/internal/handler/portfolio_handler.go`
  finds it at `:443`. Its body (`:443-464`) is a seven-case switch (InvalidArgument, NotFound,
  PermissionDenied, Unavailable, FailedPrecondition, DeadlineExceeded, Canceled) followed by
  `return status.Error(codes.Internal, err.Error())`. It has **no `CodeAlreadyExists` case**
  (recon.md Risks).
- `grpcPortfolioAdapter.CreateWatchlist` (`:323-328`) returns `toGRPCError(err)`, and the handler's
  `CreateWatchlist` (`:166-172`) passes the service error through unchanged.
- `toGRPCError` has 24 call sites in `internal/handler/*.go`. The signature is unchanged, so none of
  them is edited (D-6).
- GetPnL keeps its ctx-first `classifyGetPnLError` (`:427-441`), which is untouched.

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. Replace the switch with the same cast as Step 1 branch (a), without the ctx parameter (D-6):
   - if `errors.As(err, &connectErr)` and the code is neither `connect.CodeInternal` nor
     `connect.CodeUnknown`, return `status.Error(codes.Code(connectErr.Code()), connectErr.Message())`;
   - otherwise keep `return status.Error(codes.Internal, err.Error())` unchanged.
2. The existing DeadlineExceeded and Canceled mappings are preserved by the cast. Do not add a ctx
   parameter: that is the named follow-up `fix-portfolio-grpc-ctx-mapping`.
3. RED comes from Step 4's new `AlreadyExists` and `Aborted` rows, which return `Internal` on the
   pre-implementation tree.

**Verification**:
```bash
cd services/xstockstrat-portfolio && GOWORK=off go build ./... \
  && GOWORK=off go test ./internal/handler/ -race -count=1 -run 'TestToGRPCError|TestClassify'
```

---

### Step 4 — test: portfolio `TestToGRPCError` AlreadyExists, Aborted and Unknown rows

**Status**: `pending`
**Service**: `xstockstrat-portfolio`
**Files**:
- `services/xstockstrat-portfolio/internal/handler/portfolio_handler_test.go` — modify

**Reviewers**: `xstockstrat-portfolio` owner — P&L calculation accuracy, position snapshot consistency, concurrent write safety

**Codebase Evidence**:
- `func TestToGRPCError(t *testing.T)` is at `portfolio_handler_test.go:85-105`. It is a
  `cases := []struct{ name string; err error; want codes.Code }` table asserted with
  `status.Code(toGRPCError(c.err))`. Its rows run from `:91` to `:98`, the last being
  `{"non-connect error", errors.New("boom"), codes.Internal}`.
- The imports `errors`, `connect`, `codes` and `status` are present (`:3-16`).

**TDD**: `red-green required`

**Covers**: `AC-3` (the gRPC translator half: a service `CodeAlreadyExists` must reach the wire as `ALREADY_EXISTS`)

**Instructions**: Append three rows to the `cases` table:
- `{"already exists", connect.NewError(connect.CodeAlreadyExists, errors.New("x")), codes.AlreadyExists}` (AC-3);
- `{"aborted", connect.NewError(connect.CodeAborted, errors.New("x")), codes.Aborted}`;
- `{"unknown stays internal", connect.NewError(connect.CodeUnknown, errors.New("x")), codes.Internal}`.

The last row pins that the cast excludes Unknown, as design.md §2 requires.

**Verification**:
```bash
cd services/xstockstrat-portfolio \
  && GOWORK=off go test ./internal/handler/ -race -count=1 -v -run 'TestToGRPCError' \
  && GOWORK=off COVERPKGS=$(go list ./... | grep -Ev '/(cmd|handler|repository|telemetry|service)(/|$)' | tr '\n' ',' | sed 's/,$//') \
  && go test ./... -race -count=1 -coverprofile=coverage.out -covermode=atomic -coverpkg="${COVERPKGS}" \
  && go tool cover -func=coverage.out | grep "^total:" \
  && GOWORK=off golangci-lint run --modules-download-mode=mod
```
Confirm the total is at or above 40%. The new logic is in an excluded package (`handler/`), so no
threshold applies to it. C-13: no domain data.

---

### Step 5 — service: portfolio `classifyWatchlistWriteErr` at the three name-write sites

**Status**: `pending`
**Service**: `xstockstrat-portfolio`
**Files**:
- `services/xstockstrat-portfolio/internal/service/portfolio_service.go` — modify

**Reviewers**: `xstockstrat-portfolio` owner — P&L calculation accuracy, position snapshot consistency, concurrent write safety

**Codebase Evidence**:
- **Name-write sites.** `grep -n 's.watchlists.Create(\|s.watchlists.UpdatePartial(\|s.watchlists.Update(' internal/service/portfolio_service.go`
  finds three:
  - **CreateWatchlist**: `:2194`, followed by `return nil, connect.NewError(connect.CodeInternal, err)` at `:2196`.
  - **UpdatePartial mask path**: `:2309`. The `errors.Is(err, repository.ErrWatchlistNotFound)`
    check maps to NotFound at `:2311-2313`, and the Internal wrap is at `:2314`.
  - **Legacy replace-all rename**: `:2337`, with the Internal wrap at `:2339`.
- **Idiom to mirror** (recon.md Patterns to REUSE): `classifyConsumerErr` (`:1470-1496`) declares
  `var pgErr *pgconn.PgError` and tests `errors.As(err, &pgErr)`. `pgconn` is already imported
  (`:19`), as are `errors` (`:6`) and `connect` (`:17`).
- **Error wrapping.** The repository wraps with `%w`:
  - `fmt.Errorf("insert watchlist: %w", err)` (`internal/repository/watchlist_repo.go:52`);
  - `"update watchlist: %w"` (`:205`);
  - `"update partial: %w"` (`:258`).

  So `errors.As` reaches the `*pgconn.PgError`.
- **Index name.** `watchlists_user_name_not_system_uidx` is defined only at
  `migrations/011_watchlist_system_managed_source.up.sql:20` (down `:9`). The sibling
  `watchlists_user_system_uidx` (`:26`) is reached through `ON CONFLICT … DO NOTHING`
  (`watchlist_repo.go:70`) and is not matched.

**Lands with**: `Step 6`

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. Add the unexported constant `const watchlistNameUniqueIdx = "watchlists_user_name_not_system_uidx"`
   next to the new function.
2. Add the unexported `func classifyWatchlistWriteErr(err error) error` (D-3):
   - if `var pgErr *pgconn.PgError` and `errors.As(err, &pgErr)` and `pgErr.Code == "23505"` and
     `pgErr.ConstraintName == watchlistNameUniqueIdx`, return
     `connect.NewError(connect.CodeAlreadyExists, errors.New("a watchlist with this name already exists"))`.
     The message is fixed text, so no pgx detail reaches the caller.
   - otherwise return `connect.NewError(connect.CodeInternal, err)`, the same as today.

   It is a sibling of `classifyConsumerErr`. Do **not** touch `classifyConsumerErr` or
   `boundedRetry`: the consumer's 23505 retry/park behavior is `@AC-8` f294.
3. Replace the Internal wrap at each site with `return nil, classifyWatchlistWriteErr(err)`:
   - `:2196` (CreateWatchlist);
   - `:2314` (mask path, after the existing `ErrWatchlistNotFound` check, which stays first);
   - `:2339` (legacy rename).

   No other `CodeInternal` wrap changes.
4. Within the Steps 5+6 unit, capture RED in this order:
   1. Add the `watchlistNameUniqueIdx` constant alone, which has no behavior.
   2. Add Step 6's seams and tests, then run them. RED is behavioral: the AC-3 rows get `Internal`
      where they want `AlreadyExists`, and the wire test gets `codes.Internal`.
   3. Add `classifyWatchlistWriteErr` and the three call-site edits, then capture GREEN.

**Verification**:
```bash
cd services/xstockstrat-portfolio && GOWORK=off go build ./... \
  && test "$(grep -c 'return nil, classifyWatchlistWriteErr(err)' internal/service/portfolio_service.go)" -eq 3
```
(The full green run is Step 6's Verification, which runs together with this step's.)

---

### Step 6 — test: fake-store error seams, export setter and alias, `wireAdapterFor`, service, wire and schema-guard tests

**Status**: `pending`
**Service**: `xstockstrat-portfolio`
**Files**:
- `services/xstockstrat-portfolio/internal/service/watchlist_service_test.go` — modify
- `services/xstockstrat-portfolio/internal/service/export_test.go` — modify
- `services/xstockstrat-portfolio/internal/service/portfolio_grpc_wire_test.go` — modify

**Reviewers**: `xstockstrat-portfolio` owner — P&L calculation accuracy, position snapshot consistency, concurrent write safety

**Codebase Evidence**:
- **Fake store** (`watchlist_service_test.go`, package `service`):
  - `type fakeWatchlistStore struct` is at `:32-44`. Its fields are `byID`, `seq`, `allSymbols`,
    `allSymbolsErr`, `lastIntent`, `addSymbolsCnt` and `pruneResult`.
  - The methods to change are `Create` (`:82-89`), `UpdatePartial` (`:93-108`, which returns
    `repository.ErrWatchlistNotFound` when the ID is absent) and `Update` (`:156-164`).
  - The helpers are `newSvc` (`:329`), `ctxWithUser` (`:334`), `wideCaps()` (`:416`) and
    `seedWatchlist(store, id, userID, systemManaged, binds)` (`:746`).
  - The mask-path test shape to copy is `TestUpdateWatchlist_MaskNameOnly_LeavesOthersUntouched`
    (`:1177-1207`), which uses `UpdateMask: &fieldmaskpb.FieldMask{Paths: []string{"name"}}`.
  - Assertions use `connect.CodeOf(err)` (as at `:406`).
- **UpdateWatchlist ownership.** `UpdateWatchlist` calls `s.loadOwned(ctx, userID, …)` first
  (`portfolio_service.go:2282`), so the update rows must seed an owned list.
- **Export file** (`export_test.go`, package `service`):
  - `NewWireTestService(t, ledger, positions...)` hard-wires `svc.watchlists = newFakeStore()` (`:23`).
  - The existing aliases block is `var ( CtxWithUser = ctxWithUser; Guard = guard )` (`:35-38`).
  - The file header (`:3-4`) states the rule: an in-package `_test.go` never imports `internal/handler`.
- **Wire harness** (`portfolio_grpc_wire_test.go`, package `service_test`):
  - `wireAdapter(t, l, positions...)` (`:23-26`) returns
    `handler.NewPortfolioHandler(service.NewWireTestService(t, l, positions...)).GRPCHandler()`,
    which gives the test no service handle.
  - `wantCode(t, err, want)` is at `:35`.
  - `wireAdapter(` has 8 references across `internal/service/*_test.go`. Its signature is
    unchanged, so none of them is edited.
  - The test shape to mirror is `TestWire_DeleteSystemManagedWatchlist_F127AC7` (`:77-86`), which
    uses `&testdata.Ledger{}` and `service.CtxWithUser(t, "u-1")`.
- **CreateWatchlist reaches the store with no marketdata fake.** `refuseUnservable` returns early when
  `len(bindings) == 0 || s.marketdata == nil` (`portfolio_service.go:569`), so a name-only
  CreateWatchlist gets to `Create`.
- **Binding-table constraint.** The other 23505 source is the `portfolio.watchlist_symbols` primary
  key (`PRIMARY KEY (watchlist_id, symbol)`, `migrations/007_watchlists.up.sql:16-20`). Postgres
  auto-names it `watchlist_symbols_pkey`. It is reached through `insertBindingsTx`
  (`watchlist_repo.go:54`).
- **Precedent for a PgError literal:** `&pgconn.PgError{Code: "23505"}` (`portfolio_sync_retry_test.go:162`).

**Lands with**: `Step 5`

**TDD**: `red-green required`

**Covers**: `AC-3, AC-4`

**Instructions**:
1. **Fake-store seams (D-9).**
   - Add the fields `createErr`, `updateErr` and `updatePartialErr error` to `fakeWatchlistStore`.
   - At the top of `Create`, `Update` and `UpdatePartial`, add `if f.<field> != nil { return nil, f.<field> }`.
     In `Update` and `UpdatePartial` the check goes **after** the existing
     `ErrWatchlistNotFound` lookup, so the not-found behavior is unchanged.
2. **`export_test.go` (D-9/D-10).**
   - Add `func SetWatchlistCreateErr(svc *PortfolioService, err error) { svc.watchlists.(*fakeWatchlistStore).createErr = err }`.
   - Add `WatchlistNameUniqueIdx = watchlistNameUniqueIdx` to the existing `var ( … )` alias block
     (`:35-38`). Test code never retypes the index literal (C-18).
   - Do not add a constructor variant (R-7 is rejected).
3. **`portfolio_grpc_wire_test.go` refactor (D-9).**
   - Add `func wireAdapterFor(svc *service.PortfolioService) portfoliov1.PortfolioServiceServer { return handler.NewPortfolioHandler(svc).GRPCHandler() }`.
   - Make `wireAdapter`'s body `return wireAdapterFor(service.NewWireTestService(t, l, positions...))`.
4. **Service tests** (`watchlist_service_test.go`). Wrap each injected error the way the repo does,
   so `errors.As` is exercised through `%w`:
   ```go
   nameDup := fmt.Errorf("insert watchlist: %w", &pgconn.PgError{Code: "23505", ConstraintName: watchlistNameUniqueIdx})
   ```
   Add the `github.com/jackc/pgx/v5/pgconn` import.
   - **`TestWatchlistNameCollision_AlreadyExists_AC3`** has three subtests. Each asserts
     `connect.CodeOf(err) == connect.CodeAlreadyExists` and that the message contains no
     `"duplicate key"`:
     - **create:** set `store.createErr = nameDup`, then call
       `svc.CreateWatchlist(ctxWithUser(t, "u-1"), &portfoliov1.CreateWatchlistRequest{Name: "A"})`.
     - **masked rename:** `seedWatchlist(store, "wl-1", "u-1", false, nil)`, set
       `store.updatePartialErr = nameDup`, then call `UpdateWatchlist` with
       `UpdateMask{Paths: ["name"]}` and `Name: "A"`.
     - **legacy rename:** seed the same way, set `store.updateErr = nameDup`, then call
       `UpdateWatchlist` with `Name: "A"` and no mask.
   - **`TestWatchlistWriteErr_OtherConstraintInternal`**: create with
     `&pgconn.PgError{Code: "23505", ConstraintName: "watchlist_symbols_pkey"}` returns
     `connect.CodeInternal`. This guards against a generic 23505 mapping; D-3 rejected that.
   - **`TestWatchlistWriteErr_NonUniqueInternal_AC4`**: create with
     `&pgconn.PgError{Code: "08006"}` returns `CodeInternal`, and create with `errors.New("boom")`
     returns `CodeInternal` (AC-4).
   - **`TestWatchlistNameUniqueIdx_MatchesMigration011`** (D-10, schema-tie guard): use
     `os.ReadFile("../../migrations/011_watchlist_system_managed_source.up.sql")` (the package dir is
     `internal/service`) and assert that it contains `watchlistNameUniqueIdx`. The test only reads
     the file and edits no migration (F-01 untouched).
5. **Wire tests** (`portfolio_grpc_wire_test.go`, D-7). Add the `pgconn` import.
   - **`TestWire_CreateWatchlistDuplicateName_AC3`**:
     1. `svc := service.NewWireTestService(t, &testdata.Ledger{})`.
     2. `service.SetWatchlistCreateErr(svc, &pgconn.PgError{Code: "23505", ConstraintName: service.WatchlistNameUniqueIdx})`.
     3. `_, err := wireAdapterFor(svc).CreateWatchlist(service.CtxWithUser(t, "u-1"), &portfoliov1.CreateWatchlistRequest{Name: "A"})`.
     4. `wantCode(t, err, codes.AlreadyExists)`.
   - **`TestWire_CreateWatchlistConnFailure_AC4`**: the same, with `&pgconn.PgError{Code: "08006"}`
     and `wantCode(t, err, codes.Internal)`.
6. **C-13.** The PgError literals and the `watchlist_symbols_pkey` string are scenario one-offs, not
   domain data. Each has a single consumer, so they stay inline. `&testdata.Ledger{}` already comes
   from the canonical Go home `internal/testdata/`.

**Verification**:
```bash
cd services/xstockstrat-portfolio \
  && GOWORK=off go test ./internal/service/ -race -count=1 -v -run 'TestWatchlistNameCollision_AlreadyExists_AC3|TestWatchlistWriteErr_|TestWatchlistNameUniqueIdx_MatchesMigration011|TestWire_CreateWatchlist|TestWire_DeleteSystemManagedWatchlist_F127AC7|TestWire251_|TestUpdateWatchlist_|TestCreateWatchlist_|TestBoundedRetry_AC8_' \
  && GOWORK=off COVERPKGS=$(go list ./... | grep -Ev '/(cmd|handler|repository|telemetry|service)(/|$)' | tr '\n' ',' | sed 's/,$//') \
  && go test ./... -race -count=1 -coverprofile=coverage.out -covermode=atomic -coverpkg="${COVERPKGS}" \
  && go tool cover -func=coverage.out | grep "^total:" \
  && GOWORK=off golangci-lint run --modules-download-mode=mod \
  && test "$(grep -rn 'watchlists_user_name_not_system_uidx' --include='*.go' internal | wc -l)" -eq 1
```
- Confirm the total is at or above 40%. The new logic is in an excluded package (`service/`), so no
  threshold applies to it, and the named tests are the behavioral verification.
- The final grep proves the index literal is declared once, in `portfolio_service.go`, and never
  retyped in tests (C-18).

---

### Step 7 — test: agent `manage_watchlist create` surfaces `ALREADY_EXISTS` (C-14 consumer surface)

**Status**: `pending`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/tests/test_watchlist_tools.py` — modify

**Reviewers**: `xstockstrat-agent` owner — MCP tool contract stability (name, parameters, return shape) and `docs/runbooks/mcp-tools.md` parity; no secret values in tool output

**Codebase Evidence**:
- `app/tools.py` on `origin/main-dev`:
  - `_PASS_THROUGH_CODES` is at `:224-235` and includes `grpc.StatusCode.ALREADY_EXISTS` (`:229`).
  - `_grpc_error_message` (`:248`) returns `f"{name}: {details or …}"` for pass-through codes (`:274-275`).
  - `manage_watchlist` is at `:2179`. Its create path is `return await client.create_watchlist(…)`
    (`:2234`), and `except grpc.aio.AioRpcError as e: raise ToolError(_grpc_error_message(e, not_found="watchlist not found", deadline_s=…, write=operation != "update"))`
    is at `:2259-2267`.

  These lines are on `main-dev`. The feature branch, which is behind `main-dev`, has them at
  `:226-237`, `:2162`, `:2217` and `:2242`.
- `tests/test_watchlist_tools.py` is unchanged on `main-dev`.
  - Imports: `AsyncMock, patch` (`:11`), `grpc` (`:13`), `pytest` (`:14`), `ToolError` (`:16`),
    `client` (`:18`) and `TRADER, _ctx` from `tests.conftest` (`:20`).
  - Helpers: `_make_server()` (`:30`) and `_tool_fn(server, name)` (`:36`).
  - The AioRpcError shape is `grpc.aio.AioRpcError(grpc.StatusCode.X, None, None, details="…")`
    (`:87-89`, `:165-170`). This closes the design's "uncompiled assumption" on the `:87` shape.
  - Create-dispatch precedent: `test_manage_watchlist_create_dispatches` (`:100-116`).
- Durable rule extended (C-16): `@AC-4 @FR-3 @FR-5 @feature-148` "manage_watchlist create makes a
  new list owned by the caller" (`services/xstockstrat-agent/acceptance/mcp-watchlist-tools.feature:33-34`).
  The tag number is now captured.

**TDD**: `red-green required`. Red is N/A because this is a characterization test of unchanged agent
behavior. `ALREADY_EXISTS` already passes through (`tools.py:229`), and no agent implementation
changes (design.md §6). Per `.claude/skills/sdd-execute/reference/tdd-gate.md` § Interaction, state
"red N/A — no behavior change; characterization test added" in the PR body and in context.md, and
capture the green run.

**Covers**: `AC-3` (the agent consumer surface: the duplicate name reaches the MCP caller as `ALREADY_EXISTS: <msg>`)

**Instructions**: Add `test_manage_watchlist_create_duplicate_surfaces_already_exists`, decorated with
`@pytest.mark.asyncio`, next to `test_manage_watchlist_create_dispatches`:
1. Build the error:
   `err = grpc.aio.AioRpcError(grpc.StatusCode.ALREADY_EXISTS, None, None, details="a watchlist with this name already exists")`.
   The text is Step 5's fixed message.
2. Patch the client with `patch.object(client, "create_watchlist", AsyncMock(side_effect=err))`.
3. Assert
   `pytest.raises(ToolError, match=r"^ALREADY_EXISTS: a watchlist with this name already exists$")`
   around
   `await _tool_fn(_make_server(), "manage_watchlist")(ctx=_ctx(TRADER), operation="create", name="Breakouts")`.

The details string is a single-consumer scenario one-off, so it stays inline (C-13). No `conftest.py`
change.

**Verification**:
```bash
cd services/xstockstrat-agent \
  && uv run --no-sync pytest tests/test_watchlist_tools.py -q -k "already_exists or create" \
  && uv run --no-sync pytest --cov=app --cov-fail-under=40 -q \
  && ruff check . && ruff format --check . \
  && grep -n "from tests.conftest import" tests/test_watchlist_tools.py
```

---

### Step 8 — docs: AC-2 server-side rewording, product-spec Observed correction, context.md records

**Status**: `pending`
**Service**: `docs/roadmap/features/326-fix-grpc-status-mapping/`
**Files**:
- `docs/roadmap/features/326-fix-grpc-status-mapping/acceptance.feature` — modify
- `docs/roadmap/features/326-fix-grpc-status-mapping/product-spec.md` — modify
- `docs/roadmap/features/326-fix-grpc-status-mapping/context.md` — modify (append)

**Reviewers**: none

**Codebase Evidence**:
- `acceptance.feature`: `@AC-2 @regression`. Its Given is "the GetSectorHistory service call returns
  context.DeadlineExceeded", and its Then is "the client receives gRPC status DEADLINE_EXCEEDED, not
  INTERNAL".
- `product-spec.md` § Problem Statement, the marketdata Observed bullet: "The sector RPCs,
  `GetEtfFlags`, `GetHistoricalFundamentals` and `BackfillFundamentals` return service errors raw".
  That is wrong for the sector RPCs. The handlers return raw, but the service wraps the store error
  as Internal at `classification_service.go:120, :140, :171`.
- The R-6 grep result and the UI evidence are in Step 1's Codebase Evidence and in the Execution
  Summary (C-14).

**TDD**: `N/A (docs)`

**Covers**: —

**Instructions**:
1. **`acceptance.feature`** (C-15 append-only; keep the `@AC-2 @regression` tags and the ID; D-5).
   Reword the scenario:
   - **Given**: "the classification store returns the caller's expired context error for a non-empty
     symbol set".
   - **When**: "the GetSectorHistory gRPC handler is called with that expired context".
   - **Then**: "the GetSectorHistory handler returns gRPC status DEADLINE_EXCEEDED, not INTERNAL".

   Change no other scenario.
2. **`product-spec.md`**. Correct the Observed bullet: the sector RPCs' handlers return the service
   error raw, but the service wraps store failures as `connect.CodeInternal`
   (`classification_service.go:120, :140, :171`). So a caller deadline reaches the caller as
   `INTERNAL` through that wrap, not as a raw error.
3. **`context.md`**: append a session entry recording:
   - **Follow-ups**, to be filed through the allocator:
     - `fix-trading-grpc-status-mapping`. Scope: the identical six-code collapse in
       `services/xstockstrat-trading/internal/handler/trading.go:223-237`. Deferred because
       trading is not in this feature's affected services.
     - `fix-portfolio-grpc-ctx-mapping`. Scope: a ctx-aware portfolio `toGRPCError(ctx, err)`
       symmetric with marketdata. Deferred because it means about 24 call-site edits in a file that
       conflicts with peers 311/312/315/317, and no AC requires it (D-6).
   - **The C-14 UI disposition.** The UI needs no code change: `insightsBff.ts:136`
     `forward(...)`, `bffShared.ts:199-209` and `insights/watchlists/page.tsx:119-120`. The
     user-visible create error changes from the raw pgx text "insert watchlist: ERROR: duplicate key
     value violates unique constraint …" to "a watchlist with this name already exists".
   - **The bounded R-6 grep result** from Step 1's Codebase Evidence: no non-test caller branches on
     `INTERNAL` from a marketdata RPC, and no marketdata site emits a newly passed-through code.

**Verification**:
```bash
F=docs/roadmap/features/326-fix-grpc-status-mapping
grep -n "@AC-1\|@AC-2\|@AC-3\|@AC-4" $F/acceptance.feature   # all four IDs still present, none renumbered
grep -n "handler returns gRPC status DEADLINE_EXCEEDED" $F/acceptance.feature
grep -n "classification_service.go" $F/product-spec.md
grep -n "fix-trading-grpc-status-mapping\|fix-portfolio-grpc-ctx-mapping\|a watchlist with this name already exists" $F/context.md
```

---

## Deviation Log

_Populated by /sdd-execute as implementation proceeds._
