'use client';
import useSWR from 'swr';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export default function InsightsDashboard() {
  const { data: strategies } = useSWR('/api/analysis/strategies', fetcher, { refreshInterval: 30000 });

  return (
    <main className="min-h-screen bg-gray-950 text-gray-100 p-6">
      <header className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">xstockstrat Insights</h1>
        <p className="text-sm text-gray-500 mt-1">Strategy analytics and backtesting</p>
      </header>

      <div className="grid grid-cols-12 gap-4">
        {/* Strategy scores */}
        <div className="col-span-4 rounded-xl bg-gray-900 border border-gray-800 p-5">
          <h2 className="text-base font-semibold mb-4">Strategy Scores</h2>
          {!strategies ? (
            <p className="text-sm text-gray-500">Loading…</p>
          ) : (
            <ul className="space-y-2">
              {(strategies?.strategies ?? []).map((s: any) => (
                <li key={s.strategy_id} className="flex items-center justify-between text-sm">
                  <span className="font-mono text-xs text-gray-400">{s.strategy_id.slice(0, 8)}</span>
                  <span className={`font-bold ${scoreColor(s.overall_score)}`}>
                    {s.rating} ({(s.overall_score * 100).toFixed(0)})
                  </span>
                </li>
              ))}
              {(strategies?.strategies ?? []).length === 0 && (
                <p className="text-sm text-gray-600">No strategies yet</p>
              )}
            </ul>
          )}
        </div>

        {/* Placeholder chart area */}
        <div className="col-span-8 rounded-xl bg-gray-900 border border-gray-800 p-5">
          <h2 className="text-base font-semibold mb-4">Equity Curve</h2>
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={equityCurvePlaceholder}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
              <XAxis dataKey="day" tick={{ fill: '#6b7280', fontSize: 11 }} />
              <YAxis tick={{ fill: '#6b7280', fontSize: 11 }} />
              <Tooltip
                contentStyle={{ backgroundColor: '#111827', border: '1px solid #374151', borderRadius: 8 }}
                labelStyle={{ color: '#9ca3af' }}
              />
              <Line type="monotone" dataKey="equity" stroke="#10b981" dot={false} strokeWidth={2} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    </main>
  );
}

function scoreColor(score: number): string {
  if (score >= 0.8) return 'text-emerald-400';
  if (score >= 0.6) return 'text-yellow-400';
  return 'text-red-400';
}

// Placeholder data — replace with real backtest results from /api/analysis
const equityCurvePlaceholder = Array.from({ length: 30 }, (_, i) => ({
  day: `D${i + 1}`,
  equity: 10000 + Math.sin(i / 3) * 300 + i * 40,
}));
