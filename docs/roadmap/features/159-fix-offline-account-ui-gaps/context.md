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
