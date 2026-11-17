# Context Log: fix-portfolio-internal-position

Append-only. Each session appends a new ## Session entry. Never delete or edit prior entries.

---

## Session 2026-11-17 (/sdd-triage)

- Bug recorded via defect report `docs/reports/2026-11-17-portfolio-internal-position-reads-truncate-at-500-defect.md` (no GitHub issue — Issues disabled): portfolio internal position reads stop at the first 500 rows
- Source: feature 353 (`fix-listpositions-nextpagetoken-skips`) design § Open Risks follow-up
- Severity: SEV-2
- Routed to SDD path (Track C)
- Created: feature.md, product-spec.md, acceptance.feature (regression scenario), context.md
- Affected services (from report): xstockstrat-portfolio
- Root cause hypothesis: The internal readers predate a working cursor (feature 353) and treated one 500-row page as all positions. Repo-level drain vs per-site loop is a design decision; enrichment must stay one batched call per RPC page (`@AC-1 @feature-178`).
- Recommended design depth: quick → `/sdd-design fix-portfolio-internal-position quick` (rationale: SEV-2, single service, no proto/migration/config)
- Development branch: feature/fix-portfolio-internal-position
- Twin: feature 358 `fix-trading-reconcile-reads` (trading `reconcileTick`), split by operator decision 2026-11-17.
- Reuse feature 353's dbtest harness (`seedPosition`, `testPool` exec-mode opts) and cursor codec; ledger insight on same-slot typed binds.
- Must PRESERVE `@AC-1 @feature-178` (`quote-fanout-batching.feature`) and the 353 `@AC-1` pagination guarantee.

## Session 2026-11-17 — sdd-review product-spec

- Product spec approved. Status: draft → spec-ready.
- Warnings (criteria verdict PASS WITH WARNINGS, no fails, no floor breaches):
  - C-15: AC-1 Thens ("computed over all 501 positions") were not observable per reader. **Resolved** in this session: AC-1 gained an `<observable>` column naming a concrete assertion per reader (GetPortfolio total market value / 501 rows; GetPnL unrealized_pnl; broadcastSnapshot open_positions 501 + equity; checkRiskLimits concentration alert naming the 501st symbol).
  - C-15: AC-5 "30% concentration" had no limit value. **Resolved**: AC-1/AC-5 now pin `risk.concentration_limit_pct` at 0.20 (the code default in `checkRiskLimits`) with the position at 30% of total market value.
  - C-15 (advisory, open): AC-2 covers FR-5 only for GetPortfolio and GetPnL; AC-5 covers broadcastSnapshot and checkRiskLimits together, so a reader whose failure handling differs is not isolated. Design/spec may split AC-5 per reader. Note: `checkRiskLimits` and `broadcastSnapshot` currently `return` silently on a ListPositions error — FR-5's "each logs the failure" is new behavior.
  - Criterion 9 (advisory): one Open Question (repo-level drain vs per-site loop), deferred to `/sdd-design`. Acceptable for a bug spec.
  - C-14 (advisory, open): consumer-surface hook names `usePortfolio` / `traderBff.getPortfolio` were not verified; confirm in recon.
- Overlap findings (WARN, file-level, rebase-only; no config/proto/migration clash):
  - `services/xstockstrat-portfolio/internal/service/portfolio_service.go`: 357's four readers (:787, :932, :1214, :1283) vs `311-fix-position-fold-correctness` (spec-ready) at :260-261 / :419-420; disjoint regions, merge-conflict risk only.
  - Same file vs `312-fix-read-path-owner-trust` (spec-ready) at :435 (`acctID = "alpaca-default"` fallback); disjoint lines, rebase-only; re-check at impl-spec time since 312 touches the same identity path.
  - Consumed seam / merge order: FR-1..FR-4 depend on the `ListPositions` composite cursor from `353-fix-listpositions-nextpagetoken-skips` (code-completed, not launched) at `internal/repository/portfolio_repo.go:162,193-194`. 357 must not merge before 353 is on main-dev.
- Recommended design depth: quick (SEV-2 bug, single service, no proto/DB/config gates, overlap rebase-only).

### OPERATOR DECISIONS (binding, recorded 2026-11-17)

- Operator 2026-11-17: split from feature 358 (trading reconcile); scope is only portfolio's internal readers GetPortfolio, GetPnL, broadcastSnapshot, checkRiskLimits.
- Reuse feature 353's patterns where they fit: dbtest harness in services/xstockstrat-portfolio/internal/repository/dbtest_helpers_test.go (seedPosition, testPool exec-mode opts), the composite cursor codec, and the ledger insight on same-slot typed binds.
- PRESERVE @AC-1 @feature-178 (one batched enrichment per page) and feature 353 @AC-1.
- Do not touch features 351, 353 or 354.
- Red-before-green is mandatory.

## Session 2026-11-17 — sdd-batch design gate (round 2)

`/sdd-design fix-portfolio-internal-position` (full mode) halted at the approval gate after round 2 (gate policy: halt). design.md was not written and status.md was not changed (it stays `spec-ready`). Register in `debate.md`: D-1..D-14, R-1..R-8, O-1..O-6, P-1. Severity: SEV-2.

### Open Threads

- **Approach.** The fix stays in the service layer. A private `listAllPositions` helper in `portfolio_service.go`, next to `collectFills`, drains `ListPositions` with `positionDrainPageSize = 500`. It fails closed on a page error, on an empty page that carries a token, and on a repeated token. All four readers drain first and then enrich once:
  - `GetPortfolio` :787 passes the request's account.
  - `GetPnL` :932, `broadcastSnapshot` :1214 and `checkRiskLimits` :1283 pass `""`.
  - `GetPortfolio` and `GetPnL` return the wrapped error, which maps to Internal.
  - `broadcastSnapshot` logs WARN and records `skipped_read_error`.
  - `checkRiskLimits` logs WARN. Its quote, mark-pass and concentration work runs only after a successful read.

  `portfolio_repo.go`, the SQL, the cursor codec and the proto are not touched, so 351, 353 and 354 stay untouched. The tests are red-before-green pgxmock tests:
  - The page-2 cursor slot is pinned to `[]string{rows[499].Symbol, "TRADING_MODE_PAPER", rows[499].AccountId}`.
  - Guard tests cover the repeated token (via `listAllPositions`) and the empty page with a token (via `GetPnL`).
  - The AC-5 assertions use `recordLogs` together with `installMetricReader`.
  - The AC-4 test asserts at most 1 `GetLatestQuotes` call.

  Two more requirements:
  - A 501-row dbtest is mandatory.
  - A dev smoke test with at least 501 symbols gates the single-batch enrichment (D-9).

  design.md must disclose four things:
  - Totals change for users with more than 500 positions.
  - Cross-page read skew.
  - The fill hot path now runs two drains and two batches on the serialized consumer.
  - The O-2 drawdown change, if the operator approves it.
- **Strongest open objection (blocking): P-1 / O-5, the petition to reopen D-7.** D-7 requires a 501-row dbtest "via seedPosition/testPool". Those helpers are `package repository` `_test.go` symbols under `//go:build dbtest` (dbtest_helpers_test.go:1-3,22,66), and CI runs `-tags dbtest` only on `./internal/repository/...` (ci.yml:1065,1116). **The operator must rule** on one of two options:
  - **(a')** A service-package dbtest that seeds via the exported `UpsertPosition`, opens a minimal pool, and extends the CI dbtest package list. This is the synthesis default.
  - **(c)** A repository-package 501-row oracle plus pgxmock service tests with the cursor pinned. This needs D-7 reopened.

  O-1 (blocking) stays open until the proposer adopts the corrected cursor pin (D-10) and this dbtest form is settled.
- **Non-blocking, operator decision needed:** O-2, the `checkRiskLimits` drawdown fall-through after a page error. It changes `@AC-9 @feature-231`. If approved, it needs a new scenario plus a red test with an over-limit `GetAccountDrawdowns` row. If declined, keep the early return after the WARN.
- O-6 stays open: the fill hot-path disclosure, decided as D-13, still has to be written into design.md.
- **Closed this round:** O-3 (`recordLogs` assertion) and O-4 (the D-9 smoke gate with an explicit pass condition).
- **Floor status:** no Floor breaches.
- **@AC changes:**
  - `@AC-9 @feature-231` is a CHANGE, not covered by an operator decision (it depends on O-2).
  - `@AC-1`..`@AC-5` of this feature are EXTENDs, not covered by an operator decision.
  - `@AC-3 @feature-231` and `@AC-8 @feature-231` are PRESERVEs, not covered by an operator decision.
  - `@AC-1 @feature-178` and `@AC-1 @feature-353` are PRESERVEs, covered by the operator decisions of 2026-11-17.

```sdd-batch-design-state
{
  "round": 2,
  "synth": {
    "approach": "The fix stays in the service layer, built on settled D-1..D-9. portfolio_repo.go, the SQL, the cursor codec and the proto are not touched, so features 351, 353 and 354 stay untouched.\n\n1. **Drain helper (D-1, D-3, D-6).** Add a private `func (s *PortfolioService) listAllPositions(ctx, userID string, mode commonv1.TradingMode, accountID string) ([]*portfoliov1.Position, error)` in services/xstockstrat-portfolio/internal/service/portfolio_service.go, next to `collectFills` (:1111-1168).\n   - It loops `s.repo.ListPositions(ctx, userID, mode, positionDrainPageSize, token, accountID, \"\", POSITION_SIDE_UNSPECIFIED)`.\n   - `const positionDrainPageSize = 500` carries a constraint comment: it must stay at or below the repo cap, because portfolio_repo.go:137-138 coerces anything above 500 to 100.\n   - It fails closed in three cases:\n     1. A page error is returned wrapped as `fmt.Errorf(\"list positions page: %w\", err)`.\n     2. An empty page that still carries a next token is an error.\n     3. A next token equal to the token just sent is an error.\n\n2. **Call sites (D-2).** Each reader drains first, then enriches once over the whole set through the existing `valueRead`/`latestQuotesFor` (:506-513).\n   - `GetPortfolio` :787 passes `req.GetAccountId()`.\n   - `GetPnL` :932, `broadcastSnapshot` :1214 and `checkRiskLimits` :1283 each pass `\"\"`.\n\n3. **Behaviour on a page error.**\n   - **`GetPortfolio` and `GetPnL`:** return the wrapped error, which maps to Internal (D-4; portfolio_handler.go:89-92, :448).\n   - **`broadcastSnapshot`:** replace the bare return at :1215-1217 with `slog.WarnContext(ctx, \"portfolio snapshot skipped: position read failed\", \"user_id\", userID, \"error\", err)` plus `telemetry.RecordSnapshot(ctx, \"skipped_read_error\")`, then return. Nothing is inserted, emitted or broadcast. Update the service CLAUDE.md § Observability in the same PR (D-5).\n   - **`checkRiskLimits`:** replace the bare return at :1284-1286 with `slog.WarnContext(ctx, \"concentration check skipped: position read failed\", \"user_id\", userID, \"error\", err)`.\n     - Proposed default, pending operator sign-off on O-2: wrap the existing :1287-1300 body in `else`, so the quote fetch, `applyQuotes`, `observeQuotePass(…,\"risk\")` and the concentration loop run only after a successful read. Execution then falls through to the drawdown block :1312-1317.\n     - `observeQuotePass` must stay inside the else, so a failed read is never counted as a mark-source pass.\n     - `totalValue` stays 0, so the :1303 gate cannot fire.\n     - This shape follows the unpriced branch :1292-1294.\n     - If the operator declines, keep the early return after the WARN.\n\n4. **Red-before-green tests (P-06).** These go in a new internal/service/portfolio_position_drain_test.go, using pgxmock.\n   - **(a) Two-page fixtures, closing the gap in O-1.**\n     - Page 1 returns 501 rows: the probe row (portfolio_repo.go:168), loaded via `anyArgs` for page 1 only.\n     - The page-2 expectation has the same arg count as page 1. Its `$n::text[]` cursor slot is pinned exactly to `[]string{rows[499].Symbol, \"TRADING_MODE_PAPER\", rows[499].AccountId}`. That is the 500th row (index pageSize-1), not the 501st probe row. The mode string is the raw `trading_mode` column (`mode.String()`, portfolio_repo.go:152,202). It is not \"PAPER\".\n     - Every other slot uses `pgxmock.AnyArg()`. `anyArgs` is never used for page 2 (R-4).\n   - **(b) An account-scoped `GetPortfolio` case.**\n   - **(c) A page-2 `WillReturnError` case for both `GetPortfolio` and `GetPnL`** (AC-2).\n   - **(d) Guard tests.**\n     - Repeated token: call `listAllPositions` directly, with two identical 501-row pages. Both pages yield the same token, so it must return an error.\n     - Empty page with a token: call `GetPnL` end to end. The mock order must be spelled out in the spec, because the ledger and other reads sit around the position read. Assert an error and `ExpectationsWereMet`.\n   - **(e) AC-5 log and label assertions** (closes O-3).\n     - Use `recordLogs` (portfolio_telemetry_test.go:152-158). It is already used together with `installMetricReader` (:39) in one test at :532-533.\n     - Assert both WARN messages with an `error` attr, and assert the `skipped_read_error` outcome label.\n     - These tests are non-parallel.\n   - **(f) AC-4 batching.** Assert `stubMarketData.getLatestQuotesCalls <= 1` and `getLatestQuoteCalls == 0` (portfolio_service_test.go:19,84,106). The spec must record that this is stricter than the scenario's \"at most 2\", so a D-9 per-page fallback relaxes the test to `<= 2` instead of breaking it.\n   - **(g) The O-2 scenario, if the operator approves the fall-through.** A red test where `GetAccountDrawdowns` returns a row over the limit after a page-2 failure, and a drawdown alert is still emitted.\n\n5. **Mandatory 501-row dbtest (D-7, settled; operator ruling pending on the D-7 reopen petition).**\n   - The register-honouring implementation is a new internal/service/position_drain_dbtest_test.go under `//go:build dbtest`.\n     - It seeds 501 rows through the exported `(*PortfolioRepo).UpsertPosition` (portfolio_repo.go:62). Copying `seedPosition` is not allowed.\n     - It opens a minimal pool from `PORTFOLIO_DB_TEST_URL`, using the same skip/CI-fatal rule as dbtest_helpers_test.go:22-40.\n     - It drives `GetPnL` and `GetPortfolio` end to end and asserts that all 501 rows contribute.\n   - Because CI runs `go test -tags dbtest` only on `./internal/repository/...` (.github/workflows/ci.yml:1065,1116), the portfolio db-test job's package list must also be extended to `./internal/service/...`.\n   - `seedPosition`/`testPool` cannot be reused from the service package: they are `package repository` `_test.go` symbols (dbtest_helpers_test.go:1-3,22,66).\n   - Moving them to a shared package would edit 353's fenced file, and that is rejected.\n\n6. **Spec verification gate (D-9).** Run a dev smoke test of `GetPnL` and `GetPortfolio` with at least 501 symbols.\n   - Pass condition: no Unavailable, and `portfolio.marketdata_fetch{op=quotes}` outcome is ok.\n   - If it fails, switch to per-page enrichment followed by re-aggregation.\n\n7. **Disclosures in design.md (extending D-8).**\n   - Users with more than 500 positions will see different totals, P&L and `open_positions`, and may get new concentration alerts.\n   - Cross-page read skew from statements that run outside a transaction is accepted.\n   - The fill-consumer hot path gets more expensive: `processOrderFill` calls `checkRiskLimits` then `broadcastSnapshot` back to back (portfolio_service.go:484-485). For a user with more than 500 positions, each fill now runs two full drains and two batches of about 501 symbols each, on the PORTFOLIO-14 serialized consumer. This is accepted and is not optimised in this fix.\n   - If the operator approves O-2, a page error no longer suppresses drawdown alerts.\n\n8. **Promotion (C-16).** At launch, promote the new scenarios to services/xstockstrat-portfolio/acceptance/. The spec must also read the PORTFOLIO-* invariants, PORTFOLIO-14 and PORTFOLIO-16 especially.",
    "open_objections": [
      {
        "text": "REOPEN D-7 petition (adversary r2, new evidence): seedPosition/testPool are package-repository _test.go symbols under //go:build dbtest (dbtest_helpers_test.go:1-3,22,66), and CI runs dbtest only for ./internal/repository/... (ci.yml:1065,1116). So the service-level 501-row dbtest cannot be built 'via seedPosition/testPool' as D-7 is worded. The operator must choose one of these:\n(a') a service-package dbtest that seeds via the exported repo.UpsertPosition, opens a minimal local pool, and extends the CI dbtest package list. This honours D-7's intent at the cost of about 15 lines of pool/skip logic that duplicate testPool, plus a CI edit.\n(c) a repository-package 501-row dbtest as the real-cursor oracle, plus pgxmock service tests with the cursor slot pinned. This needs D-7 reopened.\nThe synthesis defaults to (a') until the operator rules. Moving the helpers to a shared package is rejected: it edits 353's fenced file.",
        "blocking": true
      },
      {
        "text": "O-1 residual: the r2 proposal pinned the page-2 cursor slot to []string{sym500,\"PAPER\",acct500}. The cursor actually stores mode.String(), i.e. \"TRADING_MODE_PAPER\" (portfolio_repo.go:152,202), taken from row index pageSize-1. With the wrong value the test can never go green, which invites loosening it to AnyArg (R-4). The synthesis corrects the pin. O-1 closes when the proposer adopts the corrected value and the D-7 dbtest form is settled by the operator.",
        "blocking": true
      },
      {
        "text": "O-2 (unchanged): the checkRiskLimits drawdown fall-through after a page error changes @AC-9 @feature-231 behaviour and still needs operator sign-off. If approved, it needs a new scenario plus a red test with an over-limit GetAccountDrawdowns row, and observeQuotePass must stay inside the success branch. If declined, keep the early return after the WARN.",
        "blocking": false
      },
      {
        "text": "Fill hot-path cost: processOrderFill calls checkRiskLimits and broadcastSnapshot back to back (portfolio_service.go:484-485). For a user with more than 500 positions, each fill now runs two full drains and two large GetLatestQuotes batches on the serialized consumer (PORTFOLIO-14). This must be disclosed in design.md alongside D-8. It is not optimised in this fix.",
        "blocking": false
      }
    ],
    "floor_breaches": [],
    "business_rule_changes": [
      {
        "ac_id": "@AC-1 @feature-178",
        "kind": "PRESERVE",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "@AC-1 @feature-353",
        "kind": "PRESERVE",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "@AC-3 @feature-231",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-8 @feature-231",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-9 @feature-231",
        "kind": "CHANGE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-1",
        "kind": "EXTEND",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-2",
        "kind": "EXTEND",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-3",
        "kind": "EXTEND",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-4",
        "kind": "EXTEND",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-5",
        "kind": "EXTEND",
        "covered_by_operator_decision": false
      }
    ],
    "rejected_alternatives": [
      "A repo-level ListAllPositions drain (R-1, locked). It edits 353's fenced file.",
      "A single unpaged repo query (R-2, locked).",
      "Reusing db_error for the snapshot read failure (R-3, locked).",
      "anyArgs for the page-2 mock expectation (R-4, locked).",
      "An ErrPositionsUnavailable sentinel (R-5, locked).",
      "Draining once per fill and sharing the slice between checkRiskLimits and broadcastSnapshot. It would halve the hot-path cost and remove cross-reader skew, but it changes both signatures and the fill-path wiring, which is beyond the four-reader bug-fix scope (C-18 YAGNI). The cost is disclosed instead.",
      "Moving seedPosition/testPool into an exported internal/testutil package. That edits feature 353's dbtest_helpers_test.go, breaching the operator fence.",
      "Copying seedPosition verbatim into the service package. It is a C-18/DRY duplicate; seeding goes through the exported repo.UpsertPosition instead.",
      "Using recordWarns together with installMetricReader. Running them together was unverified. recordLogs is already proven alongside installMetricReader (portfolio_telemetry_test.go:532-533)."
    ],
    "open_risks": [
      "One GetLatestQuotes batch with more than 500 symbols may exceed batch_timeout_ms 2500 inside quote_timeout_ms 4000, or an unverified vendor cap. GetPnL would then return Unavailable consistently for the targeted users. This is gated by the D-9 smoke test, with per-page enrichment as the fallback.",
      "Cross-page read skew from N statements that run outside a transaction (D-8). Disclosed, not mitigated.",
      "The fill consumer gets slower for users with more than 500 positions: two drains and two large quote batches per fill on the serialized consumer.",
      "Memory in the unbounded drain grows linearly with position count. Only the repeated-token and empty-page guards stop pathological loops.",
      "If option (a') is chosen, the service dbtest needs a CI job edit (ci.yml:1065 or :1116) and duplicates a small amount of pool/skip logic. If the CI edit is missed, the test silently never runs in CI.",
      "Users will see different totals, P&L and open_positions, and may get new concentration alerts after deploy. The release notes must say so.",
      "The PORTFOLIO-* invariants have still not been read. The spec must check PORTFOLIO-14 and PORTFOLIO-16."
    ],
    "constitution_rules_touched": [
      "C-01",
      "C-08",
      "C-11",
      "C-15",
      "C-16",
      "C-18",
      "P-02",
      "P-03",
      "P-06",
      "F-04",
      "F-07",
      "PLAT-N1"
    ],
    "rationale": "I checked both of the adversary's blocking claims against the worktree, and both hold.\n\n**The cursor pin value is wrong.** The cursor stores `mode.String()`, i.e. \"TRADING_MODE_PAPER\" (portfolio_repo.go:152,202), from row `pageSize-1`. A pin of \"PAPER\" could never pass. The synthesis corrects the value. O-1 stays open until the proposer adopts it and the dbtest question is settled.\n\n**The D-7 dbtest cannot be built as worded.** `seedPosition`/`testPool` are `package repository` `_test.go` symbols under the `dbtest` tag. I also found that CI runs `-tags dbtest` only on `./internal/repository/...` (ci.yml:1065,1116), which strengthens the petition: a service-package dbtest would not run in CI without a CI edit. D-7 is settled and only the operator can reopen it. So the approach keeps D-7's intent through the least-cost compliant form (a'): seed via the exported `UpsertPosition`, use a minimal pool, and extend the CI dbtest package list. The REOPEN D-7 petition is recorded as new evidence for the operator, with option (c) as the alternative.\n\n**Non-blocking items folded into the approach:**\n- `recordLogs` replaces `recordWarns`, because it is already proven alongside `installMetricReader` (closes O-3).\n- The guard tests are split explicitly: repeated-token via `listAllPositions`, empty-page-with-token via `GetPnL`.\n- `observeQuotePass` stays inside the success branch.\n- The AC-4 stricter-than-scenario note is recorded.\n- The fill hot-path double drain is disclosed alongside D-8, and the shared-slice optimisation is rejected as out of scope.\n\n**O-4** closes because D-9 already makes the smoke test a mandatory gate and the proposal adds a concrete pass condition. **O-2** stays with the operator.\n\n**Register:** no D-n is contradicted and no R-n is reintroduced.",
    "register_delta": {
      "new_decisions": [
        {
          "text": "The page-2 pgxmock cursor slot is pinned to []string{rows[pageSize-1].Symbol, \"TRADING_MODE_PAPER\", rows[pageSize-1].AccountId}, the raw trading_mode column string from the 500th row, not the probe row.",
          "evidence": "portfolio_repo.go:152 (mode.String()), :200-203 (encodePositionCursor on positions[pageSize-1]); portfolio_fill_errors_test.go:52 fixture mode"
        },
        {
          "text": "AC-5 log and outcome-label assertions use recordLogs together with installMetricReader, in non-parallel tests.",
          "evidence": "portfolio_telemetry_test.go:39, :152-158, :532-533 (already used together in one test)"
        },
        {
          "text": "In the checkRiskLimits success branch, the quote fetch, applyQuotes, observeQuotePass(...,\"risk\") and the concentration loop run only after a successful drain. A failed read never counts as a mark-source pass.",
          "evidence": "portfolio_service.go:1287-1300, :1292-1294"
        },
        {
          "text": "design.md discloses the fill hot-path cost as an accepted delta: for users with more than 500 positions, each fill runs two drains and two large quote batches on the serialized consumer.",
          "evidence": "portfolio_service.go:484-485; PORTFOLIO-14 serialized consumer (adversary r2)"
        },
        {
          "text": "The AC-4 test asserts at most 1 GetLatestQuotes call, stricter than the scenario's 'at most 2'. A D-9 per-page fallback must relax the test to at most 2 rather than break it.",
          "evidence": "portfolio_service_test.go:19,84,106; D-2, D-9"
        }
      ],
      "new_rejected": [
        {
          "text": "Draining once per fill and sharing the slice between checkRiskLimits and broadcastSnapshot",
          "why": "Changes both signatures and the fill-path wiring, which is beyond the four-reader bug-fix scope (C-18 YAGNI); disclosed instead"
        },
        {
          "text": "Moving seedPosition/testPool into an exported shared test package",
          "why": "Edits feature 353's dbtest_helpers_test.go, breaching the operator fence"
        },
        {
          "text": "Copying seedPosition verbatim into the service package",
          "why": "C-18/DRY duplicate; the exported repo.UpsertPosition (portfolio_repo.go:62) seeds rows without copying"
        }
      ],
      "new_objections": [
        {
          "text": "REOPEN D-7 petition pending an operator ruling: the service-level 501-row dbtest cannot use the package-repository seedPosition/testPool, and CI dbtest covers only ./internal/repository/... The operator chooses (a') a service dbtest seeded via UpsertPosition plus a CI package-list edit, or (c) a repository-package oracle plus pgxmock service tests with the cursor pinned.",
          "blocking": true
        },
        {
          "text": "Fill hot-path cost (two drains and two large quote batches per fill on the serialized consumer) must be disclosed in design.md alongside D-8.",
          "blocking": false
        }
      ],
      "closed_objections": [
        {
          "id": "O-3",
          "how": "The log assertion uses the existing recordLogs (portfolio_telemetry_test.go:152-158), proven alongside installMetricReader at :532-533, and asserts the exact WARN messages with an error attr. No new capture helper."
        },
        {
          "id": "O-4",
          "how": "Turned into a mandatory spec verification gate (D-9) with an explicit pass condition: no Unavailable and marketdata_fetch{op=quotes} outcome ok for at least 501 symbols. Failing it triggers the per-page enrichment fallback."
        }
      ],
      "reopen_petitions": [
        {
          "target": "D-7",
          "evidence": "seedPosition/testPool are package-repository _test.go symbols under //go:build dbtest (internal/repository/dbtest_helpers_test.go:1-3,22,66), with no dbtest file in internal/service. CI runs go test -tags dbtest only on ./internal/repository/... (.github/workflows/ci.yml:1065,1116). D-7's recorded evidence cites only the helper line numbers, not the package or the CI scope.",
          "is_new": true
        }
      ],
      "reopened": []
    }
  },
  "floor_breaches": []
}
```
