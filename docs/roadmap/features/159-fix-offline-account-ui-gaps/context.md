# Context Log: fix-offline-account-ui-gaps

Append-only. Each session appends a new ## Session entry. Never delete or edit prior entries.

---

## Session 2026-08-26 (/sdd-triage)

- Bug reported via defect report `docs/reports/2026-08-26-offline-account-ui-gaps-defect.md`
  (GitHub Issues disabled on this repo — the report is the source of record). Found on staging while
  testing feature 157 (offline-account-portfolios), deployed pre-merge from branch
  `claude/features-157-158-impl-ulk0l2`.
- Severity: SEV-3. Config-only: no. Routed to the SDD path (Track C).
- Two defects captured: (1) the `/trader` order ticket accepts orders on an offline account (one
  landed CANCELED instead of a recorded NEW offline order); (2) misleading broker-style equity/cash/
  buying-power/day-P&L fields on the offline-account portfolio surface.
- A sibling gap ("Edit keys" action offered on offline accounts) was fixed inline on the feature 157
  branch (commit `dcd2fe5`) and is deliberately out of scope here.
- Created: feature.md, product-spec.md, acceptance.feature (3 regression scenarios), context.md,
  status.md (draft).
- Affected services (from report): `xstockstrat-ui` (`/trader`); possibly `xstockstrat-trading` for
  defect 1's CANCELED root cause.
- Root cause hypothesis: defect 1 conflates a UX affordance gap (no offline "record order" surface;
  the broker ticket is offered) with a correctness question (CANCELED vs NEW — `PlaceOrder` should
  branch to `recordOfflineOrder` for OFFLINE, so a CANCELED result needs root-causing). Defect 2 is
  `PortfolioPanel.tsx` rendering broker-only balance fields for accounts that have no `account_balances`
  row. Development branch: `feature/fix-offline-account-ui-gaps`.
- **Recommended design depth: quick** → `/sdd-design fix-offline-account-ui-gaps quick`. Rationale:
  SEV-3 and UI-heavy, but defect 1's root cause is under investigation and *may* pull in a
  trading-side routing fix (a second service). One adversarial round settles the order-ticket gating
  approach + the offline card/aggregate shape; escalate to full `/sdd-design` if root-causing confirms
  a cross-service (ui + trading) fix.
- **Sequencing note:** these defects live in feature 157's code, which is not yet merged (PR #1020,
  branch `claude/features-157-158-impl-ulk0l2`). Decide at design whether this fix folds into that PR
  before it merges, or lands as its own `feature/fix-offline-account-ui-gaps` PR after 157 merges to
  main-dev. Folding-in avoids shipping the known gaps to production; a separate PR keeps 157 mergeable
  now. (The "Edit keys" sibling fix was already folded into the 157 branch.)

---

## Session 2026-08-26 — sdd-review product-spec

- Product spec approved. Status: draft → spec-ready.
- First criteria pass: FAIL — 3 blockers: (C-15) no numbered FR-N requirements; (C-15) @AC-*
  scenarios missing @FR-* trace tags; (C-14) no `## Consumer Surface(s)` section.
- Addressed all blockers + trading-domain warnings:
  - Added FR-1..FR-4 (order-ticket gate + Record-order affordance; offline order persisted NEW
    never CANCELED; offline card hides broker-only fields; combined header excludes offline from
    broker aggregates). Folded in C-2/C-3/C-4/C-5 notes (broker accounts unaffected; offline
    bypasses broker regardless of environment; all order types identical; broker fill lifecycle
    unchanged).
  - Tagged @AC-1(@FR-1,@FR-2) / @AC-2(@FR-3) / @AC-3(@FR-4); concrete values Schwab 4737 / HONA
    BUY 1 / Alpaca Paper.
  - Added `## Consumer Surface(s)` (/trader, agent record_order, ListPositions↔ListPortfolios
    read-path parity, C-10/C-14).
- Re-review: PASS WITH WARNINGS — all blockers cleared; one advisory (portfolio named in Consumer
  Surface(s) but not Affected Services). Addressed by adding `xstockstrat-portfolio` to Affected
  Services with a design-time note to confirm whether FR-3/FR-4 need a portfolio code change or are
  UI-only (feature-157 parity may already hold).
- Overlap scan: no FAIL-class collision (159 declares no proto/config/migration). Only same-file
  overlap is with parent feature 157 (OrderForm.tsx, PortfolioPanel.tsx, trading offline path) —
  but 157 already merged to main-dev (PR #1020 → c5052fe), so 159 branches on top of it; the
  build-order dependency is already satisfied. No merge-order.md row needed.
- Next: /sdd-design fix-offline-account-ui-gaps quick.

---

## Session 2026-08-26 — sdd-design (quick), round 1 + user gate

- Phase 0 Recon: wrote recon.md. Services surveyed: xstockstrat-ui (primary), xstockstrat-trading,
  xstockstrat-portfolio. Recon concluded a UI-only fix was plausible: trading's offline PlaceOrder
  branch already records NEW; portfolio already excludes offline accounts from the account_balances-
  sourced combined aggregate. No durable C-16 business rules yet (157 scenarios un-promoted); no
  exhaustive BrokerType/OrderStatus TS maps (no C-10(d) trap).
- Phase 1 round 1: proposer = UI-only (OrderForm "record" mode reusing the form + placeOrder;
  PortfolioPanel gates Cash/BP/DayPnl/TotalPnl on !isOffline; FR-4 assert-only). Adversary verdict
  NEEDS WORK (no Floor breach). Key objections:
  1. [P-03/C-15] FR-2 closure rested on the empty-account_id→sole-broker-fallback hypothesis, but the
     submit button is ALREADY disabled when !selectedAccountId (pre-existing feature-157 guard), so
     the defect reproduced WITH that guard — the empty-id path is refuted. The real reachable cause
     per product-spec is "persisted broker_type was not OFFLINE"; PlaceOrder routes on the in-memory
     pool entry's brokerType (trading.go:388), a DIFFERENT source than the UI's ListBrokerAccounts
     brokerType the gate keys on. A UI gate cannot guarantee the backend takes the offline branch.
  2. [C-15/C-08, ledger 072/080] Asserting "persisted NEW" via the e2e mock proves nothing — the mock
     placeOrder handler returns hardcoded FILLED; the NEW guarantee lives in trading's recordOfflineOrder,
     which Playwright never exercises. Needs a Go test (contradicts "UI-only").
  3. [FR-1/FR-2] Reusing the full broker OrderForm in record mode: broker validation (trailing-stop,
     trading.go:359-367) runs BEFORE the offline branch, so an offline "record" submit with Order
     Type=Trailing Stop → InvalidArgument, never persists NEW → violates FR-1/FR-2. Leaving order-type/
     TIF/limit/stop inputs shown is wrong for a hand-confirmed offline fill. Better: dedicated minimal
     control (symbol/side/qty/±price) reusing the usePlaceOrder hook, not the form JSX.
  4. [C-10(a)/C-14] OrderForm has a 2nd mount point: insights SignalOrderTicket.tsx wraps its own
     AccountProvider defaulting to first active account — if that's OFFLINE, the record affordance
     appears on insights/market/[symbol] too. Must decide/exclude + test.
  5. [ledger 056 C-10(b)] FR-4 assert-only is tautological against a fixture; and offline being
     ENTIRELY absent from the combined view (no card) ≠ "excluded from cash/BP aggregates" — a real
     product fork. Mock must reproduce the real ListPositions↔ListPortfolios asymmetry or it tests nothing.
  6. [C-11] FR-1's "add a Record-order control" half is additive capability, not a pure bug fix — no
     bug-fix testing carve-out.
- **User gate decisions (P-04):**
  1. Order ticket → **Investigate root cause first.** Pull the CANCELED order's authoritative row
     (account_id, persisted broker_type, status, broker_order_id) before finalizing; the fix may need
     a trading-side authoritative guard, not a UI gate. Design NOT approved yet — round 2 pending
     investigation.
  2. Combined view → **Show offline card, excl. cash/BP.** Offline account IS rendered in the combined/
     all-accounts view as a card with only meaningful fields (positions MV / unrealized / realized),
     still excluded from cash & buying-power aggregates. This is a small portfolio + UI change (not
     assert-only), and it resolves objection #5's product fork toward "shown-but-excluded".
- **Tooling limitation surfaced:** available MCP tools (xstockstrat_staging agent tools;
  digitalocean-databases cluster mgmt) expose NO raw order-row query and no trading/order agent tool,
  so I cannot pull the staging DB row myself. Investigation proceeds via (a) a deeper code trace of the
  in-memory-pool-brokerType vs persisted-broker_type divergence + every CANCELED-reachable path for a
  nominally-offline account, and (b) asking the operator for the order row.
- Status stays spec-ready (design not approved); round 2 after investigation.

## Session 2026-08-26 — sdd-design, root-cause investigation (trading trace)

- **Tooling:** confirmed I cannot pull the staging order row (no order-query MCP tool; DO db tools are
  cluster-mgmt only). Asked operator for the row. Ran a deep trading code trace instead.
- **New finding (recon missed it): `CancelOrder` (`trading.go:1079`) sets `ORDER_STATUS_CANCELED`
  UNCONDITIONALLY** — no offline / terminal-state / empty-broker_order_id guard. The broker cancel
  above it is gated on `broker_order_id != ""` (`:1036`), but the local transition is not. So an
  OFFLINE NEW order (empty broker_order_id) reaching CancelOrder skips the broker call yet still flips
  to CANCELED, persists (`:1087`), emits `order.canceled` (`:1094`). This is a real, latent FR-2
  violation regardless of the staging incident.
- **broker_type is immutable post-create** (only the CreateBrokerAccount INSERT writes it; no UPDATE
  anywhere; account_repo.go). Pool is DB-seeded at boot only (`main.go:100`), mutated consistently by
  Register/Update/Deregister. So a pool-vs-DB brokerType divergence is NOT reachable via any RPC — only
  via an out-of-band DB edit or a pre-boot registration state.
- **PlaceOrder routes solely on the in-memory pool tag** (`resolveAccount` reads only `s.brokers`,
  `:285-317`; offline decision `:388` reads `accountEntry.brokerType`); neither PlaceOrder nor
  recordOfflineOrder ever reads the persisted account broker_type. An authoritative guard would call
  `s.accountRepo.GetBrokerAccount(resolvedAccountID)` (`account_repo.go:47,104-117`) right after
  resolveAccount (~:377) and route on `rec.BrokerType`.
- **Two live hypotheses for the staging CANCELED, disambiguated by the order row:**
  - A: recorded NEW-offline, then a CancelOrder RPC flipped it → tell: broker_order_id empty, order
    broker_type=OFFLINE, created→canceled delta.
  - B: routed to a broker (pool entry non-OFFLINE / account not truly offline) → Alpaca canceled →
    pollFills → CANCELED → tell: broker_order_id set, order broker_type≠OFFLINE. (pollFills excludes
    OFFLINE entries `:1408`, so a truly-offline-tagged order cannot reach it.)
- **Design implication:** both hypotheses are code-reachable and each has a clean in-scope guard
  (PlaceOrder authoritative route-on-persisted-type for B; CancelOrder offline/terminal guard for A).
  A "robust both-guards" trading change makes FR-2 hold regardless of which fired on staging, without
  blocking on the row — at the cost of expanding scope to trading (Go + paired tests, per adversary
  obj #2/#6). To be put to the operator at the round-2 gate.

## Session 2026-08-26 — sdd-design COMPLETION (design-approved)

- **User gate decisions (round 2, P-04):**
  1. Trading fix → **Harden both guards now.** PlaceOrder reads the authoritative persisted broker_type
     (GetBrokerAccount) and routes offline on it (guard B); CancelOrder rejects/no-ops an offline order
     with no broker_order_id (guard A). + paired Go tests. Makes FR-2 hold regardless of which staging
     hypothesis fired — unblocks without the row.
  2. Record UI → **Dedicated minimal control, /trader only.** Replace the broker ticket (offline
     selected) with symbol/side/qty/±fill-price control; no order-type/TIF/limit/stop/trailing inputs;
     exclude the insights SignalOrderTicket surface (tested).
- Chosen approach (design.md): UI (dedicated Record-order control + PortfolioPanel !isOffline gating +
  combined-view offline card) + trading (authoritative PlaceOrder routing guard + CancelOrder offline
  guard + Go tests) + portfolio (ListPortfolios enumerates account_balances ∪ offline account ids so
  offline appears in combined with meaningful-only fields + ListPositions↔ListPortfolios parity test).
  No proto/migration/config.
- Rejected: reuse full OrderForm in record mode (trailing-stop mis-submit); UI-gate-only (can't
  guarantee FR-2); route on pool tag only (divergence misroute); FR-4 assert-only / offline absent.
- Constitution touched: C-08/P-06 (paired Go + e2e), C-10(a) (both OrderForm mounts decided),
  C-10(b) (ListPositions↔ListPortfolios offline parity fixed + test), C-14 (surfaces named, insights
  excluded), C-12/C-13 (fixtures). No proto/migration/config Floor items triggered. No Floor breach.
- C-16: no durable suites yet (157 un-promoted); this EXTENDS 157's offline behavior; promote
  @AC-1/2/3/4 into trading+portfolio+ui suites at launch.
- Acceptance: added @AC-4 (@FR-4) for the offline account visible in the combined view with
  meaningful-only fields; refined product-spec FR-4 accordingly.
- Status: spec-ready → design-approved. Next: /sdd-spec fix-offline-account-ui-gaps.

## Session 2026-08-26 — sdd-spec

- Generated implementation-spec.md with 8 steps. Status → implementation-ready.
- Step map: (1) trading service — PlaceOrder authoritative offline routing (union of pool tag +
  persisted `GetBrokerAccount` type) + CancelOrder offline guard; (2) trading Go tests; (3) portfolio
  service — new `ListOfflineAccountIdsByUser` repo read + `ListPortfolios` union enumeration
  (account_balances ∪ offline_account_realized); (4) portfolio Go tests; (5) UI OrderForm Record-order
  control; (6) UI PortfolioPanel `!isOffline` field gating (single + combined); (7) UI e2e; (8) docs.
- Scenario coverage (159's own AC IDs, not 157's): @AC-1 → Steps 2 (Go NEW/never-CANCELED) + 7 (UI
  affordance); @AC-2 → Step 7; @AC-3 → Steps 4 + 7; @AC-4 → Steps 4 (ListPositions↔ListPortfolios
  parity) + 7.
- Key codebase findings (grep-verified):
  - CancelOrder flips to CANCELED **unconditionally** at `trading.go:1079` (no offline precondition);
    guard placed after order load (`:985`), keyed on authoritative `order.BrokerType == OFFLINE`
    (NOT empty broker_order_id — that would false-reject a broker order pre-`broker_order_id`).
  - PlaceOrder offline branch at `trading.go:388` keys only on the in-memory pool entry; guard B reads
    `s.accountRepo.GetBrokerAccount` (`account_repo.go:104`) and routes offline on a **union** so a
    pool/DB divergence can't misroute (broker_type is immutable post-create — prior investigation).
  - `recordOfflineOrder` (`trading.go:744`) already records NEW, empty `broker_order_id`,
    `LimitPrice: req.LimitPrice`, order-type-agnostic — so the UI Record control sends orderType=MARKET
    + optional fill price → limitPrice.
  - OrderForm has **four** mounts; two `/trader` mounts (positions/[symbol], and dashboard) — the
    positions one passes `initialSymbol` just like insights, so `initialSymbol` can't distinguish
    insights. Pinned an explicit `allowOfflineRecord` prop (default true; SignalOrderTicket passes
    false) to exclude insights per C-10(a).
  - Portfolio combined branch (`portfolio_service.go:1125`) enumerates `account_balances` only; offline
    accounts are marked by `portfolio.offline_account_realized` rows (`GetOfflineRealized`,
    `portfolio_repo.go:420`) — chose that as the offline-exclusive union source. Surfaced (P-03) that a
    zero-activity offline account with no realized row / no positions is not yet known to portfolio
    (no account-creation signal) — out of scope, consistent with @AC-4 (account with positions).
  - Test homes all exist: trading `internal/service/trading_offline_test.go` +
    `internal/testdata/order_rows.go` (C-13 Go home); portfolio
    `internal/service/portfolio_offline_test.go` (no `internal/testdata/` — none required); UI fixtures
    `BROKER_ACCOUNT_OFFLINE`/`PORTFOLIO_OFFLINE` + `e2e/trader/offline-accounts.spec.ts`.
  - No proto/migration/config change (trading last migration 008, portfolio last 012). Added a docs
    step (8) to keep trading + portfolio CLAUDE.md accurate for the two new backend behaviors.

## Session 2026-08-26 — sdd-review impl-spec (advisory)

- Result: 0 failures, 0 warnings, 6 NOTEs (advisory — did not block). Every code-checkable claim
  resolves; C-08/P-06 pairing, C-10(a)/(b), C-14, C-15 traceability all satisfied; no Floor risk
  (no proto/migration/config, no new DB pool, no new outbound gRPC — GetBrokerAccount is a DB read).
- Overlap: CLEAN — no proto/migration/config collisions (159 declares none); no same-file overlap
  with any in-flight feature (142 = marketdata only; 158/084 disjoint; 157 = merged trunk baseline).
  No merge-order.md entry needed.
- Non-material NOTEs carried into execution (execution re-greps live anchors, so these self-correct):
  - Step 1: Codebase Evidence cites resolveAccount at `:371`; actual is `trading.go:377` (6-line
    drift). Load-bearing `:388/:389` offline-branch anchors are exact. — [ ] cosmetic
  - Step 5: Evidence says "two /trader mounts pass initialSymbol"; only `positions/[symbol]/page.tsx`
    does. Design conclusion (need explicit allowOfflineRecord prop) still holds. — [ ] cosmetic
  - Steps 2/4/7: trading+portfolio `internal/service` branch logic is behaviorally tested but NOT
    Go-coverage-gated (ci.yml:244 COVERPKGS excludes cmd|handler|repository|telemetry|service) — spec
    is transparent about this; matches repo CI. Not a gap. — [ ] acknowledged
- No blockers. Cleared to run /sdd-execute.

---

## Session 2026-08-26 — sdd-execute (sequential)

Branch: `claude/features-157-158-impl-ulk0l2` (task-mandated harness branch, in place of
`feature/fix-offline-account-ui-gaps`); one commit per step; single integration PR → main-dev at end.

### Step 1 — trading guards [done]
- Guard B (PlaceOrder): after `resolveAccount`, read authoritative persisted `broker_type` via
  `s.accountRepo.GetBrokerAccount` and route offline when pool tag OR persisted type is OFFLINE (union;
  best-effort — DB error or nil repo falls back to pool tag). Guard A (CancelOrder): reject an offline
  order (`order.BrokerType == OFFLINE`) with `FailedPrecondition` before the unconditional CANCELED
  transition at `:1079`.
- Files modified: `services/xstockstrat-trading/internal/service/trading.go`
- Deviations: nil-`accountRepo` defensive fallback (Deviation Log Step 1) — in `trading.go`, unblocks
  existing halt tests; behavior-preserving.
- TDD: covered by Step 2 (red->green below).

### Step 2 — trading tests [done]
- `TestCancelOrder_RejectsOfflineOrder` (@AC-1): red — pre-fix CancelOrder returned code OK and the
  offline order's status became CANCELED -> green — guard A returns FailedPrecondition, status stays
  NEW. `TestPlaceOrder_RoutesAuthoritativeOfflineToRecord` (@AC-1): red — a divergent account (pool
  ALPACA / persisted OFFLINE) recorded no offline order (broker path) -> green — guard B routes it to
  recordOfflineOrder (NEW, empty broker_order_id). Both use recover() for the un-fakeable concrete
  `*repository.TradingRepo` UpsertOrder panic and assert on `s.orders`.
- Files modified: `services/xstockstrat-trading/internal/service/trading_offline_test.go`
- Verification: `go build` OK; full service package green; coverage total 62.9% >= 40%; golangci-lint
  0 issues; C-13 single-consumer inline literals compliant.
- Deviations: none.

### Step 3 — portfolio combined-view offline enumeration [done]
- Added `PortfolioRepo.ListOfflineAccountIdsByUser` (SELECT account_id FROM offline_account_realized
  WHERE user_id, the offline-exclusive marker). `ListPortfolios` all-accounts branch now appends offline
  accounts not already in the balances set via the pure helper `offlineIDsToAppend` (union+dedup);
  `buildAccountPortfolio(ctx, id, nil)` yields Cash/BP/DayPnl=0 + Equity=positions MV, so summed broker
  aggregates exclude offline while offline equity may contribute. Lookup failure is non-fatal (warn+skip).
- Files modified: `internal/repository/portfolio_repo.go`, `internal/service/portfolio_service.go`
- Deviations: none for Step 3 (the pure-helper factoring is recorded under Step 4).

### Step 4 — portfolio offline enumeration test [done]
- `TestOfflineIDsToAppend` (@AC-3/@AC-4): red (helper stubbed to return nil -> [] for both the
  skip-present and dedup cases) -> green (real helper). Deviation: pure-helper unit test in place of the
  specced repository-double ListPortfolios test (concrete un-fakeable *PortfolioRepo; no DB per TDD gate)
  — user-approved at checkpoint; @AC-3/@AC-4 also covered by Step 7 e2e.
- Files modified: `internal/service/portfolio_offline_test.go`
- Verification: build OK; full service + repository packages green; coverage total 55.9% >= 40%;
  golangci-lint 0 issues.

### Step 5 — UI offline Record-order control [done]
- Added `allowOfflineRecord?: boolean` (default true) to OrderForm; derived `isRecordMode` from the
  selected account's `brokerType === BrokerType.OFFLINE` (via useAccountContext.accounts). In record
  mode the broker order-type/limit/stop/trailing inputs are hidden, replaced by symbol/side/qty + an
  optional fill price; submit forces MARKET, maps fill price → limitPrice, sends the explicit offline
  accountId (backend records NEW). Title "Record Offline Order", button "Record …". SignalOrderTicket
  passes allowOfflineRecord={false} (insights mount deliberately excluded, C-10(a)).
- Files modified: `src/components/trader/OrderForm.tsx`, `src/components/insights/SignalOrderTicket.tsx`
- Verification: tsc --noEmit exit 0; pnpm lint exit 0 (no new warnings in changed files); greps confirm.
- TDD: e2e pairing in Step 7. Deviations: none.

### Step 6 — PortfolioPanel !isOffline field gating [done]
- Single-account branch: derived `isOffline`, wrapped Cash / Buying Power / Day P&L / Total P&L in
  `{!isOffline && ...}` (kept Equity, positions+unrealized, and the already-gated Realized P&L).
  Combined branch: gated the per-card Day P&L on `!isOffline` (kept Equity + position count). Offline
  cards now show only meaningful fields (FR-3 / FR-4 / @AC-2 / @AC-4).
- Files modified: `src/components/trader/PortfolioPanel.tsx`
- Verification: tsc --noEmit exit 0; pnpm lint exit 0 (no findings in the file); greps confirm both branches.
- TDD: e2e pairing in Step 7. Deviations: none.

### Step 6 (expansion) — Book page /trader/portfolio/page.tsx offline gating [done]
- Discovery at Step 7 found the real combined "Book" surface is `src/app/trader/portfolio/page.tsx`
  (not PortfolioPanel's rarely-reached combined branch — AccountContext auto-selects the first active
  account). Gated its per-account card Cash / Buying power / Day P&L / Total P&L on `!isOffline` (kept
  Equity + Positions). Combined StatTile aggregates already correct (offline contributes 0). User
  approved the Step 6 scope expansion at the checkpoint.
- Files modified: `src/app/trader/portfolio/page.tsx`
- Verification: tsc 0; lint 0 (pre-existing accountName warning only). Deviation logged (Step 6 expansion).
