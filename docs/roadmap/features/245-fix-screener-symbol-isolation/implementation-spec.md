# Implementation Spec: fix-screener-symbol-isolation

**Status**: `pending`
**Created**: 2026-10-21
**Feature**: `docs/roadmap/features/245-fix-screener-symbol-isolation/feature.md`
**Total Steps**: 9
**Feature Branch**: `feature/fix-screener-symbol-isolation`

---

## Execution Summary

The work follows design.md items 1-8, in that numbering. It runs in three parts, one per service.
1. **Analysis (Steps 1-3).** Step 1 lands the AC-2/AC-3 preservation guards first, so they are proven
   green on the unfixed tree. Step 2 is the engine change (items 1-3). Step 3 holds the AC-1 regression
   outline and the FR-2/sort/duplicate/span tests, RED against the pre-Step-2 tree.
2. **Agent (Steps 4-6).** The `screen_symbols` row shape (item 4): client, docstring, test, then the
   C-10 runbook parity.
3. **UI (Steps 7-8).** The `SymbolScreening` "Not evaluated" branch (item 6) and its Playwright test.

Step 9 closes the docs and memory obligations (item 8).

There is no proto change: `ScreenResult.score_unavailable = 14` is reused (`packages/proto/analysis/v1/analysis.proto:529`).
There is no migration (analysis last is `027_contract_owner_dimension`, unused), no config key and no env
var or port. The orchestrator owns the feature-250 alerting handoff (item 5), as a completion-time write
outside this spec's step PRs (see § Completion obligations).

This session applied the product-spec and acceptance amendments that design.md § Open Risks owed before
step planning (C-15, append-only IDs):
- AC-1 is reworded (EXTEND, ID kept): the row "is present", the 49-run oracle is pinned, and one summary
  log line names BAD.
- `@AC-4 @FR-4` and `@AC-5 @FR-1` are appended.
- product-spec gains FR-4, the FR-1 pin, `xstockstrat-agent` and `xstockstrat-ui` under Affected
  Services, and a resolved Consumer Surface(s) paragraph.

### Scenario Coverage (C-15)

| Scenario | Covered by |
|---|---|
| @AC-1 (3 Examples) | Step 3 |
| @AC-2 | Step 1 (servicer deadline), Step 3 (engine-level `CancelledError` passthrough, FR-2) |
| @AC-3 | Step 1 |
| @AC-4 | Step 8 |
| @AC-5 | Step 5 |

### Consumer surfaces (C-14)

| Surface | Step |
|---|---|
| Agent `screen_symbols` | Steps 4-6 |
| UI `/trader/positions/[symbol]` Screening | Steps 7-8 |
| UI `/insights/screener` | Step 7 (tooltip copy only). It already renders `scoreUnavailable` (`services/xstockstrat-ui/src/app/insights/screener/page.tsx:184`, `:258`) and polls on INSUFFICIENT_DATA only (`:122`, `:128`) |
| Alerting | Named follow-up feature 250 `fix-otel-metrics-logs-gap` (design.md item 5) |

### Business rules (C-16)

- PRESERVE, guarded by Steps 2-3:
  - feature 160 AC-1/AC-2 (`services/xstockstrat-analysis/acceptance/fix-signal-screen-crash.feature:6`,
    `:14`), via `test_signal_weighted_screen_returns_ok_not_crash` `tests/test_screener.py:572`, which stays
    green;
  - feature 224 AC-29 (`private-by-default-templates.feature:42`).
- EXTEND this feature's AC-1; new AC-4 and AC-5.
- No CHANGE.

## Step Dependencies

- Step 1 runs before Step 2 so its AC-2/AC-3 tests are proven green on the unfixed tree. It is a
  preservation guard (product-spec § Acceptance Criteria: "the `/sdd-spec` TDD gate demands no failing
  test for them").
- Step 3 [test] covers Step 2 [service]. Its RED run is against the tree before Step 2.
- Step 3's mutation runs need Step 2's `_eval_symbol_isolated` to exist.
- Step 5 [test] covers Step 4 [service]. Its RED run is against the tree before Step 4.
- Step 6 follows Step 4 so the runbook mirrors the final docstring (C-10).
- Step 8 [test] covers Step 7 [service]. Its RED run is against the tree before Step 7.
- Steps 4-8 do not depend on Steps 1-3 at the code level, because the agent and UI read existing proto
  field 14. They follow Step 2 so the documented row kinds match the shipped engine.
- Step 9 runs last: it resolves the findings row only once the fix and its tests are green.
- Cross-feature (shared analysis dir; recon.md § Risks "Overlap"):
  - Feature 246 (`fix-fundsignal-neutral-score`, status `draft`) edits
    `services/xstockstrat-analysis/app/engine/fundsignal_loop.py`, not `scoring.compute_signal_score`
    (`app/services/scoring.py`), so it does not touch the AC-1 failure site.
  - Feature 244 (`fix-python-config-zero-trap`) wraps `analysis.screener.max_duration_seconds` in an
    `int_positive` clamp. Step 1's AC-2 test stubs `get_int` to return `1`, which a positive clamp passes
    unchanged, so the test survives either merge order.

---

### Step 1 — test: AC-2 deadline and AC-3 validation preservation guards (servicer)

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/tests/test_analysis_servicer.py` — modify

**Reviewers**: `xstockstrat-analysis` owner — Backtest reproducibility, strategy scoring determinism, no look-ahead bias

**Codebase Evidence**:
- `class TestScreenSymbols` `tests/test_analysis_servicer.py:1095`. Helpers:
  - `_ctx` `:1097`;
  - `_svc` `:1109`, which stubs `svc._cfg.get_int = MagicMock(side_effect=lambda key, default=0: default)`
    at `:1112`;
  - `_bars` `:1126`.
- AC-3 template: `test_unknown_metric_aborts_invalid_argument` `:1265`. It uses one symbol `AAA` and metric
  `pe_ration`, sets `ctx.abort = AsyncMock(side_effect=Exception("aborted"))`, and asserts
  `ctx.abort.await_args.args[0].name == "INVALID_ARGUMENT"`.
- Servicer path under guard, in `app/handlers/servicer.py`:
  - `deadline = self._cfg.get_int("analysis.screener.max_duration_seconds", 120)` `:3786`;
  - `asyncio.wait_for(engine.screen(...), timeout=deadline)` `:3787-3790`;
  - `except TimeoutError` → `DEADLINE_EXCEEDED`, `f"screen exceeded {deadline}s deadline"` `:3791-3795`;
  - `except ValueError` → `INVALID_ARGUMENT` `:3797-3800`.
- The pre-fan-out validation call `_validate_fundamental_metrics` is at
  `app/services/screener.py:110` (def `:377`).
- recon.md § Not found: no existing scan-deadline test. `max_duration_seconds` appears only as the
  `make_cfg` default at `tests/test_screener.py:23`.

**TDD**: `N/A (preservation guard — green on the unfixed tree and after Step 2; product-spec § Acceptance Criteria)`

**Covers**: `AC-2, AC-3`

**Instructions**:
1. Add `async def test_scan_deadline_aborts_deadline_exceeded(self)` to `TestScreenSymbols`, marked
   `@pytest.mark.asyncio` like `:1264`. Covers @AC-2.
   - `svc = self._svc()`, then override
     `svc._cfg.get_int = MagicMock(side_effect=lambda key, default=0: 1 if key == "analysis.screener.max_duration_seconds" else default)`.
   - Build 50 symbols `S00`..`S49`.
   - Give `svc._marketdata.GetBars` an `AsyncMock` side_effect. For `S00` it does
     `await asyncio.Event().wait()` (never returns). For every other symbol it returns `self._bars([1.0, 2.0, 3.0])`.
   - Use a single `SCREEN_KIND_TECHNICAL_INDICATOR` criterion (`component=StrategyComponent(indicator="RSI")`)
     so `_eval_symbol` reaches GetBars.
   - Set `ctx.abort = AsyncMock(side_effect=Exception("aborted"))` and `with pytest.raises(Exception, match="aborted")`.
   - Assert `ctx.abort.await_args.args == (grpc.StatusCode.DEADLINE_EXCEEDED, "screen exceeded 1s deadline")`.
     `pytest.raises` already shows no response, and so no rows, was returned.
   - No timeout marker: `pytest-timeout` is absent from `pyproject.toml` (grep `timeout` → **Not found**).
     The real wait is ~1s (design.md Open Risk "AC-2 servicer test ~1s").
2. Add `async def test_unknown_metric_two_symbols_aborts_invalid_argument(self)`, modelled on `:1265`.
   Covers @AC-3.
   - `symbols=["AAPL", "MSFT"]`.
   - `GetFundamentalsMulti` returns
     `marketdata_pb2.Fundamentals(symbol="AAPL", pe_ratio=15.0)` and the same for `MSFT`. Neither has an
     `extra_metrics` key `not_a_metric`.
   - One `SCREEN_KIND_FUNDAMENTAL` criterion with `metric_name="not_a_metric"`.
   - Assert the abort code name is `INVALID_ARGUMENT`.
   - Leave `:1265` untouched.
3. C-13: the symbol lists and fundamentals literals have one consumer each (these tests), so they stay
   inline. No conftest move.

**Verification**:
```bash
cd services/xstockstrat-analysis && uv run pytest tests/test_analysis_servicer.py -q -k "scan_deadline_aborts_deadline_exceeded or unknown_metric_two_symbols or unknown_metric_aborts_invalid_argument"
# expect 3 passed on the UNFIXED tree (preservation proof), recorded in context.md
uv run pytest --cov=app --cov-fail-under=40 && uv run ruff check . && uv run ruff format --check .
grep -n "conftest" tests/test_analysis_servicer.py | head -3   # C-13: no new conftest consumer introduced
```

---

### Step 2 — service: per-symbol isolation, fail-closed degraded row, sort, summary log and span (engine)

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/app/services/screener.py` — modify

**Reviewers**: `xstockstrat-analysis` owner — Backtest reproducibility, strategy scoring determinism, no look-ahead bias

**Codebase Evidence**:
- Imports `screener.py:23-35`: `asyncio`, `logging`, `grpc`, gen stubs, `MessageToDict`, `Struct`, `scoring`.
  There is no `opentelemetry` import yet. Module logger `log = logging.getLogger(__name__)` `:37`.
- `screen()` `:91`. `symbols = list(request.symbols)[:max_universe]` `:93`; it does not dedupe (design.md
  item 2). Validation `_validate_fundamental_metrics(...)` `:110` runs before the fan-out.
- Fan-out `per_symbol = await asyncio.gather(*[self._eval_symbol(symbol, request, criteria, fundamentals, fundamentals_available, propagation_meta) for symbol in symbols])`
  `:115-127`. There is no `return_exceptions`.
- Summary WARN block `dataless_bars` `:131-145`, with message
  `"screener: %d/%d scanned symbols had insufficient 1d bars ..."`. The no-double-report comment is at
  `:129-130`.
- `_rank()` `:149-153`:
  `norm = self._normalize_universe(criteria, per_symbol)`;
  `built = [self._build_result(row, criteria, request, norm) for row in per_symbol]`;
  `built.sort(key=lambda r: (r.score_unavailable, -r.score))`.
  It is dispatched via `run_in_executor` / `asyncio.to_thread` `:155-160`.
- `coverage_gaps` `:164-168`, `min_conviction` `:172-174`, `rank_limit` `:177-181`.
- `_eval_symbol` def `:204-206`. Row seed dict `:207-216`:
  `symbol`, `raws {}`, `passes {}`, `signal_score 0.5`, `status SCREEN_RESULT_STATUS_OK`, `gap None`,
  `bars_errored False`. The `# True when GetBars raised ...` comment is at `:214`.
- `_build_result` `:439`:
  - INSUFFICIENT_DATA early return `:440-448`;
  - `passed = True` `:457`;
  - `score_unavailable = weight_total <= 0 and len(criteria) > 0` `:479`;
  - final `ScreenResult(... status=OK, score_unavailable=..., pe=row.get("pe", 0.0), ...)` `:493-507`.
- OTel API is available through `opentelemetry-sdk>=1.25.0` (`services/xstockstrat-analysis/pyproject.toml:15`).
  Package-level import precedent: `from opentelemetry import metrics` at `app/engine/live_loop.py:36`.
  `app/telemetry.py:33` imports `trace` lazily inside init. Nothing under `app/` calls `get_current_span` yet.
- `CancelledError` is a `BaseException` on Python 3.13, so `except Exception` does not catch it
  (recon.md § Patterns to REUSE, Cancellation semantics).

**TDD**: `red-green required`

**Covers**: —

**Instructions** (design.md items 1-3; keep their numbering in comments, PR body and Deviation Log):
1. **Item 1, the seed.** Extract the dict literal at `:207-216` into
   `@staticmethod def _seed_row(symbol) -> dict`, keeping every existing key, value and the
   `bars_errored` comment. Add one key, `"eval_failed": False`. Replace the literal in `_eval_symbol`
   with `row = self._seed_row(symbol)`.
2. **Item 1, the wrapper.** Add `async def _eval_symbol_isolated(self, symbol, *args)`. In a `try`, it
   returns `(await self._eval_symbol(symbol, *args)), None`. Its `except Exception as e:` returns
   `({**self._seed_row(symbol), "eval_failed": True}, e)`.
   - Never catch `BaseException`, so `CancelledError` passes through (FR-2).
   - Never store the exception on the row.
   - Add a 1-2 line constraint comment only: "`except Exception` (not BaseException): CancelledError
     from the scan deadline must propagate (FR-2)".
3. **Item 1, the gather.** At `:115-127`, call `self._eval_symbol_isolated(...)` with the same
   positional args. Then:
   - `pairs = await asyncio.gather(...)`;
   - `per_symbol = [row for row, _ in pairs]`;
   - `failures = [(row["symbol"], e) for row, e in pairs if e is not None]`.

   Validation at `:110` stays outside and before the fan-out (FR-3).
4. **Item 2, the result.** In `_build_result`, directly after the INSUFFICIENT_DATA return `:440-448`, add
   `if row["eval_failed"]: return analysis_pb2.ScreenResult(symbol=row["symbol"], status=analysis_pb2.SCREEN_RESULT_STATUS_OK, passed=False, score_unavailable=True)`.
   - Read the flag by subscript `row["eval_failed"]`, never `.get(..., False)` (design.md item 1).
   - The branch must come before `passed = True` `:457`, the `bef4258` scar.
5. **Item 2, the sort.** Rewrite `_rank()` `:149-153`:
   - `norm = self._normalize_universe(criteria, per_symbol)`;
   - `pairs = [(self._build_result(row, criteria, request, norm), row["eval_failed"]) for row in per_symbol]`;
   - `pairs.sort(key=lambda p: (p[0].score_unavailable, p[1], -p[0].score))`;
   - `return [r for r, _ in pairs]`.

   Name the local so it does not shadow the outer `pairs` from instruction 3 (e.g. `ranked`). Leave the
   executor dispatch `:155-160` unchanged.
6. **Item 3, logging and span.** Add a top-level `from opentelemetry import trace` to the import block.
   Directly after the `dataless_bars` block (`:131-145`), add an `if failures:` block, still on the event
   loop and before `_rank` dispatch:
   - `emit = log.error if len(failures) == len(per_symbol) else log.warning`;
   - `emit("screener: %d/%d scanned symbols failed evaluation; sample=%s", len(failures), len(per_symbol), [f"{s}:{type(e).__name__}" for s, e in failures][:10], exc_info=failures[0][1])`;
   - `span = trace.get_current_span(); span.set_attribute("screener.degraded_count", len(failures)); span.record_exception(failures[0][1])`.

   No `set_status`. No per-symbol WARN (the `:129-130` invariant).
7. Do not touch `servicer.py` (`:3786-3800` stays as is), `_normalize_universe`, `coverage_gaps`,
   `min_conviction` or `rank_limit`. Degraded rows keep `status OK`, `gap None` and
   `bars_errored False`, so they stay out of `dataless_bars` and `coverage_gaps` (design.md item 2).

**Verification**:
```bash
cd services/xstockstrat-analysis && grep -n "_eval_symbol_isolated\|_seed_row\|\"eval_failed\"\|screener.degraded_count\|from opentelemetry import trace" app/services/screener.py
grep -n 'eval_failed", False)' app/services/screener.py   # expect no output (no .get fallback)
grep -n "except BaseException" app/services/screener.py   # expect no output
uv run ruff check . && uv run ruff format --check .
```
The green run is Step 3's Verification.

---

### Step 3 — test: AC-1 outline, FR-2 cancel passthrough, fail-closed, sort tie, duplicate symbol, span attribute (engine)

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/tests/test_screener.py` — modify

**Reviewers**: `xstockstrat-analysis` owner — Backtest reproducibility, strategy scoring determinism, no look-ahead bias

**Codebase Evidence**:
- Helpers in `tests/test_screener.py`: `make_cfg` `:19`, `bars` `:33`, `formula_resp` `:37`,
  `formula_criterion` `:43`, `make_engine` `:55`, `_timed_bar` `:566`. `asyncio_mode = "auto"` is set at
  `pyproject.toml:32`.
- Signal-weighted template: `test_signal_weighted_screen_returns_ok_not_crash` `:572-618`.
  - It builds `_timed_bar`s with `.time`.
  - Its `ingest_pb2.ExternalSignal(source="fundamentals", direction="buy", conviction=0.8)` has
    `valid_from`/`valid_until` straddling the last bar.
  - It uses `ind.ComputeIndicator = AsyncMock(return_value=SimpleNamespace(result=[]))`.
- RED fixture discipline (ledger `docs/roadmap/ledger/insights.md:2489-2495`, feature 160): use >=2 bars
  with `.time` and an in-window signal. Without them `_eval_symbol` short-circuits to INSUFFICIENT_DATA
  (`screener.py:233-242`) before `:256`.
- Failure sites:
  - `scoring.compute_signal_score(signals_map, latest_bar, list(request.signal_sources), self._source_weights)`
    `screener.py:256-258`. It has no symbol arg, so BAD is told apart by its distinct last-bar close or its
    signal conviction.
  - `_technical_value(self, criterion, symbol, closes, propagation_meta)` `:331`. It has a symbol arg.
    Indicator path `:357-373`: `vals = [p.value for p in resp.result if p.value != 0]` `:372`.
  - `_latest_indicator(self, indicator, closes, propagation_meta)` `:288`. It has no symbol arg, so BAD is
    told apart by its closes. It is called for RSI and ATR at `:284-285`, after the criteria loop
    `:262-277`.
- Criterion order matters for partial raws: `sig` (SIGNAL, `raw = row["signal_score"]` `:271-272`) is set
  at `:276` before `rsi` reaches `_technical_value`.
- Guards that must stay green:
  - seed-key tests `:129`, `:153`, `:183`, `:215`, `:335`;
  - concurrency tests `:625`, `:661`;
  - FR-3 at engine level `:468`;
  - feature 160 `:572` (design.md item 7).
- Feature-144 tie source: `combine_score` returns
  `technical_weight * (tech_signal * 0.5 + 0.5) + signal_weight * signal_score` when signals are present
  (`app/services/scoring.py:57-58`). With `technical_weight=0` and a sell-only signal
  (`compute_signal_score` → 0.0) a score-unavailable row lands at exactly 0.0.
- In-memory exporter: `opentelemetry.sdk.trace.export.in_memory_span_exporter.InMemorySpanExporter`
  ships with `opentelemetry-sdk` (`pyproject.toml:15`). There is no existing span test under `tests/`
  (grep `InMemorySpanExporter` → **Not found**).

**TDD**: `red-green required`

**Covers**: `AC-1` (all three Examples), `AC-2` (engine-level FR-2 passthrough)

**Instructions**:
1. Add a module-local builder `_isolation_fixture(symbols, bad="BAD")`, single consumer, so it stays inline
   under C-13. It returns `(md, ind, ingest, req)`:
   - **Keying.** Every per-symbol value is keyed by symbol name (`i` parsed from `S{i:02d}`), never by list
     position, so the 49- and 50-symbol runs feed each shared symbol identical data.
   - **Bars.** `md.GetBars` has a side_effect keyed on `req.symbol`. Each symbol gets 3 `_timed_bar`s with
     distinct closes (`base = 10.0 + i`, closes `[base, base + 1, base + 2]`). BAD's closes carry the
     sentinel close `999.0` on the last bar.
   - **Indicators.** `ind.ComputeIndicator` has a side_effect returning
     `SimpleNamespace(result=[SimpleNamespace(value=req.values[-1] / 10.0)])`. This gives distinct RSI
     readings and non-zero values (`:302`, `:372`).
   - **Signals.** `ingest.QuerySignals` has a side_effect returning one in-window `fundamentals` buy
     signal per symbol, conviction `0.1 + 0.01 * i`. BAD gets conviction `0.95`, the highest.
   - **Request.** `req = ScreenSymbolsRequest(symbols=symbols, criteria=[sig, rsi], signal_sources=["fundamentals"], signal_weight=1.0, technical_weight=1.0, rank_limit=50)`.
     `sig` is `ScreenCriterion(ref_name="sig", kind=SCREEN_KIND_SIGNAL, op=COMPARATOR_GT, threshold=0.0)`.
     `rsi` is `ScreenCriterion(ref_name="rsi", kind=SCREEN_KIND_TECHNICAL_INDICATOR, component=StrategyComponent(indicator="RSI"), op=COMPARATOR_GT, threshold=0.0)`.
     Neither has `hard_filter`.
2. Add `@pytest.mark.parametrize` `test_one_symbol_failure_degrades_only_its_row(caplog, monkeypatch, site, exc)`.
   Covers @AC-1, with the three Examples as rows:
   - `("compute_signal_score", ZeroDivisionError)`: monkeypatch
     `app.services.screener.scoring.compute_signal_score` with a wrapper that raises when
     `latest_bar.close == 999.0` and otherwise delegates to the original.
   - `("_technical_value", ArithmeticError)`: monkeypatch `ScreenerEngine._technical_value` with an async
     wrapper that raises when `symbol == "BAD"`. This is Example 2's ordering: `sig` raw is already set.
   - `("_latest_indicator", ValueError)`: monkeypatch `ScreenerEngine._latest_indicator` with an async
     wrapper that raises when `closes and closes[-1] == 999.0`. It runs after both raws (`:284`).

   Body:
   - **Oracle.** `others = [f"S{i:02d}" for i in range(49)]`. Run `baseline = await make_engine(...).screen(req_49)`
     over `others` with the same fixtures and no patch. Then run `resp = await engine.screen(req_50)` over
     `others + ["BAD"]` with the patch active. Use a fresh engine per run.
   - **Rows.** Assert `{r.symbol: r for r in resp.results if r.symbol != "BAD"} == {r.symbol: r for r in baseline.results}`.
     ScreenResult equality is the pinned oracle; a kept partial raw for BAD would shift the min-max-normalised
     `criterion_scores` and `score`.
   - **BAD's row.** `bad = next(r for r in resp.results if r.symbol == "BAD")`. Assert it is present,
     `bad.status == SCREEN_RESULT_STATUS_OK`, `bad.passed is False`, `bad.score_unavailable is True`,
     `dict(bad.criterion_scores) == {}`.
   - **Ranking.** `resp.results[-1].symbol == "BAD"` and `len(resp.results) == 50`.
   - **Log.** `recs = [r for r in caplog.records if r.levelno == logging.WARNING and "BAD" in r.getMessage()]`.
     Assert `len(recs) == 1` and `f"BAD:{exc.__name__}" in recs[0].getMessage()`.
   - **RED before Step 2:** `screen()` raises `exc` out of `gather`, so every row fails.
3. Add `test_cancelled_error_in_symbol_eval_propagates(monkeypatch)` (FR-2, @AC-2 engine-level).
   - Use a 2-symbol universe.
   - Monkeypatch `ScreenerEngine._eval_symbol` so it raises `asyncio.CancelledError` for one symbol and
     returns `ScreenerEngine._seed_row(symbol)` for the other.
   - Assert `with pytest.raises(asyncio.CancelledError): await engine.screen(req)`.
   - On today's tree this passes. It is the guard that the Step 2 wrapper keeps cancel transparent, and
     its teeth are the mutation run in instruction 8.
4. Add `test_degraded_row_soft_only_criteria_is_not_passed(monkeypatch)`.
   - All criteria are soft (`hard_filter=False`): one `formula_criterion("f1", "fid", COMPARATOR_GT, 0.0)`.
     There is no signal blend.
   - `_technical_value` raises `RuntimeError` for `BAD`.
   - Assert BAD's `passed is False` and `score_unavailable is True`. This guards against the default
     `passed = True` `:457`.
   - RED before Step 2: `screen()` raises.
5. Add `test_degraded_row_sorts_after_feature144_zero_score_row(monkeypatch)`.
   - Universe `["GOOD", "NODATA", "BAD"]` with `technical_weight=0.0`, `signal_weight=1.0` and
     `signal_sources=["fundamentals"]`.
   - NODATA gets a sell-only in-window signal and a fundamental criterion with its metric missing
     (`marketdata_pb2.Fundamentals(symbol="NODATA", missing_metrics=["pe_ratio"])`, pattern
     `test_screener.py:335-385`), so it is `score_unavailable=True` at score 0.0.
   - BAD raises in `compute_signal_score`.
   - Assert the order `[GOOD, NODATA, BAD]` and `resp.results[1].score == pytest.approx(0.0)`.
   - RED before Step 2: it raises. The design rejected relying on a score of 0.0 for this ordering.
6. Add `test_duplicate_symbol_healthy_copy_ranks_by_score(monkeypatch)`.
   - Universe `["AAA", "DUP", "DUP"]`. Only the first `_eval_symbol("DUP", ...)` call raises (use a
     closure counter); the second returns normally.
   - Assert exactly one DUP row has `score_unavailable is True` and sits last. Assert the healthy DUP row
     has `score_unavailable is False` and sorts with AAA by `-score`.
   - RED before Step 2: it raises.
7. Add `test_degraded_count_lands_on_current_span(monkeypatch)`. This is design.md Open Risk "span
   attribute landing".
   - Build a local `TracerProvider()` (do not set it globally) with
     `SimpleSpanProcessor(InMemorySpanExporter())`.
   - `with provider.get_tracer("t").start_as_current_span("server"):
     await asyncio.wait_for(engine.screen(req), timeout=5)`. BAD raises.
   - Assert the finished `server` span has `attributes["screener.degraded_count"] == 1` and one
     `exception` event.
   - RED before Step 2: it raises.
8. **Mutations** (design.md item 7, Open Risk "FR-2/AC-2 teeth"). After green, apply each mutation in a
   scratch edit, run the listed tests, record which go red in `context.md`, then revert. They are
   recorded, not committed.
   - (a) The `_eval_symbol_isolated` catch becomes `except BaseException`. Run
     `test_cancelled_error_in_symbol_eval_propagates` (expect red) and Step 1's
     `test_scan_deadline_aborts_deadline_exceeded` (expected to stay green, because CPython 3.13 gather
     `_cancel_requested`; record what actually happens).
   - (b) In `servicer.py` `ScreenSymbols`, wrap `engine.screen(...)` in a coroutine that catches
     `asyncio.CancelledError` and returns `ScreenSymbolsResponse()`. Run
     `test_scan_deadline_aborts_deadline_exceeded` (expect red).
9. C-13: `_isolation_fixture` has one consumer (this file), so it stays inline. Record this verdict.
10. Full-suite run (design.md Open Risk "Recon grepped 28 analysis suites by keyword only"). Any existing
    test that asserted a whole-RPC failure on a per-symbol exception and now flips gets a Deviation Log
    entry, not a silent edit.

**Verification**:
```bash
cd services/xstockstrat-analysis && uv run pytest tests/test_screener.py -q
# RED (pre-Step-2 tree): AC-1 x3, soft-only, sort-tie, duplicate, span tests fail; cancel test passes
# GREEN (post-Step-2): all pass, incl. :129 :153 :183 :215 :335 :468 :572 :625 :661
uv run pytest --cov=app --cov-fail-under=40 && uv run ruff check . && uv run ruff format --check .
grep -n "def _isolation_fixture\|from .conftest\|conftest" tests/test_screener.py   # C-13: one inline definition
```

---

### Step 4 — service: agent `screen_symbols` forwards `score_unavailable`; docstring describes the row kinds

**Status**: `pending`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/app/client.py` — modify
- `services/xstockstrat-agent/app/tools.py` — modify

**Reviewers**: `xstockstrat-agent` owner — MCP tool contract stability (name, parameters, return shape) and `docs/runbooks/mcp-tools.md` parity

**Codebase Evidence**:
- Result projection `services/xstockstrat-agent/app/client.py:758-767`. The dict is `"symbol"`, `"score"`,
  `"criterion_scores": dict(r.criterion_scores)`, `"passed"`,
  `"status": analysis_pb2.ScreenResultStatus.Name(r.status)` (`:760-766`). It has no `score_unavailable`.
- Docstring `app/tools.py:821-846`:
  - `min_conviction` sentence `:833-835`;
  - `rank_limit` `:836`;
  - Returns `:837-838`;
  - the false sentence "it is never reported OK/passed just because a criterion had no data" `:845-846`;
  - "Filter candidates on `passed`." `:846`.
- Proto field `bool score_unavailable = 14;` is at `packages/proto/analysis/v1/analysis.proto:529`.
  Generated Python attr `r.score_unavailable` (the generated stubs are not read, per root CLAUDE.md).
- Tool-name inventory `tests/test_tools_endpoint.py:28-60` asserts names only, so a docstring edit does
  not touch it.

**TDD**: `red-green required`

**Covers**: —

**Instructions** (design.md item 4):
1. `client.py`: add `"score_unavailable": r.score_unavailable,` to the per-result dict at `:760-766`,
   after `"passed"`.
2. `tools.py` docstring, one edit:
   - (a) The Returns list gains `"score_unavailable" (bool)`.
   - (b) Delete the clause "it is never reported OK/passed just because a criterion had no data"
     (`:845-846`).
   - (c) Add the three `score_unavailable=true` row kinds:
     - evaluation fault: status OK, `passed=false`;
     - data-less hard-filter row: `passed=false`;
     - data-less soft-only row (feature 144): `passed=true`.

     `score_unavailable=true` means there is no comparable score and the row is unranked. With
     `passed=false` the symbol was not evaluated, which is different from a failed screen.
   - (d) Keep "Filter candidates on `passed`."
   - (e) Amend `min_conviction` and `rank_limit`: un-evaluated rows (score 0.0) are also removed by
     `min_conviction > 0` and may be cut by `rank_limit` (`services/xstockstrat-analysis/app/services/screener.py:172-181`).
     The server log is then their only trace.
3. Parameters and tool name are unchanged. This is an additive return key only.

**Verification**:
```bash
cd services/xstockstrat-agent && grep -n '"score_unavailable": r.score_unavailable' app/client.py
grep -n "never reported OK/passed" app/tools.py   # expect no output
grep -n "Filter candidates on \`passed\`" app/tools.py   # expect 1 hit
uv run ruff check . && uv run ruff format --check .
```
The green run is Step 5's Verification.

---

### Step 5 — test: agent row shape carries `score_unavailable` (AC-5)

**Status**: `pending`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/tests/test_client.py` — modify

**Reviewers**: `xstockstrat-agent` owner — MCP tool contract stability (name, parameters, return shape) and `docs/runbooks/mcp-tools.md` parity

**Codebase Evidence**:
- `class TestScreenSymbolsClient` `tests/test_client.py:215`; `test_screen_symbols_sends_grpc_call` `:217`.
  Its response holds one `ScreenResult(symbol="NVDA", score=0.91, criterion_scores={"pe": 1.0}, passed=True, status=SCREEN_RESULT_STATUS_OK)`
  (`:221-229`).
- Exact-equality assert `assert result["results"][0] == {...}` `:277-283`.
- Agent CI threshold is 40% (`.github/workflows/ci.yml:358-359`).

**TDD**: `red-green required`

**Covers**: `AC-5`

**Instructions**:
1. In `test_screen_symbols_sends_grpc_call`, append a second result to the mocked response:
   `analysis_pb2.ScreenResult(symbol="BAD", passed=False, status=analysis_pb2.SCREEN_RESULT_STATUS_OK, score_unavailable=True)`.
2. Add `"score_unavailable": False` to the NVDA exact-equality dict at `:277-283`.
3. Add assertions:
   - `result["results"][1]["symbol"] == "BAD"`;
   - `result["results"][1]["passed"] is False`;
   - `result["results"][1]["score_unavailable"] is True`;
   - `all(isinstance(r["score_unavailable"], bool) for r in result["results"])`.
4. RED before Step 4: a `KeyError` on `"score_unavailable"`, and the equality dict mismatches.
5. C-13: the BAD `ScreenResult` literal has one consumer, so it stays inline.

**Verification**:
```bash
cd services/xstockstrat-agent && uv run pytest tests/test_client.py -q -k screen_symbols
uv run pytest --cov=app --cov-fail-under=40 && uv run ruff check . && uv run ruff format --check .
grep -n "__tests__/fixtures\|conftest" tests/test_client.py | head -3   # C-13: no second inline copy
```

---

### Step 6 — docs: `docs/runbooks/mcp-tools.md` `screen_symbols` parity (C-10)

**Status**: `pending`
**Service**: `docs/runbooks/`
**Files**:
- `docs/runbooks/mcp-tools.md` — modify

**Reviewers**: none

**Codebase Evidence**:
- `screen_symbols` section in `docs/runbooks/mcp-tools.md`:
  - Return JSON block `:444-452`, with the result object at `:449`;
  - status aside `:455`;
  - Errors table `:457-464`.
- The reviewer registry requires `docs/runbooks/mcp-tools.md` parity for the agent (`docs/runbooks/reviewer-registry.md`, `xstockstrat-agent` row).

**TDD**: `N/A (docs)`

**Covers**: —

**Instructions** (design.md item 4, runbook bullet):
1. Return JSON `:449`: add `"score_unavailable": false` to the NVDA object.
2. Aside `:455`: add the three `score_unavailable=true` row kinds, worded as in Step 4. Keep "filter on
   `passed`". Add the `min_conviction > 0` / `rank_limit` caveat for un-evaluated rows.
3. Errors table `:457-464`: add a row. Condition: "A per-symbol evaluation fault (non-RPC exception for
   one symbol)". Error: "No call error; that symbol returns `status OK`, `passed: false`,
   `score_unavailable: true` (the rest of the scan completes)".

**Verification**:
```bash
grep -n "score_unavailable" docs/runbooks/mcp-tools.md   # expect hits in Return JSON, aside, Errors table
grep -n "evaluation fault" docs/runbooks/mcp-tools.md services/xstockstrat-agent/app/tools.py   # both describe it
```

---

### Step 7 — service: `SymbolScreening` "Not evaluated" branch; screener tooltip copy (UI)

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/components/trader/SymbolScreening.tsx` — modify
- `services/xstockstrat-ui/src/app/insights/screener/page.tsx` — modify

**Reviewers**: `xstockstrat-ui` owner — Trading UI correctness, analytics display accuracy, Connect-RPC call safety

**Codebase Evidence**:
- `SymbolScreening.tsx`:
  - `const result = screen.data?.results?.[0];` `:63`;
  - `const insufficient = result?.status === ScreenResultStatus.INSUFFICIENT_DATA;` `:64`;
  - the render branch `{result && !screen.isPending && (insufficient ? (<div data-testid="symbol-screen-insufficient" ...>) : (<DataTable ... tableTestId="symbol-screen-results" />))}`
    `:234-257`.
  - It never reads `scoreUnavailable` (recon.md § Dependencies).
- Shared primitive `src/components/shared/EmptyState.tsx` (`{title, description?, action?}`) carries a
  fixed `data-testid="empty-state"`. C-17 lists it as the canonical empty-state primitive
  (`docs/patterns/ui-ux-governance.md:120`). It is already imported on the host page
  `src/app/trader/positions/[symbol]/page.tsx:66`, hence the wrapper test id (design.md Open Risk
  "`EmptyState` test id collision").
- Screener tooltip `src/app/insights/screener/page.tsx:258-265` (`data-testid="no-criteria-data"` `:262`): `<Badge variant="warning" data-testid="no-criteria-data" title="None of this scan's criteria had usable data for this candidate — its score is not a real result.">`.

**TDD**: `red-green required`

**Covers**: —

**Instructions** (design.md item 6):
1. `SymbolScreening.tsx`: import `EmptyState` from `@/components/shared/EmptyState`. After `:64` add
   `const unevaluated = result?.scoreUnavailable === true;`.
2. Make the `:234-257` branch three-way: `insufficient` → existing block (unchanged); else `unevaluated`
   → the new block; else `<DataTable …>` (unchanged).
   - New block: `<div data-testid="symbol-screen-unevaluated"><EmptyState title="Not evaluated" description={...} /></div>`.
   - Description copy: `` `No screening criteria could be evaluated for ${symbol} — this is not a pass or a fail.` ``
   - INSUFFICIENT_DATA keeps priority, so a status-2 row never shows the new notice.
   - Tokens only: no hex or arbitrary colour utility (C-17). `EmptyState` brings its own classes.
3. `insights/screener/page.tsx:258-265`: change the `title` tooltip copy only, so it covers both
   causes. Suggested text: "No criteria data could be used for this candidate (missing data or an
   evaluation fault) — its score is not a real result." Keep `data-testid="no-criteria-data"`, the
   badge label and the logic.

**Verification**:
```bash
cd services/xstockstrat-ui && grep -n "symbol-screen-unevaluated\|scoreUnavailable === true\|components/shared/EmptyState" src/components/trader/SymbolScreening.tsx
grep -n 'data-testid="no-criteria-data"' src/app/insights/screener/page.tsx   # still 1 hit
pnpm run lint && pnpm run format:check && pnpm exec tsc --noEmit
```
The green run is Step 8's Verification.

---

### Step 8 — test: Playwright AC-4 on the position-detail Screening section; fixture catalog (UI)

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/e2e/trader/position-detail.spec.ts` — modify
- `services/xstockstrat-ui/e2e/fixtures/INVENTORY.md` — modify

**Reviewers**: `xstockstrat-ui` owner — Trading UI correctness, analytics display accuracy, Connect-RPC call safety

**Codebase Evidence**:
- Existing single-symbol Screening test: "a non-watchlisted symbol runs the single-symbol Screening section
  (FR-8)", `e2e/trader/position-detail.spec.ts:194-219`.
  - `addAuthCookie(page)`, then `page.goto('/trader/positions/AAPL')`.
  - `page.getByTestId('symbol-screening')`, `run-symbol-screen` click, `symbol-screen-results`.
  - The default mock returns no watchlists (`:198-199`).
- Per-page route precedent from `/trader` in the same spec:
  `page.route('**/xstockstrat.analysis.v1.AnalysisService/EvaluateReadiness', ...)` `:683`.
  The same ScreenSymbols glob is used by `e2e/insights/screener.spec.ts:95`. The glob matches regardless
  of BFF basePath, which closes design.md Open Risk "page.route glob".
- Fixture `noCriteriaDataRow(symbol)` `e2e/fixtures/screenResults.ts:68-70`
  (`{ symbol, score: 0.5, passed: false, status: 1, scoreUnavailable: true }`). It is imported via
  `'../fixtures/screenResults'` in `e2e/insights/screener.spec.ts:4-9`.
- The catalog row "Screener results (scenario rows)" is at `e2e/fixtures/INVENTORY.md:47`. Its consumer
  list names `e2e/trader/position-detail.spec.ts` for feature 125 only.
- Auth helper `addAuthCookie` is imported at `position-detail.spec.ts:2`.

**TDD**: `red-green required`

**Covers**: `AC-4`

**Instructions**:
1. Import `noCriteriaDataRow` from `'../fixtures/screenResults'` (C-12; no inline literal).
2. Add a test next to `:194`: `'a scoreUnavailable single-symbol result shows "Not evaluated" (bug fix, feature 245)'`.
   - `addAuthCookie(page)`.
   - `page.route('**/xstockstrat.analysis.v1.AnalysisService/ScreenSymbols', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ results: [noCriteriaDataRow('AAPL')], coverageGaps: [] }) }))`
     is registered before `page.goto('/trader/positions/AAPL')`.
   - Click `run-symbol-screen` inside `symbol-screening`.
   - Assert `screening.getByTestId('symbol-screen-unevaluated')` is visible and contains the text
     `Not evaluated`. Scope this to the wrapper, never the bare `empty-state` id.
   - Assert `screening.getByTestId('symbol-screen-results')` and
     `screening.getByTestId('symbol-screen-insufficient')` both `toHaveCount(0)`.
3. RED before Step 7: today the row falls through to `DataTable`, so `symbol-screen-unevaluated` is absent
   and `symbol-screen-results` is present.
4. `INVENTORY.md:47`: extend the consumer list with `e2e/trader/position-detail.spec.ts` (feature 245,
   `noCriteriaDataRow`, "Not evaluated"). There is no new fixture.

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm test:e2e e2e/trader/position-detail.spec.ts e2e/insights/screener.spec.ts
grep -n "from '../fixtures/screenResults'\|helpers/auth" e2e/trader/position-detail.spec.ts   # C-12 imports
grep -n "feature 245" e2e/fixtures/INVENTORY.md   # catalog consumer updated
pnpm run lint
```

---

### Step 9 — docs: resolve the findings row, constitution teardown, sibling defect reports

**Status**: `pending`
**Service**: `xstockstrat-analysis` docs, `docs/reports/`
**Files**:
- `services/xstockstrat-analysis/docs/context-constitution-findings.md` — modify
- `services/xstockstrat-analysis/docs/context-constitution.md` — modify
- `docs/reports/2026-10-21-analysis-readiness-gather-no-per-symbol-isolation-defect.md` — create
- `docs/reports/2026-10-21-analysis-readiness-gather-no-per-symbol-isolation-defect.status` — create
- `docs/reports/2026-10-21-analysis-opportunities-row-gather-no-per-symbol-isolation-defect.md` — create
- `docs/reports/2026-10-21-analysis-opportunities-row-gather-no-per-symbol-isolation-defect.status` — create

**Reviewers**: none

**Codebase Evidence**:
- Latent-bugs row "**`ScreenerEngine.screen()` has no per-symbol error isolation**" is at
  `services/xstockstrat-analysis/docs/context-constitution-findings.md:20`. Resolved-row precedent:
  `~~...~~ **RESOLVED (feature 174)**` at `:19`.
- `services/xstockstrat-analysis/docs/context-constitution.md:42` (feature 144) states the sort key
  `results.sort(key=lambda r: (r.score_unavailable, -r.score))`. That becomes stale after Step 2.
- Sibling un-isolated gathers in `services/xstockstrat-analysis/app/handlers/servicer.py`:
  - EvaluateReadiness `results = await asyncio.gather(*[_readiness_for(s) for s in request.symbols])` `:3983`;
  - opportunities `rows = [r for r in await asyncio.gather(*[_row_for(c) for c in selected]) if r is not None]`
    `:5776`. `_row_for` catches `grpc.RpcError` `:5693`. Feature 185's comment says
    `FormulaExecutionError` "is a formula bug, NOT a data outage, so it is left to propagate"
    (`:5694-5698`), and the report must quote that deliberate choice.
- Defect-report shape: `docs/reports/2026-10-19-analysis-screener-no-per-symbol-isolation-defect.md`
  (headers `**Recorded**`/`**Severity**`/`**Impact type**`/`**Environment**`/...). Its `.status`
  sidecar holds `triaged` + `ref:`. The sidecar format is in
  `.claude/skills/sdd-qa/reference/defect-filing.md` (docs/CLAUDE.md, `reports/` row).
- Teardown rule: root `CLAUDE.md` § Teardown. `.agents/context-forge.json` → `constitutionPath`
  `docs/context-constitution.md`.

**TDD**: `N/A (docs)`

**Covers**: —

**Instructions** (design.md item 8):
1. `context-constitution-findings.md:20`: strike the issue text and append
   `**RESOLVED (feature 245)**`. Name `_eval_symbol_isolated` (`except Exception`, so `CancelledError`
   passes) and the degraded row (`status OK`, `passed=false`, `score_unavailable=true`, empty raws),
   following the `:19` precedent.
2. `context-constitution.md:42`: update the stated sort key to
   `(score_unavailable, eval_failed, -score)` and add one clause: an evaluation-fault row sorts after a
   feature-144 row (feature 245). Add nothing else.
3. Write the two defect reports with `/sdd-qa defect`, which classifies severity. Each `.status` sidecar
   is `open`.
   - The readiness report cites `servicer.py:3983`.
   - The opportunities report cites `:5776` and `:5693`, and records feature 185's deliberate
     `FormulaExecutionError` propagation (`:5694-5698`). It also records the divergence that this feature
     isolates `Exception` for the screener only (design.md item 8).
4. Run `/context-constitution refresh` scoped to the files touched by Steps 2-9, and fix the grounded
   drift it reports. If the plugin is unavailable, re-read each touched context file against the code and
   record in the PR body both that the plugin was unavailable and the reconciliation done (root
   `CLAUDE.md` § Teardown; ledger `fails.md:670`).

**Verification**:
```bash
grep -n "RESOLVED (feature 245)" services/xstockstrat-analysis/docs/context-constitution-findings.md
grep -n "eval_failed" services/xstockstrat-analysis/docs/context-constitution.md
ls docs/reports/2026-10-21-analysis-*-gather-no-per-symbol-isolation-defect.{md,status}
grep -n "servicer.py:3983\|servicer.py:5776" docs/reports/2026-10-21-analysis-*-defect.md
```

---

## Completion obligations (outside step PRs)

- **Feature-250 alerting handoff** (design.md item 5, C-02/C-14). This is the orchestrator's
  completion-time write on `feature/fix-otel-metrics-logs-gap`, not in this feature's worktree.
  - Read 250's `context.md` on that branch immediately before appending.
  - Content: (1) if logs are exported, a log rule on the ERROR line "scanned symbols failed evaluation";
    (2) if the trace or span-metrics path is used, a TraceQL query or TraceQL-metrics rate on
    `{ span.screener.degraded_count > 0 }`.
- **C-16 promotion** at the integration PR: AC-1..AC-3 go to
  `services/xstockstrat-analysis/acceptance/`, AC-4 to the `xstockstrat-ui` suite and AC-5 to the
  `xstockstrat-agent` suite.
- **Dev smoke test** of `ScreenSymbols` after deploy (product-spec § Acceptance Criteria).

## Deviation Log

_Populated by /sdd-execute as implementation proceeds._
