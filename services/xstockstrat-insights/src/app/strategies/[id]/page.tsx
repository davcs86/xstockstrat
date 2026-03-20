'use client';
import { useState } from 'react';
import useSWR from 'swr';
import Link from 'next/link';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface BacktestFormState {
  symbol: string;
  start: string;
  end: string;
  initial_capital: string;
}

export default function StrategyDetailPage({ params }: { params: { id: string } }) {
  const { id } = params;
  const { data: report, isLoading } = useSWR(`/api/analysis/report/${id}`, fetcher);

  const [form, setForm] = useState<BacktestFormState>({
    symbol: 'AAPL',
    start: '2024-01-01',
    end: '2024-12-31',
    initial_capital: '100000',
  });
  const [backtestResult, setBacktestResult] = useState<any>(null);
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);

  async function runBacktest() {
    setRunning(true);
    setRunError(null);
    try {
      const res = await fetch('/api/analysis/backtest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          strategy_id: id,
          symbol: form.symbol,
          start: new Date(form.start).toISOString(),
          end: new Date(form.end).toISOString(),
          initial_capital: parseFloat(form.initial_capital),
        }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setBacktestResult(data);
    } catch (e: any) {
      setRunError(e.message);
    } finally {
      setRunning(false);
    }
  }

  const result = backtestResult ?? report?.latestBacktest;

  // Build equity curve from trades if available
  const equityCurve = (() => {
    if (!result?.trades?.length) return [];
    let equity = parseFloat(form.initial_capital) || 100000;
    return result.trades.map((t: any, i: number) => {
      equity += t.pnl ?? 0;
      return { trade: i + 1, equity: Math.round(equity) };
    });
  })();

  return (
    <main className="min-h-screen bg-gray-950 text-gray-100 p-6">
      <header className="mb-6">
        <div className="flex items-center gap-3 mb-2">
          <Link href="/strategies" className="text-gray-500 hover:text-gray-300 text-sm">
            &larr; strategies
          </Link>
        </div>
        <h1 className="text-2xl font-bold tracking-tight font-mono">{id}</h1>
      </header>

      <div className="grid grid-cols-12 gap-4">
        {/* Left: score + backtest runner */}
        <div className="col-span-4 space-y-4">
          {/* Score card */}
          {report?.score && (
            <div className="rounded-xl bg-gray-900 border border-gray-800 p-5">
              <h2 className="text-sm font-semibold mb-3">Strategy Score</h2>
              <div className="flex items-center gap-3 mb-4">
                <span className="text-4xl font-bold text-emerald-400">{report.score.rating}</span>
                <span className="text-2xl text-gray-400">
                  {(report.score.overallScore * 100).toFixed(0)}%
                </span>
              </div>
              <div className="space-y-1.5">
                {Object.entries(
                  (report.score.componentScores ?? {}) as Record<string, number>,
                ).map(([key, val]) => (
                  <div key={key} className="flex justify-between text-xs">
                    <span className="text-gray-500 capitalize">{key}</span>
                    <span className="text-gray-300">{(val * 100).toFixed(0)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Backtest runner form */}
          <div className="rounded-xl bg-gray-900 border border-gray-800 p-5">
            <h2 className="text-sm font-semibold mb-3">Run Backtest</h2>
            <div className="space-y-3">
              <div>
                <label className="block text-xs text-gray-500 mb-1">Symbol</label>
                <input
                  className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm focus:outline-none focus:border-blue-500"
                  value={form.symbol}
                  onChange={(e) => setForm({ ...form, symbol: e.target.value })}
                  placeholder="AAPL"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Start Date</label>
                <input
                  type="date"
                  className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm focus:outline-none focus:border-blue-500"
                  value={form.start}
                  onChange={(e) => setForm({ ...form, start: e.target.value })}
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">End Date</label>
                <input
                  type="date"
                  className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm focus:outline-none focus:border-blue-500"
                  value={form.end}
                  onChange={(e) => setForm({ ...form, end: e.target.value })}
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Initial Capital ($)</label>
                <input
                  className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm focus:outline-none focus:border-blue-500"
                  value={form.initial_capital}
                  onChange={(e) => setForm({ ...form, initial_capital: e.target.value })}
                />
              </div>
              <button
                onClick={runBacktest}
                disabled={running}
                className="w-full bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded px-4 py-2 text-sm font-semibold transition-colors"
              >
                {running ? 'Running…' : 'Run Backtest'}
              </button>
              {runError && <p className="text-xs text-red-400">{runError}</p>}
            </div>
          </div>
        </div>

        {/* Right: results */}
        <div className="col-span-8 space-y-4">
          {result && (
            <>
              {/* Metrics grid */}
              <div className="rounded-xl bg-gray-900 border border-gray-800 p-5">
                <h2 className="text-sm font-semibold mb-4">Backtest Results</h2>
                <div className="grid grid-cols-3 gap-4">
                  <Metric
                    label="Total Return"
                    value={`${((result.totalReturn ?? 0) * 100).toFixed(2)}%`}
                    positive={(result.totalReturn ?? 0) >= 0}
                  />
                  <Metric
                    label="Sharpe Ratio"
                    value={(result.sharpeRatio ?? 0).toFixed(3)}
                    positive={(result.sharpeRatio ?? 0) >= 1}
                  />
                  <Metric
                    label="Max Drawdown"
                    value={`${((result.maxDrawdown ?? 0) * 100).toFixed(2)}%`}
                    positive={false}
                    neutral
                  />
                  <Metric
                    label="Win Rate"
                    value={`${((result.winRate ?? 0) * 100).toFixed(1)}%`}
                    positive={(result.winRate ?? 0) >= 0.5}
                  />
                  <Metric label="Total Trades" value={String(result.totalTrades ?? 0)} />
                  <Metric
                    label="Profit Factor"
                    value={(result.profitFactor ?? 0).toFixed(2)}
                    positive={(result.profitFactor ?? 0) >= 1}
                  />
                </div>
              </div>

              {/* Equity curve */}
              {equityCurve.length > 0 && (
                <div className="rounded-xl bg-gray-900 border border-gray-800 p-5">
                  <h2 className="text-sm font-semibold mb-4">Equity Curve</h2>
                  <ResponsiveContainer width="100%" height={220}>
                    <LineChart data={equityCurve}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
                      <XAxis
                        dataKey="trade"
                        tick={{ fill: '#6b7280', fontSize: 11 }}
                        label={{ value: 'Trade #', position: 'insideBottom', fill: '#6b7280', fontSize: 11 }}
                      />
                      <YAxis tick={{ fill: '#6b7280', fontSize: 11 }} />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: '#111827',
                          border: '1px solid #374151',
                          borderRadius: 8,
                        }}
                        labelStyle={{ color: '#9ca3af' }}
                        formatter={(v: any) => [`$${Number(v).toLocaleString()}`, 'Equity']}
                      />
                      <Line
                        type="monotone"
                        dataKey="equity"
                        stroke="#10b981"
                        dot={false}
                        strokeWidth={2}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}
            </>
          )}

          {isLoading && !result && (
            <div className="rounded-xl bg-gray-900 border border-gray-800 p-5">
              <p className="text-sm text-gray-500">Loading report…</p>
            </div>
          )}
          {!isLoading && !result && (
            <div className="rounded-xl bg-gray-900 border border-gray-800 p-5">
              <p className="text-sm text-gray-600">
                No backtest results yet. Run a backtest using the form on the left.
              </p>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}

function Metric({
  label,
  value,
  positive,
  neutral,
}: {
  label: string;
  value: string;
  positive?: boolean;
  neutral?: boolean;
}) {
  const color = neutral
    ? 'text-gray-300'
    : positive === true
      ? 'text-emerald-400'
      : positive === false
        ? 'text-red-400'
        : 'text-gray-200';
  return (
    <div className="bg-gray-800/50 rounded-lg p-3">
      <p className="text-xs text-gray-500 mb-1">{label}</p>
      <p className={`text-lg font-bold tabular-nums ${color}`}>{value}</p>
    </div>
  );
}
