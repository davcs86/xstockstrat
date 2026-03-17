'use client';
import { useState } from 'react';
import { OrderForm } from '@/components/OrderForm';
import { OrderBook, PortfolioSummary } from '@/components/OrderBook';
import { AlertStream } from '@/components/AlertStream';

export type TradingMode = 'paper' | 'live';

export default function TradingDashboard() {
  const [mode, setMode] = useState<TradingMode>('paper');

  return (
    <main className="min-h-screen bg-gray-950 text-gray-100 p-6">
      <header className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <h1 className="text-2xl font-bold tracking-tight">xstockstrat Trader</h1>
          <ModeToggle mode={mode} onChange={setMode} />
        </div>
        <AlertStream />
      </header>
      <div className="grid grid-cols-12 gap-4">
        <div className="col-span-3">
          <PortfolioSummary mode={mode} />
        </div>
        <div className="col-span-5">
          <OrderBook mode={mode} />
        </div>
        <div className="col-span-4">
          <OrderForm mode={mode} />
        </div>
      </div>
    </main>
  );
}

function ModeToggle({ mode, onChange }: { mode: TradingMode; onChange: (m: TradingMode) => void }) {
  return (
    <div className="flex items-center gap-1 rounded-lg bg-gray-800 p-1">
      {(['paper', 'live'] as TradingMode[]).map((m) => (
        <button
          key={m}
          onClick={() => onChange(m)}
          className={`px-3 py-1 rounded text-xs font-semibold transition-colors ${
            mode === m
              ? m === 'paper'
                ? 'bg-yellow-500 text-gray-900'
                : 'bg-emerald-600 text-white'
              : 'text-gray-400 hover:text-gray-200'
          }`}
        >
          {m === 'paper' ? 'PAPER' : 'LIVE'}
        </button>
      ))}
    </div>
  );
}
