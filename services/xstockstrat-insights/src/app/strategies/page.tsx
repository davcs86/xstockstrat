'use client';
import useSWR from 'swr';
import Link from 'next/link';

const fetcher = (url: string) => fetch(url).then((r) => r.json());

function ratingColor(rating: string): string {
  if (rating === 'A') return 'text-emerald-400 bg-emerald-400/10';
  if (rating === 'B') return 'text-blue-400 bg-blue-400/10';
  if (rating === 'C') return 'text-yellow-400 bg-yellow-400/10';
  if (rating === 'D') return 'text-orange-400 bg-orange-400/10';
  return 'text-red-400 bg-red-400/10';
}

function scoreColor(score: number): string {
  if (score >= 0.8) return 'text-emerald-400';
  if (score >= 0.6) return 'text-yellow-400';
  return 'text-red-400';
}

export default function StrategiesPage() {
  const { data, isLoading, error } = useSWR('/api/analysis/strategies', fetcher, {
    refreshInterval: 30000,
  });

  return (
    <main className="min-h-screen bg-gray-950 text-gray-100 p-6">
      <header className="mb-6">
        <div className="flex items-center gap-3 mb-1">
          <Link href="/" className="text-gray-500 hover:text-gray-300 text-sm">
            &larr; dashboard
          </Link>
        </div>
        <h1 className="text-2xl font-bold tracking-tight">Strategies</h1>
        <p className="text-sm text-gray-500 mt-1">All registered trading strategies with scores</p>
      </header>

      {isLoading && <p className="text-sm text-gray-500">Loading strategies…</p>}
      {error && <p className="text-sm text-red-400">Failed to load strategies</p>}

      {data && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {(data.strategies ?? []).map((s: any) => (
            <Link
              key={s.strategyId}
              href={`/strategies/${s.strategyId}`}
              className="block rounded-xl bg-gray-900 border border-gray-800 p-5 hover:border-gray-600 transition-colors"
            >
              <div className="flex items-start justify-between mb-3">
                <div>
                  <p className="text-sm font-semibold font-mono text-gray-200">{s.strategyId}</p>
                </div>
                {s.rating && (
                  <span
                    className={`text-sm font-bold px-2 py-0.5 rounded ${ratingColor(s.rating)}`}
                  >
                    {s.rating}
                  </span>
                )}
              </div>
              {s.overallScore !== undefined && (
                <div className="space-y-1">
                  <div className="flex justify-between text-xs">
                    <span className="text-gray-500">Overall Score</span>
                    <span className={`font-bold ${scoreColor(s.overallScore)}`}>
                      {(s.overallScore * 100).toFixed(0)}%
                    </span>
                  </div>
                  {s.componentScores &&
                    Object.entries(s.componentScores as Record<string, number>)
                      .slice(0, 3)
                      .map(([key, val]) => (
                        <div key={key} className="flex justify-between text-xs">
                          <span className="text-gray-600 capitalize">{key}</span>
                          <span className="text-gray-400">{(val * 100).toFixed(0)}</span>
                        </div>
                      ))}
                </div>
              )}
              <p className="text-xs text-gray-600 mt-3">Click to view details →</p>
            </Link>
          ))}
          {(data.strategies ?? []).length === 0 && (
            <p className="text-sm text-gray-600 col-span-3">
              No strategies found. Run a backtest to register a strategy.
            </p>
          )}
        </div>
      )}
    </main>
  );
}
