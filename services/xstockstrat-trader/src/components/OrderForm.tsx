'use client';
import { useState } from 'react';

type OrderSide = 'buy' | 'sell';
type OrderType = 'market' | 'limit' | 'stop' | 'stop_limit';

export function OrderForm() {
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
    <div className="rounded-xl bg-gray-900 border border-gray-800 p-5">
      <h2 className="text-base font-semibold mb-4 text-gray-200">Place Order</h2>
      <form onSubmit={handleSubmit} className="space-y-3">
        {/* Symbol */}
        <input
          className="w-full bg-gray-800 rounded px-3 py-2 text-sm uppercase placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          placeholder="Symbol (e.g. AAPL)"
          value={symbol}
          onChange={(e) => setSymbol(e.target.value)}
          required
        />

        {/* Side */}
        <div className="flex gap-2">
          {(['buy', 'sell'] as OrderSide[]).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setSide(s)}
              className={`flex-1 py-2 rounded text-sm font-medium transition-colors ${
                side === s
                  ? s === 'buy' ? 'bg-emerald-600 text-white' : 'bg-red-600 text-white'
                  : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
              }`}
            >
              {s.toUpperCase()}
            </button>
          ))}
        </div>

        {/* Order type */}
        <select
          className="w-full bg-gray-800 rounded px-3 py-2 text-sm text-gray-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
          value={orderType}
          onChange={(e) => setOrderType(e.target.value as OrderType)}
        >
          <option value="market">Market</option>
          <option value="limit">Limit</option>
          <option value="stop">Stop</option>
          <option value="stop_limit">Stop Limit</option>
        </select>

        {/* Qty */}
        <input
          type="number"
          min="0.0001"
          step="any"
          className="w-full bg-gray-800 rounded px-3 py-2 text-sm placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          placeholder="Quantity"
          value={qty}
          onChange={(e) => setQty(e.target.value)}
          required
        />

        {/* Limit price */}
        {needsLimitPrice && (
          <input
            type="number"
            min="0"
            step="any"
            className="w-full bg-gray-800 rounded px-3 py-2 text-sm placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            placeholder="Limit price"
            value={limitPrice}
            onChange={(e) => setLimitPrice(e.target.value)}
            required={needsLimitPrice}
          />
        )}

        <button
          type="submit"
          disabled={status === 'submitting'}
          className={`w-full py-2.5 rounded font-semibold text-sm transition-colors ${
            side === 'buy'
              ? 'bg-emerald-600 hover:bg-emerald-500 disabled:bg-emerald-900'
              : 'bg-red-600 hover:bg-red-500 disabled:bg-red-900'
          } text-white`}
        >
          {status === 'submitting' ? 'Placing…' : `${side.toUpperCase()} ${symbol || '—'}`}
        </button>

        {message && (
          <p className={`text-xs mt-1 ${status === 'error' ? 'text-red-400' : 'text-emerald-400'}`}>
            {message}
          </p>
        )}
      </form>
    </div>
  );
}
