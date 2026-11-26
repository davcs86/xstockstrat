# Implementation Spec: fix-orphaned-code

**Status**: `pending`
**Created**: 2026-11-20
**Feature**: `docs/roadmap/features/323-fix-orphaned-code/feature.md`
**Total Steps**: 9
**Feature Branch**: `feature/fix-orphaned-code`
**Tree**: `origin/feature/fix-orphaned-code` @ `42776a1f` (detached; every anchor below was re-grepped at this stamp, re-spec 2026-11-26)
**Re-spec**: 2026-11-26, two operator rulings: (1) the former Step 9 is split by consumer surface; (2) `signal_extraction.md` and `noop.py` are kept, so their deletions are out of scope (O-1, O-2; see Execution Summary)

---

## Execution Summary

The steps follow design.md's Chosen Approach in its own order: the one live hazard first (portfolio
`r.pool` → `r.db`, Steps 1+2, one atomic unit), then the pure deletions service by service (config,
the four Node leaves with one root-lock regeneration, marketdata, ingest), a scoped re-runnable backend
verification (Step 7), the agent regression check (Step 8), and last the ui comment (Step 9). A pure
deletion has no build-RED, so each deletion step captures a construct-scoped presence check before the
edit (RED) and after it (GREEN), and Step 7 re-runs every check as the named `**Covers**` step
(feature-175 pattern, recon.md:113-116).

**Surface map (re-spec 2026-11-26).** `sequential-mode.md` §5.5b derives a step's consumer surface from its
`**Service**` (`xstockstrat-ui` → `ui`, `xstockstrat-agent` → `agent`, everything else → `backend`). The
former Step 9 named backend services and `xstockstrat-agent` in one field, which maps to no single surface;
it is split into Step 7 (backend) and Step 8 (agent). Surfaces are contiguous: `backend` Steps 1–7, `agent`
Step 8, `ui` Step 9. Step 4 lists four Node leaves, all `backend`, and stays one step. Only Steps 1+2 form
an atomic unit, so no unit nears the 4-step cap (`step-constraints.md` §C).

**Operator rulings (2026-11-26) that shrink the scope:**

- **O-1: keep `services/xstockstrat-agent/app/prompts/signal_extraction.md`.** Feature 355 (`launched`) made
  `services/xstockstrat-agent/tests/test_extraction_instructions.py:25` (`_PROMPT`, read at `:298`, `:305`,
  `:319`) and durable `@AC-15 @FR-10 @feature-355`
  (`services/xstockstrat-agent/acceptance/mediated-source-extraction-instructions.feature:54-59`) depend on
  its content, so it is no longer an orphan. No step deletes it and no durable suite changes. The former
  agent deletion step is gone.
- **O-2: keep `services/xstockstrat-ingest/app/extractors/noop.py`.** It is the module name every mediated
  source stores since 355 (`services/xstockstrat-ingest/app/handlers/servicer.py:78`
  `_MEDIATED_EXTRACTOR_MODULE = "app.extractors.noop"`, stored at `:1698` and `:1794`); deleting the file
  would leave a dangling module path. Step 6 no longer deletes it.

**Consumer surface (C-14):** none. The product spec marks this internal/platform-only. After O-1 no step
changes the agent (Step 8 only re-runs its tests) and Step 9 adds a comment in ui; neither changes an MCP tool
or a rendered page. This is a decision, not an omission.

**Items with no code change:** item 5 (analysis/ingest `sandbox_*` accessors) is already resolved and
item 7 (agent `app/config/`) is live; Step 7 records the grep evidence for item 5 and Step 8 for item 7.
Item 9 (ui combined branch) is reachable and is kept (design D-2, R-1). Report item 8 (agent
`signal_extraction.md`) is kept under O-1, and the `noop.py` half of report item 6 under O-2.

**Operator decision carried in (2026-11-20):** identity scope is option (b), four Node leaves. The
identity edit is `services/xstockstrat-identity/package.json` only (D-13, F-08).

**Spec-time findings beyond recon.md** (surfaced, not silently folded in — P-03):

- Three open findings rows name subjects this feature resolves or disproves, and recon did not list
  them: `services/xstockstrat-portfolio/docs/context-constitution-findings.md:37,38` (Step 1) and
  `services/xstockstrat-ui/docs/context-constitution-findings.md:34` (Step 9). They are included
  under recon's own rule that a findings row goes in the step that changes its subject
  (recon.md:154). Row numbers and contents were re-read at the 2026-11-26 re-spec: portfolio `:37` is
  the `r.pool` → `r.db` half-migration row, `:38` the `CountPositions` row, ui `:34` the
  `PortfolioPanel.tsx` combined fall-through row.
- `PortfolioRepo.CountPositions` has zero non-test callers (portfolio findings `:38`). D-1 settles
  a handle swap for all three methods, so Step 1 swaps it and narrows the row; deleting the method is
  not in the report's ten items and is not done here.
- The existing repository tests build the repo as `&PortfolioRepo{db: mock}`
  (`portfolio_repo_test.go:66`), not through the constructor. The new tests use
  `NewPortfolioRepoWithDB(mock)` because @AC-1's Given names it.
- `fundsignal_loop.py:623` lives in `services/xstockstrat-analysis/app/engine/`, not ingest. It stays
  unchanged either way (R-3).

**Re-spec findings (2026-11-26): feature 355 is `launched`** and landed after the original stamp
(`merge-order.md:129` made 323 wait for it). It falsified two premises; both were ruled on by the operator
(O-1, O-2 above) and the spec follows the rulings. What the rulings leave open:

- `acceptance.feature` `@AC-2` still names `noop.py` and `signal_extraction.md` in its Given and says "none of
  them exists" in its Then. Both files are now kept, so that scenario cannot pass as worded. This spec does
  not edit scenarios; Step 7 covers `@AC-2` for every other listed item and the gap is an open item for the
  operator (context.md `## Open Threads`).
- `product-spec.md` and `design.md` still list the two deletions in scope (design D-3 for `noop.py`); they are
  not edited here.
- `merge-order.md:129` (the 323 ↔ 355 row) describes a delete-vs-edit conflict that no longer exists; the
  row is not edited by this feature.
- `services/xstockstrat-agent/docs/context-constitution-findings.md:36` still calls the prompt "unreferenced";
  355's tests now read it. No step edits agent docs.

## Scenario Coverage (C-15)

| Scenario | Covered by |
|---|---|
| `@AC-1` portfolio repo on a mock DB serves `GetSnapshot` without panicking | Step 2 |
| `@AC-2` orphaned modules, scripts and dependencies are gone | Step 7, for every listed item except `noop.py` and `signal_extraction.md` (kept, O-2 and O-1; the scenario text still names them, open item); RED captured per item in Steps 3–6 |
| `@AC-3` the live agent config package survives the cleanup | Step 8 |

## Step Dependencies

- Steps 1+2 land together: Step 1's `**Verification**` runs the three tests Step 2 adds, and those
  tests are RED (nil-pointer panic) on a tree without Step 1's swap (C-08 pairing rule;
  `step-constraints.md` §C). One commit, one red→green cycle, backend surface only.
- Step 2 [test] covers Step 1 [service].
- Step 7 [test] covers Steps 3, 4, 5 and 6 [service]: each of those is a pure deletion whose presence
  check is captured RED→GREEN inside the step and re-run in Step 7. Each also passes its own
  `**Verification**` alone (the service's real build, coverage and lint gate), so none needs
  `**Lands with**`.
- Step 8 [test] is a regression check for `@AC-3`: no step changes the agent, so it has no `service` step to
  cover and needs none.
- Step 9 (ui) has no paired `test` step: it is a comment-only frontend edit, and the existing
  `e2e/trader/offline-pnl.spec.ts` coverage applies (it exercises the branch the comment describes).
- Step 4 requires Step 3 only by design order. They touch disjoint files in config
  (`src/`, docs and `scripts/config-wiring.json` vs `package.json`).
- Step 7 requires Steps 3–6. Step 8 requires nothing from this feature and runs on any tree; it sits after
  Step 7 so the surfaces stay contiguous (`backend` 1–7, `agent` 8, `ui` 9) and `/sdd-execute sequential`
  checkpoints land on surface boundaries (§5.5b); the step cap also fires after Step 5.
- Step 4 must regenerate the root `pnpm-lock.yaml`, never hand-edit it. If peer 324
  (`fix-ci-enforcement-gaps`) merges to `main-dev` first, this feature rebases and re-runs Step 4's
  regeneration protocol; if 323 merges first, 324 does the same (D-9, R-5).
- Peers 322 (`configWatcher.ts`, `alpaca/client.go`) and 311 (`portfolio_repo.go`) may shift line
  anchors. `/sdd-execute` re-greps each anchor in Phase 1 before editing (design Open Risks).
- Peer 322 (`fix-retired-surface-proto-cleanup`) modifies files Step 3 deletes: its impl spec at
  `origin/feature/fix-retired-surface-proto-cleanup` @ `e1c1f040` (not re-read at the 2026-11-26 re-spec)
  edits config's `src/services/configWatcher.ts` (its Step 29) and `src/__tests__/configWatcher.test.ts`
  (its Step 30). The deletion wins either way: if 322 merges first, this feature rebases and Step 3 still
  deletes both files (resolve the modify/delete conflict as delete); if 323 merges first, 322's
  Steps 29–30 have no target and 322 must re-spec them. 322's Step 27 edits
  `alpaca/client.go:50,94-98,113` (at that stamp), disjoint from Step 5's `:817-825`;
  `merge-order.md:420-426` records the same non-blocking overlap with 347.
- Every Go command in a Verification block carries its own `GOWORK=off` prefix, including the
  `go list` inside `$(…)`: a bare `GOWORK=off VAR=$(…)` only sets an unexported shell variable, so
  the root `go.work` would apply.
- Open risks carried from design.md, with their step: stale per-service locks (Step 4 findings row);
  CI's `--no-frozen-lockfile` for Node leaves (Step 4 recorded evidence); identity scope
  (Step 4 Files); lock drift (Step 4 expected-diff check); config c8 shift (Step 3); pgxmock proves
  handle and SQL shape only (Step 2, accepted); dangling `extractor_module` label for the deleted example
  extractor (Step 6 annotation).
- After merge, the product spec's remaining acceptance line applies: the affected services are
  smoke-tested on dev. That is a post-integration check, not a step.

---

### Step 1 — service: portfolio — move the three `r.pool` stragglers to `r.db`

**Status**: `pending`
**Service**: `xstockstrat-portfolio`
**Files**:
- `services/xstockstrat-portfolio/internal/repository/portfolio_repo.go` — modify
- `services/xstockstrat-portfolio/docs/context-constitution-findings.md` — modify

**Reviewers**: Service owner `xstockstrat-portfolio` — P&L calculation accuracy, position snapshot consistency, concurrent write safety

**Codebase Evidence**:
- Confirmed via: `grep -n "r\.pool" services/xstockstrat-portfolio/internal/repository/portfolio_repo.go` → `:57` (`return r.pool`, in `Pool()`), `:247` (`row := r.pool.QueryRow(ctx, q, portfolioID, atTime)` in `GetSnapshot`, declared `:241`), `:271` (`err := r.pool.QueryRow(ctx, q, userID, mode.String()).Scan(&count)` in `CountPositions`, declared `:268`), `:379` (``_, err := r.pool.Exec(ctx, ` `` in `UpdatePositionBracket`, declared `:378`).
- `queryRower` at `:23-27` already exposes `QueryRow`, `Query` and `Exec`; the struct `PortfolioRepo{pool; db}` is at `:30-35`.
- `NewPortfolioRepo` sets both handles (`:46` `return &PortfolioRepo{pool: pool, db: pool}, nil`); `NewPortfolioRepoWithDB` (`:50-52`) sets only `db`.
- `Pool()` (`:56-58`) is documented as reused by sibling repos (`:54-55`); the `WatchlistRepo` methods in `watchlist_repo.go`, `signal_expiry_repo.go:37,62` and `delisted_removal_repo.go:76` call `r.pool` on their own struct and are out of scope (R-2).
- Existing pattern: every other `PortfolioRepo` method in the file already reads through `r.db` (for example `:68`, `:83`, `:112`).
- Call sites (break-radius, including tests): `GetSnapshot` ← `internal/service/portfolio_service.go:1212`; `UpdatePositionBracket` ← `internal/service/portfolio_service.go:1747`; `CountPositions` ← none. No signature changes, so no caller edit.
- Findings rows: `services/xstockstrat-portfolio/docs/context-constitution-findings.md:37` (the `r.pool` → `r.db` half-migration) and `:38` (`CountPositions` has zero non-test callers; "it also uses `r.pool`"). The file has a `## Resolved` section at `:49`; the in-place resolved-row form is `~~…~~ **RESOLVED (feature 172)**` at `:35-36`.

**Lands with**: `Step 2`

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. Write Step 2's three tests first and capture RED per test (Step 2 gives the commands). Do not add `recover()`.
2. In `portfolio_repo.go`, replace `r.pool.QueryRow` with `r.db.QueryRow` at `:247` and `:271`, and `r.pool.Exec` with `r.db.Exec` at `:379`. Change nothing else: no interface change, no signature change, and `Pool()` at `:56-58` keeps returning `r.pool`.
3. In the portfolio findings file, resolve row `:37` using the file's own convention (strike the claim and mark it `**RESOLVED (feature 323)**`, as rows `:35-36` do). Narrow row `:38`: remove the clause that says the method uses `r.pool` and would nil-panic, and keep the "zero non-test callers" finding open.
4. Trading-domain constraints (`step-constraints.md` §A): `TRADING_MODE` gating, broker dispatch, order-type handling and fill handling are unaffected by this step. `CountPositions` still binds `mode.String()` unchanged.

**Verification**:
```bash
cd services/xstockstrat-portfolio
# construct-scoped: only Pool() may still name r.pool
grep -n "r\.pool" internal/repository/portfolio_repo.go   # expect exactly one line: "return r.pool"
GOWORK=off go build ./... && GOWORK=off go vet ./...
GOWORK=off go test ./internal/repository/ -race -count=1 \
  -run 'TestGetSnapshot_UsesMockableDB|TestCountPositions_UsesMockableDB|TestUpdatePositionBracket_UsesMockableDB' -v
GOWORK=off golangci-lint run --modules-download-mode=mod
```

---

### Step 2 — test: portfolio — pgxmock tests for `GetSnapshot`, `CountPositions`, `UpdatePositionBracket`

**Status**: `pending`
**Service**: `xstockstrat-portfolio`
**Files**:
- `services/xstockstrat-portfolio/internal/repository/portfolio_repo_test.go` — modify

**Reviewers**: Service owner `xstockstrat-portfolio` — P&L calculation accuracy, position snapshot consistency, concurrent write safety

**Codebase Evidence**:
- Reuse target (recon Patterns to REUSE): `TestGetPosition_ScopesToRequestedAccount` at `portfolio_repo_test.go:59-95` — `pgxmock.NewPool()` (`:60`) → `defer mock.Close()` → `mock.NewRows([...]).AddRow(...)` → `mock.ExpectQuery(...).WithArgs(...).WillReturnRows(rows)` → call → `mock.ExpectationsWereMet()` (`:92`).
- Exec precedent: `TestUpsertAccountBalance_RaisesPeakEquityWithGreatest` (`:191`), which ends its expectation with `WillReturnResult(pgxmock.NewResult("INSERT", 1))` (`:203`).
- Imports already present in the file: `context`, `encoding/base64`, `errors`, `reflect`, `testing`, `time`, `github.com/jackc/pgx/v5` (`:11`), `github.com/pashagolub/pgxmock/v4` (`:12`), `commonv1`, `portfoliov1`.
- The file is `package repository` (it constructs `&PortfolioRepo{db: mock}` at `:66`), so `NewPortfolioRepoWithDB` (`portfolio_repo.go:50`) is callable directly.
- SQL the tests assert against: `GetSnapshot` selects `portfolio_id, snapshot_time, equity, cash, day_pnl, open_positions` `FROM portfolio.snapshots` with args `(portfolioID, atTime)` (`portfolio_repo.go:242-247`) and wraps a scan error as `get snapshot: %w` (`:254-255`); `CountPositions` runs `SELECT COUNT(*) FROM portfolio.positions WHERE user_id=$1 AND trading_mode=$2` (`:269`); `UpdatePositionBracket` runs `UPDATE portfolio.positions SET stop_order_id = NULLIF($5, ''), take_profit_order_id = NULLIF($6, '')` with six args (`:379-383`).
- Confirmed absent: `grep -rn "TestGetSnapshot_UsesMockableDB\|TestCountPositions_UsesMockableDB\|TestUpdatePositionBracket_UsesMockableDB" services/xstockstrat-portfolio` → no hit. **Not found** — these three test functions are created from scratch in the existing file.
- No repository-level test of the three methods exists today; the only `GetSnapshot` tests are service-level (`internal/service/portfolio_ownership_test.go:15,25`).
- C-13: `internal/testdata/` exists (`ledger.go`, `marks.go`, `offline_pnl.go`), but the snapshot row and bracket ids used here have exactly one consumer after this step, so they stay inline.
- Coverage: `internal/repository` is excluded from the CI coverage measurement (`-coverpkg` filter drops `repository`, `.github/workflows/ci.yml:374-375`). New logic is in an excluded package — no coverage threshold applies to it; the service-wide ≥ 40% gate is still run.

**Lands with**: `Step 1`

**TDD**: `red-green required`

**Covers**: `AC-1`

**Instructions**:
Add three test functions to `portfolio_repo_test.go`, each building the repo with `NewPortfolioRepoWithDB(mock)`:

1. `TestGetSnapshot_UsesMockableDB` (realizes @AC-1). Two subtests:
   - row returned: `mock.ExpectQuery("FROM portfolio.snapshots").WithArgs("pf-1", at)` returning one row with the six selected columns; assert `PortfolioId`, `Equity`, `Cash`, `DayPnl`, `OpenPositions` on the result and `ExpectationsWereMet()`.
   - mock error: the same expectation with `WillReturnError(pgx.ErrNoRows)`; assert the call returns a non-nil error for which `errors.Is(err, pgx.ErrNoRows)` holds (the method wraps with `%w`) and a nil snapshot.
2. `TestCountPositions_UsesMockableDB`: `ExpectQuery` matching `FROM portfolio.positions` with args `("user-1", commonv1.TradingMode_TRADING_MODE_PAPER.String())` returning a single count row; assert the returned count.
3. `TestUpdatePositionBracket_UsesMockableDB`: `mock.ExpectExec("UPDATE portfolio.positions")` with the six args in declaration order (`userID, symbol, tradingMode, accountID, stopOrderID, takeProfitOrderID`) and `WillReturnResult(pgxmock.NewResult("UPDATE", 1))`; assert a nil error and `ExpectationsWereMet()`.

RED capture (before Step 1's swap, one test per run because a panic aborts the test binary):
```bash
cd services/xstockstrat-portfolio
GOWORK=off go test ./internal/repository/ -count=1 -run 'TestGetSnapshot_UsesMockableDB'          # expect: panic, nil pointer dereference
GOWORK=off go test ./internal/repository/ -count=1 -run 'TestCountPositions_UsesMockableDB'       # expect: panic, nil pointer dereference
GOWORK=off go test ./internal/repository/ -count=1 -run 'TestUpdatePositionBracket_UsesMockableDB' # expect: panic, nil pointer dereference
```
The RED reason must be the nil `r.pool`, not a compile or expectation error. Partial-fill and full-fill handling are unaffected by this step (`step-constraints.md` §A).

Accepted limit (design Open Risks): pgxmock proves the handle and the SQL shape, not live SQL semantics.

**Verification**:
```bash
cd services/xstockstrat-portfolio
GOWORK=off go test ./internal/repository/ -race -count=1 \
  -run 'TestGetSnapshot_UsesMockableDB|TestCountPositions_UsesMockableDB|TestUpdatePositionBracket_UsesMockableDB' -v   # all PASS, subtests listed
COVERPKGS=$(GOWORK=off go list ./... | grep -Ev '/(cmd|handler|repository|telemetry|service)(/|$)' | tr '\n' ',' | sed 's/,$//') \
  && GOWORK=off go test ./... -race -count=1 -coverprofile=coverage.out -covermode=atomic -coverpkg="${COVERPKGS}" \
  && go tool cover -func=coverage.out | grep "^total:"    # confirm >= 40%
GOWORK=off golangci-lint run --modules-download-mode=mod
# C-13: no second inline copy of the new literals
grep -rn "TestGetSnapshot_UsesMockableDB" --include="*_test.go" .   # one declaration site
```

---

### Step 3 — service: config — delete the orphan `ConfigWatcher`, its test, its registry entries and its doc rows

**Status**: `pending`
**Service**: `xstockstrat-config`
**Files**:
- `services/xstockstrat-config/src/services/configWatcher.ts` — delete
- `services/xstockstrat-config/src/__tests__/configWatcher.test.ts` — delete
- `scripts/config-wiring.json` — modify
- `services/xstockstrat-config/CLAUDE.md` — modify
- `services/xstockstrat-config/docs/context-constitution-findings.md` — modify
- `services/xstockstrat-config/docs/context-constitution.md` — modify

**Reviewers**: Service owner `xstockstrat-config` — config key naming, environment / global-per-user scoping, secret encryption + redaction, WatchConfig stream stability

**Codebase Evidence**:
- Orphan class: `services/xstockstrat-config/src/services/configWatcher.ts:18` (`export class ConfigWatcher extends EventEmitter {`); it reads `APPLICATION_ENV` at `:43`.
- Sole importer: `git grep -n "configWatcher\|ConfigWatcher" -- services/xstockstrat-config` → only `src/__tests__/configWatcher.test.ts:23,26` (dynamic `import('../services/configWatcher.js')`) plus docs. `CLAUDE.md:68` (`└── ConfigWatcher.WaitForSnapshot()`) is the generic client-flow line and stays.
- `src/services/` also holds `logger.ts`, so the directory survives.
- Registry entries: `scripts/config-wiring.json:52-55` (`services/xstockstrat-config/src/services/configWatcher.ts:{getBool,getFloat,getInt,getString}`, each `[]`), inside the `"dynamic"` object opened at `:46`. Lines `:56`, `:59`, `:73` are the live identity, ledger and notify watchers.
- No other reference: `git grep -n "xstockstrat-config/src/services/configWatcher" -- . ':!docs/roadmap/features'` → only `scripts/config-wiring.json:52-55` and the defect report. `scripts/check-watcher-copies.py:30-33` (the `"node"` group) lists ledger, identity and notify only.
- Scripts: `package.json:8` (`"build": "tsc"`), `:12` (`"test": "tsc && node --test dist/__tests__/*.test.js"`), `:13` (`test:coverage` with c8 `--lines 40`), `:14` (`lint`).
- Docs: `CLAUDE.md:114` (`APPLICATION_ENV=development  # development | production — default environment scope for this instance`); findings `:14` (the `APPLICATION_ENV` row, action "Reword to \"telemetry resource attribute only\""), `:35` (the dead `configWatcher.ts` row), `:4` (refresh-stamp line); `docs/context-constitution.md:44` (the Pointer row saying the `10_000` default "exists only in config's own dead `src/services/configWatcher.ts`"), `:3` (refresh stamp), `:14`, `:15` (CONFIG-1/CONFIG-2). The findings file has a `## Resolved` table at `:37-39` (`| Finding | Resolved | How confirmed |`).
- Sole remaining `APPLICATION_ENV` reader after the deletion: `src/telemetry.ts:42` (`[SEMRESATTRS_DEPLOYMENT_ENVIRONMENT]: process.env.APPLICATION_ENV ?? 'development'`).
- CI wiring gate: `.github/workflows/ci.yml:1310` (`node --test scripts/config-wiring.test.mjs`), `:1313` (`node scripts/check-config-wiring.mjs --final`), `:1316` (`--doc-check`), `:1319` (`python3 scripts/check-watcher-copies.py`).

**TDD**: `red-green required` — the RED is the construct-scoped presence check below (a pure deletion has no build-RED); the paired `test` step is Step 7.

**Covers**: —

**Instructions**:
1. RED capture (pre-edit): `git ls-files services/xstockstrat-config/src/services/configWatcher.ts services/xstockstrat-config/src/__tests__/configWatcher.test.ts` prints both paths, and `grep -c "xstockstrat-config/src/services/configWatcher.ts" scripts/config-wiring.json` prints `4`.
2. Delete both files with `git rm`.
3. Remove exactly lines `:52-55` from `scripts/config-wiring.json`. Leave `:56`, `:59`, `:73` and every other key untouched; keep the JSON valid.
4. `CLAUDE.md:114`: reword the trailing comment to say the variable is the telemetry resource attribute only (`deployment.environment`), not a config scope.
5. Findings file: move rows `:14` and `:35` to the `## Resolved` table with today's date and how each was confirmed (file deleted; `git grep` empty). Add a refresh note to the stamp at `:4`. Leave `:22` alone (D-6).
6. `docs/context-constitution.md:44`: drop the clause about config's own dead copy, keeping the 90s statement and its live cites. Review `:3`, `:14`, `:15`; they cite the live leaf copies, so the expected edit is a refresh stamp at `:3` only.
7. Run the gate from a clean build output: `rm -rf dist` first, because `test` runs `dist/__tests__/*.test.js` and a stale compiled `configWatcher.test.js` would still execute (D-5).

**Verification**:
```bash
git ls-files services/xstockstrat-config/src/services/configWatcher.ts \
             services/xstockstrat-config/src/__tests__/configWatcher.test.ts      # expect: empty
grep -c "xstockstrat-config/src/services/configWatcher.ts" scripts/config-wiring.json   # expect: 0
grep -c "src/services/configWatcher.ts:lookup" scripts/config-wiring.json                # expect: 3 (identity, ledger, notify kept)
node --test scripts/config-wiring.test.mjs
node scripts/check-config-wiring.mjs --final
node scripts/check-config-wiring.mjs --doc-check
cd services/xstockstrat-config
rm -rf dist
pnpm build
pnpm run test:coverage && pnpm exec c8 check-coverage --lines 40
pnpm run lint
```

---

### Step 4 — service: Node leaves — remove dead dependencies and the `migrate` script, regenerate the root lock

**Status**: `pending`
**Service**: `xstockstrat-ledger`, `xstockstrat-config`, `xstockstrat-identity`, `xstockstrat-notify`
**Files**:
- `services/xstockstrat-ledger/package.json` — modify
- `services/xstockstrat-config/package.json` — modify
- `services/xstockstrat-identity/package.json` — modify
- `services/xstockstrat-notify/package.json` — modify
- `pnpm-lock.yaml` — modify (regenerated, never hand-edited)
- `services/xstockstrat-ledger/CLAUDE.md` — modify
- `services/xstockstrat-ledger/docs/context-constitution-findings.md` — modify
- `services/xstockstrat-notify/CLAUDE.md` — modify
- `services/xstockstrat-notify/docs/context-constitution-findings.md` — modify
- `docs/context-constitution-findings.md` — modify
- `docs/roadmap/features/merge-order.md` — modify

This step lists more than five files on purpose: design.md fixes one lock regeneration for four leaves
and puts the doc teardown in the same step.

**Reviewers**: Service owner `xstockstrat-ledger` — append-only invariant, event ordering; Service owner `xstockstrat-config` — WatchConfig stream stability; Service owner `xstockstrat-identity` — JWT expiry and rotation, API key scoping, secret store integration; Service owner `xstockstrat-notify` — stream delivery guarantees, backpressure handling, alert deduplication

**Codebase Evidence**:
- Dead script and devDependency, confirmed via `grep -n "migrate\|jsonwebtoken\|bcrypt" services/xstockstrat-{ledger,config,identity,notify}/package.json`:
  - ledger `:11` (`"migrate": "node-pg-migrate up",`), `:54` (`"node-pg-migrate": "^7.3.2",`)
  - config `:11`, `:50`
  - identity `:11`, `:55` — identity also declares `jsonwebtoken` `:34`, `bcrypt` `:35`, `@types/jsonwebtoken` `:48`, `@types/bcrypt` `:49`, which are **live** and stay
  - notify `:11`, `:57`; dead runtime deps `:35` (`"jsonwebtoken": "^9.0.2",`), `:36` (`"bcrypt": "^5.1.1",`); dead types `:51` (`@types/jsonwebtoken`), `:52` (`@types/bcrypt`)
- No caller of the script: `git grep -n "pnpm migrate\|pnpm run migrate\|npm run migrate\|node-pg-migrate" -- . ':!docs/roadmap/features' ':!*pnpm-lock.yaml' ':!docs/reports'` → only the four `package.json` pairs, ledger findings `:29` and root findings `:65`. The four service `CLAUDE.md` files no longer mention `node-pg-migrate` (`git grep -i "pg-migrate" -- 'services/xstockstrat-*/CLAUDE.md'` → no hit).
- Build input is the **root** lock: each of the four `Dockerfile`s has `:13` `COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./` and `:17` `RUN pnpm install --frozen-lockfile`.
- Root lock anchors: importer blocks `services/xstockstrat-config:` `:46` (`node-pg-migrate` `:136`), `services/xstockstrat-identity:` `:149` (`bcrypt` `:202`, `jsonwebtoken` `:208`, `@types/bcrypt` `:221`, `@types/jsonwebtoken` `:224`, `node-pg-migrate` `:251`), `services/xstockstrat-ledger:` `:264` (`node-pg-migrate` `:360`), `services/xstockstrat-notify:` `:373` (`bcrypt` `:426`, `jsonwebtoken` `:432`, `@types/bcrypt` `:448`, `@types/jsonwebtoken` `:451`, `node-pg-migrate` `:481`); `packages:` opens at `:681` (`node-pg-migrate@7.9.1` `:5215`); `snapshots:` opens at `:6569` (`node-pg-migrate@7.9.1(@types/pg@8.20.0)(pg@8.20.0)` `:11214`).
- Reverse-dependency query, re-run at the tree stamp (fails.md:2386-2390): `pnpm why -r node-pg-migrate` lists exactly four importers (config, identity, ledger, notify, each as a devDependency, `7.9.1`); `pnpm why -r bcrypt jsonwebtoken` lists exactly identity and notify (`bcrypt 5.1.1`, `jsonwebtoken 9.0.3`). notify's `src/` still has no `jsonwebtoken`/`bcrypt` use (`git grep -n "jsonwebtoken\|bcrypt" -- services/xstockstrat-notify ':!*pnpm-lock.yaml' ':!*/package.json' ':!*/docs/*' ':!*CLAUDE.md'` → no hit); identity's `src/__tests__/identityServiceImpl.test.ts` and siblings use them, so identity's four lines stay.
- pnpm version: root `package.json:5` `"packageManager": "pnpm@9.15.9"`.
- CI cannot catch a drifted root lock for these leaves: `.github/workflows/ci.yml:564,789,995` install with `--no-frozen-lockfile`; only `:305` uses `--frozen-lockfile`.
- Compose service names: `docker-compose.yml:114` (`xstockstrat-config`), `:147` (`xstockstrat-ledger`), `:181` (`xstockstrat-identity`), `:217` (`xstockstrat-notify`).
- Per-service locks exist and are not build input: `services/xstockstrat-{config,identity,ledger,notify}/pnpm-lock.yaml` (recon.md:117; D-11).
- Docs: ledger `CLAUDE.md:4` banner (`defects (dead `migrate` npm script)`); ledger findings `:29` (the `migrate` row; `## Resolved` at `:44`, bullet form); notify `CLAUDE.md:4` banner (`defects (dead `jsonwebtoken`/`bcrypt` deps, `severities` type/runtime mismatch)`); notify findings `:33` (the dead-deps row; `## Resolved` at `:46`, bullet form) and `:57` (an earlier RESOLVED bullet that says the banner "now names the dead `jsonwebtoken`/`bcrypt` deps"); root `docs/context-constitution-findings.md:65` (the row naming all four leaves, in the `## Dead / orphaned code` table at `:62-65`, columns `| What | Why it looks dead | Evidence |`; the in-place convention is row `:64`, `~~…~~ **RESOLVED (feature 175)**`).
- Merge-order precedent for a non-blocking textual overlap: `docs/roadmap/features/merge-order.md:362-371` (`## Textual overlap: 300 ↔ 304 (2026-11-09, non-blocking)`, a prose note rather than a table row, because the table gates an integration PR on `launched`). 323 already appears in `merge-order.md` for other pairings (`:129` the 355 row, now satisfied; `:420-426` the 347/322 `alpaca/client.go` overlap); confirmed absent: `grep -n "Textual overlap: 323" docs/roadmap/features/merge-order.md` → no hit, and no mention of 324.
- Identity durable suite (D-13, O-3): `services/xstockstrat-identity/acceptance/fix-identity-ledger-test-suites.feature` `@AC-1 @feature-252` is PRESERVE; its Then clause is discharged by identity's `pnpm build && pnpm run test:coverage`.

**TDD**: `red-green required` — the RED is the manifest and `pnpm why` presence check below; the paired `test` step is Step 7.

**Covers**: —

**Instructions**:
1. RED capture (pre-edit), from the repo root: the `grep` in Codebase Evidence prints the eight `migrate`/`node-pg-migrate` lines and notify's four dead-dep lines; `pnpm why -r node-pg-migrate` lists four importers; `pnpm why -r bcrypt jsonwebtoken` lists identity and notify.
2. Edit the four manifests. Remove only these lines, fixing the neighbouring comma where a removed line was last in its object:
   - ledger `package.json:11`, `:54`
   - config `package.json:11`, `:50`
   - identity `package.json:11`, `:55` — nothing else in identity (no `src/`, no docs, no other manifest line; anything more is off-spec, F-08/P-03)
   - notify `package.json:11`, `:35`, `:36`, `:51`, `:52`, `:57`
3. Regenerate the root lock from the repo root with the pinned pnpm (`9.15.9`):
   ```bash
   pnpm install --lockfile-only
   pnpm install --frozen-lockfile
   ```
   Do not hand-edit `pnpm-lock.yaml`. Do not regenerate or delete any `services/*/pnpm-lock.yaml` (R-6).
4. Check the lock diff against the expected shape (D-7): removals inside the four importer blocks named above, plus the `packages:`/`snapshots:` entries for `node-pg-migrate@7.9.1` and whatever transitive closure `pnpm why -r <pkg>` now reports as having no dependent. The `packages:`/`snapshots:` entries for `bcrypt`, `jsonwebtoken` and their `@types` must remain (identity still depends on them). Any added line, or any removal outside that closure, is drift: stop and escalate rather than commit (P-03).
5. Record in `context.md`, as required evidence (D-12): the `pnpm install --frozen-lockfile` output, the two post-edit `pnpm why` outputs, and the `docker compose build` output for the four leaves. If Docker is unavailable where the step runs, block the step and say so; do not skip the gate.
6. Docs, in this same step:
   - ledger `CLAUDE.md:4`: replace the banner's `dead `migrate` npm script` with the defect classes still open in the ledger findings file (today: the live-tail large-payload stub and the `exportEvents` backpressure row, both under `## Latent bugs`).
   - ledger findings `:29`: remove the row from `## Dead / orphaned code` and add a `**RESOLVED (feature 323)**` bullet under `## Resolved` (`:44`).
   - notify `CLAUDE.md:4`: remove `dead `jsonwebtoken`/`bcrypt` deps, ` from the banner, leaving the `severities` mismatch.
   - notify findings `:33`: resolve the same way under `## Resolved` (`:46`). Leave the historical bullet at `:57` as written.
   - root findings `:65`: resolve in place for all four leaves, following row `:64`'s form.
   - root findings, same `## Dead / orphaned code` table: add one row recording that the four `services/xstockstrat-{config,identity,ledger,notify}/pnpm-lock.yaml` files are vestigial (the leaf `Dockerfile:13` copies only the root lock) and are now stale against their manifests (D-11).
   - `merge-order.md`: append a prose section `## Textual overlap: 323 ↔ 324 (<date>, non-blocking)` in the `:362-371` form. It states that both features edit the four leaf `package.json` files (324's coverage-script lines sit 2-3 lines from the `:11` deletion) and both rewrite the root `pnpm-lock.yaml`; whichever merges second rebases and regenerates the lock under this step's protocol, and nobody resolves the lock by hand. No table row: there is no hard ordering.

**Verification**:
```bash
# manifests (scoped presence check — never a repo-wide grep, R-7)
grep -n '"migrate"\|node-pg-migrate' services/xstockstrat-ledger/package.json services/xstockstrat-config/package.json \
  services/xstockstrat-identity/package.json services/xstockstrat-notify/package.json     # expect: no output
grep -n 'jsonwebtoken\|bcrypt' services/xstockstrat-notify/package.json                   # expect: no output
grep -c 'jsonwebtoken\|bcrypt' services/xstockstrat-identity/package.json                 # expect: 4 (untouched)
git diff --stat HEAD -- services/xstockstrat-identity                                     # expect: package.json only, 2 deletions
# root lock
pnpm install --frozen-lockfile                 # exits 0
pnpm why -r node-pg-migrate                    # expect: no importer listed
pnpm why -r bcrypt jsonwebtoken                # expect: xstockstrat-identity only
git diff HEAD -- pnpm-lock.yaml | grep -c '^+[^+]'   # expect: 0 (removal-only diff)
git status --porcelain -- 'services/*/pnpm-lock.yaml'  # expect: empty (per-service locks untouched)
# per-leaf real gates
for s in ledger config identity notify; do
  ( cd services/xstockstrat-$s && rm -rf dist && pnpm build \
    && pnpm run test:coverage && pnpm exec c8 check-coverage --lines 40 && pnpm run lint ) || exit 1
done
docker compose build xstockstrat-ledger xstockstrat-notify xstockstrat-config xstockstrat-identity
grep -n "Textual overlap: 323" docs/roadmap/features/merge-order.md                       # expect: the new prose section
```

---

### Step 5 — service: marketdata — delete the unreferenced `AlpacaAsset` type

**Status**: `pending`
**Service**: `xstockstrat-marketdata`
**Files**:
- `services/xstockstrat-marketdata/internal/alpaca/client.go` — modify
- `services/xstockstrat-marketdata/docs/context-constitution-findings.md` — modify

**Reviewers**: Service owner `xstockstrat-marketdata` — OHLCV ingestion integrity, TimescaleDB hypertable partitioning, Alpaca feed idempotency

**Codebase Evidence**:
- Confirmed via: `git grep -n "AlpacaAsset" -- ':!docs/roadmap/features' ':!docs/reports'` → `services/xstockstrat-marketdata/internal/alpaca/client.go:817` (`// AlpacaAsset is kept for backward compatibility.`), `:818` (`type AlpacaAsset struct {`), and `services/xstockstrat-marketdata/docs/context-constitution-findings.md:35`. No other hit in any `.go`, `.ts` or `.py` file.
- The type spans `:817-825` and is the last declaration in the 825-line file (fields `Symbol`, `Name`, `Exchange`, `AssetClass`, `Tradable`, `Fractionable`).
- Findings row `:35` cites stale lines (`~L560-568`); the file has a `## Resolved` section at `:48`, bullet form.
- The package has `_test.go` files (`client_test.go`, `export_test.go`, `stream_test.go`, `stream_metrics_test.go`); none references `AlpacaAsset`, so no test edit is needed.
- Peer overlap on this file is recorded at `docs/roadmap/features/merge-order.md:420-426` (347 and 322, disjoint hunks, whichever merges second rebases and re-greps).

**TDD**: `red-green required` — the RED is the presence check below; the paired `test` step is Step 7.

**Covers**: —

**Instructions**:
1. RED capture (pre-edit): `git grep -n "AlpacaAsset" -- '*.go'` prints the two `client.go` lines.
2. Delete `client.go:817-825` (the comment and the struct), leaving the file ending cleanly after the preceding function's closing brace.
3. Findings: remove row `:35` from `## Dead / orphaned code` and add a `**RESOLVED (feature 323)**` bullet under `## Resolved`.
4. Trading-domain constraints (`step-constraints.md` §A): no broker dispatch, order-type or fill logic is touched; the Alpaca client's behavior is unchanged.

**Verification**:
```bash
git grep -n "AlpacaAsset" -- '*.go' '*.ts' '*.py'        # expect: no output
cd services/xstockstrat-marketdata
GOWORK=off go build ./... && GOWORK=off go vet ./...
COVERPKGS=$(GOWORK=off go list ./... | grep -Ev '/(cmd|handler|repository|telemetry|service)(/|$)' | tr '\n' ',' | sed 's/,$//') \
  && GOWORK=off go test ./... -race -count=1 -coverprofile=coverage.out -covermode=atomic -coverpkg="${COVERPKGS}" \
  && go tool cover -func=coverage.out | grep "^total:"    # confirm >= 40%
GOWORK=off golangci-lint run --modules-download-mode=mod
```

---

### Step 6 — service: ingest — delete the orphan example extractor and trim the non-MCP input dataclasses

**Status**: `pending`
**Service**: `xstockstrat-ingest`
**Files**:
- `services/xstockstrat-ingest/app/extractors/example_simple_email.py` — delete
- `services/xstockstrat-ingest/tests/test_extractor.py` — delete
- `services/xstockstrat-ingest/app/extractors/base.py` — modify
- `services/xstockstrat-ingest/docs/context-constitution-findings.md` — modify
- `services/xstockstrat-ingest/docs/context-constitution.md` — modify

**Reviewers**: Service owner `xstockstrat-ingest` — signal normalization correctness, idempotent ingestion, newsletter source schema stability

**Codebase Evidence**:
- `services/xstockstrat-ingest/app/extractors/` holds `__init__.py`, `base.py`, `example_simple_email.py`, `mcp_client.py`, `noop.py`.
- `base.py`: `SimpleEmailInput` `:10`, `EmailAttachmentInput` `:16`, `LinkedEmailInput` `:23`, `SimpleWebsiteInput` `:30`, `AuthenticatedWebsiteInput` `:36`, `McpClientInput` `:43`, the `RawInput` union `:51-58`, `BaseExtractor` `:61` (`async def extract(self, raw: RawInput) -> list[dict]` at `:63`).
- Runtime importers, confirmed via `git grep -n "from app.extractors" -- services/xstockstrat-ingest`: `app/engine/mcp_client_loop.py:24-25` (`McpClientInput`, `McpClientExtractor`), `app/extractors/mcp_client.py:13` (`BaseExtractor, McpClientInput, RawInput`; `extract` at `:24` guards with `isinstance(raw, McpClientInput)` at `:25`), `tests/test_mcp_client_extractor.py:10-11`, the orphan `example_simple_email.py:7` (deleted here), and `noop.py:5` (`from app.extractors.base import BaseExtractor, RawInput`; kept, O-2). The kept `noop.py` still imports only `BaseExtractor` and the `RawInput` name, both of which this step leaves in `base.py`.
- `tests/test_extractor.py` (150 lines) imports only the five dataclasses (`:5-12`), `ExampleSimpleEmailExtractor` (`:13`) and `NoopExtractor` (`:14`); its tests are `TestExampleSimpleEmailExtractor` (`:21`), `TestNoopExtractor` (`:82`) and three module-level tests (`:124`, `:132`, `:146`). Its example-extractor tests and the five dataclasses it builds go with this step; `TestNoopExtractor` (`:82-122`) and `test_noop_returns_empty_for_all_input_types` (`:132`) construct those same five dataclasses, so they cannot survive the trim and the whole file goes (recon.md:77-82,163). The kept `noop.py` is therefore left without a dedicated test (open item in context.md).
- The string `"app.extractors.noop"` is opaque `extractor_module` data, not an import: `services/xstockstrat-ingest/tests/test_ingest_servicer.py:2216` (seven hits, `:2216-2567`), `tests/test_signal_ownership.py:61,84`, `tests/test_signal_sources.py:204` (five hits, `:204-378`), `tests/test_source_health.py:80,111`, `tests/test_source_templates.py:43,72`, `tests/test_extraction_instructions.py:21` (`_NOOP`), `tests/test_seed_source_templates.py:139,159`, `services/xstockstrat-agent/tests/test_extraction_instructions.py:87`, `migrations/016_seed_source_templates.up.sql:34`, `scripts/migration-assertions/fixtures-pre-224.sql:20-22`, `scripts/migration-assertions/ingest-016.sql:30,42,58`, `scripts/tests/test_check_seed_template_parity.py:126,182`, `services/xstockstrat-analysis/app/engine/fundsignal_loop.py:623`, and the ui `example_simple_email` fixtures (`e2e/fixtures/signalSources.ts:18,27`, `e2e/fixtures/templates.ts:78`, `e2e/config-ui/sources.spec.ts:102,105,122`, `src/app/insights/signal-sources/page.tsx:661`). All stay unchanged (D-3, R-3); with `noop.py` kept (O-2), `app.extractors.noop` still names a real module, and only `app.extractors.example_simple_email` becomes dangling.
- Feature 355 (`launched`) made the label a constant: `services/xstockstrat-ingest/app/handlers/servicer.py:78` `_MEDIATED_EXTRACTOR_MODULE = "app.extractors.noop"` (comment `:77`: "Stored for every mediated source whatever the caller sends; nothing imports it."), used at `:1698` and `:1794`. No `import_module` or `importlib` use in `services/xstockstrat-ingest/app` (`git grep -n "importlib" -- services/xstockstrat-ingest/app` → no hit); `servicer.py:221` echoes `extractor_module` and `:1701-1703`, `:1753`, `:1793-1796` store it. O-2 (Execution Summary) rules that `noop.py` stays, as the module name this constant stores.
- Docs: ingest findings `:22` (`app/extractors/*` — PARTIALLY RESOLVED row), `:23` (`signal_sources.extractor_module` never resolved; already notes "Since feature 355 ingest writes `app.extractors.noop` for every `mediated_*` source"); `## Resolved` at `:41`, bullet form. `docs/context-constitution.md:20` (INGEST-6) cites `app/extractors/base.py#McpClientInput (~L43-48)` and `#BaseExtractor (~L61-65)`.
- No packaging or lint reference to the deleted files: `git grep -n "extractors" -- services/xstockstrat-ingest/pyproject.toml services/xstockstrat-ingest/Dockerfile` → no hit.
- CI gate: `.github/workflows/ci.yml:470-472` (ingest `coverage_threshold: 40`, `cov_source: app`), run as `uv run --no-sync pytest --cov=app … --cov-fail-under=40` (`:516-519`).

**TDD**: `red-green required` — the RED is the presence check below; the paired `test` step is Step 7.

**Covers**: —

**Instructions**:
1. RED capture (pre-edit): `git ls-files` on the two paths prints both, and the `git grep` in Verification prints the dataclass and example-extractor hits.
2. `git rm` `app/extractors/example_simple_email.py` and `tests/test_extractor.py`. Do not touch `app/extractors/noop.py` (O-2).
3. In `base.py`, delete the five dataclasses at `:9-39` and replace the union at `:51-58` with `RawInput = McpClientInput`. Keep the `RawInput` name (it is imported by `mcp_client.py:13`), `McpClientInput` and `BaseExtractor` exactly as they are.
4. Findings `:22`: add a `**RESOLVED (feature 323)**` bullet under `## Resolved` for `example_simple_email.py` and the non-MCP dataclasses, and narrow the row in `## Dead / orphaned code` to `noop.py` alone, re-worded as kept by operator ruling O-2 (the module name every mediated source stores since 355; its only importer is gone, so it has no caller beyond the stored string). Findings `:23`: keep the row open and annotate it — the stored label `app.extractors.example_simple_email` now names a module that no longer exists, which is harmless because the label is never resolved (accepted risk; a separate defect owns the fix); `app.extractors.noop` still resolves.
5. `docs/context-constitution.md:20` (INGEST-6): refresh the two `base.py` line anchors to the post-trim lines found by `grep -n "class McpClientInput\|class BaseExtractor" app/extractors/base.py`.
6. Do not edit `services/xstockstrat-analysis/app/engine/fundsignal_loop.py`, any ui file or any fixture string.

**Verification**:
```bash
git ls-files services/xstockstrat-ingest/app/extractors/example_simple_email.py \
             services/xstockstrat-ingest/tests/test_extractor.py                       # expect: empty
git ls-files services/xstockstrat-ingest/app/extractors/noop.py                        # expect: the path (kept, O-2)
git grep -n "SimpleEmailInput\|EmailAttachmentInput\|LinkedEmailInput\|SimpleWebsiteInput\|AuthenticatedWebsiteInput\|ExampleSimpleEmailExtractor" \
  -- services/xstockstrat-ingest/app services/xstockstrat-ingest/tests                 # expect: no output
grep -n "^RawInput = McpClientInput" services/xstockstrat-ingest/app/extractors/base.py   # expect: one line
cd services/xstockstrat-ingest
uv run pytest --cov=app --cov-fail-under=40
ruff check . && ruff format --check .
```

---

### Step 7 — test: backend — scoped presence verification for the config, Node-leaf, marketdata and ingest deletions

**Status**: `pending`
**Service**: `xstockstrat-config`, `xstockstrat-ledger`, `xstockstrat-identity`, `xstockstrat-notify`, `xstockstrat-marketdata`, `xstockstrat-ingest`, `xstockstrat-analysis` (item 5 evidence only)
**Files**:
- `docs/roadmap/features/323-fix-orphaned-code/context.md` — modify (record the outputs below)

**Reviewers**: Service owner `xstockstrat-config` — WatchConfig stream stability; Service owner `xstockstrat-ledger` — append-only invariant; Service owner `xstockstrat-identity` — JWT expiry and rotation, API key scoping; Service owner `xstockstrat-notify` — stream delivery guarantees; Service owner `xstockstrat-marketdata` — OHLCV ingestion integrity; Service owner `xstockstrat-ingest` — signal normalization correctness

**Codebase Evidence**:
- @AC-2 (`acceptance.feature`) reads: When "each touched leaf's package.json and the root pnpm-lock.yaml importers are inspected, and git ls-files is searched for the deleted paths"; Then "none of them exists and every affected service still builds and passes its tests". The checks below are that scope for the backend items (D-10), minus `noop.py`, which O-2 keeps. The scenario's `signal_extraction.md` item is kept by O-1 and is outside every step; the scenario text itself is an open operator item (Execution Summary).
- A repo-wide `grep node-pg-migrate` is never used (R-7): the four per-service `pnpm-lock.yaml` files still name it and are not build input.
- `AlpacaAsset` is checked in source extensions only, because Step 5's resolved findings bullet and this feature's own docs still contain the name.
- Item 5 no-op evidence at the tree stamp: `git grep -n "sandbox_timeout\|sandbox_memory\|sandbox_max\|indicators\.sandbox" -- services/xstockstrat-analysis/app services/xstockstrat-ingest/app` → no hit; the rows are already resolved at `services/xstockstrat-analysis/docs/context-constitution-findings.md:23` and `services/xstockstrat-ingest/docs/context-constitution-findings.md:29` (`**RESOLVED (feature 244)**`).
- Coverage thresholds (CI): config/ledger/identity/notify c8 `--lines 40` (`package.json:13`, ledger `:14`; `.github/workflows/ci.yml:763-770`); marketdata ≥ 40% (`ci.yml:332`); ingest `--cov-fail-under=40` (`ci.yml:470-472`, run `:516-519`).
- RED for this step was captured item by item in Steps 3–6 (each "RED capture (pre-edit)"), since a pre-deletion tree is fully green (insights.md:2941-2944). This step adds no source file.

**TDD**: `red-green required` — RED is the per-item pre-edit capture recorded by Steps 3–6; this step captures the consolidated GREEN.

**Covers**: `AC-2` (every listed item except `noop.py` and `signal_extraction.md`, kept under O-2 and O-1)

**Instructions**:
Run the Verification block from the repo root on the tree that holds Steps 1–6, and record in `context.md`: the two `pnpm why` outputs, the item-5 grep (empty), and one line per service gate (pass, with the coverage figure). Nothing else is edited. If any check is not as expected, the failing step is reopened through the deviation protocol; this step does not patch around it.

**Verification**:
```bash
# --- AC-2: deleted paths absent
git ls-files services/xstockstrat-config/src/services/configWatcher.ts \
             services/xstockstrat-config/src/__tests__/configWatcher.test.ts \
             services/xstockstrat-ingest/app/extractors/example_simple_email.py \
             services/xstockstrat-ingest/tests/test_extractor.py                       # expect: empty
git ls-files services/xstockstrat-ingest/app/extractors/noop.py                        # expect: the path (kept, O-2)
# --- AC-2: manifests
grep -n '"migrate"\|node-pg-migrate' services/xstockstrat-ledger/package.json services/xstockstrat-config/package.json \
  services/xstockstrat-identity/package.json services/xstockstrat-notify/package.json  # expect: no output
grep -n 'jsonwebtoken\|bcrypt' services/xstockstrat-notify/package.json                # expect: no output
# --- AC-2: root-workspace importers
pnpm install --frozen-lockfile
pnpm why -r node-pg-migrate                    # expect: no importer listed
pnpm why -r bcrypt jsonwebtoken                # expect: xstockstrat-identity only
# --- AC-2: source symbol
git grep -n "AlpacaAsset" -- '*.go' '*.ts' '*.py'                                      # expect: no output
# --- item 5 no-op evidence
git grep -n "sandbox_timeout\|sandbox_memory\|sandbox_max\|indicators\.sandbox" \
  -- services/xstockstrat-analysis/app services/xstockstrat-ingest/app                 # expect: no output
# --- AC-2 Then: every affected service still builds and passes its tests (thresholds explicit)
for s in config ledger identity notify; do
  ( cd services/xstockstrat-$s && rm -rf dist && pnpm build \
    && pnpm run test:coverage && pnpm exec c8 check-coverage --lines 40 && pnpm run lint ) || exit 1
done
( cd services/xstockstrat-marketdata && GOWORK=off go build ./... && GOWORK=off go vet ./... \
  && COVERPKGS=$(GOWORK=off go list ./... | grep -Ev '/(cmd|handler|repository|telemetry|service)(/|$)' | tr '\n' ',' | sed 's/,$//') \
  && GOWORK=off go test ./... -race -count=1 -coverprofile=coverage.out -covermode=atomic -coverpkg="${COVERPKGS}" \
  && go tool cover -func=coverage.out | grep "^total:" )                               # confirm >= 40%
( cd services/xstockstrat-ingest && uv run pytest --cov=app --cov-fail-under=40 && ruff check . && ruff format --check . )
node scripts/check-config-wiring.mjs --final
```

---

### Step 8 — test: agent — regression check that the live config package survives

**Status**: `pending`
**Service**: `xstockstrat-agent`
**Files**:
- `docs/roadmap/features/323-fix-orphaned-code/context.md` — modify (record the outputs below)

**Reviewers**: Service owner `xstockstrat-agent` — MCP tool contract stability and `docs/runbooks/mcp-tools.md` parity

**Codebase Evidence**:
- @AC-3 (`acceptance.feature`): Given "the agent imports app.config.watcher at startup (app/main.py) and for formula deadlines (app/client.py)"; Then `services/xstockstrat-agent/app/config/watcher.py` still exists and `tests/test_config_watcher.py` passes. Both files exist at the tree stamp; `app/config/` holds `__init__.py`, `watch_core.py`, `watcher.py`; importers `app/main.py:94,226`, `app/client.py:1145`, `app/tools.py:79`, `app/oauth_server.py:28`; `watcher.py:13` imports `watch_core`.
- No step of this feature edits the agent: report item 8 (`app/prompts/signal_extraction.md`) is kept under O-1 because `tests/test_extraction_instructions.py:25` and durable `@AC-15` depend on it. This step is the "when the cleanup lands" regression guard for item 7, nothing more.
- The live prompt is `list_correlation.md`: `app/tools.py:89` (`_LIST_CORRELATION_PROMPT_PATH`), `register_prompts` at `app/tools.py:2749`, called at `app/main.py:87`. `app/prompts/` holds `__init__.py`, `list_correlation.md`, `signal_extraction.md`.
- Coverage threshold (CI): agent `--cov-fail-under=40` (`.github/workflows/ci.yml:476-478`, run `:516-519`).
- No deletion happens here, so there is no pre-edit RED; the check is green on the unchanged agent tree and stays green after Steps 1–7.

**TDD**: `red-green required` — the allowed escape applies: "red N/A — no behavior change" (no agent file is changed by this feature). State it in `context.md` and still capture the green run.

**Covers**: `AC-3`

**Instructions**:
Run the Verification block from the repo root and record in `context.md` the `git ls-files` output, the `tests/test_config_watcher.py` result, and the agent gate line (pass, with the coverage figure). Nothing else is edited. If any check is not as expected, reopen it through the deviation protocol.

**Verification**:
```bash
# --- AC-3: the live agent config package survives
git ls-files services/xstockstrat-agent/app/config/watcher.py                          # expect: the path
( cd services/xstockstrat-agent && uv run pytest tests/test_config_watcher.py -q )
# --- the agent still passes its tests (threshold explicit)
( cd services/xstockstrat-agent && uv run pytest --cov=app --cov-fail-under=40 && ruff check . && ruff format --check . )
```

---

### Step 9 — service: ui — state when the `PortfolioPanel` combined view renders

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/components/trader/PortfolioPanel.tsx` — modify
- `services/xstockstrat-ui/docs/context-constitution-findings.md` — modify

**Reviewers**: Service owner `xstockstrat-ui` — trading UI correctness, analytics display accuracy

**Codebase Evidence**:
- `PortfolioPanel.tsx:76-78` (`export function PortfolioPanel()` → `useAccountContext()` → `usePortfolios(selectedAccountId)`); the single-account early return starts at `:85` (`if (selectedAccountId) {`); the combined branch follows, with `No portfolios available` at `:161` and the `All accounts` card title at `:176`.
- Reachability: `src/context/AccountContext.tsx:43-44` (`const firstActive = fetched.find((a) => a.isActive);` / `return firstActive?.id ?? null;`) and the swallowed fetch failure at `:46-48` (`} catch {` / `// non-fatal — leave existing state intact`). With no active account, or a failed account fetch, `selectedAccountId` stays `null` and the combined branch renders.
- The e2e spec exercises it: `e2e/trader/offline-pnl.spec.ts:109-110` and `:195-196` (both accounts spread with `isActive: false`), asserting the `All accounts` card at `:119` and `:205`.
- Durable rules: `services/xstockstrat-ui/acceptance/offline-account-full-pnl.feature` `@AC-30` (`:32`) and `@AC-14` (`:11`) — both PRESERVE; this step changes no behavior.
- Findings row `services/xstockstrat-ui/docs/context-constitution-findings.md:34` calls the combined fall-through "effectively unreachable" and says "Edit the page, not the dead branch". That claim is false for the two cases above. The file has a `## Resolved` section at `:45`.
- Scripts: `package.json:8` (`"build": "next build && node src/styles/themes/checkThemeBundle.cjs"`), `:10` (`"lint": "next lint"`), `:15` (`"test:e2e": "playwright test"`); hermetic e2e runner `scripts/run-e2e.py`.

**TDD**: `red-green required` — the allowed escape applies: "red N/A — no behavior change" (comment-only). State it in `context.md` and still capture the green run of `offline-pnl.spec.ts`.

**Covers**: —

**Instructions**:
1. Add a constraint comment of at most 2 lines immediately above `if (selectedAccountId) {` at `PortfolioPanel.tsx:85`, stating that the combined view below renders when no account is selected: no active account, or the account fetch failed. No code change, no reformatting, no other line touched (D-2; root `CLAUDE.md` How to Act #5).
2. Findings row `:34`: correct it rather than delete it. Move it to `## Resolved` as disproved — the branch is reachable (cite `AccountContext.tsx#firstActive` and `e2e/trader/offline-pnl.spec.ts`), is guarded by durable `@AC-30`, and is kept by feature 323. Keep the still-true pointer that the authoritative combined "Book" surface is `src/app/trader/portfolio/page.tsx`.
3. C-12/C-17: no test, fixture, token or component is added or changed.

**Verification**:
```bash
cd services/xstockstrat-ui
git diff HEAD -- src/components/trader/PortfolioPanel.tsx | grep '^[-+][^-+]'   # expect: 1-2 added comment lines, no removed line
pnpm run lint
pnpm build
pnpm exec playwright test e2e/trader/offline-pnl.spec.ts     # or python3 scripts/run-e2e.py --grep "offline" from the repo root for the hermetic run
```

---

## Deviation Log

_Populated by /sdd-execute as implementation proceeds._
