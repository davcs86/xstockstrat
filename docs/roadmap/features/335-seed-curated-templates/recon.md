# Recon: seed-curated-templates

**Created**: 2026-11-12
**From**: product-spec.md
**Tree**: ccr-4bdb931f-mr7ofl@6c940a8 (= origin/main-dev@cee3bae + 2 docs-only commits; 0 behind origin/main-dev)
**Affected services**: xstockstrat-indicators, xstockstrat-analysis, xstockstrat-ingest (+ repo `scripts/` migration tooling; consumer surfaces xstockstrat-agent / xstockstrat-ui unchanged)

---

## Objective

Seed the feature-224 template catalog by data-only migration: 9 formula templates, 14 strategy templates
and 4 source templates taken from the operator's staging instances (read 2026-11-12), all
`created_by='system'`, `template_id='tpl-<slug>'`; insert the system `fundamentals` signal source if
absent; and prove template-vs-staging parity against a committed snapshot.

## Codebase Map

- **`xstockstrat-indicators`** (Python)
  - Template repo: `services/xstockstrat-indicators/app/services/formula_templates_repository.py:21` (`list_active`), `:34` (`create`, `$4::jsonb` of `json.dumps(payload)`), `:50` (`update`), `:67` (`retire`)
  - Servicer: `app/handlers/servicer.py:688` `ManageTemplate`; `:708` `payload = MessageToDict(request.template.payload)` (default options → **camelCase keys, enum NAME strings, defaults omitted**); `:823` `_validate_register_payload`; `:835` `_template_copy`; `:852` `_row_to_template` — both read with `ParseDict(row["payload"], RegisterFormulaRequest())` and **no `ignore_unknown_fields`** (an unknown key raises `ParseError` and breaks `ListTemplates`)
  - Payload type: `FormulaTemplate.payload = RegisterFormulaRequest` — `packages/proto/indicators/v1/indicators.proto:274`, `:197` (`name=1 description=2 source=3 input_schema=5 parameters=7 outputs=8 warmup_period=9 fundamental_inputs=10`; `is_public=4`/`author=6` deprecated)
  - System formula: `app/formulas/__init__.py:5` `SYSTEM_AUTHOR`; `app/formulas/fundamentals_value_quality.py:22` `FORMULA_ID`, `:26` `NAME`, `:28` `DESCRIPTION`, `:65` `PARAMETERS`, `:67` `OUTPUTS`, `:76` `FUNDAMENTAL_INPUTS`, `:90` `SOURCE`; startup upsert `app/services/seed_formulas.py:21`
  - Last migration: `007_private_formulas_templates.up.sql` (DDL `:38-48`, "No seed rows (AC-15)" `:50`)
  - Tests: `tests/test_formula_templates.py:35` `_payload`, `:55` `_FakeTemplates`, `:296` `test_ac15_empty_catalog_lists_zero_templates`; no `real_pg` infrastructure in this service
- **`xstockstrat-analysis`** (Python)
  - Template repo: `app/repositories/strategy_templates.py:28` (list), `:34` (get), `:41-49` (create), `:59-63` (update), `:75-77` (retire)
  - Servicer: `app/handlers/servicer.py:3639` `ManageTemplate`; `:3663-3674` payload = `MessageToDict(payload, preserving_proto_field_name=True)` (**snake_case**, `entry_rule`/`exit_rule` as JSON **strings**, `kind` enum NAME, defaults omitted); `:3589` `_validate_template_definition`; `:3746` `InstantiateTemplate`; `:3737` `_free_strategy_id`; `:670` `_require_admin_for_blend_id`; `:7304` `_row_to_strategy_template` (`ignore_unknown_fields=True`); `app/services/evaluator.py:831` `_validate_definition`
  - Proto: `packages/proto/analysis/v1/analysis.proto:320-325` `ComponentKind`, `:327-341` `StrategyComponent`, `:343-393` `StrategyDefinition` (`optional int32 cooldown_days=9`), `:932-937` `StrategyTemplate`
  - Last migration: `027_contract_owner_dimension.up.sql`; template DDL in `026_owner_dimension_templates.up.sql:88-99`
  - Tests: `tests/test_strategy_templates.py:39` `_payload`, `:55` `_tpl_row`; `tests/test_strategy_templates_real_pg.py:14-33` (regex-extracts the 026 DDL; **`:30` asserts only 026 mentions `strategy_templates`**); `tests/conftest.py:439` `local_pg`; per-file migration apply precedent `tests/test_fundsignal_emitted_real_pg.py:16-23`
  - Producer registration: `app/engine/fundsignal_loop.py:610-641` `_ensure_source_registered` (slug default `fundamentals` `:46`, `display_name="Fundamentals Signal Producer"`, `source_type="derived"`, `extractor_module="app.extractors.noop"`, `active=True`; `ALREADY_EXISTS` treated as registered `:631-634`)
- **`xstockstrat-ingest`** (Python)
  - Template repo: `app/repositories/source_templates.py:18` (`list_active`), `:38` (`create`), `:55` (`update`), `:71` (`retire`)
  - Servicer: `app/handlers/servicer.py:169` `_TEMPLATE_PAYLOAD_FIELDS = ("slug","display_name","source_type","extractor_module","config_json","reliability_weight")`; `:179` `_template_payload` (snake_case); `:184` `_template_to_proto` (`ignore_unknown_fields=True`); `:1427` `_register_conflict`; `:1560` `_register_source`
  - `signal_sources`: PK `(user_id, slug)` — `migrations/013_signal_ownership_templates.up.sql:24-32`; `source_type` CHECK final in `011_signal_source_type_mcp_client.up.sql:10-16`; `SYSTEM_OWNER` `app/repositories/signal_sources.py:36`; `insert_source` `:135-172`; `validate_config_json` `:235-285` (website requires `url` + `scrape_selector`; email requires `sender_patterns` + `subject_patterns`; extra keys unchecked; `derived` → no config)
  - Last migration: `015_backfill_webhook_callback.up.sql`; template DDL `013…up.sql:119-129`
  - Tests: `tests/test_source_templates.py:29` `_template_row`; `tests/_helpers.py` `transaction_conn`; no real-PG fixture
- **Migration tooling** (`scripts/`)
  - `scripts/db-migrate.sh:152-177` run order ends `ingest → indicators → analysis`; `:77-82` dirty recovery = `force 0` + replay every up-file from 001 (refused at/above a contract floor by `scripts/migration-dirty-guard.sh`)
  - `scripts/render-migrations.sh:23-31` — a file with no `-- requires-env` header in its first 5 lines is copied verbatim (`$`, `$$`, `${…}` untouched)
  - `scripts/migration-rerun.py:53-59` hard-coded `REPLAYS`; **`:1114` asserts final versions `("ingest", 15), ("analysis", 27)`**; every `scripts/migration-assertions/<svc>-<NNN>.sql` is auto-run after pass 3 (`:562-593`); CI job `migration-rerun` `.github/workflows/ci.yml:897-933`

## Patterns to REUSE

- Idempotent seed INSERT → `INSERT … VALUES … ON CONFLICT (…) DO NOTHING`, as `services/xstockstrat-config/migrations/008_analysis_fundsignal_keys.up.sql:10-48` and `services/xstockstrat-identity/migrations/002_seed_admin.up.sql:15`
- Multi-line text inside SQL → named dollar-quote tag, as `services/xstockstrat-ingest/migrations/013_signal_ownership_templates.up.sql:35-52` (`$fn$`)
- Migration header → `-- Migration:` / `-- Service:` / feature line, as `services/xstockstrat-indicators/migrations/007_private_formulas_templates.up.sql:1-4`; no `requires-env` header (no placeholder needed with `created_by='system'`)
- Post-migration SQL assertions → drop `scripts/migration-assertions/{indicators-008,analysis-028,ingest-016}.sql` (style: `scripts/migration-assertions/indicators-007.sql:1-23`, `DO $$ … RAISE EXCEPTION 'AC-n: …'`); they run in the existing `migration-rerun` job against a real PostgreSQL with all migrations applied
- Formula payload validity → reuse `_validate_register_payload` (`services/xstockstrat-indicators/app/handlers/servicer.py:823`) and the sandbox executor over the parsed seed payloads
- Strategy payload validity → reuse `evaluator._validate_definition` (`services/xstockstrat-analysis/app/services/evaluator.py:831`) with formula outputs derived from the formula seed
- Source payload validity → reuse `validate_config_json` (`services/xstockstrat-ingest/app/repositories/signal_sources.py:235`)
- Test asserting on migration SQL text → precedent `services/xstockstrat-config/src/__tests__/barIngestBackoffSeedMigration.test.ts:3-47`
- Real-PG migration test (analysis only) → `local_pg` (`services/xstockstrat-analysis/tests/conftest.py:439`) + per-file apply (`tests/test_fundsignal_emitted_real_pg.py:16-23`)
- Cross-service shared test vector → `scripts/testdata/` (precedent `scripts/testdata/rpc-status-vectors.json`); new tooling is a Python script with `scripts/tests/test_<name>.py` (`docs/patterns/script-tooling.md:12-16`)
- System fundamentals source values → copy exactly from `fundsignal_loop.py:619-625` so a seeded row is indistinguishable from a producer-registered one
- Composite template drift guard → compare against the exported `SOURCE`/`PARAMETERS`/`OUTPUTS`/`FUNDAMENTAL_INPUTS` in `app/formulas/fundamentals_value_quality.py`

## Existing Business Rules (preserve / extend)

- **CHANGE** `@AC-15 @FR-7 @feature-224` "Catalog starts empty after migration" (`docs/sdd/business-rules/platform.feature:270`) — asserts `ListTemplates` returns 0 after migration; 335 reverses it to the seeded 9 / 14 / 4 catalog. Operator sign-off given 2026-11-12 (context.md). Rewrite in place at promotion, keeping `@feature-224` and adding `@feature-335` (precedent: `@AC-35 … @feature-224 @feature-225`, `platform.feature:311`).
- **EXTEND** `@AC-1 @feature-156` "The producer runs its first cycle promptly on a fresh deploy" (`services/xstockstrat-analysis/acceptance/fix-fundamentals-signal-producer.feature:11`) — the source is now registered from migration; the producer's `_ensure_source_registered` must stay a no-op over the seeded row.
- **PRESERVE** `@AC-36 @FR-4 @feature-224` "System slugs are reserved in both directions" (`platform.feature:319`) — a pre-existing **user-held** `fundamentals` slug must not gain a second, system holder by migration.
- **PRESERVE** `@AC-26 @FR-6 @feature-224` (`platform.feature:297`) — seeded source row is `user_id='system'`, `source_type='derived'`.
- **PRESERVE** `@AC-27 @FR-11 @feature-224`, `@AC-33 @FR-6 @feature-224`, `@AC-7`/`@AC-8 @FR-4 @feature-224` (`services/xstockstrat-ingest/acceptance/private-by-default-templates.feature:34,40,8,15`) — 016 touches no existing `signal_sources` row; source templates reserve no slug.
- **PRESERVE** `@AC-13`, `@AC-14`, `@AC-16`, `@AC-17`, `@AC-31`, `@AC-2` `@feature-224` (`services/xstockstrat-indicators/acceptance/private-by-default-templates.feature:35,41,47,54,76,16`) — admin-only authoring, version bump, private snapshot, retire hides; the seed writes only `formula_templates`, never `indicators.formulas`.
- **PRESERVE** `@AC-6 @FR-3 @FR-1 @feature-224` (`platform.feature:263`) and `@AC-23 @FR-11 @feature-224` (`platform.feature:290`) — system formula `d1ff5e6b-…` untouched and read-only; blend strategy protections unchanged.
- **PRESERVE** `@AC-6 @FR-7 @feature-201` (`services/xstockstrat-indicators/acceptance/fundamentals-formula-inputs.feature:9`) — seeded payloads must pass the same validators the RPC path enforces.
- **PRESERVE** `@AC-1`, `@AC-2`, `@AC-3` `@regression @feature-269` (`services/xstockstrat-{indicators,analysis,ingest}/acceptance/fix-template-update-metadata.feature:9,20,33`) — UPDATE/RETIRE semantics on seeded rows; replay must not un-retire.
- **PRESERVE** `@AC-18`, `@AC-19` `@FR-9 @feature-224` (`platform.feature:276,283`), `@AC-20`, `@AC-34` `@feature-224` (`services/xstockstrat-analysis/acceptance/private-by-default-templates.feature:41,67`) — saga deep-copy, id collision `_2`, `ALREADY_EXISTS`.
- **PRESERVE** `@AC-4`/`@AC-6`/`@AC-8 @feature-186` (`services/xstockstrat-analysis/acceptance/fundamentals-blend-strategy-restrictions.feature:34,51,68`) — the seed never touches `analysis.engine.fundamentals_blend_strategy_id`.
- **PRESERVE** `@AC-39 @FR-13 @feature-294` (`platform.feature:1333`), `@AC-25`/`@AC-32 @FR-12 @feature-224`, `@AC-24 @FR-12 @feature-224`, `@AC-4 @FR-4 @regression @feature-241` — agent/UI/telemetry contracts unchanged.

## Dependencies

- Proto/RPC: none changed. Payload contracts read: `RegisterFormulaRequest` (`indicators.proto:197`), `StrategyDefinition` (`analysis.proto:343`), `SignalSource` subset (`servicer.py:169`).
- Migration: indicators `008`, analysis `028`, ingest `016` (trunk tips 007 / 027 / 015). Cross-service order is satisfied by `db-migrate.sh` (indicators before analysis), but nothing in SQL enforces that strategy templates reference existing formula templates (different schemas, no FK).
- Config keys: none.
- Inter-service edges: none new.
- New env vars / ports: none.
- Tooling that must change with the migrations: `scripts/migration-rerun.py:1114` (15→16, 27→28); `services/xstockstrat-analysis/tests/test_strategy_templates_real_pg.py:30`.

## Risks / Not-found

- **Seeds bypass every write-time validator** (indicators `:823`, analysis `:3589`, ingest `validate_config_json`); indicators reads with strict `ParseDict`, so one bad key breaks `ListTemplates` for everyone. Validity must be proven by tests, not assumed.
- **Not found: `extractor_module` of the four staging sources.** `list_signal_sources` does not return it; the only extractor module in the repo is `app.extractors.noop` (`services/xstockstrat-ingest/app/extractors/noop.py:2`). The column is NOT NULL with no server default.
- **Not found: a raw staging snapshot on disk.** The staging payloads exist only as MCP tool output in the orchestrator's context; a committed snapshot is a transcription unless re-exported, so the snapshot itself needs an independent post-deploy check against staging.
- **Blend id.** The `fundamentals_macd_blend` template's default instance id equals `analysis.engine.fundamentals_blend_strategy_id`; a non-admin instantiate without `strategy_id` → `FAILED_PRECONDITION` (`servicer.py:670-678`). No durable `@AC` covers this.
- **Reserved slug.** If a user already holds `fundamentals`, inserting a system row would create a second holder; the producer path refuses that with `FAILED_PRECONDITION` (`servicer.py:1435`).
- **Down semantics.** No FK references `signal_sources` (only FK in ingest: `004_add_backfill_chunks.up.sql:8`), but deleting `fundamentals` would orphan system signals; 013/026/007 downs drop the template tables wholesale.
- **Not found:** a CI numbering/down-pair check; a rule requiring assertions per migration; a documented procedure for amending a promoted scenario (`docs/sdd/business-rules/CLAUDE.md`); confirmation that golang-migrate wraps a file in one transaction (inferred only).
- **Stale test name:** `tests/test_formula_templates.py:296` traces to the CHANGEd rule (fake repo, will not fail).
- Ledger traps: fails 2026-07-01 063 (C-10(c), seeded shared resource) — covered by FR-10; fails 2026-08-06 `migration` (NNN from union of refs); `fails.md:393` (a value set propagated to one artifact but dropped from its siblings) (cross-check every artifact against the full seeded list).
- Overlap: 318 `fix-migration-tooling-safety` (spec-ready) reworks dirty-recovery replay.

## Recommended Scope

1. Commit the staging snapshot fixture (formulas, strategies, sources) under `scripts/testdata/`.
2. indicators `008` up/down + validity/drift tests + `indicators-008.sql` assertions.
3. analysis `028` up/down + validity tests + `analysis-028.sql` + fix `test_strategy_templates_real_pg.py:30`.
4. ingest `016` up/down (templates + `fundamentals` source) + validity tests + `ingest-016.sql`.
5. `migration-rerun.py:1114` version bump; parity check script + pytest.
6. Docs: service `CLAUDE.md` migration notes; amend `platform.feature` `@AC-15 @feature-224`.
7. Post-deploy: parity run against live staging via `list_templates` vs the source instances.
