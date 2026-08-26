# Implementation Spec: fix-signal-screen-crash

**Status**: `pending`
**Created**: 2026-08-26
**Feature**: `docs/roadmap/features/159-fix-signal-screen-crash/feature.md`
**Total Steps**: 3
**Feature Branch**: `feature/fix-signal-screen-crash`

---

## Execution Summary

A one-line source fix in a single service (`xstockstrat-analysis`), preceded by its regression
tests (red-before-green, P-06). The blend-scoring helper `compute_signal_score` reads
`bar.timestamp` while the marketdata `Bar` proto field is `time` — so every signal-weighted
`ScreenSymbols` (`signal_sources` set **and** `signal_weight > 0`) crashes with `AttributeError:
timestamp`. The fix is `scoring.py:17` `bar.timestamp` → `bar.time` (the in-service convention:
`evaluator.py:43`, `servicer.py:3920`).

Two RED tests precede the fix, plus a ledger-mandated (`fails.md` 2026-08-06 backtest-debug-info
entry) reshape of the `_make_bar` test helper from a `MagicMock` — which auto-vivified `.timestamp`
and is exactly why the bug shipped — to a real `marketdata_pb2.Bar`. Order: **Step 1** (test:
reshape `_make_bar` + the `compute_signal_score` unit anchor, `@AC-2`) and **Step 2** (test: the
`ScreenerEngine.screen()` seam that is the exact staging repro, `@AC-1`) both go RED on the current
tree; **Step 3** (service: the field rename) turns them GREEN.

No proto/migration/config change. **Consumer surface (C-14): internal/platform-only** — the crash
reaches users through the agent `screen_symbols` MCP tool and the `/insights` screener, but the fix
**restores** those existing surfaces and adds no new one, so no agent/UI step is required (recon
§ Risks; design § Chosen Approach). This is a decision, not an omission.

**Scenario coverage (C-15):**
- `@AC-1` (a signal-weighted screen returns results instead of crashing) → **Step 2**
- `@AC-2` (`compute_signal_score` reads the bar time from the correct proto field) → **Step 1**

## Step Dependencies

- Step 3 (service: the `bar.timestamp` → `bar.time` fix) is covered by Step 1 **and** Step 2 (its
  paired `test` steps, C-08) — both authored to fail RED before Step 3 and pass GREEN after.
- Step 1 must reshape `_make_bar` **before** adding the `@AC-2` unit anchor, because the anchor and
  the existing `TestComputeSignalScore`/`WithWeights` suite share that helper and require a real
  `Bar` (a `MagicMock` reproduces nothing — P-06 would be vacuous).
- Steps 1 and 2 are independent of each other; either order is fine. Step 3 comes last.
- **Required close-out (design build-order step 7, open risk):** after Step 3 is GREEN, a **manual
  dev smoke** — a live signal-weighted `screen_symbols` (`signal_sources` set, `signal_weight > 0`)
  returns `SCREEN_RESULT_STATUS_OK` on dev — is a **required** acceptance check, folded into Step 3's
  Verification. The mocked tests cannot prove the live edge that failed on staging.

---

### Step 1 — test: reshape `_make_bar` to a real Bar and add the `compute_signal_score` field anchor (`@AC-2` RED)

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/tests/test_analysis_helpers.py` — modify

**Reviewers**: xstockstrat-analysis owner — strategy scoring determinism, no look-ahead bias

**Codebase Evidence**:
- `_make_bar` is a `MagicMock` today: `tests/test_analysis_helpers.py:163-167` —
  `bar = MagicMock(); bar.timestamp.ToDatetime.return_value = _seconds_to_datetime(timestamp_seconds); return bar`.
  This auto-vivifies `.timestamp`, hiding the `bar.timestamp`/`bar.time` field-name bug (recon
  § Test homes; `docs/roadmap/ledger/fails.md` 2026-08-06 "backtest-debug-info — assumption").
- `_seconds_to_datetime(seconds)` helper already present: `test_analysis_helpers.py:170-173` — returns
  a naive-UTC `datetime` (`datetime.fromtimestamp(seconds, tz=UTC).replace(tzinfo=None)`); reuse it.
- The suite calls `_compute_signal_score`, imported at `test_analysis_helpers.py:14`
  (`from app.handlers.servicer import _compute_metrics, _compute_signal_score, _unwrap_value`);
  `_compute_signal_score` **is** `scoring.compute_signal_score` — re-exported at
  `app/handlers/servicer.py:63` (`_compute_signal_score = scoring.compute_signal_score`). So the
  existing symbol already exercises the crash site; keep calling it.
- Crash site being anchored: `app/services/scoring.py:17` `bar_ts = bar.timestamp.ToDatetime()`;
  `bar_ts` gates the validity window at `scoring.py:27,29`; the score transform for a single in-window
  buy at conviction 0.8 is `net=0.8 → (0.8+1)/2 = 0.9` (`scoring.py:31-42`).
- Existing imports available: `from datetime import UTC` (`:8`), `from unittest.mock import MagicMock`
  (`:9`). `marketdata_pb2` / `ingest_pb2` are **not** yet imported here — add them
  (`from gen.marketdata.v1 import marketdata_pb2`, `from gen.ingest.v1 import ingest_pb2`; the
  `gen.<svc>.v1` path is confirmed used at `tests/test_screener.py:9-10` and
  `app/services/screener.py:36`).
- `ExternalSignal` fields for the real signal: `packages/proto/ingest/v1/ingest.proto:105-117` —
  `source(1), symbol(2), direction(3), conviction(4), valid_from(5), valid_until(6)`; `valid_from`/
  `valid_until` are `google.protobuf.Timestamp` (set via `.FromDatetime(...)`; `scoring.py:25` reads
  them only when `.seconds > 0`). `Bar.time` is `google.protobuf.Timestamp time = 2`
  (`packages/proto/marketdata/v1/marketdata.proto:44-46`).

**TDD**: `red-green required`

**Covers**: `AC-2`

**Instructions**:
1. Add the two proto imports at the top of the file:
   `from gen.marketdata.v1 import marketdata_pb2` and `from gen.ingest.v1 import ingest_pb2`.
2. Replace the body of `_make_bar` (`:163-167`) with a **real** `marketdata_pb2.Bar` whose candle
   time is set, keeping the exact signature `_make_bar(timestamp_seconds: int = 1704067200)` and
   reusing `_seconds_to_datetime`:
   ```python
   def _make_bar(timestamp_seconds: int = 1704067200) -> marketdata_pb2.Bar:
       """Real marketdata Bar with its candle time set (feature 159).
       Was a MagicMock, which auto-vivified `.timestamp` and hid the bar.timestamp/bar.time
       field-name bug; a real proto fails that typo class closed."""
       bar = marketdata_pb2.Bar()
       bar.time.FromDatetime(_seconds_to_datetime(timestamp_seconds))
       return bar
   ```
   Update the return type hint from `MagicMock` to `marketdata_pb2.Bar`. `_make_signal`
   (`:176-188`) stays a `MagicMock` — all its reads (`sig.direction`, `sig.conviction`,
   `sig.valid_from.seconds`, `sig.valid_until.seconds`, `.ToDatetime()`) are mock-satisfiable and
   `compute_signal_score` reads only `bar.time` on the bar, so no other test depended on the mock bar.
3. Add the `@AC-2` unit anchor to `class TestComputeSignalScore` — a real `Bar` **and** a real
   `ExternalSignal` whose window straddles the bar time, asserting the exact transform (design § RED
   test #1):
   - Build `bar = _make_bar(T)` (real, `.time` set) and
     `sig = ingest_pb2.ExternalSignal(source="uw", direction="buy", conviction=0.8)` with
     `sig.valid_from.FromDatetime(...)` **before** T and `sig.valid_until.FromDatetime(...)` **after** T.
   - Assert `_compute_signal_score({"uw": [sig]}, bar, ["uw"]) == pytest.approx(0.9)` (single in-window
     buy at 0.8 → `(0.8+1)/2`).
   - Add the paired out-of-window case: a bar whose `.time` is **outside** the same `[valid_from,
     valid_until]` window → the signal is excluded → assert `== 0.5`. The value flips with `bar.time`,
     which is what proves the field is read (a bare `score ∈ [0,1]` check would be vacuous — design
     § Rejected Alternatives). Keep the hard-coded `0.9` (catches a silent change to the `(net+1)/2`
     mapping).
4. **Do not** renumber or delete the existing `TestComputeSignalScore` / `TestComputeSignalScoreWithWeights`
   tests. The `_make_bar` reshape reddens them on the current buggy tree (collateral RED under P-06);
   they return GREEN after Step 3. Named collateral-RED tests (C-15, so the executor does not misread
   them as a broken fix): `test_buy_signal_raises_score_above_half` (`:200`),
   `test_sell_signal_lowers_score_below_half` (`:206`), `test_expired_signal_is_ignored` (`:212`),
   `test_future_signal_is_ignored` (`:221`), `test_zero_conviction_uses_default_half` (`:229`),
   and the whole `TestComputeSignalScoreWithWeights` suite (`:236+`). (The two neutral cases
   `test_empty_signals_map_returns_neutral` (`:192`) / `test_no_sources_returns_neutral` (`:196`)
   short-circuit at `scoring.py:14` before the bar read and stay GREEN throughout — correctly not
   listed.) Step 1's new anchor is the
   **sole** `@AC-2` scenario coverage.

**Verification**:
- RED (pre-Step-3, run by `/sdd-execute`): `cd services/xstockstrat-analysis && pytest tests/test_analysis_helpers.py -k "TestComputeSignalScore" -q`
  fails with `AttributeError: timestamp` raised at `scoring.py:17` (the new anchor **and** the
  reshaped collateral tests).
- Lint (C-13 §B / step-constraints §B): `cd services/xstockstrat-analysis && ruff check . && ruff format --check .` passes.
- C-13 verdict: the real `Bar`/`ExternalSignal` builders stay **inline in this one test file** (single
  consumer — `test_screener.py` builds its own differently-shaped bars/signals). No second consumer,
  so no move to `tests/conftest.py`; no `Bar`/`ExternalSignal` builder exists in `tests/conftest.py`
  today and none is created (recon § Test homes; design § Rejected Alternatives — centralization
  rejected as speculative).

---

### Step 2 — test: `ScreenerEngine.screen()` signal-weighted seam returns OK, not a crash (`@AC-1` RED)

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/tests/test_screener.py` — modify

**Reviewers**: xstockstrat-analysis owner — strategy scoring determinism, no look-ahead bias

**Codebase Evidence**:
- The exact repro path: `app/services/screener.py:94` `async def screen(...)` loops over symbols and
  awaits `_eval_symbol` at `:119-129` with **no** per-symbol try/except → an `AttributeError` raised
  inside `_eval_symbol` propagates unwrapped out of `screen()` (reproducing the gRPC UNKNOWN).
- Where the crash is reached: `_eval_symbol` fetches signals (`_fetch_signals`, `:328-342`), and when
  `signals_map` is non-empty and there is a latest bar, calls
  `scoring.compute_signal_score(signals_map, latest_bar, list(request.signal_sources), self._source_weights)`
  at `screener.py:267` — `latest_bar = bars_resp.bars[-1] if closes else None` (`:265`).
- Blend gate: `_fetch_signals` returns `{}` (blend skipped) unless
  `request.signal_sources and request.signal_weight > 0` (`screener.py:329`) — which is why
  technical-only screens never crash.
- **P-06 short-circuit trap (design round-2 constraint):** a formula criterion sets
  `needs_technical=True`; `_eval_symbol` returns `INSUFFICIENT_DATA` at `screener.py:243-251` when
  `len(closes) < 2`, **before** the blend. So the test MUST supply **≥2 bars** with `.time` set on at
  least the last (`bars_resp.bars[-1]`). The bare `bars()` helper (`test_screener.py:30-31`,
  `marketdata_pb2.Bar(close=c)`) sets **no** `time` — a signal against an unset (epoch) bar time would
  be window-excluded, so this test builds its own time-stamped bars rather than reusing `bars()`.
- Existing test harness to reuse (do not re-implement): `make_engine(marketdata, indicators,
  ingest=None, cfg=None)` at `test_screener.py:52-53` (`ScreenerEngine(md, ind, ingest or AsyncMock(),
  cfg or make_cfg(), {})`); `make_cfg(**overrides)` at `:16-27`; `formula_resp(value)` at `:34-37`;
  `formula_criterion(...)` at `:40-49` (builds a `SCREEN_KIND_TECHNICAL_FORMULA` criterion). The file
  already imports `AsyncMock, MagicMock` (`:5`), `marketdata_pb2` (`:10`), `analysis_pb2` (`:9`),
  `ScreenerEngine` (`:13`).
- Signal wiring proto (open thread resolved at /sdd-spec): the ingest stub returns
  `ingest_pb2.QuerySignalsResponse(signals=[...])` — field name **`signals`** confirmed at
  `packages/proto/ingest/v1/ingest.proto:136-139` and consumed at `screener.py:337`
  (`for sig in sig_resp.signals`). `ExternalSignal` fields confirmed at `ingest.proto:105-117`
  (see Step 1). Import needed: `from gen.ingest.v1 import ingest_pb2` (not yet imported in this file).

**TDD**: `red-green required`

**Covers**: `AC-1`

**Instructions**:
1. Add `from gen.ingest.v1 import ingest_pb2` to the imports.
2. Add `async def test_signal_weighted_screen_returns_ok_not_crash()` exercising the real
   `ScreenerEngine.screen()` seam (design § RED test #2):
   - Build **≥2** real `marketdata_pb2.Bar` with `.time` set (at least on the last), e.g. two bars a
     day apart around a reference instant `T`; set `close` on each so `len(closes) >= 2`. Do **not**
     reuse the `bars()` helper (it leaves `time` unset). Wire
     `md = AsyncMock(); md.GetBars = AsyncMock(return_value=SimpleNamespace(bars=[...]))`.
   - `ind = AsyncMock(); ind.ExecuteFormula = AsyncMock(return_value=formula_resp([<value>]))` and
     `ind.ComputeIndicator = AsyncMock(...)` permissive (RSI/ATR display reads at `screener.py:297-298`
     are best-effort; a plain `AsyncMock` return is fine).
   - `ingest = AsyncMock(); ingest.QuerySignals = AsyncMock(return_value=ingest_pb2.QuerySignalsResponse(
     signals=[ingest_pb2.ExternalSignal(source="fundamentals", direction="buy", conviction=0.8)]))`
     with `valid_from`/`valid_until` `.FromDatetime(...)` **straddling** the last bar's time (so the
     signal is in-window and the blend actually contributes).
   - `engine = make_engine(md, ind, ingest=ingest)`.
   - Request (the exact staging repro): `analysis_pb2.ScreenSymbolsRequest(symbols=["AARD","BABA","WLTH"],
     criteria=[formula_criterion(...)], signal_sources=["fundamentals"], signal_weight=1,
     technical_weight=0)`. A `formula_criterion` supplies the `needs_technical` criterion; the ≥2
     time-set bars clear the `INSUFFICIENT_DATA` short-circuit.
   - Assertions: `resp = await engine.screen(req)`; every `r.status == SCREEN_RESULT_STATUS_OK` for the
     returned results and **no** `AttributeError` escapes. Add a **positive "blend actually ran"**
     assertion (design round-2 constraint) so a future earlier-return can't make the test pass without
     reaching `scoring.py:17`: assert the in-window buy signal moved the outcome off the neutral
     baseline — e.g. a companion assertion that a result whose signal is in-window scores materially
     differently from the same setup with the signal out-of-window / absent (the `signal_score` default
     is `0.5` at `screener.py:218`; an in-window buy at 0.8 blends toward `0.9`).
3. Keep the existing `test_screener.py` tests untouched (the `bars()` helper and its callers do not set
   `time` and are unaffected by this fix — they exercise technical-only paths).

**Verification**:
- RED (pre-Step-3, run by `/sdd-execute`): `cd services/xstockstrat-analysis && pytest tests/test_screener.py -k "signal_weighted_screen_returns_ok" -q`
  fails with `AttributeError: timestamp` propagating out of `screen()`.
- Lint: `cd services/xstockstrat-analysis && ruff check . && ruff format --check .` passes.
- C-13 verdict: the time-stamped `Bar` list and the `QuerySignalsResponse`/`ExternalSignal` literals
  stay **inline** — single consumer (this test), different shape from Step 1's single-`Bar` builder.
  No centralization (design § Rejected Alternatives).

---

### Step 3 — service: fix the bar-time field name in `compute_signal_score` (GREEN)

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/app/services/scoring.py` — modify

**Reviewers**: xstockstrat-analysis owner — strategy scoring determinism, no look-ahead bias

**Codebase Evidence**:
- The single wrong access: `app/services/scoring.py:17` `bar_ts = bar.timestamp.ToDatetime()`. `bar_ts`
  is used only by the validity-window gate at `scoring.py:27,29` (`bar_ts < valid_from` / `bar_ts >
  valid_until`), compared against `sig.valid_from/valid_until.ToDatetime()` (`:25`). Both sides are
  `google.protobuf.Timestamp.ToDatetime()` → naive-UTC `datetime`, so the rename changes neither
  comparison type nor semantics.
- The marketdata `Bar` proto has `google.protobuf.Timestamp time = 2` and **no** `timestamp` field
  (`packages/proto/marketdata/v1/marketdata.proto:44-46`).
- `bar.time` is the established in-service convention: `app/services/evaluator.py:43` comment
  ("`bar.time` (NOT `bar.timestamp`)"), `app/handlers/servicer.py:3920`
  (`diag.timestamp.CopyFrom(bar.time)`).
- No other latent `bar.timestamp` reader on a marketdata `Bar` in the service (recon § Risks — other
  `.timestamp` reads are on `intent`/backtest-`SymbolDiagnostics` protos that legitimately have a
  `timestamp` field). This is the sole site.

**TDD**: `red-green required`

**Covers**: `—`

**Instructions**:
1. In `services/xstockstrat-analysis/app/services/scoring.py:17`, change
   `bar_ts = bar.timestamp.ToDatetime()` to `bar_ts = bar.time.ToDatetime()`. That line only — no
   other edit to `scoring.py` (every `sig.*` read is already correct).

**Verification**:
- GREEN — full suite + coverage threshold (C-08): `cd services/xstockstrat-analysis && pytest --cov=app --cov-fail-under=40`
  passes, including Step 1's anchor + reshaped collateral tests and Step 2's engine test; confirm total
  coverage ≥ 40%.
- Lint: `cd services/xstockstrat-analysis && ruff check . && ruff format --check .` passes.
- Grep confirming the fix and no residual reader:
  `grep -rn "bar\.timestamp" services/xstockstrat-analysis/app/` returns **no** hit on a marketdata
  `Bar` (the site at `scoring.py:17` is gone).
- **Required manual dev smoke (design build-order step 7 / open risk — not optional):** against dev,
  a signal-weighted `screen_symbols` (via the agent MCP `screen_symbols` tool or the `/insights`
  screener) with `signal_sources` set and `signal_weight > 0` returns `SCREEN_RESULT_STATUS_OK` (not
  gRPC UNKNOWN). Record the result in `context.md`. The mocked tests cannot prove this live edge — it
  is the exact staging failure mode.

---

## Deviation Log

_Populated by /sdd-execute as implementation proceeds._
