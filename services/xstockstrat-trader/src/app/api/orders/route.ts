import { NextRequest, NextResponse } from 'next/server';
import { tradingClient } from '@/lib/grpcClients';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const order = await new Promise<any>((resolve, reject) => {
      tradingClient.placeOrder(
        {
          symbol: body.symbol,
          side: body.side === 'buy' ? 1 : 2,
          order_type: { market: 1, limit: 2, stop: 3, stop_limit: 4 }[body.order_type as string] ?? 1,
          qty: body.qty,
          limit_price: body.limit_price ?? 0,
          stop_price: body.stop_price ?? 0,
          time_in_force: body.time_in_force ?? 'day',
          strategy_id: body.strategy_id ?? '',
          user_id: body.user_id ?? 'default',
        },
        (err: any, result: any) => (err ? reject(err) : resolve(result)),
      );
    });
    return NextResponse.json({ order_id: order.order_id, status: order.status });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const userId = searchParams.get('user_id') ?? 'default';
  try {
    const result = await new Promise<any>((resolve, reject) => {
      tradingClient.listOrders({ user_id: userId, page: { page_size: 50 } }, (err: any, res: any) =>
        err ? reject(err) : resolve(res)
      );
    });
    return NextResponse.json(result);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
