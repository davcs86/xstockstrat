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
