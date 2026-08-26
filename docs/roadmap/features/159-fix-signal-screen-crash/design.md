# Design: fix-signal-screen-crash

**Created**: 2026-08-26
**Rounds**: 2 (full; termination: approved)
**Approved by**: user @ 2026-08-26
**Grounded in**: recon.md

---

## Chosen Approach

A one-line source fix plus a two-test regression pair and a ledger-mandated test-mock reshape — all
inside `xstockstrat-analysis`. No proto/migration/config change; internal-only (the fix **restores**
the existing agent `screen_symbols` tool and `/insights` screener paths — no consumer-surface change,
C-14).

**GREEN fix.** `services/xstockstrat-analysis/app/services/scoring.py:17`
`bar_ts = bar.timestamp.ToDatetime()` → `bar_ts = bar.time.ToDatetime()`. That line only. `bar_ts`
feeds only the validity-window gate at `scoring.py:27,29` (`bar_ts < valid_from` / `bar_ts >
valid_until`), compared against `sig.valid_from/valid_until.ToDatetime()` (`:25`); both sides are
`google.protobuf.Timestamp.ToDatetime()` → naive-UTC `datetime`, so renaming the source field leaves
comparison type and semantics identical. `bar.time` is the in-service convention (`evaluator.py:43`
comment, `servicer.py:3920`); the marketdata `Bar` proto has `Timestamp time = 2` and **no**
`timestamp` field (`marketdata.proto:44`). This is the sole wrong access — every `sig.*` read is
correct and there is no other latent `bar.timestamp` reader on a marketdata `Bar` (recon § Risks).

**RED test #1 — `tests/test_analysis_helpers.py` → `test_bar_time_window_gates_signal_contribution`
[@AC-2 RED ANCHOR].** Build a **real** `marketdata_pb2.Bar` with `bar.time.FromDatetime(T)` and a real
`ingest_pb2.ExternalSignal(source="uw", direction="buy", conviction=0.8)` whose `valid_from`/`valid_until`
**straddle T**. Assert `compute_signal_score({"uw":[sig]}, bar, ["uw"]) == pytest.approx(0.9)` — the
exact transform for a single in-window buy at conviction 0.8 (`net=0.8 → (0.8+1)/2 = 0.9`,
`scoring.py:31-42`) — and a paired Bar whose `time` is **outside** the window → `== 0.5` (signal
excluded). The outcome **flips with `bar.time`**, proving the field is read; a bare `score ∈ [0,1]`
check would be vacuous (0.5 on every edge path). RED on current code: `AttributeError: timestamp` at
`scoring.py:17` before either branch. Keep the hard-coded `0.9` (stronger than an inequality — catches a
silent change to the `(net+1)/2` mapping).

**RED test #2 — `tests/test_screener.py` → `test_signal_weighted_screen_returns_ok_not_crash`
[@AC-1].** Exercise the real `ScreenerEngine.screen()` seam — the exact staging repro. Wire with the
existing harness: `md=AsyncMock(GetBars=…)`, `ind=AsyncMock(ExecuteFormula …permissive)`,
`ingest=AsyncMock(QuerySignals=…QuerySignalsResponse(signals=[ExternalSignal(source="fundamentals",
direction="buy", conviction=0.8, valid_from/valid_until straddling the bar time)]))`,
`engine=make_engine(md, ind, ingest=…)` (`test_screener.py:52`). Request: `signal_sources=["fundamentals"],
signal_weight=1, technical_weight=0` plus a permissive formula criterion. Assert every per-symbol
`r.status == SCREEN_RESULT_STATUS_OK` and no `AttributeError`. RED because `signals_map` is non-empty →
`screener.py:267` calls `compute_signal_score(latest_bar, …)` → `AttributeError` propagates unwrapped
out of `screen()` (no per-symbol try/except at `screener.py:119-129`), reproducing the gRPC UNKNOWN.

- **Round-2 constraint (P-06):** a formula criterion sets `needs_technical=True`, so `_eval_symbol`
  short-circuits to `INSUFFICIENT_DATA` and returns at `screener.py:243-251` when `len(closes) < 2`,
  **before** the blend. Test #2 MUST therefore supply **≥2 bars** with `.time` set on at least the last
  (`bars_resp.bars[-1]`, `:265`) — the bare `bars()` helper (`test_screener.py:30-31`) builds
  `Bar(close=c)` with no `time` and would either epoch-exclude the signal or short-circuit. Add a
  **positive assertion that the blend actually ran** (the in-window signal moves `signal_score` off the
  `0.5` default / influences ranking) so a future earlier-return can't make the test pass without
  reaching `scoring.py:17`.

**`_make_bar` reshape (ledger-mandated, `fails.md:725-727`).** Replace `_make_bar`'s body
(`test_analysis_helpers.py:163-167`) from a `MagicMock` to a real `marketdata_pb2.Bar` with
`bar.time.FromDatetime(_seconds_to_datetime(timestamp_seconds))`, signature
`(timestamp_seconds=1704067200) -> Bar` preserved:
```python
def _make_bar(timestamp_seconds: int = 1704067200) -> marketdata_pb2.Bar:
    """Real marketdata Bar with its candle time set (feature 159).
    Was a MagicMock, which auto-vivified `.timestamp` and hid the bar.timestamp/bar.time
    field-name bug; a real proto fails that typo class closed."""
    bar = marketdata_pb2.Bar()
    bar.time.FromDatetime(_seconds_to_datetime(timestamp_seconds))
    return bar
```
This converts the whole existing `TestComputeSignalScore`/`WithWeights` suite to real-proto field
access so this typo class fails closed — the direct answer to the ledger fail feature 064 missed for
`scoring.py`. It reddens the suite on current code (collateral RED under P-06). **Round-2 constraint
(C-15):** the spec names the collateral-RED tests — `test_buy_signal_raises_score_above_half` (`:200`),
`test_sell_signal_lowers_score_below_half` (`:206`), `test_expired_signal_is_ignored` (`:212`), and the
`WithWeights` suite — and asserts they return GREEN post-fix, so the executor doesn't misread them as a
broken fix. Test #1 is the **sole** `@AC-2` anchor. Verified safe: `compute_signal_score` reads only
`bar.time` on the bar, so no test depended on MagicMock auto-vivifying another bar attribute;
`_make_signal` stays a MagicMock (all `sig.*` reads are mock-satisfiable).

**Build order:** (1) reshape `_make_bar`; (2) add test #1; (3) add test #2 (with ≥2 time-set bars +
blend-ran assertion); (4) run → confirm RED (`AttributeError: timestamp` across the scoring suite + the
engine test); (5) apply the `scoring.py:17` rename; (6) run → GREEN; (7) **required** manual dev smoke —
a signal-weighted `screen_symbols` returns OK against dev (product-spec acceptance; covers the live edge
the mocked tests cannot).

## Rejected Alternatives

- **Single new real-`Bar` regression test, leave `_make_bar` a MagicMock** — rejected: re-arms the exact
  blind spot the ledger (`fails.md:725-727`) says hid this bug; the next `bar.<typo>` re-hides. The
  ledger already adjudicated this trade against a minimal diff.
- **`@AC-2` as a bare `score ∈ [0,1]` or a `fields_by_name("timestamp")` descriptor assertion** —
  rejected: vacuous / schema-tautology; passes on both buggy and fixed code, guards nothing.
- **Relax `@AC-2` to a relational inequality (in-window > excluded baseline)** — rejected: `0.9` is
  verified from source and strictly stronger; a hard value also catches a silent change to the
  `(net+1)/2` mapping.
- **Degrade `@AC-1` to the `compute_signal_score` unit seam** — rejected: leaves the exact staging repro
  (the `ScreenerEngine.screen()` path) unverified; round 2 confirmed the engine seam is cleanly wireable
  (no per-symbol try/except → genuinely RED).
- **Centralize a `Bar` builder into `tests/conftest.py` (C-13)** — rejected for now: the two consumers
  need different shapes (single `Bar` vs. a bars list); a shared fixture is speculative abstraction over
  two one-line constructors. Promote only when a genuine third consumer appears.
- **A production guard for unset `bar.time`** — rejected: marketdata always populates `time` (candle
  key); a guard is speculative scope creep. The epoch concern is a test-fixture concern only.

## Open Risks

- [ ] **The mocked edges don't prove a LIVE signal-weighted `screen_symbols` on dev** — the exact
  staging failure mode. Keep the manual dev smoke as a **required, checked** acceptance step (build-order
  step 7), not an optional note. To be verified at execution / before close.
- [ ] **Confirm `ingest_pb2.QuerySignalsResponse.signals` field name** at `/sdd-spec` against
  `ingest.proto` (inferred from `screener.py:337` `for sig in sig_resp.signals`). Target: test #2 step.

## Constitution Rules Touched

- `C-08` / `P-06` — honored: the `service` fix is paired with the RED regression tests; test #1 is
  RED-before-green with a discriminating (non-vacuous) assertion; `@AC-1` red proves the real repro.
- `C-13` — honored: real-`Bar` builder stays local (`_make_bar`); no premature conftest centralization.
- `C-14` — honored: internal-only; the fix restores the existing agent/UI surfaces, no new surface.
- `C-15` — honored: `@AC-1`→test #2, `@AC-2`→test #1 (the sole anchor); collateral-RED tests named so
  traceability is unambiguous.
- `F-01` / `F-06` / `F-07` / `C-09` — n/a and clean: no migration, no pool, no hardcoded config, no proto
  change.

## Business Rules Touched (C-16)

- **None.** No existing `@AC-*` in the `xstockstrat-analysis` acceptance suite covers `ScreenSymbols` /
  signal-weighted screening (recon § Existing Business Rules). The two new regression scenarios are
  net-new coverage — promotion candidates at launch so the crash cannot silently return.
