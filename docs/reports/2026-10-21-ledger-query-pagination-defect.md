# Defect: Ledger QueryEvents ignores pageToken and StreamEvents replay is unbounded, so GetPnL's pager loops and replay pins the only pool connection

**Recorded**: 2026-10-21
**Severity**: SEV-2
**Impact type**: wrong-pnl-reported
**Environment**: dev (main-dev) @ a053b0e
**Affected service(s)**: xstockstrat-ledger, xstockstrat-portfolio
**Config-only fix possible**: no
**Source**: repo-surveyor debt-radar scan (`docs/repo-surveyor/debt-radar-findings.md` @ 4535695), findings D-13, D-27, D-46. All three were re-verified against main-dev @ a053b0e.

## Observed

### D-13 — Ledger `QueryEvents` returns `nextPageToken` but never reads `pageToken`

`queryEvents` builds its SQL from the filters and `LIMIT pageSize+1`, always starting at the oldest row
(`ORDER BY recorded_at ASC`). Whenever a page is full it returns `nextPageToken` (the last row's `event_id`), but
it never reads `req.page.pageToken`. `pageSize` is uncapped. `totalCount` is the page's row count, not the total.
Any caller that follows `nextPageToken` gets page 1 again on every request.

### D-46 — Portfolio `GetPnL` pages ledger `QueryEvents` and turns the loop into an inflated P&L

Both `GetPnL` passes (`order.filled`, `order.partially_filled`) loop over `QueryEvents` with `PageSize: 500` and
follow `GetNextPageToken()`. Neither query is filtered by user (the user filter is applied in-process), so the
platform-wide event count decides when a page is full. With more than 500 matching events, the loop re-reads
page 1 and appends duplicate fills until the request context expires. The resulting deadline error hits
`slog.Warn(...)` then `break`, and `GetPnL` returns the realized P&L of the duplicated fills as success, not as
an error. With no caller deadline, the loop does not end and memory grows. The defect is masked today:
feature 251 (`fix-getpnl-source-service`) records that both queries filter on the wrong `source_service` and
match zero rows. Fixing 251 alone exposes this as an inflated realized P&L, which bug-triage puts in its
highest severity class ("P&L calculation is wrong").

### D-27 — Ledger `StreamEvents` replay is unbounded and holds the only pooled connection

The `StreamEvents` replay runs one `pool.query` with no `LIMIT` or cursor
(`WHERE … AND sequence >= $3 ORDER BY sequence ASC`). It materialises the full history in memory before
writing a single row. Ledger's query pool is `DB_POOL_MAX=1` (root CLAUDE.md pool budget, `src/index.ts:44`), so a
long replay, such as any portfolio consumer resuming from `fromSequence: 0`, holds the only query connection
and starves `AppendEvent`/`QueryEvents` for its whole duration. `pg-cursor` is already imported and used, but only by
`ExportEvents`.

## Expected

- **D-13:** `QueryEvents` resumes after `pageToken` with a stable keyset (for example the indexed, globally monotonic
  `sequence`), caps `pageSize`, and returns an empty `nextPageToken` on the last page. Paging through N events returns
  each event exactly once.
- **D-46:** `GetPnL` folds each fill exactly once whatever the number of pages. A `QueryEvents` error or deadline makes
  `GetPnL` fail (for example `UNAVAILABLE`) and never returns a partial or duplicated sum as success.
- **D-27:** The replay streams history in bounded batches (cursor or keyset pages), releasing or not monopolising the
  query connection, so a concurrent `AppendEvent` is not starved behind a long replay.

## Reproduction

1. **D-13:** Append 3 events of type `t` and call `QueryEvents{event_type:'t', page:{page_size:2}}`. You get events 1 and 2
   plus a non-empty `next_page_token`. Call again with that token and you get events 1 and 2 again, not event 3.
2. **D-46:** Write a portfolio unit test with a fake ledger that mirrors the real behaviour (ignores `PageToken`, returns a
   non-empty `NextPageToken` when 500 rows match). Seed 501 `order.filled` events for user `u-1` (stored with the source
   service the query uses) and give the ctx a 200 ms deadline. `GetPnL` returns no error and a `realized_pnl` that is a
   multiple of the true value.
3. **D-27:** Seed 1,000,000 ledger events, open `StreamEvents{from_sequence:0}`, and call `AppendEvent` concurrently. The
   append waits until the replay query has fully returned.

## Evidence

### D-13

`services/xstockstrat-ledger/src/grpc/ledgerServiceImpl.ts:157-171`
> const limit = req.page?.pageSize || 100;
> `SELECT * FROM ledger.events ${where} ORDER BY recorded_at ASC LIMIT $${p}`,
> page: { nextPageToken: hasMore ? rows[rows.length - 1].event_id : '', totalCount: rows.length },

`req.page.pageToken` is not referenced anywhere in `queryEvents` (`:124-175`).

### D-46

`services/xstockstrat-portfolio/internal/service/portfolio_service.go:749-791` (pass 1), `:795-836` (pass 2)
> Page:          &commonv1.PageRequest{PageSize: 500, PageToken: pageToken},
> slog.Warn("GetPnL: QueryEvents (filled) failed", "error", err)
> break
> pageToken = resp.GetPage().GetNextPageToken()

The user filter is in-process (`if fill.UserID != userID { continue }`, `:772`, `:817`), not in the request.

### D-27

`services/xstockstrat-ledger/src/grpc/ledgerServiceImpl.ts:234-243`
> `SELECT * FROM ledger.events
> WHERE ($1::text IS NULL OR stream_key = $1)
> AND ($2::text IS NULL OR event_type = $2)
> AND sequence >= $3
> ORDER BY sequence ASC`,

`services/xstockstrat-ledger/src/grpc/ledgerServiceImpl.ts:342` (the only `pg-cursor` use, in ExportEvents)
> const cursor = client.query(new Cursor(sql, params));

`services/xstockstrat-ledger/src/index.ts:44`
> max: parseInt(process.env.DB_POOL_MAX ?? '1', 10),

## Root cause hypothesis

`QueryEvents` pagination was stubbed: the response side was written and the request side never was. Replay was
written as one query because history was small. `GetPnL` trusted the page contract and treats a failed page as
"done" rather than as an error.

## Confidence

high
