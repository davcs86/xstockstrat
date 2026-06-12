'use client';
import { AppShell } from '@/components/trader/AppShell';
import { useAccountContext } from '@/context/AccountContext';
import { usePositions } from '@/hooks/usePortfolio';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';

function fmtUsd(n: number | undefined | null): string {
  if (n === undefined || n === null || Number.isNaN(Number(n))) return '—';
  return `$${Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtPct(n: number | undefined | null): string {
  if (n === undefined || n === null || Number.isNaN(Number(n))) return '—';
  const pct = Number(n) * 100;
  return `${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%`;
}

export default function PositionsPage() {
  const { selectedAccountId, environmentMode } = useAccountContext();
  // Trading mode is fixed by the deployment environment — not user-selectable.
  const mode = environmentMode ?? 'paper';

  const { data, error, isLoading } = usePositions(mode, selectedAccountId);

  const positions = data?.positions ?? [];
  const totalUnrealized = positions.reduce((sum, p) => sum + Number(p.unrealizedPnl ?? 0), 0);

  return (
    <AppShell>
      <div className="p-4 sm:p-6 space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-xl font-bold tracking-tight">Positions</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Open positions for the selected account, refreshed every 10s
            </p>
          </div>
        </div>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between flex-wrap gap-2">
              <CardTitle>Open positions</CardTitle>
              {positions.length > 0 && (
                <div className="text-sm">
                  <span className="text-muted-foreground">Unrealized P&L: </span>
                  <span
                    className={`font-semibold tabular-nums ${
                      totalUnrealized >= 0 ? 'text-buy' : 'text-destructive'
                    }`}
                  >
                    {totalUnrealized >= 0 ? '+' : ''}
                    {fmtUsd(totalUnrealized)}
                  </span>
                </div>
              )}
            </div>
          </CardHeader>
          <CardContent>
            {isLoading && <p className="text-sm text-muted-foreground">Loading positions…</p>}
            {error && <p className="text-sm text-destructive">Failed to load positions</p>}
            {!isLoading && !error && positions.length === 0 && (
              <p className="text-sm text-muted-foreground py-6 text-center">
                No open {mode} positions
                {selectedAccountId ? '' : ' (select an account in the header)'}
              </p>
            )}
            {positions.length > 0 && (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Symbol</TableHead>
                    <TableHead className="text-right">Qty</TableHead>
                    <TableHead className="text-right hidden sm:table-cell">Avg Entry</TableHead>
                    <TableHead className="text-right">Current</TableHead>
                    <TableHead className="text-right hidden md:table-cell">Market Value</TableHead>
                    <TableHead className="text-right">Unrealized P&L</TableHead>
                    <TableHead className="text-right">%</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {positions.map((p) => {
                    const pnlPositive = Number(p.unrealizedPnl ?? 0) >= 0;
                    return (
                      <TableRow key={`${p.accountId ?? ''}-${p.symbol}`}>
                        <TableCell className="font-mono font-semibold">{p.symbol}</TableCell>
                        <TableCell className="text-right tabular-nums">{p.qty}</TableCell>
                        <TableCell className="text-right tabular-nums hidden sm:table-cell">
                          {fmtUsd(p.avgEntryPrice)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{fmtUsd(p.currentPrice)}</TableCell>
                        <TableCell className="text-right tabular-nums hidden md:table-cell">
                          {fmtUsd(p.marketValue)}
                        </TableCell>
                        <TableCell
                          className={`text-right tabular-nums font-semibold ${
                            pnlPositive ? 'text-buy' : 'text-destructive'
                          }`}
                        >
                          {pnlPositive ? '+' : ''}
                          {fmtUsd(p.unrealizedPnl)}
                        </TableCell>
                        <TableCell
                          className={`text-right tabular-nums ${
                            pnlPositive ? 'text-buy' : 'text-destructive'
                          }`}
                        >
                          {fmtPct(p.unrealizedPnlPct)}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
            {!selectedAccountId && positions.length === 0 && (
              <Badge variant="secondary" className="mt-3">
                No account selected
              </Badge>
            )}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
