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
