# Product Spec: fix-ledger-query-pagination

**Type**: bug
**GitHub Issue**: none. Defect report: `docs/reports/2026-10-21-ledger-query-pagination-defect.md`
**Severity**: SEV-2
**Created**: 2026-10-21

---

## Problem Statement

**Who is hurt.** A **trader** reading realized P&L from `GetPnL` gets a figure that fails silently. Today it hides the
251 zero-match filter. Once 251 lands and the platform has more than 500 fills, the figure is inflated by duplicated
fills. An **operator or platform service** whose `AppendEvent` arrives during a large `StreamEvents` replay is
blocked on the single query connection. A **UI or agent reader** that pages `QueryEvents` gets page 1 again on every
"next".

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

## Functional Requirements

- **FR-1 (D-13, keyset resume).** `QueryEvents` honours `page.page_token`. It returns the matching events that come
  strictly after the last event of the previous page, in ascending ledger `sequence` order (`sequence` is globally
  monotonic and indexed). Across a full page walk, every matching event committed before the walk passes its sequence
  is delivered exactly once, ascending; a lower sequence committing after the walk passed it is not delivered by that
  walk (operator sign-off 2026-10-22, design gate r2, change (a)). The token stays opaque to callers.
- **FR-2 (D-13, last page).** `next_page_token` is empty if and only if no further matching events exist. A full page
  is the only case that can set a non-empty token. A page that is exactly full with nothing after it returns an empty
  token, so design keeps the existing `limit+1` probe (`ledgerServiceImpl.ts:157-171`).
- **FR-3 (D-13, page cap).** The effective page size is `min(page_size, 1000)`. When `page_size` is 0 or omitted it
  is 100, as today. An oversized `page_size` is clamped to the cap, never rejected. `total_count` is not given new
  semantics in this feature.
- **FR-4 (backward compatibility).** An empty or omitted `page_token` returns the first page, oldest first. Existing
  callers keep working unchanged. All of them use an effective `page_size` ≤ 500, below the cap: portfolio `GetPnL`
  (500, `portfolio_service.go:754`, `:799`), portfolio `HydrateStops` (`:534`), trading `resolveUnknownIntents`
  (`trading.go:2222-2225`, no `PageSize` set, so the default 100), and the UI BFF callers (500 at most, `PerformanceDashboard.tsx:65`). A first-page-only caller gets the oldest first
  page by `sequence`, with the same filter. Today's order is `recorded_at ASC` (`ledgerServiceImpl.ts:162`); `sequence`
  is assigned by `nextval` at insert (migration 001:21), so the two orders can differ only for rows inserted
  concurrently. Design records whether that difference matters to any caller.
- **FR-5 (D-46, exactly-once fold).** `GetPnL` folds every matching `order.filled` event (pass 1) **and** every
  matching `order.partially_filled` event (pass 2) exactly once across all ledger pages. Pass 2 keeps, per order ID,
  the event with the largest cumulative `filled_qty` (strict `>`, so the first one seen wins a tie) instead of the
  former "last event per order ID wins" rule (`portfolio_service.go:829-830`), so the result does not depend on event
  order (operator sign-off 2026-10-22, design gate r2, change (b)). The partial-fill path is covered by the same fix
  as the filled path (trading-domain C-5).
- **FR-6 (D-46, fail closed).** If any `QueryEvents` page call in either pass returns an error or hits the context
  deadline, `GetPnL` returns a gRPC error (`UNAVAILABLE` or `DEADLINE_EXCEEDED`) and no `PnLResponse`. It never
  returns a partial or duplicated realized sum as success. This replaces the `slog.Warn` + `break` at `:757-758` and
  `:802-803`. Design (2026-10-22) meets this through `UNAVAILABLE` only: a ledger deadline is wrapped in the same
  sentinel, and a page that returns the token it was sent is also `UNAVAILABLE`.
- **FR-7 (D-27, bounded replay).** The `StreamEvents` history replay reads in bounded batches, either `pg-cursor` as
  ExportEvents already does (`ledgerServiceImpl.ts:342`) or keyset pages on `sequence`. It must not hold the
  `DB_POOL_MAX=1` query connection for the whole replay, so a concurrent `AppendEvent` is served between batches. The
  replay delivers, in ascending `sequence` order and exactly once, every matching event committed before the walk
  passes its sequence; a lower sequence committing after the walk passed it is not delivered by that walk (operator
  sign-off 2026-10-22, change (a)). The existing
  subscribe → replay → buffer-flush → live hand-off (ledger constitution) is preserved.

## Consumer Surface(s)

- **xstockstrat-ui `/trader` and `/insights` (indirect).** `traderBff.ts:118` and `insightsBff.ts:151` proxy
  `QueryEvents` for `usePositionLineage`, `useReconciliationStatus`, `CopilotRail` and the insights
  `PerformanceDashboard`. They all request the first page only, with `page_size` ≤ 500. Under FR-4 their visible
  output is unchanged, so there is no UI change and no new UI scenario. Any later "load more" control can now rely on
  the token.
- **Portfolio `GetPnL` realized P&L.** The value changes only where it was wrong (FR-5), and failures become explicit
  errors (FR-6). No `xstockstrat-ui` or `xstockstrat-agent` source calls `GetPnL` today (grep of `services/*/src`,
  `services/xstockstrat-agent/app`), so the change has no new UI or agent-tool surface. The user-visible consequence
  is correctness of the P&L figure for any present or future consumer.
- **xstockstrat-agent.** The agent has no `QueryEvents` or `GetPnL` tool. None affected.

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
- Other `QueryEvents` callers that rely on first-page-only behaviour are pinned unchanged by FR-4 / AC-7. These are
  trading `resolveUnknownIntents` (`trading.go:2222`), portfolio `HydrateStops` (`portfolio_service.go:534`, no
  paging, first 100 oldest only) and the UI BFF/insights. Giving `HydrateStops` paging is out of scope.
- Same-function overlaps that design must reconcile: `263-fix-edge-owner-scope` adds an owner predicate to the same
  `queryEvents` WHERE builder, and the keyset must compose with it. `248-fix-ledger-trimmed-notify-payload` edits the
  same `streamEvents` function as FR-7.

## Fix Scope

- [x] No proto changes anticipated (`PageRequest.page_token` / `PageResponse.next_page_token` already exist; the token stays opaque)
- [x] No database migrations (decided). The keyset on `sequence` uses the existing `idx_events_sequence`
  (`migrations/001_ledger_events_hypertable.up.sql:43-44`). A composite `(event_type, sequence)` index is **not** in
  scope. Design may add one only through a new numbered ledger migration, with DBA + service-owner approval, if recon
  shows the filtered keyset scan is too slow.
- [x] No config key changes (decided, with a default recorded). The FR-3 cap is a named ledger constant
  (`QUERY_EVENTS_MAX_PAGE_SIZE = 1000`, default page size 100), not a config key. This mirrors the existing fixed
  default of 100 at `ledgerServiceImpl.ts:157`. If design promotes it to live config, the key must be
  `ledger.query.max_page_size` (int, default `1000`, C-05 `<service>.<category>.<key>`), and it needs config-team
  approval plus a seed migration.
- [x] Merge order (decided by the operator, 2026-10-21): this feature merges **before or together with**
  `251-fix-getpnl-source-service`. The `merge-order.md` row (257 ≤ 251) is written at `/sdd-spec` time, before the
  impl-spec gate.

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
