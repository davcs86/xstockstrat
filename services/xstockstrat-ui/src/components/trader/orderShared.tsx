// Shared order-table building blocks used by OrderBook, OrdersTable, and the order-detail
// page: the status/type lookup tables, price formatting, and the recurring table cells.
// Single source of truth (DRY guard rail — see docs/patterns/dry-guard-rail.md).

import Link from 'next/link';
import { OrderSide, OrderStatus } from '@xstockstrat/proto/trading/v1/trading_pb';
import { Badge } from '../ui/badge';
import { TableCell } from '../ui/table';

export const STATUS_VARIANT: Record<
  string,
  'info' | 'warning' | 'buy' | 'secondary' | 'destructive'
> = {
  NEW: 'info',
  PARTIALLY_FILLED: 'warning',
  FILLED: 'buy',
  CANCELED: 'secondary',
  EXPIRED: 'secondary',
  REJECTED: 'destructive',
  PENDING_APPROVAL: 'warning',
};

export const TYPE_LABEL: Record<string, string> = {
  MARKET: 'Market',
  LIMIT: 'Limit',
  STOP: 'Stop',
  STOP_LIMIT: 'Stop Limit',
  TRAILING_STOP: 'Trailing Stop',
};

/** `$1234.56`, or `—` for empty/zero. */
export function formatUsd(v: number | string | undefined | null): string {
  if (v === undefined || v === null || Number(v) === 0) return '—';
  return `$${Number(v).toFixed(2)}`;
}

export function OrderSideBadge({ side }: { side: OrderSide }) {
  return (
    <Badge variant={side === OrderSide.BUY ? 'buy' : 'sell'}>
      {side === OrderSide.BUY ? 'BUY' : 'SELL'}
    </Badge>
  );
}

export function OrderStatusBadge({ status }: { status: OrderStatus }) {
  const name = OrderStatus[status] ?? 'UNKNOWN';
  return <Badge variant={STATUS_VARIANT[name] ?? 'secondary'}>{name}</Badge>;
}

/** Symbol cell linking to the order-detail page. */
export function OrderSymbolCell({ order }: { order: { orderId: string; symbol: string } }) {
  return (
    <TableCell className="font-mono font-semibold">
      <Link href={`/trader/orders/${order.orderId}`} className="hover:underline">
        {order.symbol}
      </Link>
    </TableCell>
  );
}

export function OrderSideCell({ side }: { side: OrderSide }) {
  return (
    <TableCell>
      <OrderSideBadge side={side} />
    </TableCell>
  );
}

export function OrderStatusCell({ status }: { status: OrderStatus }) {
  return (
    <TableCell>
      <OrderStatusBadge status={status} />
    </TableCell>
  );
}
