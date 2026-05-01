# Phase 3 — Implementation Deviations & Decisions

This document captures implementation decisions that deviate from or clarify the Phase 3 specification in `docs/roadmap/implementation-roadmap.md`.

---

## 3A — xstockstrat-indicators

**Status**: Already complete before Phase 3 implementation began.

All 5 RPCs (ComputeIndicator, ExecuteFormula, ListIndicators, RegisterFormula, GetFormula) were fully implemented in `app/handlers/servicer.py`, `app/services/indicators_engine.py`, and `app/services/sandbox.py`. No code changes were required.

---

## 3B — xstockstrat-ingest

### Migration naming
The migration was originally named `002_newsletter_signals.sql` per the roadmap spec, but has been renumbered to `001_newsletter_signals.up.sql` now that golang-migrate is the migration runner. golang-migrate requires sequential numbering starting from 1 with no gaps; the old `002_` name would have caused an error. The `.up.sql` / `.down.sql` suffix pair is the golang-migrate convention adopted across all services.

### Proto stub regeneration
`buf` was not available in the environment. Python stubs were regenerated using:
```bash
python3 -m grpc_tools.protoc -I. -I/usr/local/include \
  --python_out=gen/python --grpc_python_out=gen/python \
  $(find . -name "*.proto" ! -path "./gen/*" | sort)
```
Run from `packages/proto/`. Install grpcio-tools first if needed: `pip3 install grpcio-tools`.

### Asyncpg pool
The asyncpg connection pool is created in `main.py` and passed to `IngestServicer.__init__` as `db_pool`. If `db_pool=None` (e.g. running without DB), `IngestSignal` and `QuerySignals` return `UNAVAILABLE` status. Existing backfill RPCs are unaffected.

### QuerySignals pagination
`PageRequest.page_token` is reused as an integer offset for simplicity (standard cursor-based pagination was not required by the roadmap spec).

---

## 3C — xstockstrat-analysis

### Real gRPC calls
`RunBacktest` makes real gRPC calls to `MarketDataService.GetBars` and `IndicatorsService.ComputeIndicator`. If either service is unavailable, the backtest for that symbol is skipped with a warning log and an empty result set is returned. The call to `IngestService.QuerySignals` is best-effort: failures are logged and the backtest proceeds with technical signals only.

### Backtest strategy
The default strategy is an **SMA 20/50 crossover** (configurable via `strategy_params.fast_period` / `strategy_params.slow_period`). Position sizing is 95% of current equity per symbol.

### In-memory result storage
Backtest results and strategy scores are stored in in-memory dicts (`self._backtests`, `self._strategies`). The roadmap mentions "results cached to DB" but in-memory storage is sufficient for Phase 3 scope. DB persistence can be added in a future phase.

### ScoreStrategy requires prior RunBacktest
`ScoreStrategy` looks up the latest backtest result from `self._backtests`. If no backtest has been run for the strategy, it returns `NOT_FOUND` (rather than the previous stub that always returned 0.72). Callers must run `RunBacktest` first.

### INGEST_ENDPOINT env var
Added `INGEST_ENDPOINT` to `main.py` and `AnalysisServicer` constructor. Default: `xstockstrat-ingest:50055`.

---

## Proto governance note

The addition of `IngestSignal`, `QuerySignals`, `ExternalSignal`, `IngestSignalRequest`, `IngestSignalResponse`, `QuerySignalsRequest`, `QuerySignalsResponse` to `ingest/v1/ingest.proto` is a **non-breaking addition** (new RPCs + new messages). Per the approval flow in `docs/runbooks/approval-flow.md`, this requires 1 service owner approval before merging to main.
