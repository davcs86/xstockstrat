# Recon: strategy-partial-update

**Created**: 2026-07-26
**From**: product-spec.md
**Affected services**: xstockstrat-analysis, xstockstrat-agent, xstockstrat-ui, packages/proto

---

## Objective

Make `ManageStrategy` UPDATE a **partial merge** instead of a destructive full-replace, validate the
**merged** result so a rule can never be orphaned, and expose the already-shipped `GetStrategy` RPC as
an MCP tool. The incident: sending only `cooldown_days` wiped a strategy's components and rules.

## Codebase Map

- **`xstockstrat-analysis`** (Python 3.12)
  - `ManageStrategy` handler: `app/handlers/servicer.py:1350-1408`
    - admin gate `:1352` (`_has_admin_scope`, `:126-138`, `int(x-access-scope) & 0x04`)
    - REGISTER `:1362-1370`; **UPDATE `:1371-1378`** (validates the *request*, `MessageToDict` whole,
      `strategies_repo.update(strategy_id, display_name, definition_json)`); DEACTIVATE `:1399-1407`
      (**no validation**); unknown op `:1408`
  - `GetStrategy` handler: `servicer.py:1410-1420` — **no admin gate** (contrast `SetStrategyLive`
    `:1437`)
  - `_row_to_strategy_definition`: `servicer.py:1812-1824` — `ParseDict(definition_json, …)` then
    overlays 4 **column-authoritative** fields (`strategy_id`, `display_name`, `active`,
    `live_enabled`, `:1818-1823`). Everything else (`components`, `entry_rule`, `exit_rule`,
    `signal_params`, `cooldown_days`) lives **only** inside `definition_json`.
  - Repository: `app/repositories/strategies.py`
    - `update` `:54-68` — `SET display_name = $2, definition_json = $3::jsonb, updated_at = NOW()`.
      **Only those two columns.** Serializes via
      `json.dumps(dict(definition_json) if definition_json else {})` (`:66`) — an empty dict wipes the
      column to `{}`.
    - `create` `:33-45`, `get_by_id` `:47-52`, `set_live_enabled` `:70-81`, `deactivate` `:83-93`,
      `list` `:95-109`, `_to_dict` `:14-24`
  - Table: `migrations/001_strategies.up.sql:1-10` (6 cols) + `002_strategy_live_enabled.up.sql:1`
  - Last migration `009_strategy_cooldowns` → next free **`010`** (none needed)
  - Validation: `_validate_definition_proto` `servicer.py:165-176`; `_fetch_formula_outputs`
    `:140-163`; `_validate_definition` `app/services/evaluator.py:276-323`
    (empty-rule short-circuit `:317-318`; `_validate_rule_refs` `:319-323`; `_validate_term_ref` `:326`)
  - Feature-065 recompute after UPDATE: `servicer.py:1385-1398`; `_lock_for` `:1086-1092`;
    `_recompute_headline_locked` `:1160-1177`; `_fetch_and_aggregate` `:1132-1143`;
    `_definition_fingerprint` `:1775-1791`; `_FINGERPRINT_EXCLUDED_KEYS` `:1772`
    (`display_name`, `active`, `live_enabled`)
  - Second consumer of `_row_to_strategy_definition`: `app/engine/live_loop.py:94`
  - Tests: `tests/test_analysis_servicer.py` — `TestManageStrategy` `:577`
    (`test_update_path` `:607` asserts **only** `display_name`), `TestGetStrategy` `:633`,
    `TestHeadlineTriggers` `:1727`, cooldown validation `:2302`/`:2319`; helpers `_valid_definition`
    `:543`, `_row_for` `:560`, `_admin_ctx` `:569`, `_update_req` `:1707`, `_updated_row` `:1717`.
    `tests/test_strategy_evaluator.py:48` — `TestValidateDefinition`.

- **`xstockstrat-agent`** (Python 3.12)
  - `manage_strategy` tool: `app/tools.py:289-354` — signature/defaults `:289-299`;
    **fabrication site `:338-344`**; truthy-gated `signal_params` `:345-346`; **`is not None`
    precedent `:347-350`**; error wrapper `:351-354`; `_grpc_error_message` `:34-45`
  - `client.manage_strategy`: `app/client.py:248-308` — builds the proto **field-by-field, not
    `ParseDict`**; components loop `:268-281`; **`pb_def` with `.get(…, "")` defaults `:283-293`**;
    `signal_params` truthy-gated `:294-298`; `_admin_metadata()` `:300-308`
  - `client.get_strategy`: `app/client.py:311-321` — non-admin `_metadata()`; returns plain
    `MessageToDict` (**camelCase**, unlike the snake_case `preserving_proto_field_name=True` used
    elsewhere)
  - Metadata helpers: `app/client.py:24` `_metadata()`, `:30` `_admin_metadata()`
  - Thin read-tool template: `get_backfill_status` tool `app/tools.py:494-521`; one-arg analogue
    `set_strategy_live` `:446-460`; client template `app/client.py:720-781`
  - Module docstring inventory: `app/tools.py:4-18` (`Thirteen tools:` + two-space-indented
    `name <pad>— description`; padding is inconsistent — col 24 for the first 7, col 23 for the last 6)
  - Tool registrations (exactly 13): `app/tools.py:62,91,129,159,217,239,262,289,356,415,446,462,494`
  - Tests: `tests/test_tools_endpoint.py:17-37` (name-set), `:40-50` (description/inputSchema);
    `tests/test_tools.py:15-22` harness, `TestManageStrategyTool` `:334-385`, **3-case presence test
    to mirror `:353-375`**, gRPC error factory `:328-331`; `tests/test_client.py:71-75` `_channel_cm`,
    `:78-135` request capture, `:102` admin-scope assertion

- **`xstockstrat-ui`** (Next.js)
  - `StrategyWizard.tsx` — props `:56-62`; hydration `:68-93` (presence-honest cooldown seed `:72-76`);
    **`handleSubmit` always sends `components`/`entryRule`/`exitRule`/`signalParams` `:136-152`**, only
    `cooldownDays` conditionally omitted `:150-151`; mutation `:153-159`; `parseCooldownDays` `:42-54`
  - Edit page: `src/app/insights/strategies/[id]/edit/page.tsx:12-32` (admin-gated `:21`)
  - Detail page: `src/app/insights/strategies/[id]/page.tsx:41-42` — `useGetStrategy(id)` is
    **unconditional**, not behind `useIsAdmin()`
  - Hooks: `src/hooks/useStrategyDefinitions.ts:25-31` `useGetStrategy`, `:34-50` `useManageStrategy`
  - BFF: `src/lib/insightsBff.ts:42-54` `manageStrategy` (inline `requireAdminScope`), **`:55`
    `getStrategy: forward(...)` — session-only, no admin**, `:60` `setStrategyLive` `forwardAdmin`
  - E2E: `e2e/insights/strategy-authoring.spec.ts` — admin-gate tests `:31-92`, **`getStrategy is
    readable (no admin required)` `:94-107`**, `stubListFormulas` `:20-28`, **`captureManageStrategy`
    payload harness `:261-272`**, `fillToReview` `:274-296`, presence assertions `:298-362` (esp.
    `:342-362`, "editing an unset strategy on an unrelated field does not write cooldownDays")
  - Mocks: `e2e/mock-backend.ts:644-652` `manageStrategy` (echoes `req.definition`, `invalid_ref`
    sentinel), `:654-675` `getStrategy` (`strat-cooldown-14` sentinel `:673`)
  - Fixtures: `e2e/fixtures/strategies.ts:53-67` `STRATEGY_DEF_*`; `INVENTORY.md:17`, `:31`,
    **`:49` "Editable strategy components (`getStrategy`)" — listed NOT-yet-centralized**

## Patterns to REUSE

- **Omitted-vs-explicit-empty at the tool layer** → generalize the existing `cooldown_days`
  `is not None` precedent, `app/tools.py:347-350`. It exists precisely so an explicit `0` survives
  while an omitted arg is dropped — the same shape FR-6 needs for the other fields.
- **Presence-honest proto construction** → `cooldown_days=definition.get("cooldown_days")`,
  `app/client.py:292` (with the explanatory comment `:290-291`). This is the one field already doing
  the right thing; the others need the same treatment.
- **A new thin read-only MCP tool** → copy `get_backfill_status`, `app/tools.py:494-521`
  (`@server.tool()` + per-param docstring + `try` → `client.…` → `except AioRpcError` →
  `RuntimeError(_grpc_error_message(e, not_found=…))`). Non-admin, so it must use `_metadata()` —
  already true at `app/client.py:319`.
- **Tool-layer presence testing** → mirror `tests/test_tools.py:353-375` (the 3-case
  present/explicit-0/omitted table).
- **Client-layer request capture** → `tests/test_client.py:71-75` + `:78-135`, asserting with
  `HasField` (`:124-130`).
- **E2E payload capture** → `captureManageStrategy`, `e2e/insights/strategy-authoring.spec.ts:261-272`;
  and the existing negative test at `:342-362` is the exact template for "editing one field must not
  write another".
- **Column-authoritative overlay** → `_row_to_strategy_definition`, `servicer.py:1812-1824`. A merge
  must respect this split: `display_name`/`active`/`live_enabled` come from columns, the rest from
  `definition_json`.
- **Fingerprint discipline** → `_definition_fingerprint`, `servicer.py:1775-1791`. Its docstring
  (`:1778-1785`) mandates hashing a **DB-returned** `definition_json`, never a request proto dict. A
  merge must keep the hashed input a DB row.
- **Frontend fixtures (C-12)** → `e2e/fixtures/strategies.ts`, `e2e/helpers/auth.ts`. The editable
  `getStrategy` shape is inline in `mock-backend.ts:654-675` and catalogued as not-yet-centralized
  (`INVENTORY.md:49`) — touching it triggers the centralization obligation.

## Dependencies

- **Proto/RPC**: `ManageStrategyRequest` only, and only if the design picks a mask.
  `analysis.proto:255-258` → **next free field number `3`**. `StrategyOperation`
  (`analysis.proto:248-253`) highest = `3` → **next free enum value `4`** if a `PATCH` op is chosen.
  `GetStrategy`/`GetStrategyRequest` already exist (`:22-23`, `:260-262`) — re-declaring either fails
  `buf lint`. Current imports: `timestamp.proto`, `struct.proto`, `common/v1/common.proto`
  (`analysis.proto:7-9`) — **a `FieldMask` approach needs a new import**.
- **Migration**: none (next free would be `010`).
- **Config keys**: none.
- **Inter-service edges**: analysis → indicators `GetFormula` (validation, existing); agent → analysis
  `ManageStrategy`/`GetStrategy` (existing); UI BFF → analysis (existing).
- **New env vars**: none.

## Risks / Not-found

1. **[HIGH] There are THREE fabrication layers, not one.** The product spec (FR-6) names the tool
   layer (`app/tools.py:338-344`). But `client.manage_strategy` **re-fabricates** on the way to the
   proto: `app/client.py:283-293` builds `pb_def` with `display_name=…get(…, "")`,
   `entry_rule=…get(…, "")`, `exit_rule=…get(…, "")`, and `components=[]` when absent. Only
   `cooldown_days` (`:292`) is presence-honest. **Fixing `tools.py` alone changes nothing** — the
   client would re-materialise the empties. And the server (`servicer.py:1371-1378`) is the third.
   All three must change together.
2. **[HIGH] Proto3 has no field presence on the wiped fields.** `components` (repeated),
   `entry_rule`/`exit_rule` (plain `string`) cannot distinguish "omitted" from "explicitly cleared" on
   the wire; only `cooldown_days` is `optional` (`analysis.proto:245`). So a merge-by-default `update`
   **cannot** express component removal — which the StrategyWizard relies on
   (`StrategyWizard.tsx:136-152` always sends the full list, and removal works today by shrinking it).
   This is the deciding constraint for OQ-1.
3. **[MEDIUM] Fingerprint sensitivity to key presence.** `_definition_fingerprint`
   (`servicer.py:1775-1791`) hashes the JSON keys `MessageToDict` emitted. A merge that changes which
   keys are present — even with identical semantics — changes the fingerprint and therefore discards
   the feature-065 evidence base (`servicer.py:1385-1398`). OQ-2.
4. **[MEDIUM] `active=definition.get("active", True)`** (`app/client.py:288`) means every
   agent-issued UPDATE asserts `active=True` in `definition_json`. Currently benign — `strategies_repo.update`
   never writes the `active` column (`strategies.py:54-68`) and `_row_to_strategy_definition` overlays
   it from the column (`:1821`) — but it is a latent reactivation hazard if the merge ever starts
   honoring `definition_json.active`. Do not introduce that coupling.
5. **[MEDIUM] Zero existing coverage of the defect.** `test_update_path`
   (`tests/test_analysis_servicer.py:607`) asserts only the renamed `display_name`; nothing tests field
   preservation. There is also **no repository-level test file** at all
   (no `tests/test_strategies_repo.py`; the SQL is only exercised through `AsyncMock`s). A merge
   implemented in the repo layer would ship untested unless a test file is created.
6. **[LOW] `client.get_strategy` returns camelCase.** `app/client.py:311-321` uses a plain
   `MessageToDict`, while sibling wrappers use
   `preserving_proto_field_name=True, always_print_fields_with_no_presence=True` for snake_case. A new
   MCP `get_strategy` tool returning camelCase would be inconsistent with `manage_strategy`'s input
   shape (snake_case `ref_name`, `entry_rule`), making fetch→edit→resend awkward for an agent. Worth
   deciding deliberately.
7. **[LOW] DEACTIVATE performs no validation** (`servicer.py:1399-1407`) — out of scope, noted only so
   a merge refactor does not accidentally route DEACTIVATE through the new validation path.

**Not found** (never assumed):
- **`google.protobuf.FieldMask` is used nowhere** — zero hits in `services/xstockstrat-analysis`,
  `services/xstockstrat-agent`, or `packages/proto/**/*.proto`. Only the feature-070 spec docs mention
  it. Adopting it is a genuinely new dependency + proto import.
- No existing partial-update / merge / patch helper in the analysis service.
- No `ParseDict`/dict→message helper in `app/client.py` (only `MessageToDict`, imported `:12`).
- No MCP tool wrapping `client.get_strategy`; no test for `client.get_strategy` anywhere in the agent.
- No test asserting UPDATE field preservation.
- No centralized fixture for the editable strategy definition (`INVENTORY.md:49`).

## Recommended Scope

Advisory step boundaries for the grilling phase and `/sdd-spec`:

1. **Decide the merge mechanism (OQ-1)** under Risk 2 — proto3 no-presence means merge-by-default
   cannot express component removal. Options: `FieldMask update_mask` (field 3, new proto import), a
   new `STRATEGY_OPERATION_PATCH` (enum value 4) alongside a full-replace `UPDATE`, or
   merge-by-default plus an explicit clear sentinel.
2. **Server-side merge + merged-result validation** — merge against the DB row, then run the existing
   `_validate_definition` on the **merged** definition; keep the fingerprint hashing a DB-returned row.
3. **All three fabrication layers (Risk 1)** — `app/tools.py:338-344`, `app/client.py:283-293`, and the
   server. A test must prove the end-to-end MCP path (product-spec AC-1).
4. **New `get_strategy` MCP tool** — the 14th tool; update the five inventory surfaces + the
   `test_tools_endpoint.py:23-37` name set. Decide the camelCase/snake_case return shape (Risk 6).
5. **UI regression guard** — component removal must still work (product-spec AC-6); reuse
   `captureManageStrategy` (`strategy-authoring.spec.ts:261-272`).
6. **Tests** — add the missing field-preservation coverage (Risk 5) and consider the first
   repository-level test file.
