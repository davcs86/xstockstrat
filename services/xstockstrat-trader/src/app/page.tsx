'use client';
import { useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { OrderForm } from '@/components/OrderForm';
import { OrderBook } from '@/components/OrderBook';
import { PortfolioPanel } from '@/components/PortfolioPanel';
import { AlertStream } from '@/components/AlertStream';
import { AccountSelector } from '@/components/AccountSelector';
import { Button } from '@/components/ui/button';
import { ChartPanel } from '@/components/ChartPanel';

export type TradingMode = 'paper' | 'live';

export default function TradingDashboard() {
  const [mode, setMode] = useState<TradingMode>('paper');

  return (
    <AppShell
      title="xstockstrat Trader"
      actions={
        <div className="flex items-center gap-2">
          <AccountSelector />
          <ModeToggle mode={mode} onChange={setMode} />
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
      </div>
    </AppShell>
  );
}

function ModeToggle({ mode, onChange }: { mode: TradingMode; onChange: (m: TradingMode) => void }) {
  return (
    <div className="flex items-center gap-1 rounded-lg bg-secondary p-1">
      {(['paper', 'live'] as TradingMode[]).map((m) => (
        <Button
          key={m}
          size="sm"
          variant="ghost"
          onClick={() => onChange(m)}
          className={
            mode === m
              ? m === 'paper'
                ? 'bg-paper/20 text-paper hover:bg-paper/30 h-7 px-3'
                : 'bg-buy/20 text-buy hover:bg-buy/30 h-7 px-3'
              : 'text-muted-foreground hover:text-foreground h-7 px-3'
          }
        >
          {m === 'paper' ? 'PAPER' : 'LIVE'}
        </Button>
      ))}
    </div>
  );
}
