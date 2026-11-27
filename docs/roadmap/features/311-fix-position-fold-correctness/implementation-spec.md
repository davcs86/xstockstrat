# Implementation Spec: fix-position-fold-correctness

**Status**: `pending`
**Created**: 2026-11-20
**Feature**: `docs/roadmap/features/311-fix-position-fold-correctness/feature.md`
**Total Steps**: 29
**Feature Branch**: `feature/fix-position-fold-correctness`
**Severity**: SEV-2
**Re-spec**: 2026-11-26 — the operator ruling of 2026-11-21 (`context.md`, "operator rulings on cutover and CI scope") added Steps 21-22; the former Steps 21-27 are now Steps 23-29. Earlier `context.md` entries and `handoff-2026-11-20-sdd-batch-308-331.md` use the 27-step numbering.
**Tree**: service evidence was read from `origin/main-dev@fb52065c`. `origin/feature/fix-position-fold-correctness@66455c98` is 168 commits behind `main-dev` and differs from its merge base (`c4fd48b0`) only inside this feature directory, so after `/sdd-execute` BRANCH SYNC merges `main-dev` the service code is exactly the tree cited here. `recon.md` and `design.md` cite `c4fd48b0` line numbers; where they differ, the numbers below win.

---

## Execution Summary

The work runs in the design's build order (`design.md` § 5). Both migrations land first (Steps 1-2). Portfolio follows: the repository seam and floor (Steps 3-4), the keyed emit (Steps 5-6), the floor and `observed()` sentinels (Steps 7-8), the fill-path rewrite with the signed fold (Steps 9-10), the real-Postgres proof (Step 11) and the `GetPnL` composite key (Steps 12-13). Trading follows: broker not-found and the IBKR id match (Steps 14-15), the keyed ledger append (Steps 16-17), `trading.bracket_legs` persistence and `ActivateBracket` (Steps 18-20), their real-Postgres proof and the `trading-db-test` CI job (Steps 21-22, added by the operator ruling of 2026-11-21), the leg observer (Steps 23-24) and adoption with its throttle (Steps 25-27). The runbook and the service docs close the feature (Steps 28-29).

Consumer surfaces (C-14): the fix reaches users through `xstockstrat-ui` `/trader` positions and P&L and the `xstockstrat-agent` `get_positions` tool, which read the folded rows. The design decided that no ui or agent code changes (`design.md` § 6), so no step touches either service. Their acceptance suites were scanned by scenario title and by grep for `realized`, `position.closed`, `get_positions` and `short`; no scenario encodes the buggy fold. The one rule that reads this feature's output is ui `strategy-performance-dashboard.feature:48` (average return from the close event's `cost_basis`), which Step 9 preserves by keeping `closedPositionPayload`.

No proto, RPC, config key, env var or port is added, so there is no `proto` or `proto-gen` step. Step 22 is a `config`-category step for CI and lint configuration only; it adds no config key (the test-only `TRADING_DB_TEST_URL` is read by the Step 21 helper alone).

Design-gate check for the 2026-11-21 scope addition (C-11): Steps 21-22 add tests and a CI job over SQL the design already chose (D-14, D-20, D-37, D-40, D-41). They change no design decision, no `@AC-*` guarantee (C-16) and no Floor rule: F-06 is not touched (the job uses a throwaway CI container, not the shared cluster), F-07 is not touched (`TRADING_DB_TEST_URL` is a test input, not config), and F-08 holds because Step 21 lists every file it stages. The cutover ruling ("as designed") changes nothing.

## Scenario Coverage (C-15)

| Scenario | Covered by |
|---|---|
| `@AC-1` restart does not re-apply folded fills | Step 10 (pgxmock duplicate and below-floor), Step 11 (dbtest second boot) |
| `@AC-2` two processes apply one fill once | Step 11 (real-Postgres, two `PortfolioService` instances) |
| `@AC-3` a sell closes the position and seals realized | Step 10 |
| `@AC-4` take-profit leg fill reaches the ledger and realized | Step 24 (ledger event), Step 13 (`GetPnL` 100), Step 10 (fold), Step 21 (real-Postgres leg row) |
| `@AC-5` leg fills in two parts (amended wording, D-38) | Step 24 (partial 4, then filled 10 at 110), Step 13 (`GetPnL` 100), Step 10 (position 0), Step 21 (real-Postgres emit cursor 4 then 10) |

## Assumptions made by this spec

Each item is a choice the design left open or a fact found after the design was approved. None is an operator ruling. `/sdd-review impl-spec` and the operator can overturn any of them.

- **A-1 Tree.** This run did not merge `main-dev` into the feature branch: its task allowed edits only inside the feature directory. Evidence is from `origin/main-dev@fb52065c` (see **Tree** above).
- **A-2 Skipped payloads.** A fill payload with `qty == 0` or an empty `order_id`, `user_id` or `symbol` is skipped before any DB call and returns nil. Basis: `processOrderFill` already skips a payload it cannot use (`portfolio_service.go:374-375`), and the 294 `@AC-56` fixture delivers an `order.partially_filled` shape (`qty` 0) for `ord-56` ahead of its `order.filled` (`portfolio_telemetry_test.go:495-496`); if that event took the applied key, the real fill would count `acked` and `@AC-56`'s "4 ok" would break. The skip check lands in Step 9, together with the applied key it protects, not in Step 7: the existing `fillEvent` fixture carries no `order_id` (`portfolio_fill_errors_test.go:24-34`), so a skip in Step 7 would turn the three DB-error tests at `:67-109` red until Step 10 repairs the fixture.
- **A-3 `GetOrder` fallback cap.** D-11 says "capped" but no number is in `debate.md` (**Not found**). The spec uses a Go constant `legGetOrderFallbackCap = 5` per account per tick, following the constant precedent `appendMaxAttempts` (`trading.go:3935`).
- **A-4 IBKR leg status.** `alpacaStatusToProto` (`trading.go:3907`) matches only Alpaca's lowercase vocabulary, and IBKR passes `o.Status` through raw (`ibkr.go:443,479`). **Not found**: any IBKR status normaliser. Under D-19 an IBKR `Filled` would read as unrecognised and never emit, which fails the product spec's broker scope (C-2). The leg observer therefore lower-cases the broker status before mapping it. `Cancelled` (IBKR spelling) stays unrecognised and non-terminal, which is the safe side. If this is rejected, `@AC-4` and `@AC-5` hold for Alpaca only.
- **A-5 Trading repo dbtests (amended by the 2026-11-21 operator ruling).** The round-10 tests 8-9 are named "repo dbtest"; the first spec covered them with pgxmock only, because trading had no `dbtest` file and CI had no trading DB job (**Not found** then: `git ls-tree -r --name-only fb52065c services/xstockstrat-trading/internal/repository | grep -c dbtest` → 0; `grep -n 'TRADING_DB_TEST' .github/workflows/ci.yml` → nothing). The operator ruled "Add to 311's scope" (`context.md`, "operator rulings on cutover and CI scope"). Step 20 keeps its pgxmock SQL-shape tests in `trading_repo_test.go` as the fast unit layer. Step 21 adds the real-Postgres cases and Step 22 adds the CI job `trading-db-test`, so a wrong `UNION`, `DISTINCT ON`, sign or `ON CONFLICT` no longer passes unnoticed.
- **A-6 Floor failure.** "A stamp or load error keeps the consumer from starting" is implemented as a retry every `streamRetryDelay` (`portfolio_service.go:248`) until it succeeds or the context ends; no fill is consumed before it succeeds.
- **A-7 Broker call bound.** Leg `ListOrders` and `GetOrder` calls use `alpacaCallContext` (`trading.go:1476`), as the parent poll does at `:1866`. Feature 347 landed after recon; its `@AC-34` ("The fill poller does not stall on a throttled Alpaca account") is a PRESERVE the design did not see.
- **A-8 `bracket_legs` columns.** `design.md` § 2 lists the columns in short form. The spec adds `order_id`, `user_id`, `trading_mode` (round-8 synthesis: "the join fills every parent-derived column `ActivateBracket` writes") and `not_found_ticks` (round-4 synthesis, D-26). `resizeBracket` blanks the `order_brackets` leg ids (`trading.go:3721`), so a leg row must carry its own parent data to emit.
- **A-9 Orphans.** Step 9 leaves `PortfolioRepo.GetRealizedAccum`, `GetFeesAccum`, `ClosePosition` and `UpsertPosition` without a production caller. Step 9 deletes them and Step 10 re-points their tests.
- **A-10 Analysis consumer.** `services/xstockstrat-analysis/app/engine/pnl_pattern_consumer.py:48-49` consumes `order.filled` and `order.partially_filled`. Leg events will reach it with an `order_id` that is a broker leg id. The design does not cover this (O-30 lists only the AC ids). No step changes analysis; Step 29 records it in the trading findings. Checked on `origin/main-dev@fb52065c`: `_handle_order_event` (`pnl_pattern_consumer.py:348-404`) reads `order_id` with `payload.get("order_id", "")` and only stores it; `analysis.order_snapshots.order_id` is `TEXT NOT NULL` with no foreign key and no unique constraint (`migrations/016_order_snapshots_pnl_patterns.up.sql:12,25-26`), and the insert conflicts only on `(event_id, event_ts)`. The window key is `(user_id, account_id, symbol, trading_mode)`, not the order. An unknown `order_id` is therefore stored, not rejected. Residual: a leg fill that arrives when no window is open opens one, as any fill does today (`:388-402`); whether a leg fill can arrive after its position's close event was not checked.
- **A-11 Tick record for acked fills.** An acked fill goes through `consumerSignal.handled`, so the throttled "loop tick ok" record keeps flowing during boot replay.
- **A-12 Feature directory.** The task text names the directory with a doubled prefix; the real path is `docs/roadmap/features/311-fix-position-fold-correctness/`.
- **A-13 Leg side type.** `BracketLegParent.Side` is the leg's side as a `tradingv1.OrderSide`, the same type as `BracketLegRecord.Side`, so the repository writes both through `sideStr`. `oppositeSide` (`trading.go:3572-3577`) returns the broker wire string and is not passed to the repository. **Not found**: an existing function that returns a flipped `OrderSide` (`git grep 'func .*) tradingv1.OrderSide' services/xstockstrat-trading/internal` returns only `parseSide`, which is unexported in `repository`). Step 19 flips `order.Side` with the same rule as `oppositeSide`.
- **A-14 Tree for Steps 21-22.** Their evidence was read on `origin/main-dev@fb52065c`, the spec's tree, and re-checked against the tip `origin/main-dev@2b2dec92` (22 commits later). Every file Steps 21-22 cite is unchanged between the two: `.github/workflows/ci.yml`, `docs/patterns/ci-overview.md`, `scripts/db-migrate.sh`, `services/xstockstrat-trading/.golangci.yml`, `services/xstockstrat-trading/internal/repository/`, `internal/service/mtls_env_test.go`, and the portfolio and marketdata dbtest helpers (`git diff --stat fb52065c origin/main-dev -- <those paths>`). The only trading changes in that range are OpenTelemetry version bumps in `go.mod`, `go.sum` and `internal/telemetry/otel.go`.
- **A-15 Which trading SQL is new (operator-confirmed 2026-11-26).** The ruling's "fold / duplicate-guard SQL" means the repository-level `trading.bracket_legs` SQL; the operator answered "Yes, repository-level bracket_legs SQL (Recommended)" (`context.md`, session of 2026-11-26). The fold, the duplicate pre-check and the applied-row insert are portfolio SQL and are already proven on a real database by Step 11. Trading's own new SQL in 311 is the `trading.bracket_legs` family: the `ActivateBracket` transaction with its `ON CONFLICT DO NOTHING` duplicate guard, `ListTrackedLegs`, `ListAdoptionCandidates`, `InsertAdoptedLeg`, `RecordLegObservation`, `AdvanceLegEmit`, and the two reconciliation UNIONs. Step 21 covers exactly that family.
- **A-16 Repository-level cases only.** Step 21 and the job's `./internal/repository/...` pattern stop at the repository. A service-level trading dbtest would need the mTLS `TestMain` environment of `internal/service` (`mtls_env_test.go:22`), and every new SQL statement is in the repository package. Service behaviour stays covered by the fakes of Steps 20, 24 and 27.
- **A-17 Lint tag.** Step 22 adds `build-tags: [dbtest]` to trading's `.golangci.yml`, as portfolio's has (`:28-29`), so CI lints the Step 21 files. Marketdata's config has no such tag; that gap is not touched.

## Step Dependencies

- Steps 3+4 land together: the test references symbols Step 3 creates.
- Steps 5+6 land together: `emitEventAs` changes its signature and return shape; callers and the test change with it.
- Steps 7+8 land together: the test references `errFillAcked` and the floor field Step 7 creates. Step 7 does not add the A-2 skip class, so every existing fill test keeps its current DB path and Step 7's whole-package run stays green.
- Steps 9+10 land together: Step 9 adds the A-2 skip class, changes the SQL the fill path issues and deletes repo methods, which turns the existing fill tests red until Step 10 re-points them. Step 10 touches 8 files; it is not split, because Step 9 deletes the methods `portfolio_repo_test.go` and `position_drain_dbtest_test.go` call, so neither file compiles (`go vet -tags dbtest`) outside this unit.
- Steps 7 and 9 both edit the head of `processOrderFill` in `portfolio_service.go` and are not adjacent. Step 9 must re-read the function as Step 7 left it: the skip class goes after the stop-store update and directly before Step 7's floor check, and the floor check itself is not rewritten.
- Steps 12+13 land together: one behaviour change with its regression test.
- Steps 14+15 land together: the test references `broker.ErrOrderNotFound`.
- Steps 16+17 land together: `appendLedgerEvent` gains a required argument; the two test call sites change with it.
- Steps 18+19+20 land together: `BracketRepository` gains methods, so `fakeBracketRepo` stops compiling until Step 20 extends it; Step 19 is the only caller of `ActivateBracket`.
- Step 21 requires Step 18 (the methods and `RetiredLegStatuses`) and Step 2 (the table) and stands alone: it compiles and skips without a database, so it is not an atomic unit with Step 22. Step 22 requires Step 21 (its `-list` verification names the cases) and Step 2. The `trading-db-test` job (Step 22) is where Step 21's cases first run; both are test-only and neither is on the `ci-gate` path of another feature's steps.
- Step 22 edits the `ci-gate` `needs:` and echo lists of `.github/workflows/ci.yml` (after `marketdata-db-test`). Feature 318 (`implementation-ready`, its Step 9) appends `migration-order-gate` to the same two lists, and feature 324 (`implementation-ready`) checks `ci-gate` membership in its verification (both read from their implementation specs on `origin/main-dev@2b2dec92`). Textual overlap only, in adjacent lines; no migration, proto or config collision. Whichever merges second rebases; `/sdd-execute` re-reads those lines by job name, not by number.
- Steps 23+24 land together: `pollFills` gains a callee that dereferences `bracketRepo`, which breaks fixtures that leave it nil until Step 24 fixes them.
- Steps 25+26+27 land together: Step 26 is the only caller of the helper and state Step 25 adds, and Step 27 tests both.
- Step 1 must be applied before a portfolio image holding Step 3 or later runs. Step 2 must be applied before a trading image holding Step 18 or later runs. `scripts/db-migrate.sh` runs before deploy (PRE_DEPLOY migrator).
- Step 3 requires Step 1 (tables). Step 7 requires Step 3 (`EnsureFillFloor`). Step 9 requires Steps 3, 5 and 7.
- Step 11 [test] requires Steps 1, 3, 7 and 9, and is the second test step for Steps 3 and 9.
- Step 18 requires Step 2. Step 23 requires Steps 14, 16 and 18. Step 26 requires Steps 23 and 25.
- Step 13 covers the `GetPnL` half of `@AC-4` and `@AC-5`; it depends only on Step 12.
- Step 29 requires Steps 21 and 22: its `ci-overview.md` row names the job and the cases they add.
- Step 28 requires Steps 1-27: the runbook names the tables, log line and statuses they create.
- Migration numbers: portfolio `019` and trading `012` were free on `origin/main-dev@fb52065c` (max `018_watchlist_signal_expiry`, `011_offline_fees_snapshot_headers`). Feature 318 (`spec-ready`) adds no migration file; it is a CI ordering gate. `/sdd-execute` must re-run `ls services/xstockstrat-portfolio/migrations services/xstockstrat-trading/migrations` after BRANCH SYNC and renumber if either is taken. Other features' unmerged branches were not checked.
- Line numbers: every `file:line` in this spec is from `origin/main-dev@fb52065c`. A tree older than feature 347 lacks `alpacaCallContext` and `broker.ErrRateLimited` and has `processOrderFill` a few lines earlier, so these numbers do not match it. `broker.ErrOrderNotFound` exists on neither tree; Step 14 creates it. Hard step for `/sdd-execute`: after BRANCH SYNC, and before each step's edit, locate every cited site by symbol name; when a line number and a symbol disagree, the symbol wins and the difference goes in the Deviation Log.
- Consumer surfaces (C-14): `xstockstrat-ui` `/trader` and `xstockstrat-agent` `get_positions` get no step. They are read-only consumers of the folded rows (`design.md` § 6); this was verified by the acceptance-suite scan recorded in the Execution Summary. No follow-up feature is named because no change to either surface is planned.
- `merge-order.md:430` records a textual overlap on `trading.go` between 311, 312 and 321. Whichever merges second rebases. The impl-spec overlap scan also found same-file overlaps from product-spec evidence only: `portfolio_service.go` with 312 (the `alpaca-default` fallback at `:434-437`, the same lines Step 9 keeps), 315, 317 and 326; `trading.go` with 315 and 321; `trading_repo.go` with 321. None is a migration, proto or config collision. Step 9 keeps the `alpaca-default` fallback's behaviour, so if 312 merges first, Step 9 builds `acctID` on 312's version of those lines.
- Gating preconditions for `/sdd-execute`:
  - `context.md` is far over the 65536-byte limit, so `/sdd-distill fix-position-fold-correctness` must run before the first step.
  - The adoption-only throttle (D-50) was an orchestrator assumption. The operator confirmed it on 2026-11-21 (`context.md`, "operator ruling on D-50"), so the Step 25 gate is cleared and Steps 25-27 may run.
- Integration: the cutover (Step 28's runbook) runs at the first deploy of a post-`019` portfolio image to each staging target, with "portfolio stopped, `T_stop` recorded, `main-dev` frozen" as a checklist item in the integration PR body. Production is check-only before the first promotion. The O-61 operator confirmations (`design.md` § Open Risks) are answered before that step.
- C-16 promotion of the EXTEND and CHANGE scenarios (`design.md` § Business Rules Touched) happens at integration through `/sdd-execute`'s promotion step, read from `origin/feature/fix-position-fold-correctness` (fails.md 2026-11-18, feature 359).

---

### Step 1 — migration: portfolio `019_fill_applied_events`

**Status**: `done`
**Service**: `xstockstrat-portfolio`
**Files**:
- `services/xstockstrat-portfolio/migrations/019_fill_applied_events.up.sql` — create
- `services/xstockstrat-portfolio/migrations/019_fill_applied_events.down.sql` — create

**Reviewers**: DBA — migration NNN numbering, up+down pair, index correctness; xstockstrat-portfolio owner — concurrent write safety

**Codebase Evidence**:
- Confirmed via: `git ls-tree --name-only origin/main-dev services/xstockstrat-portfolio/migrations/` → last file `018_watchlist_signal_expiry.{up,down}.sql`.
- Existing pattern: `018_watchlist_signal_expiry.up.sql:1-2` header (`-- Migration: …` / `-- Service: xstockstrat-portfolio — feature NNN: …`), `CREATE TABLE IF NOT EXISTS portfolio.…`, and a `.down.sql` of `DROP TABLE IF EXISTS`.
- **Not found**: any applied-event or floor table in `services/xstockstrat-portfolio/migrations/`.

**TDD**: `N/A (migration)`

**Covers**: —

**Instructions**:
1. Re-check that `019` is still the next free number (see Step Dependencies).
2. `.up.sql`, additive only (F-01), with the `018` header style:
   - `CREATE TABLE IF NOT EXISTS portfolio.consumer_applied_events` with `consumer TEXT NOT NULL`, `user_id TEXT NOT NULL`, `account_id TEXT NOT NULL`, `order_id TEXT NOT NULL`, `event_id TEXT NOT NULL`, `outcome TEXT NOT NULL CHECK (outcome IN ('applied','parked'))`, `parked_reason TEXT`, `pending_closed JSONB`, `applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`, `PRIMARY KEY (consumer, user_id, account_id, order_id)` (D-1, D-8, D-9, D-31).
   - `CREATE TABLE IF NOT EXISTS portfolio.consumer_floors (consumer TEXT PRIMARY KEY, floor_recorded_at TIMESTAMPTZ NOT NULL)` (D-35).
3. The migration writes no row into either table (R-2). It creates no trigger and no other table (D-34).
4. `.down.sql`: `DROP TABLE IF EXISTS portfolio.consumer_floors;` and `DROP TABLE IF EXISTS portfolio.consumer_applied_events;`.
5. A migration stays in its own schema: both tables are in `portfolio`.

**Verification**:
```bash
ls services/xstockstrat-portfolio/migrations/019_fill_applied_events.up.sql services/xstockstrat-portfolio/migrations/019_fill_applied_events.down.sql
ls services/xstockstrat-portfolio/migrations/ | grep -c '^019_'   # 2
grep -ci 'insert into\|create trigger' services/xstockstrat-portfolio/migrations/019_fill_applied_events.up.sql   # 0
# read both files: each CREATE TABLE in .up has a DROP TABLE in .down
```

---

### Step 2 — migration: trading `012_bracket_legs`

**Status**: `done`
**Service**: `xstockstrat-trading`
**Files**:
- `services/xstockstrat-trading/migrations/012_bracket_legs.up.sql` — create
- `services/xstockstrat-trading/migrations/012_bracket_legs.down.sql` — create

**Reviewers**: DBA — migration NNN numbering, up+down pair, index correctness; xstockstrat-trading owner — fill detection

**Codebase Evidence**:
- Confirmed via: `git ls-tree --name-only origin/main-dev services/xstockstrat-trading/migrations/` → last file `011_offline_fees_snapshot_headers.{up,down}.sql`.
- `005_broker_accounts_halted.up.sql:12-26`: `trading.order_brackets` has `order_id UUID`, `account_id TEXT`, `status SMALLINT` (3 = ACTIVE, 4 = CANCELING), `stop_leg_order_id TEXT`, `take_profit_leg_order_id TEXT`. Its only indexes are on `order_id` (`:27`) and a partial one on `protection_deadline WHERE status IN (0,1,2,4)` (`:29-31`).
- `001_orders_hypertable.up.sql:11`: `side TEXT NOT NULL CHECK (side IN ('buy','sell'))`; `:15` `filled_qty NUMERIC(18,8)`; `:20` `trading_mode TEXT`.

**TDD**: `N/A (migration)`

**Covers**: —

**Instructions**:
1. Re-check that `012` is still the next free number.
2. `.up.sql` is DDL only, with no seed `INSERT` (D-39). `CREATE TABLE IF NOT EXISTS trading.bracket_legs` with:
   - `account_id TEXT NOT NULL`, `leg_order_id TEXT NOT NULL`, `PRIMARY KEY (account_id, leg_order_id)` (D-7).
   - `order_id UUID NOT NULL` (the parent order), `user_id TEXT NOT NULL`, `trading_mode TEXT NOT NULL` (A-8).
   - `symbol TEXT NOT NULL`, `side TEXT NOT NULL CHECK (side IN ('buy','sell'))` (D-37; the same encoding `trading.orders.side` uses).
   - `filled_qty NUMERIC(18,8) NOT NULL DEFAULT 0` with a comment that it is the emit cursor.
   - `observed_filled_qty NUMERIC(18,8) NOT NULL DEFAULT 0` with a comment that it is written on every observation and read by reconciliation.
   - `status TEXT NOT NULL DEFAULT 'OPEN'`. Do not add a `CHECK` on status: the retired-status set is one Go constant (Step 18), and a second list in SQL would drift.
   - `not_found_ticks SMALLINT NOT NULL DEFAULT 0` (D-26).
   - `adopted BOOLEAN NOT NULL DEFAULT false`, with the DDL comment that its only reader is the `GetOrder` fallback sort (D-39, O-66).
   - `created_at` and `updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`.
3. Add no index beyond the primary key. Scan cost, stated as the design asked: the adoption candidate query (Step 18) reads every `order_brackets` row with status 3 or 4 on each fill-poller tick. Status 3 is not covered by the `005` partial index, so this is one sequential scan of `order_brackets` per tick, plus a primary-key probe into `bracket_legs` per leg id and an `order_id` lookup into `trading.orders` per surviving row. `order_brackets` holds one row per auto-sized entry. A partial index was weighed in round 11 and not chosen.
4. `.down.sql`: `DROP TABLE IF EXISTS trading.bracket_legs;`.

**Verification**:
```bash
ls services/xstockstrat-trading/migrations/012_bracket_legs.up.sql services/xstockstrat-trading/migrations/012_bracket_legs.down.sql
ls services/xstockstrat-trading/migrations/ | grep -c '^012_'   # 2
grep -ci 'insert into' services/xstockstrat-trading/migrations/012_bracket_legs.up.sql   # 0
# read both files: the CREATE TABLE in .up has a DROP TABLE in .down
```

---

### Step 3 — service: portfolio fill-apply repository seam and floor

**Status**: `done`
**Service**: `xstockstrat-portfolio`
**Files**:
- `services/xstockstrat-portfolio/internal/repository/fill_apply_repo.go` — create

**Reviewers**: xstockstrat-portfolio owner — concurrent write safety, position snapshot consistency

**Codebase Evidence**:
- `internal/repository/portfolio_repo.go:23-27`: `queryRower` has `QueryRow`, `Query`, `Exec` and no `Begin`. `:30-35` `PortfolioRepo{pool; db queryRower}`. `:50` `NewPortfolioRepoWithDB(db queryRower)` leaves `pool` nil, and the service dbtests build the repo this way over a real pool (`internal/service/position_drain_dbtest_test.go:54`), so the transaction must start from `r.db`, not `r.pool`.
- `internal/repository/pool.go:29-31`: `DB_PGBOUNCER` switches to `QueryExecModeExec`; only a transaction-scoped lock is safe.
- `portfolio_repo.go:62-70`: the position row's write columns and the conflict target `(user_id, symbol, trading_mode, account_id)`.
- Existing transactions in `internal/repository/` all start from `r.pool` or a `*pgxpool.Pool` argument, never from `r.db`: `watchlist_repo.go:39,194,301,325,350,388` and `signal_expiry_repo.go:62`, `delisted_removal_repo.go:76` (`r.pool.Begin`), `signal_expiry_backfill.go:131,229` (`pool.BeginTx`). Row locks exist only as `FOR UPDATE SKIP LOCKED` (`signal_expiry_repo.go:90,152`, `delisted_removal_repo.go:118`). `portfolio_repo.go` has no `Begin`. **Not found**: `pg_advisory` anywhere in `internal/repository/`.

**Lands with**: `Step 4`

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
Create `fill_apply_repo.go` in package `repository`. Leave `queryRower` unchanged (R-22).
1. `type txBeginner interface { Begin(ctx context.Context) (pgx.Tx, error) }`. `ApplyFill` obtains it with a type assertion on `r.db`; a `db` without `Begin` returns an error. `*pgxpool.Pool` and pgxmock's pool both have `Begin`.
2. `FillKey{Consumer, UserID, AccountID, OrderID string}` and the constant `ConsumerOrderFill = "order_fill"`. `AccountID` is the value after the `alpaca-default` fallback (D-8).
3. `FillApplied(ctx, key) (*AppliedFill, error)`: one autocommit `SELECT event_id, outcome, pending_closed::text FROM portfolio.consumer_applied_events WHERE` the four key columns. No row returns `(nil, nil)`. `AppliedFill{EventID, Outcome string; PendingClosed *string}`.
4. `ApplyFill(ctx, key, eventID string, pos PositionKey, fold FoldFn) (*FillResult, error)`, one `pgx.Tx`, in this order (D-1, D-23):
   1. `INSERT INTO portfolio.consumer_applied_events (…, outcome) VALUES (…, 'applied') ON CONFLICT DO NOTHING`. Zero rows affected: roll back and return the sentinel `ErrFillAlreadyApplied`.
   2. `SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, with `$1` the string `user_id|symbol|trading_mode|account_id`.
   3. One `SELECT qty, avg_entry_price, cost_basis, realized_accum, fees_accum, opened_at FROM portfolio.positions WHERE … FOR UPDATE`. No row means no position.
   4. Call `fold(existing)`. `FoldFn` is pure: it takes the locked row (or nil) and returns a `FoldOutcome` that names the write (upsert with absolute `qty`, `avg_entry_price`, `cost_basis`, `realized_accum`, `fees_accum`; delete; or delete then insert a fresh row for a flip) and an optional `PendingClosed` JSON string.
   5. Apply the write. The upsert sets `realized_accum` and `fees_accum` to the absolute values the fold returned; it does not add to the stored value.
   6. When `PendingClosed` is set, `UPDATE portfolio.consumer_applied_events SET pending_closed = $5::jsonb` on the key. Bind the JSON as `string`, never `[]byte` (`recon.md:87`).
   7. `COMMIT`. Any error rolls back and is returned wrapped.
5. `ClearPendingClosed(ctx, key) error`: `UPDATE … SET pending_closed = NULL WHERE` the four key columns `AND pending_closed IS NOT NULL` (D-33).
6. `ParkFill(ctx, key, eventID, reason string) (inserted bool, err error)`: autocommit `INSERT … (outcome, parked_reason) VALUES ('parked', $6) ON CONFLICT DO NOTHING RETURNING consumer`; `pgx.ErrNoRows` means `inserted = false` (D-31).
7. `EnsureFillFloor(ctx) (floor time.Time, stampedNow bool, err error)`: `INSERT INTO portfolio.consumer_floors (consumer, floor_recorded_at) VALUES ('order_fill', date_trunc('milliseconds', clock_timestamp())) ON CONFLICT DO NOTHING`, with `stampedNow` from rows affected, then `SELECT floor_recorded_at … WHERE consumer = 'order_fill'` (D-35). Only `order_fill` is supported; add no generic floor API (C-18).
8. Comments: at most two lines, constraints only.

**Verification**:
```bash
cd services/xstockstrat-portfolio && GOWORK=off go build ./... && GOWORK=off go vet -tags dbtest ./...
cd services/xstockstrat-portfolio && GOWORK=off golangci-lint run --modules-download-mode=mod
grep -n 'Begin' services/xstockstrat-portfolio/internal/repository/portfolio_repo.go   # no new line: queryRower unchanged
```

---

### Step 4 — test: fill-apply repository (pgxmock)

**Status**: `done`
**Service**: `xstockstrat-portfolio`
**Files**:
- `services/xstockstrat-portfolio/internal/repository/fill_apply_repo_test.go` — create

**Reviewers**: xstockstrat-portfolio owner — concurrent write safety

**Codebase Evidence**:
- `internal/repository/portfolio_repo_test.go:1` is `package repository` and builds repos with `pgxmock.NewPool()` and `NewPortfolioRepoWithDB`.
- pgxmock v4 supports `ExpectBegin`, `ExpectCommit` and `ExpectRollback` (`recon.md:140`).

**Lands with**: `Step 3`

**TDD**: `red-green required`

**Covers**: — (repo-level; the `@AC` scenarios are covered at the service and dbtest steps)

**Instructions**:
Write pgxmock tests that fail to compile before Step 3 and assert, with ordered expectations:
1. `ApplyFill` new fill: Begin, applied INSERT (1 row), advisory lock, `FOR UPDATE` read, the write, Commit, in that order.
2. `ApplyFill` INSERT conflict (0 rows): Rollback, `ErrFillAlreadyApplied`, and no advisory lock, read or write.
3. `ApplyFill` with `PendingClosed` set: the `pending_closed` UPDATE runs inside the transaction and its argument is a Go `string`.
4. `ApplyFill` when the fold's write fails: Rollback and a wrapped error.
5. `ApplyFill` over a `db` with no `Begin`: an error, no panic.
6. `FillApplied`: no row gives `(nil, nil)`; a DB error is returned.
7. `ParkFill`: a returned row gives `inserted = true`; `pgx.ErrNoRows` gives `false, nil`; another error is returned.
8. `ClearPendingClosed`: the SQL holds `pending_closed IS NOT NULL` and all four key columns.
9. `EnsureFillFloor`: first call `stampedNow = true`; a conflict gives `false` and the stored value; an INSERT or SELECT error is returned.

C-13: the key and row literals have one consumer (this file), so they stay inline.

**Verification**:
```bash
cd services/xstockstrat-portfolio && GOWORK=off go test ./internal/repository/ -race -count=1 -run 'ApplyFill|FillApplied|ParkFill|ClearPendingClosed|EnsureFillFloor'
cd services/xstockstrat-portfolio && GOWORK=off golangci-lint run --modules-download-mode=mod
cd services/xstockstrat-portfolio && GOWORK=off COVERPKGS=$(go list ./... | grep -Ev '/(cmd|handler|repository|telemetry|service)(/|$)' | tr '\n' ',' | sed 's/,$//') && go test ./... -race -count=1 -coverprofile=coverage.out -covermode=atomic -coverpkg="${COVERPKGS}" && go tool cover -func=coverage.out | grep "^total:"   # >= 40%
```
New logic is in an excluded package (`repository`) — no coverage threshold applies to it; the whole-service figure must still be at least 40%.

---

### Step 5 — service: portfolio `emitEventAs` returns an error and takes a key

**Status**: `done`
**Service**: `xstockstrat-portfolio`
**Files**:
- `services/xstockstrat-portfolio/internal/service/portfolio_service.go` — modify
- `services/xstockstrat-portfolio/internal/service/signal_prune.go` — modify

**Reviewers**: xstockstrat-portfolio owner — position snapshot consistency

**Codebase Evidence**:
- `portfolio_service.go:1374-1376` `emitEvent` calls `s.emitEventAs(ctx, "", eventType, streamKey, payload)`.
- `:1379` `func (s *PortfolioService) emitEventAs(ctx, ownerUserID, eventType, streamKey string, payload map[string]interface{})` has no return value; `:1393` sets `IdempotencyKey: uuid.NewString()`; `:1399-1415` retry loop; `:1416` WARN "ledger append failed".
- `:1353-1372` `emitRiskAlert(ctx, userID, eventType, extra, msg)` calls `s.emitEventAs(ctx, userID, eventType, "portfolio:risk", payload)` at `:1360`, then `s.notify.EmitAlert`; its callers are `checkRiskLimits` (`:1338`, `:1347`) and `portfolio_quote_deadline_test.go:620`.
- Call sites, from `grep -rn 'emitEventAs(' services/xstockstrat-portfolio --include=*.go`: `portfolio_service.go:1360` (`emitRiskAlert`), `portfolio_service.go:1375` (`emitEvent`), `signal_prune.go:60`, `signal_prune.go:70`. No test calls it directly.

**Lands with**: `Step 6`

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. Change the signature to `emitEventAs(ctx, ownerUserID, eventType, streamKey, idempotencyKey string, payload map[string]interface{}) error` (D-21). An empty `idempotencyKey` keeps today's `uuid.NewString()`. Return the last error; return `ctx.Err()` where the loop returns on `ctx.Done()`. Keep the WARN at `:1416`.
2. `emitEvent` stays the fail-soft wrapper: it passes `""` for the key and discards the error.
3. `signal_prune.go:60` and `:70`, and `emitRiskAlert` at `portfolio_service.go:1360`: pass `""` for the key and discard the error (`_ =`), so their behaviour is unchanged (`emitRiskAlert` still calls `EmitAlert` after the append).
4. Do not change any other emit site in this step.

**Verification**:
```bash
cd services/xstockstrat-portfolio && GOWORK=off go build ./... && GOWORK=off go vet -tags dbtest ./...
grep -rn 'emitEventAs(' services/xstockstrat-portfolio --include=*.go   # every call passes six arguments
cd services/xstockstrat-portfolio && GOWORK=off golangci-lint run --modules-download-mode=mod
```

---

### Step 6 — test: keyed emit and its error return

**Status**: `done`
**Service**: `xstockstrat-portfolio`
**Files**:
- `services/xstockstrat-portfolio/internal/service/portfolio_emit_key_test.go` — create

**Reviewers**: xstockstrat-portfolio owner — position snapshot consistency

**Codebase Evidence**:
- `internal/service/watchlist_service_test.go:356-369`: `fakeLedger` records `reqs []*ledgerv1.AppendEventRequest` and returns its `err` field.

**Lands with**: `Step 5`

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
Using the existing `fakeLedger`:
1. A non-empty key reaches `AppendEventRequest.IdempotencyKey` unchanged.
2. An empty key yields a non-empty generated key, and two calls yield different keys.
3. A ledger error is returned by `emitEventAs` and swallowed by `emitEvent`.
4. A success returns nil.

**Verification**:
```bash
cd services/xstockstrat-portfolio && GOWORK=off go test ./internal/service/ -race -count=1 -run 'EmitEventAs|EmitEvent_'
cd services/xstockstrat-portfolio && GOWORK=off go test ./internal/service/ -race -count=1 -run 'Prune'   # signal_prune callers still pass
cd services/xstockstrat-portfolio && GOWORK=off golangci-lint run --modules-download-mode=mod
```
New logic is in an excluded package (`service`) — no coverage threshold applies.

---

### Step 7 — service: fill floor at boot and `observed()` sentinels

**Status**: `done`
**Service**: `xstockstrat-portfolio`
**Files**:
- `services/xstockstrat-portfolio/internal/service/portfolio_service.go` — modify

**Reviewers**: xstockstrat-portfolio owner — concurrent write safety, position snapshot consistency

**Codebase Evidence**:
- `portfolio_service.go:178-180` `ConsumeOrderFills` wraps the handler as `s.observed("order fill", "ok", s.processOrderFill)`; it does not use `boundedRetry`.
- `:234-245` `observed` counts `"error"` and returns the error, or calls `sig.handled(ctx, okOutcome, …)`.
- `:1550` `boundedRetry`; `:1582-1584`: it logs `slog.ErrorContext(ctx, "event parked", "event_id", …, "sequence", …, "stream_key", …, "consumer", …, "attempts", …, "error", err)` and counts `"parked"`.
- `:975` `ErrFillUnattributable`; `:929` `ErrLedgerUnavailable`.
- `:376-397` `processOrderFill` parses the payload before any DB call. `:248` `streamRetryDelay`; `:253` `sleepFor`.
- `packages/proto/ledger/v1/ledger.proto:30`: `LedgerEvent.recorded_at` is the server write time.
- Other consumers keep boot replay from 0 (`:1477`, `:1489`, `:1743`, `:1791`); this step does not touch them (290 `@AC-3`).

**Lands with**: `Step 8`

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. Add the unexported sentinel `errFillAcked` and a `fillFloor time.Time` field on `PortfolioService`. The zero value folds everything, so struct-literal test fixtures keep working.
2. `ConsumeOrderFills`: before `consumeEventStream`, call `s.repo.EnsureFillFloor(ctx)` (Step 3). On error log ERROR and retry after `s.sleepFor(streamRetryDelay)` until it succeeds or `ctx` is done (A-6); never start the stream without a floor. On success set `s.fillFloor` and log INFO `order fill floor loaded` with `floor` and `stamped_now`. The cutover runbook (Step 28) records this line.
3. `processOrderFill`, directly after the payload parse and the stop-store update (`:393-397`):
   - Floor (D-35): when `event.GetRecordedAt().AsTime().Before(s.fillFloor)`, return `errFillAcked` with zero DB calls. A fill in the floor's own millisecond is not before it, so it folds.
4. `observed()`: handle the fill consumer's sentinels in place (D-12):
   - `errors.Is(err, errFillAcked)`: `sig.handled(ctx, "acked", start, s.clock())` and return nil (A-11).
   - `errors.Is(err, ErrFillUnattributable)`: log ERROR `event parked` with the `boundedRetry` field set (`attempts` = 1), `sig.count(ctx, "parked")`, return nil.
   - Every other error: unchanged.
5. Do not change `boundedRetry`, `consumeEventStream` or `streamEventsFrom`.
6. Do not add the A-2 skip class here; it lands in Step 9. A payload with no `order_id` keeps its current path in this step, so `portfolio_fill_errors_test.go:67-109` still sees `errDBBlip`.

**Verification**:
```bash
cd services/xstockstrat-portfolio && GOWORK=off go build ./... && GOWORK=off go vet -tags dbtest ./...
cd services/xstockstrat-portfolio && GOWORK=off go test ./internal/service/ -race -count=1   # existing suite still green
cd services/xstockstrat-portfolio && GOWORK=off golangci-lint run --modules-download-mode=mod
```

---

### Step 8 — test: floor and sentinel handling

**Status**: `done`
**Service**: `xstockstrat-portfolio`
**Files**:
- `services/xstockstrat-portfolio/internal/service/portfolio_fill_floor_test.go` — create
- `services/xstockstrat-portfolio/internal/testdata/ledger.go` — modify

**Reviewers**: xstockstrat-portfolio owner — concurrent write safety

**Codebase Evidence**:
- `internal/testdata/ledger.go:99-108` `orderEvent` sets `EventId`, `EventType`, `StreamKey`, `Sequence` and `Payload` but no `RecordedAt`; `:122` `FilledEvent(seq, orderID, userID, symbol, accountID, mode, qty, price, side)`. This is the service's canonical fixture home (C-13).
- `internal/service/portfolio_fill_errors_test.go:56-65` `newFillSvc` builds a service over pgxmock; pgxmock fails any unexpected query, which gives the zero-DB-call assertion.
- `internal/service/portfolio_telemetry_test.go:509-546`: the 294 `@AC-56` harness (`runOrderFillBatch`, `consumerEvents`, `recordLogs`).

**Lands with**: `Step 7`

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. `testdata/ledger.go`: add one helper that returns a copy of an event with `RecordedAt` set. The fixture has several consumers from this step on, so it lives in the canonical home.
2. Tests:
   - Below floor: a fill recorded one millisecond before `fillFloor` returns `errFillAcked` and pgxmock sees no query; the ledger fake sees no append.
   - Same millisecond: a fill recorded at exactly `fillFloor` is not acked by the floor check.
   - `observed()` with a handler returning `errFillAcked`: counter `{order_fill, acked}` is 1, the result is nil, and a tick record is written.
   - `observed()` with a handler returning a wrapped `ErrFillUnattributable`: one ERROR `event parked` with `event_id`, `sequence`, `stream_key`, `consumer`; counter `{order_fill, parked}` is 1; result nil.
   - `observed()` with any other error: `{order_fill, error}` and the error is returned.
   - Floor boot: `ConsumeOrderFills` with a repo whose floor INSERT fails does not open the stream (the ledger fake's `StreamEvents` count stays 0) until the floor loads; a second boot keeps the first floor.
3. Run the existing `TestOrderFillConsumer_AC56_OneTickRecordPerBatch` unchanged: it must still count 4 `ok` (294 `@AC-56` PRESERVE).

**Verification**:
```bash
cd services/xstockstrat-portfolio && GOWORK=off go test ./internal/service/ -race -count=1 -run 'FillFloor|Observed|AC56'
cd services/xstockstrat-portfolio && GOWORK=off golangci-lint run --modules-download-mode=mod
grep -rn 'RecordedAt' services/xstockstrat-portfolio/internal --include=*_test.go | grep -v testdata   # no second inline builder
```
New logic is in an excluded package — no coverage threshold applies.

---

### Step 9 — service: exactly-once, signed fill path

**Status**: `done`
**Service**: `xstockstrat-portfolio`
**Files**:
- `services/xstockstrat-portfolio/internal/service/portfolio_service.go` — modify
- `services/xstockstrat-portfolio/internal/repository/portfolio_repo.go` — modify

**Reviewers**: xstockstrat-portfolio owner — P&L calculation accuracy, concurrent write safety

**Codebase Evidence**:
- `portfolio_service.go:399-405` takes `positionsMu`; `:409` `s.repo.GetPosition` (non-transactional); `:421-434` unsigned add with `if fill.Qty > 0 { // buying more` (`:423`); `:436-439` `alpaca-default` fallback (`:438`); `:445` `pnl.RealizedDelta`; `:448-471` close branch with `GetRealizedAccum` (`:455`), `GetFeesAccum` (`:460`), `ClosePosition` (`:466`) and the `portfolio.position.closed` emit (`:469-470`); `:472` `UpsertPosition`; `:485-488` unlock, then `checkRiskLimits` and `broadcastSnapshot`.
- `:494-506` `closedPositionPayload` is the producer contract (`services/xstockstrat-portfolio/docs/position-closed-contract.md`); base keys must not change (029 `@AC-10`, 042, ui `strategy-performance-dashboard.feature:48`).
- `:1068-1077` `signedQty(side, qty)`; `:1080-1110` `orderSide(ctx, orderID)` returns `ErrFillUnattributable` or a wrapped `ErrLedgerUnavailable`.
- `packages/proto/pnl/pnl.go:54` `FoldFrom(baseline map[string]Lot, fills []Fill) FoldResult`; `:80-92` handles a flip through zero; `:43` `QtyEpsilon`.
- Lock sites that stay: `:1610-1611` (`processAccountDeregistered`), `:1657-1658` (`processPositionSync`).
- Remaining callers, from `grep -rn '\.UpsertPosition(\|\.ClosePosition(\|\.GetRealizedAccum(\|\.GetFeesAccum(' services/xstockstrat-portfolio --include=*.go`: the four fill-path lines above, `portfolio_repo_test.go:113,137` (`GetFeesAccum`) and `position_drain_dbtest_test.go:67` (`UpsertPosition`, a seed).

**Lands with**: `Step 10`

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
Trading-domain notes: both brokers reach this path through the same `order.filled` payload, so broker type is not branched on. The fold does not branch on paper or live (C-3). Order type handling is unaffected. Fill state: the live consumer folds `order.filled` only; `order.partially_filled` stays out of the live fold as today, and a leg's `order.filled` carries the leg total (D-38).

Skip class (A-2), added first: after the stop-store update and directly before the Step 7 floor check, `fill.Qty == 0` or an empty `OrderID`, `UserID` or `Symbol` returns nil with a WARN, before any DB call. Leave the Step 7 floor check as it is.

Then rewrite `processOrderFill` after the Step 7 floor check, in this order (D-23, D-31):
1. Resolve `acctID` with the `alpaca-default` fallback and build `repository.FillKey{ConsumerOrderFill, fill.UserID, acctID, fill.OrderID}`.
2. Pre-check, with no transaction and no `positionsMu`: `s.repo.FillApplied(ctx, key)`.
   - A DB error is returned; it never falls through (D-33).
   - Hit, outcome `applied`, `PendingClosed` set: re-emit `portfolio.position.closed` from the stored JSON through `emitEventAs` with key `position.closed:<STORED event_id>` (D-13, R-8). On nil, `ClearPendingClosed`; a failed clear is a WARN only. Return `errFillAcked`.
   - Hit, outcome `parked`: DEBUG log and `errFillAcked`.
   - Any hit: no risk check, no snapshot and no other `position.*` emit (R-9).
3. Side: use `fill.Side`, else `s.orderSide(ctx, fill.OrderID)`. Then `signedQty(side, math.Abs(fill.Qty))`.
   - `ErrFillUnattributable`, or `signedQty` not ok: `s.repo.ParkFill(ctx, key, event.EventId, reason)`. A park-insert error is returned. `inserted` true returns an error wrapping `ErrFillUnattributable` (Step 7 logs and counts it once); `inserted` false returns `errFillAcked`.
   - `ErrLedgerUnavailable`: return the error. The stream reconnects from this event; nothing is parked.
4. `s.positionsMu.Lock()`, then `s.repo.ApplyFill(ctx, key, event.EventId, posKey, foldFn)`, then `Unlock`. The lock comes before `BEGIN` (D-17 as reopened; R-18).
   - `ErrFillAlreadyApplied` returns `errFillAcked` with no emit (the process that committed owns the emit).
   - Another error is returned wrapped.
5. `foldFn` is pure and reads only the row `ApplyFill` hands it (D-32):
   - Seed `pnl.FoldFrom` with `{sym: Lot{Qty, CostBasis}}` from the row (empty when there is none) and one `pnl.Fill{Qty: signed, Price: fill.FillPrice}`.
   - Result lot absent (flat): delete the row; `sealed = row.realized_accum + result.Realized`, `feesSealed = row.fees_accum + fill.Fees`; set `PendingClosed` to the JSON of `closedPositionPayload(...)`.
   - Result lot has the same sign as the row, or there was no row: upsert with `qty`, `cost_basis`, `avg_entry_price = cost_basis / qty`, `realized_accum = row.realized_accum + result.Realized`, `fees_accum = row.fees_accum + fill.Fees`.
   - Result lot has the opposite sign (flip, D-10): delete the long row with `PendingClosed` sealed as above, then insert a fresh row for the remainder with `realized_accum` 0 and `fees_accum` 0.
6. After `Unlock` (D-24):
   - Close or flip: emit `portfolio.position.closed` through `emitEventAs` with key `position.closed:<event_id>`; on nil call `ClearPendingClosed` (failed clear = WARN).
   - Flip: then emit `portfolio.position.opened` for the new row.
   - Otherwise emit `portfolio.position.opened` (no prior row) or `portfolio.position.updated`, through fail-soft `emitEvent` as today.
   - Then `checkRiskLimits` and `broadcastSnapshot`.
7. Keep `positionsMu`, its comment and the two other lock sites (D-5). Do not change `.do/app.yaml`.
8. `portfolio_repo.go`: delete `GetRealizedAccum`, `GetFeesAccum`, `ClosePosition` and `UpsertPosition`, which this step leaves without a production caller (A-9).

**Verification**:
```bash
cd services/xstockstrat-portfolio && GOWORK=off go build ./... && GOWORK=off go vet -tags dbtest ./...
grep -n 'GetRealizedAccum\|GetFeesAccum\|ClosePosition\|UpsertPosition(' services/xstockstrat-portfolio/internal --include=*.go -r | grep -v _test   # none
grep -n 'fill.Qty > 0' services/xstockstrat-portfolio/internal/service/portfolio_service.go   # none
grep -n 'instance_count' .do/app.yaml | head -3   # unchanged
cd services/xstockstrat-portfolio && GOWORK=off golangci-lint run --modules-download-mode=mod
```

---

### Step 10 — test: fill-path regression suite (pgxmock)

**Status**: `done`
**Service**: `xstockstrat-portfolio`
**Files**:
- `services/xstockstrat-portfolio/internal/service/portfolio_fill_fold_test.go` — create
- `services/xstockstrat-portfolio/internal/service/portfolio_fill_errors_test.go` — modify
- `services/xstockstrat-portfolio/internal/service/portfolio_fill_sync_race_test.go` — modify
- `services/xstockstrat-portfolio/internal/service/portfolio_helpers_test.go` — modify
- `services/xstockstrat-portfolio/internal/service/portfolio_telemetry_test.go` — modify
- `services/xstockstrat-portfolio/internal/service/portfolio_offline_test.go` — modify
- `services/xstockstrat-portfolio/internal/service/position_drain_dbtest_test.go` — modify
- `services/xstockstrat-portfolio/internal/service/portfolio_fill_floor_test.go` — modify
- `services/xstockstrat-portfolio/internal/repository/portfolio_repo_test.go` — modify

**Reviewers**: xstockstrat-portfolio owner — P&L calculation accuracy, concurrent write safety

**Codebase Evidence**:
- `portfolio_fill_errors_test.go:24-35` `fillEvent` builds a payload with no `order_id`, `side` or event id; `:72,88,103` assert DB-error surfacing through the old `GetPosition`/accum reads; `:113` the nil-payload case.
- `portfolio_fill_sync_race_test.go:27-61` `interleaveDB` has no `Begin`; `:63` `TestFillAndSync_SameRow_Serialized`. `noRow` (`:23-25`) is also used by `portfolio_offline_test.go:229`.
- `portfolio_helpers_test.go:22-36` `computeNewPosition` is a test-local copy of the buggy add (`recon.md:83`); its tests are at `:42-99`.
- `portfolio_telemetry_test.go:509-524` `runOrderFillBatch` drives the fill handler over `syncRecorderDB` (`portfolio_offline_test.go:220-236`), which has no `Begin`; `:491-499` the 4-event batch.
- `portfolio_repo_test.go:97-137` tests `GetFeesAccum`. `position_drain_dbtest_test.go:67` seeds with `repo.UpsertPosition`.
- Re-spec 2026-11-27 (operator ruling B), from `grep -n 'TestFillFloor_SameMillisecondFolds\|ExpectQuery' portfolio_fill_floor_test.go`: `:42` `TestFillFloor_SameMillisecondFolds`; `:45` `mock.ExpectQuery("FROM portfolio.positions").WithArgs(anyArgs(4)...).WillReturnError(errDBBlip)` expects the old `GetPosition` read as the first DB call. After Step 9 the first DB call past the floor check is `s.repo.FillApplied` (`repository/fill_apply_repo.go:81`), whose SQL (`:84-85`) is `SELECT event_id, outcome, pending_closed::text FROM portfolio.consumer_applied_events WHERE consumer=$1 AND user_id=$2 AND account_id=$3 AND order_id=$4` (`appliedKeyWhere`, `:33`; four args from `FillKey.args()`, `:31`), so the ordered pgxmock rejects `:45` and the package run cannot pass.

**Lands with**: `Step 9`

**TDD**: `red-green required`

**Covers**: `AC-1, AC-3, AC-4, AC-5`

**Instructions**:
1. New `portfolio_fill_fold_test.go`, over `newFillSvc` (pgxmock) and `testdata.FilledEvent`:
   - `@AC-3`: a row of 10 at cost 1000, then a sell of 10 at 150: the row is deleted and one `portfolio.position.closed` is appended with `realized_pnl` 500 and idempotency key `position.closed:<event_id>`.
   - `@AC-1`: the same event delivered again hits the pre-check: no transaction, no position write, no `position.*` append, result `errFillAcked`. A below-floor event behaves the same with zero queries.
   - `@AC-4` and `@AC-5` (fold half): a buy of 10 at 100, then a leg `order.filled` with `side` SELL, `qty` 10, price 110 and `order_id` = a leg id: position closed, sealed realized 100.
   - Buy adds, partial sell reduces with `realized_accum` and `fees_accum` taken from the locked row.
   - Flip: long 10, sell 15: one `position.closed` for the long, then one `position.opened` for a short of 5; the new row's accumulators are 0.
   - 029 `@AC-10`: the close payload carries `fees_total` and a gross `realized_pnl`.
   - Side fallback: a payload with no `side` resolves through `orderSide`; an unattributable fill inserts one parked row and returns an error wrapping `ErrFillUnattributable`; the same fill again returns `errFillAcked` through the pre-check; a ledger-unavailable side lookup returns the error and parks nothing.
   - `pending_closed` re-emit: a pre-check hit with `PendingClosed` set appends with the STORED event id in the key, then clears; a failed append leaves it set; a failed clear is not an error.
   - INSERT conflict: `ErrFillAlreadyApplied` returns `errFillAcked` with no emit, risk or snapshot call.
   - Pre-check DB error is returned.
   - Skip class (A-2): `qty` 0, empty `order_id`, empty `user_id`, empty `symbol`: nil, no query, no append.
   - Ordering: the risk and snapshot calls happen after the transaction commits.
2. `portfolio_fill_errors_test.go`: keep the regression intent (a DB error emits nothing and is returned). Re-point the three DB-error cases at the new seam: pre-check error, `FOR UPDATE` read error inside the transaction, and write error. Give `fillEvent` an `order_id` and an event id, or replace it with `testdata.FilledEvent`; without an `order_id` the Step 9 skip class returns nil and these three tests can no longer reach the DB.
3. `portfolio_fill_sync_race_test.go`: delete `interleaveDB`; re-point `TestFillAndSync_SameRow_Serialized` at `FillApplied`/`ApplyFill` over pgxmock so it still proves a sync cannot write between the fill's locked read and its write in one process (D-32). Move `noRow` to `portfolio_offline_test.go` if it leaves this file.
4. `portfolio_helpers_test.go`: delete `computeNewPosition` and its tests; the new file covers the same cases through the real fold.
5. `portfolio_telemetry_test.go`: make `runOrderFillBatch` use a DB that supports `Begin` (pgxmock, or `syncRecorderDB` given a `Begin`). `TestOrderFillConsumer_AC56_OneTickRecordPerBatch` must still count 4 `ok` and one tick record.
6. `portfolio_repo_test.go`: delete the `GetFeesAccum` tests. `position_drain_dbtest_test.go:67`: seed with a direct `INSERT`, as `seedPosition` does in `internal/repository/dbtest_helpers_test.go:67-75`.
7. Fails-ledger rule (2026-11-16, feature 347): before finishing, run the whole package and list any other test that built a fill service with a nil dependency or a `recover()`; none was found by grep in this package, but the run is the proof.
8. `portfolio_fill_floor_test.go` (created by Step 8): in `TestFillFloor_SameMillisecondFolds` (`:42-54`) change only the `:45` expectation to ``mock.ExpectQuery(`FROM portfolio\.consumer_applied_events`).WithArgs(anyArgs(4)...).WillReturnError(errDBBlip)``. The test's intent is unchanged: a fill stamped exactly at the floor reaches the DB path (now the `FillApplied` pre-check) and is not acked. Change nothing else in the file.

**Verification**:
```bash
cd services/xstockstrat-portfolio && GOWORK=off go test ./internal/... -race -count=1
cd services/xstockstrat-portfolio && GOWORK=off go vet -tags dbtest ./...
grep -rn 'interleaveDB\|computeNewPosition' services/xstockstrat-portfolio --include=*.go   # none
cd services/xstockstrat-portfolio && GOWORK=off golangci-lint run --modules-download-mode=mod
cd services/xstockstrat-portfolio && GOWORK=off COVERPKGS=$(go list ./... | grep -Ev '/(cmd|handler|repository|telemetry|service)(/|$)' | tr '\n' ',' | sed 's/,$//') && go test ./... -race -count=1 -coverprofile=coverage.out -covermode=atomic -coverpkg="${COVERPKGS}" && go tool cover -func=coverage.out | grep "^total:"   # >= 40%
```
New logic is in excluded packages — no coverage threshold applies to it.

---

### Step 11 — test: real-Postgres proof for exactly-once (dbtest)

**Status**: `pending`
**Service**: `xstockstrat-portfolio`
**Files**:
- `services/xstockstrat-portfolio/internal/repository/apply_fill_dbtest_test.go` — create
- `services/xstockstrat-portfolio/internal/repository/dbtest_helpers_test.go` — modify
- `services/xstockstrat-portfolio/internal/service/fill_fold_dbtest_test.go` — create
- `services/xstockstrat-portfolio/internal/service/position_drain_dbtest_test.go` — modify

**Reviewers**: xstockstrat-portfolio owner — concurrent write safety

**Codebase Evidence**:
- `.github/workflows/ci.yml:1018` job "Portfolio DB test (TimescaleDB)" applies migrations (`:1052-1057`) and runs `go test -tags dbtest -race -count=1 ./internal/repository/... ./internal/service/...` (`:1065`) with `PORTFOLIO_DB_TEST_URL` (`:1064`). No CI change is needed (D-27, R-15).
- `internal/repository/dbtest_helpers_test.go:22-59` `testPool(t, opts ...func(*pgxpool.Config))` skips when `PORTFOLIO_DB_TEST_URL` is unset, is fatal under `CI=true`, sets `lock_timeout` 500ms and deletes rows by the `it-281-` user prefix.
- `internal/service/position_drain_dbtest_test.go:21-48` `serviceTestPool` is the service twin, with prefix `it-357-`; `:54` builds the repo with `NewPortfolioRepoWithDB(pool)`.
- `internal/repository/pool.go:29-31`: exec mode under `DB_PGBOUNCER`.

**TDD**: `red-green required` — the cases need `PORTFOLIO_DB_TEST_URL`. Where it is set, show the service cases failing on the tree before Step 9 (qty 20, not 15). Where it is not, the tests skip locally; record that, and the `portfolio-db-test` CI job is the proof.

**Covers**: `AC-1, AC-2`

**Instructions**:
1. Helpers: add cleanup for `portfolio.consumer_applied_events` by the test user prefix to `testPool` and `serviceTestPool`. Both helpers keep their skip, CI-fatal and `lock_timeout` rules in step.
2. Floor in tests: service cases set the service's `fillFloor` field directly to a time before their events. They do not write the shared `consumer_floors` row, except the floor case in item 5, which restores it.
3. `apply_fill_dbtest_test.go` (repo level):
   - Two goroutines call `ApplyFill` with the same key on separate connections: exactly one applies, the other gets `ErrFillAlreadyApplied`, and the position moved once.
   - The same case with `testPool(t, func(c *pgxpool.Config){ c.ConnConfig.DefaultQueryExecMode = pgx.QueryExecModeExec })` (the `DB_PGBOUNCER` mode, D-33).
   - A rolled-back fold leaves no applied row.
4. `fill_fold_dbtest_test.go` (service level):
   - `@AC-2`: two `PortfolioService` instances, each with its own pool and its own `positionsMu`, fold the same `order.filled` (buy 5) against a row of 10. Assert qty 15 **and** that exactly one applied row exists; without the second assertion the case can pass without folding (round-7 synthesis).
   - `@AC-1`: fold a history, build a second service over the same database (a restart), deliver the same events again: qty, `cost_basis` and `realized_accum` are unchanged.
   - Sync versus fill: one instance runs `processPositionSync`, the other folds a fill on the same row, repeatedly. No error with SQLSTATE `40P01` and no lock timeout.
5. Floor on a real database: `EnsureFillFloor` twice returns the same value with `stampedNow` true then false. Save and restore any existing `order_fill` row around the case.
6. C-13: the two user-prefix constants stay in their packages (one consumer each).

**Verification**:
```bash
cd services/xstockstrat-portfolio && GOWORK=off go vet -tags dbtest ./...
# with a migrated database available:
cd services/xstockstrat-portfolio && PORTFOLIO_DB_TEST_URL=<url> GOWORK=off go test -tags dbtest -race -count=1 ./internal/repository/... ./internal/service/... -run 'ApplyFill|FillFold|FillFloor'
cd services/xstockstrat-portfolio && GOWORK=off golangci-lint run --modules-download-mode=mod --build-tags dbtest
```
Never start a database for this step. Without `PORTFOLIO_DB_TEST_URL`, the compile check passes and the CI job `portfolio-db-test` runs the cases.

---

### Step 12 — service: `GetPnL` dedup keyed on account and order

**Status**: `pending`
**Service**: `xstockstrat-portfolio`
**Files**:
- `services/xstockstrat-portfolio/internal/service/portfolio_service.go` — modify

**Reviewers**: xstockstrat-portfolio owner — P&L calculation accuracy

**Codebase Evidence**:
- `portfolio_service.go:993-999`: `filledOrderIDs := make(map[string]bool, …)` keyed on `f.OrderID`.
- `:1002-1012`: `latest := make(map[string]sequencedFill)` and `partialOrder []string`, both keyed on `f.OrderID`.
- `:1013-1020`: the loop that skips a partial when `filledOrderIDs[id]`.
- `:1027` `s.orderSide(ctx, kept[i].OrderID)` resolves side by the bare order id (ledger stream key).
- `:1032-1045`: the mixed `account_id` group refusal (251 `@AC-14`).
- Payload-history check (D-28, required): the only two production emitters take `account_id` from the same `order.AccountId` (`services/xstockstrat-trading/internal/service/trading.go:1935,1956`), and leg events take it from the leg row (Step 23). An order's partial and full fills therefore carry one `account_id` in code. Rows already in a ledger database cannot be checked from the repository; that residual stays open (`design.md` § Open Risks).

**Lands with**: `Step 13`

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. Key `filledOrderIDs`, `latest` and `partialOrder` on `f.AccountId + "|" + f.OrderID` (D-28). Build the key in one small helper used by all three.
2. Leave `orderSide` keyed on the bare order id, and leave the mixed-account refusal and the sort unchanged.
3. Change nothing else in `realizedPnL`.

**Verification**:
```bash
cd services/xstockstrat-portfolio && GOWORK=off go build ./... && GOWORK=off go vet -tags dbtest ./...
cd services/xstockstrat-portfolio && GOWORK=off go test ./internal/service/ -race -count=1 -run 'GetPnL'
cd services/xstockstrat-portfolio && GOWORK=off golangci-lint run --modules-download-mode=mod
```

---

### Step 13 — test: `GetPnL` with bracket-leg fills and two accounts

**Status**: `pending`
**Service**: `xstockstrat-portfolio`
**Files**:
- `services/xstockstrat-portfolio/internal/service/portfolio_pnl_legs_test.go` — create

**Reviewers**: xstockstrat-portfolio owner — P&L calculation accuracy

**Codebase Evidence**:
- `internal/service/portfolio_quote_deadline_test.go:697` `TestGetPnL251_AC17_PartialDroppedWhenOrderFilled` is the existing 251 `@AC-17` test and its harness.
- `internal/testdata/ledger.go:122,129` `FilledEvent` and `PartialEvent` take `orderID`, `accountID` and `side`; `internal/testdata/ledger.go:40-53` the `Ledger` fake serves `QueryEvents`.

**Lands with**: `Step 12`

**TDD**: `red-green required`

**Covers**: `AC-4, AC-5`

**Instructions**:
Reuse the 251 harness and `testdata` builders:
1. `@AC-4`: entry `order.filled` buy 10 at 100, leg `order.filled` (leg id as `order_id`, `side` SELL, `qty` 10, price 110, same account, mode and user): `GetPnL` realized is 100.
2. `@AC-5`: the same entry, then a leg `order.partially_filled` with cumulative `filled_qty` 4 at 110, then the leg `order.filled` with `qty` 10 at 110: realized is 100, not 140 (251 `@AC-17`: the partial is dropped once the order is filled).
3. Two accounts, same leg id (D-28, 251 `@AC-17` EXTEND): account A has a leg `order.filled`; account B has only a partial for the same leg id. B's partial is counted. This case fails before Step 12.
4. 251 `@AC-14` still refuses a group that mixes fills with and without `account_id`.
5. A leg event always carries `side`, so no `order.created` lookup is made for it: assert the ledger fake saw no side query for the leg id (251 `@AC-4`).

**Verification**:
```bash
cd services/xstockstrat-portfolio && GOWORK=off go test ./internal/service/ -race -count=1 -run 'GetPnL|PnLLegs'
cd services/xstockstrat-portfolio && GOWORK=off golangci-lint run --modules-download-mode=mod
cd services/xstockstrat-portfolio && GOWORK=off COVERPKGS=$(go list ./... | grep -Ev '/(cmd|handler|repository|telemetry|service)(/|$)' | tr '\n' ',' | sed 's/,$//') && go test ./... -race -count=1 -coverprofile=coverage.out -covermode=atomic -coverpkg="${COVERPKGS}" && go tool cover -func=coverage.out | grep "^total:"   # >= 40%
```

---

### Step 14 — service: broker `ErrOrderNotFound` and IBKR `GetOrder` id match

**Status**: `pending`
**Service**: `xstockstrat-trading`
**Files**:
- `services/xstockstrat-trading/internal/broker/broker.go` — modify
- `services/xstockstrat-trading/internal/broker/alpaca.go` — modify
- `services/xstockstrat-trading/internal/broker/ibkr.go` — modify

**Reviewers**: xstockstrat-trading owner — broker API safety, fill detection

**Codebase Evidence**:
- `internal/broker/broker.go:8-21`: the sentinel block (`ErrInvalidCredentials`, `ErrOutcomeUncertain`, `ErrOrderNotCancelable`, `ErrRateLimited`). **Not found**: `ErrOrderNotFound`.
- `internal/broker/alpaca.go:431` `func (c *Client) GetOrder`; `:452-454` any non-200 returns `fmt.Errorf("alpaca get order error (status %d): %s", …)`.
- `alpaca.go:485`: `"%s/v2/orders?status=all&limit=500"` — the list ceiling is an inline literal. The comment above it (`:483`) also names `limit=500` ("status=all keeps just-filled/canceled orders visible; limit=500 is the bulk-list ceiling."), so a bare `limit=500` grep matches it.
- `internal/broker/ibkr.go:414-444` `GetOrder` requests `/iserver/account/orders?orderId=…`, fails on an empty `orders` array (`:439-441`) and returns `result.Orders[0]` without comparing ids (`:442-443`).
- `ibkr.go:448-483` `ListOrders` returns an empty slice with a nil error for a 200 with no orders.

**Lands with**: `Step 15`

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
Broker coverage: this step handles both brokers, differently by design (D-26).
1. `broker.go`: add `var ErrOrderNotFound = errors.New("broker order not found")` with a one-line comment that only a definitive single-order not-found may wrap it.
2. `alpaca.go` `GetOrder`: an HTTP 404 returns an error wrapping `ErrOrderNotFound` (`%w`). Every other non-200 is unchanged. `ErrRateLimited` handling inside `c.do` is untouched (feature 347).
3. `alpaca.go`: replace the `500` literal with an exported constant `ListOrdersLimit = 500` used to build the URL; Step 26 reads the same constant for the complete-list gate (C-18).
4. `ibkr.go` `GetOrder`: return the entry whose `OrderID` equals `brokerOrderID`. If none matches, return an ordinary error that does not wrap `ErrOrderNotFound` (R-11, D-18). An empty list stays an ordinary error.
5. Do not change `ListOrders` on either broker. Order types, trading mode and fill-state handling are unaffected by this step.

**Verification**:
```bash
cd services/xstockstrat-trading && GOWORK=off go build ./...
grep -n 'Orders\[0\]' services/xstockstrat-trading/internal/broker/ibkr.go   # none
grep -n 'status=all&limit=500' services/xstockstrat-trading/internal/broker/alpaca.go   # none: the URL uses ListOrdersLimit (the :483 comment may keep its wording)
cd services/xstockstrat-trading && GOWORK=off golangci-lint run --modules-download-mode=mod
```

---

### Step 15 — test: broker not-found and id match

**Status**: `pending`
**Service**: `xstockstrat-trading`
**Files**:
- `services/xstockstrat-trading/internal/broker/alpaca_test.go` — modify
- `services/xstockstrat-trading/internal/broker/ibkr_do_test.go` — modify

**Reviewers**: xstockstrat-trading owner — broker API safety

**Codebase Evidence**:
- `internal/broker/alpaca_test.go:283` `TestGetOrder_AlpacaFilledAvgPrice` (httptest pattern); `:634` `TestAlpacaListOrders_QueryParams` asserts the query string.
- `internal/broker/ibkr_do_test.go:123` `ibkrOrdersJSON = {"orders":[{"orderId":"42","status":"Submitted"}]}`; `:127-139` `TestIBKRGetOrder_SignsQueryOnTheWire` requests id `"42"` and so keeps passing.

**Lands with**: `Step 14`

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. Alpaca: a 404 from `GET /v2/orders/{id}` satisfies `errors.Is(err, broker.ErrOrderNotFound)`; a 500 and a 429 do not.
2. Alpaca: `TestAlpacaListOrders_QueryParams` still sees `limit=500`.
3. IBKR: a response listing ids `"7"` and `"42"` returns the `"42"` entry for a request of `"42"`.
4. IBKR: a response that lists only `"7"` for a request of `"42"` returns an error for which `errors.Is(err, broker.ErrOrderNotFound)` is false; the same for an empty list.
5. C-13: reuse `ibkrOrdersJSON`; new JSON bodies have one consumer and stay inline.

**Verification**:
```bash
cd services/xstockstrat-trading && GOWORK=off go test ./internal/broker/ -race -count=1
cd services/xstockstrat-trading && GOWORK=off golangci-lint run --modules-download-mode=mod
cd services/xstockstrat-trading && GOWORK=off COVERPKGS=$(go list ./... | grep -Ev '/(cmd|handler|repository|telemetry|service)(/|$)' | tr '\n' ',' | sed 's/,$//') && go test ./... -race -count=1 -coverprofile=coverage.out -covermode=atomic -coverpkg="${COVERPKGS}" && go tool cover -func=coverage.out | grep "^total:"   # >= 40%
```

---

### Step 16 — service: `appendLedgerEvent` takes the idempotency key

**Status**: `pending`
**Service**: `xstockstrat-trading`
**Files**:
- `services/xstockstrat-trading/internal/service/trading.go` — modify

**Reviewers**: xstockstrat-trading owner — order execution correctness

**Codebase Evidence**:
- `trading.go:3953` `func (s *TradingService) appendLedgerEvent(ctx context.Context, eventType, streamKey, userID string, payload map[string]interface{}) error`; `:3965` `IdempotencyKey: uuid.NewString()`.
- Call sites, from `grep -rn 'appendLedgerEvent(' services/xstockstrat-trading --include=*.go`: `trading.go:1123`, `trading.go:3997` (inside `emitLedgerEvent`), `trading_offline_test.go:2215`, `trading_offline_test.go:2228`.
- `:3996-4000` `emitLedgerEvent` is the fail-soft wrapper.

**Lands with**: `Step 17`

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. Add an `idempotencyKey string` parameter after `userID`. An empty value keeps `uuid.NewString()` (R-5: one function, the key is a parameter).
2. `trading.go:1123` and `:3997` pass `""`. Do not change `emitLedgerEvent`'s signature.
3. Keep the retry loop, the timeout and the `RecordLedgerEmit` calls as they are (294 `@AC-4`).

**Verification**:
```bash
cd services/xstockstrat-trading && GOWORK=off go build ./...
grep -rn 'appendLedgerEvent(' services/xstockstrat-trading --include=*.go   # every call passes the key argument
cd services/xstockstrat-trading && GOWORK=off golangci-lint run --modules-download-mode=mod
```

---

### Step 17 — test: keyed ledger append

**Status**: `pending`
**Service**: `xstockstrat-trading`
**Files**:
- `services/xstockstrat-trading/internal/service/trading_offline_test.go` — modify
- `services/xstockstrat-trading/internal/service/trading_ledger_userid_test.go` — modify

**Reviewers**: xstockstrat-trading owner — order execution correctness

**Codebase Evidence**:
- `trading_offline_test.go:2215,2228` call `svc.appendLedgerEvent(context.Background(), "account.positions.synced", "account:acc-1", "user-1", …)`.
- `internal/service/trading_ledger_userid_test.go` holds the existing assertions on `AppendEventRequest` fields for trading emits.

**Lands with**: `Step 16`

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. `trading_offline_test.go:2215,2228`: add `""` for the new argument; the assertions are unchanged.
2. `trading_ledger_userid_test.go`: add cases that a non-empty key reaches `AppendEventRequest.IdempotencyKey` unchanged and is reused on the `Unavailable` retry, and that an empty key yields a generated one.

**Verification**:
```bash
cd services/xstockstrat-trading && GOWORK=off go test ./internal/service/ -race -count=1 -run 'Ledger|Offline'
cd services/xstockstrat-trading && GOWORK=off golangci-lint run --modules-download-mode=mod
```
New logic is in an excluded package — no coverage threshold applies.

---

### Step 18 — service: `trading.bracket_legs` repository and reconciliation UNIONs

**Status**: `pending`
**Service**: `xstockstrat-trading`
**Files**:
- `services/xstockstrat-trading/internal/repository/bracket_repo.go` — modify
- `services/xstockstrat-trading/internal/repository/trading_repo.go` — modify

**Reviewers**: xstockstrat-trading owner — fill detection, order execution correctness

**Codebase Evidence**:
- `internal/repository/bracket_repo.go:30-38` `BracketRepository` has `CreateBracket`, `GetBracketByOrderID`, `UpdateBracketStatus`, `ReArmProtection`, `ListExpiredProtection`. `:41-43` `pgBracketRepo{pool *pgxpool.Pool}`; `:46` `NewBracketRepo(pool *pgxpool.Pool)`. **Not found**: a mock seam or a test file for this repo.
- `:91-100` `UpdateBracketStatus` (the `$3`/`$4` leg-id parameters are at `:94-95`) writes `stop_leg_order_id = NULLIF($3,'')` and `take_profit_leg_order_id = NULLIF($4,'')`.
- `internal/repository/trading_repo.go:130-163` `KnownBrokerOrderIDs` unions `trading.orders.broker_order_id` with both `order_brackets` leg columns.
- `:171-200` `NetFilledQtyBySymbol` sums `CASE WHEN side = 'sell' THEN -filled_qty ELSE filled_qty END` over a `DISTINCT ON (order_id)` subquery.
- `:436-441` `sideStr(tradingv1.OrderSide) string` returns `"sell"` or `"buy"`; `:500-503` `parseSide`.
- `:111` `GetOrder` and `:370` `scanOrder` read a parent order row.

**Lands with**: `Step 19, Step 20`

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. `bracket_repo.go`: change `pgBracketRepo.pool` to a small interface with `Begin`, `Query`, `QueryRow` and `Exec`, satisfied by `*pgxpool.Pool` and pgxmock. `NewBracketRepo(pool *pgxpool.Pool)` keeps its signature.
2. Statuses for `bracket_legs.status`, as exported constants of package `repository`: tracked `LegStatusOpen = "OPEN"`; retired `LegStatusFilled = "FILLED"`, `LegStatusCanceled = "CANCELED"`, `LegStatusExpired = "EXPIRED"`, `LegStatusRejected = "REJECTED"`, `LegStatusUnknown = "UNKNOWN"`, `LegStatusBaselineRetired = "BASELINE_RETIRED"`, `LegStatusNotOpenAtAdoption = "NOT_OPEN_AT_ADOPTION"` (R-35 keeps `UNKNOWN` and the tombstone apart). Later steps and tests refer to these identifiers, not to the strings. Export the retired set once, as `RetiredLegStatuses []string`, and bind it into every predicate as `status <> ALL($n)`; no SQL text repeats the list (C-10, C-18).
3. `BracketLegRecord{AccountID, LegOrderID, OrderID, UserID, TradingMode, Symbol string; Side tradingv1.OrderSide; FilledQty, ObservedFilledQty float64; Status string; NotFoundTicks int; Adopted bool}`. Write `side` through `sideStr` and read it through `parseSide` (D-37).
4. Add to `BracketRepository` and implement on `pgBracketRepo`:
   - `ActivateBracket(ctx, id string, stopLegID, takeProfitLegID string, parent BracketLegParent) error` — one transaction: the `UpdateBracketStatus` UPDATE with status ACTIVE and the two leg ids, then one `INSERT INTO trading.bracket_legs … ON CONFLICT (account_id, leg_order_id) DO NOTHING` per non-empty leg id with `filled_qty = 0`, `observed_filled_qty = 0`, `status = 'OPEN'`, `adopted = false` (D-14, D-19, R-13). `BracketLegParent{AccountID, OrderID, UserID, TradingMode, Symbol string; Side tradingv1.OrderSide}` carries the parent's account, order id, user, trading mode and symbol; `Side` is the leg's side, already flipped by the caller, and is written through `sideStr` like `BracketLegRecord.Side` (A-13).
   - `ListTrackedLegs(ctx) ([]*BracketLegRecord, error)` — rows whose status is not retired, ordered by `adopted ASC, updated_at ASC`.
   - `ListAdoptionCandidates(ctx, statuses []int32) ([]*BracketLegRecord, error)` — both leg-id columns of `order_brackets` rows with `status = ANY($1)`, non-empty, with no `bracket_legs` row for `(account_id, leg id)`, joined read-only to the parent's latest `trading.orders` row (`DISTINCT ON (order_id) … ORDER BY order_id, created_at DESC`). The leg side is the opposite of the parent side. A bracket with no parent row yields no candidate (D-40, D-41).
   - `InsertAdoptedLeg(ctx, rec *BracketLegRecord) (inserted bool, err error)` — `ON CONFLICT DO NOTHING`, `adopted = true`, status and quantities from `rec`.
   - `RecordLegObservation(ctx, accountID, legID string, observedFilledQty float64, notFoundTicks int) error`.
   - `AdvanceLegEmit(ctx, accountID, legID string, filledQty float64, status string) error` — moves the emit cursor and, when `status` is retired, retires the leg.
5. `trading_repo.go` `KnownBrokerOrderIDs`: add `UNION SELECT leg_order_id FROM trading.bracket_legs WHERE account_id = $1 AND leg_order_id = ANY($2)` (D-20). Retired rows count: a tombstone keeps its id known.
6. `trading_repo.go` `NetFilledQtyBySymbol`: sum the existing subquery `UNION ALL SELECT symbol, side, observed_filled_qty FROM trading.bracket_legs WHERE account_id = $1 AND symbol = ANY($2)`, with the same `side = 'sell'` CASE (D-37, R-27). No status filter: a tombstone adds 0.
7. No leg row is written to `trading.orders` (D-3, R-30).

**Verification**:
```bash
cd services/xstockstrat-trading && GOWORK=off go build ./internal/repository/...
grep -c 'bracket_legs' services/xstockstrat-trading/internal/repository/trading_repo.go   # 2
grep -n "NOT_OPEN_AT_ADOPTION\|BASELINE_RETIRED" services/xstockstrat-trading/internal/repository/*.go | grep -v _test   # one declaration site each
cd services/xstockstrat-trading && GOWORK=off golangci-lint run --modules-download-mode=mod
```

---

### Step 19 — service: `ActivateBracket` at the three ACTIVE writes

**Status**: `pending`
**Service**: `xstockstrat-trading`
**Files**:
- `services/xstockstrat-trading/internal/service/trading.go` — modify

**Reviewers**: xstockstrat-trading owner — order execution correctness, fill detection

**Codebase Evidence**:
- `trading.go:3688` (Alpaca, `createBracket`): `s.bracketRepo.UpdateBracketStatus(ctx, rec.ID, bracketStatusActive, brokerOrder.StopLegOrderID, brokerOrder.TakeProfitLegOrderID, "")`; an error is a WARN only (`:3689`).
- `:3705` (IBKR, `createBracket`): the same call with `resp.StopLegOrderID`, `resp.TakeProfitLegOrderID`.
- `:3747` (IBKR, `resizeBracket`): the same call after `ReArmProtection` (`:3732`) and the resubmit (`:3736-3739`).
- `:3618-3632` `emitBracketFailureAlert(ctx, order, reason)`; `:3580-3585` `oppositeSide(tradingv1.OrderSide) string` returns `"buy"` or `"sell"`.
- `:3568-3576` the `bracketStatus*` constants.

**Lands with**: `Step 18, Step 20`

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
Broker coverage: both brokers are handled here — the Alpaca atomic path at `:3688` and the IBKR paths at `:3705` and `:3747`. Order type and trading-mode handling are unaffected by this step.
1. Replace each of the three ACTIVE `UpdateBracketStatus` calls with `s.bracketRepo.ActivateBracket(...)`, passing the leg ids and a parent built from `order` (account, order id, user, `order.TradingMode.String()`, symbol) with `Side` set to the leg side as a `tradingv1.OrderSide` (A-13): `ORDER_SIDE_BUY` when `order.Side` is `ORDER_SIDE_SELL`, otherwise `ORDER_SIDE_SELL`, the same rule as `oppositeSide`. Do not pass `oppositeSide`'s string to the repository, and do not change `oppositeSide` or its two broker call sites (`:3695`, `:3737`).
2. On an `ActivateBracket` error at any of the three sites: keep the WARN and also `go s.emitBracketFailureAlert(context.WithoutCancel(ctx), order, …)` (D-14). The leg id is then untracked; that residual is accepted (`design.md` § Open Risks).
3. `resizeBracket`: do not return early when `ActivateBracket` fails. `ReArmProtection` and the resubmit already ran; the `order.bracket_updated` emit that follows stays (R-6).
4. Leave every non-ACTIVE `UpdateBracketStatus` call (`:1435`, `:3117`, `:3699`, `:3716`, `:3729`, `:3741`) unchanged.

**Verification**:
```bash
cd services/xstockstrat-trading && GOWORK=off go build ./...
grep -n 'UpdateBracketStatus(ctx, [a-z.]*ID, bracketStatusActive' services/xstockstrat-trading/internal/service/trading.go   # none
grep -c 'ActivateBracket(' services/xstockstrat-trading/internal/service/trading.go   # 3
cd services/xstockstrat-trading && GOWORK=off golangci-lint run --modules-download-mode=mod
```

---

### Step 20 — test: bracket-leg persistence, activation and reconciliation queries

**Status**: `pending`
**Service**: `xstockstrat-trading`
**Files**:
- `services/xstockstrat-trading/internal/repository/bracket_repo_test.go` — create
- `services/xstockstrat-trading/internal/repository/trading_repo_test.go` — modify
- `services/xstockstrat-trading/internal/service/trading_bracket_test.go` — modify
- `services/xstockstrat-trading/internal/service/trading_bracket_legs_test.go` — create

**Reviewers**: xstockstrat-trading owner — fill detection, order execution correctness

**Codebase Evidence**:
- `internal/repository/trading_repo_test.go:1` is `package repository`; `:101-162` the `KnownBrokerOrderIDs` tests; `:188-217` `TestNetFilledQtyBySymbol_SumsSignedAndDedups` (pgxmock).
- `internal/service/trading_bracket_test.go:99-177` `fakeBracketRepo` (in-memory maps, `:177` the interface assertion); `:228` `TestMaybeSubmitBracket_AlpacaAtomicRecordsLegs`; `:252` `_IBKRSubmitsFollowUpLegs`; `:372` `_IBKRFailureTransitionsFailedAndAlerts`; `:420` `TestPollFills_PartialFillResizesActiveBracket`; `:402` `waitForAlert`.
- Other files that hold an ACTIVE bracket or leg ids, from `grep -rln 'bracketStatusActive\|StopLegOrderID:' services/xstockstrat-trading/internal/service/*_test.go`: `trading_cancel_not_cancelable_test.go`, `trading_order_state_audit_test.go`, `trading_rate_limit_test.go`. They use `fakeBracketRepo` and need no edit in this step unless they call a removed method; the whole-package run decides.

**Lands with**: `Step 18, Step 19`

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. `fakeBracketRepo`: implement the six new methods in memory. `ActivateBracket` updates the bracket and adds leg rows with `filled_qty` 0, skipping empty ids. The retired filter reads `repository.RetiredLegStatuses`; it does not restate the list (O-66). Add error hooks for `ActivateBracket`, `ListAdoptionCandidates` and `InsertAdoptedLeg` (used by Steps 24 and 27).
2. `bracket_repo_test.go` (pgxmock, in package): `ActivateBracket` runs Begin, the UPDATE, one INSERT per non-empty leg id with `filled_qty` 0, Commit; an empty take-profit id inserts one row; a failed INSERT rolls back. `ListTrackedLegs` and `ListAdoptionCandidates` bind the retired set and the status codes as arguments.
3. `trading_repo_test.go`:
   - `KnownBrokerOrderIDs` SQL contains the `bracket_legs` branch; a leg id that is no longer in `order_brackets` (blanked by a resize) is still returned when its `bracket_legs` row exists (round-10 test 9, pgxmock form, A-5).
   - `NetFilledQtyBySymbol` SQL contains `UNION ALL` over `bracket_legs` with `observed_filled_qty`; a mixed orders-plus-legs row set for one symbol sums with the right signs (D-37); a tombstone row with 0 leaves the sum equal to the orders row alone (round-10 test 8, pgxmock form).
4. `trading_bracket_legs_test.go`:
   - Alpaca activation writes two leg rows with `filled_qty` 0, the parent's account, user, mode and symbol, and the side opposite to the entry.
   - IBKR activation the same; IBKR with no take-profit writes one row.
   - Resize: the new leg ids get rows; the old rows stay.
   - `ActivateBracket` failure at each of the three sites fires `emitBracketFailureAlert`; on the resize site the `order.bracket_updated` emit still happens.
5. Existing tests `TestMaybeSubmitBracket_*` and `TestPollFills_PartialFillResizesActiveBracket` must pass with their assertions unchanged (`rec.Status == bracketStatusActive`, leg ids).

**Verification**:
```bash
cd services/xstockstrat-trading && GOWORK=off go test ./internal/... -race -count=1
cd services/xstockstrat-trading && GOWORK=off golangci-lint run --modules-download-mode=mod
grep -rn '"NOT_OPEN_AT_ADOPTION"' services/xstockstrat-trading/internal --include=*.go   # one line: the repository constant; fakes reference it
cd services/xstockstrat-trading && GOWORK=off COVERPKGS=$(go list ./... | grep -Ev '/(cmd|handler|repository|telemetry|service)(/|$)' | tr '\n' ',' | sed 's/,$//') && go test ./... -race -count=1 -coverprofile=coverage.out -covermode=atomic -coverpkg="${COVERPKGS}" && go tool cover -func=coverage.out | grep "^total:"   # >= 40%
```
New logic is in excluded packages — no coverage threshold applies to it.

---

### Step 21 — test: real-Postgres proof for trading bracket-leg SQL (dbtest)

**Status**: `pending`
**Service**: `xstockstrat-trading`
**Files**:
- `services/xstockstrat-trading/internal/repository/dbtest_helpers_test.go` — create
- `services/xstockstrat-trading/internal/repository/bracket_legs_dbtest_test.go` — create
- `services/xstockstrat-trading/internal/repository/trading_repo_legs_dbtest_test.go` — create
- `services/xstockstrat-trading/internal/repository/trading_repo.go` — modify (the comment at `:17-18` only)

**Reviewers**: xstockstrat-trading owner — fill detection, order execution correctness

**Codebase Evidence**:
- **Not found**: any real-Postgres test in trading. `git ls-tree -r --name-only fb52065c services/xstockstrat-trading/internal/repository | grep -c dbtest` → 0; `git grep -n 'DB_TEST_URL' origin/main-dev -- 'services/*.go'` names only `PORTFOLIO_DB_TEST_URL`, `MARKETDATA_DB_TEST_URL` and the ledger's `LEDGER_DB_TEST_URL`. This is the operator-ruled scope addition recorded in `context.md` ("operator rulings on cutover and CI scope"); it replaces the "no CI job" half of A-5.
- Helper precedent, portfolio: `services/xstockstrat-portfolio/internal/repository/dbtest_helpers_test.go:1` is `//go:build dbtest`; `:22` `testPool(t, opts ...func(*pgxpool.Config)) *pgxpool.Pool` skips when the URL is unset (`:24-30`) and is fatal under `CI=true`; `:35` sets `RuntimeParams["lock_timeout"] = "500ms"`; `:44` `t.Cleanup(pool.Close)`; `:47,53` cleanup `DELETE … WHERE user_id LIKE $1` by a test prefix. Marketdata twin: `services/xstockstrat-marketdata/internal/repository/fundamentals_replace_dbtest_test.go:22` `dbtestRepo`.
- `internal/repository/trading_repo.go:17-19`: the comment "(this service has no live-DB test harness)" on `dbQuerier`; `:41` `NewTradingRepoWithDB(db dbQuerier) *TradingRepo` (a `*pgxpool.Pool` satisfies `dbQuerier`); `:53` `UpsertOrder(ctx, *tradingv1.Order)` inserts into `trading.orders` with `ON CONFLICT (order_id, created_at)` and writes `account_id`, `user_id`, `broker_order_id`, `side`, `filled_qty`; `:130` `KnownBrokerOrderIDs`; `:171` `NetFilledQtyBySymbol` (the `DISTINCT ON (order_id) … ORDER BY order_id, created_at DESC` subquery).
- `internal/repository/bracket_repo.go:46` `NewBracketRepo(pool *pgxpool.Pool) BracketRepository` (Step 18 keeps this signature); `:50` `CreateBracket`, `:65` `GetBracketByOrderID`, `:91-100` `UpdateBracketStatus` (writes `NULLIF($3,'')` for the leg ids at `:94-95`); `CreateBracket` writes the leg ids as given, so an empty id is stored as `''`, not NULL, while `GetBracketByOrderID` reads both back through `COALESCE(…, '')`. The Step 18 methods under test are `ActivateBracket`, `ListTrackedLegs`, `ListAdoptionCandidates`, `InsertAdoptedLeg`, `RecordLegObservation`, `AdvanceLegEmit` and the exported `RetiredLegStatuses`.
- `internal/repository/pool.go:31-32`: under `DB_PGBOUNCER` the production pool sets `DefaultQueryExecMode = pgx.QueryExecModeExec`; trading is one of the six PgBouncer-pooled services (root `CLAUDE.md` § Connection Pool Budget), so the leg SQL must also run in exec mode (the Step 11 portfolio precedent, D-33).
- `internal/service/mtls_env_test.go:22` `TestMain` exists in `internal/service` only; `internal/repository` has none. This step therefore stays in `internal/repository` (A-16).
- `scripts/db-migrate.sh:164` `migrate_service "xstockstrat-trading" "trading"`: the CI job applies every trading migration, `012_bracket_legs` (Step 2) included, before the tests run.
- `migrations/001_orders_hypertable.up.sql:11,15,20`: `side` is `'buy'|'sell'`, `filled_qty NUMERIC(18,8)`, `trading_mode TEXT`; `005_broker_accounts_halted.up.sql:12-26` `order_brackets` has no unique constraint and no foreign key.

**TDD**: `red-green required` — the cases need `TRADING_DB_TEST_URL`. Where it is set, show them failing with the Step 18 `bracket_legs` branch temporarily removed from `KnownBrokerOrderIDs` and from `NetFilledQtyBySymbol` (a mutation, because Step 18 already holds the production code), then passing with it restored. Where it is not set, the cases skip locally: record "red N/A locally — skipped without `TRADING_DB_TEST_URL`; the `trading-db-test` job (Step 22) is the proof" in the PR body and `context.md`. A skipped suite is not coverage (`tdd-gate.md`, fails.md 2026-07-29), which is why the helper is fatal under `CI=true`.

**Covers**: `AC-4, AC-5` — the SQL layer only: the leg row an `ActivateBracket` writes (what the observer, Step 23, emits from) and the emit cursor that moves 4 then 10 and retires the leg. The ledger event is Step 24; `GetPnL` is Step 13.

**Instructions**:
Trading-domain notes: no order is placed, so no `TRADING_MODE` gate applies. Both brokers are covered through `broker_type` on the seeded `order_brackets` rows (ALPACA=1 and IBKR=2); order type handling is unaffected. Fill state: the cursor cases walk `PARTIALLY_FILLED` (4) and `FILLED` (10).
1. `dbtest_helpers_test.go` (`//go:build dbtest`, `package repository`): `testPool(t, opts ...func(*pgxpool.Config))`, a twin of the portfolio helper — reads `TRADING_DB_TEST_URL`; `t.Skip` when unset, `t.Fatal` under `CI=true` (message names the `trading-db-test` job); `lock_timeout` `500ms`; `t.Cleanup(pool.Close)` registered first. One exported-nowhere prefix constant `dbtestUserPrefix = "it-311-"`. Then three row cleanups, each with `dbtestUserPrefix+"%"` and `t.Errorf` on error. `t.Cleanup` runs last-registered first, so register them in this order to have them run leaf rows first and the pool close last: `DELETE FROM trading.orders WHERE user_id LIKE $1`, then `DELETE FROM trading.order_brackets WHERE account_id LIKE $1`, then `DELETE FROM trading.bracket_legs WHERE user_id LIKE $1`. Add the two seed helpers both test files need: `seedParentOrder` (calls `NewTradingRepoWithDB(pool).UpsertOrder` with a fresh UUID, the test's account and user, a `brokerOrderID` argument written to `BrokerOrderId` (the `KnownBrokerOrderIDs` case needs it), a symbol, a side, `OrderType` MARKET, `Status` FILLED, `FilledQty`, and an explicit `CreatedAt`) and `seedBracket` (calls `NewBracketRepo(pool).CreateBracket` for that order). A helper `execModes()` returns `[]struct{name string; opt func(*pgxpool.Config)}` for default and `c.ConnConfig.DefaultQueryExecMode = pgx.QueryExecModeExec` (the `DB_PGBOUNCER` mode).
2. `bracket_legs_dbtest_test.go`: every case runs once per `execModes()` entry as a subtest, with account and user ids derived from `dbtestUserPrefix`, `t.Name()` and `time.Now().UnixNano()` so cases never share rows. Status values come from the `LegStatus*` constants Step 18 declares and from `RetiredLegStatuses`; do not write the literal `NOT_OPEN_AT_ADOPTION` here (Step 20's `grep` counts it).
   - `ActivateBracket` with a stop and a take-profit id: the `order_brackets` row reads back status ACTIVE (3) with both leg ids (`GetBracketByOrderID`), and `bracket_legs` holds two rows with `filled_qty` 0, `observed_filled_qty` 0, `status` OPEN, `adopted` false, the parent's account, order id, user, trading mode and symbol, and the leg side the caller passed.
   - Duplicate guard: `ActivateBracket` twice with the same ids leaves two rows; between the calls `AdvanceLegEmit` moves one leg's cursor to 4, and the second `ActivateBracket` leaves that `filled_qty` at 4 (`ON CONFLICT DO NOTHING` does not reset it).
   - An empty take-profit id writes one `bracket_legs` row and leaves `order_brackets.take_profit_leg_order_id` NULL. `GetBracketByOrderID` reads NULL back as `''`, so assert this with a raw `SELECT take_profit_leg_order_id IS NULL FROM trading.order_brackets WHERE id = $1` on the pool.
   - Atomicity: `ActivateBracket` with a valid stop and take-profit id and a `BracketLegParent` whose `Symbol` contains a NUL byte. The UPDATE of `order_brackets` does not use that field, so it succeeds first and only the following `INSERT INTO trading.bracket_legs` can fail. Assert the error is a `*pgconn.PgError` (through `errors.As`, so it came from the server; SQLSTATE `22021`), that the bracket row still has its pre-call status and its pre-call leg ids (the UPDATE was rolled back), and that no `bracket_legs` row exists for either leg. A NUL in a stop or take-profit id is not a valid injection: those parameters are also bound in the UPDATE (`bracket_repo.go:94-95`), which would fail before the INSERT and never exercise the rollback. If the driver rejects the value client-side and no `PgError` is returned, use another failure only the INSERT sees (for example a `parent.OrderID` that is not a UUID) and keep the same three assertions; do not weaken them to "an error occurred".
   - `ListTrackedLegs`: seed one OPEN leg and one leg per member of `RetiredLegStatuses`; only the OPEN leg is returned, and an adopted OPEN leg sorts after a non-adopted one, and of two non-adopted legs written by separate `ActivateBracket` calls the earlier-written one comes first (`adopted ASC, updated_at ASC`).
   - `ListAdoptionCandidates(ctx, []int32{3, 4})`: seed (a) an ACTIVE bracket whose parent order has two `trading.orders` rows with different `created_at` and different `side` (the latest row's side decides: the candidate's side is its opposite), (b) a CANCELING bracket, (c) a CANCELED (5) bracket, (d) an ACTIVE bracket seeded by `CreateBracket` with only a stop id, which stores `''` in the take-profit column (one candidate, no empty-id candidate), (e) an ACTIVE bracket whose stop id already has a `bracket_legs` row (no candidate for that id, one for the other), (f) an ACTIVE bracket with no parent order (no candidate). Assert the exact set of `(leg id, side, symbol)`; the status argument is bound as a parameter, so `[]int32{3}` drops (b).
   - `InsertAdoptedLeg`: the first call returns `inserted` true with `adopted` true and the status and quantities from the record; the second returns false and changes nothing; a leg inserted with a retired status is absent from `ListTrackedLegs` and from `ListAdoptionCandidates`.
   - `RecordLegObservation` writes `observed_filled_qty` and `not_found_ticks` and leaves `filled_qty`; `AdvanceLegEmit` to 4 with the tracked status, then to 10 with `FILLED`, reads back 10 and `FILLED`, and the leg leaves `ListTrackedLegs` (`@AC-5` at the SQL layer).
3. `trading_repo_legs_dbtest_test.go`: `repo := NewTradingRepoWithDB(pool)`, each case once per `execModes()` entry.
   - `KnownBrokerOrderIDs(account, ids)` returns exactly: the `broker_order_id` of a seeded order; a stop and a take-profit id held only by `order_brackets`; a leg id held only by `bracket_legs` after `UpdateBracketStatus(…, "", "", "")` blanked the bracket's copy (a resize); a retired `bracket_legs` row's id (a tombstone stays known); and not an id nobody holds, not the same ids queried under another account, and no empty-string or NULL member for a bracket whose leg columns are `''` (seeded by `CreateBracket` with an empty id) or NULL (made by `UpdateBracketStatus` with empty ids).
   - `NetFilledQtyBySymbol(account, symbols)`: for one symbol seed a buy order of 10, a sell order of 3 stored as two rows with different `created_at` (the later one has the final `filled_qty`, so the `DISTINCT ON` subquery counts the order once), and a sell leg with `filled_qty` 0 but `observed_filled_qty` 4 (the observed column is summed, not the cursor): expect `10 - 3 - 4 = 3`. A retired leg with `observed_filled_qty` 0 leaves it at 3; a leg of another account and a leg of a symbol outside `symbols` change nothing; a symbol held only by a leg appears in the result with the signed leg quantity.
4. `trading_repo.go:17-18`: delete the parenthetical `(this service has no live-DB test harness)`, which this step makes false, and add no replacement comment. The comment becomes `// dbQuerier is the query subset extracted so the LATERAL-join reads can be exercised with pgxmock.` and `// Both *pgxpool.Pool and pgxmock satisfy it.` No other edit to this file.
   Test function names (the `-run 'BracketLegsDB|TradingRepoLegsDB'` filter in Steps 21 and 22 matches these; each runs its `execModes()` entries through `t.Run`): in `bracket_legs_dbtest_test.go` `TestBracketLegsDB_ActivateRows`, `TestBracketLegsDB_ActivateDuplicateGuard`, `TestBracketLegsDB_ActivateEmptyTakeProfit`, `TestBracketLegsDB_ActivateRollsBack`, `TestBracketLegsDB_ListTrackedLegs`, `TestBracketLegsDB_ListAdoptionCandidates`, `TestBracketLegsDB_InsertAdoptedLeg`, `TestBracketLegsDB_ObservationAndEmitCursor`; in `trading_repo_legs_dbtest_test.go` `TestTradingRepoLegsDB_KnownBrokerOrderIDs` and `TestTradingRepoLegsDB_NetFilledQtyBySymbol`.
5. C-13: the prefix constant and `execModes` are used by two test files in one package, so they live in `dbtest_helpers_test.go` once. The order and bracket literals are one-consumer, inline in the seed helpers. No second inline copy of any of them.

**Verification**:
```bash
cd services/xstockstrat-trading && GOWORK=off go vet -tags dbtest ./internal/repository/...
cd services/xstockstrat-trading && GOWORK=off go test -tags dbtest -list 'BracketLegsDB|TradingRepoLegsDB' ./internal/repository/...   # names the new cases
grep -rln 'TRADING_DB_TEST_URL' services/xstockstrat-trading/internal --include=*_test.go | wc -l   # 1: only the helper file reads it
grep -rn 'NOT_OPEN_AT_ADOPTION' services/xstockstrat-trading/internal --include=*_test.go | wc -l   # 0 in the new files
# with a migrated database available:
cd services/xstockstrat-trading && TRADING_DB_TEST_URL=<url> GOWORK=off go test -tags dbtest -race -count=1 -v ./internal/repository/... -run 'BracketLegsDB|TradingRepoLegsDB' > "${TMPDIR:-/tmp}/trading-dbtest.out"; echo "exit $?"   # exit 0
grep -c -- '--- SKIP' "${TMPDIR:-/tmp}/trading-dbtest.out"   # 0; unanchored, so an indented subtest skip counts
cd services/xstockstrat-trading && GOWORK=off golangci-lint run --modules-download-mode=mod --build-tags dbtest
cd services/xstockstrat-trading && GOWORK=off COVERPKGS=$(go list ./... | grep -Ev '/(cmd|handler|repository|telemetry|service)(/|$)' | tr '\n' ',' | sed 's/,$//') && go test ./... -race -count=1 -coverprofile=coverage.out -covermode=atomic -coverpkg="${COVERPKGS}" && go tool cover -func=coverage.out | grep "^total:"   # >= 40%; the untagged run never compiles the dbtest files
```
Never start a database for this step. Without `TRADING_DB_TEST_URL` the compile check and the case listing pass and the `trading-db-test` job (Step 22) runs the cases. New logic is in an excluded package (`repository`) — no coverage threshold applies to it.

---

### Step 22 — config: CI job `trading-db-test` and the lint build tag

**Status**: `pending`
**Service**: `xstockstrat-trading` (CI and lint configuration only)
**Files**:
- `.github/workflows/ci.yml` — modify
- `services/xstockstrat-trading/.golangci.yml` — modify

**Reviewers**: xstockstrat-trading owner — fill detection, order execution correctness

**Codebase Evidence**:
- Job to clone: `portfolio-db-test` at `.github/workflows/ci.yml:1016-1065` on `fb52065c` (comment `:1016`, key `:1017`, `name:` `:1018`). Its `if:` ORs five filters (`xstockstrat-portfolio`, `migrations`, `proto`, `ci`, `go-shared`) from `needs.changes.outputs.matched`; it has the `timescale/timescaledb:latest-pg16` service with `pg_isready` health options, `actions/checkout@v7`, `actions/setup-go@v7` (go `"1.27"`, `cache-dependency-path: services/xstockstrat-portfolio/go.sum` at `:1047`), the "Build migrator image" and "Apply migrations" steps (`docker build -f scripts/Dockerfile.migrate`, `docker run --rm --network host … xstockstrat-migrate-ci`), and a `go test -tags dbtest` step with `GOWORK: "off"`, `CI: "true"` and `PORTFOLIO_DB_TEST_URL` (`:1064`).
- `marketdata-db-test` is the second clone of it, `:1067-1116`; `markdown-lint` starts at `:1118`, so the new job goes between them.
- The `xstockstrat-trading` path filter exists (`ci.yml:53`, `['services/xstockstrat-trading/**']`); `migrations` (`:88-97`) already covers `services/*/migrations/**`. `services/xstockstrat-trading/go.sum` exists.
- `ci-gate` (`:1377`): `needs:` lists `- portfolio-db-test` (`:1396`) and `- marketdata-db-test` (`:1397`); the evaluate step echoes both (`:1429-1430`); the gate fails only on `failure` or `cancelled` (`:1444-1447`), so a skipped job passes.
- `services/xstockstrat-portfolio/.golangci.yml:28-29`: `run: build-tags: [dbtest]`, which makes the `go-lint` job lint dbtest files. `services/xstockstrat-trading/.golangci.yml` ends with `run: timeout: 5m` and has no `build-tags` (marketdata's has none either; out of scope).
- `.github/workflows/ci.yml` and `docs/patterns/ci-overview.md` are unchanged between `fb52065c` and `origin/main-dev@2b2dec92` (`git diff --stat fb52065c origin/main-dev -- .github docs/patterns/ci-overview.md` shows no entry for either).
- The test-only env var `TRADING_DB_TEST_URL` is read by the Step 21 helper alone. It is not a service env var, so `docker-compose.yml`, `.do/app.dev.yaml` and `.do/app.yaml` get no entry, as for `PORTFOLIO_DB_TEST_URL` and `MARKETDATA_DB_TEST_URL` (confirmed absent: `git grep -n 'DB_TEST_URL' origin/main-dev -- docker-compose.yml .do` returns nothing). No config key, port or proto is touched.

**TDD**: `N/A (CI workflow and lint configuration; no executable logic)` — the first green run of the job on the integration PR is the proof, and Step 21's `-list` check proves the job's package pattern reaches the cases.

**Covers**: —

**Instructions**:
1. After `marketdata-db-test` (`:1116`) and before `markdown-lint` (`:1118`), add a job `trading-db-test`, cloned from `portfolio-db-test`, under the same comment line (`# Real-Postgres repository tests (//go:build dbtest); excluded from the go-lint coverage run.`):
   - `name: Trading DB test (TimescaleDB)`; `needs: changes`; `if:` the same five-term OR with `xstockstrat-trading` in place of `xstockstrat-portfolio`.
   - The `timescaledb` service block, `actions/checkout@v7`, "Build migrator image" and "Apply migrations" steps copied unchanged (the migrator applies every service's migrations, so trading `012` from Step 2 is present).
   - `actions/setup-go@v7` with `go-version: "1.27"` and `cache-dependency-path: services/xstockstrat-trading/go.sum`.
   - Step `go test -tags dbtest`, `working-directory: services/xstockstrat-trading`, `env:` `GOWORK: "off"`, `CI: "true"`, `TRADING_DB_TEST_URL: postgres://xstockstrat:ci-only@localhost:5432/xstockstrat?sslmode=disable`, `run: go test -tags dbtest -race -count=1 ./internal/repository/...`. Only `./internal/repository/...`: Step 21's cases live there, and `internal/service` needs the mTLS `TestMain` environment (A-16).
2. `ci-gate`: add `      - trading-db-test` after `- marketdata-db-test` (`:1397`), and `          echo "trading-db-test: ${{ needs.trading-db-test.result }}"` after the marketdata echo (`:1430`).
3. `services/xstockstrat-trading/.golangci.yml`: under `run:` add `build-tags:` with `- dbtest`, the portfolio form (`:28-29`), so CI lints the Step 21 files.
4. The job cannot run locally. In the integration PR description, quote the job's result and state that it ran the Step 21 cases with none skipped (the helper is fatal under `CI=true` when the URL is unset, so a skip cannot pass silently).

**Verification**:
```bash
grep -c 'trading-db-test' .github/workflows/ci.yml   # 3 lines: the job key, the needs entry, the echo
grep -n 'TRADING_DB_TEST_URL' .github/workflows/ci.yml   # 1 line, in the new job
grep -n 'go test -tags dbtest' .github/workflows/ci.yml   # 6 lines: the step name and the run line of portfolio, marketdata and trading
grep -n -A1 'build-tags' services/xstockstrat-trading/.golangci.yml   # the dbtest entry
cd services/xstockstrat-trading && GOWORK=off go test -tags dbtest -list 'BracketLegsDB|TradingRepoLegsDB' ./internal/repository/...   # the job's package pattern reaches Step 21's cases
cd services/xstockstrat-trading && GOWORK=off golangci-lint run --modules-download-mode=mod
```
No Go coverage threshold applies to this step: it edits no Go source, and the untagged coverage run never compiles the dbtest files.

---

### Step 23 — service: bracket-leg fill observer

**Status**: `pending`
**Service**: `xstockstrat-trading`
**Files**:
- `services/xstockstrat-trading/internal/service/trading.go` — modify

**Reviewers**: xstockstrat-trading owner — fill detection, broker API safety

**Codebase Evidence**:
- `trading.go:1793-1814` `StartFillPoller` — must gain no hunk (294 `@AC-6`).
- `:1816-1878` `pollFills`: `:1819-1828` builds `brokerMap` without OFFLINE accounts; `:1877` `s.logTick(ctx, telemetry.LoopFillPoller, start, len(candidates), polled, failed)` is its last statement.
- `:1866-1868`: `pollCtx, cancelPoll := s.alpacaCallContext(ctx, entry)` around `GetOrder`; `:1476-1481` `alpacaCallContext`.
- `:1898` `applyBrokerOrderStatus` and `:3638` `maybeSubmitBracket` — the observer must call neither (D-3).
- `:1930-1942` the parent `order.filled` payload keys: `order_id, symbol, qty, fill_price, user_id, trading_mode, account_id, fees`, and `side` when set; `:1952-1963` the `order.partially_filled` keys with `filled_qty`.
- `:3915-3936` `alpacaStatusToProto`; `ibkr.go:443,479` pass the IBKR status through raw (A-4).
- `:3953` `appendLedgerEvent` (keyed after Step 16); `:3940` `ledgerEmitTimeout`, `:3943` `appendMaxAttempts`.
- `:201` `s.clock()`.
- Fixtures that call `pollFills`, from `grep -rn 'pollFills(' services/xstockstrat-trading/internal --include=*_test.go`: `trading_telemetry_test.go:612-613,687,689,743,748`, `trading_order_race_test.go:30`, `trading_rate_limit_test.go:372`.

**Lands with**: `Step 24`

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
Trading-domain notes: both brokers are observed through `Broker.ListOrders` and `Broker.GetOrder`. No order is placed, so there is no trading-mode gate; the leg's stored `trading_mode` is copied into the event. Order types: only bracket stop and take-profit legs are observed. Fill state: `PARTIALLY_FILLED` and `FILLED` are both handled, as below.
1. Add `func (s *TradingService) pollBracketLegFills(ctx context.Context, brokerMap map[string]brokerPoolEntry)` and call it as the last statement of `pollFills`, after `logTick` (D-22). It never changes `polled`, `failed` or the tick record, and makes no hunk in `StartFillPoller`.
2. It never calls `applyBrokerOrderStatus` or `maybeSubmitBracket`, and never writes `s.orders` or `trading.orders` (D-3, D-41).
3. Each tick: `ListTrackedLegs`. A query error is one WARN and the tick ends. Group the legs by account. An account with no entry in `brokerMap` is skipped.
4. Per account: one `entry.client.ListOrders` inside `s.alpacaCallContext(ctx, entry)` (D-11, A-7). On error: `broker.ErrInvalidCredentials` is a WARN and a skip; any other error is a WARN and a skip. A failed list retires nothing (R-10).
5. Legs present in the list are processed from the listed order. Legs absent from a successful list go to the `GetOrder` fallback: at most `legGetOrderFallbackCap` (5, A-3) per account per tick, in `ListTrackedLegs` order (rows written by `ActivateBracket` before adopted rows, least recently updated first).
   - `errors.Is(err, broker.ErrOrderNotFound)`: `not_found_ticks + 1`; at 3 retire the leg `UNKNOWN` with a WARN (D-26). Only Alpaca produces this error (Step 14), so an IBKR leg never retires this way.
   - Any other error: WARN, no change.
   - Success: reset `not_found_ticks` to 0 and process the order.
6. Processing one observed order for a leg:
   - Always `RecordLegObservation` with `observed_filled_qty = brokerOrder.FilledQty` (D-37).
   - Status: map `strings.ToLower(brokerOrder.Status)` through `alpacaStatusToProto` in one helper (A-4). `UNSPECIFIED` and `NEW` are open (D-19: held and unrecognised statuses stay non-terminal).
   - `PARTIALLY_FILLED` with `FilledQty` above the row's `filled_qty`: emit `order.partially_filled`; on success `AdvanceLegEmit` to `FilledQty`, status `OPEN`.
   - `FILLED`: emit `order.filled`; on success `AdvanceLegEmit` to `FilledQty`, status `FILLED`.
   - `CANCELED`, `EXPIRED`, `REJECTED`: if `FilledQty` is above the cursor, emit `order.partially_filled` first; then retire with that status. If the emit fails, do not retire.
7. Events (D-4 as amended by D-28, D-16, D-38):
   - `order_id` and the stream key are the leg id. `user_id`, `trading_mode`, `account_id` and `symbol` come from the leg row. `side` is always set, as `leg.Side.String()`.
   - `order.filled`: `qty` = the leg total (`brokerOrder.FilledQty` at FILLED), `fill_price` = `brokerOrder.FilledAvgPrice` (the cumulative average), `fees` = `brokerOrder.Fees`.
   - `order.partially_filled`: `filled_qty` = the cumulative `brokerOrder.FilledQty`, `fill_price`, `fees`.
   - Emit synchronously with `s.appendLedgerEvent(ctx, eventType, legID, leg.UserID, key, payload)`, where `key` is `bracket-leg:<account_id>:<legID>:<filled|partially_filled>:<filledQty>` with the quantity formatted by `strconv.FormatFloat(q, 'f', -1, 64)`. This is not fire-and-forget (R-3; PLAT-N1 exception recorded in `design.md`).
   - The leg row advances only after a nil return. After the first emit failure in a tick, skip every further leg emit in that tick; observations are still written (D-15).
8. No new outbound service edge: the ledger client and its header propagation are the ones `appendLedgerEvent` already uses.

**Verification**:
```bash
cd services/xstockstrat-trading && GOWORK=off go build ./...
git diff origin/main-dev -- services/xstockstrat-trading/internal/service/trading.go | grep -c 'func (s \*TradingService) StartFillPoller'   # 0: no hunk header or line touches StartFillPoller
grep -n 'pollBracketLegFills' services/xstockstrat-trading/internal/service/trading.go   # definition + one call after logTick
grep -n 'applyBrokerOrderStatus\|maybeSubmitBracket' services/xstockstrat-trading/internal/service/trading.go | grep -c pollBracketLegFills   # 0
cd services/xstockstrat-trading && GOWORK=off golangci-lint run --modules-download-mode=mod
```

---

### Step 24 — test: leg observer and its ledger events

**Status**: `pending`
**Service**: `xstockstrat-trading`
**Files**:
- `services/xstockstrat-trading/internal/service/trading_bracket_leg_poll_test.go` — create
- `services/xstockstrat-trading/internal/service/trading_bracket_test.go` — modify
- `services/xstockstrat-trading/internal/service/trading_telemetry_test.go` — modify
- `services/xstockstrat-trading/internal/service/trading_order_race_test.go` — modify
- `services/xstockstrat-trading/internal/service/trading_rate_limit_test.go` — modify

**Reviewers**: xstockstrat-trading owner — fill detection, broker API safety

**Codebase Evidence**:
- `trading_bracket_test.go:26-35` `fakeBroker` has `getOrderFn` and no list hook; `:89-91` `ListOrders` panics on purpose. `trading_reconciliation_test.go:87-111` `fakeReconciliationBroker.listOrdersFn` is the precedent.
- `trading_telemetry_test.go:600-613`: a fixture that sets `bracketRepo: &fakeBracketRepo{}` and a `recordingLedgerClient`; `:680-689` a fixture with no `bracketRepo`; `:743-748` two struct literals with only `brokers` and `orders`.
- `trading_order_race_test.go:30` and `trading_rate_limit_test.go:372` call `pollFills`; `trading_rate_limit_test.go:172` builds its service literal.
- `trading_fill_side_test.go:15` and `trading_fees_test.go` assert the parent fill payload shape (251 `@AC-10`).
- `trading_telemetry_test.go:594-620` uses the injected clock.

**Lands with**: `Step 23`

**TDD**: `red-green required`

**Covers**: `AC-4, AC-5`

**Instructions**:
1. `fakeBroker`: add `listOrdersFn` and call counters for `ListOrders` and `GetOrder`. With no `listOrdersFn` it keeps panicking, so a test that reaches the list by accident still fails loudly.
2. Fixtures: every `pollFills` fixture named above gets `bracketRepo: &fakeBracketRepo{}` where it is nil. Fixtures that hold tracked legs get a `listOrdersFn`. Per the fails ledger (2026-11-16, feature 347), run the whole package and add any other fixture the run shows to this step's files; do not add a nil guard to production code.
3. New tests, both brokers where the path differs:
   - `@AC-4`: a tracked take-profit leg (entry buy 10 at 100) listed `filled` 10 at 110. One ledger append with event type `order.filled`, stream key and `order_id` = the leg id, `symbol`, `side` `ORDER_SIDE_SELL`, `qty` 10, `fill_price` 110, and the parent's `account_id`, `trading_mode` and `user_id`. The leg row is `FILLED` with `filled_qty` 10. Run once with an Alpaca entry and once with an IBKR entry whose status is `Filled`.
   - `@AC-5`: tick 1 lists the leg `partially_filled` 4 at 110, tick 2 lists it `filled` 10 at 110. The ledger holds `order.partially_filled` with `filled_qty` 4, then `order.filled` with `qty` 10 and `fill_price` 110. A third tick appends nothing.
   - 251 `@AC-10` EXTEND: the leg payloads carry `side`, `fees` and source service `xstockstrat-trading`.
   - Key: the idempotency key is `bracket-leg:<account>:<leg>:filled:10`; two accounts with the same leg id get different keys (D-28).
   - A leg already `FILLED` on its first observation after activation emits once (D-19).
   - Emit failure: the leg row does not advance, `observed_filled_qty` is still written, and no further leg emit happens in that tick; the next tick emits with the same key (D-15).
   - Cancel with a partial fill: `order.partially_filled`, then status `CANCELED`.
   - Unrecognised and `held` statuses stay open.
   - Fallback: a leg absent from a successful list gets one `GetOrder`; six absent legs get five calls; rows written by `ActivateBracket` are called before adopted rows.
   - Not found: Alpaca `ErrOrderNotFound` on three consecutive ticks retires the leg `UNKNOWN`; a success in between resets the count; an IBKR ordinary error never retires.
   - `ListOrders` error: nothing retired, one WARN; `ErrInvalidCredentials` is a WARN and a skip.
   - One `ListOrders` per account per tick; an account with no tracked legs gets none.
   - 294 `@AC-6`: the fill-poller tick record and the parent counts are the same with and without tracked legs.
   - 347 `@AC-34`: the existing rate-limit poller test (`trading_rate_limit_test.go:372`) passes unchanged in its assertions.
4. C-13: leg fixtures have one consumer (the new file) and stay inline.

**Verification**:
```bash
cd services/xstockstrat-trading && GOWORK=off go test ./internal/service/ -race -count=1
cd services/xstockstrat-trading && GOWORK=off golangci-lint run --modules-download-mode=mod
cd services/xstockstrat-trading && GOWORK=off COVERPKGS=$(go list ./... | grep -Ev '/(cmd|handler|repository|telemetry|service)(/|$)' | tr '\n' ',' | sed 's/,$//') && go test ./... -race -count=1 -coverprofile=coverage.out -covermode=atomic -coverpkg="${COVERPKGS}" && go tool cover -func=coverage.out | grep "^total:"   # >= 40%
```
New logic is in an excluded package — no coverage threshold applies to it.

---

### Step 25 — service: shared poll-throttle helper and adoption state

**Status**: `pending`
**Service**: `xstockstrat-trading`
**Files**:
- `services/xstockstrat-trading/internal/service/trading.go` — modify

**Reviewers**: xstockstrat-trading owner — broker API safety

**Codebase Evidence**:
- `trading.go:180-183`: `haltedLastPolled map[string]time.Time` and `haltedMu sync.Mutex`; `:284` initialises the map in the constructor.
- `:2953-2964` `shouldPollHaltedAccount(accountID string, intervalMs float64) bool`: `now := time.Now()`; under `haltedMu`, returns false when `intervalMs > 0` and the last poll is within the interval; otherwise stamps and returns true.
- `:2977` `haltAccount` pre-stamps `haltedLastPolled` (`:2988`); `:3295` `ResumeAccountSvc` deletes the entry (`:3322`, TRADING-N2).
- `trading_reconciliation_test.go:514-537` `TestShouldPollHaltedAccount_ThrottlesAndRecovers` builds the service as a literal with only `halted` and `haltedLastPolled`.

**Lands with**: `Step 26, Step 27`

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. Move the body of `shouldPollHaltedAccount` into one helper that takes the last-polled map, the account id, `intervalMs` and `now time.Time`, and runs under `haltedMu` (D-50, O-68). It creates a nil map before writing, so struct-literal fixtures need no change.
2. `shouldPollHaltedAccount` keeps its signature and behaviour: it calls the helper with `s.haltedLastPolled` and `time.Now()`.
3. Add two fields guarded by `haltedMu`: `adoptionLastListed map[string]time.Time` and `adoptionLastCandidates map[string]map[string]struct{}` (the candidate id set seen at the account's last allowed list). They are in memory only and empty at boot.
4. Do not route adoption through `haltedLastPolled` (R-40). Do not change `haltAccount`, `ResumeAccountSvc` or `reconcileTick`.

**Verification**:
```bash
cd services/xstockstrat-trading && GOWORK=off go build ./...
cd services/xstockstrat-trading && GOWORK=off go test ./internal/service/ -race -count=1 -run 'ShouldPollHaltedAccount|ReconcileTick_HaltedAccount'   # unchanged tests pass
cd services/xstockstrat-trading && GOWORK=off golangci-lint run --modules-download-mode=mod
```

---

### Step 26 — service: adoption of pre-existing open legs

**Status**: `pending`
**Service**: `xstockstrat-trading`
**Files**:
- `services/xstockstrat-trading/internal/service/trading.go` — modify

**Reviewers**: xstockstrat-trading owner — fill detection, broker API safety

**Codebase Evidence**:
- `trading.go:2011-2033` `StartReconciliationPoller`: `s.cfgW.GetFloat("reconciliation.interval_ms", defaultIntervalMs)` with `defaultIntervalMs = 60000.0` (`:2012`, `:2023`); a value `<= 0` keeps the previous interval (`:2024`).
- `:2678-2679` `haltedPollInterval()` reads `reconciliation.halted_poll_interval_ms`, default 300000.
- `:2166-2171` copies `s.credStatus` under `credStatusMu`; `:2178` `credentialsKnownInvalid(credStatus[accountID])` skips before the list; `:2194-2197` `broker.ErrInvalidCredentials` is a WARN and a skip with no failure count; `:3235` `credentialsKnownInvalid`.
- `:2945-2949` `isAccountHalted`.
- `:3572-3573` `bracketStatusActive`, `bracketStatusCanceling`.
- `internal/config/watchcore.go:406-419` `GetFloat` widens an int value; `internal/config/config.go:119` `MustSnapshotWatcher(ns, values)` is the test seam for a set key.
- `ibkr.go:448-483`: an empty slice with a nil error on a 200 with no orders. `broker.ListOrdersLimit` (Step 14) is the Alpaca ceiling.
- Config contract (C-05; no key is added, R-39): namespace `trading`, keys `reconciliation.interval_ms` (float, code default 60000) and `reconciliation.halted_poll_interval_ms` (float, code default 300000), both already seeded and documented at `services/xstockstrat-trading/CLAUDE.md:95,98`, read live on each tick.

**Lands with**: `Step 25, Step 27`

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
All changes are inside `pollBracketLegFills`; no hunk in `StartFillPoller` or `reconcileTick` (D-50).
1. At the start of each tick, call `ListAdoptionCandidates(ctx, []int32{bracketStatusActive, bracketStatusCanceling})`. On error: log once, adopt nothing this tick, and still list and observe tracked accounts (D-46).
2. Account sets: tracked = accounts with at least one row from `ListTrackedLegs`; adoption-only = accounts with candidates and no tracked row.
3. Tracked account: its one `ListOrders` of the tick (Step 23) is shared with adoption; no extra call.
4. Adoption-only account — list only when allowed, checked in this order:
   1. `credentialsKnownInvalid(credStatus[accountID])`: skip, no list, no log (O-68).
   2. Interval: `haltedPollInterval()` when `isAccountHalted(accountID)`, where `<= 0` means always list. Otherwise `s.cfgW.GetFloat("reconciliation.interval_ms", 60000)`, and a value `<= 0` is read as 60000 (O-68).
   3. New-candidate bypass (O-67): if the account's current candidate id set contains an id that is not in `adoptionLastCandidates[accountID]`, list now.
   4. Otherwise the Step 25 helper over `adoptionLastListed` with `now = s.clock()`.
   - When the list is allowed, stamp `adoptionLastListed` and store the current candidate set before the call, so a failed list is throttled too.
   - `broker.ErrInvalidCredentials` from the list: WARN and skip, no failure count. Any other error: WARN. Nothing is inserted (R-10).
5. Classify each candidate against the account's successful list only. Adoption makes no `GetOrder` call (D-40).
   - Listed, open (the Step 23 status helper; `held` and unrecognised count as open), `FilledQty == 0`: `InsertAdoptedLeg` with status `OPEN`, both quantities 0.
   - Listed, open, `FilledQty > 0`: `InsertAdoptedLeg` with status `BASELINE_RETIRED`, `filled_qty = 0`, `observed_filled_qty = FilledQty`, no emit (R-7, R-12).
   - Listed, terminal: tombstone — status `NOT_OPEN_AT_ADOPTION`, both quantities 0, no emit (D-48, R-36).
   - Absent from the list: tombstone only when the list is non-empty and, for a non-IBKR account, shorter than `broker.ListOrdersLimit` (D-49). Otherwise insert nothing; the candidate is evaluated again on the account's next adoption list.
6. One INFO log per tombstone with `reason` (`listed_terminal` or `absent`), `account_id`, `leg_order_id` and the bracket `order_id` (O-66).
7. A failed `InsertAdoptedLeg`: one WARN for the tick; the candidate is retried next tick; tracked-leg observation in the same tick is unaffected (D-48).
8. A leg adopted `OPEN` is observed from the next tick, and its account is then tracked and listed every tick. The D-15 emit stop does not stop adoption inserts.
9. History is forward-only: nothing is emitted for a leg that was not open on its adoption tick (D-42).

**Verification**:
```bash
cd services/xstockstrat-trading && GOWORK=off go build ./...
git diff origin/main-dev -- services/xstockstrat-trading/internal/service/trading.go | grep -c 'func (s \*TradingService) reconcileTick\|func (s \*TradingService) StartFillPoller'   # 0
grep -rn 'adoption' services/xstockstrat-trading/migrations/ | grep -ci 'config'   # 0: no config key or seed added
cd services/xstockstrat-trading && GOWORK=off golangci-lint run --modules-download-mode=mod
```

---

### Step 27 — test: adoption classifier, complete-list gate and throttle

**Status**: `pending`
**Service**: `xstockstrat-trading`
**Files**:
- `services/xstockstrat-trading/internal/service/trading_bracket_adoption_test.go` — create
- `services/xstockstrat-trading/internal/service/trading_reconciliation_test.go` — modify

**Reviewers**: xstockstrat-trading owner — fill detection, broker API safety

**Codebase Evidence**:
- `trading_reconciliation_test.go:491-513` `TestShouldPollHaltedAccount_ThrottlesAndRecovers` (the design cites it at its older lines `486-503`); it must pass unchanged.
- `internal/config/config.go:119` `MustSnapshotWatcher("trading", map[string]*configv1.ConfigValue{…})` takes namespace-relative keys and panics on a prefixed one.
- `trading_telemetry_test.go:594-620`: the injected clock (`s.clock()`), advanced without sleeping.
- `fakeBroker` list hook and counters (Step 24); `fakeBracketRepo` candidate query, tombstone insert and error hooks (Step 20).

**Lands with**: `Step 25, Step 26`

**TDD**: `red-green required`

**Covers**: — (adoption has no `@AC` of its own; it guards 206 trading `@AC-1..3` and the D-42 forward-only ruling)

**Instructions**:
Each throttle test asserts the `ListOrders` call count over N ticks and advances the injected clock; none writes the maps directly. Config values are set with `MustSnapshotWatcher` using the relative keys, so they go through `GetFloat`.

Round-8 and round-9 cases:
- Open candidate at fill 0 is adopted `OPEN` with `adopted = true`, exactly one `ListOrders`, no `GetOrder`.
- Open candidate at fill > 0 is `BASELINE_RETIRED` with no ledger append and `observed_filled_qty = FilledQty`.
- A bracket with status CANCELED or FAILED is never a candidate.
- A second adoption run is a no-op.
- A `held` leg at fill 0 is adopted as tracked.
- An adopted leg's later fill emits the full payload of Step 23.
- An account with no candidates and no tracked rows gets no `ListOrders`.
- Candidate query error: tracked accounts are still listed and observed, nothing is adopted, one log.

Round-10 cases (1-7; 8-9 are in Step 20 as pgxmock and in Step 21 against a real database):
1. Candidate listed `filled` or `canceled`: one tombstone row, both quantities 0, `adopted = true`, no append, no `GetOrder`; on the next tick the account gets no `ListOrders` and is no longer a candidate.
2. Candidate absent from a 499-row Alpaca list: tombstone.
3. Alpaca list of exactly 500 rows without the candidate: no insert.
4. Empty IBKR 200: no insert.
5. `ListOrders` error: no insert; the candidate is still present.
6. Tombstone insert error: one WARN, retried next tick, tracked legs still observed.
7. Mixed account (one tracked leg, one tombstone, one new open candidate): exactly one `ListOrders`; the tombstone never enters the `GetOrder` fallback.

Round-11 cases (11-20):
11. Adoption-only Alpaca account, 500-row list without the candidate, interval 60000, three ticks: 1 `ListOrders`, no insert.
12. Idle IBKR, empty 200, interval 60000, three ticks: 1 call, no tombstone; after the clock passes the interval the next tick lists again.
13. `reconciliation.interval_ms` = 0, not halted, three ticks: 1 call. `reconciliation.halted_poll_interval_ms` = 0 on a halted adoption-only account: 3 calls.
14. Tracked account with one candidate, interval 60000: 3 calls over 3 ticks, adoption runs on each.
15. Halted adoption-only account, `halted_poll_interval_ms` 300000: 1 call over 3 ticks.
16. `ListOrders` errors on tick 1: no call on ticks 2-3, one WARN, nothing inserted.
17. A candidate adopted `OPEN` on tick 1: the account is listed on tick 2 inside the cooldown.
18. The two maps are independent in both directions: an adoption list does not consume the halted reconcile slot, and a reconcile poll does not consume the adoption slot. `TestShouldPollHaltedAccount_ThrottlesAndRecovers` passes unchanged.
19. An adoption-only account inside its cooldown gains a new candidate id: it is listed on the next tick; a third tick with the same set makes no call.
20. An adoption-only account with known-invalid credentials: no `ListOrders`, no WARN. A list that returns `ErrInvalidCredentials`: one WARN and a skip.

Fixture rule (fails.md 2026-11-18, feature 358): set the broker type and `isPaper`-style fields explicitly in each fixture; do not rely on a zero value.

**Verification**:
```bash
cd services/xstockstrat-trading && GOWORK=off go test ./internal/service/ -race -count=1
cd services/xstockstrat-trading && GOWORK=off go test ./internal/service/ -race -count=1 -run 'ShouldPollHaltedAccount'   # unchanged test green
cd services/xstockstrat-trading && GOWORK=off golangci-lint run --modules-download-mode=mod
cd services/xstockstrat-trading && GOWORK=off COVERPKGS=$(go list ./... | grep -Ev '/(cmd|handler|repository|telemetry|service)(/|$)' | tr '\n' ',' | sed 's/,$//') && go test ./... -race -count=1 -coverprofile=coverage.out -covermode=atomic -coverpkg="${COVERPKGS}" && go tool cover -func=coverage.out | grep "^total:"   # >= 40%
```
New logic is in an excluded package — no coverage threshold applies to it.

---

### Step 28 — docs: cutover runbook

**Status**: `pending`
**Service**: `docs/runbooks/`
**Files**:
- `docs/runbooks/position-fold-cutover.md` — create
- `docs/runbooks/CLAUDE.md` — modify
- `docs/roadmap/features/merge-order.md` — modify

**Reviewers**: none

**Codebase Evidence**:
- **Not found**: a runbook for this cutover (`ls docs/runbooks/` has no matching file). `docs/runbooks/delisting-rollout.md` is the nearest precedent for a one-off rollout runbook.
- `docs/runbooks/CLAUDE.md:5-11`: the index table (`| File | Purpose | Key trigger |`).
- `docs/roadmap/features/merge-order.md:431`: the existing entry that names 311's overlap on `trading.go`.
- `.do/app.dev.yaml:101` is the `xstockstrat-portfolio` service block; other components reference `${xstockstrat-portfolio.PRIVATE_DOMAIN}`; `.do/app.dev.yaml:439` gives ledger `${xstockstrat.DATABASE_URL}` and portfolio uses the PgBouncer pool on the same `xstockstrat` cluster (`:701-707`), so on DO staging ledger and portfolio share one Postgres server clock. The homelab compose DSNs are not in this repository and were not checked.
- Operator rulings: `context.md` sessions "operator rulings after round 6" and "production scope" (stop-then-start on staging, no write fence, production check-only).

**TDD**: `N/A (docs)`

**Covers**: —

**Instructions**:
macOS-compatible commands only; no new `.sh` file. Write the runbook with these numbered steps:
1. **Preconditions.** The O-61 confirmations from `design.md` § Open Risks, each as a yes/no line the operator fills in: the DO stop method, the homelab stop method and `gate deploy` exit code, Alpaca listing bracket legs as top-level orders, and trading's behaviour while portfolio is stopped.
2. **Cutover step (D-36, D-43), once per staging target** — DO `xstockstrat-staging` and the homelab staging VM while enabled. Stop portfolio; record `T_stop`; freeze `main-dev`; merge the integration PR; wait for the green Deploy run; start is the deploy itself. Record one result per database: target, `T_stop`, `portfolio.consumer_floors.floor_recorded_at`, the boot log line `order fill floor loaded` with `stamped_now=true`, the count of ledger `order.filled` rows with `recorded_at` in `[T_stop, floor)`, the green deploy run, the `main-dev` SHA at `T_stop`, and the (empty) list of Deploy runs in between. Give the SQL for the floor value and the count.
3. **Accepted consequences.** Fills in `[T_stop, floor)` are acked: quantity heals at the next position sync; their realized P&L is lost. Late appends below the floor are acked. The floor assumes one Postgres server clock for ledger and portfolio.
4. **Rollback rule (D-44).** If a pre-`019` portfolio image ran after the floor was stamped: stop portfolio, `DELETE FROM portfolio.consumer_floors WHERE consumer = 'order_fill'`, repeat step 2.
5. **Production check (D-47).** Before the first production promotion, record the counts of `portfolio.positions` rows and ledger `order.filled` rows on each production database; stop for the operator if either is non-zero. No production stop is designed.
6. **Redeliver a parked fill.** Delete its row from `portfolio.consumer_applied_events` (`outcome = 'parked'`, by key) and restart portfolio.
7. **Undo a tombstone.** Delete the leg's row from `trading.bracket_legs`; the next adoption list evaluates it again.
8. **Not in scope.** Repair of already-inflated `realized_accum`/`fees_accum` (OQ-2), and `instance_count` above 1.

Add the index row to `docs/runbooks/CLAUDE.md`. In `merge-order.md`, add the unenforced checklist item "portfolio stopped on every enabled staging target, `T_stop` recorded, `main-dev` frozen" for 311's integration PR.

**Verification**:
```bash
ls docs/runbooks/position-fold-cutover.md
grep -n 'position-fold-cutover' docs/runbooks/CLAUDE.md
grep -n 'T_stop' docs/roadmap/features/merge-order.md
grep -c 'grep -P\|^pip ' docs/runbooks/position-fold-cutover.md   # 0
grep -n "consumer_floors\|stamped_now\|bracket_legs\|consumer_applied_events" docs/runbooks/position-fold-cutover.md   # all four named
```

---

### Step 29 — docs: service documentation, findings and the CI table

**Status**: `pending`
**Service**: `xstockstrat-portfolio`, `xstockstrat-trading` (docs only)
**Files**:
- `services/xstockstrat-portfolio/CLAUDE.md` — modify
- `services/xstockstrat-portfolio/docs/position-closed-contract.md` — modify
- `services/xstockstrat-portfolio/docs/context-constitution.md` — modify
- `services/xstockstrat-trading/CLAUDE.md` — modify
- `services/xstockstrat-trading/docs/reconciliation.md` — modify
- `services/xstockstrat-trading/docs/context-constitution-findings.md` — modify
- `docs/patterns/ci-overview.md` — modify

**Reviewers**: none

**Codebase Evidence**:
- `services/xstockstrat-portfolio/CLAUDE.md:91-96`: "Ledger Events Consumed" with the `order.filled` and `order.partially_filled` rows; `:132` points to `docs/position-closed-contract.md`.
- `services/xstockstrat-portfolio/docs/position-closed-contract.md`: the "Named v1 scope limitation" paragraph (a short covered by a live buy takes the "buying more" branch). The design says the portfolio `CLAUDE.md` paragraph is rewritten (D-10); on `main-dev` that paragraph now lives in this file.
- `services/xstockstrat-portfolio/docs/context-constitution.md:16`: PORTFOLIO-3 (all consumers resume from an in-memory `lastSeq`).
- `services/xstockstrat-trading/CLAUDE.md:95,98`: the `reconciliation.interval_ms` and `halted_poll_interval_ms` rows (the design cites the drift at its older line `:119`); `:111` the `trading.order_brackets` table note; `:125` the `order.filled` event row.
- `services/xstockstrat-trading/docs/reconciliation.md:76-79`: the residual "Alpaca bracket-leg fills, which never reach `trading.orders`".
- `services/xstockstrat-trading/docs/context-constitution-findings.md`: the defects table (last rows link `docs/reports/2026-10-19-…`).
- `docs/patterns/ci-overview.md:26-28`: the `ledger-db-test`, `portfolio-db-test` and `marketdata-db-test` rows of the CI job table (`| Job | What it checks | Coverage threshold |`); the portfolio and marketdata rows each name the build tag, the command and what the cases cover, and end "gated into `ci-gate`". There is no `trading-db-test` row (**Not found**: `grep -n 'trading-db-test' docs/patterns/ci-overview.md` → nothing).

**TDD**: `N/A (docs)`

**Covers**: —

**Instructions**:
Keep each edit to what changed; facts readable from code stay out.
1. Portfolio `CLAUDE.md`: in the `order.filled` row, state that the live fold is exactly-once per `(consumer, user, account, order_id)` above a boot-stamped floor, signed from `side`, and that the other consumers still replay from 0. Point to the runbook.
2. `position-closed-contract.md`: rewrite the v1 scope-limitation paragraph for the signed fold and the flip (a flip emits `position.closed` for the long, then `position.opened` for a fresh short row; the residual window for a flipped short is named, O-30).
3. `context-constitution.md` PORTFOLIO-3: add that the `order_fill` consumer also dedups through `consumer_applied_events` and a floor, and that `positionsMu` plus `instance_count: 1` stay required for the other consumers.
4. Trading `CLAUDE.md`: add `trading.bracket_legs` beside the `order_brackets` note; state that `order.filled` and `order.partially_filled` are also emitted for bracket legs with the leg id as `order_id`; note that adoption reuses `reconciliation.interval_ms` (a value `<= 0` reads as 60000 for adoption) and the halted interval.
5. `reconciliation.md`: replace the bracket-leg residual with what is now true — tracked legs count through `bracket_legs.observed_filled_qty`; legs outside tracking (the D-42 forward-only gap, `BASELINE_RETIRED` remainders, tombstones) still do not.
6. Trading findings: add rows for (a) the parent `pollFills` IBKR status mapping (`alpacaStatusToProto` does not match IBKR's capitalised statuses; the leg observer lower-cases, the parent path does not), (b) neither broker adapter populates `BrokerOrder.Fees`, (c) the `reconciliation.interval_ms` row implies "every tick" for `<= 0` while the code keeps the previous interval, (d) analysis's `pnl_pattern_consumer` receives leg fill events whose `order_id` is a broker leg id (A-10).
7. `docs/patterns/ci-overview.md`: add a `trading-db-test` row after the `marketdata-db-test` row, in the same form: applies all migrations to TimescaleDB, runs trading Go real-Postgres tests (build tag `dbtest`) `go test -tags dbtest -race ./internal/repository/...` (bracket-leg activation and its duplicate guard, the adoption candidate query, the `KnownBrokerOrderIDs` and `NetFilledQtyBySymbol` unions, the emit cursor); gated into `ci-gate`; threshold `—`.
8. Do not edit the root `CLAUDE.md`: no service, port, config key or dependency edge changed.

**Verification**:
```bash
grep -n 'consumer_applied_events' services/xstockstrat-portfolio/CLAUDE.md services/xstockstrat-portfolio/docs/context-constitution.md
grep -n 'bracket_legs' services/xstockstrat-trading/CLAUDE.md services/xstockstrat-trading/docs/reconciliation.md
grep -c 'buying more' services/xstockstrat-portfolio/docs/position-closed-contract.md   # 0
grep -n 'alpacaStatusToProto\|BrokerOrder.Fees\|pnl_pattern_consumer' services/xstockstrat-trading/docs/context-constitution-findings.md
grep -n 'trading-db-test' docs/patterns/ci-overview.md   # the new row
git diff --stat origin/main-dev -- CLAUDE.md   # empty
```

---

## Deviation Log

_Populated by /sdd-execute as implementation proceeds._

### Step 1 — Verification block exits 1 when it passes (2026-11-27)
- **Spec said**: the block's last command, `grep -ci 'insert into\|create trigger' …019_fill_applied_events.up.sql`, should print `# 0`.
- **Actual**: it prints `0`, and `grep -c` exits 1 when its count is 0. The block therefore exits 1 exactly when this check passes. Every expected value matched: both files are listed, the `019_` count is 2 and the count is 0.
- **Disposition**: judged on the printed values, not on the exit status. The block ran verbatim, and the step body was not changed (F-09). This is an offline migration check: no database was started, and the live apply and rollback are deferred to CI and deploy.

### Step 2 — Verification block exits 1 when it passes (2026-11-27)
- **Spec said**: the block's last command, `grep -ci 'insert into' …012_bracket_legs.up.sql`, should print `# 0`.
- **Actual**: it prints `0`, and `grep -c` exits 1 when its count is 0, so the block exits 1 exactly when this check passes (the same pattern as Step 1). Every expected value matched: both files are listed, the `012_` count is 2 and the count is 0.
- **Disposition**: judged on the printed values, not on the exit status. The block ran verbatim, and the step body was not changed (F-09). This is an offline migration check: no database was started, and the live apply and rollback are deferred to CI and deploy.

### Steps 3+4 — Verification blocks stop after their first line (2026-11-27)
- **Spec said**: Step 3 and Step 4 each give a multi-line block whose lines each start `cd services/xstockstrat-portfolio && …` or name a repo-root-relative path.
- **Actual**: inside the one subshell the first line's `cd` persists, so every later line fails with `cd: services/xstockstrat-portfolio: No such file or directory` (and Step 3's `grep` cannot find its path). Run verbatim, Step 3's block ran only `go build` and `go vet -tags dbtest`; Step 4's block ran only the filtered `go test -race`. Both exited non-zero for this reason alone.
- **Disposition**: each block was run verbatim once, then every line that had not run was run unchanged, alone, from the repo root, with its own log. All passed: `golangci-lint` v2.14.0 printed `0 issues.`, the `Begin` grep printed no line (`portfolio_repo.go` unchanged) and the coverage line printed `total: 79.1%`. The step bodies were not changed (F-09). Step 9's block has the same pattern, so it needs the same per-line run; other steps' blocks were not checked.

### Steps 5+6 — Verification blocks stop after their first line (2026-11-27)
- **Spec said**: Step 5 and Step 6 each give a three-line block whose lines each start `cd services/xstockstrat-portfolio && …` or name a repo-root-relative path.
- **Actual**: the same pattern as Steps 3+4. Inside the one subshell the first line's `cd` persists, so every later line fails with `cd: services/xstockstrat-portfolio: No such file or directory` (Step 5's `grep` prints `No such file or directory`). Run verbatim, Step 5's block ran only `go build` and `go vet -tags dbtest`, and Step 6's block ran only the filtered `go test -race`. Both exited 1 for this reason alone.
- **Disposition**: each block was run verbatim once, then every line that had not run was run unchanged, alone, from the repo root, with its own log. All passed: the `Prune` run printed `ok`, the grep listed every `emitEventAs(` call with six arguments, and `golangci-lint` v2.14.0 printed `0 issues.`. The step bodies were not changed (F-09).

### Steps 7+8 — Verification blocks stop after their first line (2026-11-27)
- **Spec said**: Step 7 and Step 8 each give a three-line block whose lines each start `cd services/xstockstrat-portfolio && …` or name a repo-root-relative path.
- **Actual**: the same pattern as Steps 3-6. Inside the one subshell the first line's `cd` persists, so every later line fails with `cd: services/xstockstrat-portfolio: No such file or directory` (Step 8's `grep` prints `No such file or directory`). Run verbatim, Step 7's block ran only `go build` and `go vet -tags dbtest`, and Step 8's block ran only the filtered `go test -race`. Both exited 1 for this reason alone. Step 8's last line ends in a `#` comment, so the wrapper's closing `)` was put on its own line to keep it out of the comment.
- **Disposition**: each block was run verbatim once, then every line that had not run was run unchanged, alone, from the repo root, with its own log. All passed: the whole-package `-race` run printed `ok`, `golangci-lint` v2.14.0 (the line both blocks share) printed `0 issues.`, and the `RecordedAt` grep printed nothing (`exit=1`, no match: no inline builder outside `testdata`). The step bodies were not changed (F-09).

### Step 10 — re-spec: add `portfolio_fill_floor_test.go` (2026-11-27, operator ruling B)
- Step 10 now lists `portfolio_fill_floor_test.go` and Instruction 8 re-points the `TestFillFloor_SameMillisecondFolds` expectation (`:45`) from the `GetPosition` read to the `FillApplied` pre-check; Steps 9 and 10 stay `pending` and no other step changed.

### Steps 9+10 — Verification blocks stop after their first line (2026-11-27)
- **Spec said**: Step 9 gives a five-line block and Step 10 a five-line block. Each line starts `cd services/xstockstrat-portfolio && …` or names a repo-root-relative path.
- **Actual**: this is the same pattern as Steps 3-8. Inside the one subshell the first line's `cd` persists, so every later line fails with `cd: services/xstockstrat-portfolio: No such file or directory`, and the greps print `No such file or directory`. Run verbatim, Step 9's block ran only `go build` and `go vet -tags dbtest`, and Step 10's block ran only `go test ./internal/... -race`. Both exited 1 for this reason alone.
- **Disposition**: each block was run verbatim once. Then every line that had not run was run unchanged, alone, from the repo root, with its own log. All passed:
  - `golangci-lint` v2.14.0 printed `0 issues.`
  - The three "none" greps printed nothing (`exit=1`, no match).
  - The `instance_count` grep printed the three unchanged `instance_count: 1` lines.
  - The coverage line printed `total: (statements) 79.1%`.
  
  The step bodies were not changed (F-09).

### Step 10 — how Instructions 2, 5 and 8 were met (2026-11-27)
- **Spec said** (Instruction 2): re-point the three DB-error cases at the pre-check error, the `FOR UPDATE` read error and the write error. **Actual**: there are four tests, because the write case is split into the upsert error and the close (`DELETE`) error. This keeps both failed writes from the old suite, and each one still proves that no position event is emitted. `positionRow` lost its last caller and was deleted, because lint flagged it `unused`.
- **Spec said** (Instruction 5): make `runOrderFillBatch` use a DB that supports `Begin`. **Actual**: `syncRecorderDB` in `portfolio_offline_test.go` gained `Begin`. It returns a recording `pgx.Tx`, and `noRow` moved into the same file. `portfolio_telemetry_test.go` needed no edit and is unchanged. `TestOrderFillConsumer_AC56_OneTickRecordPerBatch` still counts 4 `ok` with one tick record.
- **Spec said** (Instruction 8): change only `:45` of `portfolio_fill_floor_test.go`. **Actual**: only that line changed. Its `fillEvent` now carries `order_id`, `side` and an event id (Instruction 2), so the case reaches the pre-check.
- **Disposition**: these stay within the listed **Files** and the instructions' intent. No step body changed.
