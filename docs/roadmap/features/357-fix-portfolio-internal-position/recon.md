# Recon: fix-portfolio-internal-position

**Created**: 2026-11-17
**From**: product-spec.md
**Tree**: feature/fix-portfolio-internal-position@2808b02f ≡ origin/feature/fix-portfolio-internal-position (branched from `ccr-pagination-followups-353`; the discovery digests were UNSTAMPED, so every line below was re-grepped at this ref)
**Affected services**: xstockstrat-portfolio

---

## Objective

Four internal readers in portfolio (`GetPortfolio`, `GetPnL`, `broadcastSnapshot`, `checkRiskLimits`) each
call `repo.ListPositions(..., 500, "", ...)` once and discard `next_page_token`. A user with more than 500
positions therefore gets totals, P&L, snapshots and concentration checks computed over a partial set, with
no error or log. The fix drains the feature-353 composite cursor to the end for each reader, and makes a
page-read failure visible: the RPCs return an error, and the background readers skip and log. Quote
enrichment stays batched (`@AC-1 @feature-178`).

## Codebase Map

- **`xstockstrat-portfolio`** (Go)
  - Service struct: concrete repo field `repo *repository.PortfolioRepo` — `internal/service/portfolio_service.go:43` (no repo interface exists)
  - Truncation site 1, `GetPortfolio` (`:784`): `s.repo.ListPositions(ctx, userID, req.TradingMode, 500, "", req.GetAccountId(), "", POSITION_SIDE_UNSPECIFIED)` — `portfolio_service.go:787`. On error it returns `nil, err` (`:788-790`). The full slice then feeds `valueRead` → `markDegradedPositions` → `enrichRisk` (`:825-827`). When no `account_id` is set, the account scope list is built from `positions` (`:813-815`), so a truncated slice also truncates the offline-candidate scope.
  - Truncation site 2, `GetPnL` (`:930`): `portfolio_service.go:932`, no account filter. Quotes come from one `latestQuotesFor(ctx, unvaluedSymbols(positions))` at `:937`. `!ok` returns `ErrQuotesUnavailable` (`:938-940`, sentinel `:919`).
  - Truncation site 3, `broadcastSnapshot` (`:1213`): `portfolio_service.go:1214`. On a page error it does a **bare `return` with no log** (`:1215-1217`). Quotes are fetched at `:1218`. The unpriced-skip guard at `:1222-1225` logs a WARN "portfolio snapshot skipped: positions unpriced" and calls `telemetry.RecordSnapshot(ctx, "skipped_unpriced")`. `InsertSnapshot(..., len(positions), mode)` is at `:1238`.
  - Truncation site 4, `checkRiskLimits` (`:1279`): `portfolio_service.go:1283`. On a page error it does a **bare `return` with no log** (`:1284-1286`). That return happens *before* the drawdown check at `:1312` (`GetAccountDrawdowns`), so today a page error also suppresses drawdown alerts (see Risks). Concentration config is read at `:1281`: `s.cfg.GetFloat("risk.concentration_limit_pct", 0.20)`. Quotes are fetched at `:1289`, the unpriced-skip is at `:1292-1299`, and the concentration loop is at `:1302-1310`.
  - Public single-page RPC `ListPositions`: `portfolio_service.go:894`, repo call at `:904`. Out of scope and unchanged.
  - Quote batching: `latestQuotesFor` (`portfolio_service.go:506`) issues exactly one `GetLatestQuotes` per invocation (`:513`). `valueRead` (`internal/service/offline_valuation.go:94`) reaches it once per call, either directly (`:113`, no offline ids) or through `fetchMarks` (`:163`). `enrichRisk` (`portfolio_service.go:683`) makes no marketdata call; it applies config-derived factor and stop fields only.
  - Repo `ListPositions`: `internal/repository/portfolio_repo.go:136`. A `pageSize` that is ≤0 or >500 is coerced (`:137`). The keyset cursor is bound as one `$n::text[]` slot (`:166-167`) and the query fetches `pageSize+1` rows (`:168`) ordered by `symbol, trading_mode, account_id` (`:177`). Errors are wrapped as "list positions: …" (`:142`, `:181`). The cursor codec is `encodePositionCursor` (`:208`) / `decodePositionCursor` (`:215`).
  - pgxmock seam: `NewPortfolioRepoWithDB(db queryRower)` — `portfolio_repo.go:50`
  - Last migration: `018_watchlist_signal_expiry.up.sql` (`services/xstockstrat-portfolio/migrations/`). Not needed here.
  - Config-read pattern: `s.cfg.GetFloat("risk.concentration_limit_pct", 0.20)` — `portfolio_service.go:1281` (read only)
  - Telemetry: `telemetry.RecordSnapshot(ctx, outcome)` — `internal/telemetry/otel.go:347`
  - Consumer surface (C-14, confirmed): `xstockstrat-ui/src/hooks/usePortfolio.ts:12` (`portfolioClient.getPortfolio`) and `xstockstrat-ui/src/lib/traderBff.ts:79` (`getPortfolio: forward(...)`). No UI change.

## Patterns to REUSE

- Fail-closed page drain with guards → reuse the GetPnL ledger fill loop, `portfolio_service.go:1118-1166`. It wraps a page error with a sentinel (`ErrLedgerUnavailable`, `:926`), refuses an empty page that carries a next token (`:1125-1127`), and refuses a repeated page token (`:1164-1165`). The position drain needs the same three guards, keyed on the position cursor.
- Cursor → reuse the repo `ListPositions` keyset cursor and codec unchanged (`portfolio_repo.go:166-167`, `:208`, `:215`). The drain passes `nextToken` back as `pageToken`. No new SQL and no new args.
- Same-slot typed bind (ledger) → `origin/main-dev:docs/roadmap/ledger/insights.md:4626-4628`: bind one typed array in the same slot so every pgxmock pin keeps its arg count. Any new pgxmock expectation for page 2 must match the existing `FROM portfolio.positions` arg shape, and any new typed bind needs an Exec-mode dbtest. This fix should add no new bind. (This insight is on `main-dev` but not yet in this branch's ledger copy.)
- Real-DB 501-row seeding → reuse `seedPosition(t, pool, userID, symbol, mode, accountID string, qty float64)` (`internal/repository/dbtest_helpers_test.go:66`) and `testPool(t, opts ...func(*pgxpool.Config))` (`:22`, exec-mode opts) under the `dbtest` tag. The traversal oracle precedent is `TestListPositions_TraversalYieldsEveryRowOnce` (`list_positions_dbtest_test.go:62`) and `TestListPositions_CursorMatchesOracleOrder` (`:105`).
- Service tests with a mocked repo → reuse the pgxmock service harness `newScopedSnapshotSvc(t) (*PortfolioService, pgxmock.PgxPoolIface, *fakeLedger)` (`internal/service/portfolio_snapshot_scope_test.go:15`), `anyArgs(n)` (`portfolio_fill_errors_test.go:36`) and `ctxWithUser(t, ...)` (`watchlist_service_test.go:334`). A page-2 failure is a second `ExpectQuery(...).WillReturnError(...)`.
- Quote-call counting (AC-4) → reuse `stubMarketData`, which has `getLatestQuotesCalls` / `getLatestQuoteCalls` counters (`internal/service/portfolio_service_test.go:19`, `:84`), as in `TestEnrichPositions_OneBatchedCall` (`:106`).
- Background-reader skip + log → reuse the existing WARN + `telemetry.RecordSnapshot` skip idiom at `portfolio_service.go:1222-1225`. A new outcome label is a design choice; FR-5 only requires the log.

## Existing Business Rules (preserve / extend)

- **PRESERVE** `@AC-1 @FR-1 @FR-4 @feature-178` "Position enrichment uses one batched quote call" (`services/xstockstrat-portfolio/acceptance/quote-fanout-batching.feature:13`): no per-position `GetLatestQuote`, and at most one batch per page of up to 500 positions (FR-6, `@AC-4`). Its subject is the public `ListPositions` enrichment, which this fix does not touch.
- **PRESERVE** `@AC-4 @FR-4 @feature-178 @feature-240` "A symbol with no quote maps to the last close (offline) or the same missing outcome (broker) under batching" (`quote-fanout-batching.feature:30`): per-symbol quote-miss mapping is unchanged.
- **PRESERVE** `@AC-1 @regression @feature-353` "Paginated ListPositions yields every position exactly once" (`services/xstockstrat-portfolio/acceptance/fix-listpositions-nextpagetoken-skips.feature:5`): the drain follows this cursor without changing it, skipping a row or reading a row twice.
- **PRESERVE** `@AC-2 @FR-4 @regression @feature-231` "The persisted equity snapshot values broker positions first and marks the rest" (`services/xstockstrat-portfolio/acceptance/fix-after-hours-positions-priced.feature`): `broadcastSnapshot` valuation order.
- **PRESERVE** `@AC-3 @FR-5 @regression @feature-231` "Concentration sums a symbol across accounts and alerts on the true weights" (`fix-after-hours-positions-priced.feature:35`): concentration is computed over the whole drained set, never per page.
- **PRESERVE** `@AC-8 @FR-4 @feature-231` "Any unpriced position skips the equity snapshot and names the symbol" (`fix-after-hours-positions-priced.feature:56`): an unpriced position on any page still skips the snapshot.
- **PRESERVE** `@AC-9 @FR-5 @feature-231` "Any unpriced position skips concentration but drawdown still alerts" (`fix-after-hours-positions-priced.feature:64`): an unpriced position on any page skips concentration only, and drawdown still alerts.
- **PRESERVE** `@AC-1 @FR-1 @FR-3 @regression @feature-231`, `@AC-13 @FR-3 @feature-231`, `@AC-14 @FR-3 @feature-231 @feature-240`, `@AC-6 @FR-3 @FR-7 @feature-231 @feature-240` (`fix-after-hours-positions-priced.feature`): pricing semantics and read-path parity. The divergence between `ListPositions` and `GetPnL` pricing is intentional. Only `GetPortfolio` goes through `valueRead`; `GetPnL`, `broadcastSnapshot` and `checkRiskLimits` never use it (`services/xstockstrat-portfolio/CLAUDE.md:29`).
- **PRESERVE** `@AC-1 @regression @feature-229 @feature-240` "Portfolio reads return unenriched positions when the quote fetch exceeds its deadline and no daily close exists" (`services/xstockstrat-portfolio/acceptance/fix-book-portfolio-page.feature`): a quote timeout degrades the read, while a position-page read error (FR-5) returns an error. These are two distinct failure classes.
- **PRESERVE** `@AC-5 @regression @feature-229` "GetPnL refuses to report unrealized P&L when a needed quote is unavailable" and `@AC-6 @regression @feature-229` "GetPnL values broker-synced positions from the broker price without a quote fetch" (`fix-book-portfolio-page.feature`)
- **PRESERVE** `@AC-6 @FR-5 @regression @feature-251` "A ledger read failure mid-drain returns UNAVAILABLE, never a partial realized figure", `@AC-9 @FR-5 @regression @feature-251` "More than one page of fills folds every fill exactly once", `@AC-4 @FR-2 @regression @feature-251` "A caller's fill whose side cannot be resolved refuses GetPnL instead of fabricating a figure" (`services/xstockstrat-portfolio/acceptance/fix-getpnl-source-service.feature`): the ledger-side fail-closed drain. This fix is its position-side analogue and must not disturb it.
- **PRESERVE** `@AC-18 @FR-4 @FR-3 @regression @feature-251` "A LIVE fill is excluded from paper GetPnL and from the paper fill lineage" (`fix-getpnl-source-service.feature`): the drain keeps the trading-mode filter.
- **PRESERVE** `@AC-39 @FR-9 @FR-8 @feature-240` "GetPortfolio carries broker and offline P&L and aggregates them", `@AC-29 @FR-9 @feature-240` "Every portfolio read returns the same offline P&L for the same state", `@AC-52 @FR-9 @feature-240` "GetPortfolio reveals nothing for an account the caller has no rows in" (`offline-account-full-pnl.feature:256`), `@AC-28 @FR-8 @feature-240` "GetPnL keeps refusing an offline holding without a live quote" (`services/xstockstrat-portfolio/acceptance/offline-account-full-pnl.feature`)
- **PRESERVE** `@AC-3 @FR-4 @regression @feature-256` "Offline P&L is never reported as complete when offline state cannot be read" (`services/xstockstrat-portfolio/acceptance/fix-offline-book-consistency.feature`): the never-report-partial principle that FR-5 extends.
- **PRESERVE** `@AC-3 @FR-3 @regression @feature-242` "A portfolio risk breach alert is targeted at the account owner" (`services/xstockstrat-portfolio/acceptance/fix-push-untargeted-broadcast.feature`)
- **PRESERVE** `@AC-12 @FR-7 @feature-163` "Provenance is consistent across every portfolio read path" (`services/xstockstrat-portfolio/acceptance/snapshot-offline-positions.feature`): provenance survives page concatenation.
- **EXTEND** `@AC-1 @FR-1 @FR-4 @feature-178` "Position enrichment uses one batched quote call": new `@AC-4` adds "at most 2 batch calls for 501 positions" on `GetPortfolio`.
- **EXTEND** `@AC-52 @FR-9 @feature-240` "GetPortfolio reveals nothing for an account the caller has no rows in": new `@AC-3` adds account-scoped coverage past 500 rows.
- No CHANGE flags. `docs/sdd/business-rules/platform.feature` has no scenario on portfolio position reads.

## Dependencies

- Proto/RPC: none (no message or field change; `GetPortfolio`/`GetPnL` signatures unchanged)
- Migration: none (next would be `019` in `services/xstockstrat-portfolio/migrations/`; not anticipated)
- Config keys: none new. `risk.concentration_limit_pct` (default 0.20) and `risk.max_drawdown_pct` (0.10) are read only (`portfolio_service.go:1280-1281`).
- Inter-service edges: none new. Existing portfolio → marketdata (`GetLatestQuotes`, `BatchGetBars`) and portfolio → notify (`EmitAlert`) are unchanged.
- New env vars / ports: none
- Merge order: depends on feature 353 (`fix-listpositions-nextpagetoken-skips`) cursor being on `main-dev`. 357 must not merge before 353 (context.md, sdd-review session).

## Risks / Not-found

- **Design fork (open question): drain location.** The options are a repo-level `ListAllPositions` drain helper or a service-level page loop shared by the four readers. Both are viable: there is no repo interface (`portfolio_service.go:43`), and pgxmock covers either. No existing drain helper for `ListPositions` was found.
- **Design fork: drain-then-enrich vs enrich-per-page.** Draining first and then calling `latestQuotesFor`/`valueRead` once yields one `GetLatestQuotes` call of 501 symbols. That satisfies `@AC-4` (≤2) and FR-6 (≤1 batch per page). Enriching per page would break `@AC-3 @feature-231` (concentration must sum across the whole set) and the all-or-nothing unpriced skip (`@AC-8`/`@AC-9`) unless results are re-aggregated. **Not found:** no explicit per-request symbol cap in marketdata's `GetLatestQuotes` (`services/xstockstrat-marketdata/internal/service/marketdata_service.go:640`, head read only). The vendor-side batch size limit for a >500-symbol request was not verified.
- **Open question for design: `checkRiskLimits` page error vs drawdown.** Today the page-error `return` (`:1284-1286`) precedes the drawdown check (`:1312`), so drawdown alerts are also suppressed. FR-5/AC-5 require only "no concentration alert from the partial set". Whether drawdown should still run on a page error is unspecified. The `@AC-9 @feature-231` precedent (unpriced → skip concentration, drawdown still alerts) suggests it should, but drawdown uses `GetAccountDrawdowns`, not positions. Design must decide this and record it, not guess (P-03).
- **Failure-class separation.** A position-page error (FR-5) must return or skip, while a quote timeout must still degrade (`@AC-1 @feature-229`). The design must not route page errors through the quote-degradation path. AC-5 is advisory-open (sdd-review): it covers `broadcastSnapshot` and `checkRiskLimits` together. Design/spec may split it per reader.
- **Error mapping for RPC readers.** `GetPortfolio`/`GetPnL` currently return the raw repo error. Whether the drain wraps it in a sentinel (cf. `ErrLedgerUnavailable` → Unavailable) or passes it through is a design choice. Check the handler's error mapping before choosing.
- **Ledger trap** (`docs/roadmap/ledger/insights.md:179-189`, feature 071): adding pagination to a silently capped caller is itself a behavior change. Users with more than 500 positions will see different totals, P&L, snapshot `open_positions` and possibly *new* concentration alerts. State the delta in design; do not claim "no behavior change".
- **Ledger trap** (`insights.md:1025-1028`): a new failure path in an aggregation loop must widen the downstream gates. The `totalValue > 0` concentration gate (`:1303`) must not fire on a partial set.
- **Overlap** (rebase-only): `311-fix-position-fold-correctness` and `312-fix-read-path-owner-trust` touch disjoint regions of `portfolio_service.go`. Re-check at impl-spec time.
- **Not verified:** the full Then-steps of the feature-229/240 scenarios cited above (relevance rests on tags and titles). The `PORTFOLIO-*` invariants in `services/xstockstrat-portfolio/docs/context-constitution.md` were not read.

## Recommended Scope

Advisory only, and not binding.

1. **Test (red):** service tests with pgxmock and `stubMarketData`. Use 501 positions across two pages (page 1 has 500 rows plus a next token, page 2 has 1 row) for all four readers (AC-1). Add the account-scoped `GetPortfolio` case (AC-3), the page-2 `WillReturnError` case for `GetPortfolio`/`GetPnL` (AC-2), the background readers' no-snapshot/no-alert-plus-log case (AC-5) and a quote-call count ≤2 (AC-4). Optionally add a `dbtest` 501-row case reusing `seedPosition`. Prove the tests fail on the current code (P-06).
2. **Service (green):** add one position-drain helper (location decided in design) with fail-closed guards mirroring `:1118-1166`. Switch the four call sites to it, keeping per-site account and trading-mode args. Replace the bare `return`s at `:1215-1217` and `:1284-1286` with a logged skip. Enrichment stays one call over the drained set.
3. **Docs:** promote the AC scenarios into `services/xstockstrat-portfolio/acceptance/` at launch (C-16) and update the service CLAUDE.md only if a documented invariant changes.
