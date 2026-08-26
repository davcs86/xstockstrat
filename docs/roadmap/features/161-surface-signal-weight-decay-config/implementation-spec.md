# Implementation Spec: surface-signal-weight-decay-config

**Status**: `in-progress`
**Created**: 2026-08-26
**Feature**: `docs/roadmap/features/161-surface-signal-weight-decay-config/feature.md`
**Total Steps**: 12
**Feature Branch**: `feature/surface-signal-weight-decay-config`

---

## Execution Summary

Follows the design's build order (`design.md` § Build order): agent (self-contained) → proto +
buf-gen → config migrations → config-service code + tests → config-ui scalar validation → UI sources
form → docs. The agent work (surface `reliability_weight`) has no dependency on the config/proto work
and lands first. The proto enum addition (`VALUE_TYPE_FLOAT_SCALAR`) gates the config-service
scalar-bounds emission and the config-ui scalar renderer, so it precedes both. Migrations 019/020 seed
and delete config rows; the config-service code enforces the decay bounds at the `setConfig`
write-chokepoint (the authoritative enforcement point, per design — closing the agent/direct-write
fail-open window) and removes the now-orphaned FLOAT_MAP validation machinery whose sole key is
deleted by 020.

Two consumer surfaces (product-spec `## Consumer Surface(s)`, **C-14**) each get their own steps:
the **config-ui** segment (Steps 8-11: `reliability_weight` form field + guidance, inline-editor
guidance, and the scalar-validated decay key rendering) and the **agent** MCP tools (Steps 1-2:
`list_signal_sources` returned field, `manage_signal_source` arg/passthrough/return). The decay key
reaches the agent through the already-generic `get_config`/`set_config`/`list_config_keys` tools once
registered — no per-key agent tool change (restated so the reader knows it was a decision, not an
omission).

### Scenario Coverage (C-15)

| Scenario | Covered by step(s) |
|---|---|
| `@AC-1` (FR-1) list returns reliability_weight | Step 2 |
| `@AC-2` (FR-2) manage update sets weight w/ mask path | Step 2 |
| `@AC-3` (FR-2) out-of-range weight rejection surfaced | Step 2 |
| `@AC-10` (FR-2) mask omission preserves weight | Step 2 |
| `@AC-9` (FR-7) parity test fails on a new SignalSource field | Step 2 |
| `@AC-6` (FR-5) decay key registered + visible with FLOAT_SCALAR bounds | Step 7 (wire contract, authoritative) + Step 11 (config-ui rendering) |
| `@AC-7` (FR-5) decay settable at boundary 0 without create_key | Step 7 |
| `@AC-11` (FR-8) out-of-range decay write rejected server-side | Step 7 |
| `@AC-12` (FR-8) negative/non-numeric decay write rejected | Step 7 |
| `@AC-8` (FR-6) dead source-weights key gone after removal | Step 7 (registry/emit removal) + Step 5 (migration 020, DB state proven at deploy) |
| `@AC-4` (FR-3) create form sets weight + guidance | Step 9 |
| `@AC-5` (FR-4) inline editor guidance text | Step 9 |

## Step Dependencies

- Step 4 (proto-gen) requires Step 3 (proto): stubs regenerate the edited `config.proto`.
- Step 6 (config-service code) requires Step 4: it references the regenerated `ValueType.VALUE_TYPE_FLOAT_SCALAR` constant.
- Step 6 requires Step 5 (migration 020) for coherence — removing `WEIGHT_KEY_REGISTRY` (whose sole entry is the deleted key) must land with the row deletion, not before.
- Step 7 (config test) covers Step 6 [service] (C-08 pairing).
- Step 10 (config-ui NamespaceEditor scalar renderer) requires Step 4 (regenerated `ValueType`) for the `VALUE_TYPE_FLOAT_SCALAR` constant in the browser types.
- Step 11 (config-ui e2e) covers Step 10; Step 9 (UI sources e2e) covers Step 8.
- Step 2 (agent test) covers Step 1 [service] (C-08 pairing). Steps 1-2 have no cross-dependency on the proto/config work and may land first.
- AC-8's terminal DB state (`list_config_keys` no longer returns the key) is proven at deploy/CI when migration 020 applies against the managed DB; the offline step verifications prove the migration pair and the code-level registry/emit removal.

---

### Step 1 — service: Agent — surface `reliability_weight` in `list_signal_sources` and `manage_signal_source`

**Status**: `done`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/app/tools.py` — modify
- `services/xstockstrat-agent/app/client.py` — modify

**Reviewers**: `xstockstrat-agent` (service owner) — MCP tool contract stability (name, parameters, return shape) and `docs/runbooks/mcp-tools.md` parity; no secret values in tool output

**Codebase Evidence**:
- Tool `list_signal_sources` re-projection drops `reliability_weight`: `services/xstockstrat-agent/app/tools.py:227-243` — the `enriched` dict at `:232-240` carries only `slug`/`display_name`/`source_type`/`config_json`/`extractor_tool` and omits it. Confirmed via Read.
- Client `list_signal_sources` **already reads** `reliability_weight`: `services/xstockstrat-agent/app/client.py:195` (`"reliability_weight": src.reliability_weight`, dict `:178-197`). So the drop is purely in the tool layer.
- Tool `manage_signal_source` signature has no `reliability_weight` param: `tools.py:890-899`; it builds `source` dict `:916-924` and derives `update_mask` from a `supplied` dict of non-`None` fields `:925-934` (`update_mask = [field for field, val in supplied.items() if val is not None]`).
- Client `manage_signal_source` builds `ingest_pb2.SignalSource(...)` **without** `reliability_weight`: `client.py:1004-1010` (the F-6/RC-1 write-direction drop this feature fixes); response projection omits it `:1033-1040`.
- `ingest.SignalSource.reliability_weight` is field 12 (`optional double`, `[0,1]`), already on the proto (recon.md Dependencies; `packages/proto/ingest/v1/ingest.proto:160`) — **no ingest proto change**.
- Existing propagating client: the agent forwards `x-user-id`/`x-access-scope`/`x-trace-id` via `_metadata(...)` on both `ListSignalSources` (`client.py:176`) and `ManageSignalSource` (`client.py:1027`) — this step adds **no new outbound gRPC edge**, only new fields on existing calls, so no new header-propagation wiring (C-03 satisfied by reuse).

**TDD**: `red-green required`

**Covers**: `—`

**Instructions**:
1. In `tools.py` `list_signal_sources` (`:227-240`), add `"reliability_weight": src["reliability_weight"],` to the `enriched` dict (the client dict already carries it, `client.py:195`). Update the tool docstring (`:221-224`) to document that each returned entry includes `reliability_weight` (a ranking multiplier in `[0,1]`, default `1.0`). (FR-1)
2. In `tools.py` `manage_signal_source` (`:890-899`), add an optional param `reliability_weight: float | None = None`. In the `source` dict assembly (`:916-924`), add `if reliability_weight is not None: source["reliability_weight"] = reliability_weight`. In the `supplied` dict (`:927-933`), add `"reliability_weight": reliability_weight` so the derived `update_mask` (`:934`) includes `reliability_weight` **only when the caller supplied it** (AC-10 semantics). Extend the docstring (`:900-915`) and the return-shape line (`:914-915`) to document the new arg and that the return includes `reliability_weight`. (FR-2)
3. In `client.py` `manage_signal_source` builder (`:1004-1010`), set `reliability_weight` on the `SignalSource` **conditionally** — because it is `optional double` (field 12), an unconditional set would write `0.0` and, if masked, reset a source's weight on a display-name-only update. Add after the `src = ingest_pb2.SignalSource(...)` construction: `rw = source.get("reliability_weight"); if rw is not None: src.reliability_weight = rw`. Do **not** append `reliability_weight` to the mask here — the tool layer already derives the mask from `supplied` (Instruction 2), so the write path stays conditional end-to-end. (FR-2, AC-10)
4. In `client.py` `manage_signal_source` response projection (`:1033-1040`), add `"reliability_weight": resp.source.reliability_weight,`. (FR-2)

**Verification**:
- `grep -n "reliability_weight" services/xstockstrat-agent/app/tools.py services/xstockstrat-agent/app/client.py` — confirm it appears in the tool list projection, the manage `source`/`supplied`/param, the client builder (conditional set), and the client manage-response projection.
- Lint: `cd services/xstockstrat-agent && ruff check . && ruff format --check .`
- Behavioral verification is in the paired Step 2.

---

### Step 2 — test: Agent — reliability_weight behavior + SignalSource descriptor-parity + mask-omission

**Status**: `done`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/tests/test_signal_source_projection.py` — modify
- `services/xstockstrat-agent/tests/test_signal_source_builder.py` — modify
- `services/xstockstrat-agent/tests/test_signal_source_reliability_weight.py` — create

**Reviewers**: `xstockstrat-agent` (service owner) — MCP tool contract stability (name, parameters, return shape) and `docs/runbooks/mcp-tools.md` parity; no secret values in tool output

**Codebase Evidence**:
- Existing projection parity test guards the **client** `list_signal_sources` dict against `SignalSource.DESCRIPTOR.fields_by_name` minus `_INTENTIONALLY_DROPPED = {"extractor_module"}`: `services/xstockstrat-agent/tests/test_signal_source_projection.py:18,52-54`. The client dict already carries `reliability_weight` (`client.py:195`), so this test passes today at the client layer.
- Existing builder parity test guards `ManageSignalSourceRequest.DESCRIPTOR.fields_by_name` minus `_INTENTIONALLY_UNSET = {"operation"}`: `test_signal_source_builder.py:16,59-62`. **Gap (the real F-6/RC-1 site):** it asserts the request's top-level fields (`source`, `credentials_ref`, `update_mask`, `operation_enum`) are set but does **not** recurse into the `source` sub-message — so a dropped `SignalSource.reliability_weight` in the *builder* is invisible to it. This is exactly why `reliability_weight` was dropped on the write path.
- Test harness patterns to reuse: `_capture_request(**kw)` returns the built `ManageSignalSourceRequest` (`test_signal_source_builder.py:26-39`); `_channel_cm()` mocks the async channel (`:19-23`); the projection test mocks `ListSignalSources` with a fully-populated `SignalSource` (`test_signal_source_projection.py:32-50`).
- Fixtures: `services/xstockstrat-agent/tests/conftest.py` exists; agent tests build protos inline (single-consumer, C-13-compliant inline).
- Error-surfacing path: tool wraps `grpc.aio.AioRpcError` into `RuntimeError(_grpc_error_message(e))` (`tools.py:886-887` sibling pattern; `manage_signal_source` try/except at `:938-`).

**TDD**: `red-green required`

**Covers**: `AC-1, AC-2, AC-3, AC-9, AC-10`

**Instructions**:
1. **Extend `test_signal_source_builder.py` (AC-9 / FR-7 — the parity gap):** add a test that captures the built request via `_capture_request(operation="update", source={... reliability_weight: 0.5 ...}, update_mask=["reliability_weight"])` and asserts descriptor-parity over the **`source` sub-message** — `set_fields = {f.name for f, _ in req.source.ListFields()}` must satisfy `set_fields | _INTENTIONALLY_UNSET_SOURCE == set(ingest_pb2.SignalSource.DESCRIPTOR.fields_by_name)`, where `_INTENTIONALLY_UNSET_SOURCE` justifies server-set/read-only fields (`has_credentials`, `health`, `last_error`, `last_seen_at`, `signals_fed` — populated by the backend, never sent on a write) per-field with a comment. This test fails against the pre-Step-1 tree (builder never set `reliability_weight`) and passes after. (AC-9)
2. **`test_signal_source_reliability_weight.py` (new):**
   - **AC-1:** mock `ListSignalSources` returning a `SignalSource(slug="sec-form4", reliability_weight=0.8)`; call the **tool** `list_signal_sources` projection path (or assert the tool-layer enriched dict includes `reliability_weight == 0.8`). Fails pre-Step-1 (tool dropped it).
   - **AC-2:** call the tool `manage_signal_source(operation="update", slug="sec-form4", reliability_weight=0.5)`; capture the request and assert `req.source.reliability_weight == 0.5` **and** `"reliability_weight" in list(req.update_mask.paths)`; assert the returned dict has `reliability_weight == 0.5`.
   - **AC-10:** call `manage_signal_source(operation="update", slug="sec-form4", display_name="SEC Form 4")` (no `reliability_weight`); assert `"reliability_weight" not in list(req.update_mask.paths)` (mask omission → server preserves stored weight).
   - **AC-3:** mock `ManageSignalSource` to raise `grpc.aio.AioRpcError` with `INVALID_ARGUMENT` naming `reliability_weight` for value `1.5`; assert the tool raises `RuntimeError` whose message names the invalid `reliability_weight` and that no successful dict is returned (error surfaced, not swallowed).
3. Reuse `_capture_request`/`_channel_cm` shapes from the existing tests; build protos inline (single consumer — C-13 inline compliant; no new `conftest.py` fixture needed).

**Verification**:
- `cd services/xstockstrat-agent && uv run pytest tests/test_signal_source_reliability_weight.py tests/test_signal_source_builder.py tests/test_signal_source_projection.py -v` — all pass (and the new builder-parity + AC-1 tests demonstrably fail against the pre-Step-1 tree, per the TDD gate).
- Coverage + lint: `cd services/xstockstrat-agent && ruff check . && ruff format --check . && uv run pytest --cov=app --cov-fail-under=40` — confirm ≥ 40%.

---

### Step 3 — proto: Add `VALUE_TYPE_FLOAT_SCALAR` to `config.v1.ValueType`; deprecate `FLOAT_MAP`

**Status**: `pending`
**Service**: `packages/proto`
**Files**:
- `packages/proto/config/v1/config.proto` — modify

**Reviewers**: Proto Reviewer — field number uniqueness, no breaking changes without deprecation comment, `buf lint`/`buf breaking` pass; `xstockstrat-config` (service owner) — config key/validation semantics; `xstockstrat-ui` (service owner) — config-ui rendering of the new value type

**Codebase Evidence**:
- `enum ValueType` currently has only `VALUE_TYPE_UNSPECIFIED = 0` and `VALUE_TYPE_FLOAT_MAP = 1`: `packages/proto/config/v1/config.proto:80-83`. Confirmed via Read.
- `message ValidationRule { ValueType value_type = 1; float min_value = 2; float max_value = 3; }` with a doc-comment describing FLOAT_MAP semantics: `config.proto:85-92`.
- `ConfigValue.float_val` is oneof field 3 (`config.proto:64`); `ConfigKeyMeta.validation` is field 8, `current_value` field 9 (`:155,158`).

**TDD**: `N/A (proto — non-code-bearing; behavior proven by the config-service test in Step 7)`

**Covers**: `—`

**Instructions**:
1. Add `VALUE_TYPE_FLOAT_SCALAR = 2;` to `enum ValueType` (`config.proto:80-83`) — additive → non-breaking. Do **not** renumber or remove `VALUE_TYPE_FLOAT_MAP = 1`.
2. Mark the map member `VALUE_TYPE_FLOAT_MAP = 1 [deprecated = true];` (its code path is removed by Step 6; the member stays for enum stability so `buf breaking` passes and old wire values still decode).
3. Extend the `ValidationRule` doc-comment (`config.proto:85-87`): mark the FLOAT_MAP sentence deprecated and add scalar semantics — "when `value_type == VALUE_TYPE_FLOAT_SCALAR`, the scalar `float_val` (oneof) must satisfy `[min_value, max_value]`; a write outside the bound is rejected `INVALID_ARGUMENT` at the config service's `SetConfig` write path." (C-04: no comment describes non-executing validation.)

**Verification**:
- `cd packages/proto && buf lint && buf breaking --against ".git#branch=feature/surface-signal-weight-decay-config"` — both pass (additive enum value is non-breaking).

---

### Step 4 — proto-gen: Regenerate stubs

**Status**: `pending`
**Service**: `packages/proto`
**Files**:
- `packages/proto/gen/**` — modify (generated — do not hand-edit)

**Reviewers**: Proto Reviewer — field number uniqueness, no breaking changes without deprecation comment, `buf lint`/`buf breaking` pass; `xstockstrat-config` (service owner); `xstockstrat-ui` (service owner) _(inherited from Step 3)_

**Codebase Evidence**:
- Codegen entry point: `./scripts/buf-gen.sh` (root `CLAUDE.md` § Generating Proto Stubs — generates TS/Python/Go stubs and compiles the TS package; CI `proto-freshness` enforces an empty `git diff packages/proto/gen/` afterward).
- Config-ui consumes the TS `ValueType` enum (`buf.gen.yaml stringEnums=true` → string enum constants, e.g. `'VALUE_TYPE_FLOAT_SCALAR'`, per `listKeysWire.test.ts:4-8`).

**TDD**: `N/A (proto-gen — mechanical codegen)`

**Covers**: `—`

**Instructions**:
1. Run `./scripts/buf-gen.sh` from repo root.
2. Stage the regenerated `packages/proto/gen/` output. Do not hand-edit generated files.

**Verification**:
- `./scripts/buf-gen.sh && git diff --exit-code packages/proto/gen/` after staging — the second run leaves no diff (matches the CI `proto-freshness` gate).
- `grep -rn "VALUE_TYPE_FLOAT_SCALAR" packages/proto/gen/ts packages/proto/gen/python` — confirm the new enum member is present in the generated TS + Python stubs.

---

### Step 5 — migration: Config — register the decay key (019); remove the dead source-weights key (020)

**Status**: `pending`
**Service**: `xstockstrat-config`
**Files**:
- `services/xstockstrat-config/migrations/019_register_analysis_signal_decay_half_life.up.sql` — create
- `services/xstockstrat-config/migrations/019_register_analysis_signal_decay_half_life.down.sql` — create
- `services/xstockstrat-config/migrations/020_remove_analysis_signal_source_weights.up.sql` — create
- `services/xstockstrat-config/migrations/020_remove_analysis_signal_source_weights.down.sql` — create

**Reviewers**: DBA — migration NNN numbering (no gaps/conflicts), up+down pair present, run-order compliance; `xstockstrat-config` (service owner) — config key naming (`<service>.<category>.<key>`), environment/global-per-user scoping

**Codebase Evidence**:
- Last migration is `018_notify_fanout` — confirmed **local and across all origin heads** via `ls services/xstockstrat-config/migrations/` and a `git ls-tree` sweep over every `git ls-remote --heads origin` branch (both max at `018`). Next free: **019**, then **020** (open-thread resolved: numbering re-scanned at spec time, fails.md 2026-07-29/081).
- Post-147 INSERT column layout to copy: `config.config_values (namespace, key, value_type, value_data, is_secret, description, default_value, consuming_service, environment, user_id)` with conflict target `(namespace, key, environment, COALESCE(user_id,''))`, `environment IN ('staging','production')` — established by migration 017 (recon.md; `017_config_secrets_and_scoping.up.sql`). Do **not** use the pre-147 `(…, trading_mode)` shape from migration 003.
- Dead-key original INSERT (for the 020 down-restore): `003_analysis_signal_source_weights.up.sql` — `value_type='string'`, `value_data='{}'`, two rows (`dev`+`production`, pre-147 columns). Its live description was reworded "SUPERSEDED…" by `016_deprecate_analysis_signal_source_weights_desc.up.sql:9-13` — the down-restore should re-insert with the **016-reworded** description and post-147 columns (`environment='staging'` replacing the old `'dev'`, `user_id` NULL).
- Analysis reads the decay key with a `24.0` default: `services/xstockstrat-analysis/app/handlers/servicer.py:3057-3059` (`get_float_present("analysis.scoring.signal_decay_half_life_hours", 24.0)`) — the registered default must match `24.0` (product-spec Out of Scope: do not change the default).

**TDD**: `N/A (migration — offline structural verification only; the live apply/rollback runs in CI/deploy against the managed DB)`

**Covers**: `AC-8` (partial — terminal DB state proven at deploy)

**Instructions**:
1. **019 up:** `INSERT INTO config.config_values (namespace, key, value_type, value_data, is_secret, description, default_value, consuming_service, environment, user_id) VALUES` two rows — `('analysis', 'scoring.signal_decay_half_life_hours', 'float', '24.0', false, '<operator guidance>', '24.0', 'xstockstrat-analysis', 'staging', NULL)` and the same with `environment='production'`. The description carries operator guidance: exponential age-decay half-life in hours for a signal's contribution to the Opportunities queue; `0` disables decay; bounds `[0, 8760]` (8760h = 1yr, a unit-typo guard); server-enforced at `SetConfig`. Use `ON CONFLICT (namespace, key, environment, COALESCE(user_id,'')) DO NOTHING` (idempotent). Note: the key path is `scoring.signal_decay_half_life_hours` under namespace `analysis` (the analysis reader uses the full `analysis.scoring.signal_decay_half_life_hours`; the `namespace` column is `analysis`, the `key` column is `scoring.signal_decay_half_life_hours` — mirror the 003 split where namespace=`analysis`, key=`signals.source_weights`).
2. **019 down:** `DELETE FROM config.config_values WHERE namespace='analysis' AND key='scoring.signal_decay_half_life_hours' AND user_id IS NULL AND environment IN ('staging','production')` — deletes only the two global rows 019 inserted (never a per-user override).
3. **020 up:** `DELETE FROM config.config_values WHERE namespace='analysis' AND key='signals.source_weights'` (removes both env rows of the dead key).
4. **020 down:** re-`INSERT` both `staging`+`production` rows with post-147 columns — `value_type='string'`, `value_data='{}'`, `is_secret=false`, the **016-reworded** "SUPERSEDED (feature 134)…" description, `default_value='{}'`, `consuming_service='xstockstrat-analysis'`, `user_id NULL`, `ON CONFLICT … DO NOTHING`. Add a SQL comment that this down clobbers any live operator edit to `value_data` (inherent to a hardcoded down-migration; nothing reads the key, so runtime impact is nil — design.md Open Risk).

**Verification** (offline, no DB — mirrors the execute loop's HARD CONSTRAINT):
- `ls services/xstockstrat-config/migrations/019_*.up.sql services/xstockstrat-config/migrations/019_*.down.sql services/xstockstrat-config/migrations/020_*.up.sql services/xstockstrat-config/migrations/020_*.down.sql` — all four exist with the correct next `NNN`.
- Read all four: confirm 019 down `DELETE`s exactly what 019 up `INSERT`s (the two global decay rows), and 020 down re-`INSERT`s exactly what 020 up `DELETE`s (both dead-key rows) — each up operation has an inverse in its down by inspection.

---

### Step 6 — service: Config — enforce decay scalar bounds at `setConfig`; emit `FLOAT_SCALAR` validation; remove orphaned FLOAT_MAP machinery

**Status**: `pending`
**Service**: `xstockstrat-config`
**Files**:
- `services/xstockstrat-config/src/grpc/configServiceImpl.ts` — modify

**Reviewers**: `xstockstrat-config` (service owner) — config key naming (`<service>.<category>.<key>`), environment/global-per-user scoping, secret encryption + redaction, WatchConfig stream stability

**Codebase Evidence**:
- `WEIGHT_KEY_REGISTRY` — sole entry is the deleted key: `configServiceImpl.ts:108-112` (`'analysis.signals.source_weights': { minValue: 0.0, maxValue: 1.0 }`).
- `setConfig` write path: `configServiceImpl.ts:335`. The sibling closed-enum guard (the pattern to mirror for a value guard) is the `platform.trading_state` check at `:383-394` (`code: 3 // INVALID_ARGUMENT`). Value extraction/persist begins at `:451` (`extractValueData(value)`).
- `extractValueData(v)` reads the value across **all** oneof shapes with `??` chaining — `string_val ?? stringVal ?? int_val ?? … ?? float_val ?? …`: `configServiceImpl.ts:574-585`. For a `float_val` of `0`, `?? ` correctly yields `0` → `String(0) === '0'` (no zero-trap). This is the all-shape parser the design mandates (round-3 fail-open catch: the string-only `trading_state` read at `:385` would coerce the agent's `float_val` write to `''`→`0`→pass — do **not** mirror it).
- Agent sends the decay value as `float_val`: recon.md (`client.py` config write uses `float_val`), so the bounds parse must not be string-only.
- `listKeys` emits `validation` **only** for `WEIGHT_KEY_REGISTRY` keys, hardcoded to `ValueType.VALUE_TYPE_FLOAT_MAP`: `configServiceImpl.ts:507-530` (branch at `:508`, emit at `:523-529`).
- `ValueType` imported from generated stubs (regenerated in Step 4 to include `VALUE_TYPE_FLOAT_SCALAR`).

**TDD**: `red-green required`

**Covers**: `—` (paired test is Step 7)

**Instructions**:
1. Replace `WEIGHT_KEY_REGISTRY` (`:108-112`) with `const SCALAR_BOUNDS_REGISTRY: Record<string, { minValue: number; maxValue: number }> = { 'analysis.scoring.signal_decay_half_life_hours': { minValue: 0, maxValue: 8760 } };`. (The old registry's sole key is deleted by migration 020 — leaving it would be live-but-zero-coverage code per operator Fork-2, design.md §5.)
2. **Server-side bounds enforcement in `setConfig`:** after the `platform.trading_state` guard block (`:394`) and before persist, add a parallel guard — when `SCALAR_BOUNDS_REGISTRY[\`${namespace}.${key}\`]` exists (note: the registry key is the full `analysis.scoring.signal_decay_half_life_hours`; `namespace='analysis'`, `key='scoring.signal_decay_half_life_hours'`, so index with the concatenation), parse the value via `Number(extractValueData(value))` (the all-oneof-shape parser at `:574`), and reject `callback({ code: 3, message: '<key> must be a number in [0, 8760] (got: …)' }); return;` when `Number.isNaN(n) || n < minValue || n > maxValue`. `0` is valid (min inclusive) — never a `!n` / falsy zero-trap. This is the authoritative enforcement point closing the agent `set_config` + direct `SetConfig` fail-open window (design.md §4, C-10(c)).
3. **`listKeys` validation emission** (`:507-530`): rename the lookup to `SCALAR_BOUNDS_REGISTRY[r.key]` and emit `validation: { valueType: ValueType.VALUE_TYPE_FLOAT_SCALAR, minValue, maxValue }` for matching keys. Remove the `VALUE_TYPE_FLOAT_MAP` emission entirely.
4. Remove any now-dead FLOAT_MAP-only helper/branch left unreferenced after steps 1 and 3 (design.md §5: remove the machinery cleanly, code + tests together; the proto `VALUE_TYPE_FLOAT_MAP` member stays, `[deprecated]`, from Step 3).

**Verification**:
- `grep -n "WEIGHT_KEY_REGISTRY\|SCALAR_BOUNDS_REGISTRY\|VALUE_TYPE_FLOAT_MAP\|VALUE_TYPE_FLOAT_SCALAR" services/xstockstrat-config/src/grpc/configServiceImpl.ts` — confirm `WEIGHT_KEY_REGISTRY`/`VALUE_TYPE_FLOAT_MAP` are gone from this file and `SCALAR_BOUNDS_REGISTRY`/`VALUE_TYPE_FLOAT_SCALAR` are present.
- Lint: `cd services/xstockstrat-config && pnpm run lint`
- Behavioral verification is in the paired Step 7.

---

### Step 7 — test: Config — scalar validation wire contract + `setConfig` bounds rejection + dead-key assertion rework

**Status**: `pending`
**Service**: `xstockstrat-config`
**Files**:
- `services/xstockstrat-config/src/__tests__/listKeysWire.test.ts` — modify
- `services/xstockstrat-config/src/__tests__/configServiceImpl.test.ts` — modify
- `services/xstockstrat-config/src/__tests__/setConfigScalarBounds.test.ts` — create

**Reviewers**: `xstockstrat-config` (service owner) — config key naming, environment/global-per-user scoping, secret encryption + redaction, WatchConfig stream stability

**Codebase Evidence**:
- `listKeysWire.test.ts` asserts the dead key with `validation.valueType === 'VALUE_TYPE_FLOAT_MAP'` over a **real gRPC connection** with a mocked pool (`{ query: async () => ({ rows }) }`): `listKeysWire.test.ts:40-47` (fixture row), `:117` (assert). The real-connection harness (`before`/`after` at `:24-`, mocked pool at `:49-`) is offline-runnable (no DB).
- `configServiceImpl.test.ts` has `it('populates validation for analysis.signals.source_weights', …)` asserting `validation.valueType === 'VALUE_TYPE_FLOAT_MAP'`: `:40-66`.
- fails.md 2026-07-29/074: a config test suite that wraps imports in silent `try/catch` reported pass with zero assertions — ensure the new test's cases actually execute (assert non-zero, or watch one go red before green).

**TDD**: `red-green required`

**Covers**: `AC-6, AC-7, AC-8, AC-11, AC-12`

**Instructions**:
1. **`listKeysWire.test.ts` (AC-6, AC-8):** replace the `analysis.signals.source_weights` fixture row (`:40-47`) and its `VALUE_TYPE_FLOAT_MAP` assertion (`:117`) with the decay key — a fixture row `{ key: 'scoring.signal_decay_half_life_hours', namespace 'analysis', value_data '24.0', value_type 'float', … }` and assert `validation.valueType === 'VALUE_TYPE_FLOAT_SCALAR'`, `validation.minValue === 0`, `validation.maxValue === 8760`, `defaultValue === '24.0'`, and a non-empty operator-guidance `description` (AC-6). Add an assertion that no returned key equals `analysis.signals.source_weights` (AC-8 — dead key no longer emits validation/isn't in the scalar registry).
2. **`configServiceImpl.test.ts`:** rewrite the `:40-66` test to assert `listKeys` populates `validation.valueType === 'VALUE_TYPE_FLOAT_SCALAR'` (min 0, max 8760) for the decay key and emits **no** `validation` for `analysis.signals.source_weights` (the FLOAT_MAP branch is removed).
3. **`setConfigScalarBounds.test.ts` (new — AC-7, AC-11, AC-12):** using the same mocked-pool + real-connection (or direct-servicer) harness shape, drive `setConfig` for `analysis.scoring.signal_decay_half_life_hours` with an admin-scoped call (mirror the auth metadata other setConfig tests use):
   - **AC-7:** `float_val: 0` with a reason, `create_key` **false**, against a pool whose existence query returns a registered row → `callback(null, …)` success (0 is valid, min inclusive; no zero-trap). Assert the persist path ran (INSERT/UPDATE invoked).
   - **AC-11:** `float_val: 9000` → `callback({ code: 3 })` (INVALID_ARGUMENT) and **no** persist query issued.
   - **AC-12:** `float_val: -1` → `code: 3`, no persist; and a non-numeric write (e.g. `string_val: 'abc'`) → `code: 3`, no persist.
   - Guard against the fails.md-074 silent-skip: assert a positive success case AND a rejection case so a broken harness cannot pass with zero real assertions.

**Verification**:
- `cd services/xstockstrat-config && pnpm run lint && pnpm run test:coverage` — the new/updated cases pass and the ≥40% threshold holds. Confirm the bounds-rejection cases fail against the pre-Step-6 tree (no `SCALAR_BOUNDS_REGISTRY` enforcement), then pass after (TDD gate).

---

### Step 8 — service: config-ui — `reliability_weight` field + guidance on the Signal Sources create/edit form and inline editor

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/app/config-ui/sources/page.tsx` — modify

**Reviewers**: `xstockstrat-ui` (service owner) — config mutation safety, Connect-RPC call safety, no secret values rendered, environment scope correctness

**Codebase Evidence**:
- `FormState` interface (no `reliabilityWeight`): `sources/page.tsx:49-62`; `EMPTY_FORM`: `:64-` (defaults block).
- `formFromSource` maps a `SignalSource` → `FormState`: `:146-164` (no weight mapping).
- `handleSave` builds the `source` payload + derives the update `updateMask.paths` (`display_name`, `source_type`, `extractor_module`, `config_json`, conditional `credentials_ref`): `:235-273`.
- Inline weight editor + `saveWeight` `[0,1]` validation shape to reuse: `:185-203` (bespoke scalar `Number()` check, `parsed < 0 || parsed > 1`), render at `:329-365` (the `weight` column; edit block `:335-354`, display button `:355-364`). Only `aria-label` — **no guidance text**.
- Mutation already accepts `reliabilityWeight` + `updateMask.paths:['reliability_weight']` (the inline editor uses it): `:195-196`.
- Guidance-text pattern to reuse (secret-field help): `NamespaceEditor.tsx:160-165` (`<p className="text-muted-foreground text-xs mt-0.5">…</p>`). Form label pattern: `sources/page.tsx` form card (`:462-630` per recon).
- C-17: reuse the existing `Input`/`Button` primitives and design-role tokens (`text-muted-foreground`, `text-destructive`) already used on this page — no hardcoded colors, no new primitive.

**TDD**: `red-green required` (paired e2e is Step 9)

**Covers**: `—`

**Instructions**:
1. Add `reliabilityWeight: string` to `FormState` (`:49-62`) and `reliabilityWeight: '1'` to `EMPTY_FORM` (default 1.0, FR-3). In `formFromSource` (`:146-164`), add `reliabilityWeight: String(src.reliabilityWeight ?? 1.0)`.
2. Add a numeric form field (`Input type="number" step="0.1" min={0} max={1}`) bound to `form.reliabilityWeight` via `setField('reliabilityWeight', …)` in the create/edit modal card, with a unique accessible label (e.g. `aria-label="Reliability weight"`). Directly below it render guidance `<p className="text-muted-foreground text-xs mt-0.5">Ranking multiplier in [0, 1] (default 1.0). Higher = this source's signals rank higher; 0 = ignore this source.</p>` (FR-3 guidance).
3. In `handleSave` (`:235-273`): validate `form.reliabilityWeight` with the `saveWeight` `[0,1]` shape (`Number(...)`, reject NaN / `<0` / `>1` by setting `saveError` and returning). Add `reliabilityWeight: Number(form.reliabilityWeight)` to the `source` payload (`:240-247`). On the **update** branch, append `'reliability_weight'` to `updateMask.paths` (`:259-267`) so an edit persists the weight; on **register** it rides in the source (the backend applies field 12).
4. **Inline editor guidance (FR-4):** in the `weight` column edit block (`:335-354`), add the same guidance `<p className="text-muted-foreground text-xs mt-0.5">…[0,1], default 1.0…</p>` near the inline `Input`, explaining the weight's meaning and its `[0,1]` / default-1.0 semantics.

**Verification**:
- `grep -n "reliabilityWeight\|Reliability weight\|text-muted-foreground text-xs" services/xstockstrat-ui/src/app/config-ui/sources/page.tsx` — confirm the field, the two guidance blocks (form + inline), the `formFromSource` mapping, and the `handleSave` payload/mask.
- Lint: `cd services/xstockstrat-ui && pnpm run lint`
- Behavioral e2e is Step 9.

---

### Step 9 — test: config-ui — e2e for the reliability_weight form field + inline-editor guidance

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/e2e/config-ui/sources.spec.ts` — modify (or the existing Signal Sources spec; create if absent)
- `services/xstockstrat-ui/e2e/mock-backend.ts` — modify (only if the `ManageSignalSource` mock must echo `reliabilityWeight`)

**Reviewers**: `xstockstrat-ui` (service owner) — config mutation safety, Connect-RPC call safety, no secret values rendered, environment scope correctness

**Codebase Evidence**:
- Signal-source e2e + fixtures home (C-12): `services/xstockstrat-ui/e2e/fixtures/` + `INVENTORY.md`; auth helpers `e2e/helpers/auth.ts` (`addAdminCookie` etc.). The config-ui writes are admin-gated (recon `@AC-9` preserve) — specs must use the admin cookie helper.
- Inline editor exposes `data-testid={\`weight-${src.slug}\`}` (display) — `sources/page.tsx:359` — a stable e2e locator.
- Mock backend: `e2e/mock-backend.ts` handles the config-ui `ManageSignalSource`/`ListSignalSources` RPCs (per recon frontend map).

**TDD**: `red-green required`

**Covers**: `AC-4, AC-5`

**Instructions**:
1. **AC-4:** open the Signal Sources create form (admin cookie), fill slug `insider-buys`, the required source fields, and `reliability_weight` `0.6`, submit; assert the `ManageSignalSource` register call carried `reliabilityWeight === 0.6` (via the mock's captured request) and that the form shows the plain-language guidance text describing the weight and its 0–1 range.
2. **AC-5:** view the Sources table with a source `sec-form4`, open its inline weight editor (`data-testid="weight-sec-form4"`), assert the guidance text describing the weight's meaning and its `[0,1]` / default-1.0 semantics is shown.
3. Reuse `e2e/fixtures/` signal-source fixtures and `e2e/helpers/auth.ts` (C-12) — no inline domain literals. If the `ManageSignalSource` mock does not already echo `reliabilityWeight`, extend it in `mock-backend.ts` (scenario wiring) and note it in `INVENTORY.md` only if a new fixture is added.

**Verification**:
- `cd services/xstockstrat-ui && pnpm run lint && pnpm test:e2e -g "reliability"` (or the sources spec title) — the two scenarios pass; confirm they fail against the pre-Step-8 tree (no form field / no guidance).
- `grep -n "from '../fixtures'\|from './fixtures'\|helpers/auth" services/xstockstrat-ui/e2e/config-ui/sources.spec.ts` — confirm fixture/auth imports (no inline literals; C-12).

---

### Step 10 — service: config-ui — scalar validation in NamespaceEditor; remove the dead FLOAT_MAP path

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/app/config-ui/[namespace]/NamespaceEditor.tsx` — modify

**Reviewers**: `xstockstrat-ui` (service owner) — config mutation safety, Connect-RPC call safety, no secret values rendered, environment scope correctness

**Codebase Evidence**:
- `validateFloatMap(json, min, max)` (the map-JSON validator, now dead once the FLOAT_MAP key is gone): `NamespaceEditor.tsx:31`. Its call sites gate on `meta.validation.valueType === 1` (numeric FLOAT_MAP): `:95-99` (save guard) and `:152-154` (onChange).
- `validation?: { valueType: number; minValue: number; maxValue: number }` on the key meta type: `:84`.
- Description rendered from server `ListKeys` meta: `:184-186` (`accessorKey: 'description'`). So the decay key's guidance description auto-renders once registered — no per-key UI code.
- Secret-help guidance pattern (already used here): `:160-165`.
- After Step 4, the browser `ValueType` stub carries `VALUE_TYPE_FLOAT_SCALAR` (string-enum `stringEnums=true`; numeric member `2`).

**TDD**: `red-green required` (paired e2e is Step 11)

**Covers**: `—`

**Instructions**:
1. Add a scalar pre-validation branch for `valueType === VALUE_TYPE_FLOAT_SCALAR` (numeric `2`): validate a single numeric `editValue` against `[minValue, maxValue]` (reuse the `saveWeight`-style `Number()` + `<min || >max` shape; `0` valid), setting `validationError` and blocking the `SetConfig` call on failure — mirroring the existing FLOAT_MAP guard placement at `:95-99` and `:152-154`. Show a bounds hint (`[min, max]`) near the input. **UX only; the server (Step 6) is authoritative** (design.md §6).
2. Remove the now-dead `validateFloatMap` path: delete the `valueType === 1` (FLOAT_MAP) branches at `:95-99` and `:152-154` and the `validateFloatMap` function (`:31`) if it has no remaining consumer. (Fork-2: remove the machinery with its key, don't leave it dormant.)
3. The decay key's description + `VALUE_TYPE_FLOAT_SCALAR` validation flow through the existing generic renderer (`:184-186` description; `:84` validation meta) — no per-key wiring.

**Verification**:
- `grep -n "validateFloatMap\|VALUE_TYPE_FLOAT_MAP\|valueType === 1\|VALUE_TYPE_FLOAT_SCALAR" services/xstockstrat-ui/src/app/config-ui/[namespace]/NamespaceEditor.tsx` — confirm the FLOAT_MAP path is gone and the scalar branch is present.
- Lint: `cd services/xstockstrat-ui && pnpm run lint`
- e2e is Step 11.

---

### Step 11 — test: config-ui — e2e for the scalar-validated decay key; rework FLOAT_MAP fixtures/specs

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/e2e/fixtures/configKeys.ts` — modify
- `services/xstockstrat-ui/e2e/config-ui/api-smoke.spec.ts` — modify
- `services/xstockstrat-ui/e2e/config-ui/audit.spec.ts` — modify
- `services/xstockstrat-ui/e2e/config-ui/value-persists-after-save.spec.ts` — modify

**Reviewers**: `xstockstrat-ui` (service owner) — config mutation safety, Connect-RPC call safety, no secret values rendered, environment scope correctness

**Codebase Evidence**:
- Fixture asserts the dead key with `validation: { valueType: 1, minValue: 0.0, maxValue: 1.0 }`: `e2e/fixtures/configKeys.ts:84,91`.
- e2e specs that name the dead key / FLOAT_MAP: `api-smoke.spec.ts:225` (`'weight key has validation.valueType=VALUE_TYPE_FLOAT_MAP…'`), `:237` (finds `analysis.signals.source_weights`), `:243` (`expect(v.valueType).toBe('VALUE_TYPE_FLOAT_MAP')`); `audit.spec.ts:25` (`key: 'signals.source_weights'`); `value-persists-after-save.spec.ts:16` (comment referencing the dead key).

**TDD**: `red-green required`

**Covers**: `AC-6` (config-ui rendering half — the wire contract half is Step 7)

**Instructions**:
1. In `e2e/fixtures/configKeys.ts:84-91`, replace the `analysis.signals.source_weights` FLOAT_MAP fixture with the decay key `analysis.scoring.signal_decay_half_life_hours` — `validation: { valueType: <VALUE_TYPE_FLOAT_SCALAR>, minValue: 0, maxValue: 8760 }`, `default_value: '24.0'`, an operator-guidance `description` (C-13: shape follows the wire — string-enum in the mock). Update `INVENTORY.md` if the fixture symbol name changes.
2. Rework `api-smoke.spec.ts:225-243`: assert the decay key's `validation.valueType === 'VALUE_TYPE_FLOAT_SCALAR'` with `minValue 0`/`maxValue 8760` (AC-6 rendering), and that no key equals `analysis.signals.source_weights` (AC-8, UI side).
3. Update `audit.spec.ts:25` and `value-persists-after-save.spec.ts:16` to stop referencing the removed key (point at the decay key or another live key as appropriate).

**Verification**:
- `cd services/xstockstrat-ui && pnpm run lint && pnpm test:e2e -g "config"` (config-ui specs) — pass; confirm the FLOAT_MAP assertion failed against the pre-Step-6/10 tree and the scalar assertion passes after.
- `grep -rn "source_weights\|VALUE_TYPE_FLOAT_MAP" services/xstockstrat-ui/e2e/` — returns nothing (all references reworked to the scalar decay key).

---

### Step 12 — docs: Update dead-key + decay-key references; context-scrubber scan

**Status**: `pending`
**Service**: `docs/` + `services/xstockstrat-analysis/`
**Files**:
- `services/xstockstrat-analysis/CLAUDE.md` — modify
- `docs/patterns/config-governance.md` — modify

**Reviewers**: None _(docs category)_

**Codebase Evidence**:
- Analysis `CLAUDE.md` Config Keys table has both the decay-key row (`analysis.scoring.signal_decay_half_life_hours`) and the dead-key row (`analysis.signals.source_weights`, "Superseded (feature 134) — retained but no longer read"): confirmed via `sed -n '295,305p'`. The decay-key row's guidance still says "Set to `0` (or negative) to disable" — with server `min=0`, negative is no longer settable via `SetConfig` (analysis still tolerates it defensively at `servicer.py:3248`).
- `config-governance.md` references the dead key at `:320` (feature-134 superseded note) and has a `## Per-Feature Registered Keys` append-only log at `:101-103` (newest first).

**TDD**: `N/A (docs — no behavior change)`

**Covers**: `—`

**Instructions**:
1. **Analysis `CLAUDE.md`:** remove (or mark removed) the `analysis.signals.source_weights` row; update the `analysis.scoring.signal_decay_half_life_hours` row to note the key is now **registered** (config migration 019) with **server-enforced bounds `[0, 8760]`**, and drop the now-false "set 0 **or negative** to disable" (negative is unsettable via `SetConfig`; `0` disables; analysis still tolerates negative defensively).
2. **`config-governance.md`:** update the `:320` dead-key superseded note to state the key was **removed** (feature 161, migration 020); add a new **Per-Feature Registered Keys** entry (newest-first, at `:105`) for feature 161 — registers `analysis.scoring.signal_decay_half_life_hours` (float, default 24.0, server-enforced `[0, 8760]`), removes `analysis.signals.source_weights`, and notes the additive `config.v1.ValueType.VALUE_TYPE_FLOAT_SCALAR`.
3. Run `/context-scrubber scan` scoped to the touched context files (per root `CLAUDE.md` Teardown); fix grounded findings. If the context-forge plugin is unavailable in the session, say so in the PR body rather than skipping silently.

**Verification**:
- `grep -rn "source_weights" services/xstockstrat-analysis/CLAUDE.md docs/patterns/config-governance.md` — remaining references are removal/history notes only, none implying the key is live.
- `grep -n "signal_decay_half_life_hours" docs/patterns/config-governance.md` — the Per-Feature Registered Keys log names it as registered by feature 161.

---

## Deviation Log

_Populated by /sdd-execute as implementation proceeds._

- **2026-08-26 — execution model (process deviation):** implemented directly on the harness-assigned
  branch `claude/signal-weights-decays-5h6rje` (one integration PR to `main-dev`), NOT via
  `/sdd-execute`'s per-step feature-branch/PR machinery — the harness pins this session to that single
  branch. TDD red-before-green still applied per step where a test suite is runnable in-session.
- **2026-08-26 — Step 1/2 (agent) done, green:** 298 agent tests pass (incl. new
  `test_signal_source_reliability_weight.py` + sharpened `test_signal_source_builder.py` source-parity);
  ruff clean; coverage 76.6% (gate 40). RED confirmed: the two new tests fail against the pre-Step-1
  tree. Also updated the stale `_SOURCES` fixture in `test_tools.py` to carry `reliability_weight`
  (the real client projection always includes it).
