'use client';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import type { TradingMode } from '@/app/trader/page';
import { useAccountContext } from '@/context/AccountContext';
import { usePlaceOrder } from '@/hooks/usePlaceOrder';
import {
  OrderSide as PbOrderSide,
  OrderType as PbOrderType,
  OrderStatus,
} from '@xstockstrat/proto/trading/v1/trading_pb';
import { TradingMode as PbTradingMode } from '@xstockstrat/proto/common/v1/common_pb';
import { ConnectError } from '@connectrpc/connect';
// BASE_PATH no longer needed — calls go through the typed Connect client.
import { Card, CardHeader, CardTitle, CardContent } from '../ui/card';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { ToggleGroup, ToggleGroupItem } from '../ui/toggle-group';
import { Alert, AlertDescription } from '../ui/alert';

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
  // Optional caller-supplied symbol (feature 083 FR-6 — the Signal-detail order ticket is
  // pinned to the signal's symbol, which arrives as a route param, not the ?symbol deep link).
  initialSymbol?: string;
}

export function OrderForm({ mode, initialSymbol }: OrderFormProps) {
  const { selectedAccountId } = useAccountContext();
  // Quick-trade deep link: the positions table links here as /trader?symbol=SYM so the
  // ticket opens pre-filled. An explicit initialSymbol (Signal detail) takes precedence over
  // the ?symbol param. Seed the initial value, then keep it in sync if it changes (without
  // clobbering what the user types once it's empty).
  const searchParams = useSearchParams();
  const prefillSymbol = (initialSymbol || searchParams.get('symbol') || '').toUpperCase();
  const [symbol, setSymbol] = useState(prefillSymbol);
  useEffect(() => {
    if (prefillSymbol) setSymbol(prefillSymbol);
  }, [prefillSymbol]);
  // An explicit initialSymbol (Signal-detail's SignalOrderTicket) pins this ticket to one
  // symbol — the chart, conviction, and edge stats above it are all keyed to it, so letting the
  // field be edited away from it would desync the order from the analysis it was placed from.
  // The generic ?symbol= quick-trade deep link (/trader) stays editable — it's a convenience
  // prefill, not a pinned context.
  const symbolLocked = Boolean(initialSymbol);
  const [side, setSide] = useState<OrderSide>('buy');
  const [orderType, setOrderType] = useState<OrderType>('market');
  const [qty, setQty] = useState('');
  const [limitPrice, setLimitPrice] = useState('');
  const [stopPrice, setStopPrice] = useState('');
  const [message, setMessage] = useState('');
  const [isErrorMsg, setIsErrorMsg] = useState(false);
  // Client-side idempotency nonce (feature 101, FR-1/FR-2): a stable ID per logical
  // place-order action, generated once when the form opens and reused across retries of
  // that same action (a network retry, a double-click, or the operator clicking "Place
  // Order" again after seeing an error) so the server can dedup. Rotated only after a
  // successful placement — a failed attempt must keep the same nonce so a resubmit is
  // recognized as the same logical action, not a new one.
  const [clientOrderId, setClientOrderId] = useState(() => crypto.randomUUID());
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
        clientOrderId,
      },
      {
        onSuccess: (order) => {
          setIsErrorMsg(false);
          // Consumer surface requirement (C-14, feature 023): show the computed
          // quantity/stop price whenever the server auto-sized the order (qty<=0
          // submitted). stopPrice is shown only when non-zero — an ordinary override-mode
          // buy/sell always sends stop_price=0, and printing "stop: 0" on every plain
          // market/limit order would be noise.
          const stopInfo = order.stopPrice > 0 ? `, stop ${order.stopPrice}` : '';
          setMessage(
            `Order placed: ${order.orderId} (${OrderStatus[order.status] ?? 'UNKNOWN'}) — qty ${order.qty}${stopInfo}`,
          );
          setSymbol(symbolLocked ? prefillSymbol : '');
          setQty('');
          setLimitPrice('');
          setStopPrice('');
          setClientOrderId(crypto.randomUUID());
        },
        onError: (err) => {
          setIsErrorMsg(true);
          setMessage(
            err instanceof ConnectError ? (err as ConnectError).rawMessage : (err as Error).message,
          );
        },
      },
    );
  };

  const needsLimitPrice = orderType === 'limit' || orderType === 'stop_limit';
  const needsStopPrice =
    orderType === 'stop' || orderType === 'stop_limit' || orderType === 'trailing_stop';

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
            disabled={symbolLocked}
            title={symbolLocked ? 'Symbol is locked to this signal' : undefined}
          />

          {/* Buy / Sell toggle */}
          <ToggleGroup
            type="single"
            variant="outline"
            value={side}
            onValueChange={(v) => v && setSide(v as OrderSide)}
            className="grid grid-cols-2 gap-2"
          >
            <ToggleGroupItem value="buy" variant="buy">
              BUY
            </ToggleGroupItem>
            <ToggleGroupItem value="sell" variant="sell">
              SELL
            </ToggleGroupItem>
          </ToggleGroup>

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
            <Alert variant={isErrorMsg ? 'destructive' : 'default'}>
              <AlertDescription className={isErrorMsg ? undefined : 'text-buy'}>
                {message}
              </AlertDescription>
            </Alert>
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
