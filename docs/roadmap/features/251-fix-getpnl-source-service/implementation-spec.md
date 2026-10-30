# Implementation Spec: fix-getpnl-source-service

**Status**: `pending`
**Created**: 2026-10-21
**Feature**: `docs/roadmap/features/251-fix-getpnl-source-service/feature.md`
**Total Steps**: 13 (Steps 1-3 `superseded` by features 257/263 at the 2026-10-30 re-spec; 10 active; plus promotion gate PG-1, outside the step counter)
**Feature Branch**: `feature/fix-getpnl-source-service`

---

## Re-spec 2026-10-30

Re-specced (sdd-execute sequential) against `origin/main-dev` after feature 257 merged (`079870fa`, #1371) and feature
263 (ledger `ownerOnly`, BFF owner scoping). Step numbers are kept so prior references stay valid. Changes:
- Steps 1-3 are `superseded`: the ledger keyset `page_token` (by `sequence`, code 3 on a bad token) is already
  implemented and tested; `ledger-db-test` already exists in CI. 251 makes no ledger or `ci.yml` change.
- GetPnL already has a fail-closed 1000-row drain (`collectFills`, `ErrLedgerUnavailable`); Step 7 reuses that sentinel
  (no `ErrRealizedUnavailable`) and adds the canonical source, side resolution and the account-grain sequence fold.
  Step 6 also migrates feature 257's `portfolio_pnl_paging_test.go` fixtures to side-bearing payloads.
- UI: the BFF backstop and `isForeignFillEvent` are dropped (feature 263 forces `ownerOnly`); `traderBff.ts` is no
  longer in Step 11's Files.
- Step 12 drops the ledger `page_token` edit (already documented); Step 13 drops the 252 context note (252 launched).

## Execution Summary

This spec follows the build order in design.md §7. The ledger goes first (Steps 1-3): a behaviour-preserving
extraction into `queryEventsPage.ts`, then RED unit and real-PG tests, then the keyset `page_token` fix. Without it,
FR-1 turns GetPnL's page loop into a page-1 replay (recon.md "Latent: GetPnL pagination loops").

Trading follows (Steps 4-5): an additive `side` key on both fill payloads.

Portfolio comes next (Steps 6-9):
- the shared request-honouring ledger fake, the `export_test.go` shim and the RED GetPnL fold tests;
- the GetPnL rewrite (FR-1, FR-2, FR-4, FR-5);
- the RED adapter and error-mapping tests;
- the ctx-first `classifyGetPnLError` and `toGRPCError` change.

The UI then gets the user-pinned lineage and BFF backstop (Steps 10-11). Teardown docs (Step 12) and the
merge-order reconciliation (Step 13) close the step loop. The post-deploy ship gate plus dev smoke is promotion
gate PG-1, outside the step counter: it runs on live dev/prod, so `/sdd-execute` cannot run it.

Every code-bearing step has a paired test step written to fail first (P-06, C-08). Pairing:
- Step 2 [test] covers Steps 1 and 3 [service]: RED against the Step 1 extraction, GREEN after Step 3.
- Step 4 [test] → Step 5 [service].
- Step 6 [test] → Step 7 [service].
- Step 8 [test] → Step 9 [service].
- Step 10 [test] → Step 11 [service].

There are no proto, migration or config steps (design.md §Chosen Approach; product-spec Fix Scope). The PLAT-10
`buf breaking --against '<repo-root>/.git#branch=feature/fix-getpnl-source-service,subdir=packages/proto'` gate
therefore does not apply. Any step that touches a `.proto` is a deviation and must stop (P-03).

**Consumer surfaces (C-14).**
- `/trader/positions` fill-lineage sheet: Steps 10-11.
- `GetPnL` RPC: internal/platform-only. Re-confirmed 2026-10-21: no `GetPnL`/`getPnL` hit under
  `services/xstockstrat-ui/src` or `services/xstockstrat-agent/app`, and the only non-generated Go references are
  `services/xstockstrat-portfolio/internal/handler/portfolio_handler.go` and `internal/service/portfolio_service.go`.
- Agent: none.

**Design drift resolved here (P-03).**
- design.md:17 says "no … ci.yml change", but design.md §1 (:45-47) and context.md Open Threads add the
  `ledger-pg-test` CI job. This spec follows §1: `.github/workflows/ci.yml` is in Step 2's Files. The COVERPKGS
  exclusion stays unchanged (design.md §6E).
- design.md §3 says `toGRPCError` should mirror "`trading.go:223-238`". That file is
  `services/xstockstrat-trading/internal/handler/trading.go:223-238`, not `internal/service/trading.go`. The handler
  covers FailedPrecondition only, so DeadlineExceeded/Canceled have no in-repo precedent and are added explicitly.
- design.md §2 and §6 cite an "extended source-service parity test". **Not found**: no such test exists in
  portfolio (grep `Parity|SourceService` over `internal/**/*_test.go`). Step 6 creates it as a two-half parity, the
  precedent being `internal/service/pnl_fold_test.go:10-14`. The portfolio half asserts const = testdata value =
  literal. The trading half (Step 4) asserts the recorded `SourceService`. Go modules cannot import each other
  (`GOWORK=off`).
- design.md §6E (:174-175) and Open Risks (:261) say `testdata` counts toward COVERPKGS. **Wrong**: `go list ./...`
  skips directories named `testdata` (2026-10-21: `GOWORK=off go list ./...` in portfolio lists no testdata
  package), so `internal/testdata/ledger.go` is not in COVERPKGS, not vetted by `go vet ./internal/...` and not
  linted by `golangci-lint run`. Step 6 vets it by explicit path; the fake is exercised only through its importers.
- design.md §7 lists the ship gate and dev smoke in the build order. They run against live dev/prod, so this spec
  holds them as promotion gate PG-1 (after Step 13), not as a step.

### Scenario Coverage (C-15)

| Scenario | Covered by |
|---|---|
| AC-1 unsigned sell folds (500) | Step 6 |
| AC-2 partial sell folds (200) | Step 6 |
| AC-3 lineage lists own fills, no u-2 | Step 10 |
| AC-4 unresolved side → FAILED_PRECONDITION | Step 6 (service sentinel), Step 8 (wire case 1) |
| AC-5 other user's orphan fill, zero lookups | Step 6 |
| AC-6 read failure mid-drain → UNAVAILABLE | Step 6, Step 8 (wire case 2) |
| AC-7 deadline / cancel codes | Step 8 (wire cases 3, 4; `TestClassifyGetPnLError`) |
| AC-8 replaying ledger → UNAVAILABLE | Step 6 |
| AC-9 501 fills, 2 calls | Step 6 (drain test) |
| AC-10 producer `side` + source + fees | Step 4 |
| AC-11 payload-side fill, no lookup | Step 6 |
| AC-12 ledger exactly-once incl. ties | Step 2 (real-PG) |
| AC-13 malformed token → INVALID_ARGUMENT | Step 2 (unit + real-PG) |
| AC-14 cross-account (500) | Step 6 |
| AC-15 mixed-era → FAILED_PRECONDITION | Step 6 |
| AC-16 sequence-ordered fold (F1, F2) | Step 6 |
| AC-17 partial-then-filled folds once | Step 6 |
| AC-18 LIVE excluded (GetPnL + lineage) | Step 6 (GetPnL half), Step 10 (lineage half) |
| AC-19 lineage beyond first platform page | Step 10 |
| AC-20 BFF drops other users' fill events | Step 10 |
| AC-21 50-order cap + notice | Step 10 |
| AC-22 stale-status order still listed | Step 10 |
| durable portfolio @AC-5 @feature-229 (EXTEND) | Step 8 (wire case 7 + `TestClassifyGetPnLError` rows) |
| durable platform @AC-7 @feature-127 (PRESERVE) | Step 8 (wire case 5) |
| durable platform @AC-10 @feature-029 (PRESERVE, `fees` kept) | Step 4 |

## Step Dependencies

- **Re-spec 2026-10-30:** Steps 1-3 are superseded and carry no dependency. Step 6 depends on nothing at runtime.
  The ledger and `ci.yml` bullets below that mention Steps 1-3, `ledger-pg-test` or 252 are historical.
- Step 2 requires Step 1. The RED tests import `src/grpc/queryEventsPage.ts`, which Step 1 creates with today's
  semantics, so they fail on behaviour, not on import (design.md §1 "RED").
- Step 3 requires Step 2 (GREEN target).
- Step 5 requires Step 4 (RED).
- Step 6 requires nothing at runtime: its fake ignores the real ledger. It is ordered after Step 3 so the
  fake's paging contract matches the shipped ledger (design.md §6A).
- Step 7 requires Step 6 (RED). Step 9 requires Step 8 (RED), and Step 8 requires Step 7: wire cases 1-4 drive
  the rewritten GetPnL.
- Step 9's arity change (`classifyGetPnLError(ctx, err)`) compiles only with `portfolio_handler.go:96` and
  `portfolio_handler_test.go:40`, `:43` updated together. Step 8 changes the test calls; Step 9 changes `:96` and
  `:425`. The Step 8 RED is a compile failure for those rows, which is accepted (precedent `trading_fees_test.go`
  "compile-level RED").
- Step 11 requires Step 10 (RED). Step 10's mock and fixture changes ship in Step 10.
- Step 12 (teardown) requires Steps 1-11. Step 13 runs at the integration PR. PG-1 runs only after trading
  `side` is live on dev (design.md §7) and blocks promotion.
- **Red-package PRs (P-06/F-05).** Steps 6 and 8 leave whole test packages uncompilable until Steps 7 and 9
  (`internal/service` at Step 6; `internal/handler` and the `service_test` wire test at Step 8). Each step PR's CI
  is red for the full package, not only the new tests; the step PR description must say so.
- **Overlap.** 252-fix-identity-ledger-test-suites is `implementation-ready` (`origin/feature/fix-identity-ledger-test-suites`
  `status.md`; this branch's copy of 252 `status.md` reads a stale `draft`). It collides beyond `makeRow`:
  - 252 Step 4 switches the ledger runner to `tsc && c8 … node --test dist/__tests__/*.test.js`, deletes the
    `src/**/*.test.ts` tsconfig exclusion and strips `.ts` extensions from test imports (`mtls.test.ts:13`). 251's
    `queryEventsPage.test.ts` and `pg/queryEventsKeyset.test.ts` import `queryEventsPage.ts` with the extension,
    which `tsc` rejects without `allowImportingTsExtensions`.
  - 252 Step 5 removes every `if (!impl) return;` guard in `ledgerServiceImpl.test.ts`, the guards 251 Step 2
    edits under.
  - Other peers (WARN, shared files, no field/migration/key collision): 248 (`ledgerServiceImpl.ts`,
    `ledgerServiceImpl.test.ts`, `ci.yml` `ledger-db-test` job + `ci-gate`, ledger `CLAUDE.md`); 249 (`trading.go`
    `:86-92`/`:684`/`:1521`, trading `CLAUDE.md`, `INVENTORY.md`); 250 (`ci.yml` `otel-signals` + `ci-gate`); 241
    (`trading.go` `escalateSystemic` `:2163-2190`).
  - 241 `implementation-spec.md:70-71` says 251 edits the `SourceService` literal at `trading.go:2188` in
    `escalateSystemic`. 251 has no such edit: its only `trading.go` change is `applyBrokerOrderStatus`
    (`:1772-1829`, Step 5). The 241 claim is stale.
  - Step 13 records all of these in `merge-order.md`.
- **C-16 promotion.** AC-1..AC-22 are promoted into the durable suites (`services/xstockstrat-portfolio/acceptance/`,
  `services/xstockstrat-ledger/acceptance/`, `services/xstockstrat-trading/acceptance/`,
  `services/xstockstrat-ui/acceptance/`) by `/sdd-execute`'s integration PR, not by a step here. The portfolio
  @AC-5 backing header (`services/xstockstrat-portfolio/acceptance/fix-book-portfolio-page.feature:6-8`) stays
  accurate because `TestClassifyGetPnLError` keeps its name.
- **Deferred follow-ups (C-10/C-14).** `docs/reports/2026-10-21-portfolio-live-fold-sell-sign-loss-defect.md` and
  `docs/reports/2026-10-21-trading-bracket-leg-fills-missing-from-realized-pnl-defect.md` (both `open`) stay
  outside 251.

---

### Step 1 — SUPERSEDED: ledger `queryEventsPage.ts` extraction (not needed)

**Status**: `superseded`
**Service**: `xstockstrat-ledger`
**Files**: none

**Codebase Evidence** (re-spec 2026-10-30, against `origin/main-dev` after feature 257 merged as `079870fa`):
- Keyset paging already landed in the ledger via features 257 and 263, so the extraction has no purpose.
  `queryEvents` is at `services/xstockstrat-ledger/src/grpc/ledgerServiceImpl.ts:166-240`.
  - `InvalidPageTokenError` (`:20`), `toSeq` (`:30`), `parseSequenceToken` (`:39`).
  - The request token is read at `:170`; a bad token returns `{ code: 3 }` with no query.
  - `ORDER BY sequence ASC` (`:223`); `QUERY_EVENTS_DEFAULT_PAGE_SIZE` / `QUERY_EVENTS_MAX_PAGE_SIZE` (`:14-15`);
    `nextPageToken` is the last row's `sequence` (`:233`); the `ownerOnly` predicate is at `:204`.
  - `rowToEvent` is exported at `:462`.
- The ledger test runner is now compile-then-test (`package.json`: `tsc && node --test dist/__tests__/*.test.js`;
  `test:db` runs `dist/__tests__/db/*.test.js`), so a strip-safe module is no longer a constraint.

**TDD**: `N/A (superseded)`

**Covers**: —

**Instructions**: Do not execute. 251 makes no ledger source change. Record the supersession in context.md.

**Verification**: none.

---

### Step 2 — SUPERSEDED: ledger keyset RED tests and `ledger-pg-test` CI job (already GREEN, job exists)

**Status**: `superseded`
**Service**: `xstockstrat-ledger`
**Files**: none

**Codebase Evidence** (re-spec 2026-10-30):
- AC-12 is held by `src/__tests__/db/queryPagination.db.test.ts` (`AC-1`, `:110`: the page-token walk returns every
  seeded row exactly once, ascending, against real TimescaleDB). It is stronger than 251's `(recorded_at, event_id)`
  ordering, because `sequence` is unique: the recorded_at-tie case cannot occur.
- AC-13 is held by `src/__tests__/ledgerServiceImpl.test.ts` (bad `page_token` rows at `~:386-396` → code 3 and no
  query; `@AC-7` omitted-token and `ownerOnly` + token cases nearby).
- A real-PG CI job already exists: `.github/workflows/ci.yml` `ledger-db-test` (`:705`), wired into `ci-gate`
  (`:895`, echo `:917`). The planned `ledger-pg-test` job, `queryEventsPage.test.ts` and
  `pg/queryEventsKeyset.test.ts` do not exist and must not be created: they would be GREEN on arrival, so they can
  never be a RED.

**TDD**: `N/A (superseded)`

**Covers**: `AC-12, AC-13` are covered by the existing tests above. The AC-12 wording "ordered by recorded_at then
event_id" is stale (the order is `sequence`); amend it per the Deviation Log.

**Instructions**: Do not execute.

**Verification**: none (the existing `pnpm run test:coverage` and the `ledger-db-test` CI job already run).

---

### Step 3 — SUPERSEDED: ledger keyset `page_token` (FR-5) (already implemented)

**Status**: `superseded`
**Service**: `xstockstrat-ledger`
**Files**: none

**Codebase Evidence** (re-spec 2026-10-30): see Step 1. The keyset `page_token` (opaque `sequence`, code 3 on a
malformed token) is in `ledgerServiceImpl.ts:166-240`, and ledger `CLAUDE.md:49` already documents it.

**TDD**: `N/A (superseded)`

**Covers**: `AC-12, AC-13` (via existing tests; see Step 2)

**Instructions**: Do not execute.

**Verification**: none.

---

### Step 4 — test: trading fill payloads carry `side`, the canonical source and `fees` (RED)

**Status**: `done`
**Service**: `xstockstrat-trading`
**Files**:
- `services/xstockstrat-trading/internal/service/trading_fill_side_test.go` — create

**Reviewers**: `xstockstrat-trading` owner — order execution correctness, broker API safety, fill detection, paper-only
dev invariant, position limit enforcement

**Codebase Evidence** (re-grepped 2026-10-30):
- Fill emits live in `applyBrokerOrderStatus` (`services/xstockstrat-trading/internal/service/trading.go:1799`):
  - `order.filled` at `:1832`: keys `order_id`, `symbol`, `qty`, `fill_price`, `user_id`, `trading_mode`,
    `account_id`, `fees`. No `side`.
  - `order.partially_filled` at `:1849`, with `filled_qty`, the same other keys and no `side`.
  - Both are fired with `go s.emitLedgerEvent(context.WithoutCancel(ctx), …)`.
- `emitLedgerEvent` (`:3743`) stamps `SourceService: "xstockstrat-trading"` (`:3749`) and `StreamKey: streamKey` (the
  bare `order.OrderId`). The other `"xstockstrat-trading"` literals (`:1970`, `:2222`, `:2824`, `:3136`, `:3419`) are
  direct `AppendEvent` sites, not fill payloads.
- `order.created` (`:680-681`) and `order.submitted` (`:696-697`) already carry `"side": order.Side.String()`.
- Drive path (symbols verified to exist): `notCancelableSvc` (`trading_cancel_not_cancelable_test.go:22`) with
  `reconcileNotCancelable` calling `applyBrokerOrderStatus`; driver precedent
  `TestCancelOrder_NotCancelable_BrokerFilled_AdoptsFillNotCanceled`; `recordingLedger` (`trading_offline_test.go:60`)
  and `requestsByType` (`:84`); `waitForAlert` (`trading_bracket_test.go:397`); `ctxAsUser`
  (`trading_ownership_test.go:21`).
- `trading_fees_test.go` and `trading_ledger_userid_test.go` copy the payload map by hand, so they cannot catch a
  producer regression. They are not extended.

**TDD**: `red-green required`

**Covers**: `AC-10` (and durable platform @AC-10 @feature-029: `fees` kept)

**Instructions**:
1. `trading_fill_side_test.go` is absent (verified). Add `TestFillEmit251_AC10_CarriesSideSourceAndFees`,
   table-driven over `{"filled", 10, "order.filled", "qty"}` and
   `{"partially_filled", 4, "order.partially_filled", "filled_qty"}`. Each row:
   - Build `svc, order := notCancelableSvc(fb, nil)`, set `order.Side = tradingv1.OrderSide_ORDER_SIDE_SELL` and
     `order.Symbol = "AAPL"`, and replace `svc.ledger` with `rec := &recordingLedger{}`.
   - The `fb.getOrderFn` returns the row's status and `FilledQty`.
   - Call `svc.CancelOrder(ctxAsUser("user-1"), &tradingv1.CancelOrderRequest{OrderId: "ord-1"})`.
   - Poll `rec.requestsByType(eventType)` for up to 2s (the `waitForAlert` shape) until one request appears.
   - Assert `SourceService == "xstockstrat-trading"` (the trading half of the Step 6 parity test) and
     `StreamKey == "ord-1"`.
   - Assert the payload `side == "ORDER_SIDE_SELL"`, the row's qty key equals the unsigned value, and the `fees` key
     is present.
2. C-13: the order literal comes from `notCancelableSvc`. The test adds no second inline domain literal.

**Verification**:
```bash
cd services/xstockstrat-trading && GOWORK=off go test ./internal/service/ -run TestFillEmit251_AC10 -race -count=1 -v   # RED (no side key)
GOWORK=off golangci-lint run --modules-download-mode=mod
grep -rn "func notCancelableSvc" --include="*_test.go" internal/service   # 1 declaration site (C-13)
```
The coverage threshold (≥ 40%) is enforced at paired GREEN Step 5, not here.

---

### Step 5 — service: trading adds `side` to both fill payloads

**Status**: `done`
**Service**: `xstockstrat-trading`
**Files**:
- `services/xstockstrat-trading/internal/service/trading.go` — modify

**Reviewers**: `xstockstrat-trading` owner — order execution correctness, broker API safety, fill detection, paper-only
dev invariant, position limit enforcement

**Codebase Evidence** (re-grepped 2026-10-30):
- `trading.go:1832` (`order.filled`) and `:1849` (`order.partially_filled`) payload maps, inside the `switch newStatus`
  of `applyBrokerOrderStatus` (`:1799`). `order` is `*tradingv1.Order`, so `order.Side` is in scope.
- `order.created` / `order.submitted` already emit `"side": order.Side.String()` (`:681`, `:697`); the other
  `order.Side.String()` hit at `:872` is not a fill payload.
- Trading-domain constraints (`step-constraints.md` §A): fills reach the ledger only via `applyBrokerOrderStatus` for
  ALPACA and IBKR alike; OFFLINE accounts never emit fills; both `FILLED` and `PARTIALLY_FILLED` branches change; no
  `PlaceOrder` path is touched.

**TDD**: `red-green required`. GREEN for Step 4.

**Covers**: —

**Instructions**:
1. In both branches, lift the payload map to a local `payload := map[string]interface{}{…}` (keys unchanged, `fees`
   kept). Then `if order.Side != tradingv1.OrderSide_ORDER_SIDE_UNSPECIFIED { payload["side"] = order.Side.String() }`,
   then `go s.emitLedgerEvent(context.WithoutCancel(ctx), "<type>", order.OrderId, order.UserId, payload)`.
2. `emitLedgerEvent` (`:3743`) stays unchanged. Persisted `filled_qty` and the reconciliation path are untouched
   (trading `@AC-1` @feature-206 PRESERVE).

**Verification**:
```bash
cd services/xstockstrat-trading && GOWORK=off go test ./internal/service/ -run 'TestFillEmit251_AC10|TestCancelOrder_NotCancelable|TestFillEmitsCarryBrokerFees' -race -count=1
export GOWORK=off && COVERPKGS=$(go list ./... | grep -Ev '/(cmd|handler|repository|telemetry|service)(/|$)' | tr '\n' ',' | sed 's/,$//') && go test ./... -race -count=1 -coverprofile=coverage.out -covermode=atomic -coverpkg="${COVERPKGS}" && go tool cover -func=coverage.out | grep "^total:"   # ≥ 40%
GOWORK=off golangci-lint run --modules-download-mode=mod
grep -n '"side"' internal/service/trading.go   # the two fill emits plus the pre-existing :681, :697, :872
```
New logic is in the `service` package, excluded from COVERPKGS; the Step 4 test is the gate.

---

### Step 6 — test: portfolio ledger fake, test shim, 257 test migration and RED GetPnL fold tests

**Status**: `done`
**Service**: `xstockstrat-portfolio`
**Files**:
- `services/xstockstrat-portfolio/internal/testdata/ledger.go` — create
- `services/xstockstrat-portfolio/internal/service/export_test.go` — create
- `services/xstockstrat-portfolio/internal/service/portfolio_quote_deadline_test.go` — modify
- `services/xstockstrat-portfolio/internal/service/getpnl_source_parity_test.go` — create
- `services/xstockstrat-portfolio/internal/service/portfolio_pnl_paging_test.go` — modify (feature 257 tests)

**Reviewers**: `xstockstrat-portfolio` owner — P&L calculation accuracy, position snapshot consistency, concurrent write
safety

**Codebase Evidence** (re-grepped 2026-10-30; GetPnL already changed on `main-dev` by feature 257):
- `testdata/ledger.go`, `export_test.go`, `getpnl_source_parity_test.go` are absent (verified). `internal/testdata/`
  holds `marks.go` and `offline_pnl.go`; `offline_pnl.go` never imports `internal/service` (no-cycle precedent).
- Current GetPnL: `portfolio_service.go:726-790`, two `collectFills` passes (`:796`) at `ledgerPnLPageSize = 1000`
  (`:793`) with `SourceService: "trading"` (`:802`, the bug) and fail-closed errors (`ErrLedgerUnavailable`, `:722`;
  `ErrQuotesUnavailable`, `:718`). `HydrateStops` is at `:530`. `orderFillPayload` is at `:245`.
- Feature 257's `portfolio_pnl_paging_test.go` (`TestGetPnL_AC3_*`, `AC4_*`, `AC6_*`) has its own `pagingLedger`
  (offset tokens, 200-row pages, ignores `SourceService` / `StreamKey`) and `pnlEvent` (no `side`; sells carry a
  signed `qty` / `filled_qty`). After Step 7, side-less fills are unattributable and the qty is unsigned plus `side`,
  so these tests must migrate here. They are the existing proof for AC-9 (multi-page fold-once) and the
  repeated-token row of AC-8.
- `newQuoteSvc` (`portfolio_quote_deadline_test.go:93`), `guard` (`:70`), `posRow` (`:84`), `pnlRows` (`:263`),
  `TestGetPnL_AC5_QuotesUnavailable` (`:268`), `TestGetPnL_AC6_BrokerValuedWithoutQuoteFetch` (`:293`); `anyArgs`
  (`portfolio_fill_errors_test.go:36`), `positionCols`, in-package `fillEvent` (`:24`); `fakeLedger`
  (`watchlist_service_test.go:254`), `ctxWithUser` (`:280`), `newFakeStore` (`:37`), `wideCaps` (`:362`), `stopLedger`
  (`portfolio_risk_test.go:143`); `stubMarketData` (`portfolio_service_test.go`).
- `LedgerEvent.sequence = 9` is global-monotonic; `QueryEventsRequest.time_range = 4`, `from_sequence = 6`
  (`packages/proto/ledger/v1/ledger.proto`). The ledger paginates by `sequence` (opaque token, code 3 on a bad one) and
  clamps the page at 1000.
- Producer stream keys are bare order ids; the producer source literal is `trading.go:3749`.
- AC-name convention: 251's tests use the `251` qualifier (`TestGetPnL251_AC<n>_…`) so they do not collide with the
  `AC3..AC6` names of 229/257.

**TDD**: `red-green required`

**Covers**: `AC-1, AC-2, AC-4, AC-5, AC-6, AC-8, AC-9, AC-11, AC-14, AC-15, AC-16, AC-17, AC-18`

**Instructions**:
1. **`internal/testdata/ledger.go`** (design.md §6A). Imports only ledgerv1, commonv1, grpc, status/codes, structpb.
   - `const TradingSourceService = "xstockstrat-trading"`.
   - `type Ledger struct { ledgerv1.LedgerServiceClient; Events []*ledgerv1.LedgerEvent; OnQuery func(ctx context.Context, req *ledgerv1.QueryEventsRequest) error; … }`
     with `Calls() int64` and `Requests()` (mutex-guarded copy of received requests, for the zero-lookup assertions).
   - `AppendEvent` is a no-op. `QueryEvents`: record the request; `Unimplemented` when `req.TimeRange != nil ||
     req.FromSequence != 0`; run `OnQuery`; return `status.FromContextError` when `ctx.Err() != nil`; filter
     `EventType` / `SourceService` / `StreamKey` only when set; keep slice order; PageSize 0 → 100 and clamp to 1000;
     paginate with an offset token; a malformed token → `codes.InvalidArgument`.
   - Builders `FilledEvent(seq int64, orderID, userID, symbol, accountID, mode string, qty, price float64, side string)`
     (`side == ""` omits the key; StreamKey = orderID; SourceService `TradingSourceService`), `PartialEvent(...)` with
     `filled_qty`, and `CreatedEvent(seq, orderID, symbol, side string, qty float64)` mirroring `order.created`
     (`trading.go:680`: no `order_id`, no `user_id` key).
2. **`internal/service/export_test.go`** (`package service`, 2-line constraint comment: an in-package `_test.go` must
   never import `internal/handler`). `WirePosition`, `NewWireTestService(t, ledger, positions...)` (based on
   `newQuoteSvc(t, &stubMarketData{}, 0)`, setting `svc.ledger`, `svc.watchlists = newFakeStore()`,
   `svc.wlCfg = wideCaps()`, always registering the `FROM portfolio.positions` expectation), `var CtxWithUser =
   ctxWithUser`, `var Guard = guard`.
3. **`getpnl_source_parity_test.go`**: `TestGetPnL251_SourceServiceParity` asserts
   `tradingSourceService == testdata.TradingSourceService == "xstockstrat-trading"`. The comment cites the producer at
   `trading.go:3749`; the trading half is Step 4.
4. **Migrate feature 257's tests** in `portfolio_pnl_paging_test.go`: `pnlEvent` gains a `side` argument and carries an
   unsigned `qty` / `filled_qty`; `alternatingFills`, the `AC6` partials (sell side, positive cumulative) and the `AC4`
   rows set `side`. Expected results are unchanged (250.00, 501.00). The `PageSize == 1000` assertion stays. Do not
   merge `pagingLedger` into `testdata.Ledger`: it needs no stream-key lookups, and the migration is the smaller diff.
5. **Fold tests** in `portfolio_quote_deadline_test.go` (design.md §6D), each `NewWireTestService(t, &testdata.Ledger{Events: …})`
   → `svc.GetPnL(CtxWithUser(t, "u-1"), req)` under `guard`, named `TestGetPnL251_AC<n>_…`:
   - **AC-1** side-less fills with `CreatedEvent` siblings (buy 10@100, sell 10@150) → 500.
   - **AC-2** buy filled 10@100; sell `PartialEvent` filled_qty 4@150; no sell `order.filled` → 200.
   - **AC-4** side-less fill, no sibling → `errors.Is(err, ErrFillUnattributable)` and a nil response.
   - **AC-5** u-1 fills carry `side`; u-2's orphan side-less fill is present → 500, and no recorded request has
     `StreamKey == "o-u2"`.
   - **AC-6** `OnQuery` errors on the 2nd call while the first page carries a token → `errors.Is(err, ErrLedgerUnavailable)`
     (the 257 sentinel is reused; no new sentinel).
   - **AC-8** (delta over 257's repeated-token test): two sub-tests, each `ErrLedgerUnavailable` — an event_id already
     returned on an earlier page, and an empty page that still carries a next token. Inline one-off stubs.
   - **AC-9**: covered by the migrated `TestGetPnL_AC3_FoldsEachFillOnceAcrossPages` (501 fills over 200-row pages,
     folded once). The scenario text "pages of 500 / exactly 2 calls" is stale: the page size is 1000 (257).
   - **AC-11** payload-`side` fills, no siblings → 500, and no recorded request has a non-empty `StreamKey`.
   - **AC-14** acct-1 buy 10@100, acct-2 buy 10@120, acct-1 sell 10@150 → 500 (a symbol-only fold gives 400).
   - **AC-15** AAPL fills with `account_id` "acct-1" and "" → `ErrFillUnattributable`.
   - **AC-16** F1: filled buy 10@100 (seq 1), partial-only sell 4@150 (seq 2), filled buy 10@200 (seq 3) → 200. F2:
     partial-only A buy 10@100 (seq 1), S sell 4@150 (seq 2), B buy 10@200 (seq 3), slice order A,B,S, fresh shim per
     iteration, 200 on all 20 runs; the F2 risk text from design.md §6D goes in a ≤ 2-line comment.
   - **AC-17** sell partial 4@150 then sell filled 10@150 → 500.
   - **AC-18** paper round trip plus a LIVE sell 10@300, `TradingMode: TRADING_MODE_PAPER` → 500.
6. Existing `TestGetPnL_AC5_*` / `AC6_*` keep `newQuoteSvc` and `fakeLedger` and stay green.
7. C-13: `FilledEvent` / `PartialEvent` / `CreatedEvent` have ≥ 2 consumers (this step plus Step 8) → `testdata`.

**Verification**:
```bash
cd services/xstockstrat-portfolio && GOWORK=off go vet ./internal/testdata/   # explicit path: ./... skips testdata
GOWORK=off go test ./internal/service/ -run 'TestGetPnL251' -race -count=1   # RED: compile (tradingSourceService, ErrFillUnattributable undefined) then behaviour
GOWORK=off golangci-lint run --modules-download-mode=mod
grep -rn "func FilledEvent\|func PartialEvent\|func CreatedEvent" --include="*.go" internal/   # 1 declaration site each
```
- The compile RED fails the whole `internal/service` test package until Step 7; say so in the step description
  (P-06/F-05). The coverage threshold is enforced at paired GREEN Step 7.
- Amend `acceptance.feature` AC-9 (page size 1000) and AC-12 (ordered by sequence) in separate single-file commits
  before this step's implementation commit (Deviation Log).

---

### Step 7 — service: GetPnL canonical source, side resolution, account-grain sequence-ordered fold

**Status**: `done`
**Service**: `xstockstrat-portfolio`
**Files**:
- `services/xstockstrat-portfolio/internal/service/portfolio_service.go` — modify

**Reviewers**: `xstockstrat-portfolio` owner — P&L calculation accuracy, position snapshot consistency, concurrent write
safety

**Codebase Evidence** (re-grepped 2026-10-30):
- `GetPnL` is at `portfolio_service.go:726-790`: it calls `s.collectFills(ctx, "order.filled", …)` (Pass 1) and
  `"order.partially_filled"` (Pass 2), builds `filledOrderIDs` / `latestPartials` (keeping the largest `|FilledQty|`;
  `abs()` is load-bearing) and folds unsigned `fill.Qty` / `fill.FilledQty` through `pnl.Fold(fills).Realized`.
- `collectFills` (`:796-846`) already drains fail-closed: `ErrLedgerUnavailable` on a QueryEvents error (`:806`) or a
  repeated page token (`:839`), `ledgerPnLPageSize = 1000` (`:793`), user filter, mode filter. It still passes
  `SourceService: "trading"` (`:802`), returns only payloads (no sequence or event_id), and has no seen-set.
- `orderFillPayload` (`:245`) has no `Side`; `pnl.Fill` has `Symbol`, signed `Qty`, `Price`
  (`packages/proto/pnl/pnl.go`); `Fold` keys by `Symbol`, so the composite key goes into `Symbol`.
- The ledger client uses `middleware.UnaryClientInterceptor`, so the side lookups on the existing edge propagate
  `x-user-id` / `x-access-scope` / `x-trace-id` (C-03). There is no new edge.
- Side-sign precedent: `offlineFillsFromOrders` in `trading.go` (grep `func offlineFillsFromOrders`); the new helper
  is stricter (UNSPECIFIED is unattributable).
- `golang.org/x/sync` is indirect only: lookups are sequential (F-08, `go.mod` untouched).
- Side-bearing siblings: `order.created` and `order.submitted` (Step 4 evidence), stream_key = bare order id.

**TDD**: `red-green required`. GREEN for Step 6.

**Covers**: —

**Instructions**:
1. Add `const tradingSourceService = "xstockstrat-trading"` and use it in `collectFills` and the sibling lookups. Add
   only `ErrFillUnattributable` (doc: FailedPrecondition, permanent; the ledger is immutable). Do not add
   `ErrRealizedUnavailable`: `ErrLedgerUnavailable` (257) is the retryable sentinel.
2. `orderFillPayload` gains `Side string \`json:"side"\``.
3. Extend `collectFills` to return each kept fill with its `ev.GetSequence()` and event_id. Add fail-closed detection of
   a repeated event_id (seen set) and an empty page that still carries a token, both wrapping `ErrLedgerUnavailable`.
   Unmarshal failures stay skipped. No page cap.
4. Keep the pipeline order: decode, user filter, mode filter, dedup (`filledOrderIDs` / `latestPartials`, unchanged),
   buffer with sequence. A partial in `latestPartials` stores its own latest sequence.
5. Side resolution runs over the caller's buffered fills only: a payload `side` is used directly; otherwise
   `s.orderSide(ctx, orderID)` queries `QueryEvents{StreamKey: orderID, EventType: "order.created", SourceService:
   tradingSourceService, Page{PageSize: 1}}`, then `"order.submitted"`, sequentially per distinct order id. Cache
   positive answers only in a zero-value-safe `sideCache map[string]string` under its own `sideCacheMu sync.Mutex`.
   A lookup transport error wraps `ErrLedgerUnavailable`; the first order with no resolvable side returns
   `ErrFillUnattributable`. `signedQty(side string, qty float64) (float64, bool)` accepts only `"ORDER_SIDE_BUY"`
   (+qty) and `"ORDER_SIDE_SELL"` (−qty).
6. Account rule per (normalised mode, symbol) group of the caller's fills: all non-empty `account_id` → key
   `mode|account|symbol`; none → `mode||symbol`; mixed → `ErrFillUnattributable`.
7. `sort.SliceStable` the kept fills by sequence, build `[]pnl.Fill{Symbol: key, Qty: signed, Price}` and `pnl.Fold`.
   The unrealized computation stays unchanged and still runs first.
8. Do not touch `HydrateStops` (`:530`) or `processOrderFill`.

**Verification**:
```bash
cd services/xstockstrat-portfolio && GOWORK=off go test ./internal/service/ -run 'TestGetPnL' -race -count=1 -v   # 251 + 229 + 257 GetPnL tests green
export GOWORK=off && COVERPKGS=$(go list ./... | grep -Ev '/(cmd|handler|repository|telemetry|service)(/|$)' | tr '\n' ',' | sed 's/,$//') && go test ./... -race -count=1 -coverprofile=coverage.out -covermode=atomic -coverpkg="${COVERPKGS}" && go tool cover -func=coverage.out | grep "^total:"   # ≥ 40%
GOWORK=off golangci-lint run --modules-download-mode=mod
grep -n 'SourceService: "trading"' internal/service/portfolio_service.go; test $? -eq 1
```
New GetPnL logic is in `service`, excluded from COVERPKGS; `internal/testdata` is not in COVERPKGS either.

---

### Step 8 — test: portfolio adapter wire tests and error-mapping tables (RED)

**Status**: `done`
**Service**: `xstockstrat-portfolio`
**Files**:
- `services/xstockstrat-portfolio/internal/service/portfolio_grpc_wire_test.go` — create
- `services/xstockstrat-portfolio/internal/handler/portfolio_handler_test.go` — modify

**Reviewers**: `xstockstrat-portfolio` owner — P&L calculation accuracy, position snapshot consistency, concurrent write
safety

**Codebase Evidence** (re-grepped 2026-10-30):
- `portfolio_grpc_wire_test.go` is absent (verified); `portfolio_handler_test.go` exists.
- Handler: `GetPnL` checks `callerUserID(ctx) == ""` → InvalidArgument, then
  `connect.NewError(classifyGetPnLError(err), err)` (`portfolio_handler.go:127`); `classifyGetPnLError(err error)` is
  at `:426` (maps `ErrQuotesUnavailable` and `ErrLedgerUnavailable` to Unavailable, else Internal); `toGRPCError` is
  at `:433` and maps only InvalidArgument / NotFound / PermissionDenied / Unavailable, so everything else is
  `codes.Internal`. For `GRPCHandler()` and the `DeleteWatchlist` / `EnsureSignalWatchlist` adapters grep those names
  in the handler.
- `TestClassifyGetPnLError` (`portfolio_handler_test.go:~37-57`): one-arg calls at `:40` (wrapped
  `ErrQuotesUnavailable`), `:45` and `:48` (wrapped `ErrLedgerUnavailable`, feature 257 @AC-4), `:51` (generic →
  CodeInternal); `toGRPCError(Unavailable)` at `:54`. It backs durable portfolio @AC-5. grep `func TestToGRPCError`
  finds none.
- `DeleteWatchlist` returns `CodeFailedPrecondition` for a system-managed list; the fake is in
  `watchlist_service_test.go` (`fakeWatchlistStore`). Durable platform @AC-7 @feature-127
  (`docs/sdd/business-rules/platform.feature`).
- pgxmock's random select can skip the ledger stage on a pre-done ctx (design.md §6C), so the cancel and deadline cases
  start from a live ctx.

**TDD**: `red-green required`

**Covers**: `AC-4, AC-6, AC-7` (plus durable portfolio @AC-5 EXTEND and platform @AC-7 @feature-127 PRESERVE)

**Instructions**:
1. `portfolio_grpc_wire_test.go` (`package service_test`; imports `internal/handler`, `internal/service` shim,
   `internal/testdata`): `a := handler.NewPortfolioHandler(svc).GRPCHandler()`; assert `status.Code(err)`.
   - (1) `TestWire251_AC4_UnresolvedSideFailedPrecondition`: side-less fill, no sibling → `FailedPrecondition`.
   - (2) `TestWire251_AC6_LedgerErrorUnavailable`: `OnQuery` returns a plain error → `Unavailable`.
   - (3) `TestWire251_AC7_CallerCancel`: live ctx; `OnQuery` calls `cancel()` then returns `ctx.Err()` → `Canceled`.
   - (4) `TestWire251_AC7_CallerDeadline`: 200ms timeout, `OnQuery` blocks on `<-ctx.Done()`, under `service.Guard` →
     `DeadlineExceeded`.
   - (5) `TestWire_DeleteSystemManagedWatchlist_F127AC7`: seed via `EnsureSignalWatchlist`, then `DeleteWatchlist` →
     `FailedPrecondition`.
   - (6) `TestWire251_MissingUserIDInvalidArgument`: `context.Background()` → `InvalidArgument`.
   - (7) `TestWire_GetPnLQuoteGap_F229AC5`: `WirePosition{Current: 0}` with the zero-value `stubMarketData` and a live
     ctx → `Unavailable`.
2. `portfolio_handler_test.go`, `TestClassifyGetPnLError` (keep the name): change the calls at `:40`, `:45`, `:48`,
   `:51` to `classifyGetPnLError(context.Background(), …)` with the same expectations; keep the `toGRPCError`
   assertions. Add rows: (expired ctx, wrapped `ErrQuotesUnavailable`) → CodeDeadlineExceeded; (cancelled ctx) →
   CodeCanceled; (live ctx, wrapped `service.ErrFillUnattributable`) → CodeFailedPrecondition. The live-ctx
   `ErrLedgerUnavailable` → CodeUnavailable row already exists (257). Add table-driven `TestToGRPCError`: the 4
   existing codes, FailedPrecondition / DeadlineExceeded / Canceled, and a non-connect error → `codes.Internal`.
3. C-13: fixtures come from `internal/testdata` (Step 6).

**Verification**:
```bash
cd services/xstockstrat-portfolio && GOWORK=off go test ./internal/... -run 'TestWire|TestClassifyGetPnLError|TestToGRPCError' -race -count=1 -v   # RED: compile (arity) + FailedPrecondition/DeadlineExceeded/Canceled → Internal
GOWORK=off golangci-lint run --modules-download-mode=mod
grep -rn "func FilledEvent" --include="*.go" internal/   # still 1 declaration site
```
- The arity change fails the `internal/handler` test package, and the wire test fails `service_test`, until Step 9
  (P-06/F-05). The coverage threshold is enforced at paired GREEN Step 9.

---

### Step 9 — service: ctx-first `classifyGetPnLError` and explicit `toGRPCError` codes

**Status**: `done`
**Service**: `xstockstrat-portfolio`
**Files**:
- `services/xstockstrat-portfolio/internal/handler/portfolio_handler.go` — modify

**Reviewers**: `xstockstrat-portfolio` owner — P&L calculation accuracy, position snapshot consistency, concurrent write
safety

**Codebase Evidence** (re-grepped 2026-10-30):
- `portfolio_handler.go:127` is the ONLY `classifyGetPnLError` call site; the definition is at `:426` (takes only
  `err`, not ctx-first) and `toGRPCError` at `:433`.
- Precedent: `services/xstockstrat-trading/internal/handler/trading.go` (explicit `CodeFailedPrecondition` case; grep
  `CodeFailedPrecondition` there for the current line).
- Behaviour changes, intended per design.md §3: `DeleteWatchlist` on a system-managed list reaches the wire as
  FAILED_PRECONDITION (browser 500 → 400, `services/xstockstrat-ui/src/lib/connectClients.ts`); a caller whose
  deadline is ≤ `quote_timeout_ms` now sees DEADLINE_EXCEEDED.

**TDD**: `red-green required`. GREEN for Step 8.

**Covers**: —

**Instructions**:
1. `classifyGetPnLError(ctx context.Context, err error) connect.Code`, precedence: `ctx.Err()` DeadlineExceeded →
   `CodeDeadlineExceeded`, Canceled → `CodeCanceled`; `ErrQuotesUnavailable` or `ErrLedgerUnavailable` →
   `CodeUnavailable`; `ErrFillUnattributable` → `CodeFailedPrecondition`; otherwise `CodeInternal`. Update the doc
   comment and the call site `:127` to `classifyGetPnLError(ctx, err)`.
2. `toGRPCError` keeps its `(err error)` signature and adds explicit `CodeFailedPrecondition`, `CodeDeadlineExceeded`
   and `CodeCanceled` cases. No numeric pass-through.

**Verification**:
```bash
cd services/xstockstrat-portfolio && GOWORK=off go test ./... -race -count=1   # Step 8 GREEN, all green
export GOWORK=off && COVERPKGS=$(go list ./... | grep -Ev '/(cmd|handler|repository|telemetry|service)(/|$)' | tr '\n' ',' | sed 's/,$//') && go test ./... -race -count=1 -coverprofile=coverage.out -covermode=atomic -coverpkg="${COVERPKGS}" && go tool cover -func=coverage.out | grep "^total:"   # ≥ 40%
GOWORK=off golangci-lint run --modules-download-mode=mod
grep -n "classifyGetPnLError(" internal/handler/portfolio_handler.go   # definition + one call site, both 2-arg
```
The logic is in the excluded `handler` package; the Step 8 tests are the gate.

---

### Step 10 — test: UI lineage RED (vitest + Playwright), fixtures and mock backend

**Status**: `done`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/lib/positionLineage.test.ts` — create
- `services/xstockstrat-ui/e2e/trader/position-lineage.spec.ts` — create
- `services/xstockstrat-ui/e2e/fixtures/ledgerEvents.ts` — modify
- `services/xstockstrat-ui/e2e/fixtures/orders.ts` — modify
- `services/xstockstrat-ui/e2e/fixtures/INVENTORY.md` — modify
- `services/xstockstrat-ui/e2e/mock-backend.ts` — modify
- `services/xstockstrat-ui/e2e/trader/positions.spec.ts` — modify
- `services/xstockstrat-ui/e2e/trader/api-smoke.spec.ts` — modify

**Reviewers**: `xstockstrat-ui` owner — trading UI correctness, analytics display accuracy, config mutation safety,
Connect-RPC call safety, environment (`production`/`staging`) scope correctness, no secret values rendered in UI, no
direct DB access (except audit log)

**Codebase Evidence** (re-grepped 2026-10-30; feature 263 changed the BFF):
- Hook `src/hooks/usePositionLineage.ts:19` still queries `{eventType: 'order.filled', sourceService: 'trading',
  page: {pageSize: 100, pageToken: ''}}` and filters client-side; the `:7` comment says `"trading"`. Called from
  `src/app/trader/positions/page.tsx:110`.
- **BFF already owner-scopes (feature 263).** `src/lib/traderBff.ts` `queryEvents` (`:129-147`) forces
  `ownerOnly: true` on every non-copilot, non-account stream, so other users' `order.filled` events are already dropped
  server-side. The planned BFF backstop and `isForeignFillEvent` are redundant and are removed from this feature
  (Deviation Log). `e2e/trader/ledger-owner-scope.spec.ts` and the mock's `ownerOnly` filter (default `order.filled`
  branch of `mock-backend.ts` `queryEvents`, `OWNER_SCOPE_ORDER_FILLED_EVENTS`) already cover it.
- `src/lib/tradingMode.ts` exports `toPbTradingMode(mode: EnvironmentMode | null)` (null → UNSPECIFIED); the lineage
  uses it. `CardNotice` is at `src/components/shared/CardNotice.tsx`.
- Trading proto: `ListOrdersRequest` has `trading_mode = 6`, `symbol = 7`, `account_id = 10`
  (`packages/proto/trading/v1/trading.proto`); BFF `listOrders` (`traderBff.ts:39`) pins the caller's user.
- Mock backend: `listOrders` is at `e2e/mock-backend.ts:327-332` (symbol-only filter over `ORDERS`). The default
  `queryEvents` branch no longer has an inline `sourceService: 'trading'` literal (grep finds none in the file).
- Fixtures: `e2e/fixtures/ledgerEvents.ts` (`LEDGER_EXPORT_EVENTS`, `OWNER_SCOPE_ORDER_FILLED_EVENTS` with a
  `TEST_USER_B_ID` foreign row), `e2e/fixtures/orders.ts` (`ORDER_FILLED` `:17`, `ORDERS` `:84`), `INVENTORY.md` ledger
  row `:24` and the inline-branches row `:83`.
- Existing lineage specs: `e2e/trader/positions.spec.ts:112-160` intercepts "the lineage query (no streamKey)" with
  an inline `sourceService: 'trading'` row (`:147`) and `streamKey: 'order:…'`; `e2e/trader/api-smoke.spec.ts:192-215`
  posts `sourceService: 'trading'` (`:207`). Other `sourceService: 'trading'` hits (`e2e/fixtures/alerts.ts`) are
  alert fixtures, unrelated.
- `e2e/trader/position-lineage.spec.ts` and `src/lib/positionLineage*.ts` are absent (verified). vitest scope is
  `src/**/*.test.ts` with coverage over `src/lib/**` excluding `*Bff.ts`.

**TDD**: `red-green required`

**Covers**: `AC-3, AC-18, AC-19, AC-20, AC-21, AC-22`

**Instructions**:
1. **`src/lib/positionLineage.test.ts`** (vitest, RED: module missing). Imports `{ LINEAGE_MAX_ORDERS,
   fetchPositionLineage }` from `./positionLineage`; stub data from `LINEAGE_ORDERS` / `LINEAGE_FILL_EVENTS` by
   relative path (C-12).
   - (a) it passes `{symbol, accountId, tradingMode}` plus `page.pageSize = LINEAGE_MAX_ORDERS + 1` to `listOrders`;
   - (b) one `queryEvents({streamKey: orderId, eventType: 'order.filled', sourceService: 'xstockstrat-trading'})` per
     order, at most 50, in-flight ≤ 3;
   - (c) 51 orders → `truncated: true`, 50 queried (AC-21);
   - (d) an order with status NEW is still queried and its fill returned (AC-22).
2. **Fixtures** (C-12). Reuse `OWNER_SCOPE_*` rows and `TEST_USER_B_ID` where they fit. Add to `ledgerEvents.ts`
   `LINEAGE_FILL_EVENTS` (u-1 `o-buy` AAPL 10@100 on `BROKER_ACCOUNT_ALPACA.id` paper; u-2 `o-other` AAPL 5@120; a LIVE
   u-1 fill; `o-stale`; all `sourceService: 'xstockstrat-trading'` with bare-id `streamKey` and a row `userId`) and
   `lineageOtherUserFills(n)` for AC-19. Add `LINEAGE_ORDERS` to `orders.ts` as spreads of `ORDER_FILLED`, including
   `o-stale` status 1 and the LIVE order `tradingMode: 2`; `ORDERS` is unchanged. Add `INVENTORY.md` rows next to `:24`
   and update `:83`.
3. **`e2e/mock-backend.ts`**: `listOrders` appends `LINEAGE_ORDERS` only when `req.page?.pageSize ===
   LINEAGE_MAX_ORDERS + 1`, filtered by `symbol` / `accountId` / `tradingMode` when set. `queryEvents`: add a branch
   before the `ownerOnly` default for `req.eventType === 'order.filled'` with `req.streamKey`, returning the matching
   `LINEAGE_FILL_EVENTS` rows filtered like the 263 default (`!req.ownerOnly || r.userId === TEST_USER_ID`); without a
   `streamKey` it returns `lineageOtherUserFills(100)` and `nextPageToken: 'p2'` so the old platform-wide read misses
   u-1. Existing specs' default responses stay unchanged.
4. **`e2e/trader/position-lineage.spec.ts`** (new, `addAuthCookie`): AC-3 sheet lists `o-buy` 10@100 and no
   intercepted QueryEvents body contains u-2; AC-18 paper sheet omits the LIVE fill; AC-19 `o-buy` is listed although
   the unfiltered page holds 100 other-user events; AC-20 a `page.evaluate` fetch to
   `/trader/api/xstockstrat.ledger.v1.LedgerService/QueryEvents` with `{streamKey: 'o-other', eventType: 'order.filled'}`
   returns no u-2 event (server-side `ownerOnly`: a PRESERVE guard, GREEN at once); AC-21 `page.route` on ListOrders
   returns 51 `{...ORDER_FILLED, orderId}` spreads, the truncation notice is visible and ≤ 50 lineage QueryEvents
   requests are seen; AC-22 `o-stale` is listed.
5. **`positions.spec.ts:~129-138`**: intercept on `body.eventType === 'order.filled'` instead of "no streamKey", and
   take the row from a `{...LINEAGE_FILL_EVENTS[0], …}` spread instead of the `:147` literal. **`api-smoke.spec.ts:207`**:
   post `{eventType: 'order.filled', sourceService: 'xstockstrat-trading', streamKey: 'o-buy'}`.

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm run test:unit -- src/lib/positionLineage.test.ts   # RED (module missing)
pnpm exec playwright test e2e/trader/position-lineage.spec.ts   # RED on AC-3/19/21/22 (AC-20 is a GREEN preserve guard)
pnpm run lint
grep -n "LINEAGE_FILL_EVENTS\|LINEAGE_ORDERS" e2e/fixtures/INVENTORY.md
```
The coverage threshold (vitest `src/lib/**` lines ≥ 40%) is enforced at paired GREEN Step 11.

---

### Step 11 — service: user-pinned lineage via ListOrders and truncation notice

**Status**: `done`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/lib/positionLineage.ts` — create
- `services/xstockstrat-ui/src/hooks/usePositionLineage.ts` — modify
- `services/xstockstrat-ui/src/app/trader/positions/page.tsx` — modify

**Reviewers**: `xstockstrat-ui` owner — trading UI correctness, analytics display accuracy, config mutation safety,
Connect-RPC call safety, environment (`production`/`staging`) scope correctness, no secret values rendered in UI, no
direct DB access (except audit log)

**Codebase Evidence** (re-grepped 2026-10-30):
- `usePositionLineage.ts` (whole file, 33 lines). Browser clients: `ledgerClient`
  (`src/lib/browserClients/ledgerClient.ts`) and `tradingClient` (`src/lib/browserClients/tradingClient.ts`); the
  `listOrders` call precedent is `src/hooks/useOrders.ts:39`.
- `traderBff.ts` is NOT changed (owner scoping landed in feature 263; see Step 10).
- A concurrency helper is **Not found** (grep `concurren|pLimit|mapLimit` over `src`), so a minimal worker loop goes in
  `positionLineage.ts`. `toPbTradingMode` is in `src/lib/tradingMode.ts`.
- `CardNotice` (`src/components/shared/CardNotice.tsx`, import precedent `src/components/trader/OrderBook.tsx`) is the
  canonical notice primitive (C-17). Page sites: `page.tsx:110` (hook call), `:330` (`lineageColumns`), `:676-692`
  (sheet section; empty state "No order.filled events for this position.").

**TDD**: `red-green required`. GREEN for Step 10.

**Covers**: —

**Instructions**:
1. Create `src/lib/positionLineage.ts`: `export const LINEAGE_MAX_ORDERS = 50` and
   `export async function fetchPositionLineage(deps: { listOrders; queryEvents }, args: { symbol; accountId; mode })`.
   It calls `listOrders({symbol, ...(accountId ? {accountId} : {}), tradingMode: toPbTradingMode(mode), page: {pageSize: LINEAGE_MAX_ORDERS + 1, pageToken: ''}})`,
   takes the first 50 orders, then runs `queryEvents({streamKey: o.orderId, eventType: 'order.filled', sourceService: 'xstockstrat-trading', page: {pageSize: 10, pageToken: ''}})`
   at concurrency 3, and returns `{ events, truncated }`.
2. `usePositionLineage.ts` calls `fetchPositionLineage({listOrders: tradingClient.listOrders, queryEvents: ledgerClient.queryEvents}, …)`
   with `staleTime: 60_000`. Replace the `:7` comment with a ≤ 2-line constraint form that omits the old literal.
3. `page.tsx`: read `lineage.data?.events`; when `lineage.data?.truncated`, render
   `<CardNotice>Showing fills for the latest 50 orders only.</CardNotice>` above the table; update the
   `lineageColumns` element type (`:330`).

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm run test:coverage   # vitest src/lib threshold ≥ 40%, Step 10 unit GREEN
pnpm exec playwright test e2e/trader/position-lineage.spec.ts e2e/trader/positions.spec.ts e2e/trader/api-smoke.spec.ts   # GREEN
pnpm run lint
grep -rn "sourceService: 'trading'" src e2e/trader; test $? -eq 1   # e2e/fixtures/alerts.ts alert rows are unrelated
```

---

### Step 12 — docs: teardown reconciliation (stream-key drift, ctx-first wording, side resolution, findings)

**Status**: `pending`
**Service**: `docs` (service CLAUDE.md files and module constitutions)
**Files**:
- `services/xstockstrat-portfolio/CLAUDE.md` — modify
- `services/xstockstrat-portfolio/docs/context-constitution.md` — modify
- `services/xstockstrat-portfolio/docs/context-constitution-findings.md` — modify
- `services/xstockstrat-trading/CLAUDE.md` — modify
- `services/xstockstrat-ledger/CLAUDE.md` — modify

**Reviewers**: none

**Codebase Evidence** (re-grepped 2026-10-30):
- Portfolio `CLAUDE.md`: `:28-29` already says `ErrQuotesUnavailable` → `classifyGetPnLError` → UNAVAILABLE and that a
  ledger page error / deadline / repeated token is UNAVAILABLE (`ErrLedgerUnavailable`, 257). The § Ledger Events
  Consumed `order.filled` row is `:118` (live consumer only); `order.partially_filled` is `:119`. PORTFOLIO-16 is at
  `services/xstockstrat-portfolio/docs/context-constitution.md:34`.
- Trading `CLAUDE.md:146-162` documents `order:{order_id}` for `order.*` events; production writes the bare id
  (`emitLedgerEvent` callers pass `order.OrderId` / `orderID`). `order.approval_requested` (`:153`) documents
  `approval:{order_id}` but emits the bare id; `order.approved` (`:154`) has no emit site; `order_intent.*`
  (`:161-162`) does use the prefix.
- Ledger `CLAUDE.md:34` (`order:{id}`) and `:112` (`order:{order_id}`). `QueryEvents` `page_token` is already
  documented at `:49`; no edit needed for it.
- Findings candidates (design.md §7): `GetPnL` ignores `req.Range` for realized (echoes it only); `HydrateStops` reads
  page 1 only (`portfolio_service.go:530`); DeleteWatchlist 500 → 400 and short-deadline DEADLINE_EXCEEDED are
  intended.
- Root `CLAUDE.md` § Teardown requires `/context-forge:context-constitution refresh`, or a manual reconciliation
  recorded in the PR body.

**TDD**: `N/A (docs)`

**Covers**: —

**Instructions**:
1. Portfolio `CLAUDE.md`: `:28-29` ctx-first mapping (DEADLINE_EXCEEDED/CANCELED first; UNAVAILABLE for quote and
   ledger read gaps; FAILED_PRECONDITION for unattributable fills). `:118` add `GetPnL` (query time) as a second
   `order.filled` consumer with the `side` resolution order (payload, `order.created`, `order.submitted`). `:119` same
   side rule plus the account-grain sequence-ordered fold.
2. PORTFOLIO-16 (`context-constitution.md:34`): reflect `classifyGetPnLError(ctx, err)` precedence. Add findings
   entries for the `req.Range`, HydrateStops page-1 and wire-code changes.
3. Trading `CLAUDE.md:146-159`: stream-key column of every emitted `order.*` row to the bare `{order_id}`, including
   `order.approval_requested`; leave `order.approved` (no emit site) and `order_intent.*` (`:161-162`) unchanged.
4. Ledger `CLAUDE.md:34` and `:112`: bare order id for trading `order.*` events; `order:{order_id}` stays for
   `order_intent.*`.
5. Run `/context-forge:context-constitution refresh` scoped to these files; if unavailable, reconcile by hand and
   record both facts in the PR body (root `CLAUDE.md` § Teardown).

**Verification**:
```bash
grep -n "order:{order_id}\|order:{id}\|approval:{order_id}" services/xstockstrat-trading/CLAUDE.md services/xstockstrat-ledger/CLAUDE.md   # only order_intent.* rows and order.approved remain
grep -n "classifyGetPnLError" services/xstockstrat-portfolio/CLAUDE.md services/xstockstrat-portfolio/docs/context-constitution.md
```

---

### Step 13 — docs: peer reconciliation note in merge-order.md

**Status**: `pending`
**Service**: `docs/roadmap/features/`
**Files**:
- `docs/roadmap/features/merge-order.md` — modify

**Reviewers**: none

**Codebase Evidence** (re-grepped 2026-10-30):
- `merge-order.md:81` already holds the hard row `fix-getpnl-source-service (251)` after `fix-ledger-query-pagination (257)`
  (257 merged as `079870fa`, #1371). 252 `fix-identity-ledger-test-suites` is `launched`, so the planned 252 context
  note and the 252 rebase duties are moot; 251 no longer edits the ledger runner, ledger tests or `ci.yml`.
- Rebase-only note precedent: `merge-order.md:166` (252 ↔ 248 …); the last note is followed by `---` at `:179`.
- Remaining peer overlaps (shared files, no field/migration/key collision): 249 and 241 on `trading.go` and trading
  `CLAUDE.md` / `INVENTORY.md`. Verify each peer's `status.md` at execute time and skip a peer that is `launched`.

**TDD**: `N/A (docs)`

**Covers**: —

**Instructions**:
1. Insert a blockquote in the `:166` format after the last note and before the `---` at `:179`, titled
   `Note on 251 fix-getpnl-source-service ↔ 249 / 241 — rebase-only, no hard ordering row.` Bullets: 249 ↔ 251 on
   `trading.go` / trading `CLAUDE.md` / `INVENTORY.md` (line-disjoint, anchors shift); 241 ↔ 251 on `trading.go`
   (241 edits `escalateSystemic`; 251 edits only `applyBrokerOrderStatus`, so 241's `implementation-spec.md` claim
   that 251 edits the `SourceService` literal there is stale). Drop any peer that is already `launched`.

**Verification**:
```bash
grep -n "fix-getpnl-source-service" docs/roadmap/features/merge-order.md
```

---

### Promotion gate PG-1 — ship gate and dev smoke (post-deploy, outside the step counter, blocks promotion)

`/sdd-execute` does not run PG-1. It reads live dev/prod, and the access path under fail-closed mTLS is unresolved
(escalate per P-03). PG-1 blocks the `main-dev` → `main` promotion of 251; its results go in context.md.

**Status**: `pending`
**Service**: `docs/roadmap/features/251-fix-getpnl-source-service/`
**Files**:
- `docs/roadmap/features/251-fix-getpnl-source-service/context.md` — modify

**Reviewers**: none

**Codebase Evidence**:
- Thresholds: 500ms per query and 5s aggregate (= `ledgerEmitTimeout / 2`,
  `services/xstockstrat-trading/internal/service/trading.go:3657`).
- The ledger pool is direct `:25060`, 2 conns (1 query + 1 LISTEN; root `CLAUDE.md` § Connection Pool Budget), so
  F-06 forbids raising it without a re-check.
- Fail-closed inter-service mTLS (feature 210, `docs/patterns/inter-service-mtls.md`).

**TDD**: `N/A (operational gate; read-only)`

**Covers**: —

**Instructions**:
1. Run this after trading `side` is live on dev and prod, read-only, and record results in context.md. Escalate
   anything over threshold (P-03).
   - (i) Per-type counts of `order.filled` / `order.partially_filled` / `order.created`.
   - (ii) Fill stream keys with no side-bearing sibling.
   - (iii) Mixed user+symbol groups and empty-`account_id` fills; the users/groups that would hit AC-4/AC-15
     (permanent FAILED_PRECONDITION), with a remediation path.
   - (iv) EXPLAIN ANALYZE of the first and a next page (chunk exclusion for the cursor expression; fallback is a
     timestamptz text parameter), one stream-key lookup and the chunk count. Also a cold-cache full GetPnL including
     the platform-wide `order.filled` drain, and AppendEvent latency under concurrent cold GetPnL calls.
2. Dev smoke, which blocks promotion:
   - drain `QueryEvents{sourceService:'xstockstrat-trading'}` at pageSize 50 against a read-only SELECT (equal
     counts, 0 duplicates, 0 missing);
   - `GetPnL` OK for a dev user;
   - one malformed token → INVALID_ARGUMENT on the real gRPC path.
   The access path must satisfy fail-closed mTLS; if none exists, escalate (P-03).

**Verification**:
```bash
grep -n "ship gate\|dev smoke" docs/roadmap/features/251-fix-getpnl-source-service/context.md
```
The (i)-(iv) results are recorded, each within threshold or escalated.

---

## Deviation Log

_Populated by /sdd-execute as implementation proceeds._

- 2026-10-30 (re-spec): Steps 1-3 superseded by features 257/263 (ledger `sequence` keyset already shipped).
- 2026-10-30 (re-spec): `ErrRealizedUnavailable` dropped; `ErrLedgerUnavailable` (257) is reused. Added only `ErrFillUnattributable`.
- 2026-10-30 (re-spec): acceptance wording drift to amend in `acceptance.feature` at Step 6 (own commits): AC-9 ("pages of 500", "exactly 2 calls"; the page size is now 1000) and AC-12 ("ordered by recorded_at then event_id"; the order is `sequence`).
- 2026-10-30 (step 5): Lint gate unrunnable (golangci-lint built with go1.26, module targets 1.27); `gofmt -l` and `go vet ./internal/service/` clean instead. The spec's `context.Background()` wording was already corrected to `context.WithoutCancel(ctx)`; `"side"` grep also hits the pre-existing `:872`.
- 2026-10-30 (steps 6+7 merged): Operator standing rule (2026-10-29, "Merge pairs + standing rule"): Step 6's RED tests reference `tradingSourceService` and `ErrFillUnattributable`, which exist only after Step 7, so the `internal/service` test package cannot compile between them. Executed as ONE commit with one red (compile failure) to green cycle; both steps marked done. No files outside the two steps' Files. Other deltas: `acceptance.feature` AC-9/AC-12 amended in their own commit first; the parity-test comment cites `trading.go:3676` (spec said `:3749`); `NewWireTestService` registers 3-arg and 4-arg `FROM portfolio.positions` expectations because a trading-mode filter adds an argument; Step 7 logic lives in new helpers `realizedPnL`/`orderSide` called from `GetPnL`; golangci-lint is unrunnable (built with go1.25, module targets 1.27), so `gofmt -l` and `go test ./... -race` were run instead.
- 2026-10-30 (re-spec): UI BFF backstop and `isForeignFillEvent` dropped (feature 263 forces `ownerOnly: true` in `traderBff.ts`); AC-20 becomes a preserve guard.
- 2026-10-30 (step 10): Mock `queryEvents` branch is narrower than the spec text, to keep feature 263's `ledger-owner-scope.spec.ts` AC-2/AC-7 (an `order.filled` read with no `streamKey` and no `sourceService`) on the 263 default data. The lineage branch handles `order.filled` with a `streamKey` (that order's rows, `ownerOnly`-filtered) or with a `sourceService` but no `streamKey` (`lineageOtherUserFills(100)` plus `nextPageToken: 'p2'`, so the old platform-wide read misses u-1). Other deltas: the 263 default branch had no inline `sourceService: 'trading'` literal, so only `positions.spec.ts` and `api-smoke.spec.ts` carried one; the mock imports a fixture constant `LINEAGE_LIST_PAGE_SIZE` (51) from `e2e/fixtures/orders.ts` instead of `LINEAGE_MAX_ORDERS + 1` from `src/lib/positionLineage.ts`, because that module does not exist until Step 11 and importing it would break every Playwright spec; Step 11 may swap the constant for the import; the mock's ledger-row mapping was extracted into one `ledgerEventMsg` helper shared by both branches (DRY); `positions.spec.ts` fulfils the order.filled intercept only for the first order's stream (or no stream), so the long order id renders once under the per-order read. The Step 10 commit is RED by design (vitest: module missing; Playwright AC-3/18/19/21/22 fail, AC-20 preserve guard passes).
