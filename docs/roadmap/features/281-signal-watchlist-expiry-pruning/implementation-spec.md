# Implementation Spec: signal-watchlist-expiry-pruning

**Status**: `pending`
**Created**: 2026-10-31
**Feature**: `docs/roadmap/features/281-signal-watchlist-expiry-pruning/feature.md`
**Total Steps**: 22
**Feature Branch**: `feature/signal-watchlist-expiry-pruning`

---

## Execution Summary

Inputs: `design.md` (4 rounds, user-approved; the Chosen Approach and Rejected Alternatives are binding), `recon.md` (Codebase Map reused as evidence; the items it left open were re-verified in this session and are cited below), `acceptance.feature` (AC-1..AC-18).

Order: **proto → proto-gen → migration → CI harness → portfolio add path (+tests) → portfolio validation (+tests) → portfolio prune query (+tests) → portfolio loop/events (+tests) → config bounds (+tests) → portfolio backfill subcommand (+tests) → agent provenance (+tests) → UI e2e → docs → premise-evidence check.** Deploy order is proto → portfolio → agent → backfill (design § 5); version skew is safe in either order because a provenance-less SIGNAL add only untracks (never prunes early).

Consumer surfaces (C-14): **Agent** → Steps 17-18 (`ingest_signal` auto-add sends provenance; `ingest_signal`/`get_watchlist` docstrings; `mcp-tools.md` in Step 21). **UI** (`/insights/watchlists`) → **no code change** by product-spec decision (silent removal signed off); Step 19 is the e2e assertion that an emptied system list renders and cannot be deleted. Nav registration (C-10(a)) is already satisfied (`PLATFORM_SUBNAV`, recon.md). Tool count stays 45 (no new tool, six inventory surfaces untouched — Step 17 verifies by grep, no edit).

Deployment files: **no new env var and no new port** (the backfill subcommand runs from an operator workstation with `DATABASE_URL`; the prune loop uses existing config + ledger clients), so `docker-compose.yml`, `.do/app.yaml`, `.do/app.dev.yaml` are unchanged (confirmed against `config.go:20-29`, which carries no ingest endpoint and needs none).

### Spec-time verifications (resolved Open Threads)

| Open thread | Result | Evidence |
|---|---|---|
| Portfolio migration `018` free | **Free.** Last file is `017_offline_realized_lifetime_fees`; no remote branch carries a `018` portfolio migration | `ls services/xstockstrat-portfolio/migrations` (tail `017_*`); `git ls-tree -r <each origin branch>` scan found none |
| Proto field `4` free on `AddWatchlistSymbolsRequest` | **Free** (fields 1-3 only) | `packages/proto/portfolio/v1/portfolio.proto:328-333` |
| `Timestamp` already imported | Yes | `portfolio.proto:7` (`import "google/protobuf/timestamp.proto"`) |
| `ingest.newsletter_signals.id` is BIGINT | Yes (`BIGSERIAL`); `user_id TEXT NOT NULL` added by 013 | `services/xstockstrat-ingest/migrations/001_newsletter_signals.up.sql:9` (`id BIGSERIAL`), `013_signal_ownership_templates.up.sql:70` |
| Ledger honours request `user_id` | Yes: `req.userId` wins over `x-user-id` metadata | `services/xstockstrat-ledger/src/grpc/ledgerServiceImpl.ts:77-78`; `ledger.proto` `AppendEventRequest.user_id = 9` |
| `.do/app*.yaml` portfolio block needs anything for the subcommand | No (workstation-run) | design § 5; `services/xstockstrat-portfolio/Dockerfile:10` (distroless, no shell) |
| `docs/runbooks/CLAUDE.md` index row | Table `| File | Purpose | Key trigger |` | `docs/runbooks/CLAUDE.md:5-17` |
| Agent test location | `tests/test_ingest_signal_watchlist.py` (tool path), `tests/test_watchlist_client.py` (client path) | both files read |

**Design/recon wording corrected by verification (record in `context.md` at execute time; not a design change):**

1. `insertBindingsTx` currently returns **only `error`** (`watchlist_repo.go:494-504`); design § 3's "returns the inserted-symbol set" describes the *new* shape Step 5 creates.
2. `migration-rerun` pass 1 applies `018` via `db-migrate.sh up`; its pass 2 replays only a fixed list of 224/225 files (`scripts/migration-rerun.sh` "pass 2"), so `018` is **not** replayed. Idempotency (`IF NOT EXISTS`) is kept by construction; `migration-rerun.sh` is left untouched (YAGNI).
3. Design § 4 step 3 says `SELECT … FOR UPDATE SKIP LOCKED` then `DELETE … RETURNING`. A `DELETE` over the *requested* symbols would block on a row the `SELECT` skipped (held by `UpdateBinding`, `watchlist_repo.go:337`). Step 9 therefore **deletes only the symbols the SELECT actually locked**; this is what makes "never waits" true and is what AC-12 asserts.
4. No Go real-DB test harness exists in the repo: `grep` for `dbtest`/`//go:build` over `services/xstockstrat-{portfolio,trading,marketdata}` found nothing; `ledger-db-test` (`ci.yml:712-768`) is a Node job. Step 4 creates the Go analog from scratch.
5. Unverified at spec time (runbook preflight in Step 21): the portfolio DB role can `SELECT` from `ingest.newsletter_signals` (same managed-cluster credentials per design § 5; no GRANT appears in any migration).
6. **Legacy-owner mismatch detection (design § 5 wording corrected, impl-spec review W1).** Design § 5 says APPLY refuses if `--legacy-owner` differs from the value REPORT printed; REPORT and APPLY are separate processes, so the process cannot know. The legacy owner is required in both modes and echoed in both headers; the pasted REPORT in the change record is the control. Not a behavior change (the flag was already required).
7. **AC-1 narrowing (impl-spec review W8).** AC-1's behavioral `Then` ("still present") is false once Step 11 ships by design; it is covered as a recon-evidence check (Step 22). At launch the C-16 promotion must **not** promote AC-1 as a runtime guarantee.

### Merge hazards (impl-spec review, overlap scan — rebase-only unless noted)

- `.github/workflows/ci.yml` `ci-gate` `needs:`/summary block (Step 4) is also edited by `278-enforce-config-key-wiring` (adds `config-wiring`); the job names differ. `docs/patterns/config-governance.md` (Step 20) is edited by 278, 243, 255; `services/xstockstrat-agent/app/{tools,client}.py` and `docs/runbooks/mcp-tools.md` (Steps 17, 21) by 215 and 275 in disjoint regions.
- **Policy interaction with 278 (needs an operator decision only if 278 lands first):** the unseeded prune-interval key is a `read-unseeded` finding for 278's shrink-only ratchet — Step 13 Instructions 3 stops and escalates instead of baselining it. Whichever feature merges second owns the reconciliation (a `merge-order.md` row `281 after 278` is recommended if both are queued).
- `tools.py` anchors (`:628-630`, `:692`, `:2020-2038`) were verified at spec time but feature 273 (launched) already changed `ingest_signal`; re-grep against the base at execute time.

### Scenario Coverage (C-15)

| Scenario | Covered by step(s) |
|---|---|
| AC-1 | 22 |
| AC-2 | 10, 19 |
| AC-3 | 6, 10 |
| AC-4 | 10 |
| AC-5 | 10 |
| AC-6 | 10, 12 |
| AC-7 | 12 |
| AC-8 | 6, 10, 12, 18 |
| AC-9 | 6, 18 |
| AC-10 | 10 |
| AC-11 | 6 |
| AC-12 | 10 |
| AC-13 | 12 |
| AC-14 | 12, 14 |
| AC-15 | 16 |
| AC-16 | 16 |
| AC-17 | 6, 16 |
| AC-18 | 8 |

### Verification commands (referenced by name from the steps)

- **GO-LINT** — `cd services/xstockstrat-portfolio && GOWORK=off golangci-lint run --modules-download-mode=mod`
- **GO-COVER** — `cd services/xstockstrat-portfolio && GOWORK=off COVERPKGS=$(GOWORK=off go list ./... | grep -Ev '/(cmd|handler|repository|telemetry|service)(/|$)' | tr '\n' ',' | sed 's/,$//') && GOWORK=off go test ./... -race -count=1 -coverprofile=coverage.out -covermode=atomic -coverpkg="${COVERPKGS}" && go tool cover -func=coverage.out | grep "^total:"` — confirm ≥ 40%. All new portfolio logic in this spec lands in `repository/`, `service/` and `cmd/`, which CI excludes from the measured set; the threshold is therefore held by not touching `config`/`middleware`/`mtls`/`marketsession`, and the behavior is proven by the tests named in each step.
- **GO-DBTEST** — `cd services/xstockstrat-portfolio && PORTFOLIO_DB_TEST_URL='postgres://xstockstrat:ci-only@localhost:5432/xstockstrat?sslmode=disable' GOWORK=off go test -tags dbtest -race -count=1 ./internal/repository/...` — runs in CI job `portfolio-db-test` (Step 4). Locally it needs a migrated TimescaleDB; where none is available the executor runs `GOWORK=off go vet -tags dbtest ./...` (offline compile proof) and cites the CI job for the green run. RED for a DB test is a compile failure against the pre-implementation tree, or a CI failure.
- **PY-VERIFY** — `cd services/xstockstrat-agent && ruff check . && ruff format --check . && pytest --cov=app --cov-fail-under=40`
- **NODE-VERIFY** (config) — `cd services/xstockstrat-config && pnpm run lint && pnpm run test:coverage && pnpm exec c8 check-coverage --lines 40`

## Step Dependencies

- Step 2 requires Step 1: stubs are generated from the new proto.
- Step 4 requires Step 3: the CI job applies migrations including `018`; its schema smoke test reads the new table.
- Step 5 requires Steps 2 and 3: the repo writes `portfolio.watchlist_signal_expiry` and imports no new proto type (intent types are repo-local), but compiles against regenerated stubs in the shared module.
- Step 6 [test] covers Step 5 [service]; Step 8 [test] covers Step 7; Step 10 covers Step 9; Step 12 covers Step 11; Step 14 covers Step 13; Step 16 covers Step 15; Step 18 covers Step 17. Each test step is authored to fail against the pre-implementation tree (P-06) and `/sdd-execute` proves RED before the paired `service`/`config` step.
- Steps 6, 10 and 16 (real-DB tests) also require the Step 4 harness (`testPool` and helpers, the `portfolio-db-test` CI job) in addition to the service step each one covers.
- Step 7 requires Steps 2 and 5: it reads `req.GetSignalProvenance()` (generated getter) and calls the Step 5 `AddSymbols` signature.
- Step 9 requires Steps 3 and 5: the prune SQL reads and deletes the expiry rows the add path writes.
- Step 11 requires Step 9 (repo method) and Step 13 only for deployment ordering, not compilation: the clamp reads the key with `GetInt`, which works whether or not the bounds entry exists.
- Step 15 requires Step 3 only: the backfill writes `portfolio.watchlist_signal_expiry` rows that do not yet exist (`ON CONFLICT DO NOTHING`; it never merges, because its candidate query excludes bindings that already have an expiry row). Step 16's fixtures additionally use Step 5 (`AddSymbols`, for the AC-17 renewal) and Step 9 (`PruneExpiredSignalEntries`, for the marked-entry removal), so Step 16 requires Steps 5, 9 and 15.
- Step 17 requires Step 2 (Python stubs `gen/portfolio/v1/portfolio_pb2` regenerated) and, at deploy time, Step 7 (an old portfolio drops unknown field 4 under proto3, so the agent may deploy first without harm).
- Step 19 (UI e2e) has no code dependency; it asserts existing behavior of `WatchlistDetail.tsx:223,249`.
- Step 20 requires Steps 1-18 (documents what shipped in the service/pattern/constitution docs). Step 21 requires Step 20 (the runbook and `mcp-tools.md` link to what Step 20 documents; the teardown covers both steps' files). Step 22 requires nothing but is last so it validates the final `recon.md`/`context.md`.
- **Deploy/rollout order (not a code dependency):** proto → portfolio → agent → backfill (REPORT, DBA review, then APPLY). Emergency stop and rollback live in the runbook (Step 21).
- **Teardown (root `CLAUDE.md`):** Steps 20-21 touch context files (`CLAUDE.md` ×2, the portfolio `docs/context-constitution.md`, runbooks); the teardown runs once, as the last action of Step 21: run `/context-forge:context-constitution refresh` scoped to them before the PR, or, if the plugin is unavailable, re-read each touched context file against the code and record **both** the unavailability and the manual reconciliation in the PR body.

---

### Step 1 — proto: add `WatchlistSignalProvenance` and `AddWatchlistSymbolsRequest.signal_provenance = 4`

**Status**: `pending`
**Service**: `packages/proto`
**Files**:
- `packages/proto/portfolio/v1/portfolio.proto` — modify

**Reviewers**: Proto Reviewer — field number uniqueness, no breaking change, `buf lint`/`buf breaking`; Service owner `xstockstrat-portfolio` — concurrent write safety on watchlist entries; Service owner `xstockstrat-agent` — MCP tool contract stability (the agent is the sole producer of the new field)

**Codebase Evidence**:
- Confirmed via: `grep -n "message AddWatchlistSymbolsRequest" packages/proto/portfolio/v1/portfolio.proto` → `328`; body is `string watchlist_id = 1; repeated string symbols = 2; repeated WatchlistBinding bindings = 3;` (`:328-334`), so field `4` is unused.
- `google.protobuf.Timestamp` is already imported (`portfolio.proto:7`); `WatchlistBinding` (`:243-249`) is **not** touched (design § 2: avoids the feature-127 normalizer trap, `fails.md` 2026-08-26 `consolidate-watchlist-signal`).
- Existing pattern: `// user_id intentionally absent …` style comments precede request messages (`:347`); new message follows the existing doc-comment convention.

**TDD**: N/A (proto contract; compile/lint gates only)

**Covers**: —

**Instructions**:
1. Immediately before `message AddWatchlistSymbolsRequest` add:
   ```proto
   // Dated signal backing a SIGNAL add (feature 281). Accepted only with valid_until set (seconds > 0)
   // and signal_id > 0; open-ended signals send no provenance (the entry is then never pruned).
   message WatchlistSignalProvenance {
     int64 signal_id = 1;
     google.protobuf.Timestamp valid_until = 2;
   }
   ```
2. In `AddWatchlistSymbolsRequest` append `WatchlistSignalProvenance signal_provenance = 4;` with a one-line comment: system-managed list + exactly one SIGNAL binding only; otherwise `InvalidArgument`.
3. Do not touch `WatchlistBinding`, any enum, or any existing field number. No `reserved` (proto CLAUDE.md: deprecate, don't delete).

**Verification**:
```bash
cd packages/proto && buf lint && buf breaking . --against "../../.git#branch=origin/main-dev,subdir=packages/proto"
```
(the CI form, `.github/workflows/ci.yml:139-155`, run from `packages/proto`; compares against the base branch, never the feature branch itself, which would pass vacuously. Additive only → no breaking findings; `git fetch origin main-dev` first if the ref is stale.)

---

### Step 2 — proto-gen: regenerate stubs

**Status**: `pending`
**Service**: `packages/proto`
**Files**:
- `packages/proto/gen/go/portfolio/v1/*` — modify (generated)
- `packages/proto/gen/python/portfolio/v1/*` — modify (generated)
- `packages/proto/gen/ts/portfolio/v1/*` — modify (generated; compiled output under `gen/ts/dist/` as the generator emits)

_The three globs above are **generated output**: the exact file list is whatever `./scripts/buf-gen.sh` emits, verified with `git diff --stat packages/proto/gen/` (never Read/Grep `gen/`, proto `CLAUDE.md`); it cannot be enumerated before the generator runs._

**Reviewers**: Proto Reviewer — field number uniqueness, no breaking change, `buf lint`/`buf breaking`; Service owner `xstockstrat-portfolio` — concurrent write safety on watchlist entries; Service owner `xstockstrat-agent` — MCP tool contract stability (inherited from Step 1)

**Codebase Evidence**:
- Confirmed: root `CLAUDE.md` § Generating Proto Stubs — run `./scripts/buf-gen.sh` after any `.proto` change; CI `proto-freshness` fails on a stale diff. Never Read/Grep `gen/` (proto CLAUDE.md); verify with `git diff --stat` only.

**TDD**: N/A (generated code)

**Covers**: —

**Instructions**:
1. Run `./scripts/buf-gen.sh` (Docker codegen container; if unavailable follow `docs/runbooks/codegen-toolchain-host-setup.md`).
2. Commit proto source and generated stubs together only if the repo convention for this PR requires it; do not hand-edit anything under `gen/`.

**Verification**:
```bash
./scripts/buf-gen.sh && git diff --stat packages/proto/gen/ | tail -5
# then a second run must be a no-op (state checksum before/after; `git diff` alone misses new untracked files; `cksum` is POSIX and exists on macOS and Linux):
H1=$( (git status --porcelain packages/proto/gen/; git diff packages/proto/gen/) | cksum )
./scripts/buf-gen.sh && H2=$( (git status --porcelain packages/proto/gen/; git diff packages/proto/gen/) | cksum ) && [ -n "$H1" ] && [ "$H1" = "$H2" ] && echo "second run was a no-op"
```
Confirm only `portfolio/v1` outputs changed.

---

### Step 3 — migration: `018_watchlist_signal_expiry`

**Status**: `pending`
**Service**: `xstockstrat-portfolio`
**Files**:
- `services/xstockstrat-portfolio/migrations/018_watchlist_signal_expiry.up.sql` — create
- `services/xstockstrat-portfolio/migrations/018_watchlist_signal_expiry.down.sql` — create

**Reviewers**: DBA — migration NNN numbering, up+down pair present, index correctness, run-order compliance with `scripts/db-migrate.sh`; Service owner `xstockstrat-portfolio` — concurrent write safety on watchlist entries

**Codebase Evidence**:
- Confirmed via: `ls services/xstockstrat-portfolio/migrations` → last pair is `017_offline_realized_lifetime_fees.{up,down}.sql`; next is `018`. No other remote branch carries a portfolio `018` (branch scan this session).
- Parent table: `portfolio.watchlists (watchlist_id UUID PRIMARY KEY DEFAULT gen_random_uuid(), …)` (`007_watchlists.up.sql`); `portfolio.watchlist_symbols` PK `(watchlist_id, symbol)` with `source SMALLINT` added by `011_watchlist_system_managed_source.up.sql`. Idempotent `IF NOT EXISTS` style: `017_*.up.sql` (`ADD COLUMN IF NOT EXISTS`); down style `DROP COLUMN IF EXISTS`.
- Why FK to `watchlists` only, never `watchlist_symbols`: replace-all `Update` deletes and re-inserts every binding (`watchlist_repo.go:210-213`), which would cascade-untrack every entry on rename (design § 1, Rejected Alternatives).
- `migration-rerun` pass 1 applies it through `db-migrate.sh up` (`scripts/migration-rerun.sh`); pass 2 does not replay it (see Execution Summary correction 2).

**TDD**: N/A (migration)

**Covers**: —

**Instructions**:
1. `up.sql` — header comment (migration/service/feature 281 purpose, 2 lines), then exactly the design § 1 DDL:
   ```sql
   CREATE TABLE IF NOT EXISTS portfolio.watchlist_signal_expiry (
     watchlist_id UUID        NOT NULL REFERENCES portfolio.watchlists (watchlist_id) ON DELETE CASCADE,
     symbol       TEXT        NOT NULL,
     valid_until  TIMESTAMPTZ NOT NULL,
     signal_id    BIGINT,
     PRIMARY KEY (watchlist_id, symbol)
   );
   CREATE INDEX IF NOT EXISTS watchlist_signal_expiry_valid_until_idx
     ON portfolio.watchlist_signal_expiry (valid_until);
   ```
   A `--` comment on `signal_id`: `NULL = operator-marked "untracked" by the backfill`. Open-ended tracking is the **absence of a row**.
2. `down.sql` — `DROP TABLE IF EXISTS portfolio.watchlist_signal_expiry;` (the index drops with the table).
3. Do not edit any applied migration (F-01); no `reason` column (design § 1).

**Verification** (offline, no database):
```bash
ls services/xstockstrat-portfolio/migrations/018_*.up.sql services/xstockstrat-portfolio/migrations/018_*.down.sql
# then read both: the CREATE TABLE/CREATE INDEX in .up is reversed by DROP TABLE in .down; no ALTER of existing tables
```

---

### Step 4 — test: real-Postgres harness and `portfolio-db-test` CI job

**Status**: `pending`
**Service**: `xstockstrat-portfolio` (plus `.github/workflows/ci.yml`)
**Files**:
- `services/xstockstrat-portfolio/internal/repository/dbtest_helpers_test.go` — create (`//go:build dbtest`)
- `services/xstockstrat-portfolio/internal/repository/signal_expiry_schema_dbtest_test.go` — create (`//go:build dbtest`)
- `services/xstockstrat-portfolio/.golangci.yml` — modify (`run.build-tags: [dbtest]` so the DB tests are linted)
- `.github/workflows/ci.yml` — modify (new `portfolio-db-test` job; add to the `ci-gate` aggregate job's `needs:` (`ci.yml:899`) and its summary echo block)

**Reviewers**: Service owner `xstockstrat-portfolio` — P&L calculation accuracy, position snapshot consistency, concurrent write safety

**Codebase Evidence**:
- Confirmed via: `grep -rnE "dbtest|go:build" services/xstockstrat-{portfolio,trading,marketdata} --include=*.go` → no match: **Not found — the Go real-DB harness must be created from scratch**; the only real-DB CI precedent is `ledger-db-test` (`.github/workflows/ci.yml:712-768`: `timescale/timescaledb:latest-pg16` service, `docker build -f scripts/Dockerfile.migrate`, migrator `docker run` with `SEED_USER_ID`, then the test command).
- The migrator image runs every service's migrations incl. ingest (needs `SEED_USER_ID`; `scripts/Dockerfile.migrate:13` copies `services`, `scripts/migration-rerun.sh` passes `SEED_USER_ID="00000000-0000-4000-8000-0000000000c1"`), which the backfill tests (Step 16) need for `ingest.newsletter_signals`.
- Path-filter names available to `if:`: `xstockstrat-portfolio`, `migrations`, `proto`, `ci`, `go-shared` (`ci.yml:30-70`); the `ledger-db-test` gate shape at `ci.yml:712-720`. The `ci-gate` aggregate job's `needs:` list and summary echoes at `ci.yml:899-937` (`ledger-db-test` entries are the template).
- Pool constructor: `repository.NewPortfolioRepo(connStr)` / `Pool()` (`portfolio_repo.go:37,55`); `newPool` sets `MaxConns` from `DB_POOL_MAX` (`pool.go:15-33`). The harness builds its own `pgxpool` with `ConnConfig.RuntimeParams["lock_timeout"]="500ms"` (design § 8 T4) so any wait fails deterministically.
- Lint config: `services/xstockstrat-portfolio/.golangci.yml` has a `run:` block (`timeout: 5m`) to extend.

**TDD**: N/A (test infrastructure: the harness and CI job are the means by which Steps 6, 10, 16 prove red-before-green; they add no product behavior). Its own check is `TestSignalExpirySchema`: RED = run it against a database migrated only to `017` (fails with `relation "portfolio.watchlist_signal_expiry" does not exist`), GREEN = after `018` is applied; where no database is available locally the executor records the offline compile proof (`go vet -tags dbtest`) and cites the CI job for both runs. It is the test-side pair of Step 3 (migration) and depends on it (see Step Dependencies).

**Covers**: — (infrastructure step: harness + CI job. Its smoke test asserts migration 018's table, PK `(watchlist_id, symbol)`, nullable `signal_id`, and `ON DELETE CASCADE` from `watchlists`; the `@AC-*` scenarios are covered by Steps 6, 8, 10, 12, 14, 16, 18, 19, 22.)

**Instructions**:
1. `dbtest_helpers_test.go` (`//go:build dbtest`, package `repository`): `testPool(t)` reads `PORTFOLIO_DB_TEST_URL`; unset → `t.Skip` locally **but `t.Fatal` when `CI=true`** (analysis `real_pg` precedent: fail rather than skip under CI); opens a `pgxpool` with `lock_timeout=500ms`; helpers `seedWatchlist(t, pool, userID, systemManaged) string`, `seedBinding(t, pool, wlID, symbol, strategy string, source int16)`, `seedExpiry(...)`, `bindingSource(...)`, `expiryRow(...)`; `t.Cleanup` deletes by user id prefix (`it-281-`) so tests do not depend on an empty database. Domain literals stay inline in the tests (C-13: one consumer per literal; no `internal/testdata` growth).
2. `signal_expiry_schema_dbtest_test.go`: `TestSignalExpirySchema` — insert a watchlist + expiry row, delete the watchlist, assert the expiry row is gone (cascade); assert `signal_id` accepts NULL and a duplicate `(watchlist_id, symbol)` is rejected (PK).
3. `.golangci.yml`: under `run:` add `build-tags: [dbtest]`.
4. `ci.yml`: add job `portfolio-db-test` (name `Portfolio DB test (TimescaleDB)`) modeled on `ledger-db-test` — `needs: changes`; `if:` contains `xstockstrat-portfolio`, `migrations`, `proto`, `ci`, `go-shared`; TimescaleDB service; `actions/setup-go@v7` (`go-version: "1.27"`, `cache-dependency-path: services/xstockstrat-portfolio/go.sum`); build migrator image; apply migrations with `DATABASE_URL` + `SEED_USER_ID`; run `GOWORK=off go test -tags dbtest -race -count=1 ./internal/repository/...` in `services/xstockstrat-portfolio` with `PORTFOLIO_DB_TEST_URL` and `CI` set. Add `portfolio-db-test` to the `ci-gate` job's `needs:` list and add `echo "portfolio-db-test: ${{ needs.portfolio-db-test.result }}"` to its summary step (same column format as `ledger-db-test`).

**Verification**:
```bash
cd services/xstockstrat-portfolio && GOWORK=off go vet -tags dbtest ./... && GOWORK=off golangci-lint run --modules-download-mode=mod
[ "$(grep -c "portfolio-db-test" ../../.github/workflows/ci.yml)" -ge 3 ]   # cwd is services/xstockstrat-portfolio; asserts job def + ci-gate needs + summary echo (≥3 matching lines)
```
Green DB run: CI job `portfolio-db-test` (or GO-DBTEST locally against a migrated database).

---

### Step 5 — service: repository add path (split insert, expiry intent, merge/overwrite/untrack)

**Status**: `pending`
**Service**: `xstockstrat-portfolio`
**Files**:
- `services/xstockstrat-portfolio/internal/repository/watchlist_repo.go` — modify
- `services/xstockstrat-portfolio/internal/service/portfolio_service.go` — modify (`WatchlistStore.AddSymbols` signature at `:1766` and its single call site at `:2184`, passing the zero intent for now)
- `services/xstockstrat-portfolio/internal/service/watchlist_service_test.go` — modify (`fakeWatchlistStore.AddSymbols` signature only, so the package compiles)

**Reviewers**: Service owner `xstockstrat-portfolio` — P&L calculation accuracy, position snapshot consistency, concurrent write safety

**Codebase Evidence**:
- Confirmed via: `grep -nE "func \(r \*WatchlistRepo\) AddSymbols|func insertBindingsTx|func touchWatchlistTx" internal/repository/watchlist_repo.go` → `280`, `494`, `478`. `AddSymbols` is `Begin → touchWatchlistTx (L287, locks parent) → insertBindingsTx (L290) → Commit → GetByID`.
- `insertBindingsTx` (`:494-504`) loops `INSERT … VALUES ($1,$2,$3,$4) ON CONFLICT (watchlist_id, symbol) DO NOTHING` and returns `error` only; `Create` (`:49`) and `Update` (`:224`) call it and ignore any result. First writer wins on `source` (`:497-499`).
- `touchWatchlistTx` `UPDATE … RETURNING updated_at` takes the parent row lock (`:478-490`); `RemoveSymbols` (`:300-322`) and `Update` (`:194-`) also lock the parent first — the add path's parent-first order is preserved.
- Interface `WatchlistStore` (`portfolio_service.go:1757-1779`) declares `AddSymbols(ctx, watchlistID string, bindings []*portfoliov1.WatchlistBinding)`; sole caller `AddWatchlistSymbols` at `:2184`; fake at `watchlist_service_test.go` (`AddSymbols` method on `fakeWatchlistStore`).

**TDD**: red-green required (paired with Step 6)

**Covers**: —

**Instructions**:
1. In `watchlist_repo.go` add repo-local types (not proto — `WatchlistBinding` stays untouched):
   ```go
   // SignalProvenance is the dated signal behind a SIGNAL add.
   type SignalProvenance struct { SignalID int64; ValidUntil time.Time }
   // ExpiryIntent: Provenance != nil tracks the (single) SIGNAL binding; UntrackSymbols lists SIGNAL-request
   // symbols added WITHOUT provenance, whose expiry rows are deleted. Zero value = no expiry effect.
   type ExpiryIntent struct { Provenance *SignalProvenance; Symbol string; UntrackSymbols []string }
   ```
   (`Symbol` = the normalized symbol the provenance applies to; the service guarantees exactly one SIGNAL binding.)
2. Split `insertBindingsTx` into `insertBindingTx(ctx, tx, watchlistID, b) (inserted bool, err error)` (per-row, `ct.RowsAffected()==1`) and keep `insertBindingsTx` as the loop returning `(map[string]bool, error)`; update the two other callers (`Create`, `Update`) to discard the map. The SQL string is unchanged.
3. Change `AddSymbols(ctx, watchlistID, bindings, intent ExpiryIntent)`. Inside the existing tx, after `touchWatchlistTx` and the insert:
   - `intent.Provenance != nil` and the symbol was **freshly inserted** → `INSERT INTO portfolio.watchlist_signal_expiry (watchlist_id, symbol, valid_until, signal_id) VALUES (…) ON CONFLICT (watchlist_id, symbol) DO UPDATE SET valid_until = EXCLUDED.valid_until, signal_id = EXCLUDED.signal_id` (overwrite: any pre-existing row for a freshly inserted binding is an orphan).
   - Provenance present and the binding **already existed** → plain `SELECT source FROM portfolio.watchlist_symbols WHERE watchlist_id=$1 AND symbol=$2` (safe: every deleter locks the parent first and this tx holds it); if `source = 2` run the update-only **merge** defined as a package-level `const mergeSignalExpirySQL` (used by the add path only; the backfill never merges):
     `UPDATE portfolio.watchlist_signal_expiry SET valid_until = CASE WHEN signal_id IS NULL THEN $3 ELSE GREATEST(valid_until, $3) END, signal_id = CASE WHEN signal_id IS NULL OR $3 >= valid_until THEN $4 ELSE signal_id END WHERE watchlist_id=$1 AND symbol=$2` — 0 rows (untracked) stays untracked; a marked row (`signal_id IS NULL`) is rescued. If `source` is not 2 (MANUAL) → no write.
   - `len(intent.UntrackSymbols) > 0` → `DELETE FROM portfolio.watchlist_signal_expiry WHERE watchlist_id=$1 AND symbol = ANY($2)`.
4. Update the `WatchlistStore` interface (`:1766`), the call site (`:2184`: pass `repository.ExpiryIntent{}` — Step 7 fills it), and the fake's signature. No behavior change in the service yet.
5. Single normalization site: symbols reaching the repo are already `normalizeBindings`-normalized (`portfolio_service.go:1807-1826`); do not re-normalize in SQL (fails.md: normalize symbol keys at the source, never per read site).

**Verification**:
```bash
cd services/xstockstrat-portfolio && GOWORK=off go build ./... && GOWORK=off go vet ./... && GOWORK=off go vet -tags dbtest ./...
```
then **GO-LINT** (the paired test step runs GO-COVER and GO-DBTEST).

---

### Step 6 — test: add-path DB tests (fresh overwrite, merge, MANUAL, untrack, rescue, replace-all)

**Status**: `pending`
**Service**: `xstockstrat-portfolio`
**Files**:
- `services/xstockstrat-portfolio/internal/repository/watchlist_signal_expiry_add_dbtest_test.go` — create (`//go:build dbtest`)

**Reviewers**: Service owner `xstockstrat-portfolio` — concurrent write safety on watchlist entries

**Codebase Evidence**:
- Harness from Step 4 (`testPool`, `seedWatchlist`, …); behavior under test is Step 5's `AddSymbols` + `mergeSignalExpirySQL`.
- `Update` (replace-all) deletes and re-inserts all bindings (`watchlist_repo.go:210-213`) — the rename/replace-all test (design T6) asserts the expiry row survives because the FK is to `watchlists` only.
- Existing in-package test style: `internal/repository/watchlist_repo_test.go` (pgxmock, offline); this step is the first real-DB repository test, behind `-tags dbtest`.

**TDD**: red-green required — compile-red before Step 5 (`AddSymbols` has no `ExpiryIntent` parameter), behavioral-red in CI.

**Covers**: `AC-3, AC-8, AC-9, AC-11, AC-17` — AC-3 (a later, later-dated signal B extends the entry: merge keeps `GREATEST(valid_until)`), AC-8 (renewal 102 > 101 updates `signal_id` to 102), AC-9 (provenance-less SIGNAL add deletes the row → entry untracked and not removed by a tick; MANUAL/UNSPECIFIED add does not untrack), AC-11 (a MANUAL add of an existing SIGNAL binding leaves `source` SIGNAL and the row unchanged), AC-17 (a marked row, `signal_id IS NULL`, is rescued by a live dated add — `valid_until=$3, signal_id=$4`; an already-past provenance does **not** rescue: row ends with the past `valid_until`).

**Instructions** (one `TestAddPath_*` per case, table-driven where the shape repeats; all literals inline — single consumer, C-13):
1. Fresh SIGNAL insert + provenance → one row `(valid_until, signal_id)`; with a pre-existing orphan row for the symbol → **overwritten**, not merged.
2. Existing tracked SIGNAL binding + later-dated provenance (id 102, 2026-12-01 > 101's 2026-11-01) → `valid_until` and `signal_id` advance to 102; with an **earlier**-dated provenance → `valid_until` unchanged, `signal_id` stays 101.
3. Existing **untracked** SIGNAL binding (no row) + provenance → still no row (merge is update-only).
4. Existing **marked** row (`signal_id IS NULL`) + live provenance → rescued (id 110); + already-past provenance (111, 2026-10-15) → row holds the past `valid_until` (the next tick removes it with `signal_entry_expired`).
5. Existing MANUAL binding + provenance → `source` stays MANUAL, no row written.
6. Provenance-less add with `UntrackSymbols=["INTC"]` on a tracked entry → row deleted; the same add with empty `UntrackSymbols` (MANUAL/UNSPECIFIED path) → row kept; a MANUAL add of tracked "META" leaves binding `source=2` and the row byte-identical (AC-11).
7. Replace-all `Update` (rename) on a list with tracked SIGNAL entries → expiry rows still present (T6); a replace-all that re-stamps a symbol MANUAL leaves an orphan row (swept silently by Step 10's tick).

**Verification**:
```bash
cd services/xstockstrat-portfolio && GOWORK=off go vet -tags dbtest ./... && GOWORK=off golangci-lint run --modules-download-mode=mod
[ "$(grep -cE '^func TestAddPath_' internal/repository/watchlist_signal_expiry_add_dbtest_test.go)" -ge 7 ]   # the step cannot pass without its tests (cwd is services/xstockstrat-portfolio)
```
GO-DBTEST (CI `portfolio-db-test`) green; then **GO-COVER** (excluded packages: "New logic is in an excluded package — no coverage threshold applies; integration test verification is sufficient"; confirm total ≥ 40%).

---

### Step 7 — service: `AddWatchlistSymbols` provenance validation and intent mapping

**Status**: `pending`
**Service**: `xstockstrat-portfolio`
**Files**:
- `services/xstockstrat-portfolio/internal/service/portfolio_service.go` — modify (`AddWatchlistSymbols`, `:2166-2193`)

**Reviewers**: Service owner `xstockstrat-portfolio` — P&L calculation accuracy, position snapshot consistency, concurrent write safety

**Codebase Evidence**:
- Confirmed via: `grep -n "func (s \*PortfolioService) AddWatchlistSymbols" internal/service/portfolio_service.go` → `2166`. Current flow: `requireUserID` → `loadOwned` (returns `existing`, whose `GetSystemManaged()` is the flag used at `:2153-2154`) → `requestBindings(...)` (`:1830-1845`, normalizes + applies default) → cap check → `s.watchlists.AddSymbols` → `emitEvent("portfolio.watchlist.updated")`.
- `normalizeBindings` preserves `Source` (`:1822`); `requestBindings` falls back to flat `symbols` as unbound, **source UNSPECIFIED** (`:1835-1839`) — so the flat path and the agent's MANUAL path (`client.py:536-538`) can never produce a SIGNAL request binding.
- Errors use `connect.NewError(connect.CodeInvalidArgument, …)` (`:2178`); handler passes the request through unchanged (`internal/handler/portfolio_handler.go:222-223`, gRPC adapter `:379-380`), so the new field reaches the service.
- Existing guard-test style for add rules: `TestAddWatchlistSymbols_SignalSourceSkipsDefault` (`watchlist_service_test.go:899`).

**TDD**: red-green required (paired with Step 8)

**Covers**: —

**Instructions**:
1. After `requestBindings` computes `add`, resolve the intent via a small pure helper `expiryIntentFor(req, existing, add) (repository.ExpiryIntent, error)` (kept unexported, in `portfolio_service.go` beside `requestBindings`):
   - `prov := req.GetSignalProvenance()`; `signalSymbols` = symbols in `add` whose `Source == WATCHLIST_ENTRY_SOURCE_SIGNAL`.
   - `prov != nil`: return `InvalidArgument` unless **all** hold: `existing.GetSystemManaged()`; `len(add)==1` and `len(signalSymbols)==1` (exactly one normalized binding, source SIGNAL); `prov.GetSignalId() > 0`; `prov.GetValidUntil() != nil && prov.GetValidUntil().GetSeconds() > 0`. On success → `{Provenance:&{SignalID, ValidUntil: prov.ValidUntil.AsTime()}, Symbol: add[0].Symbol}`.
   - `prov == nil`: `{UntrackSymbols: signalSymbols}` (empty for MANUAL/UNSPECIFIED/flat adds).
2. Run validation **before** the cap check and before any write (AC-18: no binding or expiry record on failure); pass the intent to `s.watchlists.AddSymbols`.
3. Do not touch `normalizeBindings`, `requestBindings`, or `applyDefaultStrategy` (design § 2).
4. Header propagation: no new outbound call here.

**Verification**:
```bash
cd services/xstockstrat-portfolio && GOWORK=off go build ./... && GOWORK=off go test ./internal/service/ -run 'AddWatchlistSymbols|ExpiryIntent' -count=1
```
then **GO-LINT**.

---

### Step 8 — test: provenance validation and intent mapping (service unit tests)

**Status**: `pending`
**Service**: `xstockstrat-portfolio`
**Files**:
- `services/xstockstrat-portfolio/internal/service/watchlist_service_test.go` — modify (extend `fakeWatchlistStore.AddSymbols` to record the last `ExpiryIntent`; add tests)

**Reviewers**: Service owner `xstockstrat-portfolio` — concurrent write safety on watchlist entries

**Codebase Evidence**:
- `fakeWatchlistStore` / `newFakeStore` / `wideCaps()` / `fakeLedger` (`watchlist_service_test.go:26-45,253-266,362`); `TestAddWatchlistSymbols_SignalSourceSkipsDefault` (`:899`) is the pattern; `TestEnsureSignalWatchlist_Idempotent` (`:617`) shows creating a system-managed list via the service for the "system-managed" Given.
- C-13: the fake store, ledger and config doubles already live in this file (single package-local home); new cases reuse them rather than adding a second copy.

**TDD**: red-green required — fails against the tree before Step 7 (no validation: the call succeeds and writes).

**Covers**: `AC-18` — one table row per AC-18 example: manual list + SIGNAL binding; system list with two SIGNAL bindings; system list with one MANUAL binding; `signal_id 0`; `valid_until` unset. Each asserts `connect.CodeInvalidArgument` **and** that the fake store recorded no `AddSymbols` call (no binding, no intent). Plus positive cases: valid provenance → recorded intent carries `Provenance{101, ts}` and `Symbol`; provenance-less SIGNAL add → `UntrackSymbols=[sym]`; provenance-less MANUAL add and flat `symbols` add → empty intent.

**Instructions**:
1. Extend the fake's `AddSymbols` to store `intent` in a field and bump a call counter; keep the existing dedupe semantics.
2. Add `TestAddWatchlistSymbols_ProvenanceValidation` (table of the five rejections), `TestAddWatchlistSymbols_ProvenanceTracksIntent`, `TestAddWatchlistSymbols_NoProvenanceIntent`.
3. Literals (`"AAPL"`, ids 101/0, timestamps) stay inline: one consumer (C-13), and they are scenario-specific.

**Verification**:
```bash
cd services/xstockstrat-portfolio && OUT=$(GOWORK=off go test ./internal/service/ -run 'TestAddWatchlistSymbols_(NoProvenanceIntent|ProvenanceTracksIntent|ProvenanceValidation|SignalSourceSkipsDefault)' -race -count=1 -v 2>&1); rc=$?; [ "$rc" -eq 0 ] && [ "$(echo "$OUT" | grep -c '^--- PASS')" -ge 4 ]   # all four named tests run and pass (three are new, `SignalSourceSkipsDefault` already exists and is updated; a filter matching nothing, or any failure, fails the command)
```
then **GO-LINT** and **GO-COVER** ("New logic is in an excluded package — no coverage threshold applies; integration test verification is sufficient"; confirm total ≥ 40%).

---

### Step 9 — service: repository prune tick (`PruneExpiredSignalEntries`)

**Status**: `pending`
**Service**: `xstockstrat-portfolio`
**Files**:
- `services/xstockstrat-portfolio/internal/repository/signal_expiry_repo.go` — create
- `services/xstockstrat-portfolio/internal/service/portfolio_service.go` — modify (add `PruneExpiredSignalEntries` to the `WatchlistStore` interface at `:1757-1779`)
- `services/xstockstrat-portfolio/internal/service/watchlist_service_test.go` — modify (fake method returning a configurable `repository.PruneResult`)

**Reviewers**: Service owner `xstockstrat-portfolio` — P&L calculation accuracy, position snapshot consistency, concurrent write safety

**Codebase Evidence**:
- Confirmed lock order (read this session): `AddSymbols`/`RemoveSymbols`/`Update` lock the **parent first** (`touchWatchlistTx` `watchlist_repo.go:287,307`; `Update` `UPDATE watchlists` at `:201`); `UpdateBinding` writes the **symbol row first**, touches the parent last (`:337` → `:347`), and `UpdateBindings` likewise (`:371` → `:402`); `Delete` is a parent `DELETE` (`:267`). A never-waiting `SKIP LOCKED` prune cannot join a deadlock cycle with either order.
- `RemoveSymbols` (`:312-315`) is the idempotent-delete shape to mirror (`DELETE … WHERE watchlist_id=$1 AND symbol = ANY($2)`).
- Pool route: portfolio uses PgBouncer transaction pooling (`pool.go:28-31`, `DB_PGBOUNCER`); every statement here is inside a short transaction — no session advisory locks / `LISTEN` (F-06).
- `source = 2` is `WATCHLIST_ENTRY_SOURCE_SIGNAL` (`portfolio.proto:236-241`). `user_id` for the event owner is on `portfolio.watchlists` (`007_watchlists.up.sql`).

**TDD**: red-green required (paired with Step 10)

**Covers**: —

**Instructions** (design § 4; DB `now()` is the only clock — no Go-clock/after-await trap, fails.md 2026-08-16 `signal-time-decay`):
1. In `signal_expiry_repo.go` define `type PrunedEntry struct { UserID, WatchlistID, Symbol, StrategyID string; SignalID *int64; ValidUntil time.Time }` and `type PruneResult struct { Removed []PrunedEntry; Lists, SkippedLists int }`, and `func (r *WatchlistRepo) PruneExpiredSignalEntries(ctx context.Context) (PruneResult, error)`.
2. Enumerate: `SELECT DISTINCT watchlist_id FROM portfolio.watchlist_signal_expiry WHERE valid_until <= now()`.
3. For each list, **one short tx that never waits**:
   1. `SELECT user_id FROM portfolio.watchlists WHERE watchlist_id=$1 FOR NO KEY UPDATE SKIP LOCKED` — no row ⇒ count `SkippedLists`, rollback, continue.
   2. `SELECT symbol, signal_id, valid_until FROM portfolio.watchlist_signal_expiry WHERE watchlist_id=$1 AND valid_until <= now() FOR UPDATE SKIP LOCKED` ⇒ D.
   3. `SELECT symbol FROM portfolio.watchlist_symbols WHERE watchlist_id=$1 AND symbol = ANY($D) AND source = 2 FOR UPDATE SKIP LOCKED` ⇒ locked set L; then `DELETE FROM portfolio.watchlist_symbols WHERE watchlist_id=$1 AND symbol = ANY($L) RETURNING symbol, strategy_id` ⇒ R. **Delete only L** (Execution Summary correction 3): a delete over D would block on a row the SELECT skipped.
   4. `DELETE FROM portfolio.watchlist_signal_expiry e WHERE watchlist_id=$1 AND symbol = ANY($D) AND (symbol = ANY($R) OR NOT EXISTS (SELECT 1 FROM portfolio.watchlist_symbols s WHERE s.watchlist_id = e.watchlist_id AND s.symbol = e.symbol AND s.source = 2))` — rows of removed entries plus expired orphans (a MANUAL re-stamp or missing binding); a SIGNAL binding skipped in step 3 keeps its row for the next tick.
   5. If `len(R) > 0`: `UPDATE portfolio.watchlists SET updated_at = now() WHERE watchlist_id=$1`; commit.
4. Build `PrunedEntry` rows only from R, joining each to its D row (`SignalID` nil when the D row's `signal_id IS NULL` — the "untracked mark" kind; `ValidUntil` from the D row). Emit nothing from the repo (events are the service's job, Step 11).
5. A per-list error ⇒ rollback, record, continue with the next list; return the first non-nil aggregate error only after all lists were attempted (the loop logs WARN). Statement text must use no `lock_timeout` workaround — correctness rests on `SKIP LOCKED`.
6. Add `PruneExpiredSignalEntries(ctx context.Context) (repository.PruneResult, error)` to `WatchlistStore` and a fake implementation.

**Verification**:
```bash
cd services/xstockstrat-portfolio && GOWORK=off go build ./... && GOWORK=off go vet ./... && GOWORK=off go vet -tags dbtest ./...
```
then **GO-LINT**.

---

### Step 10 — test: prune tick DB tests (expiry, retention, idempotence, never-waits)

**Status**: `pending`
**Service**: `xstockstrat-portfolio`
**Files**:
- `services/xstockstrat-portfolio/internal/repository/signal_expiry_prune_dbtest_test.go` — create (`//go:build dbtest`)

**Reviewers**: Service owner `xstockstrat-portfolio` — concurrent write safety on watchlist entries

**Codebase Evidence**:
- Step 4 harness (pool with `lock_timeout=500ms`); Step 9 repo method. Concurrency interleavings mirror `UpdateBinding`'s SQL order (`watchlist_repo.go:337` symbol `UPDATE … RETURNING` first, `:347` parent touch last) — a **future reorder of `UpdateBinding` must update this test** (design Open Risks; keep as a test comment).
- Time control: the DB clock cannot be injected, so cases set `valid_until` relative to `now()` in SQL (`now() - interval '30 days'` / `+ interval '30 days'`) instead of the AC's literal dates; the AC wording maps to "past"/"future".

**TDD**: red-green required — compile-red before Step 9.

**Covers**: `AC-2, AC-3, AC-4, AC-5, AC-6, AC-8, AC-10, AC-12` — AC-2 (only tracked signal past → entry and its expiry row removed, list itself survives); AC-3 (two signals' merged row: future `valid_until` retains, then after `UPDATE … valid_until = now() - '1 day'` the next tick removes); AC-4 (SIGNAL binding with **no** expiry row survives any number of ticks); AC-5 (MANUAL binding with an expired orphan row is not removed; the orphan row is swept); AC-6 (second tick returns `Removed == nil`, no error); AC-8 (after a renewal merge the entry survives past the old expiry, removed after the new one, `PrunedEntry.SignalID` = 102); AC-10 (seed `ingest.newsletter_signals` rows — a live `buy` and an `mcp_client`-source `watchlist` row for the symbol — and assert the entry is still removed: the prune reads only the side table); AC-12 (see below).

**Instructions**:
1. **One `TestPrune_*` function per case** (table-driven only where the shape repeats), **at least nine**: `TestPrune_ExpiredOnlySignalRemoves` (AC-2), `TestPrune_MergedRowRetainsThenRemoves` (AC-3), `TestPrune_UntrackedEntrySurvives` (AC-4), `TestPrune_ManualOrphanSweptEntryKept` (AC-5), `TestPrune_SecondTickIsNoop` (AC-6), `TestPrune_RenewalEventNamesSignal102` (AC-8), `TestPrune_StrategyBoundRemovedLikeAny`, `TestPrune_IngestSignalsDoNotKeepAlive` (AC-10), `TestPrune_ConcurrencyNeverWaits` (AC-12 a/b/c, may be subtests). Cases as above, each asserting the post-state of `watchlist_symbols` **and** `watchlist_signal_expiry`, plus `PrunedEntry` fields (`UserID`, `WatchlistID`, `Symbol`, `StrategyID`, `SignalID`, `ValidUntil`).
2. Strategy-bound SIGNAL entry (`strat-9`) is removed like any other and `StrategyID == "strat-9"` (feeds AC-13 in Step 12).
3. AC-10's ingest rows need the ingest schema: columns confirmed from `ingest/migrations/001_newsletter_signals.up.sql` plus `user_id TEXT NOT NULL` (`013:70`, contracted by `014`); re-grep 013/014 for any other NOT NULL/FK before writing the fixture insert (a `signal_sources` FK may apply — **not verified at spec time**; if present, insert a source row first).
4. AC-12 concurrency (both interleavings, `lock_timeout=500ms` on the prune's pool so any wait **fails** rather than hangs): (a) hold an open tx doing `UPDATE watchlist_symbols … RETURNING` on the due binding (mirrors `UpdateBinding` step 1); run a tick → completes without error, binding **not** removed, expiry row **kept**; commit the holder → next tick removes it. (b) hold the parent via `touchWatchlistTx`-equivalent `UPDATE portfolio.watchlists …` (mirrors `AddSymbols`/`RemoveSymbols`/replace-all) → tick skips the list, no error; then run `UpdateBinding`'s second statement while a tick holds the parent to prove no deadlock (assert the `UpdateBinding` caller gets `ErrBindingNotFound` or success, never a `40P01`). Also (c) a concurrent renewal `AddSymbols` and tick interleave without a lock-timeout error (`SQLSTATE 55P03`) or `40P01`.
5. C-13: literals single-consumer, inline.

**Verification**:
```bash
cd services/xstockstrat-portfolio && GOWORK=off go vet -tags dbtest ./... && GOWORK=off golangci-lint run --modules-download-mode=mod
[ "$(grep -cE '^func TestPrune_' internal/repository/signal_expiry_prune_dbtest_test.go)" -ge 9 ]   # the step cannot pass without its tests (cwd is services/xstockstrat-portfolio)
```
GO-DBTEST (CI `portfolio-db-test`) green; **GO-COVER** (excluded packages — integration verification is sufficient; total ≥ 40%).

---

### Step 11 — service: prune loop, owner-visible events, interval clamp, startup wiring

**Status**: `pending`
**Service**: `xstockstrat-portfolio`
**Files**:
- `services/xstockstrat-portfolio/internal/service/signal_prune.go` — create
- `services/xstockstrat-portfolio/internal/service/portfolio_service.go` — modify (`emitEvent` at `:1140-1181` gains an owner-aware variant)
- `services/xstockstrat-portfolio/cmd/server/main.go` — modify (start the goroutine after `:77`)

**Reviewers**: Service owner `xstockstrat-portfolio` — P&L calculation accuracy, position snapshot consistency, concurrent write safety

**Codebase Evidence**:
- Goroutines start at `cmd/server/main.go:72-77` (`go svc.ConsumeOrderFills(ctx)` … `go svc.HydrateStops(ctx)`); root ctx from `context.WithCancel` (`:38-39`) carries **no `PropagationData`**.
- Live config read pattern: `s.wlCfg.GetInt("portfolio.watchlist.max_symbols_per_list", default)` (`portfolio_service.go:1872-1874`); `intConfig` interface (`:1782-1784`); `Watcher.GetInt` (`internal/config/config.go:126`) returns the default when the key is unset. Unseeded per the 227-D2 waiver (`docs/patterns/config-governance.md:144`).
- `emitEvent(ctx, eventType, streamKey, payload)` (`:1140`) builds `ledgerv1.AppendEventRequest{EventType, SourceService:"portfolio", StreamKey, OccurredAt, Payload, IdempotencyKey: uuid.NewString()}`, retries `codes.Unavailable` 4× with backoff, never returns an error; its callers use `"watchlist:"+id` stream keys (`:2185-2188`). It does **not** set `UserId`; ledger falls back to `x-user-id` metadata, which a background ctx lacks (`ledgerServiceImpl.ts:77-78`).
- C-03 mechanics: `UnaryClientInterceptor` injects the trio only when ctx carries `PropagationData` (`internal/middleware/propagation.go:39-48`), so a background emit must set outgoing metadata itself. Recorded C-03 exception (design): `x-access-scope` is absent on background emits; owner rides in `AppendEventRequest.user_id`, trace in `x-trace-id`.
- `uuid`, `structpb`, `timestamppb`, `status`/`codes` are already imported (`portfolio_service.go:12-30`); `metadata` is imported only in `authz.go` — add the import where used.
- Header propagation (step-constraints §B): the ledger client is built with `grpc.WithChainUnaryInterceptor(middleware.UnaryClientInterceptor)` (`portfolio_service.go:130`); this step reuses it and adds the metadata explicitly because the interceptor is a no-op for a ctx without `PropagationData`.

**TDD**: red-green required (paired with Step 12)

**Covers**: —

**Instructions**:
1. `signal_prune.go`: `const signalPruneIntervalKey = "portfolio.watchlist.signal_prune_interval_seconds"`, `defaultPruneIntervalSec = 300`, `minPruneIntervalSec = 60`, `maxPruneIntervalSec = 86400` — reader-safety constants only (F-07: the tunable is the config key; these are the clamp for a stored out-of-range value). `func clampPruneInterval(v int64) time.Duration`: `<=0`→300s; `1..59`→60s; `>86400`→86400s; else `v` seconds.
2. `func (s *PortfolioService) PruneExpiredSignalEntries(ctx context.Context)`: one tick immediately at startup, then loop `select { case <-ctx.Done(): return; case <-time.After(s.pruneInterval()) }` where `pruneInterval()` re-reads `s.wlCfg.GetInt(signalPruneIntervalKey, defaultPruneIntervalSec)` **every iteration** (no change-callback; live per call).
3. Define the tick body as its own method `func (s *PortfolioService) pruneOnce(ctx context.Context)` — `PruneExpiredSignalEntries` (instruction 2) calls it once at startup and then on each interval, so Step 12 can drive exactly one tick without sleeping (the loop's sleep itself is not unit-tested). `pruneOnce` builds one `tickCtx` per tick and **passes that same `tickCtx` to the repo call and to every `emitEventAs`** (so each emit carries the tick's `x-trace-id`, which Step 12 asserts): `res, err := s.watchlists.PruneExpiredSignalEntries(tickCtx)` where `tickCtx` = `metadata.AppendToOutgoingContext(ctx, "x-trace-id", uuid.NewString())` (fresh trace id per tick). On error: `slog.WarnContext` and continue (never exits the loop). After commit (the repo already committed), for each `res.Removed` row emit exactly one ledger event **owned by that user**, stream key `"watchlist:"+WatchlistID`:
   - `SignalID != nil` → `portfolio.watchlist.signal_entry_expired` payload `{user_id, watchlist_id, symbol, strategy_id, signal_id, valid_until}` with `valid_until` as `ValidUntil.UTC().Format(time.RFC3339)`.
   - `SignalID == nil` → `portfolio.watchlist.signal_entry_removed_untracked` payload `{user_id, watchlist_id, symbol, strategy_id}`.
   End each tick with one `slog.InfoContext(ctx, "signal watchlist prune tick", "lists", …, "skipped", …, "removed", len(res.Removed))`.
4. In `portfolio_service.go` refactor `emitEvent` into `emitEventAs(ctx, ownerUserID, eventType, streamKey, payload)` that sets `req.UserId = ownerUserID` when non-empty, and make `emitEvent` call it with `""` — **same retry/idempotency body, no duplication**. Event emission stays best-effort after commit (a crash between commit and emit loses the event; accepted, design Open Risks).
5. `cmd/server/main.go`: add `go svc.PruneExpiredSignalEntries(ctx)` immediately after `go svc.HydrateStops(ctx)` (`:77`).
6. No pause switch (user sign-off). `sloglint` (`.golangci.yml`) requires `*Context` slog calls in scope — use `slog.WarnContext/InfoContext`.

**Verification**:
```bash
cd services/xstockstrat-portfolio && GOWORK=off go build ./... && GOWORK=off go vet ./...
grep -n "x-trace-id" internal/service/signal_prune.go && grep -n "func (s \*PortfolioService) emitEventAs" internal/service/portfolio_service.go && grep -n "go svc.PruneExpiredSignalEntries" cmd/server/main.go
```
Each grep must hit (chained with `&&`): the explicit `x-trace-id` metadata set, the owner-aware emit and the goroutine start (C-03). Then **GO-LINT**.

---

### Step 12 — test: prune loop events, interval clamp and no-op tick (service unit tests)

**Status**: `pending`
**Service**: `xstockstrat-portfolio`
**Files**:
- `services/xstockstrat-portfolio/internal/service/signal_prune_test.go` — create
- `services/xstockstrat-portfolio/internal/service/watchlist_service_test.go` — modify (`fakeLedger` captures the `AppendEventRequest` and incoming/outgoing metadata)

**Reviewers**: Service owner `xstockstrat-portfolio` — concurrent write safety on watchlist entries

**Codebase Evidence**:
- `fakeLedger` currently only counts `AppendEvent` calls and can force an error (`watchlist_service_test.go:253-266`) — extend it to append each request to a slice and record `metadata.FromOutgoingContext(ctx)` (the fake receives the ctx the service passed). `fakeConfig` / `wideCaps()` (`:362-367`) show the `intConfig` stub shape (`GetInt`).
- `fakeWatchlistStore.PruneExpiredSignalEntries` from Step 9 returns a configured `PruneResult`.
- `TestLedgerFailure_NonFatal` (`:505`) is the precedent for ledger-error tolerance.

**TDD**: red-green required — fails before Step 11 (no symbols).

**Covers**: `AC-6, AC-7, AC-8, AC-13, AC-14` — AC-6 (empty `PruneResult` ⇒ zero `AppendEvent` calls, no error); AC-7 (expired entry ⇒ one `portfolio.watchlist.signal_entry_expired` naming user `user-1`, symbol, `signal_id 101`); AC-8 (event names `signal_id 102` for a renewed entry); AC-13 (table: AAPL with `SignalID=101` → `…signal_entry_expired` with `signal_id`+`valid_until "2026-10-01T00:00:00Z"`; ORCL with nil `SignalID` → `…signal_entry_removed_untracked`; each: exactly one event, `req.UserId == "user-1"`, non-empty `x-trace-id` in outgoing metadata, payload holds `user_id`, `watchlist_id`, `symbol`, `strategy_id "strat-9"`, stream key `watchlist:<id>`; the untracked payload has **no** `signal_id`/`valid_until`); AC-14 read half (`clampPruneInterval` table: `0→300s`, `30→60s`, `90000→86400s`, plus `-5→300s`, `60→60s`, `86400→86400s`, `1→60s`, and a `pruneInterval()` check through a stub `intConfig` for an unset key → 300s).

**Instructions**:
1. Name the tests so the Verification `-run` filter cannot match nothing: `TestClampPruneInterval` (table: `0`→300, `-5`→300, `1`→60, `59`→60, `60`→60, `86400`→86400, `90000`→86400); `TestSignalPrune_ExpiredEventPayload`, `TestSignalPrune_UntrackedEventPayload`, `TestSignalPrune_LedgerErrorIsBestEffort`, `TestSignalPrune_NoopTickEmitsNothing`, `TestSignalPrune_IntervalDefaultsWhenUnset` (stub `intConfig` with the key unset → `pruneInterval()` = 300 s; `TestClampPruneInterval` covers the clamp table), and an AC-8 case inside `TestSignalPrune_ExpiredEventPayload` (a renewed entry's event carries `signal_id 102`). They drive one tick through `s.pruneOnce(ctx)` (defined by Step 11), never the sleeping loop.
2. Event assertions use the extended `fakeLedger`; a ledger error on one emit must not stop the remaining emits (best-effort).
3. Literals inline (single consumer, C-13); reuse the existing `fakeLedger`/`fakeConfig`.

**Verification**:
```bash
cd services/xstockstrat-portfolio && [ "$(grep -cE '^func Test(SignalPrune|ClampPrune)' internal/service/signal_prune_test.go)" -ge 6 ] && OUT=$(GOWORK=off go test ./internal/service/ -run 'TestSignalPrune_|TestClampPruneInterval' -race -count=1 -v 2>&1); rc=$?; [ "$rc" -eq 0 ] && [ "$(echo "$OUT" | grep -c '^--- PASS')" -ge 6 ]   # the six named tests exist, run and pass; a filter matching nothing, or any failure, fails the command
```
then **GO-LINT** and **GO-COVER** ("New logic is in an excluded package — no coverage threshold applies; integration test verification is sufficient"; total ≥ 40%).

---

### Step 13 — config: `SCALAR_BOUNDS_REGISTRY` entry for the prune interval

**Status**: `pending`
**Service**: `xstockstrat-config`
**Files**:
- `services/xstockstrat-config/src/grpc/configServiceImpl.ts` — modify

**Reviewers**: Service owner `xstockstrat-config` — config key naming (`<service>.<category>.<key>`), environment/global-per-user scoping, WatchConfig stream stability

**Codebase Evidence**:
- Confirmed via: `grep -n "SCALAR_BOUNDS_REGISTRY" services/xstockstrat-config/src/grpc/configServiceImpl.ts` → `103` (definition), `155` (`lookupScalarBounds`). The last entry is `'portfolio.marketdata.last_close_lookback_days': { minValue: 5, maxValue: 60 }` at `:148`; the registry is **full-dotted** and looked up with the bare DB `key` first then `${namespace}.${key}` (`:151-156`), so one full-dotted entry covers both key-column forms.
- Seeding waiver: unseeded keys are the 227-D2 / feature 240 precedent (`docs/patterns/config-governance.md:140-148`); no config migration is added. Naming `<service>.<category>.<key>` ✓ (`portfolio.watchlist.signal_prune_interval_seconds`).

**TDD**: N/A (config registry data; behavior proven by the paired test in Step 14)

**Covers**: —

**Instructions**:
1. After the feature-240 entry (`:147-148`) add a comment line (constraint only: write bound mirrors the reader clamp so a stored value is never silently re-clamped for any writable input) and:
   `'portfolio.watchlist.signal_prune_interval_seconds': { minValue: 60, maxValue: 86400 },`
2. No seed migration, no env change, no other key touched.
3. **Feature 278 interaction (overlap review) — escalate, never guess (P-03).** `278-enforce-config-key-wiring` (spec `implementation-spec.md`) scans Go getters including portfolio's `Watcher.GetInt` (`config.go:126`) and its ratchet **fails `--final` on any produced `read-unseeded` finding not already in `scripts/config-wiring.json`, and baseline entries may only shrink** (278 spec ratchet rules), so a *new* baseline entry for this key is **not** an allowed fix. This key is deliberately unseeded (227-D2 waiver, design § 4). At execute time: `ls scripts/check-config-wiring.mjs scripts/config-wiring.json`. If only one of the two exists, **stop and ask** (a partially landed 278 is not a state this spec reasons about). If neither exists on the base (278 not landed), do nothing here; `context.md` carries this note for the 278 owner, whose first run will record the key. If both exist, run `node scripts/check-config-wiring.mjs --final`; if it reports `portfolio.watchlist.signal_prune_interval_seconds` as `read-unseeded`, **stop the step and ask the operator** — the 278-compliant fix is to seed the key with a `xstockstrat-config` migration (a **design change** from the D2 waiver, so `/sdd-design` is re-run first), and the alternative is an operator ruling that the key is exempt. The executor must not add a baseline entry, weaken the ratchet, or seed the key on its own.

**Verification**:
```bash
cd services/xstockstrat-config && grep -n "signal_prune_interval_seconds" src/grpc/configServiceImpl.ts && pnpm run lint
```
(NODE-VERIFY runs in Step 14.)

---

### Step 14 — test: config bounds rows for the prune interval (both key-column forms)

**Status**: `pending`
**Service**: `xstockstrat-config`
**Files**:
- `services/xstockstrat-config/src/__tests__/setConfigScalarBounds.test.ts` — modify

**Reviewers**: Service owner `xstockstrat-config` — config key naming, scoping, WatchConfig stream stability

**Codebase Evidence**:
- `TIMEOUT_KEY_FORMS` table (`setConfigScalarBounds.test.ts:~262-290`) holds `{ ns, key, field, min, max }` rows in both forms (e.g. `{ ns: 'portfolio', key: 'marketdata.last_close_lookback_days', … }` and the full-dotted twin at `:287-288`); the loop below it generates "accepts at bounds" and "rejects just outside" tests asserting `INVALID_ARGUMENT` and the `[min, max]` text, and no INSERT on rejection.

**TDD**: red-green required — fails before Step 13 (a write of 0/59/86401 is accepted because no registry entry exists).

**Covers**: `AC-14` — SetConfig half: `0` and `59` rejected (minimum 60), `60` and `86400` accepted, `86401` rejected (maximum 86400), in both `ns:'portfolio', key:'watchlist.signal_prune_interval_seconds'` (namespace-relative) and `key:'portfolio.watchlist.signal_prune_interval_seconds'` (full-dotted) forms.

**Instructions**:
1. Append two rows to `TIMEOUT_KEY_FORMS`: `{ ns: 'portfolio', key: 'watchlist.signal_prune_interval_seconds', field: 'intVal', min: 60, max: 86400 }` and the full-dotted twin. The existing loop yields the `min-1`/`max+1` rejections (59, 86401) and in-bounds acceptances (60, 86400).
2. Add one explicit assertion that `0` is rejected for the full-dotted form (the AC's `0` row; `min-1` only covers 59).

**Verification**:
```bash
cd services/xstockstrat-config && [ "$(grep -c 'signal_prune_interval_seconds' src/__tests__/setConfigScalarBounds.test.ts)" -ge 3 ] && pnpm run lint && pnpm run test:coverage && pnpm exec c8 check-coverage --lines 40
```

---

### Step 15 — service: `portfolio backfill-signal-expiry` operator subcommand (REPORT / APPLY)

**Status**: `pending`
**Service**: `xstockstrat-portfolio`
**Files**:
- `services/xstockstrat-portfolio/cmd/server/main.go` — modify (dispatch beside `healthcheck`, `:31`)
- `services/xstockstrat-portfolio/cmd/server/backfill.go` — create (flag parsing, empty-`DATABASE_URL` refusal, exit-code mapping **only**; all refusal and bound logic lives in the repository package so Step 16 can assert it)
- `services/xstockstrat-portfolio/internal/repository/signal_expiry_backfill.go` — create (classification query, REPORT read-only tx, APPLY per-row statements, **and every refusal/bound check**, exported for Step 16)

**Reviewers**: DBA — index correctness, run-order/cross-schema reads, reviewed before any APPLY; Service owner `xstockstrat-portfolio` — concurrent write safety on watchlist entries

**Codebase Evidence**:
- `healthcheck` is dispatched at the very top of `main()` **before** logger/config/mTLS (`cmd/server/main.go:31-33`: `if len(os.Args) > 1 && os.Args[1] == "healthcheck" { os.Exit(healthcheck()) }`); the new subcommand dispatches the same way, before `config.NewWatcher` (`:55`) and `mtls.ServerConfig()` (`:87`) so it needs neither a config service nor certs.
- Pool: `repository.NewPortfolioRepo(connStr)` + `Pool()` (`portfolio_repo.go:37,55`) — there is no exported `NewPool` and none is added (YAGNI). `config.LoadFromEnv().DBConnStr` defaults to `""` (`config.go:39`), so the command **must refuse an empty `DATABASE_URL`** and print `target host=… db=…` first (`pgxpool.ParseConfig`).
- `DB_PGBOUNCER=true` switches pgx to `QueryExecModeExec` (`pool.go:28-31`); the runbook runs the CLI from a workstation against the pooled `:25061` URL, one transient client, `DB_POOL_MAX` unset (F-06, `docs/runbooks/legacy-formula-authors.md:41-73`, `operator-db-access.md`). The image is distroless without a shell (`services/xstockstrat-portfolio/Dockerfile:10`), so it cannot be exec'd in the container.
- Ingest join key: `ingest.newsletter_signals (id BIGSERIAL, user_id TEXT NOT NULL, direction TEXT CHECK IN ('buy','sell','hold','watchlist'), symbol TEXT, valid_until TIMESTAMPTZ)` (`001:9-20`, `013:70`); symbols are stored as supplied, so the join normalizes with `upper(btrim(n.symbol)) = s.symbol` and `lower(n.direction)='watchlist'`. Legacy-owner rows were reassigned to `SEED_USER_ID` by ingest `013:70`; the portfolio runtime has no `SEED_USER_ID`, hence `--legacy-owner` is required in both modes (design § 5).
- The backfill never merges (it only inserts rows for bindings with no expiry row, `ON CONFLICT DO NOTHING`); the add path's merge constant (Step 5) is not used here.

**TDD**: red-green required (paired with Step 16)

**Covers**: —

**Instructions** (design § 5; **the CLI never deletes bindings** — the in-service prune is the single deleter):
1. `main.go`: right after the `healthcheck` branch add `if len(os.Args) > 1 && os.Args[1] == "backfill-signal-expiry" { os.Exit(runBackfillSignalExpiry(os.Args[2:])) }`.
2. `backfill.go` (**thin**; defines `func runBackfillSignalExpiry(args []string) int`, the function `main.go` calls): `flag.NewFlagSet` with `--mode=report|apply` (default `report`), `--legacy-owner <id>`, `--expect-untracked N`, `--expect-seed-expired M`. Refuse when `DATABASE_URL` is empty with the exact message `backfill-signal-expiry: DATABASE_URL is required (pooled :25061 URL; no .env fallback)` on stderr and exit code 2; when `DATABASE_URL` is non-empty print `target host=<host> db=<db>` before anything else; build `repository.BackfillOptions` and call `repository.RunBackfill`; map `errors.Is(err, repository.ErrBackfillRefused)` (and any other error) to a non-zero exit. No bound or ownership logic here.
   **Exported contract Step 16 calls** (`signal_expiry_backfill.go`): `type BackfillOptions struct { Mode string; LegacyOwner string; ExpectUntracked, ExpectSeedExpired *int64 }`; `type BackfillResult struct { Seeded, Marked, SkippedChanged int; Report string }`; `var ErrBackfillRefused = errors.New("backfill refused")`; `func RunBackfill(ctx context.Context, pool *pgxpool.Pool, opts BackfillOptions, out io.Writer) (BackfillResult, error)`. `RunBackfill` itself enforces: `LegacyOwner` non-empty in **both** modes; `ExpectUntracked` and `ExpectSeedExpired` non-nil for APPLY; live untracked count > `*ExpectUntracked` or seed-expired count > `*ExpectSeedExpired` ⇒ return `ErrBackfillRefused` **before the first write**. The legacy owner is echoed in the header of both modes so the pasted REPORT and APPLY output show the same value (a cross-invocation mismatch cannot be detected by the process; the change record is the control).
3. `signal_expiry_backfill.go`: candidate query = SIGNAL bindings (`source=2`) on `system_managed` lists with **no** expiry row, `LEFT JOIN ingest.newsletter_signals n ON n.user_id = w.user_id AND lower(n.direction)='watchlist' AND upper(btrim(n.symbol)) = s.symbol`. Classify per binding: any open-ended row (`n.valid_until IS NULL`) ⇒ stays **untracked** (skipped); else `max(valid_until)` with that row's `id` ⇒ **seed** (`seed_expired` when `max <= now()`); no row ⇒ **untracked ⇒ mark** `{valid_until = now(), signal_id NULL}`. Over-inclusion prunes late, never early.
4. **REPORT**: a single read-only transaction (no locks, never write-then-rollback). Print a header (`legacy_owner`, "read-only"), SEED rows (owner, watchlist_id, symbol, `valid_until`, `signal_id`, `seed_expired`), UNTRACKED rows `(owner, watchlist_id, symbol, strategy_id, legacy_rows, legacy_live)` + a `with_live_legacy_signal` count (`legacy_*` computed from `n.user_id = <legacy-owner>`; informational only, behavior unchanged), a PER-OWNER table (`signal_entries, seed, seed_expired, untracked, own_signal_rows_total`, flag `NO_OWN_SIGNALS` when the owner has zero watchlist-direction rows under their own id), and a final `NEXT:` line with the exact APPLY command including `--expect-untracked N --expect-seed-expired M` and the same `--legacy-owner`.
5. **APPLY**: `RunBackfill` refuses **before any write** per the bounds above. Then **one autocommit statement per row**, deterministic order `(watchlist_id, symbol)`: `INSERT INTO portfolio.watchlist_signal_expiry … SELECT … ON CONFLICT DO NOTHING` that **recomputes from ingest at statement time** (`WHERE EXISTS(SIGNAL binding) AND NOT EXISTS(open-ended row) AND <row still in the class REPORT named>`); a row whose class changed is skipped and counted `changed since REPORT`. N and M are at-most bounds; a partial apply + abort is idempotent on re-run. Never `FOR UPDATE` more than one expiry row at a time; no CLI ledger/mTLS access.
6. Output of both modes must be paste-able into the change record (plain text, stable column order).
7. Header propagation: none — no outbound gRPC.

**Verification**:
```bash
cd services/xstockstrat-portfolio && GOWORK=off go build ./... && GOWORK=off go vet ./... && GOWORK=off go vet -tags dbtest ./...
# the subcommand refuses an empty DATABASE_URL before opening any connection (the --legacy-owner / --expect-* refusals live in repository.RunBackfill and are asserted by Step 16):
OUT=$( DATABASE_URL= GOWORK=off go run ./cmd/server backfill-signal-expiry --mode=report --legacy-owner SEED 2>&1 ); rc=$?; [ "$rc" -ne 0 ] && echo "$OUT" | grep -q "DATABASE_URL is required"   # cwd is already services/xstockstrat-portfolio; a real assertion: non-zero exit AND the refusal text (go run maps the child exit code to 1)
```
then **GO-LINT**.

---

### Step 16 — test: backfill DB tests (seed, strict untracked removal, rescue, bounds, idempotence, ingest interleaving)

**Status**: `pending`
**Service**: `xstockstrat-portfolio`
**Files**:
- `services/xstockstrat-portfolio/internal/repository/signal_expiry_backfill_dbtest_test.go` — create (`//go:build dbtest`; drives `repository.RunBackfill`, the exported entry point defined in Step 15)

**Reviewers**: DBA — migration/cross-schema read correctness; Service owner `xstockstrat-portfolio` — concurrent write safety on watchlist entries

**Codebase Evidence**:
- Requires ingest tables in the CI database: the Step 4 job's migrator applies ingest migrations with `SEED_USER_ID` (mirrors `scripts/migration-rerun.sh`); `ingest.newsletter_signals` column set per Step 10's evidence (re-grep 013/014 for NOT NULL/FK before writing fixtures).
- The prune that deletes marked entries is Step 9's `PruneExpiredSignalEntries`; marked rows are `{valid_until = now(), signal_id NULL}` so they are due on the very next tick.

**TDD**: red-green required — compile-red before Step 15.

**Covers**: `AC-15, AC-16, AC-17` — AC-15 (user-1 SIGNAL `AAPL`, ingest rows `" aapl"` id 7 `valid_until` 2026-12-01 and `"AAPL"` id 5 2026-09-01; REPORT with `--legacy-owner SEED` writes nothing and lists seed `valid_until` 2026-12-01 / `signal_id 7`, `seed_expired 0`; APPLY with `--expect-seed-expired 0 --expect-untracked 0` writes the row `(2026-12-01, 7)`); AC-16 (user-2 SIGNAL `PLTR` bound `strat-3`, no own rows, legacy owner `SEED` holds a live watchlist row: REPORT lists the untracked row with `legacy_live Y` and flags `NO_OWN_SIGNALS`; APPLY `--expect-untracked 0` refuses and writes **nothing**; `--expect-untracked 1` marks, the next `PruneExpiredSignalEntries` tick removes `PLTR` and returns a `PrunedEntry` with nil `SignalID` and `StrategyID "strat-3"`); AC-17 (a marked `ORCL`: a live dated `AddSymbols` renewal (id 110) before the tick rescues it → tick keeps it, tracked by 110; a renewal carrying an already-past `valid_until` (id 111) is not a rescue → next tick removes it with a non-nil `SignalID`).

**Instructions**:
1. REPORT purity: snapshot `watchlist_signal_expiry` row count before/after REPORT and assert equality.
2. Bounds and refusals, asserted by calling `repository.RunBackfill` directly (the CLI is a thin wrapper): `ExpectUntracked` or `ExpectSeedExpired` exceeded ⇒ `errors.Is(err, repository.ErrBackfillRefused)` and **zero rows written**; `LegacyOwner == ""` ⇒ refused in both modes; APPLY with a nil `ExpectUntracked`/`ExpectSeedExpired` ⇒ refused. The empty-`DATABASE_URL` refusal is the only check left in `cmd/server` and is covered by Step 15's offline verification command. Idempotent re-run: APPLY twice ⇒ second run writes nothing, no error.
3. Open-ended ingest row (`valid_until NULL`) ⇒ entry stays untracked (neither seeded nor marked).
4. **Ingest-interleaving test (design T4):** between the REPORT candidate read and the APPLY row write, commit a new live watchlist-direction ingest row **and** a renewal `AddSymbols` for the same entry; APPLY must skip it as `changed since REPORT` (or, if it ran first, the add's merge/rescue fixes the mark) — assert the entry is never left marked-and-removable while a live signal exists, using the harness's `lock_timeout=500ms` pool so waits fail deterministically.
5. Symbols in fixtures include `" aapl"` to prove `upper(btrim())` normalization at the source.
6. C-13: literals inline, single consumer.
7. **Mandated test names** (the Verification counts them; **at least nine**): `TestBackfill_ReportIsReadOnly`, `TestBackfill_BoundsRefuseBeforeWrite`, `TestBackfill_LegacyOwnerRequired`, `TestBackfill_SeedsFromOwnerRows` (AC-15, incl. the `" aapl"` fixture), `TestBackfill_StrictUntrackedRemoval` (AC-16, incl. `legacy_live` and the bound refusal), `TestBackfill_MarkedEntryRescued` (AC-17), `TestBackfill_OpenEndedStaysUntracked`, `TestBackfill_Idempotent`, `TestBackfill_IngestInterleavingSkipsChanged`.

**Verification**:
```bash
cd services/xstockstrat-portfolio && GOWORK=off go vet -tags dbtest ./... && GOWORK=off golangci-lint run --modules-download-mode=mod
[ "$(grep -cE '^func TestBackfill_' internal/repository/signal_expiry_backfill_dbtest_test.go)" -ge 9 ]   # the step cannot pass without its tests (cwd is services/xstockstrat-portfolio)
```
GO-DBTEST (CI `portfolio-db-test`) green; **GO-COVER** (excluded packages; total ≥ 40%).

---

### Step 17 — service: agent sends signal provenance on the `direction="watchlist"` auto-add

**Status**: `pending`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/app/client.py` — modify (`add_watchlist_symbol`, `:315-330`)
- `services/xstockstrat-agent/app/tools.py` — modify (auto-add call at `:692`; `ingest_signal` docstring `:628-630`; `get_watchlist` docstring at `:2020-2038`)

**Reviewers**: Service owner `xstockstrat-agent` — MCP tool contract stability and `docs/runbooks/mcp-tools.md` parity; tool-count statements kept in sync across all six inventory surfaces; statelessness

**Codebase Evidence**:
- Confirmed via: `grep -nE "add_watchlist_symbol|ensure_signal_watchlist|_iso_to_timestamp" services/xstockstrat-agent/app/client.py services/xstockstrat-agent/app/tools.py` → `client.py:297` (`ensure_signal_watchlist`), `:315` (`add_watchlist_symbol(user_id, watchlist_id, symbol)`), `:99` (`_iso_to_timestamp`); `tools.py:692` calls `await client.add_watchlist_symbol(user_id, wl_id, symbol)` inside `if direction == "watchlist" and not result.get("deduplicated"):` (`:688-696`, bare `except Exception` → `log.warning`).
- Current request: `AddWatchlistSymbolsRequest(watchlist_id=…, bindings=[binding])` with metadata `_metadata(("x-user-id", user_id))` (`client.py:324-328`) — the existing propagating call; no new outbound RPC (step-constraints §B: reuses the `_metadata` header mechanism, `client.py:68-90`).
- `result` carries `{"signal_id": resp.signal_id, "deduplicated": resp.deduplicated}` (`client.py` `ingest_signal` return) and `valid_until` is the tool's ISO string argument (`tools.py:608-613`).
- The `ingest_signal` docstring SIDE EFFECT block is at `tools.py:628-630`; `get_watchlist` docstring at `:2020-2031`. Tool count statement: `tools.py:54` ("the tool count stays forty-five").
- Agent `CLAUDE.md:141` mentions the SIGNAL path; no edit needed unless it describes lifetimes (checked in Step 20).

**TDD**: red-green required (paired with Step 18)

**Covers**: —

**Instructions**:
1. `client.add_watchlist_symbol(user_id, watchlist_id, symbol, signal_id: int | None = None, valid_until: str | None = None)`: build `portfolio_pb2.WatchlistSignalProvenance(signal_id=signal_id, valid_until=_iso_to_timestamp(valid_until))` **only when both `signal_id` is truthy and `valid_until` is a dated ISO string that parses to a timestamp with seconds > 0**. Wrap the `_iso_to_timestamp` call in `try/except ValueError` (`datetime.fromisoformat` raises on bad input, `client.py:99-105`) and treat a failure exactly like an undated value, so a bad string drops the provenance, never the whole auto-add; otherwise omit `signal_provenance` entirely (open-ended / undated → no provenance → portfolio untracks, per design § 3). Pass it as `signal_provenance=` on the `AddWatchlistSymbolsRequest`. Keep binding, metadata and timeout unchanged.
2. `tools.py:692`: `await client.add_watchlist_symbol(user_id, wl_id, symbol, result.get("signal_id"), valid_until)`. The gate (`:688`) and the best-effort `except` (`:693-696`) are unchanged — a provenance `InvalidArgument` is logged at WARN and drops the auto-add, never failing the ingest.
3. Docstrings (each gains one sentence): `ingest_signal` SIDE EFFECT — the added entry **expires** when every agent-recorded `direction='watchlist'` signal for that symbol has passed its `valid_until` (entries from open-ended signals never expire; failed/deduplicated adds do not renew); `get_watchlist` — reflects the pruned set (expired SIGNAL entries are removed automatically, MANUAL never).
4. Do not add a tool or change any tool signature; the tool count stays 45 — verify with the grep below (six inventory surfaces unchanged).

**Verification**:
```bash
cd services/xstockstrat-agent && grep -q "forty-five" app/tools.py && ! git diff -U0 "$(git merge-base HEAD origin/main-dev)" -- app/tools.py | grep -E '^[+-].*(forty-five|@(server|mcp)\.tool)'   # tool count text present and untouched; no tool registration added/removed (diffed against the merge base, so it still bites after the step is committed)
ruff check . && ruff format --check .
```
then **PY-VERIFY** (run with Step 18's tests).

---

### Step 18 — test: agent provenance (client request builder + tool path)

**Status**: `pending`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/tests/test_watchlist_client.py` — modify
- `services/xstockstrat-agent/tests/test_ingest_signal_watchlist.py` — modify

**Reviewers**: Service owner `xstockstrat-agent` — MCP tool contract stability and `mcp-tools.md` parity

**Codebase Evidence**:
- `test_watchlist_client.py:~236-262` already drives `client.add_watchlist_symbol("user-42", "wl-sig", "AAPL")` through `_patch_stub`/`_channel_cm` and asserts metadata; `test_ingest_signal_watchlist.py` asserts `mock_add.assert_awaited_once_with("u-2", "wl-sys", "NVDA")` (`test_watchlist_direction_adds_symbol`) and covers AC-1..AC-5 of feature 127 with `AsyncMock` patches of `client.*` and `_tool_fn(server, "ingest_signal")`.
- Fixtures: `tests/conftest.py` provides `TRADER`, `_ctx` (imported by the existing test, `test_ingest_signal_watchlist.py:19`); C-13: no new fixture home — literals stay inline (single consumer each), existing `conftest` helpers reused.

**TDD**: red-green required — the updated `assert_awaited_once_with("u-2", "wl-sys", "NVDA", 1, None)` and the provenance assertions fail before Step 17.

**Covers**: `AC-8, AC-9` — AC-8 (agent half: a non-deduplicated watchlist signal 102 with `valid_until 2026-12-01T00:00:00Z` sends provenance `(102, 2026-12-01)`); AC-9 (agent half: an open-ended signal — no `valid_until` — sends **no** `signal_provenance`, which is what makes the entry untracked; an undated/unparseable value also sends none).

**Instructions**:
1. `test_watchlist_client.py`: add tests for the request builder — with `signal_id=102, valid_until="2026-12-01T00:00:00Z"` the captured `AddWatchlistSymbolsRequest` has `signal_provenance.signal_id == 102` and `valid_until.seconds` = that instant; with `valid_until=None` / `signal_id=None` / `valid_until=""` / `valid_until="not-a-date"` (unparseable) the field is unset **and the `AddWatchlistSymbolsRequest` is still sent** (the binding add is not dropped) (`HasField("signal_provenance")` is false); binding source stays `WATCHLIST_ENTRY_SOURCE_SIGNAL`; `x-user-id` appears exactly once (existing assertion pattern).
2. `test_ingest_signal_watchlist.py`: update the existing add assertions to the new call shape (`("u-2", "wl-sys", "NVDA", 1, None)` for an open-ended signal); add a case with `valid_until` set asserting `mock_add` receives `signal_id` 102 and the ISO string; assert the gate is unchanged (non-watchlist direction and deduplicated results still do not call `add_watchlist_symbol`); assert a portfolio `INVALID_ARGUMENT` from the add is swallowed with a WARN (feature 127 AC-4 shape).
3. **Mandated new test names** (the Verification counts them): `test_add_watchlist_symbol_sends_provenance`, `test_add_watchlist_symbol_omits_provenance_when_undated`, `test_add_watchlist_symbol_unparseable_valid_until_still_adds`, `test_ingest_signal_passes_signal_id_and_valid_until`, `test_ingest_signal_open_ended_passes_no_valid_until`, `test_add_invalid_argument_is_swallowed` (the existing `test_watchlist_direction_adds_symbol` is updated in place to the new call shape).
4. Docstring parity: extend the existing AC-5 doc-parity test (it reads the `ingest_signal` docstring and `docs/runbooks/mcp-tools.md`) to assert the docstring now mentions expiry.

**Verification**:
```bash
cd services/xstockstrat-agent && ruff check . && ruff format --check . && [ "$(grep -cE '^(async )?def test_(add_watchlist_symbol_(sends_provenance|omits_provenance_when_undated|unparseable_valid_until_still_adds)|ingest_signal_(passes_signal_id_and_valid_until|open_ended_passes_no_valid_until)|add_invalid_argument_is_swallowed)' tests/test_watchlist_client.py tests/test_ingest_signal_watchlist.py | awk -F: '{n+=$2} END{print n}')" -ge 6 ] && pytest tests/test_watchlist_client.py tests/test_ingest_signal_watchlist.py
pytest --cov=app --cov-fail-under=40   # full suite (cwd is already services/xstockstrat-agent): the 40% threshold is only meaningful over the whole suite
```

---

### Step 19 — test: UI e2e — an emptied system-managed list renders and cannot be deleted

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/e2e/insights/watchlists.spec.ts` — modify
- `services/xstockstrat-ui/e2e/fixtures/INVENTORY.md` — modify (only if a fixture is added; otherwise record "reuses `mockWatchlists` seed" in the existing row 43 note)

**Reviewers**: Service owner `xstockstrat-ui` — Trading UI correctness, environment-scope correctness, no direct DB access

**Codebase Evidence**:
- No UI code change (product-spec § Consumer Surface; silent removal signed off). Behavior asserted already exists: `WatchlistDetail.tsx:249` renders `<p … >No symbols</p>` when `bindings.length === 0`; `:223` hides the delete button for `watchlist.systemManaged`; `:46` declares `systemManaged?: boolean`.
- Existing neighbour test `'system-managed watchlist: no delete affordance, signal-provenance badge (AC-7/AC-8)'` (`watchlists.spec.ts:~327-370`) seeds `mockWatchlists(page, [{ watchlistId:'wl-sys', name:'Signals', systemManaged:true, bindings:[…] }])` and asserts `Delete Signals` has count 0, `getByRole('button', { name: /^Rename /i })` visible, `getByPlaceholder('Add symbols (e.g. AAPL MSFT)')` enabled; it uses `addAuthCookie(page)` and `page.getByTestId('watchlist-master')`.
- C-12 / inventory: `mockWatchlists` (`e2e/helpers/watchlistMock.ts:41`, optional `seed` arg, `MockWatchlist.systemManaged`, `MockBinding.source`) is catalogued at `INVENTORY.md` row 43. The test passes `bindings: []`/`symbols: []` through the **existing** seed — no new domain object ⇒ no new fixture module; the inline seed literal is a **scenario one-off** (exempt, as in the neighbouring test).
- UI is not Go/Python/Node-coverage-gated: "No coverage threshold — use `pnpm test:e2e`".

**TDD**: N/A (frontend e2e asserting pre-existing behavior; it passes on the current tree — it is a regression guard for the consumer surface, C-14)

**Covers**: `AC-2` — UI consumer-surface half: once the only SIGNAL entry has been pruned the system list shows the bare `No symbols` line, the list itself stays selectable, and no delete affordance is offered (also asserts the portfolio rule "the list is never deleted").

**Instructions**:
1. Add `test('system-managed watchlist emptied by expiry pruning: renders "No symbols", no delete affordance (AC-2)')` to `watchlists.spec.ts` next to the feature-127 test: seed `wl-sys` (`systemManaged: true`, `bindings: []`, `symbols: []`), open `/insights/watchlists`, select it from `watchlist-master`, assert `getByText('No symbols')` visible, `Delete Signals` count 0, Rename still visible, the add-symbols input enabled.
2. Imports only from the existing helpers (`addAuthCookie`, `mockWatchlists`); no inline duplicate of `watchlistMock`. Do not swap in `EmptyState` (out of scope, design § 7).

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm test:e2e e2e/insights/watchlists.spec.ts -g "emptied by expiry pruning"   # no `--`: pnpm would forward it and Playwright would read -g as a file filter
grep -n "emptied by expiry pruning" e2e/insights/watchlists.spec.ts   # the new test exists
```
(the test reuses the existing `mockWatchlists` import already at `watchlists.spec.ts:2-3`; no INVENTORY change is needed when no fixture was added.)

---

### Step 20 — docs: service, pattern and constitution documentation

**Status**: `pending`
**Service**: `docs/`, `xstockstrat-portfolio`, `xstockstrat-agent`
**Files**:
- `services/xstockstrat-portfolio/CLAUDE.md` — modify (config key row after `:107`; the two events in § Ledger Events Emitted; `watchlist_signal_expiry` in § Database; the prune loop and the `backfill-signal-expiry` subcommand)
- `services/xstockstrat-portfolio/docs/context-constitution.md` — modify (new `PORTFOLIO-17` rule; amend `PORTFOLIO-7` (insert path split, add path now takes an `ExpiryIntent`) and re-stamp the anchors you shifted)
- `docs/patterns/database.md` — modify (portfolio plain-table note near the schema map, `:~12-24`)
- `docs/patterns/config-governance.md` — modify (new "feature 281" entry in § Per-Feature Registered Keys, `:~111`)
- `services/xstockstrat-agent/CLAUDE.md` — modify only if `:141` or the tool inventory text states the SIGNAL entry's lifetime (grep first; no edit is a valid outcome)

**Reviewers**: none

**Codebase Evidence**:
- Config key tables: portfolio `CLAUDE.md` rows `portfolio.watchlist.max_per_user`/`max_symbols_per_list` (`:106-107`) are the format to extend; `docs/patterns/config-governance.md` feature-240 entry (`:140-148`) is the template (Type/Default/Bounds/Notes; "unseeded, 227 D2 waiver; `≤ 0` reads as the default").
- Events: portfolio `CLAUDE.md` § Ledger Events Emitted table (`portfolio.position.opened` … `portfolio.snapshot`) — add `portfolio.watchlist.signal_entry_expired` (payload per design § 4) and `portfolio.watchlist.signal_entry_removed_untracked`, noting the owner is carried in `AppendEventRequest.user_id`.
- Teardown for this step's files runs once, at the end of Step 21 (root `CLAUDE.md` § Teardown).
- Overlap review: `docs/patterns/config-governance.md` § Per-Feature Registered Keys is also edited by in-flight features 278, 243 and 255 (append/row edits): place the new entry with the same convention as the nearest sibling entries and expect a rebase-only conflict at merge time (re-read the heading before editing).

**TDD**: N/A (documentation)

**Covers**: —

**Instructions**:
1. **Portfolio `CLAUDE.md`**: add key row `portfolio.watchlist.signal_prune_interval_seconds | int | 300 | …` (feature 281; read live each iteration; `<=0`→300, `1..59`→60, `>86400`→86400 on read; write bounds `[60,86400]` in `SCALAR_BOUNDS_REGISTRY`; unseeded, 227-D2 waiver; no pause switch); the two events; table `portfolio.watchlist_signal_expiry` (migration `018`; FK to `watchlists` only; open-ended = no row; `signal_id NULL` = backfill mark); a short "Signal-entry expiry prune" paragraph (startup tick + interval loop, `SKIP LOCKED` never-waits, `instance_count: 1` not relied on for correctness but load scales per instance; provenance-less SIGNAL add untracks); the `backfill-signal-expiry` subcommand by name only (**no `docs/runbooks/…md` path in this step** — the runbook does not exist until Step 21, and `scripts/check-context-map.sh` fails on a `CLAUDE.md` reference to a missing `docs/**/*.md` file; Step 21 adds the link). Constraints, not narration.
2. **Portfolio constitution**: add `PORTFOLIO-17` — the prune is the single deleter of expiry-tracked SIGNAL entries; never waits (`SKIP LOCKED`, delete only the locked set); `UpdateBinding`/`UpdateBindings` lock symbol-then-parent so any new deleter must also use `SKIP LOCKED`; expiry rows FK to `watchlists` (never `watchlist_symbols`) because replace-all deletes bindings; amend `PORTFOLIO-7` for `insertBindingTx`/`ExpiryIntent`.
3. **`docs/patterns/database.md`**: one sentence under the schema map that `portfolio.watchlist_signal_expiry` (migration `018`) is a plain table (the map is hypertables only) and that the backfill subcommand reads `ingest.newsletter_signals` read-only.
4. **`docs/patterns/config-governance.md`**: new top entry "feature 281 — signal-watchlist-expiry-pruning (`xstockstrat-portfolio` / `xstockstrat-config`)" with the key table and the unseeded waiver, same format as feature 240. In the entry's Notes also record the **feature 278 interaction**: the key is intentionally unseeded (227-D2 waiver); if 278's ratchet is on the base and flags it, Step 13 Instructions 3 escalates rather than baselining it.
5. **Agent `CLAUDE.md`**: grep `:141` and the tool table; edit only if it describes entry lifetime.

**Verification**:
```bash
grep -n "signal_prune_interval_seconds" services/xstockstrat-portfolio/CLAUDE.md && grep -n "signal_prune_interval_seconds" docs/patterns/config-governance.md
grep -n "signal_entry_expired" services/xstockstrat-portfolio/CLAUDE.md && grep -n "signal_entry_removed_untracked" services/xstockstrat-portfolio/CLAUDE.md
grep -n "PORTFOLIO-17" services/xstockstrat-portfolio/docs/context-constitution.md
bash scripts/check-context-map.sh
```
(every grep must hit; `check-context-map.sh` must pass — it validates `docs/...` references inside every `CLAUDE.md`.)

---

### Step 21 — docs: backfill runbook, runbooks index, MCP tools reference and context teardown

**Status**: `pending`
**Service**: `docs/`, `xstockstrat-agent`
**Files**:
- `docs/runbooks/signal-watchlist-expiry-backfill.md` — create
- `docs/runbooks/CLAUDE.md` — modify (index row, table at `:5-17`)
- `docs/runbooks/mcp-tools.md` — modify (`ingest_signal` entry `:224`, errors table `:254-255`, `get_watchlist` `:1246-1260`)
- `services/xstockstrat-portfolio/CLAUDE.md` — modify (add the runbook link to the `backfill-signal-expiry` sentence written in Step 20)
- `docs/patterns/ci-overview.md` — modify (add the `portfolio-db-test` job row beside `ledger-db-test`, `:19`)

**Reviewers**: none

**Codebase Evidence**:
- Runbook shape to follow: `docs/runbooks/legacy-formula-authors.md` (§ 1 Scope, § 2 Authority, § 3 Prerequisites incl. pooled `:25061` + `DB_PGBOUNCER=true`, REPORT/APPLY, undo) and `docs/runbooks/operator-db-access.md`. Index table format: `docs/runbooks/CLAUDE.md:5-17` (`| File | Purpose | Key trigger |`).
- `docs/runbooks/mcp-tools.md:224` currently states the add is "best-effort … never fails the already-committed ingest" and that dedup suppresses it; `:254-255` are the matching error-table rows. Tool count stays 45 (no tool added), so the six inventory surfaces are untouched.
- The backfill contract documented here is the exported `repository.RunBackfill` behavior from Step 15 (required `--legacy-owner`, `--expect-*` bounds, REPORT/APPLY output columns).
- Teardown rule: root `CLAUDE.md` § Teardown (context-forge refresh or documented manual reconciliation; ledger `fails.md:670`). Overlap review: `docs/runbooks/mcp-tools.md` sections are also edited by in-flight 215 and 275 (`run_backtest`/`set_strategy_live`/`list_opportunities` sections — disjoint from `ingest_signal`/`get_watchlist`); rebase-only.

**TDD**: N/A (documentation)

**Covers**: —

**Instructions**:
1. **New runbook `docs/runbooks/signal-watchlist-expiry-backfill.md`** (it must literally name the config key `portfolio.watchlist.signal_prune_interval_seconds`, with "raising the interval is **not** a pause", and both full ledger event names `portfolio.watchlist.signal_entry_expired` and `portfolio.watchlist.signal_entry_removed_untracked`) covering: scope and **known strictness** (the strict untracked removal also deletes live pre-feature-224 legacy-owner entries — remediation is a MANUAL re-add from the pasted REPORT and the `removed_untracked` events); authority (DBA change record + portfolio owner; REPORT reviewed before any APPLY; **never APPLY without a REPORT**); prerequisites (workstation, `DATABASE_URL` pooled `:25061` with `DB_PGBOUNCER=true`, trusted source, no DO-console sessions, the distroless image cannot run it, **preflight that the portfolio role can `SELECT` from `ingest.newsletter_signals`** — Execution Summary item 5); the exact commands (`go run ./cmd/server backfill-signal-expiry --mode=report --legacy-owner <SEED_USER_ID value from the db-migrator job>` then `--mode=apply … --expect-untracked N --expect-seed-expired M`); how to read REPORT (`NO_OWN_SIGNALS`, `legacy_live`, `seed_expired`); **no grace period — marks are due on the next tick (≤ 300 s by default, every restart ticks)**; emergency stop `DELETE FROM portfolio.watchlist_signal_expiry WHERE signal_id IS NULL` (marks only) or `TRUNCATE portfolio.watchlist_signal_expiry` (everything untracked; re-run the idempotent backfill to re-seed) **within one interval of APPLY**, raising the interval is **not** a pause, rolling portfolio back is the second line; the accepted residuals (signals outside the agent path / buy-sell never keep an entry alive; MANUAL add does not pin and a replace-all re-stamping MANUAL makes an entry permanently immune; a failed or deduplicated renewal add prunes early at the old expiry; add-then-prune of an already-expired signal; ledger event lost on a crash after commit — the pasted REPORT is the authoritative backfill record); deploy order proto → portfolio → agent → backfill.
2. **`docs/runbooks/CLAUDE.md`**: add the index row for the new runbook (key trigger: stale `source=SIGNAL` watchlist entries after signal expiry / backlog cleanup).
3. **`docs/runbooks/mcp-tools.md`**: extend `:224` and the `get_watchlist` entry with the expiry sentence (the literal word "expires" must appear in each) (same wording as the Step 17 docstrings); update `:254-255` rows (a provenance validation failure drops the auto-add with a WARN; `deduplicated: true` also does not renew expiry). Keep tool counts unchanged (45).
4. **Portfolio `CLAUDE.md`**: link `docs/runbooks/signal-watchlist-expiry-backfill.md` from the `backfill-signal-expiry` sentence added in Step 20 (the file now exists, so `check-context-map.sh` passes).
5. **`docs/patterns/ci-overview.md`**: add a `portfolio-db-test` row (Go real-Postgres tests, build tag `dbtest`, runs `go test -tags dbtest ./internal/repository/...` against the migrated TimescaleDB service; gated into `ci-gate`) in the same format as the `ledger-db-test` row, so the CI job matrix stays complete (root `CLAUDE.md` names this file as the job-matrix reference).
6. **Teardown (mandatory, root `CLAUDE.md`) — covers the files of Steps 20 and 21**: run `/context-forge:context-constitution refresh` scoped to them; if the plugin is unavailable, re-read each touched context file against the current code and record in the PR body both the unavailability and the reconciliation performed (a bare "plugin unavailable" does not pass; ledger `fails.md:670`).

**Verification**:
```bash
grep -n "signal_prune_interval_seconds" docs/runbooks/signal-watchlist-expiry-backfill.md
grep -n "signal_entry_expired" docs/runbooks/signal-watchlist-expiry-backfill.md && grep -n "signal_entry_removed_untracked" docs/runbooks/signal-watchlist-expiry-backfill.md
grep -n "signal-watchlist-expiry-backfill" docs/runbooks/CLAUDE.md && grep -n "signal-watchlist-expiry-backfill" services/xstockstrat-portfolio/CLAUDE.md && grep -n "portfolio-db-test" docs/patterns/ci-overview.md
awk '/^### `ingest_signal`/,/^### `emit_alert`/' docs/runbooks/mcp-tools.md | grep -q expires && awk '/^### `get_watchlist`/,/^### `manage_watchlist`/' docs/runbooks/mcp-tools.md | grep -q expires   # each section carries the word
bash scripts/check-context-map.sh
```
(every grep must hit; `check-context-map.sh` must pass.)

---

### Step 22 — test: premise evidence (FR-1 / AC-1) is recorded

**Status**: `pending`
**Service**: `docs/roadmap/features/281-signal-watchlist-expiry-pruning`
**Files**:
- `docs/roadmap/features/281-signal-watchlist-expiry-pruning/recon.md` — verify only (no edit expected)

**Reviewers**: none (a docs-evidence check; no service step)

**Codebase Evidence**:
- `recon.md` § Premise Verdict records the verdict table with `path:line` evidence for AC-1's behavior: no expiry/TTL/prune/sweep code touches watchlists, the only watchlist deletes are caller-driven (`DeleteWatchlist`/`RemoveWatchlistSymbols`/replace-all, `portfolio_service.go:2142,2195`, `watchlist_repo.go:268,312,210`), and a SIGNAL entry carries no link to its signal (`watchlist_symbols` schema; `portfolio.proto:243-249`; agent add at `tools.py:686-696`/`client.py:319-327`).
- Step 11/9 evidence in this spec confirms those caller-driven deletes are still the only pre-feature deleters.

**TDD**: N/A (evidence check; AC-1's `Then` clause is the recorded evidence, which is a doc property, not runtime behavior — runtime behavior "persists without pruning" is no longer true after Step 11 by design)

**Covers**: `AC-1` — "recon.md records the path:line evidence for that behavior".

**Instructions**:
1. Confirm the Premise Verdict table is present and cites `watchlist_repo.go`, `portfolio_service.go`, `migrations/007`, `tools.py` and `client.py` with line numbers.
2. If any cited line drifted during implementation, record the drift in `context.md` (do not edit `recon.md` — it is an immutable dossier).

**Verification**:
```bash
grep -n "Premise Verdict" docs/roadmap/features/281-signal-watchlist-expiry-pruning/recon.md
[ "$(grep -cE "watchlist_repo\.go|portfolio_service\.go|tools\.py|client\.py" docs/roadmap/features/281-signal-watchlist-expiry-pruning/recon.md)" -ge 4 ]
```
(the first prints the heading line; the second asserts at least 4 matching lines.)

---

## Deviation Log

_Populated by /sdd-execute as implementation proceeds._
