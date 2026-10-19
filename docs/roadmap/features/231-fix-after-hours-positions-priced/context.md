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
