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
