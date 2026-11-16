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

### Via MCP tool (AI agents)

Agents connected to `xstockstrat-agent` trigger the same job through the `trigger_backfill`
MCP tool (feature 066) — no private-network access needed. Full parameter/return/error
reference: `docs/runbooks/mcp-tools.md`.

```text
trigger_backfill(
    symbols=["AAPL", "MSFT", "NVDA", "TSLA"],
    timeframe="1d",                       # "1d"/"1Day" only — only daily bars are supported
    start="2020-01-01T00:00:00Z",
    end="2024-12-31T00:00:00Z",
    overwrite=False,
    fill_mode="gaps_only",                # optional; fetches only missing ranges
    callback_url="https://webhooks.example.net/hooks/<name>",  # optional; https + allowlisted origin
)
→ {"job_id": "…", "status": "BACKFILL_STATUS_QUEUED"}
```

With an accepted `callback_url` the job's terminal event is POSTed to that URL, so polling
`get_backfill_status` is optional; a rejected or unvalidated `callback_url` is an immediate error
and queues no job (allowlist `notify.webhook.allowed_origins`, empty by default).

> The former ingest HTTP webhook (`/webhooks/trigger-backfill`) was removed with the backend
> HTTP servers — the MCP tool and the gRPC/UI paths above are the supported triggers.

### Fundamentals backfill (data kind, feature 198)

Backfills carry a **data kind**: `bars` (daily OHLCV, the default — everything above) or
`fundamentals` (point-in-time fundamentals **filings history**, needed before backtesting a strategy
that uses a `fundamental` operand). A strategy operand reads the latest filing available as-of each
bar (strict `filed_date < bar_date`, T+1 — no look-ahead), so the filings must be stored first.

- **UI**: on `/insights/backfills`, choose **Fundamentals** in the create form's **Data kind**
  selector. Fundamentals are timeframe-independent, so the form omits the timeframe for that kind.
- **MCP tool**: `trigger_backfill(symbols=[...], data_kind="fundamentals")` — the `timeframe` arg is
  ignored (fundamentals bypass the `1d`-only gate). Poll `get_backfill_status` as with bars.

Source: SEC **EDGAR** XBRL companyfacts is the keyless base source (fiscal periods + `filed_date`);
price-derived metrics (`market_cap`, `pe_ratio`) are joined from the symbol's stored OHLCV
point-in-time, and **FMP-Free ratio enrichment is best-effort and cap-bounded** (it reuses the
existing `marketdata.fmp.daily_request_cap`, so it silently degrades — never blocks — when the daily
cap is spent). A strategy operand only resolves when `analysis.backtest.fundamentals.enabled` is ON
(default OFF); while OFF the operand reads hold on every surface.

#### Re-deriving stored periods after a period-builder change (features 223, 348)

Every `fundamentals_history` row carries `derivation_version` (the EDGAR builder's
`edgar.DerivationVersion` when it was written; `0` = pre-versioning). A builder change reaches stored
rows **only** through a fundamentals backfill run on a build with the bumped version. Per symbol the
backfill derives the full period set from SEC and reconciles it with the stored rows of the requested
period types:

- A stored row with the same label, type, `period_end` and `filed_date` as a derived period is
  upgraded **in place** when its version is lower: `eps`, `roe`, `debt_to_equity` and the
  builder-owned `extra_metrics` keys are rewritten and the version stamped; `filed_date`, `currency`
  and the price-join columns are untouched unless `overwrite=true`, which also refreshes the
  price-join of every such row from its fresh statement.
- Every other stored row of a requested type is **replaced**: deleted, and the derived periods
  inserted, in one transaction per symbol. A replacement row is priced at its own filing date; only
  `price` and `dividend_yield` are carried from a stored row with the same `filed_date`.
- A symbol fails with **no write** when the derivation returns nothing, returns no period of a type
  that has stored rows, or shares no reported value with the stored rows (the ticker now resolves to
  another filer). A failed symbol keeps its rows and its version; decide per symbol from the audit.
- The symbol's cached `snapshot_source=edgar` row is deleted whenever a row was re-derived or replaced.

A same-version re-run on a repaired symbol is a no-op.

**The audit command** reports what a backfill would do, without writing. It needs no database
connection: its input is a rows file `{"<SYMBOL>": [<period>, ...]}` built from
`query_fundamentals(symbol, mode="historical")` responses (every page), and it fetches SEC
companyfacts itself. Run it at the commit under test:

```bash
cd services/xstockstrat-marketdata
# what the repair would change (stored version of the lane: 2 on homelab staging, 1 on DO staging)
GOWORK=off go run ./cmd/fundamentals-audit plan -rows A-rows-pre.json -stored-version 2 \
  -user-agent "<SEC User-Agent with a contact>" -rate-limit-rps 5 > A-audit-pre.json
# after the repair: exits 1 when a pass condition fails
GOWORK=off go run ./cmd/fundamentals-audit plan -rows A-rows-post.json -stored-version 3 \
  -user-agent "<SEC User-Agent with a contact>" -rate-limit-rps 5 \
  -post-repair-failed "<comma-separated failed_symbols, or empty>" > A-audit-post.json
# rows whose price-join went from a value to null, per column
GOWORK=off go run ./cmd/fundamentals-audit diff -pre A-rows-pre.json -post A-rows-post.json
```

SEC answers 403 to a `User-Agent` that declares no contact; use the lane's `marketdata/edgar.user_agent`
value. The report lists, per symbol: a guard trip, the identical / delete / insert counts, every row
deleted without replacement with its category (`left_out`, `merged`, `period_type_changed`,
`no_period_derived`), the left-out periods with their reason, and any derived period ending after its
filing. The audit **cannot predict empty price columns**: it sees neither bar nor dividend coverage.
It plans with an open range, so for a symbol whose stored rows are all already correct it also lists
SEC periods older than the range a backfill was asked for.

**Repair after the version-3 deploy (feature 348), one pass per lane.** [RO] is read-only SQL by the
operator (read paths and the query-file convention: `docs/runbooks/operator-db-access.md` and
`docs/roadmap/features/340-fix-fundamentals-roe-unit/design.md` § Step 5), [CFG] a config change,
[OP-W] a write by the operator, [MCP] an MCP call made on the operator's word.

Lane A — homelab staging (stored version 2, `fundamentals.history.enabled` = `true` before the repair):

1. [CFG] Before the merge, set `marketdata/fundamentals.history.enabled` to `false`.
2. [RO] Full-row export for restore:
   `\copy (SELECT * FROM marketdata.fundamentals_history ORDER BY 1,3,2) TO 'A-pre.csv' CSV HEADER`.
   Record `SELECT derivation_version, count(*) FROM marketdata.fundamentals_history GROUP BY 1;`, the
   count of `period_end > filed_date` (query below), `SELECT count(DISTINCT symbol) FROM
   marketdata.fundamentals_history;`, and that `marketdata/fundamentals.history.backfill.period_types`
   reads `both`.
3. [MCP] Symbol list = the union of every watchlist's symbols (`list_watchlists`, then
   `get_watchlist` for each). Compare its size with the distinct-symbol count of step 2; a stored
   symbol outside the union is reported, not skipped silently. Read each symbol's stored periods into
   `A-rows-pre.json` and run the audit `plan`. Review the guard trips, the rows deleted without
   replacement and the left-out periods. Re-run it if the derivation or the planner changes before
   the merge.
4. [OP-W] Merge and deploy. Confirm the build stamps version 3.
5. [CFG] Set the flag to `true`.
6. [MCP] Canary: `trigger_backfill(symbols=["ORCL","CRWD","JEF","BMO","AAPL","LYFT","AXP"],
   data_kind="fundamentals", start="<lane minimum period_end>", overwrite=True)`, polled with
   `get_backfill_status`. Check the served values with `query_fundamentals`: ORCL `Q1-2026` has
   `period_end` 2025-08-31, `filed_date` 2025-09-10 and `stockholders_equity` 24,154,000,000; ORCL
   `Q1-2027` has 2026-08-31, 2026-09-11 and 66,772,000,000; LYFT `Q3-2026` has `roe` 0.942632.
7. [MCP] The remaining symbols in chunks of at most 50, same `start` and `overwrite=True`. Collect
   every job's `failed_symbols`.
8. Pass conditions:
   - [RO] `SELECT count(*) FROM marketdata.fundamentals_history WHERE period_end > filed_date;` is 0.
   - [RO] `SELECT symbol, count(*) FROM marketdata.fundamentals_history WHERE derivation_version < 3 GROUP BY 1;`
     lists only symbols the repair reported failed.
   - [RO] `SELECT symbol, period_type, period_end, count(*) FROM marketdata.fundamentals_history GROUP BY 1,2,3 HAVING count(*) > 1;`
     returns no row.
   - [MCP] Read the stored periods again into `A-rows-post.json`; the audit `plan` with
     `-post-repair-failed` plans no delete and no insert for every symbol the repair did not report
     failed.
   - [MCP] The audit `diff` reports the value → null counts per price-join column. They are reported,
     not a pass/fail figure: a replacement row has an unset column when no daily bar exists within
     14 days before its `filed_date`, when its trailing-12-month dividend window predates the dividend
     fetch, or when its statement lacks the input.
9. Lane A ends with the flag `true`.
10. Restore, only if a pass condition fails and the operator decides so [OP-W]: flag `false`; in one
    transaction delete the listed symbols' rows from `marketdata.fundamentals_history`, load only
    those symbols' lines of `A-pre.csv`, and delete their `marketdata.fundamentals` rows with
    `source='edgar'`.

Lane B — DigitalOcean staging (stored version 1, flag `false` before and after): the flag stays
`false` through merge and deploy. Run steps 2–3 on lane B's data (`-stored-version 1`), then steps
5–8, then set the flag back to `false`. One pass takes version-1 rows to version 3: rows the
derivation reproduces are re-derived in place and their price-join refreshed by `overwrite=True`; all
others are replaced.

---

## Step 2 — Monitor Progress

AI agents poll the same job via the `get_backfill_status` MCP tool (`job_id` → single job;
empty → list recent jobs).

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
| `1d` | Position trading, backtesting | 1 bar/day |

> **Daily is the only requestable interval** (feature 143): every trading-path consumer (the live
> loop, screener technical criteria, the default SMA strategy) evaluates daily bars only, so
> `GetBars`/`BackfillBars`/`TriggerBackfill` reject any timeframe other than `1d`. The
> `TIMEFRAME_15MIN`/`TIMEFRAME_1HOUR` enum values (and, before them, `TIMEFRAME_1MIN`/
> `TIMEFRAME_5MIN`) remain in the proto for wire compatibility but are deprecated and
> no-longer-requestable — `TriggerBackfill` with them returns `INVALID_ARGUMENT`. Historical
> `15m`/`1h` rows already stored stay readable via `GetDataCoverage` and deletable via
> `DeleteBackfilledData` (both deliberately permissive), just never refreshed.

> **Canonical timeframe vocabulary** (feature 053): `1d` is the only requestable canonical form
> (feature 143), while `15m`/`1h` remain canonical forms for already-stored historical rows in
> `marketdata.ohlcv.timeframe`. A shared `common.v1.Timeframe` enum
> (`TIMEFRAME_15MIN`/`_1HOUR`/`_1DAY`) is the **preferred** field on the marketdata,
> ingest, and analysis messages (`timeframe_enum`); prefer it in new code (`TIMEFRAME_15MIN`/
> `_1HOUR` are deprecated-and-unrequestable per feature 143). The legacy string
> `timeframe` fields remain for backward compatibility but are **deprecated for one release** (per
> `proto-versioning.md`'s deprecation cycle) and will be removed in a future gated breaking change.
> The marketdata `internal/timeframe` normalizer reconciles legacy aliases — notably `"1Day"`
> (previously sent by the backtest path) now maps to the same stored `"1d"` bars the backfill writes.

---

## Large Backfill Strategy

**Server-side chunking (feature 054)** — you no longer split large jobs by hand. A single
`TriggerBackfill` over a wide range is planned by `xstockstrat-ingest` into chunks bounded by
`ingest.backfill.chunk_window_days` (default 90) and `ingest.backfill.chunk_max_bars` (default
200000). Chunks run in parallel up
to `ingest.backfill.max_concurrent_chunks` (default 3), per-chunk progress is tracked in
`ingest.backfill_chunks`, and the job exposes `chunks_total` / `chunks_completed`.

- **Resumable**: if the service restarts mid-job, any incomplete chunks are re-driven on startup
  (re-fetch is safe — marketdata upserts bars idempotently). No manual re-trigger needed.
- **Gaps-only**: set `fill_mode = FILL_MODE_GAPS_ONLY` on `TriggerBackfill` to fetch *only* the
  ranges `marketdata.GetDataCoverage` reports missing — ideal for topping up a partially-covered
  symbol without re-downloading existing bars.
- **Tuning**: lower `chunk_max_bars` for finer progress granularity / smaller Alpaca requests; raise
  `max_concurrent_chunks` to fetch faster (watch `marketdata.backfill.rate_limit_rps`).

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
