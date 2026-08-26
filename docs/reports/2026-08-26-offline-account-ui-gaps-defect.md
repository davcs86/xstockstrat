# Defect: offline-account UI gaps — regular orders accepted + misleading equity card

**Date**: 2026-08-26
**Reporter**: davcs86@gmail.com (via Claude Code)
**Severity**: SEV-3
**Impact type**: behavior-correctness / UX-correctness
**Environment**: staging (feature 157 `offline-account-portfolios`, deployed pre-merge from branch `claude/features-157-158-impl-ulk0l2`)
**Affected service(s)**: `xstockstrat-ui` (`/trader`), and possibly `xstockstrat-trading` (offline order routing) for defect 1
**Config-only fix possible**: no

> Severity rationale: both are on a non-broker (offline, paper-tracked) account, so no real trading-safety or money-movement risk — the offline path never touches a broker. They are correctness/clarity gaps in a newly-shipped capability. Defect 1 has a correctness edge (an order landing CANCELED instead of a recorded offline order); if root-causing shows misrouting rather than a UX affordance gap, its severity may be raised one level at design time.

A third, sibling gap ("Edit keys" action offered on offline accounts) was already fixed inline on the
same branch (commit `dcd2fe5`) and is **not** part of this report.

## Defect 1 — the regular order ticket accepts orders on an offline account

**Observed (staging):** with the offline account "Schwab 4737" selected, the `/trader` BUY/SELL
order ticket (Market/Limit, Quantity, "BUY") is fully enabled. A HONA BUY 1 placed through it appears
in the Orders list with status **CANCELED**, not as a recorded offline order (NEW, awaiting a
hand-confirmed fill).

**Why this is wrong:** an offline account is manually tracked — its orders are meant to be *recorded*
(NEW) and then hand-confirmed via the Confirm-fill flow, never routed like a broker order. Two things
are conflated:

- **UX:** the broker order ticket (Market/Limit/Stop, TIF, auto-sizing, brackets) is not the right
  affordance for an offline account. There is currently no distinct "record an offline order"
  entry point in the UI — the only offline write surfaces feature 157 shipped are *create account*
  and *confirm fill on an existing order*; recording a new offline order is only reachable via the
  MCP agent (`manage_offline_account` `record_order`) or the raw `PlaceOrder`.
- **Correctness:** the order ended **CANCELED**. `TradingService.PlaceOrder` branches to
  `recordOfflineOrder` for `BROKER_TYPE_OFFLINE` accounts (persists NEW, empty `broker_order_id`, no
  broker submit — `services/xstockstrat-trading/internal/service/trading.go`), so a form order on a
  genuinely-offline account should be NEW, not CANCELED. A CANCELED result implies either the order
  did not take the offline branch (the persisted `broker_type` on that order/account was not OFFLINE),
  or another path canceled it. This needs root-causing at design.

**Questions for design:**
1. Should the broker order ticket be **hidden/disabled** when an offline account is selected, replaced
   by a dedicated "Record order" control that calls the offline record path?
2. Reproduce the CANCELED outcome and confirm whether it is a routing/data bug (order not tagged
   OFFLINE) or purely the missing UX gate above.

## Defect 2 — misleading equity/portfolio figures for an offline account

**Observed (staging):** the Book portfolio surface shows broker-style figures for the account context
that do not apply to an offline account — Combined Equity / Cash / Buying Power / Day P&L. Feature
157's design derives offline equity from position market values only and gives offline accounts **no**
`account_balances` row (no cash, no buying power, no broker day-P&L basis), so those fields are either
`0` or borrowed/blended in a way that misleads (e.g. "$594,225.08 Buying Power" or a "blended" Day P&L
on an account that has neither).

**Why this is wrong:** an offline account has no cash/buying-power/settlement concept; presenting those
broker fields (or a blended combined-equity that mixes an offline account with a broker account)
misrepresents the book. The per-account card and the combined header should present an offline account
with only the fields that are meaningful (positions market value, unrealized P&L, and the account-grain
Realized P&L feature 157 already surfaces), and clearly exclude/zero the broker-only fields.

**Questions for design:**
1. What is the correct offline-account card shape (which fields to show, hide, or label "n/a")?
2. How should the **combined/all-accounts** header treat a mix of offline + broker accounts (exclude
   offline from cash/buying-power aggregates; how to combine equity)?

## Root-cause pointers (grounded)

- Offline order routing: `services/xstockstrat-trading/internal/service/trading.go` `PlaceOrder` →
  `recordOfflineOrder` (offline branch); `resolveAccount` offline-skip guard.
- Order ticket UI: `services/xstockstrat-ui/src/components/trader/OrderForm.tsx` (no offline gate today).
- Portfolio card: `services/xstockstrat-ui/src/components/trader/PortfolioPanel.tsx` (renders Equity/
  Cash/Buying Power/Day P&L unconditionally; offline realized stat is already gated).
- Offline equity derivation: `xstockstrat-portfolio` `buildAccountPortfolio` / `GetPortfolio` — offline
  accounts have no `account_balances` row (feature 157 design), so `bal` is nil and equity falls back
  to summed position market value; cash/buying-power/day-P&L stay 0.

## Not in scope of this report

- The "Edit keys" gap — already fixed on-branch (`dcd2fe5`).
- The confirm-fill flow itself — working as designed (order detail page → "Confirm fill").
