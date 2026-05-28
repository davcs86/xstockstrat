# Feature: timescaledb-retention

**Lifecycle Status**: `idea`
**Development Branch**: `feature/timescaledb-retention`
**Created**: 2026-05-27
**Last Updated**: 2026-05-27

---

## Summary

Add data retention and cleanup policies for TimescaleDB hypertables. Retention was removed from the
initial migrations because DO managed PostgreSQL runs the Apache 2.0 edition of TimescaleDB, which
does not include `add_retention_policy`. Without retention, all tables grow unboundedly.

## Affected Tables

| Table | Original retention | Priority | Notes |
|---|---|---|---|
| `marketdata.quotes` | 90 days | **High** | Real-time tick data — fastest growing table |
| `ledger.events` | 2 years | Medium | Append-only but bounded domain |
| `marketdata.ohlcv` | 5 years | Low | Bar data grows slowly |
| `portfolio.snapshots` | 3 years | Low | Infrequent writes |

The `marketdata.quotes` table should be addressed first — tick-level data at market hours
accumulates significantly faster than the other tables.

## Also in scope: `ohlcv_1h` continuous aggregate

The `marketdata.ohlcv_1h` materialized view (1-hour OHLCV from 1-min bars) was created `WITH NO DATA`
and the automated refresh policy was removed (TSL). It must be refreshed manually on demand:

```sql
CALL refresh_continuous_aggregate(
    'marketdata.ohlcv_1h',
    NOW() - INTERVAL '3 hours',
    NOW()
);
```

A periodic refresh mechanism (pg_cron, application-level scheduler, or DO App Platform job) should
be added as part of this feature.

## Options to Evaluate

1. **Upgrade to Timescale Cloud or paid tier** — enables `add_retention_policy` natively
2. **pg_cron** — schedule `DROP TABLE` or `DELETE` on old chunks (Apache-compatible)
3. **Application-level cleanup job** — a scheduled DO App Platform job that runs SQL cleanup
4. **Manual operational runbook** — document cleanup SQL and run periodically

## Next Action

Monitor `marketdata.quotes` table size after first week of production data to assess urgency.

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-05-27 | `idea` | session | Backlogged — TSL features removed from migrations due to DO Apache edition |
