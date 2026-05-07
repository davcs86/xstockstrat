'use client';

import useSWR from 'swr';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

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

interface AccountPortfolioSelectorProps {
  accountId: string;
  onAccountChange: (id: string) => void;
}

export function AccountPortfolioSelector({ accountId, onAccountChange }: AccountPortfolioSelectorProps) {
  const { data, isLoading } = useSWR(
    `/api/portfolio?account_id=${accountId}`,
    fetcher,
    { refreshInterval: 30000 },
  );

  const accounts: any[] = data?.accounts ?? [];
  const portfolios: any[] = data?.portfolios ?? [];
  const activeAccounts = accounts.filter((a) => a.is_active);

  // Aggregate across all portfolios for "All Accounts" view
  const aggregated = portfolios.reduce(
    (acc, p) => ({
      equity: acc.equity + Number(p.equity ?? 0),
      day_pnl: acc.day_pnl + Number(p.day_pnl ?? 0),
      positions: [...acc.positions, ...(p.positions ?? [])],
    }),
    { equity: 0, day_pnl: 0, positions: [] as any[] },
  );

  const selectedPortfolio = accountId
    ? portfolios.find((p) => p.account_id === accountId)
    : null;
  const selectedAccount = accountId
    ? accounts.find((a) => a.account_id === accountId)
    : null;

  return (
    <div className="space-y-3">
      <Select value={accountId} onValueChange={onAccountChange}>
        <SelectTrigger className="w-[220px] h-8 text-xs">
          <SelectValue placeholder="All Accounts" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="">All Accounts</SelectItem>
          {activeAccounts.map((account) => (
            <SelectItem key={account.account_id} value={account.account_id}>
              <span className="flex items-center gap-1">
                {account.display_name}
                <Badge variant="secondary" className="text-[10px] px-1 py-0 h-4">
                  {brokerLabel(account.broker_type)}
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
                {selectedAccount?.display_name ?? accountId}
              </CardTitle>
              {selectedAccount && (
                <Badge variant="secondary" className="text-[10px] px-1 py-0 h-4">
                  {brokerLabel(selectedAccount.broker_type)}
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
              value={`${Number(selectedPortfolio.day_pnl) >= 0 ? '+' : ''}$${Number(selectedPortfolio.day_pnl).toFixed(2)}`}
              valueClass={Number(selectedPortfolio.day_pnl) >= 0 ? 'text-buy' : 'text-destructive'}
            />
            <Stat
              label="Total P&L"
              value={`$${Number(selectedPortfolio.total_pnl ?? 0).toFixed(2)}`}
            />
            {selectedPortfolio.positions?.length > 0 && (
              <p className="text-xs text-muted-foreground pt-1">
                {selectedPortfolio.positions.length} position{selectedPortfolio.positions.length > 1 ? 's' : ''}
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
              value={`${aggregated.day_pnl >= 0 ? '+' : ''}$${aggregated.day_pnl.toFixed(2)}`}
              valueClass={aggregated.day_pnl >= 0 ? 'text-buy' : 'text-destructive'}
            />
            {aggregated.positions.length > 0 && (
              <p className="text-xs text-muted-foreground pt-1">
                {aggregated.positions.length} position{aggregated.positions.length > 1 ? 's' : ''} across all accounts
              </p>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
