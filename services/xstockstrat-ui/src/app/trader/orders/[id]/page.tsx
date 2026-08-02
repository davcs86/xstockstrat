'use client';
import { useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { ConnectError } from '@connectrpc/connect';
import { AppShell } from '@/components/trader/AppShell';
import { BackToDashboardButton } from '@/components/trader/BackToDashboardButton';
import { EditOrderDialog } from '@/components/trader/EditOrderDialog';
import { useOrder } from '@/hooks/useOrders';
import { useCancelOrder } from '@/hooks/useCancelOrder';
import { OrderType, OrderStatus } from '@xstockstrat/proto/trading/v1/trading_pb';
import { TradingMode } from '@xstockstrat/proto/common/v1/common_pb';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  TYPE_LABEL,
  formatUsd as formatPrice,
  OrderSideBadge,
  OrderStatusBadge,
} from '@/components/trader/orderShared';
import { fmtUsd } from '@/lib/money';

function formatQty(v: number | undefined | null): string {
  if (v === undefined || v === null) return '—';
  return String(v);
}

// A working order (NEW / PARTIALLY_FILLED) can still be replaced or canceled; a terminal one cannot.
function isWorking(status: OrderStatus): boolean {
  return status === OrderStatus.NEW || status === OrderStatus.PARTIALLY_FILLED;
}

export default function OrderDetailPage() {
  const params = useParams<{ id: string }>();
  const orderId = params?.id;
  const { data: order, error, isLoading } = useOrder(orderId);
  const { mutate: cancelOrder, isPending: canceling } = useCancelOrder();
  const [editOpen, setEditOpen] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [actionError, setActionError] = useState('');

  const working = order ? isWorking(order.status) : false;
  // Order preview figures — all derived from the order's own fields (no new data source).
  const refPrice = order ? Number(order.limitPrice || order.filledAvgPrice || 0) : 0;
  const notional = order ? Number(order.qty ?? 0) * refPrice : 0;
  const filledPct =
    order && Number(order.qty ?? 0) > 0
      ? (Number(order.filledQty ?? 0) / Number(order.qty)) * 100
      : 0;
  const remaining = order ? Number(order.qty ?? 0) - Number(order.filledQty ?? 0) : 0;

  const handleCancel = () => {
    if (!order) return;
    setActionError('');
    cancelOrder(
      { orderId: order.orderId },
      {
        onSuccess: () => setConfirmCancel(false),
        onError: (err) =>
          setActionError(err instanceof ConnectError ? err.rawMessage : (err as Error).message),
      },
    );
  };

  return (
    <AppShell>
      <div className="mx-auto max-w-4xl space-y-4 p-4 sm:p-6">
        <div className="flex items-center gap-3">
          <BackToDashboardButton />
        </div>

        {isLoading && <p className="text-sm text-muted-foreground">Loading order…</p>}
        {error && (
          <Card>
            <CardContent className="pt-6">
              <p className="text-sm text-destructive">
                Failed to load order: {(error as Error).message}
              </p>
            </CardContent>
          </Card>
        )}

        {order && (
          <>
            {/* Header — symbol, side, status, order id + working-order actions. */}
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border pb-4">
              <div className="min-w-0 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-2xl font-semibold tracking-tight">
                    {order.symbol}
                  </span>
                  <OrderSideBadge side={order.side} />
                  <OrderStatusBadge status={order.status} />
                </div>
                <p className="font-mono text-xs text-muted-foreground">{order.orderId}</p>
              </div>
              {working && (
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="min-h-[44px]"
                    onClick={() => setEditOpen(true)}
                  >
                    Edit order
                  </Button>
                  {confirmCancel ? (
                    <Button
                      variant="sell"
                      size="sm"
                      className="min-h-[44px]"
                      disabled={canceling}
                      onClick={handleCancel}
                    >
                      {canceling ? 'Canceling…' : 'Confirm cancel'}
                    </Button>
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      className="min-h-[44px] border-destructive/40 text-destructive"
                      onClick={() => setConfirmCancel(true)}
                    >
                      Cancel order
                    </Button>
                  )}
                </div>
              )}
            </div>

            {actionError && <p className="text-sm text-destructive">{actionError}</p>}

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_300px]">
              {/* Ticket field grid. */}
              <Card>
                <CardHeader>
                  <CardTitle>Order ticket</CardTitle>
                </CardHeader>
                <CardContent>
                  <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm sm:grid-cols-3">
                    <Field
                      label="Order type"
                      value={TYPE_LABEL[OrderType[order.orderType]] ?? '—'}
                    />
                    <Field label="Time in force" value={order.timeInForce || '—'} />
                    <Field
                      label="Mode"
                      value={order.tradingMode === TradingMode.LIVE ? 'LIVE' : 'PAPER'}
                    />
                    <Field label="Quantity" value={formatQty(order.qty)} />
                    <Field label="Filled" value={formatQty(order.filledQty)} />
                    <Field label="Avg fill price" value={formatPrice(order.filledAvgPrice)} />
                    <Field label="Limit price" value={formatPrice(order.limitPrice)} />
                    <Field label="Stop price" value={formatPrice(order.stopPrice)} />
                    <Field label="Account" value={order.accountId || '—'} mono />
                    <Field label="Strategy" value={order.strategyId || 'Manual'} mono />
                    <Field label="Broker order id" value={order.brokerOrderId || '—'} mono />
                  </dl>
                </CardContent>
              </Card>

              {/* Order-preview sidebar — derived from the order's own fields. */}
              <div className="space-y-4">
                <Card>
                  <CardHeader>
                    <CardTitle className="font-mono text-[9px] font-semibold uppercase tracking-[0.13em] text-muted-foreground">
                      Order preview
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-1.5 text-sm">
                    <PreviewRow label="Notional" value={notional > 0 ? fmtUsd(notional) : '—'} />
                    <PreviewRow label="Filled" value={`${filledPct.toFixed(0)}%`} />
                    <PreviewRow label="Remaining qty" value={formatQty(remaining)} />
                    <PreviewRow label="Origin" value={order.strategyId || 'Manual'} mono />
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-5">
                    <p className="text-sm leading-relaxed text-muted-foreground">
                      {working
                        ? 'This order is still working — edit its qty, price or TIF, or cancel it. The broker holds the order; the queue clears its flag on fill.'
                        : 'This order has reached a terminal state and can no longer be modified.'}
                    </p>
                    <Button asChild variant="ghost" size="sm" className="mt-2 px-0">
                      <Link href={`/trader/positions/${encodeURIComponent(order.symbol)}`}>
                        View {order.symbol} position →
                      </Link>
                    </Button>
                  </CardContent>
                </Card>
              </div>
            </div>

            <EditOrderDialog order={order} open={editOpen} onOpenChange={setEditOpen} />
          </>
        )}
      </div>
    </AppShell>
  );
}

function Field({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={`mt-0.5 tabular-nums ${mono ? 'font-mono text-xs' : ''}`}>{value}</dd>
    </div>
  );
}

function PreviewRow({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className={`tabular-nums ${mono ? 'font-mono text-xs' : 'font-mono'}`}>{value}</span>
    </div>
  );
}
