import { NextRequest, NextResponse } from 'next/server';
import { connectCodeToHttp, tradingClient } from '@/lib/connectClients';
import { getSessionFromRequest, rolesToAccessScope, generateTraceId } from '@/lib/auth';

// Maps UI trading mode string to proto TradingMode enum value.
// TRADING_MODE_UNSPECIFIED=0, TRADING_MODE_PAPER=1, TRADING_MODE_LIVE=2
function toTradingModeEnum(mode?: string | null): number {
  if (mode === 'live') return 2;
  if (mode === 'paper') return 1;
  return 0;
}

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

export async function POST(req: NextRequest) {
  const claims = await getSessionFromRequest(req);
  if (!claims) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const body = await req.json();
    if (!body.symbol) {
      return NextResponse.json({ error: 'symbol is required' }, { status: 400 });
    }
    const order = await tradingClient.placeOrder(
      {
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
      },
      { headers: propagationHeaders(req, claims) },
    );
    const o = order as any;
    return NextResponse.json({
      order_id: o.order_id ?? o.orderId,
      status: o.status,
      trading_mode: o.trading_mode ?? o.tradingMode,
    });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function GET(req: NextRequest) {
  const claims = await getSessionFromRequest(req);
  if (!claims) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { searchParams } = new URL(req.url);
  const tradingMode = toTradingModeEnum(searchParams.get('trading_mode'));
  const accountId = searchParams.get('account_id') ?? '';
  try {
    const result = await tradingClient.listOrders(
      {
        userId: claims.user_id,
        page: { pageSize: 50 },
        ...(tradingMode !== 0 && { tradingMode }),
        ...(accountId && { accountId }),
      },
      { headers: propagationHeaders(req, claims) },
    );
    return NextResponse.json(result);
  } catch (err) {
    return errorResponse(err);
  }
}
