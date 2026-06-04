# Implementation Spec: formula-management-ui

**Status**: `complete`
**Created**: 2026-06-02 (regenerated — replaces 2026-05-10 version)
**Feature**: `docs/roadmap/features/003-formula-management-ui/feature.md`
**Total Steps**: 12
**Feature Branch**: `feature/formula-management-ui`

---

## Execution Summary

Work begins in `packages/proto` (Step 1 — add new messages and RPCs, plus `author` to `RegisterFormulaRequest`) followed by stub regeneration (Step 2). Once proto stubs are available, the indicators service receives its DB migration (Step 3), then a new repository layer (Step 4), then servicer changes that wire DB persistence and add the new RPCs (Step 5). A test step (Step 6) covers the indicators Python work. Steps 7–11 implement the UI layer in `xstockstrat-ui`: indicators BFF wiring (Step 7), browser client + hooks (Step 8), AppShell nav extension (Step 9), formula pages (Step 10), and UI docs (Step 11). Step 12 updates the `xstockstrat-indicators` CLAUDE.md. Steps 7–11 may only begin after Step 2 (proto stubs available for TS import) and Step 4 (DB wiring complete). Steps 8–11 require Step 7 (BFF registration).

## Step Dependencies

- Step 2 requires Step 1: proto stubs regenerated after `.proto` edit.
- Step 3 requires Step 1: migration introduces `indicators` schema the servicer writes to.
- Steps 4 and 5 require Step 3: service code depends on DB schema existing.
- Step 5 requires Step 4: servicer imports `FormulasRepository` from Step 4.
- Step 6 (test) covers Steps 4 and 5.
- Steps 7–11 require Step 2: TypeScript code imports from proto stubs.
- Step 8 requires Step 7: browser client imports `indicatorsClient` registered in Step 7.
- Steps 9–11 require Step 8: pages import hooks from Step 8.
- Step 12 requires Step 4: documents `DATABASE_URL` added to `main.py` in Step 4.

---

### Step 1 — proto: Add author to RegisterFormulaRequest and add ListFormulas, UpdateFormula, DeleteFormula RPCs

**Status**: `done`
**Service**: `packages/proto`
**Files**:
- `packages/proto/indicators/v1/indicators.proto` — modify

**Reviewers**: Proto Reviewer — field number uniqueness, backward compatibility (no field removal or type change without deprecation), `buf lint`/`buf breaking` passes, BSR publication readiness; `xstockstrat-indicators` owner — formula sandboxing, numeric precision, timeout enforcement (`indicators.sandbox.timeout_ms`), no side-effects from formula execution

**Codebase Evidence**:
- Confirmed via read of `packages/proto/indicators/v1/indicators.proto`: existing service block at lines 13–29, ends with `rpc GetFormula(GetFormulaRequest) returns (FormulaDefinition);` at line 28.
- Existing `RegisterFormulaRequest` (lines 106–112): fields `name=1`, `description=2`, `source=3`, `is_public=4`, `input_schema=5`. Field 6 is the next available slot — `author` must be added here to carry the user identity at create-time.
- `FormulaDefinition.author = 5` confirmed at line 86. The BFF will set `author` from the JWT `claims.user_id` so the backend servicer can store it without trusting the caller.
- `GetFormulaRequest` ends the message list at lines 118–120 (`formula_id = 1`). New request/response messages will be appended after it.
- Last used field numbers: `ListFormulasRequest` will use fields 1–4; `ListFormulasResponse` 1–2; `UpdateFormulaRequest` 1–6; `UpdateFormulaResponse` 1; `DeleteFormulaRequest` 1–2; `DeleteFormulaResponse` 1. All are new messages — no field number conflicts.
- All changes are additive (new field in existing message + new messages + new RPCs) — non-breaking per `buf breaking`.

**Instructions**:
1. Open `packages/proto/indicators/v1/indicators.proto`.
2. After the existing `rpc GetFormula(GetFormulaRequest) returns (FormulaDefinition);` at line 28, add three new RPCs to the `IndicatorsService` service block:
   ```protobuf
   // List formula definitions with optional author filter and pagination
   rpc ListFormulas(ListFormulasRequest) returns (ListFormulasResponse);

   // Update a formula's name, description, source, or is_public flag
   // Returns PERMISSION_DENIED if user_id does not match author
   rpc UpdateFormula(UpdateFormulaRequest) returns (UpdateFormulaResponse);

   // Delete a formula by ID
   // Returns PERMISSION_DENIED if user_id does not match author
   rpc DeleteFormula(DeleteFormulaRequest) returns (DeleteFormulaResponse);
   ```
3. In the `RegisterFormulaRequest` message (lines 106–112), add `author` as field 6, after `input_schema`:
   ```protobuf
   message RegisterFormulaRequest {
     string name = 1;
     string description = 2;
     string source = 3;
     bool is_public = 4;
     map<string, string> input_schema = 5;
     string author = 6;  // set by BFF from JWT claims; stored immutably
   }
   ```
4. After the existing `GetFormulaRequest` message (lines 118–120), append the following new messages:
   ```protobuf
   message ListFormulasRequest {
     string author_filter = 1;  // if non-empty, return only formulas where author == author_filter
     bool include_public = 2;   // if true, include all public formulas regardless of author_filter
     int32 page_size = 3;       // default 0 = no limit
     int32 page_offset = 4;     // default 0
   }

   message ListFormulasResponse {
     repeated FormulaDefinition formulas = 1;
     int32 total_count = 2;
   }

   message UpdateFormulaRequest {
     string formula_id = 1;
     string user_id = 2;        // must match formula.author; returns PERMISSION_DENIED otherwise
     string name = 3;
     string description = 4;
     string source = 5;
     bool is_public = 6;
   }

   message UpdateFormulaResponse {
     FormulaDefinition formula = 1;
   }

   message DeleteFormulaRequest {
     string formula_id = 1;
     string user_id = 2;        // must match formula.author; returns PERMISSION_DENIED otherwise
   }

   message DeleteFormulaResponse {
     bool success = 1;
   }
   ```

**Verification**:
```bash
cd packages/proto && buf lint && buf breaking --against '.git#branch=main-dev'
```
Expected: no output (exit code 0).

---

### Step 2 — proto-gen: Regenerate proto stubs

**Status**: `done`
**Service**: `packages/proto`
**Files**:
- `packages/proto/gen/python/indicators/v1/indicators_pb2.py` — modify (regenerated)
- `packages/proto/gen/python/indicators/v1/indicators_pb2_grpc.py` — modify (regenerated)
- `packages/proto/gen/ts/indicators/v1/indicators_pb.ts` — modify (regenerated)
- `packages/proto/gen/ts/indicators/v1/indicators.ts` — modify (regenerated)
- `packages/proto/gen/ts/indicators/v1/indicators_connect.ts` — modify (regenerated)
- `packages/proto/gen/ts/dist/indicators/v1/indicators_pb.js` — modify (recompiled)
- `packages/proto/gen/ts/dist/indicators/v1/indicators_pb.d.ts` — modify (recompiled)
- `packages/proto/gen/ts/dist/indicators/v1/indicators.js` — modify (recompiled)
- `packages/proto/gen/ts/dist/indicators/v1/indicators.d.ts` — modify (recompiled)
- `packages/proto/gen/go/indicators/v1/indicators.pb.go` — modify (regenerated)
- `packages/proto/gen/go/indicators/v1/indicators_grpc.pb.go` — modify (regenerated)
- `packages/proto/gen/go/indicators/v1/indicatorsv1connect/indicators.connect.go` — modify (regenerated)

**Reviewers**: Proto Reviewer — field number uniqueness, backward compatibility (no field removal or type change without deprecation), `buf lint`/`buf breaking` passes, BSR publication readiness; `xstockstrat-indicators` owner — formula sandboxing, numeric precision, timeout enforcement (`indicators.sandbox.timeout_ms`), no side-effects from formula execution

**Codebase Evidence**:
- Confirmed via `ls packages/proto/gen/ts/indicators/v1/`: `indicators.ts`, `indicators_connect.ts`, `indicators_pb.ts`.
- Confirmed `scripts/buf-gen.sh` generates Python in `gen/python/`, TypeScript in `gen/ts/`, Go in `gen/go/` (from existing generated file locations).
- Confirmed `packages/proto/gen/ts/indicators/v1/indicators_connect.ts`: current `IndicatorsService.methods` has `computeIndicator`, `executeFormula`, `listIndicators`, `registerFormula`, `getFormula` — 5 methods. After Step 1 and regeneration, `listFormulas`, `updateFormula`, `deleteFormula` will be added.
- Confirmed `packages/proto/gen/python/indicators/v1/indicators_pb2_grpc.py`: `IndicatorsServiceServicer` currently has 5 stub methods. After regeneration will have 8.

**Instructions**:
1. From the repository root, run:
   ```bash
   ./scripts/buf-gen.sh
   ```
2. Verify Python stubs contain the new methods.
3. Verify TypeScript stubs export the new types.
4. Stage all changed files in `packages/proto/gen/`.

**Verification**:
```bash
grep -n "ListFormulas\|UpdateFormula\|DeleteFormula" packages/proto/gen/python/indicators/v1/indicators_pb2_grpc.py
grep -n "ListFormulasRequest\|UpdateFormulaRequest\|DeleteFormulaRequest" packages/proto/gen/ts/indicators/v1/indicators_pb.ts
```
Expected: each grep returns multiple lines containing the new message and RPC names.

---

### Step 3 — migration: Create indicators.formulas table migration

**Status**: `done`
**Service**: `xstockstrat-indicators`
**Files**:
- `services/xstockstrat-indicators/migrations/001_formulas.up.sql` — create
- `services/xstockstrat-indicators/migrations/001_formulas.down.sql` — create

**Reviewers**: DBA — migration NNN numbering (no gaps, no conflicts), up+down pair present, index correctness, run-order compliance with `scripts/db-migrate.sh`; `xstockstrat-indicators` owner — formula sandboxing, numeric precision, timeout enforcement (`indicators.sandbox.timeout_ms`), no side-effects from formula execution

**Codebase Evidence**:
- Confirmed via `ls services/xstockstrat-indicators/migrations/`: directory does NOT exist — this is the first migration. NNN = `001`.
- Confirmed via `scripts/db-migrate.sh` lines 144–145: comment "indicators and analysis have no migrations dir yet" followed by `migrate_service "xstockstrat-indicators" "indicators"` — the call exists; no change to this script is required.
- Confirmed `scripts/db-migrate.sh` line 111–112: the `indicators` schema pre-creation is already in the init SQL block; the `CREATE SCHEMA IF NOT EXISTS indicators;` in the migration is still required for migrate-only runs.
- Confirmed `services/xstockstrat-ingest/migrations/` convention: `001_newsletter_signals.up.sql` / `001_newsletter_signals.down.sql` — zero-padded 3-digit NNN, `.up.sql`/`.down.sql` suffix pair.

**Instructions**:
1. Create directory `services/xstockstrat-indicators/migrations/`.
2. Create `services/xstockstrat-indicators/migrations/001_formulas.up.sql`:
   ```sql
   CREATE SCHEMA IF NOT EXISTS indicators;

   CREATE TABLE indicators.formulas (
       formula_id   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
       name         TEXT        NOT NULL,
       description  TEXT        NOT NULL DEFAULT '',
       source       TEXT        NOT NULL,
       author       TEXT        NOT NULL,
       is_public    BOOLEAN     NOT NULL DEFAULT FALSE,
       input_schema JSONB       NOT NULL DEFAULT '{}',
       created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
       updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
   );

   CREATE INDEX ON indicators.formulas (author);
   CREATE INDEX ON indicators.formulas (is_public) WHERE is_public = TRUE;
   ```
3. Create `services/xstockstrat-indicators/migrations/001_formulas.down.sql`:
   ```sql
   DROP TABLE IF EXISTS indicators.formulas;
   DROP SCHEMA IF EXISTS indicators;
   ```

**Verification**:
```bash
./scripts/db-migrate.sh up
```
Expected: no error on the indicators migration; `migrate_service "xstockstrat-indicators"` line reports `1/u 001_formulas`.

---

### Step 4 — service: Add FormulasRepository and DB pool wiring to xstockstrat-indicators

**Status**: `done`
**Service**: `xstockstrat-indicators`
**Files**:
- `services/xstockstrat-indicators/app/services/formulas_repository.py` — create
- `services/xstockstrat-indicators/app/main.py` — modify
- `services/xstockstrat-indicators/pyproject.toml` — modify
- `docker-compose.yml` — modify
- `.do/app.dev.yaml` — modify
- `.do/app.yaml` — modify

**Reviewers**: `xstockstrat-indicators` owner — formula sandboxing, numeric precision, timeout enforcement (`indicators.sandbox.timeout_ms`), no side-effects from formula execution

**Codebase Evidence**:
- Confirmed via read of `services/xstockstrat-indicators/app/main.py`: no `asyncpg` import, no `DATABASE_URL` env var, no pool creation — all absent, must be added. `CONFIG_ENDPOINT` is at L32; `servicer = IndicatorsServicer(config_watcher=config_watcher)` is at L44.
- Confirmed via read of `services/xstockstrat-ingest/app/main.py`: asyncpg pool created with `asyncpg.create_pool(DATABASE_URL, min_size=2, max_size=10)` and passed to servicer as `db_pool=`. DB pool closed in shutdown handler.
- Confirmed via read of `services/xstockstrat-indicators/pyproject.toml`: `asyncpg` is **absent** from dependencies. Must be added as `"asyncpg>=0.29.0"` (matches `services/xstockstrat-ingest/pyproject.toml`).
- Confirmed via read of `services/xstockstrat-indicators/app/services/`: contains `indicators_engine.py` and `sandbox.py`. `formulas_repository.py` is a new third module.
- `DATABASE_URL` confirmed **absent** in `docker-compose.yml` `xstockstrat-indicators` environment block (lines 260–286) — must add `<<: *db-url` merge to bring in the `DATABASE_URL` anchor, following the `xstockstrat-ingest` pattern at line 298 (`<<: [*common-env, *db-url]`). Also add `timescaledb: condition: service_healthy` and `db-migrator: condition: service_completed_successfully` to `depends_on`.
- `DATABASE_URL` confirmed **absent** in `xstockstrat-indicators` envs block in `.do/app.dev.yaml` (lines 127–149) — must add `- key: DATABASE_URL / scope: RUN_TIME / value: ${xstockstrat.DATABASE_URL}`.
- `DATABASE_URL` confirmed **absent** in `xstockstrat-indicators` envs block in `.do/app.yaml` (lines 127–149) — same addition required.

**Instructions**:
1. Add `"asyncpg>=0.29.0"` to `dependencies` in `services/xstockstrat-indicators/pyproject.toml` after `"opentelemetry-instrumentation-grpc>=0.46b0"`.

2. Create `services/xstockstrat-indicators/app/services/formulas_repository.py`. Model on `services/xstockstrat-ingest/app/handlers/servicer.py` DB query patterns (`db_pool.fetch`, `db_pool.fetchrow`, `db_pool.fetchval`, `db_pool.execute`). Implement:
   - `def __init__(self, db_pool)` — `self._db = db_pool`
   - `async def create(self, formula_id, name, description, source, author, is_public, input_schema) -> dict` — `INSERT INTO indicators.formulas (...) VALUES ($1,...) RETURNING *`; returns row as dict.
   - `async def get_by_id(self, formula_id) -> dict | None` — `SELECT * FROM indicators.formulas WHERE formula_id = $1`.
   - `async def list(self, author_filter: str, include_public: bool, page_size: int, page_offset: int) -> tuple[list[dict], int]` — COUNT query first, then SELECT with `WHERE (author = $1 OR ($2 AND is_public = TRUE))` (when `author_filter` is empty string, the `author = $1` clause matches nothing, so only the `include_public` branch returns rows; pass empty string as `$1` when no filter). Returns `(rows, total_count)`.
   - `async def update(self, formula_id, name, description, source, is_public) -> dict | None` — `UPDATE indicators.formulas SET name=$2, description=$3, source=$4, is_public=$5, updated_at=NOW() WHERE formula_id=$1 RETURNING *`.
   - `async def delete(self, formula_id) -> bool` — `DELETE FROM indicators.formulas WHERE formula_id=$1`; check `"DELETE 1"` in result; return `True` if deleted.

3. Modify `services/xstockstrat-indicators/app/main.py`:
   - Add `import asyncpg` after `import grpc` (line 16).
   - Add `DATABASE_URL = os.environ.get("DATABASE_URL", "postgres://xstockstrat:devpassword@localhost:5432/xstockstrat")` after `CONFIG_ENDPOINT = ...` (line 32).
   - In `serve()`, after `await config_watcher.wait_for_snapshot(...)` and before `servicer = IndicatorsServicer(...)`, add:
     ```python
     db_pool = await asyncpg.create_pool(DATABASE_URL, min_size=2, max_size=10)
     log.info("database pool established")
     ```
   - Change `servicer = IndicatorsServicer(config_watcher=config_watcher)` to `servicer = IndicatorsServicer(config_watcher=config_watcher, db_pool=db_pool)`.
   - In `handle_shutdown` (line 60), after `asyncio.get_event_loop().create_task(grpc_server.stop(grace=5))`, add `asyncio.get_event_loop().create_task(db_pool.close())` (matching ingest shutdown pattern).

4. In `docker-compose.yml`, change the `xstockstrat-indicators` `environment` merge from `<<: *common-env` to `<<: [*common-env, *db-url]` (line 269). Also add to its `depends_on` block:
   ```yaml
   timescaledb:
     condition: service_healthy
   db-migrator:
     condition: service_completed_successfully
   ```
   These are confirmed absent from the current block (lines 282–286).

5. In `.do/app.dev.yaml`, inside the `xstockstrat-indicators` `envs` block (after line 148 `value: indicators`), add:
   ```yaml
   - key: DATABASE_URL
     scope: RUN_TIME
     value: ${xstockstrat.DATABASE_URL}
   ```
   Confirmed absent: `grep -n DATABASE_URL .do/app.dev.yaml | grep -A2 "xstockstrat-indicators"` returns no match in that block.

6. In `.do/app.yaml`, same addition to `xstockstrat-indicators` `envs` block.

**Verification**:
```bash
cd services/xstockstrat-indicators && python -c "from app.services.formulas_repository import FormulasRepository; print('OK')"
```
Expected: prints `OK` (no import errors).
```bash
grep -n "DATABASE_URL" docker-compose.yml .do/app.dev.yaml .do/app.yaml | grep -i "indicators"
```
Expected: each file shows `DATABASE_URL` in context near `xstockstrat-indicators`.

---

### Step 5 — service: Add DB persistence and new CRUD RPCs to IndicatorsServicer

**Status**: `done`
**Service**: `xstockstrat-indicators`
**Files**:
- `services/xstockstrat-indicators/app/handlers/servicer.py` — modify

**Reviewers**: `xstockstrat-indicators` owner — formula sandboxing, numeric precision, timeout enforcement (`indicators.sandbox.timeout_ms`), no side-effects from formula execution

**Codebase Evidence**:
- Confirmed via read of `services/xstockstrat-indicators/app/handlers/servicer.py`:
  - `class IndicatorsServicer(indicators_pb2_grpc.IndicatorsServiceServicer):` at L17.
  - Constructor at L18: `def __init__(self, config_watcher: ConfigWatcher):` — must accept `db_pool`.
  - `self._formulas: dict[str, indicators_pb2.FormulaDefinition] = {}` at L20 — in-memory store, kept as cache alongside DB.
  - `RegisterFormula` at L126–146: creates proto object and stores in `self._formulas[formula_id]`. Must also write to DB and use `request.author` from the new proto field.
  - `GetFormula` at L148–155: looks up `self._formulas.get(request.formula_id)`, aborts with `NOT_FOUND` if missing.
  - `grpc.StatusCode.NOT_FOUND` abort pattern at L150–154; `grpc.StatusCode.INVALID_ARGUMENT` at L64–67.
  - `PERMISSION_DENIED` not yet in file; new pattern: `await context.abort(grpc.StatusCode.PERMISSION_DENIED, "user_id does not match formula author")`.
- Confirmed `app/handlers/servicer.py` is in coverage `omit` list (`pyproject.toml` L43) — new CRUD methods are in the servicer. Coverage for the feature comes from `formulas_repository.py` (not omitted).
- After Step 2, `indicators_pb2_grpc.IndicatorsServiceServicer` will have `ListFormulas`, `UpdateFormula`, `DeleteFormula` stubs.
- After Step 1, `indicators_pb2.RegisterFormulaRequest` will have `author` field (field 6).

**Instructions**:
1. Add `from app.services.formulas_repository import FormulasRepository` after the existing `from app.services import indicators_engine, sandbox` import (around L13).

2. Change constructor signature and body:
   ```python
   def __init__(self, config_watcher: ConfigWatcher, db_pool=None):
       self._cfg = config_watcher
       self._formulas: dict[str, indicators_pb2.FormulaDefinition] = {}
       self._repo: FormulasRepository | None = (
           FormulasRepository(db_pool) if db_pool is not None else None
       )
   ```

3. Modify `RegisterFormula` (L126–146): after `self._formulas[formula_id] = formula`, persist to DB:
   ```python
   if self._repo is not None:
       await self._repo.create(
           formula_id=formula_id,
           name=request.name,
           description=request.description,
           source=request.source,
           author=request.author if request.author else "dev-user",
           is_public=request.is_public,
           input_schema=dict(request.input_schema),
       )
   ```

4. Modify `GetFormula` (L148–155): fall back to DB when not in memory:
   ```python
   async def GetFormula(self, request, context):
       formula = self._formulas.get(request.formula_id)
       if formula is None and self._repo is not None:
           row = await self._repo.get_by_id(request.formula_id)
           if row is not None:
               formula = _row_to_formula(row)
               self._formulas[request.formula_id] = formula  # cache
       if formula is None:
           await context.abort(
               grpc.StatusCode.NOT_FOUND, f"formula {request.formula_id} not found"
           )
           return
       return formula
   ```

5. Also modify `ExecuteFormula` (L51–55): when `request.formula_id` is set and not in `self._formulas`, fall back to DB lookup before aborting NOT_FOUND:
   ```python
   if request.formula_id:
       formula = self._formulas.get(request.formula_id)
       if formula is None and self._repo is not None:
           row = await self._repo.get_by_id(request.formula_id)
           if row is not None:
               formula = _row_to_formula(row)
               self._formulas[request.formula_id] = formula
       if formula is None:
           await context.abort(
               grpc.StatusCode.NOT_FOUND, f"formula {request.formula_id} not found"
           )
           return
       source = formula.source
   ```

6. Add three new RPC implementations after `GetFormula`:
   ```python
   async def ListFormulas(self, request, context):
       if self._repo is None:
           formulas = list(self._formulas.values())
           return indicators_pb2.ListFormulasResponse(
               formulas=formulas,
               total_count=len(formulas),
           )
       rows, total = await self._repo.list(
           author_filter=request.author_filter,
           include_public=request.include_public,
           page_size=request.page_size,
           page_offset=request.page_offset,
       )
       return indicators_pb2.ListFormulasResponse(
           formulas=[_row_to_formula(r) for r in rows],
           total_count=total,
       )

   async def UpdateFormula(self, request, context):
       if self._repo is None:
           await context.abort(grpc.StatusCode.UNAVAILABLE, "DB not available")
           return
       row = await self._repo.get_by_id(request.formula_id)
       if row is None:
           await context.abort(grpc.StatusCode.NOT_FOUND, f"formula {request.formula_id} not found")
           return
       if row["author"] != request.user_id:
           await context.abort(grpc.StatusCode.PERMISSION_DENIED, "user_id does not match formula author")
           return
       updated = await self._repo.update(
           formula_id=request.formula_id,
           name=request.name,
           description=request.description,
           source=request.source,
           is_public=request.is_public,
       )
       self._formulas.pop(request.formula_id, None)
       return indicators_pb2.UpdateFormulaResponse(formula=_row_to_formula(updated))

   async def DeleteFormula(self, request, context):
       if self._repo is None:
           await context.abort(grpc.StatusCode.UNAVAILABLE, "DB not available")
           return
       row = await self._repo.get_by_id(request.formula_id)
       if row is None:
           await context.abort(grpc.StatusCode.NOT_FOUND, f"formula {request.formula_id} not found")
           return
       if row["author"] != request.user_id:
           await context.abort(grpc.StatusCode.PERMISSION_DENIED, "user_id does not match formula author")
           return
       success = await self._repo.delete(request.formula_id)
       self._formulas.pop(request.formula_id, None)
       return indicators_pb2.DeleteFormulaResponse(success=success)
   ```

7. Add the private helper `_row_to_formula` at module level (outside the class, at end of file):
   ```python
   def _row_to_formula(row: dict) -> "indicators_pb2.FormulaDefinition":
       """Convert a DB row dict from indicators.formulas to FormulaDefinition proto."""
       from google.protobuf.timestamp_pb2 import Timestamp
       import datetime

       def dt_to_ts(dt) -> Timestamp:
           ts = Timestamp()
           if dt is not None:
               ts.FromDatetime(dt if dt.tzinfo else dt.replace(tzinfo=datetime.timezone.utc))
           return ts

       return indicators_pb2.FormulaDefinition(
           formula_id=str(row["formula_id"]),
           name=row["name"],
           description=row["description"] or "",
           source=row["source"],
           author=row["author"],
           is_public=row["is_public"],
           created_at=dt_to_ts(row.get("created_at")),
           updated_at=dt_to_ts(row.get("updated_at")),
           input_schema=dict(row["input_schema"]) if row.get("input_schema") else {},
       )
   ```

**Verification**:
```bash
cd services/xstockstrat-indicators && python -c "
from app.handlers.servicer import IndicatorsServicer, _row_to_formula
print('servicer import OK')
"
```
Expected: prints `servicer import OK`.

---

### Step 6 — test: Add unit tests for FormulasRepository and indicators servicer CRUD methods

**Status**: `done`
**Service**: `xstockstrat-indicators`
**Files**:
- `services/xstockstrat-indicators/tests/test_formulas.py` — create
- `services/xstockstrat-indicators/pyproject.toml` — modify (add `pytest-asyncio>=0.23.0` to dev deps)

**Reviewers**: `xstockstrat-indicators` owner — formula sandboxing, numeric precision, timeout enforcement (`indicators.sandbox.timeout_ms`), no side-effects from formula execution

**Codebase Evidence**:
- Confirmed via read of `services/xstockstrat-indicators/tests/test_indicators_engine.py`: `pytest` class-based tests, pure-Python, no gRPC. `PRICES_20` fixture at L15.
- Confirmed via read of `services/xstockstrat-indicators/pyproject.toml` L34–35 (`dev` extras): only `pytest>=8.0.0` and `pytest-cov>=5.0.0`. `pytest-asyncio` is **absent** — must be added as `"pytest-asyncio>=0.23.0"`.
- Coverage omit list (L37–44) omits `app/handlers/servicer.py` and `app/main.py` but does NOT omit `app/services/formulas_repository.py` (new file) — repository tests will count toward coverage.
- CI threshold for `xstockstrat-indicators` is 50% (`--cov-fail-under=50`).

**Instructions**:
1. Add `"pytest-asyncio>=0.23.0"` to `[project.optional-dependencies] dev` in `services/xstockstrat-indicators/pyproject.toml` after `"pytest-cov>=5.0.0"`.
2. Run `uv lock` from `services/xstockstrat-indicators/` to update `uv.lock`.
3. Create `services/xstockstrat-indicators/tests/test_formulas.py`:

   **Test class `TestFormulasRepository`** (mock asyncpg pool, no DB required):
   - `test_create_calls_pool_fetchrow`: mock `db_pool.fetchrow` to return a dict with required fields; call `await repo.create(...)` and assert return dict has `formula_id`.
   - `test_get_by_id_returns_none_when_not_found`: mock `db_pool.fetchrow` to return `None`; assert `await repo.get_by_id("x")` is `None`.
   - `test_list_returns_rows_and_total`: mock `db_pool.fetchval` (COUNT) to return `2`, `db_pool.fetch` to return 2 fake rows; assert result is `([row1, row2], 2)`.
   - `test_delete_returns_true_on_success`: mock `db_pool.execute` to return `"DELETE 1"`; assert `await repo.delete("x")` is `True`.
   - `test_delete_returns_false_when_not_found`: mock `db_pool.execute` to return `"DELETE 0"`; assert `await repo.delete("x")` is `False`.

   Use `@pytest.mark.asyncio` on each async test; add `asyncio_mode = "auto"` to `[tool.pytest.ini_options]` or mark each test individually.

   **Test class `TestIndicatorsServicerCRUD`** (in-memory fallback, `db_pool=None`):
   - `test_list_formulas_empty_when_no_repo`: create `IndicatorsServicer(config_watcher=MagicMock())`, call `await servicer.ListFormulas(MagicMock(author_filter='', include_public=False, page_size=0, page_offset=0), MagicMock())`; assert `total_count == 0`.
   - `test_update_formula_unavailable_when_no_repo`: mock context with `AsyncMock`; call `UpdateFormula`; assert `context.abort` called with `UNAVAILABLE`.
   - `test_delete_formula_unavailable_when_no_repo`: same pattern for `DeleteFormula`.

**Verification**:
```bash
cd services/xstockstrat-indicators && uv run pytest tests/test_formulas.py -v
```
Expected: all tests pass. Then:
```bash
cd services/xstockstrat-indicators && ruff check . && ruff format --check . && uv run pytest --cov=app --cov-fail-under=50
```
Expected: ruff passes and coverage ≥ 50%.

---

### Step 7 — service: Wire IndicatorsService into xstockstrat-ui BFF and server-side client

**Status**: `done`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/lib/connectClients.ts` — modify
- `services/xstockstrat-ui/src/lib/insightsBff.ts` — modify

**Reviewers**: `xstockstrat-insights` owner — analytics display accuracy, SSE polling resilience, read-only access pattern

**Codebase Evidence**:
- Confirmed via read of `services/xstockstrat-ui/src/lib/connectClients.ts`:
  - Existing `INDICATORS_ENDPOINT` env var is **absent** from this file (confirmed: `grep -n "INDICATORS_ENDPOINT" services/xstockstrat-ui/src/lib/connectClients.ts` → no match).
  - Pattern: `const ANALYSIS_ENDPOINT = process.env.ANALYSIS_ENDPOINT ?? 'xstockstrat-analysis:50056'` at L18; `export const analysisClient = createClient(AnalysisService, makeTransport(ANALYSIS_ENDPOINT))` at L32.
  - `IndicatorsService` import not present — must be added from `@xstockstrat/proto/indicators/v1/indicators_pb`.
- Confirmed via read of `services/xstockstrat-ui/src/lib/insightsBff.ts`:
  - Currently registers `AnalysisService`, `MarketDataService`, `PortfolioService`, `TradingService` (lines 33–74).
  - `IndicatorsService` is absent.
  - `requireSession` + `backendHeaders` propagation pattern used consistently for all services — all outbound gRPC calls forward `x-user-id`, `x-access-scope`, `x-trace-id` via `backendHeaders(claims, ctx)`.
  - The header propagation mechanism: `backendHeaders` at lines 23–28 constructs headers from JWT claims and passes them as the second arg to every client call. The new indicators RPC calls must follow this same pattern — confirmed by reading the existing service registrations.
  - `PREFIX = '/insights/api'` at line 78 — formula RPC calls will be routed through the same catch-all handler at `src/app/insights/api/[...connect]/route.ts`.
- Confirmed `INDICATORS_ENDPOINT` is **absent** from `xstockstrat-ui` environment in `docker-compose.yml` (confirmed: grep returns no match for `xstockstrat-ui` in docker-compose — the service does not have a docker-compose block yet; the old `xstockstrat-insights` block at line 457 has `INDICATORS_ENDPOINT` and must have that carried forward when the docker-compose is updated for the consolidated service, but that is 045's scope — not this feature's).

**Note on deployment wiring**: `xstockstrat-ui` does not yet have entries in `docker-compose.yml`, `.do/app.dev.yaml`, or `.do/app.yaml` — these are added by feature 045. The `xstockstrat-insights` entries still exist in those files and currently serve as the deployment target. The `INDICATORS_ENDPOINT` env var is already present in the old `xstockstrat-insights` blocks (confirmed: `grep -n "INDICATORS_ENDPOINT" docker-compose.yml` → line 469 in the insights block). No additional deployment file changes are required for this step — the env var is already available to the running service.

**Instructions**:
1. In `services/xstockstrat-ui/src/lib/connectClients.ts`, add after the `INGEST_ENDPOINT` line (L20):
   ```typescript
   const INDICATORS_ENDPOINT = process.env.INDICATORS_ENDPOINT ?? 'xstockstrat-indicators:50054';
   ```
   Add after `import { IngestService } from ...`:
   ```typescript
   import { IndicatorsService } from '@xstockstrat/proto/indicators/v1/indicators_pb';
   ```
   Add after `export const ingestClient = ...`:
   ```typescript
   export const indicatorsClient = createClient(IndicatorsService, makeTransport(INDICATORS_ENDPOINT));
   ```

2. In `services/xstockstrat-ui/src/lib/insightsBff.ts`, add to the import block:
   ```typescript
   import { IndicatorsService } from '@xstockstrat/proto/indicators/v1/indicators_pb';
   import { indicatorsClient } from '@/lib/connectClients';
   ```
   After the `router.service(TradingService, {...})` block (line 74), add a new service registration:
   ```typescript
   router.service(IndicatorsService, {
     async registerFormula(req, ctx) {
       const claims = await requireSession(ctx);
       // Set author from JWT claims — overrides any caller-supplied value
       return indicatorsClient.registerFormula(
         { ...req, author: claims.user_id },
         { headers: backendHeaders(claims, ctx) },
       );
     },
     async getFormula(req, ctx) {
       const claims = await requireSession(ctx);
       return indicatorsClient.getFormula(req, { headers: backendHeaders(claims, ctx) });
     },
     async listFormulas(req, ctx) {
       const claims = await requireSession(ctx);
       return indicatorsClient.listFormulas(req, { headers: backendHeaders(claims, ctx) });
     },
     async updateFormula(req, ctx) {
       const claims = await requireSession(ctx);
       // Enforce user_id from JWT — caller cannot impersonate another user
       return indicatorsClient.updateFormula(
         { ...req, userId: claims.user_id },
         { headers: backendHeaders(claims, ctx) },
       );
     },
     async deleteFormula(req, ctx) {
       const claims = await requireSession(ctx);
       return indicatorsClient.deleteFormula(
         { ...req, userId: claims.user_id },
         { headers: backendHeaders(claims, ctx) },
       );
     },
     async executeFormula(req, ctx) {
       const claims = await requireSession(ctx);
       return indicatorsClient.executeFormula(req, { headers: backendHeaders(claims, ctx) });
     },
     async computeIndicator(req, ctx) {
       const claims = await requireSession(ctx);
       return indicatorsClient.computeIndicator(req, { headers: backendHeaders(claims, ctx) });
     },
     async listIndicators(req, ctx) {
       const claims = await requireSession(ctx);
       return indicatorsClient.listIndicators(req, { headers: backendHeaders(claims, ctx) });
     },
   });
   ```

**Header propagation note**: The new outbound calls to `indicatorsClient` reuse the existing `backendHeaders(claims, ctx)` mechanism defined at lines 23–28 of `insightsBff.ts`, which propagates `x-user-id`, `x-access-scope`, and `x-trace-id` to all backend calls. No additional propagation code is needed.

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm run lint
```
Expected: no lint errors. Additionally:
```bash
grep -n "indicatorsClient\|IndicatorsService" services/xstockstrat-ui/src/lib/connectClients.ts services/xstockstrat-ui/src/lib/insightsBff.ts
```
Expected: both files show the new symbol.

---

### Step 8 — service: Add indicators browser client and formula hooks to xstockstrat-ui

**Status**: `done`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/lib/browserClients/indicatorsClient.ts` — create
- `services/xstockstrat-ui/src/hooks/useFormulas.ts` — create

**Reviewers**: `xstockstrat-insights` owner — analytics display accuracy, SSE polling resilience, read-only access pattern

**Codebase Evidence**:
- Confirmed via `ls services/xstockstrat-ui/src/lib/browserClients/`: `analysisClient.ts`, `configClient.ts`, `ingestClient.ts`, `marketDataClient.ts`, `notifyClient.ts`, `portfolioClient.ts`, `tradingClient.ts`. `indicatorsClient.ts` is **absent** — new file required.
- Confirmed via read of `services/xstockstrat-ui/src/lib/browserClients/analysisClient.ts`: pattern is `createConnectTransport({ baseUrl: '/insights/api' })` → `createClient(AnalysisService, transport)`. The indicators browser client will use the same base URL — the `IndicatorsService` BFF handler registered in Step 7 routes under `/insights/api`.
- Confirmed via read of `services/xstockstrat-ui/src/hooks/useStrategies.ts`: `useQuery` + `useMutation` from `@tanstack/react-query`, imports from `@/lib/browserClients/analysisClient`. `useFormulas.ts` follows this pattern.
- `@monaco-editor/react` is **absent** from `services/xstockstrat-ui/package.json` (confirmed: grep returns no match). Must be added in Step 10 (where the FormulaEditor component is created) — not here.

**Instructions**:
1. Create `services/xstockstrat-ui/src/lib/browserClients/indicatorsClient.ts`:
   ```typescript
   import { createClient } from '@connectrpc/connect';
   import { createConnectTransport } from '@connectrpc/connect-web';
   import { IndicatorsService } from '@xstockstrat/proto/indicators/v1/indicators_pb';

   const transport = createConnectTransport({ baseUrl: '/insights/api' });
   export const indicatorsClient = createClient(IndicatorsService, transport);
   ```

2. Create `services/xstockstrat-ui/src/hooks/useFormulas.ts`:
   ```typescript
   import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
   import { indicatorsClient } from '@/lib/browserClients/indicatorsClient';
   import type {
     ListFormulasRequest,
     RegisterFormulaRequest,
     UpdateFormulaRequest,
     DeleteFormulaRequest,
   } from '@xstockstrat/proto/indicators/v1/indicators_pb';

   export function useFormulas(params: Partial<ListFormulasRequest> = {}) {
     return useQuery({
       queryKey: ['indicators-formulas', params],
       queryFn: () =>
         indicatorsClient.listFormulas({
           authorFilter: params.authorFilter ?? '',
           includePublic: params.includePublic ?? true,
           pageSize: params.pageSize ?? 50,
           pageOffset: params.pageOffset ?? 0,
         }),
     });
   }

   export function useFormula(formulaId: string | undefined) {
     return useQuery({
       queryKey: ['indicators-formula', formulaId],
       queryFn: () => indicatorsClient.getFormula({ formulaId: formulaId! }),
       enabled: !!formulaId,
     });
   }

   export function useRegisterFormula() {
     const queryClient = useQueryClient();
     return useMutation({
       mutationFn: (req: Partial<RegisterFormulaRequest>) =>
         indicatorsClient.registerFormula({
           name: req.name ?? '',
           description: req.description ?? '',
           source: req.source ?? '',
           isPublic: req.isPublic ?? false,
           inputSchema: req.inputSchema ?? {},
           author: req.author ?? '',
         }),
       onSuccess: () => queryClient.invalidateQueries({ queryKey: ['indicators-formulas'] }),
     });
   }

   export function useUpdateFormula() {
     const queryClient = useQueryClient();
     return useMutation({
       mutationFn: (req: Partial<UpdateFormulaRequest> & { formulaId: string }) =>
         indicatorsClient.updateFormula({
           formulaId: req.formulaId,
           userId: req.userId ?? '',
           name: req.name ?? '',
           description: req.description ?? '',
           source: req.source ?? '',
           isPublic: req.isPublic ?? false,
         }),
       onSuccess: (_, vars) => {
         queryClient.invalidateQueries({ queryKey: ['indicators-formulas'] });
         queryClient.invalidateQueries({ queryKey: ['indicators-formula', vars.formulaId] });
       },
     });
   }

   export function useDeleteFormula() {
     const queryClient = useQueryClient();
     return useMutation({
       mutationFn: (req: { formulaId: string; userId: string }) =>
         indicatorsClient.deleteFormula(req),
       onSuccess: () => queryClient.invalidateQueries({ queryKey: ['indicators-formulas'] }),
     });
   }

   export function useExecuteFormula() {
     return useMutation({
       mutationFn: (req: { formulaId: string; inputData: Record<string, unknown> }) =>
         indicatorsClient.executeFormula({
           formulaId: req.formulaId,
           inputData: req.inputData as any,
         }),
     });
   }
   ```

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm run lint
```
Expected: no lint errors.
```bash
grep -n "indicatorsClient\|useFormulas\|useFormula\|useRegisterFormula" services/xstockstrat-ui/src/hooks/useFormulas.ts services/xstockstrat-ui/src/lib/browserClients/indicatorsClient.ts
```
Expected: both files show the expected exports.

---

### Step 9 — service: Add Formulas nav link to insights AppShell

**Status**: `done`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/components/insights/AppShell.tsx` — modify

**Reviewers**: `xstockstrat-insights` owner — analytics display accuracy, SSE polling resilience, read-only access pattern

**Codebase Evidence**:
- Confirmed via read of `services/xstockstrat-ui/src/components/insights/AppShell.tsx`:
  - Desktop nav in-app links section at lines 58–80: `Dashboard` at `/insights` (L59–69) and `Strategies` at `/insights/strategies` (L70–80). The `Formulas` link must be added after Strategies, using the same `pathname?.startsWith(...)` active-class logic.
  - Mobile nav in-app links section at lines 118–123: same two links. Mobile `Formulas` link follows the same one-liner `Link` pattern.
  - Imports at L5: `BarChart2, TrendingUp, Settings, Menu, Activity` from `lucide-react`. `Code2` icon is available in `lucide-react@0.460.0` (confirmed present in `package.json` L39) and can be used for the Formulas nav item.

**Instructions**:
1. In `services/xstockstrat-ui/src/components/insights/AppShell.tsx`, add `Code2` to the lucide-react import at line 5:
   ```typescript
   import { BarChart2, TrendingUp, Settings, Menu, Activity, Code2 } from 'lucide-react';
   ```
2. In the desktop nav in-app links section (after the Strategies `Link` ending at line 80), add:
   ```tsx
   <Link
     href="/insights/formulas"
     className={cn(
       'px-3 py-1.5 rounded-md text-sm transition-colors',
       pathname?.startsWith('/insights/formulas')
         ? 'text-foreground font-medium'
         : 'text-muted-foreground hover:text-foreground hover:bg-accent/50',
     )}
   >
     Formulas
   </Link>
   ```
3. In the mobile nav section (after the Strategies `Link` at line 122), add:
   ```tsx
   <Link href="/insights/formulas" className={cn('px-3 py-2.5 rounded-md text-sm transition-colors', pathname?.startsWith('/insights/formulas') ? 'bg-accent text-foreground font-medium' : 'text-muted-foreground hover:text-foreground hover:bg-accent/50')}>
     Formulas
   </Link>
   ```

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm run lint
```
Expected: no lint errors.
```bash
grep -n "formulas\|Formulas" services/xstockstrat-ui/src/components/insights/AppShell.tsx
```
Expected: at least 2 matches (desktop + mobile nav links).

---

### Step 10 — service: Add FormulaEditor component and formula pages to xstockstrat-ui insights

**Status**: `done`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/package.json` — modify
- `services/xstockstrat-ui/src/components/insights/FormulaEditor.tsx` — create
- `services/xstockstrat-ui/src/app/insights/formulas/page.tsx` — create
- `services/xstockstrat-ui/src/app/insights/formulas/new/page.tsx` — create
- `services/xstockstrat-ui/src/app/insights/formulas/[id]/page.tsx` — create

**Reviewers**: `xstockstrat-insights` owner — analytics display accuracy, SSE polling resilience, read-only access pattern

**Codebase Evidence**:
- Confirmed `@monaco-editor/react` is **absent** from `services/xstockstrat-ui/package.json` (confirmed: grep returns no match). Must be added as `"@monaco-editor/react": "^4.6.0"`.
- Confirmed `services/xstockstrat-ui/src/components/insights/` directory exists with `AppShell.tsx` and `AccountPortfolioSelector.tsx`. `FormulaEditor.tsx` is a new component here.
- Confirmed `services/xstockstrat-ui/src/app/insights/strategies/page.tsx`: uses `useStrategies()` hook + `useQuery`, wraps in `<AppShell>`, uses `Card`/`CardContent`/`Badge` from `@/components/ui/`. No `formulas/` subdirectory exists in `src/app/insights/` — confirmed via file listing.
- Confirmed `services/xstockstrat-ui/src/app/insights/strategies/[id]/page.tsx`: uses `useState`, `use(params)` for async params, `useMutation` via `useRunBacktest`. The formula detail page follows this structural pattern.
- Confirmed `lucide-react@0.460.0` is present (`package.json` L39); `Code2`, `FlaskConical`, `Plus`, `Pencil`, `Trash2` icons are available.
- Confirmed `useFormulas`, `useFormula`, `useRegisterFormula`, `useUpdateFormula`, `useDeleteFormula`, `useExecuteFormula` will be created in Step 8.
- Confirmed `src/components/ui/card.tsx`, `src/components/ui/button.tsx`, `src/components/ui/input.tsx`, `src/components/ui/badge.tsx` exist in `xstockstrat-ui`.

**Instructions**:
1. Add `"@monaco-editor/react": "^4.6.0"` to `dependencies` in `services/xstockstrat-ui/package.json` after the `@radix-ui/...` entries. Then run `pnpm install` from `services/xstockstrat-ui/`.

2. Create `services/xstockstrat-ui/src/components/insights/FormulaEditor.tsx` — a `'use client'` wrapper around `@monaco-editor/react`:
   ```typescript
   'use client';
   import dynamic from 'next/dynamic';

   const MonacoEditor = dynamic(() => import('@monaco-editor/react'), { ssr: false });

   interface FormulaEditorProps {
     value: string;
     onChange?: (value: string) => void;
     readOnly?: boolean;
   }

   export function FormulaEditor({ value, onChange, readOnly = false }: FormulaEditorProps) {
     return (
       <MonacoEditor
         height="300px"
         language="python"
         theme="vs-dark"
         value={value}
         onChange={(v) => onChange?.(v ?? '')}
         options={{ minimap: { enabled: false }, readOnly, fontSize: 13 }}
       />
     );
   }
   ```
   Use `dynamic` with `{ ssr: false }` to avoid SSR issues with Monaco's browser-only dependencies.

3. Create `services/xstockstrat-ui/src/app/insights/formulas/page.tsx` — formula list page (`'use client'`):
   - Imports: `AppShell`, `Card`/`CardContent`, `Badge`, `Button`, `Link`, `useRouter`, `useFormulas`, `Code2`, `Plus`.
   - Calls `useFormulas({ includePublic: true, pageSize: 50 })`.
   - Renders a grid of formula cards: formula name, author (truncated), `isPublic` badge (Public/Private), `createdAt`.
   - "New Formula" button (top right) navigates to `/insights/formulas/new`.
   - Clicking a card navigates to `/insights/formulas/[formulaId]`.
   - Empty state: "No formulas yet. Click New Formula to create one."
   - Wraps in `<AppShell>`.

4. Create `services/xstockstrat-ui/src/app/insights/formulas/new/page.tsx` — formula creation page (`'use client'`):
   - Imports: `AppShell`, `Card`/`CardContent`/`CardHeader`/`CardTitle`, `Input`, `Button`, `FormulaEditor`, `useRegisterFormula`, `useRouter`.
   - Fields: `name` (text input, required), `description` (`<textarea>`), `source` (`<FormulaEditor>`), `isPublic` (checkbox).
   - On submit: calls `registerFormula({ name, description, source, isPublic })`. The BFF sets `author` from JWT claims (see Step 7 — `{ ...req, author: claims.user_id }`).
   - On success: `router.push('/insights/formulas/' + data.formulaId)`.
   - On error: show inline error below the form.
   - "Cancel" navigates to `/insights/formulas`.

5. Create `services/xstockstrat-ui/src/app/insights/formulas/[id]/page.tsx` — formula detail/edit/test page (`'use client'`):
   - Imports: `AppShell`, `Card`/`CardContent`/`CardHeader`/`CardTitle`, `Input`, `Button`, `Badge`, `FormulaEditor`, `useFormula`, `useUpdateFormula`, `useDeleteFormula`, `useExecuteFormula`, `useState`, `use`, `useRouter`, `ConnectError`.
   - Resolves `id` via `const { id } = use(params)`.
   - Fetches formula via `useFormula(id)`.
   - **View/Edit section**: renders name, description, author, `isPublic` badge. "Edit" button (shown only when `formula.author` matches — BFF will enforce; UI shows it for all for UX simplicity in dev) expands an inline edit form with `FormulaEditor`. On save: `updateFormula({ formulaId: id, name, description, source, isPublic })`. On cancel: revert.
   - **Delete section**: "Delete" button with `window.confirm(...)` confirmation. On confirm: `deleteFormula({ formulaId: id, userId: '' })` (BFF enforces user_id from JWT). On success: `router.push('/insights/formulas')`.
   - **Test Execute section** (FR-12): `<textarea>` for JSON input, "Run" button calls `executeFormula({ formulaId: id, inputData: JSON.parse(jsonInput) })`. Displays `ExecuteFormulaResponse` fields: `success`, `stdout`, `stderr`, `executionMs`, `error`.
   - Wraps in `<AppShell>`.

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm run lint
```
Expected: no lint errors.
```bash
ls services/xstockstrat-ui/src/app/insights/formulas/
```
Expected: `page.tsx`, `new/` directory (with `page.tsx`), `[id]/` directory (with `page.tsx`).
```bash
grep -n "@monaco-editor/react" services/xstockstrat-ui/package.json
```
Expected: one line with the version.

---

### Step 11 — docs: Update xstockstrat-indicators CLAUDE.md

**Status**: `done`
**Service**: `xstockstrat-indicators`
**Files**:
- `services/xstockstrat-indicators/CLAUDE.md` — modify

**Reviewers**: none

**Codebase Evidence**:
- Confirmed via read of `services/xstockstrat-indicators/CLAUDE.md`:
  - `## Dependencies` table ends at `xstockstrat-notify` (3 rows). `TimescaleDB` is absent — must be added.
  - `## Environment Variables` code block (lines ~74–83): lists `GRPC_PORT`, `CONFIG_ENDPOINT`, `LEDGER_ENDPOINT`, `NOTIFY_ENDPOINT`, `APPLICATION_ENV`, `TRADING_MODE`. `DATABASE_URL` is **absent**.
  - No `## Database` section exists.
  - `## Ports` table shows `gRPC 50054` only — no HTTP port (correctly reflects gRPC-only state after removal of port 8054).

**Instructions**:
1. In the `## Dependencies` table, add a new row after `xstockstrat-notify`:
   ```
   | TimescaleDB | asyncpg pool | Persist formula definitions to `indicators.formulas` |
   ```

2. Add a new `## Database` section immediately after `## Dependencies`:
   ```markdown
   ## Database

   - Schema: `indicators`
   - Table: `indicators.formulas` — stores formula definitions, scoped by `author`
   - Migration: `migrations/001_formulas.up.sql` / `migrations/001_formulas.down.sql`
   - Pool: `asyncpg.create_pool(DATABASE_URL, min_size=2, max_size=10)` created in `app/main.py`
   ```

3. In the `## Environment Variables` code block, add `DATABASE_URL` after `NOTIFY_ENDPOINT`:
   ```
   DATABASE_URL=postgres://xstockstrat:devpassword@timescaledb:5432/xstockstrat?sslmode=disable
   ```

**Verification**:
```bash
grep -n "DATABASE_URL\|TimescaleDB\|indicators.formulas" services/xstockstrat-indicators/CLAUDE.md
```
Expected: each string appears at least once.

---

### Step 12 — test: E2E smoke test for formula management UI pages

**Status**: `done`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/e2e/insights/formulas.spec.ts` — create

**Reviewers**: `xstockstrat-insights` owner — analytics display accuracy, SSE polling resilience, read-only access pattern

**Codebase Evidence** _(re-spec 2026-06-04 — original Step 12 targeted the now-deleted `services/xstockstrat-insights/e2e/`; the insights e2e suite was consolidated into `services/xstockstrat-ui/e2e/insights/` by the unified-FE-E2E work (PRs #513/#518/#520) that landed on main-dev after the 2026-06-02 re-spec)_:
- Confirmed via `ls services/xstockstrat-ui/e2e/insights/`: `account-portfolio.spec.ts`, `api-smoke.spec.ts`, `auth.spec.ts`, `dashboard.spec.ts`. Shared fixtures live one level up: `services/xstockstrat-ui/e2e/global-setup.ts`, `global-teardown.ts`, `mock-backend.ts`. The old `services/xstockstrat-insights/` service no longer exists (removed by 045 consolidation + unified-E2E follow-up).
- Confirmed via read of `services/xstockstrat-ui/playwright.config.ts`: `testDir: './e2e'`, `baseURL: 'http://localhost:3000'`, `globalSetup` starts a mock gRPC server on port 9092. The `webServer.env` block wires `ANALYSIS/MARKETDATA/IDENTITY/TRADING/PORTFOLIO_ENDPOINT` to `127.0.0.1:9092` plus `JWT_SECRET=test-jwt-secret-for-e2e-tests-min32c`. `INDICATORS_ENDPOINT` is NOT in that env block and `mock-backend.ts` does NOT mock `IndicatorsService` — so the formulas BFF call must be stubbed at the browser level with `page.route()` rather than relying on the mock backend.
- Confirmed via read of `services/xstockstrat-ui/e2e/insights/dashboard.spec.ts`: the page-navigation pattern is `addAuthCookie(page)` (signs an HS256 JWT with `jose` using `TEST_JWT_SECRET = 'test-jwt-secret-for-e2e-tests-min32c'` and sets the `access_token` cookie so middleware does not redirect to `/auth/login`) followed by `page.route('**/<Service>/<Method>', ...)` to fulfill the Connect-RPC call, then `page.goto('/insights/...')`. The formulas spec follows this exact pattern.
- Confirmed `services/xstockstrat-ui/package.json`: `"test:e2e": "playwright test"`, `"lint": "next lint"`.
- CI threshold for frontend services: no coverage threshold — E2E tests apply (`pnpm test:e2e`).

**Instructions**:
1. Create `services/xstockstrat-ui/e2e/insights/formulas.spec.ts`, modeled on `dashboard.spec.ts` (auth-cookie injection + `page.route()` browser-level stub of the IndicatorsService BFF call, since the mock backend does not handle it):
   ```typescript
   import { test, expect, type Page } from '@playwright/test';
   import { SignJWT } from 'jose';

   const TEST_JWT_SECRET = 'test-jwt-secret-for-e2e-tests-min32c';
   const BASE_URL = 'http://localhost:3000';

   async function addAuthCookie(page: Page): Promise<void> {
     const now = Math.floor(Date.now() / 1000);
     const token = await new SignJWT({
       user_id: 'test-user-001',
       email: 'test@example.com',
       roles: [],
       issued_at: now,
       expires_at: now + 3600,
     })
       .setProtectedHeader({ alg: 'HS256' })
       .setExpirationTime('1h')
       .sign(new TextEncoder().encode(TEST_JWT_SECRET));
     await page.context().addCookies([
       { name: 'access_token', value: token, url: BASE_URL, httpOnly: true, sameSite: 'Lax' },
     ]);
   }

   const MOCK_FORMULAS = [
     { formulaId: 'f-001', name: 'RSI Divergence', author: 'test-user-001', isPublic: true },
     { formulaId: 'f-002', name: 'MACD Cross', author: 'test-user-001', isPublic: false },
   ];

   test.describe('Formula management UI', () => {
     test('formulas list page renders returned formulas', async ({ page }) => {
       await addAuthCookie(page);
       await page.route('**/xstockstrat.indicators.v1.IndicatorsService/ListFormulas', async (route) => {
         await route.fulfill({
           status: 200,
           contentType: 'application/json',
           body: JSON.stringify({ formulas: MOCK_FORMULAS, totalCount: MOCK_FORMULAS.length }),
         });
       });
       await page.goto('/insights/formulas');
       await expect(page.getByText('RSI Divergence')).toBeVisible();
     });

     test('new formula page renders the create form', async ({ page }) => {
       await addAuthCookie(page);
       await page.goto('/insights/formulas/new');
       await expect(page.locator('input[name="name"], input[placeholder]').first()).toBeVisible({ timeout: 10000 });
     });
   });
   ```

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm test:e2e --grep "Formula management"
```
Expected: both formulas tests pass (requires the Playwright browsers + dev server from `playwright.config.ts`). If browsers/dev-server are unavailable in the execution environment, confirm the test file is valid TypeScript/lint-clean:
```bash
cd services/xstockstrat-ui && pnpm run lint
```

---

## Deviation Log

### Deviation: Step 1 — proto
**Spec said**: run `cd packages/proto && buf lint && buf breaking --against '.git#branch=main-dev'`
**Actual**: `buf` not installed in environment; validated proto syntax with `python3 -m grpc_tools.protoc` (exit 0) and confirmed no lines removed (purely additive change).
**Reason**: `buf` unavailable in this remote execution environment — same fallback used in phase3-deviations.md.

### Deviation: Step 2 — proto-gen
**Spec said**: run `./scripts/buf-gen.sh` (intended via the `Dockerfile.codegen` container per `scripts/localenv-setup.sh`).
**Actual**: the Docker codegen container could not be built (Docker Hub returned HTTP 429 unauthenticated-pull rate limit on `golang:1.25-trixie`). Installed the codegen toolchain directly on the host instead, pinned to the **CI `proto-freshness` job versions** in `.github/workflows/ci.yml` (the authoritative gate) rather than the stale pins in `Dockerfile.codegen`: `buf 1.69.0`, `protoc-gen-go@v1.36.11`, `protoc-gen-go-grpc@v1.6.2`, `protoc-gen-connect-go@v1.19.2`, `grpcio-tools==1.80.0` + `protobuf==6.31.1`, and TS plugins from the committed lockfile (`protoc-gen-es@2.12.0`, `protoc-gen-connect-es@1.7.0`, `ts-proto@2.11.8`). Ran `./scripts/buf-gen.sh` unchanged. Verified the resulting `git diff packages/proto/gen/` is limited to the 12 indicators stub files (no version-header drift in sibling services), i.e. CI's `git diff --exit-code` would pass.
**Reason**: Docker Hub rate limit blocked the sanctioned container path; matching the CI toolchain on the host produces byte-identical output to what `proto-freshness` regenerates. Note for a follow-up: `Dockerfile.codegen` pins `protoc-gen-go-grpc@v1.6.1`/`protoc-gen-connect-go@v1.19.2` while CI and the committed stubs use `v1.6.2`/`v1.19.2` — the Dockerfile go-grpc pin is stale, but that is outside this step's scope.

### Deviation: Step 3 — migration
**Spec said**: verify with `./scripts/db-migrate.sh up`.
**Actual**: `db-migrate.sh` requires the `migrate` (golang-migrate) binary + a running TimescaleDB (normally the `db-migrator` container), neither of which is available in this environment. Verified instead by applying both `001_formulas.up.sql` and `001_formulas.down.sql` against a throwaway `postgres:16-alpine` container via `psql -v ON_ERROR_STOP=1`: UP created the `indicators.formulas` table with all 9 columns, the PK, and both indexes (`formulas_author_idx`, partial `formulas_is_public_idx`); DOWN dropped the table and schema cleanly. `gen_random_uuid()` resolved without a `pgcrypto` extension (built-in since PostgreSQL 13).
**Reason**: golang-migrate binary unavailable; direct `psql` apply against the same PG16 engine TimescaleDB is built on exercises the identical DDL and is a stronger check than a syntax-only validation.

### Deviation: Step 4 — service (uv.lock + repo implementation detail)
**Spec said**: Files list = `formulas_repository.py`, `main.py`, `pyproject.toml`, `docker-compose.yml`, `.do/app.dev.yaml`, `.do/app.yaml`. Repository SQL described at a high level; `main.py` pool created with `asyncpg.create_pool(DATABASE_URL, min_size=2, max_size=10)`.
**Actual**:
1. Also regenerated and staged `services/xstockstrat-indicators/uv.lock` (added `asyncpg 0.31.0`). The root CLAUDE.md "Python uv lock rule" requires `uv.lock` to be committed in the same PR as any `pyproject.toml` dependency change (CI `uv lock --check` enforces it), so adding `asyncpg` to `pyproject.toml` without updating the lock would have failed CI. Expanded the step scope to include it (the "fix now" choice).
2. `formulas_repository.py` casts `formula_id` with `$1::uuid` (the servicer generates a string UUID via `uuid.uuid4()`, which asyncpg's strict UUID binding would otherwise reject) and JSON-encodes/decodes the `input_schema` JSONB column inside the repo (`json.dumps` on write, `json.loads` on read via `_to_dict`), so the Step 5 `_row_to_formula` helper always receives a plain `dict`. Kept `main.py`'s pool call exactly as specified (no `init=` codec), confining JSONB handling to the repository.
**Reason**: keep `pyproject.toml`/`uv.lock` in sync per CLAUDE.md; correct asyncpg UUID/JSONB typing for a working CRUD path without deviating from the spec's `main.py` snippet.

### Deviation: Step 5 — service (author on cached formula + ruff UP017)
**Spec said**: instruction #3 adds only the DB `create(...)` block after `self._formulas[formula_id] = formula`; instruction #7's `_row_to_formula` uses `datetime.timezone.utc`.
**Actual**:
1. Also set `author = request.author if request.author else "dev-user"` and added `author=author` to the in-memory `FormulaDefinition` in `RegisterFormula` (the spec's existing snippet omitted `author`). Without this, a `GetFormula` served from the in-memory cache immediately after registration would return an empty author while a DB-fallback read would return the real one — an inconsistency. The same `author` value is passed to `self._repo.create(...)`.
2. `ruff check` (rule UP017, in the service's `select` set) required `datetime.UTC` instead of `datetime.timezone.utc` in `_row_to_formula`; applied `ruff --fix` on the step's own lines per the lint-gate carve-out.
**Reason**: correctness of the author-scoping invariant and passing the service's own lint gate; both confined to lines this step introduced.

### Deviation: Step 6 — test (conftest.py + uv.lock)
**Spec said**: Files list = `tests/test_formulas.py`, `pyproject.toml`. `TestIndicatorsServicerCRUD` constructs `IndicatorsServicer` (which does `from gen.indicators.v1 import ...`).
**Actual**: also created `services/xstockstrat-indicators/tests/conftest.py` and regenerated `uv.lock`.
1. `conftest.py`: the indicators service had **no** conftest, unlike its Python siblings `xstockstrat-ingest` and `xstockstrat-analysis`, which both ship an identical `conftest.py` that registers `../../packages/proto/gen/python` as the `gen` namespace package. CI's `python-test` job runs only `pip install -e ".[dev]"` + `pytest` (it does not install the proto stubs), so without this conftest the new `TestIndicatorsServicerCRUD` import (`from app.handlers.servicer import IndicatorsServicer` → `from gen.indicators.v1 import ...`) would raise `ModuleNotFoundError` at collection time in CI. Copied the exact sibling conftest (the "fix now" choice).
2. `uv.lock`: regenerated after adding `pytest-asyncio>=0.23.0` to `pyproject.toml` dev deps, per the CLAUDE.md uv-lock rule (same rationale as Step 4).
**Reason**: the spec's own `TestIndicatorsServicerCRUD` cannot pass in CI without the gen-path conftest that every other Python service already uses; lockfile kept in sync. Result: `uv run pytest --cov=app --cov-fail-under=50` → 22 passed, 81.9% coverage.

### Deviation: Step 7 — service (import merge)
**Spec said**: instruction #2 adds `import { indicatorsClient } from '@/lib/connectClients';` as a separate import line in `insightsBff.ts`.
**Actual**: merged `indicatorsClient` into the existing `import { analysisClient, marketDataClient, portfolioClient, tradingClient } from '@/lib/connectClients';` line instead of adding a second import from the same module.
**Reason**: two imports from the same module path would be flagged by ESLint (`import/no-duplicates`) and fail `pnpm run lint`; merging is the lint-clean equivalent. `pnpm run lint` → no warnings/errors; `tsc --noEmit` clean.

### Deviation: Step 8 — service (typed cast + unused type import)
**Spec said**: `useExecuteFormula` casts `inputData: req.inputData as any`; the type-import block lists `ListFormulasRequest, RegisterFormulaRequest, UpdateFormulaRequest, DeleteFormulaRequest`.
**Actual**: cast `inputData` as `Record<string, never>` (the protoc-gen-es `Struct`-init shape) instead of `as any`, and dropped the unused `DeleteFormulaRequest` type import (`useDeleteFormula` takes a plain `{ formulaId, userId }` object, so the proto type is not referenced).
**Reason**: `as any` trips `@typescript-eslint/no-explicit-any` and an unused import trips `@typescript-eslint/no-unused-vars` — both fail `pnpm run lint`. The typed cast and trimmed import are lint-clean and `tsc --noEmit` passes.

### Deviation: Step 9 — service (Code2 import omitted)
**Spec said**: instruction #1 adds `Code2` to the `lucide-react` import; instructions #2/#3 add icon-less `Formulas` `<Link>`s.
**Actual**: did not add the `Code2` import. The Formulas nav links (like the existing Dashboard/Strategies in-app links) render text only — the spec's link markup never references `Code2`, so importing it would leave an unused symbol and fail `pnpm run lint` (`@typescript-eslint/no-unused-vars`). Kept the links icon-less for consistency with their siblings.
**Reason**: an imported-but-unused `Code2` breaks the lint gate; omitting it is lint-clean and visually consistent with the adjacent in-app nav links.

### Deviation: Step 10 — service (pnpm-lock.yaml)
**Spec said**: Files list includes `services/xstockstrat-ui/package.json` (add `@monaco-editor/react`) but not the lockfile.
**Actual**: also updated the workspace root `pnpm-lock.yaml` (via `pnpm --filter xstockstrat-ui add @monaco-editor/react@^4.6.0`). CI's `node-lint`/build jobs run `pnpm install --frozen-lockfile`, which fails if `package.json` and `pnpm-lock.yaml` are out of sync — so the lockfile must ship in the same PR.
**Reason**: keep the pnpm lockfile in sync with the new dependency (same rationale as the uv-lock steps). `tsc --noEmit` and `pnpm run lint` both clean.
