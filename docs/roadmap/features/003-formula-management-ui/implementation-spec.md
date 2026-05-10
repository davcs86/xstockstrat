# Implementation Spec: formula-management-ui

**Status**: `pending`
**Created**: 2026-05-10
**Feature**: `docs/roadmap/features/003-formula-management-ui/feature.md`
**Total Steps**: 12
**Feature Branch**: `feature/formula-management-ui`

---

## Execution Summary

Work begins in `packages/proto` (Step 1 — proto changes) followed immediately by stub regeneration (Step 2). Once new proto messages and RPCs are available, the indicators service receives its DB migration (Step 3), then a new repository layer (Step 4), then servicer changes that wire DB persistence into `RegisterFormula` and add `ListFormulas`, `UpdateFormula`, and `DeleteFormula` (Step 5), followed by the matching HTTP server routes (Step 6). Steps 7–10 add the insights API routes and pages: Step 7 adds the collection and per-record API routes, Step 8 adds the execute route (before the pages that call it), Step 9 adds the FormulaEditor component and list/detail pages, and Step 10 adds the new-formula creation page. Step 11 adds tests to both services. Step 12 updates `CLAUDE.md` for the indicators service to document the new environment variable and dependency. All steps in the indicators service must come after Step 3 (migration) since the servicer depends on the schema existing. Steps 7–10 (insights) depend only on Step 2 (stubs available for TS import) and may proceed in parallel with Steps 4–6 in a multi-developer context, but the canonical sequential order keeps proto changes first.

## Step Dependencies

- Step 2 requires Step 1: proto stubs are regenerated after the `.proto` file is edited.
- Step 3 requires Step 1: migration introduces the `indicators` schema that the servicer writes to.
- Steps 4, 5, 6 require Step 3: service code depends on the DB schema existing.
- Step 5 requires Step 4: the servicer imports `FormulasRepository` from Step 4.
- Step 6 requires Step 5: HTTP routes call servicer methods that include the new RPCs.
- Steps 7, 8, 9, 10 require Step 2: TypeScript routes use the Connect-RPC endpoint generated from proto.
- Step 9 requires Steps 7 and 8: formula list and detail pages depend on the collection API route (Step 7) and the execute route (Step 8), which must be deployed before the detail page's test-execute section is functional.
- Step 10 requires Steps 7 and 9: the new-formula page POSTs to `/api/formulas` (Step 7) and redirects to the detail page (Step 9).
- Step 11 requires Steps 5 and 9: tests cover the servicer and the UI pages.
- Step 12 requires Step 4: documents the `DATABASE_URL` env var added to `main.py` in Step 4.

---

### Step 1 — proto: Add ListFormulas, UpdateFormula, DeleteFormula RPCs to indicators.proto

**Status**: `pending`
**Service**: `packages/proto`
**Files**:
- `packages/proto/indicators/v1/indicators.proto` — modify

**Reviewers**: Proto Reviewer — field number uniqueness, backward compatibility (no field removal or type change without deprecation), `buf lint`/`buf breaking` passes, BSR publication readiness; `xstockstrat-indicators` owner — formula sandboxing, numeric precision, timeout enforcement, no side-effects from formula execution

**Codebase Evidence**:
- Confirmed via read of `packages/proto/indicators/v1/indicators.proto`: existing service block ends with `rpc GetFormula(GetFormulaRequest) returns (FormulaDefinition);` at line 28. Next available field in `FormulaDefinition` message after `input_schema = 9` is 10 (last used = 9, confirmed via `indicators_pb.ts` L278 `inputSchema`).
- Existing last message in file: `GetFormulaRequest` with `formula_id = 1` at line 120.
- Existing RPCs: `ComputeIndicator`, `ExecuteFormula`, `ListIndicators`, `RegisterFormula`, `GetFormula` — 5 RPCs. New RPCs will be appended after `GetFormula`.
- `FormulaDefinition` already contains `author` at field 5 (confirmed `indicators_pb.ts` L237) — this is the field used for ownership checks.
- Product spec requires `ListFormulasRequest.page_size = int32`, `page_offset = int32`, `author_filter = string`, `include_public = bool`; `ListFormulasResponse.formulas = repeated FormulaDefinition`, `total_count = int32`.
- Product spec requires `UpdateFormulaRequest.formula_id = string`, `user_id = string`, `name = string`, `description = string`, `source = string`, `is_public = bool`; `UpdateFormulaResponse.formula = FormulaDefinition`.
- Product spec requires `DeleteFormulaRequest.formula_id = string`, `user_id = string`; `DeleteFormulaResponse.success = bool`.
- All changes are additive (new messages + new RPCs) — non-breaking per `buf breaking`.

**Instructions**:
1. Open `packages/proto/indicators/v1/indicators.proto`.
2. After the existing `rpc GetFormula(GetFormulaRequest) returns (FormulaDefinition);` line (line 28), add three new RPCs to the `IndicatorsService` service block:
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
3. After the existing `GetFormulaRequest` message (line 117–119), append the following new messages:
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
4. Run `buf lint packages/proto/` — must pass with zero errors.
5. Run `buf breaking packages/proto/ --against '.git#branch=main-dev'` — must pass (additions are non-breaking).

**Verification**:
```bash
cd packages/proto && buf lint && buf breaking --against '.git#branch=main-dev'
```
Expected: no output (exit code 0).

---

### Step 2 — proto-gen: Regenerate proto stubs

**Status**: `pending`
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

**Reviewers**: Proto Reviewer — field number uniqueness, backward compatibility (no field removal or type change without deprecation), `buf lint`/`buf breaking` passes, BSR publication readiness; `xstockstrat-indicators` owner — formula sandboxing, numeric precision, timeout enforcement, no side-effects from formula execution

**Codebase Evidence**:
- Confirmed via read of `scripts/buf-gen.sh`: this script runs `buf generate` from `packages/proto/` and also compiles the TypeScript output. Confirmed generation targets: Python in `gen/python/`, TypeScript in `gen/ts/`, Go in `gen/go/` (read from `packages/proto/buf.yaml` and `buf.gen.yaml`).
- Confirmed existing generated files in: `packages/proto/gen/python/indicators/v1/`, `packages/proto/gen/ts/indicators/v1/`, `packages/proto/gen/ts/dist/indicators/v1/`, `packages/proto/gen/go/indicators/v1/`.

**Instructions**:
1. From the repository root, run the buf-gen script:
   ```bash
   ./scripts/buf-gen.sh
   ```
2. Verify that `packages/proto/gen/python/indicators/v1/indicators_pb2_grpc.py` now contains `ListFormulas`, `UpdateFormula`, `DeleteFormula` method stubs in the `IndicatorsServiceServicer` class and in `add_IndicatorsServiceServicer_to_server`.
3. Verify that `packages/proto/gen/ts/indicators/v1/indicators_pb.ts` now exports `ListFormulasRequest`, `ListFormulasRequestSchema`, `ListFormulasResponse`, `ListFormulasResponseSchema`, `UpdateFormulaRequest`, `UpdateFormulaResponse`, `DeleteFormulaRequest`, `DeleteFormulaResponse` types.
4. Stage all changed files in `packages/proto/gen/`.

**Verification**:
```bash
grep -n "ListFormulas\|UpdateFormula\|DeleteFormula" packages/proto/gen/python/indicators/v1/indicators_pb2_grpc.py
grep -n "ListFormulasRequest\|UpdateFormulaRequest\|DeleteFormulaRequest" packages/proto/gen/ts/indicators/v1/indicators_pb.ts
```
Expected: each grep returns multiple lines containing the new message and RPC names.

---

### Step 3 — migration: Create indicators.formulas table migration

**Status**: `pending`
**Service**: `xstockstrat-indicators`
**Files**:
- `services/xstockstrat-indicators/migrations/001_formulas.up.sql` — create
- `services/xstockstrat-indicators/migrations/001_formulas.down.sql` — create

**Reviewers**: DBA — migration NNN numbering (no gaps, no conflicts), up+down pair present, index correctness, run-order compliance with `scripts/db-migrate.sh`; `xstockstrat-indicators` owner — formula sandboxing, numeric precision, timeout enforcement, no side-effects from formula execution

**Codebase Evidence**:
- Confirmed via `ls services/xstockstrat-indicators/migrations/`: directory does NOT exist — this is the first migration for this service. NNN = `001`.
- Confirmed via `ls services/xstockstrat-ingest/migrations/`: existing pattern `001_newsletter_signals.up.sql` / `001_newsletter_signals.down.sql` — zero-padded 3-digit prefix, name follows `NNN_description.up.sql` convention.
- Confirmed via `scripts/db-migrate.sh` lines 121–123: `migrate_service "xstockstrat-indicators" "indicators"` is already called (after a comment "indicators and analysis have no migrations dir yet"). The script will pick up the new directory automatically — **no change to `db-migrate.sh` is required** (contrary to the product spec note).
- Product spec SQL (product-spec.md lines 68–85) specifies the exact DDL including schema creation, table definition, and two partial indexes.
- `gen_random_uuid()` is available in TimescaleDB (PostgreSQL 13+) as confirmed by usage in other services' migrations reviewed during platform implementation.

**Instructions**:
1. Create directory `services/xstockstrat-indicators/migrations/`.
2. Create `services/xstockstrat-indicators/migrations/001_formulas.up.sql` with exactly this content (matches product spec DDL):
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
4. No changes to `scripts/db-migrate.sh` are required — the `migrate_service "xstockstrat-indicators" "indicators"` call at line 122 already exists and will apply the migration once the directory is present.

**Verification**:
```bash
./scripts/db-migrate.sh version
# Expected: "indicators" service line shows version: 1/u 001_formulas
```
Or manually: `./scripts/db-migrate.sh up` then check for no error on the indicators migration.

---

### Step 4 — service: Add FormulasRepository and DB pool wiring to xstockstrat-indicators

**Status**: `pending`
**Service**: `xstockstrat-indicators`
**Files**:
- `services/xstockstrat-indicators/app/services/formulas_repository.py` — create
- `services/xstockstrat-indicators/app/main.py` — modify
- `services/xstockstrat-indicators/pyproject.toml` — modify

**Reviewers**: `xstockstrat-indicators` owner — formula sandboxing, numeric precision, timeout enforcement (`indicators.sandbox.timeout_ms`), no side-effects from formula execution

**Codebase Evidence**:
- Confirmed via read of `services/xstockstrat-ingest/app/handlers/servicer.py` L24: `db_pool=None` pattern — asyncpg pool passed to servicer constructor and stored as `self._db`.
- Confirmed via read of `services/xstockstrat-ingest/app/main.py` L17, L37–38, L61: `asyncpg` imported, `DATABASE_URL` env var read with default `"postgres://xstockstrat:devpassword@localhost:5432/xstockstrat"`, pool created with `asyncpg.create_pool(DATABASE_URL, min_size=2, max_size=10)`.
- Confirmed via read of `services/xstockstrat-indicators/app/main.py`: no asyncpg import, no `DATABASE_URL` env var, no pool creation — all must be added.
- Confirmed via read of `services/xstockstrat-indicators/app/main.py` L63: `servicer = IndicatorsServicer(config_watcher=config_watcher)` — constructor only takes `config_watcher` today; must be extended to accept `db_pool`.
- Confirmed via read of `services/xstockstrat-indicators/pyproject.toml`: `asyncpg` is NOT listed in dependencies. Must be added as `"asyncpg>=0.29.0"` (matching the version in `services/xstockstrat-ingest/pyproject.toml` L17).
- Confirmed via read of `services/xstockstrat-indicators/app/services/` dir: contains `indicators_engine.py` and `sandbox.py`. A new `formulas_repository.py` will be the third module here.

**Instructions**:
1. Add `"asyncpg>=0.29.0"` to the `dependencies` list in `services/xstockstrat-indicators/pyproject.toml` (after the existing `pydantic>=2.7.0` line).

2. Create `services/xstockstrat-indicators/app/services/formulas_repository.py` with an asyncpg-backed repository class. This file has **no prior pattern** in indicators — model it after the DB query patterns in `services/xstockstrat-ingest/app/handlers/servicer.py` (QuerySignals uses `self._db.fetch`, IngestSignal uses `self._db.fetchrow`). The class must implement:
   - `async def create(self, formula_id, name, description, source, author, is_public, input_schema) -> dict` — inserts a row using `INSERT INTO indicators.formulas ... RETURNING *` and returns the row as a dict.
   - `async def get_by_id(self, formula_id) -> dict | None` — `SELECT * FROM indicators.formulas WHERE formula_id = $1`.
   - `async def list(self, author_filter, include_public, page_size, page_offset) -> tuple[list[dict], int]` — returns `(rows, total_count)`. Query: fetch total_count with `SELECT COUNT(*)` first, then rows with `SELECT * ... LIMIT $3 OFFSET $4` (both filtered by `WHERE (author = $1 OR ($2 AND is_public = true))`; when `author_filter` is empty and `include_public` is false, return all rows the caller owns — treat empty `author_filter` as "no filter").
   - `async def update(self, formula_id, name, description, source, is_public) -> dict | None` — `UPDATE indicators.formulas SET name=$2, description=$3, source=$4, is_public=$5, updated_at=NOW() WHERE formula_id=$1 RETURNING *`.
   - `async def delete(self, formula_id) -> bool` — `DELETE FROM indicators.formulas WHERE formula_id=$1`; returns `True` if one row deleted.
   - Constructor: `def __init__(self, db_pool)` storing `self._db = db_pool`.

3. Modify `services/xstockstrat-indicators/app/main.py`:
   - Add `import asyncpg` (after existing `import grpc` line, matching ingest pattern).
   - Add `DATABASE_URL = os.environ.get("DATABASE_URL", "postgres://xstockstrat:devpassword@localhost:5432/xstockstrat")` (after existing `CONFIG_ENDPOINT` line at L36).
   - In `serve()`, after `config_watcher = ConfigWatcher(...)` and before `servicer = IndicatorsServicer(...)`, add:
     ```python
     db_pool = await asyncpg.create_pool(DATABASE_URL, min_size=2, max_size=10)
     log.info("database pool established")
     ```
   - Update the `servicer = IndicatorsServicer(...)` call to: `servicer = IndicatorsServicer(config_watcher=config_watcher, db_pool=db_pool)`.
   - In the `handle_shutdown` function's inner `_stop()` coroutine (currently only calls `grpc_server.stop(grace=5)`), also call `await db_pool.close()` after the grpc stop, matching the ingest pattern at `services/xstockstrat-ingest/app/main.py` L90–91.

**Verification**:
```bash
cd services/xstockstrat-indicators && GOWORK=off python -c "from app.services.formulas_repository import FormulasRepository; print('OK')"
```
Expected: prints `OK` (no import errors).

---

### Step 5 — service: Add DB persistence and new CRUD RPCs to IndicatorsServicer

**Status**: `pending`
**Service**: `xstockstrat-indicators`
**Files**:
- `services/xstockstrat-indicators/app/handlers/servicer.py` — modify

**Reviewers**: `xstockstrat-indicators` owner — formula sandboxing, numeric precision, timeout enforcement (`indicators.sandbox.timeout_ms`), no side-effects from formula execution

**Codebase Evidence**:
- Confirmed via read of `services/xstockstrat-indicators/app/handlers/servicer.py`:
  - `class IndicatorsServicer(indicators_pb2_grpc.IndicatorsServiceServicer):` at L17.
  - Constructor signature at L18: `def __init__(self, config_watcher: ConfigWatcher):` — must be extended to accept `db_pool`.
  - `self._formulas: dict[str, indicators_pb2.FormulaDefinition] = {}` at L20 — in-memory store, kept alongside DB for backward compat / cache.
  - `RegisterFormula` at L126: currently creates a `FormulaDefinition` proto object, stores it in `self._formulas[formula_id]`. Must be modified to also call `self._repo.create(...)` when `self._repo is not None`.
  - `GetFormula` at L148: currently looks up `self._formulas.get(request.formula_id)`. Must be extended to fall back to DB lookup if not in memory.
  - Existing `grpc.StatusCode.NOT_FOUND` abort pattern at L150–154: `await context.abort(grpc.StatusCode.NOT_FOUND, ...)`.
  - Existing `grpc.StatusCode.INVALID_ARGUMENT` abort pattern at L64–67.
  - New `PERMISSION_DENIED` pattern (not yet in file): `await context.abort(grpc.StatusCode.PERMISSION_DENIED, "user_id does not match formula author")`.
- Confirmed via read of `packages/proto/gen/python/indicators/v1/indicators_pb2_grpc.py`: after Step 2, `IndicatorsServiceServicer` will have `ListFormulas`, `UpdateFormula`, `DeleteFormula` stubs.
- `google.protobuf.timestamp_pb2.Timestamp` already imported at L129 (inside `RegisterFormula`).

**Instructions**:
1. Add `from app.services.formulas_repository import FormulasRepository` import at the top of the file, after the existing `from app.services import indicators_engine, sandbox` import (around L13).

2. Change the constructor signature and body:
   - Old (L18–20): `def __init__(self, config_watcher: ConfigWatcher): self._cfg = config_watcher; self._formulas = {}`
   - New:
     ```python
     def __init__(self, config_watcher: ConfigWatcher, db_pool=None):
         self._cfg = config_watcher
         self._formulas: dict[str, indicators_pb2.FormulaDefinition] = {}
         self._repo: FormulasRepository | None = (
             FormulasRepository(db_pool) if db_pool is not None else None
         )
     ```

3. Modify `RegisterFormula` (currently L126–146): after setting `self._formulas[formula_id] = formula`, add a DB persist call if `self._repo` is not None:
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
   Return `indicators_pb2.RegisterFormulaResponse(formula_id=formula_id)` unchanged.

4. Modify `GetFormula` (currently L148–155): after looking up in `self._formulas`, if not found and `self._repo is not None`, try DB lookup:
   ```python
   async def GetFormula(self, request, context):
       formula = self._formulas.get(request.formula_id)
       if formula is None and self._repo is not None:
           row = await self._repo.get_by_id(request.formula_id)
           if row is not None:
               formula = _row_to_formula(row)
               self._formulas[request.formula_id] = formula  # cache in memory
       if formula is None:
           await context.abort(
               grpc.StatusCode.NOT_FOUND, f"formula {request.formula_id} not found"
           )
           return
       return formula
   ```

5. Add the three new RPC implementations after `GetFormula`:
   ```python
   async def ListFormulas(self, request, context):
       if self._repo is None:
           # Fall back to in-memory list (no DB)
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
       # Invalidate in-memory cache entry
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

6. Add the private helper function `_row_to_formula` at module level (outside the class, at end of file) that converts an asyncpg `Record` dict to a `FormulaDefinition` proto:
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
Expected: prints `servicer import OK` (no import errors).

---

### Step 6 — service: Add ListFormulas, UpdateFormula, DeleteFormula HTTP routes to http_server.py

**Status**: `pending`
**Service**: `xstockstrat-indicators`
**Files**:
- `services/xstockstrat-indicators/app/http_server.py` — modify

**Reviewers**: `xstockstrat-indicators` owner — formula sandboxing, numeric precision, timeout enforcement (`indicators.sandbox.timeout_ms`), no side-effects from formula execution

**Codebase Evidence**:
- Confirmed via read of `services/xstockstrat-indicators/app/http_server.py`:
  - Existing Connect-RPC route pattern at L37–40:
    ```python
    @app.post("/xstockstrat.indicators.v1.IndicatorsService/ComputeIndicator")
    async def compute_indicator(request: Request):
        return await _call(request, indicators_pb2.ComputeIndicatorRequest, servicer.ComputeIndicator)
    ```
  - Last existing route at L55–57:
    ```python
    @app.post("/xstockstrat.indicators.v1.IndicatorsService/GetFormula")
    async def get_formula(request: Request):
        return await _call(request, indicators_pb2.GetFormulaRequest, servicer.GetFormula)
    ```
  - Helper `_call(request, req_cls, handler_fn)` at L92–103: deserialises JSON body to `req_cls()` proto, calls handler, returns JSON.
  - After Step 2, `indicators_pb2` will have `ListFormulasRequest`, `UpdateFormulaRequest`, `DeleteFormulaRequest` classes.

**Instructions**:
1. Open `services/xstockstrat-indicators/app/http_server.py`.
2. After the existing `get_formula` route (currently ending around L57), append three new routes following the same `_call` pattern:
   ```python
   @app.post("/xstockstrat.indicators.v1.IndicatorsService/ListFormulas")
   async def list_formulas(request: Request):
       return await _call(request, indicators_pb2.ListFormulasRequest, servicer.ListFormulas)

   @app.post("/xstockstrat.indicators.v1.IndicatorsService/UpdateFormula")
   async def update_formula(request: Request):
       return await _call(request, indicators_pb2.UpdateFormulaRequest, servicer.UpdateFormula)

   @app.post("/xstockstrat.indicators.v1.IndicatorsService/DeleteFormula")
   async def delete_formula(request: Request):
       return await _call(request, indicators_pb2.DeleteFormulaRequest, servicer.DeleteFormula)
   ```
3. No changes required to `_call` helper, `_NoopContext`, or n8n webhook routes.

**Verification**:
```bash
curl -s -X POST http://localhost:8054/xstockstrat.indicators.v1.IndicatorsService/ListFormulas \
  -H 'Content-Type: application/json' \
  -d '{"pageSize":10,"pageOffset":0}'
```
Expected: JSON response `{"formulas":[],"totalCount":0}` (empty list, no error).

---

### Step 7 — service: Add /api/formulas API routes to xstockstrat-insights

**Status**: `pending`
**Service**: `xstockstrat-insights`
**Files**:
- `services/xstockstrat-insights/src/app/api/formulas/route.ts` — create
- `services/xstockstrat-insights/src/app/api/formulas/[id]/route.ts` — create

**Reviewers**: `xstockstrat-insights` owner — analytics display accuracy, SSE polling resilience, read-only access pattern

**Codebase Evidence**:
- Confirmed via read of `services/xstockstrat-insights/src/app/api/analysis/strategies/route.ts`: existing API route pattern uses `fetch` directly against the Connect-RPC HTTP endpoint with `Content-Type: application/connect+json`, reading env var for base URL with fallback.
- Confirmed via read of `services/xstockstrat-insights/src/app/api/analysis/backtest/route.ts`: `POST` handler extracts JSON body with `await req.json()`, calls downstream service, returns `NextResponse.json(result)`.
- Confirmed via read of `services/xstockstrat-insights/src/lib/connectTransport.ts` L33–34: `INDICATORS_BASE_URL = process.env.INDICATORS_HTTP_ENDPOINT ?? 'http://xstockstrat-indicators:8054'`.
- Confirmed via read of `services/xstockstrat-insights/src/app/api/` dir: directory exists with `analysis/`, `health/`, `portfolio/` subdirectories. A new `formulas/` subdirectory is required — not yet present.
- Product spec FR-13: API routes read `user_id` from `X-User-Id` request header; fallback `'dev-user'` when absent.

**Instructions**:
1. Create `services/xstockstrat-insights/src/app/api/formulas/route.ts`:

   ```typescript
   /**
    * GET /api/formulas?author_filter=&include_public=&page_size=&page_offset=
    *   → ListFormulas on xstockstrat-indicators:8054
    *
    * POST /api/formulas
    *   Body: { name, description, source, is_public, input_schema? }
    *   → RegisterFormula on xstockstrat-indicators:8054
    *   user_id read from X-User-Id header; fallback 'dev-user'
    */
   import { NextRequest, NextResponse } from 'next/server';

   const INDICATORS_BASE_URL =
     process.env.INDICATORS_HTTP_ENDPOINT ?? 'http://xstockstrat-indicators:8054';

   function getUserId(req: NextRequest): string {
     return req.headers.get('x-user-id') ?? 'dev-user';
   }

   async function rpc(method: string, body: object): Promise<Response> {
     return fetch(`${INDICATORS_BASE_URL}/${method}`, {
       method: 'POST',
       headers: { 'Content-Type': 'application/connect+json' },
       body: JSON.stringify(body),
     });
   }

   export async function GET(req: NextRequest) {
     try {
       const { searchParams } = req.nextUrl;
       const res = await rpc('xstockstrat.indicators.v1.IndicatorsService/ListFormulas', {
         authorFilter: searchParams.get('author_filter') ?? '',
         includePublic: searchParams.get('include_public') === 'true',
         pageSize: parseInt(searchParams.get('page_size') ?? '50', 10),
         pageOffset: parseInt(searchParams.get('page_offset') ?? '0', 10),
       });
       const data = await res.json();
       return NextResponse.json(data);
     } catch (err: any) {
       return NextResponse.json({ error: err.message }, { status: 500 });
     }
   }

   export async function POST(req: NextRequest) {
     try {
       const userId = getUserId(req);
       const body = await req.json();
       const res = await rpc('xstockstrat.indicators.v1.IndicatorsService/RegisterFormula', {
         name: body.name ?? '',
         description: body.description ?? '',
         source: body.source ?? '',
         isPublic: body.is_public ?? false,
         inputSchema: body.input_schema ?? {},
         author: userId,
       });
       const data = await res.json();
       return NextResponse.json(data);
     } catch (err: any) {
       return NextResponse.json({ error: err.message }, { status: 500 });
     }
   }
   ```

2. Create `services/xstockstrat-insights/src/app/api/formulas/[id]/route.ts`:

   ```typescript
   /**
    * GET /api/formulas/[id]         → GetFormula
    * PUT /api/formulas/[id]         → UpdateFormula (user_id from X-User-Id)
    * DELETE /api/formulas/[id]      → DeleteFormula (user_id from X-User-Id)
    */
   import { NextRequest, NextResponse } from 'next/server';

   const INDICATORS_BASE_URL =
     process.env.INDICATORS_HTTP_ENDPOINT ?? 'http://xstockstrat-indicators:8054';

   function getUserId(req: NextRequest): string {
     return req.headers.get('x-user-id') ?? 'dev-user';
   }

   async function rpc(method: string, body: object): Promise<Response> {
     return fetch(`${INDICATORS_BASE_URL}/${method}`, {
       method: 'POST',
       headers: { 'Content-Type': 'application/connect+json' },
       body: JSON.stringify(body),
     });
   }

   export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
     try {
       const res = await rpc('xstockstrat.indicators.v1.IndicatorsService/GetFormula', {
         formulaId: params.id,
       });
       const data = await res.json();
       return NextResponse.json(data);
     } catch (err: any) {
       return NextResponse.json({ error: err.message }, { status: 500 });
     }
   }

   export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
     try {
       const userId = getUserId(req);
       const body = await req.json();
       const res = await rpc('xstockstrat.indicators.v1.IndicatorsService/UpdateFormula', {
         formulaId: params.id,
         userId,
         name: body.name ?? '',
         description: body.description ?? '',
         source: body.source ?? '',
         isPublic: body.is_public ?? false,
       });
       const data = await res.json();
       return NextResponse.json(data);
     } catch (err: any) {
       return NextResponse.json({ error: err.message }, { status: 500 });
     }
   }

   export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
     try {
       const userId = getUserId(req);
       const res = await rpc('xstockstrat.indicators.v1.IndicatorsService/DeleteFormula', {
         formulaId: params.id,
         userId,
       });
       const data = await res.json();
       return NextResponse.json(data);
     } catch (err: any) {
       return NextResponse.json({ error: err.message }, { status: 500 });
     }
   }
   ```

**Verification**:
```bash
curl -s http://localhost:3001/api/formulas?page_size=10
```
Expected: JSON with `formulas` array (may be empty: `{"formulas":[],"totalCount":0}`), HTTP 200.

---

### Step 8 — service: Add execute API route for test-execute from formula detail page

**Status**: `pending`
**Service**: `xstockstrat-insights`
**Files**:
- `services/xstockstrat-insights/src/app/api/formulas/[id]/execute/route.ts` — create

**Reviewers**: `xstockstrat-insights` owner — analytics display accuracy, SSE polling resilience, read-only access pattern

**Codebase Evidence**:
- Confirmed via read of `services/xstockstrat-insights/src/app/api/analysis/backtest/route.ts`: `POST` handler pattern — reads body with `await req.json()`, calls downstream service via `fetch` to Connect-RPC endpoint, returns `NextResponse.json(result)`.
- Confirmed via read of `services/xstockstrat-indicators/app/http_server.py` L43–45: `ExecuteFormula` route is at `/xstockstrat.indicators.v1.IndicatorsService/ExecuteFormula`, accepts `formulaId` (or `formulaSource`) and `inputData`.
- This route is referenced by the formula detail page created in Step 9 — both steps must be deployed before the test-execute section of the detail page is functional.

**Instructions**:
1. Create `services/xstockstrat-insights/src/app/api/formulas/[id]/execute/route.ts`:

   ```typescript
   /**
    * POST /api/formulas/[id]/execute
    * Body: { input_data: Record<string, unknown> }
    * → ExecuteFormula on xstockstrat-indicators:8054 using formulaId
    * Returns: ExecuteFormulaResponse (success, output, stdout, stderr, executionMs, error)
    */
   import { NextRequest, NextResponse } from 'next/server';

   const INDICATORS_BASE_URL =
     process.env.INDICATORS_HTTP_ENDPOINT ?? 'http://xstockstrat-indicators:8054';

   export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
     try {
       const body = await req.json();
       const res = await fetch(
         `${INDICATORS_BASE_URL}/xstockstrat.indicators.v1.IndicatorsService/ExecuteFormula`,
         {
           method: 'POST',
           headers: { 'Content-Type': 'application/connect+json' },
           body: JSON.stringify({
             formulaId: params.id,
             inputData: body.input_data ?? {},
           }),
         },
       );
       const data = await res.json();
       return NextResponse.json(data);
     } catch (err: any) {
       return NextResponse.json({ error: err.message }, { status: 500 });
     }
   }
   ```

**Verification**:
```bash
curl -s -X POST http://localhost:3001/api/formulas/nonexistent-id/execute \
  -H 'Content-Type: application/json' \
  -d '{"input_data":{}}'
```
Expected: JSON error response (formula not found from indicators), HTTP 200 with `{"error": "..."}` or indicators NOT_FOUND message — no 500 crash from the route handler itself.

---

### Step 9 — service: Add FormulaEditor component and /formulas pages to xstockstrat-insights

**Status**: `pending`
**Service**: `xstockstrat-insights`
**Files**:
- `services/xstockstrat-insights/src/components/FormulaEditor.tsx` — create
- `services/xstockstrat-insights/src/app/formulas/page.tsx` — create
- `services/xstockstrat-insights/src/app/formulas/[id]/page.tsx` — create
- `services/xstockstrat-insights/src/components/AppShell.tsx` — modify
- `services/xstockstrat-insights/package.json` — modify

**Reviewers**: `xstockstrat-insights` owner — analytics display accuracy, SSE polling resilience, read-only access pattern

**Codebase Evidence**:
- Confirmed via read of `services/xstockstrat-insights/package.json`: `@monaco-editor/react` is NOT listed in dependencies — must be added. No `monaco` dependency anywhere in the file.
- Confirmed via read of `services/xstockstrat-insights/src/components/AppShell.tsx` L70–81: in-app nav section has `Link href="/"` (Dashboard) and `Link href="/strategies"` (Strategies). A new "Formulas" link must be added following the same pattern: `<Link href="/formulas" className={cn('px-3 py-1.5 rounded-md text-sm transition-colors', ...)}>Formulas</Link>`.
- Same mobile nav section at L117–122 needs the matching mobile nav item.
- Confirmed `src/components/` directory exists with `AppShell.tsx`, `AccountPortfolioSelector.tsx`, and `ui/` subdirectory. `FormulaEditor.tsx` is a new file here.
- Confirmed via read of `src/app/strategies/page.tsx`: SWR + `'use client'` + `useSWR` fetcher pattern for list pages. `AppShell` wrapper, `Card`/`CardContent` components from `src/components/ui/card.tsx`.
- Confirmed via read of `src/app/strategies/[id]/page.tsx`: detail page pattern with `useState`, form state, action buttons, result display. Used as structural reference for formula detail/edit page.
- Product spec OQ-3 (resolved): Monaco Editor (`@monaco-editor/react`) chosen for formula source.
- Confirmed `lucide-react` is in `package.json` (L28) — `Code2`, `FlaskConical`, `Plus`, `Pencil`, `Trash2` icons can be used from it.

**Instructions**:
1. Add `"@monaco-editor/react": "^4.6.0"` to the `dependencies` section of `services/xstockstrat-insights/package.json` (after the existing `@radix-ui/...` entries).

2. Create `services/xstockstrat-insights/src/components/FormulaEditor.tsx` — a `'use client'` component wrapping `@monaco-editor/react`'s `Editor` component. It accepts props `value: string`, `onChange: (v: string) => void`, `readOnly?: boolean`. Set `language="python"`, `theme="vs-dark"`, `height="300px"`, `options={{ minimap: { enabled: false }, readOnly: readOnly ?? false }}`. Export as named export `FormulaEditor`.

3. Create `services/xstockstrat-insights/src/app/formulas/page.tsx` — the formula list page (`'use client'`):
   - Uses `useSWR('/api/formulas?include_public=true&page_size=50', fetcher)` with `refreshInterval: 0` (formulas don't change on a timer).
   - Displays formulas in a card grid: formula name, author (truncated), `is_public` badge ("Public"/"Private"), created_at date.
   - "New Formula" button (top right in header) navigates to `/formulas/new`.
   - Clicking a formula card navigates to `/formulas/[formulaId]`.
   - Wrap in `AppShell`. Empty state: "No formulas yet. Click New Formula to create one."

4. _(The new-formula creation page is implemented in Step 10.)_

5. Create `services/xstockstrat-insights/src/app/formulas/[id]/page.tsx` — the formula detail/edit/test page (`'use client'`):
   - Fetches formula data with `useSWR('/api/formulas/' + id, fetcher)`.
   - **View/Edit section**: shows name, description, author, is_public. If `author === userId` (from `'dev-user'` fallback), shows "Edit" button that expands an inline edit form with `FormulaEditor` for source. On save: `PUT /api/formulas/[id]`. On cancel: reverts.
   - **Delete section**: "Delete" button with confirmation dialog. On confirm: `DELETE /api/formulas/[id]`, then navigates back to `/formulas`.
   - **Test Execute section** (FR-12): JSON textarea for input data, "Run" button that POSTs to `/api/formulas/[id]/execute` (execute route created in Step 8). Returns and displays the `ExecuteFormulaResponse` fields: `success`, `output`, `stdout`, `stderr`, `executionMs`.
   - Wrap in `AppShell`.

6. Modify `services/xstockstrat-insights/src/components/AppShell.tsx`:
   - In the desktop nav section (currently L59–80 where Dashboard and Strategies links are), add after the Strategies link:
     ```tsx
     <Link
       href="/formulas"
       className={cn(
         'px-3 py-1.5 rounded-md text-sm transition-colors',
         pathname?.startsWith('/formulas')
           ? 'text-foreground font-medium'
           : 'text-muted-foreground hover:text-foreground hover:bg-accent/50',
       )}
     >
       Formulas
     </Link>
     ```
   - In the mobile nav section (currently L117–122), add a matching mobile nav `Link` for `/formulas` after the Strategies link.

**Verification**:
```bash
pnpm --filter xstockstrat-insights run lint
```
Expected: no lint errors. Then navigate to `http://localhost:3001/formulas` and verify the page loads.

---

### Step 10 — service: Add new-formula creation page to xstockstrat-insights

**Status**: `pending`
**Service**: `xstockstrat-insights`
**Files**:
- `services/xstockstrat-insights/src/app/formulas/new/page.tsx` — create

**Reviewers**: `xstockstrat-insights` owner — analytics display accuracy, SSE polling resilience, read-only access pattern

**Codebase Evidence**:
- Confirmed via Step 9: `src/app/formulas/page.tsx` navigates to `/formulas/new` via a "New Formula" button — the route must resolve to a page at this path.
- `FormulaEditor` component created in Step 9, importable from `@/components/FormulaEditor`.
- API route `POST /api/formulas` created in Step 7 — this page POSTs to it.
- Confirmed via read of `src/app/strategies/page.tsx`: `useRouter().push(...)` pattern for post-submit navigation.

**Instructions**:
1. Create `services/xstockstrat-insights/src/app/formulas/new/page.tsx` — a `'use client'` form page:
   - Fields: `name` (text input, required), `description` (`<textarea>`), `source` (`FormulaEditor` component, required), `isPublic` (checkbox/toggle, default false).
   - On submit: `POST /api/formulas` with `{ name, description, source, is_public }`. Set `X-User-Id` header to `'dev-user'` (matches the fallback in the API route).
   - On success: navigate to `/formulas/[formulaId]` using `useRouter().push(...)` with the `formulaId` from the response.
   - On error: show an inline error message below the form.
   - "Cancel" button navigates back to `/formulas`.
   - Wrap in `AppShell`.

**Verification**:
```bash
pnpm --filter xstockstrat-insights run lint
```
Expected: no lint errors. Then navigate to `http://localhost:3001/formulas/new` and verify the form renders with the Monaco editor.

---

### Step 11 — test: Add unit tests for FormulasRepository and indicators servicer CRUD methods

**Status**: `pending`
**Service**: `xstockstrat-indicators`
**Files**:
- `services/xstockstrat-indicators/tests/test_formulas.py` — create
- `services/xstockstrat-indicators/pyproject.toml` — modify (add `pytest-asyncio>=0.23.0` to dev deps)

**Reviewers**: `xstockstrat-indicators` owner — formula sandboxing, numeric precision, timeout enforcement (`indicators.sandbox.timeout_ms`), no side-effects from formula execution

**Codebase Evidence**:
- Confirmed via read of `services/xstockstrat-indicators/tests/test_indicators_engine.py`: test file imports from `app.services.indicators_engine` and uses `pytest` with class-based `class TestSMA:` structure. No fixtures requiring gRPC or network — pure unit tests.
- Confirmed via read of `services/xstockstrat-indicators/pyproject.toml` L33–38: `pytest-cov` in dev deps, `testpaths = ["tests"]`, coverage omits `app/handlers/servicer.py` and `app/main.py` (lines 43–48).
- Confirmed via read of coverage omit list: `app/handlers/servicer.py` is omitted from coverage, but `app/services/formulas_repository.py` (new file) is NOT omitted — it will be covered.
- The DB-backed repository cannot be tested without a live DB in unit tests. Use `unittest.mock.AsyncMock` / `MagicMock` to mock the asyncpg pool, matching the approach used for DB tests in similar services.
- Target coverage: 40% overall (from CLAUDE.md CI table), 50% for indicators. New `formulas_repository.py` will boost coverage.

**Instructions**:
1. Create `services/xstockstrat-indicators/tests/test_formulas.py`:

   **Test class `TestFormulasRepository`** — unit tests for `FormulasRepository` using a mock asyncpg pool:
   - `test_create_calls_pool_execute`: mock `db_pool.fetchrow` to return a fake row dict; call `repo.create(...)` and assert the return dict has `formula_id`.
   - `test_get_by_id_returns_none_when_not_found`: mock `db_pool.fetchrow` to return `None`; assert `repo.get_by_id("x")` returns `None`.
   - `test_list_returns_rows_and_total`: mock `db_pool.fetchval` (for COUNT) to return `2` and `db_pool.fetch` to return a list of two fake rows; assert result tuple is `(2_rows_list, 2)`.
   - `test_delete_returns_true_on_success`: mock `db_pool.execute` to return `"DELETE 1"`; assert `repo.delete("x")` returns `True`.
   - `test_delete_returns_false_when_not_found`: mock `db_pool.execute` to return `"DELETE 0"`; assert `repo.delete("x")` returns `False`.

   **Test class `TestIndicatorsServicerCRUD`** — unit tests for the new CRUD methods in `IndicatorsServicer` (no real DB, `db_pool=None` tests the in-memory fallback):
   - `test_list_formulas_empty_when_no_repo`: create `IndicatorsServicer(config_watcher=mock_cfg)` (no db_pool), call `ListFormulas` with empty request; assert response has `total_count == 0`.
   - `test_update_formula_unavailable_when_no_repo`: call `UpdateFormula` when `db_pool=None`; mock context verifies `abort` was called with `UNAVAILABLE`.
   - `test_delete_formula_unavailable_when_no_repo`: call `DeleteFormula` when `db_pool=None`; mock context verifies `abort` was called with `UNAVAILABLE`.

   Use `pytest.mark.asyncio` (add `pytest-asyncio` to dev deps if needed — check via `grep asyncio services/xstockstrat-indicators/pyproject.toml`).

**Note**: Check if `pytest-asyncio` is already in `pyproject.toml`. If not, add `"pytest-asyncio>=0.23.0"` to dev deps. Confirmed it is NOT currently in the file (pyproject.toml L37–38 only lists `pytest>=8.0.0` and `pytest-cov>=5.0.0`).

Update `services/xstockstrat-indicators/pyproject.toml` to add `"pytest-asyncio>=0.23.0"` to `[project.optional-dependencies] dev`.

**Verification**:
```bash
cd services/xstockstrat-indicators && python -m pytest tests/test_formulas.py -v
```
Expected: all tests pass. Then run coverage check:
```bash
python -m pytest --cov=app --cov-fail-under=50 tests/
```
Expected: coverage passes 50% threshold.

---

### Step 12 — docs: Update xstockstrat-indicators CLAUDE.md

**Status**: `pending`
**Service**: `xstockstrat-indicators`
**Files**:
- `services/xstockstrat-indicators/CLAUDE.md` — modify

**Reviewers**: none

**Codebase Evidence**:
- Confirmed via read of `services/xstockstrat-indicators/CLAUDE.md`:
  - Dependencies table ends with `xstockstrat-notify` at line 36 — must add `TimescaleDB`.
  - Environment Variables section at lines 74–83 does not include `DATABASE_URL` — must be added.
  - No "Database" section exists in the file — must be added.

**Instructions**:
1. In the `## Dependencies` table, add a new row after the `xstockstrat-notify` row:
   ```
   | TimescaleDB | asyncpg pool | Persist formula definitions to `indicators.formulas` |
   ```

2. Add a new `## Database` section after `## Dependencies`:
   ```markdown
   ## Database

   - Schema: `indicators`
   - Table: `indicators.formulas` — stores formula definitions, scoped by `author`
   - Migration: `migrations/001_formulas.up.sql`
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

## Deviation Log

_Populated by /sdd-execute as implementation proceeds._
