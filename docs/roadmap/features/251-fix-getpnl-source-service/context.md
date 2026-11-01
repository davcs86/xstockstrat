# Context Log: fix-getpnl-source-service

Append-only. Each session appends a new ## Session entry. Never delete or edit prior entries.

---

## Session 2026-10-20 (/sdd-triage)

- Bug recorded as defect report `docs/reports/2026-10-20-portfolio-getpnl-source-service-mismatch-defect.md`
  (Issues disabled). Found while confirming `2026-10-19-portfolio-default-identity-fallback-defect` (PR #1257).
- Severity: SEV-2. Impact type: wrong-pnl-reported. Environment: dev (main-dev) @ 1302e6d. Config-only: no.
- Routed to SDD path (Track C).
- Created: status.md, feature.md, product-spec.md, acceptance.feature (AC-1..2), context.md.
- Affected services (from report): xstockstrat-portfolio, xstockstrat-trading, xstockstrat-ledger.
- Root cause hypothesis: bare literal mismatch — portfolio queries `"trading"`, trading writes
  `"xstockstrat-trading"`, ledger filters by exact match; the `GetPnL` fake ledger ignores the request.
- Confirmation evidence (report, confidence high): scratch test `zz_getpnl_source_test.go` with an exact-match fake
  ledger and fills buy 10 @ 100 / sell 10 @ 150 → stored as `"xstockstrat-trading"`: `GetPnL queried [trading trading]
  -> realized=0`; control stored as `"trading"`: `realized=500`.
- Line drift: report cites `portfolio_service.go:670-672`/`:715-717`; at triage time the `SourceService: "trading"`
  lines are `:683` and `:728`. Trading emits at `trading.go:1861`, `:2106`, `:2674`.
- Recommended design depth: full → `/sdd-design fix-getpnl-source-service` (rationale: SEV-2 with 3 affected services
  per the report, which is the C-0 full trigger). The fix site is likely portfolio-only (trading and ledger are
  read-only evidence), so the operator may downgrade to `/sdd-design fix-getpnl-source-service quick`; escalation
  stays warranted if design adopts a shared source-service constant spanning trading and portfolio (DRY guard rail).
  Design fork: literal `"xstockstrat-trading"` vs shared constant vs dropping the `SourceService` filter.
- **Overlap:** feature `240-offline-account-full-pnl` (merged to main-dev via #1266) also touches portfolio P&L (`GetPnL` / valuation paths
  in `portfolio_service.go`). Sequence or rebase against it; check merge-order before the integration PR.
- Development branch: feature/fix-getpnl-source-service

## Session 2026-10-20 (renumber 242 → 251)

- Renumbered from 242 to 251 after feature 240-offline-account-full-pnl merged to main-dev (#1266) and took 240; re-verified on main-dev @ 4535695: the defect persists — `SourceService: "trading"` now at `portfolio_service.go:753` (filled) / `:798` (partially_filled); feature 240 did not touch these queries.

## Session 2026-10-20 — sdd-review product-spec

- Product spec approved. Status: draft → spec-ready. Verdict: criteria PASS WITH WARNINGS (6 warnings, 4 notes, no
  fails, no Floor `F-*` breach); overlap WARN (10 same-file collisions, no FAIL). Severity SEV-2.
- Prior revisions not logged before this entry: `50580963` added defect 2 (sell sign lost) + FR-1/FR-2, pinned
  AC-1/AC-2 to the producer shape and escalated the scope decision (P-03); `0814d3ec` added the FR section, persona,
  Consumer Surface(s), FR-3/AC-3 (C-10 second reader, user scoping) and xstockstrat-ui to Affected Services.
- Scope decision escalated to operator, still pending (P-03/P-05). Spec default = unweakened scope: FR-2 and FR-3
  in scope. The split alternatives (defer FR-2 to a named follow-up; defer FR-3/AC-3 to
  `fix-position-lineage-source-service`) need explicit operator sign-off recorded here, and restated ACs appended
  under new IDs (C-15 append-only; C-14 for FR-3). The operator decisions below do not cover this fork.
- Line refs in the triage entry above are superseded: `SourceService: "trading"` at `portfolio_service.go:753`
  (filled) / `:798` (partially_filled); fill emits `trading.go:1805` / `:1822`; ledger literal `:3667`.
- product-spec.md edits this session: stream-key doc-drift note; Mode and broker scope paragraph (C-2, C-3); Fix
  Scope proto/ledger caveat; open questions + "Product decisions design must settle"; fixture-home and named
  follow-up wording in Out of Scope. acceptance.feature unchanged.

### Operator decisions

OPERATOR DECISIONS (binding, recorded 2026-10-20):
- Standing authorization: designs run in FULL mode only (no quick designs for automated fixes); the orchestrator auto-approves the design gate once rounds >= 2, no unresolved Floor (F-*) breach remains, no blocking objection remains, and every CHANGE to an existing @AC business rule is covered by an operator decision below.
- Full design depth (operator: full is the minimum).

### Warnings (spec-reviewer), carried into /sdd-design

- [ ] unaddressed — [C-10, P-03] Live fold sign loss (`processOrderFill`, `portfolio_service.go:310-317`; unsigned
  sell qty `trading.go:1807`) confirmed; no defect report exists in `docs/reports/`. File it via `/sdd-qa defect`
  before `/sdd-design` and cite its path in product-spec Out of Scope. Design decides whether the side-resolution
  helper is shared with it (in product-spec open questions).
- [x] [P-03, P-05] Scope escalation and revision history recorded in this entry.
- [ ] unaddressed — [FR-2 gap, P-03] Unresolvable fill side (no `order.created`/`order.submitted` sibling, or sibling
  outside a 500-event page) has no FR/AC. Product decision (fold as buy / skip / error; feature 229 never-fabricate
  precedent). Design appends an FR and AC (next free ID). Listed in product-spec "Product decisions design must settle".
- [x] [FR-3, C-09] Fix Scope states the proto/ledger boxes hold only while FR-3 scoping stays in the BFF
  (`QueryEventsRequest` has no user field, `ledger.proto:60-67`); `payload.user_id` scoping (`LedgerEvent.user_id`
  empty pre-migration, `ledger.proto:35`) added to open questions.
- [ ] unaddressed — [FR-3, C-09] Pagination: the user's fill beyond the first platform-wide 100-event page
  (`usePositionLineage.ts:19`, `ledgerServiceImpl.ts:157-162`) is not caught by AC-3. Design appends an AC (next free
  ID). Listed in product-spec "Product decisions design must settle".
- [x] [C-3] Product spec states mode scoping unchanged (`portfolio_service.go:775-783`, `:820-828`), paper-safe.
- [x] [C-2] Product spec states broker scope: fills only via `applyBrokerOrderStatus` (`trading.go:1772`; callers
  `pollFills` `:1766`, `reconcileNotCancelable` `:1394`), ALPACA + IBKR; OFFLINE never emits `order.filled`
  (`:1715-1721`, `:888-889`).
- [ ] unaddressed — [NOTE, doc drift] `order:{order_id}` stream key in `services/xstockstrat-trading/CLAUDE.md` and
  `services/xstockstrat-ledger/CLAUDE.md:101` vs bare id in production (`trading.go:649`, `:842`, `:1805`;
  `ledgerServiceImpl.ts:51`); trading unit tests use the prefix (`trading_ledger_userid_test.go:23`). Product spec
  notes it; the CLAUDE.md fix belongs to the teardown audit. Design option (a) joins on the bare id.
- [ ] unaddressed — [NOTE, C-16] Recon lists durable suites touching GetPnL / `order.filled`:
  `services/xstockstrat-portfolio/acceptance/fix-book-portfolio-page.feature:30-48`,
  `services/xstockstrat-portfolio/acceptance/fix-after-hours-positions-priced.feature:49-77`,
  `docs/sdd/business-rules/platform.feature:95-98` (`fees` key). Option (b) keeps existing payload keys.
- [x] [NOTE, C-12/C-13] Product spec Out of Scope routes FR-3 fixtures to `e2e/fixtures/ledgerEvents.ts` +
  `INVENTORY.md`; `/sdd-spec` applies it.
- [x] [NOTE, criterion 8] AC-1/AC-2 couple FR-1 and FR-2 by design; satisfiable only by option (a) or (a)+(b).

### Overlap findings (feature-overlap, WARN)

- `portfolio_service.go`: vs 240-offline-account-full-pnl (code-completed; disjoint functions, 240 keeps GetPnL
  untouched) and 242-fix-push-untargeted-broadcast (`emitRiskAlert` `:934-943`, draft). Rebase onto post-240 trunk.
- `watchlist_service_test.go` shared `fakeLedger` (becomes exact-match) vs 240's `TestGetPnL_AC5_QuotesUnavailable`
  (`portfolio_quote_deadline_test.go:101`, `:268`). Design confirms 240's GetPnL tests stay green.
- `trading.go` (conditional on option (b) or a shared constant): vs 240 (ConfirmOrder/recompute/baseline), 249
  (`ibkrCreds` `:87`), 241 (`:2086-2094`). Disjoint regions.
- `ledgerServiceImpl.ts` vs 248 (`rowToEvent`): only if 251 edits the ledger.
- `page.tsx` vs 240 (positions list): conditional; FR-3 can stay in `usePositionLineage.ts` + BFF.
- `e2e/mock-backend.ts` vs 215 (disjoint regions); `e2e/fixtures/INVENTORY.md` vs 240 and 215 (shared catalog).
- No config/proto/migration collision. `pnl.go` read-only (240 exports `QtyEpsilon`).
- Lifecycle: 240 `status.md` = `code-completed`, while the triage entry says merged to main-dev (#1266); verify 240
  is on main-dev before the 251 integration PR. No merge-order row required (no FAIL); a soft 240→251 row is optional.

## Session 2026-10-20 — sdd-review product-spec (resumed re-run)

- Re-run of the product-spec gate on spec-ready tip `5089b229`. Verdict: criteria PASS WITH WARNINGS (8 warnings, no
  fails, no Floor `F-*` breach); overlap WARN (no FAIL). Status stays spec-ready. A4 was already applied by the
  entry above, so no second Status History row was added and feature.md Next Action is unchanged.
- Warnings already carried in the entry above (no new action): live-fold sign loss `processOrderFill`
  (`portfolio_service.go:310-317`) needs a named follow-up; scope fork (a)/(b) plus the FR-2/FR-3 deferral
  alternatives are pending operator sign-off; `order:{order_id}` stream-key doc drift; C-2 broker scope and C-3 mode
  scope (both already stated in the spec); C-16 durable suites
  (`fix-after-hours-positions-priced.feature`, `fix-book-portfolio-page.feature`); unresolved-side AC.
- New warnings this run:
  - [x] [criterion 8] Partial-then-filled dedup: FR-2 now says the dedup is unchanged
    (`portfolio_service.go:784`, `:838-840`).
  - [x] [criterion 8] FR-3 now says partial fills stay absent from the lineage sheet (`usePositionLineage.ts:17`).
  - [ ] unaddressed: [criterion 8] AC for a partially filled sell that later reaches `order.filled` (folds once,
    from the filled event). Design appends it under the next free ID (C-15).
  - [ ] unaddressed: [C-3, advisory] A LIVE-mode exclusion scenario (a LIVE fill must be excluded from a paper
    GetPnL query and from the paper lineage). The spec states mode handling is unchanged. Design decides whether to
    add the scenario.
  - [x] [C-18, informational] Track C proportionality: four services, BFF user scoping. C-10 rationale is already in
    the Scope Decision. No action.
- Overlap findings (this run): `portfolio_service.go` is shared with 240 (GetPnL untouched there) and 242
  (`emitRiskAlert`); disjoint functions, rebase only. `trading.go` collides with 249 (`ibkrCreds`) only under option (b).
  UI files (`usePositionLineage.ts`, `traderBff.ts`) are not named by any peer. No config, proto or migration
  collision. No 251 merge-order row is required; an optional soft 240→251 row is still possible. Re-run the Mode B
  overlap scan once the fork is decided.
- product-spec.md edits: FR-2 dedup sentence; FR-3 partial-fill exclusion sentence. acceptance.feature unchanged.

### Operator decisions

OPERATOR DECISIONS (binding, recorded 2026-10-20):
- Standing authorization: designs run in FULL mode only (no quick designs for automated fixes); the orchestrator auto-approves the design gate once rounds >= 2, no unresolved Floor (F-*) breach remains, no blocking objection remains, and every CHANGE to an existing @AC business rule is covered by an operator decision below.
- Full design depth (operator: full is the minimum).

## Session 2026-10-21 — sdd-design (full) halted at gate, round 5

- `/sdd-design fix-getpnl-source-service` full debate ran 5 rounds (cap) on HEAD `bec15842`. Auto-approval did not
  fire: rounds >= 2 and no Floor breach, but 2 blocking objections remain (B6, B9). Per the grilling cap rule,
  `design.md` is NOT written and `status.md` stays `spec-ready`. Operator decision needed.
- Relayed request "Override limit for 246" names feature 246; it is not an operator decision for 251, waives no
  blocker and sanctions no @AC CHANGE.
- Checkpoint: `state-r5.json` in the orchestrator scratchpad (seeds/251).

## Open Threads

### Current best approach (after round 5)

1. **Ledger paging.** New `services/xstockstrat-ledger/src/queryEventsPage.ts` owns SQL build, keyset predicate,
   cursor encode/decode, full `page` object (`{nextPageToken, totalCount: rows returned}`, per
   `ledgerServiceImpl.test.ts:208-221`) and error mapping (InvalidPageTokenError/22007/22008/22P02 -> 3, else 13).
   `ledgerServiceImpl.ts` queryEvents (`:124-176`) becomes a thin delegate. Encoder requires `row.cursor_us` as a
   decimal string (pg int8), throws plain Error (-> 13) otherwise. Keyset compare in integer microseconds
   (`'epoch'::timestamptz + $us * interval '1 microsecond'`, never `to_timestamp(double)`); ORDER BY
   recorded_at, event_id. Strip/tsc dual-load: no enums, parameter properties, namespaces, or relative runtime
   imports (`import type` only; fails.md:2239-2241). New `ledger-pg-test` CI job on the TimescaleDB image, drains
   >= 2 pages, iteration cap, ms-tie/chunk/filter fixtures.
2. **252 reconciliation (B8, closed).** 251 edits `ledgerServiceImpl.test.ts`: makeRow (`:88-103`) gains
   `cursor_us: '1704067200000000'`; hasMore case (`:172-187`) decodes the token to the last row's
   (cursor_us, event_id). One-off compiled run (scratch tsconfig excluding `mtls.test.ts`/`queryEventsPage.test.ts`,
   `node -e` import of compiled impl, `node --test` on compiled test) recorded as evidence, not a CI guard. Soft
   merge-order row (precedent `merge-order.md:35`) naming who reconciles; matching note appended to 252 context.md.
3. **Portfolio GetPnL** (`portfolio_service.go:722-853`). Five-stage pipeline, fold key
   `trading_mode|account_id|symbol`, fail-closed sentinels, seen-event_id set, `pnl.Fold` unchanged. Side
   resolution: NO preload; for the caller's buffered side-less fills only, StreamKey lookup per distinct order
   (order.created / order.submitted); process-local mutex-guarded cache of positive sides only (empty answers and
   transport errors never cached — order.created can land after its fill, `trading.go:1805`); stop at first
   unattributable order -> `ErrFillUnattributable`. Recommended sequential lookups (not `errgroup.SetLimit(2)`;
   `golang.org/x/sync` is `// indirect`, `go.mod:34`). Every kept fill, including partials appended from the
   latestPartials map (`:838-843`), carries its ledger `sequence`; `sort.SliceStable` by sequence before the fold.
4. **gRPC errors (B7, closed).** `toGRPCError` (`portfolio_handler.go:432-447`) gains explicit
   FailedPrecondition/DeadlineExceeded/Canceled cases mirroring `trading.go:223-238` (no numeric pass-through).
   `classifyGetPnLError(ctx, err)` (`:423-430`) precedence: caller `ctx.Err()` -> DeadlineExceeded/Canceled;
   ErrQuotesUnavailable -> Unavailable; ErrRealizedUnavailable -> Unavailable; ErrFillUnattributable ->
   FailedPrecondition; else Internal. Table tests for both. Blast radius: only DeleteWatchlist
   (`portfolio_service.go:1933`) — browser 500 -> 400 (`connectClients.ts:119-124`); e2e mock
   (`watchlistMock.ts:195-205`) makes no status assumption. Platform @AC-7 brought into wire conformance + portfolio
   findings entry.
5. **Trading producer, UI FR-3, ship gate, build order** as round 4, except gate (iv) times a COLD-CACHE full GetPnL
   (incl. the platform-wide order.filled drain) and AppendEvent latency under concurrent cold calls; preload drain
   timing dropped.
6. **Design write (when unblocked).** Append AC-4..AC-22 with @FR tags (acceptance.feature ends at AC-3) and FR-4
   (isolation) / FR-5 (ledger paging); fold-order fixture in the sequence-ordered-fold AC; design.md records no
   preload, positive-only cache, sequential lookups (or go.mod/go.sum listing if errgroup kept),
   DEADLINE_EXCEEDED-under-short-deadline, DeleteWatchlist 500 -> 400.

### Blocking objections

- [ ] **B6** [C-10/C-14, P-03, F-04] Follow-up reports not filed. `docs/reports/` has no live-fold sign-loss
  (`processOrderFill`, `portfolio_service.go:310-317`) or bracket-leg realized report; the round-1 warning above
  ("Live fold sign loss ... unaddressed") is still open. Action: `/sdd-qa defect` twice, verify both paths exist,
  cite them in product-spec Out of Scope (`:186-191`), append a closing context.md entry. Do not cite a path before
  its file exists.
- [ ] **B9** [P-06, F-04-adjacent] Adapter wire test has no seam. `PortfolioHandler.svc` is a concrete
  `*service.PortfolioService` (`portfolio_handler.go:45`, `:49`) with unexported fields; `NewPortfolioService`
  dials real deps (`portfolio_service.go:114`); handler tests only build `&PortfolioHandler{}`
  (`portfolio_identity_test.go:28`). Operator picks one:
  - (a) recommended: `internal/service/export_test.go` test-only constructor (precedent: in-package literals at
    `portfolio_fill_errors_test.go:64`, `watchlist_service_test.go:276`) + external `package service_test` test via
    `handler.NewPortfolioHandler(svc).GRPCHandler()` asserting `status.Code` for each sentinel and DeleteWatchlist.
  - (b) fallback: pure-chain test `toGRPCError(connect.NewError(classifyGetPnLError(ctx, err), err))`, recording the
    one-line adapter (`:276-282`) as unproven residual.
  - Rejected: a production handler-side service interface (C-18).

### Floor breaches

- None.

### Uncovered @AC changes

- None. All business-rule impacts are PRESERVE or EXTEND (no operator coverage required):
  - PRESERVE: 251 @AC-1, @AC-2, @AC-3; portfolio @AC-6; platform @AC-7 @feature-127 (wire brought into conformance,
    rule text unchanged); trading @AC-10; trading offline @AC-14/@AC-7/@AC-11; ledger @AC-8.
  - EXTEND: portfolio @AC-5 (adds FAILED_PRECONDITION / DEADLINE_EXCEEDED / CANCELED under the stated precedence;
    ErrQuotesUnavailable stays UNAVAILABLE); 251 appended @AC-4..@AC-22 with FR-4/FR-5.

### Non-blocking items carried to /sdd-spec

- Fold order: map-appended partials carry their latest partial's sequence; AC fixtures: buy 10@100 filled, partial
  sell 4@150, buy 10@200 filled -> realized 200; two opposite-side partial-only orders on one symbol -> deterministic.
- errgroup kept -> step Files list go.mod/go.sum (F-08); escalation: process-wide semaphore, then resumable preload.
- Ledger delegate line + 251 edits to `ledgerServiceImpl.test.ts` stay behind `if (!impl) return;` until 252 lands
  (accepted residual; fails.md:132, :1942-1953).
- Scratch-tsconfig compiled run unverified against ledger's module settings; /sdd-spec confirms or records failure.
- Confirm no in-repo runtime caller of portfolio GetPnL (agent `app/`, UI `src/`).
- P-03: update product-spec Affected Services / Fix Scope (`:152`, `:161-164`); document opaque page_token in
  ledger CLAUDE.md.
- Carried from round 4: dev smoke access path under fail-closed mTLS; ledger-pg-test migration scoping
  (SEED_USER_ID, `ci.yml:667`); source-service parity on two pins; permanent FAILED_PRECONDITION counting and
  remediation; millisecond-precision premise correction; RED hygiene.

### Open risks

- Cold-cache cliff after every deploy (one StreamKey per legacy order over ledger's single query connection; can
  delay trading's fire-and-forget AppendEvent, 10s timeout, silently dropped).
- Unresolved fills in mixed-era groups fail permanently with FAILED_PRECONDITION; immutable ledger, no backfill.
- Cursor-expression chunk exclusion unconfirmed until gate (iv) (fallback: timestamptz text parameter).
- Platform-wide order.filled drain has no row cap.
- Sequence order reflects racing-goroutine insert order; interleaved partials may differ from the broker figure.
- Bracket-leg understatement and live-fold sign loss remain until their follow-ups land (B6).
- 251/252 collision mitigated only by the soft row.

### Operator decision needed

1. Execute B6 (file two `/sdd-qa defect` reports and cite them), or explicitly waive it.
2. Choose B9 option (a) or (b).
3. Then re-run `/sdd-design fix-getpnl-source-service` (full) from the round-5 checkpoint, or grant an explicit
   round-limit override for 251 so a round 6 can close both blockers.

## Session 2026-10-21 — B6 side-defect reports filed

- Operator (2026-10-21) authorized filing the B6 follow-up defect reports under `docs/reports/`. Both re-verified
  against code on `feature/fix-getpnl-source-service` @ `d077dcfe`; both SEV-2, sidecar `open`, single SEV token
  checked by grep.
- [x] addressed — live-fold sign loss (round-1 warning "Live fold sign loss ... unaddressed" and B6 item 1):
  `docs/reports/2026-10-21-portfolio-live-fold-sell-sign-loss-defect.md`. Evidence: unsigned `qty`
  `trading.go:1807`; `newQty = existing.Qty + fill.Qty` / `if fill.Qty > 0` `portfolio_service.go:310-311`;
  signed contract `pnl.go:26`.
- [x] addressed — bracket-leg realized understatement (B6 item 2):
  `docs/reports/2026-10-21-trading-bracket-leg-fills-missing-from-realized-pnl-defect.md`. Evidence: `pollFills`
  iterates only `s.orders` (`trading.go:1728`); leg ids written only to `trading.order_brackets`
  (`trading.go:3403-3405` Alpaca, `:3411-3422` IBKR); residual noted at `services/xstockstrat-trading/CLAUDE.md:248-249`.
- Both paths cited in product-spec.md § Out of Scope (existing live-fold bullet + new bracket-leg bullet). Paths
  existed before citation (F-04).
- B6 closed. B9 (adapter wire-test seam) remains the sole blocking objection; status stays `spec-ready`.
- Files written: the two reports + `.status` sidecars, product-spec.md, context.md.

## Session 2026-10-21 — sdd-design (full) halted at gate, round 8

- `/sdd-design fix-getpnl-source-service` full debate ran to round 8 (operator-extended cap). Synthesis grounded at
  HEAD `d077dcfe`. Auto-approval did not fire: rounds >= 2 met, Floor clean, every @AC impact PRESERVE/EXTEND, but
  1 blocking objection (B6) remained at synthesis. `design.md` NOT written; `status.md` stays `spec-ready`.
- Ordering deviation: rounds 6, 7, 8 ran before the B6 reports were filed, contrary to the operator's 2026-10-21
  "file before the debate continues" directive. Recorded here in one entry; per-round r6/r7/r8 entries (P-05) are
  still owed by the orchestrator.
- Branch tip is now `d707d239` (B6 filing session above). The r8 synthesizer did not see it.
- Checkpoint: `state-r8.json` in the orchestrator scratchpad (seeds/251).

## Open Threads

### Current best approach (after round 8)

Items 1, 2, 4, 5, 8 of round 5 stand verbatim (ledger keyset paging in `queryEventsPage.ts` + delegate; B8 252
reconciliation; ctx-first `classifyGetPnLError`/`toGRPCError`; trading `side` key; UI FR-3; ship gate; build order).
Items 3/3' and 9 of round 6 stand. Round-8 additions (portfolio paths under `services/xstockstrat-portfolio/internal/`):

- **A. Shared ledger fake** — new `testdata/ledger.go` (imports nothing from service; precedent
  `testdata/offline_pnl.go`). `Ledger{LedgerServiceClient; Events; OnQuery func(ctx, req) error; calls atomic.Int64}`
  + `Calls()`. No `Block` field (case 4 blocks in OnQuery on `<-ctx.Done()`). `AppendEvent` no-op (emitEvent
  `portfolio_service.go:1043`). QueryEvents order: count; `Unimplemented` if `TimeRange`/`FromSequence` set
  (`ledger.proto:64`, `:66`; fails.md:577); OnQuery error; `status.FromContextError`; filter EventType/
  SourceService/StreamKey only when set (`ledgerServiceImpl.ts:130-141`); slice order = recorded_at order (`:162`),
  may disagree with Sequence; PageSize 0 -> 100 (`:157`) with the fake's own opaque token. Builders
  FilledEvent/PartialEvent/CreatedEvent take `seq int64`, bare-id StreamKey (`trading.go:649`, `:1805`).
  SourceService literal covered by the extended source-service parity test (builders = GetPnL filter
  `portfolio_service.go:752` = trading producer; fails.md:1708). In-package `fillEvent`
  (`portfolio_fill_errors_test.go:24`) stays inline: live-fold shape owned by the live-fold follow-up.
- **B. Test shim** — new `service/export_test.go`: `WirePosition`, `NewWireTestService(t, ledger, positions...)`
  layered on `newQuoteSvc` (`portfolio_quote_deadline_test.go:93-112`) + `newFakeStore()`/`wideCaps()`
  (`watchlist_service_test.go:37`, `:362`); always registers the `FROM portfolio.positions` expectation
  (`portfolio_service.go:724-726`); exports `CtxWithUser` (`watchlist_service_test.go:280`), `Guard`
  (`portfolio_quote_deadline_test.go:70`). 2-line import-cycle constraint comment. Positive-side cache is a
  zero-value-safe `PortfolioService` field (lazy init under own mutex; precedent `portfolio_service.go:50-51`,
  `:64-65`), not package-level. Literals `portfolio_quote_deadline_test.go:102`, `portfolio_fill_errors_test.go:64`,
  `watchlist_service_test.go:276`, plus fakeLedger/stopLedger/fillEvent, listed as reviewed-unchanged.
- **C. Adapter test** — new `service/portfolio_grpc_wire_test.go` (`package service_test`) via
  `handler.NewPortfolioHandler(svc).GRPCHandler()` (`portfolio_handler.go:49`, `:242`, `:276-282`, `:432`):
  (1) fill without order.created/submitted -> FAILED_PRECONDITION; (2) plain ledger error -> UNAVAILABLE;
  (3) live ctx, OnQuery cancels -> CANCELED, `Calls() >= 1`; (4) 50ms timeout, OnQuery blocks, under `Guard` ->
  DEADLINE_EXCEEDED, `Calls() >= 1`; (5) `TestWire_DeleteSystemManagedWatchlist_F127AC7`, seeded via
  EnsureSignalWatchlist (`portfolio_handler.go:370`, `portfolio_service.go:1718-1727`) -> FAILED_PRECONDITION;
  (6) no x-user-id -> INVALID_ARGUMENT; (7) `Current: 0`, zero-value `stubMarketData{}`
  (`portfolio_service_test.go:58-63`), live ctx -> UNAVAILABLE (pins portfolio @AC-5 EXTEND). Cases 3/4 never
  start from a pre-done ctx (pgxmock `expectations.go:71-77`). Gap: no grpc.Server, interceptors, serialization.
- **D. Fold fixtures** — F1: filled buy 10@100 (seq 1), partial-only sell 4@150 (seq 2), filled buy 10@200 (seq 3)
  -> 200. F2: three partial-only orders A buy 10@100 (1), S sell 4@150 (2), B buy 10@200 (3), Events slice order
  A,B,S, fresh shim+fake per iteration, exactly 200 on all 20 runs. A sequence-dropping fold: A,B,S -> 0, B,S,A ->
  -200, S,A,B -> 200 (coincidence, 1/8 per run under random iteration); pass probability ~(1/8)^20. Under
  insertion-stable iteration it sees A,B,S and fails every run, so F2 is stronger, not weaker (the r8 proposer's
  "strongest risk" text is inverted and must not reach design.md). Drain test: 501 order.filled events with
  `side`, PageSize 500 (`portfolio_service.go:754`) -> each fill folded once, terminates under `Guard`, exactly 2
  order.filled QueryEvents calls; named in the FR-5 AC.
- **E. Touchpoints** — the three new files above; F1/F2/drain in the existing GetPnL test file; parity test
  extended. No proto, migration, config, go.mod/go.sum or ci.yml change; no new runtime edge. `testdata` counted
  in COVERPKGS (`.github/workflows/ci.yml:256`) accepted, precedent `offline_pnl.go`.
- **F. Doc reconciliations at design write** — `recon.md:139` portfolio @AC-5 PRESERVE -> EXTEND; recon.md
  Existing Business Rules adds platform @AC-7 @feature-127 (`platform.feature:34-41`) PRESERVE backed by case (5);
  C-15 appends AC-4..AC-22 + FR-4/FR-5 with @FR tags (F1, F2, drain, adapter cases 1-7).
- **B9** — debate converged on option (a) (`export_test.go` adapter test) under the standing authorization. Not
  an operator pick. Closes round-5 "Operator decision needed #2" and the B9 "Operator picks one" line.

### Blocking objections

- [ ] **B6** [C-10/C-14, P-03/P-05, F-04] Blocking at the r8 synthesis (`d077dcfe`). Status at `d707d239`: both
  reports exist (`docs/reports/2026-10-21-portfolio-live-fold-sell-sign-loss-defect.md`,
  `docs/reports/2026-10-21-trading-bracket-leg-fills-missing-from-realized-pnl-defect.md`, sidecars `open`), cited
  at `product-spec.md:191`, `:196`, with a closing entry ("B6 side-defect reports filed"). Substance appears
  discharged. Residual from state-r8 item 6: (i) the per-round r6/r7/r8 deviation entries were not appended before
  filing and are still absent (this entry batches them); (vii) the closing entry ticks B6 but records B9 as still
  blocking, not as debate-resolved. Operator: accept B6 as closed at `d707d239`, or require the per-round entries
  first.

### Non-blocking (folded; must appear as design text)

- Corrected F2 risk text (P-03); zero-value-safe cache field (fails.md:2710); fake returns Unimplemented for
  TimeRange/FromSequence (fails.md:577); drain test gives paging a consumer (C-15/C-18, fails.md:1441); case (7)
  pins @AC-5 EXTEND with live-ctx precondition (C-16); no Block field (C-18); fillEvent stays inline with reason
  (C-13/C-18); parity test covers builders (fails.md:1708); case (5) seeded via EnsureSignalWatchlist, `_F127AC7`
  (C-15); COVERPKGS accepted, no ci.yml edit (C-08).
- Carried r5-r7: cold-cache gate (iv) latency; 252 `if (!impl) return;` delegate-guard residual; queryEventsPage.ts
  strip-types constraint, integer-microsecond keyset, ledger-pg-test 2-page drain; product-spec Affected Services /
  Fix Scope (`:152`, `:161-164`); document opaque page_token in ledger CLAUDE.md; scratch-tsconfig compiled run;
  confirm no in-repo runtime GetPnL caller; dev smoke under fail-closed mTLS; ledger-pg-test SEED_USER_ID scoping
  (`ci.yml:667`); permanent FAILED_PRECONDITION counting/remediation; ms-precision premise correction; RED hygiene;
  /sdd-spec re-greps every citation.

### Floor breaches

- None.

### Uncovered @AC changes

- None. All impacts PRESERVE or EXTEND (no operator coverage required):
  - PRESERVE: 251 @AC-1, @AC-2, @AC-3; portfolio @AC-6; platform @AC-7 @feature-127 (case 5); trading @AC-10;
    trading offline @AC-14/@AC-7/@AC-11; ledger @AC-8.
  - EXTEND: portfolio @AC-5 @feature-229 (FAILED_PRECONDITION / DEADLINE_EXCEEDED / CANCELED under ctx-first
    precedence; ErrQuotesUnavailable stays UNAVAILABLE while ctx live; case 7); 251 appended @AC-4..@AC-22 with
    FR-4/FR-5.

### Open risks

- Import-cycle trap (in-package `_test.go` importing `internal/handler`); mitigated only by the shim comment.
- Shim coupled to `newQuoteSvc` signature. Adapter test skips grpc.Server/interceptors/serialization.
- Case (4) relies on no internal timeout in the GetPnL ledger stage (`portfolio_service.go:751-755`); 50ms under
  -race may flake (raise to 200ms).
- Drain test's "exactly 2 calls" coupled to hard-coded PageSize 500.
- Cold-cache cliff after deploy; permanent FAILED_PRECONDITION for unresolved mixed-era fills; ledger delegate line
  unguarded until 252; cursor chunk exclusion unconfirmed until gate (iv); uncapped platform-wide order.filled
  drain; short-deadline callers now see DEADLINE_EXCEEDED; DeleteWatchlist 500 -> 400 (intended).
- Sequence order is racing-goroutine insert order; interleaved partials may differ from broker figure.
- Live-fold sign loss and bracket-leg understatement remain until their follow-ups land.
- 251/252 merge collision relies on the second merger honouring reconciliation.

### Operator decision needed

1. Accept B6 as discharged at `d707d239`, or require the per-round r6/r7/r8 context entries first.
2. Then evaluate the gate against `state-r8.json` (no further debate round needed) and write `design.md`
   carrying approach A-F and the corrected F2 risk text.

## Session 2026-10-21 — sdd-design (in progress, rounds 1-8)

- Persistence step (P-05) of the full `/sdd-design fix-getpnl-source-service` debate before it continues past
  round 8. Source: orchestrator checkpoints `state-r1.json`..`state-r8.json` (seeds/251), read as data. Branch tip
  at write: `e28cce95`. `design.md` NOT written; `status.md` stays `spec-ready`. Floor breaches: none in any round.
- This entry discharges state-r8 item 6(i) (per-round records, one sub-section per round) and 6(vii) (B9 (a)
  recorded as debate-resolved). Earlier "halted at gate" entries batched these; they are not edited (append-only).

### Operator decisions (binding, recorded 2026-10-21)

- Standing authorization: designs run in FULL mode only (no quick designs for automated fixes); the orchestrator
  auto-approves the design gate once rounds >= 2, no unresolved Floor (F-*) breach remains, no blocking objection
  remains, and every CHANGE to an existing @AC business rule is covered by an operator decision below.
- Full design depth (operator: full is the minimum).
- Operator override (2026-10-21): the debate cap was lifted to 8, and on 2026-10-21 lifted again to 12 for this
  feature (relayed request "Override limit for 251").
- Operator approval (2026-10-21): the two OPEN-B6 side-defect reports were to be filed before the debate
  continued — done in `d707d239`.

### Orchestrator evidence (verified facts, not decisions)

- Verified 2026-10-21 on `origin/feature/fix-getpnl-source-service` (`e28cce95`):
  `docs/reports/2026-10-21-portfolio-live-fold-sell-sign-loss-defect.md` and
  `docs/reports/2026-10-21-trading-bracket-leg-fills-missing-from-realized-pnl-defect.md` exist with `open`
  `.status` sidecars (commit `d707d239`); product-spec.md cites both under Out of Scope (`:191`, `:196`); this file
  has the session "B6 side-defect reports filed" (`:253`). Re-checked by this step at `e28cce95`.
- Rounds 6-8 reported B6 as unfiled only because the read-only checkout they read was stale (`d077dcfe`); it is now
  refreshed to `e28cce95`.

### Per-round objection closures

- **r1** — Skeleton accepted: ledger paging fix, source-service const, merged paging helper, signed qty via side
  lookup + producer `side`, sequence-ordered fold, fail-closed errors. 4 blockers opened: (a) unbounded ledger load
  on the single `DB_POOL_MAX=1` query connection shared with AppendEvent; (b) permanent unresolved side surfaced as
  retryable UNAVAILABLE (`portfolio_handler.go:423-424`); (c) deploy-order infinite loop against an old ledger that
  ignores `page_token` (`ledgerServiceImpl.ts:171`); (d) cross-account netting, `pnl.Fold` keys by symbol only
  (`pnl.go:67`). Corrections: ms-precision `recorded_at` (`ledgerServiceImpl.ts:35`, `:56`), bad UUID -> code 13.
- **r2** — Closed r1 (a)-(d): user-pinned ListOrders + point lookups; FAILED_PRECONDITION for unresolved side vs
  UNAVAILABLE for read gaps; repeated-token / repeated-event_id guards; composite `account_id|symbol` key. Opened
  B1 (page cap in wrong unit, data-tuned permanent outage), B2 (ledger load unmeasured vs fire-and-forget 10s
  AppendEvent, `trading.go:3663-3674`), B3 (mixed-era `''` account bucket fabricates realized).
- **r3** — Closed B1 (cap dropped, four termination guards), B2 (lookup concurrency, ship gate (iv) thresholds),
  B3 (three-way mixed-era rule, FR-4). Opened B4 (keyset fix has no CI-RED-able test; `ledgerServiceImpl.test.ts:21-29`
  swallows import failure, routed to 252), B5 (side/mixed-era checks not user-scoped, preload is platform-wide
  `portfolio_service.go:772`), B6 (live-fold sign loss + bracket-leg follow-up reports unfiled; C-10/C-14).
- **r4** — Closed B4 (strip-safe `queryEventsPage.ts`, unguarded unit test, `ledger-pg-test` CI job), B5 (five-stage
  pipeline, checks after user/mode filter, zero-lookup RED for other user). Opened B7 (`toGRPCError`
  `portfolio_handler.go:432-447` maps FailedPrecondition/DeadlineExceeded/Canceled to INTERNAL), B8 (dormant
  `ledgerServiceImpl.test.ts` cases collide with 251 once 252 lands). B6 carried.
- **r5** — Closed B7 (explicit cases mirroring `trading.go:223-238`, ctx-first `classifyGetPnLError`; platform @AC-7
  brought into wire conformance), B8 (`makeRow` `cursor_us`, hasMore decode, soft merge-order row). Preload dropped
  for positive-only cache (C-18). Opened B9 (adapter wire test has no seam: concrete `*service.PortfolioService`,
  `portfolio_handler.go:45`, `:49`). B6 carried. Halted at cap 5.
- **r6** — Closed B9 seam: option (a) `export_test.go` + `package service_test` adapter test; sequential lookups
  (go.mod untouched); sequence carried on map-appended partials. Opened B10 (pre-done ctx races pgxmock
  `expectations.go:71-77`), B11 (unexported `posRow`/`positionCols`/`anyArgs` not visible to service_test), B12
  (two-partial fixture order-invariant, cannot fail). B6 carried (stale checkout).
- **r7** — Closed B10 (live ctx, cancel/block inside OnQuery, `Calls() >= 1`), B11 (setup-owning shim on
  `newQuoteSvc`, always registers positions expectation), B12 (three-partial F2; adversarial Events order A,B,S,
  buggy pass ~(1/8)^20). Folded: `seq int64` (`ledger.proto:33`), filter-only-when-set, PageSize 0 -> 100, case (4)
  under guard, no-op AppendEvent, `driver.go:39-41` citation. B6 carried (stale checkout).
- **r8** — No new blocker. Folded as REQUIRED (non-blocking): corrected F2 risk text (insertion-stable iteration
  makes F2 stronger, not weaker; P-03); zero-value-safe cache field (fails.md:2710); fake returns Unimplemented for
  `TimeRange`/`FromSequence` (`ledger.proto:64`, `:66`; fails.md:577); 501-event drain test as paging consumer
  (PageSize 500, `portfolio_service.go:754`); wire case (7) pins portfolio @AC-5 EXTEND; no `Block` field;
  `fillEvent` stays inline; parity test covers builders (fails.md:1708); case (5) seeded via EnsureSignalWatchlist,
  named `_F127AC7`; COVERPKGS accepted (`ci.yml:256`). B6 reported blocking (stale checkout `d077dcfe`).

### Surviving approach (state-r8)

- Round-5 items 1, 2, 4, 5, 8 verbatim: ledger keyset paging in `queryEventsPage.ts` + thin delegate (integer-µs
  compare, ORDER BY recorded_at, event_id; error map 22007/22008/22P02 -> 3); 252 reconciliation; ctx-first
  `classifyGetPnLError`/`toGRPCError`; trading `side` key; UI FR-3; ship gate incl. cold-cache gate (iv); build order.
- Portfolio GetPnL: five-stage pipeline, fold key `trading_mode|account_id|symbol`, fail-closed sentinels, no
  preload, sequential per-order StreamKey side lookups for the caller's side-less fills only, positive-only cache
  as a zero-value-safe `PortfolioService` field, `sort.SliceStable` by sequence before `pnl.Fold`.
- Round-8 A-F as recorded in the "halted at gate, round 8" entry above: `testdata/ledger.go` fake; `export_test.go`
  shim (`WirePosition`, `NewWireTestService`, `CtxWithUser`, `Guard`); `portfolio_grpc_wire_test.go` adapter cases
  1-7; F1 (200), F2 (A,B,S, exactly 200 on 20 runs), FR-5 drain test; touchpoints with no proto/migration/config/
  go.mod/ci.yml change; doc reconciliations (`recon.md:139` @AC-5 PRESERVE -> EXTEND; platform @AC-7 @feature-127
  PRESERVE; C-15 append AC-4..AC-22 + FR-4/FR-5 with @FR tags).
- **B9 — RESOLVED BY THE DEBATE** as option (a) under the standing authorization (converged r6, refined r7-r8). Not
  an operator pick. Closes round-5 "Operator decision needed #2" and the B9 "Operator picks one" line.
- @AC impacts: PRESERVE (251 @AC-1..3; portfolio @AC-6; platform @AC-7 @feature-127; trading @AC-10; trading offline
  @AC-14/@AC-7/@AC-11; ledger @AC-8) and EXTEND (portfolio @AC-5 @feature-229; 251 @AC-4..@AC-22). No CHANGE, so
  no operator coverage required.

### Open blocking objections

- [ ] **B6** — the only blocker in state-r8, raised against stale `d077dcfe`. Per the orchestrator evidence above,
  its substance (both reports filed, sidecars `open`, cited at `product-spec.md:191`, `:196`, closing entry `:253`)
  is discharged at `d707d239`; its residual ordering items 6(i) and 6(vii) are discharged by this entry. The gate
  evaluator confirms closure against `e28cce95`; this persistence step does not evaluate the gate.
- No other blocking objection is open. The r6/r7/r8 ordering deviation (rounds run against a stale checkout before
  the filing was visible) is recorded per round above.

### Next

- Debate continues past round 8 (cap 12) or proceeds to gate evaluation against `state-r8.json`; at design write,
  `design.md` carries approach A-F, the corrected F2 risk text, and B9 as debate-resolved.

## Session 2026-10-21 — sdd-design (full) round 9, gate

- Gate evaluated on `feature/fix-getpnl-source-service` @ `1d47c0a7`. The r9 synthesis was grounded at `e28cce95`;
  the only later commit is the rounds 1-8 persistence entry above (no code change). Checkpoint: `state-r9.json`
  (seeds/251).
- Per-round outcomes (r1-r8 detail in "sdd-design (in progress, rounds 1-8)" above):
  - **r6** — B9 seam converged on option (a); B10/B11/B12 opened. B6 re-raised from stale checkout `d077dcfe`.
  - **r7** — B10/B11/B12 closed (live ctx + OnQuery, setup-owning shim, three-partial F2). B6 re-raised (stale).
  - **r8** — no new blocker; non-blocking folds A-F. B6 re-raised (stale).
  - **r9** — convergence round, no design change. B6 closed on verified evidence. Five non-blocking text fixes folded
    (R9-2..R9-5): parity pin `portfolio_service.go:753`/`:798` (not `:752`, EventType); `classifyGetPnLError` call
    site `portfolio_handler.go:96`, definition `:425`, table test `portfolio_handler_test.go:39-48` (calls `:40`,
    `:43`); @AC-5 backing-test preservation; append-only supersession; exact F2 risk text. Adversary verdict SOUND.
- Deviation (P-05): r6, r7 and r8 are recorded late, batched after the fact (here and in the rounds 1-8 entry). This
  does not satisfy P-05 "as they happen" for those rounds; it is a recorded deviation, not claimed compliance.
- The r6-r8 "reports unfiled" findings came from reading the stale checkout `d077dcfe` (orchestrator evidence). Git
  order: `d077dcfe` (r5 halt) -> `d707d239` (filing) -> `e28cce95` (r8 halt). Whether r6 ran before `d707d239` cannot
  be determined from read-only tools, so the "Ordering deviation" at `:276-278` stays as evidence, neither confirmed
  nor retracted.
- B6 CLOSED on evidence, not waived: both `docs/reports/2026-10-21-*` reports exist with `open` sidecars, cited at
  `product-spec.md:191`, `:195-196`; filing session `:253-269`; operator decision records it "done in `d707d239`".
- B9 RESOLVED BY THE DEBATE as option (a) under the standing authorization, NOT by an operator pick. This entry
  supersedes, without editing, `:268` ("B9 ... remains the sole blocking objection"), `:197-200` ("Operator picks
  one") and `:249` ("Choose B9 option (a) or (b)").
- Relayed request "Override limit for 251" names THIS feature and is a round-limit override, consistent with the
  recorded cap lift to 12. It is not a B9 pick, does not waive B6 (closed on evidence) and sanctions no @AC CHANGE.
  Contrast the "246" relay at `:144-145`.
- Gate decision: AUTO-APPROVED under the operator standing authorization (2026-10-21). Inputs: rounds 9 >= 2; Floor
  clean; zero blocking objections; @AC impacts PRESERVE/EXTEND only (portfolio @AC-5 @feature-229 EXTEND, platform
  @AC-7 @feature-127 PRESERVE), so no operator coverage is required. Write order (R9-4): this entry, then design.md,
  then recon.md reconciliation, then status.md.

## Session 2026-10-21 — sdd-design

- Phase 0 Recon: recon.md (written 2026-10-20; services: portfolio, trading, ledger, ui; key reuse: `pnl.Fold`
  unchanged + side→sign precedent `trading.go:876-886`; `internal/testdata/` fake home). Reconciled at this write:
  `recon.md` portfolio @AC-5 PRESERVE → EXTEND; platform @AC-7 @feature-127 added as PRESERVE.
- Phase 1 Grilling: 9 rounds (full; cap operator-lifted to 12). Chosen approach: ledger keyset paging in
  `queryEventsPage.ts` + fail-closed portfolio drain with per-order side lookups, positive-only cache, account-grain
  fold key and sequence-ordered fold; ctx-first error mapping; trading `side` key; user-pinned UI lineage; test
  harness via `export_test.go` adapter seam (B9 (a), debate-resolved). Rejected: B9 (b) pure-chain test, order.created
  preload, `errgroup`, dropping the `SourceService` filter, ledger proto user field.
- Constitution rules touched: C-11, C-15, C-16, C-10/C-14, C-12, C-13, C-18, C-03, C-09, C-08, F-01, F-04, F-06, F-07,
  F-08, F-11, P-01..P-05, PORTFOLIO-16. Floor breaches: none in any round.
- Status: spec-ready → design-approved (auto-approved under the operator standing authorization, 2026-10-21).
- Files written: design.md (new), recon.md, status.md, feature.md, context.md; ledger fails.md one line (stale
  read-only checkout re-raising a discharged blocker).

## Open Threads

### Decisions

- Design approved as design.md §1-§7: no proto/migration/config/go.mod/ci.yml change; ledger becomes a fix site
  (FR-5); `classifyGetPnLError(ctx, err)` with call site `portfolio_handler.go:96`, test
  `portfolio_handler_test.go:39-48`; parity pin replaces `portfolio_service.go:753`/`:798` with one const.

### Open threads (target step)

- [ ] C-15 append: AC-4..AC-22 into acceptance.feature + FR-4/FR-5 into product-spec, per design.md §6F, each with
  ≥ 1 @FR tag — before `/sdd-spec` traces test steps (not written at this design write).
- [ ] product-spec Affected Services / Fix Scope (`:152`, `:161-164`): ledger becomes a fix site, `ledger-pg-test` CI
  job added — `/sdd-spec` (P-03).
- [ ] `classifyGetPnLError` arity: `:96` + test `:40`/`:43` change together — portfolio handler step.
- [ ] PORTFOLIO-16 (`services/xstockstrat-portfolio/docs/context-constitution.md:34`) and portfolio `CLAUDE.md:28`
  ctx-first wording — teardown step.
- [ ] Import-cycle trap / shim coupling to `newQuoteSvc` — test-harness step.
- [ ] Case (4) 50ms window under -race (raise to 200ms if flaky) — adapter-test step.
- [ ] F2 residual 1/8 per run, (1/8)^20 ≈ 2e-18 over 20 runs; stable iteration fails a buggy fold every run — fold
  test step. Drain test's 2-call assertion coupled to PageSize 500 (`portfolio_service.go:754`).
- [ ] COVERPKGS counts `testdata` (accepted, `ci.yml:256`).
- [ ] Cold-cache cliff; cursor chunk exclusion; uncapped platform order.filled drain; AppendEvent latency — ship gate
  (iv).
- [ ] Permanent FAILED_PRECONDITION for mixed-era / unresolved fills: count + remediation path — ship gate (iii).
- [ ] Ledger delegate line unguarded until 252; scratch-tsconfig compiled run; 252 merge-order soft row + note in
  252 context.md — ledger step / integration PR.
- [ ] DEADLINE_EXCEEDED for short-deadline callers; DeleteWatchlist 500 → 400 — findings entry (intended).
- [ ] Dev smoke under fail-closed mTLS; ledger-pg-test SEED_USER_ID scoping (`ci.yml:667`) — ship gate / CI step.
- [ ] Confirm GetPnL has no in-repo runtime caller; ledger CLAUDE.md opaque page_token; stream-key doc drift —
  `/sdd-spec` / teardown.
- [ ] Ordering deviation `:276-278` stays unresolved evidence (no step).
- [ ] Bracket-leg and live-fold follow-ups (`docs/reports/2026-10-21-*`, `open`) — outside 251.
- [ ] `/sdd-spec` re-greps every design.md citation (only header-listed ones spot-checked at `1d47c0a7`).

## Session 2026-10-21 — sdd-spec

- Generated implementation-spec.md with 14 steps. Status design-approved → implementation-ready. Grounded on
  `feature/fix-getpnl-source-service` @ `2d991956`. Every design.md and recon.md citation the spec uses was re-grepped.
- C-15 append done in this session (owed at the design write, Open Threads above): acceptance.feature gained
  `@AC-4`..`@AC-22` from design.md §6F, each with ≥ 1 @FR tag, and product-spec.md gained FR-4 (isolation /
  account grain) and FR-5 (paging contract). The append is additive only; AC-1..AC-3 are unchanged (C-15 IDs
  append-only). Product-spec Affected Services and Fix Scope now record ledger and trading as fix sites plus the
  `ledger-pg-test` CI job, with no proto, migration or config change. This supersedes the open thread on
  `:152`/`:161-164` without editing it.
- Key codebase findings:
  - Citation corrections:
    - `ledger.proto` `time_range = 4` is at `:64`, `page = 5` at `:65`, `from_sequence = 6` at `:66`. design.md
      §6A cites `:64`/`:66` correctly.
    - ci.yml: the `ci-gate` needs list is at `:773-788` (echo `:792-807`) and the ledger change filter at `:60`.
    - The `toGRPCError` precedent is `services/xstockstrat-trading/internal/handler/trading.go:223-238`, not the
      service file. It covers FailedPrecondition only.
  - design.md:17 ("no … ci.yml change") conflicts with §1's `ledger-pg-test` job. The spec follows §1; COVERPKGS
    stays unedited (P-03, recorded in the spec Execution Summary).
  - The "extended source-service parity test" is **Not found**; none exists in portfolio. Step 6 creates
    `TestGetPnL251_SourceServiceParity` (const = testdata = literal) and Step 4 asserts the trading half. This is
    the two-half parity precedent of `pnl_fold_test.go:10-14`.
  - Only GetPnL sends a non-empty `page_token`. The UI callers send `''`, and trading `:2222` and HydrateStops
    `:534` send no page. The ledger keyset change therefore reaches no other caller.
  - `ledger.events` PK `(event_id, recorded_at)` (`001_ledger_events_hypertable.up.sql:22`) makes the
    `(recorded_at, event_id)` cursor unique (insights.md:3547).
  - No UI concurrency helper exists, so Step 11 adds `src/lib/positionLineage.ts`. vitest excludes `*Bff.ts` from
    coverage, which is why the lineage orchestration and BFF predicate live in `src/lib/`.
  - `positions.spec.ts:129-138` keys its lineage interception on "no streamKey". After FR-3 the lineage query
    carries one, so Step 10 re-keys it on `eventType`.
  - The e2e mock `listOrders` (`mock-backend.ts:311-316`) filters only by symbol. Step 10 adds account and mode
    filtering (fails.md 200 "list the e2e mock backend in Files").
- Spec-level choices (within design.md, recorded for impl-spec review):
  - F1/F2/drain go in `portfolio_quote_deadline_test.go`, the file holding the existing GetPnL tests
    (TestGetPnL_AC5/AC6).
  - 251 tests carry a `251` qualifier so they do not collide with feature 229's `AC5`/`AC6` names.
  - Wire case (4) uses a 200ms deadline (the design Open Risks flake mitigation).
  - The fold key goes into `pnl.Fill.Symbol` (`pnl.Fold` unchanged).
- Files written: acceptance.feature, product-spec.md, implementation-spec.md (new), status.md, feature.md,
  context.md.

### Open threads (target step)

- [x] C-15 append AC-4..AC-22 + FR-4/FR-5 — done this session.
- [x] product-spec Affected Services / Fix Scope — done this session.
- [x] Confirm GetPnL has no in-repo runtime caller — re-confirmed (spec Execution Summary).
- [ ] `classifyGetPnLError` arity with `:96` and test `:40`/`:43` — Steps 8/9.
- [ ] PORTFOLIO-16 and portfolio `CLAUDE.md:28`; stream-key doc drift; ledger opaque page_token — Step 12.
- [ ] 252 soft merge-order row + 252 context note — Step 13.
- [ ] Ship gate (i)-(iv) + dev smoke under mTLS — Step 14.
- [ ] Scratch-tsconfig compiled run — Step 3 verification.

## Session 2026-10-21 — sdd-review impl-spec

- Mode B (advisory); status stays `implementation-ready`. Criteria verdict FAIL (2 blockers, 10 warnings); overlap
  verdict WARN (11 shared-file collisions, no field/migration/key collision). Each claim was re-verified on
  `origin/feature/fix-getpnl-source-service` @ `3581fa07` before any edit.
- Blockers, discharged as stale (no edit): the reviewer read an older checkout
  (`/home/user/xs-feat/251-fix-getpnl-source-service`).
  - C-15/C-01 AC traceability: `acceptance.feature` on the branch tip carries `@AC-1`..`@AC-22`, with `@FR-1`..`@FR-5`
    each tagged ≥ 3 times. `product-spec.md:64`/`:69` define FR-4/FR-5 (appended by sdd-spec, context.md:581).
  - C-01/C-11 design gate: `design.md` exists (9 rounds, approved), `status.md` = `implementation-ready`, and
    commit `2d991956` is the spec-ready → design-approved flip. The design.md § citations resolve (§1-§7, :17, :168-171).
- Addressed in implementation-spec.md:
  - C-08: each test step (2, 4, 6, 8, 10) now names the paired GREEN step that enforces its coverage threshold.
  - 252 overlap: 252 is `implementation-ready` (its branch `status.md`); this branch's copy of 252 `status.md` is
    a stale `draft`. Step Dependencies now cover 252 Step 4 (the `tsc` → `dist/__tests__` runner and the `.ts`
    import strip, which break 251's `queryEventsPage` test imports) and 252 Step 5 (guard removal).
  - COVERPKGS lines in Steps 5/7/9 now `export GOWORK=off` first. Verified: `GOWORK=off go list ./...` in portfolio
    lists no testdata package, so `internal/testdata` is outside COVERPKGS, `go vet ./internal/...` and
    golangci-lint. Step 6 vets it by explicit path. The design.md §6E/:261 "counts toward" claim is recorded as
    design drift in the Execution Summary; design.md itself is not edited.
  - Step 10: `LINEAGE_ORDERS` now lives in `e2e/fixtures/orders.ts`, which is added to Files (F-08). The vitest
    test imports both lineage fixtures (C-12).
  - Step 10 mock backend: `ORDERS` stays symbol-only, and `LINEAGE_ORDERS` is appended only for the lineage page
    size (51). The new `queryEvents` branch is scoped to `eventType === 'order.filled'`, and the agnostic
    fallthrough (`mock-backend.ts:450-470`) is kept, with only its source literal fixed.
  - Step 6: dropped `TradingSourceServiceForTest`, which had no consumer (C-18).
  - Steps 6/8 and Step Dependencies: the red-package PR CI note (P-06/F-05).
  - Step 12: the grep now also matches ledger `CLAUDE.md:34` `order:{id}`. `order.approval_requested` (`:150`) is
    corrected to the bare id (`trading.go:655`), and `order.approved` (`:151`, no emit site) is left alone.
  - Step 14 → promotion gate PG-1, outside the step counter (Total Steps 13).
  - Step 13 now writes a rebase-only merge-order blockquote covering 252/248/249/250/241 (format
    `merge-order.md:121-138`), with the conflict at 252's `:138` anchor accepted.

## Open Threads

- [ ] 241 `implementation-spec.md:70-71` wrongly says 251 edits `SourceService` at `trading.go:2188`
  (`escalateSystemic`). 251 has no such edit. Outside 251's write scope, so it must be corrected in 241 before
  either feature executes (operator).
- [ ] Overlap scan gaps: the 242 and 245 checkouts had no implementation-spec.md, so their overlap with 251 is
  unverified. Re-scan before the integration PR.
- [ ] Residual risks carried to PG-1 / the integration PR, unchanged:
  - the uncapped platform-wide `order.filled` drain;
  - the cold-cache side-lookup cliff on the ledger's 1-connection query pool (F-06 budget unchanged);
  - the `(extract(epoch …)*1e6)::bigint` cursor exactness, to confirm on the prod PG version at PG-1 (iv);
  - permanent FAILED_PRECONDITION for fills with no side-bearing sibling (immutable ledger, no backfill);
  - sequence order reflecting racing-goroutine insert order.
- [ ] Step 10's page-size discriminator (`pageSize === 51`) couples the mock to `LINEAGE_MAX_ORDERS`. If an existing
  spec ever lists orders at page size 51 it would see lineage orders. Accepted; revisit at Step 10 RED if a spec
  regresses.
- Files written: implementation-spec.md, context.md.

## Session 2026-10-30 (sdd-execute sequential (sdd-batch-execute))

- Up-front confirmation: the operator approved the plan by standing authorization (operator chat 2026-10-28/30,
  session_01NpS3HShZK6pSnogA7CFo2f: "Start executing features 241-276" via batch-execute; unattended checkpoints,
  C-16 promotion auto-confirmed unless it changes an existing @AC rule, merge-train authorized, 255/275 deferred;
  operator-only DB/prod steps: open PR, hold merge; the 2026-10-30 widening allows test fakes/fixtures/test-registry
  entries outside Files when no assertion or production behavior changes). Checkpoints: `report`. Rollout
  verification is staging-only (operator 2026-10-30: "Prod is not running. Staging is enough").
- Dependency 257 merged to main-dev as `079870fa` (#1371). `origin/main-dev` merged into the branch (one conflict in
  `docs/roadmap/ledger/fails.md`, both sides kept; ledger-guard clean).
- Re-spec of all step bodies against current code (see implementation-spec.md "Re-spec 2026-10-30"):
  - Steps 1-3 `superseded`: the ledger `sequence` keyset `page_token` shipped via 257/263
    (`ledgerServiceImpl.ts:166-240`); AC-12/AC-13 are held by `db/queryPagination.db.test.ts` and
    `ledgerServiceImpl.test.ts`; CI `ledger-db-test` exists.
  - Step 4/5: anchors moved (`trading.go:1832`, `:1849`, `emitLedgerEvent` `:3743`); `side` is still absent from both
    fill payloads.
  - Step 6/7: 257 added `collectFills` (1000/page, `ErrLedgerUnavailable`); `SourceService: "trading"` remains at
    `portfolio_service.go:802`. `ErrRealizedUnavailable` is dropped in favour of `ErrLedgerUnavailable`. 257's
    `portfolio_pnl_paging_test.go` fixtures (side-less, signed sells) must migrate in Step 6 or they turn RED at Step 7.
  - Step 8/9: `classifyGetPnLError(err)` at `portfolio_handler.go:426`, call site `:127`; `toGRPCError` `:433`.
  - Step 10/11: feature 263 forces `ownerOnly` in `traderBff.ts`, so the BFF backstop and `isForeignFillEvent` are
    dropped; `toPbTradingMode` (`src/lib/tradingMode.ts`) is reused.
  - Step 12/13: the ledger `page_token` doc edit is dropped (`CLAUDE.md:49`); the 252 note is dropped (252 `launched`).
- Acceptance wording drift (own feature file) to fix at Step 6: AC-9 (page size 1000, not 500 / 2 calls) and AC-12
  (ordered by `sequence`). Not edited in this re-spec session.
- Files written: implementation-spec.md, feature.md, context.md, status.md.

## Session 2026-10-30 — Step 4 executed (sequential)

- Step 4 done: `trading_fill_side_test.go` adds `TestFillEmit251_AC10_CarriesSideSourceAndFees` (2 rows, driven via
  `CancelOrder` -> `reconcileNotCancelable` -> `applyBrokerOrderStatus`).
- RED captured: both rows fail with `payload side = "", want ORDER_SIDE_SELL` (source, stream key, qty keys and `fees`
  assertions come after it and are untested until Step 5). golangci-lint unrunnable here (built with go1.26, module needs 1.27); one `notCancelableSvc` declaration (C-13).
- Line drift vs the Codebase Evidence in this repo's HEAD: none relied on by the test.
- Next: Step 5 (add `side` to both fill payloads in `trading.go`) turns this GREEN.

## Session 2026-10-30 — Step 5 executed (sequential)

- Step 5 done: `applyBrokerOrderStatus` in `trading.go` now lifts both fill payloads to locals and adds `side` (`order.Side.String()`) when the side is not UNSPECIFIED; `emitLedgerEvent` unchanged.
- GREEN: `TestFillEmit251_AC10_CarriesSideSourceAndFees` passes (both rows); `go test ./... -race` passes for the whole trading module. RED was Step 4's commit (`payload side = ""`).
- golangci-lint unrunnable (go1.26 build vs go1.27 module); `gofmt -l` and `go vet` clean.
- Next: Step 6 (portfolio RED tests).

## Session 2026-10-30 — Steps 6+7 executed together (sequential, standing rule)

- Merged per the operator's rule ("Merge pairs + standing rule"): Step 6 tests need `tradingSourceService` / `ErrFillUnattributable` from Step 7, so the package could not compile between them. One commit; RED = compile failure (`undefined: tradingSourceService`, `ErrFillUnattributable`); GREEN = `go test ./... -race` passes for the portfolio module.
- Added `internal/testdata/ledger.go` (fake ledger, `FilledEvent`/`PartialEvent`/`CreatedEvent`), `export_test.go` shim, parity test, 13 `TestGetPnL251_*` tests; migrated 257's paging fixtures to unsigned qty plus `side`. `acceptance.feature` AC-9/AC-12 amended in a separate commit first.
- GetPnL: `realizedPnL` folds kept fills sorted by ledger `sequence` at (mode, account, symbol) grain; `orderSide` looks up `order.created` then `order.submitted` (stream_key = order id) with a positive-only cache; `collectFills` fails closed on a repeated event_id or an empty page carrying a token. Producer source literal is at `trading.go:3676`.
- golangci-lint unrunnable (go1.25 build vs go1.27 module); `gofmt -l` clean.
- Next: Step 8 (handler/wire RED tests).

## Session 2026-10-30 — Step 8 executed (RED)

- Added `internal/service/portfolio_grpc_wire_test.go` (7 `TestWire*` cases through the real `GRPCHandler()` adapter, using the Step 6 shim) and, in `internal/handler/portfolio_handler_test.go`, ctx-first `classifyGetPnLError` calls, `TestClassifyGetPnLError_CtxFirst` and table-driven `TestToGRPCError`. The spec's "extra rows in `TestClassifyGetPnLError`" are a sibling test function to keep the 257/229 assertions untouched.
- RED captured: handler package fails to compile (`too many arguments in call to classifyGetPnLError`); wire cases fail at runtime: AC4 gets `Internal` (want FailedPrecondition), AC7 cancel/deadline get `Unavailable` (want Canceled/DeadlineExceeded), F127 AC7 delete guard gets `Internal` (want FailedPrecondition). Cases 2, 6, 7 already pass. GREEN is Step 9.
- golangci-lint not run: the handler test package cannot compile until Step 9. `gofmt -l` clean; one `func FilledEvent` site.
- Next: Step 9 (ctx-first classifier, explicit `toGRPCError` codes).

## Session 2026-10-30 — Step 9 executed (GREEN)

- `portfolio_handler.go`: `classifyGetPnLError(ctx, err)` (ctx DeadlineExceeded/Canceled first, then Unavailable for quotes/ledger, FailedPrecondition for `ErrFillUnattributable`, else Internal); call site updated; `toGRPCError` gains FailedPrecondition/DeadlineExceeded/Canceled cases.
- GREEN: `go test ./... -race -count=1` passes for the portfolio module (Step 8 wire + handler tests). Non-excluded packages coverage 64.4% (>= 40%). RED was Step 8's commit (arity compile failure).
- golangci-lint unrunnable (built with go1.26, module needs 1.27).
- Next: Step 10 (UI lineage RED).

## Session 2026-10-30 - Step 10 executed (RED)

- Added `src/lib/positionLineage.test.ts` (5 vitest cases), `e2e/trader/position-lineage.spec.ts` (AC-3/18/19/20/21/22), `LINEAGE_FILL_EVENTS` / `lineageOtherUserFills` in `ledgerEvents.ts`, `LINEAGE_ORDERS` / `LINEAGE_LIST_PAGE_SIZE` in `orders.ts`, INVENTORY rows, mock `listOrders` and `queryEvents` lineage branches, and moved `positions.spec.ts` / `api-smoke.spec.ts` to the per-order, canonical-source form.
- RED captured: vitest fails to import `./positionLineage` (module missing, 346 other tests pass); Playwright `position-lineage.spec.ts` fails AC-3/18/19/21/22 (old hook reads the platform-wide page, sheet empty) and passes AC-20 (preserve guard). `positions.spec.ts`, `ledger-owner-scope.spec.ts` and `api-smoke.spec.ts` stay green; the first test of a cold dev-server run times out at 10s (compile), passes warm, unrelated to this step.
- The mock lineage branch is narrower than the spec (see Deviation Log) so 263's owner-scope spec keeps its default data.
- Env: root `node_modules` was a dangling tracked symlink; replaced locally by `pnpm install --frozen-lockfile --filter xstockstrat-ui...` (not committed, the symlink entry is left untouched).
- Next: Step 11 (`positionLineage.ts`, hook, truncation notice) turns these GREEN.


## Session 2026-10-30 - Step 11 executed (GREEN)

- Added `src/lib/positionLineage.ts` (`LINEAGE_MAX_ORDERS = 50`, `fetchPositionLineage`: ListOrders pinned by symbol/account/`toPbTradingMode`, page size 51, per-order QueryEvents with `xstockstrat-trading` at concurrency 3). `usePositionLineage` now returns `{events, truncated}` with `staleTime: 60_000`; `page.tsx` reads `.events`, renders a `CardNotice` when truncated.
- GREEN: `pnpm run test:unit` 351 passed (Step 10 vitest GREEN); `test:coverage` lines 76%; lint clean (warnings pre-existing); tsc clean for touched files (`e2e/insights/backfills.spec.ts` errors pre-exist); `grep "sourceService: 'trading'" src e2e/trader` empty. Playwright `position-lineage` + `positions` + `api-smoke` GREEN once the dev server is warm; AC-3 (the first test of a cold run) times out at 10s on the first compile, as noted for Step 10, and passes on re-run.
- Env: root `node_modules` dangling symlink replaced locally by `pnpm install --frozen-lockfile --filter xstockstrat-ui...` (not committed).
- Next: Step 12 (docs teardown reconciliation).

## Session 2026-10-30 - Step 12 executed (docs)

- Portfolio `CLAUDE.md`: ctx-first `classifyGetPnLError` wording; `order.filled` row gains the `GetPnL` query-time consumer with `side` resolution (payload, `order.created`, `order.submitted`); `order.partially_filled` row gets the same rule plus the account-grain sequence-ordered fold. PORTFOLIO-16 updated; three findings rows added (`req.Range` echo-only, `HydrateStops` page 1, intended wire-code changes).
- Trading `CLAUDE.md`: stream key of the 11 emitted `order.*` rows is the bare `{order_id}`; `order.approved` (no emit site) and `order_intent.*` keep their prefixes. Ledger `CLAUDE.md` `:34` and `:112` reworded for bare id vs `order_intent.*`. Ledger `page_token` already documented (`:49`).
- Teardown: the context-forge plugin is not run in this worktree; reconciled by hand against `classifyGetPnLError`, `orderSide`, and `trading.go` emit sites. Record both facts in the PR body.
- Next: Step 13 (merge-order note).

## Session 2026-10-30 - Step 13 executed (docs)

- `merge-order.md`: added a rebase-only blockquote `Note on 251 fix-getpnl-source-service ↔ 249` after the 252 note (before the `---`). 241 is `launched` so it is dropped per the step; 249 is `code-completed`, kept. The 252 context note is dropped (252 launched, per re-spec). The existing 257 hard row at `:81` is unchanged.
- Verification: `grep -n "fix-getpnl-source-service" merge-order.md` shows the `:81` row and the new note. TDD N/A (docs).
- Next: integration PR; PG-1 stays an operator gate.

## Session 2026-10-30 - sdd-batch-execute promotion plan (awaiting operator confirm)

```sdd-batch-promotion-plan
## Promotion plan - fix-getpnl-source-service (feature 251)

Source: docs/roadmap/features/251-fix-getpnl-source-service/acceptance.feature (22 scenarios, AC-1..AC-22).

### Verdicts
| @AC | target suite | CREATE/APPEND | verdict | note |
|---|---|---|---|---|
| 1,2,4,5,6,7,8,9,11,14,15,16,17 | services/xstockstrat-portfolio/acceptance/fix-getpnl-source-service.feature | CREATE | NEW | The Then asserts on the GetPnL RPC (realized_pnl or status code) |
| 18 | services/xstockstrat-portfolio/acceptance/fix-getpnl-source-service.feature | CREATE | NEW | Straddles portfolio and ui. The first Then is GetPnL realized_pnl, so portfolio owns it; the second Then is the ui fill lineage. Not duplicated in ui. |
| 10 | services/xstockstrat-trading/acceptance/fix-getpnl-source-service.feature | CREATE | NEW | The Then asserts trading's emitted ledger event payload |
| 12,13 | services/xstockstrat-ledger/acceptance/fix-getpnl-source-service.feature | CREATE | NEW | The Then asserts the ledger's QueryEvents paging and page_token handling |
| 3,19,21,22 | services/xstockstrat-ui/acceptance/fix-getpnl-source-service.feature | CREATE | NEW | The Then asserts the /trader/positions Fill lineage table |
| 20 | services/xstockstrat-ui/acceptance/fix-edge-owner-scope.feature | none | OVERLAP | Feature 263 @AC-1/@AC-2 already guarantee the trader BFF QueryEvents never returns another user's events. Skipped and recorded for human consolidation. |

No scenario is DUP or CONFLICT. Portfolio GetPnL rules from features 229, 231 and 240 cover quote availability and unrealized P&L only.

### Ready-to-write blocks
Scenario text verbatim from the source, with @feature-251 added to each tag line.

--- services/xstockstrat-portfolio/acceptance/fix-getpnl-source-service.feature (CREATE) ---
Header comment: "# Promoted from docs/roadmap/features/251-fix-getpnl-source-service/acceptance.feature on launch (C-16). Scenarios are verbatim; each carries its source @AC-* and a @feature-251 tag. A rule enters only by promotion."
Feature: xstockstrat-portfolio - GetPnL reads trading's fills from the ledger and folds them correctly
Each scenario tag line: "@AC-n <original @FR tags> @regression @feature-251":
- @AC-1 @FR-1 @FR-2: Realized P&L folds a sell that trading wrote with an unsigned qty (source lines 10-18)
- @AC-2 @FR-1 @FR-2: A partially filled sell that trading wrote with an unsigned filled_qty is included in realized P&L (lines 21-30)
- @AC-4 @FR-2: A caller's fill whose side cannot be resolved refuses GetPnL instead of fabricating a figure (lines 44-50)
- @AC-5 @FR-4: Another user's unresolvable fill does not affect the caller and costs no side lookup (lines 53-59)
- @AC-6 @FR-5: A ledger read failure mid-drain returns UNAVAILABLE, never a partial realized figure (lines 62-66)
- @AC-7 @FR-5: Scenario Outline: The caller's own deadline or cancellation maps to its own status code, including its Examples table (lines 69-78)
- @AC-8 @FR-5: Scenario Outline: A replaying ledger fails GetPnL closed, including its Examples table (lines 81-90)
- @AC-9 @FR-5: More than one page of fills folds every fill exactly once (lines 93-98)
- @AC-11 @FR-2: A fill whose payload carries side folds without a sibling lookup (lines 114-119)
- @AC-14 @FR-4: Fills on different accounts do not net against each other (lines 135-141)
- @AC-15 @FR-4: A symbol group mixing fills with and without account_id is refused (lines 144-147)
- @AC-16 @FR-2: Scenario Outline: Fills fold in ledger sequence order whatever order the ledger returns them in, including its two-row Examples table (lines 150-159)
- @AC-17 @FR-2: A partially filled sell that later fills folds once, from its order.filled event (lines 162-167)
- @AC-18 @FR-4 @FR-3: A LIVE fill is excluded from paper GetPnL and from the paper fill lineage (lines 170-175)

--- services/xstockstrat-trading/acceptance/fix-getpnl-source-service.feature (CREATE) ---
Same provenance comment, then "Feature: xstockstrat-trading - fill events carry side, canonical source_service and fees".
- @AC-10 @FR-1 @FR-2 @regression @feature-251: Scenario Outline: Trading's fill events carry the order side, the canonical source_service and the fee, including its Examples table (lines 101-111)

--- services/xstockstrat-ledger/acceptance/fix-getpnl-source-service.feature (CREATE) ---
Same provenance comment, then "Feature: xstockstrat-ledger - QueryEvents pages each event exactly once and rejects bad cursors".
- @AC-12 @FR-5 @regression @feature-251: The ledger pages QueryEvents exactly once per event, including recorded_at ties (lines 122-126)
- @AC-13 @FR-5 @regression @feature-251: A malformed page_token is rejected (lines 129-132)

--- services/xstockstrat-ui/acceptance/fix-getpnl-source-service.feature (CREATE) ---
Same provenance comment, then "Feature: xstockstrat-ui - /trader/positions fill lineage lists the trader's own fills".
- @AC-3 @FR-3 @regression @feature-251: The position fill lineage lists the trader's own fills that trading wrote to the ledger (lines 33-39)
- @AC-19 @FR-3 @regression @feature-251: The fill lineage finds the trader's fill even when it is not in the first platform-wide page (lines 178-182)
- @AC-21 @FR-3 @regression @feature-251: The fill lineage caps at 50 orders and says so (lines 191-195)
- @AC-22 @FR-3 @regression @feature-251: A fill whose order row still shows a non-filled status is listed (lines 198-202)

### Notes
- AC-18 is attributed to portfolio: the only scenario with two observable subjects; the ui half is carried by the same scenario.
- AC-20 is OVERLAP with services/xstockstrat-ui/acceptance/fix-edge-owner-scope.feature (@AC-1, @AC-2, @feature-263). AC-20 uses an order-id stream_key, 263 AC-1 uses an account: key and AC-2 no key. If the reviewer thinks the order-id key is a distinct guarantee, promote as NEW instead.
- Feature 257 (fix-ledger-query-pagination) GetPnL paging scenarios are not promoted yet and will probably OVERLAP 251 AC-8/AC-9 and ledger AC-12/AC-13 when 257 launches.
- AC-4 asserts FAILED_PRECONDITION and AC-6 asserts UNAVAILABLE; neither contradicts the quote-unavailable UNAVAILABLE rule in services/xstockstrat-portfolio/acceptance/fix-book-portfolio-page.feature.

### Coverage check
Source scenarios: 22. Planned: 21 NEW + 0 DUP + 1 OVERLAP = 22.
```

## Session 2026-10-30 — Staging checks (PG-1 not run)

- **Deployed:** staging deployment `b306cd82` (main-dev `484896de`) carries 251, 257 and 256 together, so the 257-before-251
  rollout ordering holds. Trading, portfolio and ledger run logs show no ERROR lines after the rollout.
- **Reads healthy:** `get_positions` and offline `list_positions` return valuations as before.
- **PG-1 not run, still blocks promotion:** it needs read-only SQL against the ledger (per-type counts, `EXPLAIN ANALYZE`,
  side-less fill stream keys), a `GetPnL` call and a malformed-token call on the real gRPC path. This session has no database
  access (egress to `:25060` is blocked) and the staging agent exposes no `GetPnL` or `QueryEvents` tool. The operator runs it.

## Session 2026-10-31 (CI: feature status automation)

- Promotion PR #1387 merged to main
- Feature promoted and committed: 0cfaa489cfafbf3f899e01cfeb42f4d6bbadf384
- Status updated: `code-completed` → `launched`
- Launched date: 2026-10-31
