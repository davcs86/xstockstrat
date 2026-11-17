# Implementation Spec: fix-listpositions-nextpagetoken-skips

**Status**: `pending`
**Created**: 2026-11-17
**Feature**: `docs/roadmap/features/353-fix-listpositions-nextpagetoken-skips/feature.md`
**Total Steps**: 4
**Feature Branch**: `feature/fix-listpositions-nextpagetoken-skips`

---

## Execution Summary

All four steps are in `xstockstrat-portfolio`. Steps 1–2 fix the bug in `PortfolioRepo.ListPositions`: the token now comes from the last row returned, not the look-ahead row, and the keyset moves to a full-key composite cursor (design D-1, D-2, D-3, D-7). Steps 3–4 map the new `repository.ErrInvalidPageToken` to `InvalidArgument` at the handler (D-4). The repo comes first because the handler classifier needs its sentinel. Step 1 also edits the three exact pgxmock pins whose bound token changes from `""` to `[]string{}`, so it passes its own verification on its own and needs no `**Lands with**`. No proto change, no migration and no config change (D-5). Not trading-domain: no order, broker, fill or `TRADING_MODE` env var is touched, so step-constraints §A does not apply. No new outbound gRPC call, so header propagation does not apply.

**Scenario coverage (C-15):** `@AC-1` → Step 2 (`TestListPositions_TraversalYieldsEveryRowOnce` and `TestListPositions_CursorMatchesOracleOrder`, real backend, both exec modes, plus the pgxmock first-page and next-token tests).

**Consumer surfaces (C-14), a design decision, not an omission:** the product spec names `/trader/positions` and the agent's `get_positions` / `get_positions_by_account_id`. Neither needs code (design.md § Chosen Approach, Consumers). Both carry the token through as an opaque string and pick up the fix on deploy:
- UI: `services/xstockstrat-ui/src/app/trader/positions/page.tsx:83` reads `data?.page?.nextPageToken`, and `:548-551` pushes it onto `pageStack` without parsing it.
- Agent: `services/xstockstrat-agent/app/tools.py:2567-2613` and `app/client.py:2574-2604` pass the token through.

**Deploy-straddle check (design Open Risk; this spec confirms it):** a browser holding an old bare-symbol token gets `InvalidArgument` once.
- `page.tsx:511` shows this as `<p className="text-sm text-destructive">Failed to load positions</p>`. It does **not** go through `QueryStateMessages`, so the design's assumption was wrong. The error is still visible, not a silent blank page.
- The user recovers by reloading, or by changing a filter (`resetPaging`, `page.tsx:58-62`).
- The hand-rolled error markup predates this feature and is a C-17 deviation. Fixing it is out of scope; there is no UI step.

Analysis drains also treat the token as opaque (`services/xstockstrat-analysis/app/engine/live_loop.py:563-590`, `app/handlers/servicer.py:6404-6437`). During a straddle they fail one cycle, and `@AC-16 @feature-294` is preserved.

## Step Dependencies

- Step 2 [test] covers Step 1 [service]. Step 2 needs Step 1 for `encodePositionCursor`, `decodePositionCursor` and `ErrInvalidPageToken`. To capture RED, the executor drafts Step 2's behavioural tests first and runs them against the tree as it was before Step 1; they reference only symbols that already exist (see Step 2 Instructions §RED).
- Step 3 requires Step 1, for `repository.ErrInvalidPageToken`.
- Step 4 [test] covers Step 3 [service]. Step 4 needs Step 3 for `classifyListPositionsError`.
- No atomic units. Step 1 carries its own test-pin edits (step-constraints §C: the three `WithArgs(..., "", 501)` pins would otherwise turn red), so every step is green at its own commit.
- Follow-ups from design.md Open Risks are not steps. They are tracked as `[ ]` items in `context.md` Open Threads; the `/sdd-execute` integration PR body must list them, and the feature is not archived until each has a filed report under `docs/reports/` (or a recorded wont-fix). After this feature lands, file each with `/sdd-qa defect`:
  1. Harden the analysis position drains: equal-token guard, fail closed, cap-hit log (`docs/roadmap/ledger/fails.md:3309-3312`).
  2. The look-ahead token in `WatchlistRepo.ListByUser` (`internal/repository/watchlist_repo.go:139`). Another session owns the sibling report.
  3. Internal callers read only the first 500 positions (`portfolio_service.go:787,932,1214,1283`; trading `trading.go:2235`).

---

### Step 1 — service: Composite keyset cursor in `PortfolioRepo.ListPositions`

**Status**: `pending`
**Service**: `xstockstrat-portfolio`
**Files**:
- `services/xstockstrat-portfolio/internal/repository/portfolio_repo.go` — modify
- `services/xstockstrat-portfolio/internal/service/offline_account_pnl_test.go` — modify (3 exact arg pins)

**Reviewers**: Service owner (`xstockstrat-portfolio`): P&L calculation accuracy, position snapshot consistency, concurrent write safety

**Codebase Evidence**:
- `portfolio_repo.go:135` `func (r *PortfolioRepo) ListPositions(ctx context.Context, userID string, mode commonv1.TradingMode, pageSize int, pageToken string, accountID string, symbolFilter string, side portfoliov1.PositionSide) ([]*portfoliov1.Position, string, error)`. The page-size clamp is at `:136-138`.
- `:140-160` define the filter-builder closure `add` and the mode/account/symbol/side conditions.
- The bug, part 1: `:161-162` `args = append(args, pageToken)` and `conds = append(conds, fmt.Sprintf("($%d = '' OR symbol > $%d)", len(args), len(args)))`, a symbol-only keyset.
- `:163-164` bind the limit as `pageSize+1`. `:168-172` run `ORDER BY symbol ASC LIMIT $%d`, with no tiebreaker.
- `:182` `p, err := scanPositionRow(rows)`.
- The bug, part 2: `:192-197` (`:194` `nextToken = positions[pageSize].Symbol`), the look-ahead row.
- `scanPositionRow` (`:253-293`) scans `trading_mode` into `modeStr` and never returns it. Its other callers are `:131` (`GetPosition`) and `:626` (`ListPositionsByAccount`). Tests call it at `portfolio_repo_test.go:26,33`. `positionColumns` is at `:297`.
- Sentinel pattern: `:247` `var ErrPositionNotFound = errors.New("position not found")`. The file already imports `encoding/json`, `errors`, `fmt` and `strings` (`:3-9`); `encoding/base64` is not imported yet.
- A `[]string` bound in production SQL already exists and runs under the PgBouncer Exec mode today: `:505-507` (`r.db.Query(... WHERE user_id=$1 AND account_id = ANY($2)`, userID, accountIDs)`; re-confirmed 2026-11-17).
- Uniqueness argument (`docs/roadmap/ledger/insights.md:3547`): `migrations/003_positions_account_id.up.sql:8-10` declares `UNIQUE (user_id, symbol, trading_mode, account_id)`. All three cursor columns are `NOT NULL` TEXT (`001_portfolio_hypertable.up.sql:10`, `002_add_trading_mode.up.sql:6`, `003_positions_account_id.up.sql:2`). `user_id = $1` is always an equality filter.
- Pattern reused, copied rather than imported because it is unexported: marketdata builds the token from the last returned row (`marketdata_repo.go:956` `last := out[pageSize-1]`) and over-fetches by one.
- Exact pins that change: `internal/service/offline_account_pnl_test.go:530` `WithArgs("u1", "alp-1", "", 501)`, `:531` `WithArgs("u1", offAcct, "", 501)` and `:572` `WithArgs("u-1", account, "", 501)`. `grep -rn 'WithArgs(' --include=*_test.go | grep '""'` finds no other empty-token pin. The roughly 37 `anyArgs(3)`/`anyArgs(4)` pins (helper at `portfolio_fill_errors_test.go:36`) keep their arg count and are left alone.

**TDD**: `red-green required`. The RED is Step 2's behavioural tests (Step 2 §RED).

**Covers**: —

**Instructions**:
1. Next to `ErrPositionNotFound` (`:247`), add:
   `var ErrInvalidPageToken = errors.New("invalid page token")`
   with a one-line doc comment: "returned for a malformed ListPositions page token; the handler maps it to InvalidArgument."
2. Add `encoding/base64` to the import block (`:3-9`).
3. Add two unexported functions next to `ListPositions`:
   - `encodePositionCursor(symbol, tradingMode, accountID string) string`: `json.Marshal([]string{symbol, tradingMode, accountID})`, then `base64.RawURLEncoding.EncodeToString`. A marshal of `[]string` cannot fail, so discard that error.
   - `decodePositionCursor(token string) ([]string, error)`:
     - `token == ""` returns `[]string{}, nil`. The slice must be non-nil and empty.
     - Otherwise, `base64.RawURLEncoding.DecodeString`, then `json.Unmarshal` into `var parts []string`.
     - Return `ErrInvalidPageToken` on a decode error, an unmarshal error, or `len(parts) != 3`. This covers JSON `null`, an object, non-string elements, and bare legacy tokens such as `"AAPL"` or `"BRK.B"`.
     - Empty-string elements are valid.
   - Put this 2-line constraint comment above `decodePositionCursor`: `// Rejects (never resumes page 1, unlike marketdata parseHistCursor): a silent restart makes` / `// paging consumers re-add rows (analysis _drain_held_symbols sums market_value).`
4. (Accepted trade-off, design D-3: a wrapper beats changing `scanPositionRow`'s signature for its 3 production + 2 test callers, and beats a `Position` proto change.) Rename the body of `scanPositionRow` to `scanPositionRowWithMode(row pgxRow) (*portfoliov1.Position, string, error)`. It returns `modeStr` as the second value; on an error it returns `nil, "", err`, keeping the `ErrPositionNotFound` mapping at `:265-267`. Then make `scanPositionRow` a one-line wrapper: `p, _, err := scanPositionRowWithMode(row); return p, err`. Its callers at `:131` and `:626` and its tests stay unchanged.
5. In `ListPositions`:
   - Before building any args, call `cursor, err := decodePositionCursor(pageToken)`. If `err != nil`, return `nil, "", fmt.Errorf("list positions: %w", err)`. No query is issued.
   - Replace `:161-162` with `args = append(args, cursor)` and condition `fmt.Sprintf("(cardinality($%[1]d::text[]) = 0 OR (symbol, trading_mode, account_id) > (($%[1]d::text[])[1], ($%[1]d::text[])[2], ($%[1]d::text[])[3]))", len(args))`. Write the explicit `::text[]` on every use. This is one arg in the token's existing slot, so the arg count does not change (D-7).
   - Change `ORDER BY symbol ASC` at `:171` to `ORDER BY symbol, trading_mode, account_id`.
   - In the scan loop (`:181-187`), call `scanPositionRowWithMode` and collect the modes into a parallel `modes []string`.
   - Replace `:192-196` (the `nextToken` block before `return`) with: if `len(positions) > pageSize`, set `last := pageSize-1`, `nextToken = encodePositionCursor(positions[last].Symbol, modes[last], positions[last].AccountId)`, `positions = positions[:pageSize]`.
   - The filters (mode, account, symbol, side) stay ANDed before `LIMIT`.
6. In `offline_account_pnl_test.go`, change the third arg at `:530`, `:531` and `:572` from `""` to `[]string{}`. Change nothing else in that file.

**Verification**:
```bash
cd services/xstockstrat-portfolio
grep -n 'positions\[pageSize\]\.Symbol\|symbol > \$' internal/repository/portfolio_repo.go   # expect no output
grep -n 'cardinality(\$%\[1\]d::text\[\])\|ORDER BY symbol, trading_mode, account_id\|ErrInvalidPageToken' internal/repository/portfolio_repo.go   # expect hits
GOWORK=off go build ./... && GOWORK=off go vet -tags dbtest ./...
GOWORK=off go test ./... -race -count=1
GOWORK=off golangci-lint run --modules-download-mode=mod
```
Every existing test passes, including the three re-pinned `offline_account_pnl_test.go` cases and every `anyArgs(3)`/`anyArgs(4)` positions pin.

---

### Step 2 — test: ListPositions cursor tests (pgxmock + codec + real-backend traversal)

**Status**: `pending`
**Service**: `xstockstrat-portfolio`
**Files**:
- `services/xstockstrat-portfolio/internal/repository/portfolio_repo_test.go` — modify
- `services/xstockstrat-portfolio/internal/repository/dbtest_helpers_test.go` — modify
- `services/xstockstrat-portfolio/internal/repository/list_positions_dbtest_test.go` — create

**Reviewers**: Service owner (`xstockstrat-portfolio`): P&L calculation accuracy, position snapshot consistency, concurrent write safety

**Codebase Evidence**:
- pgxmock repo-test pattern: `portfolio_repo_test.go:49-92` (`TestGetPosition_ScopesToRequestedAccount`) uses `pgxmock.NewPool()`, `repo := &PortfolioRepo{db: mock}`, `mock.ExpectQuery(<regex>).WithArgs(...)` and `mock.ExpectationsWereMet()`. The inline 17-column row header is at `:60-63`. pgxmock is `github.com/pashagolub/pgxmock/v4 v4.9.0` (`go.mod:9`). The `pgxmock.Argument` interface is verified in v4.9.0 `argument.go:6-8` (`Match(interface{}) bool`); plain args are compared with `reflect.DeepEqual` (`expectations.go:169`) (debate.md O-9).
- Cursor-test template: marketdata `marketdata_repo_test.go:305` (`TestQueryHistoricalFundamentals_Pagination`, ":334 cursor is the LAST RETURNED row"), `:394` (`...CompositeCursorSamePeriodEnd`) and `:450` (`TestParseHistCursor`).
- dbtest harness: `dbtest_helpers_test.go:1` `//go:build dbtest`. `:18` `const dbtestUserPrefix = "it-281-"`. `:22-49` `testPool(t)` reads `PORTFOLIO_DB_TEST_URL`, fails under `CI=true` if it is unset and skips otherwise. Its cleanup deletes only `portfolio.watchlists` (`:41-46`). `:52-55` is `testUserID(t)`. There is no positions seeder yet.
- `NewPortfolioRepoWithDB(db queryRower)` (`portfolio_repo.go:49`). `*pgxpool.Pool` satisfies `queryRower` (`:22-26`: `QueryRow`, `Query`, `Exec`).
- Production Exec mode: `pool.go:29-32` sets `cfg.ConnConfig.DefaultQueryExecMode = pgx.QueryExecModeExec` when `DB_PGBOUNCER` is set (`docs/roadmap/ledger/fails.md:1977-2001`).
- Positions columns without a default: `user_id`, `symbol`, `qty`, `avg_entry_price`, `cost_basis` (`001_portfolio_hypertable.up.sql:9-13`). `trading_mode` and `account_id` have defaults (`002:6`, `003:2`). There is no CHECK or trigger on `positions`.
- CI: the `portfolio-db-test` job (`.github/workflows/ci.yml:1016-1065`) applies all migrations to `timescale/timescaledb:latest-pg16` and runs `go test -tags dbtest -race -count=1 ./internal/repository/...`. A new file in that package needs no workflow change. TimescaleDB is not installed locally (no `timescale*` under `/usr/share/postgresql/16/extension`).

**TDD**: `red-green required`

**Covers**: `AC-1`

**Instructions**:
1. **§RED (do this before Step 1's implementation).** Draft the behavioural tests from items 4 and 5 below. They reference only `ListPositions`, `PortfolioRepo`, `NewPortfolioRepoWithDB`, `testPool` and `testUserID`. Run them against the tree as it was before Step 1:
   - **Local RED:** `TestListPositions_FirstPageBindsEmptyCursorArray` fails because the SQL has no `cardinality(` and the bound arg is the `""` string.
   - **Real-backend RED:** `TestListPositions_TraversalYieldsEveryRowOnce`. At page size 3, page 1 (`LIMIT 4`) returns 3 of the 4 AAPL rows with token `"AAPL"`, and page 2 returns `[MSFT, MSFT, NVDA]`, so qty 4 is missing. Capture it locally against a migrated TimescaleDB (recipe verified in this environment on 2026-11-17; the existing dbtests pass on it):
     ```bash
     docker run -d --name ts353 --network host -e POSTGRES_USER=xstockstrat -e POSTGRES_PASSWORD=ci-only -e POSTGRES_DB=xstockstrat timescale/timescaledb:latest-pg16
     # portfolio then ingest migrations in NNN order (ingest is needed by signal_expiry_prune_dbtest_test.go);
     # render ${SEED_USER_ID} as CI does (ci.yml portfolio-db-test: 00000000-0000-4000-8000-0000000000c1)
     for f in services/xstockstrat-portfolio/migrations/*.up.sql services/xstockstrat-ingest/migrations/*.up.sql; do
       sed 's/\${SEED_USER_ID}/00000000-0000-4000-8000-0000000000c1/g' "$f" | PGPASSWORD=ci-only psql -q -v ON_ERROR_STOP=1 -h 127.0.0.1 -U xstockstrat -d xstockstrat; done
     export PORTFOLIO_DB_TEST_URL='postgres://xstockstrat:ci-only@127.0.0.1:5432/xstockstrat?sslmode=disable'
     ```
     If neither Docker nor a TimescaleDB is available, the CI `portfolio-db-test` job run on the pre-fix commit is the RED evidence: link that job run in the PR's TDD block.
   - Add the tests that use the codec or the sentinel (item 3, item 4c) only after the RED is captured, because they would not compile before Step 1.
   - **PR TDD block (tdd-gate.md):** record that the RED was captured against the pre-Step-1 tree, naming that commit sha and pasting the failing assertion output for both RED tests (local and real-backend), then the GREEN output on the Step-2 commit.
2. **C-13:** the 17-column pgxmock row header at `portfolio_repo_test.go:60-63` gets its second consumer in this step. Hoist it into a package-level `var positionRowCols = []string{...}` in `portfolio_repo_test.go` and use it at `:60`. It is a test-mechanics column list in the `repository` test package, not proto domain data. The `service` package has its own copy at `portfolio_fill_errors_test.go:46-48`, which is a different package and stays as it is. The seed rows below are scenario one-offs with a single consumer (this file), so they stay inline.
3. **Codec table test** `TestPositionCursorCodec` in `portfolio_repo_test.go`:
   - Round-trip `encodePositionCursor` → `decodePositionCursor` for `("AAPL","TRADING_MODE_PAPER","a")`, `("BRK|B","TRADING_MODE_LIVE","x,\"{}\\ y")` and `("","","")`.
   - `decodePositionCursor("")` returns a non-nil empty slice: `len == 0 && got != nil`.
   - Each of these returns `errors.Is(err, ErrInvalidPageToken)`: `"AAPL"`, `"BRK.B"`, `"!!!"`, base64url of `["a","b"]`, `[1,2,3]`, `{"a":"b"}` and `null`.
4. **pgxmock `ListPositions` tests** in `portfolio_repo_test.go`:
   - a. `TestListPositions_FirstPageBindsEmptyCursorArray`:
     - `ExpectQuery` with a regex requiring both `cardinality\(\$\d+::text\[\]\)` and `\(\$\d+::text\[\]\)\[1\]`.
     - `.WithArgs("u1", emptyStringSlice{}, 4)`, where `emptyStringSlice` is a local `pgxmock.Argument` (interface verified in pgxmock v4.9.0 `argument.go:6-8`: `Match(interface{}) bool`) whose `Match` returns true only for a non-nil `[]string` of length 0. Use a matcher, not a plain value: non-`Argument` args are compared with `reflect.DeepEqual` (`expectations.go:169`), which this test must not rely on for nil-vs-empty (D-8).
     - Return 4 rows (AAPL/PAPER/a, AAPL/PAPER/b, AAPL/PAPER/c, MSFT/PAPER/a), using `pageSize=3` and no filters.
     - Assert 3 positions come back, and that `decodePositionCursor(next)` equals `[]string{"AAPL","TRADING_MODE_PAPER","c"}`. That is the last *returned* row, not the look-ahead MSFT row. Add the decode assertion after RED (item 1).
   - b. `TestListPositions_CursorPageBindsDecodedTuple`: token `encodePositionCursor("AAPL","TRADING_MODE_PAPER","c")`, `.WithArgs("u1", []string{"AAPL","TRADING_MODE_PAPER","c"}, 4)`. Return 1 row and assert `next == ""`.
   - c. `TestListPositions_MalformedTokenIssuesNoQuery`: for `"AAPL"` and `"BRK.B"`, register no expectation. Assert `errors.Is(err, ErrInvalidPageToken)` and `mock.ExpectationsWereMet() == nil`.
5. **Real-backend tests**: new file `list_positions_dbtest_test.go` with `//go:build dbtest` and `package repository`.
   - **Helpers in `dbtest_helpers_test.go`:**
     - Give `testPool` a variadic parameter `opts ...func(*pgxpool.Config)` and apply it after `ParseConfig` (`:31`). The 29 existing `testPool(t)` call sites (`grep -rn 'testPool(t' internal --include=*_test.go`) pass no option, so they compile and behave unchanged; no other file is edited.
     - Add a second cleanup that runs `DELETE FROM portfolio.positions WHERE user_id LIKE $1` with the same `dbtestUserPrefix+"%"`. Reuse the prefix; do not add a second one (D-8).
     - Add `seedPosition(t, pool, userID, symbol, mode, accountID string, qty float64)`. It inserts `(user_id, symbol, qty, avg_entry_price, cost_basis, trading_mode, account_id)` with `avg_entry_price=1` and `cost_basis=qty`, and calls `t.Fatalf` on error.
     - Add `traverse(t, repo, userID, mode, pageSize) (seq []float64, pageLens []int)`. It loops `ListPositions` until the token is `""`, fails after 50 pages, and fails if a token equals the previous one.
   - **Two exec modes:** both tests run as subtests over `{"default": testPool(t), "exec": testPool(t, func(c *pgxpool.Config){ c.ConnConfig.DefaultQueryExecMode = pgx.QueryExecModeExec })}`, each wrapped by `NewPortfolioRepoWithDB(pool)`. Both are mandatory (D-8). Build both pools at the parent-test level on purpose: an unset `PORTFOLIO_DB_TEST_URL` then skips (or, under `CI=true`, fails) the whole test once, and both subtests share one cleanup scope; do not move pool construction into the subtests.
   - **`TestListPositions_TraversalYieldsEveryRowOnce` (`@AC-1`):**
     - Seed 7 rows with `qty` 1..7 as the identity: AAPL/TRADING_MODE_LIVE/a, AAPL/TRADING_MODE_PAPER/a, AAPL/TRADING_MODE_PAPER/b, AAPL/TRADING_MODE_PAPER/c, MSFT/TRADING_MODE_LIVE/a, MSFT/TRADING_MODE_PAPER/a, NVDA/TRADING_MODE_PAPER/a.
     - Page size 3: assert `seq == [1,2,3,4,5,6,7]` exactly and `pageLens == [3,3,1]`.
     - Page size 1: assert `seq == [1..7]` and 7 pages.
     - Filtered by `TRADING_MODE_PAPER` at page size 1, so the cursor arg shifts slot: assert `seq == [2,3,4,6,7]`.
   - **`TestListPositions_CursorMatchesOracleOrder`:**
     - In one symbol/mode (`AAPL`/`TRADING_MODE_PAPER`), seed account_ids `acct_1`, `Acct-1`, `acct-1`, the special-character id `a,"{}\ b` (comma, quote, braces, backslash, space) and the literal `NULL`.
     - Oracle: `SELECT account_id FROM portfolio.positions WHERE user_id=$1 ORDER BY symbol, trading_mode, account_id`.
     - Traverse at page sizes 1 and 2 and assert that the sequence of returned `AccountId`s equals the oracle exactly. This checks the row compare and `ORDER BY` against the same collation, and the encoding of text-array elements in Exec mode.

**Verification**:
```bash
cd services/xstockstrat-portfolio
GOWORK=off go test ./internal/repository/... -race -count=1 -run 'TestPositionCursorCodec|TestListPositions_|TestScanPositionRow|TestGetPosition' -v
GOWORK=off go vet -tags dbtest ./internal/repository/...
# Real backend, when a migrated TimescaleDB is available (authoritative run: CI job portfolio-db-test):
[ -n "$PORTFOLIO_DB_TEST_URL" ] && GOWORK=off go test -tags dbtest -race -count=1 -run 'TestListPositions_' -v ./internal/repository/...
# Coverage gate (new logic is in the excluded repository package, so no threshold applies to it; confirm the total is still >= 40%):
GOWORK=off COVERPKGS=$(go list ./... | grep -Ev '/(cmd|handler|repository|telemetry|service)(/|$)' | tr '\n' ',' | sed 's/,$//') && GOWORK=off go test ./... -race -count=1 -coverprofile=coverage.out -covermode=atomic -coverpkg="${COVERPKGS}" && go tool cover -func=coverage.out | grep "^total:"
GOWORK=off golangci-lint run --modules-download-mode=mod
# C-13: one declaration of the hoisted column list in the repository test package
grep -rn '"take_profit_order_id", "source", "as_of"' internal/repository/ --include="*_test.go"   # expect exactly 1 hit
```
The new logic is in the excluded `repository` package, so no coverage threshold applies to it, and integration-test verification is sufficient. Check the `-v` output to confirm both `default` and `exec` subtests ran and did not skip when the URL is set.

---

### Step 3 — service: Map `ErrInvalidPageToken` to `InvalidArgument` in the ListPositions handler

**Status**: `pending`
**Service**: `xstockstrat-portfolio`
**Files**:
- `services/xstockstrat-portfolio/internal/handler/portfolio_handler.go` — modify

**Reviewers**: Service owner (`xstockstrat-portfolio`): P&L calculation accuracy, position snapshot consistency, concurrent write safety

**Codebase Evidence**:
- `portfolio_handler.go:109` is `func (h *PortfolioHandler) ListPositions(...)`. Line `:115` is `return nil, connect.NewError(connect.CodeInternal, err)`, so every error comes back as `Internal` today.
- Classifier pattern: `:415-422` `classifyGetPositionError(err error) connect.Code` returns `connect.CodeNotFound` when `errors.Is(err, repository.ErrPositionNotFound)` (`:418`), else `connect.CodeInternal`. It is used at `:104`.
- gRPC edge: `grpcPortfolioAdapter.ListPositions` (`:281-287`) wraps the handler with `toGRPCError` (`:443`), which maps `connect.CodeInvalidArgument` to `codes.InvalidArgument` (`:447`). The adapter needs no change.
- The service passes the repo error through unchanged: `portfolio_service.go:904-907` (`if err != nil { return nil, err }`).

**TDD**: `red-green required`. The RED is Step 4's classifier test; see Step 4 for why it is a compile-level RED.

**Covers**: —

**Instructions**:
1. After `classifyGetPositionError` (`:415-422`), add `classifyListPositionsError(err error) connect.Code`. It returns `connect.CodeInvalidArgument` when `errors.Is(err, repository.ErrInvalidPageToken)`, else `connect.CodeInternal`. Give it a one-line doc comment: "maps ListPositions errors: InvalidArgument for a malformed page token, else Internal."
2. At `:115`, replace `connect.CodeInternal` with `classifyListPositionsError(err)`.
3. Change nothing else. The service layer and `grpcPortfolioAdapter` stay as they are.

**Verification**:
```bash
cd services/xstockstrat-portfolio
grep -n 'classifyListPositionsError' internal/handler/portfolio_handler.go   # expect the definition + the :115 call site
GOWORK=off go build ./... && GOWORK=off go test ./internal/handler/... -race -count=1
GOWORK=off golangci-lint run --modules-download-mode=mod
```

---

### Step 4 — test: ListPositions error classification at the Connect and gRPC edges

**Status**: `pending`
**Service**: `xstockstrat-portfolio`
**Files**:
- `services/xstockstrat-portfolio/internal/handler/portfolio_handler_test.go` — modify

**Reviewers**: Service owner (`xstockstrat-portfolio`): P&L calculation accuracy, position snapshot consistency, concurrent write safety

**Codebase Evidence**:
- Template: `portfolio_handler_test.go:18-38` covers `TestClassifyGetPositionError_NotFound`, `_WrappedNotFound` (`fmt.Errorf("get position: %w", repository.ErrPositionNotFound)`) and `_GenericError_IsInternal`.
- Edge mapping: `:50` `status.Code(toGRPCError(connect.NewError(classifyGetPnLError(...), ledgerErr))) != codes.Unavailable`.
- Imports already present (`:3-15`): `errors`, `fmt`, `connect`, `codes`, `status`, `repository`.
- The handler package cannot build a `PortfolioService` over pgxmock. The only constructor is `NewPortfolioService(cfg, cfgWatcher)` (`portfolio_service.go:123`), and handler tests use `&PortfolioHandler{}` (`portfolio_identity_test.go:28`). So the test works at the classifier level, like the existing classifier tests.

**TDD**: `red-green required`. The RED is compile-level, because `classifyListPositionsError` does not exist before Step 3 and there is no handler harness backed by a repo. The behavioural RED for the malformed-token path is Step 2's `TestListPositions_MalformedTokenIssuesNoQuery`. **PR TDD block (tdd-gate.md):** paste the compile-failure output (`undefined: classifyListPositionsError`) captured before Step 3, cite Step 2's behavioural RED by test name and commit, then the GREEN output.

**Covers**: — (guards design D-4; no `@AC-*` in `acceptance.feature` names the malformed-token path)

**Instructions**:
1. Add `TestClassifyListPositionsError`, a table test:
   - `repository.ErrInvalidPageToken` → `connect.CodeInvalidArgument`
   - `fmt.Errorf("list positions: %w", repository.ErrInvalidPageToken)` → `connect.CodeInvalidArgument`
   - `errors.New("db connection reset")` → `connect.CodeInternal`
2. For the wrapped case, also assert `status.Code(toGRPCError(connect.NewError(classifyListPositionsError(err), err))) == codes.InvalidArgument`. This is the gRPC edge that analysis, agent and trading call.
3. Test data: only error sentinels and strings, which are scenario one-offs, so C-13 needs no fixture.

**Verification**:
```bash
cd services/xstockstrat-portfolio
GOWORK=off go test ./internal/handler/... -race -count=1 -run 'TestClassifyListPositionsError|TestClassifyGetPositionError|TestToGRPCError' -v
GOWORK=off COVERPKGS=$(go list ./... | grep -Ev '/(cmd|handler|repository|telemetry|service)(/|$)' | tr '\n' ',' | sed 's/,$//') && GOWORK=off go test ./... -race -count=1 -coverprofile=coverage.out -covermode=atomic -coverpkg="${COVERPKGS}" && go tool cover -func=coverage.out | grep "^total:"
GOWORK=off golangci-lint run --modules-download-mode=mod
```
The new logic is in the excluded `handler` package, so no coverage threshold applies to it; confirm the total is still at least 40%.

---

## Deviation Log

_Populated by /sdd-execute as implementation proceeds._
