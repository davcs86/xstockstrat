# Implementation Spec: fix-analysis-per-symbol-isolation

**Status**: `pending`
**Created**: 2026-11-20
**Feature**: `docs/roadmap/features/308-fix-analysis-per-symbol-isolation/feature.md`
**Total Steps**: 23
**Feature Branch**: `feature/fix-analysis-per-symbol-isolation`
**Tree**: docs read at `origin/feature/fix-analysis-per-symbol-isolation@2b660ff1`; that branch holds
docs commits only and is 168 commits behind `origin/main-dev`. Every code `path:line` below was
grepped on `origin/main-dev@36aed60b`, the code tree `/sdd-execute` BRANCH SYNC merges in before
Step 1. Re-checked at `/sdd-review impl-spec` on `origin/main-dev@fb52065c`: between the two commits
only `app/telemetry.py` and `tests/test_telemetry.py` changed in analysis and indicators, so no cited
file moved. Re-grep each anchor at execute time. Peers that edit a file this spec edits: 327
(analysis `servicer.py:7282`) and 310 (indicators `servicer.py:397,413`, see Step Dependencies).
Peers 309 and 313 cite the ingest servicer, not this one.

**Re-spec 2026-11-26 (operator ruling on O-9)**: Steps 17-20 are new (the cue on the mobile
`SignalRow` and the Signal-detail header); the former Step 17 (docs) is now Step 23. The UI
anchors in Steps 17-20 were grepped on the merged branch head `4054a35c`; Steps 1-16 are unchanged
except as listed next.

**Re-spec 2026-11-26 (operator ruling on the readiness card, and an independent impl-spec review)**:
Steps 21-22 are new (the `SignalReadiness` "Why this fired" arm and its test); Step 16 loses its
`mock-backend.ts` edit and gains a whole-suite import check; Step 23 gains the C-10 shell doc.
Anchors for Steps 17-22 are line numbers from one checkout and can drift: edit by symbol and
re-grep.

---

## Execution Summary

The fix follows design.md's build order in one PR. Steps 1-4 add the typed classification input
(`FormulaExecutionError.exit_reason`, `_is_transient_formula_error`, the indicators deadline-refusal
field). Steps 5-8 add the shared isolation helper and the `evaluation_failed` marker plumbing, both
additive. Steps 9-14 isolate the five fan-out sites (readiness callers, `_compute_opportunities`,
heal), each paired with its regression tests. Steps 15-16 land the insights opportunities cue,
Steps 17-18 land it on the mobile `SignalRow`, Steps 19-20 land it on the Signal-detail header,
Steps 21-22 land a matching arm in the Signal-detail "Why this fired" card, and Step 23 lands the
signed-off durable-suite amendments and the documentation.

**Scenario coverage (C-15):** `@AC-1` → Step 12. `@AC-2` → Step 10. `@AC-3` → Step 10 (kick and
materializer) and Step 14 (surgical retry).

**Consumer surfaces (C-14):** the product spec is a bug template with no `## Consumer Surface(s)`
section; design.md § 5 names the surface. UI `/insights` opportunities page → Steps 15-16; the mobile `SignalRow` on that page → Steps 17-18;
the `/trader` Signal-detail header → Steps 19-20, and its "Why this fired" card → Steps 21-22. Agent
`list_opportunities` → no code step: the tool already returns `provenance` verbatim
(`services/xstockstrat-agent/app/client.py:902`), so the new token reaches it unchanged; Step 23
documents it in `docs/runbooks/mcp-tools.md`.

**Decisions recorded at /sdd-spec:**

- **O-9 (cue parity on mobile `SignalRow` and the Signal-detail header)** is built in 308, not
  deferred (operator ruling 2026-11-26, "Build the cue parity in 308"; it overturns the
  `/sdd-spec` deferral to `evaluation-failed-cue-parity`, which is no longer a follow-up). This is
  the first of the two options design.md O-9 names: render `EVALUATION_FAILED_CUE` through a
  `SignalItem` field plumbed via `sections.ts` with the shared constant. Mobile: Steps 17-18. Detail
  header: Steps 19-20. The Signal-detail "Why this fired" card (`SignalReadiness.tsx`) was outside that
  ruling; a second ruling the same day ("Add a card arm in 308") adds it: Steps 21-22. Before 308 a
  failing `EvaluateReadiness` raised and the card said "Failed to evaluate readiness"; Step 9 now
  returns an empty 0-of-0 row, which the card would render as "no entry conditions to evaluate".
  A third ruling (2026-11-27, "B4 yes") narrows the arm: it renders only when the row's provenance
  includes `evaluation_failed` AND the readiness row is empty (no conditions); real conditions from a
  live `EvaluateReadiness` still render as today, even while the stored row is stale-marked.
- **Degraded-rate alerting** is deferred to a named follow-up feature, slug
  `analysis-isolation-degraded-counter` (a counter `analysis.isolation.degraded{site}` plus an alert
  rule). Until it lands a sustained degraded rate shows only in WARN/ERROR logs and span attributes.
  Step 23 records it in the analysis findings log.
- **`evaluation_failed` token** gets one Python constant `EVALUATION_FAILED_PROVENANCE` in
  `app/repositories/opportunities.py`, beside `_PROVENANCE_STRUCTURAL_MARKERS`. The SQL floor clause
  keeps a literal, like its three sibling clauses; Step 8 pins the two against each other.
- **Not isolated (outside the design's five sites):** the per-strategy setup in the readiness kick
  (`get_by_owner_and_id`, `_load_benchmark_bars_windowed`, `_formula_fundamentals`,
  `servicer.py:4310-4331`) and in the materializer still fails the whole kick or owner pass. Defect
  report 3 ("a transient outage does not discard the batch") is therefore only partly met for a
  failure in that setup path; Step 23 records it in the analysis findings log.

## Step Dependencies

- Steps 1+2 land together: Step 1 makes `_decode_formula_output` read `resp.exit_reason`, a required
  attribute the existing `success=False` test doubles lack (step-constraints §C, row 1: required
  argument change with test call sites).
- Step 4 [test] covers Step 3 [service]. Step 6 [test] covers Step 5 [service]. Step 8 [test]
  covers Step 7 [service]. Step 14 [test] covers Step 13 [service]. Step 16 [test] covers Step 15.
  Step 18 [test] covers Step 17 [service]. Step 20 [test] covers Step 19 [service]. Step 22 [test]
  covers Step 21 [service].
  These service steps are additive and pass alone, so no unit is declared. For each, RED is captured
  by running the new test against the prior step's app files (`git checkout <prior-step-sha> --
  <the service step's Files>`, restored before GREEN), per `docs/roadmap/ledger/insights.md`
  (2026-11-04, fix-python-config-stored-zero, ordering).
- Steps 9+10 land together: Step 9 changes behavior pinned by the existing test
  `test_evaluate_readiness_timeout_raises_not_converted_to_marker`
  (`tests/test_unreadable_formula.py:691`), which Step 10 rewrites (§C, row 1).
- Steps 11+12 land together: Step 11 changes behavior pinned by
  `test_opportunity_recompute_timeout_fails_and_keeps_stored_rows`
  (`tests/test_unreadable_formula.py:671`), which Step 12 rewrites (§C, row 1).
- Step 5 requires nothing; Steps 9, 11 and 13 require Step 5 (`isolated`, `log_isolation_tally`).
- Steps 11 and 13 require Step 1 (`_is_transient_formula_error`) and Step 7
  (`EVALUATION_FAILED_PROVENANCE`).
- Step 3 must be in the same PR as Step 11: without it a load-driven deadline refusal is classified
  terminal (design D-9).
- Step 15 requires Step 7 only by contract (the wire token); it has no build dependency.
- Steps 17, 19 and 21 require Step 15 (the exports `EVALUATION_FAILED_PROVENANCE` and
  `EVALUATION_FAILED_CUE` in `src/lib/readinessCue.ts`). Steps 18, 20 and 22 require Step 16 (the
  fixture `MYSZ_EVALUATION_FAILED_OPPORTUNITY` and its `INVENTORY.md` row). Steps 17-22 stay on
  the one UI consumer surface and each service step passes its own Verification alone (the one
  construction site of the new required `SignalItem` field is edited in Step 17, and Step 21 adds
  no signature), so no unit is declared. Step 22 also requires Step 20 (the in-file
  `routeEvaluationFailedRow` helper). RED for Steps 18, 20 and 22 is captured as for Step 16: check out the prior step's app
  files, run the new test, restore.
- Step 23 requires Steps 9-14: the durable scenarios it amends describe the post-fix behavior.
- Deferred surfaces: `analysis-isolation-degraded-counter` only. It has no feature number yet;
  `scripts/sdd-allocate-feature-number.py` allocates one when it is storied. The O-9 cue parity is
  built (Steps 17-22), not deferred.
- Peer `fix-sandbox-result-contract` (310) edits the same indicators `servicer.py` and changes how
  `exit_reason` is derived (its product-spec.md:40,55). Step 3 has no build dependency on it: the
  field and the `"timeout"` map entry (`servicer.py:364`) exist today. Whichever feature lands
  second re-greps Step 3's anchor and re-runs Step 4.

---

### Step 1 — service: typed `exit_reason` on `FormulaExecutionError` and the transient predicate

**Status**: `done`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/app/services/evaluator.py` — modify

**Reviewers**: xstockstrat-analysis owner — backtest reproducibility, strategy scoring determinism, no look-ahead bias

**Codebase Evidence**:
- `grep -n "class FormulaExecutionError" app/services/evaluator.py` → line 107; `__init__(self,
  formula_id: str, error: str, code: str = "")` at line 114.
- `_decode_formula_output` at line 134; `raise FormulaExecutionError(formula_id, resp.error)` at
  line 141 (the `not resp.success` raise); the `ValueError` raise at line 145.
- Callers of `_decode_formula_output`: `evaluator.py:544` and `:622` only.
- Other raises: `:269` (owner-unreadable, passes `code`), `:553` and `:560` (post-decode contract).
- `from gen.indicators.v1 import indicators_pb2` already imported at line 23; `import grpc` at 21.
- Enum: `packages/proto/indicators/v1/indicators.proto:97` (`SandboxExitReason exit_reason = 8`),
  `:104` (`SANDBOX_EXIT_REASON_TIMEOUT = 2`). No proto change.
- `_is_transient_formula_error`: **Not found** — created in this step.

**Lands with**: `Step 2`

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. Add a keyword parameter `exit_reason: int = 0` after `code` in
   `FormulaExecutionError.__init__` and store it as `self.exit_reason`.
2. At line 141 pass `exit_reason=resp.exit_reason`. Read the attribute directly; no `getattr`
   default (design D-13). Leave lines 145, 269, 553 and 560 unchanged, so they carry `0`.
3. Add a module-level function `_is_transient_formula_error(exc: BaseException) -> bool` directly
   below `_decode_formula_output`. It returns True only for a `grpc.RpcError`, or a
   `FormulaExecutionError` whose `exit_reason == indicators_pb2.SANDBOX_EXIT_REASON_TIMEOUT`.
   Everything else is False, including UNSPECIFIED and MEMORY_EXCEEDED (design R-7, R-8).

**Verification**:
Runs as one unit with Step 2; use Step 2's commands.

---

### Step 2 — test: predicate tests and `exit_reason` on every ExecuteFormula response double

**Status**: `done`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/tests/test_strategy_evaluator.py` — modify
- `services/xstockstrat-analysis/tests/test_analysis_servicer.py` — modify
- `services/xstockstrat-analysis/tests/test_unreadable_formula.py` — modify
- `services/xstockstrat-analysis/tests/test_fundamentals_formula_operand.py` — modify
- `services/xstockstrat-analysis/tests/test_fundamentals_formula_servicer.py` — modify
- `services/xstockstrat-analysis/tests/test_sector_params.py` — modify
- `services/xstockstrat-analysis/tests/test_fundamentals_guard.py` — modify
- `services/xstockstrat-analysis/tests/test_backtest_fundamentals_guard.py` — modify
- `services/xstockstrat-analysis/tests/test_screener.py` — modify
- `services/xstockstrat-analysis/tests/test_fundsignal_loop.py` — modify
- `services/xstockstrat-analysis/tests/test_owner_header_guard.py` — modify
- `services/xstockstrat-analysis/tests/test_opportunities_fundamentals_guard.py` — modify

**Reviewers**: xstockstrat-analysis owner — backtest reproducibility, strategy scoring determinism, no look-ahead bias

**Codebase Evidence**:
- `grep -rn "SimpleNamespace(success=" tests` (O-10, D-13 inventory; re-run on
  `feature/fix-analysis-per-symbol-isolation@985d694c`, which contains `origin/main-dev@8baf3976`). Doubles that reach
  `_decode_formula_output` with `success=False` and turn red under Step 1:
  `test_strategy_evaluator.py:521` (`_formula_stub`, called with `success=False` at `:581`),
  `test_analysis_servicer.py:1758,1789,1790,2044`, `test_fundamentals_formula_operand.py:141`,
  `test_unreadable_formula.py:287,675,695`.
- `success=True` single-line doubles (gain `exit_reason=0` for one shape):
  `test_strategy_evaluator.py:387`, `test_analysis_servicer.py:1165,1701,1759,1839,4207,4262,6816`,
  `test_fundamentals_formula_servicer.py:111,161`, `test_sector_params.py:183`,
  `test_fundamentals_guard.py:212`, `test_fundamentals_formula_operand.py:48,167`,
  `test_backtest_fundamentals_guard.py:124`, `test_unreadable_formula.py:416,505`,
  `test_screener.py:45` (the `formula_resp` helper), `test_fundsignal_loop.py:688`,
  `test_owner_header_guard.py:229`, `test_opportunities_fundamentals_guard.py:202`.
- `success=False` double that does not reach `_decode_formula_output` (the screener checks
  `resp.success` itself at `app/services/screener.py:382`), so it stays green under Step 1 and
  gains `exit_reason=0` only to satisfy the Verification grep: `test_screener.py:549`.
- Already carries the field: `test_fundamentals_scoring.py:16`.
- Other shapes (re-checked on `985d694c`): the multi-line grep in Instructions 1
  returns nothing, and `grep -rn "ExecuteFormulaResponse(" tests` returns nothing, so every
  ExecuteFormula response double is a single-line `SimpleNamespace(success=` or `_formula_stub`.
- `_TIMEOUT = "Formula execution timed out after 5000ms"` at `test_unreadable_formula.py:214`.
- Existing raise tests that pin the exception type: `test_strategy_evaluator.py:574-617`.

**Lands with**: `Step 1`

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. Re-run the grep above, then
   `grep -rn -A4 "SimpleNamespace($" tests | grep "success="` for multi-line constructions. Add
   `exit_reason=0` to every ExecuteFormula response double found. The three `_TIMEOUT` doubles
   (`test_unreadable_formula.py:287,675,695`) get
   `exit_reason=indicators_pb2.SANDBOX_EXIT_REASON_TIMEOUT` instead. `_formula_stub` gains an
   `exit_reason=0` keyword that it forwards.
2. In `test_strategy_evaluator.py` add, next to the `_formula_stub` raise tests:
   - `_decode_formula_output` on a `success=False` response with `exit_reason=TIMEOUT` raises a
     `FormulaExecutionError` whose `exit_reason` is TIMEOUT. Build the error through
     `_decode_formula_output`, never by hand (design O-2 closure).
   - `_is_transient_formula_error` is True for that error and for `aio_rpc_error(UNAVAILABLE)`
     (`tests/conftest.py:145`), and False for UNSPECIFIED, RUNTIME_ERROR, IMPORT_BLOCKED,
     MEMORY_EXCEEDED, a `FormulaExecutionError` built with no `exit_reason`, `ValueError` and
     `ZeroDivisionError` (parametrized).
3. C-13: the doubles are response stubs, not domain fixtures, and each stays in its own file; no
   second consumer of a domain literal is created, so nothing moves to `tests/conftest.py`.
4. RED (unit): write the tests and double edits first, run them on the pre-Step-1 `evaluator.py`
   (the predicate import fails and the `exit_reason` assertion fails), then apply Step 1.

**Verification**:
```bash
cd services/xstockstrat-analysis
grep -rn "SimpleNamespace(success=" tests | grep -v exit_reason   # expect no output
grep -rn -A4 "SimpleNamespace($" tests | grep "success="   # expect no output; a hit is a multi-line double to check by hand
grep -rn "ExecuteFormulaResponse(" tests   # expect no output; a hit is a double the greps above do not cover
uv run pytest tests/test_strategy_evaluator.py tests/test_unreadable_formula.py -q
uv run pytest --cov=app --cov-fail-under=40   # full suite: a missed success=False double fails here with AttributeError
ruff check . && ruff format --check .
```

---

### Step 3 — service: indicators deadline refusal reports `SANDBOX_EXIT_REASON_TIMEOUT`

**Status**: `done`
**Service**: `xstockstrat-indicators`
**Files**:
- `services/xstockstrat-indicators/app/handlers/servicer.py` — modify

**Reviewers**: xstockstrat-indicators owner — formula sandboxing, numeric precision, timeout enforcement (`indicators.sandbox.timeout_ms`), no side-effects from formula execution

**Codebase Evidence**:
- `grep -n "refused_remaining_ms" app/handlers/servicer.py` → lines 315, 327, 351, 355. The refusal
  response is built at lines 351-359 with `success=False` and `error=` only; `exit_reason` is unset
  (UNSPECIFIED).
- The early return precedes `record_sandbox_execution(exit_reason, run_seconds)` (line ~383), so
  indicators metrics do not change.
- Consumers only display the field: agent `tools.py` (`test_formula`) and analysis
  `app/services/fundamentals_scoring.py:64`.

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
Add `exit_reason=indicators_pb2.SANDBOX_EXIT_REASON_TIMEOUT` to the
`indicators_pb2.ExecuteFormulaResponse(...)` built in the `if refused_remaining_ms:` branch. Change
nothing else. Accepted side effect (design Open Risks): agent `test_formula` shows TIMEOUT instead
of UNSPECIFIED for a deadline-refused run. This is a D-9 in-scope cross-service touch.

**Verification**:
```bash
cd services/xstockstrat-indicators
grep -n -A9 "if refused_remaining_ms:" app/handlers/servicer.py | grep SANDBOX_EXIT_REASON_TIMEOUT
uv run pytest tests/test_sandbox_deadline.py -q
ruff check . && ruff format --check .
```

---

### Step 4 — test: assert the refusal's `exit_reason`

**Status**: `done`
**Service**: `xstockstrat-indicators`
**Files**:
- `services/xstockstrat-indicators/tests/test_sandbox_deadline.py` — modify

**Reviewers**: xstockstrat-indicators owner — formula sandboxing, numeric precision, timeout enforcement (`indicators.sandbox.timeout_ms`), no side-effects from formula execution

**Codebase Evidence**:
- `test_too_little_remaining_deadline_fails_without_spawning` at
  `tests/test_sandbox_deadline.py:74` already drives the refused path (`_ctx(5.55)`) and asserts
  `resp.success is False`, `"5550" in resp.error`, `calls == []`.

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
Add `assert resp.exit_reason == indicators_pb2.SANDBOX_EXIT_REASON_TIMEOUT` to that test (import
`indicators_pb2` the way the module's other imports do). RED: run it with
`app/handlers/servicer.py` checked out at the pre-Step-3 commit; it fails with `0 != 2`. C-13: no
domain literal added.

**Verification**:
```bash
cd services/xstockstrat-indicators
uv run pytest tests/test_sandbox_deadline.py -q
uv run pytest --cov=app --cov-fail-under=50
ruff check . && ruff format --check .
```

---

### Step 5 — service: shared `app/services/isolation.py`, adopted by the screener

**Status**: `done`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/app/services/isolation.py` — create
- `services/xstockstrat-analysis/app/services/screener.py` — modify

**Reviewers**: xstockstrat-analysis owner — backtest reproducibility, strategy scoring determinism, no look-ahead bias

**Codebase Evidence**:
- `app/services/isolation.py`: **Not found** — created from scratch (`ls app/services` lists
  `compute_pool.py cooldown.py evaluator.py fundamentals_guard.py fundamentals_scoring.py
  readiness.py scoring.py screener.py sector_params.py warmup.py`).
- Pattern to reuse: `ScreenerEngine._eval_symbol_isolated` at `screener.py:234-240` (`try` /
  `except Exception` returning `(row, exc)`; the comment at `:237-238` explains why not
  `BaseException`). Sole call site `screener.py:117`; no test references the method name.
- Tally to reuse: `screener.py:150-161` — `emit = log.error if len(failures) == len(per_symbol)
  else log.warning`, message `"screener: %d/%d scanned symbols failed evaluation; sample=%s"`,
  sample `[f"{s}:{type(e).__name__}" ...][:10]`, `exc_info=failures[0][1]`, then
  `span.set_attribute("screener.degraded_count", len(failures))` and `span.record_exception(...)`.
  `from opentelemetry import trace` at `screener.py:34`.
- Tests that pin the screener output: `tests/test_screener.py:903` (`"2/2 scanned symbols failed
  evaluation"` at ERROR), `:909` (WARNING), `:1029` (`span.attributes["screener.degraded_count"]`),
  `:842` (`test_cancelled_error_in_symbol_eval_propagates`).

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. Create `app/services/isolation.py` with two functions and no handler state:
   - `async def isolated(coro)` — awaits `coro` and returns `(result, None)`; on `except Exception
     as e` returns `(None, e)`. Never `BaseException`: `CancelledError` must pass through.
   - `def log_isolation_tally(logger, site: str, failures: list[tuple[str, Exception]], total:
     int) -> None` — no-op on empty `failures`. Otherwise emits the screener's one summary line
     through `logger` with the format `"%s: %d/%d scanned symbols failed evaluation; sample=%s"`
     (`site` first), at ERROR when `len(failures) == total` else WARNING, with the same sample
     shape and `exc_info`, then sets span attribute `f"{site}.degraded_count"` and records the
     first exception on the current span.
2. In `screener.py`, make `_eval_symbol_isolated` call `isolated(self._eval_symbol(symbol,
   *args))` and substitute `{**self._seed_row(symbol), "eval_failed": True}` when the exception is
   set. Replace the tally block at `:150-161` with `log_isolation_tally(log, "screener", failures,
   len(per_symbol))`. The rendered message and the `screener.degraded_count` attribute must stay
   byte-identical; the `test_screener.py` assertions above are the check.

**Verification**:
```bash
cd services/xstockstrat-analysis
uv run pytest tests/test_screener.py -q
ruff check . && ruff format --check .
```

---

### Step 6 — test: isolation helper unit tests with a cancellation mutation run

**Status**: `done`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/tests/test_isolation.py` — create

**Reviewers**: xstockstrat-analysis owner — backtest reproducibility, strategy scoring determinism, no look-ahead bias

**Codebase Evidence**:
- `tests/test_isolation.py`: **Not found** — created (`ls tests | grep isolation` is empty).
- Cancellation precedent: `tests/test_screener.py:842`
  (`test_cancelled_error_in_symbol_eval_propagates`); span-attribute precedent `:1018-1029`
  (`test_degraded_count_lands_on_current_span`).
- Ledger rule: `docs/roadmap/ledger/insights.md` (2026-11-04, fix-screener-symbol-isolation) — a
  cancellation guard is credited only after a mutation run shows it fail.

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
Test `isolated`: a returning coroutine gives `(value, None)`; one raising `ZeroDivisionError` gives
`(None, exc)`; one raising `asyncio.CancelledError` raises it out of `isolated`. Test
`log_isolation_tally`: no record on empty failures; WARNING for 1 of 3; ERROR for 2 of 2; the
message contains the site, the counts and `"NVDA:ZeroDivisionError"`; the span attribute
`"<site>.degraded_count"` is set (reuse the span setup shape at `test_screener.py:1018-1029`).
RED with teeth: mutate `except Exception` to `except BaseException` in `isolation.py`, run the
cancellation test, record that it fails, revert the mutation uncommitted. The module imports only
`app.services.isolation` and stdlib/pytest, so it adds no test-module import cycle. C-13: no domain
literal.

**Verification**:
```bash
cd services/xstockstrat-analysis
uv run pytest tests/test_isolation.py tests/test_screener.py -q
uv run pytest --cov=app --cov-fail-under=40
ruff check . && ruff format --check .
```

---

### Step 7 — service: `evaluation_failed` structural marker and read-floor exemption

**Status**: `done`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/app/repositories/opportunities.py` — modify

**Reviewers**: xstockstrat-analysis owner — backtest reproducibility, strategy scoring determinism, no look-ahead bias

**Codebase Evidence**:
- `_PROVENANCE_STRUCTURAL_MARKERS` at `app/repositories/opportunities.py:28-34`, ending with
  `"fundamentals_unavailable", "formula_unreadable"`; bound as the `text[]` param at `:290` and
  `:326`, and iterated by `servicer._primary_source` (`servicer.py:6835-6841`).
- Read-query floor exemption at `:264-266`:
  `AND (o.conviction >= $2 OR o.provenance ? 'denied' OR o.provenance ? 'unavailable' OR
  o.provenance ? 'fundamentals_unavailable' OR o.provenance ? 'formula_unreadable')`.
- `EVALUATION_FAILED_PROVENANCE`: **Not found** — created in this step.
- Wire derivation that must NOT change: `data_unavailable=("unavailable" in provenance)` at
  `servicer.py:6948` (design R-3, D-4).

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. Add `EVALUATION_FAILED_PROVENANCE = "evaluation_failed"` above
   `_PROVENANCE_STRUCTURAL_MARKERS` and append the constant to that list. Extend the block comment
   with one line: the marker is never a source or facet.
2. Add `OR o.provenance ? 'evaluation_failed'` to the floor clause at `:264-266`, as a literal like
   its siblings.
3. No migration: the marker is a JSONB provenance token (last analysis migration on main-dev is
   `029_seed_fundamentals_blend_strategy`).

**Verification**:
```bash
cd services/xstockstrat-analysis
grep -n "evaluation_failed" app/repositories/opportunities.py   # constant, list entry, SQL clause
uv run pytest tests/test_opportunities_repo.py -q
ruff check . && ruff format --check .
```

---

### Step 8 — test: marker is structural, floor-exempt, and the fake repo mirrors it

**Status**: `done`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/tests/test_opportunities_repo.py` — modify
- `services/xstockstrat-analysis/tests/test_analysis_servicer.py` — modify

**Reviewers**: xstockstrat-analysis owner — backtest reproducibility, strategy scoring determinism, no look-ahead bias

**Codebase Evidence**:
- Precedent tests at `tests/test_opportunities_repo.py:565-576`:
  `test_read_floor_exempts_formula_unreadable` (asserts `"o.provenance ? 'formula_unreadable'" in
  sql`) and `test_formula_unreadable_is_a_structural_marker` (asserts list membership and
  `_primary_source(["formula_unreadable", "uw"]) == "uw"`).
- `_FakeOppRepo.read` floor mirror at `tests/test_analysis_servicer.py:4540-4549`
  (`"denied" not in _prov and "unavailable" not in _prov and "formula_unreadable" not in _prov`).
  Ledger rule `docs/roadmap/ledger/fails.md` (2026-11-10, fix-analysis-admin-formula-refusal): list
  every fake that emulates production filtering when a structural marker is added.

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. Add `test_read_floor_exempts_evaluation_failed` and
   `test_evaluation_failed_is_a_structural_marker`, mirroring the two precedents. The SQL assertion
   builds its needle from the constant
   (`f"o.provenance ? '{EVALUATION_FAILED_PROVENANCE}'"`), which pins the literal to the constant.
2. Extend `_FakeOppRepo.read`'s floor condition with
   `and EVALUATION_FAILED_PROVENANCE not in _prov`, so Steps 12 and 14 can read a zero-conviction
   marked row back.
3. RED: against the pre-Step-7 repository file the import of the constant fails; say so in the
   red→green record. C-13: no domain literal added.

**Verification**:
```bash
cd services/xstockstrat-analysis
uv run pytest tests/test_opportunities_repo.py tests/test_analysis_servicer.py -q
uv run pytest --cov=app --cov-fail-under=40
ruff check . && ruff format --check .
```

---

### Step 9 — service: isolate the three readiness callers

**Status**: `done`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/app/services/readiness.py` — modify
- `services/xstockstrat-analysis/app/handlers/servicer.py` — modify

**Reviewers**: xstockstrat-analysis owner — backtest reproducibility, strategy scoring determinism, no look-ahead bias

**Codebase Evidence**:
- `compute_readiness_row` at `app/services/readiness.py:38`; its staged-row dict literal at
  `:96-106`; the `-1` invariant comment at `:92-94` ("written ONLY when the primary bars fetch
  RAISED"). The function itself stays unwrapped (design R-1).
- `EvaluateReadiness`: `_readiness_for` at `servicer.py:4051` (loaders `:4065-4078`, compute
  `:4079`); gather at `:4123`; `staged_rows = [r[1] for r in results if r[1] is not None]` at
  `:4125`; `upsert_many` at `:4130`. Empty proto path:
  `_symbol_readiness_from_json({}, symbol)` (`servicer.py:6582-6588`).
- Kick: `_kick_readiness_refresh` at `:4281`; per-symbol loop `for sym in syms:` at `:4332`;
  `staged_all.append(await compute_readiness_row(...))` at `:4348-4373`; `upsert_many(staged_all)`
  at `:4375`; outer catch and "readiness refresh kick failed" at `:4376-4377`.
- Materializer: `_materialize_readiness_for_owner` at `:6119`; per-symbol loop at `:6175`
  (skip-fresh `continue` first); `staged_rows.append(await compute_readiness_row(...))` at
  `:6199`; `upsert_many` at `:6223`; per-owner catch "readiness materializer failed for owner" at
  `:6263`.
- `_READINESS_UNKNOWN_RETRY_SECONDS` and its comment at `servicer.py:330-333`; the classifier reads
  `bar_epoch < 0` as UNKNOWN (`services/xstockstrat-analysis/docs/opportunities.md:36`).
- Readiness imports at `servicer.py:87-91`.

**Lands with**: `Step 10`

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. `readiness.py`: add `unavailable_readiness_row(symbol, *, rule, fingerprint, strategy_id,
   user_id, now, valid_until) -> dict`, returning the staged-row shape with `bar_epoch = -1` and
   `readiness_json = {}`. Build both this row and `compute_readiness_row`'s return through one
   private dict builder so the key set exists once. Rewrite the comment at `:92-94`: `-1` is the
   data-unavailable sentinel, written when the primary bars fetch raised or when a caller isolated
   a per-symbol failure.
2. `EvaluateReadiness`: gather `isolated(_readiness_for(s))`. For a symbol whose pair carries an
   exception, the result is `(_symbol_readiness_from_json({}, symbol), None, now)` — the triple
   shape `staged_rows` filters on, so the failing symbol is returned empty and not staged. Call
   `log_isolation_tally(log, "evaluate_readiness", failures, len(request.symbols))`. The RPC
   returns OK even when every symbol failed (the tally logs ERROR).
3. Kick: move the body of `for sym in syms:` (loaders plus `compute_readiness_row`) into a local
   coroutine and await it through `isolated`. On an exception append
   `unavailable_readiness_row(...)` with the same `rule="entry"`, `fingerprint`, `sid`, `user_id`,
   `now` and `valid_until` the healthy branch uses, and record `(sym, exc)`. After the loops call
   `log_isolation_tally(log, "readiness_kick", failures, len(triples))`. Keep the outer catch and
   the `finally`.
4. Materializer: the same shape for the per-symbol body after the skip-fresh check (`:6182-6222`),
   site `"readiness_materializer"`, total = the number of symbols computed in this pass.
5. Update the `servicer.py:330-332` comment so it names both producers of the sentinel.
6. No new outbound RPC is added, so header propagation is unchanged (kick and EvaluateReadiness
   forward `propagation_meta`; the materializer uses `owner_metadata(owner)`).

**Verification**:
Runs as one unit with Step 10; use Step 10's commands.

---

### Step 10 — test: readiness isolation regressions (`@AC-2`, `@AC-3` kick and materializer)

**Status**: `done`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/tests/test_per_symbol_isolation.py` — create
- `services/xstockstrat-analysis/tests/test_unreadable_formula.py` — modify
- `services/xstockstrat-analysis/tests/test_readiness.py` — modify

**Reviewers**: xstockstrat-analysis owner — backtest reproducibility, strategy scoring determinism, no look-ahead bias

**Codebase Evidence**:
- `tests/test_per_symbol_isolation.py`: **Not found** — created.
- Pinning test to rewrite: `test_evaluate_readiness_timeout_raises_not_converted_to_marker` at
  `tests/test_unreadable_formula.py:691-698` (`pytest.raises(FormulaExecutionError)` around
  `svc.EvaluateReadiness(_READINESS_REQ, ctx_with(_BOB))`).
- Harness to reuse (all importable, as `test_unreadable_formula.py:24-45` already does):
  `_cache_svc` (`tests/test_readiness_cache.py:27`), `_materializer_svc`, `_due_schedule`,
  `_upserted_rows` (`tests/test_readiness_materializer.py:49,28,96`), `_real_bars`
  (`tests/test_readiness_opportunities_source_symbol.py`), `ctx_with`, `aio_rpc_error`
  (`tests/conftest.py:137,145`), `_BOB` (`tests/test_owner_header_guard.py`), and from
  `tests/test_unreadable_formula.py`: `_definition` (`:54`), `_row` (`:85`), `_drain` (`:538`),
  `_META` (`:495`), `_READINESS_REQ` (`:498`), `_CLOSES` (`:499`).
- Site precedents: kick `test_kick_then_watchlist_readiness_resolves_marked_and_sibling`
  (`tests/test_unreadable_formula.py:740`, asserts `"readiness refresh kick failed" not in
  caplog.text` and reads `upsert_many.await_args.args[0]`); materializer
  `test_materializer_persists_marked_verdict_and_continues` (`:804`).
- Import graph: `test_unreadable_formula.py` imports from `test_analysis_servicer`,
  `test_opportunity_refresh`, `test_owner_header_guard`, `test_readiness_cache`,
  `test_readiness_materializer`, `test_readiness_opportunities_source_symbol`. None imports
  `test_per_symbol_isolation`, so the new module importing from them is cycle-free.

**Lands with**: `Step 9`

**TDD**: `red-green required`

**Covers**: `AC-2, AC-3`

**Instructions**:
1. `@AC-2`: patch `app.handlers.servicer.compute_readiness_row` with a wrapper that raises
   `ZeroDivisionError` for `"NVDA"` and delegates otherwise. Call `EvaluateReadiness` for `AAPL`,
   `MSFT`, `NVDA`. Assert the call returns; the three protos are in request order; `AAPL`/`MSFT`
   carry `total_conditions > 0`; `NVDA` is `(0, 0)`; `upsert_many` was awaited once and its rows
   are exactly `AAPL` and `MSFT` (a positive row check, not only "NVDA absent").
2. A loader variant: `_load_fundamentals_snapshot` raising for one symbol also degrades only that
   symbol (design R-1: the loaders raise before `compute_readiness_row`).
3. `@AC-3` kick: `ExecuteFormula` raises `aio_rpc_error(UNAVAILABLE)` for `NVDA` only. Drive
   `GetWatchlistReadiness` and `_drain` the kick. Assert the upserted batch holds every pair; the
   `NVDA` row has `bar_epoch == -1` and `readiness_json == {}`; the healthy rows have
   `bar_epoch >= 0`; `"readiness refresh kick failed"` is absent; a second read classifies `NVDA`
   as `READINESS_STATE_UNKNOWN`.
4. `@AC-3` materializer: the same outage through `_readiness_materializer_tick`; assert the `-1`
   row for the failing pair, the healthy rows, and no "readiness materializer failed for owner".
5. Timeout (feature-289 `@AC-13` CHANGE, signed off): rewrite the test at `:691` as
   `test_evaluate_readiness_timeout_degrades_the_symbol` — the RPC returns, the symbol is `(0, 0)`
   without `formula_unreadable`, nothing is staged for it.
6. Cancellation, one test per site (EvaluateReadiness, kick, materializer): the per-symbol
   coroutine raises `asyncio.CancelledError` and the site must propagate it. Credit each only
   after the `except BaseException` mutation in `isolation.py` shows it fail.
7. `tests/test_readiness.py`: a unit test for `unavailable_readiness_row` (key set equals a
   `compute_readiness_row` row's key set; `bar_epoch == -1`; `is_readiness_row_fresh` is False for
   it at `latest_bar_epoch=0`).
8. C-13: the symbols and bars come from the reused harness helpers; the new module declares no
   second copy of a domain literal.
9. RED (unit): write these tests first; on the pre-Step-9 tree `@AC-2` fails with the propagated
   `ZeroDivisionError` and `@AC-3` fails on the missing batch.

**Verification**:
```bash
cd services/xstockstrat-analysis
uv run pytest tests/test_per_symbol_isolation.py tests/test_unreadable_formula.py tests/test_readiness.py tests/test_readiness_cache.py tests/test_readiness_materializer.py tests/test_watchlist_readiness.py -q
uv run pytest --cov=app --cov-fail-under=40
ruff check . && ruff format --check .
grep -n "conftest\|^from tests\." tests/test_per_symbol_isolation.py   # C-13: helpers imported, not copied
```

---

### Step 11 — service: isolate `_row_for` and classify the fault on the row

**Status**: `done`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/app/handlers/servicer.py` — modify

**Reviewers**: xstockstrat-analysis owner — backtest reproducibility, strategy scoring determinism, no look-ahead bias

**Codebase Evidence**:
- `fetch_failed: set[str] = set()` at `servicer.py:5697`; bars-side adds at `:5723`, `:5732`,
  `:5765`; the eval-side add `fetch_failed.add(sym)` at `:5862` (the completion-order race).
- `_row_for` at `:5771`. Loaders start at `:5785` (`_load_benchmark_bars_windowed`,
  `_load_fundamentals`, `_formula_fundamentals`, `_load_fundamentals_snapshot`), `assess(...)` at
  `:5826-5836` with `bars_failed=(sym in fetch_failed or not bars)` at `:5835`, the traced eval at
  `:5842`, `except grpc.RpcError as e:` at `:5853`, and the comment "left to propagate" at
  `:5854-5858`.
- Marker block: `unreadable` handling at `:5888-5892`; `sym_unavailable` at `:5906-5911`;
  `zeroed = sym_unavailable or fund_skip or (unreadable and not c["is_held"])` at `:5914`.
- Gather at `:5945`; the comment "No return_exceptions" at `:5769-5770`.
- `_add_provenance` at `:5492`; evaluator imports at `:68-79`; repository import of
  `_PROVENANCE_STRUCTURAL_MARKERS` at `:51`.
- `replace_for_user` deletes rows that are not returned, so a held, watchlist or muted candidate
  must be degraded in place, never dropped (design R-4).

**Lands with**: `Step 12`

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. Import `_is_transient_formula_error` (evaluator), `EVALUATION_FAILED_PROVENANCE` (repository),
   `isolated` and `log_isolation_tally` (isolation).
2. In `_row_for`, replace the eval-only `try` with one `try` that spans the loaders, `assess` and
   the traced eval (`:5785-5873`, the `if definition is not None:` body). Its handler is
   `except Exception as e:` and sets two row-local flags: `eval_outage = True` when
   `_is_transient_formula_error(e)`, else `eval_failed = True`. In both cases
   `readiness = _empty_readiness(sym)` and `(sym, e)` is appended to a per-compute `failures`
   list. Remove `fetch_failed.add(sym)` at `:5862`: `fetch_failed` is bars-only again (design D-5).
3. Marker precedence (design D-5): `sym_unavailable` gains `or eval_outage` in its last conjunct.
   When `eval_failed and not sym_unavailable`, call
   `_add_provenance(c, EVALUATION_FAILED_PROVENANCE)` and, for a non-held row, set the action to
   `OPPORTUNITY_ACTION_TAG_UNSPECIFIED` — the same treatment the `unreadable` branch gives. Extend
   `zeroed` so a non-held `evaluation_failed` row is zeroed like a non-held unreadable row. A held
   row keeps its signal or fallback action.
4. Gather `isolated(_row_for(c))` over `selected`. A pair with an exception drops that candidate
   and appends `(c["symbol"], exc)` to `failures`; this is the count-and-log backstop only. After
   the gather call `log_isolation_tally(log, "opportunity_compute", failures, len(selected))`.
5. Rewrite the comments at `:5769-5770` and `:5854-5858` to state the new constraint in at most
   two lines each: a per-candidate failure degrades its own row; a timeout or RpcError is
   `unavailable`, anything else is `evaluation_failed`.
6. No new outbound RPC; header propagation unchanged.

**Verification**:
Runs as one unit with Step 12; use Step 12's commands.

---

### Step 12 — test: opportunities compute isolation regressions (`@AC-1`)

**Status**: `done`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/tests/test_per_symbol_isolation.py` — modify
- `services/xstockstrat-analysis/tests/test_unreadable_formula.py` — modify

**Reviewers**: xstockstrat-analysis owner — backtest reproducibility, strategy scoring determinism, no look-ahead bias

**Codebase Evidence**:
- Pinning test to rewrite: `test_opportunity_recompute_timeout_fails_and_keeps_stored_rows` at
  `tests/test_unreadable_formula.py:671-688` (asserts `"opportunity recompute failed" in
  caplog.text` and the stored rows unchanged).
- Harness: `_materialized_svc`, `_wl`, `_strat_row`, `_FIRING_BARS`, `_unavailable_served_row`
  (`tests/test_analysis_servicer.py`, imported at `tests/test_unreadable_formula.py:25-40`);
  `_mysz_svc`, `_find`, `_held_definition`, `_ok_formula`, `_META`
  (`tests/test_unreadable_formula.py:502-545`).
- Precedents to keep green: `test_opportunities_execute_outage_stays_data_unavailable_without_marker`
  (`:660`), `test_opportunities_sibling_outage_never_flips_marked_rows` (`:614`),
  `test_opportunities_marker_clears_once_formula_is_readable` (`:645`).
- Ledger trap `docs/roadmap/ledger/fails.md` (2026-11-02, fix-backtest-silent-symbol-skip): a broad
  catch can swallow a test double's own `TypeError`/`AttributeError` and pass for the wrong reason.

**Lands with**: `Step 11`

**TDD**: `red-green required`

**Covers**: `AC-1`

**Instructions**:
1. `@AC-1`: three watchlist candidates `AAPL`, `MSFT`, `NVDA`; `evaluate_conditions_traced` raises
   `FormulaExecutionError("f-1", "boom")` for `NVDA`. Assert `_compute_opportunities` returns;
   `AAPL` and `MSFT` rows carry `total_conditions > 0`; the `NVDA` row exists, carries
   `EVALUATION_FAILED_PROVENANCE`, has no `"unavailable"`, conviction `0.0` and action UNSPECIFIED.
   Run the same with `ZeroDivisionError`.
2. Classifier input (O-10): wrap `app.handlers.servicer._is_transient_formula_error` with a
   recording spy. For every regression in this step assert the spy received an instance of the
   intended exception type, and for the timeout case a `FormulaExecutionError` whose
   `exit_reason == SANDBOX_EXIT_REASON_TIMEOUT`. This is what stops a double's `AttributeError`
   passing as `evaluation_failed`.
3. Timeout (feature-289 `@AC-10` CHANGE, signed off): rewrite the test at `:671` as
   `test_opportunity_recompute_timeout_marks_the_row_unavailable` — the response double carries
   `exit_reason=TIMEOUT`, the recompute completes, the row carries `"unavailable"` and no
   `evaluation_failed`, `"opportunity recompute failed"` is absent.
4. Terminal reasons: parametrize RUNTIME_ERROR, IMPORT_BLOCKED, MEMORY_EXCEEDED and UNSPECIFIED
   response doubles; each yields `evaluation_failed`.
5. Held row: a held candidate whose eval raises keeps its row and its action, and carries the
   marker (design R-4).
6. Loader failure: `_load_fundamentals_snapshot` raising for one candidate degrades that row only.
7. Row-local outage (product-spec Open Question 3): two candidates on the same symbol under two
   strategies, one eval raising `aio_rpc_error(UNAVAILABLE)`; the sibling row is evaluated and has
   no `"unavailable"`, in both gather completion orders.
8. Precedence: bars failed plus a terminal eval fault → `"unavailable"` only.
9. Clears on recompute (extends feature-289 `@AC-26`): a second compute with a healthy formula
   yields the row without the marker.
10. Wire derivation: `ListOpportunities` for a marked row returns `data_unavailable` False and the
    token in `provenance` (design R-3).
11. Backstop: a `_row_for` failure after the inner `try` (patch `_composite_score` to raise for one
    symbol) drops only that candidate and emits the `opportunity_compute` tally at WARNING.
12. Cancellation: `evaluate_conditions_traced` raising `asyncio.CancelledError` propagates out of
    `_compute_opportunities`; credit after mutating the inline `except Exception` in `_row_for` to
    `except BaseException` shows the test fail.
13. C-13: reuses the harness helpers above; no second copy of a domain literal.

**Verification**:
```bash
cd services/xstockstrat-analysis
uv run pytest tests/test_per_symbol_isolation.py tests/test_unreadable_formula.py tests/test_analysis_servicer.py tests/test_opportunities_fundamentals_guard.py tests/test_opportunity_compute_state.py tests/test_opportunity_refresh.py -q
uv run pytest --cov=app --cov-fail-under=40
ruff check . && ruff format --check .
grep -n "fetch_failed.add" app/handlers/servicer.py   # expect only the bars and benchmark sites
```

---

### Step 13 — service: isolate the surgical retry (heal)

**Status**: `done`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/app/handlers/servicer.py` — modify

**Reviewers**: xstockstrat-analysis owner — backtest reproducibility, strategy scoring determinism, no look-ahead bias

**Codebase Evidence**:
- `_kick_opportunity_retry` at `servicer.py:4972` (outer catch "opportunity surgical retry failed"
  at `:4990-4992`); `_retry_unavailable_symbols` at `:4998`; docstring sentence "A
  ``FormulaExecutionError`` propagates" at `:5008-5009`.
- Target loop `for r in targets:` at `:5095`; `still_unavailable = True` at `:5101`;
  `if definition is not None:` at `:5106`; bars fetch `try` at `:5107-5111`; the `else:` branch
  with loaders, `assess` and the eval at `:5112-5201`; `except (grpc.RpcError) as e:  # transport
  outage only — FormulaExecutionError propagates` at `:5190-5192`.
- Row branches: still-unavailable `:5203-5223`; unreadable `:5225-5246`; healed `:5247-5261`.
- Readiness-cache subset at `:5262-5308` (`compute_readiness_row` at `:5285`, success-only gate
  `if staged.get("bar_epoch", -1) >= 0` at `:5307`); `replace_symbols` after the loop.
- No existing test pins propagation out of the heal: `grep -rn "_retry_unavailable_symbols"
  tests` shows no `pytest.raises` around any call.

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. Wrap the `else:` branch (`:5112-5201`, loaders, `assess`, eval) in one `try` whose handler is
   `except Exception as e:`. When `_is_transient_formula_error(e)` the row stays
   `still_unavailable` (log as today). Otherwise set a row-local `eval_failed = True` and
   `still_unavailable = False`. Append `(sym, e)` to a `failures` list in both cases. The inner
   `except grpc.RpcError` is absorbed by this handler.
2. Add an `if eval_failed:` branch before the `if unreadable:` branch that mirrors it with the new
   token: provenance drops `"unavailable"` and gains `EVALUATION_FAILED_PROVENANCE`; a held row
   omits `action`; a non-held row binds UNSPECIFIED with zeroed axes; `_healed` is True. Then
   `continue`, so no readiness-cache row is staged for it (the cache write stays success-only,
   feature-185 `@AC-9`). The row is terminal for the heal: it no longer carries `"unavailable"`,
   so the selector at `:5012-5016` does not pick it again.
3. Wrap the readiness-cache subset body (`:5269-5308`) in `try` / `except Exception as e:` that
   appends `(sym, e)` to `failures` and stages nothing.
4. After the loop call `log_isolation_tally(log, "opportunity_heal", failures, len(targets))`.
5. Rewrite the docstring sentence at `:5008-5009` and the comment at `:5192`: a timeout or
   RpcError keeps the row `unavailable`; any other failure rewrites it to `evaluation_failed`.
6. No new outbound RPC; header propagation unchanged.

**Verification**:
```bash
cd services/xstockstrat-analysis
uv run pytest tests/test_unreadable_formula.py tests/test_analysis_servicer.py tests/test_opportunities_fundamentals_guard.py tests/test_analysis_tick_telemetry.py -q
ruff check . && ruff format --check .
grep -n "FormulaExecutionError.. propagates\|FormulaExecutionError propagates\|left to propagate" app/handlers/servicer.py   # expect no output
```

---

### Step 14 — test: heal isolation regressions (`@AC-3` surgical retry)

**Status**: `done`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/tests/test_per_symbol_isolation.py` — modify

**Reviewers**: xstockstrat-analysis owner — backtest reproducibility, strategy scoring determinism, no look-ahead bias

**Codebase Evidence**:
- Heal precedents: `test_heal_refusal_rewrites_to_marker_and_is_not_reselected`
  (`tests/test_unreadable_formula.py:826`, spies `replace_symbols`, swaps in
  `_FakeReadinessCache`, re-runs the heal and asserts `spy.await_count == 1`) and
  `test_heal_recovery_restores_an_evaluated_row` (`:857`).
- Helpers: `_aged_row`, `_mysz_svc`, `_held_definition`, `_ok_formula`
  (`tests/test_unreadable_formula.py:502-545`), `_AGED` (`:497`); `_FakeReadinessCache`
  (`tests/test_analysis_servicer.py:4651`), `_unavailable_served_row` (`:4665`).

**TDD**: `red-green required`

**Covers**: `AC-3`

**Instructions**:
1. `@AC-3` heal: two aged `unavailable` rows, `AAPL` and `NVDA`; `ExecuteFormula` raises
   `aio_rpc_error(UNAVAILABLE)` for `NVDA` only. Assert `replace_symbols` was awaited once with
   both rows; `AAPL` is healed (no `"unavailable"`, `total_conditions > 0`); `NVDA` keeps
   `"unavailable"`; `_FakeReadinessCache.upserted` holds the `AAPL` row only; one
   `opportunity_heal` WARNING tally names `NVDA:` and the exception type.
2. Terminal fault: `evaluate_conditions_traced` raises `ZeroDivisionError` for `NVDA`. The heal
   does not raise; `AAPL` is healed; `NVDA` is rewritten to `EVALUATION_FAILED_PROVENANCE` without
   `"unavailable"`; nothing is staged for it; a second heal does not reselect it (extends
   feature-289 `@AC-9`). Parametrize held and non-held as the precedent at `:826` does.
3. Timeout: a `success=False`, `exit_reason=TIMEOUT` response keeps the row `"unavailable"`.
4. Cache-subset failure: `compute_readiness_row` raising in the subset leaves the opportunity row
   healed and stages nothing for that symbol.
5. Classifier input (O-10): the spy from Step 12 asserts the exception type and `exit_reason` the
   predicate received.
6. Cancellation: `asyncio.CancelledError` from the eval propagates out of
   `_retry_unavailable_symbols`; credit after the `except BaseException` mutation of the heal's
   handler shows the test fail.
7. RED: against the pre-Step-13 `servicer.py`, case 2 fails with the propagated
   `ZeroDivisionError`. C-13: reuses the helpers above.

**Verification**:
```bash
cd services/xstockstrat-analysis
uv run pytest tests/test_per_symbol_isolation.py tests/test_unreadable_formula.py -q
uv run pytest --cov=app --cov-fail-under=40
ruff check . && ruff format --check .
```

---

### Step 15 — service: `evaluation_failed` cue on the insights opportunities page

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/lib/readinessCue.ts` — modify
- `services/xstockstrat-ui/src/app/insights/opportunities/page.tsx` — modify

**Reviewers**: xstockstrat-ui owner — trading UI correctness, analytics display accuracy, config mutation safety, Connect-RPC call safety, environment scope correctness, no secret values rendered in UI, no direct DB access (except audit log)

**Codebase Evidence**:
- `src/lib/readinessCue.ts`: `READINESS_CUE` (lines 15-21) and
  `export const IN_QUEUE_CUE: EnumRender = { label: 'in queue', role: 'info', icon: Stack };`
  (last line); icons imported from `@phosphor-icons/react` at line 6.
- `src/app/insights/opportunities/page.tsx`: import at line 41
  (`import { IN_QUEUE_CUE, READINESS_CUE } from '@/lib/readinessCue';`); `held` at line 507 and
  `unreadable` at line 508; header chain at lines 513-526 (`unreadable && !held` arm at 518);
  readiness slot unreadable arm at lines 567-575 with
  `data-testid={`opportunity-formula-unreadable-${o.symbol}`}`; act gate at line 659
  (`fundUnavailable || (unreadable && !held) ? null : (`).
- 0/0 renders as `'nodata'`, not `'quiet'` (`src/lib/readinessRollup.ts`), so without an arm the
  row reads as "no data".

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. `readinessCue.ts`: export `EVALUATION_FAILED_PROVENANCE = 'evaluation_failed'` (the single TS
   copy of the wire token) and `EVALUATION_FAILED_CUE: EnumRender` with label
   `'evaluation failed'`, role `'secondary'` and a Phosphor warning glyph, beside `IN_QUEUE_CUE`.
   Design-role tokens only, no color literal (C-17).
2. `page.tsx`: derive `const evalFailed = o.provenance.includes(EVALUATION_FAILED_PROVENANCE);`
   beside `held` / `unreadable`. Then:
   - header: add an `evalFailed && !held` arm after the `unreadable && !held` arm rendering
     `<EnumBadge render={EVALUATION_FAILED_CUE} />`, and render the cue beside the action badge
     when `evalFailed && held`, as line 527 does for unreadable;
   - readiness slot: add an `evalFailed` arm after the `unreadable` arm, with `role="status"`,
     `data-testid={`opportunity-evaluation-failed-${o.symbol}`}` and
     `aria-label={`Evaluation failed for ${o.symbol}`}`;
   - act gate: `fundUnavailable || ((unreadable || evalFailed) && !held) ? null : (`.
3. Mobile `SignalRow`, the Signal-detail header and the `SignalReadiness` card are not changed here;
   Steps 17-22 do that (O-9 and the readiness-card ruling).

**Verification**:
```bash
cd services/xstockstrat-ui
pnpm run lint
pnpm exec tsc --noEmit
pnpm exec playwright test e2e/insights/opportunities.spec.ts
grep -rn "'evaluation_failed'" src | grep -v "src/lib/readinessCue.ts"   # expect no output
```

---

### Step 16 — test: Playwright assertion for a non-held `evaluation_failed` row

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/e2e/fixtures/opportunities.ts` — modify
- `services/xstockstrat-ui/e2e/fixtures/INVENTORY.md` — modify
- `services/xstockstrat-ui/e2e/insights/opportunities.spec.ts` — modify

**Reviewers**: xstockstrat-ui owner — trading UI correctness, analytics display accuracy, config mutation safety, Connect-RPC call safety, environment scope correctness, no secret values rendered in UI, no direct DB access (except audit log)

**Codebase Evidence**:
- Fixture precedent: `MYSZ_FORMULA_UNREADABLE_OPPORTUNITY` in `e2e/fixtures/opportunities.ts`
  (provenance `['watchlist', 'formula_unreadable']` at line 85); catalog row at
  `e2e/fixtures/INVENTORY.md:44`.
- Spec precedent: `test.describe('Opportunities — formula not readable (feature 289)')` at
  `e2e/insights/opportunities.spec.ts:737`, using `addAuthCookie(page)`, the
  `routeWithUnreadableRow(page, row)` `page.route` helper, and asserting
  `page.getByTestId('snooze-MYSZ')` has count 0.
- No `mock-backend.ts` edit. Its `MARKERS` (`e2e/mock-backend.ts:969`) only feeds the
  `availableSources` facet over `OPPORTUNITIES`, and its floor exemption only sees rows the mock
  serves; the evaluation-failed row is not in `OPPORTUNITIES` and every test (Steps 16, 18, 20, 22)
  serves it through `page.route`, so an edit there is unreachable. The ledger rule (`fails.md`
  2026-11-10: list every fake that mirrors a production filter) is met by this paragraph.
- Import loading: no e2e file imports `readinessCue` today (`grep -rn "src/lib" e2e` shows
  `alertShared`, `auth`, `configNamespaces`, `connectClients`, `copilot`, `deadlines`, `headers`,
  `indicatorChart`, `positionLineage`, `traderBff`). `mock-backend.ts` is loaded by
  `e2e/global-setup.ts:3` in the Playwright process, and `e2e/fixtures/index.ts:22` re-exports
  `./opportunities`, so a `readinessCue` import in that module reaches every consumer of
  `'../fixtures'` and, through `mock-backend.ts`, the global setup. `package.json` pins `@phosphor-icons/react`
  `^2.1.7`; the installed version was not re-checked at re-spec (no worktree `node_modules`). In
  plain Node an ESM `import` of that package loads the icons and a CJS `require` returns an empty
  object without throwing. Not run under Playwright's own transform; Instruction 1 checks it suite-wide.

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. C-12: add `MYSZ_EVALUATION_FAILED_OPPORTUNITY` to `e2e/fixtures/opportunities.ts` as
   `{ ...MYSZ_FORMULA_UNREADABLE_OPPORTUNITY, formulaUnreadable: false, provenance: ['watchlist',
   EVALUATION_FAILED_PROVENANCE] }`. Import the constant with a relative path, as
   `e2e/fixtures/alerts.ts:1` does (`'../../src/lib/deadlines'`). `readinessCue.ts` value-imports
   the icon library, so check the import first: after adding it, run
   `pnpm exec playwright test --list` (the whole suite, not one spec: the fixture index fans the
   import out to every spec) and `pnpm exec playwright test e2e/insights/opportunities.spec.ts`
   (which also loads the global setup). If both succeed, keep the import. If either fails on that
   import, fall back: declare the token once in the fixture module instead. That is a second TS copy of the wire token, so record it in the Deviation Log and the
   catalog row and report it at the checkpoint (P-03); do not take it silently. Add the fixture's
   row to `INVENTORY.md` after line 44; state that it is not in `OPPORTUNITIES`.
2. `opportunities.spec.ts`: add `MYSZ_EVALUATION_FAILED_OPPORTUNITY` to the import list at lines 3-8.
   Add one test in a new `describe`, served through the existing `page.route` helper. Assert `opportunity-evaluation-failed-MYSZ` is visible with text `evaluation failed`;
   `snooze-MYSZ` has count 0; `opportunity-unavailable-MYSZ` and
   `opportunity-formula-unreadable-MYSZ` have count 0.
3. RED: with `page.tsx` checked out at the pre-Step-15 commit the test id is absent.

**Verification**:
```bash
cd services/xstockstrat-ui
pnpm run lint
pnpm exec tsc --noEmit
pnpm exec playwright test --list
pnpm exec playwright test e2e/insights/opportunities.spec.ts
pnpm run test:coverage   # the UI logic-layer gate (vitest); Playwright steps carry no threshold
grep -n "from '../fixtures'\|from './fixtures'\|helpers/auth" e2e/insights/opportunities.spec.ts
grep -n "MYSZ_EVALUATION_FAILED_OPPORTUNITY" e2e/fixtures/INVENTORY.md
```

---

### Step 17 — service: `evaluation_failed` cue on the mobile `SignalRow`

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/components/mobile/sections.ts` — modify
- `services/xstockstrat-ui/src/components/mobile/SectionRenderer.tsx` — modify
- `services/xstockstrat-ui/src/app/insights/opportunities/page.tsx` — modify

**Reviewers**: xstockstrat-ui owner — trading UI correctness, analytics display accuracy, config mutation safety, Connect-RPC call safety, environment scope correctness, no secret values rendered in UI, no direct DB access (except audit log)

**Codebase Evidence**:
- `src/components/mobile/sections.ts`: `export interface SignalItem` (line 13) carries
  `formulaUnreadable: boolean;` (line 24) with the comment "required (unlike its optional siblings)
  so tsc flags every construction site"; `dataUnavailable?: boolean;` at line 22.
- `src/components/mobile/SectionRenderer.tsx`: `import { READINESS_CUE } from '@/lib/readinessCue';`
  (line 7); `function SignalRow` (line 155); the readiness slot arms are `s.dataUnavailable` (line 237),
  `s.formulaUnreadable` (lines 248-257: a `role="status"` span with
  `data-testid={`opportunity-formula-unreadable-mobile-${s.symbol}`}`, an `aria-label`, and
  `<EnumBadge render={READINESS_CUE.unreadable} />`), then `hasReadiness` and the `—` fallback.
- The one `SignalItem` construction site: `grep -rn "kind: 'signal" src e2e` hits only
  `src/app/insights/opportunities/page.tsx:193-194` (`mobileSections`, `signalGroup`), whose
  `signals: g.opps.map((o) => ({...}))` sets `formulaUnreadable: o.formulaUnreadable,` at line 204.
- Verified at re-spec: adding `evaluationFailed: boolean;` to `SignalItem` alone makes `pnpm exec tsc
  --noEmit` (its `tsconfig.json` `include` covers `**/*.ts`, so `e2e/` compiles too) report exactly one
  new error, at `src/app/insights/opportunities/page.tsx:193`. No test or fixture builds a `SignalItem`,
  so no §C unit applies. Two other errors (`BackfillSymbolOutcome.INCOMPLETE`) pre-exist from stale
  generated stubs in that checkout and are unrelated.
- Mobile has no act controls and, for feature 289, only the readiness slot carries the unreadable cue
  (the header keeps `s.badge`); design.md O-9 names the `SignalItem`-field route.

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. `sections.ts`: add `evaluationFailed: boolean;` after `formulaUnreadable: boolean;`, required for the
   same reason as its sibling (a comment of at most 2 lines saying so, no history).
2. `page.tsx`: in the `mobileSections` map add
   `evaluationFailed: o.provenance.includes(EVALUATION_FAILED_PROVENANCE),` after line 204. The
   constant comes from the `@/lib/readinessCue` import at line 41; Step 15 needs the same name there
   for `evalFailed`, so add it once (no second import line) and write no literal `'evaluation_failed'`.
3. `SectionRenderer.tsx`: import `EVALUATION_FAILED_CUE` beside `READINESS_CUE` (line 7). Add an arm
   after the `s.formulaUnreadable` arm and before `hasReadiness`: a `role="status"` span with
   `className="flex flex-1 items-center"`, `data-testid={`opportunity-evaluation-failed-mobile-${s.symbol}`}`,
   `aria-label={`Evaluation failed for ${s.symbol}`}`, wrapping
   `<EnumBadge render={EVALUATION_FAILED_CUE} />`. Design-role tokens only (C-17).
4. The mobile header (`s.badge`, `s.muted`, `s.fundamentalsUnavailable` chain) is unchanged, as for
   feature 289: mobile has no act controls and no held/non-held split.

**Verification**:
```bash
cd services/xstockstrat-ui
pnpm run lint
pnpm exec tsc --noEmit
pnpm exec playwright test e2e/insights/opportunities.spec.ts e2e/mobile.spec.ts
grep -n "evaluationFailed" src/components/mobile/sections.ts src/components/mobile/SectionRenderer.tsx src/app/insights/opportunities/page.tsx
grep -rn "'evaluation_failed'" src | grep -v "src/lib/readinessCue.ts"   # expect no output
```

---

### Step 18 — test: Playwright assertion for the mobile `evaluation_failed` row

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/e2e/insights/opportunities.spec.ts` — modify
- `services/xstockstrat-ui/e2e/fixtures/INVENTORY.md` — modify

**Reviewers**: xstockstrat-ui owner — trading UI correctness, analytics display accuracy, config mutation safety, Connect-RPC call safety, environment scope correctness, no secret values rendered in UI, no direct DB access (except audit log)

**Codebase Evidence**:
- Mobile precedent: `test.describe('Opportunities — formula not readable, mobile (feature 289)')` at
  `e2e/insights/opportunities.spec.ts:786`, with `test.use({ viewport: { width: 375, height: 800 } })`,
  `addAuthCookie(page)` and `routeWithUnreadableRow(page, row)`; it asserts
  `opportunity-formula-unreadable-mobile-MYSZ` and count 0 for `opportunity-unavailable-mobile-MYSZ`.
- `routeWithUnreadableRow` takes `row: typeof MYSZ_FORMULA_UNREADABLE_OPPORTUNITY` (lines 716-719) and
  converts `validUntil` to an ISO string. Step 16's `MYSZ_EVALUATION_FAILED_OPPORTUNITY` is a spread
  of that fixture, so it satisfies the parameter type (`tsc` checks it).
- Fixture and catalog row come from Step 16 (`e2e/fixtures/opportunities.ts`,
  `e2e/fixtures/INVENTORY.md`). C-12: no new domain object, so no new fixture; the helper and the
  fixture are reused.

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
0. `opportunities.spec.ts`: confirm `MYSZ_EVALUATION_FAILED_OPPORTUNITY` is in the import list at lines
   3-8 (Step 16 adds it); add it if absent.
1. `opportunities.spec.ts`: add `test.describe('Opportunities — evaluation failed, mobile (feature 308)')`
   after Step 16's describe, with the same 375x800 viewport. One test: `addAuthCookie(page)`,
   `routeWithUnreadableRow(page, MYSZ_EVALUATION_FAILED_OPPORTUNITY)`, `page.goto('/insights/opportunities')`,
   then assert `opportunity-evaluation-failed-mobile-MYSZ` is visible (timeout 15000) with text
   `evaluation failed` and `aria-label` `Evaluation failed for MYSZ`, and that
   `opportunity-formula-unreadable-mobile-MYSZ` and `opportunity-unavailable-mobile-MYSZ` have count 0.
2. `INVENTORY.md`: append this spec (mobile cue) to the consumer column of the Step 16 row.
3. RED: with `SectionRenderer.tsx`, `sections.ts` and `page.tsx` checked out at the pre-Step-17
   commit, the test id is absent.

**Verification**:
```bash
cd services/xstockstrat-ui
pnpm run lint
pnpm exec tsc --noEmit
pnpm exec playwright test e2e/insights/opportunities.spec.ts
pnpm run test:coverage   # the UI logic-layer gate (vitest); Playwright steps carry no threshold
grep -n "from '../fixtures'\|from './fixtures'\|helpers/auth" e2e/insights/opportunities.spec.ts
grep -n "MYSZ_EVALUATION_FAILED_OPPORTUNITY" e2e/fixtures/INVENTORY.md e2e/insights/opportunities.spec.ts
```

---

### Step 19 — service: `evaluation_failed` cue on the Signal-detail header

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/app/trader/positions/[symbol]/page.tsx` — modify

**Reviewers**: xstockstrat-ui owner — trading UI correctness, analytics display accuracy, config mutation safety, Connect-RPC call safety, environment scope correctness, no secret values rendered in UI, no direct DB access (except audit log)

**Codebase Evidence**:
- `src/app/trader/positions/[symbol]/page.tsx`: `import { READINESS_CUE } from '@/lib/readinessCue';`
  (line 27); `symbolOpportunities.map` builds the panels with
  `node: <OpportunitySection opportunity={o} symbol={symbol} />` (lines 470-473);
  `function OpportunitySection` (line 1009).
- Its header chain (lines 1038-1052): `opportunity.fundamentalsUnavailable` → `EnumBadge` with
  `testId="detail-fundamentals-unavailable"`; then
  `opportunity.formulaUnreadable && !opportunity.provenance.includes('position')` → `EnumBadge
  render={READINESS_CUE.unreadable} testId="detail-formula-unreadable"`; else the action badge plus,
  when `opportunity.formulaUnreadable`, the same cue beside it. design.md cited lines 1014-1020 for
  this block; it has since moved.
- The detail page has no act controls on this card, so only the header cue applies.

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. Extend the line-27 import with `EVALUATION_FAILED_CUE` and `EVALUATION_FAILED_PROVENANCE` (both exported by Step 15).
2. In `OpportunitySection`, after the `if (!opportunity)` guard, derive
   `const evalFailed = opportunity.provenance.includes(EVALUATION_FAILED_PROVENANCE);`.
3. Header chain: add an arm after the `formulaUnreadable && !held` arm,
   `evalFailed && !opportunity.provenance.includes('position')`, rendering
   `<EnumBadge render={EVALUATION_FAILED_CUE} testId="detail-evaluation-failed" />`. In the final
   branch, beside the action badge, render the same badge when `evalFailed` (the held case), as the
   `formulaUnreadable` line does. No literal `'evaluation_failed'`, no color literal (C-17).
4. Not changed here: the `SignalReadiness` "Why this fired" card; Step 21 adds its arm.

**Verification**:
```bash
cd services/xstockstrat-ui
pnpm run lint
pnpm exec tsc --noEmit
pnpm exec playwright test e2e/trader/position-detail.spec.ts
grep -n "detail-evaluation-failed\|EVALUATION_FAILED_CUE" "src/app/trader/positions/[symbol]/page.tsx"
grep -rn "'evaluation_failed'" src | grep -v "src/lib/readinessCue.ts"   # expect no output
```

---

### Step 20 — test: Playwright assertion for the Signal-detail `evaluation_failed` header

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/e2e/trader/position-detail.spec.ts` — modify
- `services/xstockstrat-ui/e2e/fixtures/INVENTORY.md` — modify

**Reviewers**: xstockstrat-ui owner — trading UI correctness, analytics display accuracy, config mutation safety, Connect-RPC call safety, environment scope correctness, no secret values rendered in UI, no direct DB access (except audit log)

**Codebase Evidence**:
- Edit by symbol; the line numbers below are from one checkout and can drift (about 19 lines in
  another).
- Precedent: `test.describe('Signal-detail formula not readable (feature 289)')` at
  `e2e/trader/position-detail.spec.ts:1178`: `addAuthCookie(page)`, `watchlist(page, 'MYSZ',
  'strat-live-001')` (helper at line 1248), a `page.waitForRequest` on the symbol-filtered
  `AnalysisService/ListOpportunities`, `page.goto('/trader/positions/MYSZ?strategy=strat-live-001')`,
  then `detail-formula-unreadable` visible.
- `const fulfillJson = (route: Route, body: unknown) => ...` (line 13) and `route.fallback()` for
  non-matching requests (line 1219, inside `routeIndicatorHistory`) are the in-file stub idioms. The spec imports from `'../fixtures'`
  (line 4), whose `index.ts:22` re-exports `./opportunities`.
- `e2e/mock-backend.ts` serves only the unreadable row for `symbol: 'MYSZ'`
  (`listOpportunities`, lines 979-985), so this test serves the evaluation-failed row through
  `page.route` and leaves the mock unchanged. Connect-JSON needs `validUntil` as an ISO string
  (`e2e/insights/opportunities.spec.ts:22-26`).

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. C-12: reuse `MYSZ_EVALUATION_FAILED_OPPORTUNITY` (Step 16); add it to the existing `'../fixtures'`
   import. No new fixture.
2. Add `test.describe('Signal-detail evaluation failed (feature 308)')` after the feature-289 describe,
   with an in-file helper `routeEvaluationFailedRow(page)` (Step 22 reuses it). The helper calls
   `page.route('**/xstockstrat.analysis.v1.AnalysisService/ListOpportunities', ...)`, which returns
   `route.fallback()` unless `(route.request().postDataJSON() as { symbol?: string } | null)?.symbol === 'MYSZ'`
   (null-guarded: a body-less request must fall through) and otherwise
   `fulfillJson(route, { opportunities: [{ ...MYSZ_EVALUATION_FAILED_OPPORTUNITY, validUntil: <ISO
   string of its validUntil.seconds> }], availableSources: [] })`. One test: `addAuthCookie(page)`,
   `watchlist(page, 'MYSZ', 'strat-live-001')`, `routeEvaluationFailedRow(page)`, `goto` the MYSZ
   detail URL, then assert `detail-evaluation-failed` is visible (timeout 30000) with text `evaluation failed`, and
   `detail-formula-unreadable` has count 0.
3. `INVENTORY.md`: append this spec (Signal-detail header cue) to the consumer column of the Step 16 row.
4. RED: with `trader/positions/[symbol]/page.tsx` checked out at the pre-Step-19 commit, the test id
   is absent.

**Verification**:
```bash
cd services/xstockstrat-ui
pnpm run lint
pnpm exec tsc --noEmit
pnpm exec playwright test e2e/trader/position-detail.spec.ts
pnpm run test:coverage   # the UI logic-layer gate (vitest); Playwright steps carry no threshold
grep -n "from '../fixtures'\|from './fixtures'\|helpers/auth" e2e/trader/position-detail.spec.ts
grep -n "MYSZ_EVALUATION_FAILED_OPPORTUNITY" e2e/fixtures/INVENTORY.md e2e/trader/position-detail.spec.ts
```

---

### Step 21 — service: `evaluation_failed` arm in the Signal-detail "Why this fired" card

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/components/insights/SignalReadiness.tsx` — modify

**Reviewers**: xstockstrat-ui owner — trading UI correctness, analytics display accuracy, config mutation safety, Connect-RPC call safety, environment scope correctness, no secret values rendered in UI, no direct DB access (except audit log)

**Codebase Evidence**:
- `src/components/insights/SignalReadiness.tsx`: `import { READINESS_CUE } from '@/lib/readinessCue';`
  (line 13); `pairRow` is the symbol-filtered `useOpportunities` row for `(symbol, strategyId)`, and
  `const isHeld = pairRow?.provenance.includes('position') ?? false;` (line 47) reads its provenance;
  `const readiness = data?.readiness?.[0];` (line 56).
- The body chain (lines 80-103 on this checkout): `!strategyId` → `isLoading` → `isNotFound` →
  `error` ("Failed to evaluate readiness.") → `readiness?.formulaUnreadable` (a plain `<div
  data-testid="readiness-formula-unreadable">` around a `CardNotice`) → `!readiness ||
  readiness.conditions.length === 0` ("This strategy has no {ruleWord} conditions to evaluate.").
  `CardNotice` (`src/components/shared/CardNotice.tsx`) takes `children` and `variant` only.
- Why the arm is needed: `EvaluateReadiness` now returns the failing symbol as an empty 0-of-0
  `SymbolReadiness` without the unreadable marker (Step 9; wording in Step 23 Instruction 2), where it
  used to raise and show the error line. Without an arm the card reads "no conditions" under a header
  that says "evaluation failed" (Step 19).
- Why the arm also requires an empty row (operator ruling 2026-11-27): the stored provenance marker
  clears only on the next recompute, so a live `EvaluateReadiness` can return real conditions while
  the row still says `evaluation_failed`; a provenance-only arm would hide them. The existing
  `!readiness || readiness.conditions.length === 0` expression already defines "empty" in this chain.
- No component-level unit harness exists for this card (vitest is node-env over `src/lib/**`), and
  extracting the condition into a `src/lib` helper would be speculative, so the guard is Step 22's
  negative e2e case plus its mutation run.

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. Add `EVALUATION_FAILED_PROVENANCE` to the line-13 `readinessCue` import (exported by Step 15).
2. After `readiness` (line 56) derive
   `const noConditions = !readiness || readiness.conditions.length === 0;` and, after `isHeld`,
   `const evalFailed = pairRow?.provenance.includes(EVALUATION_FAILED_PROVENANCE) ?? false;`.
   Replace the existing chain test `!readiness || readiness.conditions.length === 0` with
   `noConditions` so the emptiness rule lives in one place.
3. Add an arm after the `readiness?.formulaUnreadable` arm and before the `noConditions` arm, taken
   only when `evalFailed && noConditions`:
   `<div role="status" data-testid="readiness-evaluation-failed"><CardNotice>Evaluation failed for
   {symbol}.</CardNotice></div>`. The `error` arm still wins (a failed RPC keeps its own message). No
   color literal; `CardNotice` already carries the design tokens (C-17).
4. When the row carries `evaluation_failed` but `EvaluateReadiness` returns conditions, no arm is
   taken and the conditions render exactly as today (operator ruling 2026-11-27).

**Verification**:
```bash
cd services/xstockstrat-ui
pnpm run lint
pnpm exec tsc --noEmit
pnpm exec playwright test e2e/trader/position-detail.spec.ts
grep -n "readiness-evaluation-failed\|EVALUATION_FAILED_PROVENANCE\|noConditions" src/components/insights/SignalReadiness.tsx
grep -c "readiness.conditions.length === 0" src/components/insights/SignalReadiness.tsx   # expect 1 (the noConditions definition)
grep -rn "'evaluation_failed'" src | grep -v "src/lib/readinessCue.ts"   # expect no output
```

---

### Step 22 — test: Playwright assertion for the `evaluation_failed` readiness-card arm

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/e2e/trader/position-detail.spec.ts` — modify
- `services/xstockstrat-ui/e2e/fixtures/INVENTORY.md` — modify

**Reviewers**: xstockstrat-ui owner — trading UI correctness, analytics display accuracy, config mutation safety, Connect-RPC call safety, environment scope correctness, no secret values rendered in UI, no direct DB access (except audit log)

**Codebase Evidence**:
- Edit by symbol; line numbers can drift between checkouts.
- Per-page `EvaluateReadiness` override precedent: the AC-13 test in
  `e2e/trader/position-detail.spec.ts` (`'the "Why this fired" panel shows the firing cue (AC-13)'`)
  calls `page.route('**/xstockstrat.analysis.v1.AnalysisService/EvaluateReadiness', ...)` with a
  `readiness: [...]` JSON body.
- The shared mock cannot serve this case: `READINESS_BUCKET_OVERRIDE` forces `MYSZ` to
  `formulaUnreadable: true` (`e2e/fixtures/opportunities.ts`, spread at
  `e2e/mock-backend.ts` `evaluateReadiness`), which would take the unreadable arm. So the test
  overrides `EvaluateReadiness` with `page.route`, as the AC-13 test does.
- `symbolReadiness(symbol)` (single-arg factory, `e2e/fixtures/opportunities.ts`) is the C-12 home
  for a `SymbolReadiness`; a `{ ...symbolReadiness('MYSZ'), conditions: [], ... }` spread is a scenario
  override, not a new domain literal.

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. C-12: reuse `symbolReadiness` (add it to the existing `'../fixtures'` import) and Step 20's
   `routeEvaluationFailedRow(page)` helper. No new fixture.
2. In the Step 20 describe add one test: `addAuthCookie(page)`, `watchlist(page, 'MYSZ',
   'strat-live-001')`, `routeEvaluationFailedRow(page)`, then
   `page.route('**/xstockstrat.analysis.v1.AnalysisService/EvaluateReadiness', (route) =>
   fulfillJson(route, { readiness: [{ ...symbolReadiness('MYSZ'), conviction: 0, passingConditions: 0,
   totalConditions: 0, conditions: [] }] }))`, `goto('/trader/positions/MYSZ?strategy=strat-live-001')`.
   Assert `readiness-evaluation-failed` is visible (timeout 30000) with text `Evaluation failed for
   MYSZ`, `readiness-formula-unreadable` has count 0, and `getByText('conditions to evaluate')` has
   count 0.
3. Negative case (operator ruling 2026-11-27), a second test in the same describe: the same setup
   (`watchlist`, `routeEvaluationFailedRow`), but `EvaluateReadiness` is overridden with
   `fulfillJson(route, { readiness: [symbolReadiness('MYSZ')] })` (the factory's own 2/3 conditions, no
   override). Assert `getByText('2/3 conditions')` is visible within `signal-readiness` (timeout 30000),
   `readiness-evaluation-failed` has count 0, and `readiness-formula-unreadable` has count 0.
4. `INVENTORY.md`: append both tests to the consumer column of the Step 16 row.
5. RED: with `SignalReadiness.tsx` checked out at the pre-Step-21 commit, the positive test fails
   (test id absent); the negative test passes there and is not red. Its value is the mutation run:
   after Step 21, temporarily change the arm to `evalFailed` alone (drop `&& noConditions`), run the
   spec, and confirm the negative test fails; then restore. Record the failing output in the step's
   session notes.

**Verification**:
```bash
cd services/xstockstrat-ui
pnpm run lint
pnpm exec tsc --noEmit
pnpm exec playwright test e2e/trader/position-detail.spec.ts
pnpm run test:coverage   # the UI logic-layer gate (vitest); Playwright steps carry no threshold
grep -n "from '../fixtures'\|from './fixtures'\|helpers/auth" e2e/trader/position-detail.spec.ts
grep -n "readiness-evaluation-failed\|2/3 conditions" e2e/trader/position-detail.spec.ts
grep -n "readiness-evaluation-failed" e2e/fixtures/INVENTORY.md
```

---

### Step 23 — docs: amended durable scenarios, contract sentences, sentinel text, follow-ups

**Status**: `pending`
**Service**: `services/xstockstrat-analysis/acceptance/`, `services/xstockstrat-analysis/docs/`, `docs/runbooks/`, `services/xstockstrat-ui/docs/`
**Files**:
- `services/xstockstrat-analysis/acceptance/opportunity-compute-robustness.feature` — modify
- `services/xstockstrat-analysis/acceptance/readiness-caching-poll-discipline.feature` — modify
- `services/xstockstrat-analysis/docs/opportunities.md` — modify
- `services/xstockstrat-analysis/docs/context-constitution-findings.md` — modify
- `docs/runbooks/mcp-tools.md` — modify
- `services/xstockstrat-ui/docs/opportunities-shell.md` — modify

**Reviewers**: none

**Codebase Evidence**:
- Feature-289 `@AC-10` at `acceptance/opportunity-compute-robustness.feature:108-112`
  ("A formula execution timeout still fails the opportunities recompute").
- Feature-289 `@AC-13` at `acceptance/readiness-caching-poll-discipline.feature:94-98`
  ("A formula execution timeout still aborts EvaluateReadiness").
- `docs/opportunities.md:7` holds "(a `FormulaExecutionError` still propagates)" and the list of
  floor-exempt markers; `:36` holds the scope note "the `bar_epoch = -1` data-unavailable sentinel
  is written by the **shared** `compute_readiness_row`". The service `CLAUDE.md` no longer carries
  either sentence (`grep -n "still propagates" services/xstockstrat-analysis/CLAUDE.md` is empty on
  main-dev; the text moved to `docs/opportunities.md`).
- `services/xstockstrat-ui/docs/opportunities-shell.md` (C-10): its "Formula-unreadable row (289)" bullet
  lists the per-surface test ids and says `readinessState` and `SignalItem` take a **required**
  `formulaUnreadable`. Edit by symbol, after that bullet.
- `docs/runbooks/mcp-tools.md:1225-1230` documents `formula_unreadable` and its provenance marker
  for `list_opportunities`.
- `services/xstockstrat-analysis/docs/context-constitution-findings.md` — the service findings log;
  `## Latent bugs (looks broken, not merely non-obvious)` at line 17.
- C-16 sign-off: context.md `## Session 2026-11-20 — sdd-design`, Operator decisions. Confirmed on
  the feature branch at `/sdd-review impl-spec` (the line starting "Operator (2026-11-20, design
  gate, option A): C-16 sign-off to CHANGE feature-289 @AC-10").

**TDD**: `N/A (docs)`

**Covers**: —

**Instructions**:
1. `@AC-10` (CHANGE, signed off): retitle to "A formula execution timeout degrades only its
   candidate"; the `Then` becomes: the recompute completes, the timed-out candidate's row has
   `data_unavailable` true (provenance `unavailable`), and the other candidates are materialized.
   Keep the `@AC-10` id and tags; add `@feature-308`.
2. `@AC-13` (CHANGE, signed off): retitle to "A formula execution timeout degrades only its symbol
   in EvaluateReadiness"; the `Then` becomes: the RPC returns OK, the timed-out symbol is an empty
   0-of-0 `SymbolReadiness` without the unreadable-formula marker, and no readiness-cache row is
   staged for it. Keep the id and tags; add `@feature-308`.
3. `docs/opportunities.md:7`: replace the parenthetical with the new rule (a timeout or RpcError
   marks the candidate `unavailable`; any other per-candidate failure marks it
   `evaluation_failed`, a structural, floor-exempt marker that clears on the next recompute and is
   exposed through `provenance` only) and add the new floor clause to the marker list.
   `:36`: the sentinel is also written by the kick and the materializer when they isolate a
   per-symbol failure; `EvaluateReadiness` returns the failing symbol empty and stages nothing.
4. `mcp-tools.md`: one sentence after line 1230 — an `"evaluation_failed"` provenance marker means
   the strategy's evaluation failed for that symbol; `data_unavailable` stays false.
5. Findings log: one row recording that no alert covers a sustained per-symbol degraded rate
   (`recompute{outcome=failed}`, `EvaluateReadiness` UNKNOWN and the kick/materializer WARNs were
   not alerted before either); the signal is the isolation tally log line and the
   `<site>.degraded_count` span attribute; follow-up feature `analysis-isolation-degraded-counter`.
6. Findings log, `## Latent bugs`: one row recording that the per-strategy setup in the readiness
   kick (`_kick_readiness_refresh`: `get_by_owner_and_id`, `_load_benchmark_bars_windowed`,
   `_formula_fundamentals`) and in `_materialize_readiness_for_owner` is not isolated, so a failure
   there still discards the whole kick or owner pass (feature 308 isolates the per-symbol body
   only). Re-grep the symbols and cite them by `#symbol`, as the file's other rows do.

7. `opportunities-shell.md`: add a bullet after the "Formula-unreadable row (289)" bullet for the
   evaluation-failed row (feature 308): `evaluation_failed` provenance (a structural, floor-exempt
   marker, not a proto field) renders `EVALUATION_FAILED_CUE` ("evaluation failed") instead of a 0/0 or
   "no data" verdict; a non-held row shows it in place of the action badge with no act buttons. List the
   test ids `opportunity-evaluation-failed-<sym>` (desktop queue), `opportunity-evaluation-failed-mobile-<sym>`
   (mobile queue), `detail-evaluation-failed` (Signal-detail header) and `readiness-evaluation-failed`
   (the `SignalReadiness` notice, keyed off the opportunity row's provenance, not the `EvaluateReadiness`
   result). State that `SignalItem` now has a second required field, `evaluationFailed`, beside
   `formulaUnreadable`, so `tsc` flags every construction site.

**Verification**:
```bash
grep -n "evaluation-failed\|evaluationFailed" services/xstockstrat-ui/docs/opportunities-shell.md
grep -n "still fails the opportunities recompute\|still aborts EvaluateReadiness" services/xstockstrat-analysis/acceptance/*.feature   # expect no output
grep -n "@feature-308" services/xstockstrat-analysis/acceptance/opportunity-compute-robustness.feature services/xstockstrat-analysis/acceptance/readiness-caching-poll-discipline.feature
grep -n "FormulaExecutionError. still propagates" services/xstockstrat-analysis/docs/opportunities.md   # expect no output
grep -n "evaluation_failed" services/xstockstrat-analysis/docs/opportunities.md docs/runbooks/mcp-tools.md
grep -n "analysis-isolation-degraded-counter" services/xstockstrat-analysis/docs/context-constitution-findings.md
grep -n "_kick_readiness_refresh" services/xstockstrat-analysis/docs/context-constitution-findings.md   # the per-strategy setup row
```

---

## Deviation Log

_Populated by /sdd-execute as implementation proceeds._

### Steps 1+2: the multi-line double grep returns hits (2026-11-21)

- **Expected**: Step 2 Verification line 2 (`grep -rn -A4 "SimpleNamespace($" tests | grep "success="`)
  prints nothing.
- **Actual**: it prints six lines (`test_fundsignal_loop.py:689`, `test_owner_header_guard.py:230`,
  `test_fundamentals_formula_operand.py:142`, `test_unreadable_formula.py:289,682,704`). Adding
  `exit_reason` pushed these single-line doubles past the line length, so `ruff format` wrapped them.
  Each hit carries `exit_reason`.
- **Disposition**: checked by hand, as the comment on that Verification line prescribes. Lines 1 and 3
  (the single-line grep and the `ExecuteFormulaResponse(` grep) print nothing. No code change.

### Step 3: RED captured with a temporary probe test (2026-11-21)

- **Expected**: Step Dependencies has Step 4's new assertion capture RED for Step 3, run against the
  pre-Step-3 `servicer.py`.
- **Actual**: Step 3 was executed on its own, and its Verification (`tests/test_sandbox_deadline.py`)
  does not assert `exit_reason` yet. To get a recorded red→green within Step 3, a temporary untracked
  `tests/test_tmp_step3_probe.py` held Step 4's assertion. It reused the module's `_req`/`_ctx`/
  `_watcher`/`_recording_sandbox` helpers. RED gave `assert 0 == 2` and GREEN gave `1 passed`. The
  probe was deleted before the commit.
- **Disposition**: no file outside Step 3's **Files** is committed. Step 4 still adds the permanent
  assertion and re-captures its own RED as specced.

### Step 5: RED captured with a temporary probe test; unused `trace` import removed (2026-11-21)

- **Expected**: Step Dependencies has Step 6's new tests capture RED for Step 5. Instruction 2 replaces
  the screener tally block and names no import change.
- **Actual**: Step 5 was executed on its own, and its Verification (`tests/test_screener.py`) is a
  characterization guard that is green before and after. A temporary untracked
  `tests/test_tmp_step5_probe.py` asserted `isolated` (value, exception, `CancelledError` pass-through)
  and `log_isolation_tally` (no record on empty, WARNING and message for 1 of 3). RED gave
  `ModuleNotFoundError: No module named 'app.services.isolation'` and GREEN gave `2 passed`. The probe
  was deleted before the commit. Replacing the tally block left `from opentelemetry import trace`
  unused in `screener.py` (ruff F401), so it was removed; `isolation.py` imports `trace` itself.
- **Disposition**: no file outside Step 5's **Files** is committed. Step 6 still adds the permanent
  tests and the cancellation mutation run as specced.

### Step 6: RED from the specced mutation run, not a prior-step checkout (2026-11-26)

- **Expected**: Step Dependencies has Step 6's RED run the new test against the pre-Step-5 app
  files; Step 6's Instructions specify RED as a mutation run (`except Exception` →
  `except BaseException` in `isolation.py`).
- **Actual**: RED followed the step's Instructions. Under the mutation,
  `test_isolated_lets_cancelled_error_propagate` (and the screener's
  `test_cancelled_error_in_symbol_eval_propagates`) failed with `DID NOT RAISE <class
  'asyncio.exceptions.CancelledError'>`; the mutation was reverted uncommitted. The pre-Step-5 RED
  (`ModuleNotFoundError`) is already on record from Step 5's probe.
- **Disposition**: no code change. The Verification block's `exit=` reflects only its last line
  (ruff); the pytest results were read from the log.

### Step 7: RED captured with a temporary probe test (2026-11-26)

- **Expected**: Step Dependencies has Step 8's new tests capture RED for Step 7, run against the
  pre-Step-7 `opportunities.py`.
- **Actual**: Step 7 was executed on its own, and its Verification (`tests/test_opportunities_repo.py`)
  does not reference the new marker yet. A temporary untracked `tests/test_tmp_step7_probe.py` held
  Step 8's two assertions (the floor clause built from `EVALUATION_FAILED_PROVENANCE`, list membership
  and `_primary_source([EVALUATION_FAILED_PROVENANCE, "uw"]) == "uw"`). RED gave `ImportError: cannot
  import name 'EVALUATION_FAILED_PROVENANCE'` and GREEN gave `2 passed`. The probe was deleted before
  the commit.
- **Disposition**: no file outside Step 7's **Files** is committed. Step 8 still adds the permanent
  tests and the `_FakeOppRepo.read` mirror as specced.

### Steps 9+10: RED took a second run; the failing symbol is picked out by its closes (2026-11-26)

- **Expected**: one RED run of Step 10's Verification shows `@AC-2` failing on the propagated
  `ZeroDivisionError` and `@AC-3` failing on the missing batch.
- **Actual**: that run stopped at collection. The new `tests/test_readiness.py` import failed
  (`cannot import name 'unavailable_readiness_row'`), which hid every other test. A second RED run
  covered only `tests/test_per_symbol_isolation.py` and `tests/test_unreadable_formula.py`:
  `5 failed, 53 passed`.
  - Both `@AC-2` variants failed with `ZeroDivisionError: boom`.
  - The kick logged "readiness refresh kick failed".
  - The materializer logged "readiness materializer failed for owner".
  - The rewritten timeout test raised `FormulaExecutionError`.
- **Test design**: `ExecuteFormula` requests carry no symbol. The `@AC-3` tests therefore give `NVDA`
  the reversed `_CLOSES` (`_OUTAGE_CLOSES`), and the double raises `UNAVAILABLE` for those closes only.
- **Run script**: the Verification block's trailing `# C-13` comment would have commented out the
  wrapper's closing parenthesis, so the parenthesis went on its own line.
- **Cancellation tests**: they pass both before and after the change. The `except BaseException`
  mutation run gives them their RED: all three failed with
  `DID NOT RAISE <class 'asyncio.exceptions.CancelledError'>`. The mutation was reverted without
  being committed.
- **Disposition**: nothing outside the unit's **Files** changed.

### Steps 11+12: a missed pinning test in `test_analysis_servicer.py` (2026-11-26)

- **Expected**: Step Dependencies names one test pinning the old contract,
  `test_opportunity_recompute_timeout_fails_and_keeps_stored_rows` (`tests/test_unreadable_formula.py:671`),
  which Step 12 rewrites. The unit's **Files** are `servicer.py`, `test_per_symbol_isolation.py`
  and `test_unreadable_formula.py`.
- **Actual**: a second pinning test exists:
  `TestOpportunityDataUnavailable::test_formula_execution_error_still_propagates`
  (`tests/test_analysis_servicer.py:5637` at `4b52469c`). It asserts that a `FormulaExecutionError`
  propagates out of `_compute_opportunities`, which Step 11 reverses. The spec did not list it.
- **Decision**: operator option A (2026-11-26) expanded the unit's scope to
  `tests/test_analysis_servicer.py`. The test is rewritten as a CHANGE characterization,
  `test_formula_execution_error_degrades_only_its_row`. The compute returns, the `AAPL` row carries
  `EVALUATION_FAILED_PROVENANCE` and no `unavailable`, and `opportunity_compute: 1/1` is logged.
  The recurring gap is logged in `docs/roadmap/ledger/fails.md`.
- **Test harness notes**:
  - The `_is_transient_formula_error` spy patches the servicer name with `create=True`. Without it,
    RED would stop at the missing attribute and hide the behavior failure. Every test asserts that
    the spy was called, so a production path that skips the classifier still fails.
  - Instruction 11 says to patch `_composite_score` to raise "for one symbol", but its arguments carry
    no symbol. The double raises on its first call, and the test works out the dropped symbol from
    the returned rows.
- **Cancellation**: `test_opportunities_compute_propagates_cancellation` passes before and after the
  change, as specced. The `except BaseException` mutation in `_row_for` gives its RED, and the
  mutation was reverted without being committed.
- **Disposition**: scope expanded by the operator. No other file outside the unit's **Files**
  changed.

### Step 13: RED from a temporary probe test; long comments re-wrapped (2026-11-26)

- **Expected**: Step Dependencies has Step 14's new tests capture RED for Step 13, run against the
  pre-Step-13 `servicer.py`.
- **Actual**: Step 13 was executed on its own, and no test in its Verification files pins heal
  isolation yet. A temporary untracked `tests/test_tmp_step13_probe.py` patched
  `StrategyEvaluator.evaluate_conditions_traced` to raise `ZeroDivisionError` for an aged
  `["watchlist", "unavailable"]` `MYSZ` row. It asserted four things: the heal returns, the row
  carries `EVALUATION_FAILED_PROVENANCE` and no `unavailable`, nothing is staged, and a second heal
  does not reselect it.
  - RED: `ZeroDivisionError: boom`, raised from `_retry_unavailable_symbols` at `servicer.py:5209`.
  - GREEN: `1 passed`.
  - The probe was deleted before the commit.
  - The first probe run failed in the harness because `GetFormula` was not mocked. The probe was
    fixed and re-run before the RED was taken.
- **Lint**: re-indenting the wrapped blocks pushed three existing comments past 100 columns (ruff
  E501). Those comments and the rewritten docstring were re-wrapped. The wording of the three
  existing comments is unchanged.
- **Exit status**: the Verification block reports `exit=1`. That status comes from its last line,
  the "expect no output" grep, which exits 1 when nothing matches. The pytest and ruff results were
  read from the log.
- **Disposition**: no file outside Step 13's **Files** is committed. Step 14 still adds the
  permanent tests and the cancellation mutation run as specced.
