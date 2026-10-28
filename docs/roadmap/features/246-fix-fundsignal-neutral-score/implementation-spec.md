# Implementation Spec: fix-fundsignal-neutral-score

**Status**: `pending`
**Created**: 2026-10-21
**Feature**: `docs/roadmap/features/246-fix-fundsignal-neutral-score/feature.md`
**Total Steps**: 3
**Feature Branch**: `feature/fix-fundsignal-neutral-score`

> **Evidence baseline.** Every `path:line` below was re-read on `origin/feature/fix-fundsignal-neutral-score` @
> `66fb979a` (2026-10-21). Service code there matches recon.md's Codebase Map; anchors that recon.md did not carry
> were found by grep/read in this session. Re-grep a symbol if the branch moves before execution.
> Re-checked at branch tip `c98b2d91` (2026-10-21, sdd-review impl-spec): `product-spec.md:43` carries FR-3;
> `acceptance.feature` Background (`:5-7`) holds only min-conviction + quantiles, the formula-id Given opens AC-1 (`:11`)
> and AC-2 (`:23`), AC-1's last Then (`:19`) has no direction clause, `@AC-3 @FR-3` is `:31-39`; `design.md` and the
> four B.2/B.3 reports + `.status` sidecars under `docs/reports/2026-10-21-*` exist. A checkout older than `66fb979a`
> lacks these (B.1 gate writes landed there).

---

## Execution Summary

design.md § Chosen Approach is followed exactly: one production file
(`services/xstockstrat-analysis/app/engine/fundsignal_loop.py`), tests, one agent docstring, docs. No proto, migration,
config or ingest/indicators code change (Fix Scope; F-01/F-07 untouched; next free migration numbers analysis `028`,
ingest `015` are **not** used).

1. **Step 1 (test, RED).** Add the `fundamentals_row` factory to `tests/conftest.py`, move the three existing
   fundamentals-row consumers onto it (a no-op on the current tree), then write the AC-1/AC-2/AC-3 regression tests,
   the zero-value table, the `_warn_unscored` unit test and the `run_once`-level `caplog` wiring tests (normal path,
   abort path, formula-exception exclusion). The new tests fail on the current tree; the existing suite stays green.
2. **Step 2 (service, GREEN).** `_builtin_score` reads absence from `Fundamentals.missing_metrics` and returns `None`
   when nothing is usable; `_score` / `_score_via_formula` return `(scores, unscored)` and omit all-missing rows; a
   run-attributed `_warn_unscored` WARN fires before the source-registration `try`.
3. **Step 3 (docs).** Analysis `CLAUDE.md` producer bullets, analysis `docs/context-constitution.md:42`, the `dry_run`
   doc drift (`services/xstockstrat-agent/app/tools.py:1409`, `docs/runbooks/mcp-tools.md:836`), a root findings row
   for `packages/proto/analysis/v1/analysis.proto:554`, and the root `CLAUDE.md` teardown.

The test step is placed **before** its service step on purpose (see § Step Dependencies): the fixture migration must
land before production code reads `f.missing_metrics`, or the existing `SimpleNamespace` rows raise `AttributeError`
(recon.md Risk 1). `/sdd-execute` captures Step 1's RED run on the pre-Step-2 tree and the GREEN run after Step 2
(P-06, `.claude/skills/sdd-execute/reference/tdd-gate.md`).

### Scenario Coverage (C-15)

| Scenario | Covered by | Proof |
|---|---|---|
| `@AC-1 @FR-1` Symbols with no usable fundamentals are not scored, ranked or emitted | Step 1 (`test_ac1_*`), GREEN by Step 2 | `run_once` cycle; one `IngestSignal` + one `fundsignal_emitted` row, both MSFT; `_map_directions` input == {MSFT}; RED: 6 signals today |
| `@AC-2 @FR-2` A metric reported as zero is scored, not treated as absent | Step 1 (`test_ac2_*`, zero-value table), GREEN by Step 2 | ZRO conviction and `fundsignal_emitted.score` 0.30 ± 1e-9; RED: 0.6 today |
| `@AC-3 @FR-3` Under a scoring formula, an all-missing row is skipped and a partial row is still scored | Step 1 (`test_ac3_*`), GREEN by Step 2 | one `ExecuteFormula` (system identity, `dividend_yield` 0.013, `pe_ratio` 0.0); one emit + one row, DIVONLY; RED: two `ExecuteFormula` calls today |

FR-1 → AC-1, FR-2 → AC-2, FR-3 → AC-3 (every FR covered). On the integration PR, `/sdd-execute` promotes AC-1/2/3
into the analysis durable suite (C-16): AC-3 into
`services/xstockstrat-analysis/acceptance/fundamentals-formula-inputs.feature` (beside `@AC-8 @feature-201`,
`:47-53`), AC-1/AC-2 into the same file or a sibling (design.md § Footprint).

### Consumer surfaces (C-14)

product-spec.md § Consumer Surface(s) names ingest signals under `analysis.fundsignal.source_slug`, read by
`ListOpportunities` (`/insights/opportunities`, `services/xstockstrat-ui/src/app/insights/opportunities/page.tsx`;
MCP `list_opportunities`, `services/xstockstrat-agent/app/tools.py:1518`), the live blend universe
(`services/xstockstrat-analysis/app/engine/live_loop.py:149-192`), and MCP `run_fundamentals_scan`
(`tools.py:1401`). The change is row volume only: no new fabricated rows reach those readers; there is **no UI or
agent behaviour change** (design.md § Consumer surfaces). The agent surface is still touched in Step 3: the
`run_fundamentals_scan` docstring (`tools.py:1409`), which is the MCP tool description, wrongly says `dry_run`
scores. Stored fabricated signals are owned by
`docs/reports/2026-10-21-ingest-fundsignal-fabricated-signals-not-retracted-defect.md` (B.2).

### Files coverage (F-08)

Every file design.md § Docs names is in exactly one step's **Files**:

| File | Step |
|---|---|
| `services/xstockstrat-analysis/tests/conftest.py` | 1 |
| `services/xstockstrat-analysis/tests/test_fundsignal_loop.py` | 1 |
| `services/xstockstrat-analysis/tests/test_owner_header_guard.py` | 1 |
| `services/xstockstrat-analysis/tests/test_fundamentals_formula_servicer.py` | 1 |
| `services/xstockstrat-analysis/app/engine/fundsignal_loop.py` | 2 |
| `services/xstockstrat-analysis/CLAUDE.md` | 3 |
| `services/xstockstrat-analysis/docs/context-constitution.md` | 3 |
| `services/xstockstrat-agent/app/tools.py` | 3 |
| `docs/runbooks/mcp-tools.md` | 3 |
| `docs/context-constitution-findings.md` | 3 |

## Step Dependencies

- **Step 1 [test] covers Step 2 [service]** (C-08). Step 1 runs first: its fixture migration (`_fund`,
  `_FUND_VALUES`, `_snapshot_resp` → real `marketdata_pb2.Fundamentals`) must precede Step 2's `f.missing_metrics`
  reads, or `tests/test_fundsignal_loop.py` (`_fund`, `:31-42`) and `tests/test_owner_header_guard.py`
  (`:221`) raise `AttributeError` (recon.md Risk 1). On the pre-Step-2 tree the migration is behaviour-neutral (all
  three fixtures default to an empty `missing_metrics`, and the current scorer reads only values).
- **Step 3 [docs] requires Step 2**: the docs describe the shipped WARN and the rerun re-fetch.
- **Overlap 244-fix-python-config-zero-trap** (`implementation-ready` on `origin/feature/fix-python-config-zero-trap`,
  re-checked 2026-10-21): no presence helper for `missing_metrics` exists here
  (`services/xstockstrat-analysis/app/config/watcher.py` has config-key helpers only, `get_float_present` `:136`) and
  244's spec adds none (its `missing_metrics` grep is empty; its conftest addition is `snapshot_watcher`, 244 spec
  `:676`), so Step 2 reuses the screener's inline membership pattern (`app/services/screener.py:402-403`). If 244
  lands one first, Step 2 reuses it and records a Deviation Log row. 244 classifies
  `analysis.fundsignal.min_conviction_to_emit` (`fundsignal_loop.py:229`) and records 246 as disjoint lines (244 spec
  `:173`); this spec does not change that line.
- **Rebase-only overlaps (same file, disjoint regions; no `merge-order.md` row needed):** 244 also edits
  `tests/conftest.py`, analysis `CLAUDE.md`, analysis `docs/context-constitution.md` and
  `docs/context-constitution-findings.md` (244 spec `:626`, `:1175-1181`); 250-fix-otel-metrics-logs-gap also edits
  `docs/context-constitution-findings.md` (table-append conflict: re-read the table before appending in Step 3);
  247-fix-agent-getconfig-deadline and 249-fix-ibkr-request-signing edit other regions of
  `services/xstockstrat-agent/app/tools.py`; 249 edits other rows of `docs/runbooks/mcp-tools.md`. Re-grep every
  Step 2/3 anchor after rebasing onto whichever lands first.
- **Consumer surfaces, no step (C-14):** `/insights/opportunities`, MCP `list_opportunities` and the live blend
  universe get no behaviour change, only fewer fabricated rows (§ Consumer surfaces). MCP `run_fundamentals_scan` is
  Step 3 (docstring). Already-stored fabricated signals → B.2 below.
- **Owned elsewhere (not steps here):** stored fabricated signals and ZRO-shape partial-row signals → B.2
  (`docs/reports/2026-10-21-ingest-fundsignal-fabricated-signals-not-retracted-defect.md`); real zeros read as 0.5
  downstream → B.3(1) (`docs/reports/2026-10-21-analysis-zero-conviction-read-as-neutral-defect.md`); small-n quantile
  labelling one scored symbol `buy` (`fundsignal_loop.py:470-485`) → B.3(2)
  (`docs/reports/2026-10-21-analysis-fundsignal-small-cross-section-quantile-defect.md`); formula partial row scored
  from wire zeros → B.3(3) (`docs/reports/2026-10-21-analysis-fundsignal-formula-partial-row-wire-zero-defect.md`).
- **Release gates (a)-(c)** below are outside the step loop; (b) and (c) block promotion to `main`.

## Release Gates (design.md § Gates, blocking)

- **(a) Vendor-zero probe — discharged for staging.** 2026-10-21, staging `query_fundamentals` (read-only, source
  finnhub): SPY, VOO and QQQ each list `market_cap`, `pe_ratio`, `pb_ratio`, `dividend_yield`, `eps`, `roe` and
  `debt_to_equity` in `missing_metrics`; no explicit vendor zero for `pb_ratio` or `debt_to_equity`
  (`context.md` design session, orchestrator evidence).
- **(b) Dev smoke after deploy.** MCP `run_fundamentals_scan symbols=[SPY,VOO,QQQ,IWM,DIA] force=false
  dry_run=false`. PASS iff `symbols_processed==5`, `deferred_count==0`, `signals_emitted==0`, and the `_warn_unscored`
  line whose `run_id` equals the summary `run_id` lists all five (DO logs, dev `xstockstrat-analysis`; a line from
  another run does not count). Record dev `analysis.fundsignal.min_conviction_to_emit` and
  `analysis.fundsignal.scoring_formula_id` in `context.md`. `symbols_processed<5` (retry next UTC day) or no log access
  = INCONCLUSIVE. `force=true` is forbidden (it deletes the day's rows, `fundsignal_loop.py:210-216`); `dry_run=true`
  cannot show the fix (returns before scoring, `:195-199`). FAIL blocks promotion; its signals go to B.2 (d).
- **(c) Prod parity before promotion.** Record prod `marketdata.fundamentals.provider` and `snapshot_source` in
  `context.md`; if either differs from staging (finnhub / vendor), re-run (a) under prod's path, same blocking rule.

---

### Step 1 — test: `fundamentals_row` factory, fixture migration, AC-1/AC-2/AC-3 regression and WARN wiring tests

**Status**: `done`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/tests/conftest.py` — modify
- `services/xstockstrat-analysis/tests/test_fundsignal_loop.py` — modify
- `services/xstockstrat-analysis/tests/test_owner_header_guard.py` — modify
- `services/xstockstrat-analysis/tests/test_fundamentals_formula_servicer.py` — modify

**Reviewers**: `xstockstrat-analysis` owner — backtest reproducibility, strategy scoring determinism, no look-ahead bias

**Codebase Evidence**:
- `tests/conftest.py`: `_setup_gen_path()` runs at `:42`; post-setup imports carry `# noqa: E402`
  (`from app.services.evaluator import FundamentalPeriod  # noqa: E402`, `:46`); domain-row factory precedent
  `def fund_period(filed_date, **values)` `:49-51`; `RecordingStub` `:83-110` (`.of(method)` → `(name, request,
  metadata)` tuples, `:109-110`). No `marketdata_pb2` import exists in `conftest.py` today (grep).
- `tests/test_fundsignal_loop.py`: `_make_cfg` `:20-28`; `_fund(symbol, **kw)` `:31-42` returns
  `SimpleNamespace(**base)` with `pe_ratio=15.0, pb_ratio=2.0, roe=0.15, debt_to_equity=0.5, eps=3.0,
  dividend_yield=0.02`; `_make_loop` `:45-68` with `_get_multi` `:60-61` and `IngestSignal` AsyncMock `:64`;
  `test_builtin_score_deterministic` `:188-192`; `_SYSTEM_FORMULA` `:522`; `_rpc_error` `:526-529`;
  `_identity_loop(overrides, author, ingest_responses)` `:532-546` (`ExecuteFormula` →
  `SimpleNamespace(success=True, output={"composite": 0.7})`, `:543`); `_emitted_inserts` `:549-552`;
  `_assert_system_identity` `:559-566`; `TestScoringFailClosed` `:632-694` (monkeypatches `_builtin_score` to
  `MagicMock(return_value=0.5)` at `:649,660,672,683`); `TestSystemWriteRejected.test_ac36_register_failed_precondition_aborts_cycle`
  `:699-717` (abort-path harness: `ManageSignalSource` → `FAILED_PRECONDITION`); `caplog` precedent
  `test_cap_applies_when_fmp_active` `:353-359`. No `missing_metrics` match in the file (recon.md Not found).
- `tests/test_owner_header_guard.py`: `_FUND_VALUES = dict(pe_ratio=1, pb_ratio=1, dividend_yield=0, roe=1,
  debt_to_equity=1, eps=1)` `:197`; consumed at `:221`
  (`fundamentals=[SimpleNamespace(symbol=s, **_FUND_VALUES) for s in req.symbols]`); `from tests.conftest import
  RecordingStub, ctx_with` `:27`.
- `tests/test_fundamentals_formula_servicer.py`: `_snapshot_resp(symbol="AAPL", missing=(), **metrics)` `:93-95`
  builds `marketdata_pb2.Fundamentals(symbol=symbol, missing_metrics=list(missing), **metrics)`.
- Real-proto absence fixture precedent: `tests/test_screener.py:288-296`
  (`marketdata_pb2.Fundamentals(symbol="AAA", missing_metrics=["pe_ratio"])`).
- Producer facts the assertions rely on: `run_once` `run_id = str(uuid.uuid4())` `fundsignal_loop.py:170`;
  `IngestSignalRequest(signal=ExternalSignal(symbol=..., conviction=float(conviction)))` `:527-536`;
  `fundsignal_emitted` claim insert args `(symbol, source_slug, as_of_date, score, direction, run_id)` `:243-254`;
  `_BUILTIN_BANDS` `:45-50`; `_lin` `:53-66`; formula input dict keys `:452-459`;
  `score_fundamentals` → `indicators_stub.ExecuteFormula(ExecuteFormulaRequest(formula_id, input_data=Struct))`
  (`app/services/fundamentals_scoring.py:52-59`).
- Blast radius (grep `FundamentalsSignalLoop|fundsignal_loop` in `tests/`): `test_fundsignal_loop.py`,
  `test_owner_header_guard.py`, `test_analysis_servicer.py` (mocks `run_once` wholesale, `:1314-1383`; untouched),
  `test_strategy_scores_repo.py` (docstring mention only).

**TDD**: `red-green required`

**Covers**: `AC-1, AC-2, AC-3`

**Instructions**:
1. **Factory (C-13: three consumers → canonical home).** In `tests/conftest.py`, after the `fund_period` block
   (`:49-51`), add `from gen.marketdata.v1 import marketdata_pb2  # noqa: E402` beside the other post-setup imports and
   `def fundamentals_row(symbol, missing=(), **metrics)` returning
   `marketdata_pb2.Fundamentals(symbol=symbol, missing_metrics=list(missing), **metrics)`. It does **not** derive
   `missing_metrics` from omitted metrics (design.md Rejected Alternatives).
2. **Migrate the three consumers (behaviour-neutral on the current tree).**
   - `test_fundsignal_loop.py` `_fund` (`:31-42`): keep the signature and defaults; return
     `fundamentals_row(symbol, **base_without_symbol)` instead of `SimpleNamespace(**base)`.
   - `test_owner_header_guard.py:221`: replace `SimpleNamespace(symbol=s, **_FUND_VALUES)` with
     `fundamentals_row(s, **_FUND_VALUES)`; import `fundamentals_row` from `tests.conftest` (extend the `:27` import).
   - `test_fundamentals_formula_servicer.py` `_snapshot_resp` (`:93-95`): build `row` with
     `fundamentals_row(symbol, missing, **metrics)` (pass-through; feature-201 semantics unchanged).
   Do not migrate other inline `Fundamentals` rows (design.md Rejected: repo-wide migration).
3. **Module-local constant (one consumer file).** In `test_fundsignal_loop.py`:
   `BUILTIN_SCORER_METRICS = (*fundsignal_module._BUILTIN_BANDS, "eps")` (derived so the FR-1 "every metric" set cannot
   drift from the scorer; `fundsignal_module` is already imported at `:16`). The formula-path all-missing set is
   `(*BUILTIN_SCORER_METRICS, "dividend_yield")` inline in the AC-3 test.
4. **New test class `TestUnscoredSymbols`** (feature 246) in `test_fundsignal_loop.py`. Each cycle overrides
   `loop._marketdata.GetFundamentalsMulti` with an `AsyncMock` whose side effect returns
   `SimpleNamespace(fundamentals=[rows[s] for s in request.symbols if s in rows])` from a per-test `rows` dict of
   `fundamentals_row(...)`. Tests that use `grpc.StatusCode` import `grpc` locally inside the test, as the file does
   today (`:668`, `:678`, `:700`; no module-level `import grpc`).
   - `test_ac1_dataless_symbols_not_scored_ranked_or_emitted` (**AC-1**): `_identity_loop()` (built-in scorer, empty
     formula id); `rows`: SPY/QQQ/IWM/DIA/VOO with `missing=BUILTIN_SCORER_METRICS`; MSFT with `pe_ratio=20.0, roe=0.30,
     eps=10.0, missing=("pb_ratio", "debt_to_equity")`. Spy `_map_directions` with
     `monkeypatch.setattr(loop, "_map_directions", MagicMock(wraps=loop._map_directions))`. Run
     `summary = await loop.run_once(override_symbols=[...6...])` under `caplog.at_level("WARNING")`. Assert: exactly one
     `IngestSignal`, `req.signal.symbol == "MSFT"`; `_emitted_inserts(loop)` symbols (`c.args[1]`) == `["MSFT"]`; the
     `_map_directions` call's scores keys == `{"MSFT"}` with MSFT ≈ `(0.6 + 1.0 + 1.0) / 3` (abs 1e-9); exactly one
     record containing `"unscored (no fundamentals)"`, and it contains `summary.run_id`, `"5 of 6"` and
     `"DIA,IWM,QQQ,SPY,VOO"`. No direction is asserted (B.1). Expected RED: 6 `IngestSignal` calls.
   - `test_ac2_zero_metric_scored_not_absent` (**AC-2**): `_identity_loop()`; `rows["ZRO"] = fundamentals_row("ZRO",
     pe_ratio=20.0, roe=0.0, missing=("pb_ratio", "debt_to_equity", "eps"))`. Assert the single `IngestSignal`
     `req.signal.conviction == pytest.approx(0.30, abs=1e-9)` and the `fundsignal_emitted` insert score `c.args[4]`
     `== pytest.approx(0.30, abs=1e-9)` (`_lin(20, 10, 35) = 0.6`, `_lin(0.0, 0.25, 0.05) = 0.0`). Expected RED: 0.6.
   - `test_ac3_formula_all_missing_skipped_partial_scored` (**AC-3**):
     `_identity_loop({"analysis.fundsignal.scoring_formula_id": _SYSTEM_FORMULA})`; `rows`: NODATA with
     `missing=(*BUILTIN_SCORER_METRICS, "dividend_yield")`; DIVONLY with `dividend_yield=0.013,
     missing=BUILTIN_SCORER_METRICS`. Assert `loop._indicators.of("ExecuteFormula")` has length 1, its
     `dict(req.input_data)` has `dividend_yield == pytest.approx(0.013)` and `pe_ratio == 0.0`, and
     `_assert_system_identity(meta)`; exactly one `IngestSignal` (DIVONLY) and one `fundsignal_emitted` insert
     (DIVONLY, score 0.7 from the harness `composite`); none for NODATA. No direction asserted. Expected RED: two
     `ExecuteFormula` calls.
   - `test_formula_exception_skip_not_counted_unscored`: formula harness with
     `loop._indicators._responses["ExecuteFormula"] = _rpc_error(grpc.StatusCode.INTERNAL)` (the `:681` shape);
     `rows`: NODATA (six missing) and AAPL (`_fund("AAPL")`). Assert exactly one unscored WARN, containing `"1 of 2"` and
     `"NODATA"` and not `"AAPL"`; the existing `"formula scoring failed for AAPL"` WARN still appears (`:466`). Expected
     RED: no unscored WARN.
   - `test_unscored_warn_logged_on_abort_path`: `_identity_loop(ingest_responses={"ManageSignalSource":
     _rpc_error(grpc.StatusCode.FAILED_PRECONDITION)})`; `rows`: SPY (`missing=BUILTIN_SCORER_METRICS`) and
     `_fund("MSFT")`. Assert `summary.status == "failed"`, no `IngestSignal`, and exactly one unscored WARN containing
     `summary.run_id`, `"1 of 2"` and `"SPY"`. Fails if the Step 2 call is deleted or moved inside the `try`
     (design.md C-08/P-06). Expected RED: no WARN.
   - `test_all_dataless_cycle_completes`: `_identity_loop()`; `rows`: SPY and VOO, both all-missing. Assert
     `summary.status == "completed"`, `summary.signals_emitted == 0`, `summary.symbols_processed == 2`, one
     `ManageSignalSource` call (registration still runs, `@AC-1 @feature-156`, `@AC-36 @feature-224`). Expected RED:
     two signals emitted today.
   - `test_builtin_score_zero_values` (**AC-2**, zero-value table): `pytest.mark.parametrize` over
     `(metric, value, expected)` = `("pe_ratio", 0.0, 0.0)`, `("pb_ratio", 0.0, 0.0)`, `("roe", 0.0, 0.0)`,
     `("debt_to_equity", 0.0, 1.0)`, `("eps", 0.0, 0.0)`; each row is
     `fundamentals_row("Z", **{metric: value}, missing=[m for m in BUILTIN_SCORER_METRICS if m != metric])`; assert
     `FundamentalsSignalLoop._builtin_score(row) == pytest.approx(expected)`. Expected RED: 0.5 for all five.
   - `test_builtin_score_all_missing_is_none` (**AC-1**): `_builtin_score(fundamentals_row("SPY",
     missing=BUILTIN_SCORER_METRICS))` is `None`. Expected RED: 0.5.
   - `test_warn_unscored_unit`: `FundamentalsSignalLoop._warn_unscored("r-1", ["VOO", "SPY"], 3)` under `caplog` logs
     exactly one WARNING containing `"r-1"`, `"2 of 3"` and `"SPY,VOO"`; `_warn_unscored("r-1", [], 3)` logs none.
     Expected RED: `AttributeError` (no such method).
5. Leave `TestScoringFailClosed` (`:632-694`) and `test_builtin_score_deterministic` (`:188-192`) unchanged; they must
   stay green after Step 2 (recon.md Risk 2: a `0.5` mock is not `None`, so those symbols stay scored).
6. **C-13 verdict.** `fundamentals_row` has three consumer files → `tests/conftest.py`. `BUILTIN_SCORER_METRICS` and
   the NODATA/DIVONLY/ZRO rows are scenario one-offs in one file → inline/module-local (compliant).

**Verification**:
```bash
cd services/xstockstrat-analysis
# RED (pre-Step-2 tree): the new tests fail, every pre-existing test passes
pytest tests/test_fundsignal_loop.py -k "TestUnscoredSymbols" -q        # expect failures listed in Instructions §4
pytest tests/test_fundsignal_loop.py tests/test_owner_header_guard.py tests/test_fundamentals_formula_servicer.py -q -k "not TestUnscoredSymbols"   # expect all pass
# GREEN (after Step 2): full suite + CI threshold + lint
pytest --cov=app --cov-fail-under=40
ruff check . && ruff format --check .
# C-13: one factory definition, three importers, no second inline Fundamentals-row helper
grep -n "def fundamentals_row" tests/conftest.py
grep -n "fundamentals_row" tests/test_fundsignal_loop.py tests/test_owner_header_guard.py tests/test_fundamentals_formula_servicer.py
```

---

### Step 2 — service: presence-based built-in scorer, all-missing skip in both scorers, run-attributed unscored WARN

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/app/engine/fundsignal_loop.py` — modify

**Reviewers**: `xstockstrat-analysis` owner — backtest reproducibility, strategy scoring determinism, no look-ahead bias

**Codebase Evidence**:
- `_BUILTIN_BANDS` `fundsignal_loop.py:45-50`; pb comment `:47` reads `# lower better; <0 handled specially`.
- `run_once` `:169`; `run_id` `:170`; `dry_run` return `:195-199`; formula pre-flight/abort `:201-206`;
  `force` delete `:210-216`; `_paced_fetch` `:223`; `scores = await self._score(fetched, sys_meta)` `:226`;
  `directions = self._map_directions(scores, buy_q, sell_q)` `:230`; `try:` + `_ensure_source_registered` `:235-236`;
  skip-by-omission comment + `for symbol in sorted(scores):` `:237-238`; `except _SystemWriteRejected` → `_abort_cycle(...,
  symbols_done=len(fetched), ...)` `:270-278`; `_finish(..., symbols_done=len(fetched), ...)` `:286-293`.
- WARN shape to copy: `_apply_symbol_cap` `log.warning("fundsignal: max_symbols cap dropped %d of %d symbols (FMP
  budget): %s", len(dropped), len(deduped), ",".join(dropped))` `:350-355`; static helpers use `@staticmethod`
  (`_parse_csv` `:358-360`).
- `_score` `:409-414` (formula branch `:412-413`, built-in dict comprehension `:414`); its only caller is `:226`
  (grep `\._score(`).
- `_builtin_score` `:416-432`: truthiness guards `:420,423,425,428,430`; pe branch `0.0 if pe <= 0` `:421`; pb branch
  `0.0 if pb < 0` `:424`; de branch `0.0 if de < 0` `:429`; neutral fallback `return sum(parts) / len(parts) if parts
  else 0.5` `:432`.
- `_score_via_formula` `:447-467`: six-key dict `:452-459`; exception skip + WARN `:465-466`; `return out` `:467`.
- Absence pattern to REUSE (recon.md): `app/services/screener.py:402-403`
  (`if metric_name in fund.missing_metrics: return None`); set-then-map shape `app/handlers/servicer.py:6481-6482`.
- Provider-boundary trace (design.md flagged UNVERIFIED; re-grepped at spec time 2026-10-21, re-confirm before citing
  in the PR): `toProtoFundamentals` `services/xstockstrat-marketdata/internal/service/marketdata_service.go:2012`,
  nil-pointer → `missing` loop `:2033-2038`, `MissingMetrics: missing` `:2056`; finnhub `*float64` metric fields
  incl. `PBRatio` / `DebtToEquityQuarter` `internal/finnhub/finnhub_client.go:177-188`; FMP `*float64` fields
  `internal/fmp/fmp_client.go:305-310,341-344`; EDGAR sets `DebtToEquity` only when equity ≠ 0
  `internal/edgar/edgar_client.go:560-562`; repo scan into NULL-preserving `*float64` locals
  `internal/repository/marketdata_repo.go:537-552`. Residual (unverified, design.md Open Risks): cache rows written
  before the pointer types existed, bounded by the 24h TTL.
- Header propagation: no new outbound call. `ExecuteFormula`, `IngestSignal` and `ManageSignalSource` keep `sys_meta`
  (`:175-178`); marketdata keeps the caller's `metadata` (`:223`). No change.

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. `_BUILTIN_BANDS` `:47`: change the pb comment to `# lower better; <=0 handled specially`.
2. `_builtin_score` (`:416-432`): first line `missing = set(f.missing_metrics)`; replace each truthiness guard with a
   membership test — `if "pe_ratio" not in missing:` (`:420`), `"pb_ratio"` (`:423`), `"roe"` (`:425`),
   `"debt_to_equity"` (`:428`), `"eps"` (`:430`) — keeping each value branch, except pb becomes
   `0.0 if pb <= 0 else _lin(pb, *_BUILTIN_BANDS["pb_ratio"])` (matches pe `:421`). The last line becomes
   `return sum(parts) / len(parts) if parts else None`. No `getattr(..., "missing_metrics", ())` (design.md Rejected).
   The pb `< 0` → `<= 0` change goes beyond FR-2's literal text (without it a reported pb 0.0 scores 1.0, the best
   value); the PR body must call it out with its residual (pb=0 + de=0 averages 0.5, design.md Open Risks).
3. `_score` (`:409-414`): return `(scores, unscored)`. Formula branch: `return await self._score_via_formula(...)`
   (which now returns the pair). Built-in branch: loop over `fundamentals_by_symbol.items()`; a `None` from
   `self._builtin_score(f)` appends `sym` to `unscored`, otherwise `scores[sym] = s`. Update the docstring to state
   the pair and that an unscored symbol is absent from `scores`.
4. `_score_via_formula` (`:447-467`): keep `out = {}`, add `unscored = []`; after building the six-key dict
   (`:452-459`) add `if set(f.missing_metrics).issuperset(fundamentals): unscored.append(sym); continue` (FR-3). A
   partial row still sends wire 0.0 (`@AC-8 @feature-201`, PRESERVE). The exception path (`:465-466`) is unchanged
   and does **not** append to `unscored`. Return `(out, unscored)`.
5. Add `@staticmethod def _warn_unscored(run_id, unscored, total)` next to `_apply_symbol_cap`: no-op when `unscored`
   is empty; otherwise exactly one
   `log.warning("fundsignal run %s: %d of %d symbols unscored (no fundamentals): %s", run_id, len(unscored), total,
   ",".join(sorted(unscored)))`. It never raises.
6. `run_once`: `:226` becomes `scores, unscored = await self._score(fetched, sys_meta)`, followed immediately by
   `self._warn_unscored(run_id, unscored, len(fetched))` — before `_map_directions` (`:230`) and the `try` (`:235`),
   so it fires on both `_finish` (`:286`) and the `_SystemWriteRejected` abort (`:270-278`). `total = len(fetched)`
   matches the `symbols_done` both paths record (design.md: not `len(to_process)`/`len(universe)`).
7. Unchanged (do not touch): `_map_directions`, the emit loop, `_finish`, `_abort_cycle`, the `run_completed` payload,
   `FundamentalsScanSummary`, `_apply_symbol_cap` ordering (`:183`, `@AC-6 @feature-154`), the `dry_run` early return,
   the `:229` `min_conviction_to_emit` read (244 overlap). `symbols_processed` keeps meaning "fetched". No notify alert
   for unscored symbols (design.md Rejected `_emit_warning`).
8. Sibling sweep (ledger `fails.md:1815-1822`), dispositions carried word for word from design.md, no code here:
   `scoring.py:15,39`: intended neutral. `scoring.py:31`: owned by B.3(1). `screener.py:467`: unreachable.
   `screener.py:480`: owned by 144. `fundamentals_value_quality.py:162,180`: owned by B.3(3).

**Verification**:
```bash
cd services/xstockstrat-analysis
pytest tests/test_fundsignal_loop.py tests/test_owner_header_guard.py tests/test_fundamentals_formula_servicer.py -q   # all pass (Step 1 GREEN)
pytest --cov=app --cov-fail-under=40
ruff check . && ruff format --check .
grep -n "else 0.5" app/engine/fundsignal_loop.py          # expect no match in _builtin_score
grep -n "missing_metrics" app/engine/fundsignal_loop.py   # expect _builtin_score and _score_via_formula reads
grep -n "_warn_unscored" app/engine/fundsignal_loop.py    # expect the def and one call, before the `try:` in run_once
```

---

### Step 3 — docs: producer docs, `dry_run` drift, findings row, root teardown

**Status**: `pending`
**Service**: `services/xstockstrat-analysis/` docs, `services/xstockstrat-agent/` (docstring only), `docs/`
**Files**:
- `services/xstockstrat-analysis/CLAUDE.md` — modify
- `services/xstockstrat-analysis/docs/context-constitution.md` — modify
- `services/xstockstrat-agent/app/tools.py` — modify (docstring only)
- `docs/runbooks/mcp-tools.md` — modify
- `docs/context-constitution-findings.md` — modify

**Reviewers**: none (docs). Advisory: `xstockstrat-agent` owner — MCP tool contract stability and
`docs/runbooks/mcp-tools.md` parity (the `tools.py:1409` docstring is the MCP tool description).

**Codebase Evidence**:
- `services/xstockstrat-analysis/CLAUDE.md`: § Fundamentals Signal Producer (feature 062) `:117`; Idempotency bullet
  `:123` ("ingest's `IngestSignal` does **not** dedup … A same-day re-run emits nothing new and spends zero cache
  calls"); Fail-closed scoring bullet `:126`. Ingest dedups per owner since features 111/224
  (`services/xstockstrat-ingest/app/handlers/servicer.py:1041-1056`, recon.md Risk 13).
- `services/xstockstrat-analysis/docs/context-constitution.md:42`: Feature 144 bullet ending "`_builtin_score` … —
  **left unfixed** …, flagged as a candidate follow-up."
- `services/xstockstrat-agent/app/tools.py:1409`: `dry_run: score + report what WOULD be scanned without emitting or
  spending cache calls.` — but `run_once` returns at `fundsignal_loop.py:195-199` before scoring.
- `docs/runbooks/mcp-tools.md:836`: `| \`dry_run\` | \`bool\` | No | \`false\` default; \`true\` scores + reports what
  *would* be scanned …|`.
- `packages/proto/analysis/v1/analysis.proto:554`: `bool dry_run = 2; // score + report but do not emit or spend cache
  calls` (generated copies in `packages/proto/gen/ts/`); logged, **not** edited (Fix Scope "Proto: none").
- `docs/context-constitution-findings.md` § "Documentation that lies" table `:13-26` (columns: What the docs say | What
  the code does | Evidence | Suggested action).
- Teardown rule: root `CLAUDE.md` § Teardown (run `/context-forge:context-constitution refresh` scoped to touched
  context files, or the manual reconciliation recorded in the PR body).

**TDD**: `N/A (docs — the only code-file edit is a docstring; no behaviour change)`

**Covers**: —

**Instructions**:
1. Analysis `CLAUDE.md:123`: rewrite the Idempotency bullet — analysis owns the producer's day guard in
   `analysis.fundsignal_emitted` (PK `(symbol, source, as_of_date)`) and ingest also dedups per owner
   (`ingest servicer.py:1041-1056`); a same-day re-run emits nothing new for already-emitted symbols, but re-fetches
   unscored symbols (they write no row), bounded by `analysis.fundsignal.daily_call_budget`; `force=true` re-emits by
   clearing the day's rows first.
2. Analysis `CLAUDE.md` producer bullets: add one bullet after `:126` — **Unscored symbols (feature 246)**: absence is
   read from `Fundamentals.missing_metrics`, never from a zero value; a row missing all five built-in metrics
   (`pe_ratio`, `pb_ratio`, `roe`, `debt_to_equity`, `eps`) or, under a scoring formula, all six formula inputs, is not
   scored, ranked or emitted; one WARN per cycle `fundsignal run <run_id>: N of M symbols unscored (no fundamentals):
   <symbols>` (M = fetched); `symbols_processed` still counts them; a partial formula row still sends wire 0.0
   (`@AC-8 @feature-201`).
3. Analysis `docs/context-constitution.md:42`: replace the "left unfixed … candidate follow-up" clause with: fixed by
   feature 246 — skip by omission (never ranked, unlike 144's rank-last `score_unavailable`), absence from
   `missing_metrics`.
4. `services/xstockstrat-agent/app/tools.py:1409`: `dry_run: report what WOULD be scanned (universe size) without
   scoring, emitting or spending cache calls.`
5. `docs/runbooks/mcp-tools.md:836`: same correction in the table cell (`true` reports what *would* be scanned without
   scoring, emitting or spending cache calls).
6. `docs/context-constitution-findings.md` § Documentation that lies: append one row — docs say
   `analysis.proto:554` "score + report" for `dry_run`; code returns before scoring (`fundsignal_loop.py:195-199`);
   evidence `packages/proto/analysis/v1/analysis.proto:554` + gen TS copies; suggested action: fix the comment in the
   next PR that already touches `analysis.proto` (agent docstring and `mcp-tools.md` fixed by feature 246).
7. Teardown: run `/context-forge:context-constitution refresh` scoped to the touched context files
   (`services/xstockstrat-analysis/CLAUDE.md`, `services/xstockstrat-analysis/docs/context-constitution.md`,
   `docs/context-constitution-findings.md`) and fix grounded drift; if the plugin is unavailable, re-read each touched
   file against the Step 2 code and record in the PR body both that it was unavailable and the reconciliation done
   (ledger `fails.md:670`).

**Verification**:
```bash
grep -n "zero cache calls\|does \*\*not\*\* dedup" services/xstockstrat-analysis/CLAUDE.md   # expect no match
grep -n "Unscored symbols (feature 246)" services/xstockstrat-analysis/CLAUDE.md
grep -n "left unfixed" services/xstockstrat-analysis/docs/context-constitution.md            # expect no match
grep -n "score + report\|scores + reports" services/xstockstrat-agent/app/tools.py docs/runbooks/mcp-tools.md   # expect no match
grep -n "analysis.proto:554" docs/context-constitution-findings.md
cd services/xstockstrat-agent && ruff check . && ruff format --check . && pytest tests/test_tools.py tests/test_list_correlation_parity.py -q
```

---

## Deviation Log

_Populated by /sdd-execute as implementation proceeds._

### Step 1 — 2026-10-28 — module-local test helpers in `test_fundsignal_loop.py`

- **Spec said**: each `TestUnscoredSymbols` cycle overrides `GetFundamentalsMulti` with an `AsyncMock` serving a
  per-test `rows` dict, and asserts on the unscored WARN record.
- **Actual**: the override and the WARN filter are two module-local helpers (`_serve_rows`, `_unscored_warns`,
  keyed on the `"unscored (no fundamentals)"` marker) shared by the class's tests; same behaviour, one file
  (C-13 compliant). `ruff check --fix` (I001) placed the new conftest `gen` import in its own group above the
  `app` import.
- **Disposition**: in scope, no behaviour change. The Verification's GREEN half (full suite + coverage) runs after
  Step 2, as the step specifies; Step 1 verified its RED half.
