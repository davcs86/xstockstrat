import { NextRequest, NextResponse } from 'next/server';
import { connectCodeToHttp, marketDataClient } from '@/lib/connectClients';
import { getSessionFromRequest, rolesToAccessScope, generateTraceId } from '@/lib/auth';

function propagationHeaders(req: NextRequest, claims: { user_id: string; roles: string[] }): Headers {
  return new Headers({
    'x-user-id': claims.user_id,
    'x-access-scope': String(rolesToAccessScope(claims.roles)),
    'x-trace-id': req.headers.get('x-trace-id') ?? generateTraceId(),
  });
}

function errorResponse(err: unknown): NextResponse {
  const code = (err as any)?.code;
  const message = (err as any)?.rawMessage ?? (err as Error)?.message ?? 'Internal error';
  return NextResponse.json(
    { error: message },
    { status: typeof code === 'number' ? connectCodeToHttp(code) : 500 },
  );
}

// GET /api/chart?symbol=AAPL&timeframe=1d&limit=100
// Returns { bars: [{time, open, high, low, close, volume}] }
export async function GET(req: NextRequest) {
  const claims = await getSessionFromRequest(req);
  if (!claims) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { searchParams } = new URL(req.url);
  const symbol = searchParams.get('symbol') ?? '';
  const timeframe = searchParams.get('timeframe') ?? '1d';
  const limit = Math.min(200, Math.max(1, parseInt(searchParams.get('limit') ?? '100', 10)));

  if (!symbol) {
    return NextResponse.json({ error: 'symbol is required' }, { status: 400 });
  }

  try {
    const data = await marketDataClient.getBars(
      { symbol, timeframe, page: { pageSize: limit } },
      { headers: propagationHeaders(req, claims) },
    );
    const bars = ((data as any).bars ?? []).map((b: any) => ({
      // lightweight-charts expects { time: Unix seconds, open, high, low, close }
      time: b.time?.seconds ?? Math.floor(new Date(b.time).getTime() / 1000),
      open: Number(b.open),
      high: Number(b.high),
      low: Number(b.low),
      close: Number(b.close),
      volume: Number(b.volume ?? 0),
    }));
    return NextResponse.json({ bars });
  } catch (err) {
    return errorResponse(err);
  }
}

// POST /api/chart — returns tradable symbols for the symbol selector
export async function POST(req: NextRequest) {
  const claims = await getSessionFromRequest(req);
  if (!claims) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const data = await marketDataClient.listAssets(
      { assetClass: 'us_equity', tradableOnly: true },
      { headers: propagationHeaders(req, claims) },
    );
    const symbols: string[] = ((data as any).assets ?? [])
      .map((a: any) => a.symbol as string)
      .filter(Boolean);
    return NextResponse.json({ symbols });
  } catch {
    // ListAssets is best-effort for the symbol picker; failures shouldn't 5xx.
    return NextResponse.json({ symbols: [] });
  }
}
