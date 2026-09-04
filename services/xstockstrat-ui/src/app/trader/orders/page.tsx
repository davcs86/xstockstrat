'use client';
import { Suspense, useState } from 'react';
import { AppShell } from '@/components/trader/AppShell';
import { OrderForm } from '@/components/trader/OrderForm';
import { OrderFiltersPanel } from '@/components/trader/OrderFilters';
import { OrdersTable } from '@/components/trader/OrdersTable';
import { BackToDashboardButton } from '@/components/trader/BackToDashboardButton';
import { useOrders, type OrderFilters } from '@/hooks/useOrders';
import { useAccountContext } from '@/context/AccountContext';
import type { TradingMode } from '@/app/trader/page';

// Order lifecycle page: create (all 5 order types), a server-side-filterable paginated list, inline
// edit/cancel, and a live StreamOrderUpdates feed. Scoped to the selected account + deployment mode.
export default function OrdersPage() {
  const { selectedAccountId, environmentMode } = useAccountContext();
  const mode: TradingMode = environmentMode ?? 'paper';
  const [filters, setFilters] = useState<OrderFilters>({});

  // Merge the globally-selected account into the server-side filters so the list is scoped to the
  // active account.
  const effectiveFilters: OrderFilters = {
    ...filters,
    ...(selectedAccountId ? { accountId: selectedAccountId } : {}),
  };

  const { data, isLoading, error } = useOrders(mode, selectedAccountId, effectiveFilters);

  return (
    <AppShell>
      <div className="p-4 sm:p-6 space-y-4">
        <div className="flex items-center gap-3">
          <BackToDashboardButton />
          <div>
            <h1 className="text-lg font-semibold">Orders</h1>
            <p className="text-sm text-muted-foreground">
              Every order traced back to the signal that produced it.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
          {/* min-w-0: same grid-overflow hazard as the sibling below — without it the item's default
              min-width:auto pushes overflow onto the page. */}
          <div className="lg:col-span-4 min-w-0">
            {/* OrderForm reads useSearchParams (the ?symbol quick-trade deep link), which
                Next.js requires to be wrapped in a Suspense boundary for prerendering. */}
            <Suspense fallback={null}>
              <OrderForm mode={mode} />
            </Suspense>
          </div>
          {/* min-w-0: without it a grid item's default min-width:auto stops OrdersTable's own
              overflow-x-auto wrapper from shrinking, pushing overflow onto the page. */}
          <div className="lg:col-span-8 space-y-4 min-w-0">
            <OrderFiltersPanel onChange={setFilters} />
            <OrdersTable
              orders={data?.orders ?? []}
              isLoading={isLoading}
              error={error}
              emptyLabel={`No ${mode} orders`}
            />
          </div>
        </div>
      </div>
    </AppShell>
  );
}
