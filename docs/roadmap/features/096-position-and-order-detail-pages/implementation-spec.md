# Implementation Spec: position-and-order-detail-pages

**Status**: `done`
**Created**: 2026-08-02
**Feature**: `docs/roadmap/features/096-position-and-order-detail-pages/feature.md`
**Total Steps**: 6
**Feature Branch**: `feature/position-and-order-detail-pages`

---

## Execution Summary

Frontend-only, additive. Step 1 centralizes the position-risk display helpers (DRY). Step 2 exposes
the already-existing `GetPosition` RPC through the trader BFF and adds a `usePosition` hook. Step 3
builds the new dedicated Position page; Step 4 upgrades the Order detail page to the ticket grammar
with working-order Replace/Cancel; Step 5 links Exposure + Portfolio rows to the Position page. Step
6 adds the `getPosition` mock, the two new specs, warmup route, and runs the full verification gate.
There is **no** proto / migration / config step — `GetPosition` already exists, and every value is
sourced from data the platform already returns (C-11 grounding is design.md + recon.md).

Consumer-surface coverage (C-14): the only surface is `/trader` (UI); Steps 3–5 land it. No Agent
tool. No internal-only backend change.

## Step Dependencies

- Step 3 requires Step 1 (imports `lib/positionRisk.ts`) and Step 2 (`usePosition`).
- Step 5 requires Step 3 (links target the new route).
- Step 6 requires Steps 2–5 (mock + specs exercise the BFF method, both pages, and the links).
- No step is base-chained to `main-dev`; all land on the feature branch (F-03).

---

### Step 1 — service: extract shared position-risk display helpers

**Status**: `done`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/lib/positionRisk.ts` — create
- `services/xstockstrat-ui/src/app/trader/positions/page.tsx` — modify (import the helpers, drop the local copies)

**Reviewers**: `xstockstrat-ui` — Trading UI correctness, Connect-RPC call safety, no secret values rendered

**Codebase Evidence**:
- Confirmed via: `grep -n "function openR\|function fmtR\|function sideLabel\|function isExitFlag" services/xstockstrat-ui/src/app/trader/positions/page.tsx` → lines 41, 47, 53, 59.
- Existing pattern: `openR(p)` = `unrealizedPnl / riskAtStop` (null when no stop); `fmtR` → `"+0.8R"`; `sideLabel(qty)` → `qty<0?'Short':'Long'`; `isExitFlag` → `flag === REDUCE_SIGNAL || STOP_NEAR`.

**TDD**: `N/A (pure refactor — behavior covered by existing e2e/trader/positions.spec.ts; no new behavior)`

**Instructions**:
- Create `lib/positionRisk.ts` exporting `openR(p: Position): number | null`, `fmtR(r: number | null): string`, `sideLabel(qty): string`, `isExitFlag(p: Position): boolean` — moved verbatim from `positions/page.tsx`.
- In `positions/page.tsx`, delete the four local functions and import them from `@/lib/positionRisk`.

**Verification**:
- `cd services/xstockstrat-ui && pnpm exec tsc --noEmit` passes; `grep -c "function openR" src/app/trader/positions/page.tsx` → `0`; `pnpm exec jscpd --config ../../.jscpd.json --threshold 0 src` reports no new clones.

---

### Step 2 — service: expose GetPosition via trader BFF + usePosition hook

**Status**: `done`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/lib/traderBff.ts` — modify (add `getPosition` to the `PortfolioService` block)
- `services/xstockstrat-ui/src/hooks/usePortfolio.ts` — modify (add `usePosition`)

**Reviewers**: `xstockstrat-ui` — Connect-RPC call safety, environment scope correctness (userId injection)

**Codebase Evidence**:
- Confirmed via: `grep -n "listPositions" services/xstockstrat-ui/src/lib/traderBff.ts` → the `PortfolioService` block at line 67; `grep -n "GetPosition" packages/proto/portfolio/v1/portfolio.proto` → RPC `:12`, `GetPositionRequest{user_id,symbol,trading_mode,account_id?}` `:120`.
- Existing pattern: `async listPositions(req, ctx){ const claims = await requireSession(ctx); return portfolioClient.listPositions({ ...req, userId: claims.user_id }, { headers: backendHeaders(claims, ctx) }); }`.

**TDD**: `red-green required`

**Instructions**:
- In `traderBff.ts`, add to the `PortfolioService` service map a `getPosition` method following `listPositions` exactly: `requireSession`, spread `req`, inject `userId: claims.user_id`, `headers: backendHeaders(claims, ctx)`.
- In `usePortfolio.ts`, add `usePosition(symbol, mode, selectedAccountId)`: `useQuery` keyed `['position', mode, selectedAccountId, symbol]`, calls `portfolioClient.getPosition({ tradingMode, symbol, ...(accountId?{accountId}:{}) })`, `enabled: !!symbol`, `refetchInterval: 10_000` (matches `usePositions`).

**Verification**:
- Covered by Step 6's `e2e/trader/position-detail.spec.ts` (the page's `getPosition` call reaches the mock and renders). `pnpm exec tsc --noEmit` passes.

---

### Step 3 — service: dedicated single-Position page

**Status**: `done`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/app/trader/positions/[symbol]/page.tsx` — create

**Reviewers**: `xstockstrat-ui` — Nocturne fidelity, Connect-RPC call safety, C-10(b) valuation parity, no secret values rendered

**Codebase Evidence**:
- Confirmed via: `sed -n '60,120p' services/xstockstrat-ui/src/app/insights/market/[symbol]/page.tsx` (chart via `useCandlestickChart` + `getBars` + `mapBars`); `grep -n "POSITION_RISK_FLAG\|StatTile\|EnumBadge" services/xstockstrat-ui/src/app/trader/positions/page.tsx`.
- Existing pattern: `useParams<{symbol:string}>()`; `AppShell` wrapper; `StatTile` risk row; `orderShared.tsx` badges for the orders table.

**TDD**: `red-green required`

**Instructions**:
- New client page (`'use client'`) wrapped in `AppShell`. Read `useParams` symbol; `useAccountContext` for `selectedAccountId` + `environmentMode`.
- `usePosition(symbol, mode, accountId)` → header (symbol, `sideLabel`+qty, `currentPrice`, day change $/% via `fmtSignedUsd`/`fmtPct`, weight, big Unrealized + `fmtR(openR)`), stat grid (`StatTile`), and risk sidebar (factor / exitRule / flag `EnumBadge` / stop-distance meter / risk-at-stop rows + Manage buttons + broker block).
- Chart: `useCandlestickChart` + `getBars` on symbol/timeframe change (copy the effect from `market/[symbol]/page.tsx`); after `setData`, add `createPriceLine` for `avgEntryPrice` (label "avg cost") and, when `stopPrice>0`, `stopPrice` (label "stop").
- Orders & fills: `useOrders(mode, accountId, { symbol })` in a `Table` using `orderShared.tsx` `OrderSideBadge`/`OrderStatusBadge`/`TYPE_LABEL`; each row `Link` → `/trader/orders/[id]`.
- Owning strategy: derive most-frequent `strategyId` from the orders; link `/insights/strategies/<id>`; omit block when none.
- States: `Skeleton` while loading, `EmptyState` "Position not found" when `getPosition` returns empty, `text-destructive` on error. Responsive `grid-cols-1 lg:grid-cols-[1fr_320px]`; `min-h-[44px]` controls; tables in `overflow-x-auto`.
- Import `openR`/`fmtR`/`sideLabel` from `@/lib/positionRisk`; money from `@/lib/money`; no fabricated thesis/target/realized/R:R.

**Verification**:
- Covered by Step 6 `position-detail.spec.ts`. `pnpm exec tsc --noEmit` + `pnpm lint` pass.

---

### Step 4 — service: single-Order ticket page (upgrade in place)

**Status**: `done`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/app/trader/orders/[id]/page.tsx` — modify

**Reviewers**: `xstockstrat-ui` — Nocturne fidelity, order-mutation (Replace/Cancel) safety, Connect-RPC call safety

**Codebase Evidence**:
- Confirmed via: `sed -n '1,89p' services/xstockstrat-ui/src/app/trader/orders/[id]/page.tsx` (read-only card, `useOrder`); `grep -n "EditOrderDialog\|useReplaceOrder\|useCancelOrder" services/xstockstrat-ui/src -r`.
- Existing pattern: `EditOrderDialog` opens a Replace Sheet from a working order; `useCancelOrder` invalidates `['orders']`+`['order',id]`; `OrderStatus.NEW/PARTIALLY_FILLED` gate.

**TDD**: `red-green required`

**Instructions**:
- Keep `useOrder(orderId)`. Re-lay-out to: header (symbol + `OrderSideBadge` + `OrderStatusBadge` + order id) and a two-column body — left field grid (type/TIF/qty/filled/limit/stop/avg fill/account/strategy/broker order id/mode), right **Order preview** card (notional `qty×(limitPrice||filledAvgPrice)` via `fmtUsd`, filled % , remaining qty, origin strategy).
- For `status ∈ {NEW, PARTIALLY_FILLED}`: render **Edit** (opens `EditOrderDialog` with the order) and **Cancel** (`useCancelOrder().mutate({orderId})`, confirm inline); hide both otherwise.
- Responsive `grid-cols-1 lg:grid-cols-[1fr_300px]`; `min-h-[44px]` buttons; keep `BackToDashboardButton`.

**Verification**:
- Covered by Step 6 `order-ticket.spec.ts`. `pnpm exec tsc --noEmit` + `pnpm lint` pass.

---

### Step 5 — service: link Exposure + Portfolio rows to the Position page

**Status**: `done`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/app/trader/positions/page.tsx` — modify (row → `/trader/positions/[symbol]`; keep Sheet as quick peek + add "Open full view" link)
- `services/xstockstrat-ui/src/app/trader/portfolio/page.tsx` — modify (position rows link to the page)

**Reviewers**: `xstockstrat-ui` — C-10(a) nav reachability, Trading UI correctness

**Codebase Evidence**:
- Confirmed via: `grep -n "setSelected(p)\|href=\"/trader?symbol" services/xstockstrat-ui/src/app/trader/positions/page.tsx` → row onClick `:299`, quick-trade `:370`; `grep -n "symbol" services/xstockstrat-ui/src/app/trader/portfolio/page.tsx`.
- Existing pattern: Exposure row `onClick={() => setSelected(p)}`; quick-Trade `Link href="/trader?symbol="` with `stopPropagation`.

**TDD**: `red-green required`

**Instructions**:
- Exposure: make the symbol cell a `Link` to `/trader/positions/<symbol>` (keep the row's Sheet peek and the quick-Trade shortcut, both with `stopPropagation`), and add an "Open full view →" link in the Sheet header.
- Portfolio: wrap each position row's symbol in a `Link` to `/trader/positions/<symbol>`.

**Verification**:
- Covered by Step 6 reachability assertion. `pnpm lint` + `pnpm exec tsc --noEmit` pass.

---

### Step 6 — test: getPosition mock, page specs, warmup, verification gate

**Status**: `done`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/e2e/mock-backend.ts` — modify (add `getPosition` to the `PortfolioService` mock)
- `services/xstockstrat-ui/e2e/fixtures/positions.ts` — create (or extend the existing positions fixture) + `services/xstockstrat-ui/e2e/fixtures/INVENTORY.md` — modify
- `services/xstockstrat-ui/e2e/trader/position-detail.spec.ts` — create
- `services/xstockstrat-ui/e2e/trader/order-ticket.spec.ts` — create
- `services/xstockstrat-ui/e2e/warmup.setup.ts` — modify (add the two detail routes to `ROUTES`)

**Reviewers**: `xstockstrat-ui` — Trading UI correctness; test data from fixtures (C-12/C-13)

**Codebase Evidence**:
- Confirmed via: `grep -n "async listPositions" services/xstockstrat-ui/e2e/mock-backend.ts` → `:184` (PortfolioService mock has no `getPosition`); `sed -n '14,34p' services/xstockstrat-ui/e2e/warmup.setup.ts` (`ROUTES`); `ls services/xstockstrat-ui/e2e/fixtures/`.
- Existing pattern: the `listPositions` mock returns AAPL (factor 'Tech', stop 178, flag 3) + MSFT; `positions.spec.ts` asserts against those.

**TDD**: `red-green required`

**Instructions**:
- Add a `getPosition` handler to the mock `PortfolioService` returning the AAPL fixture (same enriched risk fields as `listPositions`, so AC-3 parity holds). Source the object from `e2e/fixtures/` (new/extended `POSITION_AAPL`), add its `INVENTORY.md` row.
- `position-detail.spec.ts`: goto `/trader/positions/AAPL`; assert header (symbol, side, unrealized), the stat grid, the risk sidebar (factor 'Tech', "Stop near"), the Orders & fills table, and AC-3 parity (AAPL unrealized matches the Exposure list value). Add the reachability click-through: Book → Exposure → row → `/trader/positions/AAPL`.
- `order-ticket.spec.ts`: a working order (`mock-order-002`, status NEW) shows Edit + Cancel and the order-preview; a filled order (`mock-order-001`) shows neither.
- Add `'/trader/positions/AAPL'` and `'/trader/orders/mock-order-001'` to warmup `ROUTES`.

**Verification**:
- `cd services/xstockstrat-ui && pnpm exec tsc --noEmit && pnpm lint && pnpm run test:unit && pnpm exec jscpd --config ../../.jscpd.json --threshold 0 src` all pass; `pnpm test:e2e -g "position detail|order ticket|nav reachability|mobile"` passes locally (or note the CI-only e2e environment).

---

## Deviation Log

_Populated by /sdd-execute as implementation proceeds._

### 2026-08-10 — retroactive status correction (no code change)

All 6 steps were implemented directly in the 2026-08-02 authoring session (see context.md) and
shipped as PR #855 (`7f6f65e`), merged straight to `main-dev` rather than through the normal
per-step `/sdd-execute` flow. This spec's step statuses were never flipped to `done` at the time,
so the feature stayed at `implementation-ready` for over a week after the code was live in
production (promoted to `main` via PR #875, commit `c1d1882`, 2026-08-06). All 6 steps are marked
`done` here to match reality — verified against the shipped diff (PR #855): `lib/positionRisk.ts`
(Step 1), `traderBff.ts`/`usePortfolio.ts` `getPosition`/`usePosition` (Step 2),
`trader/positions/[symbol]/page.tsx` (Step 3), `trader/orders/[id]/page.tsx` (Step 4), Exposure/
Portfolio row links (Step 5), and `mock-backend.ts`/fixtures/specs/warmup routes (Step 6) are all
present on `main-dev` as of this correction.
