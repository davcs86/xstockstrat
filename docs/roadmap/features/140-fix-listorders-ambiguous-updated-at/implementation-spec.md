# Implementation Spec: fix-listorders-ambiguous-updated-at

**Status**: `pending`
**Created**: 2026-08-16
**Feature**: `docs/roadmap/features/140-fix-listorders-ambiguous-updated-at/feature.md`
**Total Steps**: 2
**Feature Branch**: `claude/commit-135-opportunities-strategies-0xjnxk` (harness-assigned; see feature.md Status History boot correction — not `feature/fix-listorders-ambiguous-updated-at`)

---

## Execution Summary

Two steps, both scoped to `xstockstrat-trading`. Step 1 (`service`) applies the approved
single-site fix — renaming `intentLateralJoinSQL`'s own projected `updated_at` to
`updated_at AS intent_updated_at` so the range Postgres resolves for a bare `updated_at`
reference contains only one column (`trading.orders.updated_at`) — and adds a minimal `dbQuerier`
seam (`QueryRow`/`Query`) to `TradingRepo` so the three affected read methods (`GetOrder`,
`ListOrders`, `ListSubmittedOrders`) become exercisable with `pgxmock` (this service has no
live-DB test harness; recon confirmed no `xstockstrat-trading` `_test.go` files exist under
`internal/repository/` today). Step 2 (`test`) adds the `pgxmock` dependency and a new
`trading_repo_test.go` with one regression test per affected method. No proto, migration, or
config changes — confirmed by the product spec's Fix Scope checklist and this recon. No
consumer-surface (UI/Agent) step is required — this is an internal query fix with no
observable behavior change (Constitution **C-14** n/a, per design.md).

## Step Dependencies

- Step 2 requires Step 1: the tests in Step 2 assert against the fixed query text
  (`intent_updated_at`) and the new `dbQuerier`/`db` seam Step 1 introduces on `TradingRepo`;
  Step 2 cannot compile against the pre-Step-1 struct.
- The regression tests in Step 2 are themselves the red-before-green proof for Step 1: written
  and run against the pre-fix `intentLateralJoinSQL` text, `mock.ExpectQuery`'s `intent_updated_at`
  regex fails to match (pgxmock reports "call to Query was not expected") — red. After Step 1's
  rename, the same regex matches — green. See Step 2 **TDD** note.

---

### Step 1 — service: qualify the LATERAL join's own `updated_at` and add a mockable query seam

**Status**: `pending`
**Service**: `xstockstrat-trading`
**Files**:
- `services/xstockstrat-trading/internal/repository/trading_repo.go` — modify

**Reviewers**: Service Owner (`xstockstrat-trading`) — Order execution correctness, broker API
safety, fill detection, paper-only dev invariant, position limit enforcement

**Codebase Evidence**:
- `intentLateralJoinSQL` const, the ambiguity source — `trading_repo.go:85-90`:
  ```go
  const intentLateralJoinSQL = `
  	LEFT JOIN LATERAL (
  	    SELECT state, updated_at FROM trading.order_intents
  	    WHERE order_id = trading.orders.order_id
  	    ORDER BY updated_at DESC LIMIT 1
  	) li ON true`
  ```
  Confirmed via `grep -n "intentLateralJoinSQL"` that it is referenced at exactly 3 call sites:
  `trading_repo.go:100` (`GetOrder`), `:128` (`ListOrders`), `:214` (`ListSubmittedOrders`). No
  4th call site exists (`order_intent_repo.go`'s own 6 queries never join `trading.orders`).
- The three outer `SELECT` lists that collide with the join's own `updated_at` — each ends
  `..., created_at, updated_at, account_id, broker_type, li.state` and never selects
  `li.updated_at` itself: `GetOrder` `trading_repo.go:95-98`, `ListOrders` `:123-126`,
  `ListSubmittedOrders` `:209-212`. Confirmed via `grep -n "li\.updated_at"` → zero hits repo-wide
  — the alias rename below has zero consumers to update.
- `TradingRepo` struct + constructor (current, `pool` only) — `trading_repo.go:16-27`:
  ```go
  type TradingRepo struct {
  	pool *pgxpool.Pool
  }

  func NewTradingRepo(connStr string) (*TradingRepo, error) {
  	pool, err := newPool(context.Background(), connStr)
  	if err != nil {
  		return nil, fmt.Errorf("newPool: %w", err)
  	}
  	return &TradingRepo{pool: pool}, nil
  }
  ```
  Confirmed via `grep -n "TradingRepo{"` that `trading_repo.go:26` is the only construction site,
  and via `grep -n "\.Pool()\|NewTradingRepo("` that `cmd/server/main.go:74,83,87,90` are the only
  callers of `NewTradingRepo`/`Pool()` (wiring `AccountRepo`, `OrderIntentRepo`, `BracketRepo` off
  the shared pool) — none break, since `pool` is kept, only supplemented.
- The 3 call sites to retarget onto the new seam — `r.pool.QueryRow(ctx, ...)` at
  `trading_repo.go:94` (`GetOrder`), `r.pool.Query(ctx, query, args...)` at `:187` (`ListOrders`),
  `r.pool.Query(ctx, ...)` at `:208` (`ListSubmittedOrders`). `UpsertOrder`'s `r.pool.Exec(...)`
  (`:47`) is a write path, out of scope — stays on `r.pool`.
- Reuse pattern (recon.md, verified directly): `xstockstrat-portfolio`'s `queryRower` seam —
  `services/xstockstrat-portfolio/internal/repository/portfolio_repo.go:18-24` (interface,
  `QueryRow` only) and `:26-45` (`db queryRower` field alongside `pool *pgxpool.Pool`,
  `NewPortfolioRepo` sets `db: pool`, `Pool()` accessor untouched). Per design.md, this service's
  seam must be **broader** than that precedent — `ListOrders`/`ListSubmittedOrders` also call
  `Query`, not just `QueryRow` — so `dbQuerier` needs both methods (`queryRower` alone is
  insufficient here; do not copy it verbatim).
- `pgx.Row`/`pgx.Rows` types are already imported package-wide as `"github.com/jackc/pgx/v5"` in
  sibling files (`pool.go:9`, `bracket_repo.go:8`, `order_intent_repo.go:8`) but **not** in
  `trading_repo.go` itself (confirmed via `grep -n "jackc/pgx/v5\""` — only
  `"github.com/jackc/pgx/v5/pgxpool"` is imported at `trading_repo.go:8`) — this step adds the
  import.

**TDD**: `red-green required` — this step's fix is proven red-before-green by Step 2's tests
(see Step Dependencies). Do not mark Step 1 done until Step 2's tests exist and the sequence
(red on pre-rename text, green on post-rename text) has been observed.

**Instructions**:
1. Add `"github.com/jackc/pgx/v5"` to the import block (`trading_repo.go:3-13`), alongside the
   existing `"github.com/jackc/pgx/v5/pgxpool"`.
2. Immediately above the `TradingRepo` struct (`trading_repo.go:16`), add a `dbQuerier` interface
   scoped to what `GetOrder`/`ListOrders`/`ListSubmittedOrders` need:
   ```go
   // dbQuerier is the subset of *pgxpool.Pool that GetOrder/ListOrders/ListSubmittedOrders need,
   // extracted so the LATERAL-join queries can be exercised with pgxmock (this service has no
   // live-DB test harness and CI provisions no database — see internal/repository/trading_repo_test.go).
   // Both *pgxpool.Pool and pgxmock.PgxPoolIface satisfy it; production wires it to the real pool.
   type dbQuerier interface {
   	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
   	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
   }
   ```
3. Add a `db dbQuerier` field to the `TradingRepo` struct (`trading_repo.go:16-18`), keeping
   `pool *pgxpool.Pool` unchanged (still the type `Pool()` returns to `AccountRepo`/
   `OrderIntentRepo`/`BracketRepo`).
4. In `NewTradingRepo` (`trading_repo.go:21-27`), set `db: pool` in the returned
   `&TradingRepo{...}` literal (mirrors `NewPortfolioRepo`'s `db: pool`).
5. In `GetOrder` (`trading_repo.go:94`), change `r.pool.QueryRow(ctx, ...)` → `r.db.QueryRow(ctx, ...)`.
6. In `ListOrders` (`trading_repo.go:187`), change `r.pool.Query(ctx, query, args...)` →
   `r.db.Query(ctx, query, args...)`.
7. In `ListSubmittedOrders` (`trading_repo.go:208`), change `r.pool.Query(ctx, ...)` →
   `r.db.Query(ctx, ...)`.
8. In `intentLateralJoinSQL` (`trading_repo.go:87`), change:
   `SELECT state, updated_at FROM trading.order_intents`
   to:
   `SELECT state, updated_at AS intent_updated_at FROM trading.order_intents`
   Leave the inner `ORDER BY updated_at DESC LIMIT 1` (`:89`) untouched — it resolves inside the
   subquery, before the alias applies to the projected column, so it still refers unambiguously
   to `trading.order_intents.updated_at`.
9. Leave `UpsertOrder` (`:37-79`) and its `r.pool.Exec` call untouched — out of scope.

**Verification**:
```bash
cd services/xstockstrat-trading && GOWORK=off go build ./...
```
Confirms the package compiles with the new `dbQuerier` interface, the `db` field, and the renamed
alias, before Step 2's tests are added. Full behavioral proof is Step 2's paired test.

---

### Step 2 — test: pgxmock regression tests for GetOrder/ListOrders/ListSubmittedOrders

**Status**: `pending`
**Service**: `xstockstrat-trading`
**Files**:
- `services/xstockstrat-trading/internal/repository/trading_repo_test.go` — create (first
  repo-level test file for this service — confirmed absent via `find ... -iname "*_test.go"`
  under `internal/repository/`)
- `services/xstockstrat-trading/go.mod` — modify (add `github.com/pashagolub/pgxmock/v4 v4.9.0`
  to the `require` block)
- `services/xstockstrat-trading/go.sum` — modify (add the corresponding hash lines)

**Reviewers**: Service Owner (`xstockstrat-trading`) — Order execution correctness, broker API
safety, fill detection, paper-only dev invariant, position limit enforcement

**Codebase Evidence**:
- Dependency precedent — `xstockstrat-portfolio`'s `go.mod` pins
  `github.com/pashagolub/pgxmock/v4 v4.9.0` (`portfolio/go.mod:9`) against
  `github.com/jackc/pgx/v5 v5.9.2` (`portfolio/go.mod:7`) — **the identical pgx version** already
  pinned in `services/xstockstrat-trading/go.mod:7`. A module-set diff
  (`diff <(awk '{print $1}' portfolio/go.sum | sort -u) <(awk '{print $1}' trading/go.sum | sort -u)`)
  shows `github.com/pashagolub/pgxmock/v4` is the **only** module present in portfolio's go.sum
  and absent from trading's — no other transitive dependency gap exists, so no other module
  version needs reconciling.
- The exact `go.sum` lines to add (verbatim from `portfolio/go.sum:31-32`, valid for trading
  since it is the same module version against the same pgx version):
  ```
  github.com/pashagolub/pgxmock/v4 v4.9.0 h1:itlO8nrVRnzkdMBXLs8pWUyyB2PC3Gku0WGIj/gGl7I=
  github.com/pashagolub/pgxmock/v4 v4.9.0/go.mod h1:9L57pC193h2aKRHVyiiE817avasIPZnPwPlw3JczWvM=
  ```
  Prefer running `cd services/xstockstrat-trading && GOWORK=off go get github.com/pashagolub/pgxmock/v4@v4.9.0`
  over hand-editing, so `go.sum` is generated/verified by the toolchain rather than copied; the
  lines above are given only so the expected result is checkable without network access.
- Test-shape precedent (recon.md; verified directly) —
  `services/xstockstrat-portfolio/internal/repository/portfolio_repo_test.go:26-89`
  (`TestGetPosition_ScopesToRequestedAccount`): `pgxmock.NewPool()` → `&PortfolioRepo{db: mock}`
  → `mock.NewRows([]string{...}).AddRow(...)` → `mock.ExpectQuery(<regex>).WithArgs(...).WillReturnRows(rows)`
  → call the repo method → assert the returned value → `mock.ExpectationsWereMet()`. Reuse this
  shape; `TradingRepo{db: mock}` requires only the `db` field Step 1 added (no other unexported
  field needs setting for these three read-only methods).
- `scanOrder`'s exact column order (what each mocked row must supply, positionally) —
  `trading_repo.go:241,247-256`: `order_id, client_order_id, broker_order_id, symbol, side,
  order_type, status, qty, filled_qty, limit_price, stop_price, filled_avg_price, time_in_force,
  strategy_id, user_id, trading_mode, created_at, updated_at, account_id, broker_type,
  <intent_state or NULL>` (last column scans into `*int16`, nullable — `trading_repo.go:256,284-286`
  maps a non-NULL value to `o.IntentState`).
- `ListOrders`' positional `$N` filter builder (the function `fails.md`'s 2026-08-06 entry
  flagged for a *different*, already-fixed bug in the same file) — `trading_repo.go:131-186`:
  each optional filter (`userID`, `status`, `mode`, `strategyID`, `symbol`, `side`, `orderType`,
  `accountID`, `rng.Start`, `rng.End`) appends `AND <col> = $i` and increments `i` — confirmed by
  direct read that every branch increments `i` except the intentionally-last `rng.End` clause
  (commented `no further i++ needed`, `:184-185`), which is correct since nothing follows it.

**TDD**: `red-green required`. Write each test's `mock.ExpectQuery(...)` regex so it requires the
literal substring `intent_updated_at` to appear in the SQL text the repo method emits (e.g.
`(?s)LEFT JOIN LATERAL.*intent_updated_at` — `pgxmock.ExpectQuery` compiles its argument as a Go
regexp against the query string, so escape `$`/`(` in any other required substrings). Run
`go test ./internal/repository/... -run TestGetOrder -v` etc. against the tree **before** Step
1's alias rename is applied: pgxmock reports "call to Query/QueryRow was not expected" because
the emitted SQL still reads bare `updated_at`, not `updated_at AS intent_updated_at` — this is
the red run. After Step 1's rename, the same regex matches and the test passes — the green run.
Record both runs' output in `context.md` per **P-06**.

**Instructions**:
1. Add the `pgxmock` dependency per the Codebase Evidence above (prefer `go get`, verify the
   resulting `go.mod`/`go.sum` diff matches — or is a superset compatible with — the cited
   portfolio lines).
2. Create `services/xstockstrat-trading/internal/repository/trading_repo_test.go`, `package
   repository`, importing `context`, `testing`, `time`, `github.com/pashagolub/pgxmock/v4`,
   `commonv1 "github.com/xstockstrat/contracts/gen/go/common/v1"`,
   `tradingv1 "github.com/xstockstrat/contracts/gen/go/trading/v1"`.
3. Write **`TestGetOrder_ExercisesIntentLateralJoin`**: `pgxmock.NewPool()` →
   `repo := &TradingRepo{db: mock}` → build one mocked order row (all 21 `scanOrder` columns —
   see Codebase Evidence) with a **non-NULL** intent-state value in the last column (proving the
   LATERAL join path is genuinely exercised, not NULL-bypassed) → `mock.ExpectQuery` with a regex
   requiring both `intent_updated_at` (the regression guard — see TDD) and
   `WHERE order_id = \$1` → `.WithArgs("order-1").WillReturnRows(rows)` → call
   `repo.GetOrder(ctx, "order-1")` → assert `err == nil`, assert the returned `Order.UpdatedAt`
   equals the fixture's own `updated_at` value (proves `scanOrder`'s positional mapping is
   unaffected by the rename — it never selects `li.updated_at`/`intent_updated_at` at all), assert
   `Order.IntentState` equals the mocked non-NULL intent state → `mock.ExpectationsWereMet()`.
4. Write **`TestListOrders_ExercisesIntentLateralJoinWithMultipleFilters`**: same seam/fixture
   shape as step 3, but call `repo.ListOrders(ctx, userID, status, ...)` with **at least 2**
   simultaneous optional filters set (e.g. non-empty `userID` **and** a non-`UNSPECIFIED`
   `status`) — defensive coverage named explicitly here (per design.md) for the positional
   arg-index builder `fails.md` already flagged once in this function. Assert the regex requires
   `intent_updated_at` **and** two distinct placeholders (`\$1`, `\$2`) in the emitted query text,
   assert `.WithArgs(userID, statusStr)` matches in the correct order (catches a future
   arg-index-skip regression the same way the historical bug would have been caught), assert the
   returned order's `UpdatedAt`/`IntentState` as in step 3.
5. Write **`TestListSubmittedOrders_ExercisesIntentLateralJoin`**: same seam/fixture shape,
   `mock.ExpectQuery` regex requires `intent_updated_at` and the static
   `status IN ('new', 'partially_filled')` clause, no `WithArgs` needed (the method takes no
   filter args) → call `repo.ListSubmittedOrders(ctx)` → same UpdatedAt/IntentState assertions.
6. Per **C-13** (Go home: `internal/testdata/`, materializes on the **second** consumer — this
   service currently has no `internal/testdata/` directory, confirmed via `find`): once all three
   test bodies are written, compare their order-row/intent-row fixture literals. If ≥2 of the 3
   share substantially the same fixture (same column values, only the mocked query/filters
   differ), extract a shared fixture-row constructor into a new
   `services/xstockstrat-trading/internal/testdata/` package in this same step and have all
   sharing tests call it. If each test's fixture differs enough that no literal is duplicated
   (e.g. each needs distinct `order_id`/args to prove its own filter path), leave them inline and
   record that verdict in this step's execute-time note — do not create the package speculatively.
7. Best-effort live-DB smoke test (product spec acceptance criterion, design.md Open Risk 1):
   `pgxmock` never parses real SQL, so it cannot detect a differently-shaped ambiguity/typo the
   way Postgres would. If a local `docker-compose` TimescaleDB is reachable in the execute
   environment, bring it up (`docker compose up -d timescaledb`, run migrations per
   `docs/patterns/database.md`), seed one `trading.orders` row and one `trading.order_intents`
   row for it, and call `ListOrders` (directly or via a throwaway `go run` harness) to confirm no
   `SQLSTATE 42702`. Record the result (ran + passed, or unavailable + why) in `context.md`. If
   unavailable, the product spec's own fallback ("otherwise confirmed via go vet/query-shape
   review") is satisfied by steps 1-6 above plus `go vet`.

**Verification**:
```bash
cd services/xstockstrat-trading && GOWORK=off go vet ./...
cd services/xstockstrat-trading && GOWORK=off golangci-lint run --modules-download-mode=mod
cd services/xstockstrat-trading && GOWORK=off go test ./internal/repository/... -race -count=1 -v -run 'TestGetOrder_ExercisesIntentLateralJoin|TestListOrders_ExercisesIntentLateralJoinWithMultipleFilters|TestListSubmittedOrders_ExercisesIntentLateralJoin'
```
All three new tests pass; capture the pre-Step-1-rename run (red) and post-rename run (green) per
the TDD note above. New code is entirely in `internal/repository/`, a package excluded from this
service's CI `COVERPKGS` measurement (`.claude/skills/sdd-spec/reference/spec-template.md`
coverage table) — no coverage-percentage threshold applies to it; the full existing suite must
still pass:
```bash
cd services/xstockstrat-trading && GOWORK=off COVERPKGS=$(go list ./... | grep -Ev '/(cmd|handler|repository|telemetry|service)(/|$)' | tr '\n' ',' | sed 's/,$//') && go test ./... -race -count=1 -coverprofile=coverage.out -covermode=atomic -coverpkg="${COVERPKGS}" && go tool cover -func=coverage.out | grep "^total:"
```

---

## Deviation Log

_Populated by /sdd-execute as implementation proceeds._
