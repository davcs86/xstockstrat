# Implementation Spec: fix-analysis-evidence-dry

**Status**: `pending`
**Created**: 2026-11-20
**Feature**: `docs/roadmap/features/327-fix-analysis-evidence-dry/feature.md`
**Total Steps**: 18
**Feature Branch**: `feature/fix-analysis-evidence-dry`

**Tree**: detached @ `f7d02e7e` ≡ `origin/feature/fix-analysis-evidence-dry` (merged `origin/main-dev`
in `/sdd-spec` Step 0.5). Every `path:line` below was re-grepped on this tree; design.md / recon.md
line numbers (round-3 tree, base `c4fd48b0a`) are superseded by the cites here. Symbol names are
authoritative if a later merge shifts lines.

---

## Execution Summary

Two independent fixes, both inside `xstockstrat-analysis`, in the build order design.md fixes:
AC-2 first (Steps 1–2, the entry-backfill reads through `StrategiesRepository.list_live_enabled`),
then the formula-aware evidence fingerprint bottom-up — pure helpers (3–4), digests on the existing
single `GetFormula` read (5–6), the owner-scoped prefix read (7–8), the `_run_backtest` stamp (9–10),
the `_fetch_and_aggregate` / `ScoreStrategy` read side (11–12), the ManageStrategy UPDATE pop guard
(13–14) — the analysis docs (15), then the agent consumer surface: the `manage_strategy` score
allow-list (16–17) and its docs (18). Each layer only adds optional keyword arguments or new symbols,
so no existing caller has to change in the step that introduces it.

`xstockstrat-indicators` is **read only** (existing `GetFormula`) and gets no step;
`xstockstrat-agent` gets Steps 16–18 (allow-list, pin test, docs — no tool signature change). No proto,
migration, config key, env var, port or pool change (design.md "Chosen Approach"; next free analysis
migration would be `030` — `028`/`029` exist — but none is needed).

**Consumer surface (C-14)** — corrected at impl-spec review 2026-11-20. product-spec.md names two
surfaces for `ScoreStrategy`; no field is added or removed on either (design.md "Consumer surface"),
but the messages are not all free-text to the agent:
- **Agent `manage_strategy` score (`_score_strategy`) — Steps 16–18.** The agent forwards an
  UNAVAILABLE detail only when it is in `_SCORE_UNAVAILABLE_PASS`
  (`services/xstockstrat-agent/app/tools.py:242`, exactly one string today); any other UNAVAILABLE
  text collapses to `upstream unavailable; …` (`_grpc_error_message`, `tools.py:278-282`). Without a
  step the new gate-off abort `"formula version unavailable — grade unchanged"` (Step 11) would be
  withheld from the MCP caller, so Step 16 adds it to the allow-list and Step 17 pins it (AGENT-10).
  The new NOT_FOUND text needs no agent code change: `_score_strategy` passes
  `not_found=e.details() or "no eligible evidence"` (`tools.py:296`) and `_grpc_error_message` returns
  the details verbatim when they contain `not_found` (`tools.py:273-274`).
- **Insights BFF (`services/xstockstrat-ui/src/lib/insightsBff.ts:40-42` `scoreStrategy`) — no step,
  by decision.** It is a bare `forward(...)` of the RPC with no message-specific handling (no
  "grade unchanged" string exists under `services/xstockstrat-ui/src`), so the new texts reach the UI
  through the existing error path unchanged.

The `RunBacktest` run warning is a free-text entry in the existing `warnings` field on both surfaces.

**Trading-domain constraints (step-constraints §A)**: not applicable — `entry_backfill.run_once` only
*reads* `ListOrders`; no broker dispatch, order placement, order type or fill handling is touched.

## Scenario Coverage (C-15)

| Scenario | Covered by |
|---|---|
| `@AC-1` editing a referenced formula stops pre-edit evidence feeding the grade | Step 12 (end to end); Steps 4, 6, 10 (the parts) |
| `@AC-2` entry-backfill selects through `LIVE_ENABLED_PREDICATE_SQL` | Step 2 |
| `@AC-3` score-time refusal grades on the newest formula-aware evidence | Step 12; Step 8 (the prefix read) |
| `@AC-4` gate off + `GetFormula` outage → UNAVAILABLE, grade untouched | Step 12; Step 17 (the message reaches the agent caller verbatim) |
| `@AC-5` rename during a `GetFormula` outage keeps the grade | Step 14 |

`@AC-3`–`@AC-5` were appended to `acceptance.feature` by `/sdd-spec` (design.md step 7 mandates
them; IDs are append-only).

## Open objections → steps (debate.md bookkeeping, design.md Open Risks last bullet)

| Objection | Where it lands |
|---|---|
| O-11 all four `_fetch_and_aggregate` callers | Steps 11–12 (ScoreStrategy, RunBacktest recompute, boot pass, UPDATE) |
| O-17 UPDATE pop guard against the locked row | Steps 13–14 |
| O-18 distinct NOT_FOUND + unrecoverable refused population | Steps 11–12 (message), Step 15 (docs) |
| O-19 mixed refused/readable formulas | Step 12 (pin), Step 15 (limitation) |
| O-20 index claim: `(user_id, strategy_id)` prefix + in-memory sort | Steps 7–8 |
| O-21 run warning for an outage only | Steps 9–10 |
| O-22 refused fids seeded as `_FormulaRead([], _UNREADABLE)` | Steps 9–10 |
| O-23 `_FormulaVersionUnknown` log branch + boot limitation | Steps 9–10 (log), Step 15 (limitation) |
| O-24 stale "next free migration 028" | This spec's Execution Summary (030; none needed) |

## Step Dependencies

- Step 2 [test] covers Step 1 [service]. They are not a `Lands with` pair (no §C trigger), so executed
  in order Step 2's tests are green the first time they run; the P-06 red proof is produced inside
  Step 2 as its instruction 3 describes (the literal temporarily restored in the working tree).
- Steps 3+4 land together: Step 4's tests import symbols Step 3 creates (§C "adds a test that
  references a symbol a later step creates").
- Steps 5+6 land together: same trigger (`digests=` keyword, `_FormulaRead` cache values).
- Steps 7+8 land together: same trigger (`latest_formula_fingerprint`).
- Steps 9+10 land together: same trigger (`_FORMULA_VERSION_WARNING`), and Step 9 changes what
  `tests/test_analysis_servicer.py` can assert about the stamped fingerprint.
- Steps 11+12 land together: same trigger (`_FORMULA_VERSION_UNKNOWN_MSG`, `unreadable=` keyword), and
  Step 12 amends the existing `test_ac23_*` mock that Step 11's new repository call reaches.
- Steps 13+14 land together: Step 14's pin test fails on any tree without Step 13 and is the only
  proof of the guard (open risk "stale `pre` read").
- Steps 16+17 land together: Step 16 changes `_SCORE_UNAVAILABLE_PASS`, which the existing
  `tests/test_tool_errors.py::test_unavailable_pass_strings_match_backend_sources` pins by equality,
  so Step 16 cannot pass its own Verification without Step 17.
- Every unit stays on one consumer surface (Steps 1–15 backend, Steps 16–18 the agent), is adjacent,
  and is 2 steps (cap 4).
- Step 16 requires Step 11 (`_FORMULA_VERSION_UNKNOWN_MSG` must exist in the analysis source that
  Step 17's pin reads).
- Step 18 requires Steps 16–17 (it documents the landed agent behaviour).
- Step 5 requires Step 3 (`_formula_digest`, `_FormulaRead`, `_UNREADABLE`).
- Step 9 requires Steps 3 and 5 (`_evidence_fingerprint`, `digests=`).
- Step 11 requires Steps 3, 5 and 7.
- Step 13 requires Step 11 (`_FormulaVersionUnknown` raised from the recompute).
- Between Step 9 and Step 11 the branch stamps composite fingerprints that the read side does not
  yet ask for (CUSTOM_FORMULA strategies read no evidence). This is a branch-only interim: the
  feature merges as one integration PR; do not open a `main-dev` PR between those steps.
- Step 15 requires Steps 1–14 (it documents the landed behaviour).
- Rollout note for the integration PR (design.md Open Risks): one-time evidence reset for every
  CUSTOM_FORMULA strategy; strategies whose formula is refused at rollout and that hold only
  pre-feature cells answer NOT_FOUND until the formula is readable again (028 template instances,
  the 029 blend). context.md Open Threads still asks for the operator's explicit acknowledgement of
  that population. The behaviour ships in Steps 11–12, so the acknowledgement is confirmed at
  **Step 11's** Phase-2 gate (before any Step 11 write) and recorded in `context.md`; Step 15 only
  checks that the record exists.

---

### Step 1 — service: entry-backfill reads live strategies through `list_live_enabled`

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/app/engine/entry_backfill.py` — modify

**Reviewers**: xstockstrat-analysis service owner — Backtest reproducibility, strategy scoring determinism, no look-ahead bias

**Codebase Evidence**:
- Confirmed via: `grep -n "live_enabled = TRUE" services/xstockstrat-analysis/app/engine/entry_backfill.py` → line 65, the re-typed literal `"SELECT * FROM analysis.strategies WHERE live_enabled = TRUE AND active = TRUE"`, inside `run_once`'s `try:` at `:63-69` (`except Exception` → `log.warning("entry_backfill: live-strategies read failed [trace %s]: %s", …)` → `return`).
- Module-top imports at `entry_backfill.py:21-24` (`app.config.watcher`, `app.engine.live_loop`, `app.handlers.servicer`, `app.identity`).
- Reuse target (recon.md Patterns to REUSE, D-1): `StrategiesRepository.list_live_enabled(self, user_id=None)` at `services/xstockstrat-analysis/app/repositories/strategies.py:212-231`; with no argument it runs `f"SELECT * FROM analysis.strategies WHERE {LIVE_ENABLED_PREDICATE_SQL}"` (`:229`), reading the module global `LIVE_ENABLED_PREDICATE_SQL` (`:19`) at call time, and returns `[_to_dict(r) for r in rows]`. Constructor `__init__(self, db_pool)` at `:38`.
- Downstream row use is dict-safe: `dict(r).get("strategy_id")` at `entry_backfill.py:107`.
- Existing tests feed rows through `db_pool.fetch = AsyncMock(return_value=[_strategy_row()])` (`tests/test_entry_backfill.py:121`), which `list_live_enabled` still calls (`self._db.fetch`), so they keep passing unchanged. No test asserts the SQL text today (`grep -n "SELECT" tests/test_entry_backfill.py` → no match).

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. In `entry_backfill.py`, add `from app.repositories.strategies import StrategiesRepository` to the module-top `app.*` import block (`:21-24`). Do **not** import `LIVE_ENABLED_PREDICATE_SQL` by name (rejected alternative R-3: a name-bound import freezes a copy).
2. Replace the `db_pool.fetch("SELECT * FROM analysis.strategies WHERE live_enabled = TRUE AND active = TRUE")` call at `:64-66` with `rows = await StrategiesRepository(db_pool).list_live_enabled()`. Keep it inside the existing `try`/`except Exception` → warning → `return` (`:63-69`) unchanged (PRESERVE `@AC-4 @feature-262`).
3. Change nothing else in the file (the docstring's "Imported ONLY by main.py" line stays true).

**Verification**:
```bash
cd services/xstockstrat-analysis
grep -n "live_enabled = TRUE" app/engine/entry_backfill.py    # no match
grep -n "LIVE_ENABLED_PREDICATE_SQL" app/engine/entry_backfill.py    # no match (R-3)
grep -n "list_live_enabled" app/engine/entry_backfill.py    # one call inside run_once
uv run pytest tests/test_entry_backfill.py tests/test_owner_header_guard.py -q
ruff check . && ruff format --check .
```

---

### Step 2 — test: the backfill selection follows `LIVE_ENABLED_PREDICATE_SQL`

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/tests/test_entry_backfill.py` — modify

**Reviewers**: xstockstrat-analysis service owner — Backtest reproducibility, strategy scoring determinism, no look-ahead bias

**Codebase Evidence**:
- Fixture home (C-13, recon.md): `_strategy_row()` at `tests/test_entry_backfill.py:31`, `_fake_live_loop()` at `:51`, `_cfg()` at `:66`, `_order()` at `:23`, class `TestRunOnce` at `:117`; the `db_pool.fetch = AsyncMock(...)` pattern at `:121`.
- Existing SQL-constant pin to mirror: `tests/test_analysis_servicer.py:7055-7081` (`from app.repositories.strategies import LIVE_ENABLED_PREDICATE_SQL, StrategiesRepository` … `assert LIVE_ENABLED_PREDICATE_SQL in sql`).
- Ledger trap fails.md:2255: an SQL-text assertion alone only proves a string was built — pair it with a behavioural selection assertion.

**TDD**: `red-green required`

**Covers**: `AC-2`

**Instructions**:
Add two tests to `TestRunOnce`, reusing `_strategy_row`, `_fake_live_loop`, `_cfg`, `_order` (single-consumer inline rows; no new fixture home — C-13 verdict: compliant inline).
1. `test_ac2_selects_through_the_live_enabled_predicate`: build a `fetch` fake (`AsyncMock(side_effect=...)`) that records the SQL it receives and returns `[_strategy_row("s1")]` (S1 — active, live_enabled) only when the SQL equals what `StrategiesRepository(db_pool).list_live_enabled()` emits for the **current** value of `app.repositories.strategies.LIVE_ENABLED_PREDICATE_SQL`, i.e. `f"SELECT * FROM analysis.strategies WHERE {strategies.LIVE_ENABLED_PREDICATE_SQL}"`, else `[]`. Run `run_once` with a `ListOrders` stub returning one filled BUY. Assert: exactly one SQL was recorded, it contains `strategies.LIVE_ENABLED_PREDICATE_SQL`, and `("u1", "s1", "AAPL")` was seeded in `live_loop._last_entry_at` — S2 (active, not live_enabled) and S3 (inactive, live_enabled) are excluded by the predicate itself, so the test states that in its docstring instead of faking rows the SQL would never return.
2. `test_ac2_narrowed_predicate_selects_nothing`: `monkeypatch.setattr("app.repositories.strategies.LIVE_ENABLED_PREDICATE_SQL", "live_enabled = TRUE AND active = TRUE AND strategy_id <> 's1'")`, then a `fetch` fake that returns `[_strategy_row("s1")]` when the SQL contains the **original** predicate *without* the narrowing clause and `[]` when it contains the narrowed text. Assert the recorded SQL contains the narrowed predicate, `trading_stub.ListOrders` was never awaited and `live_loop._last_entry_at == {}`.
   RED on the pre-Step-1 tree: the literal ignores the monkeypatch, so the fake returns S1 and `ListOrders` is awaited.
3. Red proof (P-06). Step 1 is already committed when this step runs, so both tests pass on first run. Show the red explicitly: temporarily put the Step 1 literal back in `run_once` in the working tree (an uncommitted edit — do **not** use `git stash`; the stash stack is shared across worktrees), run `uv run pytest tests/test_entry_backfill.py -q -k ac2` and record that `test_ac2_narrowed_predicate_selects_nothing` fails, then discard that edit (`git checkout -- app/engine/entry_backfill.py`) and re-run for GREEN. `test_ac2_selects_through_the_live_enabled_predicate` is green on both trees while the constant equals the literal; the narrowed-predicate test is the regression proof.

**Verification**:
```bash
cd services/xstockstrat-analysis
uv run pytest tests/test_entry_backfill.py -q -k ac2
grep -n "def .*fixture\|from .conftest\|conftest" tests/test_entry_backfill.py    # C-13: no second inline copy introduced
uv run pytest --cov=app --cov-fail-under=40
ruff check . && ruff format --check .
```

---

### Step 3 — service: pure fingerprint helpers (`_formula_digest`, `_evidence_fingerprint`)

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/app/handlers/servicer.py` — modify

**Reviewers**: xstockstrat-analysis service owner — Backtest reproducibility, strategy scoring determinism, no look-ahead bias

**Codebase Evidence**:
- `_definition_fingerprint(definition_json: dict) -> str` at `services/xstockstrat-analysis/app/handlers/servicer.py:7488` (sync, pure, module-level); `_FINGERPRINT_EXCLUDED_KEYS` at `:7485`; canonical form `json.dumps(filtered, sort_keys=True, separators=(",", ":"))` → `hashlib.sha256(...).hexdigest()` at `:7503-7504`. `hashlib` / `json` imported at `:17-18`, `json_format` at `:39`. No `typing` import exists in `servicer.py` today.
- `class _GradeInputsUnknown(Exception)` at `:277` (`__init__(self, symbol)` sets `self.symbol`).
- `FormulaDefinition` fields (`packages/proto/indicators/v1/indicators.proto:162-182`): `formula_id=1, name=2, description=3, source=4, author=5, created_at=6, updated_at=7, is_public=8, input_schema=9, parameters=10, outputs=11, warmup_period=12, deleted=13, fundamental_inputs=14, origin=15`. `FormulaParameter` (`:118-126`): `name, type, default_value, description, required, min, max` (`min`/`max` are `optional`). `FormulaOutput` (`:133-136`): `name, description`.
- D-5 classification (debate.md): BEHAVIOURAL = `source`, `input_schema`, `warmup_period`, `fundamental_inputs`, `parameters[]` minus `description`, `outputs[]` `name` only. DISPLAY = `formula_id`, `name`, `description`, `author`, `created_at`, `updated_at`, `is_public`, `deleted`, `origin`, `parameters[].description`, `outputs[].description`.
- Rejected: R-1 (never hash `updated_at`), R-6 (never hash an "unreadable" sentinel).

**Lands with**: `Step 4`

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
Add, directly after `_definition_fingerprint` (`:7488-7504`), module-level and pure (no I/O):
1. Field-classification constants, one frozenset of field names per message, so the Step 4 descriptor walk can assert coverage:
   `_FORMULA_BEHAVIOURAL_FIELDS = {"source", "input_schema", "parameters", "outputs", "warmup_period", "fundamental_inputs"}`, `_FORMULA_DISPLAY_FIELDS = {"formula_id", "name", "description", "author", "created_at", "updated_at", "is_public", "deleted", "origin"}`, `_FORMULA_PARAMETER_BEHAVIOURAL_FIELDS = {"name", "type", "default_value", "required", "min", "max"}`, `_FORMULA_PARAMETER_DISPLAY_FIELDS = {"description"}`, `_FORMULA_OUTPUT_BEHAVIOURAL_FIELDS = {"name"}`, `_FORMULA_OUTPUT_DISPLAY_FIELDS = {"description"}`.
2. `_formula_digest(formula) -> str`: `json_format.MessageToDict(formula, preserving_proto_field_name=True)` (defaults omitted — the library default — so an unset `optional min`/`max` is absent while a set `0.0` is present), keep only `_FORMULA_BEHAVIOURAL_FIELDS`, within `parameters[]` keep only `_FORMULA_PARAMETER_BEHAVIOURAL_FIELDS`, within `outputs[]` keep only `_FORMULA_OUTPUT_BEHAVIOURAL_FIELDS`; repeated order is preserved; then the same canonical form as `:7503-7504` (`sort_keys=True`, `separators=(",", ":")`, sha256 hex).
3. `_UNREADABLE = object()` — the digest marker for a refused formula (`UNREADABLE_FORMULA_CODES`). It is an `object()`, never a string, so it cannot be hashed into a fingerprint (R-6).
4. `class _FormulaRead(NamedTuple)`: `metrics: list`, `digest: object` (hex `str`, `_UNREADABLE`, or `None` for an outage). Add `NamedTuple` to the existing `typing` import (confirm the import line by grep before editing; if `typing` is not yet imported, add `from typing import NamedTuple`).
5. `_evidence_fingerprint(definition_json: dict, digests: dict) -> str`: `def_hash = _definition_fingerprint(definition_json)`; when `digests` is empty return `def_hash` unchanged (D-2 byte identity); raise `ValueError` if any value is not a `str` (a refused or unknown digest must never be stamped); otherwise return `def_hash + "." + hashlib.sha256(";".join(f"{fid}={digests[fid]}" for fid in sorted(digests)).encode("utf-8")).hexdigest()`.
6. Next to `_GradeInputsUnknown` (`:277`), add `class _FormulaVersionUnknown(_GradeInputsUnknown)`: `__init__(self, formula_id)` calls `Exception.__init__(self, f"{formula_id}: formula version unavailable")` and sets `self.formula_id = formula_id` (it does not set `symbol`). One-line docstring: a referenced formula's content could not be read, so the evidence fingerprint is unknown; keep the old grade.
Nothing calls these yet.

**Verification**:
```bash
cd services/xstockstrat-analysis
grep -n "^def _formula_digest\|^def _evidence_fingerprint\|^_UNREADABLE = \|^class _FormulaRead\|^class _FormulaVersionUnknown" app/handlers/servicer.py    # 5 hits
uv run pytest tests/test_evidence_fingerprint.py -q
ruff check . && ruff format --check .
```

---

### Step 4 — test: digest classification, pin tests and fingerprint shape

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/tests/test_evidence_fingerprint.py` — create

**Reviewers**: xstockstrat-analysis service owner — Backtest reproducibility, strategy scoring determinism, no look-ahead bias

**Codebase Evidence**:
- **Not found** — no `tests/test_evidence_fingerprint.py` exists (`ls services/xstockstrat-analysis/tests | grep evidence` → no match); created from scratch. Existing fingerprint unit tests live in `tests/test_analysis_servicer.py:2213-2242` (`class TestDefinitionFingerprint`; pattern: import the helper, compare hashes).
- `indicators_pb2.FormulaDefinition(...)` construction pattern in tests: `tests/test_grade_fundamentals_exclusion.py:78-82`.
- Existing rename guarantee to keep green: `test_rename_of_dirty_row_does_not_change_fingerprint` at `tests/test_analysis_servicer.py:3424-3439` (feature 194; it carries no `@AC-*` tag in the file).

**Lands with**: `Step 3`

**TDD**: `red-green required`

**Covers**: `AC-1`

**Instructions**:
Create `tests/test_evidence_fingerprint.py` (pure unit tests, no servicer instance). All formula literals are local to this file (single consumer — C-13 inline verdict).
1. Descriptor walk: for `FormulaDefinition`, `FormulaParameter`, `FormulaOutput` assert `{f.name for f in <Msg>.DESCRIPTOR.fields} == BEHAVIOURAL | DISPLAY` and `BEHAVIOURAL & DISPLAY == set()` using the six Step 3 constants — a new proto field fails this test until it is classified.
2. `_formula_digest` pins (parametrized): changing `author`, `name`, `description`, `updated_at`, `created_at`, `deleted`, `origin`, a `parameters[0].description` or an `outputs[0].description` leaves the digest **unchanged**; changing `source`, `warmup_period`, `fundamental_inputs`, `input_schema`, a parameter `default_value`, a parameter `min` (unset vs `0.0`), or an output `name` **changes** it. (`AC-1`: a materially different `source` moves the digest.)
3. `_evidence_fingerprint`: `{}` digests → equals `_definition_fingerprint(definition_json)` byte for byte; with digests → `startswith(def_hash + ".")`, exactly one `"."`, order-independent in the dict's insertion order, different for a different digest value; a `None` or `_UNREADABLE` value raises `ValueError`.
4. `_FormulaVersionUnknown("f-9")` is an instance of `_GradeInputsUnknown` and carries `formula_id == "f-9"`.
RED for the unit (Steps 3+4 are one red→green cycle): author these tests first against Step 3's symbols declared as stubs that raise `NotImplementedError`, so the failure is a behaviour failure and not an `ImportError`; then implement Step 3's bodies for GREEN.

**Verification**:
```bash
cd services/xstockstrat-analysis
uv run pytest tests/test_evidence_fingerprint.py -q
uv run pytest tests/test_analysis_servicer.py -q -k "fingerprint or DeadSignalParams"
grep -n "def .*fixture\|from .conftest\|conftest" tests/test_evidence_fingerprint.py    # C-13: inline, single consumer
uv run pytest --cov=app --cov-fail-under=40
ruff check . && ruff format --check .
```

---

### Step 5 — service: carry formula digests on the existing single `GetFormula` read

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/app/handlers/servicer.py` — modify

**Reviewers**: xstockstrat-analysis service owner — Backtest reproducibility, strategy scoring determinism, no look-ahead bias

**Codebase Evidence**:
- `_formula_fundamentals(self, definition, propagation_meta, *, cache=None, failures=None, warmups=None)` at `servicer.py:1923-1960`: per-pass dedup `if fid in out` (`:1938`), cache hit `metrics = cache[fid]` (`:1940-1941`), the `GetFormula` call (`:1944-1947`), refusal/outage branch (`:1951-1954`, `UNREADABLE_FORMULA_CODES` imported at `:71`), cache write `cache[fid] = metrics` (`:1955-1956`), return map `{fid: metrics}` (`:1957-1960`). The `warmups=` keyword is feature 341 (its only caller: `:4565-4567`) and is untouched.
- `_declared_formula_warmup(self, formula_id, cache, propagation_meta, deleted_cache=None, fund_map=None, failures=None) -> int` at `:2537-2576`; the `if formula_id not in cache:` block is `:2553-2575`; `cache` is `dict[str, int]` (`formula_warmup_cache` at `:976`).
- `_prefetch_formula_warmups(self, definition, cache, propagation_meta, deleted_cache=None, fund_map=None, failures=None)` at `:2578-2625`; its loop call at `:2623-2625`.
- Callers that pass `cache=` to `_formula_fundamentals` (the cache they own becomes `_FormulaRead`-valued): `_exclude_refused_cells` (`:2808`) call `:2819-2821`; heal `:5186-5191` (dict declared `formula_fund_cache: dict[str, list] = {}` at `:5145`); opportunities `:5931-5936` (dict declared at `:5786`). Callers without `cache=` (`:809`, `:1006`, `:4028`, `:4332`, `:4565`, `:6281`) are unaffected.
- Break-radius (checklist i): all three signatures only gain an optional trailing keyword; `grep -n "_formula_fundamentals\|_declared_formula_warmup\|_prefetch_formula_warmups\|formula_cache\|formula_fund_cache" services/xstockstrat-analysis/tests/*.py` → call sites at `tests/test_fundamentals_pit_pager.py:307` and `tests/test_owner_header_guard.py:343-344` use existing positional/keyword forms and no test reads a cache value, so none needs editing.
- Header propagation (§B): no new outbound call — the digest is computed from the response of the existing `GetFormula` calls, which already pass `metadata=propagation_meta` (`:1946`, `:2557`).
- Rejected: R-4 (no separate `GetFormula` resolver).

**Lands with**: `Step 6`

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. `_formula_fundamentals`: add keyword `digests=None`. Cache values become `_FormulaRead(metrics, digest)`: on a hit unpack `metrics, digest = cache[fid]`; on a successful fetch `digest = _formula_digest(formula)`; in the `except grpc.RpcError` branch `digest = _UNREADABLE if _rpc_code(e) in UNREADABLE_FORMULA_CODES else None` (the existing `failures[("formula", fid)] = Availability.UNKNOWN` write is unchanged); write `cache[fid] = _FormulaRead(metrics, digest)`; when `digests is not None` set `digests[fid] = digest` for every CUSTOM_FORMULA fid visited (hit or fetch). The returned map stays `{fid: metrics}`. Extend the docstring's last sentence by one clause naming `digests`.
2. `_declared_formula_warmup`: add trailing keyword `digests=None`. Inside the `if formula_id not in cache:` block only (`cache` stays `dict[str, int]`): after a successful fetch set `digests[formula_id] = _formula_digest(formula)`; in the `except grpc.RpcError` branch set `digests[formula_id] = _UNREADABLE if _rpc_code(e) in UNREADABLE_FORMULA_CODES else None` — both guarded by `digests is not None`, and independent of `fund_map`/`failures`.
3. `_prefetch_formula_warmups`: add trailing keyword `digests=None` and pass it through at `:2623-2625`.
4. Annotation-only edits: `formula_fund_cache: dict[str, _FormulaRead] = {}` at `:5145` and `:5786`.
No caller passes `digests` yet.

**Verification**:
```bash
cd services/xstockstrat-analysis
grep -n "digests=None" app/handlers/servicer.py    # 3 signatures
grep -n "formula_fund_cache: dict\[str, _FormulaRead\]" app/handlers/servicer.py    # 2 hits
uv run pytest tests/test_formula_digest_read.py tests/test_fundamentals_pit_pager.py tests/test_owner_header_guard.py tests/test_unreadable_formula.py tests/test_grade_fundamentals_exclusion.py -q
ruff check . && ruff format --check .
```

---

### Step 6 — test: digests ride the single read (readable, refused, outage, cache hit)

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/tests/test_formula_digest_read.py` — create

**Reviewers**: xstockstrat-analysis service owner — Backtest reproducibility, strategy scoring determinism, no look-ahead bias

**Codebase Evidence**:
- **Not found** — no `tests/test_formula_digest_read.py`; created from scratch.
- Servicer factory `make_servicer()` at `tests/test_analysis_servicer.py:45`; RPC-error builder pattern `grpc.aio.AioRpcError(code, grpc.aio.Metadata(), grpc.aio.Metadata(), "down")` at `tests/test_grade_fundamentals_exclusion.py:63-64`; direct-helper call patterns at `tests/test_fundamentals_pit_pager.py:307` and `tests/test_owner_header_guard.py:343-344`.
- Count pins that must stay green: `tests/test_analysis_servicer.py:4274`, `:6858`, `:7323` (`GetFormula.await_count == 1`).

**Lands with**: `Step 5`

**TDD**: `red-green required`

**Covers**: `AC-1`

**Instructions**:
Create `tests/test_formula_digest_read.py`; build the servicer with `make_servicer()` (import from `tests.test_analysis_servicer`, as `tests/test_grade_fundamentals_exclusion.py:29-36` does) and a one-CUSTOM_FORMULA `StrategyDefinition` local to the file (single consumer — C-13 inline).
1. `_formula_fundamentals(digests=d, cache=c)`: readable formula → `d == {"f-9": _formula_digest(formula)}`, `c["f-9"]` is a `_FormulaRead` with that digest, and the returned map is still `{fid: metrics}` (empty for a non-fundamentals formula). A second call with the same `cache` issues **no** further `GetFormula` and fills `digests` from the cache.
2. Refusal (parametrize NOT_FOUND, PERMISSION_DENIED) → digest is `_UNREADABLE`, no `failures` entry. Outage (UNAVAILABLE) → digest is `None`, `failures[("formula", "f-9")] is Availability.UNKNOWN`.
3. `_prefetch_formula_warmups(..., fund_map={}, failures={}, digests=d)`: one `GetFormula` per distinct formula id, `d` holds a digest for every CUSTOM_FORMULA component (referenced or not); a second `_declared_formula_warmup` for an already-cached id leaves `d` untouched and issues no RPC.
4. `AC-1` part: two `FormulaDefinition`s differing only in `source` produce different digests through the read; differing only in `author` produce the same digest.
5. Without `digests`, behaviour is unchanged: `_formula_fundamentals(definition, meta)` returns the same map as before for a fundamentals formula (`fundamental_inputs` non-empty).

**Verification**:
```bash
cd services/xstockstrat-analysis
uv run pytest tests/test_formula_digest_read.py -q
uv run pytest tests/test_analysis_servicer.py -q -k "prefetch or deleted or IndicatorSeries"
grep -n "def .*fixture\|from .conftest\|conftest" tests/test_formula_digest_read.py    # C-13: inline, single consumer
uv run pytest --cov=app --cov-fail-under=40
ruff check . && ruff format --check .
```

---

### Step 7 — service: owner-scoped `latest_formula_fingerprint` prefix read

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/app/repositories/backtest_run_symbols.py` — modify

**Reviewers**: xstockstrat-analysis service owner — Backtest reproducibility, strategy scoring determinism, no look-ahead bias

**Codebase Evidence**:
- `class BacktestRunSymbolsRepository` at `services/xstockstrat-analysis/app/repositories/backtest_run_symbols.py:23`; `fetch_eligible(self, user_id, strategy_id, fingerprint)` at `:67-86` and `fetch_all_for_fingerprint` at `:88-106` — both exact-match `definition_fingerprint = $2 AND user_id = $3`, both stay unchanged (R-5: a bare legacy cell is never selected).
- Column is TEXT: `definition_fingerprint TEXT NULL` (`migrations/007_backtest_run_symbols.up.sql:18`); `user_id TEXT` added at `migrations/026_owner_dimension_templates.up.sql:30`; index `idx_brs_owner_eligibility (user_id, strategy_id, definition_fingerprint, symbol, …)` at `026…up.sql:44-46`.
- Rejected: R-8 (no byte-range predicate — non-C collation), R-9 (no new column / migration).
- Ledger trap fails.md:1152/1531: every new cross-entity read is owner-scoped (`user_id` equality).

**Lands with**: `Step 8`

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
Add after `fetch_all_for_fingerprint`:
```python
async def latest_formula_fingerprint(self, user_id: str, strategy_id: str, def_hash: str) -> str | None:
```
running `SELECT definition_fingerprint FROM analysis.backtest_run_symbols WHERE user_id = $1 AND strategy_id = $2 AND starts_with(definition_fingerprint, $3) ORDER BY completed_at DESC LIMIT 1` via `self._db.fetchval(...)` with `$3 = def_hash + "."`. Returns the newest formula-aware fingerprint for the owner's strategy, or `None`.
Docstring (state the constraints, not the mechanism): owner-scoped; matches only composite fingerprints (`<def_hash>.<suffix>`), never a bare pre-feature hash; uses only the `(user_id, strategy_id)` equality prefix of `idx_brs_owner_eligibility` followed by an in-memory sort, so its cost grows with the strategy's cell count (O-20); ordering by `completed_at` may pick a slightly older composite when runs complete concurrently (accepted).

**Verification**:
```bash
cd services/xstockstrat-analysis
grep -n "async def latest_formula_fingerprint" app/repositories/backtest_run_symbols.py
grep -n "starts_with(definition_fingerprint" app/repositories/backtest_run_symbols.py
uv run pytest tests/test_backtest_run_symbols_repo.py tests/test_backtest_run_symbols_real_pg.py -q
ruff check . && ruff format --check .
```

---

### Step 8 — test: the prefix read against SQL shape and a real PostgreSQL

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/tests/test_backtest_run_symbols_repo.py` — modify
- `services/xstockstrat-analysis/tests/test_backtest_run_symbols_real_pg.py` — create

**Reviewers**: xstockstrat-analysis service owner — Backtest reproducibility, strategy scoring determinism, no look-ahead bias

**Codebase Evidence**:
- SQL-shape test pattern: `tests/test_backtest_run_symbols_repo.py:75-94` (`test_fetch_eligible_traded_first_distinct_on_sql`, asserting fragments of the captured SQL); the `_cell(symbol, trades, days, fp)` helper at `:19`.
- `real_pg` harness: session fixture `local_pg` at `tests/conftest.py:438` (yields a DSN; skips locally without PostgreSQL binaries, **fails** under `CI=true`); marker registered at `pyproject.toml:34`; pattern to copy: `tests/test_strategy_templates_real_pg.py:12` (`pytestmark = pytest.mark.real_pg`), `:21-24` (`_pool`), `:44-48` (`CREATE SCHEMA IF NOT EXISTS analysis` + DDL extracted from the migration file). CI provisions PostgreSQL for analysis (`.github/workflows/ci.yml:508-512`), so the claim "CI proves it" holds (fails.md:3302).
- **Not found** — no `tests/test_backtest_run_symbols_real_pg.py`; created from scratch.

**Lands with**: `Step 7`

**TDD**: `red-green required`

**Covers**: `AC-3`

**Instructions**:
1. In `tests/test_backtest_run_symbols_repo.py` add `test_latest_formula_fingerprint_is_owner_scoped_prefix_read`: `repo._db.fetchval = AsyncMock(return_value="h.x")`; assert the SQL contains `user_id = $1`, `strategy_id = $2`, `starts_with(definition_fingerprint, $3)`, `ORDER BY completed_at DESC`, `LIMIT 1`, and the args are `("alice", "s1", "h.")`.
2. Create `tests/test_backtest_run_symbols_real_pg.py` (`pytestmark = pytest.mark.real_pg`), mirroring `tests/test_strategy_templates_real_pg.py`: build the table from `migrations/007_backtest_run_symbols.up.sql` (the `CREATE TABLE IF NOT EXISTS analysis.backtest_run_symbols (…);` statement only) plus `ALTER TABLE analysis.backtest_run_symbols ADD COLUMN IF NOT EXISTS user_id TEXT` (`026…up.sql:30`), read from the migration files rather than re-typed. Insert rows with explicit `completed_at` and assert:
   - a bare `"h"` cell and a `"h.aaa"` cell → returns `"h.aaa"` (the bare pre-feature hash is never returned — `AC-3`);
   - two composites `"h.aaa"` (older) and `"h.bbb"` (newer) → `"h.bbb"`;
   - another owner's `"h.zzz"` and another strategy's `"h.yyy"` are ignored;
   - a different definition hash sharing a textual prefix (`"hh.ccc"`) is ignored; `NULL` fingerprints are ignored;
   - only bare cells → `None`.
   Rows are local to this file (single consumer — C-13 inline).

**Verification**:
```bash
cd services/xstockstrat-analysis
uv run pytest tests/test_backtest_run_symbols_repo.py tests/test_backtest_run_symbols_real_pg.py -q -rs    # real_pg must run (not skip) where PostgreSQL binaries exist; CI=true fails instead of skipping
grep -n "def .*fixture\|from .conftest\|conftest" tests/test_backtest_run_symbols_real_pg.py    # C-13 verdict: inline rows, local_pg from conftest
uv run pytest --cov=app --cov-fail-under=40
ruff check . && ruff format --check .
```

---

### Step 9 — service: `_run_backtest` stamps the formula-aware fingerprint

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/app/handlers/servicer.py` — modify

**Reviewers**: xstockstrat-analysis service owner — Backtest reproducibility, strategy scoring determinism, no look-ahead bias

**Codebase Evidence**:
- `_run_backtest(self, request, context, disarm)` at `servicer.py:848`. Early fingerprint block at `:925-933` (comment `:925-926`) (`run_fingerprint = None` … `if request.strategy_id_ref and request.strategy_id == request.strategy_id_ref and executed_row is not None: run_fingerprint = _definition_fingerprint(executed_row["definition_json"])`).
- Formula-map build at `:989-1008`: `fund_failures: dict = {}` (`:990`), `formula_fund_map: dict[str, list] = {}` (`:994`), `await self._prefetch_formula_warmups(active_definition, formula_warmup_cache, propagation_meta, formula_deleted_cache, formula_fund_map, failures=fund_failures)` (`:997-1004`) when `start_set`, else `formula_fund_map = await self._formula_fundamentals(active_definition, propagation_meta, failures=fund_failures)` (`:1006-1008`).
- Formula warnings: `if formula_deleted_cache: result.warnings.extend(formula_deleted_cache.values())` at `:1344-1345`.
- Stamp: `fingerprint=run_fingerprint` in the `_persist_symbol_cells` call at `:1376-1384` (keyword at `:1380`).
- Recompute: `await self._recompute_headline(caller_user_id, request.strategy_id, fund_cache=fund_cache, failures=fund_failures, meta=propagation_meta)` at `:1418-1424`; `except _GradeInputsUnknown as e: log.warning("fundamentals availability unknown — grade unchanged: %s", e)` at `:1425-1426`. `_recompute_headline(self, user_id, strategy_id, **derive_kw)` (`:2929`) forwards keywords to `_fetch_and_aggregate`, which already accepts `formula_cache=` (`:2878`).
- A refusal makes every symbol FORMULA_ERROR on the backtest path (`app/services/evaluator.py:267-271`), so a refused run loses no evidence by stamping `None` (D-10).

**Lands with**: `Step 10`

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. Replace the early block at `:925-933` with only the eligibility flag: keep the comment, and compute `stamps_fingerprint = bool(request.strategy_id_ref and request.strategy_id == request.strategy_id_ref and executed_row is not None)`.
2. Before the formula-map build (`:989`), declare `formula_digests: dict = {}`; pass `digests=formula_digests` to the `_prefetch_formula_warmups` call (`:997-1004`) and to the `_formula_fundamentals` call (`:1006-1008`).
3. Directly after the formula-map build, set `run_fingerprint = None` and, when `stamps_fingerprint`: if every value in `formula_digests` is a `str`, `run_fingerprint = _evidence_fingerprint(executed_row["definition_json"], formula_digests)` (no CUSTOM_FORMULA component → empty dict → the bare `_definition_fingerprint`, byte-identical to today); otherwise leave it `None` — for an outage (`None`) and for a refusal (`_UNREADABLE`) alike.
4. Add a module constant next to `_UNREADABLE`: `_FORMULA_VERSION_WARNING = "evidence not recorded: formula version unavailable — rerun"`. After the `formula_deleted_cache` warnings (`:1344-1345`), append it to `result.warnings` once when `stamps_fingerprint` and any digest `is None` (an outage only — a rerun cannot fix a refusal, O-21).
5. Before the recompute (`:1417`), build the run-level seed `recompute_formulas = {fid: _FormulaRead(formula_fund_map.get(fid, []), d) for fid, d in formula_digests.items() if d is not None}` (readable formulas with their metrics, refused ones as `_FormulaRead([], _UNREADABLE)`; an outage is not seeded) and pass `formula_cache=recompute_formulas` in the `_recompute_headline` call (`:1418-1424`) — one `GetFormula` per formula per run (C-18, O-22).
6. Add `except _FormulaVersionUnknown as e: log.warning("formula version unavailable — grade unchanged: %s", e)` **before** the existing `except _GradeInputsUnknown` at `:1425` (O-23).

**Verification**:
```bash
cd services/xstockstrat-analysis
grep -n "run_fingerprint = _definition_fingerprint" app/handlers/servicer.py    # no match
grep -n "_FORMULA_VERSION_WARNING\|formula_cache=recompute_formulas\|except _FormulaVersionUnknown" app/handlers/servicer.py
uv run pytest tests/test_run_backtest_fingerprint.py tests/test_analysis_servicer.py tests/test_grade_fundamentals_exclusion.py tests/test_unreadable_formula.py tests/test_backtest_fundamentals_guard.py -q
ruff check . && ruff format --check .
```

---

### Step 10 — test: backtest stamp, outage warning and single formula read per run

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/tests/test_run_backtest_fingerprint.py` — create
- `services/xstockstrat-analysis/tests/test_analysis_servicer.py` — modify (only if an existing assertion turns red; see instruction 6)

**Reviewers**: xstockstrat-analysis service owner — Backtest reproducibility, strategy scoring determinism, no look-ahead bias

**Codebase Evidence**:
- **Not found** — no `tests/test_run_backtest_fingerprint.py`; created from scratch.
- Registered-own-run harness to mirror: `tests/test_analysis_servicer.py:2303-2330` (`test_registered_own_run_stamps_fingerprint`: `_strategies_repo.get_by_owner_and_id` returns the row, `svc._backtest_symbol_evaluated = AsyncMock(side_effect=lambda symbol=None, **kw: ([], 100_000.0, curve, diag, []))`, cells read from `svc._backtest_run_symbols_repo.insert_many.await_args.args[0]`); it stays green unchanged (no formula → bare hash).
- Windowed/prefixed request helper `_windowed_req(definition, *, start, end, symbols)` at `tests/test_analysis_servicer.py:3917`; row helper `_row_for(definition)` at `:676`; `_owned_ctx()` at `:72`; a CUSTOM_FORMULA definition literal at `:6845-6854`.
- Recompute-kwargs assertion pattern: `tests/test_grade_fundamentals_exclusion.py:160-168` (`svc._recompute_headline = AsyncMock(return_value=None)` → `svc._recompute_headline.await_args.kwargs`).
- `GetFormula` count pins that must stay green: `tests/test_analysis_servicer.py:4274`, `:6858`.

**Lands with**: `Step 9`

**TDD**: `red-green required`

**Covers**: `AC-1`

**Instructions**:
Create `tests/test_run_backtest_fingerprint.py`; reuse `make_servicer`, `_owned_ctx`, `_row_for`, `_windowed_req` by import from `tests.test_analysis_servicer`. The CUSTOM_FORMULA definition is declared once in this file (single consumer — C-13 inline). Cover both formula-map paths (prefixed via `_windowed_req`, and unprefixed) with a parametrize where the harness allows.
1. `AC-1` stamp: a registered own run of a strategy with a CUSTOM_FORMULA component on `f-9` stamps every cell with `_evidence_fingerprint(definition_json, {"f-9": _formula_digest(formula)})`; re-running after changing only the formula's `source` stamps a **different** fingerprint; changing only `author` stamps the **same** one. RED before Step 9: cells carry the bare `_definition_fingerprint`.
2. Outage: `GetFormula` UNAVAILABLE → every inserted cell (if any) has `definition_fingerprint is None` and `_FORMULA_VERSION_WARNING` is in `result.warnings` exactly once.
3. Refusal: `GetFormula` NOT_FOUND → fingerprint `None`, and `_FORMULA_VERSION_WARNING` is **not** in `result.warnings`.
4. An inline / id-mismatch run with a formula outage carries **no** `_FORMULA_VERSION_WARNING` (it never records evidence).
5. Single read: with `svc._recompute_headline = AsyncMock(return_value=None)`, the call's `formula_cache` kwarg holds `_FormulaRead` for the readable fid (digest equal to the stamped one) and `_FormulaRead([], _UNREADABLE)` for a refused fid; with the real recompute on a registered strategy `svc._indicators.GetFormula.await_count == 1` for the whole run. Pin that count with a strategy that has **one** CUSTOM_FORMULA component per formula id. Add a separate duplicate-component case (two components on the same non-fundamentals `f-9`): `_formula_fundamentals` skips a repeated fid only once it is in `out`, i.e. only for a fundamentals formula (`if fid in out: continue`, `servicer.py:1938-1939`), and the unprefixed path calls it without `cache=` (`:1006-1008`), so that shape issues a second `GetFormula` today (existing behaviour, not changed by this feature; the `digests` write is idempotent). For that case assert only that the stamp equals the one-component stamp — do **not** assert `await_count == 1` on the unprefixed path; if the prefixed path (`_prefetch_formula_warmups`, cached per id) shows more than one read, stop and report.
6. Run the full suite. If an existing assertion in `tests/test_analysis_servicer.py` fails **only** because a registered own run of a CUSTOM_FORMULA strategy now stamps the composite instead of the bare hash, update that assertion to `_evidence_fingerprint(...)`; any other failure is a blocker to report, not to patch.
7. When `_recompute_headline` raises `_FormulaVersionUnknown("f-9")`, the run still returns OK and the log carries "formula version unavailable — grade unchanged" (mirror `tests/test_grade_fundamentals_exclusion.py:310-317`).

**Verification**:
```bash
cd services/xstockstrat-analysis
uv run pytest tests/test_run_backtest_fingerprint.py -q
grep -n "def .*fixture\|from .conftest\|conftest" tests/test_run_backtest_fingerprint.py    # C-13: inline, single consumer
uv run pytest --cov=app --cov-fail-under=40
ruff check . && ruff format --check .
```

---

### Step 11 — service: `_fetch_and_aggregate` reads by the formula-aware fingerprint; `ScoreStrategy` messages

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/app/handlers/servicer.py` — modify

**Reviewers**: xstockstrat-analysis service owner — Backtest reproducibility, strategy scoring determinism, no look-ahead bias

**Codebase Evidence**:
- `_fetch_and_aggregate(self, user_id, strategy_id, strategy_row, *, fund_cache=None, formula_cache=None, failures=None, meta=None, sem=None, excluded=None)` at `servicer.py:2871-2927`: `fingerprint = _definition_fingerprint(strategy_row["definition_json"])` (`:2894`), `definition = _row_to_strategy_definition(strategy_row)` (`:2895`), `guarded` (`:2896-2900`), gate-off read `fetch_eligible` (`:2901-2907`), gate-on read `fetch_all_for_fingerprint` (`:2908-2912`), `_exclude_refused_cells(... formula_cache=formula_cache if formula_cache is not None else {}, failures=failures if failures is not None else {}, meta=meta if meta is not None else owner_metadata(user_id), sem=sem)` (`:2913-2922`), the `excluded` out-list pattern (`:2923-2924`).
- `_exclude_refused_cells` reads the same cache: `await self._formula_fundamentals(definition, meta, cache=formula_cache, failures=failures)` at `:2819-2821`.
- The four callers (O-11; `grep -n "_fetch_and_aggregate(" app/handlers/servicer.py`): `ScoreStrategy` `:2659-2665`; `_recompute_headline_locked` `:2954`, reached from `_recompute_headline` (`:2929-2945`) by `_run_backtest` (`:1418`) and the boot pass `recompute_unscored_pairs` (`:3108-3115`, per-owner `formula_caches.setdefault(user_id, {})` at `:3112`, one shared `failures` dict at `:3105`), and directly by ManageStrategy UPDATE (`:3403-3405`).
- `ScoreStrategy` error mapping: `except _GradeInputsUnknown as e:` → `log.warning("score: fundamentals availability unknown for %s", e.symbol)` → UNAVAILABLE `"fundamentals availability unknown — grade unchanged"` at `:2666-2672`; `excluded: list[str] = []` at `:2657`; the no-evidence branch `:2677-2698` ending `NOT_FOUND "no eligible evidence — run a backtest"` (`:2695-2697`).
- Gate read: `self._cfg.get_bool("backtest.fundamentals.enabled", False)` (`:2896`) — an existing seeded key; no new config reader (C-05 not triggered).
- Durable rule to preserve: `@AC-23 @feature-289` (`services/xstockstrat-analysis/acceptance/block-fundamentals-strategy-on-etf.feature:97-102`) — refusal succeeds with trailer `"[]"`, outage keeps the pinned message.
- Header propagation (§B): no new outbound RPC; the formula read reuses `_formula_fundamentals` with the caller's `meta` (inbound trio for interactive paths, `owner_metadata(user_id)` for the boot path — `:2920`).
- Gate-off behaviour change (acknowledged): every CUSTOM_FORMULA strategy now issues `GetFormula` on `ScoreStrategy` and on each recompute even with `backtest.fundamentals.enabled` off, and a formula outage then aborts UNAVAILABLE where it did not before. The C-16 sign-off for this coupling and for the `@AC-23 @feature-289` treatment **is recorded**: context.md "Session 2026-11-20 — sdd-design", bullet "Operator decision (binding, recorded 2026-11-20, design gate)"; design.md "Business Rules Touched (C-16)".
- Agent contract: the UNAVAILABLE text added here is allow-listed by the agent in Step 16 and pinned against this file's source in Step 17 as the literal assignment `_FORMULA_VERSION_UNKNOWN_MSG = "formula version unavailable — grade unchanged"` — keep it a single-line module-level assignment with exactly that text (AGENT-10, `services/xstockstrat-agent/docs/context-constitution.md:25`).

**Lands with**: `Step 12`

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
0. Phase-2 gate, before any write: obtain the operator's explicit acknowledgement of the unrecoverable refused population (O-18 — a strategy whose formula is refused at rollout and that holds only pre-feature cells answers NOT_FOUND until the formula is readable; 028 template instances, the 029 blend) and record it in `context.md`. This step ships that behaviour; without the acknowledgement, stop and report.
1. `_fetch_and_aggregate`: add keyword `unreadable=None` (an out-list, mirroring `excluded`). At the top, bind once: `formula_cache = formula_cache if formula_cache is not None else {}`, `failures = failures if failures is not None else {}`, `meta = meta if meta is not None else owner_metadata(user_id)`; pass those bound names (no inline defaults) to `_exclude_refused_cells` at `:2913-2922` (D-11).
2. Replace `:2894` with: `def_hash = _definition_fingerprint(strategy_row["definition_json"])`, build `definition` (existing `:2895`), `fingerprint = def_hash`. When the definition has at least one `COMPONENT_KIND_CUSTOM_FORMULA` component with a `formula_id`:
   - `digests: dict = {}`; `await self._formula_fundamentals(definition, meta, cache=formula_cache, failures=failures, digests=digests)` — **before** any cell read;
   - if any digest `is None`: `raise _FormulaVersionUnknown(<first such fid in sorted order>)`;
   - elif any digest `is _UNREADABLE`: `fingerprint = await self._backtest_run_symbols_repo.latest_formula_fingerprint(user_id, strategy_id, def_hash)`; when that is `None`, extend `unreadable` (if given) with the sorted refused fids and `return None` (the existing no-evidence path); the newest composite is used as a whole even when other formulas are readable (accepted limitation O-19);
   - else `fingerprint = _evidence_fingerprint(strategy_row["definition_json"], digests)`.
   The rest of the method (gate-off `fetch_eligible`, gate-on `fetch_all_for_fingerprint` + `_exclude_refused_cells`) is unchanged and uses `fingerprint`. Update the docstring's first sentence to say the fingerprint is the formula-aware evidence fingerprint.
3. `ScoreStrategy`: add a module constant next to `_FORMULA_VERSION_WARNING`: `_FORMULA_VERSION_UNKNOWN_MSG = "formula version unavailable — grade unchanged"`. Insert, **before** `except _GradeInputsUnknown` (`:2666`): `except _FormulaVersionUnknown as e:` → `log.warning("score: formula version unavailable for %s", e.formula_id)` → abort UNAVAILABLE with the pinned `"fundamentals availability unknown — grade unchanged"` when `self._cfg.get_bool("backtest.fundamentals.enabled", False)` is true, else with `_FORMULA_VERSION_UNKNOWN_MSG`; `return`.
4. `ScoreStrategy`: declare `unreadable: list[str] = []` beside `excluded` (`:2657`), pass `unreadable=unreadable` to `_fetch_and_aggregate`, and in the no-evidence branch add, before the `if excluded:` check (`:2688`): when `unreadable`, abort `NOT_FOUND` with `f"no eligible evidence — formula {', '.join(unreadable)} is not readable and no evidence was recorded for a readable version; restore access to the formula or rebind the component, then run a backtest"`. The stale-grade clear above it (`:2680-2687`) is unchanged.
5. No change to `_recompute_headline`, `_recompute_headline_locked` or `recompute_unscored_pairs`: `_FormulaVersionUnknown` propagates as a `_GradeInputsUnknown` (grade kept) and the boot pass logs it per pair (`:3116-3117`).

**Verification**:
```bash
cd services/xstockstrat-analysis
grep -n "latest_formula_fingerprint\|_FORMULA_VERSION_UNKNOWN_MSG\|unreadable=unreadable" app/handlers/servicer.py
grep -n "fingerprint = _definition_fingerprint(strategy_row" app/handlers/servicer.py    # no match
uv run pytest tests/test_evidence_grade_formula_aware.py tests/test_grade_fundamentals_exclusion.py tests/test_analysis_servicer.py tests/test_unreadable_formula.py tests/test_owner_dimension.py -q
ruff check . && ruff format --check .
```

---

### Step 12 — test: AC-1 end to end, refusal fallback, gate-off outage, owner isolation

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/tests/test_evidence_grade_formula_aware.py` — create
- `services/xstockstrat-analysis/tests/test_grade_fundamentals_exclusion.py` — modify

**Reviewers**: xstockstrat-analysis service owner — Backtest reproducibility, strategy scoring determinism, no look-ahead bias

**Codebase Evidence**:
- **Not found** — no `tests/test_evidence_grade_formula_aware.py`; created from scratch.
- Derivation harness: `_derivation_svc(cells, definition_json=None, strategy_id="s1")` at `tests/test_analysis_servicer.py:110-134` (AsyncMock strategies repo, `svc._backtest_run_symbols_repo = AsyncMock()` with `fetch_eligible`, AsyncMock scores repo); `_eligible_cell(...)` at `:97`; `_owned_ctx()` at `:72`.
- Formula-strategy harness: `tests/test_grade_fundamentals_exclusion.py` — `_wire(svc, cells, *, pit=None, gate=True)` (`:67-84`, sets the gate, `fetch_all_for_fingerprint`, a readable `GetFormula`), `_blend_svc` (`:87-91`), `_cell` (`:55`), `_rpc_error(code)` (`:63`), `_score` / `_score_aborts` (`:224-233`), `_UNKNOWN_MSG` (`:47`), `_SID` (`:46`).
- Tests to amend / keep green: `test_ac23_refused_formula_score_strategy_succeeds_with_empty_trailer` (`:501-506`) — after Step 11 a refusal calls `latest_formula_fingerprint`, which on the bare `AsyncMock()` repo returns a truthy mock rather than a fingerprint; `test_ac23_formula_outage_score_strategy_still_aborts_unavailable` (`:510-514`); `test_boot_pass_refusal_for_one_owner_never_poisons_another` (`:521-539`, the per-owner cache at `servicer.py:3112`); `test_gate_off_keeps_today_path` (`:473-478`); `test_non_fundamentals_strategy_makes_no_marketdata_calls_byte_identical` (`:459-469`, asserts `svc._indicators.method_calls == []` — must still hold: no CUSTOM_FORMULA → no formula read).

**Lands with**: `Step 11`

**TDD**: `red-green required`

**Covers**: `AC-1, AC-3, AC-4`

**Instructions**:
1. Create `tests/test_evidence_grade_formula_aware.py`, importing the harness helpers above (as `tests/test_grade_fundamentals_exclusion.py:29-43` does) and adding one local fake cells repository keyed by fingerprint — a small class with `fetch_eligible`, `fetch_all_for_fingerprint`, `latest_formula_fingerprint` and `insert_many` over an in-memory list, so the test proves *which* fingerprint is asked for instead of returning cells for any key (single consumer — C-13 inline).
   - **`AC-1`** `test_ac1_formula_edit_stops_pre_edit_evidence`: strategy with a CUSTOM_FORMULA on `f-9`; the fake repo holds AAPL/MSFT/NVDA cells stamped `_evidence_fingerprint(dj, {"f-9": _formula_digest(v1)})`. With `GetFormula` returning `v1`, `ScoreStrategy` succeeds with `evidence_symbols == 3`. Switch `GetFormula` to `v2` (same formula, materially different `source`): `ScoreStrategy` aborts `NOT_FOUND "no eligible evidence — run a backtest"`, the stale grade is cleared, and no cell was deleted (the fake repo still holds 3 rows — PRESERVE `@AC-11 @feature-215`). An `author`-only change keeps `evidence_symbols == 3`. Run for gate on and gate off. RED before Step 11: the read asks for the bare hash.
   - **`AC-3`** `test_ac3_refusal_grades_on_newest_formula_aware_cells`: repo holds bare-`def_hash` cells for AAPL and MSFT plus one composite cell for AAPL; `GetFormula` NOT_FOUND → `ScoreStrategy` succeeds with `evidence_symbols == 1`. With only bare cells → abort `NOT_FOUND` whose message contains `f-9` and `not readable` (and not `run a backtest` alone). Parametrize PERMISSION_DENIED.
   - **`AC-4`** `test_ac4_gate_off_outage_aborts_unavailable_grade_untouched`: gate off, a grade pre-seeded in `svc._strategies`, `GetFormula` UNAVAILABLE → abort `(grpc.StatusCode.UNAVAILABLE, "formula version unavailable — grade unchanged")`; the fake repo recorded **no** read; `svc._scores_repo.delete` / `upsert` not awaited; the in-memory grade is still present. Companion: gate **on** + outage still aborts with `_UNKNOWN_MSG` (the `@AC-23` clause).
   - Mixed formulas (O-19 pin): two CUSTOM_FORMULA components, one refused and one readable → the newest composite is used as a whole.
   - Owner isolation (load-bearing, design Open Risks): boot pass `recompute_unscored_pairs` over `("u1", sid)` and `("u2", sid)` where `GetFormula` returns different `source` per `x-user-id` → each owner's read asks for its **own** composite fingerprint (assert the fingerprints the fake repo received per `user_id` differ and match each owner's digest); a refusal for `u1` never changes `u2`'s fingerprint.
   - Boot/outage: `recompute_unscored_pairs` with `GetFormula` UNAVAILABLE leaves the grade (no delete/upsert) and logs `boot recompute failed`.
2. Amend `tests/test_grade_fundamentals_exclusion.py`:
   - `test_ac23_refused_formula_score_strategy_succeeds_with_empty_trailer` (`:501-506`): set `svc._backtest_run_symbols_repo.latest_formula_fingerprint = AsyncMock(return_value="<def_hash>.x")` and assert `fetch_all_for_fingerprint` was awaited with that value; the trailer / `evidence_symbols == 2` assertions stay (PRESERVE `@AC-23 @feature-289`).
   - `test_boot_pass_refusal_for_one_owner_never_poisons_another` (`:521-539`): give the repo the same explicit `latest_formula_fingerprint` return; assertions unchanged.
   - Any other test in this file that fails only because a bare `AsyncMock()` repo now answers `latest_formula_fingerprint` gets the same explicit mock; a failure for any other reason is a blocker to report.

**Verification**:
```bash
cd services/xstockstrat-analysis
uv run pytest tests/test_evidence_grade_formula_aware.py -q -k "ac1 or ac3 or ac4"
uv run pytest tests/test_grade_fundamentals_exclusion.py -q
grep -n "def .*fixture\|from .conftest\|conftest" tests/test_evidence_grade_formula_aware.py    # C-13: inline fake repo, single consumer
uv run pytest --cov=app --cov-fail-under=40
ruff check . && ruff format --check .
```

---

### Step 13 — service: ManageStrategy UPDATE pops the grade only when the definition hash changes

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/app/handlers/servicer.py` — modify

**Reviewers**: xstockstrat-analysis service owner — Backtest reproducibility, strategy scoring determinism, no look-ahead bias

**Codebase Evidence**:
- UPDATE branch of `ManageStrategy` (`servicer.py:3236`): the unlocked pre-read `pre = await self._strategies_repo.get_by_owner_and_id(...)` at `:3328-3330` (**not** the guard's source — open risk); `async def _apply(current, _defn=definition, _mask=mask_paths, _has=has_mask):` at `:3348` with `old_json = current["definition_json"] or {}` at `:3349` (the row locked by `update_locked`); `row = await self._strategies_repo.update_locked(caller_user_id, definition.strategy_id, _apply)` at `:3383-3385`.
- Pop + recompute at `:3400-3407` (re-grepped at execute re-spec 2026-11-27: comment `:3397-3398`, `sid = …` `:3399`, lock `:3400`, pop `:3401`, recompute `:3402-3405`, `except` `:3406-3407`): `async with self._lock_for(caller_user_id, sid): self._strategies.pop((caller_user_id, sid), None)` then `try: await self._recompute_headline_locked(caller_user_id, sid, row, meta=propagation_meta)` / `except Exception as e: log.warning("failed to recompute headline after update: %s", e)`.
- `update_locked` runs `apply_fn(_to_dict(row))` inside `SELECT … FOR UPDATE` (`app/repositories/strategies.py:100-143`, call at `:126`); `apply_fn` must do no I/O — hashing is pure.
- `_recompute_headline_locked` itself clears the grade on zero evidence (`:2955-2962`), so an unchanged hash with no evidence still clears.
- Binding operator decision 2026-11-20 (context.md, design.md step 6); rejected alternative R-7 (unconditional pop). Durable rule: `@AC-2 @regression @feature-194` (`services/xstockstrat-analysis/acceptance/fix-strategy-signal-params-dead-keys.feature:18-23`).

**Lands with**: `Step 14`

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. Before `_apply` (`:3348`), declare a one-slot holder `locked_hash: list[str] = []`. As the first statement after `old_json = …` (`:3349`), `locked_hash[:] = [_definition_fingerprint(old_json)]` — the hash of the **locked** row's definition, never of `pre`.
2. At `:3400-3407`, replace the unconditional pop (`:3401`) with: `changed = not locked_hash or locked_hash[0] != _definition_fingerprint(row["definition_json"])`; inside the lock, `if changed: self._strategies.pop((caller_user_id, sid), None)`. The recompute call and its `except Exception` are unchanged (an unchanged hash still recomputes; `_FormulaVersionUnknown` is swallowed there and the grade stays).
3. Replace the two-line comment at `:3397-3398` with the constraint: the grade is cleared first only when the definition hash of the row locked by `update_locked` differs from the written one; a rename must keep the grade when the recompute cannot run.
Known limitation (documented in Step 15, not handled here): a behavioural edit during a `GetFormula` outage still clears the in-memory grade.

**Verification**:
```bash
cd services/xstockstrat-analysis
grep -n "locked_hash" app/handlers/servicer.py    # declaration, write inside _apply, read after update_locked
uv run pytest tests/test_update_grade_guard.py tests/test_analysis_servicer.py tests/test_grade_fundamentals_exclusion.py tests/test_unreadable_formula.py -q
ruff check . && ruff format --check .
```

---

### Step 14 — test: a rename during a `GetFormula` outage keeps the grade

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/tests/test_update_grade_guard.py` — create

**Reviewers**: xstockstrat-analysis service owner — Backtest reproducibility, strategy scoring determinism, no look-ahead bias

**Codebase Evidence**:
- **Not found** — no `tests/test_update_grade_guard.py`; created from scratch.
- UPDATE harness: `_stub_update_repo(svc, current_row)` at `tests/test_analysis_servicer.py:2501-2516` (its `update_locked` genuinely awaits `apply_fn(current_row)`, so the locked-row hash is exercised); `_update_req(strategy_id="s1", rhs=1, mask_paths=None)` at `:2471`; `_updated_row(strategy_id="s1", rhs=1)` at `:2519`; `_owned_ctx()` at `:72`.
- Existing UPDATE-recompute test to keep green: `tests/test_grade_fundamentals_exclusion.py:320-333` (`test_update_keeps_db_grade_and_forwards_trio`).
- Write-path formula outage is swallowed (design R-7, `servicer.py` `_fetch_formula_outputs` / `_formula_status_warnings` on the UPDATE path at `:3342-3346`) — confirm by the test itself: the rename must return successfully with `GetFormula` UNAVAILABLE; if it does not, stop and report (do not weaken the scenario).

**Lands with**: `Step 13`

**TDD**: `red-green required`

**Covers**: `AC-5`

**Instructions**:
Create `tests/test_update_grade_guard.py`, importing the UPDATE harness from `tests.test_analysis_servicer`. The CUSTOM_FORMULA row is declared once in this file (single consumer — C-13 inline).
1. **`AC-5`** `test_ac5_rename_during_formula_outage_keeps_grade`: current row has a CUSTOM_FORMULA component on `f-9`; a grade is seeded in `svc._strategies[("u1", sid)]`; `GetFormula` raises UNAVAILABLE; the request is a rename only (`update_mask` = `["display_name"]`). Assert the RPC returns the renamed strategy, `svc._strategies[("u1", sid)]` is the **same** score object, and `svc._scores_repo.delete` / `upsert` were not awaited. RED before Step 13: the unconditional pop removes the grade.
2. Locked-row source (open risk): make `get_by_owner_and_id` (the `pre` read) return a row whose `definition_json` differs behaviourally from the row `update_locked` hands to `apply_fn`, then send a rename — the grade is kept (hash compared against the locked row, not `pre`); and the mirrored case (`pre` equal to the written definition, locked row different) pops.
3. Behavioural edit: changing the entry rule (`rhs`) pops the in-memory grade before the recompute, with and without a formula outage (the documented limitation).
4. Unchanged hash, recompute succeeds with zero evidence → the grade is cleared by `_recompute_headline_locked` (no regression of the no-evidence clear).

**Verification**:
```bash
cd services/xstockstrat-analysis
uv run pytest tests/test_update_grade_guard.py -q -k ac5
uv run pytest tests/test_update_grade_guard.py tests/test_analysis_servicer.py -q -k "update or Update or rename or DeadSignalParams"
grep -n "def .*fixture\|from .conftest\|conftest" tests/test_update_grade_guard.py    # C-13: inline, single consumer
uv run pytest --cov=app --cov-fail-under=40
ruff check . && ruff format --check .
```

---

### Step 15 — docs: ANALYSIS-3, ANALYSIS-7, `scoring.md` and the recorded limitations

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/docs/context-constitution.md` — modify
- `services/xstockstrat-analysis/docs/scoring.md` — modify

**Reviewers**: none

**Codebase Evidence**:
- ANALYSIS-3 row at `services/xstockstrat-analysis/docs/context-constitution.md:16` — contains "**Fingerprint blind spot:** a formula's `fundamental_inputs` live in indicators, outside `definition_json`, so editing them neither resets evidence nor changes the fingerprint", and stale anchors (`#_definition_fingerprint (~L7285 …)`, `#run_fingerprint (~L918-924)`, `#_fetch_and_aggregate (~L2859)`).
- ANALYSIS-7 row at `:20` — says "the gate is mirrored at **four** sites and two do not import the constant — `app/engine/entry_backfill.py` re-types the SQL literal, …".
- `services/xstockstrat-analysis/docs/scoring.md`: "Fingerprint eligibility" bullet at `:13-20`; "Recompute triggers" bullet at `:35-44` ("after a `ManageStrategy` UPDATE (which first **unconditionally clears** the in-memory grade …)" at `:37-38`, `NOT_FOUND "no eligible evidence — run a backtest"` at `:41`); "Rename / revert semantics" at `:46`.
- Readiness limitation source: `app/services/readiness.py:16-35` (`is_readiness_row_fresh` compares `def_fingerprint`; `readiness_valid_until`).
- No root-`CLAUDE.md` or `services/xstockstrat-analysis/CLAUDE.md` text is invalidated (its line 4 pointer "definition-json fingerprint eligibility" and line 121 pointer to `docs/scoring.md` stay accurate), so neither file is edited.

**TDD**: `N/A (docs)`

**Covers**: —

**Instructions**:
1. ANALYSIS-3 (`context-constitution.md:16`): replace the "Fingerprint blind spot" sentence with the landed rule — evidence eligibility is keyed on the **evidence fingerprint** `_evidence_fingerprint`: the definition hash alone when the strategy has no CUSTOM_FORMULA component, else `<def_hash>.<sha256 of sorted fid=digest>` where the digest covers the formula's behavioural fields only (never `updated_at`/`author`/descriptions); the digest rides the single `GetFormula` read; an outage never stamps or reads (`run_fingerprint = None` + run warning; `_FormulaVersionUnknown`, grade kept); a refusal at score time grades on the newest composite via `latest_formula_fingerprint` and never on a bare pre-feature cell; readiness callers stay on `_definition_fingerprint`. Refresh the row's anchors to symbol names without stale line numbers.
2. ANALYSIS-7 (`:20`): the entry-backfill now reads through `StrategiesRepository.list_live_enabled` (never a name-bound import of the constant); the remaining non-constant mirrors are the two Python-side checks. Adjust the "four sites / two do not import" sentence accordingly.
3. `docs/scoring.md`: rewrite the "Fingerprint eligibility" bullet for the composite; in "Recompute triggers" replace "unconditionally clears" with the hash-changed guard (locked-row comparison) and add the two new `ScoreStrategy` outcomes (UNAVAILABLE `"formula version unavailable — grade unchanged"` with the gate off; NOT_FOUND naming an unreadable formula) and the `RunBacktest` run warning `"evidence not recorded: formula version unavailable — rerun"`.
4. Add a "Known limitations (feature 327)" list to `docs/scoring.md` (design.md step 7): readiness verdicts stay on the definition-only fingerprint until `valid_until`; the `ListStrategies` / `GetStrategyReport` headline stays stale until the next recompute; a behavioural UPDATE during a `GetFormula` outage clears the grade; a refusal grades on the last readable version; with mixed refused and readable formulas the newest composite is used as a whole; when indicators is not ready at boot, `recompute_unscored_pairs` leaves CUSTOM_FORMULA pairs unscored until the next pass; rollout is a one-time evidence reset for every CUSTOM_FORMULA strategy, and a strategy whose formula is refused at rollout and holds only pre-feature cells answers NOT_FOUND until the formula is readable (028 template instances, the 029 blend).
5. Before writing, check that `context.md` holds the operator's explicit acknowledgement of that unrecoverable refused population (O-18), recorded at Step 11's Phase-2 gate; if it is missing, stop and report rather than documenting an unacknowledged limitation.

**Verification**:
```bash
grep -n "Fingerprint blind spot" services/xstockstrat-analysis/docs/context-constitution.md    # no match
grep -n "re-types the SQL literal" services/xstockstrat-analysis/docs/context-constitution.md    # no match
grep -n "_evidence_fingerprint\|latest_formula_fingerprint\|list_live_enabled" services/xstockstrat-analysis/docs/context-constitution.md
grep -n "unconditionally clears" services/xstockstrat-analysis/docs/scoring.md    # no match
grep -n "Known limitations (feature 327)\|formula version unavailable" services/xstockstrat-analysis/docs/scoring.md
```

---

### Step 16 — service: the agent allow-lists the new `ScoreStrategy` UNAVAILABLE message

**Status**: `pending`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/app/tools.py` — modify

**Reviewers**: xstockstrat-agent service owner — MCP tool contract stability (name, parameters, return shape) and `docs/runbooks/mcp-tools.md` parity

**Codebase Evidence**:
- `_SCORE_UNAVAILABLE_PASS = frozenset({"fundamentals availability unknown — grade unchanged"})` at `services/xstockstrat-agent/app/tools.py:242`, under the comment at `:240-241` ("Exact backend strings a call site allow-lists for UNAVAILABLE; a cross-service contract pinned by tests/test_tool_errors.py::test_unavailable_pass_strings_match_backend_sources").
- `_grpc_error_message(exc, not_found="not found", *, deadline_s=None, write=False, pass_messages=frozenset())` at `:250-285`: `if code == grpc.StatusCode.UNAVAILABLE and details in pass_messages: return f"{name}: {details}"` (`:278-279`); any other UNAVAILABLE detail is logged and replaced by `f"{name}: upstream unavailable; {tail}"` (`:280-282`). NOT_FOUND returns the details verbatim when they contain `not_found` (`:273-274`).
- `_score_strategy(ctx, strategy_id)` at `:288`: `not_found=e.details() or "no eligible evidence"`, `write=True`, `pass_messages=_SCORE_UNAVAILABLE_PASS` (`:294-299`) — so the Step 11 NOT_FOUND text already passes through and only the UNAVAILABLE text is withheld.
- `manage_strategy` tool description, score errors at `:1201-1207`: "NOT_FOUND (no eligible evidence — the stale grade is cleared; includes the "all evidence symbols excluded (fundamentals unavailable: …)" variant); UNAVAILABLE ('fundamentals availability unknown — grade unchanged' is passed through verbatim; a store outage surfaces as …)".
- Backend source of the string: `_FORMULA_VERSION_UNKNOWN_MSG` (created by Step 11 in `services/xstockstrat-analysis/app/handlers/servicer.py`).
- Rule: AGENT-10 (`services/xstockstrat-agent/docs/context-constitution.md:25`) — an allow-list entry is a byte-exact copy of the backend detail and must be added to the pin test.
- Header propagation (§B): no new outbound call; `client.score_strategy` is unchanged.
- strat-lab plugin (`docs/patterns/strat-lab-plugin.md` guard-rail table): none of the listed behaviours (update semantics, diagnostics payload size, multi-symbol capital handling, backfill contracts, tool names) changes, so the `backtest` skill is not edited.

**Lands with**: `Step 17`

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. Add `"formula version unavailable — grade unchanged"` to the `_SCORE_UNAVAILABLE_PASS` frozenset (`:242`), byte-exact with Step 11's `_FORMULA_VERSION_UNKNOWN_MSG` (same em dash). Do not import the analysis constant (the agent does not depend on the analysis package; the copy is pinned by Step 17).
2. In the `manage_strategy` description (`:1201-1207`), extend the score error sentence: the NOT_FOUND list also includes the "formula … is not readable" variant, and the UNAVAILABLE clause names both verbatim messages ('fundamentals availability unknown — grade unchanged' and 'formula version unavailable — grade unchanged'). Keep the rest of the description byte-identical.
3. Change nothing else: no parameter, return shape or tool name changes.

**Verification**:
```bash
cd services/xstockstrat-agent
grep -n "formula version unavailable — grade unchanged" app/tools.py    # allow-list entry + description
uv run pytest tests/test_tool_errors.py tests/test_tools.py tests/test_score_trailer_loopback.py -q
ruff check . && ruff format --check .
```

---

### Step 17 — test: the new message survives the agent verbatim and is pinned to the analysis source

**Status**: `pending`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/tests/test_tool_errors.py` — modify
- `services/xstockstrat-agent/tests/test_tools.py` — modify

**Reviewers**: xstockstrat-agent service owner — MCP tool contract stability (name, parameters, return shape) and `docs/runbooks/mcp-tools.md` parity

**Codebase Evidence**:
- `tests/test_tool_errors.py`: `_SCORE_MSG` at `:22`, `_ROOT = pathlib.Path(__file__).resolve().parents[3]` at `:25`; the mapping-table rows `"unavail_pass"` (`:111-116`) and `"unavail_not_listed"` (`:117-123`); `test_unavailable_pass_strings_match_backend_sources` at `:179-196` — reads `services/xstockstrat-analysis/app/handlers/servicer.py`, asserts `re.search(rf'StatusCode\.UNAVAILABLE,\s*"{re.escape(_SCORE_MSG)}"', analysis)` (`:187`) and `tools._SCORE_UNAVAILABLE_PASS == frozenset({_SCORE_MSG})` (`:194`). The constant-assignment pin form already exists for ingest: `f'CALLBACK_URL_UNVALIDATED_DETAIL = "{_BACKFILL_MSG}"' in ingest` (`:192`).
- The regex at `:187` must keep matching after Step 11: the existing `except _GradeInputsUnknown` abort (`servicer.py:2662-2668`) keeps the literal `"fundamentals availability unknown — grade unchanged"` directly after `StatusCode.UNAVAILABLE,`.
- `tests/test_tools.py:1254-1273`: the `test_server_detail_surfaces_in_error` parametrize (`("UNAVAILABLE", "fundamentals availability unknown — grade unchanged")` at `:1259`; NOT_FOUND variants at `:1258` and `:1260-1264`), driven through `self._score(...)`.
- Durable agent rules that stay as written (C-16 PRESERVE — nothing is reworded): `@AC-4 @feature-283` (`services/xstockstrat-agent/acceptance/expose-score-strategy-mcp.feature:24-28`) and `@AC-5 @feature-303` (`acceptance/fix-agent-mcp-tools.feature:57-61`) both quote the existing string, which stays allow-listed.

**Lands with**: `Step 16`

**TDD**: `red-green required`

**Covers**: `AC-4`

**Instructions**:
1. `tests/test_tool_errors.py`: add `_FORMULA_MSG = "formula version unavailable — grade unchanged"` beside `_SCORE_MSG` (`:22`). In `test_unavailable_pass_strings_match_backend_sources` add `assert f'_FORMULA_VERSION_UNKNOWN_MSG = "{_FORMULA_MSG}"' in analysis` (the ingest pattern at `:192`) and change the equality at `:194` to `frozenset({_SCORE_MSG, _FORMULA_MSG})`. Do not add a second regex on the abort call: Step 11 selects the message by the gate, so the assignment pin is the contract.
2. `tests/test_tool_errors.py`: add a mapping-table row beside `"unavail_pass"`: details `_FORMULA_MSG`, kwargs `{"pass_messages": tools._SCORE_UNAVAILABLE_PASS}` → `f"UNAVAILABLE: {_FORMULA_MSG}"`.
3. `tests/test_tools.py`: add `("UNAVAILABLE", "formula version unavailable — grade unchanged")` (327 `AC-4`) and one NOT_FOUND row carrying the Step 11 unreadable-formula text for `f-9` to the `test_server_detail_surfaces_in_error` parametrize (`:1254-1266`).
   RED before Step 16: the tool answers `UNAVAILABLE: upstream unavailable; outcome unknown, verify before retrying`, so the new UNAVAILABLE row and the equality pin fail. The NOT_FOUND row is green on both trees (it documents the existing pass-through; it is not the regression proof).
4. No new fixture: the rows are inline in existing parametrize tables (C-13 — single consumer, inline).

**Verification**:
```bash
cd services/xstockstrat-agent
uv run pytest tests/test_tool_errors.py tests/test_tools.py tests/test_score_trailer_loopback.py -q
grep -n "_FORMULA_MSG" tests/test_tool_errors.py
grep -n "def .*fixture" tests/test_tool_errors.py    # C-13: no new fixture introduced by this step
uv run pytest --cov=app --cov-fail-under=40
ruff check . && ruff format --check .
```

---

### Step 18 — docs: `mcp-tools.md` score errors and AGENT-10

**Status**: `pending`
**Service**: `xstockstrat-agent`
**Files**:
- `docs/runbooks/mcp-tools.md` — modify
- `services/xstockstrat-agent/docs/context-constitution.md` — modify

**Reviewers**: none

**Codebase Evidence**:
- `docs/runbooks/mcp-tools.md:108-109`: "**`UNAVAILABLE`:** only `fundamentals availability unknown — grade unchanged` (`manage_strategy` score) and `positions not published; re-confirm to retry` (`manage_offline_account`) pass through."
- `docs/runbooks/mcp-tools.md:616-621`: the `manage_strategy` score error rows — `score` with no eligible evidence (`:617`), every evidence symbol excluded (`:618`), "`score` while fundamentals availability is unknown | `UNAVAILABLE: fundamentals availability unknown — grade unchanged` (passed through verbatim)" (`:619`), store down (`:620`).
- AGENT-10 row at `services/xstockstrat-agent/docs/context-constitution.md:25` — lists `app/tools.py#_SCORE_UNAVAILABLE_PASS (~L240)` ↔ `services/xstockstrat-analysis/app/handlers/servicer.py` as one of its N=3 sites.
- Reviewer-registry focus for the agent (`docs/runbooks/reviewer-registry.md:24`): `docs/runbooks/mcp-tools.md` parity with the tool contract.

**TDD**: `N/A (docs)`

**Covers**: —

**Instructions**:
1. `mcp-tools.md:108-109`: add `formula version unavailable — grade unchanged` (`manage_strategy` score) to the pass-through list. Do not rewrite the rest of the bullet.
2. `mcp-tools.md` score table (`:616-621`): after `:618` add a row "`score` when a referenced formula is not readable and no evidence exists for a readable version | `no eligible evidence — formula <ids> is not readable and no evidence was recorded for a readable version; …` (NOT_FOUND); the stale grade is cleared"; after `:619` add a row "`score` while a referenced formula's version cannot be read (fundamentals gate off) | `UNAVAILABLE: formula version unavailable — grade unchanged` (passed through verbatim)".
3. AGENT-10 (`context-constitution.md:25`): state that `_SCORE_UNAVAILABLE_PASS` now carries two analysis strings, the second mirrored from `servicer.py#_FORMULA_VERSION_UNKNOWN_MSG`; the site count stays N=3 (one allow-list per call site).

**Verification**:
```bash
grep -n "formula version unavailable — grade unchanged" docs/runbooks/mcp-tools.md    # pass-through bullet + table row
grep -n "is not readable" docs/runbooks/mcp-tools.md
grep -n "_FORMULA_VERSION_UNKNOWN_MSG" services/xstockstrat-agent/docs/context-constitution.md
```

---

## Deviation Log

- 2026-11-20 (impl-spec review, before execution): design.md "Consumer surface (C-14)" calls the feature internal-only. The review showed the agent withholds any UNAVAILABLE text outside `_SCORE_UNAVAILABLE_PASS`, so Steps 16–18 were added and `xstockstrat-agent` joins the touched services. `feature.md` (Affected Services, Reviewers table) still lists analysis and indicators only; context.md Open Threads carries the operator confirmation of this scope addition to the `/sdd-execute` checkpoint. The insights BFF gets no step (a bare `forward`; recorded in the Execution Summary).

_Further entries are added by /sdd-execute as implementation proceeds._
