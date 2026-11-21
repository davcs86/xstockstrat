# Design: fix-grpc-status-mapping

**Created**: 2026-11-13
**Rounds**: 3 (full; termination: approved)
**Approved by**: operator @ 2026-11-13 (sdd-batch design gate; Floor clear)
**Grounded in**: recon.md
**Debate register**: debate.md

---

## Chosen Approach

Two Go gRPC error boundaries stop collapsing distinct error classes into `INTERNAL`. Each service
keeps its own translator, with no shared Go package (D-4), because every Go service is a separate
module built with `GOWORK=off`. No proto, migration, config key or env var changes (recon.md:99-108).

### 1. Marketdata translator (D-1, D-2, D-8, D-11, D-12)

`toGRPCError` (`services/xstockstrat-marketdata/internal/handler/marketdata_handler.go:513-532`,
recon.md:22) becomes `toGRPCError(ctx context.Context, err error) error`. All 19
`grpcMarketDataAdapter` call sites (`:316-500`, recon.md:23) pass the inbound ctx, and the compiler
enforces the change. The branches run in this order:

- **(a)** A `*connect.Error` whose code is not Internal or Unknown returns
  `status.Error(codes.Code(c.Code()), c.Message())`. This is the generic numeric cast; connect codes
  1-16 match grpc-go numerically, and a table test pins that (D-1).
- **(b)** Otherwise, if the inbound `ctx.Err()` is set, it returns `DEADLINE_EXCEEDED` with
  "deadline exceeded" or `CANCELLED` with "request canceled". Both are fixed text: no `err.Error()`
  goes into the status, a log or a span. At most a fixed-label error class is recorded (D-2, D-8).
  This branch covers every Internal wrap on the request path with no per-site edits, including:
  - the seven raw-return RPCs (recon.md:24-31);
  - the blanket-Internal handlers (recon.md:32-39);
  - `forwardConnectErr` (recon.md:40);
  - the classification services' `CodeInternal` wraps (`classification_service.go:120,140,171`).
- **(c)** Otherwise, it returns today's `INTERNAL` with today's message, unchanged. This preserves
  `@AC-53` strict (recon.md:82, :114).

Keying on the caller's ctx rather than on `errors.Is(err, context.DeadlineExceeded)` keeps detached
`context.WithoutCancel` budgets (`marketdata_service.go:672,915,946`) at `INTERNAL`. A table pin
row enforces this: a live ctx with `connect.NewError(CodeInternal, context.DeadlineExceeded)`
returns `INTERNAL` (D-11, guarding R-2).

**Stated scope limit (D-12).** On a live ctx, branch (c) and the blanket-Internal handler wraps
(`:90/:102/:114/:126/:202/:228`) still carry `err.Error()` text (`:531`). That exposure exists today,
this feature does not widen it, and it is out of scope. The no-`apikey=` test runs with an expired
ctx, so it guarantees branch (b) only. Also out of scope: the streaming handlers' raw `ctx.Err()`
returns (`:440`, `:460`, recon.md:41) and the body of `forwardConnectErr` (`:294-300`).

### 2. Portfolio translator (D-1, D-6)

`toGRPCError` (`services/xstockstrat-portfolio/internal/handler/portfolio_handler.go:443-464`,
recon.md:49) gets the same numeric cast plus the existing Internal default, with no ctx parameter.
That cast closes the missing `CodeAlreadyExists` case that would otherwise block AC-3 end to end
(recon.md:112). GetPnL keeps its ctx-first `classifyGetPnLError` (`:427-433`, recon.md:54). Making
portfolio ctx-aware like marketdata is deferred to the named follow-up `fix-portfolio-grpc-ctx-mapping`.

### 3. Portfolio duplicate-name classifier (D-3)

The new `classifyWatchlistWriteErr(err)` and the unexported const
`watchlistNameUniqueIdx = "watchlists_user_name_not_system_uidx"` go in
`services/xstockstrat-portfolio/internal/service/portfolio_service.go`. The index is defined at
`migrations/011_watchlist_system_managed_source.up.sql:20` (recon.md:47).

- It returns `connect.CodeAlreadyExists` with fixed text only when `errors.As` finds a
  `*pgconn.PgError` with Code `23505` **and** `ConstraintName == watchlistNameUniqueIdx`.
- Anything else returns `CodeInternal`, as today.
- It mirrors the `classifyConsumerErr` idiom (`portfolio_service.go:1470-1496`, recon.md:72) and
  relies on the repo wrapping errors with `%w` (`watchlist_repo.go:52,205,258`, recon.md:46).
- It is applied at all three name-write sites:
  - CreateWatchlist `:2194-2196` (recon.md:45)
  - the UpdatePartial mask path `:2314`
  - the legacy rename `:2337-2339` (recon.md:51)
- The handler's CreateWatchlist passes the error through unchanged (`portfolio_handler.go:166-170`,
  recon.md:50).

The system index (`watchlists_user_system_uidx`, recon.md:48) and the consumer's 23505
retry/park classification (`@AC-8` f294) are untouched.

### 4. Test seams (D-9, D-10, D-13)

All test-only, in portfolio `internal/service` unless noted:

- `fakeWatchlistStore` (`watchlist_service_test.go:32`, recon.md:76) gains `createErr`,
  `updateErr` and `updatePartialErr` fields. `Create` (`:82`) and the update methods return the
  error when it is set.
- `export_test.go` gains the setter `SetWatchlistCreateErr(svc *PortfolioService, err error)`. It
  also gains the alias `WatchlistNameUniqueIdx = watchlistNameUniqueIdx`, next to the
  `CtxWithUser`/`Guard` aliases (`:35-38`), so test code never retypes the index literal (C-18).
- `portfolio_grpc_wire_test.go:23-26` is refactored. `wireAdapterFor(svc *service.PortfolioService)`
  returns `handler.NewPortfolioHandler(svc).GRPCHandler()`, and `wireAdapter` then calls
  `wireAdapterFor(service.NewWireTestService(t, l, positions...))`. This is needed because today
  `wireAdapter` builds the service internally and returns only the adapter, and `NewWireTestService`
  hard-wires `newFakeStore()` (`export_test.go:23`).
- Marketdata `marketdata_handler_test.go` (package `handler`) defines a minimal local stub of the
  5-method classification store, because `fakeClassStore` (`classification_service_test.go:18`) is
  unreachable from package `handler`. The stub drives a zero-value `&service.MarketDataService{}`
  through `SetClassification(stub, nil, nil)`. The zero-value service is safe: `markClassDemand`
  initializes lazily (`:67-72`), and GetSectorHistory touches only `class.store` (`:150-171`).

### 5. Tests (C-08, mapped to acceptance)

- **Marketdata `toGRPCError` table** (AC-1, D-1, D-11):
  - a live ctx over connect codes 1-16;
  - an expired ctx with Internal returns `DEADLINE_EXCEEDED`, and a canceled ctx returns `CANCELLED`;
  - an expired ctx with Unavailable wrapping a deadline stays `UNAVAILABLE` (`@AC-5`/`@AC-7` f254);
  - the R-2 pin row;
  - a live ctx with a plain error returns `INTERNAL` with the message intact (`@AC-53`);
  - with an expired ctx, a wrapped `*url.Error` carrying `apikey=x` yields a message containing
    neither `apikey=` nor `token=`.
- **AC-2 chain test** (D-5, D-13): call
  `NewMarketDataHandler(svc).GRPCHandler().GetSectorHistory(expiredCtx, &GetSectorHistoryRequest{Symbols: []string{"AAPL"}})`.
  The stub's `SectorHistory` returns `ctx.Err()`, and the test asserts `DeadlineExceeded` through
  the real Internal wrap at `classification_service.go:171`. A non-empty Symbols set is needed to
  get past the early return at `:151-154`.
- **Portfolio `TestToGRPCError`**: add AlreadyExists, Aborted and Unknown rows.
- **`watchlist_service_test.go`**:
  - 23505 on the name index returns `AlreadyExists` at each of the three sites (AC-3);
  - 23505 on another ConstraintName (the binding table, `watchlist_repo.go:54`) returns `Internal`;
  - 08006 and plain errors return `Internal` (AC-4);
  - a schema-tie guard test reads `migrations/011_watchlist_system_managed_source.up.sql` and
    asserts it contains `WatchlistNameUniqueIdx` (D-10).
- **AC-3 wire test** (D-7, D-9): `TestWire_CreateWatchlistDuplicateName_AC3` runs these steps:
  1. `svc := service.NewWireTestService(t, &testdata.Ledger{})`;
  2. `service.SetWatchlistCreateErr(svc, &pgconn.PgError{Code: "23505", ConstraintName: service.WatchlistNameUniqueIdx})`;
  3. `wantCode(..., codes.AlreadyExists)` through `wireAdapterFor(svc)`.

  A second row with 08006 expects `codes.Internal` (AC-4). `refuseUnservable` returns early for an
  empty binding set (`:569`), so the injected error reaches the translator.

### 6. Consumer surfaces (C-14)

- **Agent** (`manage_watchlist`): no code change. `_PASS_THROUGH_CODES` already includes
  `ALREADY_EXISTS` (`services/xstockstrat-agent/app/tools.py:231`, recon.md:63). The Create path
  propagates the `AioRpcError` unwrapped (recon.md:65-66). Add one test only:
  `test_manage_watchlist_create_duplicate_surfaces_already_exists` in `tests/test_watchlist_tools.py`.
  It extends the @feature-148 "manage_watchlist create" rule (recon.md:92).
- **UI** (`/insights/watchlists`, `/insights/screener`): no code change, with this evidence:
  - the BFF `forward` at `insightsBff.ts:136` passes the body through unchanged
    (`bffShared.ts:199-209`);
  - `insights/watchlists/page.tsx:119-120` renders `.message` (recon.md:57-61).

  The user-visible text changes from the raw pgx string "insert watchlist: ERROR: duplicate key
  value violates unique constraint ..." to the fixed ALREADY_EXISTS text. This disposition is
  recorded in context.md. A duplicate-name e2e mock is optional.

### 7. Spec and record edits

- **acceptance.feature**: keep the `@AC-2` ID (C-15, append-only) and reword it server-side:
  - Given: "the classification store returns the caller's expired context error for a non-empty
    symbol set".
  - Then: "the GetSectorHistory handler returns gRPC status DEADLINE_EXCEEDED, not INTERNAL".

  The absence of `@FR-N` tags is the bug-template convention already accepted at context.md:24.
- **product-spec.md**: correct the Observed line. The sector RPCs wrap errors as Internal; they do
  not return them raw.
- **context.md**: record three things:
  - the follow-ups `fix-trading-grpc-status-mapping` (`trading.go:223-237`) and
    `fix-portfolio-grpc-ctx-mapping`, each with its scope and deferral reason;
  - the UI message-change disposition;
  - the bounded R-6 grep result: no non-test caller branches on `INTERNAL` from a marketdata RPC,
    and no marketdata site emits a newly passed-through code (recon.md:115-116).

**Build order:**

1. The marketdata translator, its 19 call sites and its tests, including the R-2 pin and the AC-2
   chain test.
2. The portfolio translator and its test.
3. The classifier at its three sites, the fake-store fields, the `export_test.go` setter and alias,
   the `wireAdapterFor` refactor, and the service, wire and schema-guard tests.
4. The agent test, the AC-2 rewording, the product-spec correction, and the context.md entries
   (follow-ups, UI disposition and grep result).

The round-3 open objections O-11 to O-15 are non-blocking. The approach above already adopts them
as D-9 to D-13, so `/sdd-spec` must carry them as concrete steps.

## Rejected Alternatives

- `R-1` A connect-first cast followed by an `errors.Is(context)` branch, with no ctx parameter and
  no awareness of wrappers. Rejected because the Internal wrapper matches first, so AC-2 stays
  `INTERNAL` over gRPC and the unit test is a false green.
- `R-2` An `errors.Is` context check that sees through `*connect.Error{Internal}` without consulting
  the caller ctx. Rejected because it would reclassify detached singleflight/batch-budget timeouts
  as the caller's deadline and mislead retry logic.
- `R-3` Removing the Internal wraps at the `classification_service.go` call sites one at a time.
  Rejected because it is a partial per-site sweep that leaves the other Internal-wrapping RPCs
  broken (fails.md:1571).
- `R-4` Using `status.FromContextError(err)` or `err.Error()` text for the
  `DEADLINE_EXCEEDED`/`CANCELLED` statuses. Rejected because the wrapped chain can include a vendor
  URL carrying `apikey=`.
- `R-5` A socket-level e2e as the AC-2 regression guard. Rejected because the client's own
  propagated deadline yields `DEADLINE_EXCEEDED` whatever the server status, so the test would be a
  false green.
- `R-6` An open-ended audit of how every marketdata caller handles `DEADLINE_EXCEEDED` versus
  `INTERNAL` before execute. Rejected because it is unbounded and largely moot: reclassification
  happens only when the inbound ctx has already expired. A bounded grep replaces it.
- `R-7` A `NewWireTestServiceWithStore` constructor variant to inject store errors for the AC-3
  wire test. Rejected because it is a wider seam than one error injection needs; one setter export
  plus `wireAdapterFor` is smaller (C-18).
- `R-8` Moving `fakeClassStore` into `internal/testdata` so the marketdata handler package can
  reuse it. Rejected because it couples test files that change for unrelated reasons, and C-13
  governs domain data, not test doubles. A minimal local stub fits better.

The final synthesis also rejected these two options, which have no R-ID:

- Inlining `handler.NewPortfolioHandler(svc).GRPCHandler()` in the AC-3 wire test. It would
  duplicate the harness construction line that `wireAdapterFor` centralizes.
- Making portfolio's `toGRPCError(ctx, err)` symmetric now (about 19 call-site edits in a file that
  conflicts with peers 311/312/315/317, and no AC requires it), and a generic 23505 → AlreadyExists
  repo classifier, which would misclassify binding-table and system-index 23505s. Both were already
  settled by D-6 and D-3.

## Open Risks

- [ ] **Peer-batch merge overlap.** The ctx parameter rewrites all 19 call sites in
  `marketdata_handler.go`, which fix-marketdata-miss-path-noise, fix-vendor-key-in-url and
  fix-mcp-deadline-budget may also edit. The three name-write sites are in `portfolio_service.go`,
  which peers 311/312/315/317 also edit. The signature change catches a dropped ctx argument at
  compile time, but not a reintroduced raw Internal wrap or a lost classifier call. Re-run
  `@AC-5`/`@AC-7` f254 and the AC-3 wire test after each merge — at the final integration PR.
- [ ] **Code numbering.** The generic cast assumes connect-go codes 1-16 match grpc-go numerically.
  The table test pins this, but a renumbering would surface only in CI — at the marketdata
  translator step.
- [ ] **Out-of-scope translators.** Trading's identical translator and portfolio's ctx-unaware
  translator stay defective until the named follow-ups are filed through the allocator — at the
  context.md record step.
- [ ] **Masked diagnostics, by design.** When a genuine non-context Internal failure coincides with
  an expired caller deadline, the status shows the fixed context text and loses that diagnostic —
  documented at the marketdata translator step.
- [ ] **Pre-existing text exposure.** Branch (c) and the blanket-Internal handler wraps still carry
  vendor-chain error text on a live ctx. This is out of scope and must not be read as fixed (D-12)
  — stated in the spec at the marketdata translator step.
- [ ] **Uncaptured tag.** The @feature-148 durable-rule tag number for "manage_watchlist create" is
  not captured yet and is needed for C-16 promotion — at the agent test step or at launch.
- [ ] **Uncompiled assumptions.** Two assumptions still need a compile check: that
  `repository.ClassificationRow` can be imported from the handler test package, and that the agent
  test shape at `tests/test_watchlist_tools.py:87` is unchanged since round 2 — at the AC-2 chain
  test step and the agent test step.

## Constitution Rules Touched

- `C-01` — honored by: every claim cites `path:line` from recon.md or from round-verified reads. `/sdd-spec` must re-ground each step.
- `C-08` — honored by: each service step is paired with tests. These are the marketdata table and chain tests, the portfolio translator, service, wire and schema-guard tests, and the agent test, and they map to AC-1 through AC-4.
- `C-10` — honored by: branch (b) covers every Internal-wrapping marketdata path in one place (R-3 rejected), and the classifier is applied at all three name-write sites. The duplicated trading translator is recorded as a named follow-up.
- `C-11` — honored by: the feature was triaged (Track C), reviewed and debated over 3 full rounds before any code.
- `C-13` — honored by: the test doubles (the fake store fields and the classification stub) are local seams, not domain fixtures. Any domain data comes from the existing `testdata` homes (`testdata.Ledger`).
- `C-14` — honored by: the agent `manage_watchlist` gets a test, and the UI no-code disposition is recorded with evidence and the user-visible message change.
- `C-15` — honored by: `@AC-2` keeps its ID and is reworded append-only. The missing `@FR-N` tags follow the accepted bug-template convention (context.md:24).
- `C-16` — honored by: the Business Rules Touched list below, with operator sign-off for each CHANGE.
- `C-18` — honored by: the generic cast instead of hand-extended switches, one setter instead of a constructor variant (R-7), the index alias instead of a retyped literal, and no shared package or speculative portfolio ctx symmetry.
- `P-02` — honored by: the proposer and adversary were mediated each round through the synthesized state only.
- `P-03` — honored by: unverified items (the f148 tag and the two uncompiled assumptions) are surfaced as open risks, not guessed.
- Floor (`F-*`) — no breach was raised in any round. `F-01` is untouched because no migration is edited; the guard test only reads migration 011.

## Business Rules Touched (C-16)

- CHANGE `@AC-1` "marketdata preserves the connect error code on the gRPC boundary" (`docs/roadmap/features/326-fix-grpc-status-mapping/acceptance.feature`). The altered guarantee is that non-Internal/Unknown connect codes keep their code instead of becoming `INTERNAL`. Signed off by the operator @ 2026-11-13 (sdd-batch design gate, C-16 sign-off for AC-1/AC-2/AC-3; context.md).
- CHANGE `@AC-2` "a raw context deadline on GetSectorHistory reaches the caller as DEADLINE_EXCEEDED". It is reworded server-side (the handler returns `DEADLINE_EXCEEDED`) and keeps its ID. Signed off by the operator @ 2026-11-13 (sdd-batch design gate; context.md).
- CHANGE `@AC-3` "creating a duplicate non-system watchlist name returns ALREADY_EXISTS", which was previously `INTERNAL`. Signed off by the operator @ 2026-11-13 (sdd-batch design gate; context.md).
- PRESERVE `@AC-4` "a non-unique-violation insert failure still returns INTERNAL". Not regressed: `classifyWatchlistWriteErr` returns Internal for every error except a 23505 on the name index, and the 08006 service and wire rows pin this.
- PRESERVE `@AC-53` "allow_partial opts in to returning stored bars when the live fetch fails" (`services/xstockstrat-marketdata/acceptance/offline-account-full-pnl.feature`). Not regressed: branch (c) keeps `INTERNAL` with the message on a live ctx, pinned by the plain-error row.
- PRESERVE `@AC-54` "allow_partial budgets the live fetch from the caller's deadline" (same suite). Not regressed: branch (b) fires only when an error reaches the translator with the inbound ctx expired, and a partial success returns no error.
- PRESERVE `@AC-14` "Partial BatchGetBars still fetches servable cold symbols within the deadline" (`services/xstockstrat-marketdata/acceptance/filter-otc-symbols.feature`). Not regressed: the success path is untouched.
- PRESERVE `@AC-8` @feature-294 (`services/xstockstrat-portfolio/acceptance/signal-map-instrumentation.feature`). Not regressed: the classifier is scoped to the three name-write sites, and the consumer's 23505 retry/park handling is untouched (D-3).
- PRESERVE `@AC-5` / `@AC-7` @feature-254 "marketdata gRPC / batch Unavailable status never carries the vendor key" (`services/xstockstrat-marketdata/acceptance/fix-marketdata-secret-exposure.feature`). Not regressed: UNAVAILABLE passes through cast (a) with its message unchanged, branch (b) uses fixed text, and the expired-ctx Unavailable row and the no-`apikey=` row pin this.
- PRESERVE `@AC-6` / `@AC-7` @feature-127 (`services/xstockstrat-portfolio/acceptance/consolidate-watchlist-signal.feature`; `docs/sdd/business-rules/platform.feature`). Not regressed: ALREADY_EXISTS is matched only on the non-system index, and system-list creation (`ON CONFLICT ... DO NOTHING`) and delete protection are untouched.
- EXTEND "manage_watchlist create makes a new list owned by the caller" @feature-148 (`services/xstockstrat-agent/acceptance/mcp-watchlist-tools.feature`; tag number to be captured). The new case is that a duplicate name surfaces `ALREADY_EXISTS: <msg>`.

## Rounds

- Round 1 (2026-11-11): settled D-1 to D-4 and rejected R-1 to R-4. Raised O-1 to O-6, of which O-1 and O-2 were blocking.
- Round 2 (2026-11-11): settled D-5 to D-8 and rejected R-5 and R-6. Closed O-1 to O-6 and raised O-7 to O-10, all non-blocking.
- Round 3 (2026-11-13): settled D-9 to D-13 and rejected R-7 and R-8. Closed O-7 to O-10 and raised O-11 to O-15, all non-blocking and adopted as D-9 to D-13.
- No reopen petitions were filed in any round.
- **Termination: approved.** The operator approved at the round-3 gate (2026-11-13) with the Floor clear and no blocking objection open. The adversary's round-3 verdict was SOUND, with no register violation.
