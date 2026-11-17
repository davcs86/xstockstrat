# Recon: mediated-source-extraction-instructions

**Created**: 2026-11-17
**From**: product-spec.md
**Tree**: ccr-424ada30-29m2lv@f8e7a99 ≡ origin/ccr-424ada30-29m2lv
**Affected services**: xstockstrat-ingest, xstockstrat-agent, xstockstrat-ui, packages/proto

Paths are repo-relative. `ingest/` = `services/xstockstrat-ingest/`, `agent/` =
`services/xstockstrat-agent/`, `ui/` = `services/xstockstrat-ui/`.

---

## Objective

Give signal sources a first-class prose field `extraction_instructions` (ingest column + additive
`SignalSource` proto field), required when a `mediated_*` source is created, and stop showing or
asking for the dead `extractor_module` on mediated sources at the agent and UI surfaces. A consuming
agent that today reads `app.extractors.noop` and concludes "no work" instead always receives prose —
the stored text, or one fixed generic default for legacy rows.

## Codebase Map

- **`packages/proto`**
  - `SignalSource` — `packages/proto/ingest/v1/ingest.proto:172-193`; fields 1-14 used
    (`extractor_module = 4`, `optional double reliability_weight = 12`, `user_id = 13`,
    `origin = 14`). Next free: **15**.
  - `ManageSignalSourceRequest` — `ingest.proto:225-233` (`update_mask = 4`, virtual path
    `credentials_ref`). `SourceTemplate { meta = 1; SignalSource payload = 2 }` — `ingest.proto:240`:
    a template payload is a **typed `SignalSource`**, so the new field reaches templates for free.
  - `InstantiateTemplateRequest { template_id, slug, credentials_ref }` — `ingest.proto:256-260`
    (no per-call override of payload fields).
- **`xstockstrat-ingest`** (Python)
  - Servicer: `ingest/app/handlers/servicer.py`
    - `_SS_MASKABLE_PATHS` `:58-67` — an update mask naming an unlisted path is rejected.
    - `_SS_CREDENTIAL_REQUIRED_TYPES` `:70-72`.
    - `_TEMPLATE_PAYLOAD_FIELDS` `:167-176` + `_template_payload` `:179` — allow-list; an unlisted
      key is silently dropped from a stored template payload.
    - `_template_to_proto` `:184-200` (`ParseDict(..., ignore_unknown_fields=True)`).
    - `_source_to_proto` `:203-232` (`extractor_module=row["extractor_module"]` `:214`).
    - `ListSignalSources` `:1464-1502`.
    - `_validate_source_write(source_type, config_json, credentials_ref)` `:1504-1516` — called on
      the merged values at `:1620` (update) and `:1669` (register).
    - `ManageSignalSource` update branch `:1541-1650`: `_use_req(field)` = `mask is None or field in
      mask` (`:1579-1596`). **With no mask every request field replaces the stored one**, including
      an empty string — preserve-on-omit holds only for a masked update.
    - `_register_source` `:1652-1688` — **shared by REGISTER and InstantiateTemplate**; the one
      `insert_source` call site (`:1672-1685`).
    - `ManageTemplate` `:1698-1764` — admin-only; UPDATE/RETIRE of a `created_by == system` row is
      `PERMISSION_DENIED` (`:1712-1722`); CREATE/UPDATE validate with `validate_config_json` +
      `_weight_error` (`:1726-1732`).
    - `InstantiateTemplate` `:1766-1794` — payload → `SignalSource` → `_register_source`
      (`:1780-1788`). `extractor_module` comes only from the payload.
  - Repositories: `ingest/app/repositories/signal_sources.py` — `_LIST_COLS` `:51-55` (explicit
    column list), `insert_source` `:135-172` ($1..$9), `update_source` `:175-211` ($1..$8),
    `validate_config_json` `:235-285` (the five mediated types as string literals `:242-244`,
    `:260-261`). `ingest/app/repositories/source_templates.py` — `update` bumps `version + 1`
    (`:50-64`), `stamp_origin` `:91-104`.
  - Last migration: `016_seed_source_templates` (`ingest/migrations/`). Next: **017**.
    - `002_add_signal_sources_registry.up.sql:11` — `extractor_module TEXT NOT NULL`.
    - `013_signal_ownership_templates.up.sql:119-129` — `ingest.source_templates(template_id PK,
      name, description, payload JSONB, version INT DEFAULT 1, retired_at, created_by, …)`.
    - `016_seed_source_templates.up.sql:7-13` — four system rows, `ON CONFLICT DO NOTHING`, payload
      keys `slug, display_name, source_type, config_json, reliability_weight` — **no
      `extractor_module`**, so a source instantiated from a seeded template stores `""` today.
    - `016 .down.sql:6-8` deletes the four ids only `WHERE version = 1 AND retired_at IS NULL AND
      created_by = 'system'`.
  - Config: none read by this feature.
- **`xstockstrat-agent`** (Python)
  - `agent/app/tools.py`: `_EXTRACTOR_TOOL_MAP` `:303-310` (4 of the 5 mediated types;
    `mediated_simple_email` absent → `None`); `list_signal_sources` `:539-574` (own inline 7-key
    dict; already omits `extractor_module`); `_get_source` `:2640-2650`; `instantiate_template`
    `:1371-1413` (docstring return shape lists `extractor_module` `:1391-1394`);
    `manage_signal_source` `:1415-1507` (param `:1423`, "Provide … extractor_module" `:1434`,
    return shape `:1457`, `supplied` mask dict `:1473-1482` using `is not None`);
    `_CREDENTIALS_UNSUPPORTED` `:90-97`; `list_templates` `:1355-1369` returns raw
    `MessageToDict` payloads (camelCase `extractorModule`).
  - `agent/app/client.py`: list projection `:192-224` (inline); request builder `:1362-1417`
    (`extractor_module=source.get("extractor_module", "")` `:1390`); `_managed_source_to_dict`
    `:1429-1441` — the one projection shared by manage (`:1417`) and instantiate (`:1511`).
  - `agent/app/prompts/signal_extraction.md` is **loaded by nothing** (`register_prompts` reads only
    `list_correlation.md`, `tools.py:88,2618-2637`; recorded in
    `agent/docs/context-constitution-findings.md:36`). The tool responses and docstrings are the only
    extraction guidance a consuming agent actually receives.
  - `GET /api/tools` is generated from signatures + docstrings (`agent/app/main.py:124-143`).
- **`xstockstrat-ui`** (Next.js)
  - `ui/src/app/insights/signal-sources/page.tsx`: `SOURCE_TYPES` `:36-48`; `FormState` `:52-70`;
    `isMediatedType` `:123-125`; `formFromSource` `:163-185`; `handleSave` `:269-338` (validation
    idiom `setSaveError(msg); return;` `:275`; shared `base` `:304-315`; update mask paths
    `:324-331`); "Extractor Module" `Input` `:601-609` (always rendered, disabled on edit); source
    type is immutable on edit (`:580-599`); inline `Card` form, error line `:764`.
  - `ui/src/app/config-ui/templates/page.tsx`: `FieldDef { key, label, multiline?, placeholder? }`
    `:47-52`; `PAYLOAD_FIELDS.SIGNAL_SOURCE` `:80-87`; `formFromTemplate` `:132-143`; `buildInput`
    `:206-232` (throws `Error` → `formError`, no request); render `:455-477`
    (`multiline` → `Textarea`); system rows have no Edit (`:284-285`). The field list is static per
    kind — no awareness of `sourceType` (free text here).
  - BFF is a typed pass-through (`ui/src/lib/insightsBff.ts:84-105`, `configUiBff.ts:61-64`); no
    field allow-list.

## Patterns to REUSE

- New optional column on `signal_sources` end to end → follow `reliability_weight` (feature 134):
  `_LIST_COLS`, the explicit INSERT/UPDATE column lists, `_source_to_proto`, `_SS_MASKABLE_PATHS`,
  the merge block at `servicer.py:1605-1645`. **Append** the new bind parameter last
  (`insert_source` `$10`, `update_source` `$9`): `ingest/tests/test_signal_sources.py:274-317` pins
  positional indexes.
- Validation on the merged (effective) values → extend `_validate_source_write`
  (`servicer.py:1504-1516`), already called on both write paths.
- Forcing a value for register *and* instantiate → `_register_source` (`servicer.py:1652`), the
  single insert site.
- Template payload carriage → add the key to `_TEMPLATE_PAYLOAD_FIELDS` (`servicer.py:167`) and to
  `SOURCE_PAYLOAD_FIELDS` (`scripts/check-seed-template-parity.py:48-55`).
- Agent contract drift guard → the descriptor-parity tests
  `agent/tests/test_signal_source_projection.py:15-54` (`_INTENTIONALLY_DROPPED`) and
  `agent/tests/test_signal_source_builder.py:30-112`. Both **fail on the new proto field** until it
  is carried — that is the intended fail-closed behaviour (ledger insight 2026-08-02).
- Fixed prose constant in the agent → module-level `_UPPER_SNAKE` in `tools.py`
  (`_CREDENTIALS_UNSUPPORTED` `:90-97`); no agent config key holds prose.
- UI multi-line field → `Textarea` (`ui/src/components/ui/textarea.tsx:5`); in the templates form a
  `multiline: true` `FieldDef` is enough (`templates/page.tsx:455-477`).
- UI tests → `ui/e2e/insights/signal-sources.spec.ts` ("rejected client-side (no
  ManageSignalSource call)" `:149-163`; register form `:167-191`); fixtures
  `ui/e2e/fixtures/signalSources.ts` + `templates.ts` and `INVENTORY.md` rows 32-33 (C-12). No
  mediated-source fixture exists yet.

## Existing Business Rules (preserve / extend)

No CHANGE verdicts. No existing `@AC-*` requires or returns `extractor_module`, pins the key set of
a signal-source tool response, or asserts seed-payload equality.

- **PRESERVE** `@AC-6 @feature-335` "Source catalog is seeded with the 4 mediated staging sources" (`ingest/acceptance/seed-curated-templates.feature`) — exactly 4 seeded templates; `sec_edgar_form4` keeps `source_type` and `scrape_selector`. The migration only adds a payload key.
- **PRESERVE** `@AC-7 @feature-335` "A seeded website source template instantiates into a private source" (same file) — must still succeed under the mediated-requires-instructions rule, so seeding the four payloads is a hard prerequisite of FR-2.
- **PRESERVE** `@AC-18 @feature-335` "The ingest down migration leaves the fundamentals source in place" (same file) — the new migration's down must not break 016's down.
- **PRESERVE** `@AC-11`, `@AC-12`, `@AC-40 @feature-335` system `fundamentals` source (same file) — non-mediated `derived`; the migration never touches `signal_sources` rows.
- **PRESERVE** `@AC-1`, `@AC-2`, `@AC-3 @feature-269` SIGNAL_SOURCE template UPDATE / double RETIRE / empty-id CREATE (`ingest/acceptance/fix-template-update-metadata.feature`) — RETIRE must not be gated by new validation; fixture payload types are unspecified.
- **PRESERVE** `@AC-1`, `@AC-2`, `@AC-6 @feature-166` mcp_client register / bearer never returned / fail-closed (`ingest/acceptance/mcp-client-signal-source.feature`).
- **PRESERVE** `@AC-7`, `@AC-8 @feature-224` owner-private source CRUD, per-owner slugs (`ingest/acceptance/private-by-default-templates.feature`).
- **PRESERVE** `@AC-9 @feature-161` "a new SignalSource proto field fails the agent parity test until surfaced" (`agent/acceptance/surface-signal-weight-decay-config.feature`).
- **PRESERVE** `@AC-1`, `@AC-3 @feature-161` list returns `reliability_weight`; INVALID_ARGUMENT surfaces as a tool error (same file).
- **EXTEND** `@AC-2`, `@AC-10 @feature-161` update-mask discipline (same file) — `extraction_instructions` is in the mask only when supplied.
- **PRESERVE** `@AC-25 @feature-224` (`agent/acceptance/private-by-default-templates.feature`), `@AC-30 @feature-335` (`agent/acceptance/seed-curated-templates.feature`), `@AC-4 @feature-241` (`agent/acceptance/fix-config-audit-author-spoof.feature`).
- **PRESERVE** `@AC-4`, `@AC-5 @feature-161` weight field + guidance on the source form (`ui/acceptance/surface-signal-weight-decay-config.feature`); `@AC-6 @feature-270` failed toggle shown (`ui/acceptance/fix-ui-trader-feedback.feature`) — deactivate/reactivate must work on legacy empty mediated rows; `@AC-29 @feature-335` system templates read-only in config-ui (`ui/acceptance/seed-curated-templates.feature`); `@AC-24 @feature-224` "Use template" still works (`ui/acceptance/private-by-default-templates.feature`).
- **PRESERVE** `platform.feature` (`docs/sdd/business-rules/`): `@AC-22`, `@AC-19`, `@AC-24 @feature-335` (exactly 4 system `tpl-*` rows; idempotent; never un-retire); `@AC-26 @feature-335` (admin cannot update a system template — payload change is migration-only); `@AC-36`, `@AC-26 @feature-224` (ALREADY_EXISTS / PERMISSION_DENIED keep precedence over new validation); `@AC-35 @feature-224`; `@AC-32 @feature-224` (runbook parity); `@AC-39 @feature-294` (`template.instantiate` outcome label set is closed).

## Dependencies

- Proto/RPC: `ingest.v1.SignalSource` + field 15 (`ingest.proto:172-193`). No new RPC. Stubs
  regenerated via `./scripts/buf-gen.sh` (TS/Python/Go).
- Migration: `017` for `ingest/migrations/`. The file name must **not** end in
  `_seed_source_templates.up.sql` — `scripts/check-seed-template-parity.py:31` and
  `ingest/tests/test_seed_source_templates.py:29-32` both require exactly one such file.
- Config keys: none.
- Inter-service edges: none new (agent → ingest, ui → ingest exist).
- New env vars / ports: none.

## Risks / Not-found

- **Template version vs the 016 assertions.** Bumping `version` on the four system templates makes
  instances show `update_available` (`servicer.py:229`), but `scripts/migration-assertions/ingest-016.sql:6-16`
  asserts those rows have `version = 1`, and `016 .down.sql:8` deletes only `version = 1` rows. Not
  bumping keeps both green but hides the change from existing instances. Design decision.
- **Maskless update** replaces every field (`servicer.py:1579-1596`): a maskless update of a
  mediated source that omits instructions sends `""`. Under FR-12 that is a rejected clear; under
  FR-5 a legacy row must stay updatable. The interplay needs an explicit rule (which callers still
  send no mask?).
- **`ManageTemplate` CREATE/UPDATE** — unspecified whether an admin-authored mediated template with
  empty instructions is rejected at template-write time or only fails at instantiate (FR-2 via
  `_register_source`). Feature 269 `@AC-1..3` fixtures do not state a payload type.
- **`list_templates`** (agent) returns raw template payloads including `extractorModule` — outside
  FR-6/FR-7's named tools; decide whether it is in scope.
- **`_get_source`** reads the raw client dict — only `has_credentials`/config are used today.
- **New column nullability**: `scripts/migration-assertions/fixtures-pre-224.sql:19` inserts without
  the column, and `migration-rerun` (`.github/workflows/ci.yml:896-935`) replays every up file — the
  column needs a default and the migration must be idempotent.
- **Check order**: new INVALID_ARGUMENT checks must not pre-empt PERMISSION_DENIED (system source)
  or ALREADY_EXISTS (reserved slug).
- **`template.instantiate` outcome label** for an instantiate rejected for missing instructions must
  stay inside the closed label set (`platform.feature @AC-39 @feature-294`).
- **Templates form is type-blind**: `sourceType` is free text and the field list is static, so
  "offer the field" (FR-9) is either unconditional or needs new conditional logic.
- **UI mock backend**: `manageSignalSource` update echoes only `reliabilityWeight`
  (`ui/e2e/mock-backend.ts:1650-1677`) — assert the request body, not the response.
- **Agent test seams**: tool-level tests mock `client.*` returns (`agent/tests/test_tools.py:77-122`),
  so the layer that adds the default text decides which fixtures change.
- **`signal_extraction.md` is unserved** — FR-10 edits it, but no agent reads it at runtime.
- **Ledger traps**: `fails.md` 2026-08-05 signal-source-registry (mediated types dropped from sibling
  artifacts — no canonical five-type constant exists in ingest, agent, or UI beyond a `startsWith`);
  `fails.md` 2026-08-02 mcp-tools-alignment (docstring + runbook drift); insight 2026-08-13 feature
  134 (a bound `NULL` does not fall through to a column `DEFAULT`; plain proto3 scalars cannot
  distinguish unset from zero — relevant to "omitted" vs `""` on a `string` field).
- **Overlap**: `328-fix-agent-bearer-secret-orphan` (spec-ready) edits the same
  `manage_signal_source` / `instantiate_template` bodies in `agent/app/tools.py`.
- Not found: any existing `extraction_instructions` reference; any length-cap constant; a shared
  agent projection helper; a source fixture in `ingest/tests/conftest.py` (builders are per-file:
  `_row`, `_template_row`, `_template_msg`, `_instantiate`); a vitest or e2e test for the config-ui
  signal-source template form or for any mediated source in the UI.

## Recommended Scope

1. proto: field 15 + `buf-gen`.
2. ingest migration 017: column (idempotent, defaulted) + template payload seeding.
3. ingest service: repository columns, `_source_to_proto`, mask path, merged validation, noop
   forcing in `_register_source`, template payload allow-list; paired tests.
4. scripts: `SOURCE_PAYLOAD_FIELDS`, migration assertion for 017 (and 016 if version is bumped).
5. agent: builder + both projections + mediated shaping + default text + docstrings; parity tests.
6. ui: `/insights/signal-sources` form, `/config-ui/templates` field; fixtures + e2e.
7. docs: `docs/runbooks/mcp-tools.md`, `signal_extraction.md`, ingest/agent CLAUDE.md as needed.
