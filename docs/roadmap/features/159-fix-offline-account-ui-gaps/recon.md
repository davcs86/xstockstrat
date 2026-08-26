# Recon: fix-offline-account-ui-gaps

**Created**: 2026-08-26
**From**: product-spec.md
**Affected services**: xstockstrat-ui (primary); xstockstrat-trading + xstockstrat-portfolio investigated — **no code change required** (see Recommended Scope)

---

## Objective

Feature 157 (offline-account-portfolios, already merged to main-dev) surfaced two UI-correctness gaps
on an OFFLINE (manually-tracked, non-broker) account in `/trader`: (1) the broker order ticket accepts
orders on an offline account and one landed CANCELED instead of a recorded NEW offline order; (2) the
portfolio card presents broker-only fields (Cash / Buying Power / Day P&L) that are meaningless for an
offline account. Recon confirms both are fixable **UI-side**: the trading offline branch already
records NEW correctly, and the portfolio layer already excludes offline accounts from broker
aggregates.

## Codebase Map

- **`xstockstrat-ui`** (Next.js)
  - Order ticket: `services/xstockstrat-ui/src/components/trader/OrderForm.tsx:49` reads only
    `selectedAccountId` (no brokerType); submit → `usePlaceOrder` → `tradingClient.placeOrder`
    (`OrderForm.tsx:80-96`, `src/hooks/usePlaceOrder.ts:7-12`, sends `accountId: selectedAccountId ?? ''`).
  - Portfolio card: `src/components/trader/PortfolioPanel.tsx:45-61` renders Equity/Cash/Buying
    Power/Day P&L unconditionally; offline Realized P&L already gated
    (`PortfolioPanel.tsx:27-28,63-69` — `showRealized = account?.brokerType === BrokerType.OFFLINE && portfolio?.realizedPnl !== undefined`).
    Per-account vs combined shape keyed on `selectedAccountId` presence (`:21` single vs `:111-148` combined cards).
  - Selected-account brokerType source: `src/context/AccountContext.tsx:13-16,34-35` (each
    `BrokerAccount` carries `brokerType`; consumers `accounts.find(a => a.id === selectedAccountId)`).
  - Canonical `isOffline` pattern: `src/components/trader/accountShared.tsx:282`
    (`const isOffline = account.brokerType === BrokerType.OFFLINE`); `brokerLabel` switch
    `src/lib/brokers.ts:4-13`.
  - Existing offline confirm-fill affordance (order-detail only): `src/app/trader/orders/[id]/page.tsx:55,114-125` (gated `isOffline`).
  - BFF: `src/lib/traderBff.ts:29-35` (placeOrder), `:53-61` (confirmOrder, offline-only server-enforced).
  - Tests: `e2e/trader/offline-accounts.spec.ts` (@AC-3/5/13 + edit-keys regression);
    fixtures `BROKER_ACCOUNT_OFFLINE`, `PORTFOLIO_OFFLINE` (`e2e/fixtures/INVENTORY.md:15-16`);
    mock-backend `placeOrder` `e2e/mock-backend.ts:193-216`, `confirmOrder` `:222-230`, trader `listPortfolios` `:273-276`.
- **`xstockstrat-trading`** (Go) — investigated, no change:
  - Offline decision reads the in-memory pool entry's type: `internal/service/trading.go:388`
    (`accountEntry.brokerType == BROKER_TYPE_OFFLINE → recordOfflineOrder`).
  - `resolveAccount` sole-account fallback **skips OFFLINE** on empty `account_id`: `trading.go:300-316` (`:304 continue`).
  - `recordOfflineOrder` records `ORDER_STATUS_NEW`, empty `broker_order_id`/`filled_at`: `trading.go:744,784-804`.
  - CANCELED only set by `CancelOrder` (`:1079`) and `pollFills` (`:1517`), both requiring non-empty
    `broker_order_id` + non-offline client (`pollFills` skips offline `:1408-1410`, empty broker_order_id `:1419`).
- **`xstockstrat-portfolio`** (Go) — investigated, no change:
  - `buildAccountPortfolio` leaves Cash/BuyingPower/DayPnl at 0 when `bal == nil` (offline);
    equity = summed position MV; offline realized read `internal/service/portfolio_service.go:1056,1074-1096`.
  - `ListPortfolios` all-accounts branch enumerates from `account_balances` only
    (`portfolio_service.go:1120-1139`, repo `ListAccountBalancesByUser` `portfolio_repo.go:451-457`) →
    offline accounts (no balances row) **already absent** from the combined aggregate.
  - `Portfolio` proto has **no** `is_offline`/`broker_type` marker (`packages/proto/portfolio/v1/portfolio.proto:38-54`);
    offline-ness inferable only from `realized_pnl` (field 12, optional) presence.

## Patterns to REUSE

- Offline detection in a component → reuse `isOffline = account.brokerType === BrokerType.OFFLINE`
  (`accountShared.tsx:282`); resolve the selected account via `accounts.find(a => a.id === selectedAccountId)`
  from `useAccountContext()` (`AccountContext.tsx`), same as `PortfolioPanel`'s existing `showRealized` gate.
- Broker label → `brokerLabel` (`src/lib/brokers.ts:4-13`), never re-derive.
- Recording an offline order → the existing `placeOrder` BFF + `usePlaceOrder` hook already reaches
  `PlaceOrder`, which takes the offline branch when the offline `account_id` is sent explicitly — no new RPC.
- Offline test data → reuse `BROKER_ACCOUNT_OFFLINE` / `PORTFOLIO_OFFLINE` fixtures + extend
  `e2e/trader/offline-accounts.spec.ts` (C-12), same mock-backend `placeOrder`/`listPortfolios` handlers.

## Existing Business Rules (preserve / extend)

- No existing acceptance suite for xstockstrat-trading yet — the order-routing / order-status
  guarantees this feature touches are not yet a durable rule; source of truth remains feature 157's
  (code-completed, un-promoted) `acceptance.feature`. Nothing to PRESERVE at the suite level.
- No existing acceptance suite for xstockstrat-portfolio yet — the equity/balance/aggregation-display
  guarantees are not yet a durable rule.
- xstockstrat-ui durable suites carry no rule whose subject (OFFLINE order routing, order status, or
  portfolio broker-only fields / broker aggregates) this feature could touch (existing suites: signal
  cues feature 155, config-ui fundamentals trigger feature 156).
- `platform.feature` carries no cross-service rule this feature could touch.
- **C-16 note:** the offline guarantees 159 refines exist only as *pending* scenarios in
  `docs/roadmap/features/157-offline-account-portfolios/acceptance.feature` (157 not yet launched) — no
  durable C-16 guard exists yet. Treat 157's `acceptance.feature` as the de-facto regression baseline.

## Dependencies

- Proto/RPC: none changed. Reads `PlaceOrder` (offline branch), `BrokerType.OFFLINE=3`
  (`common.proto:74`), `Order.brokerType=20`, `OrderStatus` (`trading.proto:81-90`), `Portfolio.realized_pnl=12`.
- Migration: none (trading last = 008, portfolio last = 012).
- Config keys: none.
- Inter-service edges: none new (UI already dials trading/portfolio via BFF).
- New env vars / ports: none.

## Risks / Not-found

- **Root-cause of CANCELED needs the request payload to confirm the exact trigger** (trading recon
  `## Not found`): no backend path CANCELs an offline order with empty `broker_order_id`, so the order
  must not have taken the offline branch — most likely `account_id=''` (combined view, `selectedAccountId`
  undefined → `?? ''`) hit `resolveAccount`'s sole-broker fallback and was submitted to the real broker,
  which canceled it. The fix (always submit an offline order with its explicit `account_id`, only from a
  context where an offline account is unambiguously selected) removes the misroute regardless.
- **C-10(b) parity divergence (fails.md 056 shape):** `ListPositions` surfaces an offline account's
  positions; `ListPortfolios` all-accounts view omits it. For THIS feature the divergence *satisfies*
  FR-4 (offline excluded from broker aggregates). "Fixing" the divergence (rendering offline in the
  combined view) would be new capability, not one of the two reported defects — carry as a possible
  follow-up, do not fold in.
- **No `is_offline` marker on `Portfolio` proto** — the UI must key offline gating on the *account's*
  `brokerType` (available via `useAccountContext`), not on portfolio data. Already the established pattern.
- `PortfolioPanel` has no per-account brokerType prop — derives via `accounts.find(...)` (UI recon `## Not found`).

## Recommended Scope

UI-only, in `xstockstrat-ui`. Advisory step boundaries:
1. **Order ticket gate (FR-1/FR-2):** in `OrderForm.tsx`, detect the selected account's `isOffline`
   and prevent a broker-routed submit for it (hide/disable the broker ticket) — replacing it with, or
   gating in, an offline "Record order" path that submits `placeOrder` with the **explicit** offline
   `account_id` so the backend records NEW. (Design fork: minimal disable vs. dedicated Record-order control.)
2. **Portfolio card gate (FR-3):** in `PortfolioPanel.tsx`, gate Cash / Buying Power / Day P&L on
   `!isOffline`; show only positions market value, unrealized P&L, and the already-gated Realized P&L.
3. **Combined header (FR-4):** confirm-and-assert offline is excluded from broker aggregates (already
   true via ListPortfolios) with a regression test; no code change expected.
4. **Regression tests:** extend `e2e/trader/offline-accounts.spec.ts` (@AC-1/2/3) with reused fixtures.
