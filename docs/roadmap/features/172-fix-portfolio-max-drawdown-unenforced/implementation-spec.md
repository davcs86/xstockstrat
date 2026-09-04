# Implementation Spec: fix-portfolio-max-drawdown-unenforced

**Status**: `pending`
**Created**: 2026-09-04
**Feature**: `docs/roadmap/features/172-fix-portfolio-max-drawdown-unenforced/feature.md`
**Total Steps**: 6
**Feature Branch**: `feature/fix-portfolio-max-drawdown-unenforced`

---

## Execution Summary

Path A (approved design): enforce a **per-account** drawdown WARNING alert over broker-authoritative
`portfolio.account_balances.equity` against a persisted `peak_equity` high-water-mark. Order of work:
(1) migration `016` adds the `peak_equity` column; (2) the repository layer gains the HWM-raising
upsert (`GREATEST`), the new `GetAccountDrawdowns` read, and the interface widening needed to test
both; (3) a pgxmock repository test covers the SELECT shape (`@AC-1` fetch) and the upsert
`GREATEST` contract (`@AC-2`); (4) the service layer adds the pure `evaluateDrawdowns` decision seam
and wires it into `checkRiskLimits`, reusing the existing `emitRiskAlert`; (5) a pure unit test
covers the decision logic (`@AC-1`); (6) docs are reconciled (config-key row, stale findings-doc
line numbers, durable portfolio acceptance suite).

**Consumer surface (C-14):** the product spec's Consumer Surface is the existing `xstockstrat-notify`
alert path (StreamAlerts / Web Push) reached by reusing `emitRiskAlert` verbatim — **no new UI/Agent
step**. This is a decision, not an omission: the drawdown WARNING rides the same notify path the
concentration alert already uses. Recorded here per the consumer-surface coverage rule.

**Scenario coverage (C-15):**
- `@AC-1` (breach alerts; sub-limit silent; `peak_equity=0` skipped, no divide-by-zero) → **Step 5**
  (`evaluateDrawdowns` decision logic) + **Step 3** (`GetAccountDrawdowns` fetch shape).
- `@AC-2` (peak HWM rises with each sync via `GREATEST`, never falls) → **Step 3** (`UpsertAccountBalance`
  `GREATEST`/`peak_equity` SQL-contract assertion).

**Coverage-measurement note:** all new Go code lands in `internal/repository/` and `internal/service/`,
both **excluded** from CI coverage measurement (`.github/workflows/ci.yml` COVERPKGS filter
`grep -Ev '/(cmd|handler|repository|telemetry|service)(/|$)'`). No coverage threshold moves; the
paired tests are still required (C-08) and are the RED-before-green regression guards (P-06).

## Step Dependencies

- Step 2 (repository code) requires Step 1 (migration): the `peak_equity` column the upsert writes
  and the read selects must exist in schema.
- Step 3 (repository test) covers Step 2 (repository code) — `@AC-1` fetch shape + `@AC-2` `GREATEST`
  contract. Written RED-first against the pre-Step-2 tree.
- Step 4 (service wiring) requires Step 2: `checkRiskLimits` calls `GetAccountDrawdowns` and feeds
  `evaluateDrawdowns`.
- Step 5 (service test) covers Step 4's pure `evaluateDrawdowns` seam (`@AC-1`). Written RED-first.
- Step 6 (docs) requires Steps 1–5 landed (documents the enforced behavior); no code dependency.
- **Migration 016 needs DBA + service-owner approval at the PR** (root `CLAUDE.md` Approval Flow).

---

### Step 1 — migration: add `peak_equity` high-water-mark column to `account_balances`

**Status**: `done`
**Service**: `xstockstrat-portfolio`
**Files**:
- `services/xstockstrat-portfolio/migrations/016_account_balance_peak_equity.up.sql` — create
- `services/xstockstrat-portfolio/migrations/016_account_balance_peak_equity.down.sql` — create

**Reviewers**: DBA — Migration NNN numbering (no gaps, no conflicts), up+down pair present, index correctness; xstockstrat-portfolio — P&L calculation accuracy, position snapshot consistency, concurrent write safety

**Codebase Evidence**:
- Last migration confirmed via `ls services/xstockstrat-portfolio/migrations/ | sort` → `015_watchlist_default_strategy.*` is last; next free NNN is **016**.
- `equity` column type confirmed via Read of `004_account_balances.up.sql:11` → `equity DOUBLE PRECISION NOT NULL DEFAULT 0`. `peak_equity` MUST match this type (design open-risk pin) so `GREATEST` has no type coercion.
- Table is `portfolio.account_balances`, PK `account_id` (`004_account_balances.up.sql:5-14`).

**TDD**: `N/A (migration — offline, no-DB verification)`

**Covers**: —

**Instructions**:
- `016_account_balance_peak_equity.up.sql`:
  ```sql
  ALTER TABLE portfolio.account_balances
      ADD COLUMN peak_equity DOUBLE PRECISION NOT NULL DEFAULT 0;
  -- Seed the high-water-mark to current equity (peak = current at introduction;
  -- no reference to last_equity or any other column).
  UPDATE portfolio.account_balances SET peak_equity = equity;
  ```
- `016_account_balance_peak_equity.down.sql`:
  ```sql
  ALTER TABLE portfolio.account_balances DROP COLUMN peak_equity;
  ```
- Use `DOUBLE PRECISION` (identical to `equity`) — do not use `NUMERIC`.

**Verification**:
```bash
ls services/xstockstrat-portfolio/migrations/016_account_balance_peak_equity.up.sql \
   services/xstockstrat-portfolio/migrations/016_account_balance_peak_equity.down.sql
```
Then read both: confirm the `.up.sql` `ADD COLUMN peak_equity` is reversed by the `.down.sql`
`DROP COLUMN peak_equity`, and the column type is `DOUBLE PRECISION`. Do NOT apply against a live
database — the real apply/rollback runs in CI/deploy.

---

### Step 2 — service: HWM upsert + `GetAccountDrawdowns` read + interface widening (repository)

**Status**: `done`
**Service**: `xstockstrat-portfolio`
**Files**:
- `services/xstockstrat-portfolio/internal/repository/portfolio_repo.go` — modify

**Reviewers**: xstockstrat-portfolio — P&L calculation accuracy, position snapshot consistency, concurrent write safety

**Codebase Evidence**:
- `type queryRower interface` at `portfolio_repo.go:19-21` declares **only** `QueryRow(ctx, sql, args...) pgx.Row`. Multi-row reads (`ListPositions:165` → `r.pool.Query`, `ListAccountBalancesByUser:458` → `r.pool.Query`) and writes (`UpsertAccountBalance:386` → `r.pool.Exec`) bypass the mockable `db` surface, so they are **not** pgxmock-testable today. To test the new read + the `GREATEST` upsert (design C-08 mandate), widen the interface with `Query` and `Exec`.
- Constructor sets both fields: `return &PortfolioRepo{pool: pool, db: pool}` (`portfolio_repo.go:41`). `*pgxpool.Pool` satisfies `Query`/`Exec`; `pgxmock/v4` (`go.mod:9`, `v4.9.0`) also satisfies them.
- `UpsertAccountBalance` at `portfolio_repo.go:380-388`: INSERT `(account_id, user_id, trading_mode, cash, buying_power, equity, last_equity, updated_at)` with `ON CONFLICT (account_id) DO UPDATE SET ...`; currently executed via `r.pool.Exec`.
- `AccountBalance` struct at `portfolio_repo.go:372`; `GetAccountBalance:392` shows the single-row read shape to mirror. No `AccountDrawdown` type exists (grep: absent).
- Existing pgxmock precedent: `internal/repository/portfolio_repo_test.go:50-71` (`repo := &PortfolioRepo{db: mock}`, `mock.ExpectQuery(...).WithArgs(...).WillReturnRows(...)`).

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. Widen the `queryRower` interface (`portfolio_repo.go:19-21`) to add the two methods the new/updated
   queries need (both implemented by `*pgxpool.Pool` and `pgxmock`):
   ```go
   type queryRower interface {
       QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
       Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
       Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)
   }
   ```
   Add the `github.com/jackc/pgx/v5/pgconn` import if not already present (confirm current imports first).
2. In `UpsertAccountBalance` (`portfolio_repo.go:380-388`): add `peak_equity` to the INSERT column list
   and value tuple (bound to the same `equity` arg, `$6`), and to the `ON CONFLICT` clause raise it with
   `GREATEST`. Switch the executor from `r.pool.Exec` to `r.db.Exec` so it is mockable. **Do not change the
   Go method signature** — `equity` is already an argument. Resulting SQL:
   ```sql
   INSERT INTO portfolio.account_balances
       (account_id, user_id, trading_mode, cash, buying_power, equity, last_equity, peak_equity, updated_at)
   VALUES ($1, $2, $3, $4, $5, $6, $7, $6, NOW())
   ON CONFLICT (account_id) DO UPDATE
   SET user_id=$2, trading_mode=$3, cash=$4, buying_power=$5, equity=$6, last_equity=$7,
       peak_equity = GREATEST(portfolio.account_balances.peak_equity, EXCLUDED.equity),
       updated_at=NOW()
   ```
   The HWM now rises automatically on every `account.balance.synced` (via the untouched
   `processBalanceSync`/`ConsumeBalanceSyncs`, `portfolio_service.go:998-1002`) and never falls.
3. Add an `AccountDrawdown` struct (near `AccountBalance`, `portfolio_repo.go:372`):
   ```go
   type AccountDrawdown struct {
       AccountID  string
       Equity     float64
       PeakEquity float64
   }
   ```
4. Add `GetAccountDrawdowns(ctx context.Context, userID, tradingMode string) ([]AccountDrawdown, error)`
   using the mockable `r.db.Query` surface (mirror `ListAccountBalancesByUser`'s row-scan loop, but on
   `r.db` not `r.pool`):
   ```sql
   SELECT account_id, equity, peak_equity
   FROM portfolio.account_balances
   WHERE user_id=$1 AND trading_mode=$2
   ```
   Bind `$1=userID`, `$2=tradingMode`. Scan each row into `AccountDrawdown`; `defer rows.Close()`; return
   `rows.Err()` if non-nil.

**Verification**:
```bash
cd services/xstockstrat-portfolio && GOWORK=off go build ./...
cd services/xstockstrat-portfolio && GOWORK=off golangci-lint run --modules-download-mode=mod
grep -n "peak_equity\|GREATEST\|GetAccountDrawdowns\|AccountDrawdown\|r.db.Exec" internal/repository/portfolio_repo.go
```
Confirm the upsert carries `peak_equity`/`GREATEST` and executes via `r.db.Exec`; `GetAccountDrawdowns`
queries via `r.db.Query`. (Coverage/lint gate is exercised together with the paired Step 3 test.)

---

### Step 3 — test: pgxmock repository tests for `GetAccountDrawdowns` + `UpsertAccountBalance` HWM

**Status**: `done`
**Service**: `xstockstrat-portfolio`
**Files**:
- `services/xstockstrat-portfolio/internal/repository/portfolio_repo_test.go` — modify

**Reviewers**: xstockstrat-portfolio — P&L calculation accuracy, position snapshot consistency, concurrent write safety

**Codebase Evidence**:
- Existing pgxmock harness to copy: `portfolio_repo_test.go:50-71` (`pgxmock.NewPool()`,
  `repo := &PortfolioRepo{db: mock}`, `mock.ExpectQuery(regex).WithArgs(...).WillReturnRows(...)`,
  `mock.NewRows([]string{...}).AddRow(...)`).
- `pgxmock/v4 v4.9.0` (`go.mod:9`) supports `ExpectQuery` (for `Query`/`QueryRow`) and `ExpectExec` (for `Exec`).
- `commonv1.TradingMode_TRADING_MODE_PAPER.String()` == `"TRADING_MODE_PAPER"` — bound in existing tests
  (`portfolio_repo_test.go:70`) and matches trading's emitted literal (`trading.go:2119-2121`).

**TDD**: `red-green required`

**Covers**: `AC-1, AC-2`

**Instructions**:
- Write RED-first (before/independent of Step 2 landing): both tests must fail against the pre-Step-2 tree
  (no `peak_equity`, no `GetAccountDrawdowns`).
- **`TestGetAccountDrawdowns_ScopesToUserAndMode`** (`@AC-1` fetch shape): construct
  `repo := &PortfolioRepo{db: mock}`; `mock.ExpectQuery` with a regex asserting the SELECT projects
  `account_id`, `equity`, `peak_equity` and filters `WHERE user_id=\$1 AND trading_mode=\$2`;
  `WithArgs("user-1", "TRADING_MODE_PAPER")`; `WillReturnRows` two accounts — one breaching
  (equity 97, peak 100), one within limit (equity 99, peak 100). Assert the returned
  `[]AccountDrawdown` carries both rows with correct fields. Assert `mock.ExpectationsWereMet()`.
- **`TestUpsertAccountBalance_RaisesPeakEquityWithGreatest`** (`@AC-2` contract): `mock.ExpectExec` with a
  regex requiring `peak_equity` in the INSERT column list AND
  `peak_equity = GREATEST\(portfolio.account_balances.peak_equity, EXCLUDED.equity\)` in the ON CONFLICT;
  `WithArgs` binding the upsert's args; `WillReturnResult(pgxmock.NewResult("INSERT", 1))`. Call
  `repo.UpsertAccountBalance(...)`. Assert no error and `mock.ExpectationsWereMet()`. This asserts the
  HWM SQL contract (RED today: the current SQL has no `peak_equity`). NOTE in a comment: the runtime
  `GREATEST` semantics (rises to 120, stays 120 on a later 90) are proven at CI/deploy migration apply,
  not in unit tests — CI provisions no database (mirrors the offline-migration-verification principle).
- **C-13 (test data):** the account-row literals have exactly one consumer each — inline is compliant;
  do not create `internal/testdata/`. State this verdict in the test-step PR.

**Verification**:
```bash
cd services/xstockstrat-portfolio && GOWORK=off go test ./internal/repository/... -run 'TestGetAccountDrawdowns|TestUpsertAccountBalance_RaisesPeakEquity' -race -count=1 -v
cd services/xstockstrat-portfolio && GOWORK=off golangci-lint run --modules-download-mode=mod
```
Both tests pass (after Step 2). New logic is in the coverage-excluded `internal/repository/` package —
no coverage threshold applies; the pgxmock assertions are the sufficient regression verification. C-08
test-pairing is satisfied by this step for Step 2.

---

### Step 4 — service: `evaluateDrawdowns` seam + wire into `checkRiskLimits`

**Status**: `done`
**Service**: `xstockstrat-portfolio`
**Files**:
- `services/xstockstrat-portfolio/internal/service/portfolio_service.go` — modify

**Reviewers**: xstockstrat-portfolio — P&L calculation accuracy, position snapshot consistency, concurrent write safety

**Codebase Evidence**:
- Defect site `checkRiskLimits` at `portfolio_service.go:721-751`: reads
  `s.cfg.GetFloat("portfolio.risk.max_drawdown_pct", 0.10)` (`:722`) then discards it
  `_ = maxDrawdownPct // ...` (`:750`). Called from the order-fill path `s.checkRiskLimits(ctx, fill.UserID, mode)` (`:305`).
- Concentration enforcement template `:742-748` calls `s.emitRiskAlert(ctx, msg)` on breach — reuse verbatim.
- `emitRiskAlert` at `:753-767`: emits ledger event `portfolio.risk.drawdown_breach` + `notify.EmitAlert`
  Severity `ALERT_SEVERITY_WARNING`, Category `"risk"`. Reusable as-is (honors notify's `@AC-7` severity
  floor / `@AC-5` dedup / `@AC-4` best-effort — no bypass).
- `mode` param is `commonv1.TradingMode`; `mode.String()` yields the literal the query filter needs
  (`trading.go:2119-2121` emits the same `"TRADING_MODE_PAPER"`/`"TRADING_MODE_LIVE"`).
- **No new outbound gRPC call** is introduced (the fetch is a DB read via `s.repo`; emit reuses the
  already-wired notify/ledger clients) → header-propagation constraint does not trigger.

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. Add a pure decision function (package-level, testable, no I/O):
   ```go
   // evaluateDrawdowns returns a per-account breach message for each account whose peak-to-current
   // drawdown exceeds limit. peak_equity == 0 (no history) is skipped — no divide-by-zero.
   func evaluateDrawdowns(rows []AccountDrawdown, limit float64) []string {
       var msgs []string
       for _, d := range rows {
           if d.PeakEquity <= 0 {
               continue
           }
           dd := (d.PeakEquity - d.Equity) / d.PeakEquity
           if dd > limit {
               msgs = append(msgs, fmt.Sprintf(
                   "drawdown limit breach: account %s at %.1f%% (peak %.2f, current %.2f)",
                   d.AccountID, dd*100, d.PeakEquity, d.Equity))
           }
       }
       return msgs
   }
   ```
   (`AccountDrawdown` is the repository type from Step 2; reference it as `repository`-qualified per the
   file's existing import alias for `internal/repository` — confirm the alias when editing.)
2. Replace the discard at `portfolio_service.go:750` (`_ = maxDrawdownPct // ...`) with the wiring: fetch
   per-account rows and emit for each breach:
   ```go
   drawdowns, err := s.repo.GetAccountDrawdowns(ctx, userID, mode.String())
   if err == nil {
       for _, msg := range evaluateDrawdowns(drawdowns, maxDrawdownPct) {
           s.emitRiskAlert(ctx, msg)
       }
   }
   ```
   Keep the fetch/emit wiring thin and untested (matches the pre-existing untested concentration branch);
   the tested seam is the pure `evaluateDrawdowns`.

**Verification**:
```bash
cd services/xstockstrat-portfolio && GOWORK=off go build ./...
cd services/xstockstrat-portfolio && GOWORK=off golangci-lint run --modules-download-mode=mod
grep -n "evaluateDrawdowns\|GetAccountDrawdowns\|maxDrawdownPct" internal/service/portfolio_service.go
```
Confirm `_ = maxDrawdownPct` is gone and `maxDrawdownPct` now flows into `evaluateDrawdowns`. (Coverage
exercised with the paired Step 5 test.)

---

### Step 5 — test: `evaluateDrawdowns` decision-logic unit test

**Status**: `done`
**Service**: `xstockstrat-portfolio`
**Files**:
- `services/xstockstrat-portfolio/internal/service/portfolio_risk_test.go` — modify

**Reviewers**: xstockstrat-portfolio — P&L calculation accuracy, position snapshot consistency, concurrent write safety

**Codebase Evidence**:
- Test home exists: `internal/service/portfolio_risk_test.go` (pure-helper tests today —
  `TestApplyStopRisk_*:21,43,51`, `TestEnrichPositionRisk_*:75,93`). Same package as `evaluateDrawdowns`.
- `AccountDrawdown` struct comes from `internal/repository` (Step 2).

**TDD**: `red-green required`

**Covers**: `AC-1`

**Instructions**:
- Write RED-first: the test references `evaluateDrawdowns` which does not exist pre-Step-4 (compile-RED).
- **`TestEvaluateDrawdowns`** table-driven, asserting the three `@AC-1` cases:
  - **breach**: `{AccountID:"acc-1", Equity:97, PeakEquity:100}`, `limit=0.02` → exactly one message,
    and it names `acc-1` (assert `strings.Contains(msg, "acc-1")`). (3% > 2%.)
  - **sub-limit**: `{AccountID:"acc-2", Equity:99, PeakEquity:100}`, `limit=0.02` → empty slice (1% ≤ 2%).
  - **no history**: `{AccountID:"acc-3", Equity:0, PeakEquity:0}`, `limit=0.02` → empty slice, and the
    test must not panic / divide-by-zero.
  - (optional) a mixed multi-account slice → only the breaching account(s) named, confirming per-account grain.
- C-13: inline `AccountDrawdown` literals, single consumer — compliant inline; no `internal/testdata/`.

**Verification**:
```bash
cd services/xstockstrat-portfolio && GOWORK=off go test ./internal/service/... -run TestEvaluateDrawdowns -race -count=1 -v
cd services/xstockstrat-portfolio && GOWORK=off golangci-lint run --modules-download-mode=mod
```
Test passes (after Step 4). New logic is in the coverage-excluded `internal/service/` package — no
coverage threshold applies; the unit assertions are the sufficient regression verification. C-08
test-pairing is satisfied by this step for Step 4.

---

### Step 6 — docs: reconcile config-key note, stale findings line numbers, durable acceptance suite

**Status**: `pending`
**Service**: `xstockstrat-portfolio` (docs only)
**Files**:
- `services/xstockstrat-portfolio/CLAUDE.md` — modify
- `services/xstockstrat-portfolio/docs/context-constitution-findings.md` — modify
- `services/xstockstrat-portfolio/acceptance/drawdown-enforcement.feature` — create

**Reviewers**: none

**Codebase Evidence**:
- `services/xstockstrat-portfolio/CLAUDE.md` Config Keys table row for `portfolio.risk.max_drawdown_pct`
  currently reads "**Read but not yet enforced** — ... the value is currently read then discarded
  (`_ = maxDrawdownPct`)".
- `services/xstockstrat-portfolio/docs/context-constitution-findings.md:20` cites **stale** line numbers
  `portfolio_service.go:769` (`GetFloat`) / `:797` (`_ = maxDrawdownPct`); the actual current lines are
  `:722` / `:750` (confirmed by Read). This finding is now **resolved** by this feature.
- Existing durable acceptance suites live in `services/xstockstrat-portfolio/acceptance/*.feature`
  (e.g. `offline-account-portfolios.feature`) — recon confirmed **no** existing risk/drawdown `@AC-*`
  there (net-new guarantee territory, a C-16 gap not a conflict).

**TDD**: `N/A (docs)`

**Covers**: —

**Instructions**:
1. `CLAUDE.md`: change the `portfolio.risk.max_drawdown_pct` row Description from "Read but not yet
   enforced ..." to reflect enforcement, e.g. "Per-account drawdown alert — WARNING alert emitted when
   an account's peak-to-current drawdown (over broker `account_balances.equity` vs persisted
   `peak_equity` HWM) exceeds this pct (feature 172)". Keep the default `0.10`.
2. `docs/context-constitution-findings.md:20`: this defect is fixed — update the row. Either remove it
   from the active "Dead/orphaned code" findings or mark it **resolved (feature 172)**, and correct the
   stale line-number citation (`:769`/`:797` → the enforcement now at `checkRiskLimits`
   `portfolio_service.go:722`/`:750`) so no future audit re-flags the discard. Follow the findings-doc's
   own resolved-entry convention if one exists in the file.
3. `acceptance/drawdown-enforcement.feature`: promote this feature's `@AC-1`/`@AC-2` scenarios verbatim
   (from `docs/roadmap/features/172-fix-portfolio-max-drawdown-unenforced/acceptance.feature`) into the
   durable portfolio suite (C-16 promotion). Preserve the `@AC-*`/`@FR-*`/`@regression` tags. (If
   `/sdd-execute`'s integration PR already performs C-16 promotion, this step confirms the target file
   and content rather than duplicating.)
4. **Teardown (root `CLAUDE.md` § Teardown):** this step changes context files (`CLAUDE.md`,
   findings-doc) — run `/context-forge:context-constitution refresh` scoped to the portfolio module before
   pushing, and reconcile any grounded drift it reports. If the plugin is unavailable, perform the manual
   equivalent and record both facts in the PR body.

**Verification**:
```bash
grep -n "max_drawdown_pct" services/xstockstrat-portfolio/CLAUDE.md
grep -n "769\|797\|722\|750\|max_drawdown\|resolved" services/xstockstrat-portfolio/docs/context-constitution-findings.md
ls services/xstockstrat-portfolio/acceptance/drawdown-enforcement.feature
```
Confirm the CLAUDE.md row no longer says "not yet enforced", the findings-doc no longer cites stale
`:769`/`:797` as an open discard, and the durable `.feature` carries `@AC-1`/`@AC-2`.

---

## Deviation Log

_Populated by /sdd-execute as implementation proceeds._
