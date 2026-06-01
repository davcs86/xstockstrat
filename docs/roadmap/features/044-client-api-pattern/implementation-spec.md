# Implementation Spec: client-api-pattern

**Status**: `complete`
**Created**: 2026-06-01
**Feature**: `docs/roadmap/features/044-client-api-pattern/feature.md`
**Total Steps**: 11
**Feature Branch**: `feature/client-api-pattern`

---

## Execution Summary

This feature replaces SWR with `@connectrpc/connect-query` + TanStack Query v5 + `@normy/react-query` across all three Next.js frontends. Steps 1–3 install the new dependencies and add the shared `QueryClientProvider`/`NormalizationProvider` wiring to each service's `layout.tsx`. Steps 4–6 migrate SWR call sites in trader, insights, and config-ui to named typed hooks backed by the existing `browserClients.ts` Connect clients (which already expose `GenService` descriptors from `*_pb.ts`). Steps 7–9 eliminate remaining `any` usage from route handlers, `identity.ts` files, and component internals. Steps 10–11 update the CLAUDE.md files and create the pattern documentation. The order matters: dependency steps must precede hook migrations; hook migrations must precede the `any` cleanup steps that verify `tsc --noEmit` passes.

## Step Dependencies

- Step 4 requires Step 1: trader hooks depend on `@connectrpc/connect-query` being installed
- Step 5 requires Step 2: insights hooks depend on the same installation
- Step 6 requires Step 3: config-ui hooks depend on the same installation
- Step 7 requires Steps 4, 5, 6: `any` elimination proceeds after all hooks are written
- Steps 8, 9 require Steps 4, 5, 6: same
- Step 10 requires Steps 4, 5, 6, 7, 8, 9: CLAUDE.md updates reflect completed changes
- Step 11 requires all: pattern doc is written last

---

### Step 1 — service: Add connect-query deps + QueryClient provider to xstockstrat-trader

**Status**: `pending`
**Service**: `xstockstrat-trader`
**Files**:
- `services/xstockstrat-trader/package.json` — modify
- `services/xstockstrat-trader/src/lib/queryClient.ts` — create
- `services/xstockstrat-trader/src/app/layout.tsx` — modify

**Reviewers**: xstockstrat-trader service owner — Trading UI correctness, Connect-RPC call safety, no direct DB access from frontend

**Codebase Evidence**:
- Confirmed `swr: ^2.2.5` present: `grep -n "swr" services/xstockstrat-trader/package.json` → line 41
- No `@connectrpc/connect-query` or `@tanstack/react-query` currently: `grep -n "connect-query\|tanstack\|normy" services/xstockstrat-trader/package.json` → no match
- `layout.tsx` currently has only `AccountProvider` as a wrapper, no query provider: confirmed via `services/xstockstrat-trader/src/app/layout.tsx` L13–L21
- `@xstockstrat/proto`: `workspace:*` confirmed present at `services/xstockstrat-trader/package.json` L31

**Instructions**:

1. In `services/xstockstrat-trader/package.json`, under `"dependencies"`:
   - Remove `"swr": "^2.2.5"`
   - Add `"@connectrpc/connect-query": "^1.4.2"` (latest stable as of spec date — check npmjs if later version available)
   - Add `"@tanstack/react-query": "^5.62.0"`
   - Add `"@normy/react-query": "^1.1.0"`

2. Create `services/xstockstrat-trader/src/lib/queryClient.ts` with the following content:

   ```ts
   /**
    * Shared TanStack Query client + normy normalization for xstockstrat-trader.
    * Normalization keys: orderId and strategyId only (per feature 044 decision).
    */
   import { QueryClient } from '@tanstack/react-query';
   import { createNormalizer } from '@normy/react-query';

   export const normalizer = createNormalizer({
     getNormalizationObjectKey: (obj: Record<string, unknown>) => {
       if (typeof obj.orderId === 'string' && obj.orderId) return `order:${obj.orderId}`;
       if (typeof obj.strategyId === 'string' && obj.strategyId) return `strategy:${obj.strategyId}`;
       return undefined;
     },
   });

   export function createQueryClient(): QueryClient {
     return new QueryClient({
       defaultOptions: {
         queries: {
           staleTime: 5_000,
           retry: 1,
         },
       },
     });
   }
   ```

3. In `services/xstockstrat-trader/src/app/layout.tsx`:
   - Add `'use client';` directive is **not** added to `layout.tsx` (it is a Server Component). Instead, create a new `src/app/providers.tsx` Client Component:

   Create `services/xstockstrat-trader/src/app/providers.tsx`:
   ```tsx
   'use client';
   import { useState } from 'react';
   import { QueryClientProvider } from '@tanstack/react-query';
   import { NormalizationProvider } from '@normy/react-query';
   import { normalizer, createQueryClient } from '@/lib/queryClient';
   import { AccountProvider } from '@/context/AccountContext';

   export function Providers({ children }: { children: React.ReactNode }) {
     const [queryClient] = useState(() => createQueryClient());
     return (
       <QueryClientProvider client={queryClient}>
         <NormalizationProvider normalizer={normalizer}>
           <AccountProvider>{children}</AccountProvider>
         </NormalizationProvider>
       </QueryClientProvider>
     );
   }
   ```

   Modify `services/xstockstrat-trader/src/app/layout.tsx` to import and use `Providers` instead of `AccountProvider` directly:
   - Remove: `import { AccountProvider } from '@/context/AccountContext';`
   - Add: `import { Providers } from './providers';`
   - Replace `<AccountProvider>{children}</AccountProvider>` with `<Providers>{children}</Providers>`

**Verification**:
```bash
cd services/xstockstrat-trader && pnpm install && pnpm exec tsc --noEmit 2>&1 | grep -c "error TS" || echo "0 errors"
```
Confirm `0 errors` (or only errors in SWR call sites not yet migrated; those are resolved in Step 4).

---

### Step 2 — service: Add connect-query deps + QueryClient provider to xstockstrat-insights

**Status**: `pending`
**Service**: `xstockstrat-insights`
**Files**:
- `services/xstockstrat-insights/package.json` — modify
- `services/xstockstrat-insights/src/lib/queryClient.ts` — create
- `services/xstockstrat-insights/src/app/layout.tsx` — modify
- `services/xstockstrat-insights/src/app/providers.tsx` — create

**Reviewers**: xstockstrat-insights service owner — Analytics display accuracy, SSE polling resilience, read-only access pattern

**Codebase Evidence**:
- Confirmed `swr: ^2.2.5` in `services/xstockstrat-insights/package.json` L41
- No `@connectrpc/connect-query` or `@tanstack/react-query`: grep → no match
- `layout.tsx` has no provider at all: `services/xstockstrat-insights/src/app/layout.tsx` L13–L18 — body wraps `{children}` with no wrapper

**Instructions**:

1. In `services/xstockstrat-insights/package.json`, under `"dependencies"`:
   - Remove `"swr": "^2.2.5"`
   - Add `"@connectrpc/connect-query": "^1.4.2"`
   - Add `"@tanstack/react-query": "^5.62.0"`
   - Add `"@normy/react-query": "^1.1.0"`

2. Create `services/xstockstrat-insights/src/lib/queryClient.ts` — identical content to the trader version in Step 1 (same normalization keys: `orderId` and `strategyId` only).

3. Create `services/xstockstrat-insights/src/app/providers.tsx`:
   ```tsx
   'use client';
   import { useState } from 'react';
   import { QueryClientProvider } from '@tanstack/react-query';
   import { NormalizationProvider } from '@normy/react-query';
   import { normalizer, createQueryClient } from '@/lib/queryClient';

   export function Providers({ children }: { children: React.ReactNode }) {
     const [queryClient] = useState(() => createQueryClient());
     return (
       <QueryClientProvider client={queryClient}>
         <NormalizationProvider normalizer={normalizer}>
           {children}
         </NormalizationProvider>
       </QueryClientProvider>
     );
   }
   ```

4. Modify `services/xstockstrat-insights/src/app/layout.tsx`:
   - Add import: `import { Providers } from './providers';`
   - Wrap `{children}` in `<Providers>{children}</Providers>` inside the `<body>` element (replacing the bare `{children}` at L17)

**Verification**:
```bash
cd services/xstockstrat-insights && pnpm install && pnpm exec tsc --noEmit 2>&1 | grep -c "error TS" || echo "0 errors"
```

---

### Step 3 — service: Add connect-query deps + QueryClient provider to xstockstrat-config-ui

**Status**: `pending`
**Service**: `xstockstrat-config-ui`
**Files**:
- `services/xstockstrat-config-ui/package.json` — modify
- `services/xstockstrat-config-ui/app/lib/queryClient.ts` — create
- `services/xstockstrat-config-ui/app/layout.tsx` — modify
- `services/xstockstrat-config-ui/app/providers.tsx` — create

**Reviewers**: xstockstrat-config-ui service owner — Config mutation safety, environment scope correctness, no secret values rendered in UI

**Codebase Evidence**:
- Confirmed `swr: ^2.2.5` in `services/xstockstrat-config-ui/package.json` L41
- config-ui uses flat directory (`app/` not `src/app/`): confirmed via find output — files under `services/xstockstrat-config-ui/app/`
- tsconfig `@/*` maps to `"./*"` (not `"./src/*"`): `services/xstockstrat-config-ui/tsconfig.json` L26
- `app/layout.tsx` wraps `<main>` directly with `{children}` at L63 — no query provider

**Instructions**:

1. In `services/xstockstrat-config-ui/package.json`, under `"dependencies"`:
   - Remove `"swr": "^2.2.5"`
   - Add `"@connectrpc/connect-query": "^1.4.2"`
   - Add `"@tanstack/react-query": "^5.62.0"`
   - Add `"@normy/react-query": "^1.1.0"`

2. Create `services/xstockstrat-config-ui/app/lib/queryClient.ts` — identical normalization content to Steps 1–2.

3. Create `services/xstockstrat-config-ui/app/providers.tsx`:
   ```tsx
   'use client';
   import { useState } from 'react';
   import { QueryClientProvider } from '@tanstack/react-query';
   import { NormalizationProvider } from '@normy/react-query';
   import { normalizer, createQueryClient } from '@/app/lib/queryClient';

   export function Providers({ children }: { children: React.ReactNode }) {
     const [queryClient] = useState(() => createQueryClient());
     return (
       <QueryClientProvider client={queryClient}>
         <NormalizationProvider normalizer={normalizer}>
           {children}
         </NormalizationProvider>
       </QueryClientProvider>
     );
   }
   ```

   Note: config-ui uses `@/app/lib/queryClient` (tsconfig maps `@/*` → `./*`, so `@/app/lib/queryClient` resolves to `./app/lib/queryClient`).

4. Modify `services/xstockstrat-config-ui/app/layout.tsx`:
   - Add import: `import { Providers } from './providers';`
   - Wrap `<main className="p-4 sm:p-6">{children}</main>` with `<Providers>` around the `{children}` only:
     ```tsx
     <main className="p-4 sm:p-6">
       <Providers>{children}</Providers>
     </main>
     ```

**Verification**:
```bash
cd services/xstockstrat-config-ui && pnpm install && pnpm exec tsc --noEmit 2>&1 | grep -c "error TS" || echo "0 errors"
```

---

### Step 4 — service: Migrate SWR call sites to typed hooks in xstockstrat-trader

**Status**: `done`
**Service**: `xstockstrat-trader`
**Files**:
- `services/xstockstrat-trader/src/hooks/useOrders.ts` — create
- `services/xstockstrat-trader/src/hooks/usePortfolio.ts` — create
- `services/xstockstrat-trader/src/hooks/usePlaceOrder.ts` — create
- `services/xstockstrat-trader/src/components/OrderBook.tsx` — modify
- `services/xstockstrat-trader/src/components/PortfolioPanel.tsx` — modify
- `services/xstockstrat-trader/src/app/orders/[id]/page.tsx` — modify
- `services/xstockstrat-trader/src/app/positions/page.tsx` — modify
- `services/xstockstrat-trader/src/components/OrderForm.tsx` — modify

**Reviewers**: xstockstrat-trader service owner — Trading UI correctness, Connect-RPC call safety, no direct DB access from frontend

**Codebase Evidence**:
- `OrderBook.tsx` uses `useSWR` at L30 and L109: calls `tradingClient.listOrders(...)` and `portfolioClient.getPortfolio(...)` with `refreshInterval: 5000` and `10000`
- `PortfolioPanel.tsx` uses `useSWR` at L26: calls `portfolioClient.listPortfolios(...)` with `refreshInterval: 10000`
- `positions/page.tsx` uses `useSWR` at L30: calls `portfolioClient.getPortfolio(...)` with `refreshInterval: 10_000`
- `orders/[id]/page.tsx` uses `useSWR` at L45: calls `tradingClient.getOrder(...)` with `refreshInterval: 5000`
- `OrderForm.tsx` uses direct `await tradingClient.placeOrder(...)` at L53 — already a mutation pattern (no SWR), but not wrapped in `useMutation` (FR-4 requires it)
- `browserClients.ts` exports `tradingClient`, `portfolioClient`, `marketDataClient`, `notifyClient` at `src/lib/browserClients.ts` L20–23
- `AccountContext.tsx` exposes `useAccountContext()` hook used in `OrderBook`, `PortfolioPanel`, `OrderForm`, `positions/page.tsx`
- No `src/hooks/` directory currently exists: confirmed via file inventory

**Instructions**:

Create `services/xstockstrat-trader/src/hooks/useOrders.ts`:
```ts
import { useQuery } from '@tanstack/react-query';
import { tradingClient } from '@/lib/browserClients';
import { TradingMode as PbTradingMode } from '@xstockstrat/proto/common/v1/common_pb';
import type { ListOrdersResponse } from '@xstockstrat/proto/trading/v1/trading_pb';

export function useOrders(mode: 'paper' | 'live', selectedAccountId: string | null): {
  data: ListOrdersResponse | undefined;
  isLoading: boolean;
  error: Error | null;
} {
  const toPbMode = (m: 'paper' | 'live') =>
    m === 'live' ? PbTradingMode.LIVE : PbTradingMode.PAPER;
  return useQuery({
    queryKey: ['orders', mode, selectedAccountId],
    queryFn: () => tradingClient.listOrders({ tradingMode: toPbMode(mode), page: { pageSize: 50 } }),
    refetchInterval: 5_000,
  });
}

export function useOrder(orderId: string | null | undefined): {
  data: Awaited<ReturnType<typeof tradingClient.getOrder>> | undefined;
  isLoading: boolean;
  error: Error | null;
} {
  return useQuery({
    queryKey: ['order', orderId],
    queryFn: () => tradingClient.getOrder({ orderId: orderId! }),
    enabled: !!orderId,
    refetchInterval: 5_000,
  });
}
```

Create `services/xstockstrat-trader/src/hooks/usePortfolio.ts`:
```ts
import { useQuery } from '@tanstack/react-query';
import { portfolioClient } from '@/lib/browserClients';
import { TradingMode as PbTradingMode } from '@xstockstrat/proto/common/v1/common_pb';

export function usePortfolio(mode: 'paper' | 'live', selectedAccountId: string | null) {
  const toPbMode = (m: 'paper' | 'live') =>
    m === 'live' ? PbTradingMode.LIVE : PbTradingMode.PAPER;
  return useQuery({
    queryKey: ['portfolio', mode, selectedAccountId],
    queryFn: () =>
      portfolioClient.getPortfolio({
        tradingMode: toPbMode(mode),
        ...(selectedAccountId ? { accountId: selectedAccountId } : {}),
      }),
    refetchInterval: 10_000,
  });
}

export function usePortfolios(selectedAccountId: string | null) {
  return useQuery({
    queryKey: ['portfolios', selectedAccountId],
    queryFn: () =>
      portfolioClient.listPortfolios(selectedAccountId ? { accountId: selectedAccountId } : {}),
    refetchInterval: 10_000,
  });
}

export function usePositions(mode: 'paper' | 'live', selectedAccountId: string | null) {
  const toPbMode = (m: 'paper' | 'live') =>
    m === 'live' ? PbTradingMode.LIVE : PbTradingMode.PAPER;
  return useQuery({
    queryKey: ['positions', mode, selectedAccountId],
    queryFn: () =>
      portfolioClient.getPortfolio({
        tradingMode: toPbMode(mode),
        ...(selectedAccountId ? { accountId: selectedAccountId } : {}),
      }),
    refetchInterval: 10_000,
  });
}
```

Create `services/xstockstrat-trader/src/hooks/usePlaceOrder.ts`:
```ts
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { tradingClient } from '@/lib/browserClients';
import type { PlaceOrderRequest, Order } from '@xstockstrat/proto/trading/v1/trading_pb';
import { ConnectError } from '@connectrpc/connect';

export function usePlaceOrder() {
  const queryClient = useQueryClient();
  return useMutation<Order, Error, PlaceOrderRequest>({
    mutationFn: (req) => tradingClient.placeOrder(req),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['orders'] });
    },
    onError: (err) => {
      // ConnectError has rawMessage; fall back to Error.message
      if (err instanceof ConnectError) return err;
      return err;
    },
  });
}
```

Modify `services/xstockstrat-trader/src/components/OrderBook.tsx`:
- Remove line 2: `import useSWR from 'swr';`
- Add: `import { useOrders } from '@/hooks/useOrders';`
- Replace `useSWR(...)` at L30–38 with: `const { data, error, isLoading } = useOrders(mode, selectedAccountId);`
- For `PortfolioSummary` inside `OrderBook.tsx` (if it exists in this file; confirmed at L107–183): remove `useSWR(...)` at L109–117; add `import { usePortfolio } from '@/hooks/usePortfolio';`; replace with `const { data, isLoading, error } = usePortfolio(mode, selectedAccountId);`

Modify `services/xstockstrat-trader/src/components/PortfolioPanel.tsx`:
- Remove line 3: `import useSWR from 'swr';`
- Add: `import { usePortfolios } from '@/hooks/usePortfolio';`
- Replace `useSWR(...)` at L26–33 with: `const { data, isLoading, error } = usePortfolios(selectedAccountId);`

Modify `services/xstockstrat-trader/src/app/orders/[id]/page.tsx`:
- Remove line 2: `import useSWR from 'swr';`
- Add: `import { useOrder } from '@/hooks/useOrders';`
- Replace `useSWR(...)` at L45–49 with: `const { data: order, error, isLoading } = useOrder(orderId);`

Modify `services/xstockstrat-trader/src/app/positions/page.tsx`:
- Remove line 3: `import useSWR from 'swr';`
- Add: `import { usePositions } from '@/hooks/usePortfolio';`
- Replace `useSWR(...)` at L30–38 with: `const { data, error, isLoading } = usePositions(mode, selectedAccountId);`

Modify `services/xstockstrat-trader/src/components/OrderForm.tsx`:
- Add import: `import { usePlaceOrder } from '@/hooks/usePlaceOrder';`
- Replace the existing manual `const [status, setStatus]` + `const [message, setMessage]` + `handleSubmit` with `useMutation` pattern:
  - Add: `const { mutate: placeOrder, isPending, error: placeError } = usePlaceOrder();`
  - Update `handleSubmit` to call `placeOrder(req, { onSuccess: ..., onError: ... })` instead of `await tradingClient.placeOrder(...)`
  - Replace `status === 'submitting'` with `isPending`

**Verification**:
```bash
cd services/xstockstrat-trader && pnpm exec tsc --noEmit && grep -rn "useSWR\|from 'swr'" src/ && echo "SWR STILL PRESENT" || echo "SWR removed"
```
Confirm: `tsc --noEmit` exits 0. `grep` for SWR returns no matches.

---

### Step 5 — service: Migrate SWR call sites to typed hooks in xstockstrat-insights

**Status**: `done`
**Service**: `xstockstrat-insights`
**Files**:
- `services/xstockstrat-insights/src/hooks/useStrategies.ts` — create
- `services/xstockstrat-insights/src/hooks/useBacktest.ts` — create
- `services/xstockstrat-insights/src/hooks/useAccountPortfolios.ts` — create
- `services/xstockstrat-insights/src/app/page.tsx` — modify
- `services/xstockstrat-insights/src/app/strategies/page.tsx` — modify
- `services/xstockstrat-insights/src/app/strategies/[id]/page.tsx` — modify
- `services/xstockstrat-insights/src/components/AccountPortfolioSelector.tsx` — modify

**Reviewers**: xstockstrat-insights service owner — Analytics display accuracy, SSE polling resilience, read-only access pattern

**Codebase Evidence**:
- `src/app/page.tsx` uses `useSWR(['analysis-strategies'], ...)` at L68–72 calling `analysisClient.listStrategies(...)` with `refreshInterval: 30000`
- `src/app/strategies/page.tsx` uses `useSWR(['analysis-strategies'], ...)` at L23–27 — same query key as `page.tsx`; after migration both use the same hook for cache sharing
- `src/app/strategies/[id]/page.tsx` uses `useSWR(['analysis-report', id], ...)` at L22–25; also calls `analysisClient.runBacktest(...)` directly (mutation) at L47–58
- `src/components/AccountPortfolioSelector.tsx` uses `useSWR(['acct-portfolios', accountId], async () => Promise.all([...]), ...)` at L35–45 with `refreshInterval: 30000`
- `analysisClient`, `tradingClient`, `portfolioClient` in `src/lib/browserClients.ts` L13–23
- `src/app/strategies/[id]/page.tsx` has `backtestResult` typed as `any` at L33 — this is the main `any` to address in Step 7

**Instructions**:

Create `services/xstockstrat-insights/src/hooks/useStrategies.ts`:
```ts
import { useQuery } from '@tanstack/react-query';
import { analysisClient } from '@/lib/browserClients';
import type { ListStrategiesResponse } from '@xstockstrat/proto/analysis/v1/analysis_pb';

export function useStrategies(): {
  data: ListStrategiesResponse | undefined;
  isLoading: boolean;
  error: Error | null;
} {
  return useQuery({
    queryKey: ['analysis-strategies'],
    queryFn: () => analysisClient.listStrategies({ page: { pageSize: 50 } }),
    refetchInterval: 30_000,
  });
}

export function useStrategyReport(strategyId: string | undefined) {
  return useQuery({
    queryKey: ['analysis-report', strategyId],
    queryFn: () => analysisClient.getStrategyReport({ strategyId: strategyId! }),
    enabled: !!strategyId,
  });
}
```

Create `services/xstockstrat-insights/src/hooks/useBacktest.ts`:
```ts
import { useMutation } from '@tanstack/react-query';
import { analysisClient } from '@/lib/browserClients';
import type { RunBacktestRequest, BacktestResult } from '@xstockstrat/proto/analysis/v1/analysis_pb';
import { ConnectError } from '@connectrpc/connect';

export function useRunBacktest() {
  return useMutation<BacktestResult, Error, RunBacktestRequest>({
    mutationFn: (req) => analysisClient.runBacktest(req),
    onError: (err) => {
      if (err instanceof ConnectError) return err;
      return err;
    },
  });
}
```

Create `services/xstockstrat-insights/src/hooks/useAccountPortfolios.ts`:
```ts
import { useQuery } from '@tanstack/react-query';
import { tradingClient, portfolioClient } from '@/lib/browserClients';
import type { BrokerAccount } from '@xstockstrat/proto/trading/v1/trading_pb';
import type { Portfolio } from '@xstockstrat/proto/portfolio/v1/portfolio_pb';

export function useAccountPortfolios(accountId: string) {
  return useQuery<{ accounts: BrokerAccount[]; portfolios: Portfolio[] }>({
    queryKey: ['acct-portfolios', accountId],
    queryFn: async () => {
      const [a, p] = await Promise.all([
        tradingClient.listBrokerAccounts({}),
        portfolioClient.listPortfolios(accountId ? { accountId } : {}),
      ]);
      return { accounts: a.accounts, portfolios: p.portfolios };
    },
    refetchInterval: 30_000,
  });
}
```

Modify `services/xstockstrat-insights/src/app/page.tsx`:
- Remove: `import useSWR from 'swr';`
- Add: `import { useStrategies } from '@/hooks/useStrategies';`
- Replace `useSWR(...)` at L68–72 with: `const { data: strategies } = useStrategies();`
- The `(strategies?.strategies ?? []).map((s: any) => ...)` at L97 — replace `s: any` with the typed `StrategyScore` type (see Step 7 for final `any` elimination). In this step, remove the `useSWR` import only; address `any` in Step 7.

Modify `services/xstockstrat-insights/src/app/strategies/page.tsx`:
- Remove: `import useSWR from 'swr';`
- Add: `import { useStrategies } from '@/hooks/useStrategies';`
- Replace `useSWR(...)` at L23–27 with: `const { data, isLoading, error } = useStrategies();`
- `(data.strategies ?? []).map((s: any) => ...)` at L42 — address in Step 7.

Modify `services/xstockstrat-insights/src/app/strategies/[id]/page.tsx`:
- Remove: `import useSWR from 'swr';`
- Add: `import { useStrategyReport } from '@/hooks/useStrategies';`
- Add: `import { useRunBacktest } from '@/hooks/useBacktest';`
- Replace `useSWR(...)` at L22–25 with: `const { data: report, isLoading } = useStrategyReport(id);`
- Replace direct mutation `runBacktest()` function with `useMutation`:
  - Remove `const [backtestResult, setBacktestResult] = useState<any>(null);` — replace with `useMutation` from `useRunBacktest()`
  - `const { mutate: runBacktestMutate, data: backtestResult, isPending: running, error: runErrorObj } = useRunBacktest();`
  - The `runBacktest()` handler becomes: `runBacktestMutate({ strategyId: id, symbols: [...], initialCapital: ..., range: { ... } });`
  - `runError` → derived from `runErrorObj?.message ?? null`
- The `t: any` in equityCurve at L66 — address in Step 7.

Modify `services/xstockstrat-insights/src/components/AccountPortfolioSelector.tsx`:
- Remove: `import useSWR from 'swr';`
- Add: `import { useAccountPortfolios } from '@/hooks/useAccountPortfolios';`
- Replace `useSWR(...)` at L35–45 with: `const { data, isLoading } = useAccountPortfolios(accountId);`

**Verification**:
```bash
cd services/xstockstrat-insights && pnpm exec tsc --noEmit && grep -rn "useSWR\|from 'swr'" src/ && echo "SWR STILL PRESENT" || echo "SWR removed"
```

---

### Step 6 — service: Migrate useEffect+fetch data-loading to typed hooks in xstockstrat-config-ui

**Status**: `done`
**Service**: `xstockstrat-config-ui`
**Files**:
- `services/xstockstrat-config-ui/app/hooks/useConfigKeys.ts` — create
- `services/xstockstrat-config-ui/app/hooks/useAuditLog.ts` — create
- `services/xstockstrat-config-ui/app/hooks/useSignalSources.ts` — create
- `services/xstockstrat-config-ui/app/hooks/useSetConfig.ts` — create
- `services/xstockstrat-config-ui/app/hooks/useSignalSourceMutations.ts` — create
- `services/xstockstrat-config-ui/app/[namespace]/page.tsx` — modify
- `services/xstockstrat-config-ui/app/audit/page.tsx` — modify
- `services/xstockstrat-config-ui/app/sources/page.tsx` — modify

**Reviewers**: xstockstrat-config-ui service owner — Config mutation safety, environment scope correctness, no secret values rendered in UI

**Codebase Evidence**:
- `app/[namespace]/page.tsx` uses `useEffect` at L56–72 calling `configClient.listKeys(...)` and a re-fetch in `handleSave` at L86–97; mutation uses `configClient.setConfig(...)` at L77–85
- `app/audit/page.tsx` uses `useEffect` at L32–39 calling `fetch(\`${BASE_PATH}/api/audit\`)` — **not** a typed Connect call but a raw `fetch` to `/api/audit`
- `app/sources/page.tsx` uses `useEffect` + `fetchSources` callback (L157–179) calling `ingestClient.listSignalSources(...)` and `configClient.listKeys(...)` for weights; mutations at L203–255 use `ingestClient.manageSignalSource(...)`
- `configClient`, `ingestClient` in `app/lib/browserClients.ts` L18–19
- config-ui tsconfig maps `@/*` → `./*`; hooks go under `app/hooks/`

**Instructions**:

Create `services/xstockstrat-config-ui/app/hooks/useConfigKeys.ts`:
```ts
import { useQuery } from '@tanstack/react-query';
import { configClient } from '@/app/lib/browserClients';
import type { ListKeysResponse } from '@xstockstrat/proto/config/v1/config_pb';
import { Environment, TradingMode } from '@xstockstrat/proto/common/v1/common_pb';

export function useConfigKeys(
  namespace: string,
  env: string,
  mode: string,
): { data: ListKeysResponse | undefined; isLoading: boolean; error: Error | null } {
  function envToProto(e: string): Environment {
    return e === 'production' ? Environment.ENVIRONMENT_PRODUCTION : Environment.ENVIRONMENT_DEV;
  }
  function modeToProto(m: string): TradingMode {
    return m === 'live' ? TradingMode.TRADING_MODE_LIVE
      : m === 'paper' ? TradingMode.TRADING_MODE_PAPER
      : TradingMode.TRADING_MODE_UNSPECIFIED;
  }
  return useQuery({
    queryKey: ['config-keys', namespace, env, mode],
    queryFn: () =>
      configClient.listKeys({
        namespace,
        environment: envToProto(env),
        tradingMode: modeToProto(mode),
      }),
  });
}
```

Create `services/xstockstrat-config-ui/app/hooks/useSetConfig.ts`:
```ts
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { configClient } from '@/app/lib/browserClients';
import type { SetConfigRequest, SetConfigResponse } from '@xstockstrat/proto/config/v1/config_pb';
import { ConnectError } from '@connectrpc/connect';

export function useSetConfig(namespace: string, env: string, mode: string) {
  const queryClient = useQueryClient();
  return useMutation<SetConfigResponse, Error, SetConfigRequest>({
    mutationFn: (req) => configClient.setConfig(req),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['config-keys', namespace, env, mode] });
    },
    onError: (err) => {
      if (err instanceof ConnectError) return err;
      return err;
    },
  });
}
```

Create `services/xstockstrat-config-ui/app/hooks/useAuditLog.ts`:
```ts
import { useQuery } from '@tanstack/react-query';
import { BASE_PATH } from '@/app/lib/basepath';

interface AuditEntry {
  id: string;
  namespace: string;
  key: string;
  oldValue: string;
  newValue: string;
  changedBy: string;
  reason: string;
  changedAt: string;
  environment: string;
  tradingMode: string;
}

async function fetchAuditLog(): Promise<AuditEntry[]> {
  const res = await fetch(`${BASE_PATH}/api/audit`);
  const data: { entries?: AuditEntry[] } = await res.json();
  return data.entries ?? [];
}

export function useAuditLog(): { data: AuditEntry[] | undefined; isLoading: boolean } {
  return useQuery({
    queryKey: ['audit-log'],
    queryFn: fetchAuditLog,
  });
}
```

Create `services/xstockstrat-config-ui/app/hooks/useSignalSources.ts`:
```ts
import { useQuery } from '@tanstack/react-query';
import { ingestClient, configClient } from '@/app/lib/browserClients';
import type { SignalSource } from '@xstockstrat/proto/ingest/v1/ingest_pb';

export function useSignalSources(): {
  sources: SignalSource[];
  weights: Record<string, number>;
  isLoading: boolean;
  error: Error | null;
} {
  const { data, isLoading, error } = useQuery({
    queryKey: ['signal-sources'],
    queryFn: async () => {
      const [s, c] = await Promise.all([
        ingestClient.listSignalSources({ includeInactive: true }),
        configClient.listKeys({ namespace: 'analysis', environment: 1, tradingMode: 1 }),
      ]);
      const weightKey = (c.keys ?? []).find((k) => k.key === 'analysis.signals.source_weights');
      let weights: Record<string, number> = {};
      if (weightKey) {
        try { weights = JSON.parse(weightKey.defaultValue); } catch { /* no-op */ }
      }
      return { sources: s.sources ?? [], weights };
    },
  });
  return { sources: data?.sources ?? [], weights: data?.weights ?? {}, isLoading, error };
}
```

Create `services/xstockstrat-config-ui/app/hooks/useSignalSourceMutations.ts`:
```ts
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ingestClient } from '@/app/lib/browserClients';
import type { ManageSignalSourceRequest, ManageSignalSourceResponse } from '@xstockstrat/proto/ingest/v1/ingest_pb';
import { ConnectError } from '@connectrpc/connect';

export function useManageSignalSource() {
  const queryClient = useQueryClient();
  return useMutation<ManageSignalSourceResponse, Error, ManageSignalSourceRequest>({
    mutationFn: (req) => ingestClient.manageSignalSource(req),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['signal-sources'] });
    },
    onError: (err) => {
      if (err instanceof ConnectError) return err;
      return err;
    },
  });
}
```

Modify `services/xstockstrat-config-ui/app/[namespace]/page.tsx`:
- Remove `useEffect`, `useState` for `keys`/`loading`/`error`; replace with `useConfigKeys(namespace, env, mode)` hook
- Remove manual `configClient.setConfig(...)` in `handleSave`; replace with `useSetConfig(namespace, env, mode)` mutation hook
- Eliminate the `setKeys((data.keys ?? []) as ConfigKey[]` pattern — use the typed `data.keys` directly (the `ConfigKey` interface matches the proto shape)

Modify `services/xstockstrat-config-ui/app/audit/page.tsx`:
- Remove `useEffect`, `useState` for `entries`/`loading`
- Add: `import { useAuditLog } from '@/app/hooks/useAuditLog';`
- Replace with: `const { data: entries = [], isLoading: loading } = useAuditLog();`

Modify `services/xstockstrat-config-ui/app/sources/page.tsx`:
- Remove `useState` for `sources`, `weights`, `loading`, `error`; remove `fetchSources` callback and `useEffect`
- Add: `import { useSignalSources } from '@/app/hooks/useSignalSources';`
- Add: `import { useManageSignalSource } from '@/app/hooks/useSignalSourceMutations';`
- Replace with: `const { sources, weights, isLoading: loading, error } = useSignalSources();`
- `handleToggle` and `handleSave` call `mutate(req)` from `useManageSignalSource()`

**Verification**:
```bash
cd services/xstockstrat-config-ui && pnpm exec tsc --noEmit && grep -rn "useSWR\|from 'swr'" app/ && echo "SWR CHECK" && grep -rn "useEffect.*fetch\|fetch.*useEffect" app/ | grep -v "auth/login"
```
Confirm: `tsc --noEmit` exits 0; no SWR imports; no `useEffect`+`fetch` data-loading patterns remain (except `login/page.tsx` auth form, which is out of scope).

---

### Step 7 — service: Eliminate `any` from hook files and component internals

**Status**: `done`
**Service**: `xstockstrat-trader`, `xstockstrat-insights`, `xstockstrat-config-ui`
**Files**:
- `services/xstockstrat-insights/src/app/page.tsx` — modify
- `services/xstockstrat-insights/src/app/strategies/page.tsx` — modify
- `services/xstockstrat-insights/src/app/strategies/[id]/page.tsx` — modify
- `services/xstockstrat-trader/src/app/api/auth/login/route.ts` — modify
- `services/xstockstrat-insights/src/app/api/auth/login/route.ts` — modify
- `services/xstockstrat-config-ui/app/api/auth/login/route.ts` — modify
- `services/xstockstrat-config-ui/app/api/audit/route.ts` — modify
- `services/xstockstrat-trader/src/lib/identity.ts` — modify
- `services/xstockstrat-insights/src/lib/identity.ts` — modify
- `services/xstockstrat-config-ui/app/lib/identity.ts` — modify

**Reviewers**: xstockstrat-trader service owner — Trading UI correctness, Connect-RPC call safety, no direct DB access from frontend; xstockstrat-insights service owner — Analytics display accuracy, SSE polling resilience, read-only access pattern; xstockstrat-config-ui service owner — Config mutation safety, environment scope correctness, no secret values rendered in UI

**Codebase Evidence**:
- `insights/src/app/page.tsx` L97: `(strategies?.strategies ?? []).map((s: any) => ...)` — `strategies` from `useStrategies()` returns `ListStrategiesResponse`; `strategies.strategies` is `StrategyScore[]`
- `insights/src/app/page.tsx` L108: `ratingVariant(s.rating) as any` — `ratingVariant` returns `string`; `Badge variant` prop type needs widening or the variant map needs to be typed
- `insights/src/app/page.tsx` L165: `formatter={(v: any) => ...}` — Recharts `Tooltip` formatter type; use `unknown` with guard
- `insights/src/app/page.tsx` L203: `function chartData(strategies: any[])` — replace `any[]` with `StrategyScore[]`
- `insights/src/app/strategies/page.tsx` L42: `(data.strategies ?? []).map((s: any) => ...)` — same fix
- `insights/src/app/strategies/[id]/page.tsx` L66: `result.trades.map((t: any, i: number) => ...)` — `result` is `BacktestResult`; `trades` is `TradeRecord[]`
- `insights/src/app/strategies/[id]/page.tsx` L224: `formatter={(v: any) => ...}` — Recharts formatter; use `unknown`
- `trader/src/app/api/auth/login/route.ts` L16: `const tokens = data as any` — `identityClient.authenticateUser(...)` returns `AuthenticateUserResponse` from `@xstockstrat/proto/identity/v1/identity_pb`
- `insights/src/app/api/auth/login/route.ts` L15: same pattern `as any`
- `config-ui/app/api/auth/login/route.ts` L16: same pattern `as any`
- `trader/src/lib/identity.ts` L14: `const data = (await identityClient.refreshToken({ refreshToken })) as any`
- `insights/src/lib/identity.ts` L14: same pattern
- `config-ui/app/lib/identity.ts` L14: same pattern
- `config-ui/app/api/audit/route.ts` L65: `catch (err: any)` — replace with `catch (err: unknown)` + `instanceof Error` guard

**Instructions**:

For insights `page.tsx`:
- Import `StrategyScore` from `@xstockstrat/proto/analysis/v1/analysis_pb`
- Change `(strategies?.strategies ?? []).map((s: any) => ...)` → `(strategies?.strategies ?? []).map((s: StrategyScore) => ...)`
- Change `ratingVariant(s.rating) as any` → use explicit cast to the `badge.tsx` variant union type, or make `ratingVariant` return that union type directly
- Change `formatter={(v: any) => ...}` → `formatter={(v: unknown) => [typeof v === 'number' ? \`${v.toFixed(0)}\` : '0', 'Score']}`
- Change `function chartData(strategies: any[])` → `function chartData(strategies: StrategyScore[])`

For insights `strategies/page.tsx`:
- Import `StrategyScore` from `@xstockstrat/proto/analysis/v1/analysis_pb`
- Change `(data.strategies ?? []).map((s: any) => ...)` → `(data.strategies ?? []).map((s: StrategyScore) => ...)`

For insights `strategies/[id]/page.tsx`:
- After migration in Step 5, `backtestResult` is now typed as `BacktestResult | undefined` (from `useMutation` data)
- Import `TradeRecord` from `@xstockstrat/proto/analysis/v1/analysis_pb`
- Change `result.trades.map((t: any, i: number) => ...)` → `result.trades.map((t: TradeRecord, i: number) => ...)`
- Change `formatter={(v: any) => ...}` → `formatter={(v: unknown) => [\`$${typeof v === 'number' ? v.toLocaleString() : '0'}\`, 'Equity']}`

For all three `auth/login/route.ts` files (trader, insights, config-ui):
- The `as any` is on the return type of `identityClient.authenticateUser(...)`. Import `AuthenticateUserResponse` from `@xstockstrat/proto/identity/v1/identity_pb`.
- Replace `const tokens = data as any;` with `const tokens: AuthenticateUserResponse = data;`

For all three `identity.ts` / `lib/identity.ts` files:
- `identityClient.refreshToken(...)` returns `RefreshTokenResponse`. Import it from `@xstockstrat/proto/identity/v1/identity_pb`.
- Replace `const data = (await identityClient.refreshToken({ refreshToken })) as any;` with `const data: RefreshTokenResponse = await identityClient.refreshToken({ refreshToken });`
- Update the field accesses: `data.access_token ?? data.accessToken` → the proto field will be camelCase `data.accessToken`; `data.refresh_token ?? data.refreshToken` → `data.refreshToken`; `data.claims` → inspect the `RefreshTokenResponse` proto type and use the correct typed field

For `config-ui/app/api/audit/route.ts` L65:
- Change `catch (err: any)` → `catch (err: unknown)`
- Change `err.message` → `err instanceof Error ? err.message : 'Unknown error'`

**Verification**:
```bash
# trader
cd services/xstockstrat-trader && pnpm exec tsc --noEmit && grep -rn ': any' src/ | grep -v '//' && echo "any check done"
# insights
cd services/xstockstrat-insights && pnpm exec tsc --noEmit && grep -rn ': any' src/ | grep -v '//' && echo "any check done"
# config-ui
cd services/xstockstrat-config-ui && pnpm exec tsc --noEmit && grep -rn ': any' app/ | grep -v '//' && echo "any check done"
```
Confirm: `tsc --noEmit` exits 0 in all three; `any` only appears inside internal type-guard bodies.

---

### Step 8 — test: Verify tsc and SWR removal for xstockstrat-trader

**Status**: `done`
**Service**: `xstockstrat-trader`

**Reviewers**: xstockstrat-trader service owner — Trading UI correctness, Connect-RPC call safety, no direct DB access from frontend

**Codebase Evidence**:
- No coverage threshold for Next.js frontends (per spec: "No coverage threshold — use `pnpm test:e2e`")
- `package.json` scripts: `"test:e2e": "playwright test"` confirmed at L14
- SWR was confirmed present in 4 source files before migration

**Instructions**:
Run the acceptance criteria checks for the trader service:
1. TypeScript compile passes
2. SWR fully removed
3. No `any` in hook return types
4. No `catch (err: any)` patterns

New logic is entirely in `src/hooks/` and `src/lib/queryClient.ts`. No new backend or proto code was added.

**Verification**:
```bash
cd services/xstockstrat-trader
pnpm exec tsc --noEmit
grep -rn "swr" src/ package.json
grep -rn "catch (err: any)" src/
grep -rn ": any" src/hooks/ src/lib/queryClient.ts
pnpm test:e2e 2>&1 | tail -5
```
New logic is in `src/hooks/` and `src/lib/` — no coverage threshold applies; E2E test verification is sufficient.

---

### Step 9 — test: Verify tsc and SWR removal for xstockstrat-insights and xstockstrat-config-ui

**Status**: `done`
**Service**: `xstockstrat-insights`, `xstockstrat-config-ui`

**Reviewers**: xstockstrat-insights service owner — Analytics display accuracy, SSE polling resilience, read-only access pattern; xstockstrat-config-ui service owner — Config mutation safety, environment scope correctness, no secret values rendered in UI

**Codebase Evidence**:
- No coverage threshold for Next.js frontends
- Both have `"test:e2e": "playwright test"` in their `package.json`
- insights SWR was in 4 files; config-ui had no SWR but had `useEffect`+`fetch` pattern

**Instructions**:
Run acceptance criteria checks for insights and config-ui:

**Verification**:
```bash
# insights
cd services/xstockstrat-insights
pnpm exec tsc --noEmit
grep -rn "swr" src/ package.json
grep -rn "catch (err: any)" src/
grep -rn ": any" src/hooks/ src/lib/queryClient.ts
pnpm test:e2e 2>&1 | tail -5

# config-ui
cd services/xstockstrat-config-ui
pnpm exec tsc --noEmit
grep -rn "swr" app/ package.json
grep -rn "catch (err: any)" app/
grep -rn ": any" app/hooks/ app/lib/queryClient.ts
pnpm test:e2e 2>&1 | tail -5
```
New logic is in `app/hooks/` and `app/lib/` — no coverage threshold applies; E2E test verification is sufficient.

---

### Step 10 — service: Update CLAUDE.md files to reflect new client-side architecture

**Status**: `done`
**Service**: `xstockstrat-trader`, `xstockstrat-insights`, `xstockstrat-config-ui`
**Files**:
- `services/xstockstrat-trader/CLAUDE.md` — modify
- `services/xstockstrat-insights/CLAUDE.md` — modify
- `services/xstockstrat-config-ui/CLAUDE.md` — modify

**Reviewers**: none

**Codebase Evidence**:
- `services/xstockstrat-trader/CLAUDE.md` Architecture section L19–31 references "SWR-wrapped unary for polling" — this is stale after migration
- `services/xstockstrat-insights/CLAUDE.md` Architecture section L19–28 references `SWR → /api/analysis/*` — stale
- `services/xstockstrat-config-ui/CLAUDE.md` L19–25 architecture block shows no data-fetching library — needs hook layer added

**Instructions**:

For `services/xstockstrat-trader/CLAUDE.md`:
- In the Architecture section, update the Browser line from "SWR-wrapped unary for polling" to "`@connectrpc/connect-query` + TanStack Query v5 typed hooks (src/hooks/)"
- Add a "Client Hooks" section:
  ```
  ## Client Hooks

  All client-side data access goes through named typed hooks in `src/hooks/`:
  | Hook file | Exported hooks | Query key |
  |---|---|---|
  | `useOrders.ts` | `useOrders`, `useOrder` | `['orders', mode, accountId]`, `['order', id]` |
  | `usePortfolio.ts` | `usePortfolio`, `usePortfolios`, `usePositions` | `['portfolio', ...]`, `['portfolios', ...]`, `['positions', ...]` |
  | `usePlaceOrder.ts` | `usePlaceOrder` | mutation |

  Provider: `src/lib/queryClient.ts` + `src/app/providers.tsx`. Normalization: `orderId` and `strategyId` keys.
  ```

For `services/xstockstrat-insights/CLAUDE.md`:
- Update Architecture section to replace SWR arrows with "TanStack Query typed hooks (src/hooks/)"
- Add a "Client Hooks" section listing `useStrategies`, `useStrategyReport`, `useRunBacktest`, `useAccountPortfolios`

For `services/xstockstrat-config-ui/CLAUDE.md`:
- Update Architecture section to add the hook layer
- Add a "Client Hooks" section listing `useConfigKeys`, `useSetConfig`, `useAuditLog`, `useSignalSources`, `useManageSignalSource`

**Verification**:
```bash
grep -n "SWR\|useSWR\|swr" services/xstockstrat-trader/CLAUDE.md services/xstockstrat-insights/CLAUDE.md services/xstockstrat-config-ui/CLAUDE.md
```
Confirm: no remaining references to SWR in CLAUDE.md files (stale architecture descriptions replaced).

---

### Step 11 — docs: Create docs/patterns/client-api-pattern.md

**Status**: `done`
**Service**: `docs/patterns/`
**Files**:
- `docs/patterns/client-api-pattern.md` — create

**Reviewers**: none

**Codebase Evidence**:
- `docs/patterns/` directory exists: confirmed via CLAUDE.md key file paths table
- No `client-api-pattern.md` currently exists: `find docs/patterns -name "client-api-pattern.md"` → no match
- Pattern must include: directory structure, shared provider/config template, query-hook example, mutation-hook example, cache-normalization extension guide (per FR-9 and AC-7)
- Pattern references: `src/hooks/useOrders.ts` (trader), `src/hooks/useStrategies.ts` (insights), `app/hooks/useConfigKeys.ts` (config-ui) as reference implementations

**Instructions**:

Create `docs/patterns/client-api-pattern.md` with content covering:

1. **Overview** — purpose, library stack (`@connectrpc/connect-query` + TanStack Query v5 + `@normy/react-query`)
2. **Directory structure** — for `src/` services: `src/hooks/*.ts` + `src/lib/queryClient.ts` + `src/app/providers.tsx`; for config-ui flat layout: `app/hooks/*.ts` + `app/lib/queryClient.ts` + `app/providers.tsx`
3. **Shared provider/config template** — the `createQueryClient()` + `createNormalizer()` pattern from `src/lib/queryClient.ts`; the `Providers` component wrapping `QueryClientProvider` + `NormalizationProvider`
4. **Query hook example** — `useStrategies` as the canonical example (typed return, `queryKey`, `refetchInterval`); reference `services/xstockstrat-insights/src/hooks/useStrategies.ts`
5. **Mutation hook example** — `usePlaceOrder` as the canonical example (typed `MutationFn`, `onSuccess` invalidation, `ConnectError` handling); reference `services/xstockstrat-trader/src/hooks/usePlaceOrder.ts`
6. **Cache-normalization extension guide** — how to add new normalization keys to `getNormalizationObjectKey` in `queryClient.ts`; current normalized keys: `orderId`, `strategyId`; fields deferred: `symbol`, `key`, `portfolioId`
7. **Rules** — FR-3/FR-4/FR-10 enforcement: no direct client calls from component files; all data access via named hook files; `any` banned from hook public surface
8. **Reference implementations** — pointer to each service's hooks directory

**Verification**:
```bash
ls docs/patterns/client-api-pattern.md && grep -c "queryClient\|useMutation\|getNormalizationObjectKey" docs/patterns/client-api-pattern.md
```
Confirm file exists and contains the three key terms.

---

## Deviation Log

_Populated by /sdd-execute as implementation proceeds._

### Deviation: Step 4 — Migrate SWR call sites to typed hooks in xstockstrat-trader
**Spec said**: `useMutation<Order, Error, PlaceOrderRequest>` — use `PlaceOrderRequest` as the mutation variable type.
**Actual**: Used `Parameters<typeof tradingClient.placeOrder>[0]` as the mutation variable type.
**Reason**: `PartialMessage<PlaceOrderRequest>` was removed in protobuf-es v2. `PlaceOrderRequest` extends `Message<...>` which requires `$typeName`, making plain object literals incompatible. `Parameters<...>[0]` resolves to the exact accepted type from the Connect client method.

### Deviation: Step 4 — step-1 deps included in step-4 branch
**Spec said**: Step 4 depends on Step 1 (package.json deps + providers.tsx already merged into feature branch).
**Actual**: Steps 1–3 PRs (#476–478) were not yet merged into `feature/client-api-pattern` when the step-4 branch was created. Applied step-1 files (`package.json`, `queryClient.ts`, `providers.tsx`, `layout.tsx`) directly in step-4 to keep the branch self-contained and passing TypeScript check.
**Reason**: Feature branch lacked the dep additions, so tsc would fail for hooks importing `@tanstack/react-query`.

### Deviation: Step 5 — hook types use Awaited<ReturnType<...>> instead of imported proto types
**Spec said**: `import type { ListStrategiesResponse }` / `import type { BrokerAccount }` / `import type { Portfolio }` from proto packages.
**Actual**: Used `Awaited<ReturnType<typeof client.method>>` and `['accounts'][number]` / `['portfolios'][number]` array element types.
**Reason**: Avoids protobuf-es v2 `$typeName` compatibility issues at mutation/query boundaries; consistent with step-4 approach.

### Deviation: Step 5 — step-5 branch rebased onto step-4 (sequential branching)
**Spec said**: Each step branch is based on `feature/client-api-pattern`.
**Actual**: Going forward, each step branch is based on the previous step branch to avoid redundant dep additions and merge conflicts. Step-5 is based on step-4.
**Reason**: User instruction to use sequential PRs so each step builds on the previous.

### Deviation: Step 6 — enum short names (fix applied)
**Spec said**: `Environment.ENVIRONMENT_PRODUCTION`, `Environment.ENVIRONMENT_DEV`, `TradingMode.TRADING_MODE_LIVE`, `TradingMode.TRADING_MODE_PAPER`, `TradingMode.TRADING_MODE_UNSPECIFIED`.
**Actual**: `Environment.PRODUCTION`, `Environment.DEV`, `TradingMode.LIVE`, `TradingMode.PAPER`, `TradingMode.UNSPECIFIED`.
**Reason**: protobuf-es v2 uses short enum member names; the spec's long names (`ENVIRONMENT_PRODUCTION` etc.) do not exist at runtime. Noted in context.md Open Items before execution; confirmed by user before applying.

### Deviation: Step 6 — mutation input types use Parameters<...>[0] pattern
**Spec said**: `useMutation<SetConfigResponse, Error, SetConfigRequest>` and `useMutation<ManageSignalSourceResponse, Error, ManageSignalSourceRequest>`.
**Actual**: Used `Parameters<typeof configClient.setConfig>[0]` and `Parameters<typeof ingestClient.manageSignalSource>[0]` as mutation variable types.
**Reason**: Same protobuf-es v2 `$typeName` issue as in steps 4–5. `SetConfigRequest` / `ManageSignalSourceRequest` extend `Message<...>` requiring `$typeName`, so plain object literals are incompatible.

### Deviation: Step 6 — providers.tsx uses QueryNormalizerProvider (not NormalizationProvider)
**Spec said**: `import { NormalizationProvider } from '@normy/react-query'` with `<NormalizationProvider normalizer={normalizer}>`.
**Actual**: `import { QueryNormalizerProvider } from '@normy/react-query'` with `<QueryNormalizerProvider queryClient={queryClient} normalizerConfig={normalizerConfig}>`.
**Reason**: `NormalizationProvider` / `normalizer` are not the public API in `@normy/react-query ^0.21.0`. The correct export is `QueryNormalizerProvider` accepting `queryClient` + `normalizerConfig` props. This matches the pattern established in steps 4–5.

### Deviation: Step 6 — @normy/react-query version ^0.21.0 (not ^1.1.0)
**Spec said**: `"@normy/react-query": "^1.1.0"` in package.json.
**Actual**: `"@normy/react-query": "^0.21.0"` — consistent with steps 4–5 and the library decision in context.md.
**Reason**: `^1.1.0` does not exist as a published version. The package is at `^0.21.0`.

### Deviation: Step 7 — AuthTokenResponse instead of AuthenticateUserResponse/RefreshTokenResponse
**Spec said**: Import `AuthenticateUserResponse` and `RefreshTokenResponse` from `@xstockstrat/proto/identity/v1/identity_pb`.
**Actual**: Both `authenticateUser()` and `refreshToken()` return `AuthTokenResponse`. There is no `AuthenticateUserResponse` or `RefreshTokenResponse` type in the proto package.
**Reason**: The proto service descriptor confirms both RPCs share a single response message `AuthTokenResponse`. Spec used incorrect type names.

### Deviation: Step 7 — claims cast as unknown as JwtClaims
**Spec said**: `data.claims` assigned to `claims: JwtClaims` directly.
**Actual**: `data.claims as unknown as JwtClaims` cast required.
**Reason**: `TokenClaims` from proto has `userId` (camelCase) while `JwtClaims` expects `user_id` (snake_case), plus extra fields `issued_at`/`expires_at`. Since `claims` is not consumed by any caller (refresh route uses only `accessToken`/`refreshToken`), the cast is safe at runtime.
