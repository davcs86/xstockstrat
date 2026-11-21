# Design: fix-portfolio-internal-position

**Created**: 2026-11-17
**Rounds**: 3 (full; termination: approved)
**Approved by**: operator @ 2026-11-17 (design gate r3: "approved as synthesized"; Floor clear)
**Grounded in**: recon.md
**Debate register**: debate.md
**Severity**: SEV-2

---

## Chosen Approach

The fix stays in the `xstockstrat-portfolio` service layer. It builds on settled decisions D-1..D-6, D-8..D-17 (D-7 was reopened by operator steer and amended as D-15). It does **not** touch `internal/repository/portfolio_repo.go`, the SQL, the cursor codec, the proto, or feature 353's `internal/repository/dbtest_helpers_test.go`. Features 351, 353 and 354 stay untouched.

**Consumer surface (C-14).** The change reaches the trader UI unchanged through `GetPortfolio` and `GetPnL`: `xstockstrat-ui/src/hooks/usePortfolio.ts:12` and `xstockstrat-ui/src/lib/traderBff.ts:79` (recon.md:34). It needs no UI, proto or BFF change. For users with more than 500 positions, the same RPCs now return totals computed over every position. `broadcastSnapshot` and `checkRiskLimits` are internal background readers whose outputs are snapshots, streams and alerts.

1. **Drain helper (D-1, D-3, D-6).** Add a private `listAllPositions(ctx, userID, mode, accountID)` in `services/xstockstrat-portfolio/internal/service/portfolio_service.go`, next to `collectFills` (:1111-1168).
   - It mirrors the existing fail-closed ledger fill drain (recon.md:38).
   - It loops over the repo `ListPositions` keyset page primitive (recon.md:29), passing `positionDrainPageSize`, the previous `nextToken`, `accountID`, `""` and `POSITION_SIDE_UNSPECIFIED`.
   - `const positionDrainPageSize = 500` carries a constraint comment: it must stay at or below the repo cap, because the repo turns any value above 500 into 100 (portfolio_repo.go:137-138, recon.md:29).
   - It fails closed in three cases: a page error (wrapped with `%w`), an empty page that still carries a token, and a token that repeats. There is no page cap and no repeated-row guard, because the keyset order is strictly increasing.

2. **Call sites (D-2).** Each of the four truncation sites (recon.md:23-26) drains every page first, then enriches once over the full set. There is still exactly one `GetLatestQuotes` batch per invocation (recon.md:28).
   - `GetPortfolio` (:787) passes `req.GetAccountId()`. With no account set, the offline-candidate account scope (:813-815) is now built from the full drained slice.
   - `GetPnL` (:932), `broadcastSnapshot` (:1214) and `checkRiskLimits` (:1283) pass `""`.

3. **Behaviour on a page error.** A position-page error is a separate failure class from a quote timeout, and it is never routed through the quote-degradation path (recon.md:82).
   - **`GetPortfolio` and `GetPnL`:** the wrapped error passes through and maps to Internal, as today (D-4, recon.md:83). The asymmetry with the ledger `Unavailable` mapping already exists and is deliberate.
   - **`broadcastSnapshot`** (bare return at :1215-1217, recon.md:25):
     - Logs WARN "portfolio snapshot skipped: position read failed" with `user_id` and `error`.
     - Calls `telemetry.RecordSnapshot(ctx, "skipped_read_error")` (recon.md:33, :44), then returns.
     - Nothing is inserted, emitted or broadcast.
     - The service `CLAUDE.md` Observability section is updated in the same PR (D-5).
   - **`checkRiskLimits`** (operator-approved O-2, D-16; bare return at :1284-1286, recon.md:26, :81):
     - Logs WARN "concentration check skipped: position read failed".
     - The quote fetch, `applyQuotes`, `observeQuotePass(...,"risk")` and summing (:1287-1300) move into the success branch only (D-12).
     - `positions`, `totalValue` and `posValues` are declared before the branch. On failure `totalValue` stays 0, so the `totalValue > 0` concentration gate (:1303) cannot fire on a partial set (recon.md:85).
     - Execution falls through to the drawdown block (:1312-1317), which is unchanged. This mirrors `@AC-9 @feature-231`.

4. **Red-before-green pgxmock tests (P-06, C-08).** New file `internal/service/portfolio_position_drain_test.go`, reusing the existing harness (recon.md:42-43).
   - **(a) Two pages.**
     - Page 1 returns 501 rows (the probe row), matched with `anyArgs`.
     - The page-2 expectation has the same arg count as page 1. Its `$n::text[]` slot is pinned to `[]string{rows[499].Symbol, "TRADING_MODE_PAPER", rows[499].AccountId}` (D-10). Every other slot is `pgxmock.AnyArg()`, never `anyArgs` (R-4). This follows the same-slot typed-bind ledger insight (recon.md:40).
     - The ListPositions expectation regex is anchored to a substring unique to the ListPositions SELECT (portfolio_repo.go:136-206), such as its keyset row-comparison clause, not the loose `FROM portfolio.positions`. This stops another positions query from using up the page-2 expectation under `MatchExpectationsInOrder(false)` (portfolio_quote_deadline_test.go:103). The spec names the exact substring.
   - **(b)** An account-scoped `GetPortfolio` case (AC-3).
   - **(c)** A page-2 `WillReturnError` case for `GetPortfolio` and `GetPnL` (AC-2).
   - **(d) Guard tests.** Repeated token: call `listAllPositions` directly. Empty page with a token: run `GetPnL` end to end.
   - **(e) AC-5.** Use `recordLogs` with `installMetricReader`, in non-parallel tests (D-11). Assert:
     - both WARN messages;
     - the `skipped_read_error` label;
     - no `InsertSnapshot`, no broadcast and no concentration alert;
     - `ExpectationsWereMet`.
   - **(f) AC-4.** Assert `getLatestQuotesCalls <= 1` and `getLatestQuoteCalls == 0` (D-14). This is stricter than the scenario's "at most 2".
   - **(g) O-2 red test.** Page 1 succeeds and page 2 errors, and `GetAccountDrawdowns` returns a row over `risk.max_drawdown_pct`. Assert exactly one drawdown alert, no concentration alert and no `risk` mark-source sample.

5. **501-row dbtest (D-15, operator ruling (a')).** New file `internal/service/position_drain_dbtest_test.go`, with `//go:build dbtest` and `package service`.
   - **Pool.** A local `serviceTestPool(t)`:
     - reads `PORTFOLIO_DB_TEST_URL`;
     - calls `t.Fatal` when `CI == "true"`, otherwise `t.Skip`;
     - sets `lock_timeout=500ms` via `pgxpool.ParseConfig`;
     - registers `t.Cleanup(pool.Close)`.
     - Its one-line constraint comment points at its twin in `internal/repository/dbtest_helpers_test.go:22-44`. The duplication is the recorded C-18 waiver (D-17).
   - **Repo.** `repository.NewPortfolioRepoWithDB(pool)` (recon.md:30). The spec confirms that `*pgxpool.Pool` satisfies `queryRower` and that the drained readers never call `repo.Pool()`. If either check fails, the fallback is `NewPortfolioRepo(url)` (R-10).
   - **Isolation.** The user prefix is unique to this service (for example `it-357-` plus `t.Name()`) and never starts with `it-281-`. Account ids are unique per test. Cleanup deletes by prefix only.
   - **Seeding.** 501 rows, plus a 3-row second account for AC-3, go through the exported `(*PortfolioRepo).UpsertPosition` (portfolio_repo.go:62). `seedPosition` is neither copied nor moved (R-7, R-8; recon.md:41).
   - **Service.** It sets the same fields as `newQuoteSvc` (portfolio_quote_deadline_test.go:105-110): `marketdata` (a `stubMarketData` that also answers `BatchGetBars`), `ledger` and `subs`.
   - **Assertions.** `GetPnL` and `GetPortfolio` count all 501 rows. AC-3 asserts position count and account ids, not equity, because it runs the offline-valuation path (portfolio_service.go:819-825, offline_valuation.go:112-147).
   - **CI.** Edit only the portfolio db-test step at `.github/workflows/ci.yml:1065` (working directory `services/xstockstrat-portfolio`, :1060) to `go test -tags dbtest -race -count=1 ./internal/repository/... ./internal/service/...`. `ci.yml:1116` is the marketdata step and is not touched (R-9).

6. **D-9 verification gate.** Run a dev smoke test of `GetPnL` and `GetPortfolio` with at least 501 symbols.
   - Pass condition: no `Unavailable`, and `portfolio.marketdata_fetch{op=quotes}` reports outcome ok.
   - If it fails, fall back to per-page enrichment plus re-aggregation, and relax the AC-4 test to `<= 2`.

7. **Accepted behaviour deltas** (disclosed; the "pagination is a behaviour change" ledger trap applies, recon.md:84):
   - For users with more than 500 positions, `GetPortfolio` totals, `GetPnL` unrealized P&L and the snapshot's `open_positions` and equity all change, and new concentration alerts may fire.
   - The N pages are read as separate statements outside a transaction, so concurrent writes can skew the result across pages. No transaction is added (D-8).
   - The fill path costs more. `processOrderFill` calls `checkRiskLimits` and then `broadcastSnapshot` (:484-485). For a user with more than 500 positions, each fill now runs two full drains and two quote batches of about 500 symbols each, on the PORTFOLIO-14 serialized consumer (D-13). This fix does not optimise that.
   - A position-page error no longer suppresses drawdown alerts (O-2, D-16).

8. **C-16 promotion.** At launch:
   - Promote this feature's `@AC-*` scenarios to `services/xstockstrat-portfolio/acceptance/`.
   - Add a new scenario tagged `@feature-357`: "a position-read failure skips concentration but drawdown still alerts".
   - The spec reads the PORTFOLIO-14 and PORTFOLIO-16 invariants before step planning.

**Register closure at approval.** The operator approved the synthesized approach at the round-3 gate. That approach already resolves the four round-3 objections, and each becomes a binding `/sdd-spec` obligation:

| Objection | Blocking | Resolved by |
|---|---|---|
| O-7 | yes | Only `ci.yml:1065` is edited |
| O-8 | no | Service-unique prefix, unique account ids and prefix-only cleanup |
| O-9 | no | The constructor, service fields and AC-3 offline assertions above |
| O-10 | no | The ListPositions regex is anchored to its SELECT |

## Rejected Alternatives

- `R-1` Repo-level `ListAllPositions` drain — rejected because it edits 353's `portfolio_repo.go` (operator fence), the failure policy belongs to the caller, and it gives no testing advantage.
- `R-2` A single unpaged internal repo query — rejected because it adds a second SQL shape and scan path in 353's file and stops reusing the proven cursor.
- `R-3` Reusing `db_error` for a snapshot read failure — rejected because it merges an insert failure, which still emits and broadcasts, with a read failure, which emits nothing.
- `R-4` `anyArgs` for the page-2 mock expectation — rejected because it cannot detect a helper that fails to forward the token (fails.md:3310-3312).
- `R-5` A new `ErrPositionsUnavailable` sentinel mapped to Unavailable — rejected as YAGNI: a page-1 error is Internal today. Possible follow-up only.
- `R-6` Draining once per fill and sharing the slice between `checkRiskLimits` and `broadcastSnapshot` — rejected because it changes both signatures and the fill-path wiring, which goes beyond the four-reader bug-fix scope (C-18 YAGNI). The cost is disclosed instead.
- `R-7` Moving `seedPosition`/`testPool` into an exported shared test package — rejected because it edits feature 353's `dbtest_helpers_test.go`, breaching the operator fence.
- `R-8` Copying `seedPosition` verbatim into the service package — rejected as a C-18/DRY duplicate. The exported `repo.UpsertPosition` (portfolio_repo.go:62) seeds rows without copying.
- `R-9` Editing the marketdata dbtest CI step at `ci.yml:1116` to add `./internal/service/...` — rejected because that step belongs to xstockstrat-marketdata (ci.yml:1111). It is outside the operator's portfolio-only scope.
- `R-10` A service dbtest using only `NewPortfolioRepo(PORTFOLIO_DB_TEST_URL)`, with no local pool — rejected because it drops `lock_timeout=500ms`, so a lock wait hangs instead of failing fast, and the operator's (a') ruling specifies a minimal local pool. It is kept only as the fallback if `*pgxpool.Pool` does not satisfy `queryRower`.
- (Operator-declined, not an R-n row) Option (c), a repository-package oracle plus pgxmock-only service tests — the operator chose (a') at the round-2 gate, because (c) does not exercise the service drain on a real database.

## Open Risks

- [ ] A single `GetLatestQuotes` batch of 501 or more symbols may exceed `batch_timeout_ms` (2500) inside `quote_timeout_ms` (4000), or hit an unverified vendor cap. Addressed by the D-9 dev smoke gate, with per-page enrichment as the fallback, at the spec's verification step.
- [ ] Cross-page read skew across N non-transactional statements (D-8). Disclosed, not mitigated. Goes in the release notes at the integration PR.
- [ ] The serialized fill consumer slows down for users with more than 500 positions: two drains and two large quote batches per fill (D-13). Disclosed. Any optimisation is a follow-up and not in scope (R-6).
- [ ] Drain memory grows linearly with the number of positions. Only the repeated-token and empty-page guards stop a pathological loop. To be confirmed acceptable at the drain-helper step.
- [ ] Parallel package runs against a shared dbtest database can flake unless the spec pins a unique prefix and unique account ids (O-8). Addressed at the dbtest step.
- [ ] `NewPortfolioRepoWithDB(pool)` assumes `*pgxpool.Pool` satisfies `queryRower` and that the drained readers never call `repo.Pool()` (O-9). The spec verifies both at the dbtest step; the fallback is R-10.
- [ ] After deploy, users with more than 500 positions see different totals and P&L, and may see new concentration alerts. The release notes must say so at the integration PR.
- [ ] The PORTFOLIO-14 and PORTFOLIO-16 invariants have not been read yet. The spec checks them at `/sdd-spec`.

## Constitution Rules Touched

- `C-01` — honored by: every touchpoint cites a recon.md or code path:line, and the remaining unknowns (the regex substring, `queryRower` conformance) are named as spec verification items, not assumed.
- `C-08` — honored by: each code change is paired with a test: the pgxmock suite (4a-4g) and the 501-row dbtest (5).
- `C-11` — honored by: the SDD path (triage, review, design) ran before any code. This bug runs on Track C with a full 3-round debate.
- `C-13` — honored by: the tests reuse the existing service harness and fixtures (`stubMarketData`, `anyArgs`, `ctxWithUser`, `recordLogs`, `installMetricReader`) and seed the real DB through the exported `UpsertPosition`, with no new ad-hoc fixture home.
- `C-15` — honored by: each `@AC-1`..`@AC-5` maps to a named test (4a-4f), and the new `@feature-357` drawdown scenario maps to 4g.
- `C-16` — honored by: see Business Rules Touched. There are no CHANGE lines, and the `@AC-9 @feature-231` EXTEND is under operator sign-off.
- `C-18` — honored by: a private helper with no new interface (YAGNI) and reuse of the existing repo page and cursor (DRY). The ~15-line `serviceTestPool` duplication is a recorded waiver (D-17).
- `P-02` — honored by: the proposer and adversary exchanged only mediated syntheses over three rounds.
- `P-03` — honored by: the drawdown fall-through (O-2) and the dbtest form (P-1/O-5) were escalated to the operator, not guessed.
- `P-06` — honored by: every test in 4 and 5 must fail on the current single-page code before the fix lands. This is mandatory per the operator decision.
- `F-04` — honored: every path and symbol is grep-confirmed in recon.md or the round syntheses. The anchored regex substring is deferred to the spec, not invented.
- `F-07` — honored: no new config key and no hardcoded config value. `risk.concentration_limit_pct` and `risk.max_drawdown_pct` are still read through `s.cfg`. `positionDrainPageSize` is a code invariant tied to the repo cap, not runtime config.
- `PLAT-N1` — honored: the alert emissions in `checkRiskLimits` and the snapshot emit and broadcast keep their existing best-effort semantics, and the new skip paths emit nothing.

## Business Rules Touched (C-16)

- PRESERVE `@AC-1 @FR-1 @FR-4 @feature-178` "Position enrichment uses one batched quote call" (`services/xstockstrat-portfolio/acceptance/quote-fanout-batching.feature:13`). Not regressed: drain-then-enrich keeps one `GetLatestQuotes` batch per invocation (D-2, AC-4 test asserts ≤1). Operator decision 2026-11-17: "PRESERVE @AC-1 @feature-178".
- PRESERVE `@AC-1 @regression @feature-353` "Paginated ListPositions yields every position exactly once" (`services/xstockstrat-portfolio/acceptance/fix-listpositions-nextpagetoken-skips.feature:5`). Not regressed: the drain follows the cursor unchanged, and the repo, SQL and codec are untouched (D-1). Operator decision 2026-11-17: "PRESERVE ... feature 353 @AC-1".
- PRESERVE `@AC-3 @FR-5 @regression @feature-231` "Concentration sums a symbol across accounts and alerts on the true weights" (`fix-after-hours-positions-priced.feature:35`). Not regressed: concentration is computed over the whole drained set, never per page (D-2).
- PRESERVE `@AC-8 @FR-4 @feature-231` "Any unpriced position skips the equity snapshot and names the symbol" (`fix-after-hours-positions-priced.feature:56`). Not regressed: the unpriced guard runs over the full drained set, so an unpriced position on any page still skips the snapshot.
- EXTEND `@AC-9 @FR-5 @feature-231` "Any unpriced position skips concentration but drawdown still alerts" (`fix-after-hours-positions-priced.feature:64`). New case: a position-read failure also skips concentration while drawdown still alerts (new `@feature-357` scenario, red test 4g). This is an EXTEND, not a CHANGE. Signed off by the operator at the round-2 design gate on 2026-11-17 ("O-2 approved"; context.md, round-3 session).
- EXTEND `@AC-1` (this feature): all four readers compute over every one of 501 positions, which extends `@AC-1 @feature-353` pagination to the internal readers.
- EXTEND `@AC-2` (this feature): a page-2 read error makes `GetPortfolio`/`GetPnL` return an error and never a partial success. This extends the never-report-partial principle of `@AC-3 @feature-256` and `@AC-6 @feature-251`.
- EXTEND `@AC-3` (this feature): account-scoped `GetPortfolio` past 500 rows, which extends `@AC-52 @FR-9 @feature-240`.
- EXTEND `@AC-4` (this feature): at most 2 batch calls for 501 positions (the test asserts ≤1), which extends `@AC-1 @feature-178`.
- EXTEND `@AC-5` (this feature): the background readers skip with a WARN log, with no snapshot and no concentration alert from a partial set.
- The other PRESERVE rows listed in recon.md:48-63 (feature-229, 240, 242, 251, 256 and 163 scenarios) are not regressed: pricing, provenance, ledger-drain and error-class semantics are unchanged, and only the position source widens from one page to all pages.
- No CHANGE lines.

## Rounds

| Round | +D | +R | O closed | +O | Petitions | Outcome |
|---|---|---|---|---|---|---|
| 1 | 9 | 5 | 0 | 4 | 0 | Halted at gate |
| 2 | 5 | 3 | 2 | 2 | 1 (P-1, D-7) | Halted at gate. The operator ruled (a') on P-1 and approved O-2 |
| 3 | 3 | 2 | 4 | 4 | 0 | Halted at gate. The operator approved as synthesized (CI edit at ci.yml:1065 only) |

**Termination reason:** approved. The operator approved at the round-3 gate after 3 full-mode rounds, which is within the 2–5 bound. There were no Floor breaches.
