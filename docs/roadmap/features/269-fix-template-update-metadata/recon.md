# Recon: fix-template-update-metadata

**Created**: 2026-10-21
**From**: product-spec.md
**Affected services**: xstockstrat-indicators, xstockstrat-analysis, xstockstrat-ingest (fix sites); xstockstrat-ui (consumer surface, read-only)

---

## Objective

`ManageTemplate` behaves differently in the three services that own a template catalog. This is debt-radar D-41 plus its RETIRE and empty-id CREATE divergences.
- Indicators (FORMULA) and analysis (STRATEGY) UPDATE persist only the payload. An admin rename "succeeds", bumps `version` and changes nothing.
- Ingest (SIGNAL_SOURCE) RETIRE overwrites `retired_at`.
- Indicators RETIRE skips `updated_at`.
- Ingest CREATE mints a uuid for an empty `template_id`.

The fix aligns all three on the FR-1..FR-5 contract in product-spec.md. It needs no proto, migration or config change.

## Codebase Map

- **`xstockstrat-indicators`** (Python)
  - Handler/servicer: `ManageTemplate`, `app/handlers/servicer.py:622-661`
    - `@owner_scoped`.
    - ADMIN gate at `:625`.
    - Empty-id guard at `:634-636`, before the op dispatch: `INVALID_ARGUMENT "template_id required"`.
    - Payload validated and built at `:637-643`.
    - UPDATE call `:652`: `self._templates_repo.update(meta.template_id, payload)`.
    - RETIRE call `:654`.
    - `row is None` → NOT_FOUND at `:658-660`.
  - Repository: `app/services/formula_templates_repository.py`
    - `create` `:34-48` stores `meta.description or ""` (`:44`).
    - **`update` `:50-62`**: `SET payload = $2::jsonb, version = version + 1, updated_at = NOW() WHERE template_id = $1 AND retired_at IS NULL`. The signature is `update(self, template_id, payload_json)`, which is the **FR-1 gap**.
    - **`retire` `:64-74`**: `SET retired_at = COALESCE(retired_at, NOW())`. It is first-wins, but there is no `updated_at`, which is the **FR-4 gap**.
  - Row→proto: `_row_to_template` `servicer.py:773-786`. It maps `name`, `description`, `version`, `retired`, `created_at` and `updated_at` straight from the row, so it needs no change.
  - Table: `indicators.formula_templates`, `migrations/007_private_formulas_templates.up.sql`. `name TEXT NOT NULL` is at `:40` and `description TEXT NOT NULL DEFAULT ''` at `:41`.
  - Last migration: `007_private_formulas_templates.up.sql`. None is needed.
  - Config-read pattern: n/a (no config key in scope).
- **`xstockstrat-analysis`** (Python)
  - Handler/servicer: `ManageTemplate`, `app/handlers/servicer.py:3533-3590`
    - `@owner_scoped`.
    - ADMIN gate at `:3535`.
    - Empty-id plus kind guard at `:3544-3552`, before the op dispatch.
    - RETIRE at `:3554-3555`.
    - CREATE/UPDATE payload pipeline: `_normalize_source_symbols`, `_strip_dead_signal_params`, `_validate_template_definition`.
    - CREATE catches `UniqueViolationError` → ALREADY_EXISTS (`:3570-3579`).
    - **UPDATE call `:3581`**: `self._strategy_templates_repo.update(meta.template_id, payload_json)`.
    - `row is None` → NOT_FOUND (`:3585-3589`).
  - Repository: `app/repositories/strategy_templates.py`
    - `create` `:38-52` already takes `meta` and writes `name`/`description`.
    - **`update` `:54-66`**: payload, version and `updated_at` only. This is the **FR-1 gap**.
    - `retire` `:68-78`: `SET retired_at = COALESCE(retired_at, NOW()), updated_at = NOW()`. This already meets FR-3 and FR-4.
  - Row→proto: `_row_to_strategy_template` `servicer.py:7138` reads `name` and `description` from the row (digest 2), so it needs no change.
  - Table: `analysis.strategy_templates`, `migrations/026_owner_dimension_templates.up.sql:89-99`, with `name TEXT NOT NULL` and `description TEXT NOT NULL DEFAULT ''`.
  - Last migration: `027_contract_owner_dimension.up.sql`. None is needed.
- **`xstockstrat-ingest`** (Python)
  - Handler/servicer: `ManageTemplate`, `app/handlers/servicer.py:1511-1563`
    - The db gate and ADMIN gate are at `:1513-1519`.
    - There is **no empty-id guard**.
    - RETIRE at `:1522-1523`.
    - UPDATE at `:1532-1535` already passes `meta.name` and `meta.description`.
    - **CREATE `:1540`**: `template_id=meta.template_id or str(uuid.uuid4()),`. This is the **FR-5 gap**.
    - `UniqueViolationError` → ALREADY_EXISTS at `:1546-1551`.
    - `import uuid` at `:11` is also used at `:398` (`job_id`), so the import stays after the fix.
  - Repository: `app/repositories/source_templates.py`. These are module-level functions taking `db_pool`.
    - `update` `:50-64` writes `SET name = $2, description = $3, payload = $4, version = version + 1, updated_at = NOW() ... AND retired_at IS NULL`. This already meets FR-1 and FR-2.
    - **`retire` `:67-75`** writes `SET retired_at = NOW(), updated_at = NOW()`. It is last-wins, which is the **FR-3 gap**.
  - Row→proto: `_template_to_proto` `servicer.py:159-174` maps `name`, `description`, `retired`, `created_at` and `updated_at`, so it needs no change.
  - Table: `ingest.source_templates`, `migrations/013_signal_ownership_templates.up.sql` (`name TEXT NOT NULL` at `:121`).
  - Last migration: `014_contract_signal_ownership.up.sql`. None is needed.
- **`xstockstrat-ui`** (Next.js, consumer only). `src/app/config-ui/templates/page.tsx`:
  - `:153-158` builds `meta` with `templateId: form.templateId.trim()`, `name` and `description`.
  - `:382` picks UPDATE or CREATE from `editing.existing`.
  - `:466` disables the Template ID input while editing.
  - `:479` disables save when `templateId` is empty.
  - The criterion-11 warning in context.md asked for these lines to be re-checked. They are confirmed here, and no UI change is needed.
- **Proto (read-only)**: `packages/proto/common/v1/common.proto`
  - `TemplateOperation` is at `:119-124`; UPDATE carries the comment "bumps version by 1".
  - `TemplateMeta` is at `:126-135`: `name = 3`, `description = 4`, `version = 5`, `retired = 6`, `created_at = 7`, `updated_at = 8`.

## Patterns to REUSE

- **FR-1 (metadata on UPDATE)**: reuse ingest's `update(db_pool, template_id, name, description, payload)` shape (`source_templates.py:50-64`).
  - SQL form: `SET name = $2, description = $3, payload = $4, version = version + 1, updated_at = NOW()`.
  - Keep `AND retired_at IS NULL`.
  - Indicators: change `update` at `formula_templates_repository.py:50-62` and its call at `servicer.py:652`.
  - Analysis: change `update` at `strategy_templates.py:54-66` and its call at `servicer.py:3581`.
  - Both `create`s already take `meta` (`formula_templates_repository.py:34`, `strategy_templates.py:38`), so passing `meta` to `update` matches the sibling method.
- **FR-3 (first-wins RETIRE) for ingest**: reuse analysis's `SET retired_at = COALESCE(retired_at, NOW()), updated_at = NOW()` (`strategy_templates.py:68-78`). Keep the unfiltered `WHERE template_id = $1`.
- **FR-4 (`updated_at` on RETIRE) for indicators**: the same analysis SQL is the template. Add `, updated_at = NOW()` to the `SET` at `formula_templates_repository.py:68`.
- **FR-5 (empty-id CREATE) for ingest**: reuse the indicators guard (`servicer.py:634-636`): `if not meta.template_id: await context.abort(INVALID_ARGUMENT, ...); return`.
  - Place it after the ADMIN gate (`:1517-1519`) so `@AC-13` ordering is preserved.
  - Place it before any `source_templates.create` call, so no row is written.
- **Row→proto mappers**: all three already map `name`, `description` and `updated_at` from the row, so no mapper change is needed. This was checked against the fails.md:536 lockstep rule.
- **Tests**: reuse each suite's existing helpers. Do not add new fixture homes (C-13).
  - Indicators `tests/test_formula_templates.py`:
    - `_FakeTemplates` (`:54`); its `update` at `:83` and `retire` at `:91`.
    - SQL-string tests `test_template_update_bumps_version_in_one_update` (`:535`) and `test_template_retire_stamps_retired_at` (`:545`).
    - Handler test `test_ac14_admin_update_bumps_version_and_bob_lists_it` (`:241`).
  - Analysis `tests/test_strategy_templates.py`:
    - `FakeTemplates` (`:88`); its `update` at `:105` and `retire` at `:112`.
    - `test_manage_template_update_bumps_version_and_retire_hides` (`:344`).
    - SQL-string test `test_template_update_bumps_version_in_one_statement` (`:686`).
  - Ingest `tests/test_source_templates.py`:
    - `_template_row` (`:29`) and `_manage_req`.
    - `patch(f"{_ST}.<fn>")`.
    - `test_admin_update_returns_bumped_version` (`:197`) and `test_admin_retire_marks_retired_and_never_touches_instances` (`:224`).
    - Repo SQL tests at `:427` and `:440`.
  - Run with `uv sync --extra dev && uv run pytest` per service.

## Existing Business Rules (preserve / extend)

- **PRESERVE** `@AC-13` "Only admins can author templates" (`services/xstockstrat-indicators/acceptance/private-by-default-templates.feature`). A non-admin `ManageTemplate` returns PERMISSION_DENIED. The new ingest FR-5 guard must sit after the ADMIN gate, never ahead of it.
- **EXTEND** `@AC-14` "Any user can browse the catalog and updates bump the version" (same suite). UPDATE → version 2, visible in `ListTemplates`. This feature adds `name`/`description` persistence (FR-1) and pins the exactly-1 bump for a metadata-only UPDATE (FR-2). Suppressing the bump would be a CHANGE, and FR-2 rules it out.
- **PRESERVE** `@AC-16` "Instantiation creates an independent private snapshot" (same suite). The instance records the template's current `origin_template_version`. A metadata-only bump raises that number for the next instantiation, which is accepted.
- **PRESERVE** `@AC-17` "Template updates never mutate existing instances" (same suite). UPDATE writes no instance row. A cosmetic rename still raises "update available", which is accepted in FR-2.
- **PRESERVE** `@AC-31` "Retiring a template hides it but leaves instances intact" (same suite). FR-3 and FR-4 change only how `retired_at` and `updated_at` are written.
- **PRESERVE** `@AC-18` "Strategy template instantiation deep-copies referenced formulas" (`docs/sdd/business-rules/platform.feature`). The analysis `update` change must not touch the saga.
- **PRESERVE** `@AC-19` "A failed deep copy leaves nothing behind" (`docs/sdd/business-rules/platform.feature`).
- **PRESERVE** `@AC-15` "Catalog starts empty after migration" (`docs/sdd/business-rules/platform.feature`).
- **PRESERVE** `@AC-32` "Agent docs and strat-lab skill stay in parity with the tool contract" (`docs/sdd/business-rules/platform.feature`). This applies only if agent docs or the skill are touched, and none are expected to be.
- **PRESERVE** `@AC-24` "UI has no public controls and offers templates" (`services/xstockstrat-ui/acceptance/private-by-default-templates.feature`).
- **PRESERVE** `@AC-25` "Agent tools expose templates and drop public arguments" (`services/xstockstrat-agent/acceptance/private-by-default-templates.feature`).
- No existing durable acceptance guarantee covers xstockstrat-ingest `ManageTemplate` UPDATE, RETIRE or CREATE. The ingest suites cover signal sources and signals only.
- No existing durable acceptance guarantee covers xstockstrat-analysis `ManageTemplate` UPDATE, RETIRE or CREATE. Only instantiation is covered (`@AC-18`, `@AC-19`).
- **No CHANGE verdicts.** No promoted `@AC-*` guarantees ingest's uuid minting or its last-wins `retired_at`, so aligning ingest needs no C-16 sign-off.
- **Promotion note.** This feature's `@AC-1`..`@AC-3` share numbers with the feature-224 scenarios in the same suites. Promotion must keep the `@feature-269` tag and must not treat them as duplicates.

## Dependencies

- Proto/RPC: none changed. `ManageTemplate` and `TemplateMeta` (`common.proto:126-135`, `updated_at = 8`) are read-only.
- Migration: none. All three tables already have `name` and `description` columns (indicators `007:40-41`, analysis `026:89-99`, ingest `013:121`). For reference only, the next free numbers are indicators `008`, ingest `015` and analysis `028`. Re-check analysis `028` before use: the analysis CLAUDE.md cites a `028` seed for opportunity keys, but no such file exists under `services/xstockstrat-analysis/migrations/`.
- Config keys: none.
- Inter-service edges: none new. `xstockstrat-ui` reaches the three services over gRPC, and `xstockstrat-agent` (`list_templates` / `instantiate_template`) is read-only for these fields.
- New env vars / ports: none.

## Risks / Not-found

- **Deterministic time for @AC-1/@AC-2** (carried from the review warning). `retired_at` and `updated_at` come from SQL `NOW()`, so the `10:00Z` / `11:00Z` assertions need a design choice. One option is a repo-level SQL-text assertion (the cheap path that exists today). Another is a real-DB test, which only analysis has (`tests/conftest.py` `local_pg`, `tests/test_read_budget_real_pg.py`). Indicators and ingest have no `real_pg` harness.
- **Vacuous-green trap (fails.md:2253, fails.md:2709).** In-memory fakes re-implement the SQL in Python:
  - indicators `_FakeTemplates.update` `:83` and `.retire` `:91`;
  - analysis `FakeTemplates.update` `:105` and `.retire` `:112`. The analysis `retire` sets `retired_at` unconditionally.

  Today's fakes are why the bug passes. Updating a fake to "the fixed semantics" proves nothing about the SQL. Design must decide what actually proves FR-1/FR-3/FR-4:
  - SQL-text assertions plus a fake updated in lockstep, with the runtime gap recorded;
  - a real-PG test in analysis only;
  - or seeding a real-DB fixture, which fails.md:2253 calls a platform follow-up and not a per-feature rig (C-18).

  The fakes must be listed in each step's Files.
- **Tests that will break by design**:
  - indicators `test_template_update_bumps_version_in_one_update` (`:535`, old `update` signature);
  - analysis `test_template_update_bumps_version_in_one_statement` (`:686`, old signature);
  - ingest `test_repo_retire_and_list_active_hide_retired`, whose `:445` asserts `"retired_at = NOW()" in sql` and fails under `COALESCE`.
- **Empty `name` on UPDATE (open design question).** proto3 cannot tell an unset `name` from `""`. Under FR-1, an UPDATE with an empty `name` would write `''` into a `NOT NULL` column. That is legal, but it blanks the template name. Ingest already behaves this way. Design must decide between:
  - full-replace semantics, which matches ingest and the UI, where the UI always sends both fields;
  - rejecting an empty `name` with INVALID_ARGUMENT;
  - keeping the prior value via `COALESCE(NULLIF($2,''), name)`.

  The same question applies to `description`. Indicators `create` normalizes `meta.description or ""` and analysis does not. Both are safe for proto strings.
- **Ingest FR-5 guard scope (design choice).** Indicators and analysis reject an empty id for every op, before dispatch. Ingest's RETIRE and UPDATE with an empty id currently reach SQL and return NOT_FOUND. Design has two options:
  - guard all ops, which matches the siblings but changes ingest's UPDATE/RETIRE code from NOT_FOUND to INVALID_ARGUMENT;
  - guard CREATE only, the minimal change.

  `@AC-3` covers only CREATE.
- **Merge overlap (context.md review).** Two handler files are also edited by other features:
  - indicators `servicer.py` by 244-fix-python-config-stored-zero;
  - analysis `servicer.py` by 244 and 245-fix-screener-symbol-isolation, both implementation-ready.

  There is no `merge-order.md` entry yet. This feature's handler edits are one-line call-site changes (`:652`, `:3581`) plus one guard in ingest, so the conflict surface is small.
- **D-20 family.** There is no shared Python template-repository package, and the three repos are independent. Per C-10, all three surfaces are fixed in this feature. Per the spec's Out of Scope, extraction is excluded. If design chooses extraction, coordinate with 266-fix-db-tls-fail-closed, which carries D-20.
- **Not found / not checked**:
  - the agent `list_templates` / `instantiate_template` tool code, which the spec expects to be unchanged;
  - step bindings between `acceptance.feature` `@AC-*` tags and the service tests (C-15 convention);
  - the body of `analysis _row_to_strategy_template` (`servicer.py:7138`), which was cited by digest 2 and not re-opened here;
  - the defect report `docs/reports/2026-10-21-template-update-metadata-defect.md`, which was not re-read; its content is reflected in product-spec.md.
- **Applicable fails.md traps**: `:536` (mapper lockstep; checked, no mapper change needed), `:2253` (fake-mirrored SQL ships green), `:2709` (list fakes in step Files).

## Recommended Scope

Advisory and not binding. The steps are independent per service, so the order is free:

1. **Indicators**:
   - `update` takes `meta` and persists `name`/`description` (FR-1), with the call site at `servicer.py:652`.
   - `retire` adds `updated_at = NOW()` (FR-4).
   - Update `_FakeTemplates.update`/`.retire` and the `:535`/`:545` SQL tests.
   - Add red-first `@AC-1`/`@AC-2` FORMULA tests.
2. **Analysis**:
   - `update` takes `meta` and persists `name`/`description` (FR-1), with the call site at `servicer.py:3581`.
   - Update `FakeTemplates.update`/`.retire` and the `:686` SQL test.
   - Add red-first `@AC-1` STRATEGY tests. `@AC-2` and `@AC-3` already hold; pin them with tests.
   - A `real_pg` test is optional if design picks it.
3. **Ingest**:
   - `retire` → `COALESCE(retired_at, NOW())` (FR-3).
   - Add the empty-id INVALID_ARGUMENT guard after the ADMIN gate and remove the `uuid.uuid4()` fallback at `:1540` (FR-5). Keep `import uuid` (`:398`).
   - Fix the `:445` assertion.
   - Add red-first `@AC-2`/`@AC-3` SIGNAL_SOURCE tests. `@AC-1` already holds; pin it.
4. **No UI, agent, proto, migration or config step.** At launch, promote `@AC-1..3` (`@feature-269`) into each service's `private-by-default-templates.feature` (C-16).
