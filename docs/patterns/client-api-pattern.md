# Client API Pattern

The `xstockstrat-ui` consolidated Next.js frontend uses this pattern for all client-side data access. All reads go through `useQuery` hooks; all writes go through `useMutation` hooks. Components never import browser client files directly.

This follows feature `044-client-api-pattern`.

---

## Library Stack

| Library | Version | Role |
|---|---|---|
| `@tanstack/react-query` | `^5.62.0` | Query + mutation management, caching, refetch intervals |
| `@normy/react-query` | `^0.21.0` | Automatic entity propagation via normalization keys |
| `@connectrpc/connect-web` | existing | Typed browser clients (unchanged) |

`@connectrpc/connect-query` is **not** used directly — hooks call `browserClients.ts` Connect clients inside `queryFn`/`mutationFn`. The Connect clients were already in place; this pattern only adds the TanStack Query wrapper layer.

---

## Directory Structure

`xstockstrat-ui` uses a single `src/` tree. Shared hooks (used across segments) live in `src/hooks/`; segment-specific hooks co-locate with their segment under `src/app/<segment>/hooks/`.

```
src/
  hooks/                        # shared cross-segment hooks
    useOrders.ts
    usePortfolio.ts
    usePlaceOrder.ts
    useStrategies.ts
    useAccountPortfolios.ts
    useBacktest.ts
  app/
    trader/                     # trader segment
    insights/                   # insights segment
    config-ui/
      hooks/                    # config-ui segment hooks (co-located)
        useConfigKeys.ts
        useSetConfig.ts
        useAuditLog.ts
        useSignalSources.ts
        useSignalSourceMutations.ts
    providers.tsx               # 'use client' — QueryClientProvider + QueryNormalizerProvider
    layout.tsx                  # Server Component — renders <Providers>{children}</Providers>
  lib/
    queryClient.ts              # createQueryClient() + normalizerConfig
    browserClients/             # per-service Connect clients (never imported from components)
      tradingClient.ts
      portfolioClient.ts
      analysisClient.ts
      configClient.ts
      ingestClient.ts
      marketDataClient.ts
      notifyClient.ts
```

---

## Shared Provider/Config Template

### `src/lib/queryClient.ts` (or `app/lib/queryClient.ts`)

```ts
import { QueryClient } from '@tanstack/react-query';

export const normalizerConfig = {
  getNormalizationObjectKey: (obj: Record<string, unknown>) => {
    if (typeof obj.orderId === 'string' && obj.orderId) return `order:${obj.orderId}`;
    if (typeof obj.strategyId === 'string' && obj.strategyId) return `strategy:${obj.strategyId}`;
    return undefined;
  },
};

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { staleTime: 5_000, retry: 1 },
    },
  });
}
```

### `src/app/providers.tsx` (or `app/providers.tsx`)

```tsx
'use client';
import { useState } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { QueryNormalizerProvider } from '@normy/react-query';
import { normalizerConfig, createQueryClient } from '@/lib/queryClient';

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => createQueryClient());
  return (
    <QueryClientProvider client={queryClient}>
      <QueryNormalizerProvider queryClient={queryClient} normalizerConfig={normalizerConfig}>
        {children}
      </QueryNormalizerProvider>
    </QueryClientProvider>
  );
}
```

`QueryNormalizerProvider` must be **nested inside** `QueryClientProvider` and must receive the same `queryClient` instance.

### `src/app/layout.tsx`

```tsx
import { Providers } from './providers';

// inside the body/main element:
<Providers>{children}</Providers>
```

`layout.tsx` is a Server Component — the `'use client'` directive goes in `providers.tsx`, not here.

---

## Query Hook Example

Reference implementation: `services/xstockstrat-ui/src/hooks/useStrategies.ts`

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
```

Key rules:
- `queryKey` is a stable array — include all variables that affect the query result (e.g. `[key, mode, accountId]`)
- `queryFn` calls a `browserClients.ts` export directly
- Return type is explicit; `error` is `Error | null` (not `unknown`)
- Use proto-generated response types for `data` — never `any`

---

## Mutation Hook Example

Reference implementation: `services/xstockstrat-ui/src/hooks/usePlaceOrder.ts`

```ts
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { tradingClient } from '@/lib/browserClients';
import type { Order } from '@xstockstrat/proto/trading/v1/trading_pb';
import { ConnectError } from '@connectrpc/connect';

type PlaceOrderInput = Parameters<typeof tradingClient.placeOrder>[0];

export function usePlaceOrder() {
  const queryClient = useQueryClient();
  return useMutation<Order, Error, PlaceOrderInput>({
    mutationFn: (req) => tradingClient.placeOrder(req),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['orders'] });
    },
    onError: (err) => {
      if (err instanceof ConnectError) return err;
      return err;
    },
  });
}
```

Key rules:
- Use `Parameters<typeof client.method>[0]` for the input type — **not** the proto message class directly. Proto message classes extend `Message<...>` (protobuf-es v2) and require a `$typeName` field, making plain object literals incompatible. `Parameters<...>[0]` resolves to the accepted type from the Connect client.
- `onSuccess` invalidates the relevant query keys so dependent `useQuery` calls refetch automatically
- `ConnectError` carries `rawMessage` and `code`; handle it explicitly when callers need the gRPC status

---

## Cache Normalization Extension Guide

Normy propagates entity updates across all cached queries that contain a matching entity. When a mutation returns an entity that shares a normalization key with a cached query response, all affected queries are updated automatically — no manual `invalidateQueries` needed for those entities.

### Current normalized keys

Defined in `src/lib/queryClient.ts` in `xstockstrat-ui`:

| Field | Key prefix | Example |
|---|---|---|
| `orderId` | `order:` | `order:abc-123` |
| `strategyId` | `strategy:` | `strategy:def-456` |

### Adding a new key

1. Open `services/xstockstrat-ui/src/lib/queryClient.ts`
2. Add a branch to `getNormalizationObjectKey`:

```ts
if (typeof obj.portfolioId === 'string' && obj.portfolioId) return `portfolio:${obj.portfolioId}`;
```

### Deferred fields

These fields were considered and deferred — add them only when the normalization benefit is confirmed:

| Field | Reason deferred |
|---|---|
| `symbol` | Too generic — could match across unrelated entity types causing cross-entity collisions |
| `key` | Used in config entries — field name too common to normalize safely |
| `portfolioId` | Deferred until portfolio pages exist in both trader and insights |

---

## Rules

These rules enforce FR-3, FR-4, and FR-10 of feature `044-client-api-pattern`.

1. **No direct `browserClients.ts` imports in components.** All data access goes through a named hook in `src/hooks/` (or `app/hooks/` for config-ui). If a component needs data, create a hook for it.

2. **No `useSWR` or direct `useEffect`+`fetch` for data loading.** Use `useQuery` for reads and `useMutation` for writes. `useEffect`+`fetch` is only acceptable for auth form submissions (login page) — not for data loading.

3. **No `any` on hook public surfaces.** Hook return types must be fully typed. `any` is banned from: hook file exported function signatures, `queryFn` return types, and `mutationFn` parameters. Internal type-guard bodies are exempt.

4. **One hook file per domain.** Group related queries and mutations for the same entity domain in one file (e.g. `useOrders.ts` exports both `useOrders` and `useOrder`). Do not mix domains.

5. **Query keys must include all variables.** If the result changes when `mode`, `accountId`, or any other param changes, those params must be in the `queryKey` array. Missing query key segments cause stale-cache bugs.

---

## Reference Implementation

| Location | Purpose |
|---|---|
| `services/xstockstrat-ui/src/hooks/` | Shared hooks (orders, portfolio, strategies, backtest, account portfolios) |
| `services/xstockstrat-ui/src/app/config-ui/hooks/` | Config-UI segment hooks (config keys, audit log, signal sources) |
| `services/xstockstrat-ui/src/lib/queryClient.ts` | `createQueryClient()` + `normalizerConfig` |
| `services/xstockstrat-ui/src/app/providers.tsx` | `QueryClientProvider` + `QueryNormalizerProvider` wrapper |
