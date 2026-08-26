# Product Spec: fix-offline-account-ui-gaps

**Type**: bug
**Defect Report**: `docs/reports/2026-08-26-offline-account-ui-gaps-defect.md`
**Severity**: SEV-3
**Created**: 2026-08-26

---

## Problem Statement

Feature 157 (offline-account-portfolios) shipped to staging surfaced two UI-correctness gaps on an
offline (manually-tracked, non-broker) account:

**Defect 1 — regular order ticket accepts orders on an offline account.** With an offline account
selected, the `/trader` BUY/SELL order ticket (Market/Limit, Quantity) is fully enabled. An order
placed through it (HONA BUY 1) appeared in the Orders list as **CANCELED**, not as a recorded offline
order (NEW, awaiting a hand-confirmed fill). Expected: an offline account's orders are *recorded*
(NEW) and hand-confirmed via the Confirm-fill flow, never routed like a broker order. There is
currently no distinct "record an offline order" affordance in the UI — the offline write surfaces
feature 157 shipped are *create account* and *confirm fill on an existing order* only; recording a new
offline order is reachable only via the MCP agent (`manage_offline_account` `record_order`).

**Defect 2 — misleading equity/portfolio figures for an offline account.** The Book portfolio surface
presents broker-style figures (Combined Equity / Cash / Buying Power / Day P&L) for an offline account
context. Feature 157 gives offline accounts no `account_balances` row (equity is derived from position
market values only), so cash / buying power / broker day-P&L are meaningless for them — presenting
those fields (or blending an offline account into combined broker aggregates) misrepresents the book.

## Functional Requirements

- **FR-1** — With an offline account selected in `/trader`, the broker order ticket must not submit a
  broker-routed order. The broker ticket is gated (hidden/disabled) for offline accounts and replaced
  by an offline-specific "Record order" affordance that calls the offline record path
  (`manage_offline_account` `record_order` behavior). All `OrderType` values are treated identically
  for offline accounts — none reaches a broker.
- **FR-2** — Any order recorded against an offline account is persisted **NEW** (awaiting a
  hand-confirmed fill), never **CANCELED** by a broker path. This holds regardless of environment
  (paper/staging vs live/production) because an offline order never touches a broker. Broker accounts
  (`ALPACA`, `IBKR`) are unaffected — their order routing, order types, and fill lifecycle
  (`ORDER_STATUS_PARTIALLY_FILLED` / `ORDER_STATUS_FILLED`) stay as-is.
- **FR-3** — The per-account portfolio card for an offline account must not present broker-only fields
  (Cash, Buying Power, broker Day P&L) as if they were real. It shows only the fields meaningful for an
  offline account: positions market value, unrealized P&L, and the account-grain Realized P&L feature
  157 already surfaces.
- **FR-4** — The combined/all-accounts portfolio header must exclude offline accounts from broker-only
  aggregates (Cash, Buying Power). Combined equity is not misrepresented by an offline account's absent
  `account_balances` row; the offline account's position market value may contribute to combined
  equity, but its (nonexistent) cash/buying-power must not be blended in.

Each `FR-N` above is covered by ≥1 `@AC-*` scenario in `acceptance.feature` (Constitution **C-15**).

## Reproduction Steps

Defect 1:
1. Create/select an offline account in `/trader` (broker "Offline").
2. Use the BUY/SELL order ticket to place a Market order (e.g. HONA BUY 1).
3. Observe the Orders list — the order shows CANCELED, not a recorded NEW offline order.

Defect 2:
1. Select an offline account in `/trader` → Book.
2. Observe the portfolio header/card showing Cash / Buying Power / Day P&L (broker-only concepts) and
   a combined-equity/blended-P&L that mixes the offline account with broker accounts.

## Root Cause Hypothesis

- **Defect 1**: two intertwined causes to separate at design/investigation — (a) UX: the broker order
  ticket is offered for offline accounts with no offline-specific "record order" affordance; (b)
  correctness: the order ended CANCELED rather than NEW. `TradingService.PlaceOrder` branches to
  `recordOfflineOrder` for `BROKER_TYPE_OFFLINE` (persists NEW, no broker submit), so a CANCELED
  outcome implies the order didn't take the offline branch (the persisted `broker_type` was not
  OFFLINE) or another path canceled it — **under investigation**.
- **Defect 2**: `PortfolioPanel.tsx` renders Equity/Cash/BuyingPower/DayPnl unconditionally; offline
  accounts have no `account_balances` row (feature 157 design), so those fields are 0 or blended
  misleadingly. Needs a decision on the offline-account card shape + combined-header aggregation.

## Affected Services

- `xstockstrat-ui` (`/trader` — `OrderForm.tsx`, `PortfolioPanel.tsx`)
- `xstockstrat-trading` — possibly, for defect 1's CANCELED root cause (offline order routing)

## Consumer Surface(s)

- [x] **`/trader` web UI** (`xstockstrat-ui`) — the order ticket (`OrderForm.tsx`) and the portfolio
  card/header (`PortfolioPanel.tsx`) are the primary surfaces changed. This is the reach of both
  defects.
- [x] **MCP agent** (`xstockstrat-agent`) — `manage_offline_account` `record_order` is the existing
  offline-order write path; the new UI "Record order" affordance (FR-1) mirrors it. No agent-tool
  signature change anticipated — the UI reaches the same underlying trading RPC.
- [x] **Backend read-path parity** (`xstockstrat-portfolio`) — the offline-account balance shape must
  stay consistent across `ListPositions` ↔ `ListPortfolios` / `GetPortfolio` so the UI card (FR-3) and
  combined header (FR-4) render the same offline-account fields no matter which read path feeds them
  (Constitution **C-10**).

## Fix Scope

- [x] No proto changes anticipated
- [x] No database migrations anticipated
- [x] No config key changes anticipated

(Update after investigation — the defect-1 root cause may pull in a trading-side change.)

## Acceptance Criteria

See `acceptance.feature` — regression scenarios that must fail on the buggy behavior and pass after
the fix (Constitution **C-15**). Plus: existing tests pass; `/trader` smoke-tested on dev.

## Out of Scope

- The "Edit keys" gap — already fixed on the feature 157 branch (`dcd2fe5`).
- The confirm-fill flow itself — working as designed (order detail page → "Confirm fill").
- Refactoring or performance work unrelated to the two defects.
