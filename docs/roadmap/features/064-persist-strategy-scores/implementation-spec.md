# Implementation Spec: persist-strategy-scores

**Status**: `complete`
**Created**: 2026-07-03
**Feature**: `docs/roadmap/features/064-persist-strategy-scores/feature.md`
**Total Steps**: 6
**Feature Branch**: `feature/persist-strategy-scores`

---

## Execution Summary

Implements the design-approved **write-through in-memory serving + hydrate-at-boot** model for
`xstockstrat-analysis` strategy scores (design.md § Chosen Approach). The DB is a durability backup;
`self._strategies` (`app/handlers/servicer.py:86`) stays the sole read path, so `ListStrategies` and
`GetStrategyReport` are unchanged. Order: (1) migration `005_strategy_scores` creates the table;
(2) a new `StrategyScoresRepository` mirrors the existing `StrategiesRepository`; (3) its unit test;
(4) servicer + boot wiring — inject the repo, best-effort upsert inside `ScoreStrategy`, a
`_row_to_score` helper, a `hydrate_scores()` servicer method, and the best-effort boot call in
`main.py`; (5) the paired servicer/hydrate test (the restart-survivability proof); (6) a docs note.

**Accepted limitations to carry into review** (design.md § Open Risks — stated here so they are
contractual, not surprises):

- **Partial durability.** Only `StrategyScore` is persisted, never `BacktestResult`. After a restart
  `GetStrategyReport` returns the hydrated score with `latest_backtest = null`, and re-scoring still
  requires a fresh `RunBacktest` (`self._backtests` is volatile; `ScoreStrategy` aborts `NOT_FOUND`
  without it — `servicer.py:668-674`). Reflected in Acceptance Criterion 2 below.
- **Unbounded table growth / orphan visibility.** `analysis.strategy_scores` has no retention or
  pagination; deactivated and ad-hoc-`strategy_id` scores persist and hydrate into `ListStrategies`.
  The UI cross-references definitions; the RPC makes no such guarantee. Accepted for now — candidate
  follow-up feature.
- **NaN/Infinity JSONB rejection.** Postgres JSONB rejects non-finite doubles. Today all components
  are clamped to `[0,1]` (`servicer.py:677-679`) and `overall` is a weighted sum of clamped values,
  so values are safe; Step 4 adds a defensive finite-value guard before `json.dumps` so a future
  unclamped `analysis.fundsignal.scoring_formula_id` (063) score cannot silently break the persist.

**Acceptance criteria** (from product-spec.md, refined per design Open Risks):
1. Score a strategy, restart analysis, call `ListStrategies` → the strategy still appears with its
   overall score, rating, and component scores (hydrate-at-boot).
2. `GetStrategyReport` returns the persisted `StrategyScore` after restart. **`latest_backtest` is
   `null`** until a fresh `RunBacktest` is run (partial-durability limitation — in scope).
3. Re-scoring the same strategy upserts one row per `strategy_id` (no duplicates).
4. Migration `005_` has a matching up/down pair, applies and rolls back cleanly via
   `scripts/db-migrate.sh`.
5. Pool budget unchanged — analysis stays at max 2, no new pool (reuses the existing asyncpg pool).
6. A simulated DB-write failure during `ScoreStrategy` still returns the computed score (FR-7).
7. `uv run pytest --cov=app --cov-fail-under=40` passes, including a persist→read-back (hydrate) test.

## Step Dependencies

- Step 2 (repo) requires Step 1 (migration): the repo's SQL targets the `analysis.strategy_scores`
  table created by the migration.
- Step 3 [test] covers Step 2 [service] (repo unit test) — Constitution C-08 pairing.
- Step 4 (servicer + boot wiring) requires Step 2 (repo): it injects and calls
  `StrategyScoresRepository`.
- Step 5 [test] covers Step 4 [service] (servicer persist + FR-7 + hydrate). The `main.py` change in
  Step 4 is a single best-effort call to `servicer.hydrate_scores()`; its logic is fully exercised by
  the `hydrate_scores()` unit test in Step 5. No standalone `main.py` unit test — boot glue,
  consistent with the existing live-loop / fundsignal-loop wiring (`main.py:84-115`), which has no
  `main.py` unit test either.
- Step 6 (docs) requires Steps 1 and 4 (documents the shipped table + behavior). Independent of tests.

---

### Step 1 — migration: create `analysis.strategy_scores` table

**Status**: `done`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/migrations/005_strategy_scores.up.sql` — create
- `services/xstockstrat-analysis/migrations/005_strategy_scores.down.sql` — create

**Reviewers**: DBA — migration NNN numbering (no gaps/conflicts), up+down pair present, index correctness, run-order compliance with `scripts/db-migrate.sh`; `xstockstrat-analysis` (service owner) — backtest reproducibility / strategy scoring determinism, no look-ahead bias

**Codebase Evidence**:
- Confirmed via `ls services/xstockstrat-analysis/migrations/` → highest existing prefix is
  `004_fundsignal_emitted.{up,down}.sql`; next number is `005_` (C-07).
- DDL style from `migrations/001_strategies.up.sql:1-10`: `CREATE TABLE IF NOT EXISTS analysis.<t> (...)`
  with a `TEXT PRIMARY KEY`, `TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()` `created_at`/`updated_at`
  columns, and no `CREATE SCHEMA analysis` (schema pre-exists — recon.md § Risks/Not-found).
- JSONB precedent: `003_fundsignal_runs.up.sql` and `001_strategies.up.sql` (`definition_json JSONB`).
- `.down.sql` precedent (`001_strategies.down.sql` = 42 bytes): a single `DROP TABLE IF EXISTS`.

**TDD**: `N/A (migration — validated by apply/rollback in Verification)`

**Instructions**:
- `005_strategy_scores.up.sql` — create the table with a loose `strategy_id` key (no FK to
  `analysis.strategies`; design.md rejected the FK — strategies are only soft-deactivated and ad-hoc
  backtests may score an id with no definition row):
  ```sql
  CREATE TABLE IF NOT EXISTS analysis.strategy_scores (
      strategy_id      TEXT PRIMARY KEY,
      overall_score    DOUBLE PRECISION NOT NULL,
      rating           TEXT NOT NULL,
      component_scores JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at       TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
      updated_at       TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
  );
  ```
  Do **not** add `CREATE SCHEMA analysis` (schema assumed pre-existing, matching `001`). Use
  `created_at`/`updated_at` (design.md rejected `scored_at` as misleading on re-score). No secondary
  index is required (PK lookup + full-table hydrate scan only).
- `005_strategy_scores.down.sql` — `DROP TABLE IF EXISTS analysis.strategy_scores;`
- Never edit an applied migration (F-01) — this is a brand-new pair.

**Verification**:
- `ls services/xstockstrat-analysis/migrations/005_strategy_scores.up.sql services/xstockstrat-analysis/migrations/005_strategy_scores.down.sql` — both exist.
- Apply then roll back cleanly against a local TimescaleDB:
  `./scripts/db-migrate.sh` (up) then verify the table exists
  (`psql "$DATABASE_URL" -c '\d analysis.strategy_scores'`), then roll back one step and confirm the
  table is gone. (Matches the DB runbook run-order; analysis migrations `001-004` already applied.)

---

### Step 2 — service: `StrategyScoresRepository`

**Status**: `done`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/app/repositories/strategy_scores.py` — create

**Reviewers**: `xstockstrat-analysis` (service owner) — strategy scoring determinism, persistence correctness (upsert idempotency)

**Codebase Evidence**:
- Mirror target `StrategiesRepository` — `app/repositories/strategies.py:27` — ctor
  `__init__(self, db_pool): self._db = db_pool` (`:30-31`); asyncpg `fetchrow`/`fetch`/`fetchval`
  style; `json.dumps(...)::jsonb` binding (`:34-45`, e.g. `VALUES ($1, $2, $3::jsonb)`).
- Module-level `_to_dict(row)` JSONB decode idiom — `strategies.py:14-24`: `d = dict(row)`, then for
  the JSONB column `if isinstance(raw, str): d[key] = json.loads(raw) if raw else {}` / `elif raw is
  None: d[key] = {}`. **P-03 copy-trap**: the mirror must decode the `component_scores` key, NOT
  `definition_json` — do not blind-copy `strategies.py:19`.
- No `ON CONFLICT`/upsert precedent exists in `strategies.py` (recon.md § Risks/Not-found) — the
  upsert (FR-2) is new-to-this-service; keep it the standard `INSERT ... ON CONFLICT (strategy_id) DO
  UPDATE ... RETURNING *`.

**TDD**: `red-green required`

**Instructions**:
- Create `StrategyScoresRepository` mirroring `StrategiesRepository` exactly (same ctor
  `__init__(self, db_pool): self._db = db_pool`; do not invent a new DB-access style — anti-duplication
  per recon.md § Patterns to REUSE).
- Add a module-level `_to_dict(row) -> dict | None` that decodes the **`component_scores`** JSONB key
  (the copy-trap fix above): `if isinstance(raw, str): d["component_scores"] = json.loads(raw) if raw
  else {}` / `elif raw is None: d["component_scores"] = {}`.
- Methods:
  - `async def upsert(self, strategy_id, overall_score, rating, component_scores: dict) -> dict`:
    ```sql
    INSERT INTO analysis.strategy_scores
        (strategy_id, overall_score, rating, component_scores)
    VALUES ($1, $2, $3, $4::jsonb)
    ON CONFLICT (strategy_id) DO UPDATE SET
        overall_score    = EXCLUDED.overall_score,
        rating           = EXCLUDED.rating,
        component_scores = EXCLUDED.component_scores,
        updated_at       = NOW()
    RETURNING *
    ```
    Bind `$4` as `json.dumps(dict(component_scores) if component_scores else {})` (mirrors
    `strategies.py:43`). Return `_to_dict(row)`.
  - `async def get_by_id(self, strategy_id: str) -> dict | None` —
    `SELECT * FROM analysis.strategy_scores WHERE strategy_id = $1`, return `_to_dict(row)`
    (mirrors `strategies.py:47-52`).
  - `async def list(self) -> list[dict]` — `SELECT * FROM analysis.strategy_scores`, return
    `[_to_dict(r) for r in rows]` (no pagination — hydrate reads the whole small table; see the
    unbounded-growth limitation in Execution Summary).

**Verification**:
- `python -c "from app.repositories.strategy_scores import StrategyScoresRepository, _to_dict"` (run
  from `services/xstockstrat-analysis` with the proto path set, or rely on the Step 3 import) imports
  cleanly.
- Behavioral verification is the paired Step 3 test (`red-green required`).

---

### Step 3 — test: `StrategyScoresRepository` unit test

**Status**: `done`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/tests/test_strategy_scores_repo.py` — create

**Reviewers**: `xstockstrat-analysis` (service owner) — test covers upsert SQL + real JSONB decode

**Codebase Evidence**:
- AsyncMock pool pattern — `tests/test_fundsignal_loop.py:44-56` (`db_pool=AsyncMock()`, per-method
  `execute`/`fetch`/`fetchrow` set as `AsyncMock`).
- Repos are injected as mocks in servicer tests, e.g. `svc._strategies_repo = AsyncMock()` at
  `tests/test_analysis_servicer.py:446` — the new repo test follows the same mockable-repo pattern
  (the repo module is imported directly by the new `tests/test_strategy_scores_repo.py`).

**TDD**: `red-green required` (author to fail first against the pre-Step-2 tree — the module does not
yet exist, so the import fails; then passes after Step 2).

**Instructions**:
- New file. Construct `repo = StrategyScoresRepository(db_pool)` with `db_pool = AsyncMock()`.
- Test `upsert`: set `db_pool.fetchrow = AsyncMock(return_value=<record-like dict>)`, call
  `await repo.upsert("strat-1", 0.82, "A", {"sharpe": 0.9, "drawdown": 0.7, "win_rate": 0.6})`, and
  assert the SQL passed to `fetchrow` contains `ON CONFLICT (strategy_id) DO UPDATE` and that the
  4th positional arg equals `json.dumps({"sharpe": 0.9, "drawdown": 0.7, "win_rate": 0.6})` (proves
  the `::jsonb` map is serialized, not passed as a dict).
- Test `_to_dict` **real-serialization** decode (the coverage the design's adversary flagged the
  mock-echo test as lacking): pass a row whose `component_scores` is a JSON **string**
  (`'{"sharpe": 0.9}'`) and assert `_to_dict` returns it decoded to `{"sharpe": 0.9}`; also assert the
  `None` branch yields `{}`.
- Test `list`: `db_pool.fetch = AsyncMock(return_value=[<row>, <row>])`, assert `await repo.list()`
  returns two decoded dicts.

**Verification**:
- `cd services/xstockstrat-analysis && uv run pytest tests/test_strategy_scores_repo.py -q` — passes.
- Lint (code-quality gate, step-constraints §B): `cd services/xstockstrat-analysis && ruff check . && ruff format --check .`
- Coverage gate (shared with Step 5's run):
  `cd services/xstockstrat-analysis && uv run pytest --cov=app --cov-fail-under=40` — confirm ≥ 40%.

---

### Step 4 — service: persist in `ScoreStrategy` + hydrate wiring

**Status**: `done`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/app/handlers/servicer.py` — modify
- `services/xstockstrat-analysis/app/main.py` — modify

**Reviewers**: `xstockstrat-analysis` (service owner) — scoring determinism, FR-7 best-effort
persistence, hydrate correctness, pool-budget invariance (no new pool)

**Codebase Evidence**:
- Repo injection idiom — `servicer.py:87`
  (`self._strategies_repo = StrategiesRepository(db_pool) if db_pool else None`); ctor takes
  `db_pool=None` (`servicer.py:61-71`). Import site for repos: `servicer.py:33`.
- `ScoreStrategy` builds `StrategyScore` at `servicer.py:698-707` and writes the in-memory dict at
  `servicer.py:708` (`self._strategies[request.strategy_id] = score`).
- FR-7 best-effort template — the ledger emit `try/except Exception → log.warning` at
  `servicer.py:717-728`.
- Components already clamped to `[0,1]` at `servicer.py:677-679`; `math` already imported
  (`servicer.py:16`) for a finite-value guard.
- Row→proto helper precedent — `_row_to_strategy_definition` at `servicer.py:940-952` (module-level
  helper in the `# ── Helpers ──` block).
- `StrategyScore` proto shape — `packages/proto/analysis/v1/analysis.proto:86-91`
  (`strategy_id`, `overall_score`, `rating`, `component_scores = map<string,double>`).
- Boot wiring site — `main.py:84` `if db_pool is not None:` block (live loop `88-98`, fundsignal
  `101-115`), before `await grpc_server.wait_for_termination()` at `:117`; servicer constructed at
  `main.py:52-61` with `db_pool` passed at `:58`.

**TDD**: `red-green required`

**Instructions** (`servicer.py`):
- Add `from app.repositories.strategy_scores import StrategyScoresRepository` alongside the existing
  repo import (`servicer.py:33`).
- In `__init__`, after `self._strategies_repo` (`servicer.py:87`), inject:
  `self._scores_repo = StrategyScoresRepository(db_pool) if db_pool else None` (guard every DB call on
  `is not None` so the no-DB `make_servicer()` test path still works — recon.md § Patterns to REUSE).
- In `ScoreStrategy`, immediately **after** `self._strategies[request.strategy_id] = score`
  (`servicer.py:708`) and before / alongside the ledger emit, add a best-effort upsert mirroring the
  ledger `try/except` (`servicer.py:717-728`):
  ```python
  if self._scores_repo is not None:
      try:
          components = {
              k: v for k, v in dict(score.component_scores).items() if math.isfinite(v)
          }
          await self._scores_repo.upsert(
              request.strategy_id, overall, rating, components
          )
      except Exception as e:
          log.warning("failed to persist strategy score: %s", e)
  ```
  Convert the protobuf `ScalarMap` via `dict(score.component_scores)`; the `math.isfinite` filter is
  the NaN/Infinity JSONB guard (Execution Summary limitation 3). This keeps FR-7: a swallowed write
  never fails `ScoreStrategy`, and because reads serve from `self._strategies` the caller still reads
  its own write back (no false-success — the design's core correctness fix).
- Add a module-level helper `_row_to_score(row: dict) -> analysis_pb2.StrategyScore` in the
  `# ── Helpers ──` block near `_row_to_strategy_definition` (`servicer.py:940`), decoding the
  `component_scores` map (NOT `definition_json` — copy-trap):
  ```python
  def _row_to_score(row: dict) -> "analysis_pb2.StrategyScore":
      return analysis_pb2.StrategyScore(
          strategy_id=row["strategy_id"],
          overall_score=row["overall_score"],
          rating=row["rating"],
          component_scores=row.get("component_scores") or {},
      )
  ```
- Add an async servicer method `hydrate_scores(self) -> None` that populates the in-memory dict from
  the DB (the unit-testable core of hydrate-at-boot):
  ```python
  async def hydrate_scores(self) -> None:
      if self._scores_repo is None:
          return
      rows = await self._scores_repo.list()
      for r in rows:
          self._strategies[r["strategy_id"]] = _row_to_score(r)
  ```
  `ListStrategies` (`servicer.py:732`) and `GetStrategyReport` (`servicer.py:736`) stay **unchanged** —
  they keep serving `self._strategies`; the DB is invisible to the read path.

**Instructions** (`main.py`):
- Inside the existing `if db_pool is not None:` block (`main.py:84`), after the servicer is
  constructed (`main.py:52-61`) and before `wait_for_termination` (`main.py:117`), add a best-effort
  boot hydrate wrapped in its own `try/except` so a hydrate failure never blocks startup:
  ```python
  try:
      await servicer.hydrate_scores()
      log.info("strategy scores hydrated from DB")
  except Exception as e:
      log.warning("failed to hydrate strategy scores: %s", e)
  ```
  This reuses the existing single asyncpg pool — no new pool; analysis stays at pool max 2, total ≤ 20
  (F-06). No new env var, port, or config key (no docker-compose / `.do/*.yaml` change needed).

**Verification**:
- Behavioral verification is the paired Step 5 test (`red-green required`).
- `cd services/xstockstrat-analysis && ruff check . && ruff format --check .` — lint clean.

---

### Step 5 — test: `ScoreStrategy` persistence + FR-7 + hydrate

**Status**: `done`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/tests/test_analysis_servicer.py` — modify

**Reviewers**: `xstockstrat-analysis` (service owner) — persist call correctness, FR-7 non-failure,
restart-survivability (hydrate) proof

**Codebase Evidence**:
- Mocked-repo servicer test pattern — `tests/test_analysis_servicer.py:446-575`
  (`svc._strategies_repo = AsyncMock()`); `make_servicer()` builds with **no** `db_pool`
  (`tests/test_analysis_servicer.py:22-34`), so `_scores_repo is None` there and existing ScoreStrategy
  tests are unaffected.
- Backtest fixture `_make_backtest(...)` at `tests/test_analysis_servicer.py:37-49` (populate
  `svc._backtests[id]` so `ScoreStrategy` does not abort `NOT_FOUND`).
- `AsyncMock`/`MagicMock` already imported (`tests/test_analysis_servicer.py:10`).

**TDD**: `red-green required` (author to fail first against the pre-Step-4 tree — `_scores_repo` /
`hydrate_scores` do not exist yet — then pass after Step 4).

**Instructions**:
- Add tests (set `svc._scores_repo = AsyncMock()`, `svc._ledger = AsyncMock()`, and populate
  `svc._backtests[id]` via `_make_backtest`):
  - **(a) persist call**: after `await svc.ScoreStrategy(request, ctx)`, assert
    `svc._scores_repo.upsert` was awaited once with `strategy_id`, the computed `overall`, `rating`,
    and a components dict containing `sharpe`/`drawdown`/`win_rate`.
  - **(b) FR-7 no-false-success**: set `svc._scores_repo.upsert.side_effect = Exception("db down")`;
    assert `ScoreStrategy` still **returns** the `StrategyScore` (no abort) **and** a following
    `ListStrategies` (or `svc._strategies[id]`) still returns that score — proving the swallowed write
    does not lose the read (AC-6).
  - **(c) hydrate (restart-survivability, AC-1/AC-7)**: `svc._scores_repo.list = AsyncMock(
    return_value=[{"strategy_id": "s1", "overall_score": 0.82, "rating": "A", "component_scores":
    {"sharpe": 0.9, "drawdown": 0.7, "win_rate": 0.6}}])`; `await svc.hydrate_scores()`; assert
    `svc._strategies["s1"]` is a `StrategyScore` with matching `overall_score`, `rating`, and
    `component_scores` map — this is the persist→read-back proof.
  - **(d) `_row_to_score` round-trip**: import `_row_to_score` from `app.handlers.servicer`, feed a
    row dict, assert `component_scores` (`map<string,double>`) survives equality.
- Do not modify `make_servicer()` (no-DB path must remain; existing tests rely on `_scores_repo`
  being `None`).

**Verification**:
- `cd services/xstockstrat-analysis && uv run pytest tests/test_analysis_servicer.py -q` — passes.
- Coverage gate (whole suite): `cd services/xstockstrat-analysis && uv run pytest --cov=app --cov-fail-under=40` — confirm ≥ 40%.
- Lint: `cd services/xstockstrat-analysis && ruff check . && ruff format --check .`

---

### Step 6 — docs: record the `analysis.strategy_scores` table + persistence behavior

**Status**: `done`
**Service**: `docs` (`xstockstrat-analysis` CLAUDE.md)
**Files**:
- `services/xstockstrat-analysis/CLAUDE.md` — modify

**Reviewers**: none (docs)

**Codebase Evidence**:
- `services/xstockstrat-analysis/CLAUDE.md` documents Config Keys, Ledger Events, and Env Vars but has
  no per-table list; the emitted event `analysis.strategy.scored` is already listed under
  "Ledger Events Emitted" (unchanged by this feature).
- Neither `docs/patterns/database.md` nor root `CLAUDE.md` enumerates analysis tables (confirmed via
  grep — no `analysis.strategies` / `analysis.strategy_scores` matches), so no schema-map edit is
  needed there.

**TDD**: `N/A (docs)`

**Instructions**:
- Add a short paragraph (near the Role / scoring section) noting that `ScoreStrategy` now persists the
  latest `StrategyScore` per strategy to `analysis.strategy_scores` (migration `005`, upsert on
  `strategy_id`, best-effort per FR-7) and that scores are hydrated into memory at boot so
  `ListStrategies`/`GetStrategyReport` survive a restart. Note the accepted limitations: only the
  score is persisted (not `BacktestResult`, so post-restart `latest_backtest` is `null`), and the
  table has no retention/pagination yet.
- Do not change the Config Keys, Ledger Events, or pool-budget statements (all unchanged).

**Verification**:
- `grep -n "strategy_scores" services/xstockstrat-analysis/CLAUDE.md` — the note is present.

---

## Deviation Log

### 2026-07-03 — process: sequential run without interactive gates + PR/verification env fallbacks
- **Deviation**: (1) Sequential mode-entry and per-feature confirmation gates (§5.1b/§5.4) are
  normally `AskUserQuestion`; that tool is unavailable in this non-interactive session, so the user's
  explicit `/sdd-execute … sequential` invocation is taken as the standing authorization (per the
  sequential-mode intro). (2) Stacked per-step PRs are replaced by per-step commits directly on the
  feature branch `feature/persist-strategy-scores`; the already-open PR #742 (feature → main-dev) is
  the integration PR. Reason: intermediate step-PR merges are impossible in one unattended run.
- **Disposition**: process deviation, user-authorized (explicit sequential invocation).

### 2026-07-03 — Step 1 — CI-equivalent migration verification (no docker / no db-migrate.sh)
- **Deviation**: The Docker daemon is down and no live TimescaleDB is provisioned, so
  `scripts/db-migrate.sh` (the spec's Verification) cannot run. Instead applied `005_*.up.sql` and
  `005_*.down.sql` against a throwaway local `postgres:16` cluster (`initdb` + `pg_ctl`, run as the
  unprivileged `postgres` user), pre-creating `CREATE SCHEMA analysis` (which the real DB already has
  from migration `001`'s run-order). Proved: table shape + PK, upsert idempotency (2 inserts on the
  same `strategy_id` → 1 row, latest wins — FR-2/AC-3), re-apply idempotence, and clean rollback (AC-4).
- **Disposition**: CI-equivalent fallback (sequential-mode §"verification fallbacks" — `migrate`/DB
  unavailable → throwaway postgres). Migration SQL unchanged.
