# Defect: portfolio (and marketdata) keep working and WARN-flooding after the context is canceled

**Recorded**: 2026-11-04
**Severity**: SEV-3
**Impact type**: log-noise-masks-real-failures
**Environment**: dev (main-dev) — Grafana `deployment_environment=staging`
**Affected service(s)**: xstockstrat-portfolio, xstockstrat-marketdata
**Config-only fix possible**: no

## Observed

When a ledger stream is canceled mid-handler (deploy/restart), `ConsumePositionSyncs` continues its per-position
loop with a dead context. Every symbol logs a WARN and the delete step logs one more, all with
`exception_message="context canceled"`:

- `upsert position from sync failed` — 2,770 lines
- `delete positions not in sync failed` — 545 lines

in 9 hourly bursts over 7 days (largest 582 + 118 lines in one hour on 2026-11-03). The bursts line up with
cluster-wide `config watcher stream error` / `order fill stream error … RST_STREAM CANCEL` events.

Marketdata shows the same class on request contexts: `GetBars: cache insert failed — begin tx: context canceled`
(557 lines, with `GetBars: re-read after cache failed` and `warm poller: cache insert failed` alongside).

## Expected

On a canceled context the handler stops after the first failure and returns the error once (the event is already
redelivered via `boundedRetry`, and a cancel is not a data fault). No per-item WARN storm, no further DB calls.

## Reproduction

1. Restart or deploy the ledger while portfolio is processing an `account.positions.synced` event.
2. Observe one WARN per position plus one for the delete, all `context canceled`.

## Evidence

`services/xstockstrat-portfolio/internal/service/portfolio_service.go:1420-1430`
> slog.WarnContext(ctx, "upsert position from sync failed", "symbol", p.Symbol, "error", err)
> slog.WarnContext(ctx, "delete positions not in sync failed", "account_id", sync.AccountID, "error", err)

`services/xstockstrat-marketdata/internal/service/marketdata_service.go:371`
> slog.WarnContext(ctx, "GetBars: cache insert failed", "symbol", symbol, "error", err)

## Root cause hypothesis

No `ctx.Err()` short-circuit inside the per-item loops and cache-insert paths; cancel is logged as an ordinary
write failure. Burst/deploy correlation is inferred from timestamps, not confirmed against deploy history. The two
services are independent fix sites.

## Confidence

high

## Triage (classification only, 2026-11-04)

Track C (SDD path). No feature directory or number reserved yet; status remains `open`.
