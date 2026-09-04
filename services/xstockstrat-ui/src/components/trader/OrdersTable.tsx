'use client';
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { EllipsisVertical } from 'lucide-react';
import type { ColumnDef } from '@tanstack/react-table';
import type { Order } from '@xstockstrat/proto/trading/v1/trading_pb';
import { OrderStatus, OrderType } from '@xstockstrat/proto/trading/v1/trading_pb';
import { BASE_PATH_INSIGHTS } from '@/lib/basepath';
import { useOrderUpdates } from '@/hooks/useOrderUpdates';
import { useCancelOrder } from '@/hooks/useCancelOrder';
import { Card, CardHeader, CardTitle, CardContent } from '../ui/card';
import { Button } from '../ui/button';
import { DataTable } from '../ui/data-table';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '../ui/dropdown-menu';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogAction,
  AlertDialogCancel,
} from '../ui/alert-dialog';
import { EditOrderDialog } from './EditOrderDialog';
import { QueryStateMessages } from '../shared/QueryStateMessages';
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
  // Live updates pushed via StreamOrderUpdates override the listed snapshot so status
  // transitions appear without a manual refresh.
  const liveUpdates = useOrderUpdates();
  const { mutate: cancelOrder } = useCancelOrder();
  const [editing, setEditing] = useState<Order | null>(null);
  const [cancelling, setCancelling] = useState<Order | null>(null);

  // Wrapped in useMemo — TanStack Table requires a referentially-stable `data` array.
  const merged = useMemo(
    () => orders.map((o) => liveUpdates[o.orderId] ?? o),
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
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label="Actions"
                  data-testid={`actions-${order.orderId}`}
                >
                  <EllipsisVertical className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  disabled={isTerminal}
                  onClick={() => setEditing(order)}
                  data-testid={`edit-${order.orderId}`}
                >
                  Edit
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={isTerminal}
                  variant="destructive"
                  onSelect={(e) => {
                    e.preventDefault();
                    setCancelling(order);
                  }}
                  data-testid={`cancel-${order.orderId}`}
                >
                  Cancel
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          );
        },
      },
    ],
    [],
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Orders</CardTitle>
      </CardHeader>
      <CardContent>
        <QueryStateMessages isLoading={isLoading} error={error} errorText="Failed to load orders" />
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
      <AlertDialog
        open={!!cancelling}
        onOpenChange={(o) => {
          if (!o) setCancelling(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogCancel data-testid={`cancel-${cancelling?.orderId}-dismiss`}>
            Dismiss
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={() => {
              if (cancelling) cancelOrder({ orderId: cancelling.orderId });
              setCancelling(null);
            }}
            data-testid={`cancel-${cancelling?.orderId}-confirm`}
          >
            Confirm
          </AlertDialogAction>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
