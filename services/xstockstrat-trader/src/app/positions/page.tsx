'use client';
import { useState } from 'react';
import useSWR from 'swr';
import { BASE_PATH } from '@/lib/basepath';
import { AppShell } from '@/components/AppShell';
import { useAccountContext } from '@/context/AccountContext';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';

const fetcher = (url: string) => fetch(url).then((r) => r.json());

type TradingMode = 'paper' | 'live';

interface Position {
  symbol: string;
  qty: number;
  avg_entry_price: number;
  current_price: number;
  market_value: number;
  unrealized_pnl: number;
  unrealized_pnl_pct: number;
  cost_basis: number;
  account_id?: string;
}

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
  const { selectedAccountId } = useAccountContext();
  const [mode, setMode] = useState<TradingMode>('paper');

  const { data, error, isLoading } = useSWR(
    `${BASE_PATH}/api/portfolio?trading_mode=${mode}&account_id=${selectedAccountId ?? ''}`,
    fetcher,
    { refreshInterval: 10_000 },
  );

  const positions: Position[] = data?.positions ?? [];
  const totalUnrealized = positions.reduce((sum, p) => sum + Number(p.unrealized_pnl ?? 0), 0);

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
          <div className="flex items-center gap-1 rounded-lg bg-secondary p-1">
            {(['paper', 'live'] as TradingMode[]).map((m) => (
              <Button
                key={m}
                size="sm"
                variant="ghost"
                onClick={() => setMode(m)}
                className={
                  mode === m
                    ? m === 'paper'
                      ? 'bg-paper/20 text-paper hover:bg-paper/30 h-7 px-3'
                      : 'bg-buy/20 text-buy hover:bg-buy/30 h-7 px-3'
                    : 'text-muted-foreground hover:text-foreground h-7 px-3'
                }
              >
                {m.toUpperCase()}
              </Button>
            ))}
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
                    const pnlPositive = Number(p.unrealized_pnl ?? 0) >= 0;
                    return (
                      <TableRow key={`${p.account_id ?? ''}-${p.symbol}`}>
                        <TableCell className="font-mono font-semibold">{p.symbol}</TableCell>
                        <TableCell className="text-right tabular-nums">{p.qty}</TableCell>
                        <TableCell className="text-right tabular-nums hidden sm:table-cell">
                          {fmtUsd(p.avg_entry_price)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{fmtUsd(p.current_price)}</TableCell>
                        <TableCell className="text-right tabular-nums hidden md:table-cell">
                          {fmtUsd(p.market_value)}
                        </TableCell>
                        <TableCell
                          className={`text-right tabular-nums font-semibold ${
                            pnlPositive ? 'text-buy' : 'text-destructive'
                          }`}
                        >
                          {pnlPositive ? '+' : ''}
                          {fmtUsd(p.unrealized_pnl)}
                        </TableCell>
                        <TableCell
                          className={`text-right tabular-nums ${
                            pnlPositive ? 'text-buy' : 'text-destructive'
                          }`}
                        >
                          {fmtPct(p.unrealized_pnl_pct)}
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
