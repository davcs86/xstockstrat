# Implementation Spec: cross-stock-score-derivation

**Status**: `in-progress`
**Created**: 2026-07-13
**Feature**: `docs/roadmap/features/065-cross-stock-score-derivation/feature.md`
**Total Steps**: 14
**Feature Branch**: `feature/cross-stock-score-derivation`

---

## Execution Summary

Proto first (additive fields), then codegen, then the analysis migration — the extended
upsert references the new columns, so schema must exist before service code deploys (design.md
§ Deploy ordering; DO's `db-migrator` PRE_DEPLOY job preserves this in production). Analysis
service work is split into two service+test pairs matching design.md's step boundaries:
(cells + fingerprint capture) then (derivation + recompute triggers) — the second depends on
the first's repo and helper. The agent caller-parity fix and the UI changes are independent of
each other but both depend on the generated stubs. Two test-infrastructure steps (user-directed
scope addition, 2026-07-13, recorded in context.md) seed vitest in the UI **before** the UI
service step — so the UI logic changes get a true red-green unit gate — and wire the agent and
UI unit suites into CI; docs land last.

## Step Dependencies

- Step 2 (proto-gen) requires Step 1 (proto): stubs are generated from the edited `.proto`.
- Step 3 (migration) requires nothing but MUST merge before Steps 4/6 deploy (new columns
  referenced by the extended upsert/insert).
- Step 4 (service: cells) requires Steps 2, 3: uses generated stubs and the 007 schema.
- Step 5 (test) covers Step 4 (C-08 pairing; red-before-green per P-06).
- Step 6 (service: derivation) requires Step 4: consumes `BacktestRunSymbolsRepository` and
  `_definition_fingerprint`.
- Step 7 (test) covers Step 6.
- Step 8 (service: agent parity) requires Step 2 only (field exists in stubs since 060-era;
  no regen strictly needed, but keep ordering for one stub version).
- Step 9 (test) covers Step 8.
- Step 10 (test: vitest seed) requires nothing; MUST precede Step 11 so the UI step's unit
  tests can run red-before-green.
- Step 11 (service: UI) requires Steps 2 (new proto fields in the TS package) and 10.
- Step 12 (test) covers Step 11 (vitest unit + Playwright e2e).
- Step 13 (test: CI wiring) requires Steps 9, 10, 12 conceptually (the suites it wires must
  exist and pass); file-wise touches only `.github/workflows/ci.yml`.
- Step 14 (docs) last; captures final key defaults, semantics, and the new test tooling.
- Design deviations already user-signed in `context.md` (2026-07-13): fingerprint eligibility,
  zero-trade cells counted with traded-first dedup, clear-then-NOT_FOUND, shrunk+renormalized
  components, agent parity in scope, revert-resurrection.

---

### Step 1 — proto: additive StrategyScore provenance + BacktestRunSummary range fields

**Status**: `done`
**Service**: `packages/proto`
**Files**:
- `packages/proto/analysis/v1/analysis.proto` — modify

**Reviewers**: Proto Reviewer — field number uniqueness, no breaking changes, buf lint/breaking pass; `xstockstrat-analysis` owner — backtest reproducibility, scoring determinism; `xstockstrat-ui` owner — analytics display accuracy

**Codebase Evidence**:
- `StrategyScore` occupies fields 1–4 (`analysis.proto:136-141`: `strategy_id=1`,
  `overall_score=2`, `component_scores=3` map, `rating=4`) — next free is 5.
- `BacktestRunSummary` occupies fields 1–14 (`analysis.proto:159-174`; last is
  `google.protobuf.Timestamp completed_at = 14` at `:173`) — next free is 15.
- Timestamp import precedent `analysis.proto:7`; no `reserved` ranges anywhere in the file.
- `RunBacktestRequest.strategy_id_ref = 6`, `inline_definition = 7` (`analysis.proto:28-38`)
  — already exist; no request changes needed.

**TDD**: N/A (proto)

**Instructions**:
1. In `StrategyScore` (`analysis.proto:136-141`) append:
   `int32 evidence_symbols = 5;`, `int32 evidence_days = 6;`, `bool provisional = 7;`
   with comments noting they are evidence provenance for the derived headline (feature 065).
2. In `BacktestRunSummary` (`analysis.proto:159-174`) append:
   `google.protobuf.Timestamp range_start = 15;`, `google.protobuf.Timestamp range_end = 16;`
   (nullable via message presence; legacy rows leave them unset).
3. No enum additions (all new fields are scalars/Timestamps — C-04 not implicated).

**Verification**:
`cd packages/proto && buf lint && buf breaking --against "../../.git#branch=feature/cross-stock-score-derivation,subdir=packages/proto"`
(the `subdir` component is required — the buf module is rooted at `packages/proto`, not the
repo root; precedent `scripts/buf-gen.sh:41`)

---

### Step 2 — proto-gen: regenerate stubs

**Status**: `done`
**Service**: `packages/proto`
**Files**:
- `packages/proto/gen/go/**` — modify (generated)
- `packages/proto/gen/python/**` — modify (generated)
- `packages/proto/gen/ts/**` — modify (generated)

**Reviewers**: Proto Reviewer — field number uniqueness, no breaking changes, buf lint/breaking pass; `xstockstrat-analysis` owner — backtest reproducibility, scoring determinism; `xstockstrat-ui` owner — analytics display accuracy (inherited from Step 1)

**Codebase Evidence**:
- `scripts/buf-gen.sh:35-66` — buf lint → buf breaking → `buf generate` (Go+TS) → Python via
  `python3 -m grpc_tools.protoc` → TS package build (`pnpm --filter @xstockstrat/proto run build`).
- UI consumes `@xstockstrat/proto` as `workspace:*` (`services/xstockstrat-ui/package.json:36`);
  additive fields are zero-default-safe for existing imports.

**TDD**: N/A (proto-gen)

**Instructions**:
Run `./scripts/buf-gen.sh` from the repo root; commit all changes under `packages/proto/gen/`.

**Verification**:
`./scripts/buf-gen.sh && git diff --stat packages/proto/gen/ | tail -1` — non-empty diff
committed; re-running produces an empty diff.

---

### Step 3 — migration: analysis 007 — evidence cells + range + provenance columns

**Status**: `done`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/migrations/007_backtest_run_symbols.up.sql` — create
- `services/xstockstrat-analysis/migrations/007_backtest_run_symbols.down.sql` — create

**Reviewers**: DBA — migration NNN numbering, up+down pair, index correctness, run-order compliance; `xstockstrat-analysis` owner — backtest reproducibility, scoring determinism

**Codebase Evidence**:
- Last migration is `006_backtest_runs.up.sql` (dir listing confirms 001–006, each with
  up+down) — 007 is next (C-07).
- `backtest_runs` schema to ALTER: `006_backtest_runs.up.sql:5-21` (no range columns today).
- `strategy_scores` schema to ALTER: `005_strategy_scores.up.sql:1-8` (PK `strategy_id`,
  `component_scores JSONB DEFAULT '{}'`).
- Index style precedent: `006_backtest_runs.up.sql:24-25`.

**TDD**: N/A (migration)

**Instructions**:
`007_backtest_run_symbols.up.sql`:
1. `CREATE TABLE IF NOT EXISTS analysis.backtest_run_symbols` with columns:
   `backtest_id TEXT NOT NULL`, `strategy_id TEXT NOT NULL`, `symbol TEXT NOT NULL`,
   `sharpe_ratio DOUBLE PRECISION NOT NULL DEFAULT 0`, `max_drawdown DOUBLE PRECISION NOT NULL DEFAULT 0`,
   `win_rate DOUBLE PRECISION NOT NULL DEFAULT 0`, `total_return DOUBLE PRECISION NOT NULL DEFAULT 0`,
   `total_trades INTEGER NOT NULL DEFAULT 0`, `trading_days INTEGER NOT NULL`,
   `definition_fingerprint TEXT NULL`, `range_start TIMESTAMPTZ NULL`, `range_end TIMESTAMPTZ NULL`,
   `completed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`, `PRIMARY KEY (backtest_id, symbol)`.
2. `CREATE INDEX IF NOT EXISTS idx_brs_eligibility ON analysis.backtest_run_symbols
   (strategy_id, definition_fingerprint, symbol, (total_trades > 0) DESC, trading_days DESC, completed_at DESC);`
   — serves the traded-first `DISTINCT ON` eligibility read (design.md § Eligibility).
3. `ALTER TABLE analysis.backtest_runs ADD COLUMN IF NOT EXISTS range_start TIMESTAMPTZ NULL,
   ADD COLUMN IF NOT EXISTS range_end TIMESTAMPTZ NULL;`
4. `ALTER TABLE analysis.strategy_scores ADD COLUMN IF NOT EXISTS n_symbols INTEGER NOT NULL DEFAULT 0,
   ADD COLUMN IF NOT EXISTS total_trading_days INTEGER NOT NULL DEFAULT 0,
   ADD COLUMN IF NOT EXISTS provisional BOOLEAN NOT NULL DEFAULT FALSE;`
5. **No `analysis.strategies` ALTER** (design.md: fingerprint model needs none).

`007_backtest_run_symbols.down.sql`: drop the index + table; drop the five added columns.

**Verification**:
`./scripts/db-migrate.sh && ./scripts/db-migrate.sh version` — analysis schema at version 7;
then apply the down + re-up locally to prove reversibility.

---

### Step 4 — service: per-symbol evidence cells + definition fingerprint capture

**Status**: `done`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/app/repositories/backtest_run_symbols.py` — create
- `services/xstockstrat-analysis/app/repositories/backtest_runs.py` — modify (range columns)
- `services/xstockstrat-analysis/app/handlers/servicer.py` — modify

**Reviewers**: `xstockstrat-analysis` owner — backtest reproducibility, strategy scoring determinism, no look-ahead bias

**Codebase Evidence**:
- Capture point: per-symbol `trades`/`daily_eq` are merged at `servicer.py:298-300`
  (`all_trades.extend(trades)`, `daily_equity.extend(daily_eq)`); symbol helpers return at
  `:272` / `:283` with `initial_equity=equity` compounding across symbols (`:261-262`).
- `_compute_metrics(daily_equity, trades, initial_equity)` — pure fn at `servicer.py:1361`;
  `n_days = len(daily_equity) - 1` (`:1378`); per-symbol curves seeded at `:519`/`:713` so
  `daily_eq[0]` is the symbol's own starting equity.
- Definition resolution: `servicer.py:219-232` — inline takes precedence (`:220-221`);
  `strategy_id_ref` branch fetches `row = await self._strategies_repo.get_by_id(...)` (`:224`).
  **Not found**: no `request.strategy_id == request.strategy_id_ref` comparison exists today —
  the guard is net-new.
- Column-authoritative fields to exclude from the hash: `_row_to_strategy_definition`
  overlays `strategy_id`/`display_name`/`active`/`live_enabled` from columns
  (`servicer.py:1332-1337`); both REGISTER and UPDATE store `definition_json` via
  `MessageToDict(..., preserving_proto_field_name=True)` (`servicer.py:993-995`, `:1002-1004`);
  `strategies.py:14-24` `_to_dict` json-decodes the JSONB on every read.
- Range persistence source: `request.range` is always fully set after the defaulting block
  `servicer.py:250-258`; `_persist_backtest_run` at `:900` (insert columns
  `backtest_runs.py:39-41`, ON CONFLICT DO NOTHING `:43`).
- Repo style to mirror: `BacktestRunsRepository` (`backtest_runs.py:19-73`, keyword-only
  insert, `_to_dict` at `:12`).
- Status decision: `servicer.py:349-352` (OK vs INSUFFICIENT_DATA).

**TDD**: red-green required

**Instructions**:
1. Add module-level `_FINGERPRINT_EXCLUDED_KEYS = frozenset({"display_name", "active",
   "live_enabled"})` and `_definition_fingerprint(definition_json: dict) -> str` to
   `servicer.py` (near `_row_to_score` at `:1312`): sha256 hex of
   `json.dumps({k: v for k, v in (definition_json or {}).items() if k not in
   _FINGERPRINT_EXCLUDED_KEYS}, sort_keys=True, separators=(",", ":"))`. Docstring must state
   the canonicalization rule: **only ever hash a DB-returned `strategies` row's
   `definition_json`** (post-`_to_dict`), never a request proto dict (design.md § fingerprint;
   open-risk mitigation).
2. In `RunBacktest`, at the definition-resolution block (`:219-232`): keep the fetched `row`
   as `executed_row`; compute `run_fingerprint = _definition_fingerprint(executed_row["definition_json"])`
   **iff** the `strategy_id_ref` branch was taken AND `request.strategy_id ==
   request.strategy_id_ref` AND `executed_row` is not None; else `run_fingerprint = None`
   (inline runs, legacy-SMA fallback, id-mismatch, unregistered). Computed once, pre-loop.
3. In the per-symbol loop, immediately after each successful helper return and before the
   `extend`s (`:298-300`): compute `cell_m = _compute_metrics(daily_eq, trades, daily_eq[0])`,
   buffer `{symbol, **cell_m}` with `total_trades=len(trades)`,
   `trading_days=len(daily_eq) - 1`, skipping symbols with `len(daily_eq) <= 1`. Zero-trade
   cells ARE buffered (design decision: they count as evidence).
4. After the status decision (`:349-352`), if `result.status == BACKTEST_STATUS_OK`, flush
   the buffer via the new repo (best-effort `try/except → log.warning`, mirroring `:892-898`),
   stamping `backtest_id`, `strategy_id=request.strategy_id`, `definition_fingerprint=run_fingerprint`,
   `range_start`/`range_end` from `request.range`, shared `completed_at` left to the DB default.
5. Create `app/repositories/backtest_run_symbols.py` — `BacktestRunSymbolsRepository` with
   `insert_many(cells: list[dict])` (single `executemany`, `ON CONFLICT (backtest_id, symbol)
   DO NOTHING`) and `fetch_eligible(strategy_id: str, fingerprint: str) -> list[dict]`:
   ```sql
   SELECT DISTINCT ON (symbol) * FROM analysis.backtest_run_symbols
   WHERE strategy_id = $1 AND definition_fingerprint = $2
   ORDER BY symbol, (total_trades > 0) DESC, trading_days DESC, completed_at DESC
   ```
   (traded-first dedup — user decision). Mirror `_to_dict`/constructor from
   `backtest_runs.py:12-23`. Construct it in `AnalysisServicer.__init__` beside
   `_backtest_runs_repo` (`servicer.py:97`), `None` without `db_pool`.
6. Extend `BacktestRunsRepository.insert` (`backtest_runs.py:25-60`) with keyword-only
   `range_start`/`range_end` params and columns; extend the `_persist_backtest_run` call site
   (`servicer.py:374`, helper `:900`) to pass them from `request.range`
   (`Timestamp.ToDatetime()`; always set post-`:250-258`).
7. No new outbound gRPC calls (header propagation unaffected). No env vars. No new pool (F-06).

**Verification**:
`cd services/xstockstrat-analysis && uv run pytest tests/ -k "run_symbols or fingerprint" -q`
(new tests from Step 5 pass) `&& uv run ruff check . && uv run ruff format --check .`

---

### Step 5 — test: cells + fingerprint coverage

**Status**: `done`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/tests/test_backtest_run_symbols_repo.py` — create
- `services/xstockstrat-analysis/tests/test_analysis_servicer.py` — modify

**Reviewers**: `xstockstrat-analysis` owner — backtest reproducibility, strategy scoring determinism, no look-ahead bias

**Codebase Evidence**:
- No-DB factory `make_servicer()` — `tests/test_analysis_servicer.py:22-35`; persistence suite
  `TestRunBacktestPersistence` `:289` (cases `:301`, `:319`, `:338`, `:362` — the `:301` case
  asserts the run upserts its own score and will be REVISED in Step 7 when that behavior is
  removed; Step 5 leaves it green).
- Mock-pool repo test pattern: `tests/test_backtest_runs_repo.py:28-99` (`AsyncMock` pool,
  assert SQL text + bound params).
- CI coverage/lint: `.github/workflows/ci.yml:329-331` (threshold 40), ruff `:303-307`;
  `asyncio_mode = "auto"` (`pyproject.toml:30-32`).

**TDD**: red-green required

**Instructions**:
Author these to FAIL against the pre-Step-4 tree (P-06):
1. `test_backtest_run_symbols_repo.py`: `insert_many` builds the expected `executemany` SQL +
   params; `fetch_eligible` SQL contains `DISTINCT ON (symbol)`,
   `definition_fingerprint = $2`, and the `(total_trades > 0) DESC, trading_days DESC,
   completed_at DESC` ordering (mirror `test_backtest_runs_repo.py:28` style).
2. Fingerprint stability unit tests (module-level fn, no DB): identical dicts differing only
   in `display_name`/`active`/`live_enabled` → same hash; an `entry_rule` change → different
   hash; key-order-shuffled equal dicts → same hash; `None`/`{}` handled.
3. Servicer tests (fake repos injected per `:307` pattern): OK run buffers one cell per
   simulated symbol incl. zero-trade cells, with correct `trading_days`/`total_trades` and
   the run's fingerprint; INSUFFICIENT run flushes nothing; inline-definition and
   bare-`strategy_id` (legacy SMA) runs stamp `definition_fingerprint=None`; id-mismatch
   (`strategy_id != strategy_id_ref`) stamps None; cells-flush failure never fails the run;
   `range_start`/`range_end` passed through to the run-history insert.

**Verification**:
`cd services/xstockstrat-analysis && uv run pytest --cov=app --cov-fail-under=40 && uv run ruff check . && uv run ruff format --check .`

---

### Step 6 — service: headline derivation, recompute triggers, ScoreStrategy repurpose

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/app/handlers/servicer.py` — modify
- `services/xstockstrat-analysis/app/repositories/strategy_scores.py` — modify

**Reviewers**: `xstockstrat-analysis` owner — backtest reproducibility, strategy scoring determinism, no look-ahead bias

**Codebase Evidence**:
- `_score_from_result` `servicer.py:1234` (clamps `:1246-1248`, blend `:1250-1254`, grade
  thresholds `:1256-1265`); callers `:370` and `:849`.
- Headline upsert to DELETE: `servicer.py:373`; run-history persist stays `:374`.
- Unguarded ledger completion emit: `servicer.py:387-395` — recompute must be ordered before it.
- `ScoreStrategy` `:830`: in-memory read to drop `:841-847`; guarded ledger emit `:866-877`.
- `ManageStrategy` UPDATE branch `:1000-1014`; UNAVAILABLE parity precedent `:984-986`.
- `_persist_strategy_score` `:881` (in-memory `:889`, isfinite filter `:893`, best-effort
  upsert `:892-898`); `hydrate_scores` `:930-941`; `_row_to_score` `:1312-1323`.
- `StrategyScoresRepository.upsert` `strategy_scores.py:32-56` (columns `:42`, ON CONFLICT
  `:44-48`). **Not found**: no `delete` method exists — net-new.
- **Not found**: no `asyncio.Lock` in `servicer.py` — net-new; precedent uses at
  `app/engine/live_loop.py:56`, `app/engine/fundsignal_loop.py:76`.
- Config read pattern: `servicer.py:836-838` (`get_float(key, default)`); `get_int` falsy-zero
  trap `app/config/watcher.py:68-74` (documented in Step 14, not fought).
- `ScoreStrategyRequest.range = 2` exists (`analysis.proto:131-134`) — documented as ignored.

**TDD**: red-green required

**Instructions**:
1. Extract module-level `_score_from_metrics(sharpe_ratio, max_drawdown, win_rate, w_s, w_d,
   w_w) -> tuple[float, dict]` and `_grade(overall) -> str` from `_score_from_result`'s body
   (`:1246-1265`); `_score_from_result` keeps its exact signature and delegates (callers
   `:370`/`:849` and existing tests stay green — ledger sibling pattern).
2. Add module-level pure `_aggregate_cells(scored_cells: list[tuple[int, float, dict]],
   k: int) -> tuple[float, dict, int, int] | None`: weights `wᵢ = trading_days`;
   `overall = (Σ wᵢ·sᵢ + 0.5k)/(Σwᵢ + k)`; components shrunk identically with weights
   renormalized `wᵢ/Σw`; non-finite components filtered (`:893` precedent); returns
   `(overall, components, n_symbols, total_days)`; `Σw == 0` → `None` (zero evidence, never
   equal-weights).
3. Add `StrategyScoresRepository.delete(strategy_id)` (simple `DELETE ... WHERE strategy_id = $1`)
   and extend `upsert` with `n_symbols`, `total_trading_days`, `provisional` columns.
   Extend `_persist_strategy_score` to pass them; `_row_to_score` and `hydrate_scores` read
   them back with `.get(..., default)` tolerance for pre-007 rows.
4. Add `self._recompute_locks: dict[str, asyncio.Lock]` in `__init__` and
   `_recompute_headline(strategy_id) -> StrategyScore | None` + inner
   `_recompute_headline_locked(strategy_id, strategy_row)`:
   resolve the strategy row **before** entering the lock path (no lock leak from ad-hoc ids;
   unregistered → return None); compute the current fingerprint; `fetch_eligible`; empty →
   `self._strategies.pop(sid, None)` + `StrategyScoresRepository.delete` , return None; else
   score each cell via `_score_from_metrics` with the `analysis.scoring.*_weight` config
   reads (`:836-838` pattern), aggregate with `k = get_int("analysis.scoring.shrinkage_days", 250)`,
   set `provisional = n_symbols < get_int("analysis.scoring.min_evidence_symbols", 3) or
   total_days < get_int("analysis.scoring.min_evidence_days", 500)`, build `StrategyScore`
   with the three new proto fields, persist via `_persist_strategy_score`, return it.
   **Triggers already holding the lock call only the inner variant** (asyncio.Lock is
   non-reentrant — no-deadlock regression test in Step 7).
5. `RunBacktest`: DELETE the `_persist_strategy_score(score)` call at `:373` (the per-run
   `_score_from_result` at `:370-372` stays, feeding the history row only). After the cells
   flush + `_persist_backtest_run`, when status is OK, call `_recompute_headline` in
   `try/except → log.warning`, **before** the completion emit at `:387`.
6. `ManageStrategy` UPDATE (`:1000-1014`): after the successful repo update, under the
   strategy's lock — unconditional `self._strategies.pop(sid, None)` FIRST, then best-effort
   `_recompute_headline_locked(sid, row)` in `try/except → log.warning`. The UPDATE response
   never fails on recompute error.
7. `ScoreStrategy` (`:830`): drop `:841-847`. New flow — `_strategies_repo is None` →
   UNAVAILABLE (`:984-986` parity); `get_by_id` None → NOT_FOUND `"strategy not registered"`;
   under the lock: cells read failure → abort UNAVAILABLE with no prior state mutation; zero
   eligible cells → pop + **non-best-effort** `delete` (a delete failure aborts UNAVAILABLE),
   then NOT_FOUND `"no eligible evidence — run a backtest"`; else derive, persist, keep the
   guarded ledger emit (`:866-877`), return the score. Document (docstring) that
   `ScoreStrategyRequest.range` is ignored.
8. No new outbound gRPC calls; no env vars; no new pool (F-06); no hardcoded tunables (F-07 —
   all via ConfigWatcher fallbacks).

**Verification**:
`cd services/xstockstrat-analysis && uv run pytest tests/test_analysis_servicer.py -q && uv run ruff check . && uv run ruff format --check .`

---

### Step 7 — test: derivation + trigger coverage

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/tests/test_analysis_servicer.py` — modify
- `services/xstockstrat-analysis/tests/test_strategy_scores_repo.py` — modify

**Reviewers**: `xstockstrat-analysis` owner — backtest reproducibility, strategy scoring determinism, no look-ahead bias

**Codebase Evidence**:
- Suites to extend: `TestRunBacktestPersistence` (`test_analysis_servicer.py:289`) — the
  `:301` case (`test_ok_run_scores_and_persists_score`) asserts the removed per-run headline
  upsert and MUST be revised to assert derivation-not-run-upsert (accepted churn per
  design.md); hydrate tests `:1313`/`:1339`; repo pattern `test_strategy_scores_repo.py:16-58`.
- OQ-1 closed-form anchors (product-spec § OQ-1): perfect cells W=375, k=250 → ≥0.8 (A);
  one 60-day perfect cell → (60+125)/310 ≈ 0.597 (< B threshold 0.65), provisional.

**TDD**: red-green required

**Instructions**:
Author to FAIL pre-Step-6:
1. `_aggregate_cells` pure tests: the two OQ-1 anchors; Σw==0 → None; weight renormalization
   (weights 0.8/0.6/0.6 sum ≠ 1 still reconciles overall = Σŵ·component); non-finite component
   filtered; zero-trade cell (score ≈ 0.3·w_d-normalized) pulls the blend down.
2. Traded-first dedup semantics (fake cells repo): a 500-day zero-trade cell + 100-day traded
   cell on the same symbol → the traded cell is the one aggregated (assert via `fetch_eligible`
   mock contract AND the repo SQL test in `test_backtest_run_symbols_repo.py`).
3. Trigger tests: OK run derives headline from cells (not from its own aggregate) and persists
   provenance; UPDATE clears in-memory even when the scores repo raises (unconditional pop);
   UPDATE→recompute completes without deadlock (regression for the non-reentrant lock);
   ScoreStrategy: unregistered → NOT_FOUND; zero eligible → pop + delete called, NOT_FOUND;
   cells read failure → UNAVAILABLE with `self._strategies` untouched; success path emits the
   guarded ledger event and returns provenance fields.
4. Hydrate round-trip: provenance columns survive restart; pre-007 row (missing keys) hydrates
   with defaults.
5. Revise `:301` to the new contract; keep `:319`/`:338`/`:362` green (history-row behavior
   unchanged).
6. `test_strategy_scores_repo.py`: extended upsert columns + params; new `delete` SQL.

**Verification**:
`cd services/xstockstrat-analysis && uv run pytest --cov=app --cov-fail-under=40 && uv run ruff check . && uv run ruff format --check .`

---

### Step 8 — service: MCP agent caller parity

**Status**: `pending`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/app/client.py` — modify
- `services/xstockstrat-agent/app/tools.py` — modify (docstring only)
- `docs/runbooks/mcp-tools.md` — modify (one line)

**Reviewers**: `xstockstrat-analysis` owner — backtest reproducibility, strategy scoring determinism (the change alters which engine analysis runs; agent service has no dedicated registry row)

**Codebase Evidence**:
- `app/client.py:138-142` — `async def run_backtest(strategy_id, symbols, initial_capital=100000.0)`;
  the RPC at `:148-153` sends only `strategy_id`, `symbols`, `initial_capital` — **no
  `strategy_id_ref` today** (confirmed absent).
- `RunBacktestRequest.strategy_id_ref = 6` exists (`analysis.proto:28-38`).
- Tool docstring `app/tools.py:231-249`; runbook section `docs/runbooks/mcp-tools.md:241`.
- Servicer behavior when `strategy_id_ref` names a missing strategy: NOT_FOUND abort
  (`servicer.py:228-231`) — the agent tool surfaces gRPC errors as-is.

**TDD**: red-green required

**Instructions**:
1. In `client.py` `run_backtest` (`:148-153`), add `strategy_id_ref=strategy_id` to the
   `RunBacktestRequest` so agent-triggered runs execute the registered definition and earn
   fingerprinted evidence (design.md § Callers; C-10(b) parity).
2. Update the `run_backtest` tool docstring (`app/tools.py:231-249`) and the runbook entry
   (`mcp-tools.md:241`): the strategy must be a registered definition; unregistered ids now
   return NOT_FOUND instead of silently running a legacy SMA backtest.
3. Behavior note for reviewers: this intentionally removes the agent's ad-hoc/legacy-SMA
   backtest path — signed off at design (context.md 2026-07-13).

**Verification**:
`cd services/xstockstrat-agent && uv run pytest tests/test_tools.py -q && uv run ruff check . && uv run ruff format --check .`

---

### Step 9 — test: agent parity coverage

**Status**: `pending`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/tests/test_tools.py` — modify

**Reviewers**: `xstockstrat-analysis` owner — backtest reproducibility, strategy scoring determinism

**Codebase Evidence**:
- Existing tests: `tests/test_tools.py:232` (`test_run_backtest_calls_grpc`) and `:432`
  (stubs `stub.RunBacktest` at `:458`).
- **CI caveat (confirmed)**: `xstockstrat-agent` has no test job in `.github/workflows/ci.yml`
  (python-test matrix `:322-331` covers indicators/ingest/analysis only) — verification is
  local-only per the agent CLAUDE.md convention.

**TDD**: red-green required

**Instructions**:
Author to FAIL pre-Step-8: add the `strategy_id_ref == strategy_id` assertion at the
**stub-capture level** — the `tests/test_tools.py:432-464` pattern (stubs `stub.RunBacktest`
at `:458` and can inspect the constructed `RunBacktestRequest`). Do NOT put it in
`test_run_backtest_calls_grpc` (`:232`): that test mocks `client.run_backtest` wholesale
(`:235`), so no request object is ever constructed there (impl-spec review finding,
2026-07-13). Either extend the `:432` test with the request assertion or add a sibling
client-level test using the same stub pattern. Keep both existing tests green.

**Verification**:
`cd services/xstockstrat-agent && uv run pytest --cov=app --cov-fail-under=40 && uv run ruff check . && uv run ruff format --check .`
(local-only — no CI job exists for the agent; noted for reviewers)

---

### Step 10 — test: seed vitest unit-test infrastructure in xstockstrat-ui

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/package.json` — modify
- `services/xstockstrat-ui/vitest.config.ts` — create
- `pnpm-lock.yaml` — modify (workspace install)

**Reviewers**: `xstockstrat-ui` owner — analytics display accuracy, Connect-RPC call safety, no direct DB access

**Codebase Evidence**:
- **Not found (confirmed)**: no vitest/jest anywhere — `package.json:51-67` devDependencies
  list only Playwright/lint/type tooling; no `vitest*`/`jest*` config file exists; scripts
  (`package.json:6-17`) have `test:e2e` only, no `test:unit`/`test:coverage`.
- CI contract to satisfy later (Step 13): the `node-test` job runs each service's own
  `pnpm run test:coverage` (`ci.yml:511-513`) and uploads `coverage/lcov.info`
  (`ci.yml:519-520`) — thresholds live in service config, not the CI matrix.
- Node version 22 / pnpm 9.15.0 (root CLAUDE.md § Language Versions; `ci.yml:386-392`).

**TDD**: N/A (test tooling seed — no product behavior; the first red-green consumer is Step 11)

**Instructions**:
1. Add devDependencies to `services/xstockstrat-ui/package.json`: `vitest` and
   `@vitest/coverage-v8` (matching majors). Run `pnpm install` at the repo root to update
   `pnpm-lock.yaml`.
2. Add scripts: `"test:unit": "vitest run"`, `"test:unit:watch": "vitest"`,
   `"test:coverage": "vitest run --coverage"`.
3. Create `services/xstockstrat-ui/vitest.config.ts`: `environment: 'node'` (logic tests
   only — component/jsdom testing is explicitly out of scope for this seed); include
   `src/**/*.test.ts`; coverage provider `v8`, reporter `lcov` + `text`, and coverage
   **scoped to `src/lib/**`** with thresholds `lines/functions/statements: 40` — a
   whole-`src` threshold over the untested UI codebase would be unearnable at seed time;
   scoping to `src/lib` matches where unit-testable logic lives and the 40% platform floor.
   Exclude `src/lib/*Bff.ts`, `src/lib/connectClients.ts`, `src/lib/identity.ts` from
   coverage (Node-runtime gRPC plumbing exercised only by e2e; comment this in the config).
4. Ensure `tsconfig.json` needs no change for vitest type resolution (vitest runs TS
   natively via esbuild; do not add `types: ["vitest"]` unless the lint step requires it).

**Verification**:
`cd services/xstockstrat-ui && pnpm run test:unit -- --passWithNoTests && pnpm run lint`
(runner executes with zero tests; Step 12 adds the suites and drops `--passWithNoTests`)

---

### Step 11 — service: UI — strategyIdRef, shared score display, provenance + labels

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/lib/scoreDisplay.ts` — create
- `services/xstockstrat-ui/src/app/insights/strategies/page.tsx` — modify
- `services/xstockstrat-ui/src/app/insights/strategies/[id]/page.tsx` — modify
- `services/xstockstrat-ui/src/app/insights/page.tsx` — modify
- `services/xstockstrat-ui/src/hooks/useStrategies.ts` — modify

**Reviewers**: `xstockstrat-ui` owner — analytics display accuracy, Connect-RPC call safety, no direct DB access

**Codebase Evidence**:
- Duplicated helpers to extract: `ratingVariant` (`strategies/page.tsx:15`, `insights/page.tsx:219`)
  and `scoreColor` (`strategies/page.tsx:22`, **`insights/page.tsx:213-217`** — both duplicated).
- Run mutation missing `strategyIdRef`: `[id]/page.tsx:80-86` (fields today: `strategyId:82`,
  `symbols:83`, `initialCapital:84`, `range:85`); `runError` handling `:70-73`, rendered `:238`.
- Score card `[id]/page.tsx:121-147` (title `:124` `Strategy Score`); Past Runs `:384`,
  Score header `:398`, rating cell `:426-432`; columns today: When/Symbols/Return/Sharpe/
  Trades/Score (`:393-398`) — no range column.
- Empty states: list `strategies/page.tsx:118-122`; dashboard `insights/page.tsx:121-132`
  (badge `:121-123`, "Not scored" `:131`); detail page has NO score empty state (`:121` guard
  just hides the card) — net-new cleared-state card.
- Hooks `useStrategies.ts:13-42` (no retry options); **global `retry: 1` default at
  `src/lib/queryClient.ts:14`** — the NotFound predicate must override it.
- Badge variants `src/components/ui/badge.tsx:9-20` (`secondary` precedent at
  `strategies/page.tsx:90`).
- **Not found (net-new confirmed)**: `scoreDisplay.ts`, `formatSymbolYears`, `TRADING_DAYS`,
  literal `252`, tooltip component — none exist in `src/`.
- Proto fields available after Step 2 via `@xstockstrat/proto/analysis/v1/analysis_pb`
  (import precedent `strategies/page.tsx:13`).

**TDD**: red-green required (vitest seeded by Step 10: `scoreDisplay.ts` and the NotFound
retry predicate get failing unit tests first — Step 12 authors them; e2e covers the rendered
surfaces)

**Instructions**:
1. Create `src/lib/scoreDisplay.ts` exporting `ratingVariant`, `scoreColor` (bodies moved
   verbatim from `strategies/page.tsx:15-26`), `TRADING_DAYS_PER_YEAR = 252` (comment: mirrors
   the literal in analysis `_compute_metrics`, `servicer.py:1379` — not a config value), and
   `formatSymbolYears(days: number): string` (`days/252`, one decimal, e.g. `8.4 symbol-years`).
   Replace the duplicated copies in `strategies/page.tsx` and `insights/page.tsx:213-219`
   with imports (DRY guard rail + C-10).
2. `[id]/page.tsx`: add `strategyIdRef: id` to the mutation input (`:82`); rename the score
   card title (`:124`) to `Strategy Grade` with a caption line
   `Derived from {evidenceSymbols} symbols · {formatSymbolYears(evidenceDays)} — individual
   runs are graded separately`; add a `secondary` "Provisional" badge when
   `report.score.provisional`; rename the Past Runs `Score` header (`:398`) to `Run score`;
   add a `Range` column rendering `range_start`–`range_end` dates with an `—` placeholder
   when unset (legacy rows).
3. `[id]/page.tsx` cleared-state: render an explicit "Strategy Grade" empty-state card
   ("Not scored yet — run a backtest to earn evidence.") when the report query errored
   NotFound or resolved without `score`; the backtest form (`:191`) and Past Runs (`:384`,
   independent `useBacktestHistory`) stay rendered.
4. `useStrategies.ts`: give `useStrategyReport` a `retry` predicate that returns false when
   `err instanceof ConnectError && err.code === Code.NotFound`, else falls back to one retry
   (overrides the global `retry: 1` at `queryClient.ts:14`).
5. Strategies list card (`strategies/page.tsx:96-117`): append the evidence line
   (`N symbols · X symbol-years`) and the "Provisional" badge next to the rating badge
   (`:91-93`); keep the `:118-122` empty state.
6. Insights dashboard (`insights/page.tsx:121-132`): consume the shared helpers and show the
   compact "Provisional" badge beside the rating badge (C-10 — third render surface).
7. Structure the NotFound retry predicate as an exported pure function (e.g.
   `isNotFoundError(err): boolean` in `scoreDisplay.ts` or beside the hook) so Step 12 can
   unit-test it without mounting React Query.

**Verification**:
`cd services/xstockstrat-ui && pnpm run test:unit && pnpm run lint` (unit suites from Step 12
pass; full behavioral verification in Step 12's e2e run)

---

### Step 12 — test: UI unit (vitest) + e2e — fixtures, both-labels, cleared state, provisional

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/lib/scoreDisplay.test.ts` — create
- `services/xstockstrat-ui/e2e/mock-backend.ts` — modify
- `services/xstockstrat-ui/e2e/insights/backtest-coverage.spec.ts` — modify
- `services/xstockstrat-ui/e2e/insights/dashboard.spec.ts` — modify

**Reviewers**: `xstockstrat-ui` owner — analytics display accuracy, Connect-RPC call safety

**Codebase Evidence**:
- Breaking assertion to replace: `backtest-coverage.spec.ts:52`
  `getByText('Strategy Score')` (test `:47-60`).
- Fixtures to extend: `mock-backend.ts:399-425` (listStrategies, 3 scores), `:497-512`
  (getStrategyReport — `strat-history-001` scored; **any other id returns bare
  `{ strategyId }` at `:511`**, the hook for an error/NOT_FOUND variant), `:513-553`
  (listBacktests, 2 runs, else `{ runs: [] }` `:552`); `runBacktest` handler `:431` reads
  only `strategyId`/`symbols`/`range` — extend it to capture `strategyIdRef`.
- Dashboard mocks + assertions: `dashboard.spec.ts:36-63` (`mockAnalysis`), score colors
  `:86-114`, "Not scored" `:124-134`.
- No unit runner exists; `pnpm test:e2e` is the UI verification path (spec-template frontend
  row).

**TDD**: red-green required (unit tests fail against the pre-Step-11 tree — `scoreDisplay.ts`
does not exist yet; e2e assertions fail against the pre-Step-11 UI)

**Instructions**:
0. `src/lib/scoreDisplay.test.ts` (vitest, from Step 10's runner): `formatSymbolYears`
   (252 → "1.0 symbol-years", 2100 → "8.3", 0 → "0.0"); `ratingVariant`/`scoreColor`
   contract tables (A→buy, B→info, C→warning, else destructive; 0.8/0.6 color boundaries —
   bodies moved verbatim from `strategies/page.tsx:15-26`, tests pin the contract);
   `TRADING_DAYS_PER_YEAR === 252`; `isNotFoundError` true only for `ConnectError` with
   `Code.NotFound`.
1. Extend mock `StrategyScore` fixtures with `evidenceSymbols`, `evidenceDays`, `provisional`
   (at least one provisional=true strategy and one well-evidenced one); extend
   `BacktestRunSummary` fixtures with `rangeStart`/`rangeEnd` on one run and unset on the
   other (legacy placeholder case).
2. Replace `backtest-coverage.spec.ts:52` with the OQ-5 both-labels assertion: **both**
   `Strategy Grade` (card title) and `Run score` (Past Runs header) visible on
   `/insights/strategies/strat-history-001`; also assert the evidence caption renders
   (`symbols ·` pattern) and the legacy run's Range cell shows the placeholder.
3. New case: `runBacktest` mock captures the request → assert `strategyIdRef === strategyId`
   after clicking Run Backtest.
4. New cleared-state case: `getStrategyReport` mock throws NOT_FOUND (ConnectError code 5)
   for a dedicated id → assert the "Strategy Grade" empty-state card, the backtest form, and
   the Past Runs table all render.
5. Dashboard spec: assert the "Provisional" badge renders for the provisional fixture and not
   for the evidenced one.

**Verification**:
`cd services/xstockstrat-ui && pnpm run lint && pnpm run test:coverage && pnpm test:e2e`
(vitest coverage thresholds from Step 10's config enforce the `src/lib` 40% floor)

---

### Step 13 — test: wire agent + UI unit suites into CI

**Status**: `pending`
**Service**: `.github/workflows` (repo CI)
**Files**:
- `.github/workflows/ci.yml` — modify

**Reviewers**: `xstockstrat-analysis` owner — scoring determinism (agent suite guards the parity change); `xstockstrat-ui` owner — analytics display accuracy (unit suite guards scoreDisplay)

**Codebase Evidence**:
- **Not found (confirmed)**: `xstockstrat-agent` appears nowhere in `ci.yml` — no `changes`
  path filter (filter block `ci.yml:36-70` lists every other service), no `python-lint`
  matrix entry (`:281-287`: indicators/ingest/analysis only), no `python-test` matrix entry
  (`:322-331`) nor gate line (`:312-317`).
- `python-test` install pattern is `pip install -e ".[dev]"` (`ci.yml:344-345`); the agent's
  `pyproject.toml:19-20` already declares the `dev` extra (pytest, pytest-cov,
  pytest-asyncio, respx) and `[tool.pytest.ini_options]` (`:29-31`) — compatible as-is.
- `node-test` job: gate `ci.yml:468-476` (no `xstockstrat-ui`), matrix `include` with
  `coverage_threshold` entries (`:478-487`), runs `pnpm run test:coverage` in the service dir
  (`:511-513`), uploads `coverage/lcov.info` (`:515-521`) — vitest's lcov reporter (Step 10)
  matches the artifact path.

**TDD**: N/A (CI wiring — the suites themselves are Steps 9 and 12)

**Instructions**:
1. `changes` filter block (`ci.yml:36-70`): add
   `xstockstrat-agent:  ['services/xstockstrat-agent/**']` alongside the other service filters.
2. `python-lint` (`:271-287`): add `xstockstrat-agent` to the `if:` gate and the matrix
   `service` list (ruff config exists — agent `pyproject.toml:33-38`).
3. `python-test` (`:309-331`): add `contains(...'xstockstrat-agent')` to the `if:` gate and a
   matrix entry `- service: xstockstrat-agent / coverage_threshold: 40 / cov_source: app`
   (matches the agent CLAUDE.md's documented local convention).
4. `node-test` (`:465-487`): add `xstockstrat-ui` to the `if:` gate and a matrix entry
   `- service: xstockstrat-ui / coverage_threshold: 40` (informational — the actual gate is
   vitest's own scoped thresholds from Step 10; the job just runs `pnpm run test:coverage`).
5. Do NOT touch the required `Proto lint and breaking check` job or branch-protection names.

**Verification**:
Push the step branch and confirm in the PR checks: `Python test and coverage
(xstockstrat-agent)` and `Node test and coverage (xstockstrat-ui)` both appear and pass.
Local pre-check: `cd services/xstockstrat-agent && pip install -e ".[dev]" && pytest
--cov=app --cov-fail-under=40` (mirrors the CI command exactly) and
`cd services/xstockstrat-ui && pnpm run test:coverage`.

---

### Step 14 — docs: config keys + scoring semantics + test tooling

**Status**: `pending`
**Service**: `docs` (service CLAUDE.md files, root `CLAUDE.md`)
**Files**:
- `services/xstockstrat-analysis/CLAUDE.md` — modify
- `services/xstockstrat-ui/CLAUDE.md` — modify
- `services/xstockstrat-agent/CLAUDE.md` — modify
- `CLAUDE.md` — modify

**Reviewers**: none

**Codebase Evidence**:
- Service CLAUDE.md sections: "Config Keys Consumed" (`:139`), "Ledger Events Emitted"
  (`:173`), scoring/persistence sections ("Strategy Score Persistence", "Backtest
  Auto-Scoring & Run History").
- Root CLAUDE.md "Recently added keys" convention (feature-blocks in § Config Governance
  Rules); config-rollout.md pre-rollout checklist requires the root-CLAUDE.md key table entry.

**TDD**: N/A (docs)

**Instructions**:
1. Service CLAUDE.md: add the three keys to the config table
   (`analysis.scoring.shrinkage_days` int 250; `analysis.scoring.min_evidence_symbols` int 3;
   `analysis.scoring.min_evidence_days` int 500); rewrite the scoring/persistence sections to
   describe: evidence cells + fingerprint eligibility (incl. the NULL classes and the
   entry/exit-rule string-canonicalization sensitivity), traded-first dedup with zero-trade
   cells counted (visible behavior shift), shrinkage + renormalized components, OQ-1
   calibration anchors (perfect-evidence A ⇔ W ≥ 1.5k), recompute triggers + OQ-4 staleness
   (`ScoreStrategy` = manual refresh; `ScoreStrategyRequest.range` ignored), revert
   resurrection + rename-no-reset semantics, `get_int` zero-trap (0 ≡ default), the
   `analysis.strategy.scored` event remaining ScoreStrategy-only (update the Ledger Events
   table trigger wording), `backtest_run_symbols` retention gap, single-process lock note,
   OQ-6 correlated-breadth caveat, FR-9 first-recompute grade-drop note.
2. Root CLAUDE.md: append a "Recently added keys (feature 065 — cross-stock score derivation,
   owned by `xstockstrat-analysis`)" block with the three keys; update the § Language
   Versions & Tooling table's test-tooling row(s) to note vitest (UI unit tests) alongside
   Playwright.
3. UI CLAUDE.md § Testing: document the seeded vitest unit layer (`pnpm run test:unit` /
   `test:coverage`; node-environment logic tests, coverage scoped to `src/lib/**` at 40%,
   component/jsdom testing intentionally not included) alongside the existing Playwright e2e
   paragraphs.
4. Agent CLAUDE.md § Running Tests: replace the local-only convention note — the agent test
   suite now runs in CI (`python-lint` + `python-test` matrix entries, threshold 40), added
   by feature 065 step 13.

**Verification**:
`grep -n "shrinkage_days" CLAUDE.md services/xstockstrat-analysis/CLAUDE.md` — both list the
key with matching defaults; `grep -n "test:unit\|vitest" services/xstockstrat-ui/CLAUDE.md`
and `grep -n "python-test\|CI" services/xstockstrat-agent/CLAUDE.md` — tooling documented.

---

## Deviation Log

### Deviation: execution workflow — single integration PR (no stacked step PRs)
**Spec said**: sequential mode default is stacked per-step PRs (each based on the prior step branch).
**Actual**: user directed a single integration PR for the whole feature (2026-07-13, in response to
the mode-entry confirmation: "all that but only one single PR, no stacked PRs"). All 14 steps are
committed sequentially to the designated branch `claude/cross-stock-score-derivation-94k11z` (rebuilt
from `origin/main-dev` per the user's "use main-dev"), with one PR → `main-dev` at the end.
**Reason**: explicit user instruction. `**Disposition**`: user-directed workflow change.

### Deviation: Step 1 — buf breaking baseline branch
**Spec said**: `buf breaking --against "../../.git#branch=feature/cross-stock-score-derivation,subdir=packages/proto"`.
**Actual**: ran `buf breaking --against "../../.git#ref=origin/main-dev,subdir=packages/proto"`.
**Reason**: the feature branch was never pushed (single-PR flow on the designated branch); the correct
pre-change baseline for an additive-only check is `origin/main-dev` (the PR target). Result: no breaking
changes. `**Disposition**`: CI-equivalent fallback (mirrors CI proto baseline).

### Deviation: Step 3 — migration verified via throwaway Postgres (no migrate/Docker)
**Spec said**: `./scripts/db-migrate.sh && ./scripts/db-migrate.sh version` … then apply down + re-up.
**Actual**: `migrate` binary missing and Docker daemon down. Started the host's Postgres 16 cluster,
created a throwaway DB, applied 001→007 up, then 007 down (confirmed table/index/5 columns dropped,
prereq tables intact), then re-applied 007 up. Reversibility proven.
**Reason**: db-migrate.sh needs golang-migrate + a DB. `**Disposition**`: CI-equivalent fallback
(sequential-mode "migrate/DB unavailable" fallback).
