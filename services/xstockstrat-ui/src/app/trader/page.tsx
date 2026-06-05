'use client';
import { AppShell } from '@/components/trader/AppShell';
import { OrderForm } from '@/components/trader/OrderForm';
import { OrderBook } from '@/components/trader/OrderBook';
import { PortfolioPanel } from '@/components/trader/PortfolioPanel';
import { AlertStream } from '@/components/trader/AlertStream';
import { AccountSelector } from '@/components/trader/AccountSelector';
import { TradingModeBadge } from '@/components/shared/TradingModeBadge';
import { ChartPanel } from '@/components/trader/ChartPanel';
import { LiveStrategiesPanel } from '@/components/trader/LiveStrategiesPanel';
import { useAccountContext } from '@/context/AccountContext';
import { useIsAdmin } from '@/hooks/useLiveStrategies';

export type TradingMode = 'paper' | 'live';

export default function TradingDashboard() {
  const { environmentMode } = useAccountContext();
  const { data: isAdmin } = useIsAdmin();
  // Mode is fixed by the deployment environment — the user cannot switch it.
  // Default to 'paper' until the environment is known (safer than defaulting live).
  const mode: TradingMode = environmentMode ?? 'paper';

  return (
    <AppShell
      actions={
        <div className="flex items-center gap-2">
          <TradingModeBadge mode={environmentMode} />
          <AccountSelector />
          <AlertStream />
        </div>
      }
    >
      <div className="p-4 sm:p-6 space-y-4">
        {/* Mobile: stacked; md: 3-column grid */}
        <div className="grid grid-cols-1 md:grid-cols-12 gap-4">
          <div className="md:col-span-3">
            <PortfolioPanel mode={mode} />
          </div>
          <div className="md:col-span-4 order-3 md:order-none">
            <OrderForm mode={mode} />
          </div>
          <div className="md:col-span-5 order-2 md:order-none">
            <OrderBook mode={mode} />
          </div>
        </div>
        <ChartPanel />
        <LiveStrategiesPanel isAdmin={isAdmin ?? false} />
      </div>
    </AppShell>
  );
}
