# Implementation Spec: fix-fundamentals-upsert-invalid-json

**Status**: `in-progress`
**Created**: 2026-08-16
**Feature**: `docs/roadmap/features/142-fix-fundamentals-upsert-invalid-json/feature.md`
**Total Steps**: 4
**Feature Branch**: `claude/commit-135-opportunities-strategies-0xjnxk`

---

## Execution Summary

`UpsertFundamentals` (`services/xstockstrat-marketdata/internal/repository/marketdata_repo.go:300-332`)
fails with Postgres SQLSTATE 22P02 because the `extra_metrics` bind parameter (`$14`) has no
`::jsonb` cast, and the service runs under `pgx.QueryExecModeExec` (required for its PgBouncer
pool), which skips the round-trip that would otherwise let pgx infer the parameter's real column
type. Per the design's **mandatory pre-merge verification gate**, the fix ships only after a live
Postgres repro proves the hypothesis both before (RED, Step 1) and after (GREEN, Step 3) the code
change (Step 2), because no CI job runs a Go test against a live database and nothing would
otherwise catch a wrong hypothesis before merge. Step 4 adds a permanent `pgxmock` regression test
that pins the `::jsonb` cast in the emitted SQL text — an explicitly-scoped "don't delete the cast"
tripwire, not a substitute for the live repro. No proto, config, or migration changes.

## Step Dependencies

- Step 2 requires Step 1: the fix must not be applied until the manual repro has captured the RED
  state (SQLSTATE 22P02) against the current, unfixed code — reversing the order would make Step 1
  meaningless (design.md § Mandatory pre-merge verification gate, steps 1-5).
- Step 3 requires Step 2: the GREEN confirmation re-runs the identical repro against the fixed code.
- Step 4 requires Step 2: the `db execer` field Step 2 adds to `MarketDataRepo` is what makes the
  repository substitutable with `pgxmock` in the test.
- Step 4 [test] is the Constitution **C-08** paired test for Step 2 [service]. Steps 1 and 3 are the
  *additional*, user-mandated manual verification gate (design.md) that C-08/pgxmock alone cannot
  provide, per the adversary's objection that a `pgxmock` text-pin never exercises pgx's real
  OID-inference path against real Postgres.

---

### Step 1 — test: Mandatory pre-merge repro — reproduce SQLSTATE 22P02 against unfixed code (RED)

**Status**: `blocked`
**Service**: `xstockstrat-marketdata`
**Files**:
- `docs/roadmap/features/142-fix-fundamentals-upsert-invalid-json/context.md` — modify (append the
  captured pre-fix error transcript)

**Reviewers**: Service owner (`xstockstrat-marketdata`) — OHLCV ingestion integrity, TimescaleDB
hypertable partitioning, Alpaca feed idempotency (`docs/runbooks/reviewer-registry.md`)

**Codebase Evidence**:
- `UpsertFundamentals` — `services/xstockstrat-marketdata/internal/repository/marketdata_repo.go:300-335`
  (current, unfixed SQL text with no `::jsonb` cast at `$14`, line 316)
- `DB_PGBOUNCER` activates `pgx.QueryExecModeExec` — `services/xstockstrat-marketdata/internal/repository/pool.go:36-38`
- `docker-compose.yml:69-77` — `timescaledb` service, `POSTGRES_PASSWORD` from `.env`, host port
  mapping `"5432:5432"` (`docker-compose.yml:77`); `DATABASE_URL` construction —
  `docker-compose.yml:23`: `postgres://xstockstrat:${POSTGRES_PASSWORD}@timescaledb:5432/xstockstrat?sslmode=disable`
  (substitute `timescaledb` → `localhost` when connecting from the host)
- `scripts/db-migrate.sh:1-24` — usage (`DATABASE_URL` env var required), applies all services'
  migrations including `xstockstrat-marketdata` in dependency order (`:147`)
- `services/xstockstrat-marketdata/migrations/002_fundamentals.up.sql:8-24` — `marketdata.fundamentals`
  table, `extra_metrics jsonb NOT NULL DEFAULT '{}'` (`:21`)
- `source.Fundamentals` struct — `services/xstockstrat-marketdata/internal/source/source.go:34-51`
  (`Symbol string`, `ExtraMetrics map[string]float64`, `Source string`, ...)
- Finnhub's `ExtraMetrics` is always `map[string]float64{}` (the empty-map case this repro
  exercises, per recon.md's finding that this is the symbol-agnostic, default-provider case) —
  `services/xstockstrat-marketdata/internal/finnhub/finnhub_client.go:106`
- `NewMarketDataRepo(connStr string) (*MarketDataRepo, error)` —
  `services/xstockstrat-marketdata/internal/repository/marketdata_repo.go:25-34`

**TDD**: `N/A (manual, non-CI live-DB gate — design.md § Mandatory pre-merge verification gate; not
an automated red/green pair run by /sdd-execute's TDD harness, per design.md's own note that no Go
CI job provisions a live Postgres — confirmed absent from the `go-lint` matrix,
`.github/workflows/ci.yml:185-230`)`. This step **is** the RED half of the gate design.md requires,
captured manually rather than via a committed test.

**Instructions**:
1. Ensure `.env` has `POSTGRES_PASSWORD` set (copy from `.env.example` if absent).
2. Start only the database: `docker compose up -d timescaledb`.
3. Wait for it healthy: `docker compose ps timescaledb` (or `docker compose logs -f timescaledb`
   until ready).
4. From the repo root, apply all pending migrations against the local instance:
   ```bash
   export DATABASE_URL="postgres://xstockstrat:${POSTGRES_PASSWORD}@localhost:5432/xstockstrat?sslmode=disable"
   ./scripts/db-migrate.sh
   ```
   (this runs every service's migrations in dependency order, including `xstockstrat-marketdata`'s
   `002_fundamentals.up.sql`, per `scripts/db-migrate.sh:147`).
5. Write a throwaway, **never-committed** repro program at
   `services/xstockstrat-marketdata/scratch/repro_upsert/main.go` (placed under the module tree so
   it can import the `internal/` packages per Go's internal-import visibility rule):
   ```go
   package main

   import (
       "context"
       "fmt"
       "os"

       "github.com/xstockstrat/marketdata/internal/repository"
       "github.com/xstockstrat/marketdata/internal/source"
   )

   func main() {
       repo, err := repository.NewMarketDataRepo(os.Getenv("DATABASE_URL"))
       if err != nil {
           panic(err)
       }
       err = repo.UpsertFundamentals(context.Background(), &source.Fundamentals{
           Symbol:       "UPRO",
           ExtraMetrics: map[string]float64{}, // Finnhub's always-empty case (finnhub_client.go:106)
           Source:       "finnhub",
       })
       fmt.Printf("UpsertFundamentals error: %v\n", err)
   }
   ```
6. Run it **with `DB_PGBOUNCER=true`** (this is the condition that activates `QueryExecModeExec`,
   `pool.go:36-38`, and is set in staging/production per root `CLAUDE.md` § Connection Pool Budget —
   without it the bug would not reproduce even on unfixed code):
   ```bash
   cd services/xstockstrat-marketdata
   GOWORK=off DB_PGBOUNCER=true DATABASE_URL="$DATABASE_URL" go run ./scratch/repro_upsert
   ```
7. Confirm the printed error contains `SQLSTATE 22P02` and capture the **full** error text
   (including any DETAIL/CONTEXT Postgres attaches — recon.md flagged this as never previously
   captured).
8. Append the verbatim captured output to
   `docs/roadmap/features/142-fix-fundamentals-upsert-invalid-json/context.md` under a new session
   entry (do not delete the scratch file yet — Step 3 reuses it).

**Verification**:
```bash
grep -n "22P02" docs/roadmap/features/142-fix-fundamentals-upsert-invalid-json/context.md
```
Confirms the RED-state error text was captured and recorded. If Step 6's run does **not** reproduce
SQLSTATE 22P02, STOP — per design.md's Open Risks, the driver/OID hypothesis is wrong and this
implementation spec must be escalated back to `/sdd-design`, not carried forward.

---

### Step 2 — service: Add `::jsonb` cast to the `extra_metrics` bind parameter (GREEN fix)

**Status**: `done`
**Service**: `xstockstrat-marketdata`
**Files**:
- `services/xstockstrat-marketdata/internal/repository/marketdata_repo.go` — modify

**Reviewers**: Service owner (`xstockstrat-marketdata`) — OHLCV ingestion integrity, TimescaleDB
hypertable partitioning, Alpaca feed idempotency (`docs/runbooks/reviewer-registry.md`)

**Codebase Evidence**:
- Fix site (SQL text) — `services/xstockstrat-marketdata/internal/repository/marketdata_repo.go:316`:
  `VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16, now())` → add `::jsonb` to `$14`,
  per design.md § Chosen Approach.
- Current `Exec` call site — `services/xstockstrat-marketdata/internal/repository/marketdata_repo.go:328-330`:
  `_, err = r.pool.Exec(ctx, q, f.Symbol, ..., extraJSON, ...)` — the two-value discard confirms
  pgx v5's `Exec` signature `(pgconn.CommandTag, error)`, matching the interface added below.
- Reuse pattern for a mockable execution surface — `services/xstockstrat-portfolio/internal/repository/portfolio_repo.go:18-33`:
  a `queryRower` interface (subset of `*pgxpool.Pool`, here for `QueryRow`) plus a `db queryRower`
  field alongside the existing `pool *pgxpool.Pool` field, set to the real pool in the constructor
  (`portfolio_repo.go:44`: `&PortfolioRepo{pool: pool, db: pool}`) — this is the Go/pgxmock
  equivalent of the sibling-service `::jsonb`-cast convention recon.md cites for the Python
  services. `MarketDataRepo` needs the `Exec`-shaped analog since `UpsertFundamentals` calls `Exec`,
  not `QueryRow`.
- **Not found in-repo**: no existing `Exec`-shaped mockable interface anywhere in the Go services
  (`queryRower` above wraps `QueryRow` only). `pgconn.CommandTag` is pgx v5's documented `Exec`
  return type (same `github.com/jackc/pgx/v5` module already required —
  `services/xstockstrat-marketdata/go.mod:6` — pgconn is its subpackage); confirm the exact import
  path (`github.com/jackc/pgx/v5/pgconn`) compiles during execution since no prior citation exists
  in this repo.
- `MarketDataRepo` struct + constructor —
  `services/xstockstrat-marketdata/internal/repository/marketdata_repo.go:20-34`.

**TDD**: `red-green required` — paired with Step 4's `pgxmock` test (the C-08 pairing); Steps 1/3
are the additional live-DB gate, not the TDD harness pairing for this step.

**Instructions**:
1. Add the import `"github.com/jackc/pgx/v5/pgconn"` to
   `services/xstockstrat-marketdata/internal/repository/marketdata_repo.go`.
2. Add a new interface above the `MarketDataRepo` struct definition (`:20`), mirroring
   `queryRower` in `portfolio_repo.go:18-24` but for `Exec`:
   ```go
   // execer is the subset of *pgxpool.Pool that UpsertFundamentals needs, extracted so
   // its ::jsonb-cast SQL text can be exercised with pgxmock (this service has no
   // live-DB test harness and CI provisions no database). Both *pgxpool.Pool and
   // pgxmock.PgxPoolIface satisfy it; production wires it to the real pool.
   type execer interface {
       Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)
   }
   ```
3. Add a `db execer` field to the `MarketDataRepo` struct (`:20-22`), alongside the existing
   `pool *pgxpool.Pool` field — do not remove `pool`, every other repository method keeps using it:
   ```go
   type MarketDataRepo struct {
       pool *pgxpool.Pool
       // db is the query surface UpsertFundamentals executes against — the same
       // *pgxpool.Pool in production, a pgxmock in the repository test.
       db execer
   }
   ```
4. In `NewMarketDataRepo` (`:25-34`), set `db: pool` alongside `pool: pool` in the returned struct
   literal (mirrors `portfolio_repo.go:44`).
5. In `UpsertFundamentals` (`:328-330`), change `r.pool.Exec(ctx, q, ...)` to `r.db.Exec(ctx, q, ...)`.
6. Add the `::jsonb` cast at `:316`:
   ```go
   // before
   VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16, now())
   // after
   VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15,$16, now())
   ```
7. `extraJSON` (`:301-307`) stays `[]byte`, unchanged — the cast is purely SQL text, per design.md.

**Verification**:
```bash
cd services/xstockstrat-marketdata && GOWORK=off go build ./...
grep -n '\$14::jsonb' internal/repository/marketdata_repo.go
```
Confirms the package compiles and the cast is present in the source. (Full behavioral proof is
Step 3's re-run of the live repro, and Step 4's `pgxmock` pin.)

---

### Step 3 — test: Re-run the mandatory repro against the fixed code (GREEN) and record the result

**Status**: `blocked`
**Service**: `xstockstrat-marketdata`
**Files**:
- `docs/roadmap/features/142-fix-fundamentals-upsert-invalid-json/context.md` — modify (append the
  post-fix success transcript; this is design.md step 7's "record the full repro... as the fix's
  actual verification evidence")

**Reviewers**: Service owner (`xstockstrat-marketdata`) — OHLCV ingestion integrity, TimescaleDB
hypertable partitioning, Alpaca feed idempotency (`docs/runbooks/reviewer-registry.md`)

**Codebase Evidence**: Same as Step 1 (identical repro program and Postgres instance, re-run
against the now-fixed `UpsertFundamentals`).

**TDD**: `N/A (manual, non-CI live-DB gate — this step is the GREEN half of the same gate Step 1
opened; design.md § Mandatory pre-merge verification gate, steps 6-7)`.

**Instructions**:
1. With `timescaledb` still running (from Step 1) and `DATABASE_URL`/`DB_PGBOUNCER=true` still
   exported, re-run the **same** scratch program against the fixed code:
   ```bash
   cd services/xstockstrat-marketdata
   GOWORK=off DB_PGBOUNCER=true DATABASE_URL="$DATABASE_URL" go run ./scratch/repro_upsert
   ```
2. Confirm the printed output is `UpsertFundamentals error: <nil>` (success — no SQLSTATE 22P02).
3. Append the verbatim before/after transcript (Step 1's RED output + this GREEN output) to
   `docs/roadmap/features/142-fix-fundamentals-upsert-invalid-json/context.md` as the fix's
   evidentiary record, per design.md's explicit requirement that this — not the `pgxmock` test
   alone — is the fix's real verification.
4. Delete the scratch program and confirm it was never staged:
   ```bash
   rm -rf services/xstockstrat-marketdata/scratch
   git status --porcelain services/xstockstrat-marketdata/scratch
   ```
5. Stop the standalone DB container if it was started only for this repro:
   `docker compose stop timescaledb` (optional — leave running if other local work needs it).

**Verification**:
```bash
git status --porcelain services/xstockstrat-marketdata/scratch   # must print nothing
grep -n "UpsertFundamentals error: <nil>" docs/roadmap/features/142-fix-fundamentals-upsert-invalid-json/context.md
```
Confirms the scratch repro was never committed (F-08) and the GREEN result is recorded.

---

### Step 4 — test: `pgxmock` regression test pinning the `::jsonb` cast

**Status**: `done`
**Service**: `xstockstrat-marketdata`
**Files**:
- `services/xstockstrat-marketdata/internal/repository/marketdata_repo_test.go` — modify
- `services/xstockstrat-marketdata/go.mod` — modify (add `github.com/pashagolub/pgxmock/v4`)
- `services/xstockstrat-marketdata/go.sum` — modify (regenerated by `go get`)

**Reviewers**: Service owner (`xstockstrat-marketdata`) — OHLCV ingestion integrity, TimescaleDB
hypertable partitioning, Alpaca feed idempotency (`docs/runbooks/reviewer-registry.md`)

**Codebase Evidence**:
- Existing test file, current pattern (pure-function SQL-text assertions, no DB) —
  `services/xstockstrat-marketdata/internal/repository/marketdata_repo_test.go:1-87`
  (`TestBuildDeleteBarsQuery`).
- `pgxmock` is already a dependency elsewhere in this Go workspace at a pinned version —
  `services/xstockstrat-portfolio/go.mod:9`: `github.com/pashagolub/pgxmock/v4 v4.9.0`. Both
  services pin the identical `github.com/jackc/pgx/v5 v5.9.2`
  (`services/xstockstrat-marketdata/go.mod:8`, `services/xstockstrat-portfolio/go.mod:6`), so the
  same `pgxmock/v4` version is compatible.
- Test-construction pattern to mirror —
  `services/xstockstrat-portfolio/internal/repository/portfolio_repo_test.go:49-89`
  (`pgxmock.NewPool()`, `repo := &PortfolioRepo{db: mock}`, `mock.ExpectQuery(...).WithArgs(...).WillReturnRows(rows)`,
  `mock.ExpectationsWereMet()`).
- **Not found in-repo**: no existing `mock.ExpectExec(...)`/`pgxmock.NewResult(...)` usage anywhere
  in this workspace — only `ExpectQuery`/`WillReturnRows` are exercised today
  (`portfolio_repo_test.go:50,69`). `ExpectExec`/`NewResult` are `pgxmock/v4`'s documented
  `Exec`-path equivalents of the same library's `ExpectQuery`/`WillReturnRows`; confirm the exact
  method/type names against the vendored module (`go doc github.com/pashagolub/pgxmock/v4`) during
  execution before finalizing the test, since this repo has no prior citation for them.
- Design's explicit scope for this test — design.md § Testing, item 1: "asserting the emitted query
  contains `$14::jsonb`... explicitly a 'don't delete the cast' tripwire only... structurally cannot
  catch the actual OID-inference bug class."

**TDD**: `red-green required` — write the test first against the pre-Step-2 SQL text (no
`::jsonb`), confirm it fails, then confirm it passes once Step 2's cast is present (Step 2 will
already be applied when this step executes, per Step Dependencies — author the assertion so it
would have failed against the original text, and note that in the test's own comment).

**Instructions**:
1. Add the dependency, matching the portfolio service's exact pin:
   ```bash
   cd services/xstockstrat-marketdata
   GOWORK=off go get github.com/pashagolub/pgxmock/v4@v4.9.0
   GOWORK=off go mod tidy
   ```
2. Add to `marketdata_repo_test.go` (new imports: `context`, `github.com/pashagolub/pgxmock/v4`,
   the service's own `internal/source` package for `source.Fundamentals`):
   ```go
   // TestUpsertFundamentals_CastsExtraMetricsToJSONB is a SQL-text pin, not a live-Postgres
   // proof — pgxmock never runs pgx's real extended-protocol encoder or talks to real
   // Postgres, so it structurally cannot catch the OID-inference bug class this feature
   // fixes (see context.md for the live-DB repro that actually proved the fix — feature
   // 142). This test only guards against someone deleting the ::jsonb cast later.
   func TestUpsertFundamentals_CastsExtraMetricsToJSONB(t *testing.T) {
       mock, err := pgxmock.NewPool()
       if err != nil {
           t.Fatalf("pgxmock.NewPool: %v", err)
       }
       defer mock.Close()

       repo := &MarketDataRepo{db: mock}

       mock.ExpectExec(`\$14::jsonb`).
           WillReturnResult(pgxmock.NewResult("INSERT", 1))

       err = repo.UpsertFundamentals(context.Background(), &source.Fundamentals{
           Symbol:       "UPRO",
           ExtraMetrics: map[string]float64{},
           Source:       "finnhub",
       })
       if err != nil {
           t.Fatalf("UpsertFundamentals: %v", err)
       }
       if err := mock.ExpectationsWereMet(); err != nil {
           t.Fatalf("pgxmock expectations unmet (query text missing the ::jsonb cast): %v", err)
       }
   }
   ```
3. Confirm the import for `source.Fundamentals` matches the existing package path used by
   `UpsertFundamentals`'s own signature (`services/xstockstrat-marketdata/internal/repository/marketdata_repo.go:15`:
   `"github.com/xstockstrat/marketdata/internal/source"`).

**Verification**:
```bash
cd services/xstockstrat-marketdata
GOWORK=off golangci-lint run --modules-download-mode=mod
COVERPKGS=$(go list ./... | grep -Ev '/(cmd|handler|repository|telemetry|service)(/|$)' | tr '\n' ',' | sed 's/,$//')
GOWORK=off go test ./... -race -count=1 -coverprofile=coverage.out -covermode=atomic -coverpkg="${COVERPKGS}"
GOWORK=off go test ./internal/repository/... -race -count=1 -run TestUpsertFundamentals_CastsExtraMetricsToJSONB -v
```
New code lands in `internal/repository/`, which the CI `COVERPKGS` exclusion list drops from the
40% coverage measurement (`.github/workflows/ci.yml` go-test step; `reference/spec-template.md` §
Test step pairing rule) — no coverage threshold applies to this package; the targeted `-run` above
is the actual regression proof, and `golangci-lint` + full `go test ./...` confirm nothing else
broke.

---

## Deviation Log

### Deviation: Step 2 — instruction #7 was wrong; `extraJSON` must NOT stay `[]byte`

**Spec said** (Step 2, Instruction 7): "`extraJSON` (`:301-307`) stays `[]byte`, unchanged — the
cast is purely SQL text, per design.md."
**Actual**: This was incorrect and the resulting fix did not resolve the bug. PR #967 (containing
only the `::jsonb` cast, `extraJSON` still `[]byte`) merged and deployed to `xstockstrat-staging`.
Post-deploy logs showed the **identical** `SQLSTATE 22P02` error for symbol UPRO, confirming the
cast-only fix was insufficient. Root cause, corrected: pgx's `QueryExecModeExec` (active under
`DB_PGBOUNCER=true`) infers each parameter's wire type from its Go type with no server
round-trip. A `[]byte` argument is encoded as `bytea`; `bytea::jsonb` does not decode the bytes
as UTF-8 text — it casts through bytea's hex-escaped text representation (e.g. `\x7b7d`), which
is never valid JSON, producing the exact same SQLSTATE 22P02 regardless of the `::jsonb` cast.
Confirmed against pgx v5's own documentation (`conn.go`'s `QueryExecModeSimpleProtocol` doc
comment, which `QueryExecModeExec` explicitly shares behavior with): "`string` must be used
instead for text type values including json and jsonb." Corrected fix: bind `string(extraJSON)`
instead of the raw `[]byte`.
**Reason**: The original design/spec grilling rounds correctly identified the OID-inference
mechanism (`[]byte` → `bytea`) but the proposed remedy (`::jsonb` cast alone) didn't actually
address it — a cast can't make Postgres decode a bytea's hex representation as UTF-8 JSON text.
This is precisely the gap design.md's own mandatory live-Postgres repro (Steps 1/3, blocked on no
Docker daemon in every execute session so far) was meant to catch before merge — it didn't run,
and the bug shipped. The `pgxmock` test from Step 4 was also strengthened with a custom
`isStringArg` matcher on the `extra_metrics` argument (confirmed red against `[]byte`, green
against `string`) since the original test only pinned the SQL text and would have passed either
way — a real coverage gap now closed.
**Still blocked**: Steps 1 and 3's live-Postgres repro has still not run in any session so far
(no Docker daemon available). The corrected fix is pgxmock-verified and grounded in pgx's own
documented behavior, but per this feature's own standard, it should not be called fully confirmed
until either the repro runs, or a subsequent staging deployment's logs show no recurrence.

### Deviation: Steps 1 & 3 — blocked, no Docker daemon in this execute environment

**Spec said**: Step 1 brings up local `docker-compose` TimescaleDB, applies migrations, and runs
a throwaway repro program against the unfixed code to capture the RED-state `SQLSTATE 22P02`
error text (design.md's mandatory pre-merge verification gate). Step 3 re-runs the identical
repro against the fixed code to confirm GREEN and record both transcripts in `context.md` as the
fix's real verification evidence.
**Actual**: This execute session's sandbox has no running Docker daemon (`docker ps` →
"failed to connect to the docker API... dial unix /var/run/docker.sock: connect: no such file or
directory"). `sdd-execute`'s own HARD CONSTRAINTS explicitly forbid starting a database or other
long-running service container to verify a step, with no carve-out for any mode — this is
Floor-adjacent, not a judgment call. Both constraints point the same direction: do not attempt to
start Postgres here.
**Reason**: Environment constraint, escalated to the user via `AskUserQuestion` rather than
silently skipped or faked. User chose: apply Steps 2 and 4 (both code-only, no live DB needed)
now, and leave Steps 1 and 3 — the mandatory live-DB repro design.md itself requires before this
fix's root-cause hypothesis is considered *confirmed* (not just plausible) — as `blocked` pending
a session/environment with Docker access. **This means the fix has NOT yet been verified against
the actual reported production error** — it rests on the driver/OID-inference hypothesis from
recon.md and design.md's grilling rounds, which is well-evidenced (grep-confirmed no other jsonb
bind exists platform-wide, confirmed `QueryExecModeExec` activation path) but explicitly
unconfirmed against live Postgres. The `pgxmock` test (Step 4) only guards against someone
deleting the cast later — per its own doc comment, it cannot itself prove the fix is correct.
**Before this fix is considered production-ready**, Steps 1 and 3 must be completed in an
environment with Docker access: run the repro against the unfixed code (`git show
<pre-fix-commit>:services/xstockstrat-marketdata/internal/repository/marketdata_repo.go`) to
confirm SQLSTATE 22P02 reproduces, then against the fixed code (this commit) to confirm it
resolves, and record both transcripts in this feature's `context.md`.
