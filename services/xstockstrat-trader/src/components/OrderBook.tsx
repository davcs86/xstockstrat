'use client';
import Link from 'next/link';
import type { TradingMode } from '@/app/page';
import { useAccountContext } from '@/context/AccountContext';
import { useOrders } from '@/hooks/useOrders';
import { usePortfolio } from '@/hooks/usePortfolio';
import { OrderSide, OrderStatus } from '@xstockstrat/proto/trading/v1/trading_pb';
import { Card, CardHeader, CardTitle, CardContent } from './ui/card';
import { Badge } from './ui/badge';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from './ui/table';

const STATUS_VARIANT: Record<string, 'info' | 'warning' | 'buy' | 'secondary' | 'destructive'> = {
  NEW: 'info',
  PARTIALLY_FILLED: 'warning',
  FILLED: 'buy',
  CANCELED: 'secondary',
  EXPIRED: 'secondary',
  REJECTED: 'destructive',
  PENDING_APPROVAL: 'warning',
};

// ── OrderBook ──────────────────────────────────────────────────────────────
export function OrderBook({ mode }: { mode: TradingMode }) {
  const { selectedAccountId } = useAccountContext();
  const { data, error, isLoading } = useOrders(mode, selectedAccountId);

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
                {data.orders.map((order) => {
                  const statusName = OrderStatus[order.status] ?? 'UNKNOWN';
                  return (
                    <TableRow key={order.orderId} className="cursor-pointer hover:bg-accent/40">
                      <TableCell className="font-mono font-semibold">
                        <Link href={`/orders/${order.orderId}`} className="hover:underline">
                          {order.symbol}
                        </Link>
                      </TableCell>
                      <TableCell>
                        <Badge variant={order.side === OrderSide.BUY ? 'buy' : 'sell'}>
                          {order.side === OrderSide.BUY ? 'BUY' : 'SELL'}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">{order.qty}</TableCell>
                      <TableCell className="text-right text-muted-foreground">{order.filledQty ?? 0}</TableCell>
                      <TableCell className="text-right hidden sm:table-cell">
                        {order.filledAvgPrice ? `$${Number(order.filledAvgPrice).toFixed(2)}` : '—'}
                      </TableCell>
                      <TableCell>
                        <Badge variant={STATUS_VARIANT[statusName] ?? 'secondary'}>
                          {statusName}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  );
                })}
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
  const { selectedAccountId } = useAccountContext();
  const { data, isLoading, error } = usePortfolio(mode, selectedAccountId);

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

  const pnlPositive = data.dayPnl >= 0;

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
          <Stat label="Buying Power" value={`$${Number(data.buyingPower).toLocaleString('en-US', { minimumFractionDigits: 2 })}`} />
          <Stat
            label="Day P&L"
            value={`${pnlPositive ? '+' : ''}$${Number(data.dayPnl).toFixed(2)} (${Number(data.dayPnlPct * 100).toFixed(2)}%)`}
            valueClass={pnlPositive ? 'text-buy' : 'text-destructive'}
          />
          <Stat label="Total P&L" value={`$${Number(data.totalPnl).toFixed(2)}`} />
        </div>

        {data.positions?.length > 0 && (
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Positions</p>
              <Link href="/positions" className="text-xs text-primary hover:underline">
                View all →
              </Link>
            </div>
            <div className="space-y-1.5">
              {data.positions.map((pos) => (
                <div key={pos.symbol} className="flex justify-between text-xs">
                  <span className="font-mono font-semibold">{pos.symbol}</span>
                  <span className={pos.unrealizedPnl >= 0 ? 'text-buy' : 'text-destructive'}>
                    {pos.unrealizedPnl >= 0 ? '+' : ''}${Number(pos.unrealizedPnl).toFixed(2)}
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
