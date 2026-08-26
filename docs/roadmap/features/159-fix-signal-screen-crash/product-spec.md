# Product Spec: fix-signal-screen-crash

**Type**: bug
**Defect Report**: `docs/reports/2026-08-26-signal-screen-bar-timestamp-crash-defect.md`
**Severity**: SEV-2
**Created**: 2026-08-26

---

## Problem Statement

**Observed:** Any `ScreenSymbols` call that requests a signal blend — `signal_sources` non-empty
**and** `signal_weight > 0` — fails server-side with a gRPC `UNKNOWN` carrying
`Unexpected <class 'AttributeError'>: timestamp`. Reproduced on staging via the agent `screen_symbols`
MCP tool with `signal_sources=["fundamentals"]`. The crash is **source-agnostic** (the scoring helper
isn't fundamentals-specific), so it breaks every signal-weighted screen, including newsletter signals.

**Expected:** A signal-weighted screen returns ranked results blending signal conviction with the
technical score, exactly as a technical-only screen does today.

## Reproduction Steps

1. Staging, agent MCP. `list_signal_sources` shows `fundamentals` (`source_type: derived`) is registered.
2. `screen_symbols(symbols=["AARD","BABA","WLTH"], signal_sources=["fundamentals"], signal_weight=1, technical_weight=0)`
   → gRPC UNKNOWN `Unexpected <class 'AttributeError'>: timestamp`. Also fails at
   `signal_weight=0.5, technical_weight=1`.
3. Baseline (works): the same symbols with a technical RSI criterion and **no** `signal_sources`
   return `SCREEN_RESULT_STATUS_OK`.

## Root Cause Hypothesis

`app/services/scoring.py:17` (`compute_signal_score`) reads `bar.timestamp.ToDatetime()`, but the
marketdata `Bar` proto exposes the candle time as `bar.time` (`packages/proto/marketdata/v1/marketdata.proto`
→ `google.protobuf.Timestamp time = 2`; there is no `timestamp` field). The scoring helper is reached
from `app/services/screener.py` only when `signal_sources` is set and `signal_weight > 0` — which is
why technical-only screens are unaffected. Fix: `bar.timestamp` → `bar.time`. High confidence.

## Affected Services

- `xstockstrat-analysis`

## Fix Scope

- [x] No proto changes anticipated
- [x] No database migrations anticipated
- [x] No config key changes anticipated

Single-line source fix in `app/services/scoring.py` plus a regression test. (Worth a grep for any other
`bar.timestamp` reader on a marketdata `Bar` in the same service.)

## Acceptance Criteria

See `acceptance.feature` — the regression scenario that must fail on the buggy code (red) and pass
after the fix (Constitution **C-15**). Plus: existing tests pass; `xstockstrat-analysis` smoke-tested
on dev (a signal-weighted `screen_symbols` returns OK).

## Out of Scope

- Refactoring the screener/scoring blend beyond the field-name fix.
- Any change to what the fundamentals producer emits (it registers and runs correctly — feature 154).
