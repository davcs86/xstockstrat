import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest, rolesToAccessScope, generateTraceId } from '@/lib/auth';

const MARKETDATA_BASE_URL =
  process.env.MARKETDATA_HTTP_ENDPOINT ?? 'http://xstockstrat-marketdata:8053';

async function rpc(method: string, body: object, headers: Record<string, string>): Promise<Response> {
  return fetch(`${MARKETDATA_BASE_URL}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/connect+json', ...headers },
    body: JSON.stringify(body),
  });
}

// GET /api/marketdata?symbol=AAPL&timeframe=1d&limit=200
// Returns { bars: [{time, open, high, low, close, volume}] } for lightweight-charts.
export async function GET(req: NextRequest) {
  const claims = await getSessionFromRequest(req);
  if (!claims) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const accessScope = String(rolesToAccessScope(claims.roles));
  const traceId = req.headers.get('x-trace-id') ?? generateTraceId();
  const propagationHeaders = {
    'x-user-id': claims.user_id,
    'x-access-scope': accessScope,
    'x-trace-id': traceId,
  };

  const { searchParams } = new URL(req.url);
  const symbol = searchParams.get('symbol') ?? '';
  const timeframe = searchParams.get('timeframe') ?? '1Day';
  const limit = Math.min(500, Math.max(1, parseInt(searchParams.get('limit') ?? '200', 10)));

  if (!symbol) {
    return NextResponse.json({ error: 'symbol is required' }, { status: 400 });
  }

  try {
    const res = await rpc(
      'xstockstrat.marketdata.v1.MarketDataService/GetBars',
      { symbol, timeframe, page: { pageSize: limit } },
      propagationHeaders,
    );
    if (!res.ok) {
      const errText = await res.text();
      return NextResponse.json({ error: errText || 'GetBars failed' }, { status: res.status });
    }
    const data = await res.json();
    const bars = (data.bars ?? []).map((b: any) => ({
      time: b.time?.seconds ?? Math.floor(new Date(b.time).getTime() / 1000),
      open: Number(b.open),
      high: Number(b.high),
      low: Number(b.low),
      close: Number(b.close),
      volume: Number(b.volume ?? 0),
    }));
    return NextResponse.json({ bars });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
