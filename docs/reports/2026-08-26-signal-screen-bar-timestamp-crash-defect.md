# Defect: Signal-weighted screen_symbols crashes — scoring reads bar.timestamp, proto field is bar.time

**Recorded**: 2026-08-26
**Severity**: SEV-2
**Impact type**: signal-screen-crash
**Environment**: dev (main-dev)
**Affected service(s)**: xstockstrat-analysis
**Config-only fix possible**: no

## Observed

Any `ScreenSymbols` call that requests a signal blend — `signal_sources` non-empty **and**
`signal_weight > 0` — fails server-side with:

```
grpc StatusCode.UNKNOWN
details = "Unexpected <class 'AttributeError'>: timestamp"
```

Reproduced on staging via the agent `screen_symbols` MCP tool with
`signal_sources=["fundamentals"]` at both `signal_weight=1, technical_weight=0` and
`signal_weight=0.5, technical_weight=1`. The crash is **source-agnostic** — the scoring helper is not
specific to `fundamentals`, so signal-weighted screening is broken for every signal source
(newsletter signals included), not only the new fundamentals producer.

Discovered during the feature-154 fundamentals-producer first-cycle check-in: the producer ran and
its `fundamentals` (`source_type: derived`) source registered correctly, but the documented way to
view/consume its signals — `screen_symbols` with the fundamentals signal source — crashes.

## Expected

A signal-weighted screen returns ranked results blending the signal conviction with the technical
score, exactly as a technical-only screen does. Baseline confirmation: the same three symbols
(`AARD`, `BABA`, `WLTH`) screened with a technical RSI criterion and **no** `signal_sources` return
`SCREEN_RESULT_STATUS_OK` results — so only the signal-blend path is broken.

## Reproduction

1. Staging, agent MCP. Confirm the source exists: `list_signal_sources` → shows
   `slug: fundamentals`, `source_type: derived`.
2. `screen_symbols(symbols=["AARD","BABA","WLTH"], signal_sources=["fundamentals"], signal_weight=1, technical_weight=0)`
   → gRPC UNKNOWN `Unexpected <class 'AttributeError'>: timestamp`. (Also fails with
   `signal_weight=0.5, technical_weight=1`.)
3. Baseline (works): `screen_symbols(symbols=["AARD","BABA","WLTH"], criteria=[{rsi14 technical indicator}], technical_weight=1)`
   with no `signal_sources` → returns OK ranked results.

## Evidence

`services/xstockstrat-analysis/app/services/scoring.py:17`
> `    bar_ts = bar.timestamp.ToDatetime()`

`packages/proto/marketdata/v1/marketdata.proto:44` (the `Bar` message the caller passes)
> `  google.protobuf.Timestamp time = 2;`   ← field is `time`, there is no `timestamp` field

`services/xstockstrat-analysis/app/services/screener.py:268` (caller — passes a marketdata `Bar`)
> `                    signals_map, latest_bar, list(request.signal_sources), self._source_weights`

`services/xstockstrat-analysis/app/services/screener.py:329` (the gate that reaches the crash)
> `        if not request.signal_sources or request.signal_weight <= 0:`  (skips the blend → why the technical-only baseline works)

Corroborating: `services/xstockstrat-analysis/app/services/evaluator.py:43` already documents the
correct field — "``bar.time`` (NOT ``bar.timestamp``)".

## Root cause hypothesis

`compute_signal_score` reads `bar.timestamp`, but the marketdata `Bar` proto exposes the candle time
as `bar.time` (a `google.protobuf.Timestamp`). Accessing the non-existent `.timestamp` attribute
raises `AttributeError: timestamp`, which the servicer surfaces as a gRPC UNKNOWN. The one-line fix is
`bar.timestamp` → `bar.time` at `scoring.py:17`; add a regression test that a signal-weighted
`ScreenSymbols` returns OK (the RED assertion crashes on the current code). Worth a quick grep for any
other `bar.timestamp` reader on a marketdata `Bar` in the same service.

## Confidence

high
