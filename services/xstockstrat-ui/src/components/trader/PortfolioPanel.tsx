'use client';

import type { TradingMode } from '@/app/trader/page';
import { useAccountContext } from '@/context/AccountContext';
import { usePortfolios } from '@/hooks/usePortfolio';
import { BrokerType } from '@xstockstrat/proto/common/v1/common_pb';
import { Card, CardHeader, CardTitle, CardContent } from '../ui/card';
import { Badge } from '../ui/badge';

function brokerLabel(brokerType: BrokerType): string {
  return brokerType === BrokerType.IBKR ? 'IBKR' : 'Alpaca';
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
  const { data, isLoading, error } = usePortfolios(selectedAccountId);

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

  const portfolios = data.portfolios ?? [];

  if (selectedAccountId) {
    const portfolio = portfolios[0];
    const account = accounts.find((a) => a.id === selectedAccountId);
    const pnlPositive = portfolio ? Number(portfolio.dayPnl) >= 0 : true;

    return (
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">{account?.displayName ?? selectedAccountId}</CardTitle>
            <div className="flex items-center gap-1">
              {account && (
                <Badge variant="secondary" className="text-[10px] px-1 py-0 h-4">
                  {brokerLabel(account.brokerType)}
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
              <Stat label="Buying Power" value={`$${Number(portfolio.buyingPower).toLocaleString('en-US', { minimumFractionDigits: 2 })}`} />
              <Stat
                label="Day P&L"
                value={`${pnlPositive ? '+' : ''}$${Number(portfolio.dayPnl).toFixed(2)} (${Number(portfolio.dayPnlPct * 100).toFixed(2)}%)`}
                valueClass={pnlPositive ? 'text-buy' : 'text-destructive'}
              />
              <Stat label="Total P&L" value={`$${Number(portfolio.totalPnl).toFixed(2)}`} />
            </div>
            {portfolio.positions?.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Positions</p>
                <div className="space-y-1.5">
                  {portfolio.positions.map((pos) => (
                    <div key={pos.symbol} className="flex justify-between text-xs">
                      <span className="font-mono font-semibold">{pos.symbol}</span>
                      <span className={Number(pos.unrealizedPnl) >= 0 ? 'text-buy' : 'text-destructive'}>
                        {Number(pos.unrealizedPnl) >= 0 ? '+' : ''}${Number(pos.unrealizedPnl).toFixed(2)}
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
      {portfolios.map((portfolio) => {
        const account = accounts.find((a) => a.id === portfolio.accountId);
        const pnlPositive = Number(portfolio.dayPnl) >= 0;
        return (
          <Card key={portfolio.portfolioId ?? portfolio.accountId}>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm">{account?.displayName ?? portfolio.accountId}</CardTitle>
                {account && (
                  <Badge variant="secondary" className="text-[10px] px-1 py-0 h-4">
                    {brokerLabel(account.brokerType)}
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
                value={`${pnlPositive ? '+' : ''}$${Number(portfolio.dayPnl).toFixed(2)}`}
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
