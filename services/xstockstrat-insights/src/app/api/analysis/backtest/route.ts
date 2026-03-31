/**
 * POST /api/analysis/backtest
 *
 * Runs a backtest via xstockstrat-analysis RunBacktest.
 * Body: { strategy_id, symbol, start, end, initial_capital? }
 * Returns: BacktestResult
 */
import { NextRequest, NextResponse } from 'next/server';

const ANALYSIS_BASE_URL =
  process.env.ANALYSIS_HTTP_ENDPOINT ?? 'http://xstockstrat-analysis:8056';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { strategy_id, symbol, start, end, initial_capital = 100000 } = body;

    const res = await fetch(
      `${ANALYSIS_BASE_URL}/xstockstrat.analysis.v1.AnalysisService/RunBacktest`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/connect+json' },
        body: JSON.stringify({
          strategyId: strategy_id,
          symbols: symbol ? [symbol] : [],
          initialCapital: initial_capital,
          range: start && end ? { startTime: start, endTime: end } : undefined,
        }),
      },
    );

    const result = await res.json();
    return NextResponse.json(result);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
