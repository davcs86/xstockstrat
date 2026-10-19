# Context Log: fix-after-hours-positions-priced

Append-only. Each session appends a new ## Session entry. Never delete or edit prior entries.

---

## Session 2026-10-19 (/sdd-triage)

- Found during the feature 229 post-merge staging investigation, then recorded as defect report
  `docs/reports/2026-10-19-after-hours-one-sided-quote-half-price-defect.md`. Issues are disabled.
- Severity: SEV-2 (operator-confirmed). Routed to SDD path (Track C) by operator choice. Environment:
  staging; production runs the same code.
- Created: feature.md, product-spec.md, acceptance.feature (regression scenarios AC-1..4), context.md.
- Affected services: xstockstrat-portfolio, xstockstrat-marketdata.
- Root cause hypothesis: one-sided after-hours quote averaged as `(ask + bid) / 2` at 5 sites. This is not a
  regression from feature 229: the formula has been present since at least `6d06894`.
- Recommended design depth: full → `/sdd-design fix-after-hours-positions-priced` (rationale: 2 affected
  services; the fallback-price choice and a possible `Quote` proto field are design forks).
- NNN: 230 is claimed by two in-flight branches (`230-fix-etf-flag-fill`, `230-offline-account-full-pnl`),
  so this feature takes 231. That existing 230 collision is not this feature's to resolve.
- Branch: triage committed on harness-assigned `ccr-9f55a8ac-dtw4iv`, off `main-dev` (as feature 229 did).

## Session 2026-10-19 — sdd-review product-spec

- Product spec approved: PASS WITH WARNINGS, no blockers, no Floor breach. Status: draft → spec-ready.
- Warnings (carried into /sdd-design; resolve in design and acceptance.feature):
  - [ ] W1 C-15: every `Then` is a negative "is never <halved>". Rewrite to one positive expected value once the rule is chosen.
  - [ ] W2 P-03/C-18: "usable price" fork is unresolved. Reuse candidate: `trading.go:3160-3168`
        (both sides > 0 → mid; else the positive side; else FailedPrecondition).
  - [ ] W3: AC-2 is not observable from aggregate equity unless LYFT is the only position. Cover the
        snapshot-skipped outcome (`portfolio_service.go:847`).
  - [ ] W4: AC-3 asserts internal `posValues`. Restate as the emitted concentration alert or % (`:916-921`).
  - [ ] W5: AC-4 Given lacks `marketdata.fundamentals.snapshot_source=edgar` and the filed-date-close fallback (`marketdata_service.go:1726,1753-1756`).
  - [ ] W6 C-10(b): name `GetPnL` (`:652`) and `ListPortfolios` (`:1341`) as affected read paths; add parity.
  - [ ] W7: proto item unchecked. `GetLatestPrice`/`BatchGetLatestPrice` already carry `last_price` (`marketdata.proto:26,54,108`).
  - [ ] W8 C-14: no Consumer Surface(s) line; declare MCP `get_positions` / Book → Portfolio read-only.
- Overlap findings: none blocking.
  - `230-fix-etf-flag-fill` (feature/fix-etf-flag-fill, draft, docs-only).
  - `230-offline-account-full-pnl` (ccr-cd56ff4d-s5wkbb, draft, docs-only). Its scope (offline marks,
    "no live quote marks at 0") will touch the same portfolio valuation functions. Soft ordering note:
    whichever lands second reconciles.
- Test constraint: `portfolio_service_test.go:48` asserts CurrentPrice is the byte-identical `(Ask+Bid)/2`
  (PR #735 parity guard). Update it deliberately.

## Session 2026-10-19 — sdd-design (full), in progress

- Phase 0: recon.md written (commit 0e6e4e68).
- Round 1 proposer: two-sided mid → live last trade via portfolio `BatchGetLatestPrice` → unpriced.
- Round 1 adversary: NEEDS WORK, no Floor breach. The last-trade mechanism is rejected:
  - two detached 2.5s budgets inside 229's 4s deadline;
  - an unbounded prev-close scan on every `BatchGetLatestPrice`;
  - serial per-symbol live calls inside `GetFundamentalsMulti` (the 227 hang class);
  - a live Alpaca call on every after-hours read.
- Staging evidence, 2026-10-19 after the close. The lone quote side (×2) is stale, but the stored 1d bar close is
  correct. This rules out trading's positive-side rule for valuation:

  | Symbol | Lone side ×2 | Stored 1d close | Real price |
  |---|---|---|---|
  | LYFT | 16.05 | 16.98 | broker 16.98 |
  | ICE | 141.45 | 158.32 | — |
  | MSFT | 501.41 | 533.645 | — |
  | ELWT | — | 5.48 (10-16, illiquid) | — |

- Carried objections (round 2 must address):
  - skip snapshot and concentration when ANY position is unpriced;
  - snapshot and risk use the broker CurrentPrice where present (C-10(b), fails.md:38-41);
  - required purge of the poisoned edgar cache rows;
  - staleness bound on the fallback;
  - AC-3 asserts the full alert set; AC-1 states cost basis;
  - `StartSnapshotWriter` (`:813`) is dead code → findings entry.
- Operator steer (round 1 gate): compute the mark in marketdata. Additive `optional double mark_price` on `Quote`
  (field 8), filled by GetLatestQuotes as two-sided mid, else the latest stored 1d close (one bounded query);
  livePrice reuses it in-process. This accepts a proto change (C-09, 2-owner approval).
- Round 2 proposer: marketdata computes `Quote.mark_price` (field 8) on read from the two-sided mid, else the
  latest stored 1d close within 168h. One bounded LATERAL query, 500ms sub-budget, cloned quotes. Portfolio
  `markOf`; snapshot and risk use `unvaluedSymbols` with broker price first; any unpriced position → skip.
  EDGAR purge required; run it after the deploy.
- Round 2 adversary: NEEDS WORK. Floor: conditional F-07 on the 500ms constant. Resolutions agreed:
  - portfolio `markOf` = mark_price if present, else two-sided mid, else unpriced. Deploy order and rollback
    become safe: `deploy.yml:204` updates both components in one `doctl apps update`, so ordering cannot be
    enforced.
  - run the close lookup concurrently with the cold singleflight, so the bound is W + max(B, C); add a budget test.
  - prefetch quotes and marks once per `GetFundamentalsMulti` edgar call (the serial loop is
    `marketdata_service.go:1506-1512`); run the purge during market hours.
  - scope the proto comment to "populated only by GetLatestQuotes".
  - use a separate named staleness bound, not `latest_lookback_hours`.
  - change posValues `=` → `+=` (`portfolio_service.go:910`).
  - document the weekend first-query gap and `adjustment=all` as accepted risks.
  - recon correction: `packages/proto/pnl/pnl.go` is an existing hand-written shared carve-out.
- Operator decisions (round 2 gate):
  - (1) new config key `marketdata.quotes.mark_timeout_ms` (default 500, SetConfig-bounded), which resolves F-07;
  - (2) concentration: skip + WARN naming the unpriced symbols, accepting that a permanently unpriceable holding
    disables the check for that user;
  - (3) run round 3.
- Round 3 proposer: concurrent per-caller close lookup (W + max(B, C)); `markOf` with mid fallback; EDGAR
  resolve/finish split with a pending-only Multi prefetch; staleness as a code invariant (168h).
- Round 3 adversary: APPROVE WITH CONDITIONS. Floor: F-07 on the hardcoded 168h (a policy value; 071 precedent).
  Cured by the config key `marketdata.quotes.mark_close_max_age_hours` (168, bounds [120,720]; the 120 floor
  exists because 1d bars are stamped 00:00 ET, so Friday's bar is ~92h old by Monday evening).
- Conditions folded into design.md / acceptance.feature:
  - AC-6 uses a synthetic close aged 200h. The real ELWT 10-16 bar is ~90h old on Monday, so it would be priced.
  - AC-12 uses a handshake concurrency proof plus a 100ms-budget timeout proof (< 1s); no 650ms wall-clock bound.
  - AC-7 is stated as `since` argument pins plus SQL-text pins (the repo tests use pgxmock only).
  - AC-5 / AC-11 compare floats with a tolerance.
  - The close-lookup goroutine uses a buffered (cap 1) channel that is always received; the WARN notes whether
    ctx was already done.
  - `edgarFinish` does not upsert when `live == nil` (fails.md:2289).
  - AC-10 is reworded for the pending-only prefetch. This is an accepted refinement of the operator binding
    "prefetch once per call": cache hits need no price.
  - AC-2 states the MSFT broker market_value of 1067.30 explicitly.
- Operator approval @ 2026-10-19:
  - design approved with conditions;
  - C-16 CHANGE `@AC-1 @feature-178` accepted: batched equals serial now holds for two-sided quotes only;
  - snapshot-skip consequence accepted: any unpriced position skips that user's per-fill snapshot, and a
    permanently unpriceable holding stops them until it is priced.
- Artifacts:
  - design.md written;
  - acceptance.feature rewritten (AC-1..AC-14, @FR-1..@FR-7);
  - product-spec.md gained FRs, Consumer Surface(s), Fix Scope and Affected Services (+ config, proto);
  - recon.md corrected (`packages/proto/pnl/pnl.go`).
- sdd-review warnings W1–W8: [x] all resolved by the rewrite above.
- Constitution rules touched: C-05, C-08/P-06, C-09, C-10(b), C-13, C-14, C-15, C-16, C-18, P-03, F-01, F-06, F-07.
  Floor breaches: F-07 (168h const), resolved by the config key.
- Status: spec-ready → design-approved.

## Open Threads (from design.md Open Risks)
- [ ] Freshness of the stored close right after 16:00; staging check after the close → rollout step
- [ ] Weekend first-query gap (48h minIngestLookback, in-memory warm set) → AC-7 no-close row + docs step
- [ ] Permanently unpriceable holding stops snapshots and concentration (operator-accepted) → docs step
- [ ] `adjustment=all` back-adjusted prior close on ex-dates → docs step
- [ ] IEX daily-bar extended-hours inclusion unverified → findings + staging check
- [ ] Extra pooled query after hours (fails safe to unpriced + WARN) → monitor after deploy
- [ ] Two quote fetches per fill (pre-existing, optional) → out of scope
- [ ] Overlap with 230-offline-account-full-pnl → whichever lands second reconciles
- [ ] Operator EDGAR purge after the marketdata deploy, during market hours; record counts → rollout step

## Session 2026-10-19 — sdd-review product-spec (re-run after design, operator-requested)

- Result: PASS WITH WARNINGS, no blockers, no Floor breach. Status unchanged (design-approved).
- Earlier warnings W1–W8 confirmed resolved.
- Overlap re-scan: CLEAN. Quote field 8 is free; both `marketdata.quotes.mark_*` keys are new; 229 and 215 code is
  already on trunk, so this is a rebase only.
- Warnings addressed in this session:
  - [x] R1: AC-1 states `avg_entry_price` 15.00. GetPnL uses `(CurrentPrice − AvgEntryPrice) × Qty` (`portfolio_service.go:658`).
  - [x] R2: AC-7 is now an observable 167h / 169h / absent boundary outline. The `since == now − maxAge`
        argument pin moves to the impl-spec test detail.
  - [x] R3: AC-9 holdings are inlined, and drawdown sits on broker-synced `brk-1`. `GetAccountDrawdowns` reads only
        `account_balances` (`portfolio_repo.go:411-415`), and offline accounts have no row.
  - [x] R4: AC-10 is concrete: edgar enabled, LYFT 16.98, MSFT 533.65.
  - [x] R5: AC-12 is split into AC-12 (concurrency, observable mark 16.98) and new AC-15 (100ms budget, under 1s).
        The handshake / 5s-guard mechanics live in the impl-spec.
  - [x] R6: AC-4 asserts the edgar cache row is written or not written. The 200h row is not written (fails.md:2289).
  - [x] R7: stale "Design should confirm…" paragraph replaced with a pointer to design.md.
  - [x] R8: Out of Scope now lists: trading sizing; serial GetLatestQuote / stream computing no mark (178 CHANGE);
        no repair of `fundamentals_history` or emitted signals; the two per-fill fetches.
  - [x] R9: approval gates noted in Fix Scope (config: owner + config team; proto: Proto Reviewer + owners).
  - [x] R10: AC-13 is extended to GetPosition and GetPortfolio.
- Note: AC-14 row 2 (16.05/0 with no mark → 0) is RED on current code, which yields 8.025. That makes it a real
  regression guard.

## Session 2026-10-19 — sdd-spec

- Generated implementation-spec.md with 13 steps. Status: design-approved → implementation-ready.
- Step order (inside-out, the 229 pattern):
  - config bounds (1–2);
  - proto `Quote.mark_price = 8` + buf-gen (3–4);
  - marketdata repo `GetLatestDailyClosesBatch` (5–6);
  - `GetLatestQuotes` mark merge (7–8);
  - EDGAR resolve/finish + Multi prefetch (9–10);
  - portfolio `markOf` + broker-first snapshot/risk (11–12);
  - docs + context-forge teardown (13).
- Key codebase findings:
  - Evidence baseline: merge-base `cd1654cc`. Service code is identical to `origin/main-dev` @ `f8ef9ab9`; only the
    per-service `docs/context-constitution*.md` moved (`1302e6d0`). Rebase before Step 13.
  - `SCALAR_BOUNDS_REGISTRY` ends at `configServiceImpl.ts:139-140`. `TIMEOUT_KEY_FORMS` is
    `setConfigScalarBounds.test.ts:259-276`.
  - `Quote` is `marketdata.proto:91-99`, and field 8 is free.
  - `buf` is not on this session's PATH, so Step 4 may need `docs/runbooks/codegen-toolchain-host-setup.md`.
  - Marketdata seams to copy:
    - `prevClose` nil-safe wiring `marketdata_service.go:218-222`;
    - `latestQuotesBatchSQL` LATERAL + `QueryExecModeExec` `marketdata_repo.go:313-359`;
    - `GetPreviousDailyCloseBatch` (`:449-482`) is unbounded and returns the second-newest close, so it is not reused.
  - `checkRiskLimits` needs a non-nil `*config.Watcher`; the zero value `&config.Watcher{}` is safe (precedent
    `portfolio_fill_sync_race_test.go:65`).
  - Portfolio tests have no notify fake (Not found), so Step 12 creates an inline `recordingNotify`.
  - No `internal/testdata/` exists in marketdata or portfolio. Per design C-13, Steps 6/12 create one each (trading
    precedent `internal/testdata/order_rows.go`).
  - Consumer surface: the MCP fundamentals tool is `query_fundamentals` (`tools.py:402`), not "get_fundamentals"
    (that is the client function). grep finds no UI/agent caller of `GetPnL`. Both are wording flags for impl-spec
    review, non-blocking.
- Spec-level choices flagged for `/sdd-review impl-spec`:
  - `withMark` pure helper;
  - `resolveMarkCloseMaxAge` name;
  - `edgarResolve` / `edgarFinish` signatures;
  - Multi phase-1 resolves all symbols before any upsert (an aborting batch writes no cache rows; response unchanged).

## Session 2026-10-19 — sdd-review impl-spec (advisory)

- Result: 1 blocker (B1), 7 warnings, 7 notes. Overlap scan (Mode B): CLEAN. Shared test and doc files were last
  edited by 215/227/229, which are all on trunk (rebase only). The two 230 drafts have no impl-spec yet.
- Operator instruction: address all warnings. Every item below was fixed in implementation-spec.md before execution
  (F-09 freezes step bodies only once execution starts).
  - [x] B1 (F-05/F-08/F-09): Step 11 Files + Evidence + Instruction 3a now update `TestEnrichPosition`
        (`portfolio_helpers_test.go:384`) to `enrichPosition(p, price)`. Step 11's lint type-checks tests.
  - [x] W1 (C-09): Step 3 `buf breaking` now uses `../../.git#ref=HEAD,subdir=packages/proto` and
        `../../.git#branch=main-dev,subdir=packages/proto` (insights.md:1876).
  - [x] W2 (C-08/P-06): AC-12 is a two-way handshake (`multi.started` ↔ `closeFake.waitFor`, `mark_timeout_ms`
        2500). Either serial order now fails; only the concurrent implementation passes.
  - [x] W3 (C-01/F-04): `marksPtr` is replaced by an inline `live` pointer.
  - [x] W4 (F-08): Step 4 Files lists the 8 expected generated files (any extra emit goes to the Deviation Log).
        Step 4 commits only `gen/`.
  - [x] W5 (C-08): every Go test step exports `GOWORK=off` and fails on total coverage < 40%.
  - [x] W6: Step 13 adds `docs/patterns/test-data-inventory.md` (Go row, pre-existing drift because trading's
        `internal/testdata` exists) and anchors the marketdata `CLAUDE.md:140` snapshot paragraph.
  - [x] W7 (C-14): the named consumer surfaces (agent `get_positions`, `get_positions_by_account_id`,
        `query_fundamentals`; `/trader` Book → Portfolio; `/insights`) need no code change. They are declared
        read-only in product-spec § Consumer Surface(s) and design.md, which the operator approved at the design gate
        on 2026-10-19. The change is verified through the RPCs by Step 10 and Step 12 tests.
  - [x] N1: stale `get_fundamentals` flag removed.
  - [x] N2: the Step 10 AC-10 registry is built inline.
  - [x] N3: Step 8 AC-11 quotes are built inline (`quoteAt` hardcodes 101/100).
  - [x] N4: Step 13 adds a portfolio findings row for the stale `portfolio.proto:81` "mid-quotes" comment.
  - [x] N5: Step 13 adds a soft `merge-order.md` WARN note for the 231 ↔ `230-offline-account-full-pnl` overlap.
  - [x] N6 (accepted trade-off): an aborted Multi batch no longer caches earlier symbols; the response is unchanged.
  - [x] N7: AC-14 row 1 already passes on today's code. Row 2 is the regression guard.
- Nothing remains `[ ] unaddressed` for /sdd-execute.

## Session 2026-10-19 — sdd-execute (sequential, operator: "no checkpoints")

- Operator invoked sequential mode with no checkpoints. The request is taken as the §5.1b mode-entry agreement and the
  §5.4 up-front confirmation; the §5.5b step-cap and surface checkpoints are waived. Blockers still stop the run.
- Dev branch: harness-assigned `ccr-9f55a8ac-dtw4iv`, the branch PR #1256 targets (same convention as feature 229).
  `feature.md` names `feature/<slug>`, but the harness permits pushes only to the ccr branch.
- Re-spec gate (§5.3):
  - merged `origin/main-dev` (`ee5d50e4`, docs-only: #1254 context refresh, CHANGELOG, #1257 report distillation)
    → `5fc309ab`. No service or proto code changed;
  - all step evidence re-validated, and Step 13 doc anchors now match `main-dev` as the spec required;
  - no re-spec needed.
- Duplicate defect: #1257 recorded `docs/reports/2026-10-19-portfolio-snapshot-risk-midquote-valuation-defect.md`
  (SEV-2, open): snapshot and risk value from mid-quotes, partial batches understate equity, concentration skew.
  It is a strict subset of Step 11 (broker-first `applyQuotes`, skip on any unpriced, `+=`). The sidecar is stamped
  `triaged → feature:231-fix-after-hours-positions-priced` so it is not re-routed.
- Tooling setup (steps 1–13): node v22 ✓ (CI pins 24; c8/tsc unaffected) · pnpm 9.15.9 ✓ · go1.27.0 ✓ ·
  golangci-lint ⬇ v2.14.0 rebuilt with go1.27.0 at `/root/go/bin` (the `/usr/local/bin` v2.5.0/go1.25 binary cannot
  load go1.27 modules; same as 229 D-3) · dockerd ✓ · codegen image ✗ for now (Docker Hub 429 on
  `golang:1.27-trixie`) → retry before Step 4, else host-native fallback (`codegen-toolchain-host-setup.md`).

### Step 1 — service: Write-bound the two mark keys in `SCALAR_BOUNDS_REGISTRY` [done]
- Added `marketdata.quotes.mark_timeout_ms` [100,2500] and `marketdata.quotes.mark_close_max_age_hours` [120,720]
  with a 2-line constraint comment, and amended the 229 comment to "max(batch, mark) budget".
- RED (before Step 1, with Step 2's rows present): `node --test` 55 tests, 4 fail. These are the four "rejects …
  mark_* just outside" cases.
- GREEN: `pnpm run test:coverage` 176/176 pass, lines 86.73% (≥ 40). `pnpm run lint` 0 errors (158 pre-existing
  warnings).
- Files modified: `services/xstockstrat-config/src/grpc/configServiceImpl.ts`
- Deviations: none

### Step 2 — test: Bounds tests for the two keys, both key-column forms [done]
- Added four `TIMEOUT_KEY_FORMS` rows (bare and dotted forms of both keys); the comment now names 231.
- RED/GREEN: as recorded under Step 1 (4 reject cases failed before the registry rows; 176/176 after).
- Files modified: `services/xstockstrat-config/src/__tests__/setConfigScalarBounds.test.ts`
- Deviations: none

### Step 3 — proto: additive `Quote.mark_price = 8` [done]
- Added `optional double mark_price = 8;` to `Quote` with the 2-line design.md §1 comment.
- `buf lint` is clean, and `buf breaking` is clean against both `HEAD` and `main-dev` (`../../.git#…,subdir=packages/proto` forms).
- TDD: N/A (proto).
- Files modified: `packages/proto/marketdata/v1/marketdata.proto`
- Deviations: D-1 (host-native codegen toolchain; see Deviation Log)

### Step 4 — proto-gen: regenerate stubs [done]
- `./scripts/buf-gen.sh` (host-native, D-1) emitted exactly the 8 files the spec listed (Go, Python, TS source and
  `dist`). A re-run is a no-op. `GOWORK=off go build ./...` for trading passes. `Quote.MarkPrice *float64` and
  `GetMarkPrice()` are present.
- TDD: N/A (generated). Only `gen/` is committed here; the `.proto` went in with Step 3.
- Files modified: the 8 `packages/proto/gen/**/marketdata/v1/*` files
- Deviations: D-1

### Step 5 — service: marketdata repo — `GetLatestDailyClosesBatch` [done]
- Added `GetLatestDailyClosesBatch(ctx, symbols, since) (map[string]float64, error)` plus `latestDailyClosesBatchSQL`.
  It is the unnest + LATERAL LIMIT 1 read on `marketdata.ohlcv`, filtered to `timeframe='1d'`, `time >= $2` and
  `close > 0`, run with `QueryExecModeExec` on `r.db`. Empty input → empty map, no query.
- RED (Step 6 tests first): compile failure (method undefined). Behavioural RED with a stub returning an empty map and
  empty SQL: `BoundedLateralShape` and `NoUnboundedScan` FAIL. The stub was reverted.
- GREEN: see Step 6.
- Files modified: `services/xstockstrat-marketdata/internal/repository/marketdata_repo.go`
- Deviations: none

### Step 6 — test: marketdata repo SQL shape for the close read (AC-7) [done]
- Created `internal/testdata/marks.go` (C-13 constants for the LYFT/MSFT/ELWT givens and the 168h bound).
- Added `TestGetLatestDailyClosesBatch_BoundedLateralShape` (regex pins LATERAL/ohlcv/'1d'/`time >= $2`/`close > 0`/
  `ORDER BY time DESC`/`LIMIT 1`, with Exec-mode args; ELWT is absent, never 0), plus `…_EmptyNoQuery` and
  `…_NoUnboundedScan`.
- GREEN: `go test ./... -race` all ok; total coverage 71.0% (≥ 40, asserted); `golangci-lint` 0 issues; no `16.98`
  literal in `*_test.go` (it comes from testdata).
- Files modified: `internal/repository/marketdata_repo_test.go`, `internal/testdata/marks.go` (new)
- Deviations: none
