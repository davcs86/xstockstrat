'use client';
import { useState } from 'react';
import type { Order } from '@xstockstrat/proto/trading/v1/trading_pb';
import { ConnectError } from '@connectrpc/connect';
import { timestampFromDate } from '@bufbuild/protobuf/wkt';
import { useConfirmOrder } from '@/hooks/useConfirmOrder';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '../ui/sheet';
import { Input } from '../ui/input';
import { Button } from '../ui/button';
import { Alert, AlertDescription } from '../ui/alert';

interface ConfirmFillDialogProps {
  order: Order | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

// Records the fill a broker would otherwise report onto an OFFLINE order (filled qty, avg price, time).
// Status is derived server-side from filled_qty vs qty; broker accounts are rejected with FailedPrecondition.
export function ConfirmFillDialog({ order, open, onOpenChange }: ConfirmFillDialogProps) {
  const { mutate: confirmOrder, isPending } = useConfirmOrder();
  const [filledQty, setFilledQty] = useState('');
  const [filledAvgPrice, setFilledAvgPrice] = useState('');
  const [filledAt, setFilledAt] = useState(''); // datetime-local; blank → server defaults to now
  const [error, setError] = useState('');

  if (!order) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    const parsedAt = filledAt ? new Date(filledAt) : null;
    confirmOrder(
      {
        orderId: order.orderId,
        filledQty: filledQty ? parseFloat(filledQty) : 0,
        filledAvgPrice: filledAvgPrice ? parseFloat(filledAvgPrice) : 0,
        filledAt: parsedAt ? timestampFromDate(parsedAt) : undefined,
      },
      {
        onSuccess: () => {
          setFilledQty('');
          setFilledAvgPrice('');
          setFilledAt('');
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
          <SheetTitle>Confirm fill — {order.symbol}</SheetTitle>
        </SheetHeader>
        <form onSubmit={handleSubmit} className="space-y-3 mt-4">
          <p className="text-xs text-muted-foreground">
            Record the fill for this offline order. Status is set automatically from the filled
            quantity vs the order quantity ({order.qty}). Positions and P&L update on save.
          </p>
          <label className="block text-xs font-medium text-muted-foreground">
            Filled quantity {`(order qty: ${order.qty})`}
            <Input
              type="number"
              min="0"
              step="any"
              placeholder="Filled quantity"
              value={filledQty}
              onChange={(e) => setFilledQty(e.target.value)}
              required
            />
          </label>
          <label className="block text-xs font-medium text-muted-foreground">
            Average fill price
            <Input
              type="number"
              min="0"
              step="any"
              placeholder="Average fill price"
              value={filledAvgPrice}
              onChange={(e) => setFilledAvgPrice(e.target.value)}
              required
            />
          </label>
          <label className="block text-xs font-medium text-muted-foreground">
            Fill time (optional — defaults to now)
            <Input
              type="datetime-local"
              value={filledAt}
              onChange={(e) => setFilledAt(e.target.value)}
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
              {isPending ? 'Saving…' : 'Confirm fill'}
            </Button>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  );
}
