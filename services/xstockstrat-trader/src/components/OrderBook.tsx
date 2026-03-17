'use client';
import useSWR from 'swr';

const fetcher = (url: string) => fetch(url).then((r) => r.json());

// ── OrderBook ──────────────────────────────────────────────────────────────
export function OrderBook() {
  const { data, error, isLoading } = useSWR('/api/orders', fetcher, { refreshInterval: 5000 });

  const statusColor: Record<string, string> = {
    ORDER_STATUS_NEW: 'text-blue-400',
    ORDER_STATUS_PARTIALLY_FILLED: 'text-yellow-400',
    ORDER_STATUS_FILLED: 'text-emerald-400',
    ORDER_STATUS_CANCELED: 'text-gray-500',
    ORDER_STATUS_REJECTED: 'text-red-400',
    ORDER_STATUS_PENDING_APPROVAL: 'text-orange-400',
  };

  return (
    <div className="rounded-xl bg-gray-900 border border-gray-800 p-5">
      <h2 className="text-base font-semibold mb-4 text-gray-200">Orders</h2>
      {isLoading && <p className="text-sm text-gray-500">Loading…</p>}
      {error && <p className="text-sm text-red-400">Failed to load orders</p>}
      {data?.orders && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-gray-500 border-b border-gray-800">
                <th className="pb-2 text-left">Symbol</th>
                <th className="pb-2 text-left">Side</th>
                <th className="pb-2 text-right">Qty</th>
                <th className="pb-2 text-right">Filled</th>
                <th className="pb-2 text-right">Avg Price</th>
                <th className="pb-2 text-left">Status</th>
              </tr>
            </thead>
            <tbody>
              {data.orders.map((order: any) => (
                <tr key={order.order_id} className="border-b border-gray-800/50 hover:bg-gray-800/30">
                  <td className="py-2 font-mono font-semibold">{order.symbol}</td>
                  <td className={`py-2 font-medium ${order.side === 'ORDER_SIDE_BUY' ? 'text-emerald-400' : 'text-red-400'}`}>
                    {order.side === 'ORDER_SIDE_BUY' ? 'BUY' : 'SELL'}
                  </td>
                  <td className="py-2 text-right">{order.qty}</td>
                  <td className="py-2 text-right text-gray-400">{order.filled_qty ?? 0}</td>
                  <td className="py-2 text-right">{order.filled_avg_price ? `$${Number(order.filled_avg_price).toFixed(2)}` : '—'}</td>
                  <td className={`py-2 ${statusColor[order.status] ?? 'text-gray-400'}`}>
                    {order.status?.replace('ORDER_STATUS_', '')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {data.orders.length === 0 && (
            <p className="text-sm text-gray-600 text-center py-6">No orders</p>
          )}
        </div>
      )}
    </div>
  );
}

// ── PortfolioSummary ───────────────────────────────────────────────────────
export function PortfolioSummary() {
  const { data, isLoading, error } = useSWR('/api/portfolio', fetcher, { refreshInterval: 10000 });

  if (isLoading) return (
    <div className="rounded-xl bg-gray-900 border border-gray-800 p-5">
      <p className="text-sm text-gray-500">Loading portfolio…</p>
    </div>
  );

  if (error || !data) return (
    <div className="rounded-xl bg-gray-900 border border-gray-800 p-5">
      <p className="text-sm text-red-400">Portfolio unavailable</p>
    </div>
  );

  const pnlColor = data.day_pnl >= 0 ? 'text-emerald-400' : 'text-red-400';

  return (
    <div className="rounded-xl bg-gray-900 border border-gray-800 p-5 space-y-4">
      <h2 className="text-base font-semibold text-gray-200">Portfolio</h2>

      <div className="space-y-2">
        <Stat label="Equity" value={`$${Number(data.equity).toLocaleString('en-US', { minimumFractionDigits: 2 })}`} />
        <Stat label="Cash" value={`$${Number(data.cash).toLocaleString('en-US', { minimumFractionDigits: 2 })}`} />
        <Stat label="Buying Power" value={`$${Number(data.buying_power).toLocaleString('en-US', { minimumFractionDigits: 2 })}`} />
        <Stat
          label="Day P&L"
          value={`${data.day_pnl >= 0 ? '+' : ''}$${Number(data.day_pnl).toFixed(2)} (${Number(data.day_pnl_pct * 100).toFixed(2)}%)`}
          valueClass={pnlColor}
        />
        <Stat label="Total P&L" value={`$${Number(data.total_pnl).toFixed(2)}`} />
      </div>

      {data.positions?.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Positions</h3>
          <div className="space-y-1.5">
            {data.positions.map((pos: any) => (
              <div key={pos.symbol} className="flex justify-between text-xs">
                <span className="font-mono font-semibold">{pos.symbol}</span>
                <span className={pos.unrealized_pnl >= 0 ? 'text-emerald-400' : 'text-red-400'}>
                  {pos.unrealized_pnl >= 0 ? '+' : ''}${Number(pos.unrealized_pnl).toFixed(2)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, valueClass = 'text-gray-200' }: { label: string; value: string; valueClass?: string }) {
  return (
    <div className="flex justify-between text-sm">
      <span className="text-gray-500">{label}</span>
      <span className={`font-medium tabular-nums ${valueClass}`}>{value}</span>
    </div>
  );
}
