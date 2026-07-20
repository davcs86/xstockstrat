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

// Full order lifecycle management page (FR-1..FR-8): create (all 5 order types), a
// server-side-filterable + paginated historical list, inline edit (replace) and cancel,
// and a live StreamOrderUpdates feed. Scoped to the selected account + the deployment's
// fixed trading mode (FR-7).
export default function OrdersPage() {
  const { selectedAccountId, environmentMode } = useAccountContext();
  const mode: TradingMode = environmentMode ?? 'paper';
  const [filters, setFilters] = useState<OrderFilters>({});

  // Merge the globally-selected account (AppShell AccountSelector) into the server-side
  // filters so the list is scoped to the active account (FR-7).
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
          <h1 className="text-lg font-semibold">Orders</h1>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
          <div className="lg:col-span-4">
            {/* OrderForm reads useSearchParams (the ?symbol quick-trade deep link), which
                Next.js requires to be wrapped in a Suspense boundary for prerendering. */}
            <Suspense fallback={null}>
              <OrderForm mode={mode} />
            </Suspense>
          </div>
          <div className="lg:col-span-8 space-y-4">
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
