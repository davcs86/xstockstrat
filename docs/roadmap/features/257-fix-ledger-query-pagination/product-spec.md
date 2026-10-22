# Product Spec: fix-ledger-query-pagination

**Type**: bug
**GitHub Issue**: none. Defect report: `docs/reports/2026-10-21-ledger-query-pagination-defect.md`
**Severity**: SEV-2
**Created**: 2026-10-21

---

## Problem Statement

- **D-13.** **Observed:** `services/xstockstrat-ledger/src/grpc/ledgerServiceImpl.ts:157-171`: `queryEvents` always starts
  at the oldest row (`ORDER BY recorded_at ASC LIMIT pageSize+1`). It returns `nextPageToken` = last `event_id` when the
  page is full and never reads `pageToken`. `pageSize` is uncapped. `totalCount` is the page length. **Expected:** keyset
  resume after `pageToken`, a capped `pageSize`, an empty token on the last page, and every event returned exactly once
  across pages.
- **D-46.** **Observed:** `services/xstockstrat-portfolio/internal/service/portfolio_service.go:749-791`/`:795-836`. `GetPnL`
  follows `nextPageToken` with `PageSize: 500` on unscoped queries, with the user filter in-process at `:772`, `:817`. Beyond
  500 platform-wide events it re-reads page 1 until ctx expiry, then `slog.Warn` + `break`, and returns the duplicated sum
  as success. **Expected:** an exactly-once fold, and any page error or deadline fails `GetPnL` rather than returning a
  partial sum.
- **D-27.** **Observed:** `ledgerServiceImpl.ts:234-243`: the `StreamEvents` replay is one `pool.query` with no LIMIT or
  cursor, on a `DB_POOL_MAX=1` query pool (`src/index.ts:44`). **Expected:** bounded batched replay, for example the
  `pg-cursor` already used by ExportEvents (`:342`) or keyset pages, so `AppendEvent` is not starved.

**Sequencing constraint (load-bearing).** D-46 is masked today by `251-fix-getpnl-source-service`: `GetPnL`'s
`SourceService: "trading"` filter matches zero rows (`portfolio_service.go:753`, `:798`). If 251 merges first and alone,
every user's realized P&L becomes inflated once the platform has more than 500 fills. This feature must merge **before
or together with** 251. Record it in `docs/roadmap/features/merge-order.md` at spec time.

## Reproduction Steps

1. D-13: append 3 events of type `t`. `QueryEvents{event_type:'t', page_size:2}` returns 1 and 2; following the token returns 1 and 2 again.
2. D-46: use a fake ledger mirroring D-13, 501 matching fills for `u-1` and a 200 ms ctx. `GetPnL` returns no error and an inflated `realized_pnl`.
3. D-27: replay from sequence 0 over a large history while calling `AppendEvent` concurrently. The append is blocked for the length of the replay.

## Root Cause Hypothesis

Pagination was half-implemented on the ledger: the response side exists and the request side does not. `GetPnL`
trusts the contract and treats a page error as end-of-data. The replay was written as a single query when history
was small.

## Affected Services

- xstockstrat-ledger (D-13, D-27 fix sites)
- xstockstrat-portfolio (D-46 fix site; `GetPnL` loop error handling)
- Other `QueryEvents` callers that rely on first-page-only behaviour need checking at design time. These include
  trading `resolveUnknownIntents` (`trading.go:2222`), portfolio `HydrateStops` (`portfolio_service.go:534`, no
  paging, first 100 oldest only) and the UI BFF/insights.

## Fix Scope

- [x] No proto changes anticipated (`PageRequest.page_token` / `PageResponse.next_page_token` already exist; the token stays opaque)
- [ ] No database migrations anticipated. Likely none: a keyset on `sequence` uses the existing `idx_events_sequence`
  (`migrations/001_ledger_events_hypertable.up.sql:43-44`). Design to confirm, since a composite `(event_type, sequence)`
  index is an option.
- [ ] No config key changes anticipated. A `pageSize` cap could be a constant or a `ledger.query.*` key; design to decide.

(Update after investigation — remove or replace each item as needed)

## Acceptance Criteria

See `acceptance.feature` — the regression scenario(s) that must fail on the buggy behavior and pass
after the fix (Constitution **C-15**). Plus: existing tests pass; affected service(s) smoke-tested on
dev.

## Out of Scope

- Refactoring unrelated to the bug
- Performance improvements unrelated to the fix
- The `source_service` mismatch itself (feature 251)
- The trimmed-NOTIFY live payload in `StreamEvents` (feature 248)
- Scoping ledger reads by owner (debt-radar D-25, a separate security finding)
