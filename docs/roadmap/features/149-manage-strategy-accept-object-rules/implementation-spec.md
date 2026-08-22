# Implementation Spec: manage-strategy-accept-object-rules

**Status**: `done`
**Created**: 2026-08-22
**Feature**: `docs/roadmap/features/149-manage-strategy-accept-object-rules/feature.md`
**Total Steps**: 3
**Feature Branch**: `feature/manage-strategy-accept-object-rules` (this harness session lands the work on the assigned `claude/register-trading-strategies-uoqhuk` branch, PR → `main-dev`, per the operator override recorded in `context.md`)

---

## Execution Summary

Single-service change in `xstockstrat-agent`, following the approved `design.md` Chosen Approach
exactly (backend contract byte-identical). **Step 1 (service)** widens the two rule annotations to
`str | dict | None` and inserts a bare-`json.dumps` dict→string coercion before the feature-070
`supplied`/`mask` build, plus the same-PR docstring wording change. **Step 2 (docs)** updates the
other two F-12 mirror surfaces (`docs/runbooks/mcp-tools.md` + the `strat-lab` `backtest` skill) so
all three describe "string or object". **Step 3 (test)** is the paired unit-test step covering every
`@AC-*` scenario — behavioral assertions on the outbound `definition`/`update_mask`, a
schema-boundary assertion on the published tool `inputSchema`, and a docs-consistency assertion
across the three surfaces. Docs (Step 2) is sequenced before the test (Step 3) so the `@AC-5`
docs-consistency assertion has all three surfaces present when it runs.

**Scenario coverage** (Constitution C-15 — every `@AC-*` maps to a step's `**Covers**`):

- `@AC-1` (object → JSON string) → **Step 3**
- `@AC-2` (string passes through byte-for-byte) → **Step 3**
- `@AC-3` (omitted rule left out of definition + mask) → **Step 3**
- `@AC-4` (both rules as objects, each serialized) → **Step 3**
- `@AC-5` (all three doc surfaces state string-or-object) → **Step 3** (asserts wording produced by Step 1 docstring + Step 2 docs)
- `@AC-6` (empty object `{}` → `"{}"`, enters mask) → **Step 3**

**Consumer surface (C-14):** the product spec names one surface — the `manage_strategy` MCP tool in
`xstockstrat-agent` — landed directly by Step 1. No UI surface (product spec § Consumer Surface(s)
marks UI "none"), so no `services/xstockstrat-ui/` step is required — a decision, not an omission.

## Step Dependencies

- **Step 2 (docs)** requires **Step 1 (service)**: the docstring wording (Step 1) and the runbook/skill
  wording (Step 2) are the F-12 mirror trio and must land in the same PR; ordering Step 1 first keeps
  the primary source (the docstring, adjacent to the code) authoritative.
- **Step 3 (test)** is the paired `test` step for **Step 1 (service)** (Constitution C-08): its
  behavioral + schema-boundary assertions prove the Step 1 change red-before-green.
- **Step 3 (test)** additionally requires **Step 2 (docs)** complete: the `@AC-5` docs-consistency
  assertion reads `docs/runbooks/mcp-tools.md` and `plugins/strat-lab/skills/backtest/SKILL.md`
  (produced in Step 2) alongside the tool docstring (Step 1). Run Step 3 last.

---

### Step 1 — service: Widen `manage_strategy` rule params + coerce dict→JSON string + docstring

**Status**: `done`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/app/tools.py` — modify

**Reviewers**: `xstockstrat-agent` service owner — MCP tool contract stability (name, parameters, return shape) and `docs/runbooks/mcp-tools.md` parity; no secret values in tool output

**Codebase Evidence**:
- Signature confirmed via `grep -n` on `services/xstockstrat-agent/app/tools.py`:
  - `async def manage_strategy(` at `tools.py:573`; `entry_rule: str | None = None` at `tools.py:579`,
    `exit_rule: str | None = None` at `tools.py:580` (siblings `components: list[dict] | None` at `:578`,
    `signal_params: dict | None` at `:581`).
- `import json` **already present** at `tools.py:36` (no new import; no `pyproject.toml`/`uv.lock` change).
- feature-070 partial-merge build confirmed (read `tools.py:660-698`):
  `definition: dict = {"strategy_id": strategy_id}` at `:666`; the `supplied = {…}` map at `:667-677`
  (`"entry_rule": entry_rule` at `:670`, `"exit_rule": exit_rule` at `:671`);
  `mask = [name for name, value in supplied.items() if value is not None]` at `:678`;
  `clear_fields` join at `:685-687`; `update_mask` build at `:689-698`.
- Docstring rule contract confirmed: `entry_rule / exit_rule: JSON-encoded condition trees (a JSON
  string, not a raw object).` at `tools.py:598`; worked-example closer `(pass this dict JSON-encoded,
  e.g. json.dumps(...), as the entry_rule string.)` at `tools.py:622`; the fingerprint Note block
  `Note: changing any scoring-relevant field …` at `tools.py:648`; the `clear_fields` docstring line
  `clear_fields: optional list of field names to ERASE …` at `tools.py:637`.
- Downstream unchanged: `client.py` reads `entry_rule=definition.get("entry_rule", "")` at
  `client.py:707` (still receives a `str`); proto `StrategyDefinition.entry_rule` stays `string`.

**TDD**: `red-green required` (paired with Step 3).

**Covers**: — (behavior verified by Step 3)

**Instructions**:
1. Widen the two annotations (`tools.py:579-580`):
   - `entry_rule: str | None = None` → `entry_rule: str | dict | None = None`
   - `exit_rule: str | None = None` → `exit_rule: str | dict | None = None`
   (Keep `str | dict` — **not** a `TypedDict`; per `design.md` Rejected Alternatives this avoids
   duplicating the recursive rule grammar `xstockstrat-analysis` owns, and `str | dict` already
   rejects a list/number at the pydantic schema boundary.)
2. Insert the coercion **immediately before** the `definition`/`supplied` build (before `tools.py:666`,
   after the feature-070 comment block ending at `:665`):
   ```python
   # feature 149: accept a rule delivered as a JSON object (dict) from a client whose transport
   # pre-parses JSON args; serialize it to the same JSON string a caller passing it pre-encoded
   # would send. Bare json.dumps (NO sort_keys) so the string path stays byte-for-byte identical.
   if isinstance(entry_rule, dict):
       entry_rule = json.dumps(entry_rule)
   if isinstance(exit_rule, dict):
       exit_rule = json.dumps(exit_rule)
   ```
   This runs **before** the `mask = [… if value is not None]` at `:678`, so an omitted `None` still
   drops out of the mask (FR-2) and an empty dict `{}` → `"{}"` (non-`None`) correctly enters the mask
   (FR-1 / `@AC-6`). Do **not** use `sort_keys` and do **not** canonicalize the string path — a string
   `entry_rule` is never re-encoded (FR-3 / `@AC-2`).
3. Update the docstring wording (same PR — F-12 mirror surface #1):
   - `tools.py:598`: change `… JSON-encoded condition trees (a JSON string, not a raw object).` to state
     the field accepts **a JSON string _or_ a JSON object (dict)** — the tool serializes a dict to the
     canonical JSON string before forwarding.
   - `tools.py:622`: drop the "as the entry_rule string" constraint from the worked example; note the
     dict may be passed directly (the tool json.dumps it) or pre-encoded as a string.
   - In the Note block near `tools.py:648`, add one line recording the **fingerprint non-equivalence**
     open risk (`design.md` Open Risks): a dict and a differently-spaced string of the *same* logical
     rule serialize differently (default `json.dumps` separators), so switching a stored rule between
     encodings changes the definition fingerprint and clears the derived grade until a fresh backtest.
   - In the `clear_fields` docstring line at `tools.py:637`, add the scoped caveat (`design.md` Chosen
     Approach `{}`+`clear_fields`): when a field is **both** given a value and named in `clear_fields`,
     the value wins and the clear is silently dropped (pre-existing feature-070 / AIP-161 behavior);
     to erase, use `clear_fields` **alone**. Scope the caveat to structurally-empty `{}`/`"{}"` — do
     not over-generalize (a structured-but-vacuous `{"op":"AND","conditions":[]}` still validates).
4. Make no change to `client.py`, proto, config, or DB.

**Verification**:
- `grep -n "entry_rule: str | dict | None\|exit_rule: str | dict | None" services/xstockstrat-agent/app/tools.py` — both annotations widened.
- `grep -n "isinstance(entry_rule, dict)\|isinstance(exit_rule, dict)\|json.dumps(entry_rule)\|json.dumps(exit_rule)" services/xstockstrat-agent/app/tools.py` — coercion present, above line 666.
- `grep -n "sort_keys" services/xstockstrat-agent/app/tools.py` — **no** match on the new coercion (string path stays byte-for-byte).
- Docstring: `grep -n "JSON string or a JSON object\|JSON string or an object\|or a JSON object" services/xstockstrat-agent/app/tools.py` — the widened wording is present (`@AC-5` surface #1).
- Lint (code-quality gate, `reference/step-constraints.md` §B — may also run in Step 3): `cd services/xstockstrat-agent && ruff check . && ruff format --check .`

---

### Step 2 — docs: Align `mcp-tools.md` + `strat-lab` backtest skill (F-12 mirror trio)

**Status**: `done`
**Service**: `docs/runbooks/` + `plugins/strat-lab/`
**Files**:
- `docs/runbooks/mcp-tools.md` — modify
- `plugins/strat-lab/skills/backtest/SKILL.md` — modify

**Reviewers**: none

**Codebase Evidence**:
- `docs/runbooks/mcp-tools.md` `manage_strategy` parameter table (read `:465-483`):
  `| ` + "`entry_rule`" + ` | ` + "`string`" + ` | No | JSON-encoded condition tree |` at `:473`;
  same for `exit_rule` at `:474`; the `clear_fields` row at `:480`
  (`Field names to **erase** on ` + "`update`" + `, e.g. ` + "`[\"exit_rule\"]`" + `. The only way to blank a rule …`).
- `plugins/strat-lab/skills/backtest/SKILL.md` mutation-guard block (read `:54-67`): names
  `entry_rule`/`exit_rule` in the partial-merge preserved list at `:55` and `clear_fields` at
  `:58-59`; the skill makes **no** encoding claim today (recon.md "Not found: no strat-lab line
  currently stating json.dumps encoding").

**TDD**: `N/A (docs — no executable behavior; wording verified by Step 3 @AC-5 assertion)`

**Covers**: —

**Instructions**:
1. `docs/runbooks/mcp-tools.md` `entry_rule` row (`:473`) and `exit_rule` row (`:474`): change the
   Type cell from `string` to `string or object` and the Description to note the value is a
   JSON-encoded condition tree passed **as a JSON string or as a JSON object** (F-12 mirror surface #2).
2. `docs/runbooks/mcp-tools.md` `clear_fields` row (`:480`): add the same scoped value-wins caveat as
   the docstring — a field both supplied a value and named in `clear_fields` keeps its value and the
   clear is silently dropped; use `clear_fields` alone to erase (scoped to structurally-empty
   `{}`/`"{}"`).
3. `plugins/strat-lab/skills/backtest/SKILL.md`: add a minimal "Rule encoding" note near the
   mutation-guard block (`~:54-67`) stating `entry_rule`/`exit_rule` accept a JSON string **or** a JSON
   object (the tool serializes an object to a JSON string) — the root-CLAUDE.md strat-lab guardrail
   requires this skill be touched in a `manage_strategy`-change PR (F-12 mirror surface #3).
4. Do not restructure or reformat surrounding rows/prose — surgical edits only.

**Verification**:
- `grep -n "string or object" docs/runbooks/mcp-tools.md` — both rule rows updated.
- `grep -n "JSON string or\|string or a JSON object\|or a JSON object" plugins/strat-lab/skills/backtest/SKILL.md` — the encoding note is present.

---

### Step 3 — test: Paired unit tests for dict/string/omitted rules + schema boundary + docs parity

**Status**: `done`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/tests/test_tools.py` — modify (add tests to `class TestManageStrategyTool`)

**Reviewers**: `xstockstrat-agent` service owner — service being tested

**Codebase Evidence**:
- Test class + pattern confirmed (read `test_tools.py:793-870`): `class TestManageStrategyTool:` at
  `:793`; `test_calls_client_with_args` at `:795` builds the server via `_make_server()` (`:17`), patches
  `client.manage_strategy` with `AsyncMock(return_value=…)`, invokes
  `await _tool_fn(server, "manage_strategy")(ctx=_ctx(ADMIN), operation="register", strategy_id=…, entry_rule="{}")`,
  and asserts on `m.call_args.kwargs["definition"]` (and `["user_id"]`). `_tool_fn` at `test_tools.py:23`;
  `from unittest.mock import AsyncMock, MagicMock, patch` at `:5`. Existing cases (e.g.
  `test_forwards_cooldown_days` at `:817`) already assert `"key" in defn` / `"key" not in defn` and are
  the omitted-field template.
- Published-schema inspection pattern confirmed (read `test_config_tools.py:337,348,367`):
  `server._tool_manager.get_tool("manage_strategy").parameters["properties"]` returns the tool's public
  `inputSchema` properties — used to assert what the tool advertises (the schema-boundary check for
  `@AC-1`'s "not rejected for invalid argument type" clause, since the raw `_tool_fn` path bypasses
  pydantic validation).
- Note: the raw `_tool_fn(...)` unit tests call the tool body directly and **bypass** pydantic argument
  validation, so a dict passed to `entry_rule=` in a `_tool_fn` call exercises the coercion body but
  **not** the annotation; the annotation change is verified separately via the `inputSchema` assertion.

**TDD**: `red-green required` — against the pre-Step-1 tree these tests fail (dict path absent, docstring
wording old, docs surfaces old); they pass after Steps 1+2.

**Covers**: `AC-1, AC-2, AC-3, AC-4, AC-5, AC-6`

**Instructions**: Add the following tests to `class TestManageStrategyTool` in
`services/xstockstrat-agent/tests/test_tools.py`, mirroring `test_calls_client_with_args` (`:795`):

1. **`@AC-1` — object → JSON string.** Call `_tool_fn(server, "manage_strategy")(ctx=_ctx(ADMIN),
   operation="register", strategy_id="obj_rule_demo", entry_rule={"op": "AND", "conditions": [{"fn": ">",
   "lhs": "mq", "rhs": 0.3}]})`. Assert
   `m.call_args.kwargs["definition"]["entry_rule"] == json.dumps({"op": "AND", "conditions": [{"fn": ">",
   "lhs": "mq", "rhs": 0.3}]})` (import `json` in the test, or assert equality against the exact expected
   string) — i.e. the definition carries the serialized string, not a dict.
2. **`@AC-2` — string passes through byte-for-byte.** Call with
   `exit_rule='{"fn": "crosses_below", "lhs": "vts", "rhs": 0}'` (a `str`). Assert
   `m.call_args.kwargs["definition"]["exit_rule"] == '{"fn": "crosses_below", "lhs": "vts", "rhs": 0}'`
   — the identical string object, no re-encoding.
3. **`@AC-3` — omitted rule dropped from definition and mask.** Call
   `operation="update", strategy_id="partial_demo", cooldown_days=45` with `entry_rule`/`exit_rule`
   omitted. Assert `"cooldown_days" in defn`, `"entry_rule" not in defn`, `"exit_rule" not in defn`, and
   `m.call_args.kwargs["update_mask"] == ["cooldown_days"]`.
4. **`@AC-4` — both rules as objects each serialized.** Call with
   `entry_rule={"fn": "<", "lhs": "rsi", "rhs": 35}` and
   `exit_rule={"fn": "crosses_below", "lhs": "vts", "rhs": 0}`. Assert both are `str` in the definition
   and `json.loads(defn["entry_rule"]) == {"fn": "<", "lhs": "rsi", "rhs": 35}` and
   `json.loads(defn["exit_rule"]) == {"fn": "crosses_below", "lhs": "vts", "rhs": 0}` (round-trip).
5. **`@AC-6` — empty object → `"{}"`, enters mask.** Call
   `operation="update", strategy_id="empty_obj_demo", entry_rule={}`. Assert
   `defn["entry_rule"] == "{}"` and `"entry_rule" in m.call_args.kwargs["update_mask"]`.
6. **`@AC-1` schema boundary — published schema advertises object.** Build `server = _make_server()`
   and read `props = server._tool_manager.get_tool("manage_strategy").parameters["properties"]`. Assert
   the `entry_rule` (and `exit_rule`) property schema admits a JSON **object** — i.e. its `anyOf`/`type`
   includes an `object` variant (the `str | dict` annotation). This proves a client's schema validation
   accepts an object rather than rejecting it for an invalid argument type. (Confirm the exact schema
   shape when writing the assertion, e.g. an `anyOf` entry with `"type": "object"`.)
7. **`@AC-5` docs consistency — all three surfaces state string-or-object.** Assert each of the three
   F-12 surfaces states the rule fields accept a JSON string **or** a JSON object:
   - the tool docstring — read `server._tool_manager.get_tool("manage_strategy").description` (or
     `tools.manage_strategy.__doc__` via the tools module) and assert it mentions accepting an object;
   - `docs/runbooks/mcp-tools.md` — read the file (repo-relative from the test's location) and assert
     the `entry_rule`/`exit_rule` rows contain `string or object`;
   - `plugins/strat-lab/skills/backtest/SKILL.md` — read the file and assert it states the rule fields
     accept a JSON string or object.
   (This assertion depends on Step 2 being complete — see § Step Dependencies.)

Keep all new dummy rule objects **inline** in the test (Constitution C-13): each is a single-consumer
scenario literal used only by its own test — no second consumer, so no move to `tests/conftest.py` is
warranted; state this verdict in the test-step notes rather than creating a fixture home speculatively.

**Verification**:
- Coverage gate (Constitution C-08; agent threshold 40%, `cov_source=app`, per `.github/workflows/ci.yml:346-347`):
  `cd services/xstockstrat-agent && uv run --no-sync pytest --cov=app --cov-fail-under=40` (or
  `pytest --cov=app --cov-fail-under=40` in an already-synced env) — confirm all new tests pass and the
  threshold holds.
- Run the proto-parity guard unchanged (recon Risks): `cd services/xstockstrat-agent && pytest tests/test_strategy_builders.py -k manage_strategy` — still green (normalization happens before the definition is built, so the proto request still carries a string `entry_rule`).
- Lint (code-quality gate for the paired Step 1 `service` step, `reference/step-constraints.md` §B):
  `cd services/xstockstrat-agent && ruff check . && ruff format --check .`
- C-13 check — no second inline copy of a domain literal introduced:
  `grep -n "def .*fixture\|from .conftest\|conftest" services/xstockstrat-agent/tests/test_tools.py`
  (expect none added — inline single-consumer literals are compliant).

---

## Deviation Log

- **D-1 (Step 1, docstring line-wrap).** The `tools.py:598` rule-encoding line was wrapped across
  three lines to satisfy ruff `E501` (≤100 cols), so the phrase "JSON object" spans a line break in
  the docstring. The `@AC-5` docstring assertion (Step 3) normalizes whitespace
  (`" ".join(description.split())`) before matching "JSON string OR a JSON object", so the wrap does
  not weaken the check. No behavior change.
- **D-2 (execution model).** Implemented directly on the assigned harness branch
  `claude/register-trading-strategies-uoqhuk` as a single commit + one PR → `main-dev` (operator
  override recorded in `context.md`), rather than the default `/sdd-execute` per-step-PR flow. All
  three steps' verifications (grep checks, `pytest --cov=app --cov-fail-under=40` → 273 passed / 78%,
  `ruff check` + `ruff format --check`, and the `test_strategy_builders.py` proto-parity guard) were
  run and pass; red-before-green (P-06) was demonstrated by reverting `tools.py` alone and confirming
  the three code-dependent Step-3 tests fail (schema string-only, dict path absent), then restoring.
