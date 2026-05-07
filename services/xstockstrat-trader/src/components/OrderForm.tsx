'use client';
import { useState } from 'react';
import type { TradingMode } from '@/app/page';
import { useAccountContext } from '@/context/AccountContext';
import { Card, CardHeader, CardTitle, CardContent } from './ui/card';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Badge } from './ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';

type OrderSide = 'buy' | 'sell';
type OrderType = 'market' | 'limit' | 'stop' | 'stop_limit';

interface OrderFormProps {
  mode: TradingMode;
}

export function OrderForm({ mode }: OrderFormProps) {
  const { selectedAccountId } = useAccountContext();
  const [symbol, setSymbol] = useState('');
  const [side, setSide] = useState<OrderSide>('buy');
  const [orderType, setOrderType] = useState<OrderType>('market');
  const [qty, setQty] = useState('');
  const [limitPrice, setLimitPrice] = useState('');
  const [status, setStatus] = useState<'idle' | 'submitting' | 'success' | 'error'>('idle');
  const [message, setMessage] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus('submitting');
    setMessage('');

    try {
      const res = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbol: symbol.toUpperCase(),
          side,
          order_type: orderType,
          qty: parseFloat(qty),
          limit_price: limitPrice ? parseFloat(limitPrice) : undefined,
          trading_mode: mode,
          account_id: selectedAccountId ?? '',
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Order failed');
      setStatus('success');
      setMessage(`Order placed: ${data.order_id} (${data.status})`);
      setSymbol(''); setQty(''); setLimitPrice('');
    } catch (err: any) {
      setStatus('error');
      setMessage(err.message);
    }
  };

  const needsLimitPrice = orderType === 'limit' || orderType === 'stop_limit';

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Place Order</CardTitle>
          <Badge variant={mode === 'paper' ? 'paper' : 'live'}>
            {mode === 'paper' ? 'PAPER' : 'LIVE'}
          </Badge>
        </div>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-3">
          <Input
            className="uppercase"
            placeholder="Symbol (e.g. AAPL)"
            value={symbol}
            onChange={(e) => setSymbol(e.target.value)}
            required
          />

          {/* Buy / Sell toggle */}
          <div className="grid grid-cols-2 gap-2">
            {(['buy', 'sell'] as OrderSide[]).map((s) => (
              <Button
                key={s}
                type="button"
                variant={side === s ? (s === 'buy' ? 'buy' : 'sell') : 'outline'}
                onClick={() => setSide(s)}
                className="w-full"
              >
                {s.toUpperCase()}
              </Button>
            ))}
          </div>

          <Select value={orderType} onValueChange={(v) => setOrderType(v as OrderType)}>
            <SelectTrigger>
              <SelectValue placeholder="Order type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="market">Market</SelectItem>
              <SelectItem value="limit">Limit</SelectItem>
              <SelectItem value="stop">Stop</SelectItem>
              <SelectItem value="stop_limit">Stop Limit</SelectItem>
            </SelectContent>
          </Select>

          <Input
            type="number"
            min="0.0001"
            step="any"
            placeholder="Quantity"
            value={qty}
            onChange={(e) => setQty(e.target.value)}
            required
          />

          {needsLimitPrice && (
            <Input
              type="number"
              min="0"
              step="any"
              placeholder="Limit price"
              value={limitPrice}
              onChange={(e) => setLimitPrice(e.target.value)}
              required={needsLimitPrice}
            />
          )}

          <Button
            type="submit"
            variant={side === 'buy' ? 'buy' : 'sell'}
            disabled={status === 'submitting' || !selectedAccountId}
            className="w-full"
          >
            {status === 'submitting' ? 'Placing…' : `${side.toUpperCase()} ${symbol || '—'}`}
          </Button>

          {message && (
            <p className={`text-xs ${status === 'error' ? 'text-destructive' : 'text-buy'}`}>
              {message}
            </p>
          )}
          {!selectedAccountId && (
            <p className="text-xs text-muted-foreground">
              Select an account above to place an order.
            </p>
          )}
        </form>
      </CardContent>
    </Card>
  );
}
