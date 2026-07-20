'use client';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import type { TradingMode } from '@/app/trader/page';
import { useAccountContext } from '@/context/AccountContext';
import { usePlaceOrder } from '@/hooks/usePlaceOrder';
import { OrderSide as PbOrderSide, OrderType as PbOrderType, OrderStatus } from '@xstockstrat/proto/trading/v1/trading_pb';
import { TradingMode as PbTradingMode } from '@xstockstrat/proto/common/v1/common_pb';
import { ConnectError } from '@connectrpc/connect';
// BASE_PATH no longer needed — calls go through the typed Connect client.
import { Card, CardHeader, CardTitle, CardContent } from '../ui/card';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';

type OrderSide = 'buy' | 'sell';
type OrderType = 'market' | 'limit' | 'stop' | 'stop_limit' | 'trailing_stop';

const ORDER_TYPE_LABEL: Record<OrderType, string> = {
  market: 'Market',
  limit: 'Limit',
  stop: 'Stop',
  stop_limit: 'Stop Limit',
  trailing_stop: 'Trailing Stop',
};

const ORDER_TYPE_ENUM: Record<OrderType, PbOrderType> = {
  market: PbOrderType.MARKET,
  limit: PbOrderType.LIMIT,
  stop: PbOrderType.STOP,
  stop_limit: PbOrderType.STOP_LIMIT,
  trailing_stop: PbOrderType.TRAILING_STOP,
};

interface OrderFormProps {
  mode: TradingMode;
}

export function OrderForm({ mode }: OrderFormProps) {
  const { selectedAccountId } = useAccountContext();
  // Quick-trade deep link: the positions table links here as /trader?symbol=SYM so the
  // ticket opens pre-filled. Seed the initial value from the param, then keep it in sync
  // if the param changes (without clobbering what the user types once it's empty).
  const searchParams = useSearchParams();
  const prefillSymbol = (searchParams.get('symbol') ?? '').toUpperCase();
  const [symbol, setSymbol] = useState(prefillSymbol);
  useEffect(() => {
    if (prefillSymbol) setSymbol(prefillSymbol);
  }, [prefillSymbol]);
  const [side, setSide] = useState<OrderSide>('buy');
  const [orderType, setOrderType] = useState<OrderType>('market');
  const [qty, setQty] = useState('');
  const [limitPrice, setLimitPrice] = useState('');
  const [stopPrice, setStopPrice] = useState('');
  const [message, setMessage] = useState('');
  const [isErrorMsg, setIsErrorMsg] = useState(false);
  const { mutate: placeOrder, isPending } = usePlaceOrder();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setMessage('');
    placeOrder(
      {
        symbol: symbol.toUpperCase(),
        side: side === 'buy' ? PbOrderSide.BUY : PbOrderSide.SELL,
        orderType: ORDER_TYPE_ENUM[orderType],
        qty: parseFloat(qty),
        limitPrice: limitPrice ? parseFloat(limitPrice) : 0,
        stopPrice: stopPrice ? parseFloat(stopPrice) : 0,
        tradingMode: mode === 'live' ? PbTradingMode.LIVE : PbTradingMode.PAPER,
        accountId: selectedAccountId ?? '',
      },
      {
        onSuccess: (order) => {
          setIsErrorMsg(false);
          setMessage(`Order placed: ${order.orderId} (${OrderStatus[order.status] ?? 'UNKNOWN'})`);
          setSymbol(''); setQty(''); setLimitPrice(''); setStopPrice('');
        },
        onError: (err) => {
          setIsErrorMsg(true);
          setMessage(err instanceof ConnectError ? (err as ConnectError).rawMessage : (err as Error).message);
        },
      },
    );
  };

  const needsLimitPrice = orderType === 'limit' || orderType === 'stop_limit';
  const needsStopPrice = orderType === 'stop' || orderType === 'stop_limit' || orderType === 'trailing_stop';

  return (
    <Card>
      <CardHeader>
        <CardTitle>Place Order</CardTitle>
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
              <SelectValue placeholder="Order type">{ORDER_TYPE_LABEL[orderType]}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="market">Market</SelectItem>
              <SelectItem value="limit">Limit</SelectItem>
              <SelectItem value="stop">Stop</SelectItem>
              <SelectItem value="stop_limit">Stop Limit</SelectItem>
              <SelectItem value="trailing_stop">Trailing Stop</SelectItem>
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

          {needsStopPrice && (
            <Input
              type="number"
              min="0"
              step="any"
              placeholder={orderType === 'trailing_stop' ? 'Trail amount' : 'Stop price'}
              value={stopPrice}
              onChange={(e) => setStopPrice(e.target.value)}
              required={needsStopPrice}
            />
          )}

          <Button
            type="submit"
            variant={side === 'buy' ? 'buy' : 'sell'}
            disabled={isPending || !selectedAccountId}
            className="w-full"
          >
            {isPending ? 'Placing…' : `${side.toUpperCase()} ${symbol || '—'}`}
          </Button>

          {message && (
            <p className={`text-xs ${isErrorMsg ? 'text-destructive' : 'text-buy'}`}>
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
