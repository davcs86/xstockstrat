'use client';

import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useAccountPortfolios } from '@/hooks/useAccountPortfolios';
import { Stat } from '@/components/shared/Stat';
import { brokerLabel } from '@/lib/brokers';
import { PNL_UNAVAILABLE_LABEL } from '@/lib/portfolioTotals';

interface AccountPortfolioSelectorProps {
  accountId: string;
  onAccountChange: (id: string) => void;
}

export function AccountPortfolioSelector({
  accountId,
  onAccountChange,
}: AccountPortfolioSelectorProps) {
  const { data, isLoading } = useAccountPortfolios(accountId);

  const accounts = data?.accounts ?? [];
  const portfolios = data?.portfolios ?? [];
  const activeAccounts = accounts.filter((a) => a.isActive);

  // Aggregate across all portfolios for "All Accounts" view
  const aggregated = portfolios.reduce(
    (acc, p) => ({
      equity: acc.equity + Number(p.equity ?? 0),
      dayPnl: acc.dayPnl + (p.offlineStateUnavailable ? 0 : Number(p.dayPnl ?? 0)),
      incomplete: acc.incomplete || p.offlineStateUnavailable,
      positions: [...acc.positions, ...(p.positions ?? [])],
    }),
    { equity: 0, dayPnl: 0, incomplete: false, positions: [] as unknown[] },
  );

  const selectedPortfolio = accountId ? portfolios.find((p) => p.accountId === accountId) : null;
  const selectedAccount = accountId ? accounts.find((a) => a.id === accountId) : null;

  return (
    <div className="space-y-3">
      <Select
        value={accountId || '__all__'}
        onValueChange={(v) => onAccountChange(v === '__all__' ? '' : v)}
      >
        <SelectTrigger className="w-[220px] h-8 text-xs">
          <SelectValue placeholder="All Accounts" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__all__">All Accounts</SelectItem>
          {activeAccounts.map((account) => (
            <SelectItem key={account.id} value={account.id}>
              <span className="flex items-center gap-1">
                {account.displayName}
                <Badge variant="secondary" className="text-[10px] px-1 py-0 h-4">
                  {brokerLabel(account.brokerType)}
                </Badge>
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {isLoading ? (
        <Card>
          <CardContent className="pt-5">
            <p className="text-sm text-muted-foreground">Loading portfolio…</p>
          </CardContent>
        </Card>
      ) : accountId && selectedPortfolio ? (
        // Single account view
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">
                {selectedAccount?.displayName ?? accountId}
              </CardTitle>
              {selectedAccount && (
                <Badge variant="secondary" className="text-[10px] px-1 py-0 h-4">
                  {brokerLabel(selectedAccount.brokerType)}
                </Badge>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-2">
            <Stat
              label="Equity"
              value={`$${Number(selectedPortfolio.equity).toLocaleString('en-US', { minimumFractionDigits: 2 })}`}
            />
            <Stat
              label="Cash"
              value={`$${Number(selectedPortfolio.cash ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}`}
            />
            <Stat
              label="Day P&L"
              value={
                selectedPortfolio.offlineStateUnavailable
                  ? PNL_UNAVAILABLE_LABEL
                  : `${Number(selectedPortfolio.dayPnl) >= 0 ? '+' : ''}$${Number(selectedPortfolio.dayPnl).toFixed(2)}`
              }
              valueClass={
                selectedPortfolio.offlineStateUnavailable
                  ? 'text-muted-foreground'
                  : Number(selectedPortfolio.dayPnl) >= 0
                    ? 'text-buy'
                    : 'text-destructive'
              }
            />
            <Stat
              label="Total P&L"
              value={
                selectedPortfolio.offlineStateUnavailable
                  ? PNL_UNAVAILABLE_LABEL
                  : `$${Number(selectedPortfolio.totalPnl ?? 0).toFixed(2)}`
              }
            />
            {selectedPortfolio.positions?.length > 0 && (
              <p className="text-xs text-muted-foreground pt-1">
                {selectedPortfolio.positions.length} position
                {selectedPortfolio.positions.length > 1 ? 's' : ''}
              </p>
            )}
          </CardContent>
        </Card>
      ) : (
        // All Accounts aggregate view
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">All Accounts</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <Stat
              label="Total Equity"
              value={`$${aggregated.equity.toLocaleString('en-US', { minimumFractionDigits: 2 })}`}
            />
            <Stat
              label="Day P&L"
              value={
                aggregated.incomplete
                  ? PNL_UNAVAILABLE_LABEL
                  : `${aggregated.dayPnl >= 0 ? '+' : ''}$${aggregated.dayPnl.toFixed(2)}`
              }
              valueClass={
                aggregated.incomplete
                  ? 'text-muted-foreground'
                  : aggregated.dayPnl >= 0
                    ? 'text-buy'
                    : 'text-destructive'
              }
            />
            {aggregated.positions.length > 0 && (
              <p className="text-xs text-muted-foreground pt-1">
                {aggregated.positions.length} position{aggregated.positions.length > 1 ? 's' : ''}{' '}
                across all accounts
              </p>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
