# Context: quote-fanout-batching

**Feature**: `docs/roadmap/features/178-quote-fanout-batching/feature.md`
**Product Spec**: `docs/roadmap/features/178-quote-fanout-batching/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/178-quote-fanout-batching/implementation-spec.md`

---

## Session 2026-09-04 — sdd-story

- Created from performance-audit Track C (`docs/reports/2026-09-04-performance-bottlenecks-audit.md`,
  findings 3.4, 2.5, 3.7).
- Lower-risk than 176/177: adopts an existing batch RPC (`GetLatestQuotesMulti`) and rewrites two
  query/loop shapes; no new proto, no new schema (unless the batch-RPC-field contingency fires).
- Known trap folded into Open Questions: the null-not-zero discipline (2026-08-16 defects) — a
  batched partial result must map an absent symbol to the same missing outcome the serial path
  produced, never a silent zero price/P&L.
- Independent of 176/177 and can be sequenced in parallel; grouped separately to keep the Go portfolio
  /marketdata diff distinct from the Python analysis work.

## Session 2026-09-04 — sdd-review product-spec

- FIRST PASS: FAIL. Blocker: spec claimed marketdata "already exposes a batch GetLatestQuotesMulti" — false. Verified: marketdata.proto exposes only singular GetLatestQuote (:23); GetLatestQuotesMulti is an internal Go MultiSymbolSource helper (internal/source/source.go:26, internal/alpaca/client.go), used by the warm poller, NOT a gRPC RPC.
- FIX: reworked to require a NEW additive GetLatestQuotes batch RPC on marketdata (wraps the internal helper). Updated Problem Statement, FR-1, Out of Scope, Proto Contract Changes (additive gate: buf lint + buf-gen + Proto Reviewer + marketdata owner), approval gates, acceptance AC-1 naming, feature.md summary/reviewers. Also corrected the source audit report's false claim (finding 3.4, priority list, Track C).
- RE-REVIEW: PASS WITH WARNINGS. Status: draft → spec-ready.
- Warnings (advisory, to close in /sdd-design): exact GetLatestQuotes field set/message shape vs GetLatestQuote; single-flight keying consistency with the stale-refetch rate-limiter.
- Overlap: soft/rebase with feature 172 (fix-portfolio-max-drawdown-unenforced) on portfolio_service.go — different functions; not FAIL-class, no migration/proto/config clash. Flag at /sdd-spec so 178's read-path edits reconcile against 172's landed enforcement code. No merge-order entry required.

## Session 2026-09-05 — sdd-design quick, ROUND 1 (PAUSED, not approved)

Status unchanged: **spec-ready** (user chose "Hold, run another round"). recon.md written + committed. design.md NOT yet written.

- **Proposer (r1):** additive GetLatestQuotes RPC mirroring GetFundamentalsMulti (`repeated Quote`, self-keyed, absent=omitted → null-not-zero); cache-first batched service method wrapping alpaca.GetLatestQuotesMulti for cold misses; single-flight on the singular cold fallback; portfolio switches enrichPositions + 3 inline loops; ANY-array watchlist bindings; 172-before-178 landing order.
- **Adversary (r1): NEEDS WORK, no Floor breach.** Affirmed: cache-first is CORRECT (singular GetLatestQuote is already cache-first, marketdata_service.go:406-427); `repeated Quote` correct; no C-04 enum issue. Fixes to fold into round 2:
  1. **enrichPositions symbol set = CurrentPrice==0 positions ONLY:** it skips broker-valued positions BEFORE fetching (portfolio_service.go:326); a naive all-symbols batch overwrites broker-authoritative mark-to-market with mid-quotes → breaks @AC-12/157 (short MtM), @AC-7 (ListPositions↔ListPortfolios parity). The 3 inline loops (GetPnL:523, broadcastSnapshot:693, checkRiskLimits:732) fetch unconditionally (full set). Per-site symbol list is NOT uniform.
  2. **C-10(b) parity (fails.md:38-41, PR#735):** switch all 4 sites, keep the (Ask+Bid)/2 formula byte-identical, add a cross-path parity test.
  3. **Single-flight must cover the BATCH cold path (FR-3):** proposer scoped it to the singular fallback only → two concurrent batch calls with overlapping cold symbols stampede. FIX: key singleflight on the sorted cold-symbol set for the batch call (or fan cold symbols through per-symbol group), or explicitly state the batch is unguarded + why.
  4. **DB N+1 survives:** batch method does repo.GetLatestQuote per symbol → N DB reads replace N gRPC calls. FIX: batched repo read `WHERE symbol = ANY($1)` for cache hits, or state as deliberate scope cut.
  5. **172 collision consumer mislocated:** the quote loop feeds the CONCENTRATION check (posValues/totalValue, :729-748), NOT 172's drawdown block (:750, reads account_balances). Accidentally conflict-free BUT the batch must rebuild posValues/totalValue identically. Expect a same-function merge conflict — manual rebase, 172-before-178, register in merge-order.md.
  6. ANY-array: `ORDER BY watchlist_id, symbol` (preserve per-list order + strategy_id/source, @AC-1/2/167); pass only the paginated page's IDs (loop currently includes +1 lookahead); ListByUser is x-user-id scoped, disjoint from ListAllWatchlistSymbols (@AC-2/154) — confirm untouched.
  7. Assert whole-call error equivalence (a batch transport error drops the cold set; N singular calls would also all fail — assert, don't assume). Author a portfolio-side MarketDataServiceClient stub (none exists). marketdata quote @AC-* are net-new (author).
- **NEXT (round 2):** re-propose with per-site symbol sets (CurrentPrice==0 vs full), all-4-sites parity test, batch-covering single-flight (set-key), batched repo read (or documented cut), corrected 172/concentration reconciliation. Then re-adversary, then user gate.

## Session 2026-09-05 — sdd-design ROUND 2 (complete); round 3 pending

Status unchanged: **spec-ready** (user chose "Hold, run another round" → round 3). design.md NOT yet written.

- **Round-2 proposer:** additive GetLatestQuotes RPC (repeated Quote, self-keyed); one batched cache-first service method (batched repo read ANY + one alpaca.GetLatestQuotesMulti(misses) under set-keyed singleflight); per-site symbol sets (enrichPositions=CurrentPrice==0 only; 3 inline loops=full); all-4-sites (Ask+Bid)/2 byte-identical (:334/525/695/734); checkRiskLimits feeds CONCENTRATION not drawdown; ANY-array bindings ORDER BY watchlist_id,symbol over paginated IDs; 172-before-178 merge-order; cross-path parity test; portfolio marketdata stub authored.
- **Round-2 adversary: NEEDS WORK, no Floor breach.** Round-1 fixes CONFIRMED sound (CurrentPrice==0 set, checkRiskLimits rebuild, InsertQuote parity, additive proto, 172 merge-order sufficient). Fold into round 3:
  1. **Batched repo read is a NEW method with non-trivial latest-per-symbol semantics** — NOT a mirror of the singular `GetLatestQuote` (marketdata_repo.go:278, `WHERE symbol=$1 ORDER BY time DESC LIMIT 1`). A naive `WHERE symbol=ANY ORDER BY time DESC` returns ALL history; a LIMIT truncates symbols. FIX: design.md must state `DISTINCT ON (symbol) ... ORDER BY symbol, time DESC` (or window fn) and name it as new repo surface (C-01).
  2. **Partial-upstream-failure divergence:** batch funnels the cold set through ONE GetLatestQuotesMulti — a transport error drops the ENTIRE cold set, whereas N singular calls drop only the individually-failed symbol. In checkRiskLimits this changes posValues/totalValue → concentration ratio → whether emitRiskAlert fires (also broadcastSnapshot equity, GetPnL unrealized). Low-impact (degenerate path, tiny cold sets behind warm poller) but real+unasserted. FIX: add a partial-failure parity case OR explicitly WAIVE in design.md with the warm-cache/bounded rationale.
  3. **Set-keyed singleflight is a scope cut:** satisfies @AC-3 (single-symbol "5 requests for ZZZZ"), but FR-3's general "N misses→one fetch" only partially met (overlapping-but-unequal cold sets both hit Alpaca). Record the cut + warm-poller justification in design.md; name per-symbol fan-in as the rejected alternative.
- **NEXT (round 3):** re-propose with the DISTINCT ON repo query spelled out, a partial-failure decision (test-or-waive), and the singleflight scope cut recorded. Then re-adversary, then user gate. (No user fork outstanding for 178.)

## Session 2026-09-05 — sdd-design ROUND 3 (proposer + adversary complete): SOUND; final gate pending

Status unchanged: **spec-ready**. design.md NOT yet written (awaiting consolidated final gate).

- **Round-3 proposer:** DISTINCT ON (symbol) ... ORDER BY symbol, time DESC as new MarketDataRepo.GetLatestQuotesBatch; cache-first batched service method (batched repo read + one alpaca.GetLatestQuotesMulti(cold) under set-keyed singleflight + InsertQuote each cold); partial-upstream-failure WAIVED (assert happy-path parity + null-not-zero instead); singleflight scope cut recorded (per-symbol fan-in = rejected alt); per-site symbol sets; ANY-array bindings.
- **Round-3 adversary: SOUND, no Floor breach.** All round-2 objections RESOLVED. Key facts:
  - The `(symbol, time DESC)` index ALREADY EXISTS: idx_quotes_symbol_time, migration 001_marketdata_hypertables.up.sql:56 → DISTINCT ON is index-shaped, NO cache-hit regression, and **NO new migration needed** (design.md must state "index already exists (001:56), no migration"; marketdata's last migration is 004, so any new one would be 005 not 022 — moot).
  - REQUIRED doc fix: restate the partial-failure waive rationale in AGGREGATE terms — a cold-batch Alpaca error drops the whole cold set, changing WHICH symbols contribute to concentration/equity (a different denominator observably changes the ratio + whether emitRiskAlert fires), NOT per-symbol terms. Waive is acceptable (degenerate path, warm poller keeps cold sets tiny, no @AC exercises a live fault) but must be documented honestly (fails.md:38). Optional: a documented divergence test.
  - Minor: note GetLatestQuotes-vs-Multi naming as a deliberate choice; keep N cold InsertQuote as INDEPENDENT ON CONFLICT execs (not one wrapping txn) to match singular parity; /sdd-spec should EXPLAIN-verify index use.
- **NET:** SOUND. Ready to write design.md (no new migration; aggregate-honest waive wording; index-already-exists note). No user fork.

## Session 2026-09-05 — sdd-design COMPLETE (design-approved)

- Phase 0 Recon: recon.md written (portfolio + marketdata; key reuse: GetFundamentalsMulti batch precedent, alpaca.GetLatestQuotesMulti, cache-first singular path).
- Phase 1 Grilling: 3 rounds (quick, extended). Chosen approach: additive GetLatestQuotes RPC (repeated Quote, self-keyed, absent=omitted); new GetLatestQuotesBatch repo method using DISTINCT ON (symbol) over the EXISTING idx_quotes_symbol_time (migration 001:56 — NO new migration); cache-first batched service method + set-keyed singleflight; per-site symbol sets (enrichPositions=CurrentPrice==0 only; 3 inline loops=full); ANY-array watchlist bindings over paginated IDs. Rejected: map<string,Quote>, naive ANY+LIMIT, pure-live wrap, per-symbol fan-in, N per-symbol repo reads.
- Constitution rules touched: C-09 (additive proto gate), C-04 (n/a), C-01 (new repo method), C-10(b) parity, C-16 (net-new marketdata @AC). Floor breaches: none.
- Business rules: PRESERVE @AC-7/12/157, @AC-1/2/167, @AC-1/154; net-new marketdata quote @AC authored here.
- Partial-upstream-failure divergence WAIVED (aggregate-honest wording; degenerate path behind warm poller; asserts happy-path parity + null-not-zero, no partial-failure test).
- USER APPROVED design 2026-09-05. Status: spec-ready → design-approved.
- merge-order.md: 172-before-178 row added (same-function checkRiskLimits overlap; 178 keeps 172's drawdown block verbatim, batches only the quote loop).
- Next: /sdd-spec quote-fanout-batching. Open risks carried: EXPLAIN-verify DISTINCT ON uses the index; author portfolio-side MarketDataServiceClient stub.

## Session 2026-09-05 — sdd-spec

- Generated implementation-spec.md with 8 steps. Status → implementation-ready.
- Key codebase findings (verified this session, not just from recon):
  - **Feature 172 has already landed on the branch base.** `checkRiskLimits` now carries 172's
    `evaluateDrawdowns`/`GetAccountDrawdowns` drawdown block (`portfolio_service.go:768-773`) after the
    quote loop; portfolio's last migration is now **016** (`016_account_balance_peak_equity`), not 015
    as recon read. The recon-flagged "same-function merge conflict" is therefore **moot** — Step 5
    batches only the quote loop and keeps 172's block verbatim; no reconcile needed. Inline-loop lines
    shifted: `GetPnL:523`, `broadcastSnapshot:693`, `checkRiskLimits:750` (recon had :523/:693/:732).
  - Index `idx_quotes_symbol_time ON marketdata.quotes (symbol, time DESC)` confirmed at
    `migrations/001_marketdata_hypertables.up.sql:56` → `DISTINCT ON (symbol) ... ORDER BY symbol, time
    DESC` rides it; **no new migration** (marketdata last migration = 004). EXPLAIN-verify deferred to
    execute/CI against the managed DB (offline spec cannot run it; index existence is the standing proof).
  - Proto batch precedent `GetFundamentalsMulti` confirmed (`marketdata.proto:44,221-227`); handler
    `:183`, gRPC adapter `:318`, adapter struct `:209`, auto-registration via
    `RegisterMarketDataServiceServer(...GRPCHandler())` `cmd/server/main.go:152`. `Quote` message
    (`:63-71`) reused as the `repeated Quote` element (self-keyed on `symbol`).
  - Portfolio→marketdata client already header-propagating: `mdConn` dialed with
    `grpc.WithChainUnaryInterceptor(middleware.UnaryClientInterceptor)` (`portfolio_service.go:113`) —
    the new `GetLatestQuotes` call on `s.marketdata` needs **no** new propagation wiring.
  - `golang.org/x/sync v0.20.0` is present **indirect** (`go.mod:36`); importing `singleflight`
    promotes it to direct via `go mod tidy` (no new download).
  - **Testability seam:** marketdata `s.repo` and portfolio `s.marketdata` quote paths use a concrete
    `*MarketDataRepo` (no interface) — repo-layer `DISTINCT ON`/`ANY` reads need a DB (integration),
    while the single-flight coalescing, partial-map merge, and portfolio batch-vs-serial parity are the
    unit-testable seams. No portfolio-side `MarketDataServiceClient` stub exists — Steps 6 authors one.
  - Coverage: all new logic lands in Go packages **excluded** from the `-coverpkg` set
    (`service/`,`handler/`,`repository/`) — no coverage threshold applies; red-green behavioral tests
    are the gate (noted in each test step).
- Scenario coverage (C-15): AC-1→Step6, AC-2→Step8, AC-3→Step4, AC-4→Step4+Step6. All covered.
- Consumer surface (C-14): internal/platform-only per product spec — no UI/agent step (restated in
  Execution Summary).

## Session 2026-09-05 — sdd-review impl-spec (advisory)

- Result: 0 blockers, 0 substantive warnings, 6 advisory NOTEs (8/8 steps grounded, no Floor risk).
  Verdict PASS. Proto change verified additive (buf-breaking-safe); header trio propagates via the
  already-wired `middleware.UnaryClientInterceptor` on `mdConn`; feature-172 `checkRiskLimits`
  drawdown block confirmed present and kept verbatim; Step 7 correctly grep-gates the `listBindings`
  removal against its second caller (`watchlist_repo.go:94`) — no F-04-adjacent erroneous deletion.
- Overlap findings: CLEAN — only the known 172→178 same-function WARN on `portfolio_service.go`
  `checkRiskLimits` (already `merge-order.md:227-236`; 172 merged, block preserved verbatim). Proto
  message/field numbers, migrations (none), and config (none) all clear vs siblings 176/177/179.
- Advisory NOTEs carried into execution (none blocking):
  - Step 2 (B2): `Files` uses `gen/**` directory globs — [x] accepted (inherent to codegen; empty-diff gate is the real check).
  - Steps 4/6/8 (C-08): no explicit coverage threshold — [x] accepted (Go service/handler/repository are coverage-excluded; red-green behavioral tests are the gate).
  - Step 5 (C-01): `checkRiskLimits`/drawdown line citations off by one (`:749-757`/`:768-774` actual) — [ ] re-anchor at execute discovery.
  - Step 6 (C-01): cites `portfolio_risk_test.go:126` as a ctor site; it is an assertion line — [ ] re-anchor at execute (the "no MarketDataServiceClient stub today" claim holds via grep).

## Session 2026-09-05 — sdd-execute sequential (Steps 1–2)
- Branch-sync: merged origin/main-dev into feature/quote-fanout-batching (clean — 176 landed; no
  conflict with 178's Go/proto work). 177 not yet merged (independent).
- Step 1 (proto): added `rpc GetLatestQuotes(GetLatestQuotesRequest) returns (GetLatestQuotesResponse)`
  after GetFundamentalsMulti (marketdata.proto:44) + the two messages after :227, mirroring the
  GetFundamentalsMulti batch precedent (`repeated Quote quotes = 1`, self-keyed → null-not-zero). No
  map<string,Quote>. TDD N/A.
- Step 2 (proto-gen): regenerated via Docker (`localenv-setup.sh`); diff limited to marketdata/v1
  (Go pb/grpc/connect, Python, TS+dist); buf lint + breaking green. Deviation logged (CI-equivalent).
- Verify: gen diff marketdata-only; new GetLatestQuotes symbols present in gen/go. Docker codegen
  fallback (buf not on host) — same as 176/177.

## Session 2026-09-05 — sdd-execute sequential (Steps 3–4)
- Step 3 (marketdata service): new `MarketDataRepo.GetLatestQuotesBatch` (DISTINCT ON (symbol) over
  the existing idx_quotes_symbol_time, no migration); `MarketDataService.GetLatestQuotes` (cache-first
  batched: repo warm read → cold set → one `alpaca.GetLatestQuotesMulti` under `quoteSingleflight`
  keyed on the sorted cold set → per-quote InsertQuote leader-only → merge; absent symbol omitted).
  Handler + gRPC adapter mirror GetFundamentalsMulti. `go mod tidy` promoted x/sync to direct.
  `s.repo`-nil-guarded for the no-DB unit-test seam (deviation logged).
- Step 4 (test): `fakeMultiSource` (DataSourceClient + MultiSymbolSource); AC-3 (5 concurrent cold
  calls → exactly 1 upstream fetch, barrier via started/release channels) + AC-4 (NOQUOTE omitted,
  null-not-zero) in the service test; a new `internal/handler/marketdata_handler_test.go` asserts the
  handler rejects empty Symbols with CodeInvalidArgument (deviation: file beyond declared Files).
  RED pre-Step-3 (GetLatestQuotes undefined / handler unimplemented) → GREEN after.
- Verify: `go test ./internal/... -race` all green; go vet + gofmt clean. golangci-lint v2.5.0 can't
  target go1.27 → fell back to build+vet+gofmt (CI runs pinned v2.13.1). Deviations logged.

## Session 2026-09-05 — sdd-execute sequential (Steps 5–6)
- Step 5 (portfolio service): new `latestQuotesFor(ctx, symbols)` helper (one GetLatestQuotes call,
  re-keyed by symbol; RPC error → empty map → all-missing neutral outcome). Switched all four sites —
  enrichPositions (CurrentPrice==0 subset only, preserving the broker-valued skip), GetPnL,
  broadcastSnapshot, checkRiskLimits (rebuilds posValues/totalValue) — to collect-then-batch-then-
  lookup. `(quote.AskPrice + quote.BidPrice) / 2` kept byte-identical at all 4 sites (grep: 4/4);
  0 singular GetLatestQuote calls remain. checkRiskLimits concentration check + 172's drawdown block
  left verbatim.
- Step 6 (test): `internal/service/portfolio_service_test.go` — `stubMarketData` (embeds the
  MarketDataServiceClient interface; overrides only the two quote methods with counters). AC-1 (30
  positions → 1 batched call, 0 singular, each CurrentPrice == reference mid — PR#735 formula parity),
  AC-4 (NOQUOTE omitted → left neutral 0), whole-call-error equivalence (all unenriched). RED
  pre-Step-5 (singular path → getLatestQuotesCalls==0) → GREEN after.
  - Test-scope note: the mid-formula parity is asserted via enrichPositions (directly callable) + the
    static grep (4/4 identical sites); checkRiskLimits is not unit-driven (needs cfg/repo/notify
    stubs) — coverage-excluded package, red-green behavioral gate, formula guarded by the shared
    byte-identical expression.
- Verify: `go test ./internal/... -race` green; vet + gofmt clean. golangci-lint deferred to CI
  (v2.5.0-vs-go1.27, per the Steps 3–4 deviation).
