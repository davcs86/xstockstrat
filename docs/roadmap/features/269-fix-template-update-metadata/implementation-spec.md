# Implementation Spec: fix-template-update-metadata

**Status**: `pending`
**Created**: 2026-10-22
**Feature**: `docs/roadmap/features/269-fix-template-update-metadata/feature.md`
**Total Steps**: 9
**Feature Branch**: `feature/fix-template-update-metadata`

---

## Execution Summary

The steps follow design.md § Chosen Approach: three independent per-service repairs. Each one is a `service` step
followed by its paired red-before-green `test` step: indicators (Steps 1–2, FR-1/FR-4), analysis (Steps 3–4,
FR-1, including the required real-PG test) and ingest (Steps 5–6, FR-3/FR-5). The service pairs touch disjoint
files, so they can run in any order. Three `docs` steps then carry the design's spec deliverables: a soft
merge-order entry for the 244/245 overlap (Step 7), a durable record of the indicators/ingest real-PG proof gap
in the debt radar (Step 8), and the C-16 promotion rule for the `@AC-1..3` ID collision (Step 9, run at
integration). The `@AC-2` literal-time rewrite (design deliverable) was made in this /sdd-spec session directly in
`acceptance.feature`, so it needs no step.

No proto, migration, config key, env var, port or new service edge is involved (design.md § Chosen Approach;
recon.md § Dependencies). C-03 is not engaged: no step adds an outbound call, emit or new context, and every
handler keeps using its inbound metadata (operator standing trace-id decision 2026-10-21).

**Consumer surfaces (C-14).** The product spec names `/config-ui/templates` (xstockstrat-ui) and the agent
`list_templates` / `instantiate_template` tools. Design decided that both are reached **with no code change**,
and this spec has no UI or agent step:
- The page already sends `templateId`, `name` and `description` on UPDATE
  (`services/xstockstrat-ui/src/app/config-ui/templates/page.tsx:153-158`, re-read this session). It picks
  UPDATE vs CREATE at `:382` and blocks an empty Template ID (`:479`). So the backend fix in Steps 1 and 3 is
  what makes an admin rename take effect there.
- The agent has no ManageTemplate path, and its two tools only read `name`/`description`/`version`.

### Scenario Coverage (C-15)

| Scenario | Service (kind) | Covered by | Evidence kind |
|---|---|---|---|
| `@AC-1` | indicators (FORMULA) | Step 2 | Repo SQL text + bound args (red), handler wiring spy (red) |
| `@AC-1` | analysis (STRATEGY) | Step 4 | Repo SQL text + bound args (red), real-PG runtime (red), handler wiring spy (red) |
| `@AC-1` | ingest (SIGNAL_SOURCE) | Step 6 | Handler wiring pin on name/description args (already holds: regression pin) |
| `@AC-2` | indicators (FORMULA) | Step 2 | Repo SQL text: `COALESCE(retired_at, NOW())` + `updated_at = NOW()` (red on `updated_at`) |
| `@AC-2` | analysis (STRATEGY) | Step 4 | Real-PG runtime regression pin (already holds; not FR-3/FR-4 evidence) |
| `@AC-2` | ingest (SIGNAL_SOURCE) | Step 6 | Repo SQL text: `COALESCE(retired_at, NOW())` (red) |
| `@AC-3` | indicators (FORMULA) | Step 2 | Handler pin (already holds: regression pin) |
| `@AC-3` | analysis (STRATEGY) | Step 4 | Handler pin (already holds: regression pin) |
| `@AC-3` | ingest (SIGNAL_SOURCE) | Step 6 | Handler test: INVALID_ARGUMENT, `create` never called (red) |

Regression pins pass on both the pre- and post-fix tree. Each test step names which of its tests must be red
before the fix; the pins are excluded from the red gate.

## Step Dependencies

- Step 2 [test] covers Step 1 [service] (indicators). Step 1's signature change breaks
  `test_template_update_bumps_version_in_one_update` (`tests/test_formula_templates.py:535`) and the
  `_FakeTemplates.update` contract (`:83`). Step 2 rewrites both, so Steps 1 and 2 land in one commit.
- Step 4 [test] covers Step 3 [service] (analysis). Step 3 breaks `test_template_update_bumps_version_in_one_statement`
  (`tests/test_strategy_templates.py:686`) and `FakeTemplates.update` (`:105`), so Steps 3 and 4 land together.
- Step 6 [test] covers Step 5 [service] (ingest). Step 5 breaks the `"retired_at = NOW()"` assertion in
  `test_repo_retire_and_list_active_hide_retired` (`tests/test_source_templates.py:445`), so Steps 5 and 6 land together.
- Steps 1–2, 3–4 and 5–6 are independent of each other.
- Step 7 has no code dependency. Land it before the integration PR so 244/245 see it.
- Step 8 depends on Steps 2 and 6, because it records their residual gap.
- Step 9 runs at integration, after Steps 1–6 are green (C-16 promotion happens at launch/integration).
- **Merge overlap (soft):** 244-fix-python-config-stored-zero edits `services/xstockstrat-indicators/app/handlers/servicer.py`,
  and 244 plus 245-fix-screener-symbol-isolation edit `services/xstockstrat-analysis/app/handlers/servicer.py`.
  This feature changes one line in each (`:652`, `:3581`). Whichever lands second rebases. Step 7 records this.

---

### Step 1 — service: Indicators — UPDATE persists name/description; RETIRE stamps updated_at

**Status**: `pending`
**Service**: `xstockstrat-indicators`
**Files**:
- `services/xstockstrat-indicators/app/services/formula_templates_repository.py` — modify
- `services/xstockstrat-indicators/app/handlers/servicer.py` — modify

**Reviewers**: `xstockstrat-indicators` owner — Formula sandboxing, numeric precision, no side-effects from formula execution

**Codebase Evidence**:
- `grep -n "def update\|def retire\|def create\|SET " app/services/formula_templates_repository.py`:
  - `:34` `async def create(self, meta, payload_json, created_by)`; it binds `meta.description or ""` at `:44`.
  - `:50` `async def update(self, template_id, payload_json) -> dict | None:`
  - `:55` `SET payload = $2::jsonb, version = version + 1, updated_at = NOW()`, with `WHERE template_id = $1 AND retired_at IS NULL` at `:56`.
  - `:64` `async def retire(self, template_id)`
  - `:68` `SET retired_at = COALESCE(retired_at, NOW())`, with no `updated_at`, and `WHERE template_id = $1` at `:69`.
- `app/handlers/servicer.py:652`: `row = await self._templates_repo.update(meta.template_id, payload)`. The empty-id guard is at `:634-636`, and `payload = MessageToDict(request.template.payload)` is at `:643`.
- `grep -rn "_templates_repo.update" app/` finds only `servicer.py:652`, so there is no other caller.
- Row→proto `_row_to_template` (`servicer.py:773-786`, recon.md) maps `name`, `description` and `updated_at` from the row, so it needs no change.
- Pattern to REUSE (recon.md): ingest `source_templates.update` SQL shape (`services/xstockstrat-ingest/app/repositories/source_templates.py:56-58`): `SET name = $2, description = $3, payload = $4, version = version + 1, updated_at = NOW()`. Also analysis `retire` SQL (`services/xstockstrat-analysis/app/repositories/strategy_templates.py:72`).

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. In `formula_templates_repository.py`, change `update(self, template_id, payload_json)` (`:50`) to
   `update(self, meta, payload_json)`. This matches the sibling `create(self, meta, ...)` at `:34`. Replace the SQL at `:52-58` with:
   ```sql
   UPDATE indicators.formula_templates
      SET name = $2, description = $3, payload = $4::jsonb,
          version = version + 1, updated_at = NOW()
    WHERE template_id = $1 AND retired_at IS NULL
   RETURNING *
   ```
   Bind, in order: `meta.template_id`, `meta.name`, `meta.description or ""` (the same normalization as this class's
   `create` at `:44`), `json.dumps(payload_json)`. Keep the `"""None when the template is missing or retired."""` docstring.
   Use full-replace semantics: an empty `meta.name` is written as `''`. Do not add `COALESCE`/`NULLIF`, which design rejected.
2. In `retire` (`:64-74`), change the `SET` at `:68` to `SET retired_at = COALESCE(retired_at, NOW()), updated_at = NOW()`.
   Leave `WHERE template_id = $1` unfiltered. A second RETIRE must still return the row (FR-3, PRESERVE `@AC-31`).
3. In `servicer.py:652`, change the call to `row = await self._templates_repo.update(meta, payload)`. Change no other line in `ManageTemplate`.

**Verification**:
```bash
cd services/xstockstrat-indicators && grep -n "def update(self, meta, payload_json)\|SET name = \$2, description = \$3\|COALESCE(retired_at, NOW()), updated_at = NOW()" app/services/formula_templates_repository.py
cd services/xstockstrat-indicators && grep -n "_templates_repo.update(meta, payload)" app/handlers/servicer.py
cd services/xstockstrat-indicators && ruff check . && ruff format --check .
```

---

### Step 2 — test: Indicators — red-first repo SQL/bind tests, wiring spy, fake lockstep (@AC-1, @AC-2, @AC-3)

**Status**: `pending`
**Service**: `xstockstrat-indicators`
**Files**:
- `services/xstockstrat-indicators/tests/test_formula_templates.py` — modify. This covers the `_FakeTemplates.update` fake (`:83-89`), the SQL tests at `:535` and `:545`, and the handler test class `TestAuthoring` (`:214`, including `test_ac14_admin_update_bumps_version_and_bob_lists_it` at `:241`).

**Reviewers**: `xstockstrat-indicators` owner — Formula sandboxing, numeric precision, no side-effects from formula execution

**Codebase Evidence**:
- `tests/test_formula_templates.py`:
  - `_FakeTemplates` is at `:54`. Its `update(self, template_id, payload_json)` at `:83-89` sets only payload and version. Its `retire` at `:91-96` is already first-wins.
  - `_servicer()` at `:171-175` wires `svc._templates_repo = _FakeTemplates()`.
  - Helpers: `_admin()` at `:178`, `_user()` at `:182`, `_code(ctx)` at `:190` (it reads `ctx.abort.call_args[0][0]`), `_manage(svc, op, tpl=None)` at `:194`, and `_seed` at `:201`. `_seed` calls UPDATE through the handler, so the fake must take the new signature.
  - `_template(template_id=..., payload=None)` at `:47-51` builds `TemplateMeta(template_id, name="Z-Score", description="z")`.
- `class TestRepositories` is at `:534`:
  - `test_template_update_bumps_version_in_one_update` (`:535-543`) calls `repo.update("tpl-zscore", MessageToDict(_payload()))`, the old signature.
  - `test_template_retire_stamps_retired_at` (`:545-549`) asserts only `"retired_at" in sql`.
  - The pattern is `pool = MagicMock(); pool.fetchrow = AsyncMock(return_value=None)`.
- There is no existing indicators test for empty-`template_id` CREATE. `grep -n "INVALID_ARGUMENT" tests/test_formula_templates.py` → only `:271` (payload validation).
- `pyproject.toml:35` sets `asyncio_mode = "auto"`, so no `@pytest.mark.asyncio` is needed.

**TDD**: `red-green required`. Red before Step 1: tests (a), (b) and (d). Tests (c) and (e) are regression pins.

**Covers**: `AC-1, AC-2, AC-3`

**Instructions**:
1. **Fake lockstep (C-13, fails.md:2709).** Change `_FakeTemplates.update` (`:83`) to `async def update(self, meta, payload_json)`.
   It looks up `meta.template_id`, keeps the missing/retired → `None` rule, and sets `row["name"] = meta.name` and
   `row["description"] = meta.description` alongside payload and version. Leave `_FakeTemplates.retire` unchanged:
   no clock and no extra logic (design proof plan (c); fails.md:2253).
2. **(a) @AC-1 repo SQL + binds (red).** Rewrite `test_template_update_bumps_version_in_one_update` (`:535`) to call
   `repo.update(common_pb2.TemplateMeta(template_id="tpl-zscore", name="New", description="d2"), MessageToDict(_payload()))`. Assert:
   - one `fetchrow`;
   - `"SET name = $2, description = $3, payload = $4::jsonb"` in the SQL;
   - `"version = version + 1"`, `"updated_at = NOW()"` and `"retired_at IS NULL"` are all present;
   - `pool.fetchrow.call_args.args[1:4] == ("tpl-zscore", "New", "d2")` and `json.loads(pool.fetchrow.call_args.args[4]) == MessageToDict(_payload())`. Add `import json`.
3. **(b) Empty-name full-replace bind pin (red).** Add `test_template_update_binds_empty_name_as_full_replace`. It calls
   `repo.update(TemplateMeta(template_id="tpl-zscore", name="", description=""), {...})` and asserts the bound
   `args[2:4] == ("", "")`. This pins the design's deliberate behavior change (design.md § UPDATE semantics).
4. **(c)+(b′) @AC-2 repo SQL (red on `updated_at`).** Rewrite `test_template_retire_stamps_retired_at` (`:545`). Assert:
   - `"retired_at = COALESCE(retired_at, NOW())"` in the SQL (first-wins);
   - `"updated_at = NOW()"` in the SQL (FR-4, red today);
   - `"WHERE template_id = $1"` in the SQL with no `"retired_at IS NULL"` in the WHERE (unfiltered, so a second RETIRE returns the row);
   - `call_args.args[1] == "tpl-zscore"`.
5. **(d) @AC-1 handler wiring spy (red).** In `TestAuthoring`, add `test_ac1_update_passes_meta_and_maps_returned_row`.
   - Seed with `_seed(svc)`.
   - Replace `svc._templates_repo.update` with an `AsyncMock` returning a copy of the seeded row with `name="New"`, `description="d2"`, `version=2`.
   - Call `_manage(svc, TEMPLATE_OPERATION_UPDATE, tpl)`, where `tpl` has `meta` `name="New"`, `description="d2"`.
   - Assert `update.await_args.args[0].name == "New"`, `.description == "d2"` and `.template_id == "tpl-zscore"`.
   - Assert that the response `meta.name == "New"`, `meta.description == "d2"` and `meta.version == 2`.
   - Then call `ListTemplates` as `_user("bob")` after restoring the fake. With the lockstep fake, run a real UPDATE
     and assert the listed `(name, description, version) == ("New", "d2", 2)`.
6. **(e) @AC-3 FORMULA pin (regression pin, green on both trees).** Add `test_ac3_create_with_empty_template_id_is_invalid_argument`.
   It calls `_manage`-style CREATE with `_template(template_id="")` under `_admin()`. Assert:
   - `pytest.raises(grpc.RpcError)`;
   - `_code(ctx) == grpc.StatusCode.INVALID_ARGUMENT`;
   - `svc._templates_repo.rows == {}`.
7. Keep `test_ac14_admin_update_bumps_version_and_bob_lists_it` (`:241`) passing unchanged. It reaches the fake through the handler.
8. C-13 verdict: the new `TemplateMeta` literals are scenario one-offs inside one test file (single consumer), so they stay inline. No conftest change.

**Verification**:
```bash
cd services/xstockstrat-indicators && uv sync --extra dev && uv run pytest tests/test_formula_templates.py -q
cd services/xstockstrat-indicators && uv run pytest --cov=app --cov-fail-under=50
cd services/xstockstrat-indicators && ruff check . && ruff format --check .
cd services/xstockstrat-indicators && grep -n "def .*fixture\|from tests.conftest\|conftest" tests/test_formula_templates.py
```
Red gate: on the pre-Step-1 tree, tests (a), (b), the `updated_at` assertion in (c), and (d) fail. (e) passes on both trees.

---

### Step 3 — service: Analysis — UPDATE persists name/description

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/app/repositories/strategy_templates.py` — modify
- `services/xstockstrat-analysis/app/handlers/servicer.py` — modify

**Reviewers**: `xstockstrat-analysis` owner — Backtest reproducibility, strategy scoring determinism, no look-ahead bias

**Codebase Evidence**:
- `app/repositories/strategy_templates.py`:
  - `:38` `async def create(self, meta, payload_json: dict, created_by: str)` binds `meta.description` raw at `:48`.
  - `:54` `async def update(self, template_id: str, payload_json: dict) -> dict | None:`, with docstring `:55` and SQL `:59` `SET payload = $2::jsonb, version = version + 1, updated_at = NOW()` / `:60` `WHERE template_id = $1 AND retired_at IS NULL`.
  - `retire` `:68-78`: `:72` `SET retired_at = COALESCE(retired_at, NOW()), updated_at = NOW()`. It already meets FR-3/FR-4, so it does not change.
- `app/handlers/servicer.py:3581`: `row = await self._strategy_templates_repo.update(meta.template_id, payload_json)`. `meta = request.template.meta` is at `:3542`, and the empty-id/kind guard is at `:3543-3552`.
- `_row_to_strategy_template` (`servicer.py:7138-7150`) reads `name`, `description` and `updated_at` from the row (re-read this session), so it needs no change.
- Pattern to REUSE: ingest `source_templates.update` SQL (`source_templates.py:56-58`).

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. In `strategy_templates.py`, change `update(self, template_id: str, payload_json: dict)` (`:54`) to
   `update(self, meta, payload_json: dict)`. Replace the SQL at `:57-62` with:
   ```sql
   UPDATE analysis.strategy_templates
      SET name = $2, description = $3, payload = $4::jsonb,
          version = version + 1, updated_at = NOW()
    WHERE template_id = $1 AND retired_at IS NULL
   RETURNING *
   ```
   Bind `meta.template_id`, `meta.name`, `meta.description` (**raw**, as this class's `create` does at `:48`; do not copy
   indicators' `or ""`), and `json.dumps(payload_json)`. Update the docstring to "Replace name, description and payload and bump
   ``version`` in one UPDATE; None if missing or retired." Use full-replace semantics, with no `COALESCE`/`NULLIF`.
2. Leave `retire` (`:68-78`) untouched.
3. In `servicer.py:3581`, change the call to `row = await self._strategy_templates_repo.update(meta, payload_json)`. Change no other line in `ManageTemplate`.

**Verification**:
```bash
cd services/xstockstrat-analysis && grep -n "def update(self, meta, payload_json\|SET name = \$2, description = \$3" app/repositories/strategy_templates.py
cd services/xstockstrat-analysis && grep -n "_strategy_templates_repo.update(meta, payload_json)" app/handlers/servicer.py
cd services/xstockstrat-analysis && ruff check . && ruff format --check .
```

---

### Step 4 — test: Analysis — red-first repo SQL/bind tests, required real-PG test, wiring spy, fake lockstep (@AC-1, @AC-2, @AC-3)

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/tests/test_strategy_templates.py` — modify. This covers `FakeTemplates.create` (`:99-103`), `.update` (`:105-110`), `.retire` (`:112-116`, listed but not changed), the SQL test at `:686`, and the handler tests near `:344`.
- `services/xstockstrat-analysis/tests/test_strategy_templates_real_pg.py` — create

**Reviewers**: `xstockstrat-analysis` owner — Backtest reproducibility, strategy scoring determinism, no look-ahead bias

**Codebase Evidence**:
- `tests/test_strategy_templates.py`:
  - `FakeTemplates` is at `:88`. Its `create` (`:99-103`) does `row = _tpl_row(meta.template_id); row.update(name=meta.name, payload=payload_json, created_by=created_by)`, which drops `description`.
  - `update(self, template_id, payload_json)` is at `:105-110`.
  - `retire` (`:112-116`) sets `retired_at = _T0` unconditionally.
  - `_tpl_row` is at `:55-68`, and its `description` is `""`.
  - `_svc(templates=...)` is at `:211-217`.
  - `_manage(svc, payload, op=..., template_id="tpl-new")` is at `:285-296`. It builds `TemplateMeta(template_id=template_id, name="New")` and returns `(None, ctx)` on abort.
  - `_aborted_with(ctx, code)` is at `:229-231`.
  - `test_manage_template_update_bumps_version_and_retire_hides` is at `:344-358`.
  - `test_template_update_bumps_version_in_one_statement` (`:686-692`) calls the old `update("tpl", {...})` and uses `pool = AsyncMock(); pool.fetchrow = AsyncMock(return_value=None)`.
- Real-PG harness:
  - The `tests/conftest.py:367-368` session fixture `local_pg` yields a DSN. It skips locally when no PG binaries exist, and fails under `CI=true` (`:370-375`).
  - `.github/workflows/ci.yml:393-397` installs postgresql for the analysis matrix leg.
  - `tests/test_read_budget_real_pg.py:20` uses `pytestmark = pytest.mark.real_pg`, and `:25-28` uses `_pool(dsn, size, **kw)` → `asyncpg.create_pool(dsn, min_size=size, max_size=size, statement_cache_size=0, ...)`.
  - The marker is registered at `pyproject.toml:33`.
- `migrations/026_owner_dimension_templates.up.sql:89` reads `CREATE TABLE IF NOT EXISTS analysis.strategy_templates (`, and the statement closes with `);` at `:99`. `DEFAULT NOW()` appears at `:97-98`.
- `grep -l strategy_templates migrations/*.up.sql` → only `026_owner_dimension_templates.up.sql` (verified this session).
- `local_pg` is session-scoped and shared with `test_read_budget_real_pg.py`, which never touches `analysis.strategy_templates`. Use distinct `template_id`s per test.

**TDD**: `red-green required`. Red before Step 3: tests (a), (b), (c) and the UPDATE legs of (f). Tests (d), (e) and the RETIRE leg of (f) are regression pins.

**Covers**: `AC-1, AC-2, AC-3`

**Instructions**:
1. **Fake lockstep (fails.md:2709).**
   - `FakeTemplates.create` (`:99-103`) also sets `description=meta.description`.
   - `FakeTemplates.update` (`:105`) becomes `async def update(self, meta, payload_json)`. It looks up `meta.template_id` and sets `name=meta.name` and `description=meta.description` with the payload and version bump.
   - Leave `.retire` (`:112-116`) unchanged: no clock and no first-wins logic (fails.md:2253).
2. **(a) @AC-1 repo SQL + binds (red).** Rewrite `test_template_update_bumps_version_in_one_statement` (`:686`) to call
   `StrategyTemplatesRepository(pool).update(common_pb2.TemplateMeta(template_id="tpl", name="New", description="d2"), {"strategy_id": "x"})`. Assert:
   - one await;
   - `"SET name = $2, description = $3, payload = $4::jsonb"` in the SQL;
   - `"version = version + 1"`, `"updated_at = NOW()"` and `"retired_at IS NULL"`;
   - `await_args.args[1:4] == ("tpl", "New", "d2")` and `json.loads(await_args.args[4]) == {"strategy_id": "x"}`.
3. **(b) Empty-name full-replace bind pin (red).** Add `test_template_update_binds_empty_name_as_full_replace`. It passes a
   `TemplateMeta(template_id="tpl", name="", description="")` and asserts `args[2:4] == ("", "")`.
4. **(c) @AC-1 handler wiring spy (red).** Add `test_ac1_manage_template_update_passes_meta_and_maps_row`.
   - Build `templates = FakeTemplates(_tpl_row())` and replace `templates.update` with an `AsyncMock` returning `{**_tpl_row(), "name": "New", "description": "d2", "version": 2}`.
   - Call `ManageTemplate` UPDATE on `template_id="tpl-meanrev"`. The `_manage` helper hard-codes `name="New"`; extend it with an optional `description=""` keyword so the test can pass `"d2"`. This is a scenario one-off, inline.
   - Assert `ctx.abort.assert_not_awaited()`, `update.await_args.args[0].name == "New"`, `.description == "d2"` and `.template_id == "tpl-meanrev"`.
   - Assert that the response `meta.name == "New"`, `meta.description == "d2"` and `meta.version == 2`.
   - Then, with the lockstep fake, run a real UPDATE and assert that `ListTemplates` returns `name == "New"` and `description == "d2"`.
5. **(d) @AC-3 STRATEGY pin (regression pin).** Add `test_ac3_create_with_empty_template_id_is_invalid_argument`. It calls `_manage(svc, _payload(), template_id="")`. Assert:
   - `_aborted_with(ctx, grpc.StatusCode.INVALID_ARGUMENT)`;
   - the fake's `rows` holds only the seeded `tpl-meanrev`.
6. Keep `test_manage_template_update_bumps_version_and_retire_hides` (`:344`) passing unchanged.
7. **(f) Required real-PG test.** Create `tests/test_strategy_templates_real_pg.py` with the module docstring
   `"""StrategyTemplatesRepository against a real PostgreSQL (``local_pg``): feature 269 AC-1, AC-2."""` and
   `pytestmark = pytest.mark.real_pg`. Reuse `local_pg` and the `_pool` shape from `test_read_budget_real_pg.py:25-28`.
   Inline a local `_pool` (single consumer; C-13), or import it from `tests.test_read_budget_real_pg`, the same
   cross-test-module import style as `tests/test_strategy_templates.py:28`.
   - **Schema.** On a pool connection, run `CREATE SCHEMA IF NOT EXISTS analysis`. Then run the DDL extracted from
     `migrations/026_owner_dimension_templates.up.sql` with a regex anchored on
     `CREATE TABLE IF NOT EXISTS analysis\.strategy_templates \(` that ends at the **first `\n);`**
     (`re.S`, non-greedy up to `\n\);`). Never end at a lazy `\)`, because `DEFAULT NOW()` sits at `:97-98`.
     - Assert the match is not `None`.
     - Assert that no other `migrations/*.up.sql` contains `strategy_templates`
       (`[p.name for p in Path(...).glob("*.up.sql") if "strategy_templates" in p.read_text()] == ["026_owner_dimension_templates.up.sql"]`).
       This makes a later ALTER fail loudly instead of drifting silently.
   - **Autocommit per call.** Every repo call goes through `StrategyTemplatesRepository(pool)` as its own pool statement.
     Never wrap the calls in one `conn.transaction()`, because `NOW()` is the transaction start time and would make the timestamps equal.
   - **Legs** (use distinct ids per leg, e.g. `rpg-update`, `rpg-retired`, `rpg-retire`):
     1. **@AC-1 runtime (red).** `create(TemplateMeta(template_id="rpg-update", name="Old", description="d1"), {"strategy_id": "a"}, "admin-1")`,
        then `update(TemplateMeta(template_id="rpg-update", name="New", description="d2"), {"strategy_id": "b"})`.
        Assert the returned row has `name == "New"`, `description == "d2"`, `version == 2` and `payload` decoding to
        `{"strategy_id": "b"}`. Distinct name, description and payload values prove the bind order. Assert the same on a fresh `get("rpg-update")`.
     2. **UPDATE of a retired row.** Create, then `retire`, then `update` on `rpg-retired`. Assert the update returns `None`.
     3. **@AC-2 runtime (regression pin for analysis, not FR-3/FR-4 evidence).** Create `rpg-retire`, then `first = await repo.retire(...)`,
        then `await pool.execute("SELECT pg_sleep(0.01)")`, then `second = await repo.retire(...)`. Assert:
        - `second is not None` and `second["retired_at"] == first["retired_at"]`;
        - `second["updated_at"] > first["updated_at"]` and `second["updated_at"] > second["retired_at"]`, strict `>` only (fails.md:3037);
        - no wall-clock literals.
   - Close the pool in a `finally`.

**Verification**:
```bash
cd services/xstockstrat-analysis && uv sync --extra dev && uv run pytest tests/test_strategy_templates.py tests/test_strategy_templates_real_pg.py -q
cd services/xstockstrat-analysis && CI=true uv run pytest tests/test_strategy_templates_real_pg.py -q   # must run, not skip (needs PG binaries)
cd services/xstockstrat-analysis && uv run pytest --cov=app --cov-fail-under=40
cd services/xstockstrat-analysis && ruff check . && ruff format --check .
cd services/xstockstrat-analysis && grep -n "def .*fixture\|from tests\.\|conftest" tests/test_strategy_templates_real_pg.py
```
Red gate: on the pre-Step-3 tree, (a), (b), (c) and the (f) UPDATE leg fail. (d), (f) leg 2 and (f) leg 3 pass on both trees.
If PG binaries are absent locally, the real-PG file skips. Record the skip in the step's TDD evidence, and leave the
real-PG red proof to CI (`CI=true` fails rather than skips).

---

### Step 5 — service: Ingest — RETIRE first-wins; CREATE rejects an empty template_id

**Status**: `pending`
**Service**: `xstockstrat-ingest`
**Files**:
- `services/xstockstrat-ingest/app/repositories/source_templates.py` — modify
- `services/xstockstrat-ingest/app/handlers/servicer.py` — modify

**Reviewers**: `xstockstrat-ingest` owner — Signal normalization correctness, idempotent ingestion, newsletter source schema stability

**Codebase Evidence**:
- `app/repositories/source_templates.py`:
  - `update` (`:50-64`) already writes `SET name = $2, description = $3, payload = $4, version = version + 1, updated_at = NOW()` (`:56-57`) `... AND retired_at IS NULL` (`:58`), so it does not change.
  - `retire` (`:67-75`): `:71` `" SET retired_at = NOW(), updated_at = NOW()"` and `:72` `f" WHERE template_id = $1 RETURNING {_COLS}"`.
- `app/handlers/servicer.py` `ManageTemplate`:
  - `:1512` `async def ManageTemplate`.
  - db gate at `:1513-1515` (`if self._db is None:` → UNAVAILABLE).
  - `owner = self._owner(context)` at `:1516`.
  - ADMIN gate at `:1517-1519`.
  - `op = request.operation` at `:1520`, and `meta = request.template.meta` at `:1521`.
  - RETIRE branch at `:1522-1523`.
  - `validate_config_json(...)` at `:1527`.
  - `template_id=meta.template_id or str(uuid.uuid4()),` at `:1540`.
- `grep -n "^import uuid\|uuid\.uuid4" app/handlers/servicer.py` → `:11`, `:398` (`job_id = str(uuid.uuid4())`) and `:1540`. `import uuid` stays.
- Patterns to REUSE:
  - the guard from indicators `servicer.py:634-636` (`if not meta.template_id: await context.abort(grpc.StatusCode.INVALID_ARGUMENT, "template_id required"); return`);
  - the first-wins SQL from analysis `strategy_templates.py:72`.

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. In `source_templates.py` `retire`, change `:71` to `" SET retired_at = COALESCE(retired_at, NOW()), updated_at = NOW()"`.
   Keep `:72` (`WHERE template_id = $1`) unfiltered. Update the docstring at `:68` to "Hide the template from the catalog
   (first RETIRE wins ``retired_at``); instances are never touched. None if missing."
2. In `servicer.py` `ManageTemplate`, insert a **CREATE-only** guard directly after `meta = request.template.meta` (`:1521`) and before
   the `if op == common_pb2.TEMPLATE_OPERATION_RETIRE:` branch (`:1522`):
   ```python
   if op == common_pb2.TEMPLATE_OPERATION_CREATE and not meta.template_id:
       await context.abort(grpc.StatusCode.INVALID_ARGUMENT, "template_id required")
       return
   ```
   Required order: after the db gate (`:1513-1515`), after the ADMIN gate (`:1517-1519`, PRESERVE `@AC-13`), after `meta =` (`:1521`),
   and before `validate_config_json` (`:1527`). An empty-id CREATE with a bad payload therefore returns the id error.
   UPDATE and RETIRE with an empty id keep reaching SQL and returning NOT_FOUND (design rejected the all-ops guard).
3. At `:1540`, change `template_id=meta.template_id or str(uuid.uuid4()),` to `template_id=meta.template_id,`. Do not remove
   `import uuid` (`:11`), which `:398` still uses.

**Verification**:
```bash
cd services/xstockstrat-ingest && grep -n "COALESCE(retired_at, NOW()), updated_at = NOW()" app/repositories/source_templates.py
cd services/xstockstrat-ingest && grep -n "TEMPLATE_OPERATION_CREATE and not meta.template_id" app/handlers/servicer.py
cd services/xstockstrat-ingest && grep -c "uuid.uuid4" app/handlers/servicer.py   # expect 1 (job_id only)
cd services/xstockstrat-ingest && ruff check . && ruff format --check .
```

---

### Step 6 — test: Ingest — red-first RETIRE SQL test, empty-id CREATE tests, UPDATE wiring pin (@AC-1, @AC-2, @AC-3)

**Status**: `pending`
**Service**: `xstockstrat-ingest`
**Files**:
- `services/xstockstrat-ingest/tests/test_source_templates.py` — modify. This covers `test_repo_retire_and_list_active_hide_retired` (`:440-448`, whose assertion at `:445` is rewritten) and `test_admin_update_returns_bumped_version` (`:197-207`), and adds the new @AC-2/@AC-3 tests.

**Reviewers**: `xstockstrat-ingest` owner — Signal normalization correctness, idempotent ingestion, newsletter source schema stability

**Codebase Evidence**:
- `tests/test_source_templates.py`:
  - `_ST = "app.repositories.source_templates"` at `:23`.
  - `_template_row(...)` at `:29`.
  - `_template_msg(source_type="derived", cfg=None, **payload_over)` at `:63-77` builds `TemplateMeta(template_id="t1", name="Example feed")`.
  - `_manage_req(op, template=None)` at `:80-81`.
  - `_ctx` and `_aborted_code` are imported at `:17`/`:20`.
  - The pattern is `with patch(f"{_ST}.create", create):` (`:157`).
  - `test_ac13_non_admin_manage_template_permission_denied` (`:126-139`) patches all three writes and asserts none was called.
  - `test_admin_create_validates_payload_like_register` is at `:163`.
  - `test_admin_update_returns_bumped_version` (`:197-207`) asserts only `update.call_args.args[1] == "t1"`.
  - `test_repo_update_bumps_version_in_one_statement` (`:427-437`) already asserts the UPDATE SQL.
  - `test_repo_retire_and_list_active_hide_retired` (`:440-448`) has `:445` `assert "retired_at = NOW()" in db.fetchrow.call_args.args[0]`. That assertion fails under `COALESCE`.
- `pyproject.toml:33` sets `asyncio_mode = "auto"`. The file still uses explicit `@pytest.mark.asyncio`; follow the file's style.

**TDD**: `red-green required`. Red before Step 5: tests (a), (b) and (c). Test (d) is a regression pin (`@AC-1` already holds in ingest), and (e) is an `@AC-13` ordering pin.

**Covers**: `AC-1, AC-2, AC-3`

**Instructions**:
1. **(a) @AC-2 repo SQL (red).** In `test_repo_retire_and_list_active_hide_retired`, replace the `:445` assertion. Assert:
   - `"retired_at = COALESCE(retired_at, NOW())"` and `"updated_at = NOW()"` in the SQL;
   - `"retired_at IS NULL" not in` the retire SQL (unfiltered WHERE, so a second RETIRE returns the row);
   - `db.fetchrow.call_args.args[1] == "t1"`.

   Keep the `list_active` assertions.
2. **(b) @AC-3 empty-id CREATE (red).** Add `test_admin_create_with_empty_template_id_invalid_argument`.
   - Build a request with `_template_msg()` whose `meta.template_id` is set to `""` (copy, then set the field).
   - Patch `f"{_ST}.create"` with an `AsyncMock`.
   - Assert that `_aborted_code(...)` under `_ctx("4", user_id="admin1")` is `grpc.StatusCode.INVALID_ARGUMENT` and that `create.assert_not_called()` holds (no row written).
3. **(c) Guard precedes payload validation (red).** Add `test_admin_create_empty_id_with_bad_payload_reports_id_error`.
   - Use `_template_msg(source_type="mcp_client")` with no config (invalid per `test_admin_create_validates_payload_like_register`'s pattern at `:163`) and an empty `template_id`.
   - Assert INVALID_ARGUMENT, and that the abort message `ctx.abort.call_args[0][1]` (the `_aborted_code` helper at `tests/test_signal_ownership.py:95-98` reads `call_args[0][0]`) contains `"template_id required"`.
4. **(d) @AC-1 SIGNAL_SOURCE wiring pin (regression pin).** Extend `test_admin_update_returns_bumped_version` (`:197`). Send a template whose
   meta has `name="New"`, `description="d2"`, and assert `update.call_args.args[1:4] == ("t1", "New", "d2")`. Return
   `{**_template_row(version=2), "name": "New", "description": "d2"}` from the mock and assert that the response
   `meta.name == "New"`, `meta.description == "d2"` and `meta.version == 2`.
5. **(e) @AC-13 ordering pin.** Add `test_non_admin_empty_id_create_is_permission_denied`. It sends a non-admin
   (`_ctx("0", user_id="bob")`) CREATE with an empty `template_id` and asserts PERMISSION_DENIED, not INVALID_ARGUMENT.
   This proves the new guard sits after the ADMIN gate.
6. C-13 verdict: the empty-id and renamed `TemplateMeta` values are scenario one-offs built from the existing `_template_msg`
   helper (single consumer), so they stay inline. No conftest change.

**Verification**:
```bash
cd services/xstockstrat-ingest && uv sync --extra dev && uv run pytest tests/test_source_templates.py -q
cd services/xstockstrat-ingest && uv run pytest --cov=app --cov-fail-under=40
cd services/xstockstrat-ingest && ruff check . && ruff format --check .
cd services/xstockstrat-ingest && grep -n "def .*fixture\|from tests.conftest\|conftest" tests/test_source_templates.py
```
Red gate: on the pre-Step-5 tree, (a), (b) and (c) fail. (d) and (e) pass on both trees.

---

### Step 7 — docs: merge-order.md soft-overlap entry for 244/245

**Status**: `pending`
**Service**: `docs/roadmap/features/`
**Files**:
- `docs/roadmap/features/merge-order.md` — modify

**Reviewers**: none

**Codebase Evidence**:
- `docs/roadmap/features/merge-order.md` § Blocking Dependencies is a table with the columns `| Feature | Must wait for | Reason | Resolved |`.
- The coverage note (`:15-19`) says ordinary textual overlap is "intentionally **not** listed". There is precedent for a soft/rebase entry at
  `:55` (`shadcn-migration-medium-confidence` (121) → (120), "soft/rebase (not blocking)").
- `grep -n "244\|245\|269" docs/roadmap/features/merge-order.md` → no entry for these features (verified this session).
- Overlap source: context.md 2026-10-21 sdd-review overlap findings, and recon.md § Risks "Merge overlap".

**TDD**: `N/A (docs)`

**Covers**: —

**Instructions**:
Append one row to the § Blocking Dependencies table, following the `:55` soft-entry form:
`| \`fix-template-update-metadata\` (269) | \`fix-python-config-stored-zero\` (244), \`fix-screener-symbol-isolation\` (245) | **File-level overlap, soft/rebase (not blocking)**: 269 changes one call-site line in \`services/xstockstrat-indicators/app/handlers/servicer.py\` (\`ManageTemplate\` UPDATE, ~L652) and \`services/xstockstrat-analysis/app/handlers/servicer.py\` (\`ManageTemplate\` UPDATE, ~L3581); 244 edits both files and 245 edits the analysis one. No field, config, or migration collision; whichever lands second rebases. | No |`
This is a design deliverable (design.md § Spec deliverables; Open Risk 4).

**Verification**:
```bash
grep -n "fix-template-update-metadata" docs/roadmap/features/merge-order.md
```

---

### Step 8 — docs: Durable record of the indicators/ingest real-PG proof gap (debt radar D-41)

**Status**: `pending`
**Service**: `docs/repo-surveyor/`
**Files**:
- `docs/repo-surveyor/debt-radar-findings.md` — modify

**Reviewers**: none

**Codebase Evidence**:
- `docs/repo-surveyor/debt-radar-findings.md:407`: `### D-41 Template \`ManageTemplate\` UPDATE silently drops \`name\`/\`description\` (indicators + analysis) — SEV-2`. Its bullets are **Evidence** / **Intent asserted** / **Impact** / **Routing** (`:408-416`).
- The design accepted the residual (design.md § Open Risks, item 1; Rejected Alternatives: "Copying `local_pg` into the indicators and ingest conftests"). fails.md:2255 rule (3) names a shared real-DB fixture as a platform follow-up, not a per-feature rig.
- Indicators and ingest have no `local_pg`/`real_pg` harness: `grep -rn "real_pg\|local_pg" services/xstockstrat-indicators/tests services/xstockstrat-ingest/tests` → none (recon.md § Risks). Only analysis has one (`tests/conftest.py:367-368`).
- The debt radar was chosen over `docs/context-constitution-findings.md` because it is the D-41 finding's own home. It is also not a context-forge context file, so it does not trigger the root CLAUDE.md teardown.

**TDD**: `N/A (docs)`

**Covers**: —

**Instructions**:
Under the D-41 entry, append one bullet after **Routing**:
`- **Status (feature 269):** fixed in indicators, analysis and ingest. **Residual proof gap (accepted, follow-up):** indicators (\`formula_templates_repository.py\`) and ingest (\`source_templates.py\`) template SQL is proven only by SQL-text plus bound-argument tests, because neither service has a real-PG harness; only analysis does (\`tests/conftest.py\` \`local_pg\`, \`tests/test_strategy_templates_real_pg.py\`). A column or bind-order mistake mirrored in both a query and its assertion would pass. Follow-up: a shared Python real-PG test fixture (platform, D-20 family; fails.md:2255 rule 3), not a per-service copy.`
Do not edit any other finding.

**Verification**:
```bash
grep -n "Residual proof gap (accepted, follow-up)" docs/repo-surveyor/debt-radar-findings.md
```

---

### Step 9 — docs: Promote @AC-1..3 into per-service durable suites (C-16) at integration

**Status**: `pending`
**Service**: `services/xstockstrat-{indicators,analysis,ingest}/acceptance/`
**Files**:
- `services/xstockstrat-indicators/acceptance/fix-template-update-metadata.feature` — create
- `services/xstockstrat-analysis/acceptance/fix-template-update-metadata.feature` — create
- `services/xstockstrat-ingest/acceptance/fix-template-update-metadata.feature` — create

**Reviewers**: none

**Codebase Evidence**:
- The ID collision: `services/xstockstrat-indicators/acceptance/private-by-default-templates.feature:9,16,22` already holds `@AC-1`/`@AC-2`/`@AC-3` tagged `@feature-224`, and the analysis and ingest `private-by-default-templates.feature` suites exist (recon.md § Existing Business Rules, promotion note).
- Precedent for fix features: they promote into a per-feature suite named after the slug, with a provenance header and an `@feature-NNN` tag on every scenario. Examples are `services/xstockstrat-indicators/acceptance/fix-python-config-zero-trap.feature:1-2` ("Promoted from docs/roadmap/features/173-fix-python-config-zero-trap/acceptance.feature at integration … `@feature-173` tag") and `:12` (`@AC-4 @FR-2 @FR-3 @regression @feature-173`).
- `docs/sdd/business-rules/CLAUDE.md:39-40`: "On promotion, prefix a promoted scenario's tags with its source so provenance survives".
- `ls services/xstockstrat-{indicators,analysis,ingest}/acceptance/ | grep fix-template` → none today.

**TDD**: `N/A (docs — acceptance promotion)`

**Covers**: —

**Instructions**:
**Promotion rule (named, C-16):** keep the `@feature-269` provenance tag and treat the **(feature, AC) pair** as the scenario's
identity, never the bare `@AC-N`. Do **not** renumber, because C-15 makes `@AC-*` append-only per feature. Do **not** merge into
`private-by-default-templates.feature`, where the feature-224 `@AC-1..3` live. Promote into a new per-service
`fix-template-update-metadata.feature` instead, following the feature-173 precedent.
1. At integration, after Steps 1–6 are green and as part of `/sdd-execute`'s integration PR via the `scenario-promoter` subagent, create the three
   files above. Each starts with the header `# Promoted from docs/roadmap/features/269-fix-template-update-metadata/acceptance.feature at integration`
   / `# (Constitution C-16). Source-feature provenance is carried on every scenario's \`@feature-269\` tag.`
2. Copy `@AC-1`, `@AC-2` (the relative-time text) and `@AC-3` into each file. Keep only that service's `Examples:` row, and append
   `@feature-269` to every scenario's tag line (e.g. `@AC-1 @FR-1 @FR-2 @regression @feature-269`).
3. Leave `private-by-default-templates.feature` untouched in all three services. Its `@AC-14` is EXTENDed in behavior by this
   feature (UPDATE now also writes name/description), and the EXTEND is carried by the new suite's `@AC-1`.

**Verification**:
```bash
grep -c "@feature-269" services/xstockstrat-indicators/acceptance/fix-template-update-metadata.feature services/xstockstrat-analysis/acceptance/fix-template-update-metadata.feature services/xstockstrat-ingest/acceptance/fix-template-update-metadata.feature   # expect 3 each
git diff --stat -- 'services/*/acceptance/private-by-default-templates.feature'   # expect empty
```

---

## Deviation Log

_Populated by /sdd-execute as implementation proceeds._
