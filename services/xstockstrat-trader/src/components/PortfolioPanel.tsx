'use client';

import useSWR from 'swr';
import { BASE_PATH } from '@/lib/basepath';
import type { TradingMode } from '@/app/page';
import { useAccountContext } from '@/context/AccountContext';
import { Card, CardHeader, CardTitle, CardContent } from './ui/card';
import { Badge } from './ui/badge';

const fetcher = (url: string) => fetch(url).then((r) => r.json());

function brokerLabel(brokerType: number): string {
  return brokerType === 2 ? 'IBKR' : 'Alpaca';
}

function Stat({ label, value, valueClass = 'text-foreground' }: { label: string; value: string; valueClass?: string }) {
  return (
    <div className="flex justify-between text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className={`font-medium tabular-nums ${valueClass}`}>{value}</span>
    </div>
  );
}

export function PortfolioPanel({ mode }: { mode: TradingMode }) {
  const { accounts, selectedAccountId } = useAccountContext();
  const { data, isLoading, error } = useSWR(
    `${BASE_PATH}/api/portfolio/accounts?account_id=${selectedAccountId ?? ''}`,
    fetcher,
    { refreshInterval: 10000 },
  );

  if (isLoading) return (
    <Card>
      <CardContent className="pt-5">
        <p className="text-sm text-muted-foreground">Loading portfolio…</p>
      </CardContent>
    </Card>
  );

  if (error || !data) return (
    <Card>
      <CardContent className="pt-5">
        <p className="text-sm text-destructive">Portfolio unavailable</p>
      </CardContent>
    </Card>
  );

  const portfolios: any[] = data.portfolios ?? [];

  if (selectedAccountId) {
    const portfolio = portfolios[0];
    const account = accounts.find((a) => a.account_id === selectedAccountId);
    const pnlPositive = portfolio ? Number(portfolio.day_pnl) >= 0 : true;

    return (
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">{account?.display_name ?? selectedAccountId}</CardTitle>
            <div className="flex items-center gap-1">
              {account && (
                <Badge variant="secondary" className="text-[10px] px-1 py-0 h-4">
                  {brokerLabel(account.broker_type)}
                </Badge>
              )}
              <Badge variant={mode === 'paper' ? 'paper' : 'live'}>
                {mode === 'paper' ? 'PAPER' : 'LIVE'}
              </Badge>
            </div>
          </div>
        </CardHeader>
        {portfolio ? (
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Stat label="Equity" value={`$${Number(portfolio.equity).toLocaleString('en-US', { minimumFractionDigits: 2 })}`} />
              <Stat label="Cash" value={`$${Number(portfolio.cash).toLocaleString('en-US', { minimumFractionDigits: 2 })}`} />
              <Stat label="Buying Power" value={`$${Number(portfolio.buying_power).toLocaleString('en-US', { minimumFractionDigits: 2 })}`} />
              <Stat
                label="Day P&L"
                value={`${pnlPositive ? '+' : ''}$${Number(portfolio.day_pnl).toFixed(2)} (${Number(portfolio.day_pnl_pct * 100).toFixed(2)}%)`}
                valueClass={pnlPositive ? 'text-buy' : 'text-destructive'}
              />
              <Stat label="Total P&L" value={`$${Number(portfolio.total_pnl).toFixed(2)}`} />
            </div>
            {portfolio.positions?.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Positions</p>
                <div className="space-y-1.5">
                  {portfolio.positions.map((pos: any) => (
                    <div key={pos.symbol} className="flex justify-between text-xs">
                      <span className="font-mono font-semibold">{pos.symbol}</span>
                      <span className={Number(pos.unrealized_pnl) >= 0 ? 'text-buy' : 'text-destructive'}>
                        {Number(pos.unrealized_pnl) >= 0 ? '+' : ''}${Number(pos.unrealized_pnl).toFixed(2)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        ) : (
          <CardContent className="pt-5">
            <p className="text-sm text-muted-foreground">No portfolio data</p>
          </CardContent>
        )}
      </Card>
    );
  }

  if (portfolios.length === 0) {
    return (
      <Card>
        <CardContent className="pt-5">
          <p className="text-sm text-muted-foreground">No portfolios available</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {portfolios.map((portfolio: any) => {
        const account = accounts.find((a) => a.account_id === portfolio.account_id);
        const pnlPositive = Number(portfolio.day_pnl) >= 0;
        return (
          <Card key={portfolio.portfolio_id ?? portfolio.account_id}>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm">{account?.display_name ?? portfolio.account_id}</CardTitle>
                {account && (
                  <Badge variant="secondary" className="text-[10px] px-1 py-0 h-4">
                    {brokerLabel(account.broker_type)}
                  </Badge>
                )}
              </div>
            </CardHeader>
            <CardContent className="space-y-1.5">
              <Stat
                label="Equity"
                value={`$${Number(portfolio.equity).toLocaleString('en-US', { minimumFractionDigits: 2 })}`}
              />
              <Stat
                label="Day P&L"
                value={`${pnlPositive ? '+' : ''}$${Number(portfolio.day_pnl).toFixed(2)}`}
                valueClass={pnlPositive ? 'text-buy' : 'text-destructive'}
              />
              {portfolio.positions?.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  {portfolio.positions.length} position{portfolio.positions.length > 1 ? 's' : ''}
                </p>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
