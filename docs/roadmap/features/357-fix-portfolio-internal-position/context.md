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

## Session 2026-11-17 — sdd-batch design gate (round 3)

`/sdd-design fix-portfolio-internal-position` (full mode) halted at the approval gate after round 3 (gate policy: halt). design.md was not written and status.md was not changed (it stays `spec-ready`). Register in `debate.md`: D-1..D-17 (D-7 reopened by operator steer, amended as D-15), R-1..R-10, O-1..O-10, P-1. Severity: SEV-2.

### Open Threads

- **Approach.** Same shape as round 2, now built on D-1..D-17 and the operator's 2026-11-17 rulings at the round-2 gate: (a') for the D-7 dbtest petition, and approval of the O-2 drawdown fall-through. `portfolio_repo.go`, the SQL, the cursor codec, the proto and 353's `dbtest_helpers_test.go` are not touched, so 351, 353 and 354 stay untouched.
  - A private `listAllPositions` drains `ListPositions` with `positionDrainPageSize = 500`. It fails closed on a page error, on an empty page with a token, and on a repeated token. All four readers drain first, then enrich once.
  - `GetPortfolio` and `GetPnL` return Internal. `broadcastSnapshot` logs WARN and records `skipped_read_error`.
  - `checkRiskLimits` (O-2 approved, D-16) logs WARN "concentration check skipped: position read failed". The quote fetch, `applyQuotes`, `observeQuotePass(...,"risk")` and the concentration work move into the success branch, and execution falls through to the unchanged drawdown block.
  - The pgxmock tests:
    - Page 2 is pinned to `[]string{rows[499].Symbol, "TRADING_MODE_PAPER", rows[499].AccountId}`.
    - The ListPositions regex is anchored to a substring unique to its SELECT. The spec names it.
    - The guard tests stay.
    - AC-5 uses `recordLogs` with `installMetricReader`.
    - AC-4 asserts at most 1 batch.
    - A new red test (4g) fails page 2 and asserts that a drawdown alert still fires, with no concentration alert and no `risk` mark-source sample.
  - The dbtest (D-15) is a new `internal/service/position_drain_dbtest_test.go` under `//go:build dbtest`.
    - A local `serviceTestPool` sets `lock_timeout=500ms` and uses the same skip/CI-fatal rule as `testPool`. Its duplication is the C-18 waiver recorded as D-17.
    - The repo is `repository.NewPortfolioRepoWithDB(pool)`. The fallback is `NewPortfolioRepo(url)`.
    - Users get an `it-357-` prefix, each test gets unique account ids, and cleanup is by prefix only.
    - It seeds 501 rows plus a 3-row second account via `UpsertPosition`.
    - The service sets the `marketdata`, `ledger` and `subs` fields, as `newQuoteSvc` does.
    - AC-3 asserts count and account ids, not equity.
    - In CI, only the portfolio step at ci.yml:1065 gains `./internal/service/...`.
  - The D-9 smoke gate stands. The design.md disclosures stand: totals change, read skew, fill hot-path cost, and drawdown no longer suppressed.
- **Strongest open objection (blocking): O-7.** The round-3 proposal edits ci.yml:1116, but that is the **marketdata** dbtest step (working-directory at ci.yml:1111). Only ci.yml:1065 is portfolio (ci.yml:1060). The synthesis already edits :1065 alone and rejects the :1116 edit as R-9. O-7 closes when the proposer drops :1116 from Touchpoints and Key Decisions.
- **Non-blocking, open until the proposal answers them** (the synthesis already does):
  - O-8: dbtest prefix and account collisions with the parallel repository-package dbtests. `testPool` deletes `it-281-%`, and account-keyed deletes are cross-user.
  - O-9: dbtest wiring, meaning the repo constructor, the service fields and the AC-3 offline path.
  - O-10: under `MatchExpectationsInOrder(false)`, the loose `FROM portfolio.positions` regex can let another positions query use up the pinned page-2 expectation.
- **Closed this round:**
  - O-1: the cursor pin is adopted, the guards are kept and the D-7 form is settled.
  - O-2: the operator approved the fall-through.
  - O-5: the operator ruled (a').
  - O-6: the hot-path cost is disclosed per D-13.
- **Floor status:** no Floor breaches.
- **@AC changes:**
  - `@AC-9 @feature-231` is an EXTEND, not a CHANGE, covered by the operator's 2026-11-17 sign-off on O-2. A new `@feature-357` scenario, "a position-read failure skips concentration but drawdown still alerts", is promoted at C-16.
  - `@AC-1`..`@AC-5` of this feature are EXTENDs, not covered by an operator decision.
  - `@AC-3 @feature-231` and `@AC-8 @feature-231` are PRESERVEs, not covered by an operator decision.
  - `@AC-1 @feature-178` and `@AC-1 @feature-353` are PRESERVEs, covered by the operator decisions of 2026-11-17.

```sdd-batch-design-state
{
  "round": 3,
  "synth": {
    "approach": "The fix stays in the service layer and builds on D-1 to D-14 plus the two operator rulings of 2026-11-17. It does not touch portfolio_repo.go, the SQL, the cursor codec, the proto, or 353's internal/repository/dbtest_helpers_test.go. Features 351, 353 and 354 stay untouched.\n\n1. **Drain helper (D-1, D-3, D-6).** Add a private `listAllPositions(ctx, userID, mode, accountID)` in services/xstockstrat-portfolio/internal/service/portfolio_service.go, next to collectFills (:1111-1168).\n   - It loops `s.repo.ListPositions(..., positionDrainPageSize, token, accountID, \"\", POSITION_SIDE_UNSPECIFIED)`.\n   - `const positionDrainPageSize = 500` gets a constraint comment: it must stay at or below the repo cap, because portfolio_repo.go:137-138 turns any value above 500 into 100.\n   - It fails closed on a page error (wrapped with %w), on an empty page that still carries a token, and on a token that repeats.\n\n2. **Call sites (D-2).** Each reader drains every page first, then enriches once.\n   - GetPortfolio (:787) passes `req.GetAccountId()`.\n   - GetPnL (:932), broadcastSnapshot (:1214) and checkRiskLimits (:1283) pass `\"\"`.\n\n3. **Behaviour on a page error.**\n   - **GetPortfolio and GetPnL:** the wrapped error maps to Internal (D-4).\n   - **broadcastSnapshot (:1215-1217):**\n     - Log WARN \"portfolio snapshot skipped: position read failed\" with `user_id` and `error`.\n     - Call `telemetry.RecordSnapshot(ctx, \"skipped_read_error\")`, then return.\n     - Nothing is inserted, emitted or broadcast.\n     - The service CLAUDE.md Observability section is updated in the same PR (D-5).\n   - **checkRiskLimits (operator-approved O-2):**\n     - The bare return at :1284-1286 becomes WARN \"concentration check skipped: position read failed\".\n     - The :1287-1300 body moves into the success branch: quote fetch, applyQuotes, observeQuotePass(...,\"risk\") and summing (D-12).\n     - `positions`, `totalValue` and `posValues` are declared before the branch. totalValue stays 0, so the :1303 gate cannot fire.\n     - Execution then falls through to the drawdown block (:1312-1317), which is unchanged.\n\n4. **Red-before-green pgxmock tests (P-06).** These go in a new internal/service/portfolio_position_drain_test.go.\n   - **(a) Two pages.**\n     - Page 1 returns 501 rows and is matched with `anyArgs`.\n     - The page-2 expectation has the same arg count as page 1. Its `$n::text[]` slot is pinned to `[]string{rows[499].Symbol, \"TRADING_MODE_PAPER\", rows[499].AccountId}` (D-10). Every other slot is `pgxmock.AnyArg()`, never `anyArgs` (R-4).\n     - **New:** the ListPositions expectation regex is anchored to a substring unique to the ListPositions SELECT at portfolio_repo.go:136-206, such as its keyset row-comparison clause, not the loose `FROM portfolio.positions`. That way no other positions query in GetPortfolio or checkRiskLimits can use up the page-2 expectation under `MatchExpectationsInOrder(false)` (portfolio_quote_deadline_test.go:103). The spec names the exact substring.\n   - **(b) Account-scoped GetPortfolio (AC-3).**\n   - **(c) Page-2 WillReturnError** for GetPortfolio and GetPnL (AC-2).\n   - **(d) Guard tests.** The repeated-token case calls listAllPositions directly; the empty-page-with-token case runs GetPnL end to end.\n   - **(e) AC-5.**\n     - Uses recordLogs with installMetricReader, in non-parallel tests (D-11).\n     - Asserts the WARN messages, the `skipped_read_error` label, no InsertSnapshot, no broadcast, no concentration alert, and ExpectationsWereMet.\n   - **(f) AC-4.** Asserts `getLatestQuotesCalls <= 1` and `getLatestQuoteCalls == 0` (D-14).\n   - **(g) O-2 red test.**\n     - Page 1 succeeds and page 2 errors.\n     - GetAccountDrawdowns returns a row over `risk.max_drawdown_pct`.\n     - Asserts exactly one drawdown alert, no concentration alert, and no `risk` mark-source sample.\n\n5. **501-row dbtest (D-7 as amended by operator ruling (a')).** New file internal/service/position_drain_dbtest_test.go, `//go:build dbtest`, `package service`.\n   - **Pool.** A local `serviceTestPool(t)`:\n     - reads PORTFOLIO_DB_TEST_URL;\n     - calls t.Fatal when `CI == \"true\"`, otherwise t.Skip;\n     - parses with pgxpool.ParseConfig and sets `lock_timeout=500ms`;\n     - registers t.Cleanup(pool.Close).\n     - It carries a one-line constraint comment that points at its twin in internal/repository/dbtest_helpers_test.go:22-44, so a change to the skip/CI-fatal rule is made in both places (C-18 waiver).\n   - **Repo.** Built as `repository.NewPortfolioRepoWithDB(pool)` (portfolio_repo.go:50).\n     - The spec confirms that `*pgxpool.Pool` satisfies queryRower and that no service path in the drained readers calls `repo.Pool()`.\n     - If either check fails, the fallback is `NewPortfolioRepo(url)` with a t.Cleanup Close, which loses the lock_timeout.\n   - **Isolation.**\n     - The user-id prefix is unique to this service and must not start with `it-281-`, for example `it-357-` plus t.Name().\n     - Account ids are unique per test.\n     - t.Cleanup deletes only `portfolio.positions` rows matching that prefix. This avoids collisions with the repository-package dbtests running in parallel, whose testPool cleanup deletes `it-281-%` (dbtest_helpers_test.go:18,51-55), and with deletes keyed only on account_id (portfolio_repo.go:391).\n   - **Seeding.** 501 rows, plus a 3-row second account for AC-3, are seeded through the exported `(*PortfolioRepo).UpsertPosition` (portfolio_repo.go:62).\n   - **Service.** The PortfolioService literal sets the same fields as newQuoteSvc (portfolio_quote_deadline_test.go:105-110): `marketdata` (stubMarketData, which must also answer BatchGetBars), `ledger` (for GetPnL's collectFills) and `subs`.\n   - **Assertions.**\n     - GetPnL and GetPortfolio count all 501 rows.\n     - The AC-3 case runs on the offline-valuation path (portfolio_service.go:819-825, offline_valuation.go:112-147), so it asserts position count and account ids, not equity.\n   - **CI.** Edit only the portfolio step at .github/workflows/ci.yml:1065 (working-directory services/xstockstrat-portfolio, :1060) to `go test -tags dbtest -race -count=1 ./internal/repository/... ./internal/service/...`. The step at :1116 is the marketdata job (:1111) and is not touched.\n\n6. **D-9 gate.** A dev smoke test with at least 501 symbols for GetPnL and GetPortfolio.\n   - Pass condition: no Unavailable, and `marketdata_fetch{op=quotes}` reports ok.\n   - If it fails, fall back to per-page enrichment and relax the AC-4 test to at most 2 calls.\n\n7. **design.md disclosures.**\n   - Totals, P&L and open_positions change for users with more than 500 positions, and they may see new concentration alerts.\n   - Cross-page read skew is accepted (D-8).\n   - The fill hot path costs more: each fill runs two drains and two large quote batches (D-13).\n   - A page error no longer suppresses drawdown alerts (O-2).\n\n8. **C-16 promotion.**\n   - Promote the AC scenarios to services/xstockstrat-portfolio/acceptance/.\n   - Add a new scenario tagged `@feature-357`: \"a position-read failure skips concentration but drawdown still alerts\".\n   - context.md records that `@AC-9 @feature-231` is EXTENDED, not CHANGED, under the operator's 2026-11-17 sign-off.\n   - The spec reads the PORTFOLIO-14 and PORTFOLIO-16 invariants.",
    "open_objections": [
      {
        "text": "Step 5 of the r3 proposal edits ci.yml:1116, but that is the marketdata dbtest step (working-directory services/xstockstrat-marketdata, ci.yml:1111). Only ci.yml:1065 is portfolio (ci.yml:1060). The proposal must edit :1065 alone and remove :1116 from Touchpoints and Key Decisions. The synthesis approach already does this; the objection closes when the proposer adopts it.",
        "blocking": true
      },
      {
        "text": "Dbtest isolation: the service dbtest shares the database with the repository-package dbtests, and go test runs the two packages in parallel. testPool cleanup deletes user_id LIKE 'it-281-%' (dbtest_helpers_test.go:18,51-55), and account-keyed deletes are cross-user (portfolio_repo.go:391). The spec must pin a service-unique user prefix that does not start with it-281-, use per-test unique account ids, and clean up by prefix only.",
        "blocking": false
      },
      {
        "text": "Dbtest wiring is underspecified on three points. The spec must settle each:\n- Which repo constructor to use. NewPortfolioRepo opens its own pool; NewPortfolioRepoWithDB gives a nil Pool() (portfolio_repo.go:38-50).\n- Which PortfolioService fields to set: marketdata, ledger and subs, as in portfolio_quote_deadline_test.go:105-110.\n- How the AC-3 offline path is handled. stubMarketData must answer BatchGetBars, and the test asserts count and account ids, not equity (portfolio_service.go:819-825, offline_valuation.go:112-147).",
        "blocking": false
      },
      {
        "text": "Unordered pgxmock matching (MatchExpectationsInOrder(false), portfolio_quote_deadline_test.go:103) lets another positions query whose SQL matches the loose 'FROM portfolio.positions' regex use up the pinned page-2 expectation. Fix: anchor the regex to the ListPositions SELECT shape, or use ordered matching in portfolio_position_drain_test.go.",
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
        "kind": "EXTEND",
        "covered_by_operator_decision": true
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
      "Repo-level ListAllPositions drain (R-1, locked).",
      "A single unpaged repo query (R-2, locked).",
      "Reusing db_error for a snapshot read failure (R-3, locked).",
      "anyArgs for the page-2 expectation (R-4, locked).",
      "An ErrPositionsUnavailable sentinel (R-5, locked).",
      "Draining once per fill and sharing the slice (R-6, locked).",
      "Moving seedPosition/testPool to a shared package (R-7, locked).",
      "Copying seedPosition into the service package (R-8, locked).",
      "Editing the marketdata dbtest step at ci.yml:1116. It belongs to xstockstrat-marketdata (ci.yml:1111) and is outside the operator's portfolio-only scope.",
      "A dbtest that uses only NewPortfolioRepo(PORTFOLIO_DB_TEST_URL), with no local pool. It drops lock_timeout=500ms, so a lock wait would hang instead of failing fast, and the operator's (a') ruling specifies a minimal local pool. It is kept only as the fallback if *pgxpool.Pool does not satisfy queryRower.",
      "Option (c), a repository-package oracle plus pgxmock-only service tests. The operator declined it in favour of (a'), and it does not exercise the service drain on a real database."
    ],
    "open_risks": [
      "A single GetLatestQuotes batch of 501 or more symbols may exceed batch_timeout_ms (2500) inside quote_timeout_ms (4000), or hit an unverified vendor cap. The D-9 smoke test is the guard, and per-page enrichment is the fallback.",
      "Cross-page read skew across N non-transactional statements (D-8). This is disclosed, not mitigated.",
      "The serialized fill consumer slows down for users with more than 500 positions, because each fill runs two drains and two large quote batches (D-13).",
      "Drain memory grows linearly with the number of positions. Only the repeated-token and empty-page guards stop a pathological loop.",
      "Parallel package runs against a shared dbtest database can flake if the spec does not pin a unique prefix and unique account ids.",
      "NewPortfolioRepoWithDB(pool) assumes *pgxpool.Pool satisfies queryRower and that the drained readers never call repo.Pool(). The spec must verify both.",
      "After deploy, users with more than 500 positions see different totals and P&L and may see new concentration alerts. The release notes must say so.",
      "The PORTFOLIO-14 and PORTFOLIO-16 invariants have not been read yet. The spec must check them."
    ],
    "constitution_rules_touched": [
      "C-01",
      "C-08",
      "C-11",
      "C-13",
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
    "rationale": "I checked the adversary's blocking claim against the worktree. ci.yml:1060 sets working-directory services/xstockstrat-portfolio with the step run at :1065. ci.yml:1111 sets working-directory services/xstockstrat-marketdata with the step run at :1116. So step 5 of the proposal would edit marketdata CI, which the operator scope (portfolio only) and CLAUDE.md rule 3 forbid. The synthesis approach corrects this to edit only :1065. Following the round-2 precedent for O-1, the objection stays blocking-open until the proposer adopts the correction.\n\nI also confirmed several other points in the code:\n- NewPortfolioRepo opens its own pool, and NewPortfolioRepoWithDB leaves Pool() nil (portfolio_repo.go:38-50).\n- testPool cleans up by the it-281- prefix (dbtest_helpers_test.go:18,51-55).\n- newQuoteSvc sets MatchExpectationsInOrder(false) (portfolio_quote_deadline_test.go:103).\n\nThose findings support the adversary's non-blocking collision, wiring and regex objections. The approach answers each one concretely:\n- a service-unique prefix and unique account ids;\n- NewPortfolioRepoWithDB(pool), which keeps lock_timeout, with NewPortfolioRepo as the fallback;\n- the field list from newQuoteSvc;\n- AC-3 assertions on count and account ids;\n- an anchored ListPositions regex.\nThey stay open because the proposal itself does not yet answer them.\n\nUnder the operator steer, the following objections close:\n- **O-1:** the corrected TRADING_MODE_PAPER pin from rows[499] is adopted.\n- **O-2:** sign-off is recorded, observeQuotePass sits in the success branch, the drawdown-after-page-2-failure red test is added, and a new @feature-357 scenario extends @AC-9 @feature-231.\n- **O-5:** the operator ruled (a').\n- **O-6:** the hot-path cost is disclosed per D-13.\n\nThe operator steer explicitly resolves the D-7 petition (P-1), so D-7 is listed as reopened and its amended form is recorded as a new decision. No other D-n is contradicted, no R-n is reintroduced, and no closed O-n is re-raised. @AC-9 @feature-231 is recorded as EXTEND under the operator's decision, not CHANGE.",
    "register_delta": {
      "new_decisions": [
        {
          "text": "D-7 amended per operator ruling (a'). The mandatory 501-row dbtest for GetPnL and GetPortfolio is a new internal/service/position_drain_dbtest_test.go (//go:build dbtest, package service). It seeds through the exported (*PortfolioRepo).UpsertPosition and opens a minimal local pool with the same PORTFOLIO_DB_TEST_URL skip/CI-fatal rule and lock_timeout as testPool. The CI change is limited to the portfolio dbtest step at ci.yml:1065, which gains ./internal/service/.... 353's dbtest_helpers_test.go is untouched.",
          "evidence": "Operator 2026-11-17 design gate r2; portfolio_repo.go:62; dbtest_helpers_test.go:22-44; ci.yml:1060,1065 (portfolio) vs ci.yml:1111,1116 (marketdata)"
        },
        {
          "text": "On a position-read failure, checkRiskLimits logs WARN 'concentration check skipped: position read failed' and falls through to the unchanged drawdown block. A red test proves a drawdown alert still fires after a page-2 failure. A new acceptance scenario tagged @feature-357 records that @AC-9 @feature-231 is EXTENDED.",
          "evidence": "Operator 2026-11-17 design gate r2 (O-2 approved); portfolio_service.go:1284-1286, :1303, :1312-1317"
        },
        {
          "text": "The ~15-line skip/CI-fatal/lock_timeout logic in serviceTestPool, duplicated from testPool, is accepted as a recorded C-18 waiver in context.md. It carries a one-line constraint comment that points at its twin in dbtest_helpers_test.go:22-44.",
          "evidence": "Operator ruling (a'); R-7/R-8 forbid moving or copying the helpers; adversary r3 C-18 note"
        }
      ],
      "new_rejected": [
        {
          "text": "Editing the marketdata dbtest CI step at ci.yml:1116 to add ./internal/service/...",
          "why": "The step belongs to xstockstrat-marketdata (ci.yml:1111). It is outside the operator's portfolio-only scope and violates 'touch only what the task requires'."
        },
        {
          "text": "A service dbtest using only NewPortfolioRepo(PORTFOLIO_DB_TEST_URL), with no local pool",
          "why": "It drops lock_timeout=500ms, so a lock wait hangs instead of failing fast, and the operator's (a') ruling specifies a minimal local pool. It is retained only as the fallback if *pgxpool.Pool does not satisfy queryRower."
        }
      ],
      "new_objections": [
        {
          "text": "Step 5 of the proposal edits ci.yml:1116, but that is the marketdata dbtest step (ci.yml:1111). Only ci.yml:1065 is portfolio (ci.yml:1060). Edit :1065 alone and remove :1116 from Touchpoints and Key Decisions.",
          "blocking": true
        },
        {
          "text": "Dbtest prefix and account collisions under parallel package runs. testPool deletes it-281-% (dbtest_helpers_test.go:18,51-55), and account-keyed deletes are cross-user (portfolio_repo.go:391). The spec must pin a service-unique prefix that does not start with it-281-, per-test unique account ids, and prefix-only cleanup.",
          "blocking": false
        },
        {
          "text": "Dbtest wiring is underspecified:\n- the repo constructor (NewPortfolioRepo vs NewPortfolioRepoWithDB, portfolio_repo.go:38-50);\n- the PortfolioService fields marketdata, ledger and subs (portfolio_quote_deadline_test.go:105-110);\n- the AC-3 offline path, which needs a BatchGetBars stub and an assertion on count and account ids, not equity (portfolio_service.go:819-825, offline_valuation.go:112-147).",
          "blocking": false
        },
        {
          "text": "Under MatchExpectationsInOrder(false) (portfolio_quote_deadline_test.go:103), the loose 'FROM portfolio.positions' regex can let another positions query use up the pinned page-2 expectation. Anchor the regex to the ListPositions SELECT shape, or use ordered matching.",
          "blocking": false
        }
      ],
      "closed_objections": [
        {
          "id": "O-1",
          "how": "The proposal adopts the corrected page-2 pin []string{rows[499].Symbol, \"TRADING_MODE_PAPER\", rows[499].AccountId} (D-10), keeps the repeated-token and empty-page guard tests, and the operator settled the D-7 dbtest form as (a')."
        },
        {
          "id": "O-2",
          "how": "The operator approved the fall-through on 2026-11-17. The design implements a WARN plus fall-through to drawdown with observeQuotePass in the success branch (D-12), adds the drawdown-after-page-2-failure red test (4g), and promotes a new scenario that extends @AC-9 @feature-231."
        },
        {
          "id": "O-5",
          "how": "The operator resolved the D-7 petition (P-1) as (a'): a service-package dbtest seeded via UpsertPosition, with a minimal local pool, and the portfolio CI dbtest package list extended."
        },
        {
          "id": "O-6",
          "how": "Step 7 of the proposal discloses the fill hot-path cost in design.md per D-13."
        }
      ],
      "reopen_petitions": [],
      "reopened": [
        "D-7"
      ]
    }
  },
  "floor_breaches": []
}
```

## Session 2026-11-17 — sdd-design

- Phase 0 Recon: wrote recon.md (services: xstockstrat-portfolio; key reuse patterns: the fail-closed ledger fill drain at portfolio_service.go:1118-1166, and the 353 `ListPositions` keyset cursor unchanged).
- Phase 1 Grilling: 3 rounds (full). Termination: approved. The operator approved at the round-3 gate "as synthesized": the CI edit is ci.yml:1065 (the portfolio db-test step) only.
  - Chosen approach: a private service-level `listAllPositions` drain with fail-closed guards. All four readers drain first, then enrich once.
    - `GetPortfolio` and `GetPnL` return Internal.
    - `broadcastSnapshot` logs WARN and records `skipped_read_error`.
    - `checkRiskLimits` logs WARN and falls through to drawdown.
    - Pgxmock red tests pin the page-2 cursor slot, and a 501-row service dbtest (D-15) covers the real database.
  - Rejected: R-1..R-10 (repo-level drain, unpaged query, `db_error` reuse, `anyArgs` page 2, new sentinel, shared per-fill slice, moving or copying 353's helpers, the marketdata ci.yml:1116 edit, the pool-less dbtest). The operator also declined option (c).
- Constitution rules touched: C-01, C-08, C-11, C-13, C-15, C-16, C-18, P-02, P-03, P-06, F-04, F-07, PLAT-N1. Floor breaches: none.
- C-18 waiver (D-17): `serviceTestPool` duplicates about 15 lines of skip/CI-fatal/lock_timeout logic from `testPool` (internal/repository/dbtest_helpers_test.go:22-44). It carries a one-line constraint comment that points at its twin.
- C-16:
  - `@AC-9 @feature-231` is EXTENDED, not CHANGED: a position-read failure skips concentration while drawdown still alerts. The operator signed off at the round-2 gate on 2026-11-17 ("O-2 approved").
  - A new `@feature-357` scenario is promoted at launch.
  - PRESERVE `@AC-1 @feature-178` and `@AC-1 @feature-353` (operator decisions 2026-11-17).
  - PRESERVE `@AC-3 @feature-231` and `@AC-8 @feature-231`.
  - EXTEND this feature's `@AC-1`..`@AC-5`.
- Register at approval:
  - debate.md State is approved and Rounds run is 3.
  - P-1 verdict is set to `user reopened`. The operator ruled (a') on the D-7 petition, so D-7 was reopened and amended as D-15. This reflects that ruling rather than "declined".
  - O-7..O-10 stay open in the register. The approved synthesis resolves all four, and each is carried below as a binding `/sdd-spec` obligation.
- Status: spec-ready → design-approved.

### Decisions

- D-1..D-6 and D-8..D-17 are settled (debate.md). D-15 supersedes D-7 in substance: the dbtest is a service-package file seeded via `UpsertPosition` with a local pool, and CI changes only at ci.yml:1065.
- O-2: on a position-read failure, `checkRiskLimits` falls through to the drawdown check. A red test (4g) proves a drawdown alert still fires after a page-2 failure.

### Open Threads

- [ ] D-9 smoke gate. A single `GetLatestQuotes` batch of 501 or more symbols may exceed `batch_timeout_ms` (2500) inside `quote_timeout_ms` (4000), or hit a vendor cap. Run a dev smoke test with at least 501 symbols for GetPnL and GetPortfolio. The fallback is per-page enrichment, with the AC-4 test relaxed to ≤2. Target: the spec's verification step.
- [ ] Cross-page read skew (D-8). Disclose it in the release notes. Target: the integration PR.
- [ ] Fill hot-path cost (D-13): two drains and two large quote batches per fill on the serialized consumer. Disclosed; no optimisation in scope. Target: the integration PR notes.
- [ ] Drain memory grows linearly with the number of positions; only the repeated-token and empty-page guards stop a runaway loop. Target: the drain-helper step.
- [ ] O-8 dbtest isolation. Use a service-unique prefix (e.g. `it-357-`, never `it-281-`), per-test unique account ids and prefix-only cleanup. Target: the dbtest step.
- [ ] O-9 dbtest wiring. Verify that `*pgxpool.Pool` satisfies `queryRower` and that no drained reader calls `repo.Pool()`; the fallback is `NewPortfolioRepo(url)`. Set the `marketdata` (which needs a `BatchGetBars` stub), `ledger` and `subs` fields. AC-3 asserts count and account ids, not equity. Target: the dbtest step.
- [ ] O-10. Anchor the ListPositions pgxmock regex to a substring unique to its SELECT; the spec names it. Target: the pgxmock test step.
- [ ] O-7. Edit only the CI portfolio db-test step at ci.yml:1065; ci.yml:1116 (marketdata) is not touched. Target: the CI step.
- [ ] Users with more than 500 positions see different totals and P&L, and may see new concentration alerts. Target: the integration PR release notes.
- [ ] Read the PORTFOLIO-14 and PORTFOLIO-16 invariants. Target: `/sdd-spec`.

## Session 2026-11-17 — sdd-spec

- Generated implementation-spec.md with 9 steps. Status: design-approved → implementation-ready.
- The steps form three red→green atomic units:
  - Unit A, Steps 1–3: pgxmock RPC-reader tests, the 501-row service dbtest plus the ci.yml:1065 edit, and `listAllPositions` with the GetPortfolio/GetPnL switch.
  - Unit B, Steps 4–5: the repeated-token RED test, then the guards.
  - Unit C, Steps 6–7: background-reader tests, then broadcastSnapshot/checkRiskLimits plus the service CLAUDE.md Observability update.
- Two docs steps follow: Step 8 promotes the scenarios (C-16), and Step 9 runs the D-9 dev smoke gate, a numbered step with a recorded result per fails.md:3305-3307.
- `acceptance.feature`: appended `@AC-6 @FR-5` "A position-read failure skips concentration but drawdown still alerts". This is design.md's new `@feature-357` scenario (O-2, the EXTEND of `@AC-9 @feature-231`), added append-only so Step 6's 4g test has a Covers target.
- Key codebase findings:
  - **O-10 anchor.** `cardinality($n::text[])` appears only in the ListPositions SQL (portfolio_repo.go:167). The precedent regex is `(?s)cardinality\(\$\d+::text\[\]\)` (portfolio_repo_test.go:279).
  - **Arg shape.** PAPER with no account binds 4 args, cursor at index 2. PAPER plus an account binds 5 args, cursor at index 3. The page-2 cursor is `[]string{rows[499].Symbol, "TRADING_MODE_PAPER", rows[499].AccountId}` (portfolio_repo.go:166-168, :193-196).
  - **InsertSnapshot.** `open_positions` is arg index 5 (portfolio_repo.go:231-236).
  - **O-9 resolved.** `*pgxpool.Pool` satisfies `queryRower` (portfolio_repo.go:20-21, :46). The only non-test `repo.Pool()` call is in `NewPortfolioService` (portfolio_service.go:162), so `NewPortfolioRepoWithDB(pool)` works for the dbtest and the R-10 fallback is not needed.
  - **O-7.** The portfolio db-test `run:` line is ci.yml:1065; ci.yml:1116 is marketdata and is untouched.
  - **PORTFOLIO-14/16 read.** The drain runs after `positionsMu` is released (portfolio_service.go:481-485) and only reads `positions`, so it is not a new writer. `latestQuotesFor` stays the single quote-fetch site, one batch per reader invocation.
  - **Existing pgxmock tests.** They return at most one row per positions query, so a single page with no token stays green. The `TestProcessOrderFill_*` error tests (portfolio_fill_errors_test.go:67-110) now reach `GetAccountDrawdowns` on a page error; it is unexpected, it errors and it is skipped (`if err == nil`, portfolio_service.go:1313), so no nil-notify dereference occurs.

### Decisions

- **Guards in their own unit.** The guards land in Steps 4–5, separate from the drain in Step 3. A test that calls `listAllPositions` directly (design 4(d)) cannot compile before the helper exists, and a guard test written after the guard cannot go RED. Splitting the units gives a behavioural RED: the drain without a guard reaches a third, unexpected pgxmock call, so the `"repeated page token"` assertion fails.
- **No Exec-mode subtest.** The service dbtest has none. Feature 353's repository dbtest already proves the `$n::text[]` bind under `QueryExecModeExec` (list_positions_dbtest_test.go:24), and this fix adds no bind (insights.md:4626-4628). This follows design's minimal `serviceTestPool`.
- **Isolation.** The dbtest prefix is `it-357-`. Account ids are derived from the per-test user id, and cleanup deletes by prefix only (O-8).

### Open Threads

- [ ] **Escalation (P-03): the empty-page-with-a-token guard is unreachable through the concrete repo.** `ListPositions` emits a token only when `len(positions) > pageSize` (portfolio_repo.go:193-197), so design 4(d)'s "empty page with a token via GetPnL end to end" test cannot be built. There is no repo seam, and R-1/C-18 rule out adding one.
  - The spec ships the guard untested as defense in depth (design D-3, mirroring `collectFills` :1125-1127) and marks the test **Not found** (Step 4).
  - The operator may instead drop the guard at `/sdd-review impl-spec`. Decide before `/sdd-execute` Step 5.
- [ ] D-9 smoke (Step 9) runs after the integration merge to main-dev and before `/promote`. On failure: per-page enrichment plus re-aggregation, and relax AC-4 to `<= 2`.
- [ ] The release notes at the integration PR must cover: totals and P&L change for users with more than 500 positions, new concentration alerts, cross-page skew (D-8), fill hot-path cost (D-13), and drawdown no longer suppressed by a page error (O-2).
