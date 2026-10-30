# Implementation Spec: fix-analysis-backtest-bounds

**Status**: `pending`
**Created**: 2026-10-22
**Feature**: `docs/roadmap/features/272-fix-analysis-backtest-bounds/feature.md`
**Total Steps**: 9
**Feature Branch**: `feature/fix-analysis-backtest-bounds`

---

## Execution Summary

This spec follows design.md § Chosen Approach and its build order. All code lands in one file,
`services/xstockstrat-analysis/app/handlers/servicer.py`, plus new and changed tests under
`services/xstockstrat-analysis/tests/`.

- **Steps 1–2 (D-28)** add the two-token re-serve guard to `_fetch_bars_paged`. A page with no fresh bars raises
  `_BarFetchError` only when a token was sent **and** the response re-issues a non-empty token (option (a), operator
  2026-10-22). A spec-time prototype of this guard against the full analysis suite (1272 tests, `-m 'not real_pg'`)
  turned exactly one test red: the bug-locking `test_identical_page_with_identical_token_terminates`. The "about
  102 truthy-MagicMock `GetBars`" risk from design is therefore retired. Step 2 still runs the full suite as its
  tripwire.
- **Steps 3–4 (R-1)** rename the `RunBacktest` body to `_run_backtest` behind a thin `@owner_scoped` wrapper.
  - The per-symbol loop re-raises `_BarFetchError`; today `except Exception` at `:1130-1132` skips the symbol.
  - The wrapper maps the error to `FAILED_PRECONDITION` `backtest bar series incomplete: …`. The benchmark path
    `:952-965` inherits this, moving from UNKNOWN to FAILED_PRECONDITION.
- **Steps 5–6 (D-29)** add the wall-clock bound.
  - The limit is read with `get_int_present("analysis.backtest.max_duration_seconds", 300)`: 0 means no limit; a
    negative value logs a WARN and uses 300.
  - `asyncio.timeout(limit or None)` wraps the body; a `TimeoutError` maps to `DEADLINE_EXCEEDED` only when
    `cm.expired()`.
  - A narrow `disarm` callable runs once, right before `self._backtests[backtest_id] = result` (`:1267`), so
    persistence always completes.
- **Steps 7–8** are the docs and consumer-surface rows: the analysis `CLAUDE.md` key row, the strat-lab skill,
  README and references (same PR, per `docs/patterns/strat-lab-plugin.md`), and the `docs/runbooks/mcp-tools.md`
  error table.
- **Step 9** is the G-1 launch-checklist gate: it measures prod and dev backtest durations against the
  first-enforced prod value of 120 s.

There is no proto change and no migration. The key is reused with name, type and seeded values unchanged (F-01).

### Scenario Coverage (C-15)

| Scenario | Covered by |
|---|---|
| `@AC-1` re-served page is a loud failure | Step 2 |
| `@AC-2` genuine EOF returns the full series | Step 2 |
| `@AC-3` RunBacktest enforces the wall-clock limit | Step 6 |
| `@AC-4` empty page on a token-bearing request raises | Step 2 |
| `@AC-5` stored 0 = no limit; negative = 300 + WARN | Step 6 |
| `@AC-6` `_BarFetchError` → FAILED_PRECONDITION, no persistence, benchmark included | Step 4 |
| `@AC-7` sent token + empty terminal page = EOF | Step 2 |

### Consumer Surfaces (C-14)

- **`/insights` backtest view and the symbol-page backtest.** No UI code change; this was decided at design and is
  restated here so it does not read as an omission. Both render `ConnectError.rawMessage` verbatim:
  - `services/xstockstrat-ui/src/app/insights/strategies/[id]/page.tsx:89-92`, rendered at `:484`;
  - `services/xstockstrat-ui/src/app/trader/positions/[symbol]/page.tsx:1141`.

  The new `DEADLINE_EXCEEDED` and `FAILED_PRECONDITION` messages therefore surface as-is.
- **Agent `run_backtest` tool.** No agent code change here. The `_grpc_error_message` pass-through
  (`services/xstockstrat-agent/app/tools.py:228-231`, I-2) is owned by the named follow-up feature
  **273-fix-agent-client-deadlines** (operator 2026-10-22); see Step Dependencies.
- **`strat-lab` plugin.** Step 8 updates it.
- **Operators (`/config-ui`, `set_config`).** No code change; the existing key simply gains a reader. Step 7
  documents its semantics, and Step 9 gates the prod value.

## Step Dependencies

- Step 2 [test] covers Step 1 [service]. Step 4 [test] covers Step 3 [service]. Step 6 [test] covers Step 5
  [service].
  - Each test step's RED assertions are authored to fail against the tree before its service step.
  - `/sdd-execute`'s TDD gate (`.claude/skills/sdd-execute/reference/tdd-gate.md`) captures the red run before the
    paired service step and the green run after it.
- Step 3 requires Step 1: AC-6 is triggered by the `_BarFetchError` that Step 1 starts raising on a re-served page.
- Step 5 requires Step 3: the deadline is added to the wrapper that Step 3 creates, and the `disarm` parameter is
  added to the `_run_backtest` signature that Step 3 introduces.
- Steps 7–8 require Steps 3 and 5: they document the exact pinned messages those steps produce.
- Step 9 requires Step 5 to be deployed on dev. It runs before the feature is marked `launch-ready`.
- **Merge order (C-10, operator 2026-10-22):** **273-fix-agent-client-deadlines merges before 272.**
  - 273 owns I-2, the `deadline_s is None → exc.details()` pass-through in `_grpc_error_message`.
  - I-1: any client deadline on `stub.RunBacktest` (`services/xstockstrat-agent/app/client.py:634`; none today)
    must be above limit + 15 s, or below the MCP 60 s cap with a distinct message.
  - I-3: the UI BFF `runBacktest` (`services/xstockstrat-ui/src/lib/insightsBff.ts:41`) must not gain a
    `timeoutMs` at or below limit + slack.
  - The pin in `docs/roadmap/features/merge-order.md` and the I-1..I-3 record in 273's `context.md` are outside
    this writer's scope. They remain an Open Thread (context.md) for the router and 273's writer.
- **Peer overlap (rebase churn).**
  - 244 (`fix-python-config-stored-zero`) changes the analysis getters. `get_int_present` already exists at
    `app/config/watcher.py:107`, so this feature does not depend on 244's helper. Rebase if 244 lands first.
  - 215 and 274 edit the `RunBacktest` region. After the Step 3 rename, their anchors live inside
    `_run_backtest`. Re-grep `self._backtests[backtest_id] = result` at every rebase, and T-commit (Step 6) is the
    tripwire for the `disarm()` placement.
  - 245 owns the screener deadline at `servicer.py:3786-3796`. **Do not edit it.**

---

### Step 1 — service: D-28 two-token re-serve guard in `_fetch_bars_paged`

**Status**: `done`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/app/handlers/servicer.py` — modify

**Reviewers**: `xstockstrat-analysis` owner — Backtest reproducibility, strategy scoring determinism, no look-ahead bias

**Codebase Evidence**:
- Confirmed via: `grep -n "def _fetch_bars_paged" app/handlers/servicer.py` → line 1401 (re-spec 2026-10-29). Docstring
  `:1402-1418`; `page_token = ""` `:1420`; `last_seen = None` `:1421`; the `fresh` filter `:1436-1438`.
- The defect terminal is at `:1439-1442`:
  ```python
  if not fresh:
      # Either genuine EOF, or a server that re-served an already-consumed page.
      # Both are terminal; neither should loop.
      return bars
  ```
- `page_token = resp.page.next_page_token` and `if not page_token: return bars` are at `:1448-1450`. The page-cap
  raise at `:1452-1455` ends with `"— refusing to return a truncated series"`.
- `class _BarFetchError(Exception):` is at `:366`. Its docstring reads "Raised when bar pagination cannot complete
  safely (non-advancing cursor, page cap)."
- Spec-time prototype (scratch copy, not committed): replacing the terminal with
  `if page_token and resp.page.next_page_token: raise _BarFetchError(...)` turned exactly
  `tests/test_warmup.py::TestFetchBarsPaged::test_identical_page_with_identical_token_terminates` red. The other
  1271 tests passed (`uv run pytest -q -m 'not real_pg'`).

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. In `_fetch_bars_paged`, replace the body of `if not fresh:` (`:1439-1442`) with the two-token rule (design §1,
   option (a)). Here `page_token` is still the token *just sent*, because it is only reassigned at `:1448`:
   ```python
   if not fresh:
       if page_token and resp.page.next_page_token:
           raise _BarFetchError(
               f"{symbol}: page_token {page_token!r} added no newer bar and re-issued a cursor "
               f"({len(bars)} bars so far) — refusing to return a truncated series"
           )
       return bars
   ```
   An empty `page_token` (an empty first page) and an empty response token (a sent token followed by an empty
   terminal page, @AC-7) both remain EOF. Comment at most 2 lines (root CLAUDE.md §How to Act #5).
2. Update the docstring's "Strict cursor monotonicity" bullet (`:1409-1412`) to state the rule: a page with no
   strictly newer bar raises when a token was sent **and** the response re-issues a non-empty token; with an empty
   response token it is EOF.
3. Do not touch the `:1448-1450` EOF exit, the `_MAX_BAR_PAGES` cap raise (`:1452-1455`), `_BAR_PAGE_SIZE` (`:295`),
   `_MAX_BAR_PAGES` (`:299`) or any caller. Callers inherit the error (product-spec Out of Scope: no per-caller retry or fallback).

**Verification**:
```bash
cd services/xstockstrat-analysis && grep -n "re-issued a cursor" app/handlers/servicer.py \
  && ruff check . && ruff format --check .
```
Behavior is verified in Step 2.

---

### Step 2 — test: D-28 pager scenarios (AC-1, AC-2, AC-4, AC-7) + full-suite tripwire

**Status**: `done`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/tests/test_warmup.py` — modify

**Reviewers**: `xstockstrat-analysis` owner — Backtest reproducibility, strategy scoring determinism, no look-ahead bias

**Codebase Evidence**:
- `class TestFetchBarsPaged:` is at `tests/test_warmup.py:210`. Helpers: `_bar(sec)` `:193`,
  `_page(bars, token="")` `:199`, `_svc_with_pages(pages)` `:203`.
- The bug-locking test is `test_identical_page_with_identical_token_terminates` at `:236-243`. It asserts
  `[b.time.seconds for b in bars] == [1, 2]` and `await_count == 2`.
- Raise-test precedent: `test_exceeding_the_page_cap_raises_rather_than_truncating` at `:255-261` uses
  `pytest.raises(_BarFetchError, match="refusing to return a truncated series")`. `_BarFetchError` and
  `_MAX_BAR_PAGES` are already imported by this file (used at `:239`, `:258`).
- Existing neighbours stay unchanged: cursor-follow `:216`, token-forward `:230`, overlap `:245`, empty first page
  `:263`, and full page with empty token = EOF `:267`.

**TDD**: `red-green required`

**Covers**: `AC-1, AC-2, AC-4, AC-7`

**Instructions**:
1. **@AC-1 (C-18 deliberate inversion).** Rename `test_identical_page_with_identical_token_terminates` to
   `test_identical_page_with_identical_token_raises`.
   - Keep `repeated = [_page([_bar(1), _bar(2)], token="stuck") ...]`.
   - Replace the two asserts with `pytest.raises(_BarFetchError, match="refusing to return a truncated series")`
     around the call.
   - Assert `svc._marketdata.GetBars.await_count == 2`: the loop stops on the first re-served page.
   - Update the docstring: it locked the bug in, and the inversion is deliberate (design.md § C-18).
2. **@AC-2.** Add `test_three_bar_eof_returns_full_series`: pages `[_page([_bar(1), _bar(2)], token="t1"),
   _page([_bar(3)])]` return times `[1, 2, 3]`. It passes before and after (regression guard).
3. **@AC-4.** Add `test_empty_page_with_reissued_token_raises`: pages `[_page([_bar(1), _bar(2)], token="t1"),
   _page([], token="t1")]` raise `_BarFetchError` matching `"refusing to return a truncated series"`. Red before
   Step 1.
4. **@AC-7.** Add `test_empty_terminal_page_after_sent_token_is_eof`: pages `[_page([_bar(1), _bar(2)],
   token="t1"), _page([])]` return `[1, 2]`, with `await_count == 2`.
5. **C-13.** All literals are scenario one-offs built from this file's local helpers (`_bar`, `_page`), which have
   a single consumer, so inline is compliant. No conftest change.

**Verification**:
```bash
cd services/xstockstrat-analysis \
  && pytest tests/test_warmup.py -q -k "FetchBarsPaged" \
  && pytest --cov=app --cov-fail-under=40 \
  && ruff check . && ruff format --check .
```
The full-suite run is the tripwire for any `GetBars` mock that returns a truthy token. Any newly red test is a
Deviation Log entry and a blocker; never patch it silently. Confirm the C-13 verdict with
`grep -n "conftest" tests/test_warmup.py`: no new fixture home is expected.

---

### Step 3 — service: rename the RunBacktest body; `_BarFetchError` fails the run as FAILED_PRECONDITION

**Status**: `done`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/app/handlers/servicer.py` — modify

**Reviewers**: `xstockstrat-analysis` owner — Backtest reproducibility, strategy scoring determinism, no look-ahead bias

**Codebase Evidence**:
- `@owner_scoped` `:791` and `async def RunBacktest(self, request, context):` `:792` (re-spec 2026-10-29). The body
  runs to `return result` at `:1361`.
- `def owner_scoped(fn):` `:475-485` wraps `fn(self, request, context)`; a non-raising abort `return None` is at
  `:484`.
- The per-symbol loop is `for symbol in symbols_to_run:` at `:1003`. It awaits `_backtest_symbol_evaluated` (`:1012`)
  and `_backtest_symbol` (`:1039`), and its trailing handlers are at `:1134-1139`:
  ```python
  except grpc.RpcError as e:
      log.warning("backtest symbol %s failed: %s — skipping", symbol, e)
      continue
  except Exception as e:
      log.warning("backtest symbol %s error: %s — skipping", symbol, e)
      continue
  ```
- The benchmark preload `await self._load_benchmark_bars(...)` at `:959` is outside the loop. It catches only
  `except _InsufficientData as ins:` (`:966`), so a `_BarFetchError` propagates out of the body.
- `grep -rn "RunBacktest" app/` shows no internal Python caller of `self.RunBacktest`; only the gRPC server and
  tests call it.
- Abort idiom: `context.abort(grpc.StatusCode.FAILED_PRECONDITION, ...)` at `:654-655`. The test context
  `_owned_ctx()` (`tests/test_analysis_servicer.py:63-70`) makes `abort` an `AsyncMock(side_effect=Exception("aborted"))`.

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. Rename the existing method to `async def _run_backtest(self, request, context):`. Remove `@owner_scoped` from
   it; the body is otherwise byte-identical (no re-indent).
2. Directly above it, add the public wrapper. It keeps `@owner_scoped`:
   ```python
   @owner_scoped
   async def RunBacktest(self, request, context):
       try:
           return await self._run_backtest(request, context)
       except _BarFetchError as e:
           await context.abort(
               grpc.StatusCode.FAILED_PRECONDITION, f"backtest bar series incomplete: {e}"
           )
           return None
   ```
   FAILED_PRECONDITION, not UNAVAILABLE: both causes are deterministic, and UNAVAILABLE is reserved for transient
   store outages (design.md § Rejected Alternatives).
3. In the per-symbol loop, insert `except _BarFetchError: raise` immediately before `except grpc.RpcError as e:`
   (`:1134`). A truncated symbol must fail the run, not be skipped (R-1).
4. Trace rule (operator 2026-10-21, C-03): the abort uses the inbound `context`. Add no emit and mint no background
   context.

**Verification**:
```bash
cd services/xstockstrat-analysis \
  && grep -n "async def _run_backtest\|backtest bar series incomplete\|except _BarFetchError" app/handlers/servicer.py \
  && ruff check . && ruff format --check .
```
Behavior is verified in Step 4.

---

### Step 4 — test: AC-6 — FAILED_PRECONDITION for a truncated symbol and for the benchmark

**Status**: `done`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/tests/test_backtest_bounds.py` — create

**Reviewers**: `xstockstrat-analysis` owner — Backtest reproducibility, strategy scoring determinism, no look-ahead bias

**Codebase Evidence**:
- `ls services/xstockstrat-analysis/tests/test_backtest_bounds.py` → absent. This is a new file.
- Harness to reuse (`tests/test_backtest_source_symbol.py`):
  - `_wire_per_symbol(svc, bars_by_symbol)` `:36-53`: ledger, indicators and per-symbol `GetBars` returning
    `_EOF_PAGE`;
  - `_sym_bars(symbol, n_prefix, n_window, base)` `:29`;
  - `_mkt_def(period=5)` `:56`: a `source_symbol="VOO"` benchmark component.
  It already imports `make_servicer`, `_owned_ctx`, `_windowed_req` and `_EOF_PAGE` from
  `tests/test_analysis_servicer.py` (`make_servicer` `:36`, `_owned_ctx` `:63`, `_EOF_PAGE` `:135`,
  `_windowed_req` `:3671`, which still takes `symbols=`; re-spec 2026-10-29).
- Persistence seams: `_persist_backtest_run` (`servicer.py:2861`) and `_persist_symbol_cells` (`:2940`).
  `AsyncMock` replacement precedent: `svc._persist_symbol_cells = AsyncMock()`
  (`tests/test_backtest_fundamentals_guard.py:132`).
- `make_servicer()` already stubs `cfg.get_int_present` to return the default (`test_analysis_servicer.py:49`;
  fails.md:1394).

**TDD**: `red-green required`

**Covers**: `AC-6`

**Instructions**:
1. Create the file with a module docstring naming feature 272 and `@AC-6`. Import `_wire_per_symbol`, `_sym_bars`
   and `_mkt_def` from `.test_backtest_source_symbol`, plus `make_servicer`, `_owned_ctx` and `_windowed_req` from
   `.test_analysis_servicer`. This reuses existing homes (C-13); the module-local re-serving `GetBars` side effect
   has a single consumer, so inline is compliant.
2. `test_truncated_symbol_fails_run_failed_precondition`:
   - Wire AAPL and MSFT (plus VOO, so the benchmark loads), using `_sym_bars(..., n_prefix=30, n_window=15)`.
   - Override `svc._marketdata.GetBars` so AAPL returns `SimpleNamespace(bars=<same bars>,
     page=SimpleNamespace(next_page_token="stuck"))` on every call; other symbols return `_EOF_PAGE`.
   - Set `svc._persist_symbol_cells = AsyncMock()` and `svc._persist_backtest_run = AsyncMock()`.
   - Call `RunBacktest(_windowed_req(_mkt_def(), symbols=("AAPL", "MSFT")), context=ctx)` under
     `pytest.raises(Exception, match="aborted")`.
   - Assert that `ctx.abort.await_args.args[0] == grpc.StatusCode.FAILED_PRECONDITION`, that `args[1]` starts with
     `"backtest bar series incomplete:"`, and that neither persistence mock was awaited.
   - Red before Step 3: the loop skips AAPL and the run returns.
3. `test_truncated_benchmark_fails_run_failed_precondition`:
   - Build `definition = _mkt_def()` and set `definition.components[0].source_symbol = "SPY"` (the scenario value).
     Wire bars for AAPL and SPY.
   - SPY re-serves with token `"stuck"`.
   - Assert the same FAILED_PRECONDITION and prefix, and no persistence.
   - Red before Step 3: an uncaught `_BarFetchError` escapes, so `pytest.raises(Exception, match="aborted")` does
     not match.

**Verification**:
```bash
cd services/xstockstrat-analysis \
  && pytest tests/test_backtest_bounds.py -q \
  && pytest --cov=app --cov-fail-under=40 \
  && ruff check . && ruff format --check .
grep -n "from .test_backtest_source_symbol\|from .test_analysis_servicer" services/xstockstrat-analysis/tests/test_backtest_bounds.py
```

---

### Step 5 — service: D-29 wall-clock bound with `cm.expired()` check and `disarm()` before persistence

**Status**: `done`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/app/handlers/servicer.py` — modify

**Reviewers**: `xstockstrat-analysis` owner — Backtest reproducibility, strategy scoring determinism, no look-ahead bias

**Codebase Evidence**:
- Re-spec 2026-10-29 (feature 244 landed on main-dev, `9b20cb66`): in `app/config/watcher.py`, `get_int`
  (`:111-117`) is itself presence-aware. It returns the stored `int_val`, including 0, when the field is set, else
  the default. `get_int_present` is now an alias, `get_int_present = get_int` (`:119`). Calling `get_int_present`
  keeps the semantics this step needs (stored 0 = no limit), and it matches the name every `RunBacktest` test
  harness already stubs (Step 6 harness audit). Call-site precedent: `servicer.py:3903`
  `get_int_present("analysis.readiness.stale_after_seconds", 30)`.
- `int_positive(cfg, key, default)` (`watcher.py:142-144`) is **not** used for this key. It maps 0 and negatives
  to the default, but here 0 must mean "no limit" (`@AC-5`), and a negative must log a WARN, which
  `int_positive` does not do.
- Screener idiom, mirrored but **not edited** (feature 245), at `servicer.py:3799-3809`:
  `deadline = int_positive(self._cfg, "analysis.screener.max_duration_seconds", 120)` (`:3799`),
  `asyncio.wait_for(...)`, `except TimeoutError: await context.abort(grpc.StatusCode.DEADLINE_EXCEEDED,
  f"screen exceeded {deadline}s deadline")` (`:3805-3808`), then `return` (`:3809`).
- Disarm anchor: `self._backtests[backtest_id] = result` at `:1274`. The only awaited call between compute and that
  anchor is `await self._fundamentals_gap_labels(refused_diags, propagation_meta)` at `:1253`, a read RPC.
  Everything after the anchor is persistence and the completion emit:
  - `_persist_symbol_cells` `:1287`
  - `_persist_backtest_run` `:1307`
  - `_persist_backtest_detail` `:1321`
  - `_recompute_headline` `:1329`
  - `analysis.backtest.completed` AppendEvent `:1351-1359` (`event_type` at `:1353`)
- `import asyncio` is at `:13`. Python is 3.13 (`python3 --version` → 3.13.17; root CLAUDE.md), so
  `asyncio.timeout`, `Timeout.expired()` and `Timeout.reschedule(None)` are available.
- CPU cores run via `run_in_executor(self._compute_executor, _core)` at `:1730`, `:2242` and `:2413`. They stay
  there (`@AC-4 @feature-176`).
- The `default_fill_model` read at `:797-801` (`self._cfg.get_int("analysis.backtest.default_fill_model", 0)`) stays
  untouched (`@AC-9 @feature-151`). Since 244, `get_int` no longer zero-traps, but 0 maps to the legacy fill
  model whether it is stored or absent (comment `:797`), so the outcome is the same.

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. Add a module constant next to `_MAX_BAR_PAGES` (`:299`): `_BACKTEST_MAX_DURATION_DEFAULT_S = 300`. It is the
   documented call-site default; F-07 is honored because the live value comes from WatchConfig. The getter default
   and the negative fallback both use it, so the literal is not duplicated.
2. Change the signature to `async def _run_backtest(self, request, context, disarm):`.
   - Insert a single `disarm()` call immediately before `self._backtests[backtest_id] = result` (`:1274`).
   - Add a ≤2-line comment stating the constraint: no awaited state-writing call may move above it.
3. Rewrite the Step 3 wrapper as:
   ```python
   @owner_scoped
   async def RunBacktest(self, request, context):
       limit = self._cfg.get_int_present(
           "analysis.backtest.max_duration_seconds", _BACKTEST_MAX_DURATION_DEFAULT_S
       )
       if limit < 0:
           log.warning(
               "analysis.backtest.max_duration_seconds=%d is negative — using %ds",
               limit, _BACKTEST_MAX_DURATION_DEFAULT_S,
           )
           limit = _BACKTEST_MAX_DURATION_DEFAULT_S
       try:
           async with asyncio.timeout(limit or None) as cm:
               return await self._run_backtest(
                   request, context, lambda: cm.reschedule(None)
               )
       except TimeoutError:
           if not cm.expired():
               raise
           await context.abort(
               grpc.StatusCode.DEADLINE_EXCEEDED, f"backtest exceeded {limit}s deadline"
           )
           return None
       except _BarFetchError as e:
           ...  # unchanged from Step 3
   ```
   - The read happens at call time through `self._cfg`, which keeps per-user overrides working (recon R-7;
     263's acceptance).
   - A stored `0` means `asyncio.timeout(None)`, i.e. no limit.
   - A `TimeoutError` raised while `cm` has not expired (an inner `wait_for` today or from peers 215/274) is
     re-raised unchanged; it is not the backtest deadline.
4. Do not move any compute out of `run_in_executor`. A timed-out executor thread runs to completion (design §3,
   Open Risks); that is documented in Step 7 and not fixed here.
5. Trace rule (C-03): the abort uses the inbound `context`. The `analysis.backtest.started` append (`:825-833`, `event_type` at `:827`) stays
   inside the bound and keeps `metadata=propagation_meta`. No new emits.

**Verification**:
```bash
cd services/xstockstrat-analysis \
  && grep -n "_BACKTEST_MAX_DURATION_DEFAULT_S\|asyncio.timeout(limit or None)\|cm.expired()\|backtest exceeded\|disarm()" app/handlers/servicer.py \
  && grep -n "analysis.screener.max_duration_seconds" app/handlers/servicer.py \
  && ruff check . && ruff format --check .
```
The second grep must still show the screener read at the unchanged
`int_positive(self._cfg, "analysis.screener.max_duration_seconds", 120)` call. Behavior is verified in Step 6.

---

### Step 6 — test: AC-3, AC-3b, AC-5, T-inner-timeout, T-commit, T-executor

**Status**: `done`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/tests/test_backtest_bounds.py` — modify (created in Step 4)

**Reviewers**: `xstockstrat-analysis` owner — Backtest reproducibility, strategy scoring determinism, no look-ahead bias

**Codebase Evidence**:
- Re-spec 2026-10-29 (C-13): `tests/conftest.py:61-85` already has the shared factory this step needs,
  `snapshot_watcher(**values)`. It is a dial-free real `ConfigWatcher` (`__new__` bypasses the channel dial) whose
  snapshot maps each raw Python value by type to `int_val` / `float_val` / `bool_val` / `string_val`. So
  `snapshot_watcher(**{"analysis.backtest.max_duration_seconds": 1})` stores `int_val=1`, and `0` and `-5` are stored
  as set `int_val`s, which the presence-aware `get_int` / `get_int_present` (`app/config/watcher.py:111-119`) returns.
  Import precedent: `from tests.conftest import ...` (`tests/test_strategy_templates.py:26`).
- `tests/test_list_opportunities_deadlines.py:63` keeps its own `_watcher(**values)` (call sites `:129`, `:210`,
  `:350`; it passes explicit `ConfigValue` protos, including `float_val=5.0` for an int key at `:345`). Migrating it
  onto `snapshot_watcher` is a separate decision outside this feature's scope; this step does not touch that file.
- **Harness audit (fails.md:1394-1396, design hard verification item).** Every `RunBacktest` test harness builds
  its cfg with a `get_int_present` stub returning the default:
  - `make_servicer()` (`test_analysis_servicer.py:49`)
  - `_servicer()` (`test_owner_dimension.py:34`)
  - `_backtest_servicer()` (`test_fundamentals_formula_servicer.py:186`)
  - `test_blend_guard.py:34`
  - `test_config_zero_clamps.py:161` (`test_ac6_default_fill_model_zero_is_legacy`, feature 244, `9b20cb66`;
    re-spec 2026-10-29) replaces `svc._cfg` with a real `snapshot_watcher` from `_all_fr3_zero()` (`:86`). That key
    set has no `analysis.backtest.max_duration_seconds`, so `get_int_present` falls back to 300.

  The other RunBacktest suites (`test_backtest_fundamentals_guard.py`, `test_backtest_source_symbol.py`,
  `test_fill_model.py`, `test_grade_fundamentals_exclusion.py`, `test_sector_params.py`, `test_unreadable_formula.py`)
  all derive from `make_servicer()`. No bare-MagicMock RunBacktest harness exists, so existing runs keep the 300 s
  default.
- Stall seams:
  - `_backtest_symbol_evaluated`, awaited at `servicer.py:1012`;
  - `svc._marketdata.GetBars`, an `AsyncMock` (`_wire_per_symbol`);
  - `_persist_backtest_run` (`:2861`), which runs after the disarm anchor;
  - `self._compute_executor` (`:563`, a `ThreadPoolExecutor`).

**TDD**: `red-green required`

**Covers**: `AC-3, AC-5`

**Instructions**:
0. **C-13, first.** Reuse the existing shared `snapshot_watcher` (`tests/conftest.py:61`): add
   `from tests.conftest import snapshot_watcher` to `tests/test_backtest_bounds.py`. Declare no new watcher factory
   and do not edit `tests/conftest.py` or `tests/test_list_opportunities_deadlines.py`.

Then add these tests to `tests/test_backtest_bounds.py`. Each sets
`svc._cfg = snapshot_watcher(**{"analysis.backtest.max_duration_seconds": N})`, where the tests below write `N` as
`int_val=N`. `from app.handlers import servicer as servicer_mod` mirrors `test_list_opportunities_deadlines.py:18`.
Each test asserts elapsed time with `time.monotonic()`. Stalls use `asyncio.sleep`, never real compute (R-4).
Every test that expects an abort (AC-3, AC-3b, T-executor) makes the call under
`pytest.raises(Exception, match="aborted")`, because the `_owned_ctx()` abort mock raises (as in Step 4).
1. **AC-3** `test_deadline_exceeded_names_limit`:
   - `int_val=1`; patch `svc._backtest_symbol_evaluated` with an async function that sleeps 3 s.
   - Call `RunBacktest` under `pytest.raises(Exception, match="aborted")`, then assert `ctx.abort` was awaited with
     `(grpc.StatusCode.DEADLINE_EXCEEDED, "backtest exceeded 1s deadline")`.
   - Assert elapsed < 2 s and that `_persist_symbol_cells` and `_persist_backtest_run` (both `AsyncMock`) were not
     awaited (`@AC-3 @feature-149` preserved).
   - Red before Step 5.
2. **AC-3b** `test_deadline_fires_inside_awaited_getbars`:
   - `int_val=1`; the AAPL `GetBars` side effect sleeps 3 s.
   - Under `pytest.raises(Exception, match="aborted")`, assert DEADLINE_EXCEEDED in under 2 s. This guards against
     the `:1134-1139` handlers absorbing the cancellation.
3. **AC-5** `test_stored_zero_means_no_limit`:
   - `int_val=0`; the patched `_backtest_symbol_evaluated` sleeps 2 s, then delegates to the real method.
   - Assert a result with `status == BACKTEST_STATUS_OK` and that `ctx.abort` was not awaited.
4. **AC-5** `test_negative_limit_falls_back_to_300_with_warn`:
   - `int_val=-5`; use the `monkeypatch` fixture: capture `real = asyncio.timeout`, then
     `monkeypatch.setattr(servicer_mod.asyncio, "timeout", recorder)`, where `recorder(delay)` appends `delay` and
     returns `real(delay)`. `servicer.py:13` is a plain `import asyncio`, so this is the global attribute;
     `monkeypatch` restores it at teardown, so nothing leaks to other tests.
   - Assert it was entered with `300`, and that `caplog` holds a WARNING containing
     `analysis.backtest.max_duration_seconds` and `-5`.
5. **T-inner-timeout** `test_inner_timeout_is_not_mapped_to_deadline`:
   - `int_val=60`; patch `svc._load_benchmark_bars` (awaited at `servicer.py:959`, which catches only
     `_InsufficientData`) with an `AsyncMock(side_effect=TimeoutError())`, using a `_mkt_def()` definition so the
     benchmark preload runs.
   - Assert `pytest.raises(TimeoutError)`.
   - The pin: `ctx.abort` is **never** awaited with `DEADLINE_EXCEEDED`. Red before Step 5 only if the wrapper
     maps every `TimeoutError`; this test guards the `cm.expired()` check against regression.
6. **T-commit** `test_deadline_after_disarm_still_persists`:
   - `int_val=1`; wire a successful run.
   - Patch `svc._persist_backtest_run` with an async function that sleeps 2 s, then records the call.
   - Assert that a result is returned, that `ctx.abort` was not awaited, that the record is present, and that
     `svc._ledger.AppendEvent` was called with `event_type == "analysis.backtest.completed"`.
   - This is the tripwire for `disarm()` placement against peer edits. A deadline that fires in the same loop tick
     just before `disarm()` still maps to DEADLINE_EXCEEDED; that edge is accepted and not tested.
7. **T-executor** `test_deadline_returns_while_executor_thread_finishes`:
   - `int_val=1`; patch `_backtest_symbol_evaluated` with an async function that awaits
     `asyncio.get_running_loop().run_in_executor(svc._compute_executor, blocking)`.
     `blocking` does `time.sleep(2)` and then `done.set()` on a `threading.Event`.
   - Under `pytest.raises(Exception, match="aborted")`, assert DEADLINE_EXCEEDED in under 2 s, that `done.is_set()`
     is False at abort time, and that
     `done.wait(3)` is True afterwards.
   - This documents that the thread is not interrupted (R-3).
8. **C-13.** `tests/test_backtest_bounds.py` declares no watcher factory of its own; it uses `snapshot_watcher`.

**Verification**:
```bash
cd services/xstockstrat-analysis \
  && pytest tests/test_backtest_bounds.py -q \
  && pytest --cov=app --cov-fail-under=40 \
  && ruff check . && ruff format --check .
grep -rn "def _watcher\|def config_watcher\|def snapshot_watcher" services/xstockstrat-analysis/tests/
grep -n "snapshot_watcher" services/xstockstrat-analysis/tests/test_backtest_bounds.py
```
The first grep must show exactly the two pre-existing declaration sites, `conftest.py` (`snapshot_watcher`) and
`test_list_opportunities_deadlines.py` (`_watcher`), and nothing in `test_backtest_bounds.py`. The second grep must
show the import and its uses.

---

### Step 7 — docs: analysis `CLAUDE.md` key row for `analysis.backtest.max_duration_seconds`

**Status**: `pending`
**Service**: `xstockstrat-analysis` (docs)
**Files**:
- `services/xstockstrat-analysis/CLAUDE.md` — modify

**Reviewers**: none

**Codebase Evidence**:
- `grep -n "max_duration_seconds" services/xstockstrat-analysis/CLAUDE.md` → `:509` (re-spec 2026-10-29), with
  `| analysis.backtest.max_duration_seconds | int | 300 | Max backtest run time |`. The screener row at `:538`
  stays unchanged.

**TDD**: `N/A (docs)`

**Covers**: —

**Instructions**:
Replace the `:509` description cell with the design §5 text, keeping type `int` and default `300`:
> Wall-clock bound on backtest evaluation up to result assembly; persistence and grade recompute are not bounded
> (total RPC time can exceed it). `0` = no limit, negative = 300 (WARN). Exceeded → `DEADLINE_EXCEEDED`
> `backtest exceeded Ns deadline`; executor threads are not interrupted — do not retry immediately. Read
> presence-aware at call time (per-user overrides apply).

Do not call it a "max backtest run time" (design round-1 objection).

**Verification**:
```bash
grep -n "analysis.backtest.max_duration_seconds" services/xstockstrat-analysis/CLAUDE.md
grep -c "Max backtest run time" services/xstockstrat-analysis/CLAUDE.md   # expect 0
```

---

### Step 8 — docs: strat-lab `backtest` skill + `mcp-tools.md` failure-mode rows (C-14, @AC-32 @feature-224)

**Status**: `pending`
**Service**: `plugins/strat-lab`, `docs/runbooks/`
**Files**:
- `plugins/strat-lab/skills/backtest/SKILL.md` — modify
- `plugins/strat-lab/skills/backtest/reference/output-handling.md` — modify
- `plugins/strat-lab/skills/backtest/reference/aggregation.md` — modify
- `plugins/strat-lab/README.md` — modify
- `docs/runbooks/mcp-tools.md` — modify

**Reviewers**: none

**Codebase Evidence**:
- `docs/runbooks/mcp-tools.md:421-430`, the `run_backtest` **Errors** table (heading `:421`; re-spec 2026-10-29).
  Sibling row `| Window span over \`analysis.backtest.max_range_days\` | \`INVALID_ARGUMENT\` from analysis |` is at
  `:427`; the table ends with `| Analysis service unreachable | ... |` at `:430`. Re-grep both anchors at execute
  time.
- `plugins/strat-lab/skills/backtest/SKILL.md`: `## Phase 2 — Run, and handle the oversized output` is at `:184`,
  followed by `### Fill model (feature 151)` at `:195`.
- `reference/output-handling.md`, `## The JSON shape`. The fundamentals-outage "rerun" bullet is at about `:29-31`
  and must stay distinct from the new failures (`@AC-8 @feature-215`).
- `reference/aggregation.md:28`, `## Combine independent runs`.
- `plugins/strat-lab/README.md:12-24` holds the "fails in three predictable ways" list.
- Guard rail: `docs/patterns/strat-lab-plugin.md` § The guard rail requires same-PR updates; the validator is
  `plugins/strat-lab/scripts/validate.py`.
- `@AC-32 @FR-12 @feature-224` (`docs/sdd/business-rules/platform.feature:300-304`): both `mcp-tools.md` and
  `SKILL.md` keep listing `list_templates` and `instantiate_template`, and neither mentions `is_public` or
  `include_public`.

**TDD**: `N/A (docs)`

**Covers**: —

**Instructions**:
1. **`mcp-tools.md`.** After the `max_range_days` row (`:427`), add two rows:
   - `| Backtest evaluation exceeds \`analysis.backtest.max_duration_seconds\` (default 300 s; 0 = no limit) |
     \`DEADLINE_EXCEEDED\` \`backtest exceeded Ns deadline\` — narrow the range or symbols; do not retry
     immediately (the compute thread keeps running) |`
   - Re-spec 2026-10-29: name no per-environment value. The earlier "prod 120 s, staging 300 s" was ungrounded (see
     Step 9); this wording stays true whichever Step 9 decision the operator takes.
   - `| marketdata re-served a bar page, or bar pagination hit its page cap | \`FAILED_PRECONDITION\` \`backtest bar
     series incomplete: …\` — retrying will not fix it; report it |`

   Add one sentence under the table: through the agent, the MCP 60 s tool cap fires before any server deadline
   above 60 s (the default is 300 s), so agent users see the server message only when the limit is below 60 s, and
   only once feature 273's pass-through lands.
2. **`SKILL.md` Phase 2** (`:184`). Add a short "Failure modes" paragraph with the same two cases and the 60 s-cap
   fact, naming no per-environment limit value.
   One truncated symbol now fails the whole multi-symbol run; it is no longer silently skipped.
3. **`reference/output-handling.md`.** Add a bullet after the fundamentals-outage bullet (about `:29-31`): these two are RPC errors, not result fields;
   there is no result file to parse. Keep the fundamentals "rerun" warning distinct.
4. **`reference/aggregation.md`.** Add a note under `:28`: a basket member failing with `FAILED_PRECONDITION` or
   `DEADLINE_EXCEEDED` is a failed run. Report it; never aggregate it as zero trades.
5. **`README.md`.** Add one line to the failure-modes intro naming the two new loud failures.
6. Change nothing about `list_templates`, `instantiate_template`, `is_public` or `include_public`.

**Verification**:
```bash
python3 plugins/strat-lab/scripts/validate.py --self-test && python3 plugins/strat-lab/scripts/validate.py
grep -n "backtest exceeded\|backtest bar series incomplete" docs/runbooks/mcp-tools.md plugins/strat-lab/skills/backtest/SKILL.md plugins/strat-lab/skills/backtest/reference/output-handling.md plugins/strat-lab/skills/backtest/reference/aggregation.md plugins/strat-lab/README.md
grep -c "list_templates\|instantiate_template" docs/runbooks/mcp-tools.md plugins/strat-lab/skills/backtest/SKILL.md   # each ≥1
grep -n "is_public\|include_public" docs/runbooks/mcp-tools.md plugins/strat-lab/skills/backtest/SKILL.md            # expect none
```

---

### Step 9 — config: G-1 launch-checklist gate — measure backtest durations against the first-enforced limit

**Status**: `pending`
**Service**: `xstockstrat-analysis` / `xstockstrat-config` (operational gate; no source change)
**Files**:
- `docs/roadmap/features/272-fix-analysis-backtest-bounds/context.md` — modify (record the measurements)

**Reviewers**: `xstockstrat-analysis` owner — Backtest reproducibility, strategy scoring determinism, no look-ahead bias, `xstockstrat-config` owner — Config key naming, environment (`production`/`staging`) / global-per-user scoping

**Codebase Evidence**:
- `rpc QueryEvents(QueryEventsRequest) returns (QueryEventsResponse);` is at `packages/proto/ledger/v1/ledger.proto:15`.
- The `analysis.backtest.started` append is at `servicer.py:825-833` (`event_type` `:827`), and the
  `analysis.backtest.completed` append at `:1351-1359` (`event_type` `:1353`). Both use `stream_key=f"backtest:{backtest_id}"`.
- **Re-spec 2026-10-29 — the prior evidence was wrong.** The seeded rows are the **bare** key
  `backtest.max_duration_seconds` in namespace `'analysis'`: `'120'`, `'production'` at
  `services/xstockstrat-config/migrations/002_config_environment.up.sql:71`, and the base seed `'300'` at
  `001_config_tables.up.sql:69`. The `029_heal_config_keys_full_dotted.up.sql` UPDATE (`:24-28`) heals only
  `namespace IN ('platform', 'trading', 'portfolio', 'marketdata')`. No later migration (030-034; 031 is
  indicators-only, 032 is description-only) heals the analysis namespace. The WatchConfig snapshot is keyed by the
  raw `key` column (029 header `:8-10`). So the Step 5 read `get_int_present("analysis.backtest.max_duration_seconds", 300)`
  does **not** see the prod `120` seed. Unless an operator has created a dotted row, the effective limit is the code
  default, **300 s in every environment**. The earlier premise of a "first-enforced prod value of 120 s" is
  ungrounded.

**TDD**: `N/A (operational gate)`

**Covers**: —

**Operator decision required (blocker for this step only; Steps 1-8 are unaffected):** before this gate runs, the
operator picks one of these and it is recorded in `context.md`:
- **(A) Reword G-1.** The gate measures against the effective limit, the 300 s code default in every environment,
  unless the operator creates dotted `analysis.backtest.max_duration_seconds` rows via `set_config` or `/config-ui`
  (no migration; F-01).
- **(B) Heal migration.** A new config migration renames the bare analysis row(s) to the dotted key, so the prod
  `120` seed applies. This adds a DB-migration gate (DBA + service owner; root CLAUDE.md § Approval Flow) that this
  spec does not have. It needs a re-spec that adds a step, and it would also rename every other bare analysis row
  that is read by its dotted name, so the scope must be decided first.
- **(C) Another operator instruction.**

Do not choose on the operator's behalf. Until a decision is recorded, the execute loop stops before this step.

**Instructions**:
1. After Step 5 is on dev, and before `launch-ready`, query ledger `QueryEvents` for `analysis.backtest.started` and
   `analysis.backtest.completed` on `backtest:<id>` streams over the trailing 30 days. Do this on both dev and prod.
2. Record in `context.md`:
   - for completed pairs, n, p50, p95, p99 and max of (completed − started);
   - per environment, the count of `started` events with no `completed` (orphans; this corrects survivorship bias).
3. Before measuring, confirm the effective limit in each environment with the agent `get_config` or
   `list_config_keys` tool (does a dotted `analysis.backtest.max_duration_seconds` row exist?), and record it next
   to the percentiles. The threshold is an **operator input**. The proposed default is edge-origin-timeout minus 10 s; 90 s holds only
   if the ungrounded Cloudflare ~100 s assumption holds (P-03).
4. **Pass condition:** prod p99 is at or below the threshold, and the orphan count is trivial. Otherwise the
   operator must do one of:
   - set or raise the dotted prod row via `set_config` or `/config-ui` (no migration; F-01);
   - sign off in `context.md` quoting the numbers.

**Verification**:
`grep -n "G-1" docs/roadmap/features/272-fix-analysis-backtest-bounds/context.md` shows the operator's
decision (A/B/C), the effective limit per environment, the recorded percentiles, the orphan counts, the threshold the
operator chose, and either a pass or the operator's sign-off.

---

## Deviation Log

_Populated by /sdd-execute as implementation proceeds._

### 2026-10-29 — Steps 1 and 2 executed as one commit (standing operator rule)

- **Step(s)**: 1 (service), 2 (test).
- **Deviation**: Step 1's RED test is Step 2's test, and Step 1 alone turns the existing
  `test_identical_page_with_identical_token_terminates` red. Per the STANDING OPERATOR RULE (operator, 2026-10-29,
  'Merge pairs + standing rule': "if this step's Verification fails ONLY because the consumers or tests of its new
  code live in the immediately following step ... or the RED test is that next step's test ... Execute this step and
  the next one together as ONE commit with one red→green cycle on the next step's tests, mark BOTH steps done"),
  both steps landed in one commit with one red→green cycle on Step 2's tests.
- **Formatting note (no spec deviation)**: the `_BarFetchError` message from Instruction 1 is split across three
  f-string lines to satisfy ruff E501 (100 cols). The literal `re-issued a cursor` stays on one source line, so
  Step 1's verification grep still matches; the rendered message is unchanged.
- **Disposition**: applied under the standing rule; no other deviation.

### 2026-10-29 — Steps 3 and 4 executed as one commit (standing operator rule)

- **Step(s)**: 3 (service), 4 (test).
- **Deviation**: Step 3 is `TDD: red-green required`, but its RED test is Step 4's test (Step 3 specs no test of its
  own; "Behavior is verified in Step 4"). Per the STANDING OPERATOR RULE (operator, 2026-10-29, 'Merge pairs +
  standing rule': "if this step's Verification fails ONLY because the consumers or tests of its new code live in the
  immediately following step ... or the RED test is that next step's test ... Execute this step and the next one
  together as ONE commit with one red→green cycle on the next step's tests, mark BOTH steps done"), both steps landed
  in one commit with one red→green cycle on Step 4's tests.
- **Test-shape note (no behavior deviation)**: `tests/test_backtest_bounds.py` also imports `_EOF_PAGE` from
  `.test_analysis_servicer` (Step 4's evidence names it as the non-stuck page) and factors the re-serving `GetBars`
  side effect and the shared assertions into two module-local helpers (`_stuck_on`,
  `_assert_failed_precondition_no_persistence`), each used by both tests. Instructions 2–3 assertions are unchanged.
- **Disposition**: applied under the standing rule; no other deviation.

### 2026-10-29 — Steps 5 and 6 executed as one commit (standing operator rule, widened) + Files expansion

- **Step(s)**: 5 (service), 6 (test).
- **Deviation 1 — step merge**: Step 5 is `TDD: red-green required`, but its RED tests are Step 6's tests ("Behavior
  is verified in Step 6"). Per the STANDING OPERATOR RULE (operator, 2026-10-29, 'Merge pairs + standing rule': "if
  this step's Verification fails ONLY because the consumers or tests of its new code live in the immediately
  following step ... or the RED test is that next step's test ... Execute this step and the next one together as ONE
  commit with one red→green cycle on the next step's tests, mark BOTH steps done"), both steps landed in one commit
  with one red→green cycle on Step 6's tests.
- **Deviation 2 — Files expansion**: the new presence-aware read of `analysis.backtest.max_duration_seconds` turned
  the feature-244 read-classification guard red (`test_rule2_key_sets_match_classification`: "unclassified plain
  reads"). Operator decision (session question tool, 2026-10-30, 'A: Register key (Recommended)'), under the WIDENED
  rule (operator, 2026-10-30, 'Widen the rule (Recommended)': "the merged commit may ALSO touch test fakes, fixtures
  or test-registry entries ... in files outside both steps' **Files**, provided no test assertion and no production
  behaviour outside the steps changes"). Extra file:
  - `services/xstockstrat-analysis/tests/test_config_read_classification.py` — `analysis.backtest.max_duration_seconds`
    added to `HONOUR_KEYS`, plus the `ZERO_IS_LEGIT` entry `"0 = no limit (feature-272 @AC-5)"`. No assertion changed.
- **Spec-text note (no behavior deviation)**: the Step 5 disarm comment is two lines; the stall helpers in Step 6
  are module-local (`_bounded_svc`, `_stall_evaluated`, `_assert_deadline_abort`), single-file consumers (C-13).
- **Disposition**: applied under the standing rule (widened); no other deviation.

