import { NextRequest, NextResponse } from 'next/server';
import { ConnectError } from '@connectrpc/connect';
import { connectCodeToHttp, marketDataClient } from '@/lib/connectClients';
import { getSessionFromRequest, rolesToAccessScope, generateTraceId } from '@/lib/auth';

// GET /api/marketdata?symbol=AAPL&timeframe=1Day&limit=200
// Returns { bars: [{time, open, high, low, close, volume}] } for lightweight-charts.
export async function GET(req: NextRequest) {
  const claims = await getSessionFromRequest(req);
  if (!claims) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const symbol = searchParams.get('symbol') ?? '';
  const timeframe = searchParams.get('timeframe') ?? '1Day';
  const limit = Math.min(500, Math.max(1, parseInt(searchParams.get('limit') ?? '200', 10)));

  if (!symbol) {
    return NextResponse.json({ error: 'symbol is required' }, { status: 400 });
  }

  const headers = new Headers({
    'x-user-id': claims.user_id,
    'x-access-scope': String(rolesToAccessScope(claims.roles)),
    'x-trace-id': req.headers.get('x-trace-id') ?? generateTraceId(),
  });

  try {
    const res = await marketDataClient.getBars(
      { symbol, timeframe, page: { pageSize: limit } },
      { headers },
    );
    const bars = ((res as any).bars ?? []).map((b: any) => ({
      time: b.time?.seconds ?? Math.floor(new Date(b.time).getTime() / 1000),
      open: Number(b.open),
      high: Number(b.high),
      low: Number(b.low),
      close: Number(b.close),
      volume: Number(b.volume ?? 0),
    }));
    return NextResponse.json({ bars });
  } catch (err) {
    if (ConnectError) {
      const ce = ConnectError.from(err);
      return NextResponse.json({ error: ce.rawMessage }, { status: connectCodeToHttp(ce.code) });
    }
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
