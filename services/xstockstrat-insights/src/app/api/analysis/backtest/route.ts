/**
 * POST /api/analysis/backtest
 *
 * Runs a backtest via xstockstrat-analysis RunBacktest.
 * Body: { strategy_id, symbol, start, end, initial_capital? }
 * Returns: BacktestResult
 */
import { NextRequest, NextResponse } from 'next/server';
import { analysisClient, connectCodeToHttp } from '@/lib/connectClients';
import { getSessionFromRequest, rolesToAccessScope, generateTraceId } from '@/lib/auth';

export async function POST(req: NextRequest) {
  const claims = await getSessionFromRequest(req);
  if (!claims) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const headers = new Headers({
    'x-user-id': claims.user_id,
    'x-access-scope': String(rolesToAccessScope(claims.roles)),
    'x-trace-id': req.headers.get('x-trace-id') ?? generateTraceId(),
  });
  try {
    const body = await req.json();
    const { strategy_id, symbol, start, end, initial_capital = 100000 } = body;

    const result = await analysisClient.runBacktest(
      {
        strategyId: strategy_id,
        symbols: symbol ? [symbol] : [],
        initialCapital: initial_capital,
        range: start && end ? { startTime: start, endTime: end } : undefined,
      },
      { headers },
    );
    return NextResponse.json(result);
  } catch (err) {
    const code = (err as any)?.code;
    const message = (err as any)?.rawMessage ?? (err as Error)?.message ?? 'Internal error';
    return NextResponse.json(
      { error: message },
      { status: typeof code === 'number' ? connectCodeToHttp(code) : 500 },
    );
  }
}
