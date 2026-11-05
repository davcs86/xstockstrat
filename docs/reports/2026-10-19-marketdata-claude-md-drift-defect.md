# Defect: marketdata doc drift (migration 001 timeframe comment, handler Connect-RPC comment, stale CLAUDE.md line cite)

**Recorded**: 2026-10-19
**Severity**: SEV-3
**Impact type**: doc-drift
**Environment**: dev (main-dev) @ 1302e6d
**Affected service(s)**: xstockstrat-marketdata
**Config-only fix possible**: no
**Source**: `services/xstockstrat-marketdata/docs/context-constitution-findings.md` § Documentation that lies, rows 1–2; `services/xstockstrat-marketdata/CLAUDE.md` Config Keys table (`marketdata.fmp.enabled` row)

## Observed
1. **Migration 001 column comment** lists `'1m','5m','1h','1d'` for `ohlcv.timeframe`. The canonical
   stored set is `15m`/`1h`/`1d`: 1m and 5m are deprecated and unresolvable, and 15m is missing.
2. **Handler doc comment** says `MarketDataHandler` "implements both the Connect-RPC and gRPC service
   interfaces". The service is gRPC-only, and the HTTP/8053 Connect server was removed.
3. **CLAUDE.md line cite**: the `marketdata.fmp.enabled` row cites
   `fundamentalsEnabled()` at `internal/service/marketdata_service.go:1143`. The function is now
   defined at L1638.

## Expected
The comments describe the current timeframe vocabulary and the gRPC-only surface, and the CLAUDE.md
row cites the symbol (`#fundamentalsEnabled`) instead of a line number.

## Reproduction
1. Read `migrations/001_marketdata_hypertables.up.sql:11` and compare it with `internal/timeframe`.
2. Read `internal/handler/marketdata_handler.go:19-20` and compare it with the CLAUDE.md § Ports note (gRPC-only).
3. Read `CLAUDE.md:78`, then open `marketdata_service.go:1143`. It is not `fundamentalsEnabled`, which is at `:1638`.

## Evidence
`services/xstockstrat-marketdata/migrations/001_marketdata_hypertables.up.sql:11`
> timeframe       TEXT            NOT NULL,  -- '1m','5m','1h','1d'

`services/xstockstrat-marketdata/internal/handler/marketdata_handler.go:19`
> // MarketDataHandler implements both the Connect-RPC and gRPC service interfaces, which share

`services/xstockstrat-marketdata/CLAUDE.md:78`
> Read live on every `GetFundamentals`/`GetFundamentalsMulti` call (`fundamentalsEnabled()`, `internal/service/marketdata_service.go:1143`)

`services/xstockstrat-marketdata/internal/service/marketdata_service.go:1638`
> func (s *MarketDataService) fundamentalsEnabled() error {

## Root cause hypothesis
These comments were not updated when features 053/080/143 (timeframes) and the HTTP-port removal
landed. The CLAUDE.md citation is a bare line number that drifted as the file grew.

## Confidence
high
