# Implementation Spec: backtest-results-visualization

**Status**: `pending`
**Created**: 2026-07-21
**Feature**: `docs/roadmap/features/068-backtest-results-visualization/feature.md`
**Total Steps**: 12
**Feature Branch**: `feature/backtest-results-visualization`

> Working-branch note (context.md, session 2026-07-21 — sdd-story): the harness-assigned branch
> `claude/backtest-results-visualization-ljhyyj` (based on `origin/main-dev`) plays the role of the
> feature branch for this feature. Where a verification command references
> `feature/backtest-results-visualization` and that ref does not exist locally, substitute
> `claude/backtest-results-visualization-ljhyyj` (pre-step tip) or `origin/main-dev` as the baseline.

---

## Execution Summary

Proto first (Steps 1–2): the new `GetBacktest` RPC and the two additive fields
(`BacktestResult.initial_capital`, `BarDiagnostic.equity`) gate everything downstream — the analysis
engine cannot stamp equity and the UI cannot call the RPC until stubs regenerate. Migration next
(Step 3) so the detail table exists before any persistence code runs. Analysis lands in two
service+test pairs (Steps 4–7): first the engine-side capture (equity into diagnostics,
effective initial capital onto the result — pure in-process changes), then the persistence layer
(repository + best-effort detail insert + count-based eviction + the `GetBacktest` handler). The UI
lands in two service steps (8, 10) with their paired tests (9, 11): pure derivation logic in
`src/lib/` first (unit-testable under the vitest `src/lib/**` coverage scope), then the BFF/hook/
chart/page wiring proven by e2e against the mock backend. Config-key documentation closes it out
(Step 12, C-05).

## Step Dependencies

- Step 2 (proto-gen) requires Step 1 (proto): stubs regenerate from the edited `.proto`.
- Step 3 (migration) is independent of Steps 1–2 but must precede Step 6 (detail table must exist).
- Step 4 (analysis engine capture) requires Step 2: `BarDiagnostic.equity` and
  `BacktestResult.initial_capital` must exist in the regenerated Python stubs.
- Step 5 [test] covers Step 4 [service] (C-08, red-before-green P-06).
- Step 6 (analysis persistence + GetBacktest) requires Steps 2, 3, and 4 (persists the
  fully-assembled result including equity/initial_capital; needs `GetBacktestRequest` stub and the
  `analysis.backtest_details` table).
- Step 7 [test] covers Step 6 [service] (C-08; includes the AC-4 parity test).
- Step 8 (UI lib modules) requires Step 2 (TS types for `BarDiagnostic.equity` /
  `BacktestResult.initialCapital` in `@xstockstrat/proto`).
- Step 9 [test] covers Step 8 [service] (frontend unit; red-before-green P-06).
- Step 10 (UI wiring) requires Steps 2 and 8 (generated `getBacktest` client method; the
  `equityCurve.ts` / `protoTime.ts` modules it renders from).
- Step 11 [test] covers Step 10 [service] (e2e; mock backend implements `getBacktest`).
- Step 12 (config docs) can run any time after Step 6 defines the key read; placed last so the
  declared default matches the implemented call-site default.

Design inputs honored: `design.md` § Chosen Approach is binding; its Rejected Alternatives
(memory-first read, JSONB, normalized rows, FK-less table, new route, trades-cumulative fallback,
run-level aggregate curve, summary-sourced metrics grid for no-detail rows) are off the table.
Open Risks carried in: BYTEA↔wire-compat note → Step 1; non-transactional insert+evict → Step 6.

---

### Step 1 — proto: Add `GetBacktest` RPC and additive fields to `analysis/v1`

**Status**: `pending`
**Service**: `packages/proto`
**Files**:
- `packages/proto/analysis/v1/analysis.proto` — modify

**Reviewers**: Proto Reviewer — field number uniqueness, no breaking changes, `buf lint`/`buf breaking` pass; `xstockstrat-analysis` owner — backtest reproducibility; `xstockstrat-ui` owner — Connect-RPC call safety

**Codebase Evidence**:
- RPC list confirmed at `packages/proto/analysis/v1/analysis.proto:11-26`; `ListBacktests` at `:17`; no `GetBacktest` exists.
- `BacktestResult` at `analysis.proto:56-71`; highest field number **14** (`diagnostics = 14` at `:70`) → 15 is free.
- `BarDiagnostic` at `analysis.proto:106-121`; highest field number **14** (`action = 14` at `:120`) → 15 is free.
- `TradeRecord` at `analysis.proto:73-82` already carries `entry_time = 7` / `exit_time = 8` (`:80-81`) — no change needed for trade markers.
- `ListBacktestsResponse` closes at `analysis.proto:184`+; single-line request-message style precedent: `message GetStrategyReportRequest { string strategy_id = 1; }` at `:198`.
- Non-breaking additions (new RPC, new message, new fields) are explicitly safe per `docs/runbooks/proto-versioning.md` ("Non-breaking changes (always safe on existing vN)").

**TDD**: `N/A (proto — no code-bearing logic; C-09 verification applies)`

**Instructions**:
1. In `service AnalysisService` (`analysis.proto:11-26`), add after the `ListBacktests` RPC at `:17`:
   ```proto
   // Fetch the persisted full result (trades, per-bar equity, diagnostics) of a past run
   // (feature 068). NOT_FOUND when the run has no persisted detail (legacy/evicted/
   // INSUFFICIENT_DATA runs).
   rpc GetBacktest(GetBacktestRequest) returns (BacktestResult);
   ```
2. Add the request message after the `ListBacktestsResponse` block (closes after `:184`), following the single-line style of `GetStrategyReportRequest` (`:198`):
   ```proto
   message GetBacktestRequest { string backtest_id = 1; }
   ```
3. In `message BacktestResult` (`:56-71`), append after `diagnostics = 14`:
   ```proto
   // Effective starting capital the engine seeded the simulation with (the 100k default
   // when the request omitted it) — required to rebuild the equity curve for a
   // historical run (feature 068).
   double initial_capital = 15;
   ```
4. In `message BarDiagnostic` (`:106-121`), append after `action = 14`:
   ```proto
   // Portfolio value (cash + position * close) after this bar — the per-bar equity
   // point the time-based equity curve plots (feature 068).
   double equity = 15;
   ```
5. Do NOT touch any enum (`BarAction`/`NoTradeReason` maps in `BacktestDiagnostics.tsx:9-27` stay valid — no exhaustive-`Record` update needed; the Step 2 frontend build check proves it).
6. **Open-risk note (design.md, carried here)**: the BYTEA detail column (Step 3/6) stores this message's wire bytes — any future renumber/retype of `BacktestResult`/`BarDiagnostic` fields silently corrupts old blobs. `buf breaking` on every PR (C-09) is the standing guard; add a comment above `message BacktestResult` noting its wire format is persisted by `analysis.backtest_details`.

**Verification**:
```bash
buf lint packages/proto/ && buf breaking . --against ".git#branch=feature/backtest-results-visualization"
```
(CI-matching invocation confirmed at `.github/workflows/ci.yml:103-120`; substitute the baseline per the working-branch note at the top of this file if the `feature/` ref does not exist locally.)

---

### Step 2 — proto-gen: Regenerate stubs and prove the frontend still builds

**Status**: `pending`
**Service**: `packages/proto`
**Files**:
- `packages/proto/gen/go/analysis/v1/` — modify (regenerated)
- `packages/proto/gen/python/analysis/v1/` — modify (regenerated)
- `packages/proto/gen/ts/analysis/v1/` — modify (regenerated; compiled JS in `gen/ts/dist/`)

**Reviewers**: Proto Reviewer — field number uniqueness, `buf lint`/`buf breaking` pass; `xstockstrat-analysis` owner — backtest reproducibility; `xstockstrat-ui` owner — Connect-RPC call safety (inherited from Step 1)

**Codebase Evidence**:
- Regeneration entry point: `./scripts/buf-gen.sh` (root `CLAUDE.md` § Generating Proto Stubs); CI `proto-freshness` job enforces committed-stub freshness (`.github/workflows/ci.yml:174-180`).
- Python stubs consumed by analysis at `packages/proto/gen/python/analysis/v1/analysis_pb2*.py` (recon.md § Codebase Map).
- Ledger trap (fails.md 2026-07-21): a proto change consumed by an exhaustive TS map must pair a frontend build check in the same step — no enums change here, but the build check is mandated regardless (design.md § Proto).

**TDD**: `N/A (proto-gen — generated code only)`

**Instructions**:
1. Run `./scripts/buf-gen.sh` from the repo root (Docker codegen container; if Docker is unavailable follow `docs/runbooks/codegen-toolchain-host-setup.md` and validate an empty `git diff packages/proto/gen/` **before** the Step 1 edit lands).
2. Confirm the diff is confined to `packages/proto/gen/{go,python,ts}/analysis/v1/` (plus `gen/ts/dist/`).
3. Commit proto source + generated stubs together (proto-versioning runbook convention).

**Verification**:
```bash
./scripts/buf-gen.sh && git status --short packages/proto/gen/ | grep analysis
# then prove the frontend compiles against the new stubs (ledger 2026-07-21 trap):
cd services/xstockstrat-ui && pnpm build
```

---

### Step 3 — migration: `008_backtest_details` detail table

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/migrations/008_backtest_details.up.sql` — create
- `services/xstockstrat-analysis/migrations/008_backtest_details.down.sql` — create

**Reviewers**: DBA — migration NNN numbering, up+down pair, index correctness; `xstockstrat-analysis` owner — backtest reproducibility

**Codebase Evidence**:
- Last migration confirmed by `ls services/xstockstrat-analysis/migrations/` → `007_backtest_run_symbols.{up,down}.sql` → next number is **008** (C-07; also pre-assigned at product-spec review, context.md 2026-07-21).
- Parent table + index precedent: `006_backtest_runs.up.sql` creates `analysis.backtest_runs (backtest_id TEXT PRIMARY KEY, …)` with `CREATE INDEX … ON analysis.backtest_runs (strategy_id, completed_at DESC)` and the comment "Full trades/diagnostics are intentionally NOT persisted here" (`006_backtest_runs.up.sql:3-25`) — this feature is the successor that persists them in a sibling table.
- Schema shape is fixed by `design.md` § Chosen Approach (BYTEA serialized proto; FK to `backtest_runs` for C-10(b) existence parity; explicit `completed_at`, no DEFAULT).

**TDD**: `N/A (migration — verified by migrate up/down)`

**Instructions**:
1. Create `008_backtest_details.up.sql`:
   ```sql
   -- Full per-run backtest detail (feature 068-backtest-results-visualization).
   -- result_pb is the serialized analysis.v1.BacktestResult wire bytes ("store what you
   -- serve", ledger insights 2026-07-21): no SQL ever inspects the payload; GetBacktest
   -- returns it verbatim. FK => a detail row can only exist for a listed summary row
   -- (C-10(b) existence parity). completed_at is stamped explicitly from
   -- result.completed_at (no DEFAULT) so eviction order and ListBacktests order agree.
   CREATE TABLE IF NOT EXISTS analysis.backtest_details (
       backtest_id  TEXT PRIMARY KEY REFERENCES analysis.backtest_runs(backtest_id),
       strategy_id  TEXT NOT NULL,
       completed_at TIMESTAMP WITH TIME ZONE NOT NULL,
       result_pb    BYTEA NOT NULL
   );

   -- Retention eviction scans "newest N per strategy" (same shape as 006's history index).
   CREATE INDEX IF NOT EXISTS idx_backtest_details_strategy_completed
       ON analysis.backtest_details (strategy_id, completed_at DESC);
   ```
2. Create `008_backtest_details.down.sql`:
   ```sql
   DROP INDEX IF EXISTS analysis.idx_backtest_details_strategy_completed;
   DROP TABLE IF EXISTS analysis.backtest_details;
   ```
3. Do not modify migrations 001–007 (F-01).

**Verification**:
```bash
./scripts/db-migrate.sh   # applies 008 cleanly on the local TimescaleDB
# then prove reversibility: migrate down 1 and re-up (golang-migrate), confirm no errors
```

---

### Step 4 — service: Analysis engine captures per-bar equity + effective initial capital

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/app/handlers/servicer.py` — modify

**Reviewers**: `xstockstrat-analysis` owner — backtest reproducibility, strategy scoring determinism, no look-ahead bias

**Codebase Evidence**:
- Effective seed confirmed at `servicer.py:293-294`: `equity = float(request.initial_capital) if request.initial_capital > 0 else 100_000.0` / `initial_equity = equity` — the value to stamp (design.md: the **effective** seed, not the raw request field).
- Result construction confirmed at `servicer.py:409-421` (`result = analysis_pb2.BacktestResult(backtest_id=…, …, trades=all_trades)`).
- Per-bar equity already computed and discarded: SMA path `_backtest_symbol` seeds `daily_equity = [equity]` (`servicer.py:643`), appends `equity + position * price` on warm-up-skip branches (`:653,662`) and `portfolio_value = equity + position * price` each simulated bar (`:737-738`); forced close patches `daily_equity[-1] = equity` and `diags[-1].action` (`:762-763`). Evaluated path mirrors it (`:833-837,886,910-911`). Both lists end length `n`, aligned 1:1 with `diags`.
- Both paths funnel through the shared finalize pass `_finalize_symbol_diagnostics(symbol, diags, warmup_bars, trades)` at `servicer.py:1516-1530`, called after the forced-close patch in both paths (`:765` region and `:911` region). **The shared builder `_build_bar_diagnostic` (`:1471-1494`) runs before the simulation loop computes equity, so it cannot carry the value** — the finalize pass is the single shared stamping point (same one-builder-per-transform intent, ledger insights 2026-07-09; deviation from design.md's "wired through `_build_bar_diagnostic`" phrasing recorded in context.md).

**TDD**: `red-green required`

**Instructions**:
1. Extend `_finalize_symbol_diagnostics` (`servicer.py:1516-1530`) with a `daily_equity` parameter; before the warm-up override loop, stamp `diags[i].equity = daily_equity[i]` for `i in range(min(len(diags), len(daily_equity)))` (both are length `n` by construction; `min` is a defensive guard, never a silent truncation of real data).
2. Update both call sites to pass their local `daily_equity`: `_backtest_symbol` (call after `:762-763`) and `_backtest_symbol_evaluated` (call after `:910-911`). No other call sites exist (`grep -n "_finalize_symbol_diagnostics" servicer.py` → definition + 2 calls).
3. In `RunBacktest`, stamp the effective seed onto the result: add `initial_capital=initial_equity` to the `BacktestResult(...)` construction at `:409-421` (`initial_equity` is in scope at `:294`).
4. No outbound gRPC calls are added — header propagation unaffected (per-method metadata pattern at `servicer.py:193-197` untouched).

**Verification**:
Step 5's paired tests fail before this step and pass after (P-06). Behavioral check:
`cd services/xstockstrat-analysis && pytest tests/test_analysis_servicer.py -q`.

---

### Step 5 — test: Engine capture tests (equity in diagnostics, effective initial capital)

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/tests/test_analysis_servicer.py` — modify

**Reviewers**: `xstockstrat-analysis` owner — backtest reproducibility

**Codebase Evidence**:
- Test harness confirmed: `make_servicer()` at `tests/test_analysis_servicer.py:25-38` (MagicMock cfg whose `get_int`/`get_float` return the call-site default; mocked channels; no DB pool → repos None).
- `_finalize_symbol_diagnostics` and `_build_bar_diagnostic` are module-level functions (`servicer.py:1471,1516`) — directly importable/testable without gRPC.
- Coverage threshold: analysis ≥40% (`pytest --cov=app --cov-fail-under=40`, spec-template table; `.github/workflows/ci.yml:331,356-359` per recon.md).

**TDD**: `red-green required`

**Instructions**:
Add tests (written to FAIL against the pre-Step-4 tree):
1. `_finalize_symbol_diagnostics` stamps equity: build `n` `BarDiagnostic` rows via `_build_bar_diagnostic`, pass a known `daily_equity` list, assert each `bars[i].equity == daily_equity[i]`.
2. Forced-close consistency: last element of `daily_equity` (post-patch value) appears as `bars[-1].equity`.
3. Effective initial capital — default path: drive `RunBacktest` through `make_servicer()` with `request.initial_capital = 0` (mock the marketdata/indicators calls as existing backtest tests in this file do) and assert `result.initial_capital == 100_000.0`.
4. Effective initial capital — explicit path: `request.initial_capital = 25_000` → `result.initial_capital == 25_000.0`.

**Verification**:
```bash
cd services/xstockstrat-analysis && pytest --cov=app --cov-fail-under=40
cd services/xstockstrat-analysis && ruff check . && ruff format --check .
```

---

### Step 6 — service: Detail persistence (repo + best-effort insert + eviction) and `GetBacktest` handler

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/app/repositories/backtest_details.py` — create
- `services/xstockstrat-analysis/app/handlers/servicer.py` — modify

**Reviewers**: `xstockstrat-analysis` owner — backtest reproducibility, strategy scoring determinism

**Codebase Evidence**:
- Repo pattern to mirror: `app/repositories/backtest_runs.py` — module docstring + `_to_dict` helper + class taking `db_pool`, `insert(...)` via `self._db.fetchrow("INSERT INTO analysis.backtest_runs … ON CONFLICT (backtest_id) DO NOTHING …")` (`backtest_runs.py:1-77`).
- Repo construction gate: `self._backtest_runs_repo = BacktestRunsRepository(db_pool) if db_pool else None` at `servicer.py:105`; imports at `:34-35`.
- Best-effort wrapper pattern: `_persist_backtest_run` at `servicer.py:1147-1180` (`if repo is None: return` → `try: insert … except Exception as e: log.warning(...)`).
- Insertion call site: `await self._persist_backtest_run(result, …)` at `servicer.py:472-478`, after the OK-only `_persist_symbol_cells` gate at `:451-459` — the detail persist goes after it, gated `if result.status == analysis_pb2.BACKTEST_STATUS_OK`.
- No-DB read precedent: `ListBacktests` returns an empty response when repo is None and reads with try/except→warning (`servicer.py:1255-1263`).
- Config read pattern: `self._cfg.get_int("analysis.backtest.max_range_days", 730)` at `servicer.py:269`; typed getters `app/config/watcher.py:60-84`; `get_int` zero-trap (0 reads as default — `services/xstockstrat-analysis/CLAUDE.md:212` precedent note style).
- Rejected alternatives are binding (design.md): NO in-memory `self._backtests` read in the handler (the dict at `:95,437-439` stores INSUFFICIENT results and colliding strategy_id keys); NO JSONB (NaN/Inf trap — `profit_factor` is legitimately `inf`); serialized-proto BYTEA only.

**TDD**: `red-green required`

**Instructions**:
1. Create `app/repositories/backtest_details.py` with `class BacktestDetailsRepository` mirroring `backtest_runs.py`:
   - `__init__(self, db_pool)` storing `self._db`.
   - `async def insert(self, *, backtest_id, strategy_id, completed_at, result_pb, retention)`:
     - `await self._db.execute("INSERT INTO analysis.backtest_details (backtest_id, strategy_id, completed_at, result_pb) VALUES ($1, $2, $3, $4) ON CONFLICT (backtest_id) DO NOTHING", …)`
     - then eviction (design.md — two statements, intentionally non-transactional; a crash between them leaves ≤1 extra row until the next insert, accepted open risk):
       `await self._db.execute("DELETE FROM analysis.backtest_details WHERE strategy_id = $1 AND backtest_id NOT IN (SELECT backtest_id FROM analysis.backtest_details WHERE strategy_id = $1 ORDER BY completed_at DESC LIMIT $2)", strategy_id, retention)`
   - `async def get(self, backtest_id)`: `fetchrow("SELECT result_pb FROM analysis.backtest_details WHERE backtest_id = $1")` → return `row["result_pb"]` bytes or `None`.
2. In `servicer.py`: import the repo beside the existing repo imports (`:34-35`); construct `self._backtest_details_repo = BacktestDetailsRepository(db_pool) if db_pool else None` beside `:105-109`.
3. Add `async def _persist_backtest_detail(self, result)` after `_persist_backtest_run` (`:1180`), same best-effort shape:
   - `if self._backtest_details_repo is None: return`
   - `retention = max(1, self._cfg.get_int("analysis.backtest.detail_retention_per_strategy", 20))` (clamp per design.md; the zero-trap means 0 reads as the default 20 — documented in Step 12)
   - `try:` insert with `backtest_id=result.backtest_id`, `strategy_id=result.strategy_id`, `completed_at=result.completed_at.ToDatetime()`, `result_pb=result.SerializeToString()`, `retention=retention` `except Exception as e: log.warning("failed to persist backtest detail: %s", e)`. The FK makes a failed-summary-insert case fail here too, inside the same warning wrapper (C-10(b)).
4. In `RunBacktest`, immediately after the `_persist_backtest_run` call (`:472-478`), add:
   `if result.status == analysis_pb2.BACKTEST_STATUS_OK: await self._persist_backtest_detail(result)` (INSUFFICIENT runs never get detail — permanent FR-6 state, mirrors the `:451-459` gate).
5. Add `async def GetBacktest(self, request, context)` beside `ListBacktests` (`:1247`), DB-only:
   - `if self._backtest_details_repo is None:` → `await context.abort(grpc.StatusCode.NOT_FOUND, "no detailed data for this run")` (no-DB path degrades to the single FR-6 state; `ListBacktests` empty-response precedent `:1255-1256`)
   - read via try/except → on read error, log warning and abort `NOT_FOUND` with the same message
   - row is `None` → abort `NOT_FOUND`, same message (single state for legacy/evicted/INSUFFICIENT — design.md)
   - else `result = analysis_pb2.BacktestResult(); result.ParseFromString(row_bytes); return result`
6. Header propagation: `GetBacktest` makes no outbound gRPC calls — nothing to propagate (constraint §B trigger absent; existing per-method pattern `:193-197` untouched). No admin gate (read parity with `ListBacktests`, forwarded openly at `insightsBff.ts:39`).

**Verification**:
Step 7's paired tests fail before this step and pass after (P-06). Behavioral check:
`cd services/xstockstrat-analysis && pytest tests/test_backtest_details_repo.py tests/test_analysis_servicer.py -q`.

---

### Step 7 — test: Detail persistence + `GetBacktest` tests (incl. AC-4 parity)

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/tests/test_backtest_details_repo.py` — create
- `services/xstockstrat-analysis/tests/test_analysis_servicer.py` — modify

**Reviewers**: `xstockstrat-analysis` owner — backtest reproducibility

**Codebase Evidence**:
- Repo-test pattern to mirror: `tests/test_backtest_runs_repo.py:1-45` — AsyncMock pool, stubbed `fetchrow`/`execute`, assertions on the SQL string and bind args ("no live Postgres").
- Servicer harness: `make_servicer()` `tests/test_analysis_servicer.py:25-38`; repos are None by default — tests set `servicer._backtest_details_repo = AsyncMock(...)` directly (same style the file uses for `_backtests` population per its module docstring `:1-5`).
- AC-4 (product-spec) + C-10(b): the seven metrics `ListBacktests` reports must equal the deserialized detail's fields; `_persist_backtest_run` binds exactly those seven at `servicer.py:1160-1172`.

**TDD**: `red-green required`

**Instructions**:
Write to FAIL against the pre-Step-6 tree:
1. `test_backtest_details_repo.py`: insert binds all four columns + `ON CONFLICT (backtest_id) DO NOTHING`; eviction DELETE runs after insert with `LIMIT $2` bound to the retention value; `get` returns bytes / `None`.
2. Servicer — OK run persists detail: run `RunBacktest` (mocked data path as existing tests) with an AsyncMock details repo; assert `insert` called once with `result_pb == result.SerializeToString()` and `retention == 20` (MagicMock cfg returns call-site default).
3. Servicer — clamp: `cfg.get_int` returning `-5` for the retention key → `insert` called with `retention == 1`.
4. Servicer — INSUFFICIENT run: force the insufficient path (coverage-gap fixture as in existing tests) → details repo `insert` NOT called.
5. `GetBacktest` — hit: stub `get` to return a serialized `BacktestResult`; assert the returned message round-trips byte-exact (fields equal).
6. `GetBacktest` — miss: `get` returns `None` → `context.abort` with `NOT_FOUND` and message `"no detailed data for this run"`; repo-None path aborts identically.
7. **AC-4 parity test**: run one OK `RunBacktest`; capture the metrics dict bound to `_backtest_runs_repo.insert` and the `result_pb` bound to the details insert; deserialize the latter and assert all seven metrics (`total_return`, `annualized_return`, `sharpe_ratio`, `max_drawdown`, `win_rate`, `total_trades`, `profit_factor`) are equal across both.

**Verification**:
```bash
cd services/xstockstrat-analysis && pytest --cov=app --cov-fail-under=40
cd services/xstockstrat-analysis && ruff check . && ruff format --check .
```

---

### Step 8 — service: UI derivation libraries (`equityCurve.ts`, `protoTime.ts`)

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/lib/protoTime.ts` — create
- `services/xstockstrat-ui/src/lib/equityCurve.ts` — create

**Reviewers**: `xstockstrat-ui` owner — analytics display accuracy

**Codebase Evidence**:
- Vitest coverage is scoped to `src/lib/**` with `all: false`, threshold 40% (`vitest.config.ts:8-28`; ledger insights 2026-07-13) — pure derivation logic here is unit-testable; only `src/lib/scoreDisplay.test.ts` exists today.
- Proto-Timestamp→Date conversion is inlined 7× across components with no shared helper (recon.md § Patterns to REUSE — DRY consolidation target); in-page examples: `new Date(Number(run.completedAt.seconds) * 1000)` in the Past Runs rows (`page.tsx:429-471` region) and `isoToTimestamp` at `page.tsx:78-81`.
- Data contract (post-Step 2 TS stubs): `SymbolDiagnostics.bars[]` carries `timestamp` + new `equity`; `TradeRecord.entryTime`/`exitTime` (`analysis.proto:80-81`); `BacktestResult.initialCapital`.
- Chart-derivation rules are fixed by `design.md` § Equity chart: per-symbol time-aligned lines only (the run-level `daily_equity.extend` at `servicer.py:354` is a sequential concatenation, never plotted); multi-symbol default = per-symbol normalized % return; absolute dollars single-symbol only; marker y = nearest-bar lookup within one bar interval (exact-match would drop the forced-close trade patched at `servicer.py:762-763`); no trades-cumulative fallback (rejected alternative).

**TDD**: `red-green required`

**Instructions**:
1. `src/lib/protoTime.ts`: export `timestampToDate(ts: { seconds: bigint | number; nanos?: number } | undefined): Date | undefined` and `timestampToMillis(ts): number | undefined` — the canonical proto-Timestamp→JS-time conversions (`Number(ts.seconds) * 1000` + nanos). Node-environment-safe (no DOM), matching the vitest `node` env.
2. `src/lib/equityCurve.ts`, pure functions over the generated types:
   - `buildEquitySeries(diagnostics, opts)` → one series per symbol from `bars[]` (`timestampToMillis(bar.timestamp)`, `bar.equity`), skipping bars with no equity data; when >1 symbol, values normalized to % return indexed to each line's first bar equity; single symbol keeps absolute dollars. Return shape includes a `mode: 'absolute' | 'normalized'` discriminator for axis/tooltip formatting.
   - `buildTradeMarkers(trades, series)` → per trade, entry and exit marker points; y resolved by nearest bar of that trade's symbol series within one bar interval (interval inferred from consecutive bar timestamps); marker payload carries symbol/side/qty/entryPrice/exitPrice/pnl for the tooltip (FR-4).
   - `hasEquityData(diagnostics)` guard → drives the explicit no-curve-data state (no fallback derivation).
3. No component/JSX in this step — logic only (keeps it inside the vitest coverage scope).

**Verification**:
Step 9's paired tests fail before (modules absent) and pass after. Type check: `cd services/xstockstrat-ui && pnpm build`.

---

### Step 9 — test: Unit tests for the derivation libraries

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/lib/equityCurve.test.ts` — create
- `services/xstockstrat-ui/src/lib/protoTime.test.ts` — create

**Reviewers**: `xstockstrat-ui` owner — analytics display accuracy

**Codebase Evidence**:
- Existing unit-test precedent: `src/lib/scoreDisplay.test.ts` under vitest node env (`vitest.config.ts:8-28`); runner scripts `test:unit` / `test:coverage` confirmed in `services/xstockstrat-ui/package.json:17-19`.

**TDD**: `red-green required`

**Instructions**:
Write to FAIL before Step 8 lands:
1. `protoTime.test.ts`: seconds/nanos → Date/millis; `undefined` passthrough; bigint seconds.
2. `equityCurve.test.ts`:
   - single-symbol series stays absolute (`mode: 'absolute'`), points ordered by time;
   - two-symbol input → two series, each normalized to % indexed at its own first bar (`mode: 'normalized'`);
   - bars without equity are skipped; all-empty diagnostics → `hasEquityData` false and empty series;
   - marker nearest-bar lookup: exit timestamp equal to the last bar (forced-close case) resolves to the last bar's equity; a timestamp more than one bar interval away from any bar yields no marker;
   - marker payload carries symbol/side/qty/entry/exit/pnl.

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm run test:coverage   # vitest, 40% threshold on src/lib/**
cd services/xstockstrat-ui && pnpm run lint
```

---

### Step 10 — service: UI wiring — BFF forward, detail hook, `EquityCurveChart`, openable Past Runs

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/lib/insightsBff.ts` — modify
- `services/xstockstrat-ui/src/hooks/useStrategies.ts` — modify
- `services/xstockstrat-ui/src/components/insights/EquityCurveChart.tsx` — create
- `services/xstockstrat-ui/src/app/insights/strategies/[id]/page.tsx` — modify

**Reviewers**: `xstockstrat-ui` owner — trading UI correctness, analytics display accuracy, Connect-RPC call safety, no direct DB access

**Codebase Evidence**:
- BFF forward block confirmed at `insightsBff.ts:27-42`: `listBacktests: forward((req, opts) => analysisClient.listBacktests(req, opts)),` at `:39`; canonical `forward` helper `bffShared.ts:63-70` (session + `backendHeaders` — header propagation handled by the existing plumbing); dispatch `createDispatch(router, '/insights/api')` at `:136`.
- Browser client is the generated `AnalysisService` client (`src/lib/browserClients/analysisClient.ts:1-6`, `baseUrl: '/insights/api'`) — `getBacktest` exists on it automatically after Step 2 stubs.
- Hook patterns confirmed: `useStrategyReport` NOT_FOUND-aware retry (`retry: (failureCount, err) => !isNotFoundError(err) && failureCount < 1`) at `useStrategies.ts:26-34` (per the file's numbering, definition spans the `useQuery` at `:83-93` region — recon anchor `:26-34` refers to the hook body); `useBacktestHistory` shape at `:43-47` (anchor; `queryKey: ['analysis-backtests', id]`, `enabled: !!strategyId`).
- Page seams confirmed: `useRunBacktest` `onSuccess` invalidations at `page.tsx:95-98`; result seam `const result = backtestResult ?? report?.latestBacktest;` at `:103`; `pastRuns` at `:104`; trade-ordinal `equityCurve` derivation reading `form.initial_capital` at `:109-116`; recharts `LineChart` block at `:364-398`; non-interactive Past Runs `<tr>` rows at `:429-471`.
- Diagnostics component reused as-is: `BacktestDiagnostics` props `{ diagnostics: SymbolDiagnostics[] }`, returns null when empty (`BacktestDiagnostics.tsx:51`).
- No new route → C-10(a) not triggered (in-page state; detail page already reachable from `/insights/strategies`, `PlatformHeader.tsx:85-91` prefix match).
- **Not found** — no `Scatter`/`ReferenceDot`/time-scale recharts usage exists anywhere in the repo (recon.md § Risks): the time-axis + marker chart is new ground, kept inside the single `EquityCurveChart` component.

**TDD**: `red-green required`

**Instructions**:
1. `insightsBff.ts`: add `getBacktest: forward((req, opts) => analysisClient.getBacktest(req, opts)),` directly after the `listBacktests` registration (`:39`). No other plumbing (dispatch prefix untouched).
2. `useStrategies.ts`: add `useBacktestDetail(backtestId: string | undefined)` after `useBacktestHistory`:
   - `queryKey: ['analysis-backtest-detail', backtestId]`, `queryFn: () => analysisClient.getBacktest({ backtestId: backtestId! })`, `enabled: !!backtestId`;
   - NOT_FOUND-aware retry copied from `useStrategyReport` (NOT_FOUND is the terminal legacy/evicted state, not transient);
   - expose `isNotFound` derived via the existing `isNotFoundError` import (`:3`) so the page can render the FR-6 empty state.
3. Create `src/components/insights/EquityCurveChart.tsx`: renders the series/markers produced by `src/lib/equityCurve.ts` on a recharts `LineChart` with a numeric time x-axis (`type="number"`, `domain=['dataMin','dataMax']`, tick formatter via `protoTime.ts`) — one `Line` per symbol series; trade markers as a `Scatter`/`ReferenceDot` layer whose tooltip shows symbol, side, qty, entry/exit price, P&L (FR-4); normalized-mode y-axis renders %, absolute renders $; `hasEquityData(...) === false` → explicit "no equity curve data for this run" state (no fallback). Reuse the existing chart styling tokens from the current block (`page.tsx:364-398`).
4. `page.tsx`:
   - add `selectedRunId` state; `const { data: selectedDetail, isNotFound: detailNotFound, isLoading: detailLoading } = useBacktestDetail(selectedRunId)`;
   - extend the seam at `:103` to `const result = selectedDetail ?? backtestResult ?? report?.latestBacktest;` — metrics grid, `BacktestDiagnostics`, and `EquityCurveChart` all read `result` (single render path, AC-5);
   - in the `useRunBacktest` `onSuccess` (`:95-98`), also `setSelectedRunId(undefined)` so a fresh run is never shadowed by a stale selection (e2e-asserted in Step 11);
   - make each Past Runs `<tr>` (`:429-471`) openable (row `onClick` + `data-testid="past-run-row"`, keyboard-accessible button on the row); highlight the selected row;
   - when a selected run answers NOT_FOUND, render the explicit `"No detailed data for this run"` empty state (`data-testid="run-detail-empty"`) in the results area — the row's summary metrics remain visible in the table itself; no summary-sourced metrics grid (rejected alternative, P-03 decision recorded in design.md);
   - delete the trade-ordinal `equityCurve` derivation (`:109-116`) and the inline `LineChart` block (`:364-398`), replacing both with `EquityCurveChart` fed from `result` — the fresh-run path and the historical path now share it (FR-4 "same component");
   - migrate the page's inline timestamp conversions touched by this edit to `protoTime.ts` helpers.
5. No direct DB access; browser → BFF → gRPC only (reviewer focus).

**Verification**:
Step 11's e2e additions fail before this step and pass after. Interim:
`cd services/xstockstrat-ui && pnpm build && pnpm run lint`.

---

### Step 11 — test: E2E — open a past run, legacy empty state, fresh-run clears selection

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/e2e/mock-backend.ts` — modify
- `services/xstockstrat-ui/e2e/insights/backtest-coverage.spec.ts` — modify

**Reviewers**: `xstockstrat-ui` owner — trading UI correctness, analytics display accuracy

**Codebase Evidence**:
- Mock backend `AnalysisService` handler object confirmed at `mock-backend.ts:396-398` (`router.service(AnalysisService, {...})` on the insights port); `listBacktests` fixture returns `bt-hist-2`/`bt-hist-1` for `strat-history-001` (`:554+`, recon anchors `:529,554`); NOT_FOUND throw precedent: `throw new ConnectError('no eligible evidence', Code.NotFound)` in `getStrategyReport` (`:529` region).
- Spec file confirmed: `e2e/insights/backtest-coverage.spec.ts:67-105` exercises the detail page for `strat-history-001` and the `past-runs` testid; auth helper `e2e/helpers/auth.ts:22` (`addAuthCookie`).
- Playwright runner: `pnpm test:e2e` (`package.json:15`).

**TDD**: `red-green required`

**Instructions**:
1. `mock-backend.ts`: refactor the `bt-hist-2`/`bt-hist-1` run summaries into one shared fixture object consumed by BOTH `listBacktests` and a new `getBacktest` handler (structural C-10(b) parity — one source of truth for the seven metrics). Add to the `AnalysisService` object:
   - `getBacktest(req)`: `req.backtestId === 'bt-hist-2'` → full `BacktestResult` built from the shared fixture (matching metrics, `initialCapital`, ≥2 trades with `entryTime`/`exitTime`, `diagnostics[].bars[]` with `timestamp` + `equity`); `'bt-hist-1'` → `throw new ConnectError('no detailed data for this run', Code.NotFound)` (legacy/evicted state); anything else → NOT_FOUND.
2. `backtest-coverage.spec.ts`, new tests (FAIL before Step 10):
   - open `bt-hist-2` via its `past-run-row` → metrics grid shows the fixture's metrics AND they equal the values shown in that Past Runs row (AC-4 surface parity); the time-axis chart renders (chart testid) with trade-marker elements and a marker tooltip carrying symbol/side/qty/entry/exit/P&L (FR-4, AC-2);
   - open `bt-hist-1` → `run-detail-empty` state visible; the Past Runs table still lists the row (AC-3, FR-6);
   - with `bt-hist-2` selected, click `Run Backtest` → on success the results surface shows the fresh run, not the stale selection (selection cleared — design.md seam-clear).
3. Keep all existing tests in the file passing (same fixtures backing them).

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm test:e2e e2e/insights/backtest-coverage.spec.ts
cd services/xstockstrat-ui && pnpm run lint
```

---

### Step 12 — config: Declare `analysis.backtest.detail_retention_per_strategy` (C-05)

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/CLAUDE.md` — modify
- `CLAUDE.md` — modify (repo root)

**Reviewers**: `xstockstrat-analysis` owner — service owner of the service adding the config key (config governance)

**Codebase Evidence**:
- Service config table confirmed: `services/xstockstrat-analysis/CLAUDE.md:199` `## Config Keys Consumed`; row-precedent with behavioral note at `:208` (`analysis.backtest.max_range_days`); the `get_int` zero-trap note lives at `:212`.
- Root `CLAUDE.md` § Config Governance Rules carries per-feature "Recently added keys" blocks; the feature 064 block (`analysis.backtest.max_range_days`) is the newest analysis-owned block — append the feature 068 block after it, same table shape.
- New non-breaking key governance: service-owner approval + "PR to root `CLAUDE.md`" (`docs/runbooks/config-rollout.md` § Config Change Governance Summary). Default read at call-site in Step 6 (`max(1, get_int(..., 20))`).

**TDD**: `N/A (docs-only config declaration)`

**Instructions**:
1. `services/xstockstrat-analysis/CLAUDE.md` — add to the `## Config Keys Consumed` table (after the `analysis.backtest.max_range_days` row):
   `| analysis.backtest.detail_retention_per_strategy | int | 20 | Max persisted detailed runs kept per strategy (feature 068); count-based eviction at insert, clamped ≥1. Eviction removes detail payloads only — backtest_runs summary rows are never trimmed. Note the get_int zero-trap: a stored 0 reads as the default 20. |`
2. Root `CLAUDE.md` — append a "Recently added keys (feature 068 — backtest results visualization, owned by `xstockstrat-analysis`)" block after the feature 064 block, with the same key/type/default/description table row.
3. No config-service code change: the key needs no seed row (call-site default), consistent with every prior `analysis.*` key.

**Verification**:
```bash
grep -n "detail_retention_per_strategy" CLAUDE.md services/xstockstrat-analysis/CLAUDE.md
# both files list the key with default 20
```

---

## Deviation Log

_Populated by /sdd-execute as implementation proceeds._
