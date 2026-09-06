'use client';
import { useState } from 'react';
import type { Order } from '@xstockstrat/proto/trading/v1/trading_pb';
import { OrderStatus } from '@xstockstrat/proto/trading/v1/trading_pb';
import { ConnectError } from '@connectrpc/connect';
import { useReplaceOrder } from '@/hooks/useReplaceOrder';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '../ui/sheet';
import { Input } from '../ui/input';
import { Button } from '../ui/button';
import { Alert, AlertDescription } from '../ui/alert';

interface EditOrderDialogProps {
  order: Order | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

// Edits a working order's qty / limit price / stop price / TIF via ReplaceOrder. Broker-agnostic —
// the service routes by broker_type, so no Alpaca/IBKR branch here. A zero/empty field means "leave unchanged".
export function EditOrderDialog({ order, open, onOpenChange }: EditOrderDialogProps) {
  const { mutate: replaceOrder, isPending } = useReplaceOrder();
  const [qty, setQty] = useState('');
  const [limitPrice, setLimitPrice] = useState('');
  const [stopPrice, setStopPrice] = useState('');
  const [timeInForce, setTimeInForce] = useState('');
  const [error, setError] = useState('');

  if (!order) return null;

  const isPartial = order.status === OrderStatus.PARTIALLY_FILLED;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    replaceOrder(
      {
        orderId: order.orderId,
        qty: qty ? parseFloat(qty) : 0,
        limitPrice: limitPrice ? parseFloat(limitPrice) : 0,
        stopPrice: stopPrice ? parseFloat(stopPrice) : 0,
        timeInForce: timeInForce.trim(),
      },
      {
        onSuccess: () => {
          setQty('');
          setLimitPrice('');
          setStopPrice('');
          setTimeInForce('');
          onOpenChange(false);
        },
        onError: (err) => {
          setError(
            err instanceof ConnectError ? (err as ConnectError).rawMessage : (err as Error).message,
          );
        },
      },
    );
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Edit order {order.symbol}</SheetTitle>
        </SheetHeader>
        <form onSubmit={handleSubmit} className="space-y-3 mt-4">
          <p className="text-xs text-muted-foreground">
            Leave a field blank to keep its current value.
            {isPartial &&
              ' This order is partially filled — the quantity adjusts the remaining amount.'}
          </p>
          <label className="block text-xs font-medium text-muted-foreground">
            Quantity {`(current: ${order.qty})`}
            <Input
              type="number"
              min="0"
              step="any"
              placeholder="New quantity"
              value={qty}
              onChange={(e) => setQty(e.target.value)}
            />
          </label>
          <label className="block text-xs font-medium text-muted-foreground">
            Limit price {order.limitPrice ? `(current: ${order.limitPrice})` : ''}
            <Input
              type="number"
              min="0"
              step="any"
              placeholder="New limit price"
              value={limitPrice}
              onChange={(e) => setLimitPrice(e.target.value)}
            />
          </label>
          <label className="block text-xs font-medium text-muted-foreground">
            Stop price {order.stopPrice ? `(current: ${order.stopPrice})` : ''}
            <Input
              type="number"
              min="0"
              step="any"
              placeholder="New stop price"
              value={stopPrice}
              onChange={(e) => setStopPrice(e.target.value)}
            />
          </label>
          <label className="block text-xs font-medium text-muted-foreground">
            Time in force {order.timeInForce ? `(current: ${order.timeInForce})` : ''}
            <Input
              placeholder="e.g. day, gtc"
              value={timeInForce}
              onChange={(e) => setTimeInForce(e.target.value)}
            />
          </label>
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <div className="flex gap-2 justify-end pt-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending ? 'Saving…' : 'Save changes'}
            </Button>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  );
}
