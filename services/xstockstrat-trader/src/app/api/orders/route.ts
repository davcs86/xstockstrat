import { NextRequest, NextResponse } from 'next/server';
import { tradingClient } from '@/lib/connectClients';

// Maps UI trading mode string to proto TradingMode enum value.
// TRADING_MODE_UNSPECIFIED=0, TRADING_MODE_PAPER=1, TRADING_MODE_LIVE=2
function toTradingModeEnum(mode?: string | null): number {
  if (mode === 'live') return 2;
  if (mode === 'paper') return 1;
  return 0;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const order = await (tradingClient as any).placeOrder({
      symbol: body.symbol,
      side: body.side === 'buy' ? 1 : 2,
      orderType: { market: 1, limit: 2, stop: 3, stop_limit: 4 }[body.order_type as string] ?? 1,
      qty: body.qty,
      limitPrice: body.limit_price ?? 0,
      stopPrice: body.stop_price ?? 0,
      timeInForce: body.time_in_force ?? 'day',
      strategyId: body.strategy_id ?? '',
      userId: body.user_id ?? 'default',
      tradingMode: toTradingModeEnum(body.trading_mode),
    });
    return NextResponse.json({
      order_id: order.orderId,
      status: order.status,
      trading_mode: order.tradingMode,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const userId = searchParams.get('user_id') ?? 'default';
  const tradingMode = toTradingModeEnum(searchParams.get('trading_mode'));
  try {
    const result = await (tradingClient as any).listOrders({
      userId,
      page: { pageSize: 50 },
      ...(tradingMode !== 0 && { tradingMode }),
    });
    return NextResponse.json(result);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
