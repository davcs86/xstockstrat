# Context Log: fix-listpositions-nextpagetoken-skips

Append-only. Each session appends a new ## Session entry. Never delete or edit prior entries.

---

## Session 2026-11-16 (/sdd-triage)

- Bug reported via defect report `docs/reports/2026-11-16-portfolio-listpositions-page-token-skips-boundary-row-defect.md` (sidecar stamped triaged)
- Severity: SEV-2, environment dev (main-dev) -> Track C (SDD path)
- Affected services: xstockstrat-portfolio; callers analysis, agent
- Root cause hypothesis: look-ahead token + non-unique symbol keyset
- Design depth: full (user choice; rubric default was quick) -> `/sdd-design fix-listpositions-nextpagetoken-skips`
- Open question for design: handling of legacy bare-symbol tokens from in-flight clients (user: decide in design)
- Out of bounds: sibling ListWatchlists report, feature 351
- Development branch: feature/fix-listpositions-nextpagetoken-skips

---

## Session 2026-11-16 — sdd-design (round 1 of full debate)

- Phase 0 Recon: recon.md written (portfolio, analysis, agent, scenario-recon). No existing @AC pins ListPositions pagination; all PRESERVE.
- Round 1: proposer = composite (symbol, trading_mode, account_id) base64(JSON) cursor from the last returned row, reject malformed tokens (InvalidArgument). Adversary: no Floor breach; one blocking-for-approval objection (O-1: test-pin arg-shape blast radius); missed consumer `/trader/positions` added to product-spec. See debate.md.
- Pending user steer: O-1 arg shape (a/b/c).

## Session 2026-11-16 — sdd-design (round 2, approved)

- Round 2: O-1 resolved by option (b) (single text[] cursor arg every page; 3 exact pins change at offline_account_pnl_test.go:530,531,572). Adversary agreed; conditions folded into D-8 (mandatory Exec-mode dbtest subtests, special-char/NULL account_id row, matcher for non-nil empty slice, reuse testUserID cleanup).
- Chosen approach: composite (symbol, trading_mode, account_id) base64url(JSON) cursor from the last returned row; reject malformed/legacy tokens as InvalidArgument (deliberate departure from marketdata resume-page-1). Rejected: R-1..R-8 (see debate.md).
- Constitution rules touched: C-01, C-08, C-10, C-13, C-14, C-15, C-16, C-18, P-06; Floor breaches: none.
- Open Threads: exec-mode encoding risk -> test step; plan-shape note; deploy-straddle (confirm QueryStateMessages on /trader/positions) -> spec step; follow-up defect reports (analysis drain hardening, WatchlistRepo.ListByUser, internal 500-row truncation) to file after merge.
- Status: draft -> design-approved.

## Session 2026-11-17 — sdd-spec

- Tree: ccr-fix-listpositions-nextpagetoken-skips@384bf65 ≡ origin/ccr-fix-listpositions-nextpagetoken-skips (origin/main-dev@ccbe424 is an ancestor). `feature/fix-listpositions-nextpagetoken-skips` does not exist on origin. Stayed on the ccr branch because the feature directory exists only there (same call recon made).
- Wrote implementation-spec.md with 4 steps, all in xstockstrat-portfolio. Status: design-approved → implementation-ready.
  - Step 1 [service]: repo cursor codec, `ErrInvalidPageToken`, `scanPositionRowWithMode`, and the SQL. It also carries the 3 exact pin edits at `offline_account_pnl_test.go:530,531,572`, so it passes its own verification without a Lands with.
  - Step 2 [test]: pgxmock tests, the codec table test, and the dbtest traversal + oracle tests over both exec modes. Covers AC-1.
  - Step 3 [service]: `classifyListPositionsError` at `portfolio_handler.go:115`.
  - Step 4 [test]: classifier test at the Connect and gRPC edges.
- Key codebase findings:
  - Bug lines: `portfolio_repo.go:161-162` (symbol-only keyset) and `:191-196` (`positions[pageSize].Symbol`). The ORDER BY at `:171` has no tiebreaker.
  - The only empty-token exact pins are `offline_account_pnl_test.go:530,531,572`. The `anyArgs` pins keep their arg count.
  - dbtest cleanup today covers watchlists only (`dbtest_helpers_test.go:41-46`). There is no positions seeder. To get the Exec-mode pool, the spec extends `testPool` with variadic `opts ...func(*pgxpool.Config)`.
  - C-13: the repository-package pgxmock row header (`portfolio_repo_test.go:60-63`) gets a second consumer, so Step 2 hoists it into `positionRowCols`.
  - The design assumption about the deploy straddle was wrong. `/trader/positions` renders the error with hand-rolled markup (`page.tsx:511` "Failed to load positions"), not `QueryStateMessages`. The error is still visible, and the user recovers by reload or `resetPaging` (`:58-62`). That markup is a pre-existing C-17 deviation and out of scope; there is no UI step.
  - TimescaleDB is not installed locally, so the dbtest RED/GREEN is authoritative only in CI `portfolio-db-test` (or on a host with migrated TimescaleDB). The local RED is the pgxmock first-page test.
- Open thread for /sdd-review: `acceptance.feature` has no scenario for the malformed-token → InvalidArgument path (D-4). Step 4 marks Covers as `—` and guards it as a design decision. Adding an `@AC-2` is a product-spec call.

## Session 2026-11-17 — sdd-review impl-spec loop (iteration 1 → spec fixes)

- Review iteration 1: 0 ✗, 6 ⚠ (advisory); overlap CLEAN (soft rebase note: 311/323 touch portfolio_repo.go in disjoint regions, both spec-ready).
- Addressed in implementation-spec.md: citation drift (:134→:135, clamp :136-138, :505-507 `[]string` precedent re-verified); pgxmock `Argument` interface verified from module source (argument.go:6-8, DeepEqual at expectations.go:169); local TimescaleDB recipe verified (docker timescale/timescaledb:latest-pg16 + psql migrations, existing dbtests green) so the real-backend RED is capturable locally; PR TDD-block instructions for Steps 2 and 4; testPool variadic call-site claim quantified (30 sites); follow-up tracking rule.
- Open Threads (follow-ups, file after launch via /sdd-qa defect):
  - [x] analysis position-drain hardening (equal-token guard, fail closed, cap-hit log) — filed `docs/reports/2026-11-17-analysis-held-position-drains-trust-page-token-defect.md`
  - [x] WatchlistRepo.ListByUser look-ahead token (other session owns the sibling report) — already filed and triaged as feature 354 (`fix-listwatchlists-page-token`, PR #1566); left to its owner
  - [x] internal 500-row truncation (portfolio_service.go:787,932,1214,1283; trading.go:2235) — filed as two reports: `docs/reports/2026-11-17-portfolio-internal-position-reads-truncate-at-500-defect.md`, `docs/reports/2026-11-17-trading-reconcile-reads-first-500-positions-defect.md`

- Review iteration 2: 0 ✗, 3 ⚠ (stale pgxmock "not in cache" text; scan-wrapper trade-off not cross-referenced; parent-level pool construction intent) + citation drift :191-196→:192-197 and unqualified ledger paths — all fixed in implementation-spec.md.

## Session 2026-11-17 — sdd-review impl-spec (advisory) — final

- Result: iteration 3 PASS — 0 failures, 0 warnings (advisory). Loop: it.1 0✗/6⚠ → fixed; it.2 0✗/3⚠ → fixed; it.3 clean (cosmetic 30→29 testPool call-site count fixed).
- Unresolved ✗ / ⚠ carried into execution: none.
- Overlap findings: none blocking; soft rebase note — 311 and 323 (spec-ready) touch portfolio_repo.go in disjoint regions.
- Tree: ccr-fix-listpositions-nextpagetoken-skips@02ce334 (origin/main-dev@ccbe424 merged).

## Session 2026-11-17 — sdd-execute sequential (no checkpoints, operator instruction)

- Tooling setup (steps 1-4): go1.27 ✓ · golangci-lint ⬇ v2.14.0 (built with go1.27.0) · TimescaleDB container ts353 (pre-existing, see DEV-2).
- Branch: feature/fix-listpositions-nextpagetoken-skips created from ccr-fix-listpositions-nextpagetoken-skips@559036b (DEV-1).
- RED (pre-Step-1 tree 559036b): local `TestListPositions_FirstPageBindsEmptyCursorArray` FAIL (SQL `($2 = '' OR symbol > $2) ORDER BY symbol ASC` does not match `cardinality(...::text[])`); real backend `TestListPositions_TraversalYieldsEveryRowOnce` FAIL in default and exec modes — page size 3 got qty [1 2 3 5 6 7] (pages [3 3]), page size 1 got [1 5 7], PAPER filter got [2 6]; `TestListPositions_CursorMatchesOracleOrder` FAIL (page size 1 returned only "Acct-1").

### Step 1 — Composite keyset cursor in `PortfolioRepo.ListPositions` [done]
- Token from the last returned row over (symbol, trading_mode, account_id), base64url(JSON); one `text[]` cursor arg in the old token slot with explicit casts; `ORDER BY symbol, trading_mode, account_id`; malformed token → `ErrInvalidPageToken` before any query; `scanPositionRowWithMode` wrapper; three `offline_account_pnl_test.go` pins re-pinned to `[]string{}`.
- Verification: grep checks ✓, build ✓, vet (dbtest tag) ✓, `go test ./... -race` ✓ (also green with Step 2 test files absent), golangci-lint v2.14.0 0 issues. Real-backend GREEN: traversal + oracle tests PASS in default and exec modes.
- Files modified: `services/xstockstrat-portfolio/internal/repository/portfolio_repo.go`, `services/xstockstrat-portfolio/internal/service/offline_account_pnl_test.go`
- Deviations: DEV-1, DEV-2, DEV-3 (Deviation Log)

### Step 2 — ListPositions cursor tests (pgxmock + codec + real-backend traversal) [done]
- Added `positionRowCols` (C-13 hoist), `emptyStringSlice` pgxmock matcher, first-page / cursor-page / malformed-token pgxmock tests, `TestPositionCursorCodec`; dbtest helpers `testPool(opts...)`, positions cleanup (same `dbtestUserPrefix`), `seedPosition`; `list_positions_dbtest_test.go` with traversal (page sizes 3/1, PAPER filter) and collation/special-character oracle tests over default + Exec-mode pools.
- RED: captured on the pre-Step-1 tree (see session header above). GREEN: unit tests PASS; full `-tags dbtest ./internal/repository/...` PASS (default + exec subtests ran, none skipped); coverage total 81.8% (floor 40%); golangci-lint 0 issues; C-13 grep exactly 1 hit.
- Files modified: `services/xstockstrat-portfolio/internal/repository/portfolio_repo_test.go`, `services/xstockstrat-portfolio/internal/repository/dbtest_helpers_test.go`, `services/xstockstrat-portfolio/internal/repository/list_positions_dbtest_test.go` (new)
- Deviations: none (DEV-2 applies to the real-backend run)

### Step 3 — Map `ErrInvalidPageToken` to `InvalidArgument` in the ListPositions handler [done]
- Added `classifyListPositionsError` beside `classifyGetPositionError`; `ListPositions` handler now returns `classifyListPositionsError(err)` instead of `CodeInternal`.
- RED: Step 4's `TestClassifyListPositionsError` written first → build failed `undefined: classifyListPositionsError` (compile-level RED; behavioural RED is Step 2's `TestListPositions_MalformedTokenIssuesNoQuery`). GREEN: Step 3 verification (with the Step 4 test file absent) build ✓, handler tests ✓, golangci-lint 0 issues.
- Files modified: `services/xstockstrat-portfolio/internal/handler/portfolio_handler.go`
- Deviations: none

### Step 4 — ListPositions error classification at the Connect and gRPC edges [done]
- `TestClassifyListPositionsError` (sentinel, wrapped → InvalidArgument; other → Internal) plus the gRPC-edge assertion `status.Code(toGRPCError(...)) == codes.InvalidArgument`.
- RED: compile failure captured before Step 3 (`undefined: classifyListPositionsError`). GREEN: handler tests PASS; coverage total 81.8% (floor 40%); golangci-lint 0 issues.
- Files modified: `services/xstockstrat-portfolio/internal/handler/portfolio_handler_test.go`
- Deviations: none

- Final config-wiring gate: `node scripts/check-config-wiring.mjs --final` exit 0 (only pre-existing REPORTED lines for analysis `fundamentals.provider` and trading `trading_state`; no key from this feature).

## Integration (2026-11-17)
- Merge-order gate: no entry for 353 → proceed.
- C-16 promotion: `@AC-1` → `services/xstockstrat-portfolio/acceptance/fix-listpositions-nextpagetoken-skips.feature` (`@feature-353`); no equivalent scenario existed (scenario-recon: none pins ListPositions pagination). Operator's "no checkpoints" instruction covered the promotion confirm.
- Defect-report closing (2.6): no candidates — this feature records no C-16 CHANGE. The source report's sidecar stays `triaged` / `feature:353-fix-listpositions-nextpagetoken-skips`; `/sdd-archiver` derives resolution from `launched`.
- Open Threads (follow-ups, file after launch via /sdd-qa defect): still `[ ]` — analysis drain hardening; WatchlistRepo.ListByUser; internal 500-row truncation.

## Session 2026-11-17 — sdd-execute
**Steps this session**: 1, 2, 3, 4
**Progress**: 4 done / 4 total
**Stopped at**: all complete — integration PR #1568 (feature/fix-listpositions-nextpagetoken-skips → main-dev) opened, CI watch subscribed
**Next**: merge #1568 when CI is green; PR #1564 (docs-only, same commits' docs) is superseded — operator to close it; after launch file the three follow-up defect reports
