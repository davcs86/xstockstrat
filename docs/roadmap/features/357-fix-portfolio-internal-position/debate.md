# Debate Register: fix-portfolio-internal-position

**State**: in-debate
**Mode**: full
**Rounds run**: 2 (round numbers continue across runs; the mode's 2–5 / 1 bounds count this run only)

## Rounds

| Round | Date | Run by | +D | +R | O closed | +O | Petitions | Progress |
|---|---|---|---|---|---|---|---|---|
| 1 | 2026-11-17 | /sdd-batch | 9 | 5 | 0 | 4 | 0 | yes |
| 2 | 2026-11-17 | /sdd-batch | 5 | 3 | 2 | 2 | 1 | yes |

## Settled Decisions

<!-- Status: settled → superseded by D-m (only after a user-approved REOPEN) -->
| ID | Round | Decision | Evidence | Status |
|---|---|---|---|---|
| D-1 | 1 | The position drain is a private service-level helper listAllPositions in portfolio_service.go, next to collectFills. The repo ListPositions, SQL and cursor codec are unchanged. | portfolio_repo.go:136-206 (353 page primitive, fenced by operator); portfolio_service.go:1111-1168 (existing fail-closed drain policy lives in service) | settled |
| D-2 | 1 | Each reader drains all pages first, then enriches once over the full set: one GetLatestQuotes batch per invocation. | portfolio_service.go:506-513 latestQuotesFor; :1293-1300 and :1222-1225 need the whole set; @AC-1 @feature-178 preserved | settled |
| D-3 | 1 | The drain fails closed on a page error (wrapped), on an empty page that carries a token, and on a repeated token. It has no page cap and no repeated-row guard. | portfolio_service.go:1124-1126, :1163-1165; keyset strictly increasing portfolio_repo.go:167; fails.md:3310-3312 | settled |
| D-4 | 1 | A page error from GetPortfolio or GetPnL passes through and maps to Internal, as today. The asymmetry with GetPnL's ledger Unavailable mapping is recorded as deliberate and pre-existing. | portfolio_handler.go:89-92, :435-449 (ErrLedgerUnavailable at :443) | settled |
| D-5 | 1 | A broadcastSnapshot position-read failure logs WARN and records the new outcome label skipped_read_error. Nothing is inserted, emitted or broadcast. The service CLAUDE.md Observability section is updated in the same PR. | portfolio_service.go:1224 (skipped_unpriced precedent), :1238-1246 (db_error path still emits/broadcasts); telemetry/otel.go:347 | settled |
| D-6 | 1 | The drain page size is a service-local const positionDrainPageSize = 500, with a constraint comment tying it to the repo cap. | portfolio_repo.go:137-138 (>500 becomes 100) | settled |
| D-7 | 1 | Test discipline: the page-2 pgxmock expectation pins the $n::text[] cursor slot exactly, with the same arg count as page 1; repeated-token and empty-page-with-token guard tests are required; the 501-row dbtest via seedPosition/testPool is mandatory for GetPnL and GetPortfolio. | fails.md:3310-3312; insights.md:4626-4628; portfolio_repo.go:166-168; dbtest_helpers_test.go:22,66; list_positions_dbtest_test.go:62 | settled |
| D-8 | 1 | design.md must disclose the cross-page read skew from N non-transactional statements as an accepted behavior delta, with no transaction added. | insights.md:179-189; adversary r1 consistency objection | settled |
| D-9 | 1 | A dev smoke test with at least 501 symbols for GetPnL and GetPortfolio is a mandatory spec verification item; enriching per page is only the fallback if it fails. | quotes.batch_timeout_ms 2500 inside quote_timeout_ms 4000; GetPnL all-or-nothing portfolio_service.go:938-940; fails.md:2844 | settled |
| D-10 | 2 | The page-2 pgxmock cursor slot is pinned to []string{rows[pageSize-1].Symbol, "TRADING_MODE_PAPER", rows[pageSize-1].AccountId}, the raw trading_mode column string from the 500th row, not the probe row. | portfolio_repo.go:152 (mode.String()), :200-203 (encodePositionCursor on positions[pageSize-1]); portfolio_fill_errors_test.go:52 fixture mode | settled |
| D-11 | 2 | AC-5 log and outcome-label assertions use recordLogs together with installMetricReader, in non-parallel tests. | portfolio_telemetry_test.go:39, :152-158, :532-533 (already used together in one test) | settled |
| D-12 | 2 | In the checkRiskLimits success branch, the quote fetch, applyQuotes, observeQuotePass(...,"risk") and the concentration loop run only after a successful drain. A failed read never counts as a mark-source pass. | portfolio_service.go:1287-1300, :1292-1294 | settled |
| D-13 | 2 | design.md discloses the fill hot-path cost as an accepted delta: for users with more than 500 positions, each fill runs two drains and two large quote batches on the serialized consumer. | portfolio_service.go:484-485; PORTFOLIO-14 serialized consumer (adversary r2) | settled |
| D-14 | 2 | The AC-4 test asserts at most 1 GetLatestQuotes call, stricter than the scenario's 'at most 2'. A D-9 per-page fallback must relax the test to at most 2 rather than break it. | portfolio_service_test.go:19,84,106; D-2, D-9 | settled |

## Rejected Alternatives (locked)

<!-- Status: locked → reopened @ round N (user, context.md <ISO>) -->
| ID | Round | Alternative | Why rejected | Status |
|---|---|---|---|---|
| R-1 | 1 | Repo-level ListAllPositions drain | Edits 353's portfolio_repo.go (operator fence); failure policy belongs to the caller; no testing advantage | locked |
| R-2 | 1 | Single unpaged internal repo query | Adds a second SQL shape and scan path in 353's file, and drops reuse of the proven cursor | locked |
| R-3 | 1 | Reusing db_error for a snapshot read failure | Merges an insert failure that still emits/broadcasts with a read failure that emits nothing | locked |
| R-4 | 1 | anyArgs for the page-2 mock expectation | Cannot detect a helper that fails to forward the token (fails.md:3310-3312) | locked |
| R-5 | 1 | A new ErrPositionsUnavailable sentinel mapped to Unavailable | YAGNI: a page-1 error is Internal today; follow-up only | locked |
| R-6 | 2 | Draining once per fill and sharing the slice between checkRiskLimits and broadcastSnapshot | Changes both signatures and the fill-path wiring, which is beyond the four-reader bug-fix scope (C-18 YAGNI); disclosed instead | locked |
| R-7 | 2 | Moving seedPosition/testPool into an exported shared test package | Edits feature 353's dbtest_helpers_test.go, breaching the operator fence | locked |
| R-8 | 2 | Copying seedPosition verbatim into the service package | C-18/DRY duplicate; the exported repo.UpsertPosition (portfolio_repo.go:62) seeds rows without copying | locked |

## Objections

<!-- Status: open → closed @ round N (<how>) | waived @ round N (user) | reopened @ round N (user) -->
| ID | Round | Objection | Blocking | Status |
|---|---|---|---|---|
| O-1 | 1 | Token forwarding is not proven by the tests. Must pin the page-2 cursor arg, add the repeated-token and empty-page guard tests, and make the 501-row dbtest mandatory. | yes | open |
| O-2 | 1 | The checkRiskLimits drawdown fall-through after a page error is an @AC-9 @feature-231 behavior change. It needs operator sign-off and, if approved, a new scenario plus a red test. | no | open |
| O-3 | 1 | The AC-5 log clause has no assertion mechanism; a slog-capture approach must be specified (C-01). | no | closed @ round 2 (The log assertion uses the existing recordLogs (portfolio_telemetry_test.go:152-158), proven alongside installMetricReader at :532-533, and asserts the exact WARN messages with an error attr. No new capture helper.) |
| O-4 | 1 | The large GetLatestQuotes batch is unverified against the timeout budget and vendor limits; it needs a dev smoke test as a spec verification item (P-03). | no | closed @ round 2 (Turned into a mandatory spec verification gate (D-9) with an explicit pass condition: no Unavailable and marketdata_fetch{op=quotes} outcome ok for at least 501 symbols. Failing it triggers the per-page enrichment fallback.) |
| O-5 | 2 | REOPEN D-7 petition pending an operator ruling: the service-level 501-row dbtest cannot use the package-repository seedPosition/testPool, and CI dbtest covers only ./internal/repository/... The operator chooses (a') a service dbtest seeded via UpsertPosition plus a CI package-list edit, or (c) a repository-package oracle plus pgxmock service tests with the cursor pinned. | yes | open |
| O-6 | 2 | Fill hot-path cost (two drains and two large quote batches per fill on the serialized consumer) must be disclosed in design.md alongside D-8. | no | open |

## Reopen Petitions

<!-- Verdict: dropped (evidence not new — already on record at <ID>) | pending user | user reopened | user declined -->
| ID | Round | Target | New evidence | Verdict |
|---|---|---|---|---|
| P-1 | 2 | D-7 | seedPosition/testPool are package-repository _test.go symbols under //go:build dbtest (internal/repository/dbtest_helpers_test.go:1-3,22,66), with no dbtest file in internal/service. CI runs go test -tags dbtest only on ./internal/repository/... (.github/workflows/ci.yml:1065,1116). D-7's recorded evidence cites only the helper line numbers, not the package or the CI scope. | pending user |
