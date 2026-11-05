# Defect: marketdata re-ingests symbols that never return bars, every cycle, indefinitely

**Recorded**: 2026-11-04
**Severity**: SEV-3
**Impact type**: wasted-vendor-calls-and-log-noise
**Environment**: dev (main-dev) — Grafana `deployment_environment=staging`
**Affected service(s)**: xstockstrat-marketdata
**Config-only fix possible**: no

## Observed

`bar ingest: symbols returned no bars` fires on essentially every 5-minute ingest cycle for the same small set,
sampled as `AXIA, EVTV, LRHC, LXP, PSKY, RAMP` (5–6 of 213–330 symbols). 206–287 lines per day for each of the
last 4 days (1,173 in 7 days) — i.e. these symbols are re-requested from Alpaca forever with no result.

## Expected

A symbol that repeatedly yields no bars is demoted (negative-cached/backed off, or dropped from the warm set) or
reported once with its cause, instead of a recurring WARN and a wasted vendor call each cycle.

## Reproduction

1. Query the staging marketdata logs for `bar ingest: symbols returned no bars` over any day.
2. The same `sample` repeats each cycle.

## Evidence

`services/xstockstrat-marketdata/internal/service/marketdata_service.go:1337-1351` (`reportIngestCycle`)
> slog.WarnContext(ctx, "bar ingest: symbols returned no bars", "timeframe", tf, "missing", len(missing), …)

Loki sample:
> `bar ingest: symbols returned no bars` missing=6 total=330 sample=["AXIA","EVTV","LRHC","LXP","PSKY","RAMP"]

## Root cause hypothesis

The always-on ingester's warm set has no eviction for symbols without data, and the feature 282 OTC filter does not
cover these. Why the feed returns nothing (IEX coverage, renamed/delisted tickers) is unknown — LXP and PSKY look
like live listings, so the cause needs checking. Plausibly also feeds analysis `live_loop` "had no 1d bars" WARNs.

## Confidence

low

## Triage (classification only, 2026-11-04)

Track C (SDD path). No feature directory or number reserved yet; status remains `open`.
