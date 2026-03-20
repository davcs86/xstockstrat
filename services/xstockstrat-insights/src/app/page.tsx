'use client';
import useSWR from 'swr';
import Link from 'next/link';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export default function InsightsDashboard() {
  const { data: strategies } = useSWR('/api/analysis/strategies', fetcher, {
    refreshInterval: 30000,
  });

  // Build an equity curve from the best strategy's component scores as a proxy
  // until real backtest history is available via GetStrategyReport
  const topStrategy = strategies?.strategies?.[0];

  return (
    <main className="min-h-screen bg-gray-950 text-gray-100 p-6">
      <header className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">xstockstrat Insights</h1>
          <p className="text-sm text-gray-500 mt-1">Strategy analytics and backtesting</p>
        </div>
        <nav className="flex items-center gap-3 text-sm">
          <Link
            href="/strategies"
            className="px-3 py-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300 transition-colors"
          >
            All Strategies →
          </Link>
        </nav>
      </header>

      <div className="grid grid-cols-12 gap-4">
        {/* Strategy scores */}
        <div className="col-span-4 rounded-xl bg-gray-900 border border-gray-800 p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-semibold">Strategy Scores</h2>
            <Link href="/strategies" className="text-xs text-blue-400 hover:text-blue-300">
              View all →
            </Link>
          </div>
          {!strategies ? (
            <p className="text-sm text-gray-500">Loading…</p>
          ) : (
            <ul className="space-y-3">
              {(strategies?.strategies ?? []).map((s: any) => (
                <li key={s.strategyId}>
                  <Link
                    href={`/strategies/${s.strategyId}`}
                    className="flex items-center justify-between text-sm group"
                  >
                    <span className="font-mono text-xs text-gray-400 group-hover:text-gray-200 transition-colors">
                      {s.strategyId}
                    </span>
                    <div className="flex items-center gap-2">
                      {s.rating && (
                        <span className={`text-xs font-bold ${ratingColor(s.rating)}`}>
                          {s.rating}
                        </span>
                      )}
                      {s.overallScore !== undefined && (
                        <span className={`font-bold ${scoreColor(s.overallScore)}`}>
                          {(s.overallScore * 100).toFixed(0)}
                        </span>
                      )}
                    </div>
                  </Link>
                </li>
              ))}
              {(strategies?.strategies ?? []).length === 0 && (
                <p className="text-sm text-gray-600">
                  No strategies yet.{' '}
                  <Link href="/strategies" className="text-blue-400 hover:underline">
                    Run a backtest
                  </Link>
                </p>
              )}
            </ul>
          )}
        </div>

        {/* Equity curve chart — shows first strategy result or placeholder */}
        <div className="col-span-8 rounded-xl bg-gray-900 border border-gray-800 p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-semibold">
              {topStrategy ? `${topStrategy.strategyId} — Score Trend` : 'Equity Curve'}
            </h2>
            {topStrategy && (
              <Link
                href={`/strategies/${topStrategy.strategyId}`}
                className="text-xs text-blue-400 hover:text-blue-300"
              >
                Run backtest →
              </Link>
            )}
          </div>
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={chartData(strategies?.strategies ?? [])}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
              <XAxis dataKey="label" tick={{ fill: '#6b7280', fontSize: 11 }} />
              <YAxis tick={{ fill: '#6b7280', fontSize: 11 }} domain={[0, 100]} />
              <Tooltip
                contentStyle={{
                  backgroundColor: '#111827',
                  border: '1px solid #374151',
                  borderRadius: 8,
                }}
                labelStyle={{ color: '#9ca3af' }}
                formatter={(v: any) => [`${Number(v).toFixed(0)}`, 'Score']}
              />
              <Line
                type="monotone"
                dataKey="score"
                stroke="#10b981"
                dot={{ fill: '#10b981' }}
                strokeWidth={2}
              />
            </LineChart>
          </ResponsiveContainer>
          {(strategies?.strategies ?? []).length === 0 && (
            <p className="text-xs text-gray-600 text-center -mt-4">
              Strategy scores will appear here once backtests are run
            </p>
          )}
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

function ratingColor(rating: string): string {
  if (rating === 'A') return 'text-emerald-400';
  if (rating === 'B') return 'text-blue-400';
  if (rating === 'C') return 'text-yellow-400';
  return 'text-red-400';
}

// Convert strategies list to chart data points (score per strategy)
function chartData(strategies: any[]): { label: string; score: number }[] {
  if (strategies.length === 0) {
    // Placeholder to show the chart structure
    return Array.from({ length: 5 }, (_, i) => ({ label: `S${i + 1}`, score: 0 }));
  }
  return strategies.map((s) => ({
    label: s.strategyId?.slice(0, 8) ?? '—',
    score: Math.round((s.overallScore ?? 0) * 100),
  }));
}
