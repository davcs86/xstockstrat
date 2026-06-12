# Historical Data Backfill Runbook

## Overview

Historical market data (OHLCV bars) is stored in `xstockstrat-marketdata`'s TimescaleDB hypertable. Backfills are triggered via `xstockstrat-ingest`, which calls `xstockstrat-marketdata` (the sole Alpaca integration point). This runbook covers planning, triggering, monitoring, and verifying backfills.

---

## Architecture

```
Operator / agent
    │
    ▼
xstockstrat-ingest  (TriggerBackfill RPC)
    │
    ▼
xstockstrat-marketdata  (BackfillBars RPC → Alpaca REST API)
    │
    ▼
TimescaleDB: marketdata.ohlcv hypertable
    │
    ▼
Ledger event: ingest.backfill.completed
```

---

## Manage backfills from the UI (operator-facing)

The `/insights/backfills` page (in `xstockstrat-ui`) is the operator-facing complement to the RPCs
below — create, monitor, cancel, and delete backfills without a `grpcurl` shell. **The page and all
its mutating actions are admin-only** (the access-scope `0x04` ADMIN bit, feature 049): non-admins do
not see the nav entry, and the insights BFF + each backend re-enforce the scope on every mutating
call. Reach it from the insights sub-nav ("Backfills").

| Action | What it does | RPC | Notes |
|---|---|---|---|
| **Create** | Trigger a backfill for one or more symbols over a timeframe + optional date range | `TriggerBackfill` | Same job the gRPC path below creates; `overwrite` re-fetches existing bars |
| **Monitor** | Live status + truthful progress (`bars_processed/bars_total`, `chunks_completed/chunks_total`, `failed_symbols`, `error`) | `GetBackfillStatus` / `ListBackfillJobs` | The page polls on an interval; progress is the real stored count, never fabricated |
| **Filter** | Narrow the job list by status and/or by symbol | `ListBackfillJobs` (`status_filter`, `symbol`) | — |
| **Cancel** | Stop a `QUEUED`/`RUNNING` job; it transitions to `CANCELED` | `CancelBackfill` | **Completed-chunk bars are retained** (no rollback); admin-only |
| **Delete** | Scoped destructive delete of stored bars for a symbol (+ optional range + optional timeframe) | `DeleteBackfilledData` | See the guardrails below |

### Destructive delete — guardrails (FR-5)

`DeleteBackfilledData` is **symbol-scoped on the server**: an empty symbol is rejected, so it can
never become a full-table delete. The UI adds two confirmations:

1. The operator must **type the exact symbol** to enable the Delete button.
2. A **whole-symbol delete** (no date range supplied) requires a **second** typed confirmation
   (`DELETE ALL`).

An optional **delete-window cap** is enforced server-side by the `marketdata.backfill.max_delete_days`
config key (default `0` = no cap; current behavior). When set `> 0`, a single scoped delete whose
date range exceeds that many days is rejected with `InvalidArgument`. A whole-symbol delete (no range)
is exempt from the cap — that is why the UI double-confirms it. The op emits a
`marketdata.backfill.data_deleted` ledger event for audit.

---

## Pre-Backfill Checklist

- [ ] Confirm target symbols are valid (`ListAssets` RPC on xstockstrat-marketdata)
- [ ] Confirm date range does not overlap with existing data (unless `overwrite=true`)
- [ ] Check Alpaca API rate limits: `marketdata.backfill.rate_limit_rps` config key (default: 200 rps)
- [ ] Estimate bar count: `(days × sessions_per_day × symbols)` — avoid single jobs > 1M bars
- [ ] Confirm `ALPACA_API_KEY` / `ALPACA_API_SECRET` env vars are set on xstockstrat-marketdata
- [ ] For large backfills (>90 days, >20 symbols), split into multiple jobs

---

## Step 1 — Trigger a Backfill

### Via gRPC (xstockstrat-ingest)
```python
import grpc
from gen.ingest.v1 import ingest_pb2, ingest_pb2_grpc
from gen.common.v1 import common_pb2
from google.protobuf.timestamp_pb2 import Timestamp
from datetime import datetime, timezone

def ts(dt: datetime) -> Timestamp:
    t = Timestamp()
    t.FromDatetime(dt)
    return t

channel = grpc.insecure_channel('xstockstrat-ingest:50055')
stub = ingest_pb2_grpc.IngestServiceStub(channel)

resp = stub.TriggerBackfill(ingest_pb2.TriggerBackfillRequest(
    symbols=["AAPL", "MSFT", "NVDA", "TSLA"],
    timeframe="1d",
    range=common_pb2.TimeRange(
        start=ts(datetime(2020, 1, 1, tzinfo=timezone.utc)),
        end=ts(datetime(2024, 12, 31, tzinfo=timezone.utc)),
    ),
    overwrite=False,
))
print(f"Job ID: {resp.job_id}, Status: {ingest_pb2.BackfillStatus.Name(resp.status)}")
```

### Via Webhook
```bash
curl -X POST http://xstockstrat-ingest:8055/webhooks/trigger-backfill \
  -H 'Content-Type: application/json' \
  -d '{
{
    "symbols": ["AAPL", "MSFT", "NVDA", "TSLA"],
    "timeframe": "1d",
    "start": "2020-01-01T00:00:00Z",
    "end": "2024-12-31T00:00:00Z",
    "overwrite": false
  }'
```

---

## Step 2 — Monitor Progress

### Poll job status
```python
status = stub.GetBackfillStatus(ingest_pb2.GetBackfillStatusRequest(job_id=resp.job_id))
print(f"Progress: {status.bars_processed}/{status.bars_total} bars")
print(f"Status: {ingest_pb2.BackfillStatus.Name(status.status)}")
```

### Query ledger events for the job
```python
from gen.ledger.v1 import ledger_pb2, ledger_pb2_grpc

ledger = ledger_pb2_grpc.LedgerServiceStub(grpc.insecure_channel('xstockstrat-ledger:50057'))
events = ledger.QueryEvents(ledger_pb2.QueryEventsRequest(
    stream_key=f"backfill:{resp.job_id}",
))
for e in events.events:
    print(e.event_type, e.recorded_at)
```

### TimescaleDB check
```sql
-- Check bars written for AAPL
SELECT
    time_bucket('1 month', time) AS month,
    COUNT(*) AS bar_count
FROM marketdata.ohlcv
WHERE symbol = 'AAPL' AND timeframe = '1d'
GROUP BY month ORDER BY month;
```

---

## Step 3 — Verify Data Quality

```sql
-- Check for gaps in daily bars (days where we expect data but have none)
WITH expected AS (
    SELECT generate_series(
        '2020-01-02'::date,
        '2024-12-31'::date,
        '1 day'::interval
    )::date AS trading_day
),
actual AS (
    SELECT time::date AS trading_day
    FROM marketdata.ohlcv
    WHERE symbol = 'AAPL' AND timeframe = '1d'
)
SELECT e.trading_day AS missing_day
FROM expected e
LEFT JOIN actual a ON a.trading_day = e.trading_day
WHERE a.trading_day IS NULL
  AND EXTRACT(DOW FROM e.trading_day) NOT IN (0, 6)  -- exclude weekends
ORDER BY missing_day;
```

---

## Timeframe Guide

| Timeframe | Typical use | Data density |
|---|---|---|
| `1m` | Intraday strategies, scalping | ~390 bars/day per symbol |
| `5m` | Short-term momentum | ~78 bars/day |
| `1h` | Swing trading | ~7 bars/day |
| `1d` | Position trading, backtesting | 1 bar/day |

> **Warning**: 1-minute bars for 5 years × 100 symbols ≈ 500M rows. Split into yearly jobs.

> **Canonical timeframe vocabulary** (feature 053): the strings above (`1m`/`5m`/`1h`/`1d`) are the
> canonical forms stored in `marketdata.ohlcv.timeframe`. A shared `common.v1.Timeframe` enum
> (`TIMEFRAME_1MIN`/`_5MIN`/`_1HOUR`/`_1DAY`) is now the **preferred** field on the marketdata,
> ingest, and analysis messages (`timeframe_enum`); prefer it in new code. The legacy string
> `timeframe` fields remain for backward compatibility but are **deprecated for one release** (per
> `proto-versioning.md`'s deprecation cycle) and will be removed in a future gated breaking change.
> The marketdata `internal/timeframe` normalizer reconciles legacy aliases — notably `"1Day"`
> (previously sent by the backtest path) now maps to the same stored `"1d"` bars the backfill writes.

---

## Large Backfill Strategy

**Server-side chunking (feature 054)** — you no longer split large jobs by hand. A single
`TriggerBackfill` over a wide range is planned by `xstockstrat-ingest` into chunks bounded by
`ingest.backfill.chunk_window_days` (default 90) and `ingest.backfill.chunk_max_bars` (default
200000, density-aware so 1m ranges produce more, smaller chunks than 1d). Chunks run in parallel up
to `ingest.backfill.max_concurrent_chunks` (default 3), per-chunk progress is tracked in
`ingest.backfill_chunks`, and the job exposes `chunks_total` / `chunks_completed`.

- **Resumable**: if the service restarts mid-job, any incomplete chunks are re-driven on startup
  (re-fetch is safe — marketdata upserts bars idempotently). No manual re-trigger needed.
- **Gaps-only**: set `fill_mode = FILL_MODE_GAPS_ONLY` on `TriggerBackfill` to fetch *only* the
  ranges `marketdata.GetDataCoverage` reports missing — ideal for topping up a partially-covered
  symbol without re-downloading existing bars.
- **Tuning**: lower `chunk_max_bars` for finer progress granularity / smaller Alpaca requests; raise
  `max_concurrent_chunks` to fetch faster (watch `marketdata.backfill.rate_limit_rps`).

You still choose timeframe per job (run 1d first, then 1h, then 1m if you need multiple densities).

---

## Troubleshooting

| Problem | Likely cause | Fix |
|---|---|---|
| Job status `FAILED` | Alpaca API error | Check `ALPACA_API_KEY`, inspect ledger events |
| Job status `PARTIAL` | Some symbols failed | Check `failed_symbols` field, re-run for failed symbols only |
| Rate limit errors | Too many requests | Reduce `marketdata.backfill.rate_limit_rps` config key |
| Missing bars | Market holiday / weekend | Expected — verify with exchange calendar |
| Duplicate bars | `overwrite=false` on re-run | Normal — existing bars are skipped |
| DB disk full | Too much data | Check TimescaleDB compression, adjust retention policy |

---

## Post-Backfill

After a successful backfill:
1. Run data quality SQL checks above
2. Refresh continuous aggregates: `CALL refresh_continuous_aggregate('marketdata.ohlcv_1h', NULL, NULL);`
3. Verify xstockstrat-analysis can load bars for target date range
4. Update `docs/runbooks/historical-backfill.md` with completed date ranges (append to "Completed Backfills" section below)

---

## Completed Backfills Log

| Date | Symbols | Timeframe | Range | Bars Written | Author |
|---|---|---|---|---|---|
| — | — | — | — | — | — |
