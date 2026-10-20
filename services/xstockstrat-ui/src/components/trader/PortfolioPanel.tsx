'use client';

import { useAccountContext } from '@/context/AccountContext';
import { usePortfolios } from '@/hooks/usePortfolio';
import { Card, CardHeader, CardTitle, CardContent } from '../ui/card';
import { Badge } from '../ui/badge';
import { Stat } from '../shared/Stat';
import { CardNotice } from '../shared/CardNotice';
import { brokerLabel } from '@/lib/brokers';
import { fmtUsd, fmtSignedUsd, fmtPct, pnlClass } from '@/lib/money';
import { sumPortfolioTotals } from '@/lib/portfolioTotals';
import { BrokerType } from '@xstockstrat/proto/common/v1/common_pb';
import type { Portfolio } from '@xstockstrat/proto/portfolio/v1/portfolio_pb';

/** Gross realized with its net-of-fees figure: `+$600.00 (net +$597.00)`. */
function grossNet(gross: number, fees: number | undefined): string {
  return `${fmtSignedUsd(gross)} (net ${fmtSignedUsd(gross - Number(fees ?? 0))})`;
}

/** Offline-only P&L rows (feature 230); each optional row renders only when the backend set it. */
function OfflinePnlStats({ portfolio }: { portfolio: Portfolio }) {
  return (
    <>
      <Stat
        label="Day P&L"
        value={`${fmtSignedUsd(portfolio.dayPnl)} (${fmtPct(portfolio.dayPnlPct)})`}
        valueClass={pnlClass(portfolio.dayPnl)}
      />
      <Stat
        label="Total P&L"
        value={
          portfolio.totalPnlPct !== undefined
            ? `${fmtSignedUsd(portfolio.totalPnl)} (${fmtPct(portfolio.totalPnlPct)})`
            : fmtSignedUsd(portfolio.totalPnl)
        }
        valueClass={pnlClass(portfolio.totalPnl)}
      />
      {portfolio.realizedPnl !== undefined && (
        <Stat
          label="Realized (since snapshot)"
          value={grossNet(portfolio.realizedPnl, portfolio.feesSinceSnapshot)}
          valueClass={pnlClass(portfolio.realizedPnl)}
        />
      )}
      {portfolio.realizedPnlLifetime !== undefined && (
        <Stat
          label="Realized (lifetime)"
          value={grossNet(portfolio.realizedPnlLifetime, portfolio.feesLifetime)}
          valueClass={pnlClass(portfolio.realizedPnlLifetime)}
        />
      )}
      {portfolio.feesSinceSnapshot !== undefined && (
        <Stat label="Fees (since snapshot)" value={fmtUsd(portfolio.feesSinceSnapshot)} />
      )}
      {portfolio.feesLifetime !== undefined && (
        <Stat label="Fees (lifetime)" value={fmtUsd(portfolio.feesLifetime)} />
      )}
    </>
  );
}

export function PortfolioPanel() {
  const { accounts, selectedAccountId } = useAccountContext();
  const { data, isLoading, error } = usePortfolios(selectedAccountId);

  if (isLoading) return <CardNotice>Loading portfolio…</CardNotice>;
  if (error || !data) return <CardNotice variant="error">Portfolio unavailable</CardNotice>;

  const portfolios = data.portfolios ?? [];

  if (selectedAccountId) {
    const portfolio = portfolios[0];
    const account = accounts.find((a) => a.id === selectedAccountId);
    // Offline accounts have no account_balances row, so Cash / Buying Power are broker-only concepts that
    // would render as a misleading $0 — gate them off; offline accounts show their own P&L rows instead.
    const isOffline = account?.brokerType === BrokerType.OFFLINE;

    return (
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">{account?.displayName ?? selectedAccountId}</CardTitle>
            {account && (
              <Badge variant="secondary" className="text-[10px] px-1 py-0 h-4">
                {brokerLabel(account.brokerType)}
              </Badge>
            )}
          </div>
        </CardHeader>
        {portfolio ? (
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Stat label="Equity" value={fmtUsd(portfolio.equity)} />
              {isOffline ? (
                <OfflinePnlStats portfolio={portfolio} />
              ) : (
                <>
                  <Stat label="Cash" value={fmtUsd(portfolio.cash)} />
                  <Stat label="Buying Power" value={fmtUsd(portfolio.buyingPower)} />
                  <Stat
                    label="Day P&L"
                    value={`${fmtSignedUsd(portfolio.dayPnl)} (${fmtPct(portfolio.dayPnlPct)})`}
                    valueClass={pnlClass(portfolio.dayPnl)}
                  />
                  <Stat
                    label="Total P&L"
                    value={fmtSignedUsd(portfolio.totalPnl)}
                    valueClass={pnlClass(portfolio.totalPnl)}
                  />
                </>
              )}
            </div>
            {portfolio.positions?.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                  Positions
                </p>
                <div className="space-y-1.5">
                  {portfolio.positions.map((pos) => (
                    <div key={pos.symbol} className="flex justify-between text-xs">
                      <span className="font-mono font-semibold">{pos.symbol}</span>
                      <span
                        className={Number(pos.unrealizedPnl) >= 0 ? 'text-buy' : 'text-destructive'}
                      >
                        {Number(pos.unrealizedPnl) >= 0 ? '+' : ''}$
                        {Number(pos.unrealizedPnl).toFixed(2)}
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

  const isOfflineAccount = (accountId: string) =>
    accounts.find((a) => a.id === accountId)?.brokerType === BrokerType.OFFLINE;
  const totals = sumPortfolioTotals(portfolios, isOfflineAccount);
  const anyOffline = portfolios.some((p) => isOfflineAccount(p.accountId));

  return (
    <div className="space-y-3">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">All accounts</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1.5">
          <Stat
            label="Day P&L"
            value={fmtSignedUsd(totals.dayPnl)}
            valueClass={pnlClass(totals.dayPnl)}
          />
          <Stat
            label="Total P&L"
            value={fmtSignedUsd(totals.totalPnl)}
            valueClass={pnlClass(totals.totalPnl)}
          />
          {anyOffline && (
            <>
              <Stat
                label="Realized (since snapshot)"
                value={fmtSignedUsd(totals.realizedSince)}
                valueClass={pnlClass(totals.realizedSince)}
              />
              <Stat
                label="Realized (lifetime)"
                value={fmtSignedUsd(totals.realizedLifetime)}
                valueClass={pnlClass(totals.realizedLifetime)}
              />
              <p className="text-xs text-muted-foreground">Offline accounts only</p>
            </>
          )}
        </CardContent>
      </Card>
      {portfolios.map((portfolio) => {
        const account = accounts.find((a) => a.id === portfolio.accountId);
        return (
          <Card key={portfolio.portfolioId ?? portfolio.accountId}>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm">
                  {account?.displayName ?? portfolio.accountId}
                </CardTitle>
                {account && (
                  <Badge variant="secondary" className="text-[10px] px-1 py-0 h-4">
                    {brokerLabel(account.brokerType)}
                  </Badge>
                )}
              </div>
            </CardHeader>
            <CardContent className="space-y-1.5">
              <Stat label="Equity" value={fmtUsd(portfolio.equity)} />
              <Stat
                label="Day P&L"
                value={fmtSignedUsd(portfolio.dayPnl)}
                valueClass={pnlClass(portfolio.dayPnl)}
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
