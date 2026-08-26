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
