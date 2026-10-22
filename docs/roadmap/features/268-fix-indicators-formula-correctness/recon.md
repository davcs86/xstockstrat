# Recon: fix-indicators-formula-correctness

**Created**: 2026-10-21
**From**: product-spec.md
**Affected services**: xstockstrat-indicators (fix site), xstockstrat-analysis (ATR/VWAP + ExecuteFormula consumer), packages/proto (only under OQ-1 Option B)

---

## Objective

Close three SEV-2 correctness defects in `xstockstrat-indicators` (scope D-10, D-18, D-54 — operator decision,
2026-10-21). D-10: a sandbox run that never emits a parseable `__OUTPUT__:` line must fail instead of returning
`success=True, output={}`. D-18: `ATR`/`VWAP` must either be re-described to match their close-only math
(Option A) or compute the true OHLCV indicators (Option B; OQ-1). D-54: `UpdateFormula`/`DeleteFormula` must
treat pending-hidden (`pending_intent_id` set) rows as `NOT_FOUND`, as `_load_formula` already does for reads.

## Codebase Map

- **`xstockstrat-indicators`** (Python)
  - Entry point: `serve()` — `services/xstockstrat-indicators/app/main.py:42` (server `:74`, servicer registered `:75`)
  - Handler/servicer: `services/xstockstrat-indicators/app/handlers/servicer.py`
    - `_load_formula` (pending-hidden read helper) — `servicer.py:150-158`; hide check `:156`
      `> if row is not None and row.get("pending_intent_id") is None:`
    - `UpdateFormula` — `@owner_scoped` `:485`, def `:486`; raw `get_by_id` `:490`; NOT_FOUND abort `:491-495`;
      SYSTEM_AUTHOR check `:496`; author check `:502`
    - `DeleteFormula` — def `:589`; raw `get_by_id` `:593`; NOT_FOUND abort `:594-598`; SYSTEM_AUTHOR check `:599`
    - `ExecuteFormula` `exit_reason` string→enum map — `servicer.py:313-319`; unknown → `UNSPECIFIED` `:350-351`
  - Sandbox: `services/xstockstrat-indicators/app/services/sandbox.py`
    - Restricted builtins admit every `BaseException` subclass — `sandbox.py:252`
      `> or (isinstance(_obj, type) and issubclass(_obj, BaseException))`
    - Wrapper `exec`s user source `:307`; `__OUTPUT__:` print `:312` (skipped when source raises `SystemExit`)
    - Parent parse: `output = {}` `:394`; loop `:395-400`; malformed line swallowed `:399-400`
      (`except json.JSONDecodeError: pass`)
    - Failure decided by return code only `:402`; stderr classification `:403-407`; failure result `:408-417`
    - Success result `:419-428` (`exit_reason="success"`) — the D-10 fix site
    - `SandboxResult.exit_reason: str` — `sandbox.py:197`
  - Engine: `services/xstockstrat-indicators/app/services/indicators_engine.py`
    - Dispatch entries `"ATR": _atr` `:30`, `"VWAP": _vwap` `:31`
    - `_atr` `:103-108` — `s.diff().abs().rolling(window=period).mean()` (docstring claims a range approximation)
    - `_vwap` `:111-116` — `cumsum / count` (running mean, no volume)
    - `INDICATOR_REGISTRY` `:135`; `"ATR"` description `:141`, `"VWAP"` description `:142`
  - Last migration: `007_private_formulas_templates.up.sql` (`services/xstockstrat-indicators/migrations/`) — none needed
  - Config-read pattern: `services/xstockstrat-indicators/app/config/watcher.py:133` (`sandbox_timeout_ms`),
    `:147` (`sandbox_max_concurrent`) — unchanged by this feature

- **`xstockstrat-analysis`** (Python) — consumer only
  - Formula decode — `services/xstockstrat-analysis/app/services/evaluator.py:127-134`; `if not resp.success` `:133`
    raises `FormulaExecutionError` → FR-1's `success=false` already surfaces as `FORMULA_ERROR`, no code change
  - `_SUPPORTED_INDICATORS` — `evaluator.py:141`; output catalog `"ATR": ("value",)` `:196`, `"VWAP": ("value",)` `:197`
  - Built-in compute (close-only) — `ComputeIndicatorRequest(` `evaluator.py:496`; `align_indicator_points` `:770`
  - Screener ATR enrichment — `services/xstockstrat-analysis/app/services/screener.py:285`; requests `:294`, `:360`;
    `ExecuteFormula` `:342-351` (logs a warning on `RpcError`; `success=false` handling not read)
  - Warm-up sizing — `services/xstockstrat-analysis/app/services/warmup.py:86` (`("RSI", "ATR")`), `:108` (`"VWAP"` → 0)
  - Snapshot defaults — `services/xstockstrat-analysis/app/engine/pnl_pattern_consumer.py:50`
    `> DEFAULT_INDICATORS = ("RSI", "ATR")`; request `:98`
  - Last migration: `027_contract_owner_dimension.up.sql` (`services/xstockstrat-analysis/migrations/`) — none needed

- **`packages/proto`** — only under Option B
  - `ComputeIndicatorRequest` — `packages/proto/indicators/v1/indicators.proto:54-61` (fields 1-6: `indicator`,
    `values`, `params`, `range`, `symbol`, `timeframe`; 7+ free; comment listing indicators `:55`)
  - `SandboxExitReason` — `indicators.proto:101-108` (`RUNTIME_ERROR = 4` reusable; no new value needed)
  - `ExecuteFormulaResponse` already carries `success`, `error`, `exit_reason` — `indicators.proto:89-99`
  - `IndicatorMeta` (`ListIndicators` payload, carries `description`) — `indicators.proto:190-195`

- **`xstockstrat-ui`** (duplicated surface, not a listed affected service)
  - Static catalog repeats both names — `services/xstockstrat-ui/src/lib/strategyCatalog.ts:98-100`
    (`'Average True Range'`), `:103-104` (`'Volume Weighted Average Price'`)

## Patterns to REUSE

- D-10 failure result → reuse the existing `SandboxResult(success=False, ...)` construction at `sandbox.py:408-417`
  and the `"runtime_error"` exit reason (mapped at `servicer.py:313-319` to `SANDBOX_EXIT_REASON_RUNTIME_ERROR`);
  no new enum value.
- D-10 error shape precedent → servicer's declared-outputs check already fails with `RUNTIME_ERROR`
  (`servicer.py:336`; indicators `CLAUDE.md` § Declared Formula Outputs).
- D-10 fail-closed direction → mirrors `@feature-228` "A failed baseline probe never runs the formula"
  (`runtime_error`).
- D-54 pending-hidden predicate → reuse `row.get("pending_intent_id") is None` from `_load_formula`
  (`servicer.py:156`) inline after each raw `get_by_id` (`:490`, `:593`). `_load_formula` itself cannot be
  reused directly: it returns a converted formula and may serve from cache.
- D-54 NOT_FOUND abort → reuse `context.abort(grpc.StatusCode.NOT_FOUND, f"formula {request.formula_id} not found")`
  + `return` at `servicer.py:491-495` / `:594-598` (same message, so pending rows are indistinguishable from missing).
- D-18 Option A → edit only the two description strings at `indicators_engine.py:141-142` (and the misleading
  `_atr`/`_vwap` docstrings); keys `ATR`/`VWAP` unchanged, so no analysis change.
- D-18 Option B → additive proto fields 7+ on `ComputeIndicatorRequest`, keeping `values = 2` as close; follow the
  file's `// feature NNN` comment convention.

## Existing Business Rules (preserve / extend)

- **PRESERVE** `@AC-1 @FR-1 @regression @feature-228` "The 800x800 matmul fits within half the default headroom" (`services/xstockstrat-indicators/acceptance/fix-indicators-sandbox-matrix.feature`) — a normal formula still returns success=true with its output (the D-10 FR-2 guard).
- **PRESERVE** `@AC-2 @FR-2 @regression @feature-228` "An allocation beyond the headroom fails closed" (`services/xstockstrat-indicators/acceptance/fix-indicators-sandbox-matrix.feature`) — exit_reason stays `memory_exceeded`. The no-output failure must not overwrite a classified reason.
- **PRESERVE** `@AC-3 @FR-1 @regression @feature-228` "The formula budget does not depend on the interpreter's import footprint" (`services/xstockstrat-indicators/acceptance/fix-indicators-sandbox-matrix.feature`) — a 32 MiB numpy-ones formula still succeeds.
- **PRESERVE** `@AC-4 @FR-2 @regression @feature-228` "An OpenBLAS allocation abort is classified as out-of-memory" (`services/xstockstrat-indicators/acceptance/fix-indicators-sandbox-matrix.feature`) — stderr-based classification runs before or beside the new no-output failure.
- **PRESERVE** `@AC-5 @FR-3 @regression @feature-228` "A failed baseline probe never runs the formula" (`services/xstockstrat-indicators/acceptance/fix-indicators-sandbox-matrix.feature`) — fail-closed with exit_reason `runtime_error`. D-10 extends the same direction.
- **PRESERVE** `@AC-3 @FR-3 @feature-209` "An infinite-loop / memory-bomb formula is terminated deterministically" (`services/xstockstrat-indicators/acceptance/indicators-sandbox-os-isolation.feature`) — timeout and memory kills keep their typed error.
- **PRESERVE** `@AC-4 @FR-4 @feature-209` "A legitimate formula evaluates to the identical result as before isolation" (`services/xstockstrat-indicators/acceptance/indicators-sandbox-os-isolation.feature`) — an RSI formula returns an identical result.
- **PRESERVE** `@AC-5 @FR-5 @feature-176` "Concurrent formula executions are no longer serialized to one at a time" (`services/xstockstrat-indicators/acceptance/analysis-concurrency-offload.feature`) — the sandbox change adds no serialization.
- **PRESERVE** `@AC-1 @FR-1 @feature-224` "Another user's formulas are invisible even if formerly public" (`services/xstockstrat-indicators/acceptance/private-by-default-templates.feature`) — a non-owner gets NOT_FOUND; the NOT_FOUND for pending-hidden rows in Update/Delete follows this no-existence-leak posture.
- **PRESERVE** `@AC-28 @FR-13 @feature-224` "Admins can read but not change another user's objects" (`services/xstockstrat-indicators/acceptance/private-by-default-templates.feature`) — ADMIN Update/Delete of a foreign formula stays `PERMISSION_DENIED`. Check order must be kept.
- **PRESERVE** `@AC-1 @FR-1 @feature-225` "A headerless owner-scoped call is rejected in indicators" (`services/xstockstrat-indicators/acceptance/private-by-default-enforce-contract.feature`) — Update/Delete stay behind the identity gate.
- **PRESERVE** `@AC-10 @FR-1 @feature-225` "An identified non-owner keeps the non-owner result" (`services/xstockstrat-indicators/acceptance/private-by-default-enforce-contract.feature`) — non-owner NOT_FOUND is unchanged.
- **PRESERVE** `@AC-11 @FR-4 @feature-225` "indicators no longer writes is_public, so the column can be dropped later" (`services/xstockstrat-indicators/acceptance/private-by-default-enforce-contract.feature`) — the UpdateFormula write must not reference `is_public`.
- **PRESERVE** `@AC-6 @FR-7 @feature-201` "A formula's declared fundamentals inputs are validated at formula-registration write time" (`services/xstockstrat-indicators/acceptance/fundamentals-formula-inputs.feature`) — UpdateFormula still rejects the UNSPECIFIED metric with INVALID_ARGUMENT.
- **PRESERVE** `@AC-18 @FR-9 @feature-224` "Strategy template instantiation deep-copies referenced formulas" (`docs/sdd/business-rules/platform.feature`) — the saga's pending copies are the rows D-54 protects.
- **PRESERVE** `@AC-19 @FR-9 @feature-224` "A failed deep copy leaves nothing behind" (`docs/sdd/business-rules/platform.feature`) — pending rows stay hidden and cannot be mutated before commit or abort.
- **PRESERVE** `@AC-23 @FR-11 @feature-224` "System special-cases are unchanged" (`docs/sdd/business-rules/platform.feature`) — UpdateFormula on the system formula stays `PERMISSION_DENIED`, not NOT_FOUND.
- **PRESERVE** `@AC-6 @FR-3 @FR-1 @feature-224` "The fundamentals loop still runs the system scoring formula" (`docs/sdd/business-rules/platform.feature`) — the seeded system formula still returns success=true.
- **PRESERVE** `@AC-7 @FR-6 @feature-205` "An authored fundamentals formula behaves identically as a strategy component" (`docs/sdd/business-rules/platform.feature`) — a successful `test_formula` score stays equal to the component output; only output-less runs change.
- **PRESERVE** `@AC-5 @FR-4 @feature-205` "Test a fundamentals-scoring formula with supplied values" (`services/xstockstrat-agent/acceptance/formula-fundamental-inputs-authoring.feature`) — `test_formula` still returns the computed score; a consumer surface of FR-1 whose failure rendering was not inspected.
- **PRESERVE** `@AC-3 @FR-3 @feature-176` "Per-component indicator calls run concurrently with deterministic output" (`services/xstockstrat-analysis/acceptance/analysis-concurrency-offload.feature`) — ComputeIndicator/ExecuteFormula consumer path stays deterministic.
- **PRESERVE** `@AC-7 @FR-1 @feature-201` "A technical (non-fundamentals) formula component is byte-for-byte unaffected" (`services/xstockstrat-analysis/acceptance/fundamentals-formula-inputs.feature`) — formula inputs for technical components are unchanged.
- **PRESERVE** `@AC-1 @FR-1 @FR-2 @feature-042` "Filling an order captures a snapshot with indicator and signal context" (`services/xstockstrat-analysis/acceptance/order-snapshots-pnl-patterns.feature`) — the snapshot's default `RSI`/`ATR` indicators map stays non-empty. The `ATR` key keeps resolving. Option B must supply OHLCV at that call site.
- **PRESERVE** `@AC-5 @FR-3 @feature-224` "analysis cannot execute a formula its strategy owner does not own" (`services/xstockstrat-analysis/acceptance/private-by-default-templates.feature`) — analysis keeps calling ExecuteFormula as the strategy owner.
- **EXTEND** (no existing `@AC-*`) — FR-3/FR-4: no durable rule covers `ATR`/`VWAP` compute or `ListIndicators` text. The feature adds the first (new `@AC-4`/`@AC-5` under Option A, or `@AC-8`/`@AC-9` under Option B).
- **EXTEND** (no existing `@AC-*`) — FR-1: no durable rule covers the success=false path for an early-exit or unparseable-output run. New `@AC-1`/`@AC-2` sit beside the `@feature-228` fail-closed rules.
- **EXTEND** (no existing `@AC-*`) — FR-5: no durable rule covers UpdateFormula/DeleteFormula on pending-hidden rows. New `@AC-6`/`@AC-7` sit beside `@feature-224` `@AC-1` and `@AC-28`.
- No **CHANGE**: FR-1 turns an implicit empty success into a failure; no promoted rule asserts an empty-output success.
- `packages/proto` has no acceptance suite of its own.

## Dependencies

- Proto/RPC: Option A — none. Option B — additive `repeated double` OHLCV fields (7+) on `ComputeIndicatorRequest`
  (`packages/proto/indicators/v1/indicators.proto:54-61`); Proto Reviewer gate, `buf lint`/`buf breaking` (C-09),
  `./scripts/buf-gen.sh`. Must not touch `timeframe = 6` (stalled enum migration,
  `packages/proto/docs/context-constitution-findings.md:10`). D-10/D-54 need no proto change (`exit_reason`/`error`
  exist at `:89-99`; reuse `RUNTIME_ERROR = 4`). Optional comment-only edit to `UpdateFormula`/`DeleteFormula` RPC
  docs (`indicators.proto:34-40`) to mention `NOT_FOUND` — triggers `buf-gen` if made.
- Migration: none (indicators next free `008`; analysis next free `028` — both unused).
- Config keys: none (`indicators.sandbox.*` unchanged).
- Inter-service edges: existing analysis → indicators (`ComputeIndicator`, `ExecuteFormula`) via
  `INDICATORS_ENDPOINT=xstockstrat-indicators:50054`; no new edge.
- New env vars / ports: none.

## Risks / Not-found

- **D-10 classification order.** The new no-output failure must apply only on `returncode == 0`
  (after `sandbox.py:402`), so timeout/memory/import classifications (`:403-407`, `@feature-209`/`@feature-228`)
  are never re-labelled "produced no output". Fix is in the parent (track `saw_output`/`parse_ok` in `:395-400`),
  which covers `SystemExit` and any other early clean exit; stripping `SystemExit`/`KeyboardInterrupt`/
  `GeneratorExit` from builtins (`:252`) is an optional second layer (design fork from triage).
- **D-10 unassigned `result` (design fork, C-11).** A formula that exits normally without assigning `result`
  still prints `__OUTPUT__:{}`, because the wrapper defaults to `{}` (`sandbox.py:310`
  `> _output = _formula_globals.get('result', {{}})`). That output parses, so FR-1 as written still reports
  success with empty output. Design must decide whether to keep this or fail it too.
- **D-10 behavior change.** Any existing `tests/test_sandbox.py` case expecting a no-output exit to succeed will
  break (success asserts at `:24`, `:120`, `:141`; `runtime_error` at `:36`). No existing `SystemExit` test
  (grep of `test_sandbox.py` empty). The seeded system fundamentals formula (`@AC-6 @feature-224`) must still emit
  output.
- **D-10 downstream.** Analysis `evaluator.py:133` already raises `FormulaExecutionError` on `success=false`; the
  screener's `ExecuteFormula` path (`screener.py:342-351`) handling of `success=false` was not read. Feature
  246-fix-fundsignal-neutral-score relies on `_score_via_formula` → `ExecuteFormula`; re-check after 268.
- **D-18 duplicated surface (C-10).** Under Option A, `services/xstockstrat-ui/src/lib/strategyCatalog.ts:99`, `:104`
  still say "Average True Range"/"Volume Weighted Average Price". The UI is not in the product-spec's affected
  services; design must decide whether the catalog text is in scope or record it as out of scope.
- **D-18 Option B blast radius.** Every `ComputeIndicatorRequest` site would need bars plumbing: `evaluator.py:496`
  (only `closes` in scope), `screener.py:294`, `:360`, `pnl_pattern_consumer.py:98`; `warmup.py:86` lookback must be
  rechecked for a Wilder ATR (with the indicators-side pinning test, `warmup.py:32-38` docstring). Stored grades and
  `pnl_pattern_samples` hold old-semantics numbers; no recompute path exists (OQ-2). Ledger insight
  (071, `insights.md` "warm-up is verified at runtime") notes `_vwap` emits a finite value at index 0 — keep that
  in mind for any warm-up guard.
- **D-54 check order.** The pending-hidden NOT_FOUND must sit between the `row is None` check and the SYSTEM_AUTHOR
  / author checks without breaking `@AC-23` (system formula → `PERMISSION_DENIED`) or `@AC-28` (ADMIN on foreign →
  `PERMISSION_DENIED`). Open design point: what an ADMIN/non-owner gets on a *pending* row — NOT_FOUND matches the
  no-existence-leak rule (`@AC-1 @feature-224`).
- **Ledger trap** (`fails.md` 2026-07-01 063): `UpdateFormula`/`DeleteFormula` guards were previously incomplete for
  the system formula — add a test per guard branch, not just the new one.
- **Ledger trap** (`fails.md` MagicMock proto stand-ins): tests asserting proto fields (`exit_reason`) should use
  real `indicators_pb2` messages.
- **Overlaps.** 244-fix-python-config-stored-zero edits `sandbox.py:282`, `:345-346` and `ExecuteFormula` config
  reads — disjoint regions, rebase risk only. 269-fix-template-update-metadata edits template RPCs in `servicer.py`
  — disjoint. Open adjacent report `docs/reports/2026-10-19-sandbox-exit-reason-stderr-substring-defect.md` touches
  `:403-407` right beside the D-10 change; design may absorb or defer it (out of operator scope D-10/D-18/D-54
  unless signed off).
- **Not verified:** `ListIndicators` wiring from `INDICATOR_REGISTRY` in `servicer.py`; sandbox-isolation and
  formula-RPC test bodies (`tests/test_sandbox_isolation.py`, `tests/test_formulas.py`, `tests/test_private_formulas.py`,
  `tests/test_formula_templates.py`) beyond greps; `platform.feature` lines 1-224 and 314-end.

## Recommended Scope

Advisory, assuming Option A (no proto change); Option B would add a proto step, an analysis plumbing step and a
recompute/communication decision.

1. **service — D-10 (indicators `sandbox.py`)**: on `returncode == 0`, fail with `runtime_error` when no
   `__OUTPUT__:` line was seen ("produced no output") or none parsed ("could not be parsed"); optionally drop
   `SystemExit`/`KeyboardInterrupt`/`GeneratorExit` from builtins. Paired **test** in `tests/test_sandbox.py`
   (AC-1/AC-2 + preserve `@feature-228` matrix). The error text must contain "produced no output" (AC-1) and
   "could not be parsed" (AC-2) — `acceptance.feature:12`, `:21`.
2. **service — D-54 (indicators `servicer.py`)**: inline pending-hidden → NOT_FOUND after `get_by_id` in
   `UpdateFormula` (`:490`) and `DeleteFormula` (`:593`). Paired **test** in `tests/test_formulas.py` /
   `tests/test_private_formulas.py` (AC-6/AC-7 + system/ADMIN order).
3. **service — D-18 Option A (indicators `indicators_engine.py`)**: re-describe ATR/VWAP at `:141-142` and fix the
   `_atr`/`_vwap` docstrings; decide on `strategyCatalog.ts`. Paired **test** in `tests/test_indicators_engine.py`
   (AC-4/AC-5).
4. **docs**: indicators `CLAUDE.md` / `docs/context-constitution*.md` drift for the new sandbox failure rule.
