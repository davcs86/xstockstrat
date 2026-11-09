# Defect: GetBars re-fetches live on every call for symbols with no stored bars

**Recorded**: 2026-11-04
**Severity**: SEV-3
**Impact type**: wasted-vendor-calls-and-log-noise
**Environment**: dev (main-dev) — Grafana `deployment_environment=staging`
**Affected service(s)**: xstockstrat-marketdata
**Config-only fix possible**: no

## Observed

`GetBars` live-refetches on the first page whenever a symbol has no stored bars (`refetch := len(bars) == 0`,
`marketdata_service.go:313-332`); the staleness rate limiter (`staleCheckDue` `:343-352`) only covers
stored-but-stale bars. A symbol that never returns bars (delisted/OTC/unknown) therefore causes a live Alpaca call
and a WARN `GetBars: no bars stored and live fetch returned none` (`:329`) on every call. Loki (staging, 7 days):
952 lines in a two-day burst, concentrated on BOSSY, CRTD, DNB and FORL (~238 each); none in the last two hours.

## Expected

A symbol that returned no bars recently is not live-fetched again on every `GetBars` call (negative cache/back-off
or the feature-282 servability gate), with the WARN reported once per state change.

## Reproduction

1. Call `GetBars` repeatedly for a symbol with no stored bars and no vendor data (e.g. DNB).
2. Each call performs a live fetch and logs the WARN.

## Evidence

`services/xstockstrat-marketdata/internal/service/marketdata_service.go:313-332,343-352`
> slog.WarnContext(ctx, "GetBars: no bars stored and live fetch returned none", "symbol", req.Symbol, …)

## Root cause hypothesis

No negative cache on the miss path. Feature 282 (`implementation-ready`, not built) gates these symbols at the
warm-add site (`282 AC-4`: unservable symbols get 0 live fetches) and may remove most of this; servable symbols that
are merely empty (halted/thin) would remain. Feature 291 (ingester hold) deliberately leaves this path alone: changing
a cold fetch that today surfaces an error would alter `@AC-53 @feature-240` and edit lines 282 rewrites.

## Confidence

low

## Triage

Open; re-check Loki after 282 lands before routing with `/sdd-triage --from-report`.
