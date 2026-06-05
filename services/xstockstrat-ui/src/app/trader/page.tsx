'use client';
import { AppShell } from '@/components/trader/AppShell';
import { OrderForm } from '@/components/trader/OrderForm';
import { OrderBook } from '@/components/trader/OrderBook';
import { PortfolioPanel } from '@/components/trader/PortfolioPanel';
import { ChartPanel } from '@/components/trader/ChartPanel';
import { useAccountContext } from '@/context/AccountContext';

export type TradingMode = 'paper' | 'live';

export default function TradingDashboard() {
  const { environmentMode } = useAccountContext();
  const mode: TradingMode = environmentMode ?? 'paper';

  return (
    <AppShell>
      <div className="p-4 sm:p-6 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-12 gap-4">
          <div className="md:col-span-3">
            <PortfolioPanel />
          </div>
          <div className="md:col-span-4 order-3 md:order-none">
            <OrderForm mode={mode} />
          </div>
          <div className="md:col-span-5 order-2 md:order-none">
            <OrderBook mode={mode} />
          </div>
        </div>
        <ChartPanel />
      </div>
    </AppShell>
  );
}
