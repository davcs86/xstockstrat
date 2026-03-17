'use client';
import { OrderForm } from '@/components/OrderForm';
import { OrderBook } from '@/components/OrderBook';
import { PortfolioSummary } from '@/components/PortfolioSummary';
import { AlertStream } from '@/components/AlertStream';

export default function TradingDashboard() {
  return (
    <main className="min-h-screen bg-gray-950 text-gray-100 p-6">
      <header className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">xstockstrat Trader</h1>
        <AlertStream />
      </header>
      <div className="grid grid-cols-12 gap-4">
        <div className="col-span-3">
          <PortfolioSummary />
        </div>
        <div className="col-span-5">
          <OrderBook />
        </div>
        <div className="col-span-4">
          <OrderForm />
        </div>
      </div>
    </main>
  );
}
