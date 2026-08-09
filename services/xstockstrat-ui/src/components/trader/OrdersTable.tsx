'use client';
import { useState } from 'react';
import Link from 'next/link';
import type { Order } from '@xstockstrat/proto/trading/v1/trading_pb';
import { OrderStatus, OrderType } from '@xstockstrat/proto/trading/v1/trading_pb';
import { BASE_PATH_INSIGHTS } from '@/lib/basepath';
import { useOrderUpdates } from '@/hooks/useOrderUpdates';
import { useCancelOrder } from '@/hooks/useCancelOrder';
import { Card, CardHeader, CardTitle, CardContent } from '../ui/card';
import { Button } from '../ui/button';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '../ui/table';
import {
  AlertDialog,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogAction,
  AlertDialogCancel,
} from '../ui/alert-dialog';
import { EditOrderDialog } from './EditOrderDialog';
import { QueryStateMessages } from '../shared/QueryStateMessages';
import {
  TYPE_LABEL,
  formatUsd,
  OrderSymbolCell,
  OrderSideCell,
  OrderStatusCell,
} from './orderShared';

// `HH:MM` local time an order was placed, from a protobuf-es Timestamp ({ seconds: bigint }).
function placedLabel(createdAt: { seconds: bigint } | undefined): string {
  if (!createdAt || !createdAt.seconds) return '—';
  return new Date(Number(createdAt.seconds) * 1000).toTimeString().slice(0, 5);
}

// Terminal statuses cannot be edited or canceled (FR-4/FR-8).
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
  // transitions appear without a manual refresh (FR-5/FR-6).
  const liveUpdates = useOrderUpdates();
  const { mutate: cancelOrder } = useCancelOrder();
  const [editing, setEditing] = useState<Order | null>(null);

  const merged = orders.map((o) => liveUpdates[o.orderId] ?? o);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Orders</CardTitle>
      </CardHeader>
      <CardContent>
        <QueryStateMessages isLoading={isLoading} error={error} errorText="Failed to load orders" />
        {!isLoading && !error && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Symbol</TableHead>
                <TableHead>Side</TableHead>
                <TableHead className="hidden sm:table-cell">Type</TableHead>
                <TableHead className="text-right">Qty</TableHead>
                <TableHead className="text-right">Filled</TableHead>
                <TableHead className="text-right hidden md:table-cell">Avg Price</TableHead>
                <TableHead>Status</TableHead>
                {/* feature 083 — order origin (strategy-or-Manual) + Why? trace link. */}
                <TableHead className="hidden lg:table-cell">From signal</TableHead>
                <TableHead className="text-right hidden md:table-cell">Placed</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {merged.map((order) => {
                const typeName = OrderType[order.orderType] ?? 'UNKNOWN';
                const isTerminal = TERMINAL.has(order.status);
                return (
                  <TableRow key={order.orderId} data-testid={`order-row-${order.orderId}`}>
                    <OrderSymbolCell order={order} />
                    <OrderSideCell side={order.side} />
                    <TableCell className="hidden sm:table-cell text-muted-foreground">
                      {TYPE_LABEL[typeName] ?? typeName}
                    </TableCell>
                    <TableCell className="text-right">{order.qty}</TableCell>
                    <TableCell className="text-right text-muted-foreground">
                      {order.filledQty ?? 0}
                    </TableCell>
                    <TableCell className="text-right hidden md:table-cell">
                      {formatUsd(order.filledAvgPrice)}
                    </TableCell>
                    <OrderStatusCell status={order.status} intentState={order.intentState} />
                    <TableCell className="hidden lg:table-cell text-muted-foreground">
                      {order.strategyId ? (
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
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground hidden md:table-cell">
                      {placedLabel(order.createdAt)}
                    </TableCell>
                    <TableCell className="text-right whitespace-nowrap">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="mr-1"
                        disabled={isTerminal}
                        onClick={() => setEditing(order)}
                        data-testid={`edit-${order.orderId}`}
                      >
                        Edit
                      </Button>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={isTerminal}
                            data-testid={`cancel-${order.orderId}`}
                          >
                            Cancel
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogCancel data-testid={`cancel-${order.orderId}-dismiss`}>
                            Dismiss
                          </AlertDialogCancel>
                          <AlertDialogAction
                            onClick={() => cancelOrder({ orderId: order.orderId })}
                            data-testid={`cancel-${order.orderId}-confirm`}
                          >
                            Confirm
                          </AlertDialogAction>
                        </AlertDialogContent>
                      </AlertDialog>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
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
