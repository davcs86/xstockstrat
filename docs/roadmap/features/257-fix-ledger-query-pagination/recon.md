# Recon: fix-ledger-query-pagination

**Created**: 2026-10-21
**From**: product-spec.md
**Affected services**: xstockstrat-ledger, xstockstrat-portfolio

---

## Objective

The ledger `QueryEvents` sends a `next_page_token` but never reads one, and its page size has no cap (D-13). Portfolio
`GetPnL` follows that token, so it reads page 1 again and again. When a page call fails it logs `slog.Warn` and
`break`s, then returns a partial or duplicated realized sum as success (D-46). The `StreamEvents` history replay is one
unbounded `pool.query` on a `DB_POOL_MAX=1` pool, so it can starve `AppendEvent` (D-27). The fix adds keyset paging on
`sequence` with a capped page size, makes `GetPnL` fold every fill exactly once and fail closed, and replays history in
bounded batches. This feature must merge before or together with 251.

## Codebase Map

- **`xstockstrat-ledger`** (Node.js 24, TypeScript, `node --experimental-strip-types --test`)
  - Entry point: `services/xstockstrat-ledger/src/index.ts:40` (`new Pool({...})`), with
    `:44` `max: parseInt(process.env.DB_POOL_MAX ?? '1', 10)`
  - Handler, `queryEvents`: `services/xstockstrat-ledger/src/grpc/ledgerServiceImpl.ts:124`
    - The WHERE builder is `conditions[]` / `params[]` / `let p` at `:126-156`. It filters on `stream_key`,
      `event_type`, `source_service`, the `occurred_at` range, and `sequence >= fromSequence`.
    - `:157` `const limit = req.page?.pageSize || 100;`. There is no cap.
    - `:162` `` `SELECT * FROM ledger.events ${where} ORDER BY recorded_at ASC LIMIT $${p}` ``. The query fetches
      `limit+1` rows, and `:166` is the `hasMore` probe.
    - `:171` `nextPageToken: hasMore ? rows[rows.length - 1].event_id : '', totalCount: rows.length`.
      `req.page.pageToken` is never read.
  - Handler, `streamEvents`: `ledgerServiceImpl.ts:182`
    - `:191` seeds `let maxSeq = req.fromSequence ? req.fromSequence - 1 : 0;`.
    - `:195-198` is `writeRow`, which bumps `maxSeq` and calls `call.write(rowToEvent(row))`. It ignores the
      `write()` return value and never waits for `drain`.
    - `:202` is the subscribe-before-replay call (`notifier.subscribe`), and the buffer is used while `live=false`.
    - `:222-231` holds `cleanup` and the `cancelled`/`close`/`error` hooks.
    - `:235-243` is the replay: one `this.pool.query(... ORDER BY sequence ASC)` with no LIMIT, then
      `for (const row of result.rows) writeRow(row)`.
    - `:244-248` is the catch, which calls `cleanup(); call.destroy(err)`.
    - `:251` `if (cleaned) return;`.
    - `:255-259` is the synchronous buffer flush (deduped by `row.sequence > maxSeq`) followed by `live = true`.
  - Export cursor precedent: `ledgerServiceImpl.ts:11` `const EXPORT_BATCH_SIZE = 1000;` and `:13`
    `function readCursor(cursor, rowCount)`.
    - `:333` `protected async streamExportRows(...)` opens a dedicated `new Client({...})` at `:339` and runs
      `client.query(new Cursor(sql, params))` at `:342`.
    - The export SQL orders `ORDER BY sequence ASC` at `:316`.
  - Row mapping: `rowToEvent` at `ledgerServiceImpl.ts:364`, with `sequence: row.sequence` at `:375`.
  - Live notifier: `services/xstockstrat-ledger/src/services/eventNotifier.ts:124` `row = JSON.parse(msg.payload);`
  - Last migration: `003_events_user_id.up.sql` (`services/xstockstrat-ledger/migrations/`)
  - Schema: `migrations/001_ledger_events_hypertable.up.sql`
    - `:21` `sequence BIGINT NOT NULL DEFAULT nextval('ledger.global_sequence')`.
    - `:22` `PRIMARY KEY (event_id, recorded_at)`.
    - `:43-44` `idx_events_sequence ON ledger.events (sequence)`.
  - Config-read pattern: `ledgerServiceImpl.ts:284` `this.config.getBool('ledger.export.enabled', true)` and `:294`
    `this.config.getInt('ledger.export.max_window_days', 365)`.
  - Invariants: `services/xstockstrat-ledger/docs/context-constitution.md:19` LEDGER-2 (subscribe → replay →
    buffer-flush → go-live) and `:20` LEDGER-3 (clients resume from their last `sequence`).
- **`xstockstrat-portfolio`** (Go 1.27, `GOWORK=off`)
  - Handler/servicer: `services/xstockstrat-portfolio/internal/service/portfolio_service.go:722`
    `func (s *PortfolioService) GetPnL(...)`
    - Pass 1 (`order.filled`) runs from `:749` to `:791`.
      - The request sets `SourceService: "trading"` at `:753`, the filter that 251 changes.
      - `Page: &commonv1.PageRequest{PageSize: 500, PageToken: pageToken}` is at `:754`.
      - `:757` `slog.Warn("GetPnL: QueryEvents (filled) failed", ...)` is followed by `break`.
      - The in-process user filter `fill.UserID != userID` is at `:772`, and the mode filter at `:775-783`.
      - The token-follow logic is at `:787-790`.
    - Pass 2 (`order.partially_filled`) runs from `:795` to `:836`. It sets `PageSize: 500` at `:799` and
      `:802` `slog.Warn(... (partially_filled) failed ...)` + `break`.
    - `:829-830` has the comment "Events arrive in recorded_at order; overwrite = keep last" above
      `latestPartials[fill.OrderID] = fill`.
    - `:838-843` applies partials only to orders that are not in `filledOrderIDs`.
    - `:845` `realized := pnl.Fold(fills).Realized`. `pnl` is `github.com/xstockstrat/contracts/pnl`
      (`packages/proto/pnl/pnl.go:48` `func Fold`).
  - Sentinel: `portfolio_service.go:718` `var ErrQuotesUnavailable = errors.New("quotes unavailable")`
  - Error mapping: `services/xstockstrat-portfolio/internal/handler/portfolio_handler.go`
    - `classifyGetPnLError` is at `:425`. It returns `CodeUnavailable` only for `ErrQuotesUnavailable`, and
      `CodeInternal` otherwise (`:427`, `:429`).
    - It is called at `:96`.
    - `toGRPCError` at `:432` maps only `InvalidArgument`, `NotFound`, `PermissionDenied` and `Unavailable`
      (`:434-446`). Everything else becomes `codes.Internal`.
  - Last migration: not relevant (no portfolio DB change)
  - Other `QueryEvents` caller: `HydrateStops` at `portfolio_service.go:534`
    (`QueryEventsRequest{EventType: "order.filled"}`, no `Page`, so the default 100)
- **Other `QueryEvents` callers (FR-4 regression surface, not fix sites)**
  - Trading: `services/xstockstrat-trading/internal/service/trading.go:2222`, in `resolveUnknownIntents`
    (`StreamKey: "order:<id>"`, `EventType: "order_intent.late_response_conflict"`, no `Page`).
  - UI BFF: `services/xstockstrat-ui/src/lib/traderBff.ts:118` and `src/lib/insightsBff.ts:151`.
  - UI callers: `usePositionLineage.ts:16`, `useReconciliationStatus.ts:12`, `CopilotRail.tsx:55` and
    `PerformanceDashboard.tsx:63` (which sets `pageSize: 500, pageToken: ''` at `:65`).

## Patterns to REUSE

- Bounded replay (FR-7) → reuse `readCursor` (`ledgerServiceImpl.ts:13`) together with a dedicated
  `pg.Client` + `Cursor` (`streamExportRows`, `:333-352`). It is `protected`, so tests can subclass it. Or use keyset
  pages on `sequence` through the pool, releasing the connection between batches.
- Batch and cap constants → follow the `EXPORT_BATCH_SIZE = 1000` naming at `ledgerServiceImpl.ts:11`. The spec names
  them `QUERY_EVENTS_MAX_PAGE_SIZE = 1000` and a default of 100 (`:157`).
- Keyset paging → order by `ORDER BY sequence ASC`, as export (`:316`) and replay (`:240`) already do. Append
  `sequence > $n` to the existing `conditions[]`/`params[]` builder (`:126-156`) and keep the `limit+1` probe (`:166`).
  Index: `idx_events_sequence` (migration 001 `:43-44`).
- Token-decode failure → INVALID_ARGUMENT (`code: 3`), the same code the ledger already uses for bad request input.
  Internal failures use `code: 13`.
- Sibling token convention → insights.md:865-867: reuse an existing opaque-numeric-token convention on the same
  `PageRequest`/`PageResponse` shape rather than inventing a new one.
- GetPnL fail-closed (FR-6) → follow the sentinel pattern `ErrQuotesUnavailable` (`portfolio_service.go:718`) and
  `classifyGetPnLError` (`portfolio_handler.go:425`), or pass the gRPC status code through.
- Portfolio paging fake → extend or embed `fakeLedger` (`internal/service/watchlist_service_test.go:254`; its
  `QueryEvents` at `:269` always returns an empty page). The pattern for a scripted `QueryEvents` is
  `stopLedger` (`portfolio_risk_test.go:143-148`).
- GetPnL error-path test → follow `newQuoteSvc` (`portfolio_quote_deadline_test.go:93`) and
  `TestGetPnL_AC5_QuotesUnavailable` (`:268`).
- Ledger unit tests → `makePool` (`src/__tests__/ledgerServiceImpl.test.ts:35`) ignores the SQL.
  `makeIdempotentPool` (`:56`) routes by SQL regex. Other helpers: `makeRow` (`:88`) and `describe('queryEvents')`
  (`:142`). The `totalCount`-is-a-number regression is at `:203-217`.
- Replay-avoids-pool assertion → the export harness tracks `poolQueried` (`ledgerServiceImpl.test.ts:569-621`). It is
  the model if FR-7 moves the replay onto a dedicated Client.
- Classifier test → `TestClassifyGetPnLError` (`internal/handler/portfolio_handler_test.go:39`, feature 229 @AC-5).
  It currently pins "everything else stays Internal", so FR-6 must update that assertion on purpose.
- Fold mirror → `computeRealizedPnL` (`internal/service/portfolio_helpers_test.go:107`) mirrors the two-pass
  collection. Keep it aligned with any change to the passes. `ctxWithUser` is at `watchlist_service_test.go:280`.

## Existing Business Rules (preserve / extend)

- **PRESERVE** `@AC-6` "A long-lived streaming RPC survives a certificate rotation"
  (`docs/sdd/business-rules/platform.feature`, @feature-210). The batched `StreamEvents` replay must keep the
  subscribe, replay, flush and live hand-off and the reconnect/resume behaviour, without dropping data.
- **PRESERVE** `@AC-7` "A one-million-row export streams without buffering the full result set"
  (`docs/sdd/business-rules/platform.feature`, @feature-021). If FR-7 reuses `pg-cursor`, the `ExportEvents` path must
  stay unchanged and unbuffered.
- **PRESERVE** `@AC-1` "Date-range export streams every event as NDJSON in global-sequence order"
  (`docs/sdd/business-rules/platform.feature`, @feature-021). Moving `QueryEvents` and the replay to `sequence` order
  matches this guarantee.
- **PRESERVE** `@AC-11` "The export returns only the authenticated user's own events"
  (`services/xstockstrat-ledger/acceptance/ledger-event-export.feature`, @feature-021). The keyset must compose with
  263's owner predicate and must not weaken per-user scoping.
- **PRESERVE** `@AC-10` "A snapshot write emits an append-only audit ledger event"
  (`services/xstockstrat-ledger/acceptance/snapshot-offline-positions.feature`, @feature-163). `AppendEvent` must still
  commit normally, including while a replay runs.
- **EXTEND** `@AC-5` "GetPnL refuses to report unrealized P&L when a needed quote is unavailable"
  (`services/xstockstrat-portfolio/acceptance/fix-book-portfolio-page.feature`, @feature-229). FR-6 adds a second
  refusal cause: a ledger page error or deadline returns UNAVAILABLE or DEADLINE_EXCEEDED and no `PnLResponse`. The
  quote mapping stays.
- **PRESERVE** `@AC-6` "GetPnL values broker-synced positions from the broker price without a quote fetch"
  (`services/xstockstrat-portfolio/acceptance/fix-book-portfolio-page.feature`, @feature-229). The unrealized side of
  `GetPnL` is untouched.
- **PRESERVE** `@AC-6` "A one-sided quote with a close older than the mark bound is priced from the last close on
  ListPositions while GetPnL stays unpriced"
  (`services/xstockstrat-portfolio/acceptance/fix-after-hours-positions-priced.feature`, @feature-231 @feature-240).
- **PRESERVE** `@AC-13` "Every portfolio read path values the one-sided position identically"
  (`services/xstockstrat-portfolio/acceptance/fix-after-hours-positions-priced.feature`, @feature-231). This is the
  `unrealized_pnl` 19.80 parity check.
- **PRESERVE** `@AC-28` "GetPnL keeps refusing an offline holding without a live quote"
  (`services/xstockstrat-portfolio/acceptance/offline-account-full-pnl.feature`, @feature-240).
- No existing `@AC-*` covers `QueryEvents` paging, ordering, the page cap or `total_count`, the exactly-once realized
  fold, or replay batching and non-starvation. This feature's `@AC-1`..`@AC-7` are net-new. No verdict is CHANGE, so no
  sign-off is required. LEDGER-2 lives only in prose (`docs/context-constitution.md:19`), and platform `@AC-6` is the
  nearest behavioural guard for it.

## Dependencies

- Proto/RPC: none. `PageRequest { page_size = 1; page_token = 2 }` and `PageResponse { next_page_token = 1;
  total_count = 2 }` already exist (`packages/proto/common/v1/common.proto:10-18`). The token stays opaque.
- Migration: none (spec decision). If design proves a filtered keyset scan is too slow, the next free number is `004` in
  `services/xstockstrat-ledger/migrations/`, which needs DBA and service-owner approval (C-07, F-01).
- Config keys: none (spec decision; named constant). The conditional fallback key is `ledger.query.max_page_size`
  (int, default 1000, C-05). It does not exist today, and adding it would need config-team approval and a seed
  migration.
- Inter-service edges: portfolio → ledger `QueryEvents` (gRPC). This is an existing edge and is unchanged. The
  behaviour change also reaches trading (`trading.go:2222`) and the UI BFF (`traderBff.ts:118`, `insightsBff.ts:151`).
- New env vars / ports: none.
- Merge order: `docs/roadmap/features/merge-order.md:21` `## Blocking Dependencies` (header at `:23`:
  `Feature | Must wait for | Reason | Resolved`). It has no 257/251/263/248 row yet. `/sdd-spec` writes the row
  `fix-getpnl-source-service` must wait for `fix-ledger-query-pagination`.

## Risks / Not-found

- **BIGINT typing (verify in design).** No `setTypeParser` exists in `services/xstockstrat-ledger/src`, so pg returns
  `sequence` as a string by default. The live notifier `JSON.parse`s its payload (`eventNotifier.ts:124`), so live
  rows probably carry a number. `maxSeq` starts as a number (`:191`), then takes `row.sequence` (`:196`).
  - Replay-row checks after the first write would compare a string with a string, which is lexicographic: `"10" > "9"`
    is false.
  - Unverified consequence: `maxSeq` stops advancing past a digit-length boundary during replay, so the flush or live
    dedupe could re-deliver rows.
  - The test mocks use numeric `sequence`, so they cannot see this.
  - Any keyset token and batch boundary must compare as numbers (BigInt or a numeric cast) and encode losslessly.
- **FR-6's DEADLINE_EXCEEDED is not reachable today.** Two layers drop it:
  - `classifyGetPnLError` (`portfolio_handler.go:425-429`) turns any non-quote error into `CodeInternal`.
  - `toGRPCError` (`:432-446`) has no `CodeDeadlineExceeded` case, so it becomes `codes.Internal`.
  - Both layers need changes, or design narrows FR-6 to UNAVAILABLE.
- **Same-function overlaps.**
  - 248 (`implementation-ready`) edits the same `streamEvents` subscribe/buffer code (`:202-259`).
  - 263 adds an owner predicate to the same `queryEvents` WHERE builder (`:126-156`). Its directory is not in this
    branch's tree, so its design was not read.
  - 251 (`draft`) edits the same `GetPnL` loops (`:749-836`). The merge order is hard: 257 before or with 251.
  - Design either absorbs 251's one-line `SourceService` fix or relies on the merge-order row.
  - 252 (`implementation-ready`) makes the ledger real-impl tests loadable. This feature's ledger tests probably depend
    on it.
- **Fact correction to product-spec FR-4.** `trading.go:2091` is a portfolio `ListPositions` call (`PageSize: 500`),
  and `:3221` is a bars request (`PageSize: 40`). Neither is a `QueryEvents` call. Grep finds only
  `trading.go:2222` as a trading `QueryEvents` caller. Design and spec should drop the two stray cites.
- **Order switch `recorded_at` → `sequence` (FR-4).** The two can differ only for rows inserted concurrently.
  - `latestPartials` "keep last" (`portfolio_service.go:829-830`) depends on ascending order, and its comment becomes
    stale.
  - `HydrateStops` (`:534`, first 100 oldest `order.filled`, no paging) gets a different first-100 set only under
    concurrent-insert ties.
  - Design records whether either matters.
- **Replay backpressure.** `writeRow` ignores `call.write()`'s return value and never waits for `drain`. Batching alone
  bounds DB holding, not server memory, for the 200k-event replay in AC-5.
- **AC-5 harness not found.** There is no real-TimescaleDB ledger test under `services/xstockstrat-ledger/src/__tests__/`
  (the directory holds `eventNotifier`, `ledgerServiceImpl`, `mtls`, `telemetry` and `telemetry.export`).
  `scripts/integration-test.sh:229-246` exercises the ledger over `LEDGER_URL` HTTP Connect paths
  (`/xstockstrat.ledger.v1.LedgerService/QueryEvents`). The backend is gRPC-only, so that script looks stale. Do not
  assume it can host AC-5. The mocked `makePool` cannot prove keyset, cap or non-starvation semantics either.
- **No `streamEvents` unit test exists**, and no `GetPnL` paging or ledger-error test exists. `fakeLedger` always
  returns an empty page.
- **Ledger traps that apply:**
  - fails.md:3006-3021 (248): on a `DB_POOL_MAX=1` pool, a time bound must exceed the longest legitimate holder, or the
    read must move to a different connection. A pg LISTEN client must run only single-statement autocommit reads.
    The replay design must not move the batched replay onto the LISTEN client.
  - fails.md:2783-2786: a page-token contract claim needs one real-backend check; stubs cannot prove paging.
  - fails.md:2844-2846: verify the loader reads the whole result before treating absence as data.
  - insights.md:176-188: adding correct paging is itself a behaviour change. State the delta: realized P&L changes
    wherever more than 500 platform-wide fills existed.

## Recommended Scope

Advisory only, not binding.

1. **Ledger `queryEvents` keyset + cap (FR-1..FR-4).**
   - Add constants `QUERY_EVENTS_MAX_PAGE_SIZE = 1000` and a default page size of 100.
   - Use an opaque token that encodes the last `sequence`, with numeric-safe decode; a bad token returns code 3.
   - Add `sequence > $n` and `ORDER BY sequence ASC`, and keep the `limit+1` probe.
   - `totalCount` stays as the page length (a number).
   - Plan composition with 263's owner predicate.
2. **Ledger `queryEvents` tests.** Cover AC-1, AC-2 and AC-7 with an SQL-routing mock (the `makeIdempotentPool`
   style), plus the empty token on an exactly-full last page.
3. **Ledger `streamEvents` bounded replay (FR-7).** Use a dedicated-Client `Cursor` with `readCursor`, or keyset pages
   on the pool. Keep LEDGER-2 ordering and a synchronous flush, and fix numeric `maxSeq` comparison. Decide on
   `drain` backpressure. Coordinate with 248's edits to the same block.
4. **Ledger replay tests + AC-5 harness.** Add a unit test for batching and ordering, and a decision on the real-DB
   `DB_POOL_MAX=1` starvation test. No harness exists yet.
5. **Portfolio `GetPnL` fail-closed + exactly-once (FR-5, FR-6).**
   - Return a wrapped sentinel or the gRPC status instead of `Warn`+`break` at `:757`, `:802`.
   - Extend `classifyGetPnLError` and `toGRPCError` for UNAVAILABLE and DEADLINE_EXCEEDED.
   - Update the comment at `:829` to say `sequence`.
   - Decide whether to absorb 251's `SourceService` fix.
6. **Portfolio tests.** Cover AC-3, AC-4 and AC-6 with a scripted paging fake ledger, and preserve platform and
   portfolio `GetPnL` UNAVAILABLE @ACs.
7. **Docs and sequencing.** Add the `merge-order.md` 257 ≤ 251 row (at `/sdd-spec`). Update ledger `CLAUDE.md` and
   `docs/context-constitution.md` if the replay mechanism or paging contract changes, then run the teardown audit.
