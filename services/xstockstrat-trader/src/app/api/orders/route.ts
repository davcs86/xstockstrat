import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest, rolesToAccessScope, generateTraceId } from '@/lib/auth';

const TRADING_BASE_URL =
  process.env.TRADING_HTTP_ENDPOINT ?? 'http://xstockstrat-trading:8051';

// Maps UI trading mode string to proto TradingMode enum value.
// TRADING_MODE_UNSPECIFIED=0, TRADING_MODE_PAPER=1, TRADING_MODE_LIVE=2
function toTradingModeEnum(mode?: string | null): number {
  if (mode === 'live') return 2;
  if (mode === 'paper') return 1;
  return 0;
}

async function rpc(method: string, body: object, propagationHeaders: Record<string, string>): Promise<Response> {
  return fetch(`${TRADING_BASE_URL}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/connect+json', ...propagationHeaders },
    body: JSON.stringify(body),
  });
}

export async function POST(req: NextRequest) {
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
  try {
    const body = await req.json();
    if (!body.symbol) {
      return NextResponse.json({ error: 'symbol is required' }, { status: 400 });
    }
    const res = await rpc('xstockstrat.trading.v1.TradingService/PlaceOrder', {
      symbol: body.symbol,
      side: body.side === 'buy' ? 1 : 2,
      orderType: { market: 1, limit: 2, stop: 3, stop_limit: 4 }[body.order_type as string] ?? 1,
      qty: body.qty,
      limitPrice: body.limit_price ?? 0,
      stopPrice: body.stop_price ?? 0,
      timeInForce: body.time_in_force ?? 'day',
      strategyId: body.strategy_id ?? '',
      userId: claims.user_id,
      tradingMode: toTradingModeEnum(body.trading_mode),
    }, propagationHeaders);
    const order = await res.json();
    return NextResponse.json({
      order_id: order.order_id ?? order.orderId,
      status: order.status,
      trading_mode: order.trading_mode ?? order.tradingMode,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

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
  const tradingMode = toTradingModeEnum(searchParams.get('trading_mode'));
  const accountId = searchParams.get('account_id') ?? '';
  try {
    const res = await rpc('xstockstrat.trading.v1.TradingService/ListOrders', {
      userId: claims.user_id,
      page: { pageSize: 50 },
      ...(tradingMode !== 0 && { tradingMode }),
      ...(accountId && { accountId }),
    }, propagationHeaders);
    const result = await res.json();
    return NextResponse.json(result);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
