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
import { TradingMode as PbTradingMode, BrokerType } from '@xstockstrat/proto/common/v1/common_pb';
import { ConnectError } from '@connectrpc/connect';
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
  // Caller-supplied symbol; takes precedence over the ?symbol deep link and pins the field.
  initialSymbol?: string;
  // Explicit prop (not derived from initialSymbol — a /trader mount also passes that): when true,
  // an OFFLINE account swaps the broker ticket for a minimal "Record order" control.
  allowOfflineRecord?: boolean;
  // Finite in-[0,1] confidence → qty may be left blank (coerced to 0) and sent as
  // PlaceOrder.confidence for auto-sizing; absent → qty stays required, no confidence sent.
  signalConfidence?: number;
}

export function OrderForm({
  mode,
  initialSymbol,
  allowOfflineRecord = true,
  signalConfidence,
}: OrderFormProps) {
  // Finite in-[0,1] gate; only a real value enables the blank-qty auto-size affordance.
  const hasSignalConfidence =
    typeof signalConfidence === 'number' &&
    Number.isFinite(signalConfidence) &&
    signalConfidence >= 0 &&
    signalConfidence <= 1;
  const { selectedAccountId, accounts } = useAccountContext();
  // Portfolio contract carries no offline marker — detect offline by broker type.
  const selectedAccount = accounts.find((a) => a.id === selectedAccountId);
  const isRecordMode = allowOfflineRecord && selectedAccount?.brokerType === BrokerType.OFFLINE;
  // An explicit initialSymbol takes precedence over the ?symbol deep link.
  const searchParams = useSearchParams();
  const prefillSymbol = (initialSymbol || searchParams.get('symbol') || '').toUpperCase();
  const [symbol, setSymbol] = useState(prefillSymbol);
  useEffect(() => {
    if (prefillSymbol) setSymbol(prefillSymbol);
  }, [prefillSymbol]);
  // initialSymbol pins the field (signal-detail mount); the ?symbol quick-trade prefill stays editable.
  const symbolLocked = Boolean(initialSymbol);
  const [side, setSide] = useState<OrderSide>('buy');
  const [orderType, setOrderType] = useState<OrderType>('market');
  const [qty, setQty] = useState('');
  const [limitPrice, setLimitPrice] = useState('');
  const [stopPrice, setStopPrice] = useState('');
  // Optional offline "Record order" fill price — mapped to limitPrice on submit (no broker).
  const [fillPrice, setFillPrice] = useState('');
  const [message, setMessage] = useState('');
  const [isErrorMsg, setIsErrorMsg] = useState(false);
  // Idempotency nonce: rotated only after a successful placement, so a resubmit after an
  // error keeps the same nonce and the server dedups it as one logical action.
  const [clientOrderId, setClientOrderId] = useState(() => crypto.randomUUID());
  const { mutate: placeOrder, isPending } = usePlaceOrder();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setMessage('');
    placeOrder(
      {
        symbol: symbol.toUpperCase(),
        side: side === 'buy' ? PbOrderSide.BUY : PbOrderSide.SELL,
        // The explicit offline accountId makes the backend record a NEW offline order (no broker submit).
        orderType: isRecordMode ? PbOrderType.MARKET : ORDER_TYPE_ENUM[orderType],
        // Blank/NaN qty must coerce to real 0, never NaN: Go's `NaN <= 0` is false, which would
        // bypass 023's qty<=0 auto-sizing and reach the broker.
        qty: (() => {
          const parsed = parseFloat(qty);
          return hasSignalConfidence && !(parsed > 0) ? 0 : parsed;
        })(),
        // undefined is omitted by the typed client → unset → backend default 1.0.
        confidence: hasSignalConfidence ? signalConfidence : undefined,
        limitPrice: isRecordMode
          ? fillPrice
            ? parseFloat(fillPrice)
            : 0
          : limitPrice
            ? parseFloat(limitPrice)
            : 0,
        stopPrice: isRecordMode ? 0 : stopPrice ? parseFloat(stopPrice) : 0,
        tradingMode: mode === 'live' ? PbTradingMode.LIVE : PbTradingMode.PAPER,
        accountId: selectedAccountId ?? '',
        clientOrderId,
      },
      {
        onSuccess: (order) => {
          setIsErrorMsg(false);
          // stopPrice shown only when non-zero — plain buy/sell sends stop_price=0 (would be noise).
          const stopInfo = order.stopPrice > 0 ? `, stop ${order.stopPrice}` : '';
          setMessage(
            isRecordMode
              ? `Order recorded: ${order.orderId} (${OrderStatus[order.status] ?? 'UNKNOWN'}) — qty ${order.qty}`
              : `Order placed: ${order.orderId} (${OrderStatus[order.status] ?? 'UNKNOWN'}) — qty ${order.qty}${stopInfo}`,
          );
          setSymbol(symbolLocked ? prefillSymbol : '');
          setQty('');
          setLimitPrice('');
          setStopPrice('');
          setFillPrice('');
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
        <CardTitle>{isRecordMode ? 'Record Offline Order' : 'Place Order'}</CardTitle>
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

          {/* Hidden in record mode so a broker-only type (e.g. Trailing Stop) can't be sent offline. */}
          {!isRecordMode && (
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
          )}

          <Input
            type="number"
            min="0.0001"
            step="any"
            placeholder="Quantity"
            value={qty}
            onChange={(e) => setQty(e.target.value)}
            // Optional only when a signal confidence enables blank-qty auto-sizing.
            required={!hasSignalConfidence}
          />
          {hasSignalConfidence && (
            <p className="text-xs text-muted-foreground" data-testid="signal-confidence-hint">
              Leave quantity blank to auto-size at {Math.round((signalConfidence ?? 0) * 100)}%
              confidence.
            </p>
          )}

          {isRecordMode && (
            <Input
              type="number"
              min="0"
              step="any"
              placeholder="Fill price (optional)"
              value={fillPrice}
              onChange={(e) => setFillPrice(e.target.value)}
            />
          )}

          {!isRecordMode && needsLimitPrice && (
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

          {!isRecordMode && needsStopPrice && (
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
            {isRecordMode
              ? isPending
                ? 'Recording…'
                : `Record ${side.toUpperCase()} ${symbol || '—'}`
              : isPending
                ? 'Placing…'
                : `${side.toUpperCase()} ${symbol || '—'}`}
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
