# Feature: timescaledb-compression

**Lifecycle Status**: `idea`
**Development Branch**: `feature/timescaledb-compression`
**Created**: 2026-05-27
**Last Updated**: 2026-05-27

---

## Summary

Add chunk compression to TimescaleDB hypertables to reduce storage costs as time-series data grows.
Compression was removed from the initial migrations because DO managed PostgreSQL runs the Apache 2.0
edition of TimescaleDB, which does not include `add_compression_policy` or `ALTER TABLE ... SET (timescaledb.compress ...)`.

## Affected Tables

| Table | Original policy | Compression segmentby |
|---|---|---|
| `ledger.events` | compress after 3 days | `source_service, event_type` |
| `marketdata.ohlcv` | compress after 7 days | `symbol, timeframe` |
| `marketdata.quotes` | compress after 24 hours | `symbol` |
| `portfolio.snapshots` | compress after 7 days | `portfolio_id` |

## Options to Evaluate

1. **Upgrade to Timescale Cloud or paid tier** — enables TSL features including native compression policies
2. **pg_partman + pg_cron** — partition-level compression via cron job (Apache-compatible)
3. **PostgreSQL native table partitioning + CLUSTER** — no TimescaleDB dependency for compression
4. **Accept uncompressed storage** — viable if DO managed DB storage costs remain acceptable

## Next Action

Evaluate storage growth rate after first month of production data to decide whether compression is urgent.

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-05-27 | `idea` | session | Backlogged — TSL features removed from migrations due to DO Apache edition |
