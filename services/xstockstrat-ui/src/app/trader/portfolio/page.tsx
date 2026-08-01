'use client';
import { AppShell } from '@/components/trader/AppShell';
import { PortfolioPanel } from '@/components/trader/PortfolioPanel';

/**
 * Book → Portfolio (feature 083, FR-14). Read-only broker mirror — the broker (Alpaca / IBKR)
 * owns the ledger and P&L; xstockstrat never writes to it (AC-8, C-10(b)). Reuses the existing
 * PortfolioPanel (usePortfolios, 10s poll) so the valuation source is the single
 * broker-authoritative one shared with Exposure.
 */
export default function PortfolioPage() {
  return (
    <AppShell>
      <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 space-y-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Portfolio</h1>
          <p className="text-sm text-muted-foreground">
            A read-only mirror of your broker accounts.
          </p>
        </div>
        <PortfolioPanel />
        <p className="text-xs text-muted-foreground" data-testid="ledger-disclaimer">
          xstockstrat never writes to the ledger — the broker is the source of truth for positions
          and P&amp;L.
        </p>
      </div>
    </AppShell>
  );
}
