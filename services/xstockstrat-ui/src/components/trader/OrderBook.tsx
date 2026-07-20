'use client';
import Link from 'next/link';
import type { TradingMode } from '@/app/trader/page';
import { useAccountContext } from '@/context/AccountContext';
import { useOrders } from '@/hooks/useOrders';
import { usePortfolio } from '@/hooks/usePortfolio';
import { Card, CardHeader, CardTitle, CardContent } from '../ui/card';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '../ui/table';
import { Stat } from '../shared/Stat';
import { CardNotice } from '../shared/CardNotice';
import { QueryStateMessages } from '../shared/QueryStateMessages';
import { OrderSymbolCell, OrderSideCell, OrderStatusCell, formatUsd } from './orderShared';

// ── OrderBook ──────────────────────────────────────────────────────────────
export function OrderBook({ mode }: { mode: TradingMode }) {
  const { selectedAccountId } = useAccountContext();
  const { data, error, isLoading } = useOrders(mode, selectedAccountId);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Orders</CardTitle>
      </CardHeader>
      <CardContent>
        <QueryStateMessages isLoading={isLoading} error={error} errorText="Failed to load orders" />
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
                {data.orders.map((order) => (
                  <TableRow key={order.orderId} className="cursor-pointer hover:bg-accent/40">
                    <OrderSymbolCell order={order} />
                    <OrderSideCell side={order.side} />
                    <TableCell className="text-right">{order.qty}</TableCell>
                    <TableCell className="text-right text-muted-foreground">
                      {order.filledQty ?? 0}
                    </TableCell>
                    <TableCell className="text-right hidden sm:table-cell">
                      {formatUsd(order.filledAvgPrice)}
                    </TableCell>
                    <OrderStatusCell status={order.status} />
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
  const { selectedAccountId } = useAccountContext();
  const { data, isLoading, error } = usePortfolio(mode, selectedAccountId);

  if (isLoading) return <CardNotice>Loading portfolio…</CardNotice>;
  if (error || !data) return <CardNotice variant="error">Portfolio unavailable</CardNotice>;

  const pnlPositive = data.dayPnl >= 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Portfolio</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Stat
            label="Equity"
            value={`$${Number(data.equity).toLocaleString('en-US', { minimumFractionDigits: 2 })}`}
          />
          <Stat
            label="Cash"
            value={`$${Number(data.cash).toLocaleString('en-US', { minimumFractionDigits: 2 })}`}
          />
          <Stat
            label="Buying Power"
            value={`$${Number(data.buyingPower).toLocaleString('en-US', { minimumFractionDigits: 2 })}`}
          />
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
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                Positions
              </p>
              <Link href="/trader/positions" className="text-xs text-primary hover:underline">
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
