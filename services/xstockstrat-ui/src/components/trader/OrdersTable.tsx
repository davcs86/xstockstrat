'use client';
import { useState } from 'react';
import type { Order } from '@xstockstrat/proto/trading/v1/trading_pb';
import { OrderStatus, OrderType } from '@xstockstrat/proto/trading/v1/trading_pb';
import { useOrderUpdates } from '@/hooks/useOrderUpdates';
import { useCancelOrder } from '@/hooks/useCancelOrder';
import { Card, CardHeader, CardTitle, CardContent } from '../ui/card';
import { Button } from '../ui/button';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '../ui/table';
import { EditOrderDialog } from './EditOrderDialog';
import { QueryStateMessages } from '../shared/QueryStateMessages';
import {
  TYPE_LABEL,
  formatUsd,
  OrderSymbolCell,
  OrderSideCell,
  OrderStatusCell,
} from './orderShared';

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
  const [pendingCancel, setPendingCancel] = useState<string | null>(null);

  const merged = orders.map((o) => liveUpdates[o.orderId] ?? o);

  const handleCancel = (orderId: string) => {
    // Two-step confirmation (FR-5): first click arms, second click confirms.
    if (pendingCancel !== orderId) {
      setPendingCancel(orderId);
      return;
    }
    cancelOrder({ orderId });
    setPendingCancel(null);
  };

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
                    <OrderStatusCell status={order.status} />
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
                      <Button
                        type="button"
                        variant={pendingCancel === order.orderId ? 'destructive' : 'outline'}
                        size="sm"
                        disabled={isTerminal}
                        onClick={() => handleCancel(order.orderId)}
                        data-testid={`cancel-${order.orderId}`}
                      >
                        {pendingCancel === order.orderId ? 'Confirm' : 'Cancel'}
                      </Button>
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
