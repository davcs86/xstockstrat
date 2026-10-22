# Design: fix-getpnl-source-service

**Created**: 2026-10-21
**Rounds**: 9 (full; termination: approved — auto-approved under the operator standing authorization 2026-10-21;
debate cap operator-lifted 5 → 8 → 12)
**Approved by**: orchestrator auto-approval under the operator standing authorization @ 2026-10-21 (gate inputs in
context.md "sdd-design (full) round 9, gate")
**Grounded in**: recon.md, plus debate state grounded at `bec15842`..`e28cce95` (spot-checked at `1d47c0a7`:
`portfolio_handler.go:45`/`:49`/`:96`/`:242`/`:276-282`/`:370`/`:425`/`:432`, `portfolio_handler_test.go:39-48`,
`portfolio_service.go:50-51`/`:64-65`/`:751-755`/`:796-800`/`:1043`/`:1718`, `ci.yml:256`, feature/platform suite
lines; `/sdd-spec` re-greps every line citation)

---

## Chosen Approach

Five fix sites, no proto, migration, config, go.mod/go.sum or ci.yml change, no new runtime edge (recon.md:197-214).
Consumer surfaces (C-14): `/trader/positions` fill-lineage sheet (FR-3) and the `GetPnL` RPC, which has no in-repo UI
or agent caller (product-spec.md:76-84; `/sdd-spec` re-confirms no runtime caller under `services/xstockstrat-ui/src`
and `services/xstockstrat-agent/app`).

### 1. Ledger keyset paging (FR-5) — ledger becomes a fix site

The ledger never reads the request `page_token`, so FR-1 would turn GetPnL's page loop into a page-1 replay
(recon.md:69-74, :218-235).

- New strip-safe module `services/xstockstrat-ledger/src/grpc/queryEventsPage.ts` owns: the predicate builder moved
  from `ledgerServiceImpl.ts:126-156`, keyset SQL, cursor encode/decode, the full `page` object
  (`{nextPageToken, totalCount: rows returned}`, per `ledgerServiceImpl.test.ts:208-221`) and error mapping
  (`InvalidPageTokenError` / PG 22007 / 22008 / 22P02 → code 3; anything else → 13).
- `queryEvents` (`ledgerServiceImpl.ts:124-176`) becomes a thin delegate:
  `callback(null, {events: rows.map(rowToEvent), page})`. `rowToEvent` stays (248 overlap).
- Cursor: opaque base64url(`<epoch_us>.<event_id>`). SELECT emits `(extract(epoch from recorded_at)*1000000)::bigint`
  as `cursor_us` (pg int8 → decimal string; the encoder throws a plain Error → 13 if missing/malformed). Predicate in
  expanded form for chunk exclusion: `recorded_at >= $ts AND (recorded_at > $ts OR event_id > $id::uuid)`, with
  `$ts = 'epoch'::timestamptz + $us * interval '1 microsecond'` — never `to_timestamp(double)`. ORDER BY
  `recorded_at ASC, event_id ASC` replaces `:162` (recon.md:72).
- Premise correction: production `recorded_at` is millisecond-precision, app-stamped by `appendEvent` from JS
  `new Date()` (`ledgerServiceImpl.ts:35`, `:56`), not `DEFAULT NOW()`. The µs cursor is still correct.
- Strip/tsc dual-load constraint: no enums, parameter properties, namespaces, or relative runtime imports
  (`import type` only; fails.md:2239-2241).
- Tests: unguarded `src/__tests__/queryEventsPage.test.ts`; real-PG `src/__tests__/pg/queryEventsKeyset.test.ts`
  (fails, not skips, without `LEDGER_PG_TEST_URL`; 7 rows on one `recorded_at` across pageSize 3, ms ties, separate
  chunks, cursor + event_type/source_service filters; drains ≥ 2 pages under an iteration cap, each event_id exactly
  once in order). New CI job `ledger-pg-test` on the TimescaleDB image (copies the migration-rerun container,
  `ci.yml:640-658`; SEED_USER_ID scoping per `ci.yml:667`), added to the aggregate job's needs. RED: step 1 is a pure
  extraction keeping today's SQL (page 2 repeats page 1 → RED); step 2 is the keyset fix (GREEN).
- 252 reconciliation (B8): 251 edits `ledgerServiceImpl.test.ts` — `makeRow` (`:88-103`) gains
  `cursor_us: '1704067200000000'`; the hasMore case (`:172-187`) decodes the token to the last row's
  `(cursor_us, event_id)`. These stay behind `if (!impl) return;` until 252 lands (accepted residual). One-off
  compiled run (scratch tsconfig excluding `mtls.test.ts`/`queryEventsPage.test.ts`, `node -e` import of the compiled
  impl, `node --test` on the compiled test) recorded as evidence, not a CI guard. Soft merge-order row (precedent
  `merge-order.md:35`) naming who reconciles; matching note appended to 252's context.md.
- Ledger CLAUDE.md documents the opaque `page_token` (teardown).

### 2. Portfolio GetPnL (FR-1, FR-2, FR-4)

Fix site `GetPnL` (`portfolio_service.go:722-853`; recon.md:21-36).

- **FR-1.** One const `tradingSourceService = "xstockstrat-trading"` replaces the two bare literals
  `portfolio_service.go:753` (order.filled pass, `:751-755`) and `:798` (order.partially_filled pass, `:796-800`) —
  NOT `:752`, which is `EventType`. `drainTradingEvents(ctx, eventType, visit)` replaces both loops. The extended
  source-service parity test asserts the GetPnL reader value = the testdata builders' value = trading's producer
  literal `trading.go:3667` (recon.md:51-52, :262-264; fails.md:1708).
- **Fail-closed drain** (replaces the silent `slog.Warn` + `break`, recon.md:236-238): `ErrRealizedUnavailable`
  (UNAVAILABLE, logged ERROR) on a QueryEvents transport error, a repeated next token, a repeated event_id
  (seen-event_id set), or an empty page that still carries a token. No page cap.
- **Five-stage pipeline** in the visit callback: decode → user filter (`:772`) → mode filter (`:775-783`) → dedup
  (`:784`, `:838-840`, unchanged) → buffer for side resolution. Side lookups, the unresolved-side check and the
  mixed-era check run only over the caller's buffered fills (B5).
- **FR-2 side resolution.** `orderFillPayload` (`:245-260`) gains `Side`. `signedQty` (unexported) accepts only
  `ORDER_SIDE_BUY` / `ORDER_SIDE_SELL` — deliberately stricter than `offlineFillsFromOrders` (`trading.go:876-886`,
  recon.md:94-97), which treats UNSPECIFIED as buy. A fill whose payload carries `side` needs no lookup. For the
  caller's side-less fills only: NO preload; sequential per-distinct-order StreamKey lookups (bare order id,
  recon.md:100-102) of `order.created` then `order.submitted` (pending-approval orders have only `order.created`,
  recon.md:241-242). Results go into a positive-sides-only cache held as a zero-value-safe `PortfolioService` field
  (lazy init under its own mutex; "nil means default" precedent `portfolio_service.go:50-51`, `:64-65`), never
  package-level. Empty answers and transport errors are never cached (`order.created` can land after its fill,
  `trading.go:1805`). Stop at the first unattributable order → `ErrFillUnattributable`. Sequential, not
  `errgroup.SetLimit(2)` (`golang.org/x/sync` is `// indirect`, `go.mod:34`); escalation if gate (iv) is over budget:
  a process-wide semaphore, then a resumable preload.
- **FR-4 isolation.** Fold key `trading_mode|account_id|symbol`. Three-way account rule per (user, mode, symbol)
  group: every fill has a non-empty `account_id` → key by account; no fill has one → key by symbol (AC-1/AC-2 give
  500/200); mixed → `ErrFillUnattributable`.
- **Fold order.** Every kept fill carries its ledger `sequence` (global-monotonic, recon.md:201), including partials
  appended from the latestPartials map (`:838-843`), which carry their latest partial's sequence.
  `sort.SliceStable` by sequence before `pnl.Fold`; `pnl.Fold` unchanged (recon.md:98-99).
- **Errors.** `ErrFillUnattributable` → FAILED_PRECONDITION: permanent (immutable ledger, recon.md:206-207) and
  blocks the whole response, unrealized included. `ErrRealizedUnavailable` → UNAVAILABLE (retryable).

### 3. gRPC error mapping (B7; extends portfolio @AC-5)

- `toGRPCError` (`portfolio_handler.go:432`, keeps its `(err error)` signature) gains explicit
  CodeFailedPrecondition / CodeDeadlineExceeded / CodeCanceled cases mirroring `trading.go:223-238`; no numeric
  pass-through.
- `classifyGetPnLError` changes signature `(err error)` → `(ctx context.Context, err error)`. Definition
  `portfolio_handler.go:425`; the ONLY call site `:96` (`connect.NewError(classifyGetPnLError(err), err)`) becomes
  `classifyGetPnLError(ctx, err)`; the table test `portfolio_handler_test.go:39-48` (`TestClassifyGetPnLError`) has
  one-argument calls at `:40` and `:43` that must change (fails.md:1860-1866 arity audit). Precedence: caller
  `ctx.Err()` → DeadlineExceeded / Canceled; `ErrQuotesUnavailable` → Unavailable; `ErrRealizedUnavailable` →
  Unavailable; `ErrFillUnattributable` → FailedPrecondition; else Internal.
- Reviewed for prose drift (teardown decides): `services/xstockstrat-portfolio/CLAUDE.md:28` and PORTFOLIO-16 in
  `services/xstockstrat-portfolio/docs/context-constitution.md:34` (cites `classifyGetPnLError (~L425-427)`).
- `TestClassifyGetPnLError` backs durable @AC-5 (`fix-book-portfolio-page.feature:6-8`). Keep the test name; keep
  the `:40` (wrapped ErrQuotesUnavailable → CodeUnavailable) and `:43` (generic → CodeInternal) assertions, each with
  a live `context.Background()`; keep the `toGRPCError(Unavailable)` assertion at `:46`; ADD (live ctx, wrapped
  ErrQuotesUnavailable) → CodeUnavailable and (expired ctx, same error) → CodeDeadlineExceeded, plus (cancelled ctx)
  → CodeCanceled. Table-driven `TestToGRPCError` (4 existing + 3 new codes + Internal default).
- Intended behaviour changes: a caller whose deadline ≤ `quote_timeout_ms` now gets DEADLINE_EXCEEDED; the only
  other producer of the three codes is DeleteWatchlist (`portfolio_service.go:1933`), browser 500 → 400
  (`connectClients.ts:119-124`; e2e `watchlistMock.ts:195-205` makes no status assumption). Platform @AC-7
  @feature-127 is brought into wire conformance; portfolio findings entry added.

### 4. Trading producer (FR-2)

`applyBrokerOrderStatus` fill emits (`trading.go:1805-1812`, `:1822-1829`; recon.md:53-58): lift each payload map to a
local, add `side: order.Side.String()` when not UNSPECIFIED, keep `fees` (platform @AC-10). `emitLedgerEvent`
(`:3661`) unchanged. Test via the `recordingLedger` / `requestsByType` recorder (`trading_offline_test.go:60`, `:84`)
driven through the CancelOrder not-cancelable path, asserting SourceService and `side` — not a copied map
(recon.md:122-125). History keeps the side-less shape, so section 2's lookup is still required.

### 5. UI FR-3

- `usePositionLineage` (recon.md:81-85) calls BFF `listOrders` `{symbol, accountId, tradingMode}` (BFF pins the
  session user, `traderBff.ts:34-39`; repo honours the filters, `trading_repo.go:229-268`), takes the first
  `LINEAGE_MAX_ORDERS=50`, runs point `queryEvents {streamKey: orderId, eventType: 'order.filled',
  sourceService: 'xstockstrat-trading'}` at concurrency 3, staleTime 60s, CardNotice on truncation; header comment
  `:5` fixed.
- BFF backstop (`traderBff.ts:118-127`): drop every response event whose eventType is `order.filled` /
  `order.partially_filled` and whose `payload.user_id` ≠ `claims.user_id` (LEDGER-6 precedent, recon.md:129-132).
  Other event types stay unscoped (stated).
- Fixtures: `e2e/fixtures/ledgerEvents.ts` + `INVENTORY.md` row; migrate the inline `order.filled` branch of
  `e2e/mock-backend.ts:456` (C-12, recon.md:126-128).

### 6. Portfolio test harness (B9 option (a), debate-resolved)

B9 was RESOLVED BY THE DEBATE as option (a) under the standing authorization (converged r6, refined r7-r8), not by an
operator pick.

- **A. Shared ledger fake** — new `internal/testdata/ledger.go` (imports nothing from service; precedent
  `testdata/offline_pnl.go`, recon.md:115-117). `Ledger{LedgerServiceClient; Events; OnQuery func(ctx, req) error;
  calls atomic.Int64}` + `Calls()`. No `Block` field (case 4 blocks inside OnQuery on `<-ctx.Done()`). `AppendEvent`
  is a no-op (emitEvent calls `s.ledger.AppendEvent` directly, `portfolio_service.go:1043`). QueryEvents order:
  count; `Unimplemented` if `TimeRange` / `FromSequence` set (`ledger.proto:64`, `:66`; fails.md:577); OnQuery error;
  `status.FromContextError`; filter EventType / SourceService / StreamKey only when set (`ledgerServiceImpl.ts:130-141`);
  slice order = recorded_at order (`:162`), may disagree with Sequence; PageSize 0 → 100 (`:157`); the fake mints its
  own opaque token (it has no recorded_at). Builders `FilledEvent` / `PartialEvent` / `CreatedEvent` take
  `seq int64`, bare-id StreamKey (`trading.go:649`, `:1805`). In-package `fillEvent`
  (`portfolio_fill_errors_test.go:24`) stays inline: it is the live-fold shape owned by the live-fold follow-up.
- **B. Test shim** — new `internal/service/export_test.go`: `WirePosition`, `NewWireTestService(t, ledger,
  positions...)` layered on `newQuoteSvc` (`portfolio_quote_deadline_test.go:93`) + `newFakeStore()` / `wideCaps()`
  (`watchlist_service_test.go:37`, `:362`); always registers the `FROM portfolio.positions` expectation; exports
  `CtxWithUser` (`watchlist_service_test.go:280`) and `Guard` (`portfolio_quote_deadline_test.go:70`). Carries a
  2-line import-cycle constraint comment. Reviewed-unchanged literals: `portfolio_quote_deadline_test.go:102`,
  `portfolio_fill_errors_test.go:64`, `watchlist_service_test.go:276`, plus fakeLedger / stopLedger / fillEvent.
- **C. Adapter test** — new `internal/service/portfolio_grpc_wire_test.go` (`package service_test`) via
  `handler.NewPortfolioHandler(svc).GRPCHandler()` (`portfolio_handler.go:49`, `:242`, `:276-282`, `:432`):
  (1) fill without order.created/submitted → FAILED_PRECONDITION; (2) plain ledger error → UNAVAILABLE; (3) live
  ctx, OnQuery cancels → CANCELED, `Calls() >= 1`; (4) 50ms timeout, OnQuery blocks, under `Guard` →
  DEADLINE_EXCEEDED, `Calls() >= 1`; (5) `TestWire_DeleteSystemManagedWatchlist_F127AC7`, seeded via the adapter's
  EnsureSignalWatchlist (`portfolio_handler.go:370-371` → `portfolio_service.go:1718`) → FAILED_PRECONDITION;
  (6) no x-user-id → INVALID_ARGUMENT; (7) `Current: 0`, zero-value `stubMarketData{}` (`portfolio_service_test.go:18`,
  `:58-63`), live ctx → UNAVAILABLE (pins portfolio @AC-5 EXTEND). Cases 3/4 never start from a pre-done ctx
  (pgxmock `expectations.go:71-77`).
- **D. Fold fixtures** — F1: filled buy 10@100 (seq 1), partial-only sell 4@150 (seq 2), filled buy 10@200 (seq 3) →
  realized 200. F2: three partial-only orders A buy 10@100 (seq 1), S sell 4@150 (seq 2), B buy 10@200 (seq 3), Events
  slice order A,B,S, fresh shim + fake per iteration, exactly 200 on all 20 runs. A sequence-dropping fold gives A,B,S
  → 0, B,S,A → −200, S,A,B → 200. **F2 risk text (verbatim, C-15/P-03):** with the Events slice in adversarial order
  A,B,S — under insertion-stable iteration a sequence-dropping fold sees A,B,S, gets 0 and fails EVERY run; under
  swiss random-offset iteration it passes a single run only via the S,A,B coincidence, at 1/8 per run, and over the
  20-run loop it passes with probability (1/8)^20 ≈ 2e-18. Stable iteration therefore makes F2 strictly stronger.
  FR-5 drain test: 501 `order.filled` events with `side`, PageSize 500 (`portfolio_service.go:754`) → each fill folded
  once, terminates under `Guard`, exactly 2 order.filled QueryEvents calls.
- **E. Touchpoints** — the three new files above; F1/F2/drain in the existing GetPnL test file; parity test extended.
  `testdata` counts toward COVERPKGS (`.github/workflows/ci.yml:256` excludes cmd/handler/repository/telemetry/service
  only) — accepted, precedent `offline_pnl.go`; no ci.yml edit.
- **F. Doc reconciliations** — `recon.md:139` portfolio @AC-5 PRESERVE → EXTEND and platform @AC-7 @feature-127 added
  to recon Existing Business Rules (done at this write). C-15 append to `acceptance.feature` + product-spec FR-4/FR-5
  (owed; see Open Risks): scenario ledger from AC-4 —
  AC-4 caller's unresolved side → FAILED_PRECONDITION (case 1); AC-5 another user's unresolvable fill does not affect
  the caller, zero lookups (@FR-4); AC-6 ledger read failure mid-drain → UNAVAILABLE (case 2); AC-7 caller deadline →
  DEADLINE_EXCEEDED, cancel → CANCELED (cases 3/4); AC-8 replaying ledger → UNAVAILABLE; AC-9 > 500 fills → fold of
  all (FR-5 drain test); AC-10 producer `side` + `xstockstrat-trading`, `fees` kept; AC-11 payload-side fill folds
  with no lookup; AC-12 ledger exactly-once across pages incl. ties (@FR-5); AC-13 malformed page_token →
  INVALID_ARGUMENT (@FR-5); AC-14 cross-account → realized 500 (@FR-4); AC-15 mixed-era group → FAILED_PRECONDITION
  (@FR-4); AC-16 sequence-ordered fold (F1, F2); AC-17 partial-then-filled folds once from `order.filled`; AC-18 LIVE
  fill excluded from paper GetPnL and lineage (@FR-4); AC-19 lineage fill beyond the first 100 platform events;
  AC-20 BFF drops other users' fill events even with their stream key; AC-21 truncation notice past 50 orders;
  AC-22 lineage fill with stale order status still listed. Adapter cases 5-7 are named in AC-4/AC-6/AC-7's
  backing and in the durable @AC-5 / platform @AC-7 backing headers. Every new AC carries ≥ 1 @FR tag.

### 7. Ship gate and build order

- Ship gate (read-only, dev + prod, after trading `side` is live; results in context.md; over-threshold escalates):
  (i) per-type fill / order.created counts; (ii) fill stream keys with no side-bearing sibling; (iii) mixed
  user+symbol groups and empty-account_id fills, plus users/groups that would hit AC-4/AC-15 (permanent
  FAILED_PRECONDITION) with a remediation path; (iv) EXPLAIN ANALYZE of the first and a next page (chunk exclusion
  for the cursor expression; fallback timestamptz text parameter), one stream-key lookup, chunk count, a COLD-CACHE
  full GetPnL including the platform-wide order.filled drain, AppendEvent latency under concurrent cold GetPnL calls;
  thresholds 500ms per query, 5s aggregate (`ledgerEmitTimeout/2`, `trading.go:3657`); do not raise the ledger pool
  without an F-06 re-check.
- Dev smoke (blocks promotion): drain `QueryEvents{sourceService:'xstockstrat-trading'}` pageSize 50 against a
  read-only SELECT (equal counts, 0 dup, 0 missing); GetPnL OK for a dev user; one malformed token → INVALID_ARGUMENT
  on the real gRPC path; access path must satisfy fail-closed mTLS (feature 210) — escalate under P-03 if none.
- Build order (preference; one DO app spec rolls all components together, so every order fails closed): RED tests →
  ledger → trading → portfolio → UI → ship gate + smoke → teardown (stream-key doc drift recon.md:248-254; product-spec
  Affected Services / Fix Scope `:152`, `:161-164` — ledger becomes a fix site, CI job added; portfolio CLAUDE.md
  Ledger Events Consumed row; findings: req.Range ignored for realized, HydrateStops page 1 only `:534`).

## Rejected Alternatives

- Another full adversarial round on A-F at r9 — no A-F text changed; the residual citation re-grep is `/sdd-spec`'s (C-18).
- Holding the gate until the operator re-ratifies B6 at `d707d239` — substance verified, operator decision records it done; gate criteria exclude P-05 bookkeeping.
- Editing or replacing context.md `:268`, `:197-200`, `:249` in place — violates append-only (`context.md:3`); superseded by citation.
- Claiming a batched r6-r9 entry satisfies P-05 — overstates compliance; recorded as a deviation.
- Renaming or rewriting `TestClassifyGetPnLError` — breaks the durable @AC-5 "Backed by" header (`fix-book-portfolio-page.feature:6-8`).
- Keeping `classifyGetPnLError(err)` and reading ctx elsewhere — contradicts the ctx-first precedence.
- Citing `:425` / `:432` as the call site / table test — wrong lines; real ones are `:96` and `portfolio_handler_test.go:40`, `:43`.
- B9 option (b), pure-chain `toGRPCError(connect.NewError(...))` — leaves the adapter line (`portfolio_handler.go:276-282`) and the DeleteWatchlist path unproven.
- A production handler-side service interface — C-18; the test-only `export_test.go` seam suffices.
- A `Block` field on the fake — duplicates OnQuery, which already receives ctx (C-18).
- Silently ignoring `TimeRange` / `FromSequence` in the fake — the masking pattern of fails.md:577; returns Unimplemented.
- Dropping the fake's paging code — leaves the FR-5 consumer (no page-1 re-fetch) untested on portfolio.
- A fake reproducing the ledger's recorded_at keyset cursor — the fake has no recorded_at; the cursor is proven ledger-side by `ledger-pg-test`.
- Adding `testdata` to the COVERPKGS exclusion — extra CI edit for a counting nuance with precedent (`offline_pnl.go`).
- Migrating `fillEvent` into testdata — it is the live-fold shape the B6 follow-up owns; widens scope.
- A package-level side cache — breaks F2's cold-cache premise and makes case 1 order-dependent.
- Insertion-ordered partials in production (slice instead of the latestPartials map) — production change for test convenience; the sequence sort already makes production deterministic.
- A 4-order F2 fixture — (1/8)^20 is already negligible.
- An unqualified `…AC7…` wire-test name — ambiguous next to 251's own AC-7.
- F2 with a sequence-ordered Events slice (A,S,B) — a buggy fold passes about 0.3% of 20-run loops.
- A hand-built `PortfolioService` literal in the shim, or a separate in-package F2 constructor — nil marketdata; a third/fourth construction site.
- Exporting `posRow` / `positionCols` / `anyArgs` — pgxmock types would leak into `service_test`.
- An inline select in case 4 instead of exporting `Guard` — a second hang-bound helper (DRY).
- A pre-cancelled or expired ctx for cases 3/4 — pgxmock's random select skips the ledger stage.
- A bufconn in-process gRPC server — ~40 lines of plumbing for codes the direct adapter call already proves.
- An order.created preload (singleflight, detached ctx, watermark) — livelock/identity hazards; replaced by positive-only per-order lookups (C-18).
- `errgroup.SetLimit(2)` — per-call not global, single ledger query connection, `x/sync` is indirect (F-08).
- Caching empty side answers — `order.created` can land after its fill.
- Fabricating an unresolved side (fold as buy / skip) — violates the feature-229 never-fabricate posture; FAILED_PRECONDITION instead.
- UNAVAILABLE for a permanent unresolved side — invites retries onto the single ledger connection.
- Dropping the `SourceService` filter — loses the producer pin the parity test guards.
- A page cap — data-tuned permanent outage; termination guards instead.
- A sequence-only keyset or `to_timestamp(double)` cursor — order is recorded_at; float precision loss.
- A hard 252 → 251 merge-order dependency, or absorbing 252's runner — scope; soft row + reconciliation duty.
- Portfolio reading `trading.orders`, or a BFF platform-wide lineage drain — cross-service DB read; unbounded browser-path read.
- A ledger `QueryEventsRequest` user field (field 7) — proto gate (C-09) not needed while scoping stays in the BFF; kept as gate (iv) escalation.

## Open Risks

- [ ] C-15 append owed: AC-4..AC-22 (section 6F ledger) into `acceptance.feature` and FR-4 (cross-user / account-grain isolation) + FR-5 (ledger paging contract) into product-spec, with @FR tags — not written at this design write; must land before `/sdd-spec` traces test steps (an uncovered scenario blocks impl-spec review).
- [ ] r6-r8 logged late; whether r6 preceded `d707d239` is undeterminable, so the `context.md:276-278` "Ordering deviation" stays as unresolved evidence — record only, no step.
- [ ] `classifyGetPnLError` arity change compiles only once `portfolio_handler.go:96` and `portfolio_handler_test.go:40`, `:43` are updated together — portfolio handler step Files.
- [ ] PORTFOLIO-16 (`services/xstockstrat-portfolio/docs/context-constitution.md:34`) and `services/xstockstrat-portfolio/CLAUDE.md:28` describe `classifyGetPnLError`; ctx-first semantics must be reflected or the teardown audit flags drift — teardown step.
- [ ] Import-cycle trap: an in-package `_test.go` importing `internal/handler` breaks the service test build; mitigated only by the `export_test.go` constraint comment — test-harness step.
- [ ] Shim coupled to `newQuoteSvc`'s signature; a change ripples into adapter, fold and drain tests — test-harness step.
- [ ] Adapter test skips grpc.Server, the interceptor chain and status serialization — accepted; dev smoke covers the real path.
- [ ] Case (4) relies on no internal timeout in the GetPnL ledger stage (`portfolio_service.go:751-755`); 50ms under -race is a minor flake surface (raise to 200ms) — adapter-test step.
- [ ] F2 residual: 1/8 per run under random iteration, (1/8)^20 ≈ 2e-18 over 20 runs; insertion-stable iteration fails a buggy fold every run. F1 and the drain test are deterministic — fold-test step.
- [ ] Drain test's "exactly 2 calls" is coupled to the hard-coded PageSize 500 (`portfolio_service.go:754`) — fold-test step.
- [ ] Fake branches count toward portfolio gated coverage (`testdata` not in the COVERPKGS exclusion) — accepted.
- [ ] Cold-cache cliff after every deploy: one StreamKey lookup per legacy order over the ledger's single query connection, can delay trading's fire-and-forget AppendEvent — ship gate (iv).
- [ ] Unresolved fills in mixed-era groups fail permanently with FAILED_PRECONDITION; immutable ledger, no backfill — ship gate (iii) count + remediation path.
- [ ] Ledger delegate line has no live CI guard until 252 lands — ledger step; merge-order row.
- [ ] Cursor-expression chunk exclusion unconfirmed until gate (iv); platform-wide order.filled drain has no row cap — ship gate (iv).
- [ ] Callers with deadline ≤ `quote_timeout_ms` now see DEADLINE_EXCEEDED; DeleteWatchlist on a system-managed list goes 500 → 400 in the browser — intended, recorded; findings entry.
- [ ] Sequence order reflects racing-goroutine insert order; interleaved partials may differ from the broker's figure — accepted.
- [ ] Bracket-leg understatement and live-fold sign loss remain until their follow-ups land (`docs/reports/2026-10-21-trading-bracket-leg-fills-missing-from-realized-pnl-defect.md`, `docs/reports/2026-10-21-portfolio-live-fold-sell-sign-loss-defect.md`, both `open`).
- [ ] 251/252 merge collision depends on whichever merges second honouring its reconciliation duty — integration PR.
- [ ] Scratch-tsconfig compiled run unverified against ledger's module settings — ledger step records pass/fail.
- [ ] Only the citations listed in the header were spot-checked at `1d47c0a7`; the rest carry from debate state grounded at `bec15842`..`e28cce95` — `/sdd-spec` re-greps all of them.

## Constitution Rules Touched

- `C-11` — honored by: FULL-mode gate at round 9 under the operator-lifted cap of 12; rounds ≥ 2, Floor clean, zero blocking objections (B6 closed on verified evidence, B9 debate-resolved as (a)), no @AC CHANGE; auto-approved under the standing authorization after the gate entry was appended.
- `C-15` — honored by: AC-4..AC-22 + FR-4/FR-5 ledger specified (section 6F), F2 exact risk text carried; append owed before `/sdd-spec` (Open Risks).
- `C-16` — honored by: no durable @AC CHANGEd; portfolio @AC-5 EXTENDed and pinned by wire case (7) plus the preserved/extended `TestClassifyGetPnLError` rows, keeping the `:6-8` backing header accurate; platform @AC-7 @feature-127 PRESERVEd via case (5).
- `C-10` / `C-14` — honored by: FR-3 second reader in scope; live-fold and bracket-leg deferrals filed as open reports and cited in Out of Scope (`product-spec.md:191`, `:195-196`); consumer surfaces named.
- `C-13` / `C-01` — honored by: one ledger fake in `internal/testdata/`; builder parity covers the GetPnL reader and the producer.
- `C-12` — honored by: UI lineage fixtures in `e2e/fixtures/ledgerEvents.ts` + `INVENTORY.md`.
- `C-18` — honored by: no preload, no Block field, no ci.yml edit, fillEvent not migrated, no production interface.
- `C-03` — honored by: no new runtime edge or RPC hop; header propagation unchanged.
- `C-09` — honored by: no proto change (scoping stays in the BFF).
- `C-08` — honored by: every service step paired with tests (unit, real-PG, adapter, Playwright).
- `F-01` — honored by: no migration.
- `F-04` — honored by: every cited report path exists (verified); new files declared as new.
- `F-06` — honored by: ledger pool unchanged; gate (iv) forbids raising it without a re-check.
- `F-07` — honored by: no config key.
- `F-08` — honored by: go.mod/go.sum untouched (sequential lookups, no direct `x/sync` import).
- `F-11` — honored by: no Floor breach in any of 9 rounds.
- `P-01` / `P-02` — honored by: single writer; the r9 synthesis is the sole carrier of round state.
- `P-03` — honored by: citation drifts corrected (`:753`/`:798`; `:96`/`:425`, test `:40`/`:43`; PORTFOLIO-16 path is the portfolio module constitution); ms-precision premise corrected; B9 (a) recorded as debate-resolved.
- `P-05` — honored by: append-only r9 entry supersedes earlier lines by citation; r6-r8 late recording stated as a deviation; entry appended before design.md and status.md.
- `PORTFOLIO-16` / feature 229 never-fabricate — honored by: live-ctx UNAVAILABLE kept and pinned twice (unit + adapter); expired/cancelled ctx map to their own codes.

## Business Rules Touched (C-16)

No CHANGE, so no operator sign-off is required (the 2026-10-21 operator decisions in context.md cover none and none
is needed).

- PRESERVE 251 `@AC-1` "Realized P&L folds a sell that trading wrote with an unsigned qty" (feature `acceptance.feature`) — not regressed by: side resolved via the `order.created` sibling; realized 500.
- PRESERVE 251 `@AC-2` "A partially filled sell ... is included in realized P&L" — not regressed by: cumulative 4 folded signed; realized 200.
- PRESERVE 251 `@AC-3` "The position fill lineage lists the trader's own fills" — not regressed by: user-pinned ListOrders + BFF backstop; no u-2 event.
- EXTEND `@AC-5` "GetPnL refuses to report unrealized P&L when a needed quote is unavailable" (`services/xstockstrat-portfolio/acceptance/fix-book-portfolio-page.feature:29-35`, `@feature-229`) — new cases: FAILED_PRECONDITION, DEADLINE_EXCEEDED, CANCELED under ctx-first precedence; ErrQuotesUnavailable stays UNAVAILABLE while ctx is live. Rule text unchanged. Pinned by wire case (7) and `TestClassifyGetPnLError` (existing `:40`/`:43` rows kept with a live ctx, live/expired/cancelled-ctx rows added, name kept so `:6-8` stays accurate).
- PRESERVE `@AC-6` "GetPnL values broker-synced positions from the broker price without a quote fetch" (same file) and `@AC-6` "A one-sided quote ... leaves the position unpriced" (`fix-after-hours-positions-priced.feature`) — not regressed by: realized-only change; an un-quotable holding stays UNAVAILABLE (the shim's zero-value `stubMarketData` only turns a would-be nil panic into this defined path).
- PRESERVE `@AC-13` "Every portfolio read path values the one-sided position identically" (`fix-after-hours-positions-priced.feature`) — unrealized untouched.
- PRESERVE platform `@AC-7` "A system-managed watchlist cannot be deleted via API or UI" (`docs/sdd/business-rules/platform.feature:34-41`, `@feature-127`) — rule text unchanged; wire now actually returns FAILED_PRECONDITION; backed by `TestWire_DeleteSystemManagedWatchlist_F127AC7`.
- PRESERVE platform `@AC-10` "A per-fill fee flows through the fee-capture plumbing" (`platform.feature`, `@feature-029`) — `fees` kept; `side` is additive.
- PRESERVE portfolio offline `@AC-14` / `@AC-7` / `@AC-11` (`offline-account-portfolios.feature`, `@feature-157`) — `offlineFillsFromOrders` unchanged; offline accounts emit no fills.
- PRESERVE trading `@AC-8` "Broker pollers skip offline accounts" and `@AC-1` "A broker position explained by the platform's own filled orders does not halt" (`fix-reconciliation-false-halt.feature`, `@feature-206`) — only the payload map gains a key; persisted `filled_qty` unchanged.
- PRESERVE ledger `@AC-8` "Each exported row carries the required fields" (`ledger-event-export.feature`, `@feature-021`) — rows not renamed; reader conforms to `"xstockstrat-trading"`.
- EXTEND ledger `@AC-11` "The export returns only the authenticated user's own events" (same file) — FR-3 applies the same scoping to the lineage read; `ExportEvents` unchanged.
- EXTEND 251 — appended `@AC-4..@AC-22` with new FR-4 (isolation) and FR-5 (ledger paging) per section 6F (append owed, Open Risks).
