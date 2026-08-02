# Recon: position-and-order-detail-pages

**Created**: 2026-08-02
**From**: product-spec.md
**Affected services**: `xstockstrat-ui` (only)

---

## Objective

Build the Nocturne handoff's dedicated single-Position page and single-Order ticket page as real
`/trader` routes, reusing the enriched `Position` fields, `ListOrders`, `GetOrder`, `GetBars`, and
the existing Replace/Cancel order mutations — no backend behavior change, no faked data.

## Codebase Map

- **`xstockstrat-ui`** (Next.js 15 / React 18 / TS)
  - Trader segment layout + providers: `services/xstockstrat-ui/src/app/trader/layout.tsx`,
    `services/xstockstrat-ui/src/app/trader/providers.tsx:9` (wraps `AccountProvider`).
  - Exposure list (row-click Sheet today): `services/xstockstrat-ui/src/app/trader/positions/page.tsx:63`
    — local helpers `sideLabel:41`, `openR:47`, `fmtR:53`, `isExitFlag:59`; row quick-trade
    `Link href="/trader?symbol="` at `:370`; enriched `Position` risk fields consumed `:302–:358`.
  - Order detail (read-only card today): `services/xstockstrat-ui/src/app/trader/orders/[id]/page.tsx:21`.
  - Portfolio (Book) with position rows: `services/xstockstrat-ui/src/app/trader/portfolio/page.tsx`.
  - Data hooks: `usePositions` `services/xstockstrat-ui/src/hooks/usePortfolio.ts:41`;
    `useOrders`/`useOrder` `services/xstockstrat-ui/src/hooks/useOrders.ts:33,60`;
    `usePositionLineage` `services/xstockstrat-ui/src/hooks/usePositionLineage.ts:10`;
    `useReplaceOrder` `.../hooks/useReplaceOrder.ts`; `useCancelOrder` `.../hooks/useCancelOrder.ts`.
  - Trader BFF: `services/xstockstrat-ui/src/lib/traderBff.ts:67` (`PortfolioService` — registers
    `getPortfolio`, `listPortfolios`, `listPositions`; **no `getPosition`**).
  - Browser client: `services/xstockstrat-ui/src/lib/browserClients/portfolioClient.ts` (baseUrl
    `/trader/api`).
  - Chart hook: `services/xstockstrat-ui/src/hooks/useCandlestickChart.ts:12`; bar mapping +
    timeframes `services/xstockstrat-ui/src/lib/chart.ts`.
  - Money/format + risk display: `services/xstockstrat-ui/src/lib/money.ts` (`fmtUsd`,
    `fmtSignedUsd`, `fmtPct`, `pnlClass`); order labels `services/xstockstrat-ui/src/components/trader/orderShared.tsx`.
  - Shared UI: `components/ui/{card,badge,button,table,input,select,sheet,skeleton}.tsx`,
    `components/shared/{StatTile,EmptyState,CardNotice}.tsx`, `EditOrderDialog.tsx`,
    `BackToDashboardButton.tsx`, `lib/opportunityShared.tsx` (`POSITION_RISK_FLAG`, `EnumBadge`).
  - Nav: `components/shared/navGroups.tsx` (Book → Exposure `/trader/positions`, Orders
    `/trader/orders`), `PlatformHeader.tsx:57` (`PLATFORM_SUBNAV`), `resolveActive:87`
    (`startsWith` match → detail routes inherit their parent nav item's breadcrumb).
  - Proto: `packages/proto/portfolio/v1/portfolio.proto:43` (`Position` w/ risk fields 14–19),
    `:120` (`GetPositionRequest{user_id,symbol,trading_mode,account_id?}`), `:11`
    (`GetPosition` RPC); `packages/proto/trading/v1/trading.proto:32` (`Order`), `:145`
    (`ReplaceOrderRequest`), `:105` (`CancelOrderRequest`).
  - E2E: `e2e/mock-backend.ts:165` (`PortfolioService` mock — `listPositions` at `:184`, **no
    `getPosition`**), `e2e/trader/positions.spec.ts`, `e2e/trader/orders.spec.ts`,
    `e2e/nav-reachability.spec.ts`, `e2e/mobile-overflow.spec.ts`, `e2e/warmup.setup.ts:14`
    (`ROUTES`), fixtures `e2e/fixtures/` + `INVENTORY.md`.

## Patterns to REUSE

- Single-record fetch hook → mirror `useOrder` (`useOrders.ts:60`) for a new `usePosition`.
- Candlestick chart → reuse `useCandlestickChart` + `mapBars`/`TIMEFRAMES` (`lib/chart.ts`), exactly
  as `app/insights/market/[symbol]/page.tsx` already does.
- Money/P&L formatting → reuse `lib/money.ts`; **extract** `openR`/`fmtR`/`sideLabel`/`isExitFlag`
  out of `positions/page.tsx` into a shared `lib/positionRisk.ts` (both the Exposure list and the
  new page need them — second consumer forces centralization, DRY guard C-12/C-13).
- Risk stat tiles → reuse `StatTile`; risk-flag badge → `EnumBadge` + `POSITION_RISK_FLAG`.
- Orders table cells / status+side badges / type labels → reuse `components/trader/orderShared.tsx`.
- Order Replace/Cancel → reuse `EditOrderDialog` + `useReplaceOrder` + `useCancelOrder` (do not
  re-implement the mutation path).
- BFF method → add `getPosition` to `traderBff.ts` `PortfolioService` block following the existing
  `listPositions` shape (inject `userId: claims.user_id`, `backendHeaders`).
- Empty/skeleton/error → `EmptyState` / `Skeleton` / `CardNotice`.

## Dependencies

- Proto/RPC: **none new** — `PortfolioService.GetPosition` already exists
  (`portfolio.proto:11`, request `:120`); 096 only exposes it through the trader BFF (additive
  router method) + a browser hook.
- Migration: none.
- Config keys: none.
- Inter-service edges: none new (UI already a gRPC client of portfolio/trading/marketdata).
- New env vars / ports: none.

## Risks / Not-found

- **No `thesis` / `target` / `realized_pnl` field** on `Position` — the prototype shows these; there
  is no source. Carry forward as **omit, not fabricate** (P-03); they are feature 095's scope.
- **No `strategy_id` on `Position`** — derive the owning strategy from the symbol's orders
  (`Order.strategy_id`); degrade to "—" when none. Traceable, not invented.
- `GetPosition` mock does not exist in `e2e/mock-backend.ts` — must be added (Step 5) alongside the
  BFF method, or the page's query 404s in e2e.
- `resolveActive` (`PlatformHeader.tsx:87`) already routes `/trader/positions/*` → Book via
  `startsWith`; confirm no regression to the exact-match `Dashboard` item.

## Recommended Scope

1. Shared `lib/positionRisk.ts` + refactor Exposure list to use it (DRY).
2. `getPosition` BFF method + `usePosition` hook + `portfolioClient` (already generic).
3. `/trader/positions/[symbol]/page.tsx` — the new page.
4. `/trader/orders/[id]/page.tsx` — ticket-grammar upgrade + Replace/Cancel.
5. Exposure + Portfolio rows link to the Position page.
6. Tests: `getPosition` mock, position-page + order-ticket specs, warmup ROUTES, reachability + mobile-overflow coverage.
