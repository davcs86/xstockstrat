# Implementation Spec: fix-portfolio-internal-position

**Status**: `pending`
**Created**: 2026-11-17
**Feature**: `docs/roadmap/features/357-fix-portfolio-internal-position/feature.md`
**Total Steps**: 9
**Feature Branch**: `feature/fix-portfolio-internal-position`
**Severity**: SEV-2
**Grounded in**: `design.md` (Chosen Approach, mandatory), `recon.md` (Codebase Map + Patterns to REUSE), tree `origin/feature/fix-portfolio-internal-position@7d658ef7`

---

## Execution Summary

The fix stays in the `xstockstrat-portfolio` service layer (design.md § Chosen Approach). `internal/repository/portfolio_repo.go`, the SQL, the cursor codec, the proto, feature 353's `internal/repository/dbtest_helpers_test.go`, and features 351, 353 and 354 are not touched. The work runs as three red→green atomic units, then two docs steps:

1. **Unit A (Steps 1–3), RPC readers.** Write the pgxmock RED tests for `GetPortfolio`/`GetPnL` (AC-1 rows 1–2, AC-2, AC-3, AC-4) and the 501-row real-DB dbtest plus the CI package-list edit. Then add the private `listAllPositions` drain (page-error wrap only) and switch `GetPortfolio` and `GetPnL` to it.
2. **Unit B (Steps 4–5), fail-closed guards.** A RED test calls `listAllPositions` directly with a repeated token. Then add the repeated-token and empty-page guards (design D-3, mirroring `collectFills`). The guards land in their own unit so the guard test has a genuine behavioural RED. Before this unit the helper exists without the guards, and the error message the test asserts on is absent.
3. **Unit C (Steps 6–7), background readers.** RED tests for `broadcastSnapshot`/`checkRiskLimits`: AC-1 rows 3–4, AC-5, and the new AC-6 (operator-approved O-2). Then switch both readers to the drain with the logged skip paths, and update the service `CLAUDE.md` § Observability (D-5).
4. **Step 8 (docs).** Promote the scenarios into `services/xstockstrat-portfolio/acceptance/` (C-16, design item 8).
5. **Step 9 (docs).** Run and record the D-9 dev smoke gate. It is a numbered step with a recorded result, as fails.md requires for pre-launch gates (fails.md:3305-3307). It runs after the integration PR reaches `main-dev` and before `/promote`.

**Consumer surface (C-14).** The `/trader` segment reaches the fix unchanged through `GetPortfolio`/`GetPnL`: `services/xstockstrat-ui/src/hooks/usePortfolio.ts:12` and `services/xstockstrat-ui/src/lib/traderBff.ts:79` (recon.md:34). The RPC signatures and the proto are unchanged, so **no UI step is required**. This is a decision, not an omission (design.md § Chosen Approach, "Consumer surface"). `broadcastSnapshot`/`checkRiskLimits` are internal background readers.

**Accepted behaviour deltas**, which go in the integration PR release notes (design item 7):
- Users with more than 500 positions see different `GetPortfolio` totals, `GetPnL` unrealized P&L and snapshot `open_positions`/equity, and may get new concentration alerts.
- Cross-page read skew: N statements run outside a transaction (D-8).
- The fill path costs more: two drains and two quote batches per fill on the PORTFOLIO-14 serialized consumer (D-13, `portfolio_service.go:484-485`).
- A position-page error no longer suppresses drawdown alerts (O-2, D-16).

**Invariants read at spec time** (design Open Risk, `services/xstockstrat-portfolio/docs/context-constitution.md`):
- **PORTFOLIO-14** (`:27`). The fill, sync and deregister consumers share `positionsMu` across their read-compute-write of `portfolio.positions`. `processOrderFill` releases it *before* `checkRiskLimits`/`broadcastSnapshot` (`portfolio_service.go:481-485`), so the drain runs unlocked. It reads `positions` and never writes them, so it is not a new writer and needs no lock.
- **PORTFOLIO-16** (`:28`). `latestQuotesFor` stays the single quote-fetch site, and each reader keeps its own `!ok` behaviour. The drain changes only the position source feeding it, and every reader still makes one batch per invocation.

### Scenario Coverage (C-15)

| Scenario | Covered by |
|---|---|
| `@AC-1` (GetPortfolio, GetPnL rows) | Step 1 (pgxmock, page-2 cursor pinned), Step 2 (501-row real DB) |
| `@AC-1` (broadcastSnapshot, checkRiskLimits rows) | Step 6 |
| `@AC-2` | Step 1 (page-2 `WillReturnError` for both RPCs); Step 4 (repeated token fails closed) |
| `@AC-3` | Step 1 (pgxmock, account arg pinned on both pages), Step 2 (real DB, second account excluded) |
| `@AC-4` | Step 1 (`getLatestQuotesCalls <= 1`, `getLatestQuoteCalls == 0`, D-14) |
| `@AC-5` | Step 6 (both readers: WARN, `skipped_read_error`, no insert/emit/broadcast, no concentration alert) |
| `@AC-6` (appended this session; design's new `@feature-357` scenario, O-2) | Step 6 |

### Business rules (C-16, from design.md § Business Rules Touched)

- **PRESERVE**, operator decisions 2026-11-17:
  - `@AC-1 @feature-178` (one batched enrichment). Step 1's AC-4 test asserts at most 1 batch.
  - `@AC-1 @feature-353` (cursor). Unchanged: the drain passes `nextToken` back verbatim.
- **PRESERVE** `@AC-3`/`@AC-8 @feature-231`: concentration and the unpriced guard run over the whole drained set (Step 7).
- **EXTEND** `@AC-9 @feature-231`: covered by this feature's `@AC-6`. The operator signed off at the round-2 gate on 2026-11-17.
- No CHANGE lines.

## Step Dependencies

- Steps 1+2+3 land together: Steps 1 and 2 add tests that fail on the current single-page readers (step-constraints.md §C, "adds a test that references…/cannot pass its own Verification without the other member"). Step 3 is the implementation that makes them green. Backend surface only.
- Steps 4+5 land together: Step 4's test asserts the guard error text, which only Step 5 adds.
- Steps 6+7 land together: Step 6's tests fail until Step 7 switches the background readers.
- Step 4 requires Step 3: the test calls `listAllPositions`, which Step 3 creates. The ordering is what makes Step 4's RED behavioural rather than a compile error.
- Step 6 requires Step 5, so the background readers inherit the guarded helper.
- Step 8 requires Steps 1–7: the promoted scenarios must be green.
- Step 9 requires the integration PR merged to `main-dev` (the dev deploy). It gates `/promote` (`code-completed` → `launched`). **If Step 9 fails**, switch to per-page enrichment plus re-aggregation and relax the AC-4 assertion to `<= 2` (D-9, D-14). That deviation is logged in the Deviation Log and re-specced, never silently patched.
- Merge order: 357 must not merge before feature 353's cursor is on `main-dev` (recon.md § Dependencies; context.md sdd-review session).
- Overlap (rebase-only, from sdd-review): `311-fix-position-fold-correctness` (`portfolio_service.go:260-261`, `:419-420`) and `312-fix-read-path-owner-trust` (`:435`) touch regions disjoint from this spec's (`:787`, `:932`, `:1111-1168`, `:1213-1317`).

---

### Step 1 — test: pgxmock RED tests for the RPC readers' drain (GetPortfolio, GetPnL)

**Status**: `done`
**Service**: `xstockstrat-portfolio`
**Files**:
- `services/xstockstrat-portfolio/internal/service/portfolio_position_drain_test.go` — create

**Reviewers**: Service owner (xstockstrat-portfolio) — P&L calculation accuracy, position snapshot consistency, concurrent write safety

**Codebase Evidence**:
- Harness: `newQuoteSvc(t, stub, timeoutMs)` at `internal/service/portfolio_quote_deadline_test.go:96`. It builds `repository.NewPortfolioRepoWithDB(mock)` and sets `marketdata`, `ledger` and `subs` (`:105-110`), with `mock.MatchExpectationsInOrder(false)` (`:103`).
- Row builder: `posRow(rows, sym, account, qty, avg, current)` (`:87-90`) emits a `"TRADING_MODE_PAPER"` row with `market_value = current*qty`. Column list: `positionCols` (`portfolio_fill_errors_test.go:46-50`).
- Other helpers:
  - `anyArgs(n)` (`portfolio_fill_errors_test.go:36`)
  - `ctxWithUser(t, id)` (`watchlist_service_test.go:374`)
  - `quote(sym, mid)` (`portfolio_quote_deadline_test.go:92`)
  - `expectBalanceList(mock, userID, bals ...balSpec)` (`offline_account_pnl_test.go:72`; `balSpec{id, equity, lastEquity}` at `:67-70`)
  - `expectOfflineIDList(mock, userID, ids...)` (`:80-86`)
- Quote counters: `stubMarketData.getLatestQuotesCalls` / `getLatestQuoteCalls` / `requested` (`portfolio_service_test.go:21-26`, `:84-99`).
- Repo arg shape (`internal/repository/portfolio_repo.go:136-206`):
  - Args are `user_id`, `trading_mode` (when set, `mode.String()`), `account_id` (when set), the cursor `[]string` (`:166`; empty non-nil on page 1, `decodePositionCursor` `:215-218`), then `pageSize+1` (`:168`).
  - So the `PAPER` no-account read binds 4 args with the cursor at index 2, and the `PAPER` + account read binds 5 args with the cursor at index 3.
  - The page token is `encodePositionCursor(positions[pageSize-1].Symbol, modes[pageSize-1], positions[pageSize-1].AccountId)` (`:199-204`), so the page-2 cursor arg decodes to `[]string{rows[499].Symbol, "TRADING_MODE_PAPER", rows[499].AccountId}` (D-10).
- O-10, the unique ListPositions SELECT substring. `cardinality($n::text[])` appears only in the ListPositions SQL (`portfolio_repo.go:167`; `grep -rn cardinality internal/` otherwise hits only a comment in `internal/telemetry/otel.go:97`). Precedent regex: `(?s)cardinality\(\$\d+::text\[\]\)` (`internal/repository/portfolio_repo_test.go:279`).
- Error mapping: `GetPortfolio` maps any error to `connect.CodeInternal` (`internal/handler/portfolio_handler.go:89-92`); `GetPnL` goes through `classifyGetPnLError` (`:127`, `:435`). Unchanged (D-4).
- Totals: `GetPortfolio` sets `portfolio.Equity = Σ p.MarketValue` over `positions` (`portfolio_service.go:872-875`); `GetPnL` sums `(CurrentPrice-AvgEntryPrice)*Qty` (`:947-952`).

**Lands with**: `Step 2, Step 3`

**TDD**: `red-green required`

**Covers**: `AC-1` (GetPortfolio, GetPnL rows), `AC-2`, `AC-3`, `AC-4`

**Instructions**:
1. Create `portfolio_position_drain_test.go` (`package service`). The tests swap no global state, but `recordWarns`/`recordLogs` users elsewhere in the package are non-parallel, so do not call `t.Parallel()`.
2. Add file-local helpers. Their inputs are scenario one-offs with this file as the only consumer, so C-13 allows them inline.
   - `const listPositionsSQL = `(?s)cardinality\(\$\d+::text\[\]\)`` — the O-10 anchor. Every ListPositions expectation in this file uses it, never the loose `FROM portfolio.positions`.
   - `drainRows(mock, account string, n int, current func(i int) float64) (*pgxmock.Rows, []string)`. It adds `n` rows via `posRow(rows, fmt.Sprintf("S%03d", i), account, 1, 10, current(i))` for `i` in `0..n-1`, so symbols sort strictly ascending as the SQL's `ORDER BY symbol, trading_mode, account_id` would return them. It returns the rows and the symbol slice.
   - `pageTwoCursor(syms []string, account string) []string` returns `[]string{syms[499], "TRADING_MODE_PAPER", account}` (D-10, index `pageSize-1`, never the probe row).
3. **Two-page fixture.**
   - Page 1 is `mock.ExpectQuery(listPositionsSQL).WithArgs(anyArgs(k)...)`, returning **501** rows: the 500-row page plus the probe row the repo fetches at `pageSize+1`.
   - Page 2 is a second `ExpectQuery(listPositionsSQL)` with the **same arg count `k`**. Its cursor slot is pinned to `pageTwoCursor(...)`, and every other slot is `pgxmock.AnyArg()`. Never use `anyArgs` for page 2 (R-4).
   - Page 2 returns 1 row: the 501st (`S500`).
   - Register page 1 before page 2. Page 1's cursor is the empty slice, so it can never satisfy the pinned page-2 slot.
4. Tests:
   - **`TestGetPnL_357_AC1_DrainsPastFirstPage`**
     - `k=4`. Rows `S000..S499` are broker-valued at `current 11` (unrealized 1 each). `S500` is `current 1010` (unrealized 1000).
     - Call `GetPnL(ctxWithUser(t,"u1"), &portfoliov1.GetPnLRequest{TradingMode: PAPER})` (`fakeLedger.QueryEvents` returns an empty page; `watchlist_service_test.go:362-364`).
     - Assert `err == nil` and `UnrealizedPnl == 1500`, `stub.getLatestQuotesCalls == 0` (all broker-valued) and `mock.ExpectationsWereMet() == nil`.
     - RED today: 500, and page 2 is unmet.
   - **`TestGetPortfolio_357_AC1_DrainsPastFirstPage`**
     - Same rows. `expectBalanceList(mock, "u1", balSpec{id: "acc-1", equity: 1, lastEquity: 1})` keeps the read off the offline path (`offlineCandidates` is empty when the account has a balance, `portfolio_service.go:822-827`). Add `expectOfflineIDList(mock, "u1")`.
     - Call `GetPortfolio(ctx, &GetPortfolioRequest{TradingMode: PAPER})`.
     - Assert `len(Positions) == 501`, that `S500` is present, `Equity == 500*11 + 1010`, and `ExpectationsWereMet`.
   - **`TestGetPortfolio_357_AC3_AccountScopedDrainsPastFirstPage`**
     - `k=5`. Account `"acct-a"` is pinned at arg index 2 on **both** pages. The page-2 cursor is `pageTwoCursor(syms, "acct-a")`. Add `expectBalanceList(mock, "u1", balSpec{id: "acct-a", ...})`.
     - Call with `AccountId: proto.String("acct-a")`.
     - Assert 501 positions, each with `AccountId == "acct-a"`, and `ExpectationsWereMet`. The acct-b exclusion is the SQL filter, which the pgxmock pin proves is bound; Step 2 proves it on a real DB.
   - **`TestGetPortfolio_357_AC4_OneQuoteBatchFor501Unpriced`**
     - All 501 rows are `current 0` (unpriced). `stub.quotes` holds `quote(sym, 11)` for all 501 symbols. Use the balance and offline expectations as above.
     - Assert `stub.getLatestQuotesCalls <= 1` (D-14; stricter than the scenario's `<= 2`, see Step Dependencies for the D-9 relaxation), `stub.getLatestQuoteCalls == 0` and `len(stub.requested[0]) == 501`.
     - RED today: 500 symbols, and page 2 is unmet.
   - **`TestGetPortfolio_357_AC2_PageTwoErrorReturnsError`** and **`TestGetPnL_357_AC2_PageTwoErrorReturnsError`**
     - Page 2 is `.WillReturnError(errPageTwo)`, with `errPageTwo := errors.New("page two down")`.
     - Assert the response is `nil` and `errors.Is(err, errPageTwo)`. The error is wrapped by the repo (`portfolio_repo.go:181`) and by the helper with `%w`.
     - For `GetPortfolio`, register only the two position expectations. The error returns before `ListAccountBalancesByUser` (`portfolio_service.go:791-793`), so assert `ExpectationsWereMet`.
     - RED today: the call succeeds over 500 rows.
5. **§RED.** Run these tests against the tree as it was before Step 3, and capture the failing assertions: unrealized 500 vs 1500, 500 vs 501 positions, 500 requested symbols, and `err == nil` for the AC-2 cases. They reference only existing symbols, so the RED is behavioural and not a compile error.

**Verification**:
```bash
cd services/xstockstrat-portfolio
GOWORK=off go test ./internal/service/... -race -count=1 -run 'Test(GetPnL|GetPortfolio)_357_' -v
GOWORK=off go test ./internal/service/... -race -count=1
# C-13: drainRows is declared once in the package
grep -rn "func drainRows" internal/service --include="*_test.go"   # expect exactly 1 hit
```

---

### Step 2 — test: 501-row real-DB service dbtest + CI package list (D-15)

**Status**: `done`
**Service**: `xstockstrat-portfolio`
**Files**:
- `services/xstockstrat-portfolio/internal/service/position_drain_dbtest_test.go` — create
- `.github/workflows/ci.yml` — modify (line 1065 only)

**Reviewers**: Service owner (xstockstrat-portfolio) — P&L calculation accuracy, position snapshot consistency, concurrent write safety

**Codebase Evidence**:
- Twin pool: `testPool(t, opts...)` at `internal/repository/dbtest_helpers_test.go:22-44`.
  - It reads `PORTFOLIO_DB_TEST_URL`, calls `t.Fatal` under `CI == "true"` and `t.Skip` otherwise (`:24-30`).
  - It uses `pgxpool.ParseConfig` and sets `ConnConfig.RuntimeParams["lock_timeout"] = "500ms"` (`:31-35`), then `pgxpool.NewWithConfig` and `t.Cleanup(pool.Close)` (`:39-44`). The watchlists `DELETE` cleanup that follows (`:45-50`) is not copied into the twin.
  - It is `package repository` under `//go:build dbtest` (`:1-3`), so it cannot be imported (R-7, R-8).
- 353's prefix is `const dbtestUserPrefix = "it-281-"` (`:18`). This file must never use it (O-8).
- Seeding: exported `(*PortfolioRepo).UpsertPosition(ctx, userID, symbol, qty, avgEntry, costBasis, mode, accountID, realizedDelta, feesDelta)` (`internal/repository/portfolio_repo.go:62-70`).
- O-9 checks, both confirmed:
  - `*pgxpool.Pool` satisfies `queryRower` (`portfolio_repo.go:21-25`, and `NewPortfolioRepo` assigns `db: pool` at `:46`).
  - The only `repo.Pool()` call in non-test code is the constructor `NewPortfolioService` (`internal/service/portfolio_service.go:165`), which none of the drained readers call. So `repository.NewPortfolioRepoWithDB(pool)` (`:50-52`) is safe, and the R-10 fallback is not needed.
- Service fields as in `newQuoteSvc` (`portfolio_quote_deadline_test.go:105-110`):
  - `marketdata` is `stubMarketData`. It answers `BatchGetBars` (`portfolio_service_test.go:65-82`) and `GetLatestQuotes` (`:84-96`).
  - `ledger` is `&fakeLedger{}`, whose `QueryEvents` returns an empty page (`watchlist_service_test.go:362-364`).
  - `subs` is `map[string]snapshotSubscriber{}`.
  - Those helpers, `ctxWithUser` and `quote` live in untagged `_test.go` files of `package service`, so they compile under `-tags dbtest`.
- Offline path: with no balance row, `GetPortfolio` without an account reads offline states for the position accounts (`portfolio_service.go:806-825`, `offline_valuation.go:112-147`). AC-3 therefore asserts count and account ids only, not equity (O-9).
- CI:
  - The portfolio db-test step is `.github/workflows/ci.yml:1059-1065` (`working-directory: services/xstockstrat-portfolio` at `:1060`; `run: go test -tags dbtest -race -count=1 ./internal/repository/...` at `:1065`).
  - `:1110-1116` is the **marketdata** step and must not change (R-9, O-7).
- Exec-mode coverage: the `$n::text[]` cursor bind under `QueryExecModeExec` is already proven by feature 353's repository dbtest (`internal/repository/list_positions_dbtest_test.go:24`). This fix adds no new bind (ledger insights.md:4626-4628), so this file needs no exec-mode subtest.

**Lands with**: `Step 1, Step 3`

**TDD**: `red-green required`

**Covers**: `AC-1` (GetPortfolio, GetPnL rows), `AC-3`

**Instructions**:
1. Create `position_drain_dbtest_test.go` with `//go:build dbtest` and `package service`.
2. Define `const drainDBTestPrefix = "it-357-"`, a service-unique prefix that never starts with `it-281-`.
3. Define `serviceTestPool(t *testing.T) *pgxpool.Pool`. It mirrors `testPool`'s skip/CI-fatal rule, `lock_timeout=500ms` and `t.Cleanup(pool.Close)`. Then it registers a cleanup `DELETE FROM portfolio.positions WHERE user_id LIKE $1` with `drainDBTestPrefix+"%"`, reporting any error with `t.Errorf`. Give it exactly this one-line constraint comment:
   `// Twin of repository testPool (internal/repository/dbtest_helpers_test.go:22-44); keep the skip/CI-fatal/lock_timeout rules in step (C-18 waiver D-17).`
4. Use one user id per test, `fmt.Sprintf("%s%s-%d", drainDBTestPrefix, t.Name(), time.Now().UnixNano())`. Derive account ids from it so they are unique per test: `acctA := userID + "-a"` and `acctB := userID + "-b"`.
5. Seed rows with `repo.UpsertPosition(ctx, userID, fmt.Sprintf("S%03d", i), 1, 10, 10, commonv1.TradingMode_TRADING_MODE_PAPER, acctA, 0, 0)` for `i` in `0..500`, calling `t.Fatalf` on error. `seedPosition` is neither copied nor moved (R-7, R-8).
6. Build the service as `svc := &PortfolioService{repo: repository.NewPortfolioRepoWithDB(pool), marketdata: stub, ledger: &fakeLedger{}, subs: map[string]snapshotSubscriber{}}`. `stub.quotes` holds `quote(sym, 11)` for all 501 symbols.
7. Tests:
   - **`TestPositionDrain_357_AC1_GetPnLCountsAll501`**: `GetPnL(ctxWithUser(t, userID), &GetPnLRequest{TradingMode: PAPER})` returns `UnrealizedPnl == 501`, because each position's unrealized P&L is `(11-10)*1`.
   - **`TestPositionDrain_357_AC1_GetPortfolioCountsAll501`**: `GetPortfolio(ctx, &GetPortfolioRequest{TradingMode: PAPER})` returns 501 positions, `S500` included.
   - **`TestPositionDrain_357_AC3_AccountScopedPast500`**: also seed 3 rows on `acctB`, then call `GetPortfolio` with `AccountId: proto.String(acctA)`. Assert 501 positions, each with `AccountId == acctA`.
8. Edit `.github/workflows/ci.yml:1065` only, to `run: go test -tags dbtest -race -count=1 ./internal/repository/... ./internal/service/...`. Leave `:1116` unchanged.
9. **§RED.** Against the pre-Step-3 tree, with a migrated TimescaleDB:
   - Use feature 353's local recipe (`docs/roadmap/features/353-fix-listpositions-nextpagetoken-skips/implementation-spec.md` (pruned: `git show ce1853c3:` that path), Step 2 §RED: `docker run … timescale/timescaledb:latest-pg16`, apply migrations, export `PORTFOLIO_DB_TEST_URL`).
   - `GetPnL` must return 500 and `GetPortfolio` 500 positions.
   - If neither Docker nor TimescaleDB is available, the CI `portfolio-db-test` run on the pre-Step-3 commit is the RED evidence. Link it in the PR's TDD block.

**Verification**:
```bash
cd services/xstockstrat-portfolio
GOWORK=off go vet -tags dbtest ./internal/service/...
# Real backend, when a migrated TimescaleDB is available (authoritative run: CI job portfolio-db-test):
[ -n "$PORTFOLIO_DB_TEST_URL" ] && GOWORK=off go test -tags dbtest -race -count=1 -run 'TestPositionDrain_357_' -v ./internal/service/...
cd ../..
grep -n 'go test -tags dbtest -race -count=1 ./internal/repository/... ./internal/service/...' .github/workflows/ci.yml   # exactly 1 hit, line 1065
sed -n 1110,1116p .github/workflows/ci.yml | grep -c 'MARKETDATA_DB_TEST_URL\|./internal/repository/...$'          # 2: marketdata step unchanged
grep -rn 'it-281-' services/xstockstrat-portfolio/internal/service/                                                   # expect no hit
git diff --quiet origin/feature/fix-portfolio-internal-position -- services/xstockstrat-portfolio/internal/repository/ # repository package untouched
```
Check the `-v` output to confirm the three tests ran and did not skip when the URL is set.

---

### Step 3 — service: `listAllPositions` drain; GetPortfolio and GetPnL read every page

**Status**: `done`
**Service**: `xstockstrat-portfolio`
**Files**:
- `services/xstockstrat-portfolio/internal/service/portfolio_service.go` — modify

**Reviewers**: Service owner (xstockstrat-portfolio) — P&L calculation accuracy, position snapshot consistency, concurrent write safety

**Codebase Evidence**:
- Truncation sites:
  - `GetPortfolio`: `positions, _, err := s.repo.ListPositions(ctx, userID, req.TradingMode, 500, "", req.GetAccountId(), "", portfoliov1.PositionSide_POSITION_SIDE_UNSPECIFIED)` (`portfolio_service.go:790`), `return nil, err` (`:791-793`).
  - `GetPnL`: `s.repo.ListPositions(ctx, userID, req.TradingMode, 500, "", "", "", …)` (`:935`), `return nil, err` (`:936-938`).
- Reuse pattern: `collectFills` (`:1114-1171`), the fail-closed ledger drain. It loops `for { … next := resp.GetPage().GetNextPageToken(); if next == "" { return out, nil }; … token = next }` (`:1162-1169`) and wraps the page error with `%w` (`:1125`).
- Repo cap: `if pageSize <= 0 || pageSize > 500 { pageSize = 100 }` (`internal/repository/portfolio_repo.go:137-139`).
- After the drain, the account scope and `valueRead` (`:811-828`) consume the full slice unchanged. Enrichment stays one `latestQuotesFor` batch per invocation (`:509-516`, PORTFOLIO-16).
- Header propagation: the step adds no outbound gRPC call. Marketdata calls still go through `latestQuotesFor`/`valueRead`.

**Lands with**: `Step 1, Step 2`

**TDD**: `red-green required`

**Covers**: `AC-1`, `AC-2`, `AC-3`, `AC-4` (verified by Steps 1–2)

**Instructions**:
1. Next to `collectFills` (after `:1171`), add:
   ```go
   // positionDrainPageSize must stay <= the repo cap: ListPositions turns any larger page size into 100.
   const positionDrainPageSize = 500

   // listAllPositions follows the ListPositions cursor to the last page; a page error fails the whole read.
   func (s *PortfolioService) listAllPositions(ctx context.Context, userID string, mode commonv1.TradingMode, accountID string) ([]*portfoliov1.Position, error) {
   	var out []*portfoliov1.Position
   	var token string
   	for {
   		page, next, err := s.repo.ListPositions(ctx, userID, mode, positionDrainPageSize, token, accountID, "", portfoliov1.PositionSide_POSITION_SIDE_UNSPECIFIED)
   		if err != nil {
   			return nil, fmt.Errorf("list positions page: %w", err)
   		}
   		out = append(out, page...)
   		if next == "" {
   			return out, nil
   		}
   		token = next
   	}
   }
   ```
   The guards are deliberately absent here; Step 5 adds them under their own RED. There is no page cap, because the keyset order is strictly increasing (design item 1). Memory grows linearly with the number of positions. That is accepted (design Open Risk), and Step 5's guards bound the pathological loops.
2. `GetPortfolio` (`:790`): replace the call with `positions, err := s.listAllPositions(ctx, userID, req.TradingMode, req.GetAccountId())`. Keep `return nil, err`, which is the Internal mapping (D-4).
3. `GetPnL` (`:935`): replace the call with `positions, err := s.listAllPositions(ctx, userID, req.TradingMode, "")`. Keep `return nil, err`.
4. Do not touch `broadcastSnapshot` (`:1216`) or `checkRiskLimits` (`:1282`, read at `:1286`); Step 7 owns them. Do not touch the public `ListPositions` RPC (`:897-907`).

**Verification**:
```bash
cd services/xstockstrat-portfolio
GOWORK=off go build ./... && GOWORK=off go vet ./... && GOWORK=off go vet -tags dbtest ./...
GOWORK=off go test ./internal/service/... -race -count=1 -run 'Test(GetPnL|GetPortfolio)_357_' -v
[ -n "$PORTFOLIO_DB_TEST_URL" ] && GOWORK=off go test -tags dbtest -race -count=1 -run 'TestPositionDrain_357_' -v ./internal/service/...
# Coverage gate (new logic is in the excluded service package, so no threshold applies to it; confirm the total stays >= 40%):
GOWORK=off COVERPKGS=$(go list ./... | grep -Ev '/(cmd|handler|repository|telemetry|service)(/|$)' | tr '\n' ',' | sed 's/,$//') && GOWORK=off go test ./... -race -count=1 -coverprofile=coverage.out -covermode=atomic -coverpkg="${COVERPKGS}" && go tool cover -func=coverage.out | grep "^total:"
GOWORK=off golangci-lint run --modules-download-mode=mod
grep -n 'ListPositions(ctx, userID, req.TradingMode, 500' internal/service/portfolio_service.go   # expect no hit
```
The new logic is in the excluded `service` package, so no coverage threshold applies to it. Unit and integration-test verification is sufficient.

---

### Step 4 — test: RED test for the repeated-token guard (called directly)

**Status**: `done`
**Service**: `xstockstrat-portfolio`
**Files**:
- `services/xstockstrat-portfolio/internal/service/portfolio_position_drain_test.go` — modify

**Reviewers**: Service owner (xstockstrat-portfolio) — P&L calculation accuracy, position snapshot consistency, concurrent write safety

**Codebase Evidence**:
- `listAllPositions` exists after Step 3 and has no guard. Fed two identical 501-row pages, it loops to a third `ListPositions` call. pgxmock has no expectation for that call, so it errors. The error is non-nil, but its text never says `repeated page token`, so asserting the guard's message gives a behavioural RED.
- Twin guard text in the ledger drain: `"GetPnL: QueryEvents (%s): repeated page token: %w"` (`portfolio_service.go:1167`).
- The empty-page-with-a-token guard **cannot be exercised** through the concrete repo. `ListPositions` only returns a token when `len(positions) > pageSize` (`portfolio_repo.go:200-204`), so an empty page never carries one. There is no repo interface (`portfolio_service.go:43`), and design R-1/C-18 rule out adding one. **Not found: no seam exists that can produce an empty page with a token.** Design item 4(d)'s "Empty page with a token: run GetPnL end to end" cannot be built. Operator decision 2026-11-17: the guard is **dropped** (C-08/P-06 — no untestable code); Step 5 adds only the repeated-token guard.

**Lands with**: `Step 5`

**TDD**: `red-green required`

**Covers**: `AC-2` (a drain that cannot advance fails closed, never a partial result)

**Instructions**:
1. Add **`TestListAllPositions_357_RepeatedTokenFailsClosed`**:
   - Use `newQuoteSvc(t, &stubMarketData{}, 0)`.
   - Page 1 is `ExpectQuery(listPositionsSQL).WithArgs(anyArgs(4)...)` returning `drainRows(mock, "acc-1", 501, …)` (the account must be `"acc-1"` so the page-2 pin below matches).
   - Page 2 has the cursor pinned to `pageTwoCursor(syms, "acc-1")` and returns **the same 501 rows**, so the repo emits the same token again.
   - Call `svc.listAllPositions(ctxWithUser(t, "u1"), "u1", commonv1.TradingMode_TRADING_MODE_PAPER, "")`.
   - Assert the result is `nil`, `err != nil`, `strings.Contains(err.Error(), "repeated page token")` and `mock.ExpectationsWereMet() == nil`.
2. **§RED** on the Step-3 tree: the assertion on `"repeated page token"` fails. The error is pgxmock's unexpected-call error from page 3.

**Verification**:
```bash
cd services/xstockstrat-portfolio
GOWORK=off go test ./internal/service/... -race -count=1 -run 'TestListAllPositions_357_' -v
GOWORK=off go test ./internal/service/... -race -count=1
```

---

### Step 5 — service: fail-closed repeated-token guard in `listAllPositions`

**Status**: `done`
**Service**: `xstockstrat-portfolio`
**Files**:
- `services/xstockstrat-portfolio/internal/service/portfolio_service.go` — modify

**Reviewers**: Service owner (xstockstrat-portfolio) — P&L calculation accuracy, position snapshot consistency, concurrent write safety

**Codebase Evidence**:
- Guard to mirror in `collectFills` (its empty-page guard `:1127-1129` is not mirrored — operator decision 2026-11-17, unreachable through the concrete repo, `portfolio_repo.go:200-204`):
  - Repeated token: `if next == token { return nil, fmt.Errorf(…"repeated page token"…) }` (`:1166-1167`).
  - Today `repeated page token|empty page with a next token` has 2 hits (`:1128`, `:1167`), so the Verification grep's 3 hits holds after this step.
- The design adds no repeated-row guard, because the keyset order is strictly increasing (design item 1).

**Lands with**: `Step 4`

**TDD**: `red-green required`

**Covers**: `AC-2` (verified by Step 4)

**Instructions**:
1. Before `token = next`, add:
   `if next == token { return nil, fmt.Errorf("list positions page: repeated page token") }`
2. Do not add an empty-page-with-a-token guard (operator decision 2026-11-17: untestable through the concrete repo).
3. Change nothing else. The guard gets no error sentinel (R-5): `GetPortfolio`/`GetPnL` map these errors to Internal like any other page error.

**Verification**:
```bash
cd services/xstockstrat-portfolio
GOWORK=off go test ./internal/service/... -race -count=1 -run 'Test(ListAllPositions|GetPnL|GetPortfolio)_357_' -v
GOWORK=off go test ./internal/service/... -race -count=1
GOWORK=off golangci-lint run --modules-download-mode=mod
grep -n 'repeated page token\|empty page with a next token' internal/service/portfolio_service.go   # 3 hits: 2 ledger + 1 position drain
```
The new logic is in the excluded `service` package, so no coverage threshold applies to it.

---

### Step 6 — test: RED tests for the background readers (broadcastSnapshot, checkRiskLimits)

**Status**: `done`
**Service**: `xstockstrat-portfolio`
**Files**:
- `services/xstockstrat-portfolio/internal/service/portfolio_position_drain_test.go` — modify

**Reviewers**: Service owner (xstockstrat-portfolio) — P&L calculation accuracy, position snapshot consistency, concurrent write safety

**Codebase Evidence**:
- `broadcastSnapshot` today:
  - Bare `return` on a page error (`portfolio_service.go:1217-1220`).
  - Unpriced skip: WARN `"portfolio snapshot skipped: positions unpriced"` plus `telemetry.RecordSnapshot(ctx, "skipped_unpriced")` (`:1225-1228`).
  - `InsertSnapshot(ctx, userID, userID, equity, 0, 0, len(positions), mode)` (`:1241`), whose SQL binds `$1..$7 = portfolioID, userID, equity, cash, dayPnL, openPositions, mode.String()` (`internal/repository/portfolio_repo.go:231-238`). `open_positions` is therefore arg index 5.
  - Subscriber fan-out (`:1251-1261`).
- `checkRiskLimits` today:
  - Bare `return` on a page error (`:1286-1289`), placed *before* the drawdown block (`:1315-1320`).
  - `observeQuotePass(ctx, positions, quotes, "risk")` (`:1294`).
  - The concentration gate is `totalValue > 0` (`:1306`).
  - The alert text is `"concentration limit breach: %s at %.1f%%"` (`:1310`).
  - The concentration limit default `0.20` is read via `s.cfg.GetFloat` (`:1284`).
- Harness and helpers:
  - `recordingNotify` (`portfolio_quote_deadline_test.go:349-362`), `expectDrawdowns(mock, rows ...[3]any)` (`:372-378`, args `"u1", "TRADING_MODE_PAPER"`) and `sameSet` (`:380`).
  - `svc.cfg = &config.Watcher{}` for the defaults, as in `:450`.
  - `recordLogs(t)` (`portfolio_telemetry_test.go:152-158`) with `.with(msg)` (`:128`), and `installMetricReader(t)` (`:39-50`). D-11: both are used together, as at `:532-533`.
  - `counterValue(t, reader, name, kv...)` (`:75-91`) and `attr` (`:93`).
  - `telemetry.KeyOutcome` / `telemetry.KeyPath` (`internal/telemetry/otel.go:311-317`).
  - `svc.Subscribe(id, userID)` (`portfolio_service.go:1198`), and `fakeLedger.calls` counting emits (`watchlist_service_test.go:345`).
- Existing precedent for the shape: `TestCheckRiskLimits_AC9_UnpricedSkipsConcentrationDrawdownStillAlerts` (`portfolio_quote_deadline_test.go:471-496`).

**Lands with**: `Step 7`

**TDD**: `red-green required`

**Covers**: `AC-1` (broadcastSnapshot, checkRiskLimits rows), `AC-5`, `AC-6`

**Instructions**: All tests are non-parallel (they swap the global slog default and MeterProvider) and use user `"u1"`, mode PAPER, `newQuoteSvc(t, &stubMarketData{}, 0)` and broker-valued rows from `drainRows`.
1. **`TestBroadcastSnapshot_357_AC1_DrainsPastFirstPage`**
   - Two pages: `S000..S499` at `current 11`, and `S500` at `current 1010`.
   - Expect `INSERT INTO portfolio.snapshots` with `WithArgs(AnyArg ×5, 501, AnyArg)`, pinning `open_positions = 501` at index 5.
   - Subscribe `"t"` for `"u1"` and call `svc.broadcastSnapshot(ctxWithUser(t,"u1"), "u1", PAPER)`.
   - Assert the received snapshot has `OpenPositions == 501` and `Equity == 500*11 + 1010`, plus `ExpectationsWereMet`.
2. **`TestCheckRiskLimits_357_AC1_ConcentrationOn501st`**
   - Two pages: `S000..S499` at `current 7` (MV 7 each, 3500 total) and `S500` at `current 1500` (30.0% of 5000). Add `expectDrawdowns(mock)` with no rows.
   - Set `svc.cfg = &config.Watcher{}` (concentration default 0.20) and `svc.notify = &recordingNotify{}`.
   - Assert `notify.bodies` equals exactly `["concentration limit breach: S500 at 30.0%"]`.
   - RED today: no alert.
3. **`TestBroadcastSnapshot_357_AC5_PageErrorSkipsAndLogs`**
   - Use `reader := installMetricReader(t)` and `rec := recordLogs(t)`.
   - Page 1 returns 501 rows; page 2 has the cursor pinned and `.WillReturnError(errPageTwo)`. Register **no** `INSERT` expectation.
   - Assert:
     - the subscriber channel is empty and `ledger.calls == 0` (no emit, no broadcast);
     - `rec.with("portfolio snapshot skipped: position read failed")` has one record, with `user_id == "u1"` and a non-empty `error`;
     - `counterValue(t, reader, "portfolio.snapshot", attr(telemetry.KeyOutcome, "skipped_read_error")) == 1`;
     - `ExpectationsWereMet`.
   - RED today: page 1 succeeds, so an insert, an emit and a broadcast happen over 500 rows.
4. **`TestCheckRiskLimits_357_AC5_PageErrorNoConcentrationAlert`**
   - Use `installMetricReader` and `recordLogs`.
   - Page 1 rows put `S000` at `current 1500` and the rest at `current 7`, so page 1 *alone* breaches the 0.20 limit. Page 2 errors. Add `expectDrawdowns(mock)` with no rows.
   - Assert:
     - `len(notify.bodies) == 0`;
     - `rec.with("concentration check skipped: position read failed")` has one record, with `user_id` and `error`;
     - `counterValue(t, reader, "portfolio.mark_source", attr(telemetry.KeyPath, "risk")) == 0` (D-12: a failed read is never a mark-source pass);
     - `ExpectationsWereMet`, which proves the drawdown read ran.
   - RED on the Step-5 tree: the single-page read of 500 rows succeeds, so a concentration alert for `S000` fires from page 1 alone (`len(notify.bodies) == 1`), there is no WARN, a `risk` mark-source sample is recorded, and the page-2 expectation is unmet. The drawdown expectation *is* met on the RED tree, because the read does not fail.
5. **`TestCheckRiskLimits_357_AC6_PageErrorDrawdownStillAlerts`** (O-2, design 4g)
   - Same as item 4, but with `expectDrawdowns(mock, [3]any{"brk-1", 800.0, 1000.0})`.
   - Assert `notify.bodies` equals exactly `["drawdown limit breach: account brk-1 at 20.0% (peak 1000.00, current 800.00)"]` (format at `portfolio_service.go:1275`, `evaluateDrawdowns` :1266). Also assert no concentration alert, no `risk` mark-source sample, and `ExpectationsWereMet`.
   - RED on the Step-5 tree: the single-page read succeeds, so `notify.bodies` holds both the page-1 concentration alert and the drawdown alert (the exact-equality assertion fails), and the page-2 expectation is unmet. The bare-return-skips-drawdown defect (O-2) is only reachable when page 1 itself errors, which this drained-read test does not exercise; the GREEN assertion pins the post-Step-7 fall-through.
6. **§RED** on the Step-5 tree: capture each failing assertion named above.

**Verification**:
```bash
cd services/xstockstrat-portfolio
GOWORK=off go test ./internal/service/... -race -count=1 -run 'Test(BroadcastSnapshot|CheckRiskLimits)_357_' -v
GOWORK=off go test ./internal/service/... -race -count=1
```

---

### Step 7 — service: broadcastSnapshot and checkRiskLimits drain all pages; logged skips on a read failure

**Status**: `done`
**Service**: `xstockstrat-portfolio`
**Files**:
- `services/xstockstrat-portfolio/internal/service/portfolio_service.go` — modify
- `services/xstockstrat-portfolio/CLAUDE.md` — modify (§ Observability, D-5)

**Reviewers**: Service owner (xstockstrat-portfolio) — P&L calculation accuracy, position snapshot consistency, concurrent write safety

**Codebase Evidence**:
- `broadcastSnapshot` (`portfolio_service.go:1216-1261`) and `checkRiskLimits` (`:1282-1321`), as quoted in Step 6.
- Existing skip idiom: `slog.WarnContext(ctx, "portfolio snapshot skipped: positions unpriced", "user_id", userID, …)` plus `telemetry.RecordSnapshot(ctx, "skipped_unpriced")` (`:1225-1228`).
- `telemetry.RecordSnapshot(ctx, outcome string)` (`internal/telemetry/otel.go:347-349`) accepts any outcome value. The label-key allowlist covers keys, not values (`:310`).
- Service CLAUDE.md § Observability documents `portfolio.snapshot{outcome written|skipped_unpriced|db_error}` and the load-bearing logs (`services/xstockstrat-portfolio/CLAUDE.md`, § "Observability (feature 294-signal-map-instrumentation)"; the Instruments line at `:133`, Load-bearing logs at `:135`). On the merged tree `:133` also reads `portfolio.marketdata_fetch{op=quotes|delistings,...}` (main-dev delisting feature); change only its `portfolio.snapshot` entry.
- Caller: `processOrderFill` calls `s.checkRiskLimits` then `s.broadcastSnapshot` after releasing `positionsMu` (`:484-488`). Neither signature changes (R-6).
- Regression check on existing tests that hit these paths with an unexpected positions read:
  - `TestProcessOrderFill_*` (`portfolio_fill_errors_test.go:67-110`) use `newFillSvc` with no `cfg`/`notify`.
  - After this step, a page error in `checkRiskLimits` reaches `GetAccountDrawdowns`. That read is unexpected in pgxmock and errors, so the `if err == nil` guard (`:1316`) skips the alert, and the nil `notify` is never dereferenced.
  - `s.cfg.GetFloat` is already called on these paths before the read (`:1283-1284`).

**Lands with**: `Step 6`

**TDD**: `red-green required`

**Covers**: `AC-1`, `AC-5`, `AC-6` (verified by Step 6)

**Instructions**:
1. **`broadcastSnapshot`** (`:1217-1220`): replace the read and the bare return with:
   ```go
   positions, err := s.listAllPositions(ctx, userID, mode, "")
   if err != nil {
   	slog.WarnContext(ctx, "portfolio snapshot skipped: position read failed", "user_id", userID, "error", err)
   	telemetry.RecordSnapshot(ctx, "skipped_read_error")
   	return
   }
   ```
   The rest is unchanged: the quote batch, the unpriced guard over the full set (`@AC-8 @feature-231`), the insert, the emit and the broadcast. Do not reuse `db_error` (R-3).
2. **`checkRiskLimits`** (`:1286-1303`):
   - Declare `var totalValue float64` and `posValues := make(map[string]float64)` before the read.
   - Call `positions, err := s.listAllPositions(ctx, userID, mode, "")`.
   - `if err != nil`: run `slog.WarnContext(ctx, "concentration check skipped: position read failed", "user_id", userID, "error", err)`.
   - `else`: run the existing body — `latestQuotesFor`, `applyQuotes`, `observeQuotePass(…, "risk")` and the unpriced-skip/sum block (`:1292-1303`) — moved unchanged into this branch.
   - Leave the concentration loop (`:1305-1313`) and the drawdown block (`:1314-1320`) unchanged and *after* the branch. On failure `totalValue` stays 0, so the `totalValue > 0` gate cannot fire on a partial set, and drawdown still runs (O-2, D-12, D-16).
3. **`services/xstockstrat-portfolio/CLAUDE.md` § Observability**:
   - Change the instrument entry to `portfolio.snapshot{outcome written|skipped_unpriced|skipped_read_error|db_error}`.
   - Add to "Load-bearing logs": WARN `portfolio snapshot skipped: position read failed` (no persist/emit/broadcast) and WARN `concentration check skipped: position read failed` (drawdown still runs).
   - Change no other line.

**Verification**:
```bash
cd services/xstockstrat-portfolio
GOWORK=off go test ./internal/service/... -race -count=1 -run 'Test(BroadcastSnapshot|CheckRiskLimits|ProcessOrderFill|GetPnL|GetPortfolio|ListAllPositions)' -v
# Coverage gate (new logic is in the excluded service package, so no threshold applies to it; confirm the total stays >= 40%):
GOWORK=off COVERPKGS=$(go list ./... | grep -Ev '/(cmd|handler|repository|telemetry|service)(/|$)' | tr '\n' ',' | sed 's/,$//') && GOWORK=off go test ./... -race -count=1 -coverprofile=coverage.out -covermode=atomic -coverpkg="${COVERPKGS}" && go tool cover -func=coverage.out | grep "^total:"
GOWORK=off golangci-lint run --modules-download-mode=mod
grep -n 'ListPositions(ctx, userID, mode, 500' internal/service/portfolio_service.go   # expect no hit
grep -c 'listAllPositions(ctx' internal/service/portfolio_service.go                      # expect 4 call sites (GetPortfolio, GetPnL, broadcastSnapshot, checkRiskLimits)
grep -n 'skipped_read_error' CLAUDE.md internal/service/portfolio_service.go             # 1 hit each
```

---

### Step 8 — docs: promote the acceptance scenarios to the portfolio durable suite (C-16)

**Status**: `done`
**Service**: `xstockstrat-portfolio` (docs)
**Files**:
- `services/xstockstrat-portfolio/acceptance/fix-portfolio-internal-position.feature` — create

**Reviewers**: none

**Codebase Evidence**:
- Promotion convention, header plus feature tag: `services/xstockstrat-portfolio/acceptance/fix-listpositions-nextpagetoken-skips.feature:1-6`. Line 1 is `# Promoted from feature 353 (fix-listpositions-nextpagetoken-skips) at integration, C-16. Do not hand-edit; scenarios are verbatim.` and each scenario carries `@feature-353`.
- Source: `docs/roadmap/features/357-fix-portfolio-internal-position/acceptance.feature` (`@AC-1`..`@AC-6`; `@AC-6` is the design's new scenario, "a position-read failure skips concentration but drawdown still alerts").

**TDD**: `N/A (docs — scenario promotion, no executable logic)`

**Covers**: —

**Instructions**:
1. Create the file. Line 1 is `# Promoted from feature 357 (fix-portfolio-internal-position) at integration, C-16. Do not hand-edit; scenarios are verbatim.`
2. Copy the `Feature:` block and every scenario verbatim, adding `@feature-357` to each scenario's tag line.
3. Do not edit `fix-after-hours-positions-priced.feature`. `@AC-9 @feature-231` is EXTENDED by the new `@AC-6 @feature-357` scenario and is not rewritten (design § Business Rules Touched).

**Verification**:
```bash
f=services/xstockstrat-portfolio/acceptance/fix-portfolio-internal-position.feature
grep -c '@feature-357' "$f"                                     # 6
grep -c '^  @AC-' docs/roadmap/features/357-fix-portfolio-internal-position/acceptance.feature   # 6
git diff --quiet origin/feature/fix-portfolio-internal-position -- services/xstockstrat-portfolio/acceptance/fix-after-hours-positions-priced.feature
```

---

### Step 9 — docs: D-9 dev smoke gate (single-batch enrichment at ≥501 symbols) — record the result

**Status**: `pending`
**Service**: `xstockstrat-portfolio` (operational verification, recorded in `context.md`)
**Files**:
- `docs/roadmap/features/357-fix-portfolio-internal-position/context.md` — modify (record the result)

**Reviewers**: none

**Codebase Evidence**:
- Quote deadline: `latestQuotesFor` bounds one `GetLatestQuotes` call by `quoteTimeout()` (`portfolio_service.go:509-516`). `portfolio.marketdata.quote_timeout_ms` defaults to `4000`, and `marketdata.quotes.batch_timeout_ms` to `2500` (service CLAUDE.md § Config Keys Consumed, `:88`).
- The outcome metric is `portfolio.marketdata_fetch{op=quotes, outcome ok|error|timeout}`, recorded via `telemetry.RecordMarketdataFetch(ctx, "quotes", outcome)` (`portfolio_service.go:523`, ok path `:529`; CLAUDE.md § Observability).
- **Not found**: no verified per-request symbol cap in marketdata `GetLatestQuotes` (recon.md:80). That is why this gate exists.
- Pre-launch gates must be numbered steps with a recorded result (`docs/roadmap/ledger/fails.md:3305-3307`).
- Out-of-band data access goes through `docs/runbooks/operator-db-access.md` (there is no SQL-over-MCP surface).

**TDD**: `N/A (operational smoke on the dev deploy; no code)`

**Covers**: —

**Instructions**:
1. **When.** Run after the integration PR merges to `main-dev` and the dev app has deployed. Run it before `/promote`.
2. **Seed.** Through `docs/runbooks/operator-db-access.md`, seed **at least 501** PAPER positions for a dedicated smoke user. Use distinct symbols that marketdata serves, with `current_price = 0` so every position needs a quote.
3. **Exercise.** Call `GetPnL` and `GetPortfolio` for that user through the `/trader` page or the BFF.
4. **Pass condition.** Neither RPC returns `Unavailable`, and `portfolio.marketdata_fetch{op=quotes}` records outcome `ok` (not `timeout`/`error`) for those calls in Grafana.
5. **Clean up.** Delete the seeded rows.
6. **Record.** Append a `context.md` session entry with the date, the symbol count, the outcome and the evidence (a Grafana panel link or a query).
7. **On failure.** Do not promote. Log a deviation and re-spec the D-9 fallback: per-page enrichment plus re-aggregation, with Step 1's AC-4 assertion relaxed to `<= 2` (D-14). Concentration and the unpriced guard must still aggregate over the whole set (`@AC-3`/`@AC-8 @feature-231`).

**Verification**:
```bash
grep -n 'D-9 smoke' docs/roadmap/features/357-fix-portfolio-internal-position/context.md   # a recorded PASS (or FAIL + deviation) entry exists
```

---

## Deviation Log

_Populated by /sdd-execute as implementation proceeds._

### 2026-11-17 — Step 2 (unit 1+2+3): real-DB RED/GREEN not run locally
- **Spec said**: Step 2 §RED runs the 501-row dbtest against the pre-Step-3 tree on a migrated TimescaleDB, or, without one, cites the CI `portfolio-db-test` run on the pre-Step-3 commit.
- **Actual**: `PORTFOLIO_DB_TEST_URL` is unset in the execution sandbox and the execute loop never starts a database. Steps 1+2+3 land as one atomic commit, so no pre-Step-3 commit exists for CI to run. Locally the dbtest compiles and vets (`go vet -tags dbtest`, `golangci-lint --build-tags dbtest`: 0 issues). The behavioural RED is the pgxmock suite from Step 1 (same readers, same 501-row shape).
- **Disposition**: CI-equivalent fallback. The authoritative real-DB GREEN is the CI `portfolio-db-test` job on this unit's commit (ci.yml:1065 now includes `./internal/service/...`).

### 2026-11-17 — Steps 1–2 (unit 1+2+3): extra file-local test helpers
- **Spec said**: Step 1 names `listPositionsSQL`, `drainRows`, `pageTwoCursor`; Step 2 builds the service inline per test.
- **Actual**: Step 1 also adds `expectTwoPages` (registers page 1 + pinned page 2, or the page-2 error), `brokerValued` and `paperMode`; Step 2 adds `drainDBFixture`, `seedDrainPositions`, `drainDBUser`. All file-local, each used by several tests in the same file (DRY guard rail); the assertions and fixtures are the specced ones.
- **Disposition**: in-scope (same **Files**), no behaviour change.

### 2026-11-17 — Step 6 (unit 6+7): file-local helpers for the checkRiskLimits page-error tests
- **Spec said**: Step 6 items 4 and 5 describe two tests with the same setup (page 1 breaches concentration on `S000`, page 2 errors) and the same WARN / mark-source / expectations assertions; item 5 adds a drawdown row.
- **Actual**: the shared setup is `riskPageTwoFails(t, drawdowns...)` and the shared assertions are `assertRiskReadSkipped`; each test keeps its own alert assertion. `errPageTwo` is local to each test, as in Step 1's tests (Step 1 declared no package-level `errPageTwo`).
- **Disposition**: in-scope (same **Files**), no behaviour change; the assertions are the specced ones.

### 2026-11-17 — Step 7 (unit 6+7): call-site grep count
- **Spec said**: `grep -c 'listAllPositions(ctx' internal/service/portfolio_service.go` expects 4 call sites.
- **Actual**: it prints 5. The pattern also matches the definition line `func (s *PortfolioService) listAllPositions(ctx context.Context, …)` (:1177); `grep -n` shows exactly the four call sites the spec names: GetPortfolio :790, GetPnL :935, broadcastSnapshot :1240, checkRiskLimits :1313.
- **Disposition**: spec expectation miscounted (definition line); behaviour as specced, no code change.
