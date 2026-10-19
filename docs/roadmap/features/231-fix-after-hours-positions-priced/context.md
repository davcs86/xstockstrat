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
