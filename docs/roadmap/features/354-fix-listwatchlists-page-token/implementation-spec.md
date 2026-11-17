# Implementation Spec: fix-listwatchlists-page-token

**Status**: `pending`
**Created**: 2026-11-17
**Feature**: `docs/roadmap/features/354-fix-listwatchlists-page-token/feature.md`
**Total Steps**: 2
**Feature Branch**: `ccr-fix-listwatchlists-page-token` (harness `ccr-*` branch off `main-dev`, used in place of `feature/fix-listwatchlists-page-token` — see feature.md `**Development Branch**`)

---

## Execution Summary

The fix is a one-index change in `WatchlistRepo.ListByUser`: the token becomes the last returned row (`wls[pageSize-1]`) instead of the look-ahead row (`wls[pageSize]`). It also gets a seam, so the method's main query reads through the existing mockable `r.db`, which is identical in production (design.md § Chosen Approach; D-1, D-3). Steps 1 (`service`) and 2 (`test`) are one `**Lands with**` unit. The order inside the unit is: Step 1 seam edit only → Step 2 tests → RED (unit + real-backend dbtest) → the rest of Step 1 (fix + comments) → GREEN → one commit (D-8). That way neither a red tree nor an untested seam is ever committed. No proto, migration, or config change.

FR-1 and FR-2 (product-spec.md) describe the **fully rolled-out** fix. During the mixed-version rollout, an old-server token sent to a new server can skip one existing list once, which is the same loss as today (design.md D-7, D-23).

**Scenario coverage (C-15):**
- `@AC-1` (page_size 1 traversal returns a, b, c exactly once, final token empty) → Step 2: dbtest subtest `AC-1_page_size_1_traversal` (RED) plus unit guard `TestListByUser_ExactlyFullPageHasNoToken`.
- `@AC-2` (page_size 2 → token = id of b) → Step 2: dbtest subtest `AC-2_page_size_2_token` (RED) plus unit `TestListByUser_TokenIsLastReturnedRow` (RED).

**Consumer surfaces (C-14):**
- **Agent MCP `list_watchlists`** (`services/xstockstrat-agent/app/tools.py:2153-2166`, client `services/xstockstrat-agent/app/client.py:416-432`) has **no implementation step**. This is a **C-14 override by explicit user sign-off**, not a deferral, and there is no follow-up feature. The sign-off is recorded verbatim in `context.md` (Session 2026-11-17 — sdd-design (completed)) and `design.md` § Constitution Rules Touched. Its basis: the tool is a single passthrough of `page_token`/`next_page_token` with no agent-side token logic, so the portfolio fix reaches it with no code change. It is listed in `## Deviation Log` below so `/sdd-review` (`impl-spec-criteria.md:31`) sees the override.
- **UI `/insights`** (`services/xstockstrat-ui/src/hooks/useWatchlists.ts:33`) makes one call with `pageSize: 50` and never follows `nextPageToken`, so it is unaffected and needs no step.
- **Analysis drains** (`services/xstockstrat-analysis/app/engine/live_loop.py:592`, `services/xstockstrat-analysis/app/handlers/servicer.py:5995`) are internal and token-agnostic; there is no step.

## Step Dependencies

- Steps 1+2 land together (`**Lands with**`), backend surface only, 2 members. The reason is the user-approved design D-8: one red→green cycle and one F-08-staged commit, so neither a red tree nor an untested seam is committed. This is **not** a strict `step-constraints.md` §C table trigger: Step 1 alone could pass build/lint, so `/sdd-review` may WARN "Lands with declared but no §C trigger applies". The fold is deliberate and approved (D-8, O-10).
  - Step 2's unit tests construct `&WatchlistRepo{db: mock}` with a nil `pool`. They can execute `ListByUser` only after Step 1's seam (`r.pool.Query` → `r.db.Query`, `watchlist_repo.go:111`); without it they hit a nil-pointer panic, not an assertion failure.
  - Step 1's fix has no RED proof without Step 2's tests.
- Execution order inside the unit (D-8, D-10):
  1. Step 1 edit (a) only: the seam.
  2. Write all of Step 2.
  3. Capture RED, unit and dbtest.
  4. Step 1 edits (b) fix and (c) comments.
  5. Capture GREEN, then run the regression suite.
  6. Make one commit staging the union of both steps' `**Files**`.
- Post-merge launch check (D-19, not a step): after the rollout completes, run a dev smoke of agent `list_watchlists` with `limit` below the caller's list count, following `next_page_token` until it is empty. It must return every list exactly once. It is not offered as satisfying C-14.

---

### Step 1 — service: Token = last returned row in `WatchlistRepo.ListByUser`; page query through `r.db`

**Status**: `pending`
**Service**: `xstockstrat-portfolio`
**Files**:
- `services/xstockstrat-portfolio/internal/repository/watchlist_repo.go` — modify

**Reviewers**: `xstockstrat-portfolio` owner — P&L calculation accuracy, position snapshot consistency, concurrent write safety

**Codebase Evidence**:
- `grep -n "func (r \*WatchlistRepo) ListByUser" services/xstockstrat-portfolio/internal/repository/watchlist_repo.go` → line 107. Clamp `if pageSize <= 0 || pageSize > 500 { pageSize = 100 }` at `:108-110`.
- Main query at `:111`: `rows, err := r.pool.Query(ctx,`. The SQL is at `:112-115`, with `WHERE user_id = $1 AND ($2 = '' OR watchlist_id > $2::uuid)` at `:114` and `ORDER BY watchlist_id ASC LIMIT $3` at `:115`. The args at `:116` are `userID, pageToken, pageSize+1`.
- Comment block `:135-136`: "// Truncate the +1 lookahead FIRST, then batch bindings over exactly the returned page's IDs" / "// (feature 178) — the lookahead row is not part of the response and must not be read."
- Bug at `:137-141`: `if len(wls) > pageSize { nextToken = wls[pageSize].WatchlistId; wls = wls[:pageSize] }` (token at `:139`).
- Struct `:25-30`: `pool *pgxpool.Pool` and `db queryRower`. The field comment is `:27-28`: "// db is the mockable query surface (pool in prod, pgxmock in tests), mirroring PortfolioRepo." / "// bindingsByWatchlist reads through it so its single ANY-array query is unit-testable offline."
- Constructor `:34` `return &WatchlistRepo{pool: pool, db: pool}`. It is the only constructor, so `r.db` is `r.pool` in production (D-3).
- `queryRower` (`internal/repository/portfolio_repo.go:22-26`) has `Query(ctx, sql string, args ...any) (pgx.Rows, error)`, the same signature as the pool call. `bindingsByWatchlist` already reads through `r.db.Query` (`watchlist_repo.go:167`).
- Precedent for a keyset token from the last returned row with a strict `>`: `services/xstockstrat-marketdata/internal/repository/marketdata_repo.go:954-958` (D-1). The keyset is unique because `watchlist_id UUID PRIMARY KEY` (`migrations/007_watchlists.up.sql:6`).
- `r.pool` stays in use elsewhere in the file (e.g. `:40`, `:67`, `:447`), so `unused` cannot fire on the field (D-15).
- Sole service caller is `PortfolioService.ListWatchlists` (`internal/service/portfolio_service.go:2257`, response at `:2263`). Signature and return shape are unchanged, so no caller edits are needed.

**Lands with**: `Step 2`

**TDD**: `red-green required` — RED/GREEN proven by Step 2's tests. Apply edit (a) before RED and edits (b)+(c) after RED.

**Covers**: —

**Instructions**:
Edit `services/xstockstrat-portfolio/internal/repository/watchlist_repo.go`:

(a) **Seam (apply FIRST, before Step 2's RED).** At `:111`, change `rows, err := r.pool.Query(ctx,` to `rows, err := r.db.Query(ctx,`. Leave the SQL text and the args `userID, pageToken, pageSize+1` byte-for-byte unchanged.

(b) **Fix (apply AFTER RED).** At `:139`, change `nextToken = wls[pageSize].WatchlistId` to `nextToken = wls[pageSize-1].WatchlistId`. Leave the following unchanged:
- the exclusive predicate (`:114`);
- the `pageSize+1` look-ahead (`:116`);
- the `if len(wls) > pageSize` guard;
- `wls = wls[:pageSize]`;
- truncation running before `r.bindingsByWatchlist` (feature-178 rule; D-2).

An exactly-full last page and an empty result keep returning `""`.

(c) **Comments (apply with (b); How-to-Act #5, ≤2 lines, constraint-only; D-11).**
- Replace the two lines at `:135-136` with exactly:
  ```go
  	// Token must be the last RETURNED id (the next page's WHERE is a strict >); truncate the +1
  	// lookahead before the bindings batch so the lookahead row is never read.
  ```
- Replace the two-line field comment at `:27-28` with exactly one line:
  ```go
  	// db is the mockable query surface (pool in prod, pgxmock in tests); route every query through it.
  ```

Make no other edit. Do not touch the twin `ListPositions` defect (`internal/repository/portfolio_repo.go`; owned by another session).

**Verification** (cwd `services/xstockstrat-portfolio`; unit-level, its union with Step 2 governs the commit):
```bash
cd services/xstockstrat-portfolio
grep -n "r.db.Query(ctx," internal/repository/watchlist_repo.go          # expect 2 hits: ListByUser + bindingsByWatchlist
grep -n "nextToken = wls\[pageSize-1\].WatchlistId" internal/repository/watchlist_repo.go   # expect 1 hit
grep -c "wls\[pageSize\]\.WatchlistId" internal/repository/watchlist_repo.go               # expect 0
grep -n "watchlist_id > \$2::uuid" internal/repository/watchlist_repo.go                   # predicate unchanged (strict >)
GOWORK=off go build ./... && GOWORK=off go vet -tags dbtest ./...
GOWORK=off golangci-lint run --modules-download-mode=mod
```

---

### Step 2 — test: Unit (pgxmock) and real-backend dbtest proof of the page-token contract

**Status**: `pending`
**Service**: `xstockstrat-portfolio`
**Files**:
- `services/xstockstrat-portfolio/internal/repository/watchlist_repo_test.go` — modify
- `services/xstockstrat-portfolio/internal/repository/dbtest_helpers_test.go` — modify
- `services/xstockstrat-portfolio/internal/repository/watchlist_list_dbtest_test.go` — create

**Reviewers**: `xstockstrat-portfolio` owner — P&L calculation accuracy, position snapshot consistency, concurrent write safety

**Codebase Evidence**:
- **Unit harness** `internal/repository/watchlist_repo_test.go`:
  - imports at `:3-10`: std `context`, `testing`; `github.com/pashagolub/pgxmock/v4`; local `portfoliov1`;
  - pattern at `:17-23`: `mock, err := pgxmock.NewPool()` … `repo := &WatchlistRepo{db: mock}`;
  - bindings expectation at `:32-34`: `mock.ExpectQuery(`watchlist_id = ANY\(\$1::uuid\[\]\)`).WithArgs([]string{"wl-a", "wl-b"})`;
  - binding columns at `:25`: `"watchlist_id", "symbol", "strategy_id", "source"`;
  - there is no existing test of `ListByUser`/`ListWatchlists` at any layer (recon.md § Risks).
- `pgxmock/v4 v4.9.0` (`go.mod:9`), Go `1.27.0` (`go.mod:3`). `for range N`, `slices` and `fmt` are available.
- **Columns:** `scanWatchlist` (`watchlist_repo.go:585-592`) scans 8 columns: id, userID, name, description (string), createdAt, updatedAt (`time.Time`), systemManaged (bool), defaultStrategyID (string). `description` and `default_strategy_id` are `TEXT NOT NULL DEFAULT ''` (O-6), so the mock rows use `""` and need no NULLs. Precedent for a pgxmock row helper using `time.Now()`: `internal/service/portfolio_fill_errors_test.go:52`.
- **dbtest harness** `internal/repository/dbtest_helpers_test.go`:
  - `//go:build dbtest` (`:1`); `testPool(t)` `:22-49` (Skip when `PORTFOLIO_DB_TEST_URL` is unset, Fatal under `CI=true`, `lock_timeout=500ms` `:35`, cleanup deletes `it-281-%` watchlists `:42-47`); `testUserID(t)` `:52-55`;
  - `seedWatchlist(t, pool, userID string, systemManaged bool) string` at `:57-68` uses the fixed name `"wl-"+userID`. It is called from 66 sites across the existing `*_dbtest_test.go` files, so its signature must not change.
- One user cannot have two non-system lists with the same name (`migrations/011_watchlist_system_managed_source.up.sql:20-22`, `watchlists_user_name_not_system_uidx`), so a named-seed variant is required (D-4, D-12).
- dbtest file header precedent: `internal/repository/watchlist_signal_expiry_add_dbtest_test.go:1-13` (`//go:build dbtest`, blank line, `package repository`). `watchlist_list_dbtest_test.go` is confirmed absent.
- **CI and lint:**
  - CI `portfolio-db-test` (`.github/workflows/ci.yml:1017`; TimescaleDB `timescale/timescaledb:latest-pg16` `:1029`; migrations `:1052`) runs `go test -tags dbtest -race -count=1 ./internal/repository/...` with `CI: "true"` and `PORTFOLIO_DB_TEST_URL` set (`:1059-1065`).
  - `.golangci.yml:26-29` lints with `build-tags: [dbtest]`; goimports `local-prefixes: github.com/xstockstrat` (`:17-24`).
  - Coverage `-coverpkg` excludes `repository` (`ci.yml:361-375`).
- **Local harness feasibility:** `/usr/lib/postgresql/16/bin/{initdb,pg_ctl}` and `/usr/bin/psql` are present, and an OS user `postgres` exists. The only TimescaleDB call is `migrations/001_portfolio_hypertable.up.sql:35-40` (`create_hypertable('portfolio.snapshots', 'snapshot_time', chunk_time_interval => INTERVAL '1 day', if_not_exists => TRUE)`). No migration needs an `EXTENSION`, and none contains envsubst placeholders. All 19 `*.up.sql` applied on PG16 with a shim in the orchestrator smoke run (context.md 2026-11-17, D-10).
- **C-13 verdict:** pgxmock rows and seeded names are SQL-shape scenario one-offs with a single consumer, not domain fixtures. No `internal/testdata/` addition (D-16). jscpd ignores tests (`.jscpd.json:22`).

**Lands with**: `Step 1`

**TDD**: `red-green required`

**Covers**: `AC-1, AC-2`

**Instructions**:

**2a. `dbtest_helpers_test.go`** (D-4, D-12). Replace `seedWatchlist` (`:57-68`) with a named variant plus a delegate with the same signature. Keep the INSERT verbatim:
```go
func seedWatchlist(t *testing.T, pool *pgxpool.Pool, userID string, systemManaged bool) string {
	t.Helper()
	return seedNamedWatchlist(t, pool, userID, "wl-"+userID, systemManaged)
}

func seedNamedWatchlist(t *testing.T, pool *pgxpool.Pool, userID, name string, systemManaged bool) string {
	t.Helper()
	var id string
	err := pool.QueryRow(context.Background(),
		`INSERT INTO portfolio.watchlists (user_id, name, system_managed)
		 VALUES ($1, $2, $3) RETURNING watchlist_id::text`,
		userID, name, systemManaged).Scan(&id)
	if err != nil {
		t.Fatalf("seedNamedWatchlist: %v", err)
	}
	return id
}
```

**2b. `watchlist_repo_test.go`** (D-9, D-13, D-16).
- Add `"time"` to the std import group (`context`, `testing`, `time`). Leave the pgxmock and local `portfoliov1` groups as they are.
- Leave `TestBindingsByWatchlist_SingleAnyArrayQuery` and `TestBindingSymbols_MirrorsBindings_Feature196` untouched.
- Append:
```go
// listPageSQL pins the strict > keyset and the LIMIT placeholder; LIMIT's value is pinned by WithArgs.
const listPageSQL = `FROM portfolio\.watchlists\s+WHERE user_id = \$1 AND \(\$2 = '' OR watchlist_id > \$2::uuid\)\s+ORDER BY watchlist_id ASC LIMIT \$3`

func listPageRows(mock pgxmock.PgxPoolIface, ids ...string) *pgxmock.Rows {
	now := time.Now()
	rows := mock.NewRows([]string{"watchlist_id", "user_id", "name", "description", "created_at", "updated_at", "system_managed", "default_strategy_id"})
	for _, id := range ids {
		rows.AddRow(id, "u1", "name-"+id, "", now, now, false, "")
	}
	return rows
}

func expectNoBindings(mock pgxmock.PgxPoolIface, ids ...string) {
	mock.ExpectQuery(`watchlist_id = ANY\(\$1::uuid\[\]\)`).
		WithArgs(ids).
		WillReturnRows(mock.NewRows([]string{"watchlist_id", "symbol", "strategy_id", "source"}))
}

// @AC-2: the token is the last RETURNED row, not the +1 lookahead row.
func TestListByUser_TokenIsLastReturnedRow(t *testing.T) {
	mock, err := pgxmock.NewPool()
	if err != nil {
		t.Fatalf("pgxmock.NewPool: %v", err)
	}
	defer mock.Close()
	repo := &WatchlistRepo{db: mock}

	mock.ExpectQuery(listPageSQL).WithArgs("u1", "", 3).WillReturnRows(listPageRows(mock, "wl-a", "wl-b", "wl-c"))
	expectNoBindings(mock, "wl-a", "wl-b")

	wls, next, err := repo.ListByUser(context.Background(), "u1", 2, "")
	if err != nil {
		t.Fatalf("ListByUser: %v", err)
	}
	if len(wls) != 2 || wls[0].WatchlistId != "wl-a" || wls[1].WatchlistId != "wl-b" {
		t.Fatalf("page = %v, want [wl-a wl-b]", wls)
	}
	if next != "wl-b" {
		t.Fatalf("next_page_token = %q, want last returned id %q", next, "wl-b")
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("expectations: %v", err)
	}
}

// @AC-1 guard: an exactly-full last page ends the traversal (empty token).
func TestListByUser_ExactlyFullPageHasNoToken(t *testing.T) {
	mock, err := pgxmock.NewPool()
	if err != nil {
		t.Fatalf("pgxmock.NewPool: %v", err)
	}
	defer mock.Close()
	repo := &WatchlistRepo{db: mock}

	mock.ExpectQuery(listPageSQL).WithArgs("u1", "", 3).WillReturnRows(listPageRows(mock, "wl-a", "wl-b"))
	expectNoBindings(mock, "wl-a", "wl-b")

	wls, next, err := repo.ListByUser(context.Background(), "u1", 2, "")
	if err != nil {
		t.Fatalf("ListByUser: %v", err)
	}
	if len(wls) != 2 {
		t.Fatalf("page len = %d, want 2", len(wls))
	}
	if next != "" {
		t.Fatalf("next_page_token = %q, want empty on an exactly-full last page", next)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("expectations: %v", err)
	}
}
```
- `WithArgs("u1", "", 3)` pins `pageSize+1`. **No `pgxmock.AnyArg()`** (R-11).
- If an execute-time run reports "could not match actual sql" or an arg mismatch, that is a test-harness defect, not a RED. Fix the regex/args and record it in `## Deviation Log` (F-09; design.md Open Risk 1). Never edit this step body.

**2c. Create `watchlist_list_dbtest_test.go`** (D-9, D-14). The parent owns the pool, repo and user and seeds once. Each subtest uses the closure only and never calls `testPool` (its cleanup would wipe the shared fixture; O-3):
```go
//go:build dbtest

package repository

import (
	"context"
	"fmt"
	"slices"
	"testing"
)

func TestListByUser_PageTokenTraversal(t *testing.T) {
	pool := testPool(t)
	repo := NewWatchlistRepo(pool)
	userID := testUserID(t)
	ctx := context.Background()

	var ids []string
	for i := range 3 {
		ids = append(ids, seedNamedWatchlist(t, pool, userID, fmt.Sprintf("wl-%d", i), false))
	}
	if len(ids) != 3 {
		t.Fatalf("seeded %d watchlists, want 3", len(ids))
	}
	slices.Sort(ids)

	t.Run("AC-1_page_size_1_traversal", func(t *testing.T) {
		var got []string
		token := ""
		for range len(ids) + 2 {
			page, next, err := repo.ListByUser(ctx, userID, 1, token)
			if err != nil {
				t.Fatalf("ListByUser(token=%q): %v", token, err)
			}
			for _, wl := range page {
				got = append(got, wl.WatchlistId)
			}
			token = next
			if token == "" {
				break
			}
		}
		if token != "" {
			t.Fatalf("traversal did not end within %d pages; last token %q", len(ids)+2, token)
		}
		if !slices.Equal(got, ids) {
			t.Fatalf("traversal = %v, want %v (every list exactly once, ascending)", got, ids)
		}
	})

	t.Run("AC-2_page_size_2_token", func(t *testing.T) {
		page, next, err := repo.ListByUser(ctx, userID, 2, "")
		if err != nil {
			t.Fatalf("ListByUser: %v", err)
		}
		var got []string
		for _, wl := range page {
			got = append(got, wl.WatchlistId)
		}
		if !slices.Equal(got, ids[:2]) {
			t.Fatalf("page = %v, want %v", got, ids[:2])
		}
		if next != ids[1] {
			t.Fatalf("next_page_token = %q, want last returned id %q", next, ids[1])
		}
	})
}
```

**2d. Expected RED** (after Step 1 edit (a) only, before (b)):
- **unit:**
  - `TestListByUser_TokenIsLastReturnedRow` → `--- FAIL` (`next_page_token = "wl-c", want last returned id "wl-b"`);
  - `TestListByUser_ExactlyFullPageHasNoToken` → `--- PASS` (regression guard; O-7).
- **dbtest:**
  - `AC-1_page_size_1_traversal` → `--- FAIL` (traversal = `[a c]`);
  - `AC-2_page_size_2_token` → `--- FAIL` (token = id of c).
- The unit RED is captured **post-seam / pre-fix**: without the seam, the nil `pool` would panic. The dbtest RED runs the unmodified SQL and args (`NewWatchlistRepo` sets `db: pool`).
- Disclose both points in the PR body and context.md (O-11, D-10).

**2e. Ephemeral real-backend harness** (evidence only, never committed; R-5). Use a migrated TimescaleDB if one is reachable. Otherwise run the following from the repo root, with the data dir outside the scratchpad and server processes as the non-root `postgres` OS user:
```bash
PGB=/usr/lib/postgresql/16/bin; H=/tmp/pg354; P=55432
install -d -o postgres -g postgres "$H"
su postgres -c "$PGB/initdb -D $H/data -U xstockstrat --auth=trust" >/dev/null
su postgres -c "$PGB/pg_ctl -D $H/data -o '-p $P -k $H' -l $H/log -w start"
psql -h localhost -p $P -U xstockstrat -d postgres -v ON_ERROR_STOP=1 -c 'CREATE DATABASE xstockstrat'
psql -h localhost -p $P -U xstockstrat -d xstockstrat -v ON_ERROR_STOP=1 -c 'CREATE FUNCTION public.create_hypertable(relation regclass, time_column_name name, chunk_time_interval interval DEFAULT NULL, if_not_exists boolean DEFAULT false) RETURNS void LANGUAGE plpgsql AS $$BEGIN END$$'
for f in $(ls services/xstockstrat-portfolio/migrations/*.up.sql | sort); do
  psql -h localhost -p $P -U xstockstrat -d xstockstrat -v ON_ERROR_STOP=1 -q -f "$f" || { echo "FAILED: $f"; break; }
done
export PORTFOLIO_DB_TEST_URL="postgres://xstockstrat@localhost:$P/xstockstrat?sslmode=disable"
```
- **All 19** migrations must apply. A partial chain is invalid (R-6).
- Record this fidelity delta: "PG16 + no-op `create_hypertable` shim; only `portfolio.snapshots` is not a hypertable; watchlist DDL verbatim".
- Tear down after GREEN and regression:
```bash
su postgres -c "$PGB/pg_ctl -D $H/data -m fast stop"; rm -rf "$H"
```
- Fallback (P-03, deviation only): only if neither TimescaleDB nor PG16 can start, use the unit Case A as the RED stand-in and log it in `## Deviation Log`.

**Verification** (cwd `services/xstockstrat-portfolio`; run RED and GREEN as described; any `SKIP`, or "PORTFOLIO_DB_TEST_URL unset", in a dbtest run invalidates it):
```bash
cd services/xstockstrat-portfolio
# Unit RED (post-seam, pre-fix) then GREEN — evidence = per-test --- FAIL / --- PASS lines
GOWORK=off go test -race -count=1 -v -run 'TestListByUser_' ./internal/repository/
# Real-backend dbtest RED then GREEN (PORTFOLIO_DB_TEST_URL from 2e) — evidence = per-subtest --- FAIL / --- PASS
GOWORK=off go test -tags dbtest -race -count=1 -v -run 'TestListByUser_PageTokenTraversal' ./internal/repository/
# Regression (GREEN tree): full dbtest package on the harness proves the seedWatchlist delegate keeps existing dbtests green
GOWORK=off go test -tags dbtest -race -count=1 ./internal/repository/...
GOWORK=off go test -tags dbtest -list 'TestListByUser_PageTokenTraversal' ./internal/repository/
GOWORK=off go vet -tags dbtest ./...
GOWORK=off golangci-lint run --modules-download-mode=mod
# C-13: one declaration site per helper
grep -rn "func listPageRows\|func expectNoBindings\|func seedNamedWatchlist" --include="*_test.go" .   # expect exactly 3 lines
# Coverage gate (C-08): new logic is in an excluded package (repository) — no threshold applies; run to confirm the suite and the total are unaffected (≥ 40%)
GOWORK=off COVERPKGS=$(go list ./... | grep -Ev '/(cmd|handler|repository|telemetry|service)(/|$)' | tr '\n' ',' | sed 's/,$//') && GOWORK=off go test ./... -race -count=1 -coverprofile=coverage.out -covermode=atomic -coverpkg="${COVERPKGS}" && go tool cover -func=coverage.out | grep "^total:"
```
- **GREEN of record:** CI `portfolio-db-test` (TimescaleDB) passes on the PR, together with the local `-list` output above (D-10 (iii)).
- **The PR body and context.md must disclose:**
  - unit RED was captured post-seam / pre-fix;
  - dbtest RED ran on the unmodified SQL/args;
  - the harness fidelity delta;
  - CI `portfolio-db-test` is the GREEN of record;
  - the mixed-fleet note (D-7);
  - consumer impact (D-5): agent passthrough, UI single page, and analysis drains now lossless for owners with more than 100 lists;
  - the post-merge dev smoke (D-19) on the launch checklist.

---

## Deviation Log

_Populated by /sdd-execute as implementation proceeds._

| Date | Step | Deviation | Reason / authority |
|---|---|---|---|
| 2026-11-17 | — (spec-time) | **C-14 override:** the named Agent MCP surface `list_watchlists` (`services/xstockstrat-agent/app/tools.py:2153-2166`, `app/client.py:416-432`) has no `xstockstrat-agent` implementation step. This is an **override, not a deferral**; there is no follow-up feature. | Explicit user sign-off 2026-11-17, recorded verbatim in `context.md` (Session 2026-11-17 — sdd-design (completed)) and `design.md` § Constitution Rules Touched. Basis: a single passthrough with no agent-side token logic, reached by the portfolio fix unchanged; its contract is guarded by PRESERVE `@AC-1 @feature-148` (which does not check token meaning); the D-7 rollout window is the same loss as today. Rejected step shapes: R-10, R-12, R-13. |
