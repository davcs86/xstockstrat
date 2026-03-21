'use client';
import useSWR from 'swr';
import type { TradingMode } from '@/app/page';
import { Card, CardHeader, CardTitle, CardContent } from './ui/card';
import { Badge } from './ui/badge';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from './ui/table';

const fetcher = (url: string) => fetch(url).then((r) => r.json());

// ── OrderBook ──────────────────────────────────────────────────────────────
export function OrderBook({ mode }: { mode: TradingMode }) {
  const { data, error, isLoading } = useSWR(
    `/api/orders?trading_mode=${mode}`,
    fetcher,
    { refreshInterval: 5000 },
  );

  const statusVariant: Record<string, 'info' | 'warning' | 'buy' | 'secondary' | 'destructive' | 'warning'> = {
    ORDER_STATUS_NEW: 'info',
    ORDER_STATUS_PARTIALLY_FILLED: 'warning',
    ORDER_STATUS_FILLED: 'buy',
    ORDER_STATUS_CANCELED: 'secondary',
    ORDER_STATUS_REJECTED: 'destructive',
    ORDER_STATUS_PENDING_APPROVAL: 'warning',
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Orders</CardTitle>
          <Badge variant={mode === 'paper' ? 'paper' : 'live'}>
            {mode === 'paper' ? 'PAPER' : 'LIVE'}
          </Badge>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
        {error && <p className="text-sm text-destructive">Failed to load orders</p>}
        {data?.orders && (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Symbol</TableHead>
                  <TableHead>Side</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  <TableHead className="text-right">Filled</TableHead>
                  <TableHead className="text-right hidden sm:table-cell">Avg Price</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.orders.map((order: any) => (
                  <TableRow key={order.order_id}>
                    <TableCell className="font-mono font-semibold">{order.symbol}</TableCell>
                    <TableCell>
                      <Badge variant={order.side === 'ORDER_SIDE_BUY' ? 'buy' : 'sell'}>
                        {order.side === 'ORDER_SIDE_BUY' ? 'BUY' : 'SELL'}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">{order.qty}</TableCell>
                    <TableCell className="text-right text-muted-foreground">{order.filled_qty ?? 0}</TableCell>
                    <TableCell className="text-right hidden sm:table-cell">
                      {order.filled_avg_price ? `$${Number(order.filled_avg_price).toFixed(2)}` : '—'}
                    </TableCell>
                    <TableCell>
                      <Badge variant={(statusVariant[order.status] as any) ?? 'secondary'}>
                        {order.status?.replace('ORDER_STATUS_', '')}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {data.orders.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-6">No {mode} orders</p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ── PortfolioSummary ───────────────────────────────────────────────────────
export function PortfolioSummary({ mode }: { mode: TradingMode }) {
  const { data, isLoading, error } = useSWR(
    `/api/portfolio?trading_mode=${mode}`,
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

  const pnlPositive = data.day_pnl >= 0;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Portfolio</CardTitle>
          <Badge variant={mode === 'paper' ? 'paper' : 'live'}>
            {mode === 'paper' ? 'PAPER' : 'LIVE'}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Stat label="Equity" value={`$${Number(data.equity).toLocaleString('en-US', { minimumFractionDigits: 2 })}`} />
          <Stat label="Cash" value={`$${Number(data.cash).toLocaleString('en-US', { minimumFractionDigits: 2 })}`} />
          <Stat label="Buying Power" value={`$${Number(data.buying_power).toLocaleString('en-US', { minimumFractionDigits: 2 })}`} />
          <Stat
            label="Day P&L"
            value={`${pnlPositive ? '+' : ''}$${Number(data.day_pnl).toFixed(2)} (${Number(data.day_pnl_pct * 100).toFixed(2)}%)`}
            valueClass={pnlPositive ? 'text-buy' : 'text-destructive'}
          />
          <Stat label="Total P&L" value={`$${Number(data.total_pnl).toFixed(2)}`} />
        </div>

        {data.positions?.length > 0 && (
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Positions</p>
            <div className="space-y-1.5">
              {data.positions.map((pos: any) => (
                <div key={pos.symbol} className="flex justify-between text-xs">
                  <span className="font-mono font-semibold">{pos.symbol}</span>
                  <span className={pos.unrealized_pnl >= 0 ? 'text-buy' : 'text-destructive'}>
                    {pos.unrealized_pnl >= 0 ? '+' : ''}${Number(pos.unrealized_pnl).toFixed(2)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── Shared helpers ─────────────────────────────────────────────────────────
function Stat({ label, value, valueClass = 'text-foreground' }: { label: string; value: string; valueClass?: string }) {
  return (
    <div className="flex justify-between text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className={`font-medium tabular-nums ${valueClass}`}>{value}</span>
    </div>
  );
}
