'use client';
import { useMemo, useState } from 'react';
import Link from 'next/link';
import type { ColumnDef } from '@tanstack/react-table';
import type { Order } from '@xstockstrat/proto/trading/v1/trading_pb';
import { OrderStatus, OrderType } from '@xstockstrat/proto/trading/v1/trading_pb';
import { BASE_PATH_INSIGHTS } from '@/lib/basepath';
import { pickFresherOrder } from '@/lib/orderFreshness';
import { useOrderUpdates } from '@/hooks/useOrderUpdates';
import { useCancelOrder } from '@/hooks/useCancelOrder';
import { Card, CardHeader, CardTitle, CardContent } from '../ui/card';
import { Alert, AlertDescription } from '../ui/alert';
import { DataTable } from '../ui/data-table';
import { EditOrderDialog } from './EditOrderDialog';
import { QueryStateMessages } from '../shared/QueryStateMessages';
import { RowActionsMenu } from '../shared/RowActionsMenu';
import { TYPE_LABEL, formatUsd, OrderSideBadge, OrderStatusBadge } from './orderShared';

// `HH:MM` local time an order was placed, from a protobuf-es Timestamp ({ seconds: bigint }).
function placedLabel(createdAt: { seconds: bigint } | undefined): string {
  if (!createdAt || !createdAt.seconds) return '—';
  return new Date(Number(createdAt.seconds) * 1000).toTimeString().slice(0, 5);
}

// Terminal statuses cannot be edited or canceled.
const TERMINAL = new Set<OrderStatus>([
  OrderStatus.FILLED,
  OrderStatus.CANCELED,
  OrderStatus.EXPIRED,
  OrderStatus.REJECTED,
]);

interface OrdersTableProps {
  orders: Order[];
  isLoading?: boolean;
  error?: Error | null;
  emptyLabel?: string;
}

export function OrdersTable({
  orders,
  isLoading,
  error,
  emptyLabel = 'No orders',
}: OrdersTableProps) {
  // A StreamOrderUpdates record overrides the listed snapshot unless the polled record has a
  // strictly newer `updatedAt` (pickFresherOrder).
  const { updates: liveUpdates, disconnected, terminal } = useOrderUpdates();
  const { mutate: cancelOrder } = useCancelOrder();
  const [editing, setEditing] = useState<Order | null>(null);

  // Wrapped in useMemo — TanStack Table requires a referentially-stable `data` array.
  const merged = useMemo(
    () => orders.map((o) => pickFresherOrder(liveUpdates[o.orderId], o)),
    [orders, liveUpdates],
  );

  const columns = useMemo<ColumnDef<Order>[]>(
    () => [
      {
        id: 'symbol',
        header: 'Symbol',
        meta: { className: 'font-mono font-semibold' },
        cell: ({ row }) => (
          <Link href={`/trader/orders/${row.original.orderId}`} className="hover:underline">
            {row.original.symbol}
          </Link>
        ),
      },
      {
        id: 'side',
        header: 'Side',
        cell: ({ row }) => <OrderSideBadge side={row.original.side} />,
      },
      {
        id: 'type',
        header: 'Type',
        meta: { className: 'hidden sm:table-cell text-muted-foreground' },
        cell: ({ row }) => {
          const typeName = OrderType[row.original.orderType] ?? 'UNKNOWN';
          return TYPE_LABEL[typeName] ?? typeName;
        },
      },
      {
        accessorKey: 'qty',
        header: 'Qty',
        meta: { className: 'text-right' },
      },
      {
        id: 'filled',
        header: 'Filled',
        accessorFn: (o) => o.filledQty ?? 0,
        meta: { className: 'text-right text-muted-foreground' },
      },
      {
        id: 'avgPrice',
        header: 'Avg Price',
        accessorFn: (o) => o.filledAvgPrice,
        meta: { className: 'text-right hidden md:table-cell' },
        cell: ({ row }) => formatUsd(row.original.filledAvgPrice),
      },
      {
        id: 'status',
        header: 'Status',
        cell: ({ row }) => (
          <OrderStatusBadge status={row.original.status} intentState={row.original.intentState} />
        ),
      },
      {
        id: 'fromSignal',
        header: 'From signal',
        meta: { className: 'hidden lg:table-cell text-muted-foreground' },
        cell: ({ row }) => {
          const order = row.original;
          return order.strategyId ? (
            <Link
              href={`${BASE_PATH_INSIGHTS}/strategies/${encodeURIComponent(order.strategyId)}`}
              className="text-primary hover:underline"
              title="Why? — the strategy that originated this order"
              data-testid={`order-origin-${order.orderId}`}
            >
              {order.strategyId}
            </Link>
          ) : (
            <span data-testid={`order-origin-${order.orderId}`}>Manual</span>
          );
        },
      },
      {
        id: 'placed',
        header: 'Placed',
        accessorFn: (o) => o.createdAt?.seconds ?? BigInt(0),
        meta: { className: 'text-right tabular-nums text-muted-foreground hidden md:table-cell' },
        cell: ({ row }) => placedLabel(row.original.createdAt),
      },
      {
        id: 'actions',
        header: 'Actions',
        enableSorting: false,
        meta: { className: 'text-right whitespace-nowrap' },
        cell: ({ row }) => {
          const order = row.original;
          const isTerminal = TERMINAL.has(order.status);
          return (
            <RowActionsMenu
              testId={`actions-${order.orderId}`}
              triggerLabel={`Actions for order ${order.orderId}`}
              actions={[
                { label: 'Edit', disabled: isTerminal, onSelect: () => setEditing(order) },
                {
                  label: 'Cancel',
                  destructive: true,
                  disabled: isTerminal,
                  onSelect: () => cancelOrder({ orderId: order.orderId }),
                  confirm: {
                    title: 'Cancel order',
                    description: `Cancel this ${order.symbol} order?`,
                    cancelLabel: 'Dismiss',
                    confirmLabel: 'Confirm',
                  },
                },
              ]}
            />
          );
        },
      },
    ],
    [cancelOrder],
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Orders</CardTitle>
      </CardHeader>
      <CardContent>
        <QueryStateMessages isLoading={isLoading} error={error} errorText="Failed to load orders" />
        {disconnected && (
          <Alert variant="destructive" role="alert" data-testid="order-stream-disconnected">
            <AlertDescription>
              {terminal
                ? `Live order updates stopped: ${terminal}`
                : 'Live order updates disconnected — reconnecting…'}
            </AlertDescription>
          </Alert>
        )}
        {!isLoading && !error && (
          <DataTable
            columns={columns}
            data={merged}
            getRowId={(order) => order.orderId}
            getRowProps={(order) => ({ 'data-testid': `order-row-${order.orderId}` })}
          />
        )}
        {!isLoading && !error && merged.length === 0 && (
          <p className="text-sm text-muted-foreground text-center py-6">{emptyLabel}</p>
        )}
      </CardContent>
      <EditOrderDialog
        order={editing}
        open={!!editing}
        onOpenChange={(o) => {
          if (!o) setEditing(null);
        }}
      />
    </Card>
  );
}
