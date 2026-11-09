# Defect: remaining cancel-caused WARN sites not covered by feature 290

**Recorded**: 2026-11-04
**Severity**: SEV-3
**Impact type**: log-noise-masks-real-failures
**Environment**: dev (main-dev) — Grafana `deployment_environment=staging`
**Affected service(s)**: xstockstrat-portfolio, xstockstrat-marketdata
**Config-only fix possible**: no

## Observed

Feature 290 (`fix-ctx-cancel-warn-flood`) fixes only portfolio `processPositionSync` and marketdata
`fetchAndCacheBars`. The same "work continues / logs WARN after the context is done" shape exists at sites that
were out of scope because no flood was observed for them in the checked window (Loki, 2026-11-04), or because they
have no test seam:

- marketdata: `GetBars: live fetch failed` on a client cancel (`marketdata_service.go:364`); `GetLatestQuote: cache insert failed` (`:564`); warm poller `warm poller: cache insert failed` (`:1152`, `:1173`; 471 lines in 7 days); bar ingest `bar ingest: insert failed` and live-fetch-failed WARNs (`:1305`, `:1311`, `:1318`, `:1326`) — the per-symbol fallback loop issues one WARN per symbol under a done ctx; the residual re-read WARN when a client leaves mid-read (`:377`, `:384`).
- portfolio: `processAccountDeregistered` (`portfolio_service.go:1357-1363`, two WARNs); the `ackAlways` consumers drain buffered events at shutdown with one WARN each — balance sync (`:1511`/`:1535`), bracket update (`:1463`/`:1476`), order-fill consumer (`:174`).

## Expected

Cancel-caused repeats are stopped or quieted (genuine failures keep their WARN), applying the pattern settled in
feature 290's `design.md` where it fits each site.

## Reproduction

1. Roll a staging deploy while the services handle traffic.
2. Query Loki for the messages above around each `shutting down … service` line.

## Evidence

`docs/roadmap/features/290-fix-ctx-cancel-warn-flood/design.md` § Follow-ups
`services/xstockstrat-marketdata/internal/service/marketdata_service.go:364,564,1152,1173,1305,1326`
`services/xstockstrat-portfolio/internal/service/portfolio_service.go:1357-1363,1463,1511`

## Root cause hypothesis

Same as 290: handlers and loops do not consult their context before logging per-item failures. Whether each site
actually floods must be re-checked in Loki before fixing; the warm-poller and ingest loops run on the process
context, which is only canceled at shutdown.

## Confidence

low

## Triage

Open; route with `/sdd-triage --from-report` after 290 lands so its settled pattern can be reused. Also records the
rejected alternative from 290: batching `InsertBars` (`pgx.Batch`/`CopyFrom`) to shrink the write transaction.
