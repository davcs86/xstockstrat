# Implementation Spec: backtest-debug-info

**Status**: `in-progress`
**Created**: 2026-07-09
**Feature**: `docs/roadmap/features/064-backtest-debug-info/feature.md`
**Total Steps**: 17
**Feature Branch**: `feature/backtest-debug-info`

---

## Execution Summary

Steps are strictly ordered **proto → indicators → analysis → ui → agent** (per design.md § Chosen
Approach) so the integration PR deploys both backend services atomically and the `warmup_period`
proto field is never dead-in-prod. Proto (additive, non-breaking) lands first with regenerated stubs
(Steps 1–2). The `xstockstrat-indicators` `warmup_period` slice (migration + plumbing + validation)
comes next (Steps 3–5) because `xstockstrat-analysis` compile-depends on the new proto field and reads
formula warm-up via `GetFormula`. Analysis is split into four service/test pairs — additive evaluator
series exposure (6–7), both-path per-bar diagnostics + the `bar.time` fix (8–9), Option-C hybrid
warm-up + no-trade-reason classifier (10–11), and the 2-year range cap + config key (12–13). The UI
debug table + date-picker cap + formula warm-up input follows (14–15), and finally the agent
`run_backtest` projection switch (16–17). Every non-frontend service step is paired with a
red-before-green test step (C-08 / P-06).

## Step Dependencies

- Step 2 (proto-gen) requires Step 1 (proto): stubs regenerate from the changed `.proto` files.
- Steps 3–5 (indicators) require Step 2: the servicer/repo reference the regenerated `warmup_period`
  field on `FormulaDefinition` / `RegisterFormulaRequest` / `UpdateFormulaRequest`.
- Step 4 (indicators service) requires Step 3 (migration): the `warmup_period` column must exist
  before the repo `SELECT *`/`RETURNING *` reads it.
- Steps 6–13 (analysis) require Step 2: `BacktestResult.diagnostics`, `BarDiagnostic`,
  `SymbolDiagnostics`, `BarAction`, `NoTradeReason` stubs must exist.
- Step 8 (diagnostics) requires Step 6 (`evaluate_with_series`): the evaluated path projects the
  evaluator's `component_series` into the `indicators` map.
- Step 10 (warm-up / no-trade-reason) requires Step 8 (diagnostics rows exist) and depends on the
  indicators `warmup_period` field (Step 4) being reachable via `GetFormula`.
- Step 14 (ui) requires Step 2: consumes the typed `BacktestResult.diagnostics` and the
  `warmup_period` field on the formula register/update payloads.
- Step 16 (agent) requires Step 2: `MessageToDict` serializes the new `diagnostics` array.

---

### Step 1 — proto: additive diagnostics + warmup_period fields

**Status**: `done`
**Service**: `packages/proto`
**Files**:
- `packages/proto/analysis/v1/analysis.proto` — modify
- `packages/proto/indicators/v1/indicators.proto` — modify

**Reviewers**: Proto Reviewer — field number uniqueness per message, additive-only (no breaking
changes without deprecation), `buf lint`/`buf breaking` pass across `analysis.proto` + `indicators.proto`;
`xstockstrat-analysis` (service owner) — backtest reproducibility, no look-ahead bias in the diagnostic
shape; `xstockstrat-indicators` (service owner) — `warmup_period` field placement.

**Codebase Evidence**:
- Confirmed `message BacktestResult` at `packages/proto/analysis/v1/analysis.proto:54`; highest field
  is `repeated CoverageGap coverage_gaps = 13` (`:67`) → next free number is **14** for `diagnostics`.
- Confirmed `BacktestStatus` enum already carries `BACKTEST_STATUS_UNSPECIFIED = 0` (`:59`) — matches
  the C-04 sentinel pattern the new `BarAction` / `NoTradeReason` enums must follow.
- Confirmed `message FormulaDefinition` at `indicators.proto:131`, highest field
  `repeated FormulaOutput outputs = 11` (`:142`) → `warmup_period = 12`.
- Confirmed `message RegisterFormulaRequest` at `indicators.proto:158`, highest field
  `repeated FormulaOutput outputs = 8` (`:166`) → `warmup_period = 9`.
- Confirmed `message UpdateFormulaRequest` at `indicators.proto:189`, highest field
  `repeated FormulaOutput outputs = 8` (`:197`) → `warmup_period = 9`.
- Confirmed `Bar` OHLCV field names/types in `packages/proto/marketdata/v1/marketdata.proto:44` —
  `time = 2` (timestamp), `open = 3`, `high = 4`, `low = 5`, `close = 6`, `volume = 7` (int64),
  `vwap = 8`. `BarDiagnostic` mirrors these types (`volume` as `int64`).

**TDD**: `N/A (proto contract change — verification is buf lint/breaking, no unit test)`

**Instructions**:
1. In `analysis/v1/analysis.proto`, add two enums (each with the mandatory `_UNSPECIFIED = 0`
   sentinel, C-04):
   - `enum BarAction { BAR_ACTION_UNSPECIFIED = 0; BAR_ACTION_WARMUP = 1; BAR_ACTION_HOLD_FLAT = 2;
     BAR_ACTION_ENTER_LONG = 3; BAR_ACTION_EXIT_LONG = 4; BAR_ACTION_HOLD_LONG = 5; }`
   - `enum NoTradeReason { NO_TRADE_REASON_UNSPECIFIED = 0; NO_TRADE_REASON_ENTIRE_RANGE_WARMUP = 1;
     NO_TRADE_REASON_ENTRY_NEVER_TRUE = 2; NO_TRADE_REASON_INSUFFICIENT_CAPITAL = 3; }`
     (`INSUFFICIENT_CAPITAL` is defined but not emitted this version — user-locked, per design.md.)
2. Add `message BarDiagnostic` with: `string symbol = 1; int32 bar_index = 2;
   google.protobuf.Timestamp timestamp = 3; double open = 4; double high = 5; double low = 6;
   double close = 7; int64 volume = 8; double vwap = 9; map<string, double> indicators = 10;
   bool warmup = 11; double signal_score = 12; double conviction = 13; BarAction action = 14;`
   (`google.protobuf.Timestamp` is already imported by this proto — reuse the existing import).
3. Add `message SymbolDiagnostics` with: `string symbol = 1; repeated BarDiagnostic bars = 2;
   NoTradeReason no_trade_reason = 3; int32 bars_total = 4; int32 warmup_bars = 5;`
4. In `message BacktestResult`, add `repeated SymbolDiagnostics diagnostics = 14;` after
   `coverage_gaps = 13`.
5. In `indicators/v1/indicators.proto`, add `int32 warmup_period = 12;` to `FormulaDefinition`,
   `int32 warmup_period = 9;` to `RegisterFormulaRequest`, and `int32 warmup_period = 9;` to
   `UpdateFormulaRequest`. Add a short comment on each (e.g. `// bars of warm-up before outputs valid`).
6. Do NOT renumber, retype, or remove any existing field (keeps `buf breaking` green).

**Verification**:
```bash
cd packages/proto && buf lint && buf breaking --against ".git#branch=feature/backtest-debug-info"
```
Both must pass (additive-only). If the feature branch has no prior committed proto state, run
`buf breaking --against ".git#branch=main-dev"` per `docs/runbooks/proto-versioning.md`.

---

### Step 2 — proto-gen: regenerate + commit stubs

**Status**: `done`
**Service**: `packages/proto`
**Files**:
- `packages/proto/gen/` — modify (regenerated TS/Python/Go stubs; commit the diff)

**Reviewers**: Proto Reviewer — field number uniqueness per message, additive-only, `buf lint`/`buf
breaking` pass; `xstockstrat-analysis` (service owner); `xstockstrat-indicators` (service owner).
(Inherited from Step 1 per the reviewer-registry proto-gen rule.)

**Codebase Evidence**:
- Confirmed generated stub tree exists at `packages/proto/gen/{go,python,ts}` (root CLAUDE.md § Key
  File Paths Reference). Root CLAUDE.md § Generating Proto Stubs: `./scripts/buf-gen.sh` generates all
  three languages and compiles the TS package.

**TDD**: `N/A (generated code — verification is a clean/committed diff)`

**Instructions**:
1. From repo root run `./scripts/buf-gen.sh` (generates TS, Python, Go stubs and compiles the TS
   package under `gen/ts/dist/`).
2. Stage and commit the regenerated files under `packages/proto/gen/` in the same PR as Step 1
   (C-09). Do not hand-edit generated files.

**Verification**:
```bash
./scripts/buf-gen.sh && git status --porcelain packages/proto/gen | head
# then confirm the new symbols exist in each language stub:
grep -rn "SymbolDiagnostics\|BarDiagnostic\|BAR_ACTION_ENTER_LONG" packages/proto/gen/python | head
grep -rn "warmup_period\|warmupPeriod" packages/proto/gen/ts/dist | head
```
The CI `proto-freshness` job re-runs `buf-gen` and fails on any uncommitted diff — the working tree
must be clean after regeneration.

---

### Step 3 — migration: 004_formula_warmup on indicators.formulas

**Status**: `pending`
**Service**: `xstockstrat-indicators`
**Files**:
- `services/xstockstrat-indicators/migrations/004_formula_warmup.up.sql` — create
- `services/xstockstrat-indicators/migrations/004_formula_warmup.down.sql` — create

**Reviewers**: DBA — `004_formula_warmup` migration: NNN numbering, up+down pair, additive column
default, run-order compliance; `xstockstrat-indicators` (service owner) — `warmup_period` persistence,
numeric precision.

**Codebase Evidence**:
- Confirmed last migration is `003_formula_outputs.{up,down}.sql` via
  `ls services/xstockstrat-indicators/migrations/` → next number is **004** (C-07 / F-01).
- Reuse the additive scalar-column precedent `is_public BOOLEAN NOT NULL DEFAULT FALSE`
  (`migrations/001_formulas.up.sql:9`, per recon.md) — a typed `INTEGER` column, not JSONB.

**TDD**: `N/A (migration — verification is apply + rollback)`

**Instructions**:
1. Create `004_formula_warmup.up.sql`:
   `ALTER TABLE indicators.formulas ADD COLUMN warmup_period INTEGER NOT NULL DEFAULT 0;`
2. Create `004_formula_warmup.down.sql`:
   `ALTER TABLE indicators.formulas DROP COLUMN warmup_period;`
3. Do not edit any applied migration (F-01) — this is a new numbered pair only.

**Verification**:
```bash
./scripts/db-migrate.sh   # applies 004 up
# confirm column exists, default 0, NOT NULL:
psql "$DATABASE_URL" -c "\d+ indicators.formulas" | grep warmup_period
# then verify clean rollback:
./scripts/db-migrate.sh down 1 && ./scripts/db-migrate.sh   # down then re-up applies cleanly
```

---

### Step 4 — service: indicators warmup_period plumbing + validation

**Status**: `pending`
**Service**: `xstockstrat-indicators`
**Files**:
- `services/xstockstrat-indicators/app/handlers/servicer.py` — modify
- `services/xstockstrat-indicators/app/services/formulas_repository.py` — modify

**Reviewers**: `xstockstrat-indicators` (service owner) — formula `warmup_period` persistence/validation,
no side-effects, numeric precision.

**Codebase Evidence**:
- Confirmed handlers: `RegisterFormula` (`servicer.py:197`), `GetFormula` (`:258`), `ListFormulas`
  (`:272`), `UpdateFormula` (`:290`), and `_row_to_formula(row: dict)` (`:343`).
- Confirmed repo methods `create` (`formulas_repository.py:45`), `upsert` (`:77`), `update` (`:158`);
  recon.md confirms they use `SELECT *`/`RETURNING *`, so the new scalar column flows into the row
  dict automatically — only `_row_to_formula` and the request reads need explicit field mapping.
- Non-negative validation follows the `min > max` raise precedent (`app/services/parameters.py:78`)
  which the servicer catches as `INVALID_ARGUMENT` (`servicer.py:222-226`, per design.md).

**TDD**: `red-green required`

**Instructions**:
1. In `RegisterFormula` and `UpdateFormula` (`servicer.py:197` / `:290`), read
   `request.warmup_period` and pass it through to the repo `create`/`upsert`/`update` call. Reject a
   negative value: `if request.warmup_period < 0: await context.abort(grpc.StatusCode.INVALID_ARGUMENT,
   "warmup_period must be >= 0")` (mirror the existing `INVALID_ARGUMENT` abort at `servicer.py:222-226`).
2. In `formulas_repository.py` `create` (`:45`), `upsert` (`:77`), and `update` (`:158`), add
   `warmup_period` to the INSERT/UPDATE column list and parameter binding (mirror how `is_public` /
   `outputs` are threaded). Because the methods `RETURNING *`, no change to the SELECT projection is
   needed — confirm the returned row dict now carries `warmup_period`.
3. In `_row_to_formula` (`servicer.py:343`), map `warmup_period=row["warmup_period"]` onto the
   returned `FormulaDefinition` (used by both `GetFormula` and `ListFormulas`).
4. Run `uv lock` only if `pyproject.toml` changed (it should not — no new dependency here).

**Verification**: covered by Step 5 (paired test — round-trip + validation) plus the lint gate there.

---

### Step 5 — test: indicators warmup_period round-trip + validation

**Status**: `pending`
**Service**: `xstockstrat-indicators`
**Files**:
- `services/xstockstrat-indicators/tests/test_formulas.py` — modify
- `services/xstockstrat-indicators/tests/test_parameters.py` — modify (or add a servicer-level case)

**Reviewers**: `xstockstrat-indicators` (service owner) — formula `warmup_period` persistence/validation.

**Codebase Evidence**:
- Confirmed round-trip test precedent `tests/test_formulas.py:73` and stores-outputs at `:211`
  (recon.md) — extend the same fixtures to assert `warmup_period` survives register → get.

**TDD**: `red-green required` — write the assertions first; they fail against the pre-Step-4 tree
(the field is dropped/absent) and pass after.

**Instructions**:
1. Extend the register→get round-trip test: register a formula with `warmup_period=14`, fetch via
   `GetFormula`, assert `formula.warmup_period == 14`. Add an update case asserting the new value
   round-trips.
2. Assert backward compatibility: a formula registered without `warmup_period` reports
   `warmup_period == 0` (matches the column `DEFAULT 0`).
3. Assert a negative `warmup_period` on `RegisterFormula`/`UpdateFormula` aborts with
   `INVALID_ARGUMENT`.

**Verification**:
```bash
cd services/xstockstrat-indicators && ruff check . && ruff format --check . \
  && pytest --cov=app --cov-fail-under=50
```
Confirm coverage ≥ 50% (indicators threshold) and all new cases pass.

---

### Step 6 — service: analysis additive evaluate_with_series + referenced_refs

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/app/services/evaluator.py` — modify

**Reviewers**: `xstockstrat-analysis` (service owner) — backtest reproducibility, strategy scoring
determinism, no look-ahead bias; Option-C warm-up length correctness.

**Codebase Evidence**:
- Confirmed `async def evaluate(...)` at `evaluator.py:74` returns `list[BarDecision]` (`return
  decisions` at `:122`); `component_series` is built locally at `:101-107` (bare `ref_name` → primary
  at `:105`, dotted `<ref>.<series>` at `:107`) and currently discarded.
- Confirmed the sole hot caller is the feature-048 live loop: `live_loop.py:119`
  `decisions = await self._evaluator.evaluate(definition, bars, None)`, using only `decisions[-1]`
  (`:123`). Return-type must stay frozen — design.md § Chosen Approach + insights.md
  (2026-07-08 entry): add an additive sibling, do not widen the contract.
- Confirmed the rule-ref walk exists: `_validate_term_ref` (`evaluator.py:231`) and
  `_validate_rule_refs` (`:269`); `_INDICATOR_SERIES` at `:30`.

**TDD**: `red-green required`

**Instructions**:
1. Add `async def evaluate_with_series(...)` returning `tuple[list[BarDecision], dict[str, list]]`
   — the decisions plus the `component_series` dict built at `:101-107`. Move the current body of
   `evaluate()` into it.
2. Make `evaluate()` delegate: `decisions, _ = await self.evaluate_with_series(...); return decisions`.
   The signature and `list[BarDecision]` return of `evaluate()` are unchanged (protects
   `live_loop.py:119` and the list-mocking tests — insights.md).
3. Add a **non-raising** `referenced_refs(rule) -> set[str]` helper by extracting the walk structure
   from `_validate_rule_refs` / `_validate_term_ref` (`:269` / `:231`) — it only gathers referenced
   ref names (collapsing dotted `bb.lower` → base `bb`); validation keeps raising. Do not duplicate the
   walk (DRY guard rail — `docs/patterns/dry-guard-rail.md`; jscpd pre-commit hook) — factor the shared
   traversal.

**Verification**: covered by Step 7 (paired test) plus its lint gate.

---

### Step 7 — test: evaluate_with_series series + list back-compat + ref collection

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/tests/test_strategy_evaluator.py` — modify

**Reviewers**: `xstockstrat-analysis` (service owner) — no look-ahead bias, determinism.

**Codebase Evidence**:
- Confirmed evaluator is mocked as a list in `tests/test_strategy_evaluator.py` and
  `tests/test_live_loop.py` (recon.md Risks) — the back-compat assertion guards that contract.

**TDD**: `red-green required` — assertions fail against the pre-Step-6 tree (`evaluate_with_series`
absent, `referenced_refs` absent).

**Instructions**:
1. Assert `evaluate_with_series()` returns `(decisions, component_series)` where
   `component_series` includes the bare `ref_name` primary key and the dotted `<ref>.<series>` keys.
2. Assert `evaluate()` still returns a bare `list[BarDecision]` identical to
   `evaluate_with_series()[0]` (list back-compat — protects the live loop).
3. Assert `referenced_refs()` on a nested AND/OR rule tree collects every referenced ref (dotted
   forms collapsed to base) and does **not** raise on an unknown ref (non-raising contract).

**Verification**:
```bash
cd services/xstockstrat-analysis && ruff check . && ruff format --check . \
  && pytest --cov=app --cov-fail-under=40
```
Confirm coverage ≥ 40% (analysis threshold).

---

### Step 8 — service: both-path per-bar diagnostics + bar.time fix

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/app/handlers/servicer.py` — modify

**Reviewers**: `xstockstrat-analysis` (service owner) — backtest reproducibility, **no look-ahead
bias** in the per-bar diagnostics, action↔TradeRecord consistency.

**Codebase Evidence**:
- Confirmed both helpers: `_backtest_symbol` (`servicer.py:341`) with `fast_values`/`slow_values`
  dicts (`:404-405`, both guard `p.value != 0`), bar loop guards at `:442`/entry fill at `:489`
  region/exit at `:499`; `_backtest_symbol_evaluated` (`:550`) with `entry_time`/`exit` at `:601`/`:608`.
- **Confirmed latent bug (design.md Open Risk):** both helpers read `bar.timestamp`
  (`servicer.py:489`, `:499`, `:530`, `:601`, `:608`, `:637`) but the marketdata `Bar` proto field is
  `time` (`marketdata.proto:46`). Tests pass only because bars are `MagicMock`. Fix all six sites to
  `bar.time` / `last_bar.time`.
- Confirmed `GetFormula` is already callable from the servicer (`servicer.py:122`) — no new outbound
  edge, existing propagating client reused (header propagation unchanged).

**TDD**: `red-green required`

**Instructions**:
1. Add a shared module-level helper `_build_bar_diagnostic(symbol, bar_index, bar, indicators,
   warmup, signal_score, conviction, action)` returning a `BarDiagnostic`, called from BOTH paths
   (avoids the jscpd block-clone the pre-commit DRY gate would reject — `docs/patterns/dry-guard-rail.md`). Map `bar.time` →
   `timestamp`, OHLCV from `bar.open/high/low/close/volume`, `vwap` from `bar.vwap`.
2. In each helper, iterate `range(len(bars))` in a diagnostics pass **independent of the trade loop**
   (which starts at index 1) so **bar 0 is captured**.
3. **Explicitly initialize** each row's `action` at build time (never rely on the proto default,
   which would serialize `BAR_ACTION_UNSPECIFIED` not `WARMUP` — C-04). Overwrite `action` inside the
   trade loop at the branch actually taken: legacy warm-up guard (`:442` region, `i not in fast_values
   or i not in slow_values`) → `WARMUP`; enter set inside the `cost <= equity` fill block (near `:489`)
   → `ENTER_LONG`; exit (`:499`) → `EXIT_LONG`; else `HOLD_LONG` / `HOLD_FLAT`. Evaluated path mirrors
   via `decision.entry` / `decision.exit`.
4. The post-loop **forced-close** (near `:530` / `:637`) must relabel `diag[-1].action = EXIT_LONG`
   so `ENTER_LONG`/`EXIT_LONG` bars carry the same `bar.time` written into the corresponding
   `TradeRecord` (AC-3).
5. Populate the `indicators` map **present-only**: legacy from `fast_values`/`slow_values`
   (already guarded to skip unresolved bars) under keys `sma_fast` / `sma_slow`; evaluated by
   projecting `component_series` (from Step 6) **dropping the redundant `<ref>.value` alias**
   (`evaluator.py:105-107`), including a key only when the series has resolved at bar `i` (warm-up
   absence, not a fabricated `0` — FR-3 / FR-5, no look-ahead).
6. `signal_score`: real `scoring.compute_signal_score` on the legacy path; `0` on the evaluated path
   (FR-4a). `conviction`: the numeric conviction the engine used that bar.
7. Have both helpers return a **4-tuple** adding a `SymbolDiagnostics` (bars + placeholder
   `no_trade_reason`/`warmup_bars` filled in Step 10). Update the two callers at `servicer.py:233`/`:243`
   to collect the `SymbolDiagnostics` into `result.diagnostics` (append per symbol). Do NOT write
   diagnostics into the ledger `analysis.backtest.completed` event payload (FR-7 / AC-5).
8. **Open Risk RESOLVED (design.md vwap):** `BarDiagnostic.vwap` is a plain scalar column (not in the
   presence-sensitive `indicators` map), so there is **no presence heuristic** — always copy
   `bar.vwap` straight through (a `0.0` simply means the source bar carried no vwap, shown honestly in
   the debug table). This eliminates the "genuine 0.0 mislabeled as absent" risk entirely; FR-2's
   "when the source carries it" is satisfied by proto3 scalar semantics (unset ⇒ 0.0). No
   `optional double vwap` needed.

**Verification**: covered by Step 9 (paired test) plus its lint gate.

---

### Step 9 — test: per-bar diagnostics incl. bar 0, action↔TradeRecord, no look-ahead

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/tests/test_analysis_servicer.py` — modify
- `services/xstockstrat-analysis/tests/test_analysis_helpers.py` — modify

**Reviewers**: `xstockstrat-analysis` (service owner) — no look-ahead bias, action↔TradeRecord
consistency.

**Codebase Evidence**:
- Confirmed `TestRunBacktest` at `tests/test_analysis_servicer.py:160` and helper tests in
  `tests/test_analysis_helpers.py` (recon.md).
- **Real `Bar` fixture required** (design.md Open Risk): existing tests pass `MagicMock` bars, which
  masks the `bar.timestamp`→`bar.time` fix — a MagicMock returns a truthy `.timestamp` for any
  attribute. The new assertions must use real `marketdata_pb2.Bar` instances with `.time` set.

**TDD**: `red-green required` — fails against the pre-Step-8 tree (no `diagnostics`, `bar.timestamp`
still read).

**Instructions**:
1. Build backtests over **real `Bar` fixtures** (not `MagicMock`) with known OHLCV and `time` values.
2. Assert one `BarDiagnostic` per bar including **bar index 0**; assert OHLCV and `timestamp` match
   the source bar's `.time` (this also pins the `bar.time` fix and the corrected `TradeRecord` times).
3. Assert the evaluated path's `indicators` map contains the bare `ref_name` primary key and dotted
   secondary keys but **not** the redundant `<ref>.value` alias, and omits unresolved series on
   warm-up bars (flagged `warmup=true` — full warm-up assertions land in Step 11).
4. Assert AC-3: for a strategy that trades, the entry bar carries `action = ENTER_LONG` and the exit
   bar `action = EXIT_LONG`, and their `timestamp` equals the matching `TradeRecord` entry/exit time.
5. Assert AC-4 (no look-ahead): a bar's series values and `warmup` flag are identical whether the
   range ends at that bar or extends beyond it.
6. Assert AC-5: the `analysis.backtest.completed` ledger event payload contains no diagnostics.

**Verification**:
```bash
cd services/xstockstrat-analysis && ruff check . && ruff format --check . \
  && pytest --cov=app --cov-fail-under=40
```

---

### Step 10 — service: Option-C hybrid warm-up + no_trade_reason classifier

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/app/handlers/servicer.py` — modify

**Reviewers**: `xstockstrat-analysis` (service owner) — Option-C warm-up length correctness, no
look-ahead bias, determinism.

**Codebase Evidence**:
- Confirmed `RunBacktest` at `servicer.py:145`; it already fetches formula metadata via `GetFormula`
  for validation (`servicer.py:122-123`) — reuse that call, cached by `formula_id` once per run.
- Confirmed insufficient-data symbols never enter the bar loop: `_InsufficientData` raised at
  `servicer.py:377` (legacy) / `:577` (evaluated) and handled separately (`:260`) → they become
  `CoverageGap`, so `no_trade_reason` can never mislabel them (FR-9 / recon.md).
- `referenced_refs` from Step 6 supplies the active `entry_rule`/`exit_rule` ref set.

**TDD**: `red-green required`

**Instructions**:
1. Compute `warmup_bars` = max lookback over the components the active `entry_rule`/`exit_rule`
   **reference** (via `referenced_refs`, Step 6). Per component:
   - **Built-in indicator** → the **observed** first-resolved index in its series (dict-min of
     `fast_values`/`slow_values` on the legacy path; first non-`None` index of `component_series[ref]`
     on the evaluated path, capped at `len(bars)-1`). Design.md rejects a pure declared
     `_INDICATOR_WARMUP` constant map (off-by-one vs the real leading-gap) — use the observed index.
   - **Custom formula** → its **declared** `warmup_period` fetched via `GetFormula` (Step 4 field),
     cached by `formula_id` across symbols (avoids N×M round-trips). Always use the declared value,
     never the observed series (design.md Open Risk mitigation — an all-`None` formula series must not
     inflate `warmup_bars` to `len(bars)`).
   - Legacy SMA path references `{fast, slow}` implicitly; its `warmup_bars` is the observed
     first-both-resolved index (specialization of Option C; FR-4 legacy `slow_period` behavior).
2. Set `bar.warmup = (bar_index < warmup_bars)` on every diagnostic row, and its `action = WARMUP`
   when warm-up (overriding the Step 8 branch label for those bars). Set
   `SymbolDiagnostics.warmup_bars` and `bars_total = len(bars)`.
3. Classify `no_trade_reason` **only when the symbol traded 0 times**: `warmup_bars >= len(bars)` →
   `NO_TRADE_REASON_ENTIRE_RANGE_WARMUP`; else (no `ENTER_LONG` recorded) →
   `NO_TRADE_REASON_ENTRY_NEVER_TRUE`. `INSUFFICIENT_CAPITAL` stays in the enum but is **not emitted**
   this version (user-locked). Symbols that traded carry `NO_TRADE_REASON_UNSPECIFIED`.

**Verification**: covered by Step 11 (paired test) plus its lint gate.

---

### Step 11 — test: warm-up length + no_trade_reason classification

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/tests/test_analysis_servicer.py` — modify
- `services/xstockstrat-analysis/tests/test_analysis_helpers.py` — modify

**Reviewers**: `xstockstrat-analysis` (service owner) — Option-C warm-up correctness.

**Codebase Evidence**:
- Same fixtures as Step 9 (`test_analysis_servicer.py:160` `TestRunBacktest`).

**TDD**: `red-green required` — fails against the pre-Step-10 tree (`warmup_bars`/`no_trade_reason`
absent or unset).

**Instructions**:
1. Assert `warmup_bars` equals the max observed lookback of the **referenced** components and that an
   **unused** long-lookback component does NOT inflate it (the Option-C guarantee vs rejected Option A).
2. Assert bars `< warmup_bars` are `warmup=true` with `action = BAR_ACTION_WARMUP` and omit
   unresolved series; bars `>= warmup_bars` are `warmup=false`.
3. Assert a strategy referencing a custom formula reports `warmup_bars >= formula.warmup_period`; an
   **all-`None` formula primary series** still classifies as `ENTRY_NEVER_TRUE` (declared warm-up used,
   not observed — the Open Risk mitigation), NOT `ENTIRE_RANGE_WARMUP`.
4. Assert AC-1: an OK-status, 0-trade symbol yields a populated `SymbolDiagnostics` with a
   non-`UNSPECIFIED` `no_trade_reason`; a warm-up-only range → `ENTIRE_RANGE_WARMUP`; a
   never-satisfied-entry range → `ENTRY_NEVER_TRUE`.
5. Assert a symbol with insufficient bars produces a `CoverageGap` and **no** `no_trade_reason`
   mislabel (FR-9 separation).

**Verification**:
```bash
cd services/xstockstrat-analysis && ruff check . && ruff format --check . \
  && pytest --cov=app --cov-fail-under=40
```

---

### Step 12 — config + service: analysis.backtest.max_range_days 2-year cap

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/app/handlers/servicer.py` — modify
- `services/xstockstrat-analysis/CLAUDE.md` — modify (Config Keys Consumed table — C-05 default declaration)
- `CLAUDE.md` — modify (root recently-added-keys list)

**Reviewers**: `xstockstrat-analysis` (service owner) — config key naming
(`<service>.<category>.<key>`), reject-not-clamp behavior, reproducibility.

**Codebase Evidence**:
- Confirmed `RunBacktest` at `servicer.py:145`; existing `context.abort(grpc.StatusCode.INVALID_ARGUMENT,
  …)` pattern at `servicer.py:143` and `:218` to reuse for the reject path.
- Confirmed `watcher.get_int(key, default)` at `app/config/watcher.py:68` — read the cap via this
  accessor (F-07: never hardcode; read from config).
- Confirmed `RunBacktestRequest.range` is `xstockstrat.common.v1.TimeRange range = 2`
  (`analysis.proto:28`) — read `request.range.start` / `request.range.end`.
- Confirmed existing config-key table in `services/xstockstrat-analysis/CLAUDE.md` under
  `## Config Keys Consumed` (namespace `analysis`, rows for `analysis.backtest.max_duration_seconds`
  etc.) — add the new row there.

**TDD**: `red-green required`

**Instructions**:
1. In `RunBacktest`, read `max_range_days = self._cfg.get_int("analysis.backtest.max_range_days",
   730)` (the servicer's config accessor is `self._cfg`, set at `servicer.py:72`; `self._cfg.get_int`
   is already used at `servicer.py:898`).
2. If both `request.range.start` and `request.range.end` are set and the span exceeds
   `max_range_days` → `await context.abort(grpc.StatusCode.INVALID_ARGUMENT, <message stating the
   2-year max and the requested span>)` (reject, do NOT clamp — preserves reproducibility, FR-4b).
   Applies to ALL callers, not just diagnostics.
3. If a bound is **unset** (the agent may send no range) → default it: `end → now`,
   `start → end − max_range_days` (design.md — bound all backtests rather than bypass the cap;
   Open Risk verified at Step 13).
4. Add the config-key row to `services/xstockstrat-analysis/CLAUDE.md` § Config Keys Consumed:
   `| analysis.backtest.max_range_days | int | 730 | Max backtest range span in days (≈2y); over-cap
   requests rejected with INVALID_ARGUMENT; applies to all RunBacktest callers |` and add the same key
   to the root `CLAUDE.md` recently-added-keys list (feature 064). Register per
   `docs/runbooks/config-rollout.md`.

**Verification**: covered by Step 13 (paired test) plus its lint gate; plus:
```bash
grep -n "analysis.backtest.max_range_days" services/xstockstrat-analysis/CLAUDE.md CLAUDE.md
```

---

### Step 13 — test: range cap reject / at-cap / unset-defaulting

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/tests/test_analysis_servicer.py` — modify

**Reviewers**: `xstockstrat-analysis` (service owner) — cap correctness.

**Codebase Evidence**:
- `TestRunBacktest` at `tests/test_analysis_servicer.py:160`; the servicer under test reads the cap
  via a mockable `watcher.get_int` (`watcher.py:68`).

**TDD**: `red-green required` — fails against the pre-Step-12 tree (no cap enforced).

**Instructions**:
1. Assert a `RunBacktest` whose `range` span exceeds `max_range_days` (default 730) aborts with
   `INVALID_ARGUMENT` and a message naming the requested span (AC-7).
2. Assert a request at/under the cap runs normally.
3. Assert an unset-range request is defaulted to the last `max_range_days` (end→now, start→end−cap)
   and runs (design.md Open Risk — agent range-less coverage now bounded).

**Verification**:
```bash
cd services/xstockstrat-analysis && ruff check . && ruff format --check . \
  && pytest --cov=app --cov-fail-under=40
```

---

### Step 14 — service: UI debug table + date-picker cap + formula warm-up input

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/app/insights/strategies/[id]/page.tsx` — modify
- `services/xstockstrat-ui/src/components/insights/FormulaWorkspace.tsx` — modify
- `services/xstockstrat-ui/src/hooks/useFormulas.ts` — modify
- `services/xstockstrat-ui/package.json` — modify (add `@tanstack/react-virtual` dependency)

**Reviewers**: `xstockstrat-ui` (service owner) — analytics display accuracy, Connect-RPC call safety,
no direct DB access, large-table render performance, formula-authoring input correctness.

**Codebase Evidence**:
- Confirmed strategy page consumes `useRunBacktest` (`page.tsx:11`/`:30`), renders the
  `INSUFFICIENT_DATA` card at `:199` and the metrics/`MetricCard` grid + equity curve at `:239-314`;
  date pickers are `type="date"` inputs at `:164`/`:172`. Result carries `result.coverageGaps` /
  `result.totalTrades` (camelCase typed client, `:199`/`:268`) → the new field is `result.diagnostics`.
- Confirmed shared shadcn `Table` set exists: `Table` (forwardRef) at
  `src/components/ui/table.tsx:4`, plus `TableHeader`/`TableBody`/`TableRow`/`TableHead` — reuse these,
  do NOT hand-roll a `<table>` (recon.md anti-pattern).
- Confirmed `FormulaWorkspace` is the single source of formula form state: `FormulaWorkspaceProps` at
  `FormulaWorkspace.tsx:46`, `isPublic` state at `:98`, `onSave` payload at `:189-193`. The
  `formulas/{new,[id]}` pages are thin wrappers → add the input here, not per page.
- Confirmed `useFormulas` register/update mutations at `hooks/useFormulas.ts:31`/`:58` build the
  request payloads.
- Confirmed `package.json` has `@tanstack/react-query` (`:34`) but **no** virtualization dep
  (`grep virtual|tanstack|react-window` → only react-query) → `@tanstack/react-virtual` is a new dep.

**TDD**: `N/A (frontend — no coverage threshold; e2e verification in Step 15)` — this frontend
`service` step is verified by the paired Step 15 e2e per the spec-template frontend row.

**Instructions**:
1. Add `@tanstack/react-virtual` to `package.json` dependencies and install via `pnpm install`
   (headless `useVirtualizer` keeps the semantic shared `<Table>` markup + a11y; design.md rejects
   `react-window`).
2. On `strategies/[id]/page.tsx`, render a day-by-day debug `<Card>` **between** the metrics/equity
   block and the `INSUFFICIENT_DATA` card, shown whenever `result.diagnostics?.length`. Use the shared
   `Table`/`TableHeader`/`TableRow`/`TableHead`/`TableBody` set, virtualized with `useVirtualizer`.
   Columns: one per OHLCV field, one per indicator series key (union of the symbol's
   `bar.indicators` keys), plus warm-up / action / conviction columns. Visually distinguish warm-up
   rows and entry/exit rows (FR-8). When `no_trade_reason` is set, show it **prominently** above the
   table (primary answer to "why 0 trades").
3. Constrain the Start/End `type="date"` pickers (`:164`/`:172`) so a submitted range cannot exceed
   the cap (≤ 730 days); surface the backend `INVALID_ARGUMENT` message if the server still rejects
   (FR-4b). (Cap value mirrored client-side; the backend remains the source of truth.)
4. In `FormulaWorkspace.tsx`, add a numeric **Warm-up period (bars)** input (default `0`,
   non-negative) to the metadata markup (near the `isPublic` control at `:171`/`:232`); add
   `warmupPeriod` to component state and include it in the `onSave` payload (`:189`). In
   `useFormulas.ts`, thread `warmupPeriod` into the register (`:31`) and update (`:58`) request bodies
   so it reaches `RegisterFormula`/`UpdateFormula`.

**Verification**: covered by Step 15 (e2e) plus:
```bash
cd services/xstockstrat-ui && pnpm run lint && pnpm run build
```

---

### Step 15 — test: UI e2e debug table + date cap + formula warm-up

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/e2e/insights/backtest-coverage.spec.ts` — modify
- `services/xstockstrat-ui/e2e/insights/formulas.spec.ts` — modify

**Reviewers**: `xstockstrat-ui` (service owner) — analytics display accuracy, large-table render.

**Codebase Evidence**:
- Confirmed existing e2e specs `e2e/insights/backtest-coverage.spec.ts:12` and
  `e2e/insights/formulas.spec.ts` (recon.md) — extend them; no coverage threshold applies to Next.js
  (spec-template frontend row: use `pnpm test:e2e`).

**TDD**: `red-green required` (e2e-level) — the new assertions fail against the pre-Step-14 UI.

**Instructions**:
1. Extend the backtest e2e: mock a `RunBacktest` response carrying `diagnostics` with an OK, 0-trade
   symbol; assert the debug table renders below the metrics, the no-trade reason shows prominently,
   and warm-up/entry/exit rows are visually distinct. Assert the `INSUFFICIENT_DATA`
   coverage-gap/backfill card behavior is unchanged (FR-9 / AC-6).
2. Assert the date pickers cannot submit a range wider than the cap (AC-7).
3. Extend the formulas e2e: set a Warm-up period on the formula form and assert it is sent on
   save/update (AC-8).

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm run lint && pnpm test:e2e
```

---

### Step 16 — service: agent run_backtest MessageToDict projection

**Status**: `pending`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/app/client.py` — modify
- `services/xstockstrat-agent/app/tools.py` — modify

**Reviewers**: `xstockstrat-analysis` (service owner) — the agent consumes analysis `RunBacktest`;
diagnostic-advisor correctness. (No dedicated agent owner row in the registry; the analysis owner
governs the RunBacktest contract this step surfaces.)

**Codebase Evidence**:
- Confirmed `async def run_backtest` at `client.py:138` currently builds a **manual** dict (e.g.
  `"total_trades": resp.total_trades` at `:163`) that drops `trades`/`status`/`coverage_gaps`.
- Confirmed `MessageToDict` is already imported (`client.py:12`) and used by sibling methods
  (`:294`, `:307`, `:320`, `:396`, `:422`) — switch `run_backtest` to the same helper.
- Confirmed the tool wrapper `async def run_backtest` at `app/tools.py:232`.

**TDD**: `red-green required`

**Instructions**:
1. In `client.py` `run_backtest` (`:138`), replace the manual 7-field dict with
   `return MessageToDict(resp, preserving_proto_field_name=True)` (matches sibling calls; keeps
   snake_case keys). This surfaces the new `diagnostics` array and restores the currently-dropped
   `trades` / `status` / `coverage_gaps`.
2. In `tools.py` `run_backtest` (`:232`), update the tool docstring so the agent knows the result
   now includes per-bar `diagnostics` (OHLCV, indicator series, warm-up, action, conviction,
   per-symbol `no_trade_reason`) and should **suggest strategy/indicator changes** from that data
   (FR / OQ-3). Response is bounded by the 2-year cap (~504 rows/symbol).

**Verification**: covered by Step 17 (paired test) plus its lint gate.

---

### Step 17 — test: agent run_backtest projection includes diagnostics

**Status**: `pending`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/tests/test_tools.py` — modify

**Reviewers**: `xstockstrat-analysis` (service owner) — RunBacktest contract surfaced by the tool.

**Codebase Evidence**:
- Confirmed `tests/test_tools.py:231` mocks `client.run_backtest` wholesale (recon.md) — add a
  client-level projection test that feeds a real `BacktestResult` proto (with `diagnostics`) through
  `MessageToDict`.

**TDD**: `red-green required` — fails against the pre-Step-16 tree (manual dict drops `diagnostics`).

**Instructions**:
1. Add a test that constructs a `BacktestResult` proto containing a `SymbolDiagnostics` and asserts
   the `client.run_backtest` projection dict contains snake_case `diagnostics` (and restored
   `trades` / `status` / `coverage_gaps`).
2. Keep/adjust the existing tool-level mock test so it still passes with the enriched return shape.

**Verification**:
```bash
cd services/xstockstrat-agent && ruff check . && ruff format --check . \
  && pytest --cov=app --cov-fail-under=40
```
(Agent has no dedicated threshold row; use the general Python 40% floor. If agent CI uses a different
threshold, match `.github/workflows/ci.yml` at execute time.)

---

## Deviation Log

_Populated by /sdd-execute as implementation proceeds._
